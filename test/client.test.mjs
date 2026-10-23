import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { analyze } from '../src/analyze.js';
import { fixture, catalogSkill } from './fixtures.mjs';

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

const renderPanel = data => renderToStaticMarkup(React.createElement(client.SkillPanel, { state: { phase: 'ready', data } }));
const analyzeFixture = (f, overrides = {}) => analyze({ events: f.events, messages: f.session.deriveMessages(), catalog: [catalogSkill()], catalogComplete: true, ...overrides });

test('具体技能的原因在折叠行直接可见，不再显示笼统全局提示', () => {
  const f = fixture();
  f.tool('demo', '<skill_content name="demo">不完整');
  const data = analyzeFixture(f);
  const html = renderPanel(data);
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)[1];
  assert.match(summary, /无法确认/);
  assert.ok(summary.includes(data.skills[0].issues[0].message));
  assert.doesNotMatch(html, /部分状态无法确认|role="status"/);
  assert.ok(html.includes(data.skills[0].versions[0].reason));
});

test('已加载状态与目录待确认分开展示，目录缺口保留全局说明', () => {
  const f = fixture();
  f.tool();
  const data = analyzeFixture(f, { catalogComplete: false });
  const html = renderPanel(data);
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)[1];
  assert.match(summary, /已加载/);
  assert.match(summary, /目录待确认/);
  assert.ok(summary.includes(data.skills[0].issues.find(issue => issue.scope === 'catalog').message));
  assert.match(html, /已确认加载 1 个/);
  assert.ok(html.includes(data.issues.find(issue => issue.scope === 'catalog').message));
  assert.match(html, /role="status"/);
});

test('其他版本无法核实时不覆盖已加载状态，详情展示该版本原因', () => {
  const f = fixture();
  f.tool();
  f.tool('demo', '<skill_content name="demo">不完整');
  const data = analyzeFixture(f);
  const html = renderPanel(data);
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)[1];
  assert.match(summary, /已加载/);
  assert.match(summary, /其他版本：/);
  assert.match(html, /已确认加载 1 个/);
  assert.ok(html.includes(data.skills[0].versions[0].reason));
});

test('列表为空时仍展示无法归属到行的具体全局问题', () => {
  const data = analyze({ historyComplete: false });
  const html = renderPanel(data);
  for (const issue of data.issues) assert.ok(html.includes(issue.message));
  assert.match(html, /目前没有可核实的技能条目/);
  assert.doesNotMatch(html, /部分状态无法确认/);
});

test('行级原因按纯文本转义，正常状态没有警告', () => {
  const f = fixture();
  const data = analyzeFixture(f);
  assert.doesNotMatch(renderPanel(data), /dsh-skills-notice|目录待确认/);
  data.skills[0].issues = [{ code: 'test', scope: 'body', message: '<script>不要执行</script>' }];
  const html = renderPanel(data);
  assert.match(html, /&lt;script&gt;不要执行&lt;\/script&gt;/);
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
