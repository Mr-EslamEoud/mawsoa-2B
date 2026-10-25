import { Question, ExamConfig, GlobalExamConfig, DialectPolicy, StudentEssaySubmission, EssayReviewQuestionItem, ExamLeaderboardPolicy, ExamScheduleTarget, ExamAudienceSchedule } from "./types";
export { type DialectPolicy, type GlobalExamConfig, type ExamLeaderboardPolicy, type ExamScheduleTarget, type ExamAudienceSchedule };

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
  } catch (e) {
    console.error("Error saving pending essay submission:", e);
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

