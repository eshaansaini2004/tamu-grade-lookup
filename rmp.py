"""
Rate My Professors — fetch avg rating for a professor at TAMU.
Uses the public RMP GraphQL API (no auth needed for basic search).
"""
from __future__ import annotations

import sys
import threading
from typing import Optional

import requests

# TAMU College Station: ratemyprofessors.com/school/1003
TAMU_SCHOOL_ID = "U2Nob29sLTEwMDM="

GQL_URL = "https://www.ratemyprofessors.com/graphql"
GQL_HEADERS = {
    "Authorization": "Basic dGVzdDp0ZXN0",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; tamu-grade-lookup/1.0)",
}

QUERY = """
query SearchTeacher($text: String!, $schoolID: ID!) {
  newSearch {
    teachers(query: {text: $text, schoolID: $schoolID}, first: 5) {
      edges {
        node {
          firstName
          lastName
          avgRating
          numRatings
        }
      }
    }
  }
}
"""

# Simple in-memory cache: last_name -> rating or None
_cache: dict[str, Optional[float]] = {}
_lock = threading.Lock()


def get_rmp_rating(prof_name: str) -> Optional[float]:
    """
    prof_name: 'Last, First' format (our internal format).
    Returns avg rating (0.0–5.0) or None if not found.
    """
    parts = prof_name.split(",", 1)
    last = parts[0].strip()
    first = parts[1].strip() if len(parts) > 1 else ""

    cache_key = prof_name.lower()
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]

    try:
        resp = requests.post(
            GQL_URL,
            json={"query": QUERY, "variables": {"text": f"{first} {last}".strip(), "schoolID": TAMU_SCHOOL_ID}},
            headers=GQL_HEADERS,
            timeout=8,
        )
        resp.raise_for_status()
        edges = resp.json()["data"]["newSearch"]["teachers"]["edges"]
    except Exception as e:
        print(f"  RMP lookup failed for {prof_name}: {e}", file=sys.stderr)
        with _lock:
            _cache[cache_key] = None
        return None

    if not edges:
        with _lock:
            _cache[cache_key] = None
        return None

    # Find best match: prefer exact last name match with most ratings
    last_lower = last.lower()
    candidates = [
        e["node"] for e in edges
        if e["node"]["lastName"].lower() == last_lower and e["node"]["numRatings"] > 0
    ]
    if not candidates:
        with _lock:
            _cache[cache_key] = None
        return None

    best = max(candidates, key=lambda n: n["numRatings"])
    rating = float(best["avgRating"]) if best["avgRating"] else None
    with _lock:
        _cache[cache_key] = rating
    return rating
