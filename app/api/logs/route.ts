import { NextResponse } from "next/server";
import { getRecentLogs, getStats } from "../../../lib/db";

// Remove caching for dynamic data
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const logs = await getRecentLogs(20);
    const stats = await getStats();

    return NextResponse.json({
      success: true,
      data: {
        logs: logs.map(row => ({
          id: row.id.toString(),
          timestamp: row.timestamp,
          userId: row.user_id,
          username: row.username,
          type: row.type,
          intent: row.intent,
          status: row.status,
          extractedInfo: row.extracted_info,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cost: parseFloat(row.cost),
        })),
        stats,
      },
    });
  } catch (error) {
    console.error("[API] Failed to fetch logs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
