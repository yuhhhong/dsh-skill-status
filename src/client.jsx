import React, { useState, useSyncExternalStore } from 'react';

const labels = { loaded: '已加载', absent: '未检测到加载', removed: '完整正文不在上下文', unknown: '无法确认' };
const tabId = 'dsh-skill-status';
const empty = Object.freeze({ phase: 'pending' });

export function createStatusStore(call, sessionId) {
  let value = empty;
  let controller;
  let retryTimer;
  const listeners = new Set();
  const publish = next => { value = next; for (const listener of listeners) listener(); };
  async function run(signal) {
    let after;
    while (!signal.aborted) {
      try {
        const response = await call('/api', 'skill-status.read', { sessionId, ...(after ? { after } : {}) }, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
        if (signal.aborted) return;
        if (!response.ok || response.value?.sessionId !== sessionId) throw new Error('技能状态响应无效。');
        after = response.value.revision;
        publish({ phase: 'ready', data: response.value });
      } catch {
        if (signal.aborted) return;
        after = undefined;
        publish({ phase: 'error' });
        await new Promise(resolve => {
          const finish = () => { clearTimeout(retryTimer); signal.removeEventListener('abort', finish); resolve(); };
          retryTimer = setTimeout(finish, 3000);
          signal.addEventListener('abort', finish, { once: true });
          if (signal.aborted) finish();
        });
      }
    }
  }
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) { controller = new AbortController(); void run(controller.signal); }
      return () => { listeners.delete(listener); if (!listeners.size) { controller?.abort(); value = empty; } };
    },
    dispose() { controller?.abort(); clearTimeout(retryTimer); listeners.clear(); value = empty; },
  };
}

