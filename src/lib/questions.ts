// 질문 표시 조건과 답변 검증. 서버 함수 public.answers_errors 와 같은 규칙을 따른다.
import type { Answer, Answers, Question } from './types';
import type { FieldError } from './backend/errors';

export const DEFAULT_MAX_LENGTH = { short_text: 100, long_text: 1000 } as const;

export function maxLengthOf(q: Question): number | undefined {
  if (q.type === 'short_text' || q.type === 'long_text') return q.max_length ?? DEFAULT_MAX_LENGTH[q.type];
  return undefined;
}

/** 수업에 적용되는 활성 질문 (서버 applicable_questions 와 동일) */
export function applicableQuestions(questions: Question[], courseId: string | null): Question[] {
  return questions.filter(
    (q) => q.active && (courseId === null || !q.course_ids || q.course_ids.length === 0 || q.course_ids.includes(courseId)),
  );
}

/** 학생 학년이 질문의 적용 학년에 드는지 (적용 학년이 없으면 모두) */
export function gradeMatches(q: Question, gradeKey: string | null | undefined): boolean {
  return !q.grades || q.grades.length === 0 || (!!gradeKey && q.grades.includes(gradeKey));
}

/** 질문별 표시 여부. 조건 질문이 숨겨져 있으면 뒤따르는 질문도 숨긴다. (서버 answers_errors 와 같은 규칙) */
export function visibilityMap(questions: Question[], answers: Answers, gradeKey?: string | null): Record<string, boolean> {
  const visible: Record<string, boolean> = {};
  for (const q of questions) {
    let vis = gradeMatches(q, gradeKey);
    if (vis && q.show_if) {
      vis = visible[q.show_if.question] === true;
      if (vis) {
        const dep = answers[q.show_if.question];
        vis =
          !!dep &&
          dep.status === 'answered' &&
          (typeof dep.value === 'string'
            ? q.show_if.any_of.includes(dep.value)
            : Array.isArray(dep.value)
              ? dep.value.some((v) => q.show_if!.any_of.includes(v))
              : false);
      }
    }
    visible[q.id] = vis;
  }
  return visible;
}

