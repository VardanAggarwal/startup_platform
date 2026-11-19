// Simulates hot seats: plan = the founder's Worksheet B draft + Worksheet C, in their published group. Usage: node sim-hotseats.js
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://localhost:8765";
const SKIP = new Set(["Anmol More", "Ayush Agrawal"]);
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "roster.json"), "utf8"));
let T = null;
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + T }, body: b === undefined ? undefined : JSON.stringify(b) }); if (!r.ok) throw new Error(m + " " + u + " " + r.status); return r.json(); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const low = (x) => String(x || "").trim().replace(/[.\s]+$/, "");
(async () => {
  T = (await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "susegad" }) }).then((r) => r.json())).token;
  const pub = await api("GET", "/api/doc/groupsPublished/gtm"); if (!pub.exists) throw new Error("publish groups first");
  const gof = {}; pub.data.groups.forEach((g) => g.members.forEach((m) => (gof[m.id] = g.n)));
  const todo = roster.filter((f) => !SKIP.has(f.name) && gof[f.id]);
  let done = 0, live = 0, i = 0;
  for (const f of todo) {
    i++;
    const c = (await api("GET", "/api/doc/cards/" + f.id)).data || {}, A = c.gtm || {}, B = c.gtmB || {};
    const has = A.a_path === "I have customers", startup = A.a_startup || "";
    const chan = low(B.b_primary) || "my main channel";
    const goal = has ? "Add " + (B.m_target || "50") + " new customers in " + (B.m_weeks || "12") + " weeks through " + chan : "Get " + (B.m_bar || "3") + " people to commit to a first order through " + chan;
    const C = {
      v_seg: low(B.b_seg), v_msg: low(B.b_promise) || ("I help " + low(B.b_seg) + " get results without the hassle"), v_primary: chan, v_goal: goal,
      e_what: has ? "Spend focused effort on " + chan + ": reach " + (B.m_cap || "40") + " people and track every enquiry" : "Message " + (B.m_cap || "30") + " people on " + chan + " and ask for a first order",
      e_start: day(1 + (i % 4)), e_end: day(15 + (i % 4)), e_keep: has ? "Keep going if the cost per customer stays within 20% of today" : "Keep going if at least " + (B.m_bar || "3") + " people commit",
      e_change: has ? "Change the channel or message if cost per customer rises 30% or more" : "Change the segment or the message if fewer than " + Math.max(1, Number(B.m_bar || 3) - 1) + " people commit", e_ask: "An introduction to 3 people in " + low(B.b_seg).slice(0, 60),
    };
    const status = i % 10 === 0 ? "live" : "done";
    if (status === "live") ["e_start", "e_end", "e_keep", "e_change", "e_ask"].forEach((k) => delete C[k]);
    const started = Date.now() - (60 - i * 1.5) * 60000;
    const plan = Object.assign({}, B, C, { session: "gtm", founderId: f.id, name: f.name, startup, n: gof[f.id], status, card: A, startedAt: started, updatedAt: started + 20 * 60000 });
    await api("PUT", "/api/doc/plans/gtm__" + f.id, plan);
    status === "done" ? done++ : live++;
  }
  console.log("hot seats simulated:", todo.length, "| done:", done, "| live (C partly filled):", live, "| skipped:", [...SKIP].join(", "));
})().catch((e) => { console.error(e.message); process.exit(1); });
