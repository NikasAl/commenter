/**
 * Commenter — Popup Logic
 * Связывает UI, storage и LLM провайдеров
 */

import { ZAiProvider } from '../lib/providers/z-ai.js';
import { OpenRouterProvider } from '../lib/providers/openrouter.js';

// Storage загружается через обычный <script> — доступен как window.Storage
const Storage = window.Storage;

// ── Состояние ─────────────────────────────
const state = {
  currentTab: 'generate',
  editingTopicId: null,  // ID редактируемой темы (null = новая)
  editingTheses: [],     // Копия тезисов при редактировании
  lastUserMessage: '',   // Последний текст для пере-генерации
};

// ── DOM-элементы ──────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  // Табы
  tabBtns: $$('.tab-btn'),
  tabPanels: $$('.tab-panel'),

  // Генерация
  topicSelect: $('#topic-select'),
  topicThesisCount: $('#topic-thesis-count'),
  inputText: $('#input-text'),
  btnGenerate: $('#btn-generate'),
  resultGroup: $('#result-group'),
  resultText: $('#result-text'),
  btnCopy: $('#btn-copy'),
  btnRegenerate: $('#btn-regenerate'),
  loadingIndicator: $('#loading-indicator'),
  errorBox: $('#error-box'),

  // Темы
  btnAddTopic: $('#btn-add-topic'),
  btnImportTopics: $('#btn-import-topics'),
  importModal: $('#import-modal'),
  importTextarea: $('#import-textarea'),
  btnDoImport: $('#btn-do-import'),
  importErrorBox: $('#import-error-box'),
  topicsList: $('#topics-list'),
  topicsEmpty: $('#topics-empty'),
  topicEditorModal: $('#topic-editor-modal'),
  topicEditorTitle: $('#topic-editor-title'),
  topicNameInput: $('#topic-name-input'),
  btnAddThesis: $('#btn-add-thesis'),
  thesesList: $('#theses-list'),
  thesesEmpty: $('#theses-empty'),
  btnSaveTopic: $('#btn-save-topic'),

  // Настройки
  providerSelect: $('#provider-select'),
  apiKeyInput: $('#api-key-input'),
  modelSelect: $('#model-select'),
  customModelInput: $('#custom-model-input'),
  btnSaveSettings: $('#btn-save-settings'),
  settingsSavedToast: $('#settings-saved-toast'),
};

// ── Инициализация ─────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  setupGenerateTab();
  setupTopicsTab();
  setupSettingsTab();
  await refreshTopics();
  await loadSettings();
}

// ═══════════════════════════════════════════
//  ТАБЫ
// ═══════════════════════════════════════════

function setupTabs() {
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  state.currentTab = tab;
  DOM.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  DOM.tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));

  if (tab === 'topics') {
    refreshTopics();
  }
}

// ═══════════════════════════════════════════
//  ТАБ «ГЕНЕРАЦИЯ»
// ═══════════════════════════════════════════

