-- Standalone GTM workshop schema. Idempotent; supersedes drizzle/migrations/0039_workshop_kv.sql.
-- TEST MODE: founders are not signed in. They pick their name from a list and the page sends it as the
-- x-founder-id header. That is NOT secure (anyone can claim any founder). Run the LOCKDOWN block at the bottom before real use.

CREATE TABLE IF NOT EXISTS public.workshop_kv (
  collection text NOT NULL, id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
ALTER TABLE public.workshop_kv ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_kv TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workshop_kv TO anon;
GRANT ALL ON public.workshop_kv TO service_role;

-- Who is calling: the signed-in user, else the founder id sent in the x-founder-id header (must be a real member).
CREATE OR REPLACE FUNCTION public.workshop_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE h text; a uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RETURN auth.uid(); END IF;
  BEGIN h := nullif(current_setting('request.headers', true)::json ->> 'x-founder-id', ''); EXCEPTION WHEN others THEN h := NULL; END;
  IF h IS NULL OR h !~ '^[0-9a-fA-F-]{36}$' THEN RETURN NULL; END IF;
  a := h::uuid;
  IF EXISTS (SELECT 1 FROM public.members WHERE id = a AND is_test = false) THEN RETURN a; END IF;
  RETURN NULL;
END $$;

-- Rules: admin = has_role admin; interact = any known founder or admin; self = doc id is the actor.
CREATE OR REPLACE FUNCTION public.workshop_can(coll text, doc text, writing boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := public.workshop_actor();
BEGIN
  IF me IS NULL THEN RETURN false; END IF;
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin') THEN RETURN true; END IF;
  IF writing THEN
    RETURN CASE coll WHEN 'peerRatings' THEN doc = me::text WHEN 'cards' THEN doc = me::text WHEN 'plans' THEN true ELSE false END;
  END IF;
  RETURN CASE coll
    WHEN 'peerRatings' THEN doc = me::text
    WHEN 'cards' THEN doc = me::text
    WHEN 'results' THEN doc = me::text
    WHEN 'rounds' THEN true WHEN 'groupsPublished' THEN true WHEN 'plans' THEN true WHEN 'stage' THEN true
    ELSE false END;  -- ratings, groups, planChecks, groupFacilitators: admin only
END $$;

DROP POLICY IF EXISTS workshop_kv_select ON public.workshop_kv;
DROP POLICY IF EXISTS workshop_kv_insert ON public.workshop_kv;
DROP POLICY IF EXISTS workshop_kv_update ON public.workshop_kv;
DROP POLICY IF EXISTS workshop_kv_delete ON public.workshop_kv;
CREATE POLICY workshop_kv_select ON public.workshop_kv FOR SELECT TO anon, authenticated USING (public.workshop_can(collection, id, false));
CREATE POLICY workshop_kv_insert ON public.workshop_kv FOR INSERT TO anon, authenticated WITH CHECK (public.workshop_can(collection, id, true));
CREATE POLICY workshop_kv_update ON public.workshop_kv FOR UPDATE TO anon, authenticated USING (public.workshop_can(collection, id, true)) WITH CHECK (public.workshop_can(collection, id, true));
CREATE POLICY workshop_kv_delete ON public.workshop_kv FOR DELETE TO authenticated USING (public.workshop_can(collection, id, true));

ALTER TABLE public.workshop_kv REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='workshop_kv') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workshop_kv;
  END IF;
END $$;

-- Names for the "who are you" list.
CREATE OR REPLACE FUNCTION public.workshop_roster()
RETURNS TABLE (id uuid, name text, program text, startup text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.full_name, m.program, coalesce(m.startup_name, '') FROM public.members m WHERE m.is_test = false
$$;

-- Minimal public profile for the chosen founder (no challenge text, no contact details).
CREATE OR REPLACE FUNCTION public.workshop_me_for(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('rosterId', m.id, 'name', m.full_name, 'program', m.program,
    'startup', coalesce(m.startup_name, ''), 'stage', m.startup_stage, 'oneliner', m.startup_oneliner)
  FROM public.members m WHERE m.id = p_id AND m.is_test = false
$$;

-- Full manifests, organizers only.
CREATE OR REPLACE FUNCTION public.workshop_manifests()
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object('id', m.id, 'rosterId', m.id, 'name', m.full_name, 'program', m.program,
    'startup', coalesce(m.startup_name, ''), 'stage', m.startup_stage, 'oneliner', m.startup_oneliner,
    'chtext', f.challenge, 'learn', f.learn, 'learntext', f.learn_note, 'offer', f.offer,
    'offertext', f.offer_note, 'hours', f.hours, 'gtm', f.gtm_self, 'ai', f.ai_self, 'updatedAt', f.updated_at)
  FROM public.members m LEFT JOIN public.manifests f ON f.member_id = m.id WHERE m.is_test = false;
END $$;

REVOKE ALL ON FUNCTION public.workshop_actor(), public.workshop_can(text,text,boolean), public.workshop_roster(),
  public.workshop_me_for(uuid), public.workshop_manifests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workshop_actor(), public.workshop_can(text,text,boolean), public.workshop_roster(),
  public.workshop_me_for(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_manifests() TO authenticated;
-- has_role is called by policies for signed-in admins only; no anon grant needed.

-- LOCKDOWN (run before real use, then add real founder sign-in):
-- REVOKE SELECT, INSERT, UPDATE ON public.workshop_kv FROM anon;
-- REVOKE EXECUTE ON FUNCTION public.workshop_roster(), public.workshop_me_for(uuid) FROM anon;
