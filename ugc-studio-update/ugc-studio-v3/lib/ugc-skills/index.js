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

// Realism + negatives blocks for buildKlingPrompt. Authored as multi-line
// template literals so they read like a brief, then trim()'d before use.
//
// REALISM_ANCHORS_KLING — "phone-native handheld take" frames the whole
// generation as amateur smartphone capture. The earlier wording ("handheld
// iPhone selfie wobble") only addressed the camera shake; this version
// addresses the *aesthetic* — sensor grain, no color grade, imperfect light,
// real-world environment with everyday details. Kling reads this as "this is
// a clip a person filmed", not "this is a render that should look polished".
const REALISM_ANCHORS_KLING = `
shot in a phone-native handheld take, authentic handheld micro-shake, slightly grainy phone sensor feel, no stylized color grade, natural imperfect light, eye-level framing, amateur smartphone footage aesthetic, real-world environment with everyday details visible, ambient room tone
`.trim();

// NEGATIVES_KLING — strongest anti-AI cues bundled together. The prior list
// was anatomy-heavy; this version leads with the "AI vibe" tells (reflections,
// studio polish, dramatic lighting, antislop adjectives, perfect symmetry).
// Real human faces are mildly asymmetric, so "no perfect symmetry" pulls the
// generator off its default centered/mirrored bias.
const NEGATIVES_KLING = `
no AI artifacts, no face distortion, stable anatomy, no unnatural movement, no reflections, no mirrors, no glass reflections, no reflective screens, no puddles, no studio polish, no dramatic lighting, no over-saturated colors, no cinematic color grade, no lens flares, not breathtaking, not stunning, not flawless, not seamless, not effortless, no perfect symmetry
`.trim();

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

// Wrap a Claude-authored scene prompt with the Seedance 2.0 layered structure:
// tag declarations, per-beat camera physics, expression framework, auto-exposure,
// silent video instruction, style closer, PRODUCT_LOCK, and a unified NEGATIVES
// block. The Claude prompt is preserved verbatim — we only surround it.
//
//   rawPromptIn   — the scene_prompt string Claude produced for this scene
//   beat          — 1..4; gates camera setup, expression direction, and PRODUCT_LOCK
//   productName   — when present and beat !== 1, append PRODUCT_LOCK
//   opts.isBusinessCraft — passthrough (kept for symmetry; PRODUCT_LOCK string
//                          is identical structure either way)
//   opts.scene4Context   — drop the no-vehicle negative for scene 4 (car products)
const SEEDANCE_HARD_LIMIT = 2480;

const SEEDANCE_CAMERA_PHYSICS = {
  1: "Phone held in right hand at arm's length, selfie angle, below eye level, tilted ~12-15 degrees off-axis (NOT centered). Irregular hand tremor (not smooth pattern), small framing drift every 1-2 seconds, occasional auto-focus hunt. Real skin texture: visible pores, faint under-eye shadow, slight facial asymmetry, NO airbrushed look. iPhone front camera limits: noise in shadows, chromatic fringing on hair, mild lens softness at edges. Seated — no walking bob.",
  2: "The phone is propped on a small dresser/shelf facing the scene. Static phone position but VERY subtle ambient motion — gentle light shift through window, soft parallax as warm air moves the camera ~1mm, slight focus breathing. Product alone in frame, no person, no hands. The shot is ALIVE not frozen — like a real iPhone left propped recording.",
  3: "Phone in her left hand at arm's length, selfie angle. Hand tremor from the phone-hand throughout, right hand free to use the product. Slight reframe when product moves — phone-hand tilts ~5 degrees to fit action in shot. Brief focus hunting between her face and the product when it enters frame.",
  4: "Phone in her right hand at arm's length, selfie angle, slightly below eye level. Tremor only, no walking bob. Marginal drift as arm relaxes. Slight auto-exposure adjustment when product comes into frame."
};

const SEEDANCE_MACRO_DETAIL = {
  1: "Macro: skin pores, eyelash detail, faint under-eye shadow.",
  2: "Macro: product label edges sharp, light refraction, contact shadow.",
  3: "Macro: finger/hand skin texture, tactile product interaction.",
  4: "Macro: eyes catch light, micro-expressions, asymmetric smile."
};

