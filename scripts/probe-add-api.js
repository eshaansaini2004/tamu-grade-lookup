// Probe the Schedule Builder API to find the add-course/section endpoints.
// Usage: node scripts/probe-add-api.js

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

  await page.goto(`https://tamu.collegescheduler.com`);
  await page.waitForLoadState('networkidle');
  console.log('URL:', page.url());

  // Navigate into the actual schedule builder for Spring 2026
  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');
  console.log('Builder URL:', page.url());

  // 1. Check what's in the user's current schedule
  const currentState = await page.evaluate(async ({ termEnc }) => {
    const out = {};

    // Current scheduled courses
    const r1 = await fetch(`/api/terms/${termEnc}/courses/selected`, { credentials: 'include' });
    out.selected_status = r1.status;
    if (r1.ok) out.selected = (await r1.text()).slice(0, 500);

    // term-data gives full schedule state
    const r2 = await fetch(`/api/term-data/${termEnc}`, { credentials: 'include' });
    out.termdata_status = r2.status;
    if (r2.ok) {
      const j = await r2.json().catch(() => null);
      out.termdata_keys = j ? Object.keys(j) : null;
      // currentSections tells us what's already added
      if (j?.currentSections) out.currentSections_count = j.currentSections.length;
      if (j?.courses) out.courses_count = j.courses.length;
      // Grab first course id if any
      if (j?.courses?.[0]) out.first_course = JSON.stringify(j.courses[0]).slice(0, 200);
    }

    return out;
  }, { termEnc: TERM_ENC });

  console.log('\n=== Current state ===');
  console.log(JSON.stringify(currentState, null, 2));

  // 2. Capture all non-analytics requests during UI interaction
  const captured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() !== 'GET' && !url.includes('google') && !url.includes('analytics')) {
      captured.push({ method: req.method(), url, body: req.postData()?.slice(0, 400) });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    const url = req.url();
    if (req.method() !== 'GET' && !url.includes('google') && !url.includes('analytics')) {
      const entry = captured.find((c) => c.url === url);
      if (entry) {
        entry.status = res.status();
        try { entry.response = (await res.text()).slice(0, 400); } catch {}
      }
    }
  });

  // 3. Try clicking a course in the UI
  console.log('\nLooking for course cards...');
  await page.waitForTimeout(2000);

  // Try to find and click any "Add" button on the page
  const addButtons = await page.locator('button').filter({ hasText: /^add$/i }).all();
  console.log(`Found ${addButtons.length} "Add" buttons`);

  if (addButtons.length > 0) {
    console.log('Clicking first Add button...');
    await addButtons[0].click();
    await page.waitForTimeout(2000);
  } else {
    // Look for course list items
    const courseItems = await page.locator('[class*="course"], [class*="Course"]').all();
    console.log(`Found ${courseItems.length} course elements`);
    if (courseItems.length > 0) {
      await courseItems[0].click();
      await page.waitForTimeout(1500);
      const newAddBtns = await page.locator('button').filter({ hasText: /add/i }).all();
      console.log(`After click: ${newAddBtns.length} add buttons`);
      if (newAddBtns.length > 0) {
        await newAddBtns[0].click();
        await page.waitForTimeout(2000);
      }
    }
  }

  console.log('\n=== Captured API calls ===');
  if (captured.length === 0) {
    console.log('None via UI. Running direct POST probes...\n');

    const probes = await page.evaluate(async ({ termEnc }) => {
      const results = [];

      const tryFetch = async (method, url, body) => {
        try {
          const r = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, body: (await r.text()).slice(0, 300) };
        } catch (e) {
          return { error: e.message };
        }
      };

      // Various patterns observed in college scheduler apps
      results.push({ label: 'POST /courses (courseId)', ...(await tryFetch('POST', `/api/terms/${termEnc}/courses`, { courseId: 'CSCE|110' })) });
      results.push({ label: 'POST /courses (subjectId+number)', ...(await tryFetch('POST', `/api/terms/${termEnc}/courses`, { subjectId: 'CSCE', number: '110' })) });
      results.push({ label: 'POST /courses (id)', ...(await tryFetch('POST', `/api/terms/${termEnc}/courses`, { id: 'CSCE|110' })) });
      results.push({ label: 'PUT /courses/CSCE/110', ...(await tryFetch('PUT', `/api/terms/${termEnc}/courses/CSCE/110`, {})) });
      results.push({ label: 'PUT /courses/CSCE|110', ...(await tryFetch('PUT', `/api/terms/${termEnc}/courses/CSCE%7C110`, {})) });
      results.push({ label: 'POST /sections (crn)', ...(await tryFetch('POST', `/api/terms/${termEnc}/sections`, { registrationNumber: '46248' })) });
      results.push({ label: 'PUT /sections/46248', ...(await tryFetch('PUT', `/api/terms/${termEnc}/sections/46248`, {})) });

      // Try getting the shopping cart endpoint
      const cart = await tryFetch('GET', `/api/terms/${termEnc}/cart`, undefined);
      results.push({ label: 'GET /cart', ...cart });

      return results;
    }, { termEnc: TERM_ENC });

    for (const p of probes) {
      console.log(`${p.label}: ${p.status ?? p.error}`);
      if (p.body && p.body.trim()) console.log('  →', p.body.slice(0, 150));
    }
  } else {
    for (const r of captured) {
      console.log(`${r.method} ${r.url}`);
      if (r.body) console.log('  Body:', r.body);
      if (r.status) console.log('  Status:', r.status);
      if (r.response) console.log('  Response:', r.response);
      console.log();
    }
  }

  await context.close();
})();
