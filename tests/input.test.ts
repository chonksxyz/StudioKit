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
  captureError: Error | null = null;
  private readonly pointerTypes = new Map<number, string>();
  private readonly capturedPointers = new Set<number>();

  contains(target: object) {
    return this.cells.has(target);
  }

  override emit(type: string, event: Event) {
    if (type === "pointerdown") {
      const pointerEvent = event as PointerEvent;
      this.pointerTypes.set(pointerEvent.pointerId, pointerEvent.pointerType);
    }
    super.emit(type, event);
  }

  setPointerCapture(pointerId: number) {
    this.capturedPointers.add(pointerId);
    if (this.captureError) throw this.captureError;
  }

  hasPointerCapture(pointerId: number) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number) {
    const pointerType = this.pointerTypes.get(pointerId) ?? "mouse";
    this.capturedPointers.delete(pointerId);
    this.emit(
      "lostpointercapture",
      pointerEvent(this, { pointerId, pointerType, buttons: 0 }),
    );
  }
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
  target: object,
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
  mode?: () => "draw" | "erase" | "select";
  isSelected?: (row: number, column: number) => boolean;
  hasSelection?: () => boolean;
  shiftSelects?: boolean;
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
      mode: options.mode?.() ?? "draw",
      selectedColor: "#123456",
      isSelected: options.isSelected,
      hasSelection: options.hasSelection?.() ?? false,
      shiftSelects: options.shiftSelects,
    }),
    actions: createActions(options.actions),
    shortcuts: options.shortcuts,
  });
}

test("rejects invalid input grid dimensions", () => {
  assert.throws(() => bind({ rows: 0 }), /positive integer dimensions/);
  assert.throws(() => bind({ columns: 1.5 }), /positive integer dimensions/);
});

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

test("ignores nested contenteditable and in-progress IME keyboard events", () => {
  const windowTarget = new FakeEventTarget();
  const calls: string[] = [];
  const binding = bind({
    windowTarget,
    shortcuts: [{ key: "s", run: () => calls.push("save") }],
  });
  const body = { tagName: "BODY" };
  const contenteditableChild = {
    tagName: "SPAN",
    closest: () => ({}) as Element,
  };

  windowTarget.emit("keydown", keyboardEvent("s", contenteditableChild));
  windowTarget.emit(
    "keydown",
    keyboardEvent("s", body, { isComposing: true }),
  );
  windowTarget.emit("keydown", keyboardEvent("s", body, { keyCode: 229 }));

  assert.deepEqual(calls, []);
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

test("cancels a stroke when the browser cancels its pointer stream", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 2);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: () => calls.push("begin"),
      commitStroke: () => calls.push("commit"),
      cancelStroke: () => calls.push("cancel"),
    },
  });

  grid.emit("pointerdown", pointerEvent(target));
  windowTarget.emit("pointercancel", pointerEvent(grid, { buttons: 0 }));

  assert.deepEqual(calls, ["begin", "cancel"]);
  binding.destroy();
});

test("transitions a captured one-finger stroke into a pinch gesture", () => {
  const grid = new FakeGrid();
  const target = cell(1, 2);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    actions: {
      beginStroke: () => calls.push("begin"),
      cancelStroke: () => calls.push("cancel"),
      applyPinchScale: (factor) => calls.push(`pinch:${factor}`),
    },
  });

  grid.emit(
    "pointerdown",
    pointerEvent(target, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    }),
  );
  grid.emit(
    "pointerdown",
    pointerEvent(target, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 10,
      clientY: 0,
    }),
  );
  grid.emit(
    "pointermove",
    pointerEvent(target, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 20,
      clientY: 0,
    }),
  );

  assert.deepEqual(calls, ["begin", "cancel", "pinch:2"]);
  binding.destroy();
});

test("recovers a pinch after two touch points start at the same position", () => {
  const grid = new FakeGrid();
  const target = cell(1, 2);
  grid.cells.add(target);
  const factors: number[] = [];
  const binding = bind({
    grid,
    actions: {
      applyPinchScale: (factor) => factors.push(factor),
    },
  });

  grid.emit(
    "pointerdown",
    pointerEvent(target, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    }),
  );
  grid.emit(
    "pointerdown",
    pointerEvent(target, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    }),
  );
  grid.emit(
    "pointermove",
    pointerEvent(target, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 10,
      clientY: 0,
    }),
  );
  grid.emit(
    "pointermove",
    pointerEvent(target, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 20,
      clientY: 0,
    }),
  );

  assert.deepEqual(factors, [2]);
  binding.destroy();
});

