import { useEffect, useState } from 'react';
import { sendGetPageStats } from '../shared/messages';
import type { PageStats } from '../shared/messages';
import { storageGet, removeSection, storageOnChanged } from '../shared/storage';
import { findConflicts } from '../shared/conflictDetection';
import type { SavedSection } from '../shared/types';

const SCHEDULER_HOST = 'tamu.collegescheduler.com';

type Tab = 'overview' | 'saved';
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
      <div style={C.muted}>Grades from anex.us · RMP ratings weighted</div>
    </>
  );
}

function SavedTab({
  sections,
  onRemove,
}: {
  sections: SavedSection[];
  onRemove: (crn: string) => void;
}) {
  if (sections.length === 0) {
    return <div style={C.empty}>No saved sections yet.<br />Click ☆ on any section to save it.</div>;
  }

  const conflicts = findConflicts(sections);

  return (
    <>
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
        return (
          <div key={s.crn} style={{
            ...C.savedCard,
            borderColor: hasConflict ? '#fca5a5' : '#374151',
          }}>
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
            </div>
            <button style={C.removeBtn} title="Remove" onClick={() => onRemove(s.crn)}>×</button>
          </div>
        );
      })}
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

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<Status>('loading');
  const [stats, setStats] = useState<PageStats | null>(null);
  const [savedSections, setSavedSections] = useState<SavedSection[]>([]);

  useEffect(() => {
    // Load saved sections
    storageGet('savedSections').then((saved) => {
      setSavedSections(Object.values(saved));
    });

    // Listen for changes from content script
    const unsub = storageOnChanged((changes) => {
      if (changes.savedSections) {
        setSavedSections(Object.values(changes.savedSections ?? {}));
      }
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

  return (
    <div style={C.wrap}>
      <div style={C.header}>
        <div style={C.title}>
          <div style={C.dot(status === 'ready')} />
          TAMU Registration+
        </div>
        <div style={C.tabs}>
          <button style={C.tab(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
          <button style={C.tab(tab === 'saved')} onClick={() => setTab('saved')}>
            Saved {savedSections.length > 0 ? `(${savedSections.length})` : ''}
          </button>
        </div>
      </div>

      <div style={C.body}>
        {tab === 'overview' && <OverviewTab status={status} stats={stats} />}
        {tab === 'saved' && <SavedTab sections={savedSections} onRemove={handleRemove} />}
      </div>

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
    </div>
  );
}
