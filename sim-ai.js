// Stress test for the AI in Business session (ai-founder.html + ai-admin.html), end to end.
// Runs the REAL page code from both HTML files (in a sandbox with a stub DOM) against the live local
// server, so every save, "Form groups" click and "Move" dropdown goes through the same functions a
// browser click would. 41 founders act concurrently: 38 fill Worksheet A, 3 skip it.
//
// Usage:  node sim-ai.js --yes
// Needs:  server.js running locally with >= 41 founders in data/roster.json.
// Env:    BASE (default http://localhost:8765), ADMIN_EMAIL / ADMIN_PASSWORD (same values server.js uses).
// WIPES the local database first (POST /api/reset). Refuses to run against anything but localhost.
// Leaves the finished session in the local DB so you can open ai-admin.html and look at it.
const fs = require("fs"), path = require("path"), vm = require("vm"), { execSync } = require("child_process");
const BASE = process.env.BASE || "http://localhost:8765";
const EMAIL = process.env.ADMIN_EMAIL || "admin@local", PASS = process.env.ADMIN_PASSWORD || "susegad";
const N_FILL = 38, N_SKIP = 3;
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("Refusing: sim-ai.js only runs against a local server."); process.exit(1); }
if (!process.argv.includes("--yes")) { console.error("This wipes the LOCAL database (POST /api/reset). Re-run with --yes."); process.exit(1); }

// ---------- shared AI code (the same file the pages load) ----------
const AI_SRC = fs.readFileSync(path.join(__dirname, "ai.js"), "utf8");
const AI = (() => { const c = { document: {} }; c.globalThis = c; vm.createContext(c); vm.runInContext(AI_SRC + ";globalThis.__={AI_THEMES,AI_MAX,BKEYS,buildAiGroups,buildAiPitch};", c); return c.__; })();
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- reporting ----------
const results = [], lat = []; let http5xx = 0, httpFail = 0;
const t0 = Date.now(), secs = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const check = (name, ok, detail) => results.push({ s: ok ? "PASS" : "FAIL", name, detail: detail || "" });
const warn = (name, detail) => results.push({ s: "WARN", name, detail: detail || "" });
const step = (m) => console.log(`[${secs()}] ${m}`);

// ---------- HTTP ----------
let TOKEN = null;
async function req(method, url, body, who) {
  const h = { "Content-Type": "application/json" };
  if (who === "admin") h.Authorization = "Bearer " + TOKEN; else if (who) h["x-founder-id"] = who;
  const s = Date.now();
  try {
    const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const txt = await r.text(); lat.push(Date.now() - s); let json = null; try { json = JSON.parse(txt); } catch (e) {}
    if (r.status >= 500) http5xx++; return { status: r.status, json, txt };
  } catch (e) { httpFail++; lat.push(Date.now() - s); return { status: 0, json: null, txt: "" }; }
}
const dpath = (c, id) => `/api/doc/${c}/${encodeURIComponent(id)}`;
const getD = async (c, id, who) => { const r = await req("GET", dpath(c, id), undefined, who); return r.json && r.json.exists ? r.json.data : null; };
const putD = (c, id, d, who) => req("PUT", dpath(c, id), d, who);
const col = async (c, who) => (await req("GET", "/api/col/" + c, undefined, who)).json || [];

