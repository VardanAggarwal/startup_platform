# GTM workshop (standalone)

## Run locally (current setup)
`node server.js` then open http://localhost:8765 (`founder.html`, `admin.html`).
- Database: SQLite at `data/workshop.db` (table `kv`: coll, id, JSON; override dir with `DATA_DIR`). Reset: stop server, delete `workshop.db*`. Backup: `sqlite3 data/workshop.db ".backup copy.db"`. Needs Node 22+. Founder list: `data/roster.json` (name, program, phone from the Google Sheet).
- Organizer login: `admin@local` / `susegad` (override with ADMIN_EMAIL / ADMIN_PASSWORD).
- `shim.js` is the client: Supabase when `config.js` has a URL, otherwise the local `server.js`.

## Supabase version
Static site. Same Supabase project and database as the portal.

- `index.html` landing, `founder.html` founders, `admin.html` organizers/facilitators.
- Founders: no sign-in. They pick their name (stored in localStorage, sent as `x-founder-id`). TEST MODE, not secure.
- Organizers: email + password of an existing portal account with the admin role.

## Set up
1. Run `schema.sql` once in the Supabase SQL editor (replaces the 0039 migration if applied).
2. Deploy this folder to any static host (Netlify drop, Cloudflare Pages, Vercel, GitHub Pages).
3. Open `/admin.html`, sign in, then `/founder.html` on a phone.

## Before real use
Run the LOCKDOWN lines at the bottom of `schema.sql`, then add real founder sign-in.

## Setup after cloning
- `data/` is not in git (it holds founder phone numbers and the live database). Create `data/roster.json` like `data/roster.example.json`: `[{ "id", "name", "program", "phone" }]`. Use random ids (`"f" + 10 random hex`), never ids derived from phone numbers, which can be brute-forced. Phone is never served.
- Run `node server.js` (Node 22+). Admin login: env `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Supabase mode (default when `config.js` has a URL)
- `config.js` sets `WORKSHOP_CONFIG`; `shim.js` then calls Supabase directly (PostgREST + RPC), so the pages can be static-hosted and `server.js` is not needed. Blank the config (`window.WORKSHOP_CONFIG={}`) to use the local Node + SQLite server.
- Apply `schema.sql` to the project, load the roster into `workshop_roster`, set the organizer with `select workshop_set_admin('email','password')`, and copy data with `import-supabase.js`.
- Access rules live in Postgres (RLS + `workshop_can`). Founder mode is still test mode (no sign-in); see the header in `schema.sql`.
- Live updates: no polling. A trigger sends a Realtime ping `{collection, id}` and each open page fetches only that document. Fallbacks: 60 s check while the tab is visible, refresh on tab focus / page change, and a Refresh button.
