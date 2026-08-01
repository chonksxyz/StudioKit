import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneGrid,
  createGrid,
  getGridSize,
  gridsEqual,
  mergeGrids,
  sameGridSize,
} from "../src/grid.ts";

test("creates rectangular grids of any dimensions", () => {
  const grid = createGrid({ rows: 3, columns: 5 });

  assert.deepEqual(getGridSize(grid), { rows: 3, columns: 5 });
  assert.equal(grid.every((row) => row.every((cell) => cell === null)), true);
  assert.throws(() => createGrid({ rows: 0, columns: 5 }), /positive integer/);
  assert.throws(() => createGrid({ rows: 2.5, columns: 5 }), /positive integer/);
});

test("rejects ragged and empty grids", () => {
  assert.throws(() => getGridSize([]), /non-empty rectangle/);
  assert.throws(() => getGridSize([[]]), /non-empty rectangle/);
  assert.throws(
    () => getGridSize([[null, null], [null]]),
    /non-empty rectangle/,
  );
});

test("clones grids without sharing row references", () => {
  const grid = createGrid({ rows: 2, columns: 2 });
  grid[0][0] = "#112233";

  const cloned = cloneGrid(grid);
  cloned[0][0] = "#445566";

  assert.equal(grid[0][0], "#112233");
  assert.equal(gridsEqual(grid, cloned), false);
});

test("compares grids by dimensions and cells", () => {
  const left = createGrid({ rows: 2, columns: 3 });
  const right = createGrid({ rows: 2, columns: 3 });
  assert.equal(gridsEqual(left, right), true);

  right[1][2] = "#abcdef";
  assert.equal(gridsEqual(left, right), false);
  assert.equal(sameGridSize(left, right), true);
  assert.equal(gridsEqual(left, createGrid({ rows: 3, columns: 2 })), false);
});

test("merges grids with overlay pixels winning", () => {
  const base = createGrid({ rows: 2, columns: 2 });
  base[0][0] = "#111111";
  base[1][1] = "#222222";
  const overlay = createGrid({ rows: 2, columns: 2 });
  overlay[0][0] = "#333333";

  const merged = mergeGrids(base, overlay);

  assert.equal(merged[0][0], "#333333");
  assert.equal(merged[1][1], "#222222");
  assert.throws(
    () => mergeGrids(base, createGrid({ rows: 3, columns: 2 })),
    /share dimensions/,
  );
});
