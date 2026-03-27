// =============================================
//  FLAPPY BIRD — with Sound Effects + Medium Difficulty
// =============================================

let config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 300 },
      debug: false
    }
  },
  scene: {
    preload: preload,
    create: create,
    update: update
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

let game = new Phaser.Game(config);

// ── State ──────────────────────────────────
let bird;
let hasLanded     = false;
let hasBumped     = false;
let isGameStarted = false;

let cursors;
let topColumns, bottomColumns;
let columnSpawnTimer;

let score     = 0;
let highScore = parseInt(localStorage.getItem('flappyHighScore') || '0');
let scoreText, highScoreText, messageToPlayer, medalText;

let nightMode  = false;
let background;

// ── Web Audio Context (zero asset files needed) ─
let audioCtx = null;

function getAudioCtx () {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// Generic tone builder
function playTone (frequency, type, duration, volume = 0.3, startFreq = null) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq || frequency, ctx.currentTime);
    if (startFreq) {
      osc.frequency.exponentialRampToValueAtTime(frequency, ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* silently fail */ }
}

// 🐦 Flap — short upward chirp
function soundFlap () {
  playTone(600, 'sine', 0.08, 0.25, 300);
}

// ✅ Score — quick double ding
function soundScore () {
  playTone(880,  'sine', 0.12, 0.28);
  setTimeout(() => playTone(1100, 'sine', 0.12, 0.22), 80);
}

// 💀 Death — descending buzz thud
function soundDeath () {
  playTone(200, 'sawtooth', 0.4, 0.5, 400);
  setTimeout(() => playTone(80, 'square', 0.35, 0.4, 150), 150);
}

// 🎉 Milestone — little 4-note fanfare
function soundMilestone () {
  [523, 659, 784, 1047].forEach((freq, i) => {
    setTimeout(() => playTone(freq, 'sine', 0.18, 0.3), i * 80);
  });
}

// 🌙 Night toggle — whoosh sweep
function soundNightToggle () {
  playTone(300, 'sine', 0.25, 0.15, 600);
}

// ── Preload ────────────────────────────────
function preload () {
  this.load.image('background', 'assets/background.png');
  this.load.image('road',       'assets/road.png');
  this.load.image('column',     'assets/column.png');
  this.load.spritesheet('bird', 'assets/bird.png', {
    frameWidth: 64, frameHeight: 96
  });
}

// ── Create ─────────────────────────────────
function create () {
  const W = this.scale.width;
  const H = this.scale.height;

  // Background
  background = this.add.image(0, 0, 'background')
    .setOrigin(0, 0)
    .setDisplaySize(W, H);

  // Ground
  const roads = this.physics.add.staticGroup();
  roads.create(W / 2, H - 32, 'road')
    .setDisplaySize(W, 64)
    .refreshBody();

  // Column groups
  topColumns    = this.physics.add.group();
  bottomColumns = this.physics.add.group();

  // Bird
  bird = this.physics.add.sprite(W * 0.15, H / 2, 'bird').setScale(2);
  bird.setBounce(0.15);
  bird.setCollideWorldBounds(true);

  // Bird animation (if multi-frame spritesheet)
  if (this.textures.get('bird').frameTotal > 1) {
    this.anims.create({
      key: 'flap',
      frames: this.anims.generateFrameNumbers('bird', { start: 0, end: 2 }),
      frameRate: 10,
      repeat: -1
    });
    bird.play('flap');
  }

  // Colliders — guard double-trigger with hasLanded/hasBumped check
  this.physics.add.collider(bird, roads, () => {
    if (!hasLanded && !hasBumped) { hasLanded = true; soundDeath(); endGame.call(this); }
  });
  this.physics.add.collider(bird, topColumns, () => {
    if (!hasLanded && !hasBumped) { hasBumped = true; soundDeath(); endGame.call(this); }
  });
  this.physics.add.collider(bird, bottomColumns, () => {
    if (!hasLanded && !hasBumped) { hasBumped = true; soundDeath(); endGame.call(this); }
  });

  // Column spawn timer — medium: delay shrinks with score, floors at 900 ms
  columnSpawnTimer = this.time.addEvent({
    delay: 1800,
    callback: () => {
      spawnColumns.call(this);
      columnSpawnTimer.delay = Math.max(900, 1800 - score * 15);
    },
    callbackScope: this,
    loop: true
  });

  // ── Input ────────────────────────────────
  cursors = this.input.keyboard.createCursorKeys();

  this.input.keyboard.on('keydown-SPACE', () => {
    if (!isGameStarted)         { startGame.call(this); }
    else if (hasLanded || hasBumped) { restartGame(); }
    else                        { flapBird(); }
  });

  this.input.on('pointerdown', () => {
    if (!isGameStarted)         { startGame.call(this); }
    else if (hasLanded || hasBumped) { restartGame(); }
    else                        { flapBird(); }
  });

  // ── UI ───────────────────────────────────
  const textStyle = {
    fontSize: '22px',
    fontFamily: '"Press Start 2P", monospace, sans-serif',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4
  };

  scoreText = this.add.text(16, 16, 'SCORE: 0', textStyle).setDepth(10);

  highScoreText = this.add.text(16, 52, `BEST: ${highScore}`, {
    ...textStyle, fontSize: '16px', color: '#ffe066'
  }).setDepth(10);

  medalText = this.add.text(W / 2, H / 2 - 80, '', {
    ...textStyle, fontSize: '52px'
  }).setOrigin(0.5).setDepth(10);

  messageToPlayer = this.add.text(W / 2, H / 2 + 20, '🐦 Tap or SPACE to start!', {
    fontSize: '18px',
    fontFamily: '"Press Start 2P", monospace, sans-serif',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4,
    align: 'center',
    wordWrap: { width: W * 0.8 }
  }).setOrigin(0.5).setDepth(10);

  // 🔊 Mute button
  let muted = false;
  const muteBtn = this.add.text(W - 16, 16, '🔊', { fontSize: '24px' })
    .setOrigin(1, 0).setDepth(10).setInteractive();
  muteBtn.on('pointerdown', () => {
    muted = !muted;
    muteBtn.setText(muted ? '🔇' : '🔊');
    const ctx = getAudioCtx();
    muted ? ctx.suspend() : ctx.resume();
  });

  // 🌙 Night mode button
  this.add.text(W - 16, 56, '🌙', { fontSize: '22px' })
    .setOrigin(1, 0).setDepth(10).setInteractive()
    .on('pointerdown', () => toggleNightMode.call(this));
}

// ── Helpers ────────────────────────────────
function startGame () {
  getAudioCtx(); // unlock audio on first gesture (browser requirement)
  isGameStarted = true;
  messageToPlayer.setText('⬆ UP / SPACE / Tap to flap!');
  this.time.delayedCall(2000, () => {
    this.tweens.add({ targets: messageToPlayer, alpha: 0, duration: 800 });
  });
}

function flapBird () {
  if (!hasLanded && !hasBumped && isGameStarted) {
    bird.setVelocityY(-200);
    soundFlap();
  }
}

function restartGame () { location.reload(); }

function endGame () {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('flappyHighScore', highScore);
  }

  [topColumns, bottomColumns].forEach(group => {
    group.children.each(col => { if (col && col.body) col.setVelocityX(0); });
  });

  if (columnSpawnTimer) { columnSpawnTimer.remove(false); columnSpawnTimer = null; }

  let medal = '';
  if      (score >= 40) medal = '🥇';
  else if (score >= 20) medal = '🥈';
  else if (score >= 10) medal = '🥉';

  medalText.setText(medal);
  messageToPlayer.setAlpha(1);
  messageToPlayer.setText(
    `💀 CRASHED!\nScore: ${score}   Best: ${highScore}` +
    (score > 0 && score === highScore ? '\n🎉 NEW BEST!' : '') +
    `\n\nSPACE or Tap to retry`
  );
}

