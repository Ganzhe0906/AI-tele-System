const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/**
 * 为财务报告等长文本启用 HTML 格式，突出关键数字
 * 将 $ 金额和 XX% 包裹为 <b>，并转义 & < >
 */
export function formatReportForTelegram(text: string): string {
  const boldMatches: string[] = [];
  const placeholder = (i: number) => `\uE000${i}\uE001`; // 私有区字符，避免与正文冲突
  let out = text
    .replace(/\$[-]?[\d,]+\.?\d*/g, (m) => {
      boldMatches.push(m);
      return placeholder(boldMatches.length - 1);
    })
    .replace(/(\d+\.?\d*)%/g, (m) => {
      boldMatches.push(m);
      return placeholder(boldMatches.length - 1);
    });
  out = out.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (let i = boldMatches.length - 1; i >= 0; i--) {
    out = out.split(placeholder(i)).join(`<b>${boldMatches[i]}</b>`);
  }
  return out;
}

/**
 * 发送文本消息
 * @param parseMode 可选 "HTML"，用于财务报告等需强调数字的场景
 */
export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: any,
  replyToMessageId?: number,
  parseMode?: "HTML"
) {
  const url = `${TELEGRAM_API_URL}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text,
    ...(parseMode && { parse_mode: parseMode }),
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  
  if (replyToMessageId) {
    // 兼容 Telegram Bot API 的不同版本
    // 新版本使用 reply_parameters，旧版本使用 reply_to_message_id
    body.reply_parameters = { message_id: replyToMessageId };
    body.reply_to_message_id = replyToMessageId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Telegram] ❌ 消息发送失败 ${chatId}:`, errorText);
    
    // 如果是因为找不到被回复的消息（通常发生在测试环境中，或者消息已被删除）
    // 则重试发送，但不带 reply_to_message_id
    if (replyToMessageId && errorText.includes("message to be replied not found")) {
      console.warn(`[Telegram] ⚠️ 找不到要回复的消息 ${replyToMessageId}，将作为普通消息发送`);
      return sendMessage(chatId, text, replyMarkup, undefined, parseMode); // 不传 replyToMessageId 重试
    }
    
    throw new Error("Failed to send message to Telegram");
  }

  const result = await response.json();
  console.log(`[Telegram] 📤 消息已发送至 ${chatId}, 消息ID: ${result.result?.message_id}`);
  return result;
}

/**
 * 编辑已发送的消息
 * @param parseMode 可选 "HTML"，用于财务报告等
 */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any,
  parseMode?: "HTML"
) {
  const url = `${TELEGRAM_API_URL}/editMessageText`;
  const body: any = {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(parseMode && { parse_mode: parseMode }),
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Telegram] ❌ 编辑消息失败 ${messageId}:`, errorText);
    
    // 如果编辑消息失败是因为消息未找到 (比如在前端模拟测试时，返回的占位消息 ID 可能是捏造的)
    // 或者该消息已被用户删除，则尝试将内容作为一条新消息发送
    if (errorText.includes("message to edit not found") || errorText.includes("message not found")) {
      console.warn(`[Telegram] ⚠️ 找不到要编辑的消息 ${messageId}，将作为新消息发送给用户 ${chatId}`);
      return sendMessage(chatId, text, replyMarkup, undefined, parseMode);
    }
    
    throw new Error("Failed to edit message in Telegram");
  }

  console.log(`[Telegram] ✏️ 消息已编辑 ${messageId}`);
  return response.json();
}

/**
 * 回复 Callback Query（关闭加载状态等）
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  const url = `${TELEGRAM_API_URL}/answerCallbackQuery`;
  const body: any = {
    callback_query_id: callbackQueryId,
  };

  if (text) {
    body.text = text;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`[Telegram] ❌ 回应回调查询失败 ${callbackQueryId}:`, await response.text());
    return { ok: false };
  }

  console.log(`[Telegram] 回调查询已回应: ${callbackQueryId}`);
  return response.json();
}

/**
 * 获取文件 URL (用于下载语音)
 */
export async function getFileUrl(fileId: string): Promise<string> {
  const url = `${TELEGRAM_API_URL}/getFile`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });

  if (!response.ok) {
    throw new Error("Failed to get file info");
  }

  const data = await response.json();
  const filePath = data.result.file_path;

  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
}
