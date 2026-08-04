import type { StudioCell } from "./grid.ts";

export type StudioInputPolicy = {
  overlay: string;
  mode: "draw" | "erase" | "select";
  selectedColor: string;
  /** Whether a cell is part of the current selection — required in select mode. */
  isSelected?: (row: number, column: number) => boolean;
  /** Whether anything is selected, which arms the selection keys. */
  hasSelection?: boolean;
  /**
   * Make Shift select instead of erase, in every mode. Shift-drag builds a
   * selection, dragging a selected cell moves it, and the selection keys stay
   * armed — so a draw-mode user never changes tools to move pixels. Off by
   * default: Shift keeps erasing.
   */
  shiftSelects?: boolean;
};

export type StudioSelectionInputActions = {
  /** Pointer down on an unselected cell. `additive` is Shift held. */
  beginSelect: (row: number, column: number, additive: boolean) => void;
  /** Pointer dragged onto another cell while selecting. */
  extendSelect: (row: number, column: number, additive: boolean) => void;
  /** The select drag ended (the selection itself stays). */
  endSelect?: () => void;
  /** Pointer down on a selected cell — lift the selection off the canvas. */
  beginMove: (row: number, column: number) => void;
  /** Drag offset from the grabbed cell, in cells. */
  moveTo: (rowOffset: number, columnOffset: number) => void;
  /** The move drag ended; the selection stays floating until commit/cancel. */
  endMove?: () => void;
  /** Arrow-key nudge, relative to the current offset. */
  nudge: (rowDelta: number, columnDelta: number) => void;
  /** Write the moved cells into the grid (Enter, or your own button). */
  commit: () => void;
  /** Put everything back (Escape, or your own button). */
  cancel: () => void;
  /** Empty the selected cells (Delete or Backspace). Optional: without it,
   * those keys keep their native behaviour. */
  delete?: () => void;
};

export type StudioShortcut = {
  key: string;
  overlays?: readonly string[];
  preventDefault?: boolean;
  allowInEditable?: boolean;
  run: () => void;
};

export type StudioInputActions = {
  beginStroke: (row: number, column: number, color: StudioCell) => void;
  updateStroke: (row: number, column: number, color: StudioCell) => void;
  commitStroke: () => void;
  cancelStroke: () => void;
  undo: () => void;
  redo: () => void;
  onTemporaryEraseChange?: (active: boolean) => void;
  applyPinchScale?: (factor: number) => void;
  selection?: StudioSelectionInputActions;
};

export type StudioInputBinding = {
  syncPolicy: () => void;
  destroy: () => void;
};

export type BindStudioInputOptions = {
  grid: HTMLElement;
  rows: number;
  columns: number;
  getPolicy: () => StudioInputPolicy;
  actions: StudioInputActions;
  shortcuts?: readonly StudioShortcut[];
  cellSelector?: string;
  windowTarget?: Window;
  documentTarget?: Document;
};

const CLOSED_OVERLAY = "none";
const DEFAULT_CELL_SELECTOR = "[data-row][data-col]";
const DEFAULT_SHORTCUT_OVERLAYS: readonly string[] = [CLOSED_OVERLAY];
const GRID_COORDINATE_PATTERN = /^\d+$/;
const ARROW_DELTAS: Record<
  string,
  { row: number; column: number } | undefined
> = {
  ArrowUp: { row: -1, column: 0 },
  ArrowDown: { row: 1, column: 0 },
  ArrowLeft: { row: 0, column: -1 },
  ArrowRight: { row: 0, column: 1 },
};

/**
 * Bresenham's line, yielding every cell after the start up to and including the
 * end. Pointer samples arrive coarser than the grid — a fast drag reports a
 * handful of points many cells apart — so gestures walk the cells in between,
 * or a quick stroke lands as a row of dots.
 */
