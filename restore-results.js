// Rebuilds released results for every round already marked released, using the same maths as "Release all scores".
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://localhost:8765";
const roster = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "data", "roster.json"), "utf8")).map((r) => r.id));
const KEYS = ["customer", "channel", "message", "numbers", "plan"];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
let T = null;
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + T }, body: b === undefined ? undefined : JSON.stringify(b) }); if (!r.ok) throw new Error(m + " " + u + " " + r.status); return r.json(); };
(async () => {
  T = (await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "susegad" }) }).then((r) => r.json())).token;
  const rounds = await api("GET", "/api/col/rounds"), pr = await api("GET", "/api/col/peerRatings"), have = Object.fromEntries((await api("GET", "/api/col/results")).map((r) => [r.id, r.data]));
  let added = 0;
  for (const { id: rid, data: r } of rounds) {
    if (!r.released || r.status === "open") continue;
    if ((have[r.founderId] && have[r.founderId].rounds || {})[rid]) continue;
    const vs = [];
    pr.forEach((d) => { const v = (d.data.votes || {})[rid]; if (!v || d.id === r.founderId) return; vs.push(Object.assign({}, v, { peer: roster.has(d.id) })); });
    if (!vs.length) continue;
    const peers = vs.filter((v) => v.peer), use = peers.length ? peers : vs;
    const entry = { session: r.session, phase: r.phase || "before", n: use.length, overall: mean(use.map((v) => mean(KEYS.map((k) => v[k])))), comments: use.filter((v) => v.comment).map((v) => v.comment) };
    KEYS.forEach((k) => (entry[k] = mean(use.map((v) => v[k]))));
    const doc = have[r.founderId] || { rounds: {} }; doc.rounds = Object.assign({}, doc.rounds, { [rid]: entry }); have[r.founderId] = doc;
    await api("PUT", "/api/doc/results/" + r.founderId, doc); added++;
  }
  console.log("restored", added, "released rounds into founders' results");
})().catch((e) => { console.error(e.message); process.exit(1); });