function spawnColumns () {
  if (hasLanded || hasBumped || !isGameStarted) return;

  const W      = game.scale.width;
  const H      = game.scale.height;
  const spawnX = W + 60;

  // ── Medium difficulty ──
  // Gap: starts 280-340 px wide, shrinks 2px per point, floors at 150-200 px
  const minGap  = Math.max(150, 280 - score * 2);
  const maxGap  = Math.max(200, 340 - score * 2);
  const gapSize = Phaser.Math.Between(minGap, maxGap);

  const gapCenterY    = Phaser.Math.Between(H * 0.25, H * 0.70);
  const topPipeBottom = gapCenterY - gapSize / 2;
  const bottomPipeTop = gapCenterY + gapSize / 2;

  // Speed: starts -150, increases 2px/s per point
  const speed = -150 - score * 2;

  // Top column — origin at bottom, grows upward
  const topCol = topColumns.create(spawnX, topPipeBottom, 'column').setOrigin(0.5, 1);
  topCol.body.allowGravity = false;
  topCol.setVelocityX(speed);
  topCol.setImmovable(true);
  topCol.scored = false;
  topCol.setDisplaySize(topCol.width, topPipeBottom + 20);
  topCol.body.setSize(topCol.width, topPipeBottom + 20);

  // Bottom column — origin at top, grows downward
  const botCol = bottomColumns.create(spawnX, bottomPipeTop, 'column').setOrigin(0.5, 0);
  botCol.body.allowGravity = false;
  botCol.setVelocityX(speed);
  botCol.setImmovable(true);
  botCol.scored = false;
  const botHeight = H - bottomPipeTop + 20;
  botCol.setDisplaySize(botCol.width, botHeight);
  botCol.body.setSize(botCol.width, botHeight);

  const pairId = Date.now();
  topCol.pairId = pairId;
  botCol.pairId = pairId;
}

function toggleNightMode () {
  nightMode = !nightMode;
  background.setTint(nightMode ? 0x223355 : 0xffffff);
  soundNightToggle();
}

// ── Update ─────────────────────────────────
function update () {
  if (!isGameStarted) { bird.setVelocityY(0); return; }
  if (hasLanded || hasBumped) return;

  if (Phaser.Input.Keyboard.JustDown(cursors.up)) flapBird();

  // Bird tilt
  bird.setAngle(bird.body.velocity.y * 0.05);

  // ── Scoring ──────────────────────────────
  bottomColumns.children.each((col) => {
    if (!col || !col.body) return;
    if (!col.scored && col.x + col.displayWidth / 2 < bird.x) {
      col.scored = true;
      score++;
      scoreText.setText(`SCORE: ${score}`);

      // Score flash
      this.tweens.add({
        targets: scoreText,
        scaleX: 1.4, scaleY: 1.4,
        yoyo: true,
        duration: 120
      });

      if (score % 10 === 0) {
        // Milestone every 10 points
        soundMilestone();
        toggleNightMode.call(this);
        messageToPlayer.setAlpha(1);
        messageToPlayer.setText(`🔥 ${score} PIPES!`);
        this.time.delayedCall(1200, () => {
          this.tweens.add({ targets: messageToPlayer, alpha: 0, duration: 500 });
        });
      } else {
        soundScore();
      }
    }
  });

  // ── Cleanup off-screen columns ────────────
  [topColumns, bottomColumns].forEach(group => {
    group.children.each(col => {
      if (col && col.body && col.x < -200) col.destroy();
    });
  });
}
