import { splitTranslationText, TRANSLATION_RULE_VERSION } from './translation-text.js';

export const MISSING_TRANSLATOR = '未检测到翻译服务。请前往「插件」启用「思考过程机器翻译」';
export const MIN_TRANSLATION_VERSION = '0.2.2-rc.2';
export const LANGUAGE_PATTERN = /^(?:auto|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$/;

export function supportsTranslation(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version ?? '');
  if (!match) {
    return false;
  }
  const core = match.slice(1, 4).map(Number);
  for (const [index, minimum] of [0, 2, 2].entries()) {
    if (core[index] !== minimum) {
      return core[index] > minimum;
    }
  }
  if (!match[4]) {
    return true;
  }
  const actual = match[4].split('.');
  const minimum = ['rc', '2'];
  for (let index = 0; index < Math.max(actual.length, minimum.length); index++) {
    if (actual[index] === minimum[index]) {
      continue;
    }
    if (actual[index] === undefined || minimum[index] === undefined) {
      return minimum[index] === undefined;
    }
    const leftNumeric = /^\d+$/.test(actual[index]);
    const rightNumeric = /^\d+$/.test(minimum[index]);
    if (leftNumeric && rightNumeric) {
      return Number(actual[index]) > Number(minimum[index]);
    }
    if (leftNumeric !== rightNumeric) {
      return !leftNumeric;
    }
    return actual[index] > minimum[index];
  }
  return true;
}

export function translationError(error) {
  const messages = {
    TRANSLATION_TEXT_LIMIT: '文本超过翻译服务限制。',
    TRANSLATION_HTTP_ERROR: '翻译服务商拒绝了本次请求。',
    TRANSLATION_INVALID_RESPONSE: '翻译服务返回了无效响应。',
    TRANSLATION_RESPONSE_LIMIT: '翻译服务响应超过限制。',
    TRANSLATION_REQUEST_FAILED: '翻译网络请求失败。',
    TRANSLATION_TIMEOUT: '翻译请求超时。',
    TRANSLATION_UNAVAILABLE: '翻译服务当前不可用。',
  };
  return { code: error?.code ?? 'TRANSLATION_FAILED', message: messages[error?.code] ?? (error?.name === 'TimeoutError' ? '翻译请求超时。' : '本次翻译失败，翻译服务可能已撤回，请手动重试。') };
}

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

// 缓存只属于当前宿主插件实例；不访问 Session 翻译日志或浏览器持久存储。
export class TranslationManager {
  constructor({ getTranslator, getPreferences, version, timeoutMs = 45000 }) {
    this.getTranslator = getTranslator;
    this.getPreferences = getPreferences;
    this.version = version;
    this.timeoutMs = timeoutMs;
    this.entries = new Map();
    this.inputs = new Map();
    this.nextId = 0;
    this.lifetime = new AbortController();
    this.preferenceKey = JSON.stringify(getPreferences());
  }

  preferencesChanged() {
    const key = JSON.stringify(this.getPreferences());
    if (key !== this.preferenceKey) {
      this.preferenceKey = key;
      for (const entry of this.entries.values()) {
        for (const part of entry.parts) {
          part.pending?.controller.abort();
        }
      }
    }
  }

  info() {
    this.preferencesChanged();
    return { supported: supportsTranslation(this.version), minimumVersion: MIN_TRANSLATION_VERSION, version: this.version, preferences: this.getPreferences(), serviceLoaded: this.getTranslator() !== undefined };
  }

  selected(locale) {
    this.preferencesChanged();
    if (!supportsTranslation(this.version)) {
      throw failure('TRANSLATION_UNSUPPORTED', '当前 DSH 版本不支持技能正文机翻。');
    }
    const preferences = this.getPreferences();
    const targetLanguage = preferences.targetLanguage === 'auto' ? locale : preferences.targetLanguage;
    if (!['bing', 'google'].includes(preferences.provider) || typeof targetLanguage !== 'string' || targetLanguage === 'auto' || !LANGUAGE_PATTERN.test(targetLanguage)) {
      throw failure('INVALID_ARGUMENT', '翻译服务或目标语言代码无效。');
    }
    return { provider: preferences.provider, targetLanguage };
  }

