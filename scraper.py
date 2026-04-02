from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import threading

import requests

from models import ProfessorResult

_cache: dict[tuple[str, str], list[ProfessorResult]] = {}
_lock = threading.Lock()

CACHE_DIR = Path.home() / ".tamu_grade_cache"
GRADE_TTL = 7 * 24 * 3600  # 7 days


def _disk_path(dept: str, number: str) -> Path:
    return CACHE_DIR / f"grades_{dept.upper()}_{number}.json"


def _load_disk(dept: str, number: str) -> list[ProfessorResult] | None:
    p = _disk_path(dept, number)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > GRADE_TTL:
        return None
    try:
        return [ProfessorResult(**r) for r in json.loads(p.read_text())]
    except Exception:
        return None


def _save_disk(dept: str, number: str, profs: list[ProfessorResult]) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    target = _disk_path(dept, number)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps([p.model_dump() for p in profs]))
    tmp.rename(target)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; tamu-grade-lookup/1.0)"
}


def fetch_course(dept: str, number: str) -> list[ProfessorResult]:
    """Return professor list for a course; empty list if no data found."""
    key = (dept.upper(), number)
    with _lock:
        if key in _cache:
            return _cache[key]

    cached = _load_disk(dept, number)
    if cached is not None:
        with _lock:
            _cache[key] = cached
        return cached

    data = _fetch_anex(dept, number)
    if data is None:
        print(f"No data found for {dept} {number}", file=sys.stderr)
        return []

    with _lock:
        _cache[key] = data
    _save_disk(dept, number, data)
    return data


def _fetch_anex(dept: str, number: str) -> list[ProfessorResult] | None:
    try:
        resp = requests.post(
            "https://anex.us/grades/getData/",
            data={"dept": dept.upper(), "number": number},
            headers=HEADERS,
            timeout=10,
            verify=False,
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as e:
        print(f"anex.us request failed: {e}", file=sys.stderr)
        return None

    classes = payload.get("classes")
    if not classes:
        return None

    time.sleep(0.5)
    return _parse_rows(classes)


def _parse_rows(rows: list[dict]) -> list[ProfessorResult]:
    prof_rows: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        name = row.get("prof", "Unknown").strip().title()
        prof_rows[name].append(row)

    professors: list[ProfessorResult] = []
    for name, sections in prof_rows.items():
        semesters = sorted(
            {f"{r.get('semester', '').title()} {r.get('year', '')}".strip() for r in sections},
            reverse=True,
        )

        total_a = total_b = total_c = total_d = total_f = 0
        gpa_sum = gpa_count = 0

        for r in sections:
            a, b, c, d, f = (
                int(r.get("A") or 0),
                int(r.get("B") or 0),
                int(r.get("C") or 0),
                int(r.get("D") or 0),
                int(r.get("F") or 0),
            )
            total_a += a
            total_b += b
            total_c += c
            total_d += d
            total_f += f
            try:
                gpa = float(r.get("gpa") or 0)
                if gpa > 0:
                    gpa_sum += gpa
                    gpa_count += 1
            except (ValueError, TypeError):
                pass

        graded = total_a + total_b + total_c + total_d + total_f or 1
        avg_gpa = round(gpa_sum / gpa_count, 2) if gpa_count else 0.0

        professors.append(
            ProfessorResult(
                name=name,
                semesters=semesters,
                avg_gpa=avg_gpa,
                pct_a=round(total_a / graded * 100, 1),
                pct_b=round(total_b / graded * 100, 1),
                pct_c=round(total_c / graded * 100, 1),
                pct_d=round(total_d / graded * 100, 1),
                pct_f=round(total_f / graded * 100, 1),
            )
        )

    professors.sort(key=lambda p: p.avg_gpa, reverse=True)
    return professors
