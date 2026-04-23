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
  'no gradual transformation into a similar-but-different item.';

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
