import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { T } from '../copy/ko';
import { MAX_PHOTOS } from '../lib/questions';
import type { Answer, Question } from '../lib/types';
import { Button, Field, LiveMessage, Spinner } from './ui';

/** 설문 화면이 제공하는 사진 올리기 기능. 없으면(미리보기 등) 올리기를 막는다. */
export interface PhotoUploader {
  upload(file: File): Promise<string>; // 저장된 경로를 돌려준다
  onPendingChange(delta: number): void;
}

export const PhotoUploadContext = createContext<PhotoUploader | null>(null);

/** 단계를 오가도 미리보기가 남도록 (경로 → 미리보기 주소) */
const previewCache = new Map<string, string>();

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_EDGE = 2000;

/** 큰 사진은 긴 변 2000px JPEG 로 줄인다. 줄일 수 없는 형식(HEIC 등)은 그대로 올린다. */
export async function shrinkImage(file: File): Promise<{ blob: Blob; type: string; ext: string }> {
  const fallback = { blob: file as Blob, type: file.type || 'image/jpeg', ext: (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg' };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return fallback;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? { blob, type: 'image/jpeg', ext: 'jpg' } : fallback;
  } catch {
    return fallback;
  }
}

interface Props {
  question: Question;
  answer: Answer | undefined;
  onChange: (a: Answer | undefined) => void;
  fieldId: string;
  error?: string | null;
}

type Item = { key: string; path?: string; preview: string; name: string; state: 'uploading' | 'done' | 'failed'; file: File };

export function PhotoField({ question: q, answer, onChange, fieldId, error }: Props) {
  const uploader = useContext(PhotoUploadContext);
  const P = T.parent.photos;
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const [items, setItems] = useState<Item[]>(() =>
    answer?.status === 'answered' && Array.isArray(answer.value)
      ? answer.value.map((p) => ({ key: p, path: p, preview: previewCache.get(p) ?? '', name: p.split('/').pop() ?? '', state: 'done' as const, file: new File([], '') }))
      : [],
  );
  const [live, setLive] = useState('');
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  // 올린 사진 경로를 답으로 반영
  useEffect(() => {
    const paths = items.filter((i) => i.state === 'done' && i.path).map((i) => i.path!);
    const current = answer?.status === 'answered' && Array.isArray(answer.value) ? answer.value : [];
    if (paths.join('|') !== current.join('|')) onChange(paths.length ? { status: 'answered', value: paths } : undefined);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (item: Item) => {
    if (!uploader) return;
    uploader.onPendingChange(1);
    try {
      const path = await uploader.upload(item.file);
      previewCache.set(path, item.preview);
      setItems((list) => list.map((x) => (x.key === item.key ? { ...x, path, state: 'done' } : x)));
      setLive(P.uploaded(item.name));
    } catch {
      setItems((list) => list.map((x) => (x.key === item.key ? { ...x, state: 'failed' } : x)));
      setLive(P.failed(item.name));
    } finally {
      uploader.onPendingChange(-1);
    }
  };

  const add = (files: FileList | null) => {
    if (!files || !uploader) return;
    setLimitMsg(null);
    const room = MAX_PHOTOS - items.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setLimitMsg(P.limit(MAX_PHOTOS));
    const next = picked.map((file) => ({
      key: crypto.randomUUID(),
      preview: URL.createObjectURL(file),
      name: file.name,
      state: 'uploading' as const,
      file,
    }));
    setItems((list) => [...list, ...next]);
    next.forEach((it) => void start(it));
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (key: string) => setItems((list) => list.filter((x) => x.key !== key));

  return (
    <Field id={fieldId} as="fieldset" label={q.label} required={q.required} optional={!q.required} help={q.help} error={error ?? limitMsg}>
      {() => (
        <div className="space-y-3">
          <LiveMessage message={live} />
          {items.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {items.map((it, i) => (
                <li key={it.key} className="relative overflow-hidden rounded-xl border border-line bg-surface">
                  {it.preview ? (
                    <img src={it.preview} alt={P.alt(i + 1)} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-[13px] text-muted">{P.alt(i + 1)}</div>
                  )}
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-[12px]">
                    <span className={it.state === 'failed' ? 'font-semibold text-danger' : 'text-muted'}>
                      {it.state === 'uploading' ? (
                        <span className="inline-flex items-center gap-1">
                          <Spinner /> {P.uploading}
                        </span>
                      ) : it.state === 'failed' ? (
                        P.failedShort
                      ) : (
                        P.done
                      )}
                    </span>
                    {it.state === 'failed' ? (
                      <button type="button" className="font-semibold text-accent-strong underline" onClick={() => {
                        setItems((list) => list.map((x) => (x.key === it.key ? { ...x, state: 'uploading' } : x)));
                        void start({ ...it, state: 'uploading' });
                      }}>
                        {T.common.retry}
                      </button>
                    ) : (
                      <button type="button" className="text-muted underline disabled:opacity-50" disabled={it.state === 'uploading'} onClick={() => remove(it.key)} aria-label={P.removeLabel(i + 1)}>
                        {T.common.delete}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputRef}
            id={fieldId}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            aria-describedby={helpId}
            disabled={!uploader || items.length >= MAX_PHOTOS}
            onChange={(e) => add(e.target.files)}
          />
          <Button variant="secondary" disabled={!uploader || items.length >= MAX_PHOTOS} onClick={() => inputRef.current?.click()}>
            {P.add}
          </Button>
          <p id={helpId} className="text-[14px] text-muted">
            {uploader ? P.count(items.filter((i) => i.state === 'done').length, MAX_PHOTOS) : P.previewOnly}
          </p>
        </div>
      )}
    </Field>
  );
}
