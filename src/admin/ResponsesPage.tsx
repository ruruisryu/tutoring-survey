import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { T, schoolGradeLabel } from '../copy/ko';
import { EMPTY_FILTER, filterSubmissions, paginate, sortSubmissions, totalUnknowns, type ListFilter, type SortKey } from '../lib/adminList';
import { detailCsv, downloadText, summaryCsv } from '../lib/csv';
import { maskPhone } from '../lib/phone';
import { GRADE_OPTIONS } from '../lib/survey';
import { formatDateKo, formatDateTimeKo, seoulDate, WEEKDAY_LABELS, WEEKDAY_ORDER } from '../lib/time';
import type { ConsultStatus, ListSubmission, SubmissionDetail } from '../lib/types';
import { Button, EmptyState, LoadingBlock, LiveMessage, Notice, Select, SubjectBadge, Tag, TextInput, cx, useDocumentTitle } from '../components/ui';
import { adminErrorText, useAdminData } from './AdminData';
import { useSubmissions } from './useSubmissions';
import { StatusTag } from './StatusTag';

const PAGE_SIZE = 20;
const KEYS: (keyof ListFilter)[] = ['q', 'subjectId', 'courseId', 'gradeKey', 'status', 'from', 'to', 'weekday', 'timeFrom', 'timeTo'];
const PARAM: Record<string, string> = { subjectId: 'subject', courseId: 'course', gradeKey: 'grade', timeFrom: 'tfrom', timeTo: 'tto' };

function readFilter(p: URLSearchParams): ListFilter {
  const f: ListFilter = { ...EMPTY_FILTER };
  for (const k of KEYS) (f as unknown as Record<string, string>)[k] = p.get(PARAM[k] ?? k) ?? '';
  f.needsCheck = p.get('check') === '1';
  return f;
}

