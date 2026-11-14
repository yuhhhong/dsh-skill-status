import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslationManager, supportsTranslation, MISSING_TRANSLATOR } from '../src/translation.js';
import { createTranslationRoute } from '../src/index.js';

const signal = () => new AbortController().signal;
const input = { sessionId: 'session-a', body: 'First paragraph.\n\nSecond paragraph.', locale: 'zh' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ version = '0.2.2-rc.2', translate = async spec => `译：${spec.text}`, maxTextChars = 30 } = {}) {
  const calls = [];
  let preferences = { provider: 'bing', targetLanguage: 'auto' };
  let translator = {
    maxTextChars,
    resolve(request) {
      assert.equal(Object.hasOwn(request, 'sessionId'), false);
      assert.equal(request.sourceLanguage, 'auto');
      assert.ok(['bing', 'google'].includes(request.provider));
      assert.ok(request.text.length <= maxTextChars);
      assert.notEqual(request.targetLanguage, 'auto');
      return request;
    },
    translate(spec, requestSignal) {
      calls.push({ spec, signal: requestSignal });
      return translate(spec, requestSignal);
    },
  };
  const manager = new TranslationManager({ getTranslator: () => translator, getPreferences: () => preferences, version });
  return { manager, calls, service: value => { translator = value; }, preferences: value => { preferences = value; manager.preferencesChanged(); } };
}

function chunks(plan) {
  return plan.parts.flatMap((part, index) => part.translatable ? [index] : []);
}

const chunk = (manager, plan, index, requestSignal = signal(), locale = 'zh') => manager.chunk({ id: plan.id, index, locale }, requestSignal);

test('机翻版本按 SemVer 比较，包含预发布版本顺序且不依赖服务存在', () => {
  for (const version of ['0.1.7-rc.2', '0.2.1', '0.2.2-alpha.10', '0.2.2-rc.1', '0.2.2-rc', null, 'invalid']) {
    assert.equal(supportsTranslation(version), false, String(version));
  }
  for (const version of ['0.2.2-rc.2', '0.2.2-rc.10', '0.2.2-rc.2.1', '0.2.2', '0.2.3-alpha.1', '0.3.0']) {
    assert.equal(supportsTranslation(version), true, version);
  }
  const f = fixture();
  f.service(undefined);
  assert.equal(f.manager.info().supported, true);
  assert.equal(f.manager.info().serviceLoaded, false);
  assert.throws(() => f.manager.prepare(input), { message: MISSING_TRANSLATOR, code: 'TRANSLATOR_MISSING' });
  assert.equal(f.calls.length, 0);
  f.manager.dispose();
});

test('按用户点击准备；没有文本请求，服务热启用后再次准备可用', () => {
  const f = fixture();
  const service = f.manager.getTranslator();
  f.service(undefined);
  assert.throws(() => f.manager.prepare(input), { code: 'TRANSLATOR_MISSING' });
  f.service(service);
  const plan = f.manager.prepare(input);
  assert.equal(chunks(plan).length, 2);
  assert.equal(f.calls.length, 0);
  f.manager.dispose();
});

test('成功块和整篇输入缓存跨视图复用，同正文不同来源不重复发请求', async () => {
  const f = fixture();
  const plan = f.manager.prepare(input);
  const indexes = chunks(plan);
  await chunk(f.manager, plan, indexes[0]);
  assert.equal(f.manager.prepare(input).parts[indexes[0]].status, 'success');
  assert.equal(f.manager.prepare({ ...input, versionId: 'different-source' }).id, plan.id);
  await chunk(f.manager, plan, indexes[0]);
  await chunk(f.manager, plan, indexes[1]);
  assert.equal(f.calls.length, 2);
  const cached = f.manager.prepare(input);
  assert.ok(cached.parts.filter(part => part.translatable).every(part => part.status === 'success'));
  assert.notEqual(f.manager.prepare({ ...input, sessionId: 'session-b' }).id, plan.id);
  f.manager.dispose();
});

test('部分失败保留成功块，手动重试不重新请求成功块且无自动重试', async () => {
  let shouldFail = true;
  const f = fixture({ translate: async spec => {
    if (spec.text.startsWith('Second') && shouldFail) {
      throw Object.assign(new Error('request failed'), { code: 'TRANSLATION_REQUEST_FAILED' });
    }
    return `译：${spec.text}`;
  } });
  const plan = f.manager.prepare(input);
  const indexes = chunks(plan);
  await chunk(f.manager, plan, indexes[0]);
  await assert.rejects(chunk(f.manager, plan, indexes[1]), { code: 'TRANSLATION_REQUEST_FAILED' });
  const partial = f.manager.prepare(input);
  assert.equal(partial.parts[indexes[0]].status, 'success');
  assert.equal(partial.parts[indexes[1]].status, 'failed');
  assert.match(partial.parts[indexes[1]].error.message, /网络/);
  await tick();
  assert.equal(f.calls.length, 2);
  shouldFail = false;
  await chunk(f.manager, plan, indexes[1]);
  assert.equal(f.calls.length, 3);
  f.manager.dispose();
});

