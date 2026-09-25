import * as pc from 'playcanvas';

// Every surface is painted here on a canvas at boot. No downloaded art.

let seed = 1337;
export const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
export const reseed = s => { seed = Math.max(1, s | 0); };
export const rr = (a, b) => a + (b - a) * rand();
export const pick = a => a[Math.floor(rand() * a.length)];

function makeNoise(period, s) {
  reseed(s); const g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = rand();
  const at = (x, y) => g[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
export function fbm(n, x, y, oct = 5) { let s = 0, a = .5, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); t += a; a *= .5; f *= 2; } return s / t; }

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Flip the canvas ourselves (GL convention: v = 0 at the bottom row). The flipY upload option is not
// honoured for canvas sources on every backend, so don't rely on it.
export function toTexture(device, c, { repeat = true, srgb = true, mip = true } = {}) {
  const f = canvas(c.width, c.height), ctx = f.getContext('2d');
  ctx.translate(0, c.height); ctx.scale(1, -1); ctx.drawImage(c, 0, 0);
  const tex = new pc.Texture(device, { width: c.width, height: c.height, format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8, mipmaps: mip, anisotropy: 8, flipY: false });
  tex.setSource(f);
  tex.addressU = tex.addressV = repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE;
  return tex;
}
export function radial(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  const c = canvas(size, size), ctx = c.getContext('2d'), g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size); return c;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

// ------------------------------------------------------------------ maple leaf
// Palmate, five-lobed, toothed. Drawn around (0,0), tip up, radius ~1.
export function leafPath(ctx, r) {
  // walk around the outline: notch, tooth, tip, tooth, notch
  const pts = [];
  const pol = (deg, rad) => [Math.cos(deg * Math.PI / 180) * rad * r, Math.sin(deg * Math.PI / 180) * rad * r];
  const order = [[-90 - 108, .5], [-90 - 52, .86], [-90, 1], [-90 + 52, .86], [-90 + 108, .5]];
  pts.push(pol(90, .12)); // stem base
  for (let i = 0; i < order.length; i++) {
    const [a, L] = order[i];
    const next = i < order.length - 1 ? order[i + 1][0] : a + 60, n1 = (a + next) / 2;
    if (i === 0) pts.push(pol(a - 26, .32));
    pts.push(pol(a - 13, L * .55), pol(a - 17, L * .7), pol(a - 6, L * .72), pol(a - 9, L * .86));
    pts.push(pol(a, L));
    pts.push(pol(a + 9, L * .86), pol(a + 6, L * .72), pol(a + 17, L * .7), pol(a + 13, L * .55));
    if (i < order.length - 1) pts.push(pol(n1, i === 0 || i === 3 ? .3 : .36)); else pts.push(pol(a + 26, .32));
  }
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.closePath();
}
function drawLeaf(ctx, x, y, r, rot, fill, vein = 'rgba(60,10,0,.28)', stem = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  leafPath(ctx, r); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = vein; ctx.lineWidth = Math.max(.6, r * .045);
  ctx.beginPath(); for (const a of [-90, -38, -142, 18, -198]) { ctx.moveTo(0, r * .08); ctx.lineTo(Math.cos(a * Math.PI / 180) * r * .8, Math.sin(a * Math.PI / 180) * r * .8); } ctx.stroke();
  if (stem) { ctx.strokeStyle = vein; ctx.lineWidth = Math.max(.8, r * .06); ctx.beginPath(); ctx.moveTo(0, r * .1); ctx.lineTo(r * .05, r * .55); ctx.stroke(); }
  ctx.restore();
}

