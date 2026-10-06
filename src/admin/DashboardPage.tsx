import { Link } from 'react-router';
import { T } from '../copy/ko';
import { dashboardStats } from '../lib/adminList';
import { formatDateKo, seoulDate } from '../lib/time';
import type { ConsultStatus } from '../lib/types';
import { Button, EmptyState, LoadingBlock, Notice, SubjectBadge, Tag, useDocumentTitle } from '../components/ui';
import { adminErrorText, useAdminData } from './AdminData';
import { useSubmissions } from './useSubmissions';

const STATUSES: ConsultStatus[] = ['new', 'reviewing', 'needs_info', 'scheduled', 'on_hold'];

export function DashboardPage() {
  const D = T.admin.dashboard;
  useDocumentTitle(`${D.title} · 수업 준비실`);
  const { settings } = useAdminData();
  const { list, error, reload } = useSubmissions();
  const today = seoulDate();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{D.title}</h1>

      {settings && !settings.privacy_confirmed && (
        <Notice tone="warn" role="status">
          {D.privacyWarning}{' '}
          <Link to="/admin/settings" className="font-semibold text-accent-strong underline underline-offset-4">
            {D.privacyWarningAction}
          </Link>
        </Notice>
      )}

      {error ? (
        <Notice tone="danger" role="alert">
          {adminErrorText(error)}{' '}
          <Button variant="link" onClick={() => void reload()}>
            {T.common.retry}
          </Button>
        </Notice>
      ) : !list ? (
        <LoadingBlock />
      ) : (
        <Body stats={dashboardStats(list, today)} empty={list.length === 0} />
      )}
    </div>
  );
}

function Body({ stats, empty }: { stats: ReturnType<typeof dashboardStats>; empty: boolean }) {
  const D = T.admin.dashboard;
  const cards = [
    { label: D.submissions, value: stats.submissions, help: D.submissionsHelp },
    { label: D.courseConsults, value: stats.courseConsults, help: D.courseConsultsHelp },
    { label: D.newCount, value: stats.byStatus.new, to: '/admin/responses?status=new' },
    { label: D.needsInfo, value: stats.needsCheck, help: '모름·미정 항목이 있거나 ‘추가 확인 필요’ 상태', to: '/admin/responses?check=1' },
    { label: D.scheduled, value: stats.byStatus.scheduled, to: '/admin/responses?status=scheduled' },
  ];
  return (
    <>
      <section aria-label="요약">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-card border border-line bg-surface p-4">
              <dt className="text-[14px] font-semibold text-muted">{c.label}</dt>
              <dd className="m-0 mt-1">
                {c.to ? (
                  <Link to={c.to} className="text-3xl font-bold tabular-nums text-ink underline-offset-4 hover:underline">
                    {c.value}
                    <span className="sr-only">건, 목록 보기</span>
                  </Link>
                ) : (
                  <span className="text-3xl font-bold tabular-nums">{c.value}</span>
                )}
                {c.help && <p className="mt-1 text-[13px] leading-snug text-muted">{c.help}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {empty ? (
        <EmptyState title={T.admin.list.empty}>{D.empty}</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="by-subject" className="rounded-card border border-line bg-surface">
            <h2 id="by-subject" className="border-b border-line px-5 py-3 text-lg font-bold">
              {D.bySubject}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[15px]">
                <thead>
                  <tr className="border-b border-line text-left text-[13px] text-muted">
                    <th scope="col" className="px-5 py-2 font-semibold">
                      {D.subject}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">
                      {D.total}
                    </th>
                    {STATUSES.map((s) => (
                      <th key={s} scope="col" className="px-2 py-2 text-right font-semibold">
                        {T.labels.consultStatus[s]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.bySubject.map((r) => (
                    <tr key={r.name} className="border-b border-line last:border-0">
                      <th scope="row" className="px-5 py-2.5 text-left font-normal">
                        <SubjectBadge name={r.name} />
                      </th>
                      <td className="px-2 text-right font-semibold tabular-nums">{r.total}</td>
                      {STATUSES.map((s) => (
                        <td key={s} className="px-2 text-right tabular-nums">
                          {r.byStatus[s]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="upcoming" className="rounded-card border border-line bg-surface">
            <h2 id="upcoming" className="border-b border-line px-5 py-3 text-lg font-bold">
              {D.upcoming}
            </h2>
            {stats.upcoming.length === 0 ? (
              <p className="px-5 py-6 text-[15px] text-muted">{D.upcomingEmpty}</p>
            ) : (
              <ul className="divide-y divide-line">
                {stats.upcoming.map((u, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                    <span className="w-28 shrink-0 text-[15px] tabular-nums">{formatDateKo(u.date)}</span>
                    {u.overdue && <Tag tone="danger">{D.overdue}</Tag>}
                    {u.today && <Tag tone="accent">{D.today}</Tag>}
                    <Link to={`/admin/responses/${u.submissionId}`} className="font-semibold underline-offset-4 hover:underline">
                      {u.studentName}
                    </Link>
                    <SubjectBadge name={u.subjectName} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
