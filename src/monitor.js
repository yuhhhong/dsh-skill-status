import { randomUUID } from 'node:crypto';
import { analyze } from './analyze.js';

// 异步观察与同步正文比对分开；序号变化时重试，绝不拼接不同时间点的证据。
export async function readStatus(ctx, sessionId, signal) {
  let lastEvents = [];
  let lastCatalog = [];
  let catalogComplete = false;
  let historyComplete = false;
  let header;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    let log;
    try {
      log = await ctx.sessionQuery.readSession(sessionId);
      lastEvents = log.events;
      header = log.session;
      historyComplete = true;
    } catch {
      break;
    }
    if (header.origin === 'subagent') return { ...analyze({}), sessionId, excluded: true, note: '此面板仅查看主助手会话。' };
    const live = ctx.sessions.get(sessionId);
    const agent = ctx.agents.get(sessionId);
    let lease;
    try {
      const presets = ctx.get?.('agentPresets');
      const presetId = log.events.findLast(event => event.type === 'agent-preset/selected')?.data.agentPreset ?? header.agentPreset;
      if (!agent && presets) lease = await presets.acquireScope(presetId);
      if (!agent && presetId && !lease) throw new Error('无法核实会话预设。');
      const registry = (agent && presets?.serviceFor(agent, 'skills')) || ctx.skills;
      const catalog = await registry.snapshot({ cwd: header.cwd, scope: agent ?? lease?.key, signal });
      lastCatalog = catalog.skills;
      catalogComplete = catalog.complete;
    } catch {
      catalogComplete = false;
    } finally {
      if (lease) await lease[Symbol.asyncDispose]();
    }
    let session = live;
    if (!session) {
      try {
        session = ctx.sessions.prepare(sessionId, { seed: log.events, meta: header, inheritedEventCount: log.inheritedEventCount, eventState: 'detached' });
      } catch { continue; }
    }
    if ((live ? live.seq : session.firstLiveSeq) !== log.events.length || ctx.sessions.get(sessionId) !== live || ctx.agents.get(sessionId) !== agent) continue;
    let messages;
    try { messages = session.deriveMessages(); } catch { /* 缺失消息投影时保持无法确认。 */ }
    const result = analyze({ events: log.events, messages, catalog: lastCatalog, catalogComplete, historyComplete });
    await Promise.all(result.skills.map(async row => {
      if (!row.catalogPath) return;
      try {
        const target = await ctx.fs.resolve(row.catalogPath, { cwd: header.cwd, signal });
        row.catalogSourceState = await ctx.fs.stat(target, signal) ? 'present' : 'missing';
      } catch { row.catalogSourceState = 'unknown'; }
    }));
    signal?.throwIfAborted();
    if (!live) {
      try {
        const latest = await ctx.sessionQuery.readSession(sessionId);
        if (latest.events.length !== log.events.length || JSON.stringify(latest.events.at(-1)) !== JSON.stringify(log.events.at(-1)) || JSON.stringify(latest.session) !== JSON.stringify(header)) continue;
      } catch { continue; }
    }
    if ((live && live.seq !== log.events.length) || ctx.sessions.get(sessionId) !== live || ctx.agents.get(sessionId) !== agent) continue;
    return { ...result, sessionId, asOfSeq: log.events.length - 1,
      note: !messages ? '当前上下文暂时无法核实。' : !agent ? '已按保存记录核对正文；技能目录按此会话预设查询。' : null };
  }
  return { ...analyze({ events: lastEvents, catalog: lastCatalog, catalogComplete, historyComplete }), sessionId,
    note: historyComplete ? '会话正在变化，稍后自动重新核实。' : '会话记录暂时无法读取，稍后自动重试。' };
}

export class StatusMonitor {
  constructor(ctx, refreshMs = 5000) {
    this.ctx = ctx;
    this.refreshMs = refreshMs;
    this.epoch = randomUUID();
    this.revision = 0;
    this.sessionRevisions = new Map();
    this.listeners = new Set();
    this.controller = new AbortController();
  }

  invalidate(sessionId) {
    if (sessionId) this.sessionRevisions.set(sessionId, (this.sessionRevisions.get(sessionId) ?? 0) + 1);
    else this.revision++;
    for (const listener of [...this.listeners]) listener(sessionId);
  }

  async read(sessionId, after, signal) {
    const linkedSignal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    linkedSignal.throwIfAborted();
    const token = () => `${this.epoch}:${this.revision}:${this.sessionRevisions.get(sessionId) ?? 0}`;
    if (after === token()) {
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          this.listeners.delete(changed);
          linkedSignal.removeEventListener('abort', aborted);
          error ? reject(error) : resolve();
        };
        const changed = (changedId) => { if (!changedId || changedId === sessionId) finish(); };
        const aborted = () => finish(linkedSignal.reason);
        const timer = setTimeout(() => finish(), this.refreshMs);
        this.listeners.add(changed);
        linkedSignal.addEventListener('abort', aborted, { once: true });
        if (linkedSignal.aborted) aborted();
      });
    }
    // 先记录令牌。计算期间发生的新事件会让下次请求立即重新核实。
    const revision = token();
    const snapshot = await readStatus(this.ctx, sessionId, linkedSignal);
    linkedSignal.throwIfAborted();
    return { ...snapshot, revision };
  }

  dispose() {
    this.controller.abort(new Error('技能状态插件已卸载。'));
    this.listeners.clear();
  }
}
