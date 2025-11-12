class RNG {
  constructor(seed = Date.now() & 0xffffffff) {
    this.state = seed >>> 0;
  }

  next() {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }
}

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreValue = document.getElementById("scoreValue");
const ballCountValue = document.getElementById("ballCountValue");
const restartBtn = document.getElementById("restartBtn");
const aimHint = document.getElementById("aimHint");

const GAME_WIDTH = canvas.width;
const GAME_HEIGHT = canvas.height;
const GRID_COLUMNS = 7;
const GRID_SIZE = GAME_WIDTH / GRID_COLUMNS;
const BALL_RADIUS = 7;
const BALL_SPEED = 6.2;

const COLORS = {
  background: "#090d15",
  barrel: "#fefefe",
  aim: "rgba(255, 255, 255, 0.25)",
  aimStrong: "rgba(255, 255, 255, 0.45)",
  text: "#f5f7fb",
  blockBorder: "rgba(255,255,255,0.25)",
};

const BLOCK_COLORS = [
  "#00c6ff",
  "#3a7bd5",
  "#f8367c",
  "#fbb03b",
  "#3bc6b6",
  "#b621fe",
  "#fe8c00",
  "#fe5f75",
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function randomChoice(arr, rng) {
  return arr[Math.floor(rng.next() * arr.length)];
}

class Block {
  constructor(col, row, strength, type = "block") {
    this.col = col;
    this.row = row;
    this.strength = strength;
    this.type = type;
    this.destroyed = false;
  }

  get x() {
    return this.col * GRID_SIZE + 6;
  }

  get y() {
    return this.row * GRID_SIZE + 6;
  }

  get size() {
    return GRID_SIZE - 12;
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.size, h: this.size };
  }

  updateRow(newRow) {
    this.row = newRow;
  }

  draw(ctx) {
    const { x, y, size } = this.rect;
    if (this.type === "block") {
      const colorIndex = Math.min(BLOCK_COLORS.length - 1, Math.floor((this.strength - 1) / 3));
      ctx.fillStyle = BLOCK_COLORS[colorIndex];
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 10);
      ctx.fill();

      ctx.strokeStyle = COLORS.blockBorder;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = COLORS.text;
      ctx.font = "700 20px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.strength, x + size / 2, y + size / 2);
    } else if (this.type === "pickup") {
      ctx.fillStyle = "#ffd93d";
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 12);
      ctx.fill();

      ctx.fillStyle = "#1e1f2b";
      ctx.font = "700 18px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+1", x + size / 2, y + size / 2);
    }
  }
}

class Ball {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * BALL_SPEED;
    this.vy = Math.sin(angle) * BALL_SPEED;
    this.resting = false;
  }

  update(delta) {
    if (this.resting) return;

    this.x += this.vx * delta;
    this.y += this.vy * delta;

    if (this.x - BALL_RADIUS <= 0 && this.vx < 0) {
      this.x = BALL_RADIUS;
      this.vx *= -1;
    } else if (this.x + BALL_RADIUS >= GAME_WIDTH && this.vx > 0) {
      this.x = GAME_WIDTH - BALL_RADIUS;
      this.vx *= -1;
    }

    if (this.y - BALL_RADIUS <= 0 && this.vy < 0) {
      this.y = BALL_RADIUS;
      this.vy *= -1;
    }
  }

  setResting(baseY) {
    this.y = baseY - BALL_RADIUS;
    this.vx = 0;
    this.vy = 0;
    this.resting = true;
  }

  draw(ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 120;
    this.vy = (Math.random() - 0.5) * 120;
    this.life = 0.4;
    this.color = color;
  }

  update(delta) {
    this.life -= delta;
    this.x += this.vx * delta;
    this.y += this.vy * delta;
    this.vy += 300 * delta;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.globalAlpha = clamp(this.life / 0.4, 0, 1);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, 6, 6);
    ctx.globalAlpha = 1;
  }
}

class Game {
  constructor() {
    this.rng = new RNG();
    this.reset();
    this.bindEvents();
    this.loop(0);
  }

  reset() {
    this.blocks = [];
    this.balls = [];
    this.particles = [];
    this.pendingBalls = 0;
    this.ballChain = 1;
    this.baseBallPosition = GAME_WIDTH / 2;
    this.baseY = GAME_HEIGHT - 24;
    this.turnAngle = null;
    this.isAiming = false;
    this.isLaunching = false;
    this.turn = 1;
    this.score = 0;
    this.timeAccumulator = 0;
    this.isGameOver = false;
    this.spawnRow();
    this.updateHUD();
    aimHint.classList.remove("hidden");
  }

