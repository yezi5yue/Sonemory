/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expandSpeechNotation, speechForms } from "./notation.js?v=0.6.0";

const COMMANDS = new Map([
  ["start", ["开始", "开始学习", "start"]],
  ["continue", ["继续", "继续学习", "continue"]],
  ["repeat", ["重复", "再说一遍", "再读一遍", "repeat", "say it again"]],
  ["slower", ["慢一点", "读慢一点", "slower", "slow down"]],
  ["spell", ["拼读", "怎么拼", "拼写", "spell", "spelling"]],
  ["meaning", ["什么意思", "解释", "释义", "meaning"]],
  ["unknown", ["不会", "不知道", "我不会", "I don't know"]],
  ["next", ["下一个", "跳过", "next", "skip"]],
  ["retry", ["再试一次", "重新试", "重试", "try again", "retry"]],
  ["mic-check", ["麦克风检测", "检查麦克风", "测试麦克风", "microphone check"]],
  ["listen-only", ["只听跟读", "只听模式", "不用测试", "listen only"]],
  ["pause", ["暂停", "等一下", "pause"]],
  ["stop", ["结束", "停止", "退出", "stop", "finish"]]
]);

export function normalizeAnswer(value) {
  return expandSpeechNotation(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectCommand(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[，。！？,.!?\s'’"-]/g, "");
  for (const [command, phrases] of COMMANDS) {
    if (phrases.some((phrase) => normalized === phrase.toLowerCase().replace(/[\s'’"-]/g, ""))) return command;
  }
  return null;
}

export function evaluateAnswer(item, transcript) {
  const transcripts = Array.isArray(transcript) ? transcript : [transcript];
  const answers = transcripts.map(normalizeAnswer).filter(Boolean);
  const candidates = [item.word, ...(item.aliases ?? [])]
    .flatMap(speechForms)
    .map(normalizeAnswer);
  const matched = answers.find((answer) => candidates.includes(answer));
  return {
    correct: Boolean(matched),
    normalizedAnswer: matched ?? answers[0] ?? "",
    recognizedAnswers: answers,
    expected: candidates
  };
}

function normalizedResult(value = {}) {
  return {
    correct: Number(value.correct ?? 0),
    incorrect: Number(value.incorrect ?? 0),
    recognitionFailures: Number(value.recognitionFailures ?? 0),
    assisted: Number(value.assisted ?? 0),
    attempts: Number(value.attempts ?? 0),
    lastOutcome: value.lastOutcome ?? null,
    lastPracticedAt: value.lastPracticedAt ?? null
  };
}

export function mergeMasteryResult(previous, current, completedAt = new Date().toISOString()) {
  const before = normalizedResult(previous);
  const latest = normalizedResult(current);
  return {
    correct: before.correct + latest.correct,
    incorrect: before.incorrect + latest.incorrect,
    recognitionFailures: before.recognitionFailures + latest.recognitionFailures,
    assisted: before.assisted + latest.assisted,
    attempts: before.attempts + latest.attempts,
    lastOutcome: latest.lastOutcome ?? before.lastOutcome,
    lastPracticedAt: completedAt
  };
}

export class SessionEngine {
  constructor({ items, retryGap = 3, maxRetries = 1, snapshot = null }) {
    if (!Array.isArray(items) || !items.length) throw new Error("学习内容不能为空。");
    this.items = new Map(items.map((item) => [item.id, item]));
    this.retryGap = Math.max(1, retryGap);
    this.maxRetries = Math.max(0, maxRetries);
    this.queue = snapshot?.queue ?? items.map((item) => ({ itemId: item.id, kind: "new" }));
    this.cursor = snapshot?.cursor ?? 0;
    this.results = Object.fromEntries(Object.entries(snapshot?.results ?? {}).map(([id, result]) => [id, normalizedResult(result)]));
    this.stats = {
      correct: 0,
      incorrect: 0,
      followed: 0,
      recognitionFailures: 0,
      assisted: 0,
      ...(snapshot?.stats ?? {})
    };
  }

  get currentEntry() {
    return this.queue[this.cursor] ?? null;
  }

  get currentItem() {
    const entry = this.currentEntry;
    return entry ? this.items.get(entry.itemId) : null;
  }

  get completed() {
    return this.cursor >= this.queue.length;
  }

  markFollowed({ heard = true } = {}) {
    if (heard) this.stats.followed += 1;
    else this.recordRecognitionFailure();
  }

  recordRecognitionFailure() {
    this.stats.recognitionFailures += 1;
    const itemId = this.currentEntry?.itemId;
    if (itemId) {
      const result = normalizedResult(this.results[itemId]);
      result.recognitionFailures += 1;
      result.lastOutcome = "recognition-failure";
      this.results[itemId] = result;
    }
  }

  completeCurrent({ correct, assisted = false, recognitionFailure = false }) {
    const entry = this.currentEntry;
    if (!entry) return;
    const result = normalizedResult(this.results[entry.itemId]);
    result.attempts += 1;
    if (recognitionFailure) {
      result.recognitionFailures += 1;
      result.lastOutcome = "recognition-failure";
      this.stats.recognitionFailures += 1;
      if (result.recognitionFailures <= this.maxRetries) this.scheduleRetry(entry.itemId);
    } else if (correct && !assisted) {
      result.correct += 1;
      result.lastOutcome = "correct";
      this.stats.correct += 1;
    } else if (assisted) {
      result.assisted += 1;
      result.lastOutcome = "assisted";
      this.stats.assisted += 1;
      if (result.assisted <= this.maxRetries) this.scheduleRetry(entry.itemId);
    } else {
      result.incorrect += 1;
      result.lastOutcome = "incorrect";
      this.stats.incorrect += 1;
      if (result.incorrect <= this.maxRetries) this.scheduleRetry(entry.itemId);
    }
    this.results[entry.itemId] = result;
    this.cursor += 1;
  }

  scheduleRetry(itemId) {
    const laterQueue = this.queue.slice(this.cursor + 1);
    if (laterQueue.some((entry) => entry.itemId === itemId && entry.kind === "retry")) return;
    const insertAt = Math.min(this.cursor + 1 + this.retryGap, this.queue.length);
    this.queue.splice(insertAt, 0, { itemId, kind: "retry" });
  }

  snapshot() {
    return structuredClone({
      queue: this.queue,
      cursor: this.cursor,
      results: this.results,
      stats: this.stats
    });
  }
}
