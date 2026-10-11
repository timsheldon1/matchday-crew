// Grounding check: every number an agent writes must come from the evidence it was given.
// This is how the crew catches invented stats before they reach the screen.

const FULLWIDTH = /[０-９．]/g;
const toAscii = (s) => s.replace(FULLWIDTH, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));

function collectNumbers(value, out) {
  if (value == null) return out;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
  } else if (typeof value === 'string') {
    for (const m of toAscii(value).matchAll(/\d+(?:\.\d+)?/g)) out.add(Number(m[0]));
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
  return out;
}

// Numbers that are always fine: small counts, match length, halves.
const ALWAYS_OK = new Set([0, 1, 2, 3, 45, 90]);

export function allowedNumbers(evidence) {
  const raw = collectNumbers(evidence, new Set());
  const ok = new Set(ALWAYS_OK);
  for (const n of raw) {
    ok.add(n);
    ok.add(Math.round(n));
    ok.add(Math.round(n * 10) / 10);
    ok.add(Math.floor(n));
    if (n > 0 && n < 1) {
      ok.add(Math.round(n * 100)); // 0.34 xG -> 34%
      ok.add(Math.round(n * 1000) / 10);
    }
  }
  return ok;
}

export function numbersIn(text) {
  return [...toAscii(String(text)).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}

// Returns the list of numbers in `texts` that are not supported by the evidence.
export function ungroundedNumbers(texts, evidence) {
  const ok = allowedNumbers(evidence);
  const bad = [];
  for (const t of [].concat(texts)) {
    for (const n of numbersIn(t)) {
      if (!ok.has(n) && !ok.has(Math.round(n)) && !ok.has(Math.round(n * 10) / 10)) bad.push(n);
    }
  }
  return [...new Set(bad)];
}
