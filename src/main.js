import * as pc from 'playcanvas';
import { Scene } from '@viggle/splat-engine';
import { World, LANES, RAIL_Y, IS_TOUCH } from './world.js';
import { Obstacles, TRAIN_TOP } from './obstacles.js';
import { Leaves } from './fx.js';
import { Audio } from './audio.js';
import { loadClips, loadActor } from './actors.js';
import { Roster } from './roster.js';
import { Powerups, JET_Y } from './powerups.js';

const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug'), AUTO = Q.has('auto');
const CLIPS = ['running', 'run_jump', 'roll', 'hard_landing', 'knocked_down', 'fall_down', 'standing_idle', 'cheering', 'point_forward', 'head_hit', 'hit_front'];
// Run cycle: a generated PINOC sprint loop when present (?run=gen_sprint_N), else the library jog loop played fast.
let RUN_CLIP = 'running';
// Generated PINOC clips with library fallbacks. `at` = seconds into the clip where the action starts.
const CLIP = {
  jump: { name: 'gen_leap_3', fb: 'run_jump', at: .62, fbAt: .72, air: .5 },
  hover: { name: 'gen_hover_2', fb: 'standing_idle' },
  dodgeL: { name: 'gen_dodgeL_1', at: .4 }, dodgeR: { name: 'gen_dodgeR_1', at: .4 },
  wall: { name: 'gen_wall_1', fb: 'knocked_down', at: 1.12 }, trip: { name: 'gen_trip_3', fb: 'fall_down', at: .85 },
  bar: { name: 'gen_bar_0', fb: 'head_hit', at: .5 }, caught: { name: 'gen_caught_3', fb: 'hit_front', at: .3 },
};
const clipName = c => c.use || c.fb || c.name;
const G = 30, JUMP_V = 10.2, BASE_SPEED = 12, MAX_SPEED = 25;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const $ = id => document.getElementById(id);

const audio = new Audio();
const game = { phase: 'loading', t: 0, audio };
window.__g = game;

// ------------------------------------------------------------------------------ look
function frameLook() {
  const f = game.scene.getOrCreateCameraFrame();
  f.rendering.toneMapping = pc.TONEMAP_ACES2; f.rendering.samples = 1;
  f.bloom.intensity = .028; f.bloom.blurLevel = 7;
  f.grading.enabled = true; f.grading.saturation = 1.12; f.grading.contrast = 1.06; f.grading.brightness = 1.0; f.grading.tint = new pc.Color(1, .97, .93);
  f.vignette.intensity = .32; f.vignette.inner = .55; f.vignette.outer = 1.4; f.vignette.curvature = .6;
  f.update(); game.frame = f;
}

