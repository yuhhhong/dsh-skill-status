import { createHash } from 'node:crypto';

export const statusLabels = {
  loaded: '已加载', absent: '未检测到加载', removed: '完整正文不在上下文', unknown: '无法确认',
};

const textOf = (message) => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
const decode = (value) => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');

// 仅拆解正式入口的规范包装；主正文原样保留，允许正文自己包含闭合标签。
export function parseSkillContent(text, name) {
  const escapedName = name.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const start = `<skill_content name="${escapedName}">\n<skill_resources>\n`;
  const separator = '\n</skill_resources>\n\n<skill_instructions>\n';
  const end = '\n</skill_instructions>\n</skill_content>';
  if (!text.startsWith(start) || !text.endsWith(end)) return undefined;
  const split = text.indexOf(separator, start.length);
  if (split < 0) return undefined;
  const body = text.slice(split + separator.length, -end.length);
  if (!body.length) return undefined;
  const resource = decode(text.slice(start.length, split));
  return { body, resource };
}

export function eventMessage(event) {
  if (event.type === 'user/message') return event.data;
  return event.data?.message;
}

export function collectHistory(events) {
  const calls = new Map();
  const records = [];
  const originalCalls = new Set();
  let complete = events.every((event, index) => event.seq === index);
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(event.data.callId, event.data);
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content ?? []) {
        if (block.type === 'tool-call') calls.set(block.id, block);
      }
    }
    let message = eventMessage(event);
    let name;
    let entry;
    if (event.type === 'user/message' && message?.source?.kind === 'skill-invocation' && message.source.form === 'instructions') {
      name = message.source.name;
      entry = 'user';
    } else if (event.type === 'tool/result') {
      const call = calls.get(message?.toolCallId);
      if (call?.name !== 'skill' || message.isError || event.data.error) continue;
      if (originalCalls.has(message.toolCallId)) continue;
      originalCalls.add(message.toolCallId);
      try { name = JSON.parse(call.arguments).name; } catch { complete = false; }
      entry = 'tool';
    } else if (event.type === 'tool/ptc-dispatch' && event.data?.name === 'skill') {
      if (event.data.isError || event.data.error) continue;
      // 间接调用的日志副本可能经过转换，保留已知身份但不冒充原始完整正文。
      try { name = (typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments)?.name; } catch { complete = false; }
      message = { id: event.data.subCallId, toolCallId: event.data.rootCallId };
      entry = 'tool';
    }
    if (!entry) continue;
    if (typeof name !== 'string' || !name) { complete = false; continue; }
    // 替换记录不能充当加载时的完整原文。
    const parsed = event.surfaceOp === 'append' ? parseSkillContent(textOf(message), name) : undefined;
    const digest = createHash('sha256').update(JSON.stringify([name, parsed?.body, parsed?.resource, parsed ? null : event.seq])).digest('hex');
    records.push({ name, id: digest, seq: event.seq, time: event.time, messageId: message.id,
      callId: message.toolCallId, entry, body: parsed?.body ?? null, resource: parsed?.resource ?? null });
  }
  return { records, complete };
}

function currentCandidates(record, messages, events) {
  const descendants = new Set([record.seq]);
  const messageIds = new Set([record.messageId]);
  for (const event of events) {
    if (event.sourceEventSeqs?.some(seq => descendants.has(seq))) {
      descendants.add(event.seq);
      let message = eventMessage(event);
      if (message?.id) messageIds.add(message.id);
    }
  }
  return messages.filter(message => messageIds.has(message.id) ||
    (record.callId && message.role === 'tool' && message.toolCallId === record.callId));
}

function containsInstructions(message, record) {
  const text = textOf(message);
  const direct = message.id === record.messageId || (record.callId && message.role === 'tool' && message.toolCallId === record.callId);
  if (direct && text === record.body) return true;
  const opening = '<skill_instructions>\n';
  const closing = '\n</skill_instructions>';
  const start = text.indexOf(opening);
  const end = text.lastIndexOf(closing);
  if (start >= 0 && end >= start + opening.length) {
    return text.slice(start + opening.length, end).includes(record.body);
  }
  if (!text.includes(record.body)) return false;
  if (!direct || text.includes('<skill_resources>') || text.includes('<skill_content')) return undefined;
  return true;
}

export function analyze({ events = [], messages, catalog = [], catalogComplete = false, historyComplete = true }) {
  const history = collectHistory(events);
  const complete = historyComplete && history.complete;
  const rows = new Map();
  for (const skill of catalog) {
    if (!skill.invocation?.modelInvocable && !skill.invocation?.userInvocable) continue;
    rows.set(skill.name, { name: skill.name, description: skill.description, inCatalog: true,
      catalogSource: skill.path ?? skill.resourceBase?.url ?? skill.resourceBase?.description ?? skill.resourceBase?.path ?? null,
      catalogPath: skill.path ?? null, versions: [] });
  }
  for (const record of history.records) {
    const row = rows.get(record.name) ?? { name: record.name, description: '', inCatalog: false, catalogSource: null, catalogPath: null, versions: [] };
    const candidates = messages ? currentCandidates(record, messages, events) : [];
    const evidence = record.body === null ? [] : candidates.map(message => containsInstructions(message, record));
    const retained = evidence.includes(true);
    const state = retained ? 'loaded' : !messages || record.body === null || evidence.includes(undefined) ? 'unknown' : 'removed';
    const reason = state === 'removed' ? (candidates.some(message => message.role === 'tool' && message.toolCallId === record.callId) ? '正文已被裁剪或修改' : '正文已离开当前上下文') : null;
    const existing = row.versions.find(version => version.id === record.id);
    if (existing) {
      existing.loadCount++;
      existing.seq = record.seq;
      existing.time = record.time;
      if (state === 'loaded' || (existing.state !== 'loaded' && state === 'unknown')) { existing.state = state; existing.reason = reason; }
    } else {
      row.versions.push({ id: record.id, seq: record.seq, time: record.time, body: record.body,
        resource: record.resource, entry: record.entry, state, reason, loadCount: 1 });
    }
    rows.set(record.name, row);
  }
  const skills = [...rows.values()].map(row => {
    row.versions.sort((left, right) => right.seq - left.seq);
    const state = row.versions.some(version => version.state === 'loaded') ? 'loaded'
      : !complete || row.versions.some(version => version.state === 'unknown') ? 'unknown'
      : row.versions.length ? 'removed' : 'absent';
    return { ...row, state, directoryState: !catalogComplete ? 'unknown' : row.inCatalog ? 'present' : 'absent', sourceState: 'unknown' };
  }).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  return { skills, loadedCount: skills.filter(row => row.state === 'loaded').length,
    uncertain: !complete || !catalogComplete || !messages || skills.some(row => row.state === 'unknown'),
    historyComplete: complete, catalogComplete, contextComplete: !!messages };
}
