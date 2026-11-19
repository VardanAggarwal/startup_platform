// Completes every live hot seat: fills any missing Worksheet C answers from the plan's own B answers, then marks it done.
const BASE = process.env.BASE || "http://localhost:8765";
let T = null;
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + T }, body: b === undefined ? undefined : JSON.stringify(b) }); if (!r.ok) throw new Error(m + " " + u + " " + r.status); return r.json(); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const low = (x) => String(x || "").trim().replace(/[.\s]+$/, "");
(async () => {
  T = (await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "susegad" }) }).then((r) => r.json())).token;
  const plans = await api("GET", "/api/col/plans"); const out = [];
  for (const { id, data: p } of plans) {
    if (p.status === "done") continue;
    const has = (p.card || {}).a_path === "I have customers", chan = low(p.v_primary || p.b_primary) || "my main channel", bar = p.m_bar || "3";
    const C = {
      v_seg: low(p.b_seg), v_msg: low(p.b_promise) || ("I help " + low(p.b_seg) + " get results without the hassle"), v_primary: chan,
      v_goal: has ? "Add " + (p.m_target || "50") + " new customers in " + (p.m_weeks || "12") + " weeks through " + chan : "Get " + bar + " people to commit to a first order through " + chan,
      e_what: has ? "Spend focused effort on " + chan + ": reach " + (p.m_cap || "40") + " people and track every enquiry" : "Message " + (p.m_cap || "30") + " people on " + chan + " and ask for a first order",
      e_start: day(2), e_end: day(16), e_keep: has ? "Keep going if the cost per customer stays within 20% of today" : "Keep going if at least " + bar + " people commit",
      e_change: has ? "Change the channel or message if cost per customer rises 30% or more" : "Change the segment or the message if fewer than " + Math.max(1, Number(bar) - 1) + " people commit",
      e_ask: "An introduction to 3 people in " + low(p.b_seg).slice(0, 60),
    };
    const merged = Object.assign({}, p);
    Object.keys(C).forEach((k) => { if (!String(p[k] || "").trim()) merged[k] = C[k]; });
    merged.status = "done"; merged.updatedAt = Date.now();
    await api("PUT", "/api/doc/plans/" + id, merged); out.push(p.name);
  }
  console.log("completed:", out.length ? out.join(", ") : "nothing live");
})().catch((e) => { console.error(e.message); process.exit(1); });
