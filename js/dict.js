/**
 * 本地辭典
 * 1) 本機單字庫（查詢／手改累積）
 * 2) data/ja-zh-lite.json（常用繁中）
 * 3) kuromoji 讀音／原形／詞性（無詞義時）
 */
const DictService = (() => {
  const LITE_URL = "data/ja-zh-lite.json";

  const POS_CODE = {
    v1: "動詞・一段",
    v5: "動詞・五段",
    vs: "動詞・サ変",
    vk: "動詞・カ変",
    i: "形容詞・い",
    na: "形容詞・な",
    n: "名詞",
    adv: "副詞",
    pn: "代詞",
    num: "數詞",
    prt: "助詞",
    conj: "接続詞",
    exp: "慣用",
    int: "感嘆",
    pref: "接頭辞",
    suf: "接尾辞",
    aux: "助動詞",
    "aux-v": "助動詞",
    cop: "指定",
    unc: "其他",
    other: "其他",
    "adj-no": "名詞",
    "adj-pn": "連體詞",
  };

  const PARTICLE_SURFACES = new Set([
    "は", "が", "を", "に", "で", "と", "も", "へ", "の",
    "から", "まで", "より", "や", "か", "ね", "よ", "さ",
    "ばかり", "だけ", "しか", "ほど", "くらい", "ぐらい",
    "など", "なり", "やら", "こそ", "でも", "しか",
  ]);

  let lite = null; // Map key -> { reading, gloss, pos, origin }
  let litePromise = null;
  let liteMeta = { n: 0, status: "idle", error: "" };

  function kataToHira(s) {
    return String(s || "").replace(/[\u30A1-\u30F6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  function normKey(s) {
    return String(s || "")
      .trim()
      .normalize("NFC")
      .replace(/\s+/g, "");
  }

  function decodePos(code, fallback) {
    const raw = String(code || "").trim();
    if (POS_CODE[raw]) return POS_CODE[raw];
    const s = String(fallback || "").trim();
    if (POS_CODE[s]) return POS_CODE[s];
    if (/動詞・|形容詞・|名詞|副詞|助詞|助動詞|代詞|數詞|接続|感嘆|慣用/.test(s)) return s;
    if (/prt|助詞/.test(raw + s)) return "助詞";
    if (/conj|接続/.test(raw + s)) return "接続詞";
    return s || "";
  }

  function isConjTail(token) {
    const pos = String(token?.pos || "");
    const detail = String(token?.pos_detail || "");
    const t = String(token?.text || "");
    if (pos === "助動詞") return true;
    if (/非自立/.test(detail)) return true;
    if (
      (t === "て" || t === "で") &&
      (pos === "助詞" || pos === "助動詞" || /接続/.test(detail))
    ) {
      return true;
    }
    if (/^(ます|まし|ませ|ん|た|だ|ない|なかっ|たく|たい|う|よう|てる|でる|いる|いた)$/.test(t)) {
      return true;
    }
    return false;
  }

  function skipToken(token) {
    const pos = String(token?.pos || "");
    const detail = String(token?.pos_detail || "");
    if (/助詞|助動詞|接続詞|記号|空白|フィラー/.test(pos)) return true;
    if (/非自立/.test(detail) && /動詞|形容/.test(pos)) return true;
    const surf = String(token?.text || "").trim();
    if (!surf) return true;
    if (/^[、。．，！？!?「」『』（）()…・ー\s]+$/.test(surf)) return true;
    if (typeof Storage !== "undefined" && Storage.isEnglishVocabSkip && Storage.isEnglishVocabSkip(surf)) {
      return true;
    }
    return false;
  }

  function posFromKuromoji(token) {
    const pos = String(token?.pos || "");
    const typ = String(token?.conjugated_type || "");
    const detail = String(token?.pos_detail || "");
    if (/動詞/.test(pos)) {
      if (/一段/.test(typ) || /一段/.test(detail)) return "動詞・一段";
      if (/サ変|スル/.test(typ) || /サ変/.test(detail)) return "動詞・サ変";
      if (/カ変|クル/.test(typ) || /カ変/.test(detail)) return "動詞・カ変";
      if (/五段/.test(typ) || /五段/.test(detail)) return "動詞・五段";
      return "動詞・五段";
    }
    if (/形容動詞/.test(pos) || /形容動詞/.test(detail)) return "形容詞・な";
    if (/形容詞/.test(pos)) return "形容詞・い";
    if (/副詞/.test(pos)) return "副詞";
    if (/代名詞/.test(pos)) return "代詞";
    if (/数/.test(pos) || /数詞/.test(detail)) return "數詞";
    if (/名詞/.test(pos)) return "名詞";
    if (/助詞/.test(pos)) return "助詞";
    if (/助動詞/.test(pos)) return "助動詞";
    if (/接続詞/.test(pos)) return "接続詞";
    if (/感動詞/.test(pos)) return "感嘆";
    if (/連体詞/.test(pos)) return "連體詞";
    if (pos && pos !== "未知" && pos !== "記号") return pos;
    return "";
  }

  function inferPos(surface, pos, token) {
    const decoded = decodePos(pos, pos);
    if (decoded) return decoded;
    const kuro = posFromKuromoji(token);
    if (kuro) return kuro;
    const surf = String(surface || "").trim();
    if (PARTICLE_SURFACES.has(surf)) return "助詞";
    if (/^[\u4E00-\u9FFF]+$/.test(surf)) return "名詞";
    return "";
  }

  function needsLemma(pos) {
    return /動詞|形容詞/.test(String(pos || ""));
  }

  function addLiteEntry(map, key, reading, gloss, pos, origin) {
    const k = normKey(key);
    if (!k || map.has(k)) return;
    const decoded = decodePos(pos, pos);
    map.set(k, {
      reading: kataToHira(reading || ""),
      gloss: String(gloss || "").trim(),
      pos: decoded,
      lemma: /動詞|形容詞/.test(decoded) ? k : "",
      origin: String(origin || "").trim(),
    });
  }

  function ingestLite(raw) {
    const map = new Map();
    const src = raw && typeof raw === "object" ? raw.e || raw.entries || raw : {};
    if (Array.isArray(src)) {
      for (const row of src) {
        if (!row) continue;
        if (Array.isArray(row)) {
          addLiteEntry(map, row[0], row[1], row[2], row[3], row[4]);
        } else {
          addLiteEntry(map, row.w || row.k, row.r, row.g, row.p, row.o);
        }
      }
    } else {
      for (const [k, v] of Object.entries(src)) {
        if (Array.isArray(v)) addLiteEntry(map, k, v[0], v[1], v[2], v[3]);
        else if (v && typeof v === "object") addLiteEntry(map, k, v.r, v.g, v.p, v.o);
        else addLiteEntry(map, k, "", String(v || ""), "", "");
      }
    }
    lite = map;
    liteMeta = { n: map.size, status: "ready", error: "" };
    return map;
  }

  function loadLite() {
    if (lite) return Promise.resolve(lite);
    if (litePromise) return litePromise;
    liteMeta.status = "loading";
    litePromise = fetch(LITE_URL)
      .then((res) => {
        if (!res.ok) throw new Error("辭典檔載入失敗 " + res.status);
        return res.json();
      })
      .then((json) => ingestLite(json))
      .catch((err) => {
        console.warn("[DictService] lite dict", err);
        lite = new Map();
        liteMeta = { n: 0, status: "error", error: err?.message || String(err) };
        return lite;
      });
    return litePromise;
  }

  function lookupLite(surface, lemma) {
    if (!lite) return null;
    const lem = normKey(lemma);
    const surf = normKey(surface);
    if (lem && lite.has(lem)) {
      const e = lite.get(lem);
      return {
        key: lem,
        ...e,
        lemma: e.lemma || (/動詞|形容詞/.test(e.pos) ? lem : ""),
        source: "dict",
      };
    }
    if (surf && lite.has(surf)) {
      const e = lite.get(surf);
      return {
        key: surf,
        ...e,
        lemma: e.lemma || (/動詞|形容詞/.test(e.pos) ? surf : ""),
        source: "dict",
      };
    }
    return null;
  }

  function lookupBank(surface, lemma) {
    if (typeof Storage === "undefined" || typeof Storage.lookupVocabBank !== "function") {
      return null;
    }
    const hit =
      Storage.lookupVocabBank(surface) ||
      (lemma && lemma !== surface ? Storage.lookupVocabBank(lemma) : null);
    if (!hit || (!hit.gloss && !hit.reading && !hit.pos && !hit.origin)) return null;
    return {
      key: hit.surface || surface,
      reading: hit.reading || "",
      gloss: hit.gloss || "",
      pos: hit.pos || "",
      lemma: hit.lemma || "",
      origin: hit.origin || "",
      source: "bank",
    };
  }

  function lookupLocal(surface, lemma) {
    return lookupBank(surface, lemma) || lookupLite(surface, lemma);
  }

  function getDictStatus() {
    let bank = 0;
    try {
      if (typeof Storage !== "undefined" && Storage.listVocabBankEntries) {
        bank = (Storage.listVocabBankEntries("") || []).length;
      }
    } catch {
      bank = 0;
    }
    return {
      ...liteMeta,
      size: lite ? lite.size : liteMeta.n || 0,
      bank,
    };
  }

  function tokenize(query) {
    if (typeof JaTokenizer !== "undefined" && JaTokenizer.tokenize) {
      try {
        return JaTokenizer.tokenize(query) || [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function rowFromToken(token, hit) {
    const surface = String(token.text || "").trim();
    const lemmaRaw = String(token.basic_form || "").trim();
    const pos = inferPos(surface, (hit && hit.pos) || "", token);
    let lemma = String((hit && hit.lemma) || lemmaRaw || "").trim();
    if (!lemma || lemma === "*") lemma = surface;
    let reading = (hit && hit.reading) || kataToHira(token.reading || "");
    if (reading && reading === surface && !/[\u4E00-\u9FFF]/.test(surface)) {
      /* 純假名可省略 */
    }
    return {
      surface,
      reading,
      lemma,
      origin: (hit && hit.origin) || "",
      gloss: (hit && hit.gloss) || "",
      pos,
      start: Number.isFinite(token.start) ? token.start : null,
      end: Number.isFinite(token.end) ? token.end : null,
      source: hit ? hit.source || "dict" : "kuromoji",
    };
  }

  /**
   * 查一個詞（選字／單字編輯用）
   */
  async function lookupWord(surface, lemma) {
    await loadLite();
    const surf = String(surface || "").trim();
    if (!surf) return null;
    let token = null;
    const tokens = tokenize(surf);
    token = tokens.find((t) => t.isWord) || tokens[0] || null;
    const lem = lemma || token?.basic_form || surf;
    const localHit = lookupLocal(surf, lem);
    if (localHit) {
      const pos = localHit.pos || posFromKuromoji(token);
      let lemmaOut = String(localHit.lemma || lem || "").trim();
      if (lemmaOut === "*") lemmaOut = "";
      if (!needsLemma(pos) && (!lemmaOut || lemmaOut === surf)) lemmaOut = "";
      return {
        surface: surf,
        reading: localHit.reading || kataToHira(token?.reading || ""),
        lemma: lemmaOut,
        origin: localHit.origin || "",
        gloss: localHit.gloss,
        pos,
        source: localHit.source || "dict",
      };
    }
    if (token) {
      const row = rowFromToken(token, null);
      row.surface = surf;
      return row;
    }
    return null;
  }

  /**
   * 整句／單詞 → vocab 列（實詞；助詞略過）
   */
  async function inventory(query) {
    const q = String(query || "").trim();
    await loadLite();
    if (!q) return { vocab: [], missing: [], hit: 0, total: 0 };

    const words = tokenize(q).filter((t) => t.isWord);
    const seen = new Set();
    const vocab = [];
    let i = 0;
    while (i < words.length) {
      const t = words[i];
      const headPos = String(t.pos || "");
      if (skipToken(t) && !/動詞|形容詞/.test(headPos)) {
        i += 1;
        continue;
      }
      let end = i;
      if (/動詞|形容詞/.test(headPos)) {
        while (end + 1 < words.length && isConjTail(words[end + 1])) end += 1;
      }
      const chain = words.slice(i, end + 1);
      const surface = chain.map((x) => x.text).join("");
      const key = `${surface}@${t.start}`;
      if (seen.has(key)) {
        i = end + 1;
        continue;
      }
      seen.add(key);
      const fake = {
        ...t,
        text: surface,
        start: t.start,
        end: chain[chain.length - 1].end,
      };
      const hit =
        lookupLocal(t.basic_form || t.text, t.basic_form) ||
        lookupLocal(t.text, t.basic_form) ||
        lookupLocal(surface, t.basic_form);
      vocab.push(rowFromToken(fake, hit));
      i = end + 1;
    }

    const content = vocab.filter((w) => String(w.surface || "").length >= 1);
    const missing = content.filter((w) => !String(w.gloss || "").trim());
    const hit = content.length - missing.length;
    return {
      vocab: content,
      missing,
      hit,
      total: content.length,
      summary: content.length
        ? `辭典：${hit}/${content.length} 詞`
        : "辭典：無實詞",
    };
  }

  function vocabRowStart(w) {
    const n = Number(w?.start);
    return Number.isFinite(n) ? n : NaN;
  }

  /** 同一表面：座標接近優先；其中一方沒座標時才用表面對上（避免句中兩次「人」併成一筆） */
  function findVocabMergeIndex(list, w) {
    const surf = normKey(w?.surface);
    const lem = normKey(w?.lemma);
    const ws = vocabRowStart(w);
    let surfaceLoose = -1;
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      const xs = normKey(x?.surface);
      const xl = normKey(x?.lemma);
      const sameSurf = Boolean(surf && xs === surf);
      const sameLem = Boolean(lem && xl && lem === xl);
      if (!sameSurf && !sameLem) continue;
      const xsStart = vocabRowStart(x);
      if (Number.isFinite(ws) && Number.isFinite(xsStart)) {
        if (Math.abs(ws - xsStart) <= 1) return i;
        continue;
      }
      if (sameSurf && surfaceLoose < 0) surfaceLoose = i;
    }
    return surfaceLoose;
  }

  function mergeVocabRow(cur, w) {
    return {
      ...cur,
      ...w,
      surface: cur.surface || w.surface || "",
      reading: cur.reading || w.reading || "",
      lemma: cur.lemma || w.lemma || "",
      origin: cur.origin || w.origin || "",
      gloss: cur.gloss || w.gloss || "",
      pos: cur.pos || w.pos || "",
      start: Number.isFinite(vocabRowStart(cur)) ? cur.start : w.start,
      end: Number.isFinite(Number(cur.end)) ? cur.end : w.end,
    };
  }

  function mergeVocab(base, extra) {
    const out = Array.isArray(base) ? base.slice() : [];
    for (const w of extra || []) {
      if (!w || !(w.surface || w.lemma)) continue;
      const i = findVocabMergeIndex(out, w);
      if (i >= 0) out[i] = mergeVocabRow(out[i], w);
      else out.push(w);
    }
    return out;
  }

  /**
   * 依表面／原形補空欄（不重切詞）。
   * 學校切詞「どうして」對不上 kuromoji「どう＋して」時，仍能命中 lite／單字庫。
   */
  async function enrichVocab(vocab) {
    await loadLite();
    const list = Array.isArray(vocab) ? vocab : [];
    return list.map((w) => {
      if (!w) return w;
      const hasGloss = Boolean(String(w.gloss || "").trim());
      const hasReading = Boolean(String(w.reading || "").trim());
      const hasPos = Boolean(String(w.pos || "").trim());
      if (hasGloss && hasReading && hasPos) return w;
      const hit = lookupLocal(w.surface, w.lemma);
      if (!hit) return w;
      return mergeVocabRow(w, {
        reading: hit.reading,
        lemma: hit.lemma,
        origin: hit.origin,
        gloss: hit.gloss,
        pos: hit.pos,
        source: w.source || hit.source,
      });
    });
  }

  function init() {
    return loadLite();
  }

  return {
    init,
    loadLite,
    lookupWord,
    lookupLite,
    lookupLocal,
    getDictStatus,
    inventory,
    mergeVocab,
    enrichVocab,
    tokenize,
  };
})();
