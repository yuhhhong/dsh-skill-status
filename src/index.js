import { StatusMonitor } from './monitor.js';
import { TranslationManager, translationError } from './translation.js';
import { translationRuntime } from './translation-runtime.js';

const runtime = await translationRuntime();
export const Config = runtime.Config;

export const name = 'skill-status';
export const inject = ['connection', 'sessionQuery', 'sessions', 'agents', 'skills', 'fs'];
export const endpoint = 'skill-status.read';

export function createReadRoute(monitor) {
  return {
    path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'POST') return new Response('请求方式不支持。', { status: 405 });
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('请求必须使用 JSON。', { status: 415 });
      let envelope;
      try { envelope = await request.json(); } catch { return new Response('请求内容无效。', { status: 400 }); }
      if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || !envelope.rpcId || envelope.method !== endpoint) {
        return new Response('请求格式无效。', { status: 400 });
      }
      const reply = result => Response.json({ type: 'server-response', rpcId: envelope.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
      const payload = envelope.payload;
      if (!payload || typeof payload.sessionId !== 'string' || !payload.sessionId || payload.sessionId.length > 512 ||
          (payload.after !== undefined && typeof payload.after !== 'string')) {
        return reply({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '会话标识无效。', details: {} } });
      }
      try {
        return reply({ ok: true, value: await monitor.read(payload.sessionId, payload.after, request.signal) });
      } catch {
        return reply({ ok: false, error: { code: 'SKILL_STATUS_UNAVAILABLE', message: '暂时无法查询技能状态。', details: {} } });
      }
    },
  };
}

export function createTranslationRoute(manager, action) {
  const method = `skill-status.translation.${action}`;
  return {
    path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'POST') {
        return new Response('请求方式不支持。', { status: 405 });
      }
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        return new Response('请求必须使用 JSON。', { status: 415 });
      }
      let envelope;
      try {
        envelope = await request.json();
      } catch {
        return new Response('请求内容无效。', { status: 400 });
      }
      if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || !envelope.rpcId || envelope.method !== method) {
        return new Response('请求格式无效。', { status: 400 });
      }
      const reply = result => Response.json({ type: 'server-response', rpcId: envelope.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
      try {
        request.signal.throwIfAborted();
        const payload = envelope.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (action === 'chunk' && (typeof payload.id !== 'string' || !Number.isSafeInteger(payload.index) || payload.index < 0))) {
          return reply({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '翻译请求参数无效。', details: {} } });
        }
        const value = action === 'info' ? manager.info() : action === 'prepare' ? manager.prepare(payload) : await manager.chunk(payload, request.signal);
        return reply({ ok: true, value });
      } catch (error) {
        const explicit = ['TRANSLATOR_MISSING', 'TRANSLATION_STALE', 'TRANSLATION_UNSUPPORTED', 'INVALID_ARGUMENT'].includes(error?.code);
        const detail = explicit ? { code: error.code, message: error.message } : request.signal.aborted ? { code: 'TRANSLATION_CANCELLED', message: '翻译已取消。' } : translationError(error);
        return reply({ ok: false, error: { ...detail, details: {} } });
      }
    },
  };
}

export function apply(ctx, config = {}) {
  const monitor = new StatusMonitor(ctx);
  const getPreferences = () => ({ provider: config.provider?.get?.() ?? config.provider ?? 'bing', targetLanguage: config.targetLanguage?.get?.() ?? config.targetLanguage ?? 'auto' });
  const translations = new TranslationManager({ getTranslator: () => ctx.get('translator'), getPreferences, version: runtime.version });
  ctx.effect(() => () => translations.dispose());
  for (const action of ['info', 'prepare', 'chunk']) {
    ctx.effect(() => ctx.connection.fetch.register(createTranslationRoute(translations, action)));
  }
  if (Config) {
    ctx.on('loader/volatile-update', () => translations.preferencesChanged());
    ctx.inject(['settings'], child => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
  }
  ctx.effect(() => () => monitor.dispose());
  ctx.on('session/event', session => monitor.invalidate(session.id));
  ctx.on('session/created', session => monitor.invalidate(session.id));
  ctx.on('session/disposed', session => monitor.invalidate(session.id));
  ctx.on('skills/change', () => monitor.invalidate());
  ctx.on('agent/created', ({ agent }) => { monitor.invalidate(agent.session.id); });
  ctx.on('agent/disposed', ({ agent }) => monitor.invalidate(agent.session.id));
  // /api 的通用拦截器由 Gateway 独占；扩展只注册经过相同认证的精确路径。
  ctx.effect(() => ctx.connection.fetch.register(createReadRoute(monitor)));
}
