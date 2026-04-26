// Realism anchors — short phrases that push the image generator away from the
// airbrushed / magazine look and toward authentic phone footage.
//
// Two tiers:
//   1. MANDATORY_HUMAN_ANCHORS — eight non-negotiable cues that fight the AI
//      vibe directly (asymmetric features, real skin, normal eyes, imperfect
//      teeth, real hands, directional light, iPhone lens signature, "not AI").
//      Every shot containing a person gets all eight.
//   2. SHOT_ANCHORS — the legacy 3-4-per-shot tuning kept for shot-specific
//      flavor (fabric weave for product shots, jewelry physics for mirror
//      selfies, etc.). Layered on top of the mandatory tier.

export const REALISM_ANCHORS = {
  // Original tier — shot-tuned flavor.
  skinPores: 'natural skin pores visible on nose and cheeks',
  strayHairs: 'a few stray hairs out of place, baby hairs catching the light',
  underEyeTexture: 'natural under-eye texture, slight shadows and micro-creases',
  unevenSkinTone: 'subtle skin tone variation, tiny blemishes left un-retouched',
  fabricTexture: 'visible fabric weave and texture, gentle creases and folds',
  environmentalNoise: 'slight background blur with real objects — clutter, not staged',
  lightingImperfection: 'mixed lighting sources creating subtle uneven shadows',
  cameraArtifacts: 'slight sensor noise in dark areas, not perfect, phone camera grain',
  nailDetail: 'hands show natural nails, slight imperfections, cuticles visible',
  jewelryPhysics: 'any jewelry hangs and reflects naturally, no floating metal',

  // Mandatory tier — the eight anchors that fight the AI vibe head-on.
  facialAsymmetry:
    'asymmetric facial features, slightly different eye sizes, natural face imperfections, ' +
    'one eyebrow slightly higher than the other, lips not perfectly symmetric',
  realSkinDetail:
    'real human skin with visible pores across cheeks forehead and nose, ' +
    'subtle uneven skin tone, faint blemishes, freckles, tiny imperfections left unretouched',
  realisticEyes:
    'natural eye color matching the actor reference (NOT vivid blue unless that is the reference), ' +
    'realistic iris detail with subtle veining, faint redness in eye corners, ' +
    'normal eye size proportional to face, eyelashes natural not extended',
  imperfectTeeth:
    'imperfect teeth alignment when smiling, natural tooth color not pure white, ' +
    'slight gum visibility, lips relaxed not pulled into a fake smile',
  correctHands:
    'exactly 5 fingers per hand, normal finger length and proportion, ' +
    'natural hand position, no extra digits, no fused fingers, no bent-back joints, knuckles visible',
  directionalLight:
    'uneven lighting with one side of face slightly shadowed, single light source from a window, ' +
    'soft shadow under jaw and under nose',
  iphoneLensSignature:
    'iPhone front camera 26mm wide-angle lens characteristic slight barrel distortion at frame edges, ' +
    'autofocus pulsing, flat unsaturated colors NO LUT NO color grading, ' +
    'soft micro-noise grain across the image like a real phone sensor in indoor light, ' +
    'slight motion blur on hair edges from natural hand wobble',
  notAI:
    'NOT a render, NOT 3D, NOT digital art, NOT CGI, NOT airbrushed, NOT smoothed, NOT beauty-filtered — ' +
    'looks like a candid unedited iPhone selfie taken right now in 2025 by a normal person'
};

// Mandatory anchors for any shot containing a person. Order matters: notAI is
// last so the trim helper (see prompt-layers) can keep it as the always-last
// item without special-casing.
export const MANDATORY_HUMAN_ANCHORS = [
  'facialAsymmetry',
  'realSkinDetail',
  'realisticEyes',
  'imperfectTeeth',
  'correctHands',
  'directionalLight',
  'iphoneLensSignature',
  'notAI'
];

// Mandatory anchors for product-only shots (no person). Only the two cues that
// apply without a human in frame: lens signature + "not AI".
export const MANDATORY_PRODUCT_ANCHORS = [
  'iphoneLensSignature',
  'notAI'
];

// Shot-type → which legacy anchors amplify realism without over-crowding the
// prompt. Layered on TOP of the mandatory tier.
const SHOT_ANCHORS = {
  'selfie-close': ['skinPores', 'strayHairs', 'underEyeTexture'],
  'selfie-medium': ['unevenSkinTone', 'fabricTexture', 'environmentalNoise'],
  'product-closeup': ['fabricTexture', 'lightingImperfection', 'cameraArtifacts'],
  'held-product': ['nailDetail', 'fabricTexture', 'lightingImperfection'],
  'aspirational-selfie': ['environmentalNoise', 'lightingImperfection', 'strayHairs'],
  'mirror-selfie': ['fabricTexture', 'lightingImperfection', 'jewelryPhysics', 'cameraArtifacts'],
  'overhead-flatlay': ['fabricTexture', 'lightingImperfection', 'cameraArtifacts']
};

export function selectAnchors(shotType) {
  const keys = SHOT_ANCHORS[shotType] || SHOT_ANCHORS['selfie-medium'];
  return keys;
}

export function getAnchorPhrases(shotType) {
  return selectAnchors(shotType).map(key => REALISM_ANCHORS[key]).filter(Boolean);
}

export function getMandatoryHumanPhrases() {
  return MANDATORY_HUMAN_ANCHORS.map(key => REALISM_ANCHORS[key]).filter(Boolean);
}

export function getMandatoryProductPhrases() {
  return MANDATORY_PRODUCT_ANCHORS.map(key => REALISM_ANCHORS[key]).filter(Boolean);
}
