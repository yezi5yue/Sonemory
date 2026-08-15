/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mergePackUpdate, packFromCsv, packToCsv, stableId, validatePack } from "./content.js?v=0.6.0";
import { importedFileToCsv } from "./importers.js?v=0.6.0";
import { detectCommand, evaluateAnswer, mergeMasteryResult, SessionEngine } from "./engine.js?v=0.6.0";
import { expandSpeechNotation, speechForms, toSpelling } from "./notation.js?v=0.6.0";
import { samplePack } from "./sample-pack.js?v=0.6.0";
import { BrowserRecognizer, BrowserSpeaker, diagnoseMicrophone, GatewayRecognizer, GatewaySpeaker, validateSpeechEndpoint } from "./speech.js?v=0.6.0";
import { store } from "./storage.js?v=0.6.0";

const APP_VERSION = "0.6.0";
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
  studentCategory: $("#student-category"),
  studentSubcategory: $("#student-subcategory"),
  studentCourse: $("#student-course"),
  studentCourseLabel: $("#student-course-label"),
  coursePickerPopover: $("#course-picker-popover"),
  courseFilter: $("#course-filter"),
  courseOptions: $("#course-options"),
  studentPack: $("#student-pack"),
  studentUnit: $("#student-unit"),
  selectionNote: $("#selection-note"),
  packBadge: $("#pack-badge"),
  commandButtons: $$('[data-command]'),
  categoryForm: $("#category-form"),
  categoryMessage: $("#category-message"),
  subcategoryForm: $("#subcategory-form"),
  subcategoryCategory: $("#subcategory-category"),
  subcategoryMessage: $("#subcategory-message"),
  courseForm: $("#course-form"),
  editingCourseId: $("#editing-course-id"),
  courseFormTitle: $("#course-form-title"),
  cancelCourseEdit: $("#cancel-course-edit"),
  saveCourse: $("#save-course"),
  courseCategory: $("#course-category"),
  courseSubcategory: $("#course-subcategory"),
  courseMessage: $("#course-message"),
  taxonomyList: $("#taxonomy-list"),
  courseList: $("#course-list"),
  libraryCount: $("#library-count"),
  libraryCourseFilter: $("#library-course-filter"),
  materialList: $("#material-list"),
  emptyLibrary: $("#empty-library"),
  form: $("#pack-form"),
  formTitle: $("#pack-form-title"),
  editingPackId: $("#editing-pack-id"),
  packCategory: $("#pack-category"),
  packSubcategory: $("#pack-subcategory"),
  packCourse: $("#pack-course"),
  packFile: $("#pack-file"),
  csv: $("#csv-input"),
  previewImport: $("#preview-import"),
  importPreview: $("#import-preview"),
  cancelPackEdit: $("#cancel-pack-edit"),
  loadDemo: $("#load-demo"),
  importMessage: $("#import-message"),
  masteryDialog: $("#mastery-dialog"),
  masteryTitle: $("#mastery-title"),
  masterySummary: $("#mastery-summary"),
  masteryContent: $("#mastery-content"),
  closeMastery: $("#close-mastery"),
  settingsForm: $("#settings-form"),
  settingsMessage: $("#settings-message"),
  prepareLocalSpeech: $("#prepare-local-speech"),
  speechCapability: $("#speech-capability"),
  browserSpeechSettings: $("#browser-speech-settings"),
  aiGatewaySettings: $("#ai-gateway-settings"),
  aiAccessToken: $("#ai-access-token"),
  aiGatewayStatus: $("#ai-gateway-status"),
  testAiSpeech: $("#test-ai-speech"),
  exportBackup: $("#export-backup"),
  backupFile: $("#backup-file"),
  backupPreview: $("#backup-preview"),
  restoreMode: $("#restore-mode"),
  restoreBackup: $("#restore-backup"),
  backupMessage: $("#backup-message"),
  clearData: $("#clear-data"),
  packSummary: $("#pack-summary"),
  history: $("#history-list"),
  emptyHistory: $("#empty-history")
};

let learningChoice = { categoryId: null, subcategoryId: null, courseId: null, packId: null };
let learningUnit = "";
let pendingBackup = null;

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

function namedOptions(items, placeholder) {
  if (!items.length) return `<option value="">${escapeHtml(placeholder)}</option>`;
  return items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
}

function coursePathOptions(courses, placeholder, library = store.getLibrary()) {
  if (!courses.length) return `<option value="">${escapeHtml(placeholder)}</option>`;
  return courses.map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(`${coursePath(course, library)} / ${course.name}`)}</option>`).join("");
}

function coursePath(course, library = store.getLibrary()) {
  const category = library.categories.find((item) => item.id === course?.categoryId);
  const subcategory = library.subcategories.find((item) => item.id === course?.subcategoryId);
  return [category?.name, subcategory?.name].filter(Boolean).join(" / ");
}

function itemsForUnit(pack, unit = learningUnit) {
  if (!pack?.items) return [];
  return unit ? pack.items.filter((item) => item.unit === unit) : pack.items;
}

function unitOptions(pack) {
  const counts = new Map();
  for (const item of pack?.items ?? []) counts.set(item.unit, (counts.get(item.unit) ?? 0) + 1);
  return [
    `<option value="">全部内容（${pack?.items?.length ?? 0} 项）</option>`,
    ...[...counts].map(([unit, count]) => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}（${count} 项）</option>`)
  ].join("");
}

function progressSummary(pack, unit = learningUnit) {
  const items = itemsForUnit(pack, unit);
  const mastery = store.getProgress(pack.id).mastery ?? {};
  const practiced = items.filter((item) => mastery[item.id]).length;
  const review = items.filter((item) => {
    const result = mastery[item.id];
    return result && Number(result.incorrect ?? 0) + Number(result.assisted ?? 0) >= Math.max(1, Number(result.correct ?? 0));
  }).length;
  return { total: items.length, practiced, review };
}

function renderCourseFormSubcategories(categoryId, preferredId = "") {
  const subcategories = store.getSubcategories(categoryId);
  elements.courseSubcategory.innerHTML = namedOptions(subcategories, "请先新建子类");
  elements.courseSubcategory.value = subcategories.some((item) => item.id === preferredId)
    ? preferredId
    : subcategories[0]?.id ?? "";
  elements.courseSubcategory.disabled = !subcategories.length;
}

function renderPackCourses(subcategoryId, preferredId = "") {
  const courses = store.getCourses(subcategoryId);
  elements.packCourse.innerHTML = namedOptions(courses, "当前子类暂无课程");
  elements.packCourse.value = courses.some((item) => item.id === preferredId) ? preferredId : courses[0]?.id ?? "";
  elements.packCourse.disabled = !courses.length;
}

function renderPackSubcategories(categoryId, preferredSubcategoryId = "", preferredCourseId = "") {
  const subcategories = store.getSubcategories(categoryId);
  elements.packSubcategory.innerHTML = namedOptions(subcategories, "当前大类暂无子类");
  elements.packSubcategory.value = subcategories.some((item) => item.id === preferredSubcategoryId)
    ? preferredSubcategoryId
    : subcategories[0]?.id ?? "";
  elements.packSubcategory.disabled = !subcategories.length;
  renderPackCourses(elements.packSubcategory.value, preferredCourseId);
}

