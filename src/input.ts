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
  onShiftEraseChange?: (active: boolean) => void;
  onRightClickEraseChange?: (active: boolean) => void;
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
  let activeStrokePointer: number | null = null;
  let shiftErase = false;
  let rightClickErase = false;
  const touchPointers = new Map<number, { x: number; y: number }>();
  let pinchDistance: number | null = null;

  const currentPinchDistance = () => {
    const [first, second] = Array.from(touchPointers.values());
    if (!first || !second) return null;
    return Math.hypot(first.x - second.x, first.y - second.y);
  };

  const cellCoordinates = (target: EventTarget | null) => {
    const candidate = target as {
      closest?: (selector: string) => HTMLElement | null;
    } | null;
    const cell = candidate?.closest?.(cellSelector);
    if (!cell || !grid.contains(cell)) return null;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.col);
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

  const resetEraseModifiers = () => {
    if (rightClickErase) actions.onRightClickEraseChange?.(false);
    if (shiftErase) actions.onShiftEraseChange?.(false);
    rightClickErase = false;
    shiftErase = false;
  };

  const finishStroke = (commit: boolean) => {
    if (activeStrokePointer === null) return;
    const pointerId = activeStrokePointer;
    activeStrokePointer = null;
    if (commit) actions.commitStroke();
    else actions.cancelStroke();
    if (rightClickErase) actions.onRightClickEraseChange?.(false);
    rightClickErase = false;
    if (grid.hasPointerCapture?.(pointerId)) grid.releasePointerCapture(pointerId);
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
    rightClickErase = event.button === 2;
    if (rightClickErase) actions.onRightClickEraseChange?.(true);
    grid.setPointerCapture?.(event.pointerId);
    actions.beginStroke(
      coordinates.row,
      coordinates.column,
      strokeColor(rightClickErase),
    );
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touchPointers.has(event.pointerId)) {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointers.size >= 2) {
        const nextDistance = currentPinchDistance();
        if (nextDistance !== null && pinchDistance !== null && pinchDistance > 0) {
          event.preventDefault();
          actions.applyPinchScale?.(nextDistance / pinchDistance);
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

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      touchPointers.delete(event.pointerId);
      if (touchPointers.size < 2) pinchDistance = null;
    }
    if (event.pointerId === activeStrokePointer) finishStroke(true);
  };

  const cancelGesture = () => {
    finishStroke(false);
    touchPointers.clear();
    pinchDistance = null;
    resetEraseModifiers();
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
      shiftErase = true;
      actions.onShiftEraseChange?.(true);
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
    if (event.key === "Shift") {
      shiftErase = false;
      actions.onShiftEraseChange?.(false);
    }
  };

  grid.addEventListener("pointerdown", handlePointerDown);
  grid.addEventListener("pointermove", handlePointerMove);
  grid.addEventListener("lostpointercapture", handlePointerUp);
  grid.addEventListener("selectstart", preventGridDefault);
  grid.addEventListener("contextmenu", preventGridDefault);
  windowTarget.addEventListener("pointerup", handlePointerUp);
  windowTarget.addEventListener("pointercancel", handlePointerUp);
  windowTarget.addEventListener("keydown", handleKeyDown);
  windowTarget.addEventListener("keyup", handleKeyUp);
  windowTarget.addEventListener("blur", cancelGesture);
  documentTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    syncPolicy: () => {
      if (getPolicy().overlay !== CLOSED_OVERLAY) cancelGesture();
    },
    destroy: () => {
      cancelGesture();
      grid.removeEventListener("pointerdown", handlePointerDown);
      grid.removeEventListener("pointermove", handlePointerMove);
      grid.removeEventListener("lostpointercapture", handlePointerUp);
      grid.removeEventListener("selectstart", preventGridDefault);
      grid.removeEventListener("contextmenu", preventGridDefault);
      windowTarget.removeEventListener("pointerup", handlePointerUp);
      windowTarget.removeEventListener("pointercancel", handlePointerUp);
      windowTarget.removeEventListener("keydown", handleKeyDown);
      windowTarget.removeEventListener("keyup", handleKeyUp);
      windowTarget.removeEventListener("blur", cancelGesture);
      documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}
