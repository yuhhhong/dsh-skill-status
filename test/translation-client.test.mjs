import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslationEnvironment, createTranslationStore, translationViewKey } from '../src/translation-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = value => ({ ok: true, value });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const makePlan = () => ({ id: 'plan-1', provider: 'bing', targetLanguage: 'zh-CN', parts: [
  { original: 'First paragraph', translatable: true, status: 'pending' },
  { original: '\n`npm run build`\n', translatable: false, status: 'protected' },
  { original: 'Second paragraph', translatable: true, status: 'pending' },
  { original: 'Third paragraph', translatable: true, status: 'pending' },
] });
const options = { sessionId: 'session-a', body: 'Original body', locale: 'zh-CN' };

test('仅点击后请求，重复点击复用进行中任务，部分成功立即发布且手动重试只发未成功块', async () => {
  const plan = makePlan();
  const calls = [];
  const first = deferred();
  let failedOnce = false;
  const store = createTranslationStore(async (_channel, endpoint, payload, signal) => {
    calls.push({ endpoint, payload, signal });
    if (endpoint.endsWith('prepare')) {
      return ok(structuredClone(plan));
    }
    if (payload.index === 0 && plan.parts[0].status !== 'success') {
      await first.promise;
    }
    if (payload.index === 2 && !failedOnce) {
      failedOnce = true;
      return { ok: false, error: { code: 'TRANSLATION_REQUEST_FAILED', message: '翻译网络请求失败。' } };
    }
    plan.parts[payload.index].status = 'success';
    plan.parts[payload.index].text = `译文 ${payload.index}`;
    return ok({ text: plan.parts[payload.index].text });
  }, options);
  const updates = [];
  const unsubscribe = store.subscribe(() => updates.push(store.getSnapshot()));
  assert.equal(calls.length, 0);
  const attempt = store.start();
  assert.equal(store.start(), attempt);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.body, options.body);
  first.resolve();
  await attempt;
  assert.ok(updates.some(value => value.phase === 'running' && value.parts?.[0].status === 'success' && value.parts[3].status !== 'success'));
  assert.equal(store.getSnapshot().parts[2].status, 'failed');
  assert.equal(store.getSnapshot().parts[2].original, 'Second paragraph');
  assert.equal(store.getSnapshot().parts[3].status, 'success');
  assert.deepEqual(calls.filter(call => call.endpoint.endsWith('chunk')).map(call => call.payload.index), [0, 2, 3]);
  await tick();
  assert.equal(calls.length, 4, '失败后不自动发起重试');
  await store.start();
  assert.deepEqual(calls.filter(call => call.endpoint.endsWith('chunk')).map(call => call.payload.index), [0, 2, 3, 2]);
  assert.equal(store.getSnapshot().parts[2].status, 'success');
  const count = calls.length;
  await store.start();
  assert.equal(calls.length, count, '查看完整缓存不重复请求');
  unsubscribe();
  store.dispose();
});

test('折叠或离开正文取消独立请求，迟到成功不能更新已取消正文或继续后续块', async () => {
  const chunk = deferred();
  const calls = [];
  const store = createTranslationStore(async (_channel, endpoint, payload, signal) => {
    calls.push({ endpoint, payload, signal });
    return endpoint.endsWith('prepare') ? ok(makePlan()) : chunk.promise;
  }, options);
  const attempt = store.start();
  await tick();
  assert.equal(calls.length, 2);
  store.cancel();
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(store.getSnapshot().parts[0].status, 'cancelled');
  chunk.resolve(ok({ text: '迟到的译文' }));
  await attempt;
  assert.equal(calls.length, 2);
  assert.equal(store.getSnapshot().parts[0].status, 'cancelled');
  assert.equal(store.getSnapshot().error, null);
  store.dispose();
});

