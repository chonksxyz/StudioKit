import assert from "node:assert/strict";
import test from "node:test";
import {
  StudioDocument,
  type StudioDocumentAction,
} from "../src/document.ts";
import {
  createGrid,
  gridToRows,
  setCell,
  type StudioCell,
  type StudioGrid,
} from "../src/grid.ts";

const SIZE = { rows: 4, columns: 6 };

function gridWith(
  ...pixels: Array<[row: number, column: number, color: string]>
): StudioGrid {
  const grid = createGrid(SIZE);
  for (const [row, column, color] of pixels) setCell(grid, row, column, color);
  return grid;
}

function documentWith(
  ...pixels: Array<[row: number, column: number, color: string]>
): StudioDocument {
  const document = new StudioDocument(createGrid(SIZE));
  if (pixels.length > 0) document.load(gridWith(...pixels));
  return document;
}

function apply(
  document: StudioDocument,
  ...actions: StudioDocumentAction[]
): StudioDocument {
  for (const action of actions) document.dispatch(action);
  return document;
}

function cell(document: StudioDocument, row: number, column: number): StudioCell | undefined {
  return document.getCell(row, column);
}

const EMPTY_ROWS = gridToRows(createGrid(SIZE));

test("documents adopt the dimensions of their initial grid", () => {
  const document = new StudioDocument(createGrid(SIZE));

  assert.equal(document.rows, SIZE.rows);
  assert.equal(document.columns, SIZE.columns);
  assert.equal(document.cells.length, SIZE.rows * SIZE.columns);
  assert.equal(document.canUndo, false);
  assert.equal(document.canRedo, false);
  assert.equal(document.isPristine, true);
  assert.throws(
    () => new StudioDocument({ rows: 2, columns: 2, cells: [null] }),
    /rectangle/,
  );
});

test("copies the initial grid instead of adopting it", () => {
  const initial = gridWith([0, 0, "#111111"]);
  const document = new StudioDocument(initial);
  setCell(initial, 0, 0, "#ffffff");

  assert.equal(cell(document, 0, 0), "#111111");
});

test("commits an entire stroke as one undoable history entry", () => {
  const document = apply(
    new StudioDocument(createGrid(SIZE)),
    { type: "begin-stroke", row: 1, column: 2, color: "#111111" },
    { type: "update-stroke", row: 1, column: 3, color: "#222222" },
    { type: "commit-stroke" },
  );

  assert.equal(cell(document, 1, 2), "#111111");
  assert.equal(cell(document, 1, 3), "#222222");
  assert.equal(document.undoDepth, 1);
  assert.equal(document.isPristine, false);
  const painted = gridToRows(document);

  assert.equal(document.undo(), true);
  assert.deepEqual(gridToRows(document), EMPTY_ROWS);
  assert.equal(document.canRedo, true);
  assert.equal(document.redo(), true);
  assert.deepEqual(gridToRows(document), painted);
});

test("drops no-op strokes and restores cancelled strokes", () => {
  const document = new StudioDocument(gridWith([2, 2, "#abcdef"]));
  const initial = gridToRows(document);

  apply(
    document,
    { type: "begin-stroke", row: 2, column: 2, color: "#abcdef" },
    { type: "commit-stroke" },
  );
  assert.equal(document.undoDepth, 0);

  apply(
    document,
    { type: "begin-stroke", row: 2, column: 2, color: null },
    { type: "update-stroke", row: 3, column: 2, color: "#123456" },
    { type: "cancel-stroke" },
  );
  assert.deepEqual(gridToRows(document), initial);
  assert.equal(document.undoDepth, 0);
  assert.equal(document.isStroking, false);
});

test("a stroke that paints cells back to their color commits nothing", () => {
  const document = new StudioDocument(createGrid(SIZE));

  document.beginStroke(3, 5, "#111111");
  document.updateStroke(3, 4, "#222222");
  document.updateStroke(3, 5, null);
  document.updateStroke(3, 4, null);
  assert.equal(document.commitStroke(), true);

  assert.equal(document.undoDepth, 0);
  assert.equal(document.isPristine, true);
});

