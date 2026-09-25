import { loadEnv } from 'vite';
import { createRunnerApi } from './server/runner-api.mjs';

// /api/runner (photo -> PINOC character) runs inside the dev server; secrets come from .env.local, never the bundle.
const runnerApi = () => ({
  name: 'runner-api',
  configureServer(server) { server.middlewares.use(createRunnerApi({ ...process.env, ...loadEnv('development', process.cwd(), '') })); },
  configurePreviewServer(server) { server.middlewares.use(createRunnerApi({ ...process.env, ...loadEnv('production', process.cwd(), '') })); },
});

export default { server: { port: 5181, strictPort: true }, build: { chunkSizeWarningLimit: 4000 }, plugins: [runnerApi()] };
