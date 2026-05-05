// Service worker — all external API calls live here so host_permissions bypass CORS.

import { GRADES_API, RMP_URL, RMP_SCHOOL_ID, RMP_AUTH, RMP_QUERY, GRADE_TTL_MS, RMP_TTL_MS } from '../shared/constants';
import { matchProf, pickBestRmp, parseName } from '../shared/nameMatch';
import type { GradeData, RmpData, ApiSection } from '../shared/types';
import type { LookupResponse, CourseSearchResponse, RankedInstructor, FetchSectionsResponse, AddCourseResponse, RefreshSectionsResponse } from '../shared/messages';

const SCHEDULER_BASE = 'https://tamu.collegescheduler.com';
const HOWDY_BASE = 'https://howdyportal.tamu.edu/api';
const HOWDY_TERM_TTL_MS = 24 * 60 * 60 * 1000;
const HOWDY_SECTIONS_TTL_MS = 60 * 60 * 1000;

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

// ─── grades.adibarra.com ──────────────────────────────────────────────────────

interface AdibarraProf { type: 3; id: number; first: string; last: string }
interface AdibarraGrade { type: 4; prof: number; grades: Record<string, number>; gpa: number; year: number }

async function fetchGrades(dept: string, number: string): Promise<Record<string, GradeData> | null> {
  const key = `grade_${dept.toUpperCase()}_${number}`;
  const cached = await cacheGet<Record<string, GradeData> | null>(key);
  if (cached !== undefined) return cached;

  let profs: Record<string, GradeData> | null = null;
  try {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 8000);
    const res = await fetch(`${GRADES_API}?course=${dept.toUpperCase()}-${number}`, { signal: ac.signal });
    if (!res.ok) throw new Error(`adibarra ${res.status}`);
    const json = await res.json() as { data: (AdibarraProf | AdibarraGrade | unknown)[] };
    const items = json.data ?? [];

    // Build prof id → "LAST F" name map
    const profMap = new Map<number, string>();
    for (const item of items) {
      const p = item as AdibarraProf;
      if (p.type === 3) profMap.set(p.id, `${p.last} ${p.first}`.trim());
    }

    // Aggregate grade rows by prof
    const byProf = new Map<number, { a: number; b: number; c: number; d: number; f: number; gpas: number[] }>();
    for (const item of items) {
      const g = item as AdibarraGrade;
      if (g.type !== 4) continue;
      if (!byProf.has(g.prof)) byProf.set(g.prof, { a: 0, b: 0, c: 0, d: 0, f: 0, gpas: [] });
      const p = byProf.get(g.prof)!;
      // Grade code keys: 1=A, 4=B, 7=C, 10=D, 12=F
      p.a += g.grades['1'] ?? 0;
      p.b += g.grades['4'] ?? 0;
      p.c += g.grades['7'] ?? 0;
      p.d += g.grades['10'] ?? 0;
      p.f += g.grades['12'] ?? 0;
      if (g.gpa > 0) p.gpas.push(g.gpa);
    }

    if (byProf.size > 0) {
      profs = {};
      for (const [profId, d] of byProf) {
        const name = profMap.get(profId);
        if (!name) continue;
        const total = d.a + d.b + d.c + d.d + d.f || 1;
        const avgGpa = d.gpas.length ? d.gpas.reduce((s, x) => s + x, 0) / d.gpas.length : 0;
        const key = name.toLowerCase();
        profs[key] = {
          name,
          avgGpa: Math.round(avgGpa * 100) / 100,
          pctA: Math.round((d.a / total) * 100),
          pctB: Math.round((d.b / total) * 100),
          pctC: Math.round((d.c / total) * 100),
          pctD: Math.round((d.d / total) * 100),
          pctF: Math.round((d.f / total) * 100),
          semCount: d.gpas.length,
        };
      }
    }
  } catch (e) {
    console.warn('grades fetch failed:', (e as Error).message);
  }

  if (profs !== null) await cacheSet(key, profs, GRADE_TTL_MS);
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
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5000);
    const res = await fetch(RMP_URL, {
      method: 'POST',
      headers: { Authorization: RMP_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RMP_QUERY, variables: { text: searchText, schoolID: RMP_SCHOOL_ID } }),
      signal: ac.signal,
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

// ─── tab injection helper ─────────────────────────────────────────────────────

function waitForTabLoad(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab load timeout'));
    }, timeoutMs);
    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    // Register listener before checking current state to avoid a race where
    // the tab finishes loading between create() and addListener().
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

