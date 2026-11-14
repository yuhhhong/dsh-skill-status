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
  TranslationBody: () => TranslationBody,
  TranslationSettings: () => TranslationSettings,
  apply: () => apply,
  createStatusStore: () => createStatusStore,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);

// src/translation-client.js
var prefix = "skill-status.translation.";
var initial = Object.freeze({ phase: "idle", parts: null, error: null });
function translationViewKey(sessionId, version, preferences, locale) {
  return JSON.stringify([sessionId, version.id, version.body, preferences?.provider, preferences?.targetLanguage, preferences?.targetLanguage === "auto" ? locale : preferences?.targetLanguage]);
}
function unwrap(response) {
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error?.message ?? "\u7FFB\u8BD1\u8BF7\u6C42\u5931\u8D25\u3002"), { code: response?.error?.code });
  }
  return response.value;
}
function readableError(error) {
  return { code: error?.code ?? "TRANSLATION_FAILED", message: error?.name === "TimeoutError" ? "\u7FFB\u8BD1\u8BF7\u6C42\u8D85\u65F6\u3002" : error?.message ?? "\u672C\u6B21\u7FFB\u8BD1\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u91CD\u8BD5\u3002" };
}
function createTranslationStore(call, { sessionId, body, locale }, timeoutMs = 45e3) {
  let value = initial;
  let controller;
  let running;
  let generation = 0;
  const listeners = /* @__PURE__ */ new Set();
  const publish = (next) => {
    value = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const patchPart = (index, update) => publish({ ...value, parts: value.parts.map((part, current) => current === index ? { ...part, ...update } : part) });
  async function run(signal, attempt) {
    const current = () => !signal.aborted && generation === attempt;
    const request = async (method, payload) => unwrap(await call("/api", prefix + method, payload, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])));
    publish({ ...value, phase: "preparing", error: null });
    try {
      const plan = await request("prepare", { sessionId, body, locale });
      if (!current()) {
        return;
      }
      const parts = plan.parts.map((part) => ({ ...part, status: part.status === "success" || !part.translatable ? part.status : "pending", error: void 0 }));
      publish({ phase: "running", parts, error: null });
      for (let index = 0; index < parts.length; index++) {
        if (!current()) {
          return;
        }
        if (!parts[index].translatable || parts[index].status === "success") {
          continue;
        }
        patchPart(index, { status: "translating", error: void 0 });
        try {
          const result = await request("chunk", { id: plan.id, index, locale });
          if (!current()) {
            return;
          }
          if (typeof result?.text !== "string" || !result.text.trim()) {
            throw new Error("\u7FFB\u8BD1\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u54CD\u5E94\u3002");
          }
          patchPart(index, { status: "success", text: result.text, error: void 0 });
        } catch (error) {
          if (!current()) {
            return;
          }
          patchPart(index, { status: "failed", error: readableError(error) });
          if (["TRANSLATOR_MISSING", "TRANSLATION_STALE"].includes(error?.code)) {
            publish({ ...value, error: readableError(error) });
            break;
          }
        }
      }
      if (current()) {
        publish({ ...value, phase: "settled" });
      }
    } catch (error) {
      if (current()) {
        publish({ ...value, phase: "settled", error: readableError(error) });
      }
    }
  }
  function cancel() {
    generation++;
    controller?.abort();
    running = void 0;
    if (value.phase === "preparing" || value.phase === "running") {
      publish({ ...value, phase: "settled", error: null, parts: value.parts?.map((part) => part.status === "translating" ? { ...part, status: "cancelled", error: void 0 } : part) ?? null });
    }
  }
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (running) {
        return running;
      }
      if (value.parts && value.parts.every((part) => !part.translatable || part.status === "success")) {
        return Promise.resolve();
      }
      controller = new AbortController();
      const attempt = ++generation;
      const task = run(controller.signal, attempt).finally(() => {
        if (generation === attempt) {
          running = void 0;
        }
      });
      running = task;
      return task;
    },
    cancel,
    dispose() {
      cancel();
      listeners.clear();
    }
  };
}
function createTranslationEnvironment(call) {
  let value = Object.freeze({ info: null, locale: null });
  let generation = 0;
  let controller;
  const listeners = /* @__PURE__ */ new Set();
  const publish = (next) => {
    value = next;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    call,
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocale(locale) {
      if (value.locale !== locale) {
        publish({ ...value, locale });
      }
    },
    setPreferences(preferences) {
      if (value.info && (value.info.preferences.provider !== preferences.provider || value.info.preferences.targetLanguage !== preferences.targetLanguage)) {
        generation++;
        controller?.abort();
        publish({ ...value, info: { ...value.info, preferences } });
      }
    },
    async refresh() {
      controller?.abort();
      controller = new AbortController();
      const attempt = ++generation;
      try {
        const info = unwrap(await call("/api", prefix + "info", {}, AbortSignal.any([controller.signal, AbortSignal.timeout(1e4)])));
        if (attempt === generation && !controller.signal.aborted) {
          publish({ ...value, info });
        }
      } catch {
      }
    },
    dispose() {
      generation++;
      controller?.abort();
      listeners.clear();
    }
  };
}

