import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { T, schoolGradeLabel } from '../copy/ko';
import { isApiError } from '../lib/backend/errors';
import { formatHomeworkTotal, homeworkLabel, homeworkTotal } from '../lib/homework';
import { formatPhone } from '../lib/phone';
import { answerToText, applicableQuestions, photoPaths, visibilityMap } from '../lib/questions';
import { useBackend } from '../app/BackendContext';
import { formatDateKo, formatDateTimeKo, formatSlot, sortSlots, WEEKDAY_LABELS, WEEKDAY_ORDER } from '../lib/time';
import { gradeKeyOf } from '../lib/survey';
import { commonUnknowns, courseUnknowns } from '../lib/unknowns';
import type { Answer, Consultation, ConsultStatus, DetailCourse, Question, QuestionRole, Slot, SubmissionDetail } from '../lib/types';
import {
  Button,
  Card,
  Dialog,
  Field,
  LiveMessage,
  LoadingBlock,
  Notice,
  Select,
  SubjectBadge,
  Tag,
  TextArea,
  TextInput,
  cx,
  useDocumentTitle,
} from '../components/ui';
import { ConditionList } from '../components/CourseSummary';
import { adminErrorText, useAdminData } from './AdminData';
import { StatusTag } from './StatusTag';
import { SmsDialog } from './SmsDialog';
import { UnsavedGuard } from './UnsavedGuard';

