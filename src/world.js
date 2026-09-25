import * as pc from 'playcanvas';
import { SunLight, SkyLight, PointLight, ShadowSystem } from '@viggle/splat-engine';
import { Builder, T, addMesh } from './builder.js';
import { bandMesh, domeMesh, quadMesh } from './geo.js';
import * as A from './art.js';

// Three tracks running toward -Z through a maple valley. Scenery comes in 40 m chunks that are
// built once per variant and cloned into slots ahead of the runner.
export const LANE = 2.5, LANES = [-LANE, 0, LANE], CHUNK = 40, RAIL_Y = .14;
const CLEAR_X = 5, CLEAR_Y = 6.6; // nothing leafy over the tracks below this height
export const SUN = { azimuth: 236, elevation: 19 };
export const sunDir = () => {
  const a = SUN.azimuth * Math.PI / 180, e = SUN.elevation * Math.PI / 180;
  return new pc.Vec3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

// Ground profile: flat bed, then banks rising away from the line. Periodic in z so any chunk meets any other.
const TAU = Math.PI * 2;
export function groundY(x, z, cut = 1) {
  const ax = Math.abs(x); if (ax < 5.2) return -.18;
  const side = x > 0 ? 1.7 : 0;
  const bump = Math.sin(z / CHUNK * TAU * 2 + side + ax * .3) * .35 + Math.sin(z / CHUNK * TAU * 3 + ax * .17 + side * 2) * .2;
  const rise = Math.min(1, (ax - 5.2) / 3);
  return -.18 + rise * rise * (.4 + bump * .5) + Math.max(0, ax - 9) * .22 * cut + Math.max(0, ax - 18) * .25 * cut;
}

function unlit(tex, { blend = pc.BLEND_NORMAL, color = '#ffffff', intensity = 1, depthWrite = false, alphaMap = true } = {}) {
  const m = new pc.StandardMaterial();
  m.useLighting = false; m.useFog = false; m.useSkybox = false;
  m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color().fromString(color); m.emissiveIntensity = intensity;
  if (tex) { m.emissiveMap = tex; if (alphaMap) { m.opacityMap = tex; m.opacityMapChannel = 'a'; } }
  m.blendType = blend; m.depthWrite = depthWrite; m.cull = pc.CULLFACE_NONE; m.update(); return m;
}
function lit({ map, color = '#ffffff', vc = true, gloss = .25, metal = 0, alphaTest = 0, cull = pc.CULLFACE_BACK, emissive = 0 } = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(color); if (map) m.diffuseMap = map;
  m.diffuseVertexColor = vc; m.gloss = gloss; m.useMetalness = true; m.metalness = metal;
  if (alphaTest) { m.opacityMap = map; m.opacityMapChannel = 'a'; m.alphaTest = alphaTest; }
  if (emissive) { m.emissiveMap = map; m.emissive = new pc.Color(1, .82, .62); m.emissiveIntensity = emissive; }
  m.cull = cull; m.update(); return m;
}

export class World {
  constructor(scene) {
    this.scene = scene; this.app = scene.app; this.dev = scene.app.graphicsDevice;
    this.root = new pc.Entity('world'); this.app.root.addChild(this.root);
    this.follow = new pc.Entity('follow'); this.app.root.addChild(this.follow);
    this.materials(); this.sky(); this.horizon(); this.lights(); this.environment();
    this.variants = {
      tunnel: [1, 2, 3].map(s => this.buildChunk('tunnel', s)),
      open: [4, 5].map(s => this.buildChunk('open', s)),
      station: [this.buildChunk('station', 6)],
    };
    this.slots = []; this.nextZ = 60; this.chunkIndex = 0;
    this.time = 0;
  }

  materials() {
    const d = this.dev, tex = (c, o) => A.toTexture(d, c, o);
    this.tex = {
      leaves: tex(A.leafClumps(), { repeat: false }), litter: tex(A.leafLitter(1024, {})), litterDense: tex(A.leafLitter(1024, { base: [34, 40, 26], density: 2.6, s: 9 })),
      ballast: tex(A.ballast()), wood: tex(A.wood(512, { h: 30, s: 12, l: 42, s0: 3 })), bark: tex(A.wood(256, { h: 25, s: 8, l: 36, s0: 8 })), plank: tex(A.wood(512, { h: 28, s: 36, l: 40, s0: 5 })),
      stripes: tex(A.stripes()), redWhite: tex(A.redWhite()),
    };
    this.mat = {
      leaves: lit({ map: this.tex.leaves, alphaTest: .42, cull: pc.CULLFACE_NONE, gloss: .15, emissive: .32 }),
      bark: lit({ map: this.tex.bark, gloss: .1 }),
      litter: lit({ map: this.tex.litter, gloss: .05 }),
      litterDense: lit({ map: this.tex.litterDense, gloss: .05 }),
      ballast: lit({ map: this.tex.ballast, gloss: .1 }),
      sleeper: lit({ map: this.tex.wood, gloss: .15 }),
      rail: lit({ color: '#a39d96', vc: true, gloss: .6, metal: .25 }),
      plank: lit({ map: this.tex.plank, gloss: .2 }),
      paint: lit({ gloss: .35 }),
      concrete: lit({ color: '#b9b1a4', gloss: .15 }),
    };
    // station sign
    const sign = A.signBoard(['MOMIJIDAI'], { sub: 'STATION' });
    this.mat.sign = lit({ map: A.toTexture(d, sign, { repeat: false }), vc: false, gloss: .3 });
  }

  sky() {
    const tex = A.toTexture(this.dev, A.skyTexture(), { repeat: false }); tex.addressU = pc.ADDRESS_REPEAT;
    const m = unlit(tex, { blend: pc.BLEND_NONE, alphaMap: false }); m.depthTest = true; m.update();
    const e = new pc.Entity('sky'); const mi = new pc.MeshInstance(domeMesh(this.dev, 1200, SUN.azimuth), m); mi.cull = false;
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false }); this.follow.addChild(e);
    const glow = A.toTexture(this.dev, A.radial(256, [[0, 'rgba(255,252,240,1)'], [.1, 'rgba(255,244,215,1)'], [.14, 'rgba(255,220,160,.5)'], [.4, 'rgba(255,190,120,.12)'], [1, 'rgba(255,170,100,0)']]), { repeat: false });
    this.sunQuad = new pc.Entity('sun'); this.sunQuad.addComponent('render', { meshInstances: [new pc.MeshInstance(quadMesh(this.dev, 1, 1), unlit(glow, { blend: pc.BLEND_ADDITIVEALPHA, intensity: 1.8 }))], castShadows: false, receiveShadows: false });
    this.follow.addChild(this.sunQuad);
  }

  horizon() {
    const layers = [
      { r: 1050, h: 260, s: 3, haze: .72, height: .75, y: -40 },
      { r: 820, h: 190, s: 5, haze: .45, height: .62, y: -30 },
      { r: 560, h: 110, s: 7, haze: .2, height: .5, y: -18 },
    ];
    for (const L of layers) {
      const tex = A.toTexture(this.dev, A.hills({ s: L.s, haze: L.haze, height: L.height })); tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      const m = new pc.StandardMaterial(); m.useLighting = false; m.useFog = false; m.diffuse = new pc.Color(0, 0, 0);
      m.emissiveMap = tex; m.emissive = new pc.Color(1, 1, 1); m.emissiveIntensity = .95; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.alphaTest = .5; m.cull = pc.CULLFACE_NONE; m.update();
      const e = new pc.Entity('hills'); e.addComponent('render', { meshInstances: [new pc.MeshInstance(bandMesh(this.dev, L.r, L.h, 128, Math.PI * 2, L.s, 3), m)], castShadows: false, receiveShadows: false });
      e.setLocalPosition(0, L.y, 0); this.follow.addChild(e);
    }
    // far fields out to the hills
    const fb = new Builder(); fb.ground(-900, 900, 900, -900, -1.5, T(), [.62, .5, .38], 30, 1);
    const fm = lit({ map: this.tex.litterDense, gloss: 0 }); fm.diffuseMapTiling = new pc.Vec2(1, 1); fm.update();
    addMesh(this.follow, fb.build(this.dev), fm, { cast: false, name: 'fields' });
  }

  lights() {
    const d = sunDir();
    const pivot = new pc.Entity('sunPivot'); this.app.root.addChild(pivot); pivot.lookAt(-d.x, -d.y, -d.z);
    const L = new pc.Entity('sunLight'); L.setLocalEulerAngles(90, 0, 0); pivot.addChild(L);
    L.addComponent('light', {
      type: 'directional', color: new pc.Color(1, .84, .62), intensity: 2.5, castShadows: true,
      shadowDistance: 80, shadowResolution: 2048, numCascades: 3, cascadeDistribution: .7, shadowBias: .3, normalOffsetBias: .08, shadowType: pc.SHADOW_PCF3_32F,
    });
    this.sunLight = L;
    // warm bounce from behind the camera so faces toward the runner (obstacles, trunks) read clearly
    const fd = new pc.Vec3(.25, .55, 1).normalize(), fp = new pc.Entity('fillPivot'); this.app.root.addChild(fp); fp.lookAt(-fd.x, -fd.y, -fd.z);
    const fill = new pc.Entity('fill'); fill.setLocalEulerAngles(90, 0, 0); fp.addChild(fill);
    fill.addComponent('light', { type: 'directional', color: new pc.Color(1, .86, .72), intensity: .95, castShadows: false });
    const sky = new pc.Entity('skyFill'); sky.addComponent('light', { type: 'directional', color: new pc.Color(.62, .7, .9), intensity: .35, castShadows: false });
    sky.setLocalEulerAngles(0, 0, 0); this.app.root.addChild(sky);
    this.app.scene.ambientLight = new pc.Color(.56, .5, .48);
    const fog = this.app.scene.fog; fog.type = pc.FOG_LINEAR; fog.color = new pc.Color().fromString('#e9cfa8'); fog.start = 45; fog.end = 330;
    this.splatSun = SunLight.create(this.scene, { azimuth: SUN.azimuth, elevation: SUN.elevation + 8, color: '#ffd6a0', intensity: .95 });
    this.splatSky = SkyLight.create(this.scene, { color: '#c9b7a8', intensity: .5 });
    // the meshes get a warm bounce from behind the camera (see `fill`); splats need the same or their backs go black
    this.splatFill = PointLight.create(this.scene, { position: { x: 0, y: 3, z: 6 }, color: '#ffd9b0', intensity: .38, range: 14 });
    const s = this.splatSun; s.shadowStrength = .6; s.shadowPcfStride = 2; s.shadowMinCasterOpacity = .5; s.shadowHalfExtentCap = 20; s.shadowBoxHalfExtent = new pc.Vec3(8, 5, 8);
    this.shadows = new URLSearchParams(location.search).has('noshadowsys') ? null : ShadowSystem.bind(this.scene, { resolution: 1024 });
    // invisible layer: bone-driven capsules drawn only into the sun's shadow map (splat -> mesh shadows)
    this.proxyLayer = new pc.Layer({ name: 'ShadowProxy' }); this.app.scene.layers.push(this.proxyLayer);
    L.light.layers = [...L.light.layers, this.proxyLayer.id];
  }

  // Prefiltered reflection atlas from a painted autumn equirect. Assigned per material (train paint, glass,
  // chrome), not to the scene, so the foliage and ground keep their flat ambient.
  environment() {
    const tex = A.toTexture(this.dev, A.envTexture(1024, 512, ((SUN.azimuth + 180) % 360) / 360), { repeat: false, mip: false });
    tex.projection = pc.TEXTUREPROJECTION_EQUIRECT; tex.addressU = pc.ADDRESS_REPEAT;
    const src = pc.EnvLighting.generateLightingSource(tex, { size: 256 });
    this.envAtlas = pc.EnvLighting.generateAtlas(src, { size: 512 });
  }

  // ---------------------------------------------------------------- chunk building
  tree(B, x, z, { h = 7, lean = 0, pal = 0, spread = 1, cy = 0 } = {}) {
    const { bark, leaves } = B;
    A.reseed(Math.abs(Math.floor(x * 131 + z * 17)) + 3);
    const base = new pc.Vec3(x, cy, z), dir = new pc.Vec3(Math.sin(lean), 1, 0).normalize();
    const tint = [.9 + A.rand() * .15, .85 + A.rand() * .1, .8 + A.rand() * .1];
    const r0 = .16 + h * .018;
    // trunk in two bent segments
    const mid = base.clone().add(dir.clone().mulScalar(h * .45));
    const trunkSeg = (a, b, ra, rb) => {
      const v = b.clone().sub(a), len = v.length(); v.mulScalar(1 / len);
      const q = new pc.Quat(), ax = new pc.Vec3().cross(new pc.Vec3(0, 1, 0), v);
      if (ax.lengthSq() > 1e-8) q.setFromAxisAngle(ax.normalize(), Math.acos(Math.min(1, v.y)) * 57.2958);
      bark.cyl(ra, rb, len, 7, new pc.Mat4().setTRS(a, q, pc.Vec3.ONE), tint, 1.5);
    };
    trunkSeg(base.clone().add(new pc.Vec3(0, -.3, 0)), mid, r0, r0 * .72);
    const crown = mid.clone().add(new pc.Vec3(Math.sin(lean) * h * .35 + A.rr(-.3, .3), h * .38, A.rr(-.4, .4)));
    trunkSeg(mid, crown, r0 * .72, r0 * .4);
    // limbs out to leaf clusters
    const clusters = [];
    const nb = 4 + Math.floor(A.rand() * 3);
    for (let i = 0; i < nb; i++) {
      const a = i / nb * 6.283 + A.rand() * .8, up = A.rr(.2, .9), reach = h * A.rr(.28, .45) * spread;
      const from = mid.clone().lerp(mid, crown, A.rr(.3, 1));
      const to = from.clone().add(new pc.Vec3(Math.cos(a) * reach + Math.sin(lean) * reach * .6, up * reach * .8, Math.sin(a) * reach * .7));
      if (Math.abs(to.x) < CLEAR_X) to.y = Math.max(to.y, CLEAR_Y + 1.2); // keep the arch above the roof-running camera
      trunkSeg(from, to, r0 * .38, r0 * .12);
      clusters.push({ p: to, r: h * A.rr(.2, .27) * spread });
    }
    clusters.push({ p: crown.clone().add(new pc.Vec3(0, h * .08, 0)), r: h * .3 * spread });
    if (B.canopy) for (const c of clusters) B.canopy.push({ x: c.p.x, y: Math.max(c.p.y, Math.abs(c.p.x) < CLEAR_X ? CLEAR_Y + c.r * .5 : 0), z: c.p.z, r: c.r * .95 });
    // leaf cards; normals pushed outward from the whole canopy's centre for soft, rounded shading
    const centre = new pc.Vec3(); for (const c of clusters) centre.add(c.p); centre.mulScalar(1 / clusters.length);
    const cell = pal % 4, u0 = (cell % 2) * .5, v0 = cell < 2 ? .5 : 0; // canvas top row is the top half of v
    const low = centre.y - h * .35;
    for (const c of clusters) {
      const n = Math.round(10 + c.r * 5);
      for (let i = 0; i < n; i++) {
        const a = A.rand() * 6.283, b = Math.acos(A.rr(-.6, 1)), rad = c.r * Math.cbrt(A.rand()) * .75, s = c.r * A.rr(.95, 1.35), s0 = s / 2;
        const p = c.p.clone().add(new pc.Vec3(Math.sin(b) * Math.cos(a) * rad, Math.cos(b) * rad * .7, Math.sin(b) * Math.sin(a) * rad));
        if (Math.abs(p.x) < CLEAR_X + 1 && p.y < CLEAR_Y + s0) p.y = CLEAR_Y + s0 + A.rand() * .6;
        const m = T(p.x, p.y - s / 2, p.z, A.rr(-40, 40), A.rand() * 360, A.rr(-30, 30));
        const k = Math.max(.45, Math.min(1.1, .55 + (p.y - low) / (h * .7) * .55));
        const cellPick = A.rand() < .18 ? (cell + 1) % 4 : cell, cu = (cellPick % 2) * .5, cv = cellPick < 2 ? .5 : 0;
        leaves.quad(s, s, m, [k * tint[0], k, k], [cu, cv, cu + .5, cv + .5], (V) => {
          const nn = new pc.Vec3(V.x - centre.x, (V.y - centre.y) * 1.2 + .4, V.z - centre.z); return nn.normalize();
        });
      }
    }
  }

  pole(B, x, z) {
    const tint = [.8, .72, .62];
    B.bark.cyl(.13, .1, 8.6, 7, T(x, -.2, z), tint, 2);
    B.bark.box(2.2, .12, .12, T(x, 7.6, z), tint);
    for (const dx of [-.9, .9]) B.paint.cyl(.05, .05, .14, 6, T(x + dx, 7.72, z), [.9, .9, .88]);
  }
  wires(B, x, z0, z1) {
    for (const dx of [-.9, .9]) {
      const segs = 12;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs, sag = t => 7.86 - Math.sin(t * Math.PI) * .7;
        const a = new pc.Vec3(x + dx, sag(t0), z0 + (z1 - z0) * t0), b = new pc.Vec3(x + dx, sag(t1), z0 + (z1 - z0) * t1);
        const v = b.clone().sub(a), len = v.length(); v.mulScalar(1 / len);
        const q = new pc.Quat(), ax = new pc.Vec3().cross(new pc.Vec3(0, 1, 0), v); q.setFromAxisAngle(ax.normalize(), Math.acos(v.y) * 57.2958);
        B.paint.cyl(.012, .012, len, 4, new pc.Mat4().setTRS(a, q, pc.Vec3.ONE), [.08, .08, .08]);
      }
    }
  }

  buildChunk(type, s) {
    A.reseed(s * 977);
    const B = { bark: new Builder(), leaves: new Builder(), litter: new Builder(), ballast: new Builder(), sleeper: new Builder(), rail: new Builder(), plank: new Builder(), paint: new Builder(), concrete: new Builder(), canopy: [] };
    const L = CHUNK, cut = .7; // same bank profile everywhere so any chunk meets any other
    // track bed
    B.ballast.ground(-5.2, 0, 5.2, -L, -.02, T(), [.95, .95, .95], 3, 1);
    for (const sx of [-1, 1]) {
      // shoulder: ballast sloping down to the grass
      const P = [5.2 * sx, -.02, 0, 5.2 * sx, -.02, -L, 5.9 * sx, -.2, -L, 5.9 * sx, -.2, 0];
      B.ballast.push(P, [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [0, 0, 0, L / 3, .3, L / 3, .3, 0], sx > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3], T(), [.8, .78, .75]);
    }
    for (const lx of LANES) {
      for (let z = -.3; z > -L; z -= .62) B.sleeper.box(2.05, .12, .24, T(lx + A.rr(-.03, .03), -.02, z, 0, A.rr(-1.5, 1.5), 0), [A.rr(.7, 1), A.rr(.65, .9), A.rr(.6, .85)]);
      for (const rx of [-.72, .72]) { B.rail.box(.08, .1, L, T(lx + rx, .1, -L / 2), [.55, .45, .38]); B.rail.box(.1, .04, L, T(lx + rx, .18, -L / 2), [1, 1, 1]); }
    }
    // banks either side
    const hf = (x, z) => groundY(x, z, cut);
    for (const sx of [-1, 1]) {
      const x0 = 5.8 * sx, x1 = 70 * sx;
      const Bld = type === 'open' ? B.litter : B.litter;
      const P = [], Nn = [], U = [], I = [], NX = 22, NZ = 8;
      for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
        const t = (i / NX) ** 1.8, x = x0 + (x1 - x0) * t, z = -L * j / NZ, y = hf(x, z);
        const e = .2, nx = -(hf(x + e, z) - hf(x - e, z)) / (2 * e), nz = -(hf(x, z + e) - hf(x, z - e)) / (2 * e);
        const n = new pc.Vec3(nx, 1, nz).normalize(); P.push(x, y, z); Nn.push(n.x, n.y, n.z); U.push(x / 5, -z / 5);
        if (i < NX && j < NZ) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; sx > 0 ? I.push(a, b, c, b, d, c) : I.push(a, c, b, b, c, d); }
      }
      Bld.push(P, Nn, U, I, T(), (V) => { const k = Math.min(1, Math.abs(V.x) / 30); return [1 - k * .15, 1 - k * .12, 1 - k * .1]; });
    }
    // utility poles on the right, every 20 m, wired to the next pole (the next chunk's first pole sits at -L)
    this.pole(B, 7.4, -2); this.pole(B, 7.4, -22); this.wires(B, 7.4, -2, -22); this.wires(B, 7.4, -22, -42);

    if (type === 'tunnel') {
      // the maple tunnel: an inner row leaning over the track, a second row behind, a scatter beyond
      for (const sx of [-1, 1]) {
        for (let z = -A.rr(1, 3); z > -L; z -= A.rr(4.2, 6.2)) {
          const x = sx * A.rr(6.4, 8.2);
          this.tree(B, x, z, { h: A.rr(7.5, 9.5), lean: -sx * A.rr(.28, .42), pal: A.pick([0, 0, 1, 1, 2, 3]), spread: A.rr(1.05, 1.3), cy: hf(x, z) });
        }
        for (let z = -A.rr(0, 4); z > -L; z -= A.rr(5, 8)) {
          const x = sx * A.rr(11, 15);
          this.tree(B, x, z, { h: A.rr(8, 11), lean: -sx * A.rr(.05, .2), pal: A.pick([0, 1, 2, 2, 3]), spread: 1.2, cy: hf(x, z) });
        }
        for (let i = 0; i < 5; i++) { const x = sx * A.rr(19, 36), z = -A.rand() * L; this.tree(B, x, z, { h: A.rr(8, 12), pal: A.pick([0, 1, 2, 3]), spread: 1.3, cy: hf(x, z) }); }
      }
    } else if (type === 'open') {
      // rice terraces after harvest: drying racks, a few specimen maples, a red torii up the bank
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) { const x = sx * A.rr(9, 24), z = -A.rand() * L; this.tree(B, x, z, { h: A.rr(6, 9), pal: A.pick([0, 1, 2]), spread: 1.25, cy: hf(x, z) }); }
        for (let i = 0; i < 4; i++) { const x = sx * A.rr(28, 50), z = -A.rand() * L; this.tree(B, x, z, { h: A.rr(8, 12), pal: A.pick([0, 1, 2, 3]), spread: 1.3, cy: hf(x, z) }); }
      }
      // hasa-kake rice drying rack on the left
      const rx = -12, rz = -A.rr(8, 20), y0 = hf(rx, rz);
      for (let i = 0; i < 6; i++) B.bark.cyl(.05, .05, 2, 5, T(rx, y0 - .1, rz - i * 2), [.7, .6, .5]);
      B.bark.box(.08, .08, 10.4, T(rx, y0 + 1.5, rz - 5), [.7, .6, .5]);
      for (let i = 0; i < 26; i++) B.paint.box(.45, .9, .32, T(rx, y0 + .75, rz - .2 - i * .38, 0, 0, A.rr(-6, 6)), [A.rr(.78, .88), A.rr(.62, .7), A.rr(.28, .34)]);
      // torii on the right bank
      const tx = 14, tz = -L * .6, ty = hf(tx, tz), red = [.78, .16, .1], blk = [.12, .1, .1];
      for (const dz of [-1.5, 1.5]) B.paint.cyl(.2, .17, 4.2, 10, T(tx, ty - .1, tz + dz), red);
      B.paint.box(.5, .32, 4.8, T(tx, ty + 3.3, tz), red); B.paint.box(.6, .3, 5.6, T(tx, ty + 4.05, tz, 0, 0, 0), blk);
      B.paint.box(.3, .5, .3, T(tx, ty + 3.6, tz), red);
    } else if (type === 'station') {
      // platform on the left with a wooden shelter
      const px = -7.4, top = .95;
      B.concrete.box(3.8, top + .2, L - 6, T(px, -.2, -L / 2), [1, 1, 1]);
      B.paint.box(.35, .01, L - 6, T(px + 1.55, top, -L / 2), [.96, .78, .1]);
      B.paint.box(.1, .02, L - 6, T(px + 1.86, top, -L / 2), [.9, .9, .88]);
      const sz = -L / 2;
      for (const dz of [-3, 3]) for (const dx of [-1.3, 1.1]) B.bark.box(.16, 2.8, .16, T(px + dx, top, sz + dz), [.7, .55, .42]);
      B.plank.box(3.4, .12, 7.4, T(px - .1, top + 2.8, sz, 0, 0, -8), [.9, .82, .74]);
      B.paint.box(3.6, .06, 7.6, T(px - .1, top + 2.95, sz, 0, 0, -8), [.36, .22, .18]);
      B.plank.box(.08, 1.4, 6, T(px - 1.42, top, sz), [.85, .75, .65]);
      for (const dz of [-1.6, 1.4]) { B.plank.box(.45, .06, 1.6, T(px - .9, top + .45, sz + dz), [1, .9, .8]); B.bark.box(.4, .45, .06, T(px - .9, top, sz + dz - .7), [.7, .6, .5]); B.bark.box(.4, .45, .06, T(px - .9, top, sz + dz + .7), [.7, .6, .5]); }
      // name board on two legs
      this.stationSign = { x: px + .4, y: top + 1.2, z: sz - 8 };
      for (const dz of [-1, 1]) B.bark.box(.1, 1.5, .1, T(px + .4, top, sz - 8 + dz), [.5, .45, .4]);
      // lamps
      for (const dz of [-14, 0, 14]) { B.paint.cyl(.05, .05, 3, 6, T(px + 1.2, top, sz + dz), [.2, .22, .2]); B.paint.box(.5, .08, .2, T(px + 1.2, top + 3, sz + dz), [.2, .22, .2]); }
      for (const sx of [-1, 1]) for (let z = -3; z > -L; z -= A.rr(5, 8)) { const x = sx > 0 ? A.rr(7, 9) : A.rr(-12, -10.5); this.tree(B, x, z, { h: A.rr(7.5, 10), lean: -sx * .3, pal: A.pick([0, 1, 2]), spread: 1.2, cy: sx > 0 ? hf(x, z) : top }); }
      for (let i = 0; i < 4; i++) { const x = A.rr(12, 30), z = -A.rand() * L; this.tree(B, x, z, { h: A.rr(8, 11), pal: A.pick([0, 1, 2, 3]), spread: 1.3, cy: hf(x, z) }); }
    }

    const root = new pc.Entity('chunk-' + type);
    const put = (b, mat, opt) => addMesh(root, b.build(this.dev), mat, opt);
    put(B.ballast, this.mat.ballast, { cast: false });
    put(B.sleeper, this.mat.sleeper, { cast: false });
    put(B.rail, this.mat.rail, { cast: false });
    put(B.litter, this.mat.litter, { cast: false });
    put(B.bark, this.mat.bark);
    put(B.leaves, this.mat.leaves);
    put(B.plank, this.mat.plank);
    put(B.paint, this.mat.paint);
    put(B.concrete, this.mat.concrete);
    if (type === 'station' && this.stationSign) {
      const s = this.stationSign, e = new pc.Entity('sign');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(quadMesh(this.dev, 2.6, .65), this.mat.sign)], castShadows: true });
      e.setLocalPosition(s.x + .06, s.y + .8, s.z); e.setLocalEulerAngles(0, 90, 0); root.addChild(e);
      const back = e.clone(); back.setLocalEulerAngles(0, -90, 0); back.setLocalPosition(s.x - .06, s.y + .8, s.z); root.addChild(back);
    }
    root.canopy = B.canopy; root.enabled = false; this.app.root.addChild(root);
    return root;
  }

  // Keep chunks ahead of z (runner goes toward -Z) and drop those behind the camera.
  pickType() {
    const i = this.chunkIndex++;
    if (i < 2) return 'tunnel';
    if (i % 14 === 7) return 'station';
    return (i % 5 === 3 || i % 11 === 9) ? 'open' : 'tunnel';
  }
  update(dt, runnerZ, cam) {
    this.time += dt;
    while (this.nextZ > runnerZ - 300) {
      const type = this.pickType(), list = this.variants[type], tpl = list[Math.floor(Math.random() * list.length)];
      const e = tpl.clone(); e.enabled = true; e.setLocalPosition(0, 0, this.nextZ); this.root.addChild(e);
      this.slots.push({ e, z: this.nextZ, type, canopy: tpl.canopy }); this.nextZ -= CHUNK;
    }
    while (this.slots.length && this.slots[0].z - CHUNK > runnerZ + 30) this.slots.shift().e.destroy();
    const p = cam.getPosition(); this.follow.setLocalPosition(p.x, 0, p.z);
    const d = sunDir(), s = 170;
    this.sunQuad.setLocalPosition(d.x * 1100, d.y * 1100 - s / 2, d.z * 1100); this.sunQuad.lookAt(p); this.sunQuad.rotateLocal(0, 180, 0); this.sunQuad.setLocalScale(s, s, 1);
    if (this.shadows) this.shadows.setFocalPoint(this.focus || p);
  }
  // How much direct sun reaches p (0..1): march toward the sun through the maple clusters of nearby chunks.
  // Clusters are porous, so each crossing only takes part of the light; gaps between leaves add dapple.
  sunAt(p) {
    const d = this.sunD || (this.sunD = sunDir()); let depth = 0;
    for (const s of this.slots) {
      if (p.z > s.z + 20 || p.z < s.z - CHUNK - 20 || !s.canopy) continue;
      for (const c of s.canopy) {
        const vx = c.x - p.x, vy = c.y - p.y, vz = c.z + s.z - p.z, t = vx * d.x + vy * d.y + vz * d.z;
        if (t <= 0) continue;
        const d2 = vx * vx + vy * vy + vz * vz - t * t, r2 = c.r * c.r;
        if (d2 < r2) depth += Math.sqrt(r2 - d2) / c.r; // chord length in radii: 0..2
      }
    }
    const gaps = .5 + .5 * Math.sin(p.z * 2.3 + Math.sin(p.z * .7) * 3) * Math.sin(p.x * 3.1 + p.z * .9);
    return Math.exp(-depth * (.4 + .35 * gaps));
  }
  reset() { for (const s of this.slots) s.e.destroy(); this.slots = []; this.nextZ = 60; this.chunkIndex = 0; }
}
