const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 10000;
const POSTBACK_SECRET = process.env.POSTBACK_SECRET || 'CLAVE2026';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Inicialización de Firebase Firestore
let db = null;
let firestoreActive = false;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
    firestoreActive = true;
    console.log('✅ Conectado a Firebase Firestore correctamente.');
  } else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT no configurada. Usando memoria temporal.');
  }
} catch (error) {
  console.error('⚠️ Error inicializando Firebase:', error.message);
}

// Estado base en memoria + respaldo en Firestore
let memoryState = {
  users: {
    usr_demo: {
      id: 'usr_demo',
      name: 'Usuario Demo',
      coins: 500,
      totalEarned: 500,
      referralCode: 'DEMO2026',
      referredBy: null,
      referralsCount: 0,
      referralEarnings: 0,
      history: []
    }
  },
  withdrawals: [],
  processedTxids: {}
};

const DEFAULT_OFFERS = [
  {
    id: 'off_lords',
    title: 'Lords Mobile: Guerra de Reinos',
    subtitle: 'Instala y alcanza el Castillo Nivel 11',
    reward: 2400,
    category: 'Juego',
    platform: 'Android / iOS',
    badge: 'HOT',
    icon: '🏰',
    url: 'https://www.google.com/search?q=Lords+Mobile'
  },
  {
    id: 'off_tiktok',
    title: 'TikTok Lite',
    subtitle: 'Descarga, regístrate y mira videos 3 minutos',
    reward: 1200,
    category: 'App',
    platform: 'Android',
    badge: 'RÁPIDO',
    icon: '🎵',
    url: 'https://www.google.com/search?q=TikTok+Lite'
  },
  {
    id: 'off_survey',
    title: 'Encuesta Perfil Consumidor LATAM',
    subtitle: 'Responde 12 preguntas sobre hábitos digitales',
    reward: 850,
    category: 'Encuesta',
    platform: 'Web',
    badge: 'FÁCIL',
    icon: '📋',
    url: 'https://www.google.com/search?q=Encuestas+remuneradas'
  },
  {
    id: 'off_nubank',
    title: 'Cuenta Digital Sin Comisiones',
    subtitle: 'Abre tu cuenta gratuita y verifica identidad',
    reward: 3500,
    category: 'Finanzas',
    platform: 'Android / iOS',
    badge: 'TOP PAGO',
    icon: '💳',
    url: 'https://www.google.com/search?q=Cuenta+digital'
  }
];

async function loadState() {
  if (!firestoreActive || !db) return memoryState;
  try {
    const doc = await db.collection('cashplay_system').doc('main_db').get();
    if (doc.exists) {
      const data = doc.data();
      memoryState = {
        users: data.users || memoryState.users,
        withdrawals: data.withdrawals || [],
        processedTxids: data.processedTxids || {}
      };
    } else {
      await saveState();
    }
  } catch (err) {
    console.error('Error leyendo Firestore:', err.message);
  }
  return memoryState;
}

async function saveState() {
  if (!firestoreActive || !db) return;
  try {
    await db.collection('cashplay_system').doc('main_db').set(memoryState, { merge: true });
  } catch (err) {
    console.error('Error guardando en Firestore:', err.message);
  }
}

function getOrCreateUser(state, userId) {
  const cleanId = (userId || 'usr_1sojely').trim();
  if (!state.users[cleanId]) {
    state.users[cleanId] = {
      id: cleanId,
      name: 'Usuario',
      coins: 500,
      totalEarned: 500,
      referralCode: 'CP' + Math.random().toString(36).substring(2, 7).toUpperCase(),
      referredBy: null,
      referralsCount: 0,
      referralEarnings: 0,
      lastDailyBonus: null,
      createdAt: new Date().toISOString(),
      history: [
        {
          id: 'tx_' + Date.now(),
          type: 'bonus',
          title: 'Bono de bienvenida',
          amount: 500,
          date: new Date().toISOString()
        }
      ]
    };
  }
  return state.users[cleanId];
}

