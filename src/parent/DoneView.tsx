import { useEffect, useRef } from 'react';
import { T } from '../copy/ko';
import type { PublicSettings } from '../lib/types';

export function DoneView({ settings, receipt }: { settings: PublicSettings; receipt: string | null }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section aria-labelledby="done-title" className="rounded-card border border-line bg-surface px-5 py-8 sm:px-8" role="status">
      <span aria-hidden="true" className="inline-flex size-11 items-center justify-center rounded-full bg-accent text-xl font-bold text-white">
        ✓
      </span>
      <h1 id="done-title" ref={ref} tabIndex={-1} className="mt-4 text-2xl font-bold leading-snug">
        {T.parent.done.title}
      </h1>
      <p className="mt-3 text-[17px] leading-relaxed">{settings.completion_message || T.parent.done.defaultMessage}</p>
      {receipt && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-[15px] text-muted">{T.parent.done.receipt}</p>
          <p className="mt-1 font-mono text-xl font-bold tracking-wider">{receipt}</p>
          <p className="mt-2 text-[15px] text-muted">{T.parent.done.receiptHelp}</p>
        </div>
      )}
      <p className="mt-6 text-[15px] text-muted">{T.parent.done.closeHint}</p>
    </section>
  );
}
