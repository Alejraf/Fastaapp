// Generar o recuperar ID único del dispositivo automáticamente
function getDeviceUserId() {
  let id = localStorage.getItem('cp_user_id');
  if (!id) {
    id = 'usr_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('cp_user_id', id);
  }
  return id;
}

let currentUserId = getDeviceUserId();
let appState = null;

// Capturar parámetro ?ref=CODIGO si el usuario entró por un enlace de invitación
const urlParams = new URLSearchParams(window.location.search);
const incomingRef = urlParams.get('ref');
if (incomingRef) {
  localStorage.setItem('cp_pending_ref', incomingRef);
}

const toastEl = document.getElementById('toast');
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  const activeBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (activeBtn) activeBtn.classList.add('active');
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.getElementById('walletPill').addEventListener('click', () => switchView('view-cashout'));

async function loadDashboard() {
  try {
    const pendingRef = localStorage.getItem('cp_pending_ref') || '';
    const query = `userId=${encodeURIComponent(currentUserId)}&ref=${encodeURIComponent(pendingRef)}`;
    const res = await fetch(`/api/dashboard?${query}`);
    appState = await res.json();
    if (pendingRef) localStorage.removeItem('cp_pending_ref');
    renderAll();
  } catch {
    showToast('Error al conectar con el servidor');
  }
}

function renderAll() {
  if (!appState) return;
  const { user, providers, offers, conversionRate } = appState;
  const origin = window.location.origin;

  document.getElementById('userIdBadge').textContent = `ID: ${user.id}`;
  document.getElementById('customUserIdInput').value = user.id;

  const usd = (user.coins / conversionRate).toFixed(2);
  const brl = ((user.coins / conversionRate) * 5).toFixed(2).replace('.', ',');

  document.getElementById('coinBalance').textContent = user.coins.toLocaleString();
  document.getElementById('fiatBalance').textContent = `$${usd}`;
  document.getElementById('cashoutCoins').textContent = `${user.coins.toLocaleString()} monedas`;
  document.getElementById('cashoutUsd').textContent = `Equivalente a $${usd} USD / R$ ${brl}`;

  // Referidos
  document.getElementById('refCount').textContent = user.referralsCount || 0;
  document.getElementById('refEarned').textContent = `${(user.referralEarnings || 0).toLocaleString()} 🪙`;
  document.getElementById('refLinkInput').value = `${origin}/?ref=${user.referralCode}`;
  if (user.referredBy) {
    document.getElementById('applyRefBox').classList.add('hidden');
  }

  // URL de Postback S2S
  document.getElementById('postbackUrlBox').textContent =
    `${origin}/api/postback?user_id={user_id}&amount={amount}&tx_id={tx_id}&secret=MI_CLAVE_SECRETA`;

  // Offerwalls
  const providersGrid = document.getElementById('providersGrid');
  providersGrid.innerHTML = '';
  providers.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'provider-card';
    btn.innerHTML = `
      <span class="provider-badge" style="background:${p.color}">${p.badge}</span>
      <div>
        <h4>${p.name}</h4>
        <p>${p.description}</p>
      </div>
    `;
    btn.addEventListener('click', () => openOfferwall(p));
    providersGrid.appendChild(btn);
  });

  // Juegos y Apps Destacados
  const offersList = document.getElementById('offersList');
  offersList.innerHTML = '';
  document.getElementById('offersCount').textContent = `${offers.length} disponibles`;

  offers.forEach(offer => {
    const isClaimed = user.completedOffers.includes(offer.id);
    const card = document.createElement('div');
    card.className = 'offer-card';
    card.innerHTML = `
      <div class="offer-left">
        <div class="offer-icon">${offer.icon}</div>
        <div class="offer-info">
          <h4>${offer.title}</h4>
          <p>${offer.task}</p>
          <span class="offer-tag">${offer.category} • ${offer.platform}</span>
        </div>
      </div>
      <button class="btn-reward ${isClaimed ? 'claimed' : ''}" ${isClaimed ? 'disabled' : ''}>
        ${isClaimed ? '✓ Listo' : `+${offer.rewardCoins} 🪙`}
      </button>
    `;
    if (!isClaimed) {
      card.querySelector('.btn-reward').addEventListener('click', () => startOffer(offer));
    }
    offersList.appendChild(card);
  });

  // Historial de retiros
  const historyEl = document.getElementById('withdrawHistory');
  historyEl.innerHTML = '';
  if (!user.withdrawals || user.withdrawals.length === 0) {
    historyEl.innerHTML = '<p class="muted">Aún no has realizado retiros.</p>';
  } else {
    user.withdrawals.forEach(w => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div>
          <strong>${w.method} • $${w.usdValue} USD</strong>
          <small>${w.account} (${w.coins.toLocaleString()} monedas)</small>
        </div>
        <span class="status-pill">${w.status}</span>
      `;
      historyEl.appendChild(div);
    });
  }
}

function openOfferwall(provider) {
  if (provider.directUrl) {
    window.open(provider.directUrl, '_blank', 'noopener');
    claimOffer('monetag_bonus', provider.rewardCoins || 150);
    return;
  }

  // Abrir TimeWall con tu Placement ID aprobado/asignado y el ID del usuario
  if (provider.id === 'timewall' || (provider.name && provider.name.toLowerCase().includes('timewall'))) {
    const timewallUrl = `https://timewall.io/users/login?oid=1be50b5db408a909&uid=${encodeURIComponent(currentUserId)}`;
    window.open(timewallUrl, '_blank', 'noopener');
    return;
  }

  const modal = document.getElementById('wallModal');
  if (!modal) return;
  document.getElementById('wallModalTitle').textContent = provider.name;
  const body = document.getElementById('wallModalBody');

  if (provider.iframeUrl) {
    const finalUrl = provider.iframeUrl.replace('{user_id}', encodeURIComponent(currentUserId));
    body.innerHTML = `<iframe class="wall-iframe" src="${finalUrl}" allow="clipboard-write"></iframe>`;
  } else {
    body.innerHTML = `
      <div class="card-box">
        <h3>Muro de Ofertas ${provider.name}</h3>
        <p class="muted">Configura <code>${provider.id.toUpperCase()}_WALL_LINK</code> en Render.</p>
        <button id="simulateWallBtn" class="btn-primary">Simular instalación (+600 monedas)</button>
      </div>
    `;
    document.getElementById('simulateWallBtn').addEventListener('click', () => {
      claimOffer(`sim_${provider.id}_${Date.now()}`, 600);
      modal.classList.add('hidden');
    });
  }
  modal.classList.remove('hidden');
}


