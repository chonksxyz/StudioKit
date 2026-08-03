import {
  getGridSize,
  type StudioCell,
  type StudioGrid,
  type StudioGridSize,
} from "./grid.ts";

export type StudioSelectionCell = { row: number; column: number };
export type StudioSelection = readonly StudioSelectionCell[];
export type StudioSelectionSide = "top" | "right" | "bottom" | "left";
export type StudioSelectionEdge = StudioSelectionCell & {
  side: StudioSelectionSide;
};
export type StudioSelectionBounds = {
  minRow: number;
  minColumn: number;
  maxRow: number;
  maxColumn: number;
};
export type StudioSelectionContent = StudioSelectionCell & {
  color: StudioCell;
};
export type StudioSelectionOffset = { row: number; column: number };

const SIDES: readonly {
  side: StudioSelectionSide;
  rowDelta: number;
  columnDelta: number;
}[] = [
  { side: "top", rowDelta: -1, columnDelta: 0 },
  { side: "right", rowDelta: 0, columnDelta: 1 },
  { side: "bottom", rowDelta: 1, columnDelta: 0 },
  { side: "left", rowDelta: 0, columnDelta: -1 },
];

function cellKey(row: number, column: number): string {
  return `${row},${column}`;
}

function isCoordinatePair(cell: StudioSelectionCell): boolean {
  return Number.isInteger(cell.row) && Number.isInteger(cell.column);
}

function byPosition(
  left: StudioSelectionCell,
  right: StudioSelectionCell,
): number {
  return left.row - right.row || left.column - right.column;
}

/**
 * Canonical form of a selection: integer coordinates only, deduplicated, and
 * ordered row-major. Every function here returns normalized selections, so two
 * selections of the same cells are always structurally equal.
 */
export function createSelection(
  cells: StudioSelection = [],
): StudioSelection {
  const seen = new Set<string>();
  const normalized: StudioSelectionCell[] = [];
  for (const cell of cells) {
    if (!isCoordinatePair(cell)) continue;
    const key = cellKey(cell.row, cell.column);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ row: cell.row, column: cell.column });
  }
  return normalized.sort(byPosition);
}

export function selectionHas(
  selection: StudioSelection,
  row: number,
  column: number,
): boolean {
  return selection.some((cell) => cell.row === row && cell.column === column);
}

export function addSelectionCell(
  selection: StudioSelection,
  row: number,
  column: number,
): StudioSelection {
  if (!Number.isInteger(row) || !Number.isInteger(column)) return selection;
  if (selectionHas(selection, row, column)) return selection;
  return createSelection([...selection, { row, column }]);
}

export function removeSelectionCell(
  selection: StudioSelection,
  row: number,
  column: number,
): StudioSelection {
  if (!selectionHas(selection, row, column)) return selection;
  return selection.filter(
    (cell) => cell.row !== row || cell.column !== column,
  );
}

export function toggleSelectionCell(
  selection: StudioSelection,
  row: number,
  column: number,
): StudioSelection {
  return selectionHas(selection, row, column)
    ? removeSelectionCell(selection, row, column)
    : addSelectionCell(selection, row, column);
}

/** Every cell in the inclusive rectangle spanned by two corners. */
export function selectionRectangle(
  anchor: StudioSelectionCell,
  focus: StudioSelectionCell,
): StudioSelection {
  if (!isCoordinatePair(anchor) || !isCoordinatePair(focus)) return [];
  const cells: StudioSelectionCell[] = [];
  const minRow = Math.min(anchor.row, focus.row);
  const maxRow = Math.max(anchor.row, focus.row);
  const minColumn = Math.min(anchor.column, focus.column);
  const maxColumn = Math.max(anchor.column, focus.column);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      cells.push({ row, column });
    }
  }
  return cells;
}

export function selectionBounds(
  selection: StudioSelection,
): StudioSelectionBounds | null {
  if (selection.length === 0) return null;
  let minRow = Infinity;
  let minColumn = Infinity;
  let maxRow = -Infinity;
  let maxColumn = -Infinity;
  for (const { row, column } of selection) {
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (column < minColumn) minColumn = column;
    if (column > maxColumn) maxColumn = column;
  }
  return { minRow, minColumn, maxRow, maxColumn };
}

export function translateSelection(
  selection: StudioSelection,
  rowDelta: number,
  columnDelta: number,
): StudioSelection {
  if (!Number.isInteger(rowDelta) || !Number.isInteger(columnDelta)) {
    return createSelection(selection);
  }
  return createSelection(
    selection.map((cell) => ({
      row: cell.row + rowDelta,
      column: cell.column + columnDelta,
    })),
  );
}

