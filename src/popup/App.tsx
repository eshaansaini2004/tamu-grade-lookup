import { useEffect, useMemo, useRef, useState } from 'react';
import { sendGetPageStats, sendCourseSearch, sendFetchSections, sendAddCourseToBuilder, sendRefreshSections } from '../shared/messages';
import type { PageStats, RankedInstructor } from '../shared/messages';
import { storageGet, removeSection, saveSection, saveSectionOrder, saveSettings, storageOnChanged } from '../shared/storage';
import { findConflicts } from '../shared/conflictDetection';
import type { SavedSection, Schedule, ApiSection, SectionStatus, Settings } from '../shared/types';

const SCHEDULER_HOST = 'tamu.collegescheduler.com';
const DEFAULT_TERM = 'Fall 2026 - College Station';

const CHANGELOG: { version: string; entries: string[] }[] = [
  {
    version: '1.1.0',
    entries: [
      'What\'s new popup (this one)',
      'Settings tab: default term, conflict highlight, RMP and grade bar toggles',
      'Seat availability badges (Open / Waitlist / Full) on saved sections',
      'Drag-to-reorder saved sections',
      'Export and import saved sections as JSON',
      '"Add to Builder" button in the Search tab',
    ],
  },
  {
    version: '1.0.0',
    entries: [
      'Grade distribution badges on Schedule Builder course listings',
      'RMP rating overlay on instructor names',
      'Weekly calendar view with color-coded sections',
      'Save sections and detect time conflicts',
    ],
  },
];

const TERMS = [
  'Fall 2026 - College Station',
  'Spring 2026 - College Station',
  'Fall 2025 - College Station',
  'Spring 2025 - College Station',
];

type Tab = 'overview' | 'saved' | 'search' | 'settings';
type Status = 'loading' | 'not-on-page' | 'ready';

const C = {
  wrap: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: '#111827',
    color: '#f9fafb',
    minWidth: 300,
    userSelect: 'none' as const,
  },
  header: {
    padding: '12px 16px 0',
    background: '#1f2937',
    borderBottom: '1px solid #374151',
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    color: '#500000',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
  },
  dot: (active: boolean) => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: active ? '#34d399' : '#4b5563',
    flexShrink: 0,
  }),
  tabs: { display: 'flex', gap: 0 },
  tab: (active: boolean) => ({
    flex: 1,
    padding: '7px 0',
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    color: active ? '#f9fafb' : '#6b7280',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #500000' : '2px solid transparent',
    cursor: 'pointer',
    transition: 'color 0.15s',
  }),
  body: { padding: '14px 16px' },
  statRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 },
  label: { fontSize: 11, color: '#9ca3af' },
  value: { fontSize: 13, fontWeight: 700, color: '#f9fafb' },
  pill: (gpa: number) => {
    if (gpa >= 3.5) return { fontSize: 12, fontWeight: 700, color: '#065f46', background: '#d1fae5', padding: '2px 8px', borderRadius: 12 };
    if (gpa >= 2.5) return { fontSize: 12, fontWeight: 700, color: '#713f12', background: '#fef9c3', padding: '2px 8px', borderRadius: 12 };
    return { fontSize: 12, fontWeight: 700, color: '#7f1d1d', background: '#fee2e2', padding: '2px 8px', borderRadius: 12 };
  },
  muted: { fontSize: 10, color: '#4b5563', marginTop: 12 },
  savedCard: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  savedCardInfo: { flex: 1, minWidth: 0 },
  savedCourse: { fontSize: 12, fontWeight: 700, color: '#f9fafb', marginBottom: 3 },
  savedMeta: { fontSize: 10, color: '#9ca3af' },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#4b5563',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: '0 2px',
    flexShrink: 0,
  },
  empty: { fontSize: 11, color: '#6b7280', textAlign: 'center' as const, padding: '20px 0' },
};

