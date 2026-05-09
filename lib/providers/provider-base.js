/**
 * Базовый класс для LLM провайдеров
 */
class ProviderBase {
  constructor(name) {
    this.name = name;
  }

  /**
   * Отправить запрос к LLM
   * @param {Object} params
   * @param {string} params.systemPrompt - системный промпт
   * @param {string} params.userMessage - сообщение пользователя
   * @param {string} params.apiKey - API ключ
   * @param {string} params.model - название модели
   * @returns {Promise<string>} текст ответа
   */
  async chat({ systemPrompt, userMessage, apiKey, model }) {
    throw new Error('Method chat() must be implemented');
  }

  /**
   * Получить список доступных моделей
   * @returns {Array<{id: string, name: string}>}
   */
  getModels() {
    throw new Error('Method getModels() must be implemented');
  }

  /**
   * Собрать системный промпт из тезисов темы
   * @param {string} topicName
   * @param {Array<{question: string, answer: string}>} theses
   * @returns {string}
   */
  buildSystemPrompt(topicName, theses) {
    if (!theses.length) {
      return `Ты — полезный ассистент. Отвечай на вопросы вежливо и по существу.`;
    }

    let prompt = `Ты — эксперт по теме "${topicName}". Используй приведённые ниже тезисы для формирования ответа. `;
    prompt += `Твой ответ должен быть аргументированным, опираться на тезисы, но звучать естественно, а не как цитата из справочника. `;
    prompt += `Если тезисы не покрывают вопрос полностью, можешь дополнить ответ своими знаниями, но в первую очередь используй тезисы.\n\n`;
    prompt += `=== ТЕЗИСЫ ===\n`;

    for (let i = 0; i < theses.length; i++) {
      const t = theses[i];
      prompt += `\n[Тезис ${i + 1}]\n`;
      prompt += `Вопрос: ${t.question}\n`;
      prompt += `Ответ: ${t.answer}\n`;
    }

    prompt += `\n=== КОНЕЦ ТЕЗИСОВ ===\n\n`;
    prompt += `Формулируй ответ на русском языке. Пиши понятно и лаконично.`;

    return prompt;
  }
}

if (typeof window !== 'undefined') {
  window.ProviderBase = ProviderBase;
}
