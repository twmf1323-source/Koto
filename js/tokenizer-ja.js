/**
 * 日語分詞：優先 kuromoji.js，失敗則 Intl.Segmenter / 字元級後備
 */
const JaTokenizer = (() => {
  let tokenizer = null;
  let status = "idle"; // idle | loading | ready | error | fallback
  let lastError = "";
  let initPromise = null;

  function isReady() {
    return status === "ready" && tokenizer;
  }

  function getStatus() {
    return { status, lastError, engine: isReady() ? "kuromoji" : status === "fallback" ? "fallback" : status };
  }

  /**
   * 後備分詞：Intl.Segmenter word，否則粗切漢字／假名塊
   */
  function fallbackSegment(text) {
    const src = String(text || "");
    const tokens = [];
    if (!src) return tokens;

    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter("ja", { granularity: "word" });
        for (const { segment, index, isWordLike } of seg.segment(src)) {
          tokens.push({
            text: segment,
            start: index,
            end: index + segment.length,
            isWord: Boolean(isWordLike) && !/^[\s\p{P}\p{S}]+$/u.test(segment),
            basic_form: segment,
            pos: isWordLike ? "未知" : "記号",
            pos_detail: "",
            reading: "",
            conjugated_type: "",
            conjugated_form: "",
            source: "segmenter",
          });
        }
        return tokens;
      } catch {
        /* fall through */
      }
    }

    // 粗切：連續漢字／假名／英數 各成一塊
    const re = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFー]+|[A-Za-z0-9]+|[^\s]/gu;
    let m;
    let last = 0;
    const re2 = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFー]+|[A-Za-z0-9]+/g;
    while ((m = re2.exec(src)) !== null) {
      if (m.index > last) {
        tokens.push({
          text: src.slice(last, m.index),
          start: last,
          end: m.index,
          isWord: false,
          basic_form: "",
          pos: "記号",
          source: "regex",
        });
      }
      tokens.push({
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        isWord: true,
        basic_form: m[0],
        pos: "未知",
        source: "regex",
      });
      last = m.index + m[0].length;
    }
    if (last < src.length) {
      tokens.push({
        text: src.slice(last),
        start: last,
        end: src.length,
        isWord: false,
        basic_form: "",
        pos: "記号",
        source: "regex",
      });
    }
    return tokens;
  }

  function morphemeToTokens(text, path) {
    const src = String(text || "");
    const tokens = [];
    let cursor = 0;

    for (const m of path || []) {
      const surface = m.surface_form || "";
      if (!surface) continue;

      // 在原文中定位 surface（處理空白／全半形差異時以 cursor 起搜）
      let idx = src.indexOf(surface, cursor);
      if (idx < 0) {
        // 容錯：略過空白再找
        const compact = src.slice(cursor);
        const rel = compact.replace(/\s/g, "").indexOf(surface);
        if (rel >= 0) {
          // 無法精確還原位置時，用 cursor 推進
          idx = cursor;
        } else {
          idx = cursor;
        }
      }

      if (idx > cursor) {
        tokens.push({
          text: src.slice(cursor, idx),
          start: cursor,
          end: idx,
          isWord: false,
          basic_form: "",
          pos: "記号",
          source: "kuromoji-gap",
        });
      }

      const pos = m.pos || "未知";
      const isSymbol = pos === "記号" || pos === "空白";
      tokens.push({
        text: surface,
        start: idx,
        end: idx + surface.length,
        isWord: !isSymbol && surface.trim().length > 0,
        basic_form: m.basic_form && m.basic_form !== "*" ? m.basic_form : surface,
        pos,
        pos_detail: [m.pos_detail_1, m.pos_detail_2, m.pos_detail_3].filter((x) => x && x !== "*").join("·"),
        reading: m.reading && m.reading !== "*" ? m.reading : "",
        conjugated_type: m.conjugated_type && m.conjugated_type !== "*" ? m.conjugated_type : "",
        conjugated_form: m.conjugated_form && m.conjugated_form !== "*" ? m.conjugated_form : "",
        source: "kuromoji",
        raw: m,
      });
      cursor = idx + surface.length;
    }

    if (cursor < src.length) {
      tokens.push({
        text: src.slice(cursor),
        start: cursor,
        end: src.length,
        isWord: false,
        basic_form: "",
        pos: "記号",
        source: "kuromoji-tail",
      });
    }
    return tokens;
  }

  /**
   * 分詞（與 Lugus tokenize 相容：text/start/end/isWord + 日語欄位）
   */
  function tokenize(text) {
    const src = String(text || "");
    if (!src) return [];
    if (tokenizer) {
      try {
        const path = tokenizer.tokenize(src);
        return morphemeToTokens(src, path);
      } catch (err) {
        console.warn("[JaTokenizer] kuromoji tokenize failed, fallback", err);
        return fallbackSegment(src);
      }
    }
    return fallbackSegment(src);
  }

  /**
   * 產生比對用候選：surface、basic_form、相鄰 2～3-gram 表面串
   */
  function expandCandidates(tokens) {
    const words = (tokens || []).filter((t) => t.isWord);
    const out = [];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      out.push({
        text: w.text,
        start: w.start,
        end: w.end,
        form: w.text,
        basic_form: w.basic_form,
        role: "surface",
        token: w,
      });
      if (w.basic_form && w.basic_form !== w.text) {
        out.push({
          text: w.text,
          start: w.start,
          end: w.end,
          form: w.basic_form,
          basic_form: w.basic_form,
          role: "basic",
          token: w,
        });
      }
      // bigram
      if (i + 1 < words.length) {
        const a = words[i];
        const b = words[i + 1];
        // 僅當在原文中相鄰或只隔空白
        const between = String(arguments[0] ? "" : ""); // placeholder
        void between;
        const gapOk = b.start <= a.end + 2;
        if (gapOk) {
          const merged = a.text + b.text;
          out.push({
            text: merged,
            start: a.start,
            end: b.end,
            form: merged,
            basic_form: (a.basic_form || a.text) + (b.basic_form || b.text),
            role: "bigram",
            token: a,
          });
        }
      }
      // trigram（助動詞串：て + い + る）
      if (i + 2 < words.length) {
        const a = words[i];
        const b = words[i + 1];
        const c = words[i + 2];
        if (c.start <= a.end + 4) {
          const merged = a.text + b.text + c.text;
          out.push({
            text: merged,
            start: a.start,
            end: c.end,
            form: merged,
            basic_form: merged,
            role: "trigram",
            token: a,
          });
        }
      }
    }
    return out;
  }

  function resolveDicPath(dicPath) {
    if (dicPath) return dicPath.endsWith("/") ? dicPath : dicPath + "/";
    // 相對專案根目錄
    try {
      const base = document.baseURI || window.location.href;
      return new URL("dict/", base).href;
    } catch {
      return "dict/";
    }
  }

  function init(dicPath) {
    if (initPromise) return initPromise;
    if (tokenizer) {
      status = "ready";
      return Promise.resolve(tokenizer);
    }

    status = "loading";
    const path = resolveDicPath(dicPath);

    initPromise = new Promise((resolve) => {
      if (typeof kuromoji === "undefined") {
        status = "fallback";
        lastError = "kuromoji.js 未載入";
        console.warn("[JaTokenizer]", lastError);
        resolve(null);
        return;
      }

      try {
        kuromoji.builder({ dicPath: path }).build((err, t) => {
          if (err) {
            status = "fallback";
            lastError = err.message || String(err);
            console.warn("[JaTokenizer] dict load failed, using fallback:", lastError);
            tokenizer = null;
            resolve(null);
            return;
          }
          tokenizer = t;
          status = "ready";
          lastError = "";
          resolve(t);
        });
      } catch (err) {
        status = "fallback";
        lastError = err.message || String(err);
        console.warn("[JaTokenizer]", lastError);
        resolve(null);
      }
    });

    return initPromise;
  }

  return {
    init,
    tokenize,
    expandCandidates,
    fallbackSegment,
    isReady,
    getStatus,
  };
})();
