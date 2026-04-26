// Regression check — verifies the categorical product-integration system
// resolves the right category and keeps the assembled NB prompt under 3500
// chars for a variety of product types. Re-run after any tweak to
// lib/ugc-skills/* or lib/agent-pipeline.js.
//
// Run: node scripts/dump-example-prompts.mjs

import { generateUGCPrompt, resolveProductCategory } from '../lib/ugc-skills/index.js';
import { getMandatoryProductPhrases } from '../lib/ugc-skills/realism-anchors.js';
import { mapAvatarToActorInfo } from '../lib/agent-pipeline.js';

function divider(label) {
  return '\n' + '='.repeat(72) + '\n' + label + '\n' + '='.repeat(72) + '\n';
}

let failed = 0;
function check(label, prompt, max = 3500) {
  const ok = prompt.length <= max;
  console.log(`\n${label} length:`, prompt.length, 'chars', ok ? `✓ under ${max}` : `✗ OVER ${max}`);
  if (!ok) {
    failed++;
    process.exitCode = 1;
  }
}

// avatar-4 = "Yoav" → daniel card, isFallbackActor=true (used for all 3 below
// so the prompt structure is consistent across products).
const avatarUrl = '/avatars/avatar-4.jpg';
const info = mapAvatarToActorInfo(avatarUrl);
console.log('mapAvatarToActorInfo(', avatarUrl, ') =>', info);

const PRODUCTS = [
  {
    name: 'כיפת האש שלי',
    expectedCategory: 'headwear',
    sceneCtx1: 'Yoav sits on his bed surrounded by Israeli shopping bags, looking into his phone with a tired honest expression.',
    sceneCtx3: 'Yoav holds the pink kippah in one hand at chest height, looking at it with curious approval, about to put it on.'
  },
  {
    name: 'קרם להלבנת שיניים',
    expectedCategory: 'appliedSkin',
    sceneCtx1: 'Yoav frowns at his phone in the bathroom, frustrated by yellow stains on his teeth before a date tonight.',
    sceneCtx3: 'Yoav holds the teeth-whitening cream tube in one hand, examining the label with mild curiosity in his bathroom mirror.'
  },
  {
    name: 'בושם פרחוני',
    expectedCategory: 'liquid',
    sceneCtx1: 'Yoav sits at his desk looking unimpressed at his current cologne bottle — about to vent about the weak scent.',
    sceneCtx3: 'Yoav holds the floral perfume bottle in one hand at chest height, lifting the cap with the other to test the fragrance.'
  }
];

for (const p of PRODUCTS) {
  const cat = resolveProductCategory(p.name);
  console.log(divider(`PRODUCT "${p.name}" — expected: ${p.expectedCategory} | resolved: ${cat.key} ${cat.keyword ? `(matched "${cat.keyword}")` : ''}`));
  if (cat.key !== p.expectedCategory) {
    console.log(`✗ CATEGORY MISMATCH: expected ${p.expectedCategory}, got ${cat.key}`);
    failed++;
    process.exitCode = 1;
  } else {
    console.log(`✓ category match`);
  }

  // Scene 1 — pain, selfie-close (no integration block in beat 1).
  const scene1 = generateUGCPrompt({
    actorId: info.actorId,
    isFallbackActor: info.isFallbackActor,
    productName: p.name,
    beat: 1,
    sceneContext: p.sceneCtx1
  });
  check(`  scene1 (${p.name})`, scene1);

  // Scene 3 — held-product (integration blocks fire here).
  const scene3 = generateUGCPrompt({
    actorId: info.actorId,
    isFallbackActor: info.isFallbackActor,
    productName: p.name,
    beat: 3,
    sceneContext: p.sceneCtx3
  });
  check(`  scene3 (${p.name})`, scene3);
}

// Scene 2 — productOnly, separate path. Use the kippah variant so its length
// is comparable to prior runs.
const productOnlyRule = 'PRODUCT ONLY SHOT — absolutely no person, no human, no hands holding the product, no face, no body parts, no avatar, no model. The frame contains ONLY the product resting on a surface. Pure product photography, studio-style, no humans in frame whatsoever.';
const productNegatives = 'Negative (STRICT): person, human, woman, man, hands, face, body, avatar, model, people, arms, fingers, holding, selfie, skin, hair, limbs, silhouette.';
const productRealism = 'shot on iPhone back camera in a real home setting, natural daylight through a nearby window plus ambient room light, slight handheld angle rather than dead-on tripod, subtle lens softness at corners, flat washed-out color grading, low saturation, uncolor-graded, realistic surface with tiny imperfections — faint dust, small fingerprint smudge, organic wood grain or authentic marble veining, mild warm white balance, no studio softbox, no seamless white backdrop, no perfectly clean catalog look, product firmly grounded on the surface with a visible contact shadow, product is NOT floating, NOT levitating, NOT suspended, NOT hovering, edges of the product render cleanly without melted geometry';
const mandatoryProduct = getMandatoryProductPhrases().join('; ');
const sceneContext2 = 'pink "כיפת האש שלי" kippah resting on a wooden nightstand in a sunlit bedroom, soft daylight from a nearby window, casual lived-in surface with a hint of grain';
const scene2 = `${productOnlyRule} ${sceneContext2}, realistic product photography, product clearly resting on a physical surface with contact shadow, ${productRealism}, REALISM ANCHORS — MANDATORY: ${mandatoryProduct}. photorealistic, looks like a real phone photo not a render, no burned-in subtitles or captions or on-screen text or graphic overlays. ${productNegatives}`;
console.log(divider('SCENE 2 — productOnly (kippah)'));
check('  scene2', scene2);

// Print the actual scene-3 prompt for the first product so a reviewer can
// eyeball the assembled output.
console.log(divider(`SCENE 3 FULL DUMP — "${PRODUCTS[0].name}" (avatar-4 / Yoav, beat 3)`));
console.log(generateUGCPrompt({
  actorId: info.actorId,
  isFallbackActor: info.isFallbackActor,
  productName: PRODUCTS[0].name,
  beat: 3,
  sceneContext: PRODUCTS[0].sceneCtx3
}));

console.log('\n' + (failed === 0 ? '✓ all checks passed' : `✗ ${failed} check(s) failed`));
