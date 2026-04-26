// The 6-layer prompt builder. Every NanoBanana prompt emitted by the pipeline
// flows through buildPrompt(); layers are concatenated in a fixed order so that
// identity-locking always dominates and negatives always land last.
//
// Layer order (don't change without thought):
//   1. Character Lock — preserve the actor's identity from the reference
//   2. Scenario        — what's happening in this moment
//   3. Environment     — where it happens
//   4. Camera          — which lens / framing
//   5. Realism         — 3-4 anchors picked from realism-anchors.js
//   6. Negatives       — standard AI-tells to avoid + caller-supplied extras

import { CAMERA_PROFILES, getCameraProfile } from './camera-profiles.js';
import {
  getAnchorPhrases,
  getMandatoryHumanPhrases,
  REALISM_ANCHORS
} from './realism-anchors.js';
import { getShotType } from './shot-types.js';

// Length budgets. NanoBanana accepts longer prompts but signal degrades past
// ~3000 chars and the mandatory anchors lose weight if buried. Trim ladder:
//   > 2800 → drop shot-specific realism (Layer 5 tail)
//   > 3000 → keep first 5 mandatory + always-notAI (Layer 5 head)
//   > 3500 → trim Layer 6 (truncate STANDARD_NEGATIVES + ANATOMY_NEGATIVES,
//            shorten PRODUCT_LOCK / PRODUCT_CONSISTENCY; keep KIPPAH /
//            HELD_PRODUCT_INTEGRATION because they enforce consistency).
const PROMPT_LEN_TRIM_SHOT = 2800;
const PROMPT_LEN_TRIM_MANDATORY = 3000;
const PROMPT_LEN_TRIM_LAYER6 = 3500;
const MANDATORY_KEEP_AFTER_TRIM = 5;
const STANDARD_NEG_KEEP_AFTER_TRIM = 5;
const ANATOMY_NEG_KEEP_AFTER_TRIM = 3;
const NOT_AI_PHRASE = REALISM_ANCHORS.notAI;

// Compact replacement for the long PRODUCT_LOCK + PRODUCT_CONSISTENCY block
// inside customNegatives. PRODUCT_LOCK in consistency-protocol is a single
// string that already glues both sections together, so we replace everything
// up to (but not including) the next section header — which is one of
// "PRODUCT INTEGRATION:", "HELD PRODUCT INTEGRATION:", "KIPPAH INTEGRATION:"
// — and keep those tail sections verbatim because they enforce consistency.
const PRODUCT_LOCK_COMBINED_SHORT =
  'PRODUCT LOCK: product appearance is identical across all 4 scenes — ' +
  'same shape, color, logo, text, material, no morphing, no drift. ' +
  'PRODUCT CONSISTENCY: identical to source image — color, texture, ' +
  'embroidery, stitching, graphics. Do not redraw or relocate any details.';
// Section headers that may appear after PRODUCT_LOCK + PRODUCT_CONSISTENCY
// inside customNegatives. The PRODUCT_LOCK trim cuts at the earliest of
// these so every integration block downstream is preserved verbatim.
const PRODUCT_LOCK_TAIL_HEADERS = [
  'PRODUCT INTEGRATION:',
  'HELD PRODUCT INTEGRATION:',
  // Per-category integration headers from PRODUCT_CATEGORIES.
  'HEADWEAR INTEGRATION:',
  'WORN-BODY INTEGRATION:',
  'WORN-FACE INTEGRATION:',
  'SKIN-APPLIED PRODUCT INTEGRATION:',
  'LIQUID INTEGRATION:',
  'FOOD INTEGRATION:',
  'TECH INTEGRATION:',
  'BEAUTY PRODUCT INTEGRATION:'
];

function shortenProductLockBlock(text) {
  if (!text) return text;
  const lockIdx = text.indexOf('PRODUCT LOCK:');
  if (lockIdx === -1) return text;
  // Find the earliest tail header that appears AFTER the PRODUCT LOCK header.
  let cutIdx = -1;
  for (const header of PRODUCT_LOCK_TAIL_HEADERS) {
    const i = text.indexOf(header, lockIdx + 'PRODUCT LOCK:'.length);
    if (i !== -1 && (cutIdx === -1 || i < cutIdx)) cutIdx = i;
  }
  const before = text.slice(0, lockIdx);
  const tail = cutIdx === -1 ? '' : text.slice(cutIdx);
  return `${before}${PRODUCT_LOCK_COMBINED_SHORT}${tail ? ' ' + tail : ''}`;
}

