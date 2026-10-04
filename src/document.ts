import {
  getGridSize,
  type ReadonlyStudioGrid,
  type StudioCell,
  type StudioGrid,
} from "./grid.ts";
import {
  createSelection,
  translateSelection,
  type StudioSelection,
  type StudioSelectionContent,
  type StudioSelectionOffset,
} from "./selection.ts";

/**
 * One undo step. Small edits store just the cells they changed; edits that
 * touch a large share of the grid store the whole grid before and after,
 * which is cheaper to build and apply than a long list of indices.
 */
type StudioEdit =
  | {
      dense: false;
      indices: number[];
      before: StudioCell[];
      after: StudioCell[];
    }
  | { dense: true; before: StudioCell[]; after: StudioCell[] };

/** Edits changing more than 1/DENSE_EDIT_SHARE of the cells are stored dense. */
const DENSE_EDIT_SHARE = 8;

type StudioFloat = {
  contents: readonly StudioSelectionContent[];
  offset: StudioSelectionOffset;
};

/**
 * Cells lifted off the canvas and floating at `offset`. The document always
 * shows the float in its current position until it is committed or cancelled.
 */
export type StudioFloatingSelection = {
  readonly contents: readonly StudioSelectionContent[];
  readonly offset: StudioSelectionOffset;
};

export type StudioDocumentAction =
  | { type: "hydrate"; grid: ReadonlyStudioGrid }
  | { type: "begin-stroke"; row: number; column: number; color: StudioCell }
  | { type: "update-stroke"; row: number; column: number; color: StudioCell }
  | { type: "commit-stroke" }
  | { type: "cancel-stroke" }
  | { type: "clear" }
  | { type: "recolor"; from: string; to: string }
  | { type: "load"; grid: ReadonlyStudioGrid }
  | { type: "affix"; grid: ReadonlyStudioGrid }
  | { type: "lift-selection"; selection: StudioSelection }
  | {
      type: "move-selection";
      rowDelta: number;
      columnDelta: number;
      /** Lifted first when nothing is floating yet — arrow keys can move a
       * selection without a preceding drag. */
      selection?: StudioSelection;
    }
  | { type: "place-selection"; rowOffset: number; columnOffset: number }
  | { type: "fill-selection"; selection: StudioSelection; color: StudioCell }
  | { type: "commit-selection" }
  | { type: "cancel-selection" }
  | { type: "undo" }
  | { type: "redo" };

/**
 * A sparse map from cell index to color over a fixed-size grid. Marking by
 * epoch makes recording a cell and forgetting them all O(1), so a stroke never
 * copies the grid and a drag never allocates a hash map.
 */
class CellMap {
  // Plain (not #private) fields: these are read per pixel and V8 inlines
  // them more reliably. The class itself is module-private.
  private marks: Uint32Array;
  private values: StudioCell[];
  private epoch = 1;
  /** Recorded indices; entries whose mark is stale were pruned. */
  indices: number[] = [];

  constructor(size: number) {
    this.marks = new Uint32Array(size);
    this.values = Array<StudioCell>(size).fill(null);
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  has(index: number): boolean {
    return this.marks[index] === this.epoch;
  }

  value(index: number): StudioCell {
    return this.values[index];
  }

  /** Remember `value`, unless one is already recorded for `index`. */
  record(index: number, value: StudioCell): void {
    if (this.marks[index] === this.epoch) return;
    this.marks[index] = this.epoch;
    this.values[index] = value;
    this.indices.push(index);
  }

  set(index: number, value: StudioCell): void {
    if (this.marks[index] === this.epoch) {
      this.values[index] = value;
      return;
    }
    this.record(index, value);
  }

  /** Forget cells that show their committed color again. */
  prune(cells: readonly StudioCell[]): void {
    let length = 0;
    for (const index of this.indices) {
      if (this.marks[index] !== this.epoch) continue;
      if (cells[index] === this.values[index]) {
        this.marks[index] = 0;
        continue;
      }
      this.indices[length] = index;
      length += 1;
    }
    this.indices.length = length;
  }

  clear(): void {
    this.indices.length = 0;
    if (this.epoch === 0xffffffff) {
      this.marks.fill(0);
      this.epoch = 0;
    }
    this.epoch += 1;
  }
}

/**
 * A pixel document with undo/redo history.
 *
 * The document owns one flat `cells` array and edits it in place, so painting
 * a pixel is one write. History stores only the cells each step changed. Every
 * brush stroke commits as exactly one undo entry, cancelled strokes roll back
 * cleanly, and atomic edits (clear, recolor, load, affix, selection moves) are
 * each one history step.
 *
 * Every method returns whether anything observable changed. Rendering keys off
 * two counters: `version` changes on every change (for
 * `useSyncExternalStore`), and `rowRevision(row)` changes only when a cell in
 * that row does, so a renderer can skip untouched rows.
 */
export class StudioDocument implements ReadonlyStudioGrid {
  readonly rows: number;
  readonly columns: number;

