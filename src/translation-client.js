const prefix = 'skill-status.translation.';
const initial = Object.freeze({ phase: 'idle', parts: null, error: null });

export function translationViewKey(sessionId, version, preferences, locale) {
  return JSON.stringify([sessionId, version.id, version.body, preferences?.provider, preferences?.targetLanguage, preferences?.targetLanguage === 'auto' ? locale : preferences?.targetLanguage]);
}

function unwrap(response) {
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error?.message ?? '翻译请求失败。'), { code: response?.error?.code });
  }
  return response.value;
}

function readableError(error) {
  return { code: error?.code ?? 'TRANSLATION_FAILED', message: error?.name === 'TimeoutError' ? '翻译请求超时。' : error?.message ?? '本次翻译失败，请手动重试。' };
}

// 这里只保留当前视图的观察状态；可复用的成功块由宿主内存持有。
export function createTranslationStore(call, { sessionId, body, locale }, timeoutMs = 45000) {
  let value = initial;
  let controller;
  let running;
  let generation = 0;
  const listeners = new Set();
  const publish = next => {
    value = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const patchPart = (index, update) => publish({ ...value, parts: value.parts.map((part, current) => current === index ? { ...part, ...update } : part) });

  async function run(signal, attempt) {
    const current = () => !signal.aborted && generation === attempt;
    const request = async (method, payload) => unwrap(await call('/api', prefix + method, payload, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])));
    publish({ ...value, phase: 'preparing', error: null });
    try {
      const plan = await request('prepare', { sessionId, body, locale });
      if (!current()) {
        return;
      }
      const parts = plan.parts.map(part => ({ ...part, status: part.status === 'success' || !part.translatable ? part.status : 'pending', error: undefined }));
      publish({ phase: 'running', parts, error: null });
      for (let index = 0; index < parts.length; index++) {
        if (!current()) {
          return;
        }
        if (!parts[index].translatable || parts[index].status === 'success') {
          continue;
        }
        patchPart(index, { status: 'translating', error: undefined });
        try {
          const result = await request('chunk', { id: plan.id, index, locale });
          if (!current()) {
            return;
          }
          if (typeof result?.text !== 'string' || !result.text.trim()) {
            throw new Error('翻译服务返回了无效响应。');
          }
          patchPart(index, { status: 'success', text: result.text, error: undefined });
        } catch (error) {
          if (!current()) {
            return;
          }
          patchPart(index, { status: 'failed', error: readableError(error) });
          if (['TRANSLATOR_MISSING', 'TRANSLATION_STALE'].includes(error?.code)) {
            publish({ ...value, error: readableError(error) });
            break;
          }
        }
      }
      if (current()) {
        publish({ ...value, phase: 'settled' });
      }
    } catch (error) {
      if (current()) {
        publish({ ...value, phase: 'settled', error: readableError(error) });
      }
    }
  }

  function cancel() {
    generation++;
    controller?.abort();
    running = undefined;
    if (value.phase === 'preparing' || value.phase === 'running') {
      publish({ ...value, phase: 'settled', error: null, parts: value.parts?.map(part => part.status === 'translating' ? { ...part, status: 'cancelled', error: undefined } : part) ?? null });
    }
  }

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (running) {
        return running;
      }
      if (value.parts && value.parts.every(part => !part.translatable || part.status === 'success')) {
        return Promise.resolve();
      }
      controller = new AbortController();
      const attempt = ++generation;
      const task = run(controller.signal, attempt).finally(() => {
        if (generation === attempt) {
          running = undefined;
        }
      });
      running = task;
      return task;
    },
    cancel,
    dispose() {
      cancel();
      listeners.clear();
    },
  };
}

export function createTranslationEnvironment(call) {
  let value = Object.freeze({ info: null, locale: null });
  let generation = 0;
  let controller;
  const listeners = new Set();
  const publish = next => {
    value = next;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    call,
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocale(locale) {
      if (value.locale !== locale) {
        publish({ ...value, locale });
      }
    },
    setPreferences(preferences) {
      if (value.info && (value.info.preferences.provider !== preferences.provider || value.info.preferences.targetLanguage !== preferences.targetLanguage)) {
        generation++;
        controller?.abort();
        publish({ ...value, info: { ...value.info, preferences } });
      }
    },
    async refresh() {
      controller?.abort();
      controller = new AbortController();
      const attempt = ++generation;
      try {
        const info = unwrap(await call('/api', prefix + 'info', {}, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])));
        if (attempt === generation && !controller.signal.aborted) {
          publish({ ...value, info });
        }
      } catch {
        // 可选翻译能力的查询失败不影响技能状态与已有正文。
      }
    },
    dispose() {
      generation++;
      controller?.abort();
      listeners.clear();
    },
  };
}
