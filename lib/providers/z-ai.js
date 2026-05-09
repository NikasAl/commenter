import { ProviderBase } from './provider-base.js';

/**
 * Провайдер Z-AI
 * Использует совместимый с OpenAI API формат
 */
class ZAiProvider extends ProviderBase {
  constructor() {
    super('z-ai');
    this.baseUrl = 'https://api.z-ai.io/v1';
  }

  getModels() {
    return [
      { id: 'glm-4-plus', name: 'GLM-4 Plus' },
      { id: 'glm-4', name: 'GLM-4' },
      { id: 'glm-4-flash', name: 'GLM-4 Flash (быстрая)' },
      { id: 'glm-4-long', name: 'GLM-4 Long (длинный контекст)' },
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
        model: model || 'glm-4-plus',
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Z-AI API ошибка (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
  }
}

export { ZAiProvider };

if (typeof window !== 'undefined') {
  window.ZAiProvider = ZAiProvider;
}
