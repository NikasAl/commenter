/**
 * Commenter — Options Page Logic
 * Полнофункциональная страница управления: генерация, темы, промпт, настройки
 */

import { ZAiProvider } from '../lib/providers/z-ai.js';
import { OpenRouterProvider } from '../lib/providers/openrouter.js';

const Storage = window.Storage;

// ── Состояние ─────────────────────────────
const state = {
  currentTab: 'generate',
  editingTopicId: null,
  editingTheses: [],
  lastUserMessage: '',
};

// ── DOM ────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  tabBtns: $$('.tab-btn'),
  tabPanels: $$('.tab-panel'),
  // Генерация
  topicSelect: $('#topic-select'),
  topicThesisCount: $('#topic-thesis-count'),
  inputText: $('#input-text'),
  btnGenerate: $('#btn-generate'),
  btnCopyPrompt: $('#btn-copy-prompt'),
  resultGroup: $('#result-group'),
  resultText: $('#result-text'),
  btnCopy: $('#btn-copy'),
  btnRegenerate: $('#btn-regenerate'),
  loadingIndicator: $('#loading-indicator'),
  errorBox: $('#error-box'),
  // Темы
  btnAddTopic: $('#btn-add-topic'),
  btnExportTopics: $('#btn-export-topics'),
  btnImportTopics: $('#btn-import-topics'),
  importModal: $('#import-modal'),
  importTextarea: $('#import-textarea'),
  btnDoImport: $('#btn-do-import'),
  importErrorBox: $('#import-error-box'),
  importResultModal: $('#import-result-modal'),
  importResultBody: $('#import-result-body'),
  topicsList: $('#topics-list'),
  topicsEmpty: $('#topics-empty'),
  topicEditorModal: $('#topic-editor-modal'),
  topicEditorTitle: $('#topic-editor-title'),
  topicNameInput: $('#topic-name-input'),
  btnAddThesis: $('#btn-add-thesis'),
  thesesList: $('#theses-list'),
  thesesEmpty: $('#theses-empty'),
  btnSaveTopic: $('#btn-save-topic'),
  // Шаблоны промптов
  templatesList: $('#templates-list'),
  templatesEmpty: $('#templates-empty'),
  btnAddTemplate: $('#btn-add-template'),
  templateEditor: $('#template-editor'),
  templateEditorLabel: $('#template-editor-label'),
  templateNameInput: $('#template-name-input'),
  templateContentInput: $('#template-content-input'),
  btnCloseTemplateEditor: $('#btn-close-template-editor'),
  btnSaveTemplate: $('#btn-save-template'),
  btnResetTemplate: $('#btn-reset-template'),
  promptPreview: $('#prompt-preview'),
  promptSavedToast: $('#prompt-saved-toast'),
  templateSelect: $('#template-select'),
  // Анализ текста
  analyzeTopicSelect: $('#analyze-topic-select'),
  analyzeTextInput: $('#analyze-text-input'),
  btnAnalyze: $('#btn-analyze'),
  analyzeLoading: $('#analyze-loading'),
  analyzeErrorBox: $('#analyze-error-box'),
  analyzeResults: $('#analyze-results'),
  analyzeStats: $('#analyze-stats'),
  analyzeThesesList: $('#analyze-theses-list'),
  btnAnalyzeSelectAll: $('#btn-analyze-select-all'),
  btnAnalyzeDeselectAll: $('#btn-analyze-deselect-all'),
  btnAnalyzeAddSelected: $('#btn-analyze-add-selected'),
  analyzeGrouping: $('#analyze-grouping'),
  analyzeGroupingStats: $('#analyze-grouping-stats'),
  analyzeGroupedList: $('#analyze-grouped-list'),
  btnAnalyzeRegroup: $('#btn-analyze-regroup'),
  btnAnalyzeSaveGrouped: $('#btn-analyze-save-grouped'),
  analyzeSavedToast: $('#analyze-saved-toast'),
  // Настройки
  providerSelect: $('#provider-select'),
  apiKeyInput: $('#api-key-input'),
  modelSelect: $('#model-select'),
  customModelInput: $('#custom-model-input'),
  thesisAutoSelect: $('#thesis-auto-select'),
  btnSaveSettings: $('#btn-save-settings'),
  settingsSavedToast: $('#settings-saved-toast'),
};

// ── Инициализация ─────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  setupGenerateTab();
  setupTopicsTab();
  setupTemplatesTab();
  setupAnalyzeTab();
  setupSettingsTab();
  await refreshTopics();
  await refreshTemplateSelect();
  await refreshTemplates();
  await loadSettings();
}

// ═══════════════════════════════════════════
//  ТАБЫ
// ═══════════════════════════════════════════

function setupTabs() {
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  state.currentTab = tab;
  DOM.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  DOM.tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'topics') refreshTopics();
  if (tab === 'prompt') refreshTemplates();
  if (tab === 'analyze') refreshAnalyzeTopicSelect();
}

// ═══════════════════════════════════════════
//  ТАБ «ГЕНЕРАЦИЯ»
// ═══════════════════════════════════════════

function setupGenerateTab() {
  DOM.btnGenerate.addEventListener('click', handleGenerate);
  DOM.btnCopyPrompt.addEventListener('click', handleCopyPrompt);
  DOM.btnCopy.addEventListener('click', handleCopy);
  DOM.btnRegenerate.addEventListener('click', handleRegenerate);
  DOM.topicSelect.addEventListener('change', async () => {
    const topicId = DOM.topicSelect.value;
    if (topicId) {
      const topic = await Storage.getTopicById(topicId);
      DOM.topicThesisCount.textContent = `${topic ? topic.theses.length : 0} тезисов в теме`;
    } else {
      DOM.topicThesisCount.textContent = '';
    }
  });
}

async function refreshTopicSelect() {
  const topics = await Storage.getTopics();
  const currentVal = DOM.topicSelect.value;
  DOM.topicSelect.innerHTML = '<option value="">— Выберите тему —</option>';
  topics.forEach(topic => {
    const opt = document.createElement('option');
    opt.value = topic.id;
    opt.textContent = `${topic.name} (${topic.theses.length} тез.)`;
    DOM.topicSelect.appendChild(opt);
  });
  if (currentVal && topics.find(t => t.id === currentVal)) {
    DOM.topicSelect.value = currentVal;
  }
}

