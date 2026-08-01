import assert from "node:assert/strict";
import test from "node:test";
import {
  bindStudioInput,
  type StudioInputActions,
  type StudioShortcut,
} from "../src/input.ts";

type Listener = (event: Event) => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeGrid extends FakeEventTarget {
  readonly cells = new Set<object>();

  contains(target: object) {
    return this.cells.has(target);
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeDocument extends FakeEventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  hitTarget: object | null = null;

  elementFromPoint() {
    return this.hitTarget;
  }
}

function createActions(
  overrides: Partial<StudioInputActions> = {},
): StudioInputActions {
  return {
    beginStroke: () => undefined,
    updateStroke: () => undefined,
    commitStroke: () => undefined,
    cancelStroke: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    ...overrides,
  };
}

function keyboardEvent(
  key: string,
  target: { tagName: string },
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    target,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: () => undefined,
    ...overrides,
  } as unknown as KeyboardEvent;
}

function cell(row: number, column: number) {
  const target = {
    dataset: { row: String(row), col: String(column) },
    closest: () => target,
  };
  return target;
}

function pointerEvent(
  target: object,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    target,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
    preventDefault: () => undefined,
    ...overrides,
  } as unknown as PointerEvent;
}

type Binding = ReturnType<typeof bindStudioInput>;

function bind(options: {
  grid?: FakeGrid;
  windowTarget?: FakeEventTarget;
  documentTarget?: FakeDocument;
  overlay?: () => string;
  actions?: Partial<StudioInputActions>;
  shortcuts?: readonly StudioShortcut[];
  rows?: number;
  columns?: number;
}): Binding {
  return bindStudioInput({
    grid: (options.grid ?? new FakeGrid()) as unknown as HTMLElement,
    rows: options.rows ?? 8,
    columns: options.columns ?? 8,
    windowTarget: (options.windowTarget ??
      new FakeEventTarget()) as unknown as Window,
    documentTarget: (options.documentTarget ??
      new FakeDocument()) as unknown as Document,
    getPolicy: () => ({
      overlay: options.overlay?.() ?? "none",
      mode: "draw",
      selectedColor: "#123456",
    }),
    actions: createActions(options.actions),
    shortcuts: options.shortcuts,
  });
}

test("runs configured shortcuts only in their declared overlays", () => {
  const windowTarget = new FakeEventTarget();
  let overlay = "none";
  const calls: string[] = [];
  const binding = bind({
    windowTarget,
    overlay: () => overlay,
    shortcuts: [
      { key: "p", run: () => calls.push("palette") },
      {
        key: "m",
        overlays: ["none", "menu"],
        run: () => calls.push("menu"),
      },
      {
        key: "escape",
        overlays: ["menu"],
        allowInEditable: true,
        run: () => calls.push("close"),
      },
    ],
  });
  const body = { tagName: "BODY" };

  windowTarget.emit("keydown", keyboardEvent("p", body));
  windowTarget.emit("keydown", keyboardEvent("m", body));
  overlay = "menu";
  windowTarget.emit("keydown", keyboardEvent("p", body));
  windowTarget.emit("keydown", keyboardEvent("m", body));
  windowTarget.emit("keydown", keyboardEvent("Escape", { tagName: "INPUT" }));
  overlay = "other-overlay";
  windowTarget.emit("keydown", keyboardEvent("m", body));

  assert.deepEqual(calls, ["palette", "menu", "menu", "close"]);
  binding.destroy();
});

