# tamu-grade-lookup

Discord bot for TAMU students. Give it a course, get back professor grade distributions, RMP ratings, and Fall section info — all in one place instead of tabbing between Howdy, anex.us, and Rate My Professors.

## What it does

`/lookup CSCE 221 ENGL 210` returns, for each course:

- Every professor teaching it next semester with their section times and locations
- Historical grade distribution (avg GPA, % A/B/C/D/F) from anex.us
- Rate My Professors rating (N/A if not found)
- Whether seats are open

Professors are sorted by avg GPA so the best option is at the top.

`/select CSCE 221 Leyk ENGL 210 Baca` — logs into Howdy on your behalf and selects sections for the given professors. Requires `/login` first.

`/reset CSCE 221 ENGL 210` — restores all sections to unselected.

## Setup

```bash
pip install -r requirements.txt
playwright install chromium
```

Create a `.env` file:

```
DISCORD_TOKEN=your_bot_token_here
```

Run the bot:

```bash
python3 bot.py
```

### First-time login (for /select and /reset)

1. Run `/login` in Discord
2. The bot logs into Howdy with your TAMU credentials and shows you a Duo code
3. Enter the code in Duo Mobile
4. Session is saved per user — you only do this once

## CLI usage

You can also run lookups directly without the bot:

```bash
python3 lookup.py CSCE 221 POLS 338
python3 lookup.py --json CSCE 221        # JSON output
python3 lookup.py --out report.txt CSCE 221 ENGL 210
```

## Files

| File | What it does |
|------|-------------|
| `bot.py` | Discord bot, slash commands |
| `lookup.py` | Core logic, report formatting |
| `howdy.py` | Pulls Fall sections from Howdy public API (no login) |
| `scraper.py` | Fetches grade history from anex.us |
| `rmp.py` | Rate My Professors ratings via GraphQL API |
| `schedule.py` | Playwright automation for Howdy section selection |
| `auth.py` | Per-user browser sessions, Duo MFA handling |
| `pdf_grades.py` | Parses official TAMU grade distribution PDFs |
| `models.py` | Pydantic data models |

## Notes

- Section data is for Fall semester only (hardcoded to latest Fall term)
- Seat counts from Howdy are open/closed only — exact numbers aren't exposed publicly
- RMP matches on last name at TAMU College Station; picks the entry with the most ratings if there are duplicates
