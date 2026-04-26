// Smoke test for the universal product integration skill. Verifies that
// buildKlingPrompt stays under the Kling v3 pro 2500-char limit across a
// variety of product names — including products whose names would never
// have matched a per-category keyword.
//
// Run: node scripts/smoke-universal-integration.mjs

import { buildKlingPrompt, UNIVERSAL_PRODUCT_INTEGRATION } from '../lib/ugc-skills/index.js';

const tests = [
  'אבקה מלבינה של פלאו',
  'כיפת האש שלי',
  'משקפי שמש קלאסיים',
  'בקבוק בושם דובאי',
  'מוצר משונה ולא מוכר 12345'
];

let failed = 0;
for (const productName of tests) {
  const result = buildKlingPrompt(
    'Avatar interacts with the product, natural casual moment.',
    3,
    productName
  );
  const ok = result.length <= 2500;
  const status = ok ? '✓' : '✗';
  if (!ok) failed++;
  console.log(`${status} "${productName}": ${result.length} chars`);
}

console.log(`\nUNIVERSAL_PRODUCT_INTEGRATION length: ${UNIVERSAL_PRODUCT_INTEGRATION.length} chars`);
console.log(failed === 0 ? '\n✓ all smoke tests passed' : `\n✗ ${failed} smoke test(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
