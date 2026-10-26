-- Apply AFTER migrations/001_core.sql, using the Supabase SQL editor or psql.
-- Browser access to business data is intentionally denied. The authenticated
-- Next.js API is the only write boundary and uses a dedicated trusted DB user.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS location extensions.geography(Point,4326)
  GENERATED ALWAYS AS (extensions.ST_SetSRID(extensions.ST_MakePoint(longitude,latitude),4326)::extensions.geography) STORED;
CREATE INDEX IF NOT EXISTS assets_location_gist ON public.assets USING gist(location);

DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (
  'tenants','organizations','profiles','roles','user_roles','sessions','login_attempts','teams','team_members',
  'asset_types','assets','asset_surfaces','asset_location_history','asset_photos','asset_responsibilities',
  'document_types','document_requirements','asset_documents','document_versions','inspection_template_versions',
  'inspection_template_items','inspection_plans','inspections','inspection_results','defects','defect_attachments',
  'work_orders','work_order_defects','work_order_assignments','work_logs','work_materials','work_reviews','attachments',
  'notifications','notification_deliveries','status_history','audit_logs','idempotency_keys','schema_migrations'
 ) LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.tablename);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',item.tablename);
 END LOOP;
END $$;
-- RLS has no permissive policy for anon/authenticated: deny by default.
-- Prevent REST inserts with forged tenant_id, assignee_id, status or roles.
REVOKE CREATE ON SCHEMA public FROM anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('adasset-private','adasset-private',false,10485760,ARRAY['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
-- No client storage policies. Next.js checks session/operator membership before
-- service-role upload and before issuing a 60-second signed URL.

CREATE OR REPLACE FUNCTION public.preserve_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are immutable'; END;
$$;
DROP TRIGGER IF EXISTS audit_immutable ON public.audit_logs;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.preserve_audit();