// ---------- page harness: run the real inline <script> of a page against the live API ----------
function pageScript(file) {
  const s = fs.readFileSync(path.join(__dirname, file), "utf8");
  const st = s.indexOf("<script>", s.indexOf('src="ai.js"')), o = s.indexOf(">", st) + 1;
  return s.slice(o, s.indexOf("</script>", o));
}
const SCRIPTS = { founder: pageScript("ai-founder.html"), admin: pageScript("ai-admin.html") };
function mkDb(who) { // same surface shim.js gives the pages: db.doc(p).get/set, db.collection(c).get
  return {
    doc(p) {
      const i = p.indexOf("/"), c = p.slice(0, i), id = p.slice(i + 1);
      return {
        async get() { const r = await req("GET", dpath(c, id), undefined, who); if (r.status !== 200) throw new Error("HTTP " + r.status); return { id, exists: !!r.json.exists, data: () => r.json.data }; },
        async set(o) { const r = await req("PUT", dpath(c, id), JSON.parse(JSON.stringify(o)), who); if (r.status !== 200) throw new Error("HTTP " + r.status); },
        onSnapshot() { return () => {}; },
      };
    },
    collection(c) {
      return {
        async get() {
          const a = c === "roster" ? ((await req("GET", "/api/roster", undefined, who)).json || []).map((r) => ({ id: r.id, data: { name: r.name, program: r.program } })) : await col(c, who);
          return { docs: a.map((d) => ({ id: d.id, data: () => d.data })) };
        },
        onSnapshot() { return () => {}; },
      };
    },
  };
}
function loadPage(kind, who) {
  const reg = {}, handlers = {};
  const mk = (id) => ({ id, innerHTML: "", textContent: "", className: "", hidden: false, style: {}, dataset: {}, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, scrollIntoView() {} });
  const document = { getElementById: (id) => reg[id] || (reg[id] = mk(id)), addEventListener: (t, f) => (handlers[t] = handlers[t] || []).push(f) };
  const c = { document, console, CSS: { escape: (s) => s }, navigator: {}, setTimeout, claude: { use: () => new Promise(() => {}) } }; // boot IIFE parks forever; we drive state ourselves
  c.window = c; c.globalThis = c; c.confirm = () => true; vm.createContext(c);
  vm.runInContext(AI_SRC, c); vm.runInContext(SCRIPTS[kind], c);
  c.__db = mkDb(who); vm.runInContext("db=__db", c);
  const run = (code) => vm.runInContext(code, c);
  return {
    c, run, el: (id) => document.getElementById(id), handlers,
    // fire a document-level event at the page's own handlers; closestMap = selector -> fake element
    fire: async (type, closestMap) => { const ev = { target: { closest: (s) => closestMap[s] || null } }; await Promise.all((handlers[type] || []).map((h) => h(ev))); },
  };
}
const setForm = (P, formId, attr, vals) => { P.el(formId).querySelectorAll = () => Object.keys(vals).map((k) => ({ dataset: { [attr]: k }, value: String(vals[k]) })); };
async function syncFounder(P, fid) { // what the founder page's boot + snapshots load
  const [cards, plan, groups, stage] = await Promise.all([getD("cards", fid, fid), getD("plans", "ai__" + fid, fid), getD("groupsPublished", "ai", fid), getD("stage", "ai", fid)]);
  P.c.__s = { cards: cards || {}, plan: plan || {}, groups, stage: (stage && stage.stage) || "" };
  P.run("cards=__s.cards;planB=__s.plan;aiGroups=__s.groups;aiStage=__s.stage;aiStageReady=true;aiEditing=false;renderAi()");
  return P.el("ai-body").innerHTML;
}
async function syncAdmin(A) { // what the admin page's boot + snapshots load
  const [roster, stage, groups, cards, plans] = await Promise.all([
    req("GET", "/api/roster", undefined, "admin").then((r) => r.json || []), getD("stage", "ai", "admin"), getD("groupsPublished", "ai", "admin"), col("cards", "admin"), col("plans", "admin")]);
  A.c.__s = { roster, stage, groups, cards: cards.map((d) => Object.assign({ id: d.id }, d.data)), plans: Object.fromEntries(plans.filter((d) => d.id.indexOf("ai__") === 0).map((d) => [d.id.slice(4), d.data])) };
  A.run("roster=__s.roster;rosterMap={};roster.forEach(r=>rosterMap[r.id]=r);aiStageDoc=__s.stage;aiGroupsDoc=__s.groups;aiCards=__s.cards;aiPlans=__s.plans;renderAiAdmin()");
  return A.el("ai-admin").innerHTML;
}
const count = (s, sub) => s.split(sub).length - 1;

