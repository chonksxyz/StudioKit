# Studio

A dependency-free toolkit for building pixel art studios in the browser.

Studio gives you the hard, boring parts of a pixel editor — a grid you define, undo/redo history, draw and erase gestures, configurable keyboard shortcuts, image export, and design persistence — as small framework-agnostic modules. You bring the UI; Studio keeps the document correct.

Studio was extracted from [Chonks Studio](https://www.chonks.xyz/studio), the pixel art editor behind the fully on-chain Chonks NFT project, which is its first consumer.

## Features

- **Zero dependencies.** Plain TypeScript. No React, no canvas library, no build-time magic. Works with React, Vue, Svelte, or vanilla DOM.
- **A grid you define.** Any rectangular dimensions — 16×16, 30×30, 64×32. Cells are valid CSS color strings or `null` (empty).
- **History built in.** A pure reducer models the document: every brush stroke commits as exactly one undo entry, cancelled strokes roll back cleanly, and atomic edits (clear, recolor, load, affix) are each one history step.
- **Draw and erase.** Pointer gestures with pointer capture: left-click paints, right-click erases, holding Shift erases (unless you hand Shift to selections instead), two-finger touch becomes pinch-to-zoom. Fast drags interpolate, so a quick flick paints a connected line instead of a dotted one. Gestures cancel safely on blur, tab-hide, and unmount.
- **Select, drag, and drop cells.** Shift-click or drag out a multi-cell selection, move it with the pointer or the arrow keys, recolor it, delete it, and commit it as one undo entry. Selections outline as a single shape, cells carried off the canvas are deleted, and Escape puts everything back.
- **Keyboard shortcuts you configure.** Declare your own key map, scope shortcuts to overlays (menus, modals), and Studio handles the rest: undo/redo on `⌘Z`/`⌘⇧Z`, staying out of the way while the user types in a text field, and never shadowing system shortcuts like paste.
- **Save as an image.** Render any grid to a PNG data URL, an SVG string, or trigger a download of either, at a configurable integer pixel scale, with an optional background color — using only the native canvas API (and none at all for SVG).
- **Persistence.** A tiny versioned design store over any `localStorage`-shaped backend, with validation, migration from legacy keys, and deduplication.
- **Fully testable without a browser.** Every module accepts injected targets (window, document, storage, canvas), so the whole editor core runs under `node:test`.

## Install

```sh
npm install @chonksxyz/studio
```

```ts
import {
  createGrid,
  createStudioDocument,
  studioDocumentReducer,
  bindStudioInput,
  saveStudioGridImage,
} from "@chonksxyz/studio";
```

Studio has **zero runtime dependencies** — the published package is plain ES modules plus type declarations. Until it lands on the npm registry, vendor the `src/` directory into your project — it compiles as-is under any TypeScript bundler.

## Dependency policy

Studio stays dependency-free on purpose: a pixel editor core shouldn't bring a tree of transitive packages into your app. Contributions must not add runtime dependencies. When an existing library solves a problem well, vendor the minimal excerpt Studio actually needs instead of depending on the whole package, and attribute it in the code — a comment at the excerpt naming the source project, its license, and a link. Excerpts must come from licenses compatible with MIT.

## Quick start

A complete editor in ~60 lines of vanilla JS. See [docs/IMPLEMENTING.md](docs/IMPLEMENTING.md) for the full walkthrough, including React.

```js
import {
  bindStudioInput,
  createGrid,
  createStudioDocument,
  saveStudioGridImage,
  studioDocumentReducer,
} from "@chonksxyz/studio";

const SIZE = { rows: 16, columns: 16 };
let state = createStudioDocument(createGrid(SIZE));
let mode = "draw";
let selectedColor = "#1c1cff";

// 1. Render cells with data-row / data-col attributes.
const gridElement = document.querySelector("#grid");
for (let row = 0; row < SIZE.rows; row += 1) {
  for (let column = 0; column < SIZE.columns; column += 1) {
    const cell = document.createElement("div");
    cell.dataset.row = String(row);
    cell.dataset.col = String(column);
    gridElement.appendChild(cell);
  }
}

function render() {
  for (const cell of gridElement.children) {
    const { row, col } = cell.dataset;
    cell.style.background = state.grid[row][col] ?? "transparent";
  }
}

function dispatch(action) {
  state = studioDocumentReducer(state, action);
  render();
}

// 2. Bind pointer gestures and keyboard shortcuts.
const binding = bindStudioInput({
  grid: gridElement,
  rows: SIZE.rows,
  columns: SIZE.columns,
  getPolicy: () => ({ overlay: "none", mode, selectedColor }),
  actions: {
    beginStroke: (row, column, color) =>
      dispatch({ type: "begin-stroke", row, column, color }),
    updateStroke: (row, column, color) =>
      dispatch({ type: "update-stroke", row, column, color }),
    commitStroke: () => dispatch({ type: "commit-stroke" }),
    cancelStroke: () => dispatch({ type: "cancel-stroke" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
  },
  shortcuts: [
    { key: "d", run: () => (mode = "draw") },
    { key: "e", run: () => (mode = "erase") },
    {
      key: "s",
      preventDefault: true,
      run: () => saveStudioGridImage(state.grid, { scale: 20, fileName: "art.png" }),
    },
  ],
});

// Call binding.destroy() when tearing the editor down.
```

## Example

[`examples/pixel-studio`](examples/pixel-studio) is a runnable 30×30 editor on Hono — palette, draw, erase, eyedropper, undo/redo, PNG export, and shift-click selection drag — with no bundler and no client dependencies.

```sh
cd examples/pixel-studio && npm install && npm run dev
```

## Modules

| Module | What it gives you |
| --- | --- |
| `grid` | `createGrid`, `cloneGrid`, `mergeGrids`, `gridsEqual`, `getGridSize` — immutable helpers for rectangular grids of any size |
| `document` | `createStudioDocument`, `studioDocumentReducer`, `canUndo`, `canRedo` — the pure document reducer with stroke-grained history |
| `selection` | `createSelection`, `toggleSelectionCell`, `selectionOutline`, `selectionRegions`, `fillSelection`, `stampSelection` — the pure selection model and its outline geometry |
| `input` | `bindStudioInput` — delegated pointer gestures plus your configurable shortcut map |
| `image` | `drawStudioGrid`, `studioGridToDataUrl`, `saveStudioGridImage`, `studioGridToSvg`, `studioGridToSvgDataUrl`, `saveStudioGridSvg` — PNG and SVG export and download |
| `storage` | `createDesignStore` — versioned, validated persistence over any storage adapter |

Every module is independent — use only the pieces you need.

## The document model

The document is a plain immutable value:

```ts
type StudioDocumentState = {
  grid: StudioGrid;        // (string | null)[][] — current pixels, including any in-flight stroke or floating selection
  past: StudioGrid[];      // undo stack of committed snapshots
  future: StudioGrid[];    // redo stack
  stroke: { baseline: StudioGrid; changedCells: number } | null;
  float: StudioFloatingSelection | null;  // cells lifted by a selection drag
  isPristine: boolean;     // true until the first committed edit
};
```

Rules the reducer enforces for you:

- A stroke (`begin-stroke` → `update-stroke`* → `commit-stroke`) is **one** undo entry, no matter how many cells it touches.
- A stroke that changes nothing never pollutes history; `cancel-stroke` restores the pre-stroke grid.
- A selection move (`lift-selection` → `move-selection`* → `commit-selection`) is **one** undo entry too; `cancel-selection` restores the pre-lift grid.
- `undo`/`redo` during an active stroke or selection move cancel the draft instead of navigating history.
- `clear`, `recolor`, `load`, and `affix` (merge a grid on top) are each atomic and undoable.
- `hydrate` seeds a pristine document (e.g. from a URL or saved file) without creating history.
- Grids passed in are cloned at every boundary; grids whose dimensions don't match the document are ignored.

## Selections

A selection is just a normalized list of cells — `readonly { row, column }[]` — that you hold in your own state. The `selection` module gives you the algebra (`toggleSelectionCell`, `selectionRectangle`, `translateSelection`) and the geometry you need to draw it:

```ts
import { selectionOutline, selectionRegions, isSelectionContiguous } from "@chonksxyz/studio";

// Exterior edges only: shared sides between neighbouring cells are omitted, so
// a contiguous shape outlines as one ring with no seams through the middle.
for (const { row, column, side } of selectionOutline(selection)) {
  cellAt(row, column).classList.add(`edge-${side}`);
}

// Cells touching only at a corner are separate regions, each with its own ring:
selectionRegions(selection);        // [[{0,0}], [{1,1}]] for a diagonal pair
isSelectionContiguous(selection);   // false
```

### Shift: erase or select

Shift can't do both jobs, so which one it does is your call — a policy flag, not a hardcoded key.

**By default nothing changes:** holding Shift is still temporary erase, exactly as before. Selections then need `mode: "select"`, a dedicated tool where plain clicks select and Shift adds to the selection.

**Set `shiftSelects: true`** and Shift selects in *every* tool. The user shift-clicks cells while still holding a brush, lets go of Shift — the selection stays, because it's state, not a modifier — and drags any selected cell to move the whole shape. No tool change to move pixels.

What that costs, and what it doesn't:

- Shift **stops erasing** wherever it selects. That's the trade, and it's the whole point of the flag.
- Erasing is not lost: **right-click drag** still erases, and `mode: "erase"` still erases.
- `onTemporaryEraseChange` then only reports the right-click override, since Shift no longer contributes.
- The selection keys arm whenever `hasSelection` is true, so arrows/Enter/Escape/Delete work without leaving the drawing tool.

```ts
getPolicy: () => ({
  overlay: "none",
  mode,                       // "draw" | "erase" | "select"
  selectedColor,
  shiftSelects: true,         // Shift selects instead of erasing
  isSelected: (row, column) => selectionHas(selection, row, column),
  hasSelection: selection.length > 0,
}),
```

The gestures Studio then handles, reporting each through `actions.selection`:

| Gesture | What it does |
| --- | --- |
| Shift-click a cell | `beginSelect(row, column, additive)` — add it, or drop it if it was already in |
| Shift-drag | `extendSelect` per cell, sweeping a run in or out; fast drags fill the cells between pointer samples |
| Drag a selected cell | Move the whole selection (no Shift — `endMove` can commit on drop, so nothing needs confirming) |
| Arrow keys | Nudge by one cell, lifting on the first press so the keyboard alone can move a selection |
| `Enter` / `Escape` | Commit or cancel |
| `Delete` / `Backspace` | Empty the selected cells — only if you wire the optional `delete` handler, otherwise those keys stay native |

Studio reports the gestures; what each one does to your selection stays your decision. The example toggles a cell on shift-click, sweeps additively on shift-drag, and only admits painted cells at all — by checking `grid[row][column] !== null` inside `beginSelect` and `extendSelect`.

### Moving, recoloring, and deleting

Moving a selection runs through the document reducer, so the whole move is one undo entry:

| Action | Effect |
| --- | --- |
| `lift-selection` | Cut the selected cells off the canvas into a float (rendered in place, at offset zero) |
| `move-selection` | Nudge the float by a delta; pass `selection` to lift on the first nudge, so arrow keys work without a drag |
| `place-selection` | Put the float at an absolute offset — what a pointer drag dispatches |
| `fill-selection` | Recolor the selected cells (one history entry; repaints a float in place instead) |
| `commit-selection` | Write the float into the grid (one history entry) |
| `cancel-selection` | Restore the pre-lift grid |

Two behaviours worth knowing: a float **overwrites** what it lands on, and cells moved past the grid edge are **dropped** — moving pixels off the canvas deletes them. `getFloatingSelection(state)` returns the float's current coordinates (including off-canvas ones) so you can outline it while it moves; `selectionWithinGrid` filters them to what will survive the commit.

`fill-selection` recolors in place, and mid-move it repaints the cells in flight rather than landing them — so a move plus a recolor still commits as one history entry. To empty cells instead, `fillSelection(grid, selection, null)` — which is exactly what `clearSelection` is — through a `load`.

## Keyboard shortcuts

Shortcuts are data, not hardcoded keys:

```ts
type StudioShortcut = {
  key: string;                  // lowercase KeyboardEvent.key, e.g. "d", "/", "escape"
  overlays?: readonly string[]; // overlay names this shortcut is active in; default ["none"]
  preventDefault?: boolean;
  allowInEditable?: boolean;    // fire even while typing (escape-style close keys)
  run: () => void;
};
```

Your `getPolicy()` reports the current overlay (`"none"` means the canvas is focused; any other string names an open menu/modal). Studio then guarantees:

- Shortcuts fire only in the overlays they declare, so an open modal silently disables canvas keys.
- Typing in an `input`, `textarea`, `select`, or contenteditable never triggers shortcuts (except `allowInEditable` ones, like Escape-to-close).
- `⌘Z`/`Ctrl+Z` undoes and `⌘⇧Z`/`Ctrl+Shift+Z` redoes, always with `preventDefault`.
- Other system chords (`⌘C`, `⌘V`, `Alt+…`) pass through untouched.
- Holding Shift temporarily switches to erase, unless `shiftSelects` or `mode: "select"` gives Shift to selections instead — see [Shift: erase or select](#shift-erase-or-select). `onTemporaryEraseChange` reports the aggregate Shift/right-click override state.
- With something selected, the arrow keys move the selection, Enter commits it, Escape cancels it, and Delete/Backspace empty the selected cells (the last only if you wire a `delete` handler — otherwise those keys stay native).

## Saving images

```ts
import { saveStudioGridImage, studioGridToDataUrl } from "@chonksxyz/studio";

// Download a 16px-per-cell PNG with a white background:
saveStudioGridImage(state.grid, {
  scale: 16,
  backgroundColor: "#ffffff",
  fileName: "my-pixel-art.png",
});

// Or get a data URL (transparent background by default):
const dataUrl = studioGridToDataUrl(state.grid, { scale: 32 });
```

For a scalable vector export, the same options produce an SVG — horizontal runs of same-colored cells merge into single `<rect>`s, rendered with crisp edges at any zoom, no canvas involved:

```ts
import { saveStudioGridSvg, studioGridToSvg, studioGridToSvgDataUrl } from "@chonksxyz/studio";

saveStudioGridSvg(state.grid, { scale: 16, fileName: "my-pixel-art.svg" });

const markup = studioGridToSvg(state.grid, { scale: 16 });               // "<svg …>…</svg>"
const svgUrl = studioGridToSvgDataUrl(state.grid, { scale: 16 });        // for <img src>
const readable = studioGridToSvg(state.grid, { pretty: true });          // one element per line
```

For layered exports (backgrounds, sprites underneath the drawing), use `drawStudioGrid(context, grid, options)` directly on your own canvas between your other draw calls.

## Persisting designs

```ts
import { createDesignStore } from "@chonksxyz/studio";

const store = createDesignStore({
  storage: window.localStorage,
  key: "myStudio:v1",
  legacyKeys: ["myStudio"],            // migrated (and re-written) on first load
  normalize: (value) => {              // validate + strip each stored record
    if (typeof value !== "object" || value === null) return null;
    const { pixels } = value as { pixels?: unknown };
    return typeof pixels === "string" && pixels.length > 0 ? { pixels } : null;
  },
  isEqual: (a, b) => a.pixels === b.pixels,  // deduplicate on save
});

store.save({ pixels: encode(state.grid) });
const designs = store.load();
store.remove(0);
```

Corrupt payloads load as `[]` instead of throwing, and invalid records are dropped one by one rather than poisoning the whole list.

## Testing

Studio's tests run in Node via `node:test`:

```sh
yarn install
yarn test
```

Because `bindStudioInput` takes injected `windowTarget`/`documentTarget` and the reducer is pure, you can test your whole editor headlessly the same way — see `tests/input.test.ts` for the fake-DOM pattern.

## License

[MIT](LICENSE)
