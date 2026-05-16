/**
 * Commenter — Popup (минимальная версия)
 * Только ссылка на полную страницу + горячие клавиши
 */

document.addEventListener('DOMContentLoaded', () => {
  const openOptions = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  };

  document.getElementById('btn-open-options')?.addEventListener('click', openOptions);
  document.getElementById('btn-open-options-main')?.addEventListener('click', openOptions);
});
