import { useState } from 'react';
import { T } from '../../copy/ko';
import { SYSTEM_MAX } from '../../lib/errorText';
import { formatHomeworkTotal, HOMEWORK_BANDS, homeworkTotal } from '../../lib/homework';
import { applicableQuestions, visibilityMap } from '../../lib/questions';
import { fieldId, newKey } from '../../lib/survey';
import type { AssessmentDraft, AssessmentKind, AssessmentStatus } from '../../lib/types';
import { Button, Choice, Field, LiveMessage, SubjectBadge, TextArea, TextInput, cx } from '../../components/ui';
import { QuestionField } from '../../components/QuestionField';
import type { StepProps } from './BasicStep';

const EXTRA_KINDS: AssessmentKind[] = ['performance', 'unit', 'other'];
const STATUSES: AssessmentStatus[] = ['entered', 'finished', 'undecided', 'unknown', 'not_applicable'];

export function CourseStep({ form, draft, update, err, courseId }: StepProps & { courseId: string }) {
  const C = T.parent.course;
  const course = form.courses!.find((c) => c.id === courseId)!;
  const i = draft.selected.indexOf(courseId);
  const cd = draft.courses[courseId];
  const qs = applicableQuestions(course.questions, course.id);
  const vis = visibilityMap(qs, cd.answers, draft.common.grade_key);
  const [live, setLive] = useState('');
  const multi = draft.selected.length > 1;
  const total = homeworkTotal(draft.selected.map((id) => draft.courses[id].homework_band));
  const examSources = draft.selected
    .filter((id) => id !== courseId)
    .map((id) => ({ course: form.courses!.find((c) => c.id === id)!, list: draft.courses[id].assessments }))
    .filter((o) => o.list.some((a) => a.status === 'entered' && (a.period_start || a.period_end)));

  const setAssessment = (j: number, fn: (a: AssessmentDraft) => void) => update((d) => fn(d.courses[courseId].assessments[j]));

  return (
    <div className="space-y-8">
      <LiveMessage message={live} />
      <div className="flex flex-wrap items-center gap-2">
        <SubjectBadge name={course.subject_name} />
        <span className="text-[15px] text-muted">{course.name}</span>
      </div>

      {course.subject_perspective && (
        <aside className="border-l-4 border-accent bg-surface px-4 py-3">
          <p className="text-[15px] font-semibold text-accent-strong">{C.perspectiveTitle}</p>
          <p className="mt-1 text-[16px] leading-relaxed">{course.subject_perspective}</p>
        </aside>
      )}

      <section aria-labelledby={`learn-${courseId}`} className="space-y-7">
        <h2 id={`learn-${courseId}`} className="text-xl font-bold">
          {C.learningTitle}
        </h2>
        {qs
          .filter((q) => vis[q.id])
          .map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              fieldId={fieldId(`courses.${i}.answers.${q.id}`)}
              answer={cd.answers[q.id]}
              error={err(`courses.${i}.answers.${q.id}`)}
              onChange={(ans) =>
                update((d) => {
                  const a = d.courses[courseId].answers;
                  if (ans) a[q.id] = ans;
                  else delete a[q.id];
                })
              }
            />
          ))}
      </section>

      <section aria-labelledby={`exam-${courseId}`} className="space-y-5 border-t border-line pt-7">
        <div>
          <h2 id={`exam-${courseId}`} className="text-xl font-bold">
            {C.examTitle}
          </h2>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">{C.examHelp}</p>
        </div>

        {examSources.map((src) => (
          <Button
            key={src.course.id}
            variant="ghost"
            size="sm"
            onClick={() => {
              update((d) => {
                const target = d.courses[courseId].assessments;
                for (const a of src.list.filter((x) => x.status === 'entered' && (x.period_start || x.period_end))) {
                  let t = target.find((x) => x.kind === a.kind && x.name.trim() === a.name.trim());
                  if (!t) {
                    t = { key: newKey(), kind: a.kind, name: a.name, status: '', period_start: '', period_end: '', exam_date: '', scope: '' };
                    target.push(t);
                  }
                  t.status = 'entered';
                  t.period_start = a.period_start;
                  t.period_end = a.period_end;
                }
              });
              setLive(C.copyExamPeriodDone);
            }}
          >
            {C.copyExamPeriod(src.course.subject_name)}
          </Button>
        ))}

        {cd.assessments.map((a, j) => {
          const p = `courses.${i}.assessments.${j}`;
          const custom = a.kind !== 'midterm' && a.kind !== 'final';
          return (
            <fieldset key={a.key} id={`${fieldId(p)}-group`} className="min-w-0 rounded-card border border-line bg-surface p-4">
              <legend className="px-1 text-base font-bold">{a.name || T.labels.assessmentKind[a.kind]}</legend>
              <div className="space-y-4">
                {custom && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field id={fieldId(`${p}.name`)} label={C.assessmentName} required error={err(`${p}.name`)} className="flex-1">
                      {(aria) => (
                        <TextInput {...aria} maxLength={SYSTEM_MAX.assessment_name} value={a.name} onChange={(e) => setAssessment(j, (x) => void (x.name = e.target.value))} />
                      )}
                    </Field>
                    <Button variant="ghost" size="sm" onClick={() => update((d) => void d.courses[courseId].assessments.splice(j, 1))} aria-label={C.removeAssessment(a.name || T.labels.assessmentKind[a.kind])}>
                      {T.common.delete}
                    </Button>
                  </div>
                )}
                <Field id={fieldId(`${p}.status`)} as="fieldset" label={C.examStatus} required error={err(`${p}.status`) ?? err(p)}>
                  {() => (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {STATUSES.map((st, k) => (
                        <Choice
                          key={st}
                          type="radio"
                          name={`${a.key}-status`}
                          id={k === 0 ? fieldId(`${p}.status`) : `${a.key}-status-${st}`}
                          checked={a.status === st}
                          onChange={() =>
                            setAssessment(j, (x) => {
                              x.status = st;
                              if (st !== 'entered') {
                                x.period_start = '';
                                x.period_end = '';
                                x.exam_date = '';
                                x.scope = '';
                              }
                            })
                          }
                          label={T.labels.assessmentStatus[st]}
                        />
                      ))}
                    </div>
                  )}
                </Field>
                {a.status === 'entered' && (
                  <div className={cx('space-y-4 border-t border-line pt-4', !!err(p) && 'border-danger')}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id={fieldId(`${p}.period_start`)} label={`${C.examPeriod} ${C.examPeriodStart}`} optional error={err(`${p}.period_start`)}>
                        {(aria) => <TextInput {...aria} type="date" value={a.period_start} onChange={(e) => setAssessment(j, (x) => void (x.period_start = e.target.value))} />}
                      </Field>
                      <Field id={fieldId(`${p}.period_end`)} label={`${C.examPeriod} ${C.examPeriodEnd}`} optional error={err(`${p}.period_end`)}>
                        {(aria) => <TextInput {...aria} type="date" value={a.period_end} onChange={(e) => setAssessment(j, (x) => void (x.period_end = e.target.value))} />}
                      </Field>
                    </div>
                    <Field id={fieldId(`${p}.exam_date`)} label={C.examDate} optional error={err(`${p}.exam_date`)}>
                      {(aria) => <TextInput {...aria} type="date" value={a.exam_date} onChange={(e) => setAssessment(j, (x) => void (x.exam_date = e.target.value))} className="max-w-xs" />}
                    </Field>
                    <Field id={fieldId(`${p}.scope`)} label={C.examScope} optional error={err(`${p}.scope`)}>
                      {(aria) => (
                        <TextArea {...aria} rows={2} maxLength={SYSTEM_MAX.assessment_scope} value={a.scope} onChange={(e) => setAssessment(j, (x) => void (x.scope = e.target.value))} />
                      )}
                    </Field>
                  </div>
                )}
              </div>
            </fieldset>
          );
        })}

        {cd.assessments.length < 8 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] text-muted">{C.addAssessment}:</span>
            {EXTRA_KINDS.map((k) => (
              <Button
                key={k}
                variant="secondary"
                size="sm"
                onClick={() =>
                  update((d) =>
                    void d.courses[courseId].assessments.push({
                      key: newKey(),
                      kind: k,
                      name: T.labels.assessmentKind[k],
                      status: '',
                      period_start: '',
                      period_end: '',
                      exam_date: '',
                      scope: '',
                    }),
                  )
                }
              >
                + {T.labels.assessmentKind[k]}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-line pt-7">
        <Field id={fieldId(`courses.${i}.homework_band`)} as="fieldset" label={C.homework} required help={C.homeworkHelp} error={err(`courses.${i}.homework_band`)}>
          {() => (
            <div className="grid gap-2 sm:grid-cols-2">
              {HOMEWORK_BANDS.map((b, k) => (
                <Choice
                  key={b.value}
                  type="radio"
                  name={`${courseId}-homework`}
                  id={k === 0 ? fieldId(`courses.${i}.homework_band`) : `${courseId}-hw-${b.value}`}
                  checked={cd.homework_band === b.value}
                  onChange={() => update((d) => void (d.courses[courseId].homework_band = b.value))}
                  label={b.label}
                />
              ))}
            </div>
          )}
        </Field>
        {multi && total.kind !== 'empty' && (
          <p className="rounded-xl bg-[#f1f5f3] px-4 py-3 text-[15px]" aria-live="polite">
            {C.homeworkTotal(formatHomeworkTotal(total))}
          </p>
        )}
      </section>
    </div>
  );
}