// Canopy leaf clumps, 2x2 atlas: crimson / scarlet-orange / gold / mixed (green turning).
export const PALETTES = [
  [[356, 82, 38], [350, 78, 30], [2, 86, 44], [8, 88, 48], [345, 70, 26]],
  [[12, 92, 50], [18, 95, 52], [6, 88, 44], [24, 96, 55], [0, 80, 40]],
  [[40, 96, 54], [34, 95, 50], [46, 92, 58], [28, 92, 48], [50, 85, 52]],
  [[80, 50, 40], [60, 70, 45], [30, 90, 48], [14, 90, 46], [95, 40, 34]],
];
export function leafClumps(size = 1024) {
  const c = canvas(size, size), ctx = c.getContext('2d'), cell = size / 2;
  for (let k = 0; k < 4; k++) {
    reseed(71 + k * 13);
    const ox = (k % 2) * cell, oy = Math.floor(k / 2) * cell, pal = PALETTES[k];
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, cell, cell); ctx.clip();
    for (let i = 0; i < 420; i++) {
      // blob-shaped density: more leaves toward the centre, ragged edge
      const a = rand() * 6.283, d = Math.sqrt(rand()) * .44 * (1 - .25 * Math.sin(a * 3 + k));
      const x = ox + cell / 2 + Math.cos(a) * d * cell, y = oy + cell / 2 + Math.sin(a) * d * cell * .9;
      const [h, s, l] = pick(pal), depth = i / 420; // later leaves sit on top and are brighter
      drawLeaf(ctx, x, y, cell * rr(.035, .06), rand() * 6.283, hsl(h + rr(-6, 6), s, l * (.72 + depth * .4) + rr(-4, 4)), 'rgba(50,8,0,.22)', rand() < .5);
    }
    ctx.restore();
  }
  return c;
}

// Single falling leaves, 4x2 atlas, for particles and pick-ups.
export function leafSprites(size = 512) {
  const c = canvas(size, size / 2), ctx = c.getContext('2d'), cell = size / 4;
  const cols = [[355, 80, 42], [10, 92, 50], [22, 95, 54], [40, 95, 55], [2, 70, 34], [30, 90, 50], [48, 90, 56], [14, 80, 44]];
  cols.forEach(([h, s, l], i) => {
    const x = (i % 4) * cell + cell / 2, y = Math.floor(i / 4) * cell + cell / 2;
    const g = ctx.createLinearGradient(x - cell * .4, y - cell * .4, x + cell * .4, y + cell * .4);
    g.addColorStop(0, hsl(h, s, l + 8)); g.addColorStop(1, hsl(h - 6, s, l - 8));
    drawLeaf(ctx, x, y, cell * .44, 0, g);
  });
  return c;
}

// The golden maple leaf you collect.
export function goldLeaf(size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d'), r = size * .44;
  ctx.translate(size / 2, size / 2);
  ctx.save(); leafPath(ctx, r * 1.02); ctx.lineWidth = size * .05; ctx.strokeStyle = '#7a3a06'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
  const g = ctx.createLinearGradient(-r, -r, r, r); g.addColorStop(0, '#fff3b0'); g.addColorStop(.35, '#ffc83a'); g.addColorStop(.7, '#f08a12'); g.addColorStop(1, '#c4520a');
  leafPath(ctx, r); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(255,250,210,.8)'; ctx.lineWidth = size * .018; ctx.beginPath();
  for (const a of [-90, -38, -142, 18, -198]) { ctx.moveTo(0, r * .1); ctx.lineTo(Math.cos(a * Math.PI / 180) * r * .75, Math.sin(a * Math.PI / 180) * r * .75); } ctx.stroke();
  return c;
}

