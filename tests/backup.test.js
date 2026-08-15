import assert from "node:assert/strict";
import test from "node:test";

import { createBackup, mergeBackupData, previewBackup, validateBackup } from "../src/backup.js";

function data(prefix = "local") {
  return {
    library: {
      schemaVersion: 3,
      categories: [{ id: `${prefix}-category`, name: "学校课程" }],
      subcategories: [{ id: `${prefix}-subcategory`, categoryId: `${prefix}-category`, name: "英语" }],
      courses: [{ id: `${prefix}-course`, categoryId: `${prefix}-category`, subcategoryId: `${prefix}-subcategory`, name: "八年级英语" }],
      packs: [{
        id: `${prefix}-pack`,
        courseId: `${prefix}-course`,
        title: "Unit 1",
        items: [{ id: `${prefix}-item`, word: "teacher", meaning: "教师" }]
      }]
    },
    selection: { courseId: `${prefix}-course`, packId: `${prefix}-pack` },
    settings: { dailyCount: 5 },
    session: null,
    history: [],
    progress: {}
  };
}

test("creates and validates a complete versioned local backup", () => {
  const backup = createBackup(data(), { appVersion: "0.6.0", exportedAt: "2026-08-15T00:00:00.000Z" });
  assert.equal(backup.schemaVersion, 1);
  assert.equal(validateBackup(JSON.stringify(backup)).data.library.packs[0].items.length, 1);
  const preview = previewBackup(backup, data());
  assert.equal(preview.summary.items, 1);
  assert.equal(preview.conflicts.packs, 1);
});

test("rejects backups with broken hierarchy references", () => {
  const backup = createBackup(data());
  backup.data.library.courses[0].subcategoryId = "missing";
  assert.throws(() => validateBackup(backup), /归属不匹配/);
});

test("merge keeps local conflicts and imports new records", () => {
  const local = data("shared");
  const incoming = data("incoming");
  incoming.library.categories.push({ id: "shared-category", name: "备份中的冲突名称" });
  const merged = mergeBackupData(local, incoming);
  assert.equal(merged.library.categories.find((item) => item.id === "shared-category").name, "学校课程");
  assert.equal(merged.library.packs.some((item) => item.id === "incoming-pack"), true);
});
