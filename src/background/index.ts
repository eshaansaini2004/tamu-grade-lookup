// Service worker — all external API calls live here so host_permissions bypass CORS.

import { GRADES_API, RMP_URL, RMP_SCHOOL_ID, RMP_AUTH, RMP_QUERY, GRADE_TTL_MS, RMP_TTL_MS } from '../shared/constants';
import { matchProf, pickBestRmp, parseName } from '../shared/nameMatch';
import type { GradeData, RmpData, ApiSection } from '../shared/types';
import type { LookupResponse, CourseSearchResponse, RankedInstructor, FetchSectionsResponse, AddCourseResponse, RefreshSectionsResponse } from '../shared/messages';

const SCHEDULER_BASE = 'https://tamu.collegescheduler.com';

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

// ─── XSRF token helper ───────────────────────────────────────────────────────

// Fetches a fresh X-XSRF-Token from the page HTML. Background SW can do this
// because host_permissions lets it make credentialed GETs. Falls back to the
// value cached by the content script in chrome.storage.local.
async function fetchXsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(`${SCHEDULER_BASE}/entry`, { credentials: 'include' });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)
             ?? html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i);
      if (m?.[1]) return m[1];
    }
  } catch { /* fall through to cached */ }

  const stored = await chrome.storage.local.get('rfToken');
  return (stored.rfToken as string | undefined) ?? null;
}

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
        const url = `${SCHEDULER_BASE}/api/terms/${encodeURIComponent(term)}/subjects/${dept.toUpperCase()}/courses/${number}/regblocks`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) { sendResponse({ sections: [] } satisfies FetchSectionsResponse); return; }
        const data = await res.json() as { sections?: ApiSection[] };
        sendResponse({ sections: data.sections ?? [] } satisfies FetchSectionsResponse);
      } catch {
        sendResponse({ sections: [] } satisfies FetchSectionsResponse);
      }
    })();
    return true;
  }

  if (msg.type === 'ADD_COURSE_TO_BUILDER') {
    const { dept, number, term, sectionCrns } = msg as {
      type: 'ADD_COURSE_TO_BUILDER';
      dept: string;
      number: string;
      term: string;
      sectionCrns: string[];
    };
    (async () => {
      try {
        // The Angular bundle sends X-XSRF-Token (not RF-Token) with the value from
        // the hidden __RequestVerificationToken input. GET requests work fine without it;
        // POSTs require it for ASP.NET anti-forgery validation.
        const xsrfToken = await fetchXsrfToken();

        const termEnc = encodeURIComponent(term);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        };
        if (xsrfToken) headers['X-XSRF-Token'] = xsrfToken;

        const res = await fetch(`${SCHEDULER_BASE}/api/terms/${termEnc}/desiredcourses`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ number, subjectId: dept.toUpperCase(), topic: null }),
        });

        if (!res.ok) { sendResponse({ ok: false } satisfies AddCourseResponse); return; }

        const course = await res.json() as { id?: number };
        const courseId = course.id;

        // Best-effort: lock to this prof's sections
        if (courseId && sectionCrns.length) {
          await Promise.all(
            sectionCrns.map((crn) =>
              fetch(`${SCHEDULER_BASE}/api/terms/${termEnc}/desiredcourses/${courseId}/lock`, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify({ registrationNumber: crn }),
              }).catch(() => {})
            )
          );
        }

        sendResponse({ ok: true } satisfies AddCourseResponse);
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