test("keeps shortcuts native inside editable targets and system shortcuts", () => {
  const windowTarget = new FakeEventTarget();
  const calls: string[] = [];
  let prevented = 0;
  const binding = bind({
    windowTarget,
    actions: {
      undo: () => calls.push("undo"),
      redo: () => calls.push("redo"),
    },
    shortcuts: [
      {
        key: "s",
        preventDefault: true,
        run: () => calls.push("save"),
      },
    ],
  });
  const emit = (
    key: string,
    target: { tagName: string },
    overrides: Partial<KeyboardEvent> = {},
  ) =>
    windowTarget.emit(
      "keydown",
      keyboardEvent(key, target, {
        preventDefault: () => (prevented += 1),
        ...overrides,
      }),
    );

  emit("s", { tagName: "INPUT" });
  emit("s", { tagName: "BODY" }, { metaKey: true });
  emit("s", { tagName: "BODY" });
  emit("z", { tagName: "BODY" }, { metaKey: true });
  emit("z", { tagName: "BODY" }, { ctrlKey: true, shiftKey: true });

  assert.deepEqual(calls, ["save", "undo", "redo"]);
  assert.equal(prevented, 3);
  binding.destroy();
});

test("delegates a pointer stroke and commits it exactly once", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const first = cell(1, 2);
  const second = cell(1, 3);
  grid.cells.add(first);
  grid.cells.add(second);
  documentTarget.hitTarget = second;
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    actions: {
      beginStroke: (row, column, color) =>
        calls.push(`begin:${row},${column}:${color}`),
      updateStroke: (row, column, color) =>
        calls.push(`update:${row},${column}:${color}`),
      commitStroke: () => calls.push("commit"),
    },
  });

  grid.emit("pointerdown", pointerEvent(first));
  grid.emit("pointermove", pointerEvent(grid));
  windowTarget.emit("pointerup", pointerEvent(grid, { buttons: 0 }));
  grid.emit("lostpointercapture", pointerEvent(grid, { buttons: 0 }));

  assert.deepEqual(calls, [
    "begin:1,2:#123456",
    "update:1,3:#123456",
    "commit",
  ]);
  binding.destroy();
});

test("rejects cells outside the configured grid bounds", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const inBounds = cell(1, 2);
  const outOfBounds = cell(2, 3);
  grid.cells.add(inBounds);
  grid.cells.add(outOfBounds);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    rows: 2,
    columns: 3,
    actions: {
      beginStroke: (row, column) => calls.push(`begin:${row},${column}`),
      commitStroke: () => calls.push("commit"),
    },
  });

  grid.emit("pointerdown", pointerEvent(outOfBounds));
  grid.emit("pointerdown", pointerEvent(inBounds));
  windowTarget.emit("pointerup", pointerEvent(grid, { buttons: 0 }));

  assert.deepEqual(calls, ["begin:1,2", "commit"]);
  binding.destroy();
});

test("right-click and held Shift erase while optional callbacks stay optional", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(4, 5);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: (row, column, color) =>
        calls.push(`begin:${row},${column}:${color}`),
      commitStroke: () => calls.push("commit"),
    },
  });

  grid.emit("pointerdown", pointerEvent(target, { button: 2, buttons: 2 }));
  windowTarget.emit("pointerup", pointerEvent(grid, { button: 2, buttons: 0 }));
  windowTarget.emit("keydown", keyboardEvent("Shift", { tagName: "BODY" }));
  grid.emit("pointerdown", pointerEvent(target, { pointerId: 2 }));
  windowTarget.emit(
    "pointerup",
    pointerEvent(grid, { pointerId: 2, buttons: 0 }),
  );

  assert.deepEqual(calls, [
    "begin:4,5:null",
    "commit",
    "begin:4,5:null",
    "commit",
  ]);
  binding.destroy();
});

test("cancels gestures on blur and removes every listener on destroy", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const target = cell(6, 7);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    actions: {
      beginStroke: () => calls.push("begin"),
      cancelStroke: () => calls.push("cancel"),
    },
  });

  grid.emit("pointerdown", pointerEvent(target));
  windowTarget.emit("blur", {} as Event);
  binding.destroy();

  assert.deepEqual(calls, ["begin", "cancel"]);
  assert.equal(grid.listenerCount("pointerdown"), 0);
  assert.equal(windowTarget.listenerCount("keydown"), 0);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
});
