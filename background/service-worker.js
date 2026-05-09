/**
 * Background Service Worker для Commenter
 * Обрабатывает API-запросы к LLM провайдерам
 */

// Импорт провайдеров (ES Modules)
import { ZAiProvider } from '../lib/providers/z-ai.js';
import { OpenRouterProvider } from '../lib/providers/openrouter.js';

// Инициализация провайдеров
const providers = {
  'z-ai': new ZAiProvider(),
  'openrouter': new OpenRouterProvider(),
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
  const { provider: providerName, apiKey, model, systemPrompt, userMessage } = payload;
  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`Провайдер "${providerName}" не поддерживается`);
  }

  const response = await provider.chat({
    systemPrompt,
    userMessage,
    apiKey,
    model,
  });

  return response;
}