// ---------- test data ----------
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const T = AI.AI_THEMES;
const THEME_COUNTS = [9, 8, 7, 5, 5, 3, 1]; // = 38, mirrors the founders' own counts (Customer support only 1)
const TOOLS = ["ChatGPT", "Claude", "ChatGPT, Canva AI", "Cursor, Claude Code", "Gemini", "None yet", "Perplexity, ChatGPT", "Zoho Zia"];
const BANK = [
  ["Writing posts and product content for Instagram and our site eats most of my week", "me and one marketing intern", "about 10 hrs/week", "Use Claude to draft a month of posts from our product notes", "An agent that turns every blog into reel scripts and emails", "Feed Claude our 20 best past posts as examples", "we post 5 times a week instead of twice"],
  ["Finding and qualifying B2B leads by hand from LinkedIn and RFQ portals", "our 2-person sales team", "about 15 hrs/week and missed RFQs", "AI scoring of incoming RFQs so we only chase the good ones", "Personalised outreach emails drafted from each lead's website", "Export last quarter's won and lost leads into a sheet", "we reply to every good RFQ within a day"],
  ["Screening hundreds of applications for every role", "me as founder", "2 to 3 days per hire", "AI first-pass screening against a clear scorecard", "AI-run first-round voice interviews", "Write a one-page scorecard for our next hire", "shortlists take one afternoon, not a week"],
  ["Daily production and dispatch updates live in WhatsApp and paper registers", "the plant supervisor and me", "about 1 hr a day of follow-ups", "Voice notes turned into a daily ops sheet by AI", "A WhatsApp bot that logs dispatches automatically", "Pick one register and digitise it this week", "I get one daily summary instead of 40 messages"],
  ["Chasing invoices and reconciling payments every month", "me and my accountant", "about 6 hrs/week", "Auto-reminder emails drafted by Claude", "A full receivables agent connected to Tally", "List the 20 overdue clients", "collections time halves"],
  ["Writing test reports and compliance documents for every product batch", "our 3-person R&D team", "a week per batch", "AI drafts of compliance reports from lab data", "Claude Code to automate our data pipeline checks", "Collect three past reports as templates", "reports go out in two days"],
  ["Answering the same onboarding questions from new customers", "me and our ops lead", "about 8 hrs/week", "An AI FAQ assistant on WhatsApp", "Auto-generated onboarding videos", "List the top 15 questions we get", "half the questions get answered without us"],
];
const r15 = () => String(1 + Math.floor(rnd() * 5));
function specFor(i, ti) { // i = fill index, ti = #1 theme index
  const t2 = T[(ti + 1 + (i % 5)) % 7 === ti ? (ti + 2) % 7 : (ti + 1 + (i % 5)) % 7];
  const A = { ai_tools: TOOLS[i % TOOLS.length], ai_comfort: String(1 + (i % 5)), ai_t1: T[ti], ai_t2: t2 };
  const b = BANK[ti], partial = i % 6 === 5;
  const B = partial ? { ai_ps: b[0], ai_s1: b[3] } : { ai_ps: b[0], ai_who: b[1], ai_cost: b[2], ai_s1: b[3], ai_s1_imp: r15(), ai_s1_eff: r15(), ai_s2: b[4], ai_s2_imp: r15(), ai_s2_eff: r15(), ai_pick: i % 2 ? "" : (rnd() < 0.5 ? "Option A" : "Option B"), ai_step: b[5], ai_delta: b[6] };
  return { A, B, partial };
}
const flat = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => ((a[k] = o[k]), a), {}));
const pickB = (o) => AI.BKEYS.reduce((a, k) => (o[k] !== undefined && (a[k] = o[k]), a), {});

