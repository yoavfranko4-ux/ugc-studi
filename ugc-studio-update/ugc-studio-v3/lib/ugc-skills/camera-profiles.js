// iPhone camera profiles. Each profile drives Layer 4 of the prompt and is
// chosen by shot type (see shot-types.js). Descriptions here intentionally
// reinforce "phone-shot in real life" and discourage DSLR / studio aesthetics.

export const CAMERA_PROFILES = {
  selfieFront: {
    name: 'iPhone 15 Pro front camera selfie',
    description: 'handheld selfie, one arm visible at the frame edge, slight wide-angle distortion typical of a front camera, subject fills the center-upper frame',
    depth: 'background visible but not heavily blurred, shallow natural portrait-mode falloff only',
    angle: 'eye level or slightly above, subject looking directly at the lens'
  },

  rearCamera: {
    name: 'iPhone 15 Pro rear camera',
    description: 'held at arm\'s length to capture the product or scene, sharper focus and less distortion than the front camera',
    depth: 'natural depth of field, mild background softness',
    angle: 'varies by shot intent, typically slightly angled rather than dead-on'
  },

  mirrorSelfie: {
    name: 'iPhone held in front of a mirror',
    description: 'reflection visible, phone visible in one hand, slight mirror fog and faint fingerprint smudges on the glass',
    depth: 'mirror surface adds slight haze, background reflects the room behind the subject',
    angle: 'torso to face, iPhone held at chest or waist height in hand'
  },

  overheadFlatlay: {
    name: 'iPhone rear camera held above the surface',
    description: 'looking straight down at the product or scene, slight perspective distortion from hand-held overhead framing',
    depth: 'relatively flat, everything roughly in focus',
    angle: 'top-down, roughly 90 degrees to the surface, slight tilt tolerated'
  }
};

export function getCameraProfile(key) {
  return CAMERA_PROFILES[key] || CAMERA_PROFILES.selfieFront;
}