// Endpoint principal del Dashboard
app.get('/api/dashboard', async (req, res) => {
  const state = await loadState();
  const user = getOrCreateUser(state, req.query.userId);
  await saveState();

  const userWithdrawals = state.withdrawals.filter(w => w.userId === user.id);
  res.json({
    ok: true,
    user,
    offers: DEFAULT_OFFERS,
    withdrawals: userWithdrawals,
    conversionRate: 1000,
    firestoreActive
  });
});

// Bono diario
app.post('/api/daily-bonus', async (req, res) => {
  const state = await loadState();
  const user = getOrCreateUser(state, req.body.userId);
  const today = new Date().toISOString().slice(0, 10);

  if (user.lastDailyBonus === today) {
    return res.status(400).json({ ok: false, message: 'Ya reclamaste tu bono diario hoy.' });
  }

  user.coins += 100;
  user.totalEarned += 100;
  user.lastDailyBonus = today;
  user.history.unshift({
    id: 'tx_' + Date.now(),
    type: 'bonus',
    title: 'Bono diario',
    amount: 100,
    date: new Date().toISOString()
  });

  await saveState();
  res.json({ ok: true, coins: user.coins, message: '+100 monedas acreditadas' });
});

// Solicitud de retiro
app.post('/api/withdraw', async (req, res) => {
  const { userId, method, account, amountCoins } = req.body;
  const coins = Number(amountCoins);
  if (!method || !account || !coins || coins < 2000) {
    return res.status(400).json({ ok: false, message: 'El retiro mínimo es de 2,000 monedas ($2.00).' });
  }

  const state = await loadState();
  const user = getOrCreateUser(state, userId);

  if (user.coins < coins) {
    return res.status(400).json({ ok: false, message: 'Saldo insuficiente.' });
  }

  user.coins -= coins;
  const withdrawal = {
    id: 'wd_' + Date.now(),
    userId: user.id,
    method,
    account,
    coins,
    usd: (coins / 1000).toFixed(2),
    status: 'pendiente',
    createdAt: new Date().toISOString()
  };

  state.withdrawals.unshift(withdrawal);
  user.history.unshift({
    id: withdrawal.id,
    type: 'withdraw',
    title: `Retiro ${method}`,
    amount: -coins,
    date: withdrawal.createdAt
  });

  await saveState();
  res.json({ ok: true, coins: user.coins, withdrawal });
});

// Postback S2S para Offerwalls (TimeWall, Torox, AdGem, etc.)
app.get('/api/postback', async (req, res) => {
  const secret = req.query.secret || req.query.key;
  if (secret !== POSTBACK_SECRET) {
    return res.status(403).send('INVALID_SECRET');
  }

  const userId = req.query.userid || req.query.user_id || req.query.subid;
  const amount = Math.round(Number(req.query.amount || req.query.coins || 0));
  const txid = String(req.query.txid || req.query.trans_id || ('tx_' + Date.now()));
  const offerName = req.query.offer_name || 'Oferta completada';

  if (!userId || amount <= 0) {
    return res.status(400).send('INVALID_PARAMS');
  }

  const state = await loadState();
  if (state.processedTxids[txid]) {
    return res.status(200).send('OK_DUPLICATE');
  }

  const user = getOrCreateUser(state, userId);
  user.coins += amount;
  user.totalEarned += amount;
  state.processedTxids[txid] = true;
  user.history.unshift({
    id: txid,
    type: 'offer',
    title: offerName,
    amount,
    date: new Date().toISOString()
  });

  await saveState();
  res.status(200).send('OK');
});

// Endpoint JSON de administración (protegido)
app.get('/api/admin/overview', async (req, res) => {
  if (req.query.secret !== POSTBACK_SECRET) {
    return res.status(403).json({ ok: false, message: 'Clave incorrecta' });
  }
  const state = await loadState();
  res.json({
    firestoreActive,
    database: 'Firebase Firestore',
    status: firestoreActive ? 'CONNECTED' : 'MEMORY_ONLY',
    totalUsers: Object.keys(state.users).length,
    withdrawals: state.withdrawals
  });
});

