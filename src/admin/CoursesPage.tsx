import { useMemo, useState } from 'react';
import { T } from '../copy/ko';
import { isApiError } from '../lib/backend/errors';
import { endTime, formatDateTimeKo, WEEKDAY_LABELS, WEEKDAY_ORDER } from '../lib/time';
import { invitationUrl, seoulLocalToIso } from '../lib/url';
import type { Course, CourseSchoolLevel, FixedCondition, GroupType, Invitation, Mode, TimeBand } from '../lib/types';
import {
  Button,
  Card,
  Choice,
  Dialog,
  EmptyState,
  Field,
  LiveMessage,
  LoadingBlock,
  Notice,
  Select,
  SubjectBadge,
  Tag,
  TextArea,
  TextInput,
  useDocumentTitle,
} from '../components/ui';
import { ConditionList } from '../components/CourseSummary';
import { adminErrorText, useAdminData } from './AdminData';

type CourseForm = {
  id?: string;
  name: string;
  subject_id: string;
  template_id: string;
  school_level: CourseSchoolLevel;
  grades: number[];
  scope_text: string;
  mode: Mode;
  group_type: GroupType;
  sessions_per_week: string;
  minutes_per_session: string;
  weekdays: number[];
  time_bands: TimeBand[];
  start_time: string;
  time_note: string;
  start_date: string;
  duration_text: string;
  fixed_conditions: FixedCondition[];
  session_choices: number[];
  notice: string;
  status: Course['status'];
  sort_order: string;
};

const FIXED: FixedCondition[] = ['weekdays', 'start_time', 'minutes', 'sessions', 'start_date', 'duration'];

function emptyCourse(subjectId: string, templateId: string): CourseForm {
  return {
    name: '',
    subject_id: subjectId,
    template_id: templateId,
    school_level: 'middle',
    grades: [],
    scope_text: '',
    mode: 'negotiable',
    group_type: 'negotiable',
    sessions_per_week: '',
    minutes_per_session: '',
    weekdays: [],
    time_bands: [],
    start_time: '',
    time_note: '',
    start_date: '',
    duration_text: '',
    fixed_conditions: [],
    session_choices: [],
    notice: '',
    status: 'open',
    sort_order: '100',
  };
}

function fromCourse(c: Course): CourseForm {
  return {
    id: c.id,
    name: c.name,
    subject_id: c.subject_id,
    template_id: c.template_id,
    school_level: c.school_level,
    grades: c.grades,
    scope_text: c.scope_text,
    mode: c.mode,
    group_type: c.group_type,
    sessions_per_week: c.sessions_per_week ? String(c.sessions_per_week) : '',
    minutes_per_session: c.minutes_per_session ? String(c.minutes_per_session) : '',
    weekdays: c.weekdays,
    time_bands: c.time_bands,
    start_time: c.start_time ?? '',
    time_note: c.time_note,
    start_date: c.start_date ?? '',
    duration_text: c.duration_text,
    fixed_conditions: c.fixed_conditions,
    session_choices: c.session_choices ?? [],
    notice: c.notice,
    status: c.status,
    sort_order: String(c.sort_order),
  };
}

