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
    /** 專案模式目前游標序號 */
    projectCursorSeq: null,
    /** 選字套用：{ text, start, end } */
    selApply: null,
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
    const needApi = modes.apiGrammar || modes.apiVocab;
    const ready = Storage.hasApiKey();
    const anyMode = modes.apiGrammar || modes.localGrammar || modes.apiVocab;
    // 手動模式（全關）仍可用；僅「開了 API 卻沒 Key」為未就緒
    dot.classList.toggle("ready", anyMode ? (needApi ? ready : true) : true);
    if (!anyMode) {
      dot.title = "手動模式（未開掃描 · 仍可查詢）";
    } else if (!needApi) {
      dot.title = "本地文法排查（不呼叫 API）";
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
      if (modes.localGrammar) bits.push("<strong>本地文法</strong>");
      if (modes.apiVocab) bits.push("<strong>API 單字</strong>");
      if (!bits.length) {
        const empty =
          "目前：手動模式 · 可直接查詢並選字套用（右側可再開 API／本地掃描）";
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
    const localG = $("#settings-mode-local-grammar");
    const apiV = $("#settings-mode-api-vocab");
    if (apiG) apiG.checked = Boolean(modes.apiGrammar);
    if (localG) localG.checked = Boolean(modes.localGrammar);
    if (apiV) apiV.checked = Boolean(modes.apiVocab);
    const keyReq = $("#settings-api-key-req");
    if (keyReq) keyReq.hidden = !(modes.apiGrammar || modes.apiVocab);
    syncSettingsModesAllBtn(modes);
    updateApiStatusDot();
  }

  /** 全部開啟：API 文法 + API 單字（本地關閉，因文法互斥） */
  function areAllLookupModesOn(modes) {
    const m = modes || Storage.loadLookupModes();
    return Boolean(m.apiGrammar && m.apiVocab && !m.localGrammar);
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
    if (view === "todos") renderTodos();
    if (view === "history") renderHistory();
    if (view === "settings") fillSettingsForm();
    if (view === "lookup") {
      updateLookupModeUI();
      // 從表單／其他頁回到查詢：若結果區被清掉但尚有快照，用快照重畫（不呼叫 API）
      restoreLookupFromCacheIfNeeded();
    }
    updateRuleCount();
    updateApiStatusDot();
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
  function applyInventoryToLookup(query, inventory, opts = {}) {
    const q = String(query || "").trim();
    const box = $("#lookup-result");
    if (!box || !q) return null;

    const inv = {
      summary: inventory?.summary || "",
      translation: inventory?.translation || "",
      items: Array.isArray(inventory?.items) ? inventory.items : [],
      vocab: Array.isArray(inventory?.vocab) ? inventory.vocab : [],
      mode: inventory?.mode || inventory?.source || "",
    };
    state.lastQuery = q;
    state.lastInventory = inv;
    const input = $("#lookup-input");
    if (input) input.value = q;

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

    box.innerHTML =
      renderApiSentenceBoard(q, apiHl.spans, apiHl.legend, {
        vocab: Array.isArray(inv.vocab) ? inv.vocab : [],
        translation: inv.translation,
        source: isLocal ? "local" : "api",
      }) +
      ownedHtml +
      inventoryHtml(inv, q);

    bindApiInventoryEvents(q, inv);
    bindRuleCardActions(box);
    bindWordTipHovers(box);
    updateLookupNavBtns();
    return apiHl;
  }

  function reviewHistoryWithCurrentRules(entry) {
    if (!entry?.query) return;
    // 允許 items 為空：仍還原句子與結果區（當時無文法標記也可回看）
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
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
        },
        { fromHistory: true }
      ) ||
      buildApiHighlight(entry.query, {
        items,
        summary: entry.summary,
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
    });
    updateLookupNavBtns();
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
        },
        { fromHistory: true }
      ) ||
      buildApiHighlight(entry.query, {
        items,
        summary: entry.summary,
      });
    const ownedCount = (apiHl.legend || []).filter((h) => h.owned).length;
    const missingCount = (apiHl.legend || []).filter((h) => !h.owned).length;
    const pid = Storage.getActiveProjectId();
    if (pid) {
      Storage.upsertProjectEntry(pid, {
        query: entry.query,
        summary: entry.summary || "",
        translation: entry.translation || "",
        ownedCount,
        missingCount,
        items,
        vocab,
      });
    }
    updateProjectModeUI();
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
      box.innerHTML = `<div class="empty-state"><p>還沒有查詢紀錄。<br/>到「查詢」輸入句子並完成 API 盤點後會出現在這裡。</p></div>`;
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
        ? `回到專案「${project.name || "未命名"}」（離開請用查詢頁「離開專案」）`
        : "建立、開啟或管理專案（歌詞等連貫文本）";
    }

    if (inProject) {
      const nameEl = $("#project-mode-name");
      const posEl = $("#project-mode-pos");
      if (nameEl) nameEl.textContent = project.name || "未命名專案";
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;
      let curSeq = state.projectCursorSeq;
      const curQ = String($("#lookup-input")?.value || "").trim();
      if (curQ) {
        const hit = Storage.findProjectEntryByQuery(project.id, curQ);
        if (hit) curSeq = hit.seq;
      }
      if (posEl) {
        if (total === 0) {
          posEl.textContent = "尚無句子 · 查詢後會編為第 1 號";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          const idx = entries.findIndex((e) => e.seq === curSeq) + 1;
          posEl.textContent = `第 ${curSeq} 號 · ${idx}/${total} 句`;
        } else {
          posEl.textContent = `共 ${total} 句 · 查新句會接續編號`;
        }
      }
    }

    updateLookupNavBtns();
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
          const hit = Storage.findProjectEntryByQuery(project?.id, curQ);
          if (hit) curSeq = hit.seq;
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
        prevBtn.title = "上一號句子";
        prevBtn.setAttribute("aria-label", "上一號句子");
      }
      nextBtn.disabled = total === 0 || (curIdx >= 0 && curIdx >= total - 1);
      nextBtn.title = "下一號句子";
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
    nextBtn.title = has ? "再看歷史中的上一句（本機紀錄）" : "尚無查詢歷史";
    nextBtn.setAttribute("aria-label", has ? "再看歷史上一句" : "尚無查詢歷史");
  }

  function resolveProjectCursorIndex(entries) {
    if (!entries?.length) return -1;
    let curSeq = state.projectCursorSeq;
    const curQ = String($("#lookup-input")?.value || "").trim();
    if (curQ) {
      const hit = entries.find(
        (e) => Storage.normalizeQueryKey(e.query) === Storage.normalizeQueryKey(curQ)
      );
      if (hit) curSeq = hit.seq;
    }
    if (curSeq == null) return -1;
    return entries.findIndex((e) => e.seq === curSeq);
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

  /**
   * 查詢頁方向鍵導航：← 上一句 · → 下一句
   * @returns {boolean} 是否已處理
   */
  function handleLookupArrowNav(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (state.view !== "lookup") return false;
    if (state.lookupBusy) return false;
    if (isEditableKeyTarget(e.target)) return false;
    // modal / 浮層開啟時不導航
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return false;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return false;
    if (!$("#projects-modal")?.classList.contains("hidden")) return false;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return false;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return false;
    if (state.locateTarget) return false;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onLookupSeqPrev();
      return true;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onLookupSeqNext();
      return true;
    }
    return false;
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

  function openProjectsModal() {
    if (Storage.getActiveProjectId()) {
      onNavProjects();
      return;
    }
    const modal = $("#projects-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    renderProjectsList();
    const input = $("#project-new-name");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 50);
    }
  }

  function closeProjectsModal() {
    $("#projects-modal")?.classList.add("hidden");
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
    const list = Storage.listProjects();
    const activeId = Storage.getActiveProjectId();
    if (!list.length) {
      box.innerHTML = `<p class="projects-empty">尚無專案。輸入名稱後按「建立」，適合歌詞、對話等連貫文本。</p>`;
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
      li.querySelector("[data-proj-delete]")?.addEventListener("click", () => {
        const p = Storage.getProject(id);
        if (!p) return;
        if (
          !confirm(
            `確定刪除專案「${p.name}」？\n內含 ${(p.entries || []).length} 句將一併清除（無法復原）。`
          )
        ) {
          return;
        }
        Storage.deleteProject(id);
        if (!Storage.getActiveProjectId()) {
          state.projectCursorSeq = null;
        }
        updateProjectModeUI();
        renderProjectsList();
        showToast("已刪除專案", "info");
      });
    });
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
      sub.textContent = `「${project.name}」· 共 ${all.length} 句 · 序號永久固定，刪除後不重編`;
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
    state.projectCursorSeq = null;
    closeProjectsModal();
    setView("lookup");
    updateProjectModeUI();
    const entries = Storage.getProjectEntriesSorted(p);
    if (entries.length) {
      reviewProjectEntry(entries[0], { silent: true });
      showToast(`已進入專案「${p.name}」· ${entries.length} 句`, "success");
    } else {
      const input = $("#lookup-input");
      if (input) input.value = "";
      const box = $("#lookup-result");
      if (box) box.innerHTML = "";
      showToast(`已進入專案「${p.name}」· 查詢第一句將編為第 1 號`, "success");
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
    showToast("已離開專案（一般查詢模式）", "info");
  }

  function createProjectFromModal() {
    const input = $("#project-new-name");
    const name = String(input?.value || "").trim();
    if (!name) {
      showToast("請輸入專案名稱", "error");
      input?.focus();
      return;
    }
    const p = Storage.createProject(name);
    if (input) input.value = "";
    renderProjectsList();
    showToast(`已建立「${p.name}」`, "success");
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
    host.innerHTML = `
      <div class="conj-table theme-preview-conj" aria-hidden="true">
        <div class="conj-table-cell conj-ichidan"><span class="conj-key">一段</span><span class="conj-val">去る＋ます</span></div>
        <div class="conj-table-cell conj-godan"><span class="conj-key">五段</span><span class="conj-val">イ段＋ます</span></div>
        <div class="conj-table-cell conj-sahen"><span class="conj-key">サ変</span><span class="conj-val">し＋ます</span></div>
      </div>`;
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

  function fillSettingsForm() {
    const s = Storage.loadSettings();
    $("#settings-api-key").value = s.apiKey || "";
    $("#settings-base-url").value = s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl;
    $("#settings-model").value = s.model || Storage.DEFAULT_SETTINGS.model;
    const input = $("#settings-api-key");
    if (input) input.type = "password";
    const toggle = $("#btn-toggle-key");
    if (toggle) toggle.textContent = "顯示";
    updateLookupModeUI();
    const modes = Storage.loadLookupModes();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    applyStructureTheme(s.structureTheme);
    renderThemePicker(s.structureTheme);
    renderStructureThemePreview();
    if (s.apiKey) {
      setSettingsStatus(
        `已設定 API Key（${maskKey(s.apiKey)}）· 模型 ${s.model} · ${modeLabel}`,
        "ok"
      );
    } else if (needApi) {
      setSettingsStatus("尚未設定 API Key — API 文法／單字與 AI 填寫無法使用", "warn");
    } else if (modes.localGrammar) {
      setSettingsStatus("本地文法排查 · 無需 Key；AI 自動填寫仍需 API Key", "ok");
    } else {
      setSettingsStatus("手動模式 · 可查詢並選字套用（未開掃描）", "ok");
    }
  }

  function readLookupModesFromForm() {
    return {
      apiGrammar: Boolean($("#settings-mode-api-grammar")?.checked),
      localGrammar: Boolean($("#settings-mode-local-grammar")?.checked),
      apiVocab: Boolean($("#settings-mode-api-vocab")?.checked),
    };
  }

  function onLookupModeToggle(changed) {
    const raw = readLookupModesFromForm();
    if (changed === "apiGrammar" && raw.apiGrammar) raw.localGrammar = false;
    if (changed === "localGrammar" && raw.localGrammar) raw.apiGrammar = false;
    const modes = Storage.saveLookupModes(raw);
    updateLookupModeUI();
    const label = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (!modes.apiGrammar && !modes.localGrammar && !modes.apiVocab) {
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
    if (raw.apiGrammar && raw.localGrammar) raw.localGrammar = false;
    const modes = Storage.saveLookupModes(raw);
    const next = Storage.saveSettings({
      apiKey: $("#settings-api-key").value,
      baseUrl: $("#settings-base-url").value,
      model: $("#settings-model").value,
      structureTheme:
        themeBtn?.dataset?.themeId ||
        document.documentElement.getAttribute("data-structure-theme") ||
        Storage.DEFAULT_SETTINGS.structureTheme,
      lookupModes: modes,
    });
    applyStructureTheme(next.structureTheme);
    updateLookupModeUI();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (next.apiKey) {
      setSettingsStatus(
        `已儲存（${maskKey(next.apiKey)}）· 模型 ${next.model} · ${modeLabel}`,
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
    Storage.saveSettings({
      apiKey: $("#settings-api-key").value,
      baseUrl: $("#settings-base-url").value,
      model: $("#settings-model").value,
    });
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
    if (!confirm("確定清除本機儲存的 API Key？")) return;
    Storage.clearApiKey();
    $("#settings-api-key").value = "";
    updateApiStatusDot();
    setSettingsStatus("API Key 已清除", "warn");
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

  async function runAiComplete() {
    if (state.aiBusy) return;
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
      banner.innerHTML = `<strong>AI 查詢中</strong> — 依「${esc(title)}」產生內容…`;
    }
    try {
      const draft = await AiService.completeRuleFromTitle(title);
      $("#form-explanation").value = draft.explanation || "";
      if (draft.category) fillCategorySelect(draft.category);
      if (draft.title) $("#form-title").value = draft.title;
      setConjugationFields(draft);
      if (banner) {
        banner.className = "result-banner success";
        banner.innerHTML = `<strong>AI 已填寫</strong> — 請核對後再儲存。`;
      }
      showToast("AI 已自動填寫", "success");
    } catch (err) {
      if (banner) {
        banner.className = "result-banner error";
        banner.innerHTML = `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`;
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

  function groupBadgeClass(group) {
    if (group === "一段") return "badge-group-ichidan";
    if (group === "五段") return "badge-group-godan";
    if (group === "サ変") return "badge-group-sahen";
    if (group === "カ変") return "badge-group-kahen";
    return "badge-group-unknown";
  }

  function renderAnalysisPanel(analysis, { title = "動詞分析" } = {}) {
    if (!analysis?.primary) return "";
    const p = analysis.primary;
    const confLabel =
      analysis.confidence === "high" ? "高信心" : analysis.confidence === "medium" ? "中等信心" : "低信心";
    const tags = (p.formTags || [])
      .map((t) => `<span class="badge badge-form-tag">${esc(t)}</span>`)
      .join("");
    const steps = (p.steps || [])
      .map(
        (s) => `
        <li class="step-item">
          <span class="step-label">${esc(s.label)}</span>
          <span class="step-text">${esc(s.text)}</span>
        </li>`
      )
      .join("");

    return `
      <section class="panel panel-analysis">
        <div class="panel-head">
          <h3>${esc(title)}</h3>
          <span class="badge badge-api-fallback">${esc(confLabel)}</span>
        </div>
        <div class="analysis-surface">
          <code class="analysis-form">${esc(analysis.form || "")}</code>
        </div>
        <dl class="kv-grid">
          <div><dt>原形</dt><dd><strong>${esc(p.lemma || "?")}</strong></dd></div>
          <div>
            <dt>動詞類型</dt>
            <dd>
              <span class="badge ${groupBadgeClass(p.group)}">${esc(p.groupLabel || p.group || "?")}</span>
            </dd>
          </div>
          <div>
            <dt>活用形</dt>
            <dd>
              <span class="badge badge-form-name">${esc(p.formName || "?")}</span>
              ${tags}
            </dd>
          </div>
          ${
            p.matchedEnding
              ? `<div><dt>偵測語尾</dt><dd><code>${esc(p.matchedEnding)}</code></dd></div>`
              : ""
          }
        </dl>
        ${
          steps
            ? `<div class="field-block steps-block">
                <h4>分項說明</h4>
                <ol class="step-list">${steps}</ol>
              </div>`
            : ""
        }
        ${
          analysis.tokens?.length
            ? `<details class="related-block morpheme-details">
                <summary>形態素（${analysis.tokens.length}）</summary>
                <ul class="morpheme-list">
                  ${analysis.tokens
                    .map(
                      (t) =>
                        `<li><code>${esc(t.text)}</code>
                          <span class="muted">${esc(t.pos || "")}${t.conjugated_form ? " · " + esc(t.conjugated_form) : ""}</span>
                          ${t.basic_form && t.basic_form !== t.text ? `<span class="muted">→ ${esc(t.basic_form)}</span>` : ""}
                        </li>`
                    )
                    .join("")}
                </ul>
              </details>`
            : ""
        }
      </section>`;
  }

  function renderSentenceVerbAnalyses(sentenceAnalysis) {
    const verbs = sentenceAnalysis?.verbs || [];
    if (!verbs.length) return "";
    return `
      <section class="panel panel-verbs">
        <div class="panel-head">
          <h3>句中動詞分析</h3>
          <span class="badge badge-local">${verbs.length} 處</span>
        </div>
        <div class="verb-analysis-list">
          ${verbs
            .map((v, i) => {
              const p = v.analysis?.primary;
              if (!p) return "";
              return `
                <article class="verb-chip-card">
                  <div class="verb-chip-head">
                    <code>${esc(v.teForm || v.textDisplay || v.text)}</code>
                    <span class="badge ${groupBadgeClass(p.group)}">${esc(p.group || "?")}</span>
                    <span class="badge badge-form-name">${esc(p.formName || "?")}</span>
                  </div>
                  <p class="verb-chip-meta">
                    原形 <strong>${esc(p.lemma || "?")}</strong>
                    · ${esc(p.groupLabel || "")}
                    ${(p.formTags || []).length ? " · " + p.formTags.map((t) => esc(t)).join("・") : ""}
                    ${
                      v.pattern
                        ? ` · 句型接辭 <code class="pattern-affix">${esc(v.pattern)}</code>（分開標註，不含動詞）`
                        : ""
                    }
                  </p>
                  <ol class="step-list compact">
                    ${(p.steps || [])
                      .filter((s) => s.label !== "表面形" && s.label !== "類型要點")
                      .slice(0, 4)
                      .map(
                        (s) =>
                          `<li class="step-item"><span class="step-label">${esc(s.label)}</span><span class="step-text">${esc(s.text)}</span></li>`
                      )
                      .join("")}
                  </ol>
                </article>`;
            })
            .join("")}
        </div>
      </section>`;
  }

  function renderHighlightedSentence(result) {
    const query = result.query || result.form || "";
    const spans = (result.spans || []).slice().sort((a, b) => a.start - b.start);
    if (!query) return "";
    if (!spans.length) {
      return `<div class="sentence-board"><p class="sentence-text">${esc(query)}</p></div>`;
    }

    let html = "";
    let cursor = 0;
    for (const sp of spans) {
      const start = Math.max(0, sp.start);
      const end = Math.min(query.length, sp.end);
      if (start < cursor) continue;
      if (start > cursor) html += esc(query.slice(cursor, start));
      const ci = sp.colorIndex ?? 0;
      const title = result.legend?.find((l) => l.ruleId === sp.ruleId)?.title || "規則";
      html += `<mark class="gram-hl gram-hl-${ci}" data-rule-id="${esc(sp.ruleId)}" title="${esc(title)}">${esc(query.slice(start, end))}</mark>`;
      cursor = end;
    }
    if (cursor < query.length) html += esc(query.slice(cursor));

    const legend = (result.legend || [])
      .map(
        (l) => `
        <li class="legend-item">
          <span class="legend-swatch gram-hl-${l.colorIndex}" aria-hidden="true"></span>
          <button type="button" class="legend-link" data-scroll-rule="${esc(l.ruleId)}">${esc(l.title)}</button>
          ${l.count ? `<span class="legend-count">×${l.count}</span>` : ""}
        </li>`
      )
      .join("");

    return `
      <div class="sentence-board">
        <p class="sentence-label">句子標註</p>
        <p class="sentence-text">${html}</p>
        ${legend ? `<ul class="sentence-legend" aria-label="顏色對應規則">${legend}</ul>` : ""}
      </div>`;
  }

  function bindLegendScroll(root) {
    $$("[data-scroll-rule]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.scrollRule;
        const card = root.querySelector(`.rule-card[data-id="${CSS.escape(id)}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("rule-card-flash");
          setTimeout(() => card.classList.remove("rule-card-flash"), 1200);
        }
      });
    });
  }

  function renderLookupResult(result) {
    const box = $("#lookup-result");
    if (!result || !result.form) {
      if (box) box.innerHTML = "";
      return;
    }

    const { form, matches, partial, analysis, mode, sentenceAnalysis, patternInfo, verbAnalysis } =
      result;
    const hasLocal = matches.length > 0;
    const isSentence = mode === "sentence";

    function roleBadge(m) {
      if (m.role === "pattern") return "句型";
      if (m.role === "conjugation") return "活用";
      return null;
    }

    function isPatternMatch(m) {
      return (
        m.role === "pattern" ||
        /ている|てる|でもいい|てもいい|てください/.test(m.rule?.title || "")
      );
    }

    if (isSentence) {
      const analysisHtml = renderSentenceVerbAnalyses(sentenceAnalysis);
      const banner = hasLocal
        ? `<div class="result-banner success">
            <strong>找到本地規則</strong>
            <span>句子中找到 ${matches.length} 種文法（共 ${result.spans?.length || 0} 處標註）· 句型與動詞活用分開標註</span>
          </div>`
        : `<div class="result-banner warn">
            <strong>句子中未比對到本地規則</strong>
            <span>下方仍提供動詞分析；可新增規則或重設種子載入預設文法</span>
          </div>`;

      box.innerHTML = `
        ${banner}
        ${renderHighlightedSentence(result)}
        ${analysisHtml}
        ${
          hasLocal
            ? `<div class="match-list">
                ${matches
                  .map((m) =>
                    renderRuleCard(m.rule, {
                      highlightForm: m.spans?.[0]?.form || m.spans?.[0]?.text || "",
                      badge: roleBadge(m) || "標註色",
                      colorIndex: m.colorIndex ?? 0,
                      matchedWords: (m.spans || []).map((s) => s.text),
                      highlightGroup: isPatternMatch(m)
                        ? ""
                        : sentenceAnalysis?.verbs?.[0]?.analysis?.primary?.group || "",
                    })
                  )
                  .join("")}
              </div>`
            : `<section class="panel panel-action">
                <h3>下一步</h3>
                <div class="action-row">
                  <button type="button" class="btn btn-primary" id="btn-create-from-lookup">立即建立規則</button>
                  <button type="button" class="btn btn-secondary" id="btn-add-todo">先加入待辦清單</button>
                </div>
              </section>`
        }
      `;
      bindRuleCardActions(box);
      bindLegendScroll(box);
      if (!hasLocal) {
        $("#btn-create-from-lookup")?.addEventListener("click", () => {
          const first = sentenceAnalysis?.verbs?.[0];
          const verbForm = first?.teForm || first?.text || form;
          openForm({
            mode: "create",
            draft: first?.analysis
              ? Analyzer.draftFromAnalysis(verbForm, first.analysis)
              : {
                  title: form.slice(0, 40),
                  explanation: `來自句子：${form}`,
                  category: "",
                  requiresConjugation: false,
                  conjugation: RulesService.emptyConjugation(),
                },
            source: "from-lookup",
            queryForm: form,
          });
        });
        $("#btn-add-todo")?.addEventListener("click", () => {
          const first = sentenceAnalysis?.verbs?.[0];
          addTodoFromLookup(first?.teForm || first?.text || form, first?.analysis || null);
        });
      }
      return;
    }

    // 單詞模式：ている 複合時拆成句型說明 + 動詞活用
    const patternHtml = patternInfo
      ? `<section class="panel panel-pattern">
          <div class="panel-head">
            <h3>句型層</h3>
            <span class="badge badge-conj">接辭</span>
          </div>
          <p class="pattern-line">
            <code>${esc(patternInfo.teForm || "…")}</code>
            <span class="pattern-plus">＋</span>
            <code class="pattern-affix">${esc(patternInfo.pattern)}</code>
            <span class="muted">（${esc(patternInfo.label || "句型")}）</span>
          </p>
          <p class="hint">句型規則只對接辭；動詞活用見下方分析與「活用」規則。</p>
        </section>`
      : "";

    const va = verbAnalysis || analysis;
    const analysisHtml =
      va?.primary && va.primary.formName !== "未知"
        ? renderAnalysisPanel(va, {
            title: patternInfo ? "動詞活用（て形等）" : "動詞／語素分析",
          })
        : va?.primary
          ? renderAnalysisPanel(va, { title: "基礎分析" })
          : "";

    if (hasLocal) {
      box.innerHTML = `
        <div class="result-banner success">
          <strong>找到本地規則</strong>
          <span>「${esc(form)}」共 ${matches.length} 筆對應${
            patternInfo ? " · 句型與活用已分開" : ""
          }</span>
        </div>
        ${patternHtml}
        ${analysisHtml}
        <div class="match-list">
          ${matches
            .map((m) =>
              renderRuleCard(m.rule, {
                highlightForm:
                  m.role === "pattern"
                    ? patternInfo?.pattern || form
                    : m.role === "conjugation"
                      ? patternInfo?.teForm || form
                      : form,
                badge: roleBadge(m) || "本地規則",
                colorIndex: m.colorIndex ?? 0,
                matchedWords: (m.spans || []).map((s) => s.text || form),
                highlightGroup: isPatternMatch(m) ? "" : va?.primary?.group || "",
              })
            )
            .join("")}
        </div>
        ${
          partial?.length
            ? `<details class="related-block"><summary>其他可能相關（${partial.length}）</summary>
                <div class="match-list compact">${partial.map((m) => renderRuleCard(m.rule, { compact: true, badge: "相關" })).join("")}</div>
              </details>`
            : ""
        }
      `;
      bindRuleCardActions(box);
      return;
    }

    const suggestions = Analyzer.buildSuggestions(form, va || analysis);
    box.innerHTML = `
      <div class="result-banner warn">
        <strong>目前沒有對應規則</strong>
        <span>找不到「${esc(form)}」的本地規則卡片</span>
      </div>
      ${patternHtml}
      ${analysisHtml || `<section class="panel"><p class="muted">無法解析此形式，可手動建立規則。</p></section>`}
      <section class="panel panel-action">
        <p>${esc(suggestions.summary)}</p>
        <div class="action-row">
          <button type="button" class="btn btn-primary" id="btn-create-from-lookup">立即建立規則</button>
          <button type="button" class="btn btn-secondary" id="btn-add-todo">先加入待辦清單</button>
        </div>
      </section>`;
    $("#btn-create-from-lookup")?.addEventListener("click", () => {
      const draftForm = patternInfo?.teForm || form;
      openForm({
        mode: "create",
        draft: Analyzer.draftFromAnalysis(draftForm, va || analysis),
        source: "from-lookup",
        queryForm: form,
      });
    });
    $("#btn-add-todo")?.addEventListener("click", () =>
      addTodoFromLookup(patternInfo?.teForm || form, va || analysis)
    );
  }

  function renderConjugationPanel(rule, highlightGroup = "") {
    if (!rule?.requiresConjugation && !RulesService.hasConjugationContent(rule?.conjugation)) {
      return "";
    }
    const conj = rule.conjugation || RulesService.emptyConjugation();
    if (!RulesService.hasConjugationContent(conj)) return "";

    const slots = RulesService.CONJ_SLOTS.map(({ key, label }) => {
      const val = (conj[key] || "").trim();
      const hit =
        highlightGroup &&
        ((highlightGroup === "一段" && key === "ichidan") ||
          (highlightGroup === "五段" && key === "godan") ||
          (highlightGroup === "サ変" && key === "sahen"));
      return `
        <div class="conj-table-cell conj-${esc(key)}${hit ? " hit" : ""}${val ? "" : " empty-slot"}">
          <span class="conj-key">${esc(label)}</span>
          <span class="conj-val${val ? "" : " empty"}">${val ? esc(val) : "—"}</span>
        </div>`;
    }).join("");

    return `
      <div class="field-block conj-display">
        <h4>動詞變化指示（三格）</h4>
        <div class="conj-table" role="table" aria-label="一段・五段・サ変 變化指示">
          ${slots}
        </div>
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
          ${colorEdge}
        </article>`;
    }

    const wordsLine = matchedWords.length
      ? matchedWords.map((w) => `<code>${esc(w)}</code>`).join(" ")
      : highlightForm
        ? `<code>${esc(highlightForm)}</code>`
        : "";

    const actions = isLookup
      ? `<button type="button" class="btn btn-sm btn-ghost" data-action="edit">編輯</button>
          ${locateBtn}
          <button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
            rule.id
          )}" title="從本句結果移除高亮與規則卡，不刪除筆記本中的規則">本句移除</button>
          <button type="button" class="btn btn-sm btn-secondary" data-action="view">查看規則</button>`
      : `<button type="button" class="btn btn-sm btn-ghost" data-action="edit">編輯</button>
          <button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete">刪除</button>`;

    return `
      <article class="rule-card${tintClass}" data-id="${esc(rule.id)}" id="rule-${esc(rule.id)}">
        <div class="rule-card-top">
          <h3>${esc(rule.title)}</h3>
          ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
        </div>
        ${
          wordsLine
            ? `<div class="apply-box"><h4>句中命中</h4><p>${wordsLine}</p></div>`
            : isLookup && effectiveHasSpan === false
              ? `<p class="muted" style="font-size:0.85rem;margin:0.25rem 0">句中未定位 — 用下方「手動定位」</p>`
              : ""
        }
        ${rule.explanation ? `<div class="field-block"><h4>詳細說明</h4><p class="explanation-text">${esc(rule.explanation)}</p></div>` : ""}
        ${renderConjugationPanel(rule, highlightGroup)}
        <div class="rule-card-actions">
          ${actions}
        </div>
        ${colorEdge}
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
            if (state.lastSearch) {
              state.lastSearch = RulesService.search(state.lastQuery);
              renderLookupResult(state.lastSearch);
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

  function addTodoFromLookup(form, analysis) {
    const todos = Storage.loadTodos();
    const p = analysis?.primary || {};
    if (todos.some((t) => !t.done && t.form === form)) {
      showToast("待辦中已有相同形式", "info");
      return;
    }
    todos.unshift({
      id: "t_" + Date.now().toString(36),
      form,
      lemma: p.lemma || "",
      formName: p.formName || "",
      group: p.groupLabel || p.group || "",
      note: `待建立規則：${form}${p.group ? `（${p.groupLabel || p.group}・${p.formName || ""}）` : ""}`,
      created_at: new Date().toISOString(),
      done: false,
    });
    Storage.saveTodos(todos);
    showToast("已加入待辦清單", "success");
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
    // 動詞活用等：API 漏 span 時用 Analyzer 補定位
    if (typeof RulesService.enrichInventoryWithAnalyzer === "function") {
      RulesService.enrichInventoryWithAnalyzer(src, inventory);
    }
    const items = inventory?.items || [];
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

  /** 會活用的詞才顯示原形（動詞・形容詞）；與表面形相同時不重複顯示 */
  function vocabShowsLemma(pos, lemma, surface) {
    if (!lemma) return false;
    if (lemma === surface) return false;
    if (typeof AiService !== "undefined" && AiService.posNeedsLemma) {
      return AiService.posNeedsLemma(pos);
    }
    return /動詞|形容詞/.test(String(pos || ""));
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

  function wordTipOpenHtml(v) {
    const showLemma = vocabShowsLemma(v.pos, v.lemma, v.surface);
    const glossDisp = formatVocabGlossDisplay(v);
    const fallbackTitle = [
      v.reading ? `讀音 ${v.reading}` : "",
      showLemma && v.lemma ? `原形 ${v.lemma}` : "",
      glossDisp ? `意思 ${glossDisp}` : "",
      v.pos ? `（${v.pos}）` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<span class="word-tip" tabindex="0" data-lemma="${esc(v.lemma || "")}" data-reading="${esc(
      v.reading || ""
    )}" data-origin="${esc(v.origin || "")}" data-gloss="${esc(v.gloss || "")}" data-pos="${esc(
      v.pos || ""
    )}" data-surface="${esc(v.surface || "")}" title="${esc(fallbackTitle)}">`;
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
          const tip = at.g.missing
            ? `尚未建立：${at.g.apiName || at.g.ruleTitle}`
            : at.g.ruleTitle;
          const cls =
            at.g.color === "missing" || at.g.missing
              ? "gram-hl gram-hl-missing"
              : `gram-hl gram-hl-${at.g.color ?? 0}`;
          const scrollAttr =
            !at.g.missing && at.g.ruleId
              ? ` data-scroll-rule="${esc(at.g.ruleId)}" data-rule-id="${esc(at.g.ruleId)}"`
              : "";
          html += `<mark class="${cls}" title="${esc(tip)}"${scrollAttr}>`;
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

  function ensureWordTipPop() {
    let el = document.getElementById("word-tip-pop");
    if (el) return el;
    el = document.createElement("div");
    el.id = "word-tip-pop";
    el.className = "word-tip-pop hidden";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
    return el;
  }

  function hideWordTipPop() {
    const el = document.getElementById("word-tip-pop");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
  }

  function showWordTipPop(anchor, data) {
    const pop = ensureWordTipPop();
    const lemma = data.lemma || "";
    const reading = data.reading || "";
    const origin = data.origin || "";
    const gloss = data.gloss || "";
    const pos = data.pos || "";
    const surface = data.surface || "";
    const showLemma = vocabShowsLemma(pos, lemma, surface);
    const glossDisp = formatVocabGlossDisplay({ origin, gloss });
    pop.innerHTML = `
      <div class="word-tip-row word-tip-surface">${esc(surface || "—")}</div>
      ${
        reading
          ? `<div class="word-tip-row"><span class="word-tip-k">讀音</span><span class="word-tip-v word-tip-reading">${esc(
              reading
            )}</span></div>`
          : ""
      }
      ${
        showLemma
          ? `<div class="word-tip-row"><span class="word-tip-k">原形</span><span class="word-tip-v">${esc(
              lemma
            )}</span></div>`
          : ""
      }
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
        pos
          ? `<div class="word-tip-row"><span class="word-tip-k">詞性</span><span class="word-tip-v">${esc(
              pos
            )}</span></div>`
          : ""
      }`;
    pop.classList.remove("hidden");
    const rect = anchor.getBoundingClientRect();
    const pad = 8;
    let top = rect.bottom + pad + window.scrollY;
    let left = rect.left + window.scrollX;
    const pr = pop.getBoundingClientRect();
    if (left + pr.width > window.scrollX + window.innerWidth - 12) {
      left = Math.max(12, window.scrollX + window.innerWidth - pr.width - 12);
    }
    if (rect.bottom + pr.height + pad > window.innerHeight && rect.top > pr.height + pad) {
      top = rect.top + window.scrollY - pr.height - pad;
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
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
      };
      el.addEventListener("mouseenter", () => showWordTipPop(el, data));
      el.addEventListener("mouseleave", () => hideWordTipPop());
      el.addEventListener("focus", () => showWordTipPop(el, data));
      el.addEventListener("blur", () => hideWordTipPop());
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

    const vocabLocs = locateVocabInText(query, vocabList);
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
    const modeLabel = isLocal ? "本地標記" : "API 標記";
    const translation = String(options.translation || "").trim();
    const editHint = `<p class="sentence-edit-hint">選取文字或<strong>點已上色片段</strong>可套用／疊加規則；下方規則卡操作列的<strong>手動定位</strong>可指定句中片段。右側<strong>+補充</strong>可加入不句中上色的補充用法。</p>`;

    return `
      <div class="sentence-board" id="sentence-board">
        <div id="locate-mode-bar" class="locate-mode-bar hidden" role="status"></div>
        <p class="sentence-label">
          <span class="sentence-label-main">查詢內容 · ${modeLabel}</span>
          ${hasVocab ? `<span class="sentence-cycle-hint">滑過看原形</span>` : ""}
        </p>
        <p class="sentence-text" id="sentence-text">${html || esc(query)}</p>
        ${editHint}
        ${
          translation
            ? `<p class="sentence-translation muted">${esc(translation)}</p>`
            : ""
        }
        <ul class="sentence-legend" aria-label="句中規則與補充">
          ${legendHtml}
          <li class="legend-item legend-item-add">
            <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
          </li>
        </ul>
        ${
          isLocal
            ? ""
            : `<p class="sentence-legend-hint"><span class="legend-swatch gram-hl gram-hl-missing"></span> 深紅色＝API 列出但尚未建立的規則${
                hasVocab ? " · 虛線底線＝詞彙（滑過看原形／類型）" : ""
              }</p>`
        }
      </div>`;
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
          ${
            inventory.translation
              ? `<p class="muted">翻譯：${esc(inventory.translation)}</p>`
              : ""
          }
        </section>`;
    }

    const rows = items
      .map((it, idx) => {
        const match = resolveInventoryRule(it);
        const owned = match.owned && match.rule;
        const srcNote =
          it.source === "manual" ? " · 手動" : it.source === "local" ? " · 本地" : "";
        return `
          <li class="inventory-item ${owned ? "owned" : "missing"}" data-inv-idx="${idx}">
            <div class="inventory-meta">
              <strong>${esc(it.name)}</strong>
              <span class="inv-note">
                ${
                  owned
                    ? `${esc(match.rule.title)}${srcNote}`
                    : `<span class="badge badge-missing">尚未收錄</span>`
                }
                ${it.category ? ` · ${esc(it.category)}` : ""}
                ${it.span ? ` · <code>${esc(it.span)}</code>` : ""}
                ${it.note ? `<br/>${esc(it.note)}` : ""}
              </span>
            </div>
            <div class="action-row">
              ${
                owned
                  ? `<button type="button" class="btn btn-sm btn-secondary" data-goto-rule="${esc(match.rule.id)}">查看規則</button>
                     <button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
                       match.rule.id
                     )}" title="從本句移除">本句移除</button>`
                  : `<button type="button" class="btn btn-sm btn-primary" data-add-todo-idx="${idx}">加入待辦</button>
                     <button type="button" class="btn btn-sm btn-secondary" data-create-inv-idx="${idx}">建立規則</button>
                     <button type="button" class="btn btn-sm btn-ghost" data-dismiss-inv-idx="${idx}" title="僅從本句忽略，不刪筆記本">忽略</button>`
              }
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
          inventory.translation
            ? `<p class="panel-note">翻譯：${esc(inventory.translation)}</p>`
            : ""
        }
        ${
          missingCount > 0
            ? `<div class="action-row" style="margin-bottom:0.65rem">
                <button type="button" class="btn btn-primary" id="btn-add-all-missing">將 ${missingCount} 項缺失全部加入待辦</button>
              </div>`
            : `<p class="panel-note">${
                isLocal ? "本地掃描完成。" : "本地已涵蓋本次盤點的文法點。"
              }</p>`
        }
        <ul class="inventory-list">${rows}</ul>
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
    return persistLookupResult(q, inv, apiHl, { silent: opts.silent !== false });
  }

  function refreshLookupFromInventory(opts = {}) {
    const q = state.lastQuery;
    const inv = state.lastInventory;
    if (!q || !inv) return;
    const apiHl = applyInventoryToLookup(q, inv, opts);
    persistCurrentInventory({ apiHl: apiHl || undefined });
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
      const pad = 8;
      const rect = pop.getBoundingClientRect();
      let left = clientX - rect.width / 2;
      let top = clientY + 12;
      left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
      if (top + rect.height > window.innerHeight - pad) {
        top = clientY - rect.height - 12;
      }
      top = Math.max(pad, top);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
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

    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const ws = Number(w.start);
      const we = Number(w.end);
      if (
        rangeOk &&
        Number.isFinite(ws) &&
        Number.isFinite(we) &&
        !(e <= ws || s >= we)
      ) {
        return { entry: w, index: i };
      }
    }
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const surf = String(w.surface || "").trim();
      if (surf && surf === text) return { entry: w, index: i };
    }
    return { entry: null, index: -1 };
  }

  function fillVocabEditForm(data = {}) {
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = v || "";
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
    const base = found.entry
      ? { ...found.entry }
      : {
          surface: text,
          reading: "",
          lemma: "",
          origin: "",
          pos: "",
          gloss: "",
        };
    if (!base.surface) base.surface = text;
    fillVocabEditForm(base);
    setVocabEditBanner(
      found.entry
        ? `<strong>編輯既有單字</strong> — 修改後按「儲存到本句」。`
        : `<strong>新增單字解釋</strong> — 可手動填寫或按「AI 填寫」；儲存後寫入本句。`,
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
      // 同 surface 且重疊區間則覆蓋
      let replaced = false;
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].surface || "") === surface) {
          list[i] = { ...list[i], ...row };
          replaced = true;
          break;
        }
      }
      if (!replaced) list.push(row);
    }
    state.lastInventory.vocab = list;
    closeVocabEditModal();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    refreshLookupFromInventory();
    showToast(`已寫入單字「${surface}」`, "success");
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
      showToast("請先到「設定」填入 API Key", "error");
      setView("settings");
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
    host.addEventListener("mouseup", onSentenceMouseUp);
  }

  function onSentenceMouseUp(e) {
    if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, .sentence-legend, .locate-mode-bar")) {
      return;
    }
    // 延遲讓 selection 穩定；句首拖選常在 board 上 mouseup
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
        showSelApplyPop(e.clientX, e.clientY, cap.text, { note });
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

    let suggestions = [];
    let rest = RulesService.getAll();
    if (selText && typeof RulesService.rankRulesForSpan === "function" && !q) {
      const ranked = RulesService.rankRulesForSpan(selText, {
        minScore: 8,
        maxSuggest: 8,
      });
      suggestions = ranked.suggestions || [];
      rest = ranked.rest || rest;
    } else if (q) {
      const all = RulesService.getAll();
      if (selText && typeof RulesService.rankRulesForSpan === "function") {
        const ranked = RulesService.rankRulesForSpan(selText, {
          minScore: 6,
          maxSuggest: 12,
        });
        const matchQ = (r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        };
        suggestions = (ranked.suggestions || []).filter((s) => matchQ(s.rule));
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
   * 本地掃描 → inventory 形狀（與 API 相同渲染路徑）
   */
  function buildLocalInventory(query) {
    const src = String(query || "");
    const result =
      typeof RulesService.search === "function" ? RulesService.search(src) : null;
    const items = [];
    const covered = new Set();
    const spans = result?.spans || [];

    for (const s of spans) {
      const rule = RulesService.getById(s.ruleId);
      if (!rule) continue;
      covered.add(rule.id);
      items.push({
        name: rule.title,
        nameJa: "",
        nameZh: rule.title,
        span: s.text || src.slice(s.start, s.end),
        start: s.start,
        end: s.end,
        category: rule.category || "",
        confidence: "medium",
        source: "local",
        manualRuleId: rule.id,
        note: "",
      });
    }

    // 單字模式：matches 有規則但 spans 為空
    if (result?.matches?.length) {
      for (const m of result.matches) {
        const rule = m.rule;
        if (!rule?.id || covered.has(rule.id)) continue;
        covered.add(rule.id);
        const span0 = m.spans?.[0];
        items.push({
          name: rule.title,
          nameZh: rule.title,
          nameJa: "",
          span: span0?.text || span0?.form || "",
          start: Number.isFinite(span0?.start) ? span0.start : undefined,
          end: Number.isFinite(span0?.end) ? span0.end : undefined,
          category: rule.category || "",
          confidence: "medium",
          source: "local",
          manualRuleId: rule.id,
          note: "",
        });
      }
    }

    const ruleCount = covered.size;
    const markCount = items.filter((it) => Number.isFinite(it.start) || it.span).length;
    return {
      mode: "local",
      source: "local",
      summary: `本地掃描：${ruleCount} 條規則 · ${markCount} 處標記`,
      translation: "",
      items,
      vocab: [],
    };
  }

  function persistLookupResult(query, inventory, apiHl, opts = {}) {
    const payload = {
      query,
      summary: inventory.summary || "",
      translation: inventory.translation || "",
      ownedCount: (apiHl.legend || []).filter((h) => h.owned).length,
      missingCount: (apiHl.legend || []).filter((h) => !h.owned).length,
      items: inventory.items || [],
      vocab: inventory.vocab || [],
    };
    const activePid = Storage.getActiveProjectId();
    if (activePid) {
      const before = Storage.findProjectEntryByQuery(activePid, query);
      Storage.upsertProjectEntry(activePid, payload);
      const after = Storage.findProjectEntryByQuery(activePid, query);
      if (after?.seq != null) state.projectCursorSeq = after.seq;
      updateProjectModeUI();
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

  function runLocalLookup(query) {
    const inventory = buildLocalInventory(query);
    state.lastInventory = inventory;
    const apiHl = applyInventoryToLookup(query, inventory) || buildApiHighlight(query, inventory);
    persistLookupResult(query, inventory, apiHl, { silent: true });
    const n = (apiHl.legend || []).filter((h) => h.owned).length;
    const seq = state.projectCursorSeq;
    const seqNote = Storage.getActiveProjectId() && seq != null ? ` · 專案第 ${seq} 號` : "";
    if (n) {
      showToast(`本地查詢：${n} 條規則${seqNote}`, "success");
    } else {
      showToast(`本地未命中規則（可選字手動套用，或改 API 模式）${seqNote}`, "info");
    }
  }

  async function runLookup(q) {
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
    const anyMode = modes.apiGrammar || modes.localGrammar || modes.apiVocab;
    // 未開啟任何掃描：仍可查詢、顯示句子，供選字套用／補充用法
    if (!anyMode) {
      const inventory = {
        summary: "手動模式",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
      state.lastInventory = inventory;
      const apiHl =
        applyInventoryToLookup(form, inventory) || buildApiHighlight(form, inventory);
      persistLookupResult(form, inventory, apiHl, { silent: true });
      showToast("已顯示句子 · 可選字套用規則（未開啟掃描模式）", "info");
      return;
    }

    const needApi = modes.apiGrammar || modes.apiVocab;

    // —— 純本地文法（不呼叫 API）——
    if (modes.localGrammar && !needApi) {
      state.lookupBusy = true;
      try {
        runLocalLookup(form);
      } finally {
        state.lookupBusy = false;
      }
      return;
    }

    if (needApi && !Storage.hasApiKey()) {
      showToast("此模式需要 API Key，請先到「設定」填入（或改開本地文法排查）", "error");
      setView("settings");
      return;
    }

    state.lookupBusy = true;
    state.lastSearch = { form, query: form, matches: [] };

    const loadingBits = [];
    if (modes.apiGrammar) loadingBits.push("文法點");
    if (modes.apiVocab) loadingBits.push("單字原形");
    if (modes.localGrammar) loadingBits.push("本地掃描");
    box.innerHTML = `
      <section class="panel" id="api-inventory-slot">
        <div class="panel-head">
          <h3>查詢中</h3>
          <span class="badge badge-api-fallback">請稍候…</span>
        </div>
        <p class="panel-note">正在處理：${esc(loadingBits.join(" · "))}…</p>
      </section>
    `;

    try {
      const wantApiVocab = Boolean(modes.apiVocab);
      const wantApiGrammar = Boolean(modes.apiGrammar);
      let inventory;

      if (modes.localGrammar) {
        inventory = buildLocalInventory(form);
        if (wantApiVocab) {
          // 本地文法 + API 單字：輕量請求，不帶規則標題
          const apiInv =
            typeof AiService.inventoryVocabOnly === "function"
              ? await AiService.inventoryVocabOnly(form)
              : await AiService.inventoryGrammar(form, []);
          inventory.vocab = Array.isArray(apiInv.vocab) ? apiInv.vocab : [];
          if (apiInv.translation) inventory.translation = apiInv.translation;
          inventory.summary = `${inventory.summary || ""} · API 單字 ${inventory.vocab.length}`.trim();
        }
      } else if (wantApiGrammar) {
        const titles = RulesService.getAll().map((r) => r.title);
        inventory = await AiService.inventoryGrammar(form, titles);
        inventory.mode = "api";
        inventory.source = "api";
        if (!wantApiVocab) inventory.vocab = [];
      } else if (wantApiVocab) {
        inventory =
          typeof AiService.inventoryVocabOnly === "function"
            ? await AiService.inventoryVocabOnly(form)
            : await AiService.inventoryGrammar(form, []);
        inventory.mode = "api";
        inventory.source = "api";
        inventory.items = [];
        inventory.summary =
          inventory.summary || `API 單字查詢：${(inventory.vocab || []).length} 詞`;
      } else {
        inventory = {
          summary: "",
          translation: "",
          items: [],
          vocab: [],
          mode: "api",
          source: "api",
        };
      }

      state.lastInventory = inventory;
      const apiHl = applyInventoryToLookup(form, inventory) || buildApiHighlight(form, inventory);

      const ownedCount = (apiHl.legend || []).filter((h) => h.owned).length;
      const missingCount = (apiHl.legend || []).filter((h) => !h.owned).length;
      persistLookupResult(form, inventory, apiHl, { silent: true });
      const activePid = Storage.getActiveProjectId();
      const vocabNote = inventory.vocab?.length ? ` · 詞彙 ${inventory.vocab.length}` : "";
      if (activePid) {
        const after = Storage.findProjectEntryByQuery(activePid, form);
        showToast(
          `已存入專案第 ${after?.seq ?? "?"} 號 · 已收錄 ${ownedCount} · 尚未 ${missingCount}${vocabNote}`,
          "success"
        );
      } else {
        showToast(`已收錄 ${ownedCount} · 尚未 ${missingCount}${vocabNote}`, "success");
      }
    } catch (err) {
      box.innerHTML = `
        <section class="panel" id="api-inventory-slot">
          <div class="result-banner error" style="margin:0">
            <strong>查詢失敗</strong>
            <span>${esc(err.message || "未知錯誤")}</span>
            <span class="muted">可在查詢頁上方改為僅本地文法排查。</span>
          </div>
        </section>`;
      showToast(err.message || "API 失敗", "error");
    }
    state.lookupBusy = false;
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

  function bindEvents() {
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
    });

    $("#btn-new-rule")?.addEventListener("click", () => openForm({ mode: "create", source: "manual" }));
    $("#rule-form")?.addEventListener("submit", saveForm);
    $("#form-requires-conjugation")?.addEventListener("change", (e) => {
      toggleConjugationBlock(e.target.checked);
    });
    $("#btn-form-cancel")?.addEventListener("click", () => {
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
        // 畫面仍在 DOM 裡就不重畫；若空了才用快照還原（不呼叫 API）
        restoreLookupFromCacheIfNeeded();
      } else {
        setView("rules");
      }
    });
    $("#rules-filter")?.addEventListener("input", () => renderRulesList());
    $("#history-filter")?.addEventListener("input", () => renderHistory());
    $("#btn-lookup-seq-prev")?.addEventListener("click", () => onLookupSeqPrev());
    $("#btn-lookup-seq-next")?.addEventListener("click", () => onLookupSeqNext());

    $("#btn-projects-modal-close")?.addEventListener("click", () => closeProjectsModal());
    $("#projects-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectsModal();
    });
    $("#btn-project-create")?.addEventListener("click", () => createProjectFromModal());
    $("#project-new-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createProjectFromModal();
      }
    });
    $("#btn-project-leave")?.addEventListener("click", () => leaveProject());
    $("#btn-project-entries")?.addEventListener("click", () => openProjectEntriesModal());
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
    $("#vocab-edit-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeVocabEditModal();
    });
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
    document.addEventListener("mousedown", (e) => {
      const pop = $("#sel-apply-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      // 在句子板內準備重選時不先關掉（等 mouseup 再更新）
      if (
        e.target.closest &&
        e.target.closest("#sentence-text, #sentence-board")
      ) {
        return;
      }
      hideSelApplyPop();
    });
    // 在句子外放開也可能完成「從句首拖進來」的選取
    document.addEventListener("mouseup", (e) => {
      if (state.view !== "lookup") return;
      if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, input, textarea")) {
        return;
      }
      const sentenceEl = $("#sentence-text");
      if (!sentenceEl) return;
      // 已在 board 上處理過就不必；此處補「mouseup 落在 board 外」
      if (e.target.closest && e.target.closest("#sentence-board")) return;
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        // 避免與 board mouseup 重複：若浮層已針對同一段開啟則略過
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        showSelApplyPop(e.clientX, e.clientY, cap.text, {});
      });
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

      // 左右方向鍵：上一句 / 下一句（查詢頁；輸入中不攔截）
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (handleLookupArrowNav(e)) return;
      }
    });

    $("#btn-ai-complete")?.addEventListener("click", () => runAiComplete());
    $("#settings-form")?.addEventListener("submit", saveSettingsForm);
    $("#settings-mode-api-grammar")?.addEventListener("change", () =>
      onLookupModeToggle("apiGrammar")
    );
    $("#settings-mode-local-grammar")?.addEventListener("change", () =>
      onLookupModeToggle("localGrammar")
    );
    $("#settings-mode-api-vocab")?.addEventListener("change", () =>
      onLookupModeToggle("apiVocab")
    );
    $("#btn-settings-modes-all")?.addEventListener("click", () => onSettingsModesAllClick());
    $("#btn-test-api")?.addEventListener("click", () => testApiConnection());
    $("#btn-clear-key")?.addEventListener("click", clearApiKey);
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

  async function init() {
    updateTokenizerStatus();
    const tokPromise =
      typeof JaTokenizer !== "undefined"
        ? JaTokenizer.init("dict/").then(() => {
            updateTokenizerStatus();
          })
        : Promise.resolve();

    await RulesService.init();
    bindEvents();
    updateApiStatusDot();
    updateLookupModeUI();
    applyStructureTheme(Storage.loadSettings().structureTheme);
    if (Storage.getActiveProjectId()) {
      state.projectCursorSeq = null;
    }
    updateProjectModeUI();
    setView("lookup");
    renderLookupResult(null);
    updateRuleCount();
    updateLookupNavBtns();

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
