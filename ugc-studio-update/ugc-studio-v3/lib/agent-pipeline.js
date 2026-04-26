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
  getMandatoryProductPhrases,
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

// Map an avatar URL / filename to the actor id used by lib/ugc-skills. The
// skill's Layer-1 identity lock needs this to pick the right actor card.
//
// The studio UI (app/studio/page.js) ships six avatars under
// /avatars/avatar-{1..6}.jpg, displayed as Maya, Noa, Adam, Yoav, Lior, Dana.
// We only have three actor cards (daniel/noa/maya), so the four extras map to
// the closest-gender card. Custom (data:) uploads return null and the caller
// is expected to throw — the legacy fallback was removed so silent drift to a
// no-realism prompt no longer happens.
export function mapAvatarToActorId(avatarUrl) {
  const info = mapAvatarToActorInfo(avatarUrl);
  return info ? info.actorId : null;
}

// Richer mapping that also reports whether the chosen card is a best-effort
// fallback (Adam/Yoav/Lior/Dana have no card of their own; we route them to
// the closest-gender card and signal the consumer to lean on the reference
// image instead of the hard-coded identity-lock text).
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

  let enhancedPrompt;
  if (productOnly) {
    const productOnlyRule = 'PRODUCT ONLY SHOT — absolutely no person, no human, no hands holding the product, no face, no body parts, no avatar, no model. The frame contains ONLY the product resting on a surface. Pure product photography, studio-style, no humans in frame whatsoever.';
    const productNegatives = 'Negative (STRICT): person, human, woman, man, hands, face, body, avatar, model, people, arms, fingers, holding, selfie, skin, hair, limbs, silhouette.';
    const productRealism = 'shot on iPhone back camera in a real home setting, natural daylight through a nearby window plus ambient room light, slight handheld angle rather than dead-on tripod, subtle lens softness at corners, flat washed-out color grading, low saturation, uncolor-graded, realistic surface with tiny imperfections — faint dust, small fingerprint smudge, organic wood grain or authentic marble veining, mild warm white balance, no studio softbox, no seamless white backdrop, no perfectly clean catalog look, product firmly grounded on the surface with a visible contact shadow, product is NOT floating, NOT levitating, NOT suspended, NOT hovering, edges of the product render cleanly without melted geometry';
    const mandatoryProduct = getMandatoryProductPhrases().join('; ');
    enhancedPrompt = `${productOnlyRule} ${prompt}, realistic product photography, product clearly resting on a physical surface with contact shadow, ${productRealism}, REALISM ANCHORS — MANDATORY: ${mandatoryProduct}. photorealistic, looks like a real phone photo not a render, no burned-in subtitles or captions or on-screen text or graphic overlays. ${productNegatives}`;
  } else {
    // Skill-driven path is the only supported non-productOnly path. Callers
    // must supply actorId + beat. The legacy fallback was removed because it
    // skipped the mandatory realism anchors entirely and produced AI-vibe
    // frames (oversized eyes, plastic smile, fused fingers).
    if (!opts.actorId) {
      throw new Error('generateNBFrame: opts.actorId is required for non-productOnly frames (mandatory realism anchors live in the skill path).');
    }
    if (!opts.beat) {
      throw new Error('generateNBFrame: opts.beat is required for non-productOnly frames.');
    }
    enhancedPrompt = generateUGCPrompt({
      actorId: opts.actorId,
      productName: opts.productName,
      beat: opts.beat,
      sceneContext: prompt,
      scene4Context,
      isBusinessCraft: opts.isBusinessCraft === true,
      shotTypeOverride: opts.shotTypeOverride,
      isFallbackActor: opts.isFallbackActor === true
    });
  }

  const endpointId = validUrls.length === 0
    ? 'fal-ai/nano-banana-2'
    : 'fal-ai/nano-banana-2/edit';
  console.log('[NB] Model:', endpointId, 'Images:', validUrls.length, { promptLen: enhancedPrompt?.length, productOnly, scene4Context, urlPreviews: validUrls.map(u => u?.slice(0, 60)) });
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
