// Content script — injected into tamu.collegescheduler.com

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { sendLookup } from '../shared/messages';
import type { PageStats } from '../shared/messages';
import type { GradeData, MeetingTime, RmpData, SavedSection } from '../shared/types';
import { storageGet, saveSection, removeSection } from '../shared/storage';
import { parseMeetingFromApi } from '../shared/conflictDetection';
import { gpaColorClass } from '../shared/gradeUtils';
import type { SeatData, SectionStatus } from '../shared/types';
import { mountPanel, rerenderPanel, unmountPanel } from './mount';
import SectionComparison, { type InstructorData } from './components/SectionComparison';
import CourseSearch from './components/CourseSearch';

const BADGE_ATTR = 'data-trp';

// ─── meeting time capture (regblocks fetch intercept) ─────────────────────────


const crnMeetings = new Map<string, MeetingTime[]>();
const crnSeats = new Map<string, SeatData>();

// Receive meeting + seat data relayed from the MAIN world interceptor (interceptor.ts)
window.addEventListener('message', (e) => {
  if (e.data?.type !== '__TRP_MEETINGS__') return;
  const meetings = (e.data.meetings ?? []) as { daysRaw: string; startTime: number; endTime: number; location?: string }[];
  const times = meetings.map(parseMeetingFromApi);
  if (times.length) crnMeetings.set(String(e.data.crn), times);

  const crn = String(e.data.crn);
  const seatData: SeatData = {
    openSeats: e.data.openSeats,
    totalSeats: e.data.totalSeats,
    waitlistCount: e.data.waitlistCount,
  };
  // Warn if all seat fields are missing — likely means API field names changed
  if (seatData.openSeats === undefined && seatData.totalSeats === undefined && seatData.waitlistCount === undefined) {
    console.warn('[TRP] No seat data in regblocks for CRN', crn, '— field names may have changed');
  }
  crnSeats.set(crn, seatData);

  // Inject/update status badge now that we have seat data
  for (const tbody of document.querySelectorAll('tbody')) {
    if (getCrnFromTbody(tbody) === crn) {
      injectStatusBadge(tbody, crn);
      break;
    }
  }
});

// ─── course-level tracking ────────────────────────────────────────────────────
// courseKey → Map<instructorName, InstructorData>
const courseInstructors = new Map<string, Map<string, InstructorData>>();
// courseKey → anchor element (table element to inject panel before)
const courseAnchors = new Map<string, Element>();

function getCourseKey(dept: string, number: string) {
  return `${dept}_${number}`;
}

// ─── Phase 2: Pick Best tracking ──────────────────────────────────────────────
const sectionGrades = new Map<Element, { instructorName: string; gradeData: GradeData | null }>();
let pickBestDebounce: ReturnType<typeof setTimeout> | null = null;

function schedulePickBest() {
  if (pickBestDebounce) clearTimeout(pickBestDebounce);
  pickBestDebounce = setTimeout(updatePickBest, 400);
}

function getCrnFromTbody(tbody: Element): string | null {
  const cb = tbody.querySelector('input[id^="checkbox_"]');
  if (cb) return cb.id.replace('checkbox_', '');
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return null;
  for (const td of firstRow.querySelectorAll('td')) {
    if (/^\d{5}$/.test(td.textContent?.trim() ?? '')) return td.textContent!.trim();
  }
  return null;
}

function setChecked(cb: HTMLInputElement, checked: boolean) {
  if (cb.checked !== checked) cb.click();
}