export function SkillPanel({ state }) {
  const [filter, setFilter] = useState('');
  if (state.phase === 'pending') return <div className="dsh-skills" role="status">正在核实技能状态…</div>;
  if (state.phase === 'error') return <div className="dsh-skills" role="status">暂时无法查询技能状态，正在自动重试。</div>;
  const data = state.data;
  const rows = data.skills.filter(row => `${row.name} ${row.description}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section className="dsh-skills" aria-label="当前会话技能状态">
    <div className="dsh-skills-summary"><strong>技能</strong><span>已确认加载 {data.loadedCount} 个</span></div>
    <p className="dsh-skills-muted">仅检查主助手通过正式入口加载的完整技能正文。</p>
    {data.uncertain && <p className="dsh-skills-notice" role="status">部分状态无法确认，计数仅包含已核实的技能。</p>}
    {data.note && <p className="dsh-skills-muted">{data.note}</p>}
    <label className="dsh-skills-search">筛选技能<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="输入技能名称或说明" /></label>
    {!rows.length && <p className="dsh-skills-muted">{filter ? '没有匹配的技能。' : data.uncertain ? '目前没有可核实的技能条目。' : '当前没有可用技能或正式加载记录。'}</p>}
    <div className="dsh-skills-list">{rows.map(row => <SkillRow key={row.name} row={row} />)}</div>
  </section>;
}

function SkillRow({ row }) {
  const [selected, setSelected] = useState(null);
  const version = row.versions.find(item => item.id === selected) ?? row.versions[0];
  const directoryLabel = row.directoryState === 'absent' ? '未在当前技能目录中' : row.directoryState === 'unknown' ? '当前目录无法确认' : null;
  return <details className="dsh-skills-row">
    <summary><span className="dsh-skills-name">{row.name}</span><span className={`dsh-skills-state dsh-skills-${row.state}`}>{labels[row.state]}</span></summary>
    {directoryLabel && <p className="dsh-skills-muted">{directoryLabel}</p>}
    {row.description && <p>{row.description}</p>}
    {row.catalogSource && <details className="dsh-skills-source"><summary>查看当前目录来源</summary><pre>{row.catalogSource}</pre>
      {row.catalogSourceState === 'missing' && <p>源文件不存在</p>}
      {row.catalogSourceState === 'unknown' && <p>来源状态未知</p>}
      {!!row.versions.length && <p className="dsh-skills-muted">此处是当前目录提供的来源，加载时的来源以各版本记录为准。</p>}
    </details>}
    {!version ? <p className="dsh-skills-muted">{row.state === 'unknown' ? '现有证据不足以核实加载记录。' : '没有检测到正式入口成功加载的记录。'}</p> : <>
      <label className="dsh-skills-version">正文版本<select value={version.id} onChange={event => setSelected(event.target.value)}>
        {row.versions.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? '最近加载' : `版本 ${row.versions.length - index}`} · {new Date(item.time).toLocaleString()} · {labels[item.state]}</option>)}
      </select></label>
      <p className="dsh-skills-muted">{version.entry === 'user' ? '用户调用' : 'skill 工具'} · 加载 {version.loadCount} 次 · {labels[version.state]}</p>
      <p><strong>{version.state === 'loaded' ? '上下文正文' : '历史正文'}</strong>{version.reason ? ` · ${version.reason}` : ''}</p>
      {version.state === 'unknown' && <p className="dsh-skills-notice">无法确认这版完整正文是否仍在当前上下文中。</p>}
      {version.body === null ? <p>无法取得加载时的完整正文。</p> : <pre className="dsh-skills-body">{version.body}</pre>}
      <details className="dsh-skills-source"><summary>查看加载时的来源</summary><pre>{version.resource ?? '来源状态未知：历史记录未保留可核实的来源。'}</pre>
        <p className="dsh-skills-muted">资源指引不一定包含源文件路径；未取得确切路径时，无法判断源文件是否存在。</p>
      </details>
    </>}
  </details>;
}

export const inject = ['slots', 'connection', 'sidebarRight', 'sidebarRightTabs'];

export function apply(ctx) {
  const stores = new Map();
  const getStore = sessionId => {
    if (!stores.has(sessionId)) stores.set(sessionId, createStatusStore(ctx.connection.rpc.call.bind(ctx.connection.rpc), sessionId));
    return stores.get(sessionId);
  };
  function useStatus(sessionId) {
    const store = getStore(sessionId);
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  }
  function Header({ sessionId }) {
    const state = useStatus(sessionId);
    const count = state.phase === 'ready' ? `${state.data.loadedCount}${state.data.uncertain ? ' · ?' : ''}` : state.phase === 'pending' ? '…' : '?';
    return <button type="button" className="dsh-skills-trigger" onClick={() => ctx.sidebarRight.openTab(tabId)}
      title="查看当前会话技能状态" aria-label={`查看当前会话技能状态：${count}`}>技能 <span aria-live="polite">{count}</span></button>;
  }
  function Panel({ sessionId }) { return <SkillPanel key={sessionId} state={useStatus(sessionId)} />; }
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    document.head.append(style);
    return () => { style.remove(); for (const store of stores.values()) store.dispose(); stores.clear(); };
  });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: tabId, kind: tabId, title: () => '技能' }));
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: tabId, order: 20 }, Header));
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: tabId }, Panel));
}

const CSS_TEXT = `
.dsh-skills { height:100%; overflow:auto; padding:20px; box-sizing:border-box; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font-size:14px; line-height:1.6; }
.dsh-skills-trigger { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:transparent; color:var(--dsw-alias-label-primary); padding:5px 10px; cursor:pointer; font:inherit; font-size:13px; white-space:nowrap; }
.dsh-skills-trigger:hover { background:var(--dsw-alias-bg-layer-2); }
.dsh-skills-trigger:focus-visible,.dsh-skills summary:focus-visible,.dsh-skills input:focus-visible,.dsh-skills select:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }
.dsh-skills-summary { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
.dsh-skills-summary strong { font-size:18px; }
.dsh-skills-muted { color:var(--dsw-alias-label-secondary); font-size:12px; }
.dsh-skills-notice { color:var(--dsw-alias-state-warn-primary); font-size:13px; }
.dsh-skills-search,.dsh-skills-version { display:grid; gap:6px; margin:16px 0; font-size:12px; }
.dsh-skills input,.dsh-skills select { min-width:0; width:100%; box-sizing:border-box; padding:8px; border:1px solid var(--dsw-alias-border-l1); border-radius:7px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; }
.dsh-skills-row { border-top:1px solid var(--dsw-alias-border-l1); padding:12px 0; overflow-wrap:anywhere; }
.dsh-skills-row>summary { cursor:pointer; }
.dsh-skills-name { font-weight:600; margin-right:10px; }
.dsh-skills-state { font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-skills-loaded { color:var(--dsw-alias-state-success-primary); }
.dsh-skills-unknown { color:var(--dsw-alias-state-warn-primary); }
.dsh-skills pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.7 ui-monospace,monospace; }
.dsh-skills-body { max-height:55vh; overflow:auto; padding:12px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; }
.dsh-skills-source { margin:12px 0; font-size:12px; }
.dsh-skills-source summary { cursor:pointer; color:var(--dsw-alias-brand-primary); }
`;