async function handleGenerate() {
  const templateId = DOM.templateSelect.value;
  const topicId = DOM.topicSelect.value;
  const userMessage = DOM.inputText.value.trim();
  if (!topicId) { showError('Выберите тему для генерации ответа.'); return; }
  if (!userMessage) { showError('Вставьте текст комментария или поста для ответа.'); return; }
  state.lastUserMessage = userMessage;

  const topic = await Storage.getTopicById(topicId);
  if (!topic) { showError('Тема не найдена.'); return; }

  const settings = await Storage.getSettings();
  if (!settings.apiKey) { showError('API ключ не настроен. Перейдите в «Настройки».'); return; }

  const model = settings.customModelInput || settings.model || getDefaultModel(settings.provider);

  // Получить шаблон промпта
  let promptTemplate;
  if (templateId) {
    const templates = await Storage.getTemplates();
    const tpl = templates.find(t => t.id === templateId);
    promptTemplate = tpl ? tpl.content : (await Storage.getActiveTemplate())?.content;
  } else {
    const activeTpl = await Storage.getActiveTemplate();
    promptTemplate = activeTpl ? activeTpl.content : '';
  }
  if (!promptTemplate) { showError('Шаблон промпта не найден.'); return; }

  const systemPrompt = buildSystemPrompt(promptTemplate, topic.name, topic.theses);

  showLoading(true);
  hideError();
  DOM.resultGroup.style.display = 'none';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHAT_REQUEST',
      payload: { provider: settings.provider, apiKey: settings.apiKey, model, systemPrompt, userMessage },
    });
    if (!response.success) { showError(response.error); return; }
    DOM.resultText.textContent = response.data;
    DOM.resultGroup.style.display = 'block';
  } catch (err) {
    showError(`Ошибка: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

/**
 * Собрать финальный промпт из шаблона + данные темы
 */
function buildSystemPrompt(template, topicName, theses) {
  // Формируем блок тезисов
  let thesesText = '';
  theses.forEach((t, i) => {
    thesesText += `\n[Тезис ${i + 1}]\nВопрос: ${t.question}\nОтвет: ${t.answer}\n`;
  });

  return template
    .replace(/\{\{topic\}\}/g, topicName)
    .replace(/\{\{theses\}\}/g, thesesText.trim());
}

async function handleRegenerate() {
  if (state.lastUserMessage) await handleGenerate();
}

/**
 * Копирует полностью сформированный промпт (системный + пользовательский)
 * для вставки в сторонний чат (ChatGPT, Claude и т.д.)
 */
async function handleCopyPrompt() {
  const templateId = DOM.templateSelect.value;
  const topicId = DOM.topicSelect.value;
  const userMessage = DOM.inputText.value.trim();
  if (!topicId) { showError('Выберите тему.'); return; }
  if (!userMessage) { showError('Вставьте текст для ответа.'); return; }

  const topic = await Storage.getTopicById(topicId);
  if (!topic) { showError('Тема не найдена.'); return; }

  let promptTemplate;
  if (templateId) {
    const templates = await Storage.getTemplates();
    const tpl = templates.find(t => t.id === templateId);
    promptTemplate = tpl ? tpl.content : (await Storage.getActiveTemplate())?.content;
  } else {
    const activeTpl = await Storage.getActiveTemplate();
    promptTemplate = activeTpl ? activeTpl.content : '';
  }
  if (!promptTemplate) { showError('Шаблон промпта не найден.'); return; }

  const systemPrompt = buildSystemPrompt(promptTemplate, topic.name, topic.theses);

  // Формируем полный текст для копирования: системный промпт + сообщение пользователя
  const fullPrompt = `[Системный промпт]\n${systemPrompt}\n\n[Сообщение пользователя]\n${userMessage}`;

  try {
    await navigator.clipboard.writeText(fullPrompt);
    const btn = DOM.btnCopyPrompt;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Скопировано!`;
    btn.classList.add('btn-copied');
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.classList.remove('btn-copied');
    }, 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = fullPrompt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

async function handleCopy() {
  const text = DOM.resultText.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    DOM.btnCopy.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Скопировано!`;
    setTimeout(() => {
      DOM.btnCopy.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Копировать`;
    }, 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// ═══════════════════════════════════════════
//  ТАБ «ТЕМЫ»
// ═══════════════════════════════════════════

function setupTopicsTab() {
  DOM.btnAddTopic.addEventListener('click', () => openTopicEditor(null));
  DOM.btnAddThesis.addEventListener('click', () => addThesisRow());
  DOM.btnSaveTopic.addEventListener('click', saveTopic);

  // Экспорт
  DOM.btnExportTopics.addEventListener('click', handleExport);

  // Импорт
  DOM.btnImportTopics.addEventListener('click', () => {
    DOM.importTextarea.value = '';
    DOM.importErrorBox.style.display = 'none';
    DOM.importModal.style.display = 'flex';
    DOM.importTextarea.focus();
  });
  DOM.btnDoImport.addEventListener('click', handleImportText);

  // Закрытие модалок
  $$('.modal-overlay, [data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeAllModals());
  });
}

async function refreshTopics() {
  const topics = await Storage.getTopics();
  DOM.topicsList.innerHTML = '';
  DOM.topicsEmpty.style.display = topics.length ? 'none' : 'flex';

  topics.forEach(topic => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.innerHTML = `
      <div class="topic-info">
        <div class="topic-name">${escapeHtml(topic.name)}</div>
        <div class="topic-meta">${topic.theses.length} тезисов</div>
      </div>
      <div class="topic-actions">
        <button class="btn-icon topic-edit-btn" title="Редактировать">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger topic-delete-btn" title="Удалить">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    card.querySelector('.topic-edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openTopicEditor(topic.id); });
    card.querySelector('.topic-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Удалить тему "${topic.name}" и все её тезисы?`)) {
        await Storage.deleteTopic(topic.id);
        await refreshTopics();
        await refreshTopicSelect();
      }
    });
    DOM.topicsList.appendChild(card);
  });
  await refreshTopicSelect();
}

// ── Редактор темы (из popup.js) ────────────

async function openTopicEditor(topicId) {
  state.editingTopicId = topicId;
  if (topicId) {
    const topic = await Storage.getTopicById(topicId);
    if (!topic) return;
    DOM.topicEditorTitle.textContent = 'Редактирование темы';
    DOM.topicNameInput.value = topic.name;
    state.editingTheses = JSON.parse(JSON.stringify(topic.theses));
  } else {
    DOM.topicEditorTitle.textContent = 'Новая тема';
    DOM.topicNameInput.value = '';
    state.editingTheses = [];
  }
  renderThesesEditor();
  DOM.topicEditorModal.style.display = 'flex';
  DOM.topicNameInput.focus();
}

function renderThesesEditor() {
  DOM.thesesList.innerHTML = '';
  DOM.thesesEmpty.style.display = state.editingTheses.length ? 'none' : 'block';
  state.editingTheses.forEach((thesis, index) => {
    const card = document.createElement('div');
    card.className = 'thesis-card';
    card.innerHTML = `
      <div class="thesis-card-header">
        <span class="thesis-label">Тезис ${index + 1}</span>
        <div class="thesis-actions">
          <button class="btn-icon thesis-edit-btn" title="Редактировать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger thesis-delete-btn" title="Удалить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="thesis-question"><strong>В:</strong> ${escapeHtml(thesis.question)}</div>
      <div class="thesis-answer"><strong>О:</strong> ${escapeHtml(thesis.answer)}</div>
    `;
    card.querySelector('.thesis-edit-btn').addEventListener('click', () => renderThesisEditForm(card, index));
    card.querySelector('.thesis-delete-btn').addEventListener('click', () => { state.editingTheses.splice(index, 1); renderThesesEditor(); });
    DOM.thesesList.appendChild(card);
  });
}

function renderThesisEditForm(cardEl, index) {
  const thesis = state.editingTheses[index];
  cardEl.innerHTML = `
    <div class="thesis-input-group"><label>Вопрос</label><textarea class="thesis-question-input" rows="2">${escapeHtml(thesis.question)}</textarea></div>
    <div class="thesis-input-group"><label>Ответ</label><textarea class="thesis-answer-input" rows="3">${escapeHtml(thesis.answer)}</textarea></div>
    <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm thesis-cancel-btn">Отмена</button>
      <button class="btn btn-primary btn-sm thesis-save-btn">Сохранить</button>
    </div>
  `;
  cardEl.querySelector('.thesis-cancel-btn').addEventListener('click', () => renderThesesEditor());
  cardEl.querySelector('.thesis-save-btn').addEventListener('click', () => {
    const q = cardEl.querySelector('.thesis-question-input').value.trim();
    const a = cardEl.querySelector('.thesis-answer-input').value.trim();
    if (q && a) { state.editingTheses[index] = { ...thesis, question: q, answer: a }; renderThesesEditor(); }
  });
}

