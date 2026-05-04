import { NextResponse } from 'next/server'
import { getUserFromRequest } from '../../../../lib/auth-server.js'
import { getUserPlan, PLAN_LIMITS } from '../../../../lib/quota.js'

// POST /api/quota/topup — purchase additional videos beyond the plan quota.
//
// Payment integration is not live yet. Until PayPlus is wired up, this
// endpoint always returns success:false with a reason payload that the UI
// can render. The endpoint is plan-aware so we can short-circuit trial users
// (who cannot top up at all) before showing a payment placeholder.
//
// TODO (PayPlus integration):
//   1. Verify topupAllowed for the caller's current plan (already done below).
//   2. Open a PayPlus checkout session for N videos at the going rate.
//   3. On webhook success → admin.from('user_usage').update({ videos_topup: ... })
//      OR a single `incrementVideoCount(userId, isTopup=true)` per video purchased.
//   4. Return { success: true, addedVideos: N, newTopupBalance: M } here.
export async function POST(request) {
  const { user, error: authError } = await getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: authError || 'unauthorized' }, { status: 401 })
  }

  const { plan } = await getUserPlan(user.id)
  const limits = PLAN_LIMITS[plan]

  if (!limits || !limits.topupAllowed) {
    return NextResponse.json({
      success: false,
      reason: 'topup_not_available_on_plan',
      plan,
    })
  }

  return NextResponse.json({
    success: false,
    reason: 'payment_not_active',
    whatsapp: 'placeholder',
    plan,
  })
}