// =====================================================================================
(async () => {
  step("0. Preflight: pages, login, roster, reset");
  const PAGES = ["ai.html", "ai-founder.html", "ai-admin.html", "ai.js", "ai.css", "shim.js", "config.js", "index.html", "founder.html", "admin.html"];
  const pageRes = await Promise.all(PAGES.map((p) => req("GET", "/" + p)));
  check("All 10 pages/assets serve 200 (AI + GTM)", pageRes.every((r) => r.status === 200), PAGES.filter((p, i) => pageRes[i].status !== 200).join(", "));
  check("Wrong organizer password is rejected (401)", (await req("POST", "/api/login", { email: EMAIL, password: "wrong" })).status === 401);
  const lg = await req("POST", "/api/login", { email: EMAIL, password: PASS });
  if (!lg.json || !lg.json.token) { console.error(`Login failed for ${EMAIL}. Set ADMIN_EMAIL/ADMIN_PASSWORD to what server.js uses.`); process.exit(1); }
  TOKEN = lg.json.token; check("Organizer login works", true);
  const roster = ((await req("GET", "/api/roster", undefined, "admin")).json || []).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (roster.length < N_FILL + N_SKIP) { console.error(`Need >= ${N_FILL + N_SKIP} founders in data/roster.json (have ${roster.length}). Restart server.js after adding them.`); process.exit(1); }
  const F = roster.slice(0, N_FILL + N_SKIP), FILL = F.slice(0, N_FILL), SKIP = F.slice(N_FILL);
  check("Organizer reset of local DB", (await req("POST", "/api/reset", undefined, "admin")).status === 200);
  // GTM sentinels: prove the AI session never touches GTM data
  const GTM_STAGE = { stage: "b", at: 1, sentinel: "gtm" }, GTM_GROUPS = { session: "gtm", groups: [{ n: 1, members: [{ id: F[0].id, name: F[0].name }] }], at: 1 };
  await putD("stage", "gtm", GTM_STAGE, "admin"); await putD("groupsPublished", "gtm", GTM_GROUPS, "admin");
  await Promise.all(F.slice(0, 5).map((f, i) => putD("cards", f.id, { gtm: { a_startup: "Sentinel " + i } }, "admin")));

  // per-founder spec: #1 themes by THEME_COUNTS
  const SPEC = {}; { let i = 0; THEME_COUNTS.forEach((c, ti) => { for (let k = 0; k < c; k++, i++) SPEC[FILL[i].id] = specFor(i, ti); }); }

  step("1. Founders open the page before the session starts (41 concurrent)");
  const P = {}; F.forEach((f) => { P[f.id] = loadPage("founder", f.id); P[f.id].run(`uid=${JSON.stringify(f.id)}`); });
  const pre = await Promise.all(F.map((f) => syncFounder(P[f.id], f.id)));
  check("41/41 founders see 'not started yet'", pre.every((h) => h.includes("has not started yet")), pre.filter((h) => !h.includes("has not started yet")).length + " wrong");

  step("2. Organizer starts the session (admin page code: click 'Start')");
  const A = loadPage("admin", "admin");
  let ah = await syncAdmin(A);
  check("Admin page offers 'Start the AI in Business session'", ah.includes('data-aistage="a"') && ah.includes("Start the AI in Business session"));
  await A.fire("click", { "[data-aistage]": { dataset: { aistage: "a" } } });
  check("stage/ai = a on the server", ((await getD("stage", "ai", F[0].id)) || {}).stage === "a");

  step("3. Access rules (founder vs organizer)");
  const f0 = F[0].id, f1 = F[1].id;
  check("Founder cannot change the stage (403)", (await putD("stage", "ai", { stage: "b" }, f0)).status === 403);
  check("Founder cannot publish groups (403)", (await putD("groupsPublished", "ai", { groups: [] }, f0)).status === 403);
  check("Founder cannot read another founder's card (403)", (await req("GET", dpath("cards", f1), undefined, f0)).status === 403);
  check("Founder cannot write another founder's card (403)", (await putD("cards", f1, { ai: {} }, f0)).status === 403);
  const ownCards = await col("cards", f0);
  check("Founder listing cards only gets their own", ownCards.every((d) => d.id === f0), ownCards.length + " returned");
  check("Unknown founder id cannot write (403)", (await putD("cards", "nobody", { ai: {} }, "nobody")).status === 403);
  check("No identity cannot read the stage (403)", (await req("GET", dpath("stage", "ai"))).status === 403);
  const pw = await putD("plans", "ai__" + f1, { session: "ai", founderId: f1, ai_ps: "written by someone else" }, f0);
  const pr = await req("GET", dpath("plans", "ai__" + f1), undefined, f0);
  if (pw.status === 200 || pr.status === 200) warn("Worksheet B is private in the UI only", `the API lets any founder read (${pr.status}) and overwrite (${pw.status}) another founder's plans/ai__<id>. Same rule GTM relies on for shared plans. The founder page never does this; a founder with dev tools could.`);

  step("4. Founders fill Worksheet A through the page (38 concurrent, 3 skip, 10 edit, 1 tries invalid input)");
  let aForm = 0, aSaved = 0, aEdited = 0, valOk = true;
  await Promise.all(F.map(async (f, idx) => {
    const p = P[f.id], h = await syncFounder(p, f.id);
    if (h.includes('id="ai-form"') && h.includes("data-aisave")) aForm++;
    const sp = SPEC[f.id]; if (!sp) return; // skipper
    if (idx === 0) { // validation: same theme twice, then a missing #2
      setForm(p, "ai-form", "k", Object.assign({}, sp.A, { ai_t2: sp.A.ai_t1 })); await p.run("saveAiCard()");
      const m1 = p.el("ai-status").textContent;
      setForm(p, "ai-form", "k", Object.assign({}, sp.A, { ai_t2: "" })); await p.run("saveAiCard()");
      const m2 = p.el("ai-status").textContent, srv = await getD("cards", f.id, f.id);
      valOk = /different/.test(m1) && /Pick your/.test(m2) && !(srv && srv.ai);
    }
    setForm(p, "ai-form", "k", sp.A); await p.run("saveAiCard()");
    if (p.el("ai-body").innerHTML.includes("You are in")) aSaved++;
    if (idx < 10) { // edit once via "Edit my answers"
      p.run("aiEditing=true;renderAi()"); sp.A = Object.assign({}, sp.A, { ai_tools: sp.A.ai_tools + ", Notion AI" });
      setForm(p, "ai-form", "k", sp.A); await p.run("saveAiCard()"); if (p.el("ai-body").innerHTML.includes("Notion AI")) aEdited++;
    }
  }));
  check("41/41 founders see the Worksheet A form", aForm === 41, aForm + "/41");
  check("Validation blocks same #1/#2 and a missing #2 (nothing saved)", valOk);
  check("38/38 founders saved Worksheet A and see 'You are in'", aSaved === 38, aSaved + "/38");
  check("10/10 edits via 'Edit my answers' saved", aEdited === 10, aEdited + "/10");
  const srvCards = await col("cards", "admin");
  const aMatch = FILL.filter((f) => { const d = srvCards.find((x) => x.id === f.id); return d && d.data.ai && flat(d.data.ai) === flat(SPEC[f.id].A); }).length;
  check("Server holds exactly what each founder typed (38/38)", aMatch === 38, aMatch + "/38");
  const keptGtm = F.slice(0, 5).filter((f) => { const d = srvCards.find((x) => x.id === f.id); return d && d.data.gtm && d.data.gtm.a_startup; }).length;
  check("Saving Worksheet A keeps existing GTM card data (5/5)", keptGtm === 5, keptGtm + "/5");

  step("5. Organizer previews and forms groups (admin page code: click 'Form groups & start')");
  ah = await syncAdmin(A);
  check("Admin counter shows 38 saved", ah.includes("<b>38</b><span>saved Worksheet A"));
  check("Admin preview + Form button shown", ah.includes("Preview") && ah.includes('data-aiform="1"') && !ah.includes('data-aiform="1" disabled'));
  await A.fire("click", { "[data-aiform]": {} });
  const G = await getD("groupsPublished", "ai", "admin"), stB = await getD("stage", "ai", "admin");
  check("Forming wrote groupsPublished/ai and stage/ai = b", !!(G && G.groups && G.groups.length) && stB && stB.stage === "b");
  const elig = FILL.map((f) => ({ id: f.id, name: f.name, t1: SPEC[f.id].A.ai_t1, t2: SPEC[f.id].A.ai_t2 }));
  const placed = {}; G.groups.forEach((g) => g.members.forEach((m) => (placed[m.id] = (placed[m.id] || 0) + 1)));
  check("All 38 who saved A are placed exactly once", elig.every((p) => placed[p.id] === 1), elig.filter((p) => placed[p.id] !== 1).length + " not exactly once");
  check("The 3 who skipped A are not placed", SKIP.every((f) => !placed[f.id]));
  check(`Every group has 2-${AI.AI_MAX} people`, G.groups.every((g) => g.members.length >= 2 && g.members.length <= AI.AI_MAX), G.groups.map((g) => g.members.length).join(","));
  check("Grouping is deterministic (input order does not matter)", JSON.stringify(AI.buildAiGroups(elig)) === JSON.stringify(AI.buildAiGroups(elig.slice().reverse())));
  check("Page formed the same groups as the reference algorithm", JSON.stringify(G.groups) === JSON.stringify(AI.buildAiGroups(elig)));
  let got1 = 0, got2 = 0; G.groups.forEach((g) => g.members.forEach((m) => { const s = SPEC[m.id].A; if (s.ai_t1 === g.theme) got1++; else if (s.ai_t2 === g.theme) got2++; }));
  const GROUPS_FORMED = G.groups.map((g) => ({ n: g.n, theme: g.theme, size: g.members.length }));

  step("6. Organizer moves people (admin page code: Move dropdowns)");
  ah = await syncAdmin(A);
  check("Admin shows every group card + a Move dropdown per person", count(ah, 'class="aimove"') === 38 && count(ah, "<h3 style=\"margin:0 0 4px\">Group ") === G.groups.length);
  const findG = (gs, id) => gs.find((g) => g.members.some((m) => m.id === id));
  let gs = G.groups, big = gs.slice().sort((a, b) => b.members.length - a.members.length)[0], small = gs.filter((g) => g !== big && g.members.length < AI.AI_MAX).sort((a, b) => a.members.length - b.members.length)[0];
  const mv = big.members[0].id;
  await A.fire("change", { ".aimove": { dataset: { move: mv }, value: "g" + small.n } });
  gs = (await getD("groupsPublished", "ai", "admin")).groups;
  check("Move to another group saves", findG(gs, mv) && findG(gs, mv).n === small.n);
  const mvBack = findG(gs, mv).n, origN = big.n; await syncAdmin(A);
  const nGroups = gs.length, mv2 = gs[0].members[1].id, mv2From = gs[0].n;
  await A.fire("change", { ".aimove": { dataset: { move: mv2 }, value: "new" } });
  gs = (await getD("groupsPublished", "ai", "admin")).groups;
  check("Move to 'New group' adds a group", gs.length === nGroups + 1 && findG(gs, mv2).members.length === 1);
  await syncAdmin(A); await A.fire("change", { ".aimove": { dataset: { move: mv2 }, value: "g" + mv2From } });
  gs = (await getD("groupsPublished", "ai", "admin")).groups;
  check("Moving them back removes the empty group", gs.length === nGroups && findG(gs, mv2).n === mv2From);
  await syncAdmin(A); await A.fire("change", { ".aimove": { dataset: { move: mv }, value: "g" + origN } }); // undo first move
  const mv3 = gs[1].members[0].id, mv3From = gs[1].n;
  await syncAdmin(A); await A.fire("change", { ".aimove": { dataset: { move: mv3 }, value: "out" } });
  ah = await syncAdmin(A);
  check("'Remove from groups' puts them in the Not-in-a-group list", ah.includes("Not in a group (1)") && ah.includes(escHtml(F.find((f) => f.id === mv3).name)));
  await A.fire("change", { ".aimove": { dataset: { move: mv3 }, value: "g" + mv3From } });
  gs = (await getD("groupsPublished", "ai", "admin")).groups;
  check("Adding them back from the list works", findG(gs, mv3) && findG(gs, mv3).n === mv3From && !(await syncAdmin(A)).includes("Not in a group"));

  step("7. Late saver: a skipper saves A after groups exist, organizer places them");
  const late = SKIP[0], lp = P[late.id];
  let lh = await syncFounder(lp, late.id);
  check("Skipper sees 'did not save it' once groups exist", lh.includes("did not save it"));
  const lateA = { ai_tools: "ChatGPT", ai_comfort: "2", ai_t1: T[0], ai_t2: T[1] };
  await putD("cards", late.id, { ai: lateA }, late.id); // the A form is closed in stage b; this is a save that landed late
  lh = await syncFounder(lp, late.id);
  check("Late saver sees 'not placed yet'", lh.includes("not placed yet"));
  ah = await syncAdmin(A);
  check("Admin lists the late saver under Not in a group", ah.includes("Not in a group (1)") && ah.includes(escHtml(late.name)));
  const room = gs.find((g) => g.members.length < AI.AI_MAX);
  await A.fire("change", { ".aimove": { dataset: { move: late.id }, value: "g" + room.n } });
  lh = await syncFounder(lp, late.id);
  check("Late saver now sees their group and Worksheet B", lh.includes("Your group · Group " + room.n) && lh.includes('id="ai-bform"'));
  SPEC[late.id] = { A: lateA, B: { ai_ps: BANK[0][0], ai_s1: BANK[0][3], ai_step: BANK[0][5] }, partial: true };
  const PLACED = FILL.concat([late]);

  step(`8. Founders fill Worksheet B through the page (${PLACED.length} concurrent, 3 saves each, double-click Save, build pitch)`);
  let bView = 0, bGroupOk = 0, bSaved = 0, pitchOk = 0, unplacedOk = 0;
  const gNow = (await getD("groupsPublished", "ai", "admin")).groups;
  await Promise.all(F.map(async (f) => {
    const p = P[f.id], h = await syncFounder(p, f.id), sp = SPEC[f.id];
    if (!placed[f.id] && f.id !== late.id) { if (h.includes("did not save it")) unplacedOk++; return; }
    if (h.includes('id="ai-bform"')) bView++;
    const g = findG(gNow, f.id);
    if (g && h.includes(`Group ${g.n} — ${escHtml(g.theme)}`) && g.members.every((m) => h.includes(escHtml(m.name))) && h.includes("(you)")) bGroupOk++;
    // 3 saves: first draft, an edit, then a double-click (two concurrent saves of the final version)
    const full = (o) => Object.assign(Object.fromEntries(AI.BKEYS.map((k) => [k, ""])), o); // the real form always has every field
    setForm(p, "ai-bform", "kb", full(Object.assign({}, sp.B, { ai_step: "" }))); await p.run("saveB()");
    setForm(p, "ai-bform", "kb", full(sp.B)); await Promise.all([p.run("saveB()"), p.run("saveB()")]);
    const after = p.el("ai-body").innerHTML;
    const srv = await getD("plans", "ai__" + f.id, f.id);
    if (srv && flat(pickB(srv)) === flat(Object.assign(Object.fromEntries(AI.BKEYS.map((k) => [k, ""])), sp.B)) && after.includes('data-pitch="1"') && /Saved/.test(p.el("ai-bstatus").textContent)) bSaved++;
    p.run("showPitch()");
    const want = AI.buildAiPitch(sp.B), ph = p.el("ai-pitch").innerHTML;
    if (want && ph.includes("Your 1-minute pitch") && want.split("\n\n").every((para) => ph.includes(escHtml(para)))) pitchOk++;
  }));
  check(`${PLACED.length}/${PLACED.length} placed founders see Worksheet B`, bView === PLACED.length, bView + "");
  check(`${PLACED.length}/${PLACED.length} see the right group number, theme and all members`, bGroupOk === PLACED.length, bGroupOk + "");
  check("2 remaining skippers still see 'did not save it'", unplacedOk === 2, unplacedOk + "/2");
  check(`${PLACED.length}/${PLACED.length} final B saved exactly (after edit + double-click)`, bSaved === PLACED.length, bSaved + "");
  check(`${PLACED.length}/${PLACED.length} 'Build my pitch' shows the full pitch`, pitchOk === PLACED.length, pitchOk + "");

  step("9. Polling storm: 41 founders x 10 refreshes of stage + groups (820 requests at once)");
  const before = lat.length, sStorm = Date.now();
  const storm = await Promise.all(F.flatMap((f) => Array.from({ length: 10 }, () => [req("GET", dpath("stage", "ai"), undefined, f.id), req("GET", dpath("groupsPublished", "ai"), undefined, f.id)]).flat()));
  const stormMs = Date.now() - sStorm, stormLat = lat.slice(before).sort((a, b) => a - b);
  check("820/820 storm requests answered 200", storm.every((r) => r.status === 200), storm.filter((r) => r.status !== 200).length + " failed");

  step("10. Organizer reviews Worksheet B (admin page code)");
  ah = await syncAdmin(A);
  check(`Admin 'Worksheet B filled' = ${PLACED.length}/${PLACED.length}`, ah.includes(`<b>${PLACED.length}/${PLACED.length}</b><span>Worksheet B filled`));
  check(`Admin shows a pitch for all ${PLACED.length} founders`, count(ah, "<b>Pitch</b>") === PLACED.length, count(ah, "<b>Pitch</b>") + "");
  check("Admin per-group B counters all full", gNow.every((g) => ah.includes(`Worksheet B: ${g.members.length}/${g.members.length} filled`)));

  step("11. Organizer reopens Worksheet A, then forms groups again");
  await syncAdmin(A); await A.fire("click", { "[data-aistage]": { dataset: { aistage: "a" } } });
  const reo = await syncFounder(P[FILL[3].id], FILL[3].id);
  check("After reopening, founders see their saved A ('You are in')", reo.includes("You are in"));
  const gBefore = JSON.stringify((await getD("groupsPublished", "ai", "admin")).groups);
  ah = await syncAdmin(A);
  const backBtn = ah.includes("Back to Worksheet B") || ah.includes("data-aistage=\"b\"");
  await A.fire("click", { "[data-aiform]": {} });
  const gAfter = (await getD("groupsPublished", "ai", "admin")).groups;
  const plansKept = (await col("plans", "admin")).filter((d) => d.id.indexOf("ai__") === 0).length;
  check("Re-forming keeps everyone's Worksheet B answers", plansKept === PLACED.length, plansKept + "");
  if (!backBtn && JSON.stringify(gAfter) !== gBefore) warn("Reopening A has no way back to B without re-forming", "the only button in stage A is 'Form groups', which rebuilds groups from answers and drops manual moves (late saver re-placed by the algorithm, other moves lost).");

  step("12. GTM isolation");
  check("stage/gtm untouched", flat(await getD("stage", "gtm", "admin")) === flat(GTM_STAGE));
  check("groupsPublished/gtm untouched", JSON.stringify(await getD("groupsPublished", "gtm", "admin")) === JSON.stringify(GTM_GROUPS));
  const endCards = await col("cards", "admin");
  check("GTM card data still there for 5/5 founders", F.slice(0, 5).every((f) => { const d = endCards.find((x) => x.id === f.id); return d && d.data.gtm && d.data.gtm.a_startup; }));
  let gitSame = null; try { execSync("git diff --quiet main -- founder.html admin.html", { cwd: __dirname }); gitSame = true; } catch (e) { gitSame = false; }
  check("GTM founder.html / admin.html identical to main", gitSame);

  // ---------- report ----------
  const L = lat.slice().sort((a, b) => a - b), pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  console.log("\n=== Groups formed (before manual moves) ===");
  GROUPS_FORMED.forEach((g) => console.log(`  Group ${g.n}  ${g.theme.padEnd(30)} ${g.size}`));
  console.log(`  ${got1}/38 got their #1 theme, ${got2}/38 their #2, ${38 - got1 - got2} placed elsewhere`);
  console.log("\n=== Load ===");
  console.log(`  ${lat.length} requests, p50 ${pct(L, 0.5)} ms, p95 ${pct(L, 0.95)} ms, max ${L[L.length - 1]} ms, 5xx ${http5xx}, network errors ${httpFail}`);
  console.log(`  storm: 820 requests in ${stormMs} ms (p95 ${pct(stormLat, 0.95)} ms)`);
  console.log("\n=== Checks ===");
  results.forEach((r) => console.log(`  ${r.s}  ${r.name}${r.detail && r.s !== "PASS" ? "  — " + r.detail : ""}`));
  const nF = results.filter((r) => r.s === "FAIL").length, nW = results.filter((r) => r.s === "WARN").length;
  console.log(`\n${results.length - nF - nW} pass, ${nF} fail, ${nW} warn  ·  ${secs()}  ·  session left in the local DB: open ai-admin.html to look.`);
  process.exit(nF || http5xx || httpFail ? 1 : 0);
})().catch((e) => { console.error("Crashed:", e); process.exit(1); });
