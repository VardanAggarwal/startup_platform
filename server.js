// Local workshop server: static files + SQLite (node:sqlite, built in; Node 22+). No npm dependencies. Run: node server.js
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = process.env.PORT || 8765;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@local", ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "susegad";
const DIR = __dirname, DATA = process.env.DATA_DIR || path.join(DIR, "data");
const roster = JSON.parse(fs.readFileSync(path.join(DIR, "data", "roster.json"), "utf8"));
const byId = Object.fromEntries(roster.map((r) => [r.id, r]));
const { DatabaseSync } = require("node:sqlite");
fs.mkdirSync(DATA, { recursive: true });
const sql = new DatabaseSync(path.join(DATA, "workshop.db"));
sql.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS kv (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (coll, id))");
const q = { get: sql.prepare("SELECT data FROM kv WHERE coll=? AND id=?"), list: sql.prepare("SELECT id, data FROM kv WHERE coll=?"), put: sql.prepare("INSERT INTO kv (coll,id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(coll,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at"), clear: sql.prepare("DELETE FROM kv") };
const getDoc = (c, id) => { const r = q.get.get(c, id); return r ? JSON.parse(r.data) : undefined; };
const putDoc = (c, id, d) => q.put.run(c, id, JSON.stringify(d), Date.now());
// One-time import of the old JSON file.
if (!sql.prepare("SELECT 1 FROM kv LIMIT 1").get()) { try { const old = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8")); for (const c in old) for (const id in old[c]) putDoc(c, id, old[c][id]); console.log("Imported data/db.json into SQLite"); } catch (e) {} }
const tokens = new Set();
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// Same rules as schema.sql: admin = everything; founder = self-scoped or shared collections.
function can(coll, id, writing, actor, admin) {
  if (admin) return true;
  if (!actor) return false;
  if (writing) return (["peerRatings", "cards"].includes(coll) && id === actor) || coll === "plans";
  return (["peerRatings", "cards", "results"].includes(coll) && id === actor) || ["rounds", "groupsPublished", "plans", "stage"].includes(coll);
}
const startupOf = (id) => ((getDoc("cards", id) || {}).gtm || {}).a_startup || "";
const manifestOf = (r) => ({ id: r.id, rosterId: r.id, name: r.name, program: r.program, startup: startupOf(r.id), gtm: 3, ai: 3 });
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { ok({}); } }); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (p[0] !== "api") {
    if (p[0] === "favicon.ico") { res.writeHead(204); return res.end(); }
    const f = path.join(DIR, p.length ? p.join("/") : "index.html");
    if (!f.startsWith(DIR) || f.startsWith(path.join(DIR, "data")) || f.endsWith("server.js") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    const st = fs.statSync(f), etag = '"' + st.size + "-" + Math.floor(st.mtimeMs) + '"';
    const hd = { "Content-Type": mime[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, hd); return res.end(); }
    res.writeHead(200, hd);
    return fs.createReadStream(f).pipe(res);
  }
  const admin = tokens.has((req.headers.authorization || "").replace("Bearer ", ""));
  const hid = req.headers["x-founder-id"], actor = hid && byId[hid] ? hid : null;
  try {
    if (p[1] === "login" && req.method === "POST") {
      const b = await body(req);
      if (b.email === ADMIN_EMAIL && b.password === ADMIN_PASSWORD) { const t = crypto.randomUUID(); tokens.add(t); return send(res, 200, { token: t }); }
      return send(res, 401, { error: "bad_login" });
    }
    if (p[1] === "roster") return send(res, 200, roster.map((r) => (admin ? { id: r.id, name: r.name, program: r.program, startup: startupOf(r.id) } : { id: r.id, name: r.name, program: r.program })));
    if (p[1] === "me") return send(res, 200, actor ? manifestOf(byId[actor]) : null);
    if (p[1] === "manifests") return admin ? send(res, 200, roster.map(manifestOf)) : send(res, 403, { error: "admin_only" });
    if (p[1] === "reset" && req.method === "POST") { if (!admin) return send(res, 403, {}); q.clear.run(); return send(res, 200, { ok: true }); }
    if (p[1] === "col" && p[2]) {
      return send(res, 200, q.list.all(p[2]).filter((r) => can(p[2], r.id, false, actor, admin)).map((r) => ({ id: r.id, data: JSON.parse(r.data) })));
    }
    if (p[1] === "doc" && p[2] && p[3]) {
      const [coll, id] = [p[2], p[3]]; let d;
      if (req.method === "GET") return can(coll, id, false, actor, admin) ? send(res, 200, (d = getDoc(coll, id)) !== undefined ? { exists: true, data: d } : { exists: false }) : send(res, 403, { error: "denied" });
      if (!can(coll, id, true, actor, admin)) return send(res, 403, { error: "denied" });
      const b = await body(req);
      if (req.method === "PUT") putDoc(coll, id, b);
      else if (req.method === "PATCH") { const cur = getDoc(coll, id); if (cur === undefined) return send(res, 404, { error: "missing" }); putDoc(coll, id, Object.assign({}, cur, b)); }
      else return send(res, 405, {});
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "unknown" });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log(`Workshop on http://localhost:${PORT}  (admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD})  founders: ${roster.length}`));
