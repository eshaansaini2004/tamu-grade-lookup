#!/usr/bin/env python3
"""
TAMU Grade Lookup — pulls instructor data from Schedule Builder + grade history from anex.us.

Usage:
    python3 lookup.py CSCE 477 POLS 338 FIVS 205
    python3 lookup.py --out report.txt CSCE 477 POLS 338
    python3 lookup.py --json CSCE 477 POLS 338
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from auth import get_context
from models import CourseReport, SectionInfo
from schedule import select_sections, reset_sections
from howdy import get_sections_for_courses
from scraper import fetch_course
from rmp import get_rmp_rating


def parse_courses(args: list[str]) -> list[tuple[str, str]]:
    if len(args) % 2 != 0:
        print("ERROR: courses must be DEPT NUMBER pairs", file=sys.stderr)
        sys.exit(1)
    return [(args[i].upper(), args[i + 1]) for i in range(0, len(args), 2)]


def build_report(dept: str, number: str, sections: list[SectionInfo]) -> CourseReport:
    professors = fetch_course(dept, number)
    if professors:
        with ThreadPoolExecutor(max_workers=min(len(professors), 6)) as ex:
            ratings = list(ex.map(get_rmp_rating, [p.name for p in professors]))
        for p, r in zip(professors, ratings):
            p.rmp_rating = r
    current_instructors = sorted({s.instructor_name for s in sections if s.instructor_name != "TBA"})
    return CourseReport(
        dept=dept,
        number=number,
        current_instructors=current_instructors,
        instructor_source="schedule_builder",
        professors=professors,
        sections=sections,
    )


def _fmt_time(t: int) -> str:
    if t == 0:
        return ""
    h, m = t // 100, t % 100
    period = "am" if h < 12 else "pm"
    if h > 12:
        h -= 12
    elif h == 0:
        h = 12
    return f"{h}:{m:02d}{period}"


def _fmt_section(s) -> str:
    if s.is_online or not s.days:
        timing = "ONLINE"
    else:
        timing = f"{s.days} {_fmt_time(s.start_time)}–{_fmt_time(s.end_time)}  {s.location}"
    seats = f"{s.open_seats} open" if s.open_seats else "no seats"
    return f"    §{s.section_number}  {timing}  ({seats})"


def _last_name(name: str) -> str:
    # "Baca, Michaela" → "baca"  |  "Baca M" → "baca"
    return name.split(",")[0].split()[0].lower()


def format_report(report: CourseReport) -> str:
    lines = [f"\n{'━' * 42}", f"  {report.dept} {report.number}", f"{'━' * 42}"]

    if not report.sections:
        lines.append("  No sections found.")
        lines.append("")
        return "\n".join(lines)

    # Group sections by instructor
    by_instructor: dict[str, list] = defaultdict(list)
    for s in report.sections:
        by_instructor[s.instructor_name].append(s)

    # Build grade lookup: last name → ProfessorResult
    grade_by_last: dict[str, object] = {}
    for p in report.professors:
        grade_by_last[_last_name(p.name)] = p

    # Split instructors: those with grade data vs without
    with_grades = []
    without_grades = []
    for instr_name in by_instructor:
        ln = _last_name(instr_name)
        if ln in grade_by_last:
            with_grades.append((instr_name, grade_by_last[ln]))
        else:
            without_grades.append(instr_name)

    with_grades.sort(key=lambda x: x[1].avg_gpa, reverse=True)

    lines.append("")
    for i, (instr_name, prof) in enumerate(with_grades):
        sem_count = len(prof.semesters)
        most_recent = prof.semesters[0] if prof.semesters else "?"
        low_data = sem_count < 3

        if i == 0 and low_data and len(with_grades) > 1:
            star = "★ "
            data_note = f"  ⚠ only {sem_count} sem of data — see also #{2} below"
        elif i == 0:
            star = "★ "
            data_note = ""
        else:
            star = "  "
            data_note = f"  ⚠ limited data ({sem_count} sem)" if low_data else ""

        rmp_str = f"RMP {prof.rmp_rating:.1f}" if prof.rmp_rating is not None else "RMP N/A"
        lines.append(
            f"{star}{instr_name}   GPA {prof.avg_gpa:.2f} | "
            f"A: {prof.pct_a:.1f}%  B: {prof.pct_b:.1f}%  "
            f"{rmp_str}  [{sem_count} sem, {most_recent}]{data_note}"
        )
        for s in sorted(by_instructor[instr_name], key=lambda x: x.section_number):
            lines.append(_fmt_section(s))
        lines.append("")

    if without_grades:
        lines.append("  [No grade data]")
        for instr_name in sorted(without_grades):
            lines.append(f"  {instr_name}")
            for s in sorted(by_instructor[instr_name], key=lambda x: x.section_number):
                lines.append(_fmt_section(s))
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("courses", nargs="*")
    parser.add_argument("--out", default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--select", nargs="+", metavar="ARG",
        help="Triplets: DEPT NUM INSTRUCTOR [...]. E.g. --select CSCE 120 Beideman ENGL 210 Baca"
    )
    parser.add_argument(
        "--reset", nargs="+", metavar="ARG",
        help="Reset all sections for courses. Pairs: DEPT NUM [...]. E.g. --reset CSCE 120 ENGL 210"
    )
    args = parser.parse_args()

    # --reset mode
    if args.reset:
        courses_to_reset = parse_courses(args.reset)
        print(f"Resetting {len(courses_to_reset)} course(s)...", file=sys.stderr)
        pw, ctx = get_context()
        try:
            reset_sections(courses_to_reset, ctx)
            print("Done — all sections restored.")
        finally:
            ctx.close()
            pw.stop()
        return

    # --select mode
    if args.select:
        raw = args.select
        if len(raw) % 3 != 0:
            print("ERROR: --select expects triplets: DEPT NUM INSTRUCTOR", file=sys.stderr)
            sys.exit(1)
        triplets = [(raw[i].upper(), raw[i+1], raw[i+2]) for i in range(0, len(raw), 3)]
        unique_courses = [(dept, num) for dept, num, _ in triplets]

        print(f"Selecting sections for {len(triplets)} course(s)...", file=sys.stderr)
        sections_data = get_sections_for_courses(unique_courses)
        pw, ctx = get_context()
        try:
            selections = [
                (f"{dept} {num}", instr, sections_data.get(f"{dept} {num}", []))
                for dept, num, instr in triplets
            ]
            results = select_sections(selections, ctx)
            for course_key, selected in results.items():
                if selected:
                    print(f"\n{course_key} — {selected[0].instructor_name} ({len(selected)} sections):")
                    for s in selected:
                        print(_fmt_section(s))
                else:
                    print(f"\n{course_key} — no sections selected")
        finally:
            ctx.close()
            pw.stop()
        return

    if not args.courses:
        print("ERROR: provide courses or use --select / --reset", file=sys.stderr)
        sys.exit(1)

    courses = parse_courses(args.courses)

    print(f"Looking up {len(courses)} course(s)...", file=sys.stderr)

    # Step 1: Howdy public API — get Fall 2026 sections (no login needed)
    try:
        sections_data = get_sections_for_courses(courses)
    except Exception as e:
        print(f"ERROR: Howdy API failed — {e}", file=sys.stderr)
        sections_data = {}

    # Step 2: anex.us historical data — parallel across courses
    with ThreadPoolExecutor(max_workers=max(1, min(len(courses), 4))) as ex:
        futs = [
            ex.submit(build_report, dept, number, sections_data.get(f"{dept} {number}", []))
            for dept, number in courses
        ]
        reports: list[CourseReport] = [f.result() for f in futs]

    # Step 3: Output
    if args.json:
        out = json.dumps([r.model_dump() for r in reports], indent=2)
        if args.out:
            with open(args.out, "w") as f:
                f.write(out)
        else:
            print(out)
        return

    header = f"TAMU Grade Report — generated {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
    body = header + "".join(format_report(r) for r in reports) + "\n"

    if args.out:
        with open(args.out, "w") as f:
            f.write(body)
        print(f"Report written to {args.out}", file=sys.stderr)
    else:
        print(body)


if __name__ == "__main__":
    main()
