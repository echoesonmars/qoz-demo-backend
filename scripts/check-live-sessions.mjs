import postgres from "postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const env = readFileSync(join(root, "..", "qoz-vision-demo", ".env.local"), "utf8");
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) url = m[1].trim();
  } catch {}
}
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });
const sessions = await sql`
  select id, device_id, status, frame_count, error_message, started_at, last_frame_at
  from public.live_monitor_sessions
  order by started_at desc
  limit 8
`;
const snaps = await sql`
  select count(*)::int as n from public.live_analysis_snapshots
`;
console.log("sessions:", JSON.stringify(sessions, null, 2));
console.log("snapshot total:", snaps[0]?.n);
await sql.end();
