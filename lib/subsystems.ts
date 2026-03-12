import { IntentResult } from "../types";
import {
  postTodoTask,
  postDiaryNotification,
  getFinanceAiContext,
} from "./external-apis";
import { summarizeFinanceContext } from "./ai";

// ─────────────────────────────────────────────────────────────────────────────
// 轨道区分：读操作跳过确认按钮，写操作保留确认
// ─────────────────────────────────────────────────────────────────────────────

/** 需要用户点击确认才执行的意图（写操作） */
const WRITE_INTENTS = new Set(["todo", "diary"]);

/** 读操作意图：直接调用外部 API 并返回结果，不弹确认按钮 */
const READ_INTENTS = new Set(["finance"]);

/**
 * 判断该意图是否需要弹出确认按钮
 * - 写操作（todo, diary）：必须保留确认
 * - 读操作（finance）：跳过确认，直出结果
 */
export function shouldRequireConfirmation(intent: string): boolean {
  return WRITE_INTENTS.has(intent);
}

/**
 * 判断该意图是否为读操作（直出，不弹按钮）
 */
export function isReadIntent(intent: string): boolean {
  return READ_INTENTS.has(intent);
}

// ─────────────────────────────────────────────────────────────────────────────
// 外部 API 执行逻辑
// ─────────────────────────────────────────────────────────────────────────────

export async function processFinance(extractedInfo: string): Promise<string> {
  const result = await getFinanceAiContext();
  if (!result.success) {
    return result.error;
  }
  return await summarizeFinanceContext(result.data);
}

export async function processSelection(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - 选品系统待对接
  return `✅ 成功：🛍️ 选品内容已记录\n内容：[${extractedInfo}]`;
}

export async function processTodo(extractedInfo: string): Promise<string> {
  const result = await postTodoTask(extractedInfo);
  if (!result.success) {
    return result.error;
  }
  return `✅ 成功：📝 待办事项已添加\n内容：${extractedInfo}`;
}

export async function processDiary(extractedInfo: string): Promise<string> {
  const result = await postDiaryNotification(extractedInfo);
  if (!result.success) {
    return result.error;
  }
  return `✅ 成功：📔 日记内容已封存\n内容：${extractedInfo}`;
}

export async function processKnowledge(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位]
  return `✅ 成功：🧠 知识库已收录\n内容：[${extractedInfo}]`;
}

export async function processOperations(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位]
  return `✅ 成功：⚙️ 运营指令已执行\n内容：[${extractedInfo}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 意图名称映射
// ─────────────────────────────────────────────────────────────────────────────

const intentNames: Record<string, string> = {
  finance: "📊 财经资讯",
  selection: "🛍️ 跨境选品",
  todo: "📝 待办事项",
  diary: "📔 个人日记",
  knowledge: "🧠 知识库",
  operations: "⚙️ 店铺运营",
  unknown: "❓ 未知类型",
};

// ─────────────────────────────────────────────────────────────────────────────
// 构建确认提示（仅用于写操作：todo, diary 等）
// 读操作（finance）不调用此函数
// ─────────────────────────────────────────────────────────────────────────────

export function buildIntentConfirmation(result: IntentResult): { text: string; replyMarkup: any } {
  console.log(`[路由] 构建确认提示: "${result.intent}"，提取信息: "${result.extracted_info}"`);

  const intentName = intentNames[result.intent] || intentNames["unknown"];

  if (result.intent === "unknown") {
    return {
      text: `🤖 无法识别的内容类型\n📌 提取内容：\n${result.extracted_info}\n\n请选择后续操作：`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "🔄 重试解析", callback_data: "retry_process" }],
          [{ text: "📔 强制存入日记", callback_data: "exec_diary" }],
          [{ text: "❌ 取消", callback_data: "cancel" }],
        ],
      },
    };
  }

  return {
    text: `🤖 识别类型：${intentName}\n📌 提取内容：\n${result.extracted_info}\n\n请确认是否执行？`,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "✅ 确认执行", callback_data: `exec_${result.intent}` }],
        [{ text: "❌ 取消", callback_data: "cancel" }],
      ],
    },
  };
}

/**
 * 实际执行子系统逻辑（写操作由用户点击确认后触发，读操作由 route 直接调用）
 */
export async function executeIntentFunction(intent: string, extractedInfo: string): Promise<string> {
  console.log(`[执行] 执行意图: "${intent}"，内容: "${extractedInfo}"`);
  switch (intent) {
    case "finance":
      return await processFinance(extractedInfo);
    case "selection":
      return await processSelection(extractedInfo);
    case "todo":
      return await processTodo(extractedInfo);
    case "diary":
      return await processDiary(extractedInfo);
    case "knowledge":
      return await processKnowledge(extractedInfo);
    case "operations":
      return await processOperations(extractedInfo);
    default:
      console.warn(`[执行] ⚠️ 未知执行意图: ${intent}`);
      return `❌ 执行失败，未知意图：${intent}`;
  }
}
