import * as pc from 'playcanvas';
import * as A from './art.js';

// Falling maple leaves: one dynamic mesh of tumbling quads (not billboards: they flip and flash as they turn).
// Also used for bursts (kicked up by feet, landing, collecting) via `burst()`.
export class Leaves {
  constructor(app, { count = 700 } = {}) {
    this.app = app; const dev = app.graphicsDevice, N = count; this.N = N;
    this.p = Array.from({ length: N }, () => ({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, a: 0, b: 0, c: 0, wa: 0, wb: 0, wc: 0, s: .1, cell: 0, ph: 0, burst: 0, life: 0 }));
    this.pos = new Float32Array(N * 12); this.nrm = new Float32Array(N * 12); const uv = new Float32Array(N * 8), idx = new Uint32Array(N * 12);
    for (let i = 0; i < N; i++) {
      const c = i % 8, u0 = (c % 4) / 4, v0 = c < 4 ? .5 : 0; // canvas top row -> v in [.5, 1]
      uv.set([u0, v0, u0 + .25, v0, u0 + .25, v0 + .5, u0, v0 + .5], i * 8);
      const o = i * 4; idx.set([o, o + 1, o + 2, o, o + 2, o + 3, o, o + 2, o + 1, o, o + 3, o + 2], i * 12);
    }
    const mesh = new pc.Mesh(dev); mesh.setPositions(this.pos); mesh.setNormals(this.nrm); mesh.setUvs(0, uv); mesh.setIndices(idx); mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    this.mesh = mesh;
    const tex = A.toTexture(dev, A.leafSprites(), { repeat: false });
    const m = new pc.StandardMaterial(); m.diffuseMap = tex; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.alphaTest = .45; m.cull = pc.CULLFACE_NONE;
    m.emissiveMap = tex; m.emissive = new pc.Color(1, .8, .6); m.emissiveIntensity = .45; m.gloss = .3; m.update();
    const e = new pc.Entity('leaves'); const mi = new pc.MeshInstance(mesh, m); mi.cull = false;
    e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true }); app.root.addChild(e);
    this.wind = { x: .6, z: .3 }; this.next = 0;
    this.R = new pc.Mat3(); this.q = new pc.Quat();
  }
  spawnAmbient(p, cx, cz, fill) {
    p.x = cx + (Math.random() - .5) * 22; p.z = fill ? cz - Math.random() * 76 + 6 : cz - 40 - Math.random() * 40; p.y = Math.random() * 9;
    p.vx = 0; p.vy = -(.5 + Math.random() * .6); p.vz = 0; p.s = .09 + Math.random() * .07; p.burst = 0; p.life = 1e9;
    p.a = Math.random() * 6.28; p.b = Math.random() * 6.28; p.c = Math.random() * 6.28;
    p.wa = (Math.random() - .5) * 6; p.wb = (Math.random() - .5) * 5; p.wc = (Math.random() - .5) * 3; p.ph = Math.random() * 6.28;
  }
  burst(x, y, z, n = 12, { up = 3, spread = 2.5, fwd = 0, size = 1 } = {}) {
    for (let k = 0; k < n; k++) {
      const p = this.p[this.next]; this.next = (this.next + 1) % this.N;
      p.x = x + (Math.random() - .5) * .6; p.y = y + Math.random() * .3; p.z = z + (Math.random() - .5) * .6;
      p.vx = (Math.random() - .5) * spread; p.vy = up * (.4 + Math.random() * .8); p.vz = (Math.random() - .5) * spread + fwd;
      p.s = (.08 + Math.random() * .06) * size; p.burst = 1; p.life = 2.5 + Math.random();
      p.wa = (Math.random() - .5) * 14; p.wb = (Math.random() - .5) * 12; p.wc = (Math.random() - .5) * 6;
    }
  }
  update(dt, cam, focus, runnerSpeed = 0) {
    const cx = focus.x, cz = focus.z, P = this.pos, Nn = this.nrm, cp = cam.getPosition();
    for (let i = 0; i < this.N; i++) {
      const p = this.p[i];
      if (p.burst) {
        p.life -= dt; p.vy -= 5 * dt; p.vx *= 1 - dt * 1.4; p.vz *= 1 - dt * 1.4; if (p.vy < -1.2) p.vy = -1.2;
        if (p.life <= 0 || p.y < -.2) this.spawnAmbient(p, cx, cz, false);
      } else {
        // flutter: side-to-side sway as they fall, a slow wind drift
        p.ph += dt * 2.2; p.vx = this.wind.x + Math.sin(p.ph) * .9; p.vz = this.wind.z + Math.cos(p.ph * .7) * .5;
        // the runner's wake sucks nearby leaves along and up
        const dx = p.x - focus.x, dz = p.z - focus.z, dy = p.y - focus.y;
        if (dx * dx + dz * dz < 4 && dy < 2.2 && dy > -.2) { p.vy = 1.4; p.vz += -runnerSpeed * .35; p.wa *= 1.02; }
        const near = (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2 < 3; // a leaf on the lens is a blot, not a leaf
        if (near || p.y < -.1 || p.z > cz + 12 || Math.abs(p.x - cx) > 14 || p.z < cz - 80) this.spawnAmbient(p, cx, cz, false);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.a += p.wa * dt; p.b += p.wb * dt; p.c += p.wc * dt;
      // orientation from three tumble angles
      this.q.setFromEulerAngles(p.a * 57.3, p.b * 57.3, p.c * 57.3);
      const qx = this.q.x, qy = this.q.y, qz = this.q.z, qw = this.q.w;
      const rx = 1 - 2 * (qy * qy + qz * qz), ry = 2 * (qx * qy + qz * qw), rz = 2 * (qx * qz - qy * qw);
      const ux = 2 * (qx * qy - qz * qw), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz + qx * qw);
      const nx = 2 * (qx * qz + qy * qw), ny = 2 * (qy * qz - qx * qw), nz = 1 - 2 * (qx * qx + qy * qy);
      const s = p.s, o = i * 12;
      P[o] = p.x - (rx + ux) * s; P[o + 1] = p.y - (ry + uy) * s; P[o + 2] = p.z - (rz + uz) * s;
      P[o + 3] = p.x + (rx - ux) * s; P[o + 4] = p.y + (ry - uy) * s; P[o + 5] = p.z + (rz - uz) * s;
      P[o + 6] = p.x + (rx + ux) * s; P[o + 7] = p.y + (ry + uy) * s; P[o + 8] = p.z + (rz + uz) * s;
      P[o + 9] = p.x - (rx - ux) * s; P[o + 10] = p.y - (ry - uy) * s; P[o + 11] = p.z - (rz - uz) * s;
      for (let k = 0; k < 4; k++) { Nn[o + k * 3] = nx; Nn[o + k * 3 + 1] = Math.abs(ny) + .3; Nn[o + k * 3 + 2] = nz; }
    }
    this.mesh.setPositions(P); this.mesh.setNormals(Nn); this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }
  reset(focus) { for (const p of this.p) this.spawnAmbient(p, focus.x, focus.z, true); }
}