test('准备请求取消后迟到的旧计划不能启动翻译，新一轮任务仍独立进行', async () => {
  const oldPlan = deferred();
  const newPlan = deferred();
  const calls = [];
  const store = createTranslationStore((_channel, endpoint, payload, signal) => {
    calls.push({ endpoint, payload, signal });
    return calls.length === 1 ? oldPlan.promise : newPlan.promise;
  }, options);
  const oldAttempt = store.start();
  store.cancel();
  const newAttempt = store.start();
  oldPlan.resolve(ok(makePlan()));
  await oldAttempt;
  assert.equal(calls.length, 2);
  assert.equal(store.start(), newAttempt, '旧任务结束不能清掉新任务的去重状态');
  newPlan.resolve({ ok: false, error: { code: 'TRANSLATOR_MISSING', message: '未检测到翻译服务。请前往「插件」启用「思考过程机器翻译」' } });
  await newAttempt;
  assert.match(store.getSnapshot().error.message, /未检测到翻译服务/);
  store.dispose();
});

test('单块超时显示失败原因且不自动重试，不复用状态查询超时', async () => {
  let chunkCalls = 0;
  const plan = makePlan();
  plan.parts = plan.parts.slice(0, 1);
  const store = createTranslationStore((_channel, endpoint, _payload, signal) => {
    if (endpoint.endsWith('prepare')) {
      return Promise.resolve(ok(plan));
    }
    chunkCalls++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, options, 10);
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await store.start();
    assert.equal(store.getSnapshot().parts[0].status, 'failed');
    assert.match(store.getSnapshot().parts[0].error.message, /超时/);
    assert.equal(chunkCalls, 1);
  } finally {
    clearTimeout(keepAlive);
    store.dispose();
  }
});

test('翻译能力独立查询失败不影响环境已有信息，语言与生效偏好可单独更新', async () => {
  let fail = false;
  const env = createTranslationEnvironment(async () => {
    if (fail) {
      throw new Error('能力查询失败');
    }
    return ok({ supported: true, preferences: { provider: 'bing', targetLanguage: 'auto' } });
  });
  env.setLocale('zh-CN');
  await env.refresh();
  env.setPreferences({ provider: 'google', targetLanguage: 'ja' });
  assert.equal(env.getSnapshot().info.preferences.provider, 'google');
  fail = true;
  await env.refresh();
  assert.equal(env.getSnapshot().info.supported, true);
  assert.equal(env.getSnapshot().locale, 'zh-CN');
  env.dispose();
});

test('生效设置变化使旧能力响应失效，迟到的旧偏好不能覆盖已保存偏好', async () => {
  const pending = deferred();
  let delayed = false;
  let oldSignal;
  const env = createTranslationEnvironment((_channel, _endpoint, _payload, signal) => {
    if (delayed) {
      oldSignal = signal;
      return pending.promise;
    }
    return Promise.resolve(ok({ supported: true, preferences: { provider: 'bing', targetLanguage: 'auto' } }));
  });
  await env.refresh();
  delayed = true;
  const refresh = env.refresh();
  env.setPreferences({ provider: 'google', targetLanguage: 'ja' });
  assert.equal(oldSignal.aborted, true);
  pending.resolve(ok({ supported: true, preferences: { provider: 'bing', targetLanguage: 'auto' } }));
  await refresh;
  assert.deepEqual(env.getSnapshot().info.preferences, { provider: 'google', targetLanguage: 'ja' });
  env.dispose();
});

test('正文显示身份忽略轮询和加载次数，但跟踪实际版本及原始语言偏好', () => {
  const version = { id: 'source-a', body: 'Same body', loadCount: 1, time: 1 };
  const preferences = { provider: 'bing', targetLanguage: 'auto' };
  const key = translationViewKey('session-a', version, preferences, 'zh');
  assert.equal(translationViewKey('session-a', { ...version, loadCount: 2, time: 2, state: 'removed' }, { ...preferences }, 'zh'), key);
  assert.notEqual(translationViewKey('session-a', { ...version, id: 'source-b' }, preferences, 'zh'), key);
  assert.notEqual(translationViewKey('session-b', version, preferences, 'zh'), key);
  assert.notEqual(translationViewKey('session-a', version, { provider: 'bing', targetLanguage: 'zh' }, 'zh'), key);
  assert.notEqual(translationViewKey('session-a', version, preferences, 'ja'), key);
  const explicit = { provider: 'bing', targetLanguage: 'zh' };
  assert.equal(translationViewKey('session-a', version, explicit, 'ja'), translationViewKey('session-a', version, explicit, 'en'));
});

