import { useState } from 'react';
import { Link } from 'react-router';
import { T } from '../copy/ko';
import type { Subject, Template } from '../lib/types';
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
  useDocumentTitle,
} from '../components/ui';
import { adminErrorText, useAdminData } from './AdminData';

type SubjectForm = { id?: string; name: string; description: string; perspective: string; sort_order: string; is_active: boolean; template_source: string };

export function FormsPage() {
  const F = T.admin.forms;
  useDocumentTitle(`${F.title} · 수업 준비실`);
  const { catalog, catalogError, reloadCatalog, call } = useAdminData();
  const [editing, setEditing] = useState<SubjectForm | null>(null);
  const [copying, setCopying] = useState<Template | null>(null);
  const [live, setLive] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  const common = catalog.templates.find((t) => t.kind === 'common');
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try {
      await fn();
      await reloadCatalog();
      setLive(msg);
    } catch (e) {
      setError(adminErrorText(e));
    }
  };

  return (
    <div className="space-y-8">
      <LiveMessage message={live} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{F.title}</h1>
        <Button onClick={() => setEditing({ name: '', description: '', perspective: '', sort_order: '100', is_active: true, template_source: 'standard' })}>
          + {F.addSubject}
        </Button>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      <Notice>
        <strong>{F.systemFieldsTitle}</strong> · {F.systemFields}
      </Notice>

      {common && (
        <section aria-labelledby="common-title">
          <h2 id="common-title" className="mb-3 text-lg font-bold">
            {F.commonTemplate}
          </h2>
          <TemplateRow t={common} />
        </section>
      )}

      <section aria-labelledby="subjects-title" className="space-y-4">
        <h2 id="subjects-title" className="text-lg font-bold">
          {F.subjects}
        </h2>
        {catalog.subjects.map((s) => (
          <Card key={s.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SubjectBadge name={s.name} />
                  {s.archived_at ? <Tag>{F.archived}</Tag> : s.is_active ? <Tag tone="accent">{F.active}</Tag> : <Tag>{F.inactive}</Tag>}
                  <span className="text-[13px] text-muted">
                    수업 {s.course_count} · 응답 {s.response_count} · 순서 {s.sort_order}
                  </span>
                </div>
                {s.description && <p className="mt-2 text-[15px]">{s.description}</p>}
                {s.perspective && (
                  <p className="mt-1 text-[15px] text-muted">
                    <span className="font-semibold text-ink">{F.subjectPerspective}</span> · {s.perspective}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEditing({ id: s.id, name: s.name, description: s.description, perspective: s.perspective, sort_order: String(s.sort_order), is_active: s.is_active, template_source: '' })
                  }
                >
                  {T.common.edit}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void act(() => call('admin_archive_subject', { p_id: s.id, p_archived: !s.archived_at }), s.archived_at ? '보관을 해제했습니다.' : '과목을 보관했습니다.')}>
                  {s.archived_at ? F.unarchive : F.archive}
                </Button>
                {s.course_count === 0 && s.response_count === 0 && (
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => { if (window.confirm(`‘${s.name}’ 과목과 양식을 삭제할까요?`)) void act(() => call('admin_delete_subject', { p_id: s.id }), '과목을 삭제했습니다.'); }}>
                    {F.deleteSubject}
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              <p className="text-[14px] font-semibold text-muted">{F.templates}</p>
              {catalog.templates
                .filter((t) => t.subject_id === s.id)
                .map((t) => (
                  <TemplateRow key={t.id} t={t} isDefault={t.id === s.default_template_id} onCopy={() => setCopying(t)} />
                ))}
            </div>
          </Card>
        ))}
      </section>

      {editing && (
        <SubjectEditor
          form={editing}
          subjects={catalog.subjects}
          templates={catalog.templates}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            await reloadCatalog();
            setLive(msg);
          }}
        />
      )}
      {copying && (
        <CopyTemplateDialog
          source={copying}
          subjects={catalog.subjects.filter((s) => !s.archived_at)}
          onClose={() => setCopying(null)}
          onDone={async () => {
            setCopying(null);
            await reloadCatalog();
            setLive('양식을 복사했습니다. 새 양식은 초안 상태입니다.');
          }}
        />
      )}
    </div>
  );
}

