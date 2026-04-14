// Find term internal ID and how the app sends CSRF tokens in axios interceptors.
// Usage: node scripts/probe-add-api7.js

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

  // Capture ALL requests including headers
  const nonGetCaptured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('collegescheduler') && req.method() !== 'GET' && !url.includes('analytics') && !url.includes('saml')) {
      nonGetCaptured.push({
        method: req.method(),
        url: url.replace('https://tamu.collegescheduler.com', ''),
        headers: req.headers(),
        body: req.postData()?.slice(0, 600),
      });
    }
  });

  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');

  // Wait for Angular to fully boot
  await page.waitForFunction(() => window.angular !== undefined || document.querySelector('[ng-app], [data-ng-app]') !== null || document.querySelector('.courses-container, [class*="course"]') !== null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const result = await page.evaluate(async ({ termEnc }) => {
    const out = {};

    // Get term-data to find the term's internal structure
    const r = await fetch(`/api/term-data/${termEnc}`, { credentials: 'include' });
    const j = await r.json();
    out.termdata_userTermContext = j.userTermContext;
    out.termdata_selectedCareer = j.selectedCareer;

    // The JS uses Object(I.k)(c.id) where c is the term — look for term ID in the data
    // Try to get the terms list to find the internal term ID
    const r2 = await fetch('/api/terms', { credentials: 'include' });
    const termsText = await r2.text();
    out.terms_status = r2.status;
    out.terms_sample = termsText.slice(0, 400);

    // Check for angular $http default headers (how they set the CSRF)
    out.metaTags = Array.from(document.querySelectorAll('meta')).map(m => ({ name: m.name, content: m.content?.slice(0, 50) })).filter(m => m.name || m.content);
    out.verToken = document.querySelector('input[name="__RequestVerificationToken"]')?.value?.slice(0, 30);

    // Check cookies visible to JS
    out.cookies = document.cookie;

    // Check if there's an Angular http service we can intercept
    // Look for the axios/http client in the bundle
    out.hasAngular = typeof window.angular !== 'undefined';

    return out;
  }, { termEnc: TERM_ENC });

  console.log('=== Term context ===');
  console.log(JSON.stringify(result, null, 2));

  // Search JS bundle for axios/http interceptor patterns
  const interceptorPatterns = await page.evaluate(async () => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    const results = [];
    for (const url of scripts) {
      if (!url.includes('dist')) continue;
      const r = await fetch(url);
      const text = await r.text();
      // Look for header setting patterns
      const patterns = [
        'RequestVerificationToken',
        'defaults.headers',
        'interceptors.request',
        'X-CSRF',
        'antiforgery',
      ];
      for (const p of patterns) {
        let idx = 0;
        while ((idx = text.toLowerCase().indexOf(p.toLowerCase(), idx)) !== -1) {
          results.push({ pattern: p, ctx: text.slice(Math.max(0, idx - 40), idx + 100) });
          idx += p.length;
          if (results.filter(r => r.pattern === p).length > 3) break;
        }
      }
    }
    return results;
  });

  console.log('\n=== Interceptor/CSRF patterns in JS ===');
  interceptorPatterns.forEach(p => console.log(`\n[${p.pattern}] ${p.ctx}`));

  console.log('\n=== Non-GET requests during page load ===');
  nonGetCaptured.forEach(r => {
    console.log(`${r.method} ${r.url}`);
    if (r.body) console.log('  Body:', r.body.slice(0, 100));
    const csrfHeaders = Object.entries(r.headers).filter(([k]) => k.toLowerCase().includes('token') || k.toLowerCase().includes('csrf') || k.toLowerCase().includes('verification'));
    if (csrfHeaders.length) console.log('  CSRF headers:', csrfHeaders);
  });

  await context.close();
})();
