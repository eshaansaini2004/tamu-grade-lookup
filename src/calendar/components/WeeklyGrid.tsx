import { findConflicts } from '../../shared/conflictDetection';
import type { SavedSection } from '../../shared/types';

const DAYS = ['M', 'T', 'W', 'R', 'F'] as const;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const START_MIN = 7 * 60;   // 7:00am
const END_MIN = 22 * 60;    // 10:00pm
const SLOT_HEIGHT = 40;     // px per 30-min slot
const HEADER_H = 36;
const LABEL_W = 52;

const TOTAL_SLOTS = (END_MIN - START_MIN) / 30;
const TOTAL_HEIGHT = TOTAL_SLOTS * SLOT_HEIGHT;

const PALETTE = [
  { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  { bg: '#1a4731', border: '#22c55e', text: '#86efac' },
  { bg: '#4a1942', border: '#a855f7', text: '#d8b4fe' },
  { bg: '#4a2900', border: '#f59e0b', text: '#fcd34d' },
  { bg: '#1e3a3a', border: '#14b8a6', text: '#5eead4' },
  { bg: '#2d2000', border: '#eab308', text: '#fde68a' },
  { bg: '#1a2e4a', border: '#60a5fa', text: '#bfdbfe' },
  { bg: '#3a1a2e', border: '#f472b6', text: '#fbcfe8' },
];

const CONFLICT_COLOR = { bg: '#3b1f1f', border: '#ef4444', text: '#fca5a5' };

function courseColor(dept: string, num: string) {
  let h = 0;
  for (const c of dept + num) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function sectionColor(section: import('../../shared/types').SavedSection) {
  if (section.color) {
    const entry = PALETTE.find((p) => p.border === section.color);
    if (entry) return entry;
  }
  return courseColor(section.dept, section.courseNumber);
}

function minToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}`;
}

function top(min: number) {
  return ((min - START_MIN) / 30) * SLOT_HEIGHT;
}

function blockHeight(startMin: number, endMin: number) {
  return Math.max(((endMin - startMin) / 30) * SLOT_HEIGHT - 2, 18);
}

export default function WeeklyGrid({ sections }: { sections: SavedSection[] }) {
  const conflicts = findConflicts(sections);
  const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => START_MIN + i * 30);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: 'calc(100vh - 80px)' }}>
      {/* Fixed header row — outside scroll container so sticky works */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <div style={{ width: LABEL_W, flexShrink: 0 }} />
        {DAYS.map((day, di) => (
          <div
            key={day}
            style={{
              flex: 1,
              minWidth: 110,
              height: HEADER_H,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#9ca3af',
              borderBottom: '1px solid #374151',
              borderLeft: di === 0 ? '1px solid #374151' : undefined,
              borderRight: '1px solid #374151',
            }}
          >
            {DAY_LABELS[di]}
          </div>
        ))}
      </div>

      {/* Scrollable body */}
      <div style={{ display: 'flex', overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
        {/* Time label column */}
        <div style={{ width: LABEL_W, flexShrink: 0, position: 'relative', height: TOTAL_HEIGHT }}>
          {slots.map((min) => (
            <div
              key={min}
              style={{
                position: 'absolute',
                top: top(min) - 6,
                right: 8,
                fontSize: 10,
                color: '#4b5563',
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {min % 60 === 0 ? minToLabel(min) : ''}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {DAYS.map((day, di) => {
          const daySections = sections.flatMap((s) =>
            s.meetingTimes
              .filter((mt) => mt.days.includes(day))
              .map((mt) => ({ section: s, mt }))
          );

          return (
            <div
              key={day}
              style={{
                flex: 1,
                minWidth: 110,
                position: 'relative',
                height: TOTAL_HEIGHT,
                borderLeft: di === 0 ? '1px solid #374151' : undefined,
                borderRight: '1px solid #374151',
              }}
            >
              {/* Grid lines */}
              {slots.map((min) => (
                <div
                  key={min}
                  style={{
                    position: 'absolute',
                    top: top(min),
                    left: 0,
                    right: 0,
                    height: 1,
                    background: min % 60 === 0 ? '#374151' : '#1f2937',
                  }}
                />
              ))}

              {/* Section blocks */}
              {daySections.map(({ section, mt }, i) => {
                const isConflict = conflicts.has(section.crn);
                const color = isConflict ? CONFLICT_COLOR : sectionColor(section);

                return (
                  <div
                    key={`${section.crn}-${i}`}
                    title={`${section.dept} ${section.courseNumber} · ${section.instructorName}\n${minToLabel(mt.startMinutes)}–${minToLabel(mt.endMinutes)}${mt.location ? ` · ${mt.location}` : ''}`}
                    style={{
                      position: 'absolute',
                      top: top(mt.startMinutes) + 1,
                      height: blockHeight(mt.startMinutes, mt.endMinutes),
                      left: 3,
                      right: 3,
                      background: color.bg,
                      border: `1px solid ${color.border}`,
                      borderRadius: 4,
                      padding: '3px 5px',
                      overflow: 'hidden',
                      zIndex: isConflict ? 2 : 1,
                      cursor: 'default',
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: color.text, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {section.dept} {section.courseNumber}
                    </div>
                    <div style={{ fontSize: 9, color: color.text, opacity: 0.75, lineHeight: 1.3 }}>
                      {minToLabel(mt.startMinutes)}–{minToLabel(mt.endMinutes)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
