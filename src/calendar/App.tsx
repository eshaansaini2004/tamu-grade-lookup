import { useEffect, useRef, useState } from 'react';
import { storageGet, storageOnChanged, saveSchedule, deleteSchedule, setActiveSchedule, toggleCrnInSchedule } from '../shared/storage';
import type { SavedSection, Schedule } from '../shared/types';
import WeeklyGrid from './components/WeeklyGrid';

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const S = {
  wrap: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: '#111827',
    minHeight: '100vh',
    color: '#f9fafb',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    padding: '14px 24px 0',
    background: '#1f2937',
    borderBottom: '1px solid #374151',
    flexShrink: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: '#f9fafb',
    marginBottom: 12,
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    overflowX: 'auto' as const,
  },
  tab: (active: boolean) => ({
    padding: '6px 14px',
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    color: active ? '#f9fafb' : '#6b7280',
    background: active ? '#111827' : 'none',
    border: 'none',
    borderTop: active ? '2px solid #500000' : '2px solid transparent',
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  }),
  addTabBtn: {
    padding: '6px 10px',
    fontSize: 14,
    color: '#4b5563',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    lineHeight: 1,
  },
  body: {
    flex: 1,
    padding: '16px 24px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  emptyHint: { fontSize: 13, color: '#6b7280' },
  scheduleControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    flexShrink: 0,
  },
  renameInput: {
    fontSize: 12,
    background: '#1f2937',
    color: '#f9fafb',
    border: '1px solid #374151',
    borderRadius: 4,
    padding: '3px 8px',
    outline: 'none',
  },
  deleteBtn: {
    fontSize: 11,
    color: '#9ca3af',
    background: 'none',
    border: '1px solid #374151',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
  },
};

export default function App() {
  const [allSections, setAllSections] = useState<Record<string, SavedSection>>({});
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      storageGet('savedSections'),
      storageGet('schedules'),
      storageGet('activeScheduleId'),
    ]).then(([sections, scheds, active]) => {
      setAllSections(sections);
      setSchedules(scheds);
      setActiveId(active);
    });

    const unsub = storageOnChanged((changes) => {
      if (changes.savedSections !== undefined) setAllSections(changes.savedSections ?? {});
      if (changes.schedules !== undefined) setSchedules(changes.schedules ?? []);
      if (changes.activeScheduleId !== undefined) setActiveId(changes.activeScheduleId ?? null);
    });
    return unsub;
  }, []);

  const activeSchedule = schedules.find((s) => s.id === activeId) ?? null;
  const displayedSections = activeSchedule
    ? activeSchedule.sectionCrns.map((crn) => allSections[crn]).filter(Boolean) as SavedSection[]
    : Object.values(allSections);

  async function handleAddSchedule() {
    const name = `Plan ${schedules.length < 26 ? String.fromCharCode(65 + schedules.length) : schedules.length + 1}`;
    const sched: Schedule = { id: genId(), name, sectionCrns: [], createdAt: Date.now() };
    await saveSchedule(sched);
    await setActiveSchedule(sched.id);
  }

  async function handleSwitchSchedule(id: string | null) {
    await setActiveSchedule(id);
  }

  async function handleDelete() {
    if (!activeId) return;
    await deleteSchedule(activeId);
  }

  async function handleDuplicateSchedule() {
    if (!activeSchedule) return;
    const newSched: Schedule = {
      id: genId(),
      name: `${activeSchedule.name} Copy`,
      sectionCrns: [...activeSchedule.sectionCrns],
      createdAt: Date.now(),
    };
    await saveSchedule(newSched);
    await setActiveSchedule(newSched.id);
  }

  async function handleRenameCommit() {
    if (!activeSchedule || !renameVal.trim()) { setRenaming(false); return; }
    await saveSchedule({ ...activeSchedule, name: renameVal.trim() });
    setRenaming(false);
  }

  function startRename() {
    if (!activeSchedule) return;
    setRenameVal(activeSchedule.name);
    setRenaming(true);
    setTimeout(() => renameRef.current?.select(), 0);
  }

  // Toggle a CRN in/out of the active schedule — reads fresh from storage to avoid stale state race
  async function handleToggleCrn(crn: string) {
    if (!activeId) return;
    await toggleCrnInSchedule(activeId, crn);
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={S.title}>
          <span style={{ color: '#500000' }}>TAMU</span> Registration+ &mdash; Weekly Schedule
        </div>
        <div style={S.tabBar}>
          {/* "All" pseudo-tab */}
          <button style={S.tab(activeId === null)} onClick={() => handleSwitchSchedule(null)}>
            All Saved
          </button>
          {schedules.map((s) => (
            <button key={s.id} style={S.tab(activeId === s.id)} onClick={() => handleSwitchSchedule(s.id)}>
              {s.name}
            </button>
          ))}
          <button style={S.addTabBtn} title="New schedule" onClick={handleAddSchedule}>+</button>
        </div>
      </div>

      <div style={S.body}>
        {/* Controls for the active schedule */}
        {activeSchedule && (
          <div style={S.scheduleControls}>
            {renaming ? (
              <input
                ref={renameRef}
                style={S.renameInput}
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameCommit(); if (e.key === 'Escape') setRenaming(false); }}
              />
            ) : (
              <span
                style={{ fontSize: 12, color: '#9ca3af', cursor: 'pointer' }}
                onClick={startRename}
                title="Click to rename"
              >
                {activeSchedule.name} (click to rename)
              </span>
            )}
            <button
              style={{ ...S.deleteBtn, color: '#60a5fa', borderColor: '#1d4ed8' }}
              title="Duplicate schedule"
              onClick={handleDuplicateSchedule}
            >
              Duplicate
            </button>
            <button style={S.deleteBtn} onClick={handleDelete}>Delete schedule</button>
          </div>
        )}

        {/* Section picker when a schedule is active */}
        {activeSchedule && Object.keys(allSections).length > 0 && (
          <SectionPicker
            all={Object.values(allSections)}
            selected={activeSchedule.sectionCrns}
            onToggle={handleToggleCrn}
          />
        )}

        {displayedSections.length === 0 ? (
          <p style={S.emptyHint}>
            {activeSchedule
              ? 'No sections in this schedule. Use the picker above to add some.'
              : 'No saved sections. Save sections from Schedule Builder to see them here.'}
          </p>
        ) : (
          <WeeklyGrid sections={displayedSections} />
        )}
      </div>
    </div>
  );
}

function SectionPicker({
  all,
  selected,
  onToggle,
}: {
  all: SavedSection[];
  selected: string[];
  onToggle: (crn: string) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 12, flexShrink: 0 }}>
      {all.map((s) => {
        const on = selectedSet.has(s.crn);
        return (
          <button
            key={s.crn}
            onClick={() => onToggle(s.crn)}
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 12,
              border: `1px solid ${on ? '#500000' : '#374151'}`,
              background: on ? '#500000' : '#1f2937',
              color: on ? '#f9fafb' : '#6b7280',
              cursor: 'pointer',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {s.dept} {s.courseNumber} · {s.crn}
          </button>
        );
      })}
    </div>
  );
}
