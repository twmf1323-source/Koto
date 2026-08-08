/**
 * 規則 CRUD 與本地搜尋
 * 模型：規則名 + 分類 + 詳細說明
 * 可選「三格」：一段／五段／サ変 的動詞變化指示（文法需動詞變化時）
 */
const RulesService = (() => {
  let rules = [];

  const SUPPLEMENTARY_CATEGORY = "補充用法";

  const CATEGORIES = [
    { key: "", label: "（未分類）" },
    { key: "動詞類型", label: "動詞類型" },
    { key: "活用", label: "活用" },
    { key: "助動詞", label: "助動詞" },
    { key: "句型", label: "句型" },
    { key: "助詞", label: "助詞" },
    { key: "形容詞", label: "形容詞" },
    { key: "其他", label: "其他" },
    { key: SUPPLEMENTARY_CATEGORY, label: "補充用法" },
  ];

  /** 成語／特定用法等：特殊色、列表最後、不句中上色 */
  function isSupplementaryUsage(ruleOrCat) {
    const c =
      typeof ruleOrCat === "string"
        ? ruleOrCat
        : ruleOrCat && typeof ruleOrCat === "object"
          ? ruleOrCat.category
          : "";
    return String(c || "").trim() === SUPPLEMENTARY_CATEGORY;
  }

  /** 三格：動詞類型變化指示 */
  const CONJ_SLOTS = [
    { key: "ichidan", label: "一段動詞", short: "一段" },
    { key: "godan", label: "五段動詞", short: "五段" },
    { key: "sahen", label: "サ変動詞", short: "サ変" },
  ];

  function emptyConjugation() {
    return { ichidan: "", godan: "", sahen: "" };
  }

  function migrateConjugation(input) {
    const c = emptyConjugation();
    const src = input?.conjugation && typeof input.conjugation === "object" ? input.conjugation : null;
    if (src) {
      c.ichidan = String(src.ichidan ?? src["一段"] ?? "").trim();
      c.godan = String(src.godan ?? src["五段"] ?? "").trim();
      c.sahen = String(src.sahen ?? src["サ変"] ?? src.sa ?? "").trim();
      return c;
    }
    return c;
  }

  function hasConjugationContent(conj) {
    if (!conj || typeof conj !== "object") return false;
    return Boolean(conj.ichidan || conj.godan || conj.sahen);
  }

  const NOISY_SHORT = new Set([
    "る", "う", "く", "す", "つ", "ぬ", "む", "ぐ", "ぶ",
    "た", "だ", "て", "で", "な", "に", "を", "は", "が", "も",
    "よ", "ね", "か", "の", "と", "へ", "や", "ば", "り", "れ",
    "い", "ん", "ー", "っ",
  ]);

  function setAll(next) {
    rules = Array.isArray(next)
      ? next.map((r) => {
          const n = normalizeRule(r, null);
          n.id = r.id || n.id;
          n.created_at = r.created_at || n.created_at;
          n.updated_at = r.updated_at || n.updated_at;
          return n;
        })
      : [];
    Storage.saveRules(rules);
    return rules;
  }

  function getAll() {
    return rules.slice().sort((a, b) => {
      // 補充用法固定最後
      const as = isSupplementaryUsage(a);
      const bs = isSupplementaryUsage(b);
      if (as !== bs) return as ? 1 : -1;
      const ta = a.updated_at || a.created_at || "";
      const tb = b.updated_at || b.created_at || "";
      return tb.localeCompare(ta);
    });
  }

  function getById(id) {
    return rules.find((r) => r.id === id) || null;
  }

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function normalizeRule(input, existing = null) {
    const now = new Date().toISOString();
    const isUpdate = Boolean(existing);

    let conj = emptyConjugation();
    if (input && Object.prototype.hasOwnProperty.call(input, "conjugation")) {
      conj = migrateConjugation(input);
    } else if (existing?.conjugation) {
      conj = migrateConjugation(existing);
    } else {
      conj = migrateConjugation(input || {});
    }

    let requiresConjugation = Boolean(
      input?.requiresConjugation ?? existing?.requiresConjugation ?? false
    );
    if (hasConjugationContent(conj)) requiresConjugation = true;

    return {
      id: existing?.id || input?.id || uid(),
      title: (input?.title || existing?.title || "").trim() || "未命名規則",
      category: String(input?.category ?? existing?.category ?? "").trim(),
      explanation: (input?.explanation ?? existing?.explanation ?? "").trim(),
      requiresConjugation,
      conjugation: conj,
      created_at: existing?.created_at || input?.created_at || now,
      updated_at: isUpdate ? now : input?.updated_at || existing?.updated_at || now,
    };
  }

  function create(input) {
    const rule = normalizeRule(input);
    rules = [rule, ...rules];
    Storage.saveRules(rules);
    return rule;
  }

  function update(id, input) {
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error("找不到規則：" + id);
    const rule = normalizeRule(input, rules[idx]);
    rules = rules.slice();
    rules[idx] = rule;
    Storage.saveRules(rules);
    return rule;
  }

  function remove(id) {
    const before = rules.length;
    rules = rules.filter((r) => r.id !== id);
    if (rules.length === before) return false;
    Storage.saveRules(rules);
    return true;
  }

  function normalizeToken(raw) {
    return String(raw || "")
      .trim()
      .normalize("NFC")
      .replace(/\s+/g, "");
  }

  function ruleBlob(rule) {
    return [rule.title, rule.explanation, rule.category].filter(Boolean).join("\n");
  }

  /** 去掉文中的 ている 系寫法，避免「ています」被當成「ます」 */
  function stripTeiruMentions(text) {
    return String(text || "")
      .replace(/[てで]い?ま[しすせ]/g, "〓")
      .replace(/[てで]い?る/g, "〓")
      .replace(/[てで]い?た/g, "〓")
      .replace(/[てで]る/g, "〓");
  }

  /** ている 系接辭（由長到短，供剝離） */
  const TEIRU_SUFFIXES = [
    "ていませんでした", "でいませんでした",
    "ていました", "でいました", "ていません", "でいません",
    "ています", "でいます", "ていた", "でいた",
    "ている", "でいる", "てる", "でる",
  ];

  /** 表面形是否真的是 ている 系（します／食べます 不算） */
  function isTeiruSurface(form) {
    const f = normalizeToken(form);
    if (!f) return false;
    if (/(?:て|で)い?(?:る|た|て|ます|ました|ません|ろ|れ)/.test(f)) return true;
    if (/(?:て|で)る$/.test(f)) return true;
    return false;
  }

  function isTeiruKey(key) {
    const k = normalizeToken(key);
    if (!k) return false;
    return (
      /^(?:て|で)(?:い)?(?:る|た|て|ます|ました|ません)?$/.test(k) ||
      /てる|でる|ている|でいる|ていま|でいま|ていた|でいた/.test(k)
    );
  }

  /** 規則是否以 ている 為主題（標題為準） */
  function ruleIsTeiruTopic(rule) {
    const title = String(rule?.title || "");
    return /ている|てる|でいる|でる/.test(title);
  }

  /** 句型／接辭類規則（與動詞活用分開匹配） */
  function isPatternRule(rule) {
    if (!rule) return false;
    if (ruleIsTeiruTopic(rule)) return true;
    const t = String(rule.title || "");
    const c = String(rule.category || "");
    if (c === "句型" || c === "助動詞") return true;
    if (/てもいい|てください|てはいけ|ではいけ|ことがある|ように/.test(t)) return true;
    return false;
  }

  /** 動詞活用類規則（ます／て／ない…） */
  function isConjugationRule(rule) {
    if (!rule || isPatternRule(rule)) return false;
    const t = String(rule.title || "");
    const c = String(rule.category || "");
    if (c === "活用" || c === "動詞類型") return true;
    if (/ます形|て形|た形|ない形|ば形|意向|命令|たい形|音便/.test(t)) return true;
    return Boolean(rule.requiresConjugation);
  }

  /**
   * 從 食べている 剝成：て形（食べて）+ 句型標記（ている）
   * 構造是「て形＋いる」，故從後面剝 いる／います…，保留 て／で
   */
  function splitTeiruCompound(form) {
    const f = normalizeToken(form);
    if (!f || !isTeiruSurface(f)) return null;

    const pureOnly = new Set(TEIRU_SUFFIXES);
    if (pureOnly.has(f) || isTeiruKey(f)) {
      return { teForm: "", pattern: f, purePattern: true };
    }

    const pairs = [
      { re: /ていませんでした$/, teKeep: "て", pattern: "ていませんでした" },
      { re: /でいませんでした$/, teKeep: "で", pattern: "でいませんでした" },
      { re: /ていました$/, teKeep: "て", pattern: "ていました" },
      { re: /でいました$/, teKeep: "で", pattern: "でいました" },
      { re: /ていません$/, teKeep: "て", pattern: "ていません" },
      { re: /でいません$/, teKeep: "で", pattern: "でいません" },
      { re: /ています$/, teKeep: "て", pattern: "ています" },
      { re: /でいます$/, teKeep: "で", pattern: "でいます" },
      { re: /ていた$/, teKeep: "て", pattern: "ていた" },
      { re: /でいた$/, teKeep: "で", pattern: "でいた" },
      { re: /ている$/, teKeep: "て", pattern: "ている" },
      { re: /でいる$/, teKeep: "で", pattern: "でいる" },
      { re: /てる$/, teKeep: "て", pattern: "てる" },
      { re: /でる$/, teKeep: "で", pattern: "でる" },
    ];

    for (const { re, teKeep, pattern } of pairs) {
      if (re.test(f)) {
        const stem = f.replace(re, "");
        if (!stem) return { teForm: "", pattern, purePattern: true };
        // stem 已是 食べ／書い／待っ… → 補上 て／で 得て形
        const teForm = /[てで]$/.test(stem) ? stem : stem + teKeep;
        return { teForm, pattern, purePattern: false };
      }
    }
    return null;
  }

  /**
   * 在動詞鏈表面形內定位：て形前綴 + 句型接辭
   * 例：食べている → teForm 食べて（0..3）、pattern いる 標在接辭段（避免吞掉動詞）
   */
  function locateTeiruInSurface(surface) {
    const s = normalizeToken(surface);
    const split = splitTeiruCompound(s);
    if (!split) return null;
    if (split.purePattern) {
      return {
        localStart: 0,
        localEnd: s.length,
        key: split.pattern,
        teForm: "",
        tePart: "",
      };
    }
    const teForm = split.teForm;
    // て形必須是表面前綴（食べて ⊂ 食べている）
    if (teForm && s.startsWith(teForm)) {
      return {
        localStart: teForm.length,
        localEnd: s.length,
        key: s.slice(teForm.length) || split.pattern,
        teForm,
        tePart: teForm,
      };
    }
    // 後備：用 pattern 後綴
    const key = split.pattern;
    if (s.endsWith(key)) {
      return {
        localStart: s.length - key.length,
        localEnd: s.length,
        key,
        teForm,
        tePart: s.slice(0, s.length - key.length),
      };
    }
    return null;
  }

  /**
   * 從規則抽出可掃句的匹配鍵
   * ている 主題：只允許接辭本身，禁止「食べている」這類整段從說明進掃描
   */
  function extractMatchKeys(rule) {
    const text = ruleBlob(rule);
    const title = String(rule.title || "");
    const keys = new Set();
    const textNoTeiru = stripTeiruMentions(text);
    const titleNoTeiru = stripTeiruMentions(title);

    const addAll = (arr) => {
      for (const k of arr) {
        if (k && k.length >= 2 && !NOISY_SHORT.has(k)) keys.add(k);
      }
    };

    // ている 主題：只收接辭表
    if (ruleIsTeiruTopic(rule)) {
      addAll(TEIRU_SUFFIXES);
      const tildeRe = /[〜～~]([^\s・，。、（）()【】\[\]]+)/g;
      let tm;
      while ((tm = tildeRe.exec(title)) !== null) {
        const s = String(tm[1] || "").replace(/[（(].*$/, "").trim();
        if (s.length >= 2 && isTeiruKey(s)) keys.add(s);
      }
      return [...keys];
    }

    if (/てもいい|でもいい/.test(text)) {
      addAll(["てもいい", "でもいい"]);
    }
    if (/てはいけない|ではいけない|ちゃいけない|じゃいけない/.test(text)) {
      addAll(["てはいけない", "ではいけない", "ちゃいけない", "じゃいけない"]);
    }
    if (
      /ます形/.test(title) ||
      /ます形/.test(text) ||
      (/ます/.test(titleNoTeiru) && !/てい|でい|てる|でる/.test(title)) ||
      (/ません|ました/.test(titleNoTeiru) && !/てい|でい/.test(title))
    ) {
      addAll(["ませんでした", "ました", "ません", "ます"]);
    }
    if (/たい形/.test(title) || (/たい/.test(title) && !/して|ちた|いた|うた|てい/.test(title))) {
      addAll(["たかった", "たくない", "たい"]);
    }
    if (/ない形/.test(title) || (/ない/.test(title) && !/てい|でい|てる/.test(title))) {
      addAll(["なければ", "なかった", "ない"]);
    }

    const tildeRe = /[〜～~]([^\s・，。、（）()【】\[\]]+)/g;
    let tm;
    while ((tm = tildeRe.exec(text)) !== null) {
      const s = String(tm[1] || "")
        .replace(/[（(].*$/, "")
        .replace(/[のと]$/, "")
        .trim();
      if (s.length >= 2 && !NOISY_SHORT.has(s)) keys.add(s);
    }

    const jaRe = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFー]+/g;
    const titleJa = title.match(jaRe) || [];
    for (const s of titleJa) {
      if (s.length >= 2 && s.length <= 6 && !NOISY_SHORT.has(s)) keys.add(s);
    }

    // 說明：不收「動詞＋ている」複合（避免整段當鍵）
    const AMBIG_FRAG = new Set([
      "いる", "える", "する", "くる", "ます", "まし", "ませ", "ない", "あっ", "いっ",
      "てる", "でる", "いた", "した", "きる", "みる",
    ]);
    let m;
    const expl = String(rule.explanation || "");
    while ((m = jaRe.exec(expl)) !== null) {
      const s = m[0];
      if (s.length < 3 || s.length > 6) continue;
      if (NOISY_SHORT.has(s) || AMBIG_FRAG.has(s)) continue;
      if (isTeiruSurface(s) && !isTeiruKey(s) && !TEIRU_SUFFIXES.includes(s)) continue;
      keys.add(s);
    }

    return [...keys];
  }

  /**
   * 句型命中時：把標註區間縮成接辭，绝不含動詞語幹
   */
  function shrinkSpanToPatternOnly(query, start, end, hit) {
    const slice = query.slice(start, end);
    if (!slice) return { start, end };

    const loc = locateTeiruInSurface(slice);
    if (loc && loc.localEnd > loc.localStart) {
      // localStart>0 表示前面有て形語幹，只標後面接辭
      if (loc.localStart > 0 || (loc.teForm && loc.teForm.length > 0)) {
        return { start: start + loc.localStart, end: start + loc.localEnd };
      }
    }

    for (const suf of TEIRU_SUFFIXES) {
      if (slice.endsWith(suf) && slice.length > suf.length) {
        return { start: end - suf.length, end };
      }
    }

    const mk = hit?.matchedKey || hit?.form || "";
    if (mk && (isTeiruKey(mk) || TEIRU_SUFFIXES.includes(mk))) {
      if (slice.endsWith(mk) && slice.length > mk.length) {
        return { start: end - mk.length, end };
      }
    }

    // てもいい 等
    for (const suf of ["てもいいです", "でもいいです", "てもいい", "でもいい", "てはいけない", "ではいけない"]) {
      if (slice.endsWith(suf) && slice.length > suf.length) {
        return { start: end - suf.length, end };
      }
    }

    return { start, end };
  }

  /**
   * 表面形是否命中關鍵字／文法鍵
   * - 完全相等
   * - 以 〜／- 開頭的當後綴
   * - 或 form 以 key 結尾（語尾）
   */
  function formHitsKey(form, key) {
    const f = normalizeToken(form);
    let raw = String(key || "").trim();
    if (!f || !raw) return false;

    const isSuffixPat = /^[〜～~\-–—]/.test(raw);
    const k = normalizeToken(raw.replace(/^[〜～~\-–—]+/, ""));
    if (!k) return false;
    // 單字助詞允許（は／が／を）
    if (k.length < 1) return false;
    if (k.length === 1 && !isSuffixPat && f !== k && !f.endsWith(k)) {
      // 單字：僅完全相等或明確後綴模式
      if (f !== k) return false;
    }

    if (NOISY_SHORT.has(k) && k.length <= 1 && f !== k) return false;

    const hit =
      f === k ||
      (isSuffixPat && f.endsWith(k) && f.length >= k.length) ||
      (!isSuffixPat && f.endsWith(k) && f.length > k.length) ||
      (!isSuffixPat && f.includes(k) && k.length >= 2 && f.length <= k.length + 6);

    if (!hit) return false;

    // ている 系鍵：します 不得命中
    if (isTeiruKey(k) && !isTeiruSurface(f)) return false;

    // 「ます」鍵：ています 不算ます形
    if ((k === "ます" || k === "ました" || k === "ません" || k === "ませんでした") && isTeiruSurface(f)) {
      return false;
    }

    if (k === "ない" || k === "なかった" || k === "なければ") {
      if (isTeiruSurface(f) && !f.includes("ない")) return false;
    }

    return true;
  }

  function tokenize(text) {
    if (typeof JaTokenizer !== "undefined") {
      return JaTokenizer.tokenize(text);
    }
    const src = String(text || "");
    return [{ text: src, start: 0, end: src.length, isWord: src.trim().length > 0, basic_form: src }];
  }

  /**
   * 查詢詞 vs 規則：關鍵字優先 → 標題／說明 → 文法鍵 → 分析
   */
  function matchFormAgainstRule(form, rule, { sentenceMode = false, analysis = null } = {}) {
    const f = normalizeToken(form);
    if (!f || f.length < 1) return null;

    const blob = ruleBlob(rule);
    const title = String(rule.title || "");
    const keys = extractMatchKeys(rule);
    const teiruTopic = ruleIsTeiruTopic(rule);

    // ている 主題：表面形必須真的是 ている 系
    if (teiruTopic && !isTeiruSurface(f)) {
      if (!isTeiruKey(f) && f !== "ている" && f !== "てる") {
        return null;
      }
    }

    const isTeiruCompoundQuery =
      teiruTopic && isTeiruSurface(f) && !isTeiruKey(f) && !TEIRU_SUFFIXES.includes(f);

    // 完整出現在標題
    if (f.length >= 2 && title.includes(f) && !isTeiruCompoundQuery) {
      if (!(teiruTopic && !isTeiruSurface(f) && !isTeiruKey(f))) {
        return {
          rule,
          matchType: "form",
          hitNote: "標題",
          score: 900 + f.length * 10,
          form: f,
        };
      }
    }

    // 出現在說明
    if (f.length >= 3 && blob.includes(f) && !isTeiruCompoundQuery) {
      if (!(teiruTopic && !isTeiruSurface(f) && !isTeiruKey(f))) {
        return {
          rule,
          matchType: "form",
          hitNote: "說明",
          score: 700 + f.length * 8,
          form: f,
        };
      }
    }

    // 文法鍵／〜後綴
    let bestKey = null;
    for (const k of keys) {
      if (!formHitsKey(f, k)) continue;
      const bare = String(k).replace(/^[〜～~\-–—]+/, "");
      if (!bestKey || bare.length > String(bestKey).replace(/^[〜～~\-–—]+/, "").length) {
        bestKey = k;
      }
    }
    if (bestKey) {
      const bare = String(bestKey).replace(/^[〜～~\-–—]+/, "");
      const exact = f === bare || f === normalizeToken(bestKey);
      return {
        rule,
        matchType: exact ? "form" : "ending",
        hitNote: exact ? "文法鍵" : "文法後綴",
        score: (exact ? 850 : 480) + bare.length * 12 + (f.length - bare.length),
        form: f,
        matchedKey: bare,
      };
    }

    // 分析關鍵字：類型／形式（收緊 shortForm 子字串）
    if (analysis?.primary) {
      const p = analysis.primary;
      // 分析出 ます形 時，不要拿「ています」裡的「ます」去對 ている 規則
      if (teiruTopic && p.formName && p.formName !== "ている") {
        return null;
      }
      if (!teiruTopic && p.formName === "ている" && !/ている|てる|でいる/.test(title) && !/ている|てる|でいる/.test(blob)) {
        // 非 ている 規則且標題說明都沒提 → 不靠分析硬配
      }

      let score = 0;
      if (p.group && p.group !== "未知" && title.includes(p.group)) score += 50;

      if (p.formName && p.formName !== "未知") {
        if (title.includes(p.formName)) score += 50;
        else if (p.formName === "ている" && /ている|てる|でいる/.test(title)) score += 60;
        else if (p.formName === "ます形" && /ます形|(^|[^てでい])ます/.test(title) && !/てい|でい/.test(title)) score += 50;
        else if (p.formName === "ない形" && /ない形/.test(title)) score += 50;
        else if (p.formName === "て形" && /て形/.test(title)) score += 50;
        else if (p.formName === "た形" && /た形/.test(title)) score += 50;
        // 不再用 blob.includes("ます") 這種易誤判子字串
      }

      if (p.lemma && p.lemma !== "?" && p.lemma.length >= 2 && title.includes(p.lemma)) score += 30;

      if (score >= 50) {
        return {
          rule,
          matchType: "analysis",
          hitNote: "類型／形式",
          score: 200 + score,
          form: f,
        };
      }
    }

    return null;
  }

  /**
   * @param {'all'|'pattern'|'conjugation'} [layer]
   *   pattern：只句型（ている 等）；conjugation：只動詞活用；all：兩者
   */
  function matchTokenToRules(rawToken, { sentenceMode = false, analysis = null, layer = "all" } = {}) {
    const full = normalizeToken(rawToken);
    if (!full) return [];

    const variants = [full];
    const candidates = [];
    for (const form of variants) {
      for (const rule of rules) {
        if (layer === "pattern" && !isPatternRule(rule)) continue;
        if (layer === "conjugation" && !isConjugationRule(rule)) continue;
        // 複合 ている 表面形：不要用整段去對活用規則（改對て形）
        if (
          isConjugationRule(rule) &&
          isTeiruSurface(form) &&
          !isTeiruKey(form) &&
          layer !== "pattern"
        ) {
          continue;
        }
        const hit = matchFormAgainstRule(form, rule, { sentenceMode, analysis });
        if (!hit) continue;
        candidates.push({
          ...hit,
          token: rawToken,
          layer: isPatternRule(rule) ? "pattern" : "conjugation",
        });
      }
    }

    const byRule = new Map();
    for (const c of candidates) {
      const prev = byRule.get(c.rule.id);
      if (!prev || c.score > prev.score) byRule.set(c.rule.id, c);
    }

    const list = Array.from(byRule.values()).sort((a, b) => b.score - a.score);
    if (!list.length) return [];

    if (sentenceMode) {
      const hard = list.filter((c) => c.matchType === "form" || c.matchType === "ending");
      if (hard.length) {
        const top = hard[0].score;
        return hard.filter((c) => c.score >= top - 80).slice(0, 3);
      }
      return list.slice(0, 1);
    }
    return list;
  }

  /** 在句子中找 key 的所有出現位置（て いる 鍵需檢查前後文是否真為 ている 系） */
  function findAllOccurrences(query, key) {
    const k = normalizeToken(key);
    if (!k || k.length < 2) return [];
    const out = [];
    let from = 0;
    while (from < query.length) {
      const idx = query.indexOf(k, from);
      if (idx < 0) break;
      const start = idx;
      const end = idx + k.length;
      // 若鍵是 ている 系，取前後一點上下文確認（避免誤標）
      if (isTeiruKey(k)) {
        const ctxStart = Math.max(0, start - 4);
        const ctxEnd = Math.min(query.length, end + 2);
        const ctx = query.slice(ctxStart, ctxEnd);
        if (!isTeiruSurface(ctx) && !isTeiruSurface(query.slice(start, end))) {
          from = idx + 1;
          continue;
        }
      }
      // 「ます」不要命中「ています」裡的ます
      if (k === "ます" || k === "ました" || k === "ません") {
        const before = query.slice(Math.max(0, start - 2), start);
        if (/[てで]い?$/.test(before) || /[てで]$/.test(before)) {
          from = idx + 1;
          continue;
        }
      }
      out.push({ start, end, key: k });
      from = idx + 1;
    }
    return out;
  }

  function searchByForm(rawForm) {
    const form = Analyzer.normalize(rawForm);
    if (!form) {
      return {
        mode: "single",
        query: rawForm || "",
        form: "",
        matches: [],
        partial: [],
        spans: [],
        legend: [],
        analysis: null,
        verbAnalysis: null,
        patternInfo: null,
        sentenceAnalysis: null,
      };
    }

    // ── ている 類複合：句型與動詞活用分層 ──
    const split = splitTeiruCompound(form);
    if (split && !split.purePattern) {
      const patternHits = matchTokenToRules(split.pattern, {
        sentenceMode: false,
        analysis: null,
        layer: "pattern",
      });
      // 也允許整段對句型規則（標題含 ている）
      const patternHits2 = matchTokenToRules(form, {
        sentenceMode: false,
        analysis: { primary: { formName: "ている", group: "", lemma: "" } },
        layer: "pattern",
      });

      const verbAnalysis = Analyzer.analyze(split.teForm);
      const verbHits = matchTokenToRules(split.teForm, {
        sentenceMode: false,
        analysis: verbAnalysis,
        layer: "conjugation",
      });

      const mapHit = (h, role) => ({
        rule: h.rule,
        matchType: h.matchType,
        hitNote: h.hitNote,
        score: h.score + (role === "pattern" ? 50 : 0),
        role,
        spans: [{ text: role === "pattern" ? split.pattern : split.teForm, form: h.form }],
      });

      const byId = new Map();
      for (const h of [...patternHits, ...patternHits2]) {
        const m = mapHit(h, "pattern");
        const prev = byId.get(m.rule.id);
        if (!prev || m.score > prev.score) byId.set(m.rule.id, m);
      }
      for (const h of verbHits) {
        if (byId.has(h.rule.id)) continue;
        if (h.matchType === "form" || h.matchType === "ending" || h.matchType === "analysis") {
          byId.set(h.rule.id, mapHit(h, "conjugation"));
        }
      }

      const matches = Array.from(byId.values()).sort((a, b) => b.score - a.score);
      const patternInfo = {
        pattern: split.pattern,
        teForm: split.teForm,
        label: "句型接辭（ている 系）",
      };

      return {
        mode: "single",
        query: rawForm,
        form,
        matches,
        partial: [],
        analysis: verbAnalysis,
        verbAnalysis,
        patternInfo,
        sentenceAnalysis: null,
        spans: (() => {
          const loc = locateTeiruInSurface(form);
          const patRule = matches.find((m) => m.role === "pattern");
          const conjRule = matches.find((m) => m.role === "conjugation");
          const out = [];
          if (loc && patRule) {
            out.push({
              text: form.slice(loc.localStart, loc.localEnd),
              start: loc.localStart,
              end: loc.localEnd,
              ruleId: patRule.rule.id,
              colorIndex: 0,
            });
          }
          if (loc && loc.teForm && conjRule) {
            out.push({
              text: loc.teForm,
              start: 0,
              end: loc.localStart > 0 ? loc.localStart : loc.teForm.length,
              ruleId: conjRule.rule.id,
              colorIndex: 1,
            });
          }
          if (!out.length && matches.length) {
            out.push({
              text: form,
              start: 0,
              end: form.length,
              ruleId: matches[0].rule.id,
              colorIndex: 0,
            });
          }
          return out;
        })(),
        legend: matches.slice(0, 8).map((m, i) => ({
          ruleId: m.rule.id,
          title: m.rule.title,
          colorIndex: i,
        })),
      };
    }

    // 純 ている 接辭
    if (split && split.purePattern) {
      const hits = matchTokenToRules(form, { sentenceMode: false, layer: "pattern" });
      const matches = hits
        .filter((h) => h.matchType === "form" || h.matchType === "ending" || h.matchType === "analysis")
        .map((h) => ({
          rule: h.rule,
          matchType: h.matchType,
          hitNote: h.hitNote,
          score: h.score,
          role: "pattern",
          spans: [{ text: form, form: h.form }],
        }));
      return {
        mode: "single",
        query: rawForm,
        form,
        matches,
        partial: [],
        analysis: null,
        verbAnalysis: null,
        patternInfo: { pattern: form, teForm: "", label: "句型接辭（ている 系）" },
        sentenceAnalysis: null,
        spans: matches.length
          ? [{ text: form, start: 0, end: form.length, ruleId: matches[0].rule.id, colorIndex: 0 }]
          : [],
        legend: matches.slice(0, 8).map((m, i) => ({
          ruleId: m.rule.id,
          title: m.rule.title,
          colorIndex: i,
        })),
      };
    }

    // ── 一般單詞（非 ている 複合）──
    const analysis = Analyzer.analyze(form);
    const hits = matchTokenToRules(rawForm, { sentenceMode: false, analysis, layer: "all" });

    const exact = hits
      .filter((h) => h.matchType === "form" || h.matchType === "ending")
      .map((h) => ({
        rule: h.rule,
        matchType: h.matchType,
        hitNote: h.hitNote,
        score: h.score,
        role: isPatternRule(h.rule) ? "pattern" : "conjugation",
        spans: [{ text: rawForm, form: h.form }],
      }));

    const fromAnalysis = hits
      .filter((h) => h.matchType === "analysis")
      .filter((h) => !exact.some((e) => e.rule.id === h.rule.id))
      .map((h) => ({
        rule: h.rule,
        matchType: "analysis",
        hitNote: h.hitNote,
        score: h.score,
        role: isPatternRule(h.rule) ? "pattern" : "conjugation",
        spans: [],
      }));

    const partial = [];
    for (const rule of rules) {
      if (exact.some((m) => m.rule.id === rule.id)) continue;
      if (fromAnalysis.some((m) => m.rule.id === rule.id)) continue;
      if (ruleIsTeiruTopic(rule) && !isTeiruSurface(form) && !isTeiruKey(form)) continue;

      const title = String(rule.title || "");
      const keys = [];
      if (analysis?.primary?.lemma && analysis.primary.lemma !== "?") keys.push(analysis.primary.lemma);
      if (analysis?.primary?.formName && analysis.primary.formName !== "未知") keys.push(analysis.primary.formName);
      if (analysis?.primary?.group && analysis.primary.group !== "未知") keys.push(analysis.primary.group);

      const matchedKey = keys.find((k) => k && title.includes(k));
      if (matchedKey) {
        partial.push({
          rule,
          matchType: "text",
          hitNote: "相關",
          score: 40,
          spans: [],
        });
      }
    }

    for (const p of partial) {
      const t = p.rule.title || "";
      if (analysis?.primary?.group && t.includes(analysis.primary.group)) p.score += 15;
      if (analysis?.primary?.formName && t.includes(analysis.primary.formName)) p.score += 15;
    }

    exact.sort((a, b) => b.score - a.score);
    fromAnalysis.sort((a, b) => b.score - a.score);
    partial.sort((a, b) => b.score - a.score);

    const matches = [...exact, ...fromAnalysis];

    return {
      mode: "single",
      query: rawForm,
      form,
      matches,
      partial: partial.slice(0, 8),
      analysis,
      verbAnalysis: analysis,
      patternInfo: null,
      sentenceAnalysis: null,
      spans: exact.length
        ? [
            {
              text: String(rawForm).trim(),
              start: 0,
              end: String(rawForm).trim().length,
              ruleId: exact[0].rule.id,
              colorIndex: 0,
            },
          ]
        : [],
      legend: matches.slice(0, 8).map((m, i) => ({
        ruleId: m.rule.id,
        title: m.rule.title,
        colorIndex: i,
      })),
    };
  }

  function searchSentence(rawText) {
    const query = String(rawText || "");
    const tokens = tokenize(query);
    const wordTokens = tokens.filter((t) => t.isWord);

    if (wordTokens.length <= 1 && !/[\u3040-\u30FF\u4E00-\u9FFF]/.test(query)) {
      return searchByForm(query.trim());
    }
    if (wordTokens.length === 0) {
      return searchByForm(query.trim());
    }
    if (wordTokens.length === 1 && query.trim().length <= 12 && !/[。．.！？!?]/.test(query)) {
      const single = searchByForm(query.trim());
      if (single.matches.length || (single.analysis && single.analysis.primary?.formName !== "未知")) {
        return single;
      }
      const bf = wordTokens[0].basic_form;
      if (bf && bf !== query.trim()) {
        const alt = searchByForm(bf);
        if (alt.matches.length) {
          return { ...alt, query, form: query.trim(), mode: "single" };
        }
      }
    }

    const ruleMap = new Map();
    const spanHits = [];
    const candidates = [];

    // 先做句中動詞鏈分析；ている 類拆成「て形活用」+「句型接辭」兩層
    const sentenceAnalysis = Analyzer.analyzeSentence(query);
    for (const v of sentenceAnalysis.verbs || []) {
      if (!v.text || v.start == null) continue;

      const loc = locateTeiruInSurface(v.text);
      if (loc) {
        // 句型：只標接辭段（いる／てる…），不標整段動詞
        const pStart = v.start + loc.localStart;
        const pEnd = v.start + loc.localEnd;
        // 用「ている」等完整名去對句型規則，標註位置仍是接辭
        const patternName = splitTeiruCompound(v.text)?.pattern || loc.key;
        const patternHits = matchTokenToRules(patternName, {
          sentenceMode: true,
          layer: "pattern",
        });
        // 若接辭名對不到，再用 ている 標題規則掃描
        const patternHits2 =
          patternHits.length > 0
            ? patternHits
            : matchTokenToRules("ている", { sentenceMode: true, layer: "pattern" });
        for (const hit of patternHits2) {
          candidates.push({
            form: patternName,
            start: pStart,
            end: pEnd,
            bonus: 80 + (pEnd - pStart),
            forcedHit: { ...hit, matchedKey: patternName, layer: "pattern" },
            noExpand: true,
          });
        }
        // 活用：只對て形（食べて）
        const teForm = loc.teForm || loc.tePart;
        if (teForm) {
          const teAnalysis = Analyzer.analyze(teForm);
          const conjHits = matchTokenToRules(teForm, {
            sentenceMode: true,
            analysis: teAnalysis,
            layer: "conjugation",
          });
          const teStart = v.start;
          const teEnd =
            v.start + (String(v.text).startsWith(teForm) ? teForm.length : loc.localStart);
          for (const hit of conjHits) {
            candidates.push({
              form: teForm,
              start: teStart,
              end: teEnd,
              bonus: 45 + teForm.length,
              analysis: teAnalysis,
              forcedHit: { ...hit, layer: "conjugation" },
              noExpand: true,
            });
          }
          v.analysis = teAnalysis;
          v.teForm = teForm;
          v.pattern = patternName;
          v.textDisplay = teForm;
        }
        continue;
      }

      // 非 ている 鏈：整段當動詞活用
      candidates.push({
        form: v.text,
        start: v.start,
        end: v.end,
        bonus: 40 + v.text.length,
        analysis: v.analysis,
      });
      const list = matchTokenToRules(v.text, {
        sentenceMode: true,
        analysis: v.analysis,
        layer: "conjugation",
      });
      for (const hit of list) {
        candidates.push({
          form: v.text,
          start: v.start,
          end: v.end,
          bonus: 50 + (hit.score || 0) / 10,
          forcedHit: { ...hit, layer: "conjugation" },
          noExpand: true,
        });
      }
    }

    for (let i = 0; i < wordTokens.length; i++) {
      const w = wordTokens[i];
      candidates.push({ form: w.text, start: w.start, end: w.end, bonus: 0 });
      if (w.basic_form && w.basic_form !== w.text) {
        candidates.push({ form: w.basic_form, start: w.start, end: w.end, bonus: -5 });
      }
      // 相鄰 2～4-gram；若組成 ている 複合則拆成接辭候選（不推整段）
      let acc = w.text;
      let endPos = w.end;
      for (let n = 1; n <= 3 && i + n < wordTokens.length; n++) {
        const next = wordTokens[i + n];
        if (next.start - endPos > 2) break;
        acc += next.text;
        endPos = next.end;
        if (isTeiruSurface(acc) && !isTeiruKey(acc)) {
          const loc = locateTeiruInSurface(acc);
          if (loc && loc.localStart > 0) {
            candidates.push({
              form: acc.slice(loc.localStart, loc.localEnd) || loc.key,
              start: w.start + loc.localStart,
              end: w.start + loc.localEnd,
              bonus: 55 + (loc.localEnd - loc.localStart),
              noExpand: true,
            });
            if (loc.teForm) {
              candidates.push({
                form: loc.teForm,
                start: w.start,
                end: w.start + loc.localStart,
                bonus: 40 + loc.teForm.length,
                noExpand: true,
              });
            }
            continue;
          }
        }
        candidates.push({ form: acc, start: w.start, end: endPos, bonus: 10 + n * 10 });
      }
    }

    // 從規則抽出文法鍵（ている 等），在句中直接掃描位置
    for (const rule of rules) {
      if (isSupplementaryUsage(rule)) continue; // 補充用法不自動句中標註
      const keys = extractMatchKeys(rule).sort((a, b) => b.length - a.length);
      for (const key of keys) {
        if (key.length < 2 || key.length > 20) continue;
        for (const occ of findAllOccurrences(query, key)) {
          candidates.push({
            form: key,
            start: occ.start,
            end: occ.end,
            bonus: 60 + key.length * 5,
            forcedRule: rule,
            forcedHit: {
              rule,
              matchType: "form",
              hitNote: "文法鍵掃描",
              score: 1000 + key.length * 15,
              form: key,
              matchedKey: key,
            },
          });
        }
      }
    }

    candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || b.bonus - a.bonus);

    const covered = [];
    function overlaps(s, e) {
      return covered.some((c) => s < c.end && e > c.start);
    }

    for (const rawCand of candidates) {
      let cStart = rawCand.start;
      let cEnd = rawCand.end;
      let cForm = rawCand.form;
      const cBonus = rawCand.bonus || 0;
      const cNoExpand = rawCand.noExpand;
      const cAnalysis = rawCand.analysis;

      if (cStart == null || cEnd == null || cEnd <= cStart) continue;

      let hit = null;
      if (rawCand.forcedHit) {
        hit = { ...rawCand.forcedHit, score: (rawCand.forcedHit.score || 0) + cBonus };
      } else if (rawCand.forcedRule) {
        hit = {
          rule: rawCand.forcedRule,
          matchType: "form",
          hitNote: "說明／標題",
          score: 1000 + String(cForm).length * 10 + cBonus,
          form: cForm,
          layer: isPatternRule(rawCand.forcedRule) ? "pattern" : "conjugation",
        };
      } else {
        // n-gram／語素：複合 ている 不整段對句型
        const formIsTeiruCompound =
          isTeiruSurface(cForm) && !isTeiruKey(cForm) && !TEIRU_SUFFIXES.includes(cForm);
        const list = matchTokenToRules(cForm, {
          sentenceMode: true,
          analysis: cAnalysis || null,
          layer: formIsTeiruCompound ? "conjugation" : "all",
        });
        if (!list.length) {
          if (formIsTeiruCompound) {
            const loc = locateTeiruInSurface(cForm);
            const pname = splitTeiruCompound(cForm)?.pattern || "ている";
            const ph = matchTokenToRules(pname, { sentenceMode: true, layer: "pattern" });
            if (ph.length && loc) {
              hit = { ...ph[0], layer: "pattern", matchedKey: pname };
              hit.score += cBonus;
              cStart = rawCand.start + loc.localStart;
              cEnd = rawCand.start + loc.localEnd;
              cForm = pname;
            } else {
              continue;
            }
          } else {
            continue;
          }
        } else {
          hit = { ...list[0] };
          hit.score += cBonus;
        }
      }

      // 句型命中：強制縮成接辭區間（绝不含動詞語幹）
      let spanStart = cStart;
      let spanEnd = cEnd;
      const isPatternHit =
        hit.layer === "pattern" ||
        isPatternRule(hit.rule) ||
        (hit.matchedKey && (isTeiruKey(hit.matchedKey) || TEIRU_SUFFIXES.includes(hit.matchedKey)));

      if (isPatternHit) {
        const shrunk = shrinkSpanToPatternOnly(query, spanStart, spanEnd, hit);
        spanStart = shrunk.start;
        spanEnd = shrunk.end;
      } else if (!cNoExpand && hit.matchedKey && !isTeiruKey(hit.matchedKey)) {
        const covering = (sentenceAnalysis.verbs || []).find(
          (v) => v.start <= cStart && v.end >= cEnd
        );
        if (covering && !locateTeiruInSurface(covering.text)) {
          spanStart = covering.start;
          spanEnd = covering.end;
        }
      }

      // 活用命中若誤蓋到 ている 接辭，縮回て形前
      if (!isPatternHit) {
        const slice = query.slice(spanStart, spanEnd);
        const loc = locateTeiruInSurface(slice);
        if (loc && loc.teForm && loc.localStart > 0) {
          spanEnd = spanStart + loc.localStart;
        }
      }

      if (spanEnd <= spanStart) continue;
      if (overlaps(spanStart, spanEnd)) continue;

      covered.push({ start: spanStart, end: spanEnd });
      spanHits.push({
        text: query.slice(spanStart, spanEnd),
        start: spanStart,
        end: spanEnd,
        hit,
      });

      const existing = ruleMap.get(hit.rule.id);
      const span = {
        text: query.slice(spanStart, spanEnd),
        start: spanStart,
        end: spanEnd,
        form: hit.form,
        matchType: hit.matchType,
      };
      if (!existing) {
        ruleMap.set(hit.rule.id, {
          rule: hit.rule,
          matchType: hit.matchType,
          hitNote: hit.hitNote,
          score: hit.score,
          spans: [span],
        });
      } else {
        existing.spans.push(span);
        existing.score = Math.max(existing.score, hit.score);
      }
    }

    spanHits.sort((a, b) => a.start - b.start);

    const appearance = [];
    for (const { hit } of spanHits) {
      if (!appearance.includes(hit.rule.id)) appearance.push(hit.rule.id);
    }
    const colorOf = new Map(appearance.map((id, i) => [id, i % 8]));

    const spans = spanHits.map(({ text, start, end, hit }) => ({
      text,
      start,
      end,
      ruleId: hit.rule.id,
      colorIndex: colorOf.get(hit.rule.id) ?? 0,
      matchType: hit.matchType,
    }));

    const matches = appearance
      .map((id) => {
        const m = ruleMap.get(id);
        return {
          ...m,
          colorIndex: colorOf.get(id) ?? 0,
        };
      })
      .filter(Boolean);

    const legend = matches.map((m) => ({
      ruleId: m.rule.id,
      title: m.rule.title,
      colorIndex: m.colorIndex,
      count: m.spans.length,
    }));

    return {
      mode: "sentence",
      query,
      form: query,
      tokens,
      spans,
      matches,
      partial: [],
      legend,
      analysis: null,
      sentenceAnalysis,
      tokenizer: typeof JaTokenizer !== "undefined" ? JaTokenizer.getStatus() : null,
    };
  }

  function search(rawQuery) {
    const text = String(rawQuery || "").trim();
    if (!text) {
      return {
        mode: "single",
        query: "",
        form: "",
        matches: [],
        partial: [],
        spans: [],
        legend: [],
        analysis: null,
      };
    }

    const hasJa = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(text);
    const isSentenceLike =
      /\s/.test(text) ||
      /[。．.！？!?、]/.test(text) ||
      (hasJa && text.length >= 6);

    if (isSentenceLike) return searchSentence(text);

    const single = searchByForm(text);
    if (single.matches.length) return single;

    if (hasJa && text.length >= 3) {
      const sent = searchSentence(text);
      if (sent.matches.length || sent.sentenceAnalysis?.verbs?.length) return sent;
    }
    return single;
  }

  function filterList(query) {
    const q = (query || "").trim().toLowerCase();
    return getAll().filter((rule) => {
      if (!q) return true;
      const c = rule.conjugation || {};
      const blob = [rule.title, rule.explanation, rule.category, c.ichidan, c.godan, c.sahen]
        .join(" ")
        .toLowerCase();
      return blob.includes(q) || blob.includes(query.trim());
    });
  }

  async function init() {
    const loaded = await Storage.initWithSeed();
    rules = (loaded || []).map((r) => {
      const n = normalizeRule(r, null);
      n.id = r.id || n.id;
      n.updated_at = r.updated_at || n.updated_at;
      n.created_at = r.created_at || n.created_at;
      return n;
    });
    Storage.saveRules(rules);
    return rules;
  }

  /**
   * API 盤點項目是否已有本地規則
   * @returns {{ owned: boolean, rule: object|null, score: number }}
   */
  function findMatchingRule(nameOrItem) {
    const name =
      typeof nameOrItem === "string"
        ? nameOrItem
        : nameOrItem?.name || nameOrItem?.title || "";
    const nameJa =
      typeof nameOrItem === "object"
        ? nameOrItem?.nameJa || nameOrItem?.nameKo || nameOrItem?.span || ""
        : "";
    const nameZh =
      typeof nameOrItem === "object" ? nameOrItem?.nameZh || "" : "";
    const n = normalizeToken(name);
    const ja = normalizeToken(nameJa);
    const zh = normalizeToken(nameZh);

    let best = null;
    let bestScore = 0;
    for (const rule of rules) {
      let score = 0;
      const title = normalizeToken(rule.title || "");
      const expl = normalizeToken(rule.explanation || "");
      if (n && title === n) score += 50;
      if (n && title.includes(n)) score += 22;
      if (zh && title.includes(zh) && zh.length >= 2) score += 16;
      if (ja && title.includes(ja) && ja.length >= 1) score += 18;
      // 說明含日文標記可加分，但門檻提高
      if (ja && ja.length >= 2 && expl.includes(ja)) score += 6;
      if (nameOrItem?.category && rule.category === nameOrItem.category) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }
    if (bestScore >= 16) return { owned: true, rule: best, score: bestScore };
    return { owned: false, rule: null, score: bestScore };
  }

  /** 清理 span 針：去掉 ～〜- 等裝飾 */
  function cleanSpanNeedle(raw) {
    return String(raw || "")
      .trim()
      .replace(/^[\s〜～\-－—–・‧.．]+/, "")
      .replace(/[\s〜～\-－—–・‧.．]+$/, "")
      .replace(/[（(].*?[）)]/g, "")
      .trim();
  }

  /**
   * 依規則名／分類推活用語尾針（API 漏 span 時後備）
   */
  function conjugationNeedlesFromItem(item) {
    const blob = [
      item?.name,
      item?.title,
      item?.nameZh,
      item?.nameJa,
      item?.category,
      item?.span,
    ]
      .map((x) => String(x || ""))
      .join(" ");
    const needles = [];
    const add = (s) => {
      if (s && !needles.includes(s)) needles.push(s);
    };

    if (/ます|丁寧|丁寧形|masu/i.test(blob)) {
      ["ませんでした", "ました", "ません", "ます"].forEach(add);
    }
    if (/て形|て形|て$|で形/.test(blob) && !/ている|てる|ても/.test(blob)) {
      ["って", "て", "で"].forEach(add);
    }
    if (/た形|過去(?!否定)|た$/.test(blob) && !/たら/.test(blob)) {
      ["った", "んだ", "いた", "いだ", "した", "た", "だ"].forEach(add);
    }
    if (/ない|否定/.test(blob) && !/ません/.test(blob)) {
      ["なかった", "ない", "ぬ"].forEach(add);
    }
    if (/ば形|假定|条件/.test(blob)) {
      ["れば", "えば", "けば", "げば", "せば", "てば", "ねば", "べば", "めば", "ば"].forEach(add);
    }
    if (/意向|う形|よう/.test(blob)) {
      ["しよう", "よう", "おう", "こう", "そう", "とう", "のう", "もう", "ろう", "う"].forEach(add);
    }
    if (/たい|希望/.test(blob)) {
      ["たかった", "たい"].forEach(add);
    }
    if (/ている|てる|進行/.test(blob)) {
      ["ている", "でいる", "てる", "でる"].forEach(add);
    }
    if (/辞書|終止|原形/.test(blob)) {
      // 無法用固定語尾，交給 Analyzer
    }
    return needles;
  }

  /**
   * 在原文中定位 API item 的 span
   * @returns {{ start: number, end: number, text: string, needle: string }[]}
   */
  function locateApiItemInText(text, item) {
    const src = String(text || "");
    const out = [];
    const seen = new Set();

    // 手動／本地掃描給定區間優先
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= src.length
    ) {
      const key = `${start}:${end}`;
      seen.add(key);
      out.push({
        start,
        end,
        text: src.slice(start, end),
        needle: String(item?.span || src.slice(start, end)),
      });
      return out;
    }

    const needles = [];
    const pushNeedle = (raw) => {
      const n = cleanSpanNeedle(raw);
      if (n && n.length >= 1 && !needles.includes(n)) needles.push(n);
      // 也試去掉全形空白
      const n2 = n.replace(/\u3000/g, "");
      if (n2 && n2 !== n && !needles.includes(n2)) needles.push(n2);
    };

    pushNeedle(item?.span);
    pushNeedle(item?.nameJa);
    pushNeedle(item?.nameKo);
    // 從 name 抽出日文片段
    const name = String(item?.name || "");
    const jaInName = name.match(/[\u3040-\u30FF\u4E00-\u9FFFー]+/g) || [];
    for (const j of jaInName) {
      // 略過過短抽象（形／る 等）與純「活用」類漢字短詞
      if (j.length >= 2 || /[てをがにはも]$/.test(j)) pushNeedle(j);
    }
    // 活用語尾後備
    for (const s of conjugationNeedlesFromItem(item)) pushNeedle(s);

    for (const needle of needles) {
      if (!needle || needle.length < 1) continue;
      // 抽象標籤不可當針
      if (/^(ます形|て形|た形|ない形|ば形|辞書形|意向形|活用|丁寧形)$/.test(needle)) continue;
      let from = 0;
      while (from < src.length) {
        const idx = src.indexOf(needle, from);
        if (idx < 0) break;
        const key = `${idx}:${idx + needle.length}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            start: idx,
            end: idx + needle.length,
            text: src.slice(idx, idx + needle.length),
            needle,
          });
        }
        from = idx + Math.max(1, needle.length);
      }
    }
    // 較長優先
    out.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    return out;
  }

  /**
   * API 漏 span 時：用 Analyzer 句中動詞補上活用定位
   * 會就地寫入 item.span / start / end（不改 name）
   */
  function enrichInventoryWithAnalyzer(query, inventory) {
    const src = String(query || "");
    const items = inventory?.items;
    if (!src || !Array.isArray(items) || !items.length) return inventory;
    if (typeof Analyzer === "undefined" || !Analyzer.analyzeSentence) return inventory;

    let verbs = [];
    try {
      verbs = Analyzer.analyzeSentence(src)?.verbs || [];
    } catch {
      verbs = [];
    }
    if (!verbs.length) return inventory;

    const formKey = (name) => {
      const t = String(name || "");
      if (/ている|てる|進行/.test(t)) return "ている";
      if (/ます|丁寧/.test(t)) return "ます形";
      if (/て形|接続て/.test(t) && !/ている|ても|てください/.test(t)) return "て形";
      if (/た形|過去/.test(t) && !/たら/.test(t)) return "た形";
      if (/ない|否定/.test(t)) return "ない形";
      if (/ば形|假定|条件/.test(t)) return "ば形";
      if (/意向|う形|よう形/.test(t)) return "意向形";
      if (/たい|希望/.test(t)) return "たい形";
      if (/辞書|終止|原形/.test(t)) return "辞書形";
      return "";
    };

    for (const it of items) {
      const already = locateApiItemInText(src, it);
      let best = already[0]
        ? { start: already[0].start, end: already[0].end, text: already[0].text }
        : null;

      const cat = String(it.category || "");
      const want = formKey(it.name || it.nameZh || "");
      const isConj =
        Boolean(want) ||
        cat === "活用" ||
        /動詞|活用|ます|て形|ない|た形|ば形|意向|辞書/.test(String(it.name || "") + cat);

      // 活用：優先用 Analyzer 完整動詞表面（食べます > ます）
      if (isConj) {
        for (const v of verbs) {
          const surface = String(v.teForm || v.textDisplay || v.text || "").trim();
          if (!surface || surface.length < 1) continue;
          const fn = String(v.analysis?.primary?.formName || "");
          const tags = (v.analysis?.primary?.formTags || []).join(" ");
          let hit = false;
          if (want === "ます形" && (/ます/.test(fn) || /丁寧/.test(tags) || /ます/.test(surface)))
            hit = true;
          else if (
            want === "て形" &&
            (/て形/.test(fn) || /[てで]$/.test(surface)) &&
            !/ている|てる|でいる|でる/.test(surface)
          )
            hit = true;
          else if (want === "た形" && (/た形/.test(fn) || /過去/.test(tags) || /[ただ]$/.test(surface)))
            hit = true;
          else if (want === "ない形" && (/ない/.test(fn) || /否定/.test(tags) || /ない$/.test(surface)))
            hit = true;
          else if (want === "ば形" && (/ば形|假定/.test(fn) || /ば$/.test(surface))) hit = true;
          else if (want === "意向形" && (/意向/.test(fn) || /よう$|おう$|こう$|そう$|とう$|のう$|もう$|ろう$|う$/.test(surface)))
            hit = true;
          else if (want === "たい形" && (/たい/.test(fn) || /たい$/.test(surface))) hit = true;
          else if (
            want === "ている" &&
            (/ている|てる/.test(fn) || /て[い]?る|で[い]?る/.test(surface))
          )
            hit = true;
          else if (
            want === "辞書形" &&
            (/辞書|終止/.test(fn) || surface === (v.analysis?.primary?.lemma || ""))
          )
            hit = true;
          else if (!want && surface.length >= 2) {
            const blob = String(it.name || "");
            if ((fn && blob.includes(fn)) || blob.includes(surface)) hit = true;
          }

          if (!hit) continue;
          let idx = src.indexOf(surface);
          let end = idx >= 0 ? idx + surface.length : -1;
          if (idx < 0 && v.start != null && Number.isFinite(Number(v.start))) {
            idx = Number(v.start);
            const e = Number(v.end);
            if (Number.isFinite(e) && e > idx) {
              end = e;
            } else {
              idx = -1;
            }
          }
          if (idx < 0 || end <= idx) continue;
          const cand = { start: idx, end, text: src.slice(idx, end) };
          if (!best || cand.end - cand.start > best.end - best.start) {
            best = cand;
          }
        }
      }

      if (best) {
        it.span = best.text;
        it.start = best.start;
        it.end = best.end;
      }
    }
    return inventory;
  }

  /**
   * 選字套用：依選定片段本地打分，高分規則置頂建議
   * @param {string} selectedText
   * @param {{ minScore?: number, maxSuggest?: number }} [opts]
   * @returns {{ suggestions: { rule, score, reasons: string[] }[], rest: object[] }}
   */
  function rankRulesForSpan(selectedText, opts = {}) {
    const sel = String(selectedText || "").trim();
    const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 8;
    const maxSuggest = Number.isFinite(opts.maxSuggest) ? opts.maxSuggest : 8;
    const all = getAll();
    if (!sel) {
      return { suggestions: [], rest: all };
    }

    const selNorm = normalizeToken(sel);
    const scored = [];

    const localResult = typeof search === "function" ? search(sel) : null;
    const localById = new Map();
    for (const m of localResult?.matches || []) {
      if (m?.rule?.id) localById.set(m.rule.id, m);
    }

    const asNameMatch = findMatchingRule({
      name: sel,
      nameJa: sel,
      nameZh: sel,
      span: sel,
    });

    const surfaceBoosts = [];
    const JA_HINTS = [
      { re: /^(は|が)$/, titleRe: /は|が|主題|主格/, score: 24, reason: "助詞 は／が" },
      { re: /^(を|に|で|と|へ|も|の|から|まで|より|や|か)$/, titleRe: /助詞|を|に|で|と|へ/, score: 20, reason: "常見助詞" },
      { re: /ませんでした|ました|ません|ます/, titleRe: /ます|丁寧|丁寧形/, score: 24, reason: "ます形" },
      { re: /ている|てる|でいる|でる/, titleRe: /ている|てる|進行/, score: 22, reason: "ている" },
      { re: /てもいい|でもいい/, titleRe: /てもいい|許可/, score: 26, reason: "てもいい" },
      { re: /てください|でください/, titleRe: /てください|依頼/, score: 24, reason: "てください" },
      { re: /たい|たかった/, titleRe: /たい|希望/, score: 20, reason: "たい形" },
      { re: /ない|なかった|ぬ/, titleRe: /ない|否定/, score: 16, reason: "否定" },
      { re: /たら|れば|えば|けば/, titleRe: /たら|ば|假定|条件/, score: 18, reason: "假定" },
      { re: /よう|おう|こう|そう/, titleRe: /意向|う形|よう/, score: 16, reason: "意向形" },
      { re: /だ|です|である/, titleRe: /だ|です|断定|指定/, score: 14, reason: "断定" },
    ];
    for (const h of JA_HINTS) {
      if (h.re.test(sel) || h.re.test(selNorm)) {
        surfaceBoosts.push({
          test: (r) => h.titleRe.test([r.title, r.explanation || "", r.category || ""].join("\n")),
          score: h.score,
          reason: h.reason,
        });
      }
    }

    for (const rule of all) {
      let score = 0;
      const reasons = [];
      const local = localById.get(rule.id);
      if (local && (local.score || 0) > 0) {
        score += Math.min(22, local.score || 10);
        reasons.push(local.notes?.[0] || "本地命中");
      }

      const titleNorm = normalizeToken(rule.title || "");
      if (titleNorm === selNorm && selNorm) {
        score += 30;
        reasons.push("與標題完全相同");
      } else if (selNorm.length >= 2 && titleNorm.includes(selNorm)) {
        score += 14;
        reasons.push("標題包含選取字");
      } else if (selNorm.length >= 2 && selNorm.includes(titleNorm) && titleNorm.length >= 2) {
        score += 10;
        reasons.push("選取包含標題");
      }

      const expl = normalizeToken(rule.explanation || "");
      if (selNorm.length >= 2 && expl.includes(selNorm)) {
        score += 6;
        reasons.push("說明含選取字");
      }

      if (asNameMatch.owned && asNameMatch.rule?.id === rule.id) {
        score += 20;
        reasons.push("名稱比對命中");
      }

      for (const b of surfaceBoosts) {
        if (b.test(rule)) {
          score += b.score;
          reasons.push(b.reason);
        }
      }

      // 三格內容含表面
      if (rule.conjugation && selNorm.length >= 1) {
        const blob = normalizeToken(
          [rule.conjugation.ichidan, rule.conjugation.godan, rule.conjugation.sahen].join(" ")
        );
        if (blob && (blob.includes(selNorm) || selNorm.includes(blob))) {
          score += 8;
          reasons.push("三格指示相關");
        }
      }

      if (score > 0) {
        const uniq = [];
        const seen = new Set();
        for (const r of reasons) {
          if (!r || seen.has(r)) continue;
          seen.add(r);
          uniq.push(r);
        }
        scored.push({ rule, score, reasons: uniq.slice(0, 3) });
      }
    }

    scored.sort(
      (a, b) =>
        b.score - a.score || String(a.rule.title).localeCompare(String(b.rule.title), "zh-Hant")
    );

    const suggestions = scored.filter((s) => s.score >= minScore).slice(0, maxSuggest);
    const suggestIds = new Set(suggestions.map((s) => s.rule.id));
    const rest = all.filter((r) => !suggestIds.has(r.id));

    return { suggestions, rest };
  }

  return {
    CATEGORIES,
    SUPPLEMENTARY_CATEGORY,
    isSupplementaryUsage,
    CONJ_SLOTS,
    emptyConjugation,
    hasConjugationContent,
    init,
    setAll,
    getAll,
    getById,
    create,
    update,
    remove,
    search,
    searchByForm,
    searchSentence,
    tokenize,
    filterList,
    normalizeRule,
    findMatchingRule,
    locateApiItemInText,
    enrichInventoryWithAnalyzer,
    cleanSpanNeedle,
    isPatternRule,
    isConjugationRule,
    rankRulesForSpan,
  };
})();
