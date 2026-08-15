/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const BACKUP_FORMAT = "sonemory-local-backup";
export const BACKUP_SCHEMA_VERSION = 1;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效。`);
  return value;
}

function list(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}格式无效。`);
  return value;
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item?.id || typeof item.id !== "string") throw new Error(`${label}中存在缺少 ID 的记录。`);
    if (ids.has(item.id)) throw new Error(`${label}中存在重复 ID：${item.id}。`);
    ids.add(item.id);
  }
  return ids;
}

function validateLibrary(library) {
  record(library, "资料库");
  if (library.schemaVersion !== 3) throw new Error(`不支持的资料库版本：${library.schemaVersion ?? "未知"}。`);
  const categories = list(library.categories, "大类");
  const subcategories = list(library.subcategories, "子类");
  const courses = list(library.courses, "课程");
  const packs = list(library.packs, "资料");
  const categoryIds = uniqueIds(categories, "大类");
  const subcategoryIds = uniqueIds(subcategories, "子类");
  const courseIds = uniqueIds(courses, "课程");
  uniqueIds(packs, "资料");

  const subcategoryById = new Map(subcategories.map((item) => [item.id, item]));
  for (const item of subcategories) {
    if (!categoryIds.has(item.categoryId)) throw new Error(`子类“${item.name ?? item.id}”引用了不存在的大类。`);
  }
  for (const item of courses) {
    const subcategory = subcategoryById.get(item.subcategoryId);
    if (!categoryIds.has(item.categoryId) || !subcategory || subcategory.categoryId !== item.categoryId) {
      throw new Error(`课程“${item.name ?? item.id}”的大类和子类归属不匹配。`);
    }
  }
  for (const pack of packs) {
    if (!courseIds.has(pack.courseId)) throw new Error(`资料“${pack.title ?? pack.id}”引用了不存在的课程。`);
    if (!Array.isArray(pack.items)) throw new Error(`资料“${pack.title ?? pack.id}”缺少学习内容列表。`);
    uniqueIds(pack.items, `资料“${pack.title ?? pack.id}”`);
  }
}

function sessionIsValid(session, library) {
  if (session === null) return;
  record(session, "暂停会话");
  const pack = library.packs.find((item) => item.id === session.packId);
  if (session.packId && !pack) {
    throw new Error("暂停会话引用了不存在的资料。");
  }
  if (pack && Array.isArray(session.itemIds)) {
    const itemIds = new Set(pack.items.map((item) => item.id));
    if (session.itemIds.some((itemId) => !itemIds.has(itemId))) throw new Error("暂停会话引用了资料中不存在的学习项。");
  }
}

function selectionIsValid(selection, library) {
  record(selection, "当前选择");
  if (!selection.courseId && !selection.packId) return;
  const course = library.courses.find((item) => item.id === selection.courseId);
  const pack = library.packs.find((item) => item.id === selection.packId);
  if (!course) throw new Error("当前选择引用了不存在的课程。");
  if (selection.packId && !pack) throw new Error("当前选择引用了不存在的资料。");
  if (pack && pack.courseId !== course.id) throw new Error("当前选择中的课程和资料不匹配。");
}

export function validateBackup(value) {
  let backup = value;
  if (typeof backup === "string") {
    try { backup = JSON.parse(backup); } catch { throw new Error("备份文件不是有效的 JSON。"); }
  }
  record(backup, "备份文件");
  if (backup.format !== BACKUP_FORMAT) throw new Error("这不是 Sonemory 本地备份文件。");
  if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`不支持的备份版本：${backup.schemaVersion ?? "未知"}。`);
  }
  const data = record(backup.data, "备份数据");
  validateLibrary(data.library);
  selectionIsValid(data.selection ?? {}, data.library);
  record(data.settings ?? {}, "学习设置");
  sessionIsValid(data.session ?? null, data.library);
  list(data.history ?? [], "学习记录");
  record(data.progress ?? {}, "学习进度");
  return structuredClone(backup);
}