test('重复点击共享同块请求，一个观察者取消不终止另一个观察者', async () => {
  let finish;
  const f = fixture({ translate: () => new Promise(resolve => { finish = resolve; }) });
  const plan = f.manager.prepare(input);
  const first = new AbortController();
  const one = chunk(f.manager, plan, chunks(plan)[0], first.signal);
  const two = chunk(f.manager, plan, chunks(plan)[0]);
  await tick();
  assert.equal(f.calls.length, 1);
  first.abort();
  await assert.rejects(one, { name: 'AbortError' });
  assert.equal(f.calls[0].signal.aborted, false);
  finish('已翻译');
  assert.deepEqual(await two, { text: '已翻译' });
  f.manager.dispose();
});

test('折叠取消后迟到结果不能变成成功缓存，重开只续未成功块', async () => {
  const finishes = [];
  const f = fixture({ translate: () => new Promise(resolve => finishes.push(resolve)) });
  const plan = f.manager.prepare(input);
  const index = chunks(plan)[0];
  const controller = new AbortController();
  const old = chunk(f.manager, plan, index, controller.signal);
  await tick();
  controller.abort();
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(f.calls[0].signal.aborted, true);
  const next = chunk(f.manager, plan, index);
  await tick();
  finishes[0]('旧译文');
  await tick();
  assert.notEqual(f.manager.prepare(input).parts[index].status, 'success');
  finishes[1]('新译文');
  assert.deepEqual(await next, { text: '新译文' });
  assert.equal(f.manager.prepare(input).parts[index].text, '新译文');
  f.manager.dispose();
});

test('保存服务和目标语言立即取消旧任务，新选项不混入旧译文，切回可复用缓存', async () => {
  const f = fixture();
  const plan = f.manager.prepare(input);
  const index = chunks(plan)[0];
  await chunk(f.manager, plan, index);
  f.preferences({ provider: 'google', targetLanguage: 'ja' });
  const changed = f.manager.prepare(input);
  assert.notEqual(changed.id, plan.id);
  await assert.rejects(chunk(f.manager, plan, index), { code: 'TRANSLATION_STALE' });
  await chunk(f.manager, changed, chunks(changed)[0]);
  assert.equal(f.calls.at(-1).spec.provider, 'google');
  assert.equal(f.calls.at(-1).spec.targetLanguage, 'ja');
  f.preferences({ provider: 'bing', targetLanguage: 'auto' });
  assert.equal(f.manager.prepare(input).parts[index].status, 'success');
  f.manager.dispose();
});

test('同步 resolve 失败可报告，失败不误当服务缺失，保留成功块', async () => {
  const f = fixture();
  f.manager.getTranslator().resolve = () => { throw Object.assign(new Error('too long'), { code: 'TRANSLATION_TEXT_LIMIT' }); };
  const plan = f.manager.prepare(input);
  const index = chunks(plan)[0];
  await assert.rejects(chunk(f.manager, plan, index), { code: 'TRANSLATION_TEXT_LIMIT' });
  assert.equal(f.manager.prepare(input).parts[index].error.message, '文本超过翻译服务限制。');
  f.manager.dispose();
});

test('空译文无效，插件卸载会取消所有未完成请求且清空内存', async () => {
  const empty = fixture({ translate: async () => '' });
  const plan = empty.manager.prepare(input);
  await assert.rejects(chunk(empty.manager, plan, chunks(plan)[0]), { code: 'TRANSLATION_INVALID_RESPONSE' });
  empty.manager.dispose();
  const f = fixture({ translate: (_spec, requestSignal) => new Promise((_, reject) => requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })) });
  const pendingPlan = f.manager.prepare(input);
  const pending = chunk(f.manager, pendingPlan, chunks(pendingPlan)[0]);
  await tick();
  f.manager.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.manager.entries.size, 0);
  assert.equal(f.manager.inputs.size, 0);
});

test('翻译路由沿用 JSON 信封与 no-store，服务缺失与网络失败分别报告', async () => {
  const f = fixture();
  const request = (action, payload) => new Request(`http://localhost/api/skill-status.translation.${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: `skill-status.translation.${action}`, payload }),
  });
  const route = createTranslationRoute(f.manager, 'prepare');
  f.service(undefined);
  const response = await route.fetch(request('prepare', input));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const envelope = await response.json();
  assert.equal(envelope.rpcId, 'test');
  assert.equal(envelope.result.error.code, 'TRANSLATOR_MISSING');
  assert.equal(envelope.result.error.message, MISSING_TRANSLATOR);
  assert.equal((await route.fetch(new Request('http://localhost', { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await route.fetch(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 400);
  f.manager.dispose();
});
