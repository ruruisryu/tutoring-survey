import { useState } from 'react';
import { T } from '../../copy/ko';
import { SYSTEM_MAX } from '../../lib/errorText';
import { fieldId, isFixed, needsSlots } from '../../lib/survey';
import { addDays, endTime, formatSlot, sortSlots, timeInBands, timeOptions, WEEKDAY_LABELS, WEEKDAY_ORDER } from '../../lib/time';
import type { PublicCourse, ScheduleDraft, Slot } from '../../lib/types';
import { Button, CharCount, Choice, Dialog, Field, LiveMessage, Select, SubjectBadge, TextArea, TextInput, cx } from '../../components/ui';
import { ConditionList } from '../../components/CourseSummary';
import type { StepProps } from './BasicStep';

const MINUTE_CHOICES = [40, 50, 60, 80, 90, 100, 120, 150, 180];

/** 다른 수업에서 가져올 수 있는 시간만 남긴다 */
export function slotsAllowedFor(course: PublicCourse, slots: Slot[]): Slot[] {
  return slots.filter(
    (s) =>
      s.weekday >= 0 &&
      !!s.start_time &&
      (course.weekdays.length === 0 || course.weekdays.includes(s.weekday)) &&
      (isFixed(course, 'start_time') && course.start_time ? s.start_time === course.start_time : timeInBands(s.start_time, course.time_bands)),
  );
}