async function addCourseViaTab(
  dept: string,
  number: string,
  term: string,
  crnsToExclude: string[],
): Promise<boolean> {
  const existing = await chrome.tabs.query({ url: '*://tamu.collegescheduler.com/*' });
  let tabId: number;
  let opened = false;

  if (existing.length > 0 && existing[0].id != null) {
    tabId = existing[0].id;
  } else {
    const tab = await chrome.tabs.create({ url: `${SCHEDULER_BASE}/entry`, active: false });
    if (tab.id == null) return false;
    tabId = tab.id;
    opened = true;
  }

  await waitForTabLoad(tabId);

  const check = await chrome.tabs.get(tabId);
  if (!check.url?.includes('tamu.collegescheduler.com')) return false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (dept: string, number: string, term: string, crnsToExclude: string[]) => {
        const BASE = 'https://tamu.collegescheduler.com';
        const termEnc = encodeURIComponent(term);
        const token = (document.querySelector('input[name="__RequestVerificationToken"]') as HTMLInputElement | null)?.value ?? '';
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        };
        if (token) headers['X-XSRF-Token'] = token;
        const filterRules = crnsToExclude.length
          ? [{ type: 'registrationNumber', values: crnsToExclude, value: null, excluded: true }]
          : [];
        try {
          const res = await fetch(`${BASE}/api/terms/${termEnc}/desiredcourses`, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ number, subjectId: dept.toUpperCase(), topic: null, filterRules }),
          });
          return res.ok;
        } catch {
          return false;
        }
      },
      args: [dept, number, term, crnsToExclude],
    });
    return results[0]?.result === true;
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ─── Howdy Portal sections ────────────────────────────────────────────────────

interface HowdyTerm { STVTERM_CODE: string; STVTERM_DESC: string }
interface HowdySection {
  SWV_CLASS_SEARCH_CRN?: number | string;
  SWV_CLASS_SEARCH_SECTION?: string;
  SWV_CLASS_SEARCH_INSTRCTR_JSON?: string;
  SWV_CLASS_SEARCH_SUBJECT?: string;
  SWV_CLASS_SEARCH_COURSE?: string;
}

// "Elena Nikolova (P)" → "NIKOLOVA E". Strip "(role)", take last token as last name,
// first letter of first token as initial. Falls back to the trimmed input if it
// can't be split cleanly.
function howdyNameToGradeFormat(raw: string): string {
  const cleaned = raw.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Staff';
  const parts = cleaned.split(' ');
  if (parts.length === 1) return parts[0].toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();
  const initial = parts[0][0]?.toUpperCase() ?? '';
  return initial ? `${last} ${initial}` : last;
}

