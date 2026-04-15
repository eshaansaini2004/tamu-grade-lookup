// Capture the API call Schedule Builder makes when adding a section.
// Usage: node scripts/capture-add-section.js
//
// Navigates to Schedule Builder, lists available courses, picks one with
// open sections, clicks Add, and prints all POST/PUT requests captured.

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

  // Verify session
  await page.goto(`https://tamu.collegescheduler.com`);
  await page.waitForLoadState('networkidle');
  if (!page.url().includes('collegescheduler.com')) {
    console.error('Session expired — run setup-profile.js again');
    await context.close();
    process.exit(1);
  }
  console.log('Session OK, URL:', page.url(), '\n');

  // Capture all non-GET requests
  const captured = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET') {
      captured.push({
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        postData: req.postData(),
      });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (req.method() !== 'GET') {
      let body = '';
      try { body = await res.text(); } catch {}
      const entry = captured.find((c) => c.url === req.url() && c.method === req.method());
      if (entry) entry.responseBody = body.slice(0, 500);
    }
  });

  // Fetch a course list to find something with sections
  console.log('Fetching CSCE courses...');
  const courses = await page.evaluate(async (termEnc) => {
    const res = await fetch(
      `/api/terms/${termEnc}/subjects/CSCE/courses`,
      { credentials: 'include' }
    );
    return res.json();
  }, TERM_ENC);

  const course = Array.isArray(courses) ? courses[0] : null;
  if (!course) {
    console.error('No CSCE courses found');
    await context.close();
    process.exit(1);
  }
  console.log(`Using course: CSCE ${course.number ?? course.id ?? JSON.stringify(course)}\n`);

  const courseNum = course.number ?? course.id;

  // Fetch sections for that course
  const sections = await page.evaluate(async ({ termEnc, num }) => {
    const res = await fetch(
      `/api/terms/${termEnc}/subjects/CSCE/courses/${num}/regblocks`,
      { credentials: 'include' }
    );
    return res.json();
  }, { termEnc: TERM_ENC, num: String(courseNum) });

  console.log('Sections response keys:', Object.keys(sections));
  const firstSection = sections?.sections?.[0] ?? sections?.registrationBlocks?.[0];
  if (!firstSection) {
    console.log('Full response:', JSON.stringify(sections).slice(0, 800));
    console.error('No sections found');
    await context.close();
    process.exit(1);
  }
  console.log('First section:', JSON.stringify(firstSection, null, 2));

  // Now navigate to the course search UI and try clicking Add via the actual page
  console.log('\nNavigating to Schedule Builder UI to trigger add...');
  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');

  // Try a direct API approach — POST to add the section
  // Common patterns: /api/terms/{term}/courses or /api/terms/{term}/sections
  // Let's probe both and see what's available
  const probeResults = await page.evaluate(async ({ termEnc }) => {
    const results = {};

    // Try fetching current scheduled sections
    const r1 = await fetch(`/api/terms/${termEnc}/sections`, { credentials: 'include' });
    results.sections_get_status = r1.status;
    if (r1.ok) results.sections_get = await r1.json().catch(() => 'not json');

    // Try fetching current courses added to schedule
    const r2 = await fetch(`/api/terms/${termEnc}/courses`, { credentials: 'include' });
    results.courses_get_status = r2.status;
    if (r2.ok) {
      const j = await r2.json().catch(() => null);
      results.courses_get = j ? JSON.stringify(j).slice(0, 400) : 'not json';
    }

    return results;
  }, { termEnc: TERM_ENC });

  console.log('\nProbe results:');
  console.log(JSON.stringify(probeResults, null, 2));

  // Attempt to add via UI — search for the course and click Add
  try {
    // Look for a search box
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="course" i], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.fill(`CSCE ${courseNum}`);
      await page.waitForTimeout(1500);
      // Look for an add button
      const addBtn = page.locator('button:has-text("Add"), button:has-text("add")').first();
      if (await addBtn.isVisible({ timeout: 2000 })) {
        console.log('\nFound Add button — clicking...');
        await addBtn.click();
        await page.waitForTimeout(2000);
      }
    }
  } catch (e) {
    console.log('UI interaction failed (expected):', e.message);
  }

  console.log('\n=== Captured non-GET requests ===');
  if (captured.length === 0) {
    console.log('None captured. Trying direct POST probes...\n');

    // Try the most common patterns for adding a course/section
    const postProbes = await page.evaluate(async ({ termEnc, courseNum }) => {
      const results = [];

      const attempts = [
        { method: 'POST', url: `/api/terms/${termEnc}/courses`, body: JSON.stringify({ subjectCode: 'CSCE', courseNumber: String(courseNum) }) },
        { method: 'PUT', url: `/api/terms/${termEnc}/courses/CSCE/${courseNum}`, body: '{}' },
        { method: 'POST', url: `/api/terms/${termEnc}/sections`, body: JSON.stringify({ subjectCode: 'CSCE', courseNumber: String(courseNum) }) },
      ];

      for (const a of attempts) {
        const r = await fetch(a.url, {
          method: a.method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: a.body,
        });
        results.push({ method: a.method, url: a.url, status: r.status, body: (await r.text()).slice(0, 300) });
      }
      return results;
    }, { termEnc: TERM_ENC, courseNum: String(courseNum) });

    for (const p of postProbes) {
      console.log(`${p.method} ${p.url} → ${p.status}`);
      if (p.body) console.log('  Response:', p.body);
    }
  } else {
    for (const r of captured) {
      console.log(`${r.method} ${r.url}`);
      if (r.postData) console.log('  Body:', r.postData.slice(0, 300));
      if (r.responseBody) console.log('  Response:', r.responseBody);
      console.log();
    }
  }

  await context.close();
})();
