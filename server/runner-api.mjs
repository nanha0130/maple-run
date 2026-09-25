// "Run as yourself": photo -> PINOC Gaussian-splat character, behind /api/runner.
// Mounted by the Vite dev server (vite.config.js) and by server/serve.mjs in production.
// Credentials stay here, never in the browser. Providers, first configured wins:
//   viggle  VIGGLE_API_KEY                         public Viggle API, POST /v1/characters type=vsplat
//   pinoc   PINOC_TOKEN + PINOC_API_PREFIX [+HOST]  PINOC asset-hub, POST /characters/generate
//   mock    RUNNER_MOCK=1                           no credits: returns a bundled character after ~20 s
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;

export function createRunnerApi(env, { root = process.cwd() } = {}) {
  const cfg = {
    viggleKey: env.VIGGLE_API_KEY || '',
    viggleBase: (env.VIGGLE_API_BASE || 'https://apis.viggle.ai').replace(/\/$/, ''),
    publicBase: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    pinocToken: env.PINOC_TOKEN || '', pinocPrefix: (env.PINOC_API_PREFIX || '').replace(/\/$/, ''), pinocHost: env.PINOC_API_HOST || '',
    mock: env.RUNNER_MOCK === '1',
    perIpPerDay: +(env.RUNNER_PER_IP_PER_DAY || 3), perDay: +(env.RUNNER_PER_DAY || 30),
  };
  const provider = cfg.viggleKey ? 'viggle' : cfg.pinocToken && cfg.pinocPrefix ? 'pinoc' : cfg.mock ? 'mock' : null;
  const cacheDir = path.join(root, 'server', 'cache');
  const images = new Map(); // id -> {buf, type}, served to the Viggle API as image_url when PUBLIC_BASE_URL is set
  const quota = { day: '', total: 0, ip: new Map() };
  const mockTasks = new Map();

  // ---------------------------------------------------------------- upstream calls
  function call(method, url, { headers = {}, body, host } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url), lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, { method, headers: { ...headers, ...(host ? { host } : {}), ...(body ? { 'content-length': body.length } : {}) } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('upstream timeout')));
      if (body) req.write(body); req.end();
    });
  }
  const json = r => { try { return JSON.parse(r.body.toString('utf8')); } catch { return null; } };
  function multipart(parts) {
    const b = '----maple' + crypto.randomBytes(8).toString('hex'), out = [];
    for (const p of parts) {
      out.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ''}\r\n`));
      out.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(String(p.value))); out.push(Buffer.from('\r\n'));
    }
    out.push(Buffer.from(`--${b}--\r\n`));
    return { body: Buffer.concat(out), type: `multipart/form-data; boundary=${b}` };
  }
  const upstreamError = (r, what) => {
    const msg = json(r)?.error?.message || json(r)?.error || r.body.toString('utf8').slice(0, 160);
    const hint = r.status === 401 ? ' (credential expired or invalid)' : r.status === 402 ? ' (out of credits)' : /just a moment/i.test(msg) ? ' (edge bot challenge: use the ingress + PINOC_API_HOST)' : '';
    return new Error(`${what}: ${r.status}${hint} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  };

  const P = {
    viggle: {
      async create(buf, type) {
        const auth = { authorization: `Bearer ${cfg.viggleKey}` };
        let parts;
        if (cfg.publicBase) { const id = crypto.randomUUID(); images.set(id, { buf, type }); setTimeout(() => images.delete(id), 3600e3); parts = [{ name: 'image_url', value: `${cfg.publicBase}/api/runner/img/${id}` }]; }
        else parts = [{ name: 'image', filename: 'runner.jpg', type, value: buf }];
        const m = multipart([...parts, { name: 'type', value: 'vsplat' }]);
        const r = await call('POST', `${cfg.viggleBase}/v1/characters`, { headers: { ...auth, 'content-type': m.type }, body: m.body });
        if (r.status >= 300) throw upstreamError(r, 'Viggle create');
        return json(r).id;
      },
      async status(id) {
        const auth = { authorization: `Bearer ${cfg.viggleKey}` };
        const r = await call('GET', `${cfg.viggleBase}/v1/characters/${encodeURIComponent(id)}`, { headers: auth });
        if (r.status >= 300) throw upstreamError(r, 'Viggle status');
        const c = json(r);
        if (c.status === 'failed') return { state: 'failed', error: c.error?.message || 'generation failed' };
        if (c.status !== 'ready') return { state: 'running', status: c.status };
        const e = await call('GET', `${cfg.viggleBase}/v1/characters/${encodeURIComponent(id)}/export`, { headers: auth });
        if (e.status >= 300) throw upstreamError(e, 'Viggle export');
        return { state: 'ready', url: json(e).vsplat_url };
      },
    },
    pinoc: {
      async create(buf, type) {
        const m = multipart([{ name: 'images', filename: 'runner.jpg', type, value: buf }, { name: 'visibility', value: 'private' }]);
        const r = await call('POST', `${cfg.pinocPrefix}/characters/generate`, { host: cfg.pinocHost, headers: { authorization: `Bearer ${cfg.pinocToken}`, 'content-type': m.type }, body: m.body });
        if (r.status >= 300) throw upstreamError(r, 'PINOC generate');
        return json(r).taskId;
      },
      async status(id) {
        const r = await call('GET', `${cfg.pinocPrefix}/characters/tasks/${encodeURIComponent(id)}`, { host: cfg.pinocHost, headers: { authorization: `Bearer ${cfg.pinocToken}` } });
        if (r.status >= 300) throw upstreamError(r, 'PINOC task');
        const t = json(r);
        if (t.error) return { state: 'failed', error: String(t.error) };
        const url = t.optimizedBinUrl ?? t.binUrl; // arrival of the bundle is the success signal; status strings vary
        return url ? { state: 'ready', url } : { state: 'running', status: t.status };
      },
    },
    mock: {
      async create() { const id = crypto.randomUUID(); mockTasks.set(id, Date.now()); return id; },
      async status(id) { return Date.now() - (mockTasks.get(id) || 0) > 20000 ? { state: 'ready', file: path.join(root, 'public', 'characters', 'runner.vsplat') } : { state: 'running' }; },
    },
  };

  // ---------------------------------------------------------------- guards
  function allow(ip) {
    const day = new Date().toISOString().slice(0, 10);
    if (quota.day !== day) Object.assign(quota, { day, total: 0, ip: new Map() });
    const n = quota.ip.get(ip) || 0;
    if (n >= cfg.perIpPerDay) return 'You’ve made today’s runners already. Come back tomorrow!';
    if (quota.total >= cfg.perDay) return 'The runner workshop is at capacity today.';
    quota.ip.set(ip, n + 1); quota.total++; return null;
  }
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BYTES) { reject(new Error('Image too large (8 MB max)')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
  // task ids travel as "<provider>.<remote id>" so status survives a server restart
  const pack = id => `${provider}.${id}`;
  const unpack = s => { const i = s.indexOf('.'); return i < 0 ? null : { p: s.slice(0, i), id: s.slice(i + 1) }; };
  const safe = s => /^[\w.-]{1,200}$/.test(s);

  async function assetFile(tid) {
    const file = path.join(cacheDir, tid.replace(/[^\w.-]/g, '_') + '.vsplat');
    try { await fs.access(file); return file; } catch { }
    const t = unpack(tid); if (!t || !P[t.p]) throw new Error('unknown task');
    const s = await P[t.p].status(t.id); if (s.state !== 'ready') throw new Error('not ready');
    if (s.file) return s.file;
    const r = await call('GET', s.url); if (r.status >= 300) throw new Error('download failed ' + r.status);
    if (r.body.subarray(0, 8).toString('latin1') !== 'VIGGCHAR') throw new Error('not a VIGGCHAR bundle');
    await fs.mkdir(cacheDir, { recursive: true }); await fs.writeFile(file, r.body); return file;
  }

  // ---------------------------------------------------------------- routes
  return async function handle(req, res, next) {
    const url = new URL(req.url, 'http://x'); if (!url.pathname.startsWith('/api/runner')) return next?.();
    const rest = url.pathname.slice('/api/runner'.length).replace(/^\//, '');
    try {
      if (req.method === 'GET' && rest === 'health') return send(res, 200, { enabled: !!provider, provider });
      if (req.method === 'GET' && rest.startsWith('img/')) {
        const im = images.get(rest.slice(4)); if (!im) return send(res, 404, { error: 'gone' });
        res.setHeader('content-type', im.type); return res.end(im.buf);
      }
      if (req.method === 'POST' && rest === '') {
        if (!provider) return send(res, 503, { error: 'Photo runners are not configured on this server' });
        const type = (req.headers['content-type'] || '').split(';')[0];
        if (!/^image\/(jpeg|png|webp)$/.test(type)) return send(res, 415, { error: 'Send a JPEG, PNG or WebP photo' });
        const buf = await readBody(req); if (buf.length < 2000) return send(res, 400, { error: 'That image looks empty' });
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const deny = allow(ip); if (deny) return send(res, 429, { error: deny });
        const id = await P[provider].create(buf, type);
        console.log(`[runner] ${provider} task ${id} from ${ip}`);
        return send(res, 200, { taskId: pack(id) });
      }
      const asset = rest.match(/^asset\/(.+)\.vsplat$/);
      if (req.method === 'GET' && asset && safe(asset[1])) {
        const file = await assetFile(asset[1]);
        res.setHeader('content-type', 'application/octet-stream'); res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        return res.end(await fs.readFile(file));
      }
      if (req.method === 'GET' && safe(rest)) {
        const t = unpack(rest); if (!t || !P[t.p]) return send(res, 404, { error: 'unknown task' });
        const s = await P[t.p].status(t.id);
        return send(res, 200, s.state === 'ready' ? { state: 'ready', assetId: rest } : s);
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      console.warn('[runner]', e.message);
      return send(res, 502, { error: e.message });
    }
  };
}
