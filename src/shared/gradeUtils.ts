import type { GradeData } from './types';

export function gpaColorClass(avgGpa: number | null | undefined): string {
  if (avgGpa == null) return 'trp-gpa-gray';
  if (avgGpa >= 3.5) return 'trp-gpa-green';
  if (avgGpa >= 2.5) return 'trp-gpa-yellow';
  return 'trp-gpa-red';
}

export function pct(n: number, total: number): number {
  return Math.round((n / total) * 100);
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

interface RawGradeRow {
  prof: string;
  semester: string;
  year: string;
  A: string;
  B: string;
  C: string;
  D: string;
  F: string;
  gpa: string;
}

export function parseGradeRows(rows: RawGradeRow[]): Record<string, GradeData> {
  const byName: Record<string, {
    name: string; a: number; b: number; c: number; d: number; f: number;
    gpas: number[]; sems: Set<string>;
  }> = {};

  for (const row of rows) {
    const name = (row.prof || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName[key]) byName[key] = { name, a: 0, b: 0, c: 0, d: 0, f: 0, gpas: [], sems: new Set() };
    const p = byName[key];
    p.a += parseInt(row.A) || 0;
    p.b += parseInt(row.B) || 0;
    p.c += parseInt(row.C) || 0;
    p.d += parseInt(row.D) || 0;
    p.f += parseInt(row.F) || 0;
    const gpa = parseFloat(row.gpa);
    if (gpa > 0) p.gpas.push(gpa);
    const sem = `${capitalize(row.semester || '')} ${row.year || ''}`.trim();
    if (sem) p.sems.add(sem);
  }

  const result: Record<string, GradeData> = {};
  for (const [key, d] of Object.entries(byName)) {
    const total = d.a + d.b + d.c + d.d + d.f || 1;
    const avgGpa = d.gpas.length ? d.gpas.reduce((s, x) => s + x, 0) / d.gpas.length : 0;
    result[key] = {
      name: d.name,
      avgGpa: Math.round(avgGpa * 100) / 100,
      pctA: pct(d.a, total),
      pctB: pct(d.b, total),
      pctC: pct(d.c, total),
      pctD: pct(d.d, total),
      pctF: pct(d.f, total),
      semCount: d.sems.size,
    };
  }
  return result;
}
