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
    assert.equal(store.getCategories()[0].name, "未分类");
    assert.equal(store.getSubcategories()[0].name, "默认分类");
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
    store.saveCategory({ id: "school", name: "学校课程" });
    store.saveCategory({ id: "interest", name: "兴趣拓展" });
    store.saveSubcategory({ id: "languages", categoryId: "school", name: "语言" });
    store.saveSubcategory({ id: "nature", categoryId: "interest", name: "自然科学" });
    store.saveCourse({ id: "english", categoryId: "school", subcategoryId: "languages", name: "英语" });
    store.saveCourse({ id: "science", categoryId: "interest", subcategoryId: "nature", name: "科学" });
    store.savePack({ id: "words-1", courseId: "english", title: "第一单元", items: [] });
    store.savePack({ id: "facts-1", courseId: "science", title: "声音知识点", items: [] });

    store.setSelection({ courseId: "english", packId: "words-1" });
    assert.equal(store.getPack().title, "第一单元");
    assert.equal(store.getPacks("science")[0].title, "声音知识点");

    const updated = store.saveCourse({
      id: "english",
      categoryId: "school",
      subcategoryId: "languages",
      name: "英语课程",
      description: "八年级"
    });
    assert.equal(updated.name, "英语课程");
    assert.equal(store.searchCourses("八年级")[0].id, "english");
    assert.deepEqual(store.getSelection(), {
      categoryId: "school",
      subcategoryId: "languages",
      courseId: "english",
      packId: "words-1"
    });
    const moved = store.saveCourse({
      ...updated,
      categoryId: "interest",
      subcategoryId: "nature"
    });
    assert.equal(moved.categoryId, "interest");
    assert.equal(store.getPack("words-1").courseId, "english");
    assert.deepEqual(store.getSelection(), {
      categoryId: "interest",
      subcategoryId: "nature",
      courseId: "english",
      packId: "words-1"
    });
    assert.throws(() => store.deleteCourse("english"), /先删除或移动/);
    assert.throws(() => store.deleteCategory("school"), /先删除/);

    store.deletePack("words-1");
    store.deleteCourse("english");
    assert.equal(store.getCourses().length, 1);
  } finally {
    delete globalThis.localStorage;
  }
});

test("migrates v2 courses into a default category and subcategory", async () => {
  const v2Library = {
    schemaVersion: 2,
    courses: [{ id: "course-1", name: "八年级英语", description: "" }],
    packs: [{ id: "pack-1", courseId: "course-1", title: "Unit 1", items: [] }]
  };
  const localStorage = new MemoryStorage([
    ["sonemory.library.v2", JSON.stringify(v2Library)],
    ["sonemory.selection.v1", JSON.stringify({ courseId: "course-1", packId: "pack-1" })]
  ]);
  globalThis.localStorage = localStorage;

  try {
    const { store } = await import(`../src/storage.js?v2=${Date.now()}`);
    const course = store.getCourse("course-1");
    assert.equal(store.getCategories()[0].name, "未分类");
    assert.equal(store.getSubcategories()[0].name, "默认分类");
    assert.equal(course.categoryId, "category-migrated");
    assert.equal(course.subcategoryId, "subcategory-migrated");
    assert.equal(store.getPack().id, "pack-1");
  } finally {
    delete globalThis.localStorage;
  }
});
