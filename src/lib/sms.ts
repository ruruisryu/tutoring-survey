// 규칙 기반 확인 문자 초안. 외부 AI 없이 동작하며 자동으로 보내지 않는다.
import { formatDateKo, formatSlot, sortSlots } from './time';
import { commonUnknowns, courseUnknowns, type UnknownItem } from './unknowns';
import type { DetailCourse, SubmissionDetail } from './types';

export interface SmsOptions {
  teacherName: string;
  courseIds: string[]; // submission_course id
  includeSchedule: boolean;
}

// 여러 수업에서 같은 내용을 물을 때 한 번만 묻는 항목 (일정·시험 기간은 수업이 달라도 같은 답인 경우가 많다)
const MERGEABLE = (item: UnknownItem) => item.kind === 'schedule' || item.kind === 'assessment';

function subjectOf(c: DetailCourse) {
  return c.course.subject_name || c.course.name;
}

/** ‘을/를’처럼 받침에 따라 바뀌는 조사를 피하려고 질문은 ‘~: 알려주세요’ 형태로 통일한다. */
function questionLine(item: UnknownItem, subjects?: string[]) {
  const suffix = subjects && subjects.length > 0 ? ` (${subjects.join('·')})` : '';
  return item.undecided ? `- ${item.ask}${suffix}: 정해지면 알려주세요.` : `- ${item.ask}${suffix}`;
}

export function scheduleSummary(c: DetailCourse): string {
  const minutes = c.consultation.confirmed_minutes ?? c.course.minutes_per_session ?? null;
  const confirmedSlots = sortSlots(c.consultation.slots);
  const parts: string[] = [];
  if (confirmedSlots.length > 0 || c.consultation.confirmed_start_date) {
    const slotText = confirmedSlots.map((s) => formatSlot(s, minutes)).join(', ');
    const start = c.consultation.confirmed_start_date ? `${formatDateKo(c.consultation.confirmed_start_date)} 시작` : '';
    parts.push(`확정: ${[slotText, start].filter(Boolean).join(', ')}`);
  } else {
    const wishSlots = sortSlots(c.schedule.slots).map((s) => formatSlot(s, c.schedule.minutes ?? c.course.minutes_per_session));
    const wishStart = c.schedule.start_date ? `${formatDateKo(c.schedule.start_date)}부터` : '';
    const wish = [wishSlots.join(', '), wishStart].filter(Boolean).join(', ');
    parts.push(wish ? `희망하신 일정: ${wish} (아직 확정 전입니다)` : '일정은 상담하면서 정하겠습니다.');
  }
  return parts.join(' ');
}

export function buildSmsDraft(detail: SubmissionDetail, opts: SmsOptions): string {
  const courses = detail.courses.filter((c) => opts.courseIds.includes(c.id));
  const greeting = opts.teacherName.trim()
    ? `안녕하세요, ${opts.teacherName.trim()} 선생님입니다.`
    : '안녕하세요, 수업 상담 관련해 연락드립니다.';
  const lines: string[] = [greeting, `${detail.student_name} 학생 상담 내용 잘 받았습니다.`];

  // 공통 질문 + 여러 수업에 같은 내용
  const common: string[] = commonUnknowns(detail).map((i) => questionLine(i));
  const perCourse = courses.map((c) => ({ course: c, items: courseUnknowns(c) }));
  const mergedKeys = new Map<string, { item: UnknownItem; subjects: string[] }>();
  for (const { course, items } of perCourse) {
    for (const item of items.filter(MERGEABLE)) {
      const hit = mergedKeys.get(item.key);
      if (hit) hit.subjects.push(subjectOf(course));
      else mergedKeys.set(item.key, { item, subjects: [subjectOf(course)] });
    }
  }
  const sharedKeys = new Set([...mergedKeys.entries()].filter(([, v]) => v.subjects.length > 1).map(([k]) => k));
  for (const k of sharedKeys) {
    const { item, subjects } = mergedKeys.get(k)!;
    common.push(questionLine(item, subjects));
  }

  const sections: string[] = [];
  if (common.length > 0) sections.push(['[공통]', ...common].join('\n'));
  for (const { course, items } of perCourse) {
    const own = items.filter((i) => !sharedKeys.has(i.key));
    if (own.length === 0) continue;
    sections.push([`[${subjectOf(course)}]`, ...own.map((i) => questionLine(i))].join('\n'));
  }

  if (sections.length > 0) {
    lines.push('수업을 준비하면서 몇 가지 여쭙고 싶은 내용이 있습니다. 아시는 것만 답해주셔도 괜찮습니다.', '', ...sections.flatMap((s) => [s, '']));
  } else {
    lines.push('');
  }

  if (opts.includeSchedule && courses.length > 0) {
    lines.push('[일정]');
    for (const c of courses) lines.push(`- ${subjectOf(c)}: ${scheduleSummary(c)}`);
    lines.push('');
  }

  lines.push('확인되는 대로 편하게 답장 주세요. 감사합니다.');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
