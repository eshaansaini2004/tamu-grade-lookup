// Find the add-course endpoint by inspecting term-data IDs and JS source.
// Usage: node scripts/probe-add-api2.js

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

  // Get term-data to understand course ID format and what's already added
  const termData = await page.evaluate(async ({ termEnc }) => {
    const r = await fetch(`/api/term-data/${termEnc}`, { credentials: 'include' });
    const j = await r.json();
    return {
      courses: j.courses?.slice(0, 3).map(c => ({ id: c.id, subjectId: c.subjectId, number: c.number, title: c.title })),
      currentSections: j.currentSections?.slice(0, 2).map(s => ({ registrationNumber: s.registrationNumber, subject: s.subject, course: s.course })),
      cartSections: j.cartSections?.slice(0, 2),
    };
  }, { termEnc: TERM_ENC });

  console.log('Term data sample:');
  console.log(JSON.stringify(termData, null, 2));

  // Get a CSCE course's numeric ID from the browse endpoint
  const csceId = await page.evaluate(async ({ termEnc }) => {
    const r = await fetch(`/api/terms/${termEnc}/subjects/CSCE/courses`, { credentials: 'include' });
    const courses = await r.json();
    const c312 = courses.find(c => c.number === '312') ?? courses[0];
    return c312 ? { id: c312.id, number: c312.number, raw: JSON.stringify(c312).slice(0, 200) } : null;
  }, { termEnc: TERM_ENC });

  console.log('\nCSCE course from browse:', JSON.stringify(csceId, null, 2));

  // Intercept all non-analytics requests now
  const captured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('google') && !url.includes('analytics') && !url.includes('fonts.')) {
      captured.push({ method: req.method(), url: url.replace('https://tamu.collegescheduler.com', ''), body: req.postData()?.slice(0, 400) });
    }
  });

  // Probe with numeric IDs and pipe-format IDs
  const probes = await page.evaluate(async ({ termEnc, courseId, numericId }) => {
    const results = [];

    const tryFetch = async (label, method, url, body) => {
      try {
        const r = await fetch(url, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = (await r.text()).slice(0, 200);
        return { label, status: r.status, body: text };
      } catch (e) {
        return { label, error: e.message };
      }
    };

    const base = `/api/terms/${termEnc}`;

    // Try with pipe ID (CSCE|312 format from browse API)
    results.push(await tryFetch('PUT /courses/CSCE|312 (pipe)', 'PUT', `${base}/courses/${encodeURIComponent(courseId)}`, {}));
    results.push(await tryFetch('POST /courses body={id:pipe}', 'POST', `${base}/courses`, [{ id: courseId }]));

    // Try array body (some Angular apps send arrays)
    results.push(await tryFetch('PUT /courses body=[id]', 'PUT', `${base}/courses`, [courseId]));

    // Try with numeric id if available
    if (numericId) {
      results.push(await tryFetch(`PUT /courses/${numericId}`, 'PUT', `${base}/courses/${numericId}`, {}));
      results.push(await tryFetch(`POST /courses body={id:${numericId}}`, 'POST', `${base}/courses`, { id: numericId }));
      results.push(await tryFetch(`DELETE /courses/${numericId} (to test format)`, 'DELETE', `${base}/courses/${numericId}`, undefined));
    }

    // Check if there's a dedicated "add" sub-route
    results.push(await tryFetch('POST /courses/add', 'POST', `${base}/courses/add`, { subjectId: 'CSCE', number: '312' }));
    results.push(await tryFetch('POST /courses/CSCE/312/add', 'POST', `${base}/courses/CSCE/312/add`, {}));

    // Check sections with CRN
    results.push(await tryFetch('PUT /sections/46248', 'PUT', `${base}/sections/46248`, {}));
    results.push(await tryFetch('POST /sections body={crn}', 'POST', `${base}/sections`, { registrationNumber: '46248' }));

    return results;
  }, { termEnc: TERM_ENC, courseId: csceId?.id ?? 'CSCE|312', numericId: null });

  console.log('\n=== Probe results ===');
  for (const p of probes) {
    const status = p.status ?? p.error;
    console.log(`${status === 200 || status === 201 || status === 204 ? '✓' : ' '} ${p.label}: ${status}`);
    if (p.body && p.body.trim() && !p.body.includes('<!DOCTYPE')) console.log('  →', p.body.slice(0, 150));
  }

  // Also check the app JS for API patterns
  console.log('\nSearching JS bundle for API patterns...');
  const jsUrls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]'))
      .map(s => s.src)
      .filter(s => s.includes('dist') || s.includes('bundle') || s.includes('app'));
  });
  console.log('JS files:', jsUrls.slice(0, 5));

  if (jsUrls.length > 0) {
    const jsContent = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const text = await r.text();
      // Find lines with 'courses' near PUT or POST
      const matches = [];
      const regex = /(PUT|POST|DELETE)[^"'`]*["'`][^"'`]*(course|section)[^"'`]*["'`]/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        matches.push(text.slice(Math.max(0, m.index - 20), m.index + 100));
      }
      return matches.slice(0, 10);
    }, jsUrls[0]);
    if (jsContent?.length) {
      console.log('\nJS API patterns found:');
      jsContent.forEach(m => console.log(' ', m));
    }
  }

  await context.close();
})();