const SEEDANCE_LIGHT_DIRECTION = {
  1: "Light: window from left ~45°, soft diffuse, no harsh contrast.",
  2: "Light: warm practical + window backlight, catchlight on product.",
  3: "Light: natural daylight + 45° key on action, dimensional not flat.",
  4: "Light: soft golden-hour glow, warm tones, hair backlight."
};

const SEEDANCE_EXPRESSION_DIRECTION = {
  1: "Expression direction: eyes drift off-camera then back (not staring at lens), brow furrows asymmetrically, lips pressed thin with slight downturn, small head shakes, hand brushes hair back, shoulders sag, defeated half-shrug, natural blinks every 2-3 seconds, brief lip-bite, occasional eye-rub. Real human imperfection — never posed.",
  // Scene 2 has no person at all — drop the expression block. Anything that
  // mentions "she", "her face", or "free hand" pulls Seedance back toward
  // generating a random woman to fill the avatar slot.
  2: '',
  3: "Expression direction: eyes track the product carefully, eyebrows neutral concentrated, mouth slightly open in concentration, eyes close briefly during application, small satisfied exhale, soft 'mm' expression with slightly parted lips, single small nod when result is felt.",
  4: "Expression direction: calm steady gaze on the lens, soft genuine smile with lips pulled back at corners, eyes crinkle slightly at corners, slow blinks, eyebrows lift on key word, slow deliberate nods, occasional broader smile showing teeth briefly."
};

// UGC_MODE_TRIGGER — leading sentence that pushes Seedance into its "user-
// generated content" prior. Research from VideoAI.me / Higgsfield blog notes
// that Seedance has an unwritten UGC mode that turns on when the first words
// frame the clip as amateur phone footage rather than commercial production.
// Sits at parts[0] so it's the very first thing the model reads.
const UGC_MODE_TRIGGER = "Photorealistic UGC, iPhone handheld phone footage, natural light, sharp focus, real human imperfections, no CGI artifacting, no commercial polish.";

const SEEDANCE_AUTO_EXPOSURE = "Natural iPhone auto-exposure adjustment visible — slight image warming/cooling as the light shifts, no stable studio exposure.";

const SEEDANCE_SILENT = "Silent footage with physical presence — natural breathing, tactile physicality, fabric/product motion implied. No spoken dialogue, lips part softly but no clear words form.";

const SEEDANCE_NEGATIVES = "NEGATIVES: no AI artifacts, no face distortion, stable anatomy, no unnatural movement, no reflections, no mirrors, no glass reflections, no reflective screens, no puddles, no studio polish, no dramatic lighting, no over-saturated colors, no cinematic color grade, no lens flares, not breathtaking, not stunning, not flawless, not seamless, not effortless, no perfect symmetry, no plastic skin, no AI smoothing, no uncanny valley, no melting hands, no extra limbs, NEVER show a phone or mobile device in scene, no smooth gimbal stabilization, no rack focus, no dolly zoom, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays.";

