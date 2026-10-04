import assert from "node:assert/strict";
import test from "node:test";
import {
  cellIndex,
  cloneGrid,
  createGrid,
  getCell,
  getGridSize,
  gridFromRows,
  gridsEqual,
  gridToRows,
  mergeGrids,
  sameGridSize,
  setCell,
} from "../src/grid.ts";

test("creates rectangular grids of any dimensions", () => {
  const grid = createGrid({ rows: 3, columns: 5 });

  assert.deepEqual(getGridSize(grid), { rows: 3, columns: 5 });
  assert.equal(grid.cells.length, 15);
  assert.equal(grid.cells.every((cell) => cell === null), true);
  assert.throws(() => createGrid({ rows: 0, columns: 5 }), /positive integer/);
  assert.throws(() => createGrid({ rows: 2.5, columns: 5 }), /positive integer/);
});

test("rejects grids whose cells do not fill the rectangle", () => {
  assert.throws(() => getGridSize({ rows: 0, columns: 0, cells: [] }), /non-empty rectangle/);
  assert.throws(() => getGridSize({ rows: 2, columns: 2, cells: [null] }), /non-empty rectangle/);
  assert.throws(() => getGridSize({ rows: 1.5, columns: 2, cells: [null, null, null] }), /non-empty rectangle/);
});

test("converts between flat grids and nested rows", () => {
  const grid = gridFromRows([
    ["#111111", null, null],
    [null, null, "#222222"],
  ]);

  assert.deepEqual(grid, {
    rows: 2,
    columns: 3,
    cells: ["#111111", null, null, null, null, "#222222"],
  });
  assert.deepEqual(gridToRows(grid), [
    ["#111111", null, null],
    [null, null, "#222222"],
  ]);
  assert.throws(() => gridFromRows([]), /non-empty rectangle/);
  assert.throws(() => gridFromRows([[]]), /non-empty rectangle/);
  assert.throws(() => gridFromRows([[null, null], [null]]), /non-empty rectangle/);
});

test("reads and writes cells by coordinate, ignoring anything off the grid", () => {
  const grid = createGrid({ rows: 2, columns: 3 });

  assert.equal(cellIndex(grid, 1, 2), 5);
  assert.equal(cellIndex(grid, 2, 0), -1);
  assert.equal(cellIndex(grid, 0, 0.5), -1);
  assert.equal(setCell(grid, 1, 2, "#abcdef"), true);
  assert.equal(setCell(grid, 1, 2, "#abcdef"), false);
  assert.equal(setCell(grid, -1, 0, "#abcdef"), false);
  assert.equal(getCell(grid, 1, 2), "#abcdef");
  assert.equal(getCell(grid, 0, 0), null);
  assert.equal(getCell(grid, 0, 3), undefined);
});

test("clones grids without sharing cells", () => {
  const grid = createGrid({ rows: 2, columns: 2 });
  setCell(grid, 0, 0, "#112233");
  const cloned = cloneGrid(grid);
  setCell(cloned, 0, 0, "#445566");

  assert.equal(getCell(grid, 0, 0), "#112233");
  assert.equal(gridsEqual(grid, cloned), false);
});

test("compares grids by dimensions and cells", () => {
  const left = createGrid({ rows: 2, columns: 3 });
  const right = createGrid({ rows: 2, columns: 3 });
  assert.equal(gridsEqual(left, right), true);

  setCell(right, 1, 2, "#abcdef");
  assert.equal(gridsEqual(left, right), false);
  assert.equal(sameGridSize(left, right), true);
  assert.equal(gridsEqual(left, createGrid({ rows: 3, columns: 2 })), false);
});

test("merges grids with overlay pixels winning", () => {
  const base = gridFromRows([
    ["#111111", null],
    [null, "#222222"],
  ]);
  const overlay = gridFromRows([
    ["#333333", null],
    [null, null],
  ]);

  assert.deepEqual(gridToRows(mergeGrids(base, overlay)), [
    ["#333333", null],
    [null, "#222222"],
  ]);
  assert.throws(
    () => mergeGrids(base, createGrid({ rows: 3, columns: 2 })),
    /share dimensions/,
  );
});
