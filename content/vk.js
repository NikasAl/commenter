/**
 * Commenter — VK Content Script
 *
 * Хоткеи (при фокусе в поле комментария):
 *   Ctrl+Shift+P  — извлечь контекст поста, собрать промпт, показать в панельке + копировать
 *   Ctrl+Shift+G  — отправить собранный промпт в LLM, вставить результат в поле
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

  const DEFAULT_SYSTEM_PROMPT = `Ты — эксперт по теме "{{topic}}". Используй приведённые ниже тезисы для формирования ответа. Твой ответ должен быть аргументированным, опираться на тезисы, но звучать естественно, а не как цитата из справочника. Если тезисы не покрывают вопрос полностью, можешь дополнить ответ своими знаниями, но в первую очередь используй тезисы.

=== ТЕЗИСЫ ===
{{theses}}
=== КОНЕЦ ТЕЗИСОВ ===

Формулируй ответ на русском языке. Пиши понятно и лаконично.`;

  // ═══════════════════════════════════════════
  //  СОСТОЯНИЕ
  // ═══════════════════════════════════════════

  let lastBuiltPrompt = null;
  let lastFocusedField = null;
  let panelHost = null;      // хост-элемент #commenter-panel-host
  let panelShadow = null;    // ссылка на shadow root
  let isGenerating = false;

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

    // Получить настройки (тема, промпт)
    const settings = await getSettings();
    const activeTopicId = settings.activeTopicId || '';
    let topicName = '';
    let thesesText = '';

    if (activeTopicId) {
      const topics = await getTopics();
      const topic = topics.find(t => t.id === activeTopicId);
      if (topic) {
        topicName = topic.name;
        thesesText = formatTheses(topic.theses);
      }
    }

    const promptTemplate = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const systemPrompt = buildSystemPrompt(promptTemplate, topicName || 'Общая тема', thesesText);
    const userMessage = formatUserMessage(context);

    lastBuiltPrompt = { systemPrompt, userMessage, context };

    const fullPrompt = `[Системный промпт]\n${systemPrompt}\n\n[Контекст поста + сообщение для ответа]\n${userMessage}`;

    showPanel(
      `Промпт собран${topicName ? ' — тема: ' + topicName : ' (тема не выбрана)'}`,
      fullPrompt,
      'prompt',
      context
    );

    try {
      await navigator.clipboard.writeText(fullPrompt);
      updatePanelStatus('Скопировано в буфер обмена!');
    } catch (err) {
      console.warn('[Commenter] Clipboard failed:', err);
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
    if (!settings.apiKey) {
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
          apiKey: settings.apiKey,
          model: settings.customModelInput || settings.model || getDefaultModel(settings.provider),
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

    msg += '\n[Задание]\nСформулируй ответ на этот пост (и/или на комментарии), используя тезисы из системного промпта.';
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

  function showPanel(title, content, type, context) {
    ensurePanel();

    const panel = getPanel();
    if (!panel) {
      console.error('[Commenter] Panel element not found after ensurePanel!');
      return;
    }

    const badgeClass = { prompt: 'badge-prompt', result: 'badge-result', error: 'badge-error', loading: 'badge-loading', info: 'badge-info' }[type] || 'badge-info';
    const badgeText = { prompt: 'Промпт', result: 'Результат', loading: 'Генерация...', error: 'Ошибка', info: 'Info' }[type] || 'Info';

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
          ${escapeHtml(title)}
          ${type === 'loading' ? '<span class="loading-spinner"></span>' : ''}
        </div>
        <div class="panel-actions">
          <button class="panel-btn panel-btn-primary btn-copy-panel">Копировать</button>
          <button class="panel-btn btn-close-panel">✕</button>
        </div>
      </div>
      <div class="panel-body">${debugHtml}<pre>${escapeHtml(content)}</pre></div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — собрать промпт &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация
      </div>
    `;

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

  function getDefaultModel(provider) {
    return provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'glm-4-plus';
  }

})();