// ------------------------------------------------------------------------------ runner
class Runner {
  constructor(actor) { this.a = actor; this.reset(); }
  reset() {
    Object.assign(this, { lane: 1, from: 1, x: 0, y: RAIL_Y, z: 0, vy: 0, grounded: true, rollT: 0, jumpT: 0, speed: 0, stepT: 0, stumbleT: 0, dead: false, prevZ: 0, laneT: 1, jetT: 0, jetLanding: false, invulnT: 0, dodgeT: 0 });
  }
  get height() { return this.rollT > 0 ? .85 : 1.7; }
  move(dir) {
    if (this.dead) return;
    const to = clamp(this.lane + dir, 0, 2); if (to === this.lane) { this.edgeBump(dir); return; }
    this.from = this.lane; this.lane = to; this.laneT = 0; audio.swish();
    const D = dir < 0 ? CLIP.dodgeL : CLIP.dodgeR;
    if (D.use && this.grounded && this.rollT <= 0 && !this.flying) { this.dodgeT = .36; this.a.play(D.use, { loop: false, fade: .07, speed: 1.6, restart: true, at: D.at }); }
  }
  edgeBump(dir) { game.cam.kick(dir * .3); }
  get flying() { return this.jetT > 0; }
  startJet(d) {
    this.jetT = d; this.grounded = false; this.vy = 0; this.rollT = 0; this.wantRoll = false; this.jetLanding = false;
    this.a.lockY = true; this.a.play(clipName(CLIP.hover), { fade: .3 }); audio.jet(true);
  }
  jump() {
    if (this.dead || !this.grounded || this.flying) return;
    const big = game.powerups?.is('sneakers');
    this.vy = JUMP_V * (big ? 1.42 : 1); this.grounded = false; this.rollT = 0; this.jumpT = 0; audio.jump();
    const air = 2 * this.vy / G, J = CLIP.jump;
    this.a.lockY = true;
    if (J.use) this.a.play(J.use, { loop: false, fade: .08, speed: J.air / air, restart: true, at: J.at });
    else this.a.play('run_jump', { loop: false, fade: .1, speed: .6 * (.68 / air), restart: true, at: J.fbAt });
  }
  roll() {
    if (this.dead || this.flying) return;
    if (!this.grounded) { this.vy = -26; this.wantRoll = true; return; }
    this.startRoll();
  }
  startRoll() {
    this.rollT = .78; this.a.lockY = false; audio.roll();
    this.a.play('roll', { loop: false, fade: .08, speed: 1.35, restart: true, at: .12 });
    game.leaves.burst(this.x, this.y, this.z, 10, { up: 2, spread: 2, fwd: 3 });
  }
  update(dt) {
    const A = this.a;
    if (this.dead) { A.update(); return; }
    this.prevZ = this.z; this.prevX = this.x;
    this.z -= this.speed * dt;
    // lane change: quick ease with a lean into the turn
    this.laneT = Math.min(1, this.laneT + dt / .2);
    const tx = LANES[this.lane], dx = tx - this.x;
    this.x = damp(this.x, tx, 16, dt);
    A.roll = damp(A.roll, clamp(-dx * 11, -20, 20), 14, dt);
    A.yaw = damp(A.yaw, clamp(-dx * 9, -22, 22), 12, dt);
    // vertical
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.jetT > 0) {
      this.jetT -= dt; this.y = damp(this.y, JET_Y + Math.sin(game.t * 2.2) * .12, 3.2, dt); this.vy = 0;
      if (this.jetT <= 0) { this.jetLanding = true; this.invulnT = 1.6; audio.jet(false); A.lockY = true; A.play('run_jump', { loop: false, fade: .3, speed: .5, restart: true, at: .95 }); }
      A.x = this.x; A.y = this.y; A.z = this.z; A.update(); return;
    }
    const g = game.obs.groundAt(this.x, this.z, this.y);
    if (this.grounded) {
      if (g < this.y - .08) { this.grounded = false; this.vy = 0; }
      else this.y = g;
    }
    if (!this.grounded) {
      this.vy -= G * dt; this.y += this.vy * dt; this.jumpT += dt;
      if (this.y <= g) {
        this.y = g; this.grounded = true; const hard = this.vy < -14 || this.jetLanding; this.vy = 0; this.jetLanding = false;
        A.lockY = false; audio.land();
        game.leaves.burst(this.x, this.y, this.z, hard ? 16 : 8, { up: 2.4, spread: 2.6, fwd: -2 });
        if (this.wantRoll) { this.wantRoll = false; this.startRoll(); }
        else A.play(RUN_CLIP, { fade: .14, speed: this.animSpeed() });
      }
    }
    if (this.dodgeT > 0) { this.dodgeT -= dt; if (this.dodgeT <= 0 && this.grounded && this.rollT <= 0) A.play(RUN_CLIP, { fade: .2, speed: this.animSpeed() }); }
    if (this.rollT > 0) { this.rollT -= dt; if (this.rollT <= 0 && this.grounded) A.play(RUN_CLIP, { fade: .16, speed: this.animSpeed() }); }
    else if (this.grounded && A.anim !== RUN_CLIP && this.dodgeT <= 0) A.play(RUN_CLIP, { fade: .16, speed: this.animSpeed() });
    if (this.grounded && A.anim === RUN_CLIP) A.ch.playbackSpeed = this.animSpeed();
    // footsteps
    if (this.grounded && this.rollT <= 0) { this.stepT -= dt * this.animSpeed() * 3.6; if (this.stepT <= 0) { this.stepT = 1; audio.step(); } }
    if (this.stumbleT > 0) this.stumbleT -= dt;
    A.x = this.x; A.y = this.y; A.z = this.z; A.pitch = 0;
    A.update();
  }
  animSpeed() { return (RUN_CLIP === 'running' ? 1.7 : 1.1) + (this.speed - BASE_SPEED) * .035; }
}

