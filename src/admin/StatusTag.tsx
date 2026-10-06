import { T } from '../copy/ko';
import type { ConsultStatus } from '../lib/types';
import { Tag } from '../components/ui';

const TONE: Record<ConsultStatus, 'neutral' | 'accent' | 'warn' | 'danger'> = {
  new: 'accent',
  reviewing: 'neutral',
  needs_info: 'warn',
  scheduled: 'accent',
  on_hold: 'neutral',
};

/** 상태는 항상 글자로 표시하고 색은 보조로만 쓴다 */
export function StatusTag({ status }: { status: ConsultStatus }) {
  return (
    <Tag tone={TONE[status]}>
      {status === 'scheduled' && <span aria-hidden="true" className="mr-1">✓</span>}
      {T.labels.consultStatus[status]}
    </Tag>
  );
}