const output = await build({ entryPoints: [new URL('../src/client.jsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], jsx: 'transform' });
const clientModule = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module: clientModule, exports: clientModule.exports, require: createRequire(import.meta.url), AbortSignal, AbortController, setTimeout, clearTimeout, console });
const client = clientModule.exports;
test('面板从官方页签钩子读取可见性，隐藏页签不会只依赖组件卸载', () => {
  let renderTab;
  client.apply({
    connection: { rpc: { call() {} } },
    effect() {},
    slots: {
      inject(_name, register) { register(); },
      register(definition, component) {
        if (definition.name === 'sidebar.right.pane.tab') {
          renderTab = component;
        }
        return () => {};
      },
    },
  });
  let visible = false;
  const props = { sessionId: 'session-a', useTabInfo: () => ({ tab: { visible } }) };
  const hidden = renderTab(props);
  assert.equal(hidden.type(hidden.props).props.visible, false);
  visible = true;
  const shown = renderTab(props);
  assert.equal(shown.type(shown.props).props.visible, true);
  assert.ok(renderTab({ sessionId: 'session-a' }), '旧宿主没有新钩子时仍能注册状态面板');
});

const state = body => ({ phase: 'ready', data: { sessionId: 'session-a', loadedCount: 1, skills: [{ name: 'demo', state: 'loaded', directoryState: 'present', versions: [{ id: 'v1', body, time: 0, loadCount: 1, state: 'loaded', entry: 'tool' }] }] } });
const translation = supported => ({ info: { supported, preferences: { provider: 'bing', targetLanguage: 'auto' }, serviceLoaded: false }, locale: 'zh-CN', call: () => { throw new Error('渲染不能发翻译请求'); } });

test('支持版本服务缺失仍显示机翻入口，旧版本与缺失正文隐藏入口并保留来源标题', () => {
  const supported = renderToStaticMarkup(React.createElement(client.SkillPanel, { state: state('<script>original</script>'), translation: translation(true) }));
  const unsupported = renderToStaticMarkup(React.createElement(client.SkillPanel, { state: state('Original'), translation: translation(false) }));
  const missing = renderToStaticMarkup(React.createElement(client.SkillPanel, { state: state(null), translation: translation(true) }));
  assert.match(supported, /上下文正文/);
  assert.match(supported, />机翻<\/button>/);
  assert.match(supported, /&lt;script&gt;original&lt;\/script&gt;/);
  assert.doesNotMatch(unsupported, />机翻<\/button>/);
  assert.doesNotMatch(missing, />机翻<\/button>/);
  assert.match(missing, /无法取得加载时的完整正文/);
});

test('独立设置展示 Bing/Google 与跟随界面语言，不提供大模型路线', () => {
  const snapshot = { status: 'ready', writable: true, revision: 1, value: { provider: 'bing', targetLanguage: 'auto' } };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate() { throw new Error('渲染不能保存配置'); } };
  const html = renderToStaticMarkup(React.createElement(client.TranslationSettings, { scope, view: 'page' }));
  assert.match(html, /Bing/);
  assert.match(html, /Google/);
  assert.match(html, /跟随界面语言/);
  assert.match(html, /指定语言代码/);
  assert.doesNotMatch(html, /deepseek-account|deepseek-official/);
  assert.match(renderToStaticMarkup(React.createElement(client.TranslationSettings, { scope, view: 'summary' })), /Bing · 跟随界面语言/);
});
