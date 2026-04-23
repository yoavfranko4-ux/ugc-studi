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
import { getAnchorPhrases } from './realism-anchors.js';
import { getShotType } from './shot-types.js';

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
  skipPhoneNegative = false
} = {}) {
  if (!actor) throw new Error('buildPrompt: actor is required');

  // Layer 1 — Character Lock
  const layer1 = [
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

  // Layer 5 — Realism Injection
  const anchors = getAnchorPhrases(shotType);
  const layer5 = `Realism: ${anchors.join('; ')}.`;

  // Layer 6 — Negatives (anatomy + standard + caller overrides)
  const negatives = [...STANDARD_NEGATIVES];
  if (skipPhoneNegative) {
    // Drop the "no phone visible" rule for selfie-style shots.
    const idx = negatives.findIndex(n => n.startsWith('no phone'));
    if (idx >= 0) negatives.splice(idx, 1);
  }
  const layer6 = [
    ANATOMY_RULE,
    SINGLE_HAND_RULE,
    `NEGATIVE: ${negatives.join(', ')}.`,
    `Anatomy negatives: ${ANATOMY_NEGATIVES.join(', ')}.`,
    customNegatives ? `Product / context negatives: ${customNegatives}` : ''
  ].filter(Boolean).join(' ');

  return [layer1, layer2, layer3, layer4, layer5, layer6].join('\n\n');
}

// Re-export so orchestrator can use one import path.
export { CAMERA_PROFILES };
