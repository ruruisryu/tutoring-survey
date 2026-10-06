// 관리자 응답 목록: 검색·필터·정렬·페이지, 대시보드 집계
import { normalizePhone } from './phone';
import { addDays, seoulDateOfTimestamp, timeToMinutes } from './time';
import type { ConsultStatus, ListCourse, ListSubmission } from './types';

export interface ListFilter {
  q: string;
  subjectId: string;
  courseId: string;
  gradeKey: string; // 'middle-2' | 'other' | ''
  status: ConsultStatus | '';
  needsCheck: boolean;
  from: string; // 접수일 YYYY-MM-DD
  to: string;
  weekday: string; // '0'~'6' | ''
  timeFrom: string;
  timeTo: string;
}

export type SortKey = 'received_desc' | 'received_asc' | 'start_asc' | 'student';

export const EMPTY_FILTER: ListFilter = {
  q: '',
  subjectId: '',
  courseId: '',
  gradeKey: '',
  status: '',
  needsCheck: false,
  from: '',
  to: '',
  weekday: '',
  timeFrom: '',
  timeTo: '',
};

/** 수업 한 건이 확인 필요 상태인지 */
export function courseNeedsCheck(c: ListCourse): boolean {
  return c.unknown_count > 0 || c.status === 'needs_info';
}

export function totalUnknowns(s: ListSubmission): number {
  return s.unknown_count + s.courses.reduce((n, c) => n + c.unknown_count, 0);
}

function courseMatches(c: ListCourse, f: ListFilter): boolean {
  if (f.subjectId && c.subject_id !== f.subjectId) return false;
  if (f.courseId && c.course_id !== f.courseId) return false;
  if (f.status && c.status !== f.status) return false;
  if (f.weekday || f.timeFrom || f.timeTo) {
    const from = f.timeFrom ? timeToMinutes(f.timeFrom) : 0;
    const to = f.timeTo ? timeToMinutes(f.timeTo) : 24 * 60;
    const ok = c.slots.some(
      (s) =>
        (!f.weekday || String(s.weekday) === f.weekday) &&
        timeToMinutes(s.start_time) >= from &&
        timeToMinutes(s.start_time) <= to,
    );
    if (!ok) return false;
  }
  return true;
}

export function filterSubmissions(list: ListSubmission[], f: ListFilter): ListSubmission[] {
  const q = f.q.trim().toLowerCase();
  const qDigits = q.replace(/[^0-9]/g, '');
  const qPhone = normalizePhone(f.q) ?? (qDigits.length >= 4 ? qDigits : '');
  return list.filter((s) => {
    if (q) {
      const text = `${s.student_name} ${s.parent_name} ${s.receipt_code}`.toLowerCase();
      const phoneHit = qPhone !== '' && s.parent_phone.includes(qPhone);
      if (!text.includes(q) && !phoneHit) return false;
    }
    if (f.gradeKey) {
      const key = s.school_level === 'other' ? 'other' : `${s.school_level}-${s.grade}`;
      if (key !== f.gradeKey) return false;
    }
    const day = seoulDateOfTimestamp(s.received_at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    const courseFilterActive = f.subjectId || f.courseId || f.status || f.weekday || f.timeFrom || f.timeTo;
    const matching = courseFilterActive ? s.courses.filter((c) => courseMatches(c, f)) : s.courses;
    if (matching.length === 0) return false;
    if (f.needsCheck && !(s.unknown_count > 0 || matching.some(courseNeedsCheck))) return false;
    return true;
  });
}

function earliestStart(s: ListSubmission): string {
  const dates = s.courses.map((c) => c.preferred_start_date ?? c.fixed_start_date).filter((d): d is string => !!d);
  return dates.sort()[0] ?? '9999-12-31';
}

export function sortSubmissions(list: ListSubmission[], key: SortKey): ListSubmission[] {
  const out = [...list];
  switch (key) {
    case 'received_desc':
      return out.sort((a, b) => b.received_at.localeCompare(a.received_at));
    case 'received_asc':
      return out.sort((a, b) => a.received_at.localeCompare(b.received_at));
    case 'start_asc':
      return out.sort((a, b) => earliestStart(a).localeCompare(earliestStart(b)) || b.received_at.localeCompare(a.received_at));
    case 'student':
      return out.sort((a, b) => a.student_name.localeCompare(b.student_name, 'ko'));
  }
}

export function paginate<T>(list: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * size, p * size), page: p, pages };
}

// ---------------------------------------------------------------------------
// 대시보드
// ---------------------------------------------------------------------------
export interface DashboardStats {
  submissions: number;
  courseConsults: number;
  byStatus: Record<ConsultStatus, number>;
  needsCheck: number;
  bySubject: { subjectId: string | null; name: string; total: number; byStatus: Record<ConsultStatus, number> }[];
  upcoming: { submissionId: string; studentName: string; subjectName: string; courseName: string; date: string; overdue: boolean; today: boolean }[];
}

const zeroStatus = (): Record<ConsultStatus, number> => ({ new: 0, reviewing: 0, needs_info: 0, scheduled: 0, on_hold: 0 });

export function dashboardStats(list: ListSubmission[], today: string): DashboardStats {
  const byStatus = zeroStatus();
  const subjects = new Map<string, DashboardStats['bySubject'][number]>();
  const upcoming: DashboardStats['upcoming'] = [];
  let courseConsults = 0;
  let needsCheck = 0;
  for (const s of list) {
    for (const c of s.courses) {
      courseConsults++;
      byStatus[c.status]++;
      if (courseNeedsCheck(c)) needsCheck++;
      const key = c.subject_id ?? c.subject_name;
      let row = subjects.get(key);
      if (!row) {
        row = { subjectId: c.subject_id, name: c.subject_name, total: 0, byStatus: zeroStatus() };
        subjects.set(key, row);
      }
      row.total++;
      row.byStatus[c.status]++;
      if (c.next_contact_date && c.next_contact_date <= addDays(today, 14)) {
        upcoming.push({
          submissionId: s.id,
          studentName: s.student_name,
          subjectName: c.subject_name,
          courseName: c.course_name,
          date: c.next_contact_date,
          overdue: c.next_contact_date < today,
          today: c.next_contact_date === today,
        });
      }
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return {
    submissions: list.length,
    courseConsults,
    byStatus,
    needsCheck,
    bySubject: [...subjects.values()].sort((a, b) => b.total - a.total),
    upcoming,
  };
}
