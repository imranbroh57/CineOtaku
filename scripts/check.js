// Repo hygiene check: run `node scripts/check.js`. Fails on Netlify leftovers, secrets, ads or payment code.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const skip = new Set(['node_modules', '.git', '.vercel', 'tests', 'scripts']);
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { if (skip.has(f)) continue; const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(root);
const rules = [
  [/netlify/i, 'Netlify reference'],
  [/service_role\s*[:=]\s*['"][\w.-]{20,}/i, 'service_role key literal'],
  [/eyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}/, 'hard-coded JWT'],
  [/adsbygoogle|googlesyndication|doubleclick|adsterra|popunder|propeller/i, 'ad SDK'],
  [/stripe|paypal|razorpay|paddle|checkout\.session|subscription_plan|premium_user|is_vip|\bvip\b/i, 'payment/premium code'],
];
let bad = 0;
for (const f of files) {
  if (!/\.(js|html|css|json|sql|toml|example)$/.test(f) && !f.endsWith('.env.example')) continue;
  const txt = fs.readFileSync(f, 'utf8');
  for (const [re, label] of rules) {
    if (f.endsWith('schema.sql') && label === 'payment/premium code') { /* comments only mention absence */ }
    const m = txt.match(re);
    if (m && !(f.endsWith('schema.sql') && label.startsWith('payment')) && !f.endsWith('.env.example') && !f.endsWith('check.js')) { bad++; console.log(`${label}: ${path.relative(root, f)} -> ${m[0]}`); }
  }
}
console.log(bad ? `${bad} problem(s)` : 'check passed'); process.exit(bad ? 1 : 0);
