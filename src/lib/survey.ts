// 학부모 설문: 초안 생성, 단계 구성, 단계별 검증, 제출 데이터 생성
import type { FieldError } from './backend/errors';
import { applicableQuestions, cleanAnswers, isValidDateText, validateAnswers } from './questions';
import { normalizePhone } from './phone';
import { addDays, timeInBands } from './time';
import type {
  AssessmentDraft,
  CourseDraft,
  PublicCourse,
  PublicForm,
  ScheduleDraft,
  SurveyDraft,
} from './types';

export const GRADE_OPTIONS: { key: string; level: 'elementary' | 'middle' | 'high'; grade: number; label: string }[] = [
  ...[1, 2, 3, 4, 5, 6].map((g) => ({ key: `elementary-${g}`, level: 'elementary' as const, grade: g, label: `초등학교 ${g}학년` })),
  ...[1, 2, 3].map((g) => ({ key: `middle-${g}`, level: 'middle' as const, grade: g, label: `중학교 ${g}학년` })),
  ...[1, 2, 3].map((g) => ({ key: `high-${g}`, level: 'high' as const, grade: g, label: `고등학교 ${g}학년` })),
];

/** 학교급·학년 → 'middle-2' 형식 키 (기타는 'other') */
export function gradeKeyOf(level: string, grade: number | null): string {
  return level === 'other' || !grade ? 'other' : `${level}-${grade}`;
}

let keySeq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function defaultAssessments(): AssessmentDraft[] {
  return [
    { key: newKey(), kind: 'midterm', name: '중간고사', status: '', period_start: '', period_end: '', exam_date: '', scope: '' },
    { key: newKey(), kind: 'final', name: '기말고사', status: '', period_start: '', period_end: '', exam_date: '', scope: '' },
  ];
}

export function emptySchedule(): ScheduleDraft {
  return {
    start_date: '',
    start_undecided: false,
    time_undecided: false,
    slots: [],
    duration: '',
    sessions_per_week: null,
    minutes: null,
    mode: null,
    group_type: null,
    note: '',
  };
}

export function emptyCourseDraft(courseId: string): CourseDraft {
  return { course_id: courseId, schedule: emptySchedule(), answers: {}, assessments: defaultAssessments(), homework_band: '' };
}

export function createDraft(form: PublicForm): SurveyDraft {
  const courses = form.courses ?? [];
  const selected = !form.allow_multiple || courses.length === 1 ? courses.map((c) => c.id).slice(0, 1) : [];
  return {
    common: {
      parent_name: '',
      parent_phone: '',
      student_name: '',
      grade_key: '',
      grade_note: '',
      school_name: '',
      general_request: '',
      consecutive_request: '',
      consecutive_note: '',
      answers: {},
    },
    selected,
    courses: Object.fromEntries(courses.map((c) => [c.id, emptyCourseDraft(c.id)])),
    consent: false,
    website: '',
  };
}

export const isFixed = (c: PublicCourse, k: PublicCourse['fixed_conditions'][number]) => c.fixed_conditions.includes(k);
export const needsSlots = (c: PublicCourse) => !(isFixed(c, 'weekdays') && isFixed(c, 'start_time'));

// ---------------------------------------------------------------------------
// 단계
// ---------------------------------------------------------------------------
export type StepId = 'basic' | 'schedule' | `course:${string}` | 'review';

export function stepsFor(draft: SurveyDraft): StepId[] {
  return ['basic', 'schedule', ...draft.selected.map((id) => `course:${id}` as const), 'review'];
}

export function estimateMinutes(form: PublicForm, selectedIds: string[]): number {
  const courses = (form.courses ?? []).filter((c) => selectedIds.length === 0 || selectedIds.includes(c.id));
  const pick = selectedIds.length === 0 ? courses.slice(0, 1) : courses;
  let items = 6 + (form.common?.questions.length ?? 0) + 2;
  for (const c of pick) items += applicableQuestions(c.questions, c.id).length + 4 + 3;
  return Math.max(3, Math.ceil((items * 15) / 60));
}

// ---------------------------------------------------------------------------
// 검증 (서버와 같은 경로·코드)
// ---------------------------------------------------------------------------
function textErr(v: string, required: boolean, max: number): string | null {
  if (v.trim() === '') return required ? 'required' : null;
  if (v.length > max) return 'too_long';
  return null;
}

export function validateBasic(form: PublicForm, draft: SurveyDraft): FieldError[] {
  const c = draft.common;
  const errs: FieldError[] = [];
  const add = (path: string, code: string | null) => code && errs.push({ path, code });
  add('common.parent_name', textErr(c.parent_name, true, 30));
  if (c.parent_phone.trim() === '') add('common.parent_phone', 'required');
  else if (!normalizePhone(c.parent_phone)) add('common.parent_phone', 'invalid_phone');
  add('common.student_name', textErr(c.student_name, true, 30));
  if (!c.grade_key) add('common.grade', 'required');
  else if (c.grade_key === 'other') add('common.grade_note', textErr(c.grade_note, true, 30));
  add('common.school_name', textErr(c.school_name, false, 40));
  add('common.general_request', textErr(c.general_request, false, 1000));
  errs.push(...validateAnswers(form.common?.questions ?? [], c.answers, 'common.answers', c.grade_key));
  return errs;
}

