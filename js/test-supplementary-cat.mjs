/**
 * 補充用法不可被盤點／AI 正規化洗成「其他」
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "ai.js"), "utf8");

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("ok", msg);
}

const ctx = {
  Storage: {
    loadSettings() {
      return {};
    },
    DEFAULT_SETTINGS: { baseUrl: "https://api.x.ai/v1" },
  },
  console,
};
vm.createContext(ctx);
vm.runInContext(`${code}\nthis.__Ai = AiService;`, ctx);
const Ai = ctx.__Ai;

const inv = Ai.normalizeInventory({
  items: [
    {
      name: "禁止（な）",
      category: "補充用法",
      span: "",
      source: "manual",
      manualRuleId: "r_supp",
    },
  ],
});
const it = inv.items[0];
if (!it) fail("inventory item dropped");
if (it.category !== "補充用法") fail(`category rewritten to ${it.category}`);
if (it.manualRuleId !== "r_supp") fail("manualRuleId lost");
ok("normalizeInventory keeps 補充用法");

const draft = Ai.normalizeDraft(
  { title: "禁止（な）", category: "句型", explanation: "說明" },
  "禁止（な）",
  { keepCategory: "補充用法" }
);
if (draft.category !== "補充用法") fail(`draft category ${draft.category}`);
ok("normalizeDraft keepCategory locks 補充用法");

console.log("all ok");
