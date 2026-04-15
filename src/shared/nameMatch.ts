import type { GradeData, RmpData } from './types';
import { DEPT_KEYWORDS, RMP_PRIOR_MEAN, RMP_PRIOR_WEIGHT } from './constants';

export function parseName(instructorName: string): { last: string; first: string } {
  if (instructorName.includes(',')) {
    // "Last, First" format (Schedule Builder / Howdy)
    const parts = instructorName.split(',').map((s) => s.trim());
    return { last: parts[0] || '', first: parts[1] || '' };
  }
  // No comma — "Last First" or "Last Name Initial" (Adibarra/anex.us, e.g. "Da Silva D")
  const parts = instructorName.trim().split(/\s+/);
  if (parts.length >= 2 && parts[parts.length - 1].length === 1) {
    // Trailing single-char initial: everything before it is the last name
    return { last: parts.slice(0, -1).join(' '), first: parts[parts.length - 1] };
  }
  // Full name: first token = last, second = first
  return { last: parts[0] || '', first: parts[1] || '' };
}

// Match "Last, First" against anex.us prof map (keys are lowercase full names like "carlisle m")
export function matchProf(
  profs: Record<string, GradeData>,
  instructorName: string,
): GradeData | null {
  const { last } = parseName(instructorName);
  const lastTokens = last.toLowerCase().split(/\s+/);
  for (const [key, prof] of Object.entries(profs)) {
    if (lastTokens.every((t) => key.includes(t))) return prof;
  }
  return null;
}

interface RmpNode {
  firstName: string;
  lastName: string;
  avgRating: string;
  numRatings: number;
  department: string;
}

export function pickBestRmp(
  nodes: RmpNode[],
  instructorName: string,
  dept: string,
): RmpData | null {
  const { last, first } = parseName(instructorName);
  const firstClean = first.split(' ')[0];
  const isInitial = firstClean.length === 1;
  const lastTokens = new Set(last.toLowerCase().split(/\s+/));
  const deptKeyword = DEPT_KEYWORDS[dept.toUpperCase()] || '';

  const candidates = nodes
    .filter((n) => {
      const rmpLastTokens = new Set(n.lastName.toLowerCase().split(/\s+/));
      if (![...lastTokens].every((t) => rmpLastTokens.has(t))) return false;
      if (!first) return true;
      const rmpFirst = n.firstName.toLowerCase();
      if (isInitial) {
        if (!rmpFirst.startsWith(firstClean.toLowerCase())) return false;
        if (deptKeyword) return (n.department || '').toLowerCase().includes(deptKeyword);
        return true;
      }
      const rmpFullTokens = new Set(`${n.firstName} ${n.lastName}`.toLowerCase().split(/\s+/));
      return firstClean.toLowerCase().split(/\s+/).every((t) => rmpFullTokens.has(t));
    })
    .filter((n) => n.numRatings > 0)
    .sort((a, b) => b.numRatings - a.numRatings);

  if (!candidates.length) return null;

  const best = candidates[0];
  const raw = parseFloat(best.avgRating);
  const n = best.numRatings;
  const weighted = (n * raw + RMP_PRIOR_WEIGHT * RMP_PRIOR_MEAN) / (n + RMP_PRIOR_WEIGHT);
  return {
    rating: Math.round(raw * 10) / 10,
    weighted: Math.round(weighted * 10) / 10,
    count: n,
  };
}
