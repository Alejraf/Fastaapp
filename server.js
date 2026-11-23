const express = require('express');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Clave secreta sincronizada directamente con tu configuración de TimeWall
const POSTBACK_SECRET = process.env.POSTBACK_SECRET || 'secretomayor15274515';
const STREAK_REWARDS = [5, 8, 10, 12, 15, 18, 35];

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

function getYesterdayKey() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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
          balance: 200,
          adActionsCount: 0,
          offersCompleted: 0,
          offerwallCoins: 0,
          streakDay: 0,
          lastStreakDate: null,
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
      memUsers[userId] = { userId, balance: 200, adActionsCount: 0, offersCompleted: 0, offerwallCoins: 0, streakDay: 0, ip };
    }
    return res.json(memUsers[userId]);
  } catch (err) {
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Bono diario (+10 monedas)
app.post('/api/daily-bonus', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'INVALID_USER' });
    const today = new Date().toISOString().slice(0, 10);
    const BONUS = 10;

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
        tx.update(userRef, {
          balance: nextBal,
          lastDailyBonus: today,
          adActionsCount: Number(data.adActionsCount || 0) + 1
        });
        return { already: false, balance: nextBal };
      });
      if (out.already) return res.status(429).json({ ok: false, error: 'Bônus diário já resgatado hoje.' });
      return res.json({ ok: true, balance: out.balance });
    }

    const u = memUsers[userId] || { userId, balance: 200, adActionsCount: 0 };
    if (u.lastDailyBonus === today) return res.status(429).json({ ok: false, error: 'Bônus diário já resgatado hoje.' });
    u.balance += BONUS;
    u.adActionsCount = (u.adActionsCount || 0) + 1;
    u.lastDailyBonus = today;
    memUsers[userId] = u;
    return res.json({ ok: true, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Racha Diaria de 7 Días (+5 a +35 monedas)
app.post('/api/streak-claim', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, error: 'INVALID_USER' });
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = getYesterdayKey();

    if (db) {
      const userRef = db.collection('users').doc(userId);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('NO_USER');
        const data = snap.data();
        if (data.lastStreakDate === today) {
          return { already: true, balance: data.balance, streakDay: data.streakDay || 1 };
        }

        let nextDay = 1;
        if (data.lastStreakDate === yesterday) {
          nextDay = Number(data.streakDay || 0) >= 7 ? 1 : Number(data.streakDay || 0) + 1;
        }
        const reward = STREAK_REWARDS[nextDay - 1];
        const nextBal = Number(data.balance || 0) + reward;

        tx.update(userRef, {
          balance: nextBal,
          streakDay: nextDay,
          lastStreakDate: today,
          adActionsCount: Number(data.adActionsCount || 0) + 1
        });
        return { already: false, balance: nextBal, streakDay: nextDay, reward };
      });

      if (out.already) return res.status(429).json({ ok: false, error: 'Sequência de hoje já resgatada.' });
      return res.json({ ok: true, ...out });
    }

    const u = memUsers[userId] || { userId, balance: 200, streakDay: 0, adActionsCount: 0 };
    if (u.lastStreakDate === today) return res.status(429).json({ ok: false, error: 'Sequência de hoje já resgatada.' });
    u.streakDay = u.lastStreakDate === yesterday ? (u.streakDay >= 7 ? 1 : u.streakDay + 1) : 1;
    const reward = STREAK_REWARDS[u.streakDay - 1];
    u.balance += reward;
    u.adActionsCount = (u.adActionsCount || 0) + 1;
    u.lastStreakDate = today;
    memUsers[userId] = u;
    return res.json({ ok: true, balance: u.balance, streakDay: u.streakDay, reward });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Cofre de Tiempo Activo (+5 monedas, máx. 6 cofres/día)