// Acción para aprobar o rechazar retiro desde el panel
app.post('/api/admin/withdraw-action', async (req, res) => {
  const { secret, withdrawalId, action } = req.body;
  if (secret !== POSTBACK_SECRET) {
    return res.status(403).json({ ok: false, message: 'Clave incorrecta' });
  }

  const state = await loadState();
  const wd = state.withdrawals.find(w => w.id === withdrawalId);
  if (!wd) {
    return res.status(404).json({ ok: false, message: 'Retiro no encontrado' });
  }

  if (action === 'approve') {
    wd.status = 'pagado';
    wd.paidAt = new Date().toISOString();
  } else if (action === 'reject' && wd.status === 'pendiente') {
    wd.status = 'rechazado';
    const user = state.users[wd.userId];
    if (user) {
      user.coins += wd.coins;
      user.history.unshift({
        id: 'ref_' + Date.now(),
        type: 'bonus',
        title: `Reembolso retiro rechazado (${wd.method})`,
        amount: wd.coins,
        date: new Date().toISOString()
      });
    }
  }

  await saveState();
  res.json({ ok: true });
});

// Panel visual móvil para gestionar retiros con un toque
app.get('/admin', async (req, res) => {
  if (req.query.secret !== POSTBACK_SECRET) {
    return res.status(403).send('<h2 style="font-family:sans-serif;text-align:center;margin-top:40px">Acceso denegado. Agrega ?secret=TU_CLAVE en la URL</h2>');
  }

  const state = await loadState();
  const totalUsers = Object.keys(state.users).length;
  const rows = state.withdrawals.map(w => {
    const isPending = w.status === 'pendiente';
    const badgeColor = w.status === 'pagado' ? '#16a34a' : (w.status === 'rechazado' ? '#dc2626' : '#d97706');
    return `
      <div style="background:#1e293b;padding:15px;border-radius:12px;margin-bottom:12px;border:1px solid #334155">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:16px;color:#38bdf8">${w.method} — $${w.usd} USD (${w.coins} monedas)</strong>
          <span style="background:${badgeColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;text-transform:uppercase">${w.status}</span>
        </div>
        <div style="font-size:14px;color:#cbd5e1;margin-bottom:4px"><strong>Cuenta / Llave:</strong> ${w.account}</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:10px">Usuario: ${w.userId} • ${new Date(w.createdAt).toLocaleString()}</div>
        ${isPending ? `
          <div style="display:flex;gap:10px">
            <button onclick="updateWd('${w.id}','approve')" style="flex:1;background:#16a34a;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:bold;cursor:pointer">✅ Marcar Pagado</button>
            <button onclick="updateWd('${w.id}','reject')" style="flex:1;background:#dc2626;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:bold;cursor:pointer">❌ Rechazar</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Admin CashPlay</title>
    </head>
    <body style="background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;padding:16px;max-width:600px;margin:auto">
      <h2 style="margin-bottom:4px">💎 Panel Admin CashPlay</h2>
      <p style="color:#94a3b8;margin-top:0">Usuarios totales: <strong>${totalUsers}</strong> • Firestore: <strong>${firestoreActive ? 'Activo' : 'Memoria'}</strong></p>
      <h3 style="border-bottom:1px solid #334155;padding-bottom:8px">Solicitudes de Retiro (${state.withdrawals.length})</h3>
      ${rows || '<p style="color:#94a3b8">Aún no hay solicitudes de retiro.</p>'}
      <script>
        async function updateWd(id, action) {
          if (!confirm(action === 'approve' ? '¿Confirmar que ya enviaste el pago?' : '¿Rechazar retiro y devolver las monedas al usuario?')) return;
          const res = await fetch('/api/admin/withdraw-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: '${POSTBACK_SECRET}', withdrawalId: id, action })
          });
          if (res.ok) location.reload();
          else alert('Error al actualizar');
        }
      </script>
    </body>
    </html>
  `);
});

// Fallback para servir siempre index.html en /, /?v=2 o cualquier ruta SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CashPlay Offerwall v2.2 ejecutándose en http://localhost:${PORT}`);
});
                      