// ------------------------------------------------------------------ ground
// Autumn grass littered with fallen maple leaves.
export function leafLitter(size = 1024, { base = [74, 28, 30], density = 1, s = 5 } = {}) {
  const c = canvas(size, size), ctx = c.getContext('2d'), n = makeNoise(32, s), img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const f = fbm(n, x / size * 16, y / size * 16, 5), g = Math.random();
    const i = (y * size + x) * 4;
    const [h, sat, l] = base; const L = l * (.7 + f * .6) + g * 6;
    // olive grass through brown dead grass
    const mixk = Math.max(0, Math.min(1, (f - .42) * 3));
    const col = hslToRgb(h - mixk * 38, sat + mixk * 12, L);
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  reseed(s * 7);
  const cols = [[356, 78, 38], [8, 88, 44], [18, 92, 48], [30, 92, 50], [42, 90, 52], [2, 60, 28], [24, 60, 34]];
  const N = Math.floor(2600 * density);
  for (let i = 0; i < N; i++) {
    const [h, sat, l] = pick(cols), x = rand() * size, y = rand() * size, r = rr(7, 15);
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
      drawLeaf(ctx, x + dx, y + dy, r, rand() * 6.283, hsl(h, sat, l + rr(-8, 6)), 'rgba(40,8,0,.3)');
    }
  }
  return c;
}

// Ballast: grey-brown stones with a scatter of leaves caught between them.
export function ballast(size = 1024) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#5a534c'; ctx.fillRect(0, 0, size, size);
  reseed(9);
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size, y = rand() * size, r = rr(4, 10), l = rr(28, 62), h = rr(20, 40);
    ctx.fillStyle = hsl(h, rr(4, 12), l); ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + rand() * .5, rad = r * rr(.7, 1.1); ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,240,.12)'; ctx.beginPath(); ctx.arc(x - r * .25, y - r * .3, r * .35, 0, 6.283); ctx.fill();
  }
  const cols = [[356, 78, 38], [10, 88, 44], [24, 92, 48], [40, 90, 52]];
  for (let i = 0; i < 260; i++) { const [h, s, l] = pick(cols); drawLeaf(ctx, rand() * size, rand() * size, rr(8, 14), rand() * 6.283, hsl(h, s, l)); }
  return c;
}

