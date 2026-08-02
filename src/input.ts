import type { StudioCell } from "./grid.ts";

export type StudioInputPolicy = {
  overlay: string;
  mode: "draw" | "erase";
  selectedColor: string;
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
  let shiftErase = false;
  let rightClickErase = false;
  const touchPointers = new Map<number, { x: number; y: number }>();
  let pinchDistance: number | null = null;

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

  const finishStroke = (commit: boolean) => {
    if (activeStrokePointer === null) return;
    const pointerId = activeStrokePointer;
    activeStrokePointer = null;
    try {
      if (commit) actions.commitStroke();
      else actions.cancelStroke();
    } finally {
      try {
        setEraseModifiers(shiftErase, false);
      } finally {
        if (grid.hasPointerCapture?.(pointerId)) grid.releasePointerCapture(pointerId);
      }
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (getPolicy().overlay !== CLOSED_OVERLAY) return;
    if (event.pointerType === "touch") {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointers.size >= 2) {
        finishStroke(false);
        pinchDistance = currentPinchDistance();
        event.preventDefault();
        return;
      }
    }
    if (activeStrokePointer !== null) return;
    if (event.button !== 0 && event.button !== 2) return;
    const coordinates = cellCoordinates(event.target);
    if (!coordinates) return;

    event.preventDefault();
    activeStrokePointer = event.pointerId;
    setEraseModifiers(shiftErase, event.button === 2);
    grid.setPointerCapture?.(event.pointerId);
    actions.beginStroke(
      coordinates.row,
      coordinates.column,
      strokeColor(),
    );
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
    if (event.pointerId !== activeStrokePointer) return;
    if (getPolicy().overlay !== CLOSED_OVERLAY) {
      finishStroke(false);
      return;
    }
    const hitTarget = documentTarget.elementFromPoint(event.clientX, event.clientY);
    const coordinates = cellCoordinates(hitTarget);
    if (!coordinates) return;
    actions.updateStroke(
      coordinates.row,
      coordinates.column,
      strokeColor((event.buttons & 2) !== 0),
    );
  };

  const removeTouchPointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      touchPointers.delete(event.pointerId);
      if (touchPointers.size < 2) pinchDistance = null;
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    removeTouchPointer(event);
    if (event.pointerId === activeStrokePointer) finishStroke(true);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    removeTouchPointer(event);
    if (event.pointerId === activeStrokePointer) finishStroke(false);
  };

  const handleLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerId === activeStrokePointer) finishStroke(false);
  };

  const cancelGesture = () => {
    try {
      finishStroke(false);
    } finally {
      touchPointers.clear();
      pinchDistance = null;
      setEraseModifiers(false, false);
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

    const overlay = getPolicy().overlay;
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

    if (event.key === "Shift" && !hasSystemModifier) {
      setEraseModifiers(true, rightClickErase);
      return;
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