function setPackHierarchy(courseId = "") {
  const library = store.getLibrary();
  const course = library.courses.find((item) => item.id === courseId)
    ?? library.courses.find((item) => item.subcategoryId === elements.packSubcategory.value)
    ?? library.courses[0]
    ?? null;
  elements.packCategory.innerHTML = namedOptions(library.categories, "请先新建大类");
  elements.packCategory.value = course?.categoryId ?? library.categories[0]?.id ?? "";
  elements.packCategory.disabled = !library.categories.length;
  renderPackSubcategories(elements.packCategory.value, course?.subcategoryId, course?.id);
}

function resetCourseForm({ categoryId = "", subcategoryId = "" } = {}) {
  elements.courseForm.reset();
  elements.editingCourseId.value = "";
  elements.courseFormTitle.textContent = "新建课程";
  elements.saveCourse.textContent = "添加课程";
  elements.cancelCourseEdit.hidden = true;
  elements.courseMessage.hidden = true;
  const library = store.getLibrary();
  elements.courseCategory.value = library.categories.some((item) => item.id === categoryId)
    ? categoryId
    : store.getSelection().categoryId ?? library.categories[0]?.id ?? "";
  renderCourseFormSubcategories(elements.courseCategory.value, subcategoryId);
}

function editCourse(courseId) {
  const course = store.getCourse(courseId);
  if (!course) return;
  elements.editingCourseId.value = course.id;
  elements.courseCategory.value = course.categoryId;
  renderCourseFormSubcategories(course.categoryId, course.subcategoryId);
  elements.courseForm.elements.name.value = course.name;
  elements.courseForm.elements.description.value = course.description ?? "";
  elements.courseFormTitle.textContent = `编辑课程：${course.name}`;
  elements.saveCourse.textContent = "保存课程";
  elements.cancelCourseEdit.hidden = false;
  elements.courseMessage.hidden = true;
  elements.courseForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCoursePicker() {
  elements.coursePickerPopover.hidden = true;
  elements.studentCourse.setAttribute("aria-expanded", "false");
  elements.courseFilter.value = "";
}

function renderCourseOptions() {
  const query = elements.courseFilter.value.trim();
  const library = store.getLibrary();
  const matches = (query
    ? store.searchCourses(query)
    : library.courses.filter((course) => course.subcategoryId === learningChoice.subcategoryId)
  ).slice(0, 10);
  elements.courseOptions.innerHTML = matches.length
    ? matches.map((course) => `<button type="button" role="option" aria-selected="${course.id === learningChoice.courseId}" data-course-option-id="${escapeHtml(course.id)}">
        <strong>${escapeHtml(course.name)}</strong>
        <span>${escapeHtml(coursePath(course, library))}${course.description ? ` · ${escapeHtml(course.description)}` : ""}</span>
      </button>`).join("")
    : `<p class="course-options-empty">${query ? "没有找到匹配课程" : "当前子类暂无课程，可输入名称跨分类搜索"}</p>`;
}

function openCoursePicker() {
  if (elements.studentCourse.disabled) return;
  elements.coursePickerPopover.hidden = false;
  elements.studentCourse.setAttribute("aria-expanded", "true");
  renderCourseOptions();
  elements.courseFilter.focus();
}

function currentContext() {
  const selection = store.getSelection();
  return {
    selection,
    category: selection.categoryId ? store.getCategory(selection.categoryId) : null,
    subcategory: selection.subcategoryId ? store.getSubcategory(selection.subcategoryId) : null,
    course: selection.courseId ? store.getCourse(selection.courseId) : null,
    pack: selection.packId ? store.getPack(selection.packId) : null
  };
}

function syncLearningChoice() {
  learningChoice = { ...store.getSelection() };
}

function renderSelection() {
  const library = store.getLibrary();
  const category = library.categories.find((item) => item.id === learningChoice.categoryId) ?? null;
  const subcategories = library.subcategories.filter((item) => item.categoryId === category?.id);
  const subcategory = subcategories.find((item) => item.id === learningChoice.subcategoryId) ?? null;
  const courses = library.courses.filter((item) => item.subcategoryId === subcategory?.id);
  const course = courses.find((item) => item.id === learningChoice.courseId) ?? null;
  const packs = library.packs.filter((item) => item.courseId === course?.id);
  const pack = packs.find((item) => item.id === learningChoice.packId) ?? null;

  elements.studentCategory.innerHTML = namedOptions(library.categories, "请先新建大类");
  elements.studentCategory.value = category?.id ?? "";
  elements.studentSubcategory.innerHTML = namedOptions(subcategories, "当前大类暂无子类");
  elements.studentSubcategory.value = subcategory?.id ?? "";
  elements.studentCourseLabel.textContent = course?.name ?? "请选择课程";
  elements.studentPack.innerHTML = packs.length
    ? packs.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.title)}</option>`).join("")
    : '<option value="">当前课程暂无资料</option>';
  elements.studentPack.value = pack?.id ?? "";
  const availableUnits = new Set((pack?.items ?? []).map((item) => item.unit));
  if (learningUnit && !availableUnits.has(learningUnit)) learningUnit = "";
  elements.studentUnit.innerHTML = pack ? unitOptions(pack) : '<option value="">请先选择内容资料</option>';
  elements.studentUnit.value = learningUnit;
  elements.studentCategory.disabled = controller.running || !library.categories.length;
  elements.studentSubcategory.disabled = controller.running || !subcategories.length;
  elements.studentCourse.disabled = controller.running || !library.courses.length;
  elements.studentPack.disabled = controller.running || !course || !packs.length;
  elements.studentUnit.disabled = controller.running || !pack;
  if (controller.running) closeCoursePicker();

  if (!pack) {
    elements.packBadge.textContent = course ? `${course.name} · 暂无资料` : "尚未选择学习资料";
    elements.packBadge.dataset.state = "empty";
    if (!category) elements.selectionNote.textContent = "请先在资料管理中创建大类、子类和课程。";
    else if (!subcategory) elements.selectionNote.textContent = "请选择子类后再选择课程。";
    else if (!course) elements.selectionNote.textContent = "请选择课程，或直接搜索课程名称。";
    else elements.selectionNote.textContent = "请为当前课程导入内容资料。";
    if (!controller.running) elements.start.disabled = true;
  } else {
    const progress = progressSummary(pack);
    elements.packBadge.textContent = `${category.name} · ${subcategory.name} · ${course.name} · ${pack.title}`;
    elements.packBadge.dataset.state = "ready";
    elements.selectionNote.textContent = `${pack.source.publisher} · ${pack.source.edition} · 本范围 ${progress.total} 项 · 已练习 ${progress.practiced} 项${progress.review ? ` · 待巩固 ${progress.review} 项` : ""}`;
    if (!controller.running) elements.start.disabled = false;
  }
  renderPackSummary(category, subcategory, course, pack);
}

function renderPackSummary(category, subcategory, course, pack) {
  if (!pack) {
    elements.packSummary.innerHTML = "<p>尚未选择学习资料。请在资料管理页创建课程并导入内容。</p>";
    return;
  }
  const progress = progressSummary(pack);
  elements.packSummary.innerHTML = `
    <dl class="summary-grid">
      <div><dt>大类</dt><dd>${escapeHtml(category?.name ?? "未分类")}</dd></div>
      <div><dt>子类</dt><dd>${escapeHtml(subcategory?.name ?? "未分类")}</dd></div>
      <div><dt>课程</dt><dd>${escapeHtml(course?.name ?? "未分类")}</dd></div>
      <div><dt>资料</dt><dd>${escapeHtml(pack.title)}</dd></div>
      <div><dt>发布机构</dt><dd>${escapeHtml(pack.source.publisher)}</dd></div>
      <div><dt>版本</dt><dd>${escapeHtml(pack.source.edition)}</dd></div>
      <div><dt>学习项</dt><dd>${pack.items.length}</dd></div>
      <div><dt>本次范围</dt><dd>${escapeHtml(learningUnit || "全部内容")} · ${progress.total} 项</dd></div>
      <div><dt>已练习</dt><dd>${progress.practiced} 项</dd></div>
      <div><dt>待巩固</dt><dd>${progress.review} 项</dd></div>
      <div><dt>最近更新</dt><dd>${new Date(pack.updatedAt ?? pack.importedAt).toLocaleDateString("zh-CN")}</dd></div>
    </dl>
    <p class="source-note">${escapeHtml(pack.source.reference || "未填写补充来源说明")}</p>`;
}

function renderLibrary({ keepFilter = true } = {}) {
  const library = store.getLibrary();
  const selection = store.getSelection();
  const previousFilter = keepFilter ? elements.libraryCourseFilter.value : "";
  const previousSubcategoryCategoryId = keepFilter ? elements.subcategoryCategory.value : "";
  const previousCourseCategoryId = keepFilter ? elements.courseCategory.value : "";
  const previousCourseSubcategoryId = keepFilter ? elements.courseSubcategory.value : "";
  const previousPackCourseId = keepFilter ? elements.packCourse.value : "";
  const filterCourseId = library.courses.some((course) => course.id === previousFilter)
    ? previousFilter
    : selection.courseId ?? library.courses[0]?.id ?? "";

  elements.libraryCount.textContent = `${library.categories.length} 个大类 · ${library.subcategories.length} 个子类 · ${library.courses.length} 门课程 · ${library.packs.length} 份资料`;
  elements.taxonomyList.innerHTML = library.categories.length ? library.categories.map((category) => {
    const subcategories = library.subcategories.filter((item) => item.categoryId === category.id);
    return `<article class="taxonomy-card">
      <div class="taxonomy-title"><strong>${escapeHtml(category.name)}</strong><span>${subcategories.length} 个子类</span></div>
      <div class="taxonomy-children">${subcategories.length ? subcategories.map((subcategory) => `
        <div><span>${escapeHtml(subcategory.name)}</span><span class="inline-actions">
          <button type="button" data-taxonomy-action="rename-subcategory" data-subcategory-id="${escapeHtml(subcategory.id)}">重命名</button>
          <button type="button" data-taxonomy-action="delete-subcategory" data-subcategory-id="${escapeHtml(subcategory.id)}">删除</button>
        </span></div>`).join("") : '<span class="muted-text">暂无子类</span>'}</div>
      <div class="inline-actions">
        <button type="button" data-taxonomy-action="rename-category" data-category-id="${escapeHtml(category.id)}">重命名大类</button>
        <button type="button" data-taxonomy-action="delete-category" data-category-id="${escapeHtml(category.id)}">删除大类</button>
      </div>
    </article>`;
  }).join("") : '<div class="mini-empty">还没有分类。</div>';

  elements.courseList.innerHTML = library.courses.length ? library.courses.map((course) => {
    const packCount = library.packs.filter((pack) => pack.courseId === course.id).length;
    const category = library.categories.find((item) => item.id === course.categoryId);
    const subcategory = library.subcategories.find((item) => item.id === course.subcategoryId);
    return `<article class="course-card${course.id === selection.courseId ? " is-selected" : ""}">
      <div><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(category?.name)} / ${escapeHtml(subcategory?.name)} · ${escapeHtml(course.description || "未填写课程说明")} · ${packCount} 份资料</span></div>
      <div class="inline-actions">
        <button type="button" data-course-action="select" data-course-id="${escapeHtml(course.id)}">选择</button>
        <button type="button" data-course-action="edit" data-course-id="${escapeHtml(course.id)}">编辑归属</button>
        <button type="button" data-course-action="delete" data-course-id="${escapeHtml(course.id)}">删除</button>
      </div>
    </article>`;
  }).join("") : '<div class="mini-empty">还没有课程。</div>';

  const categoryOptions = namedOptions(library.categories, "请先新建大类");
  elements.subcategoryCategory.innerHTML = categoryOptions;
  elements.courseCategory.innerHTML = categoryOptions;
  const formCategoryId = library.categories.some((item) => item.id === previousCourseCategoryId)
    ? previousCourseCategoryId
    : selection.categoryId ?? library.categories[0]?.id ?? "";
  const subcategoryFormCategoryId = library.categories.some((item) => item.id === previousSubcategoryCategoryId)
    ? previousSubcategoryCategoryId
    : formCategoryId;
  elements.subcategoryCategory.value = subcategoryFormCategoryId;
  elements.courseCategory.value = formCategoryId;
  const formSubcategories = library.subcategories.filter((item) => item.categoryId === formCategoryId);
  elements.courseSubcategory.innerHTML = namedOptions(formSubcategories, "请先新建子类");
  elements.courseSubcategory.value = formSubcategories.some((item) => item.id === previousCourseSubcategoryId)
    ? previousCourseSubcategoryId
    : formSubcategories.some((item) => item.id === selection.subcategoryId)
      ? selection.subcategoryId
    : formSubcategories[0]?.id ?? "";
  elements.subcategoryCategory.disabled = !library.categories.length;
  elements.courseCategory.disabled = !library.categories.length;
  elements.courseSubcategory.disabled = !formSubcategories.length;

  const options = coursePathOptions(library.courses, "请先新建课程", library);
  elements.libraryCourseFilter.innerHTML = options;
  elements.libraryCourseFilter.value = filterCourseId;
  elements.libraryCourseFilter.disabled = !library.courses.length;
  const editingPack = elements.editingPackId.value ? library.packs.find((pack) => pack.id === elements.editingPackId.value) : null;
  const packCourseId = editingPack?.courseId
    ?? (library.courses.some((course) => course.id === previousPackCourseId) ? previousPackCourseId : filterCourseId);
  setPackHierarchy(packCourseId);

  const packs = library.packs.filter((pack) => pack.courseId === filterCourseId);
  elements.emptyLibrary.hidden = packs.length > 0;
  elements.materialList.innerHTML = packs.map((pack) => {
    const progress = progressSummary(pack, "");
    return `<article class="material-card${pack.id === selection.packId ? " is-selected" : ""}">
      <div><strong>${escapeHtml(pack.title)}</strong><span>${pack.items.length} 项 · ${escapeHtml(pack.source.publisher)} · ${escapeHtml(pack.source.edition)} · 已练习 ${progress.practiced} · 待巩固 ${progress.review}</span></div>
      <div class="inline-actions">
        <button type="button" data-material-action="select" data-pack-id="${escapeHtml(pack.id)}">用于学习</button>
        <button type="button" data-material-action="detail" data-pack-id="${escapeHtml(pack.id)}">学习明细</button>
        <button type="button" data-material-action="edit" data-pack-id="${escapeHtml(pack.id)}">编辑内容</button>
        <button type="button" data-material-action="export" data-pack-id="${escapeHtml(pack.id)}">导出 CSV</button>
        <button type="button" data-material-action="delete" data-pack-id="${escapeHtml(pack.id)}">删除</button>
      </div>
    </article>`;
  }).join("");

  syncLearningChoice();
  renderSelection();
}

function resetPackForm(courseId = null) {
  elements.form.reset();
  elements.editingPackId.value = "";
  elements.csv.value = EMPTY_CSV;
  elements.formTitle.textContent = "导入新资料";
  elements.cancelPackEdit.hidden = true;
  elements.importMessage.hidden = true;
  elements.importPreview.hidden = true;
  elements.importPreview.innerHTML = "";
  const selectedCourseId = courseId ?? store.getSelection().courseId;
  setPackHierarchy(selectedCourseId);
}

function editPack(packId) {
  const pack = store.getPack(packId);
  if (!pack) return;
  elements.editingPackId.value = pack.id;
  setPackHierarchy(pack.courseId);
  elements.form.elements.title.value = pack.title;
  elements.form.elements.publisher.value = pack.source.publisher;
  elements.form.elements.edition.value = pack.source.edition;
  elements.form.elements.reference.value = pack.source.reference ?? "";
  elements.csv.value = packToCsv(pack);
  elements.formTitle.textContent = `编辑资料：${pack.title}`;
  elements.cancelPackEdit.hidden = false;
  elements.importMessage.hidden = true;
  elements.importPreview.hidden = true;
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderImportPreview(sourceLabel = "当前内容") {
  const preview = packFromCsv(elements.csv.value, {
    title: "导入预览",
    publisher: "导入预览",
    edition: "导入预览",
    locale: store.getSettings().voiceLocale
  });
  const rows = preview.items.slice(0, 5).map((item) => `<tr>
    <td>${escapeHtml(item.word)}</td>
    <td>${escapeHtml(item.meaning)}</td>
    <td>${escapeHtml(item.partOfSpeech)}</td>
    <td>${escapeHtml(item.unit)}</td>
    <td>${escapeHtml(item.locale)}</td>
  </tr>`).join("");
  elements.importPreview.innerHTML = `<p><strong>${escapeHtml(sourceLabel)}</strong> · 校验通过，共 ${preview.items.length} 项${preview.items.length > 5 ? "，以下显示前 5 项" : ""}。</p>
    <div class="import-preview-scroll"><table>
      <thead><tr><th>word</th><th>meaning</th><th>partOfSpeech</th><th>unit</th><th>locale</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  elements.importPreview.hidden = false;
  return preview;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSettings() {
  const settings = store.getSettings();
  for (const [name, value] of Object.entries(settings)) {
    const field = elements.settingsForm.elements[name];
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = String(value);
  }
  renderSpeechSettingsVisibility();
  const recognizer = controller.browserRecognizer;
  elements.speechCapability.textContent = recognizer.supportsOnDevice
    ? "浏览器支持设备端语音包检测；点击按钮检查所选语言。"
    : "当前浏览器不支持网页设备端语音包管理，可继续使用浏览器默认识别服务。";
}