test("resets pinch distance when touch membership changes", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 2);
  grid.cells.add(target);
  const factors: number[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      applyPinchScale: (factor) => factors.push(factor),
    },
  });
  const touch = (pointerId: number, clientX: number) =>
    pointerEvent(target, {
      pointerId,
      pointerType: "touch",
      clientX,
      clientY: 0,
    });

  grid.emit("pointerdown", touch(1, 0));
  grid.emit("pointerdown", touch(2, 10));
  grid.emit("pointerdown", touch(3, 100));
  windowTarget.emit("pointerup", touch(1, 0));
  grid.emit("pointermove", touch(3, 110));

  assert.equal(factors.length, 1);
  assert.ok(Math.abs(factors[0] - 100 / 90) < Number.EPSILON);
  binding.destroy();
});

test("keeps an active stroke's pixels when pointer capture is lost", () => {
  const grid = new FakeGrid();
  const target = cell(1, 2);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    actions: {
      beginStroke: () => calls.push("begin"),
      commitStroke: () => calls.push("commit"),
      cancelStroke: () => calls.push("cancel"),
    },
  });

  grid.emit("pointerdown", pointerEvent(target));
  grid.emit("lostpointercapture", pointerEvent(grid));

  // Losing capture only means no more events are coming — the user can already
  // see these pixels, and browsers disagree on whether this fires before or
  // after pointerup, so discarding here would drop finished strokes.
  assert.deepEqual(calls, ["begin", "commit"]);
  binding.destroy();
});

test("removes a touch whose pointer capture is lost", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 2);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: () => calls.push("begin"),
      commitStroke: () => calls.push("commit"),
      cancelStroke: () => calls.push("cancel"),
    },
  });
  const touch = (pointerId: number) =>
    pointerEvent(target, { pointerId, pointerType: "touch" });

  grid.emit("pointerdown", touch(1));
  grid.emit("lostpointercapture", touch(1));
  grid.emit("pointerdown", touch(2));
  windowTarget.emit("pointerup", touch(2));

  assert.deepEqual(calls, ["begin", "commit", "begin", "commit"]);
  binding.destroy();
});

test("rejects cells outside the configured grid bounds", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const inBounds = cell(1, 2);
  const outOfBounds = cell(2, 3);
  const emptyCoordinate = cell(0, 0);
  emptyCoordinate.dataset.row = "";
  grid.cells.add(inBounds);
  grid.cells.add(outOfBounds);
  grid.cells.add(emptyCoordinate);
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
  grid.emit("pointerdown", pointerEvent(emptyCoordinate));
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

test("reports aggregate temporary erase state across overlapping inputs", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(4, 5);
  grid.cells.add(target);
  const eraseStates: boolean[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      onTemporaryEraseChange: (active) => eraseStates.push(active),
    },
  });

  windowTarget.emit("keydown", keyboardEvent("Shift", { tagName: "BODY" }));
  grid.emit("pointerdown", pointerEvent(target, { button: 2, buttons: 2 }));
  windowTarget.emit("pointerup", pointerEvent(grid, { button: 2, buttons: 0 }));
  windowTarget.emit("keyup", keyboardEvent("Shift", { tagName: "BODY" }));

  assert.deepEqual(eraseStates, [true, false]);
  binding.destroy();
});

test("releases pointer state when a stroke completion callback throws", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(4, 5);
  grid.cells.add(target);
  const eraseStates: boolean[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      commitStroke: () => {
        throw new Error("commit failed");
      },
      onTemporaryEraseChange: (active) => eraseStates.push(active),
    },
  });

  grid.emit("pointerdown", pointerEvent(target, { button: 2, buttons: 2 }));
  assert.throws(
    () =>
      windowTarget.emit(
        "pointerup",
        pointerEvent(grid, { button: 2, buttons: 0 }),
      ),
    /commit failed/,
  );

  assert.deepEqual(eraseStates, [true, false]);
  assert.equal(grid.hasPointerCapture(1), false);
  binding.destroy();
});