test("starting a stroke commits one still in flight", () => {
  const document = new StudioDocument(createGrid(SIZE));

  document.beginStroke(0, 0, "#111111");
  document.beginStroke(0, 1, "#222222");
  assert.equal(document.undoDepth, 1);
  document.commitStroke();

  assert.equal(document.undoDepth, 2);
  document.undo();
  assert.equal(cell(document, 0, 0), "#111111");
  assert.equal(cell(document, 0, 1), null);
});

test("new edits after undo truncate the redo branch", () => {
  const document = new StudioDocument(createGrid(SIZE));
  apply(
    document,
    { type: "load", grid: gridWith([0, 0, "#111111"]) },
    { type: "load", grid: gridWith([0, 1, "#222222"]) },
    { type: "undo" },
    { type: "begin-stroke", row: 0, column: 2, color: "#333333" },
    { type: "commit-stroke" },
  );

  assert.equal(document.canRedo, false);
  assert.equal(document.undoDepth, 2);
});

test("clear, recolor, load, and affix are atomic and undoable", () => {
  const document = new StudioDocument(gridWith([0, 0, "#111111"]));

  assert.equal(document.recolor("#111111", "#333333"), true);
  assert.equal(cell(document, 0, 0), "#333333");

  assert.equal(document.affix(gridWith([1, 1, "#444444"])), true);
  assert.equal(cell(document, 0, 0), "#333333");
  assert.equal(cell(document, 1, 1), "#444444");
  const affixed = gridToRows(document);

  assert.equal(document.clear(), true);
  assert.deepEqual(gridToRows(document), EMPTY_ROWS);
  assert.equal(document.undoDepth, 3);
  document.undo();
  assert.deepEqual(gridToRows(document), affixed);
});

test("edits that change nothing add no history", () => {
  const document = new StudioDocument(gridWith([0, 0, "#111111"]));
  const version = document.version;

  assert.equal(document.recolor("#222222", "#333333"), false);
  assert.equal(document.recolor("#111111", "#111111"), false);
  assert.equal(document.load(gridWith([0, 0, "#111111"])), false);
  assert.equal(document.affix(createGrid(SIZE)), false);
  assert.equal(document.fillSelection([{ row: 0, column: 0 }], "#111111"), false);
  assert.equal(new StudioDocument(createGrid(SIZE)).clear(), false);
  assert.equal(document.undoDepth, 0);
  assert.equal(document.version, version);
});

test("undoes and redoes edits that rewrite most of the grid", () => {
  const document = new StudioDocument(createGrid(SIZE));
  const full = createGrid(SIZE);
  full.cells.fill("#111111");

  document.load(full);
  document.recolor("#111111", "#222222");
  document.fillSelection([{ row: 0, column: 0 }], "#333333");
  assert.equal(cell(document, 3, 5), "#222222");

  document.undo();
  document.undo();
  assert.equal(document.cells.every((color) => color === "#111111"), true);
  document.undo();
  assert.deepEqual(gridToRows(document), EMPTY_ROWS);
  document.redo();
  document.redo();
  document.redo();
  assert.equal(cell(document, 0, 0), "#333333");
  assert.equal(cell(document, 3, 5), "#222222");
});

test("hydrates only pristine documents and copies incoming grids", () => {
  const hydrationInput = gridWith([3, 3, "#111111"]);
  const document = new StudioDocument(createGrid(SIZE));

  assert.equal(document.hydrate(hydrationInput), true);
  setCell(hydrationInput, 3, 3, "#ffffff");
  assert.equal(cell(document, 3, 3), "#111111");
  assert.equal(document.undoDepth, 0);
  assert.equal(document.isPristine, true);

  document.beginStroke(0, 0, "#222222");
  document.commitStroke();
  assert.equal(document.hydrate(gridWith([0, 1, "#999999"])), false);
  assert.equal(cell(document, 0, 1), null);
});

