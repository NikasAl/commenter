import { ProviderBase } from './provider-base.js';

/**
 * Провайдер Z-AI
 * Использует совместимый с OpenAI API формат
 */
class ZAiProvider extends ProviderBase {
  constructor() {
    super('z-ai');
    this.baseUrl = 'https://api.z.ai/api/paas/v4';
  }

  getModels() {
    return [
      { id: 'GLM-4.7-Flash', name: 'GLM-4.7-Flash' },
      { id: 'GLM-4.7', name: 'GLM-4.7' },
      { id: 'GLM-5.1-Turbo', name: 'GLM-5.1-Turbo' },
    ];
  }

  async chat({ systemPrompt, userMessage, apiKey, model }) {
    if (!apiKey) throw new Error('API ключ Z-AI не указан');

    const url = `${this.baseUrl}/chat/completions`;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userMessage });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'GLM-4.7-Flash',
        messages,
        temperature: 0.7,
        max_tokens: 10000,
      }),
      signal: AbortSignal.timeout(300000), // 5 минут
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Z-AI API ошибка (${response.status}): ${errorText}`);
    }

    if (response.aborted) {
      throw new Error('Запрос к Z-AI API превысил таймаут (5 минут). Попробуйте сократить промпт или выбрать более быструю модель.');
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
  }
}

export { ZAiProvider };

if (typeof window !== 'undefined') {
  window.ZAiProvider = ZAiProvider;
}
