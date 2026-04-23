// Seven shot types that cover the full UGC ad arc (pain → product → demo →
// aspirational). Each type pairs with a camera profile from camera-profiles.js
// and maps to the storytelling beat it was designed for.

export const SHOT_TYPES = {
  'selfie-close': {
    description: 'face fills frame, iPhone selfie up close',
    camera: 'selfieFront',
    ideal_for: 'emotional scenes (Beat 1 pain)'
  },

  'selfie-medium': {
    description: 'head to shoulders, standard selfie framing',
    camera: 'selfieFront',
    ideal_for: 'introducing product (Beat 2)'
  },

  'product-closeup': {
    description: 'product fills frame, avatar hand may be visible at edge',
    camera: 'rearCamera',
    ideal_for: 'product-only scene 2'
  },

  'held-product': {
    description: 'avatar holding the product, both subject and product clearly visible',
    camera: 'rearCamera',
    ideal_for: 'demonstrating product (Beat 3)'
  },

  'aspirational-selfie': {
    description: 'iPhone selfie in a lifestyle / aspirational context',
    camera: 'selfieFront',
    ideal_for: 'Beat 4 contextual result'
  },

  'mirror-selfie': {
    description: 'full-body mirror selfie, phone visible in hand',
    camera: 'mirrorSelfie',
    ideal_for: 'fashion / outfit showcase'
  },

  'overhead-flatlay': {
    description: 'product laid out on a surface, captured from directly above',
    camera: 'overheadFlatlay',
    ideal_for: 'cosmetic / product array shots'
  }
};

// Storytelling beat (1-4) → shot type. Beat 2 is special: it's a product-only
// composition, but callers can override via productOnly=false.
const BEAT_TO_SHOT = {
  1: 'selfie-close',
  2: 'product-closeup',
  3: 'held-product',
  4: 'aspirational-selfie'
};

export function getShotTypeForBeat(beat, opts = {}) {
  if (opts.productOnly && beat === 2) return 'product-closeup';
  if (opts.mirror) return 'mirror-selfie';
  if (opts.flatlay) return 'overhead-flatlay';
  return BEAT_TO_SHOT[beat] || 'selfie-medium';
}

export function getShotType(key) {
  return SHOT_TYPES[key] || SHOT_TYPES['selfie-medium'];
}