export function ResponsesPage() {
  const L = T.admin.list;
  useDocumentTitle(`${L.title} · 수업 준비실`);
  const { catalog, call } = useAdminData();
  const { list, error, reload } = useSubmissions();
  const [urlParams, setUrlParams] = useSearchParams();
  // 화면은 이 상태로 그리고, 주소(뒤로 가기용)는 따라서 갱신만 한다
  const [params, setParamsState] = useState(() => new URLSearchParams(urlParams));
  useEffect(() => {
    if (params.toString() !== urlParams.toString()) setUrlParams(params, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const setParams = (p: URLSearchParams) => setParamsState(p);
  const filter = readFilter(params);
  const sort = (params.get('sort') as SortKey) || 'received_desc';
  const page = Number(params.get('page') || '1');
  const [exporting, setExporting] = useState<'summary' | 'detail' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [live, setLive] = useState('');

  const setFilter = (patch: Partial<ListFilter> & { sort?: SortKey; page?: number }) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const key = k === 'needsCheck' ? 'check' : PARAM[k] ?? k;
      const val = k === 'needsCheck' ? (v ? '1' : '') : String(v ?? '');
      if (val) next.set(key, val);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const filtered = useMemo(() => (list ? sortSubmissions(filterSubmissions(list, filter), sort) : []), [list, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const { items, page: current, pages } = paginate(filtered, page, PAGE_SIZE);

  const exportCsv = async (kind: 'summary' | 'detail') => {
    setExporting(kind);
    setExportError(null);
    try {
      const details = await call<SubmissionDetail[]>('admin_get_submissions', { p_ids: filtered.map((s) => s.id) });
      const stamp = seoulDate();
      downloadText(kind === 'summary' ? `상담_제출요약_${stamp}.csv` : `상담_수업별상세_${stamp}.csv`, kind === 'summary' ? summaryCsv(details) : detailCsv(details));
      setLive(`${details.length}건을 내보냈습니다.`);
    } catch (e) {
      setExportError(adminErrorText(e));
    } finally {
      setExporting(null);
    }
  };

  const subjects = catalog?.subjects ?? [];
  const courses = (catalog?.courses ?? []).filter((c) => !filter.subjectId || c.subject_id === filter.subjectId);
  const hasFilter = KEYS.some((k) => filter[k]) || filter.needsCheck;

  return (
    <div className="space-y-6">
      <LiveMessage message={live} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">{L.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void exportCsv('summary')} loading={exporting === 'summary'} loadingText={L.exporting} disabled={!filtered.length || !!exporting}>
            {L.exportSummary}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void exportCsv('detail')} loading={exporting === 'detail'} loadingText={L.exporting} disabled={!filtered.length || !!exporting}>
            {L.exportDetail}
          </Button>
        </div>
      </div>
      {exportError && (
        <Notice tone="danger" role="alert">
          {exportError}
        </Notice>
      )}

      <form role="search" aria-label="응답 검색과 필터" className="rounded-card border border-line bg-surface p-4" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[14px] font-semibold">{L.search}</span>
            <TextInput type="search" placeholder={L.searchPlaceholder} value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.subject}</span>
            <Select value={filter.subjectId} onChange={(e) => setFilter({ subjectId: e.target.value, courseId: '' })}>
              <option value="">{L.all}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.course}</span>
            <Select value={filter.courseId} onChange={(e) => setFilter({ courseId: e.target.value })}>
              <option value="">{L.all}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.grade}</span>
            <Select value={filter.gradeKey} onChange={(e) => setFilter({ gradeKey: e.target.value })}>
              <option value="">{L.all}</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
              <option value="other">기타</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.status}</span>
            <Select value={filter.status} onChange={(e) => setFilter({ status: e.target.value as ConsultStatus | '' })}>
              <option value="">{L.all}</option>
              {(Object.keys(T.labels.consultStatus) as ConsultStatus[]).map((s) => (
                <option key={s} value={s}>
                  {T.labels.consultStatus[s]}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.receivedFrom}</span>
            <TextInput type="date" value={filter.from} onChange={(e) => setFilter({ from: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.receivedTo}</span>
            <TextInput type="date" value={filter.to} onChange={(e) => setFilter({ to: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.weekday}</span>
            <Select value={filter.weekday} onChange={(e) => setFilter({ weekday: e.target.value })}>
              <option value="">{L.all}</option>
              {WEEKDAY_ORDER.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LABELS[d]}요일
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.timeFrom}</span>
            <TextInput type="time" step={600} value={filter.timeFrom} onChange={(e) => setFilter({ timeFrom: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold">{L.timeTo}</span>
            <TextInput type="time" step={600} value={filter.timeTo} onChange={(e) => setFilter({ timeTo: e.target.value })} />
          </label>
          <label className="flex min-h-12 items-center gap-2 self-end">
            <input type="checkbox" className="size-5 accent-accent" checked={filter.needsCheck} onChange={(e) => setFilter({ needsCheck: e.target.checked })} />
            <span className="text-[15px]">{L.needsCheckOnly}</span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <label className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{L.sort}</span>
            <Select value={sort} onChange={(e) => setFilter({ sort: e.target.value as SortKey })} className="min-h-10 w-auto py-1.5">
              {(Object.keys(L.sortOptions) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {L.sortOptions[k]}
                </option>
              ))}
            </Select>
          </label>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams())}>
              {L.reset}
            </Button>
          )}
        </div>
      </form>

      {error ? (
        <Notice tone="danger" role="alert">
          {adminErrorText(error)}{' '}
          <Button variant="link" onClick={() => void reload()}>
            {T.common.retry}
          </Button>
        </Notice>
      ) : !list ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyState title={L.empty}>{T.admin.dashboard.empty}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title={L.noMatch} />
      ) : (
        <>
          <p className="text-[15px] text-muted" aria-live="polite">
            {L.count(filtered.length, list.length)}
          </p>
          <ResponseTable items={items} />
          {pages > 1 && (
            <nav aria-label="쪽 이동" className="flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" disabled={current <= 1} onClick={() => setFilter({ page: current - 1 })}>
                {L.prev}
              </Button>
              <span className="text-[15px] tabular-nums">{L.page(current, pages)}</span>
              <Button variant="secondary" size="sm" disabled={current >= pages} onClick={() => setFilter({ page: current + 1 })}>
                {L.next}
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function startText(s: ListSubmission) {
  const parts = s.courses.map((c) => {
    if (c.preferred_start_undecided) return T.admin.list.startUndecided;
    if (c.preferred_start_date) return formatDateKo(c.preferred_start_date);
    if (c.fixed_start_date) return `${T.admin.list.startFixed} ${formatDateKo(c.fixed_start_date)}`;
    return '';
  });
  return [...new Set(parts.filter(Boolean))].join(', ');
}

function ResponseTable({ items }: { items: ListSubmission[] }) {
  const L = T.admin.list;
  return (
    <>
      {/* 넓은 화면: 표 */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full text-[15px]">
          <caption className="sr-only">{L.title}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[13px] text-muted">
              <th scope="col" className="px-4 py-2.5 font-semibold">{L.colReceived}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{L.colPeople}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{L.colGrade}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{L.colSubjects}</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">{L.colStart}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">{L.colUnknown}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{L.colPhone}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const unknown = totalUnknowns(s);
              return (
                <tr key={s.id} className="border-b border-line align-top last:border-0 hover:bg-[#fafbf9]">
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted">{formatDateTimeKo(s.received_at)}</td>
                  <td className="px-3 py-3">
                    <Link to={`/admin/responses/${s.id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                      {s.student_name}
                    </Link>
                    <span className="block text-[14px] text-muted">{s.parent_name}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{schoolGradeLabel(s.school_level, s.grade, s.grade_note)}</td>
                  <td className="px-3 py-3">
                    <ul className="space-y-1.5">
                      {s.courses.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                          <SubjectBadge name={c.subject_name} />
                          <StatusTag status={c.status} />
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-3">{startText(s)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {unknown > 0 ? <Tag tone="warn">{unknown}개</Tag> : <span className="text-muted">0</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{maskPhone(s.parent_phone)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 좁은 화면: 카드 목록 */}
      <ul className="space-y-3 md:hidden">
        {items.map((s) => {
          const unknown = totalUnknowns(s);
          return (
            <li key={s.id} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/admin/responses/${s.id}`} className="text-lg font-bold text-ink underline-offset-4 hover:underline">
                    {s.student_name}
                  </Link>
                  <p className="text-[14px] text-muted">
                    {schoolGradeLabel(s.school_level, s.grade, s.grade_note)} · {s.parent_name} · {maskPhone(s.parent_phone)}
                  </p>
                </div>
                {unknown > 0 && <Tag tone="warn">확인 {unknown}</Tag>}
              </div>
              <ul className="mt-3 space-y-1.5">
                {s.courses.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                    <SubjectBadge name={c.subject_name} />
                    <StatusTag status={c.status} />
                  </li>
                ))}
              </ul>
              <p className={cx('mt-3 text-[13px] text-muted')}>
                {formatDateTimeKo(s.received_at)}
                {startText(s) && ` · 희망 시작 ${startText(s)}`}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
