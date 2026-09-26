# MAPLE RUN · 紅葉ラン

A Subway Surfers–style endless runner down a three-track country railway through a maple tunnel in peak autumn colour.
Every runner, and the station master chasing them, is a PINOC Gaussian-splat character animated with PINOC motion clips.
On the title screen you pick **BEAT**, **WUKONG** or **MUSE**. With the photo backend running locally you can also **upload your own photo** and PINOC turns it into your runner.

**Play:** https://nanha0130.github.io/maple-run/ (needs a WebGPU browser: desktop Chrome or Edge, or Safari 26+)

```
npm install
npm run dev        # http://localhost:5181
```

## Photo runners ("run as yourself")

The browser uploads the photo to `/api/runner` ([server/runner-api.mjs](server/runner-api.mjs)). That endpoint calls the generator with a credential that stays on the server, and the page polls every 6 s. When the character is ready, `/api/runner/asset/<id>.vsplat` serves it and caches a copy in `server/cache/`. Generated runners are remembered in the browser's `localStorage`. A generation that was still running when the page closed picks up again on the next visit.

To set it up, copy `.env.example` to `.env.local` and fill in **one** provider. The first one configured wins:

| provider | env | notes |
|---|---|---|
| Viggle public API | `VIGGLE_API_KEY` (+ optional `PUBLIC_BASE_URL`) | recommended; the key comes from the Viggle developer dashboard |
| PINOC asset-hub | `PINOC_TOKEN`, `PINOC_API_PREFIX`, `PINOC_API_HOST` | personal token that lasts about 30 days, same pipeline as the PINOC MCP |
| mock | `RUNNER_MOCK=1` | spends no credits: after 20 s it returns a bundled character |

Each photo costs about 10 credits on the account behind the credential. Guardrails: `RUNNER_PER_IP_PER_DAY` (default 3) and `RUNNER_PER_DAY` (default 30).
In development the API runs inside `npm run dev`. In production use `npm run build && npm start`, which runs [server/serve.mjs](server/serve.mjs) and serves `dist/` plus the API. A static host such as GitHub Pages cannot run the upload feature.

**Controls:** ←/→ or A/D to switch track · ↑/W/Space to jump · ↓/S to roll (in the air, drops you fast and rolls on landing) · P/Esc to pause · M to mute. On touch devices, swipe in the same directions, and tap to jump.

## What's in the run

- **Hurdles** (yellow/black crossing barriers): jump them.
- **Gates** (red/white arm with a blinking lamp): roll under them.
- **Parked trains**: change track. A wooden **ramp** takes you onto the roofs, and you can run across a whole row of carriages.
- **Oncoming trains** (green livery, headlights, horn): they move toward you, so dodge early.
- **Golden maple leaves** are pickups. Distance times the multiplier (+1 every 1000 m) plus leaves makes the score.
- If you clip a train's side while changing track, you stumble and the station master closes in. A second stumble within 7 s means he catches you. Hitting anything head-on ends the run.

## Code map

| file | what |
|---|---|
| `src/roster.js` | character select, lazy loading, upload modal, generation polling |
| `server/runner-api.mjs` | photo → PINOC character API (Viggle v1 / PINOC / mock) |
| `src/main.js` | boot, runner physics and collision, chaser, cameras (title / run / crash), HUD, input, debug autopilot |
| `src/world.js` | 40 m scenery chunks (tunnel / open paddies + torii / station), sky, hills, lights |
| `src/obstacles.js` | train, ramp, hurdle and gate templates, pattern generator, walkable surfaces |
| `src/fx.js` | tumbling maple-leaf particles, including bursts and the runner's wake |
| `src/art.js` | every texture, painted on a canvas at boot (leaves, litter, ballast, livery, signs) |
| `src/audio.js` | synthesised music (pentatonic plucks + drums), wind, steps, whistle, horn |
| `src/builder.js` | static batching into a few meshes per chunk |

## Debug

- `?debug`: logs crash causes and exposes `scenario()`, `start()`, `crash()`.
- `?go`: skips the title screen. `?auto`: autopilot, which also works for trailer capture.
- `?run=running|gen_sprint_N`: picks the run cycle. `?backend=webgl` and `?dpr=1` are also available.
- `scenario([['hurdle',1,30],['ramp',0,60],['train',0,67],['train',2,90,{moving:true,speed:10}]])` clears the line and places a layout. Each entry is `[kind, lane, metres ahead]`.

## Engine notes (WebGPU)

- Canvas textures are flipped by hand before upload (`art.js toTexture`), because the `flipY` upload flag is not honoured for canvas sources on WebGPU.
- `pc.Color.fromString('#fff')` is parsed as blue. Always use 6-digit hex.
- Engine `armature.animationTime` is in **frames**. `Actor.play({at})` takes seconds and converts them.
- All clips play with `rootMotionMode = 'extract'` (in place), and the game owns forward motion.
- PINOC text-to-motion clips face +Z. `loadClips` turns `gen_*` clips 180° at load.
- The library "Sprinting Forward" clip sprints and then stops, so it isn't a loop. The run cycle uses a generated sprint loop, or falls back to "Running" played fast.

Assets: `public/characters/GENERATED-ASSETS.txt`.
