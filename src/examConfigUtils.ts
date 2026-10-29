import { Question, ExamConfig, GlobalExamConfig, DialectPolicy, StudentEssaySubmission, EssayReviewQuestionItem, ExamLeaderboardPolicy, ExamScheduleTarget, ExamAudienceSchedule, StudentRetakeDirective, Unit } from "./types";
export { type DialectPolicy, type GlobalExamConfig, type ExamLeaderboardPolicy, type ExamScheduleTarget, type ExamAudienceSchedule, type StudentRetakeDirective };

export const GLOBAL_EXAM_CONFIG_KEY = 'kanz_global_exam_config';

export const getDefaultGlobalExamConfig = (): GlobalExamConfig => ({
  mcqScore: 1,
  tfScore: 1,
  essayScore: 2,
  gradingMode: 'hybrid',
  dialectPolicy: 'balanced',
  includeEssayInTotal: true,
  showModelAnswerAfterApproval: true,
});

export const getGlobalExamConfig = (): GlobalExamConfig => {
  try {
    const raw = localStorage.getItem(GLOBAL_EXAM_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // اعتماد الهجين كوضع تلقائي ذكي
      const hasExplicitSaved = localStorage.getItem('kanz_global_exam_config_explicit_v2');
      if (!hasExplicitSaved && parsed.gradingMode === 'instant_ai') {
        parsed.gradingMode = 'hybrid';
      }
      return {
        ...getDefaultGlobalExamConfig(),
        ...parsed,
      };
    }
  } catch (e) {
    console.error("Error reading global exam config:", e);
  }
  return getDefaultGlobalExamConfig();
};

export const saveGlobalExamConfig = (config: GlobalExamConfig): void => {
  try {
    localStorage.setItem(GLOBAL_EXAM_CONFIG_KEY, JSON.stringify(config));
    localStorage.setItem('kanz_global_exam_config_explicit_v2', 'true');
  } catch (e) {
    console.error("Error saving global exam config:", e);
  }
};

/**
 * دالة التعرف الذكي التلقائي على نوع السؤال المقالي من نص السؤال
 */
export const detectEssayType = (questionText: string): { key: string; label: string } => {
  if (!questionText) return { key: 'general', label: 'سؤال مقالي عام' };
  const text = questionText.trim();

  if (/(بم\s*تفسر|علل|فسر\s*السبب|اذكر\s*السبب|ما\s*سبب)/i.test(text)) {
    return { key: 'explain', label: 'سؤال تعليل (بم تفسر)' };
  }
  if (/(ما\s*النتائج|ما\s*الآثار|النتائج\s*المترتبة|ماذا\s*ترتب)/i.test(text)) {
    return { key: 'consequence', label: 'سؤال نتائج (ما النتائج المترتبة)' };
  }
  if (/(استدل|دلل|أيد|أثبت|برهن|ساند\s*بالدليل|بالأدلة\s*التاريخية)/i.test(text)) {
    return { key: 'evidence', label: 'سؤال استدلال (دلل / أيد تاريخياً)' };
  }
  if (/(قارن|وازن|أوجه\s*الشبه|أوجه\s*الاختلاف|الفرق\s*بين)/i.test(text)) {
    return { key: 'compare', label: 'سؤال مقارنة (قارن بين)' };
  }
  if (/(ما\s*العلاقة|وضح\s*الارتباط|العلاقة\s*بين|ما\s*الرابط)/i.test(text)) {
    return { key: 'relation', label: 'سؤال ربط (ما العلاقة بين)' };
  }
  if (/(ماذا\s*يحدث|ماذا\s*كان\s*يحدث|لو\s*لم|إذا\s*لم)/i.test(text)) {
    return { key: 'hypothetical', label: 'سؤال استنتاجي (ماذا يحدث إذا)' };
  }
  if (/(ما\s*رأيك|ما\s*تقييمك|ما\s*مقترحاتك|وجهة\s*نظرك)/i.test(text)) {
    return { key: 'opinion', label: 'سؤال رأي ونقد (ما رأيك)' };
  }

  return { key: 'general', label: 'سؤال مقالي' };
};

/**
 * الإعدادات الافتراضية الآمنة لأي امتحان
 */
export const getDefaultExamConfig = (lessonId: string): ExamConfig => {
  const globalCfg = getGlobalExamConfig();
  return {
    lessonId,
    mcqScore: globalCfg.mcqScore,
    tfScore: globalCfg.tfScore,
    essayScore: globalCfg.essayScore,
    customQuestionScores: {},
    includeEssayInTotal: globalCfg.includeEssayInTotal,
    gradingMode: globalCfg.gradingMode,
    showModelAnswerAfterApproval: globalCfg.showModelAnswerAfterApproval,
    dialectPolicy: globalCfg.dialectPolicy,
    useGlobalSettings: true,
    isPublished: false,
    targetAudience: 'all',
    scheduleMode: 'always',
    startDate: '',
    endDate: '',
    leaderboardPolicy: 'always',
  };
};