// Collision: a front hit ends the run; clipping a side while changing lanes is a stumble (twice = caught).
function collide(r) {
  const halfW = .28;
  if (!r.flying && r.invulnT <= 0) for (const o of game.obs.list) {
    if (o.z0 > r.z + 2 || o.z1 < r.z - 2) continue;
    if (Math.abs(r.x - o.x) > o.w / 2 + halfW) continue;
    if (r.z > o.z1 + .25 || r.z < o.z0 - .25) continue;
    let top = o.y1, bottom = o.y0;
    if (o.ramp) { const s = RAIL_Y + (o.z1 - r.z) / 7 * (TRAIN_TOP - RAIL_Y); if (r.y + .6 >= s) continue; top = s; bottom = 0; }
    else if (o.top && r.y >= o.top + RAIL_Y - .14 - .6) continue; // on the roof
    if (r.y + .05 >= top || r.y + r.height <= bottom) continue;
    const wasInFront = r.prevZ > (o.prevZ1 ?? o.z1) + .25 - 1e-3;
    const wasBeside = Math.abs(r.prevX - o.x) > o.w / 2 + halfW - .02;
    if (wasInFront && !(wasBeside && o.kind === 'train')) return crash(o);
    return stumble(o);
  }
  // pick-ups
  for (const c of game.obs.coins) {
    if (c.taken || Math.abs(c.z - r.z) > 1.1 || Math.abs(c.x - r.x) > .9) continue;
    const mid = r.y + r.height * .55; if (Math.abs(c.y - mid) > 1.1) continue;
    c.taken = true; game.coins++; game.streak++; game.streakT = .6; audio.coin(game.streak); game.score += 10 * game.mult * (game.powerups.is('double') ? 2 : 1);
    game.leaves.burst(c.x, c.y, c.z, 3, { up: 1.5, spread: 1.5, fwd: -1, size: .8 });
    bumpHud('coins');
  }
}
function stumble(o) {
  const r = game.runner;
  // bounce back to the lane we came from
  r.lane = r.from; r.x = r.prevX; game.cam.kick(r.x > o.x ? .6 : -.6); game.cam.shake = .5; audio.bump();
  r.a.layerHit = .5; r.a.ch.playLayer('hit', 'head_hit', { region: 'upperBody', crossfade: .08, loop: false });
  setTimeout(() => r.a.ch.stopLayer('hit', .25), 450);
  if (r.stumbleT > 0) return crash(o, true);
  r.stumbleT = 7; game.chaser.dist = 2.6; flash('HOLD IT!', 'The station master is on your tail');
}
function crash(o, caught = false) {
  const r = game.runner; if (r.dead) return;
  r.dead = true; game.phase = 'crash'; game.crashT = 0; audio.crash(); game.cam.shake = 1;
  if (DEBUG) console.info('crash', o?.kind, { caught, rz: r.z.toFixed(2), ry: r.y.toFixed(2), rx: r.x.toFixed(2), lane: r.lane, oz1: o?.z1?.toFixed(2), ox: o?.x, grounded: r.grounded, roll: r.rollT.toFixed(2) });
  if (o && !caught) r.z = Math.max(r.z, o.z1 + (o.kind === 'gate' ? .45 : o.kind === 'hurdle' ? -.2 : .3));
  r.a.lockY = false; r.a.ch.stopLayer('hit', 0);
  const D = caught ? CLIP.caught : o?.kind === 'hurdle' ? CLIP.trip : o?.kind === 'gate' ? CLIP.bar : o?.moving ? null : CLIP.wall;
  if (D?.use) r.a.play(D.use, { loop: false, fade: .08, restart: true, at: D.at });
  else r.a.play(D?.fb || 'knocked_down', { loop: false, fade: .1, speed: 1.1, restart: true, at: 0 });
  game.deathKind = caught ? 'caught' : o?.kind;
  $('o-kicker').textContent = caught ? 'CAUGHT!' : o?.moving ? 'HIT BY A TRAIN!' : o?.kind === 'hurdle' ? 'TRIPPED!' : o?.kind === 'gate' ? 'BONK!' : 'CRASHED!';
  r.y = r.grounded ? r.y : Math.max(game.obs.groundAt(r.x, r.z, r.y), RAIL_Y);
  r.a.y = r.y; r.a.z = r.z; r.a.update();
  game.leaves.burst(r.x, r.y + .5, r.z, 30, { up: 4, spread: 4, fwd: 0, size: 1.2 });
}

