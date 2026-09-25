import * as pc from 'playcanvas';
import { Builder, T, addMesh } from './builder.js';
import { quadMesh } from './geo.js';
import { LANES, RAIL_Y } from './world.js';
import * as A from './art.js';

// Obstacles face +Z (toward the runner, who travels to -Z).
// Every obstacle has an AABB {x, w, z0 (back, more negative), z1 (front), y0, y1} and optionally a walkable top.
export const TRAIN_LEN = 15, TRAIN_W = 2.6, TRAIN_TOP = 3.3, RAMP_LEN = 7;
const ROLL_UNDER = 1.2;

function mat({ map, color = '#ffffff', vc = true, gloss = .3, metal = 0, emissive, emissiveMap, alphaTest = 0, cull = pc.CULLFACE_BACK }) {
  const m = new pc.StandardMaterial(); m.diffuse = new pc.Color().fromString(color); if (map) m.diffuseMap = map; m.diffuseVertexColor = vc;
  m.gloss = gloss; m.useMetalness = true; m.metalness = metal; m.cull = cull;
  if (emissive) { m.emissive = new pc.Color().fromString(emissive); if (emissiveMap) m.emissiveMap = emissiveMap; }
  if (alphaTest) { m.opacityMap = map; m.opacityMapChannel = 'a'; m.alphaTest = alphaTest; }
  m.update(); return m;
}

export class Obstacles {
  constructor(game) {
    this.game = game; this.app = game.scene.app; this.dev = this.app.graphicsDevice;
    this.root = new pc.Entity('obstacles'); this.app.root.addChild(this.root);
    this.list = []; this.coins = []; this.spawnZ = -40; this.rng = Math.random;
  }
  async init() {
    this.buildTemplates();
    try { const [a, b] = await this.modelTemplates(); this.tpl.train = a; this.tpl.trainLit = b; }
    catch (e) { console.warn('train model failed, keeping the box train', e); }
  }

  // The modelled EMU (tools/train.py -> public/models/train.glb). Materials are tuned here by name.
  async modelTemplates() {
    const app = this.app, env = this.game.world.envAtlas, tex = (c, o) => A.toTexture(this.dev, c, o);
    const asset = new pc.Asset('train', 'container', { url: `${import.meta.env.BASE_URL}models/train.glb?v=1` });
    app.assets.add(asset);
    await new Promise((res, rej) => { asset.once('load', res); asset.once('error', rej); app.assets.load(asset); });
    const grime = tex(A.trainGrime()), dest = tex(A.destBoard(), { repeat: false }), destLit = tex(A.destBoard('NOT IN SERVICE', 'OUT OF SERVICE'), { repeat: false }), logo = tex(A.lineLogo(), { repeat: false });
    const build = lit => {
      const e = asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      const swaps = new Map();
      for (const r of e.findComponents('render')) for (const mi of r.meshInstances) {
        const src = mi.material; if (!swaps.has(src)) swaps.set(src, this.tuneTrainMat(src.clone(), src.name.replace(/\.\d+$/, ''), { lit, env, dest: lit ? destLit : dest, logo, grime }));
        mi.material = swaps.get(src);
        if (!/^(paint|dielectric)/.test(src.name)) mi.castShadow = false; // the shell and underframe carry the shadow
      }
      e.enabled = false; app.root.addChild(e);
      if (lit) for (const x of [-.86, .86]) { const g = new pc.Entity('glow'); g.addComponent('render', { meshInstances: [new pc.MeshInstance(quadMesh(this.dev, 1.8, 1.8), this.glowMat)], castShadows: false, receiveShadows: false }); g.setLocalPosition(x, 1.52 - .9, .12); e.addChild(g); }
      return e;
    };
    return [build(false), build(true)];
  }
  tuneTrainMat(m, name, { lit, env, dest, logo, grime }) {
    m.name = name; m.envAtlas = env; m.useSkybox = false;
    if (['paint', 'paint_lower', 'dielectric', 'metal'].includes(name)) {
      // colour and roughness are baked per vertex (tools/train.py): rgb = base colour, alpha = gloss
      m.diffuseVertexColor = name !== 'paint_lower'; m.diffuse = new pc.Color(1, 1, 1);
      m.glossVertexColor = true; m.glossVertexColorChannel = 'a'; m.gloss = 1;
      m.metalness = name === 'metal' ? .9 : 0;
    }
    if (name === 'paint' || name === 'paint_lower') {
      m.diffuseMap = grime; m.diffuseMapTiling = new pc.Vec2(1 / 15, 1 / 3.4);
      m.clearCoat = .6; m.clearCoatGloss = .9;
      if (name === 'paint_lower') { m.diffuse = new pc.Color().fromString(lit ? '#1f5a3a' : '#8a1a1c'); }
    }
    if (name === 'glass') { m.diffuse = new pc.Color(.07, .1, .12); m.opacity = .42; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.gloss = .96; m.metalness = .2; m.cull = pc.CULLFACE_NONE; }
    if (name === 'headlight') { m.emissive = lit ? new pc.Color(1, .96, .85) : new pc.Color(.25, .24, .2); m.emissiveIntensity = lit ? 8 : 1; }
    if (name === 'taillight') { m.emissiveIntensity = lit ? .2 : 1.4; }
    if (name === 'ceiling_light') { m.emissiveIntensity = lit ? 2.2 : .5; }
    if (name === 'dest') { m.emissiveMap = dest; m.emissive = new pc.Color(1, 1, 1); m.emissiveIntensity = 1.6; m.diffuse = new pc.Color(0, 0, 0); }
    if (name === 'decal') { m.diffuseMap = logo; m.opacityMap = logo; m.opacityMapChannel = 'a'; m.alphaTest = .4; m.diffuse = new pc.Color(1, 1, 1); m.metalness = .5; m.gloss = .6; }
    m.update(); return m;
  }

