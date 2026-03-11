import type { StorageSchema, SavedSection } from './types';

const DEFAULTS: StorageSchema = {
  savedSections: {},
  schedules: [],
  activeScheduleId: null,
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
