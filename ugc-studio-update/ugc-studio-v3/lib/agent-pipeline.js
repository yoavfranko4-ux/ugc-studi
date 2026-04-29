// Shared helpers for the agent pipeline.
//
// Originally this module hosted fal.ai-bound helpers (NanoBanana frame
// generation via fal.run, applyFlatColorGrading via fal.storage.upload,
// etc.). After the BytePlus migration the only remaining shared concerns
// are skill re-exports and the avatar→actor mapping used by the studio
// script-generation path.

import {
  generateUGCPrompt,
  buildKlingPrompt,
  STABLE as SKILL_STABLE,
  PRODUCT_LOCK as SKILL_PRODUCT_LOCK,
  BUSINESS_CRAFT_LOCK as SKILL_BUSINESS_CRAFT_LOCK
} from './ugc-skills/index.js'

export const SCENE_DURATIONS = [5, 5, 5, 5];

// Re-export from the skill so there is one source of truth.
export const STABLE = SKILL_STABLE;
export const PRODUCT_LOCK = SKILL_PRODUCT_LOCK;
export const BUSINESS_CRAFT_LOCK = SKILL_BUSINESS_CRAFT_LOCK;

// Re-export the full skill orchestrator so callers can reach for it via
// lib/agent-pipeline.js without learning the ugc-skills path.
export { generateUGCPrompt, buildKlingPrompt };

// Map an avatar URL / filename to the actor info used by lib/ugc-skills. The
// skill's Layer-1 identity lock needs this to pick the right actor card.
//
// The studio UI (app/studio/page.js) ships six avatars under
// /avatars/avatar-{1..6}.jpg, displayed as Maya, Noa, Adam, Yoav, Lior, Dana.
// We only have three actor cards (daniel/noa/maya), so the four extras map to
// the closest-gender card. Custom (data:) uploads return null and the caller
// is expected to throw — the legacy fallback was removed so silent drift to a
// no-realism prompt no longer happens.
export function mapAvatarToActorInfo(avatarUrl) {
  if (!avatarUrl) return null;
  const url = String(avatarUrl).toLowerCase();

  // Studio UI numeric avatars — the production path.
  if (url.includes('/avatars/avatar-1')) return { actorId: 'maya',   isFallbackActor: false }; // "Maya"
  if (url.includes('/avatars/avatar-2')) return { actorId: 'noa',    isFallbackActor: false }; // "Noa"
  if (url.includes('/avatars/avatar-3')) return { actorId: 'daniel', isFallbackActor: true  }; // "Adam"
  if (url.includes('/avatars/avatar-4')) return { actorId: 'daniel', isFallbackActor: true  }; // "Yoav"
  if (url.includes('/avatars/avatar-5')) return { actorId: 'daniel', isFallbackActor: true  }; // "Lior"
  if (url.includes('/avatars/avatar-6')) return { actorId: 'noa',    isFallbackActor: true  }; // "Dana"

  // Landing-page bundled avatars — exact name match, not a fallback.
  if (url.includes('avatar-noa')    || url.includes('/noa'))    return { actorId: 'noa',    isFallbackActor: false };
  if (url.includes('avatar-daniel') || url.includes('/daniel')) return { actorId: 'daniel', isFallbackActor: false };
  if (url.includes('avatar-maya')   || url.includes('/maya'))   return { actorId: 'maya',   isFallbackActor: false };

  return null;
}
