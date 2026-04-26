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

// Generic hint for "held product" shots (beat 3). Appended whenever the
// shot type is held-product regardless of product name.
export const HELD_PRODUCT_INTEGRATION =
  'HELD PRODUCT INTEGRATION: fingertips press into the product showing real grip pressure. ' +
  'Product does NOT float in the hand — visible contact between palm, fingers, and product. ' +
  'Subtle shadow between the product and the palm. ' +
  'Skin around the grip shows slight tension where fingers curl around the product.';

// Default integration block used when no category keyword matches the
// product name. Generic enough to apply to any unknown product type.
export const DEFAULT_PRODUCT_INTEGRATION =
  'PRODUCT INTEGRATION: product physically integrated with the scene, ' +
  'not composited — natural contact shadows, surfaces touched, ' +
  'product reflects ambient scene lighting, NOT pasted-on, NOT a sticker, ' +
  'NOT floating, gravity-correct positioning.';

// Categorical product integration. Replaces the old per-product key map so
// the pipeline supports any product the studio is asked to make a video for.
// Each category lists Hebrew + English keywords; the first category whose
// keyword appears as a substring of the product name (lowercased) wins.
//
// Iteration order matters when keywords overlap (e.g. "בושם" appears in both
// `liquid` and `beauty`). Categories listed earlier take precedence.
export const PRODUCT_CATEGORIES = {
  headwear: {
    keywords_he: ['כיפה', 'כיפת', 'כובע', 'מטפחת', 'בנדנה', 'קסדה'],
    keywords_en: ['kippah', 'kipa', 'hat', 'cap', 'beanie', 'helmet', 'headband'],
    integration:
      'HEADWEAR INTEGRATION: product sits naturally on the head following the curvature of the skull, ' +
      'gravity-correct positioning, hair flows around and under the edges, slight indentation visible ' +
      'where it presses on hair, natural shadow on forehead and around hairline, fabric/material wraps ' +
      'the head shape realistically, NOT floating above hair, NOT photoshopped on top, NOT detached from scalp.'
  },

  held: {
    keywords_he: ['בקבוק', 'כוס', 'ספל', 'ספר', 'מקל', 'כלי'],
    keywords_en: ['bottle', 'cup', 'mug', 'book', 'stick', 'tool', 'phone'],
    integration:
      'HELD PRODUCT INTEGRATION: fingertips press into the product showing real grip pressure. ' +
      'Product does NOT float in the hand — visible contact between palm, fingers, and product. ' +
      'Subtle shadow between the product and the palm. ' +
      'Skin around the grip shows slight tension where fingers curl around the product.'
  },

  wornBody: {
    keywords_he: ['חולצה', 'מעיל', 'גופייה', 'שמלה', 'חצאית', 'מכנס', 'בגד'],
    keywords_en: ['shirt', 'jacket', 'tank', 'dress', 'skirt', 'pants', 'clothing', 'tee', 'hoodie'],
    integration:
      'WORN-BODY INTEGRATION: fabric follows the body contours naturally, drapes with gravity, ' +
      'shows realistic creases at elbows/waist/shoulders, fabric weave visible under direct light, ' +
      'neckline sits naturally on collarbones, no plastic-mannequin look, no perfect symmetry.'
  },

  wornFace: {
    keywords_he: ['משקפיים', 'משקפי', 'מסכה', 'עגיל', 'שרשרת'],
    keywords_en: ['glasses', 'sunglasses', 'mask', 'earring', 'necklace', 'piercing'],
    integration:
      'WORN-FACE INTEGRATION: product touches skin with realistic compression — bridge of nose for glasses, ' +
      'ear for earrings — slight skin indentation under contact points, natural shadow cast onto skin, ' +
      'item moves with head movement, NOT floating, NOT detached.'
  },

  appliedSkin: {
    keywords_he: ['קרם', 'סרום', 'משחה', 'ג׳ל', 'שמן', 'מסכת', 'הלבנת'],
    keywords_en: ['cream', 'serum', 'lotion', 'gel', 'oil', 'mask', 'whitening'],
    integration:
      'SKIN-APPLIED PRODUCT INTEGRATION: product visibly applied on skin with subtle sheen, ' +
      'partially absorbed look, glistening micro-droplets on the skin surface, natural skin texture ' +
      'still visible underneath, NOT a flat color overlay, NOT a digital paint effect.'
  },

  liquid: {
    keywords_he: ['בושם', 'שמפו', 'מרכך', 'משקה', 'מים'],
    keywords_en: ['perfume', 'shampoo', 'conditioner', 'drink', 'beverage', 'liquid'],
    integration:
      'LIQUID INTEGRATION: liquid shows correct viscosity, surface tension, light refraction through ' +
      'transparent containers, meniscus visible, surface moves naturally with handling, NOT solid-looking, ' +
      'NOT a flat texture, real glass/plastic clarity for the bottle.'
  },

  food: {
    keywords_he: ['אוכל', 'מזון', 'עוגה', 'לחם', 'פירות', 'ירקות', 'בשר'],
    keywords_en: ['food', 'cake', 'bread', 'fruit', 'vegetable', 'meat', 'snack'],
    integration:
      'FOOD INTEGRATION: natural food texture with realistic surface variation, steam if hot, ' +
      'condensation if cold, real organic imperfections — uneven crust, natural color variation, ' +
      'visible moisture or oil sheen where appropriate, NOT plastic-looking, NOT over-saturated.'
  },

  tech: {
    keywords_he: ['טלפון', 'אוזניות', 'שעון', 'מסך', 'מטען'],
    keywords_en: ['phone', 'headphones', 'earbuds', 'watch', 'screen', 'charger', 'tech'],
    integration:
      'TECH INTEGRATION: realistic screen glare and reflections, accurate ambient light reflected on ' +
      'glass surfaces, cable physics with natural drape and gravity, slight fingerprint smudges on ' +
      'glossy surfaces, NOT factory-perfect, used-look acceptable.'
  },

  beauty: {
    keywords_he: ['שפתון', 'איפור', 'מסקרה', 'בושם', 'לק'],
    keywords_en: ['lipstick', 'makeup', 'mascara', 'cosmetic', 'nail polish'],
    integration:
      'BEAUTY PRODUCT INTEGRATION: realistic application on skin/lips/nails, natural color blending ' +
      'with skin tone, slight texture (matte vs glossy), no over-saturation, looks recently applied not airbrushed.'
  }
};