/**
 * جلب إعدادات الامتحان المخزنة مع الرجوع للقيم الافتراضية
 */
export const getExamConfig = (lessonId: string): ExamConfig => {
  try {
    const raw = localStorage.getItem(`exam_config_${lessonId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.useGlobalSettings !== false) {
        const globalCfg = getGlobalExamConfig();
        return {
          ...getDefaultExamConfig(lessonId),
          ...parsed,
          mcqScore: globalCfg.mcqScore,
          tfScore: globalCfg.tfScore,
          essayScore: globalCfg.essayScore,
          gradingMode: globalCfg.gradingMode,
          dialectPolicy: globalCfg.dialectPolicy,
          includeEssayInTotal: globalCfg.includeEssayInTotal,
          showModelAnswerAfterApproval: globalCfg.showModelAnswerAfterApproval,
        };
      }
      return {
        ...getDefaultExamConfig(lessonId),
        ...parsed,
      };
    }
  } catch (e) {
    console.error("Error reading exam config:", e);
  }
  return getDefaultExamConfig(lessonId);
};

/**
 * حفظ إعدادات الامتحان
 */
export const saveExamConfig = (config: ExamConfig): void => {
  try {
    localStorage.setItem(`exam_config_${config.lessonId}`, JSON.stringify(config));
  } catch (e) {
    console.error("Error saving exam config:", e);
  }
};

/**
 * جلب جميع إعدادات وجداول الامتحانات المخزنة محلياً
 */
export const getAllExamConfigs = (): Record<string, ExamConfig> => {
  const result: Record<string, ExamConfig> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('exam_config_')) {
        const lessonId = key.replace('exam_config_', '');
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            result[lessonId] = JSON.parse(raw);
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.error("Error gathering all exam configs:", e);
  }
  return result;
};

/**
 * دمج ومزامنة جداول الامتحانات القادمة من السحابة في الذاكرة المحلية لهواتف الطلاب
 */
export const syncExamConfigsFromCloud = (cloudConfigsRaw: any): void => {
  if (!cloudConfigsRaw) return;
  try {
    let cloudMap: Record<string, ExamConfig> = {};
    if (typeof cloudConfigsRaw === 'string') {
      try {
        cloudMap = JSON.parse(cloudConfigsRaw);
      } catch (e) {
        return;
      }
    } else if (typeof cloudConfigsRaw === 'object') {
      cloudMap = cloudConfigsRaw;
    }
    
    if (cloudMap && typeof cloudMap === 'object') {
      Object.keys(cloudMap).forEach(lessonId => {
        const cloudCfg = cloudMap[lessonId];
        if (cloudCfg && typeof cloudCfg === 'object') {
          const currentLocal = getExamConfig(lessonId);
          const merged: ExamConfig = {
            ...currentLocal,
            ...cloudCfg,
          };
          localStorage.setItem(`exam_config_${lessonId}`, JSON.stringify(merged));
        }
      });
    }
  } catch (e) {
    console.error("Error syncing exam configs from cloud:", e);
  }
};

/**
 * حساب درجة سؤال محدد بدقة
 */
export const getQuestionMaxScore = (q: Question, qIndex: number, config: ExamConfig): number => {
  if (config.customQuestionScores && config.customQuestionScores[qIndex] !== undefined) {
    return Number(config.customQuestionScores[qIndex]) || 1;
  }
  if (q.maxScore !== undefined && q.maxScore > 0) {
    return q.maxScore;
  }
  if (q.type === 'essay') {
    return Number(config.essayScore) || 2;
  }
  if (q.type === 'tf') {
    return Number(config.tfScore) || 1;
  }
  return Number(config.mcqScore) || 1;
};

/**
 * حساب تفاصيل ومجموع درجات الامتحان بالكامل
 */
export const calculateExamStructure = (questions: Question[], config: ExamConfig) => {
  let mcqCount = 0;
  let tfCount = 0;
  let essayCount = 0;

  let mcqTotalScore = 0;
  let tfTotalScore = 0;
  let essayTotalScore = 0;

  questions.forEach((q, idx) => {
    const score = getQuestionMaxScore(q, idx, config);
    if (q.type === 'essay') {
      essayCount++;
      essayTotalScore += score;
    } else if (q.type === 'tf') {
      tfCount++;
      tfTotalScore += score;
    } else {
      mcqCount++;
      mcqTotalScore += score;
    }
  });

  const objectiveTotalScore = mcqTotalScore + tfTotalScore;
  const examTotalScore = config.includeEssayInTotal
    ? (objectiveTotalScore + essayTotalScore)
    : objectiveTotalScore;

  return {
    totalQuestions: questions.length,
    mcqCount,
    tfCount,
    essayCount,
    mcqTotalScore,
    tfTotalScore,
    essayTotalScore,
    objectiveTotalScore,
    examTotalScore,
  };
};

// -------------------------------------------------------------
// إدارة إجابات الطلاب المعلقة للمراجعة (Submissions Storage)
// -------------------------------------------------------------

const PENDING_ESSAYS_STORAGE_KEY = "kanz_pending_essay_submissions";

export const getPendingEssaySubmissions = (): StudentEssaySubmission[] => {
  try {
    const raw = localStorage.getItem(PENDING_ESSAYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Error reading pending essay submissions:", e);
    return [];
  }
};

export const savePendingEssaySubmission = (sub: StudentEssaySubmission): void => {
  try {
    const all = getPendingEssaySubmissions();
    const existingIdx = all.findIndex(item => item.id === sub.id || (item.studentPhone === sub.studentPhone && item.lessonId === sub.lessonId));
    if (existingIdx !== -1) {
      all[existingIdx] = sub;
    } else {
      all.unshift(sub);
    }
    localStorage.setItem(PENDING_ESSAYS_STORAGE_KEY, JSON.stringify(all));
    notifyPendingEssaysChanged();
  } catch (e) {
    console.error("Error saving pending essay submission:", e);
  }
};

export const notifyPendingEssaysChanged = (): void => {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kanz_pending_essays_changed'));
    }
  } catch (e) {}
};

/**
 * الدالة المركزية الموحدة لاحتساب شارات الإدارة (بانتظار التصحيح + بانتظار الاعتماد)
 * لضمان تطابق تام 100% بين الشريط الجانبي والأرقام المعروضة داخل تبويب تصحيح المقالي واعتماد النتائج
 */
export const calculateAdminBadgeCounts = (): { needsGradingCount: number; readyToApproveCount: number } => {
  try {
    const allSubs = getPendingEssaySubmissions();
    let needsGrading = 0;
    let readyToApprove = 0;

    allSubs.forEach(s => {
      // 1. استبعاد التسليمات المعتمدة والمؤرشفة بالكامل
      if (s.isFullyApproved) return;

      // 2. استبعاد الطلاب الممنوحين إذن إعادة امتحان نشط
      const retakeDirective = getActiveRetakeDirectiveForLesson(s.studentPhone, s.quizTitle);
      if (retakeDirective) return;

      // 3. فحص ما إذا كان الطالب مؤهلاً لتصحيح المقالي (كتب إجابة مقالية فعلية)
      const hasWritten = hasWrittenEssayAnswers(s);
      if (!hasWritten || s.isAutoTerminated) {
        // ليس لديه مقالي يحتاج تصحيح المعلم -> يذهب مباشرة لاعتماد النتائج
        readyToApprove++;
        return;
      }

      // 4. هل تم تصحيحه كمسودة بالفعل أم لا يزال بانتظار تصحيح المعلم؟
      const essayQs = (s.questions || []).filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
      const hasAllScores = essayQs.length > 0 && essayQs.every(q => q.teacherScore !== undefined && q.teacherScore !== null);
      const isReviewed = Boolean(s.isTeacherReviewed || (s as any).hasGradedStatus || hasAllScores);

      if (isReviewed) {
        readyToApprove++;
      } else {
        needsGrading++;
      }
    });

    return { needsGradingCount: needsGrading, readyToApproveCount: readyToApprove };
  } catch (e) {
    return { needsGradingCount: 0, readyToApproveCount: 0 };
  }
};

export const updateEssaySubmission = (sub: StudentEssaySubmission): void => {
  savePendingEssaySubmission(sub);
};

export const getStudentPendingSubmission = (studentPhone: string, lessonId: string): StudentEssaySubmission | null => {
  const all = getPendingEssaySubmissions();
  return all.find(item => item.studentPhone === studentPhone && item.lessonId === lessonId) || null;
};

/**
 * جلب جميع تسليمات طالب محدد (معتمدة أو معلقة)
 */
export const getStudentSubmissions = (studentPhone: string): StudentEssaySubmission[] => {
  const all = getPendingEssaySubmissions();
  if (!studentPhone) return [];
  const cleanPhone = studentPhone.trim().replace(/[^\d]/g, '');
  return all.filter(item => {
    const itemClean = (item.studentPhone || '').trim().replace(/[^\d]/g, '');
    return itemClean === cleanPhone || (itemClean.length >= 8 && cleanPhone.length >= 8 && (itemClean.endsWith(cleanPhone) || cleanPhone.endsWith(itemClean)));
  });
};

const SEEN_NOTIFICATIONS_KEY = "kanz_seen_approved_submissions";

export const getSeenApprovedSubmissionIds = (): string[] => {
  try {
    const raw = localStorage.getItem(SEEN_NOTIFICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

export const markSubmissionNotificationSeen = (submissionId: string): void => {
  try {
    const seen = getSeenApprovedSubmissionIds();
    if (!seen.includes(submissionId)) {
      seen.push(submissionId);
      localStorage.setItem(SEEN_NOTIFICATIONS_KEY, JSON.stringify(seen));
    }
  } catch (e) {}
};

/**
 * جلب التسليمات المعتمدة الجديدة التي لم يرها الطالب بعد
 */
export const getUnseenApprovedSubmissions = (studentPhone: string): StudentEssaySubmission[] => {
  const studentSubs = getStudentSubmissions(studentPhone);
  const seenIds = new Set(getSeenApprovedSubmissionIds());
  return studentSubs.filter(sub => sub.isFullyApproved && !seenIds.has(sub.id));
};

// -------------------------------------------------------------
// وظائف جدولة ومواعيد إتاحة الامتحانات (Exam Scheduling Utilities)
// -------------------------------------------------------------

/**
 * تنسيق التاريخ والوقت بصيغة عربية واضحة ومقروءة
 */
export const formatScheduleDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    
    const dayName = days[d.getDay()];
    const dayNum = d.getDate();
    const monthName = months[d.getMonth()];
    
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12 || 12;
    
    return `${dayName} ${dayNum} ${monthName} - ${hours}:${minutes} ${ampm}`;
  } catch (e) {
    return dateStr || '';
  }
};

/**
 * استخراج الجدولة الفعلية المطبقة على فئة معينة من الطلاب (أونلاين أو سنتر)
 */
export const getEffectiveExamSchedule = (config: ExamConfig, category: 'online' | 'center' = 'online'): {
  scheduleMode: 'always' | 'scheduled';
  startDate?: string;
  endDate?: string;
  leaderboardPolicy: ExamLeaderboardPolicy;
  isTargeted: boolean;
} => {
  const target = config.targetAudience || 'all';
  
  if (target === 'custom') {
    const sched = category === 'online' ? config.onlineSchedule : config.centerSchedule;
    return {
      scheduleMode: sched?.scheduleMode || 'always',
      startDate: sched?.startDate,
      endDate: sched?.endDate,
      leaderboardPolicy: sched?.leaderboardPolicy || 'always',
      isTargeted: true,
    };
  }
  
  const isTargeted = target === 'all' || 
    (target === 'online_only' && category === 'online') || 
    (target === 'center_only' && category === 'center');
  
  return {
    scheduleMode: config.scheduleMode || 'always',
    startDate: config.startDate,
    endDate: config.endDate,
    leaderboardPolicy: config.leaderboardPolicy || 'always',
    isTargeted,
  };
};

export interface ExamAvailabilityResult {
  status: 'open' | 'upcoming' | 'expired' | 'not_targeted';
  badgeText: string;
  badgeColor: 'emerald' | 'amber' | 'rose' | 'gray';
  message: string;
  startDate?: string;
  endDate?: string;
  leaderboardPolicy: ExamLeaderboardPolicy;
  isScheduleActive: boolean;
}

/**
 * فحص حالة إتاحة الامتحان لحظياً لطالب من فئة معينة
 */
export const getExamAvailability = (
  config: ExamConfig, 
  category: 'online' | 'center' = 'online'
): ExamAvailabilityResult => {
  const eff = getEffectiveExamSchedule(config, category);
  
  if (!eff.isTargeted) {
    return {
      status: 'not_targeted',
      badgeText: category === 'online' ? 'مخصص للسنتر فقط 🏛️' : 'مخصص للأونلاين فقط 🌐',
      badgeColor: 'gray',
      message: 'هذا الامتحان غير مخصص لفئتك الدراسية حالياً.',
      leaderboardPolicy: eff.leaderboardPolicy,
      isScheduleActive: false,
    };
  }
  
  if (eff.scheduleMode !== 'scheduled') {
    return {
      status: 'open',
      badgeText: 'متاح دائماً 🟢',
      badgeColor: 'emerald',
      message: 'الامتحان متاح الآن للدخول في أي وقت.',
      leaderboardPolicy: eff.leaderboardPolicy,
      isScheduleActive: false,
    };
  }
  
  const now = new Date();
  
  // فحص تاريخ البدء
  if (eff.startDate) {
    const start = new Date(eff.startDate);
    if (!isNaN(start.getTime()) && now < start) {
      return {
        status: 'upcoming',
        badgeText: `يبدأ: ${formatScheduleDate(eff.startDate)} ⏳`,
        badgeColor: 'amber',
        message: `سيبدأ هذا الامتحان في: ${formatScheduleDate(eff.startDate)}`,
        startDate: eff.startDate,
        endDate: eff.endDate,
        leaderboardPolicy: eff.leaderboardPolicy,
        isScheduleActive: true,
      };
    }
  }
  
  // فحص تاريخ الانتهاء
  if (eff.endDate) {
    const end = new Date(eff.endDate);
    if (!isNaN(end.getTime()) && now > end) {
      return {
        status: 'expired',
        badgeText: 'منتهي ومغلق 🔒',
        badgeColor: 'rose',
        message: `انتهت فترة إتاحة هذا الامتحان في: ${formatScheduleDate(eff.endDate)} وتم إغلاقه.`,
        startDate: eff.startDate,
        endDate: eff.endDate,
        leaderboardPolicy: eff.leaderboardPolicy,
        isScheduleActive: true,
      };
    }
  }
  
  // إذا كان الآن داخل الفترة المحددة
  return {
    status: 'open',
    badgeText: eff.endDate ? `متاح حتى ${formatScheduleDate(eff.endDate)} ⏱️` : 'متاح الآن 🟢',
    badgeColor: 'emerald',
    message: eff.endDate ? `الامتحان متاح حالياً وينتهي في: ${formatScheduleDate(eff.endDate)}` : 'الامتحان متاح الآن للدخول.',
    startDate: eff.startDate,
    endDate: eff.endDate,
    leaderboardPolicy: eff.leaderboardPolicy,
    isScheduleActive: true,
  };
};

/**
 * فحص هل تُحتسب درجة الامتحان في لوحة الشرف
 */
export const isTestEligibleForLeaderboard = (
  config: ExamConfig,
  category: 'online' | 'center' = 'online',
  testDate?: string | number
): boolean => {
  const eff = getEffectiveExamSchedule(config, category);
  if (eff.leaderboardPolicy === 'never') return false;
  if (eff.leaderboardPolicy === 'always') return true;
  
  // سياسة 'within_schedule'
  if (eff.scheduleMode !== 'scheduled') return true;
  if (!testDate) return true;
  
  const t = new Date(testDate).getTime();
  if (isNaN(t)) return true;
  
  if (eff.startDate) {
    const s = new Date(eff.startDate).getTime();
    if (!isNaN(s) && t < s) return false;
  }
  
  if (eff.endDate) {
    const e = new Date(eff.endDate).getTime();
    if (!isNaN(e) && t > e) return false;
  }
  
  return true;
};

// -------------------------------------------------------------
// إدارة توجيهات وتنبيهات إعادة الاختبار (Retake Directives)
// -------------------------------------------------------------

const RETAKE_DIRECTIVES_STORAGE_KEY = "kanz_student_retake_directives";

export const getRetakeDirectives = (): StudentRetakeDirective[] => {
  try {
    const raw = localStorage.getItem(RETAKE_DIRECTIVES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

export const saveRetakeDirective = (directive: StudentRetakeDirective): void => {
  try {
    const all = getRetakeDirectives();
    const cleanPhone = directive.studentPhone.trim().replace(/[^\d]/g, '');
    const cleanTitle = (directive.lessonTitle || '').trim();
    // إزالة أي توجيه سابق لنفس الطالب ونفس الدرس
    const filtered = all.filter(item => {
      const itemPhone = (item.studentPhone || '').trim().replace(/[^\d]/g, '');
      const itemTitle = (item.lessonTitle || '').trim();
      return !(itemPhone === cleanPhone && itemTitle === cleanTitle);
    });
    filtered.unshift(directive);
    localStorage.setItem(RETAKE_DIRECTIVES_STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error("Error saving retake directive:", e);
  }
};

export const getStudentUnseenRetakeDirective = (studentPhone: string): StudentRetakeDirective | null => {
  if (!studentPhone) return null;
  const cleanPhone = studentPhone.trim().replace(/[^\d]/g, '');
  const all = getRetakeDirectives();
  return all.find(item => {
    const itemPhone = (item.studentPhone || '').trim().replace(/[^\d]/g, '');
    const matchesPhone = itemPhone === cleanPhone || (itemPhone.length >= 8 && cleanPhone.length >= 8 && (itemPhone.endsWith(cleanPhone) || cleanPhone.endsWith(itemPhone)));
    return !item.seen && matchesPhone;
  }) || null;
};

export const markRetakeDirectiveSeen = (directiveId: string): void => {
  try {
    const all = getRetakeDirectives();
    const updated = all.map(item => item.id === directiveId ? { ...item, seen: true } : item);
    localStorage.setItem(RETAKE_DIRECTIVES_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {}
};

export const getActiveRetakeDirectiveForLesson = (studentPhone: string, lessonIdOrTitle: string): StudentRetakeDirective | null => {
  if (!studentPhone || !lessonIdOrTitle) return null;
  const cleanPhone = studentPhone.trim().replace(/[^\d]/g, '');
  const cleanKey = lessonIdOrTitle.trim();
  const all = getRetakeDirectives();
  return all.find(item => {
    const itemPhone = (item.studentPhone || '').trim().replace(/[^\d]/g, '');
    const matchesPhone = itemPhone === cleanPhone || (itemPhone.length >= 8 && cleanPhone.length >= 8 && (itemPhone.endsWith(cleanPhone) || cleanPhone.endsWith(itemPhone)));
    if (!matchesPhone) return false;
    return item.lessonId === cleanKey || item.lessonTitle === cleanKey || item.lessonTitle.includes(cleanKey) || cleanKey.includes(item.lessonTitle);
  }) || null;
};

export const removeRetakeDirective = (directiveId: string): void => {
  try {
    const all = getRetakeDirectives();
    const filtered = all.filter(item => item.id !== directiveId);
    localStorage.setItem(RETAKE_DIRECTIVES_STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {}
};

/**
 * فحص هل قام الطالب بكتابة أي إجابة مقالية فعلية
 * (إذا كان كل المقالي فارغاً أو مسحوباً لمخالفات -> يعود false ليذهب مباشرة للاعتماد دون المرور بتصحيح المقالي)
 */
export const hasWrittenEssayAnswers = (sub: StudentEssaySubmission): boolean => {
  if (!sub || !Array.isArray(sub.questions)) return false;
  const essayQs = sub.questions.filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
  if (essayQs.length === 0) return false;
  
  return essayQs.some(q => 
    q.studentText && 
    q.studentText.trim() !== '' && 
    !q.studentText.includes('لم يتم الإجابة') && 
    !q.studentText.includes('سُحبت')
  );
};

/**
 * فحص هل إجابة الطالب تفتقر لترقيم وتنسيق الفقرات
 * (لإرشاد الطالب تربوياً بضرورة ترقيم إجابته لامتحانات الثانوية العامة)
 */
export const checkNeedsFormattingGuidance = (studentText: string): boolean => {
  if (!studentText || studentText.trim().length < 25) return false;
  const text = studentText.trim();
  // هل يحتوي النص على أرقام عناصر (1. أو 1- أو أولاً أو ثانياً أو تعداد نقطي)
  const hasNumbering = /[1-9١-٩][\.\-\)\:]|أولاً|ثانياً|ثالثاً|رابعاً|خامساً|\n[\s]*[\-\•\*\d]/.test(text);
  // هل مقسم لفقرات بأسطر واضحة
  const hasMultipleParagraphs = text.split('\n').filter(p => p.trim().length > 10).length >= 2;
  
  return !hasNumbering && !hasMultipleParagraphs;
};

const normTextHelper = (t: string): string => {
  if (!t) return '';
  return t
    .replace(/[«»"“”'`ـ\u0640\u064B-\u065F]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/[^\u0621-\u064A0-9a-zA-Z]/g, '')
    .toLowerCase()
    .trim();
};

