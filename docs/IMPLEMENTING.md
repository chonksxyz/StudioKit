# Implementing a pixel art studio with Studio

This guide walks through building an editor on Studio from scratch: state, DOM contract, input, shortcuts, selections, image export, persistence, and testing. It ends with framework notes for React.

## 1. Pick your grid and create the document

A grid is `{ rows, columns, cells }`, where `cells` is one flat row-major array: the cell at `(row, column)` is `cells[row * columns + column]`. Painted cells are valid CSS color strings, empty cells are `null`. Studio does not validate colors. Any rectangular dimensions work; the document adopts the dimensions of its initial grid and rejects mismatched grids from then on.

```ts
import { createGrid, StudioDocument } from "@chonksxyz/studio";

const SIZE = { rows: 32, columns: 32 };
const studio = new StudioDocument(createGrid(SIZE));
```

To boot from a previously saved drawing without creating an undo entry, `hydrate` the pristine document:

```ts
studio.hydrate(savedGrid);
```

If your saved drawings are nested `grid[row][column]` arrays, `gridFromRows` converts them.

## 2. Render the grid with the `data-row` / `data-col` contract

Studio's input engine finds cells by delegation: it listens on the grid container and resolves the cell under the pointer via `closest("[data-row][data-col]")`. That means:

- Each cell element carries `data-row` and `data-col` attributes (0-indexed integers).
- Cells live anywhere inside the container you pass as `grid` — rows, a CSS grid, absolutely positioned divs, all fine.
- You never attach per-cell listeners, so a 64×64 grid costs zero listener overhead.

```html
<div id="grid" style="display: grid; grid-template-columns: repeat(32, 16px);">
  <div data-row="0" data-col="0"></div>
  <div data-row="0" data-col="1"></div>
  <!-- … -->
</div>
```

Render by writing each cell's background from `studio.getCell(row, col)`, or straight from `studio.cells`. How you do that (direct DOM writes, React rows, canvas) is up to you — Studio never touches presentation.

If your markup can't use `data-row`/`data-col`, pass a custom `cellSelector` and keep the two dataset keys on whatever the selector matches.

## 3. Wire the document

All edits go through the document's methods. Each returns whether anything changed, and the document tells its subscribers after every change, so one subscription keeps the screen current:

```ts
studio.subscribe(render);
```

The methods:

| Method | Effect |
| --- | --- |
| `beginStroke` / `updateStroke` / `commitStroke` | One drag gesture; commits as a single undo entry |
| `cancelStroke` | Roll the in-flight stroke back to its baseline |
| `undo` / `redo` | Navigate history (cancels an active stroke instead) |
| `clear` | Empty the grid (atomic, undoable) |
| `recolor(from, to)` | Replace every cell of one color with another |
| `load(grid)` | Replace the whole grid (atomic, undoable) |
| `affix(grid)` | Merge a grid on top; incoming pixels win |
| `hydrate(grid)` | Seed a pristine document without history |
| `liftSelection` / `moveSelection` / `placeSelection` | Move a selection of cells; see step 6 |
| `fillSelection(selection, color)` | Recolor the selected cells |
| `commitSelection` / `cancelSelection` | Write the moved cells, or put them back |

`studio.dispatch(action)` takes the same operations as action objects (`{ type: "begin-stroke", row, column, color }`), which is handy when something else already speaks in actions.

Use `studio.canUndo` / `studio.canRedo` to enable your toolbar buttons.

To redraw only what changed, compare `studio.rowRevision(row)` with the revision you last drew: it changes only when a cell in that row does.

## 4. Bind input

