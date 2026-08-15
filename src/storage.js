/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const KEYS = {
  library: "sonemory.library.v3",
  selection: "sonemory.selection.v1",
  singlePack: "sonemory.pack.v1",
  settings: "sonemory.settings.v2",
  session: "sonemory.session.v1",
  history: "sonemory.history.v1",
  progress: "sonemory.progress.v1"
};

const OLD_LIBRARY_KEY = "sonemory.library.v2";
const LEGACY_KEYS = {
  singlePack: ["openrecall.pack.v1"],
  settings: ["openrecall.settings.v2", "openrecall.settings.v1"],
  session: ["openrecall.session.v1"],
  history: ["openrecall.history.v1"],
  progress: ["openrecall.progress.v1"]
};

const DEFAULT_SETTINGS = {
  dailyCount: 5,
  retryGap: 3,
  recognitionLocale: "auto",
  recognitionMode: "auto-local",
  voiceLocale: "en-US"
};

function migrateLegacyData() {
  if (typeof localStorage === "undefined") return;
  try {
    for (const [name, legacyKeys] of Object.entries(LEGACY_KEYS)) {
      const key = KEYS[name];
      if (localStorage.getItem(key) !== null) continue;
      const legacyValue = legacyKeys.map((legacyKey) => localStorage.getItem(legacyKey)).find((value) => value !== null);
      if (legacyValue !== undefined) localStorage.setItem(key, legacyValue);
    }
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

migrateLegacyData();

function read(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function emptyLibrary() {
  return { schemaVersion: 3, categories: [], subcategories: [], courses: [], packs: [] };
}

function normalizeLibrary(value) {
  if (!value || typeof value !== "object") return emptyLibrary();
  return {
    schemaVersion: 3,
    categories: Array.isArray(value.categories) ? value.categories.filter((item) => item?.id && item?.name) : [],
    subcategories: Array.isArray(value.subcategories) ? value.subcategories.filter((item) => item?.id && item?.categoryId && item?.name) : [],
    courses: Array.isArray(value.courses) ? value.courses.filter((item) => item?.id && item?.categoryId && item?.subcategoryId && item?.name) : [],
    packs: Array.isArray(value.packs) ? value.packs.filter((item) => item?.id && item?.courseId) : []
  };
}

function migratedTaxonomy(now) {
  const category = { id: "category-migrated", name: "未分类", createdAt: now, updatedAt: now };
  const subcategory = {
    id: "subcategory-migrated",
    categoryId: category.id,
    name: "默认分类",
    createdAt: now,
    updatedAt: now
  };
  return { category, subcategory };
}

function migrateV2Library(value) {
  const now = new Date().toISOString();
  const { category, subcategory } = migratedTaxonomy(now);
  return {
    schemaVersion: 3,
    categories: [category],
    subcategories: [subcategory],
    courses: (value?.courses ?? []).map((course) => ({
      ...course,
      categoryId: category.id,
      subcategoryId: subcategory.id,
      updatedAt: course.updatedAt ?? now
    })),
    packs: value?.packs ?? []
  };
}

function ensureLibrary() {
  const stored = read(KEYS.library);
  if (stored) return normalizeLibrary(stored);

  const oldLibrary = read(OLD_LIBRARY_KEY);
  if (oldLibrary) {
    const migrated = migrateV2Library(oldLibrary);
    write(KEYS.library, migrated);
    return migrated;
  }

  const singlePack = read(KEYS.singlePack);
  if (!singlePack?.id) return emptyLibrary();

  const now = new Date().toISOString();
  const { category, subcategory } = migratedTaxonomy(now);
  const course = {
    id: "course-migrated",
    categoryId: category.id,
    subcategoryId: subcategory.id,
    name: "默认课程",
    description: "由旧版本单词资料自动迁移",
    createdAt: now,
    updatedAt: now
  };
  const library = {
    schemaVersion: 3,
    categories: [category],
    subcategories: [subcategory],
    courses: [course],
    packs: [{ ...singlePack, courseId: course.id, updatedAt: singlePack.updatedAt ?? now }]
  };
  write(KEYS.library, library);
  write(KEYS.selection, { categoryId: category.id, subcategoryId: subcategory.id, courseId: course.id, packId: singlePack.id });
  return library;
}

function resolvedSelection(library = ensureLibrary()) {
  const stored = read(KEYS.selection, {});
  let course = library.courses.find((candidate) => candidate.id === stored.courseId);
  let pack = library.packs.find((candidate) => candidate.id === stored.packId);

  if (pack && (!course || pack.courseId !== course.id)) course = library.courses.find((candidate) => candidate.id === pack.courseId);
  if (!course) course = library.courses.find((candidate) => library.packs.some((packItem) => packItem.courseId === candidate.id)) ?? library.courses[0];
  if (!pack || pack.courseId !== course?.id) pack = library.packs.find((candidate) => candidate.courseId === course?.id);

  return {
    categoryId: course?.categoryId ?? null,
    subcategoryId: course?.subcategoryId ?? null,
    courseId: course?.id ?? null,
    packId: pack?.id ?? null
  };
}

function persistLibrary(library) {
  write(KEYS.library, normalizeLibrary(library));
}

function normalizeNamedRecord(value, extra = {}) {
  const now = new Date().toISOString();
  const normalized = {
    ...extra,
    id: String(value.id ?? "").trim(),
    name: String(value.name ?? "").trim(),
    createdAt: value.createdAt ?? now,
    updatedAt: now
  };
  if (!normalized.id || !normalized.name) throw new Error("名称不能为空。");
  return normalized;
}

export const store = {
  getLibrary: () => structuredClone(ensureLibrary()),
  getCategories: () => structuredClone(ensureLibrary().categories),
  getCategory(categoryId) {
    return structuredClone(ensureLibrary().categories.find((item) => item.id === categoryId) ?? null);
  },
  saveCategory(category) {
    const library = ensureLibrary();
    const normalized = normalizeNamedRecord(category);
    if (library.categories.some((item) => item.name === normalized.name && item.id !== normalized.id)) throw new Error("已经存在同名大类。");
    const index = library.categories.findIndex((item) => item.id === normalized.id);
    if (index >= 0) library.categories[index] = normalized;
    else library.categories.push(normalized);
    persistLibrary(library);
    return structuredClone(normalized);
  },
  deleteCategory(categoryId) {
    const library = ensureLibrary();
    if (library.subcategories.some((item) => item.categoryId === categoryId)) throw new Error("请先删除大类下的子类。");
    if (library.courses.some((item) => item.categoryId === categoryId)) throw new Error("请先删除或移动大类下的课程。");
    library.categories = library.categories.filter((item) => item.id !== categoryId);
    persistLibrary(library);
  },
  getSubcategories(categoryId = null) {
    const items = ensureLibrary().subcategories;
    return structuredClone(categoryId ? items.filter((item) => item.categoryId === categoryId) : items);
  },
  getSubcategory(subcategoryId) {
    return structuredClone(ensureLibrary().subcategories.find((item) => item.id === subcategoryId) ?? null);
  },
  saveSubcategory(subcategory) {
    const library = ensureLibrary();
    const categoryId = String(subcategory.categoryId ?? "").trim();
    if (!library.categories.some((item) => item.id === categoryId)) throw new Error("请选择有效大类。");
    const normalized = normalizeNamedRecord(subcategory, { categoryId });
    if (library.subcategories.some((item) => item.categoryId === categoryId && item.name === normalized.name && item.id !== normalized.id)) {
      throw new Error("该大类下已经存在同名子类。");
    }
    const index = library.subcategories.findIndex((item) => item.id === normalized.id);
    if (index >= 0) library.subcategories[index] = normalized;
    else library.subcategories.push(normalized);
    persistLibrary(library);
    return structuredClone(normalized);
  },
  deleteSubcategory(subcategoryId) {
    const library = ensureLibrary();
    if (library.courses.some((item) => item.subcategoryId === subcategoryId)) throw new Error("请先删除或移动子类下的课程。");
    library.subcategories = library.subcategories.filter((item) => item.id !== subcategoryId);
    persistLibrary(library);
  },
  getCourses(subcategoryId = null) {
    const items = ensureLibrary().courses;
    return structuredClone(subcategoryId ? items.filter((item) => item.subcategoryId === subcategoryId) : items);
  },
  getCourse(courseId) {
    return structuredClone(ensureLibrary().courses.find((item) => item.id === courseId) ?? null);
  },
  saveCourse(course) {
    const library = ensureLibrary();
    const categoryId = String(course.categoryId ?? "").trim();
    const subcategoryId = String(course.subcategoryId ?? "").trim();
    const subcategory = library.subcategories.find((item) => item.id === subcategoryId && item.categoryId === categoryId);
    if (!subcategory) throw new Error("请选择匹配的大类和子类。");
    const normalized = {
      ...normalizeNamedRecord(course, { categoryId, subcategoryId }),
      description: String(course.description ?? "").trim()
    };
    if (library.courses.some((item) => item.subcategoryId === subcategoryId && item.name === normalized.name && item.id !== normalized.id)) {
      throw new Error("该子类下已经存在同名课程。");
    }
    const index = library.courses.findIndex((item) => item.id === normalized.id);
    if (index >= 0) library.courses[index] = normalized;
    else library.courses.push(normalized);
    persistLibrary(library);
    return structuredClone(normalized);
  },
  deleteCourse(courseId) {
    const library = ensureLibrary();
    if (library.packs.some((pack) => pack.courseId === courseId)) throw new Error("请先删除或移动课程下的学习资料。");
    library.courses = library.courses.filter((course) => course.id !== courseId);
    persistLibrary(library);
    const selection = resolvedSelection(library);
    write(KEYS.selection, selection);
    return selection;
  },
  searchCourses(query) {
    const needle = String(query ?? "").normalize("NFKC").trim().toLocaleLowerCase();
    if (!needle) return [];
    return structuredClone(ensureLibrary().courses.filter((course) =>
      `${course.name} ${course.description ?? ""}`.normalize("NFKC").toLocaleLowerCase().includes(needle)
    ));
  },
  getPacks(courseId = null) {
    const packs = ensureLibrary().packs;
    return structuredClone(courseId ? packs.filter((pack) => pack.courseId === courseId) : packs);
  },
  getPack(packId = null) {
    const library = ensureLibrary();
    const selectedId = packId ?? resolvedSelection(library).packId;
    return structuredClone(library.packs.find((pack) => pack.id === selectedId) ?? null);
  },
  savePack(pack) {
    const library = ensureLibrary();
    if (!library.courses.some((course) => course.id === pack.courseId)) throw new Error("请选择有效课程。");
    const normalized = structuredClone({ ...pack, updatedAt: new Date().toISOString() });
    const index = library.packs.findIndex((candidate) => candidate.id === normalized.id);
    if (index >= 0) library.packs[index] = normalized;
    else library.packs.push(normalized);
    persistLibrary(library);
    const previous = resolvedSelection(library);
    const course = library.courses.find((item) => item.id === normalized.courseId);
    write(KEYS.selection, {
      categoryId: course.categoryId,
      subcategoryId: course.subcategoryId,
      courseId: course.id,
      packId: normalized.id
    });
    if (previous.packId === normalized.id) localStorage.removeItem(KEYS.session);
    return structuredClone(normalized);
  },
  setPack(pack) {
    const library = ensureLibrary();
    let category = library.categories[0];
    if (!category) category = this.saveCategory({ id: "category-default", name: "未分类" });
    let subcategory = this.getSubcategories(category.id)[0];
    if (!subcategory) subcategory = this.saveSubcategory({ id: "subcategory-default", categoryId: category.id, name: "默认分类" });
    let course = this.getCourses(subcategory.id).find((item) => item.id === "course-default");
    if (!course) {
      course = this.saveCourse({
        id: "course-default",
        categoryId: category.id,
        subcategoryId: subcategory.id,
        name: "默认课程",
        description: ""
      });
    }
    return this.savePack({ ...pack, courseId: course.id });
  },
  deletePack(packId) {
    const library = ensureLibrary();
    library.packs = library.packs.filter((pack) => pack.id !== packId);
    persistLibrary(library);
    const session = read(KEYS.session);
    if (session?.packId === packId) localStorage.removeItem(KEYS.session);
    const progress = read(KEYS.progress, {});
    delete progress[packId];
    write(KEYS.progress, progress);
    const selection = resolvedSelection(library);
    write(KEYS.selection, selection);
    return selection;
  },
  getSelection() {
    const library = ensureLibrary();
    const selection = resolvedSelection(library);
    write(KEYS.selection, selection);
    return selection;
  },
  setSelection({ courseId, packId = null }) {
    const library = ensureLibrary();
    const course = library.courses.find((candidate) => candidate.id === courseId);
    if (!course) throw new Error("课程不存在。");
    let pack = packId ? library.packs.find((candidate) => candidate.id === packId && candidate.courseId === courseId) : null;
    if (!pack) pack = library.packs.find((candidate) => candidate.courseId === courseId);
    const previous = resolvedSelection(library);
    const selection = {
      categoryId: course.categoryId,
      subcategoryId: course.subcategoryId,
      courseId: course.id,
      packId: pack?.id ?? null
    };
    write(KEYS.selection, selection);
    if (previous.packId !== selection.packId) localStorage.removeItem(KEYS.session);
    return selection;
  },
  getSettings: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
  setSettings(settings) {
    write(KEYS.settings, { ...DEFAULT_SETTINGS, ...settings });
  },
  getSession: () => read(KEYS.session),
  setSession(session) {
    write(KEYS.session, session);
  },
  clearSession() {
    localStorage.removeItem(KEYS.session);
  },
  getHistory: () => read(KEYS.history, []),
  addHistory(entry) {
    const history = read(KEYS.history, []);
    history.unshift(entry);
    write(KEYS.history, history.slice(0, 30));
  },
  getProgress(packId) {
    return read(KEYS.progress, {})[packId] ?? { nextOffset: 0, mastery: {} };
  },
  setProgress(packId, progress) {
    const allProgress = read(KEYS.progress, {});
    allProgress[packId] = progress;
    write(KEYS.progress, allProgress);
  },
  clearAll() {
    const legacyKeys = Object.values(LEGACY_KEYS).flat();
    [...Object.values(KEYS), OLD_LIBRARY_KEY, ...legacyKeys].forEach((key) => localStorage.removeItem(key));
  }
};