/**
 * العثور على الدرس في المنهج بناءً على اسم الامتحان أو معرفه
 */
export const findLessonForQuizInUnits = (quizTitle: string, lessonId?: string, allData?: Unit[]): any => {
  if (!allData || !Array.isArray(allData)) return null;
  const cleanQTitle = (quizTitle || '').trim();
  const normQuizTitle = normTextHelper(cleanQTitle);

  for (const u of allData) {
    if (!u.lessons || !Array.isArray(u.lessons)) continue;
    const l = u.lessons.find(les => {
      if (lessonId && (les.id === lessonId || les.id.trim() === lessonId.trim())) return true;
      if (cleanQTitle && les.title.trim() === cleanQTitle) return true;
      if (normQuizTitle) {
        const normLTitle = normTextHelper(les.title);
        if (normLTitle === normQuizTitle || normLTitle.includes(normQuizTitle) || normQuizTitle.includes(normLTitle)) {
          return true;
        }
      }
      return false;
    });
    if (l) return l;
  }
  return null;
};

/**
 * إكمال الأسئلة المقالية والموضوعية للتسليم وربط درجات الاختبار بالكامل
 * يضمن ظهور كافة أسئلة الامتحان المقالية والموضوعية في شاشات التصحيح والاعتماد وحماية درجات الطلاب من التدني
 */
