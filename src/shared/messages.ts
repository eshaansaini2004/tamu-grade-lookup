import type { GradeData, RmpData } from './types';

export type Message =
  | { type: 'LOOKUP'; dept: string; number: string; instructorName: string }
  | { type: 'FETCH_SECTION_TIMES'; crn: string; termCode: string }
  | { type: 'OPEN_CALENDAR' }
  | { type: 'GET_PAGE_STATS' };

export interface LookupResponse {
  gradeData: GradeData | null;
  rmpData: RmpData | null;
}

export interface PageStats {
  sectionCount: number;
  instructorCount: number;
  courseCount: number;
  gpaMin: number | null;
  gpaMax: number | null;
}

export function sendGetPageStats(tabId: number): Promise<PageStats | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'GET_PAGE_STATS' } satisfies Message,
      (response: PageStats) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null);
          return;
        }
        resolve(response);
      },
    );
  });
}

export function sendLookup(
  dept: string,
  number: string,
  instructorName: string,
): Promise<LookupResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'LOOKUP', dept, number, instructorName } satisfies Message,
      (response: LookupResponse) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ gradeData: null, rmpData: null });
          return;
        }
        resolve(response);
      },
    );
  });
}