  // ---------------------------------------------------------------- templates
  buildTemplates() {
    const d = this.dev, tex = (c, o) => A.toTexture(d, c, o);
    const side = tex(A.trainSide(), { repeat: false }), front = tex(A.trainFront({ lamp: false }), { repeat: false }), frontLit = tex(A.trainFront({ lamp: true }), { repeat: false });
    const sideLit = tex(A.trainSide({ lamp: true, lower: '#1f5a3a', upper: '#efe6cc', stripe: '#e0b04a' }), { repeat: false });
    const M = {
      side: mat({ map: side, vc: false, gloss: .55 }), sideLit: mat({ map: sideLit, vc: false, gloss: .55 }),
      front: mat({ map: front, vc: false, gloss: .55 }), frontLit: mat({ map: frontLit, vc: false, gloss: .55, emissive: '#ffffff', emissiveMap: frontLit }),
      paint: mat({ gloss: .35 }), steel: mat({ color: '#9a958e', gloss: .6, metal: .7 }),
      plank: this.game.world.mat.plank,
      stripes: mat({ map: tex(A.stripes()), vc: false, gloss: .4 }), redWhite: mat({ map: tex(A.redWhite()), vc: false, gloss: .4 }),
    };
    M.frontLit.emissiveIntensity = .35; M.frontLit.update();
    this.M = M;
    // headlight glow card for oncoming trains
    const glow = tex(A.radial(128, [[0, 'rgba(255,250,220,1)'], [.25, 'rgba(255,230,160,.6)'], [1, 'rgba(255,200,120,0)']]), { repeat: false });
    const gm = new pc.StandardMaterial(); gm.useLighting = false; gm.useFog = false; gm.diffuse = new pc.Color(0, 0, 0); gm.emissive = new pc.Color(1, .95, .8); gm.emissiveMap = glow; gm.opacityMap = glow; gm.opacityMapChannel = 'a'; gm.emissiveIntensity = 3;
    gm.blendType = pc.BLEND_ADDITIVEALPHA; gm.depthWrite = false; gm.cull = pc.CULLFACE_NONE; gm.update(); this.glowMat = gm;
    this.tpl = { train: this.trainTemplate(false), trainLit: this.trainTemplate(true), ramp: this.rampTemplate(), hurdle: this.hurdleTemplate(), gate: this.gateTemplate() };
    // coin: a golden maple leaf that spins
    const gl = tex(A.goldLeaf(), { repeat: false });
    const cm = new pc.StandardMaterial(); cm.diffuse = new pc.Color(1, .8, .3); cm.diffuseMap = gl; cm.emissiveMap = gl; cm.emissive = new pc.Color(1, .75, .3); cm.emissiveIntensity = .9;
    cm.opacityMap = gl; cm.opacityMapChannel = 'a'; cm.alphaTest = .5; cm.cull = pc.CULLFACE_NONE; cm.gloss = .8; cm.useMetalness = true; cm.metalness = .6; cm.update();
    this.coinMesh = quadMesh(d, .62, .62); this.coinMat = cm;
    this.coinMesh.incRefCount(); // coins come and go; without a standing ref the shared mesh is freed with the last one (breaks round 2)
  }

