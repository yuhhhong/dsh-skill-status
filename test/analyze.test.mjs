import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, parseSkillContent } from '../src/analyze.js';
import { fixture, catalogSkill, render } from './fixtures.mjs';

const inspect = (f, overrides = {}) => analyze({ events: f.events, messages: f.session.deriveMessages(), catalog: [catalogSkill()], catalogComplete: true, ...overrides });

test('目录列出和普通文件读取都不属于正式加载', () => {
  const f = fixture();
  f.tool('demo', render(), 'read');
  f.user(render());
  const result = inspect(f);
  assert.equal(result.loadedCount, 0);
  assert.equal(result.skills[0].state, 'absent');
});

test('skill 工具和用户调用两个正式入口均可确认完整主正文', () => {
  for (const entry of ['tool', 'user']) {
    const f = fixture();
    entry === 'tool' ? f.tool() : f.user(render(), { kind: 'skill-invocation', name: 'demo', form: 'instructions' });
    assert.equal(inspect(f).loadedCount, 1);
    assert.equal(inspect(f).skills[0].versions[0].body, '第一行\n中间的重要指令\n最后一行');
  }
});

test('未读取引用资料不影响主正文完整性', () => {
  const f = fixture();
  f.tool('demo', render('demo', '请按需读取引用资料。', { resourceBase: { kind: 'url', url: 'https://example.com/refs/' } }));
  assert.equal(inspect(f).skills[0].state, 'loaded');
});

test('中间被裁剪但保留闭合标签时不计为已加载', () => {
  const f = fixture();
  const original = f.tool();
  f.replaceTool(original, render().replace('中间的重要指令', '[已裁剪]'));
  const result = inspect(f);
  assert.equal(result.loadedCount, 0);
  assert.equal(result.skills[0].state, 'removed');
  assert.match(result.skills[0].versions[0].body, /中间的重要指令/);
  assert.match(result.skills[0].versions[0].reason, /裁剪/);
  assert.equal(result.skills[0].versions.length, 1);
});

test('正文保留而资源包装被裁剪时仍可确认已加载', () => {
  const f = fixture();
  const original = f.tool();
  f.replaceTool(original, '第一行\n中间的重要指令\n最后一行');
  assert.equal(inspect(f).loadedCount, 1);
});

test('压缩后只剩提及名称的摘要立即移除已加载计数', () => {
  const f = fixture();
  const original = f.tool();
  f.user('摘要：之前加载过 demo 技能。', { kind: 'compaction' }, {
    surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq],
  });
  assert.equal(inspect(f).skills[0].state, 'removed');
});

test('普通消息复制旧正文不能让已移除的正式版本重新变为已加载', () => {
  const f = fixture();
  const original = f.tool();
  f.replaceTool(original, '[已裁剪]');
  f.user(render());
  assert.equal(inspect(f).loadedCount, 0);
});

test('同名不同版本合并一行、计数一次，保留原始内容', () => {
  const f = fixture();
  f.tool('demo', render('demo', '旧正文'));
  f.tool('demo', render('demo', '新正文'));
  const result = inspect(f);
  assert.equal(result.skills.length, 1);
  assert.equal(result.loadedCount, 1);
  assert.deepEqual(result.skills[0].versions.map(v => v.body), ['新正文', '旧正文']);
});

test('最新版本被裁剪而较早版本完整时仍计数一次', () => {
  const f = fixture();
  f.tool('demo', render('demo', '旧正文'));
  const latest = f.tool('demo', render('demo', '新正文'));
  f.replaceTool(latest, '裁剪');
  const result = inspect(f);
  assert.equal(result.loadedCount, 1);
  assert.equal(result.skills[0].versions[0].state, 'removed');
});

test('重复加载同一版本合并次数但保留仍完整的一次', () => {
  const f = fixture();
  f.tool();
  const latest = f.tool();
  f.replaceTool(latest, '裁剪');
  const row = inspect(f).skills[0];
  assert.equal(row.versions.length, 1);
  assert.equal(row.versions[0].loadCount, 2);
  assert.equal(row.state, 'loaded');
});

test('缺失当前上下文、原文或历史时显示无法确认', () => {
  const f = fixture();
  f.tool();
  assert.equal(inspect(f, { messages: undefined }).skills[0].state, 'unknown');
  assert.equal(inspect(f, { events: [], historyComplete: false }).skills[0].state, 'unknown');
  const damaged = fixture();
  damaged.tool('demo', '<skill_content name="demo">不完整');
  assert.equal(inspect(damaged).skills[0].state, 'unknown');
});