test("ignores grids whose dimensions do not match the document", () => {
  const document = new StudioDocument(createGrid(SIZE));
  const wrongSize = createGrid({ rows: 2, columns: 2 });
  const ragged = { rows: SIZE.rows, columns: SIZE.columns, cells: [null] };
  const nested = [[null]] as unknown as StudioGrid;

  for (const type of ["hydrate", "load", "affix"] as const) {
    assert.equal(document.dispatch({ type, grid: wrongSize }), false);
    assert.equal(document.dispatch({ type, grid: ragged }), false);
    assert.equal(document.dispatch({ type, grid: nested }), false);
  }
  assert.equal(document.beginStroke(SIZE.rows, 0, "#111111"), false);
  assert.equal(document.beginStroke(0, 0.5, "#111111"), false);
  assert.equal(document.version, 0);
});

test("ignores unknown actions from untyped callers", () => {
  const document = new StudioDocument(createGrid(SIZE));
  const action = { type: "unknown" } as unknown as StudioDocumentAction;

  assert.equal(document.dispatch(action), false);
});

test("version changes on every change and listeners hear about each one", () => {
  const document = new StudioDocument(createGrid(SIZE));
  let heard = 0;
  const unsubscribe = document.subscribe(() => {
    heard += 1;
  });

  document.beginStroke(0, 0, "#111111");
  document.updateStroke(0, 0, "#111111"); // no change
  document.updateStroke(0, 1, "#111111");
  document.commitStroke();
  assert.equal(document.version, 3);
  assert.equal(heard, 3);

  unsubscribe();
  document.undo();
  assert.equal(document.version, 4);
  assert.equal(heard, 3);
});

test("row revisions change only for rows whose cells change", () => {
  const document = new StudioDocument(createGrid(SIZE));
  const revisions = () =>
    Array.from({ length: SIZE.rows }, (_, row) => document.rowRevision(row));

  document.beginStroke(1, 0, "#111111");
  document.updateStroke(1, 1, "#111111");
  document.commitStroke();
  assert.deepEqual(revisions(), [0, 2, 0, 0]);

  document.liftSelection([{ row: 1, column: 0 }]);
  assert.deepEqual(revisions(), [0, 2, 0, 0]); // lifted in place: nothing moved
  document.moveSelection(2, 0);
  assert.deepEqual(revisions(), [0, 3, 0, 1]);
  document.commitSelection();
  assert.deepEqual(revisions(), [0, 3, 0, 1]);

  document.undo();
  assert.deepEqual(revisions(), [0, 4, 0, 2]);
  assert.equal(document.rowRevision(99), 0);
});

test("snapshots are copies that later edits leave alone", () => {
  const document = documentWith([0, 0, "#111111"]);
  const snapshot = document.snapshot();

  document.clear();
  assert.equal(snapshot.cells[0], "#111111");
  assert.equal(cell(document, 0, 0), null);
});

test("moves a lifted selection and commits it as one undo entry", () => {
  const document = documentWith(
    [1, 1, "#aaaaaa"],
    [1, 2, "#bbbbbb"],
    [2, 4, "#cccccc"],
  );
  const depth = document.undoDepth;

  assert.equal(
    document.liftSelection([
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ]),
    true,
  );
  assert.notEqual(document.float, null);
  // A lift at offset zero renders in place — nothing visibly changes yet.
  assert.equal(cell(document, 1, 1), "#aaaaaa");
  assert.equal(cell(document, 1, 2), "#bbbbbb");
  assert.deepEqual(document.floatingSelection(), [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
  ]);

  document.moveSelection(1, 1);
  document.moveSelection(0, 1);
  assert.deepEqual(document.float?.offset, { row: 1, column: 2 });
  assert.equal(cell(document, 2, 3), "#aaaaaa");
  assert.equal(cell(document, 2, 4), "#bbbbbb"); // overwrote the cell underneath
  assert.deepEqual(document.floatingSelection(), [
    { row: 2, column: 3 },
    { row: 2, column: 4 },
  ]);
  assert.equal(document.undoDepth, depth); // still uncommitted

  assert.equal(document.commitSelection(), true);
  assert.equal(document.float, null);
  assert.equal(document.floatingSelection(), null);
  assert.equal(document.undoDepth, depth + 1);
  assert.equal(cell(document, 1, 1), null);
  assert.equal(cell(document, 2, 3), "#aaaaaa");

  document.undo();
  assert.equal(cell(document, 1, 1), "#aaaaaa");
  assert.equal(cell(document, 2, 4), "#cccccc");
});

