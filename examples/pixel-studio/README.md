# Pixel studio (Hono)

A 30×30 pixel editor built on Studio, served by [Hono](https://hono.dev). It exercises the whole toolkit: a six-swatch palette, draw and erase strokes, an eyedropper, undo/redo, PNG export, and shift-click multi-selection with drag-to-move.

```sh
cd examples/pixel-studio
npm install
npm run dev        # builds the package, then serves on http://localhost:8787
```

`npm run dev` runs the package's `npm run build` first, because the browser loads Studio straight from `dist/` — the build emits relative `./grid.js` specifiers, so the server can hand the ES modules to the browser untouched. **No bundler, no transpile step, no client dependencies.** Set `PORT` to serve somewhere else.

Use `npm start` on its own when `dist/` is already built.

## Controls

| | |
| --- | --- |
| `D` / `E` / `V` / `I` | Draw, erase, select, sample |
| `1`–`6` | Pick a swatch (red, green, blue, white, black, orange) |
| Drag | Paint (or erase) a stroke — one undo entry per stroke |
| Right-click drag | Erase without switching tools |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `S` | Save a PNG |

### Selection

| | |
| --- | --- |
| Shift-click | Add a cell — or remove it, if it was already selected |
| Shift-drag | Sweep a run of cells in or out in one gesture |
| Drag a selected cell | Move the whole selection (Shift is not needed — the selection persists) |
| Arrow keys | Nudge the selection one cell, lifting it on the first press |
| `↵` / Apply | Write the move into the grid as a single undo entry |
| `Esc` / Cancel | Put everything back |

Selected cells scale up slightly, and the marquee traces only the *exterior* edges of the shape — contiguous cells share no seam, while diagonal or detached cells each get their own ring. A move overwrites the cells it lands on, and anything pushed past the canvas edge is deleted on apply (the sidebar counts them first).

## What to read

- `public/app.js` — the whole editor in one file: document dispatch, the render loop, and every `bindStudioInput` callback including `actions.selection`.
- `server.js` — 30 lines of Hono serving `public/` plus `dist/` under `/studio`.
