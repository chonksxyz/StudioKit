import assert from "node:assert/strict";
import test from "node:test";
import { createGrid, type StudioGrid } from "../src/grid.ts";
import {
  addSelectionCell,
  clearSelection,
  createSelection,
  isSelectionContiguous,
  readSelection,
  removeSelectionCell,
  selectionBounds,
  selectionHas,
  selectionOutline,
  selectionRectangle,
  selectionRegions,
  selectionWithinGrid,
  stampSelection,
  toggleSelectionCell,
  translateSelection,
  type StudioSelection,
} from "../src/selection.ts";

const SIZE = { rows: 4, columns: 4 };

function at(...pairs: Array<[row: number, column: number]>): StudioSelection {
  return pairs.map(([row, column]) => ({ row, column }));
}

function positions(selection: StudioSelection): string[] {
  return selection.map(({ row, column }) => `${row},${column}`);
}

function gridWith(
  ...pixels: Array<[row: number, column: number, color: string]>
): StudioGrid {
  const grid = createGrid(SIZE);
  for (const [row, column, color] of pixels) grid[row][column] = color;
  return grid;
}

test("normalizes selections into deduplicated row-major order", () => {
  const selection = createSelection(
    at([2, 1], [0, 3], [2, 1], [0, 0]).concat([
      { row: 1.5, column: 0 },
      { row: 0, column: Number.NaN },
    ]),
  );

  assert.deepEqual(positions(selection), ["0,0", "0,3", "2,1"]);
  assert.equal(selectionHas(selection, 2, 1), true);
  assert.equal(selectionHas(selection, 1, 1), false);
});

test("adds, removes, and toggles cells without mutating the input", () => {
  const selection = createSelection(at([1, 1]));

  const added = addSelectionCell(selection, 0, 0);
  assert.deepEqual(positions(added), ["0,0", "1,1"]);
  assert.deepEqual(positions(selection), ["1,1"]);
  assert.equal(addSelectionCell(added, 0, 0), added);
  assert.equal(addSelectionCell(added, 0.5, 0), added);

  assert.deepEqual(positions(removeSelectionCell(added, 0, 0)), ["1,1"]);
  assert.equal(removeSelectionCell(added, 3, 3), added);

  assert.deepEqual(positions(toggleSelectionCell(selection, 1, 1)), []);
  assert.deepEqual(positions(toggleSelectionCell(selection, 1, 2)), [
    "1,1",
    "1,2",
  ]);
});

test("builds rectangles from either corner and reports bounds", () => {
  const forward = selectionRectangle({ row: 1, column: 1 }, { row: 2, column: 3 });
  const reversed = selectionRectangle({ row: 2, column: 3 }, { row: 1, column: 1 });

  assert.deepEqual(positions(forward), positions(reversed));
  assert.deepEqual(positions(forward), [
    "1,1",
    "1,2",
    "1,3",
    "2,1",
    "2,2",
    "2,3",
  ]);
  assert.deepEqual(selectionBounds(forward), {
    minRow: 1,
    minColumn: 1,
    maxRow: 2,
    maxColumn: 3,
  });
  assert.equal(selectionBounds([]), null);
  assert.deepEqual(positions(selectionRectangle({ row: 0.5, column: 0 }, { row: 1, column: 1 })), []);
});

test("translates selections and reports which cells stay on the canvas", () => {
  const selection = createSelection(at([0, 0], [0, 1], [1, 0]));

  const moved = translateSelection(selection, -1, 2);
  assert.deepEqual(positions(moved), ["-1,2", "-1,3", "0,2"]);
  assert.deepEqual(positions(selectionWithinGrid(moved, SIZE)), ["0,2"]);
  assert.deepEqual(
    positions(translateSelection(selection, 1.5, 0)),
    positions(selection),
  );
});

