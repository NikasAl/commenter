import { ProviderBase } from './provider-base.js';

/**
 * Провайдер GigaChat (Сбер)
 * Аутентификация: OAuth2 (client_id:client_secret) → JWT access_token
 * API: OpenAI-совместимый (https://gigachat.devices.sberbank.ru/api/v1/...)
 *
 * Настройки хранятся в ps.clientId и ps.clientSecret
 * (ps.apiKey не используется — авторизация через OAuth)
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
      { id: 'GigaChat-2', name: 'GigaChat-2' },
      { id: 'GigaChat-2-mini', name: 'GigaChat-2 Mini' },
      { id: 'GigaChat', name: 'GigaChat' },
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
   */
  async _getAccessToken(clientId, clientSecret) {
    // Проверяем кэш
    if (this._tokenCache && Date.now() < this._tokenCache.expiresAt) {
      return this._tokenCache.token;
    }

    const rqUid = this._uuid();
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    const response = await fetch(this.oauthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': rqUid,
        'Authorization': `Basic ${basicAuth}`,
      },
      body: 'scope=GIGACHAT_API_PERS',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GigaChat OAuth ошибка (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const token = data.access_token;
    // expires_at — timestamp в секундах, делаем запас 60 секунд
    const expiresAt = (data.expires_at || Math.floor(Date.now() / 1000) + 1800) * 1000 - 60000;

    this._tokenCache = { token, expiresAt };
    return token;
  }

  /**
   * Отправить чат-запрос к GigaChat
   * @param {Object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userMessage
   * @param {Object} params.apiKey — не используется, нужен clientId/clientSecret
   *   На самом деле apiKey здесь приходит как JSON-строка с {clientId, clientSecret}
   *   от service-worker.
   * @param {string} params.model
   */
  async chat({ systemPrompt, userMessage, apiKey, model }) {
    // GigaChat использует clientId/clientSecret вместо apiKey.
    // Они передаются через поля ps.gigachatClientId и ps.gigachatClientSecret
    // в настройках. Сервис-воркер передаёт их через apiKey как JSON.
    let clientId, clientSecret;
    try {
      const creds = JSON.parse(apiKey || '{}');
      clientId = creds.clientId || '';
      clientSecret = creds.clientSecret || '';
    } catch {
      clientId = '';
      clientSecret = '';
    }

    if (!clientId || !clientSecret) {
      throw new Error('CLIENT_ID и CLIENT_SECRET не настроены для GigaChat. Откройте настройки расширения.');
    }

    const accessToken = await this._getAccessToken(clientId, clientSecret);

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
        const newToken = await this._getAccessToken(clientId, clientSecret);
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