function addThesisRow() {
  const newThesis = { id: Storage._generateId(), question: '', answer: '', createdAt: Date.now() };
  state.editingTheses.push(newThesis);
  renderThesesEditor();
  const lastCard = DOM.thesesList.lastElementChild;
  if (lastCard) { renderThesisEditForm(lastCard, state.editingTheses.length - 1); lastCard.querySelector('.thesis-question-input').focus(); }
}

async function saveTopic() {
  const name = DOM.topicNameInput.value.trim();
  if (!name) { alert('Введите название темы.'); return; }
  if (state.editingTopicId) {
    await Storage.updateTopic(state.editingTopicId, name);
    const existingTopic = await Storage.getTopicById(state.editingTopicId);
    if (existingTopic) {
      for (const oldThesis of existingTopic.theses) await Storage.deleteThesis(state.editingTopicId, oldThesis.id);
      for (const thesis of state.editingTheses) {
        if (thesis.question.trim() && thesis.answer.trim()) await Storage.addThesis(state.editingTopicId, thesis.question, thesis.answer);
      }
    }
  } else {
    const topic = await Storage.addTopic(name);
    for (const thesis of state.editingTheses) {
      if (thesis.question.trim() && thesis.answer.trim()) await Storage.addThesis(topic.id, thesis.question, thesis.answer);
    }
  }
  closeAllModals();
  await refreshTopics();
}

// ── Экспорт ────────────────────────────────

async function handleExport() {
  const topics = await Storage.getTopics();
  if (topics.length === 0) { showError('Нет тем для экспорта.'); return; }

  let text = '---\n';
  for (const topic of topics) {
    text += `T:${topic.name}\n\n`;
    for (const thesis of topic.theses) {
      text += `Q:${thesis.question}\n`;
      text += `A:${thesis.answer}\n\n`;
    }
  }

  // Создать Blob и скачать
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commenter-export-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showImportToast(`Экспортировано: ${topics.length} тем`);
}

// ── Импорт с дедупликацией ─────────────────

function parseTopicsFile(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const topics = [];
  let currentTopic = null;
  let currentThesis = null;
  let currentField = null;
  const lines = text.split('\n');

  for (const rawLine of lines) {
    if (rawLine.startsWith('T:')) {
      if (currentThesis && currentTopic) finalizeThesis(currentTopic, currentThesis);
      currentTopic = { name: rawLine.slice(2).trim(), theses: [] };
      currentThesis = null; currentField = null;
      topics.push(currentTopic); continue;
    }
    if (rawLine.startsWith('Q:')) {
      if (currentThesis && currentTopic) finalizeThesis(currentTopic, currentThesis);
      currentThesis = { question: rawLine.slice(2).trim(), answer: '' };
      currentField = 'question'; continue;
    }
    if (rawLine.startsWith('A:')) {
      currentField = 'answer';
      if (currentThesis) currentThesis.answer = rawLine.slice(2).trim();
      continue;
    }
    if (rawLine.trim() === '' || rawLine.startsWith('---')) {
      if (currentField && currentThesis) {
        if (currentField === 'question') currentThesis.question += '\n';
        else if (currentField === 'answer') currentThesis.answer += '\n';
      }
      continue;
    }
    if (currentField === 'question' && currentThesis) currentThesis.question += (currentThesis.question ? '\n' : '') + rawLine;
    else if (currentField === 'answer' && currentThesis) currentThesis.answer += (currentThesis.answer ? '\n' : '') + rawLine;
  }
  if (currentThesis && currentTopic) finalizeThesis(currentTopic, currentThesis);
  return topics.filter(t => t.name && t.theses.length > 0);
}

function finalizeThesis(topic, thesis) {
  thesis.question = thesis.question.trim();
  thesis.answer = thesis.answer.trim();
  if (thesis.question && thesis.answer) topic.theses.push({ question: thesis.question, answer: thesis.answer });
}

/**
 * Нормализация текста для сравнения (для дедупликации)
 */
