// Records a ~40 s "player" run as a frame-perfect 60 fps video with synced sound.
//   node tools/record.mjs <out.mp4> [--url http://localhost:5181] [--fps 60]
// The page runs on a virtual clock (performance.now / rAF / timers are stepped by this script), so every frame is
// exactly 1/fps apart however slow capture is. Sounds are logged with their virtual time and re-rendered afterwards
// through the game's own synth in an OfflineAudioContext, then muxed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PW = process.env.PLAYWRIGHT || 'playwright'; // npm i -D playwright, or point PLAYWRIGHT at an install
const { chromium } = await import(PW);
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const OUT = path.resolve(process.argv[2] || 'maple-run.mp4');
const URL = arg('--url', 'http://localhost:5181') + '/?auto&debug';
const FPS = +arg('--fps', 60), DT = 1000 / FPS, W = 1920, H = 1080;
const TMP = fs.mkdtempSync(path.join(path.dirname(OUT), 'rec-'));

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.warn('PAGEERR', e.message));

// Virtual clock, dormant until __vt.start(): real time while the game loads, stepped time while recording.
await page.addInitScript(() => {
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window), realST = window.setTimeout.bind(window), realDate = Date.now;
  const vt = { on: false, now: 0, raf: [], timers: [], id: 1e6 };
  performance.now = () => vt.on ? vt.now : realNow();
  Date.now = () => vt.on ? vt.dateBase + (vt.now - vt.start0) : realDate();
  window.requestAnimationFrame = cb => { if (!vt.on) return realRaf(cb); vt.raf.push(cb); return ++vt.id; };
  window.setTimeout = (cb, ms = 0, ...a) => { if (!vt.on) return realST(cb, ms, ...a); vt.timers.push({ at: vt.now + ms, cb, a, id: ++vt.id }); return vt.id; };
  const realCT = window.clearTimeout.bind(window);
  window.clearTimeout = id => { vt.timers = vt.timers.filter(t => t.id !== id); realCT(id); };
  vt.start = () => { vt.start0 = vt.now = realNow(); vt.dateBase = realDate(); vt.on = true; };
  vt.step = ms => {
    vt.now += ms;
    const due = vt.timers.filter(t => t.at <= vt.now); vt.timers = vt.timers.filter(t => t.at > vt.now);
    for (const t of due.sort((a, b) => a.at - b.at)) t.cb(...t.a);
    const q = vt.raf; vt.raf = []; for (const cb of q) cb(vt.now);
  };
  window.__vt = vt;
});

await page.goto(URL);
await page.waitForFunction(() => window.__g && __g.phase === 'title', null, { timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));

// Sound log: wrap the synth's top-level calls (nested calls are replayed by their caller).
await page.evaluate(() => {
  const a = __g.audio; a.init(); a.master.gain.value = 0; // live output muted; we only need the log
  const log = window.__alog = []; let depth = 0;
  for (const m of ['step', 'jump', 'roll', 'land', 'swish', 'coin', 'bump', 'crash', 'whistle', 'horn', 'powerup', 'powerEnding', 'jet', 'rumble', 'setSpeed', 'startMusic', 'stopMusic']) {
    const f = a[m].bind(a);
    a[m] = (...args) => { if (!depth && __vt.on) log.push({ t: __vt.now, m, args }); depth++; try { return f(...args); } finally { depth--; } };
  }
});

await page.evaluate(() => __vt.start());
const t0 = await page.evaluate(() => __vt.now);
const at = s => Math.round(s * FPS);
const drop = type => page.evaluate(type => {
  const r = __g.runner, z = r.z - 32, clear = l => !__g.obs.list.some(o => o.lane === l && o.z0 < z + 10 && o.z1 > z - 10);
  const lanes = [r.lane, (r.lane + 1) % 3, (r.lane + 2) % 3].filter(clear);
  __g.powerups.spawn(type, lanes[0] ?? r.lane, z);
}, type);
// ---- script, by frame
const cues = new Map([
  [at(1.6), () => page.$eval('#roster .card:nth-child(2)', el => el.click())],   // BEAT
  [at(2.8), () => page.$eval('#roster .card:nth-child(3)', el => el.click())],   // WUKONG
  [at(4.0), () => page.$eval('#roster .card:nth-child(4)', el => el.click())],   // MUSE, the one we run as
  [at(5.3), () => page.$eval('#run', el => el.click())],
  [at(10), () => drop('magnet')],
  [at(17), () => drop('jetpack')],
  [at(28.5), () => drop('sneakers')],
  [at(35.5), () => page.evaluate(() => { window.__noauto = true; const r = __g.runner; __g.obs.add('train', r.lane, r.z - 34); })],
]);
let frame = 0, overAt = null;
const MAX = at(50);
while (frame < MAX) {
  if (cues.has(frame)) await cues.get(frame)();
  await page.evaluate(ms => __vt.step(ms), DT);
  await page.screenshot({ path: path.join(TMP, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  if (overAt == null && await page.evaluate(() => __g.phase === 'over')) overAt = frame;
  if (overAt != null && frame - overAt > at(3)) break;
  if (frame % 300 === 0) console.log('frame', frame);
  frame++;
}
const dur = frame / FPS;

// ---- sound: replay the log through the same synth into an OfflineAudioContext, return WAV
const wavB64 = await page.evaluate(async ({ t0, dur }) => {
  const log = window.__alog, SR = 48000, off = new OfflineAudioContext(2, Math.ceil(SR * (dur + .5)), SR);
  const A = new __g.audio.constructor(); A.init(off);
  const realST = window.setTimeout; window.setTimeout = () => 0; // crash() schedules its own whistle; the log has it already
  // the music loop schedules itself from tick(); walk it forward between events so it stops exactly where the game stopped it
  let mt = null; const advance = to => { if (mt == null) return; for (; mt < to; mt += .05) { A.forceT = mt; A.tick(); } };
  for (const e of log) {
    const t = (e.t - t0) / 1000; advance(t);
    A.forceT = t; A[e.m](...e.args);
    if (e.m === 'startMusic') mt = t;
  }
  advance(dur);
  window.setTimeout = realST;
  const buf = await off.startRendering(), n = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) out.setInt16(44 + (i * 2 + c) * 2, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
  const bytes = new Uint8Array(out.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}, { t0, dur });
fs.writeFileSync(path.join(TMP, 'audio.wav'), Buffer.from(wavB64, 'base64'));
const stats = await page.evaluate(() => ({ score: Math.floor(__g.score), leaves: __g.coins, metres: Math.floor(-__g.runner.z) }));
await browser.close();

execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(TMP, 'f%05d.jpg'), '-i', path.join(TMP, 'audio.wav'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-shortest', OUT], { stdio: 'inherit' });
console.log(JSON.stringify({ out: OUT, seconds: +dur.toFixed(1), frames: frame, fps: FPS, ...stats }));
fs.rmSync(TMP, { recursive: true, force: true });