// Debug/trailer autopilot: reads the obstacles ahead and jumps, rolls or changes lane.
function autopilot(r) {
  if (r.flying) return;
  if (!r.grounded && r.vy > 0) return;
  const look = r.speed * .42 + 3, threat = lane => {
    let best = null;
    for (const o of game.obs.list) {
      if (o.lane !== lane || o.z0 > r.z || o.z1 < r.z - look - (o.moving ? o.vz * 1.2 : 0)) continue;
      if (o.top && r.y >= o.top + RAIL_Y - .8) continue;
      if (!best || o.z1 > best.z1) best = o;
    }
    return best;
  };
  const o = threat(r.lane);
  if (!o || o.ramp) return seek(r, threat);
  if (o.kind === 'hurdle' && r.z - o.z1 < r.speed * .22 + 1) return r.jump();
  if (o.kind === 'gate' && r.z - o.z1 < r.speed * .2 + 1) return r.roll();
  if (o.kind === 'train' && Math.abs(r.x - LANES[r.lane]) < .3) {
    const opts = [r.lane - 1, r.lane + 1].filter(l => l >= 0 && l <= 2).map(l => ({ l, t: threat(l) }));
    const free = opts.find(c => !c.t || c.t.ramp) || opts.find(c => c.t.kind !== 'train') || opts[0];
    if (free) r.move(free.l - r.lane);
  }
}

// Like a player: with the way clear, drift toward the lane with more leaves or a power-up in it.
function seek(r, threat) {
  if (game.t - (r.seekT || 0) < .35 || r.laneT < 1 || !r.grounded) return;
  const value = lane => {
    let v = 0; const x = LANES[lane];
    for (const c of game.obs.coins) if (!c.taken && Math.abs(c.x - x) < .5 && r.z - c.z > 3 && r.z - c.z < 26 && c.y < r.y + 2.2) v++;
    for (const p of game.powerups.list) if (Math.abs(p.x - x) < .5 && r.z - p.z > -.5 && r.z - p.z < 34) v += 8; // keep counting it right up to the pickup
    return v;
  };
  const cur = value(r.lane);
  for (const d of Math.random() < .5 ? [-1, 1] : [1, -1]) {
    const l = r.lane + d; if (l < 0 || l > 2) continue;
    const t = threat(l); if (t && !t.ramp) continue;
    if (value(l) > cur + 1) { r.seekT = game.t; r.move(d); return; }
  }
}

// ------------------------------------------------------------------------------ chaser (station master)
class Chaser {
  constructor(actor) { this.a = actor; this.dist = 3; this.x = 0; this.on = true; }
  update(dt, r) {
    const A = this.a;
    if (game.phase === 'run') {
      const want = r.stumbleT > 0 ? 2.6 : game.t < 3.2 ? 2.4 + game.t * .4 : 16;
      this.dist = damp(this.dist, want, r.stumbleT > 0 ? 3 : .8, dt);
      this.x = damp(this.x, r.x + (r.lane === 2 ? -1.1 : 1.1), 4, dt);
      A.x = this.x; A.z = r.z + this.dist; A.y = game.obs.groundAt(this.x, A.z, r.y + .3) ;
      if (A.y > RAIL_Y + .5) A.y = RAIL_Y; // he stays on the ground; roofs are for the young
      A.yaw = 0; A.play('running', { speed: 1.75 });
      const vis = this.dist < 4.8; if (vis !== A.visible) A.show(vis); // once he's behind the camera, drop him
    } else if (game.phase === 'crash') {
      if (!A.visible) { A.show(true); this.dist = Math.max(this.dist, 9); }
      this.dist = damp(this.dist, 1.6, 1.6, dt);
      A.x = damp(A.x, r.x + (r.x > 1 ? 1 : -1), 3, dt); A.z = r.z + this.dist; A.y = RAIL_Y; // opposite side to the crash camera
      if (this.dist > 2.2) { A.play('running', { speed: 1.5 }); A.yaw = 0; }
      else { A.play('point_forward', { loop: true, fade: .3 }); A.yaw = damp(A.yaw, Math.atan2(r.x - A.x, r.z - A.z) * 57.2958 + 180, 3, dt); } // PINOC rigs face -Z at yaw 0
    }
    A.update();
  }
}

