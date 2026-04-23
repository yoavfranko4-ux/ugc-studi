// Ten discrete "realism anchors" — short phrases that push the image generator
// away from the airbrushed / magazine look and toward authentic phone footage.
// Never use all ten at once (stacking everything flattens the signal). The
// selectAnchors() helper returns only the 3-4 that matter for a given shot.

export const REALISM_ANCHORS = {
  skinPores: 'natural skin pores visible on nose and cheeks',
  strayHairs: 'a few stray hairs out of place, baby hairs catching the light',
  underEyeTexture: 'natural under-eye texture, slight shadows and micro-creases',
  unevenSkinTone: 'subtle skin tone variation, tiny blemishes left un-retouched',
  fabricTexture: 'visible fabric weave and texture, gentle creases and folds',
  environmentalNoise: 'slight background blur with real objects — clutter, not staged',
  lightingImperfection: 'mixed lighting sources creating subtle uneven shadows',
  cameraArtifacts: 'slight sensor noise in dark areas, not perfect, phone camera grain',
  nailDetail: 'hands show natural nails, slight imperfections, cuticles visible',
  jewelryPhysics: 'any jewelry hangs and reflects naturally, no floating metal'
};

// Shot-type → which anchors amplify realism without over-crowding the prompt.
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

// Convenience: resolve keys → phrases in one call.
export function getAnchorPhrases(shotType) {
  return selectAnchors(shotType).map(key => REALISM_ANCHORS[key]).filter(Boolean);
}