app.post('/api/playtime-chest', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, error: 'INVALID_USER' });
    const today = new Date().toISOString().slice(0, 10);
    const REWARD = 5;
    const MAX_CHESTS = 6;

    if (db) {
      const userRef = db.collection('users').doc(userId);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('NO_USER');
        const data = snap.data();
        const stats = data.chestStats || { date: today, count: 0 };
        const countToday = stats.date === today ? Number(stats.count || 0) : 0;
        if (countToday >= MAX_CHESTS) {
          return { limitReached: true, balance: Number(data.balance || 0) };
        }
        const nextBal = Number(data.balance || 0) + REWARD;
        tx.update(userRef, {
          balance: nextBal,
          chestStats: { date: today, count: countToday + 1 },
          adActionsCount: Number(data.adActionsCount || 0) + 1
        });
        return { limitReached: false, balance: nextBal };
      });
      if (out.limitReached) return res.status(429).json({ ok: false, error: 'DAILY_CHEST_LIMIT' });
      return res.json({ ok: true, reward: REWARD, balance: out.balance });
    }

    const u = memUsers[userId] || { userId, balance: 200, adActionsCount: 0 };
    u.balance += REWARD;
    u.adActionsCount = (u.adActionsCount || 0) + 1;
    memUsers[userId] = u;
    return res.json({ ok: true, reward: REWARD, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Recompensa de subida de nivel en CashPlay Arcade (+3 monedas o x2 = +6 monedas, máx. 10 cupos/día)
app.post('/api/game-reward', async (req, res) => {
  try {
    const { userId, game, level, multiplier } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_USER' });
    }

    const mult = Number(multiplier) === 2 ? 2 : 1;
    const today = new Date().toISOString().slice(0, 10);
    const BASE_REWARD = 3;
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

        const slotsUsed = Math.min(mult, DAILY_MAX - countToday);
        const reward = BASE_REWARD * slotsUsed;
        const newBalance = Number(data.balance || 0) + reward;

        tx.update(userRef, {
          balance: newBalance,
          gameStats: { date: today, count: countToday + slotsUsed },
          adActionsCount: Number(data.adActionsCount || 0) + 1,
          lastActive: new Date().toISOString()
        });

        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          userId,
          type: slotsUsed === 2 ? 'game_level_up_x2' : 'game_level_up',
          game: String(game || 'Arcade').slice(0, 40),
          level: Number(level || 1),
          amount: reward,
          createdAt: new Date().toISOString()
        });

        return { limitReached: false, balance: newBalance, reward, slotsUsed };
      });

      if (result.limitReached) {
        return res.status(429).json({ ok: false, error: 'DAILY_LIMIT_REACHED', balance: result.balance });
      }
      return res.json({ ok: true, reward: result.reward, slotsUsed: result.slotsUsed, balance: result.balance });
    }

    const u = memUsers[userId] || { userId, balance: 200, adActionsCount: 0 };
    const reward = BASE_REWARD * mult;
    u.balance += reward;
    u.adActionsCount = (u.adActionsCount || 0) + 1;
    memUsers[userId] = u;
    return res.json({ ok: true, reward, slotsUsed: mult, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Hito de Contador de Anuncios Monetag (+15 monedas cada 5 anuncios vistos, máx. 4 hitos/día)
app.post('/api/ad-milestone', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_USER' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const REWARD = 15;
    const MAX_MILESTONES = 4;

    if (db) {
      const userRef = db.collection('users').doc(userId);
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error('NO_USER');
        const data = snap.data() || {};
        const stats = data.adMilestoneStats || { date: today, count: 0 };
        const countToday = stats.date === today ? Number(stats.count || 0) : 0;
        if (countToday >= MAX_MILESTONES) {
          return { limitReached: true, balance: Number(data.balance || 0) };
        }
        const nextBal = Number(data.balance || 0) + REWARD;
        tx.update(userRef, {
          balance: nextBal,
          adMilestoneStats: { date: today, count: countToday + 1 },
          lastActive: new Date().toISOString()
        });
        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          userId,
          type: 'monetag_ad_milestone',
          milestone: countToday + 1,
          amount: REWARD,
          createdAt: new Date().toISOString()
        });
        return { limitReached: false, balance: nextBal, milestone: countToday + 1 };
      });
      if (out.limitReached) return res.status(429).json({ ok: false, error: 'DAILY_MILESTONE_LIMIT' });
      return res.json({ ok: true, reward: REWARD, balance: out.balance, milestone: out.milestone });
    }

    const u = memUsers[userId] || { userId, balance: 200, adActionsCount: 0 };
    u.balance += REWARD;
    memUsers[userId] = u;
    return res.json({ ok: true, reward: REWARD, balance: u.balance, milestone: 1 });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Postback S2S de TimeWall (GET /api/postback)