// ------------------------------------------------------------------------------ camera
class Cam {
  constructor(e) { this.e = e; this.x = 0; this.y = 3.2; this.shake = 0; this.kickX = 0; this.mode = 'title'; this.blend = 0; this.orbit = 0; }
  kick(v) { this.kickX += v; }
  update(dt, r) {
    const c = this.e;
    this.kickX = damp(this.kickX, 0, 8, dt);
    const speedK = clamp((r.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
    // runner cam: behind and above, looking down the line, drifting with the lane and lifting onto the roofs
    this.x = damp(this.x, r.x * .82, 7, dt);
    const groundish = Math.min(r.y, game.obs.groundAt(r.x, r.z, r.y)); this.y = damp(this.y, r.flying || r.jetLanding ? r.y + 1.0 : 3.05 + groundish * .72 + Math.max(0, r.y - groundish) * .15, r.flying ? 2.5 : 4.5, dt);
    const run = { p: new pc.Vec3(this.x + this.kickX, this.y, r.z + 5), l: new pc.Vec3(this.x * .9, this.y - 1.7, r.z - 7), fov: 60 + speedK * 8 };
    let P = run.p, L = run.l, fov = run.fov;
    if (this.mode === 'title' || this.blend < 1) {
      // title: in front of her, low, looking back up the tunnel
      this.orbit += dt * .08;
      const tall = c.camera.aspectRatio < 1; // portrait phones: pull back and frame her in the upper half, above the title UI
      const tp = new pc.Vec3(r.x + Math.sin(this.orbit) * .8 - .6, tall ? 1.3 : 1.45, r.z - (tall ? 5.4 : 3.6)), tl = new pc.Vec3(r.x, tall ? .2 : 1.25, r.z + .4);
      if (this.mode === 'title') { P = tp; L = tl; fov = tall ? 52 : 44; }
      else { this.blend = Math.min(1, this.blend + dt / 1.7); const k = this.blend < .5 ? 4 * this.blend ** 3 : 1 - Math.pow(-2 * this.blend + 2, 3) / 2;
        // swing around her side rather than through her
        const side = new pc.Vec3(r.x - 4.2, 2.4, r.z + .8);
        const a = k < .5 ? new pc.Vec3().lerp(tp, side, k * 2) : new pc.Vec3().lerp(side, run.p, k * 2 - 1);
        P = a; L = new pc.Vec3().lerp(tl, run.l, k); fov = 44 + (run.fov - 44) * k; }
    }
    if (this.mode === 'crash') {
      // swing to a three-quarter front view of the fall
      this.crashK = Math.min(1, (this.crashK || 0) + dt / 1.2); const k = 1 - Math.pow(1 - this.crashK, 3);
      const sx = r.x > 1 ? -1 : 1, cp = new pc.Vec3(r.x + 2.7 * sx, r.y + 2.1, r.z + 3.4), cl = new pc.Vec3(r.x, r.y + .5, r.z - .2);
      P = new pc.Vec3().lerp(this.crashFrom.p, cp, k); L = new pc.Vec3().lerp(this.crashFrom.l, cl, k); fov = this.crashFrom.fov + (48 - this.crashFrom.fov) * k;
    } else this.last = { p: P.clone(), l: L.clone(), fov };
    c.setPosition(P); c.lookAt(L); c.camera.fov = fov;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); const a = this.shake * 1.2; c.rotateLocal((Math.random() - .5) * a, (Math.random() - .5) * a, 0); }
  }
  toCrash() { this.mode = 'crash'; this.crashK = 0; this.crashFrom = this.last; }
}

