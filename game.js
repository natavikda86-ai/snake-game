(() => {
  'use strict';

  const STORAGE = {
    selectedSkinId: 'neonSnake_selectedSkinId',
    bestScore: 'neonSnake_bestScore',
    totalPlayTimeMs: 'neonSnake_totalPlayTimeMs',
    soundOn: 'neonSnake_soundOn',
  };

  const DOM = {
    canvas: document.getElementById('gameCanvas'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    comboPill: document.getElementById('comboPill'),
    boosterPill: document.getElementById('boosterPill'),
    exitBtn: document.getElementById('exitBtn'),
    evoFlash: document.getElementById('evoFlash'),
    evoLevelText: document.getElementById('evoLevelText'),

    menu: document.getElementById('menu'),
    skinGrid: document.getElementById('skinGrid'),
    skinPreview: document.getElementById('skinPreview'),
    skinInfo: document.getElementById('skinInfo'),
    startBtn: document.getElementById('startBtn'),
    soundToggle: document.getElementById('soundToggle'),

    gameOver: document.getElementById('gameOver'),
    finalScore: document.getElementById('finalScore'),
    finalBest: document.getElementById('finalBest'),
    restartBtn: document.getElementById('restartBtn'),
    backToMenuBtn: document.getElementById('backToMenuBtn'),
  };

  const ctx = DOM.canvas.getContext('2d', { alpha: true });
  const previewCtx = DOM.skinPreview.getContext('2d', { alpha: true });

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function wrapAngle(a) {
    // Map to [-PI, PI]
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function hexToRgb(hex) {
    const s = hex.replace('#', '').trim();
    const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbaFromHex(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  const skins = [
    {
      id: 'classic',
      name: 'Неоновая классика',
      colors: ['#00ff88', '#00f5ff', '#8a2eff'],
      glow: 18,
      trail: true,
      particles: true,
      headStyle: 'classic',
      unlockLabel: 'Доступен',
      unlockedBy: { type: 'always' },
    },
    {
      id: 'bluePulse',
      name: 'Синяя пульсация',
      colors: ['#2aa8ff', '#00f5ff', '#7a4dff'],
      glow: 21,
      trail: true,
      particles: false,
      headStyle: 'pulse',
      unlockLabel: 'Доступен',
      unlockedBy: { type: 'always' },
    },
    {
      id: 'cyber',
      name: 'Кибер-змейка',
      colors: ['#00ffd5', '#00a3ff', '#ff2bd6'],
      glow: 25,
      trail: true,
      particles: true,
      headStyle: 'cyber',
      unlockLabel: 'Разблокируется при Лучшем результате 300+',
      unlockedBy: { type: 'bestScore', value: 300 },
    },
    {
      id: 'galaxy',
      name: 'Галактика',
      colors: ['#b56cff', '#ff4fd8', '#35a7ff'],
      glow: 30,
      trail: true,
      particles: true,
      headStyle: 'galaxy',
      unlockLabel: 'Разблокируется после 3 мин игры',
      unlockedBy: { type: 'playTimeMs', value: 180000 },
    },
    {
      id: 'fire',
      name: 'Огненная змейка',
      colors: ['#ff3b3b', '#ff9f1c', '#ffd166'],
      glow: 34,
      trail: true,
      particles: true,
      headStyle: 'fire',
      unlockLabel: 'Редкий: лучший результат 600+ очков',
      unlockedBy: { type: 'bestScore', value: 600 },
    },
  ];

  function getUnlocked(skin, bestScore, totalPlayTimeMs) {
    const rule = skin.unlockedBy || { type: 'always' };
    if (rule.type === 'always') return true;
    if (rule.type === 'bestScore') return bestScore >= rule.value;
    if (rule.type === 'playTimeMs') return totalPlayTimeMs >= rule.value;
    return false;
  }

  function getEvolutionLevel(score) {
    if (score < 50) return 1;
    if (score < 150) return 2;
    if (score < 300) return 3;
    if (score < 600) return 4;
    return 5;
  }

  const state = {
    mode: 'menu', // menu | playing | gameover
    score: 0,
    bestScore: 0,
    evoLevel: 1,
    totalPlayTimeMs: 0,
    selectedSkinId: 'classic',

    // snake physics
    worldW: 800,
    worldH: 600,
    fullW: 800,
    fullH: 600,
    viewX: 0, // top-left of the playable world inside the canvas
    viewY: 0,
    padding: 18,
    segmentSpacing: 12,
    headRadius: 8.5,
    wallMargin: 10,

    snake: {
      points: [], // tail -> head
      angle: 0,
      desiredAngle: 0,
      targetLen: 0,
      pathStepAcc: 0,
    },

    foods: [],
    maxFoods: 3,
    booster: null,
    nextBoosterAt: 0,

    particles: [],
    headAfterImage: [], // extra neon streaks at higher levels

    // timers / effects
    freezeUntil: 0,
    shieldUntil: 0,
    accelUntil: 0,
    magnetUntil: 0,
    slowUntil: 0,

    ignoreChanceCooldownUntil: 0, // avoids repeated ignore triggering

    // combo
    combo: {
      count: 0,
      lastEatAt: 0,
      lastMultiplier: 1,
      comboUntil: 0,
    },

    // UI/effects
    evoFlashUntil: 0,
    scoreBumpUntil: 0,

    // time
    lastTs: 0,
    timeScale: 1,

    // sound
    soundOn: true,
    audioCtx: null,
    audioEnabled: false,
  };

  function formatScore(n) {
    const v = Math.max(0, Math.floor(n));
    return String(v).padStart(3, '0');
  }

  function loadStorage() {
    const readNumber = (key, fallback) => {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const savedSkin = localStorage.getItem(STORAGE.selectedSkinId);
    const savedBest = readNumber(STORAGE.bestScore, 0);
    const savedPlay = readNumber(STORAGE.totalPlayTimeMs, 0);
    const savedSound = localStorage.getItem(STORAGE.soundOn);
    state.bestScore = savedBest;
    state.totalPlayTimeMs = savedPlay;
    state.soundOn = savedSound == null ? true : savedSound === '1';
    state.selectedSkinId = savedSkin || 'classic';
  }

  function saveSelectedSkin() {
    try {
      localStorage.setItem(STORAGE.selectedSkinId, state.selectedSkinId);
    } catch (_) {}
  }

  function saveBestAndPlayTime() {
    try {
      localStorage.setItem(STORAGE.bestScore, String(state.bestScore));
      localStorage.setItem(STORAGE.totalPlayTimeMs, String(state.totalPlayTimeMs));
    } catch (_) {}
  }

  function resolveSelectedSkin() {
    const saved = state.selectedSkinId;
    const skin = skins.find((s) => s.id === saved) || skins[0];
    const isUnlocked = getUnlocked(skin, state.bestScore, state.totalPlayTimeMs);
    state.selectedSkinId = isUnlocked ? skin.id : 'classic';
  }

  function getSelectedSkin() {
    return skins.find((s) => s.id === state.selectedSkinId) || skins[0];
  }

  function computeSkinEffective(skin) {
    const lv = state.evoLevel;
    const glowMult = 1 + (lv - 1) * 0.08 + (lv >= 4 ? 0.06 : 0);
    const trailBoost = (skin.trail ? 1 : 0.45) * (1 + (lv - 1) * 0.07);
    const particlesBoost = skin.particles ? 1 : 0.7;
    return {
      ...skin,
      effectiveGlow: skin.glow * glowMult,
      effectiveTrail: trailBoost,
      effectiveParticles: particlesBoost * (lv >= 3 ? 1.15 : 1),
    };
  }

  function setMode(mode) {
    state.mode = mode;
    if (mode === 'menu') {
      DOM.menu.classList.remove('hidden');
      DOM.gameOver.classList.add('hidden');
      DOM.exitBtn.classList.add('hidden');
    } else if (mode === 'playing') {
      DOM.menu.classList.add('hidden');
      DOM.gameOver.classList.add('hidden');
      DOM.exitBtn.classList.remove('hidden');
    } else if (mode === 'gameover') {
      DOM.menu.classList.add('hidden');
      DOM.gameOver.classList.remove('hidden');
      DOM.exitBtn.classList.add('hidden');
    }
  }

  function resizeCanvas() {
    const rect = DOM.canvas.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    state.fullW = Math.max(320, Math.floor(rect.width));
    state.fullH = Math.max(420, Math.floor(rect.height));

    const maxWorldW = 1280;
    const maxWorldH = 1024;
    state.worldW = Math.max(240, Math.min(state.fullW, maxWorldW));
    state.worldH = Math.max(300, Math.min(state.fullH, maxWorldH));

    state.viewX = (state.fullW - state.worldW) / 2;
    state.viewY = (state.fullH - state.worldH) / 2;

    DOM.canvas.width = Math.floor(state.fullW * dpr);
    DOM.canvas.height = Math.floor(state.fullH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.segmentSpacing = clamp(Math.min(state.worldW, state.worldH) / 64, 6, 16);
    state.headRadius = clamp(state.segmentSpacing * 0.78, 5.2, 12.5);
    state.wallMargin = clamp(state.segmentSpacing * 0.85, 8, 20);
  }

  function requestAngle(angle) {
    if (state.mode !== 'playing') return;
    if (!state.snake || state.snake.points.length < 2) return;

    const curDir = { x: Math.cos(state.snake.angle), y: Math.sin(state.snake.angle) };
    const wantDir = { x: Math.cos(angle), y: Math.sin(angle) };
    const dot = curDir.x * wantDir.x + curDir.y * wantDir.y;

    // Block sharp 180 degree reversal.
    if (dot < -0.85) return;

    // Make turns feel instant for small angle differences.
    const diff = wrapAngle(angle - state.snake.angle);
    if (Math.abs(diff) < 0.16) {
      state.snake.angle = angle;
      state.snake.desiredAngle = angle;
    } else {
      state.snake.desiredAngle = angle;
    }
  }

  function angleFromInput(dx, dy) {
    // y axis is down in canvas.
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax > ay) return dx > 0 ? 0 : Math.PI;
    return dy > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  function ensureAudio() {
    if (state.audioEnabled) return;
    if (!state.soundOn) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      state.audioCtx = new AudioContext();
      state.audioEnabled = true;
    } catch (_) {}
  }

  function playTone(kind) {
    if (!state.soundOn) return;
    ensureAudio();
    if (!state.audioCtx) return;

    const t = state.audioCtx.currentTime;
    const gain = state.audioCtx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(state.audioCtx.destination);

    const osc = state.audioCtx.createOscillator();
    const osc2 = state.audioCtx.createOscillator();
    osc.type = 'sine';
    osc2.type = 'triangle';

    const set = (freq1, freq2, dur, a) => {
      osc.frequency.setValueAtTime(freq1, t);
      osc2.frequency.setValueAtTime(freq2, t);
      osc.start(t);
      osc2.start(t);
      gain.gain.exponentialRampToValueAtTime(a, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.stop(t + dur);
      osc2.stop(t + dur);
    };

    if (kind === 'eat') set(520, 760, 0.12, 0.09);
    else if (kind === 'evo') set(320, 980, 0.22, 0.11);
    else if (kind === 'death') set(90, 40, 0.32, 0.11);
    else if (kind === 'booster') set(240, 420, 0.18, 0.09);
  }

  function spawnParticles(x, y, opts = {}) {
    const count = opts.count ?? 14;
    const ttlMin = opts.ttlMin ?? 0.35;
    const ttlMax = opts.ttlMax ?? 0.95;
    const speedMin = opts.speedMin ?? 40;
    const speedMax = opts.speedMax ?? 220;
    const spread = opts.spread ?? Math.PI * 2;
    const baseColors = opts.colors ?? getSelectedSkin().colors;
    const glow = opts.glow ?? 18;
    const sizeBase = opts.sizeBase ?? state.headRadius * 0.8;

    const lv = state.evoLevel;
    const extra = lv >= 3 ? 1.35 : 1;
    const finalCount = Math.floor(count * (opts.multiplier ?? 1) * extra);

    for (let i = 0; i < finalCount; i++) {
      const a = (Math.random() * spread - spread / 2) + (opts.angle ?? Math.random() * Math.PI * 2);
      const sp = lerp(speedMin, speedMax, Math.random());
      const vx = Math.cos(a) * sp * (0.65 + Math.random() * 0.65);
      const vy = Math.sin(a) * sp * (0.65 + Math.random() * 0.65);
      const ttl = lerp(ttlMin, ttlMax, Math.random());
      const color = baseColors[Math.floor(Math.random() * baseColors.length)];
      const size = sizeBase * (0.25 + Math.random() * 0.9);
      state.particles.push({
        x,
        y,
        vx,
        vy,
        life: ttl,
        ttl,
        color,
        glow,
        size,
        drag: 0.88 + Math.random() * 0.08,
        kind: opts.kind ?? 'spark',
      });
    }
  }

  function spawnDeathParticles() {
    const head = state.snake.points[state.snake.points.length - 1];
    if (!head) return;
    const skin = getSelectedSkin();
    spawnParticles(head.x, head.y, {
      count: 80,
      ttlMin: 0.55,
      ttlMax: 1.35,
      speedMin: 110,
      speedMax: 520,
      spread: Math.PI * 2,
      colors: skin.colors,
      sizeBase: state.headRadius * 1.1,
      glow: skin.glow * 1.4,
      kind: 'boom',
    });
  }

  function spawnEvolutionParticles() {
    const head = state.snake.points[state.snake.points.length - 1];
    if (!head) return;
    const skin = computeSkinEffective(getSelectedSkin());
    spawnParticles(head.x, head.y, {
      count: 40,
      ttlMin: 0.35,
      ttlMax: 1.05,
      speedMin: 70,
      speedMax: 300,
      spread: Math.PI * 2,
      colors: skin.colors,
      sizeBase: state.headRadius * 0.9,
      glow: skin.effectiveGlow,
    });
  }

  function spawnEatParticles(foodX, foodY, multiplier) {
    const skin = computeSkinEffective(getSelectedSkin());
    const count = skin.particles ? 18 : 10;
    spawnParticles(foodX, foodY, {
      count,
      ttlMin: 0.25,
      ttlMax: 0.8,
      speedMin: 60,
      speedMax: 260,
      spread: Math.PI * 2,
      colors: skin.colors,
      sizeBase: state.headRadius * 0.75,
      glow: skin.effectiveGlow,
      multiplier,
    });
    if (state.evoLevel >= 3) {
      // Energy streaks
      for (let i = 0; i < 8; i++) {
        spawnParticles(foodX, foodY, {
          count: 1,
          ttlMin: 0.18,
          ttlMax: 0.35,
          speedMin: 140,
          speedMax: 480,
          spread: Math.PI * 1.2,
          colors: skin.colors,
          sizeBase: state.headRadius * 0.4,
          glow: skin.effectiveGlow * 1.15,
          kind: 'streak',
        });
      }
    }
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clampPoint(x, y, margin) {
    return {
      x: clamp(x, margin, state.worldW - margin),
      y: clamp(y, margin, state.worldH - margin),
    };
  }

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function pointInSnakeArea(x, y, radius) {
    const pts = state.snake.points;
    if (!pts || pts.length === 0) return false;
    const head = pts[pts.length - 1];
    if (Math.hypot(x - head.x, y - head.y) < radius) return true;
    for (let i = 0; i < pts.length - 5; i++) {
      if (Math.hypot(x - pts[i].x, y - pts[i].y) < radius * 0.85) return true;
    }
    return false;
  }

  function spawnFoodOne() {
    const margin = state.wallMargin * 1.4;
    const tries = 140;
    const foodR = state.segmentSpacing * 0.62;

    for (let t = 0; t < tries; t++) {
      const x = rand(margin, state.worldW - margin);
      const y = rand(margin, state.worldH - margin);
      if (pointInSnakeArea(x, y, state.segmentSpacing * 6.5)) continue;

      // Не спавним слишком близко к другим едам.
      let tooClose = false;
      for (let i = 0; i < state.foods.length; i++) {
        const f = state.foods[i];
        if (Math.hypot(x - f.x, y - f.y) < state.segmentSpacing * 5.8) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      return {
        x,
        y,
        r: foodR,
        phase: Math.random() * 999,
      };
    }

    // Fallback (если мало места)
    return {
      x: state.worldW / 2 + rand(-state.segmentSpacing * 3, state.segmentSpacing * 3),
      y: state.worldH / 2 + rand(-state.segmentSpacing * 3, state.segmentSpacing * 3),
      r: foodR,
      phase: Math.random() * 999,
    };
  }

  function ensureFoodCount(targetCount) {
    targetCount = clamp(targetCount, 1, state.maxFoods);
    while (state.foods.length < targetCount) {
      state.foods.push(spawnFoodOne());
    }
  }

  function spawnBooster() {
    const types = [
      { type: 'boost', weight: 0.25 },
      { type: 'magnet', weight: 0.2 },
      { type: 'shield', weight: 0.25 },
      { type: 'slow', weight: 0.15 },
      { type: 'magnet', weight: 0.15 }, // extra weight for magnet, makes level5 feel better
    ];
    const roll = Math.random();
    let acc = 0;
    let chosen = types[0].type;
    for (const t of types) {
      acc += t.weight;
      if (roll <= acc) {
        chosen = t.type;
        break;
      }
    }

    const margin = state.wallMargin * 1.4;
    const tries = 120;
    for (let i = 0; i < tries; i++) {
      const x = rand(margin, state.worldW - margin);
      const y = rand(margin, state.worldH - margin);
      // Держим бустер подальше от еды.
      let nearFood = false;
      for (let j = 0; j < state.foods.length; j++) {
        const f = state.foods[j];
        if (Math.hypot(x - f.x, y - f.y) < state.segmentSpacing * 12) {
          nearFood = true;
          break;
        }
      }
      if (nearFood) continue;
      if (!pointInSnakeArea(x, y, state.segmentSpacing * 6.5)) {
        return {
          type: chosen,
          x,
          y,
          r: state.segmentSpacing * 0.72,
          expiresAt: performance.now() + rand(6000, 11000),
          collected: false,
        };
      }
    }
    return null;
  }

  function initSnake() {
    const dirAngle = 0; // start moving to the right
    const dir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
    const headX = state.worldW / 2;
    const headY = state.worldH / 2;

    const initialLen = state.segmentSpacing * 13;
    const count = Math.floor(initialLen / state.segmentSpacing);
    state.snake.points = [];
    for (let i = count; i >= 0; i--) {
      state.snake.points.push({
        x: headX - dir.x * i * state.segmentSpacing,
        y: headY - dir.y * i * state.segmentSpacing,
      });
    }
    state.snake.angle = dirAngle;
    state.snake.desiredAngle = dirAngle;
    state.snake.targetLen = count * state.segmentSpacing;
    state.snake.pathStepAcc = 0;
  }

  function resetRun() {
    state.score = 0;
    state.evoLevel = 1;
    state.freezeUntil = 0;
    state.scoreBumpUntil = 0;
    state.shieldUntil = 0;
    state.accelUntil = 0;
    state.magnetUntil = 0;
    state.slowUntil = 0;
    state.ignoreChanceCooldownUntil = 0;
    state.combo.count = 0;
    state.combo.lastEatAt = 0;
    state.combo.lastMultiplier = 1;
    state.combo.comboUntil = 0;

    state.particles = [];
    state.headAfterImage = [];
    state.foods = [];

    initSnake();
    ensureFoodCount(state.maxFoods);
    state.booster = null;
    state.nextBoosterAt = performance.now() + rand(4500, 9000);
  }

  function shouldIgnoreCollision(now) {
    if (state.shieldUntil > now) return true;
    if (state.evoLevel >= 4) {
      // Level 4 bonus: chance to ignore collision.
      const ignoreChance = 0.22 + (state.selectedSkinId === 'cyber' ? 0.06 : 0);
      return Math.random() < ignoreChance;
    }
    return false;
  }

  function checkCollisions(now) {
    const pts = state.snake.points;
    if (!pts.length) return false;
    const head = pts[pts.length - 1];

    const margin = state.wallMargin;
    const wallHit =
      head.x < margin ||
      head.x > state.worldW - margin ||
      head.y < margin ||
      head.y > state.worldH - margin;
    if (wallHit) {
      if (state.ignoreChanceCooldownUntil < now && shouldIgnoreCollision(now)) {
        state.ignoreChanceCooldownUntil = now + 300; // short cooldown to avoid repeated ignoring
        const clamped = clampPoint(head.x, head.y, margin + 1);
        head.x = clamped.x;
        head.y = clamped.y;
        return false; // ignored collision
      }
      return true; // end game
    }

    const collisionRadius = state.headRadius * 0.72;
    const skip = Math.max(6, Math.floor(state.segmentSpacing * 0.9));
    for (let i = 0; i < pts.length - skip; i++) {
      if (Math.hypot(head.x - pts[i].x, head.y - pts[i].y) < collisionRadius) {
        if (state.ignoreChanceCooldownUntil < now && shouldIgnoreCollision(now)) {
          state.ignoreChanceCooldownUntil = now + 300;
          // Pull head slightly backward to reduce immediate re-collision.
          head.x -= Math.cos(state.snake.angle) * state.segmentSpacing * 0.65;
          head.y -= Math.sin(state.snake.angle) * state.segmentSpacing * 0.65;
          return false; // ignored collision
        }
        return true;
      }
    }
    return false;
  }

  function endGame() {
    state.mode = 'gameover';
    // Stop temporary gameplay effects when entering Game Over.
    state.booster = null;
    state.accelUntil = 0;
    state.magnetUntil = 0;
    state.shieldUntil = 0;
    state.slowUntil = 0;
    state.combo.count = 0;
    state.combo.lastMultiplier = 1;
    state.combo.comboUntil = 0;
    if (state.score > state.bestScore) {
      state.bestScore = state.score;
    }
    saveBestAndPlayTime();

    DOM.finalScore.textContent = String(Math.floor(state.score));
    DOM.finalBest.textContent = String(Math.floor(state.bestScore));

    spawnDeathParticles();
    playTone('death');

    setMode('gameover');
  }

  function updateEvolution(now) {
    const newLevel = getEvolutionLevel(state.score);
    if (newLevel > state.evoLevel) {
      state.evoLevel = newLevel;
      state.freezeUntil = Math.max(state.freezeUntil, now + 210);
      state.evoFlashUntil = now + 1400;
      spawnEvolutionParticles();
      playTone('evo');
      DOM.evoLevelText.textContent = `УРОВЕНЬ ${state.evoLevel}`;
    }
  }

  function updateBoosters(now) {
    state.timeScale = 1;
    if (state.slowUntil > now) state.timeScale = 0.68;
    if (state.booster && state.booster.expiresAt < now) {
      state.booster = null;
      state.nextBoosterAt = now + rand(6500, 12500);
    }

    if (!state.booster && now > state.nextBoosterAt) {
      const b = spawnBooster();
      if (b) state.booster = b;
      state.nextBoosterAt = now + rand(9000, 15500);
    }

    if (state.booster) {
      const head = state.snake.points[state.snake.points.length - 1];
      const pickR = Math.max(14, state.segmentSpacing * 0.9);
      if (Math.hypot(head.x - state.booster.x, head.y - state.booster.y) < pickR) {
        const type = state.booster.type;
        state.booster = null;
        state.nextBoosterAt = now + rand(5000, 10000);

        if (type === 'boost') state.accelUntil = now + rand(5200, 7600);
        if (type === 'magnet') state.magnetUntil = now + rand(6200, 9800);
        if (type === 'shield') state.shieldUntil = now + rand(4500, 6800);
        if (type === 'slow') state.slowUntil = now + rand(4200, 6400);

        const skin = computeSkinEffective(getSelectedSkin());
        spawnParticles(head.x, head.y, {
          count: 28,
          ttlMin: 0.18,
          ttlMax: 0.55,
          speedMin: 80,
          speedMax: 240,
          spread: Math.PI * 2,
          colors: skin.colors,
          sizeBase: state.headRadius * 0.5,
          glow: skin.effectiveGlow * 0.9,
        });
        playTone('booster');
      }
    }
  }

  function applyFoodAttraction(now, dtSec) {
    if (!state.foods.length) return;
    const head = state.snake.points[state.snake.points.length - 1];
    if (!head) return;

    let strength = 0;
    if (state.evoLevel >= 5) strength += 0.16; // level 5 base attraction
    if (state.magnetUntil > now) strength += 0.42; // booster magnet

    if (strength <= 0.0001) return;

    const pull = strength * (0.55 + 0.45 * Math.sin(now * 0.006));
    const m = state.wallMargin * 1.1;
    for (let i = 0; i < state.foods.length; i++) {
      const f = state.foods[i];
      f.x += (head.x - f.x) * pull * dtSec * 1.15;
      f.y += (head.y - f.y) * pull * dtSec * 1.15;
      const clamped = clampPoint(f.x, f.y, m);
      f.x = clamped.x;
      f.y = clamped.y;
    }
  }

  function addSnakePoint(newX, newY) {
    const pts = state.snake.points;
    if (!pts.length) {
      pts.push({ x: newX, y: newY });
      return;
    }
    const last = pts[pts.length - 1];
    const d = Math.hypot(newX - last.x, newY - last.y);
    // Важно: при медленной скорости расстояние между кадрами может быть маленьким,
    // и тогда змейка "не двигается", потому что новые точки не добавляются.
    // Поэтому: если шаг слишком мал — обновляем позицию головы, но не добавляем сегменты.
    const minHeadStep = state.segmentSpacing * 0.22;
    if (d < minHeadStep) {
      last.x = newX;
      last.y = newY;
      return;
    }

    const steps = Math.max(1, Math.floor(d / state.segmentSpacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      pts.push({
        x: lerp(last.x, newX, t),
        y: lerp(last.y, newY, t),
      });
    }
  }

  function trimSnakeToLength() {
    const pts = state.snake.points;
    if (pts.length < 3) return;

    let len = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i];
      const b = pts[i - 1];
      len += Math.hypot(a.x - b.x, a.y - b.y);
      if (len >= state.snake.targetLen) {
        // Trim earlier points.
        pts.splice(0, Math.max(0, i));
        return;
      }
    }
  }

  function updateSnake(now, dtSec) {
    const s = state.snake;
    if (!s.points.length) return;

    const lv = state.evoLevel;
    const skin = computeSkinEffective(getSelectedSkin());

    // Скорость: старт медленный, затем плавно растет по очкам до капа.
    const rampScore = 600; // после этого скорость больше не растет
    const t = clamp(state.score / rampScore, 0, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep
    // Чуть быстрее старта и максимума, но без сильного отклонения от "оригинальных" ощущений.
    const slowSpeed = state.segmentSpacing * 22;
    const fastSpeed = state.segmentSpacing * 28;
    const scoreSpeed = lerp(slowSpeed, fastSpeed, ease);

    // Уровень 2: +10% скорости (больше по эволюции не разгоняем)
    const evoSpeedBonus = lv >= 2 ? 1.1 : 1;
    const accelMult = state.accelUntil > now ? 1.22 : 1;
    // Ограничиваем максимальную скорость, чтобы геймплей оставался предсказуемым.
    const finalSpeed = clamp(scoreSpeed * evoSpeedBonus * accelMult * state.timeScale, 160, 360);

    // Управление: более быстрый поворот, но без резкого разворота 180 градусов.
    const turnRate = 30 + (lv >= 4 ? 3.2 : 0) + (state.accelUntil > now ? 2.0 : 0);
    const diff = wrapAngle(s.desiredAngle - s.angle);
    const maxTurn = turnRate * dtSec;
    if (Math.abs(diff) < 0.25) s.angle = s.desiredAngle;
    else if (Math.abs(diff) <= maxTurn) s.angle += diff;
    else s.angle += Math.sign(diff) * maxTurn;

    const freezeFactor = now < state.freezeUntil ? 0.15 : 1; // tiny movement during evolution pause

    const head = s.points[s.points.length - 1];
    const nextX = head.x + Math.cos(s.angle) * finalSpeed * dtSec * freezeFactor;
    const nextY = head.y + Math.sin(s.angle) * finalSpeed * dtSec * freezeFactor;
    addSnakePoint(nextX, nextY);
    trimSnakeToLength();

    // Save head after image for long luminous trails.
    if (lv >= 5 || skin.headStyle === 'galaxy') {
      state.headAfterImage.push({ x: s.points[s.points.length - 1].x, y: s.points[s.points.length - 1].y, t: now });
      const max = lv >= 5 ? 44 : 30;
      if (state.headAfterImage.length > max) state.headAfterImage.splice(0, state.headAfterImage.length - max);
    }
  }

  function eatCheck(now) {
    const head = state.snake.points[state.snake.points.length - 1];
    if (!head) return;

    let basePick = Math.max(12, state.segmentSpacing * 1.15);
    if (state.evoLevel >= 3) basePick *= 1.28; // level 3 pickup radius bonus
    if (state.magnetUntil > now) basePick *= 1.15;
    if (state.booster && state.booster.type === 'magnet') basePick *= 1.05;

    // Едим ближайшую еду в пределах радиуса (за один кадр максимум 1 еда).
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < state.foods.length; i++) {
      const f = state.foods[i];
      const d = Math.hypot(head.x - f.x, head.y - f.y);
      if (d <= basePick && d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return;
    const eaten = state.foods[bestIdx];

    // Combo multiplier
    const comboWindowMs = 720;
    const within = now - state.combo.lastEatAt <= comboWindowMs && state.combo.count > 0;
    state.combo.count = within ? state.combo.count + 1 : 1;
    state.combo.lastEatAt = now;

    const multiplier = state.combo.count >= 3 ? 3 : state.combo.count === 2 ? 2 : 1;
    state.combo.lastMultiplier = multiplier;
    state.combo.comboUntil = now + 750;

    const base = 10 + state.evoLevel * 3;
    const bonus = multiplier;
    const gained = base * bonus;
    state.score += gained;
    state.scoreBumpUntil = now + 160;

    // Grow snake.
    const growth = state.segmentSpacing * (1.0 + state.evoLevel * 0.015) * (1 + (multiplier - 1) * 0.12);
    state.snake.targetLen += growth;
    trimSnakeToLength();

    // Удаляем еду и поддерживаем до 3 штук одновременно.
    state.foods.splice(bestIdx, 1);
    spawnEatParticles(eaten.x, eaten.y, multiplier);
    playTone('eat');

    // New food and evolution check.
    updateEvolution(now);
    ensureFoodCount(state.maxFoods);
    renderComboNow();
  }

  function renderComboNow() {
    if (state.combo.lastMultiplier <= 1) {
      DOM.comboPill.classList.add('hidden');
      return;
    }
    const m = state.combo.lastMultiplier;
    DOM.comboPill.textContent = m === 2 ? 'КОМБО x2' : 'КОМБО x3';
    DOM.comboPill.classList.remove('hidden');
  }

  function renderBoosterPill(now) {
    const active = [
      { until: state.accelUntil, label: '⚡ УСКОРЕНИЕ' },
      { until: state.magnetUntil, label: '🧲 МАГНИТ' },
      { until: state.shieldUntil, label: '🛡 ЩИТ' },
      { until: state.slowUntil, label: '❄ ЗАМЕДЛЕНИЕ' },
    ].find((x) => x.until > now);

    if (!active) {
      DOM.boosterPill.classList.add('hidden');
      return;
    }
    const until = active.until;
    const left = Math.max(0, until - now);
    const sec = Math.ceil(left / 1000);
    DOM.boosterPill.textContent = `${active.label} ${sec}с`;
    DOM.boosterPill.classList.remove('hidden');
  }

  function drawBackground(now) {
    const skin = computeSkinEffective(getSelectedSkin());
    const isPlaying = state.mode === 'playing';

    ctx.globalCompositeOperation = 'source-over';

    if (!isPlaying) {
      ctx.fillStyle = '#050510';
      ctx.fillRect(0, 0, state.fullW, state.fullH);
    } else {
      // Trail = not clearing everything.
      let fade = skin.trail ? 0.18 : 0.32;
      if (state.evoLevel >= 5) fade -= 0.07;
      if (state.evoLevel >= 4) fade -= 0.04;
      fade = clamp(fade, 0.06, 0.36);

      ctx.fillStyle = `rgba(5, 5, 16, ${fade})`;
      ctx.fillRect(0, 0, state.fullW, state.fullH);

      // Subtle neon grid (cheap)
      const grid = Math.max(36, Math.floor(state.segmentSpacing * 3));
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = 'rgba(0,245,255,0.22)';
      ctx.lineWidth = 1;
      ctx.save();
      ctx.translate(state.viewX, state.viewY);
      ctx.beginPath();
      for (let x = (now * 0.02) % grid; x < state.worldW; x += grid) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, state.worldH);
      }
      for (let y = (now * 0.015) % grid; y < state.worldH; y += grid) {
        ctx.moveTo(0, y);
        ctx.lineTo(state.worldW, y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Яркая неоновая рамка ограниченного игрового мира.
    {
      const col0 = skin.colors[0];
      const col1 = skin.colors[1 % skin.colors.length];
      const col2 = skin.colors[2 % skin.colors.length];
      const glow = skin.effectiveGlow * (0.95 + (state.evoLevel - 1) * 0.06);
      const pulse = 0.65 + 0.35 * Math.sin(now * 0.008);

      ctx.save();
      ctx.translate(state.viewX, state.viewY);

      // Outer glow stroke
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = glow * 1.1;
      ctx.shadowColor = rgbaFromHex(col1, 0.9 * pulse);
      const grad = ctx.createLinearGradient(0, 0, state.worldW, state.worldH);
      grad.addColorStop(0, rgbaFromHex(col0, 0.9));
      grad.addColorStop(0.5, rgbaFromHex(col1, 0.9));
      grad.addColorStop(1, rgbaFromHex(col2, 0.7));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(2, state.segmentSpacing * 0.18);
      ctx.strokeRect(0.5, 0.5, state.worldW - 1, state.worldH - 1);

      // Inner bright line
      ctx.shadowBlur = glow * 0.35;
      ctx.shadowColor = rgbaFromHex(col0, 0.75 * pulse);
      ctx.strokeStyle = rgbaFromHex(col0, 0.55);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(2, 2, state.worldW - 4, state.worldH - 4);

      // Corner highlights
      ctx.shadowBlur = 0;
      ctx.fillStyle = rgbaFromHex(col2, 0.35);
      const csz = Math.max(6, state.segmentSpacing * 0.24);
      ctx.fillRect(0, 0, csz, 3);
      ctx.fillRect(0, 0, 3, csz);
      ctx.fillRect(state.worldW - csz, 0, csz, 3);
      ctx.fillRect(state.worldW - 3, 0, 3, csz);
      ctx.fillRect(0, state.worldH - 3, csz, 3);
      ctx.fillRect(0, state.worldH - csz, 3, csz);
      ctx.fillRect(state.worldW - csz, state.worldH - 3, csz, 3);
      ctx.fillRect(state.worldW - 3, state.worldH - csz, 3, csz);

      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawFood(now) {
    if (!state.foods.length) return;
    const skin = computeSkinEffective(getSelectedSkin());
    const c0 = skin.colors[0];
    const c1 = skin.colors[1 % skin.colors.length];

    for (let i = 0; i < state.foods.length; i++) {
      const f = state.foods[i];
      const pulse = 0.72 + 0.28 * Math.sin(now * 0.012 + (f.phase || 0));
      const r = f.r * (1 + 0.1 * pulse) * (state.evoLevel >= 3 ? 1.05 : 1);
      const x = f.x;
      const y = f.y;

      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      grad.addColorStop(0, rgbaFromHex(c0, 0.95));
      grad.addColorStop(0.35, rgbaFromHex(c1, 0.55));
      grad.addColorStop(1, rgbaFromHex(c1, 0));

      ctx.fillStyle = grad;
      ctx.shadowBlur = skin.effectiveGlow * 1.05;
      ctx.shadowColor = rgbaFromHex(c0, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // Pulsating ring
      ctx.shadowBlur = skin.effectiveGlow * 0.5;
      ctx.strokeStyle = rgbaFromHex(c1, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55 * (0.92 + 0.08 * pulse), 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawBooster(now) {
    if (!state.booster) return;
    const b = state.booster;
    const skin = computeSkinEffective(getSelectedSkin());

    const icon =
      b.type === 'boost'
        ? '⚡'
        : b.type === 'magnet'
          ? '🧲'
          : b.type === 'shield'
            ? '🛡'
            : '❄';
    const pulse = 0.75 + 0.25 * Math.sin(now * 0.015 + b.x * 0.01);
    const r = b.r * (1 + 0.15 * pulse);

    ctx.globalCompositeOperation = 'lighter';
    const col =
      b.type === 'boost'
        ? skin.colors[1]
        : b.type === 'magnet'
          ? skin.colors[0]
          : b.type === 'shield'
            ? skin.colors[2 % skin.colors.length]
            : skin.colors[1];
    ctx.shadowBlur = skin.effectiveGlow * 0.9;
    ctx.shadowColor = rgbaFromHex(col, 0.9);
    ctx.fillStyle = rgbaFromHex(col, 0.25);
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 1.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbaFromHex(col, 0.95);
    ctx.font = `${Math.max(14, r * 1.4)}px system-ui, -apple-system, Segoe UI, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, b.x, b.y + 1);

    // Outer glow ring
    ctx.shadowBlur = skin.effectiveGlow * 0.35;
    ctx.strokeStyle = rgbaFromHex(col, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawParticles() {
    if (!state.particles.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      if (p.life <= 0) continue;
      const a = clamp(p.life / p.ttl, 0, 1);
      const col = rgbaFromHex(p.color, 0.75 * a);
      ctx.shadowBlur = p.glow;
      ctx.shadowColor = rgbaFromHex(p.color, 0.85 * a);
      ctx.fillStyle = col;

      if (p.kind === 'streak') {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.2, p.size * 0.55);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else if (p.kind === 'boom') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.35 + 0.65 * a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateParticles(dtSec) {
    if (!state.particles.length) return;
    const damp = Math.pow(0.0005, dtSec); // frame-independent-ish damping
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dtSec;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.vx *= 1 - damp * (1 - p.drag);
      p.vy *= 1 - damp * (1 - p.drag);
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
    }
  }

  function drawSnake() {
    const skin = computeSkinEffective(getSelectedSkin());
    const pts = state.snake.points;
    if (!pts.length) return;

    const lv = state.evoLevel;
    const baseW = clamp(state.segmentSpacing * 0.52, 4.2, 11);
    const n = pts.length;

    // Optional trail after-image for cosmic levels
    if ((lv >= 5 || skin.headStyle === 'galaxy') && state.headAfterImage.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < state.headAfterImage.length; i++) {
        const it = state.headAfterImage[i];
        const age = (performance.now() - it.t) / 1000;
        const a = clamp(1 - age / 0.9, 0, 1);
        if (a <= 0) continue;
        const idx = Math.floor((i / state.headAfterImage.length) * (skin.colors.length - 1));
        const col = skin.colors[idx];
        const rr = state.headRadius * (1.25 + a * 0.4);
        ctx.shadowBlur = skin.effectiveGlow * (0.35 + a * 0.85);
        ctx.shadowColor = rgbaFromHex(col, 0.9 * a);
        ctx.fillStyle = rgbaFromHex(col, 0.2 * a);
        ctx.beginPath();
        ctx.arc(it.x, it.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Body segments
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < n; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const t = i / (n - 1);

      const colIdx = Math.floor(t * (skin.colors.length - 1));
      const col = skin.colors[colIdx];

      let alpha = 0.12 + t * 0.55;
      if (lv >= 2 && skin.trail) alpha *= 1.1;
      if (lv >= 3) alpha *= 0.88; // energy mode looks better slightly transparent
      if (state.accelUntil > performance.now()) alpha *= 1.05;

      if (lv >= 5) alpha *= 1.12;

      const w = baseW * (0.65 + t * 0.95) * (lv >= 4 ? 1.08 : 1);
      ctx.lineWidth = w;
      ctx.lineCap = 'round';

      ctx.shadowBlur = skin.effectiveGlow * (0.3 + t * 0.9);
      ctx.shadowColor = rgbaFromHex(col, 0.95);
      ctx.strokeStyle = rgbaFromHex(col, alpha);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      if (lv >= 3) {
        ctx.shadowBlur = skin.effectiveGlow * 0.55;
        ctx.shadowColor = rgbaFromHex(skin.colors[(colIdx + 1) % skin.colors.length], 0.55);
        ctx.strokeStyle = rgbaFromHex(col, alpha * 0.45);
        ctx.lineWidth = w * 1.05;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    // Head
    const head = pts[n - 1];
    const angle = state.snake.angle;
    drawHead(head.x, head.y, angle, skin, lv);

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHead(x, y, angle, skin, lv) {
    const dirx = Math.cos(angle);
    const diry = Math.sin(angle);
    const nx = -diry;
    const ny = dirx;

    const r = state.headRadius * (1 + (lv - 1) * 0.08) * (skin.headStyle === 'fire' ? 1.06 : 1);
    const eyeDist = r * 0.36;
    const eyeBack = r * 0.14;

    const col0 = skin.colors[0];
    const col1 = skin.colors[1 % skin.colors.length];
    const col2 = skin.colors[2 % skin.colors.length];

    const glowAlpha = lv >= 4 ? 1 : 0.92;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Head shadow core
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur = skin.effectiveGlow * (1.1 + lv * 0.05);
    ctx.shadowColor = rgbaFromHex(col0, glowAlpha);

    if (skin.headStyle === 'cyber') {
      // Slightly angular cyber head
      const w = r * 2.0;
      const h = r * 1.35;
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, h * 0.05);
      ctx.lineTo(-w * 0.15, -h * 0.75);
      ctx.lineTo(w * 0.5, 0);
      ctx.lineTo(-w * 0.15, h * 0.75);
      ctx.closePath();

      const grad = ctx.createLinearGradient(-w, 0, w, 0);
      grad.addColorStop(0, rgbaFromHex(col1, 0.75));
      grad.addColorStop(0.5, rgbaFromHex(col0, 0.95));
      grad.addColorStop(1, rgbaFromHex(col2, 0.6));
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.shadowBlur = skin.effectiveGlow * 0.5;
      ctx.strokeStyle = rgbaFromHex(col2, 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Cyber eyes
      const eyeY = -r * 0.1;
      const eyeX = -eyeDist;
      ctx.fillStyle = rgbaFromHex(col2, 0.9);
      ctx.fillRect(eyeX - r * 0.12, eyeY - r * 0.12, r * 0.24, r * 0.24);
      ctx.fillRect(-eyeX - r * 0.12, eyeY - r * 0.12, r * 0.24, r * 0.24);

      // Geometric cyber lines
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = rgbaFromHex(col1, 0.45);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.4);
      ctx.lineTo(r * 0.25, r * 0.15);
      ctx.moveTo(-r * 0.2, r * 0.4);
      ctx.lineTo(r * 0.25, -r * 0.1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (skin.headStyle === 'galaxy') {
      // Aura + soft core
      const grad = ctx.createRadialGradient(0, -r * 0.2, 0, 0, 0, r * 2.0);
      grad.addColorStop(0, rgbaFromHex(col0, 0.95));
      grad.addColorStop(0.35, rgbaFromHex(col1, 0.55));
      grad.addColorStop(1, rgbaFromHex(col2, 0.0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      ctx.shadowBlur = skin.effectiveGlow * 0.7;
      ctx.fillStyle = rgbaFromHex(col0, 0.88);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.fill();

      // Stars around head (level 5 feels cosmic)
      ctx.shadowBlur = 0;
      const starCount = lv >= 5 ? 14 : 8;
      for (let i = 0; i < starCount; i++) {
        const a = (i / starCount) * Math.PI * 2 + (performance.now() * 0.0008);
        const rr = r * (0.9 + Math.random() * 0.8);
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a) * rr * 0.75;
        const tw = 0.35 + 0.65 * Math.sin(performance.now() * 0.01 + i);
        ctx.fillStyle = rgbaFromHex(i % 2 === 0 ? col1 : col2, 0.25 + tw * 0.35);
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.1, r * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }

      // Galaxy eyes
      const eyeY = -r * 0.1;
      ctx.fillStyle = rgbaFromHex(col2, 0.9);
      ctx.beginPath();
      ctx.arc(-eyeDist, eyeY, r * 0.13, 0, Math.PI * 2);
      ctx.arc(eyeDist, eyeY, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    } else if (skin.headStyle === 'fire') {
      // Fire snake: flame-like outer shape
      const flame = (k) => r * (0.95 + 0.18 * Math.sin(performance.now() * 0.02 + k));
      ctx.shadowBlur = skin.effectiveGlow * 1.2;
      ctx.shadowColor = rgbaFromHex(col0, 0.92);

      const grad = ctx.createLinearGradient(-r, -r, r, r);
      grad.addColorStop(0, rgbaFromHex(col0, 0.95));
      grad.addColorStop(0.55, rgbaFromHex(col1, 0.55));
      grad.addColorStop(1, rgbaFromHex(col2, 0.25));
      ctx.fillStyle = grad;

      ctx.beginPath();
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = -Math.PI + t * Math.PI * 2;
        const rr = flame(i);
        ctx.lineTo(Math.cos(a) * rr * 0.95, Math.sin(a) * rr * 0.7);
      }
      ctx.closePath();
      ctx.fill();

      // Flame outline
      ctx.shadowBlur = skin.effectiveGlow * 0.45;
      ctx.strokeStyle = rgbaFromHex(col1, 0.55);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Fire eyes
      const eyeY = -r * 0.1;
      ctx.fillStyle = rgbaFromHex(col2, 0.95);
      ctx.beginPath();
      ctx.arc(-eyeDist, eyeY, r * 0.12, 0, Math.PI * 2);
      ctx.arc(eyeDist, eyeY, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else if (skin.headStyle === 'pulse') {
      // Classic with pulsing ring
      const grad = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r * 2.0);
      grad.addColorStop(0, rgbaFromHex(col1, 0.95));
      grad.addColorStop(0.45, rgbaFromHex(col0, 0.65));
      grad.addColorStop(1, rgbaFromHex(col2, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      const ring = 1 + 0.14 * Math.sin(performance.now() * 0.02);
      ctx.shadowBlur = skin.effectiveGlow;
      ctx.shadowColor = rgbaFromHex(col1, 0.85);
      ctx.strokeStyle = rgbaFromHex(col1, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.25 * ring, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = skin.effectiveGlow * 0.7;
      ctx.fillStyle = rgbaFromHex(col0, 0.88);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const eyeY = -r * 0.1;
      ctx.fillStyle = rgbaFromHex(col2, 0.9);
      ctx.beginPath();
      ctx.arc(-eyeDist, eyeY, r * 0.12, 0, Math.PI * 2);
      ctx.arc(eyeDist, eyeY, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Neon Classic head
      const grad = ctx.createRadialGradient(-r * 0.15, -r * 0.15, 0, 0, 0, r * 2.1);
      grad.addColorStop(0, rgbaFromHex(col0, 0.95));
      grad.addColorStop(0.4, rgbaFromHex(col1, 0.6));
      grad.addColorStop(1, rgbaFromHex(col2, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = skin.effectiveGlow * 0.7;
      ctx.fillStyle = rgbaFromHex(col0, 0.88);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const eyeY = -r * 0.1;
      ctx.fillStyle = rgbaFromHex(col2, 0.9);
      ctx.beginPath();
      ctx.arc(-eyeDist, eyeY, r * 0.11, 0, Math.PI * 2);
      ctx.arc(eyeDist, eyeY, r * 0.11, 0, Math.PI * 2);
      ctx.fill();

      // Micro specular line
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgbaFromHex(col1, 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, -r * 0.8);
      ctx.lineTo(r * 0.1, r * 0.2);
      ctx.stroke();
    }

    ctx.restore();

    // Level 4: extra cyber glow around head.
    if (lv >= 4) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowBlur = skin.effectiveGlow * 0.55;
      ctx.shadowColor = rgbaFromHex(col1, 0.9);
      ctx.strokeStyle = rgbaFromHex(col2, 0.22);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function render() {
    const now = performance.now();
    drawBackground(now);

    // Menu/gameover still renders some neon if desired.
    ctx.save();
    ctx.translate(state.viewX, state.viewY);
    if (state.mode === 'playing') {
      // Physics/render order
      drawFood(now);
      drawBooster(now);
      drawSnake();
      drawParticles();
    } else if (state.mode === 'gameover') {
      // Keep a last look.
      drawFood(now);
      drawBooster(now);
      drawSnake();
      drawParticles();
    } else {
      // Menu: paint subtle preview-like backdrop.
      drawFood(now);
      drawParticles();
    }
    ctx.restore();

    // UI state updates that don't depend on DOM overlays.
    DOM.score.textContent = `СЧЕТ: ${formatScore(state.score)}`;
    if (state.scoreBumpUntil > now) {
      const t = (state.scoreBumpUntil - now) / 160; // 1..0
      DOM.score.style.transform = `scale(${1.06 + (1 - t) * 0.22})`;
      DOM.score.style.boxShadow = '0 0 34px rgba(0, 245, 255, 0.22), 0 0 44px rgba(255, 43, 214, 0.12)';
    } else {
      DOM.score.style.transform = '';
      DOM.score.style.boxShadow = '';
    }
    DOM.best.textContent = `ЛУЧШИЙ РЕЗУЛЬТАТ: ${formatScore(state.bestScore)}`;

    if (state.combo.comboUntil > now && state.combo.lastMultiplier > 1) {
      DOM.comboPill.classList.remove('hidden');
    } else {
      DOM.comboPill.classList.add('hidden');
    }

    renderBoosterPill(now);

    if (state.evoFlashUntil > now) {
      DOM.evoFlash.classList.remove('hidden');
    } else {
      DOM.evoFlash.classList.add('hidden');
    }
  }

  function update(now) {
    if (!state.lastTs) state.lastTs = now;
    const dtSec = clamp((now - state.lastTs) / 1000, 0, 0.033);
    state.lastTs = now;

    if (state.mode === 'playing') {
      state.totalPlayTimeMs += dtSec * 1000;
      updateBoosters(now);
      applyFoodAttraction(now, dtSec);

      updateSnake(now, dtSec);

      eatCheck(now);
      const collisionNow = checkCollisions(now);
      if (collisionNow) endGame();
    }

    if (state.mode !== 'menu') {
      updateParticles(dtSec);
    }

    render();
  }

  function loop(ts) {
    update(ts);
    requestAnimationFrame(loop);
  }

  function renderSkinPreview() {
    const skin = computeSkinEffective(getSelectedSkin());
    const w = DOM.skinPreview.width;
    const h = DOM.skinPreview.height;
    previewCtx.clearRect(0, 0, w, h);

    // Background
    previewCtx.fillStyle = 'rgba(5, 5, 16, 0.82)';
    previewCtx.fillRect(0, 0, w, h);

    // Mini-neon curve
    previewCtx.globalCompositeOperation = 'lighter';
    const cx = w / 2;
    const cy = h / 2 + 18;
    const r = 58;
    const pts = 14;
    for (let i = 1; i < pts; i++) {
      const t0 = (i - 1) / (pts - 1);
      const t1 = i / (pts - 1);
      const ang0 = t0 * Math.PI * 1.2 + Math.PI * 0.9;
      const ang1 = t1 * Math.PI * 1.2 + Math.PI * 0.9;
      const x0 = cx + Math.cos(ang0) * r * (0.55 + t0 * 0.6);
      const y0 = cy + Math.sin(ang0) * r * (0.55 + t0 * 0.6);
      const x1 = cx + Math.cos(ang1) * r * (0.55 + t1 * 0.6);
      const y1 = cy + Math.sin(ang1) * r * (0.55 + t1 * 0.6);
      const t = t1;
      const idx = Math.floor(t * (skin.colors.length - 1));
      const col = skin.colors[idx];
      const a = 0.18 + t * 0.55;
      previewCtx.shadowBlur = skin.effectiveGlow * 0.35;
      previewCtx.shadowColor = rgbaFromHex(col, 0.95);
      previewCtx.strokeStyle = rgbaFromHex(col, a);
      previewCtx.lineWidth = 6 * (0.45 + t * 0.9);
      previewCtx.beginPath();
      previewCtx.moveTo(x0, y0);
      previewCtx.lineTo(x1, y1);
      previewCtx.stroke();
    }

    // Fake head
    const headAng = -Math.PI / 2.2;
    const hx = cx + Math.cos(headAng) * 40;
    const hy = cy + Math.sin(headAng) * 40;

    // Temporarily map preview coordinate to use drawHead logic:
    // We call drawHead with a transformed context by reusing its primitives.
    const savedState = {
      segSpacing: state.segmentSpacing,
      headRadius: state.headRadius,
      worldW: state.worldW,
      worldH: state.worldH,
    };
    state.segmentSpacing = 18;
    state.headRadius = 10;
    state.snake.angle = headAng;
    ctx.save();
    // We'll draw head onto previewCtx with the same style logic by duplicating head drawing:
    // Instead of reusing drawHead directly (it writes to the global ctx), we implement a simplified preview head.

    // Simplified preview head: gradient circle + eyes, aligned to skin head style name.
    const lv = state.evoLevel;
    const pr = state.headRadius * 1.35;
    const eyeDist = pr * 0.36;
    const col0 = skin.colors[0];
    const col1 = skin.colors[1 % skin.colors.length];
    const col2 = skin.colors[2 % skin.colors.length];

    previewCtx.save();
    previewCtx.translate(hx, hy);
    previewCtx.rotate(headAng);
    previewCtx.globalCompositeOperation = 'lighter';

    previewCtx.shadowBlur = skin.effectiveGlow * 0.55;
    previewCtx.shadowColor = rgbaFromHex(col0, 0.95);

    const grad = previewCtx.createRadialGradient(-pr * 0.2, -pr * 0.2, 0, 0, 0, pr * 2.1);
    grad.addColorStop(0, rgbaFromHex(col0, 0.95));
    grad.addColorStop(0.4, rgbaFromHex(col1, 0.55));
    grad.addColorStop(1, rgbaFromHex(col2, 0));
    previewCtx.fillStyle = grad;
    previewCtx.beginPath();
    previewCtx.arc(0, 0, pr * 1.06, 0, Math.PI * 2);
    previewCtx.fill();

    previewCtx.shadowBlur = skin.effectiveGlow * 0.4;
    previewCtx.fillStyle = rgbaFromHex(col0, 0.78);
    previewCtx.beginPath();
    previewCtx.arc(0, 0, pr * 0.68, 0, Math.PI * 2);
    previewCtx.fill();

    // Ring/pattern depending on style.
    if (skin.headStyle === 'pulse') {
      const ring = 1.02 + 0.1 * Math.sin(performance.now() * 0.02);
      previewCtx.strokeStyle = rgbaFromHex(col1, 0.55);
      previewCtx.lineWidth = 3;
      previewCtx.shadowBlur = skin.effectiveGlow * 0.3;
      previewCtx.beginPath();
      previewCtx.arc(0, 0, pr * 1.22 * ring, 0, Math.PI * 2);
      previewCtx.stroke();
    } else if (skin.headStyle === 'cyber') {
      previewCtx.strokeStyle = rgbaFromHex(col2, 0.55);
      previewCtx.lineWidth = 2.5;
      previewCtx.beginPath();
      previewCtx.moveTo(-pr * 0.55, -pr * 0.15);
      previewCtx.lineTo(-pr * 0.2, -pr * 0.62);
      previewCtx.lineTo(pr * 0.55, 0);
      previewCtx.lineTo(-pr * 0.2, pr * 0.62);
      previewCtx.closePath();
      previewCtx.stroke();
    } else if (skin.headStyle === 'galaxy') {
      previewCtx.shadowBlur = 0;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + performance.now() * 0.001;
        const rr = pr * (0.9 + Math.random() * 0.6);
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a) * rr * 0.65;
        previewCtx.fillStyle = rgbaFromHex(i % 2 ? col1 : col2, 0.3);
        previewCtx.beginPath();
        previewCtx.arc(sx, sy, Math.max(1.3, pr * 0.09), 0, Math.PI * 2);
        previewCtx.fill();
      }
    } else if (skin.headStyle === 'fire') {
      previewCtx.strokeStyle = rgbaFromHex(col1, 0.55);
      previewCtx.lineWidth = 3;
      previewCtx.shadowBlur = skin.effectiveGlow * 0.2;
      previewCtx.beginPath();
      previewCtx.arc(0, 0, pr * 1.22, 0, Math.PI * 2);
      previewCtx.stroke();
    }

    // Eyes
    const eyeY = -pr * 0.12;
    previewCtx.fillStyle = rgbaFromHex(col2, 0.95);
    previewCtx.beginPath();
    previewCtx.arc(-eyeDist, eyeY, pr * 0.11, 0, Math.PI * 2);
    previewCtx.arc(eyeDist, eyeY, pr * 0.11, 0, Math.PI * 2);
    previewCtx.fill();

    previewCtx.restore();

    // Skin info
    DOM.skinInfo.innerHTML = `
      <b>${skin.name}</b><br/>
      Свечение: ${Math.round(skin.effectiveGlow)} · Шлейф: ${skin.trail ? 'ДА' : 'МЯГКИЙ'} · Частицы: ${
      skin.particles ? 'ДА' : 'МАЛО'
    }<br/>
      ${skin.unlockLabel}
    `;

    previewCtx.globalCompositeOperation = 'source-over';
    // Restore dummy state values.
    state.segmentSpacing = savedState.segSpacing;
    state.headRadius = savedState.headRadius;
    state.worldW = savedState.worldW;
    state.worldH = savedState.worldH;
    ctx.restore();
  }

  function renderMenuSkins() {
    DOM.skinGrid.innerHTML = '';
    const bestScore = state.bestScore;
    const totalPlayTimeMs = state.totalPlayTimeMs;
    resolveSelectedSkin();
    const selected = skins.find((s) => s.id === state.selectedSkinId) || skins[0];

    for (const skin of skins) {
      const unlocked = getUnlocked(skin, bestScore, totalPlayTimeMs);
      const card = document.createElement('div');
      card.className = `skinCard${skin.id === selected.id ? ' selected' : ''}${unlocked ? '' : ' locked'}`;

      const swatch = `linear-gradient(90deg, ${skin.colors
        .slice(0, 3)
        .map((c, i) => rgbaFromHex(c, 0.7 + i * 0.08))
        .join(', ')})`;

      const badgeText = unlocked ? 'ОТКРЫТО' : 'ЗАКРЫТО';
      const badgeClass = unlocked ? '' : ' locked';

      card.innerHTML = `
        <div class="skinSwatch" style="background:${swatch};"></div>
        <div class="skinName">${skin.name}</div>
        <div class="skinMeta">
          ${unlocked ? 'Доступно для выбора.' : skin.unlockLabel}
        </div>
        <div class="badge${badgeClass}">${badgeText}</div>
      `;

      card.addEventListener('click', () => {
        if (!unlocked) return;
        state.selectedSkinId = skin.id;
        saveSelectedSkin();
        renderMenuSkins();
        renderSkinPreview();
      });

      DOM.skinGrid.appendChild(card);
    }
    renderSkinPreview();
  }

  function attachInput() {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (state.mode === 'playing') {
          e.preventDefault();
          exitToMenu();
        }
        return;
      }

      const k = e.key.toLowerCase();
      if (
        k === 'arrowup' ||
        k === 'arrowdown' ||
        k === 'arrowleft' ||
        k === 'arrowright' ||
        k === 'w' ||
        k === 'a' ||
        k === 's' ||
        k === 'd' ||
        k === 'ц' ||
        k === 'ф' ||
        k === 'ы' ||
        k === 'в'
      ) {
        e.preventDefault();
      }

      let angle = null;
      if (e.key === 'ArrowRight' || k === 'd' || k === 'в') angle = 0;
      else if (e.key === 'ArrowLeft' || k === 'a' || k === 'ф') angle = Math.PI;
      else if (e.key === 'ArrowDown' || k === 's' || k === 'ы') angle = Math.PI / 2;
      else if (e.key === 'ArrowUp' || k === 'w' || k === 'ц') angle = -Math.PI / 2;

      if (angle != null) requestAngle(angle);
    };
    window.addEventListener('keydown', onKey, { passive: false });

    // Swipe controls (mobile)
    let touchStart = null;
    DOM.canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
      },
      { passive: true }
    );
    DOM.canvas.addEventListener(
      'touchend',
      (e) => {
        if (!touchStart) return;
        const changed = e.changedTouches[0];
        const dx = changed.clientX - touchStart.x;
        const dy = changed.clientY - touchStart.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 26;
        if (dist < minDist) {
          touchStart = null;
          return;
        }
        const angle = angleFromInput(dx, dy);
        requestAngle(angle);
        touchStart = null;
      },
      { passive: true }
    );

    // Управление мышью: ведем указатель по полю — змейка смотрит мгновенно.
    // Для сенсорных устройств используем свайп (touchstart/touchend выше).
    let mouseDown = false;
    let activePointerId = null;
    const updateAngleFromPointer = (clientX, clientY) => {
      if (state.mode !== 'playing') return;
      const pts = state.snake.points;
      if (!pts || pts.length < 2) return;
      const head = pts[pts.length - 1];

      const rect = DOM.canvas.getBoundingClientRect();
      const worldX = clientX - rect.left - state.viewX;
      const worldY = clientY - rect.top - state.viewY;

      const dx = worldX - head.x;
      const dy = worldY - head.y;
      if (Math.hypot(dx, dy) < 10) return;

      requestAngle(Math.atan2(dy, dx));
    };

    DOM.canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (state.mode !== 'playing') return;
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        mouseDown = true;
        activePointerId = e.pointerId;
        updateAngleFromPointer(e.clientX, e.clientY);
      },
      { passive: true }
    );
    DOM.canvas.addEventListener(
      'pointermove',
      (e) => {
        if (state.mode !== 'playing') return;
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        updateAngleFromPointer(e.clientX, e.clientY);
      },
      { passive: true }
    );
    const endPointer = (e) => {
      if (e.pointerId !== activePointerId) return;
      mouseDown = false;
      activePointerId = null;
    };
    DOM.canvas.addEventListener('pointerup', endPointer, { passive: true });
    DOM.canvas.addEventListener('pointercancel', endPointer, { passive: true });

    // Enable audio on first user gesture.
    const enableOnFirstGesture = () => {
      ensureAudio();
      window.removeEventListener('pointerdown', enableOnFirstGesture);
      window.removeEventListener('keydown', enableOnFirstGesture);
    };
    window.addEventListener('pointerdown', enableOnFirstGesture, { passive: true });
    window.addEventListener('keydown', enableOnFirstGesture);
  }

  function syncSoundToggle() {
    DOM.soundToggle.checked = state.soundOn;
    DOM.soundToggle.addEventListener('change', () => {
      state.soundOn = DOM.soundToggle.checked;
      try {
        localStorage.setItem(STORAGE.soundOn, state.soundOn ? '1' : '0');
      } catch (_) {}
      if (!state.soundOn) {
        try {
          state.audioEnabled = false;
          if (state.audioCtx) state.audioCtx.close();
        } catch (_) {}
        state.audioCtx = null;
      } else {
        ensureAudio();
      }
    });
  }

  function startRun() {
    resolveSelectedSkin();
    resetRun();
    state.lastTs = 0;
    setMode('playing');
  }

  function exitToMenu() {
    // Обновляем лучший результат, даже если игрок выходит раньше столкновения.
    if (state.score > state.bestScore) state.bestScore = state.score;
    saveBestAndPlayTime();

    state.booster = null;
    state.accelUntil = 0;
    state.magnetUntil = 0;
    state.shieldUntil = 0;
    state.slowUntil = 0;

    state.combo.count = 0;
    state.combo.lastMultiplier = 1;
    state.combo.comboUntil = 0;

    setMode('menu');
    renderMenuSkins();
  }

  function hookUI() {
    DOM.startBtn.addEventListener('click', () => {
      startRun();
    });
    DOM.restartBtn.addEventListener('click', () => {
      startRun();
    });
    DOM.backToMenuBtn.addEventListener('click', () => {
      setMode('menu');
      // Save play time and best when leaving run.
      saveBestAndPlayTime();
      renderMenuSkins();
    });
    DOM.exitBtn.addEventListener('click', () => {
      if (state.mode !== 'playing') return;
      exitToMenu();
    });
  }

  function updateUnlocksUIIfNeeded() {
    // When user returns to menu, galaxy unlock may have become available.
    if (state.mode !== 'menu') return;
    renderMenuSkins();
  }

  function mainInit() {
    loadStorage();
    resolveSelectedSkin();
    syncSoundToggle();
    hookUI();
    attachInput();

    const safeRender = () => {
      resizeCanvas();
      renderMenuSkins();
      state.foods = [];
      ensureFoodCount(state.maxFoods);
      render();
    };

    safeRender();

    window.addEventListener('resize', () => {
      const wasPlaying = state.mode === 'playing';
      resizeCanvas();
      if (wasPlaying) {
        // Keep it stable: restart run on resize.
        startRun();
      } else {
        // Menu preview only.
        renderMenuSkins();
        state.foods = [];
        ensureFoodCount(state.maxFoods);
        render();
      }
    });
  }

  // Run main
  mainInit();
  requestAnimationFrame(loop);
})();

