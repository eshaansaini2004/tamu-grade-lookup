import type { StorageSchema, SavedSection } from './types';

const DEFAULTS: StorageSchema = {
  savedSections: {},
  schedules: [],
  activeScheduleId: null,
  sectionOrder: [],
};

export async function storageGet<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key);
  return (result[key] ?? DEFAULTS[key]) as StorageSchema[K];
}

export async function storageSet<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export function storageOnChanged(callback: (changes: Partial<StorageSchema>) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const parsed: Partial<StorageSchema> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (k in DEFAULTS) {
        (parsed as Record<string, unknown>)[k] = v.newValue;
      }
    }
    if (Object.keys(parsed).length > 0) callback(parsed);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// Serializes concurrent read-modify-write ops on savedSections
let sectionWriteLock: Promise<void> = Promise.resolve();

export async function saveSection(section: SavedSection): Promise<void> {
  sectionWriteLock = sectionWriteLock.then(async () => {
    const sections = await storageGet('savedSections');
    sections[section.crn] = section;
    await storageSet('savedSections', sections);
  });
  await sectionWriteLock;
}

export async function removeSection(crn: string): Promise<void> {
  sectionWriteLock = sectionWriteLock.then(async () => {
    const sections = await storageGet('savedSections');
    delete sections[crn];
    await storageSet('savedSections', sections);
  });
  await sectionWriteLock;
}

// Serializes concurrent read-modify-write ops on schedules
let scheduleWriteLock: Promise<void> = Promise.resolve();

export async function saveSchedule(schedule: import('./types').Schedule): Promise<void> {
  scheduleWriteLock = scheduleWriteLock.then(async () => {
    const schedules = await storageGet('schedules');
    const idx = schedules.findIndex((s) => s.id === schedule.id);
    if (idx >= 0) schedules[idx] = schedule;
    else schedules.push(schedule);
    await storageSet('schedules', schedules);
  });
  await scheduleWriteLock;
}

export async function deleteSchedule(id: string): Promise<void> {
  scheduleWriteLock = scheduleWriteLock.then(async () => {
    const schedules = await storageGet('schedules');
    await storageSet('schedules', schedules.filter((s) => s.id !== id));
    const active = await storageGet('activeScheduleId');
    if (active === id) await storageSet('activeScheduleId', null);
  });
  await scheduleWriteLock;
}

export async function setActiveSchedule(id: string | null): Promise<void> {
  await storageSet('activeScheduleId', id);
}

export async function saveSectionOrder(order: string[]): Promise<void> {
  await storageSet('sectionOrder', order);
}

// Atomic toggle of a CRN within a schedule — avoids stale-closure race
export async function toggleCrnInSchedule(scheduleId: string, crn: string): Promise<void> {
  scheduleWriteLock = scheduleWriteLock.then(async () => {
    const schedules = await storageGet('schedules');
    const sched = schedules.find((s) => s.id === scheduleId);
    if (!sched) return;
    const has = sched.sectionCrns.includes(crn);
    sched.sectionCrns = has
      ? sched.sectionCrns.filter((c) => c !== crn)
      : [...sched.sectionCrns, crn];
    await storageSet('schedules', schedules);
  });
  await scheduleWriteLock;
}
