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
import {
  REALISM_ANCHORS,
  selectAnchors,
  getAnchorPhrases,
  getMandatoryHumanPhrases,
  getMandatoryProductPhrases,
  MANDATORY_HUMAN_ANCHORS,
  MANDATORY_PRODUCT_ANCHORS
} from './realism-anchors.js';
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
  HELD_PRODUCT_INTEGRATION,
  UNIVERSAL_PRODUCT_INTEGRATION,
  getProductIntegrationForName,
  getCategoryShortLabel,
  resolveProductCategory
} from './consistency-protocol.js';

// Kling v3 pro image-to-video has a 2500-char prompt limit. Keep a 100-char
// buffer below that for safety so the request never gets rejected.
const KLING_HARD_LIMIT = 2400;

// Environment dictionaries live here (rather than in their own file) because
// they're small and only consumed by the orchestrator.
//
// Scene 4 stays in the SAME everyday location as scene 1 (or in the car for
// car products). The intent is "same person, same place, just LATER" — not
// "now they're at a sunset restaurant". A new fancy scene reads as AI-invented;
// continuity reads as one real moment.
const BEAT_ENVIRONMENTS = {
  1: 'cozy Israeli home bedroom or living room — sitting on a bed or couch with generic plain shopping bags scattered around — solid color paper bags and plastic bags with NO logos, NO brand names, NO text, NO printed graphics. Bags are simple white, beige, brown, and black, completely unbranded. Some bags are crumpled, some half-open with clothing edges visible inside (sweaters, fabric). NEVER show any real-world brand logos, NEVER show readable text on bags, NEVER show recognizable retail brand names. Warm indoor lighting plus natural window light, lived-in story-time vibe — the intimate "problem" moment',
  2: 'clean but lived-in home surface — wooden nightstand, kitchen counter, or bedside table — natural daylight',
  3: 'same home setting as the previous scene, continuity of lighting and surfaces — subject is using or trying the product',
  4: 'same indoor location as before, satisfied expression, everyday natural setting, casual home atmosphere'
};

// Business-mode environments. Generic enough to cover any business category
// (barber, yoga, bakery, garage, restaurant) — the AI infers the specific
// venue from the business name + description that we inject into Layer 2.
const BUSINESS_BEAT_ENVIRONMENTS = {
  1: 'realistic everyday setting that feels relevant to the business ' +
     'context (NOT a home with shopping bags, NOT a kitchen, ' +
     'NOT a bedroom). The avatar appears as a customer or person ' +
     'who has had a frustrating experience with a similar service ' +
     'in the past — sitting somewhere generic and neutral (a public ' +
     'space, waiting area, or appropriate location for the business ' +
     'category). Frustrated, tired, or disappointed expression. ' +
     'Gaze drifts off-camera as if recalling a bad past experience. ' +
     'iPhone selfie style, casual handheld, natural daylight. ' +
     'NEVER show shopping bags, NEVER show a home bedroom or kitchen, ' +
     'NEVER show retail brand logos. Setting should feel "before" — ' +
     'a moment of disappointment that the business will solve.',

  2: 'AESTHETIC SHOWCASE of the business at its absolute best moment. ' +
     'Wide or medium shot showing the business environment in ' +
     'its most appealing, aspirational form — the kind of shot ' +
     'that makes viewers think "I want to experience this." ' +
     'Soft natural light, beautifully composed, clean and inviting. ' +
     'STRICTLY AVOID: extreme close-ups of body parts, mess or debris, ' +
     'anything that could look unsanitary, unappealing, or aggressive. ' +
     'No tight crops on hands working with sharp tools, no visible ' +
     'dirt or scattered residue. ' +
     'Style: high-quality phone footage that feels real, NOT ' +
     'overproduced stock photography, NOT studio-lit. ' +
     'GOAL: convey the elevated experience of the business in one shot.',

  3: 'Avatar AUTHENTICALLY EXPERIENCING the business service in action. ' +
     'Phone footage feel — slight handheld wobble, natural lighting, ' +
     'casual unposed moment. Show the service happening to or with ' +
     'the avatar in a way that is aesthetically pleasant and inviting. ' +
     'AVOID: over-produced studio look, dramatic theatrical lighting, ' +
     'staged poses. The viewer should feel "this is real, this is ' +
     'happening in a real place right now". Aesthetic but everyday. ' +
     'Lighting and composition match the warmth and tone of the ' +
     'business — but always feels like a real iPhone capture, not ' +
     'a commercial.',

  4: 'Avatar smiling confidently with relaxed satisfaction, business ' +
     'environment visible but tastefully blurred in the background. ' +
     'Same indoor location and lighting consistency as scene 3. ' +
     'iPhone selfie energy — warm, genuine, inviting. The "after" ' +
     'moment that completes the story. Natural unforced expression ' +
     'of contentment.'
};

