export type StudioCell = string | null;
export type StudioGridSize = { rows: number; columns: number };

/**
 * A rectangular grid of cells stored row-major in one flat array: the cell at
 * `(row, column)` is `cells[row * columns + column]`.
 */
export type StudioGrid = {
  rows: number;
  columns: number;
  cells: StudioCell[];
};

/** Anything grid-shaped Studio can read — a `StudioGrid` or a `StudioDocument`. */
export type ReadonlyStudioGrid = {
  readonly rows: number;
  readonly columns: number;
  readonly cells: readonly StudioCell[];
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function getGridSize(grid: ReadonlyStudioGrid): StudioGridSize {
  const { rows, columns, cells } = grid;
  if (
    !isPositiveInteger(rows) ||
    !isPositiveInteger(columns) ||
    !Array.isArray(cells) ||
    cells.length !== rows * columns
  ) {
    throw new Error("Studio grid must be a non-empty rectangle");
  }
  return { rows, columns };
}

export function createGrid({ rows, columns }: StudioGridSize): StudioGrid {
  if (!isPositiveInteger(rows) || !isPositiveInteger(columns)) {
    throw new Error("Studio grid size must use positive integer dimensions");
  }
  return { rows, columns, cells: Array<StudioCell>(rows * columns).fill(null) };
}

/** Build a grid from nested rows, e.g. a design saved by Studio 0.2. */
export function gridFromRows(
  rows: readonly (readonly StudioCell[])[],
): StudioGrid {
  const columns = rows[0]?.length ?? 0;
  if (
    rows.length === 0 ||
    columns === 0 ||
    rows.some((row) => row.length !== columns)
  ) {
    throw new Error("Studio grid must be a non-empty rectangle");
  }
  return { rows: rows.length, columns, cells: rows.flat() };
}

/** Nested rows, for serialization or code that wants `grid[row][column]`. */
export function gridToRows(grid: ReadonlyStudioGrid): StudioCell[][] {
  const { rows, columns } = getGridSize(grid);
  return Array.from({ length: rows }, (_, row) =>
    grid.cells.slice(row * columns, (row + 1) * columns),
  );
}

export function cloneGrid(grid: ReadonlyStudioGrid): StudioGrid {
  const { rows, columns } = getGridSize(grid);
  return { rows, columns, cells: grid.cells.slice() };
}

/** Flat index of a coordinate, or -1 when it is off the grid. */
export function cellIndex(
  grid: ReadonlyStudioGrid,
  row: number,
  column: number,
): number {
  return Number.isInteger(row) &&
    Number.isInteger(column) &&
    row >= 0 &&
    row < grid.rows &&
    column >= 0 &&
    column < grid.columns
    ? row * grid.columns + column
    : -1;
}

/** The cell at a coordinate, or `undefined` when it is off the grid. */
export function getCell(
  grid: ReadonlyStudioGrid,
  row: number,
  column: number,
): StudioCell | undefined {
  const index = cellIndex(grid, row, column);
  return index === -1 ? undefined : grid.cells[index];
}

/** Paint one cell in place. Returns whether it changed; off-grid is ignored. */
export function setCell(
  grid: StudioGrid,
  row: number,
  column: number,
  color: StudioCell,
): boolean {
  const index = cellIndex(grid, row, column);
  if (index === -1 || grid.cells[index] === color) return false;
  grid.cells[index] = color;
  return true;
}

export function sameGridSize(
  left: ReadonlyStudioGrid,
  right: ReadonlyStudioGrid,
): boolean {
  const leftSize = getGridSize(left);
  const rightSize = getGridSize(right);
  return (
    leftSize.rows === rightSize.rows && leftSize.columns === rightSize.columns
  );
}

export function cellsEqual(
  left: readonly StudioCell[],
  right: readonly StudioCell[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function gridsEqual(
  left: ReadonlyStudioGrid,
  right: ReadonlyStudioGrid,
): boolean {
  return sameGridSize(left, right) && cellsEqual(left.cells, right.cells);
}

/** A new grid with every painted overlay cell on top of `base`. */
export function mergeGrids(
  base: ReadonlyStudioGrid,
  overlay: ReadonlyStudioGrid,
): StudioGrid {
  if (!sameGridSize(base, overlay)) {
    throw new Error("Studio grids must share dimensions to merge");
  }
  return {
    rows: base.rows,
    columns: base.columns,
    cells: base.cells.map((cell, index) => overlay.cells[index] ?? cell),
  };
}
