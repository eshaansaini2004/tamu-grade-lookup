// Use Playwright's native fetch (full browser context + cookies) to post desiredcourses.
// Also try navigating the real UI with route interception.
// Usage: node scripts/probe-add-api9.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
const TERM_ENC = encodeURIComponent(TERM);
const BASE = 'https://tamu.collegescheduler.com';

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-first-run'],
  });

  const page = await context.newPage();
  await page.goto(`${BASE}/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');

  // Get the RF-Token from the page
  const rfToken = await page.evaluate(() =>
    document.getElementsByName('__RequestVerificationToken')[0]?.value ?? ''
  );
  console.log('RF-Token (first 30):', rfToken.slice(0, 30));

  // Get cookies from browser context
  const cookies = await context.cookies(BASE);
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log('Cookies:', cookies.map(c => c.name).join(', '));

  // Get existing desired courses to find one to add
  const existingRes = await context.request.get(`${BASE}/api/terms/${TERM_ENC}/desiredcourses`);
  const existingList = await existingRes.json();
  console.log('Existing desired courses:', existingList.length);

  const browseRes = await context.request.get(`${BASE}/api/terms/${TERM_ENC}/subjects/CSCE/courses`);
  const browseCourses = await browseRes.json();
  const existingIds = new Set(existingList.map(c => `${c.subjectId}|${c.number}`));
  const toAdd = browseCourses.find(c => !existingIds.has(c.id));
  console.log('Course to add:', toAdd?.id, toAdd?.number);

  if (!toAdd) { console.log('All CSCE courses already added'); await context.close(); return; }

  // Try POST with Playwright's request context (has full cookie store)
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'RF-Token': rfToken,
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${BASE}/terms/${TERM_ENC}/courses`,
    'Origin': BASE,
  };

  // POST format from JS: { filterRules, number, subjectId, topic }
  const body = { filterRules: [], number: toAdd.number, subjectId: toAdd.subjectId, topic: toAdd.topic ?? null };

  console.log('\nTrying POST /desiredcourses with Playwright request context...');
  const r1 = await context.request.post(`${BASE}/api/terms/${TERM_ENC}/desiredcourses`, {
    headers,
    data: body,
  });
  console.log('Status:', r1.status());
  const r1text = await r1.text();
  console.log('Response:', r1text.slice(0, 300));

  // Try bulk-create
  console.log('\nTrying POST /desiredcourses/bulk-create...');
  const r2 = await context.request.post(`${BASE}/api/terms/${TERM_ENC}/desiredcourses/bulk-create`, {
    headers,
    data: [toAdd],
  });
  console.log('Status:', r2.status());
  console.log('Response:', (await r2.text()).slice(0, 300));

  // Also intercept the real app's requests by listening at network level
  // Try actually clicking the UI to see what requests are made
  console.log('\n\nSetting up route intercept and navigating UI...');

  const captured = [];
  await page.route('**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() !== 'GET' && url.includes('collegescheduler') && !url.includes('analytics')) {
      captured.push({
        method: req.method(),
        url: url.replace(BASE, ''),
        headers: req.headers(),
        body: req.postData()?.slice(0, 500),
      });
    }
    await route.continue();
  });

  // Navigate to courses, wait for app to fully load, interact with UI
  await page.goto(`${BASE}/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Try searching and adding via JS in-page
  const uiResult = await page.evaluate(async ({ termEnc, toAddId }) => {
    // Find and use the app's own HTTP client (angular/fetch wrapper)
    // Check window for any exposed APIs
    const keys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('http') ||
      k.toLowerCase().includes('axios') ||
      k.toLowerCase().includes('api')
    );
    return {
      windowKeys: keys,
      title: document.title,
      url: location.href,
    };
  }, { termEnc: TERM_ENC, toAddId: toAdd.id });

  console.log('\nUI page state:', JSON.stringify(uiResult, null, 2));

  console.log('\nAll captured non-GET requests:');
  captured.forEach(r => {
    console.log(`${r.method} ${r.url}`);
    const csrfHeaders = Object.entries(r.headers).filter(([k]) =>
      ['rf-token', 'requestverificationtoken', 'x-requested-with'].includes(k.toLowerCase())
    );
    if (csrfHeaders.length) console.log('  Auth headers:', csrfHeaders);
    if (r.body) console.log('  Body:', r.body.slice(0, 200));
  });

  await context.close();
})();