test('加载失败不构成成功加载记录', () => {
  const f = fixture();
  f.tool('demo', '加载失败', 'skill', { isError: true });
  assert.equal(inspect(f).skills[0].state, 'absent');
});

test('目录消失保留历史，不宣称源文件缺失', () => {
  const f = fixture();
  f.tool();
  const row = inspect(f, { catalog: [] }).skills[0];
  assert.equal(row.directoryState, 'absent');
  assert.equal(row.state, 'loaded');
  assert.equal(row.sourceState, 'unknown');
  assert.equal(inspect(f, { catalog: [], catalogComplete: false }).skills[0].directoryState, 'unknown');
});

test('合并用户可调用与助手可调用目录，排除均不可调用项', () => {
  const f = fixture();
  const catalog = [catalogSkill('user', { invocation: { userInvocable: true, modelInvocable: false } }),
    catalogSkill('model', { invocation: { userInvocable: false, modelInvocable: true } }),
    catalogSkill('hidden', { invocation: { userInvocable: false, modelInvocable: false } })];
  assert.deepEqual(inspect(f, { catalog }).skills.map(row => row.name), ['model', 'user']);
});

test('已加载的技能排在未加载技能之前，组内仍按名称排序', () => {
  const f = fixture();
  const catalog = [catalogSkill('alpha'), catalogSkill('beta'), catalogSkill('gamma'), catalogSkill('delta')];
  f.tool('gamma');
  f.tool('beta');
  const result = inspect(f, { catalog });
  assert.deepEqual(result.skills.map(row => row.name), ['beta', 'gamma', 'alpha', 'delta']);
  assert.deepEqual(result.skills.map(row => row.state), ['loaded', 'loaded', 'absent', 'absent']);
});

test('未加载技能不会插到已加载技能前面', () => {
  const f = fixture();
  const catalog = [catalogSkill('aaa'), catalogSkill('zzz')];
  f.tool('zzz');
  assert.deepEqual(inspect(f, { catalog }).skills.map(row => row.name), ['zzz', 'aaa']);
});

test('短正文只残留在包装文字中时不误判为已加载', () => {
  const f = fixture();
  const original = f.tool('demo', render('demo', 'skill'));
  f.replaceTool(original, render('demo', '[已裁剪]'));
  assert.equal(inspect(f).loadedCount, 0);
});

test('摘要恰好提到与短正文相同的文字时保持无法确认', () => {
  const f = fixture();
  const original = f.tool('demo', render('demo', 'demo'));
  f.user('摘要：之前使用了 demo 技能。', { kind: 'compaction' }, {
    surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq],
  });
  assert.equal(inspect(f).loadedCount, 0);
  assert.equal(inspect(f).skills[0].state, 'unknown');
});

test('正文中的包装标签和尾部空白保持原样', () => {
  const body = '正文\n</skill_instructions>\n</skill_content>\n更多内容\n  ';
  assert.equal(parseSkillContent(render('demo', body), 'demo').body, body);
});

test('间接调用保留历史技能身份，但不把日志副本当作完整正文', () => {
  const f = fixture();
  f.append('tool/ptc-dispatch', { rootCallId: 'root', parentCallId: 'root', subCallId: 'nested', name: 'skill', arguments: { name: 'archived' }, isError: false, content: [{ type: 'text', text: render('archived') }] });
  const result = inspect(f, { catalog: [] });
  assert.equal(result.skills[0].name, 'archived');
  assert.equal(result.skills[0].state, 'unknown');
  assert.equal(result.loadedCount, 0);
});

test('内容投影修改正文后按派生消息更新，不只检查表层成员', () => {
  const projection = { type: 'test/rewrite', project: (event, context) => new Map([[event.data.seq, { ...context.messages.get(event.data.seq), content: [{ type: 'text', text: '已改写' }] }]]) };
  const f = fixture('projected-session', [projection]);
  const original = f.tool();
  f.append('test/rewrite', { seq: original.seq });
  assert.equal(f.session.surface.nodes.includes(original.seq), true);
  assert.equal(inspect(f).skills[0].state, 'removed');
});