export function buildSeedancePrompt(rawPromptIn, beat, productName, opts = {}) {
  const raw = (rawPromptIn || '').trim();
  const beatKey = (beat >= 1 && beat <= 4) ? beat : 2;
  const isBusinessCraft = opts.isBusinessCraft === true;
  // productOnly is the scene-2 UGC case: only the product is in frame, no
  // person, no hands. Default it from the beat so older callers don't need to
  // be updated, but let route.js force it explicitly for safety.
  const productOnly = opts.productOnly === true || (!isBusinessCraft && beatKey === 2);

  // reference-to-video reads `@Image1` / `@Image2` (capital I) tokens to bind
  // each prompt mention to a specific reference image. The tag set must match
  // the actual references the route is sending — never declare an @Image2 we
  // didn't pass, or Seedance will invent something to fill it.
  const tagDeclarations = (() => {
    if (isBusinessCraft) {
      if (beatKey === 1) return "@Image1 is the person (character reference for identity consistency).";
      if (beatKey === 2) return "@Image1 references show the business setting (the only subjects in this scene — no person should appear).";
      return "@Image1 is the person (character reference for identity consistency). @Image2 references the business setting.";
    }
    switch (beatKey) {
      case 1:
        return "@Image1 is the woman (character reference for identity consistency).";
      case 2:
        return "@Image1 is the product (the only subject in this scene — no person should appear).";
      case 3:
      case 4:
        return "@Image1 is the woman (character reference for identity consistency). @Image2 is the product she holds.";
      default:
        return "@Image1 is the woman (character reference). @Image2 is the product.";
    }
  })();

  const cameraPhysics = SEEDANCE_CAMERA_PHYSICS[beatKey];
  const expression = SEEDANCE_EXPRESSION_DIRECTION[beatKey];

  const styleCloser = beatKey === 2
    ? "Style: UGC, propped phone, completely static camera. Organic and real."
    : "Style: UGC, organic, realistic phone footage. Slightly grainy phone sensor feel, no stylized color grade, low contrast, flat color grading, desaturated tones, slightly washed out, eye-level framing, real-world environment with everyday details visible.";

  let productLockBlock = (beatKey !== 1 && productName)
    ? `PRODUCT LOCK: the product (${productName}) appearing in this scene is IDENTICAL to the source image — same exact color, same exact shape, same exact texture, same exact label and details. Do NOT alter product appearance. Product is anchored in frame.`
    : '';

  if (beatKey === 3 && productName) {
    productLockBlock += `\n\nSCENE 3 LOCK: product shape, label, color, proportions remain EXACTLY as reference — no morphing, no label change, no color shift during action. Rigid physical object.`;
  }

  // Per-scene negative tweak: scene 4 may legitimately show a vehicle for car
  // products; otherwise add the no-vehicle rule onto the base negatives line.
  // For product-only beats, layer on hard "no person" cues so Seedance can't
  // hallucinate a random body to fill an unreferenced avatar slot.
  let negatives = opts.scene4Context
    ? SEEDANCE_NEGATIVES
    : SEEDANCE_NEGATIVES.replace(/\.$/, ', NEVER in a vehicle.');
  if (productOnly) {
    negatives = negatives.replace(
      /\.$/,
      ', no person, no woman, no man, no hands, no fingers, no arms, no body parts, no face, no avatar, no model, no human silhouette, no holding, no hands entering frame.'
    );
  }

  const parts = [
    UGC_MODE_TRIGGER,
    tagDeclarations,
    cameraPhysics,
    raw,
    expression,
    SEEDANCE_MACRO_DETAIL[beatKey],
    SEEDANCE_LIGHT_DIRECTION[beatKey],
    SEEDANCE_AUTO_EXPOSURE,
    productLockBlock,
    styleCloser,
    SEEDANCE_SILENT,
    negatives
  ].filter(Boolean);

  const finalPrompt = parts.join('\n\n');

  // Length guard. Keep the structural layers (camera/expression/negatives) and
  // shorten the raw scene description if we run over the 2400-char buffer.
  // raw lives at parts index 3 (after UGC_MODE_TRIGGER + tagDeclarations + cameraPhysics).
  if (finalPrompt.length > SEEDANCE_HARD_LIMIT) {
    console.warn(`[buildSeedancePrompt] EMERGENCY TRIM: ${finalPrompt.length} → ${SEEDANCE_HARD_LIMIT}`);
    const overhead = parts.filter((_, i) => i !== 3).join('\n\n').length + 20;
    const room = SEEDANCE_HARD_LIMIT - overhead;
    const truncatedRaw = room > 0 ? raw.slice(0, room) : '';
    const trimmed = [
      UGC_MODE_TRIGGER,
      tagDeclarations,
      cameraPhysics,
      truncatedRaw,
      expression,
      SEEDANCE_MACRO_DETAIL[beatKey],
      SEEDANCE_LIGHT_DIRECTION[beatKey],
      SEEDANCE_AUTO_EXPOSURE,
      productLockBlock,
      styleCloser,
      SEEDANCE_SILENT,
      negatives
    ].filter(Boolean).join('\n\n');
    console.log(`[buildSeedancePrompt] TRIMMED PROMPT (${trimmed.length} chars):`);
    console.log(trimmed);
    return trimmed;
  }

  return finalPrompt;
}

// Backward compatibility — older imports still call buildKlingPrompt.
export function buildKlingPrompt(...args) {
  return buildSeedancePrompt(...args);
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
