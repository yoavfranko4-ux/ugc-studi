// Subscription tier limits for Yotzr.
//
// Avatar IDs use the `name` field from the AVATARS constant in app/studio/page.js:
//   Maya, Noa, Adam, Yoav, Lior, Dana
// (Spec referenced 'noa' / 'daniel' / 'maya' — adapted to actual avatar names;
//  'daniel' maps to 'Adam', the male avatar.)

import { PLANS } from './plans.js'

export const LIMITS = {
  trial: {
    videos: 1,
    avatarIds: ['Noa', 'Adam'],                                 // 2 avatars (female + male)
    voiceIds: ['cp6q5qJLs8rR7eAWOepf', 'nBiC8Jexp2XGyIxATg9S'], // noa + daniel
    voiceRegensPerVideo: 1,
    sceneRegensPerVideo: 1,
    durationDays: 3,
    autoRenew: false,
  },
  basic: {
    videos: 4,
    avatarIds: ['Noa', 'Adam', 'Liel'],                         // 3 avatars
    voiceIds: ['cp6q5qJLs8rR7eAWOepf', 'nBiC8Jexp2XGyIxATg9S'],
    voiceRegensPerVideo: 1,
    sceneRegensPerVideo: 1,
    durationDays: 30,
    autoRenew: true,
  },
  pro: {
    videos: 8,
    avatarIds: null, // null = all avatars allowed
    voiceIds: null,  // null = all voices allowed
    voiceRegensPerVideo: 2,
    sceneRegensPerVideo: 2,
    durationDays: 30,
    autoRenew: true,
  },
}

// Mirror of LIMITS shaped per spec (count-based fields).
// Infrastructure only — enforcement comes after PayPlus integration.
export const SUBSCRIPTION_LIMITS = {
  basic: {
    videosPerMonth: 4,
    maxAvatars: 3,
    maxVoices: 2,
    voiceRegensPerVideo: 1,
    sceneRegensPerVideo: 1,
  },
  pro: {
    videosPerMonth: 8,
    maxAvatars: Infinity,
    maxVoices: Infinity,
    voiceRegensPerVideo: 2,
    sceneRegensPerVideo: 2,
  },
}

export function canUseAvatar(userTier, avatarId) {
  const limit = LIMITS[userTier]
  if (!limit) return false
  if (limit.avatarIds === null) return true
  return limit.avatarIds.includes(avatarId)
}

export function canUseVoice(userTier, voiceId) {
  const limit = LIMITS[userTier]
  if (!limit) return false
  if (limit.voiceIds === null) return true
  return limit.voiceIds.includes(voiceId)
}

// Returns videos the user is still allowed to generate.
//
// Trial:  hard cap of PLANS.trial.videos *for life* (lifetime_videos_used),
//         AND the 3-day clock from trial_started_at must still be running.
// Paid:   per-period cap from PLANS[tier].videos against videos_used_this_period.
//         If the period elapsed (no webhook reset yet), assume a fresh period
//         and return the full quota — the increment hook will rebase on next
//         generation.
export function remainingVideos(user) {
  const tier = user?.subscription_tier || 'trial'
  const plan = PLANS[tier]
  if (!plan) return 0

  if (tier === 'trial') {
    const trialStart = user?.trial_started_at ? new Date(user.trial_started_at) : null
    if (trialStart) {
      const days = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
      if (days >= (plan.days || 3)) return 0
    }
    const used = user?.lifetime_videos_used || 0
    return Math.max(0, plan.videos - used)
  }

  const periodStart = user?.subscription_period_start ? new Date(user.subscription_period_start) : null
  if (periodStart) {
    const days = (Date.now() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    if (days >= (plan.days || 30)) return plan.videos
  }
  const used = user?.videos_used_this_period || 0
  return Math.max(0, plan.videos - used)
}
