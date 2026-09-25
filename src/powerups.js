import * as pc from 'playcanvas';
import { LANES, RAIL_Y } from './world.js';
import * as A from './art.js';

// Four timed power-ups: magnet (pull leaves), jetpack (fly over everything), super sneakers (jump onto roofs),
// double score. Pickups float in the clear gaps between obstacle patterns.
export const DUR = { magnet: 12, jetpack: 5, sneakers: 12, double: 15 };
// jetpack is the rare treat: lower weight, and never within 900 m of the last one (or in the first 400 m)
const WEIGHT = { magnet: 35, jetpack: 10, sneakers: 30, double: 25 }, JET_GAP = 900;
export const JET_Y = 4.3; // above the train roofs (3.3) and below the canopy clearance (6.6)
const NAMES = { magnet: 'MAGNET', jetpack: 'JETPACK', sneakers: 'SUPER SNEAKERS', double: 'DOUBLE SCORE' };
const TYPES = Object.keys(DUR);
const $ = id => document.getElementById(id);

export class Powerups {
  constructor(game) {
    this.game = game; this.app = game.scene.app; this.dev = this.app.graphicsDevice;
    this.list = []; this.active = {}; this.lastZ = 0; this.icons = {};
    const root = this.root = new pc.Entity('powerups'); this.app.root.addChild(root);
    // bubble: soft additive shell; icon: double-sided card that spins inside it
    const shell = A.toTexture(this.dev, A.radial(128, [[0, 'rgba(255,255,255,0)'], [.62, 'rgba(255,255,255,.08)'], [.86, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]), { repeat: false });
    this.tpl = {};
    for (const t of TYPES) {
      const c = A.powerIcon(t); this.icons[t] = c.toDataURL();
      const tex = A.toTexture(this.dev, c, { repeat: false });
      const im = new pc.StandardMaterial(); im.diffuseMap = tex; im.emissiveMap = tex; im.emissive = new pc.Color(1, 1, 1); im.emissiveIntensity = .55;
      im.opacityMap = tex; im.opacityMapChannel = 'a'; im.alphaTest = .4; im.cull = pc.CULLFACE_NONE; im.update();
      const bm = new pc.StandardMaterial(); bm.useLighting = false; bm.useFog = false; bm.diffuse = new pc.Color(0, 0, 0);
      bm.emissive = new pc.Color().fromString(A.POWER_COLORS[t]); bm.emissiveIntensity = 2.2; bm.emissiveMap = shell; bm.opacityMap = shell; bm.opacityMapChannel = 'a';
      bm.blendType = pc.BLEND_ADDITIVEALPHA; bm.depthWrite = false; bm.cull = pc.CULLFACE_NONE; bm.update();
      const e = new pc.Entity(t);
      const bubble = new pc.Entity('bubble'); bubble.addComponent('render', { type: 'plane', material: bm, castShadows: false, receiveShadows: false });
      bubble.setLocalEulerAngles(90, 0, 0); bubble.setLocalScale(1.55, 1, 1.55); e.addChild(bubble); e.bubble = bubble;
      const spin = new pc.Entity('spin'); e.addChild(spin);
      const icon = new pc.Entity('icon'); icon.addComponent('render', { type: 'plane', material: im, castShadows: true, receiveShadows: false });
      icon.setLocalEulerAngles(90, 0, 0); icon.setLocalScale(.95, 1, .95); spin.addChild(icon);
      e.enabled = false; this.app.root.addChild(e); this.tpl[t] = e;
    }
    this.buildJetpack(); this.buildSneakerGlow();
  }

  // Called by the obstacle generator with the centre of each clear gap.
  offer(z, lane) {
    if (this.game.phase !== 'run' && this.game.phase !== 'title') return;
    if (this.lastZ - z < 300 || Math.random() > .45) return; // about one pickup every ~400 m
    this.lastZ = z;
    const pool = TYPES.filter(t => t !== 'jetpack' || (-z > 400 && (this.lastJetZ == null || this.lastJetZ - z > JET_GAP)));
    let roll = Math.random() * pool.reduce((a, t) => a + WEIGHT[t], 0), type = pool[0];
    for (const t of pool) { roll -= WEIGHT[t]; if (roll <= 0) { type = t; break; } }
    if (type === 'jetpack') this.lastJetZ = z;
    this.spawn(type, lane, z);
  }
  spawn(t, lane, z) {
    const e = this.tpl[t].clone(); e.enabled = true; this.root.addChild(e);
    const p = { e, type: t, x: LANES[lane], y: RAIL_Y + 1.05, z, t: Math.random() * 6 };
    e.setLocalPosition(p.x, p.y, p.z); this.list.push(p);
  }

  activate(type) {
    const g = this.game, r = g.runner, fresh = !(this.active[type] > 0);
    this.active[type] = DUR[type];
    g.audio.powerup(); g.flash(NAMES[type] + '!', { magnet: 'Leaves fly to you', jetpack: 'Up and over everything', sneakers: 'Jump onto the trains', double: 'Every point counts twice' }[type]);
    g.leaves.burst(r.x, r.y + 1, r.z, 18, { up: 3, spread: 3, size: 1.1 });
    if (type === 'jetpack') { r.startJet(DUR.jetpack); if (fresh) this.airCoins(r); }
    this.hud();
  }
  // A weaving line of leaves in the air for the jetpack ride.
  airCoins(r) {
    let lane = r.lane; const n = Math.floor(r.speed * DUR.jetpack / 2.6) - 6;
    for (let i = 0; i < n; i++) {
      if (i % 9 === 8) lane = Math.max(0, Math.min(2, lane + (Math.random() < .5 ? -1 : 1)));
      this.game.obs.coin(lane, r.z - 16 - i * 2.6, JET_Y + 1.0);
    }
  }
  is(type) { return this.active[type] > 0; }

  update(dt, r, time) {
    const g = this.game;
    // pickups: bob, spin, collect
    for (const p of this.list) {
      p.t += dt; p.e.setLocalPosition(p.x, p.y + Math.sin(p.t * 2.4) * .12, p.z);
      p.e.findByName('spin').setLocalEulerAngles(0, p.t * 140, 0);
      const cam = g.scene.cameraEntity.getPosition(), bub = p.bubble || (p.bubble = p.e.findByName('bubble')); bub.lookAt(cam); bub.rotateLocal(90, 0, 0);
      if (g.phase === 'run' && !r.dead && Math.abs(p.z - r.z) < 1.2 && Math.abs(p.x - r.x) < 1 && Math.abs(p.y - (r.y + .9)) < 1.4) { p.taken = true; this.activate(p.type); }
      if (p.taken || p.z > r.z + 25) { p.e.destroy(); p.dead = true; }
    }
    this.list = this.list.filter(p => !p.dead);
    if (g.phase !== 'run') return;
    // timers
    let changed = false;
    for (const t of TYPES) if (this.active[t] > 0) {
      const before = this.active[t]; this.active[t] = Math.max(0, before - dt);
      if (before > 2 && this.active[t] <= 2) g.audio.powerEnding();
      if (this.active[t] === 0) changed = true;
    }
    if (changed) this.hud();
    for (const t of TYPES) { const el = this.chips?.[t]; if (el && this.active[t] > 0) el.style.setProperty('--k', (this.active[t] / DUR[t]).toFixed(3)); }
    // magnet: leaves ahead within reach fly to the runner across all three tracks
    if (this.is('magnet')) for (const c of g.obs.coins) {
      if (c.taken) continue; const dz = r.z - c.z; if (dz < -1 || dz > 16) continue;
      const k = 1 - Math.exp(-(dz < 6 ? 14 : 5) * dt);
      c.x += (r.x - c.x) * k; c.y += (r.y + .9 - c.y) * k; c.z += (r.z - c.z) * k * .6;
      c.e.setLocalPosition(c.x, c.y, c.z);
    }
    this.updateJetpack(dt, r, time); this.updateSneakers(dt, r, time);
  }

  // ---------------------------------------------------------------- jetpack prop + flames, strapped to the spine
  buildJetpack() {
    const d = this.dev, e = this.jet = new pc.Entity('jetpack');
    const body = new pc.StandardMaterial(); body.diffuse = new pc.Color().fromString('#ff8a1c'); body.useMetalness = true; body.metalness = .5; body.gloss = .7; body.envAtlas = this.game.world.envAtlas; body.update();
    const steel = new pc.StandardMaterial(); steel.diffuse = new pc.Color(.35, .36, .4); steel.useMetalness = true; steel.metalness = .9; steel.gloss = .75; steel.envAtlas = this.game.world.envAtlas; steel.update();
    const part = (type, mat, pos, scl, rot = [0, 0, 0]) => { const p = new pc.Entity(); p.addComponent('render', { type, material: mat }); p.setLocalPosition(...pos); p.setLocalScale(...scl); p.setLocalEulerAngles(...rot); e.addChild(p); return p; };
    for (const x of [-.1, .1]) {
      part('cylinder', body, [x, 0, 0], [.13, .38, .13]);
      part('sphere', body, [x, .19, 0], [.13, .13, .13]);
      part('cone', steel, [x, -.24, 0], [.1, .1, .1], [180, 0, 0]);
    }
    part('box', steel, [0, .02, .06], [.12, .3, .05]);
    const flame = A.toTexture(d, A.radial(64, [[0, 'rgba(255,255,230,1)'], [.3, 'rgba(255,190,80,.9)'], [.7, 'rgba(255,90,20,.35)'], [1, 'rgba(255,60,10,0)']]), { repeat: false });
    const fm = new pc.StandardMaterial(); fm.useLighting = false; fm.useFog = false; fm.diffuse = new pc.Color(0, 0, 0); fm.emissive = new pc.Color(1, .8, .5); fm.emissiveIntensity = 4;
    fm.emissiveMap = flame; fm.opacityMap = flame; fm.opacityMapChannel = 'a'; fm.blendType = pc.BLEND_ADDITIVEALPHA; fm.depthWrite = false; fm.cull = pc.CULLFACE_NONE; fm.update();
    this.flames = [-.1, .1].map(x => { const f = new pc.Entity('flame'); f.addComponent('render', { type: 'plane', material: fm, castShadows: false, receiveShadows: false }); f.setLocalPosition(x, -.55, 0); f.setLocalEulerAngles(90, 0, 0); e.addChild(f); return f; });
    e.enabled = false; this.app.root.addChild(e);
    this.m = new pc.Mat4(); this.q = new pc.Quat(); this.v = new pc.Vec3();
  }
  updateJetpack(dt, r, time) {
    const on = r.jetT > 0 || r.jetLanding;
    if (!on) { if (this.jet.enabled) this.jet.enabled = false; return; }
    this.jet.enabled = true;
    const arm = r.a.ch.armature, bi = r.a.bone('spine_03'), M = bi >= 0 ? arm.getBoneWorldMatrix(bi) : null;
    if (M) { M.getTranslation(this.v); this.q.setFromMat4(M); }
    else { this.v.set(r.x, r.y + 1.3, r.z); this.q.setFromEulerAngles(0, r.a.yaw, 0); }
    // sit it on the back: the runner faces -Z, so "behind" is +Z in her own frame
    const back = new pc.Vec3(0, 0, .22); new pc.Quat().setFromEulerAngles(0, r.a.yaw, 0).transformVector(back, back);
    this.jet.setPosition(this.v.x + back.x, this.v.y - .05, this.v.z + back.z); this.jet.setEulerAngles(0, r.a.yaw, 0);
    const thrust = r.jetT > 0 ? 1 : .35, cam = this.game.scene.cameraEntity.getPosition();
    for (const f of this.flames) {
      const s = (.5 + Math.random() * .25) * thrust; f.setLocalScale(s * .45, 1, s * 1.3);
      f.lookAt(cam); f.rotateLocal(90, 0, 0); f.setLocalPosition(f.getLocalPosition().x, -.5 - s * .55, 0);
    }
    if (r.jetT > 0 && Math.random() < dt * 30) this.game.leaves.burst(r.x, r.y - .2, r.z + .3, 1, { up: -1.5, spread: 1.2, fwd: 5 });
  }
  // ---------------------------------------------------------------- sneakers: a thin comet trail of sparks off the heels
  buildSneakerGlow() {
    const N = this.sparkN = 220, dev = this.dev;
    this.sparks = Array.from({ length: N }, () => ({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, t: 1, life: 1, s: .03 }));
    this.sparkPos = new Float32Array(N * 12); const uv = new Float32Array(N * 8), idx = new Uint16Array(N * 6), col = new Uint8Array(N * 16);
    for (let i = 0; i < N; i++) { uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8); idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6); }
    const mesh = this.sparkMesh = new pc.Mesh(dev); mesh.setPositions(this.sparkPos); mesh.setUvs(0, uv); mesh.setColors32(col); mesh.setIndices(idx); mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    this.sparkCol = col;
    const tex = A.toTexture(dev, A.radial(32, [[0, 'rgba(255,255,255,1)'], [.4, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]), { repeat: false });
    const m = new pc.StandardMaterial(); m.useLighting = false; m.useFog = false; m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(1, 1, 1); m.emissiveMap = tex; m.emissiveVertexColor = true;
    m.emissiveIntensity = 1.6; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.blendType = pc.BLEND_ADDITIVEALPHA; m.depthWrite = false; m.cull = pc.CULLFACE_NONE; m.update();
    const e = new pc.Entity('sparks'); const mi = new pc.MeshInstance(mesh, m); mi.cull = false;
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false }); this.app.root.addChild(e);
    this.next = 0; this.wasGrounded = true;
  }
  updateSneakers(dt, r, time) {
    const on = this.is('sneakers'), arm = r.a.ch.armature, cam = this.game.scene.cameraEntity;
    if (on) {
      for (const n of ['foot_l', 'foot_r']) {
        const bi = r.a.bone(n), M = bi >= 0 ? arm.getBoneWorldMatrix(bi) : null; if (!M) continue;
        M.getTranslation(this.v);
        for (let k = 0; k < 4; k++) {
          const p = this.sparks[this.next]; this.next = (this.next + 1) % this.sparkN;
          Object.assign(p, { x: this.v.x + (Math.random() - .5) * .06, y: this.v.y + (Math.random() - .5) * .06, z: this.v.z, vx: (Math.random() - .5) * .3, vy: Math.random() * .4, vz: r.speed * .35, t: -k * dt / 4, life: .1 + Math.random() * .08, s: .012 + Math.random() * .016 });
          p.z -= k * r.speed * dt / 4; // spread the four across this frame's travel so the streak is continuous
        }
      }
      // a puff of leaves off the soles on take-off
      if (this.wasGrounded && !r.grounded && r.vy > 0) this.game.leaves.burst(r.x, r.y + .05, r.z, 12, { up: 1.6, spread: 2.4, fwd: 2 });
    }
    this.wasGrounded = r.grounded;
    const P = this.sparkPos, C = this.sparkCol, R = cam.right, U = cam.up;
    for (let i = 0; i < this.sparkN; i++) {
      const p = this.sparks[i], o = i * 12; p.t += dt;
      const k = p.t < p.life ? 1 - p.t / p.life : 0, s = p.s * (.4 + k * .8);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const rx = R.x * s, ry = R.y * s, rz = R.z * s, ux = U.x * s, uy = U.y * s, uz = U.z * s;
      P[o] = p.x - rx - ux; P[o + 1] = p.y - ry - uy; P[o + 2] = p.z - rz - uz; P[o + 3] = p.x + rx - ux; P[o + 4] = p.y + ry - uy; P[o + 5] = p.z + rz - uz;
      P[o + 6] = p.x + rx + ux; P[o + 7] = p.y + ry + uy; P[o + 8] = p.z + rz + uz; P[o + 9] = p.x - rx + ux; P[o + 10] = p.y - ry + uy; P[o + 11] = p.z - rz + uz;
      const a = Math.round(k * 200);
      for (let v = 0; v < 4; v++) C.set([Math.round(90 * k), Math.round(255 * k), Math.round(160 * k), a], i * 16 + v * 4);
    }
    this.sparkMesh.setPositions(P); this.sparkMesh.setColors32(C); this.sparkMesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }

  // ---------------------------------------------------------------- HUD chips (icon + draining ring)
  hud() {
    const el = $('powers'); if (!el) return;
    this.chips = this.chips || {};
    for (const t of TYPES) {
      const on = this.active[t] > 0; let c = this.chips[t];
      if (on && !c) { c = document.createElement('div'); c.className = 'chip'; c.style.setProperty('--c', A.POWER_COLORS[t]); c.innerHTML = `<img src="${this.icons[t]}" alt="">`; el.appendChild(c); this.chips[t] = c; }
      if (!on && c) { c.remove(); delete this.chips[t]; }
    }
  }
  reset() {
    for (const p of this.list) p.e.destroy(); this.list = []; this.active = {}; this.lastZ = 0; this.lastJetZ = null;
    this.jet.enabled = false; for (const p of this.sparks) p.t = p.life; this.hud();
  }
}
