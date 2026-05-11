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
