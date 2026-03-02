# TAMU Registration+ Extension — Build Plan

> **For agents:** Read this file before touching the extension. Update the status of each item as you complete it. The DOM structures and API details here are confirmed from a live authenticated session — trust them.

---

## What's Already Built

**Files in `extension/`:**
- `manifest.json` — MV3, targets `tamu.collegescheduler.com`, host_permissions for `anex.us` and `ratemyprofessors.com`
- `background.js` — service worker, handles all API calls (anex.us grades + RMP GraphQL), chrome.storage.local cache
- `content.js` — MutationObserver, finds instructor `<li>` nodes, injects grade badge pills
- `styles.css` — badge styling (green/yellow/red pills, hover tooltip with grade distribution bars)
- `icons/` — placeholder maroon PNGs (swap for real ones before publishing)

**Status:** Grade badge injection is complete and syntax-clean. Needs to be loaded unpacked and tested live.

---

## Confirmed DOM Structure

Inspected from a live authenticated session at `tamu.collegescheduler.com`.

### Section row (same structure across all views)

```html
<tbody class="css-1c24da2-groupCss">          <!-- one per section -->
  <tr>
    <td><!-- checkbox --></td>
    <td><!-- info button --></td>
    <td><!-- CRN: "57876" --></td>             <!-- home page has extra "Enrolled" td here -->
    <td><span>CSCE</span></td>                 <!-- Subject -->
    <td><span>120</span></td>                  <!-- Course -->
    <td><span>200</span></td>                  <!-- Section -->
    <td><span>3</span></td>                    <!-- Credits -->
    <td><span>27</span></td>                   <!-- Seats Open (not on Current Schedule view) -->
    <td>Traditional Face-to-Face (F2F)</td>
    <td><!-- Days & Location --></td>
  </tr>
  <!-- 1-2 flag rows (Restrictions, Prerequisites badges) -->
  <tr id="section_details_CRN"><td colspan="10"></td></tr>  <!-- hidden details -->
  <tr>
    <td colspan="10">
      <ul class="css-fgox3d-fieldsCss">
        <li>
          <strong><span>Instructor</span>: </strong>
          <span>Carlisle, Martin</span>         <!-- injection point for badge -->
        </li>
      </ul>
    </td>
  </tr>
</tbody>
```

**Key:** Subject and Course number are always adjacent `<td>` siblings matching `[A-Z]{2,4}` + `\d{3}`. Current `findDeptAndNumber()` in content.js handles column offset differences between views correctly.

### Shopping Cart page (`/cart`)

Same tbody structure. Has a **Register** button in the page header:

```html
<button>Register</button>   <!-- triggers Howdy registration -->
```

Clicking Register submits all checked CRNs to Howdy's registration system. Works only during the student's registration window.

### Section selection checkboxes

Each section row has:
```html
<input type="checkbox" id="checkbox_CRN" aria-label="Select CSCE 120 - ...">
```

The checkbox `id` is always `checkbox_` + CRN number. This is the handle for programmatic section selection.

---

## Data Sources

### anex.us (grade history)
- `POST https://anex.us/grades/getData/`
- Body: `dept=CSCE&number=120` (URL-encoded)
- No auth. Returns `{ classes: [{ prof, semester, year, A, B, C, D, F, gpa }] }`
- background.js aggregates by professor, computes avg GPA and % per grade

### RateMyProfessors GraphQL
- `POST https://www.ratemyprofessors.com/graphql`
- Headers: `Authorization: Basic dGVzdDp0ZXN0` (public credentials, no real auth)
- School ID for TAMU: `U2Nob29sLTEwMDM=`
- Bayesian-weighted rating: `(n * raw + 10 * 3.5) / (n + 10)` — shrinks low-count ratings toward 3.5
- background.js handles dept-aware matching (avoids false positives when first name is only an initial)

### Howdy Public API (no auth)
- `GET https://howdyportal.tamu.edu/api/all-terms` — find current term code
- `POST https://howdyportal.tamu.edu/api/course-sections` — all sections for a term

### Schedule Builder API (authenticated, cookies auto-sent by browser)
- The extension runs in the user's already-authenticated browser session
- **No Duo or login needed** — cookies are inherited automatically
- API endpoints need to be captured from the Network tab (see TODO below)

---

## Full Feature Roadmap

### Phase 1 — Grade Badges ✅ (built, needs live test)

Inject GPA, %A, RMP rating as pill badges next to every instructor name.