function normalize(str) {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function handleImportText() {
  const text = DOM.importTextarea.value.trim();
  if (!text) { DOM.importErrorBox.textContent = 'Вставьте текст для импорта.'; DOM.importErrorBox.style.display = 'block'; return; }

  const parsedTopics = parseTopicsFile(text);
  if (parsedTopics.length === 0) { DOM.importErrorBox.textContent = 'Не найдено тем в тексте. Проверьте формат: T:, Q:, A:'; DOM.importErrorBox.style.display = 'block'; return; }

  // Получить существующие данные для дедупликации
  const existingTopics = await Storage.getTopics();
  const existingMap = new Map(); // topicName -> Set of normalized questions
  for (const t of existingTopics) {
    existingMap.set(t.name, new Set(t.theses.map(th => normalize(th.question))));
  }

  let stats = { topicsCreated: 0, topicsExisted: 0, thesesAdded: 0, thesesSkipped: 0, details: [] };

  for (const topicData of parsedTopics) {
    const existing = existingTopics.find(t => t.name === topicData.name);
    let topicId;

    if (existing) {
      topicId = existing.id;
      stats.topicsExisted++;
    } else {
      const topic = await Storage.addTopic(topicData.name);
      topicId = topic.id;
      stats.topicsCreated++;
      existingMap.set(topicData.name, new Set());
      // Добавить в кэш для дедупликации внутри этого импорта
      const newEntry = existingTopics.find(t => t.id === topicId) || { name: topicData.name, theses: [] };
      existingTopics.push({ id: topicId, name: topicData.name, theses: [] });
    }

    const existingQuestions = existingMap.get(topicData.name);

    for (const thesis of topicData.theses) {
      const normQ = normalize(thesis.question);
      if (existingQuestions.has(normQ)) {
        stats.thesesSkipped++;
        stats.details.push({ topic: topicData.name, question: thesis.question.slice(0, 60), status: 'dup' });
      } else {
        await Storage.addThesis(topicId, thesis.question, thesis.answer);
        stats.thesesAdded++;
        existingQuestions.add(normQ);
        stats.details.push({ topic: topicData.name, question: thesis.question.slice(0, 60), status: 'new' });
      }
    }
  }

  // Закрыть модалку импорта
  DOM.importModal.style.display = 'none';
  await refreshTopics();

  // Показать результаты
  showImportResult(stats);
}

function showImportResult(stats) {
  const hasSkipped = stats.thesesSkipped > 0;

  let html = `<div class="import-stat">
    <div class="import-stat-item">
      <span class="import-stat-value created">${stats.topicsCreated}</span>
      <span class="import-stat-label">новых тем</span>
    </div>
    <div class="import-stat-item">
      <span class="import-stat-value existed">${stats.topicsExisted}</span>
      <span class="import-stat-label">существующих</span>
    </div>
    <div class="import-stat-item">
      <span class="import-stat-value created">${stats.thesesAdded}</span>
      <span class="import-stat-label">тезисов добавлено</span>
    </div>`;

  if (hasSkipped) {
    html += `<div class="import-stat-item">
      <span class="import-stat-value skipped">${stats.thesesSkipped}</span>
      <span class="import-stat-label">дубликатов пропущено</span>
    </div>`;
  }

  html += '</div>';

  if (stats.details.length > 0 && stats.details.length <= 50) {
    html += '<div class="import-detail">';
    for (const d of stats.details) {
      const badge = d.status === 'new' ? '<span class="badge badge-new">новый</span>' : '<span class="badge badge-dup">дубликат</span>';
      html += `<div class="import-detail-item">${badge}${escapeHtml(d.topic)}: ${escapeHtml(d.question)}...</div>`;
    }
    html += '</div>';
  }

  DOM.importResultBody.innerHTML = html;
  DOM.importResultModal.style.display = 'flex';
}

// ═══════════════════════════════════════════
//  ТАБ «ПРОМПТ» — Шаблоны
// ═══════════════════════════════════════════

let editingTemplateId = null;

function setupTemplatesTab() {
  DOM.btnAddTemplate.addEventListener('click', () => openTemplateEditor(null));
  DOM.btnCloseTemplateEditor.addEventListener('click', closeTemplateEditor);
  DOM.btnSaveTemplate.addEventListener('click', saveTemplate);
  DOM.btnResetTemplate.addEventListener('click', resetTemplateToDefault);
  DOM.templateContentInput?.addEventListener('input', updatePromptPreview);
}

async function refreshTemplateSelect() {
  const templates = await Storage.getTemplates();
  const activeTpl = templates.find(t => t.isActive) || templates[0];
  const currentVal = DOM.templateSelect?.value;

  if (DOM.templateSelect) {
    DOM.templateSelect.innerHTML = '';
    templates.forEach(tpl => {
      const opt = document.createElement('option');
      opt.value = tpl.id;
      opt.textContent = `${tpl.isActive ? '● ' : ''}${tpl.name}`;
      DOM.templateSelect.appendChild(opt);
    });
    if (currentVal && templates.find(t => t.id === currentVal)) {
      DOM.templateSelect.value = currentVal;
    } else if (activeTpl) {
      DOM.templateSelect.value = activeTpl.id;
    }
  }
}

async function refreshTemplates() {
  const templates = await Storage.getTemplates();
  DOM.templatesList.innerHTML = '';
  DOM.templatesEmpty.style.display = templates.length ? 'none' : 'flex';

  templates.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'template-card' + (tpl.isActive ? ' is-active' : '');
    const preview = tpl.content.slice(0, 120).replace(/\n/g, ' ').trim() + (tpl.content.length > 120 ? '...' : '');
    card.innerHTML = `
      <div class="template-info">
        <div class="template-name">${escapeHtml(tpl.name)}</div>
        <div class="template-meta">
          ${tpl.isActive ? '<span class="template-active-badge">Активный</span>' : ''}
          <span>${tpl.content.length} симв.</span>
        </div>
      </div>
      <div class="template-actions">
        ${!tpl.isActive ? `<button class="btn-icon template-activate-btn" title="Сделать активным"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>` : ''}
        <button class="btn-icon template-edit-btn" title="Редактировать">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger template-delete-btn" title="Удалить">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;

    card.querySelector('.template-activate-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await Storage.setActiveTemplate(tpl.id);
      await refreshTemplates();
      await refreshTemplateSelect();
    });
    card.querySelector('.template-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openTemplateEditor(tpl.id);
    });
    card.querySelector('.template-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Удалить шаблон "${tpl.name}"?`)) {
        await Storage.deleteTemplate(tpl.id);
        await refreshTemplates();
        await refreshTemplateSelect();
      }
    });

    DOM.templatesList.appendChild(card);
  });
}

function openTemplateEditor(templateId) {
  editingTemplateId = templateId;
  DOM.templateEditor.style.display = 'block';
  DOM.templatesList.style.display = 'none';
  DOM.templatesEmpty.style.display = 'none';
  DOM.btnAddTemplate.style.display = 'none';

  if (templateId) {
    DOM.templateEditorLabel.textContent = 'Редактирование шаблона';
    // Найти шаблон в DOM-списке
    Storage.getTemplates().then(templates => {
      const tpl = templates.find(t => t.id === templateId);
      if (tpl) {
        DOM.templateNameInput.value = tpl.name;
        DOM.templateContentInput.value = tpl.content;
        updatePromptPreview();
      }
    });
  } else {
    DOM.templateEditorLabel.textContent = 'Новый шаблон';
    DOM.templateNameInput.value = '';
    DOM.templateContentInput.value = `Ты — эксперт по теме "{{topic}}". Используй приведённые ниже тезисы для формирования ответа.

=== ТЕЗИСЫ ===
{{theses}}
=== КОНЕЦ ТЕЗИСОВ ===

Формулируй ответ на русском языке.`;
    updatePromptPreview();
  }
  DOM.templateNameInput.focus();
}

function closeTemplateEditor() {
  DOM.templateEditor.style.display = 'none';
  DOM.templatesList.style.display = '';
  DOM.btnAddTemplate.style.display = '';
  editingTemplateId = null;
}

async function saveTemplate() {
  const name = DOM.templateNameInput.value.trim();
  const content = DOM.templateContentInput.value;
  if (!name) { alert('Введите название шаблона.'); return; }

  if (editingTemplateId) {
    await Storage.updateTemplate(editingTemplateId, name, content);
  } else {
    const newTpl = await Storage.addTemplate(name, content);
    // Если это первый шаблон — сделать активным
    const templates = await Storage.getTemplates();
    if (templates.length === 1) {
      await Storage.setActiveTemplate(newTpl.id);
    }
  }

  closeTemplateEditor();
  await refreshTemplates();
  await refreshTemplateSelect();
  DOM.promptSavedToast.style.display = 'block';
  setTimeout(() => { DOM.promptSavedToast.style.display = 'none'; }, 2000);
}

async function resetTemplateToDefault() {
  const defaultContent = Storage.DEFAULT_TEMPLATES[0].content;
  DOM.templateContentInput.value = defaultContent;
  if (!DOM.templateNameInput.value.trim()) {
    DOM.templateNameInput.value = Storage.DEFAULT_TEMPLATES[0].name;
  }
  updatePromptPreview();
}

function updatePromptPreview() {
  const template = DOM.templateContentInput?.value || '';
  const preview = buildSystemPrompt(template, 'Моя тема', [
    { question: 'Типичный вопрос оппонента', answer: 'Мой аргументированный ответ' },
    { question: 'Другой вопрос', answer: 'Другой ответ' },
  ]);
  if (DOM.promptPreview) {
    DOM.promptPreview.textContent = preview;
  }
}

// ═══════════════════════════════════════════
//  ТАБ «АНАЛИЗ ТЕКСТА»
// ═══════════════════════════════════════════

const analyzeState = {
  extractedTheses: [],        // [{id, question, answer, selected}] — режим с темой
  groupedTopics: [],          // [{topicName, matchedTopicId, isNew, theses: [{id, question, answer, selected}]}] — режим авто
  lastAnalyzedText: '',       // сохраняем текст для перегруппировки
};

// ── Промпты для LLM ──────────────────────────

const ANALYZE_SYSTEM_PROMPT = `Ты — аналитик текста. Твоя задача — проанализировать текст и выделить из него ключевые тезисы в формате «вопрос — ответ».

Для каждого тезиса:
- Вопрос — типичный вопрос, утверждение или критика оппонента по теме текста
- Ответ — аргументированный, чёткий и лаконичный ответ, основанный на информации из текста

Формат вывода — СТРОГО JSON-массив объектов:
[
  {"q": "текст вопроса", "a": "текст ответа"},
  ...
]

Правила:
- Выдели от 3 до 15 наиболее важных тезисов
- Каждый тезис должен содержать самостоятельную мысль
- Вопросы формулируй так, как их мог бы задать критик или оппонент
- Ответы должны быть аргументированными и опираться на факты из текста
- НЕ добавляй пояснения до или после JSON
- Если текст слишком короткий или бессмысленный — верни пустой массив []
- Формулируй на русском языке`;

