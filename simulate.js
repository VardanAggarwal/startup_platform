// Simulates the workshop for founders who have no card yet. Usage: node simulate.js <seed|plans|pod|room|clean>
// Writes through the local API as the organizer. Everything it creates is listed in data under collection "sim" so `clean` can undo it.
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://localhost:8765";
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "roster.json"), "utf8"));
let TOKEN = null;
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(method + " " + url + " -> " + r.status);
  return r.json();
}
const get = async (c, id) => { const r = await api("GET", `/api/doc/${c}/${id}`); return r.exists ? r.data : null; };
const put = (c, id, d) => api("PUT", `/api/doc/${c}/${id}`, d);
const col = (c) => api("GET", `/api/col/${c}`);
let seedN = 7; const rnd = () => (seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
const CRIT = ["customer", "channel", "message", "numbers", "plan"];

const SECTORS = [
  ["Masala Mile", "ready-to-cook regional curry kits", "Instagram ads and two cafe tie-ups", "repeat orders drop after the first box", "urban working couples in Bengaluru"],
  ["Lernly", "weekend coding classes for school kids", "school WhatsApp parent groups", "parents trust a school logo more than us", "parents of class 6 to 9 students"],
  ["GlowLeaf", "ayurvedic skincare for oily skin", "Instagram creators and Nykaa listing", "high returns on marketplace orders", "women 22 to 30 in metro cities"],
  ["StockSense", "inventory alerts for kirana stores", "distributor salesmen demos", "shop owners do not open the app", "kirana owners with 500+ SKUs"],
  ["TrailNest", "offbeat weekend stays in the Western Ghats", "travel creators and Google search", "bookings are lumpy by season", "couples and friend groups from Pune and Mumbai"],
  ["FreightFox", "return-load matching for small truckers", "transport union offices", "drivers will not pay a subscription", "owner-drivers with 1 to 3 trucks"],
  ["PayPocket", "salary advance for factory workers", "HR managers at 50-200 person factories", "HR takes months to say yes", "HR heads at small factories"],
  ["Dentiq", "teleconsult follow-ups for dental clinics", "dentist WhatsApp communities", "clinics say they are too busy to switch", "solo dental clinic owners"],
  ["Weavely", "handloom shirts for office wear", "LinkedIn posts and corporate gifting", "orders come in bursts around Diwali", "men 28 to 40 in corporate jobs"],
  ["AgriBid", "mandi price alerts and buyer matching", "FPO meetings and agri-input shops", "farmers verify with a phone call, not the app", "farmers with 5 to 20 acres"],
  ["Tiffinly", "office lunch subscriptions from home chefs", "office park WhatsApp groups", "delivery timing slips at 1 pm", "employees in Hinjewadi and Whitefield"],
  ["CareLoop", "elder-care visits booked by NRI children", "NRI Facebook groups", "families ask for a doctor not a caregiver", "NRIs with parents in tier 1 cities"],
  ["PixelPatch", "design subscriptions for D2C brands", "founder communities on X", "scope creep on every project", "D2C founders at 1 to 5 crore revenue"],
  ["Bhoomi Homes", "rent-to-own flats for gig workers", "builder partnerships", "banks reject income proof", "delivery partners with 3 years on the platform"],
  ["ChaiCart", "solar-powered tea carts for street vendors", "vendor associations", "upfront cost is a barrier", "chai vendors in tier 2 cities"],
  ["Fitkart", "home gym rentals by the month", "apartment society RWAs", "pickup logistics eat the margin", "residents in gated societies"],
  ["Kavach Legal", "contract review for small exporters", "export promotion council events", "exporters want a lawyer to sign off", "exporters with 10 to 50 crore turnover"],
  ["BeeKind", "single-origin honey subscriptions", "Instagram and gifting stores", "shipping glass jars breaks margins", "health-conscious families"],
  ["RideRoute", "shared cabs for airport commutes", "airport taxi desks and Google Maps", "empty return trips", "business travellers"],
  ["SkillSwap", "peer tutoring marketplace for college students", "college fests and campus ambassadors", "tutors drop off after exams", "engineering students in tier 2 colleges"],
  ["MedMitra", "chronic-care medicine refill reminders", "pharmacy counters", "pharmacists want a commission we cannot give", "diabetes and BP patients over 50"],
  ["Loomly Kids", "organic cotton clothes for toddlers", "mom influencers", "sizing confusion causes returns", "mothers of kids under 4"],
  ["VoltPe", "EV charger installs for housing societies", "society managers and RWAs", "approvals from the committee take months", "RWA secretaries in tier 1 cities"],
  ["Gully Eats", "street-food discovery and booking", "food bloggers", "listings go out of date", "college students in Delhi NCR"],
  ["NayaGaon", "village-level e-commerce agents", "panchayat offices", "agents lose interest after a month", "villages with 1000+ households"],
  ["Pocket CFO", "weekly cash flow reports for restaurants", "restaurant owner WhatsApp groups", "owners do not trust numbers they did not enter", "owners of 2 to 5 outlet restaurants"],
  ["Sutra HR", "payroll for 10-person startups", "startup founder communities", "founders compare us only on price", "founders with 5 to 25 employees"],
  ["WanderPack", "pre-packed trekking kits", "trekking clubs", "rental demand is seasonal", "weekend trekkers"],
];
const FAC = ["fac-1", "fac-2"];
const phSuf = (ph) => (ph === "pod" ? "__pod" : ph === "room" ? "__room" : "");
const q = {}; // latent quality per founder, set in seed from the id so later phases agree
const qOf = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 1.8 + (h % 270) / 100; };

