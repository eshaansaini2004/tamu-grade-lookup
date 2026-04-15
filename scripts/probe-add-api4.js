// Find CSRF token and correct desiredcourses POST format.
// Usage: node scripts/probe-add-api4.js

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

  // Capture response headers from API calls to find CSRF patterns
  const responseHeaders = {};
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('collegescheduler') && url.includes('/api/')) {
      const headers = res.headers();
      if (headers['x-csrf-token'] || headers['x-xsrf-token'] || headers['set-cookie']) {
        responseHeaders[url.split('/api/')[1].split('?')[0]] = {
          csrf: headers['x-csrf-token'] ?? headers['x-xsrf-token'],
          cookie: headers['set-cookie']?.slice(0, 100),
        };
      }
    }
  });

  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');

  const result = await page.evaluate(async ({ termEnc }) => {
    const out = {};

    // 1. Check what GET coursestatuses returns
    const r1 = await fetch(`/api/terms/${termEnc}/coursestatuses`, { credentials: 'include' });
    out.coursestatuses_status = r1.status;
    if (r1.ok) out.coursestatuses = (await r1.text()).slice(0, 400);

    // 2. Check cookies for CSRF tokens
    out.cookies = document.cookie.slice(0, 300);

    // 3. Check for meta CSRF tags
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="__RequestVerificationToken"]');
    out.metaCsrf = meta?.getAttribute('content') ?? null;

    // 4. Try GET desiredcourses to see response headers
    const r2 = await fetch(`/api/terms/${termEnc}/desiredcourses`, { credentials: 'include' });
    const headers2 = {};
    r2.headers.forEach((v, k) => { headers2[k] = v; });
    out.desiredcourses_headers = headers2;
    out.desiredcourses_sample = (await r2.text()).slice(0, 300);

    // 5. Check for Angular/verification tokens in the DOM
    const verToken = document.querySelector('input[name="__RequestVerificationToken"]');
    out.verToken = verToken?.value ?? null;

    // 6. Try POST with X-Requested-With header (common Angular requirement)
    const r3 = await fetch(`/api/terms/${termEnc}/desiredcourses`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify([{ id: 'CSCE|312' }]),
    });
    out.post_with_xrw = { status: r3.status, body: (await r3.text()).slice(0, 200) };

    // 7. Try POST with just the course ID string
    const r4 = await fetch(`/api/terms/${termEnc}/desiredcourses`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify('CSCE|312'),
    });
    out.post_string = { status: r4.status, body: (await r4.text()).slice(0, 200) };

    // 8. Try coursestatuses PUT without /selected
    const r5 = await fetch(`/api/terms/${termEnc}/coursestatuses/9689581`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ id: '9689581', subjectId: 'CSCE', number: '120' }),
    });
    out.coursestatuses_put = { status: r5.status, body: (await r5.text()).slice(0, 200) };

    return out;
  }, { termEnc: TERM_ENC });

  console.log('=== Results ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nResponse headers with CSRF:', JSON.stringify(responseHeaders, null, 2));

  await context.close();
})();
