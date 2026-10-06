import type { ReactNode } from 'react';
import { T } from '../../copy/ko';
import { formatHomeworkTotal, homeworkLabel, homeworkTotal } from '../../lib/homework';
import { formatPhone, normalizePhone } from '../../lib/phone';
import { answerToText, applicableQuestions, cleanAnswers } from '../../lib/questions';
import { GRADE_OPTIONS, fieldId, isFixed, needsSlots, type StepId } from '../../lib/survey';
import { formatDateKo, formatSlot, sortSlots } from '../../lib/time';
import type { PublicCourse, Question, SurveyDraft } from '../../lib/types';
import { Button, Choice, Field, SubjectBadge } from '../../components/ui';
import type { StepProps } from './BasicStep';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-[15px] text-muted">{label}</dt>
      <dd className="m-0 min-w-0 whitespace-pre-line">{children}</dd>
    </div>
  );
}

function Section({ title, onEdit, editLabel, children }: { title: string; onEdit: () => void; editLabel: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-lg font-bold">{title}</h2>
        <Button variant="secondary" size="sm" onClick={onEdit} aria-label={editLabel}>
          {T.common.edit}
        </Button>
      </div>
      <div className="px-4 py-2 sm:px-5">{children}</div>
    </section>
  );
}

const none = <span className="text-muted">{T.parent.review.notAnswered}</span>;

function answersRows(questions: Question[], answers: SurveyDraft['common']['answers'], gradeKey: string) {
  const cleaned = cleanAnswers(questions, answers, gradeKey);
  return questions
    .filter((q) => cleaned[q.id])
    .map((q) => (
      <Row key={q.id} label={q.label}>
        {answerToText(q, cleaned[q.id])}
      </Row>
    ));
}

function scheduleRows(course: PublicCourse, d: SurveyDraft) {
  const s = d.courses[course.id].schedule;
  const S = T.parent.schedule;
  const minutes = s.minutes ?? course.minutes_per_session;
  return (
    <>
      {!isFixed(course, 'start_date') && <Row label={S.startDate}>{s.start_undecided ? T.common.undecided : s.start_date ? formatDateKo(s.start_date, true) : none}</Row>}
      {needsSlots(course) && (
        <Row label={S.slots}>
          {s.time_undecided
            ? S.timeUndecided
            : sortSlots(s.slots.filter((x) => x.weekday >= 0 && x.start_time))
                .map((x) => formatSlot(x, minutes))
                .join('\n') || none}
        </Row>
      )}
      {!isFixed(course, 'duration') && <Row label={S.duration}>{s.duration || S.noPreference}</Row>}
      {!isFixed(course, 'sessions') && <Row label={S.sessions}>{s.sessions_per_week ? S.sessionsOption(s.sessions_per_week) : S.noPreference}</Row>}
      {!isFixed(course, 'minutes') && <Row label={S.minutes}>{s.minutes ? S.minutesOption(s.minutes) : S.noPreference}</Row>}
      {course.mode === 'negotiable' && <Row label={S.mode}>{s.mode ? T.labels.mode[s.mode] : none}</Row>}
      {course.group_type === 'negotiable' && <Row label={S.groupType}>{s.group_type ? T.labels.groupType[s.group_type] : none}</Row>}
      {s.note.trim() && <Row label={S.note}>{s.note.trim()}</Row>}
    </>
  );
}

