/**
 * 日語動詞／語素分析
 * 輸出：原形、動詞類型（一段／五段／サ変／カ変）、活用形、分項變化說明
 */
const Analyzer = (() => {
  const GROUP_LABELS = {
    一段: "一段動詞",
    五段: "五段動詞",
    サ変: "サ変動詞",
    カ変: "カ変動詞",
    未知: "未知",
  };

  /** 完整形式 → 固定分析（高信心） */
  const IRREGULARS = {
    する: { lemma: "する", group: "サ変", formName: "辞書形", formTags: [] },
    します: { lemma: "する", group: "サ変", formName: "ます形", formTags: ["丁寧"] },
    しません: { lemma: "する", group: "サ変", formName: "ます形", formTags: ["丁寧", "否定"] },
    しました: { lemma: "する", group: "サ変", formName: "ます形", formTags: ["丁寧", "過去"] },
    しませんでした: { lemma: "する", group: "サ変", formName: "ます形", formTags: ["丁寧", "否定", "過去"] },
    して: { lemma: "する", group: "サ変", formName: "て形", formTags: [] },
    した: { lemma: "する", group: "サ変", formName: "た形", formTags: ["過去"] },
    しない: { lemma: "する", group: "サ変", formName: "ない形", formTags: ["否定"] },
    すれば: { lemma: "する", group: "サ変", formName: "ば形", formTags: ["假定"] },
    しよう: { lemma: "する", group: "サ変", formName: "意向形", formTags: [] },
    できる: { lemma: "できる", group: "一段", formName: "辞書形", formTags: ["可能"], note: "可能動詞（與する體系相關）" },
    できます: { lemma: "できる", group: "一段", formName: "ます形", formTags: ["丁寧", "可能"] },

    来る: { lemma: "来る", group: "カ変", formName: "辞書形", formTags: [] },
    くる: { lemma: "来る", group: "カ変", formName: "辞書形", formTags: [] },
    来ます: { lemma: "来る", group: "カ変", formName: "ます形", formTags: ["丁寧"] },
    きます: { lemma: "来る", group: "カ変", formName: "ます形", formTags: ["丁寧"] },
    来ません: { lemma: "来る", group: "カ変", formName: "ます形", formTags: ["丁寧", "否定"] },
    来ました: { lemma: "来る", group: "カ変", formName: "ます形", formTags: ["丁寧", "過去"] },
    来て: { lemma: "来る", group: "カ変", formName: "て形", formTags: [] },
    きて: { lemma: "来る", group: "カ変", formName: "て形", formTags: [] },
    来た: { lemma: "来る", group: "カ変", formName: "た形", formTags: ["過去"] },
    きた: { lemma: "来る", group: "カ変", formName: "た形", formTags: ["過去"] },
    来ない: { lemma: "来る", group: "カ変", formName: "ない形", formTags: ["否定"] },
    こない: { lemma: "来る", group: "カ変", formName: "ない形", formTags: ["否定"] },
    来れば: { lemma: "来る", group: "カ変", formName: "ば形", formTags: ["假定"] },
    くれば: { lemma: "来る", group: "カ変", formName: "ば形", formTags: ["假定"] },
    来よう: { lemma: "来る", group: "カ変", formName: "意向形", formTags: [] },
    こよう: { lemma: "来る", group: "カ変", formName: "意向形", formTags: [] },

    行く: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "辞書形", formTags: [] },
    いきます: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ます形", formTags: ["丁寧"] },
    行きます: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ます形", formTags: ["丁寧"] },
    行きません: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ます形", formTags: ["丁寧", "否定"] },
    行きました: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ます形", formTags: ["丁寧", "過去"] },
    行って: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "て形", formTags: [], note: "例外音便（非「いいて」）" },
    いって: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "て形", formTags: [], note: "例外音便" },
    行った: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "た形", formTags: ["過去"], note: "例外音便" },
    いった: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "た形", formTags: ["過去"], note: "例外音便" },
    行かない: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ない形", formTags: ["否定"] },
    いかない: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ない形", formTags: ["否定"] },
    行けば: { lemma: "行く", group: "五段", groupDetail: "カ行", formName: "ば形", formTags: ["假定"] },

    ある: { lemma: "ある", group: "五段", groupDetail: "ラ行", formName: "辞書形", formTags: [] },
    あります: { lemma: "ある", group: "五段", groupDetail: "ラ行", formName: "ます形", formTags: ["丁寧"] },
    あって: { lemma: "ある", group: "五段", groupDetail: "ラ行", formName: "て形", formTags: [] },
    あった: { lemma: "ある", group: "五段", groupDetail: "ラ行", formName: "た形", formTags: ["過去"] },
    ない: { lemma: "ある", group: "五段", groupDetail: "ラ行", formName: "ない形", formTags: ["否定"], note: "例外：ある 的否定是「ない」" },

    いる: { lemma: "いる", group: "一段", formName: "辞書形", formTags: [] },
    います: { lemma: "いる", group: "一段", formName: "ます形", formTags: ["丁寧"] },
    いて: { lemma: "いる", group: "一段", formName: "て形", formTags: [] },
    いた: { lemma: "いる", group: "一段", formName: "た形", formTags: ["過去"] },
    いない: { lemma: "いる", group: "一段", formName: "ない形", formTags: ["否定"] },

    // 見る（一段）— 漢字「見」無法靠い段假名判斷，需固定表
    見る: { lemma: "見る", group: "一段", formName: "辞書形", formTags: [] },
    みる: { lemma: "見る", group: "一段", formName: "辞書形", formTags: [] },
    見ます: { lemma: "見る", group: "一段", formName: "ます形", formTags: ["丁寧"] },
    みます: { lemma: "見る", group: "一段", formName: "ます形", formTags: ["丁寧"] },
    見ません: { lemma: "見る", group: "一段", formName: "ます形", formTags: ["丁寧", "否定"] },
    見ました: { lemma: "見る", group: "一段", formName: "ます形", formTags: ["丁寧", "過去"] },
    見て: { lemma: "見る", group: "一段", formName: "て形", formTags: [] },
    みて: { lemma: "見る", group: "一段", formName: "て形", formTags: [] },
    見た: { lemma: "見る", group: "一段", formName: "た形", formTags: ["過去"] },
    みた: { lemma: "見る", group: "一段", formName: "た形", formTags: ["過去"] },
    見ない: { lemma: "見る", group: "一段", formName: "ない形", formTags: ["否定"] },
    みない: { lemma: "見る", group: "一段", formName: "ない形", formTags: ["否定"] },
    見れば: { lemma: "見る", group: "一段", formName: "ば形", formTags: ["假定"] },
    見よう: { lemma: "見る", group: "一段", formName: "意向形", formTags: [] },
    見ている: { lemma: "見る", group: "一段", formName: "ている", formTags: [] },
    見てる: { lemma: "見る", group: "一段", formName: "ている", formTags: ["口語"] },
  };

  const GODAN_U = "うくぐすつぬぶむる";
  const I_DAN = "いきぎしじちぢにひびみり";
  const E_DAN = "えけげせぜてでねへべめれ";
  const A_DAN_MAP = {
    わ: "う", か: "く", が: "ぐ", さ: "す", た: "つ",
    な: "ぬ", ば: "ぶ", ま: "む", ら: "る",
  };
  const I_DAN_MAP = {
    い: "う", き: "く", ぎ: "ぐ", し: "す", ち: "つ",
    に: "ぬ", び: "ぶ", み: "む", り: "る",
  };
  const E_DAN_MAP = {
    え: "う", け: "く", げ: "ぐ", せ: "す", て: "つ",
    ね: "ぬ", べ: "ぶ", め: "む", れ: "る",
  };

  const ROW_OF_U = {
    う: "ワ行", く: "カ行", ぐ: "ガ行", す: "サ行", つ: "タ行",
    ぬ: "ナ行", ぶ: "バ行", む: "マ行", る: "ラ行",
  };

  /**
   * 五段「〜る」例外（封閉集合：教科書常見約 30 詞，不必維護一段白名單）
   * 規則：讀音以 える／いる 結尾 → 預設一段；僅下列為五段
   */
  const GODAN_RU_LEMMAS = new Set([
    "帰る", "かえる", "切る", "知る", "しる", "走る", "はしる",
    "入る", "はいる", "要る",
    "減る", "へる", "喋る", "しゃべる", "滑る", "すべる",
    "蹴る", "ける", "照る", "練る",
    "焦る", "あせる", "限る", "かぎる", "握る", "にぎる",
    "黙る", "だまる", "参る", "まいる", "交じる", "まじる",
    "遮る", "さえぎる", "翻る", "ひるがえる", "甦る", "よみがえる",
    "散る", "ちる", "混じる", "ねじる", "捻る", "翻る",
  ]);

  /** 單漢字＋る 的五段例外字（無讀音時用） */
  const GODAN_RU_SINGLE_KANJI = new Set([
    "帰", "切", "知", "走", "入", "要", "減", "喋", "滑", "蹴", "照", "練",
    "焦", "限", "握", "黙", "参", "遮", "翻", "茂", "散", "捻",
  ]);

  function normalize(form) {
    return String(form || "")
      .trim()
      .normalize("NFC")
      .replace(/\s+/g, "");
  }

  function groupLabel(group, detail) {
    const base = GROUP_LABELS[group] || group || "未知";
    if (group === "五段" && detail) return `${base}（${detail}）`;
    return base;
  }

  /**
   * 讀音是否像一段（〜える／〜いる）
   * kuromoji reading 多為片假名（ミル・タベル）
   */
  function readingLooksIchidan(reading) {
    if (!reading || reading === "*") return null;
    const r = String(reading).normalize("NFC").replace(/ー/g, "");
    // 片假名：〜エル／〜イル
    if (/エル$/.test(r) || /イル$/.test(r)) return true;
    // 平假名
    if (/える$/.test(r) || /いる$/.test(r)) return true;
    // 以 ル 結尾但非 エル／イル → 多為五段ラ行
    if (/ル$/.test(r) || /る$/.test(r)) return false;
    return null;
  }

  /**
   * 判定動詞類型
   * 優先序：
   * 1) サ変／カ変／行く
   * 2) 五段る例外表（小而封閉）
   * 3) 讀音 える／いる → 一段（不必維護一段詞表）
   * 4) 表面假名い／え段＋る → 一段
   * 5) 單漢字＋る 且非五段例外字 → 一段
   * 6) 其他う段結尾 → 五段
   *
   * @param {string} lemma 原形
   * @param {{ reading?: string }} [opts]
   */
  function guessGroupFromLemma(lemma, opts = {}) {
    if (!lemma || lemma === "?") return { group: "未知", groupDetail: "" };
    const L = normalize(lemma);
    const reading = opts.reading || "";

    if (L === "する" || L.endsWith("する")) return { group: "サ変", groupDetail: "" };
    if (L === "来る" || L === "くる") return { group: "カ変", groupDetail: "" };
    if (L === "行く" || L === "いく") return { group: "五段", groupDetail: "カ行" };
    if (L === "要る") return { group: "五段", groupDetail: "ラ行" };
    if (L === "いる" || L === "居る") return { group: "一段", groupDetail: "" };

    // 五段る例外（封閉表，不必加一段詞）
    if (GODAN_RU_LEMMAS.has(L)) return { group: "五段", groupDetail: "ラ行" };

    // 有讀音：える／いる → 一段（見る＝ミル → イル）
    const byReading = readingLooksIchidan(reading);
    if (byReading === true) return { group: "一段", groupDetail: "" };
    if (byReading === false && (L.endsWith("る") || /ル$/.test(String(reading)))) {
      return { group: "五段", groupDetail: "ラ行" };
    }

    if (L.endsWith("る") && L.length >= 2) {
      const before = L.slice(-2, -1);
      const stem = L.slice(0, -1);

      // 假名：い段／え段＋る → 一段
      if (I_DAN.includes(before) || E_DAN.includes(before)) {
        return { group: "一段", groupDetail: "" };
      }

      // 單漢字＋る：無讀音時，非五段例外字 → 一段（見・着・寝…）
      if (/^[\u4E00-\u9FFF]る$/.test(L)) {
        if (GODAN_RU_SINGLE_KANJI.has(stem)) return { group: "五段", groupDetail: "ラ行" };
        return { group: "一段", groupDetail: "" };
      }

      return { group: "五段", groupDetail: ROW_OF_U["る"] || "ラ行" };
    }

    const last = L.slice(-1);
    if (GODAN_U.includes(last)) {
      return { group: "五段", groupDetail: ROW_OF_U[last] || "" };
    }
    return { group: "未知", groupDetail: "" };
  }

  function mapKuromojiType(conjugatedType) {
    const t = String(conjugatedType || "");
    if (!t || t === "*") return null;
    if (/サ変|スル/.test(t)) return { group: "サ変", groupDetail: "" };
    if (/カ変|クル/.test(t)) return { group: "カ変", groupDetail: "" };
    if (/一段/.test(t)) return { group: "一段", groupDetail: "" };
    if (/五段/.test(t)) {
      let detail = "";
      const m = t.match(/([ア-ン]行|ワ行|カ行|ガ行|サ行|タ行|ナ行|バ行|マ行|ラ行)/);
      if (m) detail = m[1];
      return { group: "五段", groupDetail: detail };
    }
    if (/形容詞/.test(t)) return { group: "形容詞", groupDetail: t };
    return null;
  }

  function mapKuromojiForm(conjugatedForm, surface) {
    const f = String(conjugatedForm || "");
    const s = String(surface || "");
    if (!f || f === "*") return null;
    if (/基本形|終止形|連体形/.test(f)) return { formName: "辞書形", formTags: [] };
    if (/連用形/.test(f)) {
      if (s.endsWith("ます") || s.endsWith("まし") || s.endsWith("ませ")) {
        return { formName: "ます形", formTags: ["丁寧"] };
      }
      return { formName: "連用形", formTags: [] };
    }
    if (/未然形/.test(f)) return { formName: "未然形", formTags: [] };
    if (/仮定形|已然形/.test(f)) return { formName: "ば形", formTags: ["假定"] };
    if (/命令形/.test(f)) return { formName: "命令形", formTags: [] };
    if (/意志/.test(f)) return { formName: "意向形", formTags: [] };
    return { formName: f, formTags: [] };
  }

  /**
   * 從表面形推原形（啟發式）
   */
  function refineLemma(form) {
    const f = normalize(form);
    if (!f) return null;
    if (IRREGULARS[f]) return IRREGULARS[f].lemma;

    // ます系
    if (f.endsWith("ませんでした")) return refineLemma(f.slice(0, -6) + "ます");
    if (f.endsWith("ました")) return refineLemma(f.slice(0, -3) + "ます");
    if (f.endsWith("ません")) return refineLemma(f.slice(0, -3) + "ます");
    if (f.endsWith("ます")) {
      const base = f.slice(0, -2);
      if (base === "し") return "する";
      if (base === "来" || base === "き") return "来る";
      if (base === "行" || base === "い") return "行く";
      const last = base.slice(-1);
      // 一段：え段連用（食べ・教え）
      if (E_DAN.includes(last)) return base + "る";
      // 常見い段連用一段（見・着・起き・借り…）
      const ichidanIStems =
        /^(見|着|居|寝|似|煮|み|に|き|いで|おき|でき|かり|たり|おり|おり|感じ|信じ|降り|閉じ|命じ|通じ)$/;
      if (ichidanIStems.test(base)) return base + "る";
      // 五段：い段連用 → 辞書う段（書き→書く、飲み→飲む）
      if (I_DAN_MAP[last]) {
        if (base.length <= 1) return base + "る"; // 見 等單字
        return base.slice(0, -1) + I_DAN_MAP[last];
      }
      // 漢字等詞幹：優先一段 + る
      return base + "る";
    }

    // ている
    if (/て[い]?る$/.test(f) || /で[い]?る$/.test(f) || f.endsWith("ていた") || f.endsWith("でいた")) {
      const te = f
        .replace(/でいました$/, "で")
        .replace(/ていました$/, "て")
        .replace(/でいた$/, "で")
        .replace(/ていた$/, "て")
        .replace(/でいます$/, "で")
        .replace(/ています$/, "て")
        .replace(/でいる$/, "で")
        .replace(/ている$/, "て")
        .replace(/でる$/, "で")
        .replace(/てる$/, "て");
      return refineLemma(te);
    }

    // たい
    if (f.endsWith("たくない")) return refineLemma(f.slice(0, -4) + "たい");
    if (f.endsWith("たかった")) return refineLemma(f.slice(0, -4) + "たい");
    if (f.endsWith("たい")) {
      const base = f.slice(0, -2);
      if (base === "し") return "する";
      if (E_DAN.includes(base.slice(-1))) return base + "る";
      const last = base.slice(-1);
      if (I_DAN_MAP[last]) {
        if (base.length <= 2 && /[いきしちにひみり]$/.test(last)) return base + "る";
        return base.slice(0, -1) + I_DAN_MAP[last];
      }
      return base + "る";
    }

    // ない
    if (f.endsWith("なければ")) return refineLemma(f.slice(0, -4) + "ない");
    if (f.endsWith("なかった")) return refineLemma(f.slice(0, -4) + "ない");
    if (f.endsWith("ない")) {
      if (f === "ない") return "ある";
      if (f === "しない") return "する";
      if (f === "こない" || f === "来ない") return "来る";
      const base = f.slice(0, -2);
      const last = base.slice(-1);
      if (A_DAN_MAP[last]) return base.slice(0, -1) + A_DAN_MAP[last];
      return base + "る";
    }

    // ば
    if (f.endsWith("れば") && f.length > 2) {
      if (f === "すれば") return "する";
      if (f === "くれば" || f === "来れば") return "来る";
      return f.slice(0, -2) + "る";
    }
    if (/[えけげせてねべめれ]ば$/.test(f) && f.length > 2) {
      const base = f.slice(0, -1);
      const last = base.slice(-1);
      if (E_DAN_MAP[last]) return base.slice(0, -1) + E_DAN_MAP[last];
    }

    // たら
    if (f.endsWith("たら") || f.endsWith("だら")) {
      return refineLemma(f.slice(0, -1)); // 食べた / 読んだ
    }

    // て／た 音便
    if (f.endsWith("って") || f.endsWith("った")) {
      const base = f.replace(/った$/, "").replace(/って$/, "");
      if (base === "行" || base === "い") return "行く";
      // 買って→買う、待って→待つ、取って→取る、有って→ある
      if (base === "有" || base === "あ") return "ある";
      return base + "う";
    }
    if (f.endsWith("いて") || f.endsWith("いた")) {
      const base = f.replace(/いた$/, "").replace(/いて$/, "");
      if (base === "行" || base === "い") return "行く";
      return base + "く";
    }
    if (f.endsWith("いで") || f.endsWith("いだ")) {
      return f.replace(/いだ$/, "").replace(/いで$/, "") + "ぐ";
    }
    if (f.endsWith("して") || f.endsWith("した")) {
      const base = f.replace(/した$/, "").replace(/して$/, "");
      if (!base) return "する";
      return base + "す";
    }
    if (f.endsWith("んで") || f.endsWith("んだ")) {
      return f.replace(/んだ$/, "").replace(/んで$/, "") + "む";
    }
    if (f.endsWith("て") || f.endsWith("た")) {
      return f.slice(0, -1) + "る";
    }
    if (f.endsWith("で") || f.endsWith("だ")) {
      return f.slice(0, -1) + "ぐ";
    }

    // 意向
    if (f.endsWith("よう") && f.length > 2) {
      if (f === "しよう") return "する";
      if (f === "こよう" || f === "来よう") return "来る";
      return f.slice(0, -2) + "る";
    }
    if (f.endsWith("う") && f.length > 1 && !GODAN_U.includes(f.slice(-1))) {
      // 書こう 等：お段＋う
      const base = f.slice(0, -1);
      const oToU = { お: "う", こ: "く", ご: "ぐ", そ: "す", と: "つ", の: "ぬ", ぼ: "ぶ", も: "む", ろ: "る" };
      const last = base.slice(-1);
      if (oToU[last]) return base.slice(0, -1) + oToU[last];
    }

    // 辞書形
    if (/[うくぐすつぬぶむる]$/.test(f)) return f;
    return null;
  }

  /**
   * 偵測活用形與修飾標籤
   */
  function detectForm(form) {
    const f = normalize(form);
    if (!f) return { formName: "未知", formTags: [], ending: null };

    if (f.endsWith("ませんでした")) return { formName: "ます形", formTags: ["丁寧", "否定", "過去"], ending: "ませんでした" };
    if (f.endsWith("ました")) return { formName: "ます形", formTags: ["丁寧", "過去"], ending: "ました" };
    if (f.endsWith("ません")) return { formName: "ます形", formTags: ["丁寧", "否定"], ending: "ません" };
    if (f.endsWith("ます")) return { formName: "ます形", formTags: ["丁寧"], ending: "ます" };

    if (f.endsWith("ていました") || f.endsWith("でいました")) return { formName: "ている", formTags: ["丁寧", "過去"], ending: "ていました" };
    if (f.endsWith("ています") || f.endsWith("でいます")) return { formName: "ている", formTags: ["丁寧"], ending: "ています" };
    if (f.endsWith("ていた") || f.endsWith("でいた")) return { formName: "ている", formTags: ["過去"], ending: "ていた" };
    if (f.endsWith("ている") || f.endsWith("でいる")) return { formName: "ている", formTags: [], ending: "ている" };
    if (f.endsWith("てる") || f.endsWith("でる")) return { formName: "ている", formTags: ["口語"], ending: "てる" };

    if (f.endsWith("たくない")) return { formName: "たい形", formTags: ["否定"], ending: "たくない" };
    if (f.endsWith("たかった")) return { formName: "たい形", formTags: ["過去"], ending: "たかった" };
    if (f.endsWith("たい")) return { formName: "たい形", formTags: [], ending: "たい" };

    if (f.endsWith("なければ")) return { formName: "ない形", formTags: ["假定"], ending: "なければ" };
    if (f.endsWith("なかった")) return { formName: "ない形", formTags: ["過去"], ending: "なかった" };
    if (f.endsWith("ない")) return { formName: "ない形", formTags: ["否定"], ending: "ない" };

    if (f.endsWith("たら") || f.endsWith("だら")) return { formName: "たら形", formTags: ["假定"], ending: f.endsWith("だら") ? "だら" : "たら" };
    if (f.endsWith("れば") || /[えけげせてねべめれ]ば$/.test(f)) return { formName: "ば形", formTags: ["假定"], ending: "ば" };

    if (f.endsWith("させられ")) return { formName: "使役受身", formTags: [], ending: "させられ" };
    if (f.endsWith("せられ")) return { formName: "使役受身", formTags: [], ending: "せられ" };
    if (f.endsWith("られる") || f.endsWith("れます")) return { formName: "可能／受身形", formTags: [], ending: "られる" };
    if (f.endsWith("させる") || f.endsWith("させます")) return { formName: "使役形", formTags: [], ending: "させる" };
    if (f.endsWith("せる") && f.length > 2) return { formName: "使役形", formTags: [], ending: "せる" };

    if (f.endsWith("よう")) return { formName: "意向形", formTags: [], ending: "よう" };
    if (/[おこごそとのぼもろ]う$/.test(f) && f.length > 2) return { formName: "意向形", formTags: [], ending: "う" };

    if (f.endsWith("って") || f.endsWith("いて") || f.endsWith("いで") || f.endsWith("して") || f.endsWith("んで") || f.endsWith("て") || f.endsWith("で")) {
      return { formName: "て形", formTags: [], ending: f.slice(-1) === "で" || f.endsWith("いで") || f.endsWith("んで") ? "で" : "て" };
    }
    if (f.endsWith("った") || f.endsWith("いた") || f.endsWith("いだ") || f.endsWith("した") || f.endsWith("んだ") || f.endsWith("た") || f.endsWith("だ")) {
      return { formName: "た形", formTags: ["過去"], ending: f.slice(-1) };
    }

    if (/[うくぐすつぬぶむる]$/.test(f)) return { formName: "辞書形", formTags: [], ending: f.slice(-1) };

    // い形容詞
    if (f.endsWith("かった")) return { formName: "い形容詞過去", formTags: ["過去"], ending: "かった" };
    if (f.endsWith("くない")) return { formName: "い形容詞否定", formTags: ["否定"], ending: "くない" };
    if (f.endsWith("くて")) return { formName: "い形容詞て形", formTags: [], ending: "くて" };
    if (f.endsWith("い") && f.length > 1) return { formName: "い形容詞", formTags: [], ending: "い" };

    return { formName: "未知", formTags: [], ending: null };
  }

  /**
   * 分項變化說明
   */
  function buildSteps(surface, lemma, group, groupDetail, formName, formTags, note) {
    const steps = [];
    const f = normalize(surface);
    const gLabel = groupLabel(group, groupDetail);
    const tags = formTags || [];

    steps.push({
      label: "原形",
      text: lemma && lemma !== "?" ? `${lemma}（${gLabel}）` : "（無法確定原形）",
    });

    if (group === "一段" && lemma && lemma.endsWith("る")) {
      steps.push({
        label: "類型要點",
        text: "一段動詞：去掉「る」得連用語幹，再接各種活用語尾。",
      });
    } else if (group === "五段" && lemma) {
      const row = groupDetail || ROW_OF_U[lemma.slice(-1)] || "";
      steps.push({
        label: "類型要點",
        text: `五段動詞${row ? `（${row}）` : ""}：語尾在五十音同一行內變換（ア・イ・ウ・エ・オ段）。`,
      });
    } else if (group === "サ変") {
      steps.push({
        label: "類型要點",
        text: "サ変：する／〜する。連用「し」、未然「し／せ」、仮定「すれ」等不規則。",
      });
    } else if (group === "カ変") {
      steps.push({
        label: "類型要點",
        text: "カ変：来る。讀音與寫法都不規則（きます／きて／こない…），需整組記。",
      });
    }

    // 形式步驟
    if (formName === "ます形") {
      if (group === "一段" && lemma?.endsWith("る")) {
        const stem = lemma.slice(0, -1);
        steps.push({ label: "連用", text: `${lemma} → ${stem}（去「る」）` });
        steps.push({ label: "丁寧", text: `${stem} ＋ ます` });
      } else if (group === "五段" && lemma) {
        const u = lemma.slice(-1);
        const i = Object.entries(I_DAN_MAP).find(([, v]) => v === u)?.[0];
        if (i) {
          steps.push({ label: "連用", text: `${u} → ${i}（イ段）` });
          steps.push({ label: "丁寧", text: `連用語幹 ＋ ます` });
        } else {
          steps.push({ label: "丁寧", text: "連用形 ＋ ます" });
        }
      } else if (group === "サ変") {
        steps.push({ label: "連用", text: "する → し" });
        steps.push({ label: "丁寧", text: "し ＋ ます" });
      } else if (group === "カ変") {
        steps.push({ label: "連用", text: "来る → き" });
        steps.push({ label: "丁寧", text: "き ＋ ます" });
      } else {
        steps.push({ label: "丁寧", text: "連用形 ＋ ます" });
      }
      if (tags.includes("否定") && tags.includes("過去")) {
        steps.push({ label: "否定・過去", text: "ます → ませんでした" });
      } else if (tags.includes("否定")) {
        steps.push({ label: "否定", text: "ます → ません" });
      } else if (tags.includes("過去")) {
        steps.push({ label: "過去", text: "ます → ました" });
      }
    } else if (formName === "て形" || formName === "た形") {
      const isTa = formName === "た形";
      if (lemma === "行く") {
        steps.push({
          label: isTa ? "た形" : "て形",
          text: isTa ? "行く → 行った（例外音便，非「いいた」）" : "行く → 行って（例外音便，非「いいて」）",
        });
      } else if (group === "一段" && lemma?.endsWith("る")) {
        const stem = lemma.slice(0, -1);
        steps.push({ label: formName, text: `${stem} ＋ ${isTa ? "た" : "て"}` });
      } else if (group === "サ変") {
        steps.push({ label: formName, text: isTa ? "する → した" : "する → して" });
      } else if (group === "カ変") {
        steps.push({ label: formName, text: isTa ? "来る → きた" : "来る → きて" });
      } else if (group === "五段" && lemma) {
        const u = lemma.slice(-1);
        const map = {
          う: "って／った", つ: "って／った", る: "って／った",
          く: "いて／いた", ぐ: "いで／いだ", す: "して／した",
          ぬ: "んで／んだ", ぶ: "んで／んだ", む: "んで／んだ",
        };
        steps.push({
          label: "音便",
          text: map[u]
            ? `五段「${u}」→ ${map[u]}（${isTa ? "た形" : "て形"}）`
            : `依五段音便規則變成${formName}`,
        });
      } else {
        steps.push({ label: formName, text: `表面形「${f}」` });
      }
    } else if (formName === "ない形") {
      if (lemma === "ある") {
        steps.push({ label: "否定", text: "ある → ない（例外）" });
      } else if (group === "一段" && lemma?.endsWith("る")) {
        steps.push({ label: "未然", text: `${lemma.slice(0, -1)} ＋ ない` });
      } else if (group === "五段" && lemma) {
        const u = lemma.slice(-1);
        const a = Object.entries(A_DAN_MAP).find(([, v]) => v === u)?.[0];
        steps.push({ label: "未然", text: a ? `${u} → ${a}（ア段）＋ ない` : "ア段 ＋ ない" });
      } else if (group === "サ変") {
        steps.push({ label: "否定", text: "する → しない" });
      } else if (group === "カ変") {
        steps.push({ label: "否定", text: "来る → こない" });
      }
      if (tags.includes("過去")) steps.push({ label: "過去", text: "ない → なかった" });
      if (tags.includes("假定")) steps.push({ label: "假定", text: "ない → なければ" });
    } else if (formName === "ば形") {
      if (group === "一段" && lemma?.endsWith("る")) {
        steps.push({ label: "假定", text: `${lemma.slice(0, -1)} ＋ れば` });
      } else if (group === "五段" && lemma) {
        const u = lemma.slice(-1);
        const e = Object.entries(E_DAN_MAP).find(([, v]) => v === u)?.[0];
        steps.push({ label: "假定", text: e ? `${u} → ${e}（エ段）＋ ば` : "エ段 ＋ ば" });
      } else if (group === "サ変") {
        steps.push({ label: "假定", text: "する → すれば" });
      } else if (group === "カ変") {
        steps.push({ label: "假定", text: "来る → くれば" });
      }
    } else if (formName === "ている") {
      steps.push({ label: "構成", text: "て形 ＋ いる（進行或結果狀態）" });
      if (tags.includes("口語")) steps.push({ label: "口語", text: "ている → てる" });
      if (tags.includes("丁寧")) steps.push({ label: "丁寧", text: "いる → います" });
      if (tags.includes("過去")) steps.push({ label: "過去", text: "いる → いた" });
    } else if (formName === "たい形") {
      steps.push({ label: "希望", text: "連用形 ＋ たい（活用如い形容詞）" });
      if (tags.includes("否定")) steps.push({ label: "否定", text: "たい → たくない" });
      if (tags.includes("過去")) steps.push({ label: "過去", text: "たい → たかった" });
    } else if (formName === "たら形") {
      steps.push({ label: "假定", text: "た形 ＋ ら（條件・假定）" });
    } else if (formName === "辞書形") {
      steps.push({ label: "形式", text: "辞書形（終止・連體常同形）" });
    } else if (formName === "意向形") {
      if (group === "一段") steps.push({ label: "意向", text: "語幹 ＋ よう" });
      else if (group === "五段") steps.push({ label: "意向", text: "オ段 ＋ う" });
      else if (group === "サ変") steps.push({ label: "意向", text: "する → しよう" });
      else if (group === "カ変") steps.push({ label: "意向", text: "来る → こよう" });
    } else if (formName !== "未知") {
      steps.push({ label: "形式", text: formName });
    }

    if (note) {
      steps.push({ label: "注意", text: note });
    }

    // 表面確認
    steps.push({
      label: "表面形",
      text: f,
    });

    return steps;
  }

  function analyzeFromParts(surface, lemma, groupInfo, formInfo, opts = {}) {
    const f = normalize(surface);
    const lemmaFinal = lemma || refineLemma(f) || "?";
    let group = groupInfo?.group;
    let groupDetail = groupInfo?.groupDetail || "";
    let estimated = Boolean(opts.estimated);

    if (!group || group === "未知") {
      const g = guessGroupFromLemma(lemmaFinal, { reading: opts.reading || "" });
      group = g.group;
      groupDetail = groupDetail || g.groupDetail;
      estimated = true;
    }

    const formName = formInfo?.formName || detectForm(f).formName;
    const formTags = formInfo?.formTags || detectForm(f).formTags;
    const ending = formInfo?.ending || detectForm(f).ending;
    const note = opts.note || formInfo?.note || "";

    const steps = buildSteps(f, lemmaFinal, group, groupDetail, formName, formTags, note);

    return {
      lemma: lemmaFinal,
      group,
      groupDetail,
      groupLabel: groupLabel(group, groupDetail) + (estimated ? "（推定）" : ""),
      formName,
      formTags,
      matchedEnding: ending,
      note,
      steps,
      estimated,
    };
  }

  /**
   * 以 kuromoji token 補強分析
   */
  function analyzeWithTokens(rawForm, tokens) {
    const form = normalize(rawForm);
    const words = (tokens || []).filter((t) => t.isWord);
    if (!words.length) return null;

    // 若整段就是一串語素
    const main = words.find((t) => t.pos === "動詞") || words[0];
    if (!main) return null;

    const kType = mapKuromojiType(main.conjugated_type);
    const lemma = main.basic_form && main.basic_form !== "*" ? main.basic_form : refineLemma(form);
    const surfaceForm = form || words.map((t) => t.text).join("");
    const reading = main.reading || "";

    // 從後續助動詞推形式
    let formInfo = detectForm(surfaceForm);
    const chain = words.map((t) => t.text).join("");
    if (chain) {
      const d = detectForm(chain);
      if (d.formName !== "未知") formInfo = d;
    }

    // 若主詞是連用 + ます
    const after = words.slice(words.indexOf(main) + 1);
    if (after.some((t) => t.text === "ます" || t.basic_form === "ます")) {
      formInfo = { formName: "ます形", formTags: ["丁寧"], ending: "ます" };
      if (after.some((t) => /まし/.test(t.text) || t.text === "た")) {
        formInfo = { formName: "ます形", formTags: ["丁寧", "過去"], ending: "ました" };
      }
      if (after.some((t) => t.text === "ん" || t.text === "ぬ" || /ませ/.test(t.text))) {
        formInfo.formTags = [...new Set([...(formInfo.formTags || []), "否定"])];
      }
    }

    const kForm = mapKuromojiForm(main.conjugated_form, main.text);
    if (formInfo.formName === "未知" && kForm) formInfo = { ...formInfo, ...kForm };

    // 類型：kuromoji 活用型 > 讀音規則 > 啟發式（不靠一段白名單）
    const groupInfo =
      kType ||
      guessGroupFromLemma(lemma, { reading }) ||
      guessGroupFromLemma(surfaceForm, { reading });
    const primary = analyzeFromParts(surfaceForm, lemma, groupInfo, formInfo, {
      estimated: !kType,
      note: main.pos === "動詞" ? "" : "",
      reading,
    });

    return {
      form: surfaceForm,
      confidence: kType ? "high" : reading ? "high" : "medium",
      source: kType ? "kuromoji" : "kuromoji-reading",
      kind: main.pos === "動詞" || lemma?.endsWith("る") || lemma === "する" ? "verb" : "other",
      primary,
      guesses: [primary],
      tokens: words.map((t) => ({
        text: t.text,
        pos: t.pos,
        basic_form: t.basic_form,
        reading: t.reading,
        conjugated_type: t.conjugated_type,
        conjugated_form: t.conjugated_form,
      })),
    };
  }

  function analyze(rawForm, options = {}) {
    const form = normalize(rawForm);
    if (!form) {
      return { form: "", confidence: "none", kind: "empty", primary: null, guesses: [], steps: [] };
    }

    // 1) 優先 kuromoji（辭典含活用型／讀音，不必維護一段詞表）
    if (options.tokens?.length) {
      const fromTok = analyzeWithTokens(form, options.tokens);
      if (fromTok?.primary?.lemma && fromTok.primary.lemma !== "?") return fromTok;
    }
    if (typeof JaTokenizer !== "undefined" && JaTokenizer.isReady && JaTokenizer.isReady()) {
      try {
        const tokens = JaTokenizer.tokenize(form);
        const fromTok = analyzeWithTokens(form, tokens);
        if (fromTok?.primary?.formName && fromTok.primary.formName !== "未知") {
          return fromTok;
        }
        // 即使形式未知，若已有類型／原形仍可用
        if (fromTok?.primary?.group && fromTok.primary.group !== "未知") {
          return fromTok;
        }
      } catch {
        /* fall through */
      }
    }

    // 2) 本地固定表（する／来る／行く／見る 高頻）
    if (IRREGULARS[form]) {
      const hit = IRREGULARS[form];
      const primary = analyzeFromParts(
        form,
        hit.lemma,
        { group: hit.group, groupDetail: hit.groupDetail || "" },
        { formName: hit.formName, formTags: hit.formTags || [], ending: null },
        { note: hit.note || "", estimated: false }
      );
      return {
        form,
        confidence: "high",
        source: "local-irregular-table",
        kind: "verb",
        primary,
        guesses: [primary],
      };
    }

    // 3) 啟發式（讀音規則 + 五段る例外；無一段白名單）
    const formInfo = detectForm(form);
    const lemma = refineLemma(form) || (formInfo.formName === "辞書形" ? form : "?");
    const groupInfo = guessGroupFromLemma(lemma);
    const primary = analyzeFromParts(form, lemma, groupInfo, formInfo, {
      estimated: true,
      note: "",
    });

    // い形容詞
    let kind = "verb";
    if (String(formInfo.formName).includes("形容詞")) kind = "adjective";
    if (primary.group === "未知" && formInfo.formName === "未知") kind = "unknown";

    const confidence =
      primary.lemma && primary.lemma !== "?" && formInfo.formName !== "未知" ? "medium" : "low";

    return {
      form,
      confidence,
      source: "local-ending-heuristics",
      kind,
      primary,
      guesses: [primary],
    };
  }

  /**
   * 整句：標出動詞性片段的分析
   */
  function analyzeSentence(rawText) {
    const query = String(rawText || "");
    if (!query.trim()) return { query, verbs: [], tokens: [] };

    let tokens = [];
    if (typeof JaTokenizer !== "undefined") {
      tokens = JaTokenizer.tokenize(query);
    } else {
      tokens = [{ text: query, start: 0, end: query.length, isWord: true, pos: "未知", basic_form: query }];
    }

    const words = tokens.filter((t) => t.isWord);
    const verbs = [];
    let i = 0;
    while (i < words.length) {
      const w = words[i];
      if (w.pos !== "動詞") {
        i += 1;
        continue;
      }
      // 合併後續：助動詞、て／で＋いる、非自立動詞等
      let end = i;
      let surface = w.text;
      let startPos = w.start;
      let endPos = w.end;
      while (end + 1 < words.length) {
        const n = words[end + 1];
        const bf = n.basic_form || "";
        const isAuxVerb =
          n.pos === "動詞" &&
          (bf === "いる" ||
            bf === "ある" ||
            bf === "おく" ||
            bf === "しまう" ||
            bf === "みる" ||
            bf === "くる" ||
            bf === "いく" ||
            /非自立/.test(n.pos_detail || ""));
        const isTeDe =
          (n.text === "て" || n.text === "で") &&
          (n.pos === "助詞" || n.pos === "助動詞" || /接続/.test(n.pos_detail || ""));

        if (n.pos === "助動詞" || isAuxVerb || (n.pos_detail && /非自立/.test(n.pos_detail))) {
          end += 1;
          surface += n.text;
          endPos = n.end;
          continue;
        }
        // 食べ + て (+ いる…) → 整段併入，利於 ている 偵測與標註
        if (isTeDe) {
          end += 1;
          surface += n.text;
          endPos = n.end;
          continue;
        }
        // ます／た 等有時標成助動詞以外
        if (/^(ます|まし|ませ|ん|た|だ|ない|なかっ|たい|う|よう)$/.test(n.text)) {
          end += 1;
          surface += n.text;
          endPos = n.end;
          continue;
        }
        break;
      }
      const chainTokens = words.slice(i, end + 1);
      const analysis = analyze(surface, { tokens: chainTokens });
      verbs.push({
        text: surface,
        start: startPos,
        end: endPos,
        analysis,
      });
      i = end + 1;
    }

    return { query, verbs, tokens };
  }

  function buildSuggestions(form, analysis) {
    const p = analysis?.primary || {};
    const keywords = [];
    if (p.lemma && p.lemma !== "?") keywords.push(p.lemma);
    if (p.formName && p.formName !== "未知") keywords.push(p.formName);
    if (p.group && p.group !== "未知") keywords.push(p.group);
    if (p.groupLabel) keywords.push(p.groupLabel);
    keywords.push(form);

    return {
      keywords: [...new Set(keywords.filter(Boolean))],
      checklist: [
        "確認原形（辞書形）",
        "確認動詞類型：一段／五段／サ変／カ変",
        "確認活用形與附加（丁寧・否定・過去等）",
        "是否為助詞、句型或複合助動詞",
      ],
      sources: ["OJAD", "Weblio 文法", "JLPT 教材", "本筆記本既有規則"],
      summary:
        p.lemma && p.lemma !== "?"
          ? `「${form}」→ ${p.lemma}（${p.groupLabel || p.group}）・${p.formName}${
              (p.formTags || []).length ? "（" + p.formTags.join("・") + "）" : ""
            }。可將此類型／形式整理成規則卡片。`
          : `建議先確認「${form}」的原形與文法角色，再寫成規則卡片。`,
    };
  }

  function draftFromAnalysis(form, analysis) {
    const p = analysis?.primary || {};
    const lemma = p.lemma && p.lemma !== "?" ? p.lemma : "";
    const formName = p.formName && p.formName !== "未知" ? p.formName : "";
    const titleParts = [];
    if (p.group && p.group !== "未知") titleParts.push(p.group === "五段" ? "五段動詞" : GROUP_LABELS[p.group] || p.group);
    if (formName) titleParts.push(formName);
    if (!titleParts.length) titleParts.push(form);

    const stepText = (p.steps || [])
      .filter((s) => s.label !== "表面形")
      .map((s) => `・${s.label}：${s.text}`)
      .join("\n");

    const isVerbConj =
      analysis?.kind === "verb" ||
      (p.group && ["一段", "五段", "サ変", "カ変"].includes(p.group));

    // 三格：簡潔規則、無例子；五段只標段或音便
    const conjugation = { ichidan: "", godan: "", sahen: "" };
    if (isVerbConj && formName) {
      const fn = formName || "";
      if (/ます/.test(fn)) {
        conjugation.ichidan = "去る＋ます";
        conjugation.godan = "イ段＋ます";
        conjugation.sahen = "し＋ます";
      } else if (fn === "て形" || fn === "ている" || fn === "たら形") {
        conjugation.ichidan = fn === "ている" ? "て形＋いる" : fn === "たら形" ? "た形＋ら" : "語幹＋て";
        conjugation.godan = fn === "ている" ? "音便て形＋いる" : fn === "たら形" ? "音便た形＋ら" : "音便（見音便規則）";
        conjugation.sahen = fn === "ている" ? "して＋いる" : fn === "たら形" ? "したら" : "して";
      } else if (fn === "た形") {
        conjugation.ichidan = "語幹＋た";
        conjugation.godan = "音便（見音便規則）";
        conjugation.sahen = "した";
      } else if (/ない/.test(fn)) {
        conjugation.ichidan = "語幹＋ない";
        conjugation.godan = "ア段＋ない";
        conjugation.sahen = "しない";
      } else if (fn === "ば形") {
        conjugation.ichidan = "語幹＋れば";
        conjugation.godan = "エ段＋ば";
        conjugation.sahen = "すれば";
      } else if (fn === "意向形") {
        conjugation.ichidan = "語幹＋よう";
        conjugation.godan = "オ段＋う";
        conjugation.sahen = "しよう";
      } else if (fn === "たい形") {
        conjugation.ichidan = "連用＋たい";
        conjugation.godan = "イ段＋たい";
        conjugation.sahen = "したい";
      } else if (p.group === "一段") {
        conjugation.ichidan = formName;
      } else if (p.group === "五段") {
        conjugation.godan = formName;
      } else if (p.group === "サ変") {
        conjugation.sahen = formName;
      }
    }

    return {
      title: titleParts.join("・"),
      category: analysis?.kind === "adjective" ? "形容詞" : isVerbConj ? "活用" : "其他",
      explanation:
        (p.lemma
          ? `「${form}」＝ ${lemma} 的 ${formName || "活用"}（${p.groupLabel || "?"}）。\n`
          : `由查詢「${form}」預填。\n`) +
        (stepText ? `\n分項說明：\n${stepText}\n` : "") +
        "\n請依文法書核對並補充用法說明。",
      requiresConjugation: Boolean(isVerbConj),
      conjugation,
    };
  }

  return {
    normalize,
    analyze,
    analyzeSentence,
    analyzeWithTokens,
    buildSuggestions,
    draftFromAnalysis,
    guessGroupFromLemma,
    groupLabel,
    detectForm,
    refineLemma,
  };
})();
