import { T } from '../copy/ko';
import { formatDateKo, formatTimeRange, WEEKDAY_LABELS, WEEKDAY_ORDER } from '../lib/time';
import type { CourseConditions } from '../lib/types';
import { cx, SubjectBadge, Tag } from './ui';

export interface ConditionRow {
  key: string;
  label: string;
  value: string;
  fixed: boolean;
}

export function targetText(c: Pick<CourseConditions, 'school_level' | 'grades'>): string {
  const level = T.labels.schoolLevel[c.school_level] ?? '';
  if (c.school_level === 'any') return level;
  if (c.grades.length === 0) return `${level} 전 학년`;
  const g = [...c.grades].sort((a, b) => a - b);
  // 1·2·3학년처럼 이어지는 학년은 1~3학년으로 줄여 쓴다
  const contiguous = g.length >= 3 && g.every((v, i) => i === 0 || v === g[i - 1] + 1);
  return contiguous ? `${level} ${g[0]}~${g[g.length - 1]}학년` : `${level} ${g.join('·')}학년`;
}

export function weekdaysText(days: number[]): string {
  return WEEKDAY_ORDER.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_LABELS[d])
    .join('·');
}

export function conditionRows(c: CourseConditions): ConditionRow[] {
  const f = (k: CourseConditions['fixed_conditions'][number]) => c.fixed_conditions.includes(k);
  const C = T.course;
  const rows: ConditionRow[] = [{ key: 'target', label: C.target, value: targetText(c), fixed: true }];
  if (c.scope_text) rows.push({ key: 'scope', label: C.scope, value: c.scope_text, fixed: true });
  rows.push({ key: 'mode', label: C.mode, value: T.labels.mode[c.mode], fixed: c.mode !== 'negotiable' });
  rows.push({ key: 'group', label: C.groupType, value: T.labels.groupType[c.group_type], fixed: c.group_type !== 'negotiable' });
  rows.push({
    key: 'weekdays',
    label: C.days,
    value: c.weekdays.length ? weekdaysText(c.weekdays) + (f('weekdays') ? '' : ' 중 가능한 요일') : C.negotiable,
    fixed: f('weekdays'),
  });
  const timeParts: string[] = [];
  if (c.start_time) timeParts.push(formatTimeRange(c.start_time, c.minutes_per_session));
  else if (c.time_bands.length) timeParts.push(c.time_bands.map((b) => T.labels.timeBand[b]).join('·'));
  if (c.time_note) timeParts.push(c.time_note);
  rows.push({ key: 'time', label: C.time, value: timeParts.join(' · ') || C.negotiable, fixed: f('start_time') });
  rows.push({
    key: 'minutes',
    label: C.minutes,
    value: c.minutes_per_session ? C.minutesValue(c.minutes_per_session) : C.negotiable,
    fixed: f('minutes'),
  });
  rows.push({
    key: 'sessions',
    label: C.weekly,
    value:
      c.fixed_conditions.includes('sessions') && c.sessions_per_week
        ? C.weeklyValue(c.sessions_per_week)
        : c.session_choices?.length
          ? c.session_choices.map((n) => C.weeklyValue(n)).join(' 또는 ')
          : c.sessions_per_week
            ? C.weeklyValue(c.sessions_per_week)
            : C.negotiable,
    fixed: f('sessions'),
  });
  rows.push({
    key: 'start',
    label: C.startDate,
    value: c.start_date ? formatDateKo(c.start_date, true) : C.negotiable,
    fixed: f('start_date'),
  });
  rows.push({ key: 'duration', label: C.duration, value: c.duration_text || C.negotiable, fixed: f('duration') });
  return rows;
}

export function ConditionList({ course, compact }: { course: CourseConditions; compact?: boolean }) {
  const rows = conditionRows(course);
  const set = rows.filter((r) => r.value !== T.course.negotiable);
  const open = rows.filter((r) => r.value === T.course.negotiable);
  return (
    <dl className={cx('grid gap-x-4 text-[15px]', compact ? 'gap-y-1.5' : 'gap-y-2.5')} style={{ gridTemplateColumns: 'auto 1fr' }}>
      {set.map((r) => (
        <div key={r.key} className="contents">
          <dt className="whitespace-nowrap text-muted">{r.label}</dt>
          <dd className="m-0 min-w-0">
            <span>{r.value}</span>
            {!r.fixed && (
              <Tag tone="warn" className="ml-1.5 align-[1px]">
                {T.course.adjustable}
              </Tag>
            )}
          </dd>
        </div>
      ))}
      {open.length > 0 && (
        <div className="contents">
          <dt className="whitespace-nowrap text-muted">{T.course.toDiscuss}</dt>
          <dd className="m-0 min-w-0">{open.map((r) => r.label).join(', ')}</dd>
        </div>
      )}
    </dl>
  );
}

export function CourseSummaryCard({
  course,
  showPerspective,
}: {
  course: CourseConditions & { name: string; subject_name: string; subject_perspective?: string };
  showPerspective?: boolean;
}) {
  return (
    <article className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SubjectBadge name={course.subject_name} />
      </div>
      <h3 className="mt-2 text-lg font-bold leading-snug">{course.name}</h3>
      <div className="mt-3">
        <ConditionList course={course} compact />
      </div>
      {course.notice && <p className="mt-3 border-t border-line pt-3 text-[15px] leading-relaxed whitespace-pre-line text-ink">{course.notice}</p>}
      {showPerspective && course.subject_perspective && (
        <p className="mt-3 border-t border-line pt-3 text-[15px] leading-relaxed text-muted">
          <span className="font-semibold text-ink">{T.parent.perspective}</span> · {course.subject_perspective}
        </p>
      )}
    </article>
  );
}
