// Use the ASP.NET verification token to POST desiredcourses.
// Also search JS for exact desiredcourses write pattern.
// Usage: node scripts/probe-add-api5.js

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

  // 1. Search JS bundle for desiredcourses write operations
  const jsPatterns = await page.evaluate(async () => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    const results = [];
    for (const url of scripts) {
      if (!url.includes('dist')) continue;
      const r = await fetch(url);
      const text = await r.text();
      // Find 30-char windows around 'desiredcourses'
      let idx = 0;
      while ((idx = text.indexOf('desiredcourses', idx)) !== -1) {
        results.push(text.slice(Math.max(0, idx - 60), idx + 120));
        idx += 14;
      }
    }
    return results;
  });

  console.log('=== desiredcourses JS patterns ===');
  jsPatterns.forEach((p, i) => console.log(`\n[${i}] ${p}`));

  // 2. Try POST with the verification token
  const result = await page.evaluate(async ({ termEnc }) => {
    const out = {};

    // Get the anti-forgery token
    const verToken = document.querySelector('input[name="__RequestVerificationToken"]')?.value ?? '';
    out.hasToken = !!verToken;
    out.tokenSnippet = verToken.slice(0, 20);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'RequestVerificationToken': verToken,
      '__RequestVerificationToken': verToken,
    };

    // Get a valid course object from desiredcourses (so we know the shape)
    const existing = await fetch(`/api/terms/${termEnc}/desiredcourses`, { credentials: 'include' });
    const existingList = await existing.json();
    out.existing_count = existingList.length;
    out.sample_course = JSON.stringify(existingList[0]).slice(0, 200);

    // Try POSTing a new course — CSCE 312 (probably not in list)
    // First get its full object from the browse API
    const browseRes = await fetch(`/api/terms/${termEnc}/subjects/CSCE/courses`, { credentials: 'include' });
    const browseCourses = await browseRes.json();
    const csce312 = browseCourses.find(c => c.number === '312') ?? browseCourses.find(c => c.number === '110');
    out.adding_course = JSON.stringify(csce312).slice(0, 150);

    // Try several POST body formats with the token
    const attempts = [
      { label: 'array of full objects', body: [csce312] },
      { label: 'array of ids', body: [{ id: csce312.id }] },
      { label: 'single object', body: csce312 },
      { label: 'array of id strings', body: [csce312.id] },
    ];

    for (const a of attempts) {
      const r = await fetch(`/api/terms/${termEnc}/desiredcourses`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(a.body),
      });
      out[`post_${a.label}`] = { status: r.status, body: (await r.text()).slice(0, 150) };
    }

    // Also try PUT
    const rPut = await fetch(`/api/terms/${termEnc}/desiredcourses`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify([csce312]),
    });
    out.put_full_array = { status: rPut.status, body: (await rPut.text()).slice(0, 150) };

    // Try PATCH
    const rPatch = await fetch(`/api/terms/${termEnc}/desiredcourses`, {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify([{ id: csce312.id }]),
    });
    out.patch = { status: rPatch.status, body: (await rPatch.text()).slice(0, 150) };

    return out;
  }, { termEnc: TERM_ENC });

  console.log('\n=== Token + POST results ===');
  console.log(JSON.stringify(result, null, 2));

  await context.close();
})();
