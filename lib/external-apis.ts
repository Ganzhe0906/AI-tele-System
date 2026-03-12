/**
 * 外部系统 API 封装
 * 统一处理超时、异常和兜底提示
 */

const DEFAULT_TIMEOUT_MS = 15000; // 15 秒超时

type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * 带超时的 fetch 封装
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      throw new Error("请求超时");
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 轨道一：写操作 API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 待办 - 向日记网提交任务
 * POST {DIARY_DOMAIN}/api/external/tasks
 */
export async function postTodoTask(text: string): Promise<ApiResult<unknown>> {
  const baseUrl = process.env.DIARY_DOMAIN?.replace(/\/$/, "");
  const apiKey = process.env.EXTERNAL_TASKS_API_KEY;

  if (!baseUrl || !apiKey) {
    console.warn("[External] 缺少 DIARY_DOMAIN 或 EXTERNAL_TASKS_API_KEY");
    return {
      success: false,
      error: "❌ 待办系统未配置，请联系管理员。",
    };
  }

  const url = `${baseUrl}/api/external/tasks`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ text }),
      },
      DEFAULT_TIMEOUT_MS
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[External] 待办 API 失败:", res.status, errText);
      return {
        success: false,
        error: "❌ 待办接口无响应，请稍后再试。",
      };
    }

    const data = await res.json().catch(() => ({}));
    return { success: true, data };
  } catch (e: any) {
    console.error("[External] 待办请求异常:", e?.message || e);
    const msg = e?.message === "请求超时" ? "超时" : "无响应";
    return {
      success: false,
      error: `❌ 待办接口${msg}，请稍后再试。`,
    };
  }
}

/**
 * 日记 - 向日记网发送通知/记录
 * POST {DIARY_DOMAIN}/api/notifications/send
 */
export async function postDiaryNotification(content: string): Promise<ApiResult<unknown>> {
  const baseUrl = process.env.DIARY_DOMAIN?.replace(/\/$/, "");
  const apiKey = process.env.DIARY_API_KEY || process.env.EXTERNAL_TASKS_API_KEY;

  if (!baseUrl) {
    console.warn("[External] 缺少 DIARY_DOMAIN");
    return {
      success: false,
      error: "❌ 日记系统未配置，请联系管理员。",
    };
  }

  const url = `${baseUrl}/api/notifications/send`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey && { "x-api-key": apiKey }),
        },
        body: JSON.stringify({
          title: "日记记录",
          body: content,
          text: content,
        }),
      },
      DEFAULT_TIMEOUT_MS
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[External] 日记 API 失败:", res.status, errText);
      return {
        success: false,
        error: "❌ 日记接口无响应，请稍后再试。",
      };
    }

    const data = await res.json().catch(() => ({}));
    return { success: true, data };
  } catch (e: any) {
    console.error("[External] 日记请求异常:", e?.message || e);
    const msg = e?.message === "请求超时" ? "超时" : "无响应";
    return {
      success: false,
      error: `❌ 日记接口${msg}，请稍后再试。`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 轨道二：读操作 API（店铺财务）
// ─────────────────────────────────────────────────────────────────────────────

export type FinanceShop = { shopId: string; shopName: string };

/**
 * 获取店铺列表（用于匹配用户自然语言中的店铺名）
 * GET {FINANCE_DOMAIN}/api/finance/ai-context/shops
 */
export async function getFinanceShopList(): Promise<ApiResult<FinanceShop[]>> {
  const baseUrl = process.env.FINANCE_DOMAIN?.replace(/\/$/, "");
  const apiKey = process.env.AI_CONTEXT_API_KEY;

  if (!baseUrl || !apiKey) {
    console.warn("[External] 缺少 FINANCE_DOMAIN 或 AI_CONTEXT_API_KEY");
    return {
      success: false,
      error: "❌ 财务网接口未配置，请联系管理员。",
    };
  }

  const url = `${baseUrl}/api/finance/ai-context/shops`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { "x-api-key": apiKey },
      },
      DEFAULT_TIMEOUT_MS
    );

    const body = await res.json().catch(() => null);
    if (body === null) {
      return { success: false, error: "❌ 店铺列表接口返回异常。" };
    }
    if (!body.success || !Array.isArray(body.data)) {
      console.error("[External] 店铺列表 API 失败:", res.status, body);
      return {
        success: false,
        error: body?.error || "❌ 无法获取店铺列表，请稍后再试。",
      };
    }
    return { success: true, data: body.data };
  } catch (e: any) {
    console.error("[External] 店铺列表请求异常:", e?.message || e);
    const msg = e?.message === "请求超时" ? "超时" : "无响应";
    return {
      success: false,
      error: `❌ 店铺列表接口${msg}，请稍后再试。`,
    };
  }
}

/**
 * 财务 - 从财务网获取指定店铺、月份的 AI 上下文
 * GET {FINANCE_DOMAIN}/api/finance/ai-context?shopId=xxx&month=YYYY-MM
 */
export async function getFinanceAiContext(
  shopId: string,
  month: string
): Promise<ApiResult<unknown>> {
  const baseUrl = process.env.FINANCE_DOMAIN?.replace(/\/$/, "");
  const apiKey = process.env.AI_CONTEXT_API_KEY;

  if (!baseUrl || !apiKey) {
    console.warn("[External] 缺少 FINANCE_DOMAIN 或 AI_CONTEXT_API_KEY");
    return {
      success: false,
      error: "❌ 财务网接口未配置，请联系管理员。",
    };
  }

  const url = new URL(`${baseUrl}/api/finance/ai-context`);
  url.searchParams.set("shopId", shopId);
  url.searchParams.set("month", month);

  try {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: { "x-api-key": apiKey },
      },
      DEFAULT_TIMEOUT_MS
    );

    const body = await res.json().catch(() => null);
    if (body === null) {
      return { success: false, error: "❌ 财务网返回数据异常，请稍后再试。" };
    }
    if (!res.ok || body?.success === false) {
      console.error("[External] 财务 API 失败:", res.status, body);
      return {
        success: false,
        error: body?.error || "❌ 财务网接口无响应，请稍后再试。",
      };
    }
    // 接口返回 { success, data } 或直接 data，统一取 data 用于总结
    const data = body?.data !== undefined ? body.data : body;
    return { success: true, data };
  } catch (e: any) {
    console.error("[External] 财务请求异常:", e?.message || e);
    const msg = e?.message === "请求超时" ? "超时" : "无响应";
    return {
      success: false,
      error: `❌ 财务网接口${msg}，请稍后再试。`,
    };
  }
}