export function CoursesPage() {
  const C = T.admin.courses;
  useDocumentTitle(`${C.title} · 수업 준비실`);
  const { catalog, catalogError, reloadCatalog, call } = useAdminData();
  const [editing, setEditing] = useState<CourseForm | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [live, setLive] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  if (catalogError)
    return (
      <Notice tone="danger" role="alert">
        {T.common.serverError}{' '}
        <Button variant="link" onClick={() => void reloadCatalog()}>
          {T.common.retry}
        </Button>
      </Notice>
    );
  if (!catalog) return <LoadingBlock />;

  const subjects = catalog.subjects.filter((s) => !s.archived_at);
  const subjectName = (id: string) => catalog.subjects.find((s) => s.id === id)?.name ?? '';
  const startNew = () => {
    const s = subjects[0];
    const tpl = catalog.templates.find((t) => t.id === s?.default_template_id) ?? catalog.templates.find((t) => t.subject_id === s?.id);
    setEditing(emptyCourse(s?.id ?? '', tpl?.id ?? ''));
  };

  const setStatus = async (c: Course, status: Course['status']) => {
    setRowError(null);
    try {
      await call('admin_set_course_status', { p_id: c.id, p_status: status });
      await reloadCatalog();
      setLive(`${c.name}: ${C.statusLabels[status]}`);
    } catch (e) {
      setRowError(adminErrorText(e));
    }
  };

  const groups: Course['status'][] = ['open', 'closed', 'archived'];

  return (
    <div className="space-y-8">
      <LiveMessage message={live} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{C.title}</h1>
        <Button onClick={startNew} disabled={subjects.length === 0}>
          + {C.add}
        </Button>
      </div>
      {rowError && (
        <Notice tone="danger" role="alert">
          {rowError}
        </Notice>
      )}

      {catalog.courses.length === 0 ? (
        <EmptyState title={C.empty} />
      ) : (
        groups.map((g) => {
          const list = catalog.courses.filter((c) => c.status === g);
          if (list.length === 0) return null;
          return (
            <section key={g} aria-labelledby={`group-${g}`}>
              <h2 id={`group-${g}`} className="mb-3 text-lg font-bold">
                {C.statusLabels[g]} <span className="text-muted">({list.length})</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((c) => (
                  <Card key={c.id} className="flex flex-col p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <SubjectBadge name={subjectName(c.subject_id)} />
                      <Tag tone={c.status === 'open' ? 'accent' : 'neutral'}>{C.statusLabels[c.status]}</Tag>
                      <span className="text-[13px] text-muted">{C.responses(c.response_count)}</span>
                    </div>
                    <h3 className="mt-2 text-lg font-bold">{c.name}</h3>
                    <div className="mt-3 flex-1">
                      <ConditionList course={c} compact />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(fromCourse(c))}>
                        {T.common.edit}
                      </Button>
                      <label className="sr-only" htmlFor={`status-${c.id}`}>
                        {C.status}
                      </label>
                      <Select id={`status-${c.id}`} value={c.status} onChange={(e) => void setStatus(c, e.target.value as Course['status'])} className="min-h-10 w-auto py-1.5 text-[15px]">
                        {groups.map((s) => (
                          <option key={s} value={s}>
                            {C.statusLabels[s]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })
      )}

      <InvitationsSection invitations={catalog.invitations} courses={catalog.courses} subjectName={subjectName} onCreate={() => setInviteOpen(true)} />

      {editing && (
        <CourseEditor
          form={editing}
          onClose={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            await reloadCatalog();
            setLive(`${name} ${T.common.saved}`);
          }}
        />
      )}
      {inviteOpen && (
        <InvitationCreator
          courses={catalog.courses.filter((c) => c.status !== 'archived')}
          subjectName={subjectName}
          onClose={() => setInviteOpen(false)}
          onCreated={async () => {
            setInviteOpen(false);
            await reloadCatalog();
            setLive('초대 링크를 만들었습니다.');
          }}
        />
      )}
    </div>
  );
}

function CourseEditor({ form: initial, onClose, onSaved }: { form: CourseForm; onClose: () => void; onSaved: (name: string) => void }) {
  const C = T.admin.courses;
  const { catalog, call } = useAdminData();
  const [f, setF] = useState<CourseForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof CourseForm>(k: K, v: CourseForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = <V,>(arr: V[], v: V) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const templates = (catalog?.templates ?? []).filter((t) => t.kind === 'subject' && t.subject_id === f.subject_id && !t.archived_at);
  const selectedTpl = templates.find((t) => t.id === f.template_id);
  const minutes = Number(f.minutes_per_session) || 0;
  const end = f.start_time && minutes ? endTime(f.start_time, minutes) : null;
  const subjects = (catalog?.subjects ?? []).filter((s) => !s.archived_at || s.id === f.subject_id);

  const save = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await call('admin_save_course', {
        p: {
          ...f,
          id: f.id ?? '',
          sessions_per_week: f.sessions_per_week ? Number(f.sessions_per_week) : null,
          minutes_per_session: f.minutes_per_session ? Number(f.minutes_per_session) : null,
          start_time: f.start_time || null,
          start_date: f.start_date || null,
          sort_order: Number(f.sort_order) || 100,
        },
      });
      onSaved(f.name);
    } catch (e) {
      if (isApiError(e) && e.fieldErrors.length) {
        const map: Record<string, string> = {};
        for (const fe of e.fieldErrors)
          map[fe.path] = fe.code === 'fixed_needs_value' ? '확정 조건으로 표시했다면 값을 입력해주세요.' : fe.code === 'required' ? T.errors.required : T.errors.invalid;
        setFieldErrors(map);
        setError('입력값을 확인해주세요.');
      } else setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={f.id ? C.edit : C.add}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {T.common.cancel}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {C.save}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <Field id="c-name" label={C.name} required help={C.nameHelp} error={fieldErrors.name}>
          {(a) => <TextInput {...a} maxLength={60} value={f.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-subject" label={C.subject} required error={fieldErrors.subject_id}>
            {(a) => (
              <Select
                {...a}
                value={f.subject_id}
                onChange={(e) => {
                  const s = catalog?.subjects.find((x) => x.id === e.target.value);
                  setF((x) => ({ ...x, subject_id: e.target.value, template_id: s?.default_template_id ?? '' }));
                }}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="c-template" label={C.template} required help={C.templateHelp} error={fieldErrors.template_id}>
            {(a) => (
              <Select {...a} value={f.template_id} onChange={(e) => set('template_id', e.target.value)}>
                <option value="">선택</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.published ? `(v${t.published.version_no})` : '(발행 전)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {selectedTpl && !selectedTpl.published && <Notice tone="warn">{C.templateUnpublished}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-level" label={C.schoolLevel}>
            {(a) => (
              <Select {...a} value={f.school_level} onChange={(e) => setF((x) => ({ ...x, school_level: e.target.value as CourseSchoolLevel, grades: [] }))}>
                {(['elementary', 'middle', 'high', 'any'] as const).map((l) => (
                  <option key={l} value={l}>
                    {T.labels.schoolLevel[l]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {f.school_level !== 'any' && (
            <fieldset>
              <legend className="font-semibold">{C.grades}</legend>
              <p className="text-[14px] text-muted">{C.gradesHelp}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Array.from({ length: f.school_level === 'elementary' ? 6 : 3 }, (_, i) => i + 1).map((g) => (
                  <label key={g} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3">
                    <input type="checkbox" className="size-5 accent-accent" checked={f.grades.includes(g)} onChange={() => set('grades', toggle(f.grades, g))} />
                    {g}학년
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        <Field id="c-scope" label={C.scope} optional>
          {(a) => <TextInput {...a} maxLength={200} value={f.scope_text} onChange={(e) => set('scope_text', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-mode" label={C.mode}>
            {(a) => (
              <Select {...a} value={f.mode} onChange={(e) => set('mode', e.target.value as Mode)}>
                {(['in_person', 'online', 'hybrid', 'negotiable'] as const).map((m) => (
                  <option key={m} value={m}>
                    {T.labels.mode[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="c-group" label={C.groupType}>
            {(a) => (
              <Select {...a} value={f.group_type} onChange={(e) => set('group_type', e.target.value as GroupType)}>
                {(['individual', 'group', 'negotiable'] as const).map((m) => (
                  <option key={m} value={m}>
                    {T.labels.groupType[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="c-sessions" label={C.sessions} optional error={fieldErrors.sessions_per_week}>
            {(a) => <TextInput {...a} type="number" inputMode="numeric" min={1} max={7} value={f.sessions_per_week} onChange={(e) => set('sessions_per_week', e.target.value)} />}
          </Field>
          <Field id="c-minutes" label={C.minutes} optional error={fieldErrors.minutes_per_session}>
            {(a) => <TextInput {...a} type="number" inputMode="numeric" min={10} max={600} step={10} value={f.minutes_per_session} onChange={(e) => set('minutes_per_session', e.target.value)} />}
          </Field>
        </div>
        {!f.fixed_conditions.includes('sessions') && (
          <fieldset>
            <legend className="font-semibold">{C.sessionChoices}</legend>
            <p className="text-[14px] text-muted">{C.sessionChoicesHelp}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3">
                  <input type="checkbox" className="size-5 accent-accent" checked={f.session_choices.includes(n)} onChange={() => set('session_choices', toggle(f.session_choices, n).sort((a, b) => a - b))} />
                  {T.course.weeklyValue(n)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend className="font-semibold">{C.weekdays}</legend>
          <p className="text-[14px] text-muted">{C.weekdaysHelp}</p>
          {fieldErrors.weekdays && <p className="text-[14px] font-semibold text-danger">{fieldErrors.weekdays}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAY_ORDER.map((d) => (
              <label key={d} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3">
                <input type="checkbox" className="size-5 accent-accent" checked={f.weekdays.includes(d)} onChange={() => set('weekdays', toggle(f.weekdays, d))} />
                {WEEKDAY_LABELS[d]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">{C.timeBands}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['morning', 'afternoon', 'evening'] as const).map((b) => (
              <label key={b} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3">
                <input type="checkbox" className="size-5 accent-accent" checked={f.time_bands.includes(b)} onChange={() => set('time_bands', toggle(f.time_bands, b))} />
                {T.labels.timeBand[b]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-start-time" label={C.startTime} optional help={C.startTimeHelp} error={fieldErrors.start_time}>
            {(a) => (
              <div>
                <TextInput {...a} type="time" step={600} value={f.start_time} onChange={(e) => set('start_time', e.target.value)} />
                {end && <p className="mt-1 text-[14px] text-muted">{C.endPreview(`${end.nextDay ? '다음 날 ' : ''}${end.time}`)}</p>}
              </div>
            )}
          </Field>
          <Field id="c-time-note" label={C.timeNote} optional help={C.timeNoteHelp}>
            {(a) => <TextInput {...a} maxLength={120} value={f.time_note} onChange={(e) => set('time_note', e.target.value)} />}
          </Field>
          <Field id="c-start-date" label={C.startDate} optional error={fieldErrors.start_date}>
            {(a) => <TextInput {...a} type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />}
          </Field>
          <Field id="c-duration" label={C.duration} optional error={fieldErrors.duration_text}>
            {(a) => <TextInput {...a} maxLength={60} value={f.duration_text} onChange={(e) => set('duration_text', e.target.value)} />}
          </Field>
        </div>
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 font-semibold">{C.fixed}</legend>
          <p className="text-[14px] text-muted">{C.fixedHelp}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {FIXED.map((k) => (
              <label key={k} className="inline-flex min-h-10 items-center gap-2">
                <input type="checkbox" className="size-5 accent-accent" checked={f.fixed_conditions.includes(k)} onChange={() => set('fixed_conditions', toggle(f.fixed_conditions, k))} />
                {T.labels.fixedCondition[k]} {T.course.fixed}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[14px] text-muted">수업 방식·형태는 ‘협의’가 아니면 확정으로 안내합니다.</p>
        </fieldset>
        <Field id="c-notice" label={C.notice} optional help={C.noticeHelp}>
          {(a) => <TextArea {...a} rows={3} maxLength={800} value={f.notice} onChange={(e) => set('notice', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-status" label={C.status}>
            {(a) => (
              <Select {...a} value={f.status} onChange={(e) => set('status', e.target.value as Course['status'])}>
                {(['open', 'closed', 'archived'] as const).map((s) => (
                  <option key={s} value={s}>
                    {C.statusLabels[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="c-sort" label={T.admin.forms.sortOrder} optional>
            {(a) => <TextInput {...a} type="number" value={f.sort_order} onChange={(e) => set('sort_order', e.target.value)} />}
          </Field>
        </div>
        <div className="rounded-xl border border-dashed border-line-strong p-4">
          <p className="mb-2 text-[14px] font-semibold text-muted">학부모 화면 미리보기</p>
          <ConditionList
            course={{
              ...f,
              sessions_per_week: Number(f.sessions_per_week) || null,
              minutes_per_session: Number(f.minutes_per_session) || null,
              start_time: f.start_time || null,
              start_date: f.start_date || null,
            }}
            compact
          />
        </div>
      </div>
    </Dialog>
  );
}

function InvitationsSection({
  invitations,
  courses,
  subjectName,
  onCreate,
}: {
  invitations: Invitation[];
  courses: Course[];
  subjectName: (id: string) => string;
  onCreate: () => void;
}) {
  const C = T.admin.courses;
  const { call, reloadCatalog } = useAdminData();
  const [live, setLive] = useState('');
  const [error, setError] = useState<string | null>(null);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  return (
    <section aria-labelledby="inv-title" className="space-y-3 border-t border-line pt-8">
      <LiveMessage message={live} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="inv-title" className="text-xl font-bold">
            {C.invitations}
          </h2>
          <p className="mt-1 max-w-3xl text-[14px] text-muted">{C.invitationsHelp}</p>
        </div>
        <Button variant="secondary" onClick={onCreate} disabled={courses.length === 0}>
          + {C.newInvitation}
        </Button>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {invitations.length === 0 ? (
        <EmptyState title="아직 만든 초대 링크가 없습니다." />
      ) : (
        <ul className="space-y-3">
          {invitations.map((inv) => (
            <li key={inv.id} className="rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{inv.label || '이름 없는 링크'}</span>
                <Tag tone={inv.state === 'open' ? 'accent' : 'neutral'}>{C.invitationState[inv.state] ?? inv.state}</Tag>
                <Tag>{inv.allow_multiple ? C.multiCourse : C.singleCourse}</Tag>
                <span className="text-[13px] text-muted">
                  {C.submissions(inv.submission_count)}
                  {inv.max_submissions ? ` / ${inv.max_submissions}` : ''} · {formatDateTimeKo(inv.created_at)}
                  {inv.expires_at && ` · 마감 ${formatDateTimeKo(inv.expires_at)}`}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {inv.course_ids.map((id) => {
                  const c = courseById.get(id);
                  return c ? (
                    <span key={id} className="inline-flex items-center gap-1.5 text-[14px]">
                      <SubjectBadge name={subjectName(c.subject_id)} /> {c.name}
                    </span>
                  ) : null;
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor={`url-${inv.id}`} className="sr-only">
                  초대 링크 주소
                </label>
                <input id={`url-${inv.id}`} readOnly value={invitationUrl(inv.token)} onFocus={(e) => e.target.select()} className="min-h-10 w-full flex-1 rounded-lg border border-line bg-bg px-3 text-[14px] text-muted sm:w-auto" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invitationUrl(inv.token));
                      setLive(T.common.copied);
                    } catch {
                      (document.getElementById(`url-${inv.id}`) as HTMLInputElement | null)?.select();
                      setLive('주소를 선택했습니다. 직접 복사해주세요.');
                    }
                  }}
                >
                  {C.copyLink}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    setError(null);
                    try {
                      await call('admin_update_invitation', { p: { id: inv.id, is_active: !inv.is_active } });
                      await reloadCatalog();
                      setLive(inv.is_active ? '링크를 껐습니다.' : '링크를 다시 켰습니다.');
                    } catch (e) {
                      setError(adminErrorText(e));
                    }
                  }}
                >
                  {inv.is_active ? C.deactivate : C.activate}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitationCreator({
  courses,
  subjectName,
  onClose,
  onCreated,
}: {
  courses: Course[];
  subjectName: (id: string) => string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const C = T.admin.courses;
  const { call } = useAdminData();
  const [label, setLabel] = useState('');
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [expires, setExpires] = useState('');
  const [max, setMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (selected.length === 0) return setError('연결할 수업을 골라주세요.');
    if (!multi && selected.length > 1) return setError('여러 수업을 연결하려면 ‘여러 수업 중에서 학부모가 고르게 하기’를 켜주세요.');
    setBusy(true);
    setError(null);
    try {
      await call('admin_create_invitation', {
        p: { label, allow_multiple: multi, course_ids: selected, expires_at: seoulLocalToIso(expires), max_submissions: max ? Number(max) : null },
      });
      onCreated();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={C.newInvitation}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {T.common.cancel}
          </Button>
          <Button loading={busy} onClick={() => void create()}>
            {C.createInvitation}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <Field id="inv-label" label={C.invitationLabel} optional help={C.invitationLabelHelp}>
          {(a) => <TextInput {...a} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Choice type="checkbox" name="inv-multi" id="inv-multi" checked={multi} onChange={(v) => { setMulti(v); if (!v) setSelected((s) => s.slice(0, 1)); }} label={C.allowMultiple} />
        <fieldset>
          <legend className="font-semibold">{C.invitationCourses}</legend>
          <div className="mt-2 space-y-2">
            {courses.map((c) => (
              <Choice
                key={c.id}
                type={multi ? 'checkbox' : 'radio'}
                name="inv-courses"
                id={`inv-c-${c.id}`}
                checked={selected.includes(c.id)}
                onChange={(v) => setSelected((s) => (multi ? (v ? [...s, c.id] : s.filter((x) => x !== c.id)) : [c.id]))}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    <SubjectBadge name={subjectName(c.subject_id)} /> {c.name}
                    {c.status !== 'open' && <Tag>{C.statusLabels[c.status]}</Tag>}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="inv-expires" label={C.expiresAt} optional>
            {(a) => <TextInput {...a} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}
          </Field>
          <Field id="inv-max" label={C.maxSubmissions} optional>
            {(a) => <TextInput {...a} type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

