// Smart POS menu search — Google-style ranking, fully client-side.
// Per keystroke: alias expansion → per-word scoring (exact > prefix > sound-alike > typo >
// in-order letters > substring) → one dish word per query term, plus initials / no-space
// segmentation ("vs momo", "vegsmomo" → Veg Soup Momo) → rank by match quality, name
// coverage, shortness, 30-day sales (product.sold_30d) and this terminal's past picks.

// Counter shorthand → menu words. Alias hits score a little below a typed word.
const ALIASES = {
  c: ['chilli'], chk: ['chicken'], chkn: ['chicken'], ckn: ['chicken'], chik: ['chicken'],
  buff: ['buffalo'], buf: ['buffalo'], pnr: ['paneer'], panir: ['paneer'], mush: ['mushroom'],
  coke: ['coca cola'], cap: ['cappuccino'], capp: ['cappuccino'],
  bt: ['black tea'], mt: ['milk tea'], bc: ['black coffee'], mc: ['milk coffee'], ff: ['french fries'],
  fr: ['fried'], fry: ['fried'], frd: ['fried'], jhol: ['soup'], soup: ['jhol'],
  chiya: ['tea'], chai: ['tea'], pani: ['water'], icecream: ['ice cream'], milkshake: ['milk shake'],
  sp: ['special'], spl: ['special'], dbl: ['double'], sgl: ['single'],
  lg: ['large'], sm: ['small'], md: ['medium'], reg: ['regular'], hf: ['half'], ful: ['full'],
};

const WEIGHT = { name: 1, variant: 0.85, category: 0.6, tag: 0.45, id: 0.9 };
const ALIAS_FACTOR = 0.88;
const PICKS_KEY = 'pos_search_picks';

export const normalize = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
const split = (v) => normalize(v).split(' ').filter(Boolean);

/* Cheap phonetic key — chilly/chilli → "chil", cofee/coffee → "kof". */
export function soundKey(w) {
  let s = w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/c(?!h)/g, 'k').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/([kgtd])h/g, '$1').replace(/y/g, 'i')
    .replace(/ee|ea|ie/g, 'i').replace(/oo|ou/g, 'u')
    .replace(/(.)\1+/g, '$1');
  if (s.length > 3) s = s.replace(/[aeiou]$/, '');
  return s;
}

