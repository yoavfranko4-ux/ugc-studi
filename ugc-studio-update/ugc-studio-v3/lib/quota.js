// Yotzr quota system — single source of truth for plan limits and usage tracking.
//
// All functions are fail-closed: any error returns a denying response (false /
// 'no_subscription' / null). They use the Supabase service-role key to bypass
// RLS, so they MUST only be called from server-side code (API routes).

import { createClient } from '@supabase/supabase-js'

// ── PLAN LIMITS ────────────────────────────────────────────────
// Sentinel values:
//   videos: -1            = unlimited
//   avatarIds: null       = all avatars allowed
//   voiceIds: null        = all voices allowed
//   voiceRegens: -1       = unlimited
//   sceneRegens: -1       = unlimited
//   durationDays: -1      = no expiry
export const PLAN_LIMITS = {
  trial: {
    videos: 1,
    avatarIds: ['Adam', 'Liel'],
    voiceIds: ['cp6q5qJLs8rR7eAWOepf', 'nBiC8Jexp2XGyIxATg9S'],
    voiceRegensPerVideo: 0,
    sceneRegensPerVideo: 0,
    topupAllowed: false,
    durationDays: 3,
  },
  basic: {
    videos: 4,
    avatarIds: ['Adam', 'Liel', 'Yoav'],
    voiceIds: ['cp6q5qJLs8rR7eAWOepf', 'nBiC8Jexp2XGyIxATg9S'],
    voiceRegensPerVideo: 1,
    sceneRegensPerVideo: 1,
    topupAllowed: true,
    durationDays: 30,
  },
  pro: {
    videos: 8,
    avatarIds: null,
    voiceIds: null,
    voiceRegensPerVideo: 2,
    sceneRegensPerVideo: 2,
    topupAllowed: true,
    durationDays: 30,
  },
  enterprise: {
    videos: -1,
    avatarIds: null,
    voiceIds: null,
    voiceRegensPerVideo: -1,
    sceneRegensPerVideo: -1,
    topupAllowed: true,
    durationDays: -1,
  },
}

const NONE_PLAN = { plan: 'none', expiresAt: null, status: 'none', subscription: null }

// ── 1. Service-role admin client (cached) ──────────────────────
let _adminClient = null
export function getSupabaseAdmin() {
  if (_adminClient) return _adminClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !serviceKey) {
    console.error('[quota] Supabase admin not configured (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
    return null
  }
  _adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _adminClient
}

