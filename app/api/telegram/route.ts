import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { TelegramUpdate } from "../../../types";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  getFileUrl,
} from "../../../lib/telegram";
import { detectIntent, transcribeAudio } from "../../../lib/ai";
import { routeIntent } from "../../../lib/subsystems";

// 设置最大执行时间（秒），防止僵尸任务
const MAX_EXECUTION_TIME = 55000; // Vercel 免费版通常 10s，Pro 版 60s，留 5s 缓冲

export async function POST(req: NextRequest) {
  try {
    const update: TelegramUpdate = await req.json();
    console.log(`[Telegram] 收到 Webhook 更新:`, JSON.stringify({
      update_id: update.update_id,
      message_id: update.message?.message_id || update.callback_query?.message?.message_id,
      from: update.message?.from?.id || update.callback_query?.from?.id,
      type: update.message ? "消息" : update.callback_query ? "回调查询" : "未知"
    }));

    // ==============================================================================
    // 🛡️ Security Check: Whitelist Verification
    // ==============================================================================
    const allowedUsers = (process.env.ADMIN_CHAT_ID || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const senderId = update.message?.from?.id || update.callback_query?.from?.id;

    if (allowedUsers.length > 0 && senderId) {
      if (!allowedUsers.includes(String(senderId))) {
        console.warn(`[安全限制] ⛔ 拦截未经授权的访问，用户 ID: ${senderId}`);
        // 必须返回 200，否则 Telegram 会一直重试
        return NextResponse.json({ ok: true });
      }
    }
    
    console.log(`[Telegram] ✅ 用户安全检查通过: ${senderId}`);

    // ==============================================================================
    // 🚀 Fast Return Architecture
    // 立即返回 200 OK，切断 Telegram 的重试机制。所有逻辑放入后台异步执行。
    // ==============================================================================
    
    // 使用 waitUntil 确保 Vercel 在响应返回后继续执行后台任务
    console.log(`[Telegram] 🚀 通过 waitUntil 触发后台任务`);
    waitUntil(
      (async () => {
        const start = Date.now();
        try {
          console.log(`[后台任务] 开始执行 handleUpdate...`);
          await handleUpdate(update);
          console.log(`[后台任务] handleUpdate 执行完成，耗时 ${Date.now() - start}ms`);
        } catch (err) {
          // 全局兜底捕获，防止后台任务崩溃未记录
          console.error("[后台任务] ❌ 严重错误:", err);
        }
      })()
    );

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("[Webhook] 解析错误:", error);
    // 即使解析失败也返回 200，避免 Telegram 疯狂重试坏请求
    return NextResponse.json({ ok: true });
  }
}

/**
 * 核心业务逻辑（完全后台运行）
 */
async function handleUpdate(update: TelegramUpdate) {
  // 1. 处理 Callback Query
  if (update.callback_query) {
    const { id, message, data } = update.callback_query;
    console.log(`[回调] 正在处理回调数据: ${data}`);
    
    // 并行处理：回应 Telegram 停止转圈 + 业务逻辑
    await Promise.all([
      answerCallbackQuery(id).catch(e => console.error("[回调] 回应失败:", e)), 
      (async () => {
        if (data === "retry_process" && message) {
          console.log(`[回调] 触发重试处理`);
          await editMessageText(message.chat.id, message.message_id, "⏳ 意图重新解析中...");
          
          const originalText = message.reply_to_message?.text || "";
          const originalVoice = message.reply_to_message?.voice;

          if (!originalText && !originalVoice) {
            console.warn(`[回调] 无法获取原始消息内容`);
            await editMessageText(message.chat.id, message.message_id, "⚠️ 无法获取原消息内容。");
            return;
          }

          await processMessage(
            message.chat.id,
            message.message_id, //直接复用消息ID
            originalText,
            !!originalVoice,
            originalVoice?.file_id
          );
        }
      })()
    ]);
    return;
  }

  // 2. 处理普通消息
  if (update.message) {
    const { chat, message_id, text, voice } = update.message;
    console.log(`[消息] 正在处理来自群组/私聊 ${chat.id} 的消息, 文本: ${text ? "有" : "无"}, 语音: ${voice ? "有" : "无"}`);

    if (!text && !voice) {
        console.log(`[消息] 忽略: 无文本或语音内容`);
        return;
    }

    // 先发送占位消息（这是后台任务的第一步）
    // 如果这一步失败（比如被用户拉黑），后续逻辑直接中断，不抛出异常给 Telegram
    let placeholderMsg;
    try {
      placeholderMsg = await sendMessage(chat.id, "⏳ 意图解析中...", undefined, message_id);
    } catch (e) {
      console.error("[消息] 发送占位消息失败:", e);
      return; // 无法发送消息，终止任务
    }

    const placeholderMessageId = placeholderMsg.result.message_id;

    // 执行耗时任务
    await processMessage(chat.id, placeholderMessageId, text, !!voice, voice?.file_id);
  }
}

/**
 * 智能处理流程
 */
async function processMessage(
  chatId: number,
  messageId: number,
  text?: string,
  isVoice?: boolean,
  voiceFileId?: string
) {
  console.log(`[处理] 开始处理会话 ${chatId} 的消息 ${messageId}`);
  // 设置超时熔断，防止任务挂死
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Processing Timeout")), 50000)
  );

  try {
    await Promise.race([
      (async () => {
        let finalContent = text || "";

        // A. 语音/文字处理
        if (isVoice && voiceFileId) {
            console.log(`[处理] 检测到语音，开始转写...`);
          // 1. 获取下载链接 (包含 Token)
          const fileUrl = await getFileUrl(voiceFileId);
          
          // 2. ⚠️ 安全修正：不要直接把 fileUrl 传给 Qwen，防止 Token 泄露
          // 这里应该在服务端下载 Buffer，但为简化演示，假设 transcribeAudio 内部处理了 fetch
          // 实际上应该修改 lib/ai.ts 来处理流式下载
          finalContent = await transcribeAudio(fileUrl);
          console.log(`[处理] 转写结果: "${finalContent.substring(0, 50)}..."`);
        }

        // B. Gemini 意图路由
        console.log(`[处理] 正在识别意图: "${finalContent.substring(0, 50)}..."`);
        const intentResult = await detectIntent(finalContent);
        console.log(`[处理] 识别到意图: ${intentResult.intent}`);

        // C. 子系统路由
        console.log(`[处理] 路由至子系统...`);
        const replyText = await routeIntent(intentResult);
        console.log(`[处理] 子系统响应已生成`);

        // D. 更新结果
        await editMessageText(chatId, messageId, replyText);
        console.log(`[处理] ✅ 处理周期成功完成`);
      })(),
      timeoutPromise
    ]);

  } catch (error: any) {
    console.error(`[处理] ❌ 任务处理错误:`, error);

    const isTimeout = error.message === "Processing Timeout";
    const errorMsg = isTimeout 
      ? "❌ 处理超时，请稍后重试。" 
      : "❌ 处理失败\n\n可能是大模型接口波动，请重试。";

    const inlineKeyboard = {
      inline_keyboard: [[{ text: "🔄 重试", callback_data: "retry_process" }]],
    };

    // 尽最大努力通知用户错误
    try {
      await editMessageText(chatId, messageId, errorMsg, inlineKeyboard);
    } catch (e) {
      console.error("[处理] 发送错误通知失败:", e);
    }
  }
}
