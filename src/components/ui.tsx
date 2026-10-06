import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { T } from '../copy/ko';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// 버튼
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  loading?: boolean;
  loadingText?: string;
  block?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong border border-accent disabled:bg-[#7fa9a4] disabled:border-[#7fa9a4]',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-accent hover:text-accent-strong disabled:text-muted',
  ghost: 'bg-transparent text-accent-strong border border-transparent hover:bg-accent-soft disabled:text-muted',
  danger: 'bg-danger text-white border border-danger hover:bg-[#8f1c13] disabled:opacity-60',
  link: 'bg-transparent text-accent-strong underline underline-offset-4 border-0 px-0 hover:text-ink',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, loadingText, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed',
        size === 'md' ? 'min-h-12 px-5 text-base' : 'min-h-10 px-3.5 text-[15px]',
        variant === 'link' && 'min-h-0 px-0',
        block && 'w-full',
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

// ---------------------------------------------------------------------------
// 입력 필드
// ---------------------------------------------------------------------------
interface FieldProps {
  id: string;
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  help?: ReactNode;
  error?: string | null;
  children: (aria: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }) => ReactNode;
  className?: string;
  as?: 'div' | 'fieldset';
  counter?: ReactNode;
}

/** label·도움말·오류를 입력 요소와 연결한다. fieldset 이면 legend 를 쓴다. */
export function Field({ id, label, required, optional, help, error, children, className, as = 'div', counter }: FieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [errId, helpId].filter(Boolean).join(' ') || undefined;
  const tag = (
    <>
      {label}
      {required && <span className="ml-1.5 text-[13px] font-medium text-accent-strong">({T.common.required})</span>}
      {optional && <span className="ml-1.5 text-[13px] font-medium text-muted">({T.common.optional})</span>}
    </>
  );
  const body = (
    <>
      {help && (
        <p id={helpId} className="mt-1 text-[15px] leading-relaxed text-muted">
          {help}
        </p>
      )}
      <div className="mt-2">{children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })}</div>
      {counter}
      {error && <FieldErrorText id={errId!}>{error}</FieldErrorText>}
    </>
  );
  if (as === 'fieldset') {
    return (
      <fieldset id={`${id}-group`} className={cx('min-w-0 border-0 p-0', className)} aria-describedby={describedBy}>
        <legend className="p-0 text-base font-semibold text-ink">{tag}</legend>
        {body}
      </fieldset>
    );
  }
  return (
    <div className={cx('min-w-0', className)}>
      <label htmlFor={id} className="block text-base font-semibold text-ink">
        {tag}
      </label>
      {body}
    </div>
  );
}

export function FieldErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-[15px] font-medium text-danger">
      <span aria-hidden="true" className="mt-[3px] inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
        !
      </span>
      <span>
        <span className="sr-only">오류: </span>
        {children}
      </span>
    </p>
  );
}