  trainTemplate(lit) {
    const d = this.dev, M = this.M, e = new pc.Entity(lit ? 'trainLit' : 'train');
    const L = TRAIN_LEN, W = TRAIN_W, y0 = .55, H = TRAIN_TOP - .2 - y0;
    // body shell (paint), textured side and end panels on top of it
    const b = new Builder();
    b.box(W - .04, H, L - .04, T(0, y0, -L / 2), [.93, .9, .82]);
    // roof: shallow crown
    b.box(W, .1, L, T(0, y0 + H, -L / 2), [.55, .55, .56]);
    b.box(W * .7, .1, L - .4, T(0, y0 + H + .1, -L / 2), [.5, .5, .52]);
    // underframe, bogies and wheels
    b.box(W * .8, .35, L - 1, T(0, .2, -L / 2), [.12, .12, .13]);
    for (const bz of [-2.4, -L + 2.4]) {
      b.box(W * .7, .4, 2.4, T(0, .12, bz), [.18, .18, .19]);
      for (const wz of [-.7, .7]) for (const wx of [-.72, .72]) b.cyl(.34, .34, .12, 12, T(wx + (wx > 0 ? -.06 : .06), .5, bz + wz, 0, 0, 90), [.22, .2, .2]);
    }
    // couplers
    b.box(.3, .25, .5, T(0, .6, .2), [.15, .15, .15]); b.box(.3, .25, .5, T(0, .6, -L - .2), [.15, .15, .15]);
    // pantograph (folded low so roof-running is clear)
    b.box(1.2, .06, .06, T(0, TRAIN_TOP - .05, -L * .3), [.2, .2, .2]); b.box(.06, .06, 1.2, T(0, TRAIN_TOP - .05, -L * .3), [.2, .2, .2]);
    addMesh(e, b.build(d), M.paint);
    const panel = (m, w, h, pos, rot) => { const q = new pc.Entity(); q.addComponent('render', { meshInstances: [new pc.MeshInstance(quadMesh(d, w, h), m)], castShadows: false }); q.setLocalPosition(...pos); q.setLocalEulerAngles(...rot); e.addChild(q); };
    const sm = lit ? M.sideLit : M.side;
    panel(sm, L, H, [W / 2 + .01, y0, -L / 2], [0, 90, 0]);
    panel(sm, L, H, [-W / 2 - .01, y0, -L / 2], [0, -90, 0]);
    panel(lit ? M.frontLit : M.front, W, H, [0, y0, .01], [0, 0, 0]);
    panel(M.front, W, H, [0, y0, -L - .01], [0, 180, 0]);
    if (lit) for (const x of [-.78, .78]) { const g = new pc.Entity('glow'); g.addComponent('render', { meshInstances: [new pc.MeshInstance(quadMesh(d, 1.6, 1.6), this.glowMat)], castShadows: false, receiveShadows: false }); g.setLocalPosition(x, y0 + H * .7 - .8, .15); e.addChild(g); }
    e.enabled = false; this.app.root.addChild(e); return e;
  }
  rampTemplate() {
    const d = this.dev, e = new pc.Entity('ramp'), b = new Builder(), L = RAMP_LEN, top = TRAIN_TOP, W = TRAIN_W - .2;
    const ang = Math.atan2(top, L) * 57.2958, len = Math.hypot(top, L);
    // deck of planks from (z=0, y=0) up to (z=-L, y=top)
    for (let i = 0; i < 18; i++) { const t = (i + .5) / 18; b.box(W, .08, len / 18 - .03, T(0, t * top - .05, -t * L, ang, 0, 0), [A.rr(.8, 1), A.rr(.75, .95), A.rr(.7, .9)]); }
    // stringers and trestle legs
    for (const x of [-W / 2 + .1, W / 2 - .1]) {
      b.box(.12, .25, len, T(x, top / 2 - .2, -L / 2, ang, 0, 0), [.5, .4, .32]);
      for (let k = 1; k <= 3; k++) { const t = k / 3.5; b.box(.12, t * top - .1, .12, T(x, 0, -t * L), [.55, .45, .36]); }
    }
    addMesh(e, b.build(d), this.M.plank);
    e.enabled = false; this.app.root.addChild(e); return e;
  }
  hurdleTemplate() {
    // low crossing barrier: two posts and striped rails, jump it
    const d = this.dev, e = new pc.Entity('hurdle'), b = new Builder();
    for (const x of [-1.05, 1.05]) { b.box(.12, 1, .12, T(x, 0, 0), [.2, .2, .2]); b.box(.5, .06, .4, T(x, 0, 0), [.25, .25, .25]); }
    addMesh(e, b.build(d), this.M.paint);
    const bar = (y, h) => { const q = new Builder(); q.box(2.2, h, .08, T(0, y, 0), [1, 1, 1], .5); addMesh(e, q.build(d), this.M.stripes); };
    bar(.78, .2); bar(.38, .2);
    e.enabled = false; this.app.root.addChild(e); return e;
  }
  gateTemplate() {
    // overhead crossing arm with a red-and-white board: roll under it
    const d = this.dev, e = new pc.Entity('gate'), b = new Builder();
    for (const x of [-1.2, 1.2]) b.box(.14, 2.9, .14, T(x, 0, 0), [.9, .9, .88]);
    b.box(.9, .7, .06, T(0, 2.25, .02), [.95, .9, .2]);
    addMesh(e, b.build(d), this.M.paint);
    const q = new Builder(); q.box(2.5, .32, .1, T(0, ROLL_UNDER + .05, 0), [1, 1, 1], .6); q.box(2.5, .32, .1, T(0, ROLL_UNDER + .55, 0), [1, 1, 1], .6);
    addMesh(e, q.build(d), this.M.redWhite);
    // warning lamps
    const l = new Builder(); for (const x of [-.25, .25]) l.cyl(.13, .13, .08, 12, T(x, 2.6, .06, 90, 0, 0), [1, .2, .1]);
    const lm = mat({ color: '#ff2a1a', emissive: '#ff2a1a', gloss: .7 }); lm.emissiveIntensity = 2; lm.update();
    addMesh(e, l.build(d), lm, { cast: false }); e.lampMat = lm;
    e.enabled = false; this.app.root.addChild(e); return e;
  }

