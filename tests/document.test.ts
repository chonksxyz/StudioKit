import assert from "node:assert/strict";
import test from "node:test";
import {
  canRedo,
  canUndo,
  createStudioDocument,
  studioDocumentReducer,
  type StudioDocumentAction,
  type StudioDocumentState,
} from "../src/document.ts";
import { createGrid, type StudioGrid } from "../src/grid.ts";

const SIZE = { rows: 4, columns: 6 };

function reduce(
  state: StudioDocumentState,
  ...actions: StudioDocumentAction[]
): StudioDocumentState {
  return actions.reduce(studioDocumentReducer, state);
}

function gridWith(
  ...pixels: Array<[row: number, column: number, color: string]>
): StudioGrid {
  const grid = createGrid(SIZE);
  for (const [row, column, color] of pixels) grid[row][column] = color;
  return grid;
}

test("documents adopt the dimensions of their initial grid", () => {
  const state = createStudioDocument(createGrid(SIZE));

  assert.equal(state.grid.length, SIZE.rows);
  assert.equal(state.grid[0].length, SIZE.columns);
  assert.equal(canUndo(state), false);
  assert.equal(canRedo(state), false);
  assert.throws(() => createStudioDocument([[null], []]), /rectangle/);
});

test("commits an entire stroke as one undoable history entry", () => {
  const state = reduce(
    createStudioDocument(createGrid(SIZE)),
    { type: "begin-stroke", row: 1, column: 2, color: "#111111" },
    { type: "update-stroke", row: 1, column: 3, color: "#222222" },
    { type: "commit-stroke" },
  );

  assert.equal(state.grid[1][2], "#111111");
  assert.equal(state.grid[1][3], "#222222");
  assert.equal(state.past.length, 1);

  const undone = studioDocumentReducer(state, { type: "undo" });
  assert.deepEqual(undone.grid, createGrid(SIZE));
  assert.equal(canRedo(undone), true);
  assert.deepEqual(
    studioDocumentReducer(undone, { type: "redo" }).grid,
    state.grid,
  );
});

test("drops no-op strokes and restores cancelled strokes", () => {
  const initial = createStudioDocument(gridWith([2, 2, "#abcdef"]));
  const noOp = reduce(
    initial,
    { type: "begin-stroke", row: 2, column: 2, color: "#abcdef" },
    { type: "commit-stroke" },
  );
  assert.equal(noOp.past.length, 0);

  const cancelled = reduce(
    noOp,
    { type: "begin-stroke", row: 2, column: 2, color: null },
    { type: "update-stroke", row: 3, column: 2, color: "#123456" },
    { type: "cancel-stroke" },
  );
  assert.deepEqual(cancelled.grid, initial.grid);
  assert.equal(cancelled.past.length, 0);
});

test("tracks changed cells without rescanning the stroke baseline", () => {
  const initial = createStudioDocument(createGrid(SIZE));
  const oneChanged = studioDocumentReducer(initial, {
    type: "begin-stroke",
    row: 3,
    column: 5,
    color: "#111111",
  });
  assert.equal(oneChanged.stroke?.changedCells, 1);

  const twoChanged = studioDocumentReducer(oneChanged, {
    type: "update-stroke",
    row: 3,
    column: 4,
    color: "#222222",
  });
  assert.equal(twoChanged.stroke?.changedCells, 2);

  const oneReverted = studioDocumentReducer(twoChanged, {
    type: "update-stroke",
    row: 3,
    column: 5,
    color: null,
  });
  assert.equal(oneReverted.stroke?.changedCells, 1);

  const fullyReverted = studioDocumentReducer(oneReverted, {
    type: "update-stroke",
    row: 3,
    column: 4,
    color: null,
  });
  assert.equal(fullyReverted.stroke?.changedCells, 0);
  assert.equal(
    studioDocumentReducer(fullyReverted, { type: "commit-stroke" }).past.length,
    0,
  );
});

test("new edits after undo truncate the redo branch", () => {
  const state = reduce(
    createStudioDocument(createGrid(SIZE)),
    { type: "load", grid: gridWith([0, 0, "#111111"]) },
    { type: "load", grid: gridWith([0, 1, "#222222"]) },
    { type: "undo" },
    { type: "begin-stroke", row: 0, column: 2, color: "#333333" },
    { type: "commit-stroke" },
  );

  assert.equal(canRedo(state), false);
  assert.equal(state.past.length, 2);
});

test("clear, recolor, load, and affix are atomic and undoable", () => {
  const initial = createStudioDocument(gridWith([0, 0, "#111111"]));
  const recolored = studioDocumentReducer(initial, {
    type: "recolor",
    from: "#111111",
    to: "#333333",
  });
  assert.equal(recolored.grid[0][0], "#333333");

  const affixed = studioDocumentReducer(recolored, {
    type: "affix",
    grid: gridWith([1, 1, "#444444"]),
  });
  assert.equal(affixed.grid[0][0], "#333333");
  assert.equal(affixed.grid[1][1], "#444444");

  const cleared = studioDocumentReducer(affixed, { type: "clear" });
  assert.deepEqual(cleared.grid, createGrid(SIZE));
  assert.equal(cleared.past.length, 3);
  assert.deepEqual(
    studioDocumentReducer(cleared, { type: "undo" }).grid,
    affixed.grid,
  );
});

test("avoids allocating history for no-op recolors", () => {
  const initial = createStudioDocument(gridWith([0, 0, "#111111"]));

  assert.equal(
    studioDocumentReducer(initial, {
      type: "recolor",
      from: "#222222",
      to: "#333333",
    }),
    initial,
  );
  assert.equal(
    studioDocumentReducer(initial, {
      type: "recolor",
      from: "#111111",
      to: "#111111",
    }),
    initial,
  );
});

test("hydrates only pristine documents and clones incoming grids", () => {
  const hydrationInput = gridWith([3, 3, "#111111"]);
  const hydrated = studioDocumentReducer(
    createStudioDocument(createGrid(SIZE)),
    { type: "hydrate", grid: hydrationInput },
  );
  hydrationInput[3][3] = "#ffffff";
  assert.equal(hydrated.grid[3][3], "#111111");
  assert.equal(hydrated.past.length, 0);

  const edited = reduce(
    hydrated,
    { type: "begin-stroke", row: 0, column: 0, color: "#222222" },
    { type: "commit-stroke" },
  );
  assert.equal(
    studioDocumentReducer(edited, {
      type: "hydrate",
      grid: gridWith([0, 1, "#999999"]),
    }),
    edited,
  );
});

test("ignores grids whose dimensions do not match the document", () => {
  const state = createStudioDocument(createGrid(SIZE));
  const wrongSize = createGrid({ rows: 2, columns: 2 });
  const ragged = [[null]] as StudioGrid;

  for (const type of ["hydrate", "load", "affix"] as const) {
    assert.equal(studioDocumentReducer(state, { type, grid: wrongSize }), state);
    assert.equal(studioDocumentReducer(state, { type, grid: ragged }), state);
  }
  assert.equal(
    studioDocumentReducer(state, {
      type: "begin-stroke",
      row: SIZE.rows,
      column: 0,
      color: "#111111",
    }),
    state,
  );
});

test("ignores unknown actions from untyped callers", () => {
  const state = createStudioDocument(createGrid(SIZE));
  const action = { type: "unknown" } as unknown as StudioDocumentAction;

  assert.equal(studioDocumentReducer(state, action), state);
});
