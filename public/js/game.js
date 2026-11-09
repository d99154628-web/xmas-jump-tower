/* global Phaser, io, SHARED, PIXEL, AUDIO */
/*
 * game.js — 학생 화면.
 * 렉 없는 동기화 원칙
 *  1) 내 캐릭터는 내 브라우저에서 바로 물리 계산(입력 지연 0)
 *  2) 내 위치는 15Hz 로, 바뀌었을 때만, volatile 로 전송(밀린 패킷은 버림)
 *  3) 다른 친구들은 서버 시각 기준 120ms 뒤를 보간(interpolation)해서 그림 → 끊김 없이 부드럽게
 *  4) 서버와 시계를 맞춰(clock sync) 타이머·카운트다운이 교사 화면과 똑같이 흐름
 */
(function () {
  'use strict';
  const S = SHARED;
  const $ = (id) => document.getElementById(id);
  const ANIMS = ['_idle', '_run', '_jump', '_fall'];
  const LABEL = { fontFamily: 'Galmuri11, "Malgun Gothic", sans-serif', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, resolution: 2, padding: { x: 2, y: 3 } };

  /* ================= 네트워크 ================= */
  const socket = io({ transports: ['websocket'], upgrade: false });
  const Net = {
    offset: 0, mySid: -1, me: null, state: { phase: 'lobby', seed: 1 }, remotes: new Map(), joined: false, scene: null,
    serverNow() { return Date.now() + this.offset; },
    async syncClock() {
      let best = Infinity;
      for (let i = 0; i < 6; i++) {
        const t0 = Date.now();
        const st = await new Promise((res) => socket.timeout(3000).emit('t', (err, v) => res(err ? null : v)));
        const t1 = Date.now();
        if (st != null && t1 - t0 < best) { best = t1 - t0; this.offset = st + (t1 - t0) / 2 - t1; }
      }
    },
  };

  function addRemote(row) {
    const [sid, name, skin, x, y, anim = 0, flip = 0] = row;
    if (sid === Net.mySid) return;
    removeRemote(sid);
    const r = { sid, name, skin, buf: [{ t: Net.serverNow() - 1000, x, y, anim, flip }], sprite: null, label: null, curAnim: -1 };
    Net.remotes.set(sid, r);
    if (Net.scene) Net.scene.spawnRemote(r);
  }
  function removeRemote(sid) {
    const r = Net.remotes.get(sid);
    if (!r) return;
    if (r.sprite) r.sprite.destroy();
    if (r.label) r.label.destroy();
    Net.remotes.delete(sid);
  }

  socket.on('roster:add', addRemote);
  socket.on('roster:remove', removeRemote);
  socket.on('s', (t, list) => {
    for (const [sid, x, y, anim, flip] of list) {
      const r = Net.remotes.get(sid);
      if (!r) continue;
      const b = r.buf;
      if (b.length && t <= b[b.length - 1].t) continue;
      b.push({ t, x, y, anim, flip });
      if (b.length > 30) b.splice(0, b.length - 30);
    }
  });
  socket.on('count', (n) => { $('hudCount').textContent = `👥 ${n}명 참여 중`; $('joinCount').textContent = `👥 ${n}명 접속 중`; });
  socket.on('state', (s) => applyState(s));
  socket.on('game:start', (s) => { applyState(s); if (Net.scene) Net.scene.onRoundStart(); });
  socket.on('game:end', ({ ranking }) => showResult(ranking));
  socket.on('disconnect', () => { if (Net.joined) toast('📡 연결이 끊겼어요… 다시 연결하는 중', 4000); });
  socket.on('connect', () => { Net.syncClock(); if (Net.joined) join(true); });

  function applyState(s) {
    Net.state = s;
    if (s.phase !== 'ended') $('result').classList.add('hidden');
  }

  /* ================= 입장 화면 ================= */
  const randKey = () => Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem('jt_profile') || '{}'); } catch { profile = {}; }
  let skin = Number.isInteger(profile.skin) ? profile.skin : Math.floor(Math.random() * S.SKIN_COUNT);
  $('nameInput').value = profile.name || '';

  const grid = $('skinGrid');
  for (let i = 0; i < S.SKIN_COUNT; i++) {
    const b = document.createElement('button');
    b.className = 'skin' + (i === skin ? ' sel' : '');
    b.type = 'button';
    const c = document.createElement('canvas');
    PIXEL.drawCharPreview(c, i, 3);
    b.append(c);
    b.onclick = () => { skin = i; [...grid.children].forEach((el, k) => el.classList.toggle('sel', k === i)); updateSkinLabel(); AUDIO.unlock(); AUDIO.sfx('pop'); };
    grid.append(b);
  }
  function updateSkinLabel() { $('skinLabel').textContent = `· ${PIXEL.ACC_NAME[PIXEL.skinInfo(skin).acc]} ${skin % 10 + 1}번`; }
  updateSkinLabel();
  $('joinBtn').onclick = () => join(false);
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(false); });

  function join(isRejoin) {
    AUDIO.unlock();
    const name = $('nameInput').value.trim();
    if (!name) { $('joinMsg').textContent = '닉네임을 써 주세요!'; return; }
    profile = { name, skin, key: profile.key || randKey() };
    $('joinBtn').disabled = true;
    socket.timeout(6000).emit('join', profile, (err, res) => {
      $('joinBtn').disabled = false;
      if (err || !res || !res.ok) { $('joinMsg').textContent = (res && res.reason) || '서버에 연결하지 못했어요. 잠시 후 다시!'; return; }
      profile.key = res.key;
      localStorage.setItem('jt_profile', JSON.stringify(profile));
      Net.mySid = res.you.sid;
      Net.me = res.you;
      applyState(res.state);
      for (const sid of [...Net.remotes.keys()]) removeRemote(sid);
      res.roster.forEach(addRemote);
      if (!isRejoin) startPhaser();
      else toast('📡 다시 연결됐어요!');
      Net.joined = true;
    });
  }

  async function startPhaser() {
    $('join').classList.add('hidden');
    $('stage').classList.remove('hidden');
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: 960, height: 540, backgroundColor: '#07061a',
      pixelArt: true, roundPixels: true, banner: false, disableContextMenu: true,
      render: { antialias: false, powerPreference: 'high-performance' },
      fps: { target: 60 },
      physics: { default: 'arcade', arcade: { gravity: { y: S.PHYS.gravity }, debug: false } },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [GameScene],
    });
  }

  /* ================= HUD · 퀴즈 · 결과 (DOM) ================= */
  let toastTimer = null;
  function toast(text, ms = 1800) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  function center(text, small) {
    const el = $('center');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.toggle('small', !!small);
    el.classList.remove('hidden');
  }

  const Quiz = {
    onPick: null, locked: true,
    show(tag) {
      $('quizTag').textContent = tag; $('quizQ').textContent = '문제를 불러오는 중…';
      $('quizChoices').innerHTML = ''; $('quizHint').textContent = ''; $('quizFeedback').textContent = '';
      $('quiz').classList.remove('hidden');
    },
    render(q, onPick) {
      this.locked = false; this.onPick = onPick;
      $('quizQ').textContent = q.question;
      const box = $('quizChoices');
      box.innerHTML = '';
      q.choices.forEach((c, i) => {
        const b = document.createElement('button');
        const n = document.createElement('b'); n.textContent = String(i + 1);
        b.append(n, document.createTextNode(c));
        b.onclick = () => this.pick(i);
        box.append(b);
      });
      $('quizHint').textContent = q.hint ? '💡 ' + q.hint : '';
    },
    pick(i) {
      if (this.locked || !this.onPick) return;
      this.locked = true;
      [...$('quizChoices').children].forEach((b) => { b.disabled = true; });
      this.onPick(i);
    },
    reveal(choice, answer, correct) {
      const bs = $('quizChoices').children;
      if (bs[answer]) bs[answer].classList.add('ok');
      if (!correct && bs[choice]) bs[choice].classList.add('no');
      $('quizFeedback').textContent = correct ? `🎉 정답! ⚡ 에너지 +${S.GAME.energyPerCorrect}  ⭐ +${S.GAME.pointsPerCorrect}점`
        : `😢 아쉬워요! 정답: ${bs[answer] ? bs[answer].textContent.slice(1) : ''}`;
    },
    hide() { $('quiz').classList.add('hidden'); this.onPick = null; this.locked = true; },
  };

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!$('quiz').classList.contains('hidden') && /^[1-4]$/.test(e.key)) Quiz.pick(Number(e.key) - 1);
    if (e.key === 'm' || e.key === 'M') toggleMute();
    if (e.key === 'n' || e.key === 'N') AUDIO.skip();
  });
  function toggleMute() { $('muteBtn').textContent = AUDIO.toggleMusic() ? '🔊' : '🔇'; }
  $('muteBtn').onclick = toggleMute;
  $('skipBtn').onclick = () => AUDIO.skip();
  AUDIO.onSong = (name) => { if (!$('stage').classList.contains('hidden')) toast(`🎵 ${name}`, 2200); };

  function showResult(ranking) {
    Net.state = { ...Net.state, phase: 'ended' };
    if (Net.scene) { Quiz.hide(); if (Net.scene.quizOpen) Net.scene.closeQuiz(); }
    const me = ranking.find((r) => r.sid === Net.mySid);
    $('myRank').textContent = me ? `${me.name} 님은 ${me.rank}등! ⭐ ${me.score}점 · 정답 ${me.correct}개 · 최고 ${me.best}m` : '';
    const ol = $('rankList');
    ol.innerHTML = '';
    for (const r of ranking.slice(0, 10)) {
      const li = document.createElement('li');
      li.textContent = `${r.name} — ${r.score}점 (정답 ${r.correct})`;
      if (me && r.sid === me.sid) li.className = 'me';
      ol.append(li);
    }
    $('result').classList.remove('hidden');
    AUDIO.sfx('summit');
  }

  $('teacherBtn').onclick = async () => {
    const pw = prompt('교사용 비밀번호를 입력하세요');
    if (pw == null) return;
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      const j = await r.json();
      if (!j.ok) return alert(j.error || '비밀번호가 틀렸어요.');
      localStorage.setItem('jt_admin', j.token);
      window.open('/teacher.html', '_blank');
    } catch { alert('서버에 연결하지 못했어요.'); }
  };

  /* ================= 게임 씬 ================= */
  const SNOW = { tex: 'p_snow', o: { x: { min: 0, max: 960 }, y: -10, speedY: { min: 35, max: 80 }, speedX: { min: -20, max: 20 }, lifespan: 9000, scale: { min: 1.5, max: 3 }, frequency: 45 } };
  const TWINKLE = (tints, freq) => ({ tex: 'p_star', o: { x: { min: 0, max: 960 }, y: { min: 0, max: 540 }, speed: 0, lifespan: 1600, scale: { start: 2.5, end: 0 }, tint: tints, frequency: freq } });
  const SHOOT = { tex: 'p_shoot', o: { x: { min: 300, max: 1000 }, y: { min: -10, max: 160 }, speedX: -520, speedY: 260, rotate: 153, lifespan: 1100, scale: 2, alpha: { start: 1, end: 0 }, frequency: 1700 } };
  const FALL = (tex, tints, freq, extra) => ({ tex, o: { x: { min: 0, max: 1000 }, y: -10, speedY: { min: 30, max: 70 }, speedX: { min: -35, max: 15 }, lifespan: 12000, scale: { min: 2, max: 3 }, rotate: { start: 0, end: 360 }, tint: tints, frequency: freq, ...(extra || {}) } });
  const FX = {
    embers: [{ tex: 'p_ember', o: { x: { min: 0, max: 960 }, y: 560, speedY: { min: -90, max: -30 }, speedX: { min: -15, max: 15 }, lifespan: 6500, scale: { min: 2, max: 3 }, alpha: { start: 1, end: 0 }, frequency: 90 } }],
    bubbles: [{ tex: 'p_bubble', o: { x: { min: 0, max: 960 }, y: 560, speedY: { min: -70, max: -25 }, speedX: { min: -8, max: 8 }, lifespan: 9000, scale: { min: 2, max: 3 }, frequency: 160 } },
      FALL('p_petal', [0xffffff], 420, { speedY: { min: 15, max: 35 } })],
    petals: [FALL('p_petal', [0xffffff, 0xfff0a0, 0xd0e0ff], 110), TWINKLE([0xfff6a8], 400)],
    leaves: [FALL('p_leaf', [0xffffff], 170)],
    sprinkles: [FALL('p_conf', [0xff4d6d, 0x4dc3ff, 0xffd23f, 0x7dff8a, 0xb388ff, 0xffffff], 60)],
    poppies: [FALL('p_petal', [0xff6060, 0xff3030], 220), TWINKLE([0x7dffb5, 0xfff6a8], 160)],
    snow: [SNOW],
    stars: [TWINKLE([0xffffff, 0xfff6a8, 0xffd0f0], 70), SHOOT],
    space: [TWINKLE([0xffffff, 0xfff6a8, 0xff8080, 0x80ff9a], 110), SHOOT],
    xmas: [{ ...SNOW, o: { ...SNOW.o, frequency: 25 } }, TWINKLE([0xffd23f, 0xff6060, 0x7dff8a], 160)],
    dust: [{ tex: 'p_dust', o: { x: { min: 960, max: 1000 }, y: { min: 0, max: 540 }, speedX: { min: -160, max: -80 }, speedY: { min: -10, max: 10 }, lifespan: 9000, scale: { min: 1.5, max: 2.5 }, tint: [0xf0d8a0, 0xe0c080], alpha: 0.7, frequency: 70 } }],
    fireflies: [{ tex: 'p_star', o: { x: { min: 0, max: 960 }, y: { min: 0, max: 540 }, speedX: { min: -15, max: 15 }, speedY: { min: -20, max: 5 }, lifespan: 3500, scale: { start: 2, end: 0.5 }, alpha: { start: 1, end: 0 }, tint: [0xd8ff80, 0xffe066, 0x80fff0], frequency: 120 } }],
  };

  class GameScene extends Phaser.Scene {
    constructor() { super('game'); }

    label(x, y, str, style) {
      const t = this.add.text(x, y, str, style || LABEL);
      t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      return t;
    }

    create() {
      Net.scene = this;
      PIXEL.registerTextures(this);
      this.physics.world.setBounds(0, S.TOP_LIMIT, S.WORLD_W, -S.TOP_LIMIT);   // 위로 무제한
      const cam = this.cameras.main;
      cam.setBounds(0, S.TOP_LIMIT, S.WORLD_W, -S.TOP_LIMIT).setRoundPixels(true);
      this.chunks = new Map(); this.bands = new Map(); this.treesSeen = new Set();
      $('hudZone').classList.add('hidden');

      this.platforms = this.physics.add.staticGroup();
      this.gifts = this.physics.add.staticGroup();
      this.springs = this.physics.add.staticGroup();

      this.skinKey = PIXEL.ensureSkin(this, profile.skin);
      this.player = this.physics.add.sprite(Net.me.x, Net.me.y, this.skinKey, 0).setScale(2).setDepth(10);
      this.player.body.setSize(14, 20).setOffset(5, 8);
      this.player.setCollideWorldBounds(true).setMaxVelocity(600, 950);
      this.player.play(this.skinKey + '_idle');
      this.myLabel = this.label(0, 0, profile.name, { ...LABEL, color: '#ffd23f' }).setOrigin(0.5, 1).setDepth(12);

      // 추락 장면 중에는 맨 밑바닥에만 부딪힌다
      this.physics.add.collider(this.player, this.platforms, null, (_pl, plat) => !this.waitLand || plat.isFloor === true);
      this.physics.add.overlap(this.player, this.gifts, (_p, g) => this.onGift(g));
      this.physics.add.overlap(this.player, this.springs, (_p, sp) => this.onSpring(sp));
      cam.startFollow(this.player, true, 1, 0.14, 0, 70);

      const kb = this.input.keyboard;
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', space: 'SPACE', a: 'A', d: 'D', w: 'W' });

      this.fx = {};
      for (const [k, list] of Object.entries(FX)) this.fx[k] = list.map(({ tex, o }) => this.add.particles(0, 0, tex, { ...o, emitting: false }).setScrollFactor(0).setDepth(-5));
      this.setSeed(Net.state.seed);
      this.puff = this.add.particles(0, 0, 'p_puff', { speed: { min: 40, max: 130 }, angle: { min: 30, max: 150 }, lifespan: 380, scale: { start: 3, end: 0 }, emitting: false }).setDepth(9);
      this.dust = this.add.particles(0, 0, 'p_dust', { speed: { min: 20, max: 70 }, angle: { min: 180, max: 360 }, lifespan: 300, scale: { start: 2, end: 0 }, gravityY: 200, emitting: false }).setDepth(9);
      this.conf = this.add.particles(0, 0, 'p_conf', { speed: { min: 200, max: 480 }, angle: { min: 220, max: 320 }, gravityY: 700, lifespan: 2200, scale: 3,
        tint: [0xff3b3b, 0xffd23f, 0x4dff88, 0x4dc3ff, 0xff7bd5], emitting: false }).setDepth(20);

      this.energy = 100; this.lapBest = Net.me.lapBest || 0; this.correct = Net.me.correct || 0;
      this.jumps = 0; this.coyote = -1e9; this.jumpBuf = -1e9; this.anim = 0;
      this.lastGroundY = this.player.y; this.lastGroundX = this.player.x; this.safeZone = 0; this.whooshed = false; this.respawning = false;
      this.lives = Net.me.lives != null ? Net.me.lives : S.GAME.lives; this.fallSeq = false;
      this.quizOpen = false; this.lastQuizAt = this.time.now; this.lastQuizClose = -1e9;
      this.lastSend = 0; this.lastSent = null; this.lastSentAt = 0; this.hudAt = 0;
      this.lastCount = null; this.wasRunning = false;

      for (const r of Net.remotes.values()) this.spawnRemote(r);
      if (Net.state.phase === 'playing' && Net.serverNow() < Net.state.startedAt) this.onRoundStart();
    }

    /* ---------- 무한 타워: 구역(청크) 단위로 만들고 지우기 ---------- */
    setSeed(seed) {
      for (const z of [...this.chunks.keys()]) this.unloadChunk(z);
      this.seed = seed;
      this.treesSeen.clear();
      this.zone = -1;
      this.updateZone(this.player.y);
    }

    themeAt(z) { return S.themeOf(this.seed, z); }

    ensureChunks(z) {
      for (let zz = Math.max(0, z - 1); zz <= z + 2; zz++) if (!this.chunks.has(zz)) this.loadChunk(zz);
      for (const zz of [...this.chunks.keys()]) if (zz < z - 2 || zz > z + 3) this.unloadChunk(zz);
      for (const zz of this.chunks.keys()) if (zz > 0 && this.chunks.has(zz - 1) && !this.bands.has(zz)) this.addBand(zz);
    }

    loadChunk(z) {
      const Z = S.buildZone(this.seed, z), t = Z.theme;
      const ch = { theme: t, objs: [], plats: [], gifts: [], springs: [], ambient: [], tree: null };
      ch.objs.push(this.add.image(0, S.zoneTop(z), PIXEL.ensureBg(this, t)).setOrigin(0).setScale(PIXEL.BG_SCALE).setDepth(-10));
      Z.platforms.forEach((p, i) => {
        // 텍스처는 위 8px 장식 + 아래 16px 발판. 충돌은 발판 부분만
        const s = this.platforms.create(p.x + p.w / 2, p.y - PIXEL.SURF + PIXEL.PLAT_H / 2, PIXEL.ensurePlatform(this, t, p.w, i % 3));
        s.body.setSize(p.w, PIXEL.PLAT_H - PIXEL.SURF, false);
        s.body.setOffset(0, PIXEL.SURF);
        const c = s.body.checkCollision;
        c.down = false; c.left = false; c.right = false;   // 아래에서 뚫고 올라가는 발판
        if (p.kind === 'floor') s.isFloor = true;
        ch.plats.push(s);
      });
      for (const sp of Z.springs) ch.springs.push(this.springs.create(sp.x, sp.y - 14, 'spring', 0).setScale(2).refreshBody().setDepth(4));
      for (const g of Z.gifts) {
        const s = this.gifts.create(g.x, g.y - 6, 'gift').setScale(2).refreshBody().setDepth(4);
        this.tweens.add({ targets: s, y: s.y - 4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        ch.gifts.push(s);
      }
      if (Z.tree) {   // 10구역마다 크리스마스 트리 기념 지점
        ch.objs.push(this.add.image(Z.tree.x, Z.tree.y, 'tree').setOrigin(0.5, 1).setScale(2).setDepth(3));
        ch.objs.push(this.label(Z.tree.x, Z.tree.y - 104, `🎄 ${S.heightOf(Z.tree.y - 30)}m`, { ...LABEL, fontSize: '16px', color: '#ffd23f' }).setOrigin(0.5, 1).setDepth(3));
        ch.tree = Z.tree;
      }
      this.addAmbient(ch, z);
      this.chunks.set(z, ch);
    }

    unloadChunk(z) {
      const ch = this.chunks.get(z);
      if (!ch) return;
      for (const o of ch.ambient.concat(ch.gifts)) this.tweens.killTweensOf(o);
      ch.objs.concat(ch.ambient).forEach((o) => o.destroy());
      ch.plats.forEach((o) => this.platforms.remove(o, true, true));
      ch.gifts.forEach((o) => this.gifts.remove(o, true, true));
      ch.springs.forEach((o) => this.springs.remove(o, true, true));
      for (const k of [z, z + 1]) { const b = this.bands.get(k); if (b) { b.destroy(); this.bands.delete(k); } }
      this.chunks.delete(z);
      // 더 이상 안 쓰는 배경 그림은 메모리에서 지운다(맵 100개라도 가볍게)
      const id = ch.theme.id;
      if (![...this.chunks.values()].some((c) => c.theme.id === id) && this.textures.exists('bg_' + id)) this.textures.remove('bg_' + id);
      const platKeys = this.textures.getTextureKeys().filter((k) => k.startsWith('plat_'));
      if (platKeys.length > 240) {
        const used = new Set([...this.chunks.values()].map((c) => `plat_${c.theme.plat}_${c.theme.platHue}_`));
        for (const k of platKeys) if (![...used].some((u) => k.startsWith(u))) this.textures.remove(k);
      }
    }

    // 구역 경계: 아래·위 배경 색을 섞어 부드럽게
    addBand(k) {
      const lower = PIXEL.bgEdges(this.chunks.get(k - 1).theme), upper = PIXEL.bgEdges(this.chunks.get(k).theme);
      if (!lower || !upper) return;
      const key = `band_${this.chunks.get(k).theme.id}_${this.chunks.get(k - 1).theme.id}`;
      if (!this.textures.exists(key)) {
        const c = document.createElement('canvas'); c.width = 4; c.height = 160;
        const g = c.getContext('2d');
        for (let y = 0; y < 160; y++) {
          const t = y / 159, a = Math.sin(Math.PI * t) * 0.92;
          const col = upper.bottom.map((v, i) => Math.round(v + (lower.top[i] - v) * t));
          g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`; g.fillRect(0, y, 4, 1);
        }
        this.textures.addCanvas(key, c).setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
      this.bands.set(k, this.add.image(0, S.zoneBottom(k) - 80, key).setOrigin(0).setDisplaySize(S.WORLD_W, 160).setDepth(-9.5));
    }

    addAmbient(ch, z) {
      const amb = ch.theme.amb;
      if (!amb) return;
      const rnd = S.mulberry32(4242 + z * 7 + this.seed);
      const top = S.zoneTop(z);
      const Y = (a, b) => top + S.ZONE_H * (a + rnd() * (b - a));
      const keep = (o) => { ch.ambient.push(o); return o; };
      const swim = (obj, dist, dur) => this.tweens.add({ targets: obj, x: obj.x + dist, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.inOut',
        onYoyo: () => obj.toggleFlipX(), onRepeat: () => obj.toggleFlipX() });
      const bob = (obj, dy, dur) => this.tweens.add({ targets: obj, y: obj.y + dy, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      if (amb === 'fish') for (let i = 0; i < 10; i++) { const f = keep(this.add.image(60 + rnd() * 400, Y(0.08, 0.9), 'fish' + (i % 3)).setScale(2).setDepth(-9).setAlpha(0.9)); swim(f, 300 + rnd() * 300, 7000 + rnd() * 7000); bob(f, 10, 1400 + rnd() * 800); }
      if (amb === 'birds') for (let i = 0; i < 6; i++) { const b = keep(this.add.sprite(40 + rnd() * 300, Y(0.08, 0.6), 'bird').setScale(2).setDepth(-9).play('bird_fly')); swim(b, 400 + rnd() * 200, 9000 + rnd() * 6000); }
      if (amb === 'clouds' || amb === 'sleigh') for (let i = 0; i < (amb === 'clouds' ? 8 : 4); i++) { const c = keep(this.add.image(rnd() * 960, Y(0.05, 0.85), 'cloud' + (i % 3)).setScale(2).setDepth(-9).setAlpha(0.85)); swim(c, 160 + rnd() * 200, 18000 + rnd() * 14000); }
      if (amb === 'butterflies') for (let i = 0; i < 9; i++) { const b = keep(this.add.sprite(40 + rnd() * 600, Y(0.1, 0.9), 'butterfly' + (i % 3)).setScale(2).setDepth(-9).play('flutter' + (i % 3))); swim(b, 150 + rnd() * 250, 5000 + rnd() * 4000); bob(b, 30, 900 + rnd() * 600); }
      if (amb === 'gums') for (let i = 0; i < 10; i++) { const g = keep(this.add.image(30 + rnd() * 900, Y(0.05, 0.9), 'gum' + (i % 4)).setScale(2.5).setDepth(-9)); bob(g, 24, 1800 + rnd() * 1500); this.tweens.add({ targets: g, angle: 20, duration: 2000 + rnd() * 1000, yoyo: true, repeat: -1 }); }
      if (amb === 'balloon') for (let i = 0; i < 2; i++) { const b = keep(this.add.image(100 + rnd() * 300, Y(0.15, 0.6), 'balloon').setScale(3).setDepth(-9)); swim(b, 350 + rnd() * 150, 20000 + rnd() * 8000); bob(b, 40, 3000); }
      if (amb === 'sleigh') { const sl = keep(this.add.image(-120, Y(0.12, 0.3), 'sleigh').setScale(2.5).setDepth(-9).setFlipX(true)); this.tweens.add({ targets: sl, x: 1100, duration: 14000, repeat: -1, repeatDelay: 4000 }); bob(sl, 20, 1200); }
    }

    spawnRemote(r) {
      if (r.sprite) return;
      const key = PIXEL.ensureSkin(this, r.skin);
      const b = r.buf[r.buf.length - 1];
      r.sprite = this.add.sprite(b.x, b.y, key, 0).setScale(2).setDepth(5);
      r.label = this.label(b.x, b.y - 32, r.name, LABEL).setOrigin(0.5, 1).setDepth(6);
      r.key = key;
    }

    /* ---------- 라운드·이동 ---------- */
    onRoundStart() {
      const st = Net.state;
      if (st.seed !== this.seed) this.setSeed(st.seed);
      Quiz.hide();
      if (this.quizOpen) this.closeQuiz();
      $('result').classList.add('hidden');
      this.energy = 100; this.lapBest = 0; this.correct = 0; this.lives = S.GAME.lives; this.treesSeen.clear();
      if (this.fallSeq) this.endFall();
      this.gifts.getChildren().forEach((g) => g.setVisible(true));
      this.teleport(S.WORLD_W / 2 + (Math.random() - 0.5) * 360, S.FLOOR_Y - 30);
      this.lastQuizAt = this.time.now + Math.max(0, st.startedAt - Net.serverNow());
      this.lastCount = null;
    }

    teleport(x, y) {
      if (this.fx) { Object.values(this.fx).forEach((list) => list.forEach((e) => { e.stop(); e.killAll(); })); this.zone = -1; }   // 다른 구역 눈·낙엽이 남지 않게
      this.player.setPosition(x, y);
      this.player.body.setVelocity(0, 0);
      this.lastGroundY = y; this.lastGroundX = x; this.whooshed = false; this.safeZone = S.zoneOf(y);
      this.cameras.main.centerOn(x, y - 70);
      this.lastSent = null;
      if (this.chunks) this.updateZone(y);   // 순간이동한 곳의 구역을 바로 만든다
    }

    respawn(zone, msg) {
      const cp = S.buildZone(this.seed, zone).checkpoint;
      this.respawning = true;
      this.teleport(cp.x, cp.y - 30);
      this.cameras.main.flash(250, 255, 255, 255);
      toast(msg);
      setTimeout(() => { this.respawning = false; }, 350);
    }

    update(time, delta) {
      const st = Net.state;
      const sNow = Net.serverNow();
      const countdown = st.phase === 'playing' && sNow < st.startedAt;
      const running = st.phase === 'playing' && !st.paused && !countdown;
      const frozen = this.quizOpen || this.respawning || this.fallSeq || countdown || (st.phase === 'playing' && st.paused) || st.phase === 'ended';
      const p = this.player;
      const body = p.body;
      const k = this.keys;
      const onGround = body.blocked.down || body.touching.down;

      if (this.waitLand && onGround && p.y > S.FLOOR_Y - 60) this.onFallLanded();
      if (onGround && !this.wasGround && this.prevVy > 380) { this.dust.explode(6, p.x, p.y + 28); if (this.prevVy > 700) AUDIO.sfx('land'); }
      this.wasGround = onGround; this.prevVy = body.velocity.y;
      if (onGround && !this.fallSeq) { this.coyote = time; this.jumps = 0; this.lastGroundY = p.y; this.lastGroundX = p.x; this.safeZone = S.zoneOf(p.y); this.whooshed = false; }

      if (frozen) {
        if (!this.quizOpen) body.setVelocityX(0);
      } else {
        const left = k.left.isDown || k.a.isDown;
        const right = k.right.isDown || k.d.isDown;
        body.setVelocityX(left && !right ? -S.PHYS.speed : right && !left ? S.PHYS.speed : 0);
        const JD = Phaser.Input.Keyboard.JustDown;
        if (JD(k.up) || JD(k.space) || JD(k.w)) this.jumpBuf = time;
        if (time - this.jumpBuf < 120) {
          if (time - this.coyote < 90 && this.jumps === 0) {
            body.setVelocityY(-S.PHYS.jump); this.jumps = 1; this.jumpBuf = -1e9; this.coyote = -1e9; AUDIO.sfx('jump');
          } else if (this.jumps < 2 && !onGround) {
            if (this.energy > 0 || !running) {
              body.setVelocityY(-S.PHYS.djump); this.jumps = 2; this.jumpBuf = -1e9; AUDIO.sfx('djump');
              this.puff.explode(8, p.x, p.y + 24);
            } else if (!this.noEnergyAt || time - this.noEnergyAt > 2500) {
              this.noEnergyAt = time; this.jumpBuf = -1e9;
              toast('⚡ 에너지가 없어요! 퀴즈를 맞히면 더블점프 충전');
            }
          }
        }
        // 키를 일찍 떼면 낮게 점프(조작감)
        const JU = Phaser.Input.Keyboard.JustUp;
        if ((JU(k.up) || JU(k.space) || JU(k.w)) && body.velocity.y < -220) body.setVelocityY(-220);
      }

      // 크게 떨어지면 슈웅~ 소리 + 체크포인트로
      if (!onGround && body.velocity.y > 0 && !this.respawning && !this.fallSeq) {
        const d = p.y - this.lastGroundY;
        if (d > 420 && !this.whooshed) { this.whooshed = true; AUDIO.sfx('whoosh'); this.cameras.main.shake(300, 0.004); }
        // 바닥보다 충분히 높은 곳에서 크게 떨어지면 → 맨 밑바닥까지 추락 장면 + 생명 1개로 복귀
        if (d > 600 && S.FLOOR_Y - this.lastGroundY > S.GAME.bigFall) this.startFall();
      }

      if (running) {
        this.energy = Math.max(0, this.energy - S.GAME.energyDrain * (delta / 1000));
        const h = S.heightOf(p.y);
        if (h > this.lapBest) this.lapBest = h;
        if (!this.quizOpen && !this.fallSeq && time - this.lastQuizAt > S.GAME.quizEvery * 1000) this.openQuiz('time');
      }

      const anim = !onGround ? (body.velocity.y < 0 ? 2 : 3) : Math.abs(body.velocity.x) > 10 ? 1 : 0;
      if (anim !== this.anim) { this.anim = anim; p.play(this.skinKey + ANIMS[anim]); }
      if (body.velocity.x < 0) p.setFlipX(true); else if (body.velocity.x > 0) p.setFlipX(false);
      this.myLabel.setPosition(p.x, p.y - 32);

      this.sendPosition(time, anim);
      this.renderRemotes(sNow);
      this.updateZone(p.y);
      this.checkTrees(p);
      if (time - this.hudAt > 120) { this.hudAt = time; this.updateHud(sNow, countdown, running); }
    }

    sendPosition(time, anim, force) {
      if (!force && time - this.lastSend < 1000 / S.NET.sendHz) return;
      this.lastSend = time;
      const p = this.player;
      const msg = [Math.round(p.x), Math.round(p.y), anim, p.flipX ? 1 : 0];
      const ls = this.lastSent;
      if (!force && ls && ls[0] === msg[0] && ls[1] === msg[1] && ls[2] === msg[2] && ls[3] === msg[3] && time - this.lastSentAt < 1000) return;
      if (force) socket.emit('m', msg); else socket.volatile.emit('m', msg);
      this.lastSent = msg; this.lastSentAt = time;
    }

    renderRemotes(sNow) {
      const rt = sNow - S.NET.interpDelay;
      const camMid = this.cameras.main.scrollY + 270;
      for (const r of Net.remotes.values()) {
        if (!r.sprite) continue;
        const b = r.buf;
        while (b.length >= 2 && b[1].t <= rt) b.shift();
        let s = b[0];
        if (b.length >= 2 && rt > b[0].t) {
          const a = b[0], c = b[1];
          if (Math.abs(c.y - a.y) > 300 || Math.abs(c.x - a.x) > 300) s = c;          // 순간이동은 보간 안 함
          else { const t = (rt - a.t) / (c.t - a.t); s = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, anim: a.anim, flip: a.flip }; }
        }
        const vis = Math.abs(s.y - camMid) < 520;                                      // 화면 밖은 그리지 않음
        r.sprite.setVisible(vis); r.label.setVisible(vis);
        if (!vis) continue;
        r.sprite.setPosition(s.x, s.y);
        r.label.setPosition(s.x, s.y - 32);
        if (s.anim !== r.curAnim) { r.curAnim = s.anim; r.sprite.play(r.key + (ANIMS[s.anim] || '_idle')); }
        r.sprite.setFlipX(!!s.flip);
      }
    }

    updateZone(y) {
      const z = S.zoneOf(y);
      if (z === this.zone) return;
      if (this.zone >= 0) this.fx[this.themeAt(this.zone).fx].forEach((e) => e.stop());
      this.fx[this.themeAt(z).fx].forEach((e) => e.start());
      this.zone = z;
      this.ensureChunks(z);
    }

    /* ---------- 추락 장면 → 생명 1개로 원래 자리 복귀 ---------- */
    startFall() {
      const p = this.player;
      this.fallSeq = true;
      const back = { x: this.lastGroundX, y: this.lastGroundY };
      const fromH = S.heightOf(back.y);
      if (this.quizOpen) { Quiz.hide(); this.closeQuiz(); }
      p.body.moves = false; p.body.setVelocity(0, 0);
      p.play(this.skinKey + '_fall');
      this.anim = 3;
      AUDIO.sfx('fall');
      $('fallfx').classList.remove('hidden');
      center('으아아아~!', true);
      // 1단계: 빙글빙글 돌며 빠르게 떨어진다(높이 숫자가 0까지 줄어듦)
      this.tweens.add({ targets: p, angle: 1080, duration: 1500 });
      this.tweens.add({ targets: p, y: p.y + 700, duration: 700, ease: 'Quad.in' });
      const counter = { h: fromH };
      this.fallCounter = this.tweens.add({ targets: counter, h: 0, duration: 1500, ease: 'Quad.in', onUpdate: () => { $('hudHeight').textContent = `📏 ${Math.round(counter.h)} m ↓↓↓`; } });
      this.time.delayedCall(800, () => {
        // 2단계: 맨 밑바닥 위 하늘로 순간이동해서 바닥까지 쾅
        this.cameras.main.flash(200, 255, 255, 255);
        this.teleport(p.x, S.FLOOR_Y - 700);
        this.fallSeq = true;
        p.body.moves = true; p.body.setVelocity(0, 900);
        this.waitLand = true;
      });
      this.fallBack = back;
    }

    onFallLanded() {
      const p = this.player;
      this.waitLand = false;
      this.tweens.killTweensOf(p); p.setAngle(0);
      if (this.fallCounter) this.fallCounter.stop();
      $('fallfx').classList.add('hidden');
      this.cameras.main.shake(450, 0.02);
      this.dust.explode(24, p.x, p.y + 28);
      AUDIO.sfx('thud');
      center('쿵!💫');
      p.body.setVelocity(0, 0); p.body.moves = false;
      this.time.delayedCall(900, () => {
        const back = this.fallBack;
        socket.timeout(4000).emit('life:use', { x: Math.round(back.x), y: Math.round(back.y) }, (err, res) => {
          if (!err && res && res.ok) {
            if (res.lives != null) this.lives = res.lives;
            center(res.free ? '✨ 연습 시간이라 생명은 그대로!' : `💔 생명 1개 사용! (남은 생명 ${this.lives})`, true);
            AUDIO.sfx('heal');
            this.time.delayedCall(900, () => {
              this.teleport(back.x, back.y - 2);
              this.puff.explode(16, back.x, back.y);
              this.cameras.main.flash(300, 255, 240, 200);
              this.endFall();
            });
          } else {
            if (res && res.lives != null) this.lives = res.lives;
            center('🤍 생명이 없어요! 여기서 다시 올라가요 (퀴즈를 맞히면 생명 +1)', true);
            this.time.delayedCall(1800, () => this.endFall());
          }
        });
      });
    }

    endFall() {
      this.fallSeq = false; this.waitLand = false;
      this.tweens.killTweensOf(this.player); this.player.setAngle(0);
      this.player.body.moves = true;
      $('fallfx').classList.add('hidden');
      center(null);
      this.lastSent = null;
    }

    // 10구역마다 트리 기념 지점 통과 축하
    checkTrees(p) {
      for (const ch of this.chunks.values()) {
        const t = ch.tree;
        if (!t || this.treesSeen.has(t.n) || Math.abs(p.x - t.x) > 160 || Math.abs(p.y - (t.y - 30)) > 90) continue;
        this.treesSeen.add(t.n);
        this.conf.explode(70, t.x, t.y - 60);
        AUDIO.sfx('summit');
        toast(`🎄 ${S.heightOf(t.y - 30)}m 돌파! 계속 올라가요!`, 2500);
      }
    }

    updateHud(sNow, countdown, running) {
      const st = Net.state;
      $('hudHeight').textContent = `📏 ${S.heightOf(this.player.y)} m · 최고 ${this.lapBest} m`;
      $('hudScore').textContent = `⭐ ${this.lapBest + this.correct * S.GAME.pointsPerCorrect}점`;
      const hearts = '❤️'.repeat(Math.max(0, this.lives)) + '🤍'.repeat(Math.max(0, S.GAME.lives - this.lives));
      if ($('hudLives').textContent !== hearts) $('hudLives').textContent = hearts;
      const fill = $('energyFill');
      fill.style.width = `${this.energy}%`;
      fill.classList.toggle('low', this.energy < 25);

      let rem = null;
      let phase = '';
      if (st.phase === 'lobby') { phase = '🛝 연습 시간 · 선생님이 곧 시작해요'; }
      else if (st.phase === 'ended') { rem = 0; phase = '🏁 게임 끝'; }
      else if (countdown) { rem = st.duration * 1000; phase = '준비!'; }
      else if (st.paused) { rem = st.remaining; phase = '⏸ 일시정지'; }
      else { rem = st.endsAt - sNow; phase = '🎁 선물 상자를 먹거나 30초마다 퀴즈!'; }
      const timer = $('hudTimer');
      if (rem == null) timer.textContent = '--:--';
      else { const s = Math.max(0, Math.ceil(rem / 1000)); timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
      timer.classList.toggle('warn', running && rem != null && rem < 10500);
      $('hudPhase').textContent = phase;

      if (countdown) {
        const n = Math.ceil((st.startedAt - sNow) / 1000);
        if (n !== this.lastCount) { this.lastCount = n; center(String(n)); AUDIO.sfx('beep'); }
      } else if (this.lastCount != null && st.phase === 'playing') {
        this.lastCount = null; center('GO!'); AUDIO.sfx('go');
        setTimeout(() => center(null), 700);
      } else if (st.phase === 'playing' && st.paused) center('⏸ 일시정지', true);
      else if (!$('center').classList.contains('hidden') && $('center').textContent === '⏸ 일시정지') center(null);
    }

    /* ---------- 스프링·배경 소품 ---------- */
    onSpring(sp) {
      const body = this.player.body;
      if (this.quizOpen || this.respawning || this.fallSeq || body.velocity.y < -60 || this.time.now - (sp.lastBoing || 0) < 250) return;
      sp.lastBoing = this.time.now;
      body.setVelocityY(-S.PHYS.spring);
      this.jumps = 1; this.coyote = -1e9; this.whooshed = false;
      sp.setFrame(1);
      this.tweens.add({ targets: sp, scaleX: 2.3, scaleY: 1.7, duration: 70, yoyo: true, onComplete: () => { sp.setFrame(0); sp.setScale(2); } });
      this.puff.explode(10, sp.x, sp.y - 6);
      AUDIO.sfx('boing');
    }

    /* ---------- 퀴즈·선물·정상 ---------- */
    onGift(g) {
      if (!g.visible || this.fallSeq) return;
      const st = Net.state;
      const running = st.phase === 'playing' && !st.paused && Net.serverNow() >= st.startedAt;
      if (!running) {
        if (!this.giftHintAt || this.time.now - this.giftHintAt > 3000) { this.giftHintAt = this.time.now; toast('🎁 게임이 시작되면 열 수 있어요'); }
        return;
      }
      if (this.quizOpen || this.time.now - this.lastQuizClose < 1200) return;
      g.setVisible(false);
      this.time.delayedCall(S.GAME.giftRespawnMs, () => { if (g.active) g.setVisible(true); });
      AUDIO.sfx('gift');
      this.openQuiz('gift');
    }

    openQuiz(src) {
      if (this.quizOpen) return;
      this.quizOpen = true;
      this.player.body.setVelocity(0, 0);
      this.player.body.moves = false;
      Quiz.show(src === 'gift' ? '🎁 선물 상자 퀴즈!' : '⏰ 퀴즈 타임!');
      socket.timeout(5000).emit('quiz:next', {}, (err, res) => {
        if (err || !res || !res.ok) { Quiz.hide(); this.closeQuiz(); toast((res && res.reason) || '문제를 받지 못했어요'); return; }
        Quiz.render(res.q, (choice) => this.answer(res.q, choice));
      });
    }

    answer(q, choice) {
      socket.timeout(5000).emit('quiz:answer', { id: q.id, choice }, (err, res) => {
        if (err || !res || !res.ok) { Quiz.hide(); this.closeQuiz(); return; }
        Quiz.reveal(choice, res.answer, res.correct);
        if (res.correct) {
          AUDIO.sfx('correct');
          this.energy = Math.min(100, this.energy + S.GAME.energyPerCorrect);
          this.correct = res.correctCount;
          if (res.lives != null && res.lives > this.lives) { this.lives = res.lives; toast('❤️ 생명 +1!'); AUDIO.sfx('heal'); }
        } else AUDIO.sfx('wrong');
        setTimeout(() => { Quiz.hide(); if (this.quizOpen) this.closeQuiz(); }, res.correct ? 900 : 1800);   // 실제 시간 기준
      });
    }

    closeQuiz() {
      this.quizOpen = false;
      this.player.body.moves = true;
      this.lastQuizAt = this.time.now;
      this.lastQuizClose = this.time.now;
    }

  }

  if (new URLSearchParams(location.search).has('debug')) window.__jt = { Net, Quiz };   // 개발 점검용
  Net.syncClock();
})();
