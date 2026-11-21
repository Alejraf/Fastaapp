const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const POSTBACK_SECRET = process.env.POSTBACK_SECRET || 'CLAVE2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Firebase Firestore si existe FIREBASE_SERVICE_ACCOUNT
let firestoreDb = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firestoreDb = admin.firestore();
    console.log('✅ Conectado a Firebase Firestore correctamente.');
  } catch (err) {
    console.error('⚠️ Error inicializando Firebase:', err.message);
  }
}

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
    title: 'TikTok Lite - Recompensas',
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
    reward: 4500,
    category: 'Finanzas',
    platform: 'Android / iOS',
    badge: 'TOP PAGO',
    icon: '💳',
    url: 'https://www.google.com/search?q=Cuenta+digital'
  }
];

let db = {
  users: {},
  withdrawals: [],
  postbacks: [],
  offers: DEFAULT_OFFERS
};

function ensureDemoUser() {
  if (!db.users['usr_demo1']) {
    db.users['usr_demo1'] = {
      id: 'usr_demo1',
      name: 'Jugador CashPlay',
      coins: 500,
      totalEarned: 500,
      referralCode: 'CASH500',
      referredBy: null,
      referralsCount: 0,
      referralEarnings: 0,
      lastDailyBonus: null,
      createdAt: new Date().toISOString(),
      history: [
        {
          id: 'tx_welcome',
          type: 'bonus',
          title: 'Bono de bienvenida',
          amount: 500,
          date: new Date().toISOString()
        }
      ]
    };
  }
}

async function initDB() {
  if (firestoreDb) {
    try {
      const doc = await firestoreDb.collection('cashplay_system').doc('main_db').get();
      if (doc.exists) {
        const data = doc.data();
        db = {
          users: data.users || {},
          withdrawals: data.withdrawals || [],
          postbacks: data.postbacks || [],
          offers: data.offers && data.offers.length ? data.offers : DEFAULT_OFFERS
        };
        console.log(`✅ Base cargada desde Firestore (${Object.keys(db.users).length} usuarios).`);
        return;
      }
    } catch (e) {
      console.error('Error leyendo Firestore:', e.message);
    }
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {}
  }
  ensureDemoUser();
  saveDB();
}

let saveTimer = null;
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {}

  if (firestoreDb) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await firestoreDb.collection('cashplay_system').doc('main_db').set(db);
      } catch (e) {
        console.error('Error guardando en Firestore:', e.message);
      }
    }, 500);
  }
}

