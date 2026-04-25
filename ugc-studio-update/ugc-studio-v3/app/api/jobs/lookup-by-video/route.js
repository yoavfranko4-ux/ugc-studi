// GET /api/jobs/lookup-by-video?url=<video_url>
//
// Recovers a jobId from a previously-rendered scene video URL. Used by the
// editor when an OLDER saved_edit (created before commit e219f4a) lacks
// `edit_data.job_id` — the editor can hand a video URL here and get the
// matching jobId back, which then lets the regenerate-scene endpoint
// rebuild the reference set from `jobs.inputs` (see agent/route.js).
//
// Strategy: scan `jobs` rows whose `result->videos` JSONB array contains the
// URL. Supabase's `.contains()` operator on JSONB is the cheapest way — no
// table scan, no LIKE on a stringified blob.
//
// Returns 200 { jobId, inputs } on hit, 404 on miss, 400/500 on error.

import { supabase } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!supabase) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const url = new URL(req.url).searchParams.get('url');
  if (!url || typeof url !== 'string') {
    return Response.json({ error: 'Missing ?url= query param' }, { status: 400 });
  }

  // `result.videos` is an array of strings — `.contains` on a JSONB array
  // matches when the array contains all elements of the search value, so we
  // pass a single-element array.
  const { data, error } = await supabase
    .from('jobs')
    .select('id, inputs')
    .eq('status', 'done')
    .contains('result->videos', JSON.stringify([url]))
    .limit(1);

  if (error) {
    console.error('[lookup-by-video] supabase error:', error.message);
    return Response.json({ error: 'Lookup failed' }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return Response.json({ error: 'No job found for this video URL' }, { status: 404 });
  }

  const row = data[0];
  return Response.json({
    jobId: row.id,
    inputs: row.inputs || {},
  });
}
