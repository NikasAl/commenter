/**
 * Storage layer для Commenter
 * Управление темами, тезисами и настройками через chrome.storage.local
 */

const Storage = {
  KEYS: {
    TOPICS: 'commenter_topics',
    SETTINGS: 'commenter_settings',
  },

  // ── Настройки ──────────────────────────────────────────────

  async getSettings() {
    const result = await chrome.storage.local.get(this.KEYS.SETTINGS);
    return result[this.KEYS.SETTINGS] || {
      provider: 'z-ai',
      apiKey: '',
      model: '',
      zaiModel: '',
      openrouterModel: '',
    };
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
