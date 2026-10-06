import { useEffect, useState } from 'react';
import { T } from '../copy/ko';
import { buildSmsDraft } from '../lib/sms';
import type { SubmissionDetail } from '../lib/types';
import { Button, Choice, Dialog, Field, LiveMessage, TextArea } from '../components/ui';
import { useAdminData } from './AdminData';

export function SmsDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: SubmissionDetail }) {
  const M = T.admin.sms;
  const { settings } = useAdminData();
  const [courseIds, setCourseIds] = useState<string[]>(() => detail.courses.map((c) => c.id));
  const [includeSchedule, setIncludeSchedule] = useState(true);
  const [text, setText] = useState('');
  const [live, setLive] = useState('');

  useEffect(() => {
    if (!open) return;
    setText(buildSmsDraft(detail, { teacherName: settings?.teacher_name ?? '', courseIds, includeSchedule }));
  }, [open, detail, courseIds, includeSchedule, settings?.teacher_name]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setLive(T.common.copied);
    } catch {
      const el = document.getElementById('sms-text') as HTMLTextAreaElement | null;
      el?.select();
      setLive('복사하지 못했습니다. 글을 직접 선택해 복사해주세요.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={M.title}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {T.common.close}
          </Button>
          <Button onClick={() => void copy()}>{M.copy}</Button>
        </>
      }
    >
      <LiveMessage message={live} />
      <p className="text-[15px] leading-relaxed text-muted">{M.help}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-4">
          {detail.courses.length > 1 && (
            <fieldset>
              <legend className="font-semibold">{M.chooseCourses}</legend>
              <div className="mt-2 space-y-2">
                {detail.courses.map((c) => (
                  <Choice
                    key={c.id}
                    type="checkbox"
                    name="sms-courses"
                    id={`sms-${c.id}`}
                    checked={courseIds.includes(c.id)}
                    onChange={(v) => setCourseIds((ids) => (v ? detail.courses.map((x) => x.id).filter((x) => x === c.id || ids.includes(x)) : ids.filter((x) => x !== c.id)))}
                    label={c.course.subject_name}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <Choice type="checkbox" name="sms-schedule" id="sms-schedule" checked={includeSchedule} onChange={setIncludeSchedule} label={M.includeSchedule} />
          <p className="text-[13px] text-muted">선택을 바꾸면 초안을 새로 만듭니다. 직접 고친 내용은 사라집니다.</p>
        </div>
        <Field id="sms-text" label={M.draft} counter={<p className="mt-1 text-right text-[13px] text-muted">{text.length}자</p>}>
          {(a) => <TextArea {...a} rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-[inherit] text-[15px]" />}
        </Field>
      </div>
    </Dialog>
  );
}
