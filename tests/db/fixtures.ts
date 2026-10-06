import { applicableQuestions } from '../../src/lib/questions';
import { createDraft, needsSlots, isFixed } from '../../src/lib/survey';
import { addDays, timeOptions } from '../../src/lib/time';
import type { Answers, PublicForm, SurveyDraft } from '../../src/lib/types';

/** 필수 항목만 채운 유효한 초안 */
export function validDraft(form: PublicForm, selected?: string[]): SurveyDraft {
  const d = createDraft(form);
  if (selected) d.selected = selected;
  d.common.parent_name = '김보호';
  d.common.parent_phone = '010 1234-5678';
  d.common.student_name = '민준';
  d.common.grade_key = 'middle-2';
  const today = form.today!;
  for (const id of d.selected) {
    const course = form.courses!.find((c) => c.id === id)!;
    const cd = d.courses[id];
    if (!isFixed(course, 'start_date')) cd.schedule.start_date = addDays(today, 7);
    if (needsSlots(course)) {
      const day = course.weekdays[0] ?? 2;
      const t = isFixed(course, 'start_time') && course.start_time ? course.start_time : timeOptions(course.time_bands)[0];
      cd.schedule.slots = [{ weekday: day, start_time: t }];
    }
    cd.homework_band = '30_60';
    cd.assessments.forEach((a) => (a.status = 'undecided'));
    const answers: Answers = {};
    for (const q of applicableQuestions(course.questions, course.id)) {
      if (!q.required || q.show_if) continue;
      if (q.type === 'multi') answers[q.id] = { status: 'answered', value: [q.options![0].value] };
      else if (q.type === 'single') answers[q.id] = { status: 'answered', value: q.options![0].value };
      else answers[q.id] = { status: 'answered', value: '예시 답변' };
    }
    cd.answers = answers;
  }
  d.consent = true;
  return d;
}
