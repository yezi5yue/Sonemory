/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { packFromCsv, validatePack } from "./content.js?v=0.1.2";
import { detectCommand, evaluateAnswer, SessionEngine } from "./engine.js?v=0.1.2";
import { expandSpeechNotation, speechForms, toSpelling } from "./notation.js?v=0.1.2";
import { samplePack } from "./sample-pack.js?v=0.1.2";
import { BrowserRecognizer, BrowserSpeaker } from "./speech.js?v=0.1.2";
import { store } from "./storage.js?v=0.1.2";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  tabs: $$("[data-view-target]"),
  views: $$("[data-view]"),
  start: $("#start-session"),
  pause: $("#pause-session"),
  stop: $("#stop-session"),
  studentStatus: $("#student-status"),
  studentDetail: $("#student-detail"),
  studentProgress: $("#student-progress"),
  packBadge: $("#pack-badge"),
  commandButtons: $$("[data-command]"),
  form: $("#pack-form"),
  packFile: $("#pack-file"),
  csv: $("#csv-input"),
  loadDemo: $("#load-demo"),
  clearData: $("#clear-data"),
  importMessage: $("#import-message"),
  packSummary: $("#pack-summary"),
  history: $("#history-list"),
  emptyHistory: $("#empty-history")
};

function switchView(viewName) {
  elements.tabs.forEach((tab) => {
    const selected = tab.dataset.viewTarget === viewName;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  elements.views.forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });
}

function setStatus(title, detail = "", { listening = false } = {}) {
  elements.studentStatus.textContent = title;
  elements.studentDetail.textContent = detail;
  document.body.classList.toggle("is-listening", listening);
}

function showImportMessage(message, kind = "success") {
  elements.importMessage.textContent = message;
  elements.importMessage.dataset.kind = kind;
  elements.importMessage.hidden = false;
}

