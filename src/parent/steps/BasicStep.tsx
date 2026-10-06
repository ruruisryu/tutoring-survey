import { T } from '../../copy/ko';
import { SYSTEM_MAX } from '../../lib/errorText';
import { applicableQuestions, visibilityMap } from '../../lib/questions';
import { fieldId, GRADE_OPTIONS } from '../../lib/survey';
import type { PublicForm, SurveyDraft } from '../../lib/types';
import { CharCount, Field, Select, TextArea, TextInput } from '../../components/ui';
import { QuestionField } from '../../components/QuestionField';

export interface StepProps {
  form: PublicForm;
  draft: SurveyDraft;
  update: (fn: (d: SurveyDraft) => void) => void;
  err: (path: string) => string | null;
}

export function BasicStep({ form, draft, update, err }: StepProps) {
  const B = T.parent.basic;
  const c = draft.common;
  const commonQs = applicableQuestions(form.common?.questions ?? [], null);
  const vis = visibilityMap(commonQs, c.answers, c.grade_key);
  return (
    <div className="space-y-7">
      <p className="text-[16px] leading-relaxed text-muted">{B.intro}</p>

      <Field id={fieldId('common.parent_name')} label={B.parentName} required error={err('common.parent_name')}>
        {(a) => (
          <TextInput {...a} autoComplete="name" maxLength={SYSTEM_MAX.parent_name} value={c.parent_name} onChange={(e) => update((d) => void (d.common.parent_name = e.target.value))} />
        )}
      </Field>

      <Field id={fieldId('common.parent_phone')} label={B.parentPhone} required help={B.parentPhoneHelp} error={err('common.parent_phone')}>
        {(a) => (
          <TextInput
            {...a}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="010-1234-5678"
            value={c.parent_phone}
            onChange={(e) => update((d) => void (d.common.parent_phone = e.target.value))}
            className="max-w-sm"
          />
        )}
      </Field>

      <Field id={fieldId('common.student_name')} label={B.studentName} required help={B.studentNameHelp} error={err('common.student_name')}>
        {(a) => (
          <TextInput {...a} autoComplete="off" maxLength={SYSTEM_MAX.student_name} value={c.student_name} onChange={(e) => update((d) => void (d.common.student_name = e.target.value))} className="max-w-sm" />
        )}
      </Field>

      <Field id={fieldId('common.grade')} label={B.grade} required error={err('common.grade')}>
        {(a) => (
          <Select {...a} value={c.grade_key} onChange={(e) => update((d) => void (d.common.grade_key = e.target.value))} className="max-w-sm">
            <option value="">{B.gradePlaceholder}</option>
            <optgroup label="초등학교">
              {GRADE_OPTIONS.filter((g) => g.level === 'elementary').map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="중학교">
              {GRADE_OPTIONS.filter((g) => g.level === 'middle').map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="고등학교">
              {GRADE_OPTIONS.filter((g) => g.level === 'high').map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </optgroup>
            <option value="other">{B.gradeOther}</option>
          </Select>
        )}
      </Field>

      {c.grade_key === 'other' && (
        <Field id={fieldId('common.grade_note')} label={B.gradeNote} required help={B.gradeNoteHelp} error={err('common.grade_note')}>
          {(a) => (
            <TextInput {...a} maxLength={SYSTEM_MAX.grade_note} value={c.grade_note} onChange={(e) => update((d) => void (d.common.grade_note = e.target.value))} className="max-w-sm" />
          )}
        </Field>
      )}

      <Field id={fieldId('common.school_name')} label={B.schoolName} optional error={err('common.school_name')}>
        {(a) => (
          <TextInput {...a} maxLength={SYSTEM_MAX.school_name} value={c.school_name} onChange={(e) => update((d) => void (d.common.school_name = e.target.value))} className="max-w-sm" />
        )}
      </Field>

      {commonQs.length > 0 && (
        <div className="space-y-7 border-t border-line pt-7">
          <h2 className="text-lg font-bold">{B.extraTitle}</h2>
          {commonQs
            .filter((q) => vis[q.id])
            .map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                fieldId={fieldId(`common.answers.${q.id}`)}
                answer={c.answers[q.id]}
                error={err(`common.answers.${q.id}`)}
                onChange={(ans) =>
                  update((d) => {
                    if (ans) d.common.answers[q.id] = ans;
                    else delete d.common.answers[q.id];
                  })
                }
              />
            ))}
        </div>
      )}

      <Field
        id={fieldId('common.general_request')}
        label={B.generalRequest}
        optional
        help={B.generalRequestHelp}
        error={err('common.general_request')}
        counter={<CharCount value={c.general_request} max={SYSTEM_MAX.general_request} />}
      >
        {(a) => (
          <TextArea {...a} maxLength={SYSTEM_MAX.general_request} value={c.general_request} onChange={(e) => update((d) => void (d.common.general_request = e.target.value))} />
        )}
      </Field>
    </div>
  );
}