// Scene 4 context — a continuation, not a new scene. Default: stay in the
// scene-1 location (home/office/kitchen). Car-product override only.
function getScene4Environment(productName, { isBusinessCraft = false } = {}) {
  const name = String(productName || '').toLowerCase();
  if (!isBusinessCraft && (name.includes('רכב') || name.includes('car') || name.includes('אוטו'))) {
    return 'sitting in the driver seat of their car, calm satisfied moment after using the product, natural in-car lighting through the windshield';
  }
  return isBusinessCraft ? BUSINESS_BEAT_ENVIRONMENTS[4] : BEAT_ENVIRONMENTS[4];
}

function getEnvironmentForBeat(beat, productName, { scene4Context = false, isBusinessCraft = false } = {}) {
  if (beat === 4 && scene4Context !== false) {
    return getScene4Environment(productName, { isBusinessCraft });
  }
  const table = isBusinessCraft ? BUSINESS_BEAT_ENVIRONMENTS : BEAT_ENVIRONMENTS;
  return table[beat] || table[2];
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
  isBusinessCraft = false,
  isFallbackActor = false
} = {}) {
  const actor = getActorCard(actorId);

  const shotType = shotTypeOverride
    ? shotTypeOverride
    : getShotTypeForBeat(beat, { productOnly });

  const shot = getShotType(shotType);
  const camera = shot.camera;

  // Layer 2 — Scenario. Business mode injects the business name + description
  // so NanoBanana can adapt the visual environment to the actual venue type
  // (barber, yoga studio, bakery, garage, etc.) while Layer 3 keeps the
  // generic structural beats. Product mode keeps the original behavior.
  const scenario = isBusinessCraft
    ? [
        pain ? `Emotional beat: ${pain}.` : '',
        `business "${productName || ''}" — ${sceneContext || ''}.`,
        'Adapt the visual environment to match the business type ' +
          'naturally (a barber shop, yoga studio, bakery, garage, etc. — ' +
          'infer from the business name and description). Keep the ' +
          'setting realistic and consistent with the business category.'
      ].filter(Boolean).join(' ')
    : [
        pain ? `Emotional beat: ${pain}.` : '',
        sceneContext || ''
      ].filter(Boolean).join(' ');

  const env = environment || getEnvironmentForBeat(beat, productName, { scene4Context, isBusinessCraft });

  const productLockPhrase = productOnly
    ? ''
    : getProductLock(productName, isBusinessCraft);

  // Product Integration — only when a person and product share the frame
  // (beats 3 and 4 of UGC mode). Scene 2 is product-only; scene 1 has no
  // product. The universal block covers held / worn / on-surface / applied;
  // the held-product shot still gets the hand-grip emphasis layered on top.
  const integrationParts = [];
  const personPlusProductBeat = !productOnly && productName && (beat === 3 || beat === 4);
  if (personPlusProductBeat) {
    if (shotType === 'held-product') {
      integrationParts.push(HELD_PRODUCT_INTEGRATION);
    }
    integrationParts.push(getProductIntegrationForName(productName));
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
    customNegatives,
    isFallbackActor
  });
}

