/**
 * Storage layer для Commenter
 * Управление темами, тезисами и настройками через chrome.storage.local
 */

const Storage = {
  KEYS: {
    TOPICS: 'commenter_topics',
    SETTINGS: 'commenter_settings',
    TEMPLATES: 'commenter_templates',
  },

  DEFAULT_MODELS: {
    'z-ai': [
      { id: 'GLM-4.7-Flash', name: 'GLM-4.7-Flash' },
      { id: 'GLM-4.7', name: 'GLM-4.7' },
      { id: 'GLM-5.1-Turbo', name: 'GLM-5.1-Turbo' },
    ],
    'local': [
      { id: 'gemma-4-26b', name: 'Gemma 4 26B' },
    ],
    'openrouter': [
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
    ],
  },

  // ── Шаблоны промптов ─────────────────────────────────────

  DEFAULT_TEMPLATES: [
    {
      id: '__default_expert__',
      name: 'Эксперт (по умолчанию)',
      content: `Ты — эксперт по теме "{{topic}}". Используй приведённые ниже тезисы для формирования ответа. Твой ответ должен быть аргументированным, опираться на тезисы, но звучать естественно, а не как цитата из справочника. Если тезисы не покрывают вопрос полностью, можешь дополнить ответ своими знаниями, но в первую очередь используй тезисы.

=== ТЕЗИСЫ ===
{{theses}}
=== КОНЕЦ ТЕЗИСОВ ===

Формулируй ответ на русском языке. Пиши понятно и лаконично. Сформулируй ответ на этот пост (и/или на комментарии), используя тезисы из системного промпта.`,
      isActive: true,
    },
  ],

  async getTemplates() {
    const result = await chrome.storage.local.get(this.KEYS.TEMPLATES);
    let templates = result[this.KEYS.TEMPLATES];

    // Миграция: если шаблонов нет, но есть старый systemPrompt — создаём первый шаблон
    if (!templates || templates.length === 0) {
      const settings = await this.getSettings();
      if (settings.systemPrompt) {
        templates = [
          {
            id: this._generateId(),
            name: 'Основной шаблон',
            content: settings.systemPrompt,
            isActive: true,
          },
        ];
        await this.saveTemplates(templates);
        // Очистить старое поле
        delete settings.systemPrompt;
        await this.saveSettings(settings);
        return templates;
      }
      // Совсем первый запуск — возвращаем дефолтные
      templates = this.DEFAULT_TEMPLATES.map(t => ({ ...t }));
      await this.saveTemplates(templates);
    }
    return templates;
  },

  async saveTemplates(templates) {
    await chrome.storage.local.set({ [this.KEYS.TEMPLATES]: templates });
  },

  async addTemplate(name, content) {
    const templates = await this.getTemplates();
    const newTemplate = {
      id: this._generateId(),
      name: name.trim(),
      content: content || '',
      isActive: false,
    };
    templates.push(newTemplate);
    await this.saveTemplates(templates);
    return newTemplate;
  },

  async updateTemplate(id, name, content) {
    const templates = await this.getTemplates();
    const tpl = templates.find(t => t.id === id);
    if (tpl) {
      tpl.name = name.trim();
      tpl.content = content;
      await this.saveTemplates(templates);
    }
    return tpl;
  },

  async deleteTemplate(id) {
    let templates = await this.getTemplates();
    const wasActive = templates.find(t => t.id === id)?.isActive;
    templates = templates.filter(t => t.id !== id);
    // Если удалили активный — сделать первый активным
    if (wasActive && templates.length > 0) {
      templates[0].isActive = true;
    }
    await this.saveTemplates(templates);
  },

  async setActiveTemplate(id) {
    const templates = await this.getTemplates();
    templates.forEach(t => { t.isActive = (t.id === id); });
    await this.saveTemplates(templates);
  },

  async getActiveTemplate() {
    const templates = await this.getTemplates();
    return templates.find(t => t.isActive) || templates[0] || null;
  },

  // ── Настройки ──────────────────────────────────────────────

  async getSettings() {
    const result = await chrome.storage.local.get(this.KEYS.SETTINGS);
    const raw = result[this.KEYS.SETTINGS];
    if (!raw) {
      return {
        provider: 'z-ai',
        thesisAutoSelect: false,
        providers: {
          'z-ai': { apiKey: '', model: '', customModelInput: '' },
          'local': { apiKey: '', model: '', customModelInput: '', baseUrl: 'http://turbo:8080' },
          'openrouter': { apiKey: '', model: '', customModelInput: '' },
        },
      };
    }
    // Миграция: старый формат с плоскими apiKey/model → providers
    if (!raw.providers) {
      const apiKey = raw.apiKey || '';
      const model = raw.model || '';
      const customModelInput = raw.customModelInput || '';
      raw.providers = {
        'z-ai': { apiKey: raw.provider === 'z-ai' ? apiKey : '', model: raw.provider === 'z-ai' ? (model || raw.zaiModel || '') : (raw.zaiModel || ''), customModelInput: raw.provider === 'z-ai' ? customModelInput : '' },
        'openrouter': { apiKey: raw.provider === 'openrouter' ? apiKey : '', model: raw.provider === 'openrouter' ? (model || raw.openrouterModel || '') : (raw.openrouterModel || ''), customModelInput: raw.provider === 'openrouter' ? customModelInput : '' },
      };
      delete raw.apiKey;
      delete raw.model;
      delete raw.zaiModel;
      delete raw.openrouterModel;
      delete raw.customModelInput;
      await this.saveSettings(raw);
    }
    if (!raw.providers['z-ai']) raw.providers['z-ai'] = { apiKey: '', model: '', customModelInput: '' };
    if (!raw.providers['local']) raw.providers['local'] = { apiKey: '', model: '', customModelInput: '', baseUrl: 'http://turbo:8080' };
    if (!raw.providers['openrouter']) raw.providers['openrouter'] = { apiKey: '', model: '', customModelInput: '' };
    return raw;
  },

  getProviderSettings(settings) {
    return settings.providers?.[settings.provider || 'z-ai'] || { apiKey: '', model: '', customModelInput: '' };
  },

  getApiKey(settings) {
    return this.getProviderSettings(settings).apiKey || '';
  },

  getModel(settings) {
    const ps = this.getProviderSettings(settings);
    return ps.customModelInput || ps.model || '';
  },

  getModelsForProvider(settings, providerName) {
    const ps = settings.providers?.[providerName || 'z-ai'];
    if (ps && ps.models && ps.models.length > 0) return ps.models;
    return this.DEFAULT_MODELS[providerName || 'z-ai'] || [];
  },

  resetModelsForProvider(settings, providerName) {
    const p = providerName || 'z-ai';
    if (!settings.providers) settings.providers = {};
    if (!settings.providers[p]) settings.providers[p] = {};
    delete settings.providers[p].models;
  },

  async saveSettings(settings) {
    await chrome.storage.local.set({ [this.KEYS.SETTINGS]: settings });
  },

  // ── Темы ───────────────────────────────────────────────────

  async getTopics() {
    const result = await chrome.storage.local.get(this.KEYS.TOPICS);
    return result[this.KEYS.TOPICS] || [];
  },

  async saveTopics(topics) {
    await chrome.storage.local.set({ [this.KEYS.TOPICS]: topics });
  },

  // ── CRUD операций ─────────────────────────────────────────

  async addTopic(name) {
    const topics = await this.getTopics();
    const topic = {
      id: this._generateId(),
      name: name.trim(),
      theses: [],
      createdAt: Date.now(),
    };
    topics.push(topic);
    await this.saveTopics(topics);
    return topic;
  },

  async updateTopic(id, name) {
    const topics = await this.getTopics();
    const topic = topics.find(t => t.id === id);
    if (topic) {
      topic.name = name.trim();
      await this.saveTopics(topics);
    }
    return topic;
  },

  async deleteTopic(id) {
    let topics = await this.getTopics();
    topics = topics.filter(t => t.id !== id);
    await this.saveTopics(topics);
  },

  // ── Тезисы (в рамках темы) ────────────────────────────────

  async addThesis(topicId, question, answer) {
    const topics = await this.getTopics();
    const topic = topics.find(t => t.id === topicId);
    if (!topic) throw new Error('Topic not found');

    const thesis = {
      id: this._generateId(),
      question: question.trim(),
      answer: answer.trim(),
      createdAt: Date.now(),
    };
    topic.theses.push(thesis);
    await this.saveTopics(topics);
    return thesis;
  },

  async updateThesis(topicId, thesisId, question, answer) {
    const topics = await this.getTopics();
    const topic = topics.find(t => t.id === topicId);
    if (!topic) throw new Error('Topic not found');

    const thesis = topic.theses.find(t => t.id === thesisId);
    if (thesis) {
      thesis.question = question.trim();
      thesis.answer = answer.trim();
      await this.saveTopics(topics);
    }
    return thesis;
  },

  async deleteThesis(topicId, thesisId) {
    const topics = await this.getTopics();
    const topic = topics.find(t => t.id === topicId);
    if (topic) {
      topic.theses = topic.theses.filter(t => t.id !== thesisId);
      await this.saveTopics(topics);
    }
  },

  async getTopicById(id) {
    const topics = await this.getTopics();
    return topics.find(t => t.id === id) || null;
  },

  // ── Утилиты ───────────────────────────────────────────────

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },
};

// Экспорт для использования в content scripts / popup
if (typeof window !== 'undefined') {
  window.Storage = Storage;
}
