import type { ReactNode } from 'react';
import { useDocumentTitle } from '../components/ui';

export function StatusView({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <section aria-labelledby="status-title" className="rounded-card border border-line bg-surface px-5 py-8 sm:px-8">
      <h1 id="status-title" className="text-2xl font-bold leading-snug">
        {title}
      </h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </section>
  );
}
