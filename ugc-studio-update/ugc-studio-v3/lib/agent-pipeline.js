// Shared helpers for the agent pipeline.
//
// Extracted from app/api/agent/route.js so the regenerate-scene endpoint
// (app/api/agent/regenerate-scene/route.js) can reuse the same frame-
// generation logic and prompt-lock constants without duplication.
//
// As of the UGC Creator Pro skill rollout, the identity-lock / anatomy / no-
// phone / anti-AI / product-lock rules all live in lib/ugc-skills/. We re-
// export the stable constants here for backwards compat and delegate prompt
// wrapping to the skill's building blocks so there is one source of truth.
//
// Callers must have configured `fal` (via `fal.config({ credentials: ... })`)
// before invoking `generateNBFrame`. Both route files configure it at module
// load from process.env.FAL_API_KEY, so nothing to do here.

import { fal } from '@fal-ai/client'
import {
  generateUGCPrompt,
  buildPrompt,
  buildKlingPrompt,
  getActorCard,
  getShotTypeForBeat,
  getShotType,
  CHARACTER_REF_RULE,
  ANATOMY_RULE,
  STANDARD_NEGATIVES,
  ANATOMY_NEGATIVES,
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

// Generate a still frame via NanoBanana (fal.ai).
//
//   prompt       — scene-specific nb_prompt (Claude-authored or custom)
//   imageUrls    — reference images (avatar, product, prev-frame) — may be empty
//   maxRetries   — retries on 403/429
//   opts.productOnly     — scene 2 product-only composition (no person)
//   opts.scene4Context   — scene 4 aspirational-result (drops default lighting
//                          + vehicle negative so contextual setting dominates)
//   opts.actorId         — (optional) 'daniel' | 'noa' | 'maya'. When present
//                          alongside opts.beat, the prompt is rebuilt end-to-end
//                          via the skill's buildPrompt(). Without these, we
//                          fall back to the legacy wrapping path so existing
//                          callers keep working unchanged.
//   opts.beat            — 1..4 storytelling beat; required when using actorId
//   opts.isBusinessCraft — use BUSINESS_CRAFT_LOCK instead of PRODUCT_LOCK
//   opts.productName     — passed through to skill for product-context overlays
//
// Returns the generated image URL, or throws after maxRetries failures.
export async function generateNBFrame(prompt, imageUrls, maxRetries = 3, opts = {}) {
  const validUrls = imageUrls.filter(Boolean);
  const productOnly = opts.productOnly === true;
  const scene4Context = opts.scene4Context === true;
  const useSkill = Boolean(opts.actorId && opts.beat);

  let enhancedPrompt;
  if (productOnly) {
    const productOnlyRule = 'PRODUCT ONLY SHOT — absolutely no person, no human, no hands holding the product, no face, no body parts, no avatar, no model. The frame contains ONLY the product resting on a surface. Pure product photography, studio-style, no humans in frame whatsoever.';
    const productNegatives = 'Negative (STRICT): person, human, woman, man, hands, face, body, avatar, model, people, arms, fingers, holding, selfie, skin, hair, limbs, silhouette.';
    const productRealism = 'shot on iPhone back camera in a real home setting, natural daylight through a nearby window plus ambient room light, slight handheld angle rather than dead-on tripod, subtle lens softness at corners, flat washed-out color grading, low saturation, uncolor-graded, realistic surface with tiny imperfections — faint dust, small fingerprint smudge, organic wood grain or authentic marble veining, mild warm white balance, no studio softbox, no seamless white backdrop, no perfectly clean catalog look, product firmly grounded on the surface with a visible contact shadow, product is NOT floating, NOT levitating, NOT suspended, NOT hovering, edges of the product render cleanly without melted geometry';
    enhancedPrompt = `${productOnlyRule} ${prompt}, realistic product photography, product clearly resting on a physical surface with contact shadow, ${productRealism}, photorealistic, looks like a real phone photo not a render, no burned-in subtitles or captions or on-screen text or graphic overlays. ${productNegatives}`;
  } else if (useSkill) {
    // Skill-driven path — full 6-layer prompt. sceneContext is the caller's
    // existing nb_prompt string, which becomes Layer 2 (Scenario).
    enhancedPrompt = generateUGCPrompt({
      actorId: opts.actorId,
      productName: opts.productName,
      beat: opts.beat,
      sceneContext: prompt,
      scene4Context,
      isBusinessCraft: opts.isBusinessCraft === true,
      shotTypeOverride: opts.shotTypeOverride
    });
  } else {
    // Legacy path — skill building-blocks glued together to match the previous
    // wrapping behavior, so routes that haven't been updated keep working.
    const vehicleNegative = scene4Context ? '' : ', NEVER in a car, NEVER in a vehicle';
    const standardNeg = STANDARD_NEGATIVES
      .filter(n => !n.startsWith('no phone'))
      .join(', ');
    const anatomyNeg = ANATOMY_NEGATIVES.join(', ');
    const selfieRealism = 'Natural iPhone selfie captured in the moment. Authentic casual expression. Ambient lighting from the scene.';
    enhancedPrompt = `${CHARACTER_REF_RULE} ${ANATOMY_RULE} ${prompt}, ${selfieRealism}, ${standardNeg}, If holding a product, hold it with ONE hand only, other hand visible and relaxed at side, never two items at once. exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene${vehicleNegative}, no burned-in subtitles or captions or on-screen text or graphic overlays. Negative (avoid): ${anatomyNeg}.`;
  }

  const endpointId = validUrls.length === 0
    ? 'fal-ai/nano-banana-2'
    : 'fal-ai/nano-banana-2/edit';
  console.log('[NB] Model:', endpointId, 'Images:', validUrls.length, { promptLen: enhancedPrompt?.length, productOnly, scene4Context, useSkill, urlPreviews: validUrls.map(u => u?.slice(0, 60)) });
  const input = validUrls.length === 0
    ? { prompt: enhancedPrompt, image_size: { width: 720, height: 1280 } }
    : { prompt: enhancedPrompt, image_urls: validUrls, image_size: { width: 720, height: 1280 } };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fal.run(endpointId, { input });
      console.log('NB response:', JSON.stringify(result.data).slice(0, 400));
      const imageUrl = result.data.images?.[0]?.url || result.data.images?.[0] || null;
      console.log('NB image URL:', imageUrl?.slice(0, 100));
      return imageUrl;
    } catch (err) {
      const status = err.status || err.statusCode || 'unknown';
      const body = err.body || err.message || String(err);
      console.error(`NB frame attempt ${attempt}/${maxRetries} failed — status: ${status}, body:`, JSON.stringify(body).slice(0, 500));
      if ((status === 403 || status === 429) && attempt < maxRetries) {
        const delay = attempt * 2000;
        console.log(`NB retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