function updatePickBest() {
  for (const tbody of sectionGrades.keys()) {
    if (!document.contains(tbody)) sectionGrades.delete(tbody);
  }

  const byInstructor = new Map<string, { gradeData: GradeData; tbodies: Element[] }>();
  for (const [tbody, { instructorName, gradeData }] of sectionGrades) {
    if (!gradeData) continue;
    if (!byInstructor.has(instructorName)) {
      byInstructor.set(instructorName, { gradeData, tbodies: [] });
    }
    byInstructor.get(instructorName)!.tbodies.push(tbody);
  }

  if (byInstructor.size < 2) return;

  const [bestName, bestData] = [...byInstructor.entries()].reduce((a, b) =>
    a[1].gradeData.avgGpa >= b[1].gradeData.avgGpa ? a : b,
  );

  const firstTbody = [...sectionGrades.keys()][0];
  const table = firstTbody?.closest('table');
  if (!table) return;

  table.parentNode?.querySelector('.trp-pick-best-wrap')?.remove();

  const wrap = document.createElement('div');
  wrap.className = 'trp-pick-best-wrap';

  const btn = document.createElement('button');
  btn.className = 'trp-pick-best';
  btn.textContent = `★ Pick Best Instructor: ${bestName} · GPA ${bestData.gradeData.avgGpa.toFixed(2)}`;

  btn.addEventListener('click', () => {
    document.querySelectorAll<HTMLInputElement>('input[id^="checkbox_"]').forEach((cb) => setChecked(cb, false));
    for (const tbody of bestData.tbodies) {
      const crn = getCrnFromTbody(tbody);
      if (!crn) continue;
      const cb = document.getElementById(`checkbox_${crn}`) as HTMLInputElement | null;
      if (cb) setChecked(cb, true);
    }
  });

  wrap.appendChild(btn);
  table.before(wrap);
}

// ─── comparison panel ─────────────────────────────────────────────────────────

function scheduleCompareUpdate(courseKey: string) {
  // Debounce so we don't re-render on every single instructor that loads
  setTimeout(() => updateComparePanel(courseKey), 500);
}

function updateComparePanel(courseKey: string) {
  const instructors = courseInstructors.get(courseKey);
  const anchor = courseAnchors.get(courseKey);
  if (!instructors || !anchor || instructors.size < 2) return;

  const instructorList = [...instructors.values()];
  const [dept, number] = courseKey.split('_');
  const course = `${dept} ${number}`;

  // If panel doesn't exist yet, inject it; otherwise re-render by unmounting + remounting
  const panelKey = `compare_${courseKey}`;
  const renderFn = () =>
    createElement(SectionComparison, {
      course,
      instructors: instructorList,
      onClose: () => unmountPanel(panelKey),
    });

  if (!rerenderPanel(panelKey, renderFn)) {
    mountPanel(panelKey, anchor, 'before', renderFn);
  }
}

// ─── instructor detection ─────────────────────────────────────────────────────

function findInstructorLis(root: Element | Document): Element[] {
  return [...root.querySelectorAll('li')].filter((li) => {
    const strong = li.querySelector('strong');
    return strong && strong.textContent?.trim().replace(/:$/, '').trim() === 'Instructor';
  });
}

function getNameSpan(li: Element): Element | null {
  return [...li.children].find((el) => el.tagName === 'SPAN') ?? null;
}

function getCourseFromLi(li: Element): { dept: string; number: string } | null {
  const tbody = li.closest('tbody');
  if (!tbody) return null;
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return null;
  const tds = [...firstRow.querySelectorAll('td')];

  for (let i = 0; i < tds.length - 1; i++) {
    const dept = tds[i].textContent?.trim() ?? '';
    const number = tds[i + 1].textContent?.trim() ?? '';
    if (/^[A-Z]{2,4}$/.test(dept) && /^\d{3}$/.test(number)) {
      return { dept, number };
    }
  }
  return null;
}

// ─── badge injection ──────────────────────────────────────────────────────────

