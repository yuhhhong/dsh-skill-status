import { StatusMonitor } from './monitor.js';

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

export function apply(ctx) {
  const monitor = new StatusMonitor(ctx);
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
