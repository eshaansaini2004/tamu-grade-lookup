from __future__ import annotations

import io
import re
import sys
from datetime import date

import pdfplumber
from playwright.sync_api import sync_playwright

from dept_map import get_college
from models import PDFGradeRow

GRADE_REPORT_URL = "https://web-as.tamu.edu/gradereports/"

# Cache: (college_keyword, semester_label) -> raw PDF bytes
_pdf_cache: dict[tuple[str, str], bytes] = {}


def get_recent_semester() -> tuple[str, str]:
    """
    Return (year_str, semester_str) for the most recent *completed* semester.
    TAMU semesters: Spring (Jan-May), Summer (Jun-Aug), Fall (Sep-Dec)
    """
    today = date.today()
    month = today.month
    year = today.year

    if month <= 5:          # Jan-May: in Spring, last complete = Fall prev year
        return str(year - 1), "FALL"
    elif month <= 8:        # Jun-Aug: in Summer, last complete = Spring
        return str(year), "SPRING"
    else:                   # Sep-Dec: in Fall, last complete = Summer
        return str(year), "SUMMER"


def fetch_pdf_grade(dept: str, number: str) -> PDFGradeRow | None:
    """
    Download the official TAMU grade distribution PDF for the most recent
    completed semester and extract grade data for dept+number.
    Returns None if the course isn't found or PDF fetch fails.
    """
    college_keyword = get_college(dept)
    if not college_keyword:
        print(f"  PDF: unknown college for {dept}, skipping", file=sys.stderr)
        return None

    year, semester = get_recent_semester()
    semester_label = f"{semester.title()} {year}"
    cache_key = (college_keyword, semester_label)

    if cache_key not in _pdf_cache:
        pdf_bytes = _download_pdf(college_keyword, year, semester)
        if pdf_bytes is None:
            return None
        _pdf_cache[cache_key] = pdf_bytes

    return _parse_pdf(_pdf_cache[cache_key], dept, number, semester_label)


def _download_pdf(college_keyword: str, year: str, semester: str) -> bytes | None:
    """Use Playwright to navigate the grade reports form and download the PDF."""
    pdf_bytes: bytes | None = None

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        try:
            page.goto(GRADE_REPORT_URL, wait_until="domcontentloaded", timeout=20000)

            # The page has multiple report sections. We want "Grade Distribution Report".
            # Find the section containing "Grade Distribution" and interact with its dropdowns.
            _select_dropdown(page, "year", year)
            _select_dropdown(page, "semester", semester)
            _select_dropdown_by_text(page, college_keyword)

            # Click the submit/view button for grade distribution report
            submit_btn = _find_submit_button(page)
            if not submit_btn:
                print("  PDF: could not find submit button", file=sys.stderr)
                return None

            # Grade reports open PDF in a new tab — wait for it
            with context.expect_page(timeout=30000) as new_page_info:
                submit_btn.click()
            pdf_page = new_page_info.value
            pdf_page.wait_for_load_state("domcontentloaded", timeout=20000)
            pdf_url = pdf_page.url

            # Fetch the PDF bytes directly
            import requests as _req
            resp = _req.get(pdf_url, timeout=30)
            if resp.status_code == 200:
                pdf_bytes = resp.content
            else:
                pdf_bytes = _try_grab_from_new_page(context)

        except Exception as e:
            print(f"  PDF download failed: {e}", file=sys.stderr)
        finally:
            browser.close()

    return pdf_bytes


def _select_dropdown(page, field_type: str, value: str) -> None:
    """Select a year or semester dropdown by matching option text."""
    # Grade reports page has multiple dropdowns; find by proximity to "Grade Distribution"
    selects = page.query_selector_all("select")
    for sel in selects:
        options = sel.query_selector_all("option")
        for opt in options:
            opt_text = opt.inner_text().strip().upper()
            if opt_text == value.upper():
                sel.select_option(label=opt.inner_text().strip())
                page.wait_for_timeout(500)
                return


def _select_dropdown_by_text(page, college_keyword: str) -> None:
    """Select college dropdown by finding an option whose text contains the keyword."""
    selects = page.query_selector_all("select")
    for sel in selects:
        options = sel.query_selector_all("option")
        for opt in options:
            opt_text = opt.inner_text().strip().upper()
            if college_keyword.upper() in opt_text:
                sel.select_option(label=opt.inner_text().strip())
                page.wait_for_timeout(500)
                return
    print(f"  PDF: no dropdown option matched '{college_keyword}'", file=sys.stderr)