const ANALYZE_AUTO_SYSTEM_PROMPT = `Ты — аналитик текста. Твоя задача — проанализировать текст, определить затрагиваемые темы и выделить из него ключевые тезисы в формате «вопрос — ответ» для каждой темы.

Для каждого тезиса:
- topic — краткое название темы (1-3 слова, например «Экономика», «Политика», «Технологии»)
- Вопрос — типичный вопрос, утверждение или критика оппонента по данной теме
- Ответ — аргументированный, чёткий и лаконичный ответ, основанный на информации из текста

Формат вывода — СТРОГО JSON-массив объектов:
[
  {"topic": "Название темы", "q": "текст вопроса", "a": "текст ответа"},
  ...
]

Правила:
- Определи все темы, которые затрагиваются в тексте
- Выдели от 3 до 15 наиболее важных тезисов по всем темам вместе
- Каждому тезису обязательно укажи тему
- Вопросы формулируй так, как их мог бы задать критик или оппонент
- Ответы должны быть аргументированными и опираться на факты из текста
- НЕ добавляй пояснения до или после JSON
- Если текст слишком короткий или бессмысленный — верни пустой массив []
- Формулируй на русском языке`;

const GROUP_SYSTEM_PROMPT = `Ты — помощник по классификации тем. Тебе дан список тем, извлечённых из текста, и список уже существующих тем в базе пользователя.

Твоя задача — для каждой извлечённой темы:
1. Найти наиболее подходящую существующую тему (по смыслу, даже если названия немного отличаются)
2. Если подходящей существующей темы нет — пометить как новую

Формат вывода — СТРОГО JSON-массив объектов:
[
  {"extracted": "Название извлечённой темы", "match": "id_существующей_темы" или null, "reason": "краткое обоснование"},
  ...
]

Правила:
- match должен быть равен id существующей темы из списка, если найдено совпадение
- Если совпадения нет — match: null
- Учитывай синонимы и близкие по смыслу темы
- НЕ добавляй пояснения до или после JSON
- Формулируй на русском языке`;

// ── Инициализация ────────────────────────────

function setupAnalyzeTab() {
  DOM.btnAnalyze.addEventListener('click', handleAnalyze);
  DOM.btnAnalyzeSelectAll.addEventListener('click', () => setAllAnalyzeTheses(true));
  DOM.btnAnalyzeDeselectAll.addEventListener('click', () => setAllAnalyzeTheses(false));
  DOM.btnAnalyzeAddSelected.addEventListener('click', handleAddAnalyzedTheses);

  // Кнопки для режима авто
  const btnRegroup = document.getElementById('btn-analyze-regroup');
  const btnSaveGrouped = document.getElementById('btn-analyze-save-grouped');
  if (btnRegroup) btnRegroup.addEventListener('click', handleRegroup);
  if (btnSaveGrouped) btnSaveGrouped.addEventListener('click', handleSaveGrouped);

  // Смена подсказки при выборе темы
  DOM.analyzeTopicSelect.addEventListener('change', updateAnalyzeTopicHint);
}

function updateAnalyzeTopicHint() {
  const hint = document.getElementById('analyze-topic-hint');
  const val = DOM.analyzeTopicSelect.value;
  if (val === '__auto__' || val === '') {
    hint.textContent = 'Режим «Авто»: LLM определит темы в тексте, сгруппирует тезисы по темам и попытается привязать к существующим. Требуется дополнительный API-запрос для группировки.';
  } else {
    hint.textContent = 'Тезисы будут сохранены в выбранную тему. Если темы нет — создайте новую в разделе «Темы».';
  }
}

async function refreshAnalyzeTopicSelect() {
  const topics = await Storage.getTopics();
  const currentVal = DOM.analyzeTopicSelect.value;
  DOM.analyzeTopicSelect.innerHTML = '<option value="__auto__">Авто — определить темы из текста</option>';
  DOM.analyzeTopicSelect.innerHTML += '<option value="" disabled>─────────────────────</option>';
  topics.forEach(topic => {
    const opt = document.createElement('option');
    opt.value = topic.id;
    opt.textContent = `${topic.name} (${topic.theses.length} тез.)`;
    DOM.analyzeTopicSelect.appendChild(opt);
  });
  if (currentVal === '__auto__' || !currentVal) {
    DOM.analyzeTopicSelect.value = '__auto__';
  } else if (topics.find(t => t.id === currentVal)) {
    DOM.analyzeTopicSelect.value = currentVal;
  }
  updateAnalyzeTopicHint();
}

// ── Основной обработчик анализа ──────────────

async function handleAnalyze() {
  const text = DOM.analyzeTextInput.value.trim();
  const topicVal = DOM.analyzeTopicSelect.value;

  if (!text) {
    showAnalyzeError('Вставьте текст для анализа.');
    return;
  }

  const settings = await Storage.getSettings();
  if (!settings.apiKey) {
    showAnalyzeError('API ключ не настроен. Перейдите в «Настройки».');
    return;
  }

  const model = settings.customModelInput || settings.model || getDefaultModel(settings.provider);
  const isAuto = (topicVal === '__auto__' || topicVal === '');

  analyzeState.lastAnalyzedText = text;
  showAnalyzeLoading(true, 'Анализирую текст, выделяю тезисы...');
  hideAnalyzeError();
  DOM.analyzeResults.style.display = 'none';
  DOM.analyzeGrouping.style.display = 'none';

  try {
    const systemPrompt = isAuto ? ANALYZE_AUTO_SYSTEM_PROMPT : ANALYZE_SYSTEM_PROMPT;
    const response = await sendChatRequest(settings, model, systemPrompt, text);
    if (!response) return;

    if (isAuto) {
      // Режим авто: парсим тезисы с темами
      const theses = parseAutoAnalyzeResponse(response);
      if (theses.length === 0) {
        showAnalyzeError('Не удалось выделить тезисы из текста. Попробуйте более развёрнутый текст.');
        return;
      }
      // Группируем по темам
      analyzeState.groupedTopics = groupThesesByTopic(theses);
      // Запускаем шаг группировки (привязка к существующим)
      await runGroupingStep(settings, model);
    } else {
      // Режим с выбранной темой
      const theses = parseAnalyzeResponse(response);
      analyzeState.extractedTheses = theses;
      if (theses.length === 0) {
        showAnalyzeError('Не удалось выделить тезисы из текста. Попробуйте более развёрнутый текст.');
        return;
      }
      renderAnalyzeResults(theses);
      DOM.analyzeResults.style.display = 'block';
    }
  } catch (err) {
    showAnalyzeError(`Ошибка: ${err.message}`);
  } finally {
    showAnalyzeLoading(false);
  }
}

// ── Шаг группировки (режим Авто) ─────────────