test("places a selection at an absolute offset while dragging", () => {
  const document = documentWith([0, 0, "#aaaaaa"]);
  document.liftSelection([{ row: 0, column: 0 }]);

  assert.equal(document.placeSelection(2, 3), true);
  assert.equal(cell(document, 2, 3), "#aaaaaa");
  assert.equal(document.placeSelection(2, 3), false);
  assert.equal(document.placeSelection(0.5, 0), false);
  assert.equal(document.moveSelection(Number.NaN, 0), false);
});

test("drags a selection back across cells it passed over", () => {
  const document = documentWith([0, 0, "#aaaaaa"], [0, 3, "#cccccc"]);
  document.liftSelection([{ row: 0, column: 0 }]);

  for (let step = 0; step < 4; step += 1) document.moveSelection(0, 1);
  assert.equal(cell(document, 0, 3), "#cccccc"); // passed over and restored
  assert.equal(cell(document, 0, 4), "#aaaaaa");
  for (let step = 0; step < 4; step += 1) document.moveSelection(0, -1);
  assert.deepEqual(gridToRows(document), gridToRows(gridWith([0, 0, "#aaaaaa"], [0, 3, "#cccccc"])));

  // Back where it started: committing adds no history.
  const depth = document.undoDepth;
  assert.equal(document.commitSelection(), true);
  assert.equal(document.undoDepth, depth);
});

