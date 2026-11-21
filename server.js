const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Persistencia en archivo JSON (configurable con DATA_DIR si usas un Persistent Disk en Render)
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_FILE = path.join(DATA_DIR, 'database.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.users) return parsed;
    }
  } catch (err) {
    console.error('Error leyendo database.json:', err);
  }
  return {
    users: {
      'user_demo': {
        id: 'user_demo',
        username: 'Jugador',
        coins: 1250,
        referralCode: 'CASH-DEMO',
        referredBy: null,
        referralsCount: 0,
        referralEarnings: 0,
        completedOffers: ['offer_welcome'],
        withdrawals: [],
        createdAt: new Date().toISOString()
      }
    }
  };
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error guardando database.json:', err);
  }
}

const OFFERWALL_PROVIDERS = [
  {
    id: 'adgem',
    name: 'AdGem Games',
    badge: '2X PUNTOS',
    description: 'Instala juegos móviles y sube de nivel para ganar grandes recompensas.',
    iframeUrl: process.env.ADGEM_WALL_URL || '',
    color: '#3b82f6'
  },
  {
    id: 'offertoro',
    name: 'Torox / OfferToro',
    badge: 'POPULAR',
    description: 'Tareas rápidas, registro en apps y pruebas gratuitas.',
    iframeUrl: process.env.OFFERTORO_WALL_URL || '',
    color: '#8b5cf6'
  },
  {
    id: 'ayetstudios',
    name: 'ayeT-Studios',
    badge: 'ALTO PAGO',
    description: 'Juegos recomendados con pago instantáneo al completar misiones.',
    iframeUrl: process.env.AYET_WALL_URL || '',
    color: '#10b981'
  },
  {
    id: 'monetag_bonus',
    name: 'Bono Diario Patrocinado',
    badge: '+150 MONEDAS',
    description: 'Abre el enlace patrocinado y reclama monedas extra cada día.',
    directUrl: process.env.MONETAG_DIRECT_LINK || 'https://uplcm.com/4/12301967',
    rewardCoins: 150,
    color: '#f59e0b'
  }
];

const FEATURED_OFFERS = [
  {
    id: 'game_lords',
    title: 'Lords Mobile: Guerra de Reinos',
    category: 'Juego',
    platform: 'Android / iOS',
    task: 'Instala y alcanza el Castillo Nivel 11',
    rewardCoins: 2400,
    icon: '🏰',
    url: process.env.OFFER_1_URL || 'https://uplcm.com/4/12301967'
  },
  {
    id: 'game_merge',
    title: 'Merge Dragons!',
    category: 'Juego',
    platform: 'Android',
    task: 'Instala y completa el nivel Foothills 3',
    rewardCoins: 1800,
    icon: '🐉',
    url: process.env.OFFER_2_URL || 'https://uplcm.com/4/12301967'
  },
  {
    id: 'app_finance',
    title: 'App Cashback & Finanzas',
    category: 'App',
    platform: 'Android / iOS',
    task: 'Descarga, regístrate y verifica tu cuenta',
    rewardCoins: 950,
    icon: '💳',
    url: process.env.OFFER_3_URL || 'https://uplcm.com/4/12301967'
  },
  {
    id: 'game_puzzle',
    title: 'Block Puzzle Jewel',
    category: 'Juego Rápido',
    platform: 'Android',
    task: 'Juega durante 5 minutos seguidos',
    rewardCoins: 450,
    icon: '🧩',
    url: process.env.OFFER_4_URL || 'https://uplcm.com/4/12301967'
  }
];

function makeReferralCode(userId) {
  const clean = String(userId).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  return 'CASH-' + (clean || Math.random().toString(36).substring(2, 6).toUpperCase());
}

function getOrCreateUser(userId = 'user_demo', refCode = null) {
  const cleanId = String(userId).trim() || 'user_demo';
  if (!db.users[cleanId]) {
    const newUser = {
      id: cleanId,
      username: 'Jugador',
      coins: 500, // Bono de bienvenida
      referralCode: makeReferralCode(cleanId),
      referredBy: null,
      referralsCount: 0,
      referralEarnings: 0,
      completedOffers: [],
      withdrawals: [],
      createdAt: new Date().toISOString()
    };

    // Aplicar código de referido si es válido y distinto al propio usuario
    if (refCode) {
      const sponsor = Object.values(db.users).find(
        u => u.referralCode && u.referralCode.toUpperCase() === String(refCode).trim().toUpperCase() && u.id !== cleanId
      );
      if (sponsor) {
        newUser.referredBy = sponsor.id;
        newUser.coins += 250; // Bono extra para el invitado
        sponsor.coins += 300; // Bono por invitación al padrino
        sponsor.referralsCount = (sponsor.referralsCount || 0) + 1;
        sponsor.referralEarnings = (sponsor.referralEarnings || 0) + 300;
      }
    }

    db.users[cleanId] = newUser;
    saveDB();
  }
  return db.users[cleanId];
}

// Acreditar comisión del 10% al padrino cuando un referido gana monedas
function creditReferralCommission(user, earnedCoins) {
  if (!user.referredBy || !db.users[user.referredBy]) return;
  const sponsor = db.users[user.referredBy];
  const commission = Math.floor(earnedCoins * 0.10);
  if (commission > 0) {
    sponsor.coins += commission;
    sponsor.referralEarnings = (sponsor.referralEarnings || 0) + commission;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', usersCount: Object.keys(db.users).length, timestamp: new Date().toISOString() });
});