async function runGroupingStep(settings, model) {
  showAnalyzeLoading(true, 'Группирую темы, привязываю к существующим...');

  try {
    const existingTopics = await Storage.getTopics();

    // Если существующих тем нет — все новые
    if (existingTopics.length === 0) {
      analyzeState.groupedTopics.forEach(g => {
        g.matchedTopicId = null;
        g.isNew = true;
      });
      analyzeState._existingTopicsForSelect = [];
      renderGroupedResults();
      DOM.analyzeGrouping.style.display = 'block';
      return;
    }

    // Формируем список тем для LLM
    const extractedNames = [...new Set(analyzeState.groupedTopics.map(g => g.topicName))];
    const existingList = existingTopics.map(t => `id: ${t.id}, название: "${t.name}"`).join('\n');

    const userMessage = `Извлечённые темы из текста:\n${extractedNames.map(n => `- "${n}"`).join('\n')}\n\nСуществующие темы в базе:\n${existingList}`;

    const response = await sendChatRequest(settings, model, GROUP_SYSTEM_PROMPT, userMessage);
    if (!response) {
      // Если ошибка — оставляем как есть, все новые
      analyzeState.groupedTopics.forEach(g => { g.matchedTopicId = null; g.isNew = true; });
      analyzeState._existingTopicsForSelect = existingTopics;
      renderGroupedResults();
      DOM.analyzeGrouping.style.display = 'block';
      return;
    }

    // Парсим маппинг
    const mapping = parseGroupingResponse(response);
    applyGroupingMapping(mapping, existingTopics);
    analyzeState._existingTopicsForSelect = existingTopics;
    renderGroupedResults();
    DOM.analyzeGrouping.style.display = 'block';
  } catch (err) {
    console.warn('[Commenter] Grouping error:', err);
    analyzeState.groupedTopics.forEach(g => { g.matchedTopicId = null; g.isNew = true; });
    const existingTopics = await Storage.getTopics();
    analyzeState._existingTopicsForSelect = existingTopics;
    renderGroupedResults();
    DOM.analyzeGrouping.style.display = 'block';
  } finally {
    showAnalyzeLoading(false);
  }
}

function applyGroupingMapping(mapping, existingTopics) {
  for (const group of analyzeState.groupedTopics) {
    const match = mapping.find(m => normalize(m.extracted) === normalize(group.topicName));
    if (match && match.match) {
      const existing = existingTopics.find(t => t.id === match.match);
      if (existing) {
        group.matchedTopicId = existing.id;
        group.topicName = existing.name;
        group.isNew = false;
      } else {
        group.matchedTopicId = null;
        group.isNew = true;
      }
    } else {
      group.matchedTopicId = null;
      group.isNew = true;
    }
  }
}

async function handleRegroup() {
  const settings = await Storage.getSettings();
  const model = settings.customModelInput || settings.model || getDefaultModel(settings.provider);
  await runGroupingStep(settings, model);
}

async function handleSaveGrouped() {
  const existingTopics = await Storage.getTopics();
  let topicsCreated = 0;
  let thesesAdded = 0;
  const topicIdMap = new Map();

  // Сначала создаём новые темы
  for (const group of analyzeState.groupedTopics) {
    if (!group.theses.some(t => t.selected)) continue;

    let topicId;
    if (group.isNew || !group.matchedTopicId) {
      const newTopic = await Storage.addTopic(group.topicName);
      topicId = newTopic.id;
      group.matchedTopicId = topicId;
      group.isNew = false;
      topicsCreated++;
      topicIdMap.set(group.topicName, topicId);
    } else {
      topicId = group.matchedTopicId;
      topicIdMap.set(group.topicName, topicId);
    }
  }

  // Добавляем тезисы
  for (const group of analyzeState.groupedTopics) {
    const topicId = group.matchedTopicId || topicIdMap.get(group.topicName);
    if (!topicId) continue;

    for (const thesis of group.theses) {
      if (!thesis.selected) continue;
      try {
        await Storage.addThesis(topicId, thesis.question, thesis.answer);
        thesesAdded++;
      } catch (err) {
        console.warn('[Commenter] Error adding thesis:', err);
      }
    }
  }

  await refreshTopics();
  await refreshAnalyzeTopicSelect();

  analyzeState.groupedTopics = [];
  DOM.analyzeGrouping.style.display = 'none';

  showAnalyzeToast(`Создано ${topicsCreated} тем, добавлено ${thesesAdded} тезисов`);
}

// ── Рендер группированных результатов ───────

function renderGroupedResults() {
  const listEl = document.getElementById('analyze-grouped-list');
  const statsEl = document.getElementById('analyze-grouping-stats');
  if (!listEl || !statsEl) return;

  listEl.innerHTML = '';

  const totalTheses = analyzeState.groupedTopics.reduce((s, g) => s + g.theses.length, 0);
  const selectedTheses = analyzeState.groupedTopics.reduce((s, g) => s + g.theses.filter(t => t.selected).length, 0);
  const newTopics = analyzeState.groupedTopics.filter(g => g.isNew).length;
  const matchedTopics = analyzeState.groupedTopics.filter(g => !g.isNew).length;

  statsEl.innerHTML = `Тем: <strong>${analyzeState.groupedTopics.length}</strong> (${newTopics} новых, ${matchedTopics} привязанных). Тезисов: <strong>${totalTheses}</strong>, выбрано: <strong>${selectedTheses}</strong>.`;

  analyzeState.groupedTopics.forEach((group, gIdx) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'analyze-group' + (group.isNew ? ' is-new' : ' is-matched');

    const headerEl = document.createElement('div');
    headerEl.className = 'analyze-group-header';

    const badge = group.isNew
      ? '<span class="badge badge-new">Новая тема</span>'
      : '<span class="badge badge-exist">Существующая</span>';

    // Выпадающий список для смены привязки
    const selectEl = document.createElement('select');
    selectEl.className = 'field-select analyze-group-select';
    selectEl.innerHTML = `<option value="__new__" ${group.isNew ? 'selected' : ''}>Создать новую: \u00AB${escapeHtml(group.topicName)}\u00BB</option>`;

    const existingTopics = analyzeState._existingTopicsForSelect || [];
    existingTopics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (!group.isNew && group.matchedTopicId === t.id) opt.selected = true;
      selectEl.appendChild(opt);
    });

    selectEl.addEventListener('change', () => {
      if (selectEl.value === '__new__') {
        group.isNew = true;
        group.matchedTopicId = null;
        groupEl.classList.remove('is-matched');
        groupEl.classList.add('is-new');
      } else {
        group.isNew = false;
        group.matchedTopicId = selectEl.value;
        const matched = existingTopics.find(t => t.id === selectEl.value);
        if (matched) group.topicName = matched.name;
        groupEl.classList.remove('is-new');
        groupEl.classList.add('is-matched');
      }
      renderGroupedResults();
    });

    // Чекбокс «выбрать все в группе»
    const allSelected = group.theses.every(t => t.selected);
    const groupCb = document.createElement('input');
    groupCb.type = 'checkbox';
    groupCb.checked = allSelected;
    groupCb.title = 'Выбрать/снять все тезисы в этой теме';
    groupCb.addEventListener('change', () => {
      group.theses.forEach(t => { t.selected = groupCb.checked; });
      renderGroupedThesesCards(groupEl, group);
    });

    headerEl.innerHTML = '';
    headerEl.appendChild(groupCb);
    const badgeWrap = document.createElement('span');
    badgeWrap.innerHTML = badge;
    headerEl.appendChild(badgeWrap);
    headerEl.appendChild(selectEl);
    groupEl.appendChild(headerEl);

    renderGroupedThesesCards(groupEl, group);
    listEl.appendChild(groupEl);
  });
}

