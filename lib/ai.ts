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
 * 适配新 API 结构：优先使用 store + topSkus，兼容旧扁平字段
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

  const prompt = `你是 TikTok 资深电商店铺财务分析师。请根据以下财务快照数据，输出一份在手机/Telegram 上易读的财务诊断报告。

【重要规则】
1. 所有金额单位均为美元(USD)，用「美元」或「$」，严禁「元」或「人民币」。
2. 直接输出正文，无寒暄语。
3. 输出为纯文本，适配 Telegram 等即时通讯：
   - 用空行分段，每段 2-3 行，不要大块长段。
   - 用小标题（如「📊 一、店铺整体」）分隔，不用 ### 或 **。
   - 关键数字单独成行或用短句，便于扫读。
   - 总字数 450 字内，精炼直击痛点。

【数据结构】优先使用 store + topSkus（新规整结构），若无则用扁平字段兜底。

• store（全店汇总）：
  revenue（营收）, orderProfit（订单利润，未扣任何支出）, orderCount（订单数）
  支出项：adSpend, storageFee, inboundFee, jointMarketingFee, monthlyOperatingExpenses, sampleProductCost, sampleShippingCost
  结果：estimatedNetProfit / finalNetProfit（净利 = 订单利润 - 上述全部支出）

• topSkus（单量前 10 重点 SKU，每项）：
  name, productName, qty（销量）, profit（订单利润，未扣广告）, sampleCost（样品费）, adCost, adROI, affiliatePct（达人占比%）
  若有 netProfit 字段则直接使用，否则单品净利 ≈ profit - adCost - sampleCost

• 兜底扁平字段：estimatedRevenue, estimatedOrderProfit, adSpend, profitBySku, adCostBySku, affiliateRankingData

【报告结构】必须严格按以下格式输出：

📊 一、店铺整体
1. 盈利计算过程（按顺序列出，每项带具体数字）：
   订单盈利 $X → 减 样品支出 $X → 减 广告支出 $X → 减 经营/仓储/入库/合资等 $X → 最终净利 $X
   （若某项为 0 或缺失可省略，但顺序保持）
2. 盈亏判断与 ROI（营收/广告费）、问题诊断（1-2 句）。

📦 二、单品 Top3 明细
必须逐条列出前三名 SKU，每条格式：
  • 【SKU名】订单利润 $X，样品 $X，广告 $X，达人占比 X%；扣广告后（盈利/亏损）$X。
（三条都要列数据，不得省略）

👥 三、达人情况
简述达人依赖度与健康度（若有数据）。

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