function OverviewTab({ status, stats }: { status: Status; stats: PageStats | null }) {
  if (status === 'loading') return <div style={{ fontSize: 11, color: '#4b5563' }}>Loading…</div>;

  if (status === 'not-on-page') return (
    <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
      Open <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>tamu.collegescheduler.com</span> to see grade stats.
    </div>
  );

  if (!stats) return (
    <div style={{ fontSize: 11, color: '#6b7280' }}>Could not reach content script. Reload the page.</div>
  );

  if (stats.sectionCount === 0) return (
    <div style={{ fontSize: 11, color: '#6b7280' }}>No sections loaded yet. Browse courses on Schedule Builder.</div>
  );

  return (
    <>
      <div style={C.statRow}>
        <span style={C.label}>Sections scanned</span>
        <span style={C.value}>{stats.sectionCount}</span>
      </div>
      <div style={C.statRow}>
        <span style={C.label}>Unique instructors</span>
        <span style={C.value}>{stats.instructorCount}</span>
      </div>
      <div style={C.statRow}>
        <span style={C.label}>Courses</span>
        <span style={C.value}>{stats.courseCount}</span>
      </div>
      {stats.gpaMin != null && stats.gpaMax != null && (
        <div style={C.statRow}>
          <span style={C.label}>GPA range</span>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={C.pill(stats.gpaMin)}>{stats.gpaMin.toFixed(2)}</span>
            <span style={{ color: '#4b5563', fontSize: 10 }}>–</span>
            <span style={C.pill(stats.gpaMax)}>{stats.gpaMax.toFixed(2)}</span>
          </div>
        </div>
      )}
      <div style={C.muted}>Grades from grades.adibarra.com · RMP ratings weighted</div>
    </>
  );
}

// Border-color accents that mirror WeeklyGrid's PALETTE (same order)
const SWATCH_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b',
  '#14b8a6', '#eab308', '#60a5fa', '#f472b6',
];

function autoColor(dept: string, num: string): string {
  let h = 0;
  for (const c of dept + num) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCH_COLORS[h % SWATCH_COLORS.length];
}

const COOLDOWN_MS = 3000;

function seatStatus(seatData: import('../shared/types').SeatData): SectionStatus | null {
  if (seatData.openSeats === undefined && seatData.waitlistCount === undefined) return null;
  if ((seatData.openSeats ?? 0) > 0) return 'OPEN';
  if ((seatData.waitlistCount ?? 0) > 0) return 'WAITLISTED';
  return 'CLOSED';
}