export function validateSchedule(course: PublicCourse, s: ScheduleDraft, prefix: string, today: string): FieldError[] {
  const errs: FieldError[] = [];
  if (!isFixed(course, 'start_date')) {
    if (s.start_undecided && s.start_date) errs.push({ path: `${prefix}.start_date`, code: 'conflict_undecided' });
    else if (!s.start_undecided && !s.start_date) errs.push({ path: `${prefix}.start_date`, code: 'required' });
    else if (!s.start_undecided) {
      if (!isValidDateText(s.start_date)) errs.push({ path: `${prefix}.start_date`, code: 'invalid' });
      else if (s.start_date < today || s.start_date > addDays(today, 366))
        errs.push({ path: `${prefix}.start_date`, code: 'out_of_range' });
    }
  }
  if (needsSlots(course)) {
    if (s.time_undecided && s.slots.length > 0) errs.push({ path: `${prefix}.slots`, code: 'conflict_undecided' });
    else if (!s.time_undecided && s.slots.length === 0) errs.push({ path: `${prefix}.slots`, code: 'required' });
    else if (!s.time_undecided) {
      const seen = new Set<string>();
      let code: string | null = null;
      for (const sl of s.slots) {
        if (sl.weekday < 0 || !sl.start_time) code ??= 'slot_incomplete';
        else if (course.weekdays.length > 0 && !course.weekdays.includes(sl.weekday)) code ??= 'weekday_not_offered';
        else if (isFixed(course, 'start_time') && course.start_time && sl.start_time !== course.start_time) code ??= 'time_not_offered';
        else if (!isFixed(course, 'start_time') && !timeInBands(sl.start_time, course.time_bands)) code ??= 'time_not_offered';
        const k = `${sl.weekday} ${sl.start_time}`;
        if (seen.has(k)) code ??= 'duplicate';
        seen.add(k);
      }
      if (s.slots.length > 14) code ??= 'too_many';
      if (code) errs.push({ path: `${prefix}.slots`, code });
    }
  }
  if (!isFixed(course, 'sessions') && s.sessions_per_week !== null && course.session_choices?.length && !course.session_choices.includes(s.sessions_per_week))
    errs.push({ path: `${prefix}.sessions_per_week`, code: 'invalid_option' });
  if (s.note.length > 500) errs.push({ path: `${prefix}.note`, code: 'too_long' });
  if (s.duration.length > 60) errs.push({ path: `${prefix}.duration`, code: 'too_long' });
  return errs;
}

export function validateAssessments(list: AssessmentDraft[], prefix: string): FieldError[] {
  const errs: FieldError[] = [];
  list.forEach((a, i) => {
    const p = `${prefix}.${i}`;
    const nameErr = textErr(a.name, true, 30);
    if (nameErr) errs.push({ path: `${p}.name`, code: nameErr });
    if (!a.status) {
      errs.push({ path: `${p}.status`, code: 'assessment_status' });
      return;
    }
    if (a.status !== 'entered') return;
    if (!a.period_start && !a.period_end && !a.exam_date && a.scope.trim() === '') errs.push({ path: p, code: 'empty_entry' });
    if (a.period_start && !isValidDateText(a.period_start)) errs.push({ path: `${p}.period_start`, code: 'invalid' });
    if (a.period_end && !isValidDateText(a.period_end)) errs.push({ path: `${p}.period_end`, code: 'invalid' });
    if (a.exam_date && !isValidDateText(a.exam_date)) errs.push({ path: `${p}.exam_date`, code: 'invalid' });
    if (a.period_start && a.period_end && a.period_start > a.period_end) errs.push({ path: `${p}.period_end`, code: 'before_start' });
    if (a.scope.length > 300) errs.push({ path: `${p}.scope`, code: 'too_long' });
  });
  return errs;
}

export function validateScheduleStep(form: PublicForm, draft: SurveyDraft, today: string): FieldError[] {
  const errs: FieldError[] = [];
  if (draft.selected.length === 0) errs.push({ path: 'courses', code: 'required' });
  draft.selected.forEach((id, i) => {
    const course = form.courses!.find((c) => c.id === id)!;
    errs.push(...validateSchedule(course, draft.courses[id].schedule, `courses.${i}.schedule`, today));
  });
  if (draft.selected.length > 1 && draft.common.consecutive_note.length > 300)
    errs.push({ path: 'common.consecutive_note', code: 'too_long' });
  return errs;
}