function setupGenerateTab() {
  DOM.btnGenerate.addEventListener('click', handleGenerate);
  DOM.btnCopy.addEventListener('click', handleCopy);
  DOM.btnRegenerate.addEventListener('click', handleRegenerate);

  // Обновить подсказку при смене темы
  DOM.topicSelect.addEventListener('change', async () => {
    const topicId = DOM.topicSelect.value;
    if (topicId) {
      const topic = await Storage.getTopicById(topicId);
      const count = topic ? topic.theses.length : 0;
      DOM.topicThesisCount.textContent = `${count} тезисов в теме`;
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

  // Восстановить выделение
  if (currentVal && topics.find(t => t.id === currentVal)) {
    DOM.topicSelect.value = currentVal;
  }
}

async function handleGenerate() {
  const topicId = DOM.topicSelect.value;
  const userMessage = DOM.inputText.value.trim();

  if (!topicId) {
    showError('Выберите тему для генерации ответа.');
    return;
  }

  if (!userMessage) {
    showError('Вставьте текст комментария или поста для ответа.');
    return;
  }

  state.lastUserMessage = userMessage;

  // Получить тему с тезисами
  const topic = await Storage.getTopicById(topicId);
  if (!topic) {
    showError('Тема не найдена. Попробуйте выбрать тему заново.');
    return;
  }

  // Получить настройки
  const settings = await Storage.getSettings();
  if (!settings.apiKey) {
    showError('API ключ не настроен. Перейдите в "Настройки" и укажите ключ.');
    return;
  }

  const model = settings.customModelInput || settings.model || getDefaultModel(settings.provider);

  // Сформировать системный промпт
  const provider = createProvider(settings.provider);
  const systemPrompt = provider.buildSystemPrompt(topic.name, topic.theses);

  // Показать загрузку
  showLoading(true);
  hideError();
  DOM.resultGroup.style.display = 'none';

  try {
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
      showError(response.error);
      return;
    }

    // Показать результат
    DOM.resultText.textContent = response.data;
    DOM.resultGroup.style.display = 'block';
  } catch (err) {
    showError(`Ошибка: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

async function handleRegenerate() {
  if (state.lastUserMessage) {
    await handleGenerate();
  }
}

async function handleCopy() {
  const text = DOM.resultText.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    DOM.btnCopy.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Скопировано!
    `;
    setTimeout(() => {
      DOM.btnCopy.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Копировать
      `;
    }, 2000);
  } catch {
    // Фоллбэк для старых браузеров
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

// ═══════════════════════════════════════════
//  ТАБ «ТЕМЫ»
// ═══════════════════════════════════════════

function setupTopicsTab() {
  DOM.btnAddTopic.addEventListener('click', () => openTopicEditor(null));
  DOM.btnAddThesis.addEventListener('click', () => addThesisRow());
  DOM.btnSaveTopic.addEventListener('click', saveTopic);

  // Импорт из текста
  DOM.btnImportTopics.addEventListener('click', () => {
    DOM.importTextarea.value = '';
    DOM.importErrorBox.style.display = 'none';
    DOM.importModal.style.display = 'flex';
    DOM.importTextarea.focus();
  });
  DOM.btnDoImport.addEventListener('click', handleImportText);

  // Закрытие модалки
  $$('.modal-overlay, [data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeModal());
  });
}

async function refreshTopics() {
  const topics = await Storage.getTopics();

  // Обновить список тем в popup
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

    card.querySelector('.topic-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openTopicEditor(topic.id);
    });

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

  // Обновить select в табе генерации
  await refreshTopicSelect();
}

async function openTopicEditor(topicId) {
  state.editingTopicId = topicId;

  if (topicId) {
    // Редактирование существующей темы
    const topic = await Storage.getTopicById(topicId);
    if (!topic) return;

    DOM.topicEditorTitle.textContent = 'Редактирование темы';
    DOM.topicNameInput.value = topic.name;
    state.editingTheses = JSON.parse(JSON.stringify(topic.theses));
  } else {
    // Новая тема
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

    card.querySelector('.thesis-edit-btn').addEventListener('click', () => {
      renderThesisEditForm(card, index);
    });

    card.querySelector('.thesis-delete-btn').addEventListener('click', () => {
      state.editingTheses.splice(index, 1);
      renderThesesEditor();
    });

    DOM.thesesList.appendChild(card);
  });
}

function renderThesisEditForm(cardEl, index) {
  const thesis = state.editingTheses[index];
  cardEl.innerHTML = `
    <div class="thesis-input-group">
      <label>Вопрос</label>
      <textarea class="thesis-question-input" rows="2">${escapeHtml(thesis.question)}</textarea>
    </div>
    <div class="thesis-input-group">
      <label>Ответ</label>
      <textarea class="thesis-answer-input" rows="3">${escapeHtml(thesis.answer)}</textarea>
    </div>
    <div style="display:flex; gap:6px; margin-top:8px; justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm thesis-cancel-btn">Отмена</button>
      <button class="btn btn-primary btn-sm thesis-save-btn">Сохранить</button>
    </div>
  `;

  cardEl.querySelector('.thesis-cancel-btn').addEventListener('click', () => {
    renderThesesEditor();
  });

  cardEl.querySelector('.thesis-save-btn').addEventListener('click', () => {
    const q = cardEl.querySelector('.thesis-question-input').value.trim();
    const a = cardEl.querySelector('.thesis-answer-input').value.trim();
    if (q && a) {
      state.editingTheses[index] = { ...thesis, question: q, answer: a };
      renderThesesEditor();
    }
  });
}

function addThesisRow() {
  // Добавляем пустой тезис с плейсхолдерами и сразу открываем форму редактирования
  const newThesis = {
    id: Storage._generateId(),
    question: '',
    answer: '',
    createdAt: Date.now(),
  };
  state.editingTheses.push(newThesis);
  renderThesesEditor();

  // Сразу открываем форму редактирования нового тезиса
  const lastIndex = state.editingTheses.length - 1;
  const lastCard = DOM.thesesList.lastElementChild;
  if (lastCard) {
    renderThesisEditForm(lastCard, lastIndex);
    lastCard.querySelector('.thesis-question-input').focus();
  }
}

async function saveTopic() {
  const name = DOM.topicNameInput.value.trim();
  if (!name) {
    alert('Введите название темы.');
    return;
  }

  if (state.editingTopicId) {
    // Обновить существующую тему
    await Storage.updateTopic(state.editingTopicId, name);

    // Заменить тезисы: удалить старые, добавить новые
    const existingTopic = await Storage.getTopicById(state.editingTopicId);
    if (existingTopic) {
      // Удаляем все текущие тезисы
      for (const oldThesis of existingTopic.theses) {
        await Storage.deleteThesis(state.editingTopicId, oldThesis.id);
      }
      // Добавляем новые
      for (const thesis of state.editingTheses) {
        if (thesis.question.trim() && thesis.answer.trim()) {
          await Storage.addThesis(state.editingTopicId, thesis.question, thesis.answer);
        }
      }
    }
  } else {
    // Создать новую тему
    const topic = await Storage.addTopic(name);
    // Добавить тезисы
    for (const thesis of state.editingTheses) {
      if (thesis.question.trim() && thesis.answer.trim()) {
        await Storage.addThesis(topic.id, thesis.question, thesis.answer);
      }
    }
  }

  closeModal();
  await refreshTopics();
}

function closeModal() {
  DOM.topicEditorModal.style.display = 'none';
  DOM.importModal.style.display = 'none';
  state.editingTopicId = null;
  state.editingTheses = [];
}

// ═══════════════════════════════════════════
//  ТАБ «НАСТРОЙКИ»
// ═══════════════════════════════════════════

function setupSettingsTab() {
  DOM.providerSelect.addEventListener('change', () => {
    updateModelOptions();
  });

  DOM.btnSaveSettings.addEventListener('click', saveSettings);
}

async function loadSettings() {
  const settings = await Storage.getSettings();
  DOM.providerSelect.value = settings.provider || 'z-ai';
  DOM.apiKeyInput.value = settings.apiKey || '';
  DOM.customModelInput.value = settings.customModelInput || '';

  await updateModelOptions();
  if (settings.model) {
    DOM.modelSelect.value = settings.model;
  }
}

async function updateModelOptions() {
  const provider = DOM.providerSelect.value;

  // Получить модели через background
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_MODELS',
      payload: { provider },
    });

    if (response.success) {
      const models = response.data;
      DOM.modelSelect.innerHTML = '<option value="">— Выберите модель —</option>';
      models.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.name;
        DOM.modelSelect.appendChild(opt);
      });
    }
  } catch {
    // Фоллбэк: использовать статический список
    fallbackModelOptions(provider);
  }
}

function fallbackModelOptions(provider) {
  const models = provider === 'z-ai'
    ? [
        { id: 'glm-4-plus', name: 'GLM-4 Plus' },
        { id: 'glm-4', name: 'GLM-4' },
        { id: 'glm-4-flash', name: 'GLM-4 Flash' },
      ]
    : [
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
        { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      ];

  DOM.modelSelect.innerHTML = '<option value="">— Выберите модель —</option>';
  models.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = model.name;
    DOM.modelSelect.appendChild(opt);
  });
}

async function saveSettings() {
  const model = DOM.modelSelect.value || DOM.customModelInput.value;
  const settings = {
    provider: DOM.providerSelect.value,
    apiKey: DOM.apiKeyInput.value.trim(),
    model: DOM.modelSelect.value,
    customModelInput: DOM.customModelInput.value.trim(),
  };

  await Storage.saveSettings(settings);

  // Показать тост
  const toast = DOM.settingsSavedToast;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

// ═══════════════════════════════════════════
//  ИМПОРТ ИЗ ФАЙЛА
// ═══════════════════════════════════════════

/**
 * Парсер текстового файла в формате:
 *   T:Название темы
 *   Q:Текст вопроса (может быть многострочным)
 *   A:Текст ответа (может быть многострочным)
 *   ...
 *   (пустая строка между тезисами, новая строка T: = новая тема)
 */
function parseTopicsFile(text) {
  // Нормализация переносов строк (Windows \r\n, старый Mac \r)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const topics = [];
  let currentTopic = null;
  let currentThesis = null;
  let currentField = null; // 'question' | 'answer'

  const lines = text.split('\n');

  for (const rawLine of lines) {
    // Определяем тип строки
    if (rawLine.startsWith('T:')) {
      // Новая тема — сохранить предыдущий тезис если есть
      if (currentThesis && currentTopic) {
        finalizeThesis(currentTopic, currentThesis);
      }
      currentTopic = {
        name: rawLine.slice(2).trim(),
        theses: [],
      };
      currentThesis = null;
      currentField = null;
      topics.push(currentTopic);
      continue;
    }

    if (rawLine.startsWith('Q:')) {
      // Сохранить предыдущий тезис
      if (currentThesis && currentTopic) {
        finalizeThesis(currentTopic, currentThesis);
      }
      currentThesis = {
        question: rawLine.slice(2).trim(),
        answer: '',
      };
      currentField = 'question';
      continue;
    }

    if (rawLine.startsWith('A:')) {
      currentField = 'answer';
      if (currentThesis) {
        currentThesis.answer = rawLine.slice(2).trim();
      }
      continue;
    }

    if (rawLine.trim() === '' || rawLine.startsWith('---')) {
      // Пустая строка или разделитель — переносим в текущее поле
      if (currentField && currentThesis) {
        if (currentField === 'question') {
          currentThesis.question += '\n';
        } else if (currentField === 'answer') {
          currentThesis.answer += '\n';
        }
      }
      continue;
    }

    // Продолжение многострочного поля
    if (currentField === 'question' && currentThesis) {
      currentThesis.question += (currentThesis.question ? '\n' : '') + rawLine;
    } else if (currentField === 'answer' && currentThesis) {
      currentThesis.answer += (currentThesis.answer ? '\n' : '') + rawLine;
    }
  }

  // Не забываем последний тезис
  if (currentThesis && currentTopic) {
    finalizeThesis(currentTopic, currentThesis);
  }

  return topics.filter(t => t.name && t.theses.length > 0);
}

function finalizeThesis(topic, thesis) {
  // Убираем лишние переводы строк по краям, но сохраняем внутренние
  thesis.question = thesis.question.trim();
  thesis.answer = thesis.answer.trim();
  if (thesis.question && thesis.answer) {
    topic.theses.push({ question: thesis.question, answer: thesis.answer });
  }
}

async function handleImportText() {
  const text = DOM.importTextarea.value.trim();
  if (!text) {
    DOM.importErrorBox.textContent = 'Вставьте текст для импорта.';
    DOM.importErrorBox.style.display = 'block';
    return;
  }

  try {
    const parsedTopics = parseTopicsFile(text);
    console.log('[Commenter Import] Parsed:', parsedTopics.length, 'topics', parsedTopics.reduce((s, t) => s + t.theses.length, 0), 'theses');

    if (parsedTopics.length === 0) {
      DOM.importErrorBox.textContent = 'Не найдено тем в тексте. Проверьте формат: T:, Q:, A:';
      DOM.importErrorBox.style.display = 'block';
      return;
    }

    let totalTheses = 0;
    let totalCreated = 0;
    for (const topicData of parsedTopics) {
      try {
        const existingTopics = await Storage.getTopics();
        const existing = existingTopics.find(t => t.name === topicData.name);

        let topicId;
        if (existing) {
          topicId = existing.id;
        } else {
          const topic = await Storage.addTopic(topicData.name);
          topicId = topic.id;
          totalCreated++;
        }

        for (const thesis of topicData.theses) {
          await Storage.addThesis(topicId, thesis.question, thesis.answer);
          totalTheses++;
        }
      } catch (innerErr) {
        console.error('[Commenter Import] Error on topic', topicData.name, ':', innerErr);
      }
    }

    // Закрыть модалку и обновить список
    DOM.importModal.style.display = 'none';
    await refreshTopics();
    showImportToast(`${totalCreated} новых тем, ${totalTheses} тезисов импортировано`);
  } catch (err) {
    console.error('[Commenter Import] Fatal error:', err);
    DOM.importErrorBox.textContent = `Ошибка: ${err.message}`;
    DOM.importErrorBox.style.display = 'block';
  }
}

function showImportToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function showTopicsError(message) {
  // Показываем ошибку в текущей вкладке (Темы), а не в Генерации
  let errorBox = document.getElementById('topics-error-box');
  if (!errorBox) {
    errorBox = document.createElement('div');
    errorBox.id = 'topics-error-box';
    errorBox.className = 'error-box';
    // Вставляем после списка тем
    const topicsList = document.getElementById('topics-list');
    if (topicsList && topicsList.parentNode) {
      topicsList.parentNode.insertBefore(errorBox, topicsList.nextSibling);
    }
  }
  errorBox.textContent = message;
  errorBox.style.display = 'block';
  setTimeout(() => { errorBox.style.display = 'none'; }, 5000);
}

// ═══════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════

function createProvider(providerName) {
  if (providerName === 'openrouter') {
    return new OpenRouterProvider();
  }
  return new ZAiProvider();
}

function getDefaultModel(provider) {
  if (provider === 'openrouter') return 'openai/gpt-4o-mini';
  return 'glm-4-plus';
}

function showLoading(show) {
  DOM.loadingIndicator.style.display = show ? 'flex' : 'none';
  DOM.btnGenerate.disabled = show;
}

function showError(message) {
  DOM.errorBox.textContent = message;
  DOM.errorBox.style.display = 'block';
}

function hideError() {
  DOM.errorBox.style.display = 'none';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

