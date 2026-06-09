/**
 * Background Service Worker для Commenter
 * Обрабатывает API-запросы к LLM провайдерам
 */

// Импорт провайдеров (ES Modules)
import { ZAiProvider } from '../lib/providers/z-ai.js';
import { OpenRouterProvider } from '../lib/providers/openrouter.js';
import { LocalProvider } from '../lib/providers/local.js';

// Инициализация провайдеров
const providers = {
  'z-ai': new ZAiProvider(),
  'openrouter': new OpenRouterProvider(),
  'local': new LocalProvider(),
};

// Слушатель сообщений от popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHAT_REQUEST') {
    handleChatRequest(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Асинхронный ответ
  }

  if (message.type === 'GET_MODELS') {
    const providerName = message.payload?.provider;
    const provider = providers[providerName];
    if (provider) {
      sendResponse({ success: true, data: provider.getModels() });
    } else {
      sendResponse({ success: false, error: `Провайдер ${providerName} не найден` });
    }
    return false;
  }
});

/**
 * Обработка чат-запроса к LLM
 */
async function handleChatRequest(payload) {
  const { provider: providerName, apiKey, model, systemPrompt, userMessage, baseUrl } = payload;
  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`Провайдер "${providerName}" не поддерживается`);
  }

  // Для локального провайдера устанавливаем baseUrl из настроек
  if (providerName === 'local' && baseUrl) {
    provider.setBaseUrl(baseUrl);
  }

  // Локальный провайдер может работать без API ключа
  if (providerName !== 'local' && !apiKey) {
    throw new Error(`API ключ не указан для провайдера "${providerName}"`);
  }

  try {
    const response = await provider.chat({
      systemPrompt,
      userMessage,
      apiKey,
      model,
    });
    return response;
  } catch (err) {
    // Улучшаем сообщение об ошибке: добавляем URL, провайдер, модель
    const url = provider.baseUrl + '/chat/completions';
 const modelInfo = model ? `модель: ${model}` : 'модель по умолчанию';
    console.error(`[Commenter] LLM request failed:`, {
      provider: providerName,
      url,
      model: modelInfo,
      error: err.message,
      errorType: err.constructor.name,
    });
    // TimeoutError — fetch превысил таймаут
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`Превышен таймаут ожидания ответа от ${providerName} API (${url}). ${modelInfo}. Сервер не ответил за 5 минут.`);
    }
    // Если ошибка TypeError ("Failed to fetch") — это сетевая проблема
    if (err instanceof TypeError) {
      throw new Error(`Сетевая ошибка при обращении к ${providerName} API (${url}). Проверьте подключение к интернету и доступность сервера. ${modelInfo}.\nДетали: ${err.message}`);
    }
    throw err;
  }
}