/** The cells that still land on the canvas — the rest are an implied delete. */
export function selectionWithinGrid(
  selection: StudioSelection,
  { rows, columns }: StudioGridSize,
): StudioSelection {
  return createSelection(
    selection.filter(
      (cell) =>
        cell.row >= 0 &&
        cell.row < rows &&
        cell.column >= 0 &&
        cell.column < columns,
    ),
  );
}

/**
 * Split a selection into 4-connected regions. Cells touching only at a corner
 * belong to different regions, so a diagonal pair outlines as two squares.
 */
export function selectionRegions(
  selection: StudioSelection,
): StudioSelection[] {
  const remaining = new Map<string, StudioSelectionCell>();
  for (const cell of createSelection(selection)) {
    remaining.set(cellKey(cell.row, cell.column), cell);
  }

  const regions: StudioSelection[] = [];
  for (const [startKey, startCell] of remaining) {
    if (!remaining.has(startKey)) continue;
    remaining.delete(startKey);

    const region: StudioSelectionCell[] = [];
    const queue: StudioSelectionCell[] = [startCell];
    while (queue.length > 0) {
      const cell = queue.pop() as StudioSelectionCell;
      region.push(cell);
      for (const { rowDelta, columnDelta } of SIDES) {
        const row = cell.row + rowDelta;
        const column = cell.column + columnDelta;
        const key = cellKey(row, column);
        const neighbor = remaining.get(key);
        if (neighbor === undefined) continue;
        remaining.delete(key);
        queue.push(neighbor);
      }
    }
    regions.push(region.sort(byPosition));
  }

  return regions.sort((left, right) => byPosition(left[0], right[0]));
}

export function isSelectionContiguous(selection: StudioSelection): boolean {
  return selectionRegions(selection).length <= 1;
}

/**
 * The exterior edges of a selection: one entry per cell side whose neighbour is
 * outside the selection. Shared sides between adjacent cells are omitted, so
 * rendering these draws an outline around the shape without seams through the
 * middle — and detached or diagonal cells each get their own ring.
 */
export function selectionOutline(
  selection: StudioSelection,
): StudioSelectionEdge[] {
  const normalized = createSelection(selection);
  const members = new Set(
    normalized.map((cell) => cellKey(cell.row, cell.column)),
  );

  const edges: StudioSelectionEdge[] = [];
  for (const { row, column } of normalized) {
    for (const { side, rowDelta, columnDelta } of SIDES) {
      if (members.has(cellKey(row + rowDelta, column + columnDelta))) continue;
      edges.push({ row, column, side });
    }
  }
  return edges;
}

/** Read the colors under a selection, in normalized order. */
export function readSelection(
  grid: StudioGrid,
  selection: StudioSelection,
): StudioSelectionContent[] {
  const { rows, columns } = getGridSize(grid);
  return createSelection(selection)
    .filter(
      (cell) =>
        cell.row >= 0 &&
        cell.row < rows &&
        cell.column >= 0 &&
        cell.column < columns,
    )
    .map((cell) => ({
      row: cell.row,
      column: cell.column,
      color: grid[cell.row][cell.column],
    }));
}

function withCell(
  grid: StudioGrid,
  row: number,
  column: number,
  color: StudioCell,
  rows: number,
  columns: number,
): StudioGrid {
  if (row < 0 || row >= rows || column < 0 || column >= columns) return grid;
  if (grid[row][column] === color) return grid;
  const next = [...grid];
  next[row] = [...grid[row]];
  next[row][column] = color;
  return next;
}

/** Empty every selected cell, leaving untouched rows referentially identical. */
export function clearSelection(
  grid: StudioGrid,
  selection: StudioSelection,
): StudioGrid {
  const { rows, columns } = getGridSize(grid);
  let next = grid;
  for (const { row, column } of selection) {
    next = withCell(next, row, column, null, rows, columns);
  }
  return next;
}

/**
 * Write selection contents at an offset, overwriting whatever is underneath.
 * Cells that land outside the grid are dropped — moving pixels off the canvas
 * deletes them.
 */
export function stampSelection(
  grid: StudioGrid,
  contents: readonly StudioSelectionContent[],
  offset: StudioSelectionOffset = { row: 0, column: 0 },
): StudioGrid {
  const { rows, columns } = getGridSize(grid);
  const rowDelta = Number.isInteger(offset.row) ? offset.row : 0;
  const columnDelta = Number.isInteger(offset.column) ? offset.column : 0;
  let next = grid;
  for (const { row, column, color } of contents) {
    next = withCell(
      next,
      row + rowDelta,
      column + columnDelta,
      color,
      rows,
      columns,
    );
  }
  return next;
}
