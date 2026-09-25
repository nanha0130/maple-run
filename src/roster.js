import { loadActor } from './actors.js';

// The runner roster: preset PINOC characters plus "run as yourself" (photo -> PINOC splat via /api/runner).
const BASE = import.meta.env.BASE_URL;
export const PRESETS = [
  { id: 'beat', name: 'BEAT', file: 'beat', portrait: 'portraits/beat.jpg' },
  { id: 'wukong', name: 'WUKONG', file: 'wukong', portrait: 'portraits/wukong.jpg' },
  { id: 'muse', name: 'MUSE', file: 'muse', portrait: 'portraits/muse.jpg' },
];
const API = (import.meta.env.VITE_RUNNER_API || '').replace(/\/$/, '') + '/api/runner';
const LS = 'maple-run-mine';
const V = 3; // bump when a bundled character changes; also defeats a stale cached HTML fallback
const $ = id => document.getElementById(id);
const store = { get() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } }, set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { } } };

export class Roster {
  constructor(game, { onSelect }) {
    this.game = game; this.onSelect = onSelect; this.cache = new Map(); this.loading = new Map();
    this.list = [...PRESETS, ...store.get().map(m => ({ ...m, mine: true }))];
    this.selected = this.list[0].id; this.enabled = false;
    this.render();
    this.probe();
    this.setupModal();
    // resume a generation that was still running when the page closed
    for (const c of this.list) if (c.pending) this.poll(c);
  }
  get current() { return this.list.find(c => c.id === this.selected); }
  // First runner that actually loads, starting from the selected one: one broken bundle shouldn't block the game.
  async firstLoadable() {
    const order = [this.current, ...this.list.filter(c => c !== this.current && !c.pending)];
    let err;
    for (const c of order) { try { const a = await this.actor(c); this.selected = c.id; this.render(); return a; } catch (e) { console.warn(e); err = e; } }
    throw err;
  }
  async probe() {
    try { const r = await fetch(API + '/health'); this.enabled = r.ok && (await r.json()).enabled; } catch { this.enabled = false; }
    this.render();
  }
  // Load (once) and return the Actor for a roster entry.
  actor(c) {
    if (this.cache.has(c.id)) return Promise.resolve(this.cache.get(c.id));
    if (!this.loading.has(c.id)) {
      const url = c.mine ? `${API}/asset/${c.assetId}.vsplat` : `${BASE}characters/${c.file}.vsplat?v=${V}`;
      this.loading.set(c.id, loadActor(this.game, url, c.id).then(a => { a.show(false); this.cache.set(c.id, a); this.loading.delete(c.id); return a; })
        .catch(e => { this.loading.delete(c.id); throw new Error(`${c.name} (${url}): ${e.message}`); }));
    }
    return this.loading.get(c.id);
  }
  async select(id) {
    const c = this.list.find(x => x.id === id); if (!c || c.pending) return;
    this.selected = id; this.render();
    $('roster').classList.add('busy');
    try { const a = await this.actor(c); if (this.selected === id) this.onSelect(a, c); }
    catch (e) { console.warn('runner load failed', e); this.toast(`Couldn't load ${c.name}`); }
    finally { $('roster').classList.remove('busy'); }
  }
  step(dir) { const ok = this.list.filter(c => !c.pending), i = ok.findIndex(c => c.id === this.selected); this.select(ok[(i + dir + ok.length) % ok.length].id); }

  render() {
    const el = $('roster'); if (!el) return;
    el.innerHTML = '';
    for (const c of this.list) {
      const b = document.createElement('button'); b.className = 'card' + (c.id === this.selected ? ' on' : '') + (c.pending ? ' pending' : '') + (c.mine ? ' mine' : '');
      b.innerHTML = `<span class="pic" style="background-image:url('${c.portrait?.startsWith('data:') ? c.portrait : BASE + (c.portrait || '')}')"></span><span class="nm">${c.pending ? 'MAKING…' : c.name}</span>`;
      if (c.pending) b.innerHTML += `<span class="spin"></span>`;
      b.addEventListener('click', e => { e.stopPropagation(); this.select(c.id); });
      el.appendChild(b);
    }
    if (!this.enabled) return; // no photo backend (e.g. a static host): no upload card
    const up = document.createElement('button'); up.className = 'card add';
    up.innerHTML = `<span class="pic plus">+</span><span class="nm">UPLOAD</span>`;
    up.title = this.enabled ? 'Upload a photo and run as yourself' : 'Photo runners need the PINOC server (see README)';
    up.addEventListener('click', e => { e.stopPropagation(); this.openModal(); });
    el.appendChild(up);
  }