export function validateCourseStep(form: PublicForm, draft: SurveyDraft, courseId: string): FieldError[] {
  const i = draft.selected.indexOf(courseId);
  const course = form.courses!.find((c) => c.id === courseId)!;
  const cd = draft.courses[courseId];
  const errs = [
    ...validateAnswers(applicableQuestions(course.questions, course.id), cd.answers, `courses.${i}.answers`, draft.common.grade_key),
    ...validateAssessments(cd.assessments, `courses.${i}.assessments`),
  ];
  if (!cd.homework_band) errs.push({ path: `courses.${i}.homework_band`, code: 'required' });
  return errs;
}

export function validateStep(form: PublicForm, draft: SurveyDraft, step: StepId, today: string): FieldError[] {
  if (step === 'basic') return validateBasic(form, draft);
  if (step === 'schedule') return validateScheduleStep(form, draft, today);
  if (step === 'review') return draft.consent ? [] : [{ path: 'consent', code: 'required' }];
  return validateCourseStep(form, draft, step.slice('course:'.length));
}

export function validateAll(form: PublicForm, draft: SurveyDraft, today: string): FieldError[] {
  return stepsFor(draft).flatMap((s) => validateStep(form, draft, s, today));
}

/** 오류 경로가 속한 단계 */
export function stepOfPath(path: string, draft: SurveyDraft): StepId {
  if (path === 'consent') return 'review';
  if (path.startsWith('common.consecutive')) return 'schedule';
  if (path.startsWith('common')) return 'basic';
  const m = /^courses\.(\d+)\.(\w+)/.exec(path);
  if (!m) return 'schedule';
  if (m[2] === 'schedule') return 'schedule';
  const id = draft.selected[Number(m[1])];
  return id ? `course:${id}` : 'schedule';
}

/** 오류 경로 → 화면 요소 id */
export function fieldId(path: string): string {
  return 'f-' + path.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ---------------------------------------------------------------------------
// 제출 데이터
// ---------------------------------------------------------------------------
export function buildPayload(form: PublicForm, draft: SurveyDraft) {
  const c = draft.common;
  const grade = GRADE_OPTIONS.find((g) => g.key === c.grade_key);
  const multi = draft.selected.length > 1;
  return {
    website: draft.website,
    loaded_at: form.loaded_at ?? null,
    consent: draft.consent,
    common: {
      parent_name: c.parent_name.trim(),
      parent_phone: normalizePhone(c.parent_phone) ?? c.parent_phone.trim(),
      student_name: c.student_name.trim(),
      school_level: c.grade_key === 'other' ? 'other' : grade?.level ?? null,
      grade: grade?.grade ?? null,
      grade_note: c.grade_key === 'other' ? c.grade_note.trim() : '',
      school_name: c.school_name.trim(),
      general_request: c.general_request.trim(),
      consecutive_request: multi ? c.consecutive_request : '',
      consecutive_note: multi ? c.consecutive_note.trim() : '',
      version_id: form.common?.version_id ?? null,
      answers: cleanAnswers(form.common?.questions ?? [], c.answers, c.grade_key),
    },
    courses: draft.selected.map((id) => {
      const course = form.courses!.find((x) => x.id === id)!;
      const cd = draft.courses[id];
      const s = cd.schedule;
      const schedule: Record<string, unknown> = {
        time_undecided: needsSlots(course) ? s.time_undecided : false,
        slots: needsSlots(course) && !s.time_undecided ? s.slots.map((x) => ({ weekday: x.weekday, start_time: x.start_time })) : [],
        note: s.note.trim(),
      };
      if (!isFixed(course, 'start_date')) {
        schedule.start_undecided = s.start_undecided;
        schedule.start_date = s.start_undecided ? null : s.start_date || null;
      }
      if (!isFixed(course, 'duration')) schedule.duration = s.duration.trim();
      if (!isFixed(course, 'sessions')) schedule.sessions_per_week = s.sessions_per_week;
      if (!isFixed(course, 'minutes')) schedule.minutes = s.minutes;
      if (course.mode === 'negotiable') schedule.mode = s.mode;
      if (course.group_type === 'negotiable') schedule.group_type = s.group_type;
      return {
        course_id: id,
        version_id: course.version_id,
        schedule,
        homework_band: cd.homework_band,
        answers: cleanAnswers(applicableQuestions(course.questions, course.id), cd.answers, c.grade_key),
        assessments: cd.assessments
          .filter((a) => a.status)
          .map((a) =>
            a.status === 'entered'
              ? {
                  kind: a.kind,
                  name: a.name.trim(),
                  status: a.status,
                  period_start: a.period_start || null,
                  period_end: a.period_end || null,
                  exam_date: a.exam_date || null,
                  scope: a.scope.trim(),
                }
              : { kind: a.kind, name: a.name.trim(), status: a.status },
          ),
      };
    }),
  };
}

export type SubmitPayload = ReturnType<typeof buildPayload>;
