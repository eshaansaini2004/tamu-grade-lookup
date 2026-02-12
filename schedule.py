from __future__ import annotations

import sys
from urllib.parse import quote

from playwright.sync_api import BrowserContext

from models import SectionInfo

BASE = "https://tamu.collegescheduler.com"
TARGET_TERM = "Fall 2026 - College Station"
TERM_ENCODED = quote(TARGET_TERM)


def get_current_instructors(
    courses: list[tuple[str, str]],
    ctx: BrowserContext,
) -> dict[str, list[str]]:
    """
    Returns {"DEPT NUMBER": ["Last, First", ...]} for each course.
    """
    page = ctx.new_page()
    try:
        _switch_to_fall2026(page)
        _ensure_courses_added(page, courses)
        return {
            f"{dept.upper()} {number}": _fetch_instructors(page, dept, number)
            for dept, number in courses
        }
    finally:
        page.close()


def _ensure_courses_added(page, courses: list[tuple[str, str]]) -> None:
    """
    Check which courses are already in the Fall 2026 schedule builder and add any missing ones.
    """
    try:
        resp = page.request.get(f"{BASE}/api/term-data/{TERM_ENCODED}", timeout=15000)
        if not resp.ok:
            print(f"  term-data fetch failed: {resp.status}", file=sys.stderr)
            return
        data = resp.json()
    except Exception as e:
        print(f"  term-data fetch error: {e}", file=sys.stderr)
        return

    added = {(c["subjectId"], c["number"]) for c in data.get("courses", [])}
    missing = [(dept.upper(), num) for dept, num in courses if (dept.upper(), num) not in added]

    if not missing:
        return

    print(f"  Adding {len(missing)} course(s) to schedule builder...", file=sys.stderr)

    for dept, number in missing:
        try:
            page.click('[href*="courses/add"]', force=True)
            page.wait_for_load_state("networkidle", timeout=10000)
            page.wait_for_timeout(500)

            page.click('button[aria-label="Open Subject menu"]')
            page.wait_for_timeout(500)
            page.click(f'[id^="by-subject-subjects-option-"]:has-text("{dept} -")')
            page.wait_for_timeout(500)

            page.click('button[aria-label="Open Course menu"]')
            page.wait_for_timeout(500)
            page.click(f'[id^="by-subject-courses-option-"]:has-text("{number}")')
            page.wait_for_timeout(500)

            page.click("button[type='submit']")
            page.wait_for_load_state("networkidle", timeout=10000)

            print(f"  Added {dept} {number}", file=sys.stderr)
        except Exception as e:
            print(f"  Warning: failed to add {dept} {number} — {e}", file=sys.stderr)


def _switch_to_fall2026(page) -> None:
    """
    Switch the schedule builder to Fall 2026.
    Flow: goto term-selection → check radio → click Save.
    Save updates React state to Fall 2026 without a hard reload.
    """
    # Get whatever is the current active term to build the right URL
    term_data = {}

    def capture(r):
        if r.url.endswith("/api/app-data"):
            try:
                d = r.json()
                terms = d.get("terms", [])
                if terms:
                    term_data["current"] = terms[0]["id"]
            except Exception:
                pass

    page.on("response", capture)
    page.goto(f"{BASE}/", wait_until="networkidle", timeout=20000)
    page.remove_listener("response", capture)

    current = term_data.get("current", "Full Yr Professional 2025-2026")

    if current == TARGET_TERM:
        print(f"  Already on {TARGET_TERM}", file=sys.stderr)
        return

    # Navigate to term selection page and switch
    page.goto(f"{BASE}/terms/{quote(current)}", wait_until="networkidle", timeout=20000)
    page.wait_for_timeout(500)
    page.check(f'[id="{TARGET_TERM}"]')
    page.wait_for_timeout(300)
    page.click("button:has-text('Save')")
    page.wait_for_load_state("networkidle", timeout=10000)
    page.wait_for_timeout(500)
    print(f"  Switched to {TARGET_TERM}", file=sys.stderr)


def get_all_sections(
    courses: list[tuple[str, str]],
    ctx: BrowserContext,
) -> dict[str, list[SectionInfo]]:
    """
    Returns {"DEPT NUMBER": [SectionInfo, ...]} for each course.
    Also ensures missing courses are added to the schedule builder.
    """
    page = ctx.new_page()
    try:
        _switch_to_fall2026(page)
        _ensure_courses_added(page, courses)
        result = {}
        for dept, number in courses:
            key = f"{dept.upper()} {number}"
            result[key] = _fetch_sections(page, dept, number)
        return result
    finally:
        page.close()


def _fetch_sections(page, dept: str, number: str) -> list[SectionInfo]:
    dept = dept.upper()
    url = f"{BASE}/api/terms/{TERM_ENCODED}/subjects/{dept}/courses/{number}/regblocks"

    try:
        resp = page.request.get(url, timeout=15000)
        if not resp.ok:
            print(f"  {dept} {number}: API {resp.status}", file=sys.stderr)
            return []
        data = resp.json()
    except Exception as e:
        print(f"  {dept} {number}: request failed — {e}", file=sys.stderr)
        return []

    sections = []
    for s in data.get("sections", []):
        instructors = s.get("instructor", [])
        instr_name = instructors[0]["name"].strip() if instructors else "TBA"
        if instr_name.upper() in ("TBA", "STAFF", ""):
            instr_name = "TBA"
        meeting = (s.get("meetings") or [{}])[0]
        is_online = meeting.get("building", "") == "ONLINE" or s.get("isOnline", False)
        sections.append(SectionInfo(
            reg_number=s["id"],
            section_number=s["sectionNumber"],
            days=meeting.get("days", ""),
            start_time=meeting.get("startTime", 0),
            end_time=meeting.get("endTime", 0),
            location=meeting.get("location", "").strip(),
            open_seats=int(s.get("openSeats", 0)),
            is_online=is_online,
            instructor_name=instr_name,
        ))

    print(f"  {dept} {number}: {len(sections)} section(s)", file=sys.stderr)
    return sections


