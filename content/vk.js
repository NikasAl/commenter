/**
 * Commenter — VK Content Script
 *
 * Хоткеи (при фокусе в поле комментария):
 *   Ctrl+Shift+P  — извлечь контекст поста, собрать промпт, показать в панельке + копировать
 *   Ctrl+Shift+G  — отправить собранный промпт в LLM, вставить результат в поле
 *   Ctrl+Shift+L  — создать новый тезис (из буфера обмена)
 *
 * Селекторы актуальны для VK (2025 redesign — VKUI / vkit компоненты).
 * Все селекторы основаны на data-testid, НЕ на хэшированных CSS-классах.
 */

(() => {
  'use strict';

  // ═════════════════════════════════════════
  //  НАСТРОЙКИ
  // ═════════════════════════════════════════

  const HOTKEY_PROMPT = 'KeyP';   // Ctrl+Shift+P — сбор промпта
  const HOTKEY_GENERATE = 'KeyG'; // Ctrl+Shift+G — генерация
  const HOTKEY_NEW_THESIS = 'KeyL'; // Ctrl+Shift+L — новый тезис

  const DEFAULT_SYSTEM_PROMPT = `Ты — эксперт по теме "{{topic}}". Используй приведённые ниже тезисы для формирования ответа. Твой ответ должен быть аргументированным, опираться на тезисы, но звучать естественно, а не как цитата из справочника. Если тезисы не покрывают вопрос полностью, можешь дополнить ответ своими знаниями, но в первую очередь используй тезисы.

=== ТЕЗИСЫ ===
{{theses}}
=== КОНЕЦ ТЕЗИСОВ ===

Формулируй ответ на русском языке. Пиши понятно и лаконично. Сформулируй ответ на этот пост (и/или на комментарии), используя тезисы из системного промпта.`;

  // ═══════════════════════════════════════════
  //  СОСТОЯНИЕ
  // ═══════════════════════════════════════════

  let lastBuiltPrompt = null;
  let lastFocusedField = null;
  let panelHost = null;      // хост-элемент #commenter-panel-host
  let panelShadow = null;    // ссылка на shadow root
  let isGenerating = false;

  // Кэш для пересборки промпта при смене темы
  let cachedContext = null;
  let cachedTopics = [];
  let cachedSettings = null;

  // Состояние выбора тезисов
  let selectedThesisIds = new Set();
  let currentTopicTheses = [];
  let isSelectingTheses = false;

  // Дефолтные модели (дублируем из storage.js, т.к. content script не импортирует модули)
  const DEFAULT_MODELS = {
    'z-ai': [
      { id: 'GLM-4.7-Flash', name: 'GLM-4.7-Flash' },
      { id: 'GLM-4.7', name: 'GLM-4.7' },
      { id: 'GLM-5.1-Turbo', name: 'GLM-5.1-Turbo' },
    ],
    'local': [
      { id: 'gemma-4-26b', name: 'Gemma 4 26B' },
    ],
    'gigachat': [
      { id: 'GigaChat-2-Max', name: 'GigaChat-2 Max' },
      { id: 'GigaChat-Max', name: 'GigaChat Max' },
      { id: 'GigaChat-2-Pro', name: 'GigaChat-2 Pro' },
      { id: 'GigaChat-Pro', name: 'GigaChat Pro' },
      { id: 'GigaChat-2', name: 'GigaChat-2' },
      { id: 'GigaChat', name: 'GigaChat' },
      { id: 'GigaChat-Plus', name: 'GigaChat Plus' },
      { id: 'GigaChat-2-Lite', name: 'GigaChat-2 Lite' },
      { id: 'GigaChat-Lite', name: 'GigaChat Lite' },
    ],
    'openrouter': [
      { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B IT' },
      { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
      { id: 'microsoft/phi-4', name: 'Phi-4' },
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'google/gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite' },
      { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
      { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash (free)' },
      { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'Nemotron Nano Omni 30B (free)' },
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron Super 120B (free)' },
      { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 Llama 3.1 405B (free)' },
    ],
  };

  // Модель и провайдер, выбранные в панели
  let panelProvider = null;
  let panelModel = null;

  // Пользователь редактировал контекст вручную
  let isUserMessageEdited = false;

  // Кэш совпадений ключевых слов для подсветки
  let cachedKeywordMatches = new Map(); // thesisId -> Set<keyword>
  let cachedKeywords = [];              // все извлечённые ключевые слова
  let disabledKeywords = new Set();     // отключённые ключевые слова

  // ═══════════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════════

  console.log('[Commenter] VK content script loaded on', location.hostname);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', onKeyDown, true);

  // VK использует SPA-навигацию — при смене страницы DOM заменяется,
  // и document-level слушатели могут перестать работать.
  // Следим за изменениями в #spa_root и при крупных перестройках
  // переназначаем слушатели.
  let _spaObserver = null;
  function ensureSpaListeners() {
    const spaRoot = document.getElementById('spa_root');
    if (!spaRoot || _spaObserver) return;
    _spaObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length > 3 || m.removedNodes.length > 3) {
          // Крупное изменение DOM (SPA-переход) — сбрасываем кэш поля
          console.log('[Commenter] SPA navigation detected, resetting field cache');
          lastFocusedField = null;
          break;
        }
      }
    });
    _spaObserver.observe(spaRoot, { childList: true, subtree: false });
  }
  // Запускаем через небольшой таймаут, т.к. spa_root может ещё не существовать
  setTimeout(ensureSpaListeners, 1000);
  setTimeout(ensureSpaListeners, 5000);

  // ── Отслеживание фокуса ──────────────────

  function onFocusIn(event) {
    const target = event.target;
    if (isCommentField(target)) {
      lastFocusedField = target;
      console.log('[Commenter] Focused on comment input:', target.tagName, target.className.slice(0, 60));
    }
  }

  // ── Хоткеи ───────────────────────────────

  function onKeyDown(event) {
    if (!event.ctrlKey || !event.shiftKey) return;

    if (event.code === HOTKEY_PROMPT) {
      event.preventDefault();
      event.stopPropagation();
      handleBuildPrompt();
    }

    if (event.code === HOTKEY_GENERATE) {
      event.preventDefault();
      event.stopPropagation();
      handleGenerate();
    }

    if (event.code === HOTKEY_NEW_THESIS) {
      event.preventDefault();
      event.stopPropagation();
      handleNewThesis();
    }
  }

  // ═══════════════════════════════════════════
  //  ШАГ 1: СБОР ПРОМПТА (Ctrl+Shift+P)
  // ═════════════════════════════════════════

  async function handleBuildPrompt() {
    const field = lastFocusedField || document.activeElement;
    if (!isCommentField(field)) {
      showPanel('Ошибка', 'Поставьте фокус в поле комментария (contenteditable input).', 'error');
      return;
    }

    const context = extractPostContext(field);
    if (!context) {
      showPanel('Ошибка', 'Не удалось найти пост.\n\nОтладка:\n' + debugFieldPath(field), 'error');
      return;
    }

    logContext(context);

    // Получить настройки, темы и шаблоны
    const settings = await getSettings();
    const topics = await getTopics();
    const templates = await getTemplates();
    const activeTpl = templates.find(t => t.isActive) || templates[0] || null;

    // Кэшируем
    cachedContext = context;
    cachedTopics = topics;
    cachedSettings = { ...settings, templates, activeTemplateId: activeTpl?.id || '' };

    // Сбросить ручное редактирование контекста при новой сборке промпта
    isUserMessageEdited = false;

    // Инициализируем модель и провайдер из настроек
    const curModelInfo = getCurrentModelAndProvider(cachedSettings);
    panelProvider = curModelInfo.provider;
    panelModel = curModelInfo.model;

    const activeTopicId = settings.activeTopicId || '';
    const topic = topics.find(t => t.id === activeTopicId);
    currentTopicTheses = topic ? (topic.theses || []) : [];

    // Отрисовываем панель с тезисами
    if (currentTopicTheses.length > 0) {
      // Начинаем с «выбраны все»
      selectedThesisIds = new Set(currentTopicTheses.map(t => t.id));
      showPromptPanel(context, topics, activeTopicId, topic, currentTopicTheses, selectedThesisIds, false);

      // Если автоотбор включён — запускаем LLM-селекцию
      const provSettings = getProviderSettings(settings);
      const prov = settings.provider || 'z-ai';
      if (settings.thesisAutoSelect && (prov === 'local' || prov === 'gigachat' || provSettings.apiKey)) {
        const mode = settings.thesisSelectionMode || 'full';
        if (mode === 'keywords') {
          await runKeywordSelection(context, topic, currentTopicTheses);
        } else {
          await runThesisSelection(context, topic, currentTopicTheses);
        }
      }
    } else {
      selectedThesisIds = new Set();
      // Нет тезисов — показываем обычную панель без селектора
      const topicName = topic ? topic.name : '';
      const thesesText = '';
      const promptTemplate = activeTpl?.content || DEFAULT_SYSTEM_PROMPT;
      const systemPrompt = buildSystemPrompt(promptTemplate, topicName || 'Общая тема', thesesText);
      const userMessage = formatUserMessage(context);
      lastBuiltPrompt = { systemPrompt, userMessage, context };
      const fullPrompt = `[Системный промпт]\n${systemPrompt}\n\n[Контекст поста + сообщение для ответа]\n${userMessage}`;
      showPanel(topicName, fullPrompt, 'prompt', context, { topics, activeTopicId, templates, activeTemplateId: activeTpl?.id });
    }

    // Копируем
    if (lastBuiltPrompt) {
      const fp = `[Системный промпт]\n${lastBuiltPrompt.systemPrompt}\n\n[Контекст поста + сообщение для ответа]\n${lastBuiltPrompt.userMessage}`;
      try { await navigator.clipboard.writeText(fp); } catch {}
    }
  }

  // ═══════════════════════════════════════════
  //  ШАГ 2: ГЕНЕРАЦИЯ (Ctrl+Shift+G)
  // ═══════════════════════════════════════════

  async function handleGenerate() {
    if (isGenerating) {
      showPanel('Подождите', 'Генерация уже выполняется...', 'info');
      return;
    }

    const field = lastFocusedField || document.activeElement;
    if (!isCommentField(field)) {
      showPanel('Ошибка', 'Поставьте фокус в поле комментария.', 'error');
      return;
    }

    if (!lastBuiltPrompt) {
      showPanel('Ошибка', 'Сначала соберите промпт: Ctrl+Shift+P', 'error');
      return;
    }

    const settings = await getSettings();

    // Используем провайдер и модель из панели (если выбраны там), иначе из настроек
    const useProvider = panelProvider || settings.provider || 'z-ai';
    const useModel = panelModel || null;
    const ps = settings.providers?.[useProvider] || getProviderSettings(settings);
    if (!ps.apiKey && useProvider !== 'local' && useProvider !== 'gigachat') {
      showPanel('Ошибка', `API ключ не настроен для провайдера ${useProvider}. Откройте настройки расширения.`, 'error');
      return;
    }
    const model = useModel || ps.customModelInput || ps.model || getDefaultModel(useProvider);

    isGenerating = true;
    showPanel('Генерация...', 'Отправляю запрос в LLM...', 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_REQUEST',
        payload: {
          provider: useProvider,
          apiKey: ps.apiKey,
          model: model,
          systemPrompt: lastBuiltPrompt.systemPrompt,
          userMessage: lastBuiltPrompt.userMessage,
          baseUrl: ps.baseUrl,
          gigachatAuthKey: ps.gigachatAuthKey || '',
        },
      });

      if (!response.success) {
        showPanel('Ошибка LLM', response.error, 'error');
        return;
      }

      insertIntoField(field, response.data);
      showPanel('Готово', response.data, 'result');
      console.log('[Commenter] Response inserted into comment field');
    } catch (err) {
      showPanel('Ошибка', `Не удалось получить ответ: ${err.message}`, 'error');
    } finally {
      isGenerating = false;
    }
  }

  // ═══════════════════════════════════════════
  //  РАБОТА С ТЕМАМИ
  // ═══════════════════════════════════════════

  function resolveTopic(topics, activeTopicId) {
    if (!activeTopicId || !topics.length) {
      return { topicName: '', thesesText: '' };
    }
    const topic = topics.find(t => t.id === activeTopicId);
    if (!topic) return { topicName: '', thesesText: '' };
    return {
      topicName: topic.name,
      thesesText: formatTheses(topic.theses),
    };
  }

  // ═══════════════════════════════════════════
  //  ОТБОР ТЕЗИСОВ (LLM)
  // ═══════════════════════════════════════════

  const SELECT_SYSTEM_PROMPT = 'Ты — помощник по отбору тезисов. Дан пост и список тезисов (нумерованных). Верни ТОЛЬКО номера (через запятую) тех тезисов, которые релевантны для формирования ответа на пост. Если ни один не подходит — верни «0». Без пояснений, только цифры.';

  function buildSelectUserMessage(postText, theses) {
    let msg = '=== ПОСТ ===\n';
    msg += postText || '(без текста)';
    msg += '\n\n=== ТЕЗИСЫ ===\n';
    theses.forEach((t, i) => {
      const q = t.question.length > 80 ? t.question.slice(0, 80) + '...' : t.question;
      const a = t.answer.length > 80 ? t.answer.slice(0, 80) + '...' : t.answer;
      msg += `${i + 1}. В: ${q} | О: ${a}\n`;
    });
    msg += '\nВерни номера релевантных тезисов через запятую:';
    return msg;
  }

  function parseThesisSelection(responseText, theses) {
    const text = responseText.trim();
    if (!text || text === '0' || text.toLowerCase() === 'none' || text.toLowerCase() === 'нет') {
      return new Set();
    }
    const numbers = text.match(/\d+/g);
    if (!numbers) return new Set(theses.map(t => t.id));
    const selected = new Set();
    for (const numStr of numbers) {
      const num = parseInt(numStr, 10);
      if (num >= 1 && num <= theses.length) {
        selected.add(theses[num - 1].id);
      }
    }
    if (selected.size === 0) return new Set(theses.map(t => t.id));
    return selected;
  }

  async function runThesisSelection(context, topic, theses) {
    const ps = getProviderSettings(cachedSettings || {});
    const prov = cachedSettings.provider || 'z-ai';
    if (!theses.length || (prov !== 'local' && !ps.apiKey) || isSelectingTheses) return;
    isSelectingTheses = true;
    setThesisSelectorLoading(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_REQUEST',
        payload: {
          provider: prov,
          apiKey: ps.apiKey,
          model: ps.customModelInput || ps.model || getDefaultModel(cachedSettings.provider),
          systemPrompt: SELECT_SYSTEM_PROMPT,
          userMessage: buildSelectUserMessage(context.postText, theses),
          baseUrl: ps.baseUrl,
          gigachatAuthKey: ps.gigachatAuthKey || '',
        },
      });

      if (response.success) {
        selectedThesisIds = parseThesisSelection(response.data, theses);
        console.log('[Commenter] LLM selected', selectedThesisIds.size, 'of', theses.length, 'theses');
      } else {
        console.warn('[Commenter] Thesis selection failed:', response.error);
 }
    } catch (err) {
      console.warn('[Commenter] Thesis selection error:', err);
    }

    isSelectingTheses = false;
    updateThesisCheckboxes();
    updatePromptFromSelection();
    setThesisSelectorLoading(false);
    updatePanelStatus(`Выбрано ${selectedThesisIds.size} из ${theses.length} тезисов`);
  }

  // ═══════════════════════════════════════════
  //  ОТБОР ТЕЗИСОВ ПО КЛЮЧЕВЫМ СЛОВАМ
  // ═══════════════════════════════════════════

  const KEYWORDS_SYSTEM_PROMPT = `Ты — помощник по извлечению ключевых слов. Дан текст поста. Верни список ключевых слов и коротких фраз (2-4 слова), которые отражают основные темы, сущности и понятия, обсуждаемые в посте.

Формат вывода — СТРОГО JSON-массив строк:
["ключевое слово 1", "фраза из двух слов", "ещё слово", ...]

Правила:
- Верни от 5 до 20 ключевых слов и коротких фраз
- Включи имена, названия, термины, темы, упоминаемые в посте
- Используй нормальную форму слов (именительный падеж, единственное число)
- Фразы из 2-4 слов бери из текста поста
- НЕ добавляй пояснения до или после JSON
- Если текст слишком короткий или бессмысленный — верни пустой массив []`;

  function parseKeywords(responseText) {
    let text = responseText.trim();
    // Strip markdown code block wrapper if present (```json ... ``` or ``` ... ```)
    const codeBlockMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m);
    if (codeBlockMatch) {
      text = codeBlockMatch[1].trim();
    }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(k => String(k).trim().toLowerCase()).filter(k => k.length >= 2);
      }
    } catch {}
    // Fallback: try to extract comma-separated words
    const cleaned = text.replace(/^\[|\]$/g, '').replace(/"/g, '');
    if (!cleaned.trim()) return [];
    return cleaned.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length >= 2);
  }

  /**
   * Поиск тезисов по ключевым словам — локально, без LLM.
   * Возвращает Set id тезисов, в которых найдено хотя бы одно ключевое слово.
   * Также возвращает Map thesisId -> Set<matchedKeywords> для подсветки.
   */
  function findThesesByKeywords(theses, keywords) {
    const matched = new Map(); // thesisId -> Set<matchedKeywords>
    for (const thesis of theses) {
      const fullText = (thesis.question + ' ' + thesis.answer).toLowerCase();
      const thesisMatches = new Set();
      for (const kw of keywords) {
        if (fullText.includes(kw)) {
          thesisMatches.add(kw);
        }
      }
      if (thesisMatches.size > 0) {
        matched.set(thesis.id, thesisMatches);
      }
    }
    return matched;
  }

  /**
   * Повторный поиск по ключевым словам с учётом disabledKeywords.
   * Вызывается при тоггле чипса ключевого слова.
   */
  function rerunKeywordMatch(theses) {
    const activeKeywords = cachedKeywords.filter(kw => !disabledKeywords.has(kw));
    if (activeKeywords.length === 0) {
      // Все ключевые слова отключены — выбираем все тезисы
      selectedThesisIds = new Set(theses.map(t => t.id));
      cachedKeywordMatches = new Map();
      return;
    }
    const matched = findThesesByKeywords(theses, activeKeywords);
    selectedThesisIds = new Set(matched.keys());
    cachedKeywordMatches = matched;
  }

  /**
   * Рендерит чипсы ключевых слов между search-bar и ts-list.
   * Каждый чипс — кликабельный тег, который можно отключить/включить.
   */
  function renderKeywordChips() {
    const panel = getPanel();
    if (!panel) return;

    // Удаляем старый контейнер если есть
    const old = panel.querySelector('.kw-chips-bar');
    if (old) old.remove();

    if (cachedKeywords.length === 0) return;

    const container = document.createElement('div');
    container.className = 'kw-chips-bar';

    const label = document.createElement('span');
    label.className = 'kw-chips-label';
    label.textContent = 'Ключевые слова:';
    container.appendChild(label);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'kw-chips-wrap';

    for (const kw of cachedKeywords) {
      const chip = document.createElement('span');
      chip.className = 'kw-chip' + (disabledKeywords.has(kw) ? ' kw-chip-off' : '');
      chip.textContent = kw;
      chip.dataset.kw = kw;

      chip.addEventListener('click', () => {
        if (disabledKeywords.has(kw)) {
          disabledKeywords.delete(kw);
          chip.classList.remove('kw-chip-off');
        } else {
          disabledKeywords.add(kw);
          chip.classList.add('kw-chip-off');
        }

        // Пересчитываем совпадения и обновляем UI
        rerunKeywordMatch(currentTopicTheses);
        updateThesisCheckboxes();
        updateThesisListHtml(panel);
        updatePromptFromSelection();
        updatePanelStatus(`Выбрано ${selectedThesisIds.size} из ${currentTopicTheses.length} тезисов`);
      });

      chipsWrap.appendChild(chip);
    }

    container.appendChild(chipsWrap);

    // Вставляем после ts-search-bar (или после ts-bar если search-bar нет)
    const searchbar = panel.querySelector('.ts-search-bar');
    const tsbar = panel.querySelector('.ts-bar');
    if (searchbar) {
      searchbar.after(container);
    } else if (tsbar) {
      tsbar.after(container);
    }
  }

  async function runKeywordSelection(context, topic, theses) {
    const ps = getProviderSettings(cachedSettings || {});
    const prov = cachedSettings.provider || 'z-ai';
    if (!theses.length || (prov !== 'local' && !ps.apiKey) || isSelectingTheses) return;
    isSelectingTheses = true;
    setThesisSelectorLoading(true, 'Извлекаю ключевые слова из поста...');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_REQUEST',
        payload: {
          provider: prov,
          apiKey: ps.apiKey,
          model: ps.customModelInput || ps.model || getDefaultModel(cachedSettings.provider),
          systemPrompt: KEYWORDS_SYSTEM_PROMPT,
          userMessage: context.postText || '(без текста)',
          baseUrl: ps.baseUrl,
          gigachatAuthKey: ps.gigachatAuthKey || '',
        },
      });

      if (response.success) {
        const keywords = parseKeywords(response.data);
        console.log('[Commenter] Keywords extracted:', keywords.join(', '));

        // Сохраняем все ключевые слова и сбрасываем disabled
        cachedKeywords = keywords;
        disabledKeywords = new Set();

        if (keywords.length === 0) {
          // Нет ключевых слов — выбираем все
          selectedThesisIds = new Set(theses.map(t => t.id));
          cachedKeywordMatches = new Map();
          console.log('[Commenter] No keywords found, selecting all theses');
        } else {
          rerunKeywordMatch(theses);
          console.log('[Commenter] Keyword search matched', selectedThesisIds.size, 'of', theses.length, 'theses');
        }

        // Рендерим чипсы ключевых слов
        renderKeywordChips();
      } else {
        console.warn('[Commenter] Keyword extraction failed:', response.error);
      }
    } catch (err) {
      console.warn('[Commenter] Keyword extraction error:', err);
    }

    isSelectingTheses = false;
    updateThesisCheckboxes();
    updateThesisListHtml(getPanel());
    updatePromptFromSelection();
    setThesisSelectorLoading(false);
    updatePanelStatus(`Выбрано ${selectedThesisIds.size} из ${theses.length} тезисов`);
  }

  /**
   * Пересобрать промпт при смене темы в дропдауне.
   */
  async function rebuildPromptWithTopic(topicId) {
    if (!cachedContext || !cachedSettings) return;

    const topic = cachedTopics.find(t => t.id === topicId);
    currentTopicTheses = topic ? (topic.theses || []) : [];

    // Обновляем заголовок и счётчик
    const panel = getPanel();
    if (!panel) return;

    const title = panel.querySelector('.panel-title');
    if (title) {
      const badge = title.querySelector('.panel-badge');
      const badgeHtml = badge ? badge.outerHTML : '<span class="panel-badge badge-prompt">Промпт</span>';
      title.innerHTML = badgeHtml + ' ' + escapeHtml(
        topic ? 'Тема: ' + topic.name : 'Тема не выбрана'
      );
    }

    const thesesCountEl = panel.querySelector('.topic-theses-count');
    if (thesesCountEl) {
      const count = currentTopicTheses.length;
      thesesCountEl.textContent = count > 0 ? `${count} тез.` : 'нет тезисов';
      thesesCountEl.style.color = count > 0 ? '#4ade80' : '#71717a';
    }

    // Сохраняем выбранную тему
    saveSettings({ ...cachedSettings, activeTopicId: topicId });
    cachedSettings = { ...cachedSettings, activeTopicId: topicId };

    if (currentTopicTheses.length === 0) {
      selectedThesisIds = new Set();
      updateThesisListHtml(panel);
      updatePromptFromSelection();
      return;
    }

    // Обновляем список тезисов с чекбоксами
    updateThesisListHtml(panel);

    // Если автоотбор — запускаем LLM
    const provSettings2 = getProviderSettings(cachedSettings);
    const prov2 = cachedSettings.provider || 'z-ai';
    if (cachedSettings.thesisAutoSelect && (prov2 === 'local' || prov2 === 'gigachat' || provSettings2.apiKey)) {
      const mode = cachedSettings.thesisSelectionMode || 'full';
      selectedThesisIds = new Set(); // сбрасываем перед LLM
      cachedKeywordMatches = new Map();
      cachedKeywords = [];
      disabledKeywords = new Set();
      // Удаляем старые чипсы
      getPanel()?.querySelector('.kw-chips-bar')?.remove();
      updateThesisCheckboxes();
      updateThesisListHtml(panel);
      updatePromptFromSelection();
      if (mode === 'keywords') {
        await runKeywordSelection(cachedContext, topic, currentTopicTheses);
      } else {
        await runThesisSelection(cachedContext, topic, currentTopicTheses);
      }
    } else {
      selectedThesisIds = new Set(currentTopicTheses.map(t => t.id));
      updateThesisCheckboxes();
      updatePromptFromSelection();
    }
  }

  // ═══════════════════════════════════════════
  //  ПАНЕЛЬ ПРОМПТА С ЧЕКБОКСАМИ ТЕЗИСОВ
  // ═══════════════════════════════════════════

  function showPromptPanel(context, topics, activeTopicId, topic, theses, selectedIds, isLoading) {
    ensurePanel();
    const panel = getPanel();
    if (!panel) return;

    // Topic options
    const optionsHtml = ['<option value="">— без темы —</option>']
      .concat(topics.map(t => {
        const cnt = (t.theses || []).length;
        const label = cnt > 0 ? `${t.name} (${cnt} тез.)` : t.name;
        const selected = t.id === activeTopicId ? ' selected' : '';
        return `<option value="${escapeHtml(t.id)}"${selected}>${escapeHtml(label)}</option>`;
      }))
      .join('');

    const thesesCount = theses.length;
    const selectedCount = selectedIds.size;
    const countColor = thesesCount > 0 ? '#4ade80' : '#71717a';
    const countText = thesesCount > 0 ? `${thesesCount} тез.` : 'нет тезисов';

    // Thesis items HTML
    const thesisItemsHtml = theses.map((t, i) => {
      const checked = selectedIds.has(t.id) ? ' checked' : '';
      const qShort = escapeHtml(t.question.length > 55 ? t.question.slice(0, 55) + '...' : t.question);
      const aShort = escapeHtml(t.answer.length > 55 ? t.answer.slice(0, 55) + '...' : t.answer);
      return `<label class="ts-item${selectedIds.has(t.id) ? ' ts-checked' : ''}">
        <input type="checkbox" class="ts-cb" data-tid="${escapeHtml(t.id)}"${checked}>
        <span class="ts-text"><strong>${i + 1}.</strong> В: ${qShort} | О: ${aShort}</span>
      </label>`;
    }).join('');

    // Template options
    const templates = cachedSettings.templates || [];
    const activeTemplateId = cachedSettings.activeTemplateId || '';
    const currentActiveTpl = templates.find(t => t.isActive) || templates[0];
    const tplOptionsHtml = templates.map(t => {
      const isActive = t.id === (currentActiveTpl?.id) || t.id === activeTemplateId;
      const selected = isActive ? ' selected' : '';
      return `<option value="${escapeHtml(t.id)}"${selected}>${isActive ? '\u2605 ' : ''}${escapeHtml(t.name)}</option>`;
    }).join('');

    const loadingHtml = isLoading ? '<span class="ts-loading"><span class="loading-spinner"></span>Анализирую тезисы...</span>' : '';

    // ── Model selector ──
    const curModelInfo = getCurrentModelAndProvider(cachedSettings);
    panelProvider = curModelInfo.provider;
    panelModel = curModelInfo.model;

    const zaiModels = getModelsForProvider(cachedSettings, 'z-ai');
    const gcModels = getModelsForProvider(cachedSettings, 'gigachat');
    const localModels = getModelsForProvider(cachedSettings, 'local');
    const orModels = getModelsForProvider(cachedSettings, 'openrouter');

    const zaiOptions = zaiModels.map(m => {
      const sel = (panelProvider === 'z-ai' && panelModel === m.id) ? ' selected' : '';
      return `<option value="z-ai:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
    }).join('');

    const localOptions = localModels.map(m => {
      const sel = (panelProvider === 'local' && panelModel === m.id) ? ' selected' : '';
      return `<option value="local:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
    }).join('');

    const gcOptions = gcModels.map(m => {
      const sel = (panelProvider === 'gigachat' && panelModel === m.id) ? ' selected' : '';
      return `<option value="gigachat:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
    }).join('');

    const orOptions = orModels.map(m => {
      const sel = (panelProvider === 'openrouter' && panelModel === m.id) ? ' selected' : '';
      return `<option value="openrouter:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
    }).join('');

    // Если текущая модель не найдена в списке — добавляем её отдельно
    let customModelOption = '';
    const currentPs = getProviderSettings(cachedSettings);
    if (currentPs.customModelInput) {
      const isInList = [...zaiModels, ...gcModels, ...localModels, ...orModels].some(m => m.id === currentPs.customModelInput);
      if (!isInList) {
        customModelOption = `<option value="${escapeHtml(panelProvider)}:${escapeHtml(currentPs.customModelInput)}" selected>${escapeHtml(currentPs.customModelInput)} (custom)</option>`;
      }
    }

    const providerLabel = panelProvider === 'openrouter' ? 'OR' : panelProvider === 'local' ? 'Local' : panelProvider === 'gigachat' ? 'GC' : 'z-ai';
    const providerColor = panelProvider === 'openrouter' ? '#60a5fa' : panelProvider === 'local' ? '#f59e0b' : panelProvider === 'gigachat' ? '#21c55d' : '#4ade80';

    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <span class="panel-badge badge-prompt">Промпт</span>
          ${escapeHtml(topic ? 'Тема: ' + topic.name : 'Тема не выбрана')}
        </div>
        <div class="panel-actions">
          <button class="panel-btn panel-btn-primary btn-copy-panel">Копировать</button>
          <button class="panel-btn btn-close-panel">✕</button>
        </div>
      </div>
      <div class="model-bar">
        <label for="model-selector">Модель:</label>
        <select class="model-select" id="model-selector">
          ${customModelOption}
          <optgroup label="z-ai">${zaiOptions}</optgroup>
          <optgroup label="GigaChat">${gcOptions}</optgroup>
          <optgroup label="Local">${localOptions}</optgroup>
          <optgroup label="OpenRouter">${orOptions}</optgroup>
        </select>
        <span class="model-provider-badge" style="color:${providerColor}">${providerLabel}</span>
      </div>
      <div class="tpl-bar">
        <label for="template-selector">Шаблон:</label>
        <select class="tpl-select" id="template-selector">${tplOptionsHtml}</select>
      </div>
      <div class="topic-bar">
        <label for="topic-selector">Тема:</label>
        <select class="topic-select" id="topic-selector">${optionsHtml}</select>
        <span class="topic-theses-count" style="color:${countColor}">${countText}</span>
      </div>
      <div class="ts-bar">
        <span class="ts-title">Тезисы (<span class="ts-count">${selectedCount}</span> из ${thesesCount}):</span>
        <div class="ts-actions">
          <button class="panel-btn btn-ts-all">Все</button>
          <button class="panel-btn btn-ts-none">Снять</button>
        </div>
      </div>
      <div class="ts-search-bar">
        <input type="text" class="ts-search-input" id="ts-search-input" placeholder="Поиск по тезисам...">
        <span class="ts-search-count" id="ts-search-count"></span>
      </div>
      ${loadingHtml}
      <div class="ts-list">${thesisItemsHtml}</div>
      <div class="panel-body">
        <details class="sp-details">
          <summary class="sp-summary">Системный промпт</summary>
          <pre id="sp-display" class="sp-pre">${escapeHtml('Загрузка...')}</pre>
        </details>
        <div class="um-section">
          <div class="um-header">
            <label class="um-label">Контекст (можно редактировать):</label>
            <button class="panel-btn btn-um-reset" id="btn-um-reset" style="display:none" title="Сбросить к оригиналу">&#x21BA; Сброс</button>
          </div>
          <textarea id="um-editor" class="form-textarea um-editor" rows="8" placeholder="Контекст поста появится здесь...">${escapeHtml(lastBuiltPrompt?.userMessage || '')}</textarea>
        </div>
      </div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — сбор &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> — тезис
      </div>
    `;

    // Event: model change
    panel.querySelector('#model-selector')?.addEventListener('change', async (e) => {
      const val = e.target.value;
      const colonIdx = val.indexOf(':');
      if (colonIdx === -1) return;
      const newProvider = val.slice(0, colonIdx);
      const newModel = val.slice(colonIdx + 1);

      panelProvider = newProvider;
      panelModel = newModel;

      // Update cachedSettings and persist
      cachedSettings.provider = newProvider;
      if (!cachedSettings.providers[newProvider]) {
        cachedSettings.providers[newProvider] = { apiKey: '', model: '', customModelInput: '' };
      }
      cachedSettings.providers[newProvider].model = newModel;
      cachedSettings.providers[newProvider].customModelInput = '';
      await saveSettings(cachedSettings);

      // Update provider badge
      const badge = panel.querySelector('.model-provider-badge');
      if (badge) {
        badge.textContent = newProvider === 'openrouter' ? 'OR' : newProvider === 'local' ? 'Local' : newProvider === 'gigachat' ? 'GC' : 'z-ai';
        badge.style.color = newProvider === 'openrouter' ? '#60a5fa' : newProvider === 'local' ? '#f59e0b' : newProvider === 'gigachat' ? '#21c55d' : '#4ade80';
      }

      console.log('[Commenter] Model changed:', newProvider, newModel);
    });

    // Event: template change
    panel.querySelector('#template-selector')?.addEventListener('change', (e) => {
      cachedSettings.activeTemplateId = e.target.value;
      setActiveTemplate(e.target.value);
      updatePromptFromSelection();
    });

    // Event: topic change
    panel.querySelector('#topic-selector')?.addEventListener('change', (e) => {
      rebuildPromptWithTopic(e.target.value);
    });

    // Event: thesis checkboxes (delegation)
    panel.querySelector('.ts-list')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('ts-cb')) {
        const tid = e.target.dataset.tid;
        if (e.target.checked) selectedThesisIds.add(tid);
        else selectedThesisIds.delete(tid);
        e.target.closest('.ts-item').classList.toggle('ts-checked', e.target.checked);
        const countEl = panel.querySelector('.ts-count');
        if (countEl) countEl.textContent = selectedThesisIds.size;
        updatePromptFromSelection();
      }
    });

    // Event: select all / none
    panel.querySelector('.btn-ts-all')?.addEventListener('click', () => {
      selectedThesisIds = new Set(currentTopicTheses.map(t => t.id));
      updateThesisCheckboxes();
      updatePromptFromSelection();
    });
    panel.querySelector('.btn-ts-none')?.addEventListener('click', () => {
      selectedThesisIds.clear();
      updateThesisCheckboxes();
      updatePromptFromSelection();
    });

    // Event: search filter
    panel.querySelector('#ts-search-input')?.addEventListener('input', (e) => {
      updateThesisListHtml(panel);
    });

    // Event: copy
    panel.querySelector('.btn-copy-panel')?.addEventListener('click', () => {
      if (lastBuiltPrompt) {
        const fp = `[Системный промпт]\n${lastBuiltPrompt.systemPrompt}\n\n[Контекст поста]\n${lastBuiltPrompt.userMessage}`;
        navigator.clipboard.writeText(fp).catch(() => {});
        const btn = panel.querySelector('.btn-copy-panel');
        btn.textContent = 'Скопировано!';
        btn.classList.add('btn-copied');
        setTimeout(() => { btn.textContent = 'Копировать'; btn.classList.remove('btn-copied'); }, 1500);
      }
    });

    panel.querySelector('.btn-close-panel')?.addEventListener('click', hidePanel);

    // Event: user message edit
    const umEditor = panel.querySelector('#um-editor');
    if (umEditor) {
      umEditor.addEventListener('input', () => {
        isUserMessageEdited = true;
        if (lastBuiltPrompt) {
          lastBuiltPrompt.userMessage = umEditor.value;
        }
        const resetBtn = panel.querySelector('#btn-um-reset');
        if (resetBtn) resetBtn.style.display = '';
      });
      panel.querySelector('#btn-um-reset')?.addEventListener('click', () => {
        isUserMessageEdited = false;
        if (cachedContext && lastBuiltPrompt) {
          const userMessage = formatUserMessage(cachedContext);
          lastBuiltPrompt.userMessage = userMessage;
          umEditor.value = userMessage;
        }
        const resetBtn = panel.querySelector('#btn-um-reset');
        if (resetBtn) resetBtn.style.display = 'none';
      });
    }

    // Build initial prompt text
    updatePromptFromSelection();
  }

  function updateThesisListHtml(panel) {
    const listEl = panel?.querySelector('.ts-list');
    if (!listEl) return;

    const searchInput = panel.querySelector('#ts-search-input');
    const searchCountEl = panel.querySelector('#ts-search-count');
    const searchText = (searchInput?.value || '').trim().toLowerCase();
    const searchTerms = searchText ? searchText.split(/\s+/).filter(w => w.length >= 2) : [];

    let visibleCount = 0;
    const totalCount = currentTopicTheses.length;

    listEl.innerHTML = currentTopicTheses.map((t, i) => {
      const checked = selectedThesisIds.has(t.id) ? ' checked' : '';

      // Determine if this thesis matches the search
      const fullText = (t.question + ' ' + t.answer).toLowerCase();
      let matchesSearch = true;
      if (searchTerms.length > 0) {
        matchesSearch = searchTerms.every(term => fullText.includes(term));
      }
      if (!matchesSearch && searchText.length > 0 && searchText.length < 2) {
        // Single character — still show all
        matchesSearch = true;
      }

      // Keyword matches for highlighting
      const kwMatches = cachedKeywordMatches.get(t.id);
      const allHighlightTerms = new Set([...(kwMatches || []), ...searchTerms]);

      // Build displayed text with highlighting
      let qShort = t.question.length > 55 ? t.question.slice(0, 55) + '...' : t.question;
      let aShort = t.answer.length > 55 ? t.answer.slice(0, 55) + '...' : t.answer;

      if (allHighlightTerms.size > 0) {
        qShort = highlightTerms(qShort, allHighlightTerms);
        aShort = highlightTerms(aShort, allHighlightTerms);
      } else {
        qShort = escapeHtml(qShort);
        aShort = escapeHtml(aShort);
      }

      const hiddenStyle = (!matchesSearch && searchTerms.length > 0) ? ' style="display:none"' : '';
      if (matchesSearch || searchTerms.length === 0) visibleCount++;

      return `<label class="ts-item${selectedThesisIds.has(t.id) ? ' ts-checked' : ''}"${hiddenStyle}>
        <input type="checkbox" class="ts-cb" data-tid="${escapeHtml(t.id)}"${checked}>
        <span class="ts-text"><strong>${i + 1}.</strong> В: ${qShort} | О: ${aShort}</span>
      </label>`;
    }).join('');

    // Update search count
    if (searchCountEl) {
      if (searchTerms.length > 0) {
        searchCountEl.textContent = `${visibleCount} из ${totalCount}`;
      } else {
        searchCountEl.textContent = '';
      }
    }

    // Rebind events
    listEl.addEventListener('change', (e) => {
      if (e.target.classList.contains('ts-cb')) {
        const tid = e.target.dataset.tid;
        if (e.target.checked) selectedThesisIds.add(tid);
        else selectedThesisIds.delete(tid);
        e.target.closest('.ts-item').classList.toggle('ts-checked', e.target.checked);
        const panel = getPanel();
        const countEl = panel?.querySelector('.ts-count');
        if (countEl) countEl.textContent = selectedThesisIds.size;
        updatePromptFromSelection();
      }
    });
    const countEl = panel.querySelector('.ts-count');
    if (countEl) countEl.textContent = selectedThesisIds.size;
  }

  /**
   * Подсветка совпадающих терминов в тексте.
   * Оборачивает совпадения в <mark> тег.
   */
  function highlightTerms(text, terms) {
    let html = escapeHtml(text);
    for (const term of terms) {
      const escapedTerm = escapeHtml(term);
      const regex = new RegExp('(' + escapeRegex(escapedTerm) + ')', 'gi');
      html = html.replace(regex, '<mark class="ts-hl">$1</mark>');
    }
    return html;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function updateThesisCheckboxes() {
    const panel = getPanel();
    if (!panel) return;
    panel.querySelectorAll('.ts-cb').forEach(cb => {
      const isChecked = selectedThesisIds.has(cb.dataset.tid);
      cb.checked = isChecked;
      cb.closest('.ts-item')?.classList.toggle('ts-checked', isChecked);
    });
    const countEl = panel.querySelector('.ts-count');
    if (countEl) countEl.textContent = selectedThesisIds.size;
  }

  function setThesisSelectorLoading(loading, customText) {
    const panel = getPanel();
    if (!panel) return;
    let el = panel.querySelector('.ts-loading');
    if (loading && !el) {
      el = document.createElement('div');
      el.className = 'ts-loading';
      el.innerHTML = '<span class="loading-spinner"></span>' + escapeHtml(customText || 'Анализирую тезисы...');
      const bar = panel.querySelector('.ts-bar');
      if (bar) bar.after(el);
    } else if (!loading && el) {
      el.remove();
    }
  }

  function updatePromptFromSelection() {
    if (!cachedContext || !cachedSettings) return;
    const topicName = cachedTopics.find(t => t.id === cachedSettings.activeTopicId)?.name || 'Общая тема';
    // Фильтруем только выбранные тезисы
    const selectedTheses = currentTopicTheses.filter(t => selectedThesisIds.has(t.id));
    const thesesText = formatTheses(selectedTheses);
    const templates = cachedSettings.templates || [];
    const activeTpl = templates.find(t => t.id === cachedSettings.activeTemplateId) || templates.find(t => t.isActive) || templates[0];
    const promptTemplate = activeTpl?.content || DEFAULT_SYSTEM_PROMPT;
    const systemPrompt = buildSystemPrompt(promptTemplate, topicName, thesesText);
    const userMessage = formatUserMessage(cachedContext);
    lastBuiltPrompt = { systemPrompt, userMessage, context: cachedContext };
    // Update UI elements
    const panel = getPanel();
    const spPre = panel?.querySelector('#sp-display');
    if (spPre) {
      spPre.textContent = systemPrompt;
    }
    // Update user message editor only if user hasn't manually edited it
    const umEditor = panel?.querySelector('#um-editor');
    if (umEditor && !isUserMessageEdited) {
      umEditor.value = userMessage;
    }
  }

  // ═══════════════════════════════════════════
  //  ШАГ 3: НОВЫЙ ТЕЗИС (Ctrl+Shift+N)
  // ═══════════════════════════════════════════

  async function handleNewThesis() {
    const topics = await getTopics();
    const settings = await getSettings();
    const activeTopicId = settings.activeTopicId || '';

    // Попробовать получить текст из буфера обмена
    let clipboardText = '';
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (err) {
      console.warn('[Commenter] Clipboard read failed:', err);
    }

    showThesisForm(topics, activeTopicId, clipboardText);
  }

  function showThesisForm(topics, activeTopicId, clipboardText) {
    ensurePanel();

    const panel = getPanel();
    if (!panel) return;

    // Build topic options
    const optionsHtml = ['<option value="__new__">+ Новая тема</option>']
      .concat(topics.map(t => {
        const cnt = (t.theses || []).length;
        const label = cnt > 0 ? `${t.name} (${cnt} тез.)` : t.name;
        const selected = t.id === activeTopicId ? ' selected' : '';
        return `<option value="${escapeHtml(t.id)}"${selected}>${escapeHtml(label)}</option>`;
      }))
      .join('');

    const clipPreview = clipboardText
      ? escapeHtml(clipboardText.slice(0, 300)) + (clipboardText.length > 300 ? '...' : '')
      : '';

    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <span class="panel-badge badge-new">+ Тезис</span>
          Новый тезис
        </div>
        <div class="panel-actions">
          <button class="panel-btn btn-close-panel">✕</button>
        </div>
      </div>
      <div class="thesis-form">
        <div class="form-row">
          <label for="thesis-topic">Тема</label>
          <select class="form-select" id="thesis-topic">${optionsHtml}</select>
        </div>
        <div class="form-row form-row-new-topic" style="display:none">
          <label for="thesis-new-topic-name">Название темы</label>
          <input type="text" class="form-input" id="thesis-new-topic-name" placeholder="Название новой темы...">
        </div>
        <div class="form-row">
          <label for="thesis-question">Вопрос</label>
          <textarea class="form-textarea" id="thesis-question" rows="2" placeholder="Вопрос / тезис...">${clipPreview}</textarea>
        </div>
        <div class="form-row">
          <label for="thesis-answer">Ответ</label>
          <textarea class="form-textarea" id="thesis-answer" rows="3" placeholder="Ответ / аргумент..."></textarea>
        </div>
        ${clipboardText ? `<div class="clipboard-hint">Из буфера обмена вставлен в поле "Вопрос". Переместите текст при необходимости.</div>` : '<div class="clipboard-hint">Буфер обмена пуст. Скопируйте текст на странице (Ctrl+C), затем откройте форму.</div>'}
        <div class="form-actions">
          <button class="panel-btn panel-btn-save btn-save-thesis">Сохранить тезис</button>
          <button class="panel-btn btn-clear-form">Очистить</button>
        </div>
        <div class="thesis-status"></div>
      </div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> — новый тезис &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — промпт &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация
      </div>
    `;

    // Show/hide new topic input
    const topicSelect = panel.querySelector('#thesis-topic');
    const newTopicRow = panel.querySelector('.form-row-new-topic');
    const newTopicInput = panel.querySelector('#thesis-new-topic-name');

    topicSelect.addEventListener('change', () => {
      newTopicRow.style.display = topicSelect.value === '__new__' ? '' : 'none';
      if (topicSelect.value === '__new__') newTopicInput.focus();
    });

    // Clear form
    panel.querySelector('.btn-clear-form')?.addEventListener('click', () => {
      panel.querySelector('#thesis-question').value = '';
      panel.querySelector('#thesis-answer').value = '';
      if (topicSelect.value === '__new__') newTopicInput.value = '';
    });

    // Save thesis
    panel.querySelector('.btn-save-thesis')?.addEventListener('click', async () => {
      const question = panel.querySelector('#thesis-question').value.trim();
      const answer = panel.querySelector('#thesis-answer').value.trim();

      if (!question && !answer) {
        showThesisStatus(panel, 'Заполните хотя бы одно поле: вопрос или ответ.', 'error');
        return;
      }

      let topicId = topicSelect.value;
      let topicName = '';

      // Create new topic if needed
      if (topicId === '__new__') {
        topicName = newTopicInput.value.trim();
        if (!topicName) {
          showThesisStatus(panel, 'Введите название новой темы.', 'error');
          newTopicInput.focus();
          return;
        }
        // Check duplicate topic name
        if (topics.some(t => t.name.toLowerCase() === topicName.toLowerCase())) {
          showThesisStatus(panel, 'Тема с таким названием уже существует. Выберите её из списка.', 'error');
          return;
        }
        topicId = generateId();
        const newTopic = { id: topicId, name: topicName, theses: [] };
        topics.push(newTopic);
        console.log('[Commenter] New topic created:', topicName);
      } else {
        const topic = topics.find(t => t.id === topicId);
        if (!topic) {
          showThesisStatus(panel, 'Тема не найдена. Попробуйте снова.', 'error');
          return;
        }
        topicName = topic.name;
      }

      // Add thesis to topic
      const targetTopic = topics.find(t => t.id === topicId);
      if (!targetTopic.theses) targetTopic.theses = [];
      const newThesis = {
        id: generateId(),
        question: question,
        answer: answer,
      };
      targetTopic.theses.push(newThesis);

      // Save to storage
      await saveTopics(topics);

      // Update active topic
      const settings = await getSettings();
      await saveSettings({ ...settings, activeTopicId: topicId });

      const thesisNum = targetTopic.theses.length;
      showThesisStatus(panel,
        `Тезис #${thesisNum} добавлен в тему "${topicName}"`,
        'success'
      );

      // Clear fields for quick entry of next thesis
      panel.querySelector('#thesis-question').value = '';
      panel.querySelector('#thesis-answer').value = '';

      console.log('[Commenter] Thesis saved:', { topic: topicName, question: question?.slice(0, 60), answer: answer?.slice(0, 60) });
    });

    // Close
    panel.querySelector('.btn-close-panel')?.addEventListener('click', hidePanel);
  }

  function showThesisStatus(panel, text, type) {
    const statusEl = panel.querySelector('.thesis-status');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'thesis-status thesis-status-' + type;
  }

  // ═══════════════════════════════════════════
  //  ИЗВЛЕЧЕНИЕ КОНТЕКСТА ИЗ VK DOM (2025 redesign)
  // ═══════════════════════════════════════════

  /**
   * Найти родительский пост от поля ввода комментария.
   *
   * Реальная структура VK 2025:
   *   div[data-testid="post"][data-post-id="-38612614_114815"]
   *     ├── ... заголовок поста ...
   *     │   └── a[data-testid="post-header-title"]  (автор)
   *     ├── ... текст поста ...
   *     │   └── div[data-testid="showmoretext"]
   *     │       └── [class*="vkitFeedShowMoreText__text"]  (текст)
   *     ├── ... блок комментариев ...
   *     │   ├── div[data-testid="wall_comments_comment_root"]
   *     │   │   ├── a ... div[data-testid="comment-owner"]  (автор коммента)
   *     │   │   ├── div[data-testid="comment-text"]
   *     │   │   │   └── [class*="vkitFeedShowMoreText__text"]  (текст коммента)
   *     │   │   └── ... div[class*="vkitCommentReplyTarget"]  (ответ для...)
   *     │   └── div[data-testid="wall_comments_comment_root"] ...
   *     └── ... поле ввода комментария ...
   *         └── div[contenteditable="true"][data-testid="content-editable-input"]
   *
   * Пост также может быть внутри #post-layer (попап при открытии).
   */
  function extractPostContext(commentField) {
    // Стратегия 1: closest() — поле ввода внутри поста
    // VK 2025: commentField → ... → div[data-testid="post"]
    const postEl = commentField.closest('[data-testid="post"]');

    if (postEl) {
      console.log('[Commenter] Found post via closest:', postEl.getAttribute('data-post-id'));
      return extractFromPost(postEl);
    }

    // Стратегия 2: post-layer (попап)
    const postLayer = document.getElementById('post-layer');
    if (postLayer) {
      const postInLayer = postLayer.querySelector('[data-testid="post"]');
      if (postInLayer) {
        console.log('[Commenter] Found post in post-layer:', postInLayer.getAttribute('data-post-id'));
        return extractFromPost(postInLayer);
      }
    }

    // Стратегия 3: поиск по data-post-id в предках (более широкий поиск)
    let ancestor = commentField.parentElement;
    while (ancestor && ancestor !== document.body) {
      if (ancestor.hasAttribute('data-post-id')) {
        console.log('[Commenter] Found post via data-post-id ancestor:', ancestor.getAttribute('data-post-id'));
        return extractFromPost(ancestor);
      }
      ancestor = ancestor.parentElement;
    }

    console.warn('[Commenter] Post element not found');
    return null;
  }

  function extractFromPost(postEl) {
    // --- postId ---
    const postId = postEl.getAttribute('data-post-id') || postEl.id || 'unknown';

    // --- Автор поста ---
    const authorEl = postEl.querySelector('[data-testid="post-header-title"]');
    const authorName = authorEl?.textContent?.trim() || 'Неизвестный автор';

    // --- Текст поста ---
    // Используем data-testid вместо хэшированных классов
    // Текст внутри div[data-testid="showmoretext"]
    const postText = extractTextFromShowMore(postEl.querySelector('[data-testid="showmoretext"]'));

    // --- Reply-to контекст (если отвечаем на конкретный комментарий) ---
    const replyToName = extractReplyToName(postEl);

    // --- Комментарии ---
    const comments = extractComments(postEl);

    return { postId, authorName, postText, comments, replyToName };
  }

  /**
   * Извлечь текст из элемента showmoretext.
   * VK использует div[data-testid="showmoretext"] > div с классом vkitFeedShowMoreText__text<hash>
   * Мы ищем любой элемент, чей класс содержит "vkitFeedShowMoreText__text"
   */
  function extractTextFromShowMore(showMoreEl) {
    if (!showMoreEl) return '';
    // vk.ru (2025+): текст внутри вложенного div[data-testid="showmoretext-in"]
    const innerEl = showMoreEl.querySelector('[data-testid="showmoretext-in"]');
    if (innerEl) {
      return innerEl.textContent.trim();
    }
    // vk.com (старый): дочерний элемент с классом содержащим vkitFeedShowMoreText__text
    const textEl = showMoreEl.querySelector('[class*="vkitFeedShowMoreText__text"]');
    if (textEl) {
      return textEl.textContent.trim();
    }
    // Фоллбэк: просто берём текст из showmoretext
    return showMoreEl.textContent.trim();
  }

  /**
   * Извлечь комментарии из поста.
   * Каждый комментарий: div[data-testid="wall_comments_comment_root"]
   */
  function extractComments(postEl) {
    const comments = [];

    // Все корневые комментарии
    const rootCommentEls = postEl.querySelectorAll(':scope > div [data-testid="wall_comments_comment_root"]');

    // Если не нашли через :scope, ищем глобально внутри поста
    const commentEls = rootCommentEls.length > 0
      ? rootCommentEls
      : postEl.querySelectorAll('[data-testid="wall_comments_comment_root"]');

    commentEls.forEach(commentEl => {
      // --- Автор комментария ---
      const authorEl = commentEl.querySelector('[data-testid="comment-owner"]');
      const author = authorEl?.textContent?.trim() || '';

      // --- Текст комментария ---
      // div[data-testid="comment-text"] > [class*="vkitFeedShowMoreText__text"]
      const commentTextContainer = commentEl.querySelector('[data-testid="comment-text"]');
      const text = extractTextFromShowMore(commentTextContainer);

      // --- Reply-to контекст этого комментария ---
      const replyTo = extractReplyToName(commentEl);

      if (author || text) {
        comments.push({ author, text, replyTo });
      }
    });

    return comments;
  }

  /**
   * Извлечь имя replied-to из блока "ответ Имя".
   * VK показывает div с классом содержащим "vkitCommentReplyTarget",
   * внутри которого текст вида "ответ Алле".
   */
  function extractReplyToName(containerEl) {
    // VK 2025 (vk.ru): ищем data-testid="comment-reply-to"
    const replyToEl = containerEl.querySelector('[data-testid="comment-reply-to"]');
    if (replyToEl) {
      const text = replyToEl.textContent.trim();
      const match = text.match(/(?:ответ[уе]?)\s+(.+)/i);
      return match ? match[1].trim() : text;
    }
    // VK (старый): ищем элемент с классом vkitCommentReplyTarget
    const replyTargetEl = containerEl.querySelector('[class*="vkitCommentReplyTarget"]');
    if (replyTargetEl) {
      const text = replyTargetEl.textContent.trim();
      const match = text.match(/(?:ответ[уе]?)\s+(.+)/i);
      return match ? match[1].trim() : text;
    }
    return null;
  }

  /**
   * Отладка: показать путь от поля ввода к верхнему DOM для диагностики
   */
  function debugFieldPath(field) {
    const path = [];
    let el = field;
    while (el && el !== document.body && path.length < 15) {
      const tag = el.tagName.toLowerCase();
      const testId = el.getAttribute('data-testid') || '';
      const postId = el.getAttribute('data-post-id') || '';
      const classes = (el.className && typeof el.className === 'string')
        ? el.className.split(' ').filter(c => c.length < 50).slice(0, 3).join('.')
        : '';
      let desc = tag;
      if (testId) desc += `[data-testid="${testId}"]`;
      if (postId) desc += `[data-post-id="${postId}"]`;
      if (classes && !testId) desc += `.${classes}`;
      path.push(desc);
      el = el.parentElement;
    }
    return 'Путь от поля ввода:\n' + path.join('\n  → ');
  }

  // ═══════════════════════════════════════════
  //  ХРАНИЛИЩЕ (content script helpers)
  // ═══════════════════════════════════════════

  async function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get('commenter_settings', result => {
        resolve(result.commenter_settings || { provider: 'z-ai', providers: { 'z-ai': { apiKey: '', model: '', customModelInput: '' }, 'openrouter': { apiKey: '', model: '', customModelInput: '' } } });
      });
    });
  }

  function getProviderSettings(settings) {
    return settings.providers?.[settings.provider || 'z-ai'] || { apiKey: '', model: '', customModelInput: '' };
  }

  async function saveSettings(settings) {
    return new Promise(resolve => {
      chrome.storage.local.set({ commenter_settings: settings }, resolve);
    });
  }

  async function getTopics() {
    return new Promise(resolve => {
      chrome.storage.local.get('commenter_topics', result => {
        resolve(result.commenter_topics || []);
      });
    });
  }

  async function saveTopics(topics) {
    return new Promise(resolve => {
      chrome.storage.local.set({ commenter_topics: topics }, resolve);
    });
  }

  async function getTemplates() {
    return new Promise(async resolve => {
      const result = await chrome.storage.local.get('commenter_templates');
      let templates = result.commenter_templates;
      if (!templates || templates.length === 0) {
        // Миграция: если шаблонов нет, создать дефолтный
        templates = [{
          id: '__default_expert__',
          name: 'Эксперт (по умолчанию)',
          content: DEFAULT_SYSTEM_PROMPT,
          isActive: true,
        }];
        await chrome.storage.local.set({ commenter_templates: templates });
      }
      resolve(templates);
    });
  }

  async function setActiveTemplate(id) {
    const templates = await getTemplates();
    templates.forEach(t => { t.isActive = (t.id === id); });
    return new Promise(resolve => {
      chrome.storage.local.set({ commenter_templates: templates }, resolve);
    });
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function getDefaultModel(provider) {
    return provider === 'openrouter' ? 'google/gemini-2.0-flash-001' : 'GLM-4.7-Flash';
  }

  function getModelsForProvider(settings, providerName) {
    const p = providerName || 'z-ai';
    const ps = settings.providers?.[p];
    if (ps && ps.models && ps.models.length > 0) return ps.models;
    return DEFAULT_MODELS[p] || [];
  }

  /**
   * Найти провайдера по modelId — ищем во всех списках моделей.
   * Возвращает { provider, model } или null.
   */
  function findProviderForModel(modelId, settings) {
    for (const pName of ['z-ai', 'openrouter']) {
      const models = getModelsForProvider(settings, pName);
      if (models.some(m => m.id === modelId)) {
        return { provider: pName, model: modelId };
      }
    }
    return null;
  }

  /**
   * Получить текущую модель и провайдера из настроек.
   */
  function getCurrentModelAndProvider(settings) {
    const provider = settings.provider || 'z-ai';
    const ps = getProviderSettings(settings);
    const model = ps.customModelInput || ps.model || getDefaultModel(provider);
    return { provider, model };
  }

  // ═══════════════════════════════════════════
  //  ФОРМИРОВАНИЕ ТЕКСТА
  // ═══════════════════════════════════════════

  function buildSystemPrompt(template, topicName, thesesText) {
    return template
      .replace(/\{\{topic\}\}/g, topicName)
      .replace(/\{\{theses\}\}/g, thesesText || '(нет тезисов)');
  }

  function formatTheses(theses) {
    if (!theses || !theses.length) return '';
    return theses.map((t, i) =>
      `[Тезис ${i + 1}]\nВопрос: ${t.question}\nОтвет: ${t.answer}`
    ).join('\n\n');
  }

  function formatUserMessage(context) {
    let msg = '';
    msg += `[Пост от ${context.authorName}]\n`;
    msg += context.postText || '(без текста)';
    msg += '\n';

    // Если отвечаем на конкретный комментарий — укажем это
    if (context.replyToName) {
      msg += `\n[Ответ на комментарий пользователя: ${context.replyToName}]\n`;
    }

    if (context.comments.length > 0) {
      msg += '\n[Комментарии]\n';
      context.comments.forEach((c, i) => {
        let line = `${i + 1}. ${c.author}`;
        if (c.replyTo) line += ` (ответ ${c.replyTo})`;
        line += `: ${c.text}\n`;
        msg += line;
      });
    }

    return msg;
  }

  // ═══════════════════════════════════════════
  //  ВСТАВКА ТЕКСТА В ПОЛЕ
  // ═══════════════════════════════════════════

  function insertIntoField(field, text) {
    field.focus();
    // Выделяем всё содержимое и удаляем через execCommand
    // (безопаснее для React/VKUI, чем field.innerHTML = '')
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(field);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false);
    // Вставляем текст через execCommand — VK реагирует на input события
    document.execCommand('insertText', false, text);
    // Триггерим input событие для VK-овых React-обработчиков
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ═════════════════════════════════════════════
  //  ПЛАВАЮЩАЯ ПАНЕЛЬ (shadow DOM)
  // ═══════════════════════════════════════════

  const PANEL_STYLES = `
    * { margin:0; padding:0; box-sizing:border-box; }
    .panel {
      background: #1e1f23; border: 1px solid #3a3b42; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); overflow: hidden;
      font-size: 13px; color: #e4e4e7; line-height: 1.5;
      min-width: 300px;
    }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; background: #28292e; border-bottom: 1px solid #3a3b42;
      cursor: move; user-select: none;
    }
    .panel-title {
      font-size: 13px; font-weight: 600; display: flex;
      align-items: center; gap: 6px; flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .panel-badge {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; font-weight: 600; flex-shrink: 0;
    }
    .badge-prompt { background: rgba(99,102,241,0.15); color: #818cf8; }
    .badge-result { background: rgba(34,197,94,0.15); color: #4ade80; }
    .badge-error  { background: rgba(239,68,68,0.15); color: #f87171; }
    .badge-loading { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge-info   { background: rgba(59,130,246,0.15); color: #60a5fa; }
    .panel-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .panel-btn {
      padding: 4px 8px; font-size: 11px; font-weight: 600; color: #a1a1aa;
      background: none; border: 1px solid #3a3b42; border-radius: 5px;
      cursor: pointer; font-family: inherit;
    }
    .panel-btn:hover { color: #e4e4e7; background: #33343a; }
    .panel-btn-primary { color: #818cf8; border-color: rgba(99,102,241,0.3); }
    .panel-btn-primary:hover { background: rgba(99,102,241,0.15); }
    .panel-body {
      padding: 12px 14px; max-height: 50vh; overflow-y: auto; background: #1a1b1e;
    }
    .panel-body pre {
      white-space: pre-wrap; word-break: break-word;
      font-family: 'Cascadia Code','Fira Code','JetBrains Mono',monospace;
      font-size: 12px; line-height: 1.6; color: #d4d4d8;
    }
    .panel-status {
      padding: 6px 14px; font-size: 11px; color: #22c55e;
      background: rgba(34,197,94,0.08); border-top: 1px solid #3a3b42;
    }
    .panel-hint {
      padding: 8px 14px; font-size: 11px; color: #71717a;
      border-top: 1px solid #3a3b42;
    }
    .panel-hint kbd {
      display: inline-block; padding: 1px 5px; background: #2a2b30;
      border: 1px solid #3a3b42; border-radius: 3px;
      font-size: 10px; font-family: inherit; color: #a1a1aa;
    }
    .loading-spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid #3a3b42; border-top-color: #6366f1;
      border-radius: 50%; animation: spin 0.6s linear infinite;
      vertical-align: middle; margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #3a3b42; border-radius: 3px; }
    .debug-box {
      margin-bottom: 8px; padding: 8px; background: #28292e;
      border-radius: 6px; font-size: 11px; color: #71717a; line-height: 1.6;
    }
    .debug-box strong { color: #a1a1aa; }
    .btn-copied { background: rgba(34,197,94,0.15) !important; color: #22c55e !important; border-color: #22c55e !important; }
    .topic-bar {\n      display: flex; align-items: center; gap: 8px;\n      padding: 8px 14px; background: #25262b; border-bottom: 1px solid #3a3b42;\n    }\n    .topic-bar label {\n      font-size: 11px; font-weight: 600; color: #a1a1aa; white-space: nowrap;\n    }\n    .tpl-bar {\n      display: flex; align-items: center; gap: 8px;\n      padding: 6px 14px; background: #2a2530; border-bottom: 1px solid #3a3b42;\n    }\n    .tpl-bar label {\n      font-size: 11px; font-weight: 600; color: #c084fc; white-space: nowrap;\n    }\n    .tpl-select {\n      flex: 1; padding: 5px 8px; font-size: 12px; font-weight: 500;\n      color: #e4e4e7; background: #1e1f23; border: 1px solid #3a3b42;\n      border-radius: 5px; font-family: inherit; cursor: pointer;\n      outline: none; appearance: auto;\n    }\n    .tpl-select:focus { border-color: #c084fc; }
    .topic-select {
      flex: 1; padding: 5px 8px; font-size: 12px; font-weight: 500;
      color: #e4e4e7; background: #1e1f23; border: 1px solid #3a3b42;
      border-radius: 5px; font-family: inherit; cursor: pointer;
      outline: none; appearance: auto;
    }
    .topic-select:focus { border-color: #6366f1; }
    .topic-theses-count {
      font-size: 10px; font-weight: 600; color: #71717a; white-space: nowrap;
      padding: 2px 6px; background: rgba(113,113,122,0.1); border-radius: 4px;
    }
    .ts-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 14px; background: #25262b; border-bottom: 1px solid #3a3b42;
    }
    .ts-title { font-size: 11px; font-weight: 600; color: #a1a1aa; }
    .ts-count { color: #6366f1; font-weight: 700; }
    .ts-actions { display: flex; gap: 4px; }
    .ts-actions .panel-btn { font-size: 10px; padding: 2px 6px; }
    .ts-loading {
      padding: 6px 14px; font-size: 11px; color: #fbbf24; background: rgba(245,158,11,0.06);
      border-bottom: 1px solid #3a3b42; display: flex; align-items: center; gap: 6px;
    }
    .ts-list {
      max-height: 180px; overflow-y: auto; background: #1a1b1e;
      border-bottom: 1px solid #3a3b42;
    }
    .ts-item {
      display: flex; align-items: flex-start; gap: 6px; padding: 5px 14px;
      border-bottom: 1px solid rgba(58,59,66,0.4); cursor: pointer;
      transition: background 0.1s;
    }
    .ts-item:last-child { border-bottom: none; }
    .ts-item:hover { background: rgba(99,102,241,0.04); }
    .ts-item.ts-checked { background: rgba(99,102,241,0.06); }
    .ts-cb {
      flex-shrink: 0; width: 13px; height: 13px; margin-top: 2px;
      accent-color: #6366f1; cursor: pointer;
    }
    .ts-text {
      font-size: 11px; color: #71717a; line-height: 1.35;
    }
    .ts-item-checked .ts-text { color: #d4d4d8; }
    .ts-text strong { color: #a1a1aa; }
    .ts-item-checked .ts-text strong { color: #e4e4e7; }
    .ts-disabled .ts-item { opacity: 0.5; pointer-events: none; }
    .ts-search-bar {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 14px; background: #1e1f24; border-bottom: 1px solid #3a3b42;
    }
    .ts-search-input {
      flex: 1; font-size: 11px; padding: 3px 8px;
      background: #25262b; border: 1px solid #3a3b42; border-radius: 4px;
      color: #d4d4d8; outline: none;
    }
    .ts-search-input::placeholder { color: #52525b; }
    .ts-search-input:focus { border-color: #6366f1; }
    .ts-search-count { font-size: 10px; color: #6366f1; white-space: nowrap; font-weight: 600; }
    .ts-hl {
      background: rgba(251,191,36,0.25); color: #fbbf24;
      border-radius: 2px; padding: 0 1px;
    }
    .kw-chips-bar {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 6px 14px; background: #1e1f24;
      border-bottom: 1px solid #3a3b42;
    }
    .kw-chips-label {
      font-size: 10px; color: #71717a; white-space: nowrap;
      padding-top: 3px; flex-shrink: 0;
    }
    .kw-chips-wrap {
      display: flex; flex-wrap: wrap; gap: 4px;
    }
    .kw-chip {
      display: inline-block; font-size: 10px; line-height: 1.3;
      padding: 2px 7px; border-radius: 10px; cursor: pointer;
      background: rgba(251,191,36,0.15); color: #fbbf24;
      border: 1px solid rgba(251,191,36,0.3);
      transition: all 0.15s; user-select: none;
    }
    .kw-chip:hover {
      background: rgba(251,191,36,0.25);
    }
    .kw-chip.kw-chip-off {
      background: rgba(113,113,122,0.1); color: #52525b;
      border-color: rgba(113,113,122,0.2);
      text-decoration: line-through;
    }
    .kw-chip.kw-chip-off:hover {
      background: rgba(113,113,122,0.2);
    }
    .model-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 14px; background: #22232a; border-bottom: 1px solid #3a3b42;
    }
    .model-bar label {
      font-size: 11px; font-weight: 600; color: #a1a1aa; white-space: nowrap;
    }
    .model-select {
      flex: 1; padding: 5px 8px; font-size: 12px; font-weight: 500;
      color: #e4e4e7; background: #1e1f23; border: 1px solid #3a3b42;
      border-radius: 5px; font-family: inherit; cursor: pointer;
      outline: none; appearance: auto; max-width: 260px;
    }
    .model-select:focus { border-color: #6366f1; }
    .model-provider-badge {
      font-size: 10px; font-weight: 700; white-space: nowrap;
      padding: 2px 6px; background: rgba(113,113,122,0.1); border-radius: 4px;
    }
    .badge-new { background: rgba(168,85,247,0.15); color: #c084fc; }
    .thesis-form {
      padding: 12px 14px; background: #1a1b1e;
    }
    .form-row {
      margin-bottom: 10px;
    }
    .form-row label {
      display: block; font-size: 11px; font-weight: 600; color: #a1a1aa;
      margin-bottom: 4px;
    }
    .form-select, .form-input {
      width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 500;
      color: #e4e4e7; background: #1e1f23; border: 1px solid #3a3b42;
      border-radius: 5px; font-family: inherit; cursor: pointer;
      outline: none; appearance: auto;
    }
    .form-input { cursor: text; }
    .form-select:focus, .form-input:focus { border-color: #6366f1; }
    .form-textarea {
      width: 100%; padding: 6px 10px; font-size: 12px; line-height: 1.5;
      color: #e4e4e7; background: #1e1f23; border: 1px solid #3a3b42;
      border-radius: 5px; font-family: inherit; resize: vertical;
      outline: none; min-height: 36px;
    }
    .form-textarea:focus { border-color: #6366f1; }
    .form-textarea::placeholder { color: #52525b; }
    .form-actions {
      display: flex; gap: 6px; margin-top: 12px;
    }
    .panel-btn-save {
      color: #c084fc !important; border-color: rgba(168,85,247,0.3) !important;
    }
    .panel-btn-save:hover {
      background: rgba(168,85,247,0.15) !important;
    }
    .clipboard-hint {
      margin-top: 8px; padding: 6px 8px; font-size: 11px; color: #71717a;
      background: #25262b; border-radius: 5px; line-height: 1.5;
    }
    .thesis-status {
      margin-top: 8px; padding: 0; font-size: 11px; font-weight: 600;
      min-height: 0; transition: all 0.2s;
    }
    .thesis-status-success {
      padding: 6px 8px; color: #22c55e; background: rgba(34,197,94,0.08);
      border-radius: 5px;
    }
    .thesis-status-error {
      padding: 6px 8px; color: #f87171; background: rgba(239,68,68,0.08);
      border-radius: 5px;
    }
    .sp-details {
      margin-bottom: 8px;
    }
    .sp-summary {
      font-size: 11px; font-weight: 600; color: #a1a1aa;
      padding: 4px 0; cursor: pointer; user-select: none;
      outline: none;
    }
    .sp-summary:hover { color: #d4d4d8; }
    .sp-pre {
      white-space: pre-wrap; word-break: break-word;
      font-family: 'Cascadia Code','Fira Code','JetBrains Mono',monospace;
      font-size: 11px; line-height: 1.5; color: #a1a1aa;
      padding: 8px; margin-top: 4px; background: #25262b;
      border-radius: 5px; max-height: 200px; overflow-y: auto;
    }
    .um-section {
      margin-top: 4px;
    }
    .um-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 4px;
    }
    .um-label {
      font-size: 11px; font-weight: 600; color: #22c55e;
    }
    .um-editor {
      width: 100%; padding: 8px 10px; font-size: 12px; line-height: 1.5;
      color: #e4e4e7; background: #25262b; border: 1px solid #3a3b42;
      border-radius: 5px; font-family: 'Cascadia Code','Fira Code','JetBrains Mono',monospace;
      resize: vertical; outline: none; min-height: 80px;
    }
    .um-editor:focus { border-color: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.15); }
    .um-editor::placeholder { color: #52525b; }
    .btn-um-reset { font-size: 10px !important; padding: 2px 6px !important; }
    .btn-um-reset:hover { color: #f59e0b !important; border-color: rgba(245,158,11,0.3) !important; }
  `;

  /**
   * Создаёт панель (хост + shadow DOM + базовый .panel элемент).
   * Вызывается один раз, затем обновляется через showPanel().
   */
  function ensurePanel() {
    if (panelHost) return; // панель уже существует

    panelHost = document.createElement('div');
    panelHost.id = 'commenter-panel-host';
    panelHost.style.cssText = 'position:fixed; top:16px; right:16px; z-index:99999; width:520px; max-width:calc(100vw - 32px); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;';

    panelShadow = panelHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_STYLES;
    panelShadow.appendChild(style);

    // Создаём базовую структуру панели сразу!
    const panel = document.createElement('div');
    panel.className = 'panel';
    panelShadow.appendChild(panel);

    // Привязываем drag к хост-элементу, dragging через header
    setupDrag(panel);

    document.body.appendChild(panelHost);
    console.log('[Commenter] Panel created');
  }

  function getPanel() {
    if (!panelShadow) return null;
    return panelShadow.querySelector('.panel');
  }

  function showPanel(title, content, type, context, topicData) {
    ensurePanel();

    const panel = getPanel();
    if (!panel) {
      console.error('[Commenter] Panel element not found after ensurePanel!');
      return;
    }

    const badgeClass = { prompt: 'badge-prompt', result: 'badge-result', error: 'badge-error', loading: 'badge-loading', info: 'badge-info' }[type] || 'badge-info';
    const badgeText = { prompt: 'Промпт', result: 'Результат', loading: 'Генерация...', error: 'Ошибка', info: 'Info' }[type] || 'Info';

    // ── Тема: заголовок ──
    const displayTitle = type === 'prompt'
      ? (title ? 'Тема: ' + title : 'Тема не выбрана')
      : title;

    // ── Шаблон: дропдаун ──
    let tplBarHtml = '';
    if (type === 'prompt' && topicData && topicData.templates) {
      const tplList = topicData.templates;
      const tplActiveId = topicData.activeTemplateId || '';
      const tplOptionsHtml = tplList.map(t => {
        const isActive = t.isActive || t.id === tplActiveId;
        const selected = isActive ? ' selected' : '';
        return `<option value="${escapeHtml(t.id)}"${selected}>${isActive ? '\u2605 ' : ''}${escapeHtml(t.name)}</option>`;
      }).join('');
      tplBarHtml = `
        <div class="tpl-bar">
          <label for="template-selector">Шаблон:</label>
          <select class="tpl-select" id="template-selector">${tplOptionsHtml}</select>
        </div>
      `;
    }

    // ── Тема: дропдаун ──
    let topicBarHtml = '';
    if (type === 'prompt' && topicData && topicData.topics) {
      const topics = topicData.topics;
      const activeId = topicData.activeTopicId;
      const activeTopic = topics.find(t => t.id === activeId);
      const thesesCount = activeTopic ? (activeTopic.theses || []).length : 0;

      const optionsHtml = ['<option value="">— без темы —</option>']
        .concat(topics.map(t => {
          const cnt = (t.theses || []).length;
          const label = cnt > 0 ? `${t.name} (${cnt} тез.)` : t.name;
          const selected = t.id === activeId ? ' selected' : '';
          return `<option value="${escapeHtml(t.id)}"${selected}>${escapeHtml(label)}</option>`;
        }))
        .join('');

      const countColor = thesesCount > 0 ? '#4ade80' : '#71717a';
      const countText = thesesCount > 0 ? `${thesesCount} тез.` : 'нет тезисов';

      topicBarHtml = `
        <div class="topic-bar">
          <label for="topic-selector">Тема:</label>
          <select class="topic-select" id="topic-selector">${optionsHtml}</select>
          <span class="topic-theses-count" style="color:${countColor}">${countText}</span>
        </div>
      `;
    }

    // ── Model bar (для type === 'prompt') ──
    let modelBarHtml = '';
    if (type === 'prompt' && cachedSettings) {
      const zaiModels = getModelsForProvider(cachedSettings, 'z-ai');
      const gcModels = getModelsForProvider(cachedSettings, 'gigachat');
      const localModels = getModelsForProvider(cachedSettings, 'local');
      const orModels = getModelsForProvider(cachedSettings, 'openrouter');

      const zaiOptions = zaiModels.map(m => {
        const sel = (panelProvider === 'z-ai' && panelModel === m.id) ? ' selected' : '';
        return `<option value="z-ai:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
      }).join('');

      const gcOptions = gcModels.map(m => {
        const sel = (panelProvider === 'gigachat' && panelModel === m.id) ? ' selected' : '';
        return `<option value="gigachat:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
      }).join('');

      const localOptions = localModels.map(m => {
        const sel = (panelProvider === 'local' && panelModel === m.id) ? ' selected' : '';
        return `<option value="local:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
      }).join('');

      const orOptions = orModels.map(m => {
        const sel = (panelProvider === 'openrouter' && panelModel === m.id) ? ' selected' : '';
        return `<option value="openrouter:${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)}</option>`;
      }).join('');

      const providerLabel = panelProvider === 'openrouter' ? 'OR' : panelProvider === 'local' ? 'Local' : panelProvider === 'gigachat' ? 'GC' : 'z-ai';
      const providerColor = panelProvider === 'openrouter' ? '#60a5fa' : panelProvider === 'local' ? '#f59e0b' : panelProvider === 'gigachat' ? '#21c55d' : '#4ade80';

      modelBarHtml = `
        <div class="model-bar">
          <label for="model-selector">Модель:</label>
          <select class="model-select" id="model-selector">
            <optgroup label="z-ai">${zaiOptions}</optgroup>
            <optgroup label="GigaChat">${gcOptions}</optgroup>
            <optgroup label="Local">${localOptions}</optgroup>
            <optgroup label="OpenRouter">${orOptions}</optgroup>
          </select>
          <span class="model-provider-badge" style="color:${providerColor}">${providerLabel}</span>
        </div>
      `;
    }

    let debugHtml = '';
    if (context) {
      const previewText = context.postText
        ? escapeHtml(context.postText.slice(0, 150)) + (context.postText.length > 150 ? '...' : '')
        : '(пустой)';
      const commentsPreview = context.comments.slice(0, 5).map((c, i) => {
        let line = `${i + 1}. ${escapeHtml(c.author)}`;
        if (c.replyTo) line += ` (→${escapeHtml(c.replyTo)})`;
        line += `: ${escapeHtml(c.text.slice(0, 60))}`;
        return line;
      }).join('\n');

      const replyToLine = context.replyToName
        ? `<div><strong>Reply-to:</strong> ${escapeHtml(context.replyToName)}</div>`
        : '';

      debugHtml = `<div class="debug-box">
        <div><strong>Post ID:</strong> ${escapeHtml(context.postId)}</div>
        <div><strong>Author:</strong> ${escapeHtml(context.authorName)}</div>
        ${replyToLine}
        <div><strong>Post text (${context.postText.length} chars):</strong></div>
        <div style="margin-left:8px;white-space:pre-wrap">${previewText}</div>
        <div><strong>Comments (${context.comments.length}):</strong></div>
        <div style="margin-left:8px;white-space:pre-wrap">${commentsPreview}</div>
      </div>`;
    }

    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <span class="panel-badge ${badgeClass}">${badgeText}</span>
          ${escapeHtml(displayTitle)}
          ${type === 'loading' ? '<span class="loading-spinner"></span>' : ''}
        </div>
        <div class="panel-actions">
          <button class="panel-btn panel-btn-primary btn-copy-panel">Копировать</button>
          <button class="panel-btn btn-close-panel">✕</button>
        </div>
      </div>
      ${modelBarHtml}
      ${tplBarHtml}
      ${topicBarHtml}
      <div class="panel-body">${debugHtml}${type === 'prompt' ? `<details class="sp-details"><summary class="sp-summary">Системный промпт</summary><pre id="sp-display" class="sp-pre">${escapeHtml(lastBuiltPrompt?.systemPrompt || '')}</pre></details><div class="um-section"><div class="um-header"><label class="um-label">Контекст (можно редактировать):</label><button class="panel-btn btn-um-reset" id="btn-um-reset" style="display:none" title="Сбросить к оригиналу">&#x21BA; Сброс</button></div><textarea id="um-editor" class="form-textarea um-editor" rows="8" placeholder="Контекст поста появится здесь...">${escapeHtml(lastBuiltPrompt?.userMessage || '')}</textarea></div>` : `<pre>${escapeHtml(content)}</pre>`}</div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — собрать промпт &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация
      </div>
    `;

    // Событие смены модели
    const modelSelect = panel.querySelector('#model-selector');
    if (modelSelect) {
      modelSelect.addEventListener('change', async (e) => {
        const val = e.target.value;
        const colonIdx = val.indexOf(':');
        if (colonIdx === -1) return;
        const newProvider = val.slice(0, colonIdx);
        const newModel = val.slice(colonIdx + 1);

        panelProvider = newProvider;
        panelModel = newModel;

        if (cachedSettings) {
          cachedSettings.provider = newProvider;
          if (!cachedSettings.providers[newProvider]) {
            cachedSettings.providers[newProvider] = { apiKey: '', model: '', customModelInput: '', baseUrl: '' };
          }
          cachedSettings.providers[newProvider].model = newModel;
          cachedSettings.providers[newProvider].customModelInput = '';
          await saveSettings(cachedSettings);
        }

        const badge = panel.querySelector('.model-provider-badge');
        if (badge) {
          badge.textContent = newProvider === 'openrouter' ? 'OR' : newProvider === 'local' ? 'Local' : newProvider === 'gigachat' ? 'GC' : 'z-ai';
          badge.style.color = newProvider === 'openrouter' ? '#60a5fa' : newProvider === 'local' ? '#f59e0b' : newProvider === 'gigachat' ? '#21c55d' : '#4ade80';
        }

        console.log('[Commenter] Model changed:', newProvider, newModel);
      });
    }

    // Событие смены шаблона
    const tplSelect = panel.querySelector('.tpl-select');
    if (tplSelect) {
      tplSelect.addEventListener('change', (e) => {
        setActiveTemplate(e.target.value);
        // Пересобрать промпт с новым шаблоном
        if (cachedSettings) {
          cachedSettings.activeTemplateId = e.target.value;
          updatePromptFromSelection();
        }
      });
    }

    // Событие смены темы
    const topicSelect = panel.querySelector('.topic-select');
    if (topicSelect) {
      topicSelect.addEventListener('change', (e) => {
        rebuildPromptWithTopic(e.target.value);
      });
    }

    // События кнопок
    panel.querySelector('.btn-copy-panel')?.addEventListener('click', () => {
      const copyText = lastBuiltPrompt
        ? `[Системный промпт]\n${lastBuiltPrompt.systemPrompt}\n\n[Контекст поста]\n${lastBuiltPrompt.userMessage}`
        : content;
      navigator.clipboard.writeText(copyText).catch(() => {});
      const btn = panel.querySelector('.btn-copy-panel');
      btn.textContent = 'Скопировано!';
      btn.classList.add('btn-copied');
      setTimeout(() => { btn.textContent = 'Копировать'; btn.classList.remove('btn-copied'); }, 1500);
    });

    panel.querySelector('.btn-close-panel')?.addEventListener('click', hidePanel);

    // Event: user message edit (for prompt type)
    if (type === 'prompt') {
      const umEditor = panel.querySelector('#um-editor');
      if (umEditor) {
        umEditor.addEventListener('input', () => {
          isUserMessageEdited = true;
          if (lastBuiltPrompt) {
            lastBuiltPrompt.userMessage = umEditor.value;
          }
          const resetBtn = panel.querySelector('#btn-um-reset');
          if (resetBtn) resetBtn.style.display = '';
        });
        panel.querySelector('#btn-um-reset')?.addEventListener('click', () => {
          isUserMessageEdited = false;
          if (cachedContext && lastBuiltPrompt) {
            const userMessage = formatUserMessage(cachedContext);
            lastBuiltPrompt.userMessage = userMessage;
            umEditor.value = userMessage;
          }
          const resetBtn = panel.querySelector('#btn-um-reset');
          if (resetBtn) resetBtn.style.display = 'none';
        });
      }
    }
  }

  function updatePanelStatus(text) {
    const panel = getPanel();
    if (!panel) return;
    const old = panel.querySelector('.panel-status');
    if (old) old.remove();
    const status = document.createElement('div');
    status.className = 'panel-status';
    status.textContent = text;
    panel.appendChild(status);
  }

  function hidePanel() {
    if (panelHost) {
      panelHost.remove();
      panelHost = null;
      panelShadow = null;
    }
  }

  // ── Drag & Drop ───────────────────────

  function setupDrag(panelEl) {
    if (!panelEl || !panelHost) return;
    let isDragging = false;
    let offsetX, offsetY;

    // Используем mousedown на header внутри shadow DOM
    panelEl.addEventListener('mousedown', (e) => {
      const header = e.target.closest('.panel-header');
      if (!header || e.target.closest('button')) return;

      isDragging = true;
      const rect = panelHost.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', stopDrag);

      e.preventDefault();
    });

    function onDrag(e) {
      if (!isDragging) return;
      const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - offsetX));
      const newY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - offsetY));
      panelHost.style.left = newX + 'px';
      panelHost.style.top = newY + 'px';
      panelHost.style.right = 'auto';
    }

    function stopDrag() {
      isDragging = false;
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', stopDrag);
    }
  }

  // ═══════════════════════════════════════════
  //  УТИЛИТЫ
  // ═══════════════════════════════════════════

  function isCommentField(el) {
    if (!el || !el.hasAttribute) return false;
    return el.hasAttribute('contenteditable') &&
           el.matches('[data-testid="content-editable-input"]');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function logContext(ctx) {
    console.log(`[Commenter] Context extracted:`);
    console.log(`  Post ID:   ${ctx.postId}`);
    console.log(`  Author:   ${ctx.authorName}`);
    console.log(`  Text len:  ${ctx.postText.length} chars`);
    if (ctx.replyToName) console.log(`  Reply-to:  ${ctx.replyToName}`);
    console.log(`  Comments: ${ctx.comments.length}`);
    ctx.comments.slice(0, 5).forEach((c, i) => {
      let line = `    ${i + 1}. ${c.author}`;
      if (c.replyTo) line += ` (→${c.replyTo})`;
      line += `: ${c.text?.slice(0, 80)}`;
      console.log(line);
    });
  }

  // ── chrome.storage обёртки ───────────────
  // (getSettings, getProviderSettings, saveSettings, getTopics, saveTopics,
  //  getTemplates, setActiveTemplate, generateId, getDefaultModel — определены выше)

})();