async function fetchHowdyTermCode(term: string): Promise<string | null> {
  const cacheKey = `howdy_term_${term}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 8000);
    const res = await fetch(`${HOWDY_BASE}/all-terms`, { signal: ac.signal });
    if (!res.ok) return null;
    const terms = await res.json() as HowdyTerm[];
    const needle = term.toLowerCase();
    const match = terms.find((t) => t.STVTERM_DESC?.toLowerCase().includes(needle))
      ?? terms.find((t) => needle.includes(t.STVTERM_DESC?.toLowerCase() ?? ''));
    if (!match) return null;
    await cacheSet(cacheKey, match.STVTERM_CODE, HOWDY_TERM_TTL_MS);
    return match.STVTERM_CODE;
  } catch (e) {
    console.warn('howdy term lookup failed:', (e as Error).message);
    return null;
  }
}

async function fetchSectionsFromHowdy(
  dept: string,
  number: string,
  term: string,
): Promise<ApiSection[]> {
  const termCode = await fetchHowdyTermCode(term);
  if (!termCode) return [];

  const deptUpper = dept.toUpperCase();
  const cacheKey = `howdy_sections_v2_${deptUpper}_${number}_${termCode}`;
  const cached = await cacheGet<ApiSection[]>(cacheKey);
  if (cached !== undefined) return cached;

  // Howdy API rejects requests from the extension origin (403). Run the fetch
  // inside a howdyportal.tamu.edu tab so the Origin header is accepted.
  const existing = await chrome.tabs.query({ url: '*://howdy.tamu.edu/*' });
  let tabId: number;
  let opened = false;

  if (existing.length > 0 && existing[0].id != null) {
    tabId = existing[0].id;
  } else {
    const tab = await chrome.tabs.create({ url: 'https://howdy.tamu.edu', active: false });
    if (tab.id == null) return [];
    tabId = tab.id;
    opened = true;
  }

  try {
    await waitForTabLoad(tabId);
    const check = await chrome.tabs.get(tabId);
    if (!check.url?.includes('howdy.tamu.edu')) return [];

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (base: string, tCode: string, dept: string, num: string) => {
        try {
          const res = await fetch(`${base}/course-sections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startRow: 0, endRow: 0, termCode: tCode, publicSearch: 'Y', subject: dept, courseNumber: num }),
          });
          if (!res.ok) return null;
          return res.json();
        } catch { return null; }
      },
      args: [HOWDY_BASE, termCode, deptUpper, number],
    });

    const allRows = results[0]?.result as HowdySection[] | null;
    if (!allRows) return [];

    const rows = allRows.filter((r) =>
      r.SWV_CLASS_SEARCH_SUBJECT === deptUpper && r.SWV_CLASS_SEARCH_COURSE === number
    );

    const sections: ApiSection[] = rows.map((row) => {
      let instructors: { name: string; id?: string }[] = [];
      const rawJson = row.SWV_CLASS_SEARCH_INSTRCTR_JSON;
      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson) as { NAME?: string }[];
          instructors = parsed
            .map((p) => howdyNameToGradeFormat(p.NAME ?? ''))
            .filter((n) => n.length > 0)
            .map((name) => ({ name, id: '' }));
        } catch {
          instructors = [];
        }
      }
      if (instructors.length === 0) instructors = [{ name: 'Staff', id: '' }];
      return {
        registrationNumber: String(row.SWV_CLASS_SEARCH_CRN ?? ''),
        sectionNumber: row.SWV_CLASS_SEARCH_SECTION,
        instructor: instructors,
        meetings: [],
      };
    }).filter((s) => s.registrationNumber);

    await cacheSet(cacheKey, sections, HOWDY_SECTIONS_TTL_MS);
    return sections;
  } catch (e) {
    console.warn('howdy sections fetch failed:', (e as Error).message);
    return [];
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ─── install / update handler ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'update') {
    chrome.storage.local.set({ showChangelog: true });
  }
});

