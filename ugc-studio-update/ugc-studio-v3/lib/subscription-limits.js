// Subscription tier limits for Yotzr.
//
// Avatar IDs use the `name` field from the AVATARS constant in app/studio/page.js:
//   Maya, Noa, Adam, Yoav, Lior, Dana
// (Spec referenced 'noa' / 'daniel' / 'maya' — adapted to actual avatar names;
//  'daniel' maps to 'Adam', the male avatar.)

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
    avatarIds: ['Noa', 'Adam', 'Maya'],                         // 3 avatars
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

export function remainingVideos(user) {
  const limit = LIMITS[user?.subscription_tier]
  if (!limit) return 0
  return Math.max(0, limit.videos - (user?.videos_used_this_period || 0))
}
