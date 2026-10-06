// 서버 함수(supabase/migrations)가 주고받는 JSON 형태

export type QuestionType = 'short_text' | 'long_text' | 'single' | 'multi' | 'number' | 'date' | 'time';
export type QuestionRole = 'goal' | 'textbook' | 'progress' | 'difficulty' | 'score' | 'confidence' | 'note' | 'other';

export interface QuestionOption {
  value: string;
  label: string;
  exclusive?: boolean;
}

export interface ShowIf {
  question: string;
  any_of: string[];
}

export interface Question {
  id: string;
  type: QuestionType;
  label: string;
  help?: string;
  required: boolean;
  active: boolean;
  allow_unknown?: boolean;
  unknown_label?: string;
  options?: QuestionOption[];
  max_length?: number;
  min?: number;
  max?: number;
  course_ids?: string[];
  /** 적용 학년 ('middle-2' 형식). 비어 있으면 모든 학년 */
  grades?: string[];
  show_if?: ShowIf | null;
  role?: QuestionRole;
  followup?: string;
  locked?: boolean;
}

export type AnswerValue = string | number | string[];
export type Answer = { status: 'answered'; value: AnswerValue } | { status: 'unknown' };
export type Answers = Record<string, Answer>;

export type SchoolLevel = 'elementary' | 'middle' | 'high';
export type CourseSchoolLevel = SchoolLevel | 'any';
export type StudentSchoolLevel = SchoolLevel | 'other';
export type Mode = 'in_person' | 'online' | 'hybrid' | 'negotiable';
export type GroupType = 'individual' | 'group' | 'negotiable';
export type TimeBand = 'morning' | 'afternoon' | 'evening';
export type FixedCondition = 'weekdays' | 'start_time' | 'minutes' | 'sessions' | 'start_date' | 'duration';

export interface CourseConditions {
  school_level: CourseSchoolLevel;
  grades: number[];
  scope_text: string;
  mode: Mode;
  group_type: GroupType;
  sessions_per_week: number | null;
  minutes_per_session: number | null;
  weekdays: number[];
  time_bands: TimeBand[];
  start_time: string | null;
  time_note: string;
  start_date: string | null;
  duration_text: string;
  fixed_conditions: FixedCondition[];
  /** 주당 횟수를 조율할 때 고를 수 있는 값 (빈 배열 = 1~5회) */
  session_choices: number[];
  notice: string;
}

export interface PublicCourse extends CourseConditions {
  id: string;
  name: string;
  subject_id: string;
  subject_name: string;
  subject_description: string;
  subject_perspective: string;
  version_id: string;
  version_no: number;
  questions: Question[];
}

export interface PublicSettings {
  service_name: string;
  parent_title: string;
  teacher_name: string;
  teacher_intro: string;
  intro_eyebrow: string;
  intro_title: string;
  intro_body: string;
  intro_note: string;
  completion_message: string;
  policy_notice: string;
  operator_name?: string;
  operator_contact?: string;
  privacy_purpose?: string;
  privacy_retention?: string;
  privacy_deletion?: string;
}

export type FormStatus = 'open' | 'invalid' | 'closed' | 'expired' | 'full' | 'not_ready';

export interface PublicForm {
  status: FormStatus;
  settings: PublicSettings;
  loaded_at?: string;
  today?: string;
  allow_multiple?: boolean;
  common?: { version_id: string; version_no: number; questions: Question[] } | null;
  courses?: PublicCourse[];
}

export interface Slot {
  weekday: number;
  start_time: string;
}

export interface ScheduleDraft {
  start_date: string;
  start_undecided: boolean;
  time_undecided: boolean;
  slots: Slot[];
  duration: string;
  sessions_per_week: number | null;
  minutes: number | null;
  mode: 'in_person' | 'online' | 'hybrid' | 'any' | null; // 학부모 화면은 대면·화상·상관없음만 보여준다
  group_type: 'individual' | 'group' | 'any' | null;
  note: string;
}

export type AssessmentKind = 'midterm' | 'final' | 'performance' | 'unit' | 'other';
export type AssessmentStatus = 'entered' | 'finished' | 'unknown' | 'undecided' | 'not_applicable';

export interface AssessmentDraft {
  key: string; // 화면용 식별자 (전송하지 않음)
  kind: AssessmentKind;
  name: string;
  status: AssessmentStatus | '';
  period_start: string;
  period_end: string;
  exam_date: string;
  scope: string;
}

export type HomeworkBand = 'lt30' | '30_60' | '60_90' | '90_120' | 'gte120' | 'tbd';

export interface CourseDraft {
  course_id: string;
  schedule: ScheduleDraft;
  answers: Answers;
  assessments: AssessmentDraft[];
  homework_band: HomeworkBand | '';
}

export interface CommonDraft {
  parent_name: string;
  parent_phone: string;
  student_name: string;
  grade_key: string; // 'middle-2' 처럼 학교급-학년, 기타는 'other'
  grade_note: string;
  school_name: string;
  general_request: string;
  consecutive_request: '' | 'yes' | 'no' | 'either';
  consecutive_note: string;
  answers: Answers;
}

