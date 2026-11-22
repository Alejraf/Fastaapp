const express = require('express');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const POSTBACK_SECRET = process.env.POSTBACK_SECRET || 'CLAVE2026';

// Inicialización de Firebase Firestore
let db = null;
try {
  let serviceAccount = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (fs.existsSync('/etc/secrets/firebase-key.json')) {
    serviceAccount = JSON.parse(fs.readFileSync('/etc/secrets/firebase-key.json', 'utf8'));
  } else if (fs.existsSync(path.join(__dirname, 'firebase-key.json'))) {
    serviceAccount = JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-key.json'), 'utf8'));
  }

  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log('Firestore conectado correctamente.');
  }
} catch (err) {
  console.error('Error iniciando Firestore:', err.message);
}

const memUsers = {};
const memTx = new Set();
const memWithdraws = [];

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// Obtener o crear usuario
app.post('/api/user', async (req, res) => {
  try {
    const { userId, ref } = req.body || {};
    if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'INVALID_USER' });
    const ip = getClientIp(req);

    if (db) {
      const refDoc = db.collection('users').doc(userId);
      const snap = await refDoc.get();
      if (!snap.exists) {
        const newUser = {
          userId,
          balance: 500, // Bono de bienvenida
          referredBy: ref && ref !== userId ? String(ref).slice(0, 32) : null,
          ip,
          createdAt: new Date().toISOString()
        };
        await refDoc.set(newUser);
        return res.json(newUser);
      }
      await refDoc.update({ lastIp: ip, lastSeen: new Date().toISOString() });
      return res.json(snap.data());
    }

    if (!memUsers[userId]) {
      memUsers[userId] = { userId, balance: 500, ip };
    }
    return res.json(memUsers[userId]);
  } catch (err) {
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Bono diario (+20 monedas)
app.post('/api/daily-bonus', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'INVALID_USER' });
    const today = new Date().toISOString().slice(0, 10);
    const BONUS = 20;

    if (db) {
      const userRef = db.collection('users').doc(userId);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('NO_USER');
        const data = snap.data();
        if (data.lastDailyBonus === today) {
          return { already: true, balance: data.balance };
        }
        const nextBal = Number(data.balance || 0) + BONUS;
        tx.update(userRef, { balance: nextBal, lastDailyBonus: today });
        return { already: false, balance: nextBal };
      });
      if (out.already) return res.status(429).json({ ok: false, error: 'Bônus diário já resgatado hoje.' });
      return res.json({ ok: true, balance: out.balance });
    }

    const u = memUsers[userId] || { userId, balance: 500 };
    if (u.lastDailyBonus === today) return res.status(429).json({ ok: false, error: 'Bônus diário já resgatado hoje.' });
    u.balance += BONUS;
    u.lastDailyBonus = today;
    memUsers[userId] = u;
    return res.json({ ok: true, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Recompensa de subida de nivel en CashPlay Arcade (+5 monedas, máx. 10/día)
app.post('/api/game-reward', async (req, res) => {
  try {
    const { userId, game, level } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_USER' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const REWARD = 5;
    const DAILY_MAX = 10;

    if (db) {
      const userRef = db.collection('users').doc(userId);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('USER_NOT_FOUND');
        const data = snap.data() || {};
        const gameStats = data.gameStats || { date: today, count: 0 };
        const countToday = gameStats.date === today ? Number(gameStats.count || 0) : 0;

        if (countToday >= DAILY_MAX) {
          return { limitReached: true, balance: Number(data.balance || 0) };
        }

        const newBalance = Number(data.balance || 0) + REWARD;
        tx.update(userRef, {
          balance: newBalance,
          gameStats: { date: today, count: countToday + 1 },
          lastActive: new Date().toISOString()
        });

        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          userId,
          type: 'game_level_up',
          game: String(game || 'Arcade').slice(0, 40),
          level: Number(level || 1),
          amount: REWARD,
          createdAt: new Date().toISOString()
        });

        return { limitReached: false, balance: newBalance };
      });

      if (result.limitReached) {
        return res.status(429).json({ ok: false, error: 'DAILY_LIMIT_REACHED', balance: result.balance });
      }
      return res.json({ ok: true, reward: REWARD, balance: result.balance });
    }

    const u = memUsers[userId] || { userId, balance: 500 };
    u.balance += REWARD;
    memUsers[userId] = u;
    return res.json({ ok: true, reward: REWARD, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Postback S2S de Offerwalls (TimeWall / ayeT-Studios)
app.get('/api/postback', async (req, res) => {
  try {
    const { secret, userid, amount, txid, offer_name } = req.query;
    if (secret !== POSTBACK_SECRET) return res.status(403).send('INVALID_SECRET');
    if (!userid || !amount) return res.status(400).send('MISSING_PARAMS');

    const coins = Math.round(Number(amount));
    if (isNaN(coins) || coins <= 0) return res.status(400).send('INVALID_AMOUNT');
    const transactionId = String(txid || `${userid}_${Date.now()}`);

    if (db) {
      const txDoc = db.collection('postbacks').doc(transactionId);
      const exists = await txDoc.get();
      if (exists.exists) return res.send('OK'); // Idempotencia

      const userRef = db.collection('users').doc(String(userid));
      await db.runTransaction(async (tx) => {
        const uSnap = await tx.get(userRef);
        const cur = uSnap.exists ? Number(uSnap.data().balance || 0) : 0;
        tx.set(userRef, { userId: String(userid), balance: cur + coins }, { merge: true });
        tx.set(txDoc, {
          userId: String(userid),
          amount: coins,
          offerName: String(offer_name || 'Offer'),
          createdAt: new Date().toISOString()
        });

        // Comisión 10% para referido si existe
        if (uSnap.exists && uSnap.data().referredBy) {
          const refId = uSnap.data().referredBy;
          const refBonus = Math.floor(coins * 0.1);
          if (refBonus > 0) {
            const refUserRef = db.collection('users').doc(refId);
            const refSnap = await tx.get(refUserRef);
            if (refSnap.exists) {
              tx.update(refUserRef, { balance: Number(refSnap.data().balance || 0) + refBonus });
            }
          }
        }
      });
      return res.send('OK');
    }

    if (!memTx.has(transactionId)) {
      memTx.add(transactionId);
      const u = memUsers[userid] || { userId: userid, balance: 0 };
      u.balance += coins;
      memUsers[userid] = u;
    }
    return res.send('OK');
  } catch (err) {
    return res.status(500).send('ERROR');
  }
});

// Solicitud de retiro
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, method, account, amount } = req.body || {};
    const coins = Number(amount || 0);
    if (!userId || !method || !account || coins < 2000) {
      return res.status(400).json({ ok: false, error: 'Saque mínimo: 2.000 moedas.' });
    }
    const ip = getClientIp(req);

    if (db) {
      const userRef = db.collection('users').doc(userId);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return { ok: false, error: 'Usuário não encontrado.' };
        const bal = Number(snap.data().balance || 0);
        if (bal < coins) return { ok: false, error: 'Saldo insuficiente.' };
        const nextBal = bal - coins;
        tx.update(userRef, { balance: nextBal });

        const wdRef = db.collection('withdrawals').doc();
        tx.set(wdRef, {
          userId,
          method: String(method),
          account: String(account),
          amount: coins,
          usd: (coins / 1000).toFixed(2),
          ip,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        return { ok: true, balance: nextBal };
      });
      return res.json(out);
    }

    const u = memUsers[userId];
    if (!u || u.balance < coins) return res.json({ ok: false, error: 'Saldo insuficiente.' });
    u.balance -= coins;
    memWithdraws.push({ id: String(Date.now()), userId, method, account, amount: coins, ip, status: 'pending' });
    return res.json({ ok: true, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Panel de administración (/admin?secret=...)
app.get('/admin', async (req, res) => {
  if (req.query.secret !== POSTBACK_SECRET) return res.status(403).send('Acceso denegado');

  let usersCount = 0;
  let list = [];
  if (db) {
    const uSnap = await db.collection('users').get();
    usersCount = uSnap.size;
    const wSnap = await db.collection('withdrawals').orderBy('createdAt', 'desc').limit(50).get();
    list = wSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    usersCount = Object.keys(memUsers).length;
    list = memWithdraws;
  }

  const rows = list
    .map(
      (w) => `
      <tr>
        <td>${w.userId}</td>
        <td>${w.method}: <strong>${w.account}</strong></td>
        <td>${w.amount} ($${w.usd || (w.amount / 1000).toFixed(2)})</td>
        <td>${w.ip || '-'}</td>
        <td>${w.status}</td>
        <td>
          ${
            w.status === 'pending'
              ? `<button onclick="act('${w.id}','paid')">✅ Pagado</button>
                 <button onclick="act('${w.id}','rejected')">❌ Rechazar</button>`
              : w.status
          }
        </td>
      </tr>`
    )
    .join('');

  res.send(`
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;background:#0b1120;color:#fff;padding:16px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{border:1px solid #253354;padding:8px}button{padding:6px 10px;margin:2px;cursor:pointer}</style>
    </head><body>
      <h2>💎 Panel Admin CashPlay</h2>
      <p>Usuarios totales: <strong>${usersCount}</strong> | Firestore: <strong>${db ? 'Activo' : 'Memoria'}</strong></p>
      <table><thead><tr><th>Usuario</th><th>Cuenta</th><th>Monto</th><th>IP</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows}</tbody></table>
      <script>
        async function act(id, status){
          await fetch('/api/admin/withdraw?secret=${encodeURIComponent(req.query.secret)}',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status})
          });
          location.reload();
        }
      </script>
    </body></html>
  `);
});

app.post('/api/admin/withdraw', async (req, res) => {
  if (req.query.secret !== POSTBACK_SECRET) return res.status(403).json({ error: 'FORBIDDEN' });
  const { id, status } = req.body || {};
  if (db && id) {
    const wRef = db.collection('withdrawals').doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(wRef);
      if (!snap.exists) return;
      const data = snap.data();
      if (data.status !== 'pending') return;
      tx.update(wRef, { status, updatedAt: new Date().toISOString() });
      if (status === 'rejected') {
        const uRef = db.collection('users').doc(data.userId);
        const uSnap = await tx.get(uRef);
        if (uSnap.exists) {
          tx.update(uRef, { balance: Number(uSnap.data().balance || 0) + Number(data.amount || 0) });
        }
      }
    });
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CashPlay server running on port ' + PORT));
