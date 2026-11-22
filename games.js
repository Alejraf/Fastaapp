// CashPlay Arcade + Playtime Chest v3.0
// Incluye:
// - Cofre de Tiempo Activo escalonado (1º baú en 30s, 2º en 90s, siguientes en 180s -> +5 monedas al abrir con anuncio Monetag, máx. 6/día)
// - Multiplicador x2 voluntario al subir de nivel (+6 monedas vs +3 monedas, respetando el tope diario de 10 cupos)
// - 3 juegos clásicos legales: 2048 Fusion, Memory Match, Neon Serpent

(function () {
  const DAILY_LEVEL_LIMIT = 10;
  const LEVEL_REWARD_COINS = 3;
  const CHEST_REWARD_COINS = 5;
  const CHEST_DAILY_LIMIT = 6;
  const AD_WAIT_SECONDS = 5;

  let activeSeconds = 0;
  let lastActionTs = 0;

  function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getChestTargetSeconds() {
    const used = getChestClaims();
    if (used === 0) return 30;  // 1º cofre del día en 30s para enganchar rápido
    if (used === 1) return 90;  // 2º cofre en 90s
    return 180;                 // 3º al 6º cofre en 180s
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

  // Registra actividad real del jugador (solo suma tiempo mientras juega de verdad)
  function registerGameActivity() {
    const now = Date.now();
    const target = getChestTargetSeconds();
    if (lastActionTs > 0) {
      const delta = Math.min(8, (now - lastActionTs) / 1000);
      if (delta > 0.2 && activeSeconds < target) {
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
    const used = getDailyClaims();
    const remainingSlots = DAILY_LEVEL_LIMIT - used;
    const canClaim = remainingSlots > 0;
    const canDouble = remainingSlots >= 2;

    let overlay = document.getElementById('cp-levelup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cp-levelup-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,13,26,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div style="background:#131b31;border:1px solid #263356;border-radius:16px;max-width:360px;width:100%;padding:20px;color:#fff;text-align:center;font-family:inherit;">
        <div style="font-size:34px;margin-bottom:6px;">🏆</div>
        <h3 style="margin:0 0 6px;font-size:19px;">Nível ${levelReached} Concluído!</h3>
        <p style="margin:0 0 14px;font-size:13px;color:#9fb0d6;">${gameName}</p>
        ${
          canClaim
            ? `
              ${
                canDouble
                  ? `<button id="cp-claim-x2-btn" style="width:100%;padding:13px;border:none;border-radius:10px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0b1120;font-weight:800;font-size:14px;cursor:pointer;margin-bottom:9px;">
                      🔥 Duplicar para +${LEVEL_REWARD_COINS * 2} Moedas (Ver Patrocinador)
                     </button>`
                  : ''
              }
              <button id="cp-claim-level-btn" style="width:100%;padding:11px;border:none;border-radius:10px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:10px;">
                🎬 Coletar +${LEVEL_REWARD_COINS} Moedas (Ver Anúncio)
              </button>`
            : `<div style="padding:10px;border-radius:10px;background:#1e293b;color:#94a3b8;font-size:12px;margin-bottom:10px;">
                Limite diário de ${DAILY_LEVEL_LIMIT} bônus atingido. Continue jogando livremente!
               </div>`
        }
        <button id="cp-skip-level-btn" style="width:100%;padding:9px;border:1px solid #334155;border-radius:10px;background:transparent;color:#94a3b8;font-size:12px;cursor:pointer;">
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
    // 1. Verificar recompensa de subida de nivel (x1 o x2)
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

    // 2. Verificar recompensa de Cofre de Tiempo Activo
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

  // JUEGO 1: 2048 FUSION
  function mount2048(container) {
    let grid = Array(16).fill(0);
    let score = 0;
    let level = 1;
    const targets = [64, 128, 256, 512, 1024, 2048];

    function addTile() {
      const empty = grid.map((v, i) => (v === 0 ? i : -1)).filter((i) => i !== -1);
      if (!empty.length) return;
      const idx = empty[Math.floor(Math.random() * empty.length)];
      grid[idx] = Math.random() < 0.9 ? 2 : 4;
    }

    function slide(row) {
      const arr = row.filter((v) => v);
      for (let i = 0; i < arr.length - 1; i++) {
        if (arr[i] === arr[i + 1]) {
          arr[i] *= 2;
          score += arr[i];
          arr[i + 1] = 0;
        }
      }
      const clean = arr.filter((v) => v);
      while (clean.length < 4) clean.push(0);
      return clean;
    }

    function move(dir) {
      registerGameActivity();
      const prev = grid.join(',');
      for (let r = 0; r < 4; r++) {
        let line = [];
        for (let c = 0; c < 4; c++) {
          const idx = dir === 'L' || dir === 'R' ? r * 4 + c : c * 4 + r;
          line.push(grid[idx]);
        }
        if (dir === 'R' || dir === 'D') line.reverse();
        line = slide(line);
        if (dir === 'R' || dir === 'D') line.reverse();
        for (let c = 0; c < 4; c++) {
          const idx = dir === 'L' || dir === 'R' ? r * 4 + c : c * 4 + r;
          grid[idx] = line[c];
        }
      }
      if (prev !== grid.join(',')) {
        addTile();
        render();
        const maxTile = Math.max(...grid);
        const goal = targets[Math.min(level - 1, targets.length - 1)];
        if (maxTile >= goal) {
          const completed = level;
          level++;
          showLevelUpModal('2048 Fusion', completed, render);
        }
      }
    }

    function render() {
      const goal = targets[Math.min(level - 1, targets.length - 1)];
      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:13px;">
          <span><strong>Nível ${level}</strong> (Meta: bloco ${goal})</span>
          <span>Pontos: <strong>${score}</strong></span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#0f172a;padding:10px;border-radius:12px;">
          ${grid
            .map(
              (v) => `
            <div style="aspect-ratio:1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;background:${
              v ? '#1e3a8a' : '#1e293b'
            };color:${v ? '#fff' : 'transparent'};">
              ${v || 0}
            </div>`
            )
            .join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:190px;margin:12px auto 0;">
          <div></div><button data-d="U" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">▲</button><div></div>
          <button data-d="L" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">◀</button>
          <button data-d="D" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">▼</button>
          <button data-d="R" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">▶</button>
        </div>
      `;
      container.querySelectorAll('button[data-d]').forEach((b) => {
        b.onclick = () => move(b.dataset.d);
      });
    }

    addTile();
    addTile();
    render();
  }

  // JUEGO 2: MEMORY MATCH
  function mountMemory(container) {
    const icons = ['💎', '🚀', '⚡', '🎯', '🍀', '🔥', '👑', '🎲'];
    let level = 1;
    let cards = [];
    let flipped = [];
    let matched = [];
    let lock = false;

    function startLevel() {
      const pairs = Math.min(4 + level, 8);
      const selected = icons.slice(0, pairs);
      cards = [...selected, ...selected].sort(() => Math.random() - 0.5);
      flipped = [];
      matched = [];
      lock = false;
      render();
    }

    function flipCard(idx) {
      registerGameActivity();
      if (lock || flipped.includes(idx) || matched.includes(idx)) return;
      flipped.push(idx);
      render();
      if (flipped.length === 2) {
        lock = true;
        const [a, b] = flipped;
        if (cards[a] === cards[b]) {
          matched.push(a, b);
          flipped = [];
          lock = false;
          render();
          if (matched.length === cards.length) {
            const completed = level;
            level++;
            setTimeout(() => showLevelUpModal('Memory Match', completed, startLevel), 250);
          }
        } else {
          setTimeout(() => {
            flipped = [];
            lock = false;
            render();
          }, 650);
        }
      }
    }

    function render() {
      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;font-size:13px;">
          <span><strong>Nível ${level}</strong></span>
          <span>Pares: <strong>${matched.length / 2}/${cards.length / 2}</strong></span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
          ${cards
            .map((ic, i) => {
              const open = flipped.includes(i) || matched.includes(i);
              return `<button data-i="${i}" style="aspect-ratio:1;border-radius:10px;border:1px solid #334155;background:${
                open ? '#1d4ed8' : '#1e293b'
              };font-size:24px;cursor:pointer;">${open ? ic : '❓'}</button>`;
            })
            .join('')}
        </div>
      `;
      container.querySelectorAll('button[data-i]').forEach((b) => {
        b.onclick = () => flipCard(Number(b.dataset.i));
      });
    }

    startLevel();
  }

  // JUEGO 3: NEON SERPENT
  let serpentTimer = null;
  function mountSerpent(container) {
    if (serpentTimer) clearInterval(serpentTimer);
    const size = 14;
    let snake = [{ x: 7, y: 7 }];
    let dir = { x: 1, y: 0 };
    let food = { x: 10, y: 7 };
    let eaten = 0;
    let level = 1;
    const goalPerLevel = 5;

    function placeFood() {
      food = {
        x: Math.floor(Math.random() * size),
        y: Math.floor(Math.random() * size)
      };
    }

    function step() {
      const head = {
        x: (snake[0].x + dir.x + size) % size,
        y: (snake[0].y + dir.y + size) % size
      };
      if (snake.some((s) => s.x === head.x && s.y === head.y)) {
        snake = [{ x: 7, y: 7 }];
        eaten = 0;
        render();
        return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        eaten++;
        placeFood();
        if (eaten >= goalPerLevel) {
          eaten = 0;
          const completed = level;
          level++;
          clearInterval(serpentTimer);
          showLevelUpModal('Neon Serpent', completed, () => {
            serpentTimer = setInterval(step, 220);
            render();
          });
          return;
        }
      } else {
        snake.pop();
      }
      render();
    }

    function render() {
      if (!document.getElementById('cp-serpent-grid')) {
        container.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
            <span id="cp-serp-lvl"></span>
            <span id="cp-serp-pts"></span>
          </div>
          <div id="cp-serpent-grid" style="display:grid;grid-template-columns:repeat(${size},1fr);gap:2px;background:#0f172a;padding:8px;border-radius:12px;"></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:190px;margin:10px auto 0;">
            <div></div><button data-sd="U" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">▲</button><div></div>
            <button data-sd="L" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">◀</button>
            <button data-sd="D" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">▼</button>
            <button data-sd="R" style="padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;">▶</button>
          </div>
        `;
        container.querySelectorAll('button[data-sd]').forEach((b) => {
          b.onclick = () => {
            registerGameActivity();
            const d = b.dataset.sd;
            if (d === 'U' && dir.y !== 1) dir = { x: 0, y: -1 };
            if (d === 'D' && dir.y !== -1) dir = { x: 0, y: 1 };
            if (d === 'L' && dir.x !== 1) dir = { x: -1, y: 0 };
            if (d === 'R' && dir.x !== -1) dir = { x: 1, y: 0 };
          };
        });
      }
      document.getElementById('cp-serp-lvl').innerHTML = `<strong>Nível ${level}</strong>`;
      document.getElementById('cp-serp-pts').innerHTML = `Energia: <strong>${eaten}/${goalPerLevel}</strong>`;
      const gridEl = document.getElementById('cp-serpent-grid');
      let cells = '';
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const isSnake = snake.some((s) => s.x === x && s.y === y);
          const isFood = food.x === x && food.y === y;
          cells += `<div style="aspect-ratio:1;border-radius:3px;background:${
            isSnake ? '#22c55e' : isFood ? '#f59e0b' : '#1e293b'
          };"></div>`;
        }
      }
      gridEl.innerHTML = cells;
    }

    render();
    serpentTimer = setInterval(step, 220);
  }

  window.initCashPlayArcade = function (rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;

    root.innerHTML = `
      <div style="background:#131c31;border:1px solid #253354;border-radius:16px;padding:16px;margin-bottom:18px;">
        <!-- COFRE DE TIEMPO ACTIVO ESCALONADO -->
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="flex:1;">
            <div id="cp-chest-txt" style="font-size:12px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">⏳ Baú #1: jogue 30s</div>
            <div style="height:6px;background:#1e293b;border-radius:999px;overflow:hidden;">
              <div id="cp-chest-bar" style="height:100%;width:0%;background:#10b981;transition:width 0.3s;"></div>
            </div>
          </div>
          <button id="cp-chest-btn" disabled style="padding:8px 12px;border:none;border-radius:8px;background:#1e293b;color:#fff;font-size:12px;font-weight:800;cursor:pointer;">0%</button>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <div>
            <h3 style="margin:0;font-size:16px;">🕹️ CashPlay Arcade (Suba de Nível)</h3>
            <p id="cp-games-quota" style="margin:4px 0 0;font-size:12px;color:#38bdf8;"></p>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="cp-tab-game" data-g="2048" style="padding:7px 11px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">2048</button>
            <button class="cp-tab-game" data-g="memory" style="padding:7px 11px;border-radius:8px;border:none;background:#1e293b;color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;">Memory</button>
            <button class="cp-tab-game" data-g="serpent" style="padding:7px 11px;border-radius:8px;border:none;background:#1e293b;color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;">Serpent</button>
          </div>
        </div>
        <div id="cp-arcade-stage"></div>
      </div>
    `;

    updateQuotaBadge();
    updateChestUI();

    document.getElementById('cp-chest-btn').onclick = () => {
      if (activeSeconds < getChestTargetSeconds() || getChestClaims() >= CHEST_DAILY_LIMIT) return;
      const directLink = window.MONETAG_DIRECT_LINK || 'https://uplcm.com/4/12319298';
      localStorage.setItem('cp_pending_chest_reward', JSON.stringify({ openedAt: Date.now() }));
      window.open(directLink, '_blank', 'noopener');
    };

    const stage = document.getElementById('cp-arcade-stage');
    const btns = root.querySelectorAll('.cp-tab-game');

    function selectGame(name) {
      if (serpentTimer) clearInterval(serpentTimer);
      btns.forEach((b) => {
        const active = b.dataset.g === name;
        b.style.background = active ? '#2563eb' : '#1e293b';
        b.style.color = active ? '#fff' : '#cbd5e1';
      });
      if (name === '2048') mount2048(stage);
      if (name === 'memory') mountMemory(stage);
      if (name === 'serpent') mountSerpent(stage);
    }

    btns.forEach((b) => (b.onclick = () => selectGame(b.dataset.g)));
    selectGame('2048');
  };
})();
