from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel


class SectionInfo(BaseModel):
    reg_number: str
    section_number: str
    days: str          # "MWF", "TTh", "" for online
    start_time: int    # HHMM int, e.g. 1140 = 11:40am; 0 = unknown/online
    end_time: int
    location: str
    open_seats: int
    is_online: bool
    instructor_name: str  # "Last, First" from schedule builder


class ProfessorResult(BaseModel):
    name: str
    semesters: List[str]
    avg_gpa: float
    pct_a: float
    pct_b: float
    pct_c: float
    pct_d: float
    pct_f: float
    rmp_rating: Optional[float] = None


class CourseReport(BaseModel):
    dept: str
    number: str
    current_instructors: List[str]   # from Schedule Builder
    instructor_source: str           # "schedule_builder" | "anex_estimated"
    professors: List[ProfessorResult]
    sections: List[SectionInfo] = []