function renderPack() {
  const pack = store.getPack();
  if (!pack) {
    elements.packBadge.textContent = "尚未导入词表";
    elements.packBadge.dataset.state = "empty";
    elements.packSummary.innerHTML = "<p>项目不默认提供教材内容。请导入以官方发布版本为准的词表。</p>";
    return;
  }
  elements.packBadge.textContent = `${pack.title} · ${pack.items.length}词`;
  elements.packBadge.dataset.state = "ready";
  elements.packSummary.innerHTML = `
    <dl class="summary-grid">
      <div><dt>资料</dt><dd>${escapeHtml(pack.title)}</dd></div>
      <div><dt>发布机构</dt><dd>${escapeHtml(pack.source.publisher)}</dd></div>
      <div><dt>版本</dt><dd>${escapeHtml(pack.source.edition)}</dd></div>
      <div><dt>词数</dt><dd>${pack.items.length}</dd></div>
    </dl>
    <p class="source-note">${escapeHtml(pack.source.reference || "未填写补充来源说明")}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHistory() {
  const history = store.getHistory();
  elements.emptyHistory.hidden = history.length > 0;
  elements.history.innerHTML = history.map((entry) => `
    <article class="history-card">
      <div>
        <p class="history-date">${new Date(entry.completedAt).toLocaleString("zh-CN")}</p>
        <h3>${escapeHtml(entry.packTitle)}</h3>
      </div>
      <dl>
        <div><dt>正确</dt><dd>${entry.stats.correct}</dd></div>
        <div><dt>待巩固</dt><dd>${entry.stats.incorrect}</dd></div>
        <div><dt>跟读</dt><dd>${entry.stats.followed}</dd></div>
        <div><dt>未听清</dt><dd>${entry.stats.recognitionFailures}</dd></div>
      </dl>
    </article>`).join("");
}

class FlowInterrupted extends Error {}

class LearningController {
  constructor() {
    this.speaker = new BrowserSpeaker();
    this.recognizer = new BrowserRecognizer();
    this.engine = null;
    this.pack = null;
    this.settings = null;
    this.running = false;
    this.paused = false;
    this.stopped = false;
    this.forcedCommand = null;
    this.startedAt = null;
    this.wakeLock = null;
    this.activeRunId = 0;
  }

  async start() {
    if (this.running) return;
    this.pack = store.getPack();
    this.settings = store.getSettings();
    if (!this.pack) {
      setStatus("需要家长先导入词表", "打开家长端，导入以官方版本为准的学习内容。");
      switchView("parent");
      return;
    }

    if (!this.speaker.supported || !this.recognizer.supported) {
      setStatus("当前浏览器缺少完整语音能力", "请使用支持语音播放和语音识别的最新版浏览器。");
      return;
    }

    this.prepareEngine();
    this.running = true;
    this.paused = false;
    this.stopped = false;
    const runId = ++this.activeRunId;
    this.startedAt ??= new Date().toISOString();
    document.body.classList.add("audio-session");
    elements.start.textContent = "学习进行中";
    elements.start.disabled = true;
    elements.pause.disabled = false;
    elements.stop.disabled = false;
    await this.requestWakeLock();

    try {
      await this.say("Sonemory.", { lang: "en-US", rate: 0.92 }, runId);
      await this.say("声声入忆，语音陪学。", { lang: "zh-CN", rate: 1 }, runId);
      await this.say(`今天学习${this.engine.queue.filter((entry) => entry.kind === "new").length}个单词。学习中可以说，重复，慢一点，拼读，不会，暂停或结束。`, { lang: "zh-CN", rate: 1 }, runId);
      await this.run(runId);
    } catch (error) {
      if (error instanceof FlowInterrupted) return;
      this.running = false;
      elements.start.disabled = false;
      elements.pause.disabled = true;
      elements.stop.disabled = true;
      setStatus("学习流程暂时无法继续", error.message || "请稍后重试。");
    }
  }

  ensureActive(runId) {
    if (runId !== this.activeRunId || !this.running || this.paused || this.stopped) {
      throw new FlowInterrupted();
    }
  }

  async say(text, options, runId) {
    this.ensureActive(runId);
    await this.speaker.speak(text, options);
    this.ensureActive(runId);
  }

  spokenWord(item) {
    return speechForms(item.word)[0] ?? item.word;
  }

  recognizedTranscripts(result) {
    const alternatives = result.alternatives?.map((alternative) => alternative.transcript) ?? [];
    return [...new Set([result.transcript, ...alternatives].filter(Boolean))];
  }

  recognitionConfidence(result) {
    const values = [result.confidence, ...(result.alternatives?.map((alternative) => alternative.confidence) ?? [])]
      .filter((value) => Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
  }

  recognitionPhrases(item) {
    return [item.word, ...(item.aliases ?? [])].flatMap(speechForms);
  }

  prepareEngine() {
    const stored = store.getSession();
    if (stored?.packId === this.pack.id && stored.itemIds?.length && !stored.completed) {
      const items = stored.itemIds.map((id) => this.pack.items.find((item) => item.id === id)).filter(Boolean);
      if (items.length) {
        this.engine = new SessionEngine({
          items,
          retryGap: this.settings.retryGap,
          maxRetries: 1,
          snapshot: stored.engine
        });
        this.startedAt = stored.startedAt;
        return;
      }
    }

    const progress = store.getProgress(this.pack.id);
    const count = Math.min(this.settings.dailyCount, this.pack.items.length);
    const items = Array.from({ length: count }, (_, index) => this.pack.items[(progress.nextOffset + index) % this.pack.items.length]);
    this.engine = new SessionEngine({ items, retryGap: this.settings.retryGap, maxRetries: 1 });
    this.startedAt = new Date().toISOString();
    this.saveSession();
  }

  async run(runId) {
    while (this.running && !this.paused && !this.stopped && !this.engine.completed) {
      this.ensureActive(runId);
      this.renderProgress();
      const entry = this.engine.currentEntry;
      const item = this.engine.currentItem;
      if (entry.kind === "new") await this.teach(item, runId);
      if (!this.running || this.paused || this.stopped) break;
      await this.recall(item, entry.kind === "retry", runId);
      this.saveSession();
    }

    if (this.engine.completed && !this.stopped) await this.completeSession();
    else if (this.paused) this.showPaused();
  }

  async teach(item, runId) {
    const spokenWord = this.spokenWord(item);
    setStatus("请先听自然发音", `${item.partOfSpeech} · ${item.meaning}`);
    await this.say(spokenWord, { lang: item.locale, rate: 0.92 }, runId);
    await this.say(spokenWord, { lang: item.locale, rate: 0.92 }, runId);
    await this.say(`${item.partOfSpeech}，${item.meaning}。`, { lang: "zh-CN", rate: 1 }, runId);
    if (item.chunks?.length) {
      await this.say("听分段。", { lang: "zh-CN" }, runId);
      for (const chunk of item.chunks) {
        await this.say(expandSpeechNotation(chunk), { lang: item.locale, rate: 0.78 }, runId);
      }
      await this.say(spokenWord, { lang: item.locale, rate: 0.9 }, runId);
    }
    await this.say("请跟我读。", { lang: "zh-CN" }, runId);
    setStatus("轮到你跟读", "说完后系统会自动继续。", { listening: true });
    const result = await this.listen(item);
    const command = this.commandFrom(result);
    if (command) {
      const outcome = await this.handleCommand(command, item, "follow", runId);
      if (outcome === "retry-stage" && this.running) return this.teach(item, runId);
      return;
    }
    this.ensureActive(runId);
    this.engine.markFollowed({ heard: Boolean(result.transcript) });
    if (result.transcript) {
      setStatus("已经听到你的跟读", `识别结果：${result.transcript}`);
      await this.say("听到了。", { lang: "zh-CN", rate: 1.05 }, runId);
    } else {
      await this.say("这次没有听清，不记错。我们继续。", { lang: "zh-CN", rate: 1 }, runId);
    }
  }

  async recall(item, isRetry, runId) {
    let emptyAttempts = 0;
    while (this.running && !this.paused && !this.stopped) {
      const prefix = isRetry ? "再来一次。" : "现在请回忆。";
      const prompt = `${prefix}${item.meaning}，英文怎么说？`;
      setStatus("请回忆英文单词", `${item.partOfSpeech} · ${item.meaning}`, { listening: false });
      await this.say(prompt, { lang: "zh-CN", rate: 1 }, runId);
      setStatus("正在听你的回答", "可以说“不知道”“重复”或“拼读”。", { listening: true });
      const result = await this.listen(item);
      const command = this.commandFrom(result);
      if (command) {
        const outcome = await this.handleCommand(command, item, "recall", runId);
        if (outcome === "ask-again") continue;
        return;
      }
      this.ensureActive(runId);

      if (!result.transcript) {
        emptyAttempts += 1;
        if (emptyAttempts < 2) {
          await this.say("我没有听清，请再说一次。", { lang: "zh-CN" }, runId);
          continue;
        }
        this.engine.completeCurrent({ correct: false, recognitionFailure: true });
        await this.correct(item, "连续两次没有听清。这次不作为知识错误，但会稍后再练。", runId);
        return;
      }

      setStatus("已经收到回答", `识别结果：${result.transcript}`);
      const evaluation = evaluateAnswer(item, this.recognizedTranscripts(result));
      const recognitionConfidence = this.recognitionConfidence(result);
      if (evaluation.correct) {
        this.engine.completeCurrent({ correct: true });
        await this.say("对。", { lang: "zh-CN", rate: 1 }, runId);
        await this.say(this.spokenWord(item), { lang: item.locale, rate: 0.94 }, runId);
      } else if (recognitionConfidence !== null && recognitionConfidence < 0.35) {
        this.engine.completeCurrent({ correct: false, recognitionFailure: true });
        await this.say("我可能没有听清。这次不记错，稍后再试。", { lang: "zh-CN" }, runId);
      } else {
        this.engine.completeCurrent({ correct: false });
        await this.correct(item, "还不对。", runId);
      }
      return;
    }
  }

  async correct(item, lead, runId) {
    await this.say(lead, { lang: "zh-CN" }, runId);
    await this.say("正确答案是。", { lang: "zh-CN" }, runId);
    await this.say(this.spokenWord(item), { lang: item.locale, rate: 0.88 }, runId);
    await this.say("请跟我读。", { lang: "zh-CN" }, runId);
    await this.say(this.spokenWord(item), { lang: item.locale, rate: 0.88 }, runId);
  }

  async handleCommand(command, item, stage, runId) {
    if (command === "pause") {
      this.pause();
      return "halt";
    }
    if (command === "stop") {
      await this.stop();
      return "halt";
    }
    if (command === "repeat") {
      await this.say(stage === "follow" ? this.spokenWord(item) : `${item.meaning}，英文怎么说？`, {
        lang: stage === "follow" ? item.locale : "zh-CN",
        rate: 0.92
      }, runId);
      return stage === "follow" ? "retry-stage" : "ask-again";
    }
    if (command === "meaning") {
      await this.say(`${item.partOfSpeech}，${item.meaning}。`, { lang: "zh-CN" }, runId);
      return stage === "follow" ? "retry-stage" : "ask-again";
    }
    if (command === "slower") {
      await this.say(this.spokenWord(item), { lang: item.locale, rate: 0.62 }, runId);
      if (stage === "recall") {
        this.engine.completeCurrent({ correct: false, assisted: true });
        await this.say("稍后我会再问一次。", { lang: "zh-CN" }, runId);
        return "advance";
      }
      return "retry-stage";
    }
    if (command === "spell") {
      await this.say("拼写是。", { lang: "zh-CN" }, runId);
      await this.say(toSpelling(item.word), { lang: item.locale, rate: 0.72 }, runId);
      if (stage === "recall") {
        this.engine.completeCurrent({ correct: false, assisted: true });
        await this.say("稍后我会再问一次。", { lang: "zh-CN" }, runId);
        return "advance";
      }
      return "retry-stage";
    }
    if (command === "unknown" || command === "next") {
      if (stage === "recall") {
        this.engine.completeCurrent({ correct: false, assisted: true });
        await this.correct(item, command === "unknown" ? "没关系，我们一起学。" : "先跳过，稍后再练。", runId);
        return "advance";
      }
      return "retry-stage";
    }
    return "ask-again";
  }

  commandFrom(result) {
    if (this.forcedCommand) {
      const command = this.forcedCommand;
      this.forcedCommand = null;
      return command;
    }
    for (const transcript of this.recognizedTranscripts(result)) {
      const command = detectCommand(transcript);
      if (command) return command;
    }
    return null;
  }

  listen(item) {
    const configuredLocale = this.settings.recognitionLocale;
    const lang = configuredLocale === "auto"
      ? item.locale || this.settings.voiceLocale || "en-US"
      : configuredLocale;
    return this.recognizer.listen({
      lang,
      timeoutMs: 11000,
      phrases: this.recognitionPhrases(item)
    });
  }

  requestCommand(command) {
    if (command === "pause") {
      this.pause();
      return;
    }
    if (command === "stop") {
      void this.stop();
      return;
    }
    if (!this.running) return;
    this.forcedCommand = command;
    this.recognizer.abort();
  }

  pause() {
    if (!this.running) return;
    this.activeRunId += 1;
    this.paused = true;
    this.running = false;
    this.speaker.cancel();
    this.recognizer.abort();
    this.saveSession();
    this.showPaused();
  }

  showPaused() {
    document.body.classList.remove("is-listening");
    setStatus("学习已暂停", "进度已经保存，点击继续学习即可恢复。");
    elements.start.textContent = "继续学习";
    elements.start.disabled = false;
    elements.pause.disabled = true;
    elements.stop.disabled = false;
  }

  async stop() {
    this.activeRunId += 1;
    this.stopped = true;
    this.running = false;
    this.paused = false;
    this.speaker.cancel();
    this.recognizer.abort();
    this.saveSession();
    document.body.classList.remove("audio-session", "is-listening");
    setStatus("本次学习已结束", "进度已经保存，下次可以继续。 ");
    elements.start.textContent = "继续学习";
    elements.start.disabled = false;
    elements.pause.disabled = true;
    elements.stop.disabled = true;
    await this.releaseWakeLock();
  }

  async completeSession() {
    this.running = false;
    document.body.classList.remove("audio-session", "is-listening");
    const stats = this.engine.stats;
    setStatus("今天的学习完成了", `正确 ${stats.correct} 次，待巩固 ${stats.incorrect} 次。`);
    await this.speaker.speak(`今天的学习完成了。正确${stats.correct}次，需要继续巩固${stats.incorrect}次。`, { lang: "zh-CN" });
    store.addHistory({
      packId: this.pack.id,
      packTitle: this.pack.title,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      stats
    });
    const progress = store.getProgress(this.pack.id);
    const newCount = this.engine.queue.filter((entry) => entry.kind === "new").length;
    const mastery = { ...progress.mastery };
    for (const [itemId, result] of Object.entries(this.engine.results)) mastery[itemId] = result;
    store.setProgress(this.pack.id, {
      nextOffset: (progress.nextOffset + newCount) % this.pack.items.length,
      mastery
    });
    store.clearSession();
    elements.start.textContent = "开始下一次学习";
    elements.start.disabled = false;
    elements.pause.disabled = true;
    elements.stop.disabled = true;
    this.renderProgress();
    renderHistory();
    await this.releaseWakeLock();
  }

  renderProgress() {
    if (!this.engine) {
      elements.studentProgress.style.width = "0%";
      return;
    }
    const percent = Math.round((this.engine.cursor / Math.max(1, this.engine.queue.length)) * 100);
    elements.studentProgress.style.width = `${percent}%`;
    elements.studentProgress.parentElement.setAttribute("aria-valuenow", String(percent));
  }

  saveSession() {
    if (!this.engine || !this.pack) return;
    store.setSession({
      packId: this.pack.id,
      itemIds: [...this.engine.items.keys()],
      engine: this.engine.snapshot(),
      startedAt: this.startedAt,
      completed: this.engine.completed
    });
  }

  async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      this.wakeLock = null;
    }
  }

  async releaseWakeLock() {
    try { await this.wakeLock?.release(); } catch { /* no-op */ }
    this.wakeLock = null;
  }
}

const controller = new LearningController();

elements.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.viewTarget)));
elements.start.addEventListener("click", () => controller.start());
elements.pause.addEventListener("click", () => controller.requestCommand("pause"));
elements.stop.addEventListener("click", () => controller.requestCommand("stop"));
elements.commandButtons.forEach((button) => button.addEventListener("click", () => controller.requestCommand(button.dataset.command)));

elements.packFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) elements.csv.value = await file.text();
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = new FormData(elements.form);
    const metadata = {
      title: data.get("title")?.trim(),
      publisher: data.get("publisher")?.trim(),
      edition: data.get("edition")?.trim(),
      reference: data.get("reference")?.trim(),
      locale: data.get("voiceLocale")
    };
    const pack = packFromCsv(elements.csv.value, metadata);
    store.setPack(pack);
    store.setSettings({
      dailyCount: Number(data.get("dailyCount")),
      retryGap: Number(data.get("retryGap")),
      recognitionLocale: data.get("recognitionLocale"),
      voiceLocale: data.get("voiceLocale")
    });
    showImportMessage(`已导入 ${pack.items.length} 个单词。教材内容仅保存在当前浏览器。`);
    renderPack();
  } catch (error) {
    showImportMessage(error.message, "error");
  }
});

elements.loadDemo.addEventListener("click", () => {
  try {
    const pack = validatePack(samplePack);
    store.setPack(pack);
    showImportMessage("已手动加载非教材演示词表。它只用于体验，不代表任何教材版本。");
    renderPack();
  } catch (error) {
    showImportMessage(error.message, "error");
  }
});

elements.clearData.addEventListener("click", () => {
  if (!confirm("确定清除当前浏览器中的词表、进度和学习记录吗？此操作无法撤销。")) return;
  controller.requestCommand("stop");
  store.clearAll();
  elements.csv.value = "word,meaning,partOfSpeech,unit,chunks,aliases,note,locale";
  showImportMessage("本地数据已清除。教材内容和学习记录均已移除。");
  renderPack();
  renderHistory();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js")
    .then((registration) => registration.update())
    .catch(() => {});
}

renderPack();
renderHistory();
controller.renderProgress();