export function ScheduleStep({ form, draft, update, err, today }: StepProps & { today: string }) {
  const S = T.parent.schedule;
  const courses = form.courses ?? [];
  const multi = !!form.allow_multiple && courses.length > 1;
  const selectedCourses = draft.selected.map((id) => courses.find((c) => c.id === id)!).filter(Boolean);

  return (
    <div className="space-y-8">
      {multi && (
        <Field id={fieldId('courses')} as="fieldset" label={S.chooseTitle} required help={S.chooseHelp} error={err('courses')}>
          {(a) => (
            <div className="grid gap-2">
              {courses.map((c, i) => (
                <Choice
                  key={c.id}
                  type="checkbox"
                  name="courses"
                  id={i === 0 ? fieldId('courses') : `course-${c.id}`}
                  describedBy={a['aria-describedby']}
                  checked={draft.selected.includes(c.id)}
                  onChange={(checked) =>
                    update((d) => {
                      const set = new Set(d.selected);
                      if (checked) set.add(c.id);
                      else set.delete(c.id);
                      d.selected = courses.map((x) => x.id).filter((id) => set.has(id));
                    })
                  }
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      <SubjectBadge name={c.subject_name} />
                      <span className="font-semibold">{c.name}</span>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </Field>
      )}

      {selectedCourses.length > 0 && <p className="rounded-xl bg-accent-soft px-4 py-3 text-[15px] leading-relaxed">{S.wishNote}</p>}

      {selectedCourses.map((course) => {
        const i = draft.selected.indexOf(course.id);
        return (
          <CourseSchedule
            key={course.id}
            course={course}
            index={i}
            schedule={draft.courses[course.id].schedule}
            others={selectedCourses.filter((c) => c.id !== course.id).map((c) => ({ course: c, schedule: draft.courses[c.id].schedule }))}
            setSchedule={(fn) => update((d) => fn(d.courses[course.id].schedule))}
            err={err}
            today={today}
            showTitle={selectedCourses.length > 1 || multi}
          />
        );
      })}

      {selectedCourses.length > 1 && (
        <section className="space-y-5 border-t border-line pt-7">
          <Field id={fieldId('common.consecutive_request')} as="fieldset" label={S.consecutive} optional error={err('common.consecutive_request')}>
            {() => (
              <div className="grid gap-2 sm:grid-cols-3">
                {(['yes', 'no', 'either'] as const).map((v, i) => (
                  <Choice
                    key={v}
                    type="radio"
                    name="consecutive"
                    id={i === 0 ? fieldId('common.consecutive_request') : `consecutive-${v}`}
                    checked={draft.common.consecutive_request === v}
                    onChange={() => update((d) => void (d.common.consecutive_request = v))}
                    label={S.consecutiveOptions[v]}
                  />
                ))}
              </div>
            )}
          </Field>
          <Field
            id={fieldId('common.consecutive_note')}
            label={S.consecutiveNote}
            optional
            error={err('common.consecutive_note')}
            counter={<CharCount value={draft.common.consecutive_note} max={SYSTEM_MAX.consecutive_note} />}
          >
            {(a) => (
              <TextArea
                {...a}
                rows={2}
                maxLength={SYSTEM_MAX.consecutive_note}
                value={draft.common.consecutive_note}
                onChange={(e) => update((d) => void (d.common.consecutive_note = e.target.value))}
              />
            )}
          </Field>
        </section>
      )}
    </div>
  );
}

function CourseSchedule({
  course,
  index,
  schedule: s,
  others,
  setSchedule,
  err,
  today,
  showTitle,
}: {
  course: PublicCourse;
  index: number;
  schedule: ScheduleDraft;
  others: { course: PublicCourse; schedule: ScheduleDraft }[];
  setSchedule: (fn: (s: ScheduleDraft) => void) => void;
  err: (path: string) => string | null;
  today: string;
  showTitle: boolean;
}) {
  const S = T.parent.schedule;
  const p = `courses.${index}.schedule`;
  const [copyFrom, setCopyFrom] = useState<{ course: PublicCourse; schedule: ScheduleDraft } | null>(null);
  const [live, setLive] = useState('');
  const dayChoices = course.weekdays.length ? WEEKDAY_ORDER.filter((d) => course.weekdays.includes(d)) : [...WEEKDAY_ORDER];
  const fixedStart = isFixed(course, 'start_time') && course.start_time ? course.start_time : null;
  const times = fixedStart ? [fixedStart] : timeOptions(course.time_bands);
  const minutes = s.minutes ?? course.minutes_per_session;
  const sourceCandidates = others.filter((o) => o.schedule.time_undecided || o.schedule.slots.some((x) => x.weekday >= 0 && x.start_time));

  const copyPreview = copyFrom
    ? copyFrom.schedule.time_undecided
      ? { undecided: true, slots: [] as Slot[], skipped: 0 }
      : (() => {
          const valid = copyFrom.schedule.slots.filter((x) => x.weekday >= 0 && x.start_time);
          const allowed = slotsAllowedFor(course, valid);
          return { undecided: false, slots: allowed, skipped: valid.length - allowed.length };
        })()
    : null;

  return (
    <section aria-labelledby={`sched-${course.id}`} className={cx('space-y-6', showTitle && 'border-t border-line pt-7')}>
      <LiveMessage message={live} />
      <div>
        {showTitle && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SubjectBadge name={course.subject_name} />
          </div>
        )}
        <h2 id={`sched-${course.id}`} className="text-xl font-bold">
          {course.name}
        </h2>
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <ConditionList course={course} compact />
          {course.notice && <p className="mt-3 border-t border-line pt-3 text-[15px] whitespace-pre-line">{course.notice}</p>}
        </div>
      </div>

      {!isFixed(course, 'start_date') && (
        <Field id={fieldId(`${p}.start_date`)} label={S.startDate} required error={err(`${p}.start_date`)}>
          {(a) => (
            <div className="space-y-2">
              <TextInput
                {...a}
                type="date"
                min={today}
                max={addDays(today, 366)}
                value={s.start_date}
                disabled={s.start_undecided}
                onChange={(e) => setSchedule((x) => void (x.start_date = e.target.value))}
                className="max-w-xs"
              />
              <Choice
                type="checkbox"
                name={`${course.id}-start-undecided`}
                id={`${fieldId(`${p}.start_date`)}-undecided`}
                checked={s.start_undecided}
                onChange={(c) =>
                  setSchedule((x) => {
                    x.start_undecided = c;
                    if (c) x.start_date = '';
                  })
                }
                label={S.startUndecided}
              />
            </div>
          )}
        </Field>
      )}

      {needsSlots(course) && (
        <Field id={fieldId(`${p}.slots`)} as="fieldset" label={S.slots} required help={S.slotsHelp(minutes)} error={err(`${p}.slots`)}>
          {(a) => (
            <div className="space-y-3">
              {!s.time_undecided && s.slots.length > 0 && (
                <ul className="space-y-2">
                  {s.slots.map((slot, j) => {
                    const label = slot.weekday >= 0 && slot.start_time ? formatSlot(slot) : `${j + 1}번째 시간`;
                    const end = slot.start_time && minutes ? endTime(slot.start_time, minutes) : null;
                    return (
                      <li key={j} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
                        <label className="min-w-24 flex-1">
                          <span className="mb-1 block text-[14px] text-muted">{S.weekday}</span>
                          <Select
                            id={j === 0 ? fieldId(`${p}.slots`) : undefined}
                            aria-describedby={a['aria-describedby']}
                            value={slot.weekday >= 0 ? String(slot.weekday) : ''}
                            onChange={(e) => setSchedule((x) => void (x.slots[j].weekday = e.target.value === '' ? -1 : Number(e.target.value)))}
                          >
                            <option value="">선택</option>
                            {dayChoices.map((d) => (
                              <option key={d} value={d}>
                                {WEEKDAY_LABELS[d]}요일
                              </option>
                            ))}
                          </Select>
                        </label>
                        <label className="min-w-28 flex-1">
                          <span className="mb-1 block text-[14px] text-muted">{S.startTime}</span>
                          <Select
                            value={slot.start_time}
                            onChange={(e) => setSchedule((x) => void (x.slots[j].start_time = e.target.value))}
                            disabled={!!fixedStart}
                          >
                            {!fixedStart && <option value="">선택</option>}
                            {times.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <p className="min-h-12 min-w-24 flex-1 py-3 text-[15px] text-muted" aria-live="polite">
                          {end ? S.endsAt(`${end.nextDay ? '다음 날 ' : ''}${end.time}`) : ''}
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => setSchedule((x) => void x.slots.splice(j, 1))} aria-label={S.removeSlot(label)}>
                          {T.common.delete}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!s.time_undecided && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setSchedule((x) => {
                      x.slots.push({ weekday: dayChoices.length === 1 ? dayChoices[0] : -1, start_time: fixedStart ?? '' });
                    })
                  }
                  disabled={s.slots.length >= 14}
                >
                  + {S.addSlot}
                </Button>
              )}
              <Choice
                type="checkbox"
                name={`${course.id}-time-undecided`}
                id={`${fieldId(`${p}.slots`)}-undecided`}
                checked={s.time_undecided}
                onChange={(c) =>
                  setSchedule((x) => {
                    x.time_undecided = c;
                    if (c) x.slots = [];
                  })
                }
                label={S.timeUndecided}
              />
              {sourceCandidates.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {sourceCandidates.map((o) => (
                    <Button key={o.course.id} variant="ghost" size="sm" onClick={() => setCopyFrom(o)}>
                      {S.copyButton(o.course.subject_name)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
      )}

      {!isFixed(course, 'duration') && (
        <Field id={fieldId(`${p}.duration`)} label={S.duration} optional error={err(`${p}.duration`)}>
          {(a) => (
            <Select {...a} value={s.duration} onChange={(e) => setSchedule((x) => void (x.duration = e.target.value))} className="max-w-sm">
              <option value="">{S.noPreference}</option>
              {S.durationOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {(!isFixed(course, 'sessions') || !isFixed(course, 'minutes')) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {!isFixed(course, 'sessions') && (
            <Field id={fieldId(`${p}.sessions_per_week`)} label={S.sessions} optional error={err(`${p}.sessions_per_week`)}>
              {(a) => (
                <Select
                  {...a}
                  value={s.sessions_per_week ?? ''}
                  onChange={(e) => setSchedule((x) => void (x.sessions_per_week = e.target.value ? Number(e.target.value) : null))}
                >
                  <option value="">{S.noPreference}</option>
                  {(course.session_choices?.length ? course.session_choices : [1, 2, 3, 4, 5]).map((n) => (
                    <option key={n} value={n}>
                      {S.sessionsOption(n)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {!isFixed(course, 'minutes') && (
            <Field id={fieldId(`${p}.minutes`)} label={S.minutes} optional error={err(`${p}.minutes`)}>
              {(a) => (
                <Select {...a} value={s.minutes ?? ''} onChange={(e) => setSchedule((x) => void (x.minutes = e.target.value ? Number(e.target.value) : null))}>
                  <option value="">{S.noPreference}</option>
                  {MINUTE_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {S.minutesOption(n)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}

      {course.mode === 'negotiable' && (
        <Field id={fieldId(`${p}.mode`)} as="fieldset" label={S.mode} optional error={err(`${p}.mode`)}>
          {() => (
            <div className="grid gap-2 sm:grid-cols-3">
              {(['online', 'in_person', 'any'] as const).map((m, j) => (
                <Choice
                  key={m}
                  type="radio"
                  name={`${course.id}-mode`}
                  id={j === 0 ? fieldId(`${p}.mode`) : `${course.id}-mode-${m}`}
                  checked={s.mode === m}
                  onChange={() => setSchedule((x) => void (x.mode = m))}
                  label={T.labels.mode[m]}
                />
              ))}
            </div>
          )}
        </Field>
      )}

      {course.group_type === 'negotiable' && (
        <Field id={fieldId(`${p}.group_type`)} as="fieldset" label={S.groupType} optional error={err(`${p}.group_type`)}>
          {() => (
            <div className="grid gap-2 sm:grid-cols-3">
              {(['individual', 'group', 'any'] as const).map((m, j) => (
                <Choice
                  key={m}
                  type="radio"
                  name={`${course.id}-group`}
                  id={j === 0 ? fieldId(`${p}.group_type`) : `${course.id}-group-${m}`}
                  checked={s.group_type === m}
                  onChange={() => setSchedule((x) => void (x.group_type = m))}
                  label={T.labels.groupType[m]}
                />
              ))}
            </div>
          )}
        </Field>
      )}

      <Field
        id={fieldId(`${p}.note`)}
        label={S.note}
        optional
        help={S.noteHelp}
        error={err(`${p}.note`)}
        counter={<CharCount value={s.note} max={SYSTEM_MAX.schedule_note} />}
      >
        {(a) => <TextArea {...a} rows={3} maxLength={SYSTEM_MAX.schedule_note} value={s.note} onChange={(e) => setSchedule((x) => void (x.note = e.target.value))} />}
      </Field>

      <Dialog
        open={!!copyFrom}
        onClose={() => setCopyFrom(null)}
        title={S.copyPreviewTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCopyFrom(null)}>
              {T.common.cancel}
            </Button>
            <Button
              onClick={() => {
                if (!copyPreview) return;
                setSchedule((x) => {
                  x.time_undecided = copyPreview.undecided;
                  x.slots = copyPreview.slots.map((sl) => ({ ...sl }));
                });
                setLive(`${course.name}: ${S.copyApply}`);
                setCopyFrom(null);
              }}
            >
              {S.copyApply}
            </Button>
          </>
        }
      >
        {copyFrom && copyPreview && (
          <div className="space-y-4 text-[15px]">
            <p>
              <strong>{copyFrom.course.name}</strong> → <strong>{course.name}</strong>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-3">
                <p className="font-semibold text-muted">{S.copyBefore}</p>
                <SlotList undecided={s.time_undecided} slots={s.slots} minutes={minutes} />
              </div>
              <div className="rounded-xl border border-accent bg-accent-soft p-3">
                <p className="font-semibold text-accent-strong">{S.copyAfter}</p>
                <SlotList undecided={copyPreview.undecided} slots={copyPreview.slots} minutes={minutes} />
              </div>
            </div>
            {copyPreview.skipped > 0 && <p className="text-warn">{S.copySkipped(copyPreview.skipped)}</p>}
          </div>
        )}
      </Dialog>
    </section>
  );
}

function SlotList({ undecided, slots, minutes }: { undecided: boolean; slots: Slot[]; minutes: number | null }) {
  if (undecided) return <p className="mt-1">{T.parent.schedule.timeUndecided}</p>;
  const valid = sortSlots(slots.filter((s) => s.weekday >= 0 && s.start_time));
  if (valid.length === 0) return <p className="mt-1 text-muted">{T.common.none}</p>;
  return (
    <ul className="mt-1 space-y-0.5">
      {valid.map((s, i) => (
        <li key={i}>{formatSlot(s, minutes)}</li>
      ))}
    </ul>
  );
}
