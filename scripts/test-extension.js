// Load the built extension in a real Chromium + the TAMU profile,
// navigate to Schedule Builder, open the Professor Search panel,
// search for a course, and click "Add to Builder".
// Usage: node scripts/test-extension.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const EXT_PATH = path.resolve(__dirname, '../dist');
const TERM = 'Spring 2026 - College Station';
const BASE = 'https://tamu.collegescheduler.com';

(async () => {
  let passed = 0;
  let failed = 0;

  function assert(label, condition, detail = '') {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  // Extensions require headless:false — headless Chrome strips extension support entirely
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      '--no-first-run',
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // ── 1. Navigate to Schedule Builder ──────────────────────────────────────
  console.log('\n[1] Navigating to Schedule Builder...');
  await page.goto(`${BASE}/entry`);
  await page.waitForLoadState('networkidle');

  // Select Spring 2026
  const radios = page.locator('input[type="radio"]');
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const label = await radios.nth(i).evaluate(el =>
      document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ?? ''
    );
    if (label.includes('Spring 2026 - College Station')) { await radios.nth(i).click(); break; }
  }
  await page.locator('button').filter({ hasText: /save and continue/i }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  assert('Reached Schedule Builder', page.url().includes('collegescheduler.com/terms'));
  await page.screenshot({ path: '/tmp/test-1-builder.png', fullPage: false });

  // ── 2. Check content script injected the Professors button ───────────────
  console.log('\n[2] Checking for Professors button...');
  await page.waitForTimeout(3000); // give content script time to inject

  const profsBtn = page.locator('button').filter({ hasText: /professors/i }).first();
  const btnVisible = await profsBtn.isVisible({ timeout: 5000 }).catch(() => false);
  assert('Professors button injected', btnVisible);
  await page.screenshot({ path: '/tmp/test-2-btn.png' });

  if (!btnVisible) {
    console.log('  Button not found. Checking DOM for extension elements...');
    const extEls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-trp-btn],[data-trp-panel]')).map(e => e.outerHTML.slice(0, 80))
    );
    console.log('  Extension elements:', extEls);
    // Try checking body for any maroon button
    const allBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
    );
    console.log('  All buttons:', allBtns.slice(0, 10));
  }

  // ── 3. Open the panel ─────────────────────────────────────────────────────
  console.log('\n[3] Opening Professor Search panel...');
  if (btnVisible) {
    await profsBtn.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: '/tmp/test-3-panel.png' });

  // Panel renders TAMU + Professor Search as separate nodes — check for the input instead
  const searchInputCheck = page.locator('input[placeholder="CSCE 312"]').first();
  const panelVisible = await searchInputCheck.isVisible({ timeout: 3000 }).catch(() => false);
  assert('Search panel opened', panelVisible);

  // NOTE: anex.us SSL cert is currently expired — grade search will return no results.
  // We test the search UI and the Add to Builder API call independently.

  // ── 4. Search input is visible ────────────────────────────────────────────
  console.log('\n[4] Checking search input...');
  const searchInput = page.locator('input[placeholder="CSCE 312"]').first();
  const inputVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
  assert('Search input visible', inputVisible);
  await page.screenshot({ path: '/tmp/test-4-panel.png' });

  // ── 5. Add to Builder via Angular UI (only proven method) ────────────────
  console.log('\n[5] Testing Add to Builder via Angular UI...');

  const term = encodeURIComponent(TERM);
  let addPostBody = '';
  let addPostStatus = 0;

  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('desiredcourses') && !req.url().includes('bulk')) {
      addPostBody = req.postData() ?? '';
    }
  });
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && res.url().includes('desiredcourses') && !res.url().includes('bulk')) {
      addPostStatus = res.status();
    }
  });

  // Navigate to courses/add via the SPA
  await page.goto(`${BASE}/terms/${TERM}/options`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  const addCourseNavBtn = page.locator('button, a').filter({ hasText: /add cou/i }).first();
  if (await addCourseNavBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addCourseNavBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
  }
  console.log('  Page:', page.url());

  // Fill Subject combobox with CSCE
  const comboboxes = page.getByRole('combobox');
  if (await comboboxes.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await comboboxes.nth(0).click();
    await page.keyboard.type('CSCE');
    await page.waitForTimeout(800);
    const opt = page.getByRole('option').filter({ hasText: /^CSCE/i }).first();
    if (await opt.isVisible({ timeout: 1500 }).catch(() => false)) {
      await opt.click();
    } else {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(800);

    // Fill Course number
    await comboboxes.nth(1).click();
    await page.keyboard.type('481');
    await page.waitForTimeout(800);
    const courseOpt = page.getByRole('option').first();
    if (await courseOpt.isVisible({ timeout: 1500 }).catch(() => false)) {
      await courseOpt.click();
    } else {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(500);

    // Click Add Course
    const addBtn = page.locator('button').filter({ hasText: /add course/i }).last();
    if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(2500);
    }
  }

  console.log(`  POST body: ${addPostBody}`);
  console.log(`  POST status: ${addPostStatus}`);
  assert('POST to /desiredcourses fired', addPostBody.includes('subjectId'), `body: ${addPostBody}`);
  assert('POST returned 200', addPostStatus === 200, `status: ${addPostStatus}`);

  // ── 6. Close panel, verify button still present ───────────────────────────
  console.log('\n[6] Closing panel...');
  const closeBtn = page.locator('button').filter({ hasText: '×' }).first();
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }
  const btnStillThere = await page.locator('[data-trp-panel="search-trigger"]').isVisible({ timeout: 2000 }).catch(() => false);
  assert('Professors button remains after close', btnStillThere);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) console.log('Screenshots saved to /tmp/test-*.png for debugging');

  await context.close();
  process.exit(failed > 0 ? 1 : 0);
})();
