// /api/upload — ingest a customer-uploaded image (product photo or custom
// avatar) and return a publicly fetchable URL the rest of the pipeline can
// reference.
//
// Primary path: upload to Supabase Storage bucket `products` using the
// service-role key (bypasses RLS). The bucket is public (see
// supabase/migrations/20260430_products_bucket.sql), so the returned URL
// works for the Higgsfield MCP `media_upload` tool, which fetches the URL by
// HTTP GET without any auth.
//
// Fallback: if SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is
// missing, or the Storage upload fails for any reason, fall back to the
// original data: URL behavior so dev / misconfigured deploys still work.
// Downstream code (lib/image-cache.js → /api/temp-image/<id>) handles
// data: URIs transparently.
//
// Response shape: `{ url: string }` — unchanged from the previous version,
// so studio/page.js's `pupData.url || pupData.access_url` keeps working
// without any client edits.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export async function POST(req) {
  console.log('[Memory:upload]', JSON.stringify(process.memoryUsage()));
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = file.type || 'image/jpeg';

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (supabaseUrl && serviceRoleKey) {
      // Pull the extension from the MIME type so the public URL is sensible
      // (image/jpeg → jpg, image/png → png). The actual content-type sent on
      // GET comes from the Storage object metadata, so this is cosmetic.
      const ext = (mimeType.split('/')[1] || 'jpg').split(';')[0].replace(/[^a-z0-9]/gi, '') || 'jpg';
      const filename = `${randomUUID()}.${ext}`;
      console.log(`[Upload] uploading to Supabase: ${filename} (${buffer.length} bytes, ${mimeType})`);

      try {
        const supa = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        const { error: upErr } = await supa.storage
          .from('products')
          .upload(filename, buffer, { contentType: mimeType, upsert: false });
        if (upErr) {
          console.error(`[Upload] Supabase upload failed: ${upErr.message} — falling back to data URL`);
        } else {
          const { data: pub } = supa.storage.from('products').getPublicUrl(filename);
          const publicUrl = pub?.publicUrl;
          if (publicUrl) {
            console.log(`[Upload] Supabase URL: ${publicUrl}`);
            return Response.json({ url: publicUrl });
          }
          console.warn('[Upload] getPublicUrl returned no url — falling back to data URL');
        }
      } catch (e) {
        console.error(`[Upload] Supabase client threw: ${e?.message} — falling back to data URL`);
      }
    } else {
      console.log('[Upload] fallback to data URL (no SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL)');
    }

    // Fallback — preserve original behavior so the rest of the pipeline
    // (image-cache.js → /api/temp-image/<id>) can still convert this into a
    // fetchable URL for the Higgsfield MCP.
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return Response.json({ url: dataUrl });
  } catch (e) {
    console.error('Upload route error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