test("splits a selection into 4-connected regions", () => {
  const square = createSelection(at([1, 1], [1, 2], [2, 1], [2, 2]));
  assert.equal(selectionRegions(square).length, 1);
  assert.equal(isSelectionContiguous(square), true);

  const diagonal = createSelection(at([0, 0], [1, 1]));
  assert.deepEqual(selectionRegions(diagonal).map(positions), [["0,0"], ["1,1"]]);
  assert.equal(isSelectionContiguous(diagonal), false);

  const detached = createSelection(at([0, 0], [0, 1], [3, 3]));
  assert.deepEqual(selectionRegions(detached).map(positions), [
    ["0,0", "0,1"],
    ["3,3"],
  ]);
  assert.equal(selectionRegions([]).length, 0);
  assert.equal(isSelectionContiguous([]), true);
});

test("outlines only the exterior edges of a shape", () => {
  const pair = createSelection(at([1, 1], [1, 2]));
  const edges = selectionOutline(pair);

  // Six edges around a domino: the shared seam in the middle is omitted.
  assert.equal(edges.length, 6);
  assert.equal(
    edges.some((edge) => edge.row === 1 && edge.column === 1 && edge.side === "right"),
    false,
  );
  assert.equal(
    edges.some((edge) => edge.row === 1 && edge.column === 2 && edge.side === "left"),
    false,
  );
  assert.deepEqual(
    edges.filter((edge) => edge.row === 1 && edge.column === 1).map((edge) => edge.side),
    ["top", "bottom", "left"],
  );

  // A 2x2 square outlines as a ring of eight edges, none of them interior.
  assert.equal(selectionOutline(at([1, 1], [1, 2], [2, 1], [2, 2])).length, 8);
  // Detached cells each keep their own full ring.
  assert.equal(selectionOutline(at([0, 0], [3, 3])).length, 8);
  assert.deepEqual(selectionOutline([]), []);
});

test("reads selected colors and skips coordinates off the grid", () => {
  const grid = gridWith([0, 0, "#aaa"], [1, 1, "#bbb"]);

  assert.deepEqual(readSelection(grid, at([0, 0], [1, 1], [0, 1], [9, 9], [-1, 0])), [
    { row: 0, column: 0, color: "#aaa" },
    { row: 0, column: 1, color: null },
    { row: 1, column: 1, color: "#bbb" },
  ]);
});

test("clears selected cells while keeping untouched rows identical", () => {
  const grid = gridWith([0, 0, "#aaa"], [1, 1, "#bbb"]);
  const cleared = clearSelection(grid, at([0, 0], [9, 9]));

  assert.equal(cleared[0][0], null);
  assert.equal(cleared[1][1], "#bbb");
  assert.equal(cleared[1], grid[1]);
  assert.equal(grid[0][0], "#aaa");
  assert.equal(clearSelection(grid, at([2, 2])), grid);
});

test("stamps contents at an offset, overwriting and dropping off-canvas cells", () => {
  const grid = gridWith([0, 0, "#aaa"], [1, 0, "#bbb"]);
  const contents = readSelection(grid, at([0, 0], [1, 0]));

  const moved = stampSelection(clearSelection(grid, contents), contents, {
    row: 0,
    column: 2,
  });
  assert.equal(moved[0][0], null);
  assert.equal(moved[0][2], "#aaa");
  assert.equal(moved[1][2], "#bbb");

  // Overwrite: the destination color is replaced, not blended.
  const onto = stampSelection(gridWith([0, 1, "#ccc"]), contents, {
    row: 0,
    column: 1,
  });
  assert.equal(onto[0][1], "#aaa");

  // Off-canvas cells are dropped — the implied delete.
  const offCanvas = stampSelection(clearSelection(grid, contents), contents, {
    row: 0,
    column: -1,
  });
  assert.deepEqual(offCanvas[0], [null, null, null, null]);
  assert.deepEqual(offCanvas[1], [null, null, null, null]);

  assert.equal(stampSelection(grid, contents), grid);
  assert.equal(
    stampSelection(grid, contents, { row: 0.5, column: 0 }),
    grid,
  );
});
