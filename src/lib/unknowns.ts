// 모름·미정으로 남은 항목 정리 (서버 submit_consultation 의 unknown_count 와 같은 규칙)
import { applicableQuestions } from './questions';
import type { DetailCourse, SubmissionDetail } from './types';

export interface UnknownItem {
  key: string; // 같은 성격의 항목을 묶을 때 쓰는 키
  label: string; // 관리자 화면 표시
  ask: string; // 문자 초안에 들어갈 질문 (명사구)
  kind: 'answer' | 'schedule' | 'assessment' | 'homework';
  undecided?: boolean; // 미정(아직 정해지지 않음)인지, 모름(확인 필요)인지
}

export function courseUnknowns(c: DetailCourse): UnknownItem[] {
  const items: UnknownItem[] = [];
  for (const q of applicableQuestions(c.questions, c.course_id)) {
    if (c.answers[q.id]?.status === 'unknown') {
      items.push({ key: `q:${q.id}`, label: q.label, ask: q.followup?.trim() || q.label, kind: 'answer' });
    }
  }
  if (c.schedule.start_undecided) {
    items.push({ key: 'start_date', label: '첫 수업 희망 날짜', ask: '첫 수업을 시작하고 싶은 날짜', kind: 'schedule', undecided: true });
  }
  if (c.schedule.time_undecided) {
    items.push({ key: 'slots', label: '가능한 요일·시작 시각', ask: '수업할 수 있는 요일과 시작 시각', kind: 'schedule', undecided: true });
  }
  if (c.homework_band === 'tbd') {
    items.push({ key: 'homework', label: '숙제에 쓸 수 있는 시간', ask: '일주일에 숙제에 쓸 수 있는 시간', kind: 'homework', undecided: true });
  }
  for (const a of c.assessments) {
    if (a.status === 'unknown' || a.status === 'undecided') {
      items.push({
        key: `exam:${a.name}`,
        label: `${a.name} ${a.status === 'unknown' ? '일정·범위 모름' : '일정 미정'}`,
        ask: `${a.name} 기간과 시험 범위`,
        kind: 'assessment',
        undecided: a.status === 'undecided',
      });
    }
  }
  return items;
}

export function commonUnknowns(d: SubmissionDetail): UnknownItem[] {
  return applicableQuestions(d.common.questions, null)
    .filter((q) => d.common.answers[q.id]?.status === 'unknown')
    .map((q) => ({ key: `common:${q.id}`, label: q.label, ask: q.followup?.trim() || q.label, kind: 'answer' as const }));
}

export function totalUnknownCount(d: SubmissionDetail): number {
  return commonUnknowns(d).length + d.courses.reduce((n, c) => n + courseUnknowns(c).length, 0);
}
