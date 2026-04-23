// Identity cards for the three avatars used across the UGC pipeline.
// Values were derived from /public/landing-assets/avatar-{daniel,noa,maya}.jpg.
// These cards feed Layer 1 (Character Lock) of the 6-layer prompt system and
// must be kept in sync with the reference images — if an avatar image changes,
// re-read the jpg and update the matching card.

export const ACTOR_CARDS = {
  daniel: {
    id: 'daniel',
    gender: 'male',
    face: {
      skinToneHex: '#E8C4A8',
      eyeColor: 'hazel-green',
      jawline: 'square, defined, with light stubble across jaw and chin',
      bonestructure: 'strong, angular, high cheekbones',
      distinguishingMarks: 'light sun-kissed freckles across nose and cheeks, subtle tan line'
    },
    hair: {
      color: 'dirty blonde, sun-lightened at the tips',
      style: 'medium length, tousled waves sitting above the brows',
      texture: 'slightly messy, natural volume, never styled flat'
    },
    body: {
      build: 'athletic, mid-20s, lean with broad shoulders',
      height: 'average (around 5\'10")'
    },
    outfits: [
      'plain white cotton t-shirt',
      'navy blue t-shirt',
      'light grey hoodie',
      'beige linen button-down, sleeves rolled'
    ],
    promptSpeed: 'casual, laid-back',
    voiceMatch: 'warm masculine'
  },

  noa: {
    id: 'noa',
    gender: 'female',
    face: {
      skinToneHex: '#D9B48A',
      eyeColor: 'deep brown, warm almond shape',
      jawline: 'soft oval, gently tapered chin',
      bonestructure: 'balanced oval, moderate cheekbones, full natural brows',
      distinguishingMarks: 'faint natural blush on cheeks, subtle cupid\'s-bow lips, no heavy makeup'
    },
    hair: {
      color: 'dark brunette, nearly black with subtle warm undertones',
      style: 'long, loose beachy waves falling past the shoulders, center part',
      texture: 'thick, glossy, slight frizz at the ends — not salon-perfect'
    },
    body: {
      build: 'slim, early-20s, feminine and natural',
      height: 'average (around 5\'6")'
    },
    outfits: [
      'plain black crewneck t-shirt with thin gold chain',
      'cream oversized knit sweater',
      'white ribbed tank top',
      'soft beige cardigan'
    ],
    promptSpeed: 'soft, grounded, relatable',
    voiceMatch: 'warm feminine, gentle alto'
  },

  maya: {
    id: 'maya',
    gender: 'female',
    face: {
      skinToneHex: '#D4A982',
      eyeColor: 'medium brown, round and expressive',
      jawline: 'softly heart-shaped, rounded chin',
      bonestructure: 'youthful, subtle cheekbones, naturally full brows',
      distinguishingMarks: 'visible freckles and beauty marks across nose and cheeks, natural skin texture including a faint acne mark or two, bright white teeth with an open genuine smile'
    },
    hair: {
      color: 'warm medium brown with chestnut highlights',
      style: 'shoulder-length wavy, natural center part, lived-in texture',
      texture: 'loose natural waves, slightly frizzy, authentically messy'
    },
    body: {
      build: 'athletic-slim, early-20s, wholesome energy',
      height: 'average (around 5\'7")'
    },
    outfits: [
      'plain black crewneck t-shirt with thin gold chain',
      'white cotton t-shirt',
      'olive green cropped tee',
      'soft denim jacket over plain tee'
    ],
    promptSpeed: 'upbeat, bubbly, bestie-energy',
    voiceMatch: 'bright feminine, playful mezzo'
  }
};

// Convenience lookup that tolerates missing / mis-cased ids and falls back to
// the default avatar so callers never crash on a bad input.
export function getActorCard(actorId, fallback = 'daniel') {
  if (!actorId) return ACTOR_CARDS[fallback];
  const key = String(actorId).toLowerCase().trim();
  return ACTOR_CARDS[key] || ACTOR_CARDS[fallback];
}