def select_sections(
    selections: list[tuple[str, str, list[SectionInfo]]],
    ctx: BrowserContext,
) -> dict[str, list[SectionInfo]]:
    """
    Apply instructor section filters for multiple courses in one browser session.
    selections: [(course_key, instructor_query, sections), ...]
    Returns {course_key: [selected SectionInfo, ...]}
    """
    page = ctx.new_page()
    try:
        _switch_to_fall2026(page)
        results = {}
        for course_key, instructor_query, sections in selections:
            results[course_key] = _do_select_sections(page, course_key, instructor_query, sections)
        return results
    finally:
        page.close()


def reset_sections(
    courses: list[tuple[str, str]],
    ctx: BrowserContext,
) -> None:
    """
    Reset Schedule Builder to show all sections for each course (clear all filters).
    """
    page = ctx.new_page()
    try:
        _switch_to_fall2026(page)
        resp = page.request.get(f"{BASE}/api/term-data/{TERM_ENCODED}", timeout=15000)
        if not resp.ok:
            print(f"  term-data failed: {resp.status}", file=sys.stderr)
            return
        data = resp.json()
        course_id_map = {
            (c["subjectId"], c["number"]): c["id"]
            for c in data.get("courses", [])
        }
        for dept, number in courses:
            course_id = course_id_map.get((dept.upper(), number))
            if not course_id:
                print(f"  {dept.upper()} {number}: not in schedule builder, skipping", file=sys.stderr)
                continue
            _do_reset_sections(page, f"{dept.upper()} {number}", course_id)
    finally:
        page.close()


def _do_reset_sections(page, course_key: str, course_id: str) -> None:
    page.click(f'[href*="courses/{course_id}"]', force=True)
    page.wait_for_load_state("networkidle", timeout=15000)
    page.wait_for_timeout(1000)

    checkboxes = page.query_selector_all('input[id^="checkbox_"]')
    for cb in checkboxes:
        if not cb.is_checked():
            cb.click()
            page.wait_for_timeout(150)

    page.click("button:has-text('Save & Close')")
    page.wait_for_load_state("networkidle", timeout=10000)
    page.wait_for_timeout(500)
    print(f"  {course_key}: reset — all {len(checkboxes)} section(s) selected", file=sys.stderr)


def _do_select_sections(page, course_key: str, instructor_query: str, sections: list[SectionInfo]) -> list[SectionInfo]:
    query = instructor_query.lower()

    target = [s for s in sections if _last_name_s(s.instructor_name).startswith(query)]
    if not target:
        print(f"  No sections found for instructor matching '{instructor_query}'", file=sys.stderr)
        return []

    target_crns = {s.reg_number for s in target}

    # Get course internal ID from term-data
    resp = page.request.get(f"{BASE}/api/term-data/{TERM_ENCODED}", timeout=15000)
    if not resp.ok:
        print(f"  term-data failed: {resp.status}", file=sys.stderr)
        return []
    data = resp.json()
    dept, number = course_key.split(" ", 1)
    course_obj = next(
        (c for c in data.get("courses", []) if c["subjectId"] == dept.upper() and c["number"] == number),
        None,
    )
    if not course_obj:
        print(f"  {course_key} not found in term-data — is it added?", file=sys.stderr)
        return []

    course_id = course_obj["id"]

    # Navigate to course sections page within SPA
    page.click(f'[href*="courses/{course_id}"]', force=True)
    page.wait_for_load_state("networkidle", timeout=15000)
    page.wait_for_timeout(1000)

    # Get all section checkboxes currently on the page
    checkboxes = page.query_selector_all('input[id^="checkbox_"]')
    for cb in checkboxes:
        cb_id = cb.get_attribute("id")           # "checkbox_48360"
        crn = cb_id.replace("checkbox_", "")
        currently_checked = cb.is_checked()
        should_be_checked = crn in target_crns

        if should_be_checked and not currently_checked:
            cb.click()
            page.wait_for_timeout(150)
        elif not should_be_checked and currently_checked:
            cb.click()
            page.wait_for_timeout(150)

    page.click("button:has-text('Save & Close')")
    page.wait_for_load_state("networkidle", timeout=10000)
    page.wait_for_timeout(500)

    instr_display = target[0].instructor_name
    print(f"  {course_key}: selected {len(target)} section(s) for {instr_display}", file=sys.stderr)
    return target


def _last_name_s(name: str) -> str:
    return name.split(",")[0].split()[0].lower()


def _fetch_instructors(page, dept: str, number: str) -> list[str]:
    """
    Call the regblocks API directly using the authenticated session.
    Returns list of "Last, First" instructor name strings.
    """
    dept = dept.upper()
    url = f"{BASE}/api/terms/{TERM_ENCODED}/subjects/{dept}/courses/{number}/regblocks"

    try:
        resp = page.request.get(url, timeout=15000)
        if not resp.ok:
            print(f"  {dept} {number}: API {resp.status}", file=sys.stderr)
            return []
        data = resp.json()
    except Exception as e:
        print(f"  {dept} {number}: request failed — {e}", file=sys.stderr)
        return []

    instructors: set[str] = set()
    for section in data.get("sections", []):
        for instr in section.get("instructor", []):
            name = instr.get("name", "").strip()
            if name and name.upper() not in ("TBA", "STAFF", ""):
                instructors.add(name)

    names = sorted(instructors)
    print(f"  {dept} {number}: {names or 'none found'}", file=sys.stderr)
    return names
