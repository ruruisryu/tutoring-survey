import { T } from '../copy/ko';
import { maxLengthOf } from '../lib/questions';
import type { Answer, Question } from '../lib/types';
import { CharCount, Choice, Field, TextArea, TextInput } from './ui';
import { PhotoField } from './PhotoField';

interface Props {
  question: Question;
  answer: Answer | undefined;
  onChange: (a: Answer | undefined) => void;
  fieldId: string;
  error?: string | null;
}

const UNKNOWN = '__unknown__';

/** 질문 유형별 입력 요소. 학부모 화면과 관리자 미리보기에서 같이 쓴다. */
export function QuestionField({ question: q, answer, onChange, fieldId, error }: Props) {
  const isUnknown = answer?.status === 'unknown';
  const value = answer?.status === 'answered' ? answer.value : undefined;
  const unknownLabel = q.unknown_label || T.common.unknown;
  const optionalTag = !q.required;

  if (q.type === 'photos') {
    return <PhotoField question={q} answer={answer} onChange={onChange} fieldId={fieldId} error={error} />;
  }

  if (q.type === 'single' || q.type === 'multi') {
    const selected: string[] = isUnknown ? [UNKNOWN] : Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const options = [...(q.options ?? []), ...(q.allow_unknown ? [{ value: UNKNOWN, label: unknownLabel, exclusive: true }] : [])];
    const toggle = (v: string, checked: boolean) => {
      if (v === UNKNOWN) {
        onChange(checked ? { status: 'unknown' } : undefined);
        return;
      }
      if (q.type === 'single') {
        onChange(checked ? { status: 'answered', value: v } : undefined);
        return;
      }
      const opt = options.find((o) => o.value === v);
      let next = selected.filter((x) => x !== UNKNOWN);
      if (checked) {
        next = opt?.exclusive ? [v] : [...next.filter((x) => !options.find((o) => o.value === x)?.exclusive), v];
      } else {
        next = next.filter((x) => x !== v);
      }
      onChange(next.length ? { status: 'answered', value: next } : undefined);
    };
    return (
      <Field id={fieldId} as="fieldset" label={q.label} required={q.required} optional={optionalTag} help={q.help} error={error}>
        {(aria) => (
          <div className={q.type === 'multi' && options.length > 5 ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2'}>
            {options.map((o, i) => (
              <Choice
                key={o.value}
                type={q.type === 'single' ? 'radio' : 'checkbox'}
                name={fieldId}
                id={i === 0 ? fieldId : `${fieldId}-${o.value}`}
                checked={selected.includes(o.value)}
                onChange={(c) => toggle(o.value, q.type === 'single' ? true : c)}
                label={o.label}
                describedBy={aria['aria-describedby']}
                invalid={!!error}
              />
            ))}
          </div>
        )}
      </Field>
    );
  }

  const max = maxLengthOf(q);
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  const set = (s: string) => {
    if (q.type === 'number') {
      if (s.trim() === '') return onChange(undefined);
      const n = Number(s);
      return onChange({ status: 'answered', value: Number.isFinite(n) ? n : s });
    }
    onChange(s === '' ? undefined : { status: 'answered', value: s });
  };
  const counterId = `${fieldId}-count`;

  return (
    <Field
      id={fieldId}
      label={q.label}
      required={q.required}
      optional={optionalTag}
      help={q.help}
      error={error}
      counter={q.type === 'long_text' && max ? <CharCount id={counterId} value={str} max={max} /> : undefined}
    >
      {(aria) => (
        <div className="space-y-2">
          {q.type === 'long_text' ? (
            <TextArea {...aria} value={str} disabled={isUnknown} maxLength={max} onChange={(e) => set(e.target.value)} />
          ) : (
            <TextInput
              {...aria}
              type={q.type === 'date' ? 'date' : q.type === 'time' ? 'time' : q.type === 'number' ? 'number' : 'text'}
              inputMode={q.type === 'number' ? 'decimal' : undefined}
              step={q.type === 'time' ? 600 : undefined}
              min={q.type === 'number' ? q.min : undefined}
              max={q.type === 'number' ? q.max : undefined}
              maxLength={q.type === 'short_text' ? max : undefined}
              value={str}
              disabled={isUnknown}
              onChange={(e) => set(e.target.value)}
              className={q.type === 'date' || q.type === 'time' || q.type === 'number' ? 'max-w-xs' : undefined}
            />
          )}
          {q.allow_unknown && (
            <Choice
              type="checkbox"
              name={`${fieldId}-unknown`}
              id={`${fieldId}-unknown`}
              checked={isUnknown}
              onChange={(c) => onChange(c ? { status: 'unknown' } : undefined)}
              label={unknownLabel}
            />
          )}
        </div>
      )}
    </Field>
  );
}