// Wrap a Claude-authored kling_prompt with the same skill layers we apply to
// the NanoBanana side: PRODUCT_LOCK (when a product is present), realism
// anchors that fight the polished AI feel, and the standard motion / anatomy
// negatives. The Claude prompt is preserved verbatim — we only append; we
// never rewrite the caller's intent.
//
//   klingPromptRaw — the kling_prompt string Claude produced for this scene
//   beat           — 1..4; gates which negatives we add (e.g. scene 4 keeps
//                    the no-vehicle rule for non-car products; scene 2 has
//                    no person so person negatives are skipped)
//   productName    — when present, append PRODUCT_LOCK + the product-specific
//                    integration hint if we have one
//   opts.isBusinessCraft — use BUSINESS_CRAFT_LOCK instead of PRODUCT_LOCK
//   opts.scene4Context   — drop the no-vehicle negative for scene 4 (car
//                          products legitimately show the car)
export function buildKlingPrompt(klingPromptRaw, beat, productName, opts = {}) {
  const raw = (klingPromptRaw || '').trim();
  const parts = [raw];

  // Skip person-only realism for the product-only beauty shot (scene 2).
  const hasPerson = beat !== 2;

  // PRODUCT_LOCK — every scene that contains the product (beats 2, 3, 4).
  // Append the universal product-integration block so Kling gets the same
  // physics-grounded rules the NB frame received.
  if (productName && beat !== 1) {
    parts.push(getProductLock(productName, opts.isBusinessCraft === true));
    parts.push(getProductIntegrationForName(productName));
  }

  // Realism anchors — short, Kling-friendly versions. Person + non-person
  // shots both get the handheld iPhone wobble + anti-AI cues.
  const realism = hasPerson
    ? 'REALISM: handheld iPhone selfie wobble, real human texture, candid not posed, not AI-generated feel, real unretouched skin with natural pores and asymmetry, warm natural indoor lighting, flat washed-out color, low saturation, no beauty filter, no studio lighting, no LUT, looks like a real phone clip not a render.'
    : 'REALISM: handheld iPhone back-camera wobble, slight natural shake, ambient room lighting, flat washed-out color, real surface texture, not a render, not a catalog shot.';
  parts.push(realism);

  // Negatives — short Kling list. Anatomy + product consistency + the two
  // hard product-frame rules (no phone, no vehicle for non-car shots).
  const negatives = [
    'no face distortion',
    'stable face anatomy',
    'no AI artifacts',
    'no morphing',
    'no melting hands',
    'no extra limbs',
    'consistent product appearance across every frame',
    'NEVER show a phone or mobile device in any scene',
  ];
  if (!opts.scene4Context) negatives.push('NEVER in a car, NEVER in a vehicle');
  negatives.push('no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays');
  parts.push(`NEGATIVES: ${negatives.join(', ')}.`);

  const finalPrompt = parts.filter(Boolean).join(' ');

  // Bodyguard: Kling v3 pro rejects prompts longer than 2500 chars. If we are
  // anywhere near that, rebuild from the raw Claude prompt + a minimal set of
  // realism / negatives / product-lock so the API call still succeeds.
  if (finalPrompt.length > KLING_HARD_LIMIT) {
    console.warn(`[buildKlingPrompt] EMERGENCY TRIM: ${finalPrompt.length} → ${KLING_HARD_LIMIT}`);

    const minimalRealism = 'REALISM: handheld iPhone selfie wobble, real human texture, candid not posed, NOT AI-generated, real unretouched skin.';
    const minimalNegatives = 'NEGATIVES: no face distortion, stable anatomy, exactly 2 arms 2 hands, no extra limbs, no floating hands, no AI artifacts, consistent product appearance.';
    const productLockShort = productName
      ? `PRODUCT LOCK: ${productName} — identical color, shape, texture, embroidery to source image across all scenes. No morphing, no drift.`
      : '';

    const trimmed = [raw, minimalRealism, minimalNegatives, productLockShort]
      .filter(Boolean)
      .join(' ');

    if (trimmed.length > KLING_HARD_LIMIT) {
      const overhead = minimalRealism.length + minimalNegatives.length
        + productLockShort.length + 20;
      const truncatedRaw = raw.slice(0, KLING_HARD_LIMIT - overhead);
      const truncatedFinal = [truncatedRaw, minimalRealism, minimalNegatives, productLockShort]
        .filter(Boolean)
        .join(' ');
      console.log(`[buildKlingPrompt] TRIMMED PROMPT (${truncatedFinal.length} chars):`);
      console.log(truncatedFinal);
      return truncatedFinal;
    }

    console.log(`[buildKlingPrompt] TRIMMED PROMPT (${trimmed.length} chars):`);
    console.log(trimmed);
    return trimmed;
  }

  return finalPrompt;
}

// Re-exports so consumers can reach for lower-level pieces without chasing down
// individual files.
export {
  ACTOR_CARDS,
  getActorCard,
  REALISM_ANCHORS,
  selectAnchors,
  getAnchorPhrases,
  getMandatoryHumanPhrases,
  getMandatoryProductPhrases,
  MANDATORY_HUMAN_ANCHORS,
  MANDATORY_PRODUCT_ANCHORS,
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
  HELD_PRODUCT_INTEGRATION,
  UNIVERSAL_PRODUCT_INTEGRATION,
  getProductIntegrationForName,
  getCategoryShortLabel,
  resolveProductCategory
};
