// Verify the fix: background SW fetch with X-XSRF-Token header.
// Simulates what background/index.ts ADD_COURSE_TO_BUILDER does:
//   1. GET /entry to get X-XSRF-Token (background SW uses fetch with credentials:include)
//   2. POST /desiredcourses with that header
// Run: node scripts/verify-add-course.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Fall 2026 - College Station';
const TERM_ENC = encodeURIComponent(TERM);
const BASE = 'https://tamu.collegescheduler.com';
const DEPT = 'CSCE';

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-first-run'],
  });
  const page = await context.newPage();

  // Navigate so cookies are live
  await page.goto(`${BASE}/entry`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  console.log('At:', page.url());

  // ── Extract X-XSRF-Token from DOM (simulating fetchXsrfToken's HTML parse) ─
  const xsrfToken = await page.evaluate(() =>
    document.querySelector('input[name="__RequestVerificationToken"]')?.value ?? null
  );
  console.log('X-XSRF-Token:', xsrfToken ? `${xsrfToken.slice(0, 20)}... (${xsrfToken.length} chars)` : 'NOT FOUND');

  // ── Pick a test course ──────────────────────────────────────────────────────
  const desiredRes = await context.request.get(`${BASE}/api/terms/${TERM_ENC}/desiredcourses`);
  console.log('GET desiredcourses status:', desiredRes.status());
  const desired = desiredRes.ok() ? await desiredRes.json() : [];
  const existingSet = new Set(desired.map(c => `${c.subjectId}|${c.number}`));
  let testCourse = null;
  for (const n of ['121','181','221','312','313','315','320','420','430','440','450','460']) {
    if (!existingSet.has(`${DEPT}|${n}`)) { testCourse = n; break; }
  }
  if (!testCourse) { console.log('All test courses already added'); await context.close(); return; }
  console.log('Test course:', DEPT, testCourse);

  // ── POST with X-XSRF-Token — exact headers used by background SW ───────────
  console.log('\n=== POST /desiredcourses with X-XSRF-Token ===');
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(xsrfToken ? { 'X-XSRF-Token': xsrfToken } : {}),
  };

  const postRes = await context.request.post(`${BASE}/api/terms/${TERM_ENC}/desiredcourses`, {
    headers,
    data: { number: testCourse, subjectId: DEPT, topic: null },
  });
  console.log('Status:', postRes.status());
  const postText = await postRes.text();
  console.log('Response:', postText.slice(0, 300));

  if (postRes.ok()) {
    const course = JSON.parse(postText);
    console.log('\n✓ SUCCESS — Course ID:', course.id);

    // Clean up
    if (course.id) {
      const del = await context.request.delete(`${BASE}/api/terms/${TERM_ENC}/desiredcourses/${course.id}`, { headers });
      console.log('Cleanup DELETE status:', del.status());
    }
  }

  await context.close();
})();
