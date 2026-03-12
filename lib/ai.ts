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
3. 盈利/正数用 🟢 前缀，亏损/扣除/支出用 🔴 前缀，便于扫读。
4. 用空行分段，每段 2-3 行，小标题（如「📊 一、店铺整体」）分隔。
5. 总字数 650 字内，精炼直击痛点。

【数据结构】优先使用 store + topSkus（新规整结构），若无则用扁平字段兜底。

• store（全店汇总）— 利润口径：orderProfit 为「未扣除样品费」的订单层利润
  revenue, orderProfit, orderCount
  支出项：sampleProductCost + sampleShippingCost, adSpend, storageFee, inboundFee, jointMarketingFee, monthlyOperatingExpenses
  公式：orderProfit − 样品 − 广告 − 其它 = finalNetProfit
  全店 ROI：计算 (revenue / adSpend)

• topSkus（单量前 10 重点 SKU）：name, productName, qty, profit, sampleCost, adCost, adROI, affiliatePct
  单品净利 ≈ profit − sampleCost − adCost
  单品广告盈利比：计算 (profit / adCost)，衡量1美元广告费产出多少毛利

【诊断标准】
1. 店铺维度 ROI (营收/广告费)：
   - < 3：不及格
   - 3-5：及格
   - 6-8：良好
   - > 8：优秀
   - 诊断逻辑：若全店 ROI 不佳导致亏损，指出是广告问题；若全店 ROI 优秀但最终仍未盈利（或利润很低），必须指出是被其它支出（如样品费、经营费等）拖垮。
2. 单品广告盈利比 (profit/adCost)：
   - < 0 (即利润为负)：不及格
   - 0-1：一般
   - 1-2：良好
   - > 2：优秀

【报告结构】必须严格按以下格式，不要输出「三、达人情况」：

📊 一、店铺整体
1. 盈利计算过程（每项前加 🟢 盈利或 🔴 扣除）：
   🟢 订单盈利 $X
   🔴 减 样品支出 $X
   🔴 减 广告支出 $X
   🔴 减 经营/仓储/入库等 $X（若为 0 可省略）
   🟢/🔴 最终净利 $X（盈利用🟢，亏损用🔴）
2. 盈亏判断与问题诊断（1-2 句）：
   列出全店 ROI 并评价（不及格/及格/良好/优秀）。根据上述诊断标准，指出亏损或利润薄的根本原因（是广告拉垮，还是样品/其他支出过高）。

📦 二、单品 Top8 明细
必须逐条列出前八名 SKU，去掉繁琐的圆圈，仅在行首标识最终盈亏状态，格式如下：
  • 🟢/🔴【SKU名】利润 $X | 样品 $X | 广告 $X | 广告盈利比 X | 净利 $X
    ↳ 简评：根据广告盈利比评价（一般/良好/优秀/不及格），并一句话指出健康度（如：健康/被样品吃掉利润/广告产出极低/单单亏损等）。

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
