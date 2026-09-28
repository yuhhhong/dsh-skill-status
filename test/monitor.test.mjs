import test from 'node:test';
import assert from 'node:assert/strict';
import { readStatus, StatusMonitor } from '../src/monitor.js';
import { apply } from '../src/index.js';
import { fixture, catalogSkill } from './fixtures.mjs';

const waitUntil = async (check) => { for (let i = 0; i < 50 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check()); };

test('异步目录查询期间发生裁剪时重新观察，拒绝旧计数', async () => {
  const f = fixture();
  const original = f.tool();
  let reads = 0;
  f.ctx.skills.snapshot = async () => {
    if (++reads === 1) f.replaceTool(original, '[已裁剪]');
    return { skills: [catalogSkill()], complete: true };
  };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(reads, 2);
  assert.equal(result.loadedCount, 0);
  assert.equal(result.skills[0].state, 'removed');
});

test('持续变化时保守降级，不把旧快照声明为当前', async () => {
  const f = fixture();
  f.tool();
  f.ctx.skills.snapshot = async () => {
    f.user('并发写入');
    return { skills: [catalogSkill()], complete: true };
  };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.contextComplete, false);
  assert.equal(result.skills[0].state, 'unknown');
});

test('读取失败时不误报从未加载', async () => {
  const f = fixture();
  f.ctx.sessionQuery.readSession = async () => { throw new Error('读取失败'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.historyComplete, false);
  assert.equal(result.uncertain, true);
});

test('消息投影不可用时保留历史并显示无法确认', async () => {
  const f = fixture();
  f.tool();
  f.session.deriveMessages = () => { throw new Error('缺少消息投影'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.skills[0].state, 'unknown');
  assert.ok(result.skills[0].versions[0].body);
});

test('冷会话按真实恢复实现和预设作用域读取，释放租约', async () => {
  const f = fixture();
  f.tool();
  f.ctx.agents.get = () => undefined;
  f.ctx.sessions.get = () => undefined;
  const key = {};
  let disposed = 0;
  f.ctx.get = () => ({ acquireScope: async () => ({ key, [Symbol.asyncDispose]: async () => { disposed++; } }) });
  f.ctx.skills.snapshot = async options => { assert.equal(options.scope, key); return { skills: [catalogSkill()], complete: true }; };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.loadedCount, 1);
  assert.equal(result.catalogComplete, true);
  assert.equal(disposed, 1);
});

test('当前 Agent 的隔离技能服务优先于全局服务', async () => {
  const f = fixture();
  f.ctx.get = () => ({ serviceFor: () => ({ snapshot: async () => ({ skills: [catalogSkill('scoped')], complete: true }) }) });
  const result = await readStatus(f.ctx, f.session.id);
  assert.deepEqual(result.skills.map(row => row.name), ['scoped']);
});

test('源文件缺失和读取失败分别展示，历史正文不被覆盖', async () => {
  const f = fixture();
  f.tool();
  f.ctx.skills.snapshot = async () => ({ skills: [catalogSkill('demo', { path: '/skills/demo/SKILL.md' })], complete: true });
  f.ctx.fs.stat = async () => undefined;
  const missing = await readStatus(f.ctx, f.session.id);
  assert.equal(missing.skills[0].catalogSourceState, 'missing');
  assert.equal(missing.loadedCount, 1);
  f.ctx.fs.stat = async () => { throw new Error('访问失败'); };
  assert.equal((await readStatus(f.ctx, f.session.id)).skills[0].catalogSourceState, 'unknown');
});

test('事件唤醒等待中的客户端，无须下一次模型请求', async () => {
  const f = fixture();
  const monitor = new StatusMonitor(f.ctx, 10000);
  const first = await monitor.read(f.session.id);
  const next = monitor.read(f.session.id, first.revision);
  await waitUntil(() => monitor.listeners.size === 1);
  f.tool();
  monitor.invalidate(f.session.id);
  const result = await next;
  assert.equal(result.loadedCount, 1);
  assert.equal(monitor.listeners.size, 0);
  monitor.dispose();
});

test('取消请求和卸载插件都会清理长轮询', async () => {
  const f = fixture();
  const monitor = new StatusMonitor(f.ctx, 10000);
  const first = await monitor.read(f.session.id);
  const controller = new AbortController();
  const pending = monitor.read(f.session.id, first.revision, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(monitor.listeners.size, 0);
  const second = monitor.read(f.session.id, first.revision);
  monitor.dispose();
  await assert.rejects(second);
  assert.equal(monitor.listeners.size, 0);
});

test('两个会话的正文状态相互独立', async () => {
  const left = fixture('left');
  const right = fixture('right');
  left.tool();
  assert.equal((await readStatus(left.ctx, 'left')).loadedCount, 1);
  assert.equal((await readStatus(right.ctx, 'right')).loadedCount, 0);
});

test('宿主只注册认证通道上的精确路径，卸载移除接口', async () => {
  const f = fixture();
  const disposers = [];
  const handlers = new Map();
  let route;
  let removed = false;
  const ctx = { ...f.ctx, effect: fn => disposers.push(fn()), on: (name, fn) => handlers.set(name, fn),
    connection: { fetch: { register: definition => { route = definition; return async () => { removed = true; }; } } } };
  apply(ctx);
  assert.equal(route.path, '/api/skill-status.read');
  const request = payload => new Request(`http://localhost${route.path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'skill-status.read', payload }) });
  assert.equal((await (await route.fetch(request({}))).json()).result.ok, false);
  f.tool();
  handlers.get('session/event')(f.session);
  const response = await (await route.fetch(request({ sessionId: f.session.id }))).json();
  assert.equal(response.result.value.loadedCount, 1);
  assert.equal(response.rpcId, 'test');
  for (const dispose of disposers.reverse()) await dispose();
  assert.equal(removed, true);
});