export interface SurveyDraft {
  common: CommonDraft;
  selected: string[]; // course id 순서
  courses: Record<string, CourseDraft>;
  consent: boolean;
  website: string; // 스팸 방지용 숨은 칸
}

// ---------------------------------------------------------------------------
// 관리자
// ---------------------------------------------------------------------------
export type ConsultStatus = 'new' | 'reviewing' | 'needs_info' | 'scheduled' | 'on_hold';

export interface ListCourse {
  id: string;
  course_id: string | null;
  course_name: string;
  subject_id: string | null;
  subject_name: string;
  preferred_start_date: string | null;
  preferred_start_undecided: boolean;
  fixed_start_date: string | null;
  time_undecided: boolean;
  slots: Slot[];
  homework_band: HomeworkBand;
  unknown_count: number;
  status: ConsultStatus;
  next_contact_date: string | null;
  confirmed_start_date: string | null;
  updated_at: string;
}

export interface ListSubmission {
  id: string;
  receipt_code: string;
  received_at: string;
  parent_name: string;
  parent_phone: string;
  student_name: string;
  school_level: StudentSchoolLevel;
  grade: number | null;
  grade_note: string;
  school_name: string;
  unknown_count: number;
  courses: ListCourse[];
}

export interface Consultation {
  status: ConsultStatus;
  consult_memo: string;
  plan_memo: string;
  confirmed_start_date: string | null;
  confirmed_minutes: number | null;
  next_contact_date: string | null;
  created_at: string;
  updated_at: string;
  slots: Slot[];
}

export interface StoredAssessment {
  kind: AssessmentKind;
  name: string;
  status: AssessmentStatus;
  period_start: string | null;
  period_end: string | null;
  exam_date: string | null;
  scope: string;
}

export interface StoredSchedule {
  start_date: string | null;
  start_undecided: boolean;
  time_undecided: boolean;
  slots: Slot[];
  duration: string;
  sessions_per_week: number | null;
  minutes: number | null;
  mode: ScheduleDraft['mode'];
  group_type: ScheduleDraft['group_type'];
  note: string;
}

export interface CourseSnapshot extends CourseConditions {
  id: string;
  name: string;
  subject_id: string;
  subject_name: string;
  subject_description: string;
  subject_perspective: string;
  version_no: number;
}

export interface DetailCourse {
  id: string;
  course_id: string | null;
  subject_id: string | null;
  position: number;
  course: CourseSnapshot;
  version_id: string;
  version_no: number;
  questions: Question[];
  answers: Answers;
  schedule: StoredSchedule;
  homework_band: HomeworkBand;
  assessments: StoredAssessment[];
  unknown_count: number;
  consultation: Consultation;
}

export interface SubmissionDetail {
  id: string;
  receipt_code: string;
  received_at: string;
  parent_name: string;
  parent_phone: string;
  student_name: string;
  school_level: StudentSchoolLevel;
  grade: number | null;
  grade_note: string;
  school_name: string;
  general_request: string;
  consecutive_request: 'yes' | 'no' | 'either' | null;
  consecutive_note: string;
  privacy_consented_at: string;
  privacy_snapshot: Record<string, string>;
  unknown_count: number;
  invitation_label: string | null;
  common: { version_id: string | null; version_no: number | null; questions: Question[]; answers: Answers };
  courses: DetailCourse[];
}

export interface Subject {
  id: string;
  name: string;
  description: string;
  perspective: string;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  default_template_id: string | null;
  course_count: number;
  response_count: number;
}

export interface TemplateVersionInfo {
  id: string;
  version_no: number;
  status: 'published' | 'superseded';
  published_at: string;
  superseded_at: string | null;
  response_count: number;
}

export interface Template {
  id: string;
  kind: 'common' | 'subject';
  subject_id: string | null;
  name: string;
  description: string;
  archived_at: string | null;
  published: { id: string; version_no: number; published_at: string; questions: Question[] } | null;
  draft: { id: string; questions: Question[]; updated_at: string } | null;
  versions: TemplateVersionInfo[];
  course_count: number;
}

export interface Course extends CourseConditions {
  id: string;
  subject_id: string;
  template_id: string;
  name: string;
  status: 'open' | 'closed' | 'archived';
  sort_order: number;
  created_at: string;
  updated_at: string;
  response_count: number;
}

export interface Invitation {
  id: string;
  token: string;
  label: string;
  allow_multiple: boolean;
  is_active: boolean;
  expires_at: string | null;
  max_submissions: number | null;
  created_at: string;
  course_ids: string[];
  submission_count: number;
  state: FormStatus;
}

export interface Catalog {
  subjects: Subject[];
  templates: Template[];
  courses: Course[];
  invitations: Invitation[];
}

export interface AppSettings extends PublicSettings {
  operator_name: string;
  operator_contact: string;
  privacy_purpose: string;
  privacy_retention: string;
  privacy_deletion: string;
  privacy_confirmed: boolean;
  privacy_confirmed_at: string | null;
  updated_at: string;
}