function buildTooltip(gradeData: GradeData | null, rmpData: RmpData | null): string {
  let html = '';

  if (gradeData) {
    const bars = [
      { label: 'A', pct: gradeData.pctA, cls: 'trp-bar-a' },
      { label: 'B', pct: gradeData.pctB, cls: 'trp-bar-b' },
      { label: 'C', pct: gradeData.pctC, cls: 'trp-bar-c' },
      { label: 'D', pct: gradeData.pctD, cls: 'trp-bar-d' },
      { label: 'F', pct: gradeData.pctF, cls: 'trp-bar-f' },
    ];
    html += bars
      .map(
        (b) => `
      <div class="trp-bar-row">
        <span class="trp-bar-label">${b.label}</span>
        <div class="trp-bar-track"><div class="trp-bar-fill ${b.cls}" style="width:${b.pct}%"></div></div>
        <span class="trp-bar-pct">${b.pct}%</span>
      </div>`,
      )
      .join('');
    html += `<div class="trp-meta">GPA ${gradeData.avgGpa.toFixed(2)} · ${gradeData.semCount} semester${gradeData.semCount !== 1 ? 's' : ''}</div>`;
  }

  if (rmpData) {
    html += `<div class="trp-meta">RMP: ${rmpData.rating.toFixed(1)}/5 (${rmpData.count} ratings)</div>`;
  }

  return html || 'No data available';
}

function injectBadge(nameSpan: Element, gradeData: GradeData | null, rmpData: RmpData | null) {
  if ((nameSpan.nextElementSibling as HTMLElement | null)?.hasAttribute(BADGE_ATTR)) return;

  const badge = document.createElement('span');
  badge.setAttribute(BADGE_ATTR, '1');

  if (!gradeData && !rmpData) {
    badge.className = 'trp-badge trp-no-data';
    badge.textContent = 'No data';
  } else {
    const gpa = gradeData?.avgGpa != null ? gradeData.avgGpa.toFixed(2) : '—';
    const pctA = gradeData?.pctA ?? '—';
    const rmp = rmpData?.rating ?? null;
    const colorClass = gpaColorClass(gradeData?.avgGpa);

    badge.className = `trp-badge ${colorClass}`;
    badge.innerHTML = `
      <span class="trp-pill">GPA&nbsp;${gpa}&nbsp; A:${pctA}%${rmp != null ? `&nbsp;<span class="trp-rmp">★${rmp.toFixed(1)}</span>` : ''}</span>
      <span class="trp-tooltip">${buildTooltip(gradeData, rmpData)}</span>
    `;
  }

  nameSpan.after(badge);
}

// ─── per-element processing ───────────────────────────────────────────────────

function processLi(li: Element) {
  const nameSpan = getNameSpan(li);
  if (!nameSpan) return;

  const instructorName = nameSpan.textContent?.trim() ?? '';
  if (!instructorName || instructorName === 'Not Assigned' || instructorName === 'TBA') return;

  if ((nameSpan.nextElementSibling as HTMLElement | null)?.hasAttribute(BADGE_ATTR)) return;

  const ctx = getCourseFromLi(li);
  if (!ctx) return;

  const pending = document.createElement('span');
  pending.setAttribute(BADGE_ATTR, 'pending');
  pending.className = 'trp-badge trp-loading';
  pending.textContent = '…';
  nameSpan.after(pending);

  const tbody = li.closest('tbody');
  const courseKey = getCourseKey(ctx.dept, ctx.number);

  // Register anchor (table) for this course if not yet set
  if (!courseAnchors.has(courseKey)) {
    const table = tbody?.closest('table');
    if (table) courseAnchors.set(courseKey, table);
  }

  sendLookup(ctx.dept, ctx.number, instructorName).then((response) => {
    pending.remove();
    injectBadge(nameSpan, response.gradeData, response.rmpData);

    // Track for Pick Best + inject save button
    if (tbody) {
      sectionGrades.set(tbody, { instructorName, gradeData: response.gradeData });
      schedulePickBest();

      const crn = getCrnFromTbody(tbody);
      if (crn) {
        const section: SavedSection = {
          crn,
          dept: ctx.dept,
          courseNumber: ctx.number,
          sectionNumber: scrapeSectionNumber(tbody),
          instructorName,
          credits: scrapeCredits(tbody),
          meetingTimes: crnMeetings.get(crn) ?? [],
          gradeData: response.gradeData,
          rmpData: response.rmpData,
          addedAt: 0, // set at save time
        };
        injectSaveButton(tbody, section);
      }
    }

    // Track for comparison panel
    if (!courseInstructors.has(courseKey)) {
      courseInstructors.set(courseKey, new Map());
    }
    const existing = courseInstructors.get(courseKey)!;
    if (!existing.has(instructorName)) {
      existing.set(instructorName, { name: instructorName, gradeData: response.gradeData, rmpData: response.rmpData });
      scheduleCompareUpdate(courseKey);
    }
  });
}