  prepare({ sessionId, body, locale }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof body !== 'string' || !body) {
      throw failure('INVALID_ARGUMENT', '无法取得完整正文。');
    }
    const options = this.selected(locale);
    const translator = this.getTranslator();
    if (translator === undefined) {
      throw failure('TRANSLATOR_MISSING', MISSING_TRANSLATOR);
    }
    const maxTextChars = translator.maxTextChars;
    const input = JSON.stringify([TRANSLATION_RULE_VERSION, maxTextChars, sessionId, body, 'auto', options.provider, options.targetLanguage]);
    let entry = this.inputs.get(input);
    if (!entry) {
      entry = { id: String(++this.nextId), sessionId, ...options, parts: splitTranslationText(body, maxTextChars).map(part => ({ ...part, status: part.translatable ? 'pending' : 'protected' })) };
      this.inputs.set(input, entry);
      this.entries.set(entry.id, entry);
    }
    return this.snapshot(entry);
  }

  snapshot(entry) {
    return { id: entry.id, provider: entry.provider, targetLanguage: entry.targetLanguage, ...(entry.text === undefined ? {} : { text: entry.text }), parts: entry.parts.map(({ original, translatable, status, text, error }) => ({ original, translatable, status, ...(text === undefined ? {} : { text }), ...(error ? { error } : {}) })) };
  }

  async chunk({ id, index, locale }, signal) {
    signal.throwIfAborted();
    const options = this.selected(locale);
    const entry = this.entries.get(id);
    const part = entry?.parts[index];
    if (!part?.translatable || entry.provider !== options.provider || entry.targetLanguage !== options.targetLanguage) {
      throw failure('TRANSLATION_STALE', '正文或翻译选项已改变，请重新点击机翻。');
    }
    if (part.status === 'success') {
      return { text: part.text };
    }
    if (!part.pending || part.pending.controller.signal.aborted) {
      const translator = this.getTranslator();
      if (translator === undefined) {
        throw failure('TRANSLATOR_MISSING', MISSING_TRANSLATOR);
      }
      const controller = new AbortController();
      const pending = { controller, users: new Set() };
      const taskSignal = AbortSignal.any([controller.signal, this.lifetime.signal, AbortSignal.timeout(this.timeoutMs)]);
      part.status = 'translating';
      delete part.error;
      part.pending = pending;
      pending.promise = Promise.resolve().then(async () => {
        try {
          const spec = translator.resolve({ text: part.original, provider: entry.provider, sourceLanguage: 'auto', targetLanguage: entry.targetLanguage });
          const result = await translator.translate(spec, taskSignal);
          taskSignal.throwIfAborted();
          if (typeof result !== 'string' || !result.trim()) {
            throw failure('TRANSLATION_INVALID_RESPONSE', '翻译服务返回了无效响应。');
          }
          part.text = result;
          part.status = 'success';
          if (entry.parts.every(item => !item.translatable || item.status === 'success')) {
            entry.text = entry.parts.map(item => item.translatable ? item.text : item.original).join('');
          }
          return { text: result };
        } catch (error) {
          if (part.pending === pending) {
            part.status = controller.signal.aborted || this.lifetime.signal.aborted ? 'cancelled' : 'failed';
            if (part.status === 'failed') {
              part.error = translationError(error);
            }
          }
          throw error;
        } finally {
          if (part.pending === pending) {
            delete part.pending;
          }
        }
      });
      // 接收的请求由宿主追踪到结束；所有观察者取消后也不会产生未处理拒绝。
      pending.promise.catch(() => {});
    }
    const pending = part.pending;
    const consumer = {};
    pending.users.add(consumer);
    let cancel;
    try {
      const aborted = new Promise((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) {
          cancel();
        }
      });
      return await Promise.race([pending.promise, aborted]);
    } finally {
      signal.removeEventListener('abort', cancel);
      pending.users.delete(consumer);
      if (!pending.users.size && part.pending === pending) {
        pending.controller.abort();
      }
    }
  }

  dispose() {
    this.lifetime.abort();
    this.entries.clear();
    this.inputs.clear();
  }
}
