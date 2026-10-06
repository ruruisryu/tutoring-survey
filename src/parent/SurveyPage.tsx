import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { T } from '../copy/ko';
import { useBackend } from '../app/BackendContext';
import { ApiError, isApiError, type FieldError } from '../lib/backend/errors';
import {
  buildPayload,
  createDraft,
  estimateMinutes,
  stepOfPath,
  stepsFor,
  validateAll,
  validateStep,
  type StepId,
} from '../lib/survey';
import { seoulDate } from '../lib/time';
import type { PublicForm, SurveyDraft } from '../lib/types';
import { Button, ErrorSummary, LiveMessage, LoadingBlock, Notice, useBeforeUnload, useDocumentTitle } from '../components/ui';
import { ParentLayout } from './ParentLayout';
import { IntroView } from './IntroView';
import { StatusView } from './StatusView';
import { DoneView } from './DoneView';
import { BasicStep } from './steps/BasicStep';
import { ScheduleStep } from './steps/ScheduleStep';
import { CourseStep } from './steps/CourseStep';
import { ReviewStep } from './steps/ReviewStep';
import { errorLookup, toSummary } from './fieldLabels';

type Phase = 'intro' | 'form' | 'done';

export function SurveyPage() {
  const { token = '' } = useParams();
  const backend = useBackend();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const [returnToReview, setReturnToReview] = useState(false);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    setLoadError(false);
    setForm(null);
    try {
      const f = await backend.rpc<PublicForm>('get_public_form', { p_token: token });
      setForm(f);
      if (f.status === 'open') setDraft(createDraft(f));
    } catch {
      setLoadError(true);
    }
  }, [backend, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useDocumentTitle(form?.settings?.parent_title || T.parent.headerDefault);
  useBeforeUnload(phase === 'form' && dirty.current);

  const today = form?.today ?? seoulDate();
  const steps = useMemo(() => (draft ? stepsFor(draft) : []), [draft]);
  const step: StepId | undefined = steps[stepIndex];

  // 단계가 바뀌면 제목으로 포커스를 옮긴다
  useEffect(() => {
    if (phase !== 'form') return;
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [stepIndex, phase]);

  const update = useCallback((fn: (d: SurveyDraft) => void) => {
    dirty.current = true;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  if (loadError) {
    return (
      <ParentLayout>
        <StatusView title={T.parent.status.loadError.title} body={T.parent.status.loadError.body} action={<Button onClick={() => void load()}>{T.common.retry}</Button>} />
      </ParentLayout>
    );
  }
  if (!form) {
    return (
      <ParentLayout>
        <LoadingBlock />
      </ParentLayout>
    );
  }
  if (form.status !== 'open' || !draft) {
    const s = T.parent.status[form.status as keyof typeof T.parent.status] ?? T.parent.status.invalid;
    return (
      <ParentLayout settings={form.settings}>
        <StatusView title={s.title} body={s.body} />
      </ParentLayout>
    );
  }
  if (phase === 'done') {
    return (
      <ParentLayout settings={form.settings}>
        <DoneView settings={form.settings} receipt={receipt} />
      </ParentLayout>
    );
  }
  if (phase === 'intro') {
    return (
      <ParentLayout settings={form.settings}>
        <IntroView form={form} minutes={estimateMinutes(form, draft.selected)} onStart={() => setPhase('form')} />
      </ParentLayout>
    );
  }

  const showErrors = (errs: FieldError[]) => {
    setErrors(errs);
    setLive(T.parent.errorSummary(toSummary(errs, form, draft).length));
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const goTo = (i: number) => {
    setErrors([]);
    setSubmitError(null);
    setStepIndex(i);
    setLive(stepTitle(steps[i]) + ' · ' + T.parent.stepOf(i + 1, steps.length));
  };

  const next = () => {
    const errs = validateStep(form, draft, step!, today);
    if (errs.length) return showErrors(errs);
    if (returnToReview) {
      setReturnToReview(false);
      return goTo(steps.length - 1);
    }
    goTo(stepIndex + 1);
  };

  const back = () => goTo(Math.max(0, stepIndex - 1));

  const editFromReview = (target: StepId) => {
    setReturnToReview(true);
    goTo(steps.indexOf(target));
  };

  const submit = async () => {
    if (submitting) return;
    const all = validateAll(form, draft, today);
    if (all.length) {
      const target = stepOfPath(all[0].path, draft);
      const errsOnTarget = all.filter((e) => stepOfPath(e.path, draft) === target);
      if (target !== 'review') goTo(steps.indexOf(target));
      setTimeout(() => showErrors(errsOnTarget), 0);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setLive(T.parent.review.submitting);
    try {
      const res = await backend.rpc<{ ok: boolean; receipt_code: string }>('submit_consultation', {
        p_token: token,
        p_idempotency_key: idempotencyKey.current,
        p_payload: buildPayload(form, draft),
      });
      if (!res?.ok) throw new ApiError('unknown_error');
      dirty.current = false;
      setReceipt(res.receipt_code);
      setPhase('done');
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = isApiError(e) ? e : new ApiError('unknown_error');
      const SE = T.parent.submitErrors;
      let message: string = SE.server;
      if (err.kind === 'network') message = SE.network;
      else if (err.code === 'validation_failed') {
        const fe = err.fieldErrors;
        if (fe.length) {
          const target = stepOfPath(fe[0].path, draft);
          const onTarget = fe.filter((x) => stepOfPath(x.path, draft) === target);
          if (target !== 'review') goTo(steps.indexOf(target));
          setTimeout(() => showErrors(onTarget), 0);
          setSubmitting(false);
          return;
        }
        message = SE.validation;
      } else if (err.code === 'rate_limited') message = SE.rateLimited;
      else if (err.code === 'form_outdated') message = SE.formOutdated;
      else if (err.code === 'invitation_closed' || err.code === 'invitation_invalid') message = SE.closed;
      else if (err.code === 'course_unavailable') message = SE.courseUnavailable;
      setSubmitError(message);
      setLive(message);
    } finally {
      setSubmitting(false);
    }
  };

  const err = errorLookup(errors, form, draft);
  const summary = toSummary(errors, form, draft);
  const isReview = step === 'review';

  function stepTitle(s: StepId | undefined): string {
    if (!s) return '';
    if (s === 'basic') return T.parent.steps.basic;
    if (s === 'schedule') return form!.allow_multiple && (form!.courses?.length ?? 0) > 1 ? T.parent.steps.schedule : T.parent.steps.scheduleSingle;
    if (s === 'review') return T.parent.steps.review;
    const c = form!.courses!.find((x) => `course:${x.id}` === s);
    return T.parent.steps.course(c?.subject_name ?? '');
  }

  return (
    <ParentLayout settings={form.settings}>
      <LiveMessage message={live} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (isReview) void submit();
          else next();
        }}
      >
        <StepHeader index={stepIndex} total={steps.length} title={stepTitle(step)} headingRef={headingRef} />

        {/* 스팸 방지용 숨은 칸 (사람에게는 보이지 않음) */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            웹사이트
            <input tabIndex={-1} autoComplete="off" value={draft.website} onChange={(e) => update((d) => void (d.website = e.target.value))} />
          </label>
        </div>

        <div className="mt-6 space-y-6">
          <ErrorSummary ref={summaryRef} errors={summary} title={T.parent.errorSummary(summary.length)} />

          {step === 'basic' && <BasicStep form={form} draft={draft} update={update} err={err} />}
          {step === 'schedule' && <ScheduleStep form={form} draft={draft} update={update} err={err} today={today} />}
          {step?.startsWith('course:') && (
            <CourseStep form={form} draft={draft} update={update} err={err} courseId={step.slice('course:'.length)} />
          )}
          {isReview && <ReviewStep form={form} draft={draft} update={update} err={err} onEdit={editFromReview} />}

          {submitError && (
            <Notice tone="danger" role="alert">
              {submitError}
            </Notice>
          )}
        </div>

        <div className="mt-10 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
          {stepIndex > 0 ? (
            <Button variant="secondary" onClick={back} disabled={submitting}>
              {T.common.back}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setPhase('intro')}>
              {T.common.back}
            </Button>
          )}
          {isReview ? (
            <Button type="submit" loading={submitting} loadingText={T.parent.review.submitting} className="sm:min-w-56">
              {T.parent.review.submit}
            </Button>
          ) : (
            <Button type="submit" className="sm:min-w-40">
              {returnToReview ? T.parent.backToReview : T.common.next}
            </Button>
          )}
        </div>
      </form>
    </ParentLayout>
  );
}

function StepHeader({ index, total, title, headingRef }: { index: number; total: number; title: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const pct = Math.round(((index + 1) / total) * 100);
  return (
    <div>
      <p className="text-[15px] font-semibold text-accent-strong">{T.parent.stepOf(index + 1, total)}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 text-2xl font-bold leading-snug tracking-tight sm:text-[28px]">
        {title}
      </h1>
    </div>
  );
}

