import assert from "node:assert/strict";
import test from "node:test";
import {
  canRedo,
  canUndo,
  createStudioDocument,
  getFloatingSelection,
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

test("moves a lifted selection and commits it as one undo entry", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"], [1, 2, "#bbbbbb"], [2, 4, "#cccccc"]),
  });

  const lifted = reduce(state, {
    type: "lift-selection",
    selection: [
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ],
  });
  assert.notEqual(lifted.float, null);
  // A lift at offset zero renders in place — nothing visibly changes yet.
  assert.equal(lifted.grid[1][1], "#aaaaaa");
  assert.equal(lifted.grid[1][2], "#bbbbbb");
  assert.deepEqual(getFloatingSelection(lifted), [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
  ]);

  const moved = reduce(
    lifted,
    { type: "move-selection", rowDelta: 1, columnDelta: 1 },
    { type: "move-selection", rowDelta: 0, columnDelta: 1 },
  );
  assert.deepEqual(moved.float?.offset, { row: 1, column: 2 });
  assert.equal(moved.grid[2][3], "#aaaaaa");
  assert.equal(moved.grid[2][4], "#bbbbbb"); // overwrote the cell underneath
  assert.deepEqual(getFloatingSelection(moved), [
    { row: 2, column: 3 },
    { row: 2, column: 4 },
  ]);
  assert.equal(moved.past.length, state.past.length); // still uncommitted

  const committed = reduce(moved, { type: "commit-selection" });
  assert.equal(committed.float, null);
  assert.equal(getFloatingSelection(committed), null);
  assert.equal(committed.past.length, state.past.length + 1);
  assert.equal(committed.grid[1][1], null);
  assert.equal(committed.grid[2][3], "#aaaaaa");

  const undone = reduce(committed, { type: "undo" });
  assert.equal(undone.grid[1][1], "#aaaaaa");
  assert.equal(undone.grid[2][4], "#cccccc");
});

test("places a selection at an absolute offset while dragging", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([0, 0, "#aaaaaa"]),
  });
  const lifted = reduce(state, {
    type: "lift-selection",
    selection: [{ row: 0, column: 0 }],
  });

  const placed = reduce(lifted, {
    type: "place-selection",
    rowOffset: 2,
    columnOffset: 3,
  });
  assert.equal(placed.grid[2][3], "#aaaaaa");
  assert.equal(
    studioDocumentReducer(placed, {
      type: "place-selection",
      rowOffset: 2,
      columnOffset: 3,
    }),
    placed,
  );
  assert.equal(
    studioDocumentReducer(placed, {
      type: "place-selection",
      rowOffset: 0.5,
      columnOffset: 0,
    }),
    placed,
  );
  assert.equal(
    studioDocumentReducer(placed, {
      type: "move-selection",
      rowDelta: Number.NaN,
      columnDelta: 0,
    }),
    placed,
  );
});

test("deletes the cells a selection carries off the canvas", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([0, 0, "#aaaaaa"], [0, 1, "#bbbbbb"]),
  });

  const committed = reduce(
    state,
    {
      type: "lift-selection",
      selection: [
        { row: 0, column: 0 },
        { row: 0, column: 1 },
      ],
    },
    { type: "move-selection", rowDelta: 0, columnDelta: -1 },
    { type: "commit-selection" },
  );

  assert.equal(committed.grid[0][0], "#bbbbbb");
  assert.equal(committed.grid[0][1], null);
  assert.equal(committed.past.length, state.past.length + 1);
});

test("cancels a floating selection back to its baseline", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"]),
  });

  for (const action of [
    { type: "cancel-selection" },
    { type: "undo" },
    { type: "redo" },
  ] as const) {
    const cancelled = reduce(
      state,
      {
        type: "lift-selection",
        selection: [{ row: 1, column: 1 }],
      },
      { type: "move-selection", rowDelta: 2, columnDelta: 0 },
      action,
    );

    assert.equal(cancelled.float, null);
    assert.equal(cancelled.grid[1][1], "#aaaaaa");
    assert.equal(cancelled.grid[3][1], null);
    assert.equal(cancelled.past.length, state.past.length);
    assert.equal(cancelled.future.length, 0);
  }
});

test("keeps history clean when a lifted selection never moves", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"]),
  });

  const committed = reduce(
    state,
    { type: "lift-selection", selection: [{ row: 1, column: 1 }] },
    { type: "commit-selection" },
  );

  assert.equal(committed.float, null);
  assert.equal(committed.past.length, state.past.length);
  assert.equal(committed.grid[1][1], "#aaaaaa");
  assert.equal(studioDocumentReducer(state, { type: "commit-selection" }), state);
  assert.equal(studioDocumentReducer(state, { type: "cancel-selection" }), state);
});