async function sim() { // founders without a card
  const cards = new Set((await col("cards")).map((c) => c.id));
  return roster.filter((r) => !cards.has(r.id)).concat([]);
}
async function simIds() { const m = await get("sim", "meta"); return (m && m.ids) || []; }

function cardFor(i, r) {
  const s = SECTORS[i % SECTORS.length], has = i % 9 < 5;
  const pcts = [Math.round(35 + rnd() * 25), Math.round(15 + rnd() * 20)]; pcts.push(100 - pcts[0] - pcts[1]);
  const A = { a_startup: s[0], a_sell: s[1], a_how: s[2], a_headache: s[3], a_path: has ? "I have customers" : "I don't have customers yet",
    a_last10: "", a_n1: "", a_n5: "", a_n6: "", a_f_who: "", a_f_names: "", a_f_spoken: "" };
  if (has) {
    const ch = s[2].split(/ and |, /);
    A.a_last10 = [ch[0] + " " + pcts[0] + "%", (ch[1] || "referrals") + " " + pcts[1] + "%", "word of mouth " + pcts[2] + "%"].join("\n");
    A.a_n1 = String(40 + Math.floor(rnd() * 900)); A.a_n5 = String(3 + Math.floor(rnd() * 12)); A.a_n6 = String(150 + Math.floor(rnd() * 900));
  } else {
    A.a_f_who = s[4]; A.a_f_names = ["Riya", "Karan", "Neha"].map((n) => n + " (" + pick(["friend", "ex-colleague", "cousin", "neighbour"]) + ")").join("\n"); A.a_f_spoken = String(Math.floor(rnd() * 9));
  }
  return { gtm: A };
}
function vote(q0, extra) {
  const v = {}; CRIT.forEach((c) => (v[c] = clamp(q0 + extra + (rnd() - 0.5) * 2.2)));
  if (rnd() < 0.3) v.comment = pick(["Clear who the customer is.", "Channel needs a sharper test.", "Show the number, not the story.", "Ask was specific, good.", "Message is too broad for one channel."]);
  v.at = Date.now(); return v;
}
async function addVotes(rounds, raters, bonus) { // rounds: [{id,fid}], raters: [{id}]
  const store = {};
  for (const r of raters) store[r.id] = (await get("peerRatings", r.id)) || { votes: {} };
  for (const rd of rounds) for (const r of raters) { if (r.id === rd.fid) continue; if (r.peer && rnd() > 0.45) continue; store[r.id].votes[rd.id] = vote(qOf(rd.fid), bonus); }
  for (const r of raters) await put("peerRatings", r.id, store[r.id]);
}
async function openClosed(ids, ph) {
  const out = [];
  for (const id of ids) {
    const f = roster.find((x) => x.id === id), rid = id + "__gtm" + phSuf(ph);
    await put("rounds", rid, { founderId: id, name: f.name, session: "gtm", phase: ph, status: "closed", released: false, openedAt: Date.now() });
    out.push({ id: rid, fid: id });
  }
  return out;
}
const B = (c) => c.gtm.a_path === "I have customers";
function planFor(id, n) {
  const f = roster.find((x) => x.id === id), A = cardOf[id].gtm, has = B(cardOf[id]);
  const P = { session: "gtm", founderId: id, name: f.name, startup: A.a_startup, n, status: "done", card: A, startedAt: Date.now() - 3600e3, updatedAt: Date.now() };
  const common = { b_seg: A.a_f_who || "repeat buyers in my top channel", b_trigger: "They hit the problem at the start of the month", b_pain: A.a_headache, b_who: "The buyer decides alone", b_gather: "WhatsApp groups and one community", b_problem: A.a_headache, b_alt: "They use a generic marketplace today", b_promise: "We fix it in a week, or refund", b_proof: "Three customers said they would pay again", b_primary: A.a_how.split(/ and |, /)[0], b_backup: "Referrals from existing customers", b_motion: "I contact them myself, then follow up twice", f_drop: "After the first message", b_ask: "A short call and a first order", b_leak: "People reply but do not pay",
    r_assume: "People in this group will pay for a first order", r_test: "Message 30 people and offer one slot each", r_wrong: "Fewer than 3 say yes", v_seg: A.a_f_who || "repeat buyers in my top channel", v_msg: "We fix " + A.a_headache + " in a week", v_primary: A.a_how.split(/ and |, /)[0], v_goal: "10 paying customers in 4 weeks", e_what: "Message 30 people on " + A.a_how.split(/ and |, /)[0], e_start: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), e_end: new Date(Date.now() + 16 * 864e5).toISOString().slice(0, 10), e_keep: "Keep it if 3 or more say yes", e_change: "Change the message if fewer than 3 reply", e_ask: "An intro to 5 people in my target group" };
  const cohort = has ? { m_conv: A.a_n5, m_weeks: "4", m_cac: A.a_n6, m_price: "1200", tf1: "Instagram 55%", tf2: "Cafes 30%", tf3: "Referrals 15%" } : { m_cap: "30", m_bar: "3", m_target: "5", ev1: A.a_f_spoken, ev2: "2 said they have this problem", ev3: "1 asked about price", ev4: "0 paid or committed so far" };
  return Object.assign(P, common, cohort);
}
let cardOf = {};

