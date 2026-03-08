const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/**
 * 发送文本消息
 */
export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: any,
  replyToMessageId?: number
) {
  const url = `${TELEGRAM_API_URL}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text,
    // parse_mode: "HTML",
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  
  if (replyToMessageId) {
    body.reply_parameters = { message_id: replyToMessageId };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`[Telegram] ❌ 消息发送失败 ${chatId}:`, await response.text());
    throw new Error("Failed to send message to Telegram");
  }

  const result = await response.json();
  console.log(`[Telegram] 📤 消息已发送至 ${chatId}, 消息ID: ${result.result?.message_id}`);
  return result;
}

/**
 * 编辑已发送的消息
 */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any
) {
  const url = `${TELEGRAM_API_URL}/editMessageText`;
  const body: any = {
    chat_id: chatId,
    message_id: messageId,
    text,
    // parse_mode: "HTML",
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
    console.error(`[Telegram] ❌ 编辑消息失败 ${messageId}:`, await response.text());
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
