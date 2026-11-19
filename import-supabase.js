// Copies data/workshop.db (SQLite) into Supabase workshop_kv via the REST API, as an organizer.
// Usage: SUPABASE_URL=… SUPABASE_KEY=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node import-supabase.js
const { DatabaseSync } = require("node:sqlite"), path = require("path");
const { SUPABASE_URL: U, SUPABASE_KEY: K, ADMIN_EMAIL: E, ADMIN_PASSWORD: P } = process.env;
if (!U || !K || !E || !P) { console.error("Set SUPABASE_URL, SUPABASE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD"); process.exit(1); }
const H = { apikey: K, "Content-Type": "application/json" };
(async () => {
  const t = await fetch(U + "/rest/v1/rpc/workshop_admin_login", { method: "POST", headers: H, body: JSON.stringify({ p_email: E, p_password: P }) }).then((r) => r.json());
  if (typeof t !== "string") throw new Error("login failed");
  const rows = new DatabaseSync(path.join(__dirname, "data", "workshop.db")).prepare("SELECT coll, id, data FROM kv").all().map((r) => ({ collection: r.coll, id: r.id, data: JSON.parse(r.data) }));
  for (let i = 0; i < rows.length; i += 50) {
    const r = await fetch(U + "/rest/v1/workshop_kv?on_conflict=collection,id", { method: "POST", headers: { ...H, "x-admin-token": t, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 50)) });
    if (!r.ok) throw new Error("batch " + i + ": " + r.status + " " + (await r.text()));
  }
  console.log("imported", rows.length);
})().catch((e) => { console.error(e.message); process.exit(1); });