function renderSpeechSettingsVisibility() {
  const playbackMode = elements.settingsForm.elements.playbackMode.value;
  const recognitionMode = elements.settingsForm.elements.recognitionMode.value;
  const usesGateway = playbackMode === "ai-gateway" || recognitionMode === "ai-gateway";
  elements.aiGatewaySettings.hidden = !usesGateway;
  elements.browserSpeechSettings.hidden = recognitionMode === "ai-gateway";
}

function speechSettingsFromForm() {
  const data = new FormData(elements.settingsForm);
  const playbackMode = data.get("playbackMode");
  const recognitionMode = data.get("recognitionMode");
  const aiTtsEndpoint = String(data.get("aiTtsEndpoint") ?? "").trim();
  const aiSttEndpoint = String(data.get("aiSttEndpoint") ?? "").trim();
  if (playbackMode === "ai-gateway" && !aiTtsEndpoint) throw new Error("启用 AI 播放前，请填写语音合成端点。");
  if (recognitionMode === "ai-gateway" && !aiSttEndpoint) throw new Error("启用 AI 识别前，请填写语音识别端点。");
  return {
    dailyCount: Number(data.get("dailyCount")),
    retryGap: Number(data.get("retryGap")),
    playbackMode,
    recognitionMode,
    recognitionLocale: data.get("recognitionLocale"),
    voiceLocale: data.get("voiceLocale"),
    aiTtsEndpoint: aiTtsEndpoint ? validateSpeechEndpoint(aiTtsEndpoint) : "",
    aiSttEndpoint: aiSttEndpoint ? validateSpeechEndpoint(aiSttEndpoint) : "",
    aiTtsModel: String(data.get("aiTtsModel") ?? "").trim(),
    aiSttModel: String(data.get("aiSttModel") ?? "").trim(),
    aiVoice: String(data.get("aiVoice") ?? "").trim(),
    allowExternalAudio: data.get("allowExternalAudio") === "on"
  };
}

