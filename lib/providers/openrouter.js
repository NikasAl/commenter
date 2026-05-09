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
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
      { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
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
        model: model || 'openai/gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API ошибка (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
  }
}

if (typeof window !== 'undefined') {
  window.OpenRouterProvider = OpenRouterProvider;
}
