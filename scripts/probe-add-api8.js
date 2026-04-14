// Add a course using the correct RF-Token header.
// Usage: node scripts/probe-add-api8.js

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

  const result = await page.evaluate(async ({ termEnc }) => {
    const out = {};

    const rfToken = document.getElementsByName('__RequestVerificationToken')[0]?.value ?? '';
    out.hasToken = !!rfToken;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'RF-Token': rfToken,
      'X-Requested-With': 'XMLHttpRequest',
    };

    // Get a course NOT already in desiredcourses
    const existing = await fetch(`/api/terms/${termEnc}/desiredcourses`, { credentials: 'include' });
    const existingList = await existing.json();
    const existingIds = new Set(existingList.map(c => `${c.subjectId}|${c.number}`));

    const browse = await fetch(`/api/terms/${termEnc}/subjects/CSCE/courses`, { credentials: 'include' });
    const browseCourses = await browse.json();
    const toAdd = browseCourses.find(c => !existingIds.has(c.id));
    out.adding = toAdd ? `${toAdd.subjectId} ${toAdd.number} (${toAdd.id})` : 'all already added';

    if (!toAdd) return out;

    // Pattern from JS: { filterRules, number, subjectId, topic }
    const body1 = { filterRules: [], number: toAdd.number, subjectId: toAdd.subjectId, topic: toAdd.topic ?? null };
    const r1 = await fetch(`/api/terms/${termEnc}/desiredcourses`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify(body1),
    });
    out.post_filterRules_format = { status: r1.status, body: (await r1.text()).slice(0, 200) };

    // bulk-create with array
    const r2 = await fetch(`/api/terms/${termEnc}/desiredcourses/bulk-create`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify([toAdd]),
    });
    out.bulk_create = { status: r2.status, body: (await r2.text()).slice(0, 200) };

    // bulk-create with just the id
    const r3 = await fetch(`/api/terms/${termEnc}/desiredcourses/bulk-create`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify([{ id: toAdd.id }]),
    });
    out.bulk_create_id_only = { status: r3.status, body: (await r3.text()).slice(0, 200) };

    // Try the section-add endpoint (seen in JS: PUT or DELETE with regNumber + subjectCode)
    // Pattern: method: artRemove?"DELETE":"PUT", sectionParameterValues, regNumber, subjectCode
    // Try various section URL patterns
    const crn = '46248'; // CSCE 110 section
    const sectionBody = { regNumber: crn, subjectCode: 'CSCE', sectionParameterValues: {}, registrationType: 'E' };

    const r4 = await fetch(`/api/terms/${termEnc}/sections`, {
      method: 'PUT', credentials: 'include', headers, body: JSON.stringify(sectionBody),
    });
    out.sections_put = { status: r4.status, body: (await r4.text()).slice(0, 200) };

    const r5 = await fetch(`/api/terms/${termEnc}/sections/${crn}`, {
      method: 'PUT', credentials: 'include', headers, body: JSON.stringify(sectionBody),
    });
    out.sections_put_with_crn = { status: r5.status, body: (await r5.text()).slice(0, 200) };

    return out;
  }, { termEnc: TERM_ENC });

  console.log(JSON.stringify(result, null, 2));

  await context.close();
})();
