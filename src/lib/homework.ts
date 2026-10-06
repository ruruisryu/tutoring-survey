import type { HomeworkBand } from './types';

export const HOMEWORK_BANDS: { value: HomeworkBand; label: string; min: number; max: number | null }[] = [
  { value: 'lt30', label: '주 30분 이내', min: 0, max: 30 },
  { value: '30_60', label: '주 30~60분', min: 30, max: 60 },
  { value: '60_90', label: '주 60~90분', min: 60, max: 90 },
  { value: '90_120', label: '주 90~120분', min: 90, max: 120 },
  { value: 'gte120', label: '주 120분 이상', min: 120, max: null },
  { value: 'tbd', label: '상담 후 결정', min: 0, max: null },
];

export function homeworkLabel(band: HomeworkBand | '' | null | undefined): string {
  return HOMEWORK_BANDS.find((b) => b.value === band)?.label ?? '';
}

export type HomeworkTotal =
  | { kind: 'empty' }
  | { kind: 'undetermined'; known: { min: number; max: number | null } }
  | { kind: 'range'; min: number; max: number | null };

/**
 * 여러 과목의 숙제 가능 시간 합계.
 * 구간을 임의의 숫자로 바꾸지 않고 최소·최대만 더한다. 상한이 없는 구간(120분 이상)이 있으면 상한 없음,
 * '상담 후 결정'이 하나라도 있으면 합계 미확정으로 본다.
 */
export function homeworkTotal(bands: (HomeworkBand | '' | null | undefined)[]): HomeworkTotal {
  const chosen = bands.filter((b): b is HomeworkBand => !!b);
  if (chosen.length === 0) return { kind: 'empty' };
  let min = 0;
  let max: number | null = 0;
  for (const b of chosen.filter((x) => x !== 'tbd')) {
    const def = HOMEWORK_BANDS.find((x) => x.value === b)!;
    min += def.min;
    max = max === null || def.max === null ? null : max + def.max;
  }
  if (chosen.includes('tbd')) return { kind: 'undetermined', known: { min, max } };
  return { kind: 'range', min, max };
}

export function formatHomeworkTotal(t: HomeworkTotal): string {
  if (t.kind === 'empty') return '';
  if (t.kind === 'undetermined') return '합계 미확정 (상담 후 결정하는 과목이 있습니다)';
  if (t.max === null) return `주 ${t.min}분 이상`;
  if (t.min === 0) return `주 ${t.max}분 이내`;
  return `주 ${t.min}~${t.max}분`;
}
