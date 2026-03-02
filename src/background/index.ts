// Service worker — all external API calls live here so host_permissions bypass CORS.

import { ANEX_URL, RMP_URL, RMP_SCHOOL_ID, RMP_AUTH, RMP_QUERY, GRADE_TTL_MS, RMP_TTL_MS } from '../shared/constants';
import { parseGradeRows } from '../shared/gradeUtils';
import { matchProf, pickBestRmp, parseName } from '../shared/nameMatch';
import type { GradeData, RmpData } from '../shared/types';
import type { LookupResponse } from '../shared/messages';

// ─── cache ────────────────────────────────────────────────────────────────────

async function cacheGet<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  const entry = result[key] as { data: T; expires: number } | undefined;
  if (!entry || Date.now() > entry.expires) {
    if (entry) chrome.storage.local.remove(key);
    return undefined;
  }
  return entry.data;
}

async function cacheSet<T>(key: string, data: T, ttl: number): Promise<void> {
  await chrome.storage.local.set({ [key]: { data, expires: Date.now() + ttl } });
}

// ─── anex.us ──────────────────────────────────────────────────────────────────

async function fetchGrades(dept: string, number: string): Promise<Record<string, GradeData> | null> {
  const key = `grade_${dept.toUpperCase()}_${number}`;
  const cached = await cacheGet<Record<string, GradeData> | null>(key);
  if (cached !== undefined) return cached;

  let profs: Record<string, GradeData> | null = null;
  try {
    const body = new URLSearchParams({ dept: dept.toUpperCase(), number: String(number) });
    const res = await fetch(ANEX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`anex.us ${res.status}`);
    const json = await res.json() as { classes?: unknown[] };
    if (json.classes?.length) profs = parseGradeRows(json.classes as Parameters<typeof parseGradeRows>[0]);
  } catch (e) {
    console.warn('anex.us fetch failed:', (e as Error).message);
  }

  await cacheSet(key, profs, GRADE_TTL_MS);
  return profs;
}

// ─── RMP ─────────────────────────────────────────────────────────────────────

async function fetchRmp(instructorName: string, dept: string): Promise<RmpData | null> {
  const { last, first } = parseName(instructorName);
  const cacheKey = `rmp_${last.toLowerCase()}_${first.toLowerCase()}_${dept.toLowerCase()}`;
  const cached = await cacheGet<RmpData | null>(cacheKey);
  if (cached !== undefined) return cached;

  const firstClean = first.split(' ')[0];
  const searchText = `${firstClean} ${last}`.trim();

  let result: RmpData | null = null;
  try {
    const res = await fetch(RMP_URL, {
      method: 'POST',
      headers: { Authorization: RMP_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RMP_QUERY, variables: { text: searchText, schoolID: RMP_SCHOOL_ID } }),
    });
    if (res.ok) {
      const json = await res.json() as {
        data?: { newSearch?: { teachers?: { edges: { node: { firstName: string; lastName: string; avgRating: string; numRatings: number; department: string } }[] } } };
      };
      const edges = json?.data?.newSearch?.teachers?.edges ?? [];
      const nodes = edges.map((e) => e.node);
      result = pickBestRmp(nodes, instructorName, dept);
    }
  } catch (e) {
    console.warn('RMP fetch failed:', (e as Error).message);
  }

  await cacheSet(cacheKey, result, RMP_TTL_MS);
  return result;
}

// ─── message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'LOOKUP') return false;
  const { dept, number, instructorName } = msg as { type: 'LOOKUP'; dept: string; number: string; instructorName: string };

  (async () => {
    try {
      const [profs, rmpData] = await Promise.all([
        fetchGrades(dept, number),
        fetchRmp(instructorName, dept),
      ]);
      const gradeData = profs ? matchProf(profs, instructorName) : null;
      sendResponse({ gradeData, rmpData } satisfies LookupResponse);
    } catch (err) {
      console.error('LOOKUP error:', err);
      sendResponse({ gradeData: null, rmpData: null } satisfies LookupResponse);
    }
  })();

  return true;
});
