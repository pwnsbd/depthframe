# DepthFrame

Turn a single photo into an interactive parallax "depth" viewer — entirely in the browser, no server, no uploads. Depth and lighting are estimated on-device by real AI models running via WebAssembly/WebGL, styled as a dark vintage hi-fi/hardware-rack UI.

**Live:** [depthframe.pwnsbd.me](https://depthframe.pwnsbd.me)

## What it is

Drop in a photo and DepthFrame estimates a per-pixel depth map, then uses it to shift the image in real time as you move your mouse — near things move more than far things, the classic motion-parallax illusion of 3D. On top of that it derives directional lighting/shading and a mild depth-of-field, so the photo reads as three-dimensional even before you touch it. Everything — image decode, AI inference, video encoding — runs locally in your browser; nothing is uploaded anywhere.

## Features

**Depth & parallax**
- Depth estimation via [Depth Anything V2 (Small)](https://huggingface.co/onnx-community/depth-anything-v2-small), run client-side in a Web Worker
- Mouse-driven parallax with adjustable depth/motion strength
- Idle auto-drift: after a few seconds without input, the view starts a slow, non-repeating synthetic wander instead of freezing
- Click-to-focus depth-of-field (real mipmap-based blur, not a fake tap pattern)
- Atmospheric haze that fades distant regions

**Lighting**
- Fast fallback: a Sobel-slope pseudo-normal derived directly from the depth map, available the instant depth finishes
- Upgrades in the background to real per-pixel surface normals from [Metric3D v2 (ViT-Small)](https://huggingface.co/onnx-community/metric3d-vit-small), a second independent AI model
- Lighting contrast tapers with depth (near = full punch, far = flatter), reinforcing the same depth read as haze
- Adjustable lighting strength, same drag+press knob interaction as every other control

**Import**
- Native support for PNG/JPEG/WebP
- HEIC/HEIF (iPhone photos) via `libheif-js`, decoded client-side, lazy-loaded only when actually needed
- DNG (camera RAW) via a custom-built embedded-preview extractor — reads the JPEG preview most RAW files already carry instead of demosaicing raw sensor data
- Format is detected from the actual file bytes, not the filename or browser-reported MIME type (both are unreliable for HEIC/DNG, especially on Windows)

**Export**
- PNG snapshot and looping MP4 video, both rendered at up to the source photo's native resolution via a dedicated offscreen renderer — not capped to whatever size the on-screen canvas happens to be
- Video loops seamlessly: a periodic variant of the idle-drift motion, tuned so position and velocity match exactly at the loop point
- MP4 via `MediaRecorder` (WebM/VP9) → `ffmpeg.wasm` (H.264, high-quality CRF) transcode, entirely client-side; ffmpeg's core files are self-hosted rather than fetched from a CDN

**Project persistence**
- Save/load a full project (image, computed depth, computed normals, every knob value) to IndexedDB — reopen exactly where you left off without re-running any model

## Tech stack

- **React 19 + TypeScript + Vite**
- **Three.js / React Three Fiber** for the WebGL parallax rendering and custom GLSL shader
- **@huggingface/transformers** (transformers.js) running ONNX models fully client-side
- **Zustand** for state
- **@ffmpeg/ffmpeg** (ffmpeg.wasm) for video transcoding
- **libheif-js** for HEIC/HEIF decoding
- IndexedDB for local project persistence

## Getting started

```bash
npm install
npm run dev      # start dev server
npm run build    # production build (tsc + vite build)
npm run lint      # oxlint
```

No environment variables or backend setup needed — everything, including the AI models, is fetched/cached client-side on first use.

## Architecture notes

- `src/model/` — two independent AI pipelines, each with its own Web Worker + manager (depth via `depthWorker`/`depthModelManager`, surface normals via `normalWorker`/`normalModelManager`). They never touch each other; normals only feed lighting, never depth/parallax.
- `src/viewer/` — the R3F `<DepthViewer>`/`<DepthPlane>` and the shader (`depthShader.ts`) that does parallax offset, DOF, lighting, and haze in a single fragment shader pass.
- `src/export/` — `ExportStage` mounts a second, hidden, native-resolution instance of the same viewer purely for capture, so exports aren't limited by the on-screen canvas size.
- `src/import/` — format detection (magic bytes, not filename) and HEIC/DNG normalization to a plain image before anything else in the app has to know those formats exist.
- `src/store/useAppStore.ts` — single Zustand store wiring all of the above together.