export function ReviewStep({ form, draft, update, err, onEdit }: StepProps & { onEdit: (s: StepId) => void }) {
  const R = T.parent.review;
  const B = T.parent.basic;
  const c = draft.common;
  const grade = c.grade_key === 'other' ? `${B.gradeOther} (${c.grade_note})` : GRADE_OPTIONS.find((g) => g.key === c.grade_key)?.label;
  const courses = draft.selected.map((id) => form.courses!.find((x) => x.id === id)!);
  const settings = form.settings;
  const total = homeworkTotal(draft.selected.map((id) => draft.courses[id].homework_band));

  return (
    <div className="space-y-5">
      <p className="text-[16px] leading-relaxed text-muted">{R.intro}</p>

      <Section title={R.common} onEdit={() => onEdit('basic')} editLabel={`${R.common} ${T.common.edit}`}>
        <dl className="divide-y divide-line">
          <Row label={B.parentName}>{c.parent_name}</Row>
          <Row label={B.parentPhone}>{formatPhone(normalizePhone(c.parent_phone) ?? c.parent_phone)}</Row>
          <Row label={B.studentName}>{c.student_name}</Row>
          <Row label={B.grade}>{grade}</Row>
          <Row label={B.schoolName}>{c.school_name || none}</Row>
          {answersRows(applicableQuestions(form.common?.questions ?? [], null), c.answers, c.grade_key)}
        </dl>
      </Section>

      <Section title={R.schedule} onEdit={() => onEdit('schedule')} editLabel={`${R.schedule} ${T.common.edit}`}>
        {courses.map((course) => (
          <div key={course.id} className="border-b border-line py-3 last:border-b-0">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              <SubjectBadge name={course.subject_name} /> {course.name}
            </h3>
            <dl className="mt-1 divide-y divide-line">{scheduleRows(course, draft)}</dl>
          </div>
        ))}
        {courses.length > 1 && (
          <dl className="border-t border-line">
            <Row label={T.parent.schedule.consecutive}>{c.consecutive_request ? T.parent.schedule.consecutiveOptions[c.consecutive_request] : none}</Row>
            {c.consecutive_note.trim() && <Row label={T.parent.schedule.consecutiveNote}>{c.consecutive_note.trim()}</Row>}
          </dl>
        )}
      </Section>

      {courses.map((course) => {
        const cd = draft.courses[course.id];
        return (
          <Section
            key={course.id}
            title={`${course.subject_name} · ${R.learning}`}
            onEdit={() => onEdit(`course:${course.id}`)}
            editLabel={`${course.subject_name} ${R.learning} ${T.common.edit}`}
          >
            <dl className="divide-y divide-line">
              {answersRows(applicableQuestions(course.questions, course.id), cd.answers, c.grade_key)}
            </dl>
            <h3 className="mt-3 border-t border-line pt-3 font-semibold">{R.exams}</h3>
            <dl className="divide-y divide-line">
              {cd.assessments
                .filter((a) => a.status)
                .map((a) => (
                  <Row key={a.key} label={a.name}>
                    {a.status === 'entered'
                      ? [
                          a.period_start || a.period_end
                            ? `${T.parent.course.examPeriod} ${a.period_start ? formatDateKo(a.period_start) : '?'} ~ ${a.period_end ? formatDateKo(a.period_end) : '?'}`
                            : '',
                          a.exam_date ? `${T.parent.course.examDate} ${formatDateKo(a.exam_date)}` : '',
                          a.scope ? `${T.parent.course.examScope}: ${a.scope}` : '',
                        ]
                          .filter(Boolean)
                          .join('\n')
                      : T.labels.assessmentStatus[a.status as 'unknown']}
                  </Row>
                ))}
              <Row label={T.parent.course.homework}>{homeworkLabel(cd.homework_band) || none}</Row>
            </dl>
          </Section>
        );
      })}

      {courses.length > 1 && total.kind !== 'empty' && (
        <p className="rounded-xl bg-[#f1f5f3] px-4 py-3 text-[15px]">{T.parent.course.homeworkTotal(formatHomeworkTotal(total))}</p>
      )}

      <Section title={R.requests} onEdit={() => onEdit('basic')} editLabel={`${R.requests} ${T.common.edit}`}>
        <p className="py-2.5 whitespace-pre-line">{c.general_request.trim() || none}</p>
      </Section>

      {settings.policy_notice && (
        <details className="rounded-card border border-line bg-surface px-4 py-3 sm:px-5">
          <summary className="cursor-pointer font-bold">{T.parent.policyTitle}</summary>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{settings.policy_notice}</p>
        </details>
      )}

      <section aria-labelledby="privacy-title" className="rounded-card border border-line-strong bg-surface px-4 py-4 sm:px-5">
        <h2 id="privacy-title" className="text-lg font-bold">
          {R.privacyTitle}
        </h2>
        <dl className="mt-2 divide-y divide-line text-[15px]">
          <Row label={R.privacyItems}>{R.privacyItemsText}</Row>
          <Row label={R.privacyPurpose}>{settings.privacy_purpose}</Row>
          <Row label={R.privacyRetention}>{settings.privacy_retention}</Row>
          <Row label={R.privacyDeletion}>{settings.privacy_deletion}</Row>
          <Row label={R.privacyOperator}>{settings.operator_name}</Row>
          <Row label={R.privacyContact}>{settings.operator_contact}</Row>
        </dl>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{R.privacyRefuse}</p>
        <div className="mt-4">
          <Field id={fieldId('consent')} as="fieldset" label={<span className="sr-only">{R.privacyTitle}</span>} error={err('consent')}>
            {(a) => (
              <Choice
                type="checkbox"
                name="consent"
                id={fieldId('consent')}
                describedBy={a['aria-describedby']}
                invalid={!!err('consent')}
                checked={draft.consent}
                onChange={(v) => update((d) => void (d.consent = v))}
                label={<span className="font-semibold">{R.consent}</span>}
              />
            )}
          </Field>
        </div>
      </section>
    </div>
  );
}
