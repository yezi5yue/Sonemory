import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("migrates legacy OpenRecall data to Sonemory keys", async () => {
  const pack = { id: "pack-1", title: "My pack" };
  const localStorage = new MemoryStorage([
    ["openrecall.pack.v1", JSON.stringify(pack)],
    ["openrecall.settings.v1", JSON.stringify({ dailyCount: 3 })]
  ]);
  globalThis.localStorage = localStorage;

  try {
    const { store } = await import(`../src/storage.js?migration=${Date.now()}`);
    assert.deepEqual(store.getPack(), pack);
    assert.equal(store.getSettings().dailyCount, 3);
    assert.equal(localStorage.getItem("sonemory.pack.v1"), JSON.stringify(pack));

    store.clearAll();
    assert.equal(localStorage.getItem("sonemory.pack.v1"), null);
    assert.equal(localStorage.getItem("openrecall.pack.v1"), null);
  } finally {
    delete globalThis.localStorage;
  }
});