// ------------------------------------------------------------------------------ HUD
let best = 0; try { best = +localStorage.getItem('maple-run-best') || 0; } catch { }
function bumpHud(id) { const el = $(id); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
let flashTimer = 0;
function flash(big, small) { const el = $('callout'); el.querySelector('.big').textContent = big; el.querySelector('.small').textContent = small; el.classList.add('show'); clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('show'), 1600); }
function hud() {
  const score = Math.floor(game.score);
  $('score').textContent = score.toLocaleString(); $('score').classList.toggle('dbl', game.powerups.is('double')); $('coins').querySelector('b').textContent = game.coins; $('mult').textContent = '×' + game.mult;
  $('dist').textContent = Math.floor(-game.runner.z) + ' m';
}

// ------------------------------------------------------------------------------ flow
function newRun() {
  const r = game.runner;
  game.world.reset(); game.obs.reset(); game.powerups.reset(); r.reset(); audio.jet(false);
  game.score = 0; game.coins = 0; game.mult = 1; game.streak = 0; game.t = 0; game.nextMilestone = 500;
  r.a.x = 0; r.a.z = 0; r.a.y = RAIL_Y; r.a.yaw = 0; r.a.roll = 0; r.a.lockY = false; r.a.play('standing_idle', { fade: .2 }); r.a.update();
  game.chaser.dist = 3; game.chaser.x = 0; game.chaser.a.show(true); game.chaser.a.play('standing_idle'); game.chaser.a.x = 0; game.chaser.a.z = 3.4; game.chaser.a.y = RAIL_Y; game.chaser.a.yaw = 0; game.chaser.a.update();
  game.cam.mode = 'title'; game.cam.blend = 0;
  game.world.update(0, 0, game.scene.cameraEntity);
  game.obs.update(0, r, BASE_SPEED, 0, 0);
  game.leaves.reset(r);
}
function start() {
  if (game.phase !== 'title') return;
  audio.init(); audio.startMusic();
  game.phase = 'run'; game.cam.mode = 'run'; game.cam.blend = 0; game.t = 0;
  $('title').classList.add('hide'); $('hud').classList.add('on');
  game.runner.a.play(RUN_CLIP, { fade: .25, speed: 1.25 });
  setTimeout(() => audio.whistle(.6), 250);
}
function gameOver() {
  game.phase = 'over';
  const score = Math.floor(game.score), isBest = score > best; if (isBest) { best = score; try { localStorage.setItem('maple-run-best', best); } catch { } }
  $('o-score').textContent = score.toLocaleString(); $('o-coins').textContent = game.coins; $('o-dist').textContent = Math.floor(-game.runner.z) + ' m';
  $('o-best').textContent = isBest ? 'NEW BEST' : 'BEST ' + best.toLocaleString();
  $('over').classList.add('show'); $('hud').classList.remove('on');
}
// Put a different PINOC character in the runner's shoes (title screen only).
function swapRunner(a) {
  const r = game.runner; if (!r || r.a === a) return;
  r.a.show(false); if (r.a.shadow) r.a.shadow.root.enabled = false;
  r.a = a; a.show(true); a.anim = null; a.x = r.x; a.y = r.y; a.z = r.z; a.yaw = 0; a.roll = 0; a.lockY = false;
  a.play('standing_idle', { fade: 0 }); a.update();
  game.leaves.burst(r.x, r.y + .3, r.z, 14, { up: 2.5, spread: 2.5 });
}
function toTitle() {
  $('over').classList.remove('show'); game.phase = 'title'; newRun(); $('title').classList.remove('hide');
}
function restart() {
  $('over').classList.remove('show'); game.phase = 'title'; newRun(); $('title').classList.remove('hide');
  setTimeout(start, 50);
}

function setPaused(p) {
  if (game.phase !== 'run' || game.paused === p) return;
  game.paused = p; $('pause').classList.toggle('show', p); game.scene.app.timeScale = p ? 0 : 1;
  p ? audio.stopMusic() : audio.startMusic();
}

