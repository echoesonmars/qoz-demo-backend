import postgres from "postgres";

const num = Number(process.argv[2] ?? "3");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", prepare: false });
const rows = await sql`
  select id, category, created_at
  from public.incidents
  order by created_at desc
`;
await sql.end();

const index = rows.length - num;
if (index < 0 || index >= rows.length) {
  console.error(`Incident #${num} not found (${rows.length} total)`);
  process.exit(1);
}

const target = rows[index];
console.log("display #", num, "→", target);

const base = process.env.BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8080";
const secret = process.env.BACKEND_INTERNAL_SECRET;
if (!secret) {
  console.error("BACKEND_INTERNAL_SECRET required");
  process.exit(1);
}

const res = await fetch(`${base}/api/incidents/analyze`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Backend-Secret": secret,
  },
  body: JSON.stringify({ incidentId: target.id }),
});

console.log(res.status, await res.text());