/* Levenshtein with early exit once the distance exceeds max. */
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowBest) rowBest = v;
    }
    if (rowBest > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const isSubseq = (q, w) => { let i = 0; for (const ch of w) if (ch === q[i]) i++; return i === q.length; };

/* One query term vs one dish word → { score 0–100, len: highlighted chars }. */
function wordScore(q, qs, w, ws) {
  if (q === w) return { score: 100, len: w.length };
  if (w.startsWith(q)) return { score: q.length === 1 ? 50 : q.length === 2 ? 70 : 82, len: q.length };
  if (q.length < 3) return { score: 0 };
  if (qs === ws) return { score: 68, len: w.length };
  if (qs.length >= 3 && ws.startsWith(qs)) return { score: 62, len: w.length };
  const allow = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  if (allow) {
    if (lev(q, w, allow) <= allow) return { score: 58, len: w.length };
    if (w.length > q.length && lev(q, w.slice(0, q.length), allow) <= allow) return { score: 52, len: q.length };
  }
  if (q[0] === w[0] && isSubseq(q, w)) return { score: 46, len: w.length };
  if (w.includes(q)) return { score: 34, len: w.length };
  return { score: 0 };
}

/* A no-space term split into ordered word starts: "vs" → Veg+Soup, "vegsmomo" → Veg+Soup+Momo. */
function segment(t, nameWords) {
  if (t.length < 2 || nameWords.length < 2 || !nameWords.some(o => o.w[0] === t[0])) return null;
  let best = null, calls = 0;
  const go = (pos, i, pieces, skips) => {
    if (++calls > 3000) return;
    if (pos === t.length) {
      if (pieces.length < 2) return;
      const full = pieces.filter(p => p.L === nameWords[p.i].w.length).length;
      const score = Math.min(80, 62 + 4 * full - 5 * skips);
      if (!best || score > best.score) best = { score, pieces: [...pieces] };
      return;
    }
    if (i >= nameWords.length) return;
    const w = nameWords[i].w;
    for (let L = Math.min(w.length, t.length - pos); L >= 1; L--) {
      if (t.startsWith(w.slice(0, L), pos)) go(pos + L, i + 1, [...pieces, { i, L }], skips);
    }
    go(pos, i + 1, pieces, skips + 1);
  };
  go(0, 0, [], 0);
  return best;
}

function makeEntry(p, pop) {
  const words = [];
  const name = String(p.name ?? '');
  for (const m of name.matchAll(/[A-Za-z0-9\u0900-\u097f]+/g)) {
    const w = m[0].toLowerCase();
    words.push({ w, s: soundKey(w), weight: WEIGHT.name, start: m.index });
  }
  const nameLen = words.length;
  const add = (text, weight) => { for (const w of split(text)) words.push({ w, s: soundKey(w), weight, start: -1 }); };
  add(String(p.variant_names ?? '').replace(/\|/g, ' '), WEIGHT.variant);
  add(p.category_name, WEIGHT.category);
  add(`${p.station_name ?? ''} ${p.badge ?? ''}`, WEIGHT.tag);
  add(p.id, WEIGHT.id);
  return { p, words, nameWords: words.slice(0, nameLen), nameLen, squash: words.slice(0, nameLen).map(o => o.w).join(''), pop };
}

const tok = (t, f = 1) => ({ t, s: soundKey(t), f });

/* Every alias spelling of a term group, capped so a long query stays instant. */
function expand(terms) {
  let variants = [[]];
  for (const t of terms) {
    const alts = [[tok(t)], ...(ALIASES[t] ?? []).map(ph => split(ph).map(x => tok(x, ALIAS_FACTOR)))];
    variants = variants.flatMap(v => alts.map(a => [...v, ...a])).slice(0, 12);
  }
  return variants;
}

function matchTokens(tokens, e) {
  const cands = tokens.map(k => {
    const list = [];
    e.words.forEach((o, wi) => {
      const r = wordScore(k.t, k.s, o.w, o.s);
      if (r.score) list.push({ score: r.score * o.weight * k.f, idxs: [wi], hl: o.start >= 0 ? [[o.start, o.start + r.len]] : [] });
    });
    const sg = segment(k.t, e.nameWords);
    if (sg) list.push({
      score: sg.score * k.f,
      idxs: sg.pieces.map(p => p.i),
      hl: sg.pieces.map(p => [e.nameWords[p.i].start, e.nameWords[p.i].start + p.L]),
    });
    return list.sort((a, b) => b.score - a.score);
  });
  if (cands.some(l => !l.length)) return null;

  // Scarcest term picks first, each claims an unused dish word ("chi chi momo" → Chicken, Chilli, Momo)
  const order = tokens.map((_, i) => i).sort((a, b) => cands[a].length - cands[b].length || cands[b][0].score - cands[a][0].score);
  const used = new Set(), firstNameHit = new Array(tokens.length).fill(-1), hl = [];
  let total = 0;
  for (const ti of order) {
    let pick = cands[ti].find(c => c.idxs.every(i => !used.has(i)));
    let score = pick?.score;
    if (!pick) { pick = cands[ti][0]; score = pick.score * 0.5; }
    pick.idxs.forEach(i => used.add(i));
    total += score;
    hl.push(...pick.hl);
    const nameIdx = pick.idxs.filter(i => i < e.nameLen);
    if (nameIdx.length) firstNameHit[ti] = Math.min(...nameIdx);
  }
  const quality = total / tokens.length;
  if (quality < 20) return null;

  const hits = firstNameHit.filter(i => i >= 0);
  const covered = [...used].filter(i => i < e.nameLen).length;
  let score = quality;
  if (used.has(0)) score += 8;
  if (hits.length > 1 && hits.every((v, i) => !i || v >= hits[i - 1])) score += 6;
  score += (covered / Math.max(1, e.nameLen)) * 14;
  score -= Math.max(0, e.nameLen - covered) * 1.2;
  return { score, hl };
}

function bestMatch(e, variantsByGroup) {
  let best = null;
  for (const { variants, squash } of variantsByGroup) {
    for (const v of variants) {
      const r = matchTokens(v, e);
      if (r && (!best || r.score > best.score)) best = r;
    }
    if (!best && squash.length >= 4 && e.squash.includes(squash)) best = { score: 40, hl: [] };
  }
  return best;
}

function compile(query) {
  return String(query).split(',').map(split).filter(g => g.length).map(g => ({ variants: expand(g), squash: g.join('') }));
}

/* ── Picks memory (per terminal) — what was chosen for a query gets lifted next time ── */
function readPicks() {
  try { return JSON.parse(localStorage.getItem(PICKS_KEY)) || {}; } catch { return {}; }
}
export function recordPick(query, productId) {
  const k = normalize(query);
  if (!k || productId == null) return;
  const all = readPicks();
  const row = all[k] || {};
  row[productId] = (row[productId] || 0) + 1;
  delete all[k];
  all[k] = row;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete all[old];
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(all)); } catch { /* storage full */ }
}
function pickBoosts(query) {
  const k = normalize(query), all = readPicks(), boost = {};
  for (const [q, row] of Object.entries(all)) {
    const factor = q === k ? 1 : q.startsWith(k) ? 0.5 : 0;
    if (!factor) continue;
    for (const [id, n] of Object.entries(row)) boost[id] = Math.max(boost[id] || 0, Math.min(30, 12 + n * 6) * factor);
  }
  return boost;
}

/* ── Public API ── */
export function buildSearchIndex(products) {
  const maxSold = Math.max(0, ...products.map(p => Number(p.sold_30d) || 0));
  const scale = Math.log1p(maxSold) || 1;
  return products.map(p => makeEntry(p, Math.log1p(Number(p.sold_30d) || 0) / scale));
}

/** Ranked results [{ product, score, hl: [[start,end],…] on product.name }] or null for an empty query. */
export function smartSearch(index, query) {
  const groups = compile(query);
  if (!groups.length) return null;
  const boost = pickBoosts(query);
  const out = [];
  for (const e of index) {
    const m = bestMatch(e, groups);
    if (m) out.push({ product: e.p, hl: m.hl, score: m.score + e.pop * 14 + (boost[e.p.id] || 0) });
  }
  return out.sort((a, b) => b.score - a.score || (Number(b.product.sold_30d) || 0) - (Number(a.product.sold_30d) || 0) || String(a.product.name).localeCompare(String(b.product.name)));
}

/** Same matcher on free text (cake list: order no / customer / phone). */
export function matchText(text, query) {
  const groups = compile(query);
  return !groups.length || !!bestMatch(makeEntry({ name: text }, 0), groups);
}
