import assert from "node:assert/strict";
import test from "node:test";
import { createDesignStore, type StudioStorage } from "../src/storage.ts";

type Design = { pixels: string };

function createMemoryStorage(
  initialEntries: Record<string, string> = {},
): StudioStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initialEntries));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function normalizeDesign(value: unknown): Design | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pixels" in value) ||
    typeof value.pixels !== "string" ||
    value.pixels.length === 0
  ) {
    return null;
  }
  return { pixels: value.pixels };
}

function createStore(storage: StudioStorage) {
  return createDesignStore<Design>({
    storage,
    key: "studio:v1",
    legacyKeys: ["studio"],
    normalize: normalizeDesign,
    isEqual: (left, right) => left.pixels === right.pixels,
  });
}

test("requires explicit design equality at construction", () => {
  assert.throws(
    () =>
      // @ts-expect-error Design identity must be explicit.
      createDesignStore<Design>({
        storage: createMemoryStorage(),
        key: "studio:v1",
        normalize: normalizeDesign,
      }),
    /isEqual/,
  );
});

test("saves, deduplicates, and rejects invalid designs", () => {
  const storage = createMemoryStorage();
  const store = createStore(storage);

  assert.deepEqual(store.save({ pixels: "abc" }), [{ pixels: "abc" }]);
  assert.deepEqual(store.save({ pixels: "abc" }), [{ pixels: "abc" }]);
  assert.deepEqual(store.save({ pixels: "def" }), [
    { pixels: "def" },
    { pixels: "abc" },
  ]);
  assert.throws(() => store.save({ pixels: "" }), /invalid Studio design/);
});

test("migrates legacy keys and strips fields the normalizer drops", () => {
  const storage = createMemoryStorage({
    studio: JSON.stringify([{ pixels: "abc", stale: "extra" }]),
  });
  const store = createStore(storage);

  assert.deepEqual(store.load(), [{ pixels: "abc" }]);
  assert.equal(
    storage.values.get("studio:v1"),
    JSON.stringify([{ pixels: "abc" }]),
  );
});

test("skips malformed legacy payloads and migrates the next valid key", () => {
  const storage = createMemoryStorage({
    "studio:broken": "not-json",
    "studio:older": JSON.stringify([{ pixels: "abc" }]),
  });
  const store = createDesignStore<Design>({
    storage,
    key: "studio:v1",
    legacyKeys: ["studio:broken", "studio:older"],
    normalize: normalizeDesign,
    isEqual: (left, right) => left.pixels === right.pixels,
  });

  assert.deepEqual(store.load(), [{ pixels: "abc" }]);
  assert.equal(
    storage.values.get("studio:v1"),
    JSON.stringify([{ pixels: "abc" }]),
  );
});

test("ignores corrupt payloads without falling through to legacy data", () => {
  const storage = createMemoryStorage({
    "studio:v1": "not-json",
    studio: JSON.stringify([{ pixels: "legacy" }]),
  });

  assert.deepEqual(createStore(storage).load(), []);
});

test("drops records the normalizer rejects and removes only valid indexes", () => {
  const storage = createMemoryStorage({
    "studio:v1": JSON.stringify([
      { pixels: "abc" },
      { other: "field" },
      { pixels: "def" },
    ]),
  });
  const store = createStore(storage);

  assert.deepEqual(store.load(), [{ pixels: "abc" }, { pixels: "def" }]);
  assert.deepEqual(store.remove(0), [{ pixels: "def" }]);
  assert.deepEqual(store.remove(9), [{ pixels: "def" }]);
});