app.get('/api/dashboard', (req, res) => {
  const userId = req.query.userId || 'user_demo';
  const ref = req.query.ref || null;
  const user = getOrCreateUser(userId, ref);
  res.json({
    user,
    providers: OFFERWALL_PROVIDERS,
    offers: FEATURED_OFFERS,
    conversionRate: 1000 // 1000 monedas = $1.00 USD / R$ 5.00
  });
});

// Canjear código de referido manualmente
app.post('/api/referral/apply', (req, res) => {
  const { userId = 'user_demo', code } = req.body;
  const user = getOrCreateUser(userId);

  if (user.referredBy) {
    return res.status(400).json({ error: 'Ya aplicaste un código de invitación anteriormente' });
  }
  if (!code || !code.trim()) {
    return res.status(400).json({ error: 'Ingresa un código válido' });
  }

  const sponsor = Object.values(db.users).find(
    u => u.referralCode && u.referralCode.toUpperCase() === code.trim().toUpperCase() && u.id !== user.id
  );
  if (!sponsor) {
    return res.status(404).json({ error: 'Código de invitación no encontrado' });
  }

  user.referredBy = sponsor.id;
  user.coins += 250;
  sponsor.coins += 300;
  sponsor.referralsCount = (sponsor.referralsCount || 0) + 1;
  sponsor.referralEarnings = (sponsor.referralEarnings || 0) + 300;
  saveDB();

  res.json({ success: true, bonus: 250, totalCoins: user.coins });
});

// Reclamar recompensa de oferta o bono diario
app.post('/api/offers/claim', (req, res) => {
  const { userId = 'user_demo', offerId, coins } = req.body;
  const user = getOrCreateUser(userId);
  const reward = Number(coins) || 150;

  if (offerId && offerId !== 'monetag_bonus' && user.completedOffers.includes(offerId)) {
    return res.status(400).json({ error: 'Esta oferta ya fue reclamada' });
  }

  if (offerId && offerId !== 'monetag_bonus') {
    user.completedOffers.push(offerId);
  }
  user.coins += reward;
  creditReferralCommission(user, reward);
  saveDB();

  res.json({
    success: true,
    addedCoins: reward,
    totalCoins: user.coins,
    completedOffers: user.completedOffers
  });
});

// Postback S2S estándar para Offerwalls (AdGem, Torox, ayeT, CPX)
app.get('/api/postback', (req, res) => {
  const { user_id, amount, tx_id, secret } = req.query;
  const expectedSecret = process.env.POSTBACK_SECRET || 'MI_CLAVE_SECRETA';

  if (secret !== expectedSecret) {
    return res.status(403).send('INVALID_SECRET');
  }
  if (!user_id || !amount) {
    return res.status(400).send('MISSING_PARAMS');
  }

  const user = getOrCreateUser(String(user_id));
  const txKey = tx_id ? `tx_${tx_id}` : null;
  if (txKey && user.completedOffers.includes(txKey)) {
    return res.status(200).send('ALREADY_CREDITED');
  }

  const earned = Math.max(1, Math.round(Number(amount)));
  user.coins += earned;
  if (txKey) user.completedOffers.push(txKey);
  creditReferralCommission(user, earned);
  saveDB();

  console.log(`Postback acreditado: +${earned} monedas a ${user_id}`);
  res.status(200).send('OK');
});

// Solicitar retiro de dinero (PIX, PayPal, Binance, Recarga)
app.post('/api/withdraw', (req, res) => {
  const { userId = 'user_demo', method, account, coins } = req.body;
  const user = getOrCreateUser(userId);
  const amountCoins = Number(coins);

  if (!method || !account || !account.trim()) {
    return res.status(400).json({ error: 'Completa el método y tu cuenta/llave de pago' });
  }
  if (isNaN(amountCoins) || amountCoins < 5000) {
    return res.status(400).json({ error: 'El mínimo de retiro es 5,000 monedas ($5.00 / R$ 25)' });
  }
  if (user.coins < amountCoins) {
    return res.status(400).json({ error: 'Saldo insuficiente' });
  }

  user.coins -= amountCoins;
  const withdrawal = {
    id: 'W-' + Date.now(),
    method,
    account: account.trim(),
    coins: amountCoins,
    usdValue: (amountCoins / 1000).toFixed(2),
    status: 'Pendiente',
    date: new Date().toISOString()
  };
  user.withdrawals.unshift(withdrawal);
  saveDB();

  res.json({
    success: true,
    coins: user.coins,
    withdrawal,
    withdrawals: user.withdrawals
  });
});

// Panel de administración (ver todos los retiros y usuarios)
app.get('/api/admin/overview', (req, res) => {
  const secret = req.query.secret;
  const expectedSecret = process.env.POSTBACK_SECRET || 'MI_CLAVE_SECRETA';
  if (secret !== expectedSecret) {
    return res.status(403).json({ error: 'Clave secreta inválida' });
  }
  const allUsers = Object.values(db.users);
  const allWithdrawals = allUsers.flatMap(u =>
    (u.withdrawals || []).map(w => ({ ...w, userId: u.id }))
  );
  res.json({
    totalUsers: allUsers.length,
    withdrawals: allWithdrawals
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CashPlay Offerwall v2 ejecutándose en http://localhost:${PORT}`);
});