// Compact replacement for the generic PRODUCT_INTEGRATION block. Applied only
// as a last-resort trim if the full prompt is still > PROMPT_LEN_TRIM_LAYER6
// after the PRODUCT_LOCK shortening + negatives truncation. HELD_PRODUCT_
// INTEGRATION and per-category integration blocks are preserved verbatim by
// default because they enforce shot-specific / product-specific rules.
const PRODUCT_INTEGRATION_SHORT =
  'PRODUCT INTEGRATION: product physically integrated with the scene, not composited — ' +
  'natural contact shadows on skin/hair/fabric, hair flows around product edges, ' +
  'product reflects ambient scene lighting, NOT pasted-on, NOT a sticker.';

// Last-resort compact replacement for HELD_PRODUCT_INTEGRATION. The category
// integration (e.g. HEADWEAR / WORN-FACE / etc.) is the most product-specific
// signal so it stays verbatim; if the prompt is *still* over budget after the
// generic PRODUCT_INTEGRATION compaction, we fall back to this short HELD.
const HELD_PRODUCT_INTEGRATION_SHORT =
  'HELD PRODUCT INTEGRATION: visible grip pressure, fingers in contact with the product ' +
  '(not floating), subtle shadow between palm and product.';
const HELD_PRODUCT_INTEGRATION_HEADER = 'HELD PRODUCT INTEGRATION:';
// Headers that may follow the HELD block. Anything matching one of these is
// kept; the HELD block itself is replaced with HELD_PRODUCT_INTEGRATION_SHORT.
const HELD_INTEGRATION_TAIL_HEADERS = [
  'HEADWEAR INTEGRATION:',
  'WORN-BODY INTEGRATION:',
  'WORN-FACE INTEGRATION:',
  'SKIN-APPLIED PRODUCT INTEGRATION:',
  'LIQUID INTEGRATION:',
  'FOOD INTEGRATION:',
  'TECH INTEGRATION:',
  'BEAUTY PRODUCT INTEGRATION:'
];

function shortenHeldIntegrationBlock(text) {
  if (!text) return text;
  const heldIdx = text.indexOf(HELD_PRODUCT_INTEGRATION_HEADER);
  if (heldIdx === -1) return text;
  let cutIdx = -1;
  for (const header of HELD_INTEGRATION_TAIL_HEADERS) {
    const i = text.indexOf(header, heldIdx + HELD_PRODUCT_INTEGRATION_HEADER.length);
    if (i !== -1 && (cutIdx === -1 || i < cutIdx)) cutIdx = i;
  }
  const before = text.slice(0, heldIdx);
  const tail = cutIdx === -1 ? '' : text.slice(cutIdx);
  return `${before}${HELD_PRODUCT_INTEGRATION_SHORT}${tail ? ' ' + tail : ''}`;
}

// Absolute last-resort short forms for the per-category integration blocks.
// Applied only when every other trim has already fired and the prompt is
// STILL over PROMPT_LEN_TRIM_LAYER6. The category signal stays present (NB
// still knows the product type) but each block drops to a one-liner.
const CATEGORY_INTEGRATION_SHORT = {
  'HEADWEAR INTEGRATION:':
    'HEADWEAR INTEGRATION: sits on head following skull curvature, hair flows around and under the edges, natural forehead/hairline shadow, NOT floating above hair.',
  'WORN-BODY INTEGRATION:':
    'WORN-BODY INTEGRATION: fabric drapes with gravity, realistic creases at elbows/waist/shoulders, natural neckline, no plastic-mannequin look.',
  'WORN-FACE INTEGRATION:':
    'WORN-FACE INTEGRATION: realistic skin compression at contact points, natural shadow on skin, item moves with the head, NOT floating.',
  'SKIN-APPLIED PRODUCT INTEGRATION:':
    'SKIN-APPLIED PRODUCT INTEGRATION: subtle sheen on skin with partially-absorbed look, real skin texture still visible, NOT a flat color overlay.',
  'LIQUID INTEGRATION:':
    'LIQUID INTEGRATION: correct viscosity and surface tension, light refraction through transparent containers, real glass/plastic clarity.',
  'FOOD INTEGRATION:':
    'FOOD INTEGRATION: realistic surface variation, organic imperfections, moisture/oil sheen where appropriate, NOT plastic-looking.',
  'TECH INTEGRATION:':
    'TECH INTEGRATION: realistic screen glare and reflections, natural cable drape, slight fingerprint smudges on glossy surfaces.',
  'BEAUTY PRODUCT INTEGRATION:':
    'BEAUTY PRODUCT INTEGRATION: realistic application on skin/lips/nails, natural color blending, looks recently applied not airbrushed.'
};