function tick(dt) {
  if (game.paused) return;
  dt = Math.min(dt, 1 / 20);
  const r = game.runner;
  audio.tick();
  if (game.phase === 'run') {
    game.t += dt;
    const accelIn = clamp(game.t / 1.2, 0, 1);
    r.speed = (BASE_SPEED + Math.min(MAX_SPEED - BASE_SPEED, game.t * .16)) * accelIn;
    if (AUTO && !window.__noauto) autopilot(r);
    r.update(dt); collide(r);
    game.streakT -= dt; if (game.streakT <= 0) game.streak = 0;
    game.mult = 1 + Math.floor(-r.z / 1000);
    game.score += Math.max(0, r.prevZ - r.z) * game.mult * (game.powerups.is('double') ? 2 : 1);
    if (-r.z > game.nextMilestone) { flash(game.nextMilestone + ' m', game.nextMilestone % 1000 ? 'Keep going' : '×' + game.mult + ' multiplier'); game.nextMilestone += 500; }
    audio.setSpeed(clamp((r.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1));
    hud();
  } else if (game.phase === 'crash') {
    game.crashT += dt; r.update(dt);
    if (game.crashT > .05 && game.cam.mode !== 'crash') game.cam.toCrash();
    if (game.crashT > (game.deathKind === 'caught' ? 3.9 : 2.4)) gameOver();
  } else if (game.phase === 'title' || game.phase === 'over') {
    r.a.update();
  }
  game.chaser.update(dt, r);
  const diff = clamp(-r.z / 2500, 0, 1);
  game.obs.update(dt, r, r.speed, diff, performance.now() / 1000);
  game.powerups.update(dt, r, performance.now() / 1000);
  // oncoming train rumble by proximity
  let near = 0; for (const o of game.obs.list) if (o.moving && o.active) near = Math.max(near, 1 - clamp((r.z - o.z1) / 60, 0, 1));
  audio.rumble(near * .5);
  game.cam.update(dt, r);
  game.world.focus = new pc.Vec3(r.x, r.y, r.z);
  // splat characters are lit by their own sun: dim it when the runner is under the canopy, so they sit in the same light
  const lit = game.world.sunAt({ x: r.x, y: r.y + 1.3, z: r.z });
  game.sunK = damp(game.sunK ?? lit, lit, 7, dt);
  game.world.splatSun.intensity = .95 * (.3 + .7 * game.sunK);
  game.world.splatSky.intensity = .42 + .1 * game.sunK;
  const cp = game.scene.cameraEntity.getPosition(); game.world.splatFill.position.set(cp.x * .6 + r.x * .4, cp.y + .8, cp.z + 1);
  game.world.update(dt, r.z, game.scene.cameraEntity);
  game.leaves.update(dt, game.scene.cameraEntity, { x: r.x, y: r.y, z: r.z }, game.phase === 'run' ? r.speed : 0);
}

// ------------------------------------------------------------------------------ input
function setupInput() {
  const act = k => {
    if (game.roster.modalOpen) return;
    if (game.paused) { setPaused(false); return; }
    if (game.phase === 'title' && (k === 'left' || k === 'right')) { game.roster.step(k === 'left' ? -1 : 1); return; }
    if (game.phase === 'title' && ['jump', 'go'].includes(k)) { start(); return; }
    if (game.phase === 'over' && (k === 'go' || k === 'jump')) { restart(); return; }
    if (game.phase !== 'run') return;
    if (k === 'left') game.runner.move(-1); else if (k === 'right') game.runner.move(1);
    else if (k === 'jump') game.runner.jump(); else if (k === 'roll') game.runner.roll();
  };
  const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'roll', KeyS: 'roll', Enter: 'go' };
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && game.roster.modalOpen) { game.roster.closeModal(); return; }
    if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!game.paused); return; }
    if (e.code === 'KeyM') { audio.setMuted(!audio.muted); $('mute').classList.toggle('off', audio.muted); return; }
    const k = map[e.code]; if (!k || e.repeat) return; e.preventDefault(); act(k);
  });
  // swipes
  let sx = 0, sy = 0, st = 0, used = false;
  addEventListener('pointerdown', e => { if (e.target.closest('button')) return; sx = e.clientX; sy = e.clientY; st = performance.now(); used = false; });
  addEventListener('pointermove', e => {
    if (used || !st) return; const dx = e.clientX - sx, dy = e.clientY - sy, m = Math.max(28, innerWidth * .035);
    if (Math.abs(dx) > m || Math.abs(dy) > m) { used = true; act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'roll' : 'jump')); }
  });
  addEventListener('pointerup', e => { if (!used && st && performance.now() - st < 400 && !e.target.closest('button')) act(game.phase === 'run' ? 'jump' : 'go'); st = 0; });
  $('again').addEventListener('click', () => restart());
  $('change').addEventListener('click', () => toTitle());
  $('run').addEventListener('click', e => { e.stopPropagation(); start(); });
  if (!AUTO) { document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); }); addEventListener('blur', () => setPaused(true)); }
  $('mute').addEventListener('click', () => { audio.init(); audio.setMuted(!audio.muted); $('mute').classList.toggle('off', audio.muted); });
}

