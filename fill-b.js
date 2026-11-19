// Fills Worksheet B drafts (cards/{id}.gtmB) for every founder except the names in SKIP. Usage: node fill-b.js
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://localhost:8765";
const SKIP = new Set(["Anmol More", "Ayush Agrawal"]);
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "roster.json"), "utf8"));
let T = null;
const api = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + T }, body: b === undefined ? undefined : JSON.stringify(b) }); if (!r.ok) throw new Error(m + " " + u + " " + r.status); return r.json(); };
let s = 11; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ri = (a, b) => Math.round(a + rnd() * (b - a)), pick = (a) => a[Math.floor(rnd() * a.length)];
const num = (x, d) => { const m = String(x || "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? m[0] : String(d); };
const low = (x) => String(x || "").trim().replace(/[.\s]+$/, "");
const real = (x) => !/^(Test answer|x$)/i.test(String(x || "").trim()) && String(x || "").trim().length > 2;
(async () => {
  T = (await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@local", password: "susegad" }) }).then((r) => r.json())).token;
  let n = 0; const out = [];
  for (const f of roster) {
    if (SKIP.has(f.name)) continue;
    const r = await api("GET", "/api/doc/cards/" + f.id); if (!r.exists || !r.data.gtm) continue;
    const A = r.data.gtm, has = A.a_path === "I have customers";
    const sell = real(A.a_sell) ? low(A.a_sell) : "our product", pain = real(A.a_headache) ? low(A.a_headache) : "customers do not come back",
      how = real(A.a_how) ? low(A.a_how) : "word of mouth", who = real(A.a_f_who) ? low(A.a_f_who) : "small business owners in my city";
    const chans = (real(A.a_how) ? A.a_how.split(/ and |, /).map(low).filter(Boolean) : []).concat(["referrals", "WhatsApp groups", "a local community"]).slice(0, 5);
    const B = {
      b_seg: has ? "The customers who reorder within a month, from my top channel" : who,
      b_trigger: pick(["They ran out and had to reorder", "They had a bad experience with their current option", "A friend recommended us at the right time", "They were setting up something new"]),
      b_pain: pain, b_who: pick(["The buyer decides alone", "The owner decides, a manager uses it", "A couple decides together"]),
      b_gather: "Where they already talk: " + chans[0] + " and one WhatsApp group",
      b_problem: "\"" + pain + "\"", b_alt: pick(["They use a generic marketplace today", "They do it by hand or in a spreadsheet", "They do nothing and live with it"]),
      b_promise: "I help " + (has ? "repeat buyers" : who) + " get " + sell + " without the usual hassle",
      b_proof: has ? "Several customers reordered and two left reviews with numbers" : "Three people said they would pay again if it worked",
      b_primary: chans[0], b_backup: chans[1] || "referrals",
      r_assume: has ? "My best channel will keep working at 5 times the volume" : "People in this group will pay for a first order",
      r_test: has ? "Double my spend on it for 14 days and watch the cost per customer" : "Message 30 people and offer ten first-order slots",
      r_wrong: has ? "Cost per customer more than doubles" : "Fewer than 3 say yes or pay",
    };
    if (has) {
      const lines = String(A.a_last10 || "").split(/\n+/).map(low).filter(Boolean);
      for (let i = 1; i <= 5; i++) {
        const ln = lines[i - 1], m = ln && ln.match(/^(.*?)[\s:]*(\d+)\s*%?$/);
        B["ch" + i + "_n"] = m ? low(m[1]) : (chans[i - 1] || ""); B["ch" + i + "_1"] = m ? m[2] : (i <= 3 ? String(ri(5, 30)) : "");
        if (!B["ch" + i + "_n"]) continue;
        B["ch" + i + "_2"] = String(ri(120, 900)); B["ch" + i + "_3"] = pick(["Yes", "Not sure", "No"]); B["ch" + i + "_4"] = pick(["Double down", "Fix it", "Test it", "Stop"]);
      }
      const enq = ri(80, 400), talked = Math.round(enq * (0.4 + rnd() * 0.3)), paid = Math.round(talked * (0.2 + rnd() * 0.3)), won = ri(15, 60);
      Object.assign(B, { tf1: String(enq), tf2: String(talked), tf3: String(paid), tf4: String(won), tf5: String(Math.round(won * (0.5 + rnd() * 0.4))),
        b_leak: "Most people drop between talking to me and paying", b_motion: pick(["I sell it myself, in person or on a call", "It sells itself: they sign up online", "A partner introduces and sells it"]),
        m_target: String(ri(40, 200)), m_weeks: String(ri(8, 16)), m_conv: num(A.a_n5, 6), m_cac: num(A.a_n6, 350) });
    } else {
      for (let i = 1; i <= 3; i++) { B["ch" + i + "_n"] = chans[i - 1] || ""; B["ch" + i + "_1"] = pick(["A named group of 200 members", "One street market near me", "A list of 40 contacts", "An upcoming local event"]); B["ch" + i + "_2"] = pick(["Yes", "Not sure", "No"]); B["ch" + i + "_3"] = pick(["Message 20 people and offer a first slot", "Visit and talk to 10 owners", "Post once and reply to every comment"]); B["ch" + i + "_4"] = "₹" + ri(0, 800) + " and " + ri(3, 12) + " hours"; }
      const spoken = Number(num(A.a_f_spoken, 4)), t2 = Math.max(0, Math.round(spoken * 0.5)), t3 = Math.max(0, Math.round(spoken * 0.25));
      Object.assign(B, { ev1: String(spoken), ev2: String(t2), ev3: String(t3), ev4: String(Math.max(0, t3 - 1)), f_drop: pick(["Most did not see the problem as real", "They saw the problem but would not pay", "They would pay but did not commit", "I have not spoken to enough people yet"]),
        b_ask: "A first paid order, or a 15 minute call this week", m_cap: String(ri(15, 40)), m_bar: String(ri(3, 5)) });
    }
    const gtmB = Object.assign({}, B, r.data.gtmB || {});
    await api("PUT", "/api/doc/cards/" + f.id, Object.assign({}, r.data, { gtmB }));
    n++; out.push(f.name + " (" + (has ? "has customers" : "no customers") + ", " + Object.keys(gtmB).length + " fields)");
  }
  console.log("filled worksheet B for", n, "founders; skipped", [...SKIP].join(", ")); console.log(out.slice(0, 4).join("\n"));
})().catch((e) => { console.error(e.message); process.exit(1); });