function renderGroupedThesesCards(groupEl, group) {
  const oldCards = groupEl.querySelectorAll('.analyze-thesis-card');
  oldCards.forEach(c => c.remove());

  group.theses.forEach((thesis, tIdx) => {
    const card = document.createElement('div');
    card.className = 'analyze-thesis-card' + (thesis.selected ? ' is-selected' : '');
    card.innerHTML = `
      <div class="analyze-thesis-header">
        <label class="analyze-cb-label">
          <input type="checkbox" class="analyze-cb" ${thesis.selected ? 'checked' : ''}>
          <span class="analyze-num">${tIdx + 1}</span>
        </label>
        <div class="analyze-thesis-actions">
          <button class="btn-icon analyze-edit-btn" title="Редактировать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger analyze-delete-btn" title="Удалить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="analyze-question"><strong>В:</strong> ${escapeHtml(thesis.question)}</div>
      <div class="analyze-answer"><strong>О:</strong> ${escapeHtml(thesis.answer)}</div>
    `;

    card.querySelector('.analyze-cb').addEventListener('change', (e) => {
      thesis.selected = e.target.checked;
      card.classList.toggle('is-selected', e.target.checked);
    });

    card.querySelector('.analyze-edit-btn').addEventListener('click', () => {
      showGroupedEditForm(card, thesis, () => renderGroupedResults());
    });

    card.querySelector('.analyze-delete-btn').addEventListener('click', () => {
      group.theses = group.theses.filter(t => t.id !== thesis.id);
      if (group.theses.length === 0) {
        analyzeState.groupedTopics = analyzeState.groupedTopics.filter(g => g.theses.length > 0);
        renderGroupedResults();
        if (analyzeState.groupedTopics.length === 0) {
          DOM.analyzeGrouping.style.display = 'none';
        }
      } else {
        renderGroupedResults();
      }
    });

    groupEl.appendChild(card);
  });
}

function showGroupedEditForm(cardEl, thesis, onSaved) {
  cardEl.innerHTML = `
    <div class="thesis-input-group"><label>Вопрос</label><textarea class="analyze-edit-question" rows="2">${escapeHtml(thesis.question)}</textarea></div>
    <div class="thesis-input-group"><label>Ответ</label><textarea class="analyze-edit-answer" rows="3">${escapeHtml(thesis.answer)}</textarea></div>
    <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm analyze-cancel-edit">Отмена</button>
      <button class="btn btn-primary btn-sm analyze-save-edit">Сохранить</button>
    </div>
  `;
  cardEl.classList.add('is-editing');

  cardEl.querySelector('.analyze-cancel-edit').addEventListener('click', () => { onSaved(); });
  cardEl.querySelector('.analyze-save-edit').addEventListener('click', () => {
    const q = cardEl.querySelector('.analyze-edit-question').value.trim();
    const a = cardEl.querySelector('.analyze-edit-answer').value.trim();
    if (q && a) { thesis.question = q; thesis.answer = a; onSaved(); }
  });
}

// ── Утилиты парсинга ────────────────────────

function groupThesesByTopic(theses) {
  const groups = new Map();
  for (const thesis of theses) {
    if (!groups.has(thesis.topic)) {
      groups.set(thesis.topic, {
        topicName: thesis.topic,
        matchedTopicId: null,
        isNew: true,
        theses: [],
      });
    }
    groups.get(thesis.topic).theses.push({
      id: thesis.id,
      question: thesis.question,
      answer: thesis.answer,
      selected: true,
    });
  }
  return [...groups.values()];
}

function parseAutoAnalyzeResponse(text) {
  let jsonStr = extractJsonArray(text);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && (item.topic || item.t) && (item.q || item.question) && (item.a || item.answer))
      .map((item, i) => ({
        id: `extracted_${Date.now().toString(36)}_${i}`,
        topic: (item.topic || item.t || '').trim(),
        question: (item.q || item.question || '').trim(),
        answer: (item.a || item.answer || '').trim(),
      }))
      .filter(t => t.topic && t.question && t.answer);
  } catch (e) {
    console.warn('[Commenter] Failed to parse auto-analyze response:', e);
    return [];
  }
}

function parseGroupingResponse(text) {
  let jsonStr = extractJsonArray(text);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && item.extracted)
      .map(item => ({
        extracted: item.extracted.trim(),
        match: item.match || null,
        reason: item.reason || '',
      }));
  } catch (e) {
    console.warn('[Commenter] Failed to parse grouping response:', e);
    return [];
  }
}

function extractJsonArray(text) {
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) return codeMatch[1].trim();
  const startIdx = text.indexOf('[');
  const endIdx = text.lastIndexOf(']');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.slice(startIdx, endIdx + 1);
  }
  return text;
}

function parseAnalyzeResponse(text) {
  let jsonStr = extractJsonArray(text);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && (item.q || item.question) && (item.a || item.answer))
      .map((item, i) => ({
        id: `extracted_${Date.now().toString(36)}_${i}`,
        question: (item.q || item.question || '').trim(),
        answer: (item.a || item.answer || '').trim(),
        selected: true,
      }))
      .filter(t => t.question && t.answer);
  } catch (e) {
    console.warn('[Commenter] Failed to parse analyze response:', e);
    return [];
  }
}

// ── Режим с выбранной темой ─────────────────

function renderAnalyzeResults(theses) {
  DOM.analyzeThesesList.innerHTML = '';
  DOM.analyzeStats.innerHTML = `Найдено <strong>${theses.length}</strong> тезисов. Отметьте нужные и нажмите \u00ABДобавить выбранные в базу\u00BB.`;

  theses.forEach((thesis, index) => {
    const card = document.createElement('div');
    card.className = 'analyze-thesis-card' + (thesis.selected ? ' is-selected' : '');
    card.dataset.id = thesis.id;
    card.innerHTML = `
      <div class="analyze-thesis-header">
        <label class="analyze-cb-label">
          <input type="checkbox" class="analyze-cb" ${thesis.selected ? 'checked' : ''}>
          <span class="analyze-num">${index + 1}</span>
        </label>
        <div class="analyze-thesis-actions">
          <button class="btn-icon analyze-edit-btn" title="Редактировать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger analyze-delete-btn" title="Удалить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="analyze-question"><strong>В:</strong> ${escapeHtml(thesis.question)}</div>
      <div class="analyze-answer"><strong>О:</strong> ${escapeHtml(thesis.answer)}</div>
    `;

    card.querySelector('.analyze-cb').addEventListener('change', (e) => {
      const t = analyzeState.extractedTheses.find(t => t.id === thesis.id);
      if (t) t.selected = e.target.checked;
      card.classList.toggle('is-selected', e.target.checked);
      updateAnalyzeStats();
    });

    card.querySelector('.analyze-edit-btn').addEventListener('click', () => {
      showAnalyzeEditForm(card, thesis);
    });

    card.querySelector('.analyze-delete-btn').addEventListener('click', () => {
      analyzeState.extractedTheses = analyzeState.extractedTheses.filter(t => t.id !== thesis.id);
      card.remove();
      updateAnalyzeStats();
      if (analyzeState.extractedTheses.length === 0) {
        DOM.analyzeResults.style.display = 'none';
      }
    });

    DOM.analyzeThesesList.appendChild(card);
  });
}