  bindEvents() {
    const getCanvasPos = (event) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const clientY = event.touches ? event.touches[0].clientY : event.clientY;
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    const startAim = (event) => {
      if (this.isLaunching || this.isGameOver) return;
      this.isAiming = true;
      aimHint.classList.add("hidden");
      const pos = getCanvasPos(event);
      this.turnAngle = Math.atan2(pos.y - this.baseY, pos.x - this.baseBallPosition);
      this.turnAngle = clamp(this.turnAngle, (-Math.PI + 0.35), -0.35);
    };

    const moveAim = (event) => {
      if (!this.isAiming || this.isLaunching) return;
      const pos = getCanvasPos(event);
      this.turnAngle = Math.atan2(pos.y - this.baseY, pos.x - this.baseBallPosition);
      this.turnAngle = clamp(this.turnAngle, (-Math.PI + 0.35), -0.35);
    };

    const endAim = () => {
      if (!this.isAiming || this.isLaunching) return;
      this.isAiming = false;
      if (this.turnAngle === null) return;
      this.launchTurn(this.turnAngle);
    };

    canvas.addEventListener("mousedown", startAim);
    canvas.addEventListener("mousemove", moveAim);
    canvas.addEventListener("mouseup", endAim);
    canvas.addEventListener("mouseleave", endAim);

    canvas.addEventListener("touchstart", startAim, { passive: true });
    canvas.addEventListener("touchmove", moveAim, { passive: true });
    canvas.addEventListener("touchend", endAim);

    restartBtn.addEventListener("click", () => this.reset());
  }

  launchTurn(angle) {
    this.isLaunching = true;
    this.turnAngle = angle;
    this.pendingBalls = this.ballChain;
    this.launchTimer = 0;
    this.restingBalls = [];
    this.activeBallChainLanding = null;
  }

  spawnRow() {
    const minBlocks = Math.min(3, GRID_COLUMNS);
    const maxBlocks = Math.max(3, Math.floor(GRID_COLUMNS * 0.85));
    let blockCount = Math.floor(this.rng.next() * (maxBlocks - minBlocks + 1)) + minBlocks;

    const taken = new Set();
    while (blockCount > 0) {
      const col = Math.floor(this.rng.next() * GRID_COLUMNS);
      if (taken.has(col)) continue;
      taken.add(col);
      blockCount--;

      const strength = Math.max(1, Math.round(this.turn * (0.5 + this.rng.next())));
      this.blocks.push(new Block(col, 0, strength, "block"));
    }

    if (this.rng.next() > 0.65) {
      const freeCols = [...Array(GRID_COLUMNS).keys()].filter((c) => !taken.has(c));
      if (freeCols.length) {
        const spawnCol = randomChoice(freeCols, this.rng);
        this.blocks.push(new Block(spawnCol, 0, 1, "pickup"));
      }
    }
  }

  stepRowsDown() {
    for (const block of this.blocks) {
      block.updateRow(block.row + 1);
      if (block.row * GRID_SIZE >= GAME_HEIGHT - GRID_SIZE) {
        this.gameOver();
        return true;
      }
    }
    return false;
  }

  gameOver() {
    this.isLaunching = false;
    this.isAiming = false;
    this.turnAngle = null;
    this.isGameOver = true;
  }

  showGameOverBanner() {
    ctx.save();
    ctx.fillStyle = "rgba(9, 13, 21, 0.82)";
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 36px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Game Over", GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20);
    ctx.font = "400 20px 'Segoe UI', sans-serif";
    ctx.fillText(`Score: ${this.score}`, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 16);
    ctx.fillText("Tap Restart to play again", GAME_WIDTH / 2, GAME_HEIGHT / 2 + 48);
    ctx.restore();
  }

  updateHUD() {
    scoreValue.textContent = this.score;
    ballCountValue.textContent = this.ballChain;
  }

  update(delta) {
    if (this.isGameOver) {
      return;
    }

    if (this.isLaunching) {
      this.launchTimer -= delta;
      if (this.pendingBalls > 0 && this.launchTimer <= 0) {
        this.launchTimer = 0.1;
        this.pendingBalls--;
        const spawnPointX = this.activeBallChainLanding ?? this.baseBallPosition;
        const ball = new Ball(spawnPointX, this.baseY - BALL_RADIUS, this.turnAngle);
        this.balls.push(ball);
      }
    }

    for (const ball of this.balls) {
      if (ball.resting) continue;
      ball.update(delta);
      this.handleCollisions(ball);

      if (ball.y + BALL_RADIUS >= this.baseY && ball.vy > 0) {
        ball.setResting(this.baseY);
        this.restingBalls.push(ball);
        if (this.activeBallChainLanding === null) {
          this.activeBallChainLanding = ball.x;
        }
      }
    }

    this.particles = this.particles.filter((p) => p.life > 0);
    for (const particle of this.particles) {
      particle.update(delta);
    }

    if (this.isLaunching && this.pendingBalls === 0 && this.balls.every((b) => b.resting)) {
      this.finishTurn();
    }
  }

