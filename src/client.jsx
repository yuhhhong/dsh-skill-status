import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createTranslationEnvironment, createTranslationStore, translationViewKey } from './translation-client.js';

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

export function SkillPanel({ state, translation }) {
  const [filter, setFilter] = useState('');
  if (state.phase === 'pending') return <div className="dsh-skills" role="status">正在核实技能状态…</div>;
  if (state.phase === 'error') return <div className="dsh-skills" role="status">暂时无法查询技能状态，正在自动重试。</div>;
  const data = state.data;
  const rows = data.skills.filter(row => `${row.name} ${row.description}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section className="dsh-skills" aria-label="当前会话技能状态">
    <div className="dsh-skills-summary"><strong>技能</strong><span>已确认加载 {data.loadedCount} 个</span></div>
    <p className="dsh-skills-muted">仅检查主助手通过正式入口加载的完整技能正文。</p>
    {data.issues?.map(issue => <p key={issue.code} className="dsh-skills-notice" role="status">{issue.message}</p>)}
    {data.note && <p className="dsh-skills-muted">{data.note}</p>}
    <label className="dsh-skills-search">筛选技能<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="输入技能名称或说明" /></label>
    {!rows.length && <p className="dsh-skills-muted">{filter ? '没有匹配的技能。' : data.uncertain ? '目前没有可核实的技能条目。' : '当前没有可用技能或正式加载记录。'}</p>}
    <div className="dsh-skills-list">{rows.map(row => <SkillRow key={row.name} row={row} sessionId={data.sessionId} translation={translation} />)}</div>
  </section>;
}

function SkillRow({ row, sessionId, translation }) {
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const version = row.versions.find(item => item.id === selected) ?? row.versions[0];
  const directoryLabel = row.directoryState === 'absent' ? '未在当前技能目录中' : null;
  return <details className="dsh-skills-row" onToggle={event => {
    if (event.target === event.currentTarget) {
      setExpanded(event.currentTarget.open);
    }
  }}>
    <summary>
      <span className="dsh-skills-name">{row.name}</span><span className={`dsh-skills-state dsh-skills-${row.state}`}>{labels[row.state]}</span>
      {row.directoryState === 'unknown' && <span className="dsh-skills-state dsh-skills-unknown"> · 目录待确认</span>}
      {!!row.issues?.length && <span className="dsh-skills-row-issues">{row.issues.map(issue => <span key={issue.code} className="dsh-skills-notice">{issue.message}</span>)}</span>}
    </summary>
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
      <SkillBody key={translationViewKey(sessionId, version, translation?.info?.preferences, translation?.locale)} version={version} sessionId={sessionId} translation={translation} expanded={expanded} />
      <details className="dsh-skills-source"><summary>查看加载时的来源</summary><pre>{version.resource ?? '来源状态未知：历史记录未保留可核实的来源。'}</pre>
        <p className="dsh-skills-muted">资源指引不一定包含源文件路径；未取得确切路径时，无法判断源文件是否存在。</p>
      </details>
    </>}
  </details>;
}

function SkillBody({ version, sessionId, translation, expanded }) {
  const heading = <><strong>{version.state === 'loaded' ? '上下文正文' : '历史正文'}</strong>{version.state !== 'unknown' && version.reason ? ` · ${version.reason}` : ''}</>;
  const warning = version.state === 'unknown' ? <p className="dsh-skills-notice">{version.reason ?? '无法确认这版完整正文是否仍在当前上下文中。'}</p> : null;
  if (translation?.info?.supported && translation.locale && typeof version.body === 'string' && version.body.length > 0) {
    return <TranslationBody heading={heading} warning={warning} body={version.body} sessionId={sessionId} translation={translation} expanded={expanded && translation.visible !== false} />;
  }
  return <><p>{heading}</p>{warning}{version.body === null ? <p>无法取得加载时的完整正文。</p> : <pre className="dsh-skills-body">{version.body}</pre>}</>;
}

export function TranslationBody({ heading, warning, body, sessionId, translation, expanded }) {
  const targetLanguage = translation.info.preferences.targetLanguage === 'auto' ? translation.locale : translation.info.preferences.targetLanguage;
  const store = useMemo(() => createTranslationStore(translation.call, { sessionId, body, locale: targetLanguage }), [translation.call, sessionId, body, targetLanguage]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [translated, setTranslated] = useState(false);
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    if (!expanded) {
      store.cancel();
    }
  }, [expanded, store]);
  const parts = state.parts;
  const total = parts?.filter(part => part.translatable).length ?? 0;
  const completed = parts?.filter(part => part.translatable && part.status === 'success').length ?? 0;
  const busy = state.phase === 'preparing' || state.phase === 'running';
  const complete = parts !== null && completed === total;
  const start = () => {
    setTranslated(true);
    void store.start();
  };
  return <>
    <div className="dsh-skills-body-heading"><p>{heading}</p><div className="dsh-skills-translation-actions">
      {(!parts || busy) && <button type="button" disabled={!expanded || busy} onClick={start}>{busy ? '正在机翻…' : '机翻'}</button>}
      {parts && <button type="button" onClick={() => setTranslated(current => !current)}>{translated ? '查看原文' : '查看译文'}</button>}
      {busy && <button type="button" onClick={() => store.cancel()}>取消</button>}
    </div></div>
    {warning}
    {state.error && <p className="dsh-skills-notice" role="status">{state.error.message}</p>}
    {parts && <p className="dsh-skills-muted" aria-live="polite">已完成 {completed}/{total} 块{complete ? ' · 翻译完成' : busy ? ' · 正在翻译' : ' · 部分正文尚未翻译'}{translated ? ' · 机翻，仅供阅读' : ''}</p>}
    {!translated || !parts ? <pre className="dsh-skills-body">{body}</pre> : <pre className="dsh-skills-body">{parts.map((part, index) => <React.Fragment key={index}>
      {part.translatable && part.status !== 'success' && <span className={`dsh-skills-translation-status${part.status === 'failed' ? ' dsh-skills-notice' : ''}`}>{part.status === 'translating' ? '【正在翻译，暂显示原文】' : part.status === 'failed' ? `【翻译失败：${part.error?.message ?? '请手动重试'}，暂显示原文】` : part.status === 'cancelled' ? '【已取消，暂显示原文】' : '【尚未翻译，暂显示原文】'}</span>}
      {part.status === 'success' ? part.text : part.original}
    </React.Fragment>)}</pre>}
    {parts && !complete && !busy && <button type="button" className="dsh-skills-retry" onClick={start}>重试未完成块</button>}
  </>;
}

export function TranslationSettings({ scope, view }) {
  const source = useMemo(() => ({ subscribe: scope.subscribe.bind(scope), getSnapshot: scope.getSnapshot.bind(scope) }), [scope]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [provider, setProvider] = useState(snapshot.value?.provider ?? 'bing');
  const [targetLanguage, setTargetLanguage] = useState(snapshot.value?.targetLanguage ?? 'auto');
  const [customLanguage, setCustomLanguage] = useState(snapshot.value?.targetLanguage === 'auto' ? '' : snapshot.value?.targetLanguage ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (snapshot.status === 'ready') {
      setProvider(snapshot.value.provider);
      setTargetLanguage(snapshot.value.targetLanguage);
      setCustomLanguage(snapshot.value.targetLanguage === 'auto' ? '' : snapshot.value.targetLanguage);
    }
  }, [snapshot.revision, snapshot.status]);
  if (view === 'summary') {
    return snapshot.status === 'ready' ? <>{snapshot.value.provider === 'google' ? 'Google' : 'Bing'} · {snapshot.value.targetLanguage === 'auto' ? '跟随界面语言' : snapshot.value.targetLanguage}</> : null;
  }
  const actualLanguage = targetLanguage === 'auto' ? 'auto' : customLanguage.trim();
  const changed = provider !== snapshot.value?.provider || actualLanguage !== snapshot.value?.targetLanguage;
  const valid = targetLanguage === 'auto' || (actualLanguage !== 'auto' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(actualLanguage));
  async function save(event) {
    event.preventDefault();
    if (!valid || !changed || saving || !snapshot.writable) {
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const accepted = await scope.mutate([{ op: 'set', path: ['provider'], value: provider }, { op: 'set', path: ['targetLanguage'], value: actualLanguage }], snapshot.revision);
      setMessage(accepted ? '翻译设置已保存。' : '设置未被接受，请重新核对当前设置后保存。');
    } catch {
      setMessage('翻译设置保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  return <form className="dsh-skills dsh-skills-settings" onSubmit={save}>
    <h3>技能正文机翻</h3>
    <p className="dsh-skills-muted">仅翻译当前查看的正文，译文仅供阅读。两项设置保存后一起生效。</p>
    {snapshot.status !== 'ready' ? <p role="status">{snapshot.status === 'loading' ? '正在读取翻译设置…' : '当前无法读取翻译设置。'}</p> : <>
      <label className="dsh-skills-version">翻译服务<select value={provider} disabled={saving || !snapshot.writable} onChange={event => setProvider(event.target.value)}><option value="bing">Bing</option><option value="google">Google</option></select></label>
      <label className="dsh-skills-version">目标语言<select value={targetLanguage === 'auto' ? 'auto' : 'custom'} disabled={saving || !snapshot.writable} onChange={event => setTargetLanguage(event.target.value)}><option value="auto">跟随界面语言</option><option value="custom">指定语言代码</option></select></label>
      {targetLanguage !== 'auto' && <label className="dsh-skills-version">语言代码<input value={customLanguage} disabled={saving || !snapshot.writable} onChange={event => setCustomLanguage(event.target.value)} placeholder="例如 zh-CN、en、ja" /></label>}
      {!valid && <p className="dsh-skills-notice">请输入有效的目标语言代码，例如 zh-CN 或 en。</p>}
      {!snapshot.writable && <p className="dsh-skills-notice">当前配置不能保存。</p>}
      <button type="submit" disabled={!valid || !changed || saving || !snapshot.writable}>{saving ? '正在保存…' : '保存'}</button>
    </>}
    {message && <p className="dsh-skills-muted" role="status">{message}</p>}
  </form>;
}

export const inject = ['slots', 'connection', 'sidebarRight', 'sidebarRightTabs'];

export function apply(ctx) {
  const stores = new Map();
  const translation = createTranslationEnvironment(ctx.connection.rpc.call.bind(ctx.connection.rpc));
  ctx.inject?.(['locale'], child => {
    let mounted = false;
    let closed = false;
    child.effect(() => () => {
      closed = true;
      translation.setLocale(null);
    });
    const mount = () => {
      if (closed || mounted || !translation.getSnapshot().info?.supported) {
        return;
      }
      mounted = true;
      const updateLocale = () => translation.setLocale(child.locale.getSnapshot().active);
      updateLocale();
      child.effect(() => child.locale.subscribe(updateLocale));
      child.inject(['configForms'], scoped => {
        const scope = scoped.configForms.get(tabId);
        const updatePreferences = () => {
          const snapshot = scope.getSnapshot();
          if (snapshot.status === 'ready') {
            translation.setPreferences(snapshot.value);
          }
        };
        updatePreferences();
        scoped.effect(() => scope.subscribe(updatePreferences));
        scoped.slots.inject('plugins.bundle.config', () => scoped.slots.register({ name: 'plugins.bundle.config', key: tabId }, props => <TranslationSettings scope={scope} view={props.view} />));
      });
    };
    child.effect(() => translation.subscribe(mount));
    void translation.refresh().then(mount);
  });
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
  function Panel({ sessionId, visible = true }) {
    const translationState = useSyncExternalStore(translation.subscribe, translation.getSnapshot, translation.getSnapshot);
    useEffect(() => { void translation.refresh(); }, []);
    return <SkillPanel key={sessionId} state={useStatus(sessionId)} translation={{ ...translationState, call: translation.call, visible }} />;
  }
  function VisiblePanel({ useTabInfo, ...props }) {
    const info = useTabInfo();
    return <Panel {...props} visible={info.tab.visible} />;
  }
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    document.head.append(style);
    return () => {
      style.remove();
      for (const store of stores.values()) {
        store.dispose();
      }
      stores.clear();
      translation.dispose();
    };
  });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: tabId, kind: tabId, title: () => '技能' }));
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: tabId, order: 20 }, Header));
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: tabId }, props => props.useTabInfo ? <VisiblePanel {...props} /> : <Panel {...props} />));
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
.dsh-skills-row-issues { display:block; margin-top:4px; }
.dsh-skills-row-issues>span { display:block; }
.dsh-skills-name { font-weight:600; margin-right:10px; }
.dsh-skills-state { font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-skills-loaded { color:var(--dsw-alias-state-success-primary); }
.dsh-skills-unknown { color:var(--dsw-alias-state-warn-primary); }
.dsh-skills pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.7 ui-monospace,monospace; }
.dsh-skills-body { max-height:55vh; overflow:auto; padding:12px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:8px; }
.dsh-skills-source { margin:12px 0; font-size:12px; }
.dsh-skills-source summary { cursor:pointer; color:var(--dsw-alias-brand-primary); }
.dsh-skills button { border:1px solid var(--dsw-alias-border-l1); border-radius:7px; padding:5px 10px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
.dsh-skills button:hover { background:var(--dsw-alias-bg-layer-2); }
.dsh-skills button:disabled { cursor:default; opacity:.55; }
.dsh-skills button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }
.dsh-skills-body-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.dsh-skills-body-heading>p { margin:10px 0; }
.dsh-skills-translation-actions { display:flex; flex-wrap:wrap; gap:6px; }
.dsh-skills-translation-status { color:var(--dsw-alias-label-secondary); font:12px/1.7 sans-serif; }
.dsh-skills-translation-status.dsh-skills-notice { color:var(--dsw-alias-state-warn-primary); }
.dsh-skills-settings { height:auto; padding:12px 0; overflow:visible; }
.dsh-skills-settings h3 { margin:0; font-size:14px; }
`;