// ─── message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'LOOKUP') {
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
  }

  if (msg.type === 'COURSE_SEARCH') {
    const { dept, number } = msg as { type: 'COURSE_SEARCH'; dept: string; number: string };
    (async () => {
      try {
        const profs = await fetchGrades(dept, number);
        if (!profs) { sendResponse({ instructors: [] } satisfies CourseSearchResponse); return; }

        // Sort by GPA, take top 10 before fetching RMP (avoid 30+ parallel requests)
        const top = Object.values(profs)
          .filter((g) => g.avgGpa > 0)
          .sort((a, b) => b.avgGpa - a.avgGpa)
          .slice(0, 10);

        const results = await Promise.all(
          top.map(async (g): Promise<RankedInstructor> => {
            const rmpData = await fetchRmp(g.name, dept);
            // Normalize both to 0–1 range, weight GPA more
            const gpaScore = g.avgGpa / 4;
            const rmpScore = rmpData ? rmpData.weighted / 5 : gpaScore * 0.9;
            return { name: g.name, gradeData: g, rmpData, score: gpaScore * 0.65 + rmpScore * 0.35 };
          })
        );

        results.sort((a, b) => b.score - a.score);
        sendResponse({ instructors: results } satisfies CourseSearchResponse);
      } catch (err) {
        console.error('COURSE_SEARCH error:', err);
        sendResponse({ instructors: [] } satisfies CourseSearchResponse);
      }
    })();
    return true;
  }

  if (msg.type === 'FETCH_SECTIONS') {
    const { dept, number, term } = msg as { type: 'FETCH_SECTIONS'; dept: string; number: string; term: string };
    (async () => {
      try {
        const sections = await fetchSectionsFromHowdy(dept, number, term);

        // Opportunistically attach seat data from Schedule Builder regblocks.
        // This works only when the user is logged in; silently skips on 401/403.
        try {
          const ac = new AbortController();
          setTimeout(() => ac.abort(), 6000);
          const url = `${SCHEDULER_BASE}/api/terms/${encodeURIComponent(term)}/subjects/${dept.toUpperCase()}/courses/${number}/regblocks`;
          const res = await fetch(url, { credentials: 'include', signal: ac.signal });
          if (res.ok) {
            const data = await res.json() as {
              sections?: { crn?: number | string; openSeats?: number; totalSeats?: number; waitlistCount?: number }[];
            };
            const seatMap = new Map<string, { openSeats?: number; totalSeats?: number; waitlistCount?: number }>();
            for (const s of data.sections ?? []) {
              if (s.crn != null) seatMap.set(String(s.crn), { openSeats: s.openSeats, totalSeats: s.totalSeats, waitlistCount: s.waitlistCount });
            }
            for (const s of sections) {
              const seat = seatMap.get(s.registrationNumber);
              if (seat) {
                s.openSeats = seat.openSeats;
                s.totalSeats = seat.totalSeats;
                s.waitlistCount = seat.waitlistCount;
              }
            }
          }
        } catch { /* not logged in or network error — seat data unavailable */ }

        sendResponse({ sections } satisfies FetchSectionsResponse);
      } catch {
        sendResponse({ sections: [] } satisfies FetchSectionsResponse);
      }
    })();
    return true;
  }

  if (msg.type === 'ADD_COURSE_TO_BUILDER') {
    const { dept, number, term, crnsToExclude } = msg as {
      type: 'ADD_COURSE_TO_BUILDER';
      dept: string;
      number: string;
      term: string;
      crnsToExclude: string[];
    };
    (async () => {
      try {
        const ok = await addCourseViaTab(dept, number, term, crnsToExclude);
        sendResponse({ ok } satisfies AddCourseResponse);
      } catch (e) {
        console.error('ADD_COURSE_TO_BUILDER error:', e);
        sendResponse({ ok: false } satisfies AddCourseResponse);
      }
    })();
    return true;
  }

  if (msg.type === 'REFRESH_SECTIONS') {
    const { term } = msg as { type: 'REFRESH_SECTIONS'; term: string };
    (async () => {
      try {
        const stored = await chrome.storage.local.get('savedSections');
        const savedSections = (stored.savedSections ?? {}) as Record<string, import('../shared/types').SavedSection>;

        // Group by dept+courseNumber to deduplicate regblocks calls
        const courseMap = new Map<string, { dept: string; number: string }>();
        for (const section of Object.values(savedSections)) {
          const key = `${section.dept}_${section.courseNumber}`;
          if (!courseMap.has(key)) courseMap.set(key, { dept: section.dept, number: section.courseNumber });
        }

        if (courseMap.size === 0) {
          sendResponse({ updatedCount: 0, timestamp: Date.now() } satisfies RefreshSectionsResponse);
          return;
        }

        // Fetch regblocks for each unique course; collect seat data by CRN
        const seatsByCrn = new Map<string, import('../shared/types').SeatData>();
        let fetchSucceeded = 0;
        await Promise.all(
          Array.from(courseMap.values()).map(async ({ dept, number }) => {
            try {
              const ac = new AbortController();
              setTimeout(() => ac.abort(), 8000);
              const url = `${SCHEDULER_BASE}/api/terms/${encodeURIComponent(term)}/subjects/${dept.toUpperCase()}/courses/${number}/regblocks`;
              const res = await fetch(url, { credentials: 'include', signal: ac.signal });
              if (!res.ok) return;
              const data = await res.json() as {
                sections?: { crn?: number | string; openSeats?: number; totalSeats?: number; waitlistCount?: number }[];
              };
              fetchSucceeded++;
              for (const s of data.sections ?? []) {
                if (s.crn == null) continue;
                seatsByCrn.set(String(s.crn), {
                  openSeats: s.openSeats,
                  totalSeats: s.totalSeats,
                  waitlistCount: s.waitlistCount,
                });
              }
            } catch { /* ignore per-course failure */ }
          })
        );

        // All fetches failed — likely session expired
        if (fetchSucceeded === 0) {
          sendResponse({ updatedCount: 0, timestamp: Date.now(), error: true } satisfies RefreshSectionsResponse);
          return;
        }

        // Re-read storage right before write to minimize race window with concurrent saves/removes
        const fresh = await chrome.storage.local.get('savedSections');
        const sections = (fresh.savedSections ?? {}) as Record<string, import('../shared/types').SavedSection>;
        const timestamp = Date.now();
        let updatedCount = 0;
        for (const [crn, section] of Object.entries(sections)) {
          const seats = seatsByCrn.get(crn);
          if (seats) {
            sections[crn] = { ...section, seatData: seats, lastRefreshed: timestamp };
            updatedCount++;
          }
        }

        await chrome.storage.local.set({ savedSections: sections });
        sendResponse({ updatedCount, timestamp } satisfies RefreshSectionsResponse);
      } catch (err) {
        console.error('REFRESH_SECTIONS error:', err);
        sendResponse({ updatedCount: 0, timestamp: Date.now(), error: true } satisfies RefreshSectionsResponse);
      }
    })();
    return true;
  }

  return false;
});
