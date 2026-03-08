import { Pool } from "@neondatabase/serverless";

// Fallback to avoid crashing when env is not set
const dbUrl = process.env.DATABASE_URL || "";
const pool = dbUrl ? new Pool({ connectionString: dbUrl }) : null;

export async function initDB() {
  if (!pool) return console.warn("[DB] DATABASE_URL is not set. Skipping initDB.");
  const query = `
    CREATE TABLE IF NOT EXISTS route_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        user_id VARCHAR(255),
        username VARCHAR(255),
        type VARCHAR(50),
        intent VARCHAR(50),
        status VARCHAR(50),
        extracted_info TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost NUMERIC(10, 6) DEFAULT 0
    );
  `;
  try {
    await pool.query(query);
    console.log("[DB] Table 'route_logs' is ready.");
  } catch (error) {
    console.error("[DB] Init error:", error);
  }
}

export async function insertLog(data: {
  user_id: string | number;
  username?: string;
  type: string;
  intent: string;
  status: string;
  extracted_info: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}) {
  if (!pool) return console.warn("[DB] DATABASE_URL is not set. Skipping insertLog.");
  
  // Create table if it doesn't exist just in case (optional, but good for first run)
  await initDB();

  const query = `
    INSERT INTO route_logs (
      user_id, username, type, intent, status, extracted_info, input_tokens, output_tokens, cost
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;
  const values = [
    data.user_id.toString(),
    data.username || "",
    data.type,
    data.intent,
    data.status,
    data.extracted_info,
    data.input_tokens,
    data.output_tokens,
    data.cost,
  ];

  try {
    await pool.query(query, values);
    console.log("[DB] Log inserted successfully.");
  } catch (error) {
    console.error("[DB] Insert log error:", error);
  }
}

export async function getRecentLogs(limit = 10) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT * FROM route_logs ORDER BY timestamp DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map(row => ({
      ...row,
      timestamp: row.timestamp.toISOString()
    }));
  } catch (error) {
    console.error("[DB] Get logs error:", error);
    return [];
  }
}

export async function getStats() {
  if (!pool) {
    return {
      total_logs: 0,
      success_logs: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost: 0
    };
  }
  try {
    const res = await pool.query(`
      SELECT 
        COUNT(*) as total_logs,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_logs,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost) as total_cost
      FROM route_logs
    `);
    return {
      total_logs: parseInt(res.rows[0].total_logs || '0'),
      success_logs: parseInt(res.rows[0].success_logs || '0'),
      total_input_tokens: parseInt(res.rows[0].total_input_tokens || '0'),
      total_output_tokens: parseInt(res.rows[0].total_output_tokens || '0'),
      total_cost: parseFloat(res.rows[0].total_cost || '0')
    };
  } catch (error) {
    console.error("[DB] Get stats error:", error);
    return {
      total_logs: 0,
      success_logs: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost: 0
    };
  }
}
