import { NextResponse } from 'next/server'
import { getUserFromRequest } from '../../../lib/auth-server.js'
import { getUserPlan, getUserUsage, PLAN_LIMITS } from '../../../lib/quota.js'

// GET /api/quota — returns the caller's current plan + usage snapshot.
//
// Always responds with 200 (except for 401 / 500) so the UI can render an
// "no subscription" state without dealing with error branches. When the user
// has no active plan: hasSubscription=false, avatarsAllowed=[], voicesAllowed=[].
//
// avatarsAllowed/voicesAllowed: array of IDs, or null = "all allowed".
export async function GET(request) {
  const { user, error: authError } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: authError || 'unauthorized' }, { status: 401 })
  }

  try {
    const { plan, expiresAt, status } = await getUserPlan(user.id)

    if (plan === 'none') {
      return NextResponse.json({
        plan: 'none',
        used: 0,
        topupUsed: 0,
        limit: 0,
        canTopup: false,
        avatarsAllowed: [],
        voicesAllowed: [],
        expiresAt: null,
        hasSubscription: false,
        status,
      })
    }

    const limits = PLAN_LIMITS[plan]
    if (!limits) {
      return NextResponse.json({
        plan: 'none',
        used: 0,
        topupUsed: 0,
        limit: 0,
        canTopup: false,
        avatarsAllowed: [],
        voicesAllowed: [],
        expiresAt: null,
        hasSubscription: false,
        status: 'none',
      })
    }

    const usage = await getUserUsage(user.id)

    return NextResponse.json({
      plan,
      used: usage?.videos_created || 0,
      topupUsed: usage?.videos_topup || 0,
      limit: limits.videos,
      canTopup: !!limits.topupAllowed,
      avatarsAllowed: limits.avatarIds,
      voicesAllowed: limits.voiceIds,
      expiresAt,
      hasSubscription: true,
      status,
    })
  } catch (e) {
    console.error('[/api/quota] exception:', e?.message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
