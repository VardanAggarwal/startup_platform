-- Standalone workshop schema for a dedicated Supabase project. Idempotent. No dependency on any other app's tables.
-- TEST MODE: founders are not signed in; they pick a name and the page sends x-founder-id. Anyone with the URL can claim any founder.
-- Organizers sign in via workshop_admin_login(); the returned token is sent as x-admin-token. Phone numbers are never stored here.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.workshop_kv (
  collection text NOT NULL, id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id));
CREATE TABLE IF NOT EXISTS public.workshop_roster (id text PRIMARY KEY, name text NOT NULL, program text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS public.workshop_admins (email text PRIMARY KEY, pw_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS public.workshop_sessions (token uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workshop_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workshop_roster, public.workshop_admins, public.workshop_sessions FROM anon, authenticated;  -- reachable only through the functions below
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_kv TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.workshop_hdr(n text) RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN nullif(current_setting('request.headers', true)::json ->> n, ''); EXCEPTION WHEN others THEN RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION public.workshop_is_admin() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE h text := public.workshop_hdr('x-admin-token');
BEGIN
  IF h IS NULL OR h !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.workshop_sessions WHERE token = h::uuid AND created_at > now() - interval '2 days');
END $$;

CREATE OR REPLACE FUNCTION public.workshop_actor() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id FROM public.workshop_roster r WHERE r.id = public.workshop_hdr('x-founder-id')
$$;

-- Same rules as server.js: admin = everything; founder = own cards/ratings/results; shared read of rounds, published groups, plans, stage; write plans anywhere.
CREATE OR REPLACE FUNCTION public.workshop_can(coll text, doc text, writing boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me text;
BEGIN
  IF public.workshop_is_admin() THEN RETURN true; END IF;
  me := public.workshop_actor();
  IF me IS NULL THEN RETURN false; END IF;
  IF writing THEN RETURN (coll IN ('peerRatings','cards') AND doc = me) OR coll = 'plans'; END IF;
  RETURN (coll IN ('peerRatings','cards','results') AND doc = me) OR coll IN ('rounds','groupsPublished','plans','stage');
END $$;

DROP POLICY IF EXISTS workshop_kv_select ON public.workshop_kv;
DROP POLICY IF EXISTS workshop_kv_insert ON public.workshop_kv;
DROP POLICY IF EXISTS workshop_kv_update ON public.workshop_kv;
DROP POLICY IF EXISTS workshop_kv_delete ON public.workshop_kv;
CREATE POLICY workshop_kv_select ON public.workshop_kv FOR SELECT TO anon, authenticated USING (public.workshop_can(collection, id, false));
CREATE POLICY workshop_kv_insert ON public.workshop_kv FOR INSERT TO anon, authenticated WITH CHECK (public.workshop_can(collection, id, true));
CREATE POLICY workshop_kv_update ON public.workshop_kv FOR UPDATE TO anon, authenticated USING (public.workshop_can(collection, id, true)) WITH CHECK (public.workshop_can(collection, id, true));
CREATE POLICY workshop_kv_delete ON public.workshop_kv FOR DELETE TO anon, authenticated USING (public.workshop_is_admin());

-- Atomic shallow merge (what PATCH did on the Node server). Raises when the document is missing.
CREATE OR REPLACE FUNCTION public.workshop_kv_patch(p_coll text, p_id text, p_patch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.workshop_can(p_coll, p_id, true) THEN RAISE EXCEPTION 'denied' USING ERRCODE = '42501'; END IF;
  UPDATE public.workshop_kv SET data = data || coalesce(p_patch, '{}'::jsonb), updated_at = now() WHERE collection = p_coll AND id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workshop_startup(p_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(data -> 'gtm' ->> 'a_startup', '') FROM public.workshop_kv WHERE collection = 'cards' AND id = p_id
$$;

CREATE OR REPLACE FUNCTION public.workshop_roster() RETURNS TABLE (id text, name text, program text, startup text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.name, r.program, CASE WHEN public.workshop_is_admin() THEN coalesce(public.workshop_startup(r.id), '') ELSE '' END
  FROM public.workshop_roster r ORDER BY r.name
$$;

CREATE OR REPLACE FUNCTION public.workshop_me() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', r.id, 'rosterId', r.id, 'name', r.name, 'program', r.program, 'startup', coalesce(public.workshop_startup(r.id), ''), 'gtm', 3, 'ai', 3)
  FROM public.workshop_roster r WHERE r.id = public.workshop_actor()
$$;

CREATE OR REPLACE FUNCTION public.workshop_manifests() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.workshop_is_admin() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT jsonb_build_object('id', r.id, 'rosterId', r.id, 'name', r.name, 'program', r.program, 'startup', coalesce(public.workshop_startup(r.id), ''), 'gtm', 3, 'ai', 3)
  FROM public.workshop_roster r;
END $$;

CREATE OR REPLACE FUNCTION public.workshop_admin_login(p_email text, p_password text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE t uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workshop_admins WHERE email = lower(p_email) AND pw_hash = crypt(p_password, pw_hash)) THEN RETURN NULL; END IF;
  DELETE FROM public.workshop_sessions WHERE created_at < now() - interval '2 days';
  INSERT INTO public.workshop_sessions (email) VALUES (lower(p_email)) RETURNING token INTO t;
  RETURN t::text;
END $$;

CREATE OR REPLACE FUNCTION public.workshop_set_admin(p_email text, p_password text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  INSERT INTO public.workshop_admins (email, pw_hash) VALUES (lower(p_email), crypt(p_password, gen_salt('bf')))
  ON CONFLICT (email) DO UPDATE SET pw_hash = excluded.pw_hash
$$;

CREATE OR REPLACE FUNCTION public.workshop_reset() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF NOT public.workshop_is_admin() THEN RAISE EXCEPTION 'denied' USING ERRCODE = '42501'; END IF; DELETE FROM public.workshop_kv WHERE true; END $$;

REVOKE ALL ON FUNCTION public.workshop_hdr(text), public.workshop_is_admin(), public.workshop_actor(), public.workshop_can(text,text,boolean),
  public.workshop_kv_patch(text,text,jsonb), public.workshop_startup(text), public.workshop_roster(), public.workshop_me(),
  public.workshop_manifests(), public.workshop_admin_login(text,text), public.workshop_set_admin(text,text), public.workshop_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workshop_hdr(text), public.workshop_is_admin(), public.workshop_actor(), public.workshop_can(text,text,boolean),
  public.workshop_kv_patch(text,text,jsonb), public.workshop_roster(), public.workshop_me(), public.workshop_manifests(),
  public.workshop_admin_login(text,text), public.workshop_reset() TO anon, authenticated;
-- workshop_set_admin and workshop_startup stay service-role only (run workshop_set_admin from the SQL editor / MCP).