function getOrCreateUser(userId) {
  const cleanId = String(userId || '').trim() || 'usr_' + Math.random().toString(36).substring(2, 9);
  if (!db.users[cleanId]) {
    const refCode = 'CP' + Math.random().toString(36).substring(2, 7).toUpperCase();
    db.users[cleanId] = {
      id: cleanId,
      name: 'Usuario #' + cleanId.slice(-4).toUpperCase(),
      coins: 500,
      totalEarned: 500,
      referralCode: refCode,
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
    saveDB();
  }
  return db.users[cleanId];
}

function creditUserCoins(userId, amount, title, type = 'offerwall') {
  const user = getOrCreateUser(userId);
  const pts = Math.round(Number(amount) || 0);
  if (pts <= 0) return user;

  user.coins += pts;
  user.totalEarned += pts;
  user.history.unshift({
    id: 'tx_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    type,
    title,
    amount: pts,
    date: new Date().toISOString()
  });

  if (user.referredBy && db.users[user.referredBy]) {
    const refCommission = Math.floor(pts * 0.10);
    if (refCommission > 0) {
      const sponsor = db.users[user.referredBy];
      sponsor.coins += refCommission;
      sponsor.totalEarned += refCommission;
      sponsor.referralEarnings += refCommission;
      sponsor.history.unshift({
        id: 'tx_ref_' + Date.now(),
        type: 'referral',
        title: `Comisión 10% de ${user.name}`,
        amount: refCommission,
        date: new Date().toISOString()
      });
    }
  }

  saveDB();
  return user;
}

app.get('/api/dashboard', (req, res) => {
  const user = getOrCreateUser(req.query.userId);
  const userWithdrawals = db.withdrawals.filter(w => w.userId === user.id);
  res.json({
    ok: true,
    user,
    offers: db.offers,
    withdrawals: userWithdrawals,
    conversionRate: 1000,
    firestoreActive: Boolean(firestoreDb)
  });
});

app.post('/api/daily-bonus', (req, res) => {
  const { userId } = req.body;
  const user = getOrCreateUser(userId);
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (user.lastDailyBonus && (now - new Date(user.lastDailyBonus).getTime()) < oneDayMs) {
    const remainingMs = oneDayMs - (now - new Date(user.lastDailyBonus).getTime());
    const hoursLeft = Math.ceil(remainingMs / (1000 * 60 * 60));
    return res.status(400).json({
      ok: false,
      message: `Ya reclamaste tu bono hoy. Vuelve en ${hoursLeft}h.`
    });
  }

  user.lastDailyBonus = new Date().toISOString();
  creditUserCoins(user.id, 150, 'Bono Diario Patrocinado', 'bonus');
  res.json({ ok: true, message: '¡+150 monedas acreditadas!', user });
});

app.post('/api/complete-offer', (req, res) => {
  const { userId, offerId } = req.body;
  const offer = db.offers.find(o => o.id === offerId);
  if (!offer) return res.status(404).json({ ok: false, message: 'Oferta no encontrada' });

  const user = getOrCreateUser(userId);
  const alreadyDone = user.history.some(h => h.offerId === offerId);
  if (alreadyDone) {
    return res.status(400).json({ ok: false, message: 'Ya completaste esta oferta anteriormente.' });
  }

  user.coins += offer.reward;
  user.totalEarned += offer.reward;
  user.history.unshift({
    id: 'tx_' + Date.now(),
    offerId: offer.id,
    type: 'offer',
    title: offer.title,
    amount: offer.reward,
    date: new Date().toISOString()
  });
  saveDB();

  res.json({ ok: true, message: `¡Completado! +${offer.reward} monedas`, user });
});

app.post('/api/apply-referral', (req, res) => {
  const { userId, code } = req.body;
  const user = getOrCreateUser(userId);
  const cleanCode = String(code || '').trim().toUpperCase();

  if (user.referredBy) {
    return res.status(400).json({ ok: false, message: 'Ya aplicaste un código de invitación.' });
  }
  if (!cleanCode || cleanCode === user.referralCode) {
    return res.status(400).json({ ok: false, message: 'Código inválido o propio.' });
  }

  const sponsor = Object.values(db.users).find(u => u.referralCode === cleanCode);
  if (!sponsor) {
    return res.status(404).json({ ok: false, message: 'No existe ningún usuario con ese código.' });
  }

  user.referredBy = sponsor.id;
  sponsor.referralsCount += 1;
  creditUserCoins(user.id, 250, `Bono por código ${cleanCode}`, 'referral');
  saveDB();

  res.json({ ok: true, message: '¡Código aplicado! Ganaste +250 monedas.', user });
});

app.post('/api/withdraw', (req, res) => {
  const { userId, method, account, coins } = req.body;
  const user = getOrCreateUser(userId);
  const amountCoins = Math.round(Number(coins) || 0);

  if (amountCoins < 2000) {
    return res.status(400).json({ ok: false, message: 'El retiro mínimo es de 2,000 monedas ($2.00 USD).' });
  }
  if (user.coins < amountCoins) {
    return res.status(400).json({ ok: false, message: 'Saldo insuficiente.' });
  }
  if (!account || String(account).trim().length < 5) {
    return res.status(400).json({ ok: false, message: 'Ingresa una cuenta, correo PayPal o llave PIX válida.' });
  }

  user.coins -= amountCoins;
  const usdValue = (amountCoins / 1000).toFixed(2);
  const withdrawal = {
    id: 'wd_' + Date.now(),
    userId: user.id,
    method: String(method || 'PayPal'),
    account: String(account).trim(),
    coins: amountCoins,
    usdValue,
    status: 'Pendiente',
    date: new Date().toISOString()
  };

  db.withdrawals.unshift(withdrawal);
  user.history.unshift({
    id: 'tx_' + Date.now(),
    type: 'withdraw',
    title: `Retiro ${withdrawal.method} ($${usdValue})`,
    amount: -amountCoins,
    date: new Date().toISOString()
  });
  saveDB();

  res.json({
    ok: true,
    message: `Solicitud de retiro por $${usdValue} USD enviada. Procesamiento en 24-48h.`,
    user,
    withdrawal
  });
});

app.all('/api/postback', (req, res) => {
  const params = { ...req.query, ...req.body };
  const secret = params.secret || params.password || params.key;
  const userId = params.user_id || params.userid || params.subid || params.uid;
  const reward = params.reward || params.amount || params.currency || params.payout_coins;
  const txId = params.tx_id || params.txid || params.trans_id || params.transaction_id || ('pb_' + Date.now());
  const network = params.network || params.offerwall || (params.revenue !== undefined ? 'TimeWall' : 'Offerwall S2S');

  if (secret !== POSTBACK_SECRET) {
    return res.status(403).send('ERROR_INVALID_SECRET');
  }
  if (!userId || !reward) {
    return res.status(400).send('ERROR_MISSING_PARAMS');
  }

  const duplicate = db.postbacks.some(p => p.txId === String(txId));
  if (duplicate) {
    return res.status(200).send('ALREADY_CREDITED');
  }

  db.postbacks.unshift({
    txId: String(txId),
    userId: String(userId),
    reward: Number(reward),
    network: String(network),
    date: new Date().toISOString()
  });

  creditUserCoins(userId, reward, `Tarea completada (${network})`, 'offerwall');
  res.status(200).send('OK');
});

app.get('/api/admin/overview', (req, res) => {
  if (req.query.secret !== POSTBACK_SECRET) {
    return res.status(403).json({ error: 'Clave secreta inválida' });
  }
  res.json({
    firestoreActive: Boolean(firestoreDb),
    totalUsers: Object.keys(db.users).length,
    withdrawals: db.withdrawals
  });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`CashPlay Offerwall v2.1 ejecutándose en http://localhost:${PORT}`);
  });
});
