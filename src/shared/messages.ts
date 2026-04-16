import type { GradeData, RmpData, ApiSection } from './types';

export type Message =
  | { type: 'LOOKUP'; dept: string; number: string; instructorName: string }
  | { type: 'FETCH_SECTION_TIMES'; crn: string; termCode: string }
  | { type: 'OPEN_CALENDAR' }
  | { type: 'GET_PAGE_STATS' }
  | { type: 'COURSE_SEARCH'; dept: string; number: string }
  | { type: 'FETCH_SECTIONS'; dept: string; number: string; term: string }
  | { type: 'ADD_COURSE_TO_BUILDER'; dept: string; number: string; term: string; sectionCrns: string[] }
  | { type: 'REFRESH_SECTIONS'; term: string };

export interface RankedInstructor {
  name: string;
  gradeData: GradeData;
  rmpData: RmpData | null;
  score: number;
}

export interface CourseSearchResponse {
  instructors: RankedInstructor[];
}

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

export interface FetchSectionsResponse {
  sections: ApiSection[];
}

export function sendFetchSections(dept: string, number: string, term: string): Promise<ApiSection[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 10_000);
    chrome.runtime.sendMessage(
      { type: 'FETCH_SECTIONS', dept, number, term } satisfies Message,
      (response: FetchSectionsResponse) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve([]);
          return;
        }
        resolve(response.sections ?? []);
      },
    );
  });
}

export interface AddCourseResponse {
  ok: boolean;
}

export function sendAddCourseToBuilder(
  dept: string,
  number: string,
  term: string,
  sectionCrns: string[],
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12_000);
    chrome.runtime.sendMessage(
      { type: 'ADD_COURSE_TO_BUILDER', dept, number, term, sectionCrns } satisfies Message,
      (response: AddCourseResponse) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve(false);
          return;
        }
        resolve(response.ok ?? false);
      },
    );
  });
}

export function sendCourseSearch(dept: string, number: string): Promise<CourseSearchResponse> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ instructors: [] }), 15_000);
    chrome.runtime.sendMessage(
      { type: 'COURSE_SEARCH', dept, number } satisfies Message,
      (response: CourseSearchResponse) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve({ instructors: [] });
          return;
        }
        resolve(response);
      },
    );
  });
}

export interface RefreshSectionsResponse {
  updatedCount: number;
  timestamp: number;
  error?: boolean;
}

export function sendRefreshSections(term: string): Promise<RefreshSectionsResponse | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 30_000);
    chrome.runtime.sendMessage(
      { type: 'REFRESH_SECTIONS', term } satisfies Message,
      (response: RefreshSectionsResponse) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve(null);
          return;
        }
        resolve(response);
      },
    );
  });
}
