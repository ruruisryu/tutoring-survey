import { T } from '../copy/ko';
import { maxLengthOf } from './questions';
import type { Question } from './types';

/** 오류 코드를 입력란 옆에 보여줄 문구로 바꾼다. */
export function errorText(path: string, code: string, q?: Question, maxLen?: number): string {
  const E = T.errors;
  if (code === 'too_long') return E.too_long(maxLen ?? (q ? maxLengthOf(q) ?? 0 : systemMaxLength(path)));
  if (path.endsWith('.start_date')) {
    if (code === 'required') return E.startDateRequired;
    if (code === 'out_of_range') return E.startDateRange;
  }
  if (path.endsWith('.slots')) {
    if (code === 'required') return E.slotsRequired;
    if (code === 'slot_incomplete') return E.slotIncomplete;
    if (code === 'duplicate') return E.slotDuplicate;
    if (code === 'weekday_not_offered' || code === 'time_not_offered') return E.slotNotOffered;
  }
  if (path === 'courses') return T.parent.schedule.chooseError;
  if (path === 'common.grade') return E.gradeRequired;
  if (code === 'required') {
    if (path === 'common.parent_name') return E.parentNameRequired;
    if (path === 'common.parent_phone') return E.parentPhoneRequired;
    if (path === 'common.student_name') return E.studentNameRequired;
    if (path === 'common.grade_note') return E.gradeNoteRequired;
    if (path.endsWith('.name') && path.includes('.assessments.')) return E.assessmentNameRequired;
  }
  if (path.endsWith('.homework_band')) return E.homeworkRequired;
  if (path === 'consent') return T.parent.review.consentError;
  if (code === 'assessment_status') return E.assessmentStatus;
  if (code === 'empty_entry') return E.assessmentEmpty;
  if (code === 'before_start') return E.beforeStart;
  if (code === 'required') {
    if (q?.allow_unknown) return E.requiredWithUnknown(q.unknown_label || T.common.unknown);
    if (q?.type === 'multi' || q?.type === 'single') return E.requiredChoice;
    return E.required;
  }
  const known = (E as Record<string, unknown>)[code];
  return typeof known === 'string' ? known : E.invalid;
}

/** 기본 항목의 최대 글자 수 (서버 검증과 같은 값) */
export const SYSTEM_MAX = {
  parent_name: 30,
  student_name: 30,
  grade_note: 30,
  school_name: 40,
  general_request: 1000,
  consecutive_note: 300,
  schedule_note: 500,
  duration: 60,
  assessment_name: 30,
  assessment_scope: 300,
} as const;

export function systemMaxLength(path: string): number {
  const last = path.split('.').pop() ?? '';
  if (path.includes('.assessments.')) return last === 'scope' ? SYSTEM_MAX.assessment_scope : SYSTEM_MAX.assessment_name;
  if (path.includes('.schedule.')) return last === 'duration' ? SYSTEM_MAX.duration : SYSTEM_MAX.schedule_note;
  return (SYSTEM_MAX as Record<string, number>)[last] ?? 0;
}
