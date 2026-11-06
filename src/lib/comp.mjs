// Best-effort compensation extraction from free-text job descriptions.
// Structured salary fields (Lever's salaryRange, Ashby's compensation object)
// are preferred by the normalizers; this is the fallback for prose.

const CURRENCY_MAP = {
  usd: 'USD', 'us$': 'USD', $: 'USD',
  cad: 'CAD', 'c$': 'CAD',
  eur: 'EUR', '€': 'EUR',
  gbp: 'GBP', '£': 'GBP',
};

// "$150,000 - $180,000", "USD 150000 to 180000", "£45,000-£55,000", "$85/hr"
const WITH_CURRENCY = /(?<cur>USD|CAD|EUR|GBP|US\$|C\$|\$|€|£)\s*(?<a1>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?<k1>[kK])?(?:\s*(?:-|–|—|to|and)\s*(?:USD|CAD|EUR|GBP|US\$|C\$|\$|€|£)?\s*(?<a2>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?<k2>[kK])?)?/g;

// "150k-180k", "150K to 180K" (no currency symbol; assume USD)
const BARE_K_RANGE = /(?<a1>\d{2,3})\s*[kK]\s*(?:-|–|—|to)\s*(?<a2>\d{2,3})\s*[kK]/g;

function toNumber(raw, k) {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return k ? n * 1000 : n;
}

function detectInterval(text, index) {
  const window = text.slice(Math.max(0, index - 80), index + 100).toLowerCase();
  if (/(per\s+hour|hourly|\/\s*hour|\/\s*hr|\bhr\b|an hour)/.test(window)) return 'hourly';
  if (/(per\s+year|annual|annually|\/\s*year|\/\s*yr|a year|per annum)/.test(window)) return 'yearly';
  return null;
}

function plausible({ min, max, interval }) {
  const top = max ?? min;
  if (top == null || min == null) return false;
  if (interval === 'hourly') return min >= 10 && top <= 2000;
  // Yearly (or unknown treated as yearly): filter out "$500 bonus" style noise.
  return min >= 20000 && top <= 2_000_000;
}

export function annualize(comp) {
  if (!comp) return null;
  const factor = comp.interval === 'hourly' ? 2080 : 1;
  return {
    min: comp.min != null ? comp.min * factor : null,
    max: comp.max != null ? comp.max * factor : null,
  };
}

function matchComp(m, bare, text) {
  const g = m.groups;
  let min = toNumber(g.a1, bare ? 'k' : g.k1);
  let max = toNumber(g.a2, bare ? 'k' : g.k2);
  if (min == null) return null;
  if (max != null && g.k2 && !g.k1 && !bare && min < 1000) min *= 1000;
  if (max != null && max < min) [min, max] = [max, min];
  const candidate = { min, max: max ?? null,
    currency: CURRENCY_MAP[(g.cur ?? '$').toLowerCase()] ?? 'USD',
    interval: detectInterval(text, m.index ?? 0) ?? 'yearly' };
  return plausible(candidate) ? candidate : null;
}

export function extractComp(text) {
  if (!text) return null;
  const str = String(text);

  for (const re of [WITH_CURRENCY, BARE_K_RANGE]) {
    re.lastIndex = 0;
    for (const m of str.matchAll(re)) {
      const candidate = matchComp(m, re === BARE_K_RANGE, str);
      if (candidate) return candidate;
    }
  }
  return null;
}