```ts
import { bindStudioInput } from "@chonksxyz/studio";

const binding = bindStudioInput({
  grid: gridElement,
  rows: SIZE.rows,
  columns: SIZE.columns,
  getPolicy: () => ({
    overlay: openOverlay,      // "none", or the name of whatever menu/modal is open
    mode,                      // "draw" | "erase" | "select"
    selectedColor,             // current CSS color
    // Only needed for selections — see step 6:
    isSelected: (row, column) => selectionHas(selection, row, column),
    hasSelection: selection.length > 0,
    shiftSelects: true,        // Shift selects instead of erasing
  }),
  actions: {
    beginStroke: (row, column, color) => studio.beginStroke(row, column, color),
    updateStroke: (row, column, color) => studio.updateStroke(row, column, color),
    commitStroke: () => studio.commitStroke(),
    cancelStroke: () => studio.cancelStroke(),
    undo: () => studio.undo(),
    redo: () => studio.redo(),
    // Optional niceties:
    onTemporaryEraseChange: (active) => setEraseCursor(active),
    applyPinchScale: (factor) => setZoom((zoom) => zoom * factor),
  },
  shortcuts: [...],            // see step 5
});
```

What the binding does for you:

- **Pointer strokes.** `pointerdown` on a cell begins a stroke with pointer capture; dragging updates it cell by cell (via `elementFromPoint`, so it works across rows); release commits exactly once. `color` is the selected color, or `null` when erasing.
- **Fast drags stay connected.** Pointer samples arrive far coarser than the grid — a quick flick can report three points twenty cells apart — so strokes and selection sweeps walk the cells between consecutive samples instead of leaving gaps.
- **Erase affordances.** Right-click drag erases (without breaking context menus outside the grid). Holding Shift erases. `mode: "erase"` in your policy erases.
- **Selection gestures.** `mode: "select"` swaps strokes for selection: Shift-click and drag to pick cells, drag a selected cell to move the whole selection, arrow keys to nudge, Enter/Escape to commit or cancel. See step 6.
- **Touch.** One finger draws; a second finger cancels the stroke and reports pinch factors through `applyPinchScale`.
- **Safety.** Strokes cancel — never half-commit — on window blur, tab hide, an overlay opening, or `destroy()`. Text selection and the grid's own context menu are suppressed.
- **Losing pointer capture commits.** Capture loss only means no more events are coming for a stroke the user can already see, and browsers disagree on whether `lostpointercapture` fires before or after `pointerup`. Discarding there would make a finished stroke vanish on release, so Studio keeps the pixels.

Two lifecycle calls matter:

- `binding.syncPolicy()` — call after your overlay state changes so an opening modal cancels any in-flight gesture.
- `binding.destroy()` — call on teardown; it removes every listener it added.

## 5. Configure keyboard shortcuts

Studio has exactly one built-in binding: undo/redo on `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z`. Everything else is your declaration:

```ts
const shortcuts = [
  // Canvas keys — active only when overlay === "none":
  { key: "d", run: () => setMode("draw") },
  { key: "e", run: () => setMode("erase") },
  { key: "g", run: toggleGridLines },
  { key: "s", preventDefault: true, run: exportImage },

  // A key that both opens and closes its overlay:
  { key: "/", overlays: ["none", "help"], preventDefault: true, run: toggleHelp },

  // Close keys that work even while a text field inside the overlay has focus:
  { key: "escape", overlays: ["help"], allowInEditable: true, run: closeHelp },
];
```

Semantics:

- `overlays` defaults to `["none"]` — a plain shortcut is automatically dead while any menu or modal is open.
- Shortcuts never fire with Cmd/Ctrl/Alt held, so you can't accidentally shadow copy/paste or browser chords. (`allowInEditable` close-keys are the exception — Escape works regardless of modifiers.)
- Shortcuts never fire while the user types in an editable element, unless `allowInEditable` is set.
- Set `preventDefault` for keys with browser behavior worth suppressing (`/` quick-find in Firefox, `s` in some contexts, etc.).

## 6. Select, move, and drop cells

Selection is opt-in: it costs nothing until you pass `actions.selection` and your policy asks for it. There are two ways to ask, and they compose:

