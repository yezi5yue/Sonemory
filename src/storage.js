/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const KEYS = {
  library: "sonemory.library.v2",
  selection: "sonemory.selection.v1",
  singlePack: "sonemory.pack.v1",
  settings: "sonemory.settings.v2",
  session: "sonemory.session.v1",
  history: "sonemory.history.v1",
  progress: "sonemory.progress.v1"
};

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
      const legacyValue = legacyKeys
        .map((legacyKey) => localStorage.getItem(legacyKey))
        .find((value) => value !== null);
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
  return { schemaVersion: 2, courses: [], packs: [] };
}

function normalizeLibrary(value) {
  if (!value || typeof value !== "object") return emptyLibrary();
  return {
    schemaVersion: 2,
    courses: Array.isArray(value.courses) ? value.courses.filter((course) => course?.id && course?.name) : [],
    packs: Array.isArray(value.packs) ? value.packs.filter((pack) => pack?.id && pack?.courseId) : []
  };
}

function ensureLibrary() {
  const stored = read(KEYS.library);
  if (stored) return normalizeLibrary(stored);

  const singlePack = read(KEYS.singlePack);
  if (!singlePack?.id) return emptyLibrary();

  const now = new Date().toISOString();
  const course = {
    id: "course-migrated",
    name: "默认课程",
    description: "由旧版本单词资料自动迁移",
    createdAt: now,
    updatedAt: now
  };
  const library = {
    schemaVersion: 2,
    courses: [course],
    packs: [{ ...singlePack, courseId: course.id, updatedAt: singlePack.updatedAt ?? now }]
  };
  write(KEYS.library, library);
  write(KEYS.selection, { courseId: course.id, packId: singlePack.id });
  return library;
}

function resolvedSelection(library = ensureLibrary()) {
  const stored = read(KEYS.selection, {});
  let course = library.courses.find((candidate) => candidate.id === stored.courseId);
  let pack = library.packs.find((candidate) => candidate.id === stored.packId);

  if (pack && (!course || pack.courseId !== course.id)) {
    course = library.courses.find((candidate) => candidate.id === pack.courseId);
  }
  if (!course) {
    course = library.courses.find((candidate) => library.packs.some((packItem) => packItem.courseId === candidate.id)) ?? library.courses[0];
  }
  if (!pack || pack.courseId !== course?.id) {
    pack = library.packs.find((candidate) => candidate.courseId === course?.id);
  }

  return { courseId: course?.id ?? null, packId: pack?.id ?? null };
}

function persistLibrary(library) {
  write(KEYS.library, normalizeLibrary(library));
}

export const store = {
  getLibrary: () => structuredClone(ensureLibrary()),
  getCourses: () => structuredClone(ensureLibrary().courses),
  getCourse(courseId) {
    return structuredClone(ensureLibrary().courses.find((course) => course.id === courseId) ?? null);
  },
  saveCourse(course) {
    const library = ensureLibrary();
    const now = new Date().toISOString();
    const normalized = {
      id: String(course.id).trim(),
      name: String(course.name).trim(),
      description: String(course.description ?? "").trim(),
      createdAt: course.createdAt ?? now,
      updatedAt: now
    };
    if (!normalized.id || !normalized.name) throw new Error("课程名称不能为空。");
    const duplicate = library.courses.find((candidate) => candidate.name === normalized.name && candidate.id !== normalized.id);
    if (duplicate) throw new Error("已经存在同名课程。");
    const index = library.courses.findIndex((candidate) => candidate.id === normalized.id);
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
    write(KEYS.selection, { courseId: normalized.courseId, packId: normalized.id });
    if (previous.packId === normalized.id) localStorage.removeItem(KEYS.session);
    return structuredClone(normalized);
  },
  setPack(pack) {
    const library = ensureLibrary();
    let course = library.courses.find((candidate) => candidate.id === "course-default");
    if (!course) course = this.saveCourse({ id: "course-default", name: "默认课程", description: "" });
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
    const selection = { courseId, packId: pack?.id ?? null };
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
    [...Object.values(KEYS), ...legacyKeys].forEach((key) => localStorage.removeItem(key));
  }
};
