// tools/build-wordlists.mjs
// Creates two files in /public/wordlists:
//  - english-5.json  → validation dictionary (allowed guesses)
//  - answers-5.json  → smaller, common subset (secret answers)
// Run: npm run build:wordlists

import fs from 'node:fs';
import path from 'node:path';
import wordlist from 'wordlist-english';

const outDir = path.resolve('public/wordlists');
fs.mkdirSync(outDir, { recursive: true });

// Choose frequency tiers (SCOWL-derived):
// lower number = more common; higher = rarer.
// Validation: broader, but not absurd.
const VALID_TIERS = ['english/10','english/20','english/35','english/40','english/50','english/60'];
// Answers: only the more common tiers (feels fair & fun).
const ANSWER_TIERS = ['english/10','english/20','english/35'];

const onlyLetters = w => /^[a-zA-Z]{5}$/.test(w);
const toLower = w => w.toLowerCase();

function makeSetFromTiers(tiers) {
  const set = new Set();
  for (const t of tiers) {
    const arr = wordlist[t] || [];
    for (const w of arr) if (onlyLetters(w)) set.add(toLower(w));
  }
  return set;
}

// Optional: light profanity filter (add to taste)
const BLOCK = new Set([
  // 'slur1','slur2'  <- keep this list private or empty; customize for your project
]);

function filterBlock(list) {
  return list.filter(w => !BLOCK.has(w));
}

const validSet = makeSetFromTiers(VALID_TIERS);
const answersSet = makeSetFromTiers(ANSWER_TIERS);

// Keep answers ⊆ validation to avoid “Not in word list” on solutions
const answers = filterBlock([...answersSet].filter(w => validSet.has(w))).sort();
const english5 = filterBlock([...validSet]).sort();

// (Optional) Nudge out very obscure UK/US hyphen/variant issues — we already restricted to 5 letters a-z.

fs.writeFileSync(path.join(outDir, 'english-5.json'), JSON.stringify(english5));
fs.writeFileSync(path.join(outDir, 'answers-5.json'), JSON.stringify(answers));

console.log(`Wrote:
- ${english5.length} validation words → public/wordlists/english-5.json
- ${answers.length} answer words     → public/wordlists/answers-5.json`);
