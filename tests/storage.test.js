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
    assert.equal(store.getPack().id, pack.id);
    assert.equal(store.getPack().courseId, "course-migrated");
    assert.equal(store.getCourses()[0].name, "默认课程");
    assert.equal(store.getSettings().dailyCount, 3);
    assert.equal(localStorage.getItem("sonemory.pack.v1"), JSON.stringify(pack));

    store.clearAll();
    assert.equal(localStorage.getItem("sonemory.pack.v1"), null);
    assert.equal(localStorage.getItem("openrecall.pack.v1"), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test("manages multiple courses, materials, and active selection", async () => {
  const localStorage = new MemoryStorage();
  globalThis.localStorage = localStorage;

  try {
    const { store } = await import(`../src/storage.js?library=${Date.now()}`);
    store.saveCourse({ id: "english", name: "英语" });
    store.saveCourse({ id: "science", name: "科学" });
    store.savePack({ id: "words-1", courseId: "english", title: "第一单元", items: [] });
    store.savePack({ id: "facts-1", courseId: "science", title: "声音知识点", items: [] });

    store.setSelection({ courseId: "english", packId: "words-1" });
    assert.equal(store.getPack().title, "第一单元");
    assert.equal(store.getPacks("science")[0].title, "声音知识点");

    const updated = store.saveCourse({ id: "english", name: "英语课程", description: "八年级" });
    assert.equal(updated.name, "英语课程");
    assert.throws(() => store.deleteCourse("english"), /先删除或移动/);

    store.deletePack("words-1");
    store.deleteCourse("english");
    assert.equal(store.getCourses().length, 1);
  } finally {
    delete globalThis.localStorage;
  }
});