test("rolls back pointer state when temporary erase setup throws", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(4, 5);
  grid.cells.add(target);
  const calls: string[] = [];
  let failEraseSetup = true;
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: () => calls.push("begin"),
      commitStroke: () => calls.push("commit"),
      onTemporaryEraseChange: (active) => {
        calls.push(`erase:${active}`);
        if (active && failEraseSetup) {
          failEraseSetup = false;
          throw new Error("erase setup failed");
        }
      },
    },
  });

  assert.throws(
    () =>
      grid.emit(
        "pointerdown",
        pointerEvent(target, { button: 2, buttons: 2 }),
      ),
    /erase setup failed/,
  );
  assert.equal(grid.hasPointerCapture(1), false);
  windowTarget.emit("pointerup", pointerEvent(grid, { buttons: 0 }));
  grid.emit("pointerdown", pointerEvent(target, { pointerId: 2 }));
  windowTarget.emit(
    "pointerup",
    pointerEvent(grid, { pointerId: 2, buttons: 0 }),
  );

  assert.deepEqual(calls, ["erase:true", "erase:false", "begin", "commit"]);
  binding.destroy();
});

test("rolls back pointer state when capture setup throws", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(4, 5);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: () => calls.push("begin"),
      commitStroke: () => calls.push("commit"),
    },
  });
  grid.captureError = new Error("capture failed");

  assert.throws(
    () => grid.emit("pointerdown", pointerEvent(target)),
    /capture failed/,
  );
  assert.equal(grid.hasPointerCapture(1), false);
  windowTarget.emit("pointerup", pointerEvent(grid, { buttons: 0 }));
  grid.captureError = null;
  grid.emit("pointerdown", pointerEvent(target, { pointerId: 2 }));
  windowTarget.emit(
    "pointerup",
    pointerEvent(grid, { pointerId: 2, buttons: 0 }),
  );

  assert.deepEqual(calls, ["begin", "commit"]);
  binding.destroy();
});

test("preserves a stroke-start error while rolling back partial actions", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(4, 5);
  grid.cells.add(target);
  const calls: string[] = [];
  let failStrokeStart = true;
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: () => {
        calls.push("begin");
        if (failStrokeStart) {
          failStrokeStart = false;
          throw new Error("begin failed");
        }
      },
      cancelStroke: () => {
        calls.push("cancel");
        throw new Error("cleanup failed");
      },
      commitStroke: () => calls.push("commit"),
    },
  });

  assert.throws(
    () => grid.emit("pointerdown", pointerEvent(target)),
    /begin failed/,
  );
  assert.equal(grid.hasPointerCapture(1), false);
  windowTarget.emit("pointerup", pointerEvent(grid, { buttons: 0 }));
  grid.emit("pointerdown", pointerEvent(target, { pointerId: 2 }));
  windowTarget.emit(
    "pointerup",
    pointerEvent(grid, { pointerId: 2, buttons: 0 }),
  );

  // A stroke that never started is rolled back, not committed.
  assert.deepEqual(calls, ["begin", "cancel", "begin", "commit"]);
  binding.destroy();
});

test("cancels active strokes when the tab hides or an overlay opens", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const target = cell(4, 5);
  grid.cells.add(target);
  const calls: string[] = [];
  let overlay = "none";
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    overlay: () => overlay,
    actions: {
      beginStroke: () => calls.push("begin"),
      cancelStroke: () => calls.push("cancel"),
    },
  });

  grid.emit("pointerdown", pointerEvent(target));
  documentTarget.visibilityState = "hidden";
  documentTarget.emit("visibilitychange", {} as Event);
  documentTarget.visibilityState = "visible";
  grid.emit("pointerdown", pointerEvent(target, { pointerId: 2 }));
  overlay = "menu";
  binding.syncPolicy();

  assert.deepEqual(calls, ["begin", "cancel", "begin", "cancel"]);
  assert.equal(grid.hasPointerCapture(1), false);
  assert.equal(grid.hasPointerCapture(2), false);
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

test("removes every listener when cancellation throws during destroy", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const target = cell(6, 7);
  grid.cells.add(target);
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    actions: {
      cancelStroke: () => {
        throw new Error("cancel failed");
      },
    },
  });

  grid.emit("pointerdown", pointerEvent(target));
  assert.throws(() => binding.destroy(), /cancel failed/);

  assert.equal(grid.hasPointerCapture(1), false);
  assert.equal(grid.listenerCount("pointerdown"), 0);
  assert.equal(windowTarget.listenerCount("keydown"), 0);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
});

