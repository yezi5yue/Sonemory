/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mergePackUpdate, packFromCsv, packToCsv, stableId, validatePack } from "./content.js?v=0.2.0";
import { detectCommand, evaluateAnswer, SessionEngine } from "./engine.js?v=0.2.0";
import { expandSpeechNotation, speechForms, toSpelling } from "./notation.js?v=0.2.0";
import { samplePack } from "./sample-pack.js?v=0.2.0";
import { BrowserRecognizer, BrowserSpeaker } from "./speech.js?v=0.2.0";
import { store } from "./storage.js?v=0.2.0";

const EMPTY_CSV = "word,meaning,partOfSpeech,unit,chunks,aliases,note,locale";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  tabs: $$('[data-view-target]'),
  views: $$('[data-view]'),
  start: $("#start-session"),
  pause: $("#pause-session"),
  stop: $("#stop-session"),
  studentStatus: $("#student-status"),
  studentDetail: $("#student-detail"),
  studentProgress: $("#student-progress"),
  studentCourse: $("#student-course"),
  studentPack: $("#student-pack"),
  selectionNote: $("#selection-note"),
  packBadge: $("#pack-badge"),
  commandButtons: $$('[data-command]'),
  courseForm: $("#course-form"),
  courseMessage: $("#course-message"),
  courseList: $("#course-list"),
  libraryCount: $("#library-count"),
  libraryCourseFilter: $("#library-course-filter"),
  materialList: $("#material-list"),
  emptyLibrary: $("#empty-library"),
  form: $("#pack-form"),
  formTitle: $("#pack-form-title"),
  editingPackId: $("#editing-pack-id"),
  packCourse: $("#pack-course"),
  packFile: $("#pack-file"),
  csv: $("#csv-input"),
  cancelPackEdit: $("#cancel-pack-edit"),
  loadDemo: $("#load-demo"),
  importMessage: $("#import-message"),
  settingsForm: $("#settings-form"),
  settingsMessage: $("#settings-message"),
  prepareLocalSpeech: $("#prepare-local-speech"),
  speechCapability: $("#speech-capability"),
  clearData: $("#clear-data"),
  packSummary: $("#pack-summary"),
  history: $("#history-list"),
  emptyHistory: $("#empty-history")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function showMessage(element, message, kind = "success") {
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = false;
}

function makeId(prefix, name) {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${stableId(`${name}:${randomPart}`)}`;
}

function courseOptions(courses, placeholder = "请先新建课程") {
  if (!courses.length) return `<option value="">${placeholder}</option>`;
  return courses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.name)}</option>`).join("");
}

function currentContext() {
  const selection = store.getSelection();
  return {
    selection,
    course: selection.courseId ? store.getCourse(selection.courseId) : null,
    pack: selection.packId ? store.getPack(selection.packId) : null
  };
}

