import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';

const require = createRequire(import.meta.url);
let client;
const fakeDocument = { head: { append() {} }, createElement: () => ({ remove() {} }) };
vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: registration => {
    assert.equal(registration.id, 'dsh-skill-status');
    client = registration.factory(require);
  } } }, document: fakeDocument, AbortSignal, AbortController, setTimeout, clearTimeout, console,
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = (name, loadedCount = 0) => ({ ok: true, value: { sessionId: name, revision: 'revision-1', skills: [], loadedCount } });

test('客户端产物按平台工厂加载，注册新增插槽和右侧页签', () => {
  const registered = [];
  const effects = [];
  const core = new SlotCore();
  core.register({ name: 'root', children: {
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
  } }, () => null);
  client.apply({
    connection: { rpc: { call() {} } },
    sidebarRight: { openTab() {} },
    sidebarRightTabs: { register: definition => { assert.equal(definition.kind, 'dsh-skill-status'); return () => {}; } },
    effect: effect => effects.push(effect()),
    slots: {
      inject: (_name, factory) => effects.push(factory()),
      register: (definition, component) => { registered.push(definition); return core.register(definition, component); },
    },
  });
  assert.deepEqual(registered.map(item => item.name), ['conversation.session.header.utilities', 'sidebar.right.pane.tab']);
  for (const dispose of effects.reverse()) dispose();
});

test('未收到基线和断连时不显示虚假的零个已加载', () => {
  const pending = renderToStaticMarkup(React.createElement(client.SkillPanel, { state: { phase: 'pending' } }));
  const failure = renderToStaticMarkup(React.createElement(client.SkillPanel, { state: { phase: 'error' } }));
  assert.match(pending, /正在核实/);
  assert.doesNotMatch(pending + failure, /已确认加载 0/);
});

test('历史正文明确标识并以纯文本转义，不能执行其中脚本', () => {
  const state = { phase: 'ready', data: { loadedCount: 0, skills: [{ name: 'demo', state: 'removed', directoryState: 'absent', description: '',
    versions: [{ id: 'v1', time: 1, state: 'removed', entry: 'tool', loadCount: 1, body: '<script>alert(1)</script>', resource: '来源' }] }] } };
  const html = renderToStaticMarkup(React.createElement(client.SkillPanel, { state }));
  assert.match(html, /历史正文/);
  assert.match(html, /未在当前技能目录中/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('标题和面板共享同一订阅，最后一个观察者离开才取消查询', async () => {
  const calls = [];
  const store = client.createStatusStore((_channel, _endpoint, payload, signal) => new Promise(resolve => calls.push({ payload, signal, resolve })), 'session-a');
  const stopHeader = store.subscribe(() => {});
  const stopPanel = store.subscribe(() => {});
  assert.equal(calls.length, 1);
  calls[0].resolve(ready('session-a', 2));
  await tick();
  assert.equal(store.getSnapshot().data.loadedCount, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].payload.after, 'revision-1');
  stopHeader();
  assert.equal(calls[1].signal.aborted, false);
  stopPanel();
  assert.equal(calls[1].signal.aborted, true);
  store.dispose();
});

test('切换会话后迟到的旧响应不能污染新会话或重开轮询', async () => {
  const calls = [];
  const call = (_channel, _endpoint, payload, signal) => new Promise(resolve => calls.push({ payload, signal, resolve }));
  const left = client.createStatusStore(call, 'left');
  const right = client.createStatusStore(call, 'right');
  const stopLeft = left.subscribe(() => {});
  stopLeft();
  const stopRight = right.subscribe(() => {});
  calls[0].resolve(ready('left', 9));
  calls[1].resolve(ready('right', 1));
  await tick();
  assert.equal(left.getSnapshot().phase, 'pending');
  assert.equal(right.getSnapshot().data.loadedCount, 1);
  assert.equal(calls.filter(item => item.payload.sessionId === 'left').length, 1);
  stopRight(); left.dispose(); right.dispose();
});