export function wood(size = 512, { h = 25, s = 30, l = 28, s0 = 3 } = {}) {
  const c = canvas(size, size), ctx = c.getContext('2d'), n = makeNoise(16, s0), img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const f = fbm(n, x / size * 2, y / size * 22, 4), grain = Math.sin((y / size * 60 + f * 8) * 3.1) * .5 + .5;
    const col = hslToRgb(h, s, l * (.75 + grain * .25 + f * .3)); const i = (y * size + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}

// ------------------------------------------------------------------ sky + hills
export function skyTexture(w = 2048, h = 1024) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2f5d9a'); g.addColorStop(.25, '#4f82bd'); g.addColorStop(.4, '#8fb2d4'); g.addColorStop(.46, '#d8d2c0');
  g.addColorStop(.49, '#f6d9a4'); g.addColorStop(.5, '#ffe2ae'); g.addColorStop(.53, '#c8a282'); g.addColorStop(1, '#6f5a4a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const n = makeNoise(128, 51), img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h * .5; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const band = Math.exp(-(((v - .36) / .08) ** 2)) + .5 * Math.exp(-(((v - .2) / .06) ** 2));
    let a = Math.max(0, (fbm(n, u * 14, v * 40, 5) - .52) * 3.4) * band; a = Math.min(1, a); if (a <= 0) continue;
    const du = Math.min(Math.abs(u - .5), 1 - Math.abs(u - .5)), near = Math.exp(-((du / .14) ** 2));
    const i = (y * w + x) * 4, cr = 255, cg = 238 - near * 30, cb = 222 - near * 70;
    d[i] = d[i] + (cr - d[i]) * a * .9; d[i + 1] = d[i + 1] + (cg - d[i + 1]) * a * .9; d[i + 2] = d[i + 2] + (cb - d[i + 2]) * a * .9;
  }
  ctx.putImageData(img, 0, 0);
  const glow = ctx.createRadialGradient(w * .5, h * .47, 0, w * .5, h * .47, h * .5);
  glow.addColorStop(0, 'rgba(255,240,200,.9)'); glow.addColorStop(.1, 'rgba(255,214,150,.45)'); glow.addColorStop(.4, 'rgba(255,190,120,.12)'); glow.addColorStop(1, 'rgba(255,170,100,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  return c;
}

// A hill ridge whose face is mottled with autumn forest colours; farther layers get hazed.
export function hills({ w = 2048, h = 512, s = 1, haze = 0, height = .55, rough = .6, palette = 'autumn' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d'), n = makeNoise(64, s * 3 + 1), n2 = makeNoise(64, s * 5 + 2);
  const top = new Float32Array(w);
  for (let x = 0; x < w; x++) { const u = x / w; top[x] = (1 - height) + (fbm(n, u * 8, 0, 5) - .5) * rough * .9 + Math.sin(u * 6.283 * 3 + s) * .06; }
  const img = ctx.createImageData(w, h), d = img.data;
  const hazeCol = [214, 196, 178];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / h; if (v < top[x]) continue;
    const u = x / w, f = fbm(n2, u * 60, v * 14, 4), g = fbm(n2, u * 12 + 9, v * 3, 3);
    // patches of crimson, orange, gold and evergreen
    let col;
    if (palette === 'autumn') {
      const k = g * 1.4 + f * .5;
      col = k < .55 ? [46, 70, 44] : k < .72 ? [168, 42, 30] : k < .86 ? [214, 96, 34] : [226, 160, 52];
      const shade = .6 + f * .7 - (v - top[x]) * .5; col = col.map(q => q * shade);
    } else col = [120, 110, 100];
    const k2 = Math.min(1, haze + (v - top[x]) * haze * .6);
    const i = (y * w + x) * 4; d[i] = col[0] + (hazeCol[0] - col[0]) * k2; d[i + 1] = col[1] + (hazeCol[1] - col[1]) * k2; d[i + 2] = col[2] + (hazeCol[2] - col[2]) * k2;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}

// ------------------------------------------------------------------ trains
// Two-tone retro local train: cream over maroon, window band, doors. One texture per side (u = 0..1 along 16 m).
export function trainSide({ w = 2048, h = 512, upper = '#efe4c8', lower = '#8c1f22', stripe = '#d9a441', lamp = false } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = upper; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = lower; ctx.fillRect(0, h * .56, w, h * .44);
  ctx.fillStyle = stripe; ctx.fillRect(0, h * .54, w, h * .03);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, h * .02, w, h * .02);
  // windows
  const win = (x, y, ww, hh) => {
    const g = ctx.createLinearGradient(x, y, x + ww * .6, y + hh); g.addColorStop(0, lamp ? '#ffe6a8' : '#8fa6b3'); g.addColorStop(.45, lamp ? '#f2c77a' : '#3a4a55'); g.addColorStop(1, lamp ? '#b98a4a' : '#1c262e');
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x - 5, y - 5, ww + 10, hh + 10);
    ctx.fillStyle = g; ctx.fillRect(x, y, ww, hh);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.moveTo(x + ww * .15, y); ctx.lineTo(x + ww * .35, y); ctx.lineTo(x + ww * .1, y + hh); ctx.lineTo(x - 0, y + hh); ctx.closePath(); ctx.fill();
  };
  const doors = [.14, .5, .86];
  for (let i = 0; i < 11; i++) {
    const u = .04 + i * .088; if (doors.some(d => Math.abs(u + .03 - d) < .06)) continue;
    win(u * w, h * .16, w * .06, h * .3);
  }
  for (const d of doors) {
    const x = d * w - w * .03; ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x - 3, h * .1, w * .06 + 6, h * .86);
    ctx.fillStyle = '#d8ccb0'; ctx.fillRect(x, h * .1 + 3, w * .06, h * .86 - 3);
    ctx.fillStyle = '#7d1c1f'; ctx.fillRect(x, h * .56, w * .06, h * .4);
    win(x + w * .008, h * .17, w * .018, h * .26); win(x + w * .034, h * .17, w * .018, h * .26);
  }
  // grime at the skirt
  const gr = ctx.createLinearGradient(0, h * .8, 0, h); gr.addColorStop(0, 'rgba(30,20,10,0)'); gr.addColorStop(1, 'rgba(30,20,10,.55)'); ctx.fillStyle = gr; ctx.fillRect(0, h * .8, w, h * .2);
  ctx.font = `bold ${h * .07}px "Noto Sans JP", sans-serif`; ctx.fillStyle = '#f3e3b6'; ctx.fillText('MOMIJI LINE', w * .23, h * .78); ctx.fillText('MOMIJI LINE', w * .63, h * .78);
  return c;
}
export function trainFront({ w = 512, h = 512, lamp = true, dest = 'MOMIJIDANI' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#efe4c8'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8c1f22'; ctx.fillRect(0, h * .56, w, h * .44);
  ctx.fillStyle = '#d9a441'; ctx.fillRect(0, h * .54, w, h * .03);
  // two big windscreens and a destination blind
  for (const x of [.08, .54]) {
    const g = ctx.createLinearGradient(0, h * .14, 0, h * .48); g.addColorStop(0, '#9fb6c2'); g.addColorStop(1, '#1d2a33');
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(w * x - 6, h * .14 - 6, w * .38 + 12, h * .34 + 12); ctx.fillStyle = g; ctx.fillRect(w * x, h * .14, w * .38, h * .34);
  }
  ctx.fillStyle = '#111'; ctx.fillRect(w * .3, h * .03, w * .4, h * .08);
  ctx.fillStyle = '#ffffff'; ctx.font = `bold ${h * .06}px "Noto Sans JP", sans-serif`; ctx.textAlign = 'center'; ctx.fillText(dest, w * .5, h * .095);
  // headlights
  for (const x of [.2, .8]) {
    const g = ctx.createRadialGradient(w * x, h * .7, 0, w * x, h * .7, w * .08);
    g.addColorStop(0, lamp ? '#ffffff' : '#ddd'); g.addColorStop(.5, lamp ? '#fff1b8' : '#bbb'); g.addColorStop(1, '#444');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w * x, h * .7, w * .07, 0, 6.283); ctx.fill();
  }
  ctx.fillStyle = '#222'; ctx.fillRect(w * .3, h * .86, w * .4, h * .1);
  ctx.fillStyle = '#d9a441'; ctx.fillRect(w * .44, h * .62, w * .12, h * .12);
  ctx.fillStyle = '#8c1f22'; ctx.save(); ctx.translate(w * .5, h * .68); leafPath(ctx, h * .045); ctx.fill(); ctx.restore();
  return c;
}