export function ResponseDetailPage() {
  const { id = '' } = useParams();
  const D = T.admin.detail;
  const { call } = useAdminData();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState(0);
  const [smsOpen, setSmsOpen] = useState(false);
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  useDocumentTitle(`${detail?.student_name ?? '응답'} · ${T.admin.list.title}`);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await call<SubmissionDetail>('admin_get_submission', { p_id: id }));
    } catch (e) {
      // 이미 화면에 있는 내용(작성 중인 메모 포함)은 지우지 않는다
      setDetail((d) => {
        if (!d) setError(e);
        return d;
      });
    }
  }, [call, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const setDirty = useCallback((courseId: string, v: boolean) => setDirtyMap((m) => (m[courseId] === v ? m : { ...m, [courseId]: v })), []);
  const anyDirty = Object.values(dirtyMap).some(Boolean);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Notice tone="danger" role="alert">
          {adminErrorText(error)}{' '}
          {!(isApiError(error) && error.code === 'not_found') && (
            <Button variant="link" onClick={() => void load()}>
              {T.common.retry}
            </Button>
          )}
        </Notice>
      </div>
    );
  }
  if (!detail) return <LoadingBlock />;

  const cUnknowns = commonUnknowns(detail);
  const total = homeworkTotal(detail.courses.map((c) => c.homework_band));

  return (
    <div className="space-y-6">
      <UnsavedGuard dirty={anyDirty} />
      <BackLink />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {detail.student_name}
            <span className="ml-2 text-lg font-semibold text-muted">{schoolGradeLabel(detail.school_level, detail.grade, detail.grade_note)}</span>
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            {D.receipt} {detail.receipt_code} · {D.received} {formatDateTimeKo(detail.received_at)}
            {detail.invitation_label && ` · ${D.invitation} ${detail.invitation_label}`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setSmsOpen(true)}>
          {D.sms}
        </Button>
      </header>

      <Card className="p-5">
        <h2 className="text-lg font-bold">기본 정보</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <Item label={D.parent}>{detail.parent_name}</Item>
          <Item label={D.phone}>
            <a href={`tel:${detail.parent_phone}`} className="tabular-nums underline underline-offset-4">
              {formatPhone(detail.parent_phone)}
            </a>
          </Item>
          <Item label={D.student}>{detail.student_name}</Item>
          <Item label={D.school}>{detail.school_name || '—'}</Item>
          {detail.courses.length > 1 && (
            <Item label={D.consecutive}>
              {detail.consecutive_request ? T.labels.consecutive[detail.consecutive_request] : '—'}
              {detail.consecutive_note && <span className="block text-muted">{detail.consecutive_note}</span>}
            </Item>
          )}
          <Item label={D.consent}>{formatDateTimeKo(detail.privacy_consented_at)}</Item>
        </dl>
        {detail.general_request && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[14px] font-semibold text-muted">{D.generalRequest}</p>
            <p className="mt-1 whitespace-pre-line">{detail.general_request}</p>
          </div>
        )}
        {detail.common.questions.some((q) => detail.common.answers[q.id]) && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[14px] font-semibold text-muted">{D.commonExtra}</p>
            <dl className="mt-1">
              {detail.common.questions
                .filter((q) => detail.common.answers[q.id])
                .map((q) => (
                  <Item key={q.id} label={q.label}>
                    {answerToText(q, detail.common.answers[q.id])}
                  </Item>
                ))}
            </dl>
          </div>
        )}
        {cUnknowns.length > 0 && (
          <p className="mt-3 text-[14px]">
            <Tag tone="warn">확인 필요</Tag> {cUnknowns.map((u) => u.label).join(', ')}
          </p>
        )}
      </Card>

      {detail.courses.length > 1 && (
        <div role="tablist" aria-label="수업별 상담" className="flex gap-1 overflow-x-auto border-b border-line">
          {detail.courses.map((c, i) => (
            <button
              key={c.id}
              id={`tab-${c.id}`}
              role="tab"
              type="button"
              aria-selected={tab === i}
              aria-controls={`panel-${c.id}`}
              tabIndex={tab === i ? 0 : -1}
              onClick={() => setTab(i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + detail.courses.length) % detail.courses.length;
                  setTab(n);
                  document.getElementById(`tab-${detail.courses[n].id}`)?.focus();
                }
              }}
              className={cx(
                'inline-flex min-h-12 items-center gap-2 border-b-[3px] px-3 text-[15px] font-semibold whitespace-nowrap',
                tab === i ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {c.course.subject_name}
              <StatusTag status={c.consultation.status} />
              {dirtyMap[c.id] && <span className="text-[13px] text-warn">(저장 안 함)</span>}
            </button>
          ))}
        </div>
      )}

      {detail.courses.map((c, i) => (
        <div
          key={c.id}
          id={`panel-${c.id}`}
          role={detail.courses.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={detail.courses.length > 1 ? `tab-${c.id}` : undefined}
          hidden={detail.courses.length > 1 && tab !== i}
        >
          <CoursePanel
            submissionId={detail.id}
            gradeKey={gradeKeyOf(detail.school_level, detail.grade)}
            course={c}
            homeworkTotalText={detail.courses.length > 1 ? formatHomeworkTotal(total) : ''}
            onDirty={(v) => setDirty(c.id, v)}
            onSaved={(rec) => setDetail((d) => (d ? { ...d, courses: d.courses.map((x) => (x.id === c.id ? { ...x, consultation: rec } : x)) } : d))}
          />
        </div>
      ))}

      <DeleteSection detail={detail} />

      <SmsDialog open={smsOpen} onClose={() => setSmsOpen(false)} detail={detail} />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/admin/responses" className="inline-flex min-h-10 items-center text-[15px] font-semibold text-accent-strong underline-offset-4 hover:underline">
      ← {T.admin.detail.back}
    </Link>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-[15px]">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

function answersBy(course: DetailCourse, roles: (QuestionRole | undefined)[]) {
  const qs = applicableQuestions(course.questions, course.course_id);
  return qs.filter((q) => roles.includes(q.role) && course.answers[q.id]);
}

function AnswerList({ course, questions, empty }: { course: DetailCourse; questions: Question[]; empty?: string }) {
  if (questions.length === 0) return <p className="text-[15px] text-muted">{empty ?? '응답 없음'}</p>;
  return (
    <dl className="space-y-2">
      {questions.map((q) => (
        <div key={q.id}>
          <dt className="text-[14px] text-muted">{q.label}</dt>
          <dd className="m-0 whitespace-pre-line">
            {course.answers[q.id]?.status === 'unknown' ? (
              <Tag tone="warn">{q.unknown_label || '모름'}</Tag>
            ) : q.type === 'photos' ? (
              <PhotoThumbs answer={course.answers[q.id]} />
            ) : (
              answerToText(q, course.answers[q.id])
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SummaryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

function CoursePanel({
  submissionId,
  gradeKey,
  course: c,
  homeworkTotalText,
  onDirty,
  onSaved,
}: {
  submissionId: string;
  gradeKey: string;
  course: DetailCourse;
  homeworkTotalText: string;
  onDirty: (v: boolean) => void;
  onSaved: (rec: Consultation) => void;
}) {
  const D = T.admin.detail;
  const S = D.sections;
  const unknowns = courseUnknowns(c);
  const s = c.schedule;
  const minutes = s.minutes ?? c.course.minutes_per_session;
  const qs = applicableQuestions(c.questions, c.course_id);
  const vis = visibilityMap(qs, c.answers, gradeKey);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SubjectBadge name={c.course.subject_name} />
            <h2 className="text-lg font-bold">{c.course.name}</h2>
            <span className="text-[13px] text-muted">{D.versionInfo(c.version_no)}</span>
          </div>
          <div className="mt-4">
            <SummaryBlock title={S.goal}>
              <AnswerList course={c} questions={answersBy(c, ['goal'])} />
            </SummaryBlock>
            <SummaryBlock title={S.progress}>
              <AnswerList course={c} questions={answersBy(c, ['progress', 'textbook', 'score'])} />
            </SummaryBlock>
            <SummaryBlock title={S.difficulty}>
              <AnswerList course={c} questions={answersBy(c, ['difficulty', 'confidence'])} />
            </SummaryBlock>
            <SummaryBlock title={S.check}>
              {unknowns.length === 0 ? (
                <p className="text-[15px] text-muted">{D.noUnknowns}</p>
              ) : (
                <ul className="space-y-1">
                  {unknowns.map((u) => (
                    <li key={u.key} className="flex items-start gap-2">
                      <Tag tone="warn">{u.undecided ? '미정' : '모름'}</Tag>
                      <span>{u.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {answersBy(c, ['note', 'other', undefined]).length > 0 && (
                <div className="mt-3">
                  <AnswerList course={c} questions={answersBy(c, ['note', 'other', undefined])} />
                </div>
              )}
            </SummaryBlock>
            <SummaryBlock title={S.schedule}>
              <dl className="space-y-1.5 text-[15px]">
                <Row label={`${D.wish} 시작일`}>
                  {c.course.fixed_conditions.includes('start_date')
                    ? `${formatDateKo(c.course.start_date, true)} (수업 확정 조건)`
                    : s.start_undecided
                      ? <Tag tone="warn">미정</Tag>
                      : formatDateKo(s.start_date, true)}
                </Row>
                <Row label={`${D.wish} 요일·시각`}>
                  {s.time_undecided ? <Tag tone="warn">미정</Tag> : sortSlots(s.slots).map((x) => formatSlot(x, minutes)).join(', ') || '수업 확정 조건'}
                </Row>
                {s.duration && <Row label="희망 기간">{s.duration}</Row>}
                {s.sessions_per_week && <Row label="주당 횟수 요청">{T.course.weeklyValue(s.sessions_per_week)}</Row>}
                {s.minutes && <Row label="회당 시간 요청">{T.course.minutesValue(s.minutes)}</Row>}
                {s.mode && <Row label="수업 방식 요청">{T.labels.mode[s.mode]}</Row>}
                {s.group_type && <Row label="수업 형태 요청">{T.labels.groupType[s.group_type]}</Row>}
                {s.note && <Row label="일정 요청">{s.note}</Row>}
                <Row label="숙제 가능 시간">
                  {c.homework_band === 'tbd' ? <Tag tone="warn">상담 후 결정</Tag> : homeworkLabel(c.homework_band)}
                  {homeworkTotalText && <span className="block text-[13px] text-muted">전체 수업 합계: {homeworkTotalText}</span>}
                </Row>
                {c.assessments.map((a, i) => (
                  <Row key={i} label={a.name}>
                    {a.status === 'entered'
                      ? [
                          a.period_start || a.period_end ? `기간 ${formatDateKo(a.period_start) || '?'}~${formatDateKo(a.period_end) || '?'}` : '',
                          a.exam_date ? `시험일 ${formatDateKo(a.exam_date)}` : '',
                          a.scope ? `범위 ${a.scope}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : <Tag tone={a.status === 'not_applicable' ? 'neutral' : 'warn'}>{T.labels.assessmentStatus[a.status]}</Tag>}
                  </Row>
                ))}
              </dl>
              <details className="mt-3 rounded-xl border border-line px-3 py-2">
                <summary className="cursor-pointer text-[14px] font-semibold text-muted">제출 당시 수업 조건</summary>
                <div className="mt-2">
                  <ConditionList course={c.course} compact />
                </div>
              </details>
            </SummaryBlock>
            <SummaryBlock title={S.plan}>
              <p className="whitespace-pre-line text-[15px]">{c.consultation.plan_memo || <span className="text-muted">오른쪽 ‘선생님 기록’에서 작성합니다.</span>}</p>
            </SummaryBlock>
          </div>
        </Card>

        <details className="rounded-card border border-line bg-surface p-5">
          <summary className="cursor-pointer text-lg font-bold">{D.original}</summary>
          <p className="mt-1 text-[14px] text-muted">{D.originalHelp}</p>
          <dl className="mt-3 divide-y divide-line">
            {qs
              .filter((q) => vis[q.id])
              .map((q) => (
                <div key={q.id} className="grid gap-1 py-2 sm:grid-cols-[220px_1fr] sm:gap-4">
                  <dt className="text-[14px] text-muted">{q.label}</dt>
                  <dd className="m-0 whitespace-pre-line">
                    {!c.answers[q.id] ? <span className="text-muted">답하지 않음</span> : q.type === 'photos' ? <PhotoThumbs answer={c.answers[q.id]} /> : answerToText(q, c.answers[q.id])}
                  </dd>
                </div>
              ))}
          </dl>
        </details>
      </div>

      <TeacherRecord submissionId={submissionId} course={c} onDirty={onDirty} onSaved={onSaved} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

type RecordForm = {
  status: ConsultStatus;
  consult_memo: string;
  plan_memo: string;
  confirmed_start_date: string;
  confirmed_minutes: string;
  next_contact_date: string;
  slots: Slot[];
};

function toForm(r: Consultation): RecordForm {
  return {
    status: r.status,
    consult_memo: r.consult_memo,
    plan_memo: r.plan_memo,
    confirmed_start_date: r.confirmed_start_date ?? '',
    confirmed_minutes: r.confirmed_minutes ? String(r.confirmed_minutes) : '',
    next_contact_date: r.next_contact_date ?? '',
    slots: r.slots.map((s) => ({ ...s })),
  };
}

function TeacherRecord({ submissionId, course: c, onDirty, onSaved }: { submissionId: string; course: DetailCourse; onDirty: (v: boolean) => void; onSaved: (r: Consultation) => void }) {
  const D = T.admin.detail;
  const { call } = useAdminData();
  const [form, setForm] = useState<RecordForm>(() => toForm(c.consultation));
  const base = useRef(JSON.stringify(toForm(c.consultation)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(form) !== base.current;
  const id = c.id;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const set = <K extends keyof RecordForm>(k: K, v: RecordForm[K]) => {
    setMessage(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const minutes = form.confirmed_minutes.trim() ? Number(form.confirmed_minutes) : null;
      const rec = await call<Consultation>('admin_update_consultation', {
        p_submission_course_id: id,
        p_expected_updated_at: c.consultation.updated_at,
        p: {
          status: form.status,
          consult_memo: form.consult_memo,
          plan_memo: form.plan_memo,
          confirmed_start_date: form.confirmed_start_date || null,
          confirmed_minutes: minutes && Number.isFinite(minutes) ? minutes : null,
          next_contact_date: form.next_contact_date || null,
          slots: form.slots.filter((s) => s.weekday >= 0 && s.start_time),
        },
      });
      base.current = JSON.stringify(toForm(rec));
      setForm(toForm(rec));
      onSaved(rec);
      setConflict(false);
      setMessage({ tone: 'success', text: T.common.saved });
    } catch (e) {
      if (isApiError(e) && e.code === 'conflict') setConflict(true);
      setMessage({ tone: 'danger', text: isApiError(e) && e.kind === 'auth' ? T.admin.reauth.body : adminErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const reloadLatest = async () => {
    // 최신 기록을 불러오되, 작성 중이던 메모는 덮어쓰지 않고 새 기준으로만 삼는다
    try {
      const detail = await call<SubmissionDetail>('admin_get_submission', { p_id: submissionId });
      const latest = detail.courses.find((x) => x.id === id)?.consultation;
      if (latest) {
        onSaved(latest);
        setConflict(false);
        setMessage(null);
      }
    } catch (e) {
      setMessage({ tone: 'danger', text: adminErrorText(e) });
    }
  };

  const p = `rec-${id}`;
  return (
    <section aria-labelledby={`${p}-title`} className="h-fit rounded-card border-2 border-accent/30 bg-surface p-5 lg:sticky lg:top-4">
      <h2 id={`${p}-title`} className="text-lg font-bold">
        {D.teacherArea}
      </h2>
      <p className="mt-1 text-[14px] text-muted">{D.teacherAreaHelp}</p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field id={`${p}-status`} label={D.status}>
          {(a) => (
            <Select {...a} value={form.status} onChange={(e) => set('status', e.target.value as ConsultStatus)}>
              {(Object.keys(T.labels.consultStatus) as ConsultStatus[]).map((s) => (
                <option key={s} value={s}>
                  {T.labels.consultStatus[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${p}-consult`} label={D.consultMemo}>
          {(a) => <TextArea {...a} rows={4} maxLength={5000} value={form.consult_memo} onChange={(e) => set('consult_memo', e.target.value)} />}
        </Field>
        <Field id={`${p}-plan`} label={D.planMemo}>
          {(a) => <TextArea {...a} rows={4} maxLength={5000} value={form.plan_memo} onChange={(e) => set('plan_memo', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Field id={`${p}-start`} label={D.confirmedStart}>
            {(a) => <TextInput {...a} type="date" value={form.confirmed_start_date} onChange={(e) => set('confirmed_start_date', e.target.value)} />}
          </Field>
          <Field id={`${p}-minutes`} label={D.confirmedMinutes}>
            {(a) => (
              <TextInput {...a} type="number" inputMode="numeric" min={10} max={600} step={10} value={form.confirmed_minutes} onChange={(e) => set('confirmed_minutes', e.target.value)} />
            )}
          </Field>
        </div>
        <fieldset className="min-w-0">
          <legend className="text-base font-semibold">{D.confirmedSlots}</legend>
          <ul className="mt-2 space-y-2">
            {form.slots.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label="요일"
                  value={s.weekday >= 0 ? String(s.weekday) : ''}
                  onChange={(e) => set('slots', form.slots.map((x, j) => (j === i ? { ...x, weekday: e.target.value === '' ? -1 : Number(e.target.value) } : x)))}
                  className="w-28"
                >
                  <option value="">요일</option>
                  {WEEKDAY_ORDER.map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAY_LABELS[d]}
                    </option>
                  ))}
                </Select>
                <TextInput
                  aria-label="시작 시각"
                  type="time"
                  step={600}
                  value={s.start_time}
                  onChange={(e) => set('slots', form.slots.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))}
                  className="w-36"
                />
                <span className="text-[14px] text-muted">
                  {s.start_time && (form.confirmed_minutes || c.course.minutes_per_session)
                    ? formatSlot(s, Number(form.confirmed_minutes) || c.course.minutes_per_session).replace(/^\S+ /, '')
                    : ''}
                </span>
                <Button variant="ghost" size="sm" onClick={() => set('slots', form.slots.filter((_, j) => j !== i))}>
                  {T.common.delete}
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => set('slots', [...form.slots, { weekday: -1, start_time: '' }])}>
            + 요일·시각 추가
          </Button>
        </fieldset>
        <Field id={`${p}-next`} label={D.nextContact}>
          {(a) => <TextInput {...a} type="date" value={form.next_contact_date} onChange={(e) => set('next_contact_date', e.target.value)} className="max-w-xs" />}
        </Field>

        {dirty && <p className="text-[14px] font-semibold text-warn">{D.unsaved}</p>}
        {message && (
          <Notice tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
            {message.text}
            {conflict && (
              <Button variant="link" className="ml-1" onClick={() => void reloadLatest()}>
                {D.reload}
              </Button>
            )}
          </Notice>
        )}
        <Button type="submit" block loading={busy} disabled={!dirty && !conflict}>
          {D.saveRecord}
        </Button>
        <p className="text-[13px] text-muted">
          {D.createdAt} {formatDateTimeKo(c.consultation.created_at)} · {D.updatedAt} {formatDateTimeKo(c.consultation.updated_at)}
        </p>
      </form>
    </section>
  );
}

function DeleteSection({ detail }: { detail: SubmissionDetail }) {
  const D = T.admin.detail;
  const { call } = useAdminData();
  const backend = useBackend();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  return (
    <section className="rounded-card border border-[#f2b8b2] bg-surface p-5">
      <LiveMessage message={live} />
      <h2 className="text-lg font-bold">{D.deleteTitle}</h2>
      <p className="mt-1 text-[15px] text-muted">{D.deleteHelp}</p>
      <Button variant="secondary" className="mt-3 text-danger" onClick={() => setOpen(true)}>
        {D.deleteTitle}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${detail.student_name} 학생 응답 삭제`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {T.common.cancel}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={confirm.trim() !== detail.student_name}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  // 시험지 사진 파일을 먼저 지운 뒤 응답을 지운다 (파일이 남지 않게)
                  const paths = [
                    ...photoPaths(detail.common.questions, detail.common.answers),
                    ...detail.courses.flatMap((x) => photoPaths(x.questions, x.answers)),
                  ];
                  if (paths.length) await backend.storage.remove(paths);
                  await call('admin_delete_submission', { p_id: detail.id, p_confirm_student_name: confirm.trim() });
                  setLive(D.deleted);
                  navigate('/admin/responses', { replace: true });
                } catch (e) {
                  setError(adminErrorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {D.deleteButton}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[15px]">
          <p>{D.deleteHelp}</p>
          <ul className="list-disc pl-5">
            <li>
              접수 번호 {detail.receipt_code} · {formatDateTimeKo(detail.received_at)}
            </li>
            <li>
              {detail.student_name} / {detail.parent_name} / {formatPhone(detail.parent_phone)}
            </li>
            <li>수업: {detail.courses.map((c) => c.course.name).join(', ')}</li>
          </ul>
          <Field id="delete-confirm" label={D.deleteConfirmLabel(detail.student_name)} error={error}>
            {(a) => <TextInput {...a} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}
          </Field>
        </div>
      </Dialog>
    </section>
  );
}

/** 시험지 사진: 관리자만 볼 수 있는 잠깐 쓰는 주소로 보여준다 */
function PhotoThumbs({ answer }: { answer: Answer | undefined }) {
  const backend = useBackend();
  const paths = useMemo(() => (answer?.status === 'answered' && Array.isArray(answer.value) ? answer.value : []), [answer]);
  const [urls, setUrls] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    backend.storage.signedUrls(paths).then(
      (u) => alive && setUrls(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [backend, paths]);
  if (paths.length === 0) return null;
  if (failed) return <span className="text-muted">사진 {paths.length}장 (불러오지 못했습니다)</span>;
  return (
    <ul className="mt-1 flex flex-wrap gap-2">
      {paths.map((p, i) => (
        <li key={p}>
          {urls?.[p] ? (
            <a href={urls[p]} target="_blank" rel="noreferrer noopener" className="block">
              <img src={urls[p]} alt={`시험지 사진 ${i + 1}`} className="size-24 rounded-lg border border-line object-cover" />
              <span className="sr-only">새 창에서 크게 보기</span>
            </a>
          ) : (
            <span className="flex size-24 items-center justify-center rounded-lg border border-line text-[12px] text-muted">
              {urls ? '파일 없음' : '불러오는 중'}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
