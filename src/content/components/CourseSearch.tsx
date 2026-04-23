import { createElement, useEffect, useRef, useState } from 'react';
import { sendCourseSearch } from '../../shared/messages';
import type { RankedInstructor } from '../../shared/messages';
import type { ApiSection, MeetingTime, SavedSection } from '../../shared/types';
import { saveSection } from '../../shared/storage';
import { parseMeetingFromApi } from '../../shared/conflictDetection';
import { parseName } from '../../shared/nameMatch';

const SCHEDULER_BASE = 'https://tamu.collegescheduler.com';

// ─── helpers ─────────────────────────────────────────────────────────────────

function getTerm(): string {
  const m = location.pathname.match(/\/terms\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : 'Fall 2026 - College Station';
}

async function addCourseToBuilder(dept: string, number: string, crnsToExclude: string[]): Promise<boolean> {
  const term = encodeURIComponent(getTerm());
  const token = (document.querySelector('input[name="__RequestVerificationToken"]') as HTMLInputElement | null)?.value ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  if (token) headers['X-XSRF-Token'] = token;
  const filterRules = crnsToExclude.length
    ? [{ type: 'registrationNumber', values: crnsToExclude, value: null, excluded: true }]
    : [];
  try {
    const res = await fetch(`${SCHEDULER_BASE}/api/terms/${term}/desiredcourses`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ number, subjectId: dept.toUpperCase(), topic: null, filterRules }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchSections(dept: string, number: string): Promise<ApiSection[]> {
  const term = encodeURIComponent(getTerm());
  try {
    const res = await fetch(
      `${SCHEDULER_BASE}/api/terms/${term}/subjects/${dept.toUpperCase()}/courses/${number}/regblocks`,
      { credentials: 'include' }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { sections?: ApiSection[] };
    return data.sections ?? [];
  } catch {
    return [];
  }
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${suffix}`;
}

function gpaColor(gpa: number): string {
  if (gpa >= 3.5) return '#34d399';
  if (gpa >= 2.5) return '#fbbf24';
  return '#f87171';
}

// ─── sub-components ───────────────────────────────────────────────────────────

function GradeBar({ pct, label, color }: { pct: number; label: string; color: string }) {
  return createElement(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 } },
    createElement('div', { style: { width: 14, fontSize: 9, color: '#6b7280', flexShrink: 0 } }, label),
    createElement('div', {
      style: { flex: 1, height: 6, background: '#1f2937', borderRadius: 3, overflow: 'hidden' },
    },
      createElement('div', { style: { width: `${pct}%`, height: '100%', background: color, borderRadius: 3 } })
    ),
    createElement('div', { style: { width: 24, fontSize: 9, color: '#6b7280', textAlign: 'right', flexShrink: 0 } }, `${pct}%`)
  );
}

function SectionRow({
  section,
  dept,
  number,
  instructor,
  onSave,
  saved,
}: {
  section: ApiSection;
  dept: string;
  number: string;
  instructor: RankedInstructor;
  onSave: (crn: string) => void;
  saved: boolean;
}) {
  const times: MeetingTime[] = section.meetings
    .filter((m) => m.daysRaw && m.startTime && m.endTime)
    .map(parseMeetingFromApi);

  const timeStr = times.length
    ? times.map((t) => `${t.days.join('')} ${minToTime(t.startMinutes)}–${minToTime(t.endMinutes)}`).join(', ')
    : 'TBA';

  async function handleSave() {
    const s: SavedSection = {
      crn: section.registrationNumber,
      dept,
      courseNumber: number,
      sectionNumber: section.sectionNumber ?? '',
      instructorName: instructor.name,
      credits: section.credits ?? 0,
      meetingTimes: times,
      gradeData: instructor.gradeData,
      rmpData: instructor.rmpData,
      addedAt: Date.now(),
    };
    await saveSection(s);
    onSave(section.registrationNumber);
  }

  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px',
        background: '#111827',
        borderRadius: 4,
        marginTop: 4,
        gap: 8,
      },
    },
    createElement(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      createElement('div', {
        style: { fontSize: 10, fontFamily: 'monospace', color: '#9ca3af' },
      }, `CRN ${section.registrationNumber}`),
      createElement('div', { style: { fontSize: 10, color: '#6b7280', marginTop: 2 } }, timeStr)
    ),
    createElement(
      'button',
      {
        onClick: handleSave,
        disabled: saved,
        style: {
          fontSize: 10,
          padding: '3px 8px',
          borderRadius: 4,
          border: 'none',
          background: saved ? '#374151' : '#500000',
          color: saved ? '#6b7280' : '#f9fafb',
          cursor: saved ? 'default' : 'pointer',
          flexShrink: 0,
        },
      },
      saved ? 'Saved' : 'Save'
    )
  );
}

function InstructorCard({
  instructor,
  sections,
  dept,
  number,
  savedCrns,
  onSave,
}: {
  instructor: RankedInstructor;
  sections: ApiSection[];
  dept: string;
  number: string;
  savedCrns: Set<string>;
  onSave: (crn: string) => void;
}) {
  const [addState, setAddState] = useState<'idle' | 'loading' | 'done' | 'err'>('idle');
  const { gradeData, rmpData } = instructor;
  // Match by last name exact word — avoids "Smith" matching "Smithson"
  const lastName = instructor.name.split(/[\s,]+/).filter(Boolean)[0]?.toLowerCase() ?? '';
  const mySections = sections.filter((s) =>
    (s.instructor ?? []).some((i) => {
      const iLast = i.name.split(/[\s,]+/).filter(Boolean)[0]?.toLowerCase() ?? '';
      return iLast === lastName;
    })
  );

  async function handleAddToBuilder() {
    setAddState('loading');
    const profCrns = new Set(mySections.map((s) => s.registrationNumber));
    const crnsToExclude = sections.filter((s) => !profCrns.has(s.registrationNumber)).map((s) => s.registrationNumber);
    const ok = await addCourseToBuilder(dept, number, crnsToExclude);
    setAddState(ok ? 'done' : 'err');
  }

  const addLabel = addState === 'loading' ? '…' : addState === 'done' ? 'Added ✓' : addState === 'err' ? 'Failed' : '+ Builder';

  return createElement(
    'div',
    {
      style: {
        background: '#1f2937',
        border: '1px solid #374151',
        borderRadius: 8,
        padding: '12px',
        marginBottom: 10,
      },
    },
    // Header: name + GPA + Add to Builder
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 6 } },
      createElement('div', {
        style: { fontSize: 12, fontWeight: 700, color: '#f9fafb', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, instructor.name),
      createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
        createElement('div', {
          style: { fontSize: 16, fontWeight: 800, color: gpaColor(gradeData.avgGpa) },
        }, gradeData.avgGpa.toFixed(2)),
        rmpData && createElement('div', {
          style: { fontSize: 11, color: '#9ca3af' },
        }, `RMP ${rmpData.rating.toFixed(1)}`),
        parseName(instructor.name).last && createElement('a', {
          className: 'trp-cis-link',
          href: `https://cis.tamu.edu/results?instructor=${encodeURIComponent(parseName(instructor.name).last)}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'CIS'),
        createElement('button', {
          onClick: handleAddToBuilder,
          disabled: addState === 'loading' || addState === 'done',
          style: {
            fontSize: 9,
            padding: '3px 7px',
            borderRadius: 4,
            border: 'none',
            background: addState === 'done' ? '#065f46' : addState === 'err' ? '#7f1d1d' : '#1d4ed8',
            color: '#f9fafb',
            cursor: addState === 'loading' || addState === 'done' ? 'default' : 'pointer',
            flexShrink: 0,
            fontWeight: 600,
          },
        }, addLabel)
      )
    ),
    // Grade bars
    createElement(
      'div',
      { style: { marginBottom: 8 } },
      createElement(GradeBar, { pct: gradeData.pctA, label: 'A', color: '#34d399' }),
      createElement(GradeBar, { pct: gradeData.pctB, label: 'B', color: '#60a5fa' }),
      createElement(GradeBar, { pct: gradeData.pctC, label: 'C', color: '#fbbf24' }),
      createElement(GradeBar, { pct: gradeData.pctD + gradeData.pctF, label: 'D/F', color: '#f87171' }),
    ),
    // Meta
    createElement('div', {
      style: { fontSize: 10, color: '#6b7280', marginBottom: mySections.length ? 6 : 0 },
    }, `${gradeData.semCount} semester${gradeData.semCount !== 1 ? 's' : ''} taught`),
    // Sections
    mySections.length > 0 && createElement(
      'div',
      null,
      ...mySections.slice(0, 4).map((s) =>
        createElement(SectionRow, {
          key: s.registrationNumber,
          section: s,
          dept,
          number,
          instructor,
          onSave,
          saved: savedCrns.has(s.registrationNumber),
        })
      ),
      mySections.length > 4 && createElement('div', {
        style: { fontSize: 10, color: '#4b5563', marginTop: 4 },
      }, `+${mySections.length - 4} more sections`)
    ),
    mySections.length === 0 && createElement('div', {
      style: { fontSize: 10, color: '#4b5563', marginTop: 4 },
    }, 'No open sections found')
  );
}

// ─── main search panel ────────────────────────────────────────────────────────

export default function CourseSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [instructors, setInstructors] = useState<RankedInstructor[]>([]);
  const [sections, setSections] = useState<ApiSection[]>([]);
  const [searchedCourse, setSearchedCourse] = useState('');
  const [savedCrns, setSavedCrns] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function parseCourse(raw: string): { dept: string; number: string } | null {
    const m = raw.trim().toUpperCase().match(/^([A-Z]{2,6})\s*(\d{3,4})$/);
    if (!m) return null;
    return { dept: m[1], number: m[2] };
  }

  async function handleSearch() {
    const parsed = parseCourse(query);
    if (!parsed) { setError('Enter a course like "CSCE 312"'); return; }
    setError('');
    setLoading(true);
    setInstructors([]);
    setSections([]);

    const [searchRes, sectionData] = await Promise.all([
      sendCourseSearch(parsed.dept, parsed.number),
      fetchSections(parsed.dept, parsed.number).catch(() => [] as ApiSection[]),
    ]);

    setInstructors(searchRes.instructors);
    setSections(sectionData);
    setSearchedCourse(`${parsed.dept} ${parsed.number}`);
    setLoading(false);
  }

  const [dept, number] = searchedCourse ? searchedCourse.split(' ') : ['', ''];

  return createElement(
    'div',
    {
      style: {
        position: 'fixed',
        top: 0,
        right: 0,
        width: 360,
        height: '100vh',
        background: '#111827',
        borderLeft: '1px solid #374151',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: '#f9fafb',
        zIndex: 999999,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
      },
    },
    // Header
    createElement(
      'div',
      {
        style: {
          padding: '14px 16px',
          borderBottom: '1px solid #374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        },
      },
      createElement('div', {
        style: { fontSize: 12, fontWeight: 700, color: '#f9fafb' },
      }, createElement('span', { style: { color: '#500000' } }, 'TAMU'), ' Professor Search'),
      createElement('button', {
        onClick: onClose,
        style: { background: 'none', border: 'none', color: '#6b7280', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px' },
      }, '×')
    ),
    // Search input
    createElement(
      'div',
      { style: { padding: '12px 16px', borderBottom: '1px solid #1f2937', flexShrink: 0 } },
      createElement(
        'div',
        { style: { display: 'flex', gap: 8 } },
        createElement('input', {
          ref: inputRef,
          value: query,
          onChange: (e: Event) => setQuery((e.target as HTMLInputElement).value),
          onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); },
          placeholder: 'CSCE 312',
          style: {
            flex: 1,
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: '7px 10px',
            fontSize: 13,
            color: '#f9fafb',
            outline: 'none',
          },
        }),
        createElement('button', {
          onClick: handleSearch,
          disabled: loading,
          style: {
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: '#500000',
            color: '#f9fafb',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
          },
        }, loading ? '…' : 'Search')
      ),
      error && createElement('div', { style: { fontSize: 11, color: '#f87171', marginTop: 6 } }, error)
    ),
    // Results
    createElement(
      'div',
      { style: { flex: 1, overflowY: 'auto', padding: '12px 16px' } },
      loading && createElement('div', { style: { fontSize: 12, color: '#6b7280' } }, 'Fetching grade data…'),
      !loading && instructors.length === 0 && searchedCourse && createElement(
        'div', { style: { fontSize: 12, color: '#6b7280' } }, 'No grade data found for this course.'
      ),
      !loading && instructors.length > 0 && createElement(
        'div',
        null,
        createElement('div', {
          style: { fontSize: 10, color: '#4b5563', marginBottom: 10 },
        }, `${instructors.length} instructor${instructors.length !== 1 ? 's' : ''} · ${searchedCourse} · ranked by GPA + RMP`),
        ...instructors.map((inst) =>
          createElement(InstructorCard, {
            key: inst.name,
            instructor: inst,
            sections,
            dept,
            number,
            savedCrns,
            onSave: (crn) => setSavedCrns((prev) => new Set([...prev, crn])),
          })
        )
      )
    )
  );
}
