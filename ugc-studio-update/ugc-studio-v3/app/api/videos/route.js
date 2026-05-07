import { NextResponse } from 'next/server'
import { getUserFromRequest } from '../../../lib/auth-server.js'
import { getSupabaseAdmin } from '../../../lib/quota.js'

// GET /api/videos — returns the caller's completed video history.
// 401 when not authenticated; 500 on server / config error; otherwise 200 with
// { videos: [{ jobId, productName, videoType, videoUrl, isTopup, createdAt }], total }.
//
// API caps the result at 50 rows so a heavy user doesn't blow up the response.
// The UI slices to 12 for display; pagination can be added later without an
// API contract change.
export async function GET(request) {
  const { user, error: authError } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: authError || 'unauthorized' }, { status: 401 })
  }
  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }
  try {
    const { data, error } = await admin
      .from('video_jobs')
      .select('job_id, product_name, video_type, video_url, is_topup, created_at')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .not('video_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[/api/videos] query error:', error.message)
      return NextResponse.json({ error: 'query_failed' }, { status: 500 })
    }
    const videos = (data || []).map(r => ({
      jobId: r.job_id,
      productName: r.product_name || '',
      videoType: r.video_type || 'ugc',
      videoUrl: r.video_url,
      isTopup: !!r.is_topup,
      createdAt: r.created_at,
    }))
    return NextResponse.json({ videos, total: videos.length })
  } catch (e) {
    console.error('[/api/videos] exception:', e?.message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
