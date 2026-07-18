'use strict';
// Ranked customer search — phone/email auto-detection, then a weighted
// name/address/notes match (exact phrase > exact word > prefix > substring >
// Levenshtein <=2 > Double Metaphone). Fuzzy scoring only ever runs on the
// bounded candidate set pulled back by SQL, never the whole table.
// Two entry points share this engine: searchCustomers (capped top-N, for the
// live picker dropdown) and searchCustomersPaged (full sorted set + total, for
// the CRM admin grid's paginated table).
const levenshtein = require('fast-levenshtein');
const natural = require('natural');
const Fuse = require('fuse.js');
const { dbAll } = require('../database/db');

const doubleMetaphone = new natural.DoubleMetaphone();

const WEIGHT = { PHRASE: 1000, WORD: 250, PREFIX: 180, SUBSTRING: 120, LEV: 80, METAPHONE: 50 };
const HIGH_CONFIDENCE = WEIGHT.WORD; // score at/above this → safe to auto-select a lone result
const CANDIDATE_CAP = 500;

function normalize(str) {
  return String(str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function tokenize(str) {
  return normalize(str).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function detectQueryType(raw) {
  const q = String(raw || '').trim();
  if (q.includes('@')) return 'EMAIL';
  const digits = q.replace(/[\s()+-]/g, '');
  if (digits.length >= 4 && /^\d+$/.test(digits)) return 'PHONE';
  return 'TEXT';
}

async function searchPhone(digits, { limit, status = 'active' }) {
  let rows = await dbAll(
    `SELECT * FROM customers WHERE (phone LIKE CONCAT(?,'%') OR phone2 LIKE CONCAT(?,'%')) AND (? = 'all' OR status = ?) LIMIT ?`,
    [digits, digits, status, status, limit]
  );
  if (!rows.length) {
    rows = await dbAll(
      `SELECT * FROM customers WHERE (phone LIKE CONCAT('%',?,'%') OR phone2 LIKE CONCAT('%',?,'%')) AND (? = 'all' OR status = ?) LIMIT ?`,
      [digits, digits, status, status, limit]
    );
  }
  return rows.map(r => {
    const exact = r.phone === digits || r.phone2 === digits;
    const prefix = !exact && (String(r.phone).startsWith(digits) || String(r.phone2 || '').startsWith(digits));
    return { ...r, score: exact ? 1000 : prefix ? 500 : 200 };
  }).sort((a, b) => b.score - a.score);
}

async function searchEmail(emailQ, { limit, status = 'active' }) {
  const q = emailQ.toLowerCase();
  let rows = await dbAll(
    `SELECT * FROM customers WHERE (LOWER(email) LIKE CONCAT(?,'%') OR LOWER(email2) LIKE CONCAT(?,'%')) AND (? = 'all' OR status = ?) LIMIT ?`,
    [q, q, status, status, limit]
  );
  if (!rows.length) {
    rows = await dbAll(
      `SELECT * FROM customers WHERE (LOWER(email) LIKE CONCAT('%',?,'%') OR LOWER(email2) LIKE CONCAT('%',?,'%')) AND (? = 'all' OR status = ?) LIMIT ?`,
      [q, q, status, status, limit]
    );
  }
  return rows.map(r => {
    const exact = (r.email || '').toLowerCase() === q || (r.email2 || '').toLowerCase() === q;
    const prefix = !exact && ((r.email || '').toLowerCase().startsWith(q) || (r.email2 || '').toLowerCase().startsWith(q));
    return { ...r, score: exact ? 1000 : prefix ? 500 : 200 };
  }).sort((a, b) => b.score - a.score);
}

async function fetchTextCandidates(q, tokens, status = 'active') {
  const byPhone = new Map();
  const add = (rows) => { for (const r of rows) if (!byPhone.has(r.phone)) byPhone.set(r.phone, r); };

  // Fast path — indexed FULLTEXT, boolean OR so any single matching token qualifies
  try {
    const boolQuery = tokens.map(t => `${t}*`).join(' ');
    if (boolQuery) {
      add(await dbAll(
        `SELECT * FROM customers WHERE MATCH(name,address,notes) AGAINST(? IN BOOLEAN MODE) AND (? = 'all' OR status = ?) LIMIT ?`,
        [boolQuery, status, status, CANDIDATE_CAP]
      ));
    }
  } catch { /* FULLTEXT index may not exist yet on an older DB — fall through to LIKE */ }

  // Safety-net scan — catches typos where a wildcarded prefix can't (e.g. "tamng"
  // vs "tamang"); customer table size here makes this cheap, unlike 100k+ scale.
  const likeParam = `%${q}%`;
  add(await dbAll(
    `SELECT * FROM customers WHERE (name LIKE ? OR address LIKE ? OR notes LIKE ?) AND (? = 'all' OR status = ?) LIMIT ?`,
    [likeParam, likeParam, likeParam, status, status, CANDIDATE_CAP]
  ));

  return [...byPhone.values()];
}

function scoreCandidate(candidate, normalizedQuery, tokens, fuseScoreByPhone) {
  const text = normalize([candidate.name, candidate.address, candidate.notes].filter(Boolean).join(' '));
  const words = tokenize(text);
  let score = 0;

  if (normalizedQuery && text.includes(normalizedQuery)) score += WEIGHT.PHRASE;

  for (const tok of tokens) {
    if (words.includes(tok)) { score += WEIGHT.WORD; continue; }
    if (words.some(w => w.startsWith(tok))) { score += WEIGHT.PREFIX; continue; }
    if (text.includes(tok)) { score += WEIGHT.SUBSTRING; continue; }

    let bestDist = Infinity;
    for (const w of words) {
      const d = levenshtein.get(tok, w);
      if (d < bestDist) bestDist = d;
    }
    if (bestDist <= 2) { score += WEIGHT.LEV; continue; }

    const [tokPrimary, tokSecondary] = doubleMetaphone.process(tok);
    const phoneticHit = words.some(w => {
      const [wPrimary, wSecondary] = doubleMetaphone.process(w);
      return (tokPrimary && (tokPrimary === wPrimary || tokPrimary === wSecondary))
        || (tokSecondary && (tokSecondary === wPrimary || tokSecondary === wSecondary));
    });
    if (phoneticHit) score += WEIGHT.METAPHONE;
  }

  const fuseScore = fuseScoreByPhone.get(candidate.phone);
  if (fuseScore != null) score += Math.round((1 - fuseScore) * 40);

  return score;
}

// Returns the FULL sorted, score>0 match set (no slicing) — callers cap/paginate.
async function searchText(rawQuery, status = 'active') {
  const normalizedQuery = normalize(rawQuery);
  const tokens = tokenize(rawQuery);
  if (!tokens.length) return [];

  const candidates = await fetchTextCandidates(normalizedQuery, tokens, status);
  if (!candidates.length) return [];

  const fuse = new Fuse(candidates, { keys: ['name', 'address', 'notes'], includeScore: true, threshold: 0.6 });
  const fuseScoreByPhone = new Map(fuse.search(rawQuery).map(r => [r.item.phone, r.score]));

  return candidates
    .map(c => ({ ...c, score: scoreCandidate(c, normalizedQuery, tokens, fuseScoreByPhone) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Full ranked match set for a query, status-filtered, unsliced.
async function rankedMatches(raw, status) {
  const type = detectQueryType(raw);
  if (type === 'PHONE') return searchPhone(raw.replace(/[\s()+-]/g, ''), { limit: CANDIDATE_CAP, status });
  if (type === 'EMAIL') return searchEmail(raw, { limit: CANDIDATE_CAP, status });
  return searchText(raw, status);
}

// Live picker — top N only, defaults to active customers.
async function searchCustomers({ q, limit = 20, status = 'active' }) {
  const raw = String(q || '').trim();
  if (!raw) return [];
  return (await rankedMatches(raw, status)).slice(0, limit);
}

// CRM admin grid — same ranking engine, but paginated with a total count.
// Returns null when q is blank so the caller can fall back to its plain
// alphabetical browse query (ranking a blank query is meaningless).
async function searchCustomersPaged({ q, status = 'active', page = 1, limit = 25 }) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  const all = await rankedMatches(raw, status);
  const offset = (page - 1) * limit;
  return { rows: all.slice(offset, offset + limit), total: all.length };
}

module.exports = { searchCustomers, searchCustomersPaged, detectQueryType, HIGH_CONFIDENCE };