// src/client.jsx
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
function SkillPanel({ state, translation }) {
  const [filter, setFilter] = (0, import_react.useState)("");
  if (state.phase === "pending") return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills", role: "status" }, "\u6B63\u5728\u6838\u5B9E\u6280\u80FD\u72B6\u6001\u2026");
  if (state.phase === "error") return /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills", role: "status" }, "\u6682\u65F6\u65E0\u6CD5\u67E5\u8BE2\u6280\u80FD\u72B6\u6001\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u8BD5\u3002");
  const data = state.data;
  const rows = data.skills.filter((row) => `${row.name} ${row.description}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "dsh-skills", "aria-label": "\u5F53\u524D\u4F1A\u8BDD\u6280\u80FD\u72B6\u6001" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills-summary" }, /* @__PURE__ */ import_react.default.createElement("strong", null, "\u6280\u80FD"), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5DF2\u786E\u8BA4\u52A0\u8F7D ", data.loadedCount, " \u4E2A")), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u4EC5\u68C0\u67E5\u4E3B\u52A9\u624B\u901A\u8FC7\u6B63\u5F0F\u5165\u53E3\u52A0\u8F7D\u7684\u5B8C\u6574\u6280\u80FD\u6B63\u6587\u3002"), data.issues?.map((issue) => /* @__PURE__ */ import_react.default.createElement("p", { key: issue.code, className: "dsh-skills-notice", role: "status" }, issue.message)), data.note && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, data.note), /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-search" }, "\u7B5B\u9009\u6280\u80FD", /* @__PURE__ */ import_react.default.createElement("input", { value: filter, onChange: (event) => setFilter(event.target.value), placeholder: "\u8F93\u5165\u6280\u80FD\u540D\u79F0\u6216\u8BF4\u660E" })), !rows.length && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, filter ? "\u6CA1\u6709\u5339\u914D\u7684\u6280\u80FD\u3002" : data.uncertain ? "\u76EE\u524D\u6CA1\u6709\u53EF\u6838\u5B9E\u7684\u6280\u80FD\u6761\u76EE\u3002" : "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u6280\u80FD\u6216\u6B63\u5F0F\u52A0\u8F7D\u8BB0\u5F55\u3002"), /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills-list" }, rows.map((row) => /* @__PURE__ */ import_react.default.createElement(SkillRow, { key: row.name, row, sessionId: data.sessionId, translation }))));
}
function SkillRow({ row, sessionId, translation }) {
  const [selected, setSelected] = (0, import_react.useState)(null);
  const [expanded, setExpanded] = (0, import_react.useState)(false);
  const version = row.versions.find((item) => item.id === selected) ?? row.versions[0];
  const directoryLabel = row.directoryState === "absent" ? "\u672A\u5728\u5F53\u524D\u6280\u80FD\u76EE\u5F55\u4E2D" : null;
  return /* @__PURE__ */ import_react.default.createElement("details", { className: "dsh-skills-row", onToggle: (event) => {
    if (event.target === event.currentTarget) {
      setExpanded(event.currentTarget.open);
    }
  } }, /* @__PURE__ */ import_react.default.createElement("summary", null, /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-skills-name" }, row.name), /* @__PURE__ */ import_react.default.createElement("span", { className: `dsh-skills-state dsh-skills-${row.state}` }, labels[row.state]), row.directoryState === "unknown" && /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-skills-state dsh-skills-unknown" }, " \xB7 \u76EE\u5F55\u5F85\u786E\u8BA4"), !!row.issues?.length && /* @__PURE__ */ import_react.default.createElement("span", { className: "dsh-skills-row-issues" }, row.issues.map((issue) => /* @__PURE__ */ import_react.default.createElement("span", { key: issue.code, className: "dsh-skills-notice" }, issue.message)))), directoryLabel && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, directoryLabel), row.description && /* @__PURE__ */ import_react.default.createElement("p", null, row.description), row.catalogSource && /* @__PURE__ */ import_react.default.createElement("details", { className: "dsh-skills-source" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u67E5\u770B\u5F53\u524D\u76EE\u5F55\u6765\u6E90"), /* @__PURE__ */ import_react.default.createElement("pre", null, row.catalogSource), row.catalogSourceState === "missing" && /* @__PURE__ */ import_react.default.createElement("p", null, "\u6E90\u6587\u4EF6\u4E0D\u5B58\u5728"), row.catalogSourceState === "unknown" && /* @__PURE__ */ import_react.default.createElement("p", null, "\u6765\u6E90\u72B6\u6001\u672A\u77E5"), !!row.versions.length && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u6B64\u5904\u662F\u5F53\u524D\u76EE\u5F55\u63D0\u4F9B\u7684\u6765\u6E90\uFF0C\u52A0\u8F7D\u65F6\u7684\u6765\u6E90\u4EE5\u5404\u7248\u672C\u8BB0\u5F55\u4E3A\u51C6\u3002")), !version ? /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, row.state === "unknown" ? "\u73B0\u6709\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u6838\u5B9E\u52A0\u8F7D\u8BB0\u5F55\u3002" : "\u6CA1\u6709\u68C0\u6D4B\u5230\u6B63\u5F0F\u5165\u53E3\u6210\u529F\u52A0\u8F7D\u7684\u8BB0\u5F55\u3002") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-version" }, "\u6B63\u6587\u7248\u672C", /* @__PURE__ */ import_react.default.createElement("select", { value: version.id, onChange: (event) => setSelected(event.target.value) }, row.versions.map((item, index) => /* @__PURE__ */ import_react.default.createElement("option", { key: item.id, value: item.id }, index === 0 ? "\u6700\u8FD1\u52A0\u8F7D" : `\u7248\u672C ${row.versions.length - index}`, " \xB7 ", new Date(item.time).toLocaleString(), " \xB7 ", labels[item.state])))), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, version.entry === "user" ? "\u7528\u6237\u8C03\u7528" : "skill \u5DE5\u5177", " \xB7 \u52A0\u8F7D ", version.loadCount, " \u6B21 \xB7 ", labels[version.state]), /* @__PURE__ */ import_react.default.createElement(SkillBody, { key: translationViewKey(sessionId, version, translation?.info?.preferences, translation?.locale), version, sessionId, translation, expanded }), /* @__PURE__ */ import_react.default.createElement("details", { className: "dsh-skills-source" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u67E5\u770B\u52A0\u8F7D\u65F6\u7684\u6765\u6E90"), /* @__PURE__ */ import_react.default.createElement("pre", null, version.resource ?? "\u6765\u6E90\u72B6\u6001\u672A\u77E5\uFF1A\u5386\u53F2\u8BB0\u5F55\u672A\u4FDD\u7559\u53EF\u6838\u5B9E\u7684\u6765\u6E90\u3002"), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u8D44\u6E90\u6307\u5F15\u4E0D\u4E00\u5B9A\u5305\u542B\u6E90\u6587\u4EF6\u8DEF\u5F84\uFF1B\u672A\u53D6\u5F97\u786E\u5207\u8DEF\u5F84\u65F6\uFF0C\u65E0\u6CD5\u5224\u65AD\u6E90\u6587\u4EF6\u662F\u5426\u5B58\u5728\u3002"))));
}
function SkillBody({ version, sessionId, translation, expanded }) {
  const heading = /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("strong", null, version.state === "loaded" ? "\u4E0A\u4E0B\u6587\u6B63\u6587" : "\u5386\u53F2\u6B63\u6587"), version.state !== "unknown" && version.reason ? ` \xB7 ${version.reason}` : "");
  const warning = version.state === "unknown" ? /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-notice" }, version.reason ?? "\u65E0\u6CD5\u786E\u8BA4\u8FD9\u7248\u5B8C\u6574\u6B63\u6587\u662F\u5426\u4ECD\u5728\u5F53\u524D\u4E0A\u4E0B\u6587\u4E2D\u3002") : null;
  if (translation?.info?.supported && translation.locale && typeof version.body === "string" && version.body.length > 0) {
    return /* @__PURE__ */ import_react.default.createElement(TranslationBody, { heading, warning, body: version.body, sessionId, translation, expanded: expanded && translation.visible !== false });
  }
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("p", null, heading), warning, version.body === null ? /* @__PURE__ */ import_react.default.createElement("p", null, "\u65E0\u6CD5\u53D6\u5F97\u52A0\u8F7D\u65F6\u7684\u5B8C\u6574\u6B63\u6587\u3002") : /* @__PURE__ */ import_react.default.createElement("pre", { className: "dsh-skills-body" }, version.body));
}
function TranslationBody({ heading, warning, body, sessionId, translation, expanded }) {
  const targetLanguage = translation.info.preferences.targetLanguage === "auto" ? translation.locale : translation.info.preferences.targetLanguage;
  const store = (0, import_react.useMemo)(() => createTranslationStore(translation.call, { sessionId, body, locale: targetLanguage }), [translation.call, sessionId, body, targetLanguage]);
  const state = (0, import_react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [translated, setTranslated] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => () => store.dispose(), [store]);
  (0, import_react.useEffect)(() => {
    if (!expanded) {
      store.cancel();
    }
  }, [expanded, store]);
  const parts = state.parts;
  const total = parts?.filter((part) => part.translatable).length ?? 0;
  const completed = parts?.filter((part) => part.translatable && part.status === "success").length ?? 0;
  const busy = state.phase === "preparing" || state.phase === "running";
  const complete = parts !== null && completed === total;
  const start = () => {
    setTranslated(true);
    void store.start();
  };
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills-body-heading" }, /* @__PURE__ */ import_react.default.createElement("p", null, heading), /* @__PURE__ */ import_react.default.createElement("div", { className: "dsh-skills-translation-actions" }, (!parts || busy) && /* @__PURE__ */ import_react.default.createElement("button", { type: "button", disabled: !expanded || busy, onClick: start }, busy ? "\u6B63\u5728\u673A\u7FFB\u2026" : "\u673A\u7FFB"), parts && /* @__PURE__ */ import_react.default.createElement("button", { type: "button", onClick: () => setTranslated((current) => !current) }, translated ? "\u67E5\u770B\u539F\u6587" : "\u67E5\u770B\u8BD1\u6587"), busy && /* @__PURE__ */ import_react.default.createElement("button", { type: "button", onClick: () => store.cancel() }, "\u53D6\u6D88"))), warning, state.error && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-notice", role: "status" }, state.error.message), parts && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted", "aria-live": "polite" }, "\u5DF2\u5B8C\u6210 ", completed, "/", total, " \u5757", complete ? " \xB7 \u7FFB\u8BD1\u5B8C\u6210" : busy ? " \xB7 \u6B63\u5728\u7FFB\u8BD1" : " \xB7 \u90E8\u5206\u6B63\u6587\u5C1A\u672A\u7FFB\u8BD1", translated ? " \xB7 \u673A\u7FFB\uFF0C\u4EC5\u4F9B\u9605\u8BFB" : ""), !translated || !parts ? /* @__PURE__ */ import_react.default.createElement("pre", { className: "dsh-skills-body" }, body) : /* @__PURE__ */ import_react.default.createElement("pre", { className: "dsh-skills-body" }, parts.map((part, index) => /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, { key: index }, part.translatable && part.status !== "success" && /* @__PURE__ */ import_react.default.createElement("span", { className: `dsh-skills-translation-status${part.status === "failed" ? " dsh-skills-notice" : ""}` }, part.status === "translating" ? "\u3010\u6B63\u5728\u7FFB\u8BD1\uFF0C\u6682\u663E\u793A\u539F\u6587\u3011" : part.status === "failed" ? `\u3010\u7FFB\u8BD1\u5931\u8D25\uFF1A${part.error?.message ?? "\u8BF7\u624B\u52A8\u91CD\u8BD5"}\uFF0C\u6682\u663E\u793A\u539F\u6587\u3011` : part.status === "cancelled" ? "\u3010\u5DF2\u53D6\u6D88\uFF0C\u6682\u663E\u793A\u539F\u6587\u3011" : "\u3010\u5C1A\u672A\u7FFB\u8BD1\uFF0C\u6682\u663E\u793A\u539F\u6587\u3011"), part.status === "success" ? part.text : part.original))), parts && !complete && !busy && /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "dsh-skills-retry", onClick: start }, "\u91CD\u8BD5\u672A\u5B8C\u6210\u5757"));
}
function TranslationSettings({ scope, view }) {
  const source = (0, import_react.useMemo)(() => ({ subscribe: scope.subscribe.bind(scope), getSnapshot: scope.getSnapshot.bind(scope) }), [scope]);
  const snapshot = (0, import_react.useSyncExternalStore)(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [provider, setProvider] = (0, import_react.useState)(snapshot.value?.provider ?? "bing");
  const [targetLanguage, setTargetLanguage] = (0, import_react.useState)(snapshot.value?.targetLanguage ?? "auto");
  const [customLanguage, setCustomLanguage] = (0, import_react.useState)(snapshot.value?.targetLanguage === "auto" ? "" : snapshot.value?.targetLanguage ?? "");
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    if (snapshot.status === "ready") {
      setProvider(snapshot.value.provider);
      setTargetLanguage(snapshot.value.targetLanguage);
      setCustomLanguage(snapshot.value.targetLanguage === "auto" ? "" : snapshot.value.targetLanguage);
    }
  }, [snapshot.revision, snapshot.status]);
  if (view === "summary") {
    return snapshot.status === "ready" ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, snapshot.value.provider === "google" ? "Google" : "Bing", " \xB7 ", snapshot.value.targetLanguage === "auto" ? "\u8DDF\u968F\u754C\u9762\u8BED\u8A00" : snapshot.value.targetLanguage) : null;
  }
  const actualLanguage = targetLanguage === "auto" ? "auto" : customLanguage.trim();
  const changed = provider !== snapshot.value?.provider || actualLanguage !== snapshot.value?.targetLanguage;
  const valid = targetLanguage === "auto" || actualLanguage !== "auto" && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(actualLanguage);
  async function save(event) {
    event.preventDefault();
    if (!valid || !changed || saving || !snapshot.writable) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const accepted = await scope.mutate([{ op: "set", path: ["provider"], value: provider }, { op: "set", path: ["targetLanguage"], value: actualLanguage }], snapshot.revision);
      setMessage(accepted ? "\u7FFB\u8BD1\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002" : "\u8BBE\u7F6E\u672A\u88AB\u63A5\u53D7\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u5F53\u524D\u8BBE\u7F6E\u540E\u4FDD\u5B58\u3002");
    } catch {
      setMessage("\u7FFB\u8BD1\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      setSaving(false);
    }
  }
  return /* @__PURE__ */ import_react.default.createElement("form", { className: "dsh-skills dsh-skills-settings", onSubmit: save }, /* @__PURE__ */ import_react.default.createElement("h3", null, "\u6280\u80FD\u6B63\u6587\u673A\u7FFB"), /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted" }, "\u4EC5\u7FFB\u8BD1\u5F53\u524D\u67E5\u770B\u7684\u6B63\u6587\uFF0C\u8BD1\u6587\u4EC5\u4F9B\u9605\u8BFB\u3002\u4E24\u9879\u8BBE\u7F6E\u4FDD\u5B58\u540E\u4E00\u8D77\u751F\u6548\u3002"), snapshot.status !== "ready" ? /* @__PURE__ */ import_react.default.createElement("p", { role: "status" }, snapshot.status === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u7FFB\u8BD1\u8BBE\u7F6E\u2026" : "\u5F53\u524D\u65E0\u6CD5\u8BFB\u53D6\u7FFB\u8BD1\u8BBE\u7F6E\u3002") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-version" }, "\u7FFB\u8BD1\u670D\u52A1", /* @__PURE__ */ import_react.default.createElement("select", { value: provider, disabled: saving || !snapshot.writable, onChange: (event) => setProvider(event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "bing" }, "Bing"), /* @__PURE__ */ import_react.default.createElement("option", { value: "google" }, "Google"))), /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-version" }, "\u76EE\u6807\u8BED\u8A00", /* @__PURE__ */ import_react.default.createElement("select", { value: targetLanguage === "auto" ? "auto" : "custom", disabled: saving || !snapshot.writable, onChange: (event) => setTargetLanguage(event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "auto" }, "\u8DDF\u968F\u754C\u9762\u8BED\u8A00"), /* @__PURE__ */ import_react.default.createElement("option", { value: "custom" }, "\u6307\u5B9A\u8BED\u8A00\u4EE3\u7801"))), targetLanguage !== "auto" && /* @__PURE__ */ import_react.default.createElement("label", { className: "dsh-skills-version" }, "\u8BED\u8A00\u4EE3\u7801", /* @__PURE__ */ import_react.default.createElement("input", { value: customLanguage, disabled: saving || !snapshot.writable, onChange: (event) => setCustomLanguage(event.target.value), placeholder: "\u4F8B\u5982 zh-CN\u3001en\u3001ja" })), !valid && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-notice" }, "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u76EE\u6807\u8BED\u8A00\u4EE3\u7801\uFF0C\u4F8B\u5982 zh-CN \u6216 en\u3002"), !snapshot.writable && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-notice" }, "\u5F53\u524D\u914D\u7F6E\u4E0D\u80FD\u4FDD\u5B58\u3002"), /* @__PURE__ */ import_react.default.createElement("button", { type: "submit", disabled: !valid || !changed || saving || !snapshot.writable }, saving ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58")), message && /* @__PURE__ */ import_react.default.createElement("p", { className: "dsh-skills-muted", role: "status" }, message));
}
var inject = ["slots", "connection", "sidebarRight", "sidebarRightTabs"];
function apply(ctx) {
  const stores = /* @__PURE__ */ new Map();
  const translation = createTranslationEnvironment(ctx.connection.rpc.call.bind(ctx.connection.rpc));
  ctx.inject?.(["locale"], (child) => {
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
      child.inject(["configForms"], (scoped) => {
        const scope = scoped.configForms.get(tabId);
        const updatePreferences = () => {
          const snapshot = scope.getSnapshot();
          if (snapshot.status === "ready") {
            translation.setPreferences(snapshot.value);
          }
        };
        updatePreferences();
        scoped.effect(() => scope.subscribe(updatePreferences));
        scoped.slots.inject("plugins.bundle.config", () => scoped.slots.register({ name: "plugins.bundle.config", key: tabId }, (props) => /* @__PURE__ */ import_react.default.createElement(TranslationSettings, { scope, view: props.view })));
      });
    };
    child.effect(() => translation.subscribe(mount));
    void translation.refresh().then(mount);
  });
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
  function Panel({ sessionId, visible = true }) {
    const translationState = (0, import_react.useSyncExternalStore)(translation.subscribe, translation.getSnapshot, translation.getSnapshot);
    (0, import_react.useEffect)(() => {
      void translation.refresh();
    }, []);
    return /* @__PURE__ */ import_react.default.createElement(SkillPanel, { key: sessionId, state: useStatus(sessionId), translation: { ...translationState, call: translation.call, visible } });
  }
  function VisiblePanel({ useTabInfo, ...props }) {
    const info = useTabInfo();
    return /* @__PURE__ */ import_react.default.createElement(Panel, { ...props, visible: info.tab.visible });
  }
  ctx.effect(() => {
    const style = document.createElement("style");
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
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: tabId, kind: tabId, title: () => "\u6280\u80FD" }));
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: tabId, order: 20 }, Header));
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: tabId }, (props) => props.useTabInfo ? /* @__PURE__ */ import_react.default.createElement(VisiblePanel, { ...props }) : /* @__PURE__ */ import_react.default.createElement(Panel, { ...props })));
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

return module.exports;
}});
