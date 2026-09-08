/**
 * 日語文法筆記本 — 主應用
 * API 盤點 · 動詞分析 · 三格 · 專案 · 歷史 · 待辦聯動
 */
const App = (() => {
  const state = {
    view: "lookup",
    editingId: null,
    draft: null,
    todoSourceId: null,
    lastQuery: "",
    lastSearch: null,
    lastInventory: null,
    formSource: null,
    aiBusy: false,
    lookupBusy: false,
    /** 進行中查詢的世代 token（新查詢遞增，舊回傳不覆寫 UI） */
    lookupToken: 0,
    /** 背景 API 查詢中的句子（可切到歷史句而不中斷） */
    pendingLookupQuery: null,
    /** 還原「查詢中」畫面用 */
    pendingLookupLoadingHtml: null,
    /** 專案模式目前游標序號 */
    projectCursorSeq: null,
    /** 專案 modal：null=大項列表 · ""=未分類 · id=該大項 */
    projectsBrowseId: null,
    /** 選字套用：{ text, start, end } */
    selApply: null,
    /** 點擊選字編輯（與 hover／複製浮層分開） */
    sentenceSelectEdit: false,
    /** 規則挑選模式：null=選字套用 · supplementary=圖例「+補充」 */
    rulePickMode: null,
    /** 建立補充用法後自動加入本句 */
    pendingSupplementaryApply: false,
    /** 單字解釋編輯中的區間 */
    vocabEditRange: null,
    /**
     * 選字「建立新規則」：儲存後自動套回此片段
     * @type {null | { text: string, start: number, end: number }}
     */
    pendingSelApply: null,
    /** 手動定位：{ ruleId, ruleTitle } */
    locateTarget: null,
    /** 空專案整首匯入：{ running, cancel, token, total, done, failed, dupCount, reused, current } */
    bulkImport: null,
    /**
     * AI 自動填寫背景工作（可離開表單瀏覽其他頁）
     * @type {null | { id: string, title: string, editingId: string|null, todoSourceId: string|null, status: 'running'|'done'|'error' }}
     */
    aiJob: null,
    /** 進入表單前的頁面（AI 填寫／取消時跳回） */
    formReturnView: null,
    gramHlCycleTimers: [],
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg, type = "info") {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show toast-${type}`;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function updateRuleCount() {
    const el = $("#app-rule-count");
    if (el) el.textContent = String(RulesService.getAll().length);
  }

  function updateApiStatusDot() {
    const dot = $("#api-status-dot");
    if (!dot) return;
    const modes = Storage.loadLookupModes();
    const ready = Storage.hasApiKey();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    // 手動模式（全關）仍可用；僅「開了 API 卻沒 Key」為未就緒
    dot.classList.toggle("ready", anyMode ? ready : true);
    if (!anyMode) {
      dot.title = "手動模式（未開掃描 · 仍可查詢）";
    } else {
      const label = Storage.formatLookupModesLabel(modes);
      dot.title = ready ? `${label} · Key 已設定` : `${label} · 尚未設定 Key`;
    }
  }

  /** 查詢頁說明與設定開關文案 */
  function updateLookupModeUI() {
    const modes = Storage.loadLookupModes();
    const desc = $("#lookup-mode-desc");
    if (desc) {
      const bits = [];
      if (modes.apiGrammar) bits.push("<strong>API 文法</strong>");
      if (modes.apiVocab) bits.push("<strong>API 單字</strong>");
      if (!bits.length) {
        const empty =
          "目前：手動模式 · 可直接查詢並選字套用（右側可再開 API 文法／單字）";
        desc.innerHTML = empty;
        desc.title = empty;
      } else {
        const needKey = modes.apiGrammar || modes.apiVocab;
        const line =
          `目前：${bits.join(" · ")}` +
          (needKey ? " · 需 API Key" : " · 無需 API Key") +
          " · 可選字套用／本句移除";
        desc.innerHTML = line;
        desc.title = line.replace(/<\/?strong>/g, "");
      }
    }
    const apiG = $("#settings-mode-api-grammar");
    const apiV = $("#settings-mode-api-vocab");
    if (apiG) apiG.checked = Boolean(modes.apiGrammar);
    if (apiV) apiV.checked = Boolean(modes.apiVocab);
    const keyReq = $("#settings-api-key-req");
    if (keyReq) keyReq.hidden = !(modes.apiGrammar || modes.apiVocab);
    syncSettingsModesAllBtn(modes);
    updateApiStatusDot();
    updateBulkImportHint();
  }

  /** 全部開啟：API 文法 + API 單字 */
  function areAllLookupModesOn(modes) {
    const m = modes || Storage.loadLookupModes();
    return Boolean(m.apiGrammar && m.apiVocab);
  }

  function syncSettingsModesAllBtn(modes) {
    const btn = $("#btn-settings-modes-all");
    if (!btn) return;
    const allOn = areAllLookupModesOn(modes);
    btn.textContent = allOn ? "全部關閉" : "全部開啟";
    btn.setAttribute("aria-pressed", allOn ? "true" : "false");
    btn.classList.toggle("is-all-on", allOn);
  }

  function onSettingsModesAllClick() {
    const modes = Storage.loadLookupModes();
    const allOn = areAllLookupModesOn(modes);
    let next;
    if (allOn) {
      next = Storage.saveLookupModes({
        apiGrammar: false,
        localGrammar: false,
        apiVocab: false,
      });
      setSettingsStatus("已全部關閉查詢模式", "warn");
      showToast("查詢模式：全部關閉", "info");
    } else {
      next = Storage.saveLookupModes({
        apiGrammar: true,
        localGrammar: false,
        apiVocab: true,
      });
      if (!Storage.hasApiKey()) {
        setSettingsStatus("已全部開啟 API 模式 — 請填入 API Key", "warn");
      } else {
        setSettingsStatus(`模式：${Storage.formatLookupModesLabel(next)}`, "ok");
      }
      showToast("查詢模式：全部開啟（API 文法 · API 單字）", "success");
    }
    updateLookupModeUI();
  }

  function updateTokenizerStatus() {
    const el = $("#tokenizer-status");
    if (!el || typeof JaTokenizer === "undefined") return;
    const s = JaTokenizer.getStatus();
    if (s.status === "ready") {
      el.textContent = "kuromoji 就緒";
      el.className = "tokenizer-status ready";
      el.title = "形態素分析已載入";
    } else if (s.status === "loading") {
      el.textContent = "辭典載入中…";
      el.className = "tokenizer-status loading";
      el.title = "正在載入 kuromoji 字典";
    } else if (s.status === "fallback" || s.status === "error") {
      el.textContent = "簡易分詞";
      el.className = "tokenizer-status fallback";
      el.title = s.lastError ? `kuromoji 不可用：${s.lastError}` : "使用後備分詞";
    } else {
      el.textContent = "分詞準備中";
      el.className = "tokenizer-status";
    }
  }

  function setView(view) {
    state.view = view;
    $$(".nav-btn").forEach((btn) => {
      if (view === "form") {
        btn.classList.remove("active");
        return;
      }
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    $$(".view").forEach((v) => {
      v.classList.toggle("hidden", v.id !== `view-${view}`);
    });
    if (view === "rules") renderRulesList();
    if (view === "vocab") renderVocabBankList();
    if (view === "todos") renderTodos();
    if (view === "history") renderHistory();
    if (view === "settings") fillSettingsForm();
    if (view === "lookup") {
      updateLookupModeUI();
      if (isEmptyActiveProject() && !state.bulkImport?.running) {
        syncProjectBulkImport();
      } else {
        restoreLookupFromCacheIfNeeded();
        syncProjectBulkImport();
      }
    }
    updateRuleCount();
    updateApiStatusDot();
    // 切換分頁後頂欄高度可能變（換行），重測 sticky 基準
    requestAnimationFrame(() => syncAppHeaderHeight());
  }

  function getFormReturnView() {
    const v = state.formReturnView;
    if (v && v !== "form" && document.getElementById(`view-${v}`)) return v;
    if (state.lastQuery) return "lookup";
    return "rules";
  }

  /**
   * 用上次盤點快照重畫查詢結果（依目前筆記本重分已收錄／未收錄），不呼叫 API
   * @returns {boolean} 是否成功還原
   */
  function restoreLookupFromCache(opts = {}) {
    const q = String(state.lastQuery || "").trim();
    const inv = state.lastInventory;
    if (!q || !inv) return false;
    // A1：apply 內只算一次 highlight
    const apiHl = applyInventoryToLookup(q, inv, {
      fromHistory: Boolean(opts.fromHistory),
      silent: true,
    });
    if (opts.persist !== false && apiHl) {
      persistLookupResult(q, inv, apiHl, { silent: true });
    }
    updateLookupNavBtns();
    if (isProjectMode()) updateProjectModeUI();
    return true;
  }

  /** 回到查詢頁時：結果為空才用快照補上 */
  function restoreLookupFromCacheIfNeeded() {
    const box = $("#lookup-result");
    const empty = !box || !box.innerHTML.trim();
    if (!empty) return false;
    return restoreLookupFromCache({ persist: false });
  }

  function formatHistoryTime(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  /**
   * 用既有盤點快照渲染查詢結果，並依「目前」筆記本重分已收錄／未收錄
   */
  /** kuromoji／後備分詞 → 給詞庫 lemma 對活用用 */
  function collectJaTokenHints(query) {
    const q = String(query || "");
    if (!q || typeof JaTokenizer === "undefined" || !JaTokenizer.tokenize) return [];
    try {
      const tokens = JaTokenizer.tokenize(q) || [];
      return tokens
        .filter((t) => t && t.isWord && String(t.text || "").trim())
        .map((t) => ({
          surface: String(t.text || "").trim(),
          lemma: String(t.basic_form || t.lemma || "").trim(),
          start: Number.isFinite(t.start) ? t.start : undefined,
          end: Number.isFinite(t.end) ? t.end : undefined,
        }));
    } catch {
      return [];
    }
  }

  /** 以全域單字庫補本句 vocab（surface／lemma；只填空欄／可注入庫內詞） */
  function prepareInventoryVocab(inventory, query) {
    if (!inventory) return inventory;
    const q = String(query || inventory.query || state.lastQuery || "");
    if (typeof Storage.mergeVocabWithBank === "function") {
      const tokenHints = collectJaTokenHints(q);
      inventory.vocab = Storage.mergeVocabWithBank(
        Array.isArray(inventory.vocab) ? inventory.vocab : [],
        q,
        { tokenHints }
      );
    } else if (!Array.isArray(inventory.vocab)) {
      inventory.vocab = [];
    }
    if (typeof Storage.filterEnglishVocab === "function") {
      inventory.vocab = Storage.filterEnglishVocab(inventory.vocab);
    }
    return inventory;
  }

  function mergeInvVocab(base, extra) {
    if (typeof DictService !== "undefined" && DictService.mergeVocab) {
      return DictService.mergeVocab(base, extra);
    }
    return (Array.isArray(base) ? base : []).concat(Array.isArray(extra) ? extra : []);
  }

  function vocabMissingGloss(list) {
    return (Array.isArray(list) ? list : []).filter((w) => {
      const surf = String(w?.surface || w?.lemma || "").trim();
      if (!surf) return false;
      if (
        typeof Storage !== "undefined" &&
        Storage.isEnglishVocabSkip &&
        Storage.isEnglishVocabSkip(surf, w?.lemma)
      ) {
        return false;
      }
      return !String(w?.gloss || "").trim();
    });
  }

  /** 把本句有用的單字寫入全域庫 */
  function rememberInventoryVocab(inventory, opts = {}) {
    if (
      typeof Storage.upsertVocabBankEntries === "function" &&
      inventory &&
      Array.isArray(inventory.vocab) &&
      inventory.vocab.length
    ) {
      Storage.upsertVocabBankEntries(inventory.vocab, opts);
    }
  }

  function lookupStoredTranslation(query) {
    const q = String(query || "").trim();
    if (!q) return "";
    const key = normalizeLookupKey(q);
    const pid = typeof Storage.getActiveProjectId === "function" ? Storage.getActiveProjectId() : "";
    if (pid && typeof Storage.findProjectEntryByQuery === "function") {
      const t = String(Storage.findProjectEntryByQuery(pid, q)?.translation || "").trim();
      if (t) return t;
    }
    const hist = typeof Storage.loadHistory === "function" ? Storage.loadHistory() : [];
    const h = hist.find((x) => normalizeLookupKey(x?.query) === key);
    return String(h?.translation || "").trim();
  }

  function keepExistingTranslation(query, inventory, opts = {}) {
    if (!inventory || opts.replaceTranslation) return inventory;
    const stored = lookupStoredTranslation(query);
    if (stored) inventory.translation = stored;
    return inventory;
  }

  function applyInventoryToLookup(query, inventory, opts = {}) {
    const q = String(query || "").trim();
    const box = $("#lookup-result");
    if (!box || !q) return null;

    keepExistingTranslation(q, inventory, opts);
    prepareInventoryVocab(inventory, q);
    const inv = {
      summary: inventory?.summary || "",
      translation: inventory?.translation || "",
      items: Array.isArray(inventory?.items) ? inventory.items : [],
      vocab: Array.isArray(inventory?.vocab) ? inventory.vocab : [],
      tokens: Array.isArray(inventory?.tokens) ? inventory.tokens : [],
      mode: inventory?.mode || inventory?.source || "",
      fallbackLegacy: Boolean(inventory?.fallbackLegacy),
      mappingFailed: Boolean(inventory?.mappingFailed),
    };
    state.lastQuery = q;
    state.lastInventory = inv;
    const input = $("#lookup-input");
    if (input) input.value = q;

    if (typeof stopGramHlCycles === "function") stopGramHlCycles();
    const apiHl = buildApiHighlight(q, inv);
    const isLocal = inv.mode === "local" || inv.source === "local";

    // 已收錄規則卡：順序＝句中首次套用順序（legend 已排好）；補充用法在最後、特殊色、無句中色
    const ownedHits = [];
    const seen = new Set();
    for (const h of apiHl.legend || []) {
      if (!h.owned || !h.ruleId || seen.has(h.ruleId)) continue;
      const rule = RulesService.getById(h.ruleId);
      if (!rule) continue;
      seen.add(h.ruleId);
      const isSupp =
        h.supplementary ||
        h.color === "usage" ||
        (typeof RulesService.isSupplementaryUsage === "function" &&
          RulesService.isSupplementaryUsage(rule));
      const ci = Number(h.color);
      ownedHits.push({
        rule,
        colorIndex: isSupp
          ? "usage"
          : Number.isFinite(ci) && h.color !== "missing"
            ? ci % 8
            : 0,
        hasSpan: isSupp ? null : h.hasSpan,
        order: ownedHits.length + 1,
        supplementary: isSupp,
      });
    }
    const ownedHtml = ownedHits.length
      ? `<section class="panel" id="lookup-owned-rules">
          <div class="panel-head">
            <h3>已收錄的規則</h3>
            <span class="badge badge-local">${ownedHits.length} 筆 · 與句中同色</span>
          </div>
          <p class="panel-note lookup-edit-hint">API／本地可能誤判。操作列：編輯 · 手動定位／重新定位 · 本句移除。選字可套用／疊加規則。<strong>補充用法</strong>為琥珀標、固定在後、不句中上色。</p>
          <div class="match-list">
            ${ownedHits
              .map((h) =>
                renderRuleCard(h.rule, {
                  badge: null,
                  colorIndex: h.colorIndex,
                  mode: "lookup",
                  hasSpan: h.supplementary ? null : h.hasSpan === true,
                })
              )
              .join("")}
          </div>
        </section>`
      : `<section class="panel" id="lookup-owned-rules">
          <div class="panel-head">
            <h3>已收錄的規則</h3>
            <span class="badge badge-local">0 筆</span>
          </div>
          <p class="panel-note">本句尚無已套用的筆記本規則。可在上方<strong>選取文字</strong>後「套用規則」手動加上。</p>
        </section>`;

    const pinHtml = renderApiSentenceBoard(q, apiHl.spans, apiHl.legend, {
      vocab: Array.isArray(inv.vocab) ? inv.vocab : [],
      source: isLocal ? "local" : "api",
      tokens: Array.isArray(inv.tokens) ? inv.tokens : [],
      inventory: inv,
    });
    // 外層 stack 含下方列表高度，sticky 才不會「捲過就消失」
    box.innerHTML = `<div class="lookup-result-stack">${pinHtml}<div class="lookup-result-body">${ownedHtml}${inventoryHtml(
      inv,
      q
    )}</div></div>`;

    bindApiInventoryEvents(q, inv);
    bindRuleCardActions(box);
    bindWordTipHovers(box);
    startGramHlCycles(box);
    updateLookupNavBtns();
    syncAppHeaderHeight();
    return apiHl;
  }

  function reviewHistoryWithCurrentRules(entry) {
    if (!entry?.query) return;
    // 允許 items 為空：仍還原句子與結果區（當時無文法標記也可回看）
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
    const tokens = Array.isArray(entry.tokens) ? entry.tokens : [];
    setView("lookup");
    if ($("#lookup-input")) $("#lookup-input").value = entry.query;
    // A1：apply 內已算一次 highlight，直接重用
    const apiHl =
      applyInventoryToLookup(
        entry.query,
        {
          summary: entry.summary || "",
          translation: entry.translation || "",
          items,
          vocab,
          tokens,
        },
        { fromHistory: true }
      ) ||
      buildApiHighlight(entry.query, {
        items,
        summary: entry.summary,
        tokens,
      });
    const ownedCount = (apiHl.legend || []).filter((h) => h.owned).length;
    const missingCount = (apiHl.legend || []).filter((h) => !h.owned).length;
    Storage.addHistoryEntry({
      query: entry.query,
      summary: entry.summary || "",
      translation: entry.translation || "",
      ownedCount,
      missingCount,
      items,
      vocab,
      tokens,
    });
    updateLookupNavBtns();
    updateBackgroundLookupBanner();
    if (items.length) {
      showToast(`已依目前筆記本重看：已收錄 ${ownedCount} · 尚未 ${missingCount}`, "success");
    } else {
      showToast("已還原句子（當時無文法標記，可選字套用）", "info");
    }
  }

  /** 從專案句子：依現在規則重看（不呼叫 API、不寫一般歷史） */
  function reviewProjectEntry(entry, opts = {}) {
    if (!entry?.query) return;
    if (entry.seq != null) state.projectCursorSeq = entry.seq;
    // 允許 items 為空：完整還原句子與結果區
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
    const tokens = Array.isArray(entry.tokens) ? entry.tokens : [];
    setView("lookup");
    if ($("#lookup-input")) $("#lookup-input").value = entry.query;
    const apiHl =
      applyInventoryToLookup(
        entry.query,
        {
          summary: entry.summary || "",
          translation: entry.translation || "",
          items,
          vocab,
          tokens,
        },
        { fromHistory: true }
      ) ||
      buildApiHighlight(entry.query, {
        items,
        summary: entry.summary,
        tokens,
      });
    const ownedCount = (apiHl.legend || []).filter((h) => h.owned).length;
    const missingCount = (apiHl.legend || []).filter((h) => !h.owned).length;
    const pid = Storage.getActiveProjectId();
    if (pid) {
      Storage.upsertProjectEntry(pid, {
        id: entry.id,
        seq: entry.seq,
        query: entry.query,
        summary: entry.summary || "",
        translation: entry.translation || "",
        ownedCount,
        missingCount,
        items,
        vocab,
        tokens,
      });
    }
    updateProjectModeUI();
    updateBackgroundLookupBanner();
    if (!opts.silent) {
      if (items.length) {
        showToast(
          `第 ${entry.seq} 句 · 已收錄 ${ownedCount} · 尚未 ${missingCount}`,
          "success"
        );
      } else {
        showToast(`第 ${entry.seq} 句 · 已還原（當時無文法標記）`, "info");
      }
    }
  }

  function renderHistory() {
    const box = $("#history-list");
    const countEl = $("#history-count");
    if (!box) return;
    const all = Storage.loadHistory();
    const filterQ = String($("#history-filter")?.value || "")
      .trim()
      .toLowerCase();
    const list = !filterQ
      ? all
      : all.filter((h) => {
          const blob = [h.query, h.summary, h.translation].join("\n").toLowerCase();
          return blob.includes(filterQ);
        });

    if (countEl) {
      if (!all.length) {
        countEl.textContent = "尚無歷史。在「查詢」送出句子後會自動記錄。";
      } else if (filterQ) {
        countEl.textContent = `搜尋「${filterQ}」· ${list.length} / ${all.length} 筆 · 列表為儲存時數字 ·「再看一次」才依目前筆記本重分`;
      } else {
        countEl.textContent = `共 ${all.length} 筆（最多 ${Storage.HISTORY_MAX || 40} 筆）· 列表顯示儲存時的已收錄／尚未 ·「再看一次」才重分`;
      }
    }
    if (!all.length) {
      box.innerHTML = `<div class="empty-state"><p>還沒有查詢紀錄。<br/>到「查詢」輸入句子並完成盤點後會出現在這裡。</p></div>`;
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>沒有符合「${esc(filterQ)}」的歷史。<br/>試試其他關鍵字。</p></div>`;
      return;
    }
    // A3：列表用儲存時 owned/missing，不對每筆即時 buildApiHighlight
    box.innerHTML = `
      <ul class="history-list">
        ${list
          .map((h) => {
            const meta = [];
            if (h.ownedCount != null) meta.push(`已收錄 ${h.ownedCount}`);
            if (h.missingCount != null) meta.push(`未收錄 ${h.missingCount}`);
            const ruleN = Array.isArray(h.items) ? h.items.length : 0;
            const preview = esc(h.query);
            return `
          <li class="history-item" data-id="${esc(h.id)}">
            <div class="history-main">
              <p class="history-query">${preview}</p>
              <p class="history-meta muted">
                ${esc(formatHistoryTime(h.at))}
                ${meta.length ? ` · ${esc(meta.join(" · "))}` : ""}
                ${meta.length ? ` · <span class="history-snap-hint">儲存時</span>` : ""}
                ${
                  ruleN
                    ? ` · <span class="muted">文法 ${ruleN}</span>`
                    : ' · <span class="muted">無文法標記</span>'
                }
                ${h.summary ? `<br/>${esc(h.summary)}` : ""}
              </p>
            </div>
            <div class="history-actions">
              <button type="button" class="btn btn-sm btn-primary" data-hist-review title="${
                ruleN
                  ? "用當時盤點快照，依目前筆記本重分已收錄／未收錄"
                  : "還原句子與結果區（當時無文法標記，可再選字套用）"
              }">再看一次</button>
              <button type="button" class="btn btn-sm btn-ghost" data-hist-remove>刪除</button>
            </div>
          </li>`;
          })
          .join("")}
      </ul>`;

    box.querySelectorAll(".history-item").forEach((li) => {
      const id = li.dataset.id;
      const entry = list.find((x) => x.id === id);
      if (!entry) return;
      li.querySelector("[data-hist-review]")?.addEventListener("click", () => {
        reviewHistoryWithCurrentRules(entry);
      });
      li.querySelector("[data-hist-remove]")?.addEventListener("click", () => {
        Storage.removeHistoryEntry(id);
        renderHistory();
        updateLookupNavBtns();
        showToast("已刪除該筆歷史", "info");
      });
    });
  }

  function clearAllHistory() {
    if (!Storage.loadHistory().length) {
      showToast("歷史是空的", "info");
      return;
    }
    if (!confirm("確定清空全部查詢歷史？（不影響規則、待辦與專案）")) return;
    Storage.clearHistory();
    renderHistory();
    updateLookupNavBtns();
    showToast("已清空歷史", "success");
  }

  /* —— 專案模式 —— */

  function isProjectMode() {
    return Boolean(Storage.getActiveProjectId());
  }

  function updateProjectModeUI() {
    const bar = $("#project-mode-bar");
    const navBtn = $("#nav-projects");
    const project = Storage.getActiveProject();
    const inProject = Boolean(project);

    if (bar) bar.classList.toggle("hidden", !inProject);
    if (navBtn) {
      navBtn.classList.toggle("project-active", inProject);
      navBtn.title = inProject
        ? `回到分項「${project.name || "未命名"}」（離開請用查詢頁「離開專案」）`
        : "大項／分項：小說各章、歌詞各首";
    }

    if (inProject) {
      const nameEl = $("#project-mode-name");
      const posEl = $("#project-mode-pos");
      const colBtn = $("#project-mode-collection");
      const sepEl = $("#project-mode-path-sep");
      const col = project.collectionId ? Storage.getCollection(project.collectionId) : null;
      if (colBtn && sepEl) {
        if (col) {
          colBtn.textContent = col.name || "未命名";
          colBtn.classList.remove("hidden");
          sepEl.classList.remove("hidden");
        } else if (project.collectionId) {
          colBtn.classList.add("hidden");
          sepEl.classList.add("hidden");
        } else {
          colBtn.textContent = "未分類";
          colBtn.classList.remove("hidden");
          sepEl.classList.remove("hidden");
        }
      }
      if (nameEl && document.activeElement !== nameEl) {
        nameEl.textContent = project.name || "未命名專案";
      }
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;
      let curSeq = state.projectCursorSeq;
      const curQ = String($("#lookup-input")?.value || "").trim();
      if (curQ) {
        curSeq = resolveDisplayedProjectSeq(project.id, curQ, curSeq);
      }
      if (posEl) {
        if (total === 0) {
          posEl.textContent = "尚無句子 · 可一次放入歌詞，或查詢後編為第 1 號";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          const idx = entries.findIndex((e) => e.seq === curSeq) + 1;
          posEl.textContent = `第 ${curSeq} 號 · ${idx}/${total} 句`;
        } else {
          posEl.textContent = `共 ${total} 句 · 查新句會接續編號`;
        }
      }
    }

    updateLookupNavBtns();
    syncProjectBulkImport();
  }

  function commitProjectRename() {
    const el = $("#project-mode-name");
    const project = Storage.getActiveProject();
    if (!el || !project) return;
    const next = String(el.textContent || "").replace(/\s+/g, " ").trim();
    if (!next) {
      el.textContent = project.name || "未命名專案";
      showToast("專案名稱不能空白", "error");
      return;
    }
    if (next === String(project.name || "").trim()) {
      el.textContent = project.name || next;
      return;
    }
    const updated = Storage.renameProject(project.id, next);
    el.textContent = updated?.name || next;
    updateProjectModeUI();
    renderProjectsList();
    showToast(`已改名為「${updated?.name || next}」`, "success");
  }

  function bindProjectNameEdit() {
    const el = $("#project-mode-name");
    if (!el || el.dataset.renameBound === "1") return;
    el.dataset.renameBound = "1";
    let snapshot = "";
    el.addEventListener("focus", () => {
      snapshot = String(el.textContent || "");
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = snapshot;
        el.blur();
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = String((e.clipboardData || window.clipboardData)?.getData("text") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) document.execCommand("insertText", false, text);
    });
    el.addEventListener("blur", () => commitProjectRename());
  }

  function isEmptyActiveProject() {
    const p = Storage.getActiveProject();
    if (!p) return false;
    return Storage.getProjectEntriesSorted(p).length === 0;
  }

  const SENTENCE_END_MARK = /[。．｡！？!?…⋯‼⁇⁈⁉]/;
  const SENTENCE_END_CLOSER = /[」』）\)］】》〉]/;
  const CJK_BEFORE_DOT = /[\u3040-\u30FF\u4E00-\u9FFFー」』）)］】》〉]/;

  function isSentenceEndChar(ch, prev, next) {
    if (SENTENCE_END_MARK.test(ch)) return true;
    if (ch === "." && prev && CJK_BEFORE_DOT.test(prev) && !/\d/.test(next || "")) {
      return true;
    }
    return false;
  }

  function isCommaBreakChar(ch, prev, next) {
    if (ch === "、" || ch === "，" || ch === "､") return true;
    if (ch === "," && !(/\d/.test(prev || "") && /\d/.test(next || ""))) return true;
    return false;
  }

  /** 依指定標點切開一行；標點與緊接的閉括號留在上一句。無該標點則原樣。 */
  function splitLineByBreakPred(line, isBreak) {
    const s = String(line || "");
    if (!s.trim()) return [];
    const parts = [];
    let start = 0;
    let i = 0;
    while (i < s.length) {
      const prev = i > 0 ? s[i - 1] : "";
      const next = i + 1 < s.length ? s[i + 1] : "";
      if (!isBreak(s[i], prev, next)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < s.length) {
        const p = j > 0 ? s[j - 1] : "";
        const n = j + 1 < s.length ? s[j + 1] : "";
        if (!isBreak(s[j], p, n)) break;
        j += 1;
      }
      while (j < s.length && SENTENCE_END_CLOSER.test(s[j])) j += 1;
      const piece = s.slice(start, j).trim();
      if (piece) parts.push(piece);
      while (j < s.length && /[\s\u3000]/.test(s[j])) j += 1;
      start = j;
      i = j;
    }
    const tail = s.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length > 1 ? parts : [s];
  }

  function breakBulkTextByPred(text, isBreak) {
    return String(text || "")
      .split(/\r?\n/)
      .flatMap((line) => (line.trim() ? splitLineByBreakPred(line, isBreak) : [""]))
      .join("\n");
  }

  function applyBulkTextTransform(transform, noChangeToast, successLabel) {
    if (state.bulkImport?.running) return;
    const ta = $("#project-bulk-input");
    if (!ta) return;
    const before = ta.value;
    if (!before.trim()) {
      showToast("請先貼上歌詞或文本", "error");
      ta.focus();
      return;
    }
    const after = transform(before);
    const same =
      after.replace(/\r\n/g, "\n") === String(before).replace(/\r\n/g, "\n");
    if (same) {
      showToast(noChangeToast, "info");
      return;
    }
    ta.value = after;
    updateBulkImportHint();
    const info = splitBulkLines(after);
    showToast(`已${successLabel}分成 ${info.lines.length} 行，可再改後再分析`, "success");
    ta.focus();
  }

  function applyBulkSentenceBreaks() {
    applyBulkTextTransform(
      (text) => breakBulkTextByPred(text, isSentenceEndChar),
      "沒有可依句號拆開的句子",
      "依句號"
    );
  }

  function applyBulkCommaBreaks() {
    applyBulkTextTransform(
      (text) => breakBulkTextByPred(text, isCommaBreakChar),
      "沒有可依逗號拆開的句子",
      "依逗號"
    );
  }

  function splitBulkLines(text) {
    const rawLines = String(text || "").split(/\r?\n/);
    const nonempty = rawLines.map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    const lines = [];
    let dupCount = 0;
    for (const line of nonempty) {
      const key = Storage.normalizeQueryKey(line);
      if (!key) continue;
      if (seen.has(key)) dupCount += 1;
      else seen.add(key);
      lines.push(line);
    }
    return {
      lines,
      rawCount: rawLines.length,
      nonemptyCount: nonempty.length,
      skippedEmpty: rawLines.length - nonempty.length,
      dupCount,
    };
  }

  function formatBulkStat(info) {
    if (!info || !info.nonemptyCount) return "尚未貼上內容";
    const bits = [`將匯入 ${info.lines.length} 句`];
    if (info.skippedEmpty) bits.push(`略過空行 ${info.skippedEmpty}`);
    if (info.dupCount) bits.push(`重複保留 ${info.dupCount}（API 只查一次）`);
    return bits.join(" · ");
  }

  function updateBulkImportHint() {
    const modeEl = $("#project-bulk-mode");
    if (modeEl && typeof Storage.formatLookupModesLabel === "function") {
      modeEl.textContent = Storage.formatLookupModesLabel(Storage.loadLookupModes());
    }
    const stat = $("#project-bulk-stat");
    const ta = $("#project-bulk-input");
    if (stat && ta && !state.bulkImport?.running) {
      stat.textContent = formatBulkStat(splitBulkLines(ta.value));
    }
  }

  function isViewingBulkProject() {
    const job = state.bulkImport;
    return Boolean(job?.running && job.projectId && Storage.getActiveProjectId() === job.projectId);
  }

  function syncProjectBulkImport() {
    const panel = $("#project-bulk-import");
    if (!panel) return;
    const running = Boolean(state.bulkImport?.running);
    const viewingJob = isViewingBulkProject();
    const empty = isEmptyActiveProject();
    const compact = viewingJob && !empty;
    const show =
      viewingJob || (empty && state.view === "lookup" && !state.lookupBusy && !running);
    panel.classList.toggle("hidden", !show);
    panel.classList.toggle("is-compact", compact);
    if (show && !running) updateBulkImportHint();
    updateBulkProgressDom();
  }

  function updateBulkProgressDom() {
    const box = $("#project-bulk-progress");
    if (!box) return;
    const job = state.bulkImport;
    if (!job?.running) {
      box.classList.add("hidden");
      document.body.classList.remove("bulk-import-running");
      updateBackgroundLookupBanner();
      return;
    }
    const viewingJob = isViewingBulkProject();
    box.classList.toggle("hidden", !viewingJob);
    const stillCollecting = viewingJob && isEmptyActiveProject();
    document.body.classList.toggle("bulk-import-running", stillCollecting);
    const title = $("#project-bulk-progress-title");
    const line = $("#project-bulk-progress-line");
    const fill = $("#project-bulk-progress-fill");
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    if (title) {
      title.textContent = `${stillCollecting ? "分析中" : "背景分析"} ${job.done}／${job.total}${
        job.failed ? ` · 失敗 ${job.failed}` : ""
      }`;
    }
    if (line) {
      const now = job.current ? `正在處理「${truncateQueryPreview(job.current, 40)}」` : "";
      line.textContent = stillCollecting
        ? now
        : [now, "可開「專案」看別本；分析不會中斷"].filter(Boolean).join(" · ");
    }
    if (fill) fill.style.width = `${pct}%`;
    updateBackgroundLookupBanner();
  }

  async function persistBulkLine(query, inventory, projectId) {
    const inv =
      inventory && typeof inventory === "object"
        ? inventory
        : { summary: "", translation: "", items: [], vocab: [], tokens: [] };
    let apiHl = { ownedHits: [], missingItems: [], spans: [], legend: [] };
    try {
      apiHl = buildApiHighlight(query, inv) || apiHl;
    } catch (err) {
      console.warn("[persistBulkLine highlight]", query, err);
    }
    try {
      persistLookupResult(query, inv, apiHl, {
        silent: true,
        keepCursor: true,
        projectId,
        forceNew: true,
      });
    } catch (err) {
      console.warn("[persistBulkLine]", query, err);
      try {
        if (typeof Storage.upsertProjectEntry === "function") {
          Storage.upsertProjectEntry(projectId, {
            query,
            summary: `分析失敗：${err.message || "無法寫入"}`,
            translation: "",
            items: [],
            vocab: [],
            tokens: [],
            forceNew: true,
          });
        }
      } catch (err2) {
        console.warn("[persistBulkLine fallback]", err2);
      }
    }
    try {
      if (typeof Storage.flushProjects === "function") {
        await Storage.flushProjects();
      }
    } catch (err) {
      console.warn("[persistBulkLine flush]", query, err);
    }
    return apiHl;
  }

  function cloneLookupJson(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function isFailedLookupInventory(inventory) {
    if (!inventory) return true;
    if (inventory.source === "failed" || inventory.mode === "failed") return true;
    return /分析失敗/.test(String(inventory.summary || ""));
  }

  function inventoryFromStoredSnapshot(entry) {
    if (!entry) return null;
    return {
      summary: String(entry.summary || ""),
      translation: String(entry.translation || ""),
      items: cloneLookupJson(entry.items) || [],
      vocab: cloneLookupJson(entry.vocab) || [],
      tokens: cloneLookupJson(entry.tokens) || [],
      mode: "cached",
      source: "cached",
    };
  }

  function rememberBulkInventory(cache, line, inventory) {
    const key = Storage.normalizeQueryKey(line);
    if (!key || isFailedLookupInventory(inventory) || cache.has(key)) return;
    cache.set(key, cloneLookupJson(inventory));
  }

  function reuseBulkInventory(cache, line, { needApi, projectId } = {}) {
    const key = Storage.normalizeQueryKey(line);
    if (!key) return null;
    if (cache.has(key)) return cloneLookupJson(cache.get(key));
    if (!needApi) return null;
    const stored =
      typeof Storage.findReusableSnapshotByQuery === "function"
        ? Storage.findReusableSnapshotByQuery(line, { projectId })
        : null;
    if (!stored) return null;
    const inv = inventoryFromStoredSnapshot(stored);
    cache.set(key, cloneLookupJson(inv));
    return inv;
  }

  async function runProjectBulkImport() {
    if (state.bulkImport?.running || state.lookupBusy) {
      showToast("已有查詢進行中", "info");
      return;
    }
    if (!isEmptyActiveProject()) {
      showToast("專案已有句子，請用上方查詢列逐句新增", "info");
      syncProjectBulkImport();
      return;
    }
    const info = splitBulkLines($("#project-bulk-input")?.value || "");
    if (!info.lines.length) {
      showToast("請先貼上歌詞或文本", "error");
      $("#project-bulk-input")?.focus();
      return;
    }
    const modes = Storage.loadLookupModes();
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (needApi && !Storage.hasApiKey()) {
      showToast("此模式需要 API Key，請先到「設定」填入", "error");
      setView("settings");
      return;
    }

    const startPid = Storage.getActiveProjectId();
    const startName = Storage.getProject(startPid)?.name || "專案";
    const job = {
      running: true,
      cancel: false,
      token: ++state.lookupToken,
      projectId: startPid,
      projectName: startName,
      total: info.lines.length,
      done: 0,
      failed: 0,
      dupCount: info.dupCount,
      reused: 0,
      current: "",
    };
    state.bulkImport = job;
    state.lookupBusy = true;
    updateBulkProgressDom();
    syncProjectBulkImport();

    let firstQuery = null;
    const lookupCache = new Map();
    try {
      for (const line of info.lines) {
        if (job.cancel || !Storage.getProject(startPid)) break;
        job.current = line;
        updateBulkProgressDom();
        let reusedThis = false;
        try {
          let inventory = reuseBulkInventory(lookupCache, line, {
            needApi,
            projectId: startPid,
          });
          reusedThis = Boolean(inventory);
          if (!inventory) {
            inventory = await fetchLookupInventory(line);
          }
          if (job.cancel || !Storage.getProject(startPid)) break;
          await persistBulkLine(line, inventory, startPid);
          if (!reusedThis) rememberBulkInventory(lookupCache, line, inventory);
          if (reusedThis) job.reused += 1;
          if (!firstQuery) firstQuery = line;
        } catch (err) {
          if (job.cancel || !Storage.getProject(startPid)) break;
          job.failed += 1;
          await persistBulkLine(
            line,
            {
              summary: `分析失敗：${err.message || "未知錯誤"}`,
              translation: "",
              items: [],
              vocab: [],
              mode: "failed",
              source: "failed",
            },
            startPid
          );
          if (!firstQuery) firstQuery = line;
        }
        job.done += 1;
        try {
          if (firstQuery && job.done === 1 && Storage.getActiveProjectId() === startPid) {
            const first = Storage.findProjectEntryByQuery(startPid, firstQuery);
            if (first) {
              reviewProjectEntry(first, { silent: true });
              showToast(
                `第 ${first.seq} 句已可看 · 其餘 ${job.total - 1} 句在背景繼續；可先開其他專案`,
                "success"
              );
            }
          }
          if (Storage.getActiveProjectId() === startPid) updateProjectModeUI();
          if (
            !$("#project-entries-modal")?.classList.contains("hidden") &&
            Storage.getActiveProjectId() === startPid
          ) {
            renderProjectEntriesList(startPid);
          }
        } catch (err) {
          console.warn("[bulk ui]", err);
        }
        if (needApi && !job.cancel && !reusedThis) {
          await new Promise((r) => setTimeout(r, 280));
        }
      }
    } finally {
      try {
        if (typeof Storage.flushProjects === "function") {
          await Storage.flushProjects();
        }
      } catch (err) {
        console.warn("[bulk flush]", err);
      }
      state.lookupBusy = false;
      const cancelled = job.cancel;
      const done = job.done;
      const failed = job.failed;
      const dupCount = job.dupCount;
      const reused = job.reused;
      state.bulkImport = null;
      document.body.classList.remove("bulk-import-running");
      updateBulkProgressDom();
      updateProjectModeUI();

      const viewing = Storage.getActiveProjectId() === startPid;
      const entries = viewing ? Storage.getProjectEntriesSorted(startPid) : [];
      if (viewing && entries.length && firstQuery && !isViewingLookupQuery(firstQuery) && !state.lastQuery) {
        const first =
          Storage.findProjectEntryByQuery(startPid, firstQuery) || entries[0];
        reviewProjectEntry(first, { silent: true });
      }
      const ta = $("#project-bulk-input");
      if (ta) ta.value = "";
      syncProjectBulkImport();

      const bits = [`「${startName}」已匯入 ${done} 句`];
      if (dupCount) bits.push(`重複保留 ${dupCount}`);
      if (reused) bits.push(`API 沿用 ${reused}`);
      if (failed) bits.push(`失敗 ${failed}`);
      if (cancelled && done < info.lines.length) bits.push("已取消其餘");
      showToast(bits.join(" · "), failed ? "info" : "success");
    }
  }

  function cancelProjectBulkImport() {
    if (!state.bulkImport?.running) return;
    state.bulkImport.cancel = true;
    const title = $("#project-bulk-progress-title");
    if (title) title.textContent = "正在取消…";
  }

  function normalizeLookupKey(q) {
    return String(q || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function isViewingLookupQuery(query) {
    return normalizeLookupKey($("#lookup-input")?.value) === normalizeLookupKey(query);
  }

  function truncateQueryPreview(q, max = 36) {
    const s = String(q || "").trim().replace(/\s+/g, " ");
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  function ensureLookupBgBanner() {
    let el = $("#lookup-bg-banner");
    if (el) return el;
    const form = $("#lookup-form");
    const result = $("#lookup-result");
    if (!form && !result) return null;
    el = document.createElement("div");
    el.id = "lookup-bg-banner";
    el.className = "lookup-bg-banner hidden";
    el.setAttribute("role", "status");
    if (form) form.insertAdjacentElement("afterend", el);
    else result.insertAdjacentElement("beforebegin", el);
    return el;
  }

  /** API 查詢中切到已查過句子時顯示；完成後自動隱藏 */
  function updateBackgroundLookupBanner() {
    const el = ensureLookupBgBanner();
    if (!el) return;
    const job = state.bulkImport;
    if (job?.running && !isViewingBulkProject()) {
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      el.classList.remove("hidden");
      el.innerHTML = `
        <div class="lookup-bg-banner-main">
          <strong>整批分析進行中</strong>
          <span>專案「${esc(job.projectName || "未命名")}」${job.done}／${job.total}${
            job.failed ? ` · 失敗 ${job.failed}` : ""
          }（${pct}%）· 不中斷目前瀏覽</span>
        </div>
        <div class="lookup-bg-banner-actions">
          <button type="button" class="btn btn-sm btn-secondary" id="btn-return-bulk-project">
            回該專案
          </button>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-cancel-bulk-away">
            取消其餘
          </button>
        </div>`;
      el.querySelector("#btn-return-bulk-project")?.addEventListener("click", () => {
        if (job.projectId) enterProject(job.projectId);
      });
      el.querySelector("#btn-cancel-bulk-away")?.addEventListener("click", () => {
        cancelProjectBulkImport();
        updateBackgroundLookupBanner();
      });
      return;
    }
    const pending = state.pendingLookupQuery;
    if (!state.lookupBusy || !pending || job?.running) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    if (isViewingLookupQuery(pending)) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="lookup-bg-banner-main">
        <strong>API 背景查詢中</strong>
        <span>「${esc(truncateQueryPreview(pending))}」完成後會自動存入${
          Storage.getActiveProjectId() ? "專案" : "歷史"
        }，不中斷目前瀏覽。</span>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" id="btn-return-pending-lookup">
        回到查詢中
      </button>`;
    el.querySelector("#btn-return-pending-lookup")?.addEventListener("click", () => {
      returnToPendingLookup();
    });
  }

  function returnToPendingLookup() {
    const pending = state.pendingLookupQuery;
    if (!pending || !state.lookupBusy) {
      updateBackgroundLookupBanner();
      return;
    }
    if ($("#lookup-input")) $("#lookup-input").value = pending;
    state.lastQuery = pending;
    const box = $("#lookup-result");
    if (box && state.pendingLookupLoadingHtml) {
      box.innerHTML = state.pendingLookupLoadingHtml;
      syncAppHeaderHeight();
    }
    updateBackgroundLookupBanner();
    updateLookupNavBtns();
    if (isProjectMode()) updateProjectModeUI();
  }

  function clearPendingLookup(token) {
    if (token != null && token !== state.lookupToken) return;
    state.lookupBusy = false;
    state.pendingLookupQuery = null;
    state.pendingLookupLoadingHtml = null;
    updateBackgroundLookupBanner();
  }

  /**
   * 一般模式：僅 → 再看歷史上一句
   * 專案模式：← 上一號 / 序號 / → 下一號
   */
  function updateLookupNavBtns() {
    const prevBtn = $("#btn-lookup-seq-prev");
    const nextBtn = $("#btn-lookup-seq-next");
    const label = $("#lookup-seq-label");
    if (!nextBtn) return;

    if (isProjectMode()) {
      const project = Storage.getActiveProject();
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;

      if (prevBtn) prevBtn.hidden = false;
      if (label) {
        label.hidden = false;
        let curSeq = state.projectCursorSeq;
        const curQ = String($("#lookup-input")?.value || "").trim();
        if (curQ) {
          curSeq = resolveDisplayedProjectSeq(project?.id, curQ, curSeq);
        }
        if (total === 0) {
          label.textContent = "—";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          label.textContent = `${curSeq}/${entries[entries.length - 1].seq}`;
        } else {
          label.textContent = `·/${entries[entries.length - 1].seq}`;
        }
      }

      const curIdx = resolveProjectCursorIndex(entries);
      if (prevBtn) {
        prevBtn.disabled = total === 0 || curIdx === 0;
        prevBtn.title = "上一號句子（A / ←）";
        prevBtn.setAttribute("aria-label", "上一號句子");
      }
      nextBtn.disabled = total === 0 || (curIdx >= 0 && curIdx >= total - 1);
      nextBtn.title = "下一號句子（D / →）";
      nextBtn.setAttribute("aria-label", "下一號句子");
      return;
    }

    if (prevBtn) prevBtn.hidden = true;
    if (label) {
      label.hidden = true;
      label.textContent = "";
    }
    const list = Storage.loadHistory();
    const has = list.length > 0;
    nextBtn.disabled = !has;
    nextBtn.title = has ? "再看歷史中的上一句（D / →）" : "尚無查詢歷史";
    nextBtn.setAttribute("aria-label", has ? "再看歷史上一句" : "尚無查詢歷史");
  }

  function resolveProjectCursorIndex(entries) {
    if (!entries?.length) return -1;
    // 副歌／重複句：必須用游標序號。若改找「輸入框同句的第一筆」，
    // 下一句會從第一次出現處起算，翻頁就會跳回前前頁打轉。
    if (state.projectCursorSeq != null) {
      const byCursor = entries.findIndex((e) => e.seq === state.projectCursorSeq);
      if (byCursor >= 0) return byCursor;
    }
    const curQ = String($("#lookup-input")?.value || "").trim();
    if (curQ) {
      const hit = entries.find(
        (e) => Storage.normalizeQueryKey(e.query) === Storage.normalizeQueryKey(curQ)
      );
      if (hit) return entries.findIndex((e) => e.seq === hit.seq);
    }
    return -1;
  }

  function recallPreviousHistorySentence() {
    const list = Storage.loadHistory();
    if (!list.length) {
      showToast("尚無查詢歷史", "info");
      updateLookupNavBtns();
      return;
    }
    const cur = String($("#lookup-input")?.value || "")
      .trim()
      .replace(/\s+/g, " ");
    let entry = list[0];
    if (cur && list.length > 1) {
      const firstNorm = String(list[0].query || "")
        .trim()
        .replace(/\s+/g, " ");
      if (cur === firstNorm) {
        entry = list[1];
      }
    }
    if (!entry?.query) {
      showToast("找不到上一句歷史", "info");
      return;
    }
    reviewHistoryWithCurrentRules(entry);
    updateLookupNavBtns();
  }

  function navigateProjectSentence(dir) {
    const project = Storage.getActiveProject();
    if (!project) {
      showToast("目前不在專案中", "info");
      return;
    }
    const entries = Storage.getProjectEntriesSorted(project);
    if (!entries.length) {
      showToast("此專案尚無句子", "info");
      updateLookupNavBtns();
      return;
    }
    let idx = resolveProjectCursorIndex(entries);
    if (idx < 0) {
      idx = dir > 0 ? -1 : entries.length;
    }
    const nextIdx = idx + dir;
    if (nextIdx < 0) {
      showToast("已是第一句", "info");
      return;
    }
    if (nextIdx >= entries.length) {
      showToast("已是最後一句", "info");
      return;
    }
    reviewProjectEntry(entries[nextIdx], { silent: false });
  }

  function onLookupSeqPrev() {
    if (isProjectMode()) navigateProjectSentence(-1);
  }

  function onLookupSeqNext() {
    if (isProjectMode()) navigateProjectSentence(1);
    else recallPreviousHistorySentence();
  }

  /** 是否在可編輯欄位中（方向鍵應留給游標移動） */
  function isEditableKeyTarget(el) {
    if (!el || el === document.body) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return Boolean(el.closest && el.closest("input, textarea, select, [contenteditable='true']"));
  }

  let touchSession = false;

  function isCoarsePointer() {
    if (touchSession) return true;
    try {
      return (
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches
      );
    } catch {
      return "ontouchstart" in window;
    }
  }

  function visualViewportBox() {
    const vv = window.visualViewport;
    if (vv) {
      return {
        left: vv.offsetLeft,
        top: vv.offsetTop,
        width: vv.width,
        height: vv.height,
        right: vv.offsetLeft + vv.width,
        bottom: vv.offsetTop + vv.height,
      };
    }
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  }

  function eventClientPoint(e) {
    const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (t) return { x: t.clientX, y: t.clientY };
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      return { x: e.clientX, y: e.clientY };
    }
    return { x: NaN, y: NaN };
  }

  function placeFixedPop(pop, clientX, clientY, opts = {}) {
    if (!pop) return;
    const pad = opts.pad ?? 8;
    const gap = opts.gap ?? 12;
    const vv = visualViewportBox();
    const rect = pop.getBoundingClientRect();
    let left = clientX - rect.width / 2;
    let top = clientY + gap;
    left = Math.max(vv.left + pad, Math.min(left, vv.right - rect.width - pad));
    if (top + rect.height > vv.bottom - pad) top = clientY - rect.height - gap;
    top = Math.max(vv.top + pad, Math.min(top, vv.bottom - rect.height - pad));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function placePopNearAnchor(pop, anchor) {
    if (!pop || !anchor) return;
    const pad = 8;
    const vv = visualViewportBox();
    const rect = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + pad;
    left = Math.max(vv.left + pad, Math.min(left, vv.right - pr.width - pad));
    if (top + pr.height > vv.bottom - pad && rect.top - pr.height - pad >= vv.top) {
      top = rect.top - pr.height - pad;
    }
    top = Math.max(vv.top + pad, Math.min(top, vv.bottom - pr.height - pad));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function bindPadChrome() {
    if (bindPadChrome.done) return;
    bindPadChrome.done = true;
    window.addEventListener(
      "touchstart",
      () => {
        touchSession = true;
      },
      { passive: true }
    );
    const vv = window.visualViewport;
    if (!vv) return;
    let ticking = false;
    const keepFocusVisible = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const el = document.activeElement;
        if (!el || !isEditableKeyTarget(el)) return;
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          el.scrollIntoView();
        }
      });
    };
    vv.addEventListener("resize", keepFocusVisible);
    vv.addEventListener("scroll", keepFocusVisible);
  }

  /**
   * 查詢頁方向鍵導航：← / A 上一句 · → / D 下一句
   * @returns {boolean} 是否已處理
   */
  function handleLookupArrowNav(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (state.view !== "lookup") return false;
    // 查詢進行中仍可切到已查過句子（背景 API 不中斷）
    if (isEditableKeyTarget(e.target)) return false;
    // modal / 浮層開啟時不導航
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return false;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return false;
    if (!$("#projects-modal")?.classList.contains("hidden")) return false;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return false;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return false;
    if (state.locateTarget) return false;

    const code = String(e.code || "");
    if (e.key === "ArrowLeft" || code === "KeyA") {
      e.preventDefault();
      onLookupSeqPrev();
      return true;
    }
    if (e.key === "ArrowRight" || code === "KeyD") {
      e.preventDefault();
      onLookupSeqNext();
      return true;
    }
    return false;
  }

  function isAppHotkeyBlocked(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
    if (e.isComposing || e.keyCode === 229) return true;
    if (isEditableKeyTarget(e.target)) return true;
    return false;
  }

  function isBlockingOverlayOpen() {
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return true;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return true;
    if (!$("#projects-modal")?.classList.contains("hidden")) return true;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return true;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return true;
    if (state.locateTarget) return true;
    return false;
  }

  function dismissTransientUi() {
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) closeVocabEditModal();
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) closeRulePickModal();
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
      hideSelApplyPop();
      state.selApply = null;
    }
    if (state.locateTarget) cancelLocateMode();
    if (!$("#project-entries-modal")?.classList.contains("hidden")) closeProjectEntriesModal();
    if (!$("#projects-modal")?.classList.contains("hidden")) closeProjectsModal();
  }

  function toggleLookupModeHotkey(which) {
    const id = which === "apiVocab" ? "settings-mode-api-vocab" : "settings-mode-api-grammar";
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !el.checked;
    onLookupModeToggle(which);
  }

  /** WASD／ZXCVBNM 全域快捷鍵（輸入中不攔截） */
  function handleAppHotkeys(e) {
    if (isAppHotkeyBlocked(e)) return false;
    const code = String(e.code || "");

    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      code === "KeyA" ||
      code === "KeyD"
    ) {
      return handleLookupArrowNav(e);
    }

    if (e.repeat) return false;

    if (code === "KeyW") {
      if (isBlockingOverlayOpen()) return false;
      e.preventDefault();
      toggleLookupModeHotkey("apiGrammar");
      return true;
    }
    if (code === "KeyS") {
      if (isBlockingOverlayOpen()) return false;
      e.preventDefault();
      toggleLookupModeHotkey("apiVocab");
      return true;
    }

    const viewByCode = {
      KeyZ: "lookup",
      KeyX: "history",
      KeyC: "projects",
      KeyV: "rules",
      KeyB: "vocab",
      KeyN: "todos",
      KeyM: "settings",
    };
    const dest = viewByCode[code];
    if (!dest) return false;
    e.preventDefault();
    if (dest === "projects") {
      if (!$("#vocab-edit-modal")?.classList.contains("hidden")) closeVocabEditModal();
      if (!$("#rule-pick-modal")?.classList.contains("hidden")) closeRulePickModal();
      if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
        hideSelApplyPop();
        state.selApply = null;
      }
      if (state.locateTarget) cancelLocateMode();
      if (!$("#project-entries-modal")?.classList.contains("hidden")) closeProjectEntriesModal();
      onNavProjects();
      return true;
    }
    dismissTransientUi();
    setView(dest);
    return true;
  }

  function onNavProjects() {
    const project = Storage.getActiveProject();
    if (project) {
      closeProjectsModal();
      setView("lookup");
      updateProjectModeUI();
      const box = $("#lookup-result");
      const empty = !box || !box.innerHTML.trim();
      if (empty) {
        const entries = Storage.getProjectEntriesSorted(project);
        if (entries.length) {
          let entry =
            state.projectCursorSeq != null
              ? entries.find((e) => e.seq === state.projectCursorSeq)
              : null;
          if (!entry) entry = entries[0];
          reviewProjectEntry(entry, { silent: true });
        }
      }
      return;
    }
    openProjectsModal();
  }

  function openProjectsModal(opts = {}) {
    const modal = $("#projects-modal");
    if (!modal) return;
    if (Object.prototype.hasOwnProperty.call(opts, "browseId")) {
      state.projectsBrowseId = opts.browseId;
    } else {
      state.projectsBrowseId = null;
    }
    modal.classList.remove("hidden");
    renderProjectsList();
    const input = $("#project-new-name");
    if (input) {
      input.value = "";
      if (!isCoarsePointer()) setTimeout(() => input.focus(), 50);
    }
  }

  function closeProjectsModal() {
    $("#projects-modal")?.classList.add("hidden");
  }

  function isBrowsingUngrouped() {
    return state.projectsBrowseId === "";
  }

  function browsingCollection() {
    if (state.projectsBrowseId == null || state.projectsBrowseId === "") return null;
    return Storage.getCollection(state.projectsBrowseId);
  }

  function syncProjectsModalChrome() {
    const atRoot = state.projectsBrowseId == null;
    const ungrouped = isBrowsingUngrouped();
    const col = browsingCollection();
    const title = $("#projects-modal-title");
    const sub = $("#projects-modal-sub");
    const crumb = $("#projects-modal-crumb");
    const crumbCur = $("#projects-crumb-current");
    const input = $("#project-new-name");
    const label = $("#project-new-name-label");
    const createBtn = $("#btn-project-create");

    if (title) title.textContent = atRoot ? "專案" : ungrouped ? "未分類" : col?.name || "分項";
    if (sub) {
      sub.textContent = atRoot
        ? "先選大項（如人間失格、歌詞），再進分項。句子只存在分項裡。"
        : "分項是現在的專案：各章／各首歌。進入後查詢會依序編號。";
    }
    if (crumb) crumb.classList.toggle("hidden", atRoot);
    if (crumbCur) {
      const name = ungrouped ? "未分類" : col?.name || "—";
      if (document.activeElement !== crumbCur) crumbCur.textContent = name;
      crumbCur.classList.toggle("is-editable", Boolean(col));
      crumbCur.contentEditable = col ? "true" : "false";
      crumbCur.title = col ? "點此改名" : "";
    }
    if (input) {
      input.placeholder = atRoot
        ? "新大項名稱，例如：人間失格、歌詞"
        : "新分項名稱，例如：第一の手記、某首歌";
    }
    if (label) label.textContent = atRoot ? "新大項名稱" : "新分項名稱";
    if (createBtn) createBtn.textContent = atRoot ? "建立大項" : "建立分項";
  }

  function collectionMoveOptionsHtml(selectedId) {
    const cur = String(selectedId || "");
    const cols = Storage.listCollections();
    const opts = [`<option value=""${cur ? "" : " selected"}>未分類</option>`];
    for (const c of cols) {
      opts.push(
        `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`
      );
    }
    return opts.join("");
  }

  function openProjectEntriesModal() {
    const project = Storage.getActiveProject();
    if (!project) {
      showToast("請先進入專案", "info");
      return;
    }
    const modal = $("#project-entries-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    const filter = $("#project-entries-filter");
    if (filter) filter.value = "";
    renderProjectEntriesList(project.id);
    setTimeout(() => filter?.focus(), 40);
  }

  function closeProjectEntriesModal() {
    $("#project-entries-modal")?.classList.add("hidden");
  }

  function renderProjectsList() {
    const box = $("#projects-list");
    if (!box) return;
    syncProjectsModalChrome();
    if (state.projectsBrowseId == null) {
      renderCollectionList(box);
      return;
    }
    renderProjectItems(box, state.projectsBrowseId);
  }

  function renderCollectionList(box) {
    const cols = Storage.listCollections();
    const ungroupedN = Storage.countUngroupedProjects();
    const active = Storage.getActiveProject();
    const items = [];

    for (const c of cols) {
      const sum = Storage.summarizeCollection(c.id);
      const current = active?.collectionId === c.id;
      items.push({
        kind: "collection",
        id: c.id,
        name: c.name,
        current,
        meta: [
          `${sum.projectCount} 分項`,
          `${sum.sentenceCount} 句`,
          sum.lastProjectName ? `上次：${sum.lastProjectName}` : "",
          c.updatedAt ? `更新 ${formatHistoryTime(c.updatedAt)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    if (ungroupedN) {
      const sum = Storage.summarizeCollection("");
      items.push({
        kind: "ungrouped",
        id: "",
        name: "未分類",
        current: Boolean(active && !active.collectionId),
        meta: [`${sum.projectCount} 分項`, `${sum.sentenceCount} 句`].join(" · "),
      });
    }

    if (!items.length) {
      box.innerHTML = `<p class="projects-empty">尚無大項。建立「人間失格」「歌詞」這類容器，再在裡面加分項（各章／各首歌）。</p>`;
      return;
    }

    box.innerHTML = `<ul class="projects-list">${items
      .map(
        (it) => `
          <li class="project-item is-folder${it.current ? " is-active" : ""}" data-kind="${
            it.kind
          }" data-id="${esc(it.id)}">
            <div class="project-item-main">
              <p class="project-item-name">${esc(it.name)}${it.current ? " · 使用中" : ""}</p>
              <p class="project-item-meta">${esc(it.meta)}</p>
            </div>
            <div class="project-item-actions">
              <button type="button" class="btn btn-sm btn-primary" data-col-open>打開</button>
              ${
                it.kind === "collection"
                  ? `<button type="button" class="btn btn-sm btn-danger-ghost" data-col-delete>刪除</button>`
                  : ""
              }
            </div>
          </li>`
      )
      .join("")}</ul>`;

    box.querySelectorAll(".project-item").forEach((li) => {
      const id = li.dataset.id;
      const open = () => {
        state.projectsBrowseId = li.dataset.kind === "ungrouped" ? "" : id;
        renderProjectsList();
        $("#project-new-name")?.focus();
      };
      li.querySelector("[data-col-open]")?.addEventListener("click", open);
      li.querySelector(".project-item-main")?.addEventListener("click", open);
      li.querySelector("[data-col-delete]")?.addEventListener("click", () => {
        deleteCollectionWithConfirm(id);
      });
    });
  }

  function renderProjectItems(box, collectionId) {
    const list = Storage.listProjectsByCollection(collectionId);
    const activeId = Storage.getActiveProjectId();
    if (!list.length) {
      box.innerHTML = `<p class="projects-empty">尚無分項。輸入名稱後按「建立分項」，再一次放入文本。</p>`;
      return;
    }
    box.innerHTML = `<ul class="projects-list">${list
      .map((p) => {
        const n = (p.entries || []).length;
        const active = p.id === activeId;
        return `
          <li class="project-item${active ? " is-active" : ""}" data-id="${esc(p.id)}">
            <div class="project-item-main">
              <p class="project-item-name">${esc(p.name)}${active ? " · 使用中" : ""}</p>
              <p class="project-item-meta">
                ${n} 句
                ${p.updatedAt ? ` · 更新 ${esc(formatHistoryTime(p.updatedAt))}` : ""}
              </p>
            </div>
            <div class="project-item-actions">
              <label class="sr-only" for="proj-move-${esc(p.id)}">搬到大項</label>
              <select
                class="project-item-move"
                id="proj-move-${esc(p.id)}"
                data-proj-move
                title="搬到其他大項"
              >${collectionMoveOptionsHtml(p.collectionId)}</select>
              <button type="button" class="btn btn-sm btn-primary" data-proj-enter>
                ${active ? "回到查詢" : "進入"}
              </button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-proj-delete>
                刪除
              </button>
            </div>
          </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".project-item").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector("[data-proj-enter]")?.addEventListener("click", () => {
        enterProject(id);
      });
      li.querySelector("[data-proj-move]")?.addEventListener("change", (e) => {
        const next = e.target.value;
        const moved = Storage.moveProject(id, next);
        if (!moved) {
          showToast("無法搬移", "error");
          renderProjectsList();
          return;
        }
        const dest = next ? Storage.getCollection(next)?.name : "未分類";
        showToast(`已搬到「${dest || "未分類"}」`, "success");
        updateProjectModeUI();
        renderProjectsList();
      });
      li.querySelector("[data-proj-delete]")?.addEventListener("click", () => {
        const p = Storage.getProject(id);
        if (!p) return;
        if (
          !confirm(
            `確定刪除分項「${p.name}」？\n內含 ${(p.entries || []).length} 句將一併清除（無法復原）。`
          )
        ) {
          return;
        }
        if (state.bulkImport?.running && state.bulkImport.projectId === id) {
          cancelProjectBulkImport();
        }
        Storage.deleteProject(id);
        if (!Storage.getActiveProjectId()) {
          state.projectCursorSeq = null;
        }
        updateProjectModeUI();
        renderProjectsList();
        showToast("已刪除分項", "info");
      });
    });
  }

  function deleteCollectionWithConfirm(id) {
    const c = Storage.getCollection(id);
    if (!c) return;
    const sum = Storage.summarizeCollection(id);
    if (!confirm(`確定刪除大項「${c.name}」？\n內含 ${sum.projectCount} 個分項、${sum.sentenceCount} 句。`)) {
      return;
    }
    const wipeKids = confirm(
      `這 ${sum.projectCount} 個分項要怎麼處理？\n\n確定＝連同分項與句子全部刪除\n取消＝只刪大項，分項回到「未分類」`
    );
    if (wipeKids) {
      const kids = Storage.listProjectsByCollection(id);
      for (const p of kids) {
        if (state.bulkImport?.running && state.bulkImport.projectId === p.id) {
          cancelProjectBulkImport();
        }
      }
    }
    Storage.deleteCollection(id, { deleteChildren: wipeKids });
    if (!Storage.getActiveProjectId()) state.projectCursorSeq = null;
    if (state.projectsBrowseId === id) state.projectsBrowseId = null;
    updateProjectModeUI();
    renderProjectsList();
    showToast(wipeKids ? `已刪除大項「${c.name}」與全部分項` : `已刪除大項「${c.name}」· 分項回到未分類`, "info");
  }

  function filterProjectEntries(entries, rawQ) {
    const q = String(rawQ || "").trim();
    if (!q) return entries.slice();
    const qLower = q.toLowerCase();
    const seqMatch = q.match(/^(?:#|第\s*)?(\d+)\s*(?:號|句)?$/);
    if (seqMatch) {
      const n = Number(seqMatch[1]);
      return entries.filter((e) => Number(e.seq) === n);
    }
    const rangeMatch = q.match(/^(\d+)\s*[-~～—–]\s*(\d+)$/);
    if (rangeMatch) {
      let a = Number(rangeMatch[1]);
      let b = Number(rangeMatch[2]);
      if (a > b) [a, b] = [b, a];
      return entries.filter((e) => {
        const s = Number(e.seq);
        return s >= a && s <= b;
      });
    }
    return entries.filter((e) => {
      const blob = [e.query, e.summary, e.translation, String(e.seq), `#${e.seq}`, `第${e.seq}`]
        .join("\n")
        .toLowerCase();
      return blob.includes(qLower);
    });
  }

  function highlightFilterMatch(text, rawQ) {
    const src = String(text || "");
    const q = String(rawQ || "").trim();
    if (!q || !src) return esc(src);
    if (/^(?:#|第\s*)?\d+\s*(?:號|句)?$/.test(q) || /^\d+\s*[-~～—–]\s*\d+$/.test(q)) {
      return esc(src);
    }
    const lower = src.toLowerCase();
    const ql = q.toLowerCase();
    const idx = lower.indexOf(ql);
    if (idx < 0) return esc(src);
    const before = src.slice(0, idx);
    const mid = src.slice(idx, idx + q.length);
    const after = src.slice(idx + q.length);
    return `${esc(before)}<mark class="pe-hl">${esc(mid)}</mark>${esc(after)}`;
  }

  function renderProjectEntriesList(projectId) {
    const box = $("#project-entries-list");
    const sub = $("#project-entries-modal-sub");
    const stat = $("#project-entries-filter-stat");
    const project = Storage.getProject(projectId);
    if (!box || !project) return;
    const all = Storage.getProjectEntriesSorted(project);
    const filterQ = String($("#project-entries-filter")?.value || "");
    const entries = filterProjectEntries(all, filterQ);

    if (sub) {
      const col = project.collectionId ? Storage.getCollection(project.collectionId) : null;
      const path = col ? `${col.name} › ${project.name}` : project.name;
      sub.textContent = `「${path}」· 共 ${all.length} 句 · 序號永久固定，刪除後不重編`;
    }
    if (stat) {
      if (!all.length) {
        stat.textContent = "";
      } else if (filterQ.trim()) {
        stat.textContent = `${entries.length} / ${all.length}`;
      } else {
        stat.textContent = `${all.length} 句`;
      }
    }

    if (!all.length) {
      box.innerHTML = `<div class="project-entries-empty">
        <p class="project-entries-empty-title">尚無句子</p>
        <p>在查詢頁送出後會依序編為第 1、2、3… 號。</p>
      </div>`;
      return;
    }
    if (!entries.length) {
      box.innerHTML = `<div class="project-entries-empty">
        <p class="project-entries-empty-title">沒有符合的句子</p>
        <p>試試其他關鍵字，或輸入序號如 <code>3</code>、<code>#12</code>、區間 <code>2-5</code>。</p>
      </div>`;
      return;
    }

    const activeSeq = state.projectCursorSeq;
    box.innerHTML = `<ul class="project-entries-list" role="list">${entries
      .map((e) => {
        const ruleN = Array.isArray(e.items) ? e.items.length : 0;
        const isCurrent = activeSeq != null && Number(e.seq) === Number(activeSeq);
        const qFull = String(e.query || "");
        const qShow = qFull.length > 160 ? qFull.slice(0, 160) + "…" : qFull;
        const tr = String(e.translation || "").trim();
        const sum = String(e.summary || "").trim();
        return `
          <li class="project-entry-item${isCurrent ? " is-current" : ""}" data-id="${esc(
            e.id
          )}" data-seq="${e.seq}">
            <div class="project-entry-seq-col" aria-hidden="true">
              <span class="project-entry-seq">#${e.seq}</span>
            </div>
            <div class="project-entry-main">
              <p class="project-entry-query">${highlightFilterMatch(qShow, filterQ)}</p>
              ${
                tr
                  ? `<p class="project-entry-trans">${highlightFilterMatch(
                      tr.length > 100 ? tr.slice(0, 100) + "…" : tr,
                      filterQ
                    )}</p>`
                  : ""
              }
              <div class="project-entry-meta-row">
                <span class="pe-chip">${esc(formatHistoryTime(e.at) || "—")}</span>
                ${
                  ruleN
                    ? `<span class="pe-chip pe-chip-ok">文法 ${ruleN}</span>`
                    : `<span class="pe-chip">無文法標記</span>`
                }
                ${
                  e.ownedCount != null || e.missingCount != null
                    ? `<span class="pe-chip">已收錄 ${e.ownedCount ?? "—"} · 尚未 ${
                        e.missingCount ?? "—"
                      }</span>`
                    : ""
                }
                ${isCurrent ? `<span class="pe-chip pe-chip-now">目前句子</span>` : ""}
              </div>
              ${
                sum
                  ? `<p class="project-entry-summary">${highlightFilterMatch(
                      sum.length > 100 ? sum.slice(0, 100) + "…" : sum,
                      filterQ
                    )}</p>`
                  : ""
              }
            </div>
            <div class="project-entry-actions">
              <button type="button" class="btn btn-sm btn-primary" data-pe-review title="${
                ruleN
                  ? "還原盤點快照"
                  : "還原句子與結果區（當時無文法標記）"
              }">再看</button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-pe-delete>刪除</button>
            </div>
          </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".project-entry-item").forEach((li) => {
      const entryId = li.dataset.id;
      const entry = entries.find((x) => x.id === entryId);
      if (!entry) return;
      li.querySelector("[data-pe-review]")?.addEventListener("click", () => {
        closeProjectEntriesModal();
        reviewProjectEntry(entry);
      });
      li.querySelector("[data-pe-delete]")?.addEventListener("click", () => {
        if (!confirm(`確定刪除第 ${entry.seq} 號句子？\n（其餘句子序號不變）`)) return;
        Storage.removeProjectEntry(projectId, entryId);
        if (state.projectCursorSeq === entry.seq) state.projectCursorSeq = null;
        renderProjectEntriesList(projectId);
        if (isEmptyActiveProject()) {
          state.lastQuery = "";
          state.lastInventory = null;
          if ($("#lookup-input")) $("#lookup-input").value = "";
          const resultBox = $("#lookup-result");
          if (resultBox) resultBox.innerHTML = "";
        }
        updateProjectModeUI();
        showToast(`已刪除第 ${entry.seq} 號`, "info");
      });
    });
  }

  function enterProject(id) {
    const p = Storage.getProject(id);
    if (!p) {
      showToast("找不到專案", "error");
      return;
    }
    Storage.setActiveProjectId(id);
    if (p.collectionId) Storage.rememberCollectionLastProject(p.collectionId, id);
    state.projectCursorSeq = null;
    closeProjectsModal();
    setView("lookup");
    updateProjectModeUI();
    syncProjectBulkImport();
    updateBackgroundLookupBanner();
    const entries = Storage.getProjectEntriesSorted(p);
    if (entries.length) {
      reviewProjectEntry(entries[0], { silent: true });
      showToast(`已進入「${p.name}」· ${entries.length} 句`, "success");
    } else {
      const input = $("#lookup-input");
      if (input) input.value = "";
      const box = $("#lookup-result");
      if (box) box.innerHTML = "";
      state.lastQuery = "";
      state.lastInventory = null;
      syncProjectBulkImport();
      showToast(`已進入「${p.name}」· 可貼上文本一次匯入`, "success");
    }
  }

  function leaveProject() {
    if (!Storage.getActiveProjectId()) {
      showToast("目前不在專案中", "info");
      return;
    }
    Storage.setActiveProjectId(null);
    state.projectCursorSeq = null;
    updateProjectModeUI();
    $("#project-bulk-import")?.classList.add("hidden");
    syncProjectBulkImport();
    updateBackgroundLookupBanner();
    showToast(
      state.bulkImport?.running
        ? "已離開專案 · 整批分析仍在背景進行"
        : "已離開專案（一般查詢模式）",
      "info"
    );
  }

  function createProjectFromModal() {
    const input = $("#project-new-name");
    const name = String(input?.value || "").trim();
    if (!name) {
      showToast(state.projectsBrowseId == null ? "請輸入大項名稱" : "請輸入分項名稱", "error");
      input?.focus();
      return;
    }
    if (state.projectsBrowseId == null) {
      const c = Storage.createCollection(name);
      if (input) input.value = "";
      state.projectsBrowseId = c.id;
      renderProjectsList();
      showToast(`已建立大項「${c.name}」· 可再加分項`, "success");
      input?.focus();
      return;
    }
    const p = Storage.createProject(name, { collectionId: state.projectsBrowseId || "" });
    if (input) input.value = "";
    renderProjectsList();
    showToast(`已建立分項「${p.name}」`, "success");
  }

  function commitCollectionRenameFromCrumb() {
    const el = $("#projects-crumb-current");
    const col = browsingCollection();
    if (!el || !col) return;
    const next = String(el.textContent || "").replace(/\s+/g, " ").trim();
    if (!next) {
      el.textContent = col.name || "未命名";
      showToast("大項名稱不能空白", "error");
      return;
    }
    if (next === String(col.name || "").trim()) {
      el.textContent = col.name || next;
      return;
    }
    const updated = Storage.renameCollection(col.id, next);
    el.textContent = updated?.name || next;
    updateProjectModeUI();
    renderProjectsList();
    showToast(`已改名為「${updated?.name || next}」`, "success");
  }

  function bindCollectionCrumbRename() {
    const el = $("#projects-crumb-current");
    if (!el || el.dataset.renameBound === "1") return;
    el.dataset.renameBound = "1";
    let snapshot = "";
    el.addEventListener("focus", () => {
      snapshot = String(el.textContent || "");
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = snapshot;
        el.blur();
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = String((e.clipboardData || window.clipboardData)?.getData("text") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) document.execCommand("insertText", false, text);
    });
    el.addEventListener("blur", () => commitCollectionRenameFromCrumb());
  }

  function maskKey(key) {
    const k = String(key || "");
    if (k.length <= 8) return k ? "••••" : "（未設定）";
    return k.slice(0, 4) + "…" + k.slice(-4);
  }

  function setSettingsStatus(text, kind = "") {
    const box = $("#settings-status");
    const el = $("#settings-status-text");
    if (el) el.textContent = text;
    if (box) {
      box.classList.remove("ok", "warn", "error");
      if (kind) box.classList.add(kind);
    }
  }

  function applyStructureTheme(themeId) {
    const id = Storage.normalizeStructureTheme(themeId);
    document.documentElement.setAttribute("data-structure-theme", id);
    return id;
  }

  function renderStructureThemePreview() {
    const host = $("#structure-theme-preview");
    if (!host) return;
    host.innerHTML = conjugationFormulaHtml(
      { ichidan: "語幹＋て＋いる", godan: "音便＋いる", sahen: "して＋いる" },
      { preview: true }
    );
  }

  function renderThemePicker(selectedId) {
    const box = $("#structure-theme-picker");
    if (!box) return;
    const themes = Storage.STRUCTURE_THEMES || [];
    const sel = Storage.normalizeStructureTheme(selectedId);
    box.innerHTML = themes
      .map((t) => {
        const active = t.id === sel ? " active" : "";
        return `
          <button type="button" class="theme-card${active}" role="radio" aria-checked="${
            t.id === sel ? "true" : "false"
          }" data-theme-id="${esc(t.id)}">
            <span class="theme-card-swatches" data-structure-theme="${esc(t.id)}" aria-hidden="true">
              <span class="theme-swatch theme-swatch-slot"></span>
              <span class="theme-swatch theme-swatch-plus">＋</span>
              <span class="theme-swatch theme-swatch-affix"></span>
              <span class="theme-swatch theme-swatch-transform"></span>
            </span>
            <span class="theme-card-meta">
              <strong>${esc(t.label)}</strong>
              <span class="muted">${esc(t.desc || "")}</span>
            </span>
          </button>`;
      })
      .join("");
    box.querySelectorAll(".theme-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = applyStructureTheme(btn.dataset.themeId);
        Storage.saveSettings({ structureTheme: id });
        renderThemePicker(id);
        renderStructureThemePreview();
        showToast(
          `已套用「${(Storage.STRUCTURE_THEMES.find((x) => x.id === id) || {}).label || id}」配色`,
          "success"
        );
      });
    });
  }

  function readApiFieldsFromForm() {
    return {
      apiKey: $("#settings-api-key")?.value || "",
      baseUrl: $("#settings-base-url")?.value || "",
      model: $("#settings-model")?.value || "",
    };
  }

  function renderApiProviderUI(s) {
    const settings = s || Storage.loadSettings();
    const providers = Storage.API_PROVIDERS || [];
    const curId =
      typeof Storage.inferApiProviderId === "function"
        ? Storage.inferApiProviderId(settings)
        : settings.apiProvider || "grok";
    const preset =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(curId)
        : providers.find((p) => p.id === curId) || providers[0] || {};
    const box = $("#settings-api-provider");
    if (box) {
      box.innerHTML = providers
        .map((p) => {
          const hasKey = Boolean(settings.apiProfiles?.[p.id]?.apiKey);
          const active = p.id === curId;
          return `<button type="button" class="api-provider-pill${
            active ? " is-active" : ""
          }" data-api-provider="${esc(p.id)}" aria-pressed="${active ? "true" : "false"}">
            ${esc(p.label)}${
              hasKey ? `<span class="api-provider-keydot" title="已保存金鑰"></span>` : ""
            }
          </button>`;
        })
        .join("");
    }
    const hint = $("#settings-provider-hint");
    if (hint) {
      hint.innerHTML =
        `${esc(preset.hint || "")}。切換服務時各家金鑰分開保存在本機。` +
        (preset.signup
          ? ` 申請：<a href="${esc(preset.signup)}" target="_blank" rel="noopener noreferrer">${esc(
              preset.signupLabel || preset.signup
            )}</a>`
          : "");
    }
    const keyHint = $("#settings-api-key-hint");
    if (keyHint && !preset.signup) {
      keyHint.textContent =
        "金鑰存在本機瀏覽器 localStorage，不會上傳到本專案伺服器。請勿在公用電腦儲存。";
    } else if (keyHint) {
      keyHint.innerHTML =
        `金鑰存在本機瀏覽器 localStorage，不會上傳到本專案伺服器。請勿在公用電腦儲存。申請：<a href="${esc(
          preset.signup
        )}" target="_blank" rel="noopener noreferrer">${esc(preset.signupLabel || preset.signup)}</a>`;
    }
    const keyInput = $("#settings-api-key");
    if (keyInput) keyInput.placeholder = preset.keyPlaceholder || "API Key";
    const urlInput = $("#settings-base-url");
    if (urlInput) {
      urlInput.readOnly = Boolean(preset.urlLocked);
      urlInput.placeholder = preset.baseUrl || "https://";
    }
    const urlHint = $("#settings-base-url-hint");
    if (urlHint) {
      urlHint.innerHTML = preset.urlLocked
        ? `此服務使用固定端點 <code>${esc(preset.baseUrl)}</code>（OpenAI 相容）`
        : "請填寫 OpenAI 相容的 Base URL（不含尾端 <code>/chat/completions</code>）。";
    }
    const modelInput = $("#settings-model");
    if (modelInput) modelInput.placeholder = preset.defaultModel || "模型名稱";
    const chips = $("#settings-model-shortcuts");
    const models = Array.isArray(preset.models) ? preset.models : [];
    const curModel = String(settings.model || "").trim();
    if (chips) {
      chips.hidden = !models.length;
      chips.innerHTML = models
        .map(
          (m) =>
            `<button type="button" class="model-chip${
              m.id === curModel ? " is-active" : ""
            }" data-model-id="${esc(m.id)}">${esc(m.label)}</button>`
        )
        .join("");
    }
  }

  function switchApiProvider(id) {
    if (typeof Storage.switchApiProvider !== "function") return;
    const next = Storage.switchApiProvider(id, readApiFieldsFromForm());
    fillSettingsForm();
    updateApiStatusDot();
    const label = (Storage.getApiProvider && Storage.getApiProvider(id)?.label) || id;
    const hasKey = Boolean(next.apiKey);
    showToast(
      hasKey ? `已切換 ${label}（已還原該服務金鑰）` : `已切換 ${label}（此服務尚未填金鑰）`,
      hasKey ? "success" : "info"
    );
  }

  function applyModelShortcut(modelId) {
    const input = $("#settings-model");
    if (!input || !modelId) return;
    input.value = modelId;
    Storage.saveSettings({
      ...readApiFieldsFromForm(),
      model: modelId,
    });
    renderApiProviderUI();
    const modes = Storage.loadLookupModes();
    const s = Storage.loadSettings();
    const prov = Storage.getApiProvider ? Storage.getApiProvider(s.apiProvider) : null;
    setSettingsStatus(
      `已填入模型 ${modelId}` +
        (prov ? ` · ${prov.label}` : "") +
        (s.apiKey ? ` · Key ${maskKey(s.apiKey)}` : "") +
        ` · ${Storage.formatLookupModesLabel(modes)}`,
      s.apiKey ? "ok" : "warn"
    );
  }

  function fillSettingsForm() {
    const s = Storage.loadSettings();
    $("#settings-api-key").value = s.apiKey || "";
    $("#settings-base-url").value = s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl;
    $("#settings-model").value = s.model || Storage.DEFAULT_SETTINGS.model;
    const input = $("#settings-api-key");
    if (input) input.type = "password";
    const toggle = $("#btn-toggle-key");
    if (toggle) toggle.textContent = "顯示";
    renderApiProviderUI(s);
    syncApiTtsSwitch(s);
    updateLookupModeUI();
    const modes = Storage.loadLookupModes();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    const prov =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(s.apiProvider)
        : null;
    const provLabel = prov?.label ? `${prov.label} · ` : "";
    applyStructureTheme(s.structureTheme);
    renderThemePicker(s.structureTheme);
    renderStructureThemePreview();
    if (s.apiKey) {
      setSettingsStatus(
        `已設定 ${provLabel}API Key（${maskKey(s.apiKey)}）· 模型 ${s.model} · ${modeLabel}`,
        "ok"
      );
    } else if (needApi) {
      setSettingsStatus(
        `尚未設定 ${provLabel}API Key — API 文法／單字與 AI 填寫無法使用`,
        "warn"
      );
    } else {
      setSettingsStatus("手動模式 · 可查詢並選字套用（未開掃描）", "ok");
    }
    updateSettingsStorageUsage();
  }

  function updateSettingsStorageUsage() {
    const el = $("#settings-storage-usage");
    if (!el || typeof Storage.measureLocalStorageUsage !== "function") return;
    const u = Storage.measureLocalStorageUsage();
    const pct = Math.round(u.pct * 100);
    const backend =
      u.backend || (typeof Storage.getProjectsBackend === "function" ? Storage.getProjectsBackend() : "");
    const top = (u.rows || [])
      .slice(0, 3)
      .filter((r) => r.key !== "jgn_projects_v1" || backend !== "idb")
      .map((r) => `${r.key.replace(/^(.{18}).+$/, "$1…")} ${Storage.formatStorageBytes(r.bytes)}`)
      .join(" · ");
    let line = `localStorage 約 ${u.totalLabel}／${u.quotaLabel}（${pct}%）`;
    if (backend === "idb") {
      line += ` · 專案句子 IndexedDB ${u.idbLabel || "0 B"}（不受 5MB 上限）`;
    } else if (u.app) {
      line += ` · 文法筆記本 ${u.appLabel}`;
    }
    if (u.level === "full") {
      line +=
        backend === "idb"
          ? " · localStorage 已接近上限（規則／設定／其他網站資料）；專案句子已在 IndexedDB。"
          : " · 已接近上限，整批分析容易寫不進去。可匯出後刪舊專案／清空歷史。";
    } else if (u.level === "warn" && backend !== "idb") {
      line += " · 偏高，歌詞專案含切詞快照會很快塞滿。";
    }
    if (top) line += ` 最大：${top}`;
    el.textContent = line;
  }

  function readLookupModesFromForm() {
    return {
      apiGrammar: Boolean($("#settings-mode-api-grammar")?.checked),
      localGrammar: false,
      apiVocab: Boolean($("#settings-mode-api-vocab")?.checked),
    };
  }

  function onLookupModeToggle(changed) {
    const raw = readLookupModesFromForm();
    const modes = Storage.saveLookupModes(raw);
    updateLookupModeUI();
    const label = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (!modes.apiGrammar && !modes.apiVocab) {
      setSettingsStatus("手動模式 · 可查詢並選字套用", "ok");
      showToast("已關閉掃描 · 仍可查詢並手動套用規則", "info");
    } else if (needApi && !Storage.hasApiKey()) {
      setSettingsStatus(`模式：${label} — 請填入 API Key`, "warn");
      showToast(`查詢模式：${label}`, "success");
    } else {
      setSettingsStatus(`模式：${label}`, "ok");
      showToast(`查詢模式：${label}`, "success");
    }
  }

  function saveSettingsForm(e) {
    e?.preventDefault();
    const themeBtn = $("#structure-theme-picker .theme-card.active");
    const raw = readLookupModesFromForm();
    const modes = Storage.saveLookupModes(raw);
    const next = Storage.saveSettings({
      ...readApiFieldsFromForm(),
      apiTtsEnabled: Boolean($("#settings-api-tts")?.checked),
      structureTheme:
        themeBtn?.dataset?.themeId ||
        document.documentElement.getAttribute("data-structure-theme") ||
        Storage.DEFAULT_SETTINGS.structureTheme,
      lookupModes: modes,
    });
    applyStructureTheme(next.structureTheme);
    updateLookupModeUI();
    renderApiProviderUI(next);
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    const provLabel =
      typeof Storage.getApiProvider === "function"
        ? `${Storage.getApiProvider(next.apiProvider).label} · `
        : "";
    if (next.apiKey) {
      setSettingsStatus(
        `已儲存 ${provLabel}（${maskKey(next.apiKey)}）· 模型 ${next.model} · ${modeLabel}`,
        "ok"
      );
      showToast("設定已儲存", "success");
    } else if (needApi) {
      setSettingsStatus("已儲存，但未填 API Key", "warn");
      showToast("已儲存（尚未填 API Key）", "info");
    } else {
      setSettingsStatus(`已儲存 · ${modeLabel || "未啟用模式"}`, "ok");
      showToast("設定已儲存", "success");
    }
  }

  async function testApiConnection() {
    Storage.saveSettings(readApiFieldsFromForm());
    updateApiStatusDot();
    const btn = $("#btn-test-api");
    if (btn) btn.disabled = true;
    setSettingsStatus("測試連線中…", "");
    try {
      const result = await AiService.testConnection();
      setSettingsStatus(`連線成功 · 回覆：${result.sample}`, "ok");
      showToast("API 連線成功", "success");
    } catch (err) {
      setSettingsStatus(err.message || "連線失敗", "error");
      showToast(err.message || "連線失敗", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function clearApiKey() {
    const s = Storage.loadSettings();
    const label =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(s.apiProvider).label
        : "目前服務";
    if (!confirm(`確定清除「${label}」的 API Key？其他服務已保存的金鑰會保留。`)) return;
    Storage.clearApiKey();
    $("#settings-api-key").value = "";
    updateApiStatusDot();
    renderApiProviderUI();
    setSettingsStatus(`${label} 的 API Key 已清除`, "warn");
    showToast("已清除 API Key", "info");
  }

  function fillCategorySelect(selected) {
    const sel = $("#form-category");
    if (!sel) return;
    const cats = RulesService.CATEGORIES || [];
    sel.innerHTML = cats
      .map((c) => `<option value="${esc(c.key)}"${c.key === (selected || "") ? " selected" : ""}>${esc(c.label)}</option>`)
      .join("");
    if (selected && !cats.some((c) => c.key === selected)) {
      const opt = document.createElement("option");
      opt.value = selected;
      opt.textContent = selected;
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function uidJob() {
    return "ai_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function setAiJobBar(status, message, opts = {}) {
    const bar = $("#ai-job-bar");
    const text = $("#ai-job-bar-text");
    const dismiss = $("#btn-ai-job-dismiss");
    if (!bar || !text) return;
    if (status === "hidden") {
      bar.classList.add("hidden");
      bar.classList.remove("is-running", "is-done", "is-error");
      return;
    }
    bar.classList.remove("hidden", "is-running", "is-done", "is-error");
    if (status === "running") bar.classList.add("is-running");
    if (status === "done") bar.classList.add("is-done");
    if (status === "error") bar.classList.add("is-error");
    text.textContent = message || "";
    if (dismiss) dismiss.hidden = status === "running";
    const formBtn = $("#btn-ai-job-form");
    if (formBtn) formBtn.textContent = opts.formBtnLabel || "回表單";
  }

  function returnToAiForm() {
    if (state.aiJob) {
      state.editingId = state.aiJob.editingId;
      state.todoSourceId = state.aiJob.todoSourceId;
    }
    setView("form");
    if (state.aiJob?.status === "done" || state.aiJob?.status === "error") {
      setAiJobBar("hidden");
      state.aiJob = null;
    }
    $("#form-explanation")?.focus();
  }

  function dismissAiJobBar() {
    setAiJobBar("hidden");
    if (!state.aiBusy) state.aiJob = null;
  }

  /** 補充用法表單：AI 只補說明／三格，不可改分類 */
  function resolveAiKeepCategory(current) {
    const supp = RulesService.SUPPLEMENTARY_CATEGORY || "補充用法";
    const cat = String(current?.category || "").trim();
    if (cat === supp) return supp;
    if (state.formSource === "from-supplementary") return supp;
    if (state.pendingSupplementaryApply) return supp;
    if (state.editingId) {
      const existing = RulesService.getById(state.editingId);
      if (existing && RulesService.isSupplementaryUsage(existing)) return supp;
    }
    return "";
  }

  async function runAiComplete() {
    if (state.aiBusy) {
      showToast("AI 仍在填寫中，可先到歷史或筆記本查看", "info");
      return;
    }
    const title = ($("#form-title")?.value || "").trim();
    if (!title) {
      showToast("請先填寫規則名", "error");
      $("#form-title")?.focus();
      return;
    }
    if (!Storage.hasApiKey()) {
      showToast("請先到「設定」填入 API Key", "error");
      setView("settings");
      return;
    }
    const current = readForm();
    const hasContent =
      (current.explanation || "").trim() ||
      current.requiresConjugation ||
      RulesService.hasConjugationContent(current.conjugation);
    if (hasContent && !confirm("目前說明或三格已有內容，要用 AI 結果覆寫嗎？")) return;

    const keepCategory = resolveAiKeepCategory(current);
    const jobId = uidJob();
    const job = {
      id: jobId,
      title,
      editingId: state.editingId,
      todoSourceId: state.todoSourceId,
      keepCategory,
      pendingSelApply: state.pendingSelApply,
      pendingSupplementaryApply: state.pendingSupplementaryApply,
      status: "running",
    };
    state.aiJob = job;
    state.aiBusy = true;

    const btn = $("#btn-ai-complete");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
    }
    const banner = $("#form-prefill-banner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>AI 查詢中</strong> — 依「${esc(
        title
      )}」產生內容…可先離開此頁查看歷史或筆記本。`;
    }

    setAiJobBar("running", `AI 填寫中：${title} — 可先瀏覽其他頁，完成後回表單核對`);
    setView(getFormReturnView());
    showToast("AI 填寫中，完成後可點狀態列「回表單」核對", "info");

    try {
      const draft = await AiService.completeRuleFromTitle(title, { keepCategory });
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "done";
        state.editingId = job.editingId;
        state.todoSourceId = job.todoSourceId;
        if (job.pendingSelApply) state.pendingSelApply = job.pendingSelApply;
        if (job.pendingSupplementaryApply) {
          state.pendingSupplementaryApply = job.pendingSupplementaryApply;
        }
        if (draft.title) $("#form-title").value = draft.title;
        $("#form-explanation").value = draft.explanation || "";
        if (keepCategory) {
          draft.category = keepCategory;
          fillCategorySelect(keepCategory);
        } else if (draft.category) {
          fillCategorySelect(draft.category);
        }
        setConjugationFields(draft);
        state.draft = { ...(state.draft || {}), ...draft, ...(keepCategory ? { category: keepCategory } : {}) };
        if (banner) {
          banner.className = "result-banner success";
          banner.innerHTML = keepCategory
            ? `<strong>AI 已填寫</strong> — 分類維持「${esc(keepCategory)}」。請核對說明後再儲存。`
            : `<strong>AI 已填寫</strong> — 請核對說明與三格後再儲存。`;
        }
        setAiJobBar("done", `AI 已填好「${draft.title || title}」— 點「回表單」核對`, {
          formBtnLabel: "回表單核對",
        });
        showToast("AI 已填好，可回表單核對", "success");
      }
    } catch (err) {
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "error";
        if (banner) {
          banner.className = "result-banner error";
          banner.innerHTML = `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`;
        }
        setAiJobBar("error", `AI 失敗：${err.message || "未知錯誤"}`, { formBtnLabel: "回表單" });
      }
      showToast(err.message || "AI 填寫失敗", "error");
    } finally {
      state.aiBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  /** 查詢結果只走 applyInventoryToLookup；此函式僅清空或重畫目前盤點（相容 init） */
  function renderLookupResult(_result) {
    if (state.lastQuery && state.lastInventory) {
      restoreLookupFromCache({ persist: false });
      return;
    }
    const box = $("#lookup-result");
    if (box) box.innerHTML = "";
  }

  function structureRoleLabel(role) {
    if (role === "slot") return "槽位";
    if (role === "base") return "詞根";
    if (role === "affix") return "標記";
    if (role === "result") return "變化";
    if (role === "transform") return "變化";
    return "";
  }

  function structureTokensToChunks(tokens) {
    const chunks = [];
    (tokens || []).forEach((t) => {
      if (t.op === "plus") {
        chunks.push(
          `<span class="structure-plus" aria-hidden="true"><span class="structure-plus-inner">＋</span></span>`
        );
        return;
      }
      if (t.op === "arrow") {
        chunks.push(
          `<span class="structure-arrow" aria-hidden="true"><span class="structure-arrow-inner">→</span></span>`
        );
        return;
      }
      if (t.op === "slash") {
        chunks.push(
          `<span class="structure-slash" aria-hidden="true"><span class="structure-slash-inner">／</span></span>`
        );
        return;
      }
      const role = t.role || "neutral";
      const kindLabel = structureRoleLabel(role);
      chunks.push(
        `<span class="structure-part structure-part-${role}">` +
          (kindLabel ? `<span class="structure-part-label">${kindLabel}</span>` : "") +
          `<span class="structure-part-text">${esc(t.text || "")}</span>` +
          `</span>`
      );
    });
    return chunks.join("");
  }

  function structureFormulaHtml(structure) {
    const parsed =
      typeof RulesService.parseStructureBranches === "function"
        ? RulesService.parseStructureBranches(structure)
        : { branches: [] };
    const branches = (parsed.branches || []).filter((b) => b.tokens && b.tokens.length);
    if (!branches.length) return "";

    const multi = branches.length > 1;
    const hasArrow = branches.some((b) => b.tokens.some((t) => t.op === "arrow"));

    function wrapBranch(b) {
      return `<span class="structure-branch">${structureTokensToChunks(b.tokens)}</span>`;
    }

    const trackHtml = multi
      ? branches
          .map((b, i) => {
            const branch = wrapBranch(b);
            if (i === 0) return branch;
            return (
              `<span class="structure-slash" aria-hidden="true"><span class="structure-slash-inner">／</span></span>` +
              branch
            );
          })
          .join("")
      : wrapBranch(branches[0]);

    const mods = [
      hasArrow ? "structure-formula-contract" : "",
      multi ? "structure-formula-alts" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      `<div class="structure-formula${mods ? " " + mods : ""}" role="img" aria-label="${esc(structure)}">` +
      `<div class="structure-formula-track">${trackHtml}</div>` +
      `</div>`
    );
  }

  /**
   * 三格變化指示：一段／五段／サ変 各自一段文字，不做韓語式結構可視化。
   */
  function conjugationFormulaHtml(conj, opts = {}) {
    const { highlightGroup = "", preview = false, emptyHint = "" } = opts;
    const slots = RulesService.CONJ_SLOTS || [];
    const cells = slots
      .map(({ key, label, short }) => {
        const val = (conj?.[key] || "").trim();
        if (!val && !preview) return null;
        const hit =
          highlightGroup &&
          ((highlightGroup === "一段" && key === "ichidan") ||
            (highlightGroup === "五段" && key === "godan") ||
            (highlightGroup === "サ変" && key === "sahen"));
        return { key, label, short: short || label, val, hit };
      })
      .filter(Boolean);

    if (!cells.length) {
      if (!emptyHint) return "";
      return `<div class="conj-table"><p class="structure-empty-hint">${esc(emptyHint)}</p></div>`;
    }

    const aria = cells
      .map((g) => `${g.short} ${g.val}`.trim())
      .filter(Boolean)
      .join(" ／ ");

    return (
      `<div class="conj-table" role="group" aria-label="${esc(aria || "動詞變化指示（三格）")}">` +
      cells
        .map((g) => {
          const empty = g.val ? "" : " empty-slot";
          const hit = g.hit ? " hit" : "";
          return (
            `<div class="conj-table-cell conj-${esc(g.key)}${empty}${hit}">` +
            `<span class="conj-key">${esc(g.short)}</span>` +
            `<span class="conj-val${g.val ? "" : " empty"}">${g.val ? esc(g.val) : "—"}</span>` +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    );
  }

  function renderConjugationPanel(rule, highlightGroup = "") {
    if (!rule?.requiresConjugation && !RulesService.hasConjugationContent(rule?.conjugation)) {
      return "";
    }
    const conj = rule.conjugation || RulesService.emptyConjugation();
    if (!RulesService.hasConjugationContent(conj)) return "";
    const formula = conjugationFormulaHtml(conj, { highlightGroup });
    if (!formula) return "";
    return `
      <div class="field-block conj-display">
        <h4>動詞變化指示</h4>
        ${formula}
      </div>`;
  }

  function renderRuleCard(rule, opts = {}) {
    const {
      highlightForm = "",
      badge = null,
      compact = false,
      colorIndex = null,
      matchedWords = [],
      highlightGroup = "",
      mode = "notebook",
      /** lookup：false=未定位→手動定位；true=重新定位；null=不顯示定位鈕 */
      hasSpan = null,
    } = opts;

    const isLookup = mode === "lookup";
    const isSupp =
      (typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(rule)) ||
      colorIndex === "usage";
    const tint =
      !isSupp &&
      colorIndex != null &&
      colorIndex !== "missing" &&
      colorIndex !== "usage" &&
      Number.isFinite(Number(colorIndex))
        ? Number(colorIndex) % 8
        : null;
    const tintClass = isSupp
      ? " rule-card-usage"
      : tint != null
        ? ` rule-card-tint-${tint}`
        : "";
    // 左側色條（與句中 mark／圖例同色）；補充用法用固定琥珀
    const colorEdge = isSupp
      ? `<span class="rule-card-color-edge gram-hl-usage" aria-hidden="true" title="補充用法（不句中上色）"></span>`
      : tint != null
        ? `<span class="rule-card-color-edge gram-hl-${tint}" aria-hidden="true" title="句中第 ${
            tint + 1
          } 色"></span>`
        : "";

    const catBadge = rule.category
      ? `<span class="badge ${
          isSupp ? "badge-usage" : "badge-category"
        }">${esc(rule.category)}</span>`
      : "";
    const effectiveHasSpan = isSupp ? null : hasSpan;

    const conjBadge =
      rule.requiresConjugation || RulesService.hasConjugationContent(rule.conjugation)
        ? `<span class="badge badge-conj">三格</span>`
        : "";

    const unlocatedBadge =
      isLookup && effectiveHasSpan === false
        ? `<span class="badge badge-api-fallback">句中未定位</span>`
        : "";

    // 查詢頁不顯示「已收錄／本句」標籤（左側色條已表示對應）
    const badgesHtml = [
      isLookup ? "" : badge ? `<span class="badge badge-local">${esc(badge)}</span>` : "",
      catBadge,
      conjBadge,
      unlocatedBadge,
    ]
      .filter(Boolean)
      .join("");

    const locateBtn =
      isLookup && effectiveHasSpan !== null
        ? effectiveHasSpan === false
          ? `<button type="button" class="btn btn-sm btn-primary" data-locate-rule="${esc(
              rule.id
            )}" title="在句中選取片段，為此規則上色">手動定位</button>`
          : `<button type="button" class="btn btn-sm btn-secondary" data-locate-rule="${esc(
              rule.id
            )}" title="重新指定句中片段（可疊加位置）">重新定位</button>`
        : "";

    if (compact) {
      return `
        <article class="rule-card compact${tintClass}" data-id="${esc(rule.id)}" id="rule-${esc(rule.id)}">
          ${colorEdge}
          <div class="rule-card-top">
            <h4>${esc(rule.title)}</h4>
            ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
          </div>
          <div class="rule-card-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-action="view">查看</button>
            <button type="button" class="btn btn-sm btn-ghost" data-action="edit">編輯</button>
            ${locateBtn}
            ${
              isLookup
                ? `<button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
                    rule.id
                  )}" title="從本句結果移除，不刪除筆記本規則">本句移除</button>`
                : ""
            }
          </div>
        </article>`;
    }

    const hitNotes = matchedWords.length
      ? matchedWords.join(" · ")
      : highlightForm
        ? highlightForm
        : "";

    const colorKey =
      isLookup && (tint != null || isSupp || effectiveHasSpan === false)
        ? `<div class="match-color-key">
            <span class="legend-swatch gram-hl ${
              isSupp ? "gram-hl-usage" : tint != null ? `gram-hl-${tint}` : ""
            }"></span>
            <span class="muted match-color-label">${
              isSupp
                ? "補充用法 · 不句中上色"
                : effectiveHasSpan === false
                  ? "句中未定位 — 用下方「手動定位」"
                  : `句中第 ${tint != null ? tint + 1 : "—"} 色`
            }</span>
          </div>`
        : "";

    const hitLine =
      hitNotes && effectiveHasSpan !== false
        ? `<p class="muted match-hit-notes">命中：${esc(hitNotes)}</p>`
        : "";

    const actions = isLookup
      ? `<button type="button" class="btn btn-sm btn-ghost" data-action="edit">編輯</button>
          ${locateBtn}
          <button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
            rule.id
          )}" title="從本句結果移除高亮與規則卡，不刪除筆記本中的規則">本句移除</button>`
      : `<button type="button" class="btn btn-sm btn-ghost" data-action="edit">編輯</button>
          <button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete">刪除</button>`;

    return `
      <article class="rule-card${tintClass}" data-id="${esc(rule.id)}" id="rule-${esc(rule.id)}">
        ${colorEdge}
        <div class="rule-card-top">
          <h3>${esc(rule.title)}</h3>
          ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
        </div>
        ${renderConjugationPanel(rule, highlightGroup)}
        ${
          rule.explanation
            ? `<div class="field-block"><h4>說明</h4><p class="explanation-text">${esc(rule.explanation)}</p></div>`
            : ""
        }
        ${colorKey}
        ${hitLine}
        <div class="rule-card-actions">
          ${actions}
        </div>
      </article>`;
  }

  function bindRuleCardActions(root) {
    $$(".rule-card", root).forEach((card) => {
      card.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const id = card.dataset.id;
        const action = btn.dataset.action;
        if (action === "view") {
          goToRuleInNotebook(id);
        } else if (action === "edit") {
          openForm({ mode: "edit", id });
        } else if (action === "delete") {
          if (confirm("確定刪除此規則？")) {
            RulesService.remove(id);
            showToast("已刪除規則", "success");
            updateRuleCount();
            if (state.view === "rules") renderRulesList();
            // 查詢頁一律用目前盤點畫面重畫，不可走舊版本地搜尋 UI
            if (state.lastQuery && state.lastInventory) {
              restoreLookupFromCache({ persist: true });
            }
          }
        }
      });
    });
  }

  function renderRulesList() {
    const q = $("#rules-filter")?.value || "";
    const list = RulesService.filterList(q);
    const box = $("#rules-list");
    $("#rules-count").textContent = `${list.length} 筆規則`;
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>尚無規則，點「新增規則」或到設定「重設種子」。</p></div>`;
      return;
    }
    box.innerHTML = `<div class="match-list">${list.map((r) => renderRuleCard(r, { badge: "筆記本" })).join("")}</div>`;
    bindRuleCardActions(box);
  }

  function openForm({ mode, id = null, draft = null, source = "manual", queryForm = "", todoId = null } = {}) {
    if (state.aiBusy && state.aiJob?.status === "running") {
      const go = confirm(
        `AI 正在為「${state.aiJob.title}」填寫中。\n` +
          `開新表單可能造成混淆。仍要開啟嗎？\n（背景 AI 結果仍會寫回原草稿）`
      );
      if (!go) {
        setAiJobBar("running", `AI 填寫中：${state.aiJob.title}`);
        return;
      }
    }
    if (state.view && state.view !== "form") {
      state.formReturnView = state.view;
    }
    state.formSource = source;
    state.editingId = mode === "edit" ? id : null;
    state.todoSourceId = todoId || draft?.todoId || null;
    let data;
    if (mode === "edit" && id) {
      data = RulesService.getById(id);
      if (!data) {
        showToast("找不到要編輯的規則", "error");
        return;
      }
    } else {
      data = draft || emptyDraft();
    }
    state.draft = data;
    fillForm(data, { mode, queryForm, source });
    setView("form");
    $("#form-title")?.focus();
  }

  function emptyDraft() {
    return {
      title: "",
      category: "",
      explanation: "",
      requiresConjugation: false,
      conjugation: RulesService.emptyConjugation(),
    };
  }

  function todoKey(title) {
    return String(title || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  function clearTodosAfterRuleSaved(ruleTitle) {
    let todos = Storage.loadTodos();
    const before = todos.length;
    const sourceId = state.todoSourceId;
    const key = todoKey(ruleTitle);
    todos = todos.filter((t) => {
      if (sourceId && t.id === sourceId) return false;
      if (key && todoKey(t.formName || t.title || t.form) === key) return false;
      if (key && todoKey(t.form) === key) return false;
      return true;
    });
    state.todoSourceId = null;
    if (todos.length !== before) {
      Storage.saveTodos(todos);
      return before - todos.length;
    }
    return 0;
  }

  function goToRuleInNotebook(ruleId) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    if (!rule) {
      showToast("找不到對應規則卡", "error");
      return;
    }
    setView("rules");
    const filter = $("#rules-filter");
    if (filter) filter.value = "";
    renderRulesList();
    const highlight = () => {
      const el = document.getElementById("rule-" + id);
      if (!el) {
        if (filter) {
          filter.value = rule.title;
          renderRulesList();
        }
        const el2 = document.getElementById("rule-" + id);
        if (!el2) {
          showToast("規則列表中找不到該卡，改為開啟編輯", "info");
          openForm({ mode: "edit", id });
          return;
        }
        el2.scrollIntoView({ behavior: "smooth", block: "center" });
        el2.classList.add("rule-card-flash");
        setTimeout(() => el2.classList.remove("rule-card-flash"), 1400);
        showToast(`已定位：${rule.title}`, "success");
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("rule-card-flash");
      setTimeout(() => el.classList.remove("rule-card-flash"), 1400);
      showToast(`已定位：${rule.title}`, "success");
    };
    requestAnimationFrame(() => requestAnimationFrame(highlight));
  }

  function toggleConjugationBlock(show) {
    const block = $("#form-conjugation-block");
    const cb = $("#form-requires-conjugation");
    if (cb) cb.checked = Boolean(show);
    if (block) block.classList.toggle("hidden", !show);
  }

  function setConjugationFields(data) {
    const requires = Boolean(
      data?.requiresConjugation || RulesService.hasConjugationContent(data?.conjugation)
    );
    toggleConjugationBlock(requires);
    const c = data?.conjugation || RulesService.emptyConjugation();
    const ich = $("#form-conj-ichidan");
    const go = $("#form-conj-godan");
    const sa = $("#form-conj-sahen");
    if (ich) ich.value = c.ichidan || "";
    if (go) go.value = c.godan || "";
    if (sa) sa.value = c.sahen || "";
  }

  function readConjugationFields() {
    return {
      ichidan: $("#form-conj-ichidan")?.value?.trim() || "",
      godan: $("#form-conj-godan")?.value?.trim() || "",
      sahen: $("#form-conj-sahen")?.value?.trim() || "",
    };
  }

  function fillForm(data, meta = {}) {
    $("#form-heading").textContent = state.editingId ? "編輯規則" : "新增規則";
    const fromSel = meta.source === "from-selection";
    const fromLookup = meta.source === "from-lookup";
    const fromSupp = meta.source === "from-supplementary";
    $("#form-sub").textContent =
      fromSel || fromLookup || fromSupp
        ? "已帶入規則名；其餘欄位可留空後儲存，或用「AI 自動填寫」補齊"
        : "規則名、分類、詳細說明；需動詞變化時填三格";

    const banner = $("#form-prefill-banner");
    if (fromSupp) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>建立補充用法</strong> — 分類已設為「補充用法」。儲存後會<strong>加入本句</strong>（琥珀標、不句中上色）。`;
    } else if (fromSel) {
      const span = String(state.pendingSelApply?.text || data.title || "").trim();
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>由選字建立</strong> — 已將選取「${esc(
        span
      )}」寫入規則名（可修改）。儲存後會<strong>自動套用到該片段</strong>；說明／三格可之後再補或按 AI 自動填寫。`;
    } else if (fromLookup) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>由 API 盤點建立</strong> — 只需確認規則名即可儲存；說明／三格可之後再補或按 AI 自動填寫。`;
    } else {
      banner.classList.add("hidden");
      banner.innerHTML = "";
    }

    $("#form-title").value = data.title || "";
    fillCategorySelect(data.category || "");
    $("#form-explanation").value = data.explanation || "";
    setConjugationFields(data);
  }

  /** 選字套用／+補充：建立新規則表單 */
  function openCreateRuleFromSelection() {
    if (state.rulePickMode === "supplementary") {
      if (!state.lastQuery) {
        showToast("請先完成一次查詢", "info");
        return;
      }
      ensureLookupInventoryShell();
      state.pendingSupplementaryApply = true;
      state.pendingSelApply = null;
      closeRulePickModal();
      openForm({
        mode: "create",
        draft: {
          title: "",
          category: RulesService.SUPPLEMENTARY_CATEGORY || "補充用法",
          explanation: "",
          requiresConjugation: false,
          conjugation: RulesService.emptyConjugation(),
        },
        source: "from-supplementary",
        queryForm: state.lastQuery || "",
      });
      return;
    }
    const cap = state.selApply;
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    state.pendingSelApply = {
      text,
      start: Number.isFinite(cap.start) ? cap.start : -1,
      end: Number.isFinite(cap.end) ? cap.end : -1,
    };
    closeRulePickModal();
    hideSelApplyPop();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    openForm({
      mode: "create",
      draft: {
        title: text,
        category: "",
        explanation: "",
        requiresConjugation: false,
        conjugation: RulesService.emptyConjugation(),
      },
      source: "from-selection",
      queryForm: state.lastQuery || "",
    });
  }

  /** API 盤點「建立規則」：只帶規則名（與 Mal 相同） */
  function openFormFromInventoryName(name, query) {
    openForm({
      mode: "create",
      draft: {
        title: String(name || "").trim(),
        category: "",
        explanation: "",
        requiresConjugation: false,
        conjugation: RulesService.emptyConjugation(),
      },
      source: "from-lookup",
      queryForm: query || "",
    });
  }

  function readForm() {
    const requires = Boolean($("#form-requires-conjugation")?.checked);
    return {
      title: $("#form-title").value,
      category: $("#form-category")?.value || "",
      explanation: $("#form-explanation").value,
      requiresConjugation: requires,
      conjugation: requires ? readConjugationFields() : RulesService.emptyConjugation(),
    };
  }

  function saveForm(e) {
    e?.preventDefault();
    const input = readForm();
    if (!input.title.trim()) {
      showToast("請填寫規則名稱", "error");
      $("#form-title").focus();
      return;
    }
    try {
      const wasEdit = Boolean(state.editingId);
      const pending = state.pendingSelApply;
      const pendingSupp = state.pendingSupplementaryApply;
      // 從「+補充」建立時，分類必須維持補充用法（避免 AI 填寫改成一般規則）
      if (!wasEdit && pendingSupp) {
        input.category = RulesService.SUPPLEMENTARY_CATEGORY || "補充用法";
      }
      let saved;
      if (state.editingId) {
        saved = RulesService.update(state.editingId, input);
      } else {
        saved = RulesService.create(input);
      }
      const cleared = clearTodosAfterRuleSaved(saved?.title || input.title);
      state.editingId = null;
      state.draft = null;
      state.formSource = null;
      state.pendingSelApply = null;
      state.pendingSupplementaryApply = false;
      if (state.aiJob && state.aiJob.status !== "running") {
        setAiJobBar("hidden");
        state.aiJob = null;
      }
      updateRuleCount();

      // 選字建立：儲存後直接套用到選定片段
      if (!wasEdit && pending && saved && state.lastInventory) {
        setView("lookup");
        addRuleToCurrentResult(
          saved,
          pending.text,
          pending.start,
          pending.end
        );
        const extra = cleared ? ` · 已清 ${cleared} 筆待辦` : "";
        showToast(`規則已建立並套用到「${pending.text}」${extra}`, "success");
        return;
      }

      if (!wasEdit && pendingSupp && saved && state.lastQuery) {
        setView("lookup");
        addSupplementaryRuleToCurrent(saved);
        const extra = cleared ? ` · 已清 ${cleared} 筆待辦` : "";
        showToast(`補充用法已建立並加入本句${extra}`, "success");
        return;
      }

      // 從查詢建卡／有上次結果：回查詢頁，用快照重畫（新規則會變「已收錄」），不再呼叫 API
      if (state.lastQuery && state.lastInventory) {
        setView("lookup");
        restoreLookupFromCache({ persist: true });
        const base = wasEdit ? "規則已更新" : "規則已建立";
        const extra = cleared ? ` · 已清 ${cleared} 筆待辦` : "";
        showToast(`${base}，已回到查詢結果（未重新查詢）${extra}`, "success");
      } else {
        setView("rules");
        showToast(
          wasEdit
            ? "規則已更新"
            : cleared
              ? `規則已建立 · 已清 ${cleared} 筆待辦`
              : "規則已建立",
          "success"
        );
      }
    } catch (err) {
      showToast(err.message || "儲存失敗", "error");
    }
  }

  function renderTodos() {
    const allTodos = Storage.loadTodos();
    const todos = allTodos.filter((t) => !t.done);
    if (todos.length !== allTodos.length) Storage.saveTodos(todos);
    const box = $("#todos-list");
    if (!todos.length) {
      box.innerHTML = `<div class="empty-state"><p>待辦清單是空的。<br/>在 API 查詢中把「尚未收錄」的文法加入即可。</p></div>`;
      return;
    }
    box.innerHTML = `
      <ul class="todo-list">
        ${todos
          .map(
            (t) => `
          <li class="todo-item" data-id="${esc(t.id)}">
            <label>
              <input type="checkbox" data-action="toggle" />
              <span><strong>${esc(t.formName || t.form || t.title || "未命名")}</strong>
                <span class="muted">${esc(t.note || "")}</span>
                ${t.form ? `<br/><code>${esc(t.form)}</code>` : ""}</span>
            </label>
            <div class="todo-actions">
              <button type="button" class="btn btn-sm btn-primary" data-action="create">建立規則</button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-action="remove">移除</button>
            </div>
          </li>`
          )
          .join("")}
      </ul>`;
    box.querySelectorAll(".todo-item").forEach((li) => {
      li.addEventListener("click", (e) => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (!action) return;
        const id = li.dataset.id;
        let todos = Storage.loadTodos();
        const item = todos.find((t) => t.id === id);
        if (!item) return;
        if (action === "toggle") {
          // 勾選完成 = 移除
          Storage.saveTodos(todos.filter((t) => t.id !== id));
          renderTodos();
          showToast("已完成並移出待辦", "success");
        } else if (action === "remove") {
          Storage.saveTodos(todos.filter((t) => t.id !== id));
          renderTodos();
        } else if (action === "create") {
          const title = item.formName || item.title || item.form || "";
          // 只帶規則名（其餘可 AI 填或稍後補）
          openForm({
            mode: "create",
            draft: {
              title,
              category: "",
              explanation: "",
              requiresConjugation: false,
              conjugation: RulesService.emptyConjugation(),
              todoId: item.id,
            },
            source: "from-lookup",
            queryForm: item.form || title,
            todoId: item.id,
          });
        }
      });
    });
  }

  /** 解析 inventory 項目對應的本地規則（支援手動指定 manualRuleId） */
  function resolveInventoryRule(it) {
    if (it?.manualRuleId) {
      const r = RulesService.getById(it.manualRuleId);
      if (r) return { owned: true, rule: r, score: 100, manual: true };
    }
    const match = RulesService.findMatchingRule(it);
    return { ...match, manual: false };
  }

  /** 在原文中定位項目；手動指定 start/end 時優先（RulesService 已支援） */
  function locateInventoryItemInText(src, it) {
    if (RulesService.locateApiItemInText) {
      return RulesService.locateApiItemInText(src, it);
    }
    return [];
  }

  function buildApiHighlight(query, inventory) {
    const src = String(query || "");
    const hasSchoolTokens = Array.isArray(inventory?.tokens) && inventory.tokens.length > 0;
    // 學校文法切詞已對齊區間；勿再用 kuromoji 把 て／いる 黏回整段
    if (!hasSchoolTokens && typeof RulesService.enrichInventoryWithAnalyzer === "function") {
      RulesService.enrichInventoryWithAnalyzer(src, inventory);
    }
    const rawItems = inventory?.items || [];
    const narrowed =
      typeof SchoolParse !== "undefined" && SchoolParse.narrowItemToMarker
        ? rawItems.map((it) => SchoolParse.narrowItemToMarker(src, it, inventory?.tokens))
        : rawItems;
    const items =
      typeof SchoolParse !== "undefined" && SchoolParse.filterItemsMissingMarkers
        ? SchoolParse.filterItemsMissingMarkers(src, narrowed)
        : narrowed;
    if (inventory && items !== rawItems) inventory.items = items;
    const spans = [];
    const legend = [];
    let colorIdx = 0;
    const colorByKey = new Map();
    const legendSeen = new Set();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const match = resolveInventoryRule(it);
      const owned = Boolean(match.owned && match.rule);
      const isSupp =
        owned &&
        typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(match.rule);
      const key = owned ? `r:${match.rule.id}` : `m:${it.name}`;
      let color;
      if (isSupp) {
        color = "usage";
      } else if (owned) {
        if (!colorByKey.has(key)) {
          colorByKey.set(key, colorIdx % 8);
          colorIdx += 1;
        }
        color = colorByKey.get(key);
      } else {
        color = "missing";
      }

      const found = isSupp ? [] : locateInventoryItemInText(src, it);
      // 已收錄同一規則只進圖例一次；未收錄依名稱去重
      if (!legendSeen.has(key)) {
        legendSeen.add(key);
        legend.push({
          invIdx: i,
          name: owned ? match.rule.title : it.name,
          owned,
          ruleId: owned ? match.rule.id : "",
          color,
          hasSpan: found.length > 0,
          supplementary: isSupp,
        });
      } else if (found.length) {
        // 補上 hasSpan
        const prev = legend.find((h) =>
          owned ? h.ruleId === match.rule.id : h.name === it.name
        );
        if (prev && !prev.hasSpan) prev.hasSpan = true;
      }

      // 補充用法：不句中上色
      if (isSupp) continue;

      for (const loc of found) {
        spans.push({
          start: loc.start,
          end: loc.end,
          text: loc.text,
          ruleId: owned ? match.rule.id : `missing-${i}`,
          ruleTitle: owned ? match.rule.title : it.name,
          missing: !owned,
          color,
          colorIndex: color === "missing" ? "missing" : color,
          apiName: it.name,
          invIdx: i,
        });
      }
    }

    // 依句中首次出現位置排序（已定位在前）；再依此重編 color 0…，與規則卡／圖例一致
    const firstPos = new Map();
    for (const s of spans) {
      if (s.missing || s.color === "missing" || s.color === "usage") continue;
      const rid = s.ruleId;
      if (!rid) continue;
      const prev = firstPos.get(rid);
      if (prev == null || s.start < prev) firstPos.set(rid, s.start);
    }
    for (const h of legend) {
      if (h.supplementary) continue;
      if (!h.hasSpan && h.ruleId && firstPos.has(h.ruleId)) h.hasSpan = true;
    }
    legend.sort((a, b) => {
      // 補充用法永遠最後
      if (Boolean(a.supplementary) !== Boolean(b.supplementary)) {
        return a.supplementary ? 1 : -1;
      }
      // 已收錄且已定位 → 依句中順序；未定位／未收錄排後
      const aOwned = Boolean(a.owned);
      const bOwned = Boolean(b.owned);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      if (Boolean(a.hasSpan) !== Boolean(b.hasSpan)) return a.hasSpan ? -1 : 1;
      const pa = a.ruleId && firstPos.has(a.ruleId) ? firstPos.get(a.ruleId) : 1e9;
      const pb = b.ruleId && firstPos.has(b.ruleId) ? firstPos.get(b.ruleId) : 1e9;
      if (pa !== pb) return pa - pb;
      return (a.invIdx ?? 0) - (b.invIdx ?? 0);
    });
    const recolor = new Map();
    let ci = 0;
    for (const h of legend) {
      if (!h.owned || !h.ruleId) continue;
      if (h.supplementary || h.color === "usage") {
        h.color = "usage";
        continue;
      }
      if (!recolor.has(h.ruleId)) {
        recolor.set(h.ruleId, ci % 8);
        ci += 1;
      }
      h.color = recolor.get(h.ruleId);
    }
    for (const s of spans) {
      if (s.missing || s.color === "missing" || s.color === "usage") continue;
      if (recolor.has(s.ruleId)) {
        s.color = recolor.get(s.ruleId);
        s.colorIndex = s.color;
      }
    }

    return { spans, legend, firstPos };
  }

  function normVocabKey(s) {
    return String(s || "")
      .trim()
      .normalize("NFC");
  }

  function sliceMatchesVocab(slice, w) {
    const sl = normVocabKey(slice);
    if (!sl) return false;
    const surf = normVocabKey(w.surface);
    const lem = normVocabKey(w.lemma);
    return (surf && sl === surf) || (lem && sl === lem);
  }

  /**
   * 日文幾乎無空白，不能以「無空白」當單詞。
   * 有句讀、助詞、或夠長 → 當句子，逐詞定位。
   */
  function looksLikeJapaneseOrMultiTokenQuery(q) {
    const s = String(q || "").trim();
    if (!s) return false;
    if (/\s/.test(s)) return true;
    if (/[。．.！!？?\n]/.test(s)) return true;
    // 句中助詞／接續常見字（長度夠才信，避免「は」單字）
    if (s.length >= 4 && /[はがをにでとのもへやかも]/.test(s)) return true;
    // 純日文較長 → 多半是句子或短句
    if (s.length >= 8 && /[\u3040-\u30FF\u4E00-\u9FFF]/.test(s)) return true;
    return false;
  }

  /**
   * 將 API vocab 對到原文區間。
   * - 不信任與 surface 不符的 a/b
   * - 真·單詞查詢：整段對到最吻合的一筆
   * - 日文句子（無空白）：逐 surface 定位，禁止整句綁成一詞
   */
  function locateVocabInText(text, vocabList) {
    const src = String(text || "");
    const list = Array.isArray(vocabList) ? vocabList : [];
    if (!src || !list.length) return [];

    const candidates = list
      .map((w) => ({
        surface: String(w.surface || "").trim(),
        reading: String(w.reading || w.yomi || w.kana || "").trim(),
        lemma: String(w.lemma || "").trim(),
        origin: String(w.origin || "").trim(),
        gloss: String(w.gloss || "").trim(),
        pos: String(w.pos || "").trim(),
        start: w.start,
        end: w.end,
      }))
      .filter((w) => w.surface || w.lemma);

    const trimStart = src.search(/\S/);
    const qCore = src.trim();
    const qNorm = normVocabKey(qCore);
    const multiToken = looksLikeJapaneseOrMultiTokenQuery(qCore);

    // 整段與某一 surface/lemma 完全一致 → 真單詞（即使稍長）
    const exactFullHit = candidates.some((w) => {
      const surf = normVocabKey(w.surface);
      const lem = normVocabKey(w.lemma);
      return (surf && surf === qNorm) || (lem && lem === qNorm);
    });

    // 僅非句子、或整段精確對上時才走「整段綁一筆」
    const isSingleWord =
      qCore.length > 0 &&
      !multiToken &&
      (exactFullHit || (candidates.length === 1 && qCore.length <= 10));

    function hitFrom(w, start, end) {
      return {
        start,
        end,
        reading: w.reading || "",
        lemma: w.lemma || "",
        origin: w.origin || "",
        gloss: w.gloss,
        pos: w.pos,
        surface: src.slice(start, end),
      };
    }

    if (isSingleWord && qNorm) {
      let best = null;
      let bestScore = -1;
      for (const w of candidates) {
        const surf = normVocabKey(w.surface);
        const lem = normVocabKey(w.lemma);
        let sc = 0;
        if (surf && surf === qNorm) sc = 100;
        else if (lem && lem === qNorm) sc = 90;
        else if (
          surf &&
          (qNorm.includes(surf) || surf.includes(qNorm)) &&
          Math.min(surf.length, qNorm.length) >= 1
        )
          sc = 50;
        else if (
          lem &&
          (qNorm.includes(lem) || lem.includes(qNorm)) &&
          Math.min(lem.length, qNorm.length) >= 1
        )
          sc = 40;
        if (sc > bestScore) {
          bestScore = sc;
          best = w;
        }
      }
      if (!best && candidates.length === 1) {
        best = candidates[0];
        bestScore = 40;
      }
      if (best && bestScore >= 30) {
        const start = trimStart >= 0 ? trimStart : 0;
        const end = start + qCore.length;
        return [hitFrom(best, start, end)];
      }
    }

    const occupied = [];
    const hits = [];
    // 較長 surface 優先，但過長（幾乎整句）排後，避免一筆吞掉全句
    const ordered = candidates.slice().sort((a, b) => {
      const la = (a.surface || a.lemma || "").length;
      const lb = (b.surface || b.lemma || "").length;
      const aGiant = qCore.length >= 4 && la >= qCore.length * 0.85;
      const bGiant = qCore.length >= 4 && lb >= qCore.length * 0.85;
      if (aGiant !== bGiant) return aGiant ? 1 : -1;
      return lb - la;
    });

    function clashes(start, end) {
      return occupied.some((o) => !(end <= o.start || start >= o.end));
    }

    function findInSrc(needle) {
      if (!needle) return null;
      let from = 0;
      while (from < src.length) {
        const idx = src.indexOf(needle, from);
        if (idx < 0) return null;
        const e = idx + needle.length;
        if (!clashes(idx, e)) return { start: idx, end: e };
        from = idx + Math.max(1, needle.length);
      }
      return null;
    }

    /** 句子模式下拒絕「幾乎整句」的假 surface（多詞時） */
    function isGiantSurface(w) {
      if (!multiToken || candidates.length < 2 || qCore.length < 4) return false;
      const n = normVocabKey(w.surface || w.lemma || "");
      if (!n) return false;
      return n.length >= qCore.length * 0.85 || n === qNorm;
    }

    for (const w of ordered) {
      if (isGiantSurface(w)) continue;

      let start = Number(w.start);
      let end = Number(w.end);
      let placed = false;
      const rangeOk =
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start &&
        end <= src.length;

      // 句子模式：拒絕覆蓋大半句的錯誤座標
      const spanTooBig =
        multiToken &&
        candidates.length >= 2 &&
        rangeOk &&
        end - start >= Math.max(4, Math.floor(qCore.length * 0.85));

      if (
        rangeOk &&
        !spanTooBig &&
        !clashes(start, end) &&
        sliceMatchesVocab(src.slice(start, end), w)
      ) {
        placed = true;
      }

      if (!placed) {
        for (const n of [w.surface, w.lemma].filter(Boolean).sort((a, b) => b.length - a.length)) {
          // 不在原文用「整句 surface」搜尋
          if (
            multiToken &&
            candidates.length >= 2 &&
            n.length >= qCore.length * 0.85
          ) {
            continue;
          }
          const loc = findInSrc(n);
          if (loc) {
            start = loc.start;
            end = loc.end;
            placed = true;
            break;
          }
        }
      }
      if (!placed) continue;
      occupied.push({ start, end });
      hits.push(hitFrom(w, start, end));
    }

    hits.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    return hits;
  }

  /** 有原形就顯示（含與表面相同：辞書形也標出來） */
  function vocabShowsLemma(_pos, lemma) {
    return Boolean(String(lemma || "").trim());
  }

  function fillVocabDisplayFields(v) {
    const surface = String(v?.surface || "").trim();
    let lemma = String(v?.lemma || "").trim() || surface;
    let pos = String(v?.pos || "").trim();
    if (typeof DictService !== "undefined") {
      if (!pos && /^(は|が|を|に|で|と|も|へ|の|から|まで|より|や|か)$/.test(surface)) {
        pos = "助詞";
      }
      if (!pos && /^[\u4E00-\u9FFF]+$/.test(surface)) pos = "名詞";
    } else {
      if (!pos && /^(は|が|を|に|で|と|も|へ|の|から|まで|より|や|か)$/.test(surface)) {
        pos = "助詞";
      }
    }
    return { ...v, surface, lemma, pos };
  }

  /** 外來語：原文（中文）；其餘僅中文義 */
  function formatVocabGlossDisplay(v) {
    if (typeof AiService !== "undefined" && AiService.formatVocabGloss) {
      return AiService.formatVocabGloss(v);
    }
    const origin = String(v?.origin || "").trim();
    const gloss = String(v?.gloss || "").trim();
    if (origin && gloss) {
      if (gloss.startsWith(origin) && /[（(]/.test(gloss)) return gloss;
      return `${origin}（${gloss}）`;
    }
    return origin || gloss;
  }

  /** 單字庫詞性 → 底線色類（動詞淺藍／名詞淺綠／形容詞黃／副詞紅／其他紫） */
  function posUnderlineKind(pos) {
    const p = String(pos || "");
    if (/助動詞|助詞|語尾/.test(p)) return "other";
    if (/形容詞|形容動詞|adjective|\badj\b/i.test(p)) return "adj";
    if (/副詞|adverb/i.test(p)) return "adv";
    if (/動詞|verb/i.test(p)) return "verb";
    if (/名詞|noun/i.test(p)) return "noun";
    return "other";
  }

  const POS_UL_KINDS = ["verb", "noun", "adj", "adv", "other"];
  const POS_UL_LABELS = {
    verb: "動詞",
    noun: "名詞",
    adj: "形容詞",
    adv: "副詞",
    other: "其他",
  };
  const POS_UL_STORAGE_KEY = "jgn_pos_underline_hidden";

  function loadPosUnderlineHidden() {
    try {
      const raw = JSON.parse(localStorage.getItem(POS_UL_STORAGE_KEY) || "{}");
      const out = {};
      for (const k of POS_UL_KINDS) out[k] = Boolean(raw?.[k]);
      return out;
    } catch {
      return { verb: false, noun: false, adj: false, adv: false, other: false };
    }
  }

  function posHideToken(hidden) {
    return POS_UL_KINDS.filter((k) => hidden[k]).join(" ");
  }

  function sentenceBoardPosHideAttr() {
    const v = posHideToken(loadPosUnderlineHidden());
    return v ? ` data-pos-hide="${esc(v)}"` : "";
  }

  function applyPosUnderlineVisibility() {
    const hidden = loadPosUnderlineHidden();
    const board = $("#sentence-board");
    if (board) {
      const v = posHideToken(hidden);
      if (v) board.setAttribute("data-pos-hide", v);
      else board.removeAttribute("data-pos-hide");
    }
    const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
    const allOff = POS_UL_KINDS.every((k) => hidden[k]);
    document.querySelectorAll("[data-pos-toggle]").forEach((btn) => {
      const k = btn.dataset.posToggle;
      if (k === "all") {
        btn.classList.toggle("is-off", allOff);
        btn.classList.toggle("is-mixed", !allOn && !allOff);
        btn.setAttribute("aria-pressed", allOn ? "true" : "false");
        btn.title = allOn ? "關閉全部底線" : "開啟全部底線";
        return;
      }
      const on = !hidden[k];
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = POS_UL_LABELS[k] || "";
      btn.title = `${on ? "隱藏" : "顯示"}${label}底線`;
    });
  }

  function togglePosUnderline(kind) {
    const hidden = loadPosUnderlineHidden();
    if (kind === "all") {
      const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
      const next = {};
      for (const k of POS_UL_KINDS) next[k] = allOn;
      localStorage.setItem(POS_UL_STORAGE_KEY, JSON.stringify(next));
      applyPosUnderlineVisibility();
      return;
    }
    if (!POS_UL_KINDS.includes(kind)) return;
    hidden[kind] = !hidden[kind];
    localStorage.setItem(POS_UL_STORAGE_KEY, JSON.stringify(hidden));
    applyPosUnderlineVisibility();
  }

  function posUnderlineLegendHtml() {
    const hidden = loadPosUnderlineHidden();
    const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
    const allOff = POS_UL_KINDS.every((k) => hidden[k]);
    const allBtn = `<button type="button" class="pos-line-toggle pos-line-toggle-all${
      allOff ? " is-off" : ""
    }${!allOn && !allOff ? " is-mixed" : ""}" data-pos-toggle="all" aria-pressed="${
      allOn ? "true" : "false"
    }" title="${allOn ? "關閉全部底線" : "開啟全部底線"}">全部</button>`;
    const items = POS_UL_KINDS.map((k) => {
      const on = !hidden[k];
      return `<button type="button" class="pos-line-toggle${
        on ? "" : " is-off"
      }" data-pos-toggle="${k}" aria-pressed="${on ? "true" : "false"}" title="${
        on ? "隱藏" : "顯示"
      }${POS_UL_LABELS[k]}底線"><span class="pos-line" data-pos-kind="${k}">${
        POS_UL_LABELS[k]
      }</span></button>`;
    }).join("");
    return `<span class="pos-line-legend" role="group" aria-label="詞性底線，點擊顯示或隱藏">${allBtn}${items}</span>`;
  }

  function wordTipOpenHtml(v) {
    const filled = fillVocabDisplayFields(v);
    const showLemma = vocabShowsLemma(filled.pos, filled.lemma);
    const glossDisp = formatVocabGlossDisplay(filled);
    const alts = Array.isArray(v.bankAlts)
      ? v.bankAlts
          .map((a) => String(a?.gloss || "").trim())
          .filter(Boolean)
          .join(" · ")
      : "";
    const fallbackTitle = [
      filled.reading ? `讀音 ${filled.reading}` : "",
      showLemma && filled.lemma ? `原形 ${filled.lemma}` : "",
      glossDisp ? `意思 ${glossDisp}` : "",
      alts ? `其他義 ${alts}` : "",
      filled.fromBank ? "本地單字庫" : "",
      filled.pos ? `（${filled.pos}）` : "",
      filled.lemma ? "點擊複製並朗讀原形" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<span class="word-tip" tabindex="0" data-lemma="${esc(filled.lemma || "")}" data-reading="${esc(
      filled.reading || ""
    )}" data-origin="${esc(filled.origin || "")}" data-gloss="${esc(filled.gloss || "")}" data-pos="${esc(
      filled.pos || ""
    )}" data-pos-kind="${esc(posUnderlineKind(filled.pos))}" data-surface="${esc(
      filled.surface || ""
    )}" data-alts="${esc(alts)}" data-from-bank="${
      filled.fromBank ? "1" : ""
    }" title="${esc(fallbackTitle)}">`;
  }

  function grammarMarkOpenHtml(s) {
    const tipOf = (h) => h.ruleTitle || h.apiName || "";
    const stack = [
      {
        color: s.color,
        ruleId: s.ruleId,
        ruleTitle: s.ruleTitle,
        missing: s.missing,
      },
      ...(s.coHits || []),
    ].filter((h) => h && h.color !== "usage");
    const owned = stack.filter(
      (h) => !h.missing && h.color !== "missing" && Number.isFinite(Number(h.color))
    );
    const use = owned.length ? owned : stack;
    const first = use[0] || s;
    const multi = use.length > 1 && use.every((h) => Number.isFinite(Number(h.color)));
    const tip = multi
      ? use.map((h, i) => `${i + 1}. ${tipOf(h)}`).join(" ｜ ") + "（顏色輪播）"
      : first.missing
        ? `尚未建立：${tipOf(first)}`
        : tipOf(first);
    const cls =
      first.missing || first.color === "missing"
        ? "gram-hl gram-hl-missing"
        : `gram-hl gram-hl-${first.color ?? 0}${multi ? " gram-hl-cycle" : ""}`;
    const colorsAttr = multi ? ` data-cycle-colors="${use.map((h) => h.color).join(",")}"` : "";
    const titlesAttr = multi
      ? ` data-cycle-titles="${esc(use.map((h) => tipOf(h)).join("\n"))}"`
      : "";
    const scrollAttr =
      !first.missing && first.ruleId
        ? ` data-scroll-rule="${esc(first.ruleId)}" data-rule-id="${esc(first.ruleId)}"`
        : "";
    const cycleIds = multi
      ? ` data-cycle-rule-ids="${use.map((h) => h.ruleId || "").join(",")}"`
      : "";
    return `<mark class="${cls}" title="${esc(tip)}"${colorsAttr}${titlesAttr}${scrollAttr}${cycleIds}>`;
  }

  /** 文法 mark + 詞彙 word-tip 串流渲染 */
  function buildAnnotatedSentenceHtml(query, usedGrammar, vocabLocs) {
    const src = String(query || "");
    const n = src.length;
    if (!n) return "";

    const cuts = new Set([0, n]);
    for (const g of usedGrammar || []) {
      cuts.add(g.start);
      cuts.add(g.end);
    }
    for (const v of vocabLocs || []) {
      cuts.add(v.start);
      cuts.add(v.end);
    }
    const points = [...cuts].filter((p) => p >= 0 && p <= n).sort((a, b) => a - b);

    const atoms = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a >= b) continue;
      const g = (usedGrammar || []).find((x) => x.start <= a && x.end >= b) || null;
      const vCands = (vocabLocs || []).filter((x) => x.start <= a && x.end >= b);
      const v =
        vCands.sort(
          (x, y) => x.end - x.start - (y.end - y.start) || y.start - x.start
        )[0] || null;
      atoms.push({ g, v, text: src.slice(a, b) });
    }

    let html = "";
    let openG = null;
    let openV = null;

    const closeV = () => {
      if (openV) {
        html += "</span>";
        openV = null;
      }
    };
    const closeG = () => {
      closeV();
      if (openG) {
        html += "</mark>";
        openG = null;
      }
    };

    for (const at of atoms) {
      if (at.g !== openG) {
        closeG();
        if (at.g) {
          html += grammarMarkOpenHtml(at.g);
          openG = at.g;
        }
      }
      if (at.v !== openV) {
        closeV();
        if (at.v) {
          html += wordTipOpenHtml(at.v);
          openV = at.v;
        }
      }
      html += esc(at.text);
    }
    closeG();
    return html;
  }

  function stopGramHlCycles() {
    for (const id of state.gramHlCycleTimers || []) {
      clearInterval(id);
    }
    state.gramHlCycleTimers = [];
  }

  function startGramHlCycles(root = document) {
    stopGramHlCycles();
    const marks = (root || document).querySelectorAll("mark.gram-hl-cycle[data-cycle-colors]");
    if (!marks.length) return;
    const reduceMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    marks.forEach((mark) => {
      const colors = String(mark.dataset.cycleColors || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n));
      const titles = String(mark.dataset.cycleTitles || "")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (colors.length < 2) return;
      let i = 0;
      const id = setInterval(() => {
        i = (i + 1) % colors.length;
        mark.className = `gram-hl gram-hl-cycle gram-hl-${colors[i]}`;
        const sole = titles[i] || "";
        const all = titles.map((t, idx) => `${idx + 1}. ${t}`).join(" ｜ ");
        mark.title = sole ? `${sole}（${i + 1}/${colors.length} · ${all}）` : mark.title;
      }, 1100);
      state.gramHlCycleTimers.push(id);
    });
  }

  let wordTipHideTimer = 0;
  let wordTipSelectArmed = false;
  let wordTipAnchor = null;
  let sentenceGesture = { moved: false, x: 0, y: 0 };
  let suppressWordTipClick = false;

  function cancelWordTipHide() {
    if (wordTipHideTimer) {
      clearTimeout(wordTipHideTimer);
      wordTipHideTimer = 0;
    }
  }

  function wordTipPointerOver() {
    const pop = document.getElementById("word-tip-pop");
    if (pop && !pop.classList.contains("hidden") && pop.matches(":hover")) return true;
    return Boolean(document.querySelector(".word-tip:hover"));
  }

  function wordTipHasSelection() {
    const pop = document.getElementById("word-tip-pop");
    if (!pop || pop.classList.contains("hidden")) return false;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    try {
      return sel.getRangeAt(0).intersectsNode(pop);
    } catch {
      return pop.contains(sel.anchorNode) || pop.contains(sel.focusNode);
    }
  }

  function wordTipShouldStay() {
    return wordTipPointerOver() || wordTipHasSelection();
  }

  function onWordTipSelectMouseUp() {
    wordTipSelectArmed = false;
    document.removeEventListener("mouseup", onWordTipSelectMouseUp);
    if (!wordTipShouldStay()) hideWordTipPop();
  }

  /** 框選文字拖出解釋欄時不要立刻關；放開後若已離開再關 */
  function requestHideWordTipPop(e) {
    if (e && e.buttons) {
      if (!wordTipSelectArmed) {
        wordTipSelectArmed = true;
        document.addEventListener("mouseup", onWordTipSelectMouseUp);
      }
      return;
    }
    cancelWordTipHide();
    wordTipHideTimer = window.setTimeout(() => {
      wordTipHideTimer = 0;
      if (!wordTipShouldStay()) hideWordTipPop();
    }, 180);
  }

  function bindWordTipOutsideDismiss() {
    if (bindWordTipOutsideDismiss.done) return;
    bindWordTipOutsideDismiss.done = true;
    document.addEventListener("pointerdown", (e) => {
      const pop = document.getElementById("word-tip-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".word-tip")) return;
      hideWordTipPop();
    });
  }

  function appendWordTipCopyAction(pop, data) {
    if (!pop || !isCoarsePointer()) return;
    const lemma = String(data?.lemma || "").trim();
    if (!lemma) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm word-tip-copy-btn";
    btn.textContent = "複製並朗讀";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const speak =
        String(data.reading || data.surface || lemma).trim() || lemma;
      copyLemmaToClipboard(lemma, { speak });
    });
    pop.appendChild(btn);
  }

  function ensureWordTipPop() {
    let el = document.getElementById("word-tip-pop");
    if (el) return el;
    el = document.createElement("div");
    el.id = "word-tip-pop";
    el.className = "word-tip-pop hidden";
    el.setAttribute("role", "tooltip");
    el.addEventListener("mouseenter", () => {
      if (!isCoarsePointer()) cancelWordTipHide();
    });
    el.addEventListener("mouseleave", (e) => {
      if (!isCoarsePointer()) requestHideWordTipPop(e);
    });
    document.body.appendChild(el);
    bindWordTipOutsideDismiss();
    return el;
  }

  function hideWordTipPop() {
    cancelWordTipHide();
    wordTipAnchor = null;
    if (wordTipSelectArmed) {
      wordTipSelectArmed = false;
      document.removeEventListener("mouseup", onWordTipSelectMouseUp);
    }
    const el = document.getElementById("word-tip-pop");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
  }

  function showWordTipPop(anchor, data) {
    if (isSentenceSelectEdit()) return;
    cancelWordTipHide();
    const pop = ensureWordTipPop();
    const filled = fillVocabDisplayFields(data);
    const lemma = filled.lemma || "";
    const reading = data.reading || "";
    const origin = data.origin || "";
    const gloss = data.gloss || "";
    const pos = filled.pos || "";
    const surface = filled.surface || "";
    const alts = data.alts || "";
    const fromBank = Boolean(data.fromBank);
    const showLemma = vocabShowsLemma(pos, lemma, surface);
    const glossDisp = formatVocabGlossDisplay({ origin, gloss });
    pop.innerHTML = `
      <div class="word-tip-row word-tip-surface">${esc(surface || "—")}${
        fromBank ? `<span class="word-tip-badge">本地</span>` : ""
      }</div>
      ${
        reading
          ? `<div class="word-tip-row"><span class="word-tip-k">讀音</span><span class="word-tip-v word-tip-reading">${esc(
              reading
            )}</span></div>`
          : ""
      }
      <div class="word-tip-row"><span class="word-tip-k">原形</span><span class="word-tip-v">${esc(
        lemma || "—"
      )}</span></div>
      ${
        origin
          ? `<div class="word-tip-row"><span class="word-tip-k">原文</span><span class="word-tip-v word-tip-origin">${esc(
              origin
            )}</span></div>`
          : ""
      }
      <div class="word-tip-row"><span class="word-tip-k">意思</span><span class="word-tip-v">${esc(
        glossDisp || "—"
      )}</span></div>
      ${
        alts
          ? `<div class="word-tip-row"><span class="word-tip-k">其他義</span><span class="word-tip-v word-tip-alts">${esc(
              alts
            )}</span></div>`
          : ""
      }
      <div class="word-tip-row"><span class="word-tip-k">詞性</span><span class="word-tip-v">${esc(
        pos || "—"
      )}</span></div>`;
    pop.innerHTML = wrapWordTipPopHtml(pop.innerHTML);
    finalizeWordTipPop(pop, anchor, { lemma, reading, surface });
  }

  const LOOKUP_TTS_LANG = "ja-JP";
  const TTS_API_LANG = "ja";
  let ttsVoices = [];
  let ttsAudio = null;
  let ttsToken = 0;
  const ttsCache = new Map();
  const TTS_CACHE_MAX = 40;
  let apiTtsWarned = false;

  function refreshTtsVoices() {
    if (!window.speechSynthesis) return;
    ttsVoices = speechSynthesis.getVoices() || [];
  }

  function pickTtsVoice(lang) {
    if (!window.speechSynthesis) return null;
    const want = String(lang || LOOKUP_TTS_LANG).toLowerCase().replace(/_/g, "-");
    const prefix = want.slice(0, 2);
    const list = ttsVoices.length ? ttsVoices : speechSynthesis.getVoices() || [];
    return (
      list.find((v) => String(v.lang || "").toLowerCase().replace(/_/g, "-") === want) ||
      list.find((v) => String(v.lang || "").toLowerCase().startsWith(prefix)) ||
      null
    );
  }

  function stopLookupSpeech() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    if (ttsAudio) {
      try {
        ttsAudio.pause();
      } catch {
        /* ignore */
      }
      ttsAudio = null;
    }
  }

  function speakViaBrowser(text, lang = LOOKUP_TTS_LANG) {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.92;
      const voice = pickTtsVoice(lang);
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (err) {
      console.warn("[tts]", err);
    }
  }

  function normalizeTtsBaseUrl(url) {
    let base = String(url || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\/api\.x\.ai$/i.test(base)) base = "https://api.x.ai/v1";
    return base;
  }

  function pcmToWavBlob(pcmBytes, sampleRate = 24000) {
    const pcm = pcmBytes instanceof Uint8Array ? pcmBytes : new Uint8Array(pcmBytes);
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + pcm.length, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, pcm.length, true);
    const out = new Uint8Array(44 + pcm.length);
    out.set(new Uint8Array(header), 0);
    out.set(pcm, 44);
    return new Blob([out], { type: "audio/wav" });
  }

  function grokTtsCandidate(s, profiles) {
    const grokProv =
      typeof Storage.getApiProvider === "function" ? Storage.getApiProvider("grok") : null;
    const grok = profiles.grok && typeof profiles.grok === "object" ? profiles.grok : {};
    const pid = String(s.apiProvider || "").trim();
    let apiKey = String(grok.apiKey || "").trim();
    let baseUrl = normalizeTtsBaseUrl(grok.baseUrl || grokProv?.baseUrl || "https://api.x.ai/v1");
    if (pid === "grok" || /x\.ai/i.test(String(s.baseUrl || ""))) {
      if (!apiKey) apiKey = String(s.apiKey || "").trim();
      if (s.baseUrl) baseUrl = normalizeTtsBaseUrl(s.baseUrl);
    }
    if (!apiKey) return null;
    return { kind: "grok", id: "grok", label: "Grok", apiKey, baseUrl };
  }

  function googleTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const google = profiles.google && typeof profiles.google === "object" ? profiles.google : {};
    const apiKey = String(
      google.apiKey || (pid === "google" || /generativelanguage\.googleapis/.test(String(s.baseUrl || ""))
        ? s.apiKey
        : "")
    ).trim();
    if (!apiKey) return null;
    return { kind: "google", id: "google", label: "Google", apiKey };
  }

  function customTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const custom = profiles.custom && typeof profiles.custom === "object" ? profiles.custom : {};
    const apiKey = String(pid === "custom" ? s.apiKey || custom.apiKey : custom.apiKey || "").trim();
    const baseUrl = normalizeTtsBaseUrl(pid === "custom" ? s.baseUrl || custom.baseUrl : custom.baseUrl);
    if (!apiKey || !baseUrl) return null;
    return { kind: "openai", id: "custom", label: "自訂", apiKey, baseUrl };
  }

  function currentTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const url = String(s.baseUrl || "").toLowerCase();
    if (pid === "google" || /generativelanguage\.googleapis/.test(url)) return googleTtsCandidate(s, profiles);
    if (pid === "deepseek" || /deepseek\.com/.test(url)) return null;
    if (pid === "custom") return customTtsCandidate(s, profiles);
    return grokTtsCandidate(s, profiles);
  }

  function resolveTtsProvider() {
    const s = Storage.loadSettings();
    const profiles = s.apiProfiles && typeof s.apiProfiles === "object" ? s.apiProfiles : {};
    const current = currentTtsCandidate(s, profiles);
    if (current && current.apiKey) return { ...current, fallback: false };
    const alts = [
      grokTtsCandidate(s, profiles),
      googleTtsCandidate(s, profiles),
      customTtsCandidate(s, profiles),
    ].filter((p) => p && p.apiKey && (!current || p.id !== current.id));
    if (alts[0]) return { ...alts[0], fallback: true };
    if (current) return { ...current, fallback: false };
    return { kind: "none", id: String(s.apiProvider || ""), label: "目前服務", apiKey: "" };
  }

  function putTtsCache(key, url) {
    if (ttsCache.has(key)) {
      const old = ttsCache.get(key);
      if (old && old !== url) URL.revokeObjectURL(old);
      ttsCache.delete(key);
    }
    ttsCache.set(key, url);
    while (ttsCache.size > TTS_CACHE_MAX) {
      const first = ttsCache.keys().next().value;
      const u = ttsCache.get(first);
      if (u) URL.revokeObjectURL(u);
      ttsCache.delete(first);
    }
  }

  async function fetchGrokTts(p, text) {
    const res = await fetch(`${p.baseUrl}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        text,
        voice_id: "eve",
        language: TTS_API_LANG,
        output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
      }),
    });
    if (!res.ok) {
      const detail = String(await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`Grok TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) throw new Error("TTS 回傳空白音訊");
    return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  }

  async function fetchGoogleTts(p, text) {
    const models = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];
    let lastErr = null;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        p.apiKey
      )}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              languageCode: LOOKUP_TTS_LANG,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      });
      if (res.status === 404) {
        lastErr = new Error(`找不到 Gemini TTS 模型 ${model}`);
        continue;
      }
      if (!res.ok) {
        const detail = String(await res.text().catch(() => "")).slice(0, 180);
        throw new Error(`Google TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
      }
      const json = await res.json();
      const part = json?.candidates?.[0]?.content?.parts?.find((x) => x?.inlineData?.data);
      const b64 = part?.inlineData?.data;
      if (!b64) throw new Error("Google TTS 未回傳音訊");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = String(part.inlineData.mimeType || "");
      const rateMatch = mime.match(/rate=(\d+)/i);
      const rate = rateMatch ? Number(rateMatch[1]) : 24000;
      if (/mpeg|mp3/i.test(mime)) {
        return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      }
      return URL.createObjectURL(pcmToWavBlob(bytes, rate || 24000));
    }
    throw lastErr || new Error("Google TTS 失敗");
  }

  async function fetchOpenAiTts(p, text) {
    if (!p.baseUrl) throw new Error("自訂端點未填 Base URL");
    const res = await fetch(`${p.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "alloy",
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const detail = String(await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`自訂 TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) throw new Error("TTS 回傳空白音訊");
    return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  }

  async function speakViaApi(text) {
    const p = resolveTtsProvider();
    if (p.kind === "none" || !p.apiKey) throw new Error(p.kind === "none" ? "NO_TTS_PROVIDER" : "NO_TTS_KEY");
    if (p.fallback && !apiTtsWarned) {
      apiTtsWarned = true;
      showToast(`目前服務沒有語音，改用 ${p.label}`, "info");
    }
    const cacheKey = `${p.kind}|${text}|${LOOKUP_TTS_LANG}`;
    let objectUrl = ttsCache.get(cacheKey);
    const myToken = ++ttsToken;
    if (!objectUrl) {
      if (p.kind === "google") objectUrl = await fetchGoogleTts(p, text);
      else if (p.kind === "openai") objectUrl = await fetchOpenAiTts(p, text);
      else objectUrl = await fetchGrokTts(p, text);
      putTtsCache(cacheKey, objectUrl);
    }
    if (myToken !== ttsToken) return;
    stopLookupSpeech();
    const audio = new Audio(objectUrl);
    ttsAudio = audio;
    await audio.play();
  }

  function speakLookupText(text, lang = LOOKUP_TTS_LANG) {
    const t = String(text || "").trim();
    if (!t) return;
    const useApi = Boolean(Storage.loadSettings().apiTtsEnabled);
    if (!useApi) {
      stopLookupSpeech();
      speakViaBrowser(t, lang);
      return;
    }
    speakViaApi(t).catch((err) => {
      console.warn("[tts-api]", err);
      const code = err && err.message;
      if (!apiTtsWarned && (code === "NO_TTS_KEY" || code === "NO_TTS_PROVIDER")) {
        apiTtsWarned = true;
        showToast("沒有可用的語音 API Key（Grok／Google／自訂），已改用系統語音", "warn");
      } else if (code !== "NO_TTS_KEY" && code !== "NO_TTS_PROVIDER") {
        showToast("API 語音失敗，改用系統語音", "warn");
      }
      speakViaBrowser(t, lang);
    });
  }

  function syncApiTtsSwitch(settings) {
    const el = $("#settings-api-tts");
    if (el) el.checked = Boolean((settings || Storage.loadSettings()).apiTtsEnabled);
  }

  function onApiTtsToggle() {
    const on = Boolean($("#settings-api-tts")?.checked);
    Storage.saveSettings({ apiTtsEnabled: on });
    apiTtsWarned = false;
    if (!on) {
      showToast("朗讀改用系統語音", "info");
      return;
    }
    const p = resolveTtsProvider();
    if (p.kind === "none" || !p.apiKey) {
      showToast("沒有可用的語音 API Key（Grok／Google／自訂），朗讀仍用系統語音", "warn");
    } else if (p.fallback) {
      showToast(`目前服務沒有語音，改用 ${p.label} 朗讀`, "info");
    } else {
      showToast(`朗讀改用 ${p.label} API 語音`, "info");
    }
  }

  if (typeof window !== "undefined" && window.speechSynthesis) {
    refreshTtsVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshTtsVoices);
  }

  function isSentenceSelectEdit() {
    return Boolean(state.sentenceSelectEdit) && isCoarsePointer();
  }

  function syncSentenceSelectEditUi() {
    const on = isSentenceSelectEdit();
    $("#sentence-board")?.classList.toggle("is-select-edit", on);
    document.querySelectorAll("[data-sentence-select-edit]").forEach((btn) => {
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setSentenceSelectEdit(on) {
    if (!isCoarsePointer()) on = false;
    const next = Boolean(on);
    const changed = next !== isSentenceSelectEdit();
    state.sentenceSelectEdit = next;
    hideWordTipPop();
    syncSentenceSelectEditUi();
    if (!changed) return;
    if (next) {
      showToast("選字編輯：點句中的字來套用規則或編輯單字", "info");
    } else {
      showToast("已關閉選字編輯，點字可再看讀音／原形", "info");
    }
  }

  function toggleSentenceSelectEdit() {
    if (!isCoarsePointer()) return;
    setSentenceSelectEdit(!isSentenceSelectEdit());
  }

  function wrapWordTipPopHtml(bodyHtml) {
    if (!isCoarsePointer()) return bodyHtml;
    const on = isSentenceSelectEdit();
    return `<div class="word-tip-pop-inner">
      <div class="word-tip-pop-body">${bodyHtml}</div>
      <button type="button" class="word-tip-edit-mode-btn${on ? " is-on" : ""}" data-sentence-select-edit aria-pressed="${
        on ? "true" : "false"
      }" title="開啟選字編輯：改以點擊選字，套用規則或編輯單字">選字編輯</button>
    </div>`;
  }

  function finalizeWordTipPop(pop, anchor, data) {
    pop.classList.remove("hidden");
    wordTipAnchor = anchor;
    const body = pop.querySelector(".word-tip-pop-body") || pop;
    appendWordTipCopyAction(body, data);
    requestAnimationFrame(() => placePopNearAnchor(pop, anchor));
  }

  function applySentenceTokenSelection(el, clientX, clientY) {
    if (!el) return false;
    const range = getMarkRangeInQuery(el);
    if (!range?.text) return false;
    hideWordTipPop();
    state.selApply = range;
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* ignore */
    }
    const inv = state.lastInventory;
    let note = "點選片段 · 可套用規則或編輯單字";
    if (inv?.items && range.start >= 0) {
      const n = inv.items.filter((it) => {
        if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
          return !(range.end <= Number(it.start) || range.start >= Number(it.end));
        }
        return String(it.span || "").trim() === range.text;
      }).length;
      if (n > 0) note = `此片段已有 ${n} 則 · 可再疊加`;
    }
    showSelApplyPop(clientX, clientY, range.text, { note });
    return true;
  }

  function markSentenceGestureStart(e) {
    const p = eventClientPoint(e);
    sentenceGesture = { moved: false, x: p.x, y: p.y };
  }

  function markSentenceGestureMove(e) {
    const p = eventClientPoint(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (!Number.isFinite(sentenceGesture.x)) return;
    if (Math.hypot(p.x - sentenceGesture.x, p.y - sentenceGesture.y) > 12) {
      sentenceGesture.moved = true;
    }
  }

  function shouldRevealSelApplyFromGesture() {
    if (isSentenceSelectEdit()) return sentenceGesture.moved;
    return sentenceGesture.moved;
  }

  function sentenceSelectEditButtonHtml() {
    const on = isSentenceSelectEdit();
    return `<button type="button" class="btn-sentence-select-edit${on ? " is-on" : ""}" data-sentence-select-edit title="選字編輯：點擊句中的字來套用規則或編輯單字" aria-label="選字編輯" aria-pressed="${
      on ? "true" : "false"
    }">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
      </svg>
    </button>`;
  }

  function sentenceSpeakButtonHtml() {
    return `<button type="button" class="btn-sentence-speak" data-speak-sentence title="朗讀整句" aria-label="朗讀整句">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8.04v7.93A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    </button>`;
  }

  function sentenceTextBlockHtml(innerHtml) {
    return `<div class="sentence-text-row">
      <p class="sentence-text" id="sentence-text">${innerHtml}</p>
      <div class="sentence-text-actions">
        ${isCoarsePointer() ? sentenceSelectEditButtonHtml() : ""}
        ${sentenceSpeakButtonHtml()}
      </div>
    </div>`;
  }

  function speakCurrentSentence() {
    const t = String(state.lastQuery || $("#sentence-text")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) {
      showToast("沒有可朗讀的句子", "info");
      return;
    }
    speakLookupText(t);
  }

  function fallbackCopyText(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function copyLemmaToClipboard(lemma, opts = {}) {
    const t = String(lemma || "").trim();
    if (!t) return;
    const spoken = String(opts.speak || t).trim() || t;
    speakLookupText(spoken, opts.lang || LOOKUP_TTS_LANG);
    const ok = () => showToast(`已複製原形「${t}」並朗讀`, "success");
    const fail = () => showToast("無法複製到剪貼簿", "error");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t).then(ok).catch(() => {
        if (fallbackCopyText(t)) ok();
        else fail();
      });
      return;
    }
    if (fallbackCopyText(t)) ok();
    else fail();
  }

  function bindWordTipHovers(root = document) {
    const scope = root || document;
    scope.querySelectorAll(".word-tip").forEach((el) => {
      const data = {
        lemma: el.dataset.lemma || "",
        reading: el.dataset.reading || "",
        origin: el.dataset.origin || "",
        gloss: el.dataset.gloss || "",
        pos: el.dataset.pos || "",
        surface: el.dataset.surface || el.textContent || "",
        alts: el.dataset.alts || "",
        fromBank: el.dataset.fromBank === "1",
      };
      let pressX = 0;
      let pressY = 0;
      const coarse = isCoarsePointer();
      if (!coarse) {
        el.addEventListener("mouseenter", () => {
          if (isSentenceSelectEdit()) return;
          showWordTipPop(el, data);
        });
        el.addEventListener("mouseleave", (e) => requestHideWordTipPop(e));
        el.addEventListener("focus", () => {
          if (isSentenceSelectEdit()) return;
          showWordTipPop(el, data);
        });
        el.addEventListener("blur", () => requestHideWordTipPop());
      }
      el.addEventListener("pointerdown", (e) => {
        pressX = e.clientX;
        pressY = e.clientY;
      });
      el.addEventListener("click", (e) => {
        if (e.detail > 1) return;
        if (state.locateTarget) return;
        if (suppressWordTipClick) {
          suppressWordTipClick = false;
          return;
        }
        if (sentenceGesture.moved) return;
        if (selectionIsNonEmptyInSentence() && !isSentenceSelectEdit()) return;
        if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 8) return;
        e.preventDefault();
        e.stopPropagation();
        if (isSentenceSelectEdit()) {
          applySentenceTokenSelection(el, e.clientX, e.clientY);
          return;
        }
        if (coarse) {
          if (wordTipAnchor === el) hideWordTipPop();
          else showWordTipPop(el, data);
          return;
        }
        const lemma = String(el.dataset.lemma || "").trim();
        if (!lemma) return;
        const speak =
          String(el.dataset.reading || data.reading || "").trim() ||
          String(el.dataset.surface || data.surface || "").trim() ||
          lemma;
        copyLemmaToClipboard(lemma, { speak });
      });
    });
  }

  function renderApiSentenceBoard(query, spans, legend, options = {}) {
    const vocabList = options.vocab || [];
    const isLocal = options.source === "local";
    // 較長優先（完整活用形 食べます 優先於 ます），同長則起點在前、已收錄優先
    const sorted = (spans || []).slice().sort((a, b) => {
      const lenA = (a.end || 0) - (a.start || 0);
      const lenB = (b.end || 0) - (b.start || 0);
      if (lenB !== lenA) return lenB - lenA;
      if (a.start !== b.start) return a.start - b.start;
      const am = a.missing ? 1 : 0;
      const bm = b.missing ? 1 : 0;
      if (am !== bm) return am - bm;
      return 0;
    });
    // 文法 span：較長優先；重疊的其他規則併入 coHits（同規則不同位置各自上色）
    const used = [];
    for (const s of sorted) {
      if (s.start >= query.length || s.end > query.length || s.start >= s.end) continue;
      const hit = {
        color: s.color ?? s.colorIndex ?? 0,
        ruleId: s.ruleId || "",
        ruleTitle: s.ruleTitle || "",
        missing: Boolean(s.missing),
        invIdx: s.invIdx,
      };
      const host = used.find((u) => !(s.end <= u.start || s.start >= u.end));
      if (host) {
        // 完全相同規則＋相同區間 → 略過；不同規則可共置輪播
        if (host.ruleId === hit.ruleId) continue;
        const exists = (host.coHits || []).some((c) => c.ruleId === hit.ruleId);
        if (!exists) {
          if (!host.coHits) host.coHits = [];
          host.coHits.push(hit);
        }
        continue;
      }
      used.push({
        start: s.start,
        end: s.end,
        text: s.text || query.slice(s.start, s.end),
        ...hit,
        coHits: [],
      });
    }
    used.sort((a, b) => a.start - b.start);

    const tokens = Array.isArray(options.tokens) ? options.tokens : [];
    const vocabLocs =
      tokens.length && typeof SchoolParse !== "undefined" && SchoolParse.hoverLocs
        ? SchoolParse.hoverLocs(tokens, vocabList)
        : locateVocabInText(query, vocabList);
    const html =
      used.length || vocabLocs.length
        ? buildAnnotatedSentenceHtml(query, used, vocabLocs)
        : esc(query);

    const legendHtml = (legend || [])
      .filter((h) => !h.supplementary && h.color !== "usage")
      .map((h) => {
        const sw =
          h.color === "missing" ? "gram-hl gram-hl-missing" : `gram-hl gram-hl-${h.color}`;
        // 已收錄不顯示標籤（靠左側色點即可）；未建立仍標示
        const badge = h.owned
          ? ""
          : `<span class="badge badge-missing-hl">未建立</span>`;
        const btn = h.owned
          ? `<button type="button" class="legend-link" data-scroll-rule="${esc(h.ruleId)}">${esc(h.name)}</button>`
          : `<button type="button" class="legend-link legend-link-missing" data-create-inv-idx="${h.invIdx}">${esc(h.name)}</button>`;
        return `<li class="legend-item"><span class="legend-swatch ${sw}"></span>${btn}${badge}${
          h.owned && !h.hasSpan ? `<span class="legend-count">（句中未定位）</span>` : ""
        }</li>`;
      })
      .join("");

    const hasVocab = vocabLocs.length > 0;
    const hasCycle = used.some((u) => (u.coHits || []).length > 0);
    const modeLabel = isLocal
      ? "本地標記"
      : tokens.length
        ? "API 標記 · 學校文法切詞"
        : "API 標記";
    const editHint = `<p class="sentence-edit-hint">選取文字或<strong>點已上色片段</strong>可套用／疊加規則；下方規則卡操作列的<strong>手動定位</strong>可指定句中片段。右側<strong>+補充</strong>可加入不句中上色的補充用法。</p>`;

    return `
      <div class="sentence-board" id="sentence-board"${sentenceBoardPosHideAttr()}>
        <div id="locate-mode-bar" class="locate-mode-bar hidden" role="status"></div>
        <p class="sentence-label">
          <span class="sentence-label-main">查詢內容 · ${modeLabel}</span>
          ${hasCycle ? `<span class="sentence-cycle-hint">共置輪播</span>` : ""}
          ${hasVocab ? `<span class="sentence-cycle-hint">滑過看原形／詞性</span>` : ""}
          ${hasVocab ? posUnderlineLegendHtml() : ""}
        </p>
        ${sentenceTextBlockHtml(html || esc(query))}
        ${editHint}
        <ul class="sentence-legend" aria-label="句中規則與補充">
          ${legendHtml}
          <li class="legend-item legend-item-add">
            <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
          </li>
        </ul>
        ${options.inventory ? sentenceTranslationHtml(options.inventory) : ""}
      </div>`;
  }

  /** 整句翻譯區塊（可手動貼上／修改） */
  function sentenceTranslationHtml(inventory, opts = {}) {
    const t = String(inventory?.translation || "").trim();
    const editing = Boolean(opts.editing);
    if (editing) {
      return `
      <div class="inv-sentence-translation is-editing" id="inv-translation-block">
        <span class="inv-label">翻譯</span>
        <div class="inv-translation-body">
          <textarea
            id="inv-translation-input"
            class="inv-translation-input"
            rows="2"
            placeholder="貼上或輸入整句繁中翻譯…"
            spellcheck="true"
          >${esc(t)}</textarea>
          <div class="inv-translation-actions">
            <button type="button" class="btn btn-sm btn-primary" data-save-translation>儲存</button>
            <button type="button" class="btn btn-sm btn-ghost" data-cancel-translation>取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
      <div class="inv-sentence-translation" id="inv-translation-block">
        <span class="inv-label">翻譯</span>
        <p class="inv-sentence-text${t ? "" : " is-empty"}">${
          t ? esc(t) : "尚無翻譯 · 可手動貼上或編輯"
        }</p>
        <button type="button" class="btn btn-sm btn-secondary inv-translation-edit" data-edit-translation title="編輯翻譯">
          ${t ? "編輯" : "貼上／編輯"}
        </button>
      </div>`;
  }

  function bindTranslationEditors(root = document) {
    const scope = root || document;
    scope.querySelector("[data-edit-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginEditSentenceTranslation();
    });
    scope.querySelector("[data-save-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveSentenceTranslation();
    });
    scope.querySelector("[data-cancel-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelEditSentenceTranslation();
    });
  }

  function beginEditSentenceTranslation() {
    if (!state.lastInventory && state.lastQuery) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    const block = $("#inv-translation-block");
    if (!block) return;
    block.outerHTML = sentenceTranslationHtml(state.lastInventory, { editing: true });
    bindTranslationEditors(document);
    const ta = $("#inv-translation-input");
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function saveSentenceTranslation() {
    if (!state.lastInventory) {
      showToast("沒有可寫入的查詢結果", "error");
      return;
    }
    const v = String($("#inv-translation-input")?.value || "").trim();
    state.lastInventory.translation = v;
    refreshLookupFromInventory({ replaceTranslation: true });
    showToast(v ? "已更新翻譯" : "已清除翻譯", "success");
  }

  function cancelEditSentenceTranslation() {
    const block = $("#inv-translation-block");
    if (!block) return;
    block.outerHTML = sentenceTranslationHtml(state.lastInventory || {});
    bindTranslationEditors(document);
  }

  function inventoryHtml(inventory, query) {
    if (!inventory) return "";
    const isLocal = inventory.mode === "local" || inventory.source === "local";
    const title = isLocal ? "本地文法盤點" : "API 文法盤點";
    const items = inventory.items || [];
    if (!items.length) {
      return `
        <section class="panel panel-suggest" id="api-inventory-slot">
          <h3>${title}</h3>
          <p>${esc(inventory.summary || (isLocal ? "本地未命中規則。" : "未列出文法點。"))}</p>
        </section>`;
    }

    const rows = items
      .map((it, idx) => {
        const match = resolveInventoryRule(it);
        const owned = match.owned && match.rule;
        if (owned) return "";
        return `
          <li class="inventory-item missing" data-inv-idx="${idx}">
            <div class="inventory-meta">
              <strong>${esc(it.name)}</strong>
              <span class="inv-note">
                <span class="badge badge-missing">尚未收錄</span>
                ${it.category ? ` · ${esc(it.category)}` : ""}
                ${it.span ? ` · <code>${esc(it.span)}</code>` : ""}
                ${it.note ? `<br/>${esc(it.note)}` : ""}
              </span>
            </div>
            <div class="action-row">
              <button type="button" class="btn btn-sm btn-primary" data-add-todo-idx="${idx}">加入待辦</button>
              <button type="button" class="btn btn-sm btn-secondary" data-create-inv-idx="${idx}">建立規則</button>
              <button type="button" class="btn btn-sm btn-ghost" data-dismiss-inv-idx="${idx}" title="僅從本句忽略，不刪筆記本">忽略</button>
            </div>
          </li>`;
      })
      .join("");

    const missingCount = items.filter((it) => !resolveInventoryRule(it).owned).length;

    return `
      <section class="panel panel-suggest" id="api-inventory-slot">
        <div class="panel-head">
          <h3>${title}</h3>
          <span class="badge badge-api-fallback">${items.length} 點 · 缺 ${missingCount}</span>
        </div>
        ${inventory.summary ? `<p class="panel-note">${esc(inventory.summary)}</p>` : ""}
        ${
          missingCount > 0
            ? `<div class="action-row" style="margin-bottom:0.65rem">
                <button type="button" class="btn btn-primary" id="btn-add-all-missing">將 ${missingCount} 項缺失全部加入待辦</button>
              </div>
              <ul class="inventory-list">${rows}</ul>`
            : `<p class="panel-note">${
                isLocal ? "本地掃描完成。" : "本地已涵蓋本次盤點的文法點。"
              }</p>`
        }
      </section>`;
  }

  function addInventoryTodos(items, query) {
    const todos = Storage.loadTodos();
    let added = 0;
    let skipped = 0;
    for (const it of items || []) {
      const name = it.name || it.form || "";
      if (!name) continue;
      if (todos.some((t) => !t.done && (t.form === name || t.note?.includes(name)))) {
        skipped += 1;
        continue;
      }
      todos.unshift({
        id: "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
        form: it.span || it.nameJa || name,
        lemma: "",
        formName: name,
        group: it.category || "",
        note: `API 盤點：${name}${it.note ? " · " + it.note : ""} · 來自「${query}」`,
        created_at: new Date().toISOString(),
        done: false,
      });
      added += 1;
    }
    if (added) Storage.saveTodos(todos);
    return { added, skipped };
  }

  function bindApiInventoryEvents(query, inventory) {
    const root = $("#lookup-result");
    if (!root) return;

    $("#btn-add-all-missing")?.addEventListener("click", () => {
      if (!inventory?.items) return;
      const missing = inventory.items.filter((it) => !resolveInventoryRule(it).owned);
      const { added, skipped } = addInventoryTodos(missing, query);
      showToast(
        added ? `已加入 ${added} 項待辦${skipped ? `（略過 ${skipped}）` : ""}` : "沒有新的待辦可加",
        added ? "success" : "info"
      );
    });

    root.querySelectorAll("[data-add-todo-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = inventory?.items?.[Number(btn.dataset.addTodoIdx)];
        if (!it) return;
        const { added } = addInventoryTodos([it], query);
        showToast(added ? "已加入待辦" : "待辦中已有或已收錄", added ? "success" : "info");
      });
    });

    root.querySelectorAll("[data-create-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = inventory?.items?.[Number(btn.dataset.createInvIdx)];
        if (!it) return;
        // 與 Mal 相同：只帶規則名，不預填說明／分類／三格
        openFormFromInventoryName(it.name, query);
      });
    });

    root.querySelectorAll("[data-dismiss-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dismissInventoryItemAt(btn.dataset.dismissInvIdx);
      });
    });

    root.querySelectorAll("[data-detach-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detachRuleFromCurrentResult(btn.dataset.detachRule);
      });
    });

    root.querySelectorAll("[data-locate-rule]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterLocateMode(btn.dataset.locateRule);
      });
    });

    root.querySelectorAll("[data-goto-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.gotoRule;
        if (scrollToOwnedRuleOnLookup(id)) return;
        goToRuleInNotebook(id);
      });
    });

    // 圖例連結：跳轉規則；句中 mark 另處理（可再疊加套用）
    root.querySelectorAll("[data-scroll-rule]").forEach((el) => {
      if (el.matches && el.matches("mark.gram-hl")) return;
      el.addEventListener("click", () => {
        const id = el.dataset.scrollRule;
        if (scrollToOwnedRuleOnLookup(id)) return;
        goToRuleInNotebook(id);
      });
    });
    root.querySelectorAll("[data-add-supplementary]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSupplementaryPickModal();
      });
    });

    root.querySelectorAll(".legend-link-missing[data-create-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = inventory?.items?.[Number(btn.dataset.createInvIdx)];
        if (!it) return;
        openFormFromInventoryName(it.name, query);
      });
    });

    // 已上色片段：點一下 → 再套用／查看
    root.querySelectorAll("mark.gram-hl").forEach((mark) => {
      mark.addEventListener("click", (e) => onGrammarMarkClick(e, mark));
    });

    // 選字套用：掛在 sentence-board（句首邊距拖選也吃得到）
    bindSentenceSelectionHandlers();
    bindTranslationEditors(root);

    // 還原定位模式 UI（重畫後）
    if (state.locateTarget?.ruleId) updateLocateModeBar();
  }

  /* —— 本句手動校正（不改筆記本規則本體；對齊 Mal） —— */

  function persistCurrentInventory(opts = {}) {
    const q = String(state.lastQuery || "").trim();
    const inv = state.lastInventory;
    if (!q || !inv) return null;
    // 可傳入已算過的 apiHl，避免手動校正後再全量重算
    const apiHl = opts.apiHl || buildApiHighlight(q, inv);
    return persistLookupResult(q, inv, apiHl, {
      silent: opts.silent !== false,
      replaceTranslation: Boolean(opts.replaceTranslation),
    });
  }

  function refreshLookupFromInventory(opts = {}) {
    const q = state.lastQuery;
    const inv = state.lastInventory;
    if (!q || !inv) return;
    const apiHl = applyInventoryToLookup(q, inv, opts);
    persistCurrentInventory({
      apiHl: apiHl || undefined,
      replaceTranslation: Boolean(opts.replaceTranslation),
    });
  }

  /** 從本句結果移除某規則的套用（筆記本規則保留） */
  function detachRuleFromCurrentResult(ruleId) {
    const id = String(ruleId || "").trim();
    const inv = state.lastInventory;
    if (!id || !inv) {
      showToast("沒有可編輯的查詢結果", "info");
      return;
    }
    const before = (inv.items || []).length;
    inv.items = (inv.items || []).filter((it) => {
      if (it.manualRuleId && String(it.manualRuleId) === id) return false;
      const m = resolveInventoryRule(it);
      if (m.owned && m.rule?.id === id) return false;
      return true;
    });
    if (inv.items.length === before) {
      showToast("找不到對應的本句項目", "info");
      return;
    }
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast("已從本句移除（筆記本規則仍保留）", "success");
  }

  /** 忽略尚未收錄的某一項（僅本句） */
  function dismissInventoryItemAt(invIdx) {
    const inv = state.lastInventory;
    if (!inv?.items) return;
    const i = Number(invIdx);
    if (!Number.isFinite(i) || i < 0 || i >= inv.items.length) return;
    const name = inv.items[i]?.name || "";
    inv.items.splice(i, 1);
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast(name ? `已忽略「${name}」` : "已從本句忽略", "info");
  }

  function ensureLookupInventoryShell() {
    if (!state.lastQuery) return null;
    if (!state.lastInventory) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }
    if (!Array.isArray(state.lastInventory.items)) state.lastInventory.items = [];
    return state.lastInventory;
  }

  /** 補充用法加入本句（不句中上色、不需選字） */
  function addSupplementaryRuleToCurrent(rule) {
    if (!rule?.id) return;
    if (
      typeof RulesService.isSupplementaryUsage === "function" &&
      !RulesService.isSupplementaryUsage(rule)
    ) {
      showToast("請選擇分類為「補充用法」的規則", "info");
      return;
    }
    const inv = ensureLookupInventoryShell();
    if (!inv || !state.lastQuery) {
      showToast("請先完成一次查詢再加入補充", "info");
      return;
    }
    const already = (inv.items || []).some((it) => {
      if (String(it.manualRuleId || "") === rule.id) return true;
      const m = resolveInventoryRule(it);
      return m.owned && m.rule?.id === rule.id;
    });
    if (already) {
      showToast("本句已有此補充用法", "info");
      return;
    }
    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    inv.items.push({
      name: rule.title,
      nameJa: "",
      nameZh: rule.title,
      span: "",
      category: rule.category || RulesService.SUPPLEMENTARY_CATEGORY || "補充用法",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
    });
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast(`已加入補充：${rule.title}`, "success");
  }

  function openSupplementaryPickModal() {
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    ensureLookupInventoryShell();
    state.rulePickMode = "supplementary";
    state.selApply = null;
    hideSelApplyPop();
    const modal = $("#rule-pick-modal");
    const title = $("#rule-pick-modal-title");
    const preview = $("#rule-pick-span-preview");
    const sub = modal?.querySelector(".modal-sub");
    if (title) title.textContent = "加入補充用法";
    if (preview) preview.textContent = "不句中上色 · 排在規則卡最後";
    if (sub) {
      sub.innerHTML =
        `選擇筆記本中的<strong>補充用法</strong>加入本句；或建立新卡（分類會設為補充用法）。`;
    }
    const createHint = $(".rule-pick-create-hint");
    if (createHint) {
      createHint.innerHTML =
        `沒有合適的？<strong>建立新補充用法</strong>（儲存後自動加入本句，不句中上色）。`;
    }
    const createBtn = $("#btn-rule-pick-create");
    if (createBtn) createBtn.textContent = "建立補充用法";
    if (modal) modal.classList.remove("hidden");
    const filter = $("#rule-pick-filter");
    if (filter) {
      filter.value = "";
      setTimeout(() => filter.focus(), 40);
    }
    renderRulePickList();
  }

  /** 手動把筆記本規則套到選取片段 */
  function addRuleToCurrentResult(rule, spanText, start, end) {
    if (!rule?.id) return;
    if (
      typeof RulesService.isSupplementaryUsage === "function" &&
      RulesService.isSupplementaryUsage(rule)
    ) {
      showToast("補充用法請用句旁「+補充」加入，不會在句中上色", "info");
      return;
    }
    const inv = state.lastInventory;
    const q = String(state.lastQuery || "");
    if (!inv || !q) {
      showToast("請先完成一次查詢再手動套用", "info");
      return;
    }
    const span = String(spanText || "").trim();
    if (!span) {
      showToast("沒有選取文字", "error");
      return;
    }

    // 相同文法可在句中多處各套一次（如兩個「は」）；僅「同規則＋同片段」禁止
    let s = Number(start);
    let e = Number(end);
    let rangeOk =
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= q.length &&
      q.slice(s, e) === span;

    function itemMatchesRule(it) {
      return (
        String(it.manualRuleId || "") === rule.id ||
        resolveInventoryRule(it).rule?.id === rule.id
      );
    }
    function rangesOverlap(a0, a1, b0, b1) {
      return !(a1 <= b0 || a0 >= b1);
    }
    /** 同規則已佔用的區間：有 start/end 用座標；無座標則各佔下一個尚未佔用的 span 出現處 */
    function collectSameRuleOccupied() {
      const occupied = [];
      const unlocated = [];
      for (const it of inv.items || []) {
        if (!itemMatchesRule(it)) continue;
        const a = Number(it.start);
        const b = Number(it.end);
        if (
          Number.isFinite(a) &&
          Number.isFinite(b) &&
          b > a &&
          a >= 0 &&
          b <= q.length
        ) {
          occupied.push({ s: a, e: b });
        } else {
          unlocated.push(it);
        }
      }
      for (const it of unlocated) {
        const sp = String(it.span || "").trim();
        if (!sp) continue;
        let from = 0;
        while (from < q.length) {
          const idx = q.indexOf(sp, from);
          if (idx < 0) break;
          const pe = idx + sp.length;
          if (!occupied.some((r) => rangesOverlap(idx, pe, r.s, r.e))) {
            occupied.push({ s: idx, e: pe });
            break;
          }
          from = idx + 1;
        }
      }
      return occupied;
    }
    function placementFree(ps, pe) {
      return !collectSameRuleOccupied().some((r) => rangesOverlap(ps, pe, r.s, r.e));
    }

    if (!rangeOk) {
      let from = 0;
      let placed = null;
      while (from < q.length) {
        const idx = q.indexOf(span, from);
        if (idx < 0) break;
        const pe = idx + span.length;
        if (placementFree(idx, pe)) {
          placed = { s: idx, e: pe };
          break;
        }
        from = idx + 1;
      }
      if (placed) {
        s = placed.s;
        e = placed.e;
        rangeOk = true;
      } else {
        // 優先靠近原本選取偏移的出現處
        const hint = Number(start);
        let best = q.indexOf(span);
        if (Number.isFinite(hint) && hint >= 0) {
          let from2 = 0;
          let bestDist = Infinity;
          while (from2 < q.length) {
            const idx = q.indexOf(span, from2);
            if (idx < 0) break;
            const d = Math.abs(idx - hint);
            if (d < bestDist) {
              bestDist = d;
              best = idx;
            }
            from2 = idx + 1;
          }
        }
        s = best;
        e = s >= 0 ? s + span.length : -1;
        rangeOk =
          s >= 0 && e > s && e <= q.length && q.slice(s, e) === span;
      }
    }

    const occupied = collectSameRuleOccupied();
    const dup = rangeOk
      ? occupied.some((r) => rangesOverlap(s, e, r.s, r.e))
      : (inv.items || []).some(
          (it) => itemMatchesRule(it) && String(it.span || "").trim() === span
        );
    if (dup) {
      showToast("此片段已套用過同一則規則（可改選句中其他位置）", "info");
      return;
    }

    const coCount = (inv.items || []).filter((it) => {
      if (rangeOk && Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
        const a = Number(it.start);
        const b = Number(it.end);
        return rangesOverlap(s, e, a, b);
      }
      return String(it.span || "").trim() === span;
    }).length;

    const item = {
      name: rule.title,
      nameJa: "",
      nameZh: rule.title,
      span,
      category: rule.category || "",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
      note: "手動套用",
    };
    if (rangeOk) {
      item.start = s;
      item.end = e;
    }
    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    inv.items.push(item);
    state.lastInventory = inv;
    refreshLookupFromInventory();
    if (coCount > 0) {
      showToast(`已疊加：${rule.title}（此片段共 ${coCount + 1} 則規則）`, "success");
    } else {
      showToast(`已套用：${rule.title}`, "success");
    }
  }

  function updateLocateModeBar() {
    const bar = $("#locate-mode-bar");
    if (!bar) return;
    const t = state.locateTarget;
    if (!t?.ruleId) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      document.body.classList.remove("locate-mode-active");
      return;
    }
    document.body.classList.add("locate-mode-active");
    bar.classList.remove("hidden");
    bar.innerHTML = `
      <span class="locate-mode-badge">定位中</span>
      <span class="locate-mode-text">請在句中<strong>選取</strong>對應片段 →
        <strong>${esc(t.ruleTitle || "規則")}</strong>
      </span>
      <button type="button" class="btn btn-sm btn-ghost" id="btn-locate-cancel">取消</button>
    `;
    bar.querySelector("#btn-locate-cancel")?.addEventListener("click", () => {
      cancelLocateMode();
      showToast("已取消定位", "info");
    });
  }

  function enterLocateMode(ruleId) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    if (!rule) {
      showToast("找不到規則", "error");
      return;
    }
    if (!state.lastQuery || !state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    state.locateTarget = { ruleId: id, ruleTitle: rule.title };
    hideSelApplyPop();
    updateLocateModeBar();
    setView("lookup");
    const board = $("#sentence-board") || $("#sentence-text");
    board?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`請選取「${rule.title}」在句中的位置`, "info");
  }

  function cancelLocateMode() {
    state.locateTarget = null;
    updateLocateModeBar();
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn) applyBtn.textContent = "套用規則";
  }

  /**
   * 將選取片段寫入 inventory，讓該規則在句中上色
   */
  function assignManualLocation(ruleId, cap) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    const inv = state.lastInventory;
    const q = String(state.lastQuery || "");
    if (!rule || !inv || !q) {
      showToast("無法定位：缺少查詢結果", "error");
      return false;
    }
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先選取句中文字", "error");
      return false;
    }
    let s = Number(cap.start);
    let e = Number(cap.end);
    const rangeOk =
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= q.length &&
      q.slice(s, e) === text;
    if (!rangeOk) {
      const near = nearestTextOccurrence(q, text, cap?.start);
      if (near < 0) {
        showToast("選取內容與原文對不上，請再選一次", "error");
        return false;
      }
      s = near;
      e = near + text.length;
    }

    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    const indices = [];
    inv.items.forEach((it, i) => {
      const m = resolveInventoryRule(it);
      if (m.rule?.id === id) indices.push(i);
    });

    const patch = (it) => {
      it.span = text;
      it.start = s;
      it.end = e;
      it.locatedManually = true;
      if (!it.manualRuleId) it.manualRuleId = id;
      if (!it.name) it.name = rule.title;
    };

    let mode = "update";
    if (indices.length) {
      let targetIdx = -1;
      for (const i of indices) {
        const found = locateInventoryItemInText(q, inv.items[i]);
        if (!found.length) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx >= 0) {
        patch(inv.items[targetIdx]);
      } else {
        const base = { ...inv.items[indices[0]] };
        patch(base);
        base.source = base.source || "manual";
        inv.items.push(base);
        mode = "add";
      }
    } else {
      inv.items.push({
        name: rule.title,
        nameJa: "",
        nameZh: rule.title,
        span: text,
        start: s,
        end: e,
        category: rule.category || "",
        confidence: "high",
        source: "manual",
        manualRuleId: id,
        locatedManually: true,
        note: "手動定位",
      });
      mode = "new";
    }

    state.lastInventory = inv;
    state.locateTarget = null;
    updateLocateModeBar();
    refreshLookupFromInventory();
    showToast(
      mode === "add"
        ? `已加上定位「${text}」→ ${rule.title}`
        : `已定位「${text}」→ ${rule.title}`,
      "success"
    );
    return true;
  }

  function hideSelApplyPop() {
    const pop = $("#sel-apply-pop");
    if (pop) pop.classList.add("hidden");
    const note = $("#sel-apply-note");
    if (note) {
      note.textContent = "";
      note.classList.add("hidden");
    }
    const viewBtn = $("#btn-sel-view-rule");
    if (viewBtn) {
      viewBtn.classList.add("hidden");
      viewBtn.dataset.ruleId = "";
    }
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn && !state.locateTarget) applyBtn.textContent = "套用規則";
  }

  function showSelApplyPop(clientX, clientY, text, opts = {}) {
    const pop = $("#sel-apply-pop");
    const label = $("#sel-apply-text");
    if (!pop) return;
    if (label) label.textContent = `「${text.length > 24 ? text.slice(0, 24) + "…" : text}」`;
    const note = $("#sel-apply-note");
    const locate = state.locateTarget;
    if (note) {
      if (locate?.ruleId) {
        note.textContent = `定位到：${locate.ruleTitle || "規則"}`;
        note.classList.remove("hidden");
      } else if (opts.note) {
        note.textContent = opts.note;
        note.classList.remove("hidden");
      } else {
        note.textContent = "";
        note.classList.add("hidden");
      }
    }
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn) {
      applyBtn.textContent = locate?.ruleId ? "確認定位" : "套用規則";
    }
    const vocabBtn = $("#btn-sel-vocab");
    if (vocabBtn) {
      // 手動定位規則時不顯示單字解釋
      vocabBtn.classList.toggle("hidden", Boolean(locate?.ruleId));
    }
    const viewBtn = $("#btn-sel-view-rule");
    if (viewBtn) {
      if (opts.viewRuleId && !locate?.ruleId) {
        viewBtn.classList.remove("hidden");
        viewBtn.dataset.ruleId = opts.viewRuleId;
      } else {
        viewBtn.classList.add("hidden");
        viewBtn.dataset.ruleId = "";
      }
    }
    pop.classList.remove("hidden");
    requestAnimationFrame(() => {
      let x = clientX;
      let y = clientY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        try {
          const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.bottom;
        } catch {
          const vv = visualViewportBox();
          x = vv.left + vv.width / 2;
          y = vv.top + 96;
        }
      }
      placeFixedPop(pop, x, y);
    });
  }

  function setVocabEditBanner(html, kind = "info") {
    const banner = $("#vocab-edit-banner");
    if (!banner) return;
    if (!html) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      return;
    }
    banner.classList.remove("hidden");
    banner.className = `result-banner ${kind}`;
    banner.innerHTML = html;
  }

  function findVocabEntryForRange(cap) {
    const list = state.lastInventory?.vocab;
    if (!Array.isArray(list) || !cap) return { entry: null, index: -1 };
    const text = String(cap.text || "").trim();
    const s = Number(cap.start);
    const e = Number(cap.end);
    const rangeOk = Number.isFinite(s) && Number.isFinite(e) && e > s;

    // 只認「整段圈選」：精確起訖，或表面形等於整段選取字。
    // 不可把其中一個已切碎詞（煩 ⊂ 煩わしさ）當成這一筆。
    if (rangeOk) {
      for (let i = 0; i < list.length; i++) {
        const w = list[i];
        const ws = Number(w.start);
        const we = Number(w.end);
        if (Number.isFinite(ws) && Number.isFinite(we) && ws === s && we === e) {
          return { entry: w, index: i };
        }
      }
    }
    if (text) {
      for (let i = 0; i < list.length; i++) {
        const w = list[i];
        const surf = String(w.surface || "").trim();
        if (surf !== text) continue;
        if (!rangeOk) return { entry: w, index: i };
        const ws = Number(w.start);
        const we = Number(w.end);
        if (Number.isFinite(ws) && Number.isFinite(we) && we > ws) {
          if (!(e <= ws || s >= we)) return { entry: w, index: i };
        } else {
          return { entry: w, index: i };
        }
      }
    }
    return { entry: null, index: -1 };
  }

  /** 儲存合併詞後，丟掉被整段圈選蓋住的碎詞 */
  function pruneVocabFragmentsCoveredBy(list, start, end) {
    if (!Array.isArray(list)) return list;
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) return list;
    return list.filter((w) => {
      const ws = Number(w.start);
      const we = Number(w.end);
      if (!(Number.isFinite(ws) && Number.isFinite(we) && we > ws)) return true;
      const inside = ws >= start && we <= end;
      const smaller = we - ws < end - start;
      return !(inside && smaller);
    });
  }

  /** select 設值；若選項沒有該值則臨時加入，避免無法顯示／再改 */
  function setSelectValue(sel, value) {
    if (!sel || sel.tagName !== "SELECT") {
      if (sel) sel.value = value || "";
      return;
    }
    const v = String(value || "").trim();
    sel.querySelectorAll("option[data-temp-opt]").forEach((o) => o.remove());
    if (!v) {
      sel.value = "";
      return;
    }
    const has = Array.from(sel.options).some((o) => o.value === v);
    if (!has) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      opt.dataset.tempOpt = "1";
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function fillVocabEditForm(data = {}) {
    const set = (id, v) => {
      const el = $(id);
      if (!el) return;
      if (el.tagName === "SELECT") setSelectValue(el, v);
      else el.value = v || "";
    };
    set("#vocab-edit-surface", data.surface);
    set("#vocab-edit-reading", data.reading);
    set("#vocab-edit-lemma", data.lemma);
    set("#vocab-edit-origin", data.origin);
    set("#vocab-edit-pos", data.pos);
    set("#vocab-edit-gloss", data.gloss);
  }

  function readVocabEditForm() {
    return {
      surface: String($("#vocab-edit-surface")?.value || "").trim(),
      reading: String($("#vocab-edit-reading")?.value || "").trim(),
      lemma: String($("#vocab-edit-lemma")?.value || "").trim(),
      origin: String($("#vocab-edit-origin")?.value || "").trim(),
      pos: String($("#vocab-edit-pos")?.value || "").trim(),
      gloss: String($("#vocab-edit-gloss")?.value || "").trim(),
    };
  }

  function openVocabEditModal() {
    const cap = state.selApply;
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    if (!state.lastInventory) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }
    if (!Array.isArray(state.lastInventory.vocab)) state.lastInventory.vocab = [];

    const range = {
      text,
      start: Number.isFinite(cap.start) ? cap.start : -1,
      end: Number.isFinite(cap.end) ? cap.end : -1,
    };
    state.vocabEditRange = range;
    hideSelApplyPop();

    const found = findVocabEntryForRange(range);
    const bankHit =
      typeof Storage.lookupVocabBank === "function" ? Storage.lookupVocabBank(text) : null;
    const base = found.entry
      ? { ...found.entry }
      : bankHit
        ? {
            surface: text,
            reading: bankHit.reading || "",
            lemma: bankHit.lemma || "",
            origin: bankHit.origin || "",
            pos: bankHit.pos || "",
            gloss: bankHit.gloss || "",
          }
        : {
            surface: text,
            reading: "",
            lemma: "",
            origin: "",
            pos: "",
            gloss: "",
          };
    // 圈選多個已切詞時，表面形必須是一同圈起的整段，不可沿用碎詞表面形
    base.surface = text;
    fillVocabEditForm(base);
    setVocabEditBanner(
      found.entry
        ? `<strong>編輯既有單字</strong> — 修改後按「儲存到本句」（並更新本地單字庫）。`
        : bankHit
          ? `<strong>來自本地單字庫</strong> — 可修改後儲存到本句。`
          : `<strong>新增單字解釋</strong> — 可手動填寫或按「AI 填寫」；儲存後寫入本句與單字本。`,
      "info"
    );
    const preview = $("#vocab-edit-span-preview");
    if (preview) preview.textContent = text;
    $("#vocab-edit-modal")?.classList.remove("hidden");
    setTimeout(() => $("#vocab-edit-gloss")?.focus(), 40);
  }

  function closeVocabEditModal() {
    $("#vocab-edit-modal")?.classList.add("hidden");
    state.vocabEditRange = null;
    setVocabEditBanner("");
  }

  function saveVocabEditForm(e) {
    e?.preventDefault();
    const range = state.vocabEditRange;
    const q = String(state.lastQuery || "");
    if (!range || !q) {
      showToast("沒有可寫入的查詢結果", "error");
      return;
    }
    if (!state.lastInventory) {
      state.lastInventory = { summary: "", translation: "", items: [], vocab: [] };
    }
    const form = readVocabEditForm();
    const surface = form.surface || range.text;
    if (!surface) {
      showToast("請填寫表面形", "error");
      $("#vocab-edit-surface")?.focus();
      return;
    }
    if (!form.gloss && !form.reading && !form.lemma && !form.origin) {
      showToast("請至少填寫讀音、原形、原文或意思其中一項", "info");
      return;
    }

    let start = Number(range.start);
    let end = Number(range.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
      const idx = q.indexOf(surface);
      if (idx >= 0) {
        start = idx;
        end = idx + surface.length;
      } else {
        start = null;
        end = null;
      }
    }

    const row = {
      surface,
      reading: form.reading,
      lemma: form.lemma,
      origin: form.origin,
      gloss: form.gloss,
      pos: form.pos,
      start,
      end,
      source: "manual",
    };

    const list = Array.isArray(state.lastInventory.vocab)
      ? state.lastInventory.vocab.slice()
      : [];
    const found = findVocabEntryForRange(range);
    if (found.index >= 0) {
      list[found.index] = { ...list[found.index], ...row };
    } else {
      // 同 surface 且重疊區間則覆蓋（只改同一處，避免改到句中另一個同形）
      let replaced = false;
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].surface || "") !== surface) continue;
        const ws = Number(list[i].start);
        const we = Number(list[i].end);
        const overlaps =
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          Number.isFinite(ws) &&
          Number.isFinite(we) &&
          !(end <= ws || start >= we);
        const noRange = !Number.isFinite(ws) || !Number.isFinite(we);
        if (overlaps || noRange) {
          list[i] = { ...list[i], ...row };
          replaced = true;
          break;
        }
      }
      if (!replaced) list.push(row);
    }
    state.lastInventory.vocab = pruneVocabFragmentsCoveredBy(list, start, end);
    if (typeof Storage.upsertVocabBankEntries === "function") {
      Storage.upsertVocabBankEntries([row], { preferIncoming: true });
    }
    closeVocabEditModal();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    refreshLookupFromInventory();
    showToast(`已寫入單字「${surface}」（本句＋本地庫）`, "success");
  }

  async function runVocabEditAi() {
    const range = state.vocabEditRange;
    const surface =
      String($("#vocab-edit-surface")?.value || "").trim() ||
      String(range?.text || "").trim();
    if (!surface) {
      showToast("請先有選取詞", "error");
      return;
    }
    if (!Storage.hasApiKey()) {
      showToast("請到「設定」填入 API Key，或手動填寫", "info");
      return;
    }
    const btn = $("#btn-vocab-edit-ai");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
    }
    setVocabEditBanner(`<strong>AI 查詢中</strong> — 正在補齊「${esc(surface)}」…`, "info");
    try {
      const w = await AiService.completeWordFromSurface(surface, state.lastQuery || "");
      fillVocabEditForm({
        surface: w.surface || surface,
        reading: w.reading || "",
        lemma: w.lemma || "",
        origin: w.origin || "",
        pos: w.pos || "",
        gloss: w.gloss || "",
      });
      setVocabEditBanner(
        `<strong>AI 已填寫</strong> — 請核對後按「儲存到本句」。`,
        "success"
      );
      showToast("AI 已填寫單字資訊", "success");
    } catch (err) {
      setVocabEditBanner(
        `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`,
        "error"
      );
      showToast(err.message || "AI 填寫失敗", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  function getMarkRangeInQuery(mark) {
    const sentenceEl = $("#sentence-text");
    const q = String(state.lastQuery || "");
    if (!mark || !sentenceEl || !q) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(mark);
      let start = getTextOffsetInElement(sentenceEl, range.startContainer, range.startOffset);
      let end = getTextOffsetInElement(sentenceEl, range.endContainer, range.endOffset);
      const text = String(mark.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      if (start >= 0 && end > start && end <= q.length && q.slice(start, end) === text) {
        return { text, start, end };
      }
      // 同形多處時取最靠近 DOM 偏移的出現處（避免永遠對到第一個）
      const near = nearestTextOccurrence(q, text, start);
      if (near >= 0) return { text, start: near, end: near + text.length };
      return { text, start: -1, end: -1 };
    } catch {
      return null;
    }
  }

  /** 在原文找 needle；有 hint 時取最靠近的出現處（支援同一文法多處） */
  function nearestTextOccurrence(src, needle, hintStart) {
    const q = String(src || "");
    const n = String(needle || "");
    if (!q || !n) return -1;
    let best = -1;
    let bestDist = Infinity;
    let from = 0;
    const hint = Number(hintStart);
    const useHint = Number.isFinite(hint) && hint >= 0;
    while (from < q.length) {
      const idx = q.indexOf(n, from);
      if (idx < 0) break;
      if (!useHint) return idx;
      const d = Math.abs(idx - hint);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
      from = idx + 1;
    }
    return best;
  }

  function selectionIsNonEmptyInSentence() {
    const sentenceEl = $("#sentence-text");
    const sel = window.getSelection();
    if (!sentenceEl || !sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    try {
      return selectionIntersectsElement(sel.getRangeAt(0), sentenceEl);
    } catch {
      return false;
    }
  }

  /** 選取範圍是否與句中文字有交集（句首從板子邊距拖進來也算） */
  function selectionIntersectsElement(range, el) {
    if (!range || !el) return false;
    try {
      if (el.contains(range.commonAncestorContainer)) return true;
      const er = document.createRange();
      er.selectNodeContents(el);
      // A 結束在 B 開始之後，且 A 開始在 B 結束之前 → 有交集
      return (
        range.compareBoundaryPoints(Range.END_TO_START, er) > 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, er) < 0
      );
    } catch {
      return false;
    }
  }

  /** 把選取夾進 #sentence-text（修正共同祖先在外側時的漏判） */
  function clampRangeToElement(range, el) {
    if (!range || !el) return null;
    try {
      const er = document.createRange();
      er.selectNodeContents(el);
      const out = range.cloneRange();
      if (out.compareBoundaryPoints(Range.START_TO_START, er) < 0) {
        out.setStart(er.startContainer, er.startOffset);
      }
      if (out.compareBoundaryPoints(Range.END_TO_END, er) > 0) {
        out.setEnd(er.endContainer, er.endOffset);
      }
      if (out.collapsed) return null;
      return out;
    } catch {
      return null;
    }
  }

  function getTextOffsetInElement(root, node, offset) {
    if (!root || !node) return -1;
    // 選取落在 root 外側：夾到邊界
    if (!root.contains(node) && node !== root) {
      try {
        const er = document.createRange();
        er.selectNodeContents(root);
        const probe = document.createRange();
        probe.setStart(node, Math.max(0, offset));
        probe.collapse(true);
        if (probe.compareBoundaryPoints(Range.START_TO_START, er) <= 0) return 0;
        if (probe.compareBoundaryPoints(Range.START_TO_END, er) >= 0) {
          return (root.textContent || "").length;
        }
      } catch {
        /* fall through */
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let count = 0;
      let n;
      while ((n = walker.nextNode())) {
        if (n === node) {
          return count + Math.max(0, Math.min(offset, n.textContent.length));
        }
        count += n.textContent.length;
      }
    }
    if (node.nodeType === Node.ELEMENT_NODE && (root.contains(node) || node === root)) {
      try {
        const before = document.createRange();
        before.selectNodeContents(root);
        before.setEnd(node, Math.min(Math.max(0, offset), node.childNodes.length));
        return before.toString().length;
      } catch {
        return -1;
      }
    }
    // 後備：用 Range 量到該點
    try {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch {
      return -1;
    }
  }

  /**
   * 依 DOM 偏移對回 lastQuery 字元索引（處理 DOM 與原文空白差異）
   */
  function mapDomOffsetsToQuery(q, domText, start, end) {
    const src = String(q || "");
    if (!src) return { start: -1, end: -1 };
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= src.length &&
      start <= domText.length
    ) {
      // 直接可用
      if (end <= src.length) return { start, end };
    }
    // 用去掉空白後的對齊（句首空白／標註插入字元）
    function buildMap(str) {
      const map = [];
      for (let i = 0; i < str.length; i++) {
        if (!/\s/.test(str[i])) map.push(i);
      }
      return map;
    }
    const qMap = buildMap(src);
    const dMap = buildMap(String(domText || ""));
    if (!qMap.length || !dMap.length) return { start: -1, end: -1 };

    function domToCompact(i) {
      // 有多少非空白字元嚴格位於 i 之前
      let c = 0;
      const s = String(domText || "");
      for (let k = 0; k < Math.min(i, s.length); k++) {
        if (!/\s/.test(s[k])) c++;
      }
      return c;
    }
    const cs = domToCompact(start);
    const ce = domToCompact(end);
    if (cs >= qMap.length) return { start: -1, end: -1 };
    const qs = qMap[Math.min(cs, qMap.length - 1)];
    const qe =
      ce <= 0
        ? qs
        : ce >= qMap.length
          ? src.length
          : qMap[ce - 1] + 1;
    if (qe > qs) return { start: qs, end: qe };
    return { start: -1, end: -1 };
  }

  function captureSentenceSelection() {
    const sentenceEl = $("#sentence-text");
    if (!sentenceEl || !state.lastQuery) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    let range = sel.getRangeAt(0);
    if (!selectionIntersectsElement(range, sentenceEl)) return null;

    // 句首從板子／標籤拖進來：夾進句中文字
    const clamped = clampRangeToElement(range, sentenceEl);
    if (!clamped) return null;
    range = clamped;

    const rawSelected = String(range.toString() || "");
    const text = rawSelected.replace(/\s+/g, " ").trim();
    if (!text) return null;

    let start = getTextOffsetInElement(sentenceEl, range.startContainer, range.startOffset);
    let end = getTextOffsetInElement(sentenceEl, range.endContainer, range.endOffset);
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    const q = String(state.lastQuery || "");
    const domText = sentenceEl.textContent || "";

    if (
      start >= 0 &&
      end > start &&
      end <= q.length &&
      q.slice(start, end) === text
    ) {
      return { text, start, end };
    }
    // DOM 偏移對得上原文切片（可能空白不同）
    if (start >= 0 && end > start && end <= q.length) {
      const slice = q.slice(start, end).replace(/\s+/g, " ").trim();
      if (slice === text) return { text, start, end };
    }
    // 用 DOM 全文對齊映射
    if (start >= 0 && end > start) {
      const mapped = mapDomOffsetsToQuery(q, domText, start, end);
      if (mapped.start >= 0 && mapped.end > mapped.start) {
        const slice = q.slice(mapped.start, mapped.end).replace(/\s+/g, " ").trim();
        if (slice === text || slice.includes(text) || text.includes(slice)) {
          return {
            text: slice || text,
            start: mapped.start,
            end: mapped.end,
          };
        }
      }
    }
    // 後備：原文 indexOf — 同形多處時對齊 DOM 偏移最近者（勿永遠對到第一個）
    const near = nearestTextOccurrence(q, text, start);
    if (near >= 0) {
      return { text, start: near, end: near + text.length };
    }
    // 仍回傳文字，讓套用／單字解釋可用（區間之後再定位）
    return { text, start: -1, end: -1 };
  }

  function bindSentenceSelectionHandlers() {
    const board = $("#sentence-board");
    const sentenceEl = $("#sentence-text");
    const host = board || sentenceEl;
    if (!host || host.dataset.selBound === "1") return;
    host.dataset.selBound = "1";
    host.addEventListener("pointerdown", markSentenceGestureStart);
    host.addEventListener("pointermove", markSentenceGestureMove);
    host.addEventListener("mouseup", onSentenceMouseUp);
    host.addEventListener("touchend", onSentenceMouseUp, { passive: true });
  }

  function onSentenceMouseUp(e) {
    if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, .sentence-legend, .locate-mode-bar")) {
      return;
    }
    if (!shouldRevealSelApplyFromGesture()) return;
    suppressWordTipClick = true;
    const point = eventClientPoint(e);
    // 延遲讓 selection 穩定；句首拖選常在 board 上 mouseup／touchend
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        state.selApply = cap;
        const inv = state.lastInventory;
        let note = "";
        if (inv?.items && cap.start >= 0) {
          const n = inv.items.filter((it) => {
            if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
              return !(cap.end <= Number(it.start) || cap.start >= Number(it.end));
            }
            return String(it.span || "").trim() === cap.text;
          }).length;
          if (n > 0) note = `此片段已有 ${n} 則 · 可再疊加`;
        }
        showSelApplyPop(point.x, point.y, cap.text, { note });
      });
    });
  }

  function onGrammarMarkClick(e, mark) {
    if (selectionIsNonEmptyInSentence()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const range = getMarkRangeInQuery(mark);
    if (!range?.text) {
      const id = mark.dataset.scrollRule || mark.dataset.ruleId || "";
      if (id) {
        if (scrollToOwnedRuleOnLookup(id)) return;
        goToRuleInNotebook(id);
      }
      return;
    }
    state.selApply = range;
    const viewId = mark.dataset.scrollRule || mark.dataset.ruleId || "";
    const inv = state.lastInventory;
    let n = 0;
    if (inv?.items && range.start >= 0) {
      n = inv.items.filter((it) => {
        if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
          return !(range.end <= Number(it.start) || range.start >= Number(it.end));
        }
        return String(it.span || "").trim() === range.text;
      }).length;
    }
    showSelApplyPop(e.clientX, e.clientY, range.text, {
      note: n > 0 ? `已有 ${n} 則規則 · 可再疊加其他規則` : "可為此片段套用規則",
      viewRuleId: viewId,
    });
  }

  function openRulePickModal() {
    const cap = state.selApply;
    if (!cap?.text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    if (state.locateTarget?.ruleId) {
      hideSelApplyPop();
      assignManualLocation(state.locateTarget.ruleId, cap);
      state.selApply = null;
      window.getSelection()?.removeAllRanges();
      return;
    }
    state.rulePickMode = null;
    hideSelApplyPop();
    const modal = $("#rule-pick-modal");
    const titleEl = $("#rule-pick-modal-title");
    const preview = $("#rule-pick-span-preview");
    const sub = modal?.querySelector(".modal-sub");
    if (titleEl) titleEl.textContent = "套用規則";
    if (preview) preview.textContent = cap.text;
    if (sub) {
      sub.innerHTML =
        `選取片段：<strong id="rule-pick-span-preview" class="rule-pick-span">${esc(
          cap.text
        )}</strong> — 依選取字<strong>本地</strong>推送可能規則置頂；只影響本句，不改筆記本。`;
    }
    const createHint = $(".rule-pick-create-hint");
    if (createHint) {
      createHint.innerHTML =
        `沒有合適規則卡？用選取字<strong>建立新規則</strong>（名稱可再改；儲存後會套用到此片段）。`;
    }
    const createBtn = $("#btn-rule-pick-create");
    if (createBtn) createBtn.textContent = "建立新規則";
    if (modal) modal.classList.remove("hidden");
    const filter = $("#rule-pick-filter");
    if (filter) {
      filter.value = "";
      setTimeout(() => filter.focus(), 40);
    }
    renderRulePickList();
  }

  function closeRulePickModal() {
    $("#rule-pick-modal")?.classList.add("hidden");
    state.rulePickMode = null;
  }

  function renderRulePickList() {
    const box = $("#rule-pick-list");
    if (!box) return;
    const q = String($("#rule-pick-filter")?.value || "")
      .trim()
      .toLowerCase();
    const suppMode = state.rulePickMode === "supplementary";
    const selText = suppMode ? "" : String(state.selApply?.text || "").trim();

    if (suppMode) {
      let rest = RulesService.getAll().filter(
        (r) =>
          typeof RulesService.isSupplementaryUsage === "function" &&
          RulesService.isSupplementaryUsage(r)
      );
      if (q) {
        rest = rest.filter((r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        });
      }
      if (!rest.length) {
        box.innerHTML = `<p class="projects-empty">尚無「補充用法」規則。請按上方「建立補充用法」。</p>`;
        return;
      }
      box.innerHTML = `<div class="rule-pick-section"><ul class="rule-pick-ul">${rest
        .map(
          (r) => `
        <li class="rule-pick-item">
          <div class="rule-pick-main">
            <p class="rule-pick-title"><span class="badge badge-usage">補充</span> ${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "補充用法")}</p>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">加入</button>
        </li>`
        )
        .join("")}</ul></div>`;
      box.querySelectorAll("[data-pick-rule]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const rule = RulesService.getById(btn.dataset.pickRule);
          if (!rule) return;
          closeRulePickModal();
          addSupplementaryRuleToCurrent(rule);
        });
      });
      return;
    }

    const isSupp = (r) =>
      typeof RulesService.isSupplementaryUsage === "function" &&
      RulesService.isSupplementaryUsage(r);

    let suggestions = [];
    let rest = RulesService.getAll().filter((r) => !isSupp(r));
    if (selText && typeof RulesService.rankRulesForSpan === "function" && !q) {
      const ranked = RulesService.rankRulesForSpan(selText, {
        minScore: 8,
        maxSuggest: 8,
      });
      suggestions = (ranked.suggestions || []).filter((s) => !isSupp(s.rule));
      rest = (ranked.rest || rest).filter((r) => !isSupp(r));
    } else if (q) {
      const all = RulesService.getAll().filter((r) => !isSupp(r));
      if (selText && typeof RulesService.rankRulesForSpan === "function") {
        const ranked = RulesService.rankRulesForSpan(selText, {
          minScore: 6,
          maxSuggest: 12,
        });
        const matchQ = (r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        };
        suggestions = (ranked.suggestions || []).filter(
          (s) => !isSupp(s.rule) && matchQ(s.rule)
        );
        rest = all.filter(
          (r) => matchQ(r) && !suggestions.some((s) => s.rule.id === r.id)
        );
      } else {
        rest = all.filter((r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        });
        suggestions = [];
      }
    }

    if (!suggestions.length && !rest.length) {
      box.innerHTML = `<p class="projects-empty">沒有符合的規則${
        q ? "，試試其他關鍵字" : "。可用上方「建立新規則」用選取字建卡。"
      }</p>`;
      return;
    }

    const itemHtml = (r, extra = {}) => {
      const reason = extra.reason
        ? `<p class="rule-pick-reason">${esc(extra.reason)}</p>`
        : "";
      const badge = extra.suggest
        ? `<span class="badge badge-rule-suggest">建議</span>`
        : "";
      return `
        <li class="rule-pick-item${extra.suggest ? " rule-pick-item-suggest" : ""}">
          <div class="rule-pick-main">
            <p class="rule-pick-title">${badge}${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "未分類")}${
              extra.score != null ? ` · 相關 ${extra.score}` : ""
            }</p>
            ${reason}
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">套用</button>
        </li>`;
    };

    const suggestBlock =
      suggestions.length > 0
        ? `<div class="rule-pick-section">
            <h3 class="rule-pick-section-title">依選取「${esc(selText)}」建議</h3>
            <ul class="rule-pick-ul rule-pick-ul-suggest">${suggestions
              .map((s) =>
                itemHtml(s.rule, {
                  suggest: true,
                  score: s.score,
                  reason: (s.reasons || []).slice(0, 2).join(" · "),
                })
              )
              .join("")}</ul>
          </div>`
        : selText && !q
          ? `<p class="panel-note rule-pick-no-suggest">沒有高分建議，可從下方完整列表選擇或搜尋。</p>`
          : "";

    const restLimit = 80;
    const restSlice = rest.slice(0, restLimit);
    const restBlock =
      restSlice.length > 0
        ? `<div class="rule-pick-section">
            ${
              suggestions.length
                ? `<h3 class="rule-pick-section-title">其他規則</h3>`
                : ""
            }
            <ul class="rule-pick-ul">${restSlice.map((r) => itemHtml(r)).join("")}</ul>
            ${
              rest.length > restLimit
                ? `<p class="panel-note">僅顯示前 ${restLimit} 筆，請縮小搜尋。</p>`
                : ""
            }
          </div>`
        : "";

    box.innerHTML = suggestBlock + restBlock;

    box.querySelectorAll("[data-pick-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = RulesService.getById(btn.dataset.pickRule);
        const cap = state.selApply;
        if (!rule || !cap) return;
        closeRulePickModal();
        addRuleToCurrentResult(rule, cap.text, cap.start, cap.end);
        state.selApply = null;
        window.getSelection()?.removeAllRanges();
      });
    });
  }

  /** 查詢頁「已收錄」區塊內定位規則卡 */
  function scrollToOwnedRuleOnLookup(ruleId) {
    const id = String(ruleId || "").trim();
    if (!id) return false;
    const root = $("#lookup-result");
    if (!root) return false;
    const card =
      root.querySelector(`.rule-card[data-id="${CSS.escape(id)}"]`) ||
      root.querySelector(`#rule-${CSS.escape(id)}`);
    if (!card) return false;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("rule-card-flash");
    void card.offsetWidth;
    card.classList.add("rule-card-flash");
    setTimeout(() => card.classList.remove("rule-card-flash"), 1400);
    return true;
  }

  /**
   * 依目前查詢模式取得盤點結果（不寫入 UI）。
   * 供單句查詢與空專案批次匯入共用。
   */
  async function fetchLookupInventory(query) {
    const form = String(query || "").trim();
    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    if (!anyMode) {
      const inventory = {
        summary: "手動模式",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
      keepExistingTranslation(form, inventory);
      return inventory;
    }
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (needApi && !Storage.hasApiKey()) {
      const err = new Error("此模式需要 API Key，請先到「設定」填入");
      err.code = "NEED_API_KEY";
      throw err;
    }

    const wantApiVocab = Boolean(modes.apiVocab);
    const wantApiGrammar = Boolean(modes.apiGrammar);
    let inventory;

    if (wantApiGrammar) {
      const titles = RulesService.getAll().map((r) => r.title);
      const skipVocab = wantApiVocab;
      if (typeof AiService.inventoryBySchoolParse === "function") {
        try {
          inventory = await AiService.inventoryBySchoolParse(form, titles, { skipVocab });
        } catch (err) {
          console.warn("[school-parse] fallback inventoryGrammar", err);
          inventory = await AiService.inventoryGrammar(form, titles, { skipVocab });
          inventory.fallbackLegacy = true;
          inventory.summary = `${inventory.summary || "舊盤點"} · 切詞未通過已回退`.trim();
        }
      } else {
        inventory = await AiService.inventoryGrammar(form, titles, { skipVocab });
      }
      inventory.mode = "api";
      inventory.source = "api";
    } else {
      inventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }

    // 學校切詞當骨架：hover 詞與 API 對得上（どうして 不被拆開而漏查）
    const tokenSkeleton =
      Array.isArray(inventory.tokens) &&
      inventory.tokens.length &&
      typeof SchoolParse !== "undefined" &&
      SchoolParse.tokensToVocab
        ? SchoolParse.tokensToVocab(inventory.tokens)
        : [];
    if (tokenSkeleton.length) {
      inventory.vocab = mergeInvVocab(tokenSkeleton, inventory.vocab);
    }

    prepareInventoryVocab(inventory, form);

    // API 單字：帶上尚未有意思的實詞清單，漏了再補查一次
    if (wantApiVocab) {
      let apiInv = null;
      const qVocab =
        typeof Storage.stripEnglishFromVocabQuery === "function"
          ? Storage.stripEnglishFromVocabQuery(form)
          : form;
      const hasTarget =
        typeof Storage.vocabQueryHasTargetLanguage === "function"
          ? Storage.vocabQueryHasTargetLanguage(qVocab)
          : Boolean(String(qVocab || "").trim());
      const missingBefore = vocabMissingGloss(inventory.vocab);
      if (hasTarget) {
        if (typeof AiService.inventoryVocabOnly === "function") {
          apiInv = await AiService.inventoryVocabOnly(qVocab, missingBefore);
        } else {
          apiInv = await AiService.inventoryGrammar(qVocab, []);
        }
      }
      if (apiInv) {
        inventory.vocab = mergeInvVocab(inventory.vocab, apiInv.vocab);
        if (apiInv.translation && !inventory.translation) inventory.translation = apiInv.translation;
        const added = (apiInv.vocab || []).length;
        inventory.summary = `${inventory.summary || ""} · ${
          added ? `API 單字 ${added} 詞` : "API 單字已核對"
        }`.trim();
      }
      const stillMissing = vocabMissingGloss(inventory.vocab);
      if (
        hasTarget &&
        stillMissing.length &&
        typeof AiService.inventoryVocabGaps === "function"
      ) {
        try {
          const gapInv = await AiService.inventoryVocabGaps(qVocab, stillMissing);
          inventory.vocab = mergeInvVocab(inventory.vocab, gapInv.vocab);
          const filled = stillMissing.length - vocabMissingGloss(inventory.vocab).length;
          if (filled > 0) {
            inventory.summary = `${inventory.summary || ""} · 補 ${filled} 詞`.trim();
          }
        } catch (err) {
          console.warn("[inventoryVocabGaps]", err);
        }
      }
    }
    keepExistingTranslation(form, inventory);
    return inventory;
  }

  function resolveDisplayedProjectSeq(projectId, query, preferredSeq) {
    const norm = Storage.normalizeQueryKey(query);
    if (preferredSeq != null && projectId) {
      const cur = Storage.findProjectEntryBySeq(projectId, preferredSeq);
      if (cur && (!norm || Storage.normalizeQueryKey(cur.query) === norm)) {
        return cur.seq;
      }
    }
    if (!norm || !projectId) return preferredSeq;
    return Storage.findProjectEntryByQuery(projectId, query)?.seq ?? preferredSeq;
  }

  function applyPersistEntryTarget(payload, opts = {}) {
    if (opts.forceNew) {
      payload.forceNew = true;
      return;
    }
    if (opts.entryId) payload.id = opts.entryId;
    if (opts.entrySeq != null) payload.seq = opts.entrySeq;
    if (payload.id || payload.seq != null) return;
    const pid = opts.projectId || Storage.getActiveProjectId();
    if (!pid || state.projectCursorSeq == null) return;
    const cur = Storage.findProjectEntryBySeq(pid, state.projectCursorSeq);
    if (
      cur &&
      Storage.normalizeQueryKey(cur.query) === Storage.normalizeQueryKey(payload.query)
    ) {
      payload.id = cur.id;
      payload.seq = cur.seq;
    }
  }

  function persistLookupResult(query, inventory, apiHl, opts = {}) {
    keepExistingTranslation(query, inventory, opts);
    prepareInventoryVocab(inventory, query);
    rememberInventoryVocab(inventory, { preferIncoming: false });
    const payload = {
      query,
      summary: inventory.summary || "",
      translation: inventory.translation || "",
      replaceTranslation: Boolean(opts.replaceTranslation),
      ownedCount: (apiHl.legend || []).filter((h) => h.owned).length,
      missingCount: (apiHl.legend || []).filter((h) => !h.owned).length,
      items: inventory.items || [],
      vocab: inventory.vocab || [],
      tokens: inventory.tokens || [],
    };
    applyPersistEntryTarget(payload, opts);
    const activePid = opts.projectId || Storage.getActiveProjectId();
    if (activePid) {
      const before = payload.forceNew
        ? null
        : payload.id
          ? Storage.getProject(activePid)?.entries?.find((e) => e.id === payload.id)
          : Storage.findProjectEntryByQuery(activePid, query);
      const after = Storage.upsertProjectEntry(activePid, payload);
      // keepCursor：背景完成時不把游標跳到剛查完的句子
      const viewing = Storage.getActiveProjectId() === activePid;
      if (after?.seq != null && !opts.keepCursor && viewing) state.projectCursorSeq = after.seq;
      if (!opts.keepCursor && viewing) updateProjectModeUI();
      else updateLookupNavBtns();
      if (!opts.silent) {
        if (before) {
          showToast(`已更新第 ${after?.seq} 號快照（序號不變）`, "success");
        } else {
          showToast(`已加入專案第 ${after?.seq} 號`, "success");
        }
      }
    } else {
      Storage.addHistoryEntry(payload);
      updateLookupNavBtns();
    }
    return payload;
  }

  async function runLookup(q) {
    if (state.bulkImport?.running) {
      if (isViewingBulkProject()) {
        showToast("此專案正在整批分析，可用 ← → 或「句子列表」先看已完成的句子", "info");
      } else {
        showToast("另有專案正在整批分析。可先看目前專案已有句子，或按提示列回到分析中的專案", "info");
      }
      return;
    }
    const form = String(q ?? $("#lookup-input")?.value ?? "").trim();
    if (!form) {
      showToast("請輸入查詢內容", "error");
      return;
    }
    if (q != null && $("#lookup-input")) $("#lookup-input").value = form;
    state.lastQuery = form;
    // 新查詢：清除選字／定位狀態
    state.selApply = null;
    state.locateTarget = null;
    document.body.classList.remove("locate-mode-active");
    hideSelApplyPop();
    closeRulePickModal();

    const box = $("#lookup-result");
    if (!box) return;

    const modes = Storage.loadLookupModes();
    const needApi = modes.apiGrammar || modes.apiVocab;

    if (needApi && !Storage.hasApiKey()) {
      showToast("此模式需要 API Key，請先到「設定」填入", "error");
      setView("settings");
      return;
    }

    // 手動：即時完成，不必走背景 token
    if (!needApi) {
      state.lookupBusy = true;
      try {
        const inventory = await fetchLookupInventory(form);
        state.lastInventory = inventory;
        const apiHl =
          applyInventoryToLookup(form, inventory) || buildApiHighlight(form, inventory);
        persistLookupResult(form, inventory, apiHl, { silent: true });
        showToast("已顯示句子 · 可選字套用規則（未開啟掃描模式）", "info");
      } catch (err) {
        console.error("[lookup-manual]", err);
        showToast(err.message || "查詢失敗", "error");
        if (box) {
          box.innerHTML = `<div class="lookup-result-stack">
            <div class="sentence-board" id="sentence-board">
              <p class="sentence-label"><span class="sentence-label-main">查詢內容</span></p>
              ${sentenceTextBlockHtml(esc(form))}
            </div>
            <div class="lookup-result-body">
              <section class="panel">
                <div class="result-banner error" style="margin:0">
                  <strong>查詢失敗</strong>
                  <span>${esc(err.message || "未知錯誤")}</span>
                </div>
              </section>
            </div>
          </div>`;
        }
      } finally {
        state.lookupBusy = false;
        syncProjectBulkImport();
      }
      return;
    }

    const myToken = ++state.lookupToken;
    state.lookupBusy = true;
    state.pendingLookupQuery = form;
    state.lastSearch = null;

    const loadingBits = [];
    if (modes.apiGrammar) loadingBits.push("文法點");
    if (modes.apiVocab) loadingBits.push("單字原形");
    const loadingHtml = `
      <section class="panel" id="api-inventory-slot">
        <div class="panel-head">
          <h3>查詢中</h3>
          <span class="badge badge-api-fallback">請稍候…</span>
        </div>
        <p class="panel-note">正在處理：${esc(loadingBits.join(" · "))}…</p>
        <p class="panel-note muted">查詢期間可用 → 或「歷史」查看已查過的句子，不會中斷 API。</p>
      </section>
    `;
    const loadingStack = `<div class="lookup-result-stack">
      <div class="sentence-board" id="sentence-board">
        <p class="sentence-label"><span class="sentence-label-main">查詢內容 · 盤點中…</span></p>
        ${sentenceTextBlockHtml(esc(form))}
      </div>
      <div class="lookup-result-body">${loadingHtml}</div>
    </div>`;
    state.pendingLookupLoadingHtml = loadingStack;
    box.innerHTML = loadingStack;
    syncAppHeaderHeight();
    updateBackgroundLookupBanner();
    syncProjectBulkImport();

    try {
      const inventory = await fetchLookupInventory(form);

      const stillMine = myToken === state.lookupToken;
      const stillViewing = stillMine && isViewingLookupQuery(form);
      const activePid = Storage.getActiveProjectId();
      const vocabNote = inventory.vocab?.length ? ` · 詞彙 ${inventory.vocab.length}` : "";

      if (stillViewing) {
        state.lastInventory = inventory;
        const apiHl =
          applyInventoryToLookup(form, inventory) || buildApiHighlight(form, inventory);
        const ownedCount = (apiHl.legend || []).filter((h) => h.owned).length;
        const missingCount = (apiHl.legend || []).filter((h) => !h.owned).length;
        persistLookupResult(form, inventory, apiHl, { silent: true });
        const fallbackNote = inventory.fallbackLegacy ? " · 已用舊盤點" : "";
        const mapNote = inventory.mappingFailed ? " · 對卡未完成" : "";
        if (activePid) {
          showToast(
            `已存入專案第 ${state.projectCursorSeq ?? "?"} 號 · 已收錄 ${ownedCount} · 尚未 ${missingCount}${vocabNote}${fallbackNote}${mapNote}`,
            inventory.fallbackLegacy ? "info" : "success"
          );
        } else {
          showToast(
            `已收錄 ${ownedCount} · 尚未 ${missingCount}${vocabNote}${fallbackNote}${mapNote}`,
            inventory.fallbackLegacy ? "info" : "success"
          );
        }
      } else {
        // 使用者已切到其他已查過句子：只寫入儲存，不覆寫畫面
        const apiHl = buildApiHighlight(form, inventory);
        persistLookupResult(form, inventory, apiHl, {
          silent: true,
          keepCursor: true,
        });
        if (stillMine) {
          const where = activePid ? "專案" : "歷史";
          showToast(
            `「${truncateQueryPreview(form)}」查詢完成，已存入${where}${vocabNote}`,
            "success"
          );
        }
      }
    } catch (err) {
      const stillMine = myToken === state.lookupToken;
      if (stillMine && isViewingLookupQuery(form)) {
        box.innerHTML = `<div class="lookup-result-stack">
        <div class="sentence-board" id="sentence-board">
          <p class="sentence-label"><span class="sentence-label-main">查詢內容</span></p>
          ${sentenceTextBlockHtml(esc(form))}
        </div>
        <div class="lookup-result-body">
        <section class="panel" id="api-inventory-slot">
          <div class="result-banner error" style="margin:0">
            <strong>查詢失敗</strong>
            <span>${esc(err.message || "未知錯誤")}</span>
          </div>
        </section>
        </div>
      </div>`;
      }
      if (stillMine) {
        showToast(err.message || "API 失敗", "error");
      }
    } finally {
      clearPendingLookup(myToken);
    }
  }

  function exportRules() {
    const json =
      typeof Storage.exportDataJSON === "function"
        ? Storage.exportDataJSON(RulesService.getAll())
        : Storage.exportRulesJSON(RulesService.getAll());
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `koto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const nProj = typeof Storage.listProjects === "function" ? Storage.listProjects().length : 0;
    showToast(
      nProj ? `已匯出規則與 ${nProj} 個專案` : "已匯出規則 JSON",
      "success"
    );
  }

  function importRules(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        if (typeof Storage.importDataJSON === "function") {
          const result = Storage.importDataJSON(text, "merge");
          RulesService.setAll(result.rules);
          let msg = `已匯入規則，目前共 ${result.rules.length} 筆`;
          if (result.projects) {
            msg += ` · 專案 +${result.projects.added}／更新 ${result.projects.updated}`;
          }
          showToast(msg, "success");
          updateProjectModeUI();
          if (result.projects && typeof Storage.flushProjects === "function") {
            Storage.flushProjects().catch((err) => console.warn("[import flush]", err));
          }
        } else {
          const merged = Storage.importRulesJSON(text, "merge");
          RulesService.setAll(merged);
          showToast(`已匯入，目前共 ${merged.length} 筆規則`, "success");
        }
        if (state.view === "rules") renderRulesList();
        updateRuleCount();
      } catch (err) {
        showToast("匯入失敗：" + err.message, "error");
      }
    };
    reader.readAsText(file);
  }

  function renderVocabBankList() {
    const box = $("#vocab-bank-list");
    const countEl = $("#vocab-bank-count");
    if (!box) return;
    const filterQ = String($("#vocab-bank-filter")?.value || "").trim();
    const list =
      typeof Storage.listVocabBankEntries === "function"
        ? Storage.listVocabBankEntries(filterQ)
        : [];
    if (countEl) {
      countEl.textContent = filterQ
        ? `篩選後 ${list.length} 筆 · 本地單字會自動套用到新句子`
        : `共 ${list.length} 筆 · 手改會寫入詞庫；多義可設主要義或刪義項`;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>${
        filterQ
          ? "沒有符合的單字。"
          : "單字本還是空的。<br/>查詢後可選字編輯，或開「API 單字」補意思；手改會寫入這裡。"
      }</p></div>`;
      return;
    }
    box.innerHTML = `<ul class="vocab-bank-list">${list
      .map((e) => {
        const senses = Array.isArray(e.senses) ? e.senses : [];
        const senseHtml = senses
          .map((s) => {
            const isP = s.id === e.primarySenseId;
            return `<li class="vocab-bank-sense${isP ? " is-primary" : ""}">
              <span class="vocab-bank-sense-gloss">${esc(s.gloss || "（無意思）")}</span>
              ${s.lemma ? `<span class="muted"> · ${esc(s.lemma)}</span>` : ""}
              ${isP ? `<span class="badge badge-local">主要</span>` : ""}
              <span class="vocab-bank-sense-actions">
                ${
                  !isP
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-vb-primary="${esc(
                        e.key
                      )}" data-sense-id="${esc(s.id)}">設為主要</button>`
                    : ""
                }
                <button type="button" class="btn btn-sm btn-danger-ghost" data-vb-del-sense="${esc(
                  e.key
                )}" data-sense-id="${esc(s.id)}">刪義項</button>
              </span>
            </li>`;
          })
          .join("");
        return `<li class="vocab-bank-item" data-key="${esc(e.key)}">
          <div class="vocab-bank-main">
            <p class="vocab-bank-surface"><span class="pos-line" data-pos-kind="${esc(
              posUnderlineKind(e.pos)
            )}" data-lemma="${esc(e.lemma || "")}" data-reading="${esc(
              e.reading || ""
            )}" title="${
              e.lemma ? esc(`點擊複製並朗讀原形「${e.lemma}」`) : ""
            }">${esc(e.surface || e.key)}</span>${
              e.senseCount > 1
                ? `<span class="badge badge-api-fallback">${e.senseCount} 義</span>`
                : ""
            }</p>
            <p class="vocab-bank-meta muted">
              ${e.reading ? `讀音 ${esc(e.reading)} · ` : ""}${
                e.lemma ? `原形 ${esc(e.lemma)} · ` : ""
              }${e.pos ? esc(e.pos) : ""}
            </p>
            <p class="vocab-bank-gloss">${esc(e.gloss || "—")}</p>
            ${
              senses.length > 1
                ? `<ul class="vocab-bank-senses">${senseHtml}</ul>`
                : ""
            }
          </div>
          <div class="vocab-bank-actions">
            <button type="button" class="btn btn-sm btn-danger-ghost" data-vb-delete="${esc(
              e.key
            )}">刪除詞</button>
          </div>
        </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".vocab-bank-surface .pos-line[data-lemma]").forEach((el) => {
      if (!String(el.dataset.lemma || "").trim()) return;
      el.addEventListener("click", () =>
        copyLemmaToClipboard(el.dataset.lemma, {
          speak: el.dataset.reading || el.dataset.lemma,
        })
      );
    });
    box.querySelectorAll("[data-vb-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbDelete;
        if (!key || !confirm(`刪除「${key}」及其所有義項？`)) return;
        Storage.removeVocabBankEntry(key);
        renderVocabBankList();
        showToast("已刪除單字", "info");
      });
    });
    box.querySelectorAll("[data-vb-del-sense]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbDelSense;
        const sid = btn.dataset.senseId;
        if (!key || !sid) return;
        Storage.removeVocabBankSense(key, sid);
        renderVocabBankList();
        showToast("已刪除義項", "info");
      });
    });
    box.querySelectorAll("[data-vb-primary]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbPrimary;
        const sid = btn.dataset.senseId;
        if (!key || !sid) return;
        Storage.setVocabBankPrimarySense(key, sid);
        renderVocabBankList();
        showToast("已設為主要義項", "success");
      });
    });
  }

  function bindEvents() {
    bindPadChrome();
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-pos-toggle]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      togglePosUnderline(btn.dataset.posToggle);
    });
    $$(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "projects") {
          onNavProjects();
          return;
        }
        const v = btn.dataset.view;
        if (v && v !== "form") setView(v);
      });
    });

    $("#lookup-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      runLookup();
    });

    $("#lookup-input")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      if (e.shiftKey) return;
      e.preventDefault();
      const form = $("#lookup-form");
      if (form?.requestSubmit) form.requestSubmit();
      else runLookup();
    });
    $("#lookup-input")?.addEventListener("input", () => {
      if (isProjectMode()) updateProjectModeUI();
      if (state.lookupBusy) updateBackgroundLookupBanner();
    });

    $("#btn-new-rule")?.addEventListener("click", () => openForm({ mode: "create", source: "manual" }));
    $("#vocab-bank-filter")?.addEventListener("input", () => renderVocabBankList());
    $("#rule-form")?.addEventListener("submit", saveForm);
    $("#form-requires-conjugation")?.addEventListener("change", (e) => {
      toggleConjugationBlock(e.target.checked);
    });
    $("#btn-form-cancel")?.addEventListener("click", () => {
      if (state.aiBusy && state.aiJob?.status === "running") {
        setView(getFormReturnView());
        if (state.formReturnView === "lookup") restoreLookupFromCacheIfNeeded();
        showToast("AI 仍在背景填寫，草稿已保留", "info");
        return;
      }
      state.todoSourceId = null;
      const backToLookup =
        state.lastQuery &&
        (state.formSource === "from-lookup" ||
          state.formSource === "from-selection" ||
          state.editingId ||
          state.lastInventory);
      state.editingId = null;
      state.formSource = null;
      state.pendingSelApply = null;
      state.pendingSupplementaryApply = false;
      if (backToLookup) {
        setView("lookup");
        restoreLookupFromCacheIfNeeded();
      } else {
        setView(getFormReturnView());
      }
    });
    $("#btn-ai-job-form")?.addEventListener("click", () => returnToAiForm());
    $("#btn-ai-job-dismiss")?.addEventListener("click", () => dismissAiJobBar());
    $("#rules-filter")?.addEventListener("input", () => renderRulesList());
    $("#history-filter")?.addEventListener("input", () => renderHistory());
    $("#btn-lookup-seq-prev")?.addEventListener("click", () => onLookupSeqPrev());
    $("#btn-lookup-seq-next")?.addEventListener("click", () => onLookupSeqNext());

    $("#btn-projects-modal-close")?.addEventListener("click", () => closeProjectsModal());
    $("#projects-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectsModal();
    });
    $("#btn-projects-crumb-root")?.addEventListener("click", () => {
      state.projectsBrowseId = null;
      renderProjectsList();
      $("#project-new-name")?.focus();
    });
    $("#project-mode-collection")?.addEventListener("click", () => {
      const p = Storage.getActiveProject();
      openProjectsModal({ browseId: p ? p.collectionId || "" : null });
    });
    bindCollectionCrumbRename();
    $("#btn-project-create")?.addEventListener("click", () => createProjectFromModal());
    $("#project-new-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createProjectFromModal();
      }
    });
    bindProjectNameEdit();
    $("#btn-project-leave")?.addEventListener("click", () => leaveProject());
    $("#btn-project-entries")?.addEventListener("click", () => openProjectEntriesModal());
    $("#project-bulk-input")?.addEventListener("input", () => updateBulkImportHint());
    $("#btn-project-bulk-split")?.addEventListener("click", () => applyBulkSentenceBreaks());
    $("#btn-project-bulk-split-comma")?.addEventListener("click", () => applyBulkCommaBreaks());
    $("#btn-project-bulk-run")?.addEventListener("click", () => runProjectBulkImport());
    $("#btn-project-bulk-cancel")?.addEventListener("click", () => cancelProjectBulkImport());
    $("#btn-project-bulk-clear")?.addEventListener("click", () => {
      const ta = $("#project-bulk-input");
      if (ta) ta.value = "";
      updateBulkImportHint();
      ta?.focus();
    });
    $("#btn-project-entries-modal-close")?.addEventListener("click", () =>
      closeProjectEntriesModal()
    );
    $("#project-entries-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectEntriesModal();
    });
    $("#project-entries-filter")?.addEventListener("input", () => {
      const pid = Storage.getActiveProjectId();
      if (pid) renderProjectEntriesList(pid);
    });

    // 選字／已標片段：套用規則（可疊加）
    $("#btn-sel-apply-rule")?.addEventListener("click", () => openRulePickModal());
    $("#btn-sel-vocab")?.addEventListener("click", () => openVocabEditModal());
    $("#btn-vocab-edit-close")?.addEventListener("click", () => closeVocabEditModal());
    $("#btn-vocab-edit-cancel")?.addEventListener("click", () => closeVocabEditModal());
    $("#btn-vocab-edit-ai")?.addEventListener("click", () => runVocabEditAi());
    $("#vocab-edit-form")?.addEventListener("submit", saveVocabEditForm);
    {
      const overlay = $("#vocab-edit-modal");
      let pressOnOverlay = false;
      overlay?.addEventListener("mousedown", (e) => {
        pressOnOverlay = e.target === overlay;
      });
      overlay?.addEventListener("click", (e) => {
        if (pressOnOverlay && e.target === overlay) closeVocabEditModal();
        pressOnOverlay = false;
      });
    }
    $("#btn-sel-view-rule")?.addEventListener("click", () => {
      const id = $("#btn-sel-view-rule")?.dataset?.ruleId;
      hideSelApplyPop();
      if (id) {
        if (scrollToOwnedRuleOnLookup(id)) return;
        goToRuleInNotebook(id);
      }
    });
    $("#btn-sel-apply-cancel")?.addEventListener("click", () => {
      hideSelApplyPop();
      state.selApply = null;
      if (state.locateTarget) {
        showToast("可再選一次片段，或按上方「取消」結束定位", "info");
      }
      window.getSelection()?.removeAllRanges();
    });
    $("#btn-rule-pick-close")?.addEventListener("click", () => closeRulePickModal());
    $("#btn-rule-pick-create")?.addEventListener("click", () => openCreateRuleFromSelection());
    $("#rule-pick-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeRulePickModal();
    });
    $("#rule-pick-filter")?.addEventListener("input", () => renderRulePickList());
    const dismissSelApplyIfOutside = (e) => {
      const pop = $("#sel-apply-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      // 在句子板內準備重選時不先關掉（等 mouseup／touchend 再更新）
      if (
        e.target.closest &&
        e.target.closest("#sentence-text, #sentence-board")
      ) {
        return;
      }
      hideSelApplyPop();
    };
    document.addEventListener("pointerdown", dismissSelApplyIfOutside);
    const revealSelApplyOutsideBoard = (e) => {
      if (state.view !== "lookup") return;
      if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, input, textarea")) {
        return;
      }
      const sentenceEl = $("#sentence-text");
      if (!sentenceEl) return;
      if (e.target.closest && e.target.closest("#sentence-board")) return;
      if (!shouldRevealSelApplyFromGesture()) return;
      suppressWordTipClick = true;
      const point = eventClientPoint(e);
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        showSelApplyPop(point.x, point.y, cap.text, {});
      });
    };
    document.addEventListener("mouseup", revealSelApplyOutsideBoard);
    document.addEventListener("touchend", revealSelApplyOutsideBoard, { passive: true });
    let selChangeTimer = 0;
    document.addEventListener("selectionchange", () => {
      if (!isCoarsePointer() || state.view !== "lookup") return;
      if (!shouldRevealSelApplyFromGesture()) return;
      clearTimeout(selChangeTimer);
      selChangeTimer = window.setTimeout(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        let x = NaN;
        let y = NaN;
        try {
          const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.bottom;
        } catch {
          /* ignore */
        }
        showSelApplyPop(x, y, cap.text, {});
      }, 380);
    });

    document.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-sentence-select-edit]");
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleSentenceSelectEdit();
        return;
      }
      const btn = e.target.closest("[data-speak-sentence]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      speakCurrentSentence();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("#vocab-edit-modal")?.classList.contains("hidden")) {
          closeVocabEditModal();
          return;
        }
        if (!$("#rule-pick-modal")?.classList.contains("hidden")) {
          closeRulePickModal();
          return;
        }
        if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
          hideSelApplyPop();
          state.selApply = null;
          return;
        }
        if (isSentenceSelectEdit()) {
          setSentenceSelectEdit(false);
          return;
        }
        if (state.locateTarget) {
          cancelLocateMode();
          showToast("已取消定位", "info");
          return;
        }
        if (!$("#project-entries-modal")?.classList.contains("hidden")) {
          closeProjectEntriesModal();
          return;
        }
        if (!$("#projects-modal")?.classList.contains("hidden")) {
          closeProjectsModal();
        }
        return;
      }

      // WASD／ZXCVBNM／方向鍵（輸入中不攔截）
      handleAppHotkeys(e);
    });

    $("#btn-ai-complete")?.addEventListener("click", () => runAiComplete());
    $("#settings-form")?.addEventListener("submit", saveSettingsForm);
    $("#settings-api-tts")?.addEventListener("change", () => onApiTtsToggle());
    $("#settings-mode-api-grammar")?.addEventListener("change", () =>
      onLookupModeToggle("apiGrammar")
    );
    $("#settings-mode-api-vocab")?.addEventListener("change", () =>
      onLookupModeToggle("apiVocab")
    );
    $("#btn-settings-modes-all")?.addEventListener("click", () => onSettingsModesAllClick());
    $("#btn-test-api")?.addEventListener("click", () => testApiConnection());
    $("#btn-clear-key")?.addEventListener("click", clearApiKey);
    $("#settings-api-provider")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-api-provider]");
      if (!btn) return;
      switchApiProvider(btn.dataset.apiProvider);
    });
    $("#settings-model-shortcuts")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-model-id]");
      if (!btn) return;
      applyModelShortcut(btn.dataset.modelId);
    });
    $("#btn-toggle-key")?.addEventListener("click", () => {
      const input = $("#settings-api-key");
      const btn = $("#btn-toggle-key");
      if (!input || !btn) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "隱藏" : "顯示";
    });
    $("#btn-export")?.addEventListener("click", exportRules);
    $("#btn-import")?.addEventListener("click", () => $("#import-file")?.click());
    $("#import-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importRules(file);
      e.target.value = "";
    });
    $("#btn-clear-history")?.addEventListener("click", () => clearAllHistory());
    $("#btn-reset-seed")?.addEventListener("click", async () => {
      if (!confirm("將清除所有本地規則與待辦，並重新載入種子資料。專案與 API Key 不受影響。確定？")) return;
      Storage.resetToSeed();
      await RulesService.init();
      state.lastSearch = null;
      state.lastQuery = "";
      state.lastInventory = null;
      showToast("已重設為種子資料", "success");
      setView("rules");
      renderRulesList();
    });
  }

  /** 量測頂欄高度，讓句中 sticky 列精準貼在下方 */
  function syncAppHeaderHeight() {
    const header = document.querySelector(".app-header");
    if (header) {
      const h = Math.ceil(header.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty("--app-header-h", `${h}px`);
      }
    }
    const vv = window.visualViewport;
    const vh = Math.round((vv && vv.height) || window.innerHeight);
    if (vh > 0) {
      document.documentElement.style.setProperty("--vvh", `${vh}px`);
    }
  }

  async function init() {
    updateTokenizerStatus();
    try {
      if (typeof Storage.initProjectsDb === "function") {
        await Storage.initProjectsDb();
      }
    } catch (err) {
      console.warn("[projects idb init]", err);
    }
    const tokPromise =
      typeof JaTokenizer !== "undefined"
        ? JaTokenizer.init("dict/").then(() => {
            updateTokenizerStatus();
          })
        : Promise.resolve();

    await RulesService.init();
    try {
      if (typeof Storage.harvestVocabBankFromSnapshots === "function") {
        const n = Storage.harvestVocabBankFromSnapshots();
        if (n > 0) console.info(`[vocab-bank] harvested ${n} entries from history/projects`);
      }
    } catch (err) {
      console.warn("[vocab-bank] harvest failed", err);
    }
    try {
      if (typeof Storage.purgeImportedDictVocab === "function") {
        const p = Storage.purgeImportedDictVocab();
        if (p && !p.skipped && (p.bank || p.history || p.projects)) {
          const bits = [];
          if (p.bank) bits.push(`單字庫 ${p.bank} 筆`);
          if (p.history) bits.push(`歷史 ${p.history} 詞`);
          if (p.projects) bits.push(`專案 ${p.projects} 詞`);
          showToast(`已清除 JMdict 帶入的英文單字（${bits.join(" · ")}）`, "success");
        }
      }
    } catch (err) {
      console.warn("[vocab-bank] purge imported dict failed", err);
    }
    try {
      if (typeof Storage.flushProjects === "function") {
        await Storage.flushProjects();
      }
    } catch (err) {
      console.warn("[projects idb flush]", err);
    }
    bindEvents();
    updateApiStatusDot();
    updateLookupModeUI();
    applyStructureTheme(Storage.loadSettings().structureTheme);
    if (Storage.getActiveProjectId()) {
      state.projectCursorSeq = null;
    }
    updateProjectModeUI();
    syncAppHeaderHeight();
    window.addEventListener("resize", () => syncAppHeaderHeight());
    window.addEventListener("orientationchange", () => syncAppHeaderHeight());
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => syncAppHeaderHeight());
    }
    setView("lookup");
    renderLookupResult(null);
    updateRuleCount();
    updateLookupNavBtns();
    requestAnimationFrame(() => syncAppHeaderHeight());

    tokPromise.catch((err) => {
      console.warn(err);
      updateTokenizerStatus();
    });
    await Promise.race([tokPromise, new Promise((r) => setTimeout(r, 50))]);
    updateTokenizerStatus();
  }

  return { init, openForm };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init().catch((err) => {
    console.error(err);
    const box = document.getElementById("lookup-result");
    if (box) {
      box.innerHTML = `<div class="result-banner error"><strong>初始化失敗</strong><span>${escSafe(err.message)}</span></div>`;
    }
  });
});

function escSafe(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}