function shortenCategoryIntegrationBlocks(text) {
  if (!text) return { text, changed: false };
  let result = text;
  let changed = false;
  for (const header of Object.keys(CATEGORY_INTEGRATION_SHORT)) {
    const idx = result.indexOf(header);
    if (idx === -1) continue;
    // Find where this block ends — at the next category header or end of string.
    let endIdx = result.length;
    for (const otherHeader of Object.keys(CATEGORY_INTEGRATION_SHORT)) {
      if (otherHeader === header) continue;
      const i = result.indexOf(otherHeader, idx + header.length);
      if (i !== -1 && i < endIdx) endIdx = i;
    }
    const before = result.slice(0, idx);
    const after = result.slice(endIdx).replace(/^\s+/, ' ');
    const replacement = CATEGORY_INTEGRATION_SHORT[header];
    if (result.slice(idx, endIdx).trim() !== replacement) {
      result = `${before}${replacement}${after}`;
      changed = true;
    }
  }
  return { text: result, changed };
}
const PRODUCT_INTEGRATION_HEADER = 'PRODUCT INTEGRATION:';
// Section headers that may appear after the generic PRODUCT_INTEGRATION
// block. The integration-trim cuts at the earliest of these so the
// shot-specific HELD block and any per-category integration are preserved.
const PRODUCT_INTEGRATION_TAIL_HEADERS = [
  'HELD PRODUCT INTEGRATION:',
  'HEADWEAR INTEGRATION:',
  'WORN-BODY INTEGRATION:',
  'WORN-FACE INTEGRATION:',
  'SKIN-APPLIED PRODUCT INTEGRATION:',
  'LIQUID INTEGRATION:',
  'FOOD INTEGRATION:',
  'TECH INTEGRATION:',
  'BEAUTY PRODUCT INTEGRATION:'
];

function shortenProductIntegrationBlock(text) {
  if (!text) return text;
  const intIdx = text.indexOf(PRODUCT_INTEGRATION_HEADER);
  if (intIdx === -1) return text;
  let cutIdx = -1;
  for (const header of PRODUCT_INTEGRATION_TAIL_HEADERS) {
    const i = text.indexOf(header, intIdx + PRODUCT_INTEGRATION_HEADER.length);
    if (i !== -1 && (cutIdx === -1 || i < cutIdx)) cutIdx = i;
  }
  const before = text.slice(0, intIdx);
  const tail = cutIdx === -1 ? '' : text.slice(cutIdx);
  return `${before}${PRODUCT_INTEGRATION_SHORT}${tail ? ' ' + tail : ''}`;
}

// Image-priority Layer 1 used when the chosen actor card is a best-effort
// fallback (e.g. studio "Adam" routed to the daniel card). The reference
// image is treated as the source of truth so the hard-coded daniel features
// do not contradict the actual avatar.
const IMAGE_PRIORITY_LAYER1 =
  'CHARACTER REFERENCE: Use the person from the reference image as the source of truth ' +
  'for identity. The reference image shows the actual actor — preserve their exact ' +
  'facial features, skin tone, hair color, eye color, and bone structure from the ' +
  'reference image. Ignore any text describing the actor — the IMAGE is authoritative.';