app.get('/api/postback', async (req, res) => {
  try {
    const { secret, userid, amount, txid, offer_name, revenue } = req.query;
    console.log('[TimeWall Postback]', { userid, amount, txid, offer_name, revenue });

    if (secret !== POSTBACK_SECRET && secret !== 'secretomayor15274515') {
      console.warn('[TimeWall Postback] Secret inválido recibido:', secret);
      return res.status(403).send('INVALID_SECRET');
    }
    if (!userid || !amount) return res.status(400).send('MISSING_PARAMS');

    const coins = Math.round(Number(amount));
    if (isNaN(coins) || coins <= 0) return res.status(400).send('INVALID_AMOUNT');
    const transactionId = String(txid || `${userid}_${Date.now()}`);

    if (db) {
      const txDoc = db.collection('postbacks').doc(`tw_${transactionId}`);
      const exists = await txDoc.get();
      if (exists.exists) return res.status(200).send('OK');

      const userRef = db.collection('users').doc(String(userid));
      await db.runTransaction(async (tx) => {
        const uSnap = await tx.get(userRef);
        const uData = uSnap.exists ? uSnap.data() : {};
        const cur = Number(uData.balance || 0);
        const prevOffers = Number(uData.offersCompleted || 0);
        const prevOfferCoins = Number(uData.offerwallCoins || 0);

        tx.set(
          userRef,
          {
            userId: String(userid),
            balance: cur + coins,
            offersCompleted: prevOffers + 1,
            offerwallCoins: prevOfferCoins + coins,
            lastOfferAt: new Date().toISOString()
          },
          { merge: true }
        );

        tx.set(txDoc, {
          provider: 'TimeWall',
          userId: String(userid),
          amount: coins,
          revenueUsd: Number(revenue || 0),
          offerName: String(offer_name || 'TimeWall Offer'),
          createdAt: new Date().toISOString()
        });

        // Comisión 10% para quien invitó al usuario
        if (uSnap.exists && uData.referredBy) {
          const refId = uData.referredBy;
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
      return res.status(200).send('OK');
    }

    if (!memTx.has(transactionId)) {
      memTx.add(transactionId);
      const u = memUsers[userid] || { userId: userid, balance: 0, offersCompleted: 0, offerwallCoins: 0 };
      u.balance += coins;
      u.offersCompleted = (u.offersCompleted || 0) + 1;
      u.offerwallCoins = (u.offerwallCoins || 0) + coins;
      memUsers[userid] = u;
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[TimeWall Postback Error]', err.message);
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
        const data = snap.data();
        const bal = Number(data.balance || 0);
        const adActionsCount = Number(data.adActionsCount || 0);

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
          adActionsCount,
          offersCompleted: Number(data.offersCompleted || 0),
          offerwallCoins: Number(data.offerwallCoins || 0),
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
    memWithdraws.push({
      id: String(Date.now()),
      userId,
      method,
      account,
      amount: coins,
      adActionsCount: u.adActionsCount || 0,
      offersCompleted: u.offersCompleted || 0,
      offerwallCoins: u.offerwallCoins || 0,
      ip,
      status: 'pending'
    });
    return res.json({ ok: true, balance: u.balance });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// Panel de administración (/admin?secret=...) con retiros e ingresos Offerwall (TimeWall)
app.get('/admin', async (req, res) => {
  if (req.query.secret !== POSTBACK_SECRET && req.query.secret !== 'secretomayor15274515') {
    return res.status(403).send('Acceso denegado');
  }

  let usersCount = 0;
  let totalAds = 0;
  let totalOfferCoins = 0;
  let usersList = [];
  let list = [];

  if (db) {
    const uSnap = await db.collection('users').get();
    usersCount = uSnap.size;
    uSnap.docs.forEach((d) => {
      const data = d.data() || {};
      const uid = data.userId || d.id;
      if (String(uid).startsWith('usr_')) {
        const ads = Number(data.adActionsCount || 0);
        const offCoins = Number(data.offerwallCoins || 0);
        totalAds += ads;
        totalOfferCoins += offCoins;
        usersList.push({
          userId: uid,
          balance: Number(data.balance || 0),
          adActionsCount: ads,
          offersCompleted: Number(data.offersCompleted || 0),
          offerwallCoins: offCoins,
          streakDay: Number(data.streakDay || 0),
          ip: data.lastIp || data.ip || '-',
          lastSeen: data.lastSeen || data.createdAt || ''
        });
      }
    });
    usersList.sort((a, b) => {
      if (b.offerwallCoins !== a.offerwallCoins) return b.offerwallCoins - a.offerwallCoins;
      if (b.adActionsCount !== a.adActionsCount) return b.adActionsCount - a.adActionsCount;
      return b.balance - a.balance;
    });

    const wSnap = await db.collection('withdrawals').orderBy('createdAt', 'desc').limit(50).get();
    list = wSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    usersList = Object.values(memUsers);
    usersCount = usersList.length;
    totalAds = usersList.reduce((acc, u) => acc + Number(u.adActionsCount || 0), 0);
    totalOfferCoins = usersList.reduce((acc, u) => acc + Number(u.offerwallCoins || 0), 0);
    list = memWithdraws;
  }

  const rows = list
    .map(
      (w) => `
      <tr>
        <td>${w.userId}</td>
        <td>${w.method}: <strong>${w.account}</strong></td>
        <td>${w.amount} ($${w.usd || (w.amount / 1000).toFixed(2)})</td>
        <td style="color:#38bdf8;font-weight:700">${w.offersCompleted || 0} ofertas (${w.offerwallCoins || 0} 🪙)</td>
        <td>${w.adActionsCount || 0} anuncios</td>
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

  const userRows = usersList
    .slice(0, 100)
    .map((u) => {
      const dateShort = u.lastSeen ? String(u.lastSeen).replace('T', ' ').slice(0, 16) : '-';
      return `
      <tr>
        <td><strong>${u.userId}</strong></td>
        <td style="color:#fbbf24;font-weight:700">${u.balance}</td>
        <td style="color:#38bdf8;font-weight:700">${u.offersCompleted || 0} (${u.offerwallCoins || 0} 🪙)</td>
        <td style="color:#34d399;font-weight:700">${u.adActionsCount}</td>
        <td>Día ${u.streakDay}</td>
        <td>${u.ip}</td>
        <td>${dateShort}</td>
      </tr>`;
    })
    .join('');

  res.send(`
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{font-family:sans-serif;background:#0b1120;color:#fff;padding:14px;margin:0}
      .stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
      .card{background:#131c31;border:1px solid #253354;border-radius:10px;padding:10px 14px;font-size:13px}
      .card strong{display:block;font-size:18px;color:#38bdf8;margin-top:2px}
      .wrap{overflow-x:auto;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:12px;background:#131c31}
      td,th{border:1px solid #253354;padding:8px;text-align:left;white-space:nowrap}
      th{background:#19243e;color:#94a3b8}
      button{padding:6px 10px;margin:2px;cursor:pointer;border-radius:6px;border:none;font-weight:700}
      h3{margin:14px 0 8px;font-size:15px;color:#e2e8f0}
    </style>
    </head><body>
      <h2 style="margin:0 0 12px;font-size:18px">💎 Panel Admin CashPlay</h2>
      <div class="stats">
        <div class="card">Usuarios CashPlay<strong>${usersList.length}</strong></div>
        <div class="card">Coins TimeWall<strong>${totalOfferCoins}</strong></div>
        <div class="card">Anuncios Monetag<strong>${totalAds}</strong></div>
        <div class="card">Base de Datos<strong>${db ? 'Firestore OK' : 'Memoria'}</strong></div>
      </div>

      <h3>💸 Solicitudes de Retiro</h3>
      <div class="wrap">
        <table>
          <thead><tr><th>Usuario</th><th>Cuenta</th><th>Retiro</th><th>Ingresos Offerwall</th><th>Anuncios</th><th>IP</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="color:#94a3b8">Sin retiros pendientes todavía.</td></tr>'}</tbody>
        </table>
      </div>

      <h3>👥 Detalle de Usuarios Activos (Últimos 100)</h3>
      <div class="wrap">
        <table>
          <thead><tr><th>ID Usuario</th><th>Monedas</th><th>TimeWall</th><th>Anuncios</th><th>Racha</th><th>IP</th><th>Última Actividad (UTC)</th></tr></thead>
          <tbody>${userRows || '<tr><td colspan="7" style="color:#94a3b8">Aún no hay usuarios registrados.</td></tr>'}</tbody>
        </table>
      </div>

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
  if (req.query.secret !== POSTBACK_SECRET && req.query.secret !== 'secretomayor15274515') {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
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