// Diagonal hazard stripes (railway crossing yellow / black).
export function stripes(w = 512, h = 64, a = '#f2c418', b = '#1a1a1a') {
  const c = canvas(w, h), ctx = c.getContext('2d'); ctx.fillStyle = a; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = b; for (let x = -h; x < w + h; x += h) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h / 2, h); ctx.lineTo(x + h, 0); ctx.lineTo(x + h / 2, 0); ctx.closePath(); ctx.fill(); }
  return c;
}
export function redWhite(w = 512, h = 64) { return stripes(w, h, '#f4efe6', '#c8261f'); }

export function signBoard(lines, { w = 1024, h = 256, bg = '#f6f1e4', fg = '#1f2a44', border = '#1f2a44', sub = '' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.lineWidth = h * .05; ctx.strokeStyle = border; ctx.strokeRect(h * .05, h * .05, w - h * .1, h - h * .1);
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * .42}px "Noto Serif JP", serif`; ctx.fillText(lines[0], w / 2, h * (sub ? .42 : .5));
  if (sub) { ctx.font = `600 ${h * .15}px "Noto Sans JP", sans-serif`; ctx.fillText(sub, w / 2, h * .78); }
  return c;
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l = Math.max(0, Math.min(100, l)) / 100;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// ------------------------------------------------------------------ environment (reflections)
// Equirect: warm sky and sun on top, a ring of maple colour through the horizon, ballast and litter below.
// Used as the reflection/ambient source for glossy props (train paint, glass, chrome) only.
export function envTexture(w = 1024, h = 512, sunU = .5) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5f8fc4'); g.addColorStop(.3, '#a9c2d6'); g.addColorStop(.46, '#f2d9ae'); g.addColorStop(.5, '#caa074');
  g.addColorStop(.56, '#6d5646'); g.addColorStop(1, '#3a3029');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  reseed(404);
  // foliage: blotches of crimson, orange and gold from the horizon up to ~45 degrees
  const cols = ['#b3261c', '#d2461e', '#e0782a', '#e8a93a', '#8e1d18', '#c9551f'];
  for (let i = 0; i < 900; i++) {
    const x = rand() * w, y = h * (.2 + Math.pow(rand(), .7) * .31), r = rr(6, 26);
    ctx.fillStyle = pick(cols); ctx.globalAlpha = rr(.35, .8); ctx.beginPath(); ctx.ellipse(x, y, r * 1.3, r, 0, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // trunks
  ctx.fillStyle = 'rgba(50,34,28,.6)';
  for (let i = 0; i < 70; i++) { const x = rand() * w; ctx.fillRect(x, h * .38, rr(2, 5), h * .14); }
  // sun hot spot for crisp glints
  const sx = w * sunU, sy = h * .4, sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * .18);
  sg.addColorStop(0, 'rgba(255,250,235,1)'); sg.addColorStop(.12, 'rgba(255,236,190,.9)'); sg.addColorStop(1, 'rgba(255,210,150,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
  return c;
}

// Destination blind: amber LED on black.
export function destBoard(main = 'MOMIJIDANI', sub = 'LOCAL', w = 512, h = 96) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffae2e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${h * .5}px "Noto Sans JP", sans-serif`; ctx.fillText(main, w / 2, h * .38);
  ctx.font = `700 ${h * .2}px "Noto Sans JP", sans-serif`; ctx.fillText(sub, w / 2, h * .82);
  // LED dot mask
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x % 3 === 2 || y % 3 === 2) { const i = (y * w + x) * 4; d[i] *= .35; d[i + 1] *= .35; d[i + 2] *= .35; }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Line logo for the car side: gold lettering on transparent.
export function lineLogo(w = 1024, h = 136) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8c16a'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(h * .5, h * .5); leafPath(ctx, h * .38); ctx.fill(); ctx.restore();
  ctx.font = `700 ${h * .5}px "Dela Gothic One", sans-serif`; ctx.fillText('MOMIJI LINE', h * 1.1, h * .54);
  return c;
}