(async () => {
  const cmd = process.argv[2];
  const L = await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL || "admin@local", password: process.env.ADMIN_PASSWORD || "susegad" }) }).then((r) => r.json());
  TOKEN = L.token;
  if (cmd === "seed") {
    const todo = await sim(); if (!todo.length) return console.log("nobody to simulate");
    const ids = todo.map((r) => r.id);
    for (const [i, r] of todo.entries()) await put("cards", r.id, cardFor(i, r));
    const rounds = await openClosed(ids, "before");
    await addVotes(rounds, ids.map((id) => ({ id, peer: true })).concat(FAC.map((id) => ({ id }))), 0);
    await put("sim", "meta", { ids, at: Date.now() });
    console.log("seeded", ids.length, "founders; before rounds closed with peer and facilitator votes");
  } else if (cmd === "plans") {
    const ids = await simIds(), pub = await get("groupsPublished", "gtm"); if (!pub) return console.log("publish groups first");
    const gof = {}; pub.groups.forEach((g) => g.members.forEach((m) => (gof[m.id] = g.n)));
    for (const id of ids) cardOf[id] = await get("cards", id);
    let live = 0, part = 0, none = 0;
    for (const [i, id] of ids.entries()) {
      if (!gof[id]) continue;
      if (i % 9 === 8) { none++; continue; }
      const P = planFor(id, gof[id]);
      if (i % 9 === 7) { P.status = "live"; ["e_what", "e_start", "e_end", "e_keep", "e_change", "v_goal"].forEach((k) => delete P[k]); live++; }
      else if (i % 9 === 6) { P.status = "live"; part++; }
      await put("plans", "gtm__" + id, P);
    }
    console.log("plans written. live:", live + part, "not started:", none, "done:", ids.length - none - live - part);
  } else if (cmd === "pod") {
    const ids = await simIds(), pub = await get("groupsPublished", "gtm");
    const done = [];
    for (const id of ids) { const p = await get("plans", "gtm__" + id); if (p && p.status === "done") done.push(id); }
    const rounds = await openClosed(done, "pod");
    const raters = []; for (const g of pub.groups) { const mem = g.members.map((m) => m.id); for (const id of mem) raters.push({ id, peer: true, group: mem }); }
    for (const rd of rounds) { const g = pub.groups.find((g) => g.members.some((m) => m.id === rd.fid)); rd.g = g.members.map((m) => m.id); }
    const store = {};
    for (const r of raters) store[r.id] = (await get("peerRatings", r.id)) || { votes: {} };
    for (const id of FAC) store[id] = (await get("peerRatings", id)) || { votes: {} };
    for (const rd of rounds) { for (const rid of rd.g) { if (rid === rd.fid || !store[rid]) continue; store[rid].votes[rd.id] = vote(qOf(rd.fid), 0.7); } for (const f of FAC) store[f].votes[rd.id] = vote(qOf(rd.fid), 0.6); }
    for (const [id, d] of Object.entries(store)) await put("peerRatings", id, d);
    console.log("pod-after rounds closed:", rounds.length);
  } else if (cmd === "room") {
    const ids = (await simIds()).slice(0, 6), rounds = await openClosed(ids, "room");
    await addVotes(rounds, (await simIds()).map((id) => ({ id, peer: true })).concat(FAC.map((id) => ({ id }))), 0.9);
    console.log("room-after rounds closed:", rounds.length);
  } else if (cmd === "roomall") { // every founder re-pitches to the room; rated by the simulated founders and 2 facilitators
    const sims = await simIds(), ids = roster.map((r) => r.id), rounds = await openClosed(ids, "room");
    await addVotes(rounds, sims.map((id) => ({ id, peer: true })).concat(FAC.map((id) => ({ id }))), 0.9);
    console.log("room-after rounds closed for", rounds.length, "founders");
  } else if (cmd === "room2") { // two room-after re-pitchers per group, counting rounds that already exist
    const pub = await get("groupsPublished", "gtm"), sims = new Set(await simIds()), existing = (await col("rounds")).filter((r) => r.data.phase === "room").map((r) => r.data.founderId);
    const picks = [];
    for (const g of pub.groups) {
      const ids = g.members.map((m) => m.id), have = ids.filter((id) => existing.includes(id)).length;
      const pool = ids.filter((id) => sims.has(id) && !existing.includes(id)).sort(() => rnd() - 0.5);
      pool.slice(0, Math.max(0, 2 - have)).forEach((id) => picks.push(id));
    }
    const rounds = await openClosed(picks, "room");
    await addVotes(rounds, [...sims].map((id) => ({ id, peer: true })).concat(FAC.map((id) => ({ id }))), 0.9);
    console.log("room-after rounds closed:", rounds.map((r) => roster.find((x) => x.id === r.fid).name).join(", "));
  } else if (cmd === "clean") {
    const ids = await simIds(); const gone = ["cards", "plans", "rounds", "peerRatings", "results"];
    // restore the backup taken before the first run
    console.log("To undo, stop the server and restore a copy of data/workshop.db. Simulated ids:", ids.length);
  } else console.log("usage: node simulate.js seed|plans|pod|room|clean");
})().catch((e) => { console.error(e.message); process.exit(1); });
