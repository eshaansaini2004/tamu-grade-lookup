// Probe the exact endpoints found in the JS bundle.
// Usage: node scripts/probe-add-api3.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
const TERM_ENC = encodeURIComponent(TERM);

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-first-run'],
  });

  const page = await context.newPage();
  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');

  // Get term-data to find a numeric course ID already in the user's list
  const termData = await page.evaluate(async ({ termEnc }) => {
    const r = await fetch(`/api/term-data/${termEnc}`, { credentials: 'include' });
    const j = await r.json();
    return {
      // Grab first course with full data
      firstCourse: j.courses?.[0] ?? null,
      // Also grab a CRN that's NOT in currentSections for safe testing
      allCourseFull: j.courses?.slice(0, 5) ?? [],
    };
  }, { termEnc: TERM_ENC });

  console.log('Existing courses in builder:');
  termData.allCourseFull.forEach(c => console.log(`  id=${c.id} ${c.subjectId} ${c.number}`));

  // Also fetch a course that is NOT yet in the builder to test adding
  const newCourse = await page.evaluate(async ({ termEnc, existingIds }) => {
    const r = await fetch(`/api/terms/${termEnc}/subjects/CSCE/courses`, { credentials: 'include' });
    const courses = await r.json();
    // Find one NOT already in the builder
    return courses.find(c => !existingIds.includes(c.id.replace('CSCE|', '312'))) ?? courses[0];
  }, { termEnc: TERM_ENC, existingIds: termData.allCourseFull.map(c => c.subjectId + '|' + c.number) });

  console.log('\nTest course (to add):', JSON.stringify(newCourse).slice(0, 200));

  const existing = termData.firstCourse;

  const probes = await page.evaluate(async ({ termEnc, existingId, existingCourse, newCourseId }) => {
    const results = [];

    const tryFetch = async (label, method, url, body) => {
      try {
        const r = await fetch(url, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = (await r.text()).slice(0, 300);
        return { label, status: r.status, body: text };
      } catch (e) {
        return { label, error: e.message };
      }
    };

    const base = `/api/terms/${termEnc}`;

    // ── coursestatuses endpoint (found in JS) ──────────────────────────
    // GET current status of an existing course
    results.push(await tryFetch(
      `GET coursestatuses/${existingId}`,
      'GET', `${base}/coursestatuses/${existingId}`, undefined
    ));

    // PUT to select (found pattern: g.put("coursestatuses/"+e.id+"/selected",e))
    results.push(await tryFetch(
      `PUT coursestatuses/${existingId}/selected`,
      'PUT', `${base}/coursestatuses/${existingId}/selected`, existingCourse
    ));

    // Can we GET coursestatuses list?
    results.push(await tryFetch('GET coursestatuses', 'GET', `${base}/coursestatuses`, undefined));

    // Try adding a new course via coursestatuses (pipe ID format)
    results.push(await tryFetch(
      `PUT coursestatuses/${newCourseId}/selected (pipe ID)`,
      'PUT', `${base}/coursestatuses/${encodeURIComponent(newCourseId)}/selected`,
      { id: newCourseId }
    ));

    // ── sections endpoint (found in JS: PUT/DELETE with regNumber+subjectCode) ──
    // The pattern was: method: artRemove ? "DELETE" : "PUT", regNumber, subjectCode
    // Try various section endpoint patterns
    results.push(await tryFetch(
      'GET sections list',
      'GET', `${base}/sections`, undefined
    ));

    // Try adding a section (CRN 46248 = CSCE 110)
    results.push(await tryFetch(
      'PUT sections/46248',
      'PUT', `${base}/sections/46248`,
      { regNumber: '46248', subjectCode: 'CSCE', sectionParameterValues: {} }
    ));

    results.push(await tryFetch(
      'POST sections (body with regNumber)',
      'POST', `${base}/sections`,
      { regNumber: '46248', subjectCode: 'CSCE', sectionParameterValues: {} }
    ));

    // ── desiredcourses endpoint ────────────────────────────────────────
    results.push(await tryFetch('GET desiredcourses', 'GET', `${base}/desiredcourses`, undefined));
    results.push(await tryFetch(
      'PUT desiredcourses',
      'PUT', `${base}/desiredcourses`,
      [{ id: newCourseId }]
    ));
    results.push(await tryFetch(
      'POST desiredcourses',
      'POST', `${base}/desiredcourses`,
      [{ id: newCourseId }]
    ));

    return results;
  }, {
    termEnc: TERM_ENC,
    existingId: existing?.id,
    existingCourse: existing,
    newCourseId: newCourse?.id ?? 'CSCE|312',
  });

  console.log('\n=== Probe results ===');
  for (const p of probes) {
    const ok = [200, 201, 204].includes(p.status);
    const sym = ok ? '✓' : (p.status === 404 ? '✗' : '?');
    console.log(`${sym} ${p.label}: ${p.status ?? p.error}`);
    if (p.body?.trim() && !p.body.includes('<!DOCTYPE') && !p.body.includes('<html')) {
      console.log('  →', p.body.slice(0, 200));
    }
  }

  await context.close();
})();
