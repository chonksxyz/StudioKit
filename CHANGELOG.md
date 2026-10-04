# Changelog

## 0.3.0

0.3 replaces the immutable reducer with a mutable `StudioDocument` and stores grids in one flat array. Every edit behaves exactly as it did in 0.2 — the same history entries, the same no-ops, the same selection rules — but the API you call it through is new. Code that uses only `input`, `image`, or `storage` with plain grids still needs the grid-shape change below.

### Breaking changes

**Grids are flat.** A `StudioGrid` was `(string | null)[][]`. It is now an object with one row-major array:

```ts
// 0.2
const color = grid[row][column];

// 0.3
type StudioGrid = { rows: number; columns: number; cells: (string | null)[] };
const color = getCell(grid, row, column); // or grid.cells[row * grid.columns + column]
```

Convert grids saved by 0.2 with `gridFromRows(rows)`; go back with `gridToRows(grid)`. `getGridSize` now checks that `cells.length === rows * columns` instead of checking row lengths.

**The reducer is gone; use `StudioDocument`.** These exports were removed: `createStudioDocument`, `studioDocumentReducer`, `canUndo`, `canRedo`, `getFloatingSelection`, and the `StudioDocumentState` type.

| 0.2 | 0.3 |
| --- | --- |
| `createStudioDocument(grid)` | `new StudioDocument(grid)` |
| `state = studioDocumentReducer(state, action)` | `studio.dispatch(action)`, or the matching method, e.g. `studio.beginStroke(row, column, color)` |
| `state.grid` | `studio.cells` (live, read-only) or `studio.snapshot()` (a copy) |
| `canUndo(state)`, `canRedo(state)` | `studio.canUndo`, `studio.canRedo` |
| `state.past.length`, `state.future.length` | `studio.undoDepth`, `studio.redoDepth` |
| `state.float` | `studio.float` |
| `getFloatingSelection(state)` | `studio.floatingSelection()` |
| `state.stroke !== null` | `studio.isStroking` |
| `state.isPristine` | `studio.isPristine` |

`state.stroke.changedCells` and the `past`/`future` grid arrays have no replacement: history now stores only the cells each step changed.

The action objects are unchanged, so an existing `dispatch({ type: "begin-stroke", … })` call site keeps working once it calls `studio.dispatch`. Actions that carry a grid (`hydrate`, `load`, `affix`) take the new flat grid.

**The document changes in place, so detect changes with counters, not identity.** In 0.2 a new state object meant something changed, and an unchanged row kept its identity. In 0.3 the document object and its `cells` array stay the same:

- `studio.version` increments on every change; `studio.subscribe(listener)` calls you after each one and returns an unsubscribe function. In React: `useSyncExternalStore(studio.subscribe, () => studio.version)`.
- `studio.rowRevision(row)` increments only when a cell in that row changes. Memoize rendered rows on it instead of on `grid[row]`.
- Every method returns `true` when it changed something, where 0.2 returned the same state object for a no-op.

**`fillSelection`, `clearSelection`, and `stampSelection` edit the grid in place** and return whether any cell changed. In 0.2 they returned a new grid. Copy first (`cloneGrid`) if you need the original, or use the document's `fillSelection(selection, color)`, which records history. To delete selected cells, `studio.fillSelection(selection, null)` replaces 0.2's `load` of `clearSelection(state.grid, selection)`.

**The image functions take any grid-shaped object**, so pass the document itself: `saveStudioGridImage(studio, options)`.

### Added

- `StudioDocument`, with `version`, `subscribe`, `rowRevision`, `getCell`, `snapshot`, `undoDepth`, `redoDepth`, and a method per action.
- `gridFromRows`, `gridToRows`, `getCell`, `setCell`, `cellIndex`, `cellsEqual`, and the `ReadonlyStudioGrid` type.

### Performance

Painting a pixel is one write instead of copying its row and the grid's row array, and undo history stores only changed cells. At 30×30, measured on Node 22:

- Painting, undo/redo of strokes, dragging a selection, `selectionOutline`, `selectionRegions`, and `createSelection` are 1.3–7× faster.
- `recolor` plus its undo is about 3× slower (about 20 µs instead of 7 µs). 0.2 undid it by swapping back a shared grid; 0.3 copies and compares the grid. It is a single click, far below a frame.

If your renderer needs immutable, nested rows (as 0.2 provided), building them from `rowRevision` adds roughly 0.2 µs per change at 30×30 — comparable to what the 0.2 reducer cost per change.

## 0.2.0

- Multi-cell selection: shift-click and drag to select, drag or arrow keys to move, Enter or drop to commit, Escape to cancel, Delete or Backspace to empty.
- `shiftSelects` policy flag: Shift selects instead of erasing.
- `fill-selection` recolors a selection, including one in flight.
- Fast strokes fill the cells between pointer samples instead of dropping or reverting pixels.
- An example app in `examples/pixel-studio`.
- Git installs build `dist/` through the `prepare` script.

## 0.1.1

- Hardened grid, document, input, and storage edge cases.
- Added a default `exports` condition.
