import { useEffect, useState } from 'react';
import { T } from '../copy/ko';
import { formatDateTimeKo } from '../lib/time';
import type { AppSettings } from '../lib/types';
import { Button, CharCount, Choice, Field, LoadingBlock, Notice, TextArea, TextInput, useDocumentTitle } from '../components/ui';
import { parentHeaderText } from '../parent/ParentLayout';
import { adminErrorText, useAdminData } from './AdminData';
import { UnsavedGuard } from './UnsavedGuard';

type Key = keyof AppSettings;
const TEXT_FIELDS: { key: Key; label: string; max: number; long?: boolean; help?: string; placeholder?: string }[] = [
  { key: 'service_name', label: T.admin.settings.serviceName, max: 40 },
  { key: 'parent_title', label: T.admin.settings.parentTitle, max: 40 },
  { key: 'teacher_name', label: T.admin.settings.teacherName, max: 20, help: T.admin.settings.teacherNameHelp },
  { key: 'teacher_intro', label: T.admin.settings.teacherIntro, max: 600, long: true, help: T.admin.settings.teacherIntroHelp },
  { key: 'intro_eyebrow', label: T.admin.settings.introEyebrow, max: 60, placeholder: T.parent.defaultEyebrow },
  { key: 'intro_title', label: T.admin.settings.introTitle, max: 80, placeholder: T.parent.defaultTitle },
  { key: 'intro_body', label: T.admin.settings.introBody, max: 400, long: true, placeholder: T.parent.defaultBody },
  { key: 'intro_note', label: T.admin.settings.introNote, max: 200, long: true, placeholder: T.parent.defaultNote },
  { key: 'completion_message', label: T.admin.settings.completion, max: 400, long: true, placeholder: T.parent.done.defaultMessage },
  { key: 'policy_notice', label: T.admin.settings.policyNotice, max: 1000, long: true, help: T.admin.settings.policyNoticeHelp },
];
const PRIVACY_FIELDS: { key: Key; label: string; max: number; long?: boolean; help?: string }[] = [
  { key: 'operator_name', label: T.admin.settings.operatorName, max: 40 },
  { key: 'operator_contact', label: T.admin.settings.operatorContact, max: 80 },
  { key: 'privacy_purpose', label: T.admin.settings.privacyPurpose, max: 400, long: true },
  { key: 'privacy_retention', label: T.admin.settings.privacyRetention, max: 200, help: T.admin.settings.privacyRetentionHelp },
  { key: 'privacy_deletion', label: T.admin.settings.privacyDeletion, max: 300, long: true, help: T.admin.settings.privacyDeletionHelp },
];

export function SettingsPage() {
  const S = T.admin.settings;
  useDocumentTitle(`${S.title} · 수업 준비실`);
  const { settings, reloadSettings, call } = useAdminData();
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  if (!form || !settings) return <LoadingBlock />;
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const set = (k: Key, v: string | boolean) => {
    setMessage(null);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const f of [...TEXT_FIELDS, ...PRIVACY_FIELDS]) patch[f.key] = form[f.key];
      patch.privacy_confirmed = form.privacy_confirmed;
      const saved = await call<AppSettings>('admin_update_settings', { p: patch });
      await reloadSettings();
      setForm(saved);
      setMessage({ tone: 'success', text: T.common.saved });
    } catch (e) {
      setMessage({ tone: 'danger', text: adminErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const renderField = (f: (typeof TEXT_FIELDS)[number]) => {
    const value = String(form[f.key] ?? '');
    return (
      <Field key={f.key} id={`set-${f.key}`} label={f.label} help={f.help} counter={f.long ? <CharCount value={value} max={f.max} /> : undefined}>
        {(a) =>
          f.long ? (
            <TextArea {...a} rows={3} maxLength={f.max} value={value} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <TextInput {...a} maxLength={f.max} value={value} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
          )
        }
      </Field>
    );
  };

  return (
    <form
      className="max-w-3xl space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <UnsavedGuard dirty={dirty} message="저장하지 않은 설정이 있습니다. 이동하면 변경한 내용이 사라집니다." />
      <h1 className="text-2xl font-bold">{S.title}</h1>

      <section className="space-y-5 rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">{S.service}</h2>
        <p className="text-[14px] text-muted">
          학부모 화면 머리말 미리보기: <strong className="text-ink">{parentHeaderText(form)}</strong>
        </p>
        <p className="text-[14px] text-muted">빈칸으로 두면 흐린 글씨로 보이는 기본 문구를 씁니다.</p>
        {TEXT_FIELDS.map(renderField)}
      </section>

      <section className="space-y-5 rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">{S.privacy}</h2>
        <p className="text-[14px] text-muted">{S.privacyHelp}</p>
        {PRIVACY_FIELDS.map(renderField)}
        <Choice
          type="checkbox"
          name="privacy-confirmed"
          id="set-privacy-confirmed"
          checked={form.privacy_confirmed}
          onChange={(v) => set('privacy_confirmed', v)}
          label={<span className="font-semibold">{S.privacyConfirmed}</span>}
          description={settings.privacy_confirmed_at ? S.privacyConfirmedAt(formatDateTimeKo(settings.privacy_confirmed_at)) : undefined}
        />
        <p className="text-[13px] text-muted">{S.notice}</p>
      </section>

      {message && (
        <Notice tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </Notice>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy} disabled={!dirty}>
          {S.save}
        </Button>
        {dirty && <span className="text-[14px] font-semibold text-warn">{T.admin.forms.editor.unsaved}</span>}
      </div>
    </form>
  );
}
