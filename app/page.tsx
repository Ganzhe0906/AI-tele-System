"use client";

import { useEffect, useState } from "react";
import { LogEntry } from "../types";

export default function Dashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    // 模拟从数据库或外部 API 获取日志
    const mockLogs: LogEntry[] = [
      {
        id: "log-101",
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        userId: 1234567,
        username: "Alice",
        type: "text",
        intent: "finance",
        status: "success",
        extractedInfo: "买入 100 股 AAPL",
      },
      {
        id: "log-102",
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        userId: 7654321,
        username: "Bob",
        type: "voice",
        intent: "todo",
        status: "success",
        extractedInfo: "明天下午 3 点开会",
      },
      {
        id: "log-103",
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        userId: 1112223,
        username: "Charlie",
        type: "text",
        intent: "selection",
        status: "error",
        extractedInfo: "淘宝对比两款显示器...",
      },
    ];
    setLogs(mockLogs);
  }, []);

  const intentColors: Record<string, string> = {
    finance: "text-green-400 bg-green-400/10 border-green-500/20",
    selection: "text-blue-400 bg-blue-400/10 border-blue-500/20",
    todo: "text-yellow-400 bg-yellow-400/10 border-yellow-500/20",
    diary: "text-purple-400 bg-purple-400/10 border-purple-500/20",
    knowledge: "text-indigo-400 bg-indigo-400/10 border-indigo-500/20",
    operations: "text-red-400 bg-red-400/10 border-red-500/20",
    unknown: "text-gray-400 bg-gray-400/10 border-gray-500/20",
  };

  const statusColors: Record<string, string> = {
    success: "text-green-500",
    error: "text-red-500",
    processing: "text-yellow-500 animate-pulse",
  };

  const [testInput, setTestInput] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const handleTestAPI = async () => {
    if (!testInput.trim()) return;
    setIsTesting(true);
    try {
      // 模拟一个发送给 Webhook 的 Update 数据结构
      const mockUpdate = {
        update_id: Math.floor(Math.random() * 100000),
        message: {
          message_id: Math.floor(Math.random() * 1000),
          from: { id: 999, is_bot: false, first_name: "Tester" },
          chat: { id: 0, first_name: "LocalTest", type: "private" }, // 请确保在 .env 填写真实的 chat.id 测试
          date: Date.now(),
          text: testInput,
        },
      };

      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mockUpdate),
      });

      if (res.ok) {
        alert("测试请求已发送！请检查您的 Telegram 机器人消息。");
        setTestInput("");
      } else {
        alert("测试发送失败，请检查 API 路由。");
      }
    } catch (err) {
      console.error(err);
      alert("发送出错：" + (err as Error).message);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-8 font-mono">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-800 pb-6">
        <h1 className="text-2xl font-bold tracking-wider text-neutral-200">
          <span className="text-blue-500">TG</span>-AGENT-HUB
        </h1>
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <span className="text-sm text-neutral-400">系统在线 · Vercel Edge</span>
        </div>
      </header>

      {/* Stats Cards */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "今日接收", value: "1,024" },
          { label: "成功率", value: "98.5%" },
          { label: "平均延迟", value: "1.2s" },
          { label: "错误重试", value: "15" },
        ].map((stat, i) => (
          <div
            key={i}
            className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 shadow-xl"
          >
            <div className="text-neutral-500 text-sm mb-1">{stat.label}</div>
            <div className="text-2xl font-semibold text-neutral-100">
              {stat.value}
            </div>
          </div>
        ))}
      </section>

      {/* Test Console */}
      <section className="p-6 rounded-xl bg-neutral-900 border border-neutral-800 shadow-xl space-y-4">
        <h2 className="text-lg font-medium text-neutral-300 flex items-center gap-2">
          🧪 接口联调实验室 (Test API)
        </h2>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            className="flex-1 bg-black border border-neutral-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            placeholder="输入模拟测试消息，例如：买入100股苹果股票"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
          />
          <button
            onClick={handleTestAPI}
            disabled={isTesting}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-800 disabled:text-neutral-500 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
          >
            {isTesting ? "发送中..." : "🚀 发送模拟 Update"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          * 注意：此测试会触发真实的 Telegram Bot 发送（如果已填 TOKEN），Update Payload 将直接打入 /api/telegram
        </p>
      </section>

      {/* Logs Table */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-neutral-300">
          🚀 最近 10 条路由日志
        </h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
          <table className="w-full text-left text-sm text-neutral-400">
            <thead className="bg-neutral-800/50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-6 py-4 font-medium">时间</th>
                <th className="px-6 py-4 font-medium">用户</th>
                <th className="px-6 py-4 font-medium">类型</th>
                <th className="px-6 py-4 font-medium">意图 (Intent)</th>
                <th className="px-6 py-4 font-medium">提取信息</th>
                <th className="px-6 py-4 font-medium text-right">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/50">
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-neutral-800/30 transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleTimeString("zh-CN")}
                  </td>
                  <td className="px-6 py-4 font-medium text-neutral-300">
                    @{log.username || log.userId}
                  </td>
                  <td className="px-6 py-4 uppercase">
                    {log.type === "voice" ? "🎤" : "📝"}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 text-xs border rounded-full uppercase ${
                        intentColors[log.intent] || intentColors.unknown
                      }`}
                    >
                      {log.intent}
                    </span>
                  </td>
                  <td className="px-6 py-4 truncate max-w-xs" title={log.extractedInfo}>
                    {log.extractedInfo}
                  </td>
                  <td
                    className={`px-6 py-4 text-right font-medium capitalize ${
                      statusColors[log.status]
                    }`}
                  >
                    {log.status === "success" ? "成功" : "失败"}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-neutral-500"
                  >
                    暂无数据...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}