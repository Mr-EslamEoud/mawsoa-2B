export interface Question {
  type: string;
  q: string;
  options: string[];
  correct: string;
  reason: string;
  answer: string;
  concept: string;
  paragraph: string;
  section: string;
  essayType?: string;
  maxScore?: number;
}

export interface PdfAttachment {
  url: string;
  name: string;
}

export interface Lesson {
  id: string;
  title: string;
  questions: Question[];
  completed: boolean;
  audio?: string | null;
  video?: string | null;
  pdf?: string | null;
  pdfFiles?: PdfAttachment[];
}

export interface Unit {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Student {
  name: string;
  code?: string;
  isPaid?: boolean;
  missingMonths?: string[];
  graceMonths?: string[];
  graceDaysRemaining?: number;
  phone?: string;
  role?: string;
  passHash?: string;
  gender?: string;
  isBlocked?: boolean;
  registrationDate?: string;
}

export interface UserAnswer {
  isCorrect: boolean;
  selected?: string;
  concept?: string;
  paragraph?: string;
  type?: string;
  studentAnswerText?: string;
  teacherScore?: number;
  teacherFeedback?: string;
  aiSuggestedScore?: number;
  aiSuggestedFeedback?: string;
  status?: 'pending' | 'approved';
}

export interface PendingRequest {
  date: string;
  name: string;
  phone: string;
  method: string;
}

export interface OnlineStudent {
  code: string;
  name: string;
  phone: string;
  stage?: string;
  packageType: string;
  activeMonths: string;
  method?: string;
  amount?: string;
  date?: string;
  notes?: string;
  reason?: string;
}

export interface TestResult {
  name: string;
  phone: string;
  quiz: string;
  score: string;
  date: string;
  studentType?: string;
}

export interface GroupedResult {
  name: string;
  phone: string;
  tests: TestResult[];
  studentType?: string;
  gender?: string;
}

export interface InteractiveMap {
  id: string | number;
  title: string;
  url: string;
}

export type DialectPolicy = 'encouraging' | 'strict' | 'balanced';

export interface GlobalExamConfig {
  mcqScore: number;
  tfScore: number;
  essayScore: number;
  gradingMode: 'instant_ai' | 'hybrid';
  dialectPolicy: DialectPolicy;
  includeEssayInTotal: boolean;
  showModelAnswerAfterApproval: boolean;
}

export type ExamScheduleTarget = 'all' | 'online_only' | 'center_only' | 'custom';
export type ExamLeaderboardPolicy = 'within_schedule' | 'always' | 'never';

export interface ExamAudienceSchedule {
  scheduleMode?: 'always' | 'scheduled';
  startDate?: string;
  endDate?: string;
  leaderboardPolicy?: ExamLeaderboardPolicy;
}

export interface ExamConfig {
  lessonId: string;
  mcqScore: number;
  tfScore: number;
  essayScore: number;
  customQuestionScores?: Record<number, number>;
  includeEssayInTotal: boolean;
  gradingMode: 'instant_ai' | 'hybrid';
  showModelAnswerAfterApproval: boolean;
  isPublished?: boolean;
  dialectPolicy?: DialectPolicy;
  useGlobalSettings?: boolean;
  // إعدادات الجدولة الزمنية وإتاحة الامتحان
  targetAudience?: ExamScheduleTarget;
  scheduleMode?: 'always' | 'scheduled';
  startDate?: string;
  endDate?: string;
  leaderboardPolicy?: ExamLeaderboardPolicy;
  onlineSchedule?: ExamAudienceSchedule;
  centerSchedule?: ExamAudienceSchedule;
}

export interface EssayReviewQuestionItem {
  qIndex: number;
  questionText: string;
  essayType: string;
  modelAnswer: string;
  studentText: string;
  maxScore: number;
  aiScore?: number;
  aiFeedback?: string;
  teacherScore?: number;
  teacherFeedback?: string;
  isApproved?: boolean;
}

export interface StudentEssaySubmission {
  id: string;
  studentName: string;
  studentPhone: string;
  quizTitle: string;
  lessonId: string;
  submissionDate: string;
  questions: EssayReviewQuestionItem[];
  isFullyApproved: boolean;
  finalScore?: number;
  maxPossibleScore?: number;
  studentType?: string;
}

export interface PermanentMistakeItem {
  id: string;
  question: Question;
  unitId: string;
  unitTitle: string;
  lessonId: string;
  lessonTitle: string;
  studentAnswerText?: string;
  studentSelectedOption?: string;
  modelAnswer: string;
  reason?: string;
  concept?: string;
  isEssay: boolean;
  essayType?: string;
  teacherScore?: number;
  maxScore?: number;
  teacherFeedback?: string;
  isMastered?: boolean;
  timestamp?: number;
}

export interface ExamSecuritySettings {
  preventScreenshot: boolean;
  watermarkEnabled: boolean;
  lockdownEnabled: boolean;
  maxTabSwitchStrikes: number;
  offlineModeEnabled: boolean;
}