// Preserved from the legacy agent-pipeline.js — these rules cover anatomy,
// "no phone in shot", and Kling mouth-closed stability. They are factored into
// Layer 1 / Layer 6 rather than sprinkled through the pipeline.
export const CHARACTER_REF_RULE =
  'Use the person from the reference image exactly as the character — preserve their facial features, skin, hair, eye color, and bone structure from the avatar reference. Do not generate a new person; do not alter their skin texture or tone.';

export const ANATOMY_RULE =
  'CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body.';

export const SINGLE_HAND_RULE =
  'If holding a product, hold it with ONE hand only, other hand visible and relaxed at side, never two items at once.';

export const STANDARD_NEGATIVES = [
  'no beauty filter',
  'no airbrushing',
  'no HDR',
  'no AI-looking skin',
  'no overly polished appearance',
  'no professional photo shoot look',
  'no magazine style',
  'no staged composition',
  'no burned-in subtitles',
  'no text overlays',
  'no captions',
  'no on-screen graphics',
  'no phone or mobile device visible in frame (unless shot type is a selfie/mirror shot that requires it)'
];

export const ANATOMY_NEGATIVES = [
  'extra arms', 'extra hands', 'third hand', 'disembodied limbs',
  'floating hands', 'phantom limbs', 'multiple arms',
  'anatomically incorrect', 'deformed hands', 'mutant hands',
  'extra fingers', 'six fingers', 'hands from outside frame',
  'partial limbs entering from edges'
];