test("deletes the cells a selection carries off the canvas", () => {
  const document = documentWith([0, 0, "#aaaaaa"], [0, 1, "#bbbbbb"]);
  const depth = document.undoDepth;

  apply(
    document,
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

  assert.equal(cell(document, 0, 0), "#bbbbbb");
  assert.equal(cell(document, 0, 1), null);
  assert.equal(document.undoDepth, depth + 1);
});

test("cancels a floating selection back to its baseline", () => {
  for (const action of [
    { type: "cancel-selection" },
    { type: "undo" },
    { type: "redo" },
  ] as const) {
    const document = documentWith([1, 1, "#aaaaaa"]);
    const depth = document.undoDepth;
    apply(
      document,
      { type: "lift-selection", selection: [{ row: 1, column: 1 }] },
      { type: "move-selection", rowDelta: 2, columnDelta: 0 },
      action,
    );

    assert.equal(document.float, null);
    assert.equal(cell(document, 1, 1), "#aaaaaa");
    assert.equal(cell(document, 3, 1), null);
    assert.equal(document.undoDepth, depth);
    assert.equal(document.redoDepth, 0);
  }
});

test("keeps history clean when a lifted selection never moves", () => {
  const document = documentWith([1, 1, "#aaaaaa"]);
  const depth = document.undoDepth;

  assert.equal(document.commitSelection(), false);
  assert.equal(document.cancelSelection(), false);
  document.liftSelection([{ row: 1, column: 1 }]);
  assert.equal(document.commitSelection(), true);

  assert.equal(document.float, null);
  assert.equal(document.undoDepth, depth);
  assert.equal(cell(document, 1, 1), "#aaaaaa");
});

test("ignores empty lifts and refuses to lift twice", () => {
  const document = documentWith([1, 1, "#aaaaaa"]);

  assert.equal(document.liftSelection([]), false);
  assert.equal(document.liftSelection([{ row: 9, column: 9 }]), false);
  assert.equal(document.liftSelection([{ row: 1, column: 1 }]), true);
  assert.equal(document.liftSelection([{ row: 0, column: 0 }]), false);
});

test("lifting cancels an in-flight stroke and strokes wait for the float", () => {
  const document = new StudioDocument(createGrid(SIZE));
  document.beginStroke(0, 0, "#aaaaaa");

  document.liftSelection([{ row: 2, column: 2 }]);
  assert.equal(document.isStroking, false);
  assert.equal(cell(document, 0, 0), null);
  assert.equal(document.beginStroke(3, 3, "#bbbbbb"), false);
});

test("atomic edits drop a floating selection at its current position", () => {
  const document = documentWith([1, 1, "#aaaaaa"]);
  document.liftSelection([{ row: 1, column: 1 }]);
  document.moveSelection(1, 0);

  document.clear();
  assert.equal(document.float, null);
  assert.equal(cell(document, 2, 1), null);
  document.undo(); // undoes to the pre-lift grid
  assert.equal(cell(document, 1, 1), "#aaaaaa");
  assert.equal(cell(document, 2, 1), null);

  const pristine = new StudioDocument(createGrid(SIZE));
  pristine.liftSelection([{ row: 0, column: 0 }]);
  assert.equal(pristine.hydrate(gridWith([0, 0, "#bbbbbb"])), false);
  assert.equal(cell(pristine, 0, 0), null);
});

test("lifts on the first nudge so arrow keys work without a drag", () => {
  const document = documentWith([1, 1, "#aaaaaa"]);
  const selection = [{ row: 1, column: 1 }];

  assert.equal(document.moveSelection(1, 0), false);
  document.moveSelection(1, 0, selection);
  document.moveSelection(1, 0, selection);

  assert.deepEqual(document.float?.offset, { row: 2, column: 0 });
  assert.deepEqual(document.float?.contents, [
    { row: 1, column: 1, color: "#aaaaaa" },
  ]);
  assert.equal(cell(document, 3, 1), "#aaaaaa");
  assert.equal(cell(document, 1, 1), null);
});

test("recolors a selection as one undoable edit", () => {
  const document = documentWith(
    [1, 1, "#aaaaaa"],
    [1, 2, "#bbbbbb"],
    [2, 2, "#cccccc"],
  );
  const before = gridToRows(document);
  const depth = document.undoDepth;
  const selection = [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
  ];

  assert.equal(document.fillSelection(selection, "#dddddd"), true);
  assert.equal(cell(document, 1, 1), "#dddddd");
  assert.equal(cell(document, 1, 2), "#dddddd");
  assert.equal(cell(document, 2, 2), "#cccccc");
  assert.equal(document.undoDepth, depth + 1);

  // Filling with the color already there is not an edit, nor is filling nothing.
  assert.equal(document.fillSelection(selection, "#dddddd"), false);
  assert.equal(document.fillSelection([], "#eeeeee"), false);

  document.undo();
  assert.deepEqual(gridToRows(document), before);
});

test("recolors a floating selection without ending the move", () => {
  const document = documentWith([1, 1, "#aaaaaa"]);
  const before = gridToRows(document);
  const depth = document.undoDepth;
  const selection = [{ row: 1, column: 1 }];

  document.liftSelection(selection);
  document.moveSelection(1, 1);
  document.fillSelection(selection, "#dddddd");

  // Still in flight, in the new color, and no history entry of its own.
  assert.notEqual(document.float, null);
  assert.equal(cell(document, 2, 2), "#dddddd");
  assert.equal(cell(document, 1, 1), null);
  assert.equal(document.undoDepth, depth);

  document.commitSelection();
  assert.equal(cell(document, 2, 2), "#dddddd");
  assert.equal(document.undoDepth, depth + 1);
  document.undo();
  assert.deepEqual(gridToRows(document), before);
});