  #cells: StudioCell[];
  #rowRevisions: Uint32Array;
  #version = 0;
  #past: StudioEdit[] = [];
  /** Redo stack: the next redo is the last element. */
  #future: StudioEdit[] = [];
  /** Committed colors of the cells a stroke or float in flight overwrote. */
  #pending: CellMap;
  /** Scratch: the final color of each cell an operation writes. */
  #targets: CellMap;
  #isStroking = false;
  #float: StudioFloat | null = null;
  #isPristine = true;
  #listeners = new Set<() => void>();

  constructor(initialGrid: ReadonlyStudioGrid) {
    const { rows, columns } = getGridSize(initialGrid);
    this.rows = rows;
    this.columns = columns;
    this.#cells = initialGrid.cells.slice();
    this.#rowRevisions = new Uint32Array(rows);
    this.#pending = new CellMap(this.#cells.length);
    this.#targets = new CellMap(this.#cells.length);
  }

  /**
   * The visible cells, row-major and edited in place. Read them, never write
   * them: use the document's methods so history and revisions stay correct.
   */
  get cells(): readonly StudioCell[] {
    return this.#cells;
  }

  /** Increments on every change. */
  get version(): number {
    return this.#version;
  }

  /** Increments whenever a cell in `row` changes. */
  rowRevision(row: number): number {
    return this.#rowRevisions[row] ?? 0;
  }

  getCell(row: number, column: number): StudioCell | undefined {
    return this.#isValidCoordinate(row, column)
      ? this.#cells[row * this.columns + column]
      : undefined;
  }

