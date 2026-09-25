import * as pc from 'playcanvas';

// Static batching: primitives are appended in world (chunk) space with a per-vertex colour,
// then flushed into a single mesh per material. A whole chunk of scenery is a handful of draw calls.
const V = new pc.Vec3(), N = new pc.Vec3();

export class Builder {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.I = []; }
  get count() { return this.P.length / 3; }
  // append raw triangles; m = pc.Mat4 transform; col = [r,g,b] 0..1 (or per-vertex fn)
  push(pos, nrm, uv, idx, m, col = [1, 1, 1], nrmOverride) {
    const base = this.count;
    for (let i = 0; i < pos.length / 3; i++) {
      V.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); m.transformPoint(V, V);
      this.P.push(V.x, V.y, V.z);
      if (nrmOverride) { const n = nrmOverride(V, i); this.N.push(n.x, n.y, n.z); }
      else { N.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]); m.transformVector(N, N).normalize(); this.N.push(N.x, N.y, N.z); }
      this.U.push(uv[i * 2], uv[i * 2 + 1]);
      const c = typeof col === 'function' ? col(V, i) : col;
      this.C.push(c[0] * 255, c[1] * 255, c[2] * 255, 255);
    }
    for (const k of idx) this.I.push(base + k);
  }
  box(w, h, d, m, col, tile = 1) {
    const hw = w / 2, hd = d / 2, P = [], Nn = [], U = [], I = [];
    const face = (o, a, b, n, lu, lv) => {
      const s0 = P.length / 3;
      for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { P.push(o[0] + a[0] * s + b[0] * t, o[1] + a[1] * s + b[1] * t, o[2] + a[2] * s + b[2] * t); Nn.push(...n); U.push(s * lu / tile, t * lv / tile); }
      I.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);
    };
    // origin at bottom centre
    face([-hw, 0, hd], [w, 0, 0], [0, h, 0], [0, 0, 1], w, h);
    face([hw, 0, -hd], [-w, 0, 0], [0, h, 0], [0, 0, -1], w, h);
    face([hw, 0, hd], [0, 0, -d], [0, h, 0], [1, 0, 0], d, h);
    face([-hw, 0, -hd], [0, 0, d], [0, h, 0], [-1, 0, 0], d, h);
    face([-hw, h, hd], [w, 0, 0], [0, 0, -d], [0, 1, 0], w, d);
    face([-hw, 0, -hd], [w, 0, 0], [0, 0, d], [0, -1, 0], w, d);
    this.push(P, Nn, U, I, m, col);
  }
  // tapered cylinder along +Y, origin at the base
  cyl(r0, r1, h, seg, m, col, tile = 1) {
    const P = [], Nn = [], U = [], I = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      P.push(c * r0, 0, s * r0, c * r1, h, s * r1); Nn.push(c, (r0 - r1) / h, s, c, (r0 - r1) / h, s);
      U.push(i / seg * 2, 0, i / seg * 2, h / tile);
      if (i < seg) { const b = i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    this.push(P, Nn, U, I, m, col);
  }
  // quad in the local XY plane, origin at bottom centre, facing +Z; uv rect [u0,v0,u1,v1]
  quad(w, h, m, col, uv = [0, 0, 1, 1], nrmOverride, twoSided = false) {
    const P = [-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0];
    const U = [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]];
    this.push(P, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], U, twoSided ? [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3], m, col, nrmOverride);
  }
  // flat ground quad in XZ, tiled in world metres
  ground(x0, z0, x1, z1, y, m, col, tile = 4, seg = 1, heightFn) {
    const P = [], Nn = [], U = [], I = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const x = x0 + (x1 - x0) * i / seg, z = z0 + (z1 - z0) * j / seg;
      P.push(x, heightFn ? heightFn(x, z) : y, z); Nn.push(0, 1, 0); U.push(x / tile, -z / tile);
      if (i < seg && j < seg) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; I.push(a, b, c, b, d, c); }
    }
    this.push(P, Nn, U, I, m, col);
  }
  build(device) {
    if (!this.count) return null;
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.P); mesh.setNormals(this.N); mesh.setUvs(0, this.U); mesh.setColors32(this.C);
    mesh.setIndices(this.count > 65535 ? new Uint32Array(this.I) : this.I); mesh.update();
    return mesh;
  }
}

export const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new pc.Mat4().setTRS(new pc.Vec3(x, y, z), new pc.Quat().setFromEulerAngles(rx, ry, rz), new pc.Vec3(sx, sy, sz));

export function addMesh(parent, mesh, material, { cast = true, receive = true, name = 'mesh', layers } = {}) {
  if (!mesh) return null;
  const e = new pc.Entity(name);
  const mi = new pc.MeshInstance(mesh, material);
  const opts = { meshInstances: [mi], castShadows: cast, receiveShadows: receive };
  if (layers) opts.layers = layers;
  e.addComponent('render', opts);
  parent.addChild(e); return e;
}
