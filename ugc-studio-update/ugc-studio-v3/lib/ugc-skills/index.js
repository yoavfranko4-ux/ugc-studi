// ugc-skills — orchestrator.
//
// Main entry point for the UGC Creator Pro skill. Callers should import
// generateUGCPrompt() and never reach into the sub-modules directly for
// normal prompt construction (direct imports are fine for advanced use).
//
// Usage:
//   import { generateUGCPrompt } from '@/lib/ugc-skills';
//   const prompt = generateUGCPrompt({
//     actorId: 'daniel',
//     productName: 'kippah',
//     sceneNumber: 1,
//     sceneContext: '...',
//     beat: 1,
//   });

import { ACTOR_CARDS, getActorCard } from './actor-cards.js';
import { REALISM_ANCHORS, selectAnchors, getAnchorPhrases } from './realism-anchors.js';
import { CAMERA_PROFILES, getCameraProfile } from './camera-profiles.js';
import { SHOT_TYPES, getShotTypeForBeat, getShotType } from './shot-types.js';
import {
  buildPrompt,
  CHARACTER_REF_RULE,
  ANATOMY_RULE,
  STANDARD_NEGATIVES,
  ANATOMY_NEGATIVES
} from './prompt-layers.js';
import {
  ensureConsistency,
  getProductLock,
  STABLE,
  PRODUCT_LOCK,
  BUSINESS_CRAFT_LOCK,
  PRODUCT_INTEGRATION,
  PRODUCT_INTEGRATION_BY_PRODUCT,
  HELD_PRODUCT_INTEGRATION
} from './consistency-protocol.js';

// Environment dictionaries live here (rather than in their own file) because
// they're small and only consumed by the orchestrator.
//
// Scene 4 stays in the SAME everyday location as scene 1 (or in the car for
// car products). The intent is "same person, same place, just LATER" — not
// "now they're at a sunset restaurant". A new fancy scene reads as AI-invented;
// continuity reads as one real moment.
const BEAT_ENVIRONMENTS = {
  1: 'real lived-in Israeli home interior, casual personal space (bedroom, living room, or kitchen) — the intimate "problem" moment captured as an Israeli Story Time selfie',
  2: 'clean but lived-in home surface — wooden nightstand, kitchen counter, or bedside table — natural daylight',
  3: 'same home setting as the previous scene, continuity of lighting and surfaces — subject is using or trying the product',
  4: 'same indoor location as before, satisfied expression, everyday natural setting, casual home atmosphere'
};

// Scene 1 "moods" — variations on the Israeli Story Time selfie setting so
// repeated generations for the same product don't feel identical. The
// orchestrator picks one at random whenever beat 1 is rendered.
export const SCENE_1_MOODS = [
  'just got home from shopping (Israeli haul) — Israeli grocery and fashion bags casually placed near the avatar (Shufersal/שופרסל, Half-Hinam/חצי חינם, FOX, Castro), unwinding on the bed or couch',
  'morning routine in Israeli home — bedroom or bathroom corner, soft morning daylight, hair slightly unkempt, mid-routine moment',
  'sitting on the bed casually — slightly messy bed with a couple of pillows behind the avatar, soft daylight through a bedroom window, phone and keys on the nightstand',
  'in the kitchen with coffee — coffee mug or Cofix-style takeaway cup on the counter, kitchen cabinets and a Hebrew book or magazine in the background, mid-morning light',
  'living room couch story time — sitting on a casual fabric couch with houseplants, a Hebrew book and Israeli 3-prong outlets on the wall behind, daylight from a window'
];

export function getRandomScene1Mood() {
  return SCENE_1_MOODS[Math.floor(Math.random() * SCENE_1_MOODS.length)];
}

// Scene 1 — Israeli Story Time selfie. Built fresh on every call so the
// random mood changes between generations.
function getScene1Environment() {
  const mood = getRandomScene1Mood();
  return `Israeli Story Time selfie — ${mood}. Real lived-in Israeli home interior, natural daylight from a window, lived-in look (NOT staged). Subtle Israeli realism props in background: 1-2 shopping bags visible at the frame edges (Shufersal/שופרסל, Half-Hinam/חצי חינם, Rami Levy/רמי לוי, FOX, Castro, or Renuar — pick 1-2 only), a coffee cup or Cofix-style takeaway cup, phone and keys casually placed on a surface, houseplants, a Hebrew book or magazine, Israeli 3-prong electrical outlets where a wall is visible. Pose: SELFIE angle with the avatar's arm visible at the frame edge holding the iPhone, looking SLIGHTLY OFF-CAMERA as if telling a story to a friend (NOT staring directly into the lens). Casual unposed posture sitting on a bed, couch, or kitchen chair, caught mid-thought / mid-sentence. Vibe: TikTok "story time" / "haul day" — feels like a real person sharing news with a close friend, NOT a commercial, NOT a brand video.`;
}

