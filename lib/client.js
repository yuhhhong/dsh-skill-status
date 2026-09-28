window.__ModuleLoader__.load({id:"dsh-skill-status",factory:(require)=>{
var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.jsx
var client_exports = {};
__export(client_exports, {
  SkillPanel: () => SkillPanel,
  apply: () => apply,
  createStatusStore: () => createStatusStore,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var labels = { loaded: "\u5DF2\u52A0\u8F7D", absent: "\u672A\u68C0\u6D4B\u5230\u52A0\u8F7D", removed: "\u5B8C\u6574\u6B63\u6587\u4E0D\u5728\u4E0A\u4E0B\u6587", unknown: "\u65E0\u6CD5\u786E\u8BA4" };
var tabId = "dsh-skill-status";
var empty = Object.freeze({ phase: "pending" });
function createStatusStore(call, sessionId) {
  let value = empty;
  let controller;
  let retryTimer;
  const listeners = /* @__PURE__ */ new Set();
  const publish = (next) => {
    value = next;
    for (const listener of listeners) listener();
  };
  async function run(signal) {
    let after;
    while (!signal.aborted) {
      try {
        const response = await call("/api", "skill-status.read", { sessionId, ...after ? { after } : {} }, AbortSignal.any([signal, AbortSignal.timeout(2e4)]));
        if (signal.aborted) return;
        if (!response.ok || response.value?.sessionId !== sessionId) throw new Error("\u6280\u80FD\u72B6\u6001\u54CD\u5E94\u65E0\u6548\u3002");
        after = response.value.revision;
        publish({ phase: "ready", data: response.value });
      } catch {
        if (signal.aborted) return;
        after = void 0;
        publish({ phase: "error" });
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(retryTimer);
            signal.removeEventListener("abort", finish);
            resolve();
          };
          retryTimer = setTimeout(finish, 3e3);
          signal.addEventListener("abort", finish, { once: true });
          if (signal.aborted) finish();
        });
      }
    }
  }
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        controller = new AbortController();
        void run(controller.signal);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          controller?.abort();
          value = empty;
        }
      };
    },
    dispose() {
      controller?.abort();
      clearTimeout(retryTimer);
      listeners.clear();
      value = empty;
    }
  };
}
function SkillPanel({ state }) {
  const [filter, setFilter] = (0, import_react.useState)("");
  if (state.phase === "pending") return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills", role: "status" }, "\u6B63\u5728\u6838\u5B9E\u6280\u80FD\u72B6\u6001\u2026");
  if (state.phase === "error") return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills", role: "status" }, "\u6682\u65F6\u65E0\u6CD5\u67E5\u8BE2\u6280\u80FD\u72B6\u6001\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u8BD5\u3002");
  const data = state.data;
  const rows = data.skills.filter((row) => `${row.name} ${row.description}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "dsh-skills", "aria-label": "\u5F53\u524D\u4F1A\u8BDD\u6280\u80FD\u72B6\u6001" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills-summary" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u6280\u80FD"), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5DF2\u786E\u8BA4\u52A0\u8F7D ", data.loadedCount, " \u4E2A")), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u4EC5\u68C0\u67E5\u4E3B\u52A9\u624B\u901A\u8FC7\u6B63\u5F0F\u5165\u53E3\u52A0\u8F7D\u7684\u5B8C\u6574\u6280\u80FD\u6B63\u6587\u3002"), data.uncertain && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-notice", role: "status" }, "\u90E8\u5206\u72B6\u6001\u65E0\u6CD5\u786E\u8BA4\uFF0C\u8BA1\u6570\u4EC5\u5305\u542B\u5DF2\u6838\u5B9E\u7684\u6280\u80FD\u3002"), data.note && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, data.note), /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-search" }, "\u7B5B\u9009\u6280\u80FD", /* @__PURE__ */ import_react.default.createElement("input", { value: filter, onChange: (event) => setFilter(event.target.value), placeholder: "\u8F93\u5165\u6280\u80FD\u540D\u79F0\u6216\u8BF4\u660E" })), !rows.length && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, filter ? "\u6CA1\u6709\u5339\u914D\u7684\u6280\u80FD\u3002" : data.uncertain ? "\u76EE\u524D\u6CA1\u6709\u53EF\u6838\u5B9E\u7684\u6280\u80FD\u6761\u76EE\u3002" : "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u6280\u80FD\u6216\u6B63\u5F0F\u52A0\u8F7D\u8BB0\u5F55\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills-list" }, rows.map((row) => /* @__PURE__ */ import_react.default.createElement(SkillRow, { key: row.name, row }))));
}
function SkillRow({ row }) {
  const [selected, setSelected] = (0, import_react.useState)(null);
  const version = row.versions.find((item) => item.id === selected) ?? row.versions[0];
  const directoryLabel = row.directoryState === "absent" ? "\u672A\u5728\u5F53\u524D\u6280\u80FD\u76EE\u5F55\u4E2D" : row.directoryState === "unknown" ? "\u5F53\u524D\u76EE\u5F55\u65E0\u6CD5\u786E\u8BA4" : null;
  return /* @__PURE__ */ import_react.default.createElement("details", { className: "dsh-skills-row" }, /* @__PURE__ */ import_react.default.createElement("summary", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-skills-name" }, row.name), /* @__PURE__ */ import_react.default.createElement("span", { className: `dsh-skills-state dsh-skills-${row.state}` }, labels[row.state])), directoryLabel && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, directoryLabel), row.description && /* @__PURE__ */ import_react.default.createElement("p", null, row.description), row.catalogSource && /* @__PURE__ */ import_react.default.createElement("details", { className: "dsh-skills-source" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u67E5\u770B\u5F53\u524D\u76EE\u5F55\u6765\u6E90"), /* @__PURE__ */ import_react.default.createElement("pre", null, row.catalogSource), row.catalogSourceState === "missing" && /* @__PURE__ */ import_react.default.createElement("p", null, "\u6E90\u6587\u4EF6\u4E0D\u5B58\u5728"), row.catalogSourceState === "unknown" && /* @__PURE__ */ import_react.default.createElement("p", null, "\u6765\u6E90\u72B6\u6001\u672A\u77E5"), !!row.versions.length && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u6B64\u5904\u662F\u5F53\u524D\u76EE\u5F55\u63D0\u4F9B\u7684\u6765\u6E90\uFF0C\u52A0\u8F7D\u65F6\u7684\u6765\u6E90\u4EE5\u5404\u7248\u672C\u8BB0\u5F55\u4E3A\u51C6\u3002")), !version ? /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, row.state === "unknown" ? "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u6838\u5B9E\u52A0\u8F7D\u8BB0\u5F55\u3002" : "\u6CA1\u6709\u68C0\u6D4B\u5230\u6B63\u5F0F\u5165\u53E3\u6210\u529F\u52A0\u8F7D\u7684\u8BB0\u5F55\u3002") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-version" }, "\u6B63\u6587\u7248\u672C", /* @__PURE__ */ import_react.default.createElement("select", { value: version.id, onChange: (event) => setSelected(event.target.value) }, row.versions.map((item, index) => /* @__PURE__ */ import_react.default.createElement("option", { key: item.id, value: item.id }, index === 0 ? "\u6700\u8FD1\u52A0\u8F7D" : `\u7248\u672C ${row.versions.length - index}`, " \xB7 ", new Date(item.time).toLocaleString(), " \xB7 ", labels[item.state])))), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, version.entry === "user" ? "\u7528\u6237\u8C03\u7528" : "skill \u5DE5\u5177", " \xB7 \u52A0\u8F7D ", version.loadCount, " \u6B21 \xB7 ", labels[version.state]), /* @__PURE__ */ import_react.default.createElement("p", null, /* @__PURE__ */ import_react.default.createElement("strong", null, version.state === "loaded" ? "\u4E0A\u4E0B\u6587\u6B63\u6587" : "\u5386\u53F2\u6B63\u6587"), version.reason ? ` \xB7 ${version.reason}` : ""), version.state === "unknown" && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-notice" }, "\u65E0\u6CD5\u786E\u8BA4\u8FD9\u7248\u5B8C\u6574\u6B63\u6587\u662F\u5426\u4ECD\u5728\u5F53\u524D\u4E0A\u4E0B\u6587\u4E2D\u3002"), version.body === null ? /* @__PURE__ */ import_react.default.createElement("p", null, "\u65E0\u6CD5\u53D6\u5F97\u52A0\u8F7D\u65F6\u7684\u5B8C\u6574\u6B63\u6587\u3002") : /* @__PURE__ */ import_react.default.createElement("pre", { className: "dsh-skills-body" }, version.body), /* @__PURE__ */ import_react.default.createElement("details", { className: "dsh-skills-source" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u67E5\u770B\u52A0\u8F7D\u65F6\u7684\u6765\u6E90"), /* @__PURE__ */ import_react.default.createElement("pre", null, version.resource ?? "\u6765\u6E90\u72B6\u6001\u672A\u77E5\uFF1A\u5386\u53F2\u8BB0\u5F55\u672A\u4FDD\u7559\u53EF\u6838\u5B9E\u7684\u6765\u6E90\u3002"), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u8D44\u6E90\u6307\u5F15\u4E0D\u4E00\u5B9A\u5305\u542B\u6E90\u6587\u4EF6\u8DEF\u5F84\uFF1B\u672A\u53D6\u5F97\u786E\u5207\u8DEF\u5F84\u65F6\uFF0C\u65E0\u6CD5\u5224\u65AD\u6E90\u6587\u4EF6\u662F\u5426\u5B58\u5728\u3002"))));
}
var inject = ["slots", "connection", "sidebarRight", "sidebarRightTabs"];
function apply(ctx) {
  const stores = /* @__PURE__ */ new Map();
  const getStore = (sessionId) => {
    if (!stores.has(sessionId)) stores.set(sessionId, createStatusStore(ctx.connection.rpc.call.bind(ctx.connection.rpc), sessionId));
    return stores.get(sessionId);
  };
  function useStatus(sessionId) {
    const store = getStore(sessionId);
    return (0, import_react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
  }
  function Header({ sessionId }) {
    const state = useStatus(sessionId);
    const count = state.phase === "ready" ? `${state.data.loadedCount}${state.data.uncertain ? " \xB7 ?" : ""}` : state.phase === "pending" ? "\u2026" : "?";
    return /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "dsh-skills-trigger",
        onClick: () => ctx.sidebarRight.openTab(tabId),
        title: "\u67E5\u770B\u5F53\u524D\u4F1A\u8BDD\u6280\u80FD\u72B6\u6001",
        "aria-label": `\u67E5\u770B\u5F53\u524D\u4F1A\u8BDD\u6280\u80FD\u72B6\u6001\uFF1A${count}`
      },
      "\u6280\u80FD ",
      /* @__PURE__ */ import_react.default.createElement("span", { "aria-live": "polite" }, count)
    );
  }
  function Panel({ sessionId }) {
    return /* @__PURE__ */ import_react.default.createElement(SkillPanel, { key: sessionId, state: useStatus(sessionId) });
  }
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    document.head.append(style);
    return () => {
      style.remove();
      for (const store of stores.values()) store.dispose();
      stores.clear();
    };
  });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: tabId, kind: tabId, title: () => "\u6280\u80FD" }));
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: tabId, order: 20 }, Header));
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: tabId }, Panel));
}
var CSS_TEXT = `
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

return module.exports;
}});
