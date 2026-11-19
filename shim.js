// Talks to Supabase (config.js sets WORKSHOP_CONFIG) or, when that is empty, to local server.js (SQLite). Founders pick their name; organizers sign in with email + password.
(function () {
  const ADMIN = window.WORKSHOP_MODE === "admin";
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
  const founderId = () => store("ws_founder");
  const token = () => store("ws_admin");
  const CFG = window.WORKSHOP_CONFIG && window.WORKSHOP_CONFIG.url ? window.WORKSHOP_CONFIG : null;
  const POLL = CFG ? 5000 : 3000;
  // Supabase transport: maps the same /api/... calls onto PostgREST (see schema.sql). Access rules are enforced by RLS, not here.
  async function sbApi(method, url, body) {
    const p = url.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent), rest = CFG.url + "/rest/v1/";
    const h = { apikey: CFG.key, "Content-Type": "application/json" };
    if (ADMIN && token()) h["x-admin-token"] = token();
    if (!ADMIN && founderId()) h["x-founder-id"] = founderId();
    const call = async (m, u, b, extra) => {
      const r = await fetch(u, { method: m, headers: Object.assign({}, h, extra), body: b === undefined ? undefined : JSON.stringify(b) });
      const t = await r.text();
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
  const ticks = new Set();
  const bump = (coll) => ticks.forEach((t) => { if (t.coll === coll) t.run(); });
  const watch = (get, cb, errCb, key) => {
    let last = null, dead = false;
    if (key) { const c = cget(key); if (c !== null) { last = JSON.stringify(c); cb(c); } }
    const tick = async () => { try { const v = await get(); const j = JSON.stringify(v); if (key) cput(key, v); if (j !== last) { last = j; if (!dead) cb(v); } } catch (e) { if (last !== "err") { last = "err"; errCb && errCb(e); } } };
    const reg = { coll: key ? key.slice(2).split("/")[0] : null, run: tick }; ticks.add(reg);
    tick(); const t = setInterval(tick, POLL); return () => { dead = true; clearInterval(t); ticks.delete(reg); };
  };
  function docRef(coll, id) {
    const ref = {
      async get() {
        if (coll === "manifest") { const m = ADMIN ? (await api("GET", "/api/manifests")).find((x) => x.id === id) : await api("GET", "/api/me"); return { id, exists: !!(m && m.id === id), data: () => m }; }
        const r = await api("GET", "/api/doc/" + coll + "/" + encodeURIComponent(id));
        return { id, exists: !!r.exists, data: () => r.data };
      },
      async set(o) { if (coll === "manifest") return; await api("PUT", "/api/doc/" + coll + "/" + encodeURIComponent(id), clean(o)); bump(coll); },
      async update(o) { if (coll === "manifest") return; await api("PATCH", "/api/doc/" + coll + "/" + encodeURIComponent(id), clean(o)); bump(coll); },
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
      onSnapshot(cb, errCb) { return watch(async () => (await ref.get()).docs.map((d) => ({ id: d.id, data: d.data() })), (a) => cb(rows(a)), errCb, "c:" + coll); },
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
        chip("Sign out", () => { store("ws_admin", null); location.reload(); });
      } else {
        if (!founderId()) { await pickFounder(); return null; }
        chip("Not you? Switch person", () => { store("ws_founder", null); location.reload(); });
      }
      return name === "db" ? db : name === "user" ? user : null;
    },
  };
})();
