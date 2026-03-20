import { useEffect, useState } from 'react';
import { storageGet, storageOnChanged } from '../shared/storage';
import type { SavedSection } from '../shared/types';
import WeeklyGrid from './components/WeeklyGrid';

export default function App() {
  const [sections, setSections] = useState<SavedSection[]>([]);

  useEffect(() => {
    storageGet('savedSections').then((saved) => setSections(Object.values(saved)));
    const unsub = storageOnChanged((changes) => {
      if (changes.savedSections) setSections(Object.values(changes.savedSections ?? {}));
    });
    return unsub;
  }, []);

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      background: '#111827',
      minHeight: '100vh',
      color: '#f9fafb',
      padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#f9fafb' }}>
          <span style={{ color: '#500000' }}>TAMU</span> Registration+
        </h1>
        <span style={{ fontSize: 12, color: '#4b5563' }}>Weekly Schedule</span>
      </div>

      {sections.length === 0 ? (
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          No saved sections. Save sections from Schedule Builder to see them here.
        </p>
      ) : (
        <WeeklyGrid sections={sections} />
      )}
    </div>
  );
}