- **`shiftSelects: true`** — Shift selects instead of erasing, in whatever tool the user already has. Shift-drag builds a selection; a plain drag from a selected cell moves it. Nobody changes tools to move pixels.
- **`mode: "select"`** — a dedicated selection tool, where plain clicks select and Shift adds.

Only one piece of state is yours to hold: which cells are selected. The *move* lives in the document as `studio.float`.

```ts
import {
  createSelection,
  selectionHas,
  selectionOutline,
  selectionRegions,
  toggleSelectionCell,
  addSelectionCell,
} from "@chonksxyz/studio";

let selection = createSelection();
```

Wire the selection callbacks alongside your stroke actions:

```ts
actions: {
  /* …beginStroke, updateStroke, … */
  selection: {
    // Pointer down on an unselected cell. Shift adds to the selection;
    // without Shift, a fresh click starts a new one.
    beginSelect: (row, column, additive) => {
      selection = additive
        ? toggleSelectionCell(selection, row, column)
        : createSelection([{ row, column }]);
      render();
    },
    // Dragging across cells paints the selection out.
    extendSelect: (row, column) => {
      selection = addSelectionCell(selection, row, column);
      render();
    },
    // Pointer down on a cell that is already selected: lift the whole thing.
    beginMove: () => studio.liftSelection(selection),
    // Drag offset in cells, measured from the grabbed cell.
    moveTo: (rowOffset, columnOffset) => studio.placeSelection(rowOffset, columnOffset),
    // Dropping can commit on its own — no confirmation step for the common
    // gesture. Leave this as a plain re-render if you want an explicit Apply.
    endMove: () => studio.commitSelection(),
    // Arrow keys. Passing `selection` lifts on the first nudge, so the user can
    // move a selection with the keyboard alone.
    nudge: (rowDelta, columnDelta) => studio.moveSelection(rowDelta, columnDelta, selection),
    // Enter, or your "Apply" button.
    commit: () => {
      studio.commitSelection();
      selection = createSelection();
      render();
    },
    // Delete or Backspace, with cells selected. Omit it and those keys keep
    // their native behaviour.
    delete: () => {
      studio.cancelSelection();
      studio.fillSelection(selection, null);
      selection = createSelection();
      render();
    },
    // Escape, or your "Cancel" button.
    cancel: () => {
      studio.cancelSelection();
      selection = createSelection();
      render();
    },
  },
}
```

What the binding handles: Shift-click and drag to select (Shift never erases where it selects), pointer-drag of an existing selection with capture, arrow keys to nudge, Enter to commit, Escape to cancel, and ending a drag cleanly on blur or an opening overlay — *without* discarding the selection, which is state, not a modifier. Because `commit` and `cancel` are plain callbacks, the same two lines back your toolbar buttons.

Which cells may be selected is your call, not Studio's: the example only lets painted cells in, by checking `studio.getCell(row, column) !== null` inside `beginSelect` and `extendSelect`.

Render the selection from two sources — the cells the user picked, and, while a move is in flight, where they currently sit:

```ts
function render() {
  const live = studio.floatingSelection() ?? selection;

  for (const element of gridElement.children) element.className = "";
  for (const { row, column } of live) cellAt(row, column)?.classList.add("selected");
  // Exterior edges only: no seams between neighbouring cells, and a detached or
  // diagonal cell gets its own ring.
  for (const { row, column, side } of selectionOutline(live)) {
    cellAt(row, column)?.classList.add(`edge-${side}`);
  }
}
```

```css
.selected { transform: scale(1.08); z-index: 1; }  /* lift the picked cells */
.edge-top { box-shadow: inset 0 2px 0 #fff; }      /* one rule per side */
```

`floatingSelection()` includes coordinates that have moved off the canvas — that is the implied delete, and committing drops them. Filter with `selectionWithinGrid(live, SIZE)` if you would rather not iterate them. `selectionRegions` and `isSelectionContiguous` are there when you want to treat a broken-up selection differently (a per-region label, a warning, a different outline color).

