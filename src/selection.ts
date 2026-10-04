import {
  getGridSize,
  type ReadonlyStudioGrid,
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

/** Bounding boxes up to this many cells (or 16 per selected cell) use a bitmap. */
const BITMAP_MIN_AREA = 1 << 16;

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
 * Membership over normalized cells. Selections on a pixel canvas are compact,
 * so a bitmap over their bounding box answers in a few arithmetic operations;
 * cells scattered across a huge range fall back to a string-keyed set.
 */
class CellSet {
  private readonly minRow: number = 0;
  private readonly minColumn: number = 0;
  private readonly width: number = 0;
  private readonly height: number = 0;
  private readonly bits: Uint8Array | null = null;
  private readonly keys: Set<string> | null = null;

  constructor(normalized: StudioSelection) {
    const bounds = selectionBounds(normalized);
    if (bounds === null) {
      this.keys = new Set();
      return;
    }
    this.minRow = bounds.minRow;
    this.minColumn = bounds.minColumn;
    this.height = bounds.maxRow - bounds.minRow + 1;
    this.width = bounds.maxColumn - bounds.minColumn + 1;
    const area = this.width * this.height;
    if (area > Math.max(BITMAP_MIN_AREA, normalized.length * 16)) {
      this.keys = new Set(normalized.map(({ row, column }) => `${row},${column}`));
      return;
    }
    this.bits = new Uint8Array(area);
    for (const { row, column } of normalized) {
      this.bits[(row - this.minRow) * this.width + column - this.minColumn] = 1;
    }
  }

  private slot(row: number, column: number): number {
    const y = row - this.minRow;
    const x = column - this.minColumn;
    return y >= 0 && y < this.height && x >= 0 && x < this.width
      ? y * this.width + x
      : -1;
  }

  has(row: number, column: number): boolean {
    if (this.bits === null) return this.keys!.has(`${row},${column}`);
    const slot = this.slot(row, column);
    return slot !== -1 && this.bits[slot] === 1;
  }

  delete(row: number, column: number): boolean {
    if (this.bits === null) return this.keys!.delete(`${row},${column}`);
    const slot = this.slot(row, column);
    if (slot === -1 || this.bits[slot] === 0) return false;
    this.bits[slot] = 0;
    return true;
  }
}

/**
 * Canonical form of a selection: integer coordinates only, deduplicated, and
 * ordered row-major. Every function here returns normalized selections, so two
 * selections of the same cells are always structurally equal.
 */
export function createSelection(
  cells: StudioSelection = [],
): StudioSelection {
  const normalized: StudioSelectionCell[] = [];
  let ordered = true;
  for (const cell of cells) {
    if (!isCoordinatePair(cell)) continue;
    const previous = normalized[normalized.length - 1];
    if (previous !== undefined && byPosition(previous, cell) >= 0) {
      ordered = false;
    }
    normalized.push({ row: cell.row, column: cell.column });
  }
  if (ordered) return normalized;

  // Pixel selections are compact: bucket them through a bitmap over their
  // bounding box, which sorts and deduplicates in linear time.
  const bounds = selectionBounds(normalized) as StudioSelectionBounds;
  const width = bounds.maxColumn - bounds.minColumn + 1;
  const area = width * (bounds.maxRow - bounds.minRow + 1);
  if (area <= Math.max(BITMAP_MIN_AREA, normalized.length * 16)) {
    const bits = new Uint8Array(area);
    for (const { row, column } of normalized) {
      bits[(row - bounds.minRow) * width + column - bounds.minColumn] = 1;
    }
    let length = 0;
    for (let slot = 0; slot < area; slot += 1) {
      if (bits[slot] === 0) continue;
      normalized[length] = {
        row: bounds.minRow + Math.floor(slot / width),
        column: bounds.minColumn + (slot % width),
      };
      length += 1;
    }
    normalized.length = length;
    return normalized;
  }

  normalized.sort(byPosition);
  let length = 0;
  for (const cell of normalized) {
    const previous = normalized[length - 1];
    if (previous !== undefined && byPosition(previous, cell) === 0) continue;
    normalized[length] = cell;
    length += 1;
  }
  normalized.length = length;
  return normalized;
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

function isWithin(
  { row, column }: StudioSelectionCell,
  { rows, columns }: StudioGridSize,
): boolean {
  return row >= 0 && row < rows && column >= 0 && column < columns;
}

/** The cells that still land on the canvas — the rest are an implied delete. */
export function selectionWithinGrid(
  selection: StudioSelection,
  size: StudioGridSize,
): StudioSelection {
  return createSelection(selection.filter((cell) => isWithin(cell, size)));
}

/**
 * Split a selection into 4-connected regions. Cells touching only at a corner
 * belong to different regions, so a diagonal pair outlines as two squares.
 */
export function selectionRegions(
  selection: StudioSelection,
): StudioSelection[] {
  const normalized = createSelection(selection);
  const remaining = new CellSet(normalized);
  const regions: StudioSelection[] = [];
  const queue: StudioSelectionCell[] = [];
  // Starts are visited in row-major order, so each start is the smallest cell
  // of its region and the regions come out already ordered.
  for (const start of normalized) {
    if (!remaining.delete(start.row, start.column)) continue;
    const region: StudioSelectionCell[] = [];
    queue.push(start);
    while (queue.length > 0) {
      const cell = queue.pop() as StudioSelectionCell;
      region.push(cell);
      for (const { rowDelta, columnDelta } of SIDES) {
        const row = cell.row + rowDelta;
        const column = cell.column + columnDelta;
        if (remaining.delete(row, column)) queue.push({ row, column });
      }
    }
    regions.push(region.sort(byPosition));
  }
  return regions;
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
  const members = new CellSet(normalized);
  const edges: StudioSelectionEdge[] = [];
  for (const { row, column } of normalized) {
    for (const { side, rowDelta, columnDelta } of SIDES) {
      if (members.has(row + rowDelta, column + columnDelta)) continue;
      edges.push({ row, column, side });
    }
  }
  return edges;
}

/** Read the colors under a selection, in normalized order. */
export function readSelection(
  grid: ReadonlyStudioGrid,
  selection: StudioSelection,
): StudioSelectionContent[] {
  const size = getGridSize(grid);
  const contents: StudioSelectionContent[] = [];
  for (const { row, column } of createSelection(selection)) {
    if (!isWithin({ row, column }, size)) continue;
    contents.push({ row, column, color: grid.cells[row * size.columns + column] });
  }
  return contents;
}

/**
 * Paint every selected cell one color, in place. Returns whether any cell
 * changed. Coordinates outside the grid are ignored.
 */
export function fillSelection(
  grid: StudioGrid,
  selection: StudioSelection,
  color: StudioCell,
): boolean {
  const size = getGridSize(grid);
  let changed = false;
  for (const cell of selection) {
    if (!isCoordinatePair(cell) || !isWithin(cell, size)) continue;
    const index = cell.row * size.columns + cell.column;
    if (grid.cells[index] === color) continue;
    grid.cells[index] = color;
    changed = true;
  }
  return changed;
}

/** Empty every selected cell in place — `fillSelection` with no color. */
export function clearSelection(
  grid: StudioGrid,
  selection: StudioSelection,
): boolean {
  return fillSelection(grid, selection, null);
}

/**
 * Write selection contents at an offset, in place, overwriting whatever is
 * underneath. Cells that land outside the grid are dropped — moving pixels
 * off the canvas deletes them. Returns whether any cell changed.
 */
export function stampSelection(
  grid: StudioGrid,
  contents: readonly StudioSelectionContent[],
  offset: StudioSelectionOffset = { row: 0, column: 0 },
): boolean {
  const size = getGridSize(grid);
  const rowDelta = Number.isInteger(offset.row) ? offset.row : 0;
  const columnDelta = Number.isInteger(offset.column) ? offset.column : 0;
  let changed = false;
  for (const { row, column, color } of contents) {
    const target = { row: row + rowDelta, column: column + columnDelta };
    if (!isCoordinatePair(target) || !isWithin(target, size)) continue;
    const index = target.row * size.columns + target.column;
    if (grid.cells[index] === color) continue;
    grid.cells[index] = color;
    changed = true;
  }
  return changed;
}
