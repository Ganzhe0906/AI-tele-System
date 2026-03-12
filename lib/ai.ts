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
  const validShopIds = shops.map((s) => s.shopId).join(", ");
  const prompt = `你是一个参数解析助手。用户说：「${extractedInfo}」

可选店铺列表（shopId 与 shopName 对照，必须从中选择）：
${shopsJson}

规则：
1. 月份：从用户表述推断，转成 YYYY-MM。未提及则用 ${new Date().toISOString().slice(0, 7)}。
2. 店铺：用户可能说简称（如 Miamax、MiaMax）或全名（如 MiaMaxPlayPicks）。你必须从列表中选择与用户所指最匹配的店铺，返回该店铺的 shopId 原值。
3. shopId 必须是上述列表中的精确值之一（${validShopIds}），禁止自造或使用列表中不存在的值。

仅返回 JSON：{"shopId":"列表中的精确shopId","month":"YYYY-MM"}`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());
    if (parsed?.shopId && parsed?.month) {
      // 校验 shopId 必须在列表中，防止 Gemini 幻觉
      const validIds = new Set(shops.map((s) => s.shopId));
      if (validIds.has(parsed.shopId)) {
        return { shopId: parsed.shopId, month: parsed.month };
      }
      console.warn(`[AI] resolveOperationsParams 返回了非法 shopId: ${parsed.shopId}，不在列表中`);
    }
  } catch (err) {
    console.error("[AI] resolveOperationsParams 解析失败:", err);
  }
  return null;
}

/**
 * 将财务 API 返回的 JSON 转化为自然语言业务报告
 * 用于轨道二（读操作）直出给用户，含店铺维度分析与单品维度诊断
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

  const prompt = `你是 TikTok 资深电商店铺财务分析师。请根据以下财务快照数据，输出一份结构化、专业的财务诊断报告。

【重要规则】
1. 数据中所有金额单位均为美元(USD)，输出时请使用「美元」或「$」，严禁使用「元」或「人民币」。
2. 请直接输出报告正文，不要有“你好”、“这是您的报告”等寒暄语。
3. 报告需分层次展现，结构清晰，可使用 Markdown 格式（如加粗、列表）。
4. 整体字数控制在 400 字以内，语言精炼、直击痛点。

【数据结构说明】
- estimatedRevenue: 预估营收 (USD)
- estimatedOrderProfit: 预估订单毛利 (USD)
- adSpend: 广告消耗 (USD)
- orderCount: 订单总数
- estimatedNetProfit / finalNetProfit: 净利 (USD) 
- exchangeRate: 当月汇率（如 7 表示 1 美元≈7 人民币）
- profitBySku: 利润贡献 Top SKU，value 为美元
- adCostBySku: 广告消耗 Top SKU，value 为美元
- affiliateRankingData: 达人出单占比 (affiliateCount: 达人出单数, totalCount: 总订单, percentage: 达人占比)

【报告结构要求】
### 一、店铺整体表现
1. 核心指标：列出营收、订单数、广告费、最终净利。
2. 盈利诊断：明确指出本月是盈利还是亏损；计算全店 ROI (预估营收 / 广告消耗) 或利润率；简要分析问题可能出在哪里（如广告费占比过高、订单毛利不足等）。

### 二、单品与广告分析
1. 结合 \`profitBySku\` 与 \`adCostBySku\` 找出：
   - 核心利润款（利润高、广告占比合理）。
   - 亏损或低效款（广告费很高但利润贡献极低，甚至扣除广告后不盈利）。
2. 给出针对单品广告投放的优化建议。

### 三、达人建联情况 (若有 \`affiliateRankingData\`)
简述哪些 SKU 严重依赖达人出单，或者整体的达人出单占比健康度。

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
