import * as pc from 'playcanvas';

// Mesh helpers. UVs are in world metres divided by `tile`, so one material tiles correctly on any size of box.
const cache = new Map();

export function boxMesh(device, w, h, d, tile = 1) {
  const key = `b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${tile}`;
  if (cache.has(key)) return cache.get(key);
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const P = [], N = [], U = [], I = [];
  const face = (o, a, b, n, lu, lv) => {
    // o = corner, a/b = edge vectors, lu/lv = edge lengths (m)
    const base = P.length / 3;
    const pts = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [s, t] of pts) {
      P.push(o[0] + a[0] * s + b[0] * t, o[1] + a[1] * s + b[1] * t, o[2] + a[2] * s + b[2] * t);
      N.push(...n); U.push(s * lu / tile, t * lv / tile);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face([-hw, -hh, hd], [w, 0, 0], [0, h, 0], [0, 0, 1], w, h);        // +Z
  face([hw, -hh, -hd], [-w, 0, 0], [0, h, 0], [0, 0, -1], w, h);      // -Z
  face([hw, -hh, hd], [0, 0, -d], [0, h, 0], [1, 0, 0], d, h);        // +X
  face([-hw, -hh, -hd], [0, 0, d], [0, h, 0], [-1, 0, 0], d, h);      // -X
  face([-hw, hh, hd], [w, 0, 0], [0, 0, -d], [0, 1, 0], w, d);        // +Y
  face([-hw, -hh, -hd], [w, 0, 0], [0, 0, d], [0, -1, 0], w, d);      // -Y
  const mesh = new pc.Mesh(device);
  mesh.setPositions(P); mesh.setNormals(N); mesh.setUvs(0, U); mesh.setIndices(I); mesh.update();
  cache.set(key, mesh); return mesh;
}

export function quadMesh(device, w, h, uvw = 1, uvh = 1) {
  const key = `q${w}|${h}|${uvw}|${uvh}`;
  if (cache.has(key)) return cache.get(key);
  const mesh = new pc.Mesh(device);
  mesh.setPositions([-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0]);
  mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  mesh.setUvs(0, [0, 0, uvw, 0, uvw, uvh, 0, uvh]);
  mesh.setIndices([0, 1, 2, 0, 2, 3]); mesh.update();
  cache.set(key, mesh); return mesh;
}

export function cylMesh(device, r, h, seg = 12, tile = 1, rTop = r) {
  const key = `c${r}|${h}|${seg}|${tile}|${rTop}`;
  if (cache.has(key)) return cache.get(key);
  const P = [], N = [], U = [], I = [];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    P.push(c * r, 0, s * r, c * rTop, h, s * rTop); N.push(c, 0, s, c, 0, s);
    const u = i / seg * Math.PI * 2 * r / tile; U.push(u, 0, u, h / tile);
    if (i < seg) { const b = i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  // caps
  for (const [y, rr, ny] of [[0, r, -1], [h, rTop, 1]]) {
    const c0 = P.length / 3; P.push(0, y, 0); N.push(0, ny, 0); U.push(.5, .5);
    for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; P.push(Math.cos(a) * rr, y, Math.sin(a) * rr); N.push(0, ny, 0); U.push(.5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5); }
    for (let i = 0; i < seg; i++) ny > 0 ? I.push(c0, c0 + i + 2, c0 + i + 1) : I.push(c0, c0 + i + 1, c0 + i + 2);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(P); mesh.setNormals(N); mesh.setUvs(0, U); mesh.setIndices(I); mesh.update();
  cache.set(key, mesh); return mesh;
}

// An open cylinder band seen from inside, for horizon layers (ridge cards).
export function bandMesh(device, radius, height, seg = 96, arc = Math.PI * 2, start = 0, uRepeat = 1) {
  const P = [], N = [], U = [], I = [];
  for (let i = 0; i <= seg; i++) {
    const a = start + i / seg * arc, c = Math.cos(a), s = Math.sin(a);
    P.push(c * radius, 0, s * radius, c * radius, height, s * radius); N.push(-c, 0, -s, -c, 0, -s);
    const u = i / seg * uRepeat; U.push(u, 0, u, 1);
    if (i < seg) { const b = i * 2; I.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(P); mesh.setNormals(N); mesh.setUvs(0, U); mesh.setIndices(I); mesh.update();
  return mesh;
}

export function addMesh(parent, mesh, material, { pos = [0, 0, 0], rot = [0, 0, 0], scale, cast = true, receive = true, name = 'mesh' } = {}) {
  const e = new pc.Entity(name);
  const mi = new pc.MeshInstance(mesh, material);
  e.addComponent('render', { meshInstances: [mi], castShadows: cast, receiveShadows: receive });
  e.setLocalPosition(...pos); e.setLocalEulerAngles(...rot); if (scale) e.setLocalScale(...scale);
  parent.addChild(e); return e;
}

// Inward-facing lat/long dome. v = 1 at the zenith, .5 at the horizon; u = .5 faces azimuth `u0Deg` (0 = +Z, 90 = +X).
export function domeMesh(device, r, u0Deg = 0, seg = 64, rings = 32) {
  const P = [], U = [], I = [], a0 = u0Deg * Math.PI / 180;
  for (let j = 0; j <= rings; j++) {
    const el = -Math.PI / 2 + j / rings * Math.PI, ce = Math.cos(el), se = Math.sin(el);
    for (let i = 0; i <= seg; i++) {
      const az = a0 - Math.PI + i / seg * Math.PI * 2;
      P.push(Math.sin(az) * ce * r, se * r, Math.cos(az) * ce * r); U.push(i / seg, .5 + el / Math.PI);
      if (i < seg && j < rings) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; I.push(a, b, c, b, d, c); }
    }
  }
  const mesh = new pc.Mesh(device); mesh.setPositions(P); mesh.setUvs(0, U); mesh.setIndices(I); mesh.update(); return mesh;
}
