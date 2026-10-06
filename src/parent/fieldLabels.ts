import { T } from '../copy/ko';
import type { FieldError } from '../lib/backend/errors';
import { errorText } from '../lib/errorText';
import { fieldId } from '../lib/survey';
import type { PublicForm, Question, SurveyDraft } from '../lib/types';
import type { SummaryError } from '../components/ui';

const COMMON_LABELS: Record<string, string> = {
  'common.parent_name': T.parent.basic.parentName,
  'common.parent_phone': T.parent.basic.parentPhone,
  'common.student_name': T.parent.basic.studentName,
  'common.grade': T.parent.basic.grade,
  'common.grade_note': T.parent.basic.gradeNote,
  'common.school_name': T.parent.basic.schoolName,
  'common.general_request': T.parent.basic.generalRequest,
  'common.consecutive_request': T.parent.schedule.consecutive,
  'common.consecutive_note': T.parent.schedule.consecutiveNote,
  consent: T.parent.review.consent,
  courses: T.parent.schedule.chooseTitle,
};

const SCHEDULE_LABELS: Record<string, string> = {
  start_date: T.parent.schedule.startDate,
  slots: T.parent.schedule.slots,
  duration: T.parent.schedule.duration,
  note: T.parent.schedule.note,
  sessions_per_week: T.parent.schedule.sessions,
  minutes: T.parent.schedule.minutes,
  mode: T.parent.schedule.mode,
  group_type: T.parent.schedule.groupType,
};

/** 오류 경로에 해당하는 질문 (문구 생성용) */
export function questionOfPath(path: string, form: PublicForm, draft: SurveyDraft): Question | undefined {
  let m = /^common\.answers\.(\w+)$/.exec(path);
  if (m) return form.common?.questions.find((q) => q.id === m![1]);
  m = /^courses\.(\d+)\.answers\.(\w+)$/.exec(path);
  if (m) {
    const course = form.courses?.find((c) => c.id === draft.selected[Number(m![1])]);
    return course?.questions.find((q) => q.id === m![2]);
  }
  return undefined;
}

export function labelOfPath(path: string, form: PublicForm, draft: SurveyDraft): string {
  if (COMMON_LABELS[path]) return COMMON_LABELS[path];
  const q = questionOfPath(path, form, draft);
  const m = /^courses\.(\d+)\.(\w+)(?:\.(\w+))?(?:\.(\w+))?/.exec(path);
  const course = m ? form.courses?.find((c) => c.id === draft.selected[Number(m[1])]) : undefined;
  const prefix = course && draft.selected.length > 1 ? `${course.subject_name} · ` : '';
  if (q) return prefix + q.label;
  if (!m) return path;
  if (m[2] === 'schedule') return prefix + (SCHEDULE_LABELS[m[3] ?? ''] ?? T.parent.steps.schedule);
  if (m[2] === 'homework_band') return prefix + T.parent.course.homework;
  if (m[2] === 'assessments') {
    const a = course ? draft.courses[course.id].assessments[Number(m[3])] : undefined;
    return prefix + (a?.name || T.parent.course.examTitle);
  }
  return prefix + path;
}

export function toSummary(errors: FieldError[], form: PublicForm, draft: SurveyDraft): SummaryError[] {
  const seen = new Set<string>();
  const out: SummaryError[] = [];
  for (const e of errors) {
    const id = fieldId(e.path);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ fieldId: id, label: labelOfPath(e.path, form, draft), message: errorText(e.path, e.code, questionOfPath(e.path, form, draft)) });
  }
  return out;
}

/** 경로별 오류 문구 조회 함수 */
export function errorLookup(errors: FieldError[], form: PublicForm, draft: SurveyDraft, maxFor?: Record<string, number>) {
  const map = new Map<string, string>();
  for (const e of errors) {
    if (map.has(e.path)) continue;
    map.set(e.path, errorText(e.path, e.code, questionOfPath(e.path, form, draft), maxFor?.[e.path]));
  }
  return (path: string) => map.get(path) ?? null;
}
