// CashPlay Arcade Neon 6-in-1 + Playtime Chest v4.0
// Incluye:
// - Cofre de Tiempo Activo escalonado (1º baú en 30s, 2º en 90s, siguientes en 180s -> +5 monedas al abrir con anuncio Monetag, máx. 6/día)
// - Multiplicador x2 voluntario al subir de nivel (+6 monedas vs +3 monedas, respetando el tope diario de 10 cupos)
// - 6 Minijuegos Neon Canvas 2D con Audio Sintetizado + Vibración Háptica + Partículas:
//   1. Knife Hit Neon (Lanzamiento de cuchillos al núcleo giratorio)
//   2. Plinko Arcade (Esferas rebotando entre pines luminosos hacia multiplicadores)
//   3. Stack Tower Neon (Apilar bloques con cortes milimétricos y combos)
//   4. Helix Smash (Caída libre rompiendo anillos de color)
//   5. Gem Slasher (Cortar gemas en el aire con estela neón y esquivar bombas)
//   6. Gravity Dash (Invertir gravedad al toque esquivando barreras láser)

(function () {
  const DAILY_LEVEL_LIMIT = 10;
  const LEVEL_REWARD_COINS = 3;
  const CHEST_REWARD_COINS = 5;
  const CHEST_DAILY_LIMIT = 6;
  const AD_WAIT_SECONDS = 5;

  let activeSeconds = 0;
  let lastActionTs = 0;
  let activeLoopId = null;
  let soundEnabled = true;
  let audioCtx = null;

  // --- SINTETIZADOR DE SONIDO WEB AUDIO (Cero archivos MP3 externos) ---
  function playTone(freq, type, duration, vol) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(vol || 0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (duration || 0.12));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (duration || 0.12));
    } catch (e) {}
  }

  function vibrate(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  }

  function stopCurrentLoop() {
    if (activeLoopId) {
      cancelAnimationFrame(activeLoopId);
      clearInterval(activeLoopId);
      activeLoopId = null;
    }
  }

  function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getChestTargetSeconds() {
    const used = getChestClaims();
    if (used === 0) return 30;
    if (used === 1) return 90;
    return 180;
  }

  function getDailyClaims() {
    try {
      const raw = JSON.parse(localStorage.getItem('cp_game_claims') || '{}');
      if (raw.date !== getTodayKey()) return 0;
      return Number(raw.count || 0);
    } catch {
      return 0;
    }
  }

  function incrementDailyClaims(slots) {
    const count = Math.min(DAILY_LEVEL_LIMIT, getDailyClaims() + Number(slots || 1));
    localStorage.setItem('cp_game_claims', JSON.stringify({ date: getTodayKey(), count }));
    updateQuotaBadge();
    return count;
  }

  function getChestClaims() {
    try {
      const raw = JSON.parse(localStorage.getItem('cp_chest_claims') || '{}');
      if (raw.date !== getTodayKey()) return 0;
      return Number(raw.count || 0);
    } catch {
      return 0;
    }
  }

  function incrementChestClaims() {
    const count = getChestClaims() + 1;
    localStorage.setItem('cp_chest_claims', JSON.stringify({ date: getTodayKey(), count }));
    updateChestUI();
  }

  function registerGameActivity() {
    const now = Date.now();
    const target = getChestTargetSeconds();
    if (lastActionTs > 0) {
      const delta = Math.min(8, (now - lastActionTs) / 1000);
      if (delta > 0.15 && activeSeconds < target) {
        activeSeconds = Math.min(target, activeSeconds + delta);
        updateChestUI();
      }
    }
    lastActionTs = now;
  }

  function updateChestUI() {
    const bar = document.getElementById('cp-chest-bar');
    const txt = document.getElementById('cp-chest-txt');
    const btn = document.getElementById('cp-chest-btn');
    if (!bar || !txt || !btn) return;

    const used = getChestClaims();
    const target = getChestTargetSeconds();
    const pct = Math.min(100, Math.round((activeSeconds / target) * 100));
    bar.style.width = pct + '%';

    if (used >= CHEST_DAILY_LIMIT) {
      txt.textContent = `Baús de hoje concluídos (${used}/${CHEST_DAILY_LIMIT})`;
      btn.disabled = true;
      btn.textContent = 'Limite diário';
    } else if (activeSeconds >= target) {
      txt.textContent = `🎁 Baú #${used + 1} pronto! (${used}/${CHEST_DAILY_LIMIT} hoje)`;
      btn.disabled = false;
      btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
      btn.textContent = `Abrir (+${CHEST_REWARD_COINS} 🪙)`;
    } else {
      const rem = Math.ceil(target - activeSeconds);
      txt.textContent = `⏳ Baú #${used + 1}: jogue mais ${rem}s (${used}/${CHEST_DAILY_LIMIT})`;
      btn.disabled = true;
      btn.style.background = '#1e293b';
      btn.textContent = `${pct}%`;
    }
  }

  function updateQuotaBadge() {
    const el = document.getElementById('cp-games-quota');
    if (el) {
      const used = getDailyClaims();
      el.textContent = `${used}/${DAILY_LEVEL_LIMIT} bônus de nível usados hoje (até +${LEVEL_REWARD_COINS * 2} moedas/nível)`;
    }
  }

  function triggerAdForLevel(gameName, levelReached, multiplier, activeBtn) {
    const directLink = window.MONETAG_DIRECT_LINK || 'https://uplcm.com/4/12319298';
    localStorage.setItem(
      'cp_pending_game_reward',
      JSON.stringify({
        type: 'level',
        game: gameName,
        level: levelReached,
        multiplier: multiplier,
        openedAt: Date.now()
      })
    );
    window.open(directLink, '_blank', 'noopener');
    if (activeBtn) {
      activeBtn.disabled = true;
      activeBtn.textContent = '⏳ Aguardando confirmação (5s)...';
    }
  }

  function showLevelUpModal(gameName, levelReached, onContinue) {
    playTone(587.33, 'triangle', 0.14, 0.12);
    setTimeout(() => playTone(880, 'triangle', 0.25, 0.14), 110);
    vibrate([40, 30, 60]);

    const used = getDailyClaims();
    const remainingSlots = DAILY_LEVEL_LIMIT - used;
    const canClaim = remainingSlots > 0;
    const canDouble = remainingSlots >= 2;

    let overlay = document.getElementById('cp-levelup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cp-levelup-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,10,22,0.9);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div style="background:linear-gradient(160deg,#131c33,#0c1324);border:1px solid #334155;border-radius:18px;max-width:360px;width:100%;padding:22px;color:#fff;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.65);">
        <div style="font-size:40px;margin-bottom:6px;">🏆</div>
        <h3 style="margin:0 0 4px;font-size:20px;font-weight:900;color:#38bdf8;">Nível ${levelReached} Concluído!</h3>
        <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">${gameName}</p>
        ${
          canClaim
            ? `
              ${
                canDouble
                  ? `<button id="cp-claim-x2-btn" style="width:100%;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0b1120;font-weight:900;font-size:14px;cursor:pointer;margin-bottom:9px;box-shadow:0 4px 16px rgba(245,158,11,0.35);">
                      🔥 Duplicar para +${LEVEL_REWARD_COINS * 2} Moedas (Ver Patrocinador)
                     </button>`
                  : ''
              }
              <button id="cp-claim-level-btn" style="width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-weight:800;font-size:13px;cursor:pointer;margin-bottom:10px;">
                🎬 Coletar +${LEVEL_REWARD_COINS} Moedas (Ver Anúncio)
              </button>`
            : `<div style="padding:10px;border-radius:10px;background:#1e293b;color:#94a3b8;font-size:12px;margin-bottom:10px;">
                Limite diário de ${DAILY_LEVEL_LIMIT} bônus atingido. Continue jogando livremente!
               </div>`
        }
        <button id="cp-skip-level-btn" style="width:100%;padding:10px;border:1px solid #334155;border-radius:12px;background:transparent;color:#94a3b8;font-size:12px;font-weight:700;cursor:pointer;">
          Continuar sem bônus
        </button>
      </div>
    `;
    overlay.style.display = 'flex';

    document.getElementById('cp-skip-level-btn').onclick = () => {
      overlay.style.display = 'none';
      if (onContinue) onContinue();
    };

    const claimX2Btn = document.getElementById('cp-claim-x2-btn');
    if (claimX2Btn) {
      claimX2Btn.onclick = () => triggerAdForLevel(gameName, levelReached, 2, claimX2Btn);
    }

    const claimBtn = document.getElementById('cp-claim-level-btn');
    if (claimBtn) {
      claimBtn.onclick = () => triggerAdForLevel(gameName, levelReached, 1, claimBtn);
    }
  }

  async function checkPendingArcadeRewards() {
    const rawLevel = localStorage.getItem('cp_pending_game_reward');
    if (rawLevel) {
      try {
        const data = JSON.parse(rawLevel);
        if ((Date.now() - Number(data.openedAt || 0)) / 1000 >= AD_WAIT_SECONDS) {
          localStorage.removeItem('cp_pending_game_reward');
          const userId = localStorage.getItem('cashplay_uid');
          if (userId && getDailyClaims() < DAILY_LEVEL_LIMIT) {
            const mult = Number(data.multiplier) === 2 ? 2 : 1;
            const res = await fetch('/api/game-reward', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, game: data.game, level: data.level, multiplier: mult })
            });
            const json = await res.json();
            if (json && json.ok) {
              incrementDailyClaims(json.slotsUsed || mult);
              if (typeof window.updateBalanceUI === 'function') window.updateBalanceUI(json.balance);
              const overlay = document.getElementById('cp-levelup-overlay');
              if (overlay) overlay.style.display = 'none';
              alert(`+${json.reward} moedas creditadas com sucesso!`);
            }
          }
        }
      } catch (e) {}
    }

    const rawChest = localStorage.getItem('cp_pending_chest_reward');
    if (rawChest) {
      try {
        const data = JSON.parse(rawChest);
        if ((Date.now() - Number(data.openedAt || 0)) / 1000 >= AD_WAIT_SECONDS) {
          localStorage.removeItem('cp_pending_chest_reward');
          const userId = localStorage.getItem('cashplay_uid');
          if (userId && getChestClaims() < CHEST_DAILY_LIMIT) {
            const res = await fetch('/api/playtime-chest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId })
            });
            const json = await res.json();
            if (json && json.ok) {
              activeSeconds = 0;
              lastActionTs = 0;
              incrementChestClaims();
              if (typeof window.updateBalanceUI === 'function') window.updateBalanceUI(json.balance);
              alert(`🎁 Baú aberto! +${CHEST_REWARD_COINS} moedas creditadas!`);
            }
          }
        }
      } catch (e) {}
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkPendingArcadeRewards();
    }
  });

  // Helper para crear Canvas responsivo con soporte Retina/DPR
  function setupCanvas(container, heightPx) {
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    const width = Math.min(460, container.clientWidth || 340);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = heightPx * dpr;
    canvas.style.width = '100%';
    canvas.style.height = heightPx + 'px';
    canvas.style.borderRadius = '14px';
    canvas.style.background = '#070b16';
    canvas.style.border = '1px solid #1e293b';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas, ctx, w: width, h: heightPx };
  }

  // =========================================================================
  // JUEGO 1: KNIFE HIT NEON
  // =========================================================================
  function mountKnifeHit(container) {
    stopCurrentLoop();
    const { canvas, ctx, w, h } = setupCanvas(container, 360);
    let level = 1;
    let stuckAngles = [];
    let flyingKnife = null;
    let targetAngle = 0;
    let knivesLeft = 6;
    let particles = [];
    let shake = 0;
    let paused = false;

    function initLevel() {
      knivesLeft = Math.min(11, 5 + level);
      stuckAngles = [];
      const preStuck = Math.min(3, Math.floor(level / 2));
      for (let i = 0; i < preStuck; i++) {
        stuckAngles.push((Math.PI * 2 * i) / preStuck);
      }
      flyingKnife = null;
      paused = false;
    }

    function spawnParticles(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 5;
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color });
      }
    }

    function throwKnife() {
      registerGameActivity();
      if (paused || flyingKnife || knivesLeft <= 0) return;
      flyingKnife = { y: h - 55 };
      playTone(420, 'sine', 0.08, 0.08);
    }

    canvas.onpointerdown = (e) => {
      e.preventDefault();
      throwKnife();
    };

    const cx = w / 2;
    const cy = 125;
    const radius = 50;

    function loop(ts) {
      if (!document.body.contains(canvas)) return;
      ctx.save();
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        shake *= 0.85;
      }

      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, w, h);

      // Rotación dinámica con cambio de ritmo según nivel
      const speed = (0.032 + level * 0.004) * (level % 3 === 0 ? Math.sin(ts * 0.002) * 1.4 : 1);
      if (!paused) targetAngle += speed;

      // Actualizar cuchillo en vuelo
      if (flyingKnife && !paused) {
        flyingKnife.y -= 24;
        if (flyingKnife.y <= cy + radius + 12) {
          const hitAngle = (Math.PI / 2 - targetAngle) % (Math.PI * 2);
          const normHit = (hitAngle + Math.PI * 2) % (Math.PI * 2);
          const collision = stuckAngles.some((a) => {
            const diff = Math.abs(((a - normHit + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            return diff < 0.24;
          });

          if (collision) {
            playTone(130, 'sawtooth', 0.25, 0.15);
            vibrate(120);
            shake = 12;
            spawnParticles(cx, cy + radius, '#ef4444', 22);
            flyingKnife = null;
            initLevel();
          } else {
            stuckAngles.push(normHit);
            knivesLeft--;
            flyingKnife = null;
            shake = 6;
            playTone(680, 'triangle', 0.09, 0.1);
            vibrate(25);
            spawnParticles(cx, cy + radius, '#38bdf8', 12);

            if (knivesLeft <= 0) {
              paused = true;
              spawnParticles(cx, cy, '#f59e0b', 35);
              const completed = level;
              level++;
              setTimeout(() => showLevelUpModal('Knife Hit Neon', completed, initLevel), 280);
            }
          }
        }
      }

      // Dibujar cuchillos clavados
      stuckAngles.forEach((a) => {
        const ang = a + targetAngle;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-3, radius - 4, 6, 36);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-5, radius + 24, 10, 12);
        ctx.restore();
      });

      // Dibujar núcleo neón
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(targetAngle);
      const grad = ctx.createRadialGradient(0, 0, 8, 0, 0, radius);
      grad.addColorStop(0, '#38bdf8');
      grad.addColorStop(0.6, '#1d4ed8');
      grad.addColorStop(1, '#0f172a');
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#60a5fa';
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = '800 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`NV ${level}`, 0, 0);
      ctx.restore();

      // Cuchillo listo o volando
      const ky = flyingKnife ? flyingKnife.y : h - 55;
      if (knivesLeft > 0 || flyingKnife) {
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(cx, ky - 22);
        ctx.lineTo(cx + 5, ky + 6);
        ctx.lineTo(cx - 5, ky + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(cx - 5, ky + 6, 10, 14);
      }

      // Indicador de cuchillos restantes
      for (let i = 0; i < knivesLeft; i++) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(16, h - 22 - i * 11, 18, 5);
      }

      // Partículas
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 4, 4);
      });
      ctx.globalAlpha = 1;
      particles = particles.filter((p) => p.life > 0);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Toque na tela para lançar a lâmina', cx, h - 12);

      ctx.restore();
      activeLoopId = requestAnimationFrame(loop);
    }

    initLevel();
    activeLoopId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // JUEGO 2: PLINKO ARCADE
  // =========================================================================
  function mountPlinko(container) {
    stopCurrentLoop();
    const { canvas, ctx, w, h } = setupCanvas(container, 360);
    let level = 1;
    let points = 0;
    let targetPoints = 150;
    let balls = [];
    let pins = [];
    const multipliers = [10, 25, 50, 100, 50, 25, 10];
    let paused = false;

    const rows = 7;
    const startY = 68;
    const spacingY = 34;
    const spacingX = Math.min(42, (w - 40) / 8);

    for (let r = 0; r < rows; r++) {
      const cols = r + 3;
      const rowWidth = (cols - 1) * spacingX;
      for (let c = 0; c < cols; c++) {
        pins.push({
          x: w / 2 - rowWidth / 2 + c * spacingX,
          y: startY + r * spacingY,
          glow: 0
        });
      }
    }

    function dropBall(clientX) {
      registerGameActivity();
      if (paused || balls.length >= 6) return;
      const rect = canvas.getBoundingClientRect();
      const relX = clientX ? clientX - rect.left : w / 2;
      const clampedX = Math.max(w * 0.25, Math.min(w * 0.75, relX)) + (Math.random() - 0.5) * 8;
      balls.push({ x: clampedX, y: 26, vx: (Math.random() - 0.5) * 1.5, vy: 1, r: 6 });
      playTone(520, 'sine', 0.06, 0.07);
    }

    canvas.onpointerdown = (e) => {
      e.preventDefault();
      dropBall(e.clientX);
    };

    function loop() {
      if (!document.body.contains(canvas)) return;
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, w, h);

      // HUD superior
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Nível ${level}`, 14, 24);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`Meta: ${points} / ${targetPoints} pts`, w - 14, 24);

      // Dibujar pines
      pins.forEach((p) => {
        if (p.glow > 0) p.glow -= 0.06;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.glow > 0 ? 5.5 : 3.8, 0, Math.PI * 2);
        ctx.fillStyle = p.glow > 0 ? '#38bdf8' : '#475569';
        ctx.fill();
      });

      // Ranuras inferiores
      const slotW = (w - 24) / multipliers.length;
      const slotY = h - 42;
      multipliers.forEach((val, i) => {
        const sx = 12 + i * slotW;
        const isJackpot = val === 100;
        ctx.fillStyle = isJackpot ? 'rgba(245,158,11,0.28)' : val >= 50 ? 'rgba(16,185,129,0.22)' : 'rgba(37,99,235,0.2)';
        ctx.fillRect(sx + 2, slotY, slotW - 4, 28);
        ctx.strokeStyle = isJackpot ? '#f59e0b' : '#334155';
        ctx.strokeRect(sx + 2, slotY, slotW - 4, 28);
        ctx.fillStyle = isJackpot ? '#fbbf24' : '#e2e8f0';
        ctx.font = '800 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`+${val}`, sx + slotW / 2, slotY + 18);
      });

      // Actualizar bolas
      balls.forEach((b) => {
        b.vy += 0.24;
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < 18) { b.x = 18; b.vx *= -0.7; }
        if (b.x > w - 18) { b.x = w - 18; b.vx *= -0.7; }

        pins.forEach((p) => {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < b.r + 4.2) {
            const ang = Math.atan2(dy, dx);
            b.x = p.x + Math.cos(ang) * (b.r + 4.5);
            b.y = p.y + Math.sin(ang) * (b.r + 4.5);
            b.vx = Math.cos(ang) * 2.4 + (Math.random() - 0.5) * 1.4;
            b.vy = Math.abs(Math.sin(ang)) * 1.5;
            p.glow = 1;
            playTone(740, 'sine', 0.04, 0.04);
          }
        });

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fef3c7';
        ctx.stroke();

        if (b.y >= slotY) {
          b.done = true;
          const idx = Math.min(multipliers.length - 1, Math.max(0, Math.floor((b.x - 12) / slotW)));
          const gained = multipliers[idx];
          points += gained;
          playTone(gained >= 50 ? 880 : 600, 'triangle', 0.12, 0.09);
          vibrate(20);

          if (points >= targetPoints && !paused) {
            paused = true;
            const completed = level;
            level++;
            points = 0;
            targetPoints = 150 + (level - 1) * 60;
            setTimeout(() => {
              showLevelUpModal('Plinko Arcade', completed, () => {
                paused = false;
              });
            }, 220);
          }
        }
      });

      balls = balls.filter((b) => !b.done);
      activeLoopId = requestAnimationFrame(loop);
    }

    activeLoopId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // JUEGO 3: STACK TOWER NEON
  // =========================================================================
  function mountStackTower(container) {
    stopCurrentLoop();
    const { canvas, ctx, w, h } = setupCanvas(container, 360);
    let level = 1;
    let blocks = [];
    let current = null;
    let combo = 0;
    let paused = false;
    const blockH = 22;
    const goalBlocks = 8;

    function resetTower() {
      blocks = [{ x: w / 2 - 75, w: 150, color: '#2563eb' }];
      combo = 0;
      paused = false;
      spawnNext();
    }

    function spawnNext() {
      const prev = blocks[blocks.length - 1];
      const hue = (blocks.length * 28 + level * 40) % 360;
      current = {
        x: 10,
        w: prev.w,
        dir: 1,
        speed: 2.6 + level * 0.45 + blocks.length * 0.18,
        color: `hsl(${hue}, 85%, 56%)`
      };
    }

    function dropBlock() {
      registerGameActivity();
      if (paused || !current) return;
      const prev = blocks[blocks.length - 1];
      const delta = current.x - prev.x;

      if (Math.abs(delta) <= 6) {
        // Corte perfecto
        combo++;
        const bonusW = combo >= 3 ? Math.min(165, prev.w + 8) : prev.w;
        blocks.push({ x: prev.x, w: bonusW, color: '#10b981' });
        playTone(520 + combo * 70, 'triangle', 0.12, 0.1);
        vibrate(30);
      } else {
        combo = 0;
        const overlap = prev.w - Math.abs(delta);
        if (overlap <= 6) {
          playTone(140, 'sawtooth', 0.22, 0.14);
          vibrate(100);
          resetTower();
          return;
        }
        const newX = delta > 0 ? current.x : prev.x;
        blocks.push({ x: newX, w: overlap, color: current.color });
        playTone(440, 'sine', 0.08, 0.08);
      }

      if (blocks.length - 1 >= goalBlocks) {
        paused = true;
        current = null;
        const completed = level;
        level++;
        setTimeout(() => showLevelUpModal('Stack Tower Neon', completed, resetTower), 240);
      } else {
        spawnNext();
      }
    }

    canvas.onpointerdown = (e) => {
      e.preventDefault();
      dropBlock();
    };

    function loop() {
      if (!document.body.contains(canvas)) return;
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Nível ${level} • Torre ${blocks.length - 1}/${goalBlocks}`, 14, 24);
      if (combo > 1) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#34d399';
        ctx.fillText(`COMBO x${combo} 🔥`, w - 14, 24);
      }

      const baseLine = h - 36;
      blocks.forEach((b, idx) => {
        const y = baseLine - idx * (blockH + 3);
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, y, b.w, blockH);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(b.x, y, b.w, blockH);
      });

      if (current && !paused) {
        current.x += current.dir * current.speed;
        if (current.x + current.w >= w - 8) { current.x = w - 8 - current.w; current.dir = -1; }
        if (current.x <= 8) { current.x = 8; current.dir = 1; }
        const cy = baseLine - blocks.length * (blockH + 3);
        ctx.fillStyle = current.color;
        ctx.fillRect(current.x, cy, current.w, blockH);
      }

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Toque no momento exato para empilhar', w / 2, h - 12);

      activeLoopId = requestAnimationFrame(loop);
    }

    resetTower();
    activeLoopId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // JUEGO 4: HELIX SMASH
  // =========================================================================
  function mountHelixSmash(container) {
    stopCurrentLoop();
    const { canvas, ctx, w, h } = setupCanvas(container, 360);
    let level = 1;
    let ringAngle = 0;
    let ballY = 95;
    let ballVy = 0;
    let holding = false;
    let floorsCleared = 0;
    const goalFloors = 10;
    let paused = false;

    function resetRun() {
      floorsCleared = 0;
      ballY = 95;
      ballVy = 0;
      holding = false;
      paused = false;
    }

    canvas.onpointerdown = (e) => {
      e.preventDefault();
      registerGameActivity();
      holding = true;
    };
    canvas.onpointerup = () => { holding = false; };
    canvas.onpointerleave = () => { holding = false; };

    function loop() {
      if (!document.body.contains(canvas)) return;
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Nível ${level}`, 14, 24);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`Andares: ${floorsCleared}/${goalFloors}`, w - 14, 24);

      const cx = w / 2;
      const ringY = 230;
      const ringR = 82;

      if (!paused) {
        ringAngle += 0.045 + level * 0.006;
        ballVy += holding ? 0.95 : 0.35;
        ballY += ballVy;

        if (ballY >= ringY - 12) {
          // Verificar ángulo en la parte superior del anillo (-PI/2)
          const topRel = ((-Math.PI / 2 - ringAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          const isDanger = topRel > Math.PI * 1.35;

          if (holding) {
            if (isDanger) {
              playTone(130, 'sawtooth', 0.25, 0.15);
              vibrate(120);
              resetRun();
            } else {
              floorsCleared++;
              ballY = 85;
              ballVy = 1.5;
              playTone(540 + floorsCleared * 35, 'triangle', 0.09, 0.09);
              vibrate(25);
              if (floorsCleared >= goalFloors) {
                paused = true;
                const completed = level;
                level++;
                setTimeout(() => showLevelUpModal('Helix Smash', completed, resetRun), 220);
              }
            }
          } else {
            ballY = ringY - 12;
            ballVy = -7.2;
            playTone(320, 'sine', 0.05, 0.05);
          }
        }
      }

      // Dibujar anillo giratorio (zona segura azul / zona roja prohibida)
      ctx.save();
      ctx.translate(cx, ringY);
      ctx.rotate(ringAngle);
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 1.35);
      ctx.strokeStyle = holding ? '#f59e0b' : '#2563eb';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, ringR, Math.PI * 1.35, Math.PI * 2);
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();
      ctx.restore();

      // Dibujar esfera con estela de fuego si mantiene presionado
      ctx.beginPath();
      ctx.arc(cx, ballY, 12, 0, Math.PI * 2);
      ctx.fillStyle = holding ? '#f59e0b' : '#38bdf8';
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Segure o dedo para quebrar na zona azul (evite o vermelho)', cx, h - 12);

      activeLoopId = requestAnimationFrame(loop);
    }

    resetRun();
    activeLoopId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // JUEGO 5: GEM SLASHER
  // =========================================================================
  function mountGemSlasher(container) {
    stopCurrentLoop();
    const { canvas, ctx, w, h } = setupCanvas(container, 360);
    let level = 1;
    let sliced = 0;
    let goal = 12;
    let items = [];
    let trail = [];
    let spawnTick = 0;
    let paused = false;

    function resetLevel() {
      sliced = 0;
      goal = 10 + level * 2;
      items = [];
      trail = [];
      paused = false;
    }

    function checkSlice(x, y) {
      registerGameActivity();
      if (paused) return;
      trail.push({ x, y, life: 1 });
      items.forEach((it) => {
        if (!it.hit && Math.hypot(it.x - x, it.y - y) < it.r + 14) {
          it.hit = true;
          if (it.bomb) {
            playTone(120, 'sawtooth', 0.25, 0.16);
            vibrate(140);
            resetLevel();
          } else {
            sliced++;
            playTone(660 + (sliced % 6) * 60, 'triangle', 0.08, 0.09);
            vibrate(20);
            if (sliced >= goal) {
              paused = true;
              const completed = level;
              level++;
              setTimeout(() => showLevelUpModal('Gem Slasher', completed, resetLevel), 220);
            }
          }
        }
      });
    }

    canvas.onpointermove = (e) => {
      if (e.buttons === 1 || e.pointerType === 'touch') {
        const r = canvas.getBoundingClientRect();
        checkSlice(e.clientX - r.left, e.clientY - r.top);
      }
    };
    canvas.onpointerdown = (e) => {
      const r = canvas.getBoundingClientRect();
      checkSlice(e.clientX - r.left, e.clientY - r.top);
    };

    function loop() {
      if (!document.body.contains(canvas)) return;
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Nível ${level}`, 14, 24);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#10b981';
      ctx.fillText(`Gemas: ${sliced}/${goal}`, w - 14, 24);

      if (!paused) {
        spawnTick++;
        if (spawnTick % Math.max(24, 46 - level * 3) === 0) {
          const isBomb = Math.random() < 0.22;
          items.push({
            x: 40 + Math.random() * (w - 80),
            y: h + 15,
            vx: (Math.random() - 0.5) * 3.2,
            vy: -(9.5 + Math.random() * 2.5),
            r: 18,
            bomb: isBomb,
            icon: isBomb ? '💣' : ['💎', '🪙', '🔮', '⚡'][Math.floor(Math.random() * 4)]
          });
        }
      }

      items.forEach((it) => {
        it.vy += 0.22;
        it.x += it.vx;
        it.y += it.vy;
        if (!it.hit) {
          ctx.font = '28px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(it.icon, it.x, it.y);
        }
      });
      items = items.filter((it) => !it.hit && it.y < h + 40);

      // Estela de corte neón
      if (trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(trail[0].x, trail[0].y);
        trail.forEach((p) => {
          ctx.lineTo(p.x, p.y);
          p.life -= 0.08;
        });
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      trail = trail.filter((p) => p.life > 0);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Deslize o dedo para cortar gemas e desviar das bombas', w / 2, h - 12);

      activeLoopId = requestAnimationFrame(loop);
    }

    resetLevel();
    activeLoopId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // JUEGO 6: GRAVITY DASH
  // =========================================================================
  function mountGravityDash(container) {
    stopCurrentLoop();
    const { canvas, ctx, w, h } = setupCanvas(container, 360);
    let level = 1;
    let playerY = h / 2;
    let gravDir = 1;
    let obstacles = [];
    let passed = 0;
    const goal = 8;
    let tick = 0;
    let paused = false;

    function resetRun() {
      playerY = h / 2;
      gravDir = 1;
      obstacles = [];
      passed = 0;
      tick = 0;
      paused = false;
    }

    canvas.onpointerdown = (e) => {
      e.preventDefault();
      registerGameActivity();
      if (paused) return;
      gravDir *= -1;
      playTone(gravDir === -1 ? 620 : 420, 'sine', 0.07, 0.08);
      vibrate(15);
    };

    function loop() {
      if (!document.body.contains(canvas)) return;
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, w, h);

      // Piso y techo neón
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 34, w, 6);
      ctx.fillRect(0, h - 34, w, 6);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Nível ${level}`, 14, 22);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`Barreiras: ${passed}/${goal}`, w - 14, 22);

      const px = 64;
      const pr = 11;

      if (!paused) {
        playerY += gravDir * (4.8 + level * 0.35);
        playerY = Math.max(40 + pr, Math.min(h - 34 - pr, playerY));

        tick++;
        if (tick % Math.max(46, 75 - level * 4) === 0) {
          const top = Math.random() < 0.5;
          const barH = 95 + Math.random() * 55;
          obstacles.push({
            x: w + 10,
            y: top ? 40 : h - 34 - barH,
            w: 18,
            h: barH,
            scored: false
          });
        }

        const speed = 3.8 + level * 0.45;
        obstacles.forEach((ob) => {
          ob.x -= speed;
          if (px + pr > ob.x && px - pr < ob.x + ob.w && playerY + pr > ob.y && playerY - pr < ob.y + ob.h) {
            playTone(130, 'sawtooth', 0.25, 0.15);
            vibrate(120);
            resetRun();
          } else if (!ob.scored && ob.x + ob.w < px) {
            ob.scored = true;
            passed++;
            playTone(720, 'triangle', 0.07, 0.07);
            if (passed >= goal) {
              paused = true;
              const completed = level;
              level++;
              setTimeout(() => showLevelUpModal('Gravity Dash', completed, resetRun), 200);
            }
          }
        });
        obstacles = obstacles.filter((ob) => ob.x + ob.w > -20);
      }

      obstacles.forEach((ob) => {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
      });

      // Jugador neón
      ctx.beginPath();
      ctx.arc(px, playerY, pr, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Toque para inverter a gravidade e desviar dos lasers', w / 2, h - 10);

      activeLoopId = requestAnimationFrame(loop);
    }

    resetRun();
    activeLoopId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // INICIALIZADOR PRINCIPAL DEL SELECTOR DE 6 JUEGOS NEÓN
  // =========================================================================
  window.initCashPlayArcade = function (rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;

    const gamesList = [
      { id: 'knife', icon: '🗡️', name: 'Knife Hit', tag: 'HOT' },
      { id: 'plinko', icon: '🟡', name: 'Plinko', tag: 'TOP' },
      { id: 'stack', icon: '🏗️', name: 'Stack Tower', tag: '3D' },
      { id: 'helix', icon: '🌀', name: 'Helix Smash', tag: 'PRO' },
      { id: 'slash', icon: '💎', name: 'Gem Slash', tag: 'NEW' },
      { id: 'gravity', icon: '⚡', name: 'Gravity', tag: 'FAST' }
    ];

    root.innerHTML = `
      <div style="background:#131c31;border:1px solid #253354;border-radius:18px;padding:15px;margin-bottom:18px;">
        <!-- COFRE DE TIEMPO ACTIVO ESCALONADO -->
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:10px 12px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="flex:1;">
            <div id="cp-chest-txt" style="font-size:12px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">⏳ Baú #1: jogue 30s</div>
            <div style="height:6px;background:#1e293b;border-radius:999px;overflow:hidden;">
              <div id="cp-chest-bar" style="height:100%;width:0%;background:#10b981;transition:width 0.3s;"></div>
            </div>
          </div>
          <button id="cp-chest-btn" disabled style="padding:8px 12px;border:none;border-radius:8px;background:#1e293b;color:#fff;font-size:12px;font-weight:800;cursor:pointer;">0%</button>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:800;">🕹️ CashPlay Arcade Neon (6 Jogos)</h3>
            <p id="cp-games-quota" style="margin:3px 0 0;font-size:11.5px;color:#38bdf8;"></p>
          </div>
          <button id="cp-sound-btn" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;">🔊</button>
        </div>

        <!-- CUADRÍCULA DE 6 JUEGOS -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px;">
          ${gamesList
            .map(
              (g) => `
            <button class="cp-tab-game" data-g="${g.id}" style="position:relative;padding:9px 6px;border-radius:11px;border:1px solid #263356;background:#0f172a;color:#cbd5e1;font-size:11.5px;font-weight:800;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;">
              <span style="position:absolute;top:4px;right:5px;font-size:8px;background:rgba(56,189,248,0.18);color:#38bdf8;padding:1px 4px;border-radius:4px;">${g.tag}</span>
              <span style="font-size:19px;">${g.icon}</span>
              <span>${g.name}</span>
            </button>`
            )
            .join('')}
        </div>

        <div id="cp-arcade-stage"></div>
      </div>
    `;

    updateQuotaBadge();
    updateChestUI();

    document.getElementById('cp-sound-btn').onclick = function () {
      soundEnabled = !soundEnabled;
      this.textContent = soundEnabled ? '🔊' : '🔇';
    };

    document.getElementById('cp-chest-btn').onclick = () => {
      if (activeSeconds < getChestTargetSeconds() || getChestClaims() >= CHEST_DAILY_LIMIT) return;
      const directLink = window.MONETAG_DIRECT_LINK || 'https://uplcm.com/4/12319298';
      localStorage.setItem('cp_pending_chest_reward', JSON.stringify({ openedAt: Date.now() }));
      window.open(directLink, '_blank', 'noopener');
    };

    const stage = document.getElementById('cp-arcade-stage');
    const btns = root.querySelectorAll('.cp-tab-game');

    function selectGame(name) {
      stopCurrentLoop();
      btns.forEach((b) => {
        const active = b.dataset.g === name;
        b.style.background = active ? 'linear-gradient(135deg,#1d4ed8,#2563eb)' : '#0f172a';
        b.style.borderColor = active ? '#60a5fa' : '#263356';
        b.style.color = active ? '#fff' : '#cbd5e1';
      });
      if (name === 'knife') mountKnifeHit(stage);
      if (name === 'plinko') mountPlinko(stage);
      if (name === 'stack') mountStackTower(stage);
      if (name === 'helix') mountHelixSmash(stage);
      if (name === 'slash') mountGemSlasher(stage);
      if (name === 'gravity') mountGravityDash(stage);
    }

    btns.forEach((b) => (b.onclick = () => selectGame(b.dataset.g)));
    selectGame('knife');
  };
})();