  // ---------------------------------------------------------------- spawning
  add(kind, lane, z, extra = {}) {
    const x = LANES[lane], tplName = kind === 'train' && extra.moving ? 'trainLit' : kind;
    const e = this.tpl[tplName].clone(); e.enabled = true; e.setLocalPosition(x, kind === 'train' ? RAIL_Y - .14 : RAIL_Y - .02, z); this.root.addChild(e);
    const o = { kind, lane, x, z, e, vz: extra.moving ? extra.speed : 0, moving: !!extra.moving, active: !extra.moving, ...extra };
    this.shape(o); this.list.push(o); return o;
  }
  shape(o) {
    if (o.kind === 'train') Object.assign(o, { w: TRAIN_W, z1: o.z, z0: o.z - TRAIN_LEN, y0: 0, y1: TRAIN_TOP, top: TRAIN_TOP });
    else if (o.kind === 'ramp') Object.assign(o, { w: TRAIN_W - .2, z1: o.z, z0: o.z - RAMP_LEN, y0: 0, y1: TRAIN_TOP, ramp: true });
    else if (o.kind === 'hurdle') Object.assign(o, { w: 2.2, z1: o.z + .15, z0: o.z - .15, y0: 0, y1: 1.0 + RAIL_Y });
    else if (o.kind === 'gate') Object.assign(o, { w: 2.4, z1: o.z + .15, z0: o.z - .15, y0: ROLL_UNDER + RAIL_Y - .1, y1: 2.9 });
  }
  coin(lane, z, y) {
    const e = new pc.Entity('coin'); e.addComponent('render', { meshInstances: [new pc.MeshInstance(this.coinMesh, this.coinMat)], castShadows: true, receiveShadows: false });
    e.setLocalPosition(LANES[lane], y, z); this.root.addChild(e);
    this.coins.push({ e, lane, x: LANES[lane], y, z, taken: false, t: 0 });
  }
  coinRow(lane, z, n, { gap = 2.2, y = RAIL_Y + .45, arc = null } = {}) {
    for (let i = 0; i < n; i++) {
      let yy = y; if (arc) { const t = i / (n - 1); yy += Math.sin(t * Math.PI) * arc; }
      this.coin(lane, z - i * gap, yy);
    }
  }

