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
  const ANIMS = ['_idle', '_run', '_jump'];
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
  });
  function toggleMute() { $('muteBtn').textContent = AUDIO.toggleMusic() ? '🔊' : '🔇'; }
  $('muteBtn').onclick = toggleMute;

  function showResult(ranking) {
    Net.state = { ...Net.state, phase: 'ended' };
    if (Net.scene) { Quiz.hide(); if (Net.scene.quizOpen) Net.scene.closeQuiz(); }
    const me = ranking.find((r) => r.sid === Net.mySid);
    $('myRank').textContent = me ? `${me.name} 님은 ${me.rank}등! ⭐ ${me.score}점 · 정답 ${me.correct}개 · 정상 ${me.laps}번` : '';
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
  const FX = [
    [{ tex: 'p_ember', o: { x: { min: 0, max: 960 }, y: 560, speedY: { min: -90, max: -30 }, speedX: { min: -15, max: 15 }, lifespan: 6500, scale: { min: 2, max: 3 }, alpha: { start: 1, end: 0 }, frequency: 90 } }],
    [{ tex: 'p_bubble', o: { x: { min: 0, max: 960 }, y: 560, speedY: { min: -70, max: -25 }, speedX: { min: -8, max: 8 }, lifespan: 9000, scale: { min: 2, max: 3 }, frequency: 160 } },
     { tex: 'p_petal', o: { x: { min: 0, max: 960 }, y: -10, speedY: { min: 15, max: 35 }, speedX: { min: -25, max: 25 }, lifespan: 16000, scale: 3, rotate: { min: 0, max: 360 }, frequency: 420 } }],
    [{ tex: 'p_leaf', o: { x: { min: 0, max: 1000 }, y: -10, speedY: { min: 40, max: 80 }, speedX: { min: -45, max: 10 }, lifespan: 9000, scale: { min: 2, max: 3 }, rotate: { start: 0, end: 360 }, frequency: 170 } }],
    [{ tex: 'p_snow', o: { x: { min: 0, max: 960 }, y: -10, speedY: { min: 35, max: 80 }, speedX: { min: -20, max: 20 }, lifespan: 9000, scale: { min: 1.5, max: 3 }, frequency: 45 } }],
    [{ tex: 'p_star', o: { x: { min: 0, max: 960 }, y: { min: 0, max: 540 }, speed: 0, lifespan: 1600, scale: { start: 2.5, end: 0 }, tint: [0xffffff, 0xfff6a8, 0xff8080, 0x80ff9a], frequency: 110 } },
     { tex: 'p_snow', o: { x: { min: 0, max: 960 }, y: -10, speedY: { min: 20, max: 40 }, lifespan: 15000, scale: 2, alpha: 0.6, frequency: 300 } }],
  ];

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
      this.physics.world.setBounds(0, 0, S.WORLD_W, S.WORLD_H);
      const cam = this.cameras.main;
      cam.setBounds(0, 0, S.WORLD_W, S.WORLD_H).setRoundPixels(true);
      for (let z = 0; z < S.ZONES.length; z++) this.add.image(0, S.zoneTop(z), 'bg' + z).setOrigin(0).setScale(4).setDepth(-10);

      this.platforms = this.physics.add.staticGroup();
      this.gifts = this.physics.add.staticGroup();
      this.decor = [];

      this.skinKey = PIXEL.ensureSkin(this, profile.skin);
      this.player = this.physics.add.sprite(Net.me.x, Net.me.y, this.skinKey, 0).setScale(3).setDepth(10);
      this.player.body.setSize(12, 16).setOffset(2, 4);
      this.player.setCollideWorldBounds(true).setMaxVelocity(600, 950);
      this.player.play(this.skinKey + '_idle');
      this.myLabel = this.label(0, 0, profile.name, { ...LABEL, color: '#ffd23f' }).setOrigin(0.5, 1).setDepth(12);

      this.buildLevel(Net.state.seed);
      this.physics.add.collider(this.player, this.platforms);
      this.physics.add.overlap(this.player, this.gifts, (_p, g) => this.onGift(g));
      cam.startFollow(this.player, true, 1, 0.14, 0, 70);

      const kb = this.input.keyboard;
      this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP', space: 'SPACE', a: 'A', d: 'D', w: 'W' });

      this.fx = FX.map((list) => list.map(({ tex, o }) => {
        const e = this.add.particles(0, 0, tex, { ...o, emitting: false }).setScrollFactor(0).setDepth(-5);
        return e;
      }));
      this.puff = this.add.particles(0, 0, 'p_puff', { speed: { min: 40, max: 130 }, angle: { min: 30, max: 150 }, lifespan: 380, scale: { start: 3, end: 0 }, emitting: false }).setDepth(9);
      this.conf = this.add.particles(0, 0, 'p_conf', { speed: { min: 200, max: 480 }, angle: { min: 220, max: 320 }, gravityY: 700, lifespan: 2200, scale: 3,
        tint: [0xff3b3b, 0xffd23f, 0x4dff88, 0x4dc3ff, 0xff7bd5], emitting: false }).setDepth(20);

      this.energy = 100; this.laps = Net.me.laps || 0; this.lapBest = Net.me.lapBest || 0; this.correct = Net.me.correct || 0;
      this.jumps = 0; this.coyote = -1e9; this.jumpBuf = -1e9; this.anim = 0;
      this.lastGroundY = this.player.y; this.safeZone = 0; this.whooshed = false; this.respawning = false;
      this.quizOpen = false; this.lastQuizAt = this.time.now; this.lastQuizClose = -1e9;
      this.lastSend = 0; this.lastSent = null; this.lastSentAt = 0; this.hudAt = 0;
      this.zone = -1; this.lastCount = null; this.wasRunning = false; this.summitLock = false;

      for (const r of Net.remotes.values()) this.spawnRemote(r);
      if (Net.state.phase === 'playing' && Net.serverNow() < Net.state.startedAt) this.onRoundStart();
    }

    buildLevel(seed) {
      this.seed = seed;
      this.level = S.buildLevel(seed);
      this.decor.forEach((d) => d.destroy());
      this.decor = [];
      this.platforms.clear(true, true);
      this.gifts.clear(true, true);
      if (this.summitOverlap) { this.summitOverlap.destroy(); this.summitZone.destroy(); }

      for (const p of this.level.platforms) {
        const s = this.platforms.create(p.x + p.w / 2, p.y + 8, PIXEL.ensurePlatform(this, p.zone, p.w));
        const c = s.body.checkCollision;
        c.down = false; c.left = false; c.right = false;   // 아래에서 뚫고 올라가는 발판
        if (p.kind === 'checkpoint') {
          const z = S.ZONES[p.zone];
          this.decor.push(this.label(p.x + p.w / 2, p.y - 6, `${z.emoji} ${z.name} · ${z.season}`, { ...LABEL, fontSize: '15px', color: '#fff6a8' }).setOrigin(0.5, 1).setDepth(3));
        }
      }
      for (const g of this.level.gifts) {
        const s = this.gifts.create(g.x, g.y - 4, 'gift').setScale(2.5).refreshBody();
        s.setDepth(4);
        this.decor.push(this.tweens.add({ targets: s, y: s.y - 4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
      }
      const sm = this.level.summit;
      this.decor.push(this.add.image(sm.x, sm.y, 'tree').setOrigin(0.5, 1).setScale(3).setDepth(3));
      this.decor.push(this.label(sm.x, sm.y - 110, '🎄 GOAL!', { ...LABEL, fontSize: '18px', color: '#ffd23f' }).setOrigin(0.5, 1).setDepth(3));
      this.summitZone = this.add.zone(sm.x, sm.y - 45, 170, 90);
      this.physics.add.existing(this.summitZone, true);
      this.summitOverlap = this.physics.add.overlap(this.player, this.summitZone, () => this.onSummit());
    }

    spawnRemote(r) {
      if (r.sprite) return;
      const key = PIXEL.ensureSkin(this, r.skin);
      const b = r.buf[r.buf.length - 1];
      r.sprite = this.add.sprite(b.x, b.y, key, 0).setScale(3).setDepth(5);
      r.label = this.label(b.x, b.y - 34, r.name, LABEL).setOrigin(0.5, 1).setDepth(6);
      r.key = key;
    }

    /* ---------- 라운드·이동 ---------- */
    onRoundStart() {
      const st = Net.state;
      if (st.seed !== this.seed) this.buildLevel(st.seed);
      Quiz.hide();
      if (this.quizOpen) this.closeQuiz();
      $('result').classList.add('hidden');
      this.energy = 100; this.laps = 0; this.lapBest = 0; this.correct = 0;
      this.gifts.getChildren().forEach((g) => g.setVisible(true));
      this.teleport(S.WORLD_W / 2 + (Math.random() - 0.5) * 360, S.FLOOR_Y - 30);
      this.lastQuizAt = this.time.now + Math.max(0, st.startedAt - Net.serverNow());
      this.lastCount = null;
    }

    teleport(x, y) {
      this.player.setPosition(x, y);
      this.player.body.setVelocity(0, 0);
      this.lastGroundY = y; this.whooshed = false; this.safeZone = S.zoneOf(y);
      this.cameras.main.centerOn(x, y - 70);
      this.lastSent = null;
    }

    respawn(zone, msg) {
      const cp = this.level.checkpoints[zone] || this.level.checkpoints[0];
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
      const frozen = this.quizOpen || this.respawning || countdown || (st.phase === 'playing' && st.paused) || st.phase === 'ended';
      const p = this.player;
      const body = p.body;
      const k = this.keys;
      const onGround = body.blocked.down || body.touching.down;

      if (onGround) { this.coyote = time; this.jumps = 0; this.lastGroundY = p.y; this.safeZone = S.zoneOf(p.y); this.whooshed = false; }

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
              this.puff.explode(8, p.x, p.y + 26);
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
      if (!onGround && body.velocity.y > 0 && !this.respawning) {
        const d = p.y - this.lastGroundY;
        if (d > 420 && !this.whooshed) { this.whooshed = true; AUDIO.sfx('whoosh'); this.cameras.main.shake(300, 0.004); }
        if (d > 900) this.respawn(this.safeZone, '슈웅~ 이 구역 출발점으로 돌아가요!');
      }

      if (running) {
        this.energy = Math.max(0, this.energy - S.GAME.energyDrain * (delta / 1000));
        const h = S.heightOf(p.y);
        if (h > this.lapBest) this.lapBest = h;
        if (!this.quizOpen && time - this.lastQuizAt > S.GAME.quizEvery * 1000) this.openQuiz('time');
      }

      const anim = !onGround ? 2 : Math.abs(body.velocity.x) > 10 ? 1 : 0;
      if (anim !== this.anim) { this.anim = anim; p.play(this.skinKey + ANIMS[anim]); }
      if (body.velocity.x < 0) p.setFlipX(true); else if (body.velocity.x > 0) p.setFlipX(false);
      this.myLabel.setPosition(p.x, p.y - 34);

      this.sendPosition(time, anim);
      this.renderRemotes(sNow);
      this.updateZone(p.y);
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
        r.label.setPosition(s.x, s.y - 34);
        if (s.anim !== r.curAnim) { r.curAnim = s.anim; r.sprite.play(r.key + (ANIMS[s.anim] || '_idle')); }
        r.sprite.setFlipX(!!s.flip);
      }
    }

    updateZone(y) {
      const z = S.zoneOf(y);
      if (z === this.zone) return;
      if (this.zone >= 0) this.fx[this.zone].forEach((e) => e.stop());
      this.fx[z].forEach((e) => e.start());
      if (this.zone >= 0) { const Z = S.ZONES[z]; toast(`${Z.emoji} ${Z.name} — ${Z.season}`); }
      this.zone = z;
    }

    updateHud(sNow, countdown, running) {
      const st = Net.state;
      const Z = S.ZONES[this.zone < 0 ? 0 : this.zone];
      $('hudZone').textContent = `${Z.emoji} ${Z.name}`;
      $('hudHeight').textContent = `📏 ${S.heightOf(this.player.y)} m · 최고 ${this.lapBest} m`;
      $('hudScore').textContent = `⭐ ${this.laps * S.GAME.lapBonus + this.lapBest + this.correct * S.GAME.pointsPerCorrect}점`;
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

    /* ---------- 퀴즈·선물·정상 ---------- */
    onGift(g) {
      if (!g.visible) return;
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

    onSummit() {
      if (this.summitLock || this.respawning) return;
      this.summitLock = true;
      const sm = this.level.summit;
      this.conf.explode(70, sm.x, sm.y - 60);
      AUDIO.sfx('summit');
      this.sendPosition(this.time.now, this.anim, true);   // 서버가 정상 위치를 먼저 받도록
      socket.timeout(4000).emit('summit', {}, (err, res) => {
        const st = Net.state;
        if (!err && res && res.ok && st.phase === 'playing') {
          this.laps = res.laps; this.lapBest = 0;
          toast(`🎄 정상 도착! +${S.GAME.lapBonus}점 · 처음부터 다시 도전!`, 2500);
        } else toast('🎄 정상 도착! 메리 크리스마스!', 2500);
      });
      setTimeout(() => {
        this.teleport(S.WORLD_W / 2 + (Math.random() - 0.5) * 300, S.FLOOR_Y - 30);
        this.summitLock = false;
      }, 1700);
    }
  }

  if (new URLSearchParams(location.search).has('debug')) window.__jt = { Net, Quiz };   // 개발 점검용
  Net.syncClock();
})();
