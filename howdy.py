"""
Howdy Portal public API — no login required.
Fetches all course sections for a term and filters by requested courses.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Optional

import requests

from models import SectionInfo

HOWDY_BASE = "https://howdyportal.tamu.edu/api"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; tamu-grade-lookup/1.0)"}

# In-memory cache: term_code -> list of raw API rows
_section_cache: dict[str, list[dict]] = {}
_term_code_cache: Optional[str] = None


def _get_term_code() -> str:
    """Return the term code for the current/upcoming Fall semester."""
    global _term_code_cache
    if _term_code_cache:
        return _term_code_cache

    resp = requests.get(f"{HOWDY_BASE}/all-terms", headers=HEADERS, timeout=10)
    resp.raise_for_status()
    terms = resp.json()

    # Prefer "Fall YYYY - College Station" with the latest year
    fall_cs = [
        t for t in terms
        if "Fall" in t["STVTERM_DESC"] and "College Station" in t["STVTERM_DESC"]
    ]
    if not fall_cs:
        raise RuntimeError("Could not find a Fall College Station term")

    # Sort by code descending — highest code = most upcoming
    fall_cs.sort(key=lambda t: t["STVTERM_CODE"], reverse=True)
    _term_code_cache = fall_cs[0]["STVTERM_CODE"]
    print(f"  Howdy term: {fall_cs[0]['STVTERM_DESC']} ({_term_code_cache})", file=sys.stderr)
    return _term_code_cache


def _fetch_all_sections(term_code: str) -> list[dict]:
    """Fetch every section for the term. Cached after first call."""
    if term_code in _section_cache:
        return _section_cache[term_code]

    print(f"  Fetching all sections from Howdy (term {term_code})...", file=sys.stderr)
    t0 = time.time()
    resp = requests.post(
        f"{HOWDY_BASE}/course-sections",
        json={"startRow": 0, "endRow": 0, "termCode": term_code, "publicSearch": "Y"},
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json()
    elapsed = time.time() - t0
    print(f"  Got {len(rows)} sections in {elapsed:.1f}s", file=sys.stderr)

    _section_cache[term_code] = rows
    return rows


def _parse_time(t: Optional[str]) -> int:
    """Convert '10:20 AM' -> 1020, '01:30 PM' -> 1330, None -> 0."""
    if not t:
        return 0
    try:
        parts = t.strip().split()
        h, m = map(int, parts[0].split(":"))
        if parts[1] == "PM" and h != 12:
            h += 12
        elif parts[1] == "AM" and h == 12:
            h = 0
        return h * 100 + m
    except Exception:
        return 0


def _parse_days(meeting: dict) -> str:
    day_fields = [
        "SSRMEET_MON_DAY",
        "SSRMEET_TUE_DAY",
        "SSRMEET_WED_DAY",
        "SSRMEET_THU_DAY",
        "SSRMEET_FRI_DAY",
        "SSRMEET_SAT_DAY",
        "SSRMEET_SUN_DAY",
    ]
    return "".join(filter(None, (meeting.get(f) for f in day_fields)))


def _howdy_last_name(full_name: str) -> str:
    """
    'Calvin J. Beideman (P)' -> 'beideman'
    Strips the role suffix like '(P)' then takes the last token.
    """
    name = full_name.split("(")[0].strip()
    return name.split()[-1].lower() if name else ""


def _row_to_section(row: dict) -> SectionInfo:
    instr_raw = row.get("SWV_CLASS_SEARCH_INSTRCTR_JSON") or "[]"
    instructors = json.loads(instr_raw)

    instr_name = "TBA"
    if instructors:
        raw = instructors[0]["NAME"].strip()
        # Convert "Calvin J. Beideman (P)" -> "Beideman, Calvin J."
        # This matches the "Last, First" format used by schedule builder + lookup.py
        no_role = raw.split("(")[0].strip()
        tokens = no_role.split()
        if tokens:
            last = tokens[-1]
            first_parts = tokens[:-1]
            instr_name = f"{last}, {' '.join(first_parts)}" if first_parts else last
        if instr_name.upper() in ("TBA", "STAFF", ""):
            instr_name = "TBA"

    meet_raw = row.get("SWV_CLASS_SEARCH_JSON_CLOB") or "[]"
    meetings = json.loads(meet_raw)
    # Skip non-lecture meeting types (exams, etc.) — take first Lecture or just first
    meeting = next(
        (m for m in meetings if (m.get("SSRMEET_MTYP_CODE") or "").lower() == "lecture"),
        meetings[0] if meetings else {},
    )

    bldg = meeting.get("SSRMEET_BLDG_CODE") or ""
    room = meeting.get("SSRMEET_ROOM_CODE") or ""
    is_online = bldg.upper() == "ONLINE" or row.get("SWV_CLASS_SEARCH_INST_TYPE", "") == "Web Based"
    location = f"{bldg} {room}".strip() if not is_online else "ONLINE"

    return SectionInfo(
        reg_number=str(row["SWV_CLASS_SEARCH_CRN"]),
        section_number=str(row["SWV_CLASS_SEARCH_SECTION"]),
        days=_parse_days(meeting),
        start_time=_parse_time(meeting.get("SSRMEET_BEGIN_TIME")),
        end_time=_parse_time(meeting.get("SSRMEET_END_TIME")),
        location=location,
        open_seats=1 if row.get("STUSEAT_OPEN") == "Y" else 0,
        is_online=is_online,
        instructor_name=instr_name,
    )


def get_sections_for_courses(
    courses: list[tuple[str, str]],
) -> dict[str, list[SectionInfo]]:
    """
    Returns {"DEPT NUMBER": [SectionInfo, ...]} using the public Howdy API.
    Fetches and caches the full term roster on first call.
    """
    term_code = _get_term_code()
    all_rows = _fetch_all_sections(term_code)

    # Index rows by (subject, course) for fast lookup
    index: dict[tuple[str, str], list[dict]] = {}
    for row in all_rows:
        key = (row["SWV_CLASS_SEARCH_SUBJECT"], row["SWV_CLASS_SEARCH_COURSE"])
        index.setdefault(key, []).append(row)

    result: dict[str, list[SectionInfo]] = {}
    for dept, number in courses:
        key = (dept.upper(), number)
        rows = index.get(key, [])
        sections = [_row_to_section(r) for r in rows]
        result[f"{dept.upper()} {number}"] = sections
        print(f"  {dept.upper()} {number}: {len(sections)} section(s) via Howdy", file=sys.stderr)

    return result