One rule to know: a committed float **overwrites** the cells it lands on, and the cells it came from are left empty. Undo restores both in one step.

## 7. Save as an image

```ts
import { saveStudioGridImage, studioGridToDataUrl, drawStudioGrid } from "@chonksxyz/studio";

// One-liner download:
saveStudioGridImage(studio, { scale: 16, fileName: "drawing.png" });

// Data URL for previews or uploads (transparent unless you pass backgroundColor):
const url = studioGridToDataUrl(studio, { scale: 16, backgroundColor: "#f5f5f5" });

// Layered composition on your own canvas:
const canvas = document.createElement("canvas");
canvas.width = SIZE.columns * 16;
canvas.height = SIZE.rows * 16;
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas 2D is unavailable");
drawBackdrop(context);                                // your layers underneath
drawStudioGrid(context, studio, { scale: 16 });       // the drawing on top
```

The image functions accept a `StudioDocument` or any `StudioGrid`. Output size is `columns × scale` by `rows × scale`, one exact rectangle per cell — no seams, no anti-aliasing.

## 8. Persist designs

Serialize your grid however you like (JSON, run-length, a hex colorMap), then let `createDesignStore` own validation, migration, and dedup:

```ts
import { createDesignStore } from "@chonksxyz/studio";

type Saved = { pixels: string };

const store = createDesignStore<Saved>({
  storage: window.localStorage,
  key: "pixelStudio:v1",
  legacyKeys: ["pixelStudio"],
  normalize: (value) => {
    if (typeof value !== "object" || value === null) return null;
    const { pixels } = value as { pixels?: unknown };
    return typeof pixels === "string" && pixels.length > 0 ? { pixels } : null;
  },
  isEqual: (a, b) => a.pixels === b.pixels,
});
```

`normalize` runs on every record both when loading (dropping corrupt entries) and when saving (rejecting invalid designs with a throw). `isEqual` is required so identity follows your design format instead of generic JSON serialization. Bump `key` and move the old one into `legacyKeys` when your format changes — old data migrates and rewrites itself on first load.

The `storage` parameter is any `{ getItem, setItem }` pair, so an in-memory map, IndexedDB facade, or server-backed adapter drops in.

## 9. Test without a browser

Everything is injectable, so the whole editor core runs under `node:test`:

- The document needs no DOM — call its methods and assert on `cells`, `undoDepth`, and the rest.
- `bindStudioInput` accepts fake `grid`/`windowTarget`/`documentTarget` objects that only need `addEventListener`/`removeEventListener` (plus `elementFromPoint` and `visibilityState` on the document). Emit synthetic pointer/keyboard events and assert on the actions received.
- `studioGridToDataUrl` and `saveStudioGridImage` accept a `documentTarget` whose `createElement` returns recording fakes.
- `createDesignStore` takes any storage object.

See this package's `tests/` directory for ready-made fakes covering all four.

## React notes

- Create the document once (`useState(() => new StudioDocument(initialGrid))`) and subscribe with `useSyncExternalStore(studio.subscribe, () => studio.version)`. Every change bumps `version`, so the component re-renders after each one.
- Bind input in a `useEffect` keyed on the grid element ref; return `binding.destroy`. Read policy through a ref (or an effect-event) so the binding installs once instead of re-subscribing per render — listener identity is stable by design. The document's methods are stable, so actions can call them directly.
- Call `binding.syncPolicy()` in a small effect that watches your overlay state.
- Memoize each row on `studio.rowRevision(row)`: only rows whose cells changed get a new revision, so only the row under the cursor re-renders during a stroke.

Chonks Studio's [`hooks/useStudioInput.ts`](https://github.com/backseats/chonks/blob/main/hooks/useStudioInput.ts) and [`components/studio/StudioGrid.tsx`](https://github.com/backseats/chonks/blob/main/components/studio/StudioGrid.tsx) implement exactly this pattern in production.