function selectionActions(calls: string[]) {
  return {
    beginSelect: (row: number, column: number, additive: boolean) =>
      calls.push(`begin-select:${row},${column}:${additive}`),
    extendSelect: (row: number, column: number, additive: boolean) =>
      calls.push(`extend-select:${row},${column}:${additive}`),
    endSelect: () => calls.push("end-select"),
    beginMove: (row: number, column: number) =>
      calls.push(`begin-move:${row},${column}`),
    moveTo: (rowOffset: number, columnOffset: number) =>
      calls.push(`move-to:${rowOffset},${columnOffset}`),
    endMove: () => calls.push("end-move"),
    nudge: (rowDelta: number, columnDelta: number) =>
      calls.push(`nudge:${rowDelta},${columnDelta}`),
    commit: () => calls.push("commit"),
    cancel: () => calls.push("cancel"),
  };
}

test("shift-drags a multi-cell selection instead of drawing", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const first = cell(1, 1);
  const second = cell(1, 2);
  grid.cells.add(first);
  grid.cells.add(second);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    mode: () => "select",
    actions: {
      beginStroke: () => calls.push("draw"),
      selection: selectionActions(calls),
    },
  });

  grid.emit("pointerdown", pointerEvent(first, { shiftKey: true }));
  documentTarget.hitTarget = second;
  grid.emit("pointermove", pointerEvent(second));
  grid.emit("pointermove", pointerEvent(second)); // same cell, no repeat
  windowTarget.emit("pointerup", pointerEvent(second, { buttons: 0 }));

  assert.deepEqual(calls, [
    "begin-select:1,1:true",
    "extend-select:1,2:true",
    "end-select",
  ]);
  binding.destroy();
});

test("drags an existing selection by grabbing one of its cells", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const grabbed = cell(1, 1);
  const dropped = cell(3, 2);
  grid.cells.add(grabbed);
  grid.cells.add(dropped);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    mode: () => "select",
    isSelected: (row, column) => row === 1 && column === 1,
    actions: { selection: selectionActions(calls) },
  });

  grid.emit("pointerdown", pointerEvent(grabbed));
  documentTarget.hitTarget = dropped;
  grid.emit("pointermove", pointerEvent(dropped));
  windowTarget.emit("pointerup", pointerEvent(dropped, { buttons: 0 }));

  assert.deepEqual(calls, ["begin-move:1,1", "move-to:2,1", "end-move"]);
  binding.destroy();
});

test("shift-clicking a selected cell keeps selecting instead of moving", () => {
  const grid = new FakeGrid();
  const target = cell(1, 1);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    mode: () => "select",
    isSelected: () => true,
    actions: { selection: selectionActions(calls) },
  });

  grid.emit("pointerdown", pointerEvent(target, { shiftKey: true }));

  assert.deepEqual(calls, ["begin-select:1,1:true"]);
  binding.destroy();
});

test("select mode suppresses drawing and shift-to-erase", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 1);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    mode: () => "select",
    actions: {
      beginStroke: () => calls.push("draw"),
      onTemporaryEraseChange: (active) => calls.push(`erase:${active}`),
      selection: selectionActions(calls),
    },
  });

  windowTarget.emit("keydown", keyboardEvent("Shift", { tagName: "BODY" }));
  grid.emit("pointerdown", pointerEvent(target, { button: 2, buttons: 2 }));

  assert.deepEqual(calls, []);
  binding.destroy();
});

test("moves, commits, and cancels a selection from the keyboard", () => {
  const windowTarget = new FakeEventTarget();
  const calls: string[] = [];
  let hasSelection = false;
  const prevented: string[] = [];
  const binding = bind({
    windowTarget,
    mode: () => "select",
    hasSelection: () => hasSelection,
    actions: { selection: selectionActions(calls) },
  });
  const body = { tagName: "BODY" };
  const press = (key: string, overrides: Partial<KeyboardEvent> = {}) =>
    windowTarget.emit(
      "keydown",
      keyboardEvent(key, body, {
        preventDefault: () => prevented.push(key),
        ...overrides,
      }),
    );

  press("ArrowRight");
  assert.deepEqual(calls, []); // nothing selected yet

  hasSelection = true;
  press("ArrowRight");
  press("ArrowUp");
  press("Enter");
  press("Escape");
  press("ArrowLeft", { metaKey: true }); // system chords pass through

  assert.deepEqual(calls, ["nudge:0,1", "nudge:-1,0", "commit", "cancel"]);
  assert.deepEqual(prevented, ["ArrowRight", "ArrowUp", "Enter", "Escape"]);
  binding.destroy();
});