function renderSelection() {
  const library = store.getLibrary();
  const { selection, course, pack } = currentContext();
  elements.studentCourse.innerHTML = courseOptions(library.courses);
  elements.studentCourse.value = selection.courseId ?? "";

  const packs = library.packs.filter((candidate) => candidate.courseId === selection.courseId);
  elements.studentPack.innerHTML = packs.length
    ? packs.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.title)}</option>`).join("")
    : '<option value="">当前课程暂无资料</option>';
  elements.studentPack.value = selection.packId ?? "";
  elements.studentCourse.disabled = controller.running || !library.courses.length;
  elements.studentPack.disabled = controller.running || !packs.length;

  if (!pack) {
    elements.packBadge.textContent = course ? `${course.name} · 暂无资料` : "尚未选择学习资料";
    elements.packBadge.dataset.state = "empty";
    elements.selectionNote.textContent = course ? "请为当前课程导入内容资料。" : "请先在资料管理中创建课程并导入内容。";
    if (!controller.running) elements.start.disabled = true;
  } else {
    elements.packBadge.textContent = `${course?.name ?? "未分类"} · ${pack.title} · ${pack.items.length}项`;
    elements.packBadge.dataset.state = "ready";
    elements.selectionNote.textContent = `${pack.source.publisher} · ${pack.source.edition} · ${pack.items.length} 个学习项`;
    if (!controller.running) elements.start.disabled = false;
  }
  renderPackSummary(course, pack);
}

function renderPackSummary(course, pack) {
  if (!pack) {
    elements.packSummary.innerHTML = "<p>尚未选择学习资料。请在资料管理页创建课程并导入内容。</p>";
    return;
  }
  elements.packSummary.innerHTML = `
    <dl class="summary-grid">
      <div><dt>课程</dt><dd>${escapeHtml(course?.name ?? "未分类")}</dd></div>
      <div><dt>资料</dt><dd>${escapeHtml(pack.title)}</dd></div>
      <div><dt>发布机构</dt><dd>${escapeHtml(pack.source.publisher)}</dd></div>
      <div><dt>版本</dt><dd>${escapeHtml(pack.source.edition)}</dd></div>
      <div><dt>学习项</dt><dd>${pack.items.length}</dd></div>
      <div><dt>最近更新</dt><dd>${new Date(pack.updatedAt ?? pack.importedAt).toLocaleDateString("zh-CN")}</dd></div>
    </dl>
    <p class="source-note">${escapeHtml(pack.source.reference || "未填写补充来源说明")}</p>`;
}

function renderLibrary({ keepFilter = true } = {}) {
  const library = store.getLibrary();
  const selection = store.getSelection();
  const previousFilter = keepFilter ? elements.libraryCourseFilter.value : "";
  const filterCourseId = library.courses.some((course) => course.id === previousFilter)
    ? previousFilter
    : selection.courseId ?? library.courses[0]?.id ?? "";

  elements.libraryCount.textContent = `${library.courses.length} 门课程 · ${library.packs.length} 份资料`;
  elements.courseList.innerHTML = library.courses.length ? library.courses.map((course) => {
    const packCount = library.packs.filter((pack) => pack.courseId === course.id).length;
    return `<article class="course-card${course.id === selection.courseId ? " is-selected" : ""}">
      <div><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(course.description || "未填写课程说明")} · ${packCount} 份资料</span></div>
      <div class="inline-actions">
        <button type="button" data-course-action="select" data-course-id="${escapeHtml(course.id)}">选择</button>
        <button type="button" data-course-action="rename" data-course-id="${escapeHtml(course.id)}">重命名</button>
        <button type="button" data-course-action="delete" data-course-id="${escapeHtml(course.id)}">删除</button>
      </div>
    </article>`;
  }).join("") : '<div class="mini-empty">还没有课程。</div>';

  const options = courseOptions(library.courses);
  elements.libraryCourseFilter.innerHTML = options;
  elements.libraryCourseFilter.value = filterCourseId;
  elements.libraryCourseFilter.disabled = !library.courses.length;
  elements.packCourse.innerHTML = options;
  elements.packCourse.disabled = !library.courses.length;
  if (!elements.editingPackId.value || !library.courses.some((course) => course.id === elements.packCourse.value)) {
    elements.packCourse.value = filterCourseId;
  }

  const packs = library.packs.filter((pack) => pack.courseId === filterCourseId);
  elements.emptyLibrary.hidden = packs.length > 0;
  elements.materialList.innerHTML = packs.map((pack) => `<article class="material-card${pack.id === selection.packId ? " is-selected" : ""}">
    <div><strong>${escapeHtml(pack.title)}</strong><span>${pack.items.length} 项 · ${escapeHtml(pack.source.publisher)} · ${escapeHtml(pack.source.edition)}</span></div>
    <div class="inline-actions">
      <button type="button" data-material-action="select" data-pack-id="${escapeHtml(pack.id)}">用于学习</button>
      <button type="button" data-material-action="edit" data-pack-id="${escapeHtml(pack.id)}">编辑内容</button>
      <button type="button" data-material-action="delete" data-pack-id="${escapeHtml(pack.id)}">删除</button>
    </div>
  </article>`).join("");

  renderSelection();
}

function resetPackForm(courseId = null) {
  elements.form.reset();
  elements.editingPackId.value = "";
  elements.csv.value = EMPTY_CSV;
  elements.formTitle.textContent = "导入新资料";
  elements.cancelPackEdit.hidden = true;
  elements.importMessage.hidden = true;
  const selectedCourseId = courseId ?? store.getSelection().courseId;
  if (selectedCourseId) elements.packCourse.value = selectedCourseId;
}

function editPack(packId) {
  const pack = store.getPack(packId);
  if (!pack) return;
  elements.editingPackId.value = pack.id;
  elements.packCourse.value = pack.courseId;
  elements.form.elements.title.value = pack.title;
  elements.form.elements.publisher.value = pack.source.publisher;
  elements.form.elements.edition.value = pack.source.edition;
  elements.form.elements.reference.value = pack.source.reference ?? "";
  elements.csv.value = packToCsv(pack);
  elements.formTitle.textContent = `编辑资料：${pack.title}`;
  elements.cancelPackEdit.hidden = false;
  elements.importMessage.hidden = true;
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSettings() {
  const settings = store.getSettings();
  for (const [name, value] of Object.entries(settings)) {
    const field = elements.settingsForm.elements[name];
    if (field) field.value = String(value);
  }
  const recognizer = controller.recognizer;
  elements.speechCapability.textContent = recognizer.supportsOnDevice
    ? "浏览器支持设备端语音包检测；点击按钮检查所选语言。"
    : "当前浏览器不支持网页设备端语音包管理，可继续使用浏览器默认识别服务。";
}

function renderHistory() {
  const history = store.getHistory();
  elements.emptyHistory.hidden = history.length > 0;
  elements.history.innerHTML = history.map((entry) => `
    <article class="history-card">
      <div>
        <p class="history-date">${new Date(entry.completedAt).toLocaleString("zh-CN")}</p>
        <h3>${escapeHtml(entry.courseName ? `${entry.courseName} · ${entry.packTitle}` : entry.packTitle)}</h3>
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
    this.course = null;
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
    const context = currentContext();
    this.pack = context.pack;
    this.course = context.course;
    this.settings = store.getSettings();
    if (!this.pack) {
      setStatus("需要家长先选择学习资料", "打开资料管理，创建课程并导入内容。 ");
      switchView("library");
      return;
    }

    if (!this.speaker.supported || !this.recognizer.supported) {
      setStatus("当前浏览器缺少完整语音能力", "请使用支持语音播放和语音识别的最新版浏览器。 ");
      return;
    }

    if (this.settings.recognitionMode === "local-only") {
      const locale = this.recognitionLocale(this.pack.items[0]);
      const availability = await this.recognizer.onDeviceAvailability(locale);
      if (availability !== "available") {
        setStatus("设备端语言包尚未就绪", "请在学习设置中检测并安装对应语言包，或改用自动回退模式。 ");
        switchView("settings");
        return;
      }
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
    elements.studentCourse.disabled = true;
    elements.studentPack.disabled = true;
    await this.requestWakeLock();

    try {
      await this.say("Sonemory.", { lang: "en-US", rate: 0.92 }, runId);
      await this.say("声声入忆，语音陪学。", { lang: "zh-CN", rate: 1 }, runId);
      await this.say(`本次学习，${this.course?.name ?? "当前课程"}，${this.pack.title}。`, { lang: "zh-CN", rate: 1 }, runId);
      await this.say(`今天学习${this.engine.queue.filter((entry) => entry.kind === "new").length}个单词。学习中可以说，重复，慢一点，拼读，不会，暂停或结束。`, { lang: "zh-CN", rate: 1 }, runId);
      await this.run(runId);
    } catch (error) {
      if (error instanceof FlowInterrupted) return;
      this.running = false;
      elements.start.disabled = false;
      elements.pause.disabled = true;
      elements.stop.disabled = true;
      renderSelection();
      setStatus("学习流程暂时无法继续", error.message || "请稍后重试。 ");
    }
  }

  recognitionLocale(item) {
    return this.settings.recognitionLocale === "auto"
      ? item.locale || this.settings.voiceLocale || "en-US"
      : this.settings.recognitionLocale;
  }

  ensureActive(runId) {
    if (runId !== this.activeRunId || !this.running || this.paused || this.stopped) throw new FlowInterrupted();
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
    const commands = ["repeat", "slow down", "spell", "meaning", "I don't know", "skip", "pause", "stop"];
    return [...new Set([item.word, ...(item.aliases ?? [])].flatMap(speechForms).concat(commands))];
  }

  prepareEngine() {
    const stored = store.getSession();
    if (stored?.packId === this.pack.id && stored.itemIds?.length && !stored.completed) {
      const items = stored.itemIds.map((id) => this.pack.items.find((item) => item.id === id)).filter(Boolean);
      if (items.length) {
        this.engine = new SessionEngine({ items, retryGap: this.settings.retryGap, maxRetries: 1, snapshot: stored.engine });
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
      for (const chunk of item.chunks) await this.say(expandSpeechNotation(chunk), { lang: item.locale, rate: 0.78 }, runId);
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
      setStatus("请回忆英文单词", `${item.partOfSpeech} · ${item.meaning}`);
      await this.say(`${prefix}${item.meaning}，英文怎么说？`, { lang: "zh-CN", rate: 1 }, runId);
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
    if (command === "pause") { this.pause(); return "halt"; }
    if (command === "stop") { await this.stop(); return "halt"; }
    if (command === "repeat") {
      await this.say(stage === "follow" ? this.spokenWord(item) : `${item.meaning}，英文怎么说？`, {
        lang: stage === "follow" ? item.locale : "zh-CN", rate: 0.92
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

  async listen(item) {
    const lang = this.recognitionLocale(item);
    const processLocally = await this.recognizer.shouldProcessLocally(lang, this.settings.recognitionMode);
    return this.recognizer.listen({ lang, timeoutMs: 10000, phrases: this.recognitionPhrases(item), processLocally });
  }

  requestCommand(command) {
    if (command === "pause") { this.pause(); return; }
    if (command === "stop") { void this.stop(); return; }
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
    setStatus("学习已暂停", "进度已经保存，点击继续学习即可恢复。 ");
    elements.start.textContent = "继续学习";
    elements.start.disabled = false;
    elements.pause.disabled = true;
    elements.stop.disabled = false;
    renderSelection();
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
    elements.pause.disabled = true;
    elements.stop.disabled = true;
    renderSelection();
    await this.releaseWakeLock();
  }

  async completeSession() {
    this.running = false;
    document.body.classList.remove("audio-session", "is-listening");
    const stats = this.engine.stats;
    setStatus("今天的学习完成了", `正确 ${stats.correct} 次，待巩固 ${stats.incorrect} 次。`);
    await this.speaker.speak(`今天的学习完成了。正确${stats.correct}次，需要继续巩固${stats.incorrect}次。`, { lang: "zh-CN" });
    store.addHistory({
      courseId: this.course?.id,
      courseName: this.course?.name,
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
    store.setProgress(this.pack.id, { nextOffset: (progress.nextOffset + newCount) % this.pack.items.length, mastery });
    store.clearSession();
    elements.start.textContent = "开始下一次学习";
    elements.pause.disabled = true;
    elements.stop.disabled = true;
    this.renderProgress();
    renderSelection();
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
    try { this.wakeLock = await navigator.wakeLock?.request("screen"); } catch { this.wakeLock = null; }
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

elements.studentCourse.addEventListener("change", () => {
  if (!elements.studentCourse.value) return;
  store.setSelection({ courseId: elements.studentCourse.value });
  renderLibrary({ keepFilter: false });
});

elements.studentPack.addEventListener("change", () => {
  if (!elements.studentCourse.value || !elements.studentPack.value) return;
  store.setSelection({ courseId: elements.studentCourse.value, packId: elements.studentPack.value });
  renderLibrary();
});

elements.courseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = new FormData(elements.courseForm);
    const course = store.saveCourse({
      id: makeId("course", data.get("name")),
      name: data.get("name"),
      description: data.get("description")
    });
    store.setSelection({ courseId: course.id });
    elements.courseForm.reset();
    showMessage(elements.courseMessage, `已创建课程“${course.name}”。`);
    renderLibrary({ keepFilter: false });
    resetPackForm(course.id);
  } catch (error) {
    showMessage(elements.courseMessage, error.message, "error");
  }
});

elements.courseList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-course-action]");
  if (!button) return;
  const course = store.getCourse(button.dataset.courseId);
  if (!course) return;
  try {
    if (button.dataset.courseAction === "select") {
      store.setSelection({ courseId: course.id });
      elements.libraryCourseFilter.value = course.id;
      resetPackForm(course.id);
    }
    if (button.dataset.courseAction === "rename") {
      const name = prompt("请输入新的课程名称：", course.name)?.trim();
      if (!name || name === course.name) return;
      store.saveCourse({ ...course, name });
    }
    if (button.dataset.courseAction === "delete") {
      if (!confirm(`确定删除课程“${course.name}”吗？只能删除没有资料的课程。`)) return;
      store.deleteCourse(course.id);
    }
    renderLibrary({ keepFilter: false });
  } catch (error) {
    showMessage(elements.courseMessage, error.message, "error");
  }
});

elements.libraryCourseFilter.addEventListener("change", () => {
  renderLibrary();
  resetPackForm(elements.libraryCourseFilter.value);
});

elements.materialList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-material-action]");
  if (!button) return;
  const pack = store.getPack(button.dataset.packId);
  if (!pack) return;
  if (button.dataset.materialAction === "select") {
    store.setSelection({ courseId: pack.courseId, packId: pack.id });
    renderLibrary();
    switchView("student");
  }
  if (button.dataset.materialAction === "edit") editPack(pack.id);
  if (button.dataset.materialAction === "delete") {
    if (!confirm(`确定删除资料“${pack.title}”及其本地学习进度吗？此操作无法撤销。`)) return;
    store.deletePack(pack.id);
    if (elements.editingPackId.value === pack.id) resetPackForm(pack.courseId);
    renderLibrary();
  }
});