  finishTurn() {
    this.isLaunching = false;
    this.isAiming = false;
    this.turnAngle = null;
    this.turn++;
    this.balls = [];
    this.baseBallPosition = this.activeBallChainLanding ?? this.baseBallPosition;
    this.updateHUD();
    const reachedBottom = this.stepRowsDown();
    if (!reachedBottom) {
      this.spawnRow();
    }
  }

  handleCollisions(ball) {
    for (const block of this.blocks) {
      if (block.destroyed) continue;

      const rect = block.rect;

      if (this.circleRectCollision(ball, rect)) {
        const prevX = ball.x - ball.vx;
        const prevY = ball.y - ball.vy;
        const isHorizontal = prevY + BALL_RADIUS <= rect.y || prevY - BALL_RADIUS >= rect.y + rect.h;

        if (block.type === "pickup") {
          block.destroyed = true;
          this.ballChain++;
          this.score += 10;
          this.updateHUD();
        } else if (block.type === "block") {
          block.strength -= 1;
          this.score += 5;
        }

        this.spawnHitParticles(rect.x + rect.w / 2, rect.y + rect.h / 2);

        if ((block.type === "block" && block.strength <= 0) || block.destroyed) {
          block.destroyed = true;
        }

        if (isHorizontal) {
          ball.vy *= -1;
        } else {
          ball.vx *= -1;
        }
      }
    }

    this.blocks = this.blocks.filter((block) => !block.destroyed);
  }

  circleRectCollision(ball, rect) {
    const closestX = clamp(ball.x, rect.x, rect.x + rect.w);
    const closestY = clamp(ball.y, rect.y, rect.y + rect.h);
    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    return dx * dx + dy * dy < BALL_RADIUS * BALL_RADIUS;
  }

  spawnHitParticles(x, y) {
    const count = 6 + Math.floor(Math.random() * 6);
    const color = "#ffffff";
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  drawAim() {
    if (this.turnAngle === null) return;
    ctx.save();
    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(this.baseBallPosition, this.baseY);
    let length = 600;
    const tx = this.baseBallPosition + Math.cos(this.turnAngle) * length;
    const ty = this.baseY + Math.sin(this.turnAngle) * length;
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }

  drawBase() {
    ctx.fillStyle = COLORS.barrel;
    ctx.beginPath();
    ctx.arc(this.baseBallPosition, this.baseY, BALL_RADIUS + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBlocks() {
    for (const block of this.blocks) {
      block.draw(ctx);
    }
  }

  drawParticles() {
    for (const particle of this.particles) {
      particle.draw(ctx);
    }
  }

  drawBalls() {
    for (const ball of this.balls) {
      ball.draw(ctx);
    }
  }

  drawGrid() {
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let c = 1; c < GRID_COLUMNS; c++) {
      const x = c * GRID_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, GAME_HEIGHT);
      ctx.stroke();
    }
  }

  draw(dt) {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.drawGrid();
    this.drawBlocks();
    this.drawBalls();
    this.drawParticles();
    this.drawBase();

    if (this.isAiming || (!this.isLaunching && !this.isAiming && this.turnAngle !== null)) {
      this.drawAim();
    }

    if (this.isGameOver) {
      this.drawGameOverOverlay();
    }
  }

  drawGameOverOverlay() {
    ctx.save();
    ctx.fillStyle = "rgba(9, 13, 21, 0.82)";
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 36px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Game Over", GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20);
    ctx.font = "400 20px 'Segoe UI', sans-serif";
    ctx.fillText(`Score: ${this.score}`, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 16);
    ctx.fillText("Press Restart to play again", GAME_WIDTH / 2, GAME_HEIGHT / 2 + 48);
    ctx.restore();
  }

  loop(timestamp) {
    if (!this.previousTime) this.previousTime = timestamp;
    const delta = (timestamp - this.previousTime) / 1000;
    this.previousTime = timestamp;

    const cappedDelta = Math.min(delta, 0.033);
    this.update(cappedDelta);
    this.draw(cappedDelta);

    requestAnimationFrame((time) => this.loop(time));
  }
}

ctx.roundRect = ctx.roundRect || function (x, y, w, h, r) {
  const radius = typeof r === "number" ? r : 0;
  this.beginPath();
  this.moveTo(x + radius, y);
  this.lineTo(x + w - radius, y);
  this.quadraticCurveTo(x + w, y, x + w, y + radius);
  this.lineTo(x + w, y + h - radius);
  this.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  this.lineTo(x + radius, y + h);
  this.quadraticCurveTo(x, y + h, x, y + h - radius);
  this.lineTo(x, y + radius);
  this.quadraticCurveTo(x, y, x + radius, y);
  this.closePath();
  return this;
};

window.addEventListener("load", () => {
  new Game();
});

