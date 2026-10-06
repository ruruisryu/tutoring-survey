import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { T } from '../copy/ko';
import { isApiError } from '../lib/backend/errors';
import { applicableQuestions, normalizeQuestionDef, OPTION_VALUE_RE, validateQuestionDefs, visibilityMap } from '../lib/questions';
import { formatDateTimeKo } from '../lib/time';
import { GRADE_OPTIONS } from '../lib/survey';
import type { Answers, Question, QuestionRole, QuestionType } from '../lib/types';
import { Button, Dialog, LiveMessage, LoadingBlock, Notice, Select, Tag, TextArea, TextInput, cx, useDocumentTitle } from '../components/ui';
import { QuestionField } from '../components/QuestionField';
import { adminErrorText, useAdminData } from './AdminData';
import { UnsavedGuard } from './UnsavedGuard';

const TYPES: QuestionType[] = ['short_text', 'long_text', 'single', 'multi', 'number', 'date', 'time'];
const ROLES: (QuestionRole | '')[] = ['', 'goal', 'textbook', 'progress', 'difficulty', 'score', 'confidence', 'note'];

export function TemplateEditorPage() {
  const { templateId = '' } = useParams();
  const { catalog } = useAdminData();
  const tpl = catalog?.templates.find((t) => t.id === templateId);
  if (!catalog) return <LoadingBlock />;
  if (!tpl) return <Notice tone="danger">양식을 찾을 수 없습니다.</Notice>;
  return <Editor key={`${tpl.id}:${tpl.draft?.updated_at ?? ''}:${tpl.published?.id ?? ''}`} templateId={tpl.id} />;
}

