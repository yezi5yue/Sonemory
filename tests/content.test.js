import test from "node:test";
import assert from "node:assert/strict";

import { mergePackUpdate, packFromCsv, packToCsv, parseCsv, splitList, validatePack } from "../src/content.js";
import { toSpelling } from "../src/notation.js";
import { samplePack } from "../src/sample-pack.js";

test("parseCsv supports quoted commas and escaped quotes", () => {
  const rows = parseCsv('word,meaning,note\nteacher,"教师,老师","say ""hello"""');
  assert.deepEqual(rows[1], ["teacher", "教师,老师", 'say "hello"']);
});

test("packFromCsv requires authoritative source metadata", () => {
  assert.throws(
    () => packFromCsv("word,meaning,partOfSpeech\nteacher,教师,名词", {
      title: "",
      publisher: "",
      edition: ""
    }),
    /资料名称/
  );
});

test("packFromCsv maps optional chunks and aliases", () => {
  const pack = packFromCsv(
    "word,meaning,partOfSpeech,unit,chunks,aliases\nteacher,教师,名词,Unit 1,teach|er,school teacher",
    { title: "测试词表", publisher: "学校", edition: "2026", locale: "en-US" }
  );
  assert.equal(pack.items[0].unit, "Unit 1");
  assert.deepEqual(pack.items[0].chunks, ["teach", "er"]);
  assert.deepEqual(pack.items[0].aliases, ["school teacher"]);
});

test("packFromCsv accepts comma headers with pipe-separated pasted rows", () => {
  const text = `word, meaning, partOfSpeech
run low (on sth) | 即将用尽；快用完
accept | 接受；相信 | 动词
influence | 影响；对......起作用 | 动词`;
  const pack = packFromCsv(text, {
    title: "测试词表",
    publisher: "学校",
    edition: "2026",
    locale: "en-US"
  });
  assert.equal(pack.items.length, 3);
  assert.equal(pack.items[0].word, "run low (on sth)");
  assert.equal(pack.items[0].meaning, "即将用尽；快用完");
  assert.equal(pack.items[0].partOfSpeech, "未标注");
  assert.equal(pack.items[1].partOfSpeech, "动词");
});

test("packFromCsv accepts a pipe-separated header", () => {
  const pack = packFromCsv("word | meaning | partOfSpeech\nreview | 复习 | 动词", {
    title: "测试词表",
    publisher: "学校",
    edition: "2026",
    locale: "en-US"
  });
  assert.equal(pack.items[0].word, "review");
  assert.equal(pack.items[0].meaning, "复习");
});

test("validatePack rejects duplicate words", () => {
  const invalid = structuredClone(samplePack);
  invalid.items.push({ ...invalid.items[0], id: "duplicate" });
  assert.throws(() => validatePack(invalid), /单词重复/);
});

test("sample pack is valid and explicitly non-textbook", () => {
  const pack = validatePack(samplePack);
  assert.match(pack.title, /非教材/);
  assert.equal(pack.items.length, 5);
});

test("helpers keep deterministic spelling and list parsing", () => {
  assert.equal(toSpelling("teacher"), "t，e，a，c，h，e，r");
  assert.deepEqual(splitList("teach|er；ending"), ["teach", "er", "ending"]);
});

test("packToCsv round-trips editable material content", () => {
  const original = packFromCsv(
    'word,meaning,partOfSpeech,note\nteacher,"教师,老师",名词,"say ""hello"""',
    { title: "测试词表", publisher: "学校", edition: "2026", locale: "en-US" }
  );
  const restored = packFromCsv(packToCsv(original), {
    title: original.title,
    publisher: original.source.publisher,
    edition: original.source.edition,
    locale: original.locale
  });
  assert.equal(restored.items[0].meaning, "教师,老师");
  assert.equal(restored.items[0].note, 'say "hello"');
});

test("mergePackUpdate preserves material and matching item identities", () => {
  const existing = packFromCsv("word,meaning\nteacher,教师", {
    title: "旧名称", publisher: "学校", edition: "2026", locale: "en-US"
  });
  const incoming = packFromCsv("word,meaning\nteacher,老师\nstudent,学生", {
    title: "新名称", publisher: "学校", edition: "2026", locale: "en-US"
  });
  const updated = mergePackUpdate(existing, incoming);
  assert.equal(updated.id, existing.id);
  assert.equal(updated.items[0].id, existing.items[0].id);
  assert.equal(updated.items[0].meaning, "老师");
  assert.equal(updated.items.length, 2);
});