document.getElementById('closeWallModal').addEventListener('click', () => {
  document.getElementById('wallModal').classList.add('hidden');
});

function startOffer(offer) {
  window.open(offer.url, '_blank', 'noopener');
  showToast('Abriendo oferta... acreditando recompensa');
  setTimeout(() => claimOffer(offer.id, offer.rewardCoins), 1200);
}

async function claimOffer(offerId, coins) {
  try {
    const res = await fetch('/api/offers/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, offerId, coins })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎉 +${data.addedCoins} monedas acreditadas`);
      loadDashboard();
    } else {
      showToast(data.error || 'No se pudo reclamar');
    }
  } catch {
    showToast('Error de conexión');
  }
}

// Referidos: copiar, compartir y canjear
document.getElementById('copyRefBtn').addEventListener('click', async () => {
  const input = document.getElementById('refLinkInput');
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Enlace de invitación copiado');
  } catch {
    input.select();
    document.execCommand('copy');
    showToast('Enlace copiado');
  }
});

document.getElementById('shareRefBtn').addEventListener('click', () => {
  const link = document.getElementById('refLinkInput').value;
  const text = `¡Gana dinero instalando juegos y apps en CashPlay! Usa mi enlace y recibe +250 monedas gratis: ${link}`;
  if (navigator.share) {
    navigator.share({ title: 'CashPlay Rewards', text, url: link }).catch(() => {});
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
});

document.getElementById('applyRefBtn').addEventListener('click', async () => {
  const code = document.getElementById('manualRefInput').value.trim();
  if (!code) return;
  try {
    const res = await fetch('/api/referral/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, code })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎁 +${data.bonus} monedas de bienvenida acreditadas`);
      loadDashboard();
    } else {
      showToast(data.error || 'Código inválido');
    }
  } catch {
    showToast('Error al aplicar código');
  }
});

// Retiros
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('withdrawCoins').value = btn.dataset.coins;
  });
});

document.getElementById('withdrawForm').addEventListener('submit', async e => {
  e.preventDefault();
  const method = document.getElementById('payMethod').value;
  const account = document.getElementById('payAccount').value;
  const coins = Number(document.getElementById('withdrawCoins').value);

  try {
    const res = await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, method, account, coins })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Solicitud de retiro enviada');
      document.getElementById('payAccount').value = '';
      loadDashboard();
    } else {
      showToast(data.error || 'Error al retirar');
    }
  } catch {
    showToast('Error de red al procesar retiro');
  }
});

document.getElementById('switchUserBtn').addEventListener('click', () => {
  const newId = document.getElementById('customUserIdInput').value.trim();
  if (!newId) return;
  currentUserId = newId;
  localStorage.setItem('cp_user_id', currentUserId);
  showToast(`Sesión cambiada a ${currentUserId}`);
  loadDashboard();
});

// PWA Service Worker & Install
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});

loadDashboard();
