// Shared helpers for the agent pipeline.
//
// Extracted from app/api/agent/route.js so the regenerate-scene endpoint
// (app/api/agent/regenerate-scene/route.js) can reuse the same frame-
// generation logic and prompt-lock constants without duplication.
//
// Callers must have configured `fal` (via `fal.config({ credentials: ... })`)
// before invoking `generateNBFrame`. Both route files configure it at module
// load from process.env.FAL_API_KEY, so nothing to do here.

import { fal } from '@fal-ai/client'

export const SCENE_DURATIONS = [5, 5, 5, 5];

// Append this to every Kling prompt to lock mouth/face/product across frames.
export const STABLE = 'silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference';

// Product-lock phrase bundle — injected into every Kling prompt for
// product-containing scenes (2/3/4) to fight Kling's object-drift failure
// mode where the product slowly morphs into a different object.
export const PRODUCT_LOCK = 'PRODUCT LOCK: the product maintains EXACT same appearance throughout the entire video — same shape, same color, same logo, same text, same material, same position, rigid physical object that does not morph, every frame identical in product identity to the reference, no product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no product becoming a different object, no product identity drift, no gradual transformation into a similar-but-different item.';

// Business-flow equivalent — locks tools / finished work / signage.
export const BUSINESS_CRAFT_LOCK = 'PRODUCT/CRAFT LOCK: the signature items (tools, finished dish/garment/styling, branded signage, finished work) maintain EXACT same appearance throughout the entire video — same shape, color, logo, text, materials, position, rigid physical objects that do not morph, every frame identical in product identity to the reference, no tool or product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no dish/garment/finished-work becoming a different object, no identity drift, no gradual transformation into a similar-but-different item.';

// Generate a still frame via NanoBanana (fal.ai).
//
//   prompt       — scene-specific nb_prompt (Claude-authored or custom)
//   imageUrls    — reference images (avatar, product, prev-frame) — may be empty
//   maxRetries   — retries on 403/429
//   opts.productOnly     — scene 2 product-only composition (no person)
//   opts.scene4Context   — scene 4 aspirational-result (drops default lighting
//                          + vehicle negative so contextual setting dominates)
//
// Returns the generated image URL, or throws after maxRetries failures.
export async function generateNBFrame(prompt, imageUrls, maxRetries = 3, opts = {}) {
  const validUrls = imageUrls.filter(Boolean);
  const productOnly = opts.productOnly === true;
  const scene4Context = opts.scene4Context === true;
  console.log('NB input:', { promptLen: prompt?.length, urlCount: validUrls.length, productOnly, scene4Context, urlPreviews: validUrls.map(u => u?.slice(0, 60)) });

  let enhancedPrompt;
  if (productOnly) {
    const productOnlyRule = 'PRODUCT ONLY SHOT — absolutely no person, no human, no hands holding the product, no face, no body parts, no avatar, no model. The frame contains ONLY the product resting on a surface. Pure product photography, studio-style, no humans in frame whatsoever.';
    const productNegatives = 'Negative (STRICT): person, human, woman, man, hands, face, body, avatar, model, people, arms, fingers, holding, selfie, skin, hair, limbs, silhouette.';
    const productRealism = 'shot on iPhone back camera in a real home setting, natural daylight through a nearby window plus ambient room light, slight handheld angle rather than dead-on tripod, subtle lens softness at corners, flat washed-out color grading, low saturation, uncolor-graded, realistic surface with tiny imperfections — faint dust, small fingerprint smudge, organic wood grain or authentic marble veining, mild warm white balance, no studio softbox, no seamless white backdrop, no perfectly clean catalog look, product firmly grounded on the surface with a visible contact shadow, product is NOT floating, NOT levitating, NOT suspended, NOT hovering, edges of the product render cleanly without melted geometry';
    enhancedPrompt = `${productOnlyRule} ${prompt}, realistic product photography, product clearly resting on a physical surface with contact shadow, ${productRealism}, photorealistic, looks like a real phone photo not a render, no burned-in subtitles or captions or on-screen text or graphic overlays. ${productNegatives}`;
  } else {
    const anatomyPrefix = 'CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body.';
    const negativeConcepts = 'Negative (avoid): extra arms, extra hands, third hand, disembodied limbs, floating hands, phantom limbs, multiple arms, anatomically incorrect, deformed hands, mutant hands, extra fingers, six fingers, hands from outside frame, partial limbs entering from edges.';
    const singleHandRule = 'If holding a product, hold it with ONE hand only, other hand visible and relaxed at side, never two items at once.';
    const selfieRealism = 'Natural iPhone selfie photo. Real unfiltered skin with subtle texture, not airbrushed. Authentic casual moment, caught mid-moment with natural expression.';
    const naturalLight = 'natural ambient lighting from the environment';
    const antiAI = 'no overly polished skin, no beauty filter, no HDR, no airbrushing, no AI-looking';
    const lightingPart = scene4Context ? '' : `, ${naturalLight}`;
    const vehicleNegative = scene4Context ? '' : ', NEVER in a car, NEVER in a vehicle';
    enhancedPrompt = `${anatomyPrefix} ${prompt}, ${selfieRealism}${lightingPart}, ${antiAI}, real avatar not model, ${singleHandRule} exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene${vehicleNegative}, no burned-in subtitles or captions or on-screen text or graphic overlays. ${negativeConcepts}`;
  }

  const endpointId = validUrls.length === 0
    ? 'fal-ai/nano-banana-2'
    : 'fal-ai/nano-banana-2/edit';
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