// Debug: clear the line ahead and place a known layout, e.g. scenario([['hurdle',1,20],['ramp',0,40]]) (lane, metres ahead)
function scenario(list) {
  const r = game.runner; game.obs.reset(); game.obs.spawnZ = r.z - 400;
  for (const [kind, lane, ahead, extra] of list) kind.startsWith('power:') ? game.powerups.spawn(kind.slice(6), lane, r.z - ahead) : game.obs.add(kind, lane, r.z - ahead, extra);
}

// ------------------------------------------------------------------------------ boot
async function boot() {
  const msg = t => { $('l-msg').textContent = t; };
  msg('Painting the maples');
  const scene = await Scene.create($('canvas'), {
    depth: true, fov: 60, far: 2600, antialias: false, backend: Q.get('backend') === 'webgl' ? 'webgl' : undefined,
    gsplatCulling: true,
    bgColor: { r: .9, g: .8, b: .65, a: 1 }, ambientLight: .5, exposure: 1, preserveDrawingBuffer: Q.has('capture'),
  });
  game.scene = scene; scene.start(); scene.cameraEntity.camera.nearClip = .1;
  // The engine's backing size is css * maxPixelRatio / devicePixelRatio (not a cap), so solve for the scale we want:
  // 1x CSS on phones, 1.25x on desktop, ?dpr= to override.
  const fitRes = () => { scene.graphicsDevice.maxPixelRatio = clamp((parseFloat(Q.get('dpr')) || (IS_TOUCH ? 1 : 1.25)) * (window.devicePixelRatio || 1), .5, 4); };
  fitRes(); addEventListener('resize', fitRes);
  await Promise.all(['700 40px "Noto Serif JP"', '600 20px "Noto Sans JP"', '700 20px "Noto Sans JP"', '400 40px "Dela Gothic One"'].map(f => document.fonts.load(f, 'もみじ台紅葉谷鉄道線MOMIJI'))).catch(() => { });
  game.world = new World(scene);
  frameLook(); scene.graphicsDevice.on('resizecanvas', () => setTimeout(frameLook, 0));
  msg('Laying the tracks');
  game.obs = new Obstacles(game); await game.obs.init();
  game.powerups = new Powerups(game);
  game.leaves = new Leaves(scene.app, { count: IS_TOUCH ? 320 : 700 });
  msg('Waking the runner');
  const runPick = Q.get('run') ?? 'gen_sprint_1';
  const have = await loadClips(scene, [...CLIPS, runPick, ...Object.values(CLIP).map(c => c.name)]);
  if (have.has(runPick)) RUN_CLIP = runPick;
  for (const c of Object.values(CLIP)) c.use = have.has(c.name) ? c.name : null;
  game.roster = new Roster(game, { onSelect: a => swapRunner(a) });
  const [runner, master] = await Promise.all([game.roster.firstLoadable(), loadActor(game, 'conductor', 'conductor')]);
  runner.show(true); game.runner = new Runner(runner); game.chaser = new Chaser(master);
  game.cam = new Cam(scene.cameraEntity);
  game.onTrainStart = () => audio.horn();
  setupInput();
  game.phase = 'title'; newRun();
  $('best').textContent = best ? 'BEST ' + best.toLocaleString() : '';
  scene.app.on('update', tick);
  $('loading').classList.add('hide');
  if (Q.has('go')) start();
  game.flash = flash;
  if (DEBUG) Object.assign(window, { pc, start, crash, flash, scenario });
}
boot().catch(e => { console.error(e); $('l-msg').textContent = 'Failed to load: ' + e.message; });