function* cellsBetween(
  fromRow: number,
  fromColumn: number,
  toRow: number,
  toColumn: number,
): Generator<{ row: number; column: number }> {
  const rowSpan = Math.abs(toRow - fromRow);
  const columnSpan = Math.abs(toColumn - fromColumn);
  const rowStep = fromRow < toRow ? 1 : -1;
  const columnStep = fromColumn < toColumn ? 1 : -1;
  let error = columnSpan - rowSpan;
  let row = fromRow;
  let column = fromColumn;

  // The span is its own iteration bound, so a bad coordinate cannot spin here.
  for (let step = rowSpan + columnSpan; step > 0; step -= 1) {
    if (row === toRow && column === toColumn) return;
    const doubled = 2 * error;
    if (doubled > -rowSpan) {
      error -= rowSpan;
      column += columnStep;
    }
    if (doubled < columnSpan) {
      error += columnSpan;
      row += rowStep;
    }
    yield { row, column };
  }
}

type SelectionGesture = {
  pointerId: number;
  kind: "select" | "move";
  additive: boolean;
  row: number;
  column: number;
  lastRow: number;
  lastColumn: number;
};

type EditableTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
};

function isEditableTarget(target: EventTarget | null): boolean {
  const candidate = target as EditableTarget | null;
  if (!candidate) return false;
  const tagName = candidate.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  if (candidate.isContentEditable) return true;
  return candidate.closest
    ? candidate.closest(
        "[contenteditable]:not([contenteditable='false'])",
      ) !== null
    : false;
}

function shortcutMatchesOverlay(
  shortcut: StudioShortcut,
  overlay: string,
): boolean {
  return (shortcut.overlays ?? DEFAULT_SHORTCUT_OVERLAYS).includes(overlay);
}

