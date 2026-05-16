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

  // ═══════════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════════

  console.log('[Commenter] VK content script loaded');
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('keydown', onKeyDown);

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

    const activeTopicId = settings.activeTopicId || '';
    const topic = topics.find(t => t.id === activeTopicId);
    currentTopicTheses = topic ? (topic.theses || []) : [];

    // Отрисовываем панель с тезисами
    if (currentTopicTheses.length > 0) {
      // Начинаем с «выбраны все»
      selectedThesisIds = new Set(currentTopicTheses.map(t => t.id));
      showPromptPanel(context, topics, activeTopicId, topic, currentTopicTheses, selectedThesisIds, false);

      // Если автоотбор включён — запускаем LLM-селекцию
      if (settings.thesisAutoSelect && getProviderSettings(settings).apiKey) {
        await runThesisSelection(context, topic, currentTopicTheses);
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
    const ps = getProviderSettings(settings);
    if (!ps.apiKey) {
      showPanel('Ошибка', 'API ключ не настроен. Откройте настройки расширения.', 'error');
      return;
    }

    isGenerating = true;
    showPanel('Генерация...', 'Отправляю запрос в LLM...', 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_REQUEST',
        payload: {
          provider: settings.provider || 'z-ai',
          apiKey: ps.apiKey,
          model: ps.customModelInput || ps.model || getDefaultModel(settings.provider),
          systemPrompt: lastBuiltPrompt.systemPrompt,
          userMessage: lastBuiltPrompt.userMessage,
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
    if (!theses.length || !cachedSettings?.apiKey || isSelectingTheses) return;
    isSelectingTheses = true;
    setThesisSelectorLoading(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_REQUEST',
        payload: {
          provider: cachedSettings.provider || 'z-ai',
          apiKey: cachedSettings.apiKey,
          model: cachedSettings.customModelInput || cachedSettings.model || getDefaultModel(cachedSettings.provider),
          systemPrompt: SELECT_SYSTEM_PROMPT,
          userMessage: buildSelectUserMessage(context.postText, theses),
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
    if (cachedSettings.thesisAutoSelect && cachedSettings.apiKey) {
      selectedThesisIds = new Set(); // сбрасываем перед LLM
      updateThesisCheckboxes();
      updatePromptFromSelection();
      await runThesisSelection(cachedContext, topic, currentTopicTheses);
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
      ${loadingHtml}
      <div class="ts-list">${thesisItemsHtml}</div>
      <div class="panel-body"><pre>${escapeHtml('Загрузка...')}</pre></div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — сбор &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> — тезис
      </div>
    `;

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

    // Build initial prompt text
    updatePromptFromSelection();
  }

  function updateThesisListHtml(panel) {
    const listEl = panel?.querySelector('.ts-list');
    if (!listEl) return;
    listEl.innerHTML = currentTopicTheses.map((t, i) => {
      const checked = selectedThesisIds.has(t.id) ? ' checked' : '';
      const qShort = escapeHtml(t.question.length > 55 ? t.question.slice(0, 55) + '...' : t.question);
      const aShort = escapeHtml(t.answer.length > 55 ? t.answer.slice(0, 55) + '...' : t.answer);
      return `<label class="ts-item${selectedThesisIds.has(t.id) ? ' ts-checked' : ''}">
        <input type="checkbox" class="ts-cb" data-tid="${escapeHtml(t.id)}"${checked}>
        <span class="ts-text"><strong>${i + 1}.</strong> В: ${qShort} | О: ${aShort}</span>
      </label>`;
    }).join('');
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

  function setThesisSelectorLoading(loading) {
    const panel = getPanel();
    if (!panel) return;
    let el = panel.querySelector('.ts-loading');
    if (loading && !el) {
      el = document.createElement('div');
      el.className = 'ts-loading';
      el.innerHTML = '<span class="loading-spinner"></span>Анализирую тезисы...';
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
    // Update pre element
    const panel = getPanel();
    const pre = panel?.querySelector('.panel-body pre');
    if (pre) {
      const fp = `[Системный промпт]\n${systemPrompt}\n\n[Контекст поста + сообщение для ответа]\n${userMessage}`;
      pre.textContent = fp;
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
    // Ищем дочерний элемент с классом содержащим vkitFeedShowMoreText__text
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
    // Ищем элемент с классом vkitCommentReplyTarget
    const replyTargetEl = containerEl.querySelector('[class*="vkitCommentReplyTarget"]');
    if (replyTargetEl) {
      const text = replyTargetEl.textContent.trim();
      // Формат: "ответ Имя" или "ответу Имя" или просто имя
      // Убираем "ответ"/"ответу" и пробелы
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
    // Очищаем текущее содержимое
    field.innerHTML = '';
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
      ${tplBarHtml}
      ${topicBarHtml}
      <div class="panel-body">${debugHtml}<pre>${escapeHtml(content)}</pre></div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — собрать промпт &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация
      </div>
    `;

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
      navigator.clipboard.writeText(content).catch(() => {});
      const btn = panel.querySelector('.btn-copy-panel');
      btn.textContent = 'Скопировано!';
      btn.classList.add('btn-copied');
      setTimeout(() => { btn.textContent = 'Копировать'; btn.classList.remove('btn-copied'); }, 1500);
    });

    panel.querySelector('.btn-close-panel')?.addEventListener('click', hidePanel);
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

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get('commenter_settings', result => {
        resolve(result.commenter_settings || {});
      });
    });
  }

  function getTopics() {
    return new Promise(resolve => {
      chrome.storage.local.get('commenter_topics', result => {
        resolve(result.commenter_topics || []);
      });
    });
  }

  function saveTopics(topics) {
    return new Promise(resolve => {
      chrome.storage.local.set({ commenter_topics: topics }, resolve);
    });
  }

  function getDefaultModel(provider) {
    return provider === 'openrouter' ? 'google/gemini-2.0-flash-001' : 'GLM-4.7-Flash';
  }

  function saveSettings(settings) {
    return new Promise(resolve => {
      chrome.storage.local.set({ commenter_settings: settings }, resolve);
    });
  }

})();