/** 숨겨진 질문의 답과 빈 답을 지워 서버로 보낼 답변만 남긴다. */
export function cleanAnswers(questions: Question[], answers: Answers, gradeKey?: string | null): Answers {
  const vis = visibilityMap(questions, answers, gradeKey);
  const out: Answers = {};
  for (const q of questions) {
    const a = answers[q.id];
    if (!vis[q.id] || !a) continue;
    if (a.status === 'unknown') {
      out[q.id] = { status: 'unknown' };
      continue;
    }
    const v = a.value;
    if (typeof v === 'string') {
      if (v.trim() === '') continue;
      out[q.id] = { status: 'answered', value: q.type === 'single' ? v : v.trim() };
    } else if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[q.id] = { status: 'answered', value: [...v] };
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[q.id] = { status: 'answered', value: v };
    }
  }
  return out;
}

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidDateText(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function answerError(q: Question, a: Answer): string | null {
  if (a.status === 'unknown') return q.allow_unknown ? null : 'unknown_not_allowed';
  const v = a.value;
  switch (q.type) {
    case 'short_text':
    case 'long_text': {
      if (typeof v !== 'string') return 'invalid';
      if (v.trim() === '') return 'required';
      if (v.length > maxLengthOf(q)!) return 'too_long';
      return null;
    }
    case 'single':
      return typeof v === 'string' && (q.options ?? []).some((o) => o.value === v) ? null : 'invalid_option';
    case 'multi': {
      if (!Array.isArray(v) || v.length === 0) return 'required';
      const opts = q.options ?? [];
      if (new Set(v).size !== v.length || v.some((x) => !opts.some((o) => o.value === x))) return 'invalid_option';
      const exclusive = v.filter((x) => opts.find((o) => o.value === x)?.exclusive).length;
      if (exclusive > 0 && v.length > 1) return 'exclusive_option';
      return null;
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'invalid';
      if ((q.min !== undefined && v < q.min) || (q.max !== undefined && v > q.max)) return 'out_of_range';
      return null;
    case 'date':
      return typeof v === 'string' && isValidDateText(v) ? null : 'invalid';
    case 'time':
      return typeof v === 'string' && TIME_RE.test(v) ? null : 'invalid';
  }
}

/** 화면 검증. 서버와 같은 경로 형식(prefix.questionId)으로 오류를 돌려준다. */
export function validateAnswers(questions: Question[], answers: Answers, prefix: string, gradeKey?: string | null): FieldError[] {
  const errors: FieldError[] = [];
  const cleaned = cleanAnswers(questions, answers, gradeKey);
  const vis = visibilityMap(questions, cleaned, gradeKey);
  for (const q of questions) {
    if (!vis[q.id]) continue;
    const a = cleaned[q.id];
    if (!a) {
      if (q.required) errors.push({ path: `${prefix}.${q.id}`, code: 'required' });
      continue;
    }
    const code = answerError(q, a);
    if (code) errors.push({ path: `${prefix}.${q.id}`, code });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 질문 정의 검증 (양식 편집기). 서버 questions_error 의 주요 규칙과 같다.
// ---------------------------------------------------------------------------
export const QUESTION_ID_RE = /^[a-z][a-z0-9_]{1,40}$/;
export const OPTION_VALUE_RE = /^[a-z0-9_]{1,40}$/;
export const GRADE_KEY_RE = /^(elementary-[1-6]|middle-[1-3]|high-[1-3])$/;

export interface QuestionDefError {
  questionId: string | null;
  index: number;
  code: string;
}

export function validateQuestionDefs(questions: Question[]): QuestionDefError[] {
  const errors: QuestionDefError[] = [];
  const seen = new Map<string, Question>();
  questions.forEach((q, index) => {
    const push = (code: string) => errors.push({ questionId: q.id, index, code });
    if (!QUESTION_ID_RE.test(q.id)) push('bad_id');
    else if (seen.has(q.id)) push('duplicate_id');
    if (q.label.trim().length < 1 || q.label.length > 200) push('bad_label');
    if ((q.help ?? '').length > 300) push('bad_help');
    if (q.type === 'single' || q.type === 'multi') {
      const opts = q.options ?? [];
      if (opts.length < 1 || opts.length > 30) push('bad_options');
      const values = new Set<string>();
      for (const o of opts) {
        if (!OPTION_VALUE_RE.test(o.value) || o.label.trim() === '' || o.label.length > 100) push('bad_option');
        if (values.has(o.value)) push('duplicate_option');
        values.add(o.value);
      }
    }
    if (q.max_length !== undefined) {
      const limit = q.type === 'short_text' ? 200 : q.type === 'long_text' ? 2000 : 0;
      if (!Number.isInteger(q.max_length) || q.max_length < 1 || q.max_length > limit) push('bad_max_length');
    }
    if (q.grades && q.grades.some((g) => !GRADE_KEY_RE.test(g))) push('bad_grades');
    if (q.show_if) {
      const ref = seen.get(q.show_if.question);
      if (!ref || (ref.type !== 'single' && ref.type !== 'multi')) push('show_if_ref');
      else if (q.show_if.any_of.length === 0 || q.show_if.any_of.some((v) => !(ref.options ?? []).some((o) => o.value === v)))
        push('show_if_option');
    }
    seen.set(q.id, q);
  });
  return errors;
}

/** 서버로 보낼 질문 정의 (빈 선택 속성 정리) */
export function normalizeQuestionDef(q: Question): Question {
  const out: Question = { id: q.id, type: q.type, label: q.label.trim(), required: q.required, active: q.active };
  if (q.help && q.help.trim()) out.help = q.help.trim();
  if (q.allow_unknown) {
    out.allow_unknown = true;
    out.unknown_label = (q.unknown_label ?? '').trim() || '모름';
  }
  if (q.type === 'single' || q.type === 'multi') {
    out.options = (q.options ?? []).map((o) => (o.exclusive ? { value: o.value, label: o.label.trim(), exclusive: true } : { value: o.value, label: o.label.trim() }));
  }
  if ((q.type === 'short_text' || q.type === 'long_text') && q.max_length) out.max_length = q.max_length;
  if (q.type === 'number') {
    if (q.min !== undefined) out.min = q.min;
    if (q.max !== undefined) out.max = q.max;
  }
  if (q.course_ids && q.course_ids.length) out.course_ids = [...q.course_ids];
  if (q.grades && q.grades.length) out.grades = [...q.grades];
  if (q.show_if) out.show_if = { question: q.show_if.question, any_of: [...q.show_if.any_of] };
  if (q.role) out.role = q.role;
  if (q.followup && q.followup.trim()) out.followup = q.followup.trim();
  if (q.locked) out.locked = true;
  return out;
}

export function answerToText(q: Question | undefined, a: Answer | undefined): string {
  if (!a) return '';
  if (a.status === 'unknown') return q?.unknown_label || '모름';
  const v = a.value;
  if (Array.isArray(v)) return v.map((x) => q?.options?.find((o) => o.value === x)?.label ?? x).join(', ');
  if (typeof v === 'string' && q?.type === 'single') return q.options?.find((o) => o.value === v)?.label ?? v;
  return String(v);
}
