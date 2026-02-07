from __future__ import annotations

# Maps TAMU dept prefix → college name substring to match in the grade report dropdown.
# The exact dropdown text at web-as.tamu.edu/gradereports/ is matched via substring
# (case-insensitive) so minor wording differences don't break lookups.

DEPT_COLLEGE: dict[str, str] = {
    # College of Engineering
    "AERO": "ENGINEERING",
    "CHEN": "ENGINEERING",
    "CVEN": "ENGINEERING",
    "CSCE": "ENGINEERING",
    "CYBR": "ENGINEERING",
    "ECEN": "ENGINEERING",
    "ENTC": "ENGINEERING",
    "ISEN": "ENGINEERING",
    "MEEN": "ENGINEERING",
    "MXET": "ENGINEERING",
    "NUEN": "ENGINEERING",
    "PETE": "ENGINEERING",
    # College of Agriculture and Life Sciences
    "AGLS": "AGRICULTURE",
    "ANSC": "AGRICULTURE",
    "FIVS": "AGRICULTURE",
    "HORT": "AGRICULTURE",
    "MARA": "AGRICULTURE",
    "POSC": "AGRICULTURE",
    "SCSC": "AGRICULTURE",
    # College of Liberal Arts
    "ANTH": "LIBERAL ARTS",
    "COMM": "LIBERAL ARTS",
    "ENGL": "LIBERAL ARTS",
    "GEOG": "LIBERAL ARTS",
    "HIST": "LIBERAL ARTS",
    "LING": "LIBERAL ARTS",
    "PHIL": "LIBERAL ARTS",
    "POLS": "LIBERAL ARTS",
    "PSYC": "LIBERAL ARTS",
    "SOCI": "LIBERAL ARTS",
    "WGST": "LIBERAL ARTS",
    # College of Science
    "BIOL": "SCIENCE",
    "CHEM": "SCIENCE",
    "MATH": "SCIENCE",
    "OCNG": "SCIENCE",
    "PHYS": "SCIENCE",
    "STAT": "SCIENCE",
    # Mays Business School
    "ACCT": "BUSINESS",
    "BLAW": "BUSINESS",
    "FINC": "BUSINESS",
    "IBUS": "BUSINESS",
    "MGMT": "BUSINESS",
    "MKTG": "BUSINESS",
    "INFO": "BUSINESS",
    # College of Geosciences
    "ATMO": "GEOSCIENCES",
    "GEOL": "GEOSCIENCES",
    "GEOS": "GEOSCIENCES",
    # College of Architecture
    "ARCH": "ARCHITECTURE",
    "COSC": "ARCHITECTURE",
    "LAND": "ARCHITECTURE",
    "URPN": "ARCHITECTURE",
    # College of Education & Human Development
    "EPFP": "EDUCATION",
    "HLTH": "EDUCATION",
    "KINE": "EDUCATION",
    "TLAC": "EDUCATION",
    # College of Veterinary Medicine
    "VIBS": "VETERINARY",
    "VTPP": "VETERINARY",
    "VSCS": "VETERINARY",
    # Bush School of Government
    "BUSH": "BUSH",
    # College of Nursing
    "NURS": "NURSING",
    # School of Public Health
    "NUTR": "PUBLIC HEALTH",
}


def get_college(dept: str) -> str | None:
    """Return college keyword for dept, or None if unknown."""
    return DEPT_COLLEGE.get(dept.upper())
