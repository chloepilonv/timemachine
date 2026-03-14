# Time Machine WebXR

Travel through time at the San Francisco Ferry Building — explore the same location in the 1920s, present day, and a speculative future, all in immersive WebXR.

Built for Pico headsets. Also works in any WebXR-capable browser with the included headset simulator.

## How It Works

Three Gaussian splat worlds (generated via [World Labs Marble](https://marble.worldlabs.ai/)) are loaded into a WebXR scene using [SparkJS](https://sparkjs.dev/) and [IWSDK](https://elixrjs.io/). A spatial UI panel lets you switch between eras with animated fly-in/fly-out transitions.

| Era | Description |
|-----|-------------|
| **1920s** | Cobblestone streets, Model Ts, gas lamps, hand-painted storefronts |
| **Present** | San Francisco Ferry Building as it looks today |
| **Future** | Flying vehicles, holographic displays, vertical gardens, smart roads |

## Prerequisites

- Node.js >= 20.19.0
- Splat assets (see [Asset Setup](#asset-setup) below)

## Quick Start

```bash
git clone git@github.com:chloepilonv/timemachine_webxr.git
cd timemachine_webxr
npm install
```

### Asset Setup

The Gaussian splat files are too large for git (~20-30 MB each). You need to download them into `public/splats/` before running.

**Option A — Download from World Labs Marble:**

1. Open each world in your browser:
   - **Present**: https://marble.worldlabs.ai/world/11223fe8-f431-41d6-9fe2-9bc277ddab0c
   - **Past (1920s)**: https://marble.worldlabs.ai/world/ed9e8428-e599-482c-a4c9-d77abb834d96
   - **Future**: https://marble.worldlabs.ai/world/5b917cba-1247-4287-8613-5a199e74d7da
2. Click the download/export button on each world with these settings:
   - Splat file format: **SPZ**
   - Coordinate system: **OpenGL**
   - Plane level: **Ground level**
   - High-quality mesh type: **Textured**
3. Rename and move the files:

```bash
cp "San Francisco Ferry Building Scene.spz" public/splats/present.spz
cp "San Francisco Ferry Building Scene_collider.glb" public/splats/present-collider.glb
cp "Historic City Street Clock Tower.spz" public/splats/past.spz
cp "Futuristic San Francisco Plaza.spz" public/splats/future.spz
```

**Option B — Download via World Labs API:**

If you have a `WORLDLABS_API_KEY`, the splats are available at these CDN URLs:

```
# Past (1920s) — full res
https://cdn.marble.worldlabs.ai/ed9e8428-e599-482c-a4c9-d77abb834d96/4b70b592-b865-43cd-8b09-b0dc1d347eb2_sand.spz

# Future — full res
https://cdn.marble.worldlabs.ai/5b917cba-1247-4287-8613-5a199e74d7da/d543f87c-07d1-41e7-8f07-db10b72466db_sand.spz
```

```bash
curl -L -o public/splats/past.spz "<past_url>"
curl -L -o public/splats/future.spz "<future_url>"
```

### Run

```bash
npm run dev
```

Opens at `http://localhost:8081/`. The IWSDK headset simulator is injected automatically on localhost — use the virtual controllers to look around and interact.

### Expected file structure

```
public/splats/
  present.spz            # ~29 MB
  present-collider.glb   # ~3 MB (collision mesh for locomotion)
  past.spz               # ~21 MB
  future.spz             # ~21 MB
```

## Pico Headset Testing

1. Connect your Pico to the same WiFi network as your dev machine
2. WebXR requires HTTPS on non-localhost. Either:
   - Run `mkcert -install` then re-enable `mkcert()` in `vite.config.ts`
   - Or deploy to Cloudflare Pages (see [Deployment](#deployment))
3. Open `https://<your-local-ip>:8081/` in the Pico browser
4. Tap **Enter XR** to launch immersive mode

## Controls

- **<< Past / Future >>** — cycle through eras
- **1920s / Present / Future** — jump directly to an era
- **Enter XR** — launch immersive VR mode
- **Teleport** — point and click to move (locomotion via invisible floor plane)
- **Grab** — grab and move objects with controllers or hand tracking

## Deployment

Build and deploy the static output to any CDN/host:

```bash
npm run build
# deploy dist/ to Cloudflare Pages, Vercel, Netlify, etc.
```

Make sure your splat files are included in the `dist/` output (they're copied from `public/` during build).

## Project Structure

```
timemachine_webxr/
├── public/splats/           # Gaussian splat assets (gitignored)
├── ui/
│   └── timemachine.uikitml  # Spatial UI panel layout
├── src/
│   ├── index.ts             # Main entry — world setup, camera, floor, UI
│   ├── worlds.ts            # Era definitions (past/present/future URLs)
│   ├── timeMachineSystem.ts # ECS system for switching between eras
│   ├── uiPanel.ts           # UI panel system — buttons, era display, XR toggle
│   ├── gaussianSplatLoader.ts  # SparkJS splat loading/unloading/animation
│   └── gaussianSplatAnimator.ts # GPU-accelerated fly-in/fly-out effects
├── vite.config.ts           # Vite + IWSDK plugins
└── package.json
```

## Built With

- [IWSDK](https://elixrjs.io/) — WebXR ECS framework (locomotion, grabbing, spatial UI)
- [SparkJS 2.0](https://sparkjs.dev/) — Gaussian splat renderer for WebGL2/WebXR
- [World Labs Marble](https://marble.worldlabs.ai/) — AI-generated 3D worlds from images
- [Vite](https://vite.dev/) — build tooling

## Performance Tuning

SparkJS quality settings are in `src/gaussianSplatLoader.ts`:

```ts
const spark = new SparkRenderer({
  lodSplatScale: 2.0,    // higher = more splats rendered (sharper)
  behindFoveate: 1.0,    // 1.0 = full quality everywhere
});
spark.outsideFoveate = 1.0;
```

For Pico headsets, you may want to lower these for smoother frame rates:

```ts
lodSplatScale: 1.0,
behindFoveate: 0.1,
outsideFoveate: 0.3,
```

## Related

- [timemachine](https://github.com/chloepilonv/timemachine) — Pipeline that generates the source tiles and World Labs worlds from Google Street View
- [sensai-webxr-worldmodels](https://github.com/V4C38/sensai-webxr-worldmodels) — Original template this project is built on