// Grime for the car body, mapped over one side (u along 15 m, v = height 0..3.4 m, bottom row = rail).
// White = clean; multiplied into the paint. Heavier at the skirt, drips under the windows, a soft roof line.
export function trainGrime(w = 1024, h = 256) {
  const c = canvas(w, h), ctx = c.getContext('2d'), n = makeNoise(64, 77), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = (1 - y / h) * 3.4, u = x / w;
    let k = 1 - .05 * fbm(n, u * 40, y / h * 6, 4);
    k -= Math.max(0, 1.45 - z) * .28 * (.7 + .6 * fbm(n, u * 90, y / h * 20, 3));             // road dust at the skirt
    const col = (u * 15 + 100) % 1.5, drip = Math.exp(-(((col - .75) / .05) ** 2)) * (z < 1.95 && z > 1.3 ? (1.95 - z) / .65 : 0);
    k -= drip * .12 * fbm(n, u * 200, 3, 2);                                                  // streaks under the windows
    k -= Math.max(0, z - 2.95) * .35;                                                         // soot on the roof edge
    const i = (y * w + x) * 4, v = Math.max(.55, Math.min(1, k)) * 255;
    d[i] = v; d[i + 1] = v * .985; d[i + 2] = v * .96; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}

// ------------------------------------------------------------------ power-up icons (transparent, centred)
export const POWER_COLORS = { magnet: '#e8392c', jetpack: '#ff8a1c', sneakers: '#3fd16f', double: '#ffc23d' };
export function powerIcon(type, s = 256) {
  const c = canvas(s, s), x = c.getContext('2d'), k = s / 256;
  x.lineJoin = 'round'; x.lineCap = 'round';
  const outline = (w = 14) => { x.lineWidth = w * k; x.strokeStyle = '#2a0d05'; x.stroke(); };
  if (type === 'magnet') {
    x.beginPath(); x.arc(128 * k, 118 * k, 62 * k, Math.PI, 0); x.lineTo(190 * k, 200 * k); x.lineTo(150 * k, 200 * k); x.lineTo(150 * k, 118 * k);
    x.arc(128 * k, 118 * k, 22 * k, 0, Math.PI, true); x.lineTo(106 * k, 200 * k); x.lineTo(66 * k, 200 * k); x.closePath();
    outline(); x.fillStyle = '#e8392c'; x.fill();
    x.fillStyle = '#e9edf2'; x.fillRect(66 * k, 170 * k, 40 * k, 30 * k); x.fillRect(150 * k, 170 * k, 40 * k, 30 * k);
    x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(128 * k, 118 * k, 52 * k, Math.PI * 1.1, Math.PI * 1.45); x.lineWidth = 8 * k; x.strokeStyle = 'rgba(255,255,255,.45)'; x.stroke();
  } else if (type === 'jetpack') {
    for (const cx of [96, 160]) {
      x.beginPath(); x.roundRect((cx - 26) * k, 50 * k, 52 * k, 118 * k, 24 * k); outline(); x.fillStyle = '#ff8a1c'; x.fill();
      x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect((cx - 16) * k, 62 * k, 9 * k, 90 * k);
      const g = x.createLinearGradient(0, 168 * k, 0, 236 * k); g.addColorStop(0, '#fff6b0'); g.addColorStop(.5, '#ffb030'); g.addColorStop(1, 'rgba(255,80,20,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo((cx - 18) * k, 168 * k); x.quadraticCurveTo(cx * k, 250 * k, (cx + 18) * k, 168 * k); x.fill();
    }
    x.fillStyle = '#6b6f78'; x.fillRect(118 * k, 80 * k, 20 * k, 60 * k);
  } else if (type === 'sneakers') {
    x.beginPath(); x.moveTo(40 * k, 170 * k); x.lineTo(60 * k, 96 * k); x.lineTo(110 * k, 100 * k); x.quadraticCurveTo(130 * k, 140 * k, 190 * k, 146 * k);
    x.quadraticCurveTo(222 * k, 152 * k, 220 * k, 184 * k); x.lineTo(40 * k, 190 * k); x.closePath(); outline(); x.fillStyle = '#3fd16f'; x.fill();
    x.fillStyle = '#f4f7f2'; x.fillRect(40 * k, 176 * k, 180 * k, 16 * k);
    x.strokeStyle = '#1d6b37'; x.lineWidth = 6 * k; for (const t of [0, 1, 2]) { x.beginPath(); x.moveTo((92 + t * 16) * k, (112 + t * 8) * k); x.lineTo((108 + t * 16) * k, (104 + t * 8) * k); x.stroke(); }
    // wing
    x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(62 * k, 120 * k); x.quadraticCurveTo(20 * k, 60 * k, 40 * k, 40 * k); x.quadraticCurveTo(60 * k, 80 * k, 90 * k, 96 * k); x.closePath();
    x.lineWidth = 8 * k; x.strokeStyle = '#2a0d05'; x.stroke(); x.fill();
  } else {
    x.font = `400 ${150 * k}px "Dela Gothic One", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 16 * k; x.strokeStyle = '#2a0d05'; x.strokeText('2x', 128 * k, 136 * k);
    const g = x.createLinearGradient(0, 70 * k, 0, 200 * k); g.addColorStop(0, '#fff3b0'); g.addColorStop(.5, '#ffc23d'); g.addColorStop(1, '#e07a12');
    x.fillStyle = g; x.fillText('2x', 128 * k, 136 * k);
  }
  return c;
}