  // Blocked lanes must leave a way through: every row keeps at least one lane free or passable.
  generate(speed, difficulty) {
    const r = this.rng, z = this.spawnZ, pickLane = () => Math.floor(r() * 3);
    const gapMin = 14 + speed * .55;
    const types = difficulty < .15 ? ['hurdles', 'gates', 'trains', 'coins', 'hurdles', 'trains']
      : ['hurdles', 'gates', 'mixed', 'trains', 'rampRun', 'rampRun', 'oncoming', 'mixed', 'trains', 'coins'];
    const type = types[Math.floor(r() * types.length)];
    let used = 0;
    if (type === 'hurdles' || type === 'gates') {
      const rows = 2 + Math.floor(r() * 2);
      for (let k = 0; k < rows; k++) {
        const zz = z - k * gapMin, free = pickLane();
        for (let l = 0; l < 3; l++) {
          if (l === free) { if (r() < .6) this.coinRow(l, zz + 4, 5, { gap: 2 }); continue; }
          if (r() < .75) {
            this.add(type === 'hurdles' ? 'hurdle' : 'gate', l, zz);
            if (type === 'hurdles' && r() < .4) this.coinRow(l, zz + 3.5, 5, { gap: 1.75, arc: 1.5 });
          }
        }
      }
      used = rows * gapMin;
    } else if (type === 'mixed') {
      const rows = 3;
      for (let k = 0; k < rows; k++) {
        const zz = z - k * gapMin, pattern = [['hurdle', 'gate', null], ['gate', null, 'hurdle'], [null, 'hurdle', 'gate'], ['hurdle', 'hurdle', 'gate'], ['gate', 'hurdle', 'gate']][Math.floor(r() * 5)];
        const shift = Math.floor(r() * 3);
        for (let l = 0; l < 3; l++) { const kind = pattern[(l + shift) % 3]; if (kind) this.add(kind, l, zz); else this.coinRow(l, zz + 3, 4, { gap: 2 }); }
      }
      used = rows * gapMin;
    } else if (type === 'trains') {
      // two parked trains side by side, sometimes staggered; the third lane is open
      const free = pickLane();
      for (let l = 0; l < 3; l++) if (l !== free) this.add('train', l, z - (r() < .5 ? 0 : 8));
      this.coinRow(free, z + 2, 8, { gap: 2.4 });
      if (r() < .5) this.add('hurdle', free, z - TRAIN_LEN - 6);
      used = TRAIN_LEN + 12 + gapMin * .6;
    } else if (type === 'rampRun') {
      // ramp onto a train, then a second train behind it: run the roofs, leaves along the top
      const lane = pickLane();
      this.add('ramp', lane, z); this.add('train', lane, z - RAMP_LEN);
      const second = r() < .7; if (second) this.add('train', lane, z - RAMP_LEN - TRAIN_LEN - 1.5);
      this.coinRow(lane, z - 1, 5, { gap: 1.4, y: RAIL_Y + .5 });
      for (let i = 0; i < 7; i++) this.coin(lane, z - RAMP_LEN - 1 - i * 2, TRAIN_TOP + .6);
      if (second) for (let i = 0; i < 7; i++) this.coin(lane, z - RAMP_LEN - TRAIN_LEN - 2.5 - i * 2, TRAIN_TOP + .6);
      // the other lanes carry parked trains too, one of them offset
      const others = [0, 1, 2].filter(l => l !== lane);
      this.add('train', others[0], z - 3 - r() * 10);
      if (r() < .6) this.add('train', others[1], z - 12 - r() * 8); else this.add('gate', others[1], z - 6);
      used = RAMP_LEN + TRAIN_LEN * (second ? 2 : 1) + 8;
    } else if (type === 'oncoming') {
      // a lit train rolls toward you in one lane; the others hold hurdles
      const lane = pickLane(), len = 70;
      this.add('train', lane, z - len + TRAIN_LEN + 5, { moving: true, speed: 7 + difficulty * 6, horn: true });
      for (let l = 0; l < 3; l++) if (l !== lane && r() < .5) this.add(r() < .5 ? 'hurdle' : 'gate', l, z - 20 - r() * 20);
      const cl = (lane + 1 + Math.floor(r() * 2)) % 3; this.coinRow(cl, z - 4, 10, { gap: 2.4 });
      used = len;
    } else {
      // breather: a weaving line of leaves
      let l = 1; for (let i = 0; i < 16; i++) { if (i % 5 === 4) l = Math.max(0, Math.min(2, l + (r() < .5 ? -1 : 1))); this.coin(l, z - i * 2.2, RAIL_Y + .45); }
      used = 40;
    }
    const gap = gapMin * (.7 + r() * .4);
    this.game.powerups?.offer(z - used - gap / 2, pickLane()); // the gap between patterns is always clear
    this.spawnZ -= used + gap;
  }

