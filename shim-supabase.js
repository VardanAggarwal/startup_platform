// Backs the workshop pages with this project's Supabase (same database).
// Founder mode: no sign-in. The founder picks their name; the id is sent as the x-founder-id header (TEST MODE, see schema.sql).
// Admin mode: email + password sign-in; access needs the admin role.
(function () {
  const cfg = window.WORKSHOP_CONFIG;
  const ADMIN = window.WORKSHOP_MODE === "admin";
  const isNewKey = (k) => k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
  const sb = supabase.createClient(cfg.url, cfg.key, {
    global: {
      fetch: (input, init) => {
        const h = new Headers(input instanceof Request ? input.headers : undefined);
        if (init && init.headers) new Headers(init.headers).forEach((v, k) => h.set(k, v));
        if (isNewKey(cfg.key) && h.get("Authorization") === "Bearer " + cfg.key) h.delete("Authorization");
        h.set("apikey", cfg.key);
        if (!ADMIN) { const f = localStorage.getItem("ws_founder"); if (f) h.set("x-founder-id", f); }
        return fetch(input, Object.assign({}, init, { headers: h }));
      },
    },
    auth: { persistSession: ADMIN, autoRefreshToken: ADMIN, detectSessionInUrl: false },
  });
  window.workshopSb = sb;
  const clean = (o) => JSON.parse(JSON.stringify(o == null ? {} : o));
  const rows = (arr) => ({ docs: arr.map((r) => ({ id: r.id, data: () => r.data, exists: true })) });
  const one = (row, id) => ({ id, exists: !!row, data: () => (row ? row.data : undefined) });
  const poll = (fn, ms) => { fn(); const t = setInterval(fn, ms); return () => clearInterval(t); };
  const now = () => new Date().toISOString();
  const founderId = () => { try { return localStorage.getItem("ws_founder"); } catch (e) { return null; } };

  async function listRoster() {
    const { data, error } = await sb.rpc("workshop_roster");
    if (error) throw error;
    return (data || []).map((r) => ({ id: r.id, data: { name: r.name, program: r.program || "", startup: r.startup || "" } }));
  }
  async function myManifest() {
    const { data, error } = await sb.rpc("workshop_me_for", { p_id: founderId() });
    if (error) throw error;
    return data;
  }
  async function allManifests() {
    const { data, error } = await sb.rpc("workshop_manifests");
    if (error) throw error;
    return (data || []).map((d) => ({ id: d.id, data: d }));
  }

  function docRef(coll, id) {
    const ref = {
      async get() {
        if (coll === "manifest") { const m = await myManifest(); return one(m && m.rosterId === id ? { data: m } : null, id); }
        const { data, error } = await sb.from("workshop_kv").select("data").eq("collection", coll).eq("id", id).maybeSingle();
        if (error) throw error;
        return one(data, id);
      },
      async set(obj) {
        if (coll === "manifest") return;
        const { error } = await sb.from("workshop_kv").upsert({ collection: coll, id, data: clean(obj), updated_at: now() });
        if (error) throw error;
      },
      async update(patch) {
        if (coll === "manifest") return;
        const cur = await ref.get();
        if (!cur.exists) throw new Error("No document: " + coll + "/" + id);
        const { error } = await sb.from("workshop_kv").update({ data: Object.assign({}, cur.data(), clean(patch)), updated_at: now() }).eq("collection", coll).eq("id", id);
        if (error) throw error;
      },
      onSnapshot(cb, errCb) {
        const push = async () => { try { cb(await ref.get()); } catch (e) { errCb && errCb(e); } };
        if (coll === "manifest") return poll(push, 60000);
        const stop = poll(push, 15000); // realtime below; polling covers rows the anon role cannot stream
        const ch = sb.channel("d-" + coll + "-" + id + "-" + Math.random().toString(36).slice(2))
          .on("postgres_changes", { event: "*", schema: "public", table: "workshop_kv", filter: "collection=eq." + coll }, (p) => {
            const rid = (p.new && p.new.id) || (p.old && p.old.id);
            if (!rid || rid === id) push();
          }).subscribe();
        return () => { stop(); sb.removeChannel(ch); };
      },
    };
    return ref;
  }
  function colRef(coll) {
    const ref = {
      async get() {
        if (coll === "roster") return rows(await listRoster());
        if (coll === "manifest") return rows(await allManifests());
        const { data, error } = await sb.from("workshop_kv").select("id,data").eq("collection", coll);
        if (error) throw error;
        return rows(data || []);
      },
      onSnapshot(cb, errCb) {
        const push = async () => { try { cb(await ref.get()); } catch (e) { errCb && errCb(e); } };
        if (coll === "manifest" || coll === "roster") return poll(push, 60000);
        const stop = poll(push, 15000);
        const ch = sb.channel("c-" + coll + "-" + Math.random().toString(36).slice(2))
          .on("postgres_changes", { event: "*", schema: "public", table: "workshop_kv", filter: "collection=eq." + coll }, push)
          .subscribe();
        return () => { stop(); sb.removeChannel(ch); };
      },
    };
    return ref;
  }
  const db = { collection: colRef, doc(path) { const i = path.indexOf("/"); return docRef(path.slice(0, i), path.slice(i + 1)); } };
  let isAdmin = null, adminId = null;
  const user = { id: async () => (ADMIN ? adminId : founderId()), canEdit: () => !!isAdmin };
  const downloads = {
    async save({ filename, data, type }) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: type || "text/csv;charset=utf-8" }));
      a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
  };

  /* ---------- UI: overlays ---------- */
  const css = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:var(--bg,#fbf8f3);color:var(--ink,#1f2a2e);font-family:Inter,system-ui,sans-serif;overflow:auto";
  const inp = "min-height:48px;padding:0 14px;font-size:16px;border:1px solid #9aa;border-radius:10px;background:transparent;color:inherit;width:100%;box-sizing:border-box";
  const btn = "min-height:48px;border:0;border-radius:10px;background:#0f6b6b;color:#fff;font-size:16px;font-weight:600;padding:0 16px";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function overlay(html) { let o = document.getElementById("ws-ov"); if (o) o.remove(); o = document.createElement("div"); o.id = "ws-ov"; o.style.cssText = css; o.innerHTML = html; document.body.appendChild(o); return o; }
  function chip(text, action) {
    const b = document.createElement("button");
    b.textContent = text; b.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9000;min-height:36px;padding:0 12px;border-radius:18px;border:1px solid #9aa;background:var(--card,#fff);color:inherit;font-size:13px";
    b.onclick = action; document.body.appendChild(b);
  }

  async function pickFounder() {
    if (document.getElementById("ws-ov")) return;
    let list = [];
    try { list = (await listRoster()).map((r) => Object.assign({ id: r.id }, r.data)).sort((a, b) => a.name.localeCompare(b.name)); } catch (e) {}
    const o = overlay('<div style="width:100%;max-width:440px;display:grid;gap:12px"><h1 style="font:600 26px/1.2 Bricolage Grotesque,Inter,sans-serif;margin:0">Who are you?</h1>' +
      '<p style="margin:0;font-size:14px;opacity:.8">Pick your name. This is a test build, so there is no sign-in yet.</p>' +
      '<input id="ws-q" type="search" placeholder="Search your name" style="' + inp + '"><div id="ws-list" style="display:grid;gap:8px"></div></div>');
    const box = o.querySelector("#ws-list");
    const draw = (q) => {
      const f = list.filter((p) => (p.name + " " + p.startup).toLowerCase().includes(q.toLowerCase())).slice(0, 80);
      box.innerHTML = f.length ? f.map((p) => '<button data-id="' + esc(p.id) + '" style="text-align:left;min-height:52px;padding:8px 14px;border:1px solid #9aa;border-radius:10px;background:var(--card,#fff);color:inherit;font-size:15px"><b>' + esc(p.name) + '</b><br><span style="font-size:13px;opacity:.75">' + esc(p.startup) + (p.program ? " · " + esc(p.program) : "") + "</span></button>").join("") :
        '<p style="font-size:14px">' + (list.length ? "No match." : "The founder list could not be loaded.") + "</p>";
    };
    draw("");
    o.querySelector("#ws-q").addEventListener("input", (e) => draw(e.target.value));
    box.addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (!b) return; localStorage.setItem("ws_founder", b.dataset.id); location.reload(); });
  }

  function adminLogin() {
    if (document.getElementById("ws-ov")) return;
    const o = overlay('<form id="ws-f" style="width:100%;max-width:380px;display:grid;gap:12px"><h1 style="font:600 26px/1.2 Bricolage Grotesque,Inter,sans-serif;margin:0">Organizer sign in</h1>' +
      '<input id="ws-e" type="email" required autocomplete="username" placeholder="Email" style="' + inp + '">' +
      '<input id="ws-p" type="password" required autocomplete="current-password" placeholder="Password" style="' + inp + '">' +
      '<button id="ws-b" type="submit" style="' + btn + '">Sign in</button><p id="ws-m" role="status" style="margin:0;font-size:14px;min-height:20px"></p></form>');
    const m = o.querySelector("#ws-m"), b = o.querySelector("#ws-b");
    o.querySelector("#ws-f").addEventListener("submit", async (e) => {
      e.preventDefault(); b.disabled = true; m.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: o.querySelector("#ws-e").value.trim(), password: o.querySelector("#ws-p").value });
      if (error) { m.textContent = "Email or password is wrong."; b.disabled = false; } else location.reload();
    });
  }

  window.claude = {
    use: async (name) => {
      if (name === "downloads") return downloads;
      if (ADMIN) {
        const { data } = await sb.auth.getSession();
        if (!data.session) { adminLogin(); return null; }
        adminId = data.session.user.id;
        if (isAdmin === null) { const r = await sb.rpc("has_role", { p_user_id: adminId, p_role: "admin" }); isAdmin = !!r.data; }
        if (!document.getElementById("ws-out")) chip("Sign out", async () => { await sb.auth.signOut(); location.reload(); }), document.body.lastChild.id = "ws-out";
      } else {
        if (!founderId()) { await pickFounder(); return null; }
        if (!document.getElementById("ws-out")) { chip("Not you? Switch person", () => { localStorage.removeItem("ws_founder"); location.reload(); }); document.body.lastChild.id = "ws-out"; }
      }
      return name === "db" ? db : name === "user" ? user : null;
    },
  };
})();
