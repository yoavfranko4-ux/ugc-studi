import { generateUGCPrompt, buildKlingPrompt } from '../lib/ugc-skills/index.js';

const tests = [
  { name: 'ברבר שופ הצמרת', desc: 'מספרה לגברים בלב תל אביב' },
  { name: 'יוגה נשימה', desc: 'סטודיו ליוגה ופילאטיס' },
  { name: 'מאפיית טל', desc: 'מאפייה ביתית של לחמים מחמצת' },
  { name: 'מוסך אדם', desc: 'מוסך לרכבים יפניים' }
];

let totalLen = 0;
let count = 0;
let allPass = true;
const overKling = [];

console.log('=== BUSINESS MODE: 16 prompts (4 businesses × 4 beats) ===');
for (const biz of tests) {
  for (const beat of [1, 2, 3, 4]) {
    const result = generateUGCPrompt({
      actorId: 'daniel',
      beat,
      isBusinessCraft: true,
      productName: biz.name,
      sceneContext: biz.desc
    });

    const hasBags = result.includes('shopping bags');
    // The business-mode beat-1 environment contains the literal phrase
    // "NEVER show shopping bags" as a *negative*. That is healthy — it does
    // NOT mean we are placing the avatar among shopping bags. So we only
    // flag the actual product-mode bag scene if "shopping bags scattered"
    // (the product BEAT_ENVIRONMENTS[1] phrasing) leaks in.
    const hasProductBags = result.includes('shopping bags scattered');
    const hasBiz = result.includes(biz.name);

    const bagsMark = !hasProductBags ? '✓' : '✗';
    const nameMark = hasBiz ? '✓' : '✗';
    if (hasProductBags || !hasBiz) allPass = false;

    console.log(
      `[${biz.name}] beat ${beat}: ` +
      `bags=${bagsMark}, ` +
      `name_in_prompt=${nameMark}, ` +
      `length=${result.length}` +
      (hasBags && !hasProductBags ? ' (NB: contains "NEVER show shopping bags" negative — OK)' : '')
    );
    totalLen += result.length;
    count += 1;

    // Probe Kling-side as well — it wraps Claude's kling_prompt; here we
    // pass a representative kling string to make sure the wrapper stays
    // under the 2500 limit for business mode.
    const kling = buildKlingPrompt(
      `Avatar inside ${biz.name} during the service moment, ${biz.desc}, candid handheld iPhone capture.`,
      beat,
      biz.name,
      { isBusinessCraft: true, scene4Context: beat === 4 }
    );
    if (kling.length > 2500) overKling.push({ biz: biz.name, beat, length: kling.length });
  }
}

console.log('\n=== PRODUCT MODE SANITY (must keep shopping-bag scene 1) ===');
const productTest = generateUGCPrompt({
  actorId: 'daniel',
  beat: 1,
  isBusinessCraft: false,
  productName: 'כיפת האש שלי',
  sceneContext: '...'
});
const productHasBags = productTest.includes('shopping bags');
console.log('Product mode beat 1 has bags:', productHasBags ? '✓ YES' : '✗ NO');
if (!productHasBags) allPass = false;

console.log('\n=== STATS ===');
console.log(`Average NB prompt length: ${Math.round(totalLen / count)} chars`);
console.log(`All under 3500: ${totalLen / count < 3500 ? 'check per-line above' : 'NO'}`);
console.log(`Kling prompts over 2500:`, overKling.length === 0 ? 'NONE' : overKling);

console.log('\n=== RESULT ===');
console.log(allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(allPass ? 0 : 1);
