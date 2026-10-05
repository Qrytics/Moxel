# Moxel

**Pixel art, frame animation and Minecraft skin & texture editor — in the browser, local-first.**

Moxel is a professional-style illustration tool built around pixels: layers and groups, selections,
brushes with pressure, onion-skinned animation, a live 3D preview of Minecraft skins, and real-time
drawing with friends. Projects are saved automatically in your browser's IndexedDB — nothing is
uploaded, and no account is needed.

Live at **[mario-belmonte.com/Moxel](https://www.mario-belmonte.com/Moxel/)**.

## Features

**Projects & storage**

- Autosave to IndexedDB (debounced, flushed when the tab hides/closes) with a live status:
  _Saving…_ · _Saved locally ✓_ · _Offline — saved locally_
- Project list with thumbnails: create, open, rename, duplicate, delete, "continue editing"
- Export/import `.moxel` project files and a one-click **Download backup** of every project
- Clear fallback if browser storage is unavailable (memory-only, with a prompt to export)
- Installable PWA: once loaded, Moxel opens, edits, saves and exports offline

**Drawing**

- Tools: pencil (pixel-perfect), brush (size, hardness, spacing, round/square/custom tip, pen
  pressure → size/opacity), eraser, fill (tolerance, contiguous/global, sample all layers), line,
  rectangle, ellipse, clone stamp, eyedropper, hand, zoom
- Symmetry: horizontal, vertical, both, and **character left/right** for skins (paint one eye, get both)
- Selections: rectangle, ellipse, lasso, magic wand; add/subtract/intersect; select all, deselect,
  invert, select layer pixels; move (Alt-drag to copy, arrow-key nudge), cut/copy/paste
  (to and from the OS clipboard), delete, flip, rotate, scale; define a brush from a selection
- Layers: groups, drag-and-drop ordering, visibility, lock, opacity, blend modes, rename, duplicate,
  merge down, flatten, thumbnails
- Colour: HSV picker, hex/RGB/HSL/alpha inputs, foreground/background, recent colours, a per-project
  palette, saved palettes, built-in Minecraft-inspired palettes, palette import (.hex, .gpl, image)
  and export
- One stroke = one undo step; Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z; professional shortcuts (press `?`)

**Minecraft**

- 64×64 skins, Classic (4px arms) or Slim (3px arms); blank or a starter character
- UV guides for every face of every body part and outer layer, with hover read-out ("Right arm — Front")
- Real-time **3D preview** (Three.js): orbit/zoom/pan, front/back/left/right views, toggle body parts and
  outer layer, grid, lighting, background, idle/walk/turntable animation, **paint directly on the
  model**, save render as PNG
- Block textures preview as a cube; items and sprites as extruded voxels
- Skin validation before export (size, model, holes in the base layer, stray pixels, slim/classic mismatch)
- Import existing skins (64×64, and legacy 64×32 upgraded automatically); slim/classic detected
- Texture presets: block, item, HD block, GUI, mob/entity

**Animation**

- Frames with per-frame duration and FPS, playback with loop, onion skin (before/after, opacity)
- Export: animated GIF (transparent), sprite sheets (horizontal/vertical/grid), and **Minecraft animated
  textures** (vertical strip + `.png.mcmeta`, durations converted to game ticks)

**Live sessions (multiplayer)**

- **Draw together** on one canvas with live cursors, or work **side by side** on your own projects
  while everyone's canvas updates live next to yours
- Peer-to-peer over WebRTC data channels: artwork never touches the server. A tiny stateless relay
  (`signaling/`) only introduces browsers to each other.
- Convergent sync: per-pixel last-writer-wins with Lamport stamps, host-authoritative layer structure,
  per-user undo (undoing never erases a friend's strokes), layer claiming, resync
- Joined canvases are saved as a local copy, so you keep the work after the session

## Getting started

Requires Node.js ≥ 20.

```bash
npm install
npm run dev        # http://localhost:5173/Moxel/
npm run signal     # optional: local signaling relay on :8787 for live sessions (dev/preview proxy to it)
```

| Task                                 | Command                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| Lint                                 | `npm run lint`                                               |
| Type check (svelte-check, strict TS) | `npm run check`                                              |
| Unit tests (Vitest, 76 tests)        | `npm test`                                                   |
| Production build                     | `npm run build`                                              |
| Everything above                     | `npm run verify`                                             |
| Preview the build at `/Moxel/`       | `npm run preview`                                            |
| End-to-end suite (31 checks)         | `npm run build && npm i --no-save playwright && npm run e2e` |
| Regenerate PWA icons                 | `npm run icons`                                              |

The e2e suite runs against the real production build under `/Moxel/`: it creates a skin, draws,
checks undo/redo, layers, the 3D preview, autosave and reload persistence, exports a 64×64 PNG and a
`.moxel`, imports both in a fresh browser profile, reloads **offline**, and runs live sessions between
two browser contexts in both modes. Playwright is intentionally not a devDependency (its browser
download would run on every deploy build).

## Architecture

```
src/
  core/
    document/   Document model (layers tree, frames, cels), Ops + applyOp, user-level commands
    history/    Op-based undo/redo: every op returns its inverse; one gesture = one entry
    selection/  Coverage-mask selections; rect/ellipse/lasso/wand all produce masks
    tools/      Tool interface + stroke engine (coverage max-accumulation, pixel-perfect, symmetry)
    render/     Compositor (blend modes, isolated groups), dirty-rect composite cache, 2D renderer
  minecraft/    UV table (classic/slim), mirror map, legacy upgrade, templates, validation
  preview3d/    Three.js scene built from the UV table; picking for paint-on-model
  persistence/  IndexedDB store (+ memory fallback) and debounced autosaver
  io/           Pure-JS PNG codec, .moxel format, exporters (GIF, sheets, mcmeta) + export worker
  collab/       Wire codec/chunking, WebRTC mesh, convergence (SyncState, reconcileStructure)
  color/        Colour maths, palettes
  state/        App/editor/live-session controllers (Svelte 5 runes)
  ui/           Svelte components
signaling/      Stateless WebSocket relay for WebRTC handshakes (+ Dockerfile)
```

Key decisions:

- **The document is not a canvas.** It is layers × frames of RGBA "cels". Every mutation is a plain,
  serialisable `Op`; `applyOp` returns the inverse. That one primitive powers undo/redo, autosave, and
  the live-session protocol.
- **Pixel data is deliberately outside Svelte reactivity.** Strokes mutate typed arrays in place; the UI
  watches a few version counters, and the composite cache re-composites only dirty rects once per frame.
- **Stroke opacity is per stroke, not per dab** — coverage accumulates with `max()`, so crossing your own
  stroke doesn't darken it, shape previews reset cheaply, and the whole stroke commits as one patch.
- **Local-first persistence**: snapshots go straight into IndexedDB via structured clone (no
  serialisation step); `.moxel` files are a zip of `project.json` + one PNG per cel, inspectable with
  any unzip tool.

## The `.moxel` format

A zip archive:

```
project.json             # { app: "Moxel", format: "moxel", version: 1, meta, nodes, root, frames, editor, cels[] }
cels/<layer>/<frame>.png # 8-bit RGBA PNG per non-empty cel, at canvas size
```

`meta` holds name, kind (`skin` | `texture` | `canvas`), size, skin model, texture type, animation
settings and the project palette; `nodes`/`root` describe the layer tree (children bottom-first);
`editor` restores the active layer/frame, tool and brush settings. `.moxelbackup` bundles several
`.moxel` files plus a `backup.json` index.

## Deployment

Moxel is a static app served from the subpath **`/Moxel/`** of the portfolio site
([Qrytics/portfolioSite](https://github.com/Qrytics/portfolioSite)), which vendors the build:

```bash
# in portfolioSite
npm run build:moxel   # downloads this repo, builds with MOXEL_BASE=/Moxel/, copies dist → static/Moxel/
```

- The base path comes from `MOXEL_BASE` (default `/Moxel/`); every asset URL, the manifest and the
  service-worker scope derive from it. Routing is hash-based (`#/p/<id>`), so no SPA fallback is needed.
- Live sessions connect to `<origin>/Moxel/signal` (override with `VITE_SIGNAL_URL`). On the Pi, Caddy
  proxies that path to the `moxel-signal` container built from `signaling/`. On hosts without the relay,
  live sessions show a clear "unavailable" message; everything else works.
- The relay keeps nothing: no rooms on disk, no artwork, max 6 peers per room, rate-limited, and it only
  forwards SDP/ICE messages. There is no TURN server, so very strict networks may block peer connections.

## Privacy

Artwork stays in the browser that made it. There is no backend database and no analytics; exports are
generated locally; live sessions are browser-to-browser. Browser storage is per device and per browser —
use **Export project** or **Download backup** to keep copies or move to another device.

---

Not affiliated with Mojang or Microsoft. Minecraft is a trademark of Mojang Synergies AB. Moxel ships
no Mojang textures; the starter skin and palettes are original.
