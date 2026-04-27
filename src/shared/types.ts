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
  color?: string;
  seatData?: SeatData;
  lastRefreshed?: number;
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

export interface Settings {
  defaultTerm: string;
  conflictHighlight: boolean;
  showRmp: boolean;
  showGradeBars: boolean;
}

export interface StorageSchema {
  savedSections: Record<string, SavedSection>;
  schedules: Schedule[];
  activeScheduleId: string | null;
  sectionOrder: string[];
  settings: Settings;
}

export interface ApiMeeting {
  daysRaw: string;
  startTime: number;
  endTime: number;
  location?: string;
  meetingType?: string;
}

export interface ApiSection {
  registrationNumber: string;
  sectionNumber?: string;
  credits?: number;
  instructor: { name: string; id?: string }[];
  meetings: ApiMeeting[];
}

export interface SeatData {
  openSeats: number | undefined;
  totalSeats: number | undefined;
  waitlistCount: number | undefined;
}

export type SectionStatus = 'OPEN' | 'WAITLISTED' | 'CLOSED';