// Build a 6-layer prompt. All parameters are required except customNegatives
// and skipPhoneNegative (set true for selfie / mirror shots where a phone
// must appear in the frame).
export function buildPrompt({
  actor,
  scenario,
  environment,
  camera,
  shotType,
  customNegatives,
  skipPhoneNegative = false,
  isFallbackActor = false
} = {}) {
  if (!actor) throw new Error('buildPrompt: actor is required');

  // Layer 1 — Character Lock. Two variants:
  //   - exact actor card: use the hard-coded identity-lock string.
  //   - fallback (Adam/Yoav/Lior/Dana routed to a closest-gender card): the
  //     hard-coded features would contradict the reference image, so we use
  //     an image-priority block that explicitly tells NB to trust the IMAGE.
  const layer1 = isFallbackActor
    ? IMAGE_PRIORITY_LAYER1
    : [
        CHARACTER_REF_RULE,
        `Identity lock: ${actor.face.skinToneHex} skin tone, ${actor.hair.color} ${actor.hair.style} hair (${actor.hair.texture}), ${actor.face.eyeColor} eyes, ${actor.face.jawline}, ${actor.face.bonestructure}. Distinguishing features: ${actor.face.distinguishingMarks}. Body: ${actor.body.build}. Preserve every feature from the reference image — do not generate a new person.`
      ].join(' ');

  // Layer 2 — Scenario
  const layer2 = `Scenario: ${scenario}`;

  // Layer 3 — Environment
  const layer3 = `Environment: ${environment}`;

  // Layer 4 — Camera (+ shot-specific additionalMarkers if present)
  const cam = getCameraProfile(camera);
  const shot = getShotType(shotType);
  const markers = Array.isArray(shot.additionalMarkers) && shot.additionalMarkers.length
    ? ` Shot markers: ${shot.additionalMarkers.join('; ')}.`
    : '';
  const layer4 = `Camera: ${cam.name}. ${cam.description}. Depth: ${cam.depth}. Angle: ${cam.angle}.${markers}`;

  // Layer 5 — Realism Injection (mandatory + shot-tuned, with trim budget)
  let mandatoryRealism = getMandatoryHumanPhrases();
  let shotRealism = getAnchorPhrases(shotType);

  // Layer 6 — Negatives (anatomy + standard + caller overrides). Built lazily
  // so trim can rebuild it with shortened pieces.
  let standardNegList = STANDARD_NEGATIVES.filter(
    n => !(skipPhoneNegative && n.startsWith('no phone'))
  );
  let anatomyNegList = [...ANATOMY_NEGATIVES];
  let customNegativesText = customNegatives || '';

  const buildLayer5 = () =>
    `REALISM ANCHORS — MANDATORY (must appear in image, non-negotiable): ` +
    `${mandatoryRealism.join('; ')}.` +
    (shotRealism.length ? ` Shot-specific realism: ${shotRealism.join('; ')}.` : '');

  const buildLayer6 = () => [
    ANATOMY_RULE,
    SINGLE_HAND_RULE,
    `NEGATIVE: ${standardNegList.join(', ')}.`,
    `Anatomy negatives: ${anatomyNegList.join(', ')}.`,
    customNegativesText ? `Product / context negatives: ${customNegativesText}` : ''
  ].filter(Boolean).join(' ');

  const assemble = () =>
    [layer1, layer2, layer3, layer4, buildLayer5(), buildLayer6()].join('\n\n');

  let finalPrompt = assemble();
  let trim = 'none';

  if (finalPrompt.length > PROMPT_LEN_TRIM_SHOT) {
    shotRealism = [];
    finalPrompt = assemble();
    trim = 'shot-specific';
  }

  if (finalPrompt.length > PROMPT_LEN_TRIM_MANDATORY) {
    // Keep first N mandatory anchors but always include notAI at the end.
    const head = mandatoryRealism.slice(0, MANDATORY_KEEP_AFTER_TRIM);
    if (!head.includes(NOT_AI_PHRASE)) head.push(NOT_AI_PHRASE);
    mandatoryRealism = head;
    finalPrompt = assemble();
    trim = 'mandatory+shot';
  }

  if (finalPrompt.length > PROMPT_LEN_TRIM_LAYER6) {
    console.warn(`[buildPrompt] WARNING: prompt is ${finalPrompt.length} chars, trimming Layer 6`);
    standardNegList = standardNegList.slice(0, STANDARD_NEG_KEEP_AFTER_TRIM);
    anatomyNegList = anatomyNegList.slice(0, ANATOMY_NEG_KEEP_AFTER_TRIM);
    if (customNegativesText) {
      // Shorten PRODUCT_LOCK + PRODUCT_CONSISTENCY in place. Keep
      // PRODUCT_INTEGRATION / HELD_PRODUCT_INTEGRATION / KIPPAH_INTEGRATION
      // intact — those carry consistency rules we cannot afford to lose.
      customNegativesText = shortenProductLockBlock(customNegativesText)
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    finalPrompt = assemble();
    trim = trim === 'none' ? 'layer6' : `${trim}+layer6`;

    // Last-resort: still over budget? Compact the generic PRODUCT_INTEGRATION
    // block too. The per-category integration (HEADWEAR / WORN-FACE / etc.)
    // and the HELD block stay verbatim at this stage.
    if (finalPrompt.length > PROMPT_LEN_TRIM_LAYER6 && customNegativesText) {
      const before = customNegativesText;
      customNegativesText = shortenProductIntegrationBlock(customNegativesText)
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (customNegativesText !== before) {
        finalPrompt = assemble();
        trim = `${trim}+integration`;
      }
    }

    // Final tier — only when a per-category integration block has stacked on
    // top of HELD and we are still over budget. The category block is the
    // most product-specific signal so it wins; HELD compresses to a one-liner.
    if (finalPrompt.length > PROMPT_LEN_TRIM_LAYER6 && customNegativesText) {
      const before = customNegativesText;
      customNegativesText = shortenHeldIntegrationBlock(customNegativesText)
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (customNegativesText !== before) {
        finalPrompt = assemble();
        trim = `${trim}+held`;
      }
    }

    // Absolute last resort — compact every per-category integration block to
    // its one-liner short form. The category signal still survives so NB
    // knows the product type; only the verbose explanatory phrasing is cut.
    if (finalPrompt.length > PROMPT_LEN_TRIM_LAYER6 && customNegativesText) {
      const { text: shortened, changed } = shortenCategoryIntegrationBlocks(customNegativesText);
      if (changed) {
        customNegativesText = shortened.replace(/\s{2,}/g, ' ').trim();
        finalPrompt = assemble();
        trim = `${trim}+category`;
      }
    }
  }

  console.log('[buildPrompt] length', finalPrompt.length, 'trim:', trim, 'shotType:', shotType, 'fallbackActor:', isFallbackActor);

  return finalPrompt;
}

// Re-export so orchestrator can use one import path.
export { CAMERA_PROFILES };
