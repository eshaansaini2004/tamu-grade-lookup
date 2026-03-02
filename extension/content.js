// content.js — injected into tamu.collegescheduler.com
// Finds instructor <li> elements and injects grade badges.
//
// DOM structure (confirmed from live page):
//   <tbody class="css-1c24da2-groupCss">       ← one per section
//     <tr> <td>checkbox</td> <td>btn</td> <td>CRN</td> <td>CSCE</td> <td>120</td> ... </tr>
//     ... (flags/restrictions rows) ...
//     <tr><td colspan="10"><ul><li>
//       <strong><span>Instructor</span>: </strong>
//       <span>Carlisle, Martin</span>           ← injection point
//     </li></ul></td></tr>
//   </tbody>

const BADGE_ATTR = 'data-trp';

// ─── Phase 2: Pick Best tracking ──────────────────────────────────────────────

// tbody → { instructorName, gradeData }
const sectionGrades = new Map();
let pickBestDebounce = null;

function schedulePickBest() {
  clearTimeout(pickBestDebounce);
  pickBestDebounce = setTimeout(updatePickBest, 400);
}

function getCrnFromTbody(tbody) {
  // Most reliable: grab the CRN from the checkbox id="checkbox_CRN"
  const cb = tbody.querySelector('input[id^="checkbox_"]');
  if (cb) return cb.id.replace('checkbox_', '');
  // Fallback: find a <td> whose text is a bare 5-digit number
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return null;
  for (const td of firstRow.querySelectorAll('td')) {
    if (/^\d{5}$/.test(td.textContent.trim())) return td.textContent.trim();
  }
  return null;
}

function setChecked(cb, checked) {
  if (cb.checked !== checked) cb.click();
}

function updatePickBest() {
  // Drop stale entries for tbodies no longer in DOM
  for (const tbody of sectionGrades.keys()) {
    if (!document.contains(tbody)) sectionGrades.delete(tbody);
  }

  // Build per-instructor groups (only entries with grade data)
  const byInstructor = new Map();
  for (const [tbody, { instructorName, gradeData }] of sectionGrades) {
    if (!gradeData) continue;
    if (!byInstructor.has(instructorName)) {
      byInstructor.set(instructorName, { gradeData, tbodies: [] });
    }
    byInstructor.get(instructorName).tbodies.push(tbody);
  }

  // Only useful when there's a real choice
  if (byInstructor.size < 2) return;

  const [bestName, bestData] = [...byInstructor.entries()].reduce((a, b) =>
    a[1].gradeData.avgGpa >= b[1].gradeData.avgGpa ? a : b
  );

  // Find injection point: before the sections table
  const firstTbody = [...sectionGrades.keys()][0];
  const table = firstTbody?.closest('table');
  if (!table) return;

  // Remove stale button
  table.parentNode?.querySelector('.trp-pick-best-wrap')?.remove();

  const wrap = document.createElement('div');
  wrap.className = 'trp-pick-best-wrap';

  const btn = document.createElement('button');
  btn.className = 'trp-pick-best';
  btn.textContent = `★ Pick Best Instructor: ${bestName} · GPA ${bestData.gradeData.avgGpa.toFixed(2)}`;

  btn.addEventListener('click', () => {
    // Uncheck everything first
    document.querySelectorAll('input[id^="checkbox_"]').forEach(cb => setChecked(cb, false));
    // Check only best instructor's sections
    for (const tbody of bestData.tbodies) {
      const crn = getCrnFromTbody(tbody);
      if (!crn) continue;
      const cb = document.getElementById(`checkbox_${crn}`);
      if (cb) setChecked(cb, true);
    }
  });

  wrap.appendChild(btn);
  table.before(wrap);
}

// ─── instructor detection ─────────────────────────────────────────────────────

// Find all <li> elements that label an instructor.
// Handles both <strong><span>Instructor</span>: </strong> and <strong>Instructor: </strong>
function findInstructorLis(root) {
  return [...root.querySelectorAll('li')].filter(li => {
    const strong = li.querySelector('strong');
    return strong && strong.textContent.trim().replace(/:$/, '').trim() === 'Instructor';
  });
}

// Get the instructor name span (direct <span> child of <li>, not inside <strong>)
function getNameSpan(li) {
  return [...li.children].find(el => el.tagName === 'SPAN') || null;
}

// Get dept and course from the section's <tbody>
function getCourseFromLi(li) {
  const tbody = li.closest('tbody');
  if (!tbody) return null;
  const firstRow = tbody.querySelector('tr');
  if (!firstRow) return null;
  const tds = [...firstRow.querySelectorAll('td')];

  // Find first adjacent pair matching [A-Z]{2,4} then \d{3}
  // Works for both home page (has extra "Enrolled" column) and section list
  for (let i = 0; i < tds.length - 1; i++) {
    const dept = tds[i].textContent.trim();
    const number = tds[i + 1].textContent.trim();
    if (/^[A-Z]{2,4}$/.test(dept) && /^\d{3}$/.test(number)) {
      return { dept, number };
    }
  }
  return null;
}

