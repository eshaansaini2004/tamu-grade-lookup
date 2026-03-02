export interface GradeData {
  name: string;
  avgGpa: number;
  pctA: number;
  pctB: number;
  pctC: number;
  pctD: number;
  pctF: number;
  semCount: number;
}

export interface RmpData {
  rating: number;
  weighted: number;
  count: number;
}

export interface SavedSection {
  crn: string;
  dept: string;
  courseNumber: string;
  sectionNumber: string;
  instructorName: string;
  credits: number;
  meetingTimes: MeetingTime[];
  gradeData: GradeData | null;
  rmpData: RmpData | null;
  addedAt: number;
}

export interface MeetingTime {
  days: ('M' | 'T' | 'W' | 'R' | 'F')[];
  startMinutes: number;
  endMinutes: number;
  location: string;
}

export interface Schedule {
  id: string;
  name: string;
  sectionCrns: string[];
  createdAt: number;
}

export interface StorageSchema {
  savedSections: Record<string, SavedSection>;
  schedules: Schedule[];
  activeScheduleId: string | null;
}