test("ends a selection drag on blur without discarding the selection", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 1);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    mode: () => "select",
    isSelected: () => true,
    actions: { selection: selectionActions(calls) },
  });

  grid.emit("pointerdown", pointerEvent(target));
  windowTarget.emit("blur", new Event("blur"));

  assert.deepEqual(calls, ["begin-move:1,1", "end-move"]);
  binding.destroy();
  assert.deepEqual(calls, ["begin-move:1,1", "end-move"]);
});

test("shift selects instead of erasing while drawing", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const first = cell(1, 1);
  const second = cell(1, 2);
  grid.cells.add(first);
  grid.cells.add(second);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    shiftSelects: true,
    actions: {
      beginStroke: (row, column) => calls.push(`draw:${row},${column}`),
      onTemporaryEraseChange: (active) => calls.push(`erase:${active}`),
      selection: selectionActions(calls),
    },
  });

  // Shift down no longer arms the eraser…
  windowTarget.emit("keydown", keyboardEvent("Shift", { tagName: "BODY" }));
  // …it selects, and keeps selecting across a drag.
  grid.emit("pointerdown", pointerEvent(first, { shiftKey: true }));
  documentTarget.hitTarget = second;
  grid.emit("pointermove", pointerEvent(second, { shiftKey: true }));
  windowTarget.emit("pointerup", pointerEvent(second, { buttons: 0 }));
  // An unshifted click on empty canvas still draws.
  grid.emit("pointerdown", pointerEvent(second));

  assert.deepEqual(calls, [
    "begin-select:1,1:true",
    "extend-select:1,2:true",
    "end-select",
    "draw:1,2",
  ]);
  binding.destroy();
});

test("drags a selection from the drawing tool without holding shift", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const grabbed = cell(1, 1);
  const dropped = cell(2, 1);
  grid.cells.add(grabbed);
  grid.cells.add(dropped);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    shiftSelects: true,
    isSelected: (row, column) => row === 1 && column === 1,
    actions: {
      beginStroke: (row, column) => calls.push(`draw:${row},${column}`),
      selection: selectionActions(calls),
    },
  });

  grid.emit("pointerdown", pointerEvent(grabbed));
  documentTarget.hitTarget = dropped;
  grid.emit("pointermove", pointerEvent(dropped));
  windowTarget.emit("pointerup", pointerEvent(dropped, { buttons: 0 }));

  assert.deepEqual(calls, ["begin-move:1,1", "move-to:1,0", "end-move"]);
  binding.destroy();
});

test("arms the selection keys outside select mode when shift selects", () => {
  const windowTarget = new FakeEventTarget();
  const calls: string[] = [];
  let hasSelection = true;
  const binding = bind({
    windowTarget,
    shiftSelects: true,
    hasSelection: () => hasSelection,
    actions: { selection: selectionActions(calls) },
  });
  const body = { tagName: "BODY" };

  windowTarget.emit("keydown", keyboardEvent("ArrowDown", body));
  windowTarget.emit("keydown", keyboardEvent("Escape", body));
  hasSelection = false;
  windowTarget.emit("keydown", keyboardEvent("ArrowDown", body));

  assert.deepEqual(calls, ["nudge:1,0", "cancel"]);
  binding.destroy();
});

test("leaves shift erasing when shift-select is not enabled", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 1);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    isSelected: () => true,
    actions: {
      beginStroke: (row, column, color) => calls.push(`draw:${row},${column}:${color}`),
      onTemporaryEraseChange: (active) => calls.push(`erase:${active}`),
      selection: selectionActions(calls),
    },
  });

  windowTarget.emit("keydown", keyboardEvent("Shift", { tagName: "BODY" }));
  grid.emit("pointerdown", pointerEvent(target, { shiftKey: true }));

  assert.deepEqual(calls, ["erase:true", "draw:1,1:null"]);
  binding.destroy();
});

test("deletes the selected cells on Delete or Backspace", () => {
  const windowTarget = new FakeEventTarget();
  const calls: string[] = [];
  const prevented: string[] = [];
  let hasSelection = true;
  const binding = bind({
    windowTarget,
    shiftSelects: true,
    hasSelection: () => hasSelection,
    actions: {
      selection: { ...selectionActions(calls), delete: () => calls.push("delete") },
    },
  });
  const body = { tagName: "BODY" };
  const press = (key: string) =>
    windowTarget.emit(
      "keydown",
      keyboardEvent(key, body, { preventDefault: () => prevented.push(key) }),
    );

  press("Delete");
  press("Backspace");

  // With nothing selected both keys stay native — no handler, no preventDefault.
  hasSelection = false;
  press("Delete");
  press("Backspace");

  assert.deepEqual(calls, ["delete", "delete"]);
  assert.deepEqual(prevented, ["Delete", "Backspace"]);
  binding.destroy();
});

