/**
 * SpaceXAI / xAI API
 * 1) 查詢：文法盤點（句子／單詞中的文法點）
 * 2) 表單：依規則名自動填寫說明與三格
 */
const AiService = (() => {
  const SYSTEM_PROMPT = `你是日語文法助教（涵蓋動詞活用、助詞、敬語、接續、句型等）。根據使用者給的「規則名」，產出一則可直接寫入筆記本的規則卡片。

必須只輸出一個 JSON 物件（不要 markdown、不要程式碼圍欄、不要其他文字），格式如下：
{
  "title": "可微調後的規則名（繁體中文或日文皆可）",
  "category": "動詞類型|活用|助動詞|句型|助詞|形容詞|其他 擇一",
  "explanation": "詳細說明：用法、結構、例外與記憶要點（繁體中文，2–6 句，可夾日文例句）",
  "requiresConjugation": true或false,
  "conjugation": {
    "ichidan": "一段變化規則（一句、無例子）",
    "godan": "五段：只需寫ア段／イ段／エ段／オ段或「音便」（一句、無例子）",
    "sahen": "サ変變化規則（一句、無例子）"
  }
}

規則：
1. category 必須是上述之一。
2. requiresConjugation：若此文法需要動詞依類型變化（ます形、て形、ない形、ている、てもいい 等）設 true；助詞等不需變化則 false。
3. conjugation 三格格式（重要）：
   - 只寫簡潔變化指示，禁止舉例（不要「書く→書きます」這類）。
   - ichidan：如「去る＋ます」「語幹＋て」「語幹＋ない」。
   - godan：只標需要的段或音便，如「イ段＋ます」「ア段＋ない」「エ段＋ば」「音便（見音便規則）」。
   - sahen：如「し＋ます」「して」「しない」。
   - 不適用填「—」。
4. 音便細節寫 explanation 或見音便規則，不塞進 godan 長文。
5. requiresConjugation 為 false 時 conjugation 三鍵皆 ""。
6. 不要輸出 keywords 或六格活用表。
7. explanation 用繁體中文；カ変例外寫在 explanation。
8. 內容需正確、實用。`;

  const INVENTORY_SYSTEM = `你是日語文法助教。使用者會給一段日文（單詞或句子）以及「本地已有規則標題列表」。
請盤點句中文法，並給實詞原形與簡義。只輸出一個 JSON（無 markdown／圍欄）。

格式：
{
  "summary": "一句話繁中摘要（可空）",
  "translation": "整句繁中翻譯（必填；單詞則給該詞中文義）",
  "items": [
    {
      "name": "規則名（繁中，可夾日文標記）",
      "nameZh": "中文功能名",
      "nameJa": "日文標記或表面形",
      "category": "動詞類型|活用|助動詞|句型|助詞|形容詞|其他",
      "span": "句中對應的日文片段（必須能在原文 indexOf 找到，可空）",
      "note": "一句繁中短註",
      "confidence": "high|medium|low"
    }
  ],
  "vocab": [
    {
      "surface": "句中表面形",
      "reading": "平假名讀音（有漢字必填）",
      "lemma": "詞典原形（僅活用詞需要）",
      "origin": "外來語的原文（非外來語則空字串）",
      "gloss": "簡短中文義（外來語只寫中文，勿重複原文）",
      "pos": "見下方詞性規則",
      "start": 0,
      "end": 2
    }
  ]
}

文法 items：
1. 只列值得建卡的文法點（活用、助動詞、句型、助詞等），不要每個詞都列。
2. 若句中文法與本地標題語意相同，name 必須**逐字抄本地標題**（勿自創同義別名）。本地若有「ます形（丁寧形）」「て形」「ない形（否定）」等，name 請逐字抄。
3. **span 極重要**：必須是查詢原文裡**原樣找得到**的連續日文（indexOf 能命中），禁止「ます形」「て形」「〜た」等抽象標籤。
   - **動詞活用**：span 填句中**完整活用形**（例：食べます、行って、書かない、しました、来た）。不要只寫「ます／て／ない」單語尾（除非句中只剩語尾）。
   - **句型**（ている／てもいい 等）：span 用接辭可見片段（ている、てもいい）；可與動詞活用分列。
   - **助詞**：span 填 は／が／を 等句中字。
4. 一個活用形一項（ます形、て形、ない形、た形、ば形、意向形、辞書形 等分開列）。
5. note 最多一句；不確定時 confidence 用 low。items 寧可少而準。
6. category：動詞活用用「活用」；句型用「句型」；助詞用「助詞」。

詞彙 vocab（句中有實詞就必填）：
7. 只列實詞（名／動／形／副／代等）；助詞、語尾、文法標記不要進 vocab。
8. **reading（讀音）**：surface 含漢字時**必填全詞平假名**（例：友達→ともだち、食べます→たべます、東京→とうきょう）。純假名可省略 reading。用平假名，勿用片假名／羅馬字。
9. **lemma（原形）只給會變化的詞**：
    - 動詞／形容詞（い・な）：必填詞典形（食べます→食べる；行った→行く；高い→高い；静か→静か／静かだ 皆可）。
    - **名詞、副詞、代詞、數詞等不會活用的：lemma 請留空或不寫**（不要重複 surface）。
10. 名詞+助詞：surface 用「友達」或「友達と」；reading 填名詞讀音；lemma 空。
11. 同一實詞去重；gloss 一句內語境簡義（短）。
12. start/end 盡量給準（0-based，end 不含）；若省略前端用 surface 搜尋。
12b. **一字一條、禁止整句當 surface**：每個實詞各一筆 vocab；surface 必須是句中**單一詞**的連續片段（例：昨日／友達／映画／見た），禁止把整句或「友達と映画」這類多詞串成一筆。start/end 也不可蓋住大半句。
13. **pos 詞性標籤（必須用下列完整寫法）**：
    - 動詞：動詞・一段｜動詞・五段｜動詞・サ変｜動詞・カ変｜動詞・不規則
    - 形容詞：形容詞・い｜形容詞・な
    - 其他：名詞、副詞、代詞、數詞、其他
14. 禁止 pos 只寫「動詞」「形容詞」而不附一段／五段／サ変／カ変／い／な。
15. カ変（来る）與サ変（する）分開。
16. **外來語（gairaigo／片假名借詞等）必填 origin + gloss**：
    - origin：來源語言的**原文拼寫**（例：コーヒー→coffee、アルバイト→Arbeit、パン→pain、コンピューター→computer、チーズ→cheese）。用該語言常見正字，勿用羅馬字硬拼日文發音。
    - gloss：只寫**繁體中文義**（例：咖啡、打工、麵包），**不要**再把英文寫進 gloss。
    - 前端會顯示成「原文（中文）」，如 coffee（咖啡）。
    - 和製英語、商標、固有外來語也盡量給合理原文；實在無明確外來源則 origin 留空。
    - 和語／漢語詞（漢字和語、訓讀和語等）origin 必須空。`

  const ALLOWED_INV_CAT = new Set([
    "動詞類型", "活用", "助動詞", "句型", "助詞", "形容詞", "其他",
  ]);

  function getConfig() {
    const s = Storage.loadSettings();
    return {
      apiKey: s.apiKey || "",
      baseUrl: (s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
      model: s.model || Storage.DEFAULT_SETTINGS.model,
    };
  }

  function extractJson(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("API 回傳空白內容");

    try {
      return JSON.parse(raw);
    } catch {
      /* continue */
    }

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* continue */
      }
    }

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error("無法解析 API 回傳的 JSON");
  }

  function normalizeDraft(data, fallbackTitle) {
    const allowed = new Set(["動詞類型", "活用", "助動詞", "句型", "助詞", "形容詞", "其他"]);
    let category = String(data?.category || "").trim();
    if (!allowed.has(category)) category = "其他";

    const conjIn = data?.conjugation && typeof data.conjugation === "object" ? data.conjugation : {};
    const conjugation = {
      ichidan: String(conjIn.ichidan ?? conjIn["一段"] ?? "").trim(),
      godan: String(conjIn.godan ?? conjIn["五段"] ?? "").trim(),
      sahen: String(conjIn.sahen ?? conjIn["サ変"] ?? conjIn.sa ?? "").trim(),
    };

    let requiresConjugation = Boolean(data?.requiresConjugation);
    if (conjugation.ichidan || conjugation.godan || conjugation.sahen) {
      requiresConjugation = true;
    }
    // 依分類啟發式
    if (
      !requiresConjugation &&
      (category === "活用" || /ます|て形|た形|ない|ている|ば形|たい|使役|受身|可能/.test(fallbackTitle || ""))
    ) {
      // 保留 false 除非 AI 明確填了三格；不強制
    }

    if (!requiresConjugation) {
      conjugation.ichidan = "";
      conjugation.godan = "";
      conjugation.sahen = "";
    }

    return {
      title: String(data?.title || fallbackTitle || "").trim() || fallbackTitle,
      category,
      explanation: String(data?.explanation || "").trim(),
      requiresConjugation,
      conjugation,
    };
  }

  async function chatComplete({ messages, temperature = 0.3 }) {
    const { apiKey, baseUrl, model } = getConfig();
    if (!apiKey) {
      throw new Error("尚未設定 API Key，請先到「設定」填入");
    }

    const url = `${baseUrl}/chat/completions`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          stream: false,
        }),
      });
    } catch (err) {
      const msg = err?.message || String(err);
      if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
        throw new Error(
          "無法連線 API（可能是網路或瀏覽器 CORS）。請確認 Base URL 與金鑰，或改用本機代理。"
        );
      }
      throw new Error("網路錯誤：" + msg);
    }

    const bodyText = await res.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = { raw: bodyText };
    }

    if (!res.ok) {
      const detail =
        body?.error?.message ||
        body?.message ||
        body?.error ||
        bodyText?.slice(0, 200) ||
        res.statusText;
      if (res.status === 401 || res.status === 403) {
        throw new Error("API Key 無效或無權限（" + res.status + "）");
      }
      throw new Error(`API 錯誤 ${res.status}：${detail}`);
    }

    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("API 回傳沒有內容");
    }
    return content;
  }

  async function completeRuleFromTitle(title) {
    const t = String(title || "").trim();
    if (!t) throw new Error("請先填寫規則名");

    const content = await chatComplete({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `規則名：${t}\n\n請依此產出 JSON 規則卡片。`,
        },
      ],
      temperature: 0.25,
    });

    const parsed = extractJson(content);
    return normalizeDraft(parsed, t);
  }

  /** 動詞／形容詞詞性正規化（一段・五段・サ変・カ変／い・な） */
  function normalizeJaPosLabel(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const key = s.toLowerCase().replace(/\s+/g, "");

    // 動詞細分
    if (
      /一段|いちだん|ichidan|ru-?verb|る動詞/.test(s) ||
      key === "v1" ||
      key === "ichidan"
    ) {
      return "動詞・一段";
    }
    if (
      /五段|ごだん|godan|u-?verb|う動詞/.test(s) ||
      key === "v5" ||
      key === "godan"
    ) {
      return "動詞・五段";
    }
    if (/サ変|さへん|する動詞|suru|sahen|vs/.test(s) || key === "vs" || key === "sahen") {
      return "動詞・サ変";
    }
    if (/カ変|かへん|くる|来る|kuru|kahen|vk/.test(s) || key === "vk" || key === "kahen") {
      return "動詞・カ変";
    }
    if (/不規則|不規則動詞|irregular/.test(s) && /動|verb|v/.test(s)) {
      return "動詞・不規則";
    }

    // 形容詞細分
    if (/い形容|イ形容|i-?adj|けいようし・い|形容詞・い|形容詞い/.test(s) || key === "i-adj") {
      return "形容詞・い";
    }
    if (/な形容|ナ形容|na-?adj|けいようし・な|形容詞・な|形容詞な|形容動詞/.test(s) || key === "na-adj") {
      return "形容詞・な";
    }

    // 泛用詞性
    const map = {
      動: "動詞",
      動詞: "動詞",
      v: "動詞",
      verb: "動詞",
      形: "形容詞",
      形容詞: "形容詞",
      a: "形容詞",
      adj: "形容詞",
      adjective: "形容詞",
      名: "名詞",
      名詞: "名詞",
      n: "名詞",
      noun: "名詞",
      副: "副詞",
      副詞: "副詞",
      adv: "副詞",
      adverb: "副詞",
      代: "代詞",
      代詞: "代詞",
      代名詞: "代詞",
      數: "數詞",
      数詞: "數詞",
      數詞: "數詞",
      其他: "其他",
      その他: "其他",
      other: "其他",
    };
    if (map[key] || map[s]) return map[key] || map[s];

    // 已是完整標籤
    if (/^動詞・(一段|五段|サ変|カ変|不規則)$/.test(s)) return s;
    if (/^形容詞・[いな]$/.test(s)) return s;
    if (["名詞", "副詞", "代詞", "數詞", "其他"].includes(s)) return s;

    // 模糊：只寫動詞／形容詞（盡量保留，前端仍顯示）
    if (/動詞/.test(s)) return "動詞";
    if (/形容/.test(s)) return "形容詞";
    return s;
  }

  function normalizeInventory(data) {
    const summary = String(data?.summary || data?.u || "").trim();
    const translation = String(data?.translation || data?.t || "").trim();
    const rawItems = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.i)
        ? data.i
        : [];
    const items = rawItems
      .map((it) => {
        let name = String(it?.name || it?.n || "").trim();
        let nameZh = String(it?.nameZh || it?.z || "").trim();
        let nameJa = String(it?.nameJa || it?.nameKo || it?.j || it?.k || "").trim();
        if (!name && (nameZh || nameJa)) {
          name = nameJa ? `${nameZh || "文法"}（${nameJa}）` : nameZh;
        }
        if (!name) return null;
        let category = String(it?.category || it?.c || "").trim();
        if (!ALLOWED_INV_CAT.has(category)) category = "其他";
        let confidence = String(it?.confidence || it?.f || "medium").toLowerCase();
        if (confidence === "h") confidence = "high";
        if (confidence === "m") confidence = "medium";
        if (confidence === "l") confidence = "low";
        if (!["high", "medium", "low"].includes(confidence)) confidence = "medium";
        const row = {
          name,
          nameZh: nameZh || name,
          nameJa,
          category,
          span: String(it?.span || it?.s || "").trim(),
          note: String(it?.note || "").trim(),
          confidence,
        };
        // 本句手動校正欄位（選字套用／指定區間／手動定位）
        const source = String(it?.source || "").trim();
        if (source) row.source = source;
        const manualRuleId = String(it?.manualRuleId || "").trim();
        if (manualRuleId) row.manualRuleId = manualRuleId;
        if (it?.locatedManually) row.locatedManually = true;
        const start = Number(it?.start);
        const end = Number(it?.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          row.start = start;
          row.end = end;
        }
        return row;
      })
      .filter(Boolean);

    const rawVocab = Array.isArray(data?.vocab)
      ? data.vocab
      : Array.isArray(data?.v)
        ? data.v
        : [];
    const vocab = rawVocab
      .map((w) => {
        const surface = String(w?.surface || w?.s || "").trim();
        let lemma = String(w?.lemma || w?.l || w?.base || w?.dictionaryForm || "").trim();
        if (!surface && !lemma) return null;
        let gloss = String(w?.gloss || w?.g || w?.meaning || w?.translation || "").trim();
        let origin = String(
          w?.origin || w?.o || w?.etym || w?.sourceWord || w?.loan || w?.from || ""
        ).trim();
        // 若 gloss 已是「原文（中文）」而 origin 空，拆出原文
        if (!origin && gloss) {
          const m = gloss.match(
            /^([A-Za-zÀ-ÖØ-öø-ÿĀ-žА-яЁё][A-Za-zÀ-ÖØ-öø-ÿĀ-žА-яЁё0-9'’.\-\s]{0,40}?)\s*[（(]([^）)]{1,40})[）)]\s*$/
          );
          if (m) {
            origin = m[1].trim();
            gloss = m[2].trim();
          }
        }
        // origin 不應是假名／漢字句
        if (origin && /^[\u3040-\u30FF\u4E00-\u9FFFー]+$/.test(origin)) {
          origin = "";
        }
        const pos = normalizeJaPosLabel(w?.pos || w?.p || w?.partOfSpeech || "");
        let reading = String(
          w?.reading || w?.r || w?.yomi || w?.kana || w?.hiragana || w?.pronunciation || ""
        )
          .trim()
          .replace(/\s+/g, "");
        // 讀音只留假名
        if (reading && !/^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(reading)) {
          // 若混有漢字，盡量只抽出假名
          const onlyKana = reading.replace(/[^\u3040-\u309F\u30A0-\u30FFー]/g, "");
          reading = onlyKana || reading;
        }
        // 片假名 → 平假名（讀音統一平假名）
        if (reading) {
          reading = reading.replace(/[\u30A1-\u30F6]/g, (ch) =>
            String.fromCharCode(ch.charCodeAt(0) - 0x60)
          );
        }

        const surf = surface || lemma;
        // 不會變化的詞（名／副／代／數等）：不保留原形
        if (!posNeedsLemma(pos)) {
          if (!lemma || lemma === surf) lemma = "";
        } else if (!lemma) {
          // 活用詞若漏 lemma，不硬塞 surface（前端可只顯示 surface）
          lemma = "";
        } else if (lemma === surf && !/動詞|形容/.test(pos)) {
          lemma = "";
        }

        let start = w?.a != null ? Number(w.a) : w?.start != null ? Number(w.start) : NaN;
        let end = w?.b != null ? Number(w.b) : w?.end != null ? Number(w.end) : NaN;
        if (!Number.isFinite(start)) start = null;
        if (!Number.isFinite(end)) end = null;
        return {
          surface: surf,
          reading,
          lemma,
          origin,
          gloss,
          pos,
          start,
          end,
        };
      })
      .filter(Boolean);

    return { summary, translation, items, vocab };
  }

  /** 動詞／形容詞等會活用 → 需要原形；名詞等不需要 */
  function posNeedsLemma(pos) {
    const p = String(pos || "");
    return /動詞|形容詞/.test(p);
  }

  /**
   * 外來語意思顯示：原文（中文）
   * @param {{ origin?: string, gloss?: string }} w
   */
  function formatVocabGloss(w) {
    const origin = String(w?.origin || "").trim();
    const gloss = String(w?.gloss || "").trim();
    if (origin && gloss) {
      // 已是「origin（…）」則原樣
      if (gloss.startsWith(origin) && /[（(]/.test(gloss)) return gloss;
      // gloss 已含括號且像完整式
      if (/^[A-Za-zÀ-ÖØ-öø-ÿ].*[（(].+[）)]$/.test(gloss)) return gloss;
      return `${origin}（${gloss}）`;
    }
    if (origin) return origin;
    return gloss;
  }

  /** 僅單字／原形：短 prompt、不帶本地規則標題（省 tokens） */
  const VOCAB_ONLY_SYSTEM = `你是日語詞彙助教。只做實詞原形與簡義，不盤點文法。只輸出一個 JSON（無 markdown／圍欄）。

格式：
{"summary":"","translation":"整句繁中翻譯（單詞則給該詞義）","vocab":[{"surface":"表面形","reading":"平假名（有漢字必填）","lemma":"詞典形（僅活用詞）","origin":"外來語原文（非外來語空）","gloss":"簡短中文義","pos":"動詞・一段|動詞・五段|動詞・サ変|動詞・カ変|形容詞・い|形容詞・な|名詞|副詞|代詞|數詞|其他","start":0,"end":2}]}

規則：
1. 禁止輸出 items／文法盤點（活用、助詞、句型等一律不要）。
2. vocab 只列實詞；助詞・語尾不要進 vocab。
3. 有漢字必填 reading（平假名）；動詞・形容詞填 lemma 詞典形；名詞 lemma 空。
4. pos 須用完整標籤（動詞・五段 等）；同詞去重；gloss 短。
5. **外來語**（片假名借詞等）必填 origin＝來源語原文拼寫（coffee／Arbeit／pain 等），gloss 只寫繁中（咖啡／打工／麵包）；前端顯示 coffee（咖啡）。和語・漢語 origin 留空。`;

  /**
   * 查詢時文法盤點 + 詞彙原形
   * @param {string} query
   * @param {string[]} localTitles
   */
  async function inventoryGrammar(query, localTitles = []) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const titleList = (localTitles || []).slice(0, 200).join("\n") || "（尚無本地規則）";
    const content = await chatComplete({
      messages: [
        { role: "system", content: INVENTORY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n本地已有規則標題（若句中文法已在下列，name 請**逐字使用本地標題**，勿自創同義別名）：\n${titleList}\n\n請輸出 JSON：summary／translation／items／vocab。\nvocab：動詞標 一段・五段・サ変・カ変；形容詞標 い・な。\n有漢字的 surface 必須給 reading（平假名）。\n名詞／副詞等不變詞不要填 lemma；只有動詞・形容詞填 lemma（詞典形）。\n**外來語**（片假名等）必填 origin（原文如 coffee）與 gloss（僅中文如 咖啡）；非外來語 origin 空。`,
        },
      ],
      temperature: 0.2,
    });

    const parsed = extractJson(content);
    return normalizeInventory(parsed);
  }

  /**
   * 僅 API 單字（無文法盤點）：輕量請求，不傳本地規則標題
   * @param {string} query
   */
  async function inventoryVocabOnly(query) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const content = await chatComplete({
      messages: [
        { role: "system", content: VOCAB_ONLY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n只輸出 summary／translation／vocab（禁止 items）。有漢字填 reading；動詞・形容詞填 lemma 與完整 pos。外來語填 origin（原文）+ gloss（中文 only）。`,
        },
      ],
      temperature: 0.2,
    });

    const inv = normalizeInventory(extractJson(content));
    inv.items = [];
    if (!inv.summary) inv.summary = `API 單字：${(inv.vocab || []).length} 詞`;
    return inv;
  }

  /**
   * 單一選取詞的 AI 填寫（手動「單字解釋」用）
   * @param {string} surface
   * @param {string} [sentence]
   * @returns {Promise<object>} 單一 vocab 列
   */
  async function completeWordFromSurface(surface, sentence = "") {
    const surf = String(surface || "").trim();
    if (!surf) throw new Error("沒有選取的詞");
    const ctx = String(sentence || "").trim();
    const content = await chatComplete({
      messages: [
        {
          role: "system",
          content: `你是日語詞彙助教。使用者選定一個詞，請補齊詞彙資訊。只輸出一個 JSON（無 markdown）：
{"surface":"句中表面形","reading":"平假名（有漢字必填）","lemma":"詞典形（僅動詞・形容詞）","origin":"外來語原文（非外來語空）","gloss":"簡短繁中義","pos":"動詞・一段|動詞・五段|動詞・サ変|動詞・カ変|形容詞・い|形容詞・な|名詞|副詞|代詞|數詞|其他"}
規則：pos 用完整標籤；名詞 lemma 空；外來語 origin＋gloss（中文 only）。`,
        },
        {
          role: "user",
          content: ctx
            ? `選定詞：「${surf}」\n所在句子：${ctx}\n請依語境填寫該詞的 JSON。`
            : `選定詞：「${surf}」\n（無句子語境）請填寫該詞的 JSON。`,
        },
      ],
      temperature: 0.2,
    });
    const parsed = extractJson(content);
    const raw =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Array.isArray(parsed.vocab)
          ? parsed.vocab[0]
          : parsed.v && Array.isArray(parsed.v)
            ? parsed.v[0]
            : parsed
        : null;
    const inv = normalizeInventory({
      summary: "",
      translation: "",
      items: [],
      vocab: raw ? [raw] : [],
    });
    const w = (inv.vocab || [])[0];
    if (!w) throw new Error("AI 未回傳可用的單字資訊");
    if (!w.surface) w.surface = surf;
    return w;
  }

  async function testConnection() {
    const content = await chatComplete({
      messages: [
        { role: "system", content: "Reply with exactly: ok" },
        { role: "user", content: "ping" },
      ],
      temperature: 0,
    });
    return { ok: true, sample: String(content).slice(0, 80) };
  }

  return {
    getConfig,
    completeRuleFromTitle,
    completeWordFromSurface,
    inventoryGrammar,
    inventoryVocabOnly,
    normalizeInventory,
    normalizeJaPosLabel,
    posNeedsLemma,
    formatVocabGloss,
    testConnection,
  };
})();
