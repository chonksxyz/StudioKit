export type StudioCell = string | null;
export type StudioGrid = StudioCell[][];
export type StudioGridSize = { rows: number; columns: number };

export function getGridSize(grid: StudioGrid): StudioGridSize {
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;
  if (
    rows === 0 ||
    columns === 0 ||
    grid.some((row) => row.length !== columns)
  ) {
    throw new Error("Studio grid must be a non-empty rectangle");
  }
  return { rows, columns };
}

export function createGrid({ rows, columns }: StudioGridSize): StudioGrid {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows <= 0 ||
    columns <= 0
  ) {
    throw new Error("Studio grid size must use positive integer dimensions");
  }
  return Array.from({ length: rows }, () =>
    Array<StudioCell>(columns).fill(null),
  );
}

export function cloneGrid(grid: StudioGrid): StudioGrid {
  getGridSize(grid);
  return grid.map((row) => [...row]);
}

export function sameGridSize(left: StudioGrid, right: StudioGrid): boolean {
  const leftSize = getGridSize(left);
  const rightSize = getGridSize(right);
  return (
    leftSize.rows === rightSize.rows && leftSize.columns === rightSize.columns
  );
}

export function gridsEqual(left: StudioGrid, right: StudioGrid): boolean {
  if (!sameGridSize(left, right)) return false;
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < left[row].length; column += 1) {
      if (left[row][column] !== right[row][column]) return false;
    }
  }
  return true;
}

export function mergeGrids(base: StudioGrid, overlay: StudioGrid): StudioGrid {
  if (!sameGridSize(base, overlay)) {
    throw new Error("Studio grids must share dimensions to merge");
  }
  return base.map((row, y) => row.map((cell, x) => overlay[y][x] ?? cell));
}