function Editor({ templateId }: { templateId: string }) {
  const E = T.admin.forms.editor;
  const { catalog, call, reloadCatalog } = useAdminData();
  const tpl = catalog!.templates.find((t) => t.id === templateId)!;
  const subject = catalog!.subjects.find((s) => s.id === tpl.subject_id);
  const courses = catalog!.courses.filter((c) => c.template_id === tpl.id);
  const initial = useMemo(() => structuredClone(tpl.draft?.questions ?? tpl.published?.questions ?? []), [tpl]);
  const [qs, setQs] = useState<Question[]>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | 'discard' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [previewCourse, setPreviewCourse] = useState<string>('');
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const [previewGrade, setPreviewGrade] = useState<string>('middle-1');
  const [live, setLive] = useState('');
  useDocumentTitle(`${tpl.name} · ${T.admin.forms.title}`);

  const dirty = JSON.stringify(qs) !== JSON.stringify(initial);
  const defErrors = validateQuestionDefs(qs);
  const errorsOf = (i: number) => defErrors.filter((e) => e.index === i).map((e) => E.defErrors[e.code] ?? e.code);

  const update = (i: number, patch: Partial<Question>) => setQs((list) => list.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) =>
    setQs((list) => {
      const next = [...list];
      const j = i + d;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const saveDraft = async () => {
    if (defErrors.length) {
      setMessage({ tone: 'danger', text: '질문 설정에 오류가 있습니다. 표시된 질문을 확인해주세요.' });
      setOpen(qs[defErrors[0].index]?.id ?? null);
      return false;
    }
    await call('admin_save_draft', { p_template_id: tpl.id, p_questions: qs.map(normalizeQuestionDef) });
    return true;
  };

  const run = async (kind: 'save' | 'publish' | 'discard') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'save') {
        if (!(await saveDraft())) return;
        setLive(E.saved);
        await reloadCatalog();
      } else if (kind === 'publish') {
        if (dirty || !tpl.draft) {
          if (!(await saveDraft())) return;
        }
        const r = await call<{ version_no: number }>('admin_publish_draft', { p_template_id: tpl.id });
        setLive(E.publishedDone(r.version_no));
        await reloadCatalog();
      } else {
        await call('admin_discard_draft', { p_template_id: tpl.id });
        await reloadCatalog();
      }
    } catch (e) {
      const text = isApiError(e) && e.code === 'invalid_questions' && e.detail?.includes('locked_question_removed') ? '기본 질문은 삭제할 수 없습니다.' : adminErrorText(e);
      setMessage({ tone: 'danger', text });
    } finally {
      setBusy(null);
      setConfirmPublish(false);
    }
  };

  const addQuestion = (type: QuestionType) => {
    let n = qs.length + 1;
    while (qs.some((q) => q.id === `q_${n}`)) n++;
    const q: Question = {
      id: `q_${n}`,
      type,
      label: '새 질문',
      required: false,
      active: true,
      ...(type === 'single' || type === 'multi' ? { options: [{ value: 'option_1', label: '선택지 1' }] } : {}),
    };
    setQs((list) => [...list, q]);
    setOpen(q.id);
  };

  const previewQs = applicableQuestions(qs, previewCourse || null);
  const previewVis = visibilityMap(previewQs, previewAnswers, previewGrade);

  return (
    <div className="space-y-6">
      <UnsavedGuard dirty={dirty} />
      <LiveMessage message={live} />
      <Link to="/admin/forms" className="inline-flex min-h-10 items-center text-[15px] font-semibold text-accent-strong underline-offset-4 hover:underline">
        ← {T.admin.forms.title}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{E.title(tpl.name)}</h1>
          <p className="mt-1 text-[14px] text-muted">
            {subject ? `${subject.name} · ` : ''}
            {tpl.published ? T.admin.forms.published(tpl.published.version_no) : T.admin.forms.notPublished}
            {tpl.draft && ` · ${E.basedOn(tpl.published?.version_no ?? null)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tpl.draft && (
            <Button variant="ghost" size="sm" loading={busy === 'discard'} onClick={() => { if (window.confirm('초안을 버리고 발행된 버전으로 되돌릴까요?')) void run('discard'); }}>
              {E.discard}
            </Button>
          )}
          <Button variant="secondary" loading={busy === 'save'} disabled={!dirty} onClick={() => void run('save')}>
            {E.saveDraft}
          </Button>
          <Button loading={busy === 'publish'} disabled={!dirty && !tpl.draft} onClick={() => setConfirmPublish(true)}>
            {E.publish}
          </Button>
        </div>
      </div>
      {dirty && <p className="text-[14px] font-semibold text-warn">{E.unsaved}</p>}
      {message && (
        <Notice tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      <Notice>{T.admin.forms.systemFields}</Notice>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="질문 목록" className="space-y-3">
          {qs.length === 0 && <p className="text-muted">{E.empty}</p>}
          {qs.map((q, i) => {
            const errs = errorsOf(i);
            const expanded = open === q.id;
            return (
              <div key={i} className={cx('rounded-card border bg-surface', errs.length ? 'border-danger' : 'border-line', !q.active && 'opacity-75')}>
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`q-edit-${i}`}
                    onClick={() => setOpen(expanded ? null : q.id)}
                    className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span aria-hidden="true" className="text-muted">
                      {expanded ? '▾' : '▸'}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{q.label || '(문구 없음)'}</span>
                      <span className="flex flex-wrap gap-1.5 text-[13px] text-muted">
                        <span>{E.types[q.type]}</span>
                        {q.required && <Tag>{E.required}</Tag>}
                        {!q.active && <Tag tone="warn">숨김</Tag>}
                        {q.locked && <Tag>기본 질문</Tag>}
                        {q.show_if && <Tag>조건부</Tag>}
                        {q.course_ids?.length ? <Tag>일부 수업</Tag> : null}
                        {q.grades?.length ? <Tag>{q.grades.map((g) => GRADE_OPTIONS.find((o) => o.key === g)?.label.replace('학교 ', '').replace('학년', '')).join('·')}</Tag> : null}
                        {errs.length > 0 && <Tag tone="danger">오류</Tag>}
                      </span>
                    </span>
                  </button>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${q.label} ${E.moveUp}`}>
                      ↑
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === qs.length - 1} aria-label={`${q.label} ${E.moveDown}`}>
                      ↓
                    </Button>
                    {!q.locked && (
                      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setQs((list) => list.filter((_, j) => j !== i))} aria-label={`${q.label} ${E.remove}`}>
                        {E.remove}
                      </Button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div id={`q-edit-${i}`} className="border-t border-line px-4 py-4">
                    <QuestionEditor q={q} index={i} all={qs} courses={courses} onChange={(patch) => update(i, patch)} errors={errs} />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-dashed border-line-strong p-4">
            <span className="text-[15px] font-semibold">{E.addQuestion}:</span>
            {TYPES.map((t) => (
              <Button key={t} variant="secondary" size="sm" onClick={() => addQuestion(t)}>
                + {E.types[t]}
              </Button>
            ))}
          </div>

          <section className="rounded-card border border-line bg-surface p-4">
            <h2 className="font-bold">{E.versions}</h2>
            {tpl.versions.length === 0 ? (
              <p className="mt-2 text-[15px] text-muted">{T.admin.forms.notPublished}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-[15px]">
                {tpl.versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-semibold">v{v.version_no}</span>
                    {v.status === 'published' ? <Tag tone="accent">현재 발행</Tag> : <Tag>이전 버전</Tag>}
                    <span className="text-muted">{formatDateTimeKo(v.published_at)}</span>
                    <span className="text-muted">· {E.versionResponses(v.response_count)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[13px] text-muted">이전 버전으로 받은 응답은 그 버전의 질문과 선택지로 보존됩니다.</p>
          </section>
        </section>

        <aside aria-labelledby="preview-title" className="lg:sticky lg:top-4 lg:h-fit">
          <h2 id="preview-title" className="font-bold">
            {E.preview}
          </h2>
          <p className="mt-1 text-[13px] text-muted">{E.previewNote}</p>
          {courses.length > 0 && (
            <label className="mt-2 block">
              <span className="text-[14px] font-semibold">미리볼 수업</span>
              <Select value={previewCourse} onChange={(e) => setPreviewCourse(e.target.value)} className="mt-1">
                <option value="">모든 수업에 공통인 질문만</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="mt-2 block">
            <span className="text-[14px] font-semibold">미리볼 학생 학년</span>
            <Select value={previewGrade} onChange={(e) => setPreviewGrade(e.target.value)} className="mt-1">
              {GRADE_OPTIONS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
              <option value="other">기타</option>
            </Select>
          </label>
          <div className="mx-auto mt-3 w-full max-w-[375px] overflow-hidden rounded-[28px] border-8 border-ink/85 bg-bg">
            <div className="max-h-[70dvh] space-y-6 overflow-y-auto px-4 py-5">
              {subject?.perspective && (
                <aside className="border-l-4 border-accent bg-surface px-3 py-2 text-[15px]">
                  <p className="font-semibold text-accent-strong">{T.parent.course.perspectiveTitle}</p>
                  <p className="mt-1">{subject.perspective}</p>
                </aside>
              )}
              {previewQs
                .filter((q) => previewVis[q.id])
                .map((q) => (
                  <QuestionField
                    key={q.id}
                    question={q}
                    fieldId={`preview-${q.id}`}
                    answer={previewAnswers[q.id]}
                    onChange={(a) =>
                      setPreviewAnswers((m) => {
                        const n = { ...m };
                        if (a) n[q.id] = a;
                        else delete n[q.id];
                        return n;
                      })
                    }
                  />
                ))}
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        title={E.publish}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
              {T.common.cancel}
            </Button>
            <Button loading={busy === 'publish'} onClick={() => void run('publish')}>
              {E.publish}
            </Button>
          </>
        }
      >
        <p className="text-[15px] leading-relaxed">{E.publishConfirm}</p>
      </Dialog>
    </div>
  );
}

function QuestionEditor({
  q,
  index,
  all,
  courses,
  onChange,
  errors,
}: {
  q: Question;
  index: number;
  all: Question[];
  courses: { id: string; name: string }[];
  onChange: (patch: Partial<Question>) => void;
  errors: string[];
}) {
  const E = T.admin.forms.editor;
  const p = `qe-${index}`;
  const earlier = all.slice(0, index).filter((x) => x.type === 'single' || x.type === 'multi');
  const ref = earlier.find((x) => x.id === q.show_if?.question);
  const hasOptions = q.type === 'single' || q.type === 'multi';
  const label = (id: string, text: string, el: React.ReactNode, help?: string) => (
    <div>
      <label htmlFor={id} className="block text-[14px] font-semibold">
        {text}
      </label>
      {help && <p className="text-[13px] text-muted">{help}</p>}
      <div className="mt-1">{el}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <Notice tone="danger" role="alert">
          {errors.join(' ')}
        </Notice>
      )}
      {q.locked && <p className="text-[14px] text-muted">{E.lockedHint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {label(`${p}-id`, E.id, <TextInput id={`${p}-id`} value={q.id} disabled={q.locked} onChange={(e) => onChange({ id: e.target.value.trim() })} />, E.idHelp)}
        {label(
          `${p}-type`,
          E.type,
          <Select
            id={`${p}-type`}
            value={q.type}
            disabled={q.locked}
            onChange={(e) => {
              const type = e.target.value as QuestionType;
              const opt = type === 'single' || type === 'multi';
              onChange({ type, options: opt ? q.options ?? [{ value: 'option_1', label: '선택지 1' }] : undefined, max_length: undefined, min: undefined, max: undefined });
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {E.types[t]}
              </option>
            ))}
          </Select>,
        )}
      </div>
      {label(`${p}-label`, E.label, <TextInput id={`${p}-label`} maxLength={200} value={q.label} onChange={(e) => onChange({ label: e.target.value })} />)}
      {label(`${p}-help`, E.help, <TextArea id={`${p}-help`} rows={2} maxLength={300} value={q.help ?? ''} onChange={(e) => onChange({ help: e.target.value })} />)}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="inline-flex min-h-10 items-center gap-2">
          <input type="checkbox" className="size-5 accent-accent" checked={q.required} onChange={(e) => onChange({ required: e.target.checked })} />
          {E.required}
        </label>
        <label className="inline-flex min-h-10 items-center gap-2">
          <input type="checkbox" className="size-5 accent-accent" checked={q.active} onChange={(e) => onChange({ active: e.target.checked })} />
          {E.active}
        </label>
        <label className="inline-flex min-h-10 items-center gap-2">
          <input type="checkbox" className="size-5 accent-accent" checked={!!q.allow_unknown} onChange={(e) => onChange({ allow_unknown: e.target.checked, unknown_label: e.target.checked ? q.unknown_label ?? '모름' : undefined })} />
          {E.allowUnknown}
        </label>
      </div>
      {q.allow_unknown &&
        label(`${p}-unk`, E.unknownLabel, <TextInput id={`${p}-unk`} maxLength={30} value={q.unknown_label ?? ''} onChange={(e) => onChange({ unknown_label: e.target.value })} className="max-w-sm" />)}

      {hasOptions && (
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-[14px] font-semibold">{E.options}</legend>
          <ul className="space-y-2">
            {(q.options ?? []).map((o, j) => (
              <li key={j} className="flex flex-wrap items-center gap-2">
                <TextInput
                  aria-label={`${E.optionLabel} ${j + 1}`}
                  value={o.label}
                  maxLength={100}
                  onChange={(e) => onChange({ options: q.options!.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })}
                  className="min-w-40 flex-1"
                />
                <TextInput
                  aria-label={`${E.optionValue} ${j + 1}`}
                  value={o.value}
                  maxLength={40}
                  onChange={(e) => onChange({ options: q.options!.map((x, k) => (k === j ? { ...x, value: e.target.value.trim() } : x)) })}
                  className={cx('w-36 font-mono text-[14px]', !OPTION_VALUE_RE.test(o.value) && 'border-danger')}
                />
                {q.type === 'multi' && (
                  <label className="inline-flex items-center gap-1.5 text-[14px]">
                    <input type="checkbox" className="size-4 accent-accent" checked={!!o.exclusive} onChange={(e) => onChange({ options: q.options!.map((x, k) => (k === j ? { ...x, exclusive: e.target.checked || undefined } : x)) })} />
                    {E.optionExclusive}
                  </label>
                )}
                <Button variant="ghost" size="sm" onClick={() => onChange({ options: q.options!.filter((_, k) => k !== j) })} aria-label={`선택지 ${o.label} 삭제`}>
                  {T.common.delete}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              let n = (q.options?.length ?? 0) + 1;
              while (q.options?.some((o) => o.value === `option_${n}`)) n++;
              onChange({ options: [...(q.options ?? []), { value: `option_${n}`, label: `선택지 ${n}` }] });
            }}
          >
            + {E.addOption}
          </Button>
          <p className="mt-2 text-[13px] text-muted">값은 응답 저장에 쓰이므로 발행 후에는 바꾸지 않는 것이 좋습니다. 표시 문구는 자유롭게 고쳐도 됩니다.</p>
        </fieldset>
      )}

      {(q.type === 'short_text' || q.type === 'long_text') &&
        label(
          `${p}-max`,
          E.maxLength,
          <TextInput id={`${p}-max`} type="number" min={1} max={q.type === 'short_text' ? 200 : 2000} value={q.max_length ?? ''} onChange={(e) => onChange({ max_length: e.target.value ? Number(e.target.value) : undefined })} className="max-w-40" />,
        )}
      {q.type === 'number' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {label(`${p}-min`, E.min, <TextInput id={`${p}-min`} type="number" value={q.min ?? ''} onChange={(e) => onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })} />)}
          {label(`${p}-maxv`, E.max, <TextInput id={`${p}-maxv`} type="number" value={q.max ?? ''} onChange={(e) => onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })} />)}
        </div>
      )}

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[14px] font-semibold">{E.showIf}</legend>
        <Select
          aria-label={E.showIfQuestion}
          value={q.show_if?.question ?? ''}
          onChange={(e) => onChange({ show_if: e.target.value ? { question: e.target.value, any_of: [] } : null })}
        >
          <option value="">{E.showIfNone}</option>
          {earlier.map((x) => (
            <option key={x.id} value={x.id}>
              {E.showIfQuestion}: {x.label}
            </option>
          ))}
        </Select>
        {ref && (
          <div className="mt-2">
            <p className="text-[14px] text-muted">{E.showIfAnyOf}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {(ref.options ?? []).map((o) => (
                <label key={o.value} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-[14px]">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={q.show_if!.any_of.includes(o.value)}
                    onChange={(e) =>
                      onChange({
                        show_if: { question: ref.id, any_of: e.target.checked ? [...q.show_if!.any_of, o.value] : q.show_if!.any_of.filter((v) => v !== o.value) },
                      })
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[14px] font-semibold">{E.grades}</legend>
        <p className="text-[13px] text-muted">{E.gradesHelp}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {GRADE_OPTIONS.map((g) => (
            <label key={g.key} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-[14px]">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={!!q.grades?.includes(g.key)}
                onChange={(e) => onChange({ grades: e.target.checked ? [...(q.grades ?? []), g.key] : (q.grades ?? []).filter((x) => x !== g.key) })}
              />
              {g.label.replace('학교 ', '').replace('학년', '')}
            </label>
          ))}
        </div>
      </fieldset>

      {courses.length > 0 && (
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-[14px] font-semibold">{E.courses}</legend>
          <p className="text-[13px] text-muted">{E.coursesHelp}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {courses.map((c) => (
              <label key={c.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-[14px]">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={!!q.course_ids?.includes(c.id)}
                  onChange={(e) => onChange({ course_ids: e.target.checked ? [...(q.course_ids ?? []), c.id] : (q.course_ids ?? []).filter((x) => x !== c.id) })}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {label(
          `${p}-role`,
          E.role,
          <Select id={`${p}-role`} value={q.role ?? ''} onChange={(e) => onChange({ role: (e.target.value || undefined) as QuestionRole | undefined })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {E.roles[r]}
              </option>
            ))}
          </Select>,
        )}
        {label(`${p}-follow`, E.followup, <TextInput id={`${p}-follow`} maxLength={160} value={q.followup ?? ''} onChange={(e) => onChange({ followup: e.target.value })} />, E.followupHelp)}
      </div>
    </div>
  );
}
