import postgres from "postgres";
import { getEnv } from "../config/env.js";

let sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!sql) {
    const url = getEnv().DATABASE_URL;
    const isSupabase =
      url.includes("supabase.co") || url.includes("pooler.supabase.com");
    sql = postgres(url, {
      max: 4,
      prepare: false,
      connect_timeout: 15,
      idle_timeout: 20,
      ...(isSupabase ? { ssl: "require" as const } : {}),
    });
  }
  return sql;
}
