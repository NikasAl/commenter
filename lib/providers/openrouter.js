import { ProviderBase } from './provider-base.js';

/**
 * Провайдер OpenRouter
 * Использует совместимый с OpenAI API формат
 */
class OpenRouterProvider extends ProviderBase {
  constructor() {
    super('openrouter');
    this.baseUrl = 'https://openrouter.ai/api/v1';
  }

  getModels() {
    return [
      { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B IT' },
      { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
      { id: 'microsoft/phi-4', name: 'Phi-4' },
      { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'google/gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite' },
      { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
      { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash (free)' },
      { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'Nemotron Nano Omni 30B (free)' },
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron Super 120B (free)' },
      { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 Llama 3.1 405B (free)' },
    ];
  }

  async chat({ systemPrompt, userMessage, apiKey, model }) {
    if (!apiKey) throw new Error('API ключ OpenRouter не указан');

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
        'HTTP-Referer': 'chrome-extension://commenter',
        'X-Title': 'Commenter Extension',
      },
      body: JSON.stringify({
        model: model || 'google/gemini-2.0-flash-001',
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(300000), // 5 минут
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API ошибка (${response.status}): ${errorText}`);
    }

    if (response.aborted) {
      throw new Error('Запрос к OpenRouter API превысил таймаут (5 минут). Попробуйте сократить промпт или выбрать более быструю модель.');
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
  }
}

export { OpenRouterProvider };

if (typeof window !== 'undefined') {
  window.OpenRouterProvider = OpenRouterProvider;
}
