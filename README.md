# TAMU Registration+

Chrome extension that enhances [TAMU Schedule Builder](https://tamu.collegescheduler.com) with grade data, RMP ratings, and quality-of-life features.

## Features

- **Grade badges** — GPA, grade distribution (%A/%B/etc), and RMP rating injected next to every instructor name. Color-coded green/yellow/red by average GPA.
- **Section status badges** — OPEN / WAITLISTED / CLOSED on every section row
- **Saved sections** — bookmark sections you like, view them in a popup, manually refresh seat counts
- **Per-section color coding** — assign a color to any section; reflects in the calendar grid
- **CIS evaluation links** — direct links to student evaluations for each instructor
- **Schedule plan duplication** — duplicate any saved schedule plan with one click
- **Conflict detection** — warns when sections overlap

## Install

1. Download `tamu-registration-plus-v1.0.0.zip` from the [latest release](../../releases/latest)
2. Unzip it
3. Open Chrome → `chrome://extensions` → enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `dist` folder inside the unzipped directory
5. Navigate to [tamu.collegescheduler.com](https://tamu.collegescheduler.com) — badges and features load automatically

> Chrome will show a reminder about developer-mode extensions on startup. That's normal for extensions not on the Web Store.

## Data sources

- Grade distributions: [grades.adibarra.com](https://grades.adibarra.com)
- RMP ratings: Rate My Professors GraphQL API
- Seat counts: Schedule Builder's own API (uses your existing session)
