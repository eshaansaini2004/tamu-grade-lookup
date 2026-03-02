// background.js — service worker
// All external API calls live here so host_permissions bypass CORS.
// Logic mirrors leopardworks/rmp.py and scraper.py.

const ANEX_URL = 'https://anex.us/grades/getData/';
const RMP_URL = 'https://www.ratemyprofessors.com/graphql';
const RMP_SCHOOL_ID = 'U2Nob29sLTEwMDM='; // TAMU College Station (School-1003)
const RMP_AUTH = 'Basic dGVzdDp0ZXN0';

const GRADE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RMP_TTL_MS   = 24 * 60 * 60 * 1000;

// Bayesian prior (from leopardworks/rmp.py)
const RMP_PRIOR_MEAN   = 3.5;
const RMP_PRIOR_WEIGHT = 10;

// Dept → partial RMP department string (from leopardworks/rmp.py _DEPT_KEYWORDS)
const DEPT_KEYWORDS = {
  CSCE: 'computer', ECEN: 'electrical', MEEN: 'mechanical', CHEN: 'chemical',
  CVEN: 'civil', AERO: 'aerospac', NUEN: 'nuclear', ISEN: 'industrial',
  PETE: 'petroleum', OCEN: 'ocean', MATH: 'math', STAT: 'stat',
  PHYS: 'physic', CHEM: 'chem', BIOL: 'biol', BIMS: 'biomed', BMEN: 'biomed',
  ENGL: 'english', POLS: 'politic', HIST: 'hist', PSYC: 'psych',
  ECON: 'econ', ACCT: 'account', FINC: 'financ', MGMT: 'manag', MKTG: 'market',
};

const RMP_QUERY = `
  query SearchTeacher($text: String!, $schoolID: ID!) {
    newSearch {
      teachers(query: {text: $text, schoolID: $schoolID}, first: 5) {
        edges {
          node { firstName lastName avgRating numRatings department }
        }
      }
    }
  }
`;

// ─── cache ────────────────────────────────────────────────────────────────────

async function cacheGet(key) {
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry || Date.now() > entry.expires) {
    if (entry) chrome.storage.local.remove(key);
    return undefined;
  }
  return entry.data;
}

async function cacheSet(key, data, ttl) {
  await chrome.storage.local.set({ [key]: { data, expires: Date.now() + ttl } });
}

// ─── anex.us ──────────────────────────────────────────────────────────────────