test("ignores empty lifts and refuses to lift twice", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"]),
  });

  assert.equal(
    studioDocumentReducer(state, { type: "lift-selection", selection: [] }),
    state,
  );
  assert.equal(
    studioDocumentReducer(state, {
      type: "lift-selection",
      selection: [{ row: 9, column: 9 }],
    }),
    state,
  );

  const lifted = reduce(state, {
    type: "lift-selection",
    selection: [{ row: 1, column: 1 }],
  });
  assert.equal(
    studioDocumentReducer(lifted, {
      type: "lift-selection",
      selection: [{ row: 0, column: 0 }],
    }),
    lifted,
  );
});

test("lifting cancels an in-flight stroke and strokes wait for the float", () => {
  const state = createStudioDocument(createGrid(SIZE));
  const drafting = reduce(state, {
    type: "begin-stroke",
    row: 0,
    column: 0,
    color: "#aaaaaa",
  });

  const lifted = reduce(drafting, {
    type: "lift-selection",
    selection: [{ row: 2, column: 2 }],
  });
  assert.equal(lifted.stroke, null);
  assert.equal(lifted.grid[0][0], null);

  assert.equal(
    studioDocumentReducer(lifted, {
      type: "begin-stroke",
      row: 3,
      column: 3,
      color: "#bbbbbb",
    }),
    lifted,
  );
});

test("atomic edits drop a floating selection at its current position", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"]),
  });
  const moved = reduce(
    state,
    { type: "lift-selection", selection: [{ row: 1, column: 1 }] },
    { type: "move-selection", rowDelta: 1, columnDelta: 0 },
  );

  const cleared = reduce(moved, { type: "clear" });
  assert.equal(cleared.float, null);
  assert.equal(cleared.past.at(-1)?.[1][1], "#aaaaaa"); // undoes to pre-lift
  assert.equal(cleared.grid[2][1], null);

  const hydrated = studioDocumentReducer(
    reduce(createStudioDocument(createGrid(SIZE)), {
      type: "lift-selection",
      selection: [{ row: 0, column: 0 }],
    }),
    { type: "hydrate", grid: gridWith([0, 0, "#bbbbbb"]) },
  );
  assert.equal(hydrated.grid[0][0], null);
});

test("lifts on the first nudge so arrow keys work without a drag", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"]),
  });
  const selection = [{ row: 1, column: 1 }];

  const nudged = reduce(
    state,
    { type: "move-selection", rowDelta: 1, columnDelta: 0, selection },
    { type: "move-selection", rowDelta: 1, columnDelta: 0, selection },
  );

  assert.deepEqual(nudged.float?.offset, { row: 2, column: 0 });
  assert.deepEqual(nudged.float?.contents, [
    { row: 1, column: 1, color: "#aaaaaa" },
  ]);
  assert.equal(nudged.grid[3][1], "#aaaaaa");
  assert.equal(nudged.grid[1][1], null);
  assert.equal(
    studioDocumentReducer(state, { type: "move-selection", rowDelta: 1, columnDelta: 0 }),
    state,
  );
});

test("recolors a selection as one undoable edit", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"], [1, 2, "#bbbbbb"], [2, 2, "#cccccc"]),
  });
  const selection = [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
  ];

  const filled = reduce(state, {
    type: "fill-selection",
    selection,
    color: "#dddddd",
  });
  assert.equal(filled.grid[1][1], "#dddddd");
  assert.equal(filled.grid[1][2], "#dddddd");
  assert.equal(filled.grid[2][2], "#cccccc");
  assert.equal(filled.past.length, state.past.length + 1);
  assert.deepEqual(
    studioDocumentReducer(filled, { type: "undo" }).grid,
    state.grid,
  );

  // Filling with the color already there is not an edit.
  assert.equal(
    studioDocumentReducer(filled, {
      type: "fill-selection",
      selection,
      color: "#dddddd",
    }),
    filled,
  );
  // Nor is filling nothing.
  assert.equal(
    studioDocumentReducer(filled, {
      type: "fill-selection",
      selection: [],
      color: "#eeeeee",
    }),
    filled,
  );
});

test("recolors a floating selection without ending the move", () => {
  const state = reduce(createStudioDocument(createGrid(SIZE)), {
    type: "load",
    grid: gridWith([1, 1, "#aaaaaa"]),
  });
  const selection = [{ row: 1, column: 1 }];

  const floating = reduce(
    state,
    { type: "lift-selection", selection },
    { type: "move-selection", rowDelta: 1, columnDelta: 1 },
    { type: "fill-selection", selection, color: "#dddddd" },
  );

  // Still in flight, in the new color, and no history entry of its own.
  assert.notEqual(floating.float, null);
  assert.equal(floating.grid[2][2], "#dddddd");
  assert.equal(floating.grid[1][1], null);
  assert.equal(floating.past.length, state.past.length);

  const committed = reduce(floating, { type: "commit-selection" });
  assert.equal(committed.grid[2][2], "#dddddd");
  assert.equal(committed.past.length, state.past.length + 1);
  assert.deepEqual(
    studioDocumentReducer(committed, { type: "undo" }).grid,
    state.grid,
  );
});