function renderHistory() {
  const history = store.getHistory();
  elements.emptyHistory.hidden = history.length > 0;
  elements.history.innerHTML = history.map((entry) => `
    <article class="history-card">
      <div>
        <p class="history-date">${new Date(entry.completedAt).toLocaleString("zh-CN")}</p>
        <h3>${escapeHtml(entry.courseName
          ? [entry.categoryName, entry.subcategoryName, entry.courseName, entry.packTitle, entry.scopeName].filter(Boolean).join(" · ")
          : entry.packTitle)}</h3>
      </div>
      <dl>
        <div><dt>正确</dt><dd>${entry.stats.correct}</dd></div>
        <div><dt>答错</dt><dd>${entry.stats.incorrect}</dd></div>
        <div><dt>使用提示</dt><dd>${entry.stats.assisted ?? 0}</dd></div>
        <div><dt>跟读</dt><dd>${entry.stats.followed}</dd></div>
        <div><dt>未听清</dt><dd>${entry.stats.recognitionFailures}</dd></div>
      </dl>
    </article>`).join("");
}

function masteryOutcome(result) {
  const labels = {
    correct: "最近答对",
    incorrect: "最近答错",
    assisted: "最近使用提示",
    "recognition-failure": "最近未听清"
  };
  if (labels[result?.lastOutcome]) return labels[result.lastOutcome];
  const historicSignals = [result?.correct, result?.incorrect, result?.recognitionFailures, result?.assisted, result?.attempts]
    .some((value) => Number(value ?? 0) > 0);
  return historicSignals ? "已有历史记录" : "尚未练习";
}

function masteryRecommendation(result) {
  const correct = Number(result?.correct ?? 0);
  const incorrect = Number(result?.incorrect ?? 0);
  const failures = Number(result?.recognitionFailures ?? 0);
  const assisted = Number(result?.assisted ?? 0);
  if (!correct && !incorrect && !failures && !assisted) return "尚未练习";
  if (failures > correct + incorrect + assisted) return "优先检查麦克风或改用只听跟读";
  if (assisted > 0 && correct === 0) return "提示后学习，建议安排独立重测";
  if (incorrect >= correct) return "复习释义与发音后继续巩固";
  return "表现较稳定，继续按计划复习";
}

