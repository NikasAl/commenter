/**
 * Commenter — Viewer (Flashcards)
 * Полноэкранный просмотрщик тезисов для запоминания.
 *
 * Управление:
 *   ← → или свайп — следующая/предыдущая карточка
 *   Пробел / клик — перевернуть карточку
 *   E — редактировать
 *   Delete — удалить
 */

(async () => {
  'use strict';

  // ═══════════════════════════════════════════
  //  СОСТОЯНИЕ
  // ═══════════════════════════════════════════

  let allTopics = [];
  let allCards = [];          // [{ topicId, topicName, thesisId, question, answer }]
  let filteredCards = [];     // после фильтра по теме
  let currentIndex = 0;
  let currentTopicFilter = '__all__';

  // DOM
  const $topicFilter   = document.getElementById('topic-filter');
  const $counter       = document.getElementById('card-counter');
  const $emptyState    = document.getElementById('empty-state');
  const $cardWrapper   = document.getElementById('card-wrapper');
  const $flashcard     = document.getElementById('flashcard');
  const $topicBadge    = document.getElementById('card-topic-badge');
  const $cardNumber    = document.getElementById('card-number');
  const $question      = document.getElementById('card-question');
  const $answer        = document.getElementById('card-answer');
  const $prev          = document.getElementById('btn-prev');
  const $next          = document.getElementById('btn-next');
  const $navDots       = document.getElementById('nav-dots');
  const $cardNav       = document.getElementById('card-nav');
  const $progressBar   = document.getElementById('progress-bar');
  const $progressFill  = document.getElementById('progress-fill');
  const $editModal     = document.getElementById('edit-modal');
  const $deleteModal   = document.getElementById('delete-modal');
  const $toast         = document.getElementById('toast');

  // ═══════════════════════════════════════════
  //  ЗАГРУЗКА ДАННЫХ
  // ═══════════════════════════════════════════

  async function loadData() {
    allTopics = await Storage.getTopics();
    buildTopicSelector();
    buildCardList();
    renderCurrentCard();
  }

  function buildTopicSelector() {
    // Сохраняем текущий выбор
    const prev = $topicFilter.value;
    $topicFilter.innerHTML = '<option value="__all__">Все темы</option>';
    allTopics.forEach(t => {
      const cnt = (t.theses || []).length;
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = cnt > 0 ? `${t.name} (${cnt})` : t.name;
      $topicFilter.appendChild(opt);
    });
    // Восстановить выбор, если тема ещё существует
    if (prev && allTopics.some(t => t.id === prev)) {
      $topicFilter.value = prev;
    } else if (allTopics.some(t => t.id === currentTopicFilter)) {
      $topicFilter.value = currentTopicFilter;
    } else {
      $topicFilter.value = '__all__';
      currentTopicFilter = '__all__';
    }
  }

  function buildCardList() {
    allCards = [];
    for (const topic of allTopics) {
      if (!topic.theses || !topic.theses.length) continue;
      for (const thesis of topic.theses) {
        allCards.push({
          topicId: topic.id,
          topicName: topic.name,
          thesisId: thesis.id,
          question: thesis.question || '(без вопроса)',
          answer: thesis.answer || '(без ответа)',
        });
      }
    }
    applyFilter();
  }

  function applyFilter() {
    if (currentTopicFilter === '__all__') {
      filteredCards = [...allCards];
    } else {
      filteredCards = allCards.filter(c => c.topicId === currentTopicFilter);
    }
    // Корректируем индекс
    if (filteredCards.length === 0) {
      currentIndex = 0;
    } else if (currentIndex >= filteredCards.length) {
      currentIndex = filteredCards.length - 1;
    }
  }

  // ═══════════════════════════════════════════
  //  РЕНДЕРИНГ
  // ═══════════════════════════════════════════

  function renderCurrentCard() {
    const hasCards = filteredCards.length > 0;

    $emptyState.style.display = hasCards ? 'none' : 'flex';
    $cardWrapper.style.display = hasCards ? 'flex' : 'none';
    $cardNav.style.display = hasCards ? 'flex' : 'none';
    $progressBar.style.display = hasCards ? 'block' : 'none';

    if (!hasCards) {
      $counter.textContent = '0 / 0';
      return;
    }

    const card = filteredCards[currentIndex];

    // Сбросить флип
    $flashcard.classList.remove('is-flipped');

    // Тема
    $topicBadge.textContent = card.topicName;

    // Номер
    $cardNumber.textContent = `${currentIndex + 1} из ${filteredCards.length}`;

    // Счётчик в хедере
    $counter.textContent = `${currentIndex + 1} / ${filteredCards.length}`;

    // Текст
    $question.textContent = card.question;
    $answer.textContent = card.answer;

    // Кнопки навигации
    $prev.disabled = currentIndex === 0;
    $next.disabled = currentIndex === filteredCards.length - 1;

    // Точки
    renderDots();

    // Прогресс
    const pct = ((currentIndex + 1) / filteredCards.length) * 100;
    $progressFill.style.width = pct + '%';

    // Перезапуск анимации
    $cardWrapper.style.animation = 'none';
    $cardWrapper.offsetHeight; // reflow
    $cardWrapper.style.animation = '';
  }

  function renderDots() {
    $navDots.innerHTML = '';

    if (filteredCards.length <= 30) {
      // Показываем все точки
      filteredCards.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = 'nav-dot' + (i === currentIndex ? ' active' : '');
        dot.addEventListener('click', () => goToCard(i));
        $navDots.appendChild(dot);
      });
    } else {
      // Для большого количества — показываем сгруппированные
      const groupSize = Math.ceil(filteredCards.length / 20);
      const groupCount = Math.ceil(filteredCards.length / groupSize);
      for (let g = 0; g < groupCount; g++) {
        const start = g * groupSize;
        const end = Math.min(start + groupSize, filteredCards.length);
        const isActive = currentIndex >= start && currentIndex < end;
        const dot = document.createElement('span');
        dot.className = 'nav-dot' + (isActive ? ' active' : '');
        dot.title = `${start + 1}–${end}`;
        dot.addEventListener('click', () => goToCard(start));
        $navDots.appendChild(dot);
      }
    }
  }

  // ═══════════════════════════════════════════
  //  НАВИГАЦИЯ
  // ═══════════════════════════════════════════

  function goToCard(index) {
    if (index < 0 || index >= filteredCards.length) return;
    currentIndex = index;
    renderCurrentCard();
  }

  function goNext() {
    if (currentIndex < filteredCards.length - 1) {
      currentIndex++;
      renderCurrentCard();
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentCard();
    }
  }

  function flipCard() {
    $flashcard.classList.toggle('is-flipped');
  }

  // ═══════════════════════════════════════════
  //  РЕДАКТИРОВАНИЕ
  // ═══════════════════════════════════════════

  let editingCard = null;

  function openEditModal() {
    if (filteredCards.length === 0) return;
    editingCard = filteredCards[currentIndex];

    document.getElementById('edit-question').value = editingCard.question;
    document.getElementById('edit-answer').value = editingCard.answer;
    $editModal.style.display = 'flex';

    setTimeout(() => document.getElementById('edit-question').focus(), 100);
  }

  function closeEditModal() {
    $editModal.style.display = 'none';
    editingCard = null;
  }

  async function saveEdit() {
    if (!editingCard) return;

    const newQ = document.getElementById('edit-question').value.trim();
    const newA = document.getElementById('edit-answer').value.trim();

    if (!newQ && !newA) return;

    // Найти тезис в topics и обновить
    const topic = allTopics.find(t => t.id === editingCard.topicId);
    if (!topic) return;

    const thesis = topic.theses.find(t => t.id === editingCard.thesisId);
    if (!thesis) return;

    thesis.question = newQ;
    thesis.answer = newA;

    await Storage.saveTopics(allTopics);

    // Обновить текущую карточку в памяти
    editingCard.question = newQ || '(без вопроса)';
    editingCard.answer = newA || '(без ответа)';

    // Обновить и в allCards
    const allCard = allCards.find(c => c.topicId === editingCard.topicId && c.thesisId === editingCard.thesisId);
    if (allCard) {
      allCard.question = editingCard.question;
      allCard.answer = editingCard.answer;
    }

    renderCurrentCard();
    closeEditModal();
    showToast('Тезис обновлён');
  }

  // ═══════════════════════════════════════════
  //  УДАЛЕНИЕ
  // ═══════════════════════════════════════════

  let deletingCard = null;

  function openDeleteModal() {
    if (filteredCards.length === 0) return;
    deletingCard = filteredCards[currentIndex];

    document.getElementById('delete-confirm-text').textContent =
      `Удалить тезис из темы «${deletingCard.topicName}»?\n\n${deletingCard.question}`;
    $deleteModal.style.display = 'flex';
  }

  function closeDeleteModal() {
    $deleteModal.style.display = 'none';
    deletingCard = null;
  }

  async function confirmDelete() {
    if (!deletingCard) return;

    const topic = allTopics.find(t => t.id === deletingCard.topicId);
    if (!topic) return;

    topic.theses = (topic.theses || []).filter(t => t.id !== deletingCard.thesisId);
    await Storage.saveTopics(allTopics);

    closeDeleteModal();

    // Перестроить списки
    buildTopicSelector();
    buildCardList();
    renderCurrentCard();

    showToast('Тезис удалён');
  }

  // ═══════════════════════════════════════════
  //  ТОСТ
  // ═══════════════════════════════════════════

  let toastTimer = null;
  function showToast(text) {
    $toast.textContent = text;
    $toast.style.display = 'block';
    $toast.style.animation = 'none';
    $toast.offsetHeight;
    $toast.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.style.display = 'none'; }, 2200);
  }

  // ═══════════════════════════════════════════
  //  СОБЫТИЯ
  // ═══════════════════════════════════════════

  // Фильтр темы
  $topicFilter.addEventListener('change', () => {
    currentTopicFilter = $topicFilter.value;
    currentIndex = 0;
    applyFilter();
    renderCurrentCard();
  });

  // Флип карточки
  $flashcard.addEventListener('click', flipCard);

  // Навигация кнопки
  $prev.addEventListener('click', goPrev);
  $next.addEventListener('click', goNext);

  // Редактирование / удаление
  document.getElementById('btn-edit').addEventListener('click', openEditModal);
  document.getElementById('btn-delete').addEventListener('click', openDeleteModal);

  // Модалка редактирования
  document.getElementById('modal-close').addEventListener('click', closeEditModal);
  document.getElementById('btn-edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('btn-edit-save').addEventListener('click', saveEdit);
  $editModal.querySelector('.modal-overlay').addEventListener('click', closeEditModal);

  // Модалка удаления
  document.getElementById('delete-modal-close').addEventListener('click', closeDeleteModal);
  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('btn-delete-confirm').addEventListener('click', confirmDelete);
  $deleteModal.querySelector('.modal-overlay').addEventListener('click', closeDeleteModal);

  // Клавиатура
  document.addEventListener('keydown', (e) => {
    // Не перехватываем, если фокус в textarea/input
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      goNext();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flipCard();
    } else if (e.key === 'e' || e.key === 'E') {
      openEditModal();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      openDeleteModal();
    } else if (e.key === 'Escape') {
      closeEditModal();
      closeDeleteModal();
    }
  });

  // Тач-свайп
  let touchStartX = 0;
  let touchStartY = 0;
  let touchHandled = false;

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    touchHandled = false;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (touchHandled) return;
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;

    // Только горизонтальный свайп
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;

    if (dx > 0) goPrev();
    else goNext();
  }, { passive: true });

  // Блокируем клик по карточке после свайпа, чтобы не флипать
  document.addEventListener('touchmove', () => { touchHandled = true; }, { passive: true });

  // ═══════════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════════

  await loadData();

})();