export function bindStudioInput({
  grid,
  rows,
  columns,
  getPolicy,
  actions,
  shortcuts = [],
  cellSelector = DEFAULT_CELL_SELECTOR,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
}: BindStudioInputOptions): StudioInputBinding {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows <= 0 ||
    columns <= 0
  ) {
    throw new Error("Studio input grid must use positive integer dimensions");
  }

  let activeStrokePointer: number | null = null;
  let lastStrokeCell: { row: number; column: number } | null = null;
  let shiftErase = false;
  let rightClickErase = false;
  const touchPointers = new Map<number, { x: number; y: number }>();
  let pinchDistance: number | null = null;
  let selectionGesture: SelectionGesture | null = null;

  const currentPinchDistance = () => {
    const pointers = touchPointers.values();
    const first = pointers.next().value;
    const second = pointers.next().value;
    if (!first || !second) return null;
    return Math.hypot(first.x - second.x, first.y - second.y);
  };

  const cellCoordinates = (target: EventTarget | null) => {
    const candidate = target as {
      closest?: (selector: string) => HTMLElement | null;
    } | null;
    const cell = candidate?.closest?.(cellSelector);
    if (!cell || !grid.contains(cell)) return null;
    const rowValue = cell.dataset.row;
    const columnValue = cell.dataset.col;
    if (
      !rowValue ||
      !columnValue ||
      !GRID_COORDINATE_PATTERN.test(rowValue) ||
      !GRID_COORDINATE_PATTERN.test(columnValue)
    ) {
      return null;
    }

    const row = Number(rowValue);
    const column = Number(columnValue);
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(column) ||
      row < 0 ||
      column < 0 ||
      row >= rows ||
      column >= columns
    ) {
      return null;
    }
    return { row, column };
  };

  const strokeColor = (forceErase = false): StudioCell => {
    const policy = getPolicy();
    return forceErase || rightClickErase || shiftErase || policy.mode === "erase"
      ? null
      : policy.selectedColor;
  };

  const setEraseModifiers = (
    nextShiftErase: boolean,
    nextRightClickErase: boolean,
  ) => {
    const wasActive = rightClickErase || shiftErase;
    shiftErase = nextShiftErase;
    rightClickErase = nextRightClickErase;
    const isActive = rightClickErase || shiftErase;
    if (wasActive !== isActive) actions.onTemporaryEraseChange?.(isActive);
  };

  const removeTouchPointer = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return false;
    if (!touchPointers.delete(event.pointerId)) return false;
    pinchDistance = currentPinchDistance();
    return true;
  };

  const releasePointerCapture = (pointerId: number) => {
    if (grid.hasPointerCapture?.(pointerId)) {
      grid.releasePointerCapture(pointerId);
    }
  };

  const finishStroke = (commit: boolean, releaseCapture = true) => {
    if (activeStrokePointer === null) return;
    const pointerId = activeStrokePointer;
    activeStrokePointer = null;
    lastStrokeCell = null;
    try {
      if (commit) actions.commitStroke();
      else actions.cancelStroke();
    } finally {
      try {
        setEraseModifiers(shiftErase, false);
      } finally {
        if (releaseCapture) releasePointerCapture(pointerId);
      }
    }
  };

  const finishSelectionGesture = (releaseCapture = true) => {
    const gesture = selectionGesture;
    if (gesture === null) return;
    selectionGesture = null;
    try {
      if (gesture.kind === "move") actions.selection?.endMove?.();
      else actions.selection?.endSelect?.();
    } finally {
      if (releaseCapture) releasePointerCapture(gesture.pointerId);
    }
  };

  const rollbackStrokeStart = (event: PointerEvent, strokeBegan: boolean) => {
    activeStrokePointer = null;
    lastStrokeCell = null;
    removeTouchPointer(event);

    // Cleanup failures must not replace the error that aborted pointer startup.
    if (strokeBegan) {
      try {
        actions.cancelStroke();
      } catch {}
    }
    try {
      setEraseModifiers(shiftErase, false);
    } catch {}
    try {
      releasePointerCapture(event.pointerId);
    } catch {}
  };

  const beginSelectionGesture = (
    event: PointerEvent,
    policy: StudioInputPolicy,
    coordinates: { row: number; column: number },
  ) => {
    const selection = actions.selection;
    if (!selection || event.button !== 0 || selectionGesture !== null) return;

    event.preventDefault();
    const { row, column } = coordinates;
    const additive = event.shiftKey;
    const grabbedSelectedCell =
      !additive && (policy.isSelected?.(row, column) ?? false);
    const kind = grabbedSelectedCell ? "move" : "select";
    selectionGesture = {
      pointerId: event.pointerId,
      kind,
      additive,
      row,
      column,
      lastRow: row,
      lastColumn: column,
    };
    try {
      grid.setPointerCapture?.(event.pointerId);
      if (kind === "move") selection.beginMove(row, column);
      else selection.beginSelect(row, column, additive);
    } catch (error) {
      selectionGesture = null;
      // Cleanup failures must not replace the error that aborted the gesture.
      try {
        removeTouchPointer(event);
      } catch {}
      try {
        releasePointerCapture(event.pointerId);
      } catch {}
      throw error;
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    const policy = getPolicy();
    if (policy.overlay !== CLOSED_OVERLAY) return;
    if (event.pointerType === "touch") {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointers.size >= 2) {
        finishStroke(false, false);
        pinchDistance = currentPinchDistance();
        event.preventDefault();
        return;
      }
    }
    if (activeStrokePointer !== null) return;
    if (event.button !== 0 && event.button !== 2) return;
    const coordinates = cellCoordinates(event.target);
    if (!coordinates) return;

    // Shift starts a selection, and — once something is selected — a plain drag
    // from one of its cells moves it, without leaving the drawing tool.
    const shiftSelects = policy.shiftSelects === true;
    if (
      policy.mode === "select" ||
      (shiftSelects &&
        (event.shiftKey ||
          (policy.isSelected?.(coordinates.row, coordinates.column) ?? false)))
    ) {
      beginSelectionGesture(event, policy, coordinates);
      return;
    }

    event.preventDefault();
    activeStrokePointer = event.pointerId;
    let strokeBegan = false;
    try {
      setEraseModifiers(shiftErase, event.button === 2);
      grid.setPointerCapture?.(event.pointerId);
      const color = strokeColor();
      strokeBegan = true;
      lastStrokeCell = coordinates;
      actions.beginStroke(coordinates.row, coordinates.column, color);
    } catch (error) {
      rollbackStrokeStart(event, strokeBegan);
      throw error;
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touchPointers.has(event.pointerId)) {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointers.size >= 2) {
        event.preventDefault();
        const nextDistance = currentPinchDistance();
        if (nextDistance !== null) {
          if (nextDistance > 0 && pinchDistance !== null && pinchDistance > 0) {
            actions.applyPinchScale?.(nextDistance / pinchDistance);
          }
          pinchDistance = nextDistance;
        }
        return;
      }
    }
    if (selectionGesture !== null && event.pointerId === selectionGesture.pointerId) {
      const gesture = selectionGesture;
      const policy = getPolicy();
      if (
        policy.overlay !== CLOSED_OVERLAY ||
        (policy.mode !== "select" && policy.shiftSelects !== true)
      ) {
        finishSelectionGesture();
        return;
      }
      const target = documentTarget.elementFromPoint(event.clientX, event.clientY);
      const coordinates = cellCoordinates(target);
      if (
        !coordinates ||
        (coordinates.row === gesture.lastRow &&
          coordinates.column === gesture.lastColumn)
      ) {
        return;
      }
      if (gesture.kind === "move") {
        actions.selection?.moveTo(
          coordinates.row - gesture.row,
          coordinates.column - gesture.column,
        );
      } else {
        for (const { row, column } of cellsBetween(
          gesture.lastRow,
          gesture.lastColumn,
          coordinates.row,
          coordinates.column,
        )) {
          actions.selection?.extendSelect(row, column, gesture.additive);
        }
      }
      gesture.lastRow = coordinates.row;
      gesture.lastColumn = coordinates.column;
      return;
    }
    if (event.pointerId !== activeStrokePointer) return;
    if (getPolicy().overlay !== CLOSED_OVERLAY) {
      finishStroke(false);
      return;
    }
    const hitTarget = documentTarget.elementFromPoint(event.clientX, event.clientY);
    const coordinates = cellCoordinates(hitTarget);
    if (!coordinates) return;

    const color = strokeColor((event.buttons & 2) !== 0);
    const previous = lastStrokeCell;
    if (previous) {
      for (const { row, column } of cellsBetween(
        previous.row,
        previous.column,
        coordinates.row,
        coordinates.column,
      )) {
        actions.updateStroke(row, column, color);
      }
    } else {
      actions.updateStroke(coordinates.row, coordinates.column, color);
    }
    lastStrokeCell = coordinates;
  };

  const handlePointerUp = (event: PointerEvent) => {
    const removedTouch = removeTouchPointer(event);
    if (event.pointerId === selectionGesture?.pointerId) {
      finishSelectionGesture();
    } else if (event.pointerId === activeStrokePointer) finishStroke(true);
    else if (removedTouch) releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const removedTouch = removeTouchPointer(event);
    if (event.pointerId === selectionGesture?.pointerId) {
      finishSelectionGesture();
    } else if (event.pointerId === activeStrokePointer) finishStroke(false);
    else if (removedTouch) releasePointerCapture(event.pointerId);
  };

  const handleLostPointerCapture = (event: PointerEvent) => {
    removeTouchPointer(event);
    if (event.pointerId === selectionGesture?.pointerId) {
      finishSelectionGesture(false);
    } else if (event.pointerId === activeStrokePointer) {
      // Capture loss is not an abort: it means no more events are coming for a
      // stroke the user can already see. Keep those pixels. Browsers disagree
      // on whether this fires before or after pointerup, and discarding here
      // made a finished stroke vanish on release wherever it lands first.
      finishStroke(true, false);
    }
  };

  const cancelGesture = () => {
    try {
      finishStroke(false);
    } finally {
      try {
        // Ends the drag only — the selection itself survives blur and overlays.
        finishSelectionGesture();
      } finally {
        touchPointers.clear();
        pinchDistance = null;
        setEraseModifiers(false, false);
      }
    }
  };

  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === "hidden") cancelGesture();
  };

  const preventGridDefault = (event: Event) => event.preventDefault();

  const runShortcut = (shortcut: StudioShortcut, event: KeyboardEvent) => {
    if (shortcut.preventDefault) event.preventDefault();
    shortcut.run();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

    const policy = getPolicy();
    const overlay = policy.overlay;
    const key = event.key.toLowerCase();
    for (const shortcut of shortcuts) {
      if (
        shortcut.allowInEditable &&
        shortcut.key === key &&
        shortcutMatchesOverlay(shortcut, overlay)
      ) {
        runShortcut(shortcut, event);
        return;
      }
    }
    if (isEditableTarget(event.target)) return;

    const hasSystemModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (overlay !== CLOSED_OVERLAY) {
      if (hasSystemModifier) return;
      for (const shortcut of shortcuts) {
        if (
          !shortcut.allowInEditable &&
          shortcut.key === key &&
          shortcutMatchesOverlay(shortcut, overlay)
        ) {
          runShortcut(shortcut, event);
          return;
        }
      }
      return;
    }

    const selects = policy.mode === "select" || policy.shiftSelects === true;
    if (event.key === "Shift" && !hasSystemModifier) {
      // Where Shift selects, it must not also erase.
      if (!selects) setEraseModifiers(true, rightClickErase);
      return;
    }
    if (
      selects &&
      policy.hasSelection === true &&
      actions.selection &&
      !hasSystemModifier
    ) {
      const delta = ARROW_DELTAS[event.key];
      if (delta) {
        event.preventDefault();
        actions.selection.nudge(delta.row, delta.column);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        actions.selection.commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        actions.selection.cancel();
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        actions.selection.delete
      ) {
        // Backspace navigates back in some browsers — never let it, with cells
        // selected and a handler wired.
        event.preventDefault();
        actions.selection.delete();
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      if (key === "z" && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
      }
      return;
    }
    if (event.altKey) return;

    for (const shortcut of shortcuts) {
      if (
        !shortcut.allowInEditable &&
        shortcut.key === key &&
        shortcutMatchesOverlay(shortcut, CLOSED_OVERLAY)
      ) {
        runShortcut(shortcut, event);
        return;
      }
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Shift") setEraseModifiers(false, rightClickErase);
  };

  grid.addEventListener("pointerdown", handlePointerDown);
  grid.addEventListener("pointermove", handlePointerMove);
  grid.addEventListener("lostpointercapture", handleLostPointerCapture);
  grid.addEventListener("selectstart", preventGridDefault);
  grid.addEventListener("contextmenu", preventGridDefault);
  windowTarget.addEventListener("pointerup", handlePointerUp);
  windowTarget.addEventListener("pointercancel", handlePointerCancel);
  windowTarget.addEventListener("keydown", handleKeyDown);
  windowTarget.addEventListener("keyup", handleKeyUp);
  windowTarget.addEventListener("blur", cancelGesture);
  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    syncPolicy: () => {
      if (getPolicy().overlay !== CLOSED_OVERLAY) cancelGesture();
    },
    destroy: () => {
      try {
        cancelGesture();
      } finally {
        grid.removeEventListener("pointerdown", handlePointerDown);
        grid.removeEventListener("pointermove", handlePointerMove);
        grid.removeEventListener("lostpointercapture", handleLostPointerCapture);
        grid.removeEventListener("selectstart", preventGridDefault);
        grid.removeEventListener("contextmenu", preventGridDefault);
        windowTarget.removeEventListener("pointerup", handlePointerUp);
        windowTarget.removeEventListener("pointercancel", handlePointerCancel);
        windowTarget.removeEventListener("keydown", handleKeyDown);
        windowTarget.removeEventListener("keyup", handleKeyUp);
        windowTarget.removeEventListener("blur", cancelGesture);
        documentTarget.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    },
  };
}