// Scene 4 context — a continuation, not a new scene. Default: stay in the
// scene-1 location (home/office/kitchen). Car-product override only.
function getScene4Environment(productName) {
  const name = String(productName || '').toLowerCase();
  if (name.includes('רכב') || name.includes('car') || name.includes('אוטו')) {
    return 'sitting in the driver seat of their car, calm satisfied moment after using the product, natural in-car lighting through the windshield';
  }
  return BEAT_ENVIRONMENTS[4];
}

function getEnvironmentForBeat(beat, productName, { scene4Context = false } = {}) {
  if (beat === 1) return getScene1Environment();
  if (beat === 4 && scene4Context !== false) {
    return getScene4Environment(productName);
  }
  return BEAT_ENVIRONMENTS[beat] || BEAT_ENVIRONMENTS[2];
}

// Orchestrator. Builds a single scene's NanoBanana prompt end-to-end.
//
// Required:
//   actorId         — 'daniel' | 'noa' | 'maya'
//   sceneContext    — one-line description of what the avatar is doing/feeling
//   beat            — 1..4 (maps to shot type + environment default)
//
// Optional:
//   productName     — enables product context overlays + product-lock negative
//   sceneNumber     — passthrough for logs
//   environment     — override the beat default entirely
//   shotTypeOverride — force a specific shot type (e.g. 'mirror-selfie')
//   pain            — pain statement to embed in the scenario (beat 1)
//   productOnly     — scene-2 style product-only composition (no person)
//   scene4Context   — enable contextual environment overlay for beat 4
//   isBusinessCraft — use BUSINESS_CRAFT_LOCK instead of PRODUCT_LOCK
export function generateUGCPrompt({
  actorId,
  productName,
  sceneNumber,
  sceneContext,
  environment,
  shotTypeOverride,
  pain,
  beat,
  productOnly = false,
  scene4Context = false,
  isBusinessCraft = false
} = {}) {
  const actor = getActorCard(actorId);

  const shotType = shotTypeOverride
    ? shotTypeOverride
    : getShotTypeForBeat(beat, { productOnly });

  const shot = getShotType(shotType);
  const camera = shot.camera;

  const scenario = [
    pain ? `Emotional beat: ${pain}.` : '',
    sceneContext || ''
  ].filter(Boolean).join(' ');

  const env = environment || getEnvironmentForBeat(beat, productName, { scene4Context });

  const productLockPhrase = productOnly
    ? ''
    : getProductLock(productName, isBusinessCraft);

  // Product Integration — only when a person and product share the frame
  // (beats 3 and 4 of UGC mode). Scene 2 is product-only; scene 1 has no
  // product. For the held-product shot, also layer the hand-grip hint.
  const integrationParts = [];
  const personPlusProductBeat = !productOnly && productName && (beat === 3 || beat === 4);
  if (personPlusProductBeat) {
    integrationParts.push(PRODUCT_INTEGRATION);
    if (shotType === 'held-product') {
      integrationParts.push(HELD_PRODUCT_INTEGRATION);
    }
    const productKey = String(productName).toLowerCase().trim();
    const productHint = PRODUCT_INTEGRATION_BY_PRODUCT[productKey];
    if (productHint) integrationParts.push(productHint);
  }

  const customNegatives = [productLockPhrase, ...integrationParts]
    .filter(Boolean)
    .join(' ');

  // Selfie-style shots *must* show the iPhone in the subject's hand, so drop
  // the "no phone in frame" rule only for those cases.
  const selfieLikeShots = new Set(['selfie-close', 'selfie-medium', 'aspirational-selfie', 'mirror-selfie']);
  const skipPhoneNegative = selfieLikeShots.has(shotType);

  return buildPrompt({
    actor,
    scenario,
    environment: env,
    camera,
    shotType,
    skipPhoneNegative,
    customNegatives
  });
}

// Re-exports so consumers can reach for lower-level pieces without chasing down
// individual files.
export {
  ACTOR_CARDS,
  getActorCard,
  REALISM_ANCHORS,
  selectAnchors,
  getAnchorPhrases,
  CAMERA_PROFILES,
  getCameraProfile,
  SHOT_TYPES,
  getShotType,
  getShotTypeForBeat,
  buildPrompt,
  CHARACTER_REF_RULE,
  ANATOMY_RULE,
  STANDARD_NEGATIVES,
  ANATOMY_NEGATIVES,
  ensureConsistency,
  getProductLock,
  STABLE,
  PRODUCT_LOCK,
  BUSINESS_CRAFT_LOCK,
  PRODUCT_INTEGRATION,
  PRODUCT_INTEGRATION_BY_PRODUCT,
  HELD_PRODUCT_INTEGRATION
};
