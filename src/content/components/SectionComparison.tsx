import { useState } from 'react';
import type { GradeData, RmpData } from '../../shared/types';

export interface InstructorData {
  name: string;
  gradeData: GradeData | null;
  rmpData: RmpData | null;
}

interface Props {
  course: string; // e.g. "CSCE 120"
  instructors: InstructorData[];
  onClose: () => void;
}

const GRADE_COLORS = {
  green: '#065f46',
  greenBg: '#d1fae5',
  greenBorder: '#6ee7b7',
  yellow: '#713f12',
  yellowBg: '#fef9c3',
  yellowBorder: '#fde047',
  red: '#7f1d1d',
  redBg: '#fee2e2',
  redBorder: '#fca5a5',
  gray: '#374151',
  grayBg: '#f3f4f6',
  grayBorder: '#d1d5db',
};

function gpaColor(gpa: number | null | undefined) {
  if (gpa == null) return { color: GRADE_COLORS.gray, bg: GRADE_COLORS.grayBg, border: GRADE_COLORS.grayBorder };
  if (gpa >= 3.5) return { color: GRADE_COLORS.green, bg: GRADE_COLORS.greenBg, border: GRADE_COLORS.greenBorder };
  if (gpa >= 2.5) return { color: GRADE_COLORS.yellow, bg: GRADE_COLORS.yellowBg, border: GRADE_COLORS.yellowBorder };
  return { color: GRADE_COLORS.red, bg: GRADE_COLORS.redBg, border: GRADE_COLORS.redBorder };
}

const BAR_COLORS: Record<string, string> = {
  A: '#34d399',
  B: '#60a5fa',
  C: '#fbbf24',
  D: '#f97316',
  F: '#f87171',
};

function GradeBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 12, fontSize: 10, fontWeight: 700, color: '#9ca3af', textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: '#374151', borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: BAR_COLORS[label] ?? '#6b7280',
            borderRadius: 4,
            minWidth: pct > 0 ? 2 : 0,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ width: 30, fontSize: 10, color: '#d1d5db', textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function InstructorCard({ data, rank }: { data: InstructorData; rank: number }) {
  const { gradeData, rmpData } = data;
  const colors = gpaColor(gradeData?.avgGpa);
  const isTop = rank === 0;

  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 180,
        background: '#1f2937',
        border: `2px solid ${isTop ? '#500000' : '#374151'}`,
        borderRadius: 10,
        padding: '14px 16px',
        position: 'relative',
      }}
    >
      {isTop && (
        <div
          style={{
            position: 'absolute',
            top: -10,
            left: 12,
            background: '#500000',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Best GPA
        </div>
      )}

      {/* Name */}
      <div style={{ fontWeight: 700, fontSize: 13, color: '#f9fafb', marginBottom: 10 }}>
        {data.name}
      </div>

      {/* GPA pill */}
      {gradeData ? (
        <div
          style={{
            display: 'inline-block',
            background: colors.bg,
            color: colors.color,
            border: `1px solid ${colors.border}`,
            borderRadius: 20,
            padding: '3px 10px',
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          GPA {gradeData.avgGpa.toFixed(2)}
          <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6, opacity: 0.8 }}>
            ({gradeData.semCount} sem)
          </span>
        </div>
      ) : (
        <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 12 }}>No grade data</div>
      )}

      {/* Grade distribution bars */}
      {gradeData && (
        <div style={{ marginBottom: 12 }}>
          {(['A', 'B', 'C', 'D', 'F'] as const).map((g) => (
            <GradeBar key={g} label={g} pct={gradeData[`pct${g}` as keyof GradeData] as number} />
          ))}
        </div>
      )}

      {/* RMP */}
      {rmpData ? (
        <div style={{ borderTop: '1px solid #374151', paddingTop: 10, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24' }}>
              ★ {rmpData.rating.toFixed(1)}
            </span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>/ 5</span>
            <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>
              {rmpData.count} rating{rmpData.count !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid #374151', paddingTop: 10, marginTop: 4, fontSize: 11, color: '#6b7280' }}>
          No RMP data
        </div>
      )}
    </div>
  );
}

export default function SectionComparison({ course, instructors, onClose }: Props) {
  const [minimized, setMinimized] = useState(false);

  // Sort by GPA descending
  const sorted = [...instructors].sort((a, b) => {
    const ga = a.gradeData?.avgGpa ?? -1;
    const gb = b.gradeData?.avgGpa ?? -1;
    return gb - ga;
  });

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: '#111827',
        border: '1px solid #374151',
        borderRadius: 12,
        marginBottom: 14,
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: '#1f2937',
          borderBottom: minimized ? 'none' : '1px solid #374151',
          cursor: 'pointer',
        }}
        onClick={() => setMinimized((m) => !m)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#500000', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Instructor Comparison
          </span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>{course}</span>
          <span style={{ fontSize: 10, color: '#4b5563', background: '#374151', padding: '1px 6px', borderRadius: 10 }}>
            {sorted.length} instructor{sorted.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: '#9ca3af', lineHeight: 1 }}>{minimized ? '▾' : '▴'}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Cards */}
      {!minimized && (
        <div style={{ padding: '14px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {sorted.map((inst, i) => (
            <InstructorCard key={inst.name} data={inst} rank={i} />
          ))}
        </div>
      )}
    </div>
  );
}