const STATUS_STYLE: Record<SectionStatus, { bg: string; color: string; border: string }> = {
  OPEN:       { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  WAITLISTED: { bg: '#fef9c3', color: '#713f12', border: '#fde047' },
  CLOSED:     { bg: '#fee2e2', color: '#7f1d1d', border: '#fca5a5' },
};

function SeatInfo({ seatData }: { seatData: import('../shared/types').SeatData }) {
  const status = seatStatus(seatData);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {seatData.openSeats !== undefined && (
        <span>{seatData.openSeats}/{seatData.totalSeats ?? '?'} open</span>
      )}
      {status && (
        <span style={{
          padding: '0 5px',
          borderRadius: 8,
          fontSize: 9,
          fontWeight: 700,
          background: STATUS_STYLE[status].bg,
          color: STATUS_STYLE[status].color,
          border: `1px solid ${STATUS_STYLE[status].border}`,
        }}>
          {status}
        </span>
      )}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  return `${diffH}h ago`;
}

function SavedTab({
  sections,
  schedules,
  onRemove,
  onColorChange,
  onRefresh,
  onImport,
  onReorder,
  settings,
}: {
  sections: SavedSection[];
  schedules: Schedule[];
  onRemove: (crn: string) => void;
  onColorChange: (crn: string, color: string) => void;
  onRefresh: () => Promise<boolean>;
  onImport: (file: File) => Promise<string | null>;
  onReorder: (newOrder: string[]) => void;
  settings: Settings;
}) {
  const [pickerCrn, setPickerCrn] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [importError, setImportError] = useState('');
  const [draggedCrn, setDraggedCrn] = useState<string | null>(null);
  const [dragOverCrn, setDragOverCrn] = useState<string | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { if (cooldownTimer.current) clearTimeout(cooldownTimer.current); };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && pickerCrn !== null) setPickerCrn(null);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [pickerCrn]);

  function handleExport() {
    const sectionsMap: Record<string, SavedSection> = {};
    for (const s of sections) sectionsMap[s.crn] = s;
    const payload = { version: 1, exportedAt: new Date().toISOString(), savedSections: sectionsMap, schedules };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tamu-schedule-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError('');
    const err = await onImport(file);
    if (err) setImportError(err);
  }

  if (sections.length === 0) {
    return (
      <>
        <div style={C.empty}>No saved sections yet.<br />Click ☆ on any section to save it.</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid #374151', borderRadius: 5, color: '#9ca3af', cursor: 'pointer' }}
          >
            Import JSON
          </button>
          {importError && <span style={{ fontSize: 10, color: '#f87171', alignSelf: 'center' }}>{importError}</span>}
        </div>
      </>
    );
  }

  const conflicts = settings.conflictHighlight ? findConflicts(sections) : new Set<string>();

  async function handleRefresh() {
    if (refreshing || cooldownActive) return;
    setRefreshing(true);
    setRefreshError(false);
    setCooldownActive(true);
    cooldownTimer.current = setTimeout(() => setCooldownActive(false), COOLDOWN_MS);
    const ok = await onRefresh();
    setRefreshing(false);
    if (!ok) setRefreshError(true);
  }

  // Find the most recent lastRefreshed across all sections
  const lastRefreshed = sections.reduce((best, s) => Math.max(best, s.lastRefreshed ?? 0), 0);

  return (
    <>
      {/* Refresh row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: refreshError ? '#f87171' : '#4b5563' }}>
          {refreshError
            ? 'Refresh failed — visit Schedule Builder'
            : lastRefreshed > 0
              ? `Updated ${formatRelativeTime(lastRefreshed)}`
              : 'Seat counts not yet fetched'}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing || cooldownActive}
          title="Re-fetch seat counts"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 600,
            background: 'none',
            border: '1px solid #374151',
            borderRadius: 5,
            color: refreshing || cooldownActive ? '#4b5563' : '#9ca3af',
            cursor: refreshing || cooldownActive ? 'default' : 'pointer',
          }}
        >
          {refreshing ? '↻ …' : '↻ Refresh'}
        </button>
      </div>

      {/* Export / Import row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
        <button
          onClick={handleExport}
          title="Download all sections and schedules as JSON"
          style={{ fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid #374151', borderRadius: 5, color: '#9ca3af', cursor: 'pointer' }}
        >
          Export JSON
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Restore sections and schedules from a backup file"
          style={{ fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid #374151', borderRadius: 5, color: '#9ca3af', cursor: 'pointer' }}
        >
          Import JSON
        </button>
        {importError && <span style={{ fontSize: 10, color: '#f87171' }}>{importError}</span>}
      </div>

      {conflicts.size > 0 && (
        <div style={{
          background: '#7f1d1d',
          border: '1px solid #fca5a5',
          borderRadius: 6,
          padding: '7px 10px',
          marginBottom: 10,
          fontSize: 11,
          color: '#fecaca',
        }}>
          ⚠ {conflicts.size} section{conflicts.size !== 1 ? 's' : ''} have time conflicts
        </div>
      )}
      {sections.map((s) => {
        const hasConflict = conflicts.has(s.crn);
        const currentColor = s.color ?? autoColor(s.dept, s.courseNumber);
        const isPickerOpen = pickerCrn === s.crn;
        const isDragging = draggedCrn === s.crn;
        const isDropTarget = dragOverCrn === s.crn && draggedCrn !== s.crn;

        function handleDragStart(e: React.DragEvent) {
          e.dataTransfer.effectAllowed = 'move';
          setDraggedCrn(s.crn);
        }

        function handleDragOver(e: React.DragEvent) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverCrn(s.crn);
        }

        function handleDrop(e: React.DragEvent) {
          e.preventDefault();
          if (!draggedCrn || draggedCrn === s.crn) return;
          const crns = sections.map((sec) => sec.crn);
          const fromIdx = crns.indexOf(draggedCrn);
          const toIdx = crns.indexOf(s.crn);
          if (fromIdx < 0 || toIdx < 0) return;
          const next = [...crns];
          next.splice(fromIdx, 1);
          next.splice(toIdx, 0, draggedCrn);
          onReorder(next);
          setDraggedCrn(null);
          setDragOverCrn(null);
        }

        function handleDragEnd() {
          setDraggedCrn(null);
          setDragOverCrn(null);
        }

        return (
          <div
            key={s.crn}
            draggable
            tabIndex={0}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onDragLeave={() => setDragOverCrn(null)}
            onKeyDown={(e) => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                onRemove(s.crn);
              }
            }}
            style={{
              ...C.savedCard,
              borderColor: isDropTarget ? '#60a5fa' : hasConflict ? '#fca5a5' : '#374151',
              opacity: isDragging ? 0.45 : 1,
              cursor: 'grab',
              outline: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', paddingRight: 4, color: '#374151', fontSize: 12, cursor: 'grab', flexShrink: 0 }} title="Drag to reorder">
              ⠿
            </div>
            <div style={C.savedCardInfo}>
              <div style={C.savedCourse}>
                {hasConflict && <span style={{ color: '#f87171', marginRight: 5 }}>⚠</span>}
                {s.dept} {s.courseNumber}
                {s.sectionNumber ? <span style={{ fontWeight: 400, color: '#9ca3af' }}> · {s.sectionNumber}</span> : null}
              </div>
              <div style={C.savedMeta}>
                {s.instructorName}
                {s.gradeData ? <span style={{ marginLeft: 6, color: '#6ee7b7' }}>GPA {s.gradeData.avgGpa.toFixed(2)}</span> : null}
              </div>
              <div style={{ ...C.savedMeta, marginTop: 2, fontFamily: 'monospace', fontSize: 10 }}>
                CRN {s.crn}
                {s.meetingTimes.length > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    {s.meetingTimes[0].days.join('')} {minutesToTime(s.meetingTimes[0].startMinutes)}–{minutesToTime(s.meetingTimes[0].endMinutes)}
                  </span>
                )}
              </div>
              {s.seatData && (
                <div style={{ ...C.savedMeta, marginTop: 3 }}>
                  <SeatInfo seatData={s.seatData} />
                </div>
              )}
              {isPickerOpen && (
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' as const }}>
                  {SWATCH_COLORS.map((color) => (
                    <button
                      key={color}
                      title={color}
                      onClick={() => { onColorChange(s.crn, color); setPickerCrn(null); }}
                      style={{
                        width: 16, height: 16,
                        borderRadius: '50%',
                        background: color,
                        border: `2px solid ${currentColor === color ? '#f9fafb' : 'transparent'}`,
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, flexShrink: 0 }}>
              <button
                title="Change color"
                onClick={() => setPickerCrn(isPickerOpen ? null : s.crn)}
                style={{
                  width: 14, height: 14,
                  borderRadius: '50%',
                  background: currentColor,
                  border: '2px solid #374151',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              />
              <button style={C.removeBtn} title="Remove" onClick={() => onRemove(s.crn)}>×</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function gpaColor(gpa: number): string {
  if (gpa >= 3.5) return '#34d399';
  if (gpa >= 2.5) return '#fbbf24';
  return '#f87171';
}

function PopupInstructorCard({
  instructor,
  sections,
  dept,
  number,
  term,
}: {
  instructor: RankedInstructor;
  sections: ApiSection[];
  dept: string;
  number: string;
  term: string;
}) {
  const [addState, setAddState] = useState<'idle' | 'loading' | 'done' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const { gradeData, rmpData } = instructor;

  const lastName = instructor.name.split(/[\s,]+/).filter(Boolean)[0]?.toLowerCase() ?? '';
  const mySections = sections.filter((s) =>
    (s.instructor ?? []).some((i) => {
      const iLast = i.name.split(/[\s,]+/).filter(Boolean)[0]?.toLowerCase() ?? '';
      return iLast === lastName;
    })
  );

  const sectionsWithSeats = mySections.filter((s) => s.openSeats != null);
  const totalOpen = mySections.reduce((sum, s) => sum + (s.openSeats ?? 0), 0);
  const anyOpen = sectionsWithSeats.some((s) => (s.openSeats ?? 0) > 0);
  const anyWaitlist = !anyOpen && sectionsWithSeats.some((s) => (s.waitlistCount ?? 0) > 0);

  async function handleAdd() {
    setAddState('loading');
    setErrMsg('');
    const profCrns = new Set(mySections.map((s) => s.registrationNumber));
    const crnsToExclude = sections.filter((s) => !profCrns.has(s.registrationNumber)).map((s) => s.registrationNumber);
    const ok = await sendAddCourseToBuilder(dept, number, term, crnsToExclude);
    setAddState(ok ? 'done' : 'err');
    if (!ok) {
      setErrMsg('session-expired');
      setTimeout(() => { setAddState('idle'); setErrMsg(''); }, 5000);
    }
  }

  const addLabel = addState === 'loading' ? '…' : addState === 'done' ? 'Added ✓' : addState === 'err' ? 'Failed' : '+ Builder';

  return (
    <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f9fafb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {instructor.name}
          </div>
          {sectionsWithSeats.length > 0 && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
              background: anyOpen ? '#065f46' : anyWaitlist ? '#78350f' : '#374151',
              color: anyOpen ? '#34d399' : anyWaitlist ? '#fbbf24' : '#6b7280',
            }}>
              {anyOpen ? `${totalOpen} open` : anyWaitlist ? 'Waitlist' : 'Full'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: gpaColor(gradeData.avgGpa) }}>
            {gradeData.avgGpa.toFixed(2)}
          </span>
          {rmpData && <span style={{ fontSize: 9, color: '#9ca3af' }}>★{rmpData.rating.toFixed(1)}</span>}
          <button
            onClick={handleAdd}
            disabled={addState === 'loading' || addState === 'done'}
            style={{
              fontSize: 9,
              padding: '2px 6px',
              borderRadius: 3,
              border: 'none',
              background: addState === 'done' ? '#065f46' : addState === 'err' ? '#7f1d1d' : '#1d4ed8',
              color: '#f9fafb',
              cursor: addState === 'loading' || addState === 'done' ? 'default' : 'pointer',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {addLabel}
          </button>
        </div>
      </div>
      {[
        { label: 'A', pct: gradeData.pctA, color: '#34d399' },
        { label: 'B', pct: gradeData.pctB, color: '#60a5fa' },
        { label: 'C', pct: gradeData.pctC, color: '#fbbf24' },
        { label: 'D/F', pct: gradeData.pctD + gradeData.pctF, color: '#f87171' },
      ].map(({ label, pct, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
          <div style={{ width: 16, fontSize: 8, color: '#6b7280', flexShrink: 0 }}>{label}</div>
          <div style={{ flex: 1, height: 5, background: '#111827', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
          </div>
          <div style={{ width: 24, fontSize: 8, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>{pct}%</div>
        </div>
      ))}
      {mySections.length > 0 && (
        <div style={{ marginTop: 5 }}>
          {mySections.slice(0, 3).map((s) => {
            const hasSeats = s.openSeats != null && s.totalSeats != null;
            const open = s.openSeats ?? 0;
            const waitlist = s.waitlistCount ?? 0;
            const status = !hasSeats ? null : open > 0 ? 'OPEN' : waitlist > 0 ? 'WL' : 'FULL';
            const pillBg = status === 'OPEN' ? '#065f46' : status === 'WL' ? '#78350f' : '#374151';
            const pillColor = status === 'OPEN' ? '#34d399' : status === 'WL' ? '#fbbf24' : '#6b7280';
            return (
              <div key={s.registrationNumber} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#6b7280', marginBottom: 2 }}>
                <span style={{ fontFamily: 'monospace' }}>CRN {s.registrationNumber}</span>
                {status && (
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '0 4px', borderRadius: 2, background: pillBg, color: pillColor }}>
                    {status === 'OPEN' ? `${open}/${s.totalSeats}` : status === 'WL' ? `WL ${waitlist}` : 'Full'}
                  </span>
                )}
              </div>
            );
          })}
          {mySections.length > 3 && (
            <div style={{ fontSize: 9, color: '#4b5563' }}>+{mySections.length - 3} more</div>
          )}
        </div>
      )}
      {errMsg === 'session-expired' && (
        <div style={{ marginTop: 4, fontSize: 9, color: '#f87171' }}>
          Session expired —{' '}
          <a
            href="https://tamu.collegescheduler.com"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#f87171', textDecoration: 'underline', cursor: 'pointer' }}
            onClick={() => chrome.tabs.create({ url: 'https://tamu.collegescheduler.com' })}
          >
            sign in to Schedule Builder
          </a>
          , then retry.
        </div>
      )}
    </div>
  );
}

function SearchTab({ focusCount, defaultTerm }: { focusCount: number; defaultTerm: string }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [instructors, setInstructors] = useState<RankedInstructor[]>([]);
  const [sections, setSections] = useState<ApiSection[]>([]);
  const [searchedCourse, setSearchedCourse] = useState('');
  const [term, setTerm] = useState(defaultTerm);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Last manual choice takes precedence; fall back to settings.defaultTerm
    chrome.storage.local.get('currentTerm', (r) => {
      setTerm((r.currentTerm as string | undefined) ?? defaultTerm);
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusCount]);

  function handleTermChange(newTerm: string) {
    setTerm(newTerm);
    chrome.storage.local.set({ currentTerm: newTerm });
    // Clear results — they were for the old term
    setInstructors([]);
    setSections([]);
    setSearchedCourse('');
  }

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

    const [searchRes, sects] = await Promise.all([
      sendCourseSearch(parsed.dept, parsed.number),
      sendFetchSections(parsed.dept, parsed.number, term),
    ]);

    setInstructors(searchRes.instructors);
    setSections(sects);
    setSearchedCourse(`${parsed.dept} ${parsed.number}`);
    setLoading(false);
  }

  const [dept, number] = searchedCourse ? searchedCourse.split(' ') : ['', ''];

  // Filter to only profs with a current section. Fall back to all if sections didn't load.
  const visibleInstructors = sections.length > 0
    ? instructors.filter((inst) => {
        const lastName = inst.name.split(/[\s,]+/).filter(Boolean)[0]?.toLowerCase() ?? '';
        return sections.some((s) =>
          (s.instructor ?? []).some((i) => {
            const iLast = i.name.split(/[\s,]+/).filter(Boolean)[0]?.toLowerCase() ?? '';
            return iLast === lastName;
          }),
        );
      })
    : instructors;

  return (
    <>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #1f2937' }}>
        <select
          value={term}
          onChange={(e) => handleTermChange(e.target.value)}
          style={{
            width: '100%',
            marginBottom: 6,
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: 5,
            padding: '5px 7px',
            fontSize: 11,
            color: '#9ca3af',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {(TERMS.includes(term) ? TERMS : [term, ...TERMS]).map((t) => (
            <option key={t} value={t}>{t.replace(' - College Station', '')}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="CSCE 312"
            autoFocus
            style={{
              flex: 1,
              background: '#111827',
              border: '1px solid #374151',
              borderRadius: 5,
              padding: '6px 8px',
              fontSize: 12,
              color: '#f9fafb',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: '#500000',
              color: '#f9fafb',
              border: 'none',
              borderRadius: 5,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>
        {error && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>{error}</div>}
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto', padding: '10px 12px' }}>
        {loading && <div style={{ fontSize: 11, color: '#6b7280' }}>Fetching…</div>}
        {!loading && visibleInstructors.length === 0 && searchedCourse && (
          <div style={{ fontSize: 11, color: '#6b7280' }}>No instructors found for this course this term.</div>
        )}
        {!loading && visibleInstructors.length > 0 && (
          <>
            <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 8 }}>
              {visibleInstructors.length} instructor{visibleInstructors.length !== 1 ? 's' : ''} · {searchedCourse} · ranked by GPA + RMP
            </div>
            {visibleInstructors.map((inst) => (
              <PopupInstructorCard
                key={inst.name}
                instructor={inst}
                sections={sections}
                dept={dept}
                number={number}
                term={term}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

const SETTINGS_DEFAULT: Settings = {
  defaultTerm: 'Fall 2026 - College Station',
  conflictHighlight: true,
  showRmp: true,
  showGradeBars: true,
};

function SettingsTab({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 };
  const label = { fontSize: 11, color: '#d1d5db' };
  const sub = { fontSize: 10, color: '#6b7280', marginTop: 2 };

  function Toggle({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
    return (
      <button
        onClick={onToggle}
        style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: checked ? '#500000' : '#374151',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#f9fafb',
          transition: 'left 0.2s',
        }} />
      </button>
    );
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={row}>
        <div>
          <div style={label}>Default term</div>
          <div style={sub}>Pre-selected in course search</div>
        </div>
        <select
          value={settings.defaultTerm}
          onChange={(e) => onChange({ defaultTerm: e.target.value })}
          style={{
            background: '#1f2937', border: '1px solid #374151', borderRadius: 5,
            padding: '4px 6px', fontSize: 10, color: '#9ca3af', outline: 'none', cursor: 'pointer', maxWidth: 130,
          }}
        >
          {TERMS.map((t) => <option key={t} value={t}>{t.replace(' - College Station', '')}</option>)}
        </select>
      </div>

      <div style={row}>
        <div>
          <div style={label}>Conflict highlight</div>
          <div style={sub}>Warn when saved sections overlap</div>
        </div>
        <Toggle checked={settings.conflictHighlight} onToggle={() => onChange({ conflictHighlight: !settings.conflictHighlight })} />
      </div>

      <div style={row}>
        <div>
          <div style={label}>Show RMP ratings</div>
          <div style={sub}>★ on schedule builder badges</div>
        </div>
        <Toggle checked={settings.showRmp} onToggle={() => onChange({ showRmp: !settings.showRmp })} />
      </div>

      <div style={row}>
        <div>
          <div style={label}>Show grade bars</div>
          <div style={sub}>A/B/C bars in badge tooltip</div>
        </div>
        <Toggle checked={settings.showGradeBars} onToggle={() => onChange({ showGradeBars: !settings.showGradeBars })} />
      </div>
    </div>
  );
}

function ChangelogModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1f2937',
        border: '1px solid #374151',
        borderRadius: 10,
        width: 280,
        maxHeight: 420,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #374151' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f9fafb', marginBottom: 2 }}>
            What's new
          </div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>TAMU Registration+</div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px' }}>
          {CHANGELOG.map(({ version, entries }) => (
            <div key={version} style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#500000',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                v{version}
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                {entries.map((e) => (
                  <li key={e} style={{ fontSize: 11, color: '#d1d5db', marginBottom: 4, lineHeight: 1.5 }}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #374151' }}>
          <button
            onClick={onDismiss}
            style={{
              width: '100%',
              padding: '7px 0',
              fontSize: 11,
              fontWeight: 600,
              color: '#f9fafb',
              background: '#500000',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<Status>('loading');
  const [stats, setStats] = useState<PageStats | null>(null);
  const [savedSections, setSavedSections] = useState<SavedSection[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [focusSearchCount, setFocusSearchCount] = useState(0);
  const [settings, setSettings] = useState<Settings>(SETTINGS_DEFAULT);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === '/') {
        e.preventDefault();
        setTab('search');
        setFocusSearchCount((n) => n + 1);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    // Load saved sections and order together so reconciliation is consistent
    Promise.all([storageGet('savedSections'), storageGet('sectionOrder')]).then(([saved, order]) => {
      setSavedSections(Object.values(saved));
      setSectionOrder(order);
    });
    storageGet('schedules').then(setSchedules);
    storageGet('activeScheduleId').then(setActiveScheduleId);
    storageGet('settings').then(setSettings);
    chrome.storage.local.get('showChangelog', (r) => {
      if (r.showChangelog) setShowChangelog(true);
    });

    // Listen for changes from content script
    const unsub = storageOnChanged((changes) => {
      if (changes.savedSections !== undefined) {
        setSavedSections(Object.values(changes.savedSections ?? {}));
      }
      if (changes.sectionOrder !== undefined) setSectionOrder(changes.sectionOrder ?? []);
      if (changes.schedules !== undefined) setSchedules(changes.schedules ?? []);
      if (changes.activeScheduleId !== undefined) setActiveScheduleId(changes.activeScheduleId ?? null);
      if (changes.settings !== undefined) setSettings(changes.settings ?? SETTINGS_DEFAULT);
    });

    // Load page stats
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.includes(SCHEDULER_HOST)) {
        setStatus('not-on-page');
        return;
      }
      const result = await sendGetPageStats(tab.id);
      setStats(result);
      setStatus('ready');
    });

    return unsub;
  }, []);

  const handleRemove = async (crn: string) => {
    setSavedSections((prev) => prev.filter((s) => s.crn !== crn));
    await removeSection(crn);
  };

  const handleColorChange = async (crn: string, color: string) => {
    const section = savedSections.find((s) => s.crn === crn);
    if (!section) return;
    await saveSection({ ...section, color });
  };

  const handleRefresh = async (): Promise<boolean> => {
    const stored = await chrome.storage.local.get('currentTerm');
    const term = (stored.currentTerm as string | undefined) ?? DEFAULT_TERM;
    const result = await sendRefreshSections(term);
    return result !== null && !result.error;
  };

  // Returns an error string on failure, null on success
  const handleImport = async (file: File): Promise<string | null> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return 'Invalid JSON file';
    }
    if (typeof parsed !== 'object' || parsed === null) return 'Invalid file format';
    const p = parsed as Record<string, unknown>;
    if (p.version !== 1) return 'Unsupported file version';
    if (typeof p.savedSections !== 'object' || p.savedSections === null || Array.isArray(p.savedSections))
      return 'Missing or invalid savedSections';
    if (!Array.isArray(p.schedules)) return 'Missing or invalid schedules';
    const sectionValues = Object.values(p.savedSections as Record<string, unknown>);
    for (const s of sectionValues) {
      const sec = s as Record<string, unknown>;
      if (typeof sec.crn !== 'string' || typeof sec.dept !== 'string' || !Array.isArray(sec.meetingTimes))
        return 'Corrupt section data in file';
    }
    const overwrite = window.confirm(
      `Import will replace your ${savedSections.length} saved section(s) and ${schedules.length} schedule(s). Continue?`
    );
    if (!overwrite) return null;
    await chrome.storage.local.set({
      savedSections: p.savedSections,
      schedules: p.schedules,
      activeScheduleId: null,
    });
    return null;
  };

  const activeSchedule = schedules.find((s) => s.id === activeScheduleId) ?? null;

  const orderedSections = useMemo(() => {
    const map = new Map(savedSections.map((s) => [s.crn, s]));
    const seen = new Set<string>();
    const result: SavedSection[] = [];
    for (const crn of sectionOrder) {
      const s = map.get(crn);
      if (s) { result.push(s); seen.add(crn); }
    }
    for (const s of savedSections) {
      if (!seen.has(s.crn)) result.push(s);
    }
    return result;
  }, [savedSections, sectionOrder]);

  const handleReorder = async (newOrder: string[]) => {
    setSectionOrder(newOrder);
    await saveSectionOrder(newOrder);
  };

  const handleSettingsChange = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const handleDismissChangelog = () => {
    setShowChangelog(false);
    chrome.storage.local.remove('showChangelog');
  };

  return (
    <div style={C.wrap}>
      <div style={C.header}>
        <div style={C.title}>
          <div style={C.dot(status === 'ready')} />
          TAMU Registration+
          {activeSchedule && (
            <span style={{ fontSize: 9, fontWeight: 500, color: '#6b7280', letterSpacing: 0, textTransform: 'none', marginLeft: 4 }}>
              · {activeSchedule.name}
            </span>
          )}
        </div>
        <div style={C.tabs}>
          <button style={C.tab(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
          <button style={C.tab(tab === 'saved')} onClick={() => setTab('saved')}>
            Saved {savedSections.length > 0 ? `(${savedSections.length})` : ''}
          </button>
          <button style={C.tab(tab === 'search')} onClick={() => setTab('search')}>Search</button>
          <button style={C.tab(tab === 'settings')} onClick={() => setTab('settings')}>⚙</button>
        </div>
      </div>

      {tab === 'search' ? (
        <SearchTab focusCount={focusSearchCount} defaultTerm={settings.defaultTerm} />
      ) : (
        <div style={C.body}>
          {tab === 'overview' && <OverviewTab status={status} stats={stats} />}
          {tab === 'saved' && <SavedTab sections={orderedSections} schedules={schedules} onRemove={handleRemove} onColorChange={handleColorChange} onRefresh={handleRefresh} onImport={handleImport} onReorder={handleReorder} settings={settings} />}
          {tab === 'settings' && <SettingsTab settings={settings} onChange={handleSettingsChange} />}
        </div>
      )}

      <div style={{ padding: '0 16px 12px', borderTop: '1px solid #1f2937' }}>
        <button
          style={{
            width: '100%',
            marginTop: 10,
            padding: '7px 0',
            fontSize: 11,
            fontWeight: 600,
            color: '#f9fafb',
            background: '#500000',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/calendar/index.html') })}
        >
          Open Calendar
        </button>
      </div>
      {showChangelog && <ChangelogModal onDismiss={handleDismissChangelog} />}
    </div>
  );
}