function showAnalyzeEditForm(cardEl, thesis) {
  cardEl.innerHTML = `
    <div class="thesis-input-group"><label>Вопрос</label><textarea class="analyze-edit-question" rows="2">${escapeHtml(thesis.question)}</textarea></div>
    <div class="thesis-input-group"><label>Ответ</label><textarea class="analyze-edit-answer" rows="3">${escapeHtml(thesis.answer)}</textarea></div>
    <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm analyze-cancel-edit">Отмена</button>
      <button class="btn btn-primary btn-sm analyze-save-edit">Сохранить</button>
    </div>
  `;
  cardEl.classList.add('is-editing');

  cardEl.querySelector('.analyze-cancel-edit').addEventListener('click', () => {
    renderAnalyzeResults(analyzeState.extractedTheses);
  });

  cardEl.querySelector('.analyze-save-edit').addEventListener('click', () => {
    const q = cardEl.querySelector('.analyze-edit-question').value.trim();
    const a = cardEl.querySelector('.analyze-edit-answer').value.trim();
    if (q && a) {
      const t = analyzeState.extractedTheses.find(t => t.id === thesis.id);
      if (t) { t.question = q; t.answer = a; }
      renderAnalyzeResults(analyzeState.extractedTheses);
    }
  });
}

function setAllAnalyzeTheses(selected) {
  analyzeState.extractedTheses.forEach(t => { t.selected = selected; });
  DOM.analyzeThesesList.querySelectorAll('.analyze-cb').forEach(cb => { cb.checked = selected; });
  DOM.analyzeThesesList.querySelectorAll('.analyze-thesis-card').forEach(card => {
    card.classList.toggle('is-selected', selected);
  });
  updateAnalyzeStats();
}

function updateAnalyzeStats() {
  const total = analyzeState.extractedTheses.length;
  const selected = analyzeState.extractedTheses.filter(t => t.selected).length;
  DOM.analyzeStats.innerHTML = `Найдено <strong>${total}</strong> тезисов. Выбрано: <strong>${selected}</strong>. Отметьте нужные и нажмите \u00ABДобавить выбранные в базу\u00BB.`;
}

async function handleAddAnalyzedTheses() {
  const topicId = DOM.analyzeTopicSelect.value;
  if (!topicId || topicId === '__auto__') {
    showAnalyzeError('Выберите тему для сохранения.');
    return;
  }

  const toAdd = analyzeState.extractedTheses.filter(t => t.selected);
  if (toAdd.length === 0) {
    showAnalyzeError('Нет выбранных тезисов для добавления.');
    return;
  }

  let addedCount = 0;
  for (const thesis of toAdd) {
    try {
      await Storage.addThesis(topicId, thesis.question, thesis.answer);
      addedCount++;
    } catch (err) {
      console.warn('[Commenter] Error adding thesis:', err);
    }
  }

  await refreshTopics();
  await refreshAnalyzeTopicSelect();

  const addedIds = new Set(toAdd.map(t => t.id));
  analyzeState.extractedTheses = analyzeState.extractedTheses.filter(t => !addedIds.has(t.id));

  if (analyzeState.extractedTheses.length === 0) {
    DOM.analyzeResults.style.display = 'none';
  } else {
    renderAnalyzeResults(analyzeState.extractedTheses);
  }

  showAnalyzeToast(`Добавлено ${addedCount} тезисов в базу`);
}

// ── Общие утилиты анализа ───────────────────

async function sendChatRequest(settings, model, systemPrompt, userMessage) {
  const response = await chrome.runtime.sendMessage({
    type: 'CHAT_REQUEST',
    payload: {
      provider: settings.provider,
      apiKey: settings.apiKey,
      model,
      systemPrompt,
      userMessage,
    },
  });

  if (!response.success) {
    showAnalyzeError(`Ошибка: ${response.error}`);
    return null;
  }
  return response.data;
}

function showAnalyzeLoading(show, text) {
  const loadingEl = document.getElementById('analyze-loading');
  const textEl = document.getElementById('analyze-loading-text');
  loadingEl.style.display = show ? 'flex' : 'none';
  if (textEl && text) textEl.textContent = text;
  DOM.btnAnalyze.disabled = show;
}

function showAnalyzeError(message) {
  DOM.analyzeErrorBox.textContent = message;
  DOM.analyzeErrorBox.style.display = 'block';
}

function hideAnalyzeError() {
  DOM.analyzeErrorBox.style.display = 'none';
}

function showAnalyzeToast(message) {
  DOM.analyzeSavedToast.textContent = message;
  DOM.analyzeSavedToast.style.display = 'block';
  setTimeout(() => { DOM.analyzeSavedToast.style.display = 'none'; }, 2500);
}


// ═══════════════════════════════════════════
//  ТАБ «НАСТРОЙКИ»
// ═══════════════════════════════════════════

function setupSettingsTab() {
  DOM.providerSelect.addEventListener('change', () => updateModelOptions());
  DOM.btnSaveSettings.addEventListener('click', saveSettings);
  DOM.templateSelect?.addEventListener('change', async () => {
 // При смене шаблона в генерации — не делаем его активным глобально
  });
}

async function loadSettings() {
  const settings = await Storage.getSettings();
  DOM.providerSelect.value = settings.provider || 'z-ai';
  DOM.apiKeyInput.value = settings.apiKey || '';
  DOM.customModelInput.value = settings.customModelInput || '';
  DOM.thesisAutoSelect.checked = !!settings.thesisAutoSelect;
  await updateModelOptions();
  if (settings.model) DOM.modelSelect.value = settings.model;
}

async function updateModelOptions() {
  const provider = DOM.providerSelect.value;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MODELS', payload: { provider } });
    if (response.success) {
      DOM.modelSelect.innerHTML = '<option value="">— Выберите модель —</option>';
      response.data.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.name;
        DOM.modelSelect.appendChild(opt);
      });
    }
  } catch { fallbackModelOptions(provider); }
}

function fallbackModelOptions(provider) {
  const models = provider === 'z-ai'
    ? [{ id: 'glm-4-plus', name: 'GLM-4 Plus' }, { id: 'glm-4', name: 'GLM-4' }, { id: 'glm-4-flash', name: 'GLM-4 Flash' }]
    : [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' }, { id: 'openai/gpt-4o', name: 'GPT-4o' }, { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }];
  DOM.modelSelect.innerHTML = '<option value="">— Выберите модель —</option>';
  models.forEach(model => { const opt = document.createElement('option'); opt.value = model.id; opt.textContent = model.name; DOM.modelSelect.appendChild(opt); });
}

async function saveSettings() {
  const settings = await Storage.getSettings();
  settings.provider = DOM.providerSelect.value;
  settings.apiKey = DOM.apiKeyInput.value.trim();
  settings.model = DOM.modelSelect.value;
  settings.customModelInput = DOM.customModelInput.value.trim();
  settings.thesisAutoSelect = DOM.thesisAutoSelect.checked;
  await Storage.saveSettings(settings);
  DOM.settingsSavedToast.style.display = 'block';
  setTimeout(() => { DOM.settingsSavedToast.style.display = 'none'; }, 2000);
}

// ═══════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════

function createProvider(providerName) {
  return providerName === 'openrouter' ? new OpenRouterProvider() : new ZAiProvider();
}

function getDefaultModel(provider) {
  return provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'glm-4-plus';
}

function showLoading(show) { DOM.loadingIndicator.style.display = show ? 'flex' : 'none'; DOM.btnGenerate.disabled = show; }
function showError(message) { DOM.errorBox.textContent = message; DOM.errorBox.style.display = 'block'; }
function hideError() { DOM.errorBox.style.display = 'none'; }

function closeAllModals() {
  DOM.topicEditorModal.style.display = 'none';
  DOM.importModal.style.display = 'none';
  DOM.importResultModal.style.display = 'none';
  state.editingTopicId = null;
  state.editingTheses = [];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showImportToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}
