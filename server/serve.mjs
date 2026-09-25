// Production: serves dist/ plus /api/runner.  `npm run build && npm start` (PORT, secrets from env or .env.local)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRunnerApi } from './runner-api.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const env = { ...process.env };
try { for (const l of (await fs.readFile(path.join(root, '.env.local'), 'utf8')).split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch { }
const api = createRunnerApi(env, { root });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vsplat': 'application/octet-stream', '.svg': 'image/svg+xml' };
const dist = path.join(root, 'dist');

http.createServer((req, res) => api(req, res, async () => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dist, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(dist)) { res.statusCode = 403; return res.end(); }
  try { const buf = await fs.readFile(file); res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(buf); }
  catch { res.statusCode = 404; res.end('not found'); }
})).listen(+(env.PORT || 8080), () => console.log(`maple-run on :${env.PORT || 8080}`));
