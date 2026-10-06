// CSV 내보내기. UTF-8 BOM, 쉼표·따옴표·줄바꿈 처리, 스프레드시트 수식 주입 방어.
import { T, schoolGradeLabel } from '../copy/ko';
import { homeworkLabel } from './homework';
import { formatPhone } from './phone';
import { answerToText } from './questions';
import { formatDateTimeKo, formatSlot, sortSlots } from './time';
import { commonUnknowns, courseUnknowns } from './unknowns';
import type { DetailCourse, SubmissionDetail } from './types';

const FORMULA_START = /^[=+\-@\t\r]/;

/** 셀 값 하나를 안전한 CSV 필드로 바꾼다. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // 수식으로 해석될 수 있는 값은 앞에 작은따옴표를 붙여 문자열로 고정한다.
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const STANDARD_COLUMNS: { id: string; header: string }[] = [
  { id: 'textbook_publisher', header: '교과서 출판사' },
  { id: 'textbook_author', header: '교과서 대표 저자' },
  { id: 'current_unit', header: '현재 단원·범위' },
  { id: 'workbook', header: '문제집' },
  { id: 'recent_score', header: '최근 성적' },
  { id: 'interest', header: '과목 태도' },
  { id: 'confidence', header: '자신감' },
  { id: 'difficulties', header: '어려워하는 부분' },
  { id: 'difficulties_other', header: '어려워하는 부분(기타)' },
  { id: 'goal', header: '수업 목표' },
  { id: 'goal_detail', header: '목표 상세' },
  { id: 'teacher_notes', header: '선생님 참고 사항' },
];

export function summaryCsv(list: SubmissionDetail[]): string {
  const header = [
    '제출ID', '접수번호', '접수일시', '학부모', '연락처', '학생', '학교급·학년', '학교', '수업 수', '수업', '상담 상태',
    '확인할 항목 수', '전반적인 요청', '연속 수업 희망', '연속 수업 요청',
  ];
  const rows = list.map((d) => [
    d.id,
    d.receipt_code,
    formatDateTimeKo(d.received_at),
    d.parent_name,
    formatPhone(d.parent_phone),
    d.student_name,
    schoolGradeLabel(d.school_level, d.grade, d.grade_note),
    d.school_name,
    d.courses.length,
    d.courses.map((c) => c.course.name).join(' / '),
    d.courses.map((c) => `${c.course.subject_name}:${T.labels.consultStatus[c.consultation.status]}`).join(' / '),
    commonUnknowns(d).length + d.courses.reduce((n, c) => n + courseUnknowns(c).length, 0),
    d.general_request,
    d.consecutive_request ? T.labels.consecutive[d.consecutive_request] : '',
    d.consecutive_note,
  ]);
  return toCsv([header, ...rows]);
}

function scheduleText(c: DetailCourse) {
  if (c.schedule.time_undecided) return '미정';
  return sortSlots(c.schedule.slots)
    .map((s) => formatSlot(s, c.schedule.minutes ?? c.course.minutes_per_session))
    .join(' / ');
}

function assessmentsText(c: DetailCourse) {
  return c.assessments
    .map((a) => {
      if (a.status !== 'entered') return `${a.name}: ${T.labels.assessmentStatus[a.status]}`;
      const period = a.period_start || a.period_end ? `기간 ${a.period_start ?? '?'}~${a.period_end ?? '?'}` : '';
      const exam = a.exam_date ? `시험일 ${a.exam_date}` : '';
      return `${a.name}: ${[period, exam, a.scope && `범위 ${a.scope}`].filter(Boolean).join(', ')}`;
    })
    .join(' / ');
}

export function detailCsv(list: SubmissionDetail[]): string {
  const header = [
    '제출ID', '수업기록ID', '접수번호', '접수일시', '학생', '학부모', '연락처', '학교급·학년', '과목', '수업', '양식 버전',
    '상담 상태', '희망 시작일', '가능한 요일·시각', '희망 기간', '주당 횟수 요청', '회당 시간 요청', '수업 방식 요청', '수업 형태 요청',
    '일정 요청', '숙제 가능 시간', '시험·평가', ...STANDARD_COLUMNS.map((c) => c.header), '기타 응답', '확인할 항목',
    '확정 시작일', '확정 요일·시각', '다음 연락 예정일', '상담 메모', '지도 계획 메모',
  ];
  const rows: unknown[][] = [];
  for (const d of list) {
    for (const c of d.courses) {
      const qById = new Map(c.questions.map((q) => [q.id, q]));
      const others = c.questions
        .filter((q) => !STANDARD_COLUMNS.some((s) => s.id === q.id) && c.answers[q.id])
        .map((q) => `${q.label}: ${answerToText(q, c.answers[q.id])}`)
        .join(' / ');
      const minutes = c.consultation.confirmed_minutes ?? c.course.minutes_per_session;
      rows.push([
        d.id,
        c.id,
        d.receipt_code,
        formatDateTimeKo(d.received_at),
        d.student_name,
        d.parent_name,
        formatPhone(d.parent_phone),
        schoolGradeLabel(d.school_level, d.grade, d.grade_note),
        c.course.subject_name,
        c.course.name,
        c.version_no ? `v${c.version_no}` : '',
        T.labels.consultStatus[c.consultation.status],
        c.schedule.start_undecided ? '미정' : c.schedule.start_date ?? (c.course.fixed_conditions.includes('start_date') ? `확정 ${c.course.start_date}` : ''),
        scheduleText(c),
        c.schedule.duration,
        c.schedule.sessions_per_week ?? '',
        c.schedule.minutes ?? '',
        c.schedule.mode ? T.labels.mode[c.schedule.mode] : '',
        c.schedule.group_type ? T.labels.groupType[c.schedule.group_type] : '',
        c.schedule.note,
        homeworkLabel(c.homework_band),
        assessmentsText(c),
        ...STANDARD_COLUMNS.map((s) => answerToText(qById.get(s.id), c.answers[s.id])),
        others,
        courseUnknowns(c).map((u) => u.label).join(' / '),
        c.consultation.confirmed_start_date ?? '',
        sortSlots(c.consultation.slots).map((s) => formatSlot(s, minutes)).join(' / '),
        c.consultation.next_contact_date ?? '',
        c.consultation.consult_memo,
        c.consultation.plan_memo,
      ]);
    }
  }
  return toCsv([header, ...rows]);
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
