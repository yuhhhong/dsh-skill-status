import { Session } from '@deepseek-ai/dsh-session';
import { renderSkillContent } from '@deepseek-ai/dsh-skill';

export const catalogSkill = (name = 'demo', extra = {}) => ({ name, description: '演示技能', provider: 'test', source: 'runtime', invocation: { modelInvocable: true, userInvocable: true }, ...extra });
export const render = (name = 'demo', content = '第一行\n中间的重要指令\n最后一行', extra = {}) => renderSkillContent({ ...catalogSkill(name), content, ...extra });
export function fixture(id = 'test-session', projections = []) {
  const session = Session.create(id, undefined, undefined, undefined, projections);
  const events = [];
  let counter = 0;
  const append = (type, data, options) => {
    const event = options ? session.append(type, data, options) : session.append(type, data);
    events.push(event);
    return event;
  };
  const message = (role, text, extra = {}) => ({ id: `message-${++counter}`, role, content: [{ type: 'text', text }], source: { kind: 'user' }, ...extra });
  const user = (text, source = { kind: 'user' }, options = { surfaceOp: 'append' }) => append('user/message', message('user', text, { source }), options);
  const tool = (name = 'demo', content = render(name), toolName = 'skill', extra = {}) => {
    const callId = `call-${++counter}`;
    append('tool/call', { turn: 1, step: 1, callId, name: toolName, arguments: JSON.stringify({ name }) });
    return append('tool/result', { turn: 1, step: 1, message: message('tool', content, { source: { kind: 'tool', callId }, toolCallId: callId, ...extra }) }, { surfaceOp: 'append' });
  };
  const replaceTool = (original, text) => append('tool/result', { ...original.data, message: { ...original.data.message, content: [{ type: 'text', text }] } }, { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] });
  const ctx = {
    agents: { get: target => target === id ? agent : undefined },
    sessions: { get: target => target === id ? session : undefined,
      prepare: (target, options) => Session.fromRestore(target, options.seed, options.meta, options.inheritedEventCount, options.eventState, projections) },
    sessionQuery: { readSession: async () => ({ session: session.header, events: [...events], inheritedEventCount: 0 }) },
    skills: { snapshot: async () => ({ skills: [catalogSkill()], complete: true }) },
    fs: { resolve: async path => path, stat: async () => ({ type: 'file' }) },
    get: () => undefined,
  };
  const agent = { session };
  return { session, events, append, message, user, tool, replaceTool, ctx, agent };
}
