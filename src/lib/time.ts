// 날짜·시간 처리. 모든 날짜는 Asia/Seoul 기준의 'YYYY-MM-DD' 문자열로 다루고,
// new Date('YYYY-MM-DD') 처럼 UTC 로 해석되어 하루가 밀리는 변환을 쓰지 않는다.
import type { TimeBand } from './types';

export const TIME_ZONE = 'Asia/Seoul';
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 화면에서 보여줄 요일 순서 (월요일부터) */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const BAND_RANGES: Record<TimeBand, { from: string; to: string }> = {
  morning: { from: '06:00', to: '11:59' },
  afternoon: { from: '12:00', to: '17:59' },
  evening: { from: '18:00', to: '23:00' },
};

const seoulDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 특정 시점의 서울 날짜 */
export function seoulDate(at: Date = new Date()): string {
  return seoulDateFmt.format(at);
}

export function parseDateText(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** 날짜 문자열에 일수를 더한다 (시간대 영향 없음) */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDateText(date);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const { y, m, d } = parseDateText(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 2026-10-05 → 10월 5일(월) */
export function formatDateKo(date: string | null | undefined, withYear = false): string {
  if (!date) return '';
  const { y, m, d } = parseDateText(date);
  const base = `${m}월 ${d}일(${WEEKDAY_LABELS[weekdayOf(date)]})`;
  return withYear ? `${y}년 ${base}` : base;
}

const seoulDateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 서버 timestamptz → 서울 기준 '2026. 10. 05. 14:03' */
export function formatDateTimeKo(iso: string | null | undefined): string {
  if (!iso) return '';
  return seoulDateTimeFmt.format(new Date(iso));
}

/** timestamptz 의 서울 날짜 */
export function seoulDateOfTimestamp(iso: string): string {
  return seoulDate(new Date(iso));
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** 시작 시각 + 수업 길이 → 종료 시각. 자정을 넘기면 nextDay 표시 */
export function endTime(start: string, minutes: number): { time: string; nextDay: boolean } {
  const total = timeToMinutes(start) + minutes;
  return { time: minutesToTime(total), nextDay: total >= 1440 };
}

export function formatTimeRange(start: string, minutes: number | null | undefined): string {
  if (!minutes) return `${start} 시작`;
  const end = endTime(start, minutes);
  return `${start}~${end.nextDay ? '다음 날 ' : ''}${end.time}`;
}

export function timeInBands(t: string, bands: TimeBand[]): boolean {
  if (bands.length === 0) return true;
  const v = timeToMinutes(t);
  return bands.some((b) => v >= timeToMinutes(BAND_RANGES[b].from) && v <= timeToMinutes(BAND_RANGES[b].to));
}

/** 시간 선택지 (10분 단위) — 시간대가 정해져 있으면 그 범위만 */
export function timeOptions(bands: TimeBand[], stepMinutes = 10): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 23 * 60; m += stepMinutes) {
    const t = minutesToTime(m);
    if (timeInBands(t, bands)) out.push(t);
  }
  return out;
}

export function sortSlots<T extends { weekday: number; start_time: string }>(slots: T[]): T[] {
  const order = (w: number) => WEEKDAY_ORDER.indexOf(w as (typeof WEEKDAY_ORDER)[number]);
  return [...slots].sort((a, b) => order(a.weekday) - order(b.weekday) || a.start_time.localeCompare(b.start_time));
}

export function formatSlot(slot: { weekday: number; start_time: string }, minutes?: number | null): string {
  return `${WEEKDAY_LABELS[slot.weekday]} ${formatTimeRange(slot.start_time, minutes)}`;
}