  /** A copy of the visible grid, safe to keep, save, or export. */
  snapshot(): StudioGrid {
    return { rows: this.rows, columns: this.columns, cells: this.#cells.slice() };
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get undoDepth(): number {
    return this.#past.length;
  }

  get redoDepth(): number {
    return this.#future.length;
  }

  /** True until the first committed edit — `hydrate` only applies while pristine. */
  get isPristine(): boolean {
    return this.#isPristine;
  }

  get isStroking(): boolean {
    return this.#isStroking;
  }

  get float(): StudioFloatingSelection | null {
    return this.#float;
  }

  /**
   * Where the floating cells currently sit, for rendering the selection
   * outline. Includes coordinates outside the grid: those are the implied
   * delete on commit, and callers can filter them with `selectionWithinGrid`.
   */
  floatingSelection(): StudioSelection | null {
    const float = this.#float;
    if (float === null) return null;
    return translateSelection(float.contents, float.offset.row, float.offset.column);
  }

  /** Call `listener` after every change. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  dispatch(action: StudioDocumentAction): boolean {
    switch (action.type) {
      case "hydrate":
        return this.hydrate(action.grid);
      case "begin-stroke":
        return this.beginStroke(action.row, action.column, action.color);
      case "update-stroke":
        return this.updateStroke(action.row, action.column, action.color);
      case "commit-stroke":
        return this.commitStroke();
      case "cancel-stroke":
        return this.cancelStroke();
      case "clear":
        return this.clear();
      case "recolor":
        return this.recolor(action.from, action.to);
      case "load":
        return this.load(action.grid);
      case "affix":
        return this.affix(action.grid);
      case "lift-selection":
        return this.liftSelection(action.selection);
      case "move-selection":
        return this.moveSelection(action.rowDelta, action.columnDelta, action.selection);
      case "place-selection":
        return this.placeSelection(action.rowOffset, action.columnOffset);
      case "fill-selection":
        return this.fillSelection(action.selection, action.color);
      case "commit-selection":
        return this.commitSelection();
      case "cancel-selection":
        return this.cancelSelection();
      case "undo":
        return this.undo();
      case "redo":
        return this.redo();
      default:
        action satisfies never;
        return false;
    }
  }

  /** Replace a pristine document's grid without adding history (e.g. restoring a draft). */
  hydrate(grid: ReadonlyStudioGrid): boolean {
    if (!this.#isPristine || this.#isInFlight()) return false;
    const cells = this.#matchingCells(grid);
    if (cells === null) return false;
    for (let index = 0; index < cells.length; index += 1) {
      this.#assign(index, cells[index]);
    }
    return this.#changed(true);
  }

  beginStroke(row: number, column: number, color: StudioCell): boolean {
    if (this.#float !== null || !this.#isValidCoordinate(row, column)) {
      return false;
    }
    this.#settleStroke();
    this.#isStroking = true;
    this.#touch(row * this.columns + column, color);
    return this.#changed(true);
  }

  updateStroke(row: number, column: number, color: StudioCell): boolean {
    if (!this.#isStroking || !this.#isValidCoordinate(row, column)) return false;
    const index = row * this.columns + column;
    if (this.#cells[index] === color) return false;
    this.#touch(index, color);
    return this.#changed(true);
  }

  commitStroke(): boolean {
    if (!this.#isStroking) return false;
    this.#settleStroke();
    return this.#changed(true);
  }

  cancelStroke(): boolean {
    if (!this.#isStroking) return false;
    this.#isStroking = false;
    this.#restorePending();
    return this.#changed(true);
  }

  clear(): boolean {
    const next = Array<StudioCell>(this.#cells.length).fill(null);
    return this.#changed(this.#commitAtomicEdit(next));
  }

  /** Replace every cell of one color with another. */
  recolor(from: string, to: string): boolean {
    const next = this.#committedCells().slice();
    for (let index = 0; index < next.length; index += 1) {
      if (next[index] === from) next[index] = to;
    }
    return this.#changed(this.#commitAtomicEdit(next));
  }

  /** Replace the whole grid as one undoable edit. */
  load(grid: ReadonlyStudioGrid): boolean {
    const cells = this.#matchingCells(grid);
    if (cells === null) return false;
    return this.#changed(this.#commitAtomicEdit(cells.slice()));
  }

  /** Paint every non-empty cell of `grid` on top, as one undoable edit. */
  affix(grid: ReadonlyStudioGrid): boolean {
    const overlay = this.#matchingCells(grid);
    if (overlay === null) return false;
    const next = this.#committedCells().slice();
    for (let index = 0; index < next.length; index += 1) {
      const color = overlay[index];
      if (color !== null) next[index] = color;
    }
    return this.#changed(this.#commitAtomicEdit(next));
  }

  liftSelection(selection: StudioSelection): boolean {
    if (this.#float !== null) return false;
    const contents = this.#readCommitted(selection);
    if (contents.length === 0) return this.cancelStroke();
    this.#lift(contents, { row: 0, column: 0 });
    return this.#changed(true);
  }

  moveSelection(
    rowDelta: number,
    columnDelta: number,
    selection?: StudioSelection,
  ): boolean {
    if (!Number.isInteger(rowDelta) || !Number.isInteger(columnDelta)) {
      return false;
    }
    if (this.#float === null) {
      if (selection === undefined) return false;
      const contents = this.#readCommitted(selection);
      if (contents.length === 0) return false;
      // Lift straight to the target so the grid renders once.
      this.#lift(contents, { row: rowDelta, column: columnDelta });
      return this.#changed(true);
    }
    const { offset } = this.#float;
    return this.#changed(
      this.#offsetFloat({
        row: offset.row + rowDelta,
        column: offset.column + columnDelta,
      }),
    );
  }

  placeSelection(rowOffset: number, columnOffset: number): boolean {
    return this.#changed(this.#offsetFloat({ row: rowOffset, column: columnOffset }));
  }

  /**
   * Recolor the selected cells. While a selection is floating this repaints
   * the cells in flight — they keep moving, in the new color — so the move
   * still commits as one entry rather than splitting into a fill plus a move.
   */
  fillSelection(selection: StudioSelection, color: StudioCell): boolean {
    const float = this.#float;
    if (float !== null) {
      float.contents = float.contents.map((cell) => ({ ...cell, color }));
      this.#renderFloat();
      return this.#changed(true);
    }
    const next = this.#committedCells().slice();
    for (const { row, column } of selection) {
      if (this.#isValidCoordinate(row, column)) {
        next[row * this.columns + column] = color;
      }
    }
    return this.#changed(this.#commitAtomicEdit(next));
  }

  /** Write the floating cells where they sit, as one undoable edit. */
  commitSelection(): boolean {
    if (this.#float === null) return false;
    this.#float = null;
    this.#pushEdit(this.#takePending());
    return this.#changed(true);
  }

  cancelSelection(): boolean {
    if (this.#float === null) return false;
    this.#float = null;
    this.#restorePending();
    return this.#changed(true);
  }

  /** Cancels a stroke or float in flight; otherwise steps back one entry. */
  undo(): boolean {
    if (this.#float !== null) return this.cancelSelection();
    if (this.#isStroking) return this.cancelStroke();
    const edit = this.#past.pop();
    if (edit === undefined) return false;
    this.#applyEdit(edit, edit.before);
    this.#future.push(edit);
    return this.#changed(true);
  }

  /** Cancels a stroke or float in flight; otherwise steps forward one entry. */
  redo(): boolean {
    if (this.#float !== null) return this.cancelSelection();
    if (this.#isStroking) return this.cancelStroke();
    const edit = this.#future.pop();
    if (edit === undefined) return false;
    this.#applyEdit(edit, edit.after);
    this.#past.push(edit);
    return this.#changed(true);
  }

  #changed(changed: boolean): boolean {
    if (changed) {
      this.#version += 1;
      if (this.#listeners.size > 0) {
        for (const listener of this.#listeners) listener();
      }
    }
    return changed;
  }

  #isValidCoordinate(row: number, column: number): boolean {
    return (
      Number.isInteger(row) &&
      Number.isInteger(column) &&
      row >= 0 &&
      row < this.rows &&
      column >= 0 &&
      column < this.columns
    );
  }

  #isInFlight(): boolean {
    return this.#isStroking || this.#float !== null;
  }

  #matchingCells(grid: ReadonlyStudioGrid): readonly StudioCell[] | null {
    try {
      const { rows, columns } = getGridSize(grid);
      return rows === this.rows && columns === this.columns ? grid.cells : null;
    } catch {
      return null;
    }
  }

  /** Show `color` at `index`, bumping its row's revision if it changed. */
  #assign(index: number, color: StudioCell): void {
    if (this.#cells[index] === color) return;
    this.#cells[index] = color;
    this.#rowRevisions[Math.floor(index / this.columns)] += 1;
  }

  /** Paint a cell in flight, remembering its committed color first. */
  #touch(index: number, color: StudioCell): void {
    this.#pending.record(index, this.#cells[index]);
    this.#assign(index, color);
  }

  #committedCell(index: number): StudioCell {
    return this.#pending.has(index)
      ? this.#pending.value(index)
      : this.#cells[index];
  }

  /** Show one side of an edit: `colors` is its `before` or `after`. */
  #applyEdit(edit: StudioEdit, colors: readonly StudioCell[]): void {
    if (edit.dense) {
      for (let index = 0; index < colors.length; index += 1) {
        this.#assign(index, colors[index]);
      }
      return;
    }
    const { indices } = edit;
    for (let step = 0; step < indices.length; step += 1) {
      this.#assign(indices[step], colors[step]);
    }
  }

  /** The committed grid: the visible one, minus anything in flight. */
  #committedCells(): readonly StudioCell[] {
    const pending = this.#pending;
    if (pending.isEmpty) return this.#cells;
    const committed = this.#cells.slice();
    for (const index of pending.indices) {
      if (pending.has(index)) committed[index] = pending.value(index);
    }
    return committed;
  }

  /**
   * The edit taking `before` to `after`, or null when they match. `changed`
   * lists candidate indices when only those can differ.
   */
  #diff(
    before: readonly StudioCell[],
    after: readonly StudioCell[],
    changed: readonly number[] | null,
  ): StudioEdit | null {
    const indices: number[] = [];
    const limit = Math.floor(after.length / DENSE_EDIT_SHARE);
    const candidates = changed ?? null;
    const count = candidates === null ? after.length : candidates.length;
    for (let step = 0; step < count; step += 1) {
      const index = candidates === null ? step : candidates[step];
      if (before[index] === after[index]) continue;
      if (indices.length >= limit) {
        return { dense: true, before: before.slice(), after: after.slice() };
      }
      indices.push(index);
    }
    if (indices.length === 0) return null;
    return {
      dense: false,
      indices,
      before: indices.map((index) => before[index]),
      after: indices.map((index) => after[index]),
    };
  }

  /** The cells in flight that differ from their committed color, as an edit. */
  #takePending(): StudioEdit | null {
    const pending = this.#pending;
    const cells = this.#cells;
    let edit: StudioEdit | null;
    if (pending.indices.length < cells.length / DENSE_EDIT_SHARE) {
      const indices: number[] = [];
      const before: StudioCell[] = [];
      const after: StudioCell[] = [];
      for (const index of pending.indices) {
        if (!pending.has(index)) continue;
        const committed = pending.value(index);
        if (committed === cells[index]) continue;
        indices.push(index);
        before.push(committed);
        after.push(cells[index]);
      }
      edit = indices.length === 0 ? null : { dense: false, indices, before, after };
    } else {
      edit = this.#diff(this.#committedCells(), cells, pending.indices);
    }
    pending.clear();
    return edit;
  }

  #restorePending(): void {
    const pending = this.#pending;
    for (const index of pending.indices) {
      if (pending.has(index)) this.#assign(index, pending.value(index));
    }
    pending.clear();
  }

  /** Record an edit as the next undo step. Returns whether there was one. */
  #pushEdit(edit: StudioEdit | null): boolean {
    if (edit === null) return false;
    this.#past.push(edit);
    this.#future.length = 0;
    this.#isPristine = false;
    return true;
  }

  /** Commit a stroke in flight, whose cells are already visible. */
  #settleStroke(): void {
    if (!this.#isStroking) return;
    this.#isStroking = false;
    this.#pushEdit(this.#takePending());
  }

  /**
   * Show `next` as one undoable edit from the committed grid, dropping
   * anything in flight. Returns whether anything changed.
   */
  #commitAtomicEdit(next: StudioCell[]): boolean {
    const wasInFlight = this.#isInFlight();
    const edit = this.#diff(this.#committedCells(), next, null);
    if (edit === null) {
      if (wasInFlight) this.#resetToCommitted();
      return wasInFlight;
    }
    if (wasInFlight && !edit.dense) {
      // Write each cell once, straight to its final color.
      const pending = this.#pending;
      const targets = this.#targets;
      for (const index of pending.indices) {
        if (pending.has(index)) targets.set(index, pending.value(index));
      }
      edit.indices.forEach((index, step) => targets.set(index, edit.after[step]));
      this.#flushTargets(false);
    } else {
      // Dense edits compare every cell, so they also overwrite anything in flight.
      this.#applyEdit(edit, edit.after);
    }
    this.#pending.clear();
    this.#isStroking = false;
    this.#float = null;
    return this.#pushEdit(edit);
  }