export function createBackup(data, { appVersion = "unknown", exportedAt = new Date().toISOString() } = {}) {
  const backup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt,
    data: structuredClone(data)
  };
  return validateBackup(backup);
}

function conflictCount(currentItems = [], incomingItems = []) {
  const ids = new Set(currentItems.map((item) => item.id));
  return incomingItems.filter((item) => ids.has(item.id)).length;
}

function historyKey(entry) {
  return [entry.completedAt, entry.packId, entry.startedAt].map((value) => String(value ?? "")).join("|");
}

export function previewBackup(value, currentData) {
  const backup = validateBackup(value);
  const incoming = backup.data;
  const current = currentData ?? { library: { categories: [], subcategories: [], courses: [], packs: [] }, history: [], progress: {} };
  const conflicts = {
    categories: conflictCount(current.library?.categories, incoming.library.categories),
    subcategories: conflictCount(current.library?.subcategories, incoming.library.subcategories),
    courses: conflictCount(current.library?.courses, incoming.library.courses),
    packs: conflictCount(current.library?.packs, incoming.library.packs),
    progress: Object.keys(incoming.progress ?? {}).filter((id) => Object.hasOwn(current.progress ?? {}, id)).length,
    history: 0
  };
  const currentHistory = new Set((current.history ?? []).map(historyKey));
  conflicts.history = (incoming.history ?? []).filter((entry) => currentHistory.has(historyKey(entry))).length;
  conflicts.total = Object.values(conflicts).reduce((sum, value) => sum + value, 0);
  return {
    backup,
    summary: {
      categories: incoming.library.categories.length,
      subcategories: incoming.library.subcategories.length,
      courses: incoming.library.courses.length,
      packs: incoming.library.packs.length,
      items: incoming.library.packs.reduce((sum, pack) => sum + pack.items.length, 0),
      history: incoming.history.length,
      progressPacks: Object.keys(incoming.progress).length
    },
    conflicts
  };
}

function mergeById(local = [], incoming = []) {
  const merged = structuredClone(local);
  const ids = new Set(merged.map((item) => item.id));
  for (const item of incoming) {
    if (!ids.has(item.id)) {
      merged.push(structuredClone(item));
      ids.add(item.id);
    }
  }
  return merged;
}

function mergeProgress(local = {}, incoming = {}) {
  const merged = structuredClone(incoming);
  for (const [packId, progress] of Object.entries(local)) {
    if (!Object.hasOwn(merged, packId)) merged[packId] = structuredClone(progress);
    else {
      merged[packId] = {
        ...merged[packId],
        ...structuredClone(progress),
        mastery: { ...(merged[packId].mastery ?? {}), ...(structuredClone(progress.mastery ?? {})) }
      };
    }
  }
  return merged;
}

export function mergeBackupData(local, incoming) {
  const history = [...structuredClone(local.history ?? []), ...structuredClone(incoming.history ?? [])];
  const seenHistory = new Set();
  const merged = {
    library: {
      schemaVersion: 3,
      categories: mergeById(local.library.categories, incoming.library.categories),
      subcategories: mergeById(local.library.subcategories, incoming.library.subcategories),
      courses: mergeById(local.library.courses, incoming.library.courses),
      packs: mergeById(local.library.packs, incoming.library.packs)
    },
    selection: structuredClone(local.selection ?? incoming.selection ?? {}),
    settings: { ...structuredClone(incoming.settings ?? {}), ...structuredClone(local.settings ?? {}) },
    session: structuredClone(local.session ?? incoming.session ?? null),
    history: history
      .filter((entry) => {
        const key = historyKey(entry);
        if (seenHistory.has(key)) return false;
        seenHistory.add(key);
        return true;
      })
      .sort((left, right) => String(right.completedAt ?? "").localeCompare(String(left.completedAt ?? "")))
      .slice(0, 30),
    progress: mergeProgress(local.progress, incoming.progress)
  };
  validateLibrary(merged.library);
  return merged;
}
