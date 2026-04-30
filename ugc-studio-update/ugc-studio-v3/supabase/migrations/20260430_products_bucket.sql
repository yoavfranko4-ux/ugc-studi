-- 20260430_products_bucket.sql
--
-- Public Storage bucket for customer-uploaded product images. Yotzr's
-- /api/upload route writes here on the server side (using the service role
-- key), and the resulting public URL is passed to the Higgsfield Marketing
-- Studio MCP flow as a `medias[].value` reference.
--
-- Why public read:
--   The Higgsfield MCP `media_upload` tool fetches the URL by HTTP GET.
--   It does not authenticate to Supabase, so the bucket has to be public.
--
-- Why allow anon insert:
--   The /api/upload route uses SUPABASE_SERVICE_ROLE_KEY when available
--   (which bypasses RLS entirely), but we keep an anon-insert policy as a
--   fallback so a deploy without the service-role key can still upload via
--   the anon client. If you want to lock this down to service-role-only
--   later, drop the "products: anon/auth insert" policy.

-- 1. Bucket -----------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do update set public = true;

-- 2. Public read policy -----------------------------------------------------

drop policy if exists "products: public read" on storage.objects;
create policy "products: public read"
  on storage.objects
  for select
  using (bucket_id = 'products');

-- 3. Anon / authenticated insert policy -------------------------------------

drop policy if exists "products: anon/auth insert" on storage.objects;
create policy "products: anon/auth insert"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'products');