// ── 2. Current billing period ──────────────────────────────────
// Paid subscription with started_at: rolling 30-day window aligned to start.
// No subscription / no started_at: calendar month (UTC).
export function currentPeriod(subscription) {
  const now = new Date()
  const startedAt = subscription?.started_at ? new Date(subscription.started_at) : null
  if (startedAt && !isNaN(startedAt.getTime())) {
    const msPerDay = 86400000
    const daysSinceStart = Math.floor((now.getTime() - startedAt.getTime()) / msPerDay)
    const periodIndex = Math.max(0, Math.floor(daysSinceStart / 30))
    const start = new Date(startedAt.getTime() + periodIndex * 30 * msPerDay)
    const end = new Date(start.getTime() + 30 * msPerDay)
    return { start, end }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

// ── 3. Get user's current plan ─────────────────────────────────
// Returns {plan, expiresAt, status, subscription}.
// status: 'active' | 'expired' | 'none'.  When expired or missing → plan='none'.
export async function getUserPlan(userId) {
  if (!userId) return { ...NONE_PLAN }
  const admin = getSupabaseAdmin()
  if (!admin) return { ...NONE_PLAN }
  try {
    const { data, error } = await admin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[quota] getUserPlan error:', error.message)
      return { ...NONE_PLAN }
    }
    if (!data) return { ...NONE_PLAN }
    const expiresAt = data.expires_at ? new Date(data.expires_at) : null
    const isActive = !expiresAt || expiresAt.getTime() > Date.now()
    return {
      plan: isActive ? data.plan : 'none',
      expiresAt: data.expires_at || null,
      status: isActive ? 'active' : 'expired',
      subscription: data,
    }
  } catch (e) {
    console.error('[quota] getUserPlan exception:', e?.message)
    return { ...NONE_PLAN }
  }
}

// ── 4. Get / lazy-create the current usage row ─────────────────
// Race-safe: relies on UNIQUE(user_id, period_start) to make duplicate inserts
// fail; on conflict we re-select the row that the other request created.
export async function getUserUsage(userId) {
  if (!userId) return null
  const admin = getSupabaseAdmin()
  if (!admin) return null
  try {
    const { subscription } = await getUserPlan(userId)
    const period = currentPeriod(subscription)
    const periodStartIso = period.start.toISOString()
    const periodEndIso = period.end.toISOString()

    const { data: existing, error: selErr } = await admin
      .from('user_usage')
      .select('*')
      .eq('user_id', userId)
      .eq('period_start', periodStartIso)
      .maybeSingle()
    if (selErr) {
      console.error('[quota] getUserUsage select error:', selErr.message)
      return null
    }
    if (existing) return existing

    const { data: inserted, error: insErr } = await admin
      .from('user_usage')
      .insert({
        user_id: userId,
        period_start: periodStartIso,
        period_end: periodEndIso,
        videos_created: 0,
        videos_topup: 0,
        voice_regens: 0,
        scene_regens: 0,
      })
      .select('*')
      .single()
    if (inserted) return inserted

    // Insert lost the race — re-select the row created by the winner.
    if (insErr) {
      const { data: refetched } = await admin
        .from('user_usage')
        .select('*')
        .eq('user_id', userId)
        .eq('period_start', periodStartIso)
        .maybeSingle()
      if (refetched) return refetched
      console.error('[quota] getUserUsage insert error and re-select empty:', insErr.message)
    }
    return null
  } catch (e) {
    console.error('[quota] getUserUsage exception:', e?.message)
    return null
  }
}

// ── 5. Can the user create another video? ──────────────────────
// Returns {allowed, reason, plan, used, limit, canTopup}.
// reason: null when allowed, else 'no_subscription' | 'quota_exceeded' |
// 'quota_exceeded_topup_available'.
export async function canCreateVideo(userId) {
  const denied = (reason, extra = {}) => ({
    allowed: false, reason, plan: 'none', used: 0, limit: 0, canTopup: false, ...extra,
  })
  if (!userId) return denied('no_subscription')
  try {
    const { plan, status } = await getUserPlan(userId)
    if (plan === 'none' || status !== 'active') return denied('no_subscription', { plan })
    const limits = PLAN_LIMITS[plan]
    if (!limits) return denied('no_subscription', { plan })

    const usage = await getUserUsage(userId)
    if (!usage) return denied('no_subscription', { plan, limit: limits.videos, canTopup: !!limits.topupAllowed })

    const used = usage.videos_created || 0
    const topupUsed = usage.videos_topup || 0
    const limit = limits.videos
    const canTopup = !!limits.topupAllowed

    if (limit === -1) {
      return { allowed: true, reason: null, plan, used, limit, canTopup }
    }
    if (used < limit + topupUsed) {
      return { allowed: true, reason: null, plan, used, limit, canTopup }
    }
    return {
      allowed: false,
      reason: canTopup ? 'quota_exceeded_topup_available' : 'quota_exceeded',
      plan, used, limit, canTopup,
    }
  } catch (e) {
    console.error('[quota] canCreateVideo exception:', e?.message)
    return denied('no_subscription')
  }
}

// ── 6. Avatar gating ───────────────────────────────────────────
export async function canUseAvatar(userId, avatarId) {
  if (!userId || !avatarId) return false
  try {
    const { plan, status } = await getUserPlan(userId)
    if (plan === 'none' || status !== 'active') return false
    const limits = PLAN_LIMITS[plan]
    if (!limits) return false
    if (limits.avatarIds === null) return true
    return limits.avatarIds.includes(avatarId)
  } catch (e) {
    console.error('[quota] canUseAvatar exception:', e?.message)
    return false
  }
}

// ── 7. Voice regen gating (per-job, per-plan) ──────────────────
export async function canRegenerateVoice(userId, jobId) {
  const denied = (extra = {}) => ({ allowed: false, used: 0, limit: 0, plan: 'none', ...extra })
  if (!userId || !jobId) return denied()
  const admin = getSupabaseAdmin()
  if (!admin) return denied()
  try {
    const { plan, status } = await getUserPlan(userId)
    if (plan === 'none' || status !== 'active') return denied({ plan })
    const limits = PLAN_LIMITS[plan]
    if (!limits) return denied({ plan })

    const { data: job, error } = await admin
      .from('video_jobs')
      .select('voice_regen_count, user_id')
      .eq('job_id', jobId)
      .maybeSingle()
    if (error || !job) return denied({ plan, limit: limits.voiceRegensPerVideo })
    if (job.user_id !== userId) return denied({ plan, limit: limits.voiceRegensPerVideo })

    const used = job.voice_regen_count || 0
    const limit = limits.voiceRegensPerVideo
    if (limit === -1) return { allowed: true, used, limit, plan }
    return { allowed: used < limit, used, limit, plan }
  } catch (e) {
    console.error('[quota] canRegenerateVoice exception:', e?.message)
    return denied()
  }
}

// ── 8. Scene regen gating (per-job, per-plan) ──────────────────
export async function canRegenerateScene(userId, jobId) {
  const denied = (extra = {}) => ({ allowed: false, used: 0, limit: 0, plan: 'none', ...extra })
  if (!userId || !jobId) return denied()
  const admin = getSupabaseAdmin()
  if (!admin) return denied()
  try {
    const { plan, status } = await getUserPlan(userId)
    if (plan === 'none' || status !== 'active') return denied({ plan })
    const limits = PLAN_LIMITS[plan]
    if (!limits) return denied({ plan })

    const { data: job, error } = await admin
      .from('video_jobs')
      .select('scene_regen_count, user_id')
      .eq('job_id', jobId)
      .maybeSingle()
    if (error || !job) return denied({ plan, limit: limits.sceneRegensPerVideo })
    if (job.user_id !== userId) return denied({ plan, limit: limits.sceneRegensPerVideo })

    const used = job.scene_regen_count || 0
    const limit = limits.sceneRegensPerVideo
    if (limit === -1) return { allowed: true, used, limit, plan }
    return { allowed: used < limit, used, limit, plan }
  } catch (e) {
    console.error('[quota] canRegenerateScene exception:', e?.message)
    return denied()
  }
}

// ── 9. Increment video count after a successful generation ─────
// isTopup=true increments videos_topup; otherwise videos_created.
// Read-modify-write: tiny race window (post-success) acceptable for MVP.
export async function incrementVideoCount(userId, isTopup = false) {
  if (!userId) return false
  const admin = getSupabaseAdmin()
  if (!admin) return false
  try {
    const usage = await getUserUsage(userId)
    if (!usage) return false
    const updates = isTopup
      ? { videos_topup: (usage.videos_topup || 0) + 1 }
      : { videos_created: (usage.videos_created || 0) + 1 }
    const { error } = await admin
      .from('user_usage')
      .update(updates)
      .eq('id', usage.id)
    if (error) {
      console.error('[quota] incrementVideoCount error:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[quota] incrementVideoCount exception:', e?.message)
    return false
  }
}

// ── 10. Increment voice regen counter (job + period) ───────────
export async function incrementVoiceRegen(userId, jobId) {
  if (!userId || !jobId) return false
  const admin = getSupabaseAdmin()
  if (!admin) return false
  try {
    const { data: job } = await admin
      .from('video_jobs')
      .select('id, voice_regen_count')
      .eq('job_id', jobId)
      .maybeSingle()
    if (job) {
      const { error: jobErr } = await admin
        .from('video_jobs')
        .update({ voice_regen_count: (job.voice_regen_count || 0) + 1 })
        .eq('id', job.id)
      if (jobErr) console.error('[quota] incrementVoiceRegen job error:', jobErr.message)
    }
    const usage = await getUserUsage(userId)
    if (usage) {
      const { error: usageErr } = await admin
        .from('user_usage')
        .update({ voice_regens: (usage.voice_regens || 0) + 1 })
        .eq('id', usage.id)
      if (usageErr) console.error('[quota] incrementVoiceRegen usage error:', usageErr.message)
    }
    return true
  } catch (e) {
    console.error('[quota] incrementVoiceRegen exception:', e?.message)
    return false
  }
}

// ── 11. Increment scene regen counter (job + period) ───────────
export async function incrementSceneRegen(userId, jobId) {
  if (!userId || !jobId) return false
  const admin = getSupabaseAdmin()
  if (!admin) return false
  try {
    const { data: job } = await admin
      .from('video_jobs')
      .select('id, scene_regen_count')
      .eq('job_id', jobId)
      .maybeSingle()
    if (job) {
      const { error: jobErr } = await admin
        .from('video_jobs')
        .update({ scene_regen_count: (job.scene_regen_count || 0) + 1 })
        .eq('id', job.id)
      if (jobErr) console.error('[quota] incrementSceneRegen job error:', jobErr.message)
    }
    const usage = await getUserUsage(userId)
    if (usage) {
      const { error: usageErr } = await admin
        .from('user_usage')
        .update({ scene_regens: (usage.scene_regens || 0) + 1 })
        .eq('id', usage.id)
      if (usageErr) console.error('[quota] incrementSceneRegen usage error:', usageErr.message)
    }
    return true
  } catch (e) {
    console.error('[quota] incrementSceneRegen exception:', e?.message)
    return false
  }
}

// ── 12. Insert a new video_jobs row at the start of generation ─
export async function insertVideoJob({ userId, jobId, productName, videoType, isTopup = false }) {
  if (!userId || !jobId) return false
  const admin = getSupabaseAdmin()
  if (!admin) return false
  try {
    const { error } = await admin.from('video_jobs').insert({
      user_id: userId,
      job_id: jobId,
      product_name: productName || '',
      video_type: videoType || 'ugc',
      status: 'pending',
      video_url: null,
      is_topup: !!isTopup,
      voice_regen_count: 0,
      scene_regen_count: 0,
    })
    if (error) {
      console.error('[quota] insertVideoJob error:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[quota] insertVideoJob exception:', e?.message)
    return false
  }
}

// ── 13. Update job status (completed / failed) ─────────────────
export async function updateVideoJobStatus(jobId, status, videoUrl = null) {
  if (!jobId || !status) return false
  const admin = getSupabaseAdmin()
  if (!admin) return false
  try {
    const updates = { status }
    if (videoUrl) updates.video_url = videoUrl
    const { error } = await admin
      .from('video_jobs')
      .update(updates)
      .eq('job_id', jobId)
    if (error) {
      console.error('[quota] updateVideoJobStatus error:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[quota] updateVideoJobStatus exception:', e?.message)
    return false
  }
}

export default null
