import { T } from '../copy/ko';
import type { PublicForm } from '../lib/types';
import { Button } from '../components/ui';
import { CourseSummaryCard } from '../components/CourseSummary';

export function IntroView({ form, minutes, onStart }: { form: PublicForm; minutes: number; onStart: () => void }) {
  const s = form.settings;
  const P = T.parent;
  const courses = form.courses ?? [];
  const multi = !!form.allow_multiple && courses.length > 1;
  return (
    <div>
      <section aria-labelledby="intro-title">
        <p className="text-[15px] font-semibold text-accent-strong">{s.intro_eyebrow || P.defaultEyebrow}</p>
        <h1 id="intro-title" className="mt-2 text-[26px] font-bold leading-[1.35] tracking-tight sm:text-[32px]">
          {s.intro_title || P.defaultTitle}
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink">{s.intro_body || P.defaultBody}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={onStart} className="sm:min-w-60">
            {P.start}
          </Button>
          <p className="text-[15px] text-muted">{P.estimate(minutes)}</p>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{s.intro_note || P.defaultNote}</p>
      </section>

      <section aria-labelledby="process-title" className="mt-12 border-t border-line pt-8">
        <h2 id="process-title" className="text-lg font-bold">
          {P.processTitle}
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {P.process.map((p, i) => (
            <li key={p.title} className="flex gap-3 sm:block">
              <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-accent text-[15px] font-bold text-accent-strong">
                {i + 1}
              </span>
              <div className="sm:mt-3">
                <h3 className="font-semibold">
                  <span className="sr-only">{i + 1}단계 </span>
                  {p.title}
                </h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="courses-title" className="mt-12 border-t border-line pt-8">
        <h2 id="courses-title" className="text-lg font-bold">
          {multi ? P.coursesTitleMulti : P.coursesTitle}
        </h2>
        <div className="mt-4 grid gap-3">
          {courses.map((c) => (
            <CourseSummaryCard key={c.id} course={c} showPerspective />
          ))}
        </div>
      </section>

      {s.teacher_intro && (
        <section aria-labelledby="teacher-title" className="mt-12 border-t border-line pt-8">
          <h2 id="teacher-title" className="text-lg font-bold">
            {P.teacherTitle(s.teacher_name)}
          </h2>
          <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed">{s.teacher_intro}</p>
        </section>
      )}

      {s.policy_notice && (
        <section aria-labelledby="policy-title" className="mt-12 border-t border-line pt-8">
          <h2 id="policy-title" className="text-lg font-bold">
            {P.policyTitle}
          </h2>
          <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{s.policy_notice}</p>
        </section>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <ul className="space-y-2 text-[15px] leading-relaxed text-muted">
          <li>· {P.siblingNote}</li>
          <li>· {P.photoNote}</li>
        </ul>
        <Button onClick={onStart} className="mt-6 w-full sm:w-auto sm:min-w-60">
          {P.start}
        </Button>
      </section>
    </div>
  );
}