  // ---------------------------------------------------------------- upload flow
  setupModal() {
    const m = $('upload'), input = $('up-file'), drop = $('up-drop');
    const pick = f => { if (!f || !f.type.startsWith('image/')) return; this.file = f; const url = URL.createObjectURL(f); drop.style.backgroundImage = `url(${url})`; drop.classList.add('has'); $('up-go').disabled = !this.enabled; };
    input.addEventListener('change', () => pick(input.files[0]));
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
    $('up-close').addEventListener('click', () => this.closeModal());
    m.addEventListener('click', e => { if (e.target === m) this.closeModal(); });
    $('up-go').addEventListener('click', () => this.submit());
    for (const ev of ['pointerdown', 'pointerup', 'keydown']) m.addEventListener(ev, e => e.stopPropagation());
  }
  openModal() { $('upload').classList.add('show'); $('up-go').disabled = !(this.file && this.enabled); $('up-note').textContent = this.enabled ? '' : 'The photo generator is offline right now.'; }
  closeModal() { $('upload').classList.remove('show'); }
  get modalOpen() { return $('upload').classList.contains('show'); }
  async submit() {
    if (!this.file || !this.enabled) return;
    $('up-go').disabled = true; $('up-note').textContent = 'Uploading…';
    try {
      const small = await shrink(this.file, 1600);
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': small.type }, body: small });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
      const entry = { id: 'mine-' + j.taskId.slice(0, 8), name: 'YOU', taskId: j.taskId, pending: true, portrait: await thumb(small), mine: true, t0: Date.now() };
      store.set([...store.get(), entry]); this.list.push(entry); this.render();
      this.closeModal(); this.toast('Turning your photo into a runner · ~3 min. Keep playing!');
      $('up-note').textContent = ''; this.file = null; $('up-drop').style.backgroundImage = ''; $('up-drop').classList.remove('has');
      this.poll(entry);
    } catch (e) { $('up-note').textContent = 'Upload failed: ' + e.message; $('up-go').disabled = false; }
  }
  async poll(entry) {
    for (; ;) {
      await new Promise(r => setTimeout(r, 6000));
      let j; try { const r = await fetch(`${API}/${entry.taskId}`); j = await r.json(); if (r.status === 404) j = { state: 'failed', error: j.error }; } catch { continue; }
      if (j.state === 'ready') {
        Object.assign(entry, { pending: false, assetId: j.assetId }); delete entry.pending;
        store.set(store.get().map(m => m.id === entry.id ? entry : m)); this.render();
        this.toast('Your runner is ready!'); if (this.game.phase === 'title') this.select(entry.id);
        return;
      }
      if (j.state === 'failed') {
        this.list = this.list.filter(c => c.id !== entry.id); store.set(store.get().filter(m => m.id !== entry.id)); this.render();
        this.toast('PINOC couldn’t build that one: ' + (j.error || 'try a full-body photo')); return;
      }
      const card = [...document.querySelectorAll('#roster .card.pending .nm')].at(-1);
      if (card) card.textContent = `MAKING ${Math.floor((Date.now() - entry.t0) / 1000)}s`;
    }
  }
  toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(this.tt); this.tt = setTimeout(() => t.classList.remove('show'), 3200); }
}

// Downscale before upload: phones produce 4000 px photos; PINOC doesn't need them.
async function shrink(file, max) {
  const img = await createImageBitmap(file); const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', .9));
}
async function thumb(blob) {
  const img = await createImageBitmap(blob), s = 200, c = document.createElement('canvas'); c.width = s; c.height = s * 1.25;
  const k = Math.max(c.width / img.width, c.height / img.height), w = img.width * k, h = img.height * k;
  c.getContext('2d').drawImage(img, (c.width - w) / 2, 0, w, h); return c.toDataURL('image/jpeg', .8);
}