// ─── section scraping ─────────────────────────────────────────────────────────

function scrapeSectionNumber(tbody: Element): string {
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return '';
  const tds = [...firstRow.querySelectorAll('td')];
  let pastDept = false;
  let pastCourseNum = false;
  for (const td of tds) {
    const text = td.textContent?.trim() ?? '';
    if (/^[A-Z]{2,4}$/.test(text)) { pastDept = true; continue; }
    if (pastDept && !pastCourseNum && /^\d{3}$/.test(text)) { pastCourseNum = true; continue; }
    if (pastCourseNum && /^\d{3}$/.test(text)) return text;
  }
  return '';
}

function scrapeCredits(tbody: Element): number {
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return 0;
  for (const td of firstRow.querySelectorAll('td')) {
    const text = td.textContent?.trim() ?? '';
    const n = parseFloat(text);
    if (!isNaN(n) && n >= 1 && n <= 6 && /^\d(\.\d)?$/.test(text)) return n;
  }
  return 0;
}

// ─── save button ──────────────────────────────────────────────────────────────

const SAVE_ATTR = 'data-trp-save';

async function injectSaveButton(tbody: Element, section: SavedSection) {
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return;
  const firstTd = firstRow.querySelector('td');
  if (!firstTd || firstTd.querySelector(`[${SAVE_ATTR}]`)) return;

  const btn = document.createElement('button');
  btn.setAttribute(SAVE_ATTR, section.crn);
  btn.title = 'Save section';
  btn.className = 'trp-save-btn';
  btn.textContent = '☆';
  firstTd.appendChild(btn); // claim the slot before any await

  const saved = await storageGet('savedSections');
  const setSaved = (on: boolean) => {
    btn.textContent = on ? '★' : '☆';
    btn.className = on ? 'trp-save-btn trp-saved' : 'trp-save-btn';
  };
  setSaved(section.crn in saved);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const current = await storageGet('savedSections');
    if (section.crn in current) {
      await removeSection(section.crn);
      setSaved(false);
    } else {
      await saveSection({ ...section, addedAt: Date.now(), meetingTimes: crnMeetings.get(section.crn) ?? section.meetingTimes });
      setSaved(true);
    }
  });
}

// ─── section status badges ────────────────────────────────────────────────────

const STATUS_ATTR = 'data-trp-status';

function sectionStatus(seats: SeatData): SectionStatus {
  if (seats.openSeats === undefined) return 'CLOSED'; // unknown — default to closed
  if (seats.openSeats > 0) return 'OPEN';
  if ((seats.waitlistCount ?? 0) > 0) return 'WAITLISTED';
  return 'CLOSED';
}

function injectStatusBadge(tbody: Element, crn: string) {
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return;

  // Find the CRN cell
  let crnTd: Element | null = null;
  for (const td of firstRow.querySelectorAll('td')) {
    if (/^\d{5}$/.test(td.textContent?.trim() ?? '')) { crnTd = td; break; }
  }
  if (!crnTd) return;

  const seats = crnSeats.get(crn);
  if (!seats) return;

  // Remove stale badge before re-injecting (e.g., after a manual refresh)
  crnTd.querySelector(`[${STATUS_ATTR}]`)?.remove();

  const status = sectionStatus(seats);
  const badge = document.createElement('span');
  badge.setAttribute(STATUS_ATTR, status);
  badge.className = `trp-status-badge trp-status-${status.toLowerCase()}`;
  badge.textContent = status;
  crnTd.appendChild(badge);
}

// ─── CRN copy buttons ─────────────────────────────────────────────────────────

const COPY_ATTR = 'data-trp-copy';