def _find_submit_button(page):
    """Find the view/submit button for the grade distribution report."""
    selectors = [
        "input[type='submit']",
        "button[type='submit']",
        "input[value*='View' i]",
        "button:has-text('View')",
        "a:has-text('View Report')",
    ]
    for sel in selectors:
        btn = page.query_selector(sel)
        if btn and btn.is_visible():
            return btn
    return None


def _try_grab_from_new_page(context) -> bytes | None:
    """If PDF opened in a new tab, grab it from there."""
    pages = context.pages
    for p in pages:
        if p.url.endswith(".pdf") or "pdf" in p.url.lower():
            try:
                resp = p.request.get(p.url)
                return resp.body()
            except Exception:
                pass
    return None


def _parse_pdf(pdf_bytes: bytes, dept: str, number: str, semester_label: str) -> PDFGradeRow | None:
    """Parse a TAMU grade distribution PDF and find the row for dept+number."""
    dept = dept.upper()
    target = f"{dept} {number}"

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row:
                            continue
                        row_text = " ".join(str(c) for c in row if c)
                        if dept in row_text and number in row_text:
                            parsed = _parse_row(row, semester_label)
                            if parsed:
                                return parsed

                # Fallback: search raw text
                text = page.extract_text() or ""
                result = _parse_text(text, dept, number, semester_label)
                if result:
                    return result
    except Exception as e:
        print(f"  PDF parse error: {e}", file=sys.stderr)

    return None


def _parse_row(row: list, semester_label: str) -> PDFGradeRow | None:
    """
    Extract grade data from a TAMU grade distribution PDF table row.
    TAMU columns: COLLEGE | DEPT | COURSE | SECTION | A | B | C | D | F | I | Q | S | U | X | TOTAL | GPA
    GPA is the last column and is in 0.0-4.0 range.
    """
    cells = [str(c or "").strip() for c in row]

    nums = []
    for cell in cells:
        try:
            nums.append(float(cell.replace(",", "")))
        except ValueError:
            pass

    if len(nums) < 6:
        return None

    # Last number in 0.0–4.0 range is GPA
    gpa = None
    for val in reversed(nums):
        if 0.0 <= val <= 4.0:
            gpa = round(val, 2)
            break

    if gpa is None or gpa == 0.0:
        return None

    # First 5 nums are A B C D F counts (section counts, not cumulative)
    # Skip any leading floats that look like section numbers (e.g. 500, 200)
    grade_counts = [n for n in nums if n != gpa and n < 1000][:5]
    if len(grade_counts) < 5:
        return None

    a, b, c, d, f = grade_counts
    total = a + b + c + d + f or 1

    return PDFGradeRow(
        semester=semester_label,
        gpa=gpa,
        pct_a=round(a / total * 100, 1),
        pct_b=round(b / total * 100, 1),
        pct_c=round(c / total * 100, 1),
        pct_d=round(d / total * 100, 1),
        pct_f=round(f / total * 100, 1),
    )


def _parse_text(text: str, dept: str, number: str, semester_label: str) -> PDFGradeRow | None:
    """Fallback: parse raw text extracted from PDF page."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if dept in line and number in line:
            # Grab numbers from this line and next few lines
            chunk = " ".join(lines[i : i + 3])
            nums = re.findall(r"\d+\.?\d*", chunk)
            floats = [float(n) for n in nums]
            if len(floats) >= 6:
                # Last value in 0.0-4.0 range = GPA
                gpa_candidates = [v for v in reversed(floats) if 0.0 < v <= 4.0]
                if not gpa_candidates:
                    continue
                gpa = gpa_candidates[0]
                counts = [v for v in floats if v != gpa and v < 1000][:5]
                total = sum(counts) or 1
                a, b, c, d, f = counts
                return PDFGradeRow(
                    semester=semester_label,
                    gpa=round(gpa, 2),
                    pct_a=round(a / total * 100, 1),
                    pct_b=round(b / total * 100, 1),
                    pct_c=round(c / total * 100, 1),
                    pct_d=round(d / total * 100, 1),
                    pct_f=round(f / total * 100, 1),
                )
    return None
