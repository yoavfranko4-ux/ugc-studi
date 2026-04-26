// Cross-scene consistency checks. generateUGCPrompt is single-scene; when a
// caller has assembled all four scenes it can run ensureConsistency() to catch
// continuity errors *before* shipping the frames to NanoBanana.

// Legacy STABLE + PRODUCT_LOCK phrases preserved verbatim — the Kling prompt
// side of the pipeline still concatenates these.

export const STABLE =
  'silent, no talking, no lip movement, mouth closed or naturally relaxed, ' +
  'maintain consistent facial features, no face distortion, stable face anatomy, ' +
  'smooth natural motion only, no mouth movement, avatar is not speaking, ' +
  'natural micro-movements breathing only, handheld iPhone wobble no stabilizer, ' +
  'no sudden jumps, product shape and colors unchanged from reference';

export const PRODUCT_LOCK =
  'PRODUCT LOCK: the product maintains EXACT same appearance throughout the entire video — ' +
  'same shape, same color, same logo, same text, same material, same position, ' +
  'rigid physical object that does not morph, every frame identical in product identity ' +
  'to the reference, no product morphing, no shape changing, no color shifting, ' +
  'no logo transformation, no text changing, no material distortion, ' +
  'no product becoming a different object, no product identity drift, ' +
  'no gradual transformation into a similar-but-different item. ' +
  'PRODUCT CONSISTENCY: The product appearing in this scene must be IDENTICAL to ' +
  'the product shown in the source image — same color, same texture, same shape, ' +
  'same details, same embroidery/patterns, same stitching, same fabric weave, ' +
  'same printed graphics. Do NOT change the product\'s appearance between scenes. ' +
  'Do NOT modify color, do NOT alter material, do NOT redraw embroidery, ' +
  'do NOT re-letter any text. The product is the central anchor of consistency ' +
  'across all 4 scenes — identical in scene 1, scene 2, scene 3, and scene 4.';

// PRODUCT_INTEGRATION is appended *after* PRODUCT_LOCK for scenes where a
// person and product share the frame (beats 3 and 4). PRODUCT_LOCK preserves
// identity; PRODUCT_INTEGRATION stops the product from looking pasted-on.
export const PRODUCT_INTEGRATION =
  'PRODUCT INTEGRATION: the product must be physically INTEGRATED with the scene, not composited. ' +
  'Product casts natural shadows onto skin / hair / fabric beneath it. ' +
  'Hair naturally frames or flows around the product edges — no clean hard cut-out line. ' +
  'Product surface reflects the ambient scene lighting (warm highlights where lights are warm, cool where cool). ' +
  'Product edges blend naturally into the person, with subtle skin-tone color bounce onto the product edges. ' +
  'Any fabric drapes realistically with natural folds and creases. ' +
  'Product has real physical weight and sits naturally in place. ' +
  'Looks like it belongs in the scene from the moment of capture. ' +
  'NOT pasted-on, NOT Photoshopped, NOT overlaid, NOT a 2D sticker, NOT a floating decal.';

// Product-specific integration hints. Layered on top of PRODUCT_INTEGRATION
// for beats 3 and 4 to catch product-specific tells that make NB cheat.
export const PRODUCT_INTEGRATION_BY_PRODUCT = {
  kippah:
    'KIPPAH INTEGRATION: hair flows around the kippah edges with a few strands visible over / around it (never a hard clean line). ' +
    'The kippah sits with a slight indent pressing into the hair below it. ' +
    'Natural shadow under the kippah\'s bottom edge on the hair. ' +
    'Kippah fabric catches the same scene lighting as the surrounding hair.',
  kipa:
    'KIPPAH INTEGRATION: hair flows around the kippah edges with a few strands visible over / around it (never a hard clean line). ' +
    'The kippah sits with a slight indent pressing into the hair below it. ' +
    'Natural shadow under the kippah\'s bottom edge on the hair. ' +
    'Kippah fabric catches the same scene lighting as the surrounding hair.'
};

// Generic hint for "held product" shots (beat 3). Appended whenever the
// shot type is held-product regardless of product name.
export const HELD_PRODUCT_INTEGRATION =
  'HELD PRODUCT INTEGRATION: fingertips press into the product showing real grip pressure. ' +
  'Product does NOT float in the hand — visible contact between palm, fingers, and product. ' +
  'Subtle shadow between the product and the palm. ' +
  'Skin around the grip shows slight tension where fingers curl around the product.';

export const BUSINESS_CRAFT_LOCK =
  'PRODUCT/CRAFT LOCK: the signature items (tools, finished dish/garment/styling, ' +
  'branded signage, finished work) maintain EXACT same appearance throughout the entire ' +
  'video — same shape, color, logo, text, materials, position, rigid physical objects ' +
  'that do not morph, every frame identical in product identity to the reference, ' +
  'no tool or product morphing, no shape changing, no color shifting, no logo transformation, ' +
  'no text changing, no material distortion, no dish/garment/finished-work becoming a ' +
  'different object, no identity drift, no gradual transformation into a similar-but-different item.';

// Return the product-lock negative phrase that belongs in Layer 6 for a given
// product type. Business/craft flows want the BUSINESS_CRAFT_LOCK variant.
export function getProductLock(productName, isBusinessCraft = false) {
  if (!productName) return '';
  return isBusinessCraft ? BUSINESS_CRAFT_LOCK : PRODUCT_LOCK;
}

// Verify a set of scenes (already-built prompt objects) before handing off to
// the image pipeline. Returns { ok, violations[] }.
//
// A "scene" in this context looks like:
//   { sceneNumber, actorId, outfit?, productName?, isBusinessCraft?, prompt }
//
// Rules enforced:
//   1. All scenes share the same actorId.
//   2. Outfit either matches across all scenes OR the change is intentionally
//      flagged via scene.intentionalOutfitChange === true.
//   3. productName (or craft-lock flag) is consistent across all scenes that
//      include a product.
export function ensureConsistency(scenes) {
  const violations = [];
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { ok: true, violations };
  }

  const anchor = scenes[0];
  for (let i = 1; i < scenes.length; i++) {
    const s = scenes[i];

    if (s.actorId && anchor.actorId && s.actorId !== anchor.actorId) {
      violations.push({
        scene: s.sceneNumber ?? i + 1,
        rule: 'actor-continuity',
        detail: `actorId ${s.actorId} differs from anchor ${anchor.actorId}`
      });
    }

    if (
      s.outfit && anchor.outfit &&
      s.outfit !== anchor.outfit &&
      !s.intentionalOutfitChange
    ) {
      violations.push({
        scene: s.sceneNumber ?? i + 1,
        rule: 'outfit-continuity',
        detail: `outfit "${s.outfit}" differs from anchor "${anchor.outfit}"; set intentionalOutfitChange: true to silence`
      });
    }

    if (
      s.productName && anchor.productName &&
      s.productName !== anchor.productName
    ) {
      violations.push({
        scene: s.sceneNumber ?? i + 1,
        rule: 'product-continuity',
        detail: `productName "${s.productName}" differs from anchor "${anchor.productName}"`
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