elements.packFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) elements.csv.value = await file.text();
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = new FormData(elements.form);
    const courseId = data.get("courseId");
    const imported = packFromCsv(elements.csv.value, {
      title: data.get("title")?.trim(),
      publisher: data.get("publisher")?.trim(),
      edition: data.get("edition")?.trim(),
      reference: data.get("reference")?.trim(),
      locale: store.getSettings().voiceLocale
    });
    const existing = elements.editingPackId.value ? store.getPack(elements.editingPackId.value) : null;
    const pack = { ...(existing ? mergePackUpdate(existing, imported) : imported), courseId };
    store.savePack(pack);
    store.setSelection({ courseId, packId: pack.id });
    renderLibrary({ keepFilter: false });
    elements.libraryCourseFilter.value = courseId;
    if (existing) editPack(pack.id);
    else resetPackForm(courseId);
    showMessage(elements.importMessage, `${existing ? "已更新" : "已导入"} ${pack.items.length} 个学习项，并设为当前学习资料。`);
  } catch (error) {
    showMessage(elements.importMessage, error.message, "error");
  }
});

elements.cancelPackEdit.addEventListener("click", () => resetPackForm(elements.packCourse.value));

elements.loadDemo.addEventListener("click", () => {
  try {
    let course = store.getCourses().find((candidate) => candidate.name === "演示课程");
    if (!course) course = store.saveCourse({ id: makeId("course", "演示课程"), name: "演示课程", description: "不对应任何教材" });
    const pack = { ...validatePack(samplePack), courseId: course.id, updatedAt: new Date().toISOString() };
    store.savePack(pack);
    store.setSelection({ courseId: course.id, packId: pack.id });
    renderLibrary({ keepFilter: false });
    resetPackForm(course.id);
    showMessage(elements.importMessage, "已添加非教材演示资料，并设为当前学习内容。 ");
  } catch (error) {
    showMessage(elements.importMessage, error.message, "error");
  }
});

elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.settingsForm);
  store.setSettings({
    dailyCount: Number(data.get("dailyCount")),
    retryGap: Number(data.get("retryGap")),
    recognitionMode: data.get("recognitionMode"),
    recognitionLocale: data.get("recognitionLocale"),
    voiceLocale: data.get("voiceLocale")
  });
  showMessage(elements.settingsMessage, "学习与语音设置已保存。 ");
});

elements.prepareLocalSpeech.addEventListener("click", async () => {
  const localeField = elements.settingsForm.elements.recognitionLocale.value;
  const locale = localeField === "auto" ? elements.settingsForm.elements.voiceLocale.value : localeField;
  elements.prepareLocalSpeech.disabled = true;
  elements.speechCapability.textContent = `正在检测 ${locale} 设备端语言包…`;
  const availability = await controller.recognizer.onDeviceAvailability(locale, { refresh: true });
  if (availability === "available") {
    elements.speechCapability.textContent = `${locale} 设备端语言包已可用。`;
  } else if (["downloadable", "downloading"].includes(availability)) {
    elements.speechCapability.textContent = `正在安装 ${locale} 设备端语言包…`;
    const installed = await controller.recognizer.installOnDevice(locale);
    elements.speechCapability.textContent = installed
      ? `${locale} 语言包安装完成，可以选择“仅使用设备端识别”。`
      : `${locale} 语言包安装失败，请检查网络、浏览器版本或系统支持。`;
  } else if (availability === "unavailable") {
    elements.speechCapability.textContent = `${locale} 暂无可安装的设备端语言包，请使用自动回退或浏览器默认识别。`;
  } else {
    elements.speechCapability.textContent = "当前浏览器不支持网页设备端语言包管理，请更新 Chromium 浏览器或使用默认识别服务。";
  }
  elements.prepareLocalSpeech.disabled = false;
});

elements.clearData.addEventListener("click", () => {
  if (!confirm("确定清除当前浏览器中的全部课程、资料、进度和学习记录吗？此操作无法撤销。")) return;
  controller.requestCommand("stop");
  store.clearAll();
  resetPackForm();
  showMessage(elements.settingsMessage, "全部本地课程、资料、进度和学习记录已清除。 ");
  renderLibrary({ keepFilter: false });
  renderHistory();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").then((registration) => registration.update()).catch(() => {});
}

renderLibrary({ keepFilter: false });
renderSettings();
renderHistory();
controller.renderProgress();