function injectCrnCopyButton(tbody: Element) {
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return;
  for (const td of firstRow.querySelectorAll('td')) {
    const crn = td.textContent?.trim() ?? '';
    if (!/^\d{5}$/.test(crn)) continue;
    if (td.querySelector(`[${COPY_ATTR}]`)) return; // already injected

    const btn = document.createElement('button');
    btn.setAttribute(COPY_ATTR, '1');
    btn.className = 'trp-copy-btn';
    btn.title = 'Copy CRN';
    btn.textContent = '⧉';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(crn).then(() => {
        btn.textContent = '✓';
        btn.classList.add('trp-copy-ok');
        setTimeout(() => {
          btn.textContent = '⧉';
          btn.classList.remove('trp-copy-ok');
        }, 1200);
      }).catch(() => {});
    });

    td.appendChild(btn);
    return;
  }
}

// ─── DOM scanning ─────────────────────────────────────────────────────────────

function scanNode(root: Element | Document) {
  for (const li of findInstructorLis(root)) {
    processLi(li);
  }
  // Inject CRN copy buttons and status badges on all tbodies in scope
  const tbodyRoot = root instanceof Document ? document.body : root;
  for (const tbody of tbodyRoot.querySelectorAll('tbody')) {
    injectCrnCopyButton(tbody);
    const crn = getCrnFromTbody(tbody);
    if (crn) injectStatusBadge(tbody, crn);
  }
}

// ─── mutation observer ────────────────────────────────────────────────────────

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      // Skip our own injected panels
      if ((el as HTMLElement).dataset?.trpPanel) continue;
      const found = findInstructorLis(el);
      if (found.length) console.log('[TRP] observer found', found.length, 'instructor li(s) in new node');
      scanNode(el);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
scanNode(document);

// ─── popup message handler ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_STATS') {
    let gpaMin: number | null = null;
    let gpaMax: number | null = null;
    let instructorCount = 0;

    for (const instructors of courseInstructors.values()) {
      for (const { gradeData } of instructors.values()) {
        instructorCount++;
        if (gradeData != null) {
          gpaMin = gpaMin == null ? gradeData.avgGpa : Math.min(gpaMin, gradeData.avgGpa);
          gpaMax = gpaMax == null ? gradeData.avgGpa : Math.max(gpaMax, gradeData.avgGpa);
        }
      }
    }

    sendResponse({
      sectionCount: sectionGrades.size,
      instructorCount,
      courseCount: courseInstructors.size,
      gpaMin,
      gpaMax,
    } satisfies PageStats);

    return true;
  }

  return false;
});

console.log('[TRP] content script loaded on', location.href);
console.log('[TRP] instructor <li>s found on initial scan:', findInstructorLis(document).length);

// Store session data so popup can make authenticated API calls without the page open
(function storeSessionData() {
  const m = location.pathname.match(/\/terms\/([^/]+)\//);
  if (m) chrome.storage.local.set({ currentTerm: decodeURIComponent(m[1]) });

  // RF-Token is ASP.NET's anti-forgery token — background SW includes it on POSTs
  const el = document.querySelector<HTMLInputElement>('input[name="__RequestVerificationToken"]');
  if (el?.value) chrome.storage.local.set({ rfToken: el.value });
})();

// ─── floating course search panel ─────────────────────────────────────────────

(function mountSearchPanel() {
  // Floating toggle button
  const btn = document.createElement('button');
  btn.dataset.trpPanel = 'search-trigger';
  btn.textContent = '🔍 Professors';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '999998',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: '700',
    background: '#500000',
    color: '#f9fafb',
    border: 'none',
    borderRadius: '20px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });
  document.body.appendChild(btn);

  // Mount directly into body (no shadow DOM) so position:fixed is relative to viewport.
  // Shadow DOM containers can create new stacking contexts that break fixed positioning.
  const container = document.createElement('div');
  container.dataset.trpPanel = 'search-panel';
  document.body.appendChild(container);
  const root = createRoot(container);

  let open = false;

  function render() {
    if (open) {
      root.render(createElement(CourseSearch, { onClose: () => { open = false; render(); } }));
    } else {
      root.render(null);
    }
  }

  btn.addEventListener('click', () => { open = !open; render(); });
})();
