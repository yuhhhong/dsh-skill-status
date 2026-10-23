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
  assert.deepEqual(result.skills[0].issues.map(item => item.code), ['context_changing']);
  assert.match(result.skills[0].versions[0].reason, /会话正在变化/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.note, null);
});

test('读取失败时不误报从未加载', async () => {
  const f = fixture();
  f.ctx.sessionQuery.readSession = async () => { throw new Error('读取失败'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.historyComplete, false);
  assert.equal(result.uncertain, true);
  assert.deepEqual(result.issues.map(item => item.code), ['history_read_failed', 'catalog_incomplete', 'context_unavailable']);
  assert.match(result.issues[0].message, /会话记录暂时无法读取/);
  assert.equal(result.note, null);
});

test('消息投影不可用时保留历史并显示无法确认', async () => {
  const f = fixture();
  f.tool();
  f.session.deriveMessages = () => { throw new Error('缺少消息投影'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.skills[0].state, 'unknown');
  assert.ok(result.skills[0].versions[0].body);
  assert.deepEqual(result.skills[0].issues.map(item => item.code), ['context_projection_failed']);
  assert.match(result.skills[0].versions[0].reason, /消息投影失败/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.note, null);
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
  const inaccessible = await readStatus(f.ctx, f.session.id);
  assert.equal(inaccessible.skills[0].catalogSourceState, 'unknown');
  assert.equal(inaccessible.skills[0].state, 'loaded');
  assert.equal(inaccessible.loadedCount, 1);
  assert.equal(inaccessible.uncertain, false);
  assert.deepEqual(inaccessible.skills[0].issues, []);
  assert.deepEqual(inaccessible.issues, []);
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

test('没有历史版本时消息投影失败保留全局上下文提示', async () => {
  const f = fixture();
  f.session.deriveMessages = () => { throw new Error('缺少投影'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.deepEqual(result.issues.map(item => item.code), ['context_projection_failed']);
  assert.deepEqual(result.skills[0].issues, []);
  assert.equal(result.note, null);
});

test('目录读取失败不改变已加载状态，行级与全局都保留目录问题', async () => {
  const f = fixture();
  f.tool();
  f.ctx.skills.snapshot = async () => { throw new Error('目录读取失败'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.loadedCount, 1);
  assert.equal(result.skills[0].state, 'loaded');
  assert.equal(result.catalogComplete, false);
  assert.deepEqual(result.skills[0].issues.map(item => item.code), ['catalog_incomplete']);
  assert.deepEqual(result.issues.map(item => item.code), ['catalog_incomplete']);
});

test('冷会话恢复失败不能误报为会话持续变化', async () => {
  const f = fixture();
  f.tool();
  f.ctx.sessions.get = () => undefined;
  f.ctx.sessions.prepare = () => { throw new Error('恢复失败'); };
  const result = await readStatus(f.ctx, f.session.id);
  assert.deepEqual(result.skills[0].issues.map(item => item.code), ['context_restore_failed']);
  assert.match(result.skills[0].versions[0].reason, /会话恢复失败/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.note, null);
});

test('重试中记录读取失败优先于之前的会话变化原因', async () => {
  const f = fixture();
  f.tool();
  const read = f.ctx.sessionQuery.readSession;
  let reads = 0;
  f.ctx.sessionQuery.readSession = async () => {
    if (++reads > 1) throw new Error('读取失败');
    return read();
  };
  f.ctx.skills.snapshot = async () => {
    f.user('并发写入');
    return { skills: [catalogSkill()], complete: true };
  };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(result.loadedCount, 0);
  assert.equal(result.historyComplete, false);
  assert.deepEqual(result.issues.map(item => item.code), ['history_read_failed']);
  assert.deepEqual(result.skills[0].issues.map(item => item.code), ['history_read_failed', 'context_unavailable']);
  assert.match(result.skills[0].versions[0].reason, /会话记录暂时无法读取/);
});

test('冷会话二次读取持续失败时保留记录失败原因', async () => {
  const f = fixture();
  f.tool();
  f.ctx.sessions.get = () => undefined;
  const read = f.ctx.sessionQuery.readSession;
  let reads = 0;
  f.ctx.sessionQuery.readSession = async () => {
    if (++reads % 2 === 0) throw new Error('核验读取失败');
    return read();
  };
  const result = await readStatus(f.ctx, f.session.id);
  assert.equal(reads, 6);
  assert.equal(result.historyComplete, false);
  assert.deepEqual(result.issues.map(item => item.code), ['history_read_failed']);
  assert.deepEqual(result.skills[0].issues.map(item => item.code), ['history_read_failed', 'context_unavailable']);
  assert.match(result.skills[0].versions[0].reason, /会话记录暂时无法读取/);
});
