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
const BEAT_ENVIRONMENTS = {
  1: 'cozy, softly-lit personal space (bedroom, kitchen corner, bathroom vanity) — the intimate "problem" moment',
  2: 'clean but lived-in home surface — wooden nightstand, kitchen counter, or bedside table — natural daylight',
  3: 'same home setting as the previous scene, continuity of lighting and surfaces — subject is using or trying the product',
  4: 'aspirational real-world context where the product\'s benefit plays out — outside or in a lifestyle setting'
};

// Product-specific context overlays. Keys are lowercase product identifiers.
// Extend as new hero products join the catalog.
const PRODUCT_CONTEXTS = {
  kippah: {
    beat4: 'at a synagogue, family gathering, or Shabbat dinner — the kippah sits naturally on the back of the head',
    outfit: 'semi-formal but casual — button-down or smart knit'
  },
  kipa: {
    beat4: 'at a synagogue, family gathering, or Shabbat dinner — the kippah sits naturally on the back of the head',
    outfit: 'semi-formal but casual — button-down or smart knit'
  },
  icecream: {
    beat4: 'outdoors on a sunny afternoon — park bench or boardwalk, enjoying the treat'
  },
  teeth: {
    beat4: 'brightly-lit bathroom or at a social gathering, showing off a confident white-teeth smile'
  }
};

function getEnvironmentForBeat(beat, productName, { scene4Context = false } = {}) {
  const base = BEAT_ENVIRONMENTS[beat] || BEAT_ENVIRONMENTS[2];
  const key = productName ? String(productName).toLowerCase().trim() : '';
  const product = PRODUCT_CONTEXTS[key];
  if (beat === 4 && product?.beat4 && scene4Context !== false) {
    return `${base}. Context: ${product.beat4}.`;
  }
  return base;
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