- [x] MutationObserver watching for instructor `<li>` elements
- [x] Background service worker fetching anex.us + RMP in parallel
- [x] Cache (7-day grades, 24-hour RMP)
- [x] Color-coded pills (green ≥3.5, yellow ≥2.5, red <2.5)
- [x] Hover tooltip with grade distribution bars
- [ ] **Load unpacked and verify live** — check Network tab confirms anex.us + RMP calls succeed from background worker
- [ ] Tune name matching if any instructors show wrong/missing data (compound surnames, initials)

### Phase 2 — Auto-Select Best Sections

After grade data is loaded, add a **"Pick Best"** button per course that auto-checks only the highest-GPA instructor's sections.

**How to build:**
1. After badges are injected on the sections page (`/courses/COURSEID`), group sections by instructor
2. Identify the top-GPA instructor
3. Add a `<button class="trp-pick-best">Pick Best Instructor</button>` near the course header
4. On click: uncheck all `input[id^="checkbox_"]` in the page, then check only the ones belonging to the top instructor
5. Persist nothing — user can manually adjust after

**User flow:** Browse sections for a course → see grade badges → click "Pick Best" → only top instructor's sections stay checked → Generate Schedules

### Phase 3 — Registration Flow Automation

Automate the end-to-end flow: generate schedules → user picks one → register.

#### 3a. Generate Schedules button
- Add a "Generate" shortcut in the extension or just label/highlight the existing button
- Probably not worth automating — user already sees the button

#### 3b. Schedule picker (requires user input — cannot skip)
The generated schedules view shows N possible combinations. User must pick one. The extension can:
- Overlay each generated schedule option with aggregate GPA score (sum of instructor GPAs)
- Highlight the highest-GPA combination
- But the final pick is always the user's choice

#### 3c. Register button
- On the Shopping Cart page (`/cart`), the **Register** button submits CRNs to Howdy
- The extension can show a confirmation overlay before clicking: "You're about to register for: CSCE 120 §200, ENGL 210 §566 — confirm?"
- After user confirms, click the button programmatically

**Important:** Registration only works during the student's registration window. Clicking outside the window will just show an error from Howdy — no harm done, but add a user-visible status message.

#### 3d. What to capture before building 3c
Need to know what happens after Register is clicked:
- Does it stay on collegescheduler.com or redirect to Howdy?
- If it redirects to `howdyportal.tamu.edu`, add that to `host_permissions` and `content_scripts.matches`
- Capture the Network request made when Register is clicked (open DevTools → Network tab → click Register → find the POST)

### Phase 4 — Add Course from Anywhere (stretch)

A floating "+" button or popup where you type "CSCE 120" and the extension adds it to Schedule Builder without navigating through the dropdowns.

Requires knowing the add-course API endpoint (capture from Network tab when clicking "Add Course").

---

## Architecture Notes

- **No backend proxy needed.** `host_permissions` in MV3 bypass CORS for background service worker fetches. Confirmed: fetching from page context fails (CORS), background.js succeeds.
- **No login/Duo needed.** Extension runs in the user's authenticated browser. All Schedule Builder API calls automatically include session cookies.
- **Python code (auth.py, schedule.py) is irrelevant to the extension.** That's for the headless Discord bot. Don't try to reuse it here.
- **CSS class names like `css-1c24da2-groupCss` are Emotion-generated and may change between deployments.** Don't rely on them. Use structural selectors and text content matching instead (which is what the current code does).

---

## Known Issues / Watch Out For

- **"Not Assigned" and "TBA"** instructors: content.js already skips these
- **Compound surnames** (Da Silva, Del Valle): background.js name matching tokenizes and checks all last-name tokens — should handle these, verify with real examples
- **Column offset**: the home page has an extra "Enrolled/Enrolled" status column. `findDeptAndNumber()` uses adjacent-pair matching so it works across both views — but verify this is still true if Schedule Builder updates its layout
- **Shopping Cart has 0 Seats Open**: ENGL 210 §566 in the screenshots shows 0 seats. Extension should warn the user visually (already shows red Seats Open cell in the native UI, but could add a badge warning)
- **Registration window**: if the student clicks Register outside their window, Howdy will reject it. Surface the error message to the user rather than silently failing

---

## Files To Know

| File | Purpose |
|---|---|
| `extension/manifest.json` | MV3 config, permissions, content script targets |
| `extension/background.js` | Service worker — anex.us + RMP fetches, caching, message handler |
| `extension/content.js` | DOM observer, badge injection, course context extraction |
| `extension/styles.css` | All visual styling for badges and tooltips |
| `leopardworks/rmp.py` | Reference implementation for RMP matching + Bayesian weighting |
| `leopardworks/scraper.py` | Reference implementation for anex.us parsing |
| `leopardworks/howdy.py` | Reference for Howdy API — term codes, section parsing |
