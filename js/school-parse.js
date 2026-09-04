/**
 * 學校文法切詞後處理：還原原文、算區間、高信心文法候選、轉成盤點 items／vocab。
 * 切分規則依公開的日本學校文法（教科書十大品詞），不依賴外部專案原始碼。
 */
const SchoolParse = (() => {
  const POS_CANON = {
    名詞: "名詞",
    代名詞: "代名詞",
    代詞: "代名詞",
    動詞: "動詞",
    形容詞: "形容詞",
    形容動詞: "形容動詞",
    副詞: "副詞",
    連體詞: "連體詞",
    連体詞: "連體詞",
    接續詞: "接續詞",
    接続詞: "接續詞",
    感動詞: "感動詞",
    助詞: "助詞",
    助動詞: "助動詞",
    記號: "記號",
    記号: "記號",
    標點: "記號",
    改行: "改行",
  };

  const CONTENT_POS = new Set([
    "名詞",
    "代名詞",
    "動詞",
    "形容詞",
    "形容動詞",
    "副詞",
    "連體詞",
  ]);

  const SKIP_HOVER_POS = new Set(["記號", "改行"]);

  const GROUP_CANON = {
    一段: "一段",
    五段: "五段",
    サ変: "サ変",
    サ變: "サ変",
    カ変: "カ変",
    カ變: "カ変",
    ichidan: "一段",
    godan: "五段",
    sahen: "サ変",
    kahen: "カ変",
  };

  function canonPos(raw) {
    const s = String(raw || "").trim();
    if (POS_CANON[s]) return POS_CANON[s];
    for (const [k, v] of Object.entries(POS_CANON)) {
      if (s.includes(k)) return v;
    }
    return s || "其他";
  }

  function canonGroup(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (GROUP_CANON[s]) return GROUP_CANON[s];
    if (/一段/.test(s)) return "一段";
    if (/五段/.test(s)) return "五段";
    if (/サ変|サ變|する/.test(s)) return "サ変";
    if (/カ変|カ變|来る|くる/.test(s)) return "カ変";
    return "";
  }

  function kanaToHira(s) {
    return String(s || "").replace(/[\u30A1-\u30F6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  function extractTokenList(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.tokens)) return parsed.tokens;
      if (Array.isArray(parsed.t)) return parsed.t;
    }
    return [];
  }

  function normalizeRawTokens(parsed) {
    return extractTokenList(parsed)
      .filter((t) => t != null)
      .map((t) => {
        const word =
          typeof t === "string"
            ? t
            : String(t.word ?? t.w ?? t.surface ?? t.text ?? "");
        const pos = canonPos(t.pos ?? t.p ?? "");
        let furigana = kanaToHira(
          String(t.furigana ?? t.reading ?? t.yomi ?? t.kana ?? "").replace(/\s+/g, "")
        );
        if (furigana && !/^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(furigana)) {
          furigana = furigana.replace(/[^\u3040-\u309F\u30A0-\u30FFー]/g, "");
        }
        const lemma = String(t.lemma ?? t.dictionaryForm ?? t.base ?? t.l ?? "").trim();
        const group = canonGroup(t.group ?? t.verbGroup ?? t.vtype ?? "");
        return { word, pos, furigana, lemma, group };
      })
      .filter((t) => t.word !== "");
  }

  function reconstructExact(source, tokens) {
    const joined = tokens.map((t) => t.word).join("");
    if (joined !== source) return null;
    let i = 0;
    return tokens.map((t) => {
      const start = i;
      i += t.word.length;
      return { ...t, start, end: i };
    });
  }

  /**
   * 模型偶發吃掉空白／換行時：去空白後字元仍對得上，就把原文空白插回。
   */
  function reconstructAlignWs(source, tokens) {
    const srcNoWs = source.replace(/\s/g, "");
    const tokNoWs = tokens.map((t) => String(t.word).replace(/\s/g, "")).join("");
    if (srcNoWs !== tokNoWs) return null;

    const out = [];
    let si = 0;
    const pushWs = () => {
      while (si < source.length && /\s/.test(source[si])) {
        const ch = source[si];
        out.push({
          word: ch,
          pos: ch === "\n" || ch === "\r" ? "改行" : "記號",
          furigana: "",
          lemma: "",
          group: "",
          start: si,
          end: si + 1,
        });
        si += 1;
      }
    };

    for (const t of tokens) {
      const nw = String(t.word).replace(/\s/g, "");
      if (!nw) continue;
      pushWs();
      const start = si;
      for (const ch of nw) {
        if (si < source.length && /\s/.test(source[si])) pushWs();
        if (!source.startsWith(ch, si)) return null;
        si += ch.length;
      }
      out.push({
        ...t,
        word: source.slice(start, si),
        start,
        end: si,
      });
    }
    pushWs();
    return si === source.length ? out : null;
  }

  function reconstruct(source, parsed) {
    const src = String(source ?? "");
    const raw = normalizeRawTokens(parsed);
    if (!raw.length) {
      throw new Error("切詞結果沒有有效詞塊");
    }
    const exact = reconstructExact(src, raw);
    if (exact) return exact;
    const aligned = reconstructAlignWs(src, raw);
    if (aligned) return aligned;
    throw new Error("切詞結果無法還原原文（請重試）");
  }

  function kotoPos(token) {
    const pos = token.pos;
    const g = token.group;
    if (pos === "動詞") {
      if (g === "一段") return "動詞・一段";
      if (g === "五段") return "動詞・五段";
      if (g === "サ変") return "動詞・サ変";
      if (g === "カ変") return "動詞・カ変";
      return "動詞";
    }
    if (pos === "形容詞") return "形容詞・い";
    if (pos === "形容動詞") return "形容詞・な";
    if (pos === "代名詞") return "代詞";
    if (pos === "連體詞" || pos === "接續詞" || pos === "感動詞") return "其他";
    return pos || "其他";
  }

  function tokensToVocab(tokens) {
    const out = [];
    const seen = new Set();
    for (const t of tokens || []) {
      if (!CONTENT_POS.has(t.pos)) continue;
      const surface = t.word;
      if (!surface || /^\s+$/.test(surface)) continue;
      const key = `${surface}:${t.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lemma = String(t.lemma || "").trim();
      const needsLemma = /動詞|形容/.test(t.pos);
      out.push({
        surface,
        reading: t.furigana || "",
        lemma: needsLemma ? lemma : lemma && lemma !== surface ? lemma : "",
        origin: "",
        gloss: "",
        pos: kotoPos(t),
        start: t.start,
        end: t.end,
      });
    }
    return out;
  }

  function splitRuleName(name) {
    const s = String(name || "").trim();
    const m = s.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/);
    if (m) {
      const zh = m[1].trim();
      const ja = m[2].trim();
      return { name: `${zh}（${ja}）`, nameZh: zh, nameJa: ja };
    }
    return { name: s, nameZh: s, nameJa: "" };
  }

  function guessCategory(name, posHint) {
    const n = String(name || "");
    if (/一段|五段|サ変|カ変/.test(n)) return "動詞類型";
    if (/ている/.test(n)) return "助動詞";
    if (/てもいい|てください/.test(n)) return "句型";
    if (
      /主題|對比|主格|對象|場所|手段|同伴|並列|引用|起點|終點|所屬|方向|追加|著點/.test(n) ||
      (/[はがをにでとへもの]/.test(n) && /助詞|（は|（が|（を|（に|（で|（と/.test(n))
    ) {
      return "助詞";
    }
    if (/ます|て形|ない|た形|ば形|たい|過去|丁寧|否定|假定|意向|音便/.test(n)) {
      return "活用";
    }
    if (posHint === "助詞") return "助詞";
    if (posHint === "助動詞") return "助動詞";
    if (posHint === "動詞") return "動詞類型";
    return "其他";
  }

  function isTeDe(t) {
    return (
      t &&
      (t.word === "て" || t.word === "で") &&
      (t.pos === "助詞" || t.pos === "助動詞")
    );
  }

  function isIruAux(t) {
    if (!t) return false;
    const w = t.word || "";
    const lemma = t.lemma || "";
    return (
      (t.pos === "動詞" || t.pos === "助動詞") &&
      (lemma === "いる" ||
        /^(いる|います|いない|いた|いて|いてる|てる|でる)$/.test(w))
    );
  }

  /** 補助動詞 しまう（てしまう／ちゃう／じゃう 的活用形） */
  function isShimauAux(t) {
    if (!t) return false;
    const lemma = String(t.lemma || "");
    const w = String(t.word || "");
    if (lemma === "しまう") return true;
    if (/^(しま[うわいえおっ]|しまっ|しまい|しまえ|しまおう)/.test(w)) return true;
    if (/^(ちゃう|ちゃっ|ちゃい|ちゃえ|ちゃお|じゃう|じゃっ|じゃい|じゃえ|じゃお)/.test(w)) {
      return true;
    }
    return false;
  }

  function isChauForm(t) {
    if (!t) return false;
    const w = String(t.word || "");
    return /^(ちゃ|じゃ)/.test(w);
  }

  function extendConjTail(tokens, from) {
    let to = from;
    let j = from + 1;
    const list = tokens || [];
    while (j < list.length) {
      const n = list[j];
      const w = String(n?.word || "");
      if (
        (n.pos === "助動詞" && /^(た|だ|ます|まし|ませ|ん|ない|なかっ|う|よう)$/.test(w)) ||
        /^(た|だ|ます|ました|ません|ませんでした)$/.test(w)
      ) {
        to = j;
        j += 1;
        continue;
      }
      break;
    }
    return to;
  }

  function localTeShimauTitle() {
    if (typeof RulesService !== "undefined" && typeof RulesService.getAll === "function") {
      const hit = RulesService.getAll().find((r) => {
        const t = String(r?.title || "");
        return /てしまう|でしまう|ちゃう/.test(t) || (/遺憾/.test(t) && /しまう/.test(t));
      });
      if (hit?.title) return hit.title;
    }
    return "遺憾（てしまう）";
  }

  function prevNonWs(tokens, i) {
    for (let k = i - 1; k >= 0; k--) {
      if (tokens[k].pos === "改行" || /^\s+$/.test(tokens[k].word)) continue;
      return tokens[k];
    }
    return null;
  }

  function nextNonWs(tokens, i) {
    const list = tokens || [];
    for (let k = i + 1; k < list.length; k++) {
      if (list[k].pos === "改行" || /^\s+$/.test(list[k].word)) continue;
      return { token: list[k], index: k };
    }
    return null;
  }

  function isNaruVerb(t) {
    if (!t || t.pos !== "動詞") return false;
    const lemma = String(t.lemma || "");
    const w = String(t.word || "");
    if (lemma === "なる" || lemma === "成る") return true;
    return /^(なる|なっ|なり|なれ|なろ)/.test(w);
  }

  function isSuruVerb(t) {
    if (!t || t.pos !== "動詞") return false;
    const lemma = String(t.lemma || "");
    const w = String(t.word || "");
    if (lemma === "する" || lemma === "為る") return true;
    return /^(する|し|すれ|しろ|せよ|さ[せれ])/.test(w) && lemma !== "しまう";
  }

  const TESHIMAU_SURFACES = [
    "てしまいました",
    "でしまいました",
    "てしまいます",
    "でしまいます",
    "てしまった",
    "でしまった",
    "てしまって",
    "でしまって",
    "てしまう",
    "でしまう",
    "ちゃいました",
    "じゃいました",
    "ちゃった",
    "じゃった",
    "ちゃう",
    "じゃう",
    "てしまっ",
    "でしまっ",
    "ちゃっ",
    "じゃっ",
  ];

  const ONBIN_SURFACES = [
    "っている",
    "んでいる",
    "している",
    "いでいる",
    "いている",
    "ってる",
    "んでる",
    "してる",
    "いでる",
    "いてる",
    "って",
    "った",
    "いで",
    "いだ",
    "いて",
    "いた",
    "んで",
    "んだ",
    "して",
    "した",
  ];

  /** むいてる／なっている → 先剝 ている 再看音便 */
  function peelTeiruSuffix(surface) {
    return String(surface || "")
      .replace(/てい(?:ました|ます|た|て|る)$/, "て")
      .replace(/でい(?:ました|ます|た|て|る)$/, "で")
      .replace(/て(?:ました|ます|た|る)$/, "て")
      .replace(/で(?:ました|ます|た|る)$/, "で");
  }

  function classifyGodanOnbin(surface) {
    const s = peelTeiruSuffix(surface);
    if (/(?:って|った)$/.test(s)) return { kind: "促音便", note: "促音便（う・つ・る → って／った）" };
    if (/(?:いで|いだ)$/.test(s)) return { kind: "い音便", note: "い音便（ぐ → いで／いだ）" };
    if (/(?:いて|いた)$/.test(s)) return { kind: "い音便", note: "い音便（く → いて／いた）" };
    if (/(?:んで|んだ)$/.test(s)) return { kind: "撥音便", note: "撥音便（ぬ・ぶ・む → んで／んだ）" };
    if (/(?:して|した)$/.test(s)) return { kind: "して", note: "す行て／た（して／した）" };
    return null;
  }

  function isOnbinTeTail(t) {
    if (!t) return false;
    const w = String(t.word || "");
    if (isTeDe(t) || /^(た|だ)$/.test(w)) return true;
    if (t.pos === "助動詞" && /^(た|だ)$/.test(w)) return true;
    if (isIruAux(t)) return true;
    return /^(てる|でる|ている|でいる|てます|でます)$/.test(w);
  }

  /** 五段て／た形音便：なって・むいてる・読んで。一段「食べて」不列。 */
  function detectGodanOnbin(tokens, i) {
    const t = tokens[i];
    if (!t || t.pos !== "動詞") return null;
    const lemma = String(t.lemma || t.word || "");
    if (lemma === "する" || lemma === "来る" || lemma === "くる") return null;
    if (isIruAux(t) && String(t.word || "").length <= 3) return null;

    let to = i;
    let surface = String(t.word || "");
    let j = i + 1;
    while (j < tokens.length && isOnbinTeTail(tokens[j])) {
      surface += tokens[j].word;
      to = j;
      j += 1;
    }
    const hit = classifyGodanOnbin(surface);
    if (!hit) return null;
    if (hit.kind === "して" && !/[すス]$/.test(lemma)) return null;
    return { from: i, to, ...hit };
  }

  function localOnbinTitle(kind) {
    const fallback = {
      い音便: "い音便（い）",
      促音便: "促音便（っ）",
      撥音便: "撥音便（ん）",
    };
    const preferRe =
      kind === "い音便"
        ? /い音便/
        : kind === "促音便"
          ? /促音便/
          : kind === "撥音便"
            ? /撥音便|ん音便/
            : null;
    if (preferRe && typeof RulesService !== "undefined" && typeof RulesService.getAll === "function") {
      const hit = RulesService.getAll().find((r) => preferRe.test(String(r?.title || "")));
      if (hit?.title) return hit.title;
    }
    return fallback[kind] || "";
  }

  function isOnbinGrammarName(name) {
    return /音便/.test(String(name || ""));
  }

  function isGenericOnbinName(name) {
    const n = String(name || "");
    if (/い音便|促音便|撥音便|ん音便/.test(n)) return false;
    return /音便（?\s*て/.test(n) || /^音便$/.test(n.trim());
  }

  function isSpecificOnbinName(name) {
    return /い音便|促音便|撥音便|ん音便/.test(String(name || ""));
  }

  function deterministicFunctions(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    const used = new Set();
    const out = [];

    function mark(from, to) {
      for (let i = from; i <= to; i++) used.add(i);
    }

    function push(name, from, to, opts = {}) {
      if (from < 0 || to >= list.length || from > to) return;
      out.push({
        name,
        tokenFrom: from,
        tokenTo: to,
        note: opts.note || "",
        confidence: opts.confidence || "high",
        needsDisambiguation: Boolean(opts.needsDisambiguation),
        category: opts.category || "",
      });
    }

    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      const t = list[i];
      const n1 = list[i + 1];
      const n2 = list[i + 2];

      if (isTeDe(t) && n1 && n1.word === "も" && n1.pos === "助詞" && n2 && /^(いい|よい|良い|よろしい)/.test(n2.word)) {
        push("許可（てもいい）", i, i + 2, { category: "句型" });
        mark(i, i + 2);
        continue;
      }
      if (isTeDe(t) && isIruAux(n1)) {
        push("進行（ている）", i, i + 1, { category: "助動詞" });
        mark(i, i + 1);
        continue;
      }
      if (
        t.pos === "動詞" &&
        t.word.length > 2 &&
        /(?:て|で)(?:い)?(?:る|ます|た)$/.test(t.word)
      ) {
        push("進行（ている）", i, i, { category: "助動詞" });
      }
      if (isTeDe(t) && n1 && isShimauAux(n1)) {
        const to = extendConjTail(list, i + 1);
        push(localTeShimauTitle(), i, to, {
          category: "助動詞",
          note: "て＋しまう（活用後仍算てしまう）",
        });
      }
      if (isChauForm(t)) {
        const to = extendConjTail(list, i);
        push(localTeShimauTitle(), i, to, {
          category: "助動詞",
          note: "ちゃう／じゃう＝てしまう",
        });
      }
      if (isTeDe(t) && n1 && /^ください/.test(n1.word)) {
        push("請求（て）", i, i + 1, { category: "句型", confidence: "high" });
        mark(i, i + 1);
        continue;
      }
    }

    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      const t = list[i];
      const prev = prevNonWs(list, i);

      if (t.pos === "助動詞" && /^(ます|ません|ました|ませんでした)$/.test(t.word)) {
        push("丁寧（ます）", i, i, { category: "活用" });
        mark(i, i);
        continue;
      }
      if (t.pos === "助動詞" && (t.word === "た" || t.word === "だ") && prev && prev.pos === "動詞") {
        push("過去（た）", i, i, { category: "活用" });
        mark(i, i);
        continue;
      }
      if (
        t.pos === "助動詞" &&
        /^(ない|なかった|ぬ)$/.test(t.word) &&
        prev &&
        (prev.pos === "動詞" || prev.pos === "助動詞")
      ) {
        push("否定（ない）", i, i, { category: "活用" });
        mark(i, i);
        continue;
      }
      if (t.pos === "助動詞" && /(ば)$/.test(t.word) && t.word.length <= 3) {
        push("假定（ば）", i, i, { category: "活用" });
        mark(i, i);
        continue;
      }
      if (isTeDe(t) && prev && prev.pos === "動詞") {
        push("て形（て）", i, i, {
          category: "活用",
          confidence: "medium",
          needsDisambiguation: true,
          note: "て：連接／請求／理由待消歧",
        });
        continue;
      }
      if (t.pos === "形容詞" && t.word.length > 1 && /く$/.test(t.word) && !/なく$/.test(t.word)) {
        push("連用修飾（く）", i, i, { category: "形容詞", confidence: "high" });
      }
      if (t.pos === "助詞") {
        const w = t.word;
        if (w === "は") {
          push("主題（は）", i, i, {
            category: "助詞",
            confidence: "medium",
            needsDisambiguation: true,
            note: "は：主題／對比待消歧",
          });
        } else if (w === "が") {
          push("主格（が）", i, i, {
            category: "助詞",
            confidence: "medium",
            needsDisambiguation: true,
            note: "が：主格／對象待消歧",
          });
        } else if (w === "を") {
          push("對象（を）", i, i, { category: "助詞" });
        } else if (w === "に") {
          const nx = nextNonWs(list, i);
          if (nx && isNaruVerb(nx.token)) {
            const name =
              localTitleByMarker("に", /變化|変化|結果|變成|なる/) || "變化（に）";
            push(name, i, i, {
              category: "助詞",
              confidence: "high",
              note: "に＋なる：變化／結果",
            });
          } else if (nx && isSuruVerb(nx.token)) {
            const name =
              localTitleByMarker("に", /變化|変化|結果|變成|する/) || "變化（に）";
            push(name, i, i, {
              category: "助詞",
              confidence: "high",
              note: "に＋する：變化／結果",
            });
          } else {
            push("著點（に）", i, i, {
              category: "助詞",
              confidence: "medium",
              needsDisambiguation: true,
              note: "に：時間／場所／對象／變化待消歧",
            });
          }
        } else if (w === "で") {
          push("手段（で）", i, i, {
            category: "助詞",
            confidence: "medium",
            needsDisambiguation: true,
            note: "で：場所／手段／原因待消歧",
          });
        } else if (w === "と") {
          push("同伴（と）", i, i, {
            category: "助詞",
            confidence: "medium",
            needsDisambiguation: true,
            note: "と：同伴／並列／引用待消歧",
          });
        } else if (w === "へ") {
          push("方向（へ）", i, i, { category: "助詞", confidence: "medium" });
        } else if (w === "も") {
          push("追加（も）", i, i, { category: "助詞", confidence: "medium" });
        } else if (w === "の") {
          push("所屬（の）", i, i, {
            category: "助詞",
            confidence: "medium",
            needsDisambiguation: true,
          });
        }
      }
    }

    const verbSeen = new Set();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.pos !== "動詞") continue;
      if (isIruAux(t) && i > 0 && isTeDe(list[i - 1])) continue;
      if (isShimauAux(t) && i > 0 && isTeDe(list[i - 1])) continue;
      if (isChauForm(t)) continue;
      const lemma = t.lemma || t.word;
      const g = t.group;

      const onbin = g === "一段" || g === "サ変" || g === "カ変" ? null : detectGodanOnbin(list, i);
      if (onbin) {
        const name = localOnbinTitle(onbin.kind);
        if (name) {
          push(name, onbin.from, onbin.to, {
            category: "活用",
            confidence: "high",
            note: onbin.note,
          });
        }
      }

      if (!g) continue;
      const key = `${g}:${lemma}`;
      if (verbSeen.has(key)) continue;
      verbSeen.add(key);
      if (g === "一段") push("辨認一段（一段動詞）", i, i, { category: "動詞類型" });
      else if (g === "五段") push("辨認五段（五段動詞）", i, i, { category: "動詞類型" });
      else if (g === "サ変") push("サ変（する）", i, i, { category: "動詞類型" });
      else if (g === "カ変") push("カ変（来る）", i, i, { category: "動詞類型" });

      if ((lemma === "行く" || lemma === "いく" || t.word === "行っ") && i + 1 < list.length) {
        const nx = list[i + 1];
        if (isTeDe(nx) || nx.word === "た" || nx.word === "った") {
          push("例外（行くて）", i, i + 1, { category: "活用" });
        }
      }
    }

    return out;
  }

  function compactTokenLines(tokens) {
    return (tokens || [])
      .map((t, i) => {
        const bits = [`${i}`, t.word.replace(/\n/g, "\\n"), t.pos];
        if (t.lemma && t.lemma !== t.word) bits.push(`原=${t.lemma}`);
        if (t.group) bits.push(t.group);
        if (t.furigana) bits.push(`讀=${t.furigana}`);
        return bits.join(" ");
      })
      .join("\n");
  }

  function compactCandidateLines(cands) {
    return (cands || [])
      .map((c) => {
        const flag = c.needsDisambiguation ? "消歧" : "高信心";
        return `${c.tokenFrom}-${c.tokenTo} ${c.name} [${flag}]${c.note ? " " + c.note : ""}`;
      })
      .join("\n");
  }

  function rangeOverlaps(aFrom, aTo, bFrom, bTo) {
    return !(aTo < bFrom || aFrom > bTo);
  }

  function isHostLexemeGrammar(name, category) {
    const n = String(name || "");
    const c = String(category || "");
    return c === "動詞類型" || /一段動詞|五段動詞|サ変|カ変|辨認一段|辨認五段/.test(n);
  }

  function verbGroupOfName(name, category) {
    const n = String(name || "");
    const c = String(category || "");
    if (c !== "動詞類型" && !/一段|五段|サ変|カ変|辨認/.test(n)) return "";
    if (/ます|て形|た形|ない|ている|音便/.test(n) && !/辨認/.test(n)) return "";
    if (/五段/.test(n)) return "五段";
    if (/一段/.test(n)) return "一段";
    if (/サ[変變]/.test(n)) return "サ変";
    if (/カ[変變]/.test(n)) return "カ変";
    return "";
  }

  function localTitleForVerbGroup(group) {
    const fallback = {
      一段: "辨認一段（一段動詞）",
      五段: "辨認五段（五段動詞）",
      サ変: "サ変（する）",
      カ変: "カ変（来る）",
    };
    if (!group) return "";
    if (typeof RulesService !== "undefined" && typeof RulesService.getAll === "function") {
      const re =
        group === "一段"
          ? /辨認一段|一段動詞/
          : group === "五段"
            ? /辨認五段|五段動詞/
            : group === "サ変"
              ? /サ[変變]/
              : /カ[変變]/;
      const hit = RulesService.getAll().find((r) => {
        const t = String(r?.title || "");
        const c = String(r?.category || "");
        if (c && c !== "動詞類型" && !/辨認/.test(t)) return false;
        if (/ます|て形|た形|ない|ている|音便/.test(t)) return false;
        return re.test(t);
      });
      if (hit?.title) return hit.title;
    }
    return fallback[group] || "";
  }

  function localTitleByMarker(marker, preferRe) {
    const m = String(marker || "").trim();
    if (!m || typeof RulesService === "undefined" || typeof RulesService.getAll !== "function") {
      return "";
    }
    const hits = [];
    for (const r of RulesService.getAll()) {
      const parts = splitRuleName(r.title || "");
      const bits = String(parts.nameJa || "")
        .split(/[／\/、,＋+]/)
        .map((s) => s.trim().replace(/^〜|^～/, ""));
      if (bits.includes(m)) hits.push(r);
    }
    if (!hits.length) return "";
    if (preferRe) {
      const pref = hits.find((r) => preferRe.test(`${r.title}\n${r.explanation || ""}`));
      if (pref?.title) return pref.title;
    }
    return "";
  }

  /** 標題括號內的日文標記（は／が → は, が） */
  function markerNeedles(nameJa, name) {
    const names = splitRuleName(name || "");
    const raw = String(nameJa || names.nameJa || "").trim();
    return raw
      .split(/[／\/、,＋+]/)
      .map((s) => s.trim().replace(/^〜|^～/, ""))
      .filter(Boolean)
      .filter((p) => !/^(一段動詞|五段動詞|サ変動詞|カ変動詞|一段|五段)$/.test(p))
      .sort((a, b) => b.length - a.length);
  }

  /** 句中片段是否真的帶有規則日文標記（に／く／だけ…） */
  function spanHasNeedles(span, needles) {
    const s = String(span || "");
    if (!needles.length) return true;
    if (!s) return false;
    for (const n of needles) {
      if (!n) continue;
      if (s === n || s.includes(n)) return true;
      if (n === "て" && (s.includes("で") || /(?:って|んで|いて|いで|して)$/.test(s))) return true;
      if (n === "で" && (s.includes("て") || /(?:んで|いで)$/.test(s))) return true;
      if ((n === "ている" || n === "てる") && /(?:て[い]?る|で[い]?る)/.test(s)) return true;
      if (
        (n === "てしまう" || n === "でしまう" || n === "ちゃう") &&
        /てしま|でしま|ちゃう|ちゃっ|ちゃい|じゃう|じゃっ|じゃい/.test(s)
      ) {
        return true;
      }
      if (n === "た" && /(?:った|んだ|いた|いだ|した)$/.test(s)) return true;
      if (n === "ます" && /(?:ます|ません|ました|ませんでした)$/.test(s)) return true;
    }
    return false;
  }

  /**
   * 著色只落在文法標記（に／く／ている），不包前面的實詞。
   * いびつに＋副詞化（に）→ 只標 に；赤く＋連用修飾（く）→ 只標 く。
   * 動詞類型（辨認一段）仍標整個動詞。
   */
  function narrowOffsets(src, start, end, needles, tokens, from, to) {
    const text = String(src || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    if (!needles.length) return null;
    const slice = text.slice(start, end);

    if (tokens && tokens.length && Number.isFinite(from) && Number.isFinite(to)) {
      const lo = Math.max(0, Math.min(from, to));
      const hi = Math.min(tokens.length - 1, Math.max(from, to));
      for (const needle of needles) {
        for (let i = hi; i >= lo; i--) {
          const w = String(tokens[i].word || "");
          if (w === needle && Number.isFinite(tokens[i].start) && Number.isFinite(tokens[i].end)) {
            return { start: tokens[i].start, end: tokens[i].end, tokenFrom: i, tokenTo: i, span: w };
          }
        }
      }
      for (const needle of needles) {
        if (!needle) continue;
        for (let i = hi; i >= lo; i--) {
          const w = String(tokens[i].word || "");
          if (w.length > needle.length && w.endsWith(needle) && Number.isFinite(tokens[i].end)) {
            const ns = tokens[i].end - needle.length;
            return { start: ns, end: tokens[i].end, tokenFrom: i, tokenTo: i, span: needle };
          }
        }
      }
    }

    for (const needle of needles) {
      if (!needle || slice.length <= needle.length) continue;
      if (slice.endsWith(needle)) {
        return { start: end - needle.length, end, span: needle };
      }
      const idx = slice.lastIndexOf(needle);
      if (idx >= 0) {
        return { start: start + idx, end: start + idx + needle.length, span: needle };
      }
    }
    return null;
  }

  /** 句中是普通體「た」時，不可沿用「ました」卡名 */
  function surfaceLooksPlainPast(s) {
    const t = String(s || "").trim();
    if (!t || /ました|ません/.test(t)) return false;
    return /(?:った|んだ|いた|いだ|した|た|だ)$/.test(t);
  }

  function reconcileNameToSurface(item) {
    if (!item) return item;
    const surface = String(item.span || "").trim();
    const blob = `${item.name || ""} ${item.nameJa || ""}`;
    if (/ました/.test(blob) && surfaceLooksPlainPast(surface)) {
      const names = splitRuleName("過去（た）");
      return { ...item, ...names, nameJa: "た", category: item.category || "活用" };
    }
    if (/ません/.test(blob) && /^(ない|なかった|ぬ)$/.test(surface)) {
      const names = splitRuleName("否定（ない）");
      return { ...item, ...names, nameJa: "ない", category: item.category || "活用" };
    }
    return item;
  }

  function narrowItemToMarker(src, item, tokens) {
    if (!item) return item;
    item = reconcileNameToSurface(item);
    if (isHostLexemeGrammar(item.name, item.category)) return item;
    const start = Number(item.start);
    const end = Number(item.end);
    const from = Number(item.tokenFrom);
    const to = Number(item.tokenTo);
    if (isOnbinGrammarName(item.name)) {
      const hit = narrowOffsets(src, start, end, ONBIN_SURFACES, tokens, from, to);
      if (hit) {
        return {
          ...item,
          start: hit.start,
          end: hit.end,
          span: hit.span || src.slice(hit.start, hit.end),
          tokenFrom: Number.isFinite(hit.tokenFrom) ? hit.tokenFrom : item.tokenFrom,
          tokenTo: Number.isFinite(hit.tokenTo) ? hit.tokenTo : item.tokenTo,
        };
      }
    }
    if (/てしまう|でしまう|ちゃう|遺憾/.test(String(item.name || ""))) {
      const hit = narrowOffsets(src, start, end, TESHIMAU_SURFACES, tokens, from, to);
      if (hit) {
        return {
          ...item,
          start: hit.start,
          end: hit.end,
          span: hit.span || src.slice(hit.start, hit.end),
          tokenFrom: Number.isFinite(hit.tokenFrom) ? hit.tokenFrom : item.tokenFrom,
          tokenTo: Number.isFinite(hit.tokenTo) ? hit.tokenTo : item.tokenTo,
        };
      }
    }
    const needles = markerNeedles(item.nameJa, item.name);
    if (!needles.length) return item;
    const hit = narrowOffsets(src, start, end, needles, tokens, from, to);
    if (!hit) return item;
    if (hit.start === start && hit.end === end) return item;
    return {
      ...item,
      start: hit.start,
      end: hit.end,
      span: hit.span || src.slice(hit.start, hit.end),
      tokenFrom: Number.isFinite(hit.tokenFrom) ? hit.tokenFrom : item.tokenFrom,
      tokenTo: Number.isFinite(hit.tokenTo) ? hit.tokenTo : item.tokenTo,
    };
  }

  function functionToItem(tokens, fn) {
    const n = tokens.length;
    let from = Number(fn.tokenFrom);
    let to = Number(fn.tokenTo);
    if (!Number.isFinite(from)) from = 0;
    if (!Number.isFinite(to)) to = from;
    from = Math.max(0, Math.min(n - 1, from));
    to = Math.max(0, Math.min(n - 1, to));
    if (to < from) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const slice = tokens.slice(from, to + 1);
    const span = slice.map((t) => t.word).join("");
    const start = slice[0].start;
    const end = slice[slice.length - 1].end;
    const names = splitRuleName(fn.name);
    if (!names.name) return null;
    const posHint = slice.find((t) => t.pos === "助詞" || t.pos === "助動詞" || t.pos === "動詞")?.pos;
    let category = fn.category || guessCategory(names.name, posHint);
    let display = names;
    const vg = verbGroupOfName(names.name, category);
    if (vg) {
      const local = localTitleForVerbGroup(vg);
      if (local && local !== names.name) {
        display = splitRuleName(local);
        category = "動詞類型";
      }
    }
    const item = {
      name: display.name,
      nameZh: display.nameZh,
      nameJa: display.nameJa,
      category,
      span,
      start,
      end,
      note: String(fn.note || "").trim(),
      confidence: ["high", "medium", "low"].includes(fn.confidence) ? fn.confidence : "medium",
      tokenFrom: from,
      tokenTo: to,
    };
    const src = tokens.length ? reconstructSrcFromTokens(tokens) : "";
    const narrowed = narrowItemToMarker(src, reconcileNameToSurface(item), tokens);
    if (!narrowed) return null;
    if (!isHostLexemeGrammar(narrowed.name, narrowed.category)) {
      const needles = markerNeedles(narrowed.nameJa, narrowed.name);
      const surface =
        String(narrowed.span || "").trim() ||
        (Number.isFinite(narrowed.start) && Number.isFinite(narrowed.end)
          ? src.slice(narrowed.start, narrowed.end)
          : span);
      if (needles.length && !spanHasNeedles(surface, needles)) return null;
    }
    return narrowed;
  }

  function reconstructSrcFromTokens(tokens) {
    return (tokens || []).map((t) => t.word).join("");
  }

  /**
   * AI 消歧結果為主；高信心程式候選在沒被同一區間覆蓋時補上。
   * @param {object[]} tokens
   * @param {object[]} aiFunctions
   * @param {object[]} candidates
   * @param {{ mappingFailed?: boolean }} [opts]
   */
  function functionsToItems(tokens, aiFunctions, candidates, opts = {}) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return [];
    const items = [];
    const ranges = [];

    function addFn(fn) {
      const item = functionToItem(list, fn);
      if (!item) return;
      const dup = items.some(
        (it) => it.name === item.name && it.start === item.start && it.end === item.end
      );
      if (dup) return;
      items.push(item);
      ranges.push({ from: item.tokenFrom, to: item.tokenTo, name: item.name });
    }

    const aiList = Array.isArray(aiFunctions) ? aiFunctions : [];
    for (const fn of aiList) addFn(fn);

    const mappingFailed = Boolean(opts.mappingFailed);

    function sameMarker(nameA, nameB) {
      const a = markerNeedles("", nameA);
      const b = markerNeedles("", nameB);
      if (!a.length || !b.length) return false;
      return a.some((x) => b.includes(x));
    }

    function tokenCoveredBySameMarker(cand) {
      return items.some((it) => {
        if (!sameMarker(it.name, cand.name)) return false;
        return rangeOverlaps(
          cand.tokenFrom,
          cand.tokenTo,
          Number(it.tokenFrom),
          Number(it.tokenTo)
        );
      });
    }

    const PARTICLE_MARKERS = new Set(["は", "が", "を", "に", "で", "と", "も", "へ", "の", "て"]);

    for (const c of candidates || []) {
      if (tokenCoveredBySameMarker(c) && !isOnbinGrammarName(c.name)) continue;
      const cg = verbGroupOfName(c.name, c.category);
      if (cg) {
        const sameGroup = items.some(
          (it) => verbGroupOfName(it.name, it.category) === cg
        );
        if (sameGroup) continue;
      }
      const cNeedles = markerNeedles("", c.name);
      const isParticleCand = cNeedles.some((n) => PARTICLE_MARKERS.has(n));
      if (isParticleCand) {
        addFn(c);
        continue;
      }
      const covered = ranges.some((r) =>
        rangeOverlaps(c.tokenFrom, c.tokenTo, r.from, r.to)
      );
      if (covered && !cg) continue;
      if (!mappingFailed && c.needsDisambiguation && !isParticleCand) continue;
      addFn(c);
    }

    items.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    return filterItemsMissingMarkers(reconstructSrcFromTokens(list), items);
  }

  /**
   * 丟掉「標題有日文標記、但句中片段沒有該標記」的文法項。
   * 例：連用修飾（く）套在 苦い、副詞化（に）套在 ほろりと。
   * 手動套用（manualRuleId）不丟。
   */
  function filterItemsMissingMarkers(src, items) {
    return (Array.isArray(items) ? items : []).filter((it) => {
      if (!it) return false;
      if (it.manualRuleId || it.source === "manual" || it.locatedManually) return true;
      if (isGenericOnbinName(it.name)) return false;
      if (isHostLexemeGrammar(it.name, it.category)) return true;
      const needles = markerNeedles(it.nameJa, it.name);
      if (!needles.length) return true;
      const start = Number(it.start);
      const end = Number(it.end);
      const slice =
        Number.isFinite(start) && Number.isFinite(end) && end > start
          ? String(src || "").slice(start, end)
          : "";
      const surface = String(it.span || "").trim();
      if (spanHasNeedles(slice, needles) || spanHasNeedles(surface, needles)) return true;
      if (!slice && !surface) return spanHasNeedles(src, needles);
      return false;
    });
  }

  function parseMappedFunctions(parsed) {
    const raw = Array.isArray(parsed?.functions)
      ? parsed.functions
      : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed)
          ? parsed
          : [];
    const functions = raw
      .map((fn) => {
        const name = String(fn?.name || fn?.n || "").trim();
        if (!name) return null;
        const tokenFrom = Number(fn.tokenFrom ?? fn.from ?? fn.a);
        const tokenTo = Number(fn.tokenTo ?? fn.to ?? fn.b ?? tokenFrom);
        if (!Number.isFinite(tokenFrom)) return null;
        let confidence = String(fn.confidence || fn.f || "medium").toLowerCase();
        if (!["high", "medium", "low"].includes(confidence)) confidence = "medium";
        return {
          name,
          tokenFrom,
          tokenTo: Number.isFinite(tokenTo) ? tokenTo : tokenFrom,
          note: String(fn.note || "").trim(),
          confidence,
          category: String(fn.category || "").trim(),
        };
      })
      .filter(Boolean);
    return {
      functions,
      translation: String(parsed?.translation || parsed?.t || "").trim(),
      summary: String(parsed?.summary || parsed?.u || "").trim(),
    };
  }

  function pickVocabForToken(vocab, t) {
    let best = null;
    let bestScore = -1;
    for (const w of vocab) {
      if (!w) continue;
      const surf = String(w.surface || "");
      const lem = String(w.lemma || "");
      const surfMatch = surf === t.word;
      const lemMatch = Boolean(lem && (lem === t.word || lem === t.lemma));
      if (!surfMatch && !lemMatch) continue;
      const ws = Number(w.start);
      const we = Number(w.end);
      const startClose = !Number.isFinite(ws) || Math.abs(ws - t.start) <= 1;
      const overlaps =
        Number.isFinite(ws) &&
        Number.isFinite(we) &&
        !(we <= t.start || ws >= t.end) &&
        we - ws <= t.end - t.start + 1;
      let score = 0;
      if (surfMatch && startClose) score = 4;
      else if (overlaps) score = 3;
      else if (surfMatch) score = 2;
      else if (lemMatch) score = 1;
      if (String(w.gloss || "").trim()) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    return best;
  }

  function hoverLocs(tokens, vocabList) {
    const vocab = Array.isArray(vocabList) ? vocabList : [];
    const out = [];
    for (const t of tokens || []) {
      if (SKIP_HOVER_POS.has(t.pos)) continue;
      if (t.word == null || t.word === "") continue;
      if (!Number.isFinite(t.start) || !Number.isFinite(t.end) || t.end <= t.start) continue;
      if (/^\s+$/.test(t.word) && t.pos !== "改行") continue;
      const hit = pickVocabForToken(vocab, t);
      const lemma = (hit && hit.lemma) || t.lemma || "";
      out.push({
        start: t.start,
        end: t.end,
        surface: t.word,
        reading: (hit && hit.reading) || t.furigana || "",
        lemma,
        origin: (hit && hit.origin) || "",
        gloss: (hit && hit.gloss) || "",
        pos: (hit && hit.pos) || kotoPos(t),
      });
    }
    return out;
  }

  function slimTokens(tokens) {
    return (Array.isArray(tokens) ? tokens : []).slice(0, 200).map((t) => ({
      word: String(t.word ?? ""),
      pos: String(t.pos || ""),
      furigana: String(t.furigana || ""),
      lemma: String(t.lemma || ""),
      group: String(t.group || ""),
      start: Number.isFinite(t.start) ? t.start : null,
      end: Number.isFinite(t.end) ? t.end : null,
    }));
  }

  return {
    reconstruct,
    tokensToVocab,
    deterministicFunctions,
    functionsToItems,
    parseMappedFunctions,
    compactTokenLines,
    compactCandidateLines,
    hoverLocs,
    slimTokens,
    kotoPos,
    narrowItemToMarker,
    markerNeedles,
    spanHasNeedles,
    filterItemsMissingMarkers,
    reconcileNameToSurface,
  };
})();
