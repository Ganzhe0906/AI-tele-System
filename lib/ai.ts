import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { IntentResult } from "../types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const QWEN_API_KEY = process.env.QWEN_API_KEY!;

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * 意图识别 (Gemini Flash)
 */
export async function detectIntent(text: string): Promise<IntentResult> {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  // Define Schema for forced JSON output
  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      intent: {
        type: SchemaType.STRING,
        description:
          "The categorized intent. Must be one of: finance, selection, todo, diary, knowledge, operations",
        enum: [
          "finance",
          "selection",
          "todo",
          "diary",
          "knowledge",
          "operations",
          "unknown",
        ],
      },
      extracted_info: {
        type: SchemaType.STRING,
        description: "The main entity or action extracted from the user's text",
      },
    },
    required: ["intent", "extracted_info"],
  };

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview", 
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema as any,
      temperature: 0.1, 
    },
  });

  const prompt = `
  You are an intent routing AI. Analyze the user text and categorize it into exactly one of the defined intents. 
  Extract the key information.
  
  Intents:
  - finance: 财经资讯，如 Polymarket 赔率、股票基金投资、美股大盘等（不包含自家店铺的财务/利润数据）。
  - selection: 跨境电商选品，如抓取爆款玩具/节庆品数据、分析竞品利润、记录货品打分。
  - todo: 待办事项，如提醒发货、补充仓库耗材。
  - diary: 个人日记记录，情绪复盘，每日总结。
  - knowledge: 知识库管理，如分析微信跨境群聊干货、提炼小红书/抖音爆款运营思路。
  - operations: TikTok 电商店铺运营与数据查询，包含具体店铺（如 Miamax 等）的利润/财务数据大盘查询，以及多台手机群控调度、视频播放互动数据、达人建联管理等。
  - unknown: 如果输入内容不属于以上任何一种，或无法确定其意图，请使用 unknown。不要强行归类。

  User Text: "${text}"
  `;

  console.log(`[AI] 🤖 正在向 Gemini 发送 Prompt... 长度: ${prompt.length}`);
  const startTime = Date.now();
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const usage = result.response.usageMetadata;
  
  console.log(`[AI] ✅ Gemini 响应完成，耗时 ${Date.now() - startTime}ms`);
  
  if (usage) {
    console.log(`[AI] 📊 Token统计 - 输入: ${usage.promptTokenCount}, 输出: ${usage.candidatesTokenCount}, 总计: ${usage.totalTokenCount}`);
  }
  
  try {
    const parsed = JSON.parse(responseText);
    console.log(`[AI] 识别意图: ${parsed.intent}`);
    return {
      ...parsed,
      usage: usage ? {
        inputTokens: usage.promptTokenCount,
        outputTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
      } : undefined
    } as IntentResult;
  } catch (err) {
    console.error("[AI] ❌ 解析 Gemini 响应失败:", responseText);
    return {
      intent: "unknown",
      extracted_info: "Unable to process text.",
    };
  }
}

/**
 * 语音转文字 (Qwen ASR / DashScope)
 * @param fileUrl Telegram 语音文件的远程地址
 */
export async function transcribeAudio(fileUrl: string): Promise<string> {
  if (!QWEN_API_KEY) {
    console.warn("[AI] 缺失 QWEN_API_KEY，返回模拟转写内容。");
    return "这是模拟转写的语音内容 (未配置 QWEN_API_KEY)";
  }

  try {
    // 1. 先把 Telegram 的音频拉到 Vercel 内存里
    const audioRes = await fetch(fileUrl);
    if (!audioRes.ok) {
      throw new Error(`无法从 Telegram 下载音频: ${audioRes.status}`);
    }
    const arrayBuffer = await audioRes.arrayBuffer();
    // 2. 转成 Base64 数据流 (Telegram 默认语音是 ogg 格式)
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const base64DataUri = `data:audio/ogg;base64,${base64Audio}`;

    console.log(`[AI] 🎙️ 音频下载完成。大小: ${arrayBuffer.byteLength} 字节。正在发送至通义千问...`);
    const startTime = Date.now();

    // 3. 发给阿里云的不再是 URL，而是纯数据流
    const DASH_SCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    
    const response = await fetch(DASH_SCOPE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${QWEN_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-audio-asr", // "qwen-audio-asr" 是 Qwen3-ASR-Flash 的模型 ID
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "input_audio", 
                input_audio: { 
                  data: base64DataUri // <--- 关键修改：传 Base64 数据，保护 Token
                } 
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ASR API 错误: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[AI] ✅ 通义千问 ASR 响应完成，耗时 ${Date.now() - startTime}ms`);
    return data.choices?.[0]?.message?.content || "未识别到语音内容";
  } catch (error) {
    console.error("[AI] ❌ 通义千问 ASR 失败:", error);
    return "语音转文字异常";
  }
}

/**
 * 将用户自然语言（如「三月份Miamax的大盘利润」）解析为财务 API 所需参数
 * @param extractedInfo 意图提取的文本
 * @param shops 店铺列表（来自 getFinanceShopList）
 * @returns { shopId, month } 或 null（解析失败）
 */
export async function resolveOperationsParams(
  extractedInfo: string,
  shops: { shopId: string; shopName: string }[]
): Promise<{ shopId: string; month: string } | null> {
  if (!GEMINI_API_KEY || shops.length === 0) {
    return null;
  }

  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      shopId: { type: SchemaType.STRING, description: "The shopId from the provided list" },
      month: { type: SchemaType.STRING, description: "YYYY-MM format, e.g. 2026-03" },
    },
    required: ["shopId", "month"],
  };

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema as any,
      temperature: 0.1,
    },
  });

  const shopsJson = JSON.stringify(shops, null, 2);
  const prompt = `你是一个参数解析助手。用户说：「${extractedInfo}」

可选店铺列表（必须从中选择最匹配的一个 shopId）：
${shopsJson}

任务：
1. 从用户表述中推断月份，转换为 YYYY-MM 格式。若未提及月份，用当前月份 ${new Date().toISOString().slice(0, 7)}。
2. 从上述店铺列表中选出与用户所指最接近的店铺，返回其 shopId（不是 shopName）。

仅返回 JSON：{"shopId":"xxx","month":"YYYY-MM"}`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());
    if (parsed?.shopId && parsed?.month) {
      return { shopId: parsed.shopId, month: parsed.month };
    }
  } catch (err) {
    console.error("[AI] resolveOperationsParams 解析失败:", err);
  }
  return null;
}

/**
 * 将财务 API 返回的 JSON 转化为自然语言业务总结
 * 用于轨道二（读操作）直出给用户
 */
export async function summarizeFinanceContext(rawData: unknown): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "❌ AI 服务未配置。";
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
      temperature: 0.3,
    },
  });

  const prompt = `你是一个财经助理。请根据以下财务 API 返回的 JSON 数据，用简洁自然的语言总结出关键信息，方便用户快速了解大盘/市场概况。
- 突出重点数据（如涨跌、指数、重要事件）
- 控制在一段话内，不超过 300 字
- 使用中文

原始数据（JSON）：
${JSON.stringify(rawData)}
`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return text?.trim() || "暂无财务摘要。";
  } catch (err) {
    console.error("[AI] Gemini 财务摘要失败:", err);
    return "❌ 财务数据解析失败，请稍后再试。";
  }
}