  update(dt, runner, speed, difficulty, time) {
    while (this.spawnZ > runner.z - 190) this.generate(speed, difficulty);
    for (const o of this.list) {
      if (o.moving) {
        // start rolling once the gap is right for a meeting inside its clear stretch
        if (!o.active && o.z > runner.z - (speed + o.vz) * 3.8) { o.active = true; this.game.onTrainStart?.(o); }
        o.prevZ1 = o.z1;
        if (o.active) { o.z += o.vz * dt; this.shape(o); o.e.setLocalPosition(o.x, RAIL_Y - .14, o.z); }
      } else o.prevZ1 = o.z1;
    }
    const blink = Math.sin(time * 9) > 0; const gm = this.tpl.gate.lampMat; // clones share it
    if (gm && gm._blink !== blink) { gm._blink = blink; gm.emissiveIntensity = blink ? 3 : .2; gm.update(); }
    // retire what is behind the camera
    const behind = runner.z + 25;
    this.list = this.list.filter(o => { if (o.z0 > behind) { o.e.destroy(); return false; } return true; });
    for (const c of this.coins) {
      if (c.taken) { c.t += dt; const k = c.t / .35; c.e.setLocalScale(1 - k, 1 - k, 1 - k); c.y += dt * 4; c.e.setLocalPosition(c.x, c.y, c.z); if (k >= 1) { c.e.destroy(); c.dead = true; } continue; }
      c.e.setLocalEulerAngles(0, time * 160 + c.z * 12, 0);
      if (c.z > behind) { c.e.destroy(); c.dead = true; }
    }
    this.coins = this.coins.filter(c => !c.dead);
  }

  // Highest walkable surface under (x, z) at or below `feetY + step`.
  groundAt(x, z, feetY) {
    let g = RAIL_Y;
    for (const o of this.list) {
      if (!(o.top || o.ramp) || Math.abs(x - o.x) > o.w / 2 || z > o.z1 || z < o.z0) continue;
      const s = o.ramp ? RAIL_Y + (o.z1 - z) / RAMP_LEN * (TRAIN_TOP - RAIL_Y) : o.top + RAIL_Y - .14;
      if (s <= feetY + .6 && s > g) g = s;
    }
    return g;
  }
  reset() { for (const o of this.list) o.e.destroy(); for (const c of this.coins) c.e.destroy(); this.list = []; this.coins = []; this.spawnZ = -40; }
}