// Smart category resolver. Returns the first category whose keyword (Hebrew
// or English) appears in the product name, or DEFAULT_PRODUCT_INTEGRATION if
// nothing matches. Also returns the matched category key for logging.
export function getProductIntegrationForName(productName) {
  if (!productName) return DEFAULT_PRODUCT_INTEGRATION;
  const lower = String(productName).toLowerCase();

  for (const [categoryKey, category] of Object.entries(PRODUCT_CATEGORIES)) {
    const allKeywords = [...category.keywords_he, ...category.keywords_en];
    for (const keyword of allKeywords) {
      if (lower.includes(keyword.toLowerCase())) {
        console.log(`[ProductIntegration] Matched category: ${categoryKey} (keyword: "${keyword}") for "${productName}"`);
        return category.integration;
      }
    }
  }

  console.log(`[ProductIntegration] No category match for "${productName}", using default`);
  return DEFAULT_PRODUCT_INTEGRATION;
}

// Same as getProductIntegrationForName but also returns the matched category
// key. Useful for logs and tests; the runtime path only needs the integration
// string.
export function resolveProductCategory(productName) {
  if (!productName) return { key: 'default', integration: DEFAULT_PRODUCT_INTEGRATION };
  const lower = String(productName).toLowerCase();
  for (const [categoryKey, category] of Object.entries(PRODUCT_CATEGORIES)) {
    const allKeywords = [...category.keywords_he, ...category.keywords_en];
    for (const keyword of allKeywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return { key: categoryKey, keyword, integration: category.integration };
      }
    }
  }
  return { key: 'default', integration: DEFAULT_PRODUCT_INTEGRATION };
}

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