function renderMasteryDetails(pack) {
  const mastery = store.getProgress(pack.id).mastery ?? {};
  const practiced = pack.items.filter((item) => {
    const result = mastery[item.id];
    return Number(result?.attempts ?? 0) + Number(result?.recognitionFailures ?? 0) > 0;
  }).length;
  const totals = Object.values(mastery).reduce((summary, result) => ({
    correct: summary.correct + Number(result.correct ?? 0),
    incorrect: summary.incorrect + Number(result.incorrect ?? 0),
    recognitionFailures: summary.recognitionFailures + Number(result.recognitionFailures ?? 0),
    assisted: summary.assisted + Number(result.assisted ?? 0)
  }), { correct: 0, incorrect: 0, recognitionFailures: 0, assisted: 0 });
  elements.masteryTitle.textContent = `${pack.title} · 逐项学习明细`;
  elements.masterySummary.textContent = `共 ${pack.items.length} 项，已练习 ${practiced} 项；累计答对 ${totals.correct}、答错 ${totals.incorrect}、未听清 ${totals.recognitionFailures}、使用提示 ${totals.assisted}。`;
  const rows = pack.items.map((item) => {
    const result = mastery[item.id] ?? {};
    const lastPracticed = result.lastPracticedAt
      ? new Date(result.lastPracticedAt).toLocaleString("zh-CN")
      : "-";
    return `<tr>
      <td><strong>${escapeHtml(item.word)}</strong><span>${escapeHtml(item.meaning)}</span></td>
      <td>${escapeHtml(item.unit)}</td>
      <td>${Number(result.correct ?? 0)}</td>
      <td>${Number(result.incorrect ?? 0)}</td>
      <td>${Number(result.recognitionFailures ?? 0)}</td>
      <td>${Number(result.assisted ?? 0)}</td>
      <td><strong>${masteryOutcome(result)}</strong><span>${escapeHtml(lastPracticed)}</span></td>
      <td>${escapeHtml(masteryRecommendation(result))}</td>
    </tr>`;
  }).join("");
  elements.masteryContent.innerHTML = `<div class="mastery-table-scroll"><table>
    <thead><tr><th>学习项</th><th>范围</th><th>答对</th><th>答错</th><th>未听清</th><th>提示</th><th>最近结果</th><th>建议</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  if (typeof elements.masteryDialog.showModal === "function") elements.masteryDialog.showModal();
  else elements.masteryDialog.setAttribute("open", "");
}

class FlowInterrupted extends Error {}

class LearningController {
  constructor() {
    this.browserSpeaker = new BrowserSpeaker();
    this.browserRecognizer = new BrowserRecognizer();
    this.speaker = this.browserSpeaker;
    this.recognizer = this.browserRecognizer;
    this.engine = null;
    this.pack = null;
    this.learningItems = [];
    this.unit = "";
    this.category = null;
    this.subcategory = null;
    this.course = null;
    this.settings = null;
    this.running = false;
    this.paused = false;
    this.stopped = false;
    this.forcedCommand = null;
    this.startedAt = null;
    this.wakeLock = null;
    this.activeRunId = 0;
    this.listenOnly = false;
  }

  configureSpeech(settings) {
    this.speaker.cancel();
    this.recognizer.abort();
    const token = elements.aiAccessToken.value;
    this.speaker = settings.playbackMode === "ai-gateway"
      ? new GatewaySpeaker({ endpoint: settings.aiTtsEndpoint, model: settings.aiTtsModel, voice: settings.aiVoice, token })
      : this.browserSpeaker;
    this.recognizer = settings.recognitionMode === "ai-gateway"
      ? new GatewayRecognizer({ endpoint: settings.aiSttEndpoint, model: settings.aiSttModel, token })
      : this.browserRecognizer;
  }

  async start() {
    if (this.running) return;
    const context = currentContext();
    this.pack = context.pack;
    this.category = context.category;
    this.subcategory = context.subcategory;
    this.course = context.course;
    this.unit = learningUnit;
    this.learningItems = itemsForUnit(this.pack, this.unit);
    this.settings = store.getSettings();
    if (!this.pack) {
      setStatus("需要家长先选择学习资料", "打开资料管理，创建课程并导入内容。 ");
      switchView("library");
      return;
    }
    if (!this.learningItems.length) {
      setStatus("当前学习范围没有内容", "请重新选择学习范围，或检查导入资料中的 unit 列。 ");
      return;
    }

    if (this.settings.recognitionMode === "ai-gateway" && !this.settings.allowExternalAudio) {
      setStatus("尚未同意发送作答音频", "请由家长在学习设置中确认 AI 识别的数据边界。 ");
      switchView("settings");
      return;
    }
    try {
      this.configureSpeech(this.settings);
    } catch (error) {
      setStatus("AI 语音配置不完整", error.message);
      switchView("settings");
      return;
    }

    if (!this.speaker.supported) {
      setStatus("当前浏览器不能播放语音", "请使用支持语音播放的最新版浏览器。 ");
      return;
    }

    if (this.settings.recognitionMode === "local-only" && this.recognizer.supported) {
      const locale = this.recognitionLocale(this.learningItems[0]);
      const availability = await this.browserRecognizer.onDeviceAvailability(locale);
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
    elements.studentCategory.disabled = true;
    elements.studentSubcategory.disabled = true;
    elements.studentCourse.disabled = true;
    elements.studentPack.disabled = true;
    elements.studentUnit.disabled = true;
    closeCoursePicker();
    await this.requestWakeLock();

    try {
      await this.say("Sonemory.", { lang: "en-US", rate: 0.92 }, runId);
      await this.say("声声入忆，语音陪学。", { lang: "zh-CN", rate: 1 }, runId);
      const scopeDescription = this.unit ? `，${this.unit}` : "，全部内容";
      await this.say(`本次学习，${this.course?.name ?? "当前课程"}，${this.pack.title}${scopeDescription}。`, { lang: "zh-CN", rate: 1 }, runId);
      if (!this.recognizer.supported) await this.enableListenOnly(runId, "当前语音识别不可用");
      await this.say(`今天学习${this.engine.queue.filter((entry) => entry.kind === "new").length}个单词。学习中可以说，重复，慢一点，拼读，不会，麦克风检测，只听跟读，暂停或结束。`, { lang: "zh-CN", rate: 1 }, runId);
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

  async wait(milliseconds, runId) {
    this.ensureActive(runId);
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    this.ensureActive(runId);
  }

  async microphoneCheck(runId) {
    this.ensureActive(runId);
    setStatus("正在检查麦克风", "只检查设备和权限，不保存录音。", { listening: true });
    const result = await diagnoseMicrophone();
    this.ensureActive(runId);
    setStatus("麦克风自检完成", result.message);
    await this.say(result.speech, { lang: "zh-CN", rate: 1 }, runId);
    return result;
  }

  async enableListenOnly(runId, reason = "连续识别失败") {
    if (this.listenOnly) return;
    this.listenOnly = true;
    setStatus("已切换为只听跟读", `${reason}；本次会继续播放、留出作答时间，但不判断对错。`);
    await this.say(`${reason}。现在临时切换为只听跟读。本次不判断对错，学习进度仍会保存。`, { lang: "zh-CN", rate: 1 }, runId);
    this.saveSession();
  }

  async recognitionRecovery(item, runId) {
    await this.say("连续两次没有听清。现在检查麦克风。", { lang: "zh-CN", rate: 1 }, runId);
    await this.microphoneCheck(runId);
    await this.say("请说，再试一次。或者说，只听跟读。如果仍然听不清，我会自动切换为只听跟读。", { lang: "zh-CN", rate: 0.96 }, runId);
    setStatus("请选择语音恢复方式", "说“再试一次”或“只听跟读”；未识别到指令时会自动降级。", { listening: true });
    const result = await this.listen(item);
    const command = this.commandFrom(result);
    if (command === "retry" || command === "mic-check") {
      if (command === "mic-check") await this.microphoneCheck(runId);
      return { action: "retry" };
    }
    if (command === "listen-only" || !result.transcript) {
      await this.enableListenOnly(runId, command === "listen-only" ? "已收到只听跟读指令" : "恢复指令仍未识别");
      return { action: "listen-only" };
    }
    if (command) return { action: "command", command };
    return { action: "answer", result };
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
    const commands = ["repeat", "slow down", "spell", "meaning", "I don't know", "skip", "try again", "microphone check", "listen only", "pause", "stop"];
    return [...new Set([item.word, ...(item.aliases ?? [])].flatMap(speechForms).concat(commands))];
  }

  prepareEngine() {
    const stored = store.getSession();
    if (stored?.packId === this.pack.id && (stored.unit ?? "") === this.unit && stored.itemIds?.length && !stored.completed) {
      const items = stored.itemIds.map((id) => this.learningItems.find((item) => item.id === id)).filter(Boolean);
      if (items.length) {
        this.engine = new SessionEngine({ items, retryGap: this.settings.retryGap, maxRetries: 1, snapshot: stored.engine });
        this.startedAt = stored.startedAt;
        this.listenOnly = Boolean(stored.listenOnly);
        return;
      }
    }

    const progress = store.getProgress(this.pack.id);
    const count = Math.min(this.settings.dailyCount, this.learningItems.length);
    const items = Array.from({ length: count }, (_, index) => this.learningItems[(progress.nextOffset + index) % this.learningItems.length]);
    this.engine = new SessionEngine({ items, retryGap: this.settings.retryGap, maxRetries: 1 });
    this.startedAt = new Date().toISOString();
    this.listenOnly = false;
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
    if (this.listenOnly) {
      setStatus("只听跟读模式", "请跟读；系统会留出时间，但不判断发音。", { listening: true });
      await this.wait(2200, runId);
      return;
    }
    setStatus("轮到你跟读", "说完后系统会自动继续。", { listening: true });
    let emptyAttempts = 0;
    while (this.running && !this.listenOnly) {
      let result = await this.listen(item);
      let command = this.commandFrom(result);
      if (command) {
        const outcome = await this.handleCommand(command, item, "follow", runId);
        if (outcome === "retry-stage") continue;
        return;
      }
      this.ensureActive(runId);
      if (result.transcript) {
        this.engine.markFollowed({ heard: true });
        setStatus("已经听到你的跟读", `识别结果：${result.transcript}`);
        await this.say("听到了。", { lang: "zh-CN", rate: 1.05 }, runId);
        return;
      }
      emptyAttempts += 1;
      if (emptyAttempts < 2) {
        await this.say("我没有听清，请靠近麦克风再读一次。也可以说，只听跟读。", { lang: "zh-CN" }, runId);
        continue;
      }
      this.engine.markFollowed({ heard: false });
      const recovery = await this.recognitionRecovery(item, runId);
      if (recovery.action === "retry") {
        emptyAttempts = 0;
        continue;
      }
      if (recovery.action === "listen-only") return;
      if (recovery.action === "command") {
        const outcome = await this.handleCommand(recovery.command, item, "follow", runId);
        if (outcome === "retry-stage") {
          emptyAttempts = 0;
          continue;
        }
        return;
      }
      result = recovery.result;
      command = this.commandFrom(result);
      if (!command && result.transcript) {
        this.engine.markFollowed({ heard: true });
        await this.say("听到了。", { lang: "zh-CN", rate: 1.05 }, runId);
        return;
      }
    }
  }

  async listenOnlyRecall(item, isRetry, runId) {
    const prefix = isRetry ? "再来一次。" : "现在请回忆。";
    setStatus("只听跟读模式", `${item.partOfSpeech} · ${item.meaning}；请先自己回答。`, { listening: true });
    await this.say(`${prefix}${item.meaning}，英文怎么说？请先自己回答。`, { lang: "zh-CN", rate: 1 }, runId);
    await this.wait(2800, runId);
    this.engine.completeCurrent({ correct: false, assisted: true });
    await this.say("现在核对答案。", { lang: "zh-CN" }, runId);
    await this.say(this.spokenWord(item), { lang: item.locale, rate: 0.9 }, runId);
    await this.say("请跟读一遍。", { lang: "zh-CN" }, runId);
    await this.say(this.spokenWord(item), { lang: item.locale, rate: 0.88 }, runId);
  }

  async recall(item, isRetry, runId) {
    if (this.listenOnly) return this.listenOnlyRecall(item, isRetry, runId);
    let emptyAttempts = 0;
    while (this.running && !this.paused && !this.stopped) {
      const prefix = isRetry ? "再来一次。" : "现在请回忆。";
      setStatus("请回忆英文单词", `${item.partOfSpeech} · ${item.meaning}`);
      await this.say(`${prefix}${item.meaning}，英文怎么说？`, { lang: "zh-CN", rate: 1 }, runId);
      setStatus("正在听你的回答", "可以说“不知道”“重复”或“拼读”。", { listening: true });
      let result = await this.listen(item);
      let command = this.commandFrom(result);
      if (command) {
        const outcome = await this.handleCommand(command, item, "recall", runId);
        if (outcome === "ask-again") continue;
        return;
      }
      this.ensureActive(runId);

      if (!result.transcript) {
        emptyAttempts += 1;
        if (emptyAttempts < 2) {
          await this.say("我没有听清，请靠近麦克风再说一次。也可以说，只听跟读。", { lang: "zh-CN" }, runId);
          continue;
        }
        this.engine.recordRecognitionFailure();
        const recovery = await this.recognitionRecovery(item, runId);
        if (recovery.action === "retry") {
          emptyAttempts = 0;
          continue;
        }
        if (recovery.action === "listen-only") return this.listenOnlyRecall(item, isRetry, runId);
        if (recovery.action === "command") {
          const outcome = await this.handleCommand(recovery.command, item, "recall", runId);
          if (outcome === "ask-again") {
            emptyAttempts = 0;
            continue;
          }
          return;
        }
        result = recovery.result;
        command = this.commandFrom(result);
        if (command) {
          const outcome = await this.handleCommand(command, item, "recall", runId);
          if (outcome === "ask-again") continue;
          return;
        }
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
    if (command === "retry") return stage === "follow" ? "retry-stage" : "ask-again";
    if (command === "mic-check") {
      await this.microphoneCheck(runId);
      await this.say("自检完成，请再试一次。", { lang: "zh-CN" }, runId);
      return stage === "follow" ? "retry-stage" : "ask-again";
    }
    if (command === "listen-only") {
      await this.enableListenOnly(runId, "已收到只听跟读指令");
      if (stage === "recall") await this.listenOnlyRecall(item, false, runId);
      return "advance";
    }
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
    const processLocally = this.recognizer === this.browserRecognizer
      ? await this.browserRecognizer.shouldProcessLocally(lang, this.settings.recognitionMode)
      : false;
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
    const completedAt = new Date().toISOString();
    setStatus("今天的学习完成了", `答对 ${stats.correct} 次，答错 ${stats.incorrect} 次，使用提示 ${stats.assisted ?? 0} 次。`);
    await this.speaker.speak(`今天的学习完成了。答对${stats.correct}次，答错${stats.incorrect}次，使用提示${stats.assisted ?? 0}次。`, { lang: "zh-CN" });
    store.addHistory({
      categoryId: this.category?.id,
      categoryName: this.category?.name,
      subcategoryId: this.subcategory?.id,
      subcategoryName: this.subcategory?.name,
      courseId: this.course?.id,
      courseName: this.course?.name,
      packId: this.pack.id,
      packTitle: this.pack.title,
      scopeName: this.unit || "全部内容",
      startedAt: this.startedAt,
      completedAt,
      stats,
      itemResults: this.engine.results
    });
    const progress = store.getProgress(this.pack.id);
    const newCount = this.engine.queue.filter((entry) => entry.kind === "new").length;
    const mastery = { ...progress.mastery };
    for (const [itemId, result] of Object.entries(this.engine.results)) {
      mastery[itemId] = mergeMasteryResult(mastery[itemId], result, completedAt);
    }
    store.setProgress(this.pack.id, { nextOffset: (progress.nextOffset + newCount) % this.learningItems.length, mastery });
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
      unit: this.unit,
      itemIds: [...this.engine.items.keys()],
      engine: this.engine.snapshot(),
      startedAt: this.startedAt,
      listenOnly: this.listenOnly,
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

elements.studentCategory.addEventListener("change", () => {
  learningUnit = "";
  const categoryId = elements.studentCategory.value || null;
  const subcategoryId = store.getSubcategories(categoryId)[0]?.id ?? null;
  learningChoice = { categoryId, subcategoryId, courseId: null, packId: null };
  closeCoursePicker();
  renderSelection();
});

elements.studentSubcategory.addEventListener("change", () => {
  learningUnit = "";
  learningChoice = {
    categoryId: elements.studentCategory.value || null,
    subcategoryId: elements.studentSubcategory.value || null,
    courseId: null,
    packId: null
  };
  closeCoursePicker();
  renderSelection();
});

elements.studentCourse.addEventListener("click", () => {
  if (elements.coursePickerPopover.hidden) openCoursePicker();
  else closeCoursePicker();
});

elements.studentPack.addEventListener("change", () => {
  if (!learningChoice.courseId || !elements.studentPack.value) return;
  learningUnit = "";
  learningChoice = store.setSelection({ courseId: learningChoice.courseId, packId: elements.studentPack.value });
  renderSelection();
});

elements.studentUnit.addEventListener("change", () => {
  learningUnit = elements.studentUnit.value;
  store.clearSession();
  renderSelection();
});

elements.courseFilter.addEventListener("input", renderCourseOptions);
elements.courseFilter.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCoursePicker();
    elements.studentCourse.focus();
    return;
  }
  if (event.key !== "Enter") return;
  const firstResult = elements.courseOptions.querySelector("[data-course-option-id]");
  if (!firstResult) return;
  event.preventDefault();
  firstResult.click();
});
elements.courseOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-course-option-id]");
  if (!button) return;
  learningUnit = "";
  learningChoice = store.setSelection({ courseId: button.dataset.courseOptionId });
  closeCoursePicker();
  renderSelection();
  elements.studentCourse.focus();
});
document.addEventListener("click", (event) => {
  if (!elements.coursePickerPopover.hidden && !event.target.closest(".course-picker")) closeCoursePicker();
});

elements.categoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = new FormData(elements.categoryForm);
    const category = store.saveCategory({ id: makeId("category", data.get("name")), name: data.get("name") });
    elements.categoryForm.reset();
    showMessage(elements.categoryMessage, `已添加大类“${category.name}”。`);
    renderLibrary({ keepFilter: false });
    elements.subcategoryCategory.value = category.id;
    elements.courseCategory.value = category.id;
    renderCourseFormSubcategories(category.id);
  } catch (error) {
    showMessage(elements.categoryMessage, error.message, "error");
  }
});

elements.subcategoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = new FormData(elements.subcategoryForm);
    const subcategory = store.saveSubcategory({
      id: makeId("subcategory", data.get("name")),
      categoryId: data.get("categoryId"),
      name: data.get("name")
    });
    elements.subcategoryForm.elements.name.value = "";
    showMessage(elements.subcategoryMessage, `已添加子类“${subcategory.name}”。`);
    renderLibrary({ keepFilter: false });
    elements.subcategoryCategory.value = subcategory.categoryId;
    elements.courseCategory.value = subcategory.categoryId;
    renderCourseFormSubcategories(subcategory.categoryId, subcategory.id);
  } catch (error) {
    showMessage(elements.subcategoryMessage, error.message, "error");
  }
});

elements.courseCategory.addEventListener("change", () => {
  renderCourseFormSubcategories(elements.courseCategory.value);
});

elements.taxonomyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-taxonomy-action]");
  if (!button) return;
  try {
    if (button.dataset.categoryId) {
      const category = store.getCategory(button.dataset.categoryId);
      if (!category) return;
      if (button.dataset.taxonomyAction === "rename-category") {
        const name = prompt("请输入新的大类名称：", category.name)?.trim();
        if (!name || name === category.name) return;
        store.saveCategory({ ...category, name });
      }
      if (button.dataset.taxonomyAction === "delete-category") {
        if (!confirm(`确定删除大类“${category.name}”吗？只能删除不含子类和课程的大类。`)) return;
        store.deleteCategory(category.id);
      }
    }
    if (button.dataset.subcategoryId) {
      const subcategory = store.getSubcategory(button.dataset.subcategoryId);
      if (!subcategory) return;
      if (button.dataset.taxonomyAction === "rename-subcategory") {
        const name = prompt("请输入新的子类名称：", subcategory.name)?.trim();
        if (!name || name === subcategory.name) return;
        store.saveSubcategory({ ...subcategory, name });
      }
      if (button.dataset.taxonomyAction === "delete-subcategory") {
        if (!confirm(`确定删除子类“${subcategory.name}”吗？只能删除不含课程的子类。`)) return;
        store.deleteSubcategory(subcategory.id);
      }
    }
    renderLibrary({ keepFilter: false });
  } catch (error) {
    const target = button.dataset.categoryId ? elements.categoryMessage : elements.subcategoryMessage;
    showMessage(target, error.message, "error");
  }
});

elements.courseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = new FormData(elements.courseForm);
    const existingId = elements.editingCourseId.value;
    const course = store.saveCourse({
      id: existingId || makeId("course", data.get("name")),
      categoryId: data.get("categoryId"),
      subcategoryId: data.get("subcategoryId"),
      name: data.get("name"),
      description: data.get("description")
    });
    store.setSelection({ courseId: course.id });
    renderLibrary({ keepFilter: false });
    resetCourseForm({ categoryId: course.categoryId, subcategoryId: course.subcategoryId });
    resetPackForm(course.id);
    showMessage(elements.courseMessage, `${existingId ? "已更新" : "已创建"}课程“${course.name}”及其归属。`);
  } catch (error) {
    showMessage(elements.courseMessage, error.message, "error");
  }
});

elements.cancelCourseEdit.addEventListener("click", () => resetCourseForm());

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
    if (button.dataset.courseAction === "edit") {
      editCourse(course.id);
      return;
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
    learningUnit = "";
    store.setSelection({ courseId: pack.courseId, packId: pack.id });
    renderLibrary();
    switchView("student");
  }
  if (button.dataset.materialAction === "detail") renderMasteryDetails(pack);
  if (button.dataset.materialAction === "edit") editPack(pack.id);
  if (button.dataset.materialAction === "export") {
    const safeName = pack.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "sonemory-material";
    downloadBlob(new Blob([`\uFEFF${packToCsv(pack)}`], { type: "text/csv;charset=utf-8" }), `${safeName}.csv`);
  }
  if (button.dataset.materialAction === "delete") {
    if (!confirm(`确定删除资料“${pack.title}”及其本地学习进度吗？此操作无法撤销。`)) return;
    store.deletePack(pack.id);
    if (elements.editingPackId.value === pack.id) resetPackForm(pack.courseId);
    renderLibrary();
  }
});

elements.packCategory.addEventListener("change", () => {
  renderPackSubcategories(elements.packCategory.value);
});

elements.packSubcategory.addEventListener("change", () => {
  renderPackCourses(elements.packSubcategory.value);
});

elements.packFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const imported = await importedFileToCsv(file);
    elements.csv.value = imported.csv;
    renderImportPreview(`${imported.format}${imported.sheetName ? ` · ${imported.sheetName}` : ""}`);
    showMessage(elements.importMessage, `已读取 ${file.name}，共 ${imported.rowCount} 条数据；请核对预览后保存。`);
  } catch (error) {
    elements.importPreview.hidden = true;
    showMessage(elements.importMessage, error.message, "error");
  }
});

elements.csv.addEventListener("input", () => { elements.importPreview.hidden = true; });

elements.previewImport.addEventListener("click", () => {
  try {
    renderImportPreview("粘贴或编辑内容");
    showMessage(elements.importMessage, "内容格式校验通过，可以保存资料。 ");
  } catch (error) {
    elements.importPreview.hidden = true;
    showMessage(elements.importMessage, error.message, "error");
  }
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
    let category = store.getCategories().find((candidate) => candidate.name === "演示内容");
    if (!category) category = store.saveCategory({ id: makeId("category", "演示内容"), name: "演示内容" });
    let subcategory = store.getSubcategories(category.id).find((candidate) => candidate.name === "英语演示");
    if (!subcategory) {
      subcategory = store.saveSubcategory({ id: makeId("subcategory", "英语演示"), categoryId: category.id, name: "英语演示" });
    }
    let course = store.getCourses(subcategory.id).find((candidate) => candidate.name === "演示课程");
    if (!course) {
      course = store.saveCourse({
        id: makeId("course", "演示课程"),
        categoryId: category.id,
        subcategoryId: subcategory.id,
        name: "演示课程",
        description: "不对应任何教材"
      });
    }
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
  try {
    store.setSettings(speechSettingsFromForm());
    showMessage(elements.settingsMessage, "学习与语音设置已保存。临时访问令牌不会写入本地存储。 ");
  } catch (error) {
    showMessage(elements.settingsMessage, error.message, "error");
  }
});

elements.settingsForm.elements.playbackMode.addEventListener("change", renderSpeechSettingsVisibility);
elements.settingsForm.elements.recognitionMode.addEventListener("change", renderSpeechSettingsVisibility);

elements.closeMastery.addEventListener("click", () => elements.masteryDialog.close());

elements.testAiSpeech.addEventListener("click", async () => {
  elements.testAiSpeech.disabled = true;
  elements.aiGatewayStatus.textContent = "正在请求并播放测试语音…";
  try {
    const endpoint = validateSpeechEndpoint(elements.settingsForm.elements.aiTtsEndpoint.value);
    if (!endpoint) throw new Error("请先填写语音合成端点。");
    const speaker = new GatewaySpeaker({
      endpoint,
      model: elements.settingsForm.elements.aiTtsModel.value,
      voice: elements.settingsForm.elements.aiVoice.value,
      token: elements.aiAccessToken.value
    });
    await speaker.speak("Sonemory，AI 语音连接测试。", {
      lang: elements.settingsForm.elements.voiceLocale.value,
      rate: 0.95
    });
    elements.aiGatewayStatus.textContent = "AI 发音测试成功。";
  } catch (error) {
    elements.aiGatewayStatus.textContent = error.message || "AI 发音测试失败。";
  } finally {
    elements.testAiSpeech.disabled = false;
  }
});

elements.prepareLocalSpeech.addEventListener("click", async () => {
  const localeField = elements.settingsForm.elements.recognitionLocale.value;
  const locale = localeField === "auto" ? elements.settingsForm.elements.voiceLocale.value : localeField;
  elements.prepareLocalSpeech.disabled = true;
  elements.speechCapability.textContent = `正在检测 ${locale} 设备端语言包…`;
  const availability = await controller.browserRecognizer.onDeviceAvailability(locale, { refresh: true });
  if (availability === "available") {
    elements.speechCapability.textContent = `${locale} 设备端语言包已可用。`;
  } else if (["downloadable", "downloading"].includes(availability)) {
    elements.speechCapability.textContent = `正在安装 ${locale} 设备端语言包…`;
    const installed = await controller.browserRecognizer.installOnDevice(locale);
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

elements.exportBackup.addEventListener("click", () => {
  try {
    const backup = store.createBackup(APP_VERSION);
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), `sonemory-backup-${date}.json`);
    showMessage(elements.backupMessage, "完整本地备份已生成，请妥善保存。 ");
  } catch (error) {
    showMessage(elements.backupMessage, error.message, "error");
  }
});

elements.backupFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  pendingBackup = null;
  elements.restoreBackup.disabled = true;
  elements.backupPreview.hidden = true;
  if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("备份文件不能超过 25 MB。");
    const preview = store.previewBackup(await file.text());
    pendingBackup = preview.backup;
    const { summary, conflicts } = preview;
    elements.backupPreview.innerHTML = `<strong>预检通过</strong>
      <p>导出时间：${escapeHtml(new Date(preview.backup.exportedAt).toLocaleString("zh-CN"))} · 应用版本：${escapeHtml(preview.backup.appVersion ?? "未知")}</p>
      <p>${summary.categories} 个大类 · ${summary.subcategories} 个子类 · ${summary.courses} 门课程 · ${summary.packs} 份资料 · ${summary.items} 个学习项 · ${summary.history} 条记录</p>
      <p>${conflicts.total ? `检测到 ${conflicts.total} 项同 ID 数据；合并时会保留本机版本。` : "未检测到同 ID 冲突。"}</p>`;
    elements.backupPreview.hidden = false;
    elements.restoreBackup.disabled = false;
    showMessage(elements.backupMessage, "备份预检通过，请确认恢复方式。 ");
  } catch (error) {
    showMessage(elements.backupMessage, error.message, "error");
  }
});

elements.restoreBackup.addEventListener("click", async () => {
  if (!pendingBackup) return;
  const mode = elements.restoreMode.value;
  const warning = mode === "replace"
    ? "替换恢复会用备份覆盖当前资料、设置、进度和记录。确定继续吗？"
    : "合并恢复会导入新增数据，同 ID 内容保留本机版本。确定继续吗？";
  if (!confirm(warning)) return;
  try {
    if (controller.running) await controller.stop();
    store.restoreBackup(pendingBackup, { mode });
    learningUnit = "";
    learningChoice = store.getSelection();
    pendingBackup = null;
    elements.backupFile.value = "";
    elements.restoreBackup.disabled = true;
    elements.backupPreview.hidden = true;
    renderSettings();
    resetCourseForm();
    resetPackForm();
    renderLibrary({ keepFilter: false });
    renderHistory();
    showMessage(elements.backupMessage, `恢复完成：${mode === "replace" ? "已替换当前数据" : "已合并新增数据"}。`);
  } catch (error) {
    showMessage(elements.backupMessage, error.message, "error");
  }
});

elements.clearData.addEventListener("click", () => {
  if (!confirm("确定清除当前浏览器中的全部课程、资料、进度和学习记录吗？建议先下载完整备份；清除后无法撤销。")) return;
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