function TemplateRow({ t, isDefault, onCopy }: { t: Template; isDefault?: boolean; onCopy?: () => void }) {
  const F = T.admin.forms;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t.name}</span>
        {isDefault && <Tag>기본 양식</Tag>}
        {t.published ? <Tag tone="accent">{F.published(t.published.version_no)}</Tag> : <Tag tone="warn">{F.notPublished}</Tag>}
        {t.draft && <Tag tone="warn">{F.draft}</Tag>}
        {t.kind === 'subject' && <span className="text-[13px] text-muted">수업 {t.course_count}개 사용</span>}
      </div>
      <div className="flex gap-2">
        <Link to={`/admin/forms/${t.id}`} className="inline-flex min-h-10 items-center rounded-xl border border-line-strong px-3.5 text-[15px] font-semibold hover:border-accent">
          {F.editTemplate}
        </Link>
        {onCopy && (
          <Button variant="ghost" size="sm" onClick={onCopy}>
            {F.copyTemplate}
          </Button>
        )}
      </div>
    </div>
  );
}

function SubjectEditor({
  form: initial,
  subjects,
  templates,
  onClose,
  onSaved,
}: {
  form: SubjectForm;
  subjects: Subject[];
  templates: Template[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const F = T.admin.forms;
  const { call } = useAdminData();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SubjectForm>(k: K, v: SubjectForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return setError('과목 이름을 입력해주세요.');
    setBusy(true);
    setError(null);
    try {
      await call('admin_save_subject', { p: { ...f, id: f.id ?? '', sort_order: Number(f.sort_order) || 100 } });
      onSaved(f.id ? '과목을 저장했습니다.' : '과목을 추가했습니다. 과목 양식은 초안 상태이니 질문을 확인한 뒤 발행해주세요.');
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const sources = templates.filter((t) => t.kind === 'subject' && !t.archived_at);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={f.id ? `${f.name} 수정` : F.addSubject}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {T.common.cancel}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {F.saveSubject}
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
        <Field id="s-name" label={F.subjectName} required>
          {(a) => <TextInput {...a} maxLength={30} value={f.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field id="s-desc" label={F.subjectDescription} optional>
          {(a) => <TextArea {...a} rows={2} maxLength={300} value={f.description} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <Field id="s-persp" label={F.subjectPerspective} optional help={F.subjectPerspectiveHelp}>
          {(a) => <TextArea {...a} rows={3} maxLength={400} value={f.perspective} onChange={(e) => set('perspective', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-sort" label={F.sortOrder} optional>
            {(a) => <TextInput {...a} type="number" value={f.sort_order} onChange={(e) => set('sort_order', e.target.value)} />}
          </Field>
          <label className="flex min-h-12 items-center gap-2 self-end">
            <input type="checkbox" className="size-5 accent-accent" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            {F.active}
          </label>
        </div>
        {!f.id && (
          <Field id="s-source" label={F.templateSource}>
            {(a) => (
              <Select {...a} value={f.template_source} onChange={(e) => set('template_source', e.target.value)}>
                <option value="standard">{F.templateSourceStandard}</option>
                {sources.map((t) => (
                  <option key={t.id} value={t.id}>
                    {F.templateSourceCopy(`${subjects.find((s) => s.id === t.subject_id)?.name ?? ''} · ${t.name}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function CopyTemplateDialog({ source, subjects, onClose, onDone }: { source: Template; subjects: Subject[]; onClose: () => void; onDone: () => void }) {
  const F = T.admin.forms;
  const { call } = useAdminData();
  const [name, setName] = useState(`${source.name} (복사본)`);
  const [subjectId, setSubjectId] = useState(source.subject_id ?? subjects[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={F.copyTemplate}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {T.common.cancel}
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await call('admin_copy_template', { p_source_template_id: source.id, p_subject_id: subjectId, p_name: name });
                onDone();
              } catch (e) {
                setError(adminErrorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {F.copyTemplate}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <Field id="copy-name" label={F.copyName} required>
          {(a) => <TextInput {...a} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field id="copy-subject" label={T.admin.courses.subject}>
          {(a) => (
            <Select {...a} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-[14px] text-muted">수업별 적용 설정은 복사하지 않습니다.</p>
      </div>
    </Dialog>
  );
}
