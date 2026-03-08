// Telegram Webhook Payload Types
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    language_code?: string;
  };
  chat: {
    id: number;
    first_name: string;
    username?: string;
    type: string;
  };
  date: number;
  text?: string;
  voice?: TelegramVoice;
}

export interface TelegramVoice {
  duration: number;
  mime_type: string;
  file_id: string;
  file_unique_id: string;
  file_size: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramMessage["from"];
  message?: TelegramMessage;
  chat_instance: string;
  data: string;
}

// Internal System Types
export type IntentType =
  | "finance"
  | "selection"
  | "todo"
  | "diary"
  | "knowledge"
  | "operations"
  | "unknown";

export interface IntentResult {
  intent: IntentType;
  extracted_info: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  userId: number;
  username?: string;
  type: "text" | "voice";
  intent: IntentType;
  status: "success" | "error" | "processing";
  extractedInfo: string;
}