// ─── badge injection ──────────────────────────────────────────────────────────

function injectBadge(nameSpan, gradeData, rmpData) {
  // Don't double-inject
  if (nameSpan.nextElementSibling?.hasAttribute(BADGE_ATTR)) return;

  const badge = document.createElement('span');
  badge.setAttribute(BADGE_ATTR, '1');

  if (!gradeData && !rmpData) {
    badge.className = 'trp-badge trp-no-data';
    badge.textContent = 'No data';
  } else {
    const gpa = gradeData?.avgGpa != null ? gradeData.avgGpa.toFixed(2) : '—';
    const pctA = gradeData?.pctA ?? '—';
    const rmp = rmpData?.rating ?? null;

    let colorClass = 'trp-gpa-gray';
    if (gradeData?.avgGpa != null) {
      if (gradeData.avgGpa >= 3.5) colorClass = 'trp-gpa-green';
      else if (gradeData.avgGpa >= 2.5) colorClass = 'trp-gpa-yellow';
      else colorClass = 'trp-gpa-red';
    }

    badge.className = `trp-badge ${colorClass}`;
    badge.innerHTML = `
      <span class="trp-pill">GPA&nbsp;${gpa}&nbsp; A:${pctA}%${rmp != null ? `&nbsp;<span class="trp-rmp">★${rmp.toFixed(1)}</span>` : ''}</span>
      <span class="trp-tooltip">${buildTooltip(gradeData, rmpData)}</span>
    `;
  }

  nameSpan.after(badge);
}

function buildTooltip(gradeData, rmpData) {
  let html = '';

  if (gradeData) {
    const bars = [
      { label: 'A', pct: gradeData.pctA, cls: 'trp-bar-a' },
      { label: 'B', pct: gradeData.pctB, cls: 'trp-bar-b' },
      { label: 'C', pct: gradeData.pctC, cls: 'trp-bar-c' },
      { label: 'D', pct: gradeData.pctD, cls: 'trp-bar-d' },
      { label: 'F', pct: gradeData.pctF, cls: 'trp-bar-f' },
    ];
    html += bars.map(b => `
      <div class="trp-bar-row">
        <span class="trp-bar-label">${b.label}</span>
        <div class="trp-bar-track"><div class="trp-bar-fill ${b.cls}" style="width:${b.pct}%"></div></div>
        <span class="trp-bar-pct">${b.pct}%</span>
      </div>`).join('');
    html += `<div class="trp-meta">GPA ${gradeData.avgGpa.toFixed(2)} · ${gradeData.semCount} semester${gradeData.semCount !== 1 ? 's' : ''}</div>`;
  }

  if (rmpData) {
    html += `<div class="trp-meta">RMP: ${rmpData.rating.toFixed(1)}/5 (${rmpData.count} ratings)</div>`;
  }

  return html || 'No data available';
}

// ─── per-element processing ───────────────────────────────────────────────────

function processLi(li) {
  const nameSpan = getNameSpan(li);
  if (!nameSpan) return;

  const instructorName = nameSpan.textContent.trim();
  if (!instructorName || instructorName === 'Not Assigned' || instructorName === 'TBA') return;

  // Skip if already injected or pending
  if (nameSpan.nextElementSibling?.hasAttribute(BADGE_ATTR)) return;

  const ctx = getCourseFromLi(li);
  if (!ctx) return;

  // Pending placeholder
  const pending = document.createElement('span');
  pending.setAttribute(BADGE_ATTR, 'pending');
  pending.className = 'trp-badge trp-loading';
  pending.textContent = '…';
  nameSpan.after(pending);

  const tbody = li.closest('tbody');

  chrome.runtime.sendMessage(
    { type: 'LOOKUP', dept: ctx.dept, number: ctx.number, instructorName },
    (response) => {
      pending.remove();
      if (chrome.runtime.lastError || !response) return;
      injectBadge(nameSpan, response.gradeData, response.rmpData);

      // Phase 2: track for Pick Best
      if (tbody) {
        sectionGrades.set(tbody, { instructorName, gradeData: response.gradeData });
        schedulePickBest();
      }
    }
  );
}

// ─── DOM scanning ─────────────────────────────────────────────────────────────

function scanNode(root) {
  for (const li of findInstructorLis(root)) {
    processLi(li);
  }
}

// ─── mutation observer ────────────────────────────────────────────────────────

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const found = findInstructorLis(node);
      if (found.length) console.log('[TRP] observer found', found.length, 'instructor li(s) in new node');
      scanNode(node);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Scan whatever's already rendered
scanNode(document.body);

// Diagnostic — visible in DevTools Console if extension is running
console.log('[TRP] content.js loaded on', location.href);
console.log('[TRP] instructor <li>s found on initial scan:', findInstructorLis(document.body).length);
