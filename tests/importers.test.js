import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { packFromCsv } from "../src/content.js";
import { importedFileToCsv, rowsToCsv, xlsxToRows } from "../src/importers.js";

test("rowsToCsv escapes commas and quotes", () => {
  assert.equal(rowsToCsv([["word", "meaning"], ["say, hello", '说"你好"']]), 'word,meaning\n"say, hello","说""你好"""');
});

test("reads the downloadable XLSX template into importable rows", async () => {
  const file = await readFile(new URL("../templates/sonemory-import-template.xlsx", import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const parsed = await xlsxToRows(buffer);
  assert.equal(parsed.sheetName, "内容模板");
  assert.deepEqual(parsed.rows[0], ["word", "meaning", "partOfSpeech", "unit", "chunks", "aliases", "note", "locale"]);
  assert.deepEqual(parsed.rows[1].slice(0, 4), ["run low (on sth)", "即将用尽；快用完", "", "Unit 1"]);

  const imported = await importedFileToCsv({
    name: "template.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: file.byteLength,
    arrayBuffer: async () => buffer
  });
  const pack = packFromCsv(imported.csv, { title: "模板测试", publisher: "Sonemory", edition: "v1", locale: "en-US" });
  assert.equal(pack.items.length, 3);
  assert.equal(pack.items[0].partOfSpeech, "未标注");
  assert.equal(pack.items[0].aliases[0], "run low on something");
});

test("rejects legacy XLS and oversized imports", async () => {
  await assert.rejects(() => importedFileToCsv({ name: "legacy.xls", type: "", size: 10 }), /仅支持/);
  await assert.rejects(() => importedFileToCsv({ name: "huge.csv", type: "text\/csv", size: 11 * 1024 * 1024 }), /10 MB/);
});
