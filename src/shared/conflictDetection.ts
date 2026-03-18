import type { MeetingTime, SavedSection } from './types';

const DAY_SET = new Set(['M', 'T', 'W', 'R', 'F']);

function parseDays(raw: string): ('M' | 'T' | 'W' | 'R' | 'F')[] {
  return [...raw].filter((c) => DAY_SET.has(c)) as ('M' | 'T' | 'W' | 'R' | 'F')[];
}

export function hhmmToMinutes(hhmm: number): number {
  return Math.floor(hhmm / 100) * 60 + (hhmm % 100);
}

export function parseMeetingFromApi(m: {
  daysRaw: string;
  startTime: number;
  endTime: number;
  location?: string;
}): MeetingTime {
  return {
    days: parseDays(m.daysRaw),
    startMinutes: hhmmToMinutes(m.startTime),
    endMinutes: hhmmToMinutes(m.endTime),
    location: m.location ?? '',
  };
}

function meetingsOverlap(a: MeetingTime, b: MeetingTime): boolean {
  const sharedDay = a.days.some((d) => b.days.includes(d));
  if (!sharedDay) return false;
  // overlap if intervals intersect (exclusive end)
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

function sectionsConflict(a: SavedSection, b: SavedSection): boolean {
  for (const ma of a.meetingTimes) {
    for (const mb of b.meetingTimes) {
      if (meetingsOverlap(ma, mb)) return true;
    }
  }
  return false;
}

/**
 * Returns a map of CRN → array of CRNs it conflicts with.
 * Only sections with at least one meeting time are checked.
 */
export function findConflicts(sections: SavedSection[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const withTimes = sections.filter((s) => s.meetingTimes.length > 0);

  for (let i = 0; i < withTimes.length; i++) {
    for (let j = i + 1; j < withTimes.length; j++) {
      const a = withTimes[i];
      const b = withTimes[j];
      if (sectionsConflict(a, b)) {
        if (!result.has(a.crn)) result.set(a.crn, []);
        if (!result.has(b.crn)) result.set(b.crn, []);
        result.get(a.crn)!.push(b.crn);
        result.get(b.crn)!.push(a.crn);
      }
    }
  }

  return result;
}