async function fetchGrades(dept, number) {
  const key = `grade_${dept.toUpperCase()}_${number}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  let profs = null;
  try {
    const body = new URLSearchParams({ dept: dept.toUpperCase(), number: String(number) });
    const res = await fetch(ANEX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`anex.us ${res.status}`);
    const json = await res.json();
    if (json.classes?.length) profs = parseGradeRows(json.classes);
  } catch (e) {
    console.warn('anex.us fetch failed:', e.message);
  }

  await cacheSet(key, profs, GRADE_TTL_MS);
  return profs;
}

// Returns Map<lowercaseLastName → profData>
function parseGradeRows(rows) {
  const byName = {};
  for (const row of rows) {
    const name = (row.prof || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName[key]) byName[key] = { name, a: 0, b: 0, c: 0, d: 0, f: 0, gpas: [], sems: new Set() };
    const p = byName[key];
    p.a += parseInt(row.A) || 0;
    p.b += parseInt(row.B) || 0;
    p.c += parseInt(row.C) || 0;
    p.d += parseInt(row.D) || 0;
    p.f += parseInt(row.F) || 0;
    const gpa = parseFloat(row.gpa);
    if (gpa > 0) p.gpas.push(gpa);
    const sem = `${capitalize(row.semester || '')} ${row.year || ''}`.trim();
    if (sem) p.sems.add(sem);
  }

  const result = {};
  for (const [key, d] of Object.entries(byName)) {
    const total = d.a + d.b + d.c + d.d + d.f || 1;
    const avgGpa = d.gpas.length ? d.gpas.reduce((s, x) => s + x, 0) / d.gpas.length : 0;
    result[key] = {
      name: d.name,
      avgGpa: Math.round(avgGpa * 100) / 100,
      pctA: pct(d.a, total),
      pctB: pct(d.b, total),
      pctC: pct(d.c, total),
      pctD: pct(d.d, total),
      pctF: pct(d.f, total),
      semCount: d.sems.size,
    };
  }
  return result;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

function pct(n, total) {
  return Math.round((n / total) * 100);
}

// ─── name matching ────────────────────────────────────────────────────────────

// Schedule Builder name format: "Carlisle, Martin" or "Da Silva, Dilma"
function parseName(instructorName) {
  const parts = instructorName.split(',').map(s => s.trim());
  const last = parts[0] || '';
  const first = parts[1] || '';
  return { last, first };
}

// Match Schedule Builder "Last, First" against anex.us prof map (keys are lowercase full names)
// anex.us names are like "Carlisle M" or "Da Silva D" (last name + initial)
// Strategy: match on all last-name tokens
function matchProf(profs, instructorName) {
  const { last } = parseName(instructorName);
  const lastTokens = last.toLowerCase().split(/\s+/);

  for (const [key, prof] of Object.entries(profs)) {
    // anex key is something like "carlisle m" or "da silva d"
    // Check that all tokens of the Howdy last name appear in the anex key
    if (lastTokens.every(t => key.includes(t))) return prof;
  }
  return null;
}

// ─── RMP ─────────────────────────────────────────────────────────────────────

async function fetchRmp(instructorName, dept) {
  const { last, first } = parseName(instructorName);
  const cacheKey = `rmp_${last.toLowerCase()}_${first.toLowerCase()}_${dept.toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  // Drop middle initial from first name: "Calvin J." → "Calvin"
  const firstClean = first.split(' ')[0];
  const searchText = `${firstClean} ${last}`.trim();
  const deptKeyword = DEPT_KEYWORDS[dept.toUpperCase()] || '';
  const isInitial = firstClean.length === 1;
  const lastTokens = new Set(last.toLowerCase().split(/\s+/));

  let result = null;
  try {
    const res = await fetch(RMP_URL, {
      method: 'POST',
      headers: { 'Authorization': RMP_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RMP_QUERY, variables: { text: searchText, schoolID: RMP_SCHOOL_ID } }),
    });
    if (res.ok) {
      const json = await res.json();
      const edges = json?.data?.newSearch?.teachers?.edges ?? [];

      const candidates = edges
        .map(e => e.node)
        .filter(n => {
          // All last name tokens must appear in RMP last name
          const rmpLastTokens = new Set(n.lastName.toLowerCase().split(/\s+/));
          if (![...lastTokens].every(t => rmpLastTokens.has(t))) return false;
          if (!first) return true;

          const rmpFirst = n.firstName.toLowerCase();
          if (isInitial) {
            if (!rmpFirst.startsWith(firstClean.toLowerCase())) return false;
            // Dept check when matching on initial only
            if (deptKeyword) {
              return (n.department || '').toLowerCase().includes(deptKeyword);
            }
            return true;
          }
          // Full first name: all tokens must appear in RMP full name
          const rmpFullTokens = new Set(`${n.firstName} ${n.lastName}`.toLowerCase().split(/\s+/));
          return firstClean.toLowerCase().split(/\s+/).every(t => rmpFullTokens.has(t));
        })
        .filter(n => n.numRatings > 0)
        .sort((a, b) => b.numRatings - a.numRatings);

      if (candidates.length > 0) {
        const best = candidates[0];
        const raw = parseFloat(best.avgRating);
        const n = best.numRatings;
        const weighted = (n * raw + RMP_PRIOR_WEIGHT * RMP_PRIOR_MEAN) / (n + RMP_PRIOR_WEIGHT);
        result = {
          rating: Math.round(raw * 10) / 10,
          weighted: Math.round(weighted * 10) / 10,
          count: n,
        };
      }
    }
  } catch (e) {
    console.warn('RMP fetch failed:', e.message);
  }

  await cacheSet(cacheKey, result, RMP_TTL_MS);
  return result;
}

// ─── message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'LOOKUP') return false;
  const { dept, number, instructorName } = msg;

  (async () => {
    try {
      const [profs, rmpData] = await Promise.all([
        fetchGrades(dept, number),
        fetchRmp(instructorName, dept),
      ]);
      const gradeData = profs ? matchProf(profs, instructorName) : null;
      sendResponse({ gradeData, rmpData });
    } catch (err) {
      console.error('LOOKUP error:', err);
      sendResponse({ gradeData: null, rmpData: null });
    }
  })();

  return true; // keep channel open for async
});
