import { IntentResult } from "../types";

export async function processFinance(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - e.g., fetch("https://api.finance.system/...")
  // await new Promise((r) => setTimeout(r, 1000));
  return `📊 财经内容已处理：[${extractedInfo}]`;
}

export async function processSelection(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - e.g., fetch("https://api.ecommerce.system/...")
  return `🛍️ 选品内容已记录：[${extractedInfo}]`;
}

export async function processTodo(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - e.g., fetch("https://api.todoist.system/...")
  return `✅ 待办事项已添加：[${extractedInfo}]`;
}

export async function processDiary(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - e.g., fetch("https://api.notion.system/...")
  return `📔 日记内容已封存：[${extractedInfo}]`;
}

export async function processKnowledge(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - e.g., fetch("https://api.obsidian.system/...")
  return `🧠 知识库已收录：[${extractedInfo}]`;
}

export async function processOperations(extractedInfo: string): Promise<string> {
  // [外部 API 调用占位] - e.g., fetch("https://api.internal.system/...")
  return `⚙️ 运营指令已执行：[${extractedInfo}]`;
}

/**
 * 路由调度器
 */
export async function routeIntent(result: IntentResult): Promise<string> {
  console.log(`[路由] 正在调度意图: "${result.intent}"，提取信息: "${result.extracted_info}"`);
  switch (result.intent) {
    case "finance":
      return await processFinance(result.extracted_info);
    case "selection":
      return await processSelection(result.extracted_info);
    case "todo":
      return await processTodo(result.extracted_info);
    case "diary":
      return await processDiary(result.extracted_info);
    case "knowledge":
      return await processKnowledge(result.extracted_info);
    case "operations":
      return await processOperations(result.extracted_info);
    default:
      console.warn(`[路由] ⚠️ 未知意图: ${result.intent}`);
      return `❓ 无法识别的意图：[${result.extracted_info}]`;
  }
}
