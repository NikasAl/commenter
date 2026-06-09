import { ProviderBase } from './provider-base.js';

/**
 * Провайдер для локального LLM сервера
 * Использует совместимый с OpenAI API формат
 * Адрес сервера настраивается пользователем (например http://turbo:8080)
 */
class LocalProvider extends ProviderBase {
  constructor() {
    super('local');
    this.baseUrl = ''; // настраивается пользователем
  }

  setBaseUrl(url) {
    // Убираем trailing slash
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getModels() {
    return [
      { id: 'gemma-4-26b', name: 'Gemma 4 26B' },
    ];
  }

  async chat({ systemPrompt, userMessage, apiKey, model }) {
    if (!this.baseUrl) {
      throw new Error('Адрес локального сервера не указан. Откройте настройки расширения.');
    }

    const url = `${this.baseUrl}/v1/chat/completions`;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userMessage });

    const headers = {
      'Content-Type': 'application/json',
    };
    // API ключ опционален для локального сервера
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gemma-4-26b',
        messages,
        temperature: 0.7,
        max_tokens: 10000,
      }),
      signal: AbortSignal.timeout(600000), // 10 минут (локальные модели могут быть медленнее)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Локальный сервер ошибка (${response.status}): ${errorText}`);
    }

    if (response.aborted) {
      throw new Error('Запрос к локальному серверу превысил таймаут (10 минут). Попробуйте сократить промпт.');
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
  }
}

export { LocalProvider };

if (typeof window !== 'undefined') {
  window.LocalProvider = LocalProvider;
}
