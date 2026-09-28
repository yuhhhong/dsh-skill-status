import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService, serverResponseSchema } from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../src/index.js';
import { fixture } from './fixtures.mjs';

const request = (payload, endpoint = 'skill-status.read') => new Request(`http://localhost/api/${endpoint}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'integration-request', method: endpoint, payload }),
});

test('真实 Cordis 和 Connection 中与既有 Gateway 共存，加载、查询、卸载成功', async () => {
  const ctx = new Context();
  const f = fixture();
  for (const key of ['sessionQuery', 'sessions', 'agents', 'skills', 'fs']) ctx.provide(key, f.ctx[key]);
  const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => true });
  // 预先占用唯一 Gateway 拦截器，防止测试环境掩盖真实挂载冲突。
  ctx.connection.rpc.intercept('/api', name => name === 'gateway.test', async () => ({ ok: true, value: '原有接口' }));
  const shared = connection.createSharedFetchHandler('/api');
  const fiber = ctx.plugin(plugin);
  try {
    await fiber.await();
    assert.equal(fiber.state, 2);
    f.tool();
    ctx.emit('session/event', f.session);
    const response = await shared.fetch(request({ sessionId: f.session.id }));
    const envelope = serverResponseSchema.parse(await response.json());
    assert.equal(envelope.result.ok, true);
    assert.equal(envelope.result.value.loadedCount, 1);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await (await shared.fetch(request({}, 'gateway.test'))).json()).result.value, '原有接口');
    await fiber.dispose();
    assert.equal((await shared.fetch(request({ sessionId: f.session.id }))).status, 404);
    assert.equal((await (await shared.fetch(request({}, 'gateway.test'))).json()).result.value, '原有接口');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('只读接口拒绝畸形信封和错误内容类型', async () => {
  const route = plugin.createReadRoute({ read: () => { throw new Error('不应读取会话'); } });
  const badType = new Request('http://localhost/api/skill-status.read', { method: 'POST', body: '内容' });
  assert.equal((await route.fetch(badType)).status, 415);
  const badBody = new Request('http://localhost/api/skill-status.read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await route.fetch(badBody)).status, 400);
});
