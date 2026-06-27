import { ProviderBase } from './provider-base.js';

/**
 * Провайдер GigaChat (Сбер)
 * Аутентификация: OAuth2 через готовый ключ авторизации (Base64)
 * API: OpenAI-совместимый (https://gigachat.devices.sberbank.ru/api/v1/...)
 *
 * Настройки: ps.gigachatAuthKey — готовый Base64-ключ из личного кабинета Sber
 * Отправляется напрямую в заголовке Authorization: Basic <ключ>
 */
class GigaChatProvider extends ProviderBase {
  constructor() {
    super('gigachat');
    this.baseUrl = 'https://gigachat.devices.sberbank.ru/api/v1';
    this.oauthUrl = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
    // Кэш токена: { token, expiresAt }
    this._tokenCache = null;
  }

  getModels() {
    return [
      { id: 'GigaChat-2-Max', name: 'GigaChat-2 Max' },
      { id: 'GigaChat-Max', name: 'GigaChat Max' },
      { id: 'GigaChat-2-Pro', name: 'GigaChat-2 Pro' },
      { id: 'GigaChat-Pro', name: 'GigaChat Pro' },
      { id: 'GigaChat-2', name: 'GigaChat-2' },
      { id: 'GigaChat', name: 'GigaChat' },
      { id: 'GigaChat-Plus', name: 'GigaChat Plus' },
      { id: 'GigaChat-2-Lite', name: 'GigaChat-2 Lite' },
      { id: 'GigaChat-Lite', name: 'GigaChat Lite' },
    ];
  }

  /**
   * Получить UUID v4 (для заголовка RqUID)
   */
  _uuid() {
    return crypto.randomUUID?.() ||
      ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
  }

  /**
   * Получить access_token через OAuth2.
   * Кэширует токен до истечения срока действия.
   *
   * @param {string} authKey — готовый Base64-ключ авторизации из личного кабинета Sber
   */
  async _getAccessToken(authKey) {
    // Проверяем кэш
    if (this._tokenCache && Date.now() < this._tokenCache.expiresAt) {
      return this._tokenCache.token;
    }

    const rqUid = this._uuid();

    const response = await fetch(this.oauthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': rqUid,
        'Authorization': `Basic ${authKey}`,
      },
      body: 'scope=GIGACHAT_API_PERS',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GigaChat OAuth ошибка (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const token = data.access_token;
    // expires_at — unix timestamp в миллисекундах, делаем запас 60 секунд
    const expiresAt = (data.expires_at || Math.floor(Date.now() / 1000) + 1800) - 60;

    this._tokenCache = { token, expiresAt };
    return token;
  }

  /**
   * Отправить чат-запрос к GigaChat
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userMessage
   * @param {string} params.apiKey — готовый Base64-ключ авторизации из настроек
   * @param {string} params.model
   */
  async chat({ systemPrompt, userMessage, apiKey, model }) {
    // apiKey здесь — это готовый ключ авторизации (Base64) из настроек
    const authKey = (apiKey || '').trim();

    if (!authKey) {
      throw new Error('Ключ авторизации GigaChat не настроен. Откройте настройки расширения.');
    }

    const accessToken = await this._getAccessToken(authKey);

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
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: model || 'GigaChat-2',
        messages,
        temperature: 0.7,
        max_tokens: 10000,
      }),
      signal: AbortSignal.timeout(300000), // 5 минут
    });

    if (!response.ok) {
      // Если 401 — токен протух, сбрасываем кэш и пробуем ещё раз
      if (response.status === 401) {
        this._tokenCache = null;
        const newToken = await this._getAccessToken(authKey);
        const retry = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`,
          },
          body: JSON.stringify({
            model: model || 'GigaChat-2',
            messages,
            temperature: 0.7,
            max_tokens: 10000,
          }),
          signal: AbortSignal.timeout(300000),
        });
        if (!retry.ok) {
          const errorText = await retry.text();
          throw new Error(`GigaChat ошибка (${retry.status}): ${errorText}`);
        }
        const data = await retry.json();
        return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
      }

      const errorText = await response.text();
      throw new Error(`GigaChat ошибка (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Нет ответа от модели';
  }
}

export { GigaChatProvider };

if (typeof window !== 'undefined') {
  window.GigaChatProvider = GigaChatProvider;
}