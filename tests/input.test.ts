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

test("cancels an active stroke when pointer capture is lost unexpectedly", () => {
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

  assert.deepEqual(calls, ["begin", "cancel"]);
  binding.destroy();
});

test("removes a touch whose pointer capture is lost unexpectedly", () => {
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

  assert.deepEqual(calls, ["begin", "cancel", "begin", "commit"]);
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