export const ensureCompleteEssayQuestions = (sub: StudentEssaySubmission, allData?: Unit[]): StudentEssaySubmission => {
  if (!sub) return sub;
  const lesson = findLessonForQuizInUnits(sub.quizTitle, sub.lessonId, allData);
  if (!lesson || !lesson.questions || !Array.isArray(lesson.questions)) {
    return sub;
  }

  const examCfg = getExamConfig(lesson.id);
  const structure = calculateExamStructure(lesson.questions, examCfg);
  const mcqMax = structure.mcqTotalScore + structure.tfTotalScore;
  const lessonEssayQs = lesson.questions.filter((q: any) => q.type === 'essay');
  const lessonObjectiveQs = lesson.questions.filter((q: any) => q.type !== 'essay');

  // دوال التحقق من نوع السؤال في المنهج الأصلي لاستبعاد الاختياري والصح/خطأ من المقالي
  const isLessonObjectiveQuestion = (text: string): boolean => {
    if (!text) return false;
    const clean = normTextHelper(text);
    return lessonObjectiveQs.some((lq: any) => {
      const normLq = normTextHelper(lq.q);
      return normLq === clean || (clean.length > 15 && (normLq.includes(clean) || clean.includes(normLq)));
    });
  };

  const isLessonEssayQuestion = (text: string): boolean => {
    if (!text) return false;
    const clean = normTextHelper(text);
    return lessonEssayQs.some((lq: any) => {
      const normLq = normTextHelper(lq.q);
      return normLq === clean || (clean.length > 15 && (normLq.includes(clean) || clean.includes(normLq)));
    });
  };

  let earnedFromObjectiveRows = 0;
  let hasExtractedObjectiveRows = false;
  const cleanedQuestions: EssayReviewQuestionItem[] = [];

  (sub.questions || []).forEach(q => {
    const isMcqSummary = q.qIndex === -1 || 
                         q.questionText.includes('الأسئلة الموضوعية') || 
                         q.questionText.includes('الاختياري والصح/خطأ');

    if (isMcqSummary) {
      cleanedQuestions.push(q);
      return;
    }

    // هل هذا السؤال هو في الأصل سؤال موضوعي (اختياري أو صح/خطأ) في المنهج؟
    if (isLessonObjectiveQuestion(q.questionText)) {
      hasExtractedObjectiveRows = true;
      const s = Number(q.teacherScore !== undefined ? q.teacherScore : (q.aiScore || 0));
      if (!isNaN(s) && s > 0) {
        earnedFromObjectiveRows += s;
      }
      // استبعاد السؤال من المقالي لأنه موضوعي
      return;
    }

    // هل هذا السؤال هو سؤال مقالي حقيقي في المنهج؟
    if (isLessonEssayQuestion(q.questionText)) {
      cleanedQuestions.push(q);
      return;
    }

    // إذا كان المنهج يحتوي على أسئلة مقالية ولم يطابق أي منها:
    if (lessonEssayQs.length > 0) {
      hasExtractedObjectiveRows = true;
      const s = Number(q.teacherScore !== undefined ? q.teacherScore : (q.aiScore || 0));
      if (!isNaN(s) && s > 0) earnedFromObjectiveRows += s;
      return;
    }

    cleanedQuestions.push(q);
  });

  // 1. فحص وضمان وجود عنصر ملخص الأسئلة الموضوعية (الاختياري والصح/خطأ)
  if (mcqMax > 0) {
    const existingMcqIdx = cleanedQuestions.findIndex(sq => 
      sq.qIndex === -1 || 
      sq.questionText.includes('الأسئلة الموضوعية') || 
      sq.questionText.includes('الاختياري والصح/خطأ')
    );

    if (existingMcqIdx === -1) {
      const existingEssayEarned = cleanedQuestions
        .filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ')
        .reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
      
      const inferredMcq = Math.max(0, Math.min(mcqMax, (sub.finalScore || 0) - existingEssayEarned));
      const finalMcqEarned = hasExtractedObjectiveRows ? Math.min(mcqMax, earnedFromObjectiveRows) : (inferredMcq > 0 ? inferredMcq : mcqMax);

      cleanedQuestions.unshift({
        qIndex: -1,
        questionText: 'الأسئلة الموضوعية (الاختياري والصح/خطأ)',
        essayType: 'اختر من متعدد',
        modelAnswer: `الدرجة العظمى: ${mcqMax}`,
        studentText: `حصل الطالب على ${finalMcqEarned} من أصل ${mcqMax}`,
        maxScore: mcqMax,
        teacherScore: finalMcqEarned,
        aiScore: finalMcqEarned,
        teacherFeedback: `نتيجة الأسئلة الموضوعية المرصودة آلياً: ${finalMcqEarned} / ${mcqMax}`,
        isApproved: true
      });
    } else {
      const mcqItem = cleanedQuestions[existingMcqIdx];
      mcqItem.essayType = 'اختر من متعدد';
      mcqItem.maxScore = mcqMax;
      
      let parsedEarned = 0;
      const match = (mcqItem.studentText || '').match(/حصل الطالب على\s*([\d.]+)/);
      if (match && match[1]) {
        parsedEarned = parseFloat(match[1]) || 0;
      }
      
      const bestScore = Math.min(mcqMax, Math.max(parsedEarned, earnedFromObjectiveRows, Number(mcqItem.teacherScore) || 0));
      mcqItem.teacherScore = bestScore;
      mcqItem.aiScore = bestScore;
      mcqItem.studentText = `حصل الطالب على ${bestScore} من أصل ${mcqMax}`;
    }
  }

  // 2. فحص وضمان اكتمال الأسئلة المقالية الحقيقية من المنهج
  lessonEssayQs.forEach((lq: any, lqi: number) => {
    const normLq = normTextHelper(lq.q);
    const existing = cleanedQuestions.find(sq => 
      sq.questionText.trim() === lq.q.trim() || 
      normTextHelper(sq.questionText) === normLq
    );

    if (!existing) {
      cleanedQuestions.push({
        qIndex: lqi,
        questionText: lq.q.trim(),
        essayType: lq.essayType || detectEssayType(lq.q).label,
        modelAnswer: lq.answer || lq.reason || (lq as any).modelAnswer || '',
        studentText: 'لم يتم الإجابة على هذا السؤال',
        maxScore: lq.maxScore || 2,
        teacherScore: 0,
        aiScore: 0,
        teacherFeedback: 'لم يتم الإجابة على هذا السؤال (0 من 2)',
        aiFeedback: 'لم يتم الإجابة على هذا السؤال (0 من 2)',
        isApproved: false
      });
    } else {
      if (!existing.modelAnswer || existing.modelAnswer.trim() === '') {
        existing.modelAnswer = lq.answer || lq.reason || (lq as any).modelAnswer || '';
      }
      if (lq.maxScore) existing.maxScore = lq.maxScore;
      if (lq.essayType) existing.essayType = lq.essayType;
    }
  });

  // حماية صارمة لمنع تضخم درجات المقالي عن الدرجة العظمى المحددة
  const essayQs = cleanedQuestions.filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
  const maxEssayPossible = structure ? structure.essayTotalScore : essayQs.reduce((sum, q) => sum + (q.maxScore || 2), 0);
  essayQs.forEach(q => {
    const qMax = q.maxScore || 2;
    if (q.teacherScore !== undefined && q.teacherScore > qMax) {
      q.teacherScore = qMax;
    }
  });

  const mcqQs = cleanedQuestions.filter(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
  const mcqEarned = mcqQs.reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
  const rawEssayEarned = essayQs.reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
  const essayEarned = Math.min(maxEssayPossible, rawEssayEarned);
  const earned = Math.min(structure ? structure.examTotalScore : (mcqEarned + essayEarned), mcqEarned + essayEarned);
  const totalMax = structure ? structure.examTotalScore : (sub.maxPossibleScore || 50);

  return {
    ...sub,
    questions: cleanedQuestions,
    finalScore: earned,
    maxPossibleScore: totalMax
  };
};

export interface SubScoresBreakdown {
  mcqEarned: number;
  mcqMax: number;
  essayEarned: number;
  essayMax: number;
  totalEarned: number;
  totalMax: number;
  perc: number;
}

/**
 * احتساب دقيق ومفصل لدرجات الطالب (موضوعي + مقالي + المجموع الكلي والنسبة)
 */
export const calculateSubScores = (sub: StudentEssaySubmission, data: Unit[] = []): SubScoresBreakdown => {
  const matchedLesson = data.flatMap(u => u.lessons).find(l => 
    l.id === sub.lessonId || l.title === sub.quizTitle || (sub.quizTitle && sub.quizTitle.includes(l.title))
  );
  const cfg = matchedLesson ? getExamConfig(matchedLesson.id) : null;
  const structure = matchedLesson ? calculateExamStructure(matchedLesson.questions, cfg) : null;

  const essayQs = (sub.questions || []).filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
  const mcqQs = (sub.questions || []).filter(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');

  const essayMax = structure ? structure.essayTotalScore : essayQs.reduce((sum, q) => sum + (q.maxScore || 2), 0);
  const mcqMax = structure ? (structure.mcqTotalScore + structure.tfTotalScore) : Math.max(0, (sub.maxPossibleScore || 50) - essayMax);

  // درجة المقالي
  const essayEarned = essayQs.reduce((sum, q) => {
    const sc = q.teacherScore !== undefined && q.teacherScore !== null ? Number(q.teacherScore) : (q.aiScore !== undefined ? Number(q.aiScore) : 0);
    return sum + (isNaN(sc) ? 0 : sc);
  }, 0);

  // درجة الموضوعي
  let mcqEarned = 0;
  const mcqSummary = (sub.questions || []).find(q => q.qIndex === -1 || q.questionText.includes('الأسئلة الموضوعية') || q.questionText.includes('الاختياري والصح/خطأ'));
  if (mcqSummary) {
    if (mcqSummary.teacherScore !== undefined && mcqSummary.teacherScore !== null && !isNaN(Number(mcqSummary.teacherScore))) {
      mcqEarned = Number(mcqSummary.teacherScore);
    } else if (mcqSummary.aiScore !== undefined && !isNaN(Number(mcqSummary.aiScore))) {
      mcqEarned = Number(mcqSummary.aiScore);
    } else {
      const match = (mcqSummary.studentText || '').match(/حصل الطالب على\s*([\d.]+)/);
      if (match && match[1]) {
        mcqEarned = parseFloat(match[1]);
      }
    }
  } else if (mcqQs.length > 0) {
    mcqEarned = mcqQs.reduce((sum, q) => {
      const sc = q.teacherScore !== undefined && q.teacherScore !== null ? Number(q.teacherScore) : (q.aiScore !== undefined ? Number(q.aiScore) : 0);
      return sum + (isNaN(sc) ? 0 : sc);
    }, 0);
  } else if (sub.finalScore !== undefined && sub.finalScore > 0) {
    mcqEarned = Math.max(0, sub.finalScore - essayEarned);
  }

  if (mcqMax > 0) mcqEarned = Math.min(mcqMax, mcqEarned);

  const totalEarned = Math.round((mcqEarned + essayEarned) * 100) / 100;
  const totalMax = structure ? structure.examTotalScore : (mcqMax + essayMax) || sub.maxPossibleScore || 50;
  const perc = totalMax > 0 ? Math.min(100, Math.round((totalEarned / totalMax) * 100)) : 0;

  return {
    mcqEarned,
    mcqMax,
    essayEarned,
    essayMax,
    totalEarned,
    totalMax,
    perc
  };
};


