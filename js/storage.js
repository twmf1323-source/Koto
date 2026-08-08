/**
 * 規則／待辦／設定／專案持久化（localStorage + 種子）
 * 鍵名 jgn_*（Japanese Grammar Notebook）
 */
const Storage = (() => {
  const RULES_KEY = "jgn_rules_v1";
  const TODOS_KEY = "jgn_todos_v1";
  const META_KEY = "jgn_meta_v1";
  const SETTINGS_KEY = "jgn_settings_v1";
  const HISTORY_KEY = "jgn_history_v1";
  const HISTORY_MAX = 40;
  const LOOKUP_MODE_KEY = "jgn_lookup_mode";
  const PROJECTS_KEY = "jgn_projects_v1";
  const ACTIVE_PROJECT_KEY = "jgn_active_project_v1";

  /** 三格／分析 UI 配色（與 CSS data-structure-theme 對應） */
  const STRUCTURE_THEMES = [
    { id: "sakura", label: "櫻粉", desc: "預設 · 柔和輕盈" },
    { id: "indigo", label: "靛紫", desc: "沉穩 · 對比" },
    { id: "teal", label: "青瓷", desc: "冷靜 · 學習感" },
    { id: "matcha", label: "抹茶", desc: "自然 · 清爽" },
    { id: "sunset", label: "暮霞", desc: "暖調 · 溫和" },
    { id: "slate", label: "水墨", desc: "低彩 · 專注" },
    { id: "ocean", label: "海灣", desc: "深藍 · 清澈" },
    { id: "honey", label: "蜂蜜", desc: "金杏 · 溫潤" },
    { id: "grape", label: "葡萄", desc: "紫紅 · 沉靜" },
    { id: "frost", label: "霜藍", desc: "冷調 · 乾淨" },
  ];

  const DEFAULT_LOOKUP_MODES = {
    apiGrammar: true,
    localGrammar: false,
    apiVocab: true,
  };

  const DEFAULT_SETTINGS = {
    apiKey: "",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.5",
    structureTheme: "sakura",
    lookupModes: { ...DEFAULT_LOOKUP_MODES },
  };

  function normalizeStructureTheme(id) {
    const ok = STRUCTURE_THEMES.some((t) => t.id === id);
    return ok ? id : DEFAULT_SETTINGS.structureTheme;
  }

  function newId(prefix) {
    return (
      (crypto.randomUUID && crypto.randomUUID()) ||
      prefix + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)
    );
  }

  function normalizeQueryKey(q) {
    return String(q || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function loadRules() {
    try {
      const raw = localStorage.getItem(RULES_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveRules(rules) {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
    setMeta({ lastSaved: new Date().toISOString() });
  }

  function loadTodos() {
    try {
      const raw = localStorage.getItem(TODOS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveTodos(todos) {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
  }

  function getMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setMeta(partial) {
    const next = { ...getMeta(), ...partial };
    localStorage.setItem(META_KEY, JSON.stringify(next));
    return next;
  }

  async function initWithSeed() {
    let rules = loadRules();
    if (rules && rules.length > 0) return rules;
    try {
      const res = await fetch("data/seed-rules.json");
      if (!res.ok) throw new Error("seed fetch failed");
      rules = await res.json();
    } catch {
      rules = [];
    }
    saveRules(rules);
    setMeta({ seeded: true, seededAt: new Date().toISOString() });
    return rules;
  }

  function exportRulesJSON(rules) {
    return JSON.stringify(rules, null, 2);
  }

  /**
   * 資料管理：規則 + 專案一併匯出
   * 相容舊版純規則陣列匯入；新檔為 { type, rules, projects }
   */
  function exportDataJSON(rules) {
    const list = Array.isArray(rules) ? rules : loadRules() || [];
    return JSON.stringify(
      {
        type: "koto-japanese-grammar-backup",
        version: 2,
        exportedAt: new Date().toISOString(),
        rules: list,
        projects: listProjects(),
      },
      null,
      2
    );
  }

  function importRulesArray(incoming, mode = "merge") {
    if (!Array.isArray(incoming)) throw new Error("規則必須是陣列");
    const current = loadRules() || [];
    if (mode === "replace") {
      saveRules(incoming);
      return incoming;
    }
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const r of incoming) {
      if (r && r.id) byId.set(r.id, r);
    }
    const merged = Array.from(byId.values());
    saveRules(merged);
    return merged;
  }

  function importRulesJSON(text, mode = "merge") {
    const incoming = JSON.parse(text);
    if (incoming && typeof incoming === "object" && !Array.isArray(incoming) && Array.isArray(incoming.rules)) {
      return importRulesArray(incoming.rules, mode);
    }
    if (!Array.isArray(incoming)) throw new Error("匯入格式必須是規則陣列 JSON，或含 rules 的備份檔");
    return importRulesArray(incoming, mode);
  }

  /**
   * 統一匯入：規則陣列、備份檔（rules+projects）、或舊版專案檔
   * @returns {{ rules: object[], projects?: { added, updated, total }, kind: string }}
   */
  function importDataJSON(text, mode = "merge") {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      const rules = importRulesArray(data, mode);
      return { rules, kind: "rules-only" };
    }
    if (!data || typeof data !== "object") {
      throw new Error("無法辨識的 JSON 格式");
    }
    if (Array.isArray(data.rules)) {
      const rules = importRulesArray(data.rules, mode);
      let projectsResult = null;
      if (Array.isArray(data.projects) && data.projects.length) {
        projectsResult = importProjectsList(data.projects, mode);
      }
      return {
        rules,
        projects: projectsResult,
        kind: projectsResult ? "backup" : "rules-bundle",
      };
    }
    if (
      data.type === "koto-japanese-grammar-projects" ||
      data.type === "mal-korean-grammar-projects" ||
      Array.isArray(data.projects) ||
      (data.id && (data.entries || data.name))
    ) {
      const projectsResult = importProjectsJSON(JSON.stringify(data));
      return {
        rules: loadRules() || [],
        projects: {
          added: projectsResult.added,
          updated: projectsResult.updated,
          total: projectsResult.projects.length,
        },
        kind: "projects-only",
      };
    }
    throw new Error("匯入格式需為規則陣列，或 { rules, projects } 備份檔");
  }

  function resetToSeed() {
    localStorage.removeItem(RULES_KEY);
    localStorage.removeItem(TODOS_KEY);
    setMeta({ resetAt: new Date().toISOString() });
  }

  /**
   * 查詢模式：API 文法 / 本地文法（互斥）· API 單字（可獨立）
   * 相容舊版 LOOKUP_MODE_KEY（api | local）
   */
  function normalizeLookupModes(input, opts = {}) {
    const src = input && typeof input === "object" ? input : null;
    let apiGrammar;
    let localGrammar;
    let apiVocab;
    if (src && ("apiGrammar" in src || "localGrammar" in src || "apiVocab" in src)) {
      apiGrammar = Boolean(src.apiGrammar);
      localGrammar = Boolean(src.localGrammar);
      apiVocab = Boolean(src.apiVocab);
    } else {
      let legacy = "api";
      try {
        const m = localStorage.getItem(LOOKUP_MODE_KEY);
        if (m === "local") legacy = "local";
      } catch {
        /* ignore */
      }
      if (legacy === "local") {
        apiGrammar = false;
        localGrammar = true;
        apiVocab = false;
      } else {
        apiGrammar = true;
        localGrammar = false;
        apiVocab = true;
      }
    }
    // 互斥：API 文法 ↔ 本地文法
    if (opts.preferLocal) {
      if (localGrammar) apiGrammar = false;
    } else if (opts.preferApiGrammar) {
      if (apiGrammar) localGrammar = false;
    } else if (apiGrammar && localGrammar) {
      localGrammar = false;
    }
    return { apiGrammar, localGrammar, apiVocab };
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return {
          ...DEFAULT_SETTINGS,
          lookupModes: { ...DEFAULT_LOOKUP_MODES },
        };
      }
      const parsed = JSON.parse(raw);
      const base = {
        ...DEFAULT_SETTINGS,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : "",
        baseUrl:
          (typeof parsed?.baseUrl === "string" && parsed.baseUrl.trim()) ||
          DEFAULT_SETTINGS.baseUrl,
        model:
          (typeof parsed?.model === "string" && parsed.model.trim()) ||
          DEFAULT_SETTINGS.model,
        structureTheme: normalizeStructureTheme(parsed?.structureTheme),
      };
      base.lookupModes = normalizeLookupModes(
        parsed && typeof parsed === "object" ? parsed.lookupModes : null
      );
      return base;
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        lookupModes: { ...DEFAULT_LOOKUP_MODES },
      };
    }
  }

  function saveSettings(partial) {
    const next = { ...loadSettings(), ...partial };
    next.apiKey = String(next.apiKey || "").trim();
    next.baseUrl = String(next.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
    next.model = String(next.model || DEFAULT_SETTINGS.model).trim();
    next.structureTheme = normalizeStructureTheme(next.structureTheme);
    if (partial && Object.prototype.hasOwnProperty.call(partial, "lookupModes")) {
      next.lookupModes = normalizeLookupModes(partial.lookupModes);
    } else {
      next.lookupModes = normalizeLookupModes(next.lookupModes);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  function clearApiKey() {
    return saveSettings({ apiKey: "" });
  }

  function hasApiKey() {
    return Boolean(loadSettings().apiKey);
  }

  /** @deprecated 相容舊碼：api | local（以文法排查為準） */
  function loadLookupMode() {
    const m = loadLookupModes();
    return m.localGrammar && !m.apiGrammar ? "local" : "api";
  }

  function saveLookupMode(mode) {
    if (mode === "local") {
      return saveLookupModes({ apiGrammar: false, localGrammar: true });
    }
    return saveLookupModes({ apiGrammar: true, localGrammar: false, apiVocab: true });
  }

  function loadLookupModes() {
    return normalizeLookupModes(loadSettings().lookupModes);
  }

  /**
   * @param {Partial<{apiGrammar:boolean,localGrammar:boolean,apiVocab:boolean}>} partial
   */
  function saveLookupModes(partial) {
    const cur = loadLookupModes();
    const p = partial && typeof partial === "object" ? partial : {};
    const merged = { ...cur, ...p };
    const opts = {};
    if (p.localGrammar === true) opts.preferLocal = true;
    else if (p.apiGrammar === true) opts.preferApiGrammar = true;
    const next = normalizeLookupModes(merged, opts);
    saveSettings({ lookupModes: next });
    try {
      if (next.apiGrammar) localStorage.setItem(LOOKUP_MODE_KEY, "api");
      else if (next.localGrammar) localStorage.setItem(LOOKUP_MODE_KEY, "local");
    } catch {
      /* ignore */
    }
    return next;
  }

  /** 查詢是否會呼叫 API（文法或單字） */
  function isApiLookupEnabled() {
    const m = loadLookupModes();
    return Boolean(m.apiGrammar || m.apiVocab);
  }

  function formatLookupModesLabel(modes) {
    const m = modes || loadLookupModes();
    const parts = [];
    if (m.apiGrammar) parts.push("API 文法");
    if (m.localGrammar) parts.push("本地文法");
    if (m.apiVocab) parts.push("API 單字");
    return parts.length ? parts.join(" · ") : "未啟用";
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  /** 精簡盤點項目供歷史／專案快照（保留本句手動校正欄位） */
  function slimInventoryItems(items) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 80)
      .map((it) => {
        const row = {
          name: String(it?.name || "").trim(),
          nameJa: String(it?.nameJa || it?.nameKo || "").trim(),
          nameZh: String(it?.nameZh || "").trim(),
          category: String(it?.category || "").trim(),
          span: String(it?.span || "").trim(),
          note: String(it?.note || "").trim(),
          confidence: String(it?.confidence || "medium").trim(),
        };
        if (it?.source) row.source = String(it.source).trim();
        if (it?.manualRuleId) row.manualRuleId = String(it.manualRuleId).trim();
        if (it?.locatedManually) row.locatedManually = true;
        const start = Number(it?.start);
        const end = Number(it?.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          row.start = start;
          row.end = end;
        }
        return row;
      })
      .filter((it) => it.name);
  }

  /** 詞彙快照（hover 用：讀音／原形／外來語原文／意思） */
  function slimVocabItems(vocab) {
    return (Array.isArray(vocab) ? vocab : [])
      .slice(0, 80)
      .map((w) => {
        const row = {
          surface: String(w?.surface || "").trim(),
          reading: String(w?.reading || w?.yomi || w?.kana || "").trim(),
          lemma: String(w?.lemma || "").trim(),
          gloss: String(w?.gloss || "").trim(),
          pos: String(w?.pos || "").trim(),
          start: Number.isFinite(w?.start) ? w.start : w?.start == null ? null : Number(w.start),
          end: Number.isFinite(w?.end) ? w.end : w?.end == null ? null : Number(w.end),
        };
        const origin = String(w?.origin || "").trim();
        if (origin) row.origin = origin;
        return row;
      })
      .filter((w) => w.surface || w.lemma);
  }

  /**
   * @param {{ query: string, summary?: string, translation?: string, ownedCount?: number, missingCount?: number, items?: object[], vocab?: object[] }} entry
   */
  function addHistoryEntry(entry) {
    const q = String(entry?.query || "").trim();
    if (!q) return loadHistory();
    const norm = q.replace(/\s+/g, " ");
    let list = loadHistory().filter((h) => String(h.query || "").replace(/\s+/g, " ") !== norm);
    const item = {
      id: newId("h_"),
      query: q,
      at: new Date().toISOString(),
      summary: String(entry.summary || "").trim(),
      translation: String(entry.translation || "").trim(),
      ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
      missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
      items: slimInventoryItems(entry.items),
      vocab: slimVocabItems(entry.vocab),
    };
    list.unshift(item);
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveHistory(list);
    return list;
  }

  function removeHistoryEntry(id) {
    const list = loadHistory().filter((h) => h.id !== id);
    saveHistory(list);
    return list;
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }

  /* —— 專案（有序、永久保存；不與一般歷史混用） —— */

  function loadProjectsStore() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return { projects: [] };
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed?.projects)
        ? parsed.projects
        : Array.isArray(parsed)
          ? parsed
          : [];
      return {
        projects: projects
          .filter((p) => p && p.id)
          .map((p) => ({
            id: String(p.id),
            name: String(p.name || "未命名專案").trim() || "未命名專案",
            createdAt: p.createdAt || new Date().toISOString(),
            updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
            entries: Array.isArray(p.entries)
              ? p.entries
                  .filter((e) => e && e.query)
                  .map((e, i) => ({
                    id: String(e.id || newId("pe_")),
                    seq: Number.isFinite(Number(e.seq)) ? Number(e.seq) : i + 1,
                    query: String(e.query || "").trim(),
                    at: e.at || new Date().toISOString(),
                    summary: String(e.summary || "").trim(),
                    translation: String(e.translation || "").trim(),
                    ownedCount: Number.isFinite(e.ownedCount) ? e.ownedCount : null,
                    missingCount: Number.isFinite(e.missingCount) ? e.missingCount : null,
                    items: slimInventoryItems(e.items),
                    vocab: slimVocabItems(e.vocab),
                  }))
              : [],
          })),
      };
    } catch {
      return { projects: [] };
    }
  }

  function saveProjectsStore(store) {
    const projects = Array.isArray(store?.projects) ? store.projects : [];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify({ projects }));
    return { projects };
  }

  function listProjects() {
    const { projects } = loadProjectsStore();
    return projects
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function getProject(id) {
    if (!id) return null;
    return loadProjectsStore().projects.find((p) => p.id === id) || null;
  }

  function createProject(name) {
    const n = String(name || "").trim() || "未命名專案";
    const store = loadProjectsStore();
    const now = new Date().toISOString();
    const project = {
      id: newId("proj_"),
      name: n,
      createdAt: now,
      updatedAt: now,
      entries: [],
    };
    store.projects.push(project);
    saveProjectsStore(store);
    return project;
  }

  function deleteProject(id) {
    const store = loadProjectsStore();
    store.projects = store.projects.filter((p) => p.id !== id);
    saveProjectsStore(store);
    if (getActiveProjectId() === id) setActiveProjectId(null);
    return store.projects;
  }

  function renameProject(id, name) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === id);
    if (!p) return null;
    const n = String(name || "").trim();
    if (!n) return p;
    p.name = n;
    p.updatedAt = new Date().toISOString();
    saveProjectsStore(store);
    return p;
  }

  function getActiveProjectId() {
    try {
      const id = localStorage.getItem(ACTIVE_PROJECT_KEY);
      if (!id) return null;
      return getProject(id) ? id : null;
    } catch {
      return null;
    }
  }

  function setActiveProjectId(id) {
    if (!id) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      return null;
    }
    if (!getProject(id)) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      return null;
    }
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    return id;
  }

  function getActiveProject() {
    return getProject(getActiveProjectId());
  }

  /** 專案內句子依序號排序（序號永久固定，刪除後可有空缺） */
  function getProjectEntriesSorted(projectOrId) {
    const p = typeof projectOrId === "string" ? getProject(projectOrId) : projectOrId;
    if (!p) return [];
    return (p.entries || [])
      .slice()
      .sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.at || "").localeCompare(String(b.at || "")));
  }

  /**
   * 查詢成功後寫入專案：
   * - 同句已存在 → 更新快照，序號不變
   * - 新句 → append，序號 = max(seq)+1
   * 不寫入一般歷史。
   */
  function upsertProjectEntry(projectId, entry) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const q = String(entry?.query || "").trim();
    if (!q) return p;
    const norm = normalizeQueryKey(q);
    const now = new Date().toISOString();
    const existing = (p.entries || []).find((e) => normalizeQueryKey(e.query) === norm);
    if (existing) {
      existing.query = q;
      existing.at = now;
      existing.summary = String(entry.summary || "").trim();
      existing.translation = String(entry.translation || "").trim();
      existing.ownedCount = Number.isFinite(entry.ownedCount) ? entry.ownedCount : null;
      existing.missingCount = Number.isFinite(entry.missingCount) ? entry.missingCount : null;
      existing.items = slimInventoryItems(entry.items);
      existing.vocab = slimVocabItems(entry.vocab);
    } else {
      const maxSeq = (p.entries || []).reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);
      p.entries = p.entries || [];
      p.entries.push({
        id: newId("pe_"),
        seq: maxSeq + 1,
        query: q,
        at: now,
        summary: String(entry.summary || "").trim(),
        translation: String(entry.translation || "").trim(),
        ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
        missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
        items: slimInventoryItems(entry.items),
        vocab: slimVocabItems(entry.vocab),
      });
    }
    p.updatedAt = now;
    saveProjectsStore(store);
    return getProject(projectId);
  }

  function removeProjectEntry(projectId, entryId) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    p.entries = (p.entries || []).filter((e) => e.id !== entryId);
    p.updatedAt = new Date().toISOString();
    saveProjectsStore(store);
    return getProject(projectId);
  }

  function findProjectEntryByQuery(projectId, query) {
    const p = getProject(projectId);
    if (!p) return null;
    const norm = normalizeQueryKey(query);
    return (p.entries || []).find((e) => normalizeQueryKey(e.query) === norm) || null;
  }

  function findProjectEntryBySeq(projectId, seq) {
    const p = getProject(projectId);
    if (!p) return null;
    const n = Number(seq);
    return (p.entries || []).find((e) => Number(e.seq) === n) || null;
  }

  function exportProjectsJSON(projectIds) {
    const all = listProjects();
    const set = projectIds && projectIds.length ? new Set(projectIds) : null;
    const projects = set ? all.filter((p) => set.has(p.id)) : all;
    return JSON.stringify(
      {
        type: "koto-japanese-grammar-projects",
        version: 1,
        exportedAt: new Date().toISOString(),
        projects,
      },
      null,
      2
    );
  }

  function importProjectsList(incoming, mode = "merge") {
    const list = Array.isArray(incoming) ? incoming : [];
    const store = loadProjectsStore();
    let byId = new Map(store.projects.map((p) => [p.id, p]));
    if (mode === "replace") byId = new Map();
    let added = 0;
    let updated = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || newId("proj_"));
      const entries = Array.isArray(raw.entries)
        ? raw.entries
            .filter((e) => e && e.query)
            .map((e, i) => ({
              id: String(e.id || newId("pe_")),
              seq: Number.isFinite(Number(e.seq)) ? Number(e.seq) : i + 1,
              query: String(e.query || "").trim(),
              at: e.at || new Date().toISOString(),
              summary: String(e.summary || "").trim(),
              translation: String(e.translation || "").trim(),
              ownedCount: Number.isFinite(e.ownedCount) ? e.ownedCount : null,
              missingCount: Number.isFinite(e.missingCount) ? e.missingCount : null,
              items: slimInventoryItems(e.items),
              vocab: slimVocabItems(e.vocab),
            }))
        : [];
      const project = {
        id,
        name: String(raw.name || "未命名專案").trim() || "未命名專案",
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString(),
        entries,
      };
      if (byId.has(id)) updated += 1;
      else added += 1;
      byId.set(id, project);
    }
    store.projects = Array.from(byId.values());
    saveProjectsStore(store);
    return { projects: store.projects, added, updated, total: store.projects.length };
  }

  function importProjectsJSON(text) {
    const data = JSON.parse(text);
    let incoming = [];
    if (Array.isArray(data)) {
      incoming = data;
    } else if (data && Array.isArray(data.projects)) {
      incoming = data.projects;
    } else if (data && data.id && (data.entries || data.name)) {
      incoming = [data];
    } else {
      throw new Error("匯入格式需為專案物件、專案陣列，或 { projects: [...] }");
    }
    return importProjectsList(incoming, "merge");
  }

  return {
    loadRules,
    saveRules,
    loadTodos,
    saveTodos,
    getMeta,
    setMeta,
    initWithSeed,
    exportRulesJSON,
    exportDataJSON,
    importRulesJSON,
    importDataJSON,
    resetToSeed,
    loadSettings,
    saveSettings,
    clearApiKey,
    hasApiKey,
    loadLookupMode,
    saveLookupMode,
    loadLookupModes,
    saveLookupModes,
    isApiLookupEnabled,
    formatLookupModesLabel,
    DEFAULT_LOOKUP_MODES,
    loadHistory,
    saveHistory,
    addHistoryEntry,
    removeHistoryEntry,
    clearHistory,
    slimInventoryItems,
    HISTORY_MAX,
    normalizeStructureTheme,
    DEFAULT_SETTINGS,
    STRUCTURE_THEMES,
    listProjects,
    getProject,
    createProject,
    deleteProject,
    renameProject,
    getActiveProjectId,
    setActiveProjectId,
    getActiveProject,
    getProjectEntriesSorted,
    upsertProjectEntry,
    removeProjectEntry,
    findProjectEntryByQuery,
    findProjectEntryBySeq,
    exportProjectsJSON,
    importProjectsJSON,
    normalizeQueryKey,
  };
})();
