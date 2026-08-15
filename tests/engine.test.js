import test from "node:test";
import assert from "node:assert/strict";

import { detectCommand, evaluateAnswer, mergeMasteryResult, normalizeAnswer, SessionEngine } from "../src/engine.js";

const items = ["alpha", "bravo", "charlie", "delta"].map((word, index) => ({
  id: `item-${index}`,
  word,
  meaning: `释义${index}`,
  partOfSpeech: "名词",
  aliases: index === 0 ? ["alpha word"] : []
}));

test("normalizeAnswer is case-insensitive but otherwise strict", () => {
  assert.equal(normalizeAnswer("  Teacher! "), "teacher");
  assert.notEqual(normalizeAnswer("happy hotel"), normalizeAnswer("hotel"));
});

test("voice commands only match complete phrases", () => {
  assert.equal(detectCommand("再说一遍。"), "repeat");
  assert.equal(detectCommand("Pause."), "pause");
  assert.equal(detectCommand("I don't know"), "unknown");
  assert.equal(detectCommand("麦克风检测"), "mic-check");
  assert.equal(detectCommand("只听跟读"), "listen-only");
  assert.equal(detectCommand("我不知道"), null);
  assert.equal(detectCommand("不知道"), "unknown");
});

test("evaluateAnswer accepts declared aliases", () => {
  assert.equal(evaluateAnswer(items[0], "Alpha").correct, true);
  assert.equal(evaluateAnswer(items[0], "alpha word").correct, true);
  assert.equal(evaluateAnswer(items[0], "alpha words").correct, false);
});

test("evaluateAnswer expands dictionary notation and checks all recognition alternatives", () => {
  const phrase = { id: "phrase", word: "run low (on sth)", aliases: [] };
  assert.equal(evaluateAnswer(phrase, "run low on something").correct, true);
  assert.equal(evaluateAnswer(phrase, "run low").correct, true);
  assert.equal(evaluateAnswer(phrase, ["wrong result", "run low on something"]).correct, true);
});

test("incorrect answer is retried after the configured gap", () => {
  const engine = new SessionEngine({ items, retryGap: 3, maxRetries: 1 });
  engine.completeCurrent({ correct: false });
  assert.deepEqual(engine.queue.map((entry) => entry.itemId), ["item-0", "item-1", "item-2", "item-3", "item-0"]);
  assert.equal(engine.stats.incorrect, 1);
});

test("recognition failure is tracked separately from knowledge errors", () => {
  const engine = new SessionEngine({ items, retryGap: 2, maxRetries: 1 });
  engine.completeCurrent({ correct: false, recognitionFailure: true });
  assert.equal(engine.stats.incorrect, 0);
  assert.equal(engine.stats.recognitionFailures, 1);
  assert.equal(engine.results["item-0"].incorrect, 0);
});

test("assisted answers are tracked separately from wrong answers", () => {
  const engine = new SessionEngine({ items, retryGap: 2, maxRetries: 1 });
  engine.completeCurrent({ correct: false, assisted: true });
  assert.equal(engine.stats.incorrect, 0);
  assert.equal(engine.stats.assisted, 1);
  assert.equal(engine.results["item-0"].lastOutcome, "assisted");
});

test("mastery merge preserves cumulative reasons and latest outcome", () => {
  const merged = mergeMasteryResult(
    { correct: 2, incorrect: 1, recognitionFailures: 1, assisted: 0, attempts: 3, lastOutcome: "incorrect" },
    { correct: 1, incorrect: 0, recognitionFailures: 0, assisted: 1, attempts: 2, lastOutcome: "correct" },
    "2026-08-15T01:00:00.000Z"
  );
  assert.deepEqual(merged, {
    correct: 3,
    incorrect: 1,
    recognitionFailures: 1,
    assisted: 1,
    attempts: 5,
    lastOutcome: "correct",
    lastPracticedAt: "2026-08-15T01:00:00.000Z"
  });
});

test("retry count is capped to keep an independent session finite", () => {
  const engine = new SessionEngine({ items: items.slice(0, 1), retryGap: 1, maxRetries: 1 });
  engine.completeCurrent({ correct: false });
  assert.equal(engine.queue.length, 2);
  engine.completeCurrent({ correct: false });
  assert.equal(engine.queue.length, 2);
  assert.equal(engine.completed, true);
});

test("session snapshots restore queue and progress", () => {
  const engine = new SessionEngine({ items, retryGap: 3 });
  engine.completeCurrent({ correct: true });
  const restored = new SessionEngine({ items, retryGap: 3, snapshot: engine.snapshot() });
  assert.equal(restored.cursor, 1);
  assert.equal(restored.stats.correct, 1);
  assert.equal(restored.currentItem.word, "bravo");
});