const inputBase =
  'block w-full min-h-12 rounded-xl border bg-surface px-3.5 py-2.5 text-base text-ink transition-colors disabled:bg-[#eef1ee] disabled:text-muted aria-[invalid=true]:border-danger';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(inputBase, 'border-line-strong', className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(inputBase, 'border-line-strong leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx(
        inputBase,
        'appearance-none border-line-strong bg-[length:20px] bg-[right_12px_center] bg-no-repeat pr-10',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%235F6B72'%3E%3Cpath d='M5.5 7.5 10 12l4.5-4.5' stroke='%235F6B72' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function CharCount({ value, max, id }: { value: string; max: number; id?: string }) {
  const over = value.length > max;
  return (
    <p id={id} className={cx('mt-1 text-right text-[13px]', over ? 'font-semibold text-danger' : 'text-muted')} aria-live={over ? 'polite' : 'off'}>
      {value.length.toLocaleString()} / {max.toLocaleString()}자
    </p>
  );
}

interface ChoiceProps {
  type: 'radio' | 'checkbox';
  name: string;
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  describedBy?: string;
  invalid?: boolean;
}

/** 큰 터치 영역의 선택지 */
export function Choice({ type, name, id, checked, onChange, label, description, disabled, describedBy, invalid }: ChoiceProps) {
  return (
    <label
      htmlFor={id}
      className={cx(
        'flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
        checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
        invalid && !checked && 'border-danger/60',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-base leading-snug">{label}</span>
        {description && <span className="mt-0.5 block text-[14px] text-muted">{description}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// 배지
// ---------------------------------------------------------------------------
function hueOf(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/** 과목 배지: 이름이 기본이고 색은 보조. 새 과목도 이름에서 색이 정해진다. */
export function SubjectBadge({ name, className }: { name: string; className?: string }) {
  const h = hueOf(name);
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[14px] font-semibold whitespace-nowrap', className)}
      style={{ borderColor: `hsl(${h} 30% 78%)`, background: `hsl(${h} 40% 96%)`, color: '#172B36' }}
    >
      <span aria-hidden="true" className="size-2 rounded-full" style={{ background: `hsl(${h} 45% 40%)` }} />
      {name}
    </span>
  );
}

export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'border-line bg-[#f1f4f2] text-ink',
    accent: 'border-[#b8d6d1] bg-accent-soft text-accent-strong',
    warn: 'border-[#ecd29a] bg-warn-soft text-warn',
    danger: 'border-[#f2b8b2] bg-danger-soft text-danger',
  } as const;
  return <span className={cx('inline-flex items-center rounded-md border px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

// ---------------------------------------------------------------------------
// 오류 요약 · 알림
// ---------------------------------------------------------------------------
export interface SummaryError {
  fieldId: string;
  label: string;
  message: string;
}

export const ErrorSummary = forwardRef<HTMLDivElement, { errors: SummaryError[]; title: string }>(function ErrorSummary({ errors, title }, ref) {
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-labelledby="error-summary-title" className="rounded-card border-2 border-danger bg-danger-soft p-4">
      <h2 id="error-summary-title" className="text-base font-bold text-danger">
        {title}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a
              href={`#${e.fieldId}`}
              onClick={(ev) => {
                ev.preventDefault();
                focusField(e.fieldId);
              }}
              className="text-[15px] text-ink underline underline-offset-4"
            >
              {e.label}: {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** id 로 입력 요소(또는 그 그룹의 첫 입력)를 찾아 포커스 */
export function focusField(fieldId: string) {
  const el =
    document.getElementById(fieldId) ??
    document.querySelector<HTMLElement>(`#${CSS.escape(fieldId)}-group input, #${CSS.escape(fieldId)}-group select, #${CSS.escape(fieldId)}-group textarea, #${CSS.escape(fieldId)}-group button`);
  if (!el) return;
  const target = el.matches('input,select,textarea,button,[tabindex]') ? el : el.querySelector<HTMLElement>('input,select,textarea,button') ?? el;
  target.focus();
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function Notice({ tone = 'info', children, className, role }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode; className?: string; role?: 'status' | 'alert' }) {
  const tones = {
    info: 'border-line bg-[#f1f5f3] text-ink',
    warn: 'border-[#ecd29a] bg-warn-soft text-ink',
    danger: 'border-[#f2b8b2] bg-danger-soft text-ink',
    success: 'border-[#b8d6d1] bg-accent-soft text-ink',
  } as const;
  const icon = { info: 'i', warn: '!', danger: '!', success: '✓' }[tone];
  const iconTone = { info: 'bg-muted', warn: 'bg-warn', danger: 'bg-danger', success: 'bg-accent' }[tone];
  return (
    <div role={role} className={cx('flex gap-3 rounded-xl border px-4 py-3 text-[15px] leading-relaxed', tones[tone], className)}>
      <span aria-hidden="true" className={cx('mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white', iconTone)}>
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 스크린리더 알림 영역 */
export function LiveMessage({ message, assertive }: { message: string; assertive?: boolean }) {
  return (
    <div className="sr-only" role={assertive ? 'alert' : 'status'} aria-live={assertive ? 'assertive' : 'polite'} aria-atomic="true">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 대화상자 (네이티브 dialog: 포커스 가두기·Esc 닫기 기본 제공)
// ---------------------------------------------------------------------------
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        'm-auto w-[calc(100%-24px)] rounded-card border border-line bg-surface p-0 text-ink shadow-xl',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="-m-2 rounded-lg p-2 text-muted hover:text-ink" aria-label={T.common.close}>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M5 5l10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// 레이아웃 조각
// ---------------------------------------------------------------------------
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-card border border-line bg-surface', className)}>{children}</div>;
}

export function LoadingBlock({ label = T.common.loading }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-2 text-[15px] text-muted">{children}</div>}
    </div>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