  #resetToCommitted(): void {
    this.#isStroking = false;
    this.#float = null;
    this.#restorePending();
  }

  #readCommitted(selection: StudioSelection): StudioSelectionContent[] {
    const contents: StudioSelectionContent[] = [];
    for (const { row, column } of createSelection(selection)) {
      if (!this.#isValidCoordinate(row, column)) continue;
      contents.push({
        row,
        column,
        color: this.#committedCell(row * this.columns + column),
      });
    }
    return contents;
  }

  /** Lift contents into a float at `offset`, discarding any stroke in flight. */
  #lift(
    contents: readonly StudioSelectionContent[],
    offset: StudioSelectionOffset,
  ): void {
    this.#isStroking = false;
    this.#float = { contents, offset };
    this.#renderFloat();
  }

  #offsetFloat(offset: StudioSelectionOffset): boolean {
    const float = this.#float;
    if (float === null) return false;
    if (!Number.isInteger(offset.row) || !Number.isInteger(offset.column)) {
      return false;
    }
    if (offset.row === float.offset.row && offset.column === float.offset.column) {
      return false;
    }
    float.offset = offset;
    this.#renderFloat();
    return true;
  }

  /**
   * Show the float at its offset. Only the cells it covered, its source cells,
   * and its new position are touched — never the whole grid.
   */
  #renderFloat(): void {
    const { contents, offset } = this.#float as StudioFloat;
    const pending = this.#pending;
    const targets = this.#targets;
    for (const index of pending.indices) {
      if (pending.has(index)) targets.set(index, pending.value(index));
    }
    for (const { row, column } of contents) {
      targets.set(row * this.columns + column, null);
    }
    for (const { row, column, color } of contents) {
      const targetRow = row + offset.row;
      const targetColumn = column + offset.column;
      if (this.#isValidCoordinate(targetRow, targetColumn)) {
        targets.set(targetRow * this.columns + targetColumn, color);
      }
    }
    this.#flushTargets(true);
    pending.prune(this.#cells);
  }

  /** Write every target color, recording committed colors when `inFlight`. */
  #flushTargets(inFlight: boolean): void {
    const targets = this.#targets;
    for (const index of targets.indices) {
      const color = targets.value(index);
      if (inFlight) this.#touch(index, color);
      else this.#assign(index, color);
    }
    targets.clear();
  }
}