test("leaves Delete alone when no delete handler is wired", () => {
  const windowTarget = new FakeEventTarget();
  const calls: string[] = [];
  const prevented: string[] = [];
  const binding = bind({
    windowTarget,
    shiftSelects: true,
    hasSelection: () => true,
    actions: { selection: selectionActions(calls) },
  });

  windowTarget.emit(
    "keydown",
    keyboardEvent("Delete", { tagName: "BODY" }, {
      preventDefault: () => prevented.push("Delete"),
    }),
  );

  assert.deepEqual(calls, []);
  assert.deepEqual(prevented, []);
  binding.destroy();
});

test("fills the cells between pointer samples so fast strokes stay connected", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const start = cell(0, 0);
  const far = cell(3, 3);
  const sideways = cell(3, 6);
  grid.cells.add(start);
  grid.cells.add(far);
  grid.cells.add(sideways);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    actions: {
      beginStroke: (row, column) => calls.push(`${row},${column}`),
      updateStroke: (row, column) => calls.push(`${row},${column}`),
    },
  });

  grid.emit("pointerdown", pointerEvent(start));
  // One sample three cells away diagonally, then one three cells sideways.
  documentTarget.hitTarget = far;
  grid.emit("pointermove", pointerEvent(far));
  documentTarget.hitTarget = sideways;
  grid.emit("pointermove", pointerEvent(sideways));
  windowTarget.emit("pointerup", pointerEvent(sideways, { buttons: 0 }));

  assert.deepEqual(calls, [
    "0,0",
    "1,1",
    "2,2",
    "3,3",
    "3,4",
    "3,5",
    "3,6",
  ]);
  binding.destroy();
});

test("starts each stroke's interpolation from its own first cell", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const first = cell(0, 0);
  const second = cell(0, 2);
  const third = cell(5, 5);
  for (const target of [first, second, third]) grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    actions: {
      beginStroke: (row, column) => calls.push(`begin:${row},${column}`),
      updateStroke: (row, column) => calls.push(`update:${row},${column}`),
    },
  });

  grid.emit("pointerdown", pointerEvent(first));
  documentTarget.hitTarget = second;
  grid.emit("pointermove", pointerEvent(second));
  windowTarget.emit("pointerup", pointerEvent(second, { buttons: 0 }));

  // A new stroke far away must not draw a line from where the last one ended.
  grid.emit("pointerdown", pointerEvent(third));
  windowTarget.emit("pointerup", pointerEvent(third, { buttons: 0 }));

  assert.deepEqual(calls, [
    "begin:0,0",
    "update:0,1",
    "update:0,2",
    "begin:5,5",
  ]);
  binding.destroy();
});

test("fills the cells between samples while sweeping a selection", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeDocument();
  const start = cell(2, 0);
  const far = cell(2, 3);
  grid.cells.add(start);
  grid.cells.add(far);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    documentTarget,
    shiftSelects: true,
    actions: { selection: selectionActions(calls) },
  });

  grid.emit("pointerdown", pointerEvent(start, { shiftKey: true }));
  documentTarget.hitTarget = far;
  grid.emit("pointermove", pointerEvent(far, { shiftKey: true }));
  windowTarget.emit("pointerup", pointerEvent(far, { buttons: 0 }));

  assert.deepEqual(calls, [
    "begin-select:2,0:true",
    "extend-select:2,1:true",
    "extend-select:2,2:true",
    "extend-select:2,3:true",
    "end-select",
  ]);
  binding.destroy();
});

test("commits on capture loss even when it arrives before pointerup", () => {
  const grid = new FakeGrid();
  const windowTarget = new FakeEventTarget();
  const target = cell(1, 2);
  grid.cells.add(target);
  const calls: string[] = [];
  const binding = bind({
    grid,
    windowTarget,
    actions: {
      beginStroke: () => calls.push("begin"),
      updateStroke: () => calls.push("update"),
      commitStroke: () => calls.push("commit"),
      cancelStroke: () => calls.push("cancel"),
    },
  });

  // Browsers disagree on this ordering; a stroke must survive either one.
  grid.emit("pointerdown", pointerEvent(target));
  grid.emit("lostpointercapture", pointerEvent(grid));
  windowTarget.emit("pointerup", pointerEvent(target, { buttons: 0 }));

  assert.deepEqual(calls, ["begin", "commit"]);
  binding.destroy();
});
