// Select subject/course in the Add Courses form, click Add Course, capture request.
// Usage: node scripts/capture-add-course-final.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
const BASE = 'https://tamu.collegescheduler.com';

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-first-run'],
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  const captured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() !== 'GET' && url.includes('collegescheduler') && !url.includes('analytics') && !url.includes('saml')) {
      captured.push({
        method: req.method(),
        url: url.replace(BASE, ''),
        headers: req.headers(),
        body: req.postData()?.slice(0, 800),
      });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (req.method() !== 'GET' && req.url().includes('collegescheduler') && !req.url().includes('analytics')) {
      const entry = captured.find(c => req.url().replace(BASE, '') === c.url);
      if (entry && !entry.status) {
        entry.status = res.status();
        try { entry.response = (await res.text()).slice(0, 400); } catch {}
      }
    }
  });

  // Go to entry, select Spring 2026, save
  await page.goto(`${BASE}/entry`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const radios = page.locator('input[type="radio"]');
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const label = await radios.nth(i).evaluate(el => {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      return lbl?.textContent?.trim() ?? el.value;
    });
    if (label.includes('Spring 2026 - College Station')) {
      await radios.nth(i).click();
      break;
    }
  }
  await page.locator('button').filter({ hasText: /save and continue/i }).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click Add Course
  const addCourseBtn = page.locator('button, a').filter({ hasText: /add cou/i }).first();
  await addCourseBtn.click();
  await page.waitForTimeout(2000);

  console.log('URL:', page.url());
  await page.screenshot({ path: '/tmp/add-courses-form.png' });

  // Examine the DOM for React Select inputs
  const formInfo = await page.evaluate(() => {
    // React Select uses input elements with specific patterns
    const inputs = Array.from(document.querySelectorAll('input')).map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      placeholder: el.placeholder,
      value: el.value,
      className: el.className?.toString().slice(0, 60),
      parentClass: el.parentElement?.className?.toString().slice(0, 60),
    }));

    // Also find select elements and any div with role="combobox"
    const selects = Array.from(document.querySelectorAll('select, [role="combobox"], [role="listbox"]')).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      id: el.id,
      className: el.className?.toString().slice(0, 60),
      text: el.textContent?.trim().slice(0, 40),
    }));

    // Find the form
    const form = document.querySelector('form');
    const formHtml = form?.innerHTML?.slice(0, 500);

    return { inputs, selects: selects.slice(0, 10), formHtml };
  });

  console.log('\nInputs:', JSON.stringify(formInfo.inputs, null, 2));
  console.log('\nSelects/Comboboxes:', JSON.stringify(formInfo.selects, null, 2));

  // Try to interact with the Subject React Select
  // React Select inputs usually have id ending in "-input"
  const subjectInputs = formInfo.inputs.filter(i =>
    i.id?.includes('subject') || i.placeholder?.toLowerCase().includes('subject') || i.name?.includes('subject')
  );
  console.log('\nSubject-related inputs:', subjectInputs);

  // Click on the Subject dropdown container
  const subjectControl = page.locator('[id*="subject"], [class*="subject"], [id*="Subject"]').first();
  const courseControl = page.locator('[id*="course"], [class*="course"], [id*="Course"]').filter({ hasNotText: /add|button|csce/i }).first();

  // Try to type into subject React Select
  const subjectInput = page.locator('input[id*="subject"], input[id*="Subject"]').first();
  const courseInput = page.locator('input[id*="course"], input[id*="Course"]').first();

  // Click the containers to open dropdowns
  console.log('\nAttempting to interact with Subject select...');
  const subjectContainer = page.locator('.css-2b097c-container, [class*="select__control"]').first();
  await subjectContainer.click().catch(() => {});

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/subject-dropdown.png' });

  // Type CSCE
  await page.keyboard.type('CSCE');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/subject-typed.png' });

  // Look for CSCE option
  const csceOption = page.locator('[class*="option"]').filter({ hasText: 'CSCE' }).first();
  if (await csceOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await csceOption.click();
    console.log('Selected CSCE');
    await page.waitForTimeout(1000);
  }

  // Now fill in course number — find second select/input
  const allSelectInputs = page.locator('input[id$="-input"]');
  const selectInputCount = await allSelectInputs.count();
  console.log(`React Select inputs: ${selectInputCount}`);

  for (let i = 0; i < selectInputCount; i++) {
    const inp = allSelectInputs.nth(i);
    const id = await inp.getAttribute('id');
    console.log(`  Input ${i}: id="${id}"`);
  }

  // After subject is selected, the course number input should be available
  // Try clicking the second react-select
  const allContainers = page.locator('[class*="container"][class*="css"]');
  const containerCount = await allContainers.count();
  console.log(`Select containers: ${containerCount}`);

  if (containerCount >= 2) {
    await allContainers.nth(1).click();
    await page.waitForTimeout(500);
    await page.keyboard.type('110');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/course-typed.png' });

    const courseOption = page.locator('[class*="option"]').first();
    if (await courseOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await courseOption.click();
      console.log('Selected course');
      await page.waitForTimeout(500);
    }
  }

  await page.screenshot({ path: '/tmp/before-add-click.png' });

  // Click the actual Add Course button
  const addBtn = page.locator('button').filter({ hasText: /add course/i }).first();
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking Add Course button...');
    await addBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/after-final-add.png' });
  }

  console.log('\n=== Captured non-GET requests ===');
  if (captured.length === 0) {
    console.log('None captured.');
  } else {
    for (const r of captured) {
      console.log(`\n${r.method} ${r.url}`);
      const interestingH = Object.entries(r.headers).filter(([k]) =>
        ['rf-token', 'requestverificationtoken', 'x-requested-with', 'content-type', 'accept'].includes(k.toLowerCase())
      );
      console.log('  Key headers:', JSON.stringify(Object.fromEntries(interestingH)));
      if (r.body) console.log('  Body:', r.body);
      console.log('  Status:', r.status);
      if (r.response) console.log('  Response:', r.response.slice(0, 300));
    }
  }

  await context.close();
})();
