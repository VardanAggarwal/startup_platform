// Talks to Supabase (config.js sets WORKSHOP_CONFIG) or, when that is empty, to local server.js (SQLite). Founders pick their name; organizers sign in with email + password.
(function () {
  const ADMIN = window.WORKSHOP_MODE === "admin";
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
  const founderId = () => store("ws_founder");
  const token = () => store("ws_admin");
  const CFG = window.WORKSHOP_CONFIG && window.WORKSHOP_CONFIG.url ? window.WORKSHOP_CONFIG : null;
  const POLL = CFG ? (ADMIN ? 15000 : 60000) : 3000; // organizers (few) check every 15 s while visible so rating progress stays current; founders rely on pings, 60 s fallback. // Supabase: no constant pinging. Refresh on load, after your own saves, when you return to the tab, on page change, via the Refresh button, and a slow 60 s check while the tab is open.
  // Supabase transport: maps the same /api/... calls onto PostgREST (see schema.sql). Access rules are enforced by RLS, not here.
  async function sbApi(method, url, body) {
    const p = url.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent), rest = CFG.url + "/rest/v1/";
    const h = { apikey: CFG.key, "Content-Type": "application/json" };
    if (ADMIN && token()) h["x-admin-token"] = token();
    if (!ADMIN && founderId()) h["x-founder-id"] = founderId();
    const call = async (m, u, b, extra) => {
      let r, t;
      for (let i = 0; ; i++) { // busy moments (everyone opening at once): retry network errors, 429 and 5xx with a growing, random wait
        try { const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000); try { r = await fetch(u, { method: m, headers: Object.assign({}, h, extra), body: b === undefined ? undefined : JSON.stringify(b), signal: ac.signal }); t = await r.text(); } finally { clearTimeout(to); } if (r.ok || (r.status < 500 && r.status !== 429) || i >= 4) break; } catch (e) { if (i >= 4) throw e; }
        await new Promise((ok) => setTimeout(ok, 400 * Math.pow(2, i) + Math.random() * 600));
      }
      if (!r.ok) { let c = ""; try { c = JSON.parse(t).code; } catch (e) {} const e = new Error("HTTP " + r.status); e.status = c === "P0002" ? 404 : r.status; throw e; }
      return t ? JSON.parse(t) : null;
    };
    const rpc = (n, a) => call("POST", rest + "rpc/" + n, a || {});
    const q = encodeURIComponent;
    if (p[1] === "login") { const t = await rpc("workshop_admin_login", { p_email: body.email, p_password: body.password }); if (!t) { const e = new Error("HTTP 401"); e.status = 401; throw e; } return { token: t }; }
    if (p[1] === "roster") return rpc("workshop_roster");
    if (p[1] === "me") return rpc("workshop_me");
    if (p[1] === "manifests") return rpc("workshop_manifests");
    if (p[1] === "col") return call("GET", rest + "workshop_kv?collection=eq." + q(p[2]) + "&select=id,data");
    if (p[1] === "doc") {
      const [coll, id] = [p[2], p[3]];
      if (method === "GET") { const r = await call("GET", rest + "workshop_kv?collection=eq." + q(coll) + "&id=eq." + q(id) + "&select=data"); return r.length ? { exists: true, data: r[0].data } : { exists: false }; }
      if (method === "PUT") { await call("POST", rest + "workshop_kv?on_conflict=collection,id", { collection: coll, id, data: body, updated_at: new Date().toISOString() }, { Prefer: "resolution=merge-duplicates,return=minimal" }); return { ok: true }; }
      if (method === "PATCH") { await rpc("workshop_kv_patch", { p_coll: coll, p_id: id, p_patch: body }); return { ok: true }; }
    }
    throw new Error("unsupported " + url);
  }
  async function api(method, url, body) {
    if (CFG) return sbApi(method, url, body);
    const h = { "Content-Type": "application/json" };
    if (ADMIN && token()) h.Authorization = "Bearer " + token();
    if (!ADMIN && founderId()) h["x-founder-id"] = founderId();
    const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const clean = (o) => JSON.parse(JSON.stringify(o == null ? {} : o));
  const rows = (a) => ({ docs: a.map((r) => ({ id: r.id, data: () => r.data, exists: true })) });
  // Cache: the last good answer for each list/document is kept in localStorage and shown instantly while the fresh one loads.
  const who = () => (ADMIN ? "a" : founderId() || "x");
  const ckey = (k) => "wsc:" + who() + ":" + k;
  const cget = (k) => { try { const s = localStorage.getItem(ckey(k)); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const cput = (k, v) => { try { localStorage.setItem(ckey(k), JSON.stringify(v)); } catch (e) {} };
  const clearCache = () => { try { Object.keys(localStorage).filter((k) => k.indexOf("wsc:") === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {} };
  const ticks = new Set();
  // Tab focus / page change only refetch what has not been fetched in the last 20 s (the Refresh button always refetches everything).
  const COOL = 20000;
  const refreshAll = (force) => { const n = Date.now(); ticks.forEach((t) => { if (force || n - (t.at || 0) >= COOL) t.run(); }); };
  if (CFG) { document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); }); window.addEventListener("focus", () => refreshAll()); window.addEventListener("hashchange", () => refreshAll()); }
  // Own save or a Realtime ping for one document: lists fetch just that document, single-document watchers re-read themselves.
  const bump = (coll, id) => ticks.forEach((t) => { if (t.coll === coll) (t.ev && id !== undefined ? t.ev(id) : t.run()); });
  const watch = (get, cb, errCb, key, ev) => {
    let last = null, dead = false;
    if (key) { const c = cget(key); if (c !== null) { last = JSON.stringify(c); cb(c); } }
    const apply = (v) => { const j = JSON.stringify(v); if (key) cput(key, v); if (j !== last) { last = j; if (!dead) cb(v); } };
    const tick = async () => { reg.at = Date.now(); try { apply(await get()); } catch (e) { if (last !== "err") { last = "err"; errCb && errCb(e); } } };
    const reg = { coll: key ? key.slice(2).split("/")[0] : null, run: tick, ev: ev ? async (id) => { try { const v = await ev(id); if (v) apply(v); else await tick(); } catch (e) {} } : null }; ticks.add(reg);
    tick(); const t = setInterval(() => { if (!(CFG && document.hidden)) tick(); }, POLL); return () => { dead = true; clearInterval(t); ticks.delete(reg); };
  };
  // Realtime ping (schema.sql: workshop_notify trigger). The ping carries only {collection, id}; each page then fetches that one document.
  const pend = {};
  function onPing(p) {
    if (!p || !p.c) return; const k = p.c + "/" + p.id; clearTimeout(pend[k]);
    pend[k] = setTimeout(() => { delete pend[k]; bump(p.c, p.id); }, 300 + Math.random() * 900); // coalesce rapid saves, spread 50 pages apart
  }
  function startRealtime() {
    const go = () => {
      try {
        const rt = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 10 } } });
        rt.channel("workshop").on("broadcast", { event: "changed" }, (m) => onPing(m.payload)).subscribe(); // a Wi-Fi blink does not refetch anything; the 60 s check, tab focus (after 20 s) or the Refresh button catch up
      } catch (e) {}
    };
    if (window.supabase) return go();
    const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"; sc.integrity = "sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug"; sc.crossOrigin = "anonymous"; sc.onload = go; document.head.appendChild(sc);
  }
  if (CFG) startRealtime();
  // A founder only needs live plan edits from their own group; skip fetching plans of other groups (the 60 s check still refreshes the list).
  const inMyGroup = (id) => {
    const fid = String(id).split("__")[1], me = founderId();
    if (!fid || !me || fid === me) return true;
    const gp = cget("c:groupsPublished"), d = gp && (gp.find((x) => x.id === "gtm") || {}).data;
    if (!d || !d.groups) return true;
    const gid = (m) => (m && m.id) || m, g = d.groups.find((x) => (x.members || []).some((m) => gid(m) === me));
    return !g || (g.members || []).some((m) => gid(m) === fid);
  };
  function docRef(coll, id) {
    const ref = {
      async get() {
        if (coll === "manifest") { const m = ADMIN ? (await api("GET", "/api/manifests")).find((x) => x.id === id) : await api("GET", "/api/me"); return { id, exists: !!(m && m.id === id), data: () => m }; }
        const r = await api("GET", "/api/doc/" + coll + "/" + encodeURIComponent(id));
        return { id, exists: !!r.exists, data: () => r.data };
      },
      async set(o) { if (coll === "manifest") return; await api("PUT", "/api/doc/" + coll + "/" + encodeURIComponent(id), clean(o)); bump(coll, id); },
      async update(o) { if (coll === "manifest") return; await api("PATCH", "/api/doc/" + coll + "/" + encodeURIComponent(id), clean(o)); bump(coll, id); },
      onSnapshot(cb, errCb) { return watch(async () => { const s = await ref.get(); return { exists: s.exists, data: s.data() }; }, (v) => cb({ id, exists: v.exists, data: () => v.data }), errCb, "d:" + coll + "/" + id); },
    };
    return ref;
  }
  function colRef(coll) {
    const ref = {
      async get() {
        if (coll === "roster") return rows((await api("GET", "/api/roster")).map((r) => ({ id: r.id, data: { name: r.name, program: r.program, startup: r.startup || "" } })));
        if (coll === "manifest") return rows((await api("GET", "/api/manifests")).map((m) => ({ id: m.id, data: m })));
        return rows(await api("GET", "/api/col/" + coll));
      },
      onSnapshot(cb, errCb) {
        let cur = null;
        const arr = () => Object.keys(cur).map((id) => ({ id, data: cur[id] }));
        return watch(async () => { const a = (await ref.get()).docs.map((d) => ({ id: d.id, data: d.data() })); cur = Object.fromEntries(a.map((x) => [x.id, x.data])); return a; }, (a) => cb(rows(a)), errCb, "c:" + coll,
          CFG && coll !== "roster" && coll !== "manifest" ? async (id) => { if (!cur) return null; if (coll === "plans" && !ADMIN && !inMyGroup(id)) return arr(); const r = await api("GET", "/api/doc/" + coll + "/" + encodeURIComponent(id)); if (r.exists) cur[id] = r.data; else delete cur[id]; return arr(); } : null);
      },
    };
    return ref;
  }
  const db = { collection: colRef, doc(p) { const i = p.indexOf("/"); return docRef(p.slice(0, i), p.slice(i + 1)); } };
  let adminOk = false;
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const facName = () => store("ws_facname");
  const user = { id: async () => (ADMIN ? "fac-" + slug(facName() || "facilitator") : founderId()), canEdit: () => adminOk };
  const downloads = { async save({ filename, data, type }) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: type || "text/csv;charset=utf-8" })); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); } };

  const css = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:var(--bg,#fbf8f3);color:var(--ink,#1f2a2e);font-family:Inter,system-ui,sans-serif;overflow:auto";
  const inp = "min-height:48px;padding:0 14px;font-size:16px;border:1px solid #9aa;border-radius:10px;background:transparent;color:inherit;width:100%;box-sizing:border-box";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function overlay(html) { let o = document.getElementById("ws-ov"); if (o) o.remove(); o = document.createElement("div"); o.id = "ws-ov"; o.style.cssText = css; o.innerHTML = html; document.body.appendChild(o); return o; }
  function chip(text, fn) { if (document.getElementById("ws-out")) return; const b = document.createElement("button"); b.id = "ws-out"; b.textContent = text; b.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9000;min-height:36px;padding:0 12px;border-radius:18px;border:1px solid #9aa;background:var(--card,#fff);color:inherit;font-size:13px"; b.onclick = fn; document.body.appendChild(b); }
  function refreshChip() { if (!CFG || document.getElementById("ws-ref")) return; const b = document.createElement("button"); b.id = "ws-ref"; b.textContent = "↻ Refresh"; b.style.cssText = "position:fixed;right:12px;bottom:64px;z-index:9000;min-height:36px;padding:0 12px;border-radius:18px;border:1px solid #9aa;background:var(--card,#fff);color:inherit;font-size:13px"; b.onclick = () => { b.textContent = "Refreshing…"; refreshAll(true); setTimeout(() => (b.textContent = "↻ Refresh"), 1200); }; document.body.appendChild(b); }
  async function pickFounder() {
    if (document.getElementById("ws-ov")) return;
    const srt = (l) => l.sort((a, b) => a.name.localeCompare(b.name));
    let list = []; try { const c = localStorage.getItem("wsc:roster"); if (c) list = srt(JSON.parse(c)); } catch (e) {}
    if (!list.length) try { list = srt(await api("GET", "/api/roster")); localStorage.setItem("wsc:roster", JSON.stringify(list)); } catch (e) {}
    const o = overlay('<div style="width:100%;max-width:440px;display:grid;gap:12px"><h1 style="font:600 26px/1.2 Bricolage Grotesque,Inter,sans-serif;margin:0">Who are you?</h1><p style="margin:0;font-size:14px;opacity:.8">Pick your name. This is a test build, so there is no sign-in yet.</p><input id="ws-q" type="search" placeholder="Search your name" style="' + inp + '"><div id="ws-list" style="display:grid;gap:8px"></div></div>');
    const box = o.querySelector("#ws-list");
    const draw = (q) => { const f = list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())); box.innerHTML = f.length ? f.map((p) => '<button data-id="' + esc(p.id) + '" style="text-align:left;min-height:52px;padding:8px 14px;border:1px solid #9aa;border-radius:10px;background:var(--card,#fff);color:inherit;font-size:15px"><b>' + esc(p.name) + '</b><br><span style="font-size:13px;opacity:.75">' + esc(p.program) + "</span></button>").join("") : '<p style="font-size:14px">' + (list.length ? "No match." : "The founder list could not be loaded. Is server.js running?") + "</p>"; };
    draw(""); api("GET", "/api/roster").then((l) => { try { localStorage.setItem("wsc:roster", JSON.stringify(l)); } catch (e) {} if (JSON.stringify(srt(l.slice())) !== JSON.stringify(list)) { list = srt(l); draw(o.querySelector("#ws-q").value); } }).catch(() => {});
    o.querySelector("#ws-q").addEventListener("input", (e) => draw(e.target.value));
    box.addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (!b) return; store("ws_founder", b.dataset.id); location.reload(); });
  }
  function adminLogin() {
    if (document.getElementById("ws-ov")) return;
    const o = overlay('<form id="ws-f" style="width:100%;max-width:380px;display:grid;gap:12px"><h1 style="font:600 26px/1.2 Bricolage Grotesque,Inter,sans-serif;margin:0">Organizer sign in</h1><input id="ws-n" type="text" required autocomplete="name" placeholder="Your name (shown on your ratings)" style="' + inp + '"><input id="ws-e" type="email" required autocomplete="username" placeholder="Email" style="' + inp + '"><input id="ws-p" type="password" required autocomplete="current-password" placeholder="Password" style="' + inp + '"><button id="ws-b" type="submit" style="min-height:48px;border:0;border-radius:10px;background:#0f6b6b;color:#fff;font-size:16px;font-weight:600">Sign in</button><p id="ws-m" role="status" style="margin:0;font-size:14px;min-height:20px"></p></form>');
    const m = o.querySelector("#ws-m"), b = o.querySelector("#ws-b");
    o.querySelector("#ws-f").addEventListener("submit", async (e) => { e.preventDefault(); b.disabled = true; m.textContent = "Signing in…"; try { const r = await api("POST", "/api/login", { email: o.querySelector("#ws-e").value.trim(), password: o.querySelector("#ws-p").value }); store("ws_admin", r.token); store("ws_facname", o.querySelector("#ws-n").value.trim()); location.reload(); } catch (err) { m.textContent = "Email or password is wrong."; b.disabled = false; } });
  }
  window.claude = {
    use: async (name) => {
      if (name === "downloads") return downloads;
      if (ADMIN) {
        if (!token()) { adminLogin(); return null; }
        if (!facName()) { const n = (window.prompt("Your name (shown on your ratings)") || "Facilitator").trim(); store("ws_facname", n); }
        window.WORKSHOP_FAC = facName();
        try { await api("GET", "/api/manifests"); adminOk = true; } catch (e) { store("ws_admin", null); adminLogin(); return null; }
        chip("Sign out", () => { clearCache(); store("ws_admin", null); location.reload(); });
      } else {
        if (!founderId()) { await pickFounder(); return null; }
        chip("Not you? Switch person", () => { clearCache(); store("ws_founder", null); location.reload(); });
      }
      refreshChip();
      return name === "db" ? db : name === "user" ? user : null;
    },
  };
})();
