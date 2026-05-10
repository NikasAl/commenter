/**
 * Commenter — VK Content Script
 *
 * Хоткеи (при фокусе в поле комментария):
 *   Ctrl+Shift+P  — извлечь контекст поста, собрать промпт, показать в панельке + копировать
 *   Ctrl+Shift+G  — отправить собранный промпт в LLM, вставить результат в поле
 *
 * Промпт собирается из: выбранная тема (storage) + тезисы + текст поста + комментарии.
 * Если тема не выбрана — используется последний промпт из панели.
 */

(() => {
  'use strict';

  // ═══════════════════════════════════════════
  //  НАСТРОЙКИ
  // ═══════════════════════════════════════════

  const HOTKEY_PROMPT = 'KeyP';   // Ctrl+Shift+P — сбор промпта
  const HOTKEY_GENERATE = 'KeyG'; // Ctrl+Shift+G — генерация

  // Дефолтный шаблон системного промпта (если не сохранён)
  const DEFAULT_SYSTEM_PROMPT = `Ты — эксперт по теме "{{topic}}". Используй приведённые ниже тезисы для формирования ответа. Твой ответ должен быть аргументированным, опираться на тезисы, но звучать естественно, а не как цитата из справочника. Если тезисы не покрывают вопрос полностью, можешь дополнить ответ своими знаниями, но в первую очередь используй тезисы.

=== ТЕЗИСЫ ===
{{theses}}
=== КОНЕЦ ТЕЗИСОВ ===

Формулируй ответ на русском языке. Пиши понятно и лаконично.`;

  // ═══════════════════════════════════════════
  //  СОСТОЯНИЕ
  // ═══════════════════════════════════════════

  let lastBuiltPrompt = null;     // Последний собранный промпт (для Ctrl+Shift+G)
  let lastFocusedField = null;    // Поле ввода, в котором был фокус
  let panelEl = null;             // Плавающая панель
  let panelVisible = false;
  let isGenerating = false;

  // ═══════════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════════

  console.log('[Commenter] VK content script loaded');

  // Слушаем фокус на contenteditable полях ввода комментария
  document.addEventListener('focusin', onFocusIn);
  // Хоткеи
  document.addEventListener('keydown', onKeyDown);

  // ── Отслеживание фокуса ──────────────────

  function onFocusIn(event) {
    const target = event.target;
    // Проверяем что это contenteditable поле комментария VK
    if (target.hasAttribute('contenteditable') &&
        target.id && target.id.startsWith('reply_field')) {
      lastFocusedField = target;
      console.log('[Commenter] Focused on reply field:', target.id);
    }
  }

  // ── Хоткеи ───────────────────────────────

  function onKeyDown(event) {
    if (!event.ctrlKey || !event.shiftKey) return;

    if (event.code === HOTKEY_PROMPT) {
      event.preventDefault();
      event.stopPropagation();
      handleBuildPrompt();
      return;
    }

    if (event.code === HOTKEY_GENERATE) {
      event.preventDefault();
      event.stopPropagation();
      handleGenerate();
      return;
    }
  }

  // ═══════════════════════════════════════════
  //  ШАГ 1: СБОР ПРОМПТА (Ctrl+Shift+P)
  // ═══════════════════════════════════════════

  async function handleBuildPrompt() {
    const field = lastFocusedField || document.activeElement;
    if (!isReplyField(field)) {
      showPanel('Ошибка', 'Поставьте фокус в поле комментария (reply_field)', 'error');
      return;
    }

    // 1. Извлечь контекст поста
    const context = extractPostContext(field);
    if (!context) {
      showPanel('Ошибка', 'Не удалось найти пост. Убедитесь что фокус в поле комментария.', 'error');
      return;
    }

    logContext(context);

    // 2. Получить настройки (тема, промпт)
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

    // 3. Собрать системный промпт
    const promptTemplate = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const systemPrompt = buildSystemPrompt(promptTemplate, topicName || 'Общая тема', thesesText);

    // 4. Собрать пользовательское сообщение из контекста поста
    const userMessage = formatUserMessage(context);

    // 5. Полный промпт для копирования
    lastBuiltPrompt = {
      systemPrompt,
      userMessage,
      context,
    };

    const fullPrompt = `[Системный промпт]\n${systemPrompt}\n\n[Контекст поста + сообщение для ответа]\n${userMessage}`;

    // 6. Показать в панельке
    showPanel(
      `Промпт собран${topicName ? ' — тема: ' + topicName : ' (тема не выбрана)'}`,
      fullPrompt,
      'prompt',
      context
    );

    // 7. Скопировать в буфер
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
    if (!isReplyField(field)) {
      showPanel('Ошибка', 'Поставьте фокус в поле комментария (reply_field)', 'error');
      return;
    }

    if (!lastBuiltPrompt) {
      showPanel('Ошибка', 'Сначала соберите промпт: Ctrl+Shift+P', 'error');
      return;
    }

    // Проверяем настройки LLM
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

      const result = response.data;

      // Вставить в поле
      insertIntoField(field, result);

      showPanel('Готово', result, 'result');

      console.log('[Commenter] Response inserted into', field.id);
    } catch (err) {
      showPanel('Ошибка', `Не удалось получить ответ: ${err.message}`, 'error');
    } finally {
      isGenerating = false;
    }
  }

  // ═══════════════════════════════════════════
  //  ИЗВЛЕЧЕНИЕ КОНТЕКСТА ИЗ VK DOM
  // ═══════════════════════════════════════════

  /**
   * Извлечь контекст поста из поля ввода комментария
   * @param {HTMLElement} replyField — contenteditable div с id="reply_field{postId}"
   * @returns {Object|null} — { postId, authorName, postText, comments[] }
   */
  function extractPostContext(replyField) {
    // Из ID поля получаем ID поста
    // reply_field-22822305_377885  или  reply_field22822305_377885
    const fieldId = replyField.id;
    let postId = fieldId.replace('reply_field', '');

    // Попробуем найти пост по getElementById
    let postEl = document.getElementById('post' + postId);

    // Фоллбэк — поиск через DOM
    if (!postEl) {
      postEl = replyField.closest('.replies_wrap')?.closest('._post') ||
               replyField.closest('.replies')?.closest('._post');
    }

    if (!postEl) {
      console.warn('[Commenter] Parent post not found for field:', fieldId);
      return null;
    }

    // Автор поста
    const authorEl = postEl.querySelector('.PostHeaderTitle__authorName') ||
                     postEl.querySelector('.wall_post_author a');
    const authorName = authorEl?.textContent?.trim() || 'Неизвестный автор';

    // Текст поста
    const wallText = postEl.querySelector('.wall_text');
    const postText = wallText ? cleanText(wallText) : '';

    // Комментарии
    const comments = [];
    const repliesList = postEl.querySelector('.replies_list');
    if (repliesList) {
      const replyItems = repliesList.querySelectorAll('.reply');
      replyItems.forEach(reply => {
        const commentAuthor = reply.querySelector('.reply_author a.author')?.textContent?.trim() || '';
        const commentText = reply.querySelector('.wall_reply_text')?.textContent?.trim() || '';
        if (commentAuthor || commentText) {
          comments.push({ author: commentAuthor, text: commentText });
        }
      });
    }

    return {
      postId,
      authorName,
      postText,
      comments,
    };
  }

  // ═══════════════════════════════════════════
  //  ФОРМИРОВАНИЕ ТЕКСТА
  // ═══════════════════════════════════════════

  /**
   * Собрать системный промпт из шаблона + данные
   */
  function buildSystemPrompt(template, topicName, thesesText) {
    return template
      .replace(/\{\{topic\}\}/g, topicName)
      .replace(/\{\{theses\}\}/g, thesesText || '(нет тезисов)');
  }

  /**
   * Отформатировать тезисы в текстовый блок
   */
  function formatTheses(theses) {
    if (!theses || !theses.length) return '';
    return theses.map((t, i) => `[Тезис ${i + 1}]\nВопрос: ${t.question}\nОтвет: ${t.answer}`).join('\n\n');
  }

  /**
   * Сформировать пользовательское сообщение из контекста поста
   */
  function formatUserMessage(context) {
    let msg = '';
    msg += `[Пост от ${context.authorName}]\n`;
    msg += context.postText || '(без текста)';
    msg += '\n';

    if (context.comments.length > 0) {
      msg += '\n[Комментарии]\n';
      context.comments.forEach((c, i) => {
        msg += `${i + 1}. ${c.author}: ${c.text}\n`;
      });
    }

    msg += '\n[Задание]\nСформулируй ответ на этот пост (и/или на комментарии), используя тезисы из системного промпта.';
    return msg;
  }

  // ═══════════════════════════════════════════
  //  ВСТАВКА ТЕКСТА В ПОЛЕ
  // ═══════════════════════════════════════════

  /**
   * Вставить текст в contenteditable поле
   */
  function insertIntoField(field, text) {
    field.focus();

    // Очистить текущее содержимое
    field.innerHTML = '';

    // Вставить текст через execCommand для совместимости с VK
    document.execCommand('insertText', false, text);

    // Триггерить input event чтобы VK отреагировал
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ═══════════════════════════════════════════
  //  ПЛАВАЮЩАЯ ПАНЕЛЬ
  // ═══════════════════════════════════════════

  function ensurePanel() {
    if (panelEl) return;

    // Создаём панель и её тень (shadow DOM для изоляции стилей)
    const host = document.createElement('div');
    host.id = 'commenter-panel-host';
    host.style.cssText = 'position:fixed; top:16px; right:16px; z-index:99999; width:520px; max-height:80vh; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;';

    const shadow = host.attachShadow({ mode: 'closed' });
    panelEl = shadow;

    // Стили внутри shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      * { margin:0; padding:0; box-sizing:border-box; }

      .panel {
        background: #1e1f23;
        border: 1px solid #3a3b42;
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        overflow: hidden;
        font-size: 13px;
        color: #e4e4e7;
        line-height: 1.5;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #28292e;
        border-bottom: 1px solid #3a3b42;
        cursor: move;
        user-select: none;
      }

      .panel-title {
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .panel-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
      }
      .badge-prompt { background: rgba(99,102,241,0.15); color: #818cf8; }
      .badge-result { background: rgba(34,197,94,0.15); color: #4ade80; }
      .badge-error  { background: rgba(239,68,68,0.15); color: #f87171; }
      .badge-loading { background: rgba(245,158,11,0.15); color: #fbbf24; }
      .badge-info   { background: rgba(59,130,246,0.15); color: #60a5fa; }

      .panel-actions {
        display: flex;
        gap: 4px;
      }

      .panel-btn {
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 600;
        color: #a1a1aa;
        background: none;
        border: 1px solid #3a3b42;
        border-radius: 5px;
        cursor: pointer;
        font-family: inherit;
        transition: 0.15s;
      }
      .panel-btn:hover { color: #e4e4e7; background: #33343a; }
      .panel-btn-primary {
        color: #818cf8;
        border-color: rgba(99,102,241,0.3);
      }
      .panel-btn-primary:hover {
        background: rgba(99,102,241,0.15);
      }

      .panel-body {
        padding: 12px 14px;
        max-height: 50vh;
        overflow-y: auto;
        background: #1a1b1e;
      }

      .panel-body pre {
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'Cascadia Code','Fira Code','JetBrains Mono',monospace;
        font-size: 12px;
        line-height: 1.6;
        color: #d4d4d8;
      }

      .panel-status {
        padding: 6px 14px;
        font-size: 11px;
        color: #22c55e;
        background: rgba(34,197,94,0.08);
        border-top: 1px solid #3a3b42;
      }

      .panel-hint {
        padding: 8px 14px;
        font-size: 11px;
        color: #71717a;
        border-top: 1px solid #3a3b42;
      }
      .panel-hint kbd {
        display: inline-block;
        padding: 1px 5px;
        background: #2a2b30;
        border: 1px solid #3a3b42;
        border-radius: 3px;
        font-size: 10px;
        font-family: inherit;
        color: #a1a1aa;
      }

      .loading-spinner {
        display: inline-block;
        width: 14px; height: 14px;
        border: 2px solid #3a3b42;
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #3a3b42; border-radius: 3px; }
    `;
    shadow.appendChild(style);

    document.body.appendChild(host);
    makeDraggable(host, shadow.querySelector('.panel-header'));
  }

  function showPanel(title, content, type, context) {
    ensurePanel();

    const badgeClass = type === 'prompt' ? 'badge-prompt'
                     : type === 'result' ? 'badge-result'
                     : type === 'error'  ? 'badge-error'
                     : type === 'loading'? 'badge-loading'
                     : 'badge-info';

    const badgeText = type === 'prompt' ? 'Промпт'
                    : type === 'result' ? 'Результат'
                    : type === 'loading'? 'Генерация...'
                    : type === 'error'  ? 'Ошибка'
                    : 'Info';

    const headerHtml = `
      <div class="panel-title">
        <span class="panel-badge ${badgeClass}">${badgeText}</span>
        ${escapeHtml(title)}
        ${type === 'loading' ? '<span class="loading-spinner"></span>' : ''}
      </div>
      <div class="panel-actions">
        <button class="panel-btn panel-btn-primary btn-copy-panel" title="Копировать">Копировать</button>
        <button class="panel-btn btn-close-panel" title="Закрыть">✕</button>
      </div>
    `;

    // Собрать отладочную информацию
    let debugHtml = '';
    if (context) {
      debugHtml = `
        <div style="margin-bottom:8px; padding:8px; background:#28292e; border-radius:6px; font-size:11px; color:#71717a; line-height:1.6;">
          <div><strong style="color:#a1a1aa">Post ID:</strong> ${escapeHtml(context.postId)}</div>
          <div><strong style="color:#a1a1aa">Author:</strong> ${escapeHtml(context.authorName)}</div>
          <div><strong style="color:#a1a1aa">Post text:</strong> ${context.postText ? escapeHtml(context.postText.slice(0, 100)) + (context.postText.length > 100 ? '...' : '') : '(empty)'}</div>
          <div><strong style="color:#a1a1aa">Comments:</strong> ${context.comments.length}</div>
        </div>
      `;
    }

    const bodyHtml = `
      <div class="panel-header">${headerHtml}</div>
      <div class="panel-body">${debugHtml}<pre>${escapeHtml(content)}</pre></div>
      <div class="panel-hint">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> — собрать промпт &nbsp;
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> — генерация
      </div>
    `;

    panelEl.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = panelEl.host?.closest('#commenter-panel-host')?.shadowRoot?.querySelector('style')?.textContent || '';

    // Re-create structure
    const wrapper = document.createElement('div');
    wrapper.className = 'panel';
    wrapper.innerHTML = bodyHtml;

    // Re-attach style (it was cleared with innerHTML='')
    const newStyle = document.createElement('style');
    newStyle.textContent = `*{margin:0;padding:0;box-sizing:border-box}.panel{background:#1e1f23;border:1px solid #3a3b42;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden;font-size:13px;color:#e4e4e7;line-height:1.5}.panel-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#28292e;border-bottom:1px solid #3a3b42}.panel-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}.panel-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600}.badge-prompt{background:rgba(99,102,241,0.15);color:#818cf8}.badge-result{background:rgba(34,197,94,0.15);color:#4ade80}.badge-error{background:rgba(239,68,68,0.15);color:#f87171}.badge-loading{background:rgba(245,158,11,0.15);color:#fbbf24}.badge-info{background:rgba(59,130,246,0.15);color:#60a5fa}.panel-actions{display:flex;gap:4px}.panel-btn{padding:4px 8px;font-size:11px;font-weight:600;color:#a1a1aa;background:none;border:1px solid #3a3b42;border-radius:5px;cursor:pointer;font-family:inherit}.panel-btn:hover{color:#e4e4e7;background:#33343a}.panel-btn-primary{color:#818cf8;border-color:rgba(99,102,241,0.3)}.panel-btn-primary:hover{background:rgba(99,102,241,0.15)}.panel-body{padding:12px 14px;max-height:50vh;overflow-y:auto;background:#1a1b1e}.panel-body pre{white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:12px;line-height:1.6;color:#d4d4d8}.panel-hint{padding:8px 14px;font-size:11px;color:#71717a;border-top:1px solid #3a3b42}.panel-hint kbd{display:inline-block;padding:1px 5px;background:#2a2b30;border:1px solid #3a3b42;border-radius:3px;font-size:10px;font-family:inherit;color:#a1a1aa}.loading-spinner{display:inline-block;width:14px;height:14px;border:2px solid #3a3b42;border-top-color:#6366f1;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#3a3b42;border-radius:3px}`;
    panelEl.appendChild(newStyle);
    panelEl.appendChild(wrapper);

    // События кнопок
    const host = document.getElementById('commenter-panel-host');

    wrapper.querySelector('.btn-copy-panel')?.addEventListener('click', () => {
      navigator.clipboard.writeText(content).catch(() => {});
      const btn = wrapper.querySelector('.btn-copy-panel');
      btn.textContent = 'Скопировано!';
      setTimeout(() => { btn.textContent = 'Копировать'; }, 1500);
    });

    wrapper.querySelector('.btn-close-panel')?.addEventListener('click', () => {
      hidePanel();
    });

    panelVisible = true;
  }

  function updatePanelStatus(text) {
    if (!panelEl) return;
    const existing = panelEl.querySelector('.panel-status');
    if (existing) {
      existing.textContent = text;
    } else {
      const panel = panelEl.querySelector('.panel');
      if (panel) {
        const status = document.createElement('div');
        status.className = 'panel-status';
        status.textContent = text;
        panel.appendChild(status);
      }
    }
  }

  function hidePanel() {
    const host = document.getElementById('commenter-panel-host');
    if (host) host.remove();
    panelEl = null;
    panelVisible = false;
  }

  // ── Drag & Drop для панели ───────────────

  function makeDraggable(hostEl, handleEl) {
    let isDragging = false;
    let offsetX, offsetY;

    handleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      const rect = hostEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', stopDrag);
    });

    function onDrag(e) {
      if (!isDragging) return;
      hostEl.style.left = (e.clientX - offsetX) + 'px';
      hostEl.style.top = (e.clientY - offsetY) + 'px';
      hostEl.style.right = 'auto';
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

  function isReplyField(el) {
    if (!el || !el.hasAttribute) return false;
    return el.hasAttribute('contenteditable') &&
           el.id && el.id.startsWith('reply_field');
  }

  function cleanText(el) {
    // Получить текст, убрав лишние пробелы и пустые строки
    return el.textContent
      .replace(/\s+/g, ' ')
      .replace(/\. /g, '.\n')
      .trim();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function logContext(ctx) {
    console.log(`[Commenter] Context extracted:`);
    console.log(`  Post ID: ${ctx.postId}`);
    console.log(`  Author:  ${ctx.authorName}`);
    console.log(`  Text:    ${ctx.postText?.slice(0, 200)}${ctx.postText?.length > 200 ? '...' : ''}`);
    console.log(`  Comments: ${ctx.comments.length}`);
    ctx.comments.forEach((c, i) => {
      console.log(`    ${i + 1}. ${c.author}: ${c.text?.slice(0, 80)}`);
    });
  }

  // ── Обёртки для chrome.storage ───────────
  // (в content scripts Storage не доступен через window.Storage,
  //  используем chrome.storage напрямую)

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
