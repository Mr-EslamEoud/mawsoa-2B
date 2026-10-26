import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Unit, 
  Lesson, 
  Question, 
  Student, 
  UserAnswer, 
  PendingRequest, 
  OnlineStudent,
  GroupedResult, 
  InteractiveMap,
  TestResult,
  ExamConfig,
  ExamSecuritySettings
} from './types';
import { 
  API_URL, 
  SECRET_API_KEY, 
  OFFICIAL_APP_URL,
  BASE_STUDENTS, 
  PAYMENT_INFO,
  subjectName, 
  gradeName, 
  simpleHash, 
  verifyStaffPassword,
  toEasternArabic, 
  formatPhoneStr, 
  detectArabicGender,
  normalizeScore,
  generateDeviceFingerprint, 
  getDirectAudioLink, 
  getYoutubeEmbedLink,
  getDirectPdfLink,
  getPdfViewerLink,
  downloadWatermarkedPdf,
  checkAnswerAccurately
} from './utils';
import { buildCourseData, FlatQuestionRow } from './courseBuilder';
import defaultQuestionsData from './defaultQuestions.json';
import { HighlightText } from './components/HighlightText';
import { FormatQuestionText } from './components/FormatQuestionText';
import { DrawingCanvas } from './components/DrawingCanvas';
import { ExamSettingsModal } from './components/ExamSettingsModal';
import { LessonPdfManagerModal } from './components/LessonPdfManagerModal';
import { StudentAnalyticsModal } from './components/StudentAnalyticsModal';
import { TeacherExamSandboxModal } from './components/TeacherExamSandboxModal';
import { AdminEssayReviewTab } from './components/AdminEssayReviewTab';
import { AdminExamScheduleTab } from './components/AdminExamScheduleTab';
import { StudentApprovedEssayModal } from './components/StudentApprovedEssayModal';
import { StudentEssayListModal } from './components/StudentEssayListModal';
import { MistakesNotebookModal } from './components/MistakesNotebookModal';
import { FaithPrayerModal } from './components/FaithPrayerModal';
import { FaithFloatingToast } from './components/FaithFloatingToast';
import { getGeminiApiKey, setGeminiApiKey, evaluateEssayAnswer } from './aiEvaluationService';
import { 
  getExamConfig, 
  getAllExamConfigs,
  syncExamConfigsFromCloud,
  getQuestionMaxScore, 
  detectEssayType, 
  savePendingEssaySubmission, 
  getPendingEssaySubmissions,
  calculateExamStructure,
  getStudentSubmissions,
  getUnseenApprovedSubmissions,
  markSubmissionNotificationSeen,
  getExamAvailability,
  formatScheduleDate,
  isTestEligibleForLeaderboard
} from './examConfigUtils';
import { StudentEssaySubmission, PermanentMistakeItem } from './types';
import { usePWA } from './usePWA';


const normalizeLessonName = (s: string) => {
    if (!s) return '';
    return s.replace(/[أإآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\u0600-\u06FF0-9a-zA-Z]/g, '');
};

const getCoreWords = (s: string) => s.split(/[\s:،-]+/).map(w => normalizeLessonName(w)).filter(w => w.length > 2 && !['درس', 'وحده', 'علي', 'الي', 'عن', 'مراجعة', 'مراجعه', 'عامة', 'عامه', 'شاملة', 'شامله', 'تدريبات', 'اختبار', 'امتحان'].includes(w));

const matchQuizToCurrent = (q: string, validLessons: string[]) => {
    const normQ = normalizeLessonName(q);
    const exact = validLessons.find(t => normalizeLessonName(t) === normQ);
    if (exact) return exact;

    const reqKeywords = ['زراع', 'رع', 'تعدين', 'صناع', 'يولي', 'فلسطين', 'كتوبر', 'صراع', 'يناير'];

    const qWords = getCoreWords(q);
    let bestMatch = '';
    let maxScore = 0;
    
    for (const t of validLessons) {
        const tWords = getCoreWords(t);
        const overlap = qWords.filter(qw => tWords.includes(qw)).length;
        
        let score = overlap * 2;
        
        for (const kw of reqKeywords) {
            const normKw = normalizeLessonName(kw);
            if (normQ.includes(normKw) && normalizeLessonName(t).includes(normKw)) {
                score += 5;
            }
        }
        
        if (normalizeLessonName(t).includes(normQ) || normQ.includes(normalizeLessonName(t))) {
            score += 10;
        }

        if (score > maxScore && score >= 3) {
            maxScore = score;
            bestMatch = t;
        }
    }
    return bestMatch || null;
};

// دالة للتعرف على المسميات القديمة والعامة لتجاهلها وإجبار الطلاب على إعادة حلها بالمسمى الجديد
const isAmbiguousOldQuiz = (qRaw: string | number): boolean => {
  if (!qRaw) return false;
  const q = normalizeLessonName(String(qRaw));
  const ambiguous = [
    'وحدة عامة',
    'درس عام',
    'المراجعة العامة للوحدة',
    'المراجعة العامة',
    'المراجعة العامة على الوحدة',
    'المراجعة العامة علي الوحدة',
    'المراجعة الشاملة',
    'المراجعة الشاملة للوحدة',
    'المراجعة الشاملة على الوحدة',
    'تدريبات علي الوحدة',
    'تدريبات على الوحدة',
    'تدريبات الوحدة',
    'مراجعة الوحدة',
    'اختبار الوحدة',
    'امتحان الوحدة',
    'امتحان شامل',
    'امتحان شامل على الوحدة',
    'امتحان شامل للوحدة'
  ].map(normalizeLessonName);
  return ambiguous.includes(q);
};

// دوال لخلط الأسئلة والإجابات بطريقة عشوائية
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const shuffleOptions = (options: string[]): string[] => {
  const shuffled = shuffleArray(options);
  const keepAtEnd = ['كل ما سبق', 'جميع ما سبق', 'لا شيء مما سبق', 'أ و ب', 'ا و ب', 'أ و ج', 'ا و ج', 'ب و ج', 'الأولى والثانية', 'الاولى والثانية', 'الأولى والثالثة', 'الاولى والثالثة', 'الثانية والثالثة', 'مما سبق', 'معاً', 'معا'];
  return shuffled.sort((a, b) => {
    const aIsEnd = keepAtEnd.some(phrase => a.includes(phrase));
    const bIsEnd = keepAtEnd.some(phrase => b.includes(phrase));
    if (aIsEnd && !bIsEnd) return 1;
    if (!aIsEnd && bIsEnd) return -1;
    return 0;
  });
};

export default function App() {
  const [screen, setScreen] = useState<string>('home');
  const [studentName, setStudentName] = useState<string>('');
  const [inputPhone, setInputPhone] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerQuestionIndexRef = useRef<number>(-1);
  const [timerMode, setTimerMode] = useState<string>(() => localStorage.getItem('timerMode') || 'custom_units');
  const [timerUnitTargets, setTimerUnitTargets] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('timerUnitTargets');
      if (saved) return JSON.parse(saved);
      const oldSaved = localStorage.getItem('timerUnitTarget');
      if (oldSaved) return [oldSaved];
    } catch(e) {}
    return [];
  });
  const [timerSecondsPerQ, setTimerSecondsPerQ] = useState<number>(() => {
    const saved = localStorage.getItem('timerSecondsPerQ');
    return saved ? Number(saved) : 60;
  });
  const [timerType, setTimerType] = useState<string>(() => localStorage.getItem('timerType') || 'per_question');
  const [examTotalMinutes, setExamTotalMinutes] = useState<number>(() => {
    const saved = localStorage.getItem('examTotalMinutes');
    return saved ? Number(saved) : 50;
  });
  const [examTimeLeft, setExamTimeLeft] = useState<number | null>(null);
  const examEndTimeRef = useRef<number | null>(null);
  const [publishedLessons, setPublishedLessons] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('publishedLessons');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return [];
  });
  const [isSavingLessons, setIsSavingLessons] = useState<boolean>(false);
  const [isSyncingExamConfigs, setIsSyncingExamConfigs] = useState<boolean>(false);
  const [isReviewMode, setIsReviewMode] = useState<boolean>(false);
  const [isPracticeMode, setIsPracticeMode] = useState<boolean>(false);
  const [showPasswordInput, setShowPasswordInput] = useState<boolean>(false);
  const [inputPassword, setInputPassword] = useState<string>('');
  const [selectedTwin, setSelectedTwin] = useState<Student | null>(null);
  
  const [showRegisterModal, setShowRegisterModal] = useState<boolean>(false);
  const [showWelcomeSubscribeModal, setShowWelcomeSubscribeModal] = useState<boolean>(false);
  const [registerName, setRegisterName] = useState<string>('');
  const [registerMethod, setRegisterNameMethod] = useState<string>('');
  
  const [platformFee, setPlatformFee] = useState<string>(PAYMENT_INFO.fee);
  const [newFeeInput, setNewFeeInput] = useState<string>('');
  const [selectedPackage, setSelectedPackage] = useState<'شهري' | 'ترم أول' | 'ترم ثانٍ' | 'سنة كاملة'>('شهري');
  const [packagePrices, setPackagePrices] = useState<{ monthly: string; term1: string; term2: string; fullYear: string }>(() => {
    try {
      const saved = localStorage.getItem('packagePrices');
      if (saved) return JSON.parse(saved);
      const savedFee = localStorage.getItem('platformFee');
      if (savedFee) {
        if (savedFee.startsWith('{')) return JSON.parse(savedFee);
        const num = parseInt(savedFee.replace(/[^\d]/g, '') || '50', 10);
        return {
          monthly: String(num || 50),
          term1: String((num || 50) * 3),
          term2: String((num || 50) * 3),
          fullYear: String((num || 50) * 5),
        };
      }
    } catch(e) {}
    return { monthly: '50', term1: '150', term2: '150', fullYear: '250' };
  });
  const [editPrices, setEditPrices] = useState(packagePrices);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string>('');
  const [studentData, setStudentData] = useState<Student | null>(null);
  
  const [showUnpaidModal, setShowUnpaidModal] = useState<boolean>(false);
  const [unpaidPaymentMethod, setUnpaidPaymentMethod] = useState<string>('');
  const [showGraceModal, setShowGraceModal] = useState<boolean>(false);
  const [pendingGraceLogin, setPendingGraceLogin] = useState<(() => Promise<void>) | null>(null);
  
  const [adminResults, setAdminResults] = useState<GroupedResult[]>([]);
  const [adminPendingReqs, setAdminPendingReqs] = useState<PendingRequest[]>([]);
  const [selectedActivationReq, setSelectedActivationReq] = useState<PendingRequest | null>(null);
  const [activationPackage, setActivationPackage] = useState<'شهري' | 'ترم أول' | 'ترم ثانٍ' | 'سنة كاملة'>('شهري');
  const [activationMonth, setActivationMonth] = useState<string>('أكتوبر');
  const [activationAmount, setActivationAmount] = useState<string>('50');
  const [activationSuccess, setActivationSuccess] = useState<{ code: string; name: string; phone: string; packageType: string } | null>(null);
  const [showManualOnlineModal, setShowManualOnlineModal] = useState<boolean>(false);
  const [manualOnlineName, setManualOnlineName] = useState<string>('');
  const [manualOnlinePhone, setManualOnlinePhone] = useState<string>('');
  const [manualOnlineMethod, setManualOnlineMethod] = useState<string>('فودافون كاش');
  const [isActivatingOnline, setIsActivatingOnline] = useState<boolean>(false);
  const [adminOnlineStudents, setAdminOnlineStudents] = useState<OnlineStudent[]>([]);
  const [adminArchivedOnlineStudents, setAdminArchivedOnlineStudents] = useState<OnlineStudent[]>([]);
  const [onlineSubTab, setOnlineSubTab] = useState<'active' | 'pending' | 'archive'>('active');
  const [onlineSearchTerm, setOnlineSearchTerm] = useState<string>('');
  const [copiedCodePhone, setCopiedCodePhone] = useState<string>('');

  // مودال تجديد باقة الأونلاين
  const [selectedOnlineForRenewal, setSelectedOnlineForRenewal] = useState<OnlineStudent | null>(null);
  const [renewalPackage, setRenewalPackage] = useState<'شهري' | 'ترم أول' | 'ترم ثانٍ' | 'سنة كاملة'>('شهري');
  const [renewalMonth, setRenewalMonth] = useState<string>('نوفمبر');
  const [renewalAmount, setRenewalAmount] = useState<string>('50');
  const [isRenewingOnline, setIsRenewingOnline] = useState<boolean>(false);

  // مودال تعديل بيانات طالب الأونلاين
  const [selectedOnlineForEdit, setSelectedOnlineForEdit] = useState<OnlineStudent | null>(null);
  const [editOnlineName, setEditOnlineName] = useState<string>('');
  const [editOnlinePhone, setEditOnlinePhone] = useState<string>('');
  const [editOnlinePackage, setEditOnlinePackage] = useState<string>('');
  const [editOnlineAmount, setEditOnlineAmount] = useState<string>('');
  const [isEditingOnline, setIsEditingOnline] = useState<boolean>(false);

  // فلاتر صفحة النتائج والمتابعة
  const [resultsStudentTypeFilter, setResultsStudentTypeFilter] = useState<'all' | 'center' | 'online'>('all');
  const [resultsGenderFilter, setResultsGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [resultsUnitFilter, setResultsUnitFilter] = useState<string>('all');
  const [resultsLessonFilter, setResultsLessonFilter] = useState<string>('all');
  const [selectedStudentForAnalytics, setSelectedStudentForAnalytics] = useState<GroupedResult | null>(null);

  const [adminActiveTab, setAdminActiveTab] = useState<string>('results');
  const [settingsSubTab, setSettingsSubTab] = useState<'prices' | 'announcement' | 'timer' | 'ai' | 'buttons' | 'certificates_config' | 'security' | 'all'>('prices');
  const [adminSort, setAdminSort] = useState<'alpha' | 'most' | 'least' | 'none' | 'blocked'>('alpha');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [resultsSearchQuery, setResultsSearchQuery] = useState<string>('');
  const [expandedAdminStudent, setExpandedAdminStudent] = useState<string | null>(null);
  const [adminSelectedUnit, setAdminSelectedUnit] = useState<string>('all');
  
  // إعدادات الشهادات وإتمام الوحدات والامتحانات الشاملة
  const [certSettings, setCertSettings] = useState<{
    enableLessonCerts: boolean;
    enableUnitCerts: boolean;
    enableComprehensiveCerts: boolean;
    minCertScore: number;
    unitExpectedLessons: Record<string, number>;
    unitCompletedStatus: Record<string, boolean>;
    comprehensiveExamsConfig: Record<string, { isComprehensive: boolean; coveredUnits: string[]; customTitle?: string }>;
  }>(() => {
    try {
      const saved = localStorage.getItem('app_cert_settings');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return {
      enableLessonCerts: true,
      enableUnitCerts: true,
      enableComprehensiveCerts: true,
      minCertScore: 90,
      unitExpectedLessons: {},
      unitCompletedStatus: {},
      comprehensiveExamsConfig: {}
    };
  });

  // إعدادات الأمان ومكافحة الغش (منع لقطة الشاشة، العلامة المائية، وضع الإغلاق، قطع النت)
  const [securitySettings, setSecuritySettings] = useState<ExamSecuritySettings>(() => {
    try {
      const saved = localStorage.getItem('app_exam_security_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.maxTabSwitchStrikes === 2 || parsed.maxTabSwitchStrikes === 3) {
          parsed.maxTabSwitchStrikes = 6;
        }
        return parsed;
      }
    } catch(e) {}
    return {
      preventScreenshot: true,
      watermarkEnabled: true,
      lockdownEnabled: true,
      maxTabSwitchStrikes: 6,
      offlineModeEnabled: false,
    };
  });

  // حالات وحواجز أمان شاشة الاختبار
  const [isScreenObfuscated, setIsScreenObfuscated] = useState<boolean>(false);
  const [tabSwitchStrikes, setTabSwitchStrikes] = useState<number>(0);
  const tabSwitchStrikesRef = useRef<number>(0);
  const lastStrikeTimestampRef = useRef<number>(0);
  const [tabSwitchWarningModal, setTabSwitchWarningModal] = useState<{ open: boolean; strikes: number; max: number } | null>(null);
  const [offlineGateStatus, setOfflineGateStatus] = useState<'none' | 'require_offline_to_start' | 'require_online_to_submit'>('none');

  // بيانات الشهادة المفتوحة للطالب حالياً
  const [certModalData, setCertModalData] = useState<{
    type: 'lesson' | 'unit' | 'comprehensive';
    title: string;
    score: number;
  } | null>(null);
  
  // تنسيق نتائج الطلاب بالوحدات والدروس المنسدلة
  const [adminResultViewMode, setAdminResultViewMode] = useState<'units' | 'timeline'>('units');
  const [studentActiveUnitFilter, setStudentActiveUnitFilter] = useState<Record<string, string>>({});
  const [expandedLessonAttempts, setExpandedLessonAttempts] = useState<Record<string, boolean>>({});
  const [expandedResetLogs, setExpandedResetLogs] = useState<Record<string, boolean>>({});
  const [showAdminScrollTop, setShowAdminScrollTop] = useState<boolean>(false);
  const adminScrollRef = useRef<HTMLDivElement>(null);
  const [selectedExamForConfig, setSelectedExamForConfig] = useState<{ lesson: Lesson; unitTitle: string } | null>(null);
  const [selectedLessonForPdf, setSelectedLessonForPdf] = useState<{ lesson: Lesson; unitTitle: string } | null>(null);

  // حالات الأدعية الإيمانية (البدء والختام)
  const [showOpeningPrayer, setShowOpeningPrayer] = useState<boolean>(false);
  const [showClosingPrayer, setShowClosingPrayer] = useState<boolean>(false);
  const [closingPrayerIsLogout, setClosingPrayerIsLogout] = useState<boolean>(false);

  // إظهار دعاء البدء تلقائياً عند الدخول لشاشة الفهرس مرة واحدة في الجلسة
  useEffect(() => {
    if (screen === 'index') {
      const hasSeen = sessionStorage.getItem('seen_opening_prayer');
      if (!hasSeen) {
        setShowOpeningPrayer(true);
      }
    }
  }, [screen]);
  const [sandboxExam, setSandboxExam] = useState<{ lesson: Lesson; config: ExamConfig } | null>(null);
  
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>(() => getGeminiApiKey());
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const handleTestGeminiKey = async () => {
    if (!geminiKeyInput.trim()) return;
    setIsTestingKey(true);
    setGeminiKeyStatus(null);
    try {
      // فحص المفتاح عبر استعلام قائمة النماذج (أدق وأشمل طريقة للتحقق من صلاحية المفتاح وحالته)
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKeyInput.trim()}`);
      const data = await res.json();
      
      if (res.ok && data.models && data.models.length > 0) {
        setGeminiKeyStatus({ type: 'success', msg: '✅ متصل بنجاح بسيرفرات Google Gemini (المفتاح سليم ونشط)' });
        setGeminiApiKey(geminiKeyInput.trim());
      } else {
        const errMsg = data.error?.message || '';
        const isLeaked = errMsg.toLowerCase().includes('leak');
        const isInvalid = errMsg.toLowerCase().includes('not valid') || errMsg.toLowerCase().includes('api_key_invalid');
        
        if (isLeaked) {
          setGeminiKeyStatus({ 
            type: 'error', 
            msg: '❌ المفتاح ملغي من جوجل بسبب تسريبه (يرجى إنشاء مفتاح جديد)' 
          });
        } else if (isInvalid) {
          setGeminiKeyStatus({ 
            type: 'error', 
            msg: '❌ المفتاح غير صالح (تأكد من نسخه بدقة)' 
          });
        } else {
          setGeminiKeyStatus({ 
            type: 'error', 
            msg: isLeaked ? '❌ المفتاح ملغي من جوجل' : `❌ تعذر التحقق: ${errMsg.slice(0, 45) || 'خطأ غير معروف'}` 
          });
        }
      }
    } catch (e) {
      setGeminiKeyStatus({ type: 'error', msg: '❌ خطأ في الاتصال بالإنترنت' });
    } finally {
      setIsTestingKey(false);
    }
  };
  
  const pendingEssayCount = useMemo(() => {
    try {
      return getPendingEssaySubmissions().filter(s => !s.isFullyApproved).length;
    } catch(e) {
      return 0;
    }
  }, [adminActiveTab]);

  // حالة الإشعارات والنتائج المقالية المعتمدة للطلاب
  const [approvedSubForModal, setApprovedSubForModal] = useState<StudentEssaySubmission | null>(null);
  const [showStudentEssayListModal, setShowStudentEssayListModal] = useState<boolean>(false);
  const [showMistakesNotebookModal, setShowMistakesNotebookModal] = useState<boolean>(false);

  // إعدادات ظهور أزرار المنصة للطلاب (تحكم الإدارة)
  const [showMistakesNotebookSetting, setShowMistakesNotebookSetting] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('kanz_show_mistakes_notebook');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });

  const [showResetButtonSetting, setShowResetButtonSetting] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('kanz_show_reset_button');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });



  // إرسال ومزامنة تسليمات المقالي سحابياً مع شيت جوجل (مع طابور إعادة المحاولة التلقائي عند انقطاع النت)
  const syncEssaySubmissionToCloud = async (sub: StudentEssaySubmission) => {
    try {
      const isOnline = (studentData?.code && studentData.code.includes('ESON')) || (studentData as any)?.gender === 'أونلاين' || sub.studentType === 'أونلاين';
      const cleanPhone = formatPhoneStr(sub.studentPhone || inputPhone || '');
      const fullPhone = cleanPhone.startsWith('0') ? '+20' + cleanPhone.substring(1) : cleanPhone;
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'saveEssaySubmission',
          date: new Date().toLocaleString('ar-EG'),
          studentName: sub.studentName || studentName || 'طالب',
          studentPhone: fullPhone,
          quizTitle: sub.quizTitle,
          questions: sub.questions,
          isApproved: sub.isFullyApproved,
          studentType: isOnline ? 'أونلاين' : 'سنتر',
          apiKey: SECRET_API_KEY
        })
      });
      if (!res.ok) throw new Error('Network error');
      const resData = await res.json();
      if (resData.status !== 'success') throw new Error('Server error');
    } catch (e) {
      console.warn("Cloud essay sync failed, queued for offline auto-sync:", e);
      try {
        const offlineEssays: any[] = JSON.parse(localStorage.getItem('offlineEssaySubmissions') || '[]');
        const exists = offlineEssays.some((item: any) => item.id === sub.id || (item.studentPhone === sub.studentPhone && item.quizTitle === sub.quizTitle));
        if (!exists) {
          offlineEssays.push(sub);
          localStorage.setItem('offlineEssaySubmissions', JSON.stringify(offlineEssays));
        }
      } catch (storageErr) {}
    }
  };

  // الإملاء الصوتي للإجابة المقالية (Speech-to-Text)
  const [isListeningSpeech, setIsListeningSpeech] = useState<boolean>(false);
  const speechRecognitionRef = useRef<any>(null);

  const toggleSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showAlert('خاصية الإملاء الصوتي غير مدعومة في هذا المتصفح. يرجى استخدام متصفح Google Chrome.');
      return;
    }

    if (isListeningSpeech) {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch(e) {}
      }
      setIsListeningSpeech(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ar-EG';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListeningSpeech(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
        if (transcript.trim()) {
          setUserAnswers(prev => {
            const next = [...prev];
            const currentAns = next[currentQIndex];
            const currentText = currentAns?.studentAnswerText || '';
            const updatedText = currentText ? `${currentText.trim()} ${transcript.trim()}` : transcript.trim();
            next[currentQIndex] = {
              ...(currentAns || {}),
              isCorrect: false,
              selected: updatedText,
              studentAnswerText: updatedText,
              type: 'essay',
              status: 'pending'
            };
            return next;
          });
        }
      };

      recognition.onerror = () => {
        setIsListeningSpeech(false);
      };

      recognition.onend = () => {
        setIsListeningSpeech(false);
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error("Speech recognition error:", e);
      setIsListeningSpeech(false);
    }
  };

  const currentStudentSubmissions = useMemo(() => {
    const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
    return getStudentSubmissions(phone);
  }, [inputPhone, screen, studentData]);

  const handleCloseApprovedEssayModal = () => {
    if (approvedSubForModal) {
      markSubmissionNotificationSeen(approvedSubForModal.id);
    }
    setApprovedSubForModal(null);
  };

  // فحص وجود نتائج مقالية معتمدة جديدة لإشعار الطالب فوراً
  useEffect(() => {
    const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
    if (phone && screen !== 'quiz' && screen !== 'admin') {
      const unseen = getUnseenApprovedSubmissions(phone);
      if (unseen.length > 0 && !approvedSubForModal) {
        setApprovedSubForModal(unseen[0]);
      }
    }
  }, [screen, inputPhone, studentData]);
  
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [data, setData] = useState<Unit[]>(() => {
    try {
      const cachedStr = localStorage.getItem('cachedQuestionsData');
      const raw = cachedStr ? JSON.parse(cachedStr) : defaultQuestionsData;
      return buildCourseData(raw as FlatQuestionRow[]);
    } catch(e) {
      return buildCourseData(defaultQuestionsData as FlatQuestionRow[]);
    }
  }); 

  const isLessonActive = (lessonId: string) => {
    if (publishedLessons.length === 0 && localStorage.getItem('publishedLessons_init') !== 'true') return true;
    return publishedLessons.includes(lessonId);
  };

  const studentUnits = useMemo(() => {
    return data.map(unit => ({
      ...unit,
      lessons: unit.lessons.filter(l => isLessonActive(l.id))
    })).filter(unit => unit.lessons.length > 0);
  }, [data, publishedLessons]); 

  const lessonStats = useMemo(() => {
    let total = 0;
    let published = 0;
    data.forEach(u => {
      u.lessons.forEach(l => {
        total++;
        if (isLessonActive(l.id)) published++;
      });
    });
    return {
      total,
      published,
      hidden: total - published,
      unitsCount: data.length
    };
  }, [data, publishedLessons]); 
  const [currentQIndex, setCurrentQIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [feedbackToast, setFeedbackToast] = useState<{ isCorrect: boolean; message: string } | null>(null);
  const [essaySubmissionModal, setEssaySubmissionModal] = useState<{
    isOpen: boolean;
    isGrading: boolean;
    message: string;
    quizTitle: string;
  } | null>(null);
  const [unansweredWarningModal, setUnansweredWarningModal] = useState<{
    count: number;
    firstUnansweredIndex: number;
  } | null>(null);
  const [preSubmitReviewModalOpen, setPreSubmitReviewModalOpen] = useState<boolean>(false);
  const [preSubmitFilter, setPreSubmitFilter] = useState<'all' | 'mcq' | 'tf' | 'essay' | 'unanswered'>('all');
  const [skippedQuestions, setSkippedQuestions] = useState<number[]>([]);
  const [showSkippedModal, setShowSkippedModal] = useState<boolean>(false);
  const [expandedUnits, setExpandedUnits] = useState<string[]>([]);
  const [adminExpandedUnits, setAdminExpandedUnits] = useState<string[]>([]);
  const [adminResultsLimit, setAdminResultsLimit] = useState<number>(40);
  const [studentsList, setStudentsList] = useState<Record<string, Student | Student[]>>({});
  const [isSyncingDrive, setIsSyncingDrive] = useState<boolean>(false);
  const [isSyncingLocal, setIsSyncingLocal] = useState<boolean>(false);
  
  const [revealedBlockStudents, setRevealedBlockStudents] = useState<string[]>([]);
  const studentClickData = useRef<Record<string, { count: number, time: number }>>({});

  const [isDesktop, setIsDesktop] = useState<boolean>(window.innerWidth >= 768);
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const [lessonModalOptions, setLessonModalOptions] = useState<Lesson | null>(null);

  // إحصائيات مراجعة الاختبار قبل التسليم
  const examReviewStats = useMemo(() => {
    if (!activeLesson || !activeLesson.questions) {
      return { total: 0, answered: 0, unanswered: 0, mcq: 0, tf: 0, essay: 0 };
    }
    let answered = 0;
    let unanswered = 0;
    let mcq = 0;
    let tf = 0;
    let essay = 0;

    activeLesson.questions.forEach((q, idx) => {
      const isEssay = q.type === 'essay';
      const isTf = q.type === 'tf' || q.type === 't/f' || q.type === 'true_false' || 
                   (Array.isArray(q.options) && q.options.length === 2 && (q.options.includes('صح') || q.options.includes('خطأ')));
      if (isEssay) essay++;
      else if (isTf) tf++;
      else mcq++;

      const ans = userAnswers[idx];
      const hasAns = ans && (
        isEssay 
          ? Boolean(ans.studentAnswerText && ans.studentAnswerText.trim().length > 0)
          : Boolean(ans.selected && ans.selected.trim().length > 0)
      );

      if (hasAns) answered++;
      else unanswered++;
    });

    return { total: activeLesson.questions.length, answered, unanswered, mcq, tf, essay };
  }, [activeLesson, userAnswers]);

  // قائمة الأسئلة المفلترة للمراجعة قبل التسليم
  const filteredReviewQuestions = useMemo(() => {
    if (!activeLesson || !activeLesson.questions) return [];
    return activeLesson.questions.map((q, idx) => {
      const isEssay = q.type === 'essay';
      const isTf = q.type === 'tf' || q.type === 't/f' || q.type === 'true_false' || 
                   (Array.isArray(q.options) && q.options.length === 2 && (q.options.includes('صح') || q.options.includes('خطأ')));
      const category: 'mcq' | 'tf' | 'essay' = isEssay ? 'essay' : (isTf ? 'tf' : 'mcq');
      const ans = userAnswers[idx];
      const hasAns = ans && (
        isEssay 
          ? Boolean(ans.studentAnswerText && ans.studentAnswerText.trim().length > 0)
          : Boolean(ans.selected && ans.selected.trim().length > 0)
      );
      const answerText = isEssay ? (ans?.studentAnswerText || '') : (ans?.selected || '');
      return {
        q,
        idx,
        category,
        hasAns,
        answerText
      };
    }).filter(item => {
      if (preSubmitFilter === 'all') return true;
      if (preSubmitFilter === 'unanswered') return !item.hasAns;
      return item.category === preSubmitFilter;
    });
  }, [activeLesson, userAnswers, preSubmitFilter]);
  
  const isLessonTimerActive = (lessonTitle?: string, lessonId?: string): boolean => {
    if (timerMode === 'disabled') return false;
    if (timerMode === 'all') return true;
    if (timerMode === 'custom_units' || timerMode === 'unit') {
      return data.some(u => timerUnitTargets.includes(u.id) && u.lessons.some(l => l.id === lessonId));
    }
    if (timerMode === 'custom_lessons') {
      return !!lessonId && timerUnitTargets.includes(lessonId);
    }
    if (timerMode === 'comprehensive') {
      return !!lessonTitle && (lessonTitle.includes('شامل') || lessonTitle.includes('امتحان') || lessonTitle.includes('نهائية'));
    }
    return false;
  };

  const getInitialTimeLeft = (lessonTitle: string, lessonId: string, _questionsCount?: number) => {
    return isLessonTimerActive(lessonTitle, lessonId) ? timerSecondsPerQ : null;
  };

  // Gamification XP & Levels State
  const [lessonScores, setLessonScores] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('lessonScores');
      return saved ? JSON.parse(saved) : {};
    } catch(e) { return {}; }
  });
  const totalXP = useMemo(() => Object.values(lessonScores).reduce((acc, curr) => acc + (curr * 10), 0), [lessonScores]);
  const getUserLevel = (xp: number) => {
    if (xp < 100) return { title: 'طالب مبتدئ', icon: '🥉' };
    if (xp < 300) return { title: 'باحث طموح', icon: '🥈' };
    if (xp < 600) return { title: 'بطل التاريخ', icon: '🥇' };
    if (xp < 1000) return { title: 'عبقري التاريخ', icon: '🏅' };
    return { title: 'أسطورة الكنز', icon: '👑' };
  };
  const levelInfo = getUserLevel(totalXP);

  // Daily Streak State
  const [streak, setStreak] = useState<{count: number, lastDate: string}>(() => {
    try {
      const saved = localStorage.getItem('userStreak');
      if (saved) {
        const parsed = JSON.parse(saved);
        const today = new Date().toDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (parsed.lastDate !== today && parsed.lastDate !== yesterday.toDateString()) {
          return { count: 0, lastDate: parsed.lastDate };
        }
        return parsed;
      }
    } catch(e) {}
    return { count: 0, lastDate: '' };
  });

  // Badges System State
  const [badges, setBadges] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('userBadges') || '[]'); } catch(e) { return []; }
  });

  // Global Audio Player states
  const [globalAudio, setGlobalAudio] = useState<{ url: string; title: string } | null>(null);
  const [selectedPdfForView, setSelectedPdfForView] = useState<{ title: string; url: string } | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  const handleDownloadWatermarkedPdf = async (url: string, title: string) => {
    setIsDownloadingPdf(true);
    try {
      const sName = studentName || (studentData as any)?.name || 'طالب موسوعة الكنز';
      const sPhone = inputPhone || localStorage.getItem('loggedInPhone') || (studentData as any)?.phone || '';
      await downloadWatermarkedPdf(url, sName, sPhone, title, subjectName, gradeName);
    } catch (err) {
      console.error(err);
      const directUrl = getDirectPdfLink(url);
      window.open(directUrl, '_blank');
    } finally {
      setIsDownloadingPdf(false);
    }
  };
  const [isGlobalAudioPlaying, setIsGlobalAudioPlaying] = useState<boolean>(false);
  const [globalAudioTime, setGlobalAudioTime] = useState<number>(0);
  const [globalAudioDuration, setGlobalAudioDuration] = useState<number>(0);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const globalAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAudioTimeRef = useRef<number | null>(null);
  const lastSavedAudioTimeRef = useRef<number>(0);

  const formatAudioTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const toggleGlobalAudio = () => {
    if (!globalAudioRef.current) return;
    if (isGlobalAudioPlaying) {
      globalAudioRef.current.pause();
    } else {
      // في حال وجود خطأ سابق (كانقطاع الإنترنت)، نعيد تحميل الاتصال ونستأنف من نفس النقطة
      if (globalAudioRef.current.error && globalAudio) {
        globalAudioRef.current.load();
        globalAudioRef.current.currentTime = globalAudioTime;
      }
      globalAudioRef.current.play().catch(err => console.log('Playback error:', err));
    }
  };

  const togglePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (globalAudioRef.current) {
      globalAudioRef.current.playbackRate = nextRate;
    }
  };

  const handleGlobalAudioTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const currentTime = e.currentTarget.currentTime;
    setGlobalAudioTime(currentTime);
    
    // حفظ التقدم كل 5 ثوانٍ لتجنب الضغط على الذاكرة المحلية
    if (globalAudio && Math.abs(currentTime - lastSavedAudioTimeRef.current) > 5) {
      localStorage.setItem(`audioProgress_${simpleHash(globalAudio.url)}`, currentTime.toString());
      lastSavedAudioTimeRef.current = currentTime;
    }
  };

  const handleGlobalAudioLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const duration = e.currentTarget.duration;
    setGlobalAudioDuration(duration);
    
    // استعادة التقدم المحفوظ بمجرد تحميل بيانات الملف الصوتي
    if (pendingAudioTimeRef.current !== null) {
      if (pendingAudioTimeRef.current < duration - 5) {
        e.currentTarget.currentTime = pendingAudioTimeRef.current;
        setGlobalAudioTime(pendingAudioTimeRef.current);
      }
      pendingAudioTimeRef.current = null;
    }
  };

  const handleGlobalAudioSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (globalAudioRef.current) {
      globalAudioRef.current.currentTime = val;
      setGlobalAudioTime(val);
    }
  };

  const playLessonAudio = (url: string, title: string) => {
    if (globalAudio?.url === url) {
      toggleGlobalAudio();
    } else {
      // جلب التقدم المحفوظ إن وجد
      const savedTime = localStorage.getItem(`audioProgress_${simpleHash(url)}`);
      if (savedTime) {
        pendingAudioTimeRef.current = parseFloat(savedTime);
      } else {
        pendingAudioTimeRef.current = null;
      }
      lastSavedAudioTimeRef.current = pendingAudioTimeRef.current || 0;

      setIsAudioLoading(true);
      // تشغيل الصوت مباشرة داخل الحدث (Click) لتخطي حظر متصفحات الموبايل (Chrome/Safari)
      if (globalAudioRef.current) {
        globalAudioRef.current.src = getDirectAudioLink(url);
        globalAudioRef.current.playbackRate = playbackRate;
        globalAudioRef.current.load();
        const playPromise = globalAudioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsAudioLoading(false);
            // تفعيل التحكم في الصوت من شاشة القفل الخاصة بالموبايل واستمرار التشغيل في الخلفية
            if ('mediaSession' in navigator && (window as any).MediaMetadata) {
              try {
                navigator.mediaSession.metadata = new (window as any).MediaMetadata({
                  title: title,
                  artist: 'أ/ إسلام سعود',
                  album: 'موسوعة الكنز التعليمي',
                  // استخدام رابط كامل للصورة لمنع أخطاء الهواتف القديمة
                  artwork: [{ src: `${window.location.origin}/icon.png`, sizes: '512x512', type: 'image/png' }]
                });
              } catch(e) {}
            }
          }).catch(err => {
            console.log('Playback error on user click:', err);
            if (err.name === 'AbortError' || err.message.includes('abort')) return;
            setIsAudioLoading(false);
            // إعادة المحاولة مرة أخرى لاحتمالية تأخر جلب البيانات من السيرفر أو تقييد المتصفح
            setTimeout(() => {
              if (globalAudioRef.current) {
                globalAudioRef.current.play().catch(e => {
                  if (e.name === 'AbortError' || e.message.includes('abort')) return;
                  setIsGlobalAudioPlaying(false);
                });
              }
            }, 800);
          });
        }
      }
      setGlobalAudio({ url, title });
      setGlobalAudioTime(0);
      setGlobalAudioDuration(0);
      setIsGlobalAudioPlaying(true);
    }
  };

  useEffect(() => {
    // إيقاف وتفريغ المشغل فقط عند إغلاق الصوت، أما التشغيل فيتم في دالة playLessonAudio
    if (!globalAudio && globalAudioRef.current) {
      globalAudioRef.current.pause();
      globalAudioRef.current.removeAttribute('src');
      globalAudioRef.current.load();
      setIsGlobalAudioPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
      }
    }
  }, [globalAudio?.url]);
  
  // تفعيل أزرار التشغيل والإيقاف من شاشة قفل الموبايل أو شريط الإشعارات
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        if (globalAudioRef.current) {
          globalAudioRef.current.play();
          setIsGlobalAudioPlaying(true);
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (globalAudioRef.current) {
          globalAudioRef.current.pause();
          setIsGlobalAudioPlaying(false);
        }
      });
    }
  }, []);

  // خدعة برمجية لفتح قفل الصوت (Unlock Audio) في نظام iOS وأندرويد عند أول لمسة للشاشة
  useEffect(() => {
    const unlockAudio = () => {
      if (globalAudioRef.current && !globalAudioRef.current.src) {
         // تحميل مقطع صامت قصير جداً لتصريح المشغل من قبل النظام
         globalAudioRef.current.src = "data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
         globalAudioRef.current.load();
      }
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
  }, []);

  const [announcement, setAnnouncement] = useState<string>('');
  const [announcementInput, setAnnouncementInput] = useState<string>('');
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string>(() => {
    try {
      return localStorage.getItem('dismissedAnnouncement') || '';
    } catch(e) { return ''; }
  });
  const [showCertModal, setShowCertModal] = useState<boolean>(false);
  
  // Leaderboard State
  const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);
  const [leaderboardData, setLeaderboardData] = useState<{name: string, score: number, testsCount: number, avg?: number, tier?: string, trend?: string}[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState<boolean>(false);
  const [currentUserStats, setCurrentUserStats] = useState<{
    testsCount: number;
    avg: number;
    passedUnit1: boolean;
    passedUnit3: boolean;
    passedEnough: boolean;
    tier: string;
    quizzes: Record<string, number>;
    globalRank?: number;
    missingRequired?: string[];
    completedRequired?: { name: string; score: number }[];
    unitRanks?: Record<string, { rank: number; totalStudents: number; avg: number; title: string }>;
  } | null>(null);
  const [showWhyModal, setShowWhyModal] = useState<boolean>(false);
  
  const [activeMapUrl, setActiveMapUrl] = useState<string | null>(null);
  const [mapsList, setMapsList] = useState<InteractiveMap[]>([]);
  
  const [mistakesBank, setMistakesBank] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem('mistakesBank');
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });

  // كشكول أهم الأخطاء والنموذج الدائم (مرجع دائم لا يحذف بمجرد التدريب أو التصفير)
  const PERMANENT_NOTEBOOK_KEY = 'kanz_permanent_notebook_mistakes';
  const [permanentNotebookMistakes, setPermanentNotebookMistakes] = useState<PermanentMistakeItem[]>(() => {
    try {
      const saved = localStorage.getItem(PERMANENT_NOTEBOOK_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // دالة حفظ وتحديث سؤال في كشكول الأخطاء الدائم
  const addMistakeToPermanentNotebook = (
    q: Question,
    userSelected?: string,
    userText?: string,
    lId?: string,
    lTitle?: string,
    uId?: string,
    uTitle?: string
  ) => {
    if (!q || !q.q) return;
    const qHash = simpleHash(q.q);

    let targetUId = uId;
    let targetUTitle = uTitle;
    let targetLId = lId;
    let targetLTitle = lTitle;

    if (!targetUId || !targetLId) {
      if (Array.isArray(data)) {
        for (const u of data) {
          if (!u || !Array.isArray(u.lessons)) continue;
          for (const l of u.lessons) {
            if (!l || !Array.isArray(l.questions)) continue;
            if (l.questions.some(item => item && (simpleHash(item.q) === qHash || item.q === q.q))) {
              targetUId = u.id;
              targetUTitle = u.title;
              targetLId = l.id;
              targetLTitle = l.title;
              break;
            }
          }
        }
      }
    }

    const isEssay = q.type === 'essay';
    const newItem: PermanentMistakeItem = {
      id: `nb_${qHash}`,
      question: { ...q },
      unitId: targetUId || 'general',
      unitTitle: targetUTitle || 'الوحدة العامة',
      lessonId: targetLId || 'general_lesson',
      lessonTitle: targetLTitle || (isEssay ? 'سؤال مقالي' : 'اختبار عام'),
      studentSelectedOption: userSelected,
      studentAnswerText: userText || userSelected,
      modelAnswer: q.correct || q.answer || '',
      reason: q.reason || '',
      concept: q.concept || q.paragraph || '',
      isEssay: isEssay,
      essayType: q.essayType || (isEssay ? detectEssayType(q.q).label : undefined),
      timestamp: Date.now()
    };

    setPermanentNotebookMistakes(prev => {
      const filtered = prev.filter(p => simpleHash(p.question?.q || '') !== qHash);
      const updated = [newItem, ...filtered];
      try {
        localStorage.setItem(PERMANENT_NOTEBOOK_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // حذف سؤال فردي من الكشكول
  const handleDeleteNotebookMistake = (id: string) => {
    setPermanentNotebookMistakes(prev => {
      const updated = prev.filter(m => m.id !== id);
      try {
        localStorage.setItem(PERMANENT_NOTEBOOK_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // تفريغ الكشكول بالكامل
  const handleClearPermanentNotebook = () => {
    showConfirm('هل أنت متأكد من مسح جميع الأسئلة المحفوظة في الكشكول؟\nيمكنك دائماً حفظ أخطاء جديدة عند حل الاختبارات.', () => {
      setPermanentNotebookMistakes([]);
      localStorage.removeItem(PERMANENT_NOTEBOOK_KEY);
      showAlert('تم تفريغ كشكول الأخطاء بنجاح.');
    });
  };

  // مزامنة الأسئلة السابقة من بنك الأخطاء إلى الكشكول الدائم تلقائياً لضمان عدم ضياع أي خطأ
  useEffect(() => {
    if (Array.isArray(mistakesBank) && mistakesBank.length > 0 && Array.isArray(data) && data.length > 0) {
      setPermanentNotebookMistakes(prev => {
        let hasNew = false;
        const updated = [...prev];
        mistakesBank.forEach(mbQ => {
          if (!mbQ || !mbQ.q) return;
          const qHash = simpleHash(mbQ.q);
          if (!updated.some(item => item && item.question && simpleHash(item.question.q) === qHash)) {
            let uId = 'general';
            let uTitle = 'الوحدة الدراسية';
            let lId = 'general_lesson';
            let lTitle = 'اختبار تدريبي';
            for (const u of data) {
              if (!u || !Array.isArray(u.lessons)) continue;
              for (const l of u.lessons) {
                if (!l || !Array.isArray(l.questions)) continue;
                if (l.questions.some(item => item && (simpleHash(item.q) === qHash || item.q === mbQ.q))) {
                  uId = u.id;
                  uTitle = u.title;
                  lId = l.id;
                  lTitle = l.title;
                  break;
                }
              }
            }
            updated.push({
              id: `nb_${qHash}`,
              question: { ...mbQ },
              unitId: uId,
              unitTitle: uTitle,
              lessonId: lId,
              lessonTitle: lTitle,
              modelAnswer: mbQ.correct || mbQ.answer || '',
              reason: mbQ.reason || '',
              concept: mbQ.concept || mbQ.paragraph || '',
              isEssay: mbQ.type === 'essay',
              timestamp: Date.now()
            });
            hasNew = true;
          }
        });
        if (hasNew) {
          try {
            localStorage.setItem(PERMANENT_NOTEBOOK_KEY, JSON.stringify(updated));
          } catch(e) {}
          return updated;
        }
        return prev;
      });
    }
  }, [mistakesBank, data]);
  
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  
  // PWA states and instructions
  const {
    deferredPrompt, setDeferredPrompt,
    showInstallBtn, setShowInstallBtn,
    isIOS,
    showIOSInstallGuide, setShowIOSInstallGuide,
    installTab, setInstallTab
  } = usePWA();

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSInstallGuide(true);
      return;
    }
    
    if (!deferredPrompt) {
      setShowIOSInstallGuide(true);
      return;
    }
    
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowInstallBtn(false);
      }
    } catch (err) {
      console.error('PWA installation prompt failed:', err);
      setShowIOSInstallGuide(true);
    }
  };

  interface DialogState {
    isOpen: boolean;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm: (() => void) | null;
  }
  
  const [dialog, setDialog] = useState<DialogState>({ 
    isOpen: false, 
    message: '', 
    type: 'alert', 
    onConfirm: null 
  });
  
  const showAlert = (message: string) => setDialog({ isOpen: true, message, type: 'alert', onConfirm: null });
  const showConfirm = (message: string, onConfirm: () => void) => setDialog({ isOpen: true, message, type: 'confirm', onConfirm });
  const closeDialog = () => setDialog({ isOpen: false, message: '', type: 'alert', onConfirm: null });
  
  // تأثير تهيئة العداد الزمني لكل سؤال في الاختبار
  useEffect(() => {
    if (screen === 'quiz' && activeLesson && offlineGateStatus === 'none') {
      if (isLessonTimerActive(activeLesson.title, activeLesson.id) && timerType === 'per_question') {
        if (userAnswers[currentQIndex] !== undefined) {
          // السؤال تم حله مسبقاً: تعطيل العداد لمنع تداخل الأوقات
          setTimeLeft(null);
          timerQuestionIndexRef.current = -1;
        } else {
          // سؤال جديد غير مجاب: شحن الثواني بالكامل وربط العداد برقم هذا السؤال حصرياً
          setTimeLeft(timerSecondsPerQ);
          timerQuestionIndexRef.current = currentQIndex;
        }
      } else {
        setTimeLeft(null);
        timerQuestionIndexRef.current = -1;
      }
    } else {
      setTimeLeft(null);
      timerQuestionIndexRef.current = -1;
    }
  }, [currentQIndex, screen, offlineGateStatus, activeLesson?.id, timerMode, timerSecondsPerQ, timerUnitTargets, timerType]);

  // تأثير العد التنازلي المباشر واحتساب انتهاء الوقت للسؤال الحالي حصراً
  useEffect(() => {
    let timerId: ReturnType<typeof setInterval>;
    const timerActive = activeLesson && isLessonTimerActive(activeLesson.title, activeLesson.id) && timerType === 'per_question';
    const answered = userAnswers[currentQIndex] !== undefined;

    if (screen === 'quiz' && offlineGateStatus === 'none' && timerActive && !answered && timeLeft !== null) {
      if (timeLeft <= 0) {
        // انتهى وقت هذا السؤال تحديداً دون إجابة
        if (timerQuestionIndexRef.current === currentQIndex) {
          timerQuestionIndexRef.current = -1;
          const currentQ = activeLesson?.questions?.[currentQIndex];
          if (currentQ && userAnswers[currentQIndex] === undefined) {
            const newAns = [...userAnswers];
            newAns[currentQIndex] = {
              isCorrect: false,
              selected: 'انتهى الوقت المحدد للسؤال',
              concept: currentQ.concept || '',
              paragraph: currentQ.paragraph || '',
              type: (currentQ.type === 'essay' ? 'essay' : (currentQ.type === 'tf' || currentQ.type === 't/f' ? 'tf' : 'mcq'))
            };
            setUserAnswers(newAns);
            setSkippedQuestions(prev => prev.filter(idx => idx !== currentQIndex));

            // إضافة السؤال إلى بنك الأخطاء
            setMistakesBank(prev => {
              const qHash = simpleHash(currentQ.q);
              if (!prev.some(item => simpleHash(item.q) === qHash)) {
                const updated = [...prev, currentQ];
                localStorage.setItem('mistakesBank', JSON.stringify(updated));
                return updated;
              }
              return prev;
            });

            setFeedbackToast({ isCorrect: false, message: '⏰ انتهى الوقت المخصص لهذا السؤال!' });
            setTimeout(() => {
              setFeedbackToast(null);
            }, 2000);
          }
        }
      } else {
        // العد التنازلي ثانية بثانية
        timerId = setInterval(() => {
          setTimeLeft(prev => {
            if (prev === null || prev <= 1) return 0;
            return prev - 1;
          });
        }, 1000);
      }
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [screen, offlineGateStatus, activeLesson?.id, currentQIndex, userAnswers, timeLeft, timerSecondsPerQ, timerMode, timerUnitTargets, timerType]);

  // تأثير العد التنازلي لوقت الامتحان الكلي (بالدقائق) بنظام الطابع الزمني الحقيقي
  useEffect(() => {
    let timerId: ReturnType<typeof setInterval>;
    const timerActive = activeLesson && isLessonTimerActive(activeLesson.title, activeLesson.id) && timerType === 'total_exam';

    if (screen === 'quiz' && offlineGateStatus === 'none' && timerActive && examTimeLeft !== null) {
      if (examTimeLeft <= 0) {
        handleFinishQuiz(true);
        showAlert('⏰ انتهى الوقت المحدد للامتحان بالكامل! تم تسليم إجاباتك بنجاح.');
        return;
      }

      timerId = setInterval(() => {
        if (examEndTimeRef.current) {
          const diffSeconds = Math.max(0, Math.floor((examEndTimeRef.current - Date.now()) / 1000));
          setExamTimeLeft(diffSeconds);
          if (diffSeconds <= 0) {
            clearInterval(timerId);
          }
        } else {
          setExamTimeLeft(prev => {
            if (prev === null || prev <= 1) return 0;
            return prev - 1;
          });
        }
      }, 1000);
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [screen, offlineGateStatus, activeLesson?.id, timerType, examTimeLeft]);

  const prevSkippedCount = useRef<number>(0);
  useEffect(() => {
    if (screen === 'quiz') {
      if (prevSkippedCount.current > 0 && skippedQuestions.length === 0) {
        setTimeout(() => showAlert('لقد تم اكتمال حل الأسئلة التي تم تخطيها بنجاح! 🎉'), 500);
      }
      prevSkippedCount.current = skippedQuestions.length;
    } else {
      prevSkippedCount.current = 0;
    }
  }, [skippedQuestions.length, screen]);

  useEffect(() => {
    window.history.pushState({ screen: 'home' }, '');
    const handlePopState = () => {
      if (screen === 'quiz') {
        showConfirm('هل أنت متأكد من مغادرة الاختبار؟\nسيتم حفظ تقدمك الحالي.', () => setScreen('index'));
        window.history.pushState({ screen: 'quiz' }, ''); 
      }
      else if (screen === 'index') {
        window.history.pushState({ screen: 'index' }, ''); 
      }
      else if (screen === 'result') setScreen('index');
      else if (screen === 'admin') setScreen('home');
      else window.history.pushState(null, ''); 
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [screen]);
  
  useEffect(() => {
    if (screen === 'quiz' && activeLesson && activeLesson.id !== 'mistakes_bank') {
      const sessionData = { 
        lessonId: activeLesson.id, 
        unitId: data.find(u => u.lessons.some(l => l.id === activeLesson.id))?.id, 
        answers: userAnswers, 
        currentIndex: currentQIndex,
        questions: activeLesson.questions,
        timeLeft: timeLeft,
        examEndTime: examEndTimeRef.current,
        skippedQuestions: skippedQuestions
      };
      localStorage.setItem('savedSession', JSON.stringify(sessionData));
    } else if (screen === 'result') {
      localStorage.removeItem('savedSession');
      examEndTimeRef.current = null;
    }
  }, [screen, activeLesson, userAnswers, currentQIndex, data, timeLeft, examTimeLeft, skippedQuestions]);
  
  // مراقبة الاتصال بالإنترنت لإدارة بوابات الاختبار بدون نت
  useEffect(() => {
    const handleOnline = () => {
      if (screen === 'quiz' && offlineGateStatus === 'require_online_to_submit') {
        setOfflineGateStatus('none');
        finishQuizInternal();
      }
    };

    const handleOffline = () => {
      if (screen === 'quiz' && offlineGateStatus === 'require_offline_to_start') {
        setOfflineGateStatus('none');
        if (timerType === 'total_exam' && activeLesson && isLessonTimerActive(activeLesson.title, activeLesson.id)) {
          const end = Date.now() + (examTotalMinutes * 60 * 1000);
          examEndTimeRef.current = end;
          setExamTimeLeft(examTotalMinutes * 60);
        } else if (timerType === 'per_question' && activeLesson && isLessonTimerActive(activeLesson.title, activeLesson.id)) {
          setTimeLeft(timerSecondsPerQ);
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [screen, offlineGateStatus, timerType, activeLesson, examTotalMinutes, timerSecondsPerQ]);

  // مراقبة شاشة الاختبار: منع لقطة الشاشة، تعتيم الشاشة، واحتساب مخالفات مغادرة النافذة
  useEffect(() => {
    if (screen !== 'quiz' || offlineGateStatus !== 'none') {
      setIsScreenObfuscated(false);
      return;
    }

    let obfuscateTimeout: any = null;

    const handleContextMenu = (e: MouseEvent) => {
      if (securitySettings.preventScreenshot) {
        e.preventDefault();
      }
    };

    const handleCopyCut = (e: ClipboardEvent) => {
      if (securitySettings.preventScreenshot) {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!securitySettings.preventScreenshot) return;

      // منع وضبط زر تصوير الشاشة PrintScreen
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('');
          }
        } catch (err) {}
        setIsScreenObfuscated(true);
        if (obfuscateTimeout) clearTimeout(obfuscateTimeout);
        showAlert('⚠️ تنبيه أمني: تصوير الشاشة محظور لحماية بنك الأسئلة!');
        return;
      }

      // منع اختصارات النسخ والطباعة وحفظ الصفحة وعرض الكود المصدر
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u', 'c', 'a'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        return;
      }

      // منع أدوات المطورين F12
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))) {
        e.preventDefault();
        return;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (securitySettings.preventScreenshot) {
          setIsScreenObfuscated(true);
        }
        if (securitySettings.lockdownEnabled) {
          const now = Date.now();
          // حماية من الاحتساب المزدوج عند التبديل السريع بين التطبيقات أو إشعارات النظام
          if (now - lastStrikeTimestampRef.current >= 1200) {
            lastStrikeTimestampRef.current = now;
            tabSwitchStrikesRef.current += 1;
            const currentStrikes = tabSwitchStrikesRef.current;
            setTabSwitchStrikes(currentStrikes);
            if (currentStrikes > securitySettings.maxTabSwitchStrikes) {
              finishQuizInternal();
              showAlert(`🚫 تم إنهاء وسحب ورقة الامتحان تلقائياً لتكرار مغادرة شاشة الاختبار (${securitySettings.maxTabSwitchStrikes} مخالفات)!`);
            }
          }
        }
      } else if (document.visibilityState === 'visible') {
        if (securitySettings.lockdownEnabled && tabSwitchStrikesRef.current > 0 && tabSwitchStrikesRef.current <= securitySettings.maxTabSwitchStrikes) {
          setTabSwitchWarningModal({
            open: true,
            strikes: tabSwitchStrikesRef.current,
            max: securitySettings.maxTabSwitchStrikes
          });
        }
      }
    };

    const handleWindowBlur = () => {
      if (securitySettings.preventScreenshot) {
        setIsScreenObfuscated(true);
      }
    };

    const handleWindowFocus = () => {
      // إبقاء حجب الشاشة ثابتاً حتى يؤكد الطالب بنفسه الضغط على زر المتابعة
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('copy', handleCopyCut);
    window.addEventListener('cut', handleCopyCut);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('copy', handleCopyCut);
      window.removeEventListener('cut', handleCopyCut);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      if (obfuscateTimeout) clearTimeout(obfuscateTimeout);
    };
  }, [screen, offlineGateStatus, securitySettings]);
  
  useEffect(() => {
    const loadStudents = async () => {
      try {
        const response = await fetch(`${API_URL}?action=getAllStudents&apiKey=${SECRET_API_KEY}`);
        const result = await response.json();
        if(result.status === 'success') {
          if(result.data) {
            setStudentsList(result.data);
            const savedPhone = localStorage.getItem('loggedInPhone');
            const savedUserStr = localStorage.getItem('loggedInUser');
            if (savedPhone && savedUserStr) {
        let savedUser: Student | null = null;
        try { savedUser = JSON.parse(savedUserStr); } catch(e) {}
        if (savedUser) {
          let liveStudents = result.data[savedPhone];
          if (liveStudents) {
            if (!Array.isArray(liveStudents)) liveStudents = [liveStudents];
            const liveSt = (liveStudents as Student[]).find(s => s.name === savedUser?.name);
                  if (liveSt && ((liveSt as any).isBlocked || liveSt.isPaid === false || (liveSt.missingMonths && liveSt.missingMonths.length > 0))) {
              localStorage.removeItem('loggedInUser');
              localStorage.removeItem('loggedInPhone');
              setStudentData(null);
              setStudentName('');
              setScreen('home');
            } else if (!liveSt) {
              // إذا كان المستخدم المحفوظ في الذاكرة لا ينتمي لقائمة طلاب هذه المرحلة (مثلاً أخ في مرحلة أخرى)،
              // يتم تسجيل خروجه إجبارياً لمنع تسجيل النتائج باسم خاطئ.
              localStorage.removeItem('loggedInUser');
              localStorage.removeItem('loggedInPhone');
              setStudentData(null);
              setStudentName('');
              setScreen('home');
            }
          }
              }
            }
          }
          if(result.fee) {
            try {
              if (result.fee.startsWith('{')) {
                const parsedFee = JSON.parse(result.fee);
                setPackagePrices(parsedFee);
                setEditPrices(parsedFee);
                localStorage.setItem('packagePrices', JSON.stringify(parsedFee));
                setPlatformFee(parsedFee.monthly + ' جنيهاً');
              } else {
                setPlatformFee(result.fee);
              }
            } catch(e) {
              setPlatformFee(result.fee);
            }
          }
          if(result.announcement !== undefined) setAnnouncement(result.announcement); 
          if(result.timerMode) { 
            setTimerMode(result.timerMode); 
            localStorage.setItem('timerMode', result.timerMode); 
          }
          if(result.timerUnitTarget) { 
            let parsed = [];
            try { parsed = JSON.parse(result.timerUnitTarget); if(!Array.isArray(parsed)) parsed = [result.timerUnitTarget]; } catch { parsed = [result.timerUnitTarget]; }
            setTimerUnitTargets(parsed); 
            localStorage.setItem('timerUnitTargets', JSON.stringify(parsed)); 
          }
          if(result.timerSecondsPerQ !== undefined) { 
            setTimerSecondsPerQ(Number(result.timerSecondsPerQ)); 
            localStorage.setItem('timerSecondsPerQ', result.timerSecondsPerQ.toString()); 
          }
          if(result.timerType !== undefined) {
            setTimerType(result.timerType);
            localStorage.setItem('timerType', result.timerType);
          }
          if(result.examTotalMinutes !== undefined) {
            setExamTotalMinutes(Number(result.examTotalMinutes));
            localStorage.setItem('examTotalMinutes', result.examTotalMinutes.toString());
          }
          if(result.publishedLessons) { 
            try { 
              const parsed = JSON.parse(result.publishedLessons); 
              if(Array.isArray(parsed) && parsed.length > 0) { 
                setPublishedLessons(parsed); 
                localStorage.setItem('publishedLessons', JSON.stringify(parsed)); 
                localStorage.setItem('publishedLessons_init', 'true'); 
              } 
            } catch(e) {} 
          }
          if(result.showMistakesNotebook !== undefined) {
            const val = String(result.showMistakesNotebook).toLowerCase() !== 'false';
            setShowMistakesNotebookSetting(val);
            localStorage.setItem('kanz_show_mistakes_notebook', JSON.stringify(val));
          }
          if(result.showResetButtons !== undefined) {
            const val = String(result.showResetButtons).toLowerCase() !== 'false';
            setShowResetButtonSetting(val);
            localStorage.setItem('kanz_show_reset_button', JSON.stringify(val));
          }
          if(result.geminiApiKey && typeof result.geminiApiKey === 'string' && result.geminiApiKey.trim()) {
            setGeminiKeyInput(result.geminiApiKey.trim());
            setGeminiApiKey(result.geminiApiKey.trim());
          }
          if(result.certSettings) {
            try {
              const parsed = typeof result.certSettings === 'string' ? JSON.parse(result.certSettings) : result.certSettings;
              if (parsed && typeof parsed === 'object') {
                setCertSettings(prev => ({ ...prev, ...parsed }));
                localStorage.setItem('app_cert_settings', JSON.stringify(parsed));
              }
            } catch(e) {}
          }
          if(result.securitySettings) {
            try {
              const parsed = typeof result.securitySettings === 'string' ? JSON.parse(result.securitySettings) : result.securitySettings;
              if (parsed && typeof parsed === 'object') {
                setSecuritySettings(prev => ({ ...prev, ...parsed }));
                localStorage.setItem('app_exam_security_settings', JSON.stringify(parsed));
              }
            } catch(e) {}
          }
          if(result.examConfigs) {
            try {
              syncExamConfigsFromCloud(result.examConfigs);
            } catch(e) {
              console.error("Error syncing exam configs on load:", e);
            }
          }
        }
      } catch(e) {}
    };
    loadStudents();
  }, []);
  
  useEffect(() => {
    const savedUser = localStorage.getItem('loggedInUser');
    const savedPhone = localStorage.getItem('loggedInPhone');
    if (savedUser && savedPhone) {
      try {
        const st: Student | null = JSON.parse(savedUser);
        // Safety check to ensure the parsed user is not null before using it
        if (st) {
          const currentMonthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
          const savedVerifiedMonth = localStorage.getItem('verifiedStudentMonth_' + savedPhone + '_' + st.name);
          if (st.code && st.code.trim() !== '' && savedVerifiedMonth !== currentMonthKey) {
            localStorage.removeItem('loggedInUser');
            setStudentData(null);
            setStudentName('');
            setScreen('home');
            return;
          }
          setStudentData(st);
          setStudentName(st.name);
          setInputPhone(savedPhone);
          if (st.isPaid || !st.missingMonths || st.missingMonths.length === 0) {
            setScreen('returning_welcome');
          }
        }
      } catch(e) {}
      
      // Pre-fetch questions data to ensure stats.total is populated and ready immediately
      const prefetchCourseData = async () => {
        try {
          const noCache = new Date().getTime();
          const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`);
          const qData = await qRes.json();
          if (qData.status === 'success') {
            const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
            
            const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
            builtData.forEach(u => {
              u.lessons.forEach(l => {
                if (localCompleted.includes(l.id)) l.completed = true;
              });
            });

            setData(builtData);
            setExpandedUnits([]);
            if (qData.maps) setMapsList(qData.maps as InteractiveMap[]);
          }
        } catch (e) {
          console.error("Course prefetch error:", e);
        }
      };
      prefetchCourseData();
    }
  }, []);

  useEffect(() => {
    // Clean and crisp dynamic PWA icon renderer
    const generatePwaIcons = async () => {
      try {
        if (!('caches' in window)) return;
        const cache = await caches.open('kanz-cache-v1');
        const cachedIcon = await cache.match('./icon.png');
        if (cachedIcon) return; // already compiled

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = './icon.svg';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 512;
          canvas.height = 512;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, 512, 512);
            canvas.toBlob(async (blob) => {
              if (blob) {
                const response = new Response(blob, {
                  headers: { 'Content-Type': 'image/png' }
                });
                await cache.put('./icon.png', response.clone());
                await cache.put('./apple-touch-icon.png', response);
              }
            }, 'image/png');
          }
        };
      } catch (e) {
        console.warn(e);
      }
    };
    generatePwaIcons();
  }, []);
  
  useEffect(() => {
    setAnnouncementInput(announcement);
  }, [announcement]);
  
  const toggleUnit = (unitId: string) => setExpandedUnits(prev => prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]);
  const toggleAdminUnit = (unitId: string) => setAdminExpandedUnits(prev => prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]);
  
  const toggleFullscreen = () => { 
    if (!document.fullscreenElement) { 
      document.documentElement.requestFullscreen().catch(e => console.log(e)); 
      setIsFullscreen(true); 
    } else { 
      document.exitFullscreen(); 
      setIsFullscreen(false); 
    } 
  };
  
  const stats = useMemo(() => {
    let total = 0, completed = 0;
    studentUnits.forEach(unit => { 
      unit.lessons.forEach(l => { 
        total++; 
        if (l.completed) completed++; 
      }); 
    });
    return { 
      total, 
      completed, 
      remaining: total - completed, 
      progress: total ? Math.round((completed/total)*100) : 0 
    };
  }, [studentUnits]);
  
  useEffect(() => {
    if (stats.total > 0) {
      localStorage.setItem('userStats', JSON.stringify(stats));
    }
  }, [stats]);
  
  const handleResume = async () => {
    setIsLoading(true);
    try {
      const noCache = new Date().getTime();
      const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`); 
      const qData = await qRes.json();
      if (qData.status === 'success') {
        localStorage.setItem('cachedQuestionsData', JSON.stringify(qData.data));
        const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
        
        // --- START: Force server sync on resume ---
        if (studentName && inputPhone) {
          try {
            const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const resData = await res.json();
            if (resData.status === 'success') {
              const chronologicalData = [...resData.data].reverse() as TestResult[];
              const formattedPhone = formatPhoneStr(inputPhone);
              
              const myResults = chronologicalData.filter(r => {
                let correctName = r.name;
                const fPhone = formatPhoneStr(r.phone);
                if (fPhone !== formattedPhone) return false;

                const stRecord = studentsList[fPhone];
                if (stRecord) {
                  const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                  if (matchedStudent) correctName = matchedStudent.name;
                  else if (stArr.length === 1) correctName = stArr[0].name;
                }
                return correctName.trim() === studentName.trim();
              });

              const restoredScores: Record<string, number> = {};
              const completedIds: Set<string> = new Set();
              const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
              
              myResults.forEach(r => {
                if (isAmbiguousOldQuiz(r.quiz)) return;
                
                if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                  if (r.quiz.includes('تصفير الوحدة')) {
                    const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                    const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                    if (unitToReset) unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                  } else {
                    for(const key in restoredScores) delete restoredScores[key];
                    completedIds.clear();
                  }
                  return;
                }
                const scoreNum = normalizeScore(r.score);
                let foundLessonId = '', totalQs = 0;
                const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                for (const u of builtData) { const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz)); if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; } }
                if (foundLessonId && restoredScores[foundLessonId] === undefined) { restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs); completedIds.add(foundLessonId); }
              });

              // دمج الدرجات التي لم ترفع للسيرفر بعد (أوفلاين)
              const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
              offlineResults.forEach((offlineRes: any) => {
                  if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                  
                  if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                    if (offlineRes.quiz.includes('تصفير الوحدة')) {
                      const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                      const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                      if (unitToReset) {
                        unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                      }
                    } else {
                      for(const key in restoredScores) delete restoredScores[key];
                      completedIds.clear();
                    }
                    return;
                  }

                  const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                  let foundLessonId = '', totalQs = 0;
                  for (const u of builtData) {
                    const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                    if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                  }
                  if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                    const scoreNum = normalizeScore(offlineRes.score);
                    restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                    completedIds.add(foundLessonId);
                  }
              });

              localStorage.setItem('lessonScores', JSON.stringify(restoredScores));
              localStorage.setItem('completedLessons', JSON.stringify(Array.from(completedIds)));
              setLessonScores(restoredScores);
            }
          } catch(e) { console.error(e); }
        }
        // --- END: Force server sync on resume ---
        
        const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        builtData.forEach(u => {
          u.lessons.forEach(l => {
            if (localCompleted.includes(l.id)) l.completed = true;
          });
        });

        setData(builtData);
        setExpandedUnits([]);
        if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
        const session = localStorage.getItem('savedSession');
        if (session) {
          let parsedSession: any = null;
          try { parsedSession = JSON.parse(session); } catch(e) {}
          if (parsedSession) {
            let foundLesson: Lesson | null = null;
            for (const u of builtData) {
              const l = u.lessons.find(ls => ls.id === parsedSession.lessonId);
              if (l) { foundLesson = l; break; }
            }
            if (foundLesson) {
              const restoredLesson = { 
                ...foundLesson, 
                questions: parsedSession.questions || foundLesson.questions 
              };
              setActiveLesson(restoredLesson); 
              setUserAnswers(parsedSession.answers || []); 
              setCurrentQIndex(parsedSession.currentIndex || 0); 
              setTimeLeft(parsedSession.timeLeft !== undefined ? parsedSession.timeLeft : null);
              setSkippedQuestions(parsedSession.skippedQuestions || []);
              if (securitySettings.offlineModeEnabled && typeof navigator !== 'undefined' && navigator.onLine) {
                setOfflineGateStatus('require_offline_to_start');
              } else {
                setOfflineGateStatus('none');
              }
              tabSwitchStrikesRef.current = 0;
              setTabSwitchStrikes(0);
              setIsScreenObfuscated(false);
              setTabSwitchWarningModal(null);
              setScreen('quiz');
            } else {
              setScreen('index');
            }
          } else {
            setScreen('index');
          }
        } else {
          setScreen('index');
        }
      } else { 
        setLoginError("فشل تحميل الأسئلة من السيرفر."); 
        setScreen('home'); 
      }
    } catch(e) { 
      try {
        const cached = localStorage.getItem('cachedQuestionsData');
        const fallback = cached ? JSON.parse(cached) : (defaultQuestionsData as FlatQuestionRow[]);
        if (fallback) {
          const builtData = buildCourseData(fallback as FlatQuestionRow[]);
          setData(builtData);
          setExpandedUnits([]);
          setScreen('index');
          setIsLoading(false);
          return;
        }
      } catch(err) {}
      setLoginError("حدث خطأ أثناء جلب الأسئلة."); 
      setScreen('home'); 
    }
    setIsLoading(false);
  };
  
  const handleStartFresh = async () => {
    setIsLoading(true);
    try {
      const noCache = new Date().getTime();
      const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`); 
      const qData = await qRes.json();
      if (qData.status === 'success') {
        const builtData = buildCourseData(qData.data as FlatQuestionRow[]);

        // --- START: Force server sync on start fresh ---
        if (studentName && inputPhone) {
          try {
            const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const resData = await res.json();
            if (resData.status === 'success') {
              const chronologicalData = [...resData.data].reverse() as TestResult[];
              const formattedPhone = formatPhoneStr(inputPhone);
              
              const myResults = chronologicalData.filter(r => {
                let correctName = r.name;
                const fPhone = formatPhoneStr(r.phone);
                if (fPhone !== formattedPhone) return false;

                const stRecord = studentsList[fPhone];
                if (stRecord) {
                  const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                  if (matchedStudent) correctName = matchedStudent.name;
                  else if (stArr.length === 1) correctName = stArr[0].name;
                }
                return correctName.trim() === studentName.trim();
              });

              const restoredScores: Record<string, number> = {};
              const completedIds: Set<string> = new Set();
              const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
              
              myResults.forEach(r => {
                if (isAmbiguousOldQuiz(r.quiz)) return;
                
                if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                  if (r.quiz.includes('تصفير الوحدة')) {
                    const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                    const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                    if (unitToReset) unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                  } else {
                    for(const key in restoredScores) delete restoredScores[key];
                    completedIds.clear();
                  }
                  return;
                }
                const scoreNum = normalizeScore(r.score);
                let foundLessonId = '', totalQs = 0;
                const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                for (const u of builtData) { const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz)); if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; } }
                if (foundLessonId && restoredScores[foundLessonId] === undefined) { restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs); completedIds.add(foundLessonId); }
              });
              
              // دمج الدرجات التي لم ترفع للسيرفر بعد (أوفلاين)
              const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
              offlineResults.forEach((offlineRes: any) => {
                  if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                  
                  if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                    if (offlineRes.quiz.includes('تصفير الوحدة')) {
                      const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                      const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                      if (unitToReset) {
                        unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                      }
                    } else {
                      for(const key in restoredScores) delete restoredScores[key];
                      completedIds.clear();
                    }
                    return;
                  }

                  const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                  let foundLessonId = '', totalQs = 0;
                  for (const u of builtData) {
                    const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                    if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                  }
                  if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                    const scoreNum = normalizeScore(offlineRes.score);
                    restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                    completedIds.add(foundLessonId);
                  }
              });

              localStorage.setItem('lessonScores', JSON.stringify(restoredScores));
              localStorage.setItem('completedLessons', JSON.stringify(Array.from(completedIds)));
              setLessonScores(restoredScores);
            }
          } catch(e) { console.error(e); }
        }
        // --- END: Force server sync on start fresh ---
        
        const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        builtData.forEach(u => {
          u.lessons.forEach(l => {
            if (localCompleted.includes(l.id)) l.completed = true;
          });
        });

        setData(builtData);
        setExpandedUnits([]);
        if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
        setScreen('index');
      } else { 
        setLoginError("فشل تحميل الأسئلة من السيرفر."); 
        setScreen('home'); 
      }
    } catch(e) { 
      setLoginError("حدث خطأ أثناء جلب الأسئلة."); 
      setScreen('home'); 
    }
    setIsLoading(false);
  };
  
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const noCache = new Date().getTime();
      const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`);
      const qData = await qRes.json();
      
      const sRes = await fetch(`${API_URL}?action=getAllStudents&apiKey=${SECRET_API_KEY}&t=${noCache}`);
      const sData = await sRes.json();
      
      if (qData.status === 'success') {
        const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
        
        // --- مزامنة ومطابقة النتائج مع جوجل شيتس لحل مشكلة اختلاف رقم المنجز ---
        if (studentName && inputPhone) {
          try {
            const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const resData = await res.json();
            if (resData.status === 'success') {
              const chronologicalData = [...resData.data].reverse() as TestResult[];
              const formattedPhone = formatPhoneStr(inputPhone);
              
              let currentStudentsList = studentsList;
              if (sData && sData.status === 'success' && sData.data) {
                currentStudentsList = sData.data;
              }

              const myResults = chronologicalData.filter(r => {
                let correctName = r.name;
                const fPhone = formatPhoneStr(r.phone);
                if (fPhone !== formattedPhone) return false;

                const stRecord = currentStudentsList[fPhone];
                if (stRecord) {
                  const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                  if (matchedStudent) {
                    correctName = matchedStudent.name;
                  } else if (stArr.length === 1) {
                    correctName = stArr[0].name;
                  }
                }
                return correctName.trim() === studentName.trim();
              });

              const restoredScores: Record<string, number> = {};
              const completedIds: Set<string> = new Set();
              const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
              
              myResults.forEach(r => {
                if (isAmbiguousOldQuiz(r.quiz)) return;
                
                if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                  if (r.quiz.includes('تصفير الوحدة')) {
                    const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                    const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                    if (unitToReset) {
                      unitToReset.lessons.forEach(l => {
                        delete restoredScores[l.id];
                        completedIds.delete(l.id);
                      });
                    }
                  } else {
                    for (const key in restoredScores) delete restoredScores[key];
                    completedIds.clear();
                  }
                  return;
                }
                
                const scoreNum = normalizeScore(r.score);
                let foundLessonId = '';
                let totalQs = 0;
                
                const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                for (const u of builtData) {
                  const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz));
                  if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                }
                
                if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                  restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                  completedIds.add(foundLessonId);
                }
              });
              
              // دمج الدرجات التي لم ترفع للسيرفر بعد (أوفلاين)
              const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
              offlineResults.forEach((offlineRes: any) => {
                  if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                  
                  if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                    if (offlineRes.quiz.includes('تصفير الوحدة')) {
                      const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                      const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                      if (unitToReset) {
                        unitToReset.lessons.forEach(l => {
                          delete restoredScores[l.id];
                          completedIds.delete(l.id);
                        });
                      }
                    } else {
                      for (const key in restoredScores) delete restoredScores[key];
                      completedIds.clear();
                    }
                    return;
                  }

                  const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                  let foundLessonId = '', totalQs = 0;
                  for (const u of builtData) {
                    const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                    if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                  }
                  if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                    const scoreNum = normalizeScore(offlineRes.score);
                    restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                    completedIds.add(foundLessonId);
                  }
              });
              
              const finalScores = restoredScores;
              const finalCompleted = Array.from(completedIds);
              
              localStorage.setItem('lessonScores', JSON.stringify(finalScores));
              localStorage.setItem('completedLessons', JSON.stringify(finalCompleted));
              setLessonScores(finalScores);
            }
          } catch(e) { console.error(e); }

          // --- مزامنة نتائج وتصحيح المقالي المعتمدة للطالب من السحابة ---
          try {
            const essayRes = await fetch(`${API_URL}?action=getEssaySubmissions&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const essayData = await essayRes.json();
            if (essayData && essayData.status === 'success' && Array.isArray(essayData.data)) {
              const myPhone = formatPhoneStr(inputPhone);
              const myRows = essayData.data.filter((row: any) => formatPhoneStr(row.studentPhone) === myPhone);
              if (myRows.length > 0) {
                const groupedMap = new Map<string, any>();
                myRows.forEach((row: any) => {
                  const key = String(row.quizTitle || '').trim();
                  if (!key) return;
                  if (!groupedMap.has(key)) {
                    groupedMap.set(key, {
                      id: `cloud_${myPhone}___${key}`,
                      studentName: row.studentName || studentName,
                      studentPhone: myPhone,
                      quizTitle: key,
                      lessonId: key,
                      submissionDate: row.date || '',
                      studentType: row.studentType || 'سنتر',
                      questions: [],
                      isFullyApproved: false,
                      finalScore: 0,
                      maxPossibleScore: 0
                    });
                  }
                  const grp = groupedMap.get(key)!;
                  const scoreNum = row.teacherScore !== "" && row.teacherScore !== undefined ? Number(row.teacherScore) : undefined;
                  const isAppr = String(row.status || '').trim() === 'معتمد';
                  const cleanQText = (row.questionText || `سؤال مقالي ${grp.questions.length + 1}`).trim();
                  
                  const existingQ = grp.questions.find((q: any) => q.questionText.trim() === cleanQText);
                  if (existingQ) {
                    if (scoreNum !== undefined && existingQ.teacherScore === undefined) existingQ.teacherScore = scoreNum;
                    if (row.teacherFeedback && !existingQ.teacherFeedback) existingQ.teacherFeedback = row.teacherFeedback;
                    if (!existingQ.isApproved && isAppr) existingQ.isApproved = true;
                    return;
                  }

                  grp.questions.push({
                    qIndex: grp.questions.length,
                    questionText: cleanQText,
                    essayType: 'سؤال مقالي',
                    modelAnswer: '',
                    studentText: row.studentAnswerText || '',
                    maxScore: 2,
                    teacherScore: scoreNum,
                    teacherFeedback: row.teacherFeedback || '',
                    isApproved: isAppr
                  });
                });
                const localList = getPendingEssaySubmissions();
                const mergedMap = new Map<string, StudentEssaySubmission>();
                localList.forEach(ls => mergedMap.set(`${formatPhoneStr(ls.studentPhone)}___${ls.quizTitle.trim()}`, ls));
                groupedMap.forEach(grp => {
                  grp.isFullyApproved = grp.questions.length > 0 && grp.questions.every((q: any) => q.isApproved);
                  grp.finalScore = grp.questions.reduce((sum: number, q: any) => sum + (q.teacherScore || 0), 0);
                  const mKey = `${myPhone}___${grp.quizTitle}`;
                  mergedMap.set(mKey, grp);
                });
                localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(Array.from(mergedMap.values())));
              }
            }
          } catch(e) {}
        }
        
        const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        builtData.forEach(u => {
          u.lessons.forEach(l => {
            if (localCompleted.includes(l.id)) l.completed = true;
          });
        });
        // --- نهاية المزامنة ---

        setData(builtData);
        setExpandedUnits([]);
        if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
        if (sData.status === 'success') {
          if (sData.fee) {
            try {
              if (sData.fee.startsWith('{')) {
                const parsedFee = JSON.parse(sData.fee);
                setPackagePrices(parsedFee);
                setEditPrices(parsedFee);
                localStorage.setItem('packagePrices', JSON.stringify(parsedFee));
                setPlatformFee(parsedFee.monthly + ' جنيهاً');
              } else {
                setPlatformFee(sData.fee);
              }
            } catch(e) {
              setPlatformFee(sData.fee);
            }
          }
          if (sData.data) setStudentsList(sData.data);
          if(sData.timerMode) { 
            setTimerMode(sData.timerMode); 
            localStorage.setItem('timerMode', sData.timerMode); 
          }
          if(sData.timerUnitTarget) { 
            let parsed = [];
            try { parsed = JSON.parse(sData.timerUnitTarget); if(!Array.isArray(parsed)) parsed = [sData.timerUnitTarget]; } catch { parsed = [sData.timerUnitTarget]; }
            setTimerUnitTargets(parsed); 
            localStorage.setItem('timerUnitTargets', JSON.stringify(parsed)); 
          }
          if(sData.timerSecondsPerQ !== undefined) { 
            setTimerSecondsPerQ(Number(sData.timerSecondsPerQ)); 
            localStorage.setItem('timerSecondsPerQ', sData.timerSecondsPerQ.toString()); 
          }
          if(sData.timerType !== undefined) {
            setTimerType(sData.timerType);
            localStorage.setItem('timerType', sData.timerType);
          }
          if(sData.examTotalMinutes !== undefined) {
            setExamTotalMinutes(Number(sData.examTotalMinutes));
            localStorage.setItem('examTotalMinutes', sData.examTotalMinutes.toString());
          }
          if(sData.publishedLessons) { 
            try { 
              const parsed = JSON.parse(sData.publishedLessons); 
              if(Array.isArray(parsed) && parsed.length > 0) { 
                setPublishedLessons(parsed); 
                localStorage.setItem('publishedLessons', JSON.stringify(parsed)); 
                localStorage.setItem('publishedLessons_init', 'true'); 
              } 
            } catch(e) {} 
          }
          if(sData.showMistakesNotebook !== undefined) {
            const val = String(sData.showMistakesNotebook).toLowerCase() !== 'false';
            setShowMistakesNotebookSetting(val);
            localStorage.setItem('kanz_show_mistakes_notebook', JSON.stringify(val));
          }
          if(sData.showResetButtons !== undefined) {
            const val = String(sData.showResetButtons).toLowerCase() !== 'false';
            setShowResetButtonSetting(val);
            localStorage.setItem('kanz_show_reset_button', JSON.stringify(val));
          }
          if(sData.geminiApiKey && typeof sData.geminiApiKey === 'string' && sData.geminiApiKey.trim()) {
            setGeminiKeyInput(sData.geminiApiKey.trim());
            setGeminiApiKey(sData.geminiApiKey.trim());
          }
          if(sData.certSettings) {
            try {
              const parsed = typeof sData.certSettings === 'string' ? JSON.parse(sData.certSettings) : sData.certSettings;
              if (parsed && typeof parsed === 'object') {
                setCertSettings(prev => ({ ...prev, ...parsed }));
                localStorage.setItem('app_cert_settings', JSON.stringify(parsed));
              }
            } catch(e) {}
          }
          if(sData.securitySettings) {
            try {
              const parsed = typeof sData.securitySettings === 'string' ? JSON.parse(sData.securitySettings) : sData.securitySettings;
              if (parsed && typeof parsed === 'object') {
                setSecuritySettings(prev => ({ ...prev, ...parsed }));
                localStorage.setItem('app_exam_security_settings', JSON.stringify(parsed));
              }
            } catch(e) {}
          }
          if(sData.examConfigs) {
            try {
              syncExamConfigsFromCloud(sData.examConfigs);
            } catch(e) {
              console.error("Error syncing exam configs on refresh:", e);
            }
          }
        }
        showAlert('تم تحديث المحتوى والإشعارات بنجاح! 🚀');
      } else {
        showAlert("فشل التحديث من السيرفر.");
      }
    } catch(e) {
      showAlert("حدث خطأ أثناء جلب التحديثات.");
    }
    setIsLoading(false);
  };
  
  const handleLogout = () => {
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('loggedInPhone');
    sessionStorage.removeItem('seen_opening_prayer');
    setStudentData(null);
    setStudentName('');
    setInputPhone('');
    setInputPassword('');
    setShowPasswordInput(false);
    setScreen('home');
  };
  
  const handleResetUnit = (unitId: string) => {
    const unitToReset = data.find(u => u.id === unitId);
    if (!unitToReset) return;

    showConfirm(`هل أنت متأكد من تصفير الوحدة "${unitToReset.title}"؟\nسيتم مسح جميع درجاتك في دروس هذه الوحدة فقط وستبدأ من جديد.`, () => {
        const lessonIdsToReset = unitToReset.lessons.map(l => l.id);
        const lessonQuestionsToReset = unitToReset.lessons.flatMap(l => l.questions.map(q => simpleHash(q.q)));

        saveResultToDB({
            quizName: `تصفير الوحدة 🔄: ${unitToReset.title}`,
            score: 'تصفير 🔄'
        });

        setLessonScores(prev => {
            const newScores = { ...prev };
            lessonIdsToReset.forEach(id => { delete newScores[id]; });
            localStorage.setItem('lessonScores', JSON.stringify(newScores));
            return newScores;
        });

        const newCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]').filter((id: string) => !lessonIdsToReset.includes(id));
        localStorage.setItem('completedLessons', JSON.stringify(newCompleted));

        setData(prevData => {
            return prevData.map(unit => {
                if (unit.id === unitId) {
                    return { ...unit, lessons: unit.lessons.map(l => ({ ...l, completed: false })) };
                }
                return unit;
            });
        });

        setMistakesBank(prev => {
            const newBank = prev.filter(q => !lessonQuestionsToReset.includes(simpleHash(q.q)));
            localStorage.setItem('mistakesBank', JSON.stringify(newBank));
            return newBank;
        });
        
        const session = localStorage.getItem('savedSession');
        if (session) {
            const parsed = JSON.parse(session);
            if (lessonIdsToReset.includes(parsed.lessonId)) localStorage.removeItem('savedSession');
        }

        try {
          const rawSubs = localStorage.getItem('kanz_student_essay_submissions');
          if (rawSubs) {
            const parsedSubs = JSON.parse(rawSubs);
            const filteredSubs = parsedSubs.filter((s: any) => !lessonIdsToReset.includes(s.lessonId));
            localStorage.setItem('kanz_student_essay_submissions', JSON.stringify(filteredSubs));
          }
        } catch(e) {}

        showAlert(`تم تصفير وحدة "${unitToReset.title}" بنجاح. يمكنك الآن البدء من جديد.`);
    });
  };

  const handleLogin = async () => {
    setLoginError(''); 
    const formattedPhone = formatPhoneStr(inputPhone);
    if (!formattedPhone || formattedPhone.length < 10) { 
      setLoginError('يرجى إدخال رقم هاتف صحيح.'); 
      return; 
    }
    setIsLoading(true);
    
    const loadQuestionsAndNavigate = async (targetScreen: string, stPhone: string, stName: string, knownStudentsArr?: Student[]) => {
      try {
        const noCache = new Date().getTime();
        const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`); 
        const qData = await qRes.json();
        if (qData.status === 'success') {
          localStorage.setItem('cachedQuestionsData', JSON.stringify(qData.data));
          const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
          
          if (targetScreen === 'index') {
            try {
              const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
              const resData = await res.json();
              if (resData.status === 'success') {
                const chronologicalData = [...resData.data].reverse() as TestResult[];
                
                const myResults = chronologicalData.filter(r => {
                  let correctName = r.name;
                  const fPhone = formatPhoneStr(r.phone);
                  if (fPhone !== stPhone) return false;

                  let stArr = knownStudentsArr;
                  if (!stArr) {
                    const stRecord = studentsList[fPhone];
                    if (stRecord) stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  }

                  if (stArr) {
                    const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                    if (matchedStudent) {
                      correctName = matchedStudent.name;
                    } else if (stArr.length === 1) {
                      correctName = stArr[0].name;
                    }
                  }
                  return correctName.trim() === stName.trim();
                });

                if (myResults.length > 0) {
                  const restoredScores: Record<string, number> = {};
                  const completedIds: Set<string> = new Set();
                  const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
                  
                  let fullResetHit = false;
                  const resetLessonIds: Set<string> = new Set();
                  
                  myResults.forEach(r => {
                    if (isAmbiguousOldQuiz(r.quiz)) return;
                    if (fullResetHit) return;
                    
                    if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                      if (r.quiz.includes('تصفير الوحدة')) {
                        const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                        const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                        if (unitToReset) {
                          unitToReset.lessons.forEach(l => resetLessonIds.add(l.id));
                        }
                      } else {
                        fullResetHit = true;
                      }
                      return;
                    }
                    
                    const scoreNum = normalizeScore(r.score);
                    let foundLessonId = '';
                    let totalQs = 0;
                    
                    const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                    
                    for (const u of builtData) {
                      const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz));
                      if (l) {
                        foundLessonId = l.id;
                        totalQs = l.questions.length;
                        break;
                      }
                    }
                    
                    if (foundLessonId && !resetLessonIds.has(foundLessonId) && restoredScores[foundLessonId] === undefined) {
                      const correctCount = Math.round((scoreNum / 100) * totalQs);
                      restoredScores[foundLessonId] = correctCount;
                      completedIds.add(foundLessonId);
                    }
                  });
                  
                  const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
                  offlineResults.forEach((offlineRes: any) => {
                      if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                      if (fullResetHit) return;
                      
                      if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                        if (offlineRes.quiz.includes('تصفير الوحدة')) {
                          const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                          const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                          if (unitToReset) {
                            unitToReset.lessons.forEach(l => resetLessonIds.add(l.id));
                          }
                        } else {
                          fullResetHit = true;
                        }
                        return;
                      }

                      const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                      let foundLessonId = '', totalQs = 0;
                      for (const u of builtData) {
                        const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                        if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                      }
                      if (foundLessonId && !resetLessonIds.has(foundLessonId) && restoredScores[foundLessonId] === undefined) {
                        const scoreNum = normalizeScore(offlineRes.score);
                        restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                        completedIds.add(foundLessonId);
                      }
                  });

                  const finalScores = restoredScores;
                  const finalCompleted = Array.from(completedIds);
                  
                  localStorage.setItem('lessonScores', JSON.stringify(finalScores));
                  localStorage.setItem('completedLessons', JSON.stringify(finalCompleted));
                  setLessonScores(finalScores);
                }
              }
            } catch(e) {
               console.error("Restore failed", e);
            }
          }

          const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
          builtData.forEach(u => {
            u.lessons.forEach(l => {
              if (localCompleted.includes(l.id)) l.completed = true;
            });
          });
          
          setData(builtData);
          setExpandedUnits([]);
          if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
          setScreen(targetScreen === 'admin' ? 'admin' : 'index'); 
          return;
        }
      } catch(e) { 
        console.warn("Questions fetch warning, using cache/default:", e);
      }

      // Fallback: استخدام الذاكرة المحلية أو الأسئلة الأساسية فوراً لمنع تعطل أي مستخدم
      try {
        const cachedStr = localStorage.getItem('cachedQuestionsData');
        const fallbackData = cachedStr ? JSON.parse(cachedStr) : (defaultQuestionsData as FlatQuestionRow[]);
        if (fallbackData && Array.isArray(fallbackData) && fallbackData.length > 0) {
          const builtData = buildCourseData(fallbackData as FlatQuestionRow[]);
          setData(builtData);
          setExpandedUnits([]);
          setScreen('index');
          return;
        }
      } catch (err) {
        console.error("Fallback questions error:", err);
      }

      if (targetScreen === 'admin') {
        const builtData = buildCourseData(defaultQuestionsData as FlatQuestionRow[]);
        setData(builtData);
        setScreen('admin');
        return;
      }

      setLoginError("حدث خطأ أثناء جلب الأسئلة. برجاء التحقق من اتصال الإنترنت.");
    };
    
    if (BASE_STUDENTS[formattedPhone]) {
      if (!showPasswordInput) { 
        setShowPasswordInput(true); 
        setIsLoading(false); 
        return; 
      }
      const user = BASE_STUDENTS[formattedPhone];
      const isMatch = await verifyStaffPassword(inputPassword, user);
      if (isMatch) {
        setStudentName(user.name);
        if (user.role === 'admin') { 
          fetchAdminData(); 
          await loadQuestionsAndNavigate('admin', formattedPhone, user.name); 
        } else if (user.role === 'secretary') { 
          await loadQuestionsAndNavigate('index', formattedPhone, user.name); 
        }
        setShowPasswordInput(false); 
        setInputPassword('');
      } else {
        setLoginError("الرقم السري خاطئ.");
      }
      setIsLoading(false); 
      return;
    }
    
    let localStudents = studentsList[formattedPhone];
    if (localStudents) {
      if (!Array.isArray(localStudents)) localStudents = [localStudents];
      const studentsArr = localStudents as Student[];
      if (studentsArr.length > 1 && !selectedTwin) { 
        setLoginError('اختر اسمك من القائمة أولاً.'); 
        setIsLoading(false); 
        return; 
      }
      const st = selectedTwin || studentsArr[0];
      
      if ((st as any).isBlocked) {
        setLoginError('تم حظر هذا الحساب، برجاء التواصل مع الإدارة على الرقم: 01228466613');
        setIsLoading(false);
        return;
      }

      if (st.isPaid === false || (st.missingMonths && st.missingMonths.length > 0)) {
        setStudentData(st); 
        setShowUnpaidModal(true); 
        setIsLoading(false); 
        return;
      }
      
      const currentMonthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
      const savedVerifiedMonth = localStorage.getItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name);

      if (st.code && st.code.trim() !== '' && savedVerifiedMonth !== currentMonthKey) {
        if (!showPasswordInput) {
          setShowPasswordInput(true);
          setIsLoading(false);
          return;
        }
        const enteredCode = inputPassword.trim().toUpperCase();
        const expectedCode = st.code.trim().toUpperCase();
        if (enteredCode !== expectedCode) {
          setLoginError('كود الطالب غير صحيح، برجاء التأكد من كتابة الكود بشكل صحيح.');
          setIsLoading(false);
          return;
        }
        localStorage.setItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name, currentMonthKey);
        setShowPasswordInput(false);
        setInputPassword('');
      }

      const proceedWithLocalLogin = async () => {
        setStudentName(st.name); 
        setStudentData(st);
        
        const fingerprint = generateDeviceFingerprint();
        try {
          const fpRes = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
              action: 'saveDeviceFingerprint', 
              phone: `${formattedPhone}_${st.name}`, 
              fingerprint: fingerprint, 
              apiKey: SECRET_API_KEY 
            }) 
          });
          const fpData = await fpRes.json();
          if (fpData.status === 'blocked') { 
            setLoginError('لا يمكن فتح التطبيق! لقد سبق واستخدم هذا الحساب في متصفح أو جهاز آخر. برجاء التواصل مع الإدارة لفك الارتباط.'); 
            setIsLoading(false); 
            return; 
          }
        } catch(e) {}
        
        localStorage.setItem('loggedInUser', JSON.stringify(st));
        localStorage.setItem('loggedInPhone', formattedPhone);
        await loadQuestionsAndNavigate('index', formattedPhone, st.name, studentsArr);
        setIsLoading(false); 
      };

      if (st.graceMonths && st.graceMonths.length > 0) {
        setStudentData(st);
        setPendingGraceLogin(() => proceedWithLocalLogin);
        setShowGraceModal(true);
        setIsLoading(false);
        return;
      }

      await proceedWithLocalLogin();
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}?action=login&phone=${formattedPhone}&apiKey=${SECRET_API_KEY}`);
      const result = await response.json();
      if (result.status === 'success') {
        const fetchedStudents: Student[] = Array.isArray(result.student) ? result.student : [result.student];
        if (fetchedStudents.length > 1 && !selectedTwin) {
          setStudentsList(prev => ({...prev, [formattedPhone]: fetchedStudents}));
          setLoginError('الرجاء اختيار اسمك أولاً.'); 
          setIsLoading(false); 
          return;
        }
        const st = selectedTwin || fetchedStudents[0];
        
        if ((st as any).isBlocked) {
          setLoginError('تم حظر هذا الحساب، برجاء التواصل مع الإدارة على الرقم: 01228466613');
          setIsLoading(false);
          return;
        }

        if (st.isPaid === false || (st.missingMonths && st.missingMonths.length > 0)) {
          setStudentData(st); 
          setShowUnpaidModal(true); 
          setIsLoading(false); 
          return;
        }
        
        const currentMonthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        const savedVerifiedMonth = localStorage.getItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name);

        if (st.code && st.code.trim() !== '' && savedVerifiedMonth !== currentMonthKey) {
          if (!showPasswordInput) {
            setShowPasswordInput(true);
            setIsLoading(false);
            return;
          }
          const enteredCode = inputPassword.trim().toUpperCase();
          const expectedCode = st.code.trim().toUpperCase();
          if (enteredCode !== expectedCode) {
            setLoginError('كود الطالب غير صحيح، برجاء التأكد من كتابة الكود بشكل صحيح.');
            setIsLoading(false);
            return;
          }
          localStorage.setItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name, currentMonthKey);
          setShowPasswordInput(false);
          setInputPassword('');
        }
        if (st.graceMonths && st.graceMonths.length > 0) {
          setStudentData(st);
          setPendingGraceLogin(() => async () => {
            setStudentName(st.name); 
            setStudentData(st);
            localStorage.setItem('loggedInUser', JSON.stringify(st));
            localStorage.setItem('loggedInPhone', formattedPhone);
            await loadQuestionsAndNavigate('index', formattedPhone, st.name, fetchedStudents);
            setIsLoading(false);
          });
          setShowGraceModal(true);
          setIsLoading(false);
          return;
        }

        setStudentName(st.name); 
        setStudentData(st);
        
        const fingerprint = generateDeviceFingerprint();
        try {
          const fpRes = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
              action: 'saveDeviceFingerprint', 
              phone: `${formattedPhone}_${st.name}`, 
              fingerprint: fingerprint, 
              apiKey: SECRET_API_KEY 
            }) 
          });
          const fpData = await fpRes.json();
          if (fpData.status === 'blocked') { 
            setLoginError('لا يمكن فتح التطبيق! لقد سبق واستخدم هذا الحساب في متصفح آخر. برجاء التواصل مع الإدارة لفك الارتباط.'); 
            setIsLoading(false); 
            return; 
          }
        } catch (fpErr) {
          console.warn("Device fingerprint verification warning:", fpErr);
        }
        
        localStorage.setItem('loggedInUser', JSON.stringify(st));
        localStorage.setItem('loggedInPhone', formattedPhone);
        await loadQuestionsAndNavigate('index', formattedPhone, st.name, fetchedStudents);
      } else if (result.status === 'unregistered' || result.message === 'الرقم غير مسجل لدينا.') {
        const reqRes = await fetch(`${API_URL}?action=getPendingRequests&apiKey=${SECRET_API_KEY}`); 
        const reqData = await reqRes.json();
        if (reqData.status === 'success' && reqData.data && (reqData.data as PendingRequest[]).some(r => formatPhoneStr(r.phone) === formattedPhone)) {
          setLoginError('طلبك قيد مراجعة الإدارة.');
        } else {
          setShowWelcomeSubscribeModal(true);
        }
      } else {
        setLoginError(result.message || 'حدث خطأ.');
      }
    } catch (error) { 
      setLoginError('خطأ في الاتصال بالإنترنت.'); 
    }
    setIsLoading(false);
  };

  const handleOpenLeaderboard = async () => {
    setShowLeaderboard(true);
    setIsLoadingLeaderboard(true);
    try {
      const noCache = new Date().getTime();
      const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
      const resData = await res.json();
      if (resData.status === 'success') {
        const grouped: Record<string, { quizzes: Record<string, number>, latestTestOriginalIndex: number, firstAttemptIndices: Record<string, number> }> = {};
        const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
        
        // إعداد قاموس لعدد أسئلة كل درس لتحويل النسب إلى XP مطابق للصفحة الرئيسية
        const titleToQsMap: Record<string, number> = {};
        data.forEach(u => u.lessons.forEach(l => { titleToQsMap[l.title] = l.questions.length; }));
        
        const chronologicalData = [...resData.data].reverse() as TestResult[];
        chronologicalData.forEach((r, idx) => {
          let correctName = r.name;
          const formattedPhone = formatPhoneStr(r.phone);
          const stRecord = studentsList[formattedPhone];

          if (stRecord) {
            const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
            const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
            
            if (matchedStudent) {
              correctName = matchedStudent.name;
            } else {
              if (stArr.length === 1) {
                correctName = stArr[0].name;
              }
            }
          }

          if (!grouped[correctName]) grouped[correctName] = { quizzes: {}, firstAttemptIndices: {} };
          
          if (isAmbiguousOldQuiz(r.quiz)) return;

          // تصفير سجل الطالب إذا قام بالتصفير للبدء من جديد واعتبار ما بعده محاولة أولى جديدة
          if (r.quiz.includes('تصفير') || r.quiz.includes('فرصة جديدة') || String(r.score).includes('تصفير')) {
            if (r.quiz.includes('فرصة جديدة') || r.quiz.includes('تصفير درس')) {
              const lessonTitleToReset = r.quiz.replace(/.*(?:فرصة جديدة|تصفير درس).*?:/, '').trim();
              const matchedLesson = data.flatMap(u => u.lessons).find(l => 
                normalizeLessonName(l.title).includes(normalizeLessonName(lessonTitleToReset)) || 
                normalizeLessonName(lessonTitleToReset).includes(normalizeLessonName(l.title))
              );
              if (matchedLesson) {
                delete grouped[correctName].quizzes[matchedLesson.title];
                delete grouped[correctName].firstAttemptIndices[matchedLesson.title];
              }
            } else if (r.quiz.includes('تصفير الوحدة')) { // تصفير وحدة
              const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
              const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
              if (unitToReset) {
                  unitToReset.lessons.forEach(l => {
                      delete grouped[correctName].quizzes[l.title];
                      delete grouped[correctName].firstAttemptIndices[l.title];
                  });
              }
            } else { // تصفير كامل
              grouped[correctName].quizzes = {};
              grouped[correctName].firstAttemptIndices = {};
            }
            return; // الانتقال للنتيجة التالية بعد معالجة التصفير
          }

          const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
          if (mappedTitle) {
              const matchedLesson = data.flatMap(u => u.lessons).find(l => l.title === mappedTitle);
              if (matchedLesson) {
                const examConfig = getExamConfig(matchedLesson.id);
                const sType = (r as any).studentType === 'أونلاين' ? 'online' : 'center';
                if (!isTestEligibleForLeaderboard(examConfig, sType, r.date)) {
                  // مستبعد من لوحة الشرف لكونه أدى الامتحان خارج فترة الجدولة المحددة
                  return;
                }
              }
              const scoreNum = normalizeScore(r.score);
              if (grouped[correctName].quizzes[mappedTitle] === undefined) {
                grouped[correctName].quizzes[mappedTitle] = scoreNum;
                grouped[correctName].firstAttemptIndices[mappedTitle] = idx;
              }
          }
        });
        
        const activeLessons = data.flatMap(u => u.lessons).filter(l => isLessonActive(l.id));
        const requiredCurrentTitles = activeLessons.map(l => l.title);

        const mapped = Object.keys(grouped).map(name => {
          const studentData = grouped[name];
          const uniqueQuizzes = Object.keys(studentData.quizzes);
          
          if (requiredCurrentTitles.length > 0 && !requiredCurrentTitles.every(reqTitle => uniqueQuizzes.includes(reqTitle))) {
            return null;
          }

          let totalXP = 0;
          let sumPerc = 0;
          let studentLatestTest = -1;
          uniqueQuizzes.forEach(q => {
            const perc = studentData.quizzes[q];
            sumPerc += perc;
            const tQs = titleToQsMap[q] || 0;
            totalXP += Math.round((perc / 100) * tQs) * 10;
            
            const attemptIdx = studentData.firstAttemptIndices[q];
            if (attemptIdx > studentLatestTest) studentLatestTest = attemptIdx;
          });

          const score = totalXP;
          const testsCount = uniqueQuizzes.length;
          const avg = testsCount > 0 ? Math.min(100, Math.round(sumPerc / testsCount)) : 0;
          
          // شرط الاستبعاد الصارم: أي طالب يقل معدله عن 80% لا يدخل أي قائمة نهائياً
          if (avg < 80) {
            return null;
          }
          
          let trend = 'flat';
          if (testsCount > 1) {
            const lastQuiz = uniqueQuizzes[uniqueQuizzes.length - 1];
            const lastPerc = studentData.quizzes[lastQuiz];
            const prevPercSum = sumPerc - lastPerc;
            const prevAvg = Math.round(prevPercSum / (testsCount - 1));
            if (lastPerc > prevAvg + 2) trend = 'up';
            else if (lastPerc < prevAvg - 2) trend = 'down';
            else if (lastPerc === 100 && avg >= 95) trend = 'up';
          } else if (testsCount === 1) {
            if (avg >= 90) trend = 'up';
            else if (avg <= 75) trend = 'down';
          }
          
          return { name, score, testsCount, avg, trend, latestTestOriginalIndex: studentLatestTest };
        }).filter((item): item is NonNullable<typeof item> => item !== null);
        
        const sorted = mapped.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if (b.testsCount !== a.testsCount) {
            return b.testsCount - a.testsCount;
          }
          if (b.avg !== a.avg) {
            return b.avg - a.avg;
          }
          if (a.latestTestOriginalIndex !== b.latestTestOriginalIndex) {
            return a.latestTestOriginalIndex - b.latestTestOriginalIndex; // صاحب الرقم الأقل (الأقدم) هو الفائز في التشابه
          }
          return a.name.localeCompare(b.name, 'ar');
        });
        
        let goldCount = 0;
        let silverCount = 0;
        let bronzeCount = 0;
        
        const limitedSorted: {name: string, score: number, testsCount: number, avg: number, tier: string, trend: string, latestTestOriginalIndex?: number}[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const s = sorted[i];
          let tier = '';
          // القائمة الذهبية: بحد أقصى 10 طلاب، وبشرط معدل 90% فما فوق (المراكز 1 إلى 10)
          if (goldCount < 10 && s.avg >= 90) {
            tier = 'gold';
            goldCount++;
          } 
          // القائمة الفضية: بحد أقصى 10 طلاب (المراكز 11 إلى 20 أو الفائض من الذهبية) بمعدل 80% فما فوق
          else if (silverCount < 10) {
            tier = 'silver';
            silverCount++;
          } 
          // القائمة البرونزية: بحد أقصى 10 طلاب (المراكز 21 إلى 30) بمعدل 80% فما فوق
          else if (bronzeCount < 10) {
            tier = 'bronze';
            bronzeCount++;
          }
          if (tier) {
            limitedSorted.push({ ...s, tier, trend: s.trend });
          }
          if (goldCount + silverCount + bronzeCount >= 30) break;
        }

        let currentUserCurrentStats = null;
        if (studentName && grouped[studentName]) {
          const studentData = grouped[studentName];
          const uniqueQuizzes = Object.keys(studentData.quizzes);
          
          let sumPerc = 0;
          uniqueQuizzes.forEach(q => sumPerc += studentData.quizzes[q]);
          const testsCount = uniqueQuizzes.length;
          const avg = testsCount > 0 ? Math.min(100, Math.round(sumPerc / testsCount)) : 0;
          
          const isEligible = requiredCurrentTitles.length > 0 && requiredCurrentTitles.every(reqTitle => 
              uniqueQuizzes.includes(reqTitle)
          ) && avg >= 80;
          
          const passedUnit1 = true;
          const passedUnit3 = true;
          
          const studentGlobalRank = sorted.findIndex(s => s.name === studentName) + 1;

          const missingRequired: string[] = [];
          const completedRequired: { name: string; score: number }[] = [];
          
          requiredCurrentTitles.forEach(reqTitle => {
              if (uniqueQuizzes.includes(reqTitle)) {
                  completedRequired.push({ name: reqTitle, score: studentData.quizzes[reqTitle] });
              } else {
                  missingRequired.push(reqTitle);
              }
          });

          // --- NEW: Calculate Unit-specific Ranks ---
          const unitRanks: Record<string, { rank: number; totalStudents: number; avg: number; title: string }> = {};
          data.forEach(unit => {
              if (unit.lessons.length === 0) return;
      
              const unitLessonTitles = unit.lessons.map(l => l.title);
              
              const unitLeaderboard = Object.keys(grouped).map(name => {
                  const studentData = grouped[name];
                  const studentQuizzes = studentData.quizzes;
      
                  const completedAllUnitLessons = unitLessonTitles.every(lessonTitle => 
                      Object.keys(studentQuizzes).includes(lessonTitle)
                  );
      
                  if (!completedAllUnitLessons) return null;
      
                  let unitScore = 0;
                  unitLessonTitles.forEach(lessonTitle => {
                      unitScore += studentQuizzes[lessonTitle] || 0;
                  });
                  
                  const unitAvg = unitLessonTitles.length > 0 ? Math.round(unitScore / unitLessonTitles.length) : 0;
      
                  return { name, unitScore, unitAvg };
              }).filter((item): item is NonNullable<typeof item> => item !== null);
      
              const sortedUnitLeaderboard = unitLeaderboard.sort((a, b) => b.unitScore - a.unitScore);
      
              const userUnitRank = sortedUnitLeaderboard.findIndex(s => s.name === studentName) + 1;
      
              if (userUnitRank > 0) {
                  const userUnitData = sortedUnitLeaderboard.find(s => s.name === studentName);
                  unitRanks[unit.id] = {
                      rank: userUnitRank,
                      totalStudents: sortedUnitLeaderboard.length,
                      avg: userUnitData?.unitAvg || 0,
                      title: unit.title
                  };
              }
          });

          currentUserCurrentStats = {
            testsCount,
            avg,
            passedUnit1,
            passedUnit3,
            passedEnough: isEligible,
            tier: isEligible ? 'eligible' : '',
            quizzes: studentData.quizzes,
            globalRank: studentGlobalRank,
            missingRequired,
            completedRequired,
            unitRanks
          };
        }
        setCurrentUserStats(currentUserCurrentStats);
        
        setLeaderboardData(limitedSorted);
      }
    } catch(e) {
      console.error("Failed to load leaderboard");
    }
    setIsLoadingLeaderboard(false);
  };

  const downloadTierBoard = (tier: string, title: string, color: string) => {
    const tierStudents = leaderboardData.filter(s => s.tier === tier);
    if (tierStudents.length === 0) return;

    const canvas = document.createElement('canvas');
    const width = 950; // تكبير عرض اللوحة لإعطاء مساحة أكبر للأسماء الرباعية والألقاب
    const headerHeight = 240;
    const rowHeight = 85;
    const footerHeight = 160;
    canvas.width = width;
    canvas.height = headerHeight + (tierStudents.length * rowHeight) + footerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.direction = "rtl";

    // الخلفية بألوان تناسب كل قائمة
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (tier === 'gold') {
      gradient.addColorStop(0, '#fffdf0'); gradient.addColorStop(1, '#fef08a');
    } else if (tier === 'silver') {
      gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(1, '#e2e8f0');
    } else {
      gradient.addColorStop(0, '#fff7ed'); gradient.addColorStop(1, '#fed7aa');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // الإطار الخارجي المزدوج للفخامة
    ctx.strokeStyle = color;
    ctx.lineWidth = 14;
    ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(25, 25, canvas.width - 50, canvas.height - 50);

    // رأس اللوحة (العنوان)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // ظل ناعم للنصوص الرئيسية
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    
    ctx.fillStyle = color;
    ctx.font = '900 55px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`لوحة الشرف - ${title}`, width / 2, 90);
    
    ctx.shadowColor = 'transparent';

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 28px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`أوائل موسوعة الكنز التعليمي - أ/ إسلام سعود`, width / 2, 150);

    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG') + ' - ' + now.toLocaleTimeString('ar-EG');
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 18px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`تاريخ الإصدار: ${dateStr}`, width / 2, 195);

    // رسم كروت الطلاب
    let y = headerHeight;
    tierStudents.forEach((st, idx) => {
      // كارت الطالب بخلفية بيضاء وزوايا دائرية وظل
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.1)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 5;
      
      if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(40, y, width - 80, rowHeight - 20, 15);
        ctx.fill();
      } else {
        ctx.fillRect(40, y, width - 80, rowHeight - 20);
      }
      ctx.shadowColor = 'transparent';

      const centerY = y + (rowHeight - 20) / 2;
      const centerX = width - 70;

      // رسم دائرة الترتيب
      ctx.beginPath();
      ctx.arc(centerX, centerY, 22, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // إضافة التاج المصغر فوق أرقام القائمة الذهبية فقط
      if (tier === 'gold') {
        ctx.font = '22px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('👑', centerX, centerY - 28);
      }

      // كتابة رقم الترتيب داخل الدائرة باللون الأبيض
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 22px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(toEasternArabic(idx + 1), centerX, centerY + 2);

      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 26px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'right'; // إصلاح هام جداً: إعادة التوجيه لليمين بعد رسم التاج
      const fullName = st.name.split(' ').slice(0, 4).join(' '); // اسم رباعي
      // إضافة (500) كحد أقصى للعرض لضمان عدم خروج أي اسم مهما كان طويلاً عن الإطار
      ctx.fillText(fullName, width - 110, centerY, 500);

      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.font = '900 26px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.fillText(`${toEasternArabic(st.score)} نقطة`, 70, centerY);

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 18px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.fillText(`المتوسط: ${toEasternArabic(st.avg || 0)}%`, 250, centerY);

      y += rowHeight;
    });

    // تذييل اللوحة والكلمة التحفيزية
    ctx.textAlign = 'center';
    ctx.fillStyle = '#db2777';
    ctx.font = '900 32px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillText('هل ستنقلب الموازين ؟ في انتظار الجديد...', width / 2, y + 70);
    ctx.shadowColor = 'transparent';

    // تحميل الصورة
    const link = document.createElement('a');
    link.download = `لوحة_الشرف_${title.replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  
  const calculateAdminLeaderboard = () => {
    const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
    const activeLessons = data.flatMap(u => u.lessons).filter(l => isLessonActive(l.id));
    const requiredCurrentTitles = activeLessons.map(l => l.title);

    const titleToQsMap: Record<string, number> = {};
    data.forEach(u => u.lessons.forEach(l => { titleToQsMap[l.title] = l.questions.length; }));

    const mapped = adminResults.map(student => {
      
      const firstScores: Record<string, number> = {};
      const firstAttemptIndices: Record<string, number> = {};
      
      // نفترض أن الاختبارات مرتبة زمنياً من الخادم
      student.tests.forEach(t => {
        if (isAmbiguousOldQuiz(t.quiz)) return;
        
        if (t.quiz.includes('تصفير') || t.quiz.includes('فرصة جديدة') || String(t.score).includes('تصفير')) {
          if (t.quiz.includes('فرصة جديدة') || t.quiz.includes('تصفير درس')) {
            const lessonTitleToReset = t.quiz.replace(/.*(?:فرصة جديدة|تصفير درس).*?:/, '').trim();
            const matchedLesson = data.flatMap(u => u.lessons).find(l => 
              normalizeLessonName(l.title).includes(normalizeLessonName(lessonTitleToReset)) || 
              normalizeLessonName(lessonTitleToReset).includes(normalizeLessonName(l.title))
            );
            if (matchedLesson) {
              delete firstScores[matchedLesson.title];
              delete firstAttemptIndices[matchedLesson.title];
            }
          } else if (t.quiz.includes('تصفير الوحدة')) { // تصفير وحدة
            const unitTitleToReset = t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
            const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
            if (unitToReset) {
                unitToReset.lessons.forEach(l => { delete firstScores[l.title]; delete firstAttemptIndices[l.title]; });
            }
          } else {
            for(let key in firstScores) delete firstScores[key];
            for(let key in firstAttemptIndices) delete firstAttemptIndices[key];
          }
          return;
        }
        const mappedTitle = matchQuizToCurrent(t.quiz, currentValidLessons);
        if (mappedTitle) {
              const sc = normalizeScore(t.score);
              if (firstScores[mappedTitle] === undefined) {
                firstScores[mappedTitle] = sc;
                firstAttemptIndices[mappedTitle] = (t as any).originalIndex || 0;
              }
        }
      });
      
      const uniqueQuizzes = Object.keys(firstScores);

      // شرط إتمام جميع الدروس المفعلة حالياً
      if (requiredCurrentTitles.length > 0 && !requiredCurrentTitles.every(reqTitle => uniqueQuizzes.includes(reqTitle))) {
        return null;
      }
  
      let totalXP = 0;
      let sumPerc = 0;
      uniqueQuizzes.forEach(q => {
         const perc = firstScores[q];
         sumPerc += perc;
         const tQs = titleToQsMap[q] || 0;
         totalXP += Math.round((perc / 100) * tQs) * 10;
      });
      
      let studentLatestTest = -1;
      uniqueQuizzes.forEach(q => {
         const attemptIndex = firstAttemptIndices[q];
         if (attemptIndex > studentLatestTest) studentLatestTest = attemptIndex;
      });
  
      const totalScore = totalXP;
      const testsCount = uniqueQuizzes.length;
      const avg = testsCount > 0 ? Math.min(100, Math.round(sumPerc / testsCount)) : 0;
  
      // شرط الاستبعاد الصارم: استبعاد من يقل معدله عن 80% نهائياً من أي قائمة
      if (avg < 80) {
        return null;
      }

      let trend = 'flat';
      if (testsCount > 1) {
        const lastQuiz = uniqueQuizzes[uniqueQuizzes.length - 1];
        const lastPerc = firstScores[lastQuiz];
        const prevPercSum = sumPerc - lastPerc;
        const prevAvg = Math.round(prevPercSum / (testsCount - 1));
        if (lastPerc > prevAvg + 2) trend = 'up';
        else if (lastPerc < prevAvg - 2) trend = 'down';
        else if (lastPerc === 100 && avg >= 95) trend = 'up';
      } else if (testsCount === 1) {
        if (avg >= 90) trend = 'up';
        else if (avg <= 75) trend = 'down';
      }
  
      return { name: student.name, phone: student.phone, score: totalScore, avg, testsCount, trend, latestTestOriginalIndex: studentLatestTest };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  
    const sorted = mapped.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.testsCount !== a.testsCount) {
        return b.testsCount - a.testsCount;
      }
      if (b.avg !== a.avg) {
        return b.avg - a.avg;
      }
      if (a.latestTestOriginalIndex !== b.latestTestOriginalIndex) {
        return a.latestTestOriginalIndex - b.latestTestOriginalIndex; // صاحب التوقيت الأقدم يكسب
      }
      return a.name.localeCompare(b.name, 'ar');
    });

    let goldCount = 0;
    let silverCount = 0;
    let bronzeCount = 0;

    const limitedSorted: {name: string, phone: string, score: number, avg: number, testsCount: number, tier: string, trend: string}[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      let tier = '';
      // القائمة الذهبية: بحد أقصى 10 طلاب، وبشرط معدل 90% فما فوق (المراكز 1 إلى 10)
      if (goldCount < 10 && s.avg >= 90) {
        tier = 'gold';
        goldCount++;
      } 
      // القائمة الفضية: بحد أقصى 10 طلاب (المراكز 11 إلى 20 أو الفائض من الذهبية) بمعدل 80% فما فوق
      else if (silverCount < 10) {
        tier = 'silver';
        silverCount++;
      } 
      // القائمة البرونزية: بحد أقصى 10 طلاب (المراكز 21 إلى 30) بمعدل 80% فما فوق
      else if (bronzeCount < 10) {
        tier = 'bronze';
        bronzeCount++;
      }
      if (tier) {
        limitedSorted.push({ ...s, tier, trend: s.trend });
      }
      if (goldCount + silverCount + bronzeCount >= 30) break;
    }
    return limitedSorted;
  };

  const adminLeaderboardList = useMemo(() => {
    if (adminActiveTab !== 'leaderboard') return [];
    return calculateAdminLeaderboard();
  }, [adminActiveTab, adminResults, data, publishedLessons]);

  const handleAdminCongratulateTier = (tier: 'gold' | 'silver' | 'bronze') => {
    const list = adminLeaderboardList.length > 0 ? adminLeaderboardList : calculateAdminLeaderboard();
    const tierTitle = tier === 'gold' ? 'القائمة الذهبية' : tier === 'silver' ? 'القائمة الفضية' : 'القائمة البرونزية';
    const studentsInTier = list.filter(s => s.tier === tier);
    if (studentsInTier.length === 0) {
        showAlert(`لا يوجد طلاب في ${tierTitle} لتهنئتهم.`);
        return;
    }

    const sortedStudents = studentsInTier.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.testsCount - a.testsCount;
    });

    const studentNames = sortedStudents
        .map((s, idx) => `${toEasternArabic(idx + 1)}. ${s.name.split(' ').slice(0, 4).join(' ')}`)
        .join('\n');

    const message = `🏆 تهانينا لأبطال ${tierTitle} في موسوعة الكنز! 🏆\n\nنفخر بكم وبمجهودكم الرائع:\n${studentNames}\n\nمع تمنياتنا بدوام التفوق والنجاح،\nأ/ إسلام سعود`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    showAlert(`جاري فتح واتساب مع رسالة التهنئة لـ ${tierTitle}.`);
  };

  const handleToggleLesson = (lessonId: string) => {
    setPublishedLessons(prev => {
      let currentList = prev;
      if (currentList.length === 0 && localStorage.getItem('publishedLessons_init') !== 'true') {
        currentList = data.flatMap(u => u.lessons.map(l => l.id));
      }
      const next = currentList.includes(lessonId) 
        ? currentList.filter(id => id !== lessonId) 
        : [...currentList, lessonId];
      localStorage.setItem('publishedLessons', JSON.stringify(next));
      localStorage.setItem('publishedLessons_init', 'true');
      return next;
    });
  };

  const handleToggleUnitAll = (unitId: string, publish: boolean) => {
    const targetUnit = data.find(u => u.id === unitId);
    if (!targetUnit) return;
    const unitLessonIds = targetUnit.lessons.map(l => l.id);
    setPublishedLessons(prev => {
      let currentList = prev;
      if (currentList.length === 0 && localStorage.getItem('publishedLessons_init') !== 'true') {
        currentList = data.flatMap(u => u.lessons.map(l => l.id));
      }
      let next: string[];
      if (publish) {
        next = Array.from(new Set([...currentList, ...unitLessonIds]));
      } else {
        next = currentList.filter(id => !unitLessonIds.includes(id));
      }
      localStorage.setItem('publishedLessons', JSON.stringify(next));
      localStorage.setItem('publishedLessons_init', 'true');
      return next;
    });
  };

  const handleSavePublishedLessons = async () => {
    setIsSavingLessons(true);
    try {
      localStorage.setItem('publishedLessons', JSON.stringify(publishedLessons));
      localStorage.setItem('publishedLessons_init', 'true');
      const allConfigs = getAllExamConfigs();
      const currentGeminiKey = geminiKeyInput ? geminiKeyInput.trim() : getGeminiApiKey();
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateSettings',
          fee: platformFee,
          announcement: announcement,
          timerMode: timerMode,
          timerUnitTarget: JSON.stringify(timerUnitTargets),
          timerSecondsPerQ: timerSecondsPerQ,
          timerType: timerType,
          examTotalMinutes: examTotalMinutes,
          publishedLessons: JSON.stringify(publishedLessons),
          geminiApiKey: currentGeminiKey,
          showMistakesNotebook: showMistakesNotebookSetting,
          showResetButtons: showResetButtonSetting,
          certSettings: JSON.stringify(certSettings),
          securitySettings: JSON.stringify(securitySettings),
          examConfigs: JSON.stringify(allConfigs),
          apiKey: SECRET_API_KEY
        })
      });
      showAlert('تم حفظ وتحديث حالة نشر الدروس وجدولة الامتحانات للطلاب بنجاح! 🚀');
    } catch(e) {
      showAlert('تم الحفظ في المتصفح بنجاح! (يرجى التأكد من اتصال الإنترنت لتحديث السيرفر)');
    }
    setIsSavingLessons(false);
  };

  const handleSyncExamConfigsToCloud = async (silent: boolean = false): Promise<boolean> => {
    setIsSyncingExamConfigs(true);
    try {
      const allConfigs = getAllExamConfigs();
      const currentGeminiKey = geminiKeyInput ? geminiKeyInput.trim() : getGeminiApiKey();
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateSettings',
          fee: platformFee,
          announcement: announcement,
          timerMode: timerMode,
          timerUnitTarget: JSON.stringify(timerUnitTargets),
          timerSecondsPerQ: timerSecondsPerQ,
          timerType: timerType,
          examTotalMinutes: examTotalMinutes,
          publishedLessons: JSON.stringify(publishedLessons),
          geminiApiKey: currentGeminiKey,
          showMistakesNotebook: showMistakesNotebookSetting,
          showResetButtons: showResetButtonSetting,
          certSettings: JSON.stringify(certSettings),
          securitySettings: JSON.stringify(securitySettings),
          examConfigs: JSON.stringify(allConfigs),
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      if (data && data.status === 'success') {
        if (!silent) {
          showAlert('تم رفع ومزامنة كافة جداول ومواعيد الامتحانات إلى السحابة بنجاح! ☁️✨');
        }
        setIsSyncingExamConfigs(false);
        return true;
      } else {
        if (!silent) {
          showAlert('تعذر حفظ الجداول بالسحابة: ' + ((data && data.message) || 'خطأ غير معروف'));
        }
        setIsSyncingExamConfigs(false);
        return false;
      }
    } catch (e: any) {
      console.warn("Cloud sync exam configs warning:", e);
      if (!silent) {
        showAlert('تم حفظ الإعدادات في المتصفح بنجاح! 💾\n(تعذر الاتصال بالسحابة حالياً، وسيتم رفعها تلقائياً عند استقرار الإنترنت).');
      }
      setIsSyncingExamConfigs(false);
      return false;
    }
  };

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}`); 
      const resData = await res.json();
      if(resData.status === 'success') {
        const grouped: Record<string, { phone: string; tests: TestResult[] }> = {};
        const chronologicalData = [...resData.data].reverse() as TestResult[];
        chronologicalData.forEach((r, idx) => {
          let correctName = r.name;
          const formattedPhone = formatPhoneStr(r.phone);
          const stRecord = studentsList[formattedPhone];

          if (stRecord) {
            const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
            const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());

            if (matchedStudent) {
              correctName = matchedStudent.name;
            } else {
              if (stArr.length === 1) {
                correctName = stArr[0].name;
              }
            }
          }

          if(!grouped[correctName]) grouped[correctName] = { phone: r.phone, tests: [] };
          grouped[correctName].tests.push({ ...r, originalIndex: idx } as any);
        });
        const onlinePhoneSet = new Set((adminOnlineStudents || []).map(s => formatPhoneStr(s.phone)));
        const sortedArray: GroupedResult[] = Object.keys(grouped)
          .sort((a,b)=>a.localeCompare(b, 'ar'))
          .map(k => {
            const ph = grouped[k].phone;
            const isOnline = onlinePhoneSet.has(formatPhoneStr(ph)) || grouped[k].tests.some(t => t.studentType === 'أونلاين');
            return { 
              name: k, 
              phone: ph, 
              tests: grouped[k].tests,
              studentType: isOnline ? 'أونلاين' : 'سنتر'
            };
          });
        setAdminResults(sortedArray);
      }
      const reqRes = await fetch(`${API_URL}?action=getPendingRequests&apiKey=${SECRET_API_KEY}`); 
      const reqData = await reqRes.json();
      if(reqData.status === 'success') {
        setAdminPendingReqs(reqData.data as PendingRequest[]);
      }

      // جلب مشتركي الأونلاين النشطين
      try {
        const onlRes = await fetch(`${API_URL}?action=getOnlineStudents&apiKey=${SECRET_API_KEY}`);
        const onlData = await onlRes.json();
        if (onlData.status === 'success' && Array.isArray(onlData.data)) {
          setAdminOnlineStudents(onlData.data as OnlineStudent[]);
        }
      } catch(e) {}

      // جلب أرشيف طلاب الأونلاين
      try {
        const archRes = await fetch(`${API_URL}?action=getArchivedOnlineStudents&apiKey=${SECRET_API_KEY}`);
        const archData = await archRes.json();
        if (archData.status === 'success' && Array.isArray(archData.data)) {
          setAdminArchivedOnlineStudents(archData.data as OnlineStudent[]);
        }
      } catch(e) {}

      try {
        const stdRes = await fetch(`${API_URL}?action=getAllStudents&apiKey=${SECRET_API_KEY}`);
        const stdData = await stdRes.json();
        if(stdData.status === 'success' && stdData.data) {
          setStudentsList(stdData.data);
        }
      } catch(e) {}

      // جلب تسليمات المقالي من السحابة لتحديث شارة الإشعارات ولوحة المعلم
      try {
        const essayRes = await fetch(`${API_URL}?action=getEssaySubmissions&apiKey=${SECRET_API_KEY}`);
        const essayData = await essayRes.json();
        if (essayData && essayData.status === 'success' && Array.isArray(essayData.data)) {
          const groupedMap = new Map<string, any>();
          essayData.data.forEach((row: any) => {
            if (!row.studentPhone || !row.quizTitle) return;
            const cleanPhone = formatPhoneStr(row.studentPhone);
            const key = `${cleanPhone}___${row.quizTitle.trim()}`;
            if (!groupedMap.has(key)) {
              groupedMap.set(key, {
                id: `cloud_${key}`,
                studentName: row.studentName || 'طالب',
                studentPhone: cleanPhone,
                quizTitle: row.quizTitle.trim(),
                lessonId: row.quizTitle.trim(),
                submissionDate: row.date || '',
                studentType: row.studentType || 'سنتر',
                questions: [],
                isFullyApproved: false,
                finalScore: 0,
                maxPossibleScore: 0
              });
            }
            const grp = groupedMap.get(key)!;
            const scoreNum = row.teacherScore !== "" && row.teacherScore !== undefined ? Number(row.teacherScore) : undefined;
            const isAppr = String(row.status || '').trim() === 'معتمد';
            const cleanQText = (row.questionText || `سؤال مقالي ${grp.questions.length + 1}`).trim();

            const existingQ = grp.questions.find((q: any) => q.questionText.trim() === cleanQText);
            if (existingQ) {
              if (scoreNum !== undefined && existingQ.teacherScore === undefined) existingQ.teacherScore = scoreNum;
              if (row.teacherFeedback && !existingQ.teacherFeedback) existingQ.teacherFeedback = row.teacherFeedback;
              if (!existingQ.isApproved && isAppr) existingQ.isApproved = true;
              return;
            }

            grp.questions.push({
              qIndex: grp.questions.length,
              questionText: cleanQText,
              essayType: 'سؤال مقالي',
              modelAnswer: '',
              studentText: row.studentAnswerText || '',
              maxScore: 2,
              teacherScore: scoreNum,
              teacherFeedback: row.teacherFeedback || '',
              isApproved: isAppr
            });
          });
          const cloudSubs: StudentEssaySubmission[] = [];
          groupedMap.forEach(grp => {
            grp.isFullyApproved = grp.questions.length > 0 && grp.questions.every((q: any) => q.isApproved);
            cloudSubs.push(grp);
          });
          const localList = getPendingEssaySubmissions();
          const mergedMap = new Map<string, StudentEssaySubmission>();
          cloudSubs.forEach(cs => mergedMap.set(`${formatPhoneStr(cs.studentPhone)}___${cs.quizTitle.trim()}`, cs));
          localList.forEach(ls => {
            const mKey = `${formatPhoneStr(ls.studentPhone)}___${ls.quizTitle.trim()}`;
            if (!mergedMap.has(mKey)) mergedMap.set(mKey, ls);
          });
          localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(Array.from(mergedMap.values())));
        }
      } catch(e) {}
    } catch(e) { 
      console.warn('fetchAdminData connection error:', e);
    }
    setIsLoading(false);
  };

  const handleSyncDriveBackups = async () => {
    showConfirm('هل تريد بدء مزامنة اشتراكات مرحلة 2 بكالوريا (2 ثانوي) من مجلد Google Drive الآن؟', async () => {
      setIsSyncingDrive(true);
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'syncDriveBackups',
            stage: 's2',
            folderId: '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM',
            apiKey: SECRET_API_KEY
          })
        });
        const rawText = await response.text();
        let res: any;
        try {
          res = JSON.parse(rawText);
        } catch {
          throw new Error('استجاب الخادم بصيغة غير متوقعة. قد تكون سحابة Google قيد الصيانة أو انتهت مهلة الانتظار.');
        }
        if (res.status === 'success') {
          showAlert(`✅ تمت المزامنة السحابية بنجاح!\n\n📄 الملف: ${res.fileName || 'أحدث ملف'}\n📅 تاريخ الباك آب: ${res.fileDate || ''}\n👥 إجمالي طلاب المرحلة بالنظام: ${res.totalTargetStudents || 0}\n✨ الطلاب المحدثة اشتراكاتهم: ${res.updatedCount || 0}\n➕ الطلاب الجدد المضافين: ${res.addedCount || 0}\n💳 إجمالي الشهور المسددة: ${res.monthsUpdatedCount || 0}`);
          fetchAdminData();
        } else {
          showAlert(`❌ فشلت المزامنة: ${res.message || 'حدث خطأ غير معروف'}`);
        }
      } catch (err: any) {
        showAlert(`❌ خطأ في الاتصال بالسيرفر: ${err.message || 'فشل الاتصال'}`);
      } finally {
        setIsSyncingDrive(false);
      }
    });
  };

  const handleSyncLocalBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsSyncingLocal(true);
    const reader = new FileReader();
    reader.onerror = () => {
      showAlert('❌ فشل قراءة الملف من جهازك. يرجى التأكد من صلاحيات الملف والمحاولة مرة أخرى.');
      setIsSyncingLocal(false);
      e.target.value = '';
    };
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch {
          showAlert('❌ الملف غير صالح: صيغة JSON معطوبة أو تالفة.');
          setIsSyncingLocal(false);
          return;
        }

        if (!parsed || !parsed.students) {
          showAlert('❌ الملف غير صالح: لا يحتوي على بيانات طلاب.');
          setIsSyncingLocal(false);
          return;
        }

        // تصفية طلاب مرحلة s2 فقط لتقليل حجم البيانات المرسلة وسرعة المعالجة
        const s2Students = (parsed.students || []).filter((s: any) => String(s.stage || '').trim() === 's2');
        const s2StudentIds = new Set(s2Students.map((s: any) => String(s.id)));
        const s2Transactions = (parsed.transactions || []).filter((t: any) => s2StudentIds.has(String(t.sid)) || String(t.stage || '').trim() === 's2');

        const response = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'syncLocalBackup',
            stage: 's2',
            students: s2Students,
            transactions: s2Transactions,
            apiKey: SECRET_API_KEY
          })
        });
        const rawText = await response.text();
        let res: any;
        try {
          res = JSON.parse(rawText);
        } catch {
          throw new Error('استجاب الخادم بصيغة غير متوقعة أثناء معالجة ملف النسخة الاحتياطية.');
        }
        if (res.status === 'success') {
          showAlert(`✅ تم تحديث الاشتراكات من الملف المحلي بنجاح!\n\n👥 إجمالي طلاب المرحلة بالملف: ${res.totalTargetStudents || s2Students.length}\n✨ الطلاب المحدثة اشتراكاتهم: ${res.updatedCount || 0}\n➕ الطلاب الجدد المضافين: ${res.addedCount || 0}\n💳 إجمالي الشهور المسددة: ${res.monthsUpdatedCount || 0}`);
          fetchAdminData();
        } else {
          showAlert(`❌ فشل التحديث: ${res.message || 'حدث خطأ غير معروف'}`);
        }
      } catch (err: any) {
        showAlert(`❌ خطأ أثناء معالجة الملف: ${err.message || 'ملف غير صالح'}`);
      } finally {
        setIsSyncingLocal(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadAdminCert = (
    studentName: string, 
    unitTitle: string, 
    unitPerc: number, 
    certType: 'lesson' | 'unit' | 'comprehensive' = 'unit'
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 700;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
  
    ctx.direction = "rtl";
    const gradient = ctx.createLinearGradient(0, 0, 1000, 700);
    gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1000, 700);
  
    ctx.strokeStyle = '#d97706'; ctx.lineWidth = 15; ctx.strokeRect(30, 30, 940, 640);
    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 3; ctx.strokeRect(50, 50, 900, 600);
  
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    
    ctx.fillStyle = '#1e3a8a'; ctx.font = 'bold 70px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('شكر وتقدير', 500, 120);
    ctx.fillStyle = '#475569'; ctx.font = 'bold 26px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :', 500, 205);
    ctx.fillStyle = '#d97706'; ctx.font = '900 50px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(studentName, 500, 275);
    
    // سطر 1: نوع الإنجاز في سطر مستقل
    let introText = 'نظراً لمجهوده وتفانيه لإتمام:';
    if (certType === 'lesson') {
      introText = 'نظراً لتفوقه واجتيازه بجدارة اختبار:';
    } else if (certType === 'comprehensive') {
      introText = 'نظراً لنبوغه وتفوقه في:';
    } else if (certType === 'unit') {
      introText = 'نظراً لإتمام واجتياز جميع دروس:';
    }
    ctx.fillStyle = '#475569'; ctx.font = 'bold 23px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(introText, 500, 340);

    // سطر 2: اسم الدرس أو الوحدة في السطر الأسفل منه بشارة مميزة تمنع الخروج عن الإطار
    const rawUnitTitle = (unitTitle || '').trim();
    const formattedUnitTitle = `« ${rawUnitTitle} »`;
    let titleFontSize = 26;
    if (rawUnitTitle.length > 55) {
      titleFontSize = 19;
    } else if (rawUnitTitle.length > 40) {
      titleFontSize = 22;
    }

    ctx.font = `900 ${titleFontSize}px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif`;
    const measuredTitleWidth = ctx.measureText(formattedUnitTitle).width;
    const badgeW = Math.min(840, measuredTitleWidth + 48);
    const badgeH = 42;
    const badgeX = 500 - (badgeW / 2);
    const badgeY = 388 - (badgeH / 2);

    ctx.fillStyle = '#eff6ff';
    if (typeof (ctx as any).roundRect === 'function') {
      ctx.beginPath();
      (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, 12);
      ctx.fill();
      ctx.strokeStyle = '#bfdbfe';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    }

    ctx.fillStyle = '#1d4ed8';
    ctx.font = `900 ${titleFontSize}px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif`;
    ctx.fillText(formattedUnitTitle, 500, 388);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = '900 27px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`ببراعة وعبقرية بنسبة ${toEasternArabic(unitPerc)}%`, 500, 448);
    ctx.fillStyle = '#db2777'; ctx.font = '900 31px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أكمل يا بطلي فحقاً فخور بك ❤️', 500, 510);
  
    ctx.beginPath(); ctx.moveTo(150, 560); ctx.lineTo(850, 560); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.stroke();
  
    ctx.fillStyle = '#0f172a'; ctx.font = '900 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أ/ إسلام سعود', 800, 615);
    ctx.fillStyle = '#16a34a'; ctx.font = '900 40px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`${toEasternArabic(unitPerc)}٪`, 500, 615);
    ctx.fillStyle = '#64748b'; ctx.font = 'bold 22px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(new Date().toLocaleDateString('ar-EG'), 220, 615);
  
    const link = document.createElement('a');
    const cleanStudent = studentName.trim().replace(/\s+/g, '_');
    const cleanTitle = unitTitle.trim().replace(/[:/\\?%*|"<>]/g, '').replace(/\s+/g, '_');
    link.download = `شهادة_${cleanStudent}_${cleanTitle}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleDownloadAllAdminCerts = async (list: { name: string; unitTitle: string; avg: number; certType?: 'lesson' | 'unit' | 'comprehensive' }[]) => {
    if (!list || list.length === 0) {
      showAlert('لا توجد شهادات للتحميل في هذا الاختيار.');
      return;
    }
    setIsLoading(true);
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      handleDownloadAdminCert(item.name, item.unitTitle, item.avg, item.certType || 'unit');
      if (i < list.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
    setIsLoading(false);
    showAlert(`تم بدء تنزيل جميع الشهادات (${toEasternArabic(list.length)} شهادة) بنجاح! 📥✨`);
  };
  
  const handleRegisterSubmit = async () => {
    if (!registerName || !registerMethod) { 
      showAlert('أدخل اسم الطالب واختر طريقة الدفع.'); 
      return; 
    }
    const formattedPhone = formatPhoneStr(inputPhone); 
    const sheetPhone = '+20' + formattedPhone.substring(1);
    const selectedPrice = selectedPackage === 'شهري' 
      ? packagePrices.monthly 
      : selectedPackage === 'ترم أول' 
        ? packagePrices.term1 
        : selectedPackage === 'ترم ثانٍ' 
          ? packagePrices.term2 
          : packagePrices.fullYear;

    const whatsappMsg = `السلام عليكم ورحمة الله وبركاته، أ/ إسلام سعود.\nأود الاشتراك في منصة الكنز التعليمي\nالاسم: ${registerName}\nرقم الهاتف: ${inputPhone}\nالمرحلة: ${gradeName}\nنوع الباقة: ${selectedPackage} (${selectedPrice} ج.م)\nطريقة السداد: ${registerMethod}\n(سأقوم بإرفاق صورة التحويل الآن لتأكيد السداد)`;
    window.open(`https://wa.me/201228466613?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
    try { 
      fetch(API_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'requestSubscription', 
          date: new Date().toLocaleString('ar-EG'), 
          name: registerName, 
          phone: sheetPhone, 
          method: registerMethod, 
          packageType: selectedPackage,
          amount: selectedPrice,
          apiKey: SECRET_API_KEY 
        }) 
      }); 
    } catch(e) {}
  };
  
  const handleActivateMonth = async (phone: string, name: string, month: string) => {
    showConfirm(`تفعيل شهر (${month}) للطالب: ${name}؟`, async () => {
      try {
        fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'activateSpecificMonth', 
            phone: phone, 
            month: month, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        setStudentsList(prev => {
          const newList = {...prev};
          if(newList[phone]) {
            const listArr = Array.isArray(newList[phone]) ? newList[phone] : [newList[phone]];
            newList[phone] = (listArr as Student[]).map(s => 
              s.name === name 
                ? { 
                    ...s, 
                    missingMonths: s.missingMonths ? s.missingMonths.filter(m => m !== month) : [], 
                    isPaid: s.missingMonths ? s.missingMonths.length <= 1 : true 
                  } 
                : s
            );
          }
          return newList;
        });
        
        setTimeout(() => {
          showConfirm(`تم التفعيل بنجاح لـ ${name}!\nهل تحب إرسال رسالة تأكيد عبر الواتساب؟\n(تأكيد للإرسال، وإلغاء للتخطي)`, () => {
            const msg = `${name} : لقد تم تفعيلكم في منصة موسوعة الكنز\nتمنياتي بالتوفيق\n*أ/إسلام سعود*`;
            window.open(`https://wa.me/20${formatPhoneStr(phone).substring(1)}?text=${encodeURIComponent(msg)}`, '_blank');
          });
        }, 300);
      } catch(e) { 
        showAlert('حدث خطأ'); 
      }
    });
  };

  const handleResetDevice = (phone: string, name: string) => {
    showConfirm(`هل أنت متأكد من فك ارتباط الجهاز للطالب: ${name}؟\nسيتمكن من الدخول من جهاز جديد.`, async () => {
      try {
        const res = await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'resetDevice', 
            phone: `${formatPhoneStr(phone)}_${name}`, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        const data = await res.json();
        if (data.status === 'success') {
          showAlert(`تم فك ارتباط الجهاز للطالب ${name} بنجاح! ✅\nيمكنه الآن تسجيل الدخول من جهازه الجديد.`);
        } else {
          showAlert(data.message || 'لم يتم العثور على جهاز مرتبط بهذا الطالب.');
        }
      } catch(e) { 
        showAlert('حدث خطأ أثناء الاتصال بالخادم.'); 
      }
    });
  };

  const handleBlockStudent = (phone: string, name: string) => {
    showConfirm(`هل أنت متأكد من حظر الطالب: ${name}؟\nلن يتمكن من الدخول للمنصة بعد ذلك.`, async () => {
      try {
        fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'blockStudent', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        setStudentsList(prev => {
          const newList = {...prev};
          if(newList[phone]) {
            const listArr = Array.isArray(newList[phone]) ? newList[phone] : [newList[phone]];
            newList[phone] = (listArr as Student[]).map(s => 
              s.name === name ? { ...s, isBlocked: true } as unknown as Student : s
            );
          }
          return newList;
        });
        showAlert(`تم حظر الطالب ${name} بنجاح! 🚫`);
      } catch(e) { 
        showAlert('حدث خطأ أثناء الاتصال بالخادم.'); 
      }
    });
  };

  const handleUnblockStudent = (phone: string, name: string) => {
    showConfirm(`هل أنت متأكد من فك الحظر عن الطالب: ${name}؟\nسيتمكن من الدخول للمنصة مرة أخرى.`, async () => {
      try {
        fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'unblockStudent', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        setStudentsList(prev => {
          const newList = {...prev};
          if(newList[phone]) {
            const listArr = Array.isArray(newList[phone]) ? newList[phone] : [newList[phone]];
            newList[phone] = (listArr as Student[]).map(s => 
              s.name === name ? { ...s, isBlocked: false } as unknown as Student : s
            );
          }
          return newList;
        });
        
        setTimeout(() => {
          showConfirm(`تم فك الحظر عن الطالب ${name} بنجاح! ✅\nهل تحب إرسال رسالة تبشره بذلك عبر الواتساب؟`, () => {
            const msg = `أهلاً بك يا ${name} 🌟\nنبشرك بأنه قد تم فك الحظر عن حسابك، ويمكنك الآن الدخول لمنصة موسوعة الكنز التعليمي ومواصلة التدريب.\nتمنياتي لك بالتوفيق،\n*أ/إسلام سعود*`;
            window.open(`https://wa.me/20${formatPhoneStr(phone).substring(1)}?text=${encodeURIComponent(msg)}`, '_blank');
          });
        }, 300);
        
      } catch(e) { 
        showAlert('حدث خطأ أثناء الاتصال بالخادم.'); 
      }
    });
  };

  const handleGrantNewAttempt = (phone: string, name: string, lessonTitle: string) => {
    showConfirm(`هل أنت متأكد من منح الطالب: ${name} فرصة رسمية جديدة في امتحان:\n"${lessonTitle}"؟\nسيتمكن الطالب من أداء الامتحان وتحديث درجته الرسمية في لوحة الشرف والشيت.`, async () => {
      try {
        const cleanQuizName = `فرصة جديدة 🔄: ${lessonTitle}`;
        await saveResultToDB({
          studentPhone: phone,
          studentName: name,
          quizName: cleanQuizName,
          score: 'تصفير 🔄'
        });

        // إذا كان هذا الطالب هو المستخدم المسجل حالياً في المتصفح، تصفير حالته المحلية للدرس
        const currentPhone = formatPhoneStr(inputPhone || localStorage.getItem('loggedInPhone') || '');
        if (formatPhoneStr(phone) === currentPhone) {
          const targetLesson = data.flatMap(u => u.lessons).find(l => normalizeLessonName(l.title) === normalizeLessonName(lessonTitle));
          if (targetLesson) {
            setLessonScores(prev => {
              const newScores = { ...prev };
              delete newScores[targetLesson.id];
              localStorage.setItem('lessonScores', JSON.stringify(newScores));
              return newScores;
            });
            try {
              const newCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]').filter((id: string) => id !== targetLesson.id);
              localStorage.setItem('completedLessons', JSON.stringify(newCompleted));
            } catch(e) {}
          }
        }

        // تحديث adminResults في الذاكرة حتى ينعكس التغيير فوراً في لوحة التحكم والشاشة التحليلية
        setAdminResults(prev => {
          return prev.map(st => {
            if (st.phone === phone && st.name.trim() === name.trim()) {
              const newTests = (st.tests || []).filter(t => {
                const normT = normalizeLessonName(t.quiz);
                const normL = normalizeLessonName(lessonTitle);
                return !normT.includes(normL) && !normL.includes(normT);
              });
              return { ...st, tests: newTests };
            }
            return st;
          });
        });

        // أيضاً تحديث selectedStudentForAnalytics
        setSelectedStudentForAnalytics(prev => {
          if (!prev) return null;
          const newTests = (prev.tests || []).filter(t => {
            const normT = normalizeLessonName(t.quiz);
            const normL = normalizeLessonName(lessonTitle);
            return !normT.includes(normL) && !normL.includes(normT);
          });
          return { ...prev, tests: newTests };
        });

        showAlert(`تم منح فرصة جديدة للطالب "${name}" بنجاح! 🔄✨\nيمكن للطالب الآن الدخول للاختبار وحله كأول محاولة رسمية.`);
      } catch (e) {
        showAlert('حدث خطأ أثناء منح الفرصة الجديدة.');
      }
    });
  };
  
    const formatWhatsAppPhone = (rawPhone: string) => {
    let p = String(rawPhone || '').replace(/[^0-9]/g, '');
    if (p.startsWith('002')) p = p.substring(3);
    if (p.startsWith('20')) return p;
    if (p.startsWith('0')) return '20' + p.substring(1);
    return '20' + p;
  };

  const sendWhatsAppStudentWelcome = (phone: string, name: string, code: string, pkgType: string) => {
    const appLink = OFFICIAL_APP_URL;
    const cleanP = formatWhatsAppPhone(phone);
    const welcomeMsg = `أهلاً بك يا بطل في موسوعة الكنز التعليمي 🎓\nيسعدنا انضمامك معنا في منصة التاريخ (2 بكالوريا) للأستاذ / إسلام سعود ✨\n\nتم تفعيل اشتراكك بنجاح (${pkgType})، وبيانات دخولك هي:\n📱 رقم الهاتف المسجل: ${phone}\n🔑 كود الطالب: ${code}\n🌐 رابط المنصة: ${appLink}\n\nنتمنى لك رحلة تفوق مميزة والدرجة النهائية بإذن الله! 🌟`;
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(welcomeMsg)}`;
    const opened = window.open(waUrl, '_blank');
    if (!opened) {
      window.location.href = waUrl;
    }
  };

  const getOnlineSubscriptionStatus = (st: OnlineStudent) => {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthIdx = today.getMonth(); // 0 = Jan, 9 = Oct
    const monthNamesMap: Record<number, string> = {
      8: "أغسطس", 9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
      1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل", 5: "مايو",
      6: "يونيو", 7: "يوليو"
    };
    const currentMonthName = monthNamesMap[currentMonthIdx + 1] || "أكتوبر";
    const activeMonthsStr = (st.activeMonths || '').replace(/،/g, ',');
    const activeMonthsArr = activeMonthsStr.split(',').map(m => m.trim()).filter(Boolean);

    if (st.packageType === 'سنة كاملة' || activeMonthsStr.includes('العام')) {
      return { status: 'active', label: 'ساري ونشط 🌟', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' };
    }

    const isCurrentActive = activeMonthsArr.includes(currentMonthName) || activeMonthsArr.some(m => m.includes(currentMonthName));

    if (!isCurrentActive) {
      return { status: 'expired', label: 'منتهي الصلاحية 🔴', color: 'bg-red-50 text-red-800 border-red-300' };
    }

    if (currentDay >= 20 || currentDay <= 5) {
      return { status: 'expiring', label: 'يوشك على الانتهاء ⏳', color: 'bg-amber-50 text-amber-900 border-amber-300' };
    }

    return { status: 'active', label: 'ساري ونشط 🟢', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' };
  };

  const sendWhatsAppRenewalReminder = (phone: string, name: string, pkgType: string) => {
    const cleanP = formatWhatsAppPhone(phone);
    const msg = `أهلاً بك يا بطل في موسوعة الكنز التعليمي 🎓\nالأستاذ / إسلام سعود يحييك ويتمنى لك دوام التفوق والتميز ✨\n\nنود تذكيرك بأن اشتراكك الحالي (${pkgType}) يوشك على الانتهاء.\nلضمان استمرار فتح الامتحانات وبنك الأسئلة ومتابعة التدريبات دون توقف، يمكنك تجديد الاشتراك بسهولة عبر:\n📱 فودافون كاش / إنستاباي: 01228466613\n\nبعد التحويل، يرجى إرسال صورة التحويل ليتم تجديد تفعيل حسابك فوراً.\nبالتوفيق دائماً يا بطل والدرجة النهائية بإذن الله! 🌟`;
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(msg)}`;
    const opened = window.open(waUrl, '_blank');
    if (!opened) window.location.href = waUrl;
  };

  const handleCancelOnlineSubscription = (st: OnlineStudent) => {
    showConfirm(`هل أنت متأكد من إلغاء اشتراك الطالب: ${st.name}؟\nسيتم نقله إلى الأرشيف لحفظ الحقوق المالية وإيقاف دخوله للمنصة.`, async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'deleteOnlineStudent',
            phone: st.phone,
            name: st.name,
            reason: 'إلغاء اشتراك من لوحة الإدارة',
            apiKey: SECRET_API_KEY
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          setAdminOnlineStudents(prev => prev.filter(s => s.phone !== st.phone));
          setAdminArchivedOnlineStudents(prev => [{ ...st, reason: 'إلغاء اشتراك من لوحة الإدارة' }, ...prev]);
          showConfirm(`تم إلغاء اشتراك ${st.name} ونقله للأرشيف بنجاح! ✅\nهل ترغب في إرسال إشعار مهذب للطالب عبر واتساب؟`, () => {
            const cleanP = formatWhatsAppPhone(st.phone);
            const cancelMsg = `السلام عليكم يا ${st.name} 🎓\nنود إعلامك بأنه تم إيقاف أو انتهاء اشتراكك في موسوعة الكنز التعليمي.\nفي حال رغبتك في تجديد الاشتراك واستئناف التدريبات في أي وقت، يسعدنا تواصلك معنا دائماً.\nتمنياتنا لك بالتوفيق والنجاح،\nأ/ إسلام سعود ✨`;
            window.open(`https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(cancelMsg)}`, '_blank');
          });
          setTimeout(fetchAdminData, 1500);
        } else {
          showAlert(data.message || 'حدث خطأ أثناء إلغاء الاشتراك.');
        }
      } catch(e) {
        showAlert('خطأ في الاتصال بالخادم.');
      }
    });
  };

  const handleRenewOnlineStudent = async () => {
    if (!selectedOnlineForRenewal) return;
    setIsRenewingOnline(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'renewOnlineStudent',
          phone: selectedOnlineForRenewal.phone,
          name: selectedOnlineForRenewal.name,
          packageType: renewalPackage,
          month: renewalMonth,
          amount: renewalAmount,
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        const renewedMonths = data.activeMonths || (renewalPackage === 'شهري' ? `${selectedOnlineForRenewal.activeMonths || ''}، ${renewalMonth}` : renewalPackage);
        setAdminOnlineStudents(prev => prev.map(s => s.phone === selectedOnlineForRenewal.phone ? {
          ...s,
          packageType: renewalPackage,
          activeMonths: renewedMonths,
          amount: String(Number(s.amount || 0) + Number(renewalAmount || 0))
        } : s));
        
        showConfirm(`تم تجديد باقة الطالب ${selectedOnlineForRenewal.name} بنجاح! ✅\nهل ترغب في إرسال رسالة تأكيد التجديد للطالب عبر واتساب؟`, () => {
          const cleanP = formatWhatsAppPhone(selectedOnlineForRenewal.phone);
          const msg = `أهلاً بك يا ${selectedOnlineForRenewal.name} 🎓\nتم تجديد اشتراكك بنجاح في موسوعة الكنز التعليمي ✨\n\n📌 تفاصيل التجديد:\n• الباقة: ${renewalPackage === 'شهري' ? `شهر ${renewalMonth}` : renewalPackage}\n• الشهور المفعلة: ${renewedMonths}\n• كود الدخول: ${selectedOnlineForRenewal.code}\n\nنتمنى لك دوام التفوق والنجاح مع أ/ إسلام سعود! 🌟`;
          window.open(`https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(msg)}`, '_blank');
        });
        setSelectedOnlineForRenewal(null);
        setTimeout(fetchAdminData, 1500);
      } else {
        showAlert(data.message || 'حدث خطأ أثناء تجديد الاشتراك.');
      }
    } catch (e) {
      showAlert('خطأ في الاتصال بالخادم أثناء التجديد.');
    }
    setIsRenewingOnline(false);
  };

  const handleEditOnlineStudent = async () => {
    if (!selectedOnlineForEdit) return;
    if (!editOnlineName.trim() || !editOnlinePhone.trim()) {
      showAlert('يرجى إدخال اسم الطالب ورقم الهاتف.');
      return;
    }
    setIsEditingOnline(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'editOnlineStudent',
          phone: selectedOnlineForEdit.phone,
          oldPhone: selectedOnlineForEdit.phone,
          name: editOnlineName.trim(),
          newPhone: editOnlinePhone.trim(),
          packageType: editOnlinePackage,
          amount: editOnlineAmount,
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setAdminOnlineStudents(prev => prev.map(s => s.phone === selectedOnlineForEdit.phone ? {
          ...s,
          name: editOnlineName.trim(),
          phone: editOnlinePhone.trim(),
          packageType: editOnlinePackage,
          amount: editOnlineAmount
        } : s));
        showAlert('تم حفظ تعديلات بيانات الطالب بنجاح! ✅');
        setSelectedOnlineForEdit(null);
        setTimeout(fetchAdminData, 1500);
      } else {
        showAlert(data.message || 'حدث خطأ أثناء تعديل بيانات الطالب.');
      }
    } catch (e) {
      showAlert('خطأ في الاتصال بالخادم.');
    }
    setIsEditingOnline(false);
  };

  const handleResetOnlineDevice = (st: OnlineStudent) => {
    showConfirm(`هل تريد فك ارتباط جهاز الطالب: ${st.name}؟\nسيتم مسح بصمة جهازه ليتمكن من تسجيل الدخول من جهاز جديد.`, async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'resetOnlineDevice',
            phone: st.phone,
            code: st.code,
            apiKey: SECRET_API_KEY
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          showAlert(`تم فك ارتباط جهاز الطالب ${st.name} بنجاح! ✅\nيمكن للطالب الآن تسجيل الدخول مباشرة من أي هاتف أو كمبيوتر جديد.`);
        } else {
          showAlert(data.message || 'حدث خطأ أثناء فك ارتباط الجهاز.');
        }
      } catch (e) {
        showAlert('خطأ في الاتصال بالسيرفر.');
      }
    });
  };

  const handleRestoreArchivedOnlineStudent = (st: OnlineStudent) => {
    showConfirm(`هل تريد استعادة الطالب ${st.name} من الأرشيف وإعادة تفعيل حسابه؟`, async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'restoreArchivedOnlineStudent',
            phone: st.phone,
            apiKey: SECRET_API_KEY
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          showAlert(`تمت استعادة الطالب ${st.name} بنجاح وإعادة تفعيله! ✅`);
          setAdminArchivedOnlineStudents(prev => prev.filter(s => s.phone !== st.phone));
          setAdminOnlineStudents(prev => [st, ...prev]);
          setTimeout(fetchAdminData, 1500);
        } else {
          showAlert(data.message || 'حدث خطأ أثناء استعادة الطالب.');
        }
      } catch (e) {
        showAlert('خطأ في الاتصال بالخادم.');
      }
    });
  };

  const generateOnlineCodeClient = (name: string, phone: string) => {
    const cleanP = formatPhoneStr(phone);
    const last4 = cleanP.length >= 4 ? cleanP.slice(-4) : ('0000' + cleanP).slice(-4);
    const mapChar: Record<string, string> = {
      'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': 'A',
      'ب': 'B', 'ت': 'T', 'ث': 'T', 'ج': 'G', 'ح': 'H',
      'خ': 'K', 'د': 'D', 'ذ': 'Z', 'ر': 'R', 'ز': 'Z',
      'س': 'S', 'ش': 'S', 'ص': 'S', 'ض': 'D', 'ط': 'T',
      'ظ': 'Z', 'ع': 'A', 'غ': 'G', 'ف': 'F', 'ق': 'K',
      'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H',
      'ة': 'H', 'و': 'W', 'ي': 'Y', 'ى': 'Y'
    };
    let firstLetter = 'A';
    if (name && name.trim().length > 0) {
      const rawFirst = name.trim().charAt(0);
      if (/[a-zA-Z]/.test(rawFirst)) {
        firstLetter = rawFirst.toUpperCase();
      } else if (mapChar[rawFirst]) {
        firstLetter = mapChar[rawFirst];
      }
    }
    return `${firstLetter}${last4}ESON`;
  };

  const handleOpenActivationModal = (req: PendingRequest) => {
    setSelectedActivationReq(req);
    setActivationPackage('شهري');
    setActivationMonth('أكتوبر');
    setActivationAmount('50');
  };

  const handleConfirmActivation = async () => {
    if (!selectedActivationReq) return;
    setIsActivatingOnline(true);
    const { name, phone, method } = selectedActivationReq;
    const generatedCode = generateOnlineCodeClient(name, phone);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'approveSubscription',
          code: generatedCode,
          studentCode: generatedCode,
          phone: phone,
          name: name,
          method: method || 'تحويل',
          packageType: activationPackage,
          month: activationMonth,
          amount: activationAmount,
          stage: '2 بكالوريا',
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      const finalCode = data.studentCode || generatedCode;

      setAdminPendingReqs(prev => prev.filter(r => r.phone !== phone || r.name !== name));
      setSelectedActivationReq(null);
      const pkgLabel = activationPackage === 'شهري' ? `اشتراك شهر ${activationMonth}` : activationPackage;
      setActivationSuccess({
        code: finalCode,
        name: name,
        phone: phone,
        packageType: pkgLabel
      });
      // تحديث فوري للقائمة المحلية
      setAdminOnlineStudents(prev => {
        const filtered = prev.filter(s => s.phone !== phone);
        return [{
          code: finalCode,
          name: name,
          phone: phone,
          stage: '2 بكالوريا',
          packageType: pkgLabel,
          activeMonths: activationPackage === 'شهري' ? activationMonth : (activationPackage === 'سنة كاملة' ? 'العام كاملاً' : activationPackage),
          method: method || 'تحويل',
          amount: activationAmount,
          date: new Date().toLocaleDateString('ar-EG')
        }, ...filtered];
      });
      setTimeout(fetchAdminData, 1500);
    } catch(e) {
      showAlert('حدث خطأ أثناء الاتصال بالخادم.');
    }
    setIsActivatingOnline(false);
  };

  const handleManualAddOnline = async () => {
    if (!manualOnlineName.trim() || !manualOnlinePhone.trim()) {
      showAlert('يرجى إدخال اسم الطالب ورقم الهاتف.');
      return;
    }
    setIsActivatingOnline(true);
    const name = manualOnlineName.trim();
    const phone = manualOnlinePhone.trim();
    const generatedCode = generateOnlineCodeClient(name, phone);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'addOnlineStudentDirectly',
          code: generatedCode,
          studentCode: generatedCode,
          phone: phone,
          name: name,
          method: manualOnlineMethod,
          packageType: activationPackage,
          month: activationMonth,
          amount: activationAmount,
          stage: '2 بكالوريا',
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      const finalCode = data.studentCode || generatedCode;

      setShowManualOnlineModal(false);
      setManualOnlineName('');
      setManualOnlinePhone('');
      setActivationSuccess({
        code: finalCode,
        name: name,
        phone: phone,
        packageType: activationPackage === 'شهري' ? `اشتراك شهر ${activationMonth}` : activationPackage
      });
      setTimeout(fetchAdminData, 2000);
    } catch(e) {
      showAlert('حدث خطأ أثناء إضافة الطالب.');
    }
    setIsActivatingOnline(false);
  };

  const handleApproveSubscription = async (phone: string, name: string) => {
    showConfirm(`تفعيل حساب: ${name}؟`, async () => {
      window.open(`https://wa.me/20${formatPhoneStr(phone).substring(1)}?text=${encodeURIComponent(`أهلاً بك ${name} تم التفعيل`)}`, '_blank');
      setAdminPendingReqs(prev => prev.filter(req => req.phone !== phone || req.name !== name));
      try { 
        await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'approveSubscription', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        }); 
        showAlert('تم التفعيل بنجاح وإضافة الطالب لجوجل شيت!'); 
        setTimeout(fetchAdminData, 2000);
      } catch(e) { 
        showAlert('خطأ في الاتصال بالخادم'); 
      }
    });
  };
  
  const handleRejectSubscription = async (phone: string, name: string) => {
    showConfirm(`رفض طلب: ${name}؟`, async () => {
      setAdminPendingReqs(prev => prev.filter(req => req.phone !== phone || req.name !== name));
      try { 
        await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'rejectSubscription', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        }); 
        showAlert('تم الرفض وإزالة الطلب من جوجل شيت!'); 
        setTimeout(fetchAdminData, 2000);
      } catch(e) { 
        showAlert('خطأ في الاتصال بالخادم'); 
      }
    });
  };
  

const APPS_SCRIPT_OPTIMIZED_CODE = `// =========================================================================
// موسوعة الكنز التعليمي - Google Apps Script (المعدل والمتوافق مع الشيت الجديد)
// =========================================================================
// تعليمات النشر:
// 1. افتح ملف Google Sheets الخاص بك.
// 2. من القائمة العلوية اختر: الإضافات (Extensions) -> Apps Script.
// 3. احذف أي كود موجود هناك والصق هذا الكود بالكامل بدلاً منه.
// 4. اضغط على الزر الأزرق: نشر (Deploy) -> إدارة عمليات النشر (Manage Deployments) أو نشر جديد (New Deployment).
// 5. تأكد من ضبط: الوصول إلى (Who has access) -> الجميع (Anyone).
// =========================================================================

// مفتاح الأمان السري (يجب أن يكون متطابقاً مع الموجود في التطبيق)
var SECRET_API_KEY = "Kanz_Secret_2026_Secure";

function doGet(e) {
  try {
    // 🛡️ حارس الأمان: التحقق من مفتاح الـ API
    if (!e.parameter || e.parameter.apiKey !== SECRET_API_KEY) {
      return respondJSON({status: 'error', message: 'Unauthorized Access'});
    }

    var action = e.parameter.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. جلب كل الطلاب والاشتراكات
    if (action === 'getAllStudents') {
      var studentsSheet = ss.getSheetByName("الطلاب");
      if (!studentsSheet) return respondJSON({status: 'error', message: 'شيت الطلاب غير موجود.'});
      
      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var studentsMap = {};
      
      // الكشف الذكي عن الأعمدة بناءً على رؤوس الأعمدة
      var colMap = findColumnIndices(headers);
      
      for (var i = 1; i < data.length; i++) {
        var name = String(data[i][colMap.name] || "").trim();
        var studentCode = colMap.code > -1 ? String(data[i][colMap.code] || "").trim() : "";
        var status = colMap.status > -1 ? String(data[i][colMap.status] || "").trim() : "";
        var rawPhone = colMap.phone > -1 ? data[i][colMap.phone] : "";
        var phone = cleanPhone(rawPhone);
        
        if (!phone) continue;

        var payInfo = calculateStudentPaymentStatus(headers, data[i], colMap);

        // فحص حالة الحظر
        var isBlocked = false;
        if (colMap.block > -1) {
          var blockVal = String(data[i][colMap.block]).trim();
          if (blockVal === 'نعم' || blockVal === 'true') {
            isBlocked = true;
          }
        }

        var regDate = colMap.regDate > -1 ? String(data[i][colMap.regDate] || "").trim() : "";

        if (!studentsMap[phone]) studentsMap[phone] = [];
        studentsMap[phone].push({
          name: name,
          code: studentCode,
          isPaid: payInfo.isPaid,
          missingMonths: payInfo.missingMonths,
          graceMonths: payInfo.graceMonths,
          graceDaysRemaining: payInfo.graceDaysRemaining,
          phone: phone,
          originalStatus: payInfo.originalStatus,
          isBlocked: isBlocked,
          registrationDate: regDate
        });
      }
      
      var settingsSheet = ss.getSheetByName("الإعدادات");
      var fee = "50 جنيهاً";
      var announcement = "";
      var timerMode, timerUnitTarget, timerSecondsPerQ;
      var timerType = "per_question";
      var examTotalMinutes = 50;
      var publishedLessons = "";
      var geminiApiKey = "";
      var showMistakesNotebook = true;
      var showResetButtons = true;
      var certSettings = "";
      var securitySettings = "";
      var examConfigs = "";

      if (settingsSheet) {
         var settingsData = settingsSheet.getDataRange().getValues();
         if (settingsData.length > 1) {
             if (settingsData[1][0]) fee = settingsData[1][0];
             if (settingsData[1].length > 1 && settingsData[1][1]) announcement = settingsData[1][1];
             if (settingsData[1].length > 2 && settingsData[1][2]) timerMode = settingsData[1][2];
             if (settingsData[1].length > 3 && settingsData[1][3] !== undefined) timerUnitTarget = settingsData[1][3];
             if (settingsData[1].length > 4 && settingsData[1][4] !== undefined) timerSecondsPerQ = settingsData[1][4];
             if (settingsData[1].length > 5 && settingsData[1][5] !== undefined) publishedLessons = settingsData[1][5];
             if (settingsData[1].length > 6 && settingsData[1][6] !== undefined && settingsData[1][6] !== "") timerType = settingsData[1][6];
             if (settingsData[1].length > 7 && settingsData[1][7] !== undefined && settingsData[1][7] !== "") examTotalMinutes = settingsData[1][7];
             if (settingsData[1].length > 8 && settingsData[1][8] !== undefined && settingsData[1][8] !== "") geminiApiKey = String(settingsData[1][8]).trim();
             if (settingsData[1].length > 9 && settingsData[1][9] !== undefined && settingsData[1][9] !== "") showMistakesNotebook = String(settingsData[1][9]).toLowerCase() !== "false";
             if (settingsData[1].length > 10 && settingsData[1][10] !== undefined && settingsData[1][10] !== "") showResetButtons = String(settingsData[1][10]).toLowerCase() !== "false";
             if (settingsData[1].length > 11 && settingsData[1][11] !== undefined && settingsData[1][11] !== "") certSettings = settingsData[1][11];
             if (settingsData[1].length > 12 && settingsData[1][12] !== undefined && settingsData[1][12] !== "") securitySettings = settingsData[1][12];
             if (settingsData[1].length > 13 && settingsData[1][13] !== undefined && settingsData[1][13] !== "") examConfigs = settingsData[1][13];
         }
      }

      return respondJSON({
        status: 'success', 
        data: studentsMap, 
        fee: fee, 
        announcement: announcement,
        timerMode: timerMode,
        timerUnitTarget: timerUnitTarget,
        timerSecondsPerQ: timerSecondsPerQ,
        timerType: timerType,
        examTotalMinutes: examTotalMinutes,
        publishedLessons: publishedLessons,
        geminiApiKey: geminiApiKey,
        showMistakesNotebook: showMistakesNotebook,
        showResetButtons: showResetButtons,
        certSettings: certSettings,
        securitySettings: securitySettings,
        examConfigs: examConfigs
      });
    }
    
    // 2. تسجيل الدخول
    else if (action === 'login') {
      var searchPhone = cleanPhone(e.parameter.phone);
      var studentsSheet = ss.getSheetByName("الطلاب");
      if (!studentsSheet) return respondJSON({status: 'error', message: 'شيت الطلاب غير موجود.'});

      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var foundStudents = [];
      var colMap = findColumnIndices(headers);
      
      for (var i = 1; i < data.length; i++) {
        var rowPhone = cleanPhone(data[i][colMap.phone]);
        
        if (rowPhone === searchPhone) {
          var name = String(data[i][colMap.name] || "").trim();
          var studentCode = colMap.code > -1 ? String(data[i][colMap.code] || "").trim() : "";
          var payInfo = calculateStudentPaymentStatus(headers, data[i], colMap);
          
          var isBlocked = false;
          if (colMap.block > -1) {
            var blockVal = String(data[i][colMap.block]).trim();
            if (blockVal === 'نعم' || blockVal === 'true') {
              isBlocked = true;
            }
          }
          
          var regDate = colMap.regDate > -1 ? String(data[i][colMap.regDate] || "").trim() : "";

          foundStudents.push({
            name: name,
            code: studentCode,
            isPaid: payInfo.isPaid,
            missingMonths: payInfo.missingMonths,
            graceMonths: payInfo.graceMonths,
            graceDaysRemaining: payInfo.graceDaysRemaining,
            phone: searchPhone,
            originalStatus: payInfo.originalStatus,
            isBlocked: isBlocked,
            registrationDate: regDate
          });
        }
      }
      
      if (foundStudents.length > 0) {
        return respondJSON({status: 'success', student: foundStudents});
      } else {
        return respondJSON({status: 'error', message: 'الرقم غير مسجل لدينا.'});
      }
    }
    
    // 3. جلب النتائج
    else if (action === 'getResults') {
      var resultsSheet = ss.getSheetByName("النتائج");
      if (!resultsSheet) return respondJSON({status: 'success', data: []});
      
      var data = resultsSheet.getDataRange().getValues();
      var results = [];
      for (var i = 1; i < data.length; i++) {
        if(data[i][0] && data[i][1]) {
           results.push({
             date: data[i][0],
             name: data[i][1],
             phone: data[i][2],
             quiz: data[i][3],
             score: data[i][4],
             studentType: data[i][5] ? String(data[i][5]).trim() : ''
           });
        }
      }
      return respondJSON({status: 'success', data: results.reverse()});
    }

    // 4. جلب الطلبات المعلقة
    else if (action === 'getPendingRequests') {
      var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
      if (!reqSheet) return respondJSON({status: 'success', data: []});
      
      var data = reqSheet.getDataRange().getValues();
      var reqs = [];
      for (var i = 1; i < data.length; i++) {
        if(data[i][0]) reqs.push({ date: data[i][0], name: data[i][1], phone: data[i][2], method: data[i][3] });
      }
      return respondJSON({status: 'success', data: reqs});
    }

    // 4.1. جلب سجل المشتركين الأونلاين المعتمدين (مع مزامنة تلقائية ذكية إذا كان الشيت فارغاً)
    else if (action === 'getOnlineStudents') {
      var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
      if (!onlineSheet) {
        initAllSheets();
        onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
      }
      if (!onlineSheet) return respondJSON({status: 'success', data: []});
      
      var oData = onlineSheet.getDataRange().getValues();
      if (oData.length <= 1) {
        syncOnlineStudentsFromMainSheet(ss);
        oData = onlineSheet.getDataRange().getValues();
      }

      var oList = [];
      for (var oi = 1; oi < oData.length; oi++) {
        if (oData[oi][1] || oData[oi][2]) {
          oList.push({
            code: String(oData[oi][0] || '').trim(),
            name: String(oData[oi][1] || '').trim(),
            phone: cleanPhone(oData[oi][2]),
            stage: String(oData[oi][3] || '').trim(),
            packageType: String(oData[oi][4] || '').trim(),
            activeMonths: String(oData[oi][5] || '').trim(),
            method: String(oData[oi][6] || '').trim(),
            amount: String(oData[oi][7] || '').trim(),
            date: String(oData[oi][8] || '').trim(),
            notes: String(oData[oi][9] || '').trim()
          });
        }
      }
      return respondJSON({status: 'success', data: oList});
    }

    // 4.2. جلب أرشيف طلاب الأونلاين (المحذوفين أو المعلقين)
    else if (action === 'getArchivedOnlineStudents') {
      var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
      if (!archSheet) return respondJSON({status: 'success', data: []});
      var aData = archSheet.getDataRange().getValues();
      var aList = [];
      for (var ai = 1; ai < aData.length; ai++) {
        if (aData[ai][1] || aData[ai][2]) {
          aList.push({
            code: String(aData[ai][0] || '').trim(),
            name: String(aData[ai][1] || '').trim(),
            phone: cleanPhone(aData[ai][2]),
            stage: String(aData[ai][3] || '').trim(),
            packageType: String(aData[ai][4] || '').trim(),
            activeMonths: String(aData[ai][5] || '').trim(),
            method: String(aData[ai][6] || '').trim(),
            amount: String(aData[ai][7] || '').trim(),
            date: String(aData[ai][8] || '').trim(),
            notes: String(aData[ai][9] || '').trim(),
            reason: String(aData[ai][10] || '').trim()
          });
        }
      }
      return respondJSON({status: 'success', data: aList});
    }

    // 5. جلب الأسئلة من جوجل شيت (والخرائط التفاعلية) مدمج مع نظام الكاش السريع 🚀
    else if (action === 'getQuestions') {
      var cache = CacheService.getScriptCache();
      var cachedData = cache.get('questionsData');
      if (cachedData) {
        return ContentService.createTextOutput(cachedData).setMimeType(ContentService.MimeType.JSON);
      }
      
      var qSheet = ss.getSheetByName("الأسئلة");
      if (!qSheet) return respondJSON({status: 'error', message: 'شيت "الأسئلة" غير موجود في ملف الإكسيل.'});
      
      var qData = qSheet.getDataRange().getValues();
      var questions = [];
      
      for (var i = 1; i < qData.length; i++) {
        if (qData[i][0] && qData[i][3]) { 
          questions.push({
            unit: String(qData[i][0]),
            section: String(qData[i][1]),
            type: String(qData[i][2] || 'mcq'),
            q: String(qData[i][3]),
            opt1: String(qData[i][4] || ''),
            opt2: String(qData[i][5] || ''),
            opt3: String(qData[i][6] || ''),
            opt4: String(qData[i][7] || ''),
            correct: String(qData[i][8] || ''),
            reason: String(qData[i][9] || ''),
            concept: String(qData[i][10] || ''),
            paragraph: String(qData[i][11] || ''), 
            audio: String(qData[i][12] || ''),     
            video: String(qData[i][13] || ''),
            pdf: String(qData[i][14] || '')
          });
        }
      }

      var mapsData = [];
      var mapsSheet = ss.getSheetByName("الخرائط");
      if (mapsSheet) {
         var mData = mapsSheet.getDataRange().getValues();
         for (var k = 1; k < mData.length; k++) {
            if (mData[k][0] && mData[k][1]) { 
               mapsData.push({
                  id: 'map_' + k,
                  title: String(mData[k][0]),
                  url: String(mData[k][1])
               });
            }
         }
      }
      
      var responseStr = JSON.stringify({status: 'success', data: questions, maps: mapsData});
      
      try { 
        cache.put('questionsData', responseStr, 600); 
      } catch(e) {}
      
      return ContentService.createTextOutput(responseStr).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 6. مزامنة الاشتراكات سحابياً من Google Drive عبر GET (للتشغيل التلقائي عبر Triggers أو الروابط المباشرة)
    else if (action === 'syncDriveBackups') {
      var stage = e.parameter.stage || 's2';
      var folderId = e.parameter.folderId || '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM';
      var res = syncDriveBackupsCore(stage, folderId);
      return respondJSON(res);
    }

    // 7. جلب تسليمات وإجابات الأسئلة المقالية سحابياً
    else if (action === 'getEssaySubmissions') {
      var essaySheet = ss.getSheetByName("إجابات المقالي");
      if (!essaySheet) return respondJSON({status: 'success', data: []});
      var eData = essaySheet.getDataRange().getValues();
      var submissions = [];
      for (var ei = 1; ei < eData.length; ei++) {
        if (eData[ei][1] || eData[ei][2]) {
          submissions.push({
            date: String(eData[ei][0] || ''),
            studentName: String(eData[ei][1] || ''),
            studentPhone: String(eData[ei][2] || ''),
            quizTitle: String(eData[ei][3] || ''),
            questionText: String(eData[ei][4] || ''),
            studentAnswerText: String(eData[ei][5] || ''),
            teacherScore: eData[ei][6] !== undefined ? eData[ei][6] : '',
            teacherFeedback: String(eData[ei][7] || ''),
            status: String(eData[ei][8] || 'قيد المراجعة'),
            studentType: String(eData[ei][9] || 'سنتر')
          });
        }
      }
      return respondJSON({status: 'success', data: submissions});
    }
    
    return respondJSON({status: 'error', message: 'Unknown action'});

  } catch (err) {
    return respondJSON({status: 'error', message: err.message});
  }
}

// الدالة المسئولة عن حفظ وتعديل البيانات (Do Post) محصنة بنظام الطابور LockService
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    
    var payload = JSON.parse(e.postData.contents);
    if (payload.apiKey !== SECRET_API_KEY) {
      return respondJSON({status: 'error', message: 'Unauthorized Access'});
    }

    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === 'saveResult') {
      var resultsSheet = ss.getSheetByName("النتائج");
      if (!resultsSheet) {
        resultsSheet = ss.insertSheet("النتائج");
        resultsSheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "الاختبار / الدرس", "النتيجة", "نوع الطالب"]);
      }
      var sType = payload.studentType || (payload.phone && String(payload.phone).indexOf('ESON') > -1 ? 'أونلاين' : 'سنتر');
      resultsSheet.appendRow([payload.date, payload.name, payload.phone, payload.quiz, payload.score, sType]);
      return respondJSON({status: 'success'});
    }
    
    // حفظ إجابات الأسئلة المقالية سحابياً في شيت مخصص
    else if (action === 'saveEssaySubmission') {
      var essaySheet = ss.getSheetByName("إجابات المقالي");
      if (!essaySheet) {
        essaySheet = ss.insertSheet("إجابات المقالي");
        essaySheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "اسم الاختبار", "السؤال المقالي", "إجابة الطالب", "درجة المعلم", "ملاحظات المعلم", "الحالة", "نوع الطالب"]);
      }
      var questions = payload.questions || [];
      var sType = payload.studentType || 'سنتر';
      var eData = essaySheet.getDataRange().getValues();
      var targetPhone = cleanPhone(payload.studentPhone);
      var targetQuiz = String(payload.quizTitle || '').trim();

      if (Array.isArray(questions)) {
        questions.forEach(function(q) {
          var qText = String(q.questionText || q.q || '').trim();
          var foundRowIdx = -1;
          for (var ei = 1; ei < eData.length; ei++) {
            if (cleanPhone(eData[ei][2]) === targetPhone && 
                String(eData[ei][3]).trim() === targetQuiz && 
                String(eData[ei][4]).trim() === qText) {
              foundRowIdx = ei + 1;
              break;
            }
          }

          var tScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : "");
          var tFeedback = q.teacherFeedback || q.aiFeedback || "";
          var statusVal = payload.isApproved ? "معتمد" : "قيد المراجعة";

          if (foundRowIdx > 0) {
            // تحديث الإجابة والدرجة للصف الموجود مسبقاً لمنع التكرار
            essaySheet.getRange(foundRowIdx, 1).setValue(payload.date || new Date().toLocaleString('ar-EG'));
            essaySheet.getRange(foundRowIdx, 6).setValue(q.studentText || q.studentAnswerText || "");
            if (tScore !== "") essaySheet.getRange(foundRowIdx, 7).setValue(tScore);
            if (tFeedback !== "") essaySheet.getRange(foundRowIdx, 8).setValue(tFeedback);
            essaySheet.getRange(foundRowIdx, 9).setValue(statusVal);
          } else {
            // إضافة صف جديد
            essaySheet.appendRow([
              payload.date || new Date().toLocaleString('ar-EG'),
              payload.studentName,
              payload.studentPhone,
              payload.quizTitle,
              qText,
              q.studentText || q.studentAnswerText || "",
              tScore,
              tFeedback,
              statusVal,
              sType
            ]);
          }
        });
      }
      return respondJSON({status: 'success'});
    }

    // تحديث درجة وملاحظات المعلم لسؤال مقالي
    else if (action === 'updateEssayGrade') {
      var essaySheet = ss.getSheetByName("إجابات المقالي");
      if (essaySheet) {
        var eData = essaySheet.getDataRange().getValues();
        var targetPhone = cleanPhone(payload.studentPhone);
        var targetQuiz = String(payload.quizTitle || '').trim();
        for (var ei = 1; ei < eData.length; ei++) {
          if (cleanPhone(eData[ei][2]) === targetPhone && (!targetQuiz || String(eData[ei][3]).trim() === targetQuiz)) {
            if (payload.teacherScore !== undefined) essaySheet.getRange(ei + 1, 7).setValue(payload.teacherScore);
            if (payload.teacherFeedback !== undefined) essaySheet.getRange(ei + 1, 8).setValue(payload.teacherFeedback);
            essaySheet.getRange(ei + 1, 9).setValue(payload.isApproved ? "معتمد" : "قيد المراجعة");
          }
        }
        return respondJSON({status: 'success'});
      }
      return respondJSON({status: 'error', message: 'شيت إجابات المقالي غير موجود'});
    }
    
    // دالة حظر وفك حظر طالب واحد
    else if (action === 'blockStudent' || action === 'unblockStudent') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex === -1) {
          blockColIndex = headers.length;
          studentsSheet.getRange(1, blockColIndex + 1).setValue("محظور");
       }
       
       var targetPhone = cleanPhone(payload.phone);
       var targetName = String(payload.name).trim();
       
       for (var i = 1; i < data.length; i++) {
           if (cleanPhone(data[i][colMap.phone]) === targetPhone && String(data[i][colMap.name]).trim() === targetName) {
               var val = action === 'blockStudent' ? 'نعم' : '';
               studentsSheet.getRange(i + 1, blockColIndex + 1).setValue(val);
               return respondJSON({status: 'success'});
           }
       }
       return respondJSON({status: 'error', message: 'لم يتم العثور على الطالب'});
    }

    // دالة الحظر الجماعي للطلاب غير المتفاعلين
    else if (action === 'blockMultipleStudents') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex === -1) { 
           blockColIndex = headers.length; 
           studentsSheet.getRange(1, blockColIndex + 1).setValue("محظور"); 
       }
       var targetList = payload.students;
       for (var i = 1; i < data.length; i++) {
           var rPhone = cleanPhone(data[i][colMap.phone]);
           var rName = String(data[i][colMap.name]).trim();
           for (var j = 0; j < targetList.length; j++) {
               if (rPhone === cleanPhone(targetList[j].phone) && rName === String(targetList[j].name).trim()) {
                   studentsSheet.getRange(i + 1, blockColIndex + 1).setValue('نعم');
                   break;
               }
           }
       }
       return respondJSON({status: 'success'});
    }

    // دالة فك الحظر الجماعي للطلاب المحظورين
    else if (action === 'unblockMultipleStudents') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex > -1) { 
           var targetList = payload.students;
           var targetSet = {};
           if (targetList && Array.isArray(targetList)) {
               for (var t = 0; t < targetList.length; t++) {
                   var key = cleanPhone(targetList[t].phone) + '_' + String(targetList[t].name).trim();
                   targetSet[key] = true;
               }
           }
           for (var i = 1; i < data.length; i++) {
               var rPhone = cleanPhone(data[i][colMap.phone]);
               var rName = String(data[i][colMap.name]).trim();
               var key = rPhone + '_' + rName;
               if (!targetList || targetSet[key]) {
                   studentsSheet.getRange(i + 1, blockColIndex + 1).setValue('');
               }
           }
       }
       return respondJSON({status: 'success'});
    }
    
    else if (action === 'saveDeviceFingerprint') {
      var devicesSheet = ss.getSheetByName("الأجهزة");
      if (!devicesSheet) {
        devicesSheet = ss.insertSheet("الأجهزة");
        devicesSheet.appendRow(["رقم الهاتف", "بصمة المتصفح (Fingerprint)", "تاريخ أول تسجيل دخول"]);
      }
      var data = devicesSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.phone)) {
           if (String(data[i][1]) !== String(payload.fingerprint)) {
               return respondJSON({status: 'blocked', message: 'لقد سبق واستخدم هذا الرقم في متصفح أو جهاز آخر.'});
           }
           return respondJSON({status: 'success'});
        }
      }
      var now = new Date().toLocaleString("ar-EG", {timeZone: "Africa/Cairo"});
      devicesSheet.appendRow([payload.phone, payload.fingerprint, now]);
      return respondJSON({status: 'success'});
    }

    else if (action === 'resetDevice') {
      var devicesSheet = ss.getSheetByName("الأجهزة");
      if (devicesSheet) {
        var data = devicesSheet.getDataRange().getValues();
        var targetPhone = String(payload.phone);
        var deleted = false;
        for (var i = data.length - 1; i > 0; i--) {
          if (String(data[i][0]) === targetPhone) {
             devicesSheet.deleteRow(i + 1);
             deleted = true;
          }
        }
        if(deleted) return respondJSON({status: 'success'});
        return respondJSON({status: 'error', message: 'لا يوجد جهاز مرتبط بهذا الطالب.'});
      }
      return respondJSON({status: 'error', message: 'شيت الأجهزة غير موجود.'});
    }

    else if (action === 'requestSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       if (!reqSheet) {
          reqSheet = ss.insertSheet("طلبات_الاشتراك");
          reqSheet.appendRow(["التاريخ", "الاسم", "رقم الهاتف", "طريقة الدفع", "الباقة المطلوبة", "المبلغ"]);
       }
       reqSheet.appendRow([payload.date, payload.name, payload.phone, payload.method, payload.packageType || 'شهري', payload.amount || '']);
       return respondJSON({status: 'success'});
    }
    
    else if (action === 'approveSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       if (reqSheet) {
          var data = reqSheet.getDataRange().getValues();
          for (var i = 1; i < data.length; i++) {
              if (cleanPhone(data[i][2]) === cleanPhone(payload.phone) && String(data[i][1]).trim() === String(payload.name).trim()) {
                  reqSheet.deleteRow(i + 1);
                  break;
              }
          }
       }
       var res = activateOnlineStudentCore(ss, payload);
       return respondJSON(res);
    }

    else if (action === 'addOnlineStudentDirectly') {
       var res = activateOnlineStudentCore(ss, payload);
       return respondJSON(res);
    }

    else if (action === 'syncExistingOnlineStudents') {
       var res = syncOnlineStudentsToMainSheet(ss);
       return respondJSON(res);
    }

    else if (action === 'renewOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       if (!onlineSheet) return respondJSON({status: 'error', message: 'شيت طلاب الأونلاين غير موجود'});
       var targetPhone = cleanPhone(payload.phone);
       var oData = onlineSheet.getDataRange().getValues();
       var updated = false;
       for (var oi = 1; oi < oData.length; oi++) {
          if (cleanPhone(oData[oi][2]) === targetPhone) {
             var currentMonths = String(oData[oi][5] || '').trim();
             var newMonth = String(payload.month || '').trim();
             var newPkg = String(payload.packageType || oData[oi][4]).trim();
             var combinedMonths = currentMonths;
             if (newMonth && combinedMonths.indexOf(newMonth) === -1) {
                combinedMonths = combinedMonths ? (combinedMonths + '، ' + newMonth) : newMonth;
             }
             if (newPkg.indexOf('ترم') > -1 || newPkg.indexOf('سنة') > -1) {
                combinedMonths = newPkg;
             }
             var renewDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
             onlineSheet.getRange(oi + 1, 5).setValue(newPkg);
             onlineSheet.getRange(oi + 1, 6).setValue(combinedMonths);
             if (payload.amount) onlineSheet.getRange(oi + 1, 8).setValue(payload.amount);
             onlineSheet.getRange(oi + 1, 9).setValue(renewDate);
             onlineSheet.getRange(oi + 1, 10).setValue('نشط');
             updated = true;
             break;
          }
       }
       syncOnlineStudentsToMainSheet(ss);
       return respondJSON({status: updated ? 'success' : 'error'});
    }

    else if (action === 'editOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       if (!onlineSheet) return respondJSON({status: 'error', message: 'شيت طلاب الأونلاين غير موجود'});
       var oldPhone = cleanPhone(payload.oldPhone || payload.phone);
       var newPhone = cleanPhone(payload.newPhone || payload.phone);
       var newName = String(payload.name || '').trim();
       var newPkg = String(payload.packageType || '').trim();
       var oData = onlineSheet.getDataRange().getValues();
       var updated = false;
       for (var oi = 1; oi < oData.length; oi++) {
          if (cleanPhone(oData[oi][2]) === oldPhone) {
             if (newName) onlineSheet.getRange(oi + 1, 2).setValue(newName);
             if (newPhone) {
                var fP = newPhone.startsWith('0') ? newPhone : ('0' + newPhone);
                onlineSheet.getRange(oi + 1, 3).setValue("'" + fP);
             }
             if (newPkg) onlineSheet.getRange(oi + 1, 5).setValue(newPkg);
             if (payload.amount) onlineSheet.getRange(oi + 1, 8).setValue(payload.amount);
             updated = true;
             break;
          }
       }
       syncOnlineStudentsToMainSheet(ss);
       return respondJSON({status: updated ? 'success' : 'error'});
    }

    else if (action === 'resetOnlineDevice') {
       var devSheet = ss.getSheetByName("الأجهزة");
       if (!devSheet) return respondJSON({status: 'success', message: 'شيت الأجهزة غير موجود'});
       var targetPhone = cleanPhone(payload.phone);
       var dData = devSheet.getDataRange().getValues();
       var deletedCount = 0;
       for (var di = dData.length - 1; di >= 1; di--) {
          var rowKey = String(dData[di][0] || '');
          if (rowKey.indexOf(targetPhone) > -1 || cleanPhone(rowKey) === targetPhone) {
             devSheet.deleteRow(di + 1);
             deletedCount++;
          }
       }
       return respondJSON({status: 'success', deleted: deletedCount});
    }

    else if (action === 'restoreArchivedOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
       if (!onlineSheet || !archSheet) return respondJSON({status: 'error', message: 'الشيتات غير موجودة'});
       var targetPhone = cleanPhone(payload.phone);
       var aData = archSheet.getDataRange().getValues();
       for (var ai = 1; ai < aData.length; ai++) {
          if (cleanPhone(aData[ai][2]) === targetPhone) {
             var row = aData[ai];
             var actDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
             onlineSheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], actDate, "نشط"]);
             archSheet.deleteRow(ai + 1);
             break;
          }
       }
       syncOnlineStudentsToMainSheet(ss);
       return respondJSON({status: 'success'});
    }

    else if (action === 'deleteOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
       if (!archSheet) {
          archSheet = ss.insertSheet("أرشيف_الأونلاين");
          archSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "تاريخ الحذف", "سبب الحذف"]);
          archSheet.getRange(1, 1, 1, 11).setBackground("#991b1b").setFontColor("#ffffff").setFontWeight("bold");
          archSheet.setFrozenRows(1);
          archSheet.getRange("C:C").setNumberFormat("@");
       }

       var targetPhone = cleanPhone(payload.phone);
       if (onlineSheet) {
          var oData = onlineSheet.getDataRange().getValues();
          for (var oi = 1; oi < oData.length; oi++) {
             if (cleanPhone(oData[oi][2]) === targetPhone || String(oData[oi][1]).trim() === String(payload.name).trim()) {
                var delDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
                var oldRow = oData[oi];
                archSheet.appendRow([oldRow[0], oldRow[1], oldRow[2], oldRow[3], oldRow[4], oldRow[5], oldRow[6], oldRow[7], oldRow[8], delDate, payload.reason || "حذف يدوي بواسطة الإدارة"]);
                onlineSheet.deleteRow(oi + 1);
                break;
             }
          }
       }
       // تعطيل الطالب في شيت الطلاب أيضاً لمنع دخوله
       var sSheet = ss.getSheetByName("الطلاب");
       if (sSheet) {
          var sData = sSheet.getDataRange().getValues();
          var colMap = findColumnIndices(sData[0]);
          for (var si = 1; si < sData.length; si++) {
             if (cleanPhone(sData[si][colMap.phone]) === targetPhone) {
                if (colMap.status > -1) sSheet.getRange(si + 1, colMap.status + 1).setValue("محظور");
                break;
             }
          }
       }
       return respondJSON({status: 'success'});
    }

    else if (action === 'rejectSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       var data = reqSheet.getDataRange().getValues();
       for (var i = 1; i < data.length; i++) {
           if (String(data[i][2]).trim() === String(payload.phone).trim() && String(data[i][1]).trim() === String(payload.name).trim()) {
               reqSheet.deleteRow(i + 1);
               return respondJSON({status: 'success'});
           }
       }
       return respondJSON({status: 'error'});
    }

    else if (action === 'activateSpecificMonth') {
      var studentsSheet = ss.getSheetByName("الطلاب");
      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var colMap = findColumnIndices(headers);
      var targetPhone = cleanPhone(payload.phone);
      var monthIndex = headers.indexOf(payload.month);
      
      if (monthIndex > -1) {
          var paymentDateString = "تم التفعيل " + new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
          for (var i = 1; i < data.length; i++) {
            if (cleanPhone(data[i][colMap.phone]) === targetPhone) {
               studentsSheet.getRange(i + 1, monthIndex + 1).setValue(paymentDateString);
               return respondJSON({status: 'success'});
            }
          }
      }
      return respondJSON({status: 'error'});
    }
    
    else if (action === 'updateSettings') {
       var settingsSheet = ss.getSheetByName("الإعدادات");
       if (!settingsSheet) {
          settingsSheet = ss.insertSheet("الإعدادات");
          settingsSheet.appendRow(["قيمة الاشتراك", "الإشعار", "إعدادات العداد", "الوحدة المستهدفة", "وقت السؤال", "الدروس المنشورة"]);
       }
       var headers = settingsSheet.getDataRange().getValues()[0];
       if (headers.indexOf("الإشعار") === -1) settingsSheet.getRange(1, 2).setValue("الإشعار");
       if (headers.indexOf("إعدادات العداد") === -1) settingsSheet.getRange(1, 3).setValue("إعدادات العداد");
       if (headers.indexOf("الوحدة المستهدفة") === -1) settingsSheet.getRange(1, 4).setValue("الوحدة المستهدفة");
       if (headers.indexOf("وقت السؤال") === -1) settingsSheet.getRange(1, 5).setValue("وقت السؤال");
       if (headers.indexOf("الدروس المنشورة") === -1) settingsSheet.getRange(1, 6).setValue("الدروس المنشورة");
        if (headers.indexOf("نوع العداد") === -1) settingsSheet.getRange(1, 7).setValue("نوع العداد");
        if (headers.indexOf("وقت الامتحان الكلي") === -1) settingsSheet.getRange(1, 8).setValue("وقت الامتحان الكلي");
        if (headers.indexOf("مفتاح الذكاء الاصطناعي") === -1) settingsSheet.getRange(1, 9).setValue("مفتاح الذكاء الاصطناعي");
        if (headers.indexOf("كشكول الأخطاء") === -1) settingsSheet.getRange(1, 10).setValue("كشكول الأخطاء");
        if (headers.indexOf("أزرار التصفير") === -1) settingsSheet.getRange(1, 11).setValue("أزرار التصفير");
        if (headers.indexOf("إعدادات الشهادات") === -1) settingsSheet.getRange(1, 12).setValue("إعدادات الشهادات");
        if (headers.indexOf("إعدادات الأمان ومكافحة الغش") === -1) settingsSheet.getRange(1, 13).setValue("إعدادات الأمان ومكافحة الغش");
        if (headers.indexOf("جداول ومواعيد الامتحانات") === -1) settingsSheet.getRange(1, 14).setValue("جداول ومواعيد الامتحانات");

       settingsSheet.getRange(2, 1).setValue(payload.fee);
       settingsSheet.getRange(2, 2).setValue(payload.announcement || "");
       
       if (payload.timerMode !== undefined) settingsSheet.getRange(2, 3).setValue(payload.timerMode);
       if (payload.timerUnitTarget !== undefined) settingsSheet.getRange(2, 4).setValue(payload.timerUnitTarget);
       if (payload.timerSecondsPerQ !== undefined) settingsSheet.getRange(2, 5).setValue(payload.timerSecondsPerQ);
       if (payload.publishedLessons !== undefined) settingsSheet.getRange(2, 6).setValue(payload.publishedLessons);
        if (payload.timerType !== undefined) settingsSheet.getRange(2, 7).setValue(payload.timerType);
        if (payload.examTotalMinutes !== undefined) settingsSheet.getRange(2, 8).setValue(payload.examTotalMinutes);
        if (payload.geminiApiKey !== undefined) settingsSheet.getRange(2, 9).setValue(payload.geminiApiKey);
        if (payload.showMistakesNotebook !== undefined) settingsSheet.getRange(2, 10).setValue(payload.showMistakesNotebook);
        if (payload.showResetButtons !== undefined) settingsSheet.getRange(2, 11).setValue(payload.showResetButtons);
        if (payload.certSettings !== undefined) settingsSheet.getRange(2, 12).setValue(payload.certSettings);
        if (payload.securitySettings !== undefined) settingsSheet.getRange(2, 13).setValue(payload.securitySettings);
        if (payload.examConfigs !== undefined) settingsSheet.getRange(2, 14).setValue(payload.examConfigs);
        
        return respondJSON({status: 'success'});
     }

     // 7. مزامنة الاشتراكات سحابياً من Google Drive عبر POST
     else if (action === 'syncDriveBackups') {
       var stage = payload.stage || 's2';
       var folderId = payload.folderId || '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM';
       var res = syncDriveBackupsCore(stage, folderId);
       return respondJSON(res);
     }

     // 8. مزامنة الاشتراكات محلياً عبر رفع ملف JSON
     else if (action === 'syncLocalBackup') {
       var stage = payload.stage || 's2';
       var res = applyBackupToSheet(payload.students, payload.transactions, stage);
       return respondJSON(res);
     }

     // 9. رفع ملف PDF لمذكرة الدرس وحفظه في Google Drive وكتابة الرابط في شيت الأسئلة
     else if (action === 'uploadPdfFile') {
       var folderName = "مذكرات_الكنز_التعليمي";
       var folders = DriveApp.getFoldersByName(folderName);
       var targetFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
       targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
       
       var base64Data = payload.base64;
       var rawName = String(payload.fileName || ("مذكرة_" + (payload.lessonTitle || "درس") + ".pdf"));
       var cleanFileName = rawName.toLowerCase().endsWith('.pdf') ? rawName : (rawName + '.pdf');
       var decoded = Utilities.base64Decode(base64Data);
       var blob = Utilities.newBlob(decoded, "application/pdf", cleanFileName);
       var file = targetFolder.createFile(blob);
       file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
       var fileId = file.getId();
       var previewUrl = "https://drive.google.com/file/d/" + fileId + "/preview";
       var downloadUrl = "https://drive.google.com/uc?export=download&id=" + fileId;
       var fileUrl = file.getUrl();

       if (payload.lessonTitle) {
         var qSheet = ss.getSheetByName("الأسئلة");
         if (qSheet) {
           var qData = qSheet.getDataRange().getValues();
           if (qData.length > 0 && !qData[0][14]) {
             qSheet.getRange(1, 15).setValue("مذكرة_PDF");
           }
           var targetTitle = String(payload.lessonTitle).trim();
           for (var qi = 1; qi < qData.length; qi++) {
             if (String(qData[qi][1] || '').trim() === targetTitle) {
               qSheet.getRange(qi + 1, 15).setValue(previewUrl);
             }
           }
         }
       }
       return respondJSON({ status: 'success', fileId: fileId, previewUrl: previewUrl, downloadUrl: downloadUrl, fileUrl: fileUrl });
     }

     // 10. تحديث رابط مذكرة الـ PDF لدرس محدد في شيت الأسئلة (يدوياً أو مسح)
     else if (action === 'updateLessonPdfLink') {
       var qSheet = ss.getSheetByName("الأسئلة");
       if (!qSheet) return respondJSON({status: 'error', message: 'شيت الأسئلة غير موجود'});
       var qData = qSheet.getDataRange().getValues();
       if (qData.length > 0 && !qData[0][14]) {
         qSheet.getRange(1, 15).setValue("مذكرة_PDF");
       }
       var targetTitle = String(payload.lessonTitle || '').trim();
       var newPdfUrl = String(payload.pdfUrl || '').trim();
       for (var qi = 1; qi < qData.length; qi++) {
         if (String(qData[qi][1] || '').trim() === targetTitle) {
           qSheet.getRange(qi + 1, 15).setValue(newPdfUrl);
         }
       }
       return respondJSON({status: 'success'});
     }

     // 11. جلب بايتس ملف PDF سحابياً لتطبيق العلامة المائية وتفادي مشاكل الـ CORS
     else if (action === 'getPdfBase64') {
       var fileId = payload.fileId;
       var rawUrl = String(payload.url || '');
       if (!fileId && rawUrl) {
         var match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || rawUrl.match(/id=([a-zA-Z0-9_-]+)/);
         if (match) fileId = match[1];
       }
       if (fileId) {
         try {
           var file = DriveApp.getFileById(fileId);
           var bytes = file.getBlob().getBytes();
           var base64 = Utilities.base64Encode(bytes);
           return respondJSON({ status: 'success', base64: base64, fileName: file.getName() });
         } catch (err) {
           return respondJSON({ status: 'error', message: err.message });
         }
       }
       return respondJSON({ status: 'error', message: 'معرف الملف غير صحيح' });
     }

  } catch (error) {
    return respondJSON({status: 'error', message: error.message});
  } finally {
    lock.releaseLock();
  }
}

// دالة ذكية لمعرفة رقم الشهر الأكاديمي من رأس العمود
function getMonthNum(h) {
  if (!h) return null;
  var s = String(h).trim();
  if (s.indexOf("سبتمبر") > -1) return 9;
  if (s.indexOf("أكتوبر") > -1 || s.indexOf("اكتوبر") > -1) return 10;
  if (s.indexOf("نوفمبر") > -1) return 11;
  if (s.indexOf("ديسمبر") > -1) return 12;
  if (s.indexOf("يناير") > -1) return 1;
  if (s.indexOf("فبراير") > -1) return 2;
  if (s.indexOf("مارس") > -1) return 3;
  if (s.indexOf("أبريل") > -1 || s.indexOf("ابريل") > -1) return 4;
  if (s.indexOf("مايو") > -1) return 5;
  return null;
}

// دالة فحص ما إذا كانت الخلية تدل على السداد أو الإعفاء وعدم المطالبة
function isCellValPaid(val) {
  if (val === undefined || val === null) return false;
  var str = String(val).trim();
  if (!str) return false;
  // حالات الإعفاء وعدم المطالبة (تعتبر مقبولة ولا توقف حساب الطالب):
  if (str.indexOf('غير مطالب') > -1 || str.indexOf('لم يحضر') > -1 || str.indexOf('انقطاع') > -1 || 
      str.indexOf('معفي') > -1 || str.indexOf('معفى') > -1 || str.indexOf('مجاني') > -1 || 
      str.indexOf('تأجيل') > -1 || str.indexOf('غير مسجل') > -1) {
    return true;
  }
  // حالات عدم السداد والتأخير الصريحة:
  if (str === '-' || str === '0' || str === '٠' || str === 'لا' || str === 'false') return false;
  if (str.indexOf('متأخر') > -1 || str.indexOf('متاخر') > -1 || str.indexOf('غير مسدد') > -1 || 
      str.indexOf('لم يسدد') > -1 || str.indexOf('لم يدفع') > -1 || str.indexOf('متبقي') > -1) {
    return false;
  }
  return true;
}

// دالة ذكية لاكتشاف مواقع الأعمدة تلقائياً سواء كان الشيت القديم أو الجديد
function findColumnIndices(headers) {
  var nameCol = -1, codeCol = -1, statusCol = -1, phoneCol = -1, blockCol = -1, stageCol = -1, genderCol = -1, regDateCol = -1;
  var nonMonthCols = [];

  for (var h = 0; h < headers.length; h++) {
    var hStr = String(headers[h] || "").trim();
    if (getMonthNum(hStr) !== null) {
      continue; // أعمدة الشهور لا تُضاف لـ nonMonthCols إطلاقاً
    }
    if (hStr === "الاسم" || hStr === "اسم الطالب" || hStr.indexOf("الاسم") > -1) {
      if (nameCol === -1) { nameCol = h; nonMonthCols.push(h); }
    } else if (hStr === "كود الطالب" || hStr === "الكود" || hStr === "كود" || hStr.indexOf("كود") > -1) {
      if (codeCol === -1) { codeCol = h; nonMonthCols.push(h); }
    } else if (hStr === "الحالة المالية" || hStr === "الحالة" || hStr.indexOf("حالة") > -1) {
      if (statusCol === -1) { statusCol = h; nonMonthCols.push(h); }
    } else if (hStr === "الهاتف" || hStr === "رقم الهاتف" || hStr === "الموبايل" || hStr.indexOf("هاتف") > -1 || hStr.indexOf("موبايل") > -1 || hStr.indexOf("تليفون") > -1 || hStr.indexOf("محمول") > -1) {
      if (phoneCol === -1) { phoneCol = h; nonMonthCols.push(h); }
    } else if (hStr === "محظور" || hStr === "الحظر" || hStr.indexOf("حظر") > -1) {
      if (blockCol === -1) { blockCol = h; nonMonthCols.push(h); }
    } else if (hStr === "المرحلة" || hStr === "الصف" || hStr.indexOf("مرحلة") > -1 || hStr.indexOf("صف") > -1) {
      if (stageCol === -1) { stageCol = h; nonMonthCols.push(h); }
    } else if (hStr === "النوع" || hStr === "الجنس" || hStr.indexOf("نوع") > -1) {
      if (genderCol === -1) { genderCol = h; nonMonthCols.push(h); }
    } else if (hStr.indexOf("تسجيل") > -1 || hStr.indexOf("انضمام") > -1 || hStr.indexOf("تاريخ") > -1) {
      if (regDateCol === -1) { regDateCol = h; nonMonthCols.push(h); }
    } else if (hStr === "ملاحظات" || hStr.indexOf("ملاحظ") > -1 || hStr.indexOf("أغسطس") > -1 || hStr.indexOf("اغسطس") > -1) {
      nonMonthCols.push(h);
    }
  }

  // قيم افتراضية ذكية: فقط إذا لم يكن العمود عمود شهر
  if (nameCol === -1 && getMonthNum(headers[0]) === null) { nameCol = 0; nonMonthCols.push(0); }
  if (codeCol === -1 && getMonthNum(headers[1]) === null) { codeCol = 1; nonMonthCols.push(1); }
  if (statusCol === -1 && getMonthNum(headers[2]) === null) { statusCol = 2; nonMonthCols.push(2); }
  if (phoneCol === -1) {
    for (var pIdx = 0; pIdx < headers.length; pIdx++) {
      if (nonMonthCols.indexOf(pIdx) === -1 && getMonthNum(headers[pIdx]) === null) {
        phoneCol = pIdx;
        nonMonthCols.push(pIdx);
        break;
      }
    }
  }

  return {
    name: nameCol,
    code: codeCol,
    status: statusCol,
    phone: phoneCol,
    block: blockCol,
    stage: stageCol,
    gender: genderCol,
    regDate: regDateCol,
    nonMonthCols: nonMonthCols
  };
}

// دالة حساب المتأخرات وفترة السماح الذكية (حتى يوم 5) مع مراعاة الإعفاء وتجاهل أغسطس
function calculateStudentPaymentStatus(headers, rowData, colMap) {
  var status = colMap.status > -1 ? String(rowData[colMap.status] || "").trim() : "";
  var isExempt = (status.indexOf('معفي') > -1 || status.indexOf('معفى') > -1 || status.indexOf('مجاني') > -1);

  if (isExempt) {
    return {
      isPaid: true,
      missingMonths: [],
      graceMonths: [],
      graceDaysRemaining: 0,
      originalStatus: "معفي"
    };
  }

  var now = new Date();
  var currentDay = parseInt(Utilities.formatDate(now, "Africa/Cairo", "d"), 10);
  var currentMonth = parseInt(Utilities.formatDate(now, "Africa/Cairo", "M"), 10);

  // فحص هل الطالب هو طالب أونلاين
  var stCode = colMap.code > -1 ? String(rowData[colMap.code] || '').trim() : '';
  var genderVal = colMap.gender > -1 ? String(rowData[colMap.gender] || '').trim() : '';
  var isOnline = genderVal.indexOf('أونلاين') > -1 || genderVal.indexOf('اونلاين') > -1 || stCode.indexOf('ESON') > -1;

  if (isOnline) {
    var paidOnlineMonths = [];
    for (var k = 0; k < headers.length; k++) {
      if (colMap.nonMonthCols.indexOf(k) > -1) continue;
      var hN = String(headers[k] || "").trim();
      var cV = String(rowData[k] || "").trim();
      if (isCellValPaid(cV)) {
        paidOnlineMonths.push(hN);
      }
    }

    var currentMonthName = currentMonth === 10 ? "أكتوبر" : (currentMonth === 9 ? "سبتمبر" : "أكتوبر");
    var isCurrentMonthPaid = paidOnlineMonths.some(function(pm) { return getMonthNum(pm) === currentMonth; });
    var hasTermOrYear = paidOnlineMonths.length >= 4;

    if (isCurrentMonthPaid || hasTermOrYear) {
      return {
        isPaid: true,
        missingMonths: [],
        graceMonths: [],
        graceDaysRemaining: 0,
        originalStatus: "أونلاين نشط"
      };
    }

    var prevMonthNum = currentMonth === 1 ? 12 : currentMonth - 1;
    var isPrevPaid = paidOnlineMonths.some(function(pm) { return getMonthNum(pm) === prevMonthNum; });

    if (isPrevPaid && currentDay <= 5) {
      return {
        isPaid: true,
        missingMonths: [],
        graceMonths: [currentMonthName],
        graceDaysRemaining: Math.max(0, 5 - currentDay),
        originalStatus: "أونلاين سماح"
      };
    }

    return {
      isPaid: false,
      missingMonths: [currentMonthName],
      graceMonths: [],
      graceDaysRemaining: 0,
      originalStatus: "أونلاين منتهي"
    };
  }

  var toAcademicIndex = function(m) {
    return m >= 9 ? (m - 8) : (m + 4);
  };

  var acadCurrent = toAcademicIndex(currentMonth);
  var hardOverdueMonths = [];
  var graceMonths = [];

  for (var j = 0; j < headers.length; j++) {
    if (colMap.nonMonthCols.indexOf(j) > -1) continue;

    var headerName = String(headers[j] || "").trim();
    if (headerName.indexOf("أغسطس") > -1 || headerName.indexOf("اغسطس") > -1) continue;

    var targetMonthNum = getMonthNum(headerName);
    if (!targetMonthNum) continue;

    var acadTarget = toAcademicIndex(targetMonthNum);

    var cellValue = String(rowData[j] || "").trim();
    var isCellPaid = isCellValPaid(cellValue);

    if (!isCellPaid) {
      if (acadTarget > acadCurrent) {
        // شهر قادم: لم يحن وقته بعد
      } else if (acadTarget === acadCurrent) {
        // الشهر الحالي (مثلاً أكتوبر ونحن في شهر أكتوبر):
        // مهلة سداد هذا الشهر ممتدة حتى يوم 5 من الشهر التالي (5/11)
        // لا يُعتبر متأخراً ولا يوقف حساب الطالب طوال الشهر
      } else if (acadTarget === acadCurrent - 1) {
        // الشهر السابق مباشرة (مثلاً سبتمبر ونحن في أكتوبر):
        if (currentDay >= 5) {
          hardOverdueMonths.push(headerName);
        } else {
          graceMonths.push(headerName);
        }
      } else {
        // شهر سابق بأكثر من شهر وما زال غير مسدد: متأخر تماماً
        hardOverdueMonths.push(headerName);
      }
    }
  }

  var isPaid = (hardOverdueMonths.length === 0);
  var graceDaysRemaining = Math.max(0, 5 - currentDay);

  return {
    isPaid: isPaid,
    missingMonths: hardOverdueMonths,
    graceMonths: graceMonths,
    graceDaysRemaining: graceDaysRemaining,
    originalStatus: status
  };
}

// دالة مساعدة لإرجاع البيانات بتنسيق JSON نظيف
function respondJSON(responseObject) {
  return ContentService.createTextOutput(JSON.stringify(responseObject)).setMimeType(ContentService.MimeType.JSON);
}

// دالة تنظيف أرقام الهواتف (تحويل الأرقام العربية إلى إنجليزية وإزالة المسافات والعلامات)

// دالة توحيد الحروف العربية لمطابقة الأسماء بدقة
function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\\s+/g, ' ')
    .trim();
}


// -------------------------------------------------------------------------
// دوال إدارة وتوليد أكواد طلاب الأونلاين ومزامنتهم
// -------------------------------------------------------------------------
function generateOnlineStudentCode(name, phone) {
  var cleanP = cleanPhone(phone);
  var last4 = cleanP.length >= 4 ? cleanP.slice(-4) : ('0000' + cleanP).slice(-4);
  
  var mapChar = {
    'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': 'A',
    'ب': 'B', 'ت': 'T', 'ث': 'T', 'ج': 'G', 'ح': 'H',
    'خ': 'K', 'د': 'D', 'ذ': 'Z', 'ر': 'R', 'ز': 'Z',
    'س': 'S', 'ش': 'S', 'ص': 'S', 'ض': 'D', 'ط': 'T',
    'ظ': 'Z', 'ع': 'A', 'غ': 'G', 'ف': 'F', 'ق': 'K',
    'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H',
    'ة': 'H', 'و': 'W', 'ي': 'Y', 'ى': 'Y'
  };
  
  var firstLetter = 'A';
  if (name && String(name).trim().length > 0) {
    var rawFirst = String(name).trim().charAt(0);
    if (/[a-zA-Z]/.test(rawFirst)) {
      firstLetter = rawFirst.toUpperCase();
    } else if (mapChar[rawFirst]) {
      firstLetter = mapChar[rawFirst];
    }
  }
  
  // التركيبة المعتمدة: [حرف الاسم] + [آخر 4 أرقام] + [ES] + [ON]
  return firstLetter + last4 + "ESON";
}

function getResolvedMonths(packageType, activeMonthsStr) {
  var pStr = String(packageType || '').trim();
  var mStr = String(activeMonthsStr || '').trim();
  var fullStr = pStr + ' ' + mStr;

  if (fullStr.indexOf('سنة') > -1 || fullStr.indexOf('العام') > -1) {
    return ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
  }
  if (fullStr.indexOf('ترم أول') > -1 || fullStr.indexOf('الترم الأول') > -1) {
    return ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير'];
  }
  if (fullStr.indexOf('ترم ثانٍ') > -1 || fullStr.indexOf('الترم الثاني') > -1 || fullStr.indexOf('ترم ثاني') > -1) {
    return ['فبراير', 'مارس', 'أبريل', 'مايو'];
  }

  var standardMonths = ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
  var foundMonths = [];
  standardMonths.forEach(function(m) {
    if (fullStr.indexOf(m) > -1) {
      foundMonths.push(m);
    }
  });

  return foundMonths.length > 0 ? foundMonths : ['أكتوبر'];
}

function syncSingleOnlineStudentToMainSheet(studentsSheet, st) {
  var data = studentsSheet.getDataRange().getValues();
  var headers = data[0];
  var colMap = findColumnIndices(headers);
  var targetPhone = cleanPhone(st.phone);
  
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (cleanPhone(data[i][colMap.phone]) === targetPhone) {
      foundRow = i + 1;
      break;
    }
  }

  var resolvedMonths = getResolvedMonths(st.packageType, st.activeMonthsRaw || st.activeMonths);
  var formattedP = targetPhone.startsWith('0') ? targetPhone : ('0' + targetPhone);

  if (foundRow > -1) {
    if (colMap.name > -1 && st.name) studentsSheet.getRange(foundRow, colMap.name + 1).setValue(st.name);
    if (colMap.code > -1 && st.code) studentsSheet.getRange(foundRow, colMap.code + 1).setValue("'" + st.code);
    if (colMap.status > -1) studentsSheet.getRange(foundRow, colMap.status + 1).setValue(st.status === 'ملغي' ? 'محظور' : 'منتظم');
    if (colMap.stage > -1 && st.stage) studentsSheet.getRange(foundRow, colMap.stage + 1).setValue(st.stage);
    if (colMap.gender > -1) studentsSheet.getRange(foundRow, colMap.gender + 1).setValue("أونلاين");
    if (colMap.phone > -1) studentsSheet.getRange(foundRow, colMap.phone + 1).setValue("'" + formattedP);

    resolvedMonths.forEach(function(m) {
      var mIdx = headers.indexOf(m);
      if (mIdx > -1) {
        studentsSheet.getRange(foundRow, mIdx + 1).setValue("مسدد");
      }
    });
  } else {
    var newRow = new Array(headers.length).fill('');
    if (colMap.name > -1) newRow[colMap.name] = st.name;
    if (colMap.code > -1) newRow[colMap.code] = "'" + st.code;
    if (colMap.status > -1) newRow[colMap.status] = st.status === 'ملغي' ? 'محظور' : 'منتظم';
    if (colMap.stage > -1) newRow[colMap.stage] = st.stage || "2 بكالوريا";
    if (colMap.gender > -1) newRow[colMap.gender] = "أونلاين";
    if (colMap.phone > -1) newRow[colMap.phone] = "'" + formattedP;

    resolvedMonths.forEach(function(m) {
      var mIdx = headers.indexOf(m);
      if (mIdx > -1) {
        newRow[mIdx] = "مسدد";
      }
    });

    studentsSheet.appendRow(newRow);
  }
}

function cleanPhone(phone) {
  if (!phone) return "";
  var str = String(phone);
  var arabicNumbers = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  for(var i=0; i<10; i++) {
    var regex = new RegExp(arabicNumbers[i], 'g');
    str = str.replace(regex, i);
  }
  str = str.replace(/[\\s\\+\\.\\-]/g, '');
  if (str.startsWith('20') && str.length > 10) {
    str = str.substring(2);
  }
  if ((str.length === 10 || str.length === 9) && str.startsWith('1')) {
    str = '0' + str;
  }
  return str;
}


// =========================================================================
// وظائف المزامنة الذكية مع Google Drive والنسخ الاحتياطية لتطبيق السنتر
// =========================================================================

// قائمة مخصصة تظهر في شريط قوائم جوجل شيت بالأعلى للتشغيل اليدوي المباشر
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ موسوعة الكنز')
    .addItem('🔑 تفعيل صلاحيات Google Drive لرفع المذكرات من التطبيق', 'authorizeDrivePermissionsMenu')
    .addSeparator()
    .addItem('🔄 مزامنة طلاب السنتر من Google Drive (مع حماية الأونلاين)', 'syncDriveBackupsMenu')
    .addItem('🌐 مزامنة وتثبيت طلاب الأونلاين وتحديث شهورهم', 'syncOnlineStudentsToMainSheetMenu')
    .addSeparator()
    .addItem('🚀 مزامنة شاملة وذكية (سنتر + أونلاين معاً)', 'syncAllMenu')
    .addSeparator()
    .addItem('🛠️ تهيئة وإنشاء كافة صفحات الشيت تلقائياً (Setup)', 'initAllSheetsMenu')
    .addToUi();
}

function authorizeDrivePermissions() {
  var folderName = "مذكرات_الكنز_التعليمي";
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function authorizeDrivePermissionsMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    authorizeDrivePermissions();
    ui.alert(
      "✅ تم تفعيل الصلاحيات بنجاح!",
      "تم ربط صلاحيات Google Drive بنجاح وتجهيز مجلد 'مذكرات_الكنز_التعليمي'.\\nيمكنك الآن رفع ملفات الـ PDF مباشرة من داخل التطبيق بضغطة زر.",
      ui.ButtonSet.OK
    );
  } catch(e) {
    ui.alert("تنبيه الصلاحيات", "يرجى الموافقة على طلب إذن الوصول إلى Google Drive عند ظهوره: " + e.message, ui.ButtonSet.OK);
  }
}

function syncDriveBackupsMenu() {
  var ui = SpreadsheetApp.getUi();
  var res = syncDriveBackupsCore('s2', '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM');
  if (res.status === 'success') {
    ui.alert(
      '✅ تمت مزامنة السنتر بنجاح (مع حماية الأونلاين)!',
      'الملف المستخدم: ' + res.fileName + '\\n' +
      'تاريخ الباك آب: ' + res.fileDate + '\\n' +
      'إجمالي طلاب المرحلة بالنظام: ' + res.totalTargetStudents + '\\n' +
      'الطلاب المحدثة اشتراكاتهم: ' + res.updatedCount + '\\n' +
      'الطلاب الجدد المضافين: ' + res.addedCount + '\\n' +
      'إجمالي الشهور المسددة المحدثة: ' + res.monthsUpdatedCount,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ خطأ في المزامنة', res.message, ui.ButtonSet.OK);
  }
}

function syncOnlineStudentsToMainSheetMenu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = syncOnlineStudentsToMainSheet(ss);
  if (res.status === 'success') {
    ui.alert('✅ تم تثبيت طلاب الأونلاين!', 'تمت مزامنة وتثبيت ' + res.synced + ' طالب أونلاين وتحديث شهورهم كـ "مسدد" بنجاح في شيت الطلاب.', ui.ButtonSet.OK);
  } else {
    ui.alert('❌ تنبيه', res.message || 'حدث خطأ في المزامنة', ui.ButtonSet.OK);
  }
}

function syncAllMenu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var centerRes = syncDriveBackupsCore('s2', '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM');
  var onlineRes = syncOnlineStudentsToMainSheet(ss);
  
  var msg = '1. طلاب السنتر من درايف: ' + (centerRes.status === 'success' ? ('تم تحديث ' + centerRes.updatedCount) : centerRes.message) + '\\n' +
            '2. طلاب الأونلاين: تم تثبيت وتحديث شهور ' + onlineRes.synced + ' طالب أونلاين بنجاح.';
  ui.alert('🚀 تمت المزامنة الشاملة بنجاح!', msg, ui.ButtonSet.OK);
}

// الدالة الأساسية لقراءة أحدث ملف باك آب من مجلد درايف
function syncDriveBackupsCore(targetStage, folderId) {
  var stage = targetStage || 's2';
  var targetFolder = null;
  var candidateIds = [
    folderId,
    "1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM",
    "1n9QfJDscZ-l4Ulymls0aqQM_7ULxGjVM", // تجربة l الصغيرة بدلاً من I الكبيرة
    "1n9QfJDscZ-14Ulymls0aqQM_7ULxGjVM", // تجربة رقم 1
    "1RxUSNgaBGqBf9w9kK5owfY8ftD5l9NQ",
    "1RxUSNgaBGqBf9w9kK5owfY8ftD5I9NQ"
  ];

  // 1. المحاولة الأولى: فتح المجلد بأحد المعرّفات المحتملة
  for (var i = 0; i < candidateIds.length; i++) {
    if (!candidateIds[i]) continue;
    try {
      targetFolder = DriveApp.getFolderById(candidateIds[i]);
      if (targetFolder) break;
    } catch (e) {}
  }

  // 2. المحاولة الثانية: البحث بالاسم عن مجلد System_Backups
  if (!targetFolder) {
    try {
      var fldrs = DriveApp.getFoldersByName("System_Backups");
      if (fldrs.hasNext()) targetFolder = fldrs.next();
    } catch(e) {}
  }

  // 3. المحاولة الثالثة: البحث بالاسم عن مجلد "نسخة التطبيق الاحتياطية"
  if (!targetFolder) {
    try {
      var pFldrs = DriveApp.getFoldersByName("نسخة التطبيق الاحتياطية");
      if (pFldrs.hasNext()) {
        var parentF = pFldrs.next();
        var subF = parentF.getFoldersByName("System_Backups");
        if (subF.hasNext()) targetFolder = subF.next();
        else targetFolder = parentF;
      }
    } catch(e) {}
  }

  var latestFile = null;
  var latestDate = 0;

  // إذا تم العثور على المجلد، نبحث عن أحدث ملف JSON بداخله
  if (targetFolder) {
    try {
      var files = targetFolder.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        var fName = f.getName().toLowerCase();
        if (fName.indexOf('.json') > -1) {
          var updated = f.getLastUpdated().getTime();
          if (updated > latestDate) {
            latestDate = updated;
            latestFile = f;
          }
        }
      }
    } catch(e) {}
  }

  // 4. المحاولة الرابعة: إذا لم يتم العثور على المجلد، نبحث مباشرة عن ملفات الباك آب في درايف كله
  if (!latestFile) {
    try {
      var allJsonFiles = DriveApp.searchFiles('title contains ".json" and trashed = false');
      while (allJsonFiles.hasNext()) {
        var jf = allJsonFiles.next();
        var jName = jf.getName().toLowerCase();
        if (jName.indexOf('backup_') > -1 || jName === 'emergency_autosave.json') {
          var uDate = jf.getLastUpdated().getTime();
          if (uDate > latestDate) {
            latestDate = uDate;
            latestFile = jf;
          }
        }
      }
    } catch(e) {}
  }

  // 5. المحاولة الخامسة: البحث المباشر بالاسم عن emergency_autosave.json
  if (!latestFile) {
    try {
      var autoFiles = DriveApp.getFilesByName("emergency_autosave.json");
      if (autoFiles.hasNext()) latestFile = autoFiles.next();
    } catch(e) {}
  }

  if (!latestFile) {
    return { 
      status: 'error', 
      message: 'لم يتم العثور على ملفات الباك آب في حساب Google Drive الحالي.\\n\\n💡 تأكد من الآتي:\\n1. إذا كان شيت المنصة على إيميل جوجل مختلف عن إيميل الباك آب، يرجى فتح جوجل درايف وعمل مشاركة (Share) لمجلد System_Backups مع إيميل هذا الشيت.\\n2. أو يمكنك استخدام زر (رفع ملف الباك آب JSON محلياً) من لوحة إدارة المنصة لتحديث الشيت فوراً.' 
    };
  }

  var content = latestFile.getBlob().getDataAsString('UTF-8');
  var parsedData;
  try {
    parsedData = JSON.parse(content);
  } catch(e) {
    return { status: 'error', message: 'خطأ في قراءة ملف JSON: ' + e.message };
  }

  var res = applyBackupToSheet(parsedData.students, parsedData.transactions, stage);
  if (res.status === 'success') {
    res.fileName = latestFile.getName();
    res.fileDate = latestFile.getLastUpdated().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
  }
  return res;
}

// تطبيق بيانات الطلاب والمعاملات المالية على شيت الطلاب
function applyBackupToSheet(students, transactions, targetStage) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var studentsSheet = ss.getSheetByName('الطلاب');
  if (!studentsSheet) {
    initAllSheets();
    studentsSheet = ss.getSheetByName('الطلاب');
  }

  var stageCode = String(targetStage || 's2').trim();
  
  // 1. تصفية طلاب المرحلة المستهدفة
  var targetStudents = (students || []).filter(function(st) {
    return String(st.stage || '').trim() === stageCode;
  });

  if (targetStudents.length === 0) {
    return { status: 'error', message: 'لم يتم العثور على أي طلاب للمرحلة: ' + stageCode };
  }

  // 2. تجميع الشهور المسددة حصراً من المعاملات الفعلية (transactions)
  // تم إلغاء exemptMonths تماماً لأنها تخص تخفيضات الإخوة في تطبيق السنتر وليست شهوراً مسددة
  var paidMonthsMap = {};
  (transactions || []).forEach(function(tx) {
    if (tx.sid && tx.month) {
      var sid = String(tx.sid).trim();
      if (!paidMonthsMap[sid]) paidMonthsMap[sid] = {};
      var m = String(tx.month).trim();
      if (m) paidMonthsMap[sid][m] = true;
    }
  });

  // 3. تجهيز بيانات طلاب الباك آب مع فهرسة ثلاثية (بالكود والهاتف والاسم)
  var backupList = [];
  var backupByCode = {};
  var backupByPhone = {};
  var backupByName = {};

  var allAcademicMonths = ['سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
  var toAcadOrder = function(mN) {
    return mN >= 9 ? (mN - 8) : (mN + 4);
  };

  targetStudents.forEach(function(st) {
    var p = cleanPhone(st.phone);
    var code = String(st.studentCode || '').trim();
    var name = String(st.name || '').trim();
    var normName = normalizeName(name);

    var isExempt = (st.isFullyExempt === true);
    var sMonths = paidMonthsMap[String(st.id).trim()] ? Object.keys(paidMonthsMap[String(st.id).trim()]) : [];

    // استخراج تاريخ التسجيل وشهر بداية الطالب
    var joinDateObj = null;
    var rawDate = st.createdAt || st.registeredAt || st.registrationDate || st.joinedDate || st.date || st.created_at;
    if (rawDate) {
      var parsedD = new Date(rawDate);
      if (!isNaN(parsedD.getTime())) joinDateObj = parsedD;
    }
    if (!joinDateObj && st.id) {
      var numId = Number(st.id);
      if (!isNaN(numId) && numId > 1672531199000 && numId < 1924982400000) {
        joinDateObj = new Date(numId);
      }
    }

    var regDateFormatted = "";
    var startMonthNum = null;
    if (joinDateObj) {
      var dd = String(joinDateObj.getDate()).padStart(2, '0');
      var mm = String(joinDateObj.getMonth() + 1).padStart(2, '0');
      var yyyy = joinDateObj.getFullYear();
      regDateFormatted = dd + '/' + mm + '/' + yyyy;

      var jMonth = joinDateObj.getMonth() + 1;
      var jDay = joinDateObj.getDate();
      // إذا انضم الطالب في أواخر الشهر (يوم 20 فما بعد)، تبدأ مطالبته الأكاديمية من الشهر التالي
      if (jDay >= 20) {
        startMonthNum = (jMonth === 12) ? 1 : (jMonth + 1);
      } else {
        startMonthNum = jMonth;
      }
    }

    if (st.startMonth) {
      var explicitSm = getMonthNum(st.startMonth);
      if (explicitSm) startMonthNum = explicitSm;
    }

    // تحديد الشهور غير المطالب بها (Waived Months)
    var waivedMonths = [];
    var exemptMonthsList = st.exemptMonths || [];

    allAcademicMonths.forEach(function(mName) {
      if (sMonths.indexOf(mName) > -1) return; // مسدد

      var mNum = getMonthNum(mName);
      if (!mNum) return;

      var isWaived = false;

      // 1. هل الشهر يسبق شهر انضمام الطالب للسنتر؟ (مثلاً جاء أواخر سبتمبر أو في أكتوبر، فشهر سبتمبر غير مطالب به)
      if (startMonthNum !== null) {
        if (toAcadOrder(mNum) < toAcadOrder(startMonthNum)) {
          isWaived = true;
        }
      }

      // 2. هل الشهر معفى في قائمة exemptMonths بالـ JSON؟
      if (!isWaived && exemptMonthsList && Array.isArray(exemptMonthsList)) {
        for (var e = 0; e < exemptMonthsList.length; e++) {
          var ex = String(exemptMonthsList[e]).trim();
          if (ex === mName || ex.indexOf(mName) > -1 || mName.indexOf(ex) > -1 || getMonthNum(ex) === mNum) {
            isWaived = true;
            break;
          }
        }
      }

      // 3. هل الطالب معفى كلياً؟
      if (isExempt) {
        isWaived = true;
      }

      // 4. فحص قائمة المطالبات المحددة في ملف السنتر إن وجدت (unpaidMonths / dueMonths)
      var explicitDues = st.unpaidMonths || st.dueMonths || st.dues;
      if (!isWaived && explicitDues && Array.isArray(explicitDues)) {
        var isExplicitDue = false;
        for (var d = 0; d < explicitDues.length; d++) {
          var dueM = String(explicitDues[d]).trim();
          if (dueM === mName || dueM.indexOf(mName) > -1 || getMonthNum(dueM) === mNum) {
            isExplicitDue = true;
            break;
          }
        }
        if (!isExplicitDue) {
          isWaived = true;
        }
      }

      if (isWaived) {
        waivedMonths.push(mName);
      }
    });

    var bObj = {
      id: String(st.id || '').trim(),
      name: name,
      normName: normName,
      phone: p,
      studentCode: code,
      exempt: isExempt,
      paidMonths: sMonths,
      waivedMonths: waivedMonths,
      regDate: regDateFormatted,
      gender: (st.gender === 'boys' ? 'بنين' : (st.gender === 'girls' ? 'بنات' : '')),
      stage: '2 ثانوي'
    };

    backupList.push(bObj);
    if (code) backupByCode[code] = bObj;
    if (p) backupByPhone[p] = bObj;
    if (normName) backupByName[normName] = bObj;
  });

  // 4. قراءة بيانات شيت الطلاب الحالية
  var sheetData = studentsSheet.getDataRange().getValues();
  var headers = sheetData[0];
  var colMap = findColumnIndices(headers);

  // خريطة أعمدة الشهور في الشيت
  var monthColIndices = {};
  for (var c = 0; c < headers.length; c++) {
    var hName = String(headers[c] || '').trim();
    if (colMap.nonMonthCols.indexOf(c) === -1 || hName === 'أغسطس' || hName === 'سبتمبر' || hName === 'أكتوبر' || hName === 'نوفمبر' || hName === 'ديسمبر' || hName === 'يناير' || hName === 'فبراير' || hName === 'مارس' || hName === 'أبريل' || hName === 'مايو') {
      monthColIndices[hName] = c;
    }
  }

  var updatedCount = 0;
  var monthsUpdatedCount = 0;
  var matchedBackupIds = {};
  var seenSheetKeys = {}; // لتتبع وحذف الصفوف المكررة في الشيت
  var rowsToDelete = [];

  // 5. التحديث والفحص الذكي لجميع صفوف الشيت الحالية + تنظيف التكرارات
  for (var r = 1; r < sheetData.length; r++) {
    var rowCode = colMap.code > -1 ? String(sheetData[r][colMap.code] || '').trim() : '';
    var rowPhone = colMap.phone > -1 ? cleanPhone(sheetData[r][colMap.phone]) : '';
    var rowName = colMap.name > -1 ? String(sheetData[r][colMap.name] || '').trim() : '';
    var rowNormName = normalizeName(rowName);
    var rowGender = colMap.gender > -1 ? String(sheetData[r][colMap.gender] || '').trim() : '';
    var isRowOnline = rowGender.indexOf('أونلاين') > -1 || rowGender.indexOf('اونلاين') > -1 || rowCode.indexOf('ESON') > -1;

    // حماية مطلقة لطلاب الأونلاين: لا يتم حذفهم ولا معاملتهم كصفوف مكررة في باك آب السنتر
    if (isRowOnline) {
      continue;
    }

    // التحقق من التكرار داخل الشيت: إذا تكرر نفس الكود أو الهاتف أو الاسم
    var rowKey = rowCode || rowPhone || rowNormName;
    if (rowKey && seenSheetKeys[rowKey]) {
      // صف مكرر! يتم إضافته لقائمة الحذف
      rowsToDelete.push(r + 1);
      continue;
    }
    if (rowKey) seenSheetKeys[rowKey] = true;

    // مطابقة الطالب: نبحث بالكود أولاً، ثم بالهاتف، ثم بالاسم
    var bStudent = null;
    if (rowCode && backupByCode[rowCode]) bStudent = backupByCode[rowCode];
    else if (rowPhone && backupByPhone[rowPhone]) bStudent = backupByPhone[rowPhone];
    else if (rowNormName && backupByName[rowNormName]) bStudent = backupByName[rowNormName];

    if (!bStudent) continue;

    matchedBackupIds[bStudent.id] = true;
    var studentRowChanged = false;

    // تحديث وتثبيت الهاتف كـ نص صريح مع الصفر إن لم يكن كذلك
    if (colMap.phone > -1 && bStudent.phone) {
      var currentPhoneVal = String(sheetData[r][colMap.phone] || '').trim();
      var desiredPhoneStr = bStudent.phone.startsWith('0') ? bStudent.phone : ('0' + bStudent.phone);
      if (currentPhoneVal !== desiredPhoneStr && cleanPhone(currentPhoneVal) === bStudent.phone) {
        studentsSheet.getRange(r + 1, colMap.phone + 1).setValue("'" + desiredPhoneStr);
      }
    }

    // تحديث الحالة المالية بدقة: معفي فقط لمن لديه إعفاء كلي، ومنتظم للباقين
    if (colMap.status > -1) {
      var curStatus = String(sheetData[r][colMap.status] || '').trim();
      var correctStatus = bStudent.exempt ? 'معفي' : 'منتظم';
      if (curStatus !== correctStatus) {
        studentsSheet.getRange(r + 1, colMap.status + 1).setValue(correctStatus);
        studentRowChanged = true;
      }
    }

    // تحديث المرحلة والنوع إن وجد عمودهما وكان فارغاً
    if (colMap.stage > -1 && !sheetData[r][colMap.stage]) {
      studentsSheet.getRange(r + 1, colMap.stage + 1).setValue(bStudent.stage);
    }
    if (colMap.gender > -1 && !sheetData[r][colMap.gender] && bStudent.gender) {
      studentsSheet.getRange(r + 1, colMap.gender + 1).setValue(bStudent.gender);
    }

    // تحديث تاريخ التسجيل إن وجد عمود له في الشيت
    if (colMap.regDate > -1 && bStudent.regDate && !sheetData[r][colMap.regDate]) {
      studentsSheet.getRange(r + 1, colMap.regDate + 1).setValue(bStudent.regDate);
    }

    // تحديث الشهور (سداد أو إعفاء/عدم مطالبة من واقع الباك آب)
    for (var mName in monthColIndices) {
      var colIdx = monthColIndices[mName];
      var curVal = String(sheetData[r][colIdx] || '').trim();

      if (bStudent.paidMonths.indexOf(mName) > -1) {
        if (!curVal || curVal === '-' || curVal === 'لا' || curVal.indexOf('متأخر') > -1 || curVal.indexOf('غير مسدد') > -1 || curVal.indexOf('غير مطالب') > -1) {
          studentsSheet.getRange(r + 1, colIdx + 1).setValue('مسدد');
          studentRowChanged = true;
          monthsUpdatedCount++;
        }
      } else if (bStudent.waivedMonths.indexOf(mName) > -1 || bStudent.exempt) {
        if (!curVal || curVal === '-' || curVal === 'لا' || curVal.indexOf('متأخر') > -1 || curVal.indexOf('غير مسدد') > -1) {
          studentsSheet.getRange(r + 1, colIdx + 1).setValue('غير مطالب');
          studentRowChanged = true;
          monthsUpdatedCount++;
        }
      }
    }

    if (studentRowChanged) {
      updatedCount++;
    }
  }

  // حذف الصفوف المكررة من الأسفل إلى الأعلى للحفاظ على ترتيب المؤشرات
  if (rowsToDelete.length > 0) {
    for (var d = rowsToDelete.length - 1; d >= 0; d--) {
      studentsSheet.deleteRow(rowsToDelete[d]);
    }
  }

  // 6. إضافة الطلاب الجدد غير المسجلين نهائياً (فقط إذا لم يكن له كود أو هاتف أو اسم مسجل)
  var addedCount = 0;
  backupList.forEach(function(newSt) {
    if (!matchedBackupIds[newSt.id]) {
      var isAlreadyInSheet = (newSt.studentCode && seenSheetKeys[newSt.studentCode]) ||
                             (newSt.phone && seenSheetKeys[newSt.phone]) ||
                             (newSt.normName && seenSheetKeys[newSt.normName]);
      if (isAlreadyInSheet) return;

      var newRow = new Array(headers.length).fill('');
      newRow[colMap.name] = newSt.name;
      var formattedPhoneStr = newSt.phone.startsWith('0') ? newSt.phone : ('0' + newSt.phone);
      newRow[colMap.phone] = "'" + formattedPhoneStr;
      
      if (colMap.code > -1 && newSt.studentCode) newRow[colMap.code] = newSt.studentCode;
      if (colMap.status > -1) newRow[colMap.status] = newSt.exempt ? 'معفي' : 'منتظم';
      if (colMap.stage > -1) newRow[colMap.stage] = newSt.stage;
      if (colMap.gender > -1) newRow[colMap.gender] = newSt.gender;
      if (colMap.regDate > -1 && newSt.regDate) newRow[colMap.regDate] = newSt.regDate;

      for (var mName in monthColIndices) {
        var colIdx = monthColIndices[mName];
        if (newSt.paidMonths.indexOf(mName) > -1) {
          newRow[colIdx] = 'مسدد';
          monthsUpdatedCount++;
        } else if (newSt.waivedMonths.indexOf(mName) > -1 || newSt.exempt) {
          newRow[colIdx] = 'غير مطالب';
          monthsUpdatedCount++;
        }
      }

      studentsSheet.appendRow(newRow);
      addedCount++;
      matchedBackupIds[newSt.id] = true;
      if (newSt.studentCode) seenSheetKeys[newSt.studentCode] = true;
      if (newSt.phone) seenSheetKeys[newSt.phone] = true;
      if (newSt.normName) seenSheetKeys[newSt.normName] = true;
    }
  });

  // 7. دمج وتأمين طلاب الأونلاين من شيت «طلاب_الأونلاين» (لضمان بقائهم حتى لو مسح الشيت وأعيد بناؤه!)
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (onlineSheet) {
    var onData = onlineSheet.getDataRange().getValues();
    if (onData.length > 1) {
      for (var oi = 1; oi < onData.length; oi++) {
        var onCode = String(onData[oi][0] || '').trim();
        var onName = String(onData[oi][1] || '').trim();
        var onPhone = cleanPhone(onData[oi][2]);
        var onStage = String(onData[oi][3] || '').trim() || "2 بكالوريا";
        var onMonthsRaw = String(onData[oi][5] || '').trim();
        var onMonths = onMonthsRaw.split(/[،,]/).map(function(m){ return m.trim(); }).filter(Boolean);

        if (onPhone) {
          syncSingleOnlineStudentToMainSheet(studentsSheet, {
            code: onCode,
            name: onName,
            phone: onPhone,
            stage: onStage,
            activeMonths: onMonths
          });
        }
      }
    }
  }

  return {
    status: 'success',
    updatedCount: updatedCount,
    addedCount: addedCount,
    cleanedDuplicates: rowsToDelete.length,
    monthsUpdatedCount: monthsUpdatedCount,
    totalTargetStudents: targetStudents.length
  };
}

// =========================================================================
// الدالة المحورية لتفعيل طالب الأونلاين بدقة وتحديث الطلاب وطلاب_الأونلاين
// =========================================================================
function activateOnlineStudentCore(ss, payload) {
  var name = String(payload.name || '').trim();
  var rawPhone = String(payload.phone || '').trim();
  var phone = cleanPhone(rawPhone);
  if (!name || !phone) return { status: 'error', message: 'الاسم ورقم الهاتف مطلوبان' };

  // 1. توليد كود الطالب أو استخدام الكود القادم من الواجهة
  var code = String(payload.code || payload.studentCode || '').trim();
  if (!code) {
    var firstChar = name ? name.charAt(0) : 'A';
    var cleanDigits = phone.replace(/[^\\d]/g, '');
    var last4 = cleanDigits.length >= 4 ? cleanDigits.substring(cleanDigits.length - 4) : '0000';
    code = firstChar + last4 + 'ESON';
  }

  // 2. تحديد الشهور المفعلة فقط بناء على باقة الطالب
  var packageType = String(payload.packageType || 'شهري').trim();
  var paidMonths = [];
  var activeMonthsStr = '';

  if (packageType === 'شهري') {
    var m = String(payload.month || 'أكتوبر').trim();
    paidMonths = [m];
    activeMonthsStr = m;
  } else if (packageType === 'ترم أول') {
    paidMonths = ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير'];
    activeMonthsStr = 'الترم الأول (أغسطس - يناير)';
  } else if (packageType === 'ترم ثانٍ') {
    paidMonths = ['فبراير', 'مارس', 'أبريل', 'مايو'];
    activeMonthsStr = 'الترم الثاني (فبراير - مايو)';
  } else if (packageType === 'سنة كاملة') {
    paidMonths = ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
    activeMonthsStr = 'العام كاملاً';
  } else {
    var defM = String(payload.month || 'أكتوبر').trim();
    paidMonths = [defM];
    activeMonthsStr = defM;
  }

  // 3. تحديث أو إضافة الطالب في شيت "الطلاب" الرئيسي
  var studentsSheet = ss.getSheetByName("الطلاب");
  if (studentsSheet) {
    var sData = studentsSheet.getDataRange().getValues();
    var sHeaders = sData[0];
    var colMap = findColumnIndices(sHeaders);

    var monthCols = {};
    for (var h = 0; h < sHeaders.length; h++) {
      var hName = String(sHeaders[h]).trim();
      if (hName) monthCols[hName] = h;
    }

    var existingRow = -1;
    for (var r = 1; r < sData.length; r++) {
      var rPhone = cleanPhone(sData[r][colMap.phone]);
      var rCode = colMap.code > -1 ? String(sData[r][colMap.code]).trim() : '';
      if ((rPhone && rPhone === phone) || (rCode && rCode === code)) {
        existingRow = r + 1;
        break;
      }
    }

    var fPhone = phone.startsWith('0') ? phone : ('0' + phone);

    if (existingRow > -1) {
      if (colMap.name > -1) studentsSheet.getRange(existingRow, colMap.name + 1).setValue(name);
      if (colMap.code > -1) studentsSheet.getRange(existingRow, colMap.code + 1).setValue(code);
      if (colMap.status > -1) studentsSheet.getRange(existingRow, colMap.status + 1).setValue("منتظم");
      if (colMap.stage > -1) studentsSheet.getRange(existingRow, colMap.stage + 1).setValue(payload.stage || "2 بكالوريا");
      if (colMap.gender > -1) studentsSheet.getRange(existingRow, colMap.gender + 1).setValue("أونلاين");
      if (colMap.phone > -1) studentsSheet.getRange(existingRow, colMap.phone + 1).setValue("'" + fPhone);

      // تفعيل الشهور الخاصة بالباقة فقط دون المساس بباقي الشهور
      paidMonths.forEach(function(mName) {
        if (monthCols[mName] !== undefined) {
          studentsSheet.getRange(existingRow, monthCols[mName] + 1).setValue("مسدد");
        }
      });
    } else {
      // صف جديد: جميع الشهور فارغة عدا الشهور المشترك بها فقط
      var newRow = new Array(sHeaders.length).fill('');
      if (colMap.name > -1) newRow[colMap.name] = name;
      if (colMap.code > -1) newRow[colMap.code] = code;
      if (colMap.status > -1) newRow[colMap.status] = "منتظم";
      if (colMap.stage > -1) newRow[colMap.stage] = payload.stage || "2 بكالوريا";
      if (colMap.gender > -1) newRow[colMap.gender] = "أونلاين";
      if (colMap.phone > -1) newRow[colMap.phone] = "'" + fPhone;

      paidMonths.forEach(function(mName) {
        if (monthCols[mName] !== undefined) {
          newRow[monthCols[mName]] = "مسدد";
        }
      });

      studentsSheet.appendRow(newRow);
    }
  }

  // 4. تسجيل الطالب بشكل دائم في شيت "طلاب_الأونلاين"
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!onlineSheet) {
    onlineSheet = ss.insertSheet("طلاب_الأونلاين");
    onlineSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "الحالة"]);
    onlineSheet.getRange(1, 1, 1, 10).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    onlineSheet.setFrozenRows(1);
    onlineSheet.getRange("C:C").setNumberFormat("@");
  }

  var oData = onlineSheet.getDataRange().getValues();
  var oRowIdx = -1;
  for (var oi = 1; oi < oData.length; oi++) {
    var rowP = cleanPhone(oData[oi][2]);
    var rowC = String(oData[oi][0] || '').trim();
    if (rowP === phone || rowC === code) {
      oRowIdx = oi + 1;
      break;
    }
  }

  var actDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
  var fPhoneVal = phone.startsWith('0') ? phone : ('0' + phone);
  var pkgDisplay = packageType === 'شهري' ? ('شهري (' + (payload.month || 'أكتوبر') + ')') : packageType;
  var rowValues = [code, name, "'" + fPhoneVal, payload.stage || "2 بكالوريا", pkgDisplay, activeMonthsStr, payload.method || "تحويل", payload.amount || "", actDate, "نشط"];

  if (oRowIdx > -1) {
    onlineSheet.getRange(oRowIdx, 1, 1, 10).setValues([rowValues]);
  } else {
    onlineSheet.appendRow(rowValues);
  }

  return { status: 'success', studentCode: code };
}

// =========================================================================
// وظيفة التهيئة الشاملة: إنشاء كل صفحات وأعمدة الشيت تلقائياً بضغطة زر واحدة
// =========================================================================
function initAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. شيت الطلاب (مطابق 100% لهيكل الشيت القديم)
  var sSheet = ss.getSheetByName("الطلاب");
  if (!sSheet) {
    sSheet = ss.insertSheet("الطلاب");
    sSheet.appendRow([
      "الاسم", "كود الطالب", "الحالة المالية", "المرحلة", "النوع", "الهاتف",
      "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو",
      "محظور"
    ]);
    sSheet.getRange(1, 1, 1, 17).setBackground("#1e3a8a").setFontColor("#ffffff").setFontWeight("bold");
    sSheet.setFrozenRows(1);
    // ضبط عمود الهاتف كـ نص صريح لمنع اختفاء الصفر
    sSheet.getRange("F:F").setNumberFormat("@");
  }

  // 2. شيت الأسئلة
  var qSheet = ss.getSheetByName("الأسئلة");
  if (!qSheet) {
    qSheet = ss.insertSheet("الأسئلة");
    qSheet.appendRow([
      "الوحدة", "الدرس", "النوع", "السؤال",
      "الاختيار 1", "الاختيار 2", "الاختيار 3", "الاختيار 4",
      "الإجابة الصحيحة", "التفسير", "المفهوم", "الفقرة", "الصوت", "الفيديو", "مذكرة_PDF"
    ]);
    qSheet.getRange(1, 1, 1, 15).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    qSheet.setFrozenRows(1);
  } else {
    // إذا كان شيت الأسئلة موجوداً مسبقاً، نتأكد من إضافة عمود مذكرة_PDF في العمود رقم 15
    var lastCol = Math.max(qSheet.getLastColumn(), 15);
    var qHeaders = qSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (!qHeaders[14] || String(qHeaders[14]).trim() === '') {
      qSheet.getRange(1, 15).setValue("مذكرة_PDF")
        .setBackground("#047857")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
    }
  }

  // 3. شيت النتائج
  var rSheet = ss.getSheetByName("النتائج");
  if (!rSheet) {
    rSheet = ss.insertSheet("النتائج");
    rSheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "الاختبار / الدرس", "النتيجة"]);
    rSheet.getRange(1, 1, 1, 5).setBackground("#b45309").setFontColor("#ffffff").setFontWeight("bold");
    rSheet.setFrozenRows(1);
  }

  // 4. شيت الإعدادات
  var setSheet = ss.getSheetByName("الإعدادات");
  if (!setSheet) {
    setSheet = ss.insertSheet("الإعدادات");
    setSheet.appendRow(["قيمة الاشتراك", "الإشعار", "إعدادات العداد", "الوحدة المستهدفة", "وقت السؤال", "الدروس المنشورة"]);
    setSheet.appendRow(["50 جنيهاً", "مرحباً بكم في منصة الكنز التعليمي", "disabled", "[]", 60, "[]"]);
    setSheet.getRange(1, 1, 1, 6).setBackground("#475569").setFontColor("#ffffff").setFontWeight("bold");
    setSheet.setFrozenRows(1);
  }

  // 5. شيت طلبات الاشتراك
  var reqSheet = ss.getSheetByName("طلبات_الاشتراك") || (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
  if (!reqSheet) {
    reqSheet = ss.insertSheet("طلبات_الاشتراك");
    reqSheet.appendRow(["التاريخ", "الاسم", "رقم الهاتف", "طريقة الدفع", "الحالة"]);
    reqSheet.getRange(1, 1, 1, 5).setBackground("#6b21a8").setFontColor("#ffffff").setFontWeight("bold");
    reqSheet.setFrozenRows(1);
  }

  // 6. شيت الأجهزة
  var devSheet = ss.getSheetByName("الأجهزة");
  if (!devSheet) {
    devSheet = ss.insertSheet("الأجهزة");
    devSheet.appendRow(["رقم الهاتف", "بصمة المتصفح (Fingerprint)", "تاريخ أول تسجيل دخول"]);
    devSheet.getRange(1, 1, 1, 3).setBackground("#374151").setFontColor("#ffffff").setFontWeight("bold");
    devSheet.setFrozenRows(1);
  }

  // 7. شيت طلاب الأونلاين (سجل المشتركين أونلاين الدائم)
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!onlineSheet) {
    onlineSheet = ss.insertSheet("طلاب_الأونلاين");
    onlineSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "ملاحظات"]);
    onlineSheet.getRange(1, 1, 1, 10).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    onlineSheet.setFrozenRows(1);
    onlineSheet.getRange("C:C").setNumberFormat("@");
  }

  // 8. شيت أرشيف الأونلاين (سجل الاشتراكات الملغاة والمحذوفة لحفظ الحقوق المالية)
  var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
  if (!archSheet) {
    archSheet = ss.insertSheet("أرشيف_الأونلاين");
    archSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "تاريخ الإلغاء", "سبب الإلغاء"]);
    archSheet.getRange(1, 1, 1, 11).setBackground("#991b1b").setFontColor("#ffffff").setFontWeight("bold");
    archSheet.setFrozenRows(1);
    archSheet.getRange("C:C").setNumberFormat("@");
  }

  // حذف الورقة الافتراضية الفارغة إن وجدت
  var defaultSheet = ss.getSheetByName("الورقة1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch(e) {}
  }

  // مزامنة فورية وتلقائية لأي طلاب أونلاين موجودين في شيت الطلاب
  syncOnlineStudentsFromMainSheet(ss);

  return { status: 'success', message: 'تم إنشاء وتهيئة كافة صفحات وقواعد بيانات الشيت وتحديث طلاب الأونلاين بنجاح!' };
}

// =========================================================================
// وظيفة مزامنة وتثبيت طلاب الأونلاين وشهورهم من شيت طلاب_الأونلاين إلى شيت الطلاب
// =========================================================================
function syncOnlineStudentsToMainSheet(ss) {
  var sSheet = ss.getSheetByName("الطلاب");
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!sSheet || !onlineSheet) return { status: 'error', message: 'الشيتات غير موجودة' };

  var sData = sSheet.getDataRange().getValues();
  if (sData.length <= 1) return { status: 'success', synced: 0 };
  var sHeaders = sData[0];
  var colMap = findColumnIndices(sHeaders);

  var monthColIndices = {};
  for (var c = 0; c < sHeaders.length; c++) {
    var hName = String(sHeaders[c] || '').trim();
    monthColIndices[hName] = c;
  }

  var oData = onlineSheet.getDataRange().getValues();
  if (oData.length <= 1) return { status: 'success', synced: 0 };

  var sheetRowByPhone = {};
  var sheetRowByCode = {};
  for (var r = 1; r < sData.length; r++) {
    var p = cleanPhone(sData[r][colMap.phone]);
    var cd = colMap.code > -1 ? String(sData[r][colMap.code] || '').trim() : '';
    if (p) sheetRowByPhone[p] = r + 1;
    if (cd) sheetRowByCode[cd] = r + 1;
  }

  var syncedCount = 0;
  for (var oi = 1; oi < oData.length; oi++) {
    var oCode = String(oData[oi][0] || '').trim();
    var oName = String(oData[oi][1] || '').trim();
    var oPhoneRaw = cleanPhone(oData[oi][2]);
    if (!oPhoneRaw) continue;

    var oStage = String(oData[oi][3] || '2 بكالوريا').trim();
    var oPkg = String(oData[oi][4] || '').trim();
    var oActiveMonthsStr = String(oData[oi][5] || '').trim();
    var oStatus = String(oData[oi][9] || 'نشط').trim();

    var monthsToMark = getResolvedMonths(oPkg, oActiveMonthsStr);
    var targetRow = sheetRowByPhone[oPhoneRaw] || (oCode ? sheetRowByCode[oCode] : null);
    var formattedP = oPhoneRaw.startsWith('0') ? oPhoneRaw : ('0' + oPhoneRaw);

    if (targetRow) {
      if (colMap.name > -1 && oName) sSheet.getRange(targetRow, colMap.name + 1).setValue(oName);
      if (colMap.code > -1 && oCode) sSheet.getRange(targetRow, colMap.code + 1).setValue(oCode);
      if (colMap.status > -1) sSheet.getRange(targetRow, colMap.status + 1).setValue(oStatus === 'ملغي' ? 'محظور' : 'منتظم');
      if (colMap.gender > -1) sSheet.getRange(targetRow, colMap.gender + 1).setValue("أونلاين");
      if (colMap.phone > -1) sSheet.getRange(targetRow, colMap.phone + 1).setValue("'" + formattedP);
      if (colMap.stage > -1) sSheet.getRange(targetRow, colMap.stage + 1).setValue(oStage);

      monthsToMark.forEach(function(m) {
        if (monthColIndices[m] !== undefined) {
          sSheet.getRange(targetRow, monthColIndices[m] + 1).setValue("مسدد");
        }
      });
    } else {
      var newR = new Array(sHeaders.length).fill('');
      if (colMap.name > -1) newR[colMap.name] = oName;
      if (colMap.code > -1) newR[colMap.code] = oCode;
      if (colMap.status > -1) newR[colMap.status] = oStatus === 'ملغي' ? 'محظور' : 'منتظم';
      if (colMap.gender > -1) newR[colMap.gender] = "أونلاين";
      if (colMap.phone > -1) newR[colMap.phone] = "'" + formattedP;
      if (colMap.stage > -1) newR[colMap.stage] = oStage;

      monthsToMark.forEach(function(m) {
        if (monthColIndices[m] !== undefined) {
          newR[monthColIndices[m]] = "مسدد";
        }
      });
      sSheet.appendRow(newR);
    }
    syncedCount++;
  }

  return { status: 'success', synced: syncedCount, message: 'تم تثبيت وتحديث شهور ' + syncedCount + ' طالب أونلاين بنجاح!' };
}

function syncOnlineStudentsFromMainSheet(ss) {
  return syncOnlineStudentsToMainSheet(ss);
}

function initAllSheetsMenu() {
  var ui = SpreadsheetApp.getUi();
  var res = initAllSheets();
  ui.alert(
    '✅ تم بنجاح!',
    'تم فحص وتجهيز جميع صفحات الشيت (8 صفحات كاملة) بنجاح:\\n' +
    '1. الطلاب (قاعدة البيانات الأساسية)\\n' +
    '2. الأسئلة (بنك الأسئلة والخرائط)\\n' +
    '3. النتائج (سجل درجات الطلاب)\\n' +
    '4. الإعدادات (أسعار الباقات والرسائل)\\n' +
    '5. طلبات التسجيل (الطلبات المعلقة)\\n' +
    '6. الأجهزة (بصمات أجهزة الدخول)\\n' +
    '7. طلاب_الأونلاين (سجل المشتركين المعتمدين)\\n' +
    '8. أرشيف_الأونلاين (سجل الحسابات الموقوفة)\\n\\n' +
    '✨ جميع الشيتات مؤمنة ومتصلة بالمنصة بنجاح!',
    ui.ButtonSet.OK
  );
}
`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(APPS_SCRIPT_OPTIMIZED_CODE);
    showAlert('تم نسخ الكود بنجاح! يمكنك الآن لصقه في محرر Google Apps Script.');
  };

  const handleUpdateFee = async () => {
    setIsLoading(true);
    try {
      const finalFee = JSON.stringify(editPrices);
      await fetch(API_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'updateSettings', 
          fee: finalFee, 
          packagePrices: JSON.stringify(editPrices),
          announcement: announcementInput, 
          timerMode: timerMode,
          timerUnitTarget: JSON.stringify(timerUnitTargets),
          timerSecondsPerQ: timerSecondsPerQ,
          timerType: timerType,
          examTotalMinutes: examTotalMinutes,
          publishedLessons: JSON.stringify(publishedLessons),
          geminiApiKey: geminiKeyInput.trim(),
          showMistakesNotebook: showMistakesNotebookSetting,
          showResetButtons: showResetButtonSetting,
          certSettings: JSON.stringify(certSettings),
          securitySettings: JSON.stringify(securitySettings),
          examConfigs: JSON.stringify(getAllExamConfigs()),
          apiKey: SECRET_API_KEY 
        }) 
      });
      localStorage.setItem('timerMode', timerMode);
      localStorage.setItem('timerUnitTargets', JSON.stringify(timerUnitTargets));
      localStorage.setItem('timerSecondsPerQ', timerSecondsPerQ.toString());
      localStorage.setItem('timerType', timerType);
      localStorage.setItem('examTotalMinutes', examTotalMinutes.toString());
      localStorage.setItem('packagePrices', JSON.stringify(editPrices));
      localStorage.setItem('platformFee', finalFee);
      localStorage.setItem('kanz_show_mistakes_notebook', JSON.stringify(showMistakesNotebookSetting));
      localStorage.setItem('kanz_show_reset_button', JSON.stringify(showResetButtonSetting));
      localStorage.setItem('app_cert_settings', JSON.stringify(certSettings));
      localStorage.setItem('app_exam_security_settings', JSON.stringify(securitySettings));
      if (geminiKeyInput.trim()) {
        setGeminiApiKey(geminiKeyInput.trim());
      }
      setPackagePrices(editPrices);
      setPlatformFee(editPrices.monthly + ' جنيهاً');
      setAnnouncement(announcementInput);
      showAlert('تم حفظ أسعار باقات الاشتراك وإعدادات المنصة بنجاح! 💾');
    } catch(e) { 
      showAlert('خطأ في الاتصال بالإنترنت'); 
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    let isSyncing = false; // قفل لمنع التزامن المزدوج وإرسال نفس البيانات مرتين
    const syncOfflineResults = async () => {
      if (isSyncing) return;
      try {
        const offlineStr = localStorage.getItem('offlineResults');
        if (offlineStr) {
          const offlineResults = JSON.parse(offlineStr);
          if (!Array.isArray(offlineResults) || offlineResults.length === 0) return;
          
          isSyncing = true;
          const remaining = [];
          // إزالة الطلبات من الذاكرة فوراً لمنع دالة أخرى من التقاطها وتكرار إرسالها
          localStorage.removeItem('offlineResults');
          
          for (const payload of offlineResults) {
            try {
              // تعيين مهلة 8 ثوانٍ للطلب لتجنب التعليق الطويل بسبب ضعف النت الذي يسبب التكرار
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 8000);
              
              const response = await fetch(API_URL, { 
                method: 'POST', 
                body: JSON.stringify(payload),
                signal: controller.signal
              });
              clearTimeout(timeoutId);
              if (!response.ok) throw new Error('Network error');
              const result = await response.json();
              if (result.status !== 'success') throw new Error('Server error');
            } catch(e) {
              remaining.push(payload);
            }
          }
          if (remaining.length > 0) {
            // دمج المتبقي (الفاشل) مع أي طلبات جديدة ربما أضيفت أثناء قيامنا بالمزامنة
            const currentOffline = JSON.parse(localStorage.getItem('offlineResults') || '[]');
            const combined = [...remaining, ...currentOffline];
            // فلترة التكرار (منع وجود نفس الدرس بنفس الدرجة)
            const uniqueCombined = combined.filter((v, i, a) => a.findIndex(t => (t.quiz === v.quiz && t.score === v.score)) === i);
            localStorage.setItem('offlineResults', JSON.stringify(uniqueCombined));
          }
        }

        // مزامنة تسليمات المقالي العالقة بسبب انقطاع النت
        try {
          const offlineEssayStr = localStorage.getItem('offlineEssaySubmissions');
          if (offlineEssayStr) {
            const offlineEssays: any[] = JSON.parse(offlineEssayStr);
            if (Array.isArray(offlineEssays) && offlineEssays.length > 0) {
              const remainingEssays: any[] = [];
              localStorage.removeItem('offlineEssaySubmissions');
              for (const essaySub of offlineEssays) {
                try {
                  await syncEssaySubmissionToCloud(essaySub);
                } catch (err) {
                  remainingEssays.push(essaySub);
                }
              }
              if (remainingEssays.length > 0) {
                const currentOfflineEssays = JSON.parse(localStorage.getItem('offlineEssaySubmissions') || '[]');
                localStorage.setItem('offlineEssaySubmissions', JSON.stringify([...remainingEssays, ...currentOfflineEssays]));
              }
            }
          }
        } catch(essayErr) {}
      } catch(e) {
      } finally {
        isSyncing = false;
      }
    };

    const handleOnline = () => syncOfflineResults();
    window.addEventListener('online', handleOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      syncOfflineResults();
    }
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const saveResultToDB = async (scoreObj: { quizName: string; score: string; studentName?: string; studentPhone?: string }) => {
    const rawTargetPhone = scoreObj.studentPhone || inputPhone;
    const formattedPhone = formatPhoneStr(rawTargetPhone); 
    if (!scoreObj.studentPhone && BASE_STUDENTS[formattedPhone]) return;
    const targetName = scoreObj.studentName || studentName;
    const isOnline = (scoreObj.studentPhone && (scoreObj.studentPhone.includes('ESON') || (adminOnlineStudents || []).some((o: any) => formatPhoneStr(o.phone) === formattedPhone))) ||
                     (studentData?.code && studentData.code.includes('ESON')) || 
                     (studentData as any)?.gender === 'أونلاين' || 
                     (studentData as any)?.packageType;
    const payload = { 
      action: 'saveResult', 
      phone: formattedPhone.startsWith('0') ? '+20'+formattedPhone.substring(1) : formattedPhone, 
      name: targetName, 
      quiz: scoreObj.quizName, 
      score: scoreObj.score, 
      date: new Date().toLocaleString('ar-EG'), 
      studentType: isOnline ? 'أونلاين' : 'سنتر',
      apiKey: SECRET_API_KEY 
    };
    try {
      const response = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
      if (!response.ok) throw new Error('Network error');
      const result = await response.json();
      if (result.status !== 'success') throw new Error('Server error');
    } catch(e) {
      try {
        const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
        if (Array.isArray(offlineResults)) {
              // التأكد من عدم وجود هذا الاختبار مسبقاً في طابور المزامنة
              const isDuplicate = offlineResults.some((r: any) => r.quiz === payload.quiz && r.score === payload.score);
              if (!isDuplicate) {
                offlineResults.push(payload);
                localStorage.setItem('offlineResults', JSON.stringify(offlineResults));
              }
        }
      } catch(err) {}
    }
  };
  
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };
  
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    touchEndX.current = e.touches[0].clientX;
  };
  
  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null || isDrawingMode || !activeLesson) return;
    
    const swipeDistance = touchStartX.current - touchEndX.current;
    
    if (swipeDistance > 40) {
      // سحب لليسار -> التالي (يعمل حصرياً إذا كان السؤال مجاباً لمنع التخطي العرضي باللمس)
      if (isAnswered) {
        if (currentQIndex < activeLesson.questions.length - 1) {
          setCurrentQIndex(currentQIndex + 1);
        } else {
          handleFinishQuiz();
        }
      }
    } else if (swipeDistance < -40) {
      // سحب لليمين -> السابق
      if (currentQIndex > 0) {
        setCurrentQIndex(currentQIndex - 1);
      }
    }
    
    touchStartX.current = null;
    touchEndX.current = null;
  };
  
  const handleSkip = () => {
    if (!userAnswers[currentQIndex]) {
      setSkippedQuestions(prev => {
        const newSkipped = new Set([...prev, currentQIndex]);
        return Array.from(newSkipped).sort((a, b) => a - b);
      });
    }
    if (currentQIndex < (activeLesson?.questions.length || 0) - 1) {
      setCurrentQIndex(currentQIndex + 1);
    }
  };

  const handleTimeUpReview = () => {
    if (activeLesson) {
      const finalAnswers = [...userAnswers];
      const newMistakesToAdd: Question[] = [];
      
      activeLesson.questions.forEach((q, idx) => {
        if (!finalAnswers[idx]) {
          finalAnswers[idx] = {
            isCorrect: false,
            selected: 'لم يتم الإجابة (انتهى الوقت)',
            concept: q.concept,
            paragraph: q.paragraph,
            type: q.type === 'essay' ? 'essay' : 'mcq'
          };
          newMistakesToAdd.push(q);
        }
      });

      if (newMistakesToAdd.length > 0) {
        setUserAnswers(finalAnswers);
        newMistakesToAdd.forEach(q => {
          addMistakeToPermanentNotebook(
            q,
            'لم يتم الإجابة (انتهى الوقت)',
            'لم يتم الإجابة (انتهى الوقت)',
            activeLesson.id,
            activeLesson.title
          );
        });
        setMistakesBank(prev => {
          const newBank = [...prev];
          newMistakesToAdd.forEach(q => {
            const qHash = simpleHash(q.q);
            if (!newBank.some(item => simpleHash(item.q) === qHash)) {
              newBank.push(q);
            }
          });
          localStorage.setItem('mistakesBank', JSON.stringify(newBank));
          return newBank;
        });
      }
      setTimeLeft(-1); // إشارة للنظام بأن الوقت انتهى ونحن الآن في وضع المراجعة
    }
  };

  const finishQuizInternal = () => {
    if (activeLesson) {
      const finalAnswers = [...userAnswers];
      const newMistakesToAdd: Question[] = [];
      
      activeLesson.questions.forEach((q, idx) => {
        if (!finalAnswers[idx]) {
          finalAnswers[idx] = {
            isCorrect: false,
            selected: 'لم يتم الإجابة (انتهى الوقت)',
            concept: q.concept,
            paragraph: q.paragraph,
            type: q.type === 'essay' ? 'essay' : 'mcq'
          };
          newMistakesToAdd.push(q);
        }
      });

      // التحقق مما إذا كان هذا الاختبار قد تم تسليمه رسمياً من قبل (قاعدة التسليم لمرة واحدة فقط)
      const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
      const cleanPhone = formatPhoneStr(phone);
      const completedList: string[] = (() => {
        try { return JSON.parse(localStorage.getItem('completedLessons') || '[]'); } catch(e) { return []; }
      })();
      const pendingSubs = getPendingEssaySubmissions();
      const hasPriorEssaySub = pendingSubs.some(s => 
        (s.lessonId === activeLesson.id || s.quizTitle?.trim() === activeLesson.title?.trim()) &&
        formatPhoneStr(s.studentPhone) === cleanPhone
      );
      const hasPriorScore = lessonScores[activeLesson.id] !== undefined;
      const isAlreadySubmitted = Boolean(isPracticeMode || completedList.includes(activeLesson.id) || hasPriorEssaySub || hasPriorScore);

      // إذا كانت هذه هي المحاولة الرسمية الأولى، نسجل إتمام الاختبار فوراً في القائمة المكتملة ونمسح الجلسة المعلقة
      if (!isAlreadySubmitted) {
        try {
          const completed = JSON.parse(localStorage.getItem('completedLessons') || '[]');
          if (!completed.includes(activeLesson.id)) {
            completed.push(activeLesson.id);
            localStorage.setItem('completedLessons', JSON.stringify(completed));
          }
        } catch(e) {}
        localStorage.removeItem('savedSession');
      }

      const hasEssayQuestions = activeLesson.questions.some(q => q.type === 'essay');
      const examConfig = getExamConfig(activeLesson.id);
      if (activeLesson.id === 'mistakes_bank') {
        examConfig.gradingMode = 'instant_ai';
      }
      const isInstantGrading = !hasEssayQuestions || examConfig.gradingMode === 'instant_ai';

      if (newMistakesToAdd.length > 0 && isInstantGrading) {
        setUserAnswers(finalAnswers);
        newMistakesToAdd.forEach(q => {
          addMistakeToPermanentNotebook(
            q,
            'لم يتم الإجابة (انتهى الوقت)',
            'لم يتم الإجابة (انتهى الوقت)',
            activeLesson.id,
            activeLesson.title
          );
        });
        setMistakesBank(prev => {
          const newBank = [...prev];
          newMistakesToAdd.forEach(q => {
            const qHash = simpleHash(q.q);
            if (!newBank.some(item => simpleHash(item.q) === qHash)) {
              newBank.push(q);
            }
          });
          localStorage.setItem('mistakesBank', JSON.stringify(newBank));
          return newBank;
        });
      }

      if (hasEssayQuestions) {
        if (examConfig.gradingMode === 'instant_ai') {
          setEssaySubmissionModal({
            isOpen: true,
            isGrading: true,
            message: "جاري تصحيح إجاباتك بالذكاء الاصطناعي واعتماد النتيجة...",
            quizTitle: activeLesson.title
          });

          (async () => {
            let earnedScore = 0;
            const essayItemsForStorage: any[] = [];

            for (let idx = 0; idx < activeLesson.questions.length; idx++) {
              const q = activeLesson.questions[idx];
              const ans = finalAnswers[idx];
              const maxQScore = getQuestionMaxScore(q, idx, examConfig);

              if (q.type === 'essay') {
                const studentText = ans?.studentAnswerText || ans?.selected || '';
                const evalResult = await evaluateEssayAnswer(q, studentText, maxQScore);
                const isCorrect = evalResult.percentage >= 60;
                
                finalAnswers[idx] = {
                  ...ans,
                  isCorrect,
                  teacherScore: evalResult.score,
                  teacherFeedback: evalResult.feedback,
                  aiSuggestedScore: evalResult.score,
                  aiSuggestedFeedback: evalResult.feedback,
                  status: 'approved'
                };

                if (examConfig.includeEssayInTotal) {
                  earnedScore += evalResult.score;
                }

                if (activeLesson.id === 'mistakes_bank' && isCorrect) {
                  const qHash = simpleHash(q.q);
                  setMistakesBank(prev => prev.filter(m => simpleHash(m.q) !== qHash));
                  try {
                    const savedBank = JSON.parse(localStorage.getItem('mistakesBank') || '[]');
                    const filtered = savedBank.filter((m: any) => simpleHash(m.q) !== qHash);
                    localStorage.setItem('mistakesBank', JSON.stringify(filtered));
                  } catch(e) {}
                }

                essayItemsForStorage.push({
                  qIndex: idx,
                  questionText: q.q,
                  essayType: q.essayType || detectEssayType(q.q).label,
                  modelAnswer: q.answer || q.reason || '',
                  studentText,
                  maxScore: maxQScore,
                  aiScore: evalResult.score,
                  aiFeedback: evalResult.feedback,
                  teacherScore: evalResult.score,
                  teacherFeedback: evalResult.feedback,
                  isApproved: true
                });
              } else {
                if (ans?.isCorrect) {
                  earnedScore += maxQScore;
                }
              }
            }

            const structure = calculateExamStructure(activeLesson.questions, examConfig);
            const calculatedPerc = Math.round((earnedScore / Math.max(1, structure.examTotalScore)) * 100);

            setUserAnswers(finalAnswers);

            // الإرسال السحابي وحفظ الدرجة الرسمية يتم فقط للمحاولة الأولى غير التدريبية
            if (!isAlreadySubmitted) {
              const instantSub: StudentEssaySubmission = {
                id: `sub_${Date.now()}_${simpleHash(inputPhone || studentName || 'student')}`,
                studentName: studentName || 'طالب',
                studentPhone: inputPhone || '0000',
                quizTitle: activeLesson.title,
                lessonId: activeLesson.id,
                submissionDate: new Date().toLocaleDateString('ar-EG'),
                questions: essayItemsForStorage,
                isFullyApproved: true,
                finalScore: earnedScore,
                maxPossibleScore: structure.examTotalScore
              };
              savePendingEssaySubmission(instantSub);
              syncEssaySubmissionToCloud(instantSub);

              if (activeLesson.id !== 'mistakes_bank') {
                saveResultToDB({ quizName: activeLesson.title, score: `${calculatedPerc}%` });
                setLessonScores(prev => {
                  if (prev[activeLesson.id] === undefined) {
                    const newScores = { ...prev, [activeLesson.id]: Math.round(earnedScore) };
                    localStorage.setItem('lessonScores', JSON.stringify(newScores));
                    return newScores;
                  }
                  return prev;
                });
              }
            }

            setIsScreenObfuscated(false);
            setTabSwitchStrikes(0);
            tabSwitchStrikesRef.current = 0;
            setTabSwitchWarningModal(null);
            setPreSubmitReviewModalOpen(false);
            setOfflineGateStatus('none');
            setExamTimeLeft(null);
            examEndTimeRef.current = null;
            setEssaySubmissionModal(null);
            setScreen('result');
          })();
          return;
        } else {
          // الوضع الهجين (اعتماد المعلم أولاً)
          if (isAlreadySubmitted) {
            // الطالب سبق له تسليم هذا الاختبار رسمياً، وهذه محاولة تدريبية فقط
            setIsScreenObfuscated(false);
            setTabSwitchStrikes(0);
            tabSwitchStrikesRef.current = 0;
            setTabSwitchWarningModal(null);
            setPreSubmitReviewModalOpen(false);
            setOfflineGateStatus('none');
            setExamTimeLeft(null);
            examEndTimeRef.current = null;
            setEssaySubmissionModal({
              isOpen: true,
              isGrading: false,
              message: "✨ تم إنهاء جلسة التدريب بنجاح! نؤكد لك أنه تم حفظ واعتماد محاولتك الرسمية الأولى لدى المعلم أ/ إسلام سعود، ولن يتم إرسال أي محاولات تدريبية أخرى حفاظاً على درجتك الرسمية.",
              quizTitle: activeLesson.title
            });
            return;
          }

          // المحاولة الرسمية الأولى: تجميع الأسئلة وتقييمها بالذكاء الاصطناعي ثم إرسالها للمعلم لمرة واحدة فقط
          const structure = calculateExamStructure(activeLesson.questions, examConfig);
          const allItemsForStorage: EssayReviewQuestionItem[] = [];
          const essayItemsForStorage: EssayReviewQuestionItem[] = [];
          let initialEarnedScore = 0;

          activeLesson.questions.forEach((q, idx) => {
            const ans = finalAnswers[idx];
            const maxQScore = getQuestionMaxScore(q, idx, examConfig);
            const studentText = ans?.studentAnswerText || ans?.selected || '';

            if (q.type === 'essay') {
              const item: EssayReviewQuestionItem = {
                qIndex: idx,
                questionText: q.q,
                essayType: q.essayType || detectEssayType(q.q).label,
                modelAnswer: q.answer || q.reason || '',
                studentText,
                maxScore: maxQScore,
                isApproved: false
              };
              essayItemsForStorage.push(item);
              allItemsForStorage.push(item);
            } else {
              const isCorrect = Boolean(ans?.isCorrect);
              const qScore = isCorrect ? maxQScore : 0;
              initialEarnedScore += qScore;
              const isTf = q.type === 'tf' || q.type === 't/f' || q.type === 'true_false' ||
                           (Array.isArray(q.options) && q.options.length === 2 && (q.options.includes('صح') || q.options.includes('خطأ')));
              allItemsForStorage.push({
                qIndex: idx,
                questionText: q.q,
                essayType: isTf ? 'صح وخطأ' : 'اختر من متعدد',
                modelAnswer: q.correct || q.answer || '',
                studentText: studentText || (isCorrect ? (q.correct || 'إجابة صحيحة') : 'إجابة خاطئة'),
                maxScore: maxQScore,
                teacherScore: qScore,
                aiScore: qScore,
                teacherFeedback: isCorrect ? 'إجابة صحيحة وموفقة.' : `إجابة خاطئة - الإجابة الصحيحة هي: ${q.correct || q.answer}`,
                aiFeedback: isCorrect ? 'إجابة صحيحة وموفقة.' : `إجابة خاطئة - الإجابة الصحيحة هي: ${q.correct || q.answer}`,
                isApproved: true
              });
            }
          });

          (async () => {
            let essayEarned = 0;
            for (const item of essayItemsForStorage) {
              const q = activeLesson.questions[item.qIndex];
              if (q && item.studentText) {
                try {
                  const evalRes = await evaluateEssayAnswer(q, item.studentText, item.maxScore);
                  item.aiScore = evalRes.score;
                  item.aiFeedback = evalRes.feedback;
                  essayEarned += evalRes.score;
                } catch(e) {}
              }
            }
            const evaluatedSub: StudentEssaySubmission = {
              id: `sub_${Date.now()}_${simpleHash(inputPhone || studentName || 'student')}`,
              studentName: studentName || 'طالب',
              studentPhone: inputPhone || '0000',
              quizTitle: activeLesson.title,
              lessonId: activeLesson.id,
              submissionDate: new Date().toLocaleDateString('ar-EG'),
              questions: allItemsForStorage,
              isFullyApproved: false,
              finalScore: initialEarnedScore + essayEarned,
              maxPossibleScore: structure.examTotalScore
            };
            savePendingEssaySubmission(evaluatedSub);
            syncEssaySubmissionToCloud({
              ...evaluatedSub,
              questions: essayItemsForStorage
            });
          })();

          setIsScreenObfuscated(false);
          setTabSwitchStrikes(0);
          tabSwitchStrikesRef.current = 0;
          setTabSwitchWarningModal(null);
          setPreSubmitReviewModalOpen(false);
          setOfflineGateStatus('none');
          setExamTimeLeft(null);
          examEndTimeRef.current = null;
          setEssaySubmissionModal({
            isOpen: true,
            isGrading: false,
            message: "⏳ تم تسليم إجاباتك بنجاح! جاري مراجعة وتصحيح الاختبار واعتماد النتيجة من المعلم أ/ إسلام سعود.",
            quizTitle: activeLesson.title
          });
          return;
        }
      }

      const totalQs = activeLesson.questions.length;
      const correct = finalAnswers.filter(a => a.isCorrect).length;
      const perc = Math.round((correct/totalQs)*100);

      // المحاولة الأولى الرسمية فقط: تسجيل النقاط والإنجازات والنتائج السحابية
      if (!isPracticeMode && !isAlreadySubmitted) {
        // --- Streak Logic ---
        const todayStr = new Date().toDateString();
        setStreak(prev => {
          let newCount = prev.count;
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (prev.lastDate === yesterday.toDateString()) {
            newCount += 1;
          } else if (prev.lastDate !== todayStr) {
            newCount = 1;
          }
          const newStreak = { count: newCount, lastDate: todayStr };
          localStorage.setItem('userStreak', JSON.stringify(newStreak));
          return newStreak;
        });

        // --- Badges Logic ---
        setBadges(prev => {
          const newBadges = new Set(prev);
          const hour = new Date().getHours();
          if (hour >= 0 && hour <= 4) newBadges.add('night_owl');
          if (perc === 100 && activeLesson.id !== 'mistakes_bank') newBadges.add('perfect_arrow');
          if (activeLesson.id === 'mistakes_bank' && perc === 100) newBadges.add('mistake_conqueror');
          const badgesArr = Array.from(newBadges);
          localStorage.setItem('userBadges', JSON.stringify(badgesArr));
          return badgesArr;
        });

        if (activeLesson.id !== 'mistakes_bank') {
          saveResultToDB({ quizName: activeLesson.title, score: `${perc}%` });
          
          setLessonScores(prev => {
            // تسجيل الدرجة من أول محاولة فقط بناءً على طلب المعلم وعدم احتساب الإعادات
            if (prev[activeLesson.id] === undefined) {
              const newScores = { ...prev, [activeLesson.id]: correct };
              localStorage.setItem('lessonScores', JSON.stringify(newScores));
              return newScores;
            }
            return prev;
          });

          try {
            const completed = JSON.parse(localStorage.getItem('completedLessons') || '[]');
            if (!completed.includes(activeLesson.id)) {
              completed.push(activeLesson.id);
              localStorage.setItem('completedLessons', JSON.stringify(completed));
            }
          } catch(e) {}
        }
      }
    }
    setIsScreenObfuscated(false);
    setTabSwitchStrikes(0);
    tabSwitchStrikesRef.current = 0;
    setTabSwitchWarningModal(null);
    setPreSubmitReviewModalOpen(false);
    setOfflineGateStatus('none');
    setExamTimeLeft(null);
    examEndTimeRef.current = null;
    setScreen('result');
  };

  const handleFinishQuiz = (force?: boolean) => {
    if (securitySettings.offlineModeEnabled && typeof navigator !== 'undefined' && !navigator.onLine) {
      setOfflineGateStatus('require_online_to_submit');
      return;
    }

    // فتح شاشة مراجعة الامتحان التفاعلية قبل الاعتماد النهائي
    if (!force && activeLesson) {
      setPreSubmitReviewModalOpen(true);
      return;
    }

    setPreSubmitReviewModalOpen(false);
    setUnansweredWarningModal(null);
    finishQuizInternal();
  };
  
  const getCurrentStudentCategory = (): 'online' | 'center' => {
    const code = studentData?.code || '';
    const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
    const formattedPhone = formatPhoneStr(phone);
    const isOnline = code.includes('ESON') || 
                     (studentData as any)?.gender === 'أونلاين' ||
                     (adminOnlineStudents || []).some((o: any) => formatPhoneStr(o.phone) === formattedPhone);
    return isOnline ? 'online' : 'center';
  };

  const startQuizForLesson = (lesson: Lesson) => {
    // 1. فحص مواعيد وجدولة الامتحان والجمهور المستهدف
    const examConfig = getExamConfig(lesson.id);
    const studentCategory = getCurrentStudentCategory();
    const availability = getExamAvailability(examConfig, studentCategory);

    if (availability.status === 'upcoming') {
      showAlert(`⏳ هذا الامتحان مجدول وسيبدأ في:\n${formatScheduleDate(availability.startDate)}\n\nيرجى الاستعداد والمراجعة حتى موعد فتح الامتحان.`);
      return;
    }

    if (availability.status === 'expired') {
      showAlert(`🔒 عذراً، انتهت فترة إتاحة هذا الامتحان في:\n${formatScheduleDate(availability.endDate)}\n\nتم إغلاق الامتحان ولا يمكن تقديم إجابات جديدة.`);
      return;
    }

    if (availability.status === 'not_targeted') {
      showAlert(`🚫 ${availability.message}`);
      return;
    }

    const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
    const cleanPhone = formatPhoneStr(phone);
    const submissions = getStudentSubmissions(cleanPhone);
    const pendingSub = submissions.find(s => (s.lessonId === lesson.id || s.quizTitle?.trim() === lesson.title?.trim()) && !s.isFullyApproved);
    if (pendingSub) {
      showAlert('⏳ هذا الاختبار قيد المراجعة والاعتماد حالياً من المعلم أ/ إسلام سعود، ستتمكن من مراجعته والتدريب عليه فور اعتماد النتيجة.');
      return;
    }

    const isCompletedLocal = (() => {
      try {
        const arr = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        return arr.includes(lesson.id);
      } catch(e) {
        return false;
      }
    })();
    const isAlreadyDone = lessonScores[lesson.id] !== undefined || isCompletedLocal;
    setIsPracticeMode(isAlreadyDone);
    setIsReviewMode(false);

    if (securitySettings.offlineModeEnabled && typeof navigator !== 'undefined' && navigator.onLine) {
      setOfflineGateStatus('require_offline_to_start');
    } else {
      setOfflineGateStatus('none');
    }
    tabSwitchStrikesRef.current = 0;
    setTabSwitchStrikes(0);
    setIsScreenObfuscated(false);
    setTabSwitchWarningModal(null);

    const session = localStorage.getItem('savedSession'); 
    let restored = false;
    const timerOn = isLessonTimerActive(lesson.title, lesson.id);

    if (session) {
      const parsed = JSON.parse(session);
      if (parsed.lessonId === lesson.id) {
        const restoredLesson = {
          ...lesson,
          questions: parsed.questions || lesson.questions
        };
        setActiveLesson(restoredLesson); 
        setUserAnswers(parsed.answers || []); 
        setCurrentQIndex(parsed.currentIndex || 0); 
        if (timerOn) {
          if (timerType === 'total_exam') {
            if (parsed.examEndTime) {
              const diffSec = Math.max(0, Math.floor((parsed.examEndTime - Date.now()) / 1000));
              examEndTimeRef.current = parsed.examEndTime;
              setExamTimeLeft(diffSec);
            } else {
              const end = Date.now() + (examTotalMinutes * 60 * 1000);
              examEndTimeRef.current = end;
              setExamTimeLeft(examTotalMinutes * 60);
            }
            setTimeLeft(null);
          } else {
            const alreadyAns = (parsed.answers || [])[parsed.currentIndex || 0] !== undefined;
            setTimeLeft(alreadyAns ? null : timerSecondsPerQ);
            setExamTimeLeft(null);
            examEndTimeRef.current = null;
          }
        } else {
          setTimeLeft(null);
          setExamTimeLeft(null);
          examEndTimeRef.current = null;
        }
        setScreen('quiz'); 
        setSkippedQuestions(parsed.skippedQuestions || []);
        restored = true;
      }
    }
    if (!restored) { 
      const shuffledQuestions = shuffleArray(lesson.questions).map(q => {
        if (q.type === 'mcq' && q.options && q.options.length > 0) {
          return { ...q, options: shuffleOptions(q.options) };
        }
        return q;
      });
      setActiveLesson({ ...lesson, questions: shuffledQuestions }); 
      setCurrentQIndex(0); 
      setUserAnswers([]); 
      setSkippedQuestions([]);
      if (timerOn) {
        if (timerType === 'total_exam') {
          const end = Date.now() + (examTotalMinutes * 60 * 1000);
          examEndTimeRef.current = end;
          setExamTimeLeft(examTotalMinutes * 60);
          setTimeLeft(null);
        } else {
          setTimeLeft(timerSecondsPerQ);
          setExamTimeLeft(null);
          examEndTimeRef.current = null;
        }
      } else {
        setTimeLeft(null);
        setExamTimeLeft(null);
        examEndTimeRef.current = null;
      }
      setScreen('quiz'); 
    }
    setLessonModalOptions(null); 
  };
  
  let isAnswered = false; 
  let currentAnswer: UserAnswer | null = null; 
  let question: Question | null = null; 
  let totalQs = 0;
  
  if (screen === 'quiz' && activeLesson) {
    question = activeLesson.questions[currentQIndex]; 
    totalQs = activeLesson.questions.length;
    if (question) {
      isAnswered = userAnswers[currentQIndex] !== undefined; 
      currentAnswer = userAnswers[currentQIndex] || null;
    }
  }
  
  const formatLessonTitleJSX = (title: string) => {
    if (!title) return title;
    const parts = title.split(':');
    if (parts.length > 1) {
      return (
        <>
          <span className="text-secondary font-black" style={{ fontSize: '18px' }}>{parts[0]}:</span>
          {parts.slice(1).join(':')}
        </>
      );
    }
    return title;
  };
  
  const renderScreen = () => {
    if (screen === 'returning_welcome') {
      return (
        <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-gray-50 watermark-container">
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-2xl text-center max-w-md w-full border-t-8 border-secondary animate-fade-in relative overflow-hidden">
            <i className="fas fa-hand-sparkles text-5xl sm:text-6xl text-secondary mb-4 block relative z-10"></i>
            <h2 className="text-2xl sm:text-3xl font-black text-primary mb-2 relative z-10">مرحبا بك يا : {studentName} <i className="fas fa-crown text-gold mr-1"></i></h2>
            
            <p className="text-gray-800 text-lg sm:text-xl font-bold mb-6 mt-3 relative z-10 leading-relaxed">
              سعدت بعودتك جاهز يا بطل نكمل
            </p>

            <div className="flex flex-col gap-3 relative z-10 w-full">
              <button 
                onClick={handleResume} 
                disabled={isLoading} 
                className="bg-secondary text-white font-black text-lg sm:text-xl py-3.5 px-6 rounded-2xl w-full shadow-md hover:bg-green-600 transition-colors flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <>نعم <i className="fas fa-check-circle"></i></>}
              </button>

              <button onClick={handleLogout} className="text-gray-500 font-bold text-sm underline hover:text-red-500 mt-3 relative z-10 cursor-pointer">
                تسجيل خروج (لست {studentName.split(' ')[0]})
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    if (screen === 'home') {
      const livePhone = formatPhoneStr(inputPhone); 
      const liveAdmin = BASE_STUDENTS[livePhone];
      let liveStudents = studentsList[livePhone]; 
      if (liveStudents && !Array.isArray(liveStudents)) liveStudents = [liveStudents];
      const studentsArr = liveStudents as Student[];
      
      return (
        <div className="h-[100dvh] w-full flex items-center justify-center p-4 md:p-6 overflow-y-auto custom-scrollbar relative bg-[#f8fafc] watermark-container">
          <div className="w-full max-w-2xl flex flex-col items-center gap-4 sm:gap-5 py-6 z-10 my-auto">
            
            <i className="fas fa-graduation-cap text-5xl sm:text-7xl md:text-8xl text-gold drop-shadow-sm mb-1.5" style={{ fontSize: '70px', lineHeight: '26px' }}></i>
            <div className="flex flex-row items-center justify-center gap-2 sm:gap-4 mb-2">
              <span className="text-primary font-black sm:text-7xl md:text-8xl tracking-tighter" style={{ fontSize: '35px', lineHeight: '35px' }}>موسوعة</span>
              <div className="w-1.5 h-11 sm:h-20 bg-primary rounded-sm"></div>
              <div className="flex flex-col justify-center text-right">
                <span className="font-black sm:text-3xl md:text-4xl text-gold mb-0.5" style={{ fontSize: '25px', lineHeight: '39px', marginTop: '-2px', marginBottom: '-2px' }}>الكنز</span>
                <span className="text-primary font-black sm:text-3xl md:text-4xl">التعليمي</span>
              </div>
            </div>
            <div className="text-center space-y-2 px-2 mt-1">
              <h2 className="text-lg sm:text-xl md:text-2xl font-black text-gray-800" style={{ textAlign: 'center', fontWeight: 'bold', marginTop: '-13px' }}>بوابتك الذكية لإتقان <span className="text-secondary">({subjectName})</span></h2>
              <p className="sm:text-base md:text-lg text-gray-700 max-w-md mx-auto leading-relaxed border-2 border-gold bg-white/70 backdrop-blur-md p-3 rounded-2xl shadow-sm mt-2" style={{ fontSize: '13px', fontWeight: 'bold', color: '#000000', paddingLeft: '17px', paddingRight: '16px', paddingBottom: '14px', paddingTop: '14px', marginLeft: '-2px', lineHeight: '25.125px' }}>منصتك الشاملة للمراجعة المستمرة واختبار قدراتك وإعدادك للامتحان بأسلوب تفاعلي مميز وعصري وفقاً لآخر التعديلات.</p>
            </div>
            <div className="inline-block bg-primary text-white px-8 py-2 rounded-full font-bold shadow-md text-sm sm:text-base text-center" style={{ marginTop: '-9px', marginBottom: '-18px' }}>لـ {gradeName}</div>
            
            <div className="w-full max-w-xs sm:max-w-sm md:max-w-md bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-6 md:p-8 pt-10 border border-gray-100 flex flex-col items-center gap-4 relative mt-2">
              <div className="absolute top-0 right-0 bg-secondary text-white text-xs sm:text-sm font-black px-5 py-2 rounded-tr-[1.5rem] rounded-bl-[1.5rem] shadow-sm" style={{ marginBottom: '-12px' }}>المراجعة الذهبية</div>
              <h3 className="text-xl sm:text-2xl font-black text-primary mt-4" style={{ marginTop: '1px', marginBottom: '-9px' }}>ابدأ رحلتك الآن</h3>
              
              <div className="w-full relative mt-2">
                <input 
                  type="tel" 
                  placeholder="أدخل رقم الهاتف المسجل لدينا" 
                  className={`w-full text-center border-b-2 border-gray-200 focus:border-primary outline-none py-3 text-sm sm:text-base font-bold text-gray-600 transition-colors ${showPasswordInput ? 'opacity-50' : ''}`} 
                  value={inputPhone} 
                  onChange={(e) => { 
                    setInputPhone(e.target.value); 
                    setSelectedTwin(null); 
                    if (showPasswordInput) { 
                      setShowPasswordInput(false); 
                      setInputPassword(''); 
                    } 
                  }} 
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()} 
                  disabled={showPasswordInput} 
                  style={{ marginTop: '-18px', marginBottom: '2px' }}
                />
                {liveAdmin && !showPasswordInput && <div className="text-secondary font-black text-sm mt-3 text-center">مرحباً يا : {liveAdmin.name}</div>}
                {liveStudents && !showPasswordInput && !liveAdmin && (
                  <div className="w-full mt-4">
                    {studentsArr.length === 1 ? <div className="text-secondary font-black text-sm text-center">مرحباً يا : {studentsArr[0].name}</div> : (
                      <div className="flex flex-col gap-2 items-center bg-gray-50 p-3 rounded-xl border border-gray-200">
                        <div className="text-primary font-bold text-sm text-center">يوجد أكثر من طالب، هل أنت:</div>
                        <div className="flex flex-wrap justify-center gap-2">
                          {studentsArr.map((st, idx) => (
                            <button 
                              key={idx} 
                              onClick={() => { 
                                setSelectedTwin(st); 
                                setLoginError(''); 
                              }} 
                              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm border-2 ${selectedTwin?.name === st.name ? 'bg-secondary text-white border-secondary' : 'bg-white text-gray-700 hover:border-secondary'}`}
                            >
                              {st.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {showPasswordInput && (
                  <div className="w-full text-center mt-4">
                    <div className="text-secondary font-black text-sm mb-2">
                      مرحباً يا : {liveAdmin?.name || selectedTwin?.name || (studentsArr && studentsArr.length === 1 ? studentsArr[0].name : '')}
                    </div>
                    <input 
                      type={liveAdmin ? "password" : "text"} 
                      placeholder={liveAdmin ? "الرقم السري" : "أدخل كود الطالب (الشهري)"} 
                      className="w-full text-center border-b-2 border-gray-300 focus:border-secondary outline-none py-2 text-base font-bold tracking-wider" 
                      value={inputPassword} 
                      onChange={(e) => setInputPassword(e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()} 
                      autoFocus 
                    />
                    {!liveAdmin && (
                      <p className="text-[11px] text-gray-500 font-bold mt-1.5 flex items-center justify-center gap-1">
                        <i className="fas fa-shield-alt text-amber-500"></i> يُطلب الكود لمرة واحدة فقط بداية كل شهر
                      </p>
                    )}
                  </div>
                )}
                {loginError && <div className="text-red-500 text-xs sm:text-sm font-bold mt-4 text-center bg-red-50 py-2 px-3 rounded-lg border border-red-100"><i className="fas fa-exclamation-circle"></i> {loginError}</div>}
              </div>
              
              <button onClick={handleLogin} disabled={isLoading} className="w-full bg-primary text-white font-bold text-base sm:text-lg py-3.5 rounded-xl hover:bg-gray-900 transition-colors duration-300 shadow-md mt-2 flex items-center justify-center gap-2 cursor-pointer">
                {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <>دخول <i className="fas fa-arrow-left"></i></>}
              </button>

              {showInstallBtn && (
                <button 
                  onClick={handleInstallClick} 
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  style={{ marginTop: '-8px', marginBottom: '-16px' }}
                >
                  <i className="fas fa-download text-lg"></i> تثبيت التطبيق على الهاتف أو الكمبيوتر 📱💻
                </button>
              )}
              
              <div className="text-center mt-4 text-lg sm:text-xl flex justify-center gap-1.5 w-full">
                <span className={isDarkMode ? "text-gray-100 font-bold" : "text-primary font-bold"} style={{ fontSize: '21px' }}>رؤية وإعداد</span> <span className="text-pink-600 font-black" style={{ fontSize: '23px' }}>أ/ إسلام سعود</span>
              </div>
            </div>
          </div>
          
          {showUnpaidModal && studentData && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col">
                <i className="fas fa-hand-holding-usd text-5xl text-red-500 mb-4 block"></i>
                <h2 className="text-2xl font-black text-primary mb-2">الحساب موقوف مؤقتاً</h2>
                
                {studentData.missingMonths && studentData.missingMonths.length > 0 ? (
                  <p className="text-gray-700 font-bold mb-3 text-base leading-relaxed">
                    تم إيقاف حسابك مؤقتاً لعدم سداد اشتراك شهر: <span className="text-red-600">({studentData.missingMonths?.join('، ')})</span>
                  </p>
                ) : (
                  <p className="text-gray-700 font-bold mb-3 text-base leading-relaxed">
                    تم إيقاف حسابك مؤقتاً لعدم سداد الاشتراك.
                  </p>
                )}
                
                <div className="border-2 border-dashed border-gray-300 bg-gray-50 p-3 rounded-xl mb-4">
                  <span className="text-gray-800 font-bold">للسداد إلى رقم:</span><br/>
                  <span className="text-primary font-black text-xl" dir="ltr">01228466613</span>
                </div>
                
                <p className="text-sm font-bold text-gray-500 mb-2">اختر طريقة السداد:</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setUnpaidPaymentMethod('فودافون كاش')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${unpaidPaymentMethod === 'فودافون كاش' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>فودافون كاش</button>
                  <button onClick={() => setUnpaidPaymentMethod('إنستاباي')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${unpaidPaymentMethod === 'إنستاباي' ? 'bg-purple-50 border-purple-500 text-purple-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>إنستاباي</button>
                </div>
                
                <p className="text-sm font-bold text-secondary mb-4">ثم انتظار رد الإدارة للتفعيل.</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      if (!unpaidPaymentMethod) { 
                        showAlert('الرجاء اختيار طريقة الدفع (فودافون كاش أو إنستاباي) أولاً.'); 
                        return; 
                      }
                      const whatsappMsg = `السلام عليكم ورحمة الله وبركاته، أ/ إسلام سعود.\nأنا الطالب(ة): ${studentData.name}\nأرغب في سداد متأخرات شهر (${studentData.missingMonths?.join('، ')}) لتفعيل حسابي.\nقمت بالسداد من خلال: ${unpaidPaymentMethod}\n(سأقوم بإرفاق صورة التحويل الآن لتأكيد السداد)`;
                    window.open(`https://wa.me/201228466613?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
                    }} 
                    className="w-full bg-secondary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-green-700 transition-colors flex justify-center items-center gap-2"
                  >
                    <i className="fab fa-whatsapp text-xl"></i> إرسال صورة التحويل
                  </button>
                  <button onClick={() => {setShowUnpaidModal(false); setStudentData(null); setUnpaidPaymentMethod('');}} className="w-full bg-gray-200 text-gray-800 font-bold py-3 rounded-xl hover:bg-gray-300 transition-colors">إغلاق وعودة</button>
                </div>
              </div>
            </div>
          )}

          {showGraceModal && studentData && (
            <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col border-2 border-amber-300 relative">
                <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-300 flex items-center justify-center mx-auto mb-3 shadow-inner">
                  <span className="text-3xl">⏳</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-amber-950 mb-1">تذكير بسداد الاشتراك 🌟</h2>
                <div className="inline-block bg-amber-100 text-amber-900 text-xs font-black px-3.5 py-1 rounded-full mx-auto mb-3 border border-amber-200">
                  مهلة السداد تنتهي يوم 5 {toEasternArabic(new Date().getMonth() + 1)} (متبقي {toEasternArabic(studentData.graceDaysRemaining || 1)} {studentData.graceDaysRemaining === 1 ? 'يوم' : 'أيام'})
                </div>
                
                <p className="text-gray-700 font-bold mb-3 text-xs sm:text-sm leading-relaxed text-right bg-amber-50/60 p-3 rounded-2xl border border-amber-200">
                  أهلاً بك يا بطل 🎓 نود تذكيرك بأن اشتراك شهر <span className="text-amber-800 font-black">({studentData.graceMonths?.join('، ')})</span> لم يُسجل سداده بعد. نرجو المبادرة بالسداد قبل انتهاء المهلة يوم 5 لضمان استمرار فتح الامتحانات والخدمات دون توقف.
                </p>
                
                <div className="border border-dashed border-gray-300 bg-gray-50 p-2.5 rounded-xl mb-3 text-center">
                  <span className="text-gray-600 text-xs font-bold">فودافون كاش / إنستاباي:</span><br/>
                  <span className="text-primary font-black text-lg" dir="ltr">01228466613</span>
                </div>
                
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => {
                      const whatsappMsg = `السلام عليكم ورحمة الله وبركاته، أ/ إسلام سعود.\nأنا الطالب(ة): ${studentData.name}\nأرغب في سداد اشتراك شهر (${studentData.graceMonths?.join('، ')}).\n(سأقوم بإرفاق صورة التحويل الآن لتأكيد السداد)`;
                      window.open(`https://wa.me/201228466613?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
                    }} 
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-2.5 rounded-xl shadow-md transition-all flex justify-center items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <i className="fab fa-whatsapp text-lg"></i> إرسال التحويل عبر واتساب
                  </button>
                  <button 
                    onClick={async () => {
                      setShowGraceModal(false);
                      if (pendingGraceLogin) {
                        await pendingGraceLogin();
                      }
                    }} 
                    className="w-full bg-primary hover:bg-gray-900 text-white font-black text-sm py-2.5 rounded-xl shadow-sm transition-all flex justify-center items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    متابعة إلى المنصة والمذاكرة 🚀
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {showWelcomeSubscribeModal && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col">
                <i className="fas fa-crown text-5xl text-gold mb-4 block drop-shadow-sm"></i>
                <h2 className="text-2xl font-black text-primary mb-2">أهلاً بك يا بطل!</h2>
                <p className="text-gray-700 font-bold mb-6 text-base leading-relaxed">أهلاً بك في منصتك الأولى لضمان الدرجة النهائية.<br/>هل تود الاشتراك معنا؟</p>
                <div className="flex gap-3">
                  <button onClick={() => { setShowWelcomeSubscribeModal(false); setShowRegisterModal(true); }} className="flex-1 bg-secondary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-green-700 transition-colors">نعم</button>
                  <button onClick={() => { setShowWelcomeSubscribeModal(false); setInputPhone(''); }} className="flex-1 bg-red-600 text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-red-700 transition-colors">لا</button>
                </div>
              </div>
            </div>
          )}
          
          {showRegisterModal && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col relative max-h-[90dvh] overflow-y-auto custom-scrollbar">
                <i className="fas fa-user-plus text-5xl text-primary mb-4 block"></i>
                <h2 className="text-2xl font-black text-primary mb-2">تسجيل طالب جديد</h2>
                <input 
                  type="text" 
                  placeholder="اسم الطالب رباعي" 
                  className="w-full text-center border-2 border-gray-200 focus:border-primary outline-none py-3 px-4 rounded-xl mb-4 text-sm font-bold" 
                  value={registerName} 
                  onChange={(e) => setRegisterName(e.target.value)} 
                />
                
                {/* اختيار الباقة */}
                <div className="mb-3 text-right">
                  <label className="block text-xs font-black text-gray-700 mb-2">اختر باقة الاشتراك المطلوبة:</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'شهري', title: 'اشتراك شهري', price: packagePrices.monthly, icon: '📅' },
                      { id: 'ترم أول', title: 'ترم أول', price: packagePrices.term1, icon: '📘' },
                      { id: 'ترم ثانٍ', title: 'ترم ثانٍ', price: packagePrices.term2, icon: '📗' },
                      { id: 'سنة كاملة', title: 'عام كامل', price: packagePrices.fullYear, icon: '⭐', badge: 'الأوفر' },
                    ].map(pkg => (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPackage(pkg.id as any)}
                        className={`p-2.5 rounded-xl border-2 text-center transition-all cursor-pointer relative ${
                          selectedPackage === pkg.id 
                            ? 'bg-blue-50 border-secondary shadow-sm ring-2 ring-secondary/20' 
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        {pkg.badge && (
                          <span className="absolute -top-2 left-2 bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm">
                            {pkg.badge}
                          </span>
                        )}
                        <div className="text-xs font-black text-gray-800 flex items-center justify-center gap-1">
                          <span>{pkg.icon}</span>
                          <span>{pkg.title}</span>
                        </div>
                        <div className="text-sm font-black text-secondary mt-0.5">
                          {pkg.price} <span className="text-[10px] text-gray-500 font-bold">ج.م</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-xl mb-3 flex justify-between items-center px-4">
                  <span className="text-gray-700 font-bold text-xs">قيمة باقة ({selectedPackage}):</span>
                  <span className="text-secondary font-black text-lg">
                    {selectedPackage === 'شهري' ? packagePrices.monthly : selectedPackage === 'ترم أول' ? packagePrices.term1 : selectedPackage === 'ترم ثانٍ' ? packagePrices.term2 : packagePrices.fullYear} ج.م
                  </span>
                </div>
                
                <div className="border-2 border-dashed border-gray-300 bg-gray-50 p-3 rounded-xl mb-4">
                  <span className="text-gray-800 font-bold">يتم تحويل الاشتراك إلى رقم:</span><br/>
                  <span className="text-primary font-black text-xl" dir="ltr">01228466613</span>
                </div>
                
                <p className="text-sm font-bold text-gray-500 mb-2">أخبرنا بطريقة السداد:</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setRegisterNameMethod('فودافون كاش')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${registerMethod === 'فودافون كاش' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>فودافون كاش</button>
                  <button onClick={() => setRegisterNameMethod('إنستاباي')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${registerMethod === 'إنستاباي' ? 'bg-purple-50 border-purple-500 text-purple-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>إنستاباي</button>
                </div>
                
                <p className="text-sm font-black text-red-600 mb-4">قم بإرفاق وصل السداد</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => { 
                      handleRegisterSubmit(); 
                      setShowRegisterModal(false); 
                    }} 
                    className="w-full bg-secondary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-green-700 transition-colors flex justify-center items-center gap-2"
                  >
                    <i className="fab fa-whatsapp text-xl"></i> إرسال صورة التحويل
                  </button>
                  <button onClick={() => {setShowRegisterModal(false); setRegisterNameMethod('');}} className="w-full bg-gray-200 text-gray-800 font-bold py-3 rounded-xl hover:bg-gray-300 transition-colors">إلغاء</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    
    if (screen === 'index') {
      const isTeacherAdmin = BASE_STUDENTS[formatPhoneStr(inputPhone)]?.role === 'admin';
      return (
        <div className={`h-[100dvh] flex flex-col watermark-container ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <div className={`shadow-sm px-3 pt-2.5 pb-2 z-10 border-b-2 flex justify-between items-center gap-2 sm:gap-4 w-full shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
              <i className="fas fa-graduation-cap text-2xl sm:text-3xl md:text-4xl text-gold shrink-0" style={{ fontSize: '26px', lineHeight: '24px' }}></i>
              <div className="flex flex-col items-start text-right min-w-0 shrink">
                <div className="flex items-center gap-2">
                  <div className="font-black text-[12px] sm:text-lg md:text-xl lg:text-2xl leading-none whitespace-nowrap">
                    <span className="text-secondary">موسوعة </span>
                    <span className={isDarkMode ? 'text-gray-100' : 'text-primary'}>الكنز التعليمي</span>
                  </div>
                  {streak.count > 0 && (
                    <div className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black flex items-center gap-1 shadow-sm border ${isDarkMode ? 'bg-orange-950/40 border-orange-700 text-orange-400' : 'bg-orange-50 border-orange-200 text-orange-600'}`} title="شعلة التحدي اليومي">
                      <i className="fas fa-fire animate-pulse text-orange-500"></i> {toEasternArabic(streak.count)}
                    </div>
                  )}
                </div>
                <div className="text-[8px] sm:text-[10px] md:text-xs lg:text-sm font-bold mt-1 flex gap-1 justify-start whitespace-nowrap">
                  <span className={isDarkMode ? "text-gray-200 font-bold" : "text-primary font-bold"}>رؤية وإعداد</span>
                  <span className="text-pink-600 font-black">أ/ إسلام سعود</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-1.5 shrink-0 max-w-[65%] sm:max-w-[55%]">
              <div className="flex items-center gap-1.5 w-full justify-end">
                {isTeacherAdmin && (
                  <button onClick={() => setScreen('admin')} className="bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe] px-1.5 py-0.5 md:py-1 rounded-md text-[8px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm hover:bg-blue-100 transition-colors shrink-0">
                    إدارة <i className="fas fa-user-shield"></i>
                  </button>
                )}
                <button onClick={toggleFullscreen} className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-[10px] sm:text-xs shadow-sm transition-colors shrink-0 border cursor-pointer ${isFullscreen ? 'bg-secondary text-white border-secondary' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`} title="تكبير">
                  <i className={`fas ${isFullscreen?'fa-compress':'fa-expand'}`}></i>
                </button>
                <button onClick={()=>setIsDarkMode(!isDarkMode)} className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-[10px] sm:text-xs shadow-sm transition-colors shrink-0 border cursor-pointer ${isDarkMode ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`} title="ليلي">
                  <i className={`fas ${isDarkMode?'fa-sun':'fa-moon'}`}></i>
                </button>
                <div className={`px-2 py-0.5 md:py-1 rounded-md text-[8px] sm:text-xs md:text-sm font-black shadow-sm text-center shrink-0 whitespace-nowrap border ${isDarkMode ? 'bg-amber-900 text-amber-100 border-amber-600' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                  {gradeName}
                </div>
              </div>
            <div className="flex justify-start sm:justify-end items-center gap-1.5 w-full overflow-x-auto flex-nowrap custom-scrollbar pb-0.5 mt-0.5">
                <button onClick={handleRefresh} disabled={isLoading} className={`px-2 py-0.5 md:py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm transition-colors shrink-0 border ${isDarkMode ? 'bg-blue-900 text-blue-100 border-blue-800 hover:bg-blue-800' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`} style={{ marginTop: '0px' }}>
                  تحديث <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}></i>
                </button>

                <button 
                  onClick={() => setShowStudentEssayListModal(true)} 
                  className={`px-2 py-0.5 md:py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm transition-colors shrink-0 border relative cursor-pointer ${
                    isDarkMode 
                      ? 'bg-purple-900/60 text-purple-200 border-purple-700 hover:bg-purple-800' 
                      : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                  }`}
                  title="سجل نتائج وتصحيح الاختبارات المقالية"
                >
                  <i className="fas fa-feather-alt text-amber-500"></i>
                  <span>المقالي</span>
                  {currentStudentSubmissions.length > 0 && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  )}
                </button>
                
                {showResetButtonSetting && (
                  <button 
                    onClick={() => showConfirm('هل أنت متأكد من مسح جميع إجاباتك والبدء من جديد؟\nتحذير: سيؤدي هذا إلى فقدان تقدمك الحالي وترتيبك في لوحة الشرف!', () => {
                      const completedLessonNames: string[] = [];
                      data.forEach(u => u.lessons.forEach(l => { if(l.completed) completedLessonNames.push(l.title); }));
                      
                      if (completedLessonNames.length > 0) {
                        saveResultToDB({ 
                          quizName: `تصفير 🗑️: ${completedLessonNames.join(' ، ')}`, 
                          score: 'تصفير 🔄' 
                        });
                      }
                      
                      localStorage.removeItem('completedLessons');
                      localStorage.removeItem('userStats');
                      localStorage.removeItem('savedSession');
                      localStorage.removeItem('mistakesBank');
                      localStorage.removeItem('lessonScores');
                      localStorage.removeItem('userStreak');
                      localStorage.removeItem('userBadges');
                      localStorage.removeItem('kanz_student_essay_submissions');
                      localStorage.removeItem('kanz_seen_approved_notifications');
                      setStreak({ count: 0, lastDate: '' });
                      setBadges([]);
                      setLessonScores({});
                      setMistakesBank([]);
                      const resetData = data.map(unit => ({ ...unit, lessons: unit.lessons.map(l => ({ ...l, completed: false })) }));
                      setData(resetData); 
                      setActiveFilter('all'); 
                    })} 
                    className="bg-[#fff1f2] text-[#ef4444] border border-[#fecaca] px-2 py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm hover:bg-red-50 transition-colors shrink-0"
                    style={{ marginTop: '0px' }}
                  >
                    تصفير <i className="fas fa-sync-alt"></i>
                  </button>
                )}
                <button 
                  onClick={() => {
                    setClosingPrayerIsLogout(false);
                    setShowClosingPrayer(true);
                  }}
                  className="text-emerald-700 dark:text-emerald-300 hover:text-white hover:bg-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-bold transition-colors border border-emerald-200 dark:border-emerald-800 shadow-sm flex items-center gap-1 shrink-0 cursor-pointer"
                  title="دعاء ختام المذاكرة وكفارة المجلس"
                >
                  🤲 دعاء الختام
                </button>
                <button 
                  onClick={() => {
                    setClosingPrayerIsLogout(true);
                    setShowClosingPrayer(true);
                  }} 
                  className="text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-2 py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-bold transition-colors border border-red-100 shadow-sm flex items-center gap-1 shrink-0 cursor-pointer" 
                  style={{ marginLeft: '1px', marginTop: '0px' }}
                >
                  خروج <i className="fas fa-sign-out-alt"></i>
                </button>
              </div>
            </div>
          </div>
          
          <div 
            className="px-3 pt-3 pb-2 z-10 shrink-0 mx-auto w-full max-w-4xl md:px-4" 
            style={isDesktop ? { height: 'auto', width: '100%', marginBottom: '13px', marginTop: '0px' } : { height: 'auto', width: '100%', paddingBottom: '6px', paddingTop: '1px', marginBottom: '13px', marginTop: '0px' }}
          >
            <div 
              className="grid grid-cols-4 gap-1.5 sm:gap-2 w-full max-w-4xl mx-auto px-1" 
              dir="rtl" 
              style={isDesktop ? { fontSize: '15px', lineHeight: '24px' } : { fontSize: '17px', lineHeight: '24px', marginTop: '-13px' }}
            >
              <div 
                className="bg-primary text-white rounded-xl py-2 px-1 flex flex-col items-center justify-center shadow-md" 
                style={isDesktop ? { marginTop: '0px' } : { marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-gray-300 mb-0.5" style={{ height: '18px', marginRight: '-4px', marginLeft: '-5px', marginBottom: '-2px', marginTop: '-2px' }}>التقدم</div>
                <div className="text-sm sm:text-base font-black flex items-center gap-0.5 text-secondary" dir="ltr">
                  <span style={{ borderColor: '#ffffff' }}>%</span><span style={{ borderColor: '#ffffff' }}>{toEasternArabic(stats.progress)}</span>
                </div>
              </div>
              <button 
                onClick={()=>setActiveFilter('all')} 
                className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center shadow-md transition-all ${activeFilter==='all'?'bg-secondary text-white ring-2 ring-offset-1 ring-secondary':'bg-secondary text-white opacity-90'}`} 
                style={isDesktop ? { fontSize: '11px', textAlign: 'center', marginTop: '0px' } : { fontSize: '10px', lineHeight: '13px', textAlign: 'center', marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-green-100 mb-0.5">الدروس</div>
                <div className="text-sm sm:text-base font-black">{toEasternArabic(stats.total)}</div>
              </button>
              <button 
                onClick={()=>setActiveFilter('completed')} 
                className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center border shadow-sm transition-all ${activeFilter==='completed'?'bg-green-50 border-green-500 ring-1 ring-green-500':'bg-white border-gray-200 hover:border-green-400'}`} 
                style={isDesktop ? { fontSize: '11px', textAlign: 'center', marginTop: '0px' } : { fontSize: '10px', textAlign: 'center', lineHeight: '13px', marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-green-500 mb-0.5">المنجز</div>
                <div className="text-sm sm:text-base font-black text-green-500">{toEasternArabic(stats.completed)}</div>
              </button>
              <button 
                onClick={()=>setActiveFilter('remaining')} 
                className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center shadow-md transition-all ${activeFilter==='remaining'?'bg-red-600 text-white ring-2 ring-offset-1 ring-red-600':'bg-[#ef4444] text-white hover:bg-red-600'}`} 
                style={isDesktop ? { fontSize: '11px', textAlign: 'center', marginTop: '0px' } : { fontSize: '10px', lineHeight: '13px', marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-white mb-0.5">المتبقي</div>
                <div className="text-sm sm:text-base font-black text-white">{toEasternArabic(stats.remaining)}</div>
              </button>
            </div>

            {mistakesBank.length > 0 && (
              <button 
                onClick={() => {
                  const shuffledMistakes = shuffleArray(mistakesBank).map(q => {
                    if (q.type === 'mcq' && q.options && q.options.length > 0) {
                      return { ...q, options: shuffleOptions(q.options) };
                    }
                    return q;
                  });
                  setActiveLesson({ id: 'mistakes_bank', title: 'بنك الأخطاء 🎯', questions: shuffledMistakes, completed: false });
                  setIsReviewMode(false);
                  setIsPracticeMode(true);
                  setCurrentQIndex(0);
                  setUserAnswers([]);
                  setSkippedQuestions([]);
                  setTimeLeft(null);
                  if (securitySettings.offlineModeEnabled && typeof navigator !== 'undefined' && navigator.onLine) {
                    setOfflineGateStatus('require_offline_to_start');
                  } else {
                    setOfflineGateStatus('none');
                  }
                  tabSwitchStrikesRef.current = 0;
                  setTabSwitchStrikes(0);
                  setIsScreenObfuscated(false);
                  setTabSwitchWarningModal(null);
                  setScreen('quiz');
                }} 
                className="w-full mt-2.5 py-2 px-3 rounded-xl flex items-center justify-between shadow-sm transition-all bg-rose-50 border-2 border-rose-400 hover:bg-rose-100 active:scale-[0.99]"
                dir="rtl"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">🎯</span>
                  <span className="text-xs sm:text-sm font-black text-rose-700">تدرب على أسئلة بنك الأخطاء</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="bg-rose-600 text-white text-xs font-black px-2 py-0.5 rounded-full shadow-sm">
                    {toEasternArabic(mistakesBank.length)} {mistakesBank.length === 1 ? 'خطأ' : 'أخطاء'}
                  </span>
                  <i className="fas fa-chevron-left text-rose-600 text-xs"></i>
                </div>
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 pt-0 z-10">
            <div className="max-w-4xl mx-auto space-y-4">
              {announcement && announcement.trim() !== "" && announcement !== dismissedAnnouncement && (
                <div className="bg-orange-50 border-r-4 border-gold p-4 rounded-2xl shadow-sm flex items-start gap-3 animate-fade-in mb-2 relative" style={{ fontSize: '11px', lineHeight: '21px', marginBottom: '6px', marginTop: '-5px', paddingLeft: '14px', paddingTop: '9px' }}>
                  <button onClick={() => {
                    setDismissedAnnouncement(announcement);
                    localStorage.setItem('dismissedAnnouncement', announcement);
                  }} className="absolute top-2 left-2 text-gray-400 hover:text-red-500 transition-colors p-1" title="إخفاء الإشعار">
                    <i className="fas fa-times"></i>
                  </button>
                  <span className="text-gold text-xl shrink-0"><i className="fas fa-bullhorn animate-bounce"></i></span>
                  <div className="flex-1">
                    <h4 className="font-black text-gold text-xs sm:text-sm mb-0.5">تنبيه هام من الأستاذ 📢:</h4>
                    <p className="text-gray-800 text-sm sm:text-base font-bold leading-relaxed whitespace-pre-line" style={{ fontSize: '13px', textAlign: 'justify', lineHeight: '19.5px' }}>{announcement}</p>
                  </div>
                </div>
              )}
              
              {stats.total === 0 ? (
                <div className={`rounded-3xl shadow-md border-2 p-8 text-center animate-fade-in flex flex-col items-center justify-center mt-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white'}`}>
                  <i className="fas fa-book-reader text-6xl text-secondary mb-4 opacity-80"></i>
                  <h2 className={`text-2xl font-black mb-2 ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>مرحباً بك في منصتنا</h2>
                  <p className={`text-lg font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>سيتم إضافة الدروس قريباً</p>
                </div>
              ) : (
                studentUnits.map(unit => {
                  if (unit.lessons.length === 0) return null;
                  if (activeFilter !== 'all' && !unit.lessons.some(l => activeFilter === 'completed' ? l.completed : !l.completed)) return null;
                  return (
                    <div key={unit.id} className={`rounded-2xl shadow-lg border overflow-hidden animate-fade-in backdrop-blur-md transition-all ${isDarkMode ? 'bg-gray-800/50 border-gray-700/50' : 'bg-white/60 border-gray-150/50'}`}>
                      <div className={`px-4 py-4 border-b cursor-pointer flex justify-between items-center transition-colors ${isDarkMode ? 'bg-gray-700/40 border-gray-600/40 hover:bg-gray-700/60' : 'bg-gray-50/50 border-gray-200/40 hover:bg-gray-50/70'}`}>
                        <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => toggleUnit(unit.id)}>
                          <h2 className={`text-xl font-black truncate ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>{unit.title}</h2>
                          <i className={`fas fa-chevron-${expandedUnits.includes(unit.id) ? 'up' : 'down'} ${isDarkMode ? 'text-gray-300' : ''}`}></i>
                        </div>
                        {showResetButtonSetting && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleResetUnit(unit.id); }}
                            title={`تصفير وحدة: ${unit.title}`}
                            className={`w-9 h-9 rounded-full flex items-center justify-center text-xs transition-colors shrink-0 border ${
                              isDarkMode 
                                ? 'bg-rose-950/30 text-rose-300 border-rose-800/50 hover:bg-rose-900/50' 
                                : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                            }`}
                          >
                            <i className="fas fa-sync-alt"></i>
                          </button>
                        )}
                      </div>
                      {(expandedUnits.includes(unit.id) || activeFilter !== 'all') && (
                        <div className={`divide-y backdrop-blur-sm ${isDarkMode ? 'divide-gray-700/50' : 'divide-gray-100/50'}`} style={{ fontSize: '10px' }}>
                          {unit.lessons.filter(l => activeFilter === 'all' || (activeFilter === 'completed' ? l.completed : !l.completed)).map(lesson => {
                            const cfg = getExamConfig(lesson.id);
                            const studentCategory = getCurrentStudentCategory();
                            const availability = getExamAvailability(cfg, studentCategory);

                            return (
                              <div 
                                key={lesson.id} 
                                onClick={() => { 
                                  const hasMedia = Boolean(lesson.audio || lesson.video || lesson.pdf || (lesson.pdfFiles && lesson.pdfFiles.length > 0));

                                  // فصل المواد التعليمية (PDF / صوتيات / فيديو) عن قفل الامتحان:
                                  // إتاحة تصفح المذكرات والاستماع للشروحات دائماً وبحرية تامة حتى وإن كان الامتحان مجدولاً أو منتهياً
                                  if (hasMedia) {
                                    setLessonModalOptions(lesson);
                                    return;
                                  }

                                  // إذا كان الدرس امتحاناً فقط دون أي وسائط دراسية، نطبق قيود الجدولة والاعتماد
                                  if (availability.status === 'upcoming') {
                                    showAlert(`⏳ هذا الامتحان مجدول وسيبدأ في:\n${formatScheduleDate(availability.startDate)}\n\nيرجى الاستعداد والمراجعة حتى موعد فتح الامتحان.`);
                                    return;
                                  }

                                  if (availability.status === 'expired') {
                                    showAlert(`🔒 عذراً، انتهت فترة إتاحة هذا الامتحان في:\n${formatScheduleDate(availability.endDate)}\n\nتم إغلاق الامتحان ولا يمكن تقديم إجابات جديدة.`);
                                    return;
                                  }

                                  if (availability.status === 'not_targeted') {
                                    showAlert(`🚫 ${availability.message}`);
                                    return;
                                  }

                                  const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
                                  const submissions = getStudentSubmissions(phone);
                                  const pendingSub = submissions.find(s => (s.lessonId === lesson.id || s.quizTitle === lesson.title) && !s.isFullyApproved);
                                  if (pendingSub) {
                                    showAlert('⏳ هذا الاختبار قيد المراجعة والاعتماد حالياً من المعلم أ/ إسلام سعود، ستتمكن من مراجعته والتدريب عليه فور اعتماد النتيجة.');
                                    return;
                                  }

                                  startQuizForLesson(lesson);
                                }} 
                                className={`px-6 py-5 flex justify-between items-center cursor-pointer transition-colors ${
                                  isDarkMode ? 'hover:bg-gray-700/40' : 'hover:bg-gray-50/50'
                                } ${
                                  availability.status === 'expired' ? 'opacity-85' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                  <div className={`font-bold text-lg ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{formatLessonTitleJSX(lesson.title)}</div>
                                  
                                  {/* شارة الجدولة والمواعيد */}
                                  {availability.isScheduleActive && (
                                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-lg border flex items-center gap-1 shadow-2xs shrink-0 ${
                                      availability.badgeColor === 'amber'
                                        ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700'
                                        : availability.badgeColor === 'rose'
                                        ? 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-700'
                                        : availability.badgeColor === 'gray'
                                        ? 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                                        : 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700'
                                    }`}>
                                      <span>{availability.badgeText}</span>
                                    </span>
                                  )}

                                  {(() => {
                                    const files: Array<{ url: string; name: string }> = (lesson.pdfFiles && lesson.pdfFiles.length > 0)
                                      ? lesson.pdfFiles
                                      : (lesson.pdf ? [{ url: lesson.pdf, name: `مذكرة ${lesson.title}` }] : []);
                                    if (files.length === 0) return null;
                                    return (
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {files.map((file, fIdx) => (
                                          <span
                                            key={fIdx}
                                            className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-1 shadow-2xs shrink-0 max-w-[220px] truncate"
                                            title={file.name}
                                          >
                                            <i className="fas fa-file-pdf text-rose-600 shrink-0"></i>
                                            <span className="truncate">{file.name}</span>
                                          </span>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                                {(() => {
                                  const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
                                  const submissions = getStudentSubmissions(phone);
                                  const pendingSub = submissions.find(s => (s.lessonId === lesson.id || s.quizTitle === lesson.title) && !s.isFullyApproved);
                                  if (pendingSub) {
                                    return (
                                      <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-1.5 shadow-xs">
                                        <i className="fas fa-hourglass-half text-amber-600 animate-spin"></i>
                                        <span>قيد المراجعة</span>
                                      </span>
                                    );
                                  }

                                  if (availability.status === 'upcoming') {
                                    return (
                                      <span title={`سيبدأ في: ${formatScheduleDate(availability.startDate)}`} className="text-amber-500">
                                        <i className="fas fa-clock text-2xl"></i>
                                      </span>
                                    );
                                  }

                                  if (availability.status === 'expired') {
                                    return (
                                      <span title="امتحان منتهي ومغلق" className="text-rose-500">
                                        <i className="fas fa-lock text-2xl"></i>
                                      </span>
                                    );
                                  }

                                  if (availability.status === 'not_targeted') {
                                    return (
                                      <span title={availability.badgeText} className="text-gray-400">
                                        <i className="fas fa-ban text-2xl"></i>
                                      </span>
                                    );
                                  }

                                  return lesson.completed ? <i className="fas fa-check-circle text-secondary text-2xl"></i> : <i className="fas fa-play-circle text-gray-300 text-2xl"></i>;
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              
              <div className={`mt-5 mb-8 w-full z-10 shrink-0 grid gap-3 ${
                (mapsList && mapsList.length > 0)
                  ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                  : 'grid-cols-1 sm:grid-cols-3'
              }`}>
                {/* زر لوحة الشرف */}
                <button 
                  onClick={handleOpenLeaderboard} 
                  className={`min-h-[58px] font-black py-3 px-3.5 rounded-2xl shadow-xs transition-all active:scale-[0.98] flex justify-center items-center gap-2.5 border-2 cursor-pointer ${
                    isDarkMode 
                      ? 'bg-amber-950/40 border-amber-700/80 text-amber-200 hover:bg-amber-900/60' 
                      : 'bg-amber-50/90 border-amber-300 text-amber-900 hover:bg-amber-100 hover:shadow-sm'
                  }`}
                  title="لوحة الشرف وتكريم أوائل الكنز"
                >
                  <i className="fas fa-trophy text-xl text-amber-500 shrink-0"></i>
                  <span className="text-sm sm:text-base font-black whitespace-nowrap">لوحة الشرف (أوائل الكنز)</span>
                </button>

                {/* زر كشكول أهم الأخطاء والنموذج */}
                {showMistakesNotebookSetting && (
                  <button 
                    onClick={() => setShowMistakesNotebookModal(true)} 
                    className={`min-h-[58px] font-black py-3 px-3.5 rounded-2xl shadow-xs transition-all active:scale-[0.98] flex justify-center items-center gap-2 border-2 cursor-pointer ${
                      isDarkMode 
                        ? 'bg-purple-950/40 border-purple-700/80 text-purple-200 hover:bg-purple-900/60' 
                        : 'bg-purple-50/90 border-purple-300 text-purple-900 hover:bg-purple-100 hover:shadow-sm'
                    }`}
                    title="كشكول مراجعة أهم الأخطاء ونموذج الإجابة"
                  >
                    <i className="fas fa-book-bookmark text-xl text-purple-600 dark:text-purple-400 shrink-0"></i>
                    <span className="text-sm sm:text-base font-black whitespace-nowrap">كشكول أهم الأخطاء والنموذج</span>
                    {(permanentNotebookMistakes.length > 0 || mistakesBank.length > 0) && (
                      <span className="bg-purple-600 text-white dark:bg-purple-500 text-[11px] font-black px-2 py-0.5 rounded-full shrink-0 shadow-xs">
                        {toEasternArabic(permanentNotebookMistakes.length || mistakesBank.length)}
                      </span>
                    )}
                  </button>
                )}
                
                {/* زر الخرائط التفاعلية */}
                {mapsList && mapsList.length > 0 && (
                  <button 
                    onClick={() => setScreen('maps')} 
                    className={`min-h-[58px] font-black py-3 px-3.5 rounded-2xl shadow-xs transition-all active:scale-[0.98] flex justify-center items-center gap-2.5 border-2 cursor-pointer ${
                      isDarkMode 
                        ? 'bg-indigo-950/40 border-indigo-700/80 text-indigo-200 hover:bg-indigo-900/60' 
                        : 'bg-indigo-50/90 border-indigo-300 text-indigo-900 hover:bg-indigo-100 hover:shadow-sm'
                    }`}
                    title="استعراض الخرائط التفاعلية للمنهج"
                  >
                    <i className="fas fa-map-marked-alt text-xl text-indigo-600 dark:text-indigo-400 shrink-0"></i>
                    <span className="text-sm sm:text-base font-black whitespace-nowrap">الخرائط التفاعلية</span>
                  </button>
                )}

                {/* زر مشاركة المنصة */}
                <button 
                  onClick={() => {
                    const appLink = OFFICIAL_APP_URL;
                    const whatsappText = encodeURIComponent(`موسوعة الكنز التعليمي للأستاذ إسلام سعود 🌍\nأقوى منصة لمراجعة مادة التاريخ!\n\nادخل وسجل الآن مجاناً من هنا 👇:\n${appLink}`);
                    window.open(`https://wa.me/?text=${whatsappText}`, '_blank');
                  }} 
                  className={`min-h-[58px] font-black py-3 px-3.5 rounded-2xl shadow-xs transition-all active:scale-[0.98] flex justify-center items-center gap-2.5 border-2 cursor-pointer ${
                    isDarkMode 
                      ? 'bg-emerald-950/40 border-emerald-700/80 text-emerald-200 hover:bg-emerald-900/60' 
                      : 'bg-emerald-50/90 border-emerald-300 text-emerald-900 hover:bg-emerald-100 hover:shadow-sm'
                  }`}
                  title="مشاركة رابط المنصة عبر واتساب"
                >
                  <i className="fab fa-whatsapp text-2xl text-emerald-600 dark:text-emerald-400 shrink-0"></i>
                  <span className="text-sm sm:text-base font-black whitespace-nowrap">شارك المنصة</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    if (screen === 'maps') {
      return (
        <div className={`h-[100dvh] flex flex-col watermark-container ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <div className={`shadow-sm px-4 pt-4 pb-3 z-10 border-b-2 flex justify-between items-center w-full shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
            <div className="flex items-center gap-3">
              <i className="fas fa-map-marked-alt text-3xl sm:text-4xl text-indigo-500"></i>
              <div className="font-black text-xl sm:text-2xl text-indigo-600">الخرائط التفاعلية</div>
            </div>
            <button onClick={() => { setScreen('index'); setActiveMapUrl(null); }} className="bg-primary text-white font-bold px-5 py-2.5 rounded-xl text-sm sm:text-base shadow-md active:scale-95 transition-transform flex items-center gap-2">
              عودة <i className="fas fa-arrow-left"></i>
            </button>
          </div>
          
          <div className="flex-1 p-4 sm:p-6 z-10 flex flex-col">
            {activeMapUrl ? (
              <div className="w-full h-full relative rounded-3xl overflow-hidden border-4 border-indigo-200 shadow-2xl bg-white flex flex-col animate-fade-in">
                <div className="bg-indigo-100 px-4 py-2 flex justify-between items-center border-b border-indigo-200">
                  <span className="font-bold text-indigo-800"><i className="fas fa-info-circle ml-1"></i> تفاعل مع الخريطة</span>
                  <button onClick={() => setActiveMapUrl(null)} className="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center shadow font-black text-lg hover:bg-red-600 transition-colors">×</button>
                </div>
                <iframe src={activeMapUrl} className="flex-1 w-full border-0 bg-white" title="Interactive Map"></iframe>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-4 animate-fade-in">
                {mapsList && mapsList.map(map => (
                  <div key={map.id} onClick={() => setActiveMapUrl(map.url)} className={`p-8 rounded-3xl shadow-lg border-2 cursor-pointer transition-transform hover:-translate-y-2 flex flex-col items-center text-center relative overflow-hidden group ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:border-indigo-500' : 'bg-white border-gray-100 hover:border-indigo-400'}`}>
                    <div className="absolute top-0 right-0 w-full h-2 bg-indigo-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-right"></div>
                    <i className="fas fa-map-location-dot text-6xl text-indigo-200 group-hover:text-indigo-500 transition-colors mb-4 block"></i>
                    <h3 className={`text-xl font-black mt-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{map.title}</h3>
                    <span className="mt-4 text-sm font-bold bg-indigo-50 text-indigo-600 py-1 px-4 rounded-full border border-indigo-100">فتح الخريطة</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    
    if (screen === 'quiz' && offlineGateStatus === 'require_offline_to_start') {
      return (
        <div className={`min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-slate-50 text-gray-900'}`}>
          <div className={`max-w-md w-full p-6 sm:p-8 rounded-3xl shadow-2xl text-center border-t-8 border-teal-500 animate-fade-in ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
            <div className="w-20 h-20 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center mx-auto mb-5 text-4xl shadow-inner animate-pulse">
              <i className="fas fa-plane"></i>
            </div>
            
            <div className="inline-block px-3 py-1 bg-teal-50 border border-teal-200 rounded-full text-teal-800 font-black text-xs mb-3">
              🛡️ وضع الامتحان الآمن (بدون إنترنت)
            </div>

            <h2 className={`text-xl sm:text-2xl font-black mb-3 ${isDarkMode ? 'text-white' : 'text-primary'}`}>
              مطلوب قطع الاتصال بالإنترنت لبدء الاختبار
            </h2>

            <p className={`text-xs sm:text-sm font-bold leading-relaxed mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              حرصاً على النزاهة وتكافؤ الفرص، يُرجى تفعيل <b>وضع الطيران (✈️)</b> أو إيقاف تشغيل <b>الواي فاي وبيانات الهاتف</b> الآن.
              <br />
              <span className="text-teal-600 font-black block mt-2">✨ سيفتح الامتحان تلقائياً فور انقطاع الاتصال!</span>
            </p>

            <div className={`p-4 rounded-2xl mb-6 border flex items-center justify-between ${typeof navigator !== 'undefined' && navigator.onLine ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              <span className="text-xs font-black flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${typeof navigator !== 'undefined' && navigator.onLine ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'}`}></span>
                حالة الاتصال الحالية:
              </span>
              <span className="text-xs font-black">
                {typeof navigator !== 'undefined' && navigator.onLine ? 'متصل بالإنترنت ⚠️' : 'غير متصل (جاهز) ✅'}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && !navigator.onLine) {
                    setOfflineGateStatus('none');
                  } else {
                    showAlert('⚠️ جهازك ما زال متصلاً بالإنترنت! يرجى إيقاف تشغيل الواي فاي والبيانات أو تفعيل وضع الطيران للمتابعة.');
                  }
                }}
                className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-black rounded-xl shadow-lg shadow-teal-600/30 transition-all cursor-pointer flex items-center justify-center gap-2 text-sm"
              >
                <i className="fas fa-rotate"></i>
                <span>تحقق من قطع النت والبدء الآن</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setOfflineGateStatus('none');
                  setScreen('index');
                }}
                className={`w-full py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                إلغاء والعودة للرئيسية
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (screen === 'quiz' && offlineGateStatus === 'require_online_to_submit') {
      return (
        <div className={`min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-slate-50 text-gray-900'}`}>
          <div className={`max-w-md w-full p-6 sm:p-8 rounded-3xl shadow-2xl text-center border-t-8 border-secondary animate-fade-in ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
            <div className="w-20 h-20 rounded-full bg-emerald-100 text-secondary flex items-center justify-center mx-auto mb-5 text-4xl shadow-inner animate-bounce">
              <i className="fas fa-wifi"></i>
            </div>

            <div className="inline-block px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-800 font-black text-xs mb-3">
              🎉 تم إتمام حل الاختبار بنجاح!
            </div>

            <h2 className={`text-xl sm:text-2xl font-black mb-3 ${isDarkMode ? 'text-white' : 'text-primary'}`}>
              أعد تشغيل الإنترنت لتسجيل نتيجتك
            </h2>

            <p className={`text-xs sm:text-sm font-bold leading-relaxed mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              أحسنت يا بطل! لإرسال درجاتك إلى المعلم وإصدار شهادتك وسجل تقدمك، يُرجى الآن <b>إلغاء وضع الطيران أو تشغيل الواي فاي / بيانات الهاتف</b>.
              <br />
              <span className="text-secondary font-black block mt-2">🚀 سيتم إرسال درجتك تلقائياً فور عودة الاتصال!</span>
            </p>

            <div className={`p-4 rounded-2xl mb-6 border flex items-center justify-between ${typeof navigator !== 'undefined' && !navigator.onLine ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              <span className="text-xs font-black flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${typeof navigator !== 'undefined' && !navigator.onLine ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`}></span>
                حالة الاتصال:
              </span>
              <span className="text-xs font-black">
                {typeof navigator !== 'undefined' && !navigator.onLine ? 'في انتظار تشغيل النت 🔴' : 'متصل بالإنترنت ✅'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setOfflineGateStatus('none');
                finishQuizInternal();
              }}
              className="w-full py-3.5 bg-secondary hover:bg-emerald-600 active:scale-95 text-white font-black rounded-xl shadow-lg shadow-emerald-500/30 transition-all cursor-pointer flex items-center justify-center gap-2 text-sm"
            >
              <i className="fas fa-cloud-arrow-up"></i>
              <span>تم تشغيل النت، إرسال نتيجتي الآن 🚀</span>
            </button>
          </div>
        </div>
      );
    }
    
    if (screen === 'quiz' && activeLesson && question) {
      const checkCorrectAnswer = (opt: string, corr: string, optIdx?: number) => {
        return checkAnswerAccurately(opt, corr, optIdx, question?.options);
      };

      const handleOptionClick = (option: string, optionIdx?: number) => {
        if (isAnswered) return;
        const isCorrect = checkCorrectAnswer(option, question!.correct, optionIdx);
        const newAns = [...userAnswers]; 
        newAns[currentQIndex] = { 
          isCorrect, 
          selected: option, 
          concept: question!.concept, 
          paragraph: question!.paragraph, 
          type: (question!.type === 'essay' ? 'essay' : (question!.type === 'tf' || question!.type === 't/f' ? 'tf' : 'mcq'))
        }; 
        setUserAnswers(newAns);
        setSkippedQuestions(prev => prev.filter(idx => idx !== currentQIndex));
        
        // Show temporary feedback toast for MCQ questions (only in review mode)
        if (isReviewMode) {
          if (isCorrect) {
            setFeedbackToast({ isCorrect: true, message: '👍' });
          } else {
            setFeedbackToast({ isCorrect: false, message: '😔' });
          }
          setTimeout(() => {
            setFeedbackToast(null);
          }, 1100);
        }
        
        if (!isCorrect) {
          addMistakeToPermanentNotebook(
            question!,
            option,
            option,
            activeLesson?.id,
            activeLesson?.title
          );
        }

        setMistakesBank(prev => {
          const newBank = [...prev];
          const qHash = simpleHash(question!.q);
          const existsIndex = newBank.findIndex(item => simpleHash(item.q) === qHash);
          
          if (!isCorrect && existsIndex === -1) {
            newBank.push(question!); 
          } else if (isCorrect && existsIndex !== -1) {
            newBank.splice(existsIndex, 1); 
          }
          localStorage.setItem('mistakesBank', JSON.stringify(newBank));
          return newBank;
        });
      };
      
      const handleSaveEssayAnswer = (answerText: string) => {
        const text = answerText.trim();
        const newAns = [...userAnswers]; 
        newAns[currentQIndex] = { 
          isCorrect: false, 
          selected: text,
          studentAnswerText: text,
          concept: question!.concept, 
          paragraph: question!.paragraph, 
          type: 'essay',
          status: 'pending'
        }; 
        setUserAnswers(newAns);
        setSkippedQuestions(prev => prev.filter(idx => idx !== currentQIndex));

        addMistakeToPermanentNotebook(
          question!,
          text,
          text,
          activeLesson?.id,
          activeLesson?.title
        );
      };
      
      return (
        <div 
          className={`h-[100dvh] flex flex-col watermark-container relative ${isDarkMode?'bg-gray-900':''} ${securitySettings.preventScreenshot ? 'select-none' : ''}`} 
          style={securitySettings.preventScreenshot ? { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } : undefined}
          onTouchStart={handleTouchStart} 
          onTouchMove={handleTouchMove} 
          onTouchEnd={handleTouchEnd}
          onContextMenu={securitySettings.preventScreenshot ? e => e.preventDefault() : undefined}
          onCopy={securitySettings.preventScreenshot ? e => e.preventDefault() : undefined}
          onCut={securitySettings.preventScreenshot ? e => e.preventDefault() : undefined}
        >
          <DrawingCanvas isEnabled={isDrawingMode} />

          {/* Dynamic Watermark Overlay */}
          {securitySettings.watermarkEnabled && (
            <>
              {/* Central Fixed Watermark (موسوعة في سطر + الكنز في سطر + أ/ إسلام سعود غير مائلة) */}
              <div className="fixed inset-0 pointer-events-none z-[34] flex flex-col items-center justify-center select-none text-center px-4">
                <div className={`text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-wider leading-none drop-shadow-sm ${isDarkMode ? 'text-amber-300/15' : 'text-amber-500/18'}`}>
                  موسوعة
                </div>
                <div className={`text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-wider leading-none mt-2 sm:mt-3 ${isDarkMode ? 'text-blue-300/15' : 'text-blue-900/17'}`}>
                  الكنز
                </div>
                <div className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black tracking-wide mt-3 sm:mt-5 ${isDarkMode ? 'text-pink-400/15' : 'text-pink-700/18'}`}>
                  أ/ إسلام سعود
                </div>
              </div>

              {/* Dense Repeating Student Watermark (تكرار كثيف لاسم ورقم الطالب بخط أكبر بمقدار درجة) */}
              <div 
                className="fixed inset-0 pointer-events-none z-[35] overflow-hidden select-none opacity-[0.15] dark:opacity-[0.18]"
                style={{
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='145' viewBox='0 0 260 145'><g transform='rotate(-25 130 72)'><text x='130' y='57' fill='${isDarkMode ? '%23ffffff' : '%230f172a'}' font-family='Cairo, sans-serif' font-size='18' font-weight='900' text-anchor='middle'>${encodeURIComponent(studentName || (studentData as any)?.name || 'طالب')}</text><text x='130' y='87' fill='${isDarkMode ? '%23ffffff' : '%230f172a'}' font-family='Cairo, sans-serif' font-size='16.5' font-weight='800' text-anchor='middle'>${encodeURIComponent(inputPhone || '')}</text></g></svg>")`,
                  backgroundRepeat: 'repeat'
                }}
              />
            </>
          )}

          {/* Obfuscation Overlay on Screenshot/Blur */}
          {isScreenObfuscated && securitySettings.preventScreenshot && (
            <div className="fixed inset-0 z-[999999] bg-black/95 flex flex-col items-center justify-center text-center p-6 select-none pointer-events-auto backdrop-blur-3xl animate-fade-in">
              <div className="w-20 h-20 rounded-full bg-rose-950/80 border-2 border-rose-500 flex items-center justify-center mb-5 animate-pulse shadow-lg shadow-rose-900/50">
                <i className="fas fa-eye-slash text-4xl text-rose-400"></i>
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-white mb-3">⚠️ شاشة الاختبار محمية</h3>
              <p className="text-gray-300 font-bold max-w-md text-sm sm:text-base leading-relaxed mb-6">
                غير مسموح بالتقاط صور للشاشة (Screenshot) أو مغادرة نافذة الاختبار. تم حجب المحتوى مؤقتاً لحماية بنك الأسئلة.
              </p>
              <div className="text-xs bg-rose-900/40 text-rose-300 px-4 py-2 rounded-xl border border-rose-800 font-black flex items-center gap-2 mb-6">
                <i className="fas fa-shield-halved"></i>
                <span>يرجى البقاء داخل شاشة الاختبار للمتابعة</span>
              </div>
              <button
                type="button"
                onClick={() => setIsScreenObfuscated(false)}
                className="px-8 py-3.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 active:scale-95 text-white font-black text-sm sm:text-base rounded-2xl shadow-xl shadow-rose-900/50 transition-all cursor-pointer flex items-center gap-2 border border-rose-400/30"
              >
                <span>فهمت ذلك • متابعة الاختبار</span>
                <i className="fas fa-arrow-left"></i>
              </button>
            </div>
          )}

          {/* Tab-switch Warning Modal */}
          {tabSwitchWarningModal && tabSwitchWarningModal.open && (
            <div className="fixed inset-0 z-[99999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center border-t-8 border-amber-500 animate-fade-in">
                <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4 text-3xl font-black">
                  <i className="fas fa-triangle-exclamation"></i>
                </div>
                <h3 className="text-xl font-black text-gray-900 mb-2">إنذار بمغادرة شاشة الاختبار!</h3>
                <p className="text-sm font-bold text-gray-600 mb-4 leading-relaxed">
                  تم رصد مغادرة نافذة الامتحان. يرجى العلم بأن مغادرة الشاشة مخالفة لقواعد الاختبار.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-6 text-amber-900 font-black text-sm flex items-center justify-center gap-2">
                  <span>مخالفة رقم</span>
                  <span className="bg-amber-500 text-white px-2.5 py-0.5 rounded-lg text-base">{toEasternArabic(tabSwitchWarningModal.strikes)}</span>
                  <span>من أصل</span>
                  <span className="bg-gray-200 text-gray-800 px-2 py-0.5 rounded-lg">{toEasternArabic(tabSwitchWarningModal.max)}</span>
                </div>
                <button
                  onClick={() => setTabSwitchWarningModal(null)}
                  className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-black rounded-xl shadow-lg shadow-amber-500/30 transition-all cursor-pointer text-base"
                >
                  فهمت، العودة للاختبار
                </button>
              </div>
            </div>
          )}
          
          {/* Review Mode Banner */}
          {isReviewMode && (
            <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-indigo-800 text-white px-3 sm:px-4 py-2 text-xs sm:text-sm font-black flex items-center justify-between shrink-0 shadow-md border-b border-indigo-400 z-50">
              <div className="flex items-center gap-2 truncate">
                <i className="fas fa-search-plus text-amber-300 text-sm sm:text-base animate-pulse shrink-0"></i>
                <span className="truncate">وضع مراجعة الاختبار: استعراض الإجابات النموذجية والتعليلات والأخطاء</span>
              </div>
              <button 
                onClick={() => {
                  setIsReviewMode(false);
                  setScreen('result');
                }}
                className="bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer shrink-0"
              >
                <span>إنهاء المراجعة</span>
                <i className="fas fa-times-circle"></i>
              </button>
            </div>
          )}

          {/* Practice Mode Banner */}
          {isPracticeMode && !isReviewMode && (
            <div className="bg-amber-500 text-slate-950 px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-black flex items-center justify-center gap-2 shrink-0 shadow-xs border-b border-amber-600 z-50">
              <i className="fas fa-dumbbell text-slate-900 shrink-0"></i>
              <span>نمط التدريب الحر والتقوية (هذه المحاولة للتدريب فقط ولن تؤثر على درجتك الرسمية الأولى أو لوحة الشرف)</span>
            </div>
          )}
          
          <div className={`shadow-md px-2 sm:px-4 pt-3 md:pt-4 lg:pt-3 pb-2 flex justify-between items-center gap-1 z-50 sticky top-0 shrink-0 w-full border-b-4 border-primary ${isDarkMode?'bg-gray-800':'bg-white'}`}>
            <div className="flex items-center gap-1 min-w-0 shrink">
              <i className={`fas fa-graduation-cap text-lg sm:text-2xl md:text-3xl lg:text-4xl shrink-0 ${isDarkMode?'text-gray-100':'text-gold'}`}></i>
              <div className="flex flex-col items-center text-center min-w-0 shrink">
                <div className="flex items-center gap-1 font-black text-[11px] sm:text-sm md:text-lg lg:text-xl leading-none mb-0.5 whitespace-nowrap">
                  <span className={isDarkMode?'text-secondary':'text-secondary'}>موسوعة</span>
                  <span className={isDarkMode?'text-gray-100':'text-primary'}>الكنز التعليمي</span>
                </div>
                <div className="text-[7px] sm:text-[9px] md:text-xs lg:text-sm font-bold flex gap-1 justify-center whitespace-nowrap">
                  <span className={isDarkMode ? "text-gray-200 font-bold" : "text-primary font-bold"}>رؤية وإعداد</span>
                  <span className="text-pink-600 font-black">أ/ إسلام سعود</span>
                </div>
              </div>
            </div>
            
            <div className={`flex items-center justify-center px-2 py-1 rounded-full shadow-inner border shrink-0 ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-200'}`}>
              <div className={`font-black text-[10px] sm:text-sm md:text-lg lg:text-xl flex items-center gap-0.5 ${isDarkMode ? 'text-gray-300' : 'text-primary'}`} dir="ltr">
                <span className="text-secondary">{toEasternArabic(currentQIndex + 1)}</span>
                <span className="opacity-50">/</span>
                <span>{toEasternArabic(totalQs)}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0 justify-start sm:justify-end flex-nowrap overflow-x-auto custom-scrollbar pb-0.5 max-w-[45%]">
              {securitySettings.lockdownEnabled && tabSwitchStrikes > 0 && (
                <div className="flex items-center justify-center px-2 py-1 md:px-2.5 md:py-1 rounded-full shadow-inner border shrink-0 font-black text-[10px] md:text-xs gap-1 bg-amber-100 border-amber-300 text-amber-700" title="عدد مخالفات مغادرة شاشة الاختبار">
                  <i className="fas fa-triangle-exclamation"></i>
                  <span>مخالفة {toEasternArabic(tabSwitchStrikes)}/{toEasternArabic(securitySettings.maxTabSwitchStrikes)}</span>
                </div>
              )}
              {timerType === 'total_exam' && examTimeLeft !== null && (
                <div className={`flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 ${examTimeLeft <= 300 ? 'bg-red-100 border-red-300 text-red-600 animate-pulse' : isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-blue-50 border-blue-200 text-blue-700'}`} dir="ltr" title="الوقت المتبقي للامتحان بالكامل">
                  <i className="fas fa-hourglass-half"></i>
                  <span>{Math.floor(examTimeLeft / 60)}:{String(examTimeLeft % 60).padStart(2, '0')}</span>
                </div>
              )}
              {timerType !== 'total_exam' && timeLeft !== null && timeLeft > 0 && !isAnswered && (
                <div className={`flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 ${timeLeft <= 10 ? 'bg-red-100 border-red-300 text-red-600 animate-pulse' : isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-orange-50 border-orange-200 text-orange-600'}`} dir="ltr" title="الوقت المتبقي للسؤال">
                  <i className="fas fa-clock"></i>
                  <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
                </div>
              )}
              {timerType !== 'total_exam' && isAnswered && currentAnswer?.selected === 'انتهى الوقت المحدد للسؤال' && (
                <div className="flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 bg-red-100 border-red-300 text-red-600 animate-pulse" dir="ltr">
                  <i className="fas fa-hourglass-end"></i>
                  <span>انتهى الوقت</span>
                </div>
              )}
              {skippedQuestions.length > 0 && (
                <button onClick={() => setShowSkippedModal(true)} className={`flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 animate-pulse ${isDarkMode ? 'bg-yellow-900/50 border-yellow-700 text-yellow-300' : 'bg-yellow-50 border-yellow-300 text-yellow-700'}`} dir="rtl">
                  <i className="fas fa-list-ul"></i>
                  <span>{toEasternArabic(skippedQuestions.length)} متروك</span>
                </button>
              )}
              <button onClick={toggleFullscreen} className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-[10px] md:text-sm shrink-0 transition-colors ${isFullscreen?'bg-secondary text-white':'bg-gray-100 text-primary hover:bg-gray-200'}`}><i className={`fas ${isFullscreen?'fa-compress':'fa-expand'}`}></i></button>
              <button onClick={()=>setIsDrawingMode(!isDrawingMode)} className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-[10px] md:text-sm shrink-0 transition-colors ${isDrawingMode?'bg-secondary text-white':'bg-gray-100 text-primary hover:bg-gray-200'}`}><i className="fas fa-pen"></i></button>
              <button onClick={()=>setIsDarkMode(!isDarkMode)} className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-[10px] md:text-sm shrink-0 transition-colors ${isDarkMode?'bg-secondary text-white':'bg-gray-100 text-primary hover:bg-gray-200'}`}><i className={`fas ${isDarkMode?'fa-sun':'fa-moon'}`}></i></button>
              <button onClick={()=>showConfirm('هل أنت متأكد من مغادرة الاختبار؟\nسيتم حفظ تقدمك الحالي.', () => {
                setIsScreenObfuscated(false);
                setTabSwitchStrikes(0);
                tabSwitchStrikesRef.current = 0;
                setTabSwitchWarningModal(null);
                setUnansweredWarningModal(null);
                setOfflineGateStatus('none');
                setScreen('index');
              })} className="w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full bg-red-50 flex items-center justify-center text-[10px] md:text-sm shrink-0 text-red-600 hover:bg-red-500 hover:text-white transition-colors"><i className="fas fa-home"></i></button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 pb-28 z-10 flex flex-col pt-8">
            <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col mt-4">
              <div className={`rounded-3xl shadow-lg p-6 mb-8 relative border-2 mt-10 transition-all ${isDarkMode ? 'bg-gray-800 border-slate-500' : 'bg-[#fefee5] border-yellow-200/60'}`}>
                <div className="absolute -top-4 right-8 bg-secondary text-white font-bold px-4 py-1 rounded-full shadow">سؤال {toEasternArabic(currentQIndex+1)}</div>
                <h2 className={`text-xl sm:text-2xl font-bold mt-2 leading-relaxed ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  <FormatQuestionText text={question.q} concept={question.concept} isDarkMode={isDarkMode} />
                </h2>
              </div>

              {isAnswered && currentAnswer?.selected === 'انتهى الوقت المحدد للسؤال' && (
                <div className="bg-red-50 border-2 border-red-300 text-red-700 px-4 py-3 rounded-2xl mb-6 flex items-center justify-center gap-3 text-sm sm:text-base font-black shadow-sm animate-fade-in">
                  <i className="fas fa-hourglass-end text-red-500 text-xl animate-pulse"></i>
                  <span>انتهى الوقت المخصص لهذا السؤال وتم احتسابه خطأ. راجع الإجابة الصحيحة ثم اضغط "التالي".</span>
                </div>
              )}
              
              {(question.type === 'mcq' || question.type === 'tf' || question.type === 't/f') && (() => {
                const isTf = question.type === 'tf' || question.type === 't/f';
                const validOptions = (question.options || []).filter(o => o && o.trim() !== '' && !/^[-–—ـ\s]+$/.test(o.trim()));
                const optionsToRender = isTf
                  ? (validOptions.length >= 2 ? validOptions.slice(0, 2) : ["العبارة صحيحة", "العبارة خاطئة"])
                  : question.options;

                return (
                  <div className="flex flex-col gap-4 mb-8">
                    {optionsToRender.map((opt, idx) => {
                      const isCorrectMatch = checkCorrectAnswer(opt, question!.correct, idx);
                      let btnClass = isDarkMode
                        ? "bg-slate-800/80 border-2 border-slate-500 text-gray-100 p-4 rounded-2xl font-bold text-xl flex items-center shadow-sm cursor-pointer transition-all active:scale-95 hover:border-blue-400 hover:bg-slate-800"
                        : "bg-[#ebf5ff] border-2 border-[#bcccf0]/70 text-primary p-4 rounded-2xl font-bold text-xl flex items-center shadow-sm cursor-pointer transition-all active:scale-95 hover:border-blue-400 hover:bg-[#e1f0fe]";
                      if (isAnswered && currentAnswer) {
                        if (isReviewMode) {
                          if (isCorrectMatch) {
                            btnClass = isDarkMode 
                              ? "bg-green-950/40 border-green-500 text-green-200 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2"
                              : "bg-green-50 border-green-500 text-green-800 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2";
                          } else if (currentAnswer.selected === opt) {
                            btnClass = isDarkMode
                              ? "bg-red-950/40 border-red-500 text-red-200 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2"
                              : "bg-red-50 border-red-500 text-red-800 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2";
                          } else {
                            btnClass = isDarkMode
                              ? "bg-gray-800/40 border-slate-700 text-gray-400 p-4 rounded-2xl font-bold text-xl flex items-center opacity-30 border-2"
                              : "bg-gray-50 border-gray-150 p-4 rounded-2xl font-bold text-xl flex items-center opacity-50 border-2";
                          }
                        } else {
                          // نمط الاختبار الجاد: تحديد إجابة الطالب فقط بشكل محايد تماماً بدون كشف الصح والخطأ
                          if (currentAnswer.selected === opt) {
                            btnClass = isDarkMode
                              ? "bg-primary/25 border-primary text-blue-200 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2 ring-2 ring-primary/40"
                              : "bg-blue-100 border-primary text-primary p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2 ring-2 ring-primary/30";
                          } else {
                            btnClass = isDarkMode
                              ? "bg-slate-800/40 border-slate-700 text-gray-400 p-4 rounded-2xl font-bold text-xl flex items-center opacity-50 border-2"
                              : "bg-gray-50 border-gray-200 text-gray-400 p-4 rounded-2xl font-bold text-xl flex items-center opacity-60 border-2";
                          }
                        }
                      }
                      return (
                        <button 
                          key={idx} 
                          onClick={()=>handleOptionClick(opt, idx)} 
                          className={btnClass} 
                          disabled={isAnswered}
                        >
                          <span 
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg ml-4 shrink-0 transition-all ${
                              isAnswered && currentAnswer 
                                ? (isReviewMode
                                    ? (isCorrectMatch
                                        ? 'bg-green-500 text-white shadow-md' 
                                        : (currentAnswer.selected === opt 
                                            ? 'bg-red-500 text-white shadow-md' 
                                            : (isDarkMode 
                                                ? 'bg-gray-700 text-gray-300 opacity-50' 
                                                : 'bg-gray-100 text-gray-700 opacity-60')))
                                    : (currentAnswer.selected === opt
                                        ? 'bg-primary text-white shadow-md scale-105'
                                        : (isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500')))
                                : (isDarkMode ? 'bg-slate-700 text-gray-200' : 'bg-[#074ba3] text-white')
                            }`}
                            style={{
                              borderStyle: 'solid',
                              borderWidth: '1px',
                              borderColor: '#844d06',
                            }}
                          >
                            {isAnswered && currentAnswer && isReviewMode ? (
                              isCorrectMatch ? <i className="fas fa-check text-base"></i> : (currentAnswer.selected === opt ? <i className="fas fa-times text-base"></i> : ['أ','ب','ج','د'][idx])
                            ) : (
                              ['أ','ب','ج','د'][idx] || (idx + 1)
                            )}
                          </span>
                          <span className="text-right leading-relaxed whitespace-pre-line">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              
              {question.type === 'essay' && (
                <div className="mb-6 w-full max-w-3xl mx-auto animate-fade-in">
                  <div className={`p-4 sm:p-6 rounded-3xl border-2 text-right shadow-md ${
                    isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-amber-200'
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3 border-b pb-2.5 border-gray-100">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-amber-800 bg-amber-100 px-3 py-1 rounded-xl">
                          🏷️ {question.essayType || detectEssayType(question.q).label}
                        </span>
                        <span className="text-xs font-bold text-gray-400">
                          (سؤال مقالي)
                        </span>
                      </div>
                      <span className="text-xs font-black text-primary bg-primary/10 px-3 py-1 rounded-xl">
                        الدرجة المقررة: {getQuestionMaxScore(question, currentQIndex, getExamConfig(activeLesson.id))} درجات
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mb-2">
                      <label className="block text-xs sm:text-sm font-black text-gray-700 dark:text-gray-200">
                        ✍️ اكتب إجابتك هنا بأسلوبك ووضح المطلوب بدقة:
                      </label>
                      <button
                        type="button"
                        onClick={toggleSpeechRecognition}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer ${
                          isListeningSpeech 
                            ? 'bg-rose-500 text-white animate-pulse' 
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                        }`}
                        title={isListeningSpeech ? "اضغط لإيقاف التسجيل" : "اضغط وتحدث وسيقوم النظام بكتابة إجابتك تلقائياً"}
                      >
                        <i className={`fas ${isListeningSpeech ? 'fa-microphone-lines fa-fade' : 'fa-microphone text-rose-500'}`}></i>
                        <span>{isListeningSpeech ? 'جاري الاستماع... (اضغط للإيقاف)' : 'إملاء صوتي 🎙️'}</span>
                      </button>
                    </div>

                    <textarea
                      value={userAnswers[currentQIndex]?.studentAnswerText ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newAns = [...userAnswers];
                        newAns[currentQIndex] = {
                          isCorrect: false,
                          selected: val,
                          studentAnswerText: val,
                          concept: question.concept,
                          paragraph: question.paragraph,
                          type: 'essay',
                          status: 'pending'
                        };
                        setUserAnswers(newAns);
                      }}
                      placeholder="اكتب إجابتك هنا بالتفصيل وبأسلوبك الخاص..."
                      rows={5}
                      className={`w-full p-4 font-bold text-sm sm:text-base rounded-2xl border-2 outline-none transition-all resize-y ${
                        isDarkMode 
                          ? 'bg-gray-900 border-gray-600 text-white focus:border-primary' 
                          : 'bg-amber-50/20 border-gray-200 focus:border-primary focus:bg-white text-gray-900'
                      }`}
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-2">
                      <span className="text-xs text-gray-400 font-bold">
                        {userAnswers[currentQIndex]?.studentAnswerText && userAnswers[currentQIndex].studentAnswerText!.trim() 
                          ? `عدد الكلمات: ${userAnswers[currentQIndex].studentAnswerText!.trim().split(/\s+/).filter(Boolean).length} كلمة` 
                          : 'لم تكتب الإجابة بعد'}
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          if (!userAnswers[currentQIndex]?.studentAnswerText?.trim()) {
                            const newAns = [...userAnswers];
                            newAns[currentQIndex] = {
                              isCorrect: false,
                              selected: '',
                              studentAnswerText: '',
                              concept: question.concept,
                              paragraph: question.paragraph,
                              type: 'essay',
                              status: 'pending'
                            };
                            setUserAnswers(newAns);
                          }
                          setSkippedQuestions(prev => prev.filter(idx => idx !== currentQIndex));
                          if (currentQIndex < activeLesson.questions.length - 1) {
                            setCurrentQIndex(currentQIndex + 1);
                          } else {
                            handleFinishQuiz();
                          }
                        }}
                        className="bg-primary hover:bg-primary-dark text-white font-black text-xs sm:text-sm px-6 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2"
                      >
                        <span>حفظ ومتابعة</span>
                        <i className="fas fa-arrow-left text-xs"></i>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {isAnswered && currentAnswer && isReviewMode && (question.type === 'mcq' || question.type === 'tf' || question.type === 't/f') && question.reason && (
                <div className={`mt-4 rounded-3xl p-6 shadow-md border-r-8 ${
                  isDarkMode 
                    ? (currentAnswer.isCorrect ? 'bg-green-950/20 border-green-500 text-gray-100' : 'bg-red-950/20 border-red-500 text-gray-100')
                    : (currentAnswer.isCorrect ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500')
                }`}>
                  <h3 className={`text-xl font-black underline underline-offset-4 mb-2 ${isDarkMode ? 'text-red-400 decoration-red-400' : 'text-red-600 decoration-red-600'}`}>التعليل:</h3>
                  <div className="text-xl font-bold leading-relaxed">
                    <HighlightText text={question.reason} concept={question.concept} isDarkMode={isDarkMode} />
                  </div>
                  {question.concept && (
                    <div className="mt-4 pt-3 border-t border-gray-300/40 dark:border-gray-700/60 flex items-center gap-2 text-sm sm:text-base font-black text-amber-700 dark:text-amber-300">
                      <i className="fas fa-lightbulb text-amber-500"></i>
                      <span>المفهوم المرتبط:</span>
                      <span className="text-primary dark:text-secondary underline decoration-dotted">{question.concept}</span>
                    </div>
                  )}
                </div>
              )}
              
              <div className="mt-auto pt-8 flex justify-between items-center bg-transparent z-10">
                {/* زر السابق مع إمكانية الرجوع للسؤال السابق */}
                {currentQIndex > 0 ? (
                  <button
                    onClick={() => setCurrentQIndex(currentQIndex - 1)}
                    className={`font-black text-lg py-3 px-6 rounded-2xl transition-transform active:scale-95 shadow-md flex items-center gap-2 cursor-pointer ${isDarkMode ? 'bg-gray-800 text-gray-200 border border-gray-600 hover:bg-gray-700' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}
                  >
                    <i className="fas fa-arrow-right"></i> السابق
                  </button>
                ) : (
                  <div className="w-24"></div>
                )}

                {isReviewMode ? (
                  <button
                    onClick={() => {
                      setIsReviewMode(false);
                      setScreen('result');
                    }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer border border-indigo-400"
                  >
                    <i className="fas fa-check-circle text-amber-300"></i> إنهاء المراجعة والعودة للنتيجة
                  </button>
                ) : (
                  !isAnswered && currentQIndex < totalQs - 1 && timeLeft !== -1 && (
                    <button
                      onClick={handleSkip}
                      className={`font-black text-lg py-3 px-6 rounded-2xl transition-transform active:scale-95 shadow-md flex items-center gap-2 ${isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                    >
                      تخطي <i className="fas fa-forward"></i>
                    </button>
                  )
                )}

                {isReviewMode ? (
                  currentQIndex < totalQs - 1 ? (
                    <button 
                      onClick={() => setCurrentQIndex(currentQIndex + 1)} 
                      className="bg-primary text-white font-black text-xl py-3 px-8 rounded-2xl shadow-md transition-transform active:scale-95"
                    >
                      التالي <i className="fas fa-arrow-left"></i>
                    </button>
                  ) : (
                    <button 
                      onClick={() => {
                        setIsReviewMode(false);
                        setScreen('result');
                      }} 
                      className="bg-emerald-600 text-white font-black text-xl py-3 px-8 rounded-2xl shadow-md transition-transform active:scale-95"
                    >
                      تمت المراجعة <i className="fas fa-check"></i>
                    </button>
                  )
                ) : isAnswered ? (
                  <button 
                    onClick={()=>currentQIndex<totalQs-1?setCurrentQIndex(currentQIndex+1):handleFinishQuiz()} 
                    className={`text-white font-black text-xl py-3 px-8 rounded-2xl shadow-md transition-transform active:scale-95 ${currentQIndex===totalQs-1?'bg-red-500':'bg-secondary'}`}
                  >
                    {currentQIndex===totalQs-1?'إنهاء':'التالي'} <i className="fas fa-arrow-left"></i>
                  </button>
                ) : (
                  currentQIndex === totalQs - 1 && (
                    <button 
                      onClick={() => handleFinishQuiz()} 
                      className="text-white font-black text-xl py-3 px-8 rounded-2xl shadow-md transition-transform active:scale-95 bg-red-500"
                    >
                      إنهاء الاختبار
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
          
          {/* Skipped Questions Modal */}
          <AnimatePresence>
            {showSkippedModal && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center p-4 backdrop-blur-sm" 
                dir="rtl"
              >
                <motion.div 
                  initial={{ scale: 0.9, y: 20, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  exit={{ scale: 0.9, y: 20, opacity: 0 }}
                  className={`rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col border-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className={`text-xl font-black ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>
                      <i className="fas fa-list-ul ml-2 text-yellow-500"></i>
                      الأسئلة المتروكة
                    </h2>
                    <button onClick={() => setShowSkippedModal(false)} className={`text-2xl transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}>
                      <i className="fas fa-times-circle"></i>
                    </button>
                  </div>
                  <p className={`text-sm font-bold mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    لا تقلق، يتم حفظ الأسئلة التي قمت بتخطيها هنا، اضغط على رقم السؤال للعودة إليه:
                  </p>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                    {skippedQuestions.map((qIdx) => (
                      <button
                        key={qIdx}
                        onClick={() => {
                          setCurrentQIndex(qIdx);
                          setShowSkippedModal(false);
                        }}
                        className={`aspect-square rounded-xl font-black text-lg flex items-center justify-center shadow-sm transition-transform active:scale-95 border-2 ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' : 'bg-gray-50 border-gray-200 text-primary hover:bg-gray-200'}`}
                      >
                        {toEasternArabic(qIdx + 1)}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feedback Toast Overlay */}
          <AnimatePresence>
            {feedbackToast && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 z-[99999] flex items-center justify-center backdrop-blur-xs"
              >
                <motion.div 
                  initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1, transition: { type: 'spring', damping: 12 } }}
                  exit={{ scale: 0.6, rotate: 10, opacity: 0, transition: { duration: 0.2 } }}
                  className={`px-8 py-6 rounded-3xl flex flex-col items-center justify-center gap-2 shadow-[0_25px_60px_rgba(0,0,0,0.5)] border-4 transition-all ${
                    feedbackToast.isCorrect 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800' 
                      : 'bg-rose-50 border-rose-500 text-rose-800'
                  }`}
                >
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-[2.75rem] shadow-sm border-2 ${
                    feedbackToast.isCorrect 
                      ? 'bg-emerald-500 text-white border-emerald-600 animate-bounce' 
                      : 'bg-rose-500 text-white border-rose-600'
                  }`}>
                    {feedbackToast.isCorrect ? '👍' : '😔'}
                  </div>
                  <span className="text-2xl font-black mt-1 select-none tracking-wide text-center">
                    {feedbackToast.isCorrect ? 'عاش 💪' : 'ركز'}
                  </span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }
    
    if (screen === 'result' && activeLesson) {
      const totalQs = activeLesson.questions.length; 
      const correct = userAnswers.filter(a => a.isCorrect).length; 
      const perc = Math.round((correct/totalQs)*100);
      const wrongConcepts = [...new Set(userAnswers.filter(a => !a.isCorrect).map(a => a.paragraph || a.concept || 'مراجعة عامة'))];
      const firstName = studentName ? studentName.split(' ')[0] : 'يا بطل';
      const earnedXP = correct * 10;
      
      // حساب نسبة استكمال الوحدة والدرجة الإجمالية
      const activeUnit = data.find(u => u.lessons.some(l => l.id === activeLesson.id));
      let totalUnitQs = 0;
      let totalUnitCorrect = 0;
      let allLessonsAttempted = true;
      let attemptedCountInUnit = 0;

      if (activeUnit) {
        activeUnit.lessons.forEach(l => {
          totalUnitQs += l.questions.length;
          if (l.id === activeLesson.id) {
             const firstAttemptScore = lessonScores[l.id] !== undefined ? lessonScores[l.id] : correct;
             totalUnitCorrect += Math.min(l.questions.length, firstAttemptScore);
             attemptedCountInUnit++;
          } else {
             if (lessonScores[l.id] !== undefined) {
                totalUnitCorrect += Math.min(l.questions.length, lessonScores[l.id]);
                attemptedCountInUnit++;
             } else {
                allLessonsAttempted = false;
             }
          }
        });
      }
      const unitPerc = totalUnitQs > 0 ? Math.min(100, Math.round((totalUnitCorrect / totalUnitQs) * 100)) : 0;
      
      const isCompExam = certSettings.comprehensiveExamsConfig[activeLesson.id]?.isComprehensive || 
        activeLesson.title.includes('شامل') || 
        activeLesson.title.includes('تراكمي');

      const showLessonCert = certSettings.enableLessonCerts && !isCompExam && activeLesson.id !== 'mistakes_bank' && perc >= certSettings.minCertScore;
      
      const showCompCert = certSettings.enableComprehensiveCerts && isCompExam && perc >= certSettings.minCertScore;

      const expectedLessons = activeUnit ? (certSettings.unitExpectedLessons[activeUnit.id] || activeUnit.lessons.length) : 0;
      const isUnitFormallyCompleted = activeUnit ? (certSettings.unitCompletedStatus[activeUnit.id] ?? false) : false;
      const showUnitCert = certSettings.enableUnitCerts && 
        activeUnit && 
        activeLesson.id !== 'mistakes_bank' && 
        (isUnitFormallyCompleted || (allLessonsAttempted && attemptedCountInUnit >= expectedLessons)) && 
        attemptedCountInUnit >= expectedLessons && 
        unitPerc >= certSettings.minCertScore;

      return (
        <div className="h-[100dvh] w-full flex items-center justify-center p-6 bg-gray-50 overflow-y-auto watermark-container">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-8 md:p-10 text-center border-t-8 border-primary my-auto animate-fade-in flex flex-col items-center">
            <i className={`fas ${perc===100?'fa-trophy text-gold':perc>=75?'fa-medal text-blue-500':'fa-book-open text-secondary'} text-7xl md:text-8xl mb-4 block`}></i>
            <div className="text-5xl md:text-6xl font-black text-primary mb-6 flex justify-center items-center gap-1" dir="ltr"><span>{toEasternArabic(perc)}</span><span>%</span></div>
            <div className="w-full mb-8">
              
              {earnedXP > 0 && activeLesson.id !== 'mistakes_bank' && (
                <div className="flex flex-col items-center gap-2 mb-6">
                  <div className="bg-yellow-100 text-yellow-800 font-black px-4 py-2 rounded-xl text-lg shadow-sm border border-yellow-300 inline-block">
                    +{toEasternArabic(earnedXP)} نقطة خبرة (XP) 🌟
                  </div>
                  <div className="bg-indigo-50 text-indigo-800 font-bold px-4 py-2 rounded-xl text-sm shadow-sm border border-indigo-200 w-full">
                    مستواك الحالي: {levelInfo.icon} <span className="font-black">{levelInfo.title}</span>
                  </div>
                  {badges.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 mt-2 w-full">
                      {badges.includes('mistake_conqueror') && <div className="bg-slate-50 border border-slate-300 text-slate-800 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm">🛡️ قاهر الأخطاء</div>}
                      {badges.includes('night_owl') && <div className="bg-indigo-50 border border-indigo-300 text-indigo-800 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm">🦉 بطل الليل</div>}
                      {badges.includes('perfect_arrow') && <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm">⚡ وسام السهم</div>}
                    </div>
                  )}
                </div>
              )}
              
              {/* أزرار استلام الشهادات المستحقة */}
              {showCompCert && (
                <div className="space-y-4 mb-3">
                  <button
                    onClick={() => {
                      const covered = certSettings.comprehensiveExamsConfig[activeLesson.id]?.coveredUnits || [];
                      const coveredTitles = covered.map(uId => data.find(u => u.id === uId)?.title).filter(Boolean);
                      const titleToUse = coveredTitles.length > 0 
                        ? `الامتحان الشامل على: ${coveredTitles.join(' + ')}` 
                        : activeLesson.title;
                      setCertModalData({
                        type: 'comprehensive',
                        title: titleToUse,
                        score: perc
                      });
                      setShowCertModal(true);
                    }}
                    className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 text-white font-black text-base sm:text-lg py-3 px-6 rounded-2xl w-full hover:from-purple-700 hover:to-blue-700 transition-all shadow-lg border-2 border-yellow-300 animate-pulse flex items-center justify-center gap-3 cursor-pointer"
                  >
                    <i className="fas fa-crown text-2xl text-yellow-300"></i> استلام وسام الامتحان الشامل 🎯
                  </button>
                </div>
              )}

              {showLessonCert && (
                <div className="space-y-4 mb-3">
                  <button
                    onClick={() => {
                      const titleToUse = activeUnit ? `${activeUnit.title} - ${activeLesson.title}` : activeLesson.title;
                      setCertModalData({
                        type: 'lesson',
                        title: titleToUse,
                        score: perc
                      });
                      setShowCertModal(true);
                    }}
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-black text-base sm:text-lg py-3 px-6 rounded-2xl w-full hover:from-emerald-600 hover:to-teal-700 transition-all shadow-md border-2 border-emerald-300 flex items-center justify-center gap-2.5 cursor-pointer"
                  >
                    <i className="fas fa-award text-2xl text-yellow-300"></i> استلام شهادة تفوق في الدرس 📜
                  </button>
                </div>
              )}

              {showUnitCert && (
                <div className="space-y-4 mb-3">
                  <button
                    onClick={() => {
                      setCertModalData({
                        type: 'unit',
                        title: activeUnit?.title || activeLesson.title,
                        score: unitPerc
                      });
                      setShowCertModal(true);
                    }}
                    className="bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-600 text-white font-black text-lg sm:text-xl py-3.5 px-6 rounded-2xl w-full hover:from-yellow-500 hover:to-yellow-700 transition-all shadow-lg border-2 border-yellow-300 animate-bounce flex items-center justify-center gap-3 cursor-pointer"
                  >
                    <i className="fas fa-trophy text-2xl text-white"></i> استلام شهادة إتمام الوحدة كاملة 🏆
                  </button>
                </div>
              )}

              {isPracticeMode && (
                <div className="w-full bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-2xl p-3 sm:p-4 text-xs sm:text-sm font-black mb-4 flex items-center justify-center gap-2">
                  <i className="fas fa-dumbbell text-amber-600 text-base shrink-0"></i>
                  <span>🎯 نمط التدريب: هذه المحاولة للتدريب والتقوية فقط (تم الاحتفاظ بدرجتك الرسمية الأولى في الشيت ولوحة الشرف دون تغيير).</span>
                </div>
              )}

              {perc === 100 && (
                <div className="space-y-4">
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-loose"><span className="text-pink-600 font-black">عاش يا بطل!</span> لقد اجتزت (<span className="text-secondary font-black">{activeLesson.title}</span>) بنجاح.</p>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 shadow-sm inline-block w-full"><p className="text-lg font-black text-blue-800"><span className="text-pink-600">أ/ إسلام سعود:</span> {firstName}، أنا فخور بك!</p></div>
                </div>
              )}
              {perc >= 75 && perc < 100 && (
                <div className="space-y-4">
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-loose"><span className="text-pink-600 font-black">عاش يا بطل!</span> لقد اجتزت (<span className="text-secondary font-black">{activeLesson.title}</span>) بنجاح.<span className="text-gray-600 mt-2 block text-lg">ولكن لضمان التقفيل، راجع هذه الأجزاء السريعة:</span><span className="text-primary block mt-1 font-black text-lg">({wrongConcepts.join('، ')})</span></p>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 shadow-sm inline-block w-full"><p className="text-lg font-black text-blue-800"><span className="text-pink-600">أ/ إسلام سعود:</span> {firstName}، أنا فخور بك!</p></div>
                </div>
              )}
              {perc < 75 && (
                <div className="space-y-4">
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-loose"><span className="text-red-500 block mb-1">هناك أجزاء تحتاج تركيز:</span><span className="text-primary font-black block text-lg">({wrongConcepts.join('، ')})</span></p>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm inline-block w-full"><p className="text-base md:text-lg font-black text-yellow-800"><span className="text-pink-600">أ/ إسلام سعود:</span> {firstName}، لا تنسَ مراجعة ما سبق، في كل الأحوال سوف أكون فخور بك بإذن الله ❤️</p></div>
                </div>
              )}
            </div>
            <div className="w-full flex flex-col gap-3">
              {/* زر مراجعة الإجابات والتعليلات النموذجية */}
              <button 
                onClick={() => {
                  setIsReviewMode(true);
                  setCurrentQIndex(0);
                  setScreen('quiz');
                }} 
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg sm:text-xl py-3.5 px-6 rounded-2xl w-full transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer border-2 border-emerald-500"
              >
                <i className="fas fa-search-plus text-amber-300"></i> مراجعة الإجابات والتعليلات النموذجية 🔍
              </button>

              {/* زر إعادة الاختبار للتدريب والتقوية فقط */}
              <button 
                onClick={() => {
                  setIsPracticeMode(true);
                  setIsReviewMode(false);
                  setUserAnswers([]);
                  setCurrentQIndex(0);
                  setSkippedQuestions([]);
                  const shuffledQuestions = shuffleArray(activeLesson.questions).map(q => {
                    if (q.type === 'mcq' && q.options && q.options.length > 0) {
                      return { ...q, options: shuffleOptions(q.options) };
                    }
                    return q;
                  });
                  setActiveLesson({ ...activeLesson, questions: shuffledQuestions });
                  setTimeLeft(isLessonTimerActive(activeLesson.title, activeLesson.id) ? timerSecondsPerQ : null);
                  setScreen('quiz');
                }} 
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-lg sm:text-xl py-3.5 px-6 rounded-2xl w-full transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer border-2 border-amber-600"
              >
                <i className="fas fa-dumbbell"></i> إعادة الاختبار (للتدريب والتقوية فقط) 🔄
              </button>

              <button 
                onClick={()=>{
                  setIsReviewMode(false);
                  setIsPracticeMode(false);
                  setScreen('index');
                }} 
                className="bg-primary text-white font-black text-xl md:text-2xl py-4 px-10 rounded-full w-full hover:bg-gray-900 transition-colors shadow-lg active:scale-95"
              >
                العودة للفهرس
              </button>

              {activeLesson.questions.some(q => q.type === 'essay') && (
                <button 
                  onClick={() => {
                    const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
                    const studentSubs = getStudentSubmissions(phone);
                    const currentSub = studentSubs.find(s => s.lessonId === activeLesson.id) || studentSubs[0];
                    if (currentSub) {
                      setApprovedSubForModal(currentSub);
                    }
                  }} 
                  className="bg-indigo-600 text-white font-black text-lg py-3.5 px-6 rounded-full w-full hover:bg-indigo-700 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer border-2 border-indigo-500"
                >
                  <i className="fas fa-feather-alt text-amber-400"></i> مراجعة تفاصيل ودرجات الأسئلة المقالية 📝
                </button>
              )}
              
              {perc < 100 && (
                <button 
                  onClick={()=>{
                    const wrongQs = activeLesson.questions.filter((q, idx) => userAnswers[idx] && !userAnswers[idx].isCorrect);
                    const shuffledWrongQs = shuffleArray(wrongQs).map(q => {
                      if (q.type === 'mcq' && q.options && q.options.length > 0) {
                        return { ...q, options: shuffleOptions(q.options) };
                      }
                      return q;
                    });
                    const newLesson = { ...activeLesson, questions: shuffledWrongQs };
                    setData(data.map(u=>({...u,lessons:u.lessons.map(l=>l.id===activeLesson.id?newLesson:l)})));
                    setActiveLesson(newLesson);
                    setIsReviewMode(false);
                    setIsPracticeMode(true);
                    setUserAnswers([]);
                    setCurrentQIndex(0);
                    setSkippedQuestions([]);
                    setTimeLeft(isLessonTimerActive(activeLesson.title, activeLesson.id) ? timerSecondsPerQ : null);
                    if (securitySettings.offlineModeEnabled && typeof navigator !== 'undefined' && navigator.onLine) {
                      setOfflineGateStatus('require_offline_to_start');
                    } else {
                      setOfflineGateStatus('none');
                    }
                    tabSwitchStrikesRef.current = 0;
                    setTabSwitchStrikes(0);
                    setIsScreenObfuscated(false);
                    setTabSwitchWarningModal(null);
                    setScreen('quiz');
                  }} 
                  className="bg-rose-500 text-white font-black text-xl md:text-2xl py-4 px-10 rounded-full w-full hover:bg-rose-700 transition-colors shadow-lg active:scale-95 border-2 border-rose-600"
                >
                  إعادة اختبار الأخطاء فقط <i className="fas fa-redo-alt ml-2"></i>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    if (screen === 'admin') {
      const calculateAdminCertificates = () => {
        const certStudents: { name: string; phone: string; avg: number; unitTitle: string; certType: 'lesson' | 'unit' | 'comprehensive'; totalScore?: number }[] = [];
        const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
        
        const isLessonChoice = adminSelectedUnit.startsWith('lesson_');
        const selectedLessonId = isLessonChoice ? adminSelectedUnit.replace('lesson_', '') : null;
        let selectedLessonObj: Lesson | null = null;
        let selectedLessonUnitObj: Unit | null = null;
        if (selectedLessonId) {
          for (const u of data) {
            const l = u.lessons.find(ls => ls.id === selectedLessonId);
            if (l) { selectedLessonObj = l; selectedLessonUnitObj = u; break; }
          }
        }

        const isCompChoice = adminSelectedUnit.startsWith('comp_');
        const selectedCompId = isCompChoice ? adminSelectedUnit.replace('comp_', '') : null;
        let selectedCompObj: Lesson | null = null;
        if (selectedCompId) {
          for (const u of data) {
            const l = u.lessons.find(ls => ls.id === selectedCompId);
            if (l) { selectedCompObj = l; break; }
          }
        }

        const isUnitChoice = adminSelectedUnit.startsWith('unit_');
        const selectedUnitId = isUnitChoice ? adminSelectedUnit.replace('unit_', '') : (adminSelectedUnit !== 'all' ? adminSelectedUnit : null);
        const unitsToProcess = selectedUnitId ? data.filter(u => u.id === selectedUnitId) : [];

        adminResults.forEach(student => {
          const firstScores: Record<string, number> = {};
          
          student.tests.forEach(t => {
            if (isAmbiguousOldQuiz(t.quiz)) return;
            
            if (t.quiz.includes('تصفير') || t.quiz.includes('فرصة جديدة') || String(t.score).includes('تصفير')) {
              if (t.quiz.includes('فرصة جديدة') || t.quiz.includes('تصفير درس')) {
                const lessonTitleToReset = t.quiz.replace(/.*(?:فرصة جديدة|تصفير درس).*?:/, '').trim();
                const matchedLesson = data.flatMap(u => u.lessons).find(l => 
                  normalizeLessonName(l.title).includes(normalizeLessonName(lessonTitleToReset)) || 
                  normalizeLessonName(lessonTitleToReset).includes(normalizeLessonName(l.title))
                );
                if (matchedLesson) {
                  delete firstScores[matchedLesson.title];
                }
              } else if (t.quiz.includes('تصفير الوحدة')) { 
                const unitTitleToReset = t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                if (unitToReset) {
                    unitToReset.lessons.forEach(l => delete firstScores[l.title]);
                }
              }
              else {
                for(let key in firstScores) delete firstScores[key];
              }
              return;
            }
            
            const mappedTitle = matchQuizToCurrent(t.quiz, currentValidLessons);
            if (mappedTitle) {
              const sc = normalizeScore(t.score);
              if (firstScores[mappedTitle] === undefined) {
                firstScores[mappedTitle] = sc;
              }
            }
          });

          // 1. درس فردي محدد
          if (isLessonChoice && selectedLessonObj) {
            const sc = firstScores[selectedLessonObj.title];
            if (sc !== undefined && sc >= certSettings.minCertScore) {
              const title = selectedLessonUnitObj ? `${selectedLessonUnitObj.title} - ${selectedLessonObj.title}` : selectedLessonObj.title;
              certStudents.push({
                name: student.name,
                phone: student.phone,
                avg: sc,
                unitTitle: title,
                certType: 'lesson',
                totalScore: sc
              });
            }
            return;
          }

          // 2. امتحان شامل محدد
          if (isCompChoice && selectedCompObj) {
            const sc = firstScores[selectedCompObj.title];
            if (sc !== undefined && sc >= certSettings.minCertScore) {
              const covered = certSettings.comprehensiveExamsConfig[selectedCompObj.id]?.coveredUnits || [];
              const coveredTitles = covered.map(uId => data.find(u => u.id === uId)?.title).filter(Boolean);
              const title = coveredTitles.length > 0 
                ? `الامتحان الشامل على: ${coveredTitles.join(' + ')}` 
                : selectedCompObj.title;
              certStudents.push({
                name: student.name,
                phone: student.phone,
                avg: sc,
                unitTitle: title,
                certType: 'comprehensive',
                totalScore: sc
              });
            }
            return;
          }

          // 3. وحدة معينة (إتمام الوحدة)
          if (isUnitChoice && unitsToProcess.length > 0) {
            unitsToProcess.forEach(selectedUnitObj => {
              const expectedCount = certSettings.unitExpectedLessons[selectedUnitObj.id] || selectedUnitObj.lessons.length;
              const attemptedLessons = selectedUnitObj.lessons.filter(l => firstScores[l.title] !== undefined);
              const isUnitCompleted = certSettings.unitCompletedStatus[selectedUnitObj.id] ?? (attemptedLessons.length >= expectedCount);
              
              if (attemptedLessons.length >= expectedCount && isUnitCompleted) {
                let totalPerc = 0;
                attemptedLessons.forEach(l => { totalPerc += firstScores[l.title]; });
                const unitAvg = Math.min(100, Math.round(totalPerc / attemptedLessons.length));
                if (unitAvg >= certSettings.minCertScore) {
                  certStudents.push({
                    name: student.name,
                    phone: student.phone,
                    avg: unitAvg,
                    unitTitle: selectedUnitObj.title,
                    certType: 'unit',
                    totalScore: totalPerc
                  });
                }
              }
            });
            return;
          }

          // 4. خيار "الكل": إحصائية شاملة لكل من أتم وحدة بنجاح
          if (adminSelectedUnit === 'all') {
            data.forEach(u => {
              const expectedCount = certSettings.unitExpectedLessons[u.id] || u.lessons.length;
              const attemptedLessons = u.lessons.filter(l => firstScores[l.title] !== undefined);
              if (attemptedLessons.length >= expectedCount && attemptedLessons.length > 0) {
                let totalPerc = 0;
                attemptedLessons.forEach(l => { totalPerc += firstScores[l.title]; });
                const unitAvg = Math.min(100, Math.round(totalPerc / attemptedLessons.length));
                if (unitAvg >= certSettings.minCertScore) {
                  certStudents.push({
                    name: student.name,
                    phone: student.phone,
                    avg: unitAvg,
                    unitTitle: u.title,
                    certType: 'unit',
                    totalScore: totalPerc
                  });
                }
              }
            });
          }
        });
      
        return certStudents.sort((a, b) => b.avg - a.avg);
      };

      const formatAdminQuizName = (name: string) => {
        if (!name) return null;
        const regex = /(الوحدة\s+[\u0600-\u06FF]+|الدرس\s+[\u0600-\u06FF]+|تصفير\s*[^:]*|بنك الأخطاء\s*[^\s:]*)/g;
        const parts = name.split(regex);
        return parts.map((part, idx) => {
          if (part.startsWith('الوحدة')) return <span key={idx} className="text-rose-600 font-black">{part}</span>;
          if (part.startsWith('الدرس')) return <span key={idx} className="text-emerald-600 font-black">{part}</span>;
          if (part.startsWith('تصفير')) return <span key={idx} className="text-red-600 font-black">{part}</span>;
          if (part.startsWith('بنك الأخطاء')) return <span key={idx} className="text-rose-500 font-black">{part}</span>;
          return <span key={idx} className="text-indigo-600 font-black">{part}</span>;
        });
      };

      return (
        <div className="h-[100dvh] w-full flex flex-col bg-gray-50">
          <div className="bg-primary text-white px-4 pt-3 md:pt-4 lg:pt-3 pb-3 flex justify-between items-center z-10 border-b-4 border-gold flex-wrap gap-y-3 shadow-md shrink-0">
            <div className="flex items-center gap-3 shrink-0 justify-start">
              <i className="fas fa-graduation-cap text-2xl sm:text-3xl md:text-4xl text-gold shrink-0"></i>
              <div className="flex flex-col items-start text-right">
                <div className="flex items-center gap-1 font-black text-xl sm:text-2xl leading-none mb-1"><span className="text-gold">موسوعة</span><span className="text-white">الكنز التعليمي</span></div>
                <div className="text-[10px] sm:text-xs font-bold flex gap-1"><span className="text-gray-300">الإدارة</span></div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 shrink-0">
              <button onClick={() => setScreen('index')} className="bg-blue-600 text-white font-black px-4 py-2 rounded-xl text-xs sm:text-sm hover:bg-blue-500 transition-all shadow-sm border border-blue-500 flex items-center gap-2"><i className="fas fa-book-reader"></i> طالب</button>
              <button onClick={fetchAdminData} className="bg-emerald-600 text-white font-black px-4 py-2 rounded-xl text-xs sm:text-sm hover:bg-emerald-500 transition-all shadow-sm border border-emerald-500 flex items-center gap-2"><i className="fas fa-sync-alt"></i> تحديث</button>
              <button onClick={() => { setInputPhone(''); setInputPassword(''); setShowPasswordInput(false); setScreen('home'); }} className="bg-rose-600 text-white font-black px-4 py-2 rounded-xl text-xs sm:text-sm hover:bg-rose-500 transition-all shadow-sm border border-rose-500 flex items-center gap-2"><i className="fas fa-sign-out-alt"></i> خروج</button>
            </div>
          </div>
          
          <div 
            className="flex-1 overflow-y-auto p-4 z-10 flex flex-col md:flex-row gap-6"
            ref={adminScrollRef}
            onScroll={(e) => setShowAdminScrollTop(e.currentTarget.scrollTop > 300)}
          >
            <div className="w-full md:w-64 shrink-0 bg-white rounded-2xl shadow-sm border border-gray-100 p-2.5 flex flex-row md:flex-col overflow-x-auto custom-scrollbar gap-2">
              <button onClick={() => setAdminActiveTab('results')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='results'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-chart-bar w-5 text-center"></i> النتائج والمتابعة</button>
              <button onClick={() => setAdminActiveTab('lessons')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='lessons'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-layer-group w-5 text-center text-emerald-500"></i> إدارة ونشر الدروس</button>
              <button onClick={() => setAdminActiveTab('schedules')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='schedules'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-calendar-alt w-5 text-center text-indigo-500"></i> جدولة الامتحانات 📅</button>
              <button 
                onClick={() => setAdminActiveTab('essay_review')} 
                className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 relative ${
                  adminActiveTab==='essay_review'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'
                }`}
              >
                <i className="fas fa-feather-alt w-5 text-center text-amber-500"></i> 
                <span>تصحيح المقالي</span>
                {pendingEssayCount > 0 && (
                  <span className="absolute top-2 left-2 bg-amber-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse">
                    {pendingEssayCount}
                  </span>
                )}
              </button>
              <button onClick={() => setAdminActiveTab('leaderboard')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='leaderboard'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-trophy w-5 text-center text-gold"></i> لوحة الشرف</button>
              <button onClick={() => setAdminActiveTab('certificates')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='certificates'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-award w-5 text-center text-blue-400"></i> شهادات التقدير</button>
              <button onClick={() => setAdminActiveTab('online')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 relative ${adminActiveTab==='online' || adminActiveTab==='requests'?'bg-emerald-700 text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-globe w-5 text-center text-emerald-400"></i> مشتركو الأونلاين 🌐 {adminPendingReqs.length>0&&<span className="absolute top-2 left-2 bg-amber-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse">{adminPendingReqs.length}</span>}</button>
              <button onClick={() => setAdminActiveTab('search')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='search'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-school w-5 text-center text-blue-500"></i> اشتراكات السنتر</button>
              <button onClick={() => setAdminActiveTab('settings')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='settings'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-cog w-5 text-center"></i> الإعدادات</button>
            </div>
            
            <div className="flex-1 w-full space-y-6 min-w-0">
              {adminActiveTab === 'results' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                      <h2 className="text-xl font-black text-primary"><i className="fas fa-chart-line text-blue-500 ml-1"></i> نتائج ومتابعة الطلاب</h2>
                      <div className="relative w-full sm:w-64">
                        <input 
                          type="text" 
                          placeholder="بحث بالاسم..." 
                          className="border-2 border-gray-300 rounded-xl px-4 py-2 w-full focus:border-primary outline-none text-sm font-bold pr-10" 
                          value={resultsSearchQuery} 
                          onChange={e => setResultsSearchQuery(e.target.value)} 
                        />
                        <i className="fas fa-search absolute top-1/2 -translate-y-1/2 right-3 text-gray-400"></i>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {/* 1. فرز أبجدي */}
                      <button 
                        type="button"
                        onClick={() => setAdminSort('alpha')} 
                        className={`flex-1 min-w-[95px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 cursor-pointer ${
                          adminSort === 'alpha' 
                            ? 'bg-blue-600 border-blue-700 text-white shadow-blue-200' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-blue-300'
                        }`}
                      >
                        <i className="fas fa-sort-alpha-down"></i>
                        <span>الأبجدية</span>
                      </button>

                      {/* 2. فرز التفاعل المدمج الذكي (الأكثر تفاعلاً 🔥 | الأقل تفاعلاً 🪫) */}
                      <div className={`flex-[1.4] min-w-[200px] p-0.5 rounded-xl border-2 flex items-center justify-between gap-1 transition-all shadow-sm ${
                        adminSort === 'most'
                          ? 'bg-emerald-50/80 border-emerald-500 shadow-emerald-100'
                          : adminSort === 'least'
                          ? 'bg-amber-50/80 border-amber-500 shadow-amber-100'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}>
                        <button
                          type="button"
                          onClick={() => setAdminSort(adminSort === 'most' ? 'least' : 'most')}
                          className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            adminSort === 'most'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'text-gray-600 hover:text-emerald-700 hover:bg-emerald-50'
                          }`}
                          title="فرز الطلاب تنازلياً من الأكثر تفاعلاً إلى الأقل"
                        >
                          <i className="fas fa-fire text-xs"></i>
                          <span>الأكثر تفاعلاً</span>
                          <i className="fas fa-arrow-down text-[9px] opacity-75"></i>
                        </button>
                        <div className="w-[1px] h-4 bg-gray-200 shrink-0"></div>
                        <button
                          type="button"
                          onClick={() => setAdminSort(adminSort === 'least' ? 'most' : 'least')}
                          className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            adminSort === 'least'
                              ? 'bg-amber-600 text-white shadow-xs'
                              : 'text-gray-600 hover:text-amber-700 hover:bg-amber-50'
                          }`}
                          title="فرز الطلاب تصاعدياً من الأقل تفاعلاً (تكاسلاً) إلى الأكثر"
                        >
                          <i className="fas fa-battery-quarter text-xs"></i>
                          <span>الأقل تفاعلاً</span>
                          <i className="fas fa-arrow-up text-[9px] opacity-75"></i>
                        </button>
                      </div>

                      {/* 3. الطلاب الذين لم يدخلوا */}
                      <button 
                        type="button"
                        onClick={() => setAdminSort('none')} 
                        className={`flex-1 min-w-[95px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 cursor-pointer ${
                          adminSort === 'none' 
                            ? 'bg-rose-600 border-rose-700 text-white shadow-rose-200' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-rose-300'
                        }`}
                        title="الطلاب الذين لم يؤدوا أي اختبار"
                      >
                        <i className="fas fa-ghost"></i>
                        <span>لم يدخلوا</span>
                      </button>

                      {/* 4. المحظورين */}
                      <button 
                        type="button"
                        onClick={() => setAdminSort('blocked')} 
                        className={`flex-1 min-w-[95px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 cursor-pointer ${
                          adminSort === 'blocked' 
                            ? 'bg-gray-900 border-black text-white shadow-gray-200' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-900'
                        }`}
                        title="الطلاب المحظورين"
                      >
                        <i className="fas fa-user-lock"></i>
                        <span>المحظورين</span>
                      </button>
                    </div>

                    {/* شريط الفلاتر الشامل: الوحدات، الدروس، النوع (بنين/بنات)، الفئة (سنتر/أونلاين) */}
                    <div className="pt-3 border-t border-gray-200/80 space-y-2.5">
                      {/* 1. فلتر اختيار الوحدات والدروس كقوائم منسدلة أنيقة ومتجاورة */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* قائمة اختيار الوحدة */}
                        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-2xs hover:border-primary/50 transition-colors">
                          <span className="text-xs font-black text-gray-700 flex items-center gap-1 shrink-0">
                            <i className="fas fa-layer-group text-primary"></i> الوحدة:
                          </span>
                          <select
                            value={resultsUnitFilter}
                            onChange={(e) => {
                              const newUnit = e.target.value;
                              setResultsUnitFilter(newUnit);
                              if (newUnit === 'all') {
                                setResultsLessonFilter('all');
                              } else {
                                const uObj = data.find(u => u.id === newUnit || u.title === newUnit);
                                if (uObj && !uObj.lessons.some(l => l.title === resultsLessonFilter)) {
                                  setResultsLessonFilter('all');
                                }
                              }
                            }}
                            className="text-xs font-bold text-gray-800 bg-transparent border-none outline-none cursor-pointer pr-1"
                          >
                            <option value="all">جميع الوحدات ({toEasternArabic(data.length)})</option>
                            {data.map((u, uIdx) => (
                              <option key={u.id || uIdx} value={u.id || u.title}>
                                {u.title} ({toEasternArabic(u.lessons.length)} درس)
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* قائمة اختيار الدرس المجاورة */}
                        {(() => {
                          const currentAvailableLessons = resultsUnitFilter === 'all'
                            ? data.flatMap(u => (u.lessons || []).map(l => l.title))
                            : (() => {
                                const uObj = data.find(u => u.id === resultsUnitFilter || u.title === resultsUnitFilter);
                                return uObj ? (uObj.lessons || []).map(l => l.title) : [];
                              })();

                          return (
                            <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-2xs hover:border-indigo-400 transition-colors">
                              <span className="text-xs font-black text-indigo-700 flex items-center gap-1 shrink-0">
                                <i className="fas fa-book-reader text-indigo-600"></i> الدرس:
                              </span>
                              <select
                                value={resultsLessonFilter}
                                onChange={(e) => setResultsLessonFilter(e.target.value)}
                                className="text-xs font-bold text-gray-800 bg-transparent border-none outline-none cursor-pointer max-w-[200px] sm:max-w-[280px] truncate pr-1"
                              >
                                <option value="all">جميع الدروس ({toEasternArabic(currentAvailableLessons.length)})</option>
                                {currentAvailableLessons.map((lTitle, lIdx) => (
                                  <option key={lIdx} value={lTitle}>
                                    {lTitle}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })()}

                        {/* زر إعادة ضبط الفلاتر إذا تم اختيار وحدة أو درس */}
                        {(resultsUnitFilter !== 'all' || resultsLessonFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={() => {
                              setResultsUnitFilter('all');
                              setResultsLessonFilter('all');
                            }}
                            className="text-[11px] font-bold text-gray-500 hover:text-rose-600 bg-gray-100 hover:bg-rose-50 border border-gray-200 px-2.5 py-1.5 rounded-xl transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
                            title="إعادة ضبط تصفية الوحدات والدروس لعرض الكل"
                          >
                            <i className="fas fa-undo-alt text-[9px]"></i> عرض الكل
                          </button>
                        )}
                      </div>

                      {/* 2. فلتر النوع وفلتر الفئة */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-dashed border-gray-200">
                        {/* فلتر النوع (بنين / بنات) */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-black text-gray-700 flex items-center gap-1 ml-1">
                            <i className="fas fa-venus-mars text-indigo-500"></i> تصفية النوع:
                          </span>
                          <button
                            type="button"
                            onClick={() => setResultsGenderFilter('all')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 cursor-pointer ${
                              resultsGenderFilter === 'all'
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <i className="fas fa-users text-xs"></i>
                            <span>الكل</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResultsGenderFilter('male')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                              resultsGenderFilter === 'male'
                                ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-200'
                                : 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-50'
                            }`}
                          >
                            <span>👦 بنين</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResultsGenderFilter('female')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                              resultsGenderFilter === 'female'
                                ? 'bg-pink-600 text-white shadow-xs ring-2 ring-pink-200'
                                : 'bg-white text-pink-700 border border-pink-200 hover:bg-pink-50'
                            }`}
                          >
                            <span>👧 بنات</span>
                          </button>
                        </div>

                        {/* فلتر الفئة (سنتر / أونلاين) */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-black text-gray-700 flex items-center gap-1 ml-1">
                            <i className="fas fa-filter text-primary"></i> الفئة:
                          </span>
                          <button 
                            type="button"
                            onClick={() => setResultsStudentTypeFilter('all')} 
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                              resultsStudentTypeFilter === 'all' 
                                ? 'bg-primary text-white shadow-xs' 
                                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            جميع الطلاب
                          </button>
                          <button 
                            type="button"
                            onClick={() => setResultsStudentTypeFilter('center')} 
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                              resultsStudentTypeFilter === 'center' 
                                ? 'bg-blue-600 text-white shadow-xs' 
                                : 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-50'
                            }`}
                          >
                            <i className="fas fa-school text-xs"></i> طلاب السنتر
                          </button>
                          <button 
                            type="button"
                            onClick={() => setResultsStudentTypeFilter('online')} 
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                              resultsStudentTypeFilter === 'online' 
                                ? 'bg-emerald-600 text-white shadow-xs' 
                                : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
                            }`}
                          >
                            <i className="fas fa-globe text-xs"></i> مشتركو الأونلاين
                            {adminOnlineStudents.length > 0 && (
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                resultsStudentTypeFilter === 'online' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {toEasternArabic(adminOnlineStudents.length)}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 space-y-2.5">
                    {(() => {
                      const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
                      const reqKeywords = ['زراع', 'رع', 'تعدين', 'صناع', 'يولي', 'فلسطين', 'كتوبر', 'صراع', 'يناير'];
                      const requiredCurrentTitles = currentValidLessons.filter(title => 
                          reqKeywords.some(kw => normalizeLessonName(title).includes(normalizeLessonName(kw)))
                      );

                      // الوحدة والدرس المحددين إن وجدا
                      const targetUnit = resultsUnitFilter !== 'all' 
                        ? data.find(u => u.id === resultsUnitFilter || u.title === resultsUnitFilter) 
                        : null;
                      const activeValidLessons = resultsLessonFilter !== 'all'
                        ? [resultsLessonFilter]
                        : targetUnit 
                          ? targetUnit.lessons.map(l => l.title) 
                          : currentValidLessons;
                      const activeUnitLessonsCount = resultsLessonFilter !== 'all'
                        ? 1
                        : targetUnit 
                          ? targetUnit.lessons.length 
                          : currentValidLessons.length;
                      
                      const getUniqueActiveTests = (tests: TestResult[]) => {
                          if (!tests || tests.length === 0) return [];
                          const firstScores: Record<string, number> = {};
                          tests.forEach(t => {
                              if (isAmbiguousOldQuiz(t.quiz)) return;
                              if (t.quiz.includes('تصفير') || t.quiz.includes('فرصة جديدة') || String(t.score).includes('تصفير')) {
                                  if (t.quiz.includes('فرصة جديدة') || t.quiz.includes('تصفير درس')) {
                                      const lessonTitleToReset = t.quiz.replace(/.*(?:فرصة جديدة|تصفير درس).*?:/, '').trim();
                                      const matchedLesson = data.flatMap(u => u.lessons).find(l => 
                                          normalizeLessonName(l.title).includes(normalizeLessonName(lessonTitleToReset)) || 
                                          normalizeLessonName(lessonTitleToReset).includes(normalizeLessonName(l.title))
                                      );
                                      if (matchedLesson) {
                                          delete firstScores[matchedLesson.title];
                                      }
                                  } else if (t.quiz.includes('تصفير الوحدة')) { 
                                      const unitTitleToReset = t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                                      const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                                      if (unitToReset) {
                                          unitToReset.lessons.forEach(l => delete firstScores[l.title]);
                                      }
                                  } else {
                                      for(let key in firstScores) delete firstScores[key];
                                  }
                                  return;
                              }
                              const mappedTitle = matchQuizToCurrent(t.quiz, activeValidLessons);
                              if (mappedTitle && firstScores[mappedTitle] === undefined) {
                                  firstScores[mappedTitle] = normalizeScore(t.score);
                              }
                          });
                          return Object.keys(firstScores);
                      };

                      let list = [...adminResults];
                      const activeNames = new Set(adminResults.map(r => r.name ? r.name.trim() : ''));
                      const inactive: GroupedResult[] = [];
                      Object.entries(studentsList).forEach(([phone, arr]) => {
                        const stArr = Array.isArray(arr) ? arr : [arr];
                        stArr.forEach(st => {
                           if (st && st.name && !activeNames.has(st.name.trim())) {
                             inactive.push({ name: st.name, phone: phone, tests: [], gender: (st as any).gender });
                           }
                        });
                      });

                      const testCountMap = new Map<any, number>();
                      const getCount = (st: GroupedResult) => {
                        let c = testCountMap.get(st);
                        if (c === undefined) {
                          c = getUniqueActiveTests(st.tests).length;
                          testCountMap.set(st, c);
                        }
                        return c;
                      };

                      // دمج جميع الطلاب
                      const allStudentsCombined: GroupedResult[] = [...list];
                      const existingNames = new Set(list.map(s => (s.name || '').trim()));
                      inactive.forEach(st => {
                        if (!existingNames.has(st.name.trim())) {
                          allStudentsCombined.push(st);
                          existingNames.add(st.name.trim());
                        }
                      });

                      let baseList = [...list, ...inactive];
                      if (adminSort === 'none') {
                         baseList = allStudentsCombined.filter(s => getCount(s) === 0).sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ar'));
                      } else if (adminSort === 'most') {
                         baseList = allStudentsCombined.filter(s => getCount(s) > 0).sort((a,b) => getCount(b) - getCount(a));
                      } else if (adminSort === 'least') {
                         baseList = allStudentsCombined.filter(s => getCount(s) > 0).sort((a,b) => getCount(a) - getCount(b));
                      } else if (adminSort === 'blocked') {
                         baseList = allStudentsCombined.filter(s => {
                             const stRecord = studentsList[s.phone];
                             const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                             const matchedSt = stArr.find(st => st.name.trim() === (s.name || '').trim());
                             return matchedSt && (matchedSt as any).isBlocked;
                         }).sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ar'));
                      } else {
                         baseList = allStudentsCombined.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ar'));
                      }

                      let displayList: GroupedResult[] = [];
                      if (resultsSearchQuery.trim()) {
                        const q = resultsSearchQuery.trim().toLowerCase();
                        displayList = baseList.filter(s => 
                          (s.name && String(s.name).toLowerCase().includes(q)) || 
                          (s.phone && String(s.phone).includes(q))
                        );
                      } else {
                        displayList = baseList;
                      }

                      // فحص وتصفية الفئة (سنتر / أونلاين)
                      const onlinePhoneSet = new Set((adminOnlineStudents || []).map(s => formatPhoneStr(s.phone)));
                      const isStudentOnline = (s: GroupedResult) => {
                        if (s.studentType === 'أونلاين') return true;
                        const cleanP = formatPhoneStr(s.phone);
                        if (onlinePhoneSet.has(cleanP)) return true;
                        if (s.tests && s.tests.some(t => t.studentType === 'أونلاين')) return true;
                        return false;
                      };

                      if (resultsStudentTypeFilter === 'center') {
                        displayList = displayList.filter(s => !isStudentOnline(s));
                      } else if (resultsStudentTypeFilter === 'online') {
                        displayList = displayList.filter(s => isStudentOnline(s));
                      }

                      // تصفية النوع (بنين / بنات)
                      const getStudentGender = (s: GroupedResult): 'male' | 'female' => {
                        const stRecord = studentsList[s.phone];
                        const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                        const matchedSt = stArr.find(st => st.name.trim() === (s.name || '').trim());
                        return detectArabicGender(s.name, matchedSt?.gender || s.gender);
                      };

                      if (resultsGenderFilter === 'male') {
                        displayList = displayList.filter(s => getStudentGender(s) === 'male');
                      } else if (resultsGenderFilter === 'female') {
                        displayList = displayList.filter(s => getStudentGender(s) === 'female');
                      }

                      return (
                        <React.Fragment>
                          {adminSort === 'none' && (
                            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 bg-rose-50 border border-rose-200 p-3 rounded-xl gap-3 shadow-sm">
                              <span className="text-rose-800 font-black text-sm">
                                <i className="fas fa-ghost ml-1"></i>
                                {resultsLessonFilter !== 'all'
                                  ? `إجمالي غير المتفاعلين في درس (${resultsLessonFilter}): `
                                  : targetUnit 
                                    ? `إجمالي غير المتفاعلين في ${targetUnit.title}: ` 
                                    : 'إجمالي غير المتفاعلين: '}
                                {toEasternArabic(displayList.length)}
                              </span>
                              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                <button 
                                  onClick={() => {
                                    const inactiveToBlock = displayList.filter(s => {
                                      if (getUniqueActiveTests(s.tests).length > 0) return false;
                                      const stRecord = studentsList[s.phone];
                                      const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                                      const matchedSt = stArr.find(student => student.name.trim() === (s.name || '').trim());
                                      return matchedSt && !(matchedSt as any).isBlocked;
                                    });

                                    if (inactiveToBlock.length === 0) {
                                      showAlert('لا يوجد طلاب غير متفاعلين (وغير محظورين مسبقاً) لحظرهم.');
                                      return;
                                    }
                                    showConfirm(`هل أنت متأكد من حظر الطلاب غير المتفاعلين (وعددهم ${inactiveToBlock.length} طالب) دفعة واحدة؟\\n(لن يتم حظر أي طالب متفاعل أو محظور مسبقاً).`, async () => {
                                      setIsLoading(true);
                                      setStudentsList(prev => {
                                        const newList = { ...prev };
                                        inactiveToBlock.forEach(st => {
                                          if (newList[st.phone]) {
                                            const listArr = Array.isArray(newList[st.phone]) ? newList[st.phone] : [newList[st.phone]];
                                            newList[st.phone] = (listArr as Student[]).map(s => 
                                              s.name.trim() === (st.name || '').trim() ? { ...s, isBlocked: true } as unknown as Student : s
                                            );
                                          }
                                        });
                                        return newList;
                                      });
                                      
                                      try {
                                        const studentsPayload = inactiveToBlock.map(st => ({ phone: st.phone, name: st.name }));
                                        await fetch(API_URL, { 
                                          method: 'POST', 
                                          body: JSON.stringify({ action: 'blockMultipleStudents', students: studentsPayload, apiKey: SECRET_API_KEY }) 
                                        });
                                      } catch(e) {}
                                      
                                      setIsLoading(false);
                                      showAlert('تم حظر جميع الطلاب غير المتفاعلين بنجاح! 🚫');
                                    });
                                  }}
                                  className="flex-1 sm:flex-none bg-rose-600 text-white hover:bg-rose-700 px-3 py-2 rounded-lg text-xs font-black shadow-sm flex justify-center items-center gap-2 transition-all active:scale-95 cursor-pointer"
                                >
                                  <i className="fas fa-user-slash"></i> حظر جماعي
                                </button>
                                <button 
                                  onClick={() => {
                                    if(displayList.length === 0) { showAlert('لا توجد أسماء لنسخها.'); return; }
                                    const text = displayList.map((s, idx) => `${idx + 1}- ${s.name}`).join('\\n');
                                    navigator.clipboard.writeText(text);
                                    showAlert('تم نسخ قائمة الأسماء بنجاح! يمكنك الآن لصقها في أي مكان.');
                                  }}
                                  className="flex-1 sm:flex-none bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-black shadow-sm flex justify-center items-center gap-2 transition-all active:scale-95 cursor-pointer"
                                >
                                  <i className="fas fa-copy"></i> نسخ الأسماء
                                </button>
                              </div>
                            </div>
                          )}
                          
                          {adminSort === 'blocked' && (
                            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 bg-gray-100 border border-gray-300 p-3 rounded-xl gap-3 shadow-sm">
                              <span className="text-gray-800 font-black text-sm flex items-center gap-1.5">
                                <i className="fas fa-user-lock text-rose-600"></i>
                                إجمالي الطلاب المحظورين: {toEasternArabic(displayList.length)}
                              </span>
                              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                <button 
                                  onClick={() => {
                                    const blockedToUnblock = displayList.filter(s => {
                                      const stRecord = studentsList[s.phone];
                                      const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                                      const matchedSt = stArr.find(student => student.name.trim() === (s.name || '').trim());
                                      return matchedSt && (matchedSt as any).isBlocked;
                                    });

                                    if (blockedToUnblock.length === 0) {
                                      showAlert('لا يوجد طلاب محظورين حالياً لفك حظرهم.');
                                      return;
                                    }

                                    showConfirm(`هل أنت متأكد من فك الحظر عن جميع الطلاب المحظورين في هذه القائمة (وعددهم ${toEasternArabic(blockedToUnblock.length)} طالب) دفعة واحدة؟\\nسيتمكن هؤلاء الطلاب من الدخول للتطبيق فوراً.`, async () => {
                                      setIsLoading(true);
                                      setStudentsList(prev => {
                                        const newList = { ...prev };
                                        blockedToUnblock.forEach(st => {
                                          if (newList[st.phone]) {
                                            const listArr = Array.isArray(newList[st.phone]) ? newList[st.phone] : [newList[st.phone]];
                                            newList[st.phone] = (listArr as Student[]).map(s => 
                                              s.name.trim() === (st.name || '').trim() ? { ...s, isBlocked: false } as unknown as Student : s
                                            );
                                          }
                                        });
                                        return newList;
                                      });
                                      
                                      try {
                                        const studentsPayload = blockedToUnblock.map(st => ({ phone: st.phone, name: st.name }));
                                        const res = await fetch(API_URL, { 
                                          method: 'POST', 
                                          body: JSON.stringify({ action: 'unblockMultipleStudents', students: studentsPayload, apiKey: SECRET_API_KEY }) 
                                        });
                                        const data = await res.json().catch(() => null);
                                        if (data && data.status === 'error' && data.message && data.message.includes('غير معروف')) {
                                          await Promise.all(studentsPayload.map(st => 
                                            fetch(API_URL, { 
                                              method: 'POST', 
                                              body: JSON.stringify({ action: 'unblockStudent', phone: st.phone, name: st.name, apiKey: SECRET_API_KEY }) 
                                            })
                                          ));
                                        }
                                      } catch(e) {}
                                      
                                      setIsLoading(false);
                                      showAlert('تم فك الحظر عن جميع الطلاب المحظورين بنجاح! 🔓✨');
                                    });
                                  }}
                                  className="flex-1 sm:flex-none bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-2 rounded-lg text-xs font-black shadow-sm flex justify-center items-center gap-2 transition-all active:scale-95 cursor-pointer"
                                >
                                  <i className="fas fa-unlock-alt"></i> فك الحظر الجماعي
                                </button>
                                <button 
                                  onClick={() => {
                                    if (displayList.length === 0) { showAlert('لا توجد أسماء لنسخها.'); return; }
                                    const text = displayList.map((s, idx) => `${idx + 1}- ${s.name}`).join('\\n');
                                    navigator.clipboard.writeText(text);
                                    showAlert('تم نسخ قائمة الأسماء بنجاح! يمكنك الآن لصقها في أي مكان.');
                                  }}
                                  className="flex-1 sm:flex-none bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-black shadow-sm flex justify-center items-center gap-2 transition-all active:scale-95 cursor-pointer"
                                >
                                  <i className="fas fa-copy"></i> نسخ الأسماء
                                </button>
                              </div>
                            </div>
                          )}
                          
                          {/* قائمة الطلاب في صفوف مدمجة بسطر واحد أنيق وسريع التصفح */}
                          {displayList.length > 0 ? (
                            <div className="grid grid-cols-1 gap-1.5">
                              {displayList.slice(0, adminResultsLimit).map((student, i) => {
                                const realTestCount = getCount(student);
                                
                                const stRecord = studentsList[student.phone];
                                const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                                const matchedSt = stArr.find(s => s.name.trim() === student.name.trim());
                                const isBlocked = matchedSt ? (matchedSt as any).isBlocked : false;
                                const gender = getStudentGender(student);
                                const isFemale = gender === 'female';

                                // حساب درجة الطالب في الدرس المحدد (إذا تم اختيار درس محدد من الفلتر)
                                const studentLessonScore = (() => {
                                  if (resultsLessonFilter === 'all') return null;
                                  if (!student.tests || student.tests.length === 0) return null;
                                  for (const t of student.tests) {
                                    if (isAmbiguousOldQuiz(t.quiz)) continue;
                                    if (t.quiz.includes('تصفير') || t.quiz.includes('فرصة جديدة') || String(t.score).includes('تصفير')) continue;
                                    const mappedTitle = matchQuizToCurrent(t.quiz, [resultsLessonFilter]);
                                    if (mappedTitle === resultsLessonFilter) {
                                      return normalizeScore(t.score);
                                    }
                                  }
                                  return null;
                                })();

                                return (
                                  <div 
                                    key={student.phone + '_' + student.name + '_' + i} 
                                    onClick={() => setSelectedStudentForAnalytics(student)}
                                    className={`group bg-white rounded-xl px-3 py-2 sm:py-2.5 border transition-all duration-150 hover:shadow-xs cursor-pointer relative overflow-hidden flex items-center justify-between gap-2 ${
                                      isBlocked 
                                        ? 'border-red-300 bg-red-50/20 hover:border-red-400' 
                                        : 'border-gray-200 hover:border-primary/50 hover:bg-blue-50/15'
                                    }`}
                                  >
                                    {/* شريط الإشارة الجانبي الملون */}
                                    <div className={`absolute top-0 bottom-0 right-0 w-1 transition-colors ${
                                      isBlocked ? 'bg-red-500' : isFemale ? 'bg-pink-400 group-hover:bg-pink-500' : 'bg-blue-500 group-hover:bg-blue-600'
                                    }`} />

                                    {/* بيانات الطالب في سطر واحد دون هاتف أو كود: الأفاتار، الاسم، شارة النوع، شارة الفئة، شارة الحظر */}
                                    <div className="flex items-center gap-2 min-w-0 pr-1.5 flex-1">
                                      {/* أيقونة مصغرة للنوع */}
                                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shadow-2xs shrink-0 ${
                                        isFemale 
                                          ? 'bg-pink-100 text-pink-700 border border-pink-200' 
                                          : 'bg-blue-100 text-blue-700 border border-blue-200'
                                      }`}>
                                        {isFemale ? '👧' : '👦'}
                                      </div>

                                      {/* اسم الطالب بخط عريض وواضح */}
                                      <h3 className="font-black text-xs sm:text-sm text-gray-900 truncate group-hover:text-primary transition-colors">
                                        {student.name}
                                      </h3>

                                      {/* شارة النوع المدمجة */}
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md hidden xs:inline-flex items-center shrink-0 ${
                                        isFemale ? 'bg-pink-50 text-pink-700 border border-pink-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                                      }`}>
                                        {isFemale ? 'أنثى' : 'ذكر'}
                                      </span>

                                      {/* شارة السنتر / الأونلاين */}
                                      {isStudentOnline(student) ? (
                                        <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded-md text-[10px] font-black shrink-0 hidden sm:inline-flex items-center gap-1">
                                          <i className="fas fa-globe text-emerald-600 text-[8px]"></i> أونلاين
                                        </span>
                                      ) : (
                                        <span className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-md text-[10px] font-black shrink-0 hidden sm:inline-flex items-center gap-1">
                                          <i className="fas fa-school text-amber-600 text-[8px]"></i> سنتر
                                        </span>
                                      )}

                                      {/* شارة الحظر */}
                                      {isBlocked && (
                                        <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-md text-[10px] font-black shadow-2xs shrink-0 flex items-center gap-1">
                                          <i className="fas fa-lock text-[8px]"></i> محظور
                                        </span>
                                      )}
                                    </div>

                                    {/* الجانب الأيسر: نتيجة الدرس المحدد أو عداد الاختبارات + زر التقرير السريع */}
                                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                      {/* في حال اختيار درس محدد من الفلتر: عرض نتيجة الطالب فيه */}
                                      {resultsLessonFilter !== 'all' ? (
                                        studentLessonScore !== null ? (
                                          <div className="px-2 sm:px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                            <i className="fas fa-check-circle text-emerald-600 text-[10px]"></i>
                                            <span>{toEasternArabic(studentLessonScore)}٪</span>
                                          </div>
                                        ) : (
                                          <div className="px-2 sm:px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200 flex items-center gap-1">
                                            <i className="fas fa-times-circle text-rose-500 text-[10px]"></i>
                                            <span>لم يحل</span>
                                          </div>
                                        )
                                      ) : (
                                        /* عداد الاختبارات العادي */
                                        <div className={`px-2 sm:px-2.5 py-1 rounded-lg font-black text-xs flex items-center gap-1 ${
                                          realTestCount === 0 
                                            ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                                            : realTestCount >= (activeUnitLessonsCount || 5) 
                                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                                              : 'bg-blue-50 text-blue-800 border border-blue-200'
                                        }`}>
                                          <i className={`fas ${realTestCount === 0 ? 'fa-ghost text-[10px]' : 'fa-check-circle text-[10px]'}`}></i>
                                          <span>
                                            {targetUnit 
                                              ? `${toEasternArabic(realTestCount)} / ${toEasternArabic(activeUnitLessonsCount)} اختبار`
                                              : realTestCount === 0 ? 'لم يتفاعل' : `${toEasternArabic(realTestCount)} اختبار`
                                            }
                                          </span>
                                        </div>
                                      )}

                                      {/* زر فتح الشاشة الإحصائية */}
                                      <button 
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedStudentForAnalytics(student);
                                        }}
                                        className="bg-primary/10 hover:bg-primary text-primary hover:text-white px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1 group-hover:bg-primary group-hover:text-white shadow-2xs active:scale-95 cursor-pointer"
                                        title="عرض التقرير الإحصائي وتنزيل الصورة"
                                      >
                                        <i className="fas fa-chart-pie text-[11px]"></i>
                                        <span className="hidden xs:inline">التقرير</span>
                                        <i className="fas fa-arrow-left text-[9px] transition-transform group-hover:-translate-x-0.5"></i>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-400 text-2xl mb-3">
                                <i className="fas fa-user-slash"></i>
                              </div>
                              <div className="text-gray-600 font-black text-base">لا توجد بيانات تطابق الفلترة المحددة</div>
                              <p className="text-xs text-gray-400 mt-1">جرب تغيير الفلتر أو البحث عن اسم أو هاتف آخر</p>
                            </div>
                          )}

                          {/* الشاشة الإحصائية المنبثقة للطالب المختار */}
                          {selectedStudentForAnalytics && (
                            <StudentAnalyticsModal
                              student={selectedStudentForAnalytics}
                              studentMeta={(() => {
                                const stRecord = studentsList[selectedStudentForAnalytics.phone];
                                const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                                return stArr.find(st => st.name.trim() === selectedStudentForAnalytics.name.trim()) || null;
                              })()}
                              units={data}
                              allValidLessons={currentValidLessons}
                              requiredLessonTitles={requiredCurrentTitles}
                              isStudentOnline={isStudentOnline(selectedStudentForAnalytics)}
                              onClose={() => setSelectedStudentForAnalytics(null)}
                              onResetDevice={handleResetDevice}
                              onBlockStudent={handleBlockStudent}
                              onUnblockStudent={handleUnblockStudent}
                              onGrantNewAttempt={handleGrantNewAttempt}
                              isDarkMode={isDarkMode}
                            />
                          )}

                          `{displayList.length > adminResultsLimit && (
                            <div className="flex flex-wrap justify-center items-center gap-3 pt-4 pb-2">
                              <button 
                                onClick={() => setAdminResultsLimit(prev => prev + 50)}
                                className="bg-primary/10 hover:bg-primary/20 text-primary font-black text-sm px-5 py-2.5 rounded-xl border border-primary/30 transition-all flex items-center gap-2 active:scale-95 shadow-sm"
                              >
                                <i className="fas fa-plus-circle"></i> عرض ٥٠ طالب إضافي (متبقي {toEasternArabic(displayList.length - adminResultsLimit)})
                              </button>
                              <button 
                                onClick={() => setAdminResultsLimit(displayList.length)}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs px-4 py-2.5 rounded-xl border border-gray-300 transition-all active:scale-95"
                              >
                                عرض الكل ({toEasternArabic(displayList.length)})
                              </button>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })()}
                  </div>
                </div>
              )}
              {adminActiveTab === 'lessons' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h2 className="text-xl font-black text-primary flex items-center gap-2">
                        <i className="fas fa-layer-group text-emerald-600"></i> إدارة تفعيل ونشر الدروس للطلاب
                      </h2>
                      <p className="text-xs text-gray-500 font-bold mt-1">
                        تحكم في إظهار أو إخفاء الدروس للاختبارات ولوحة الشرف بضغطة زر واحدة.
                      </p>
                    </div>
                    <button
                      onClick={handleSavePublishedLessons}
                      disabled={isSavingLessons}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm px-5 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 shrink-0"
                    >
                      <i className={isSavingLessons ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-up"}></i>
                      حفظ وتحديث للطلاب 🚀
                    </button>
                  </div>

                  <div className="p-4 space-y-6">
                    {/* إحصائيات سريعة للدروس */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-blue-600 font-bold block mb-1">إجمالي الدروس بالإكسيل</span>
                        <span className="text-xl font-black text-blue-800">{lessonStats.total}</span>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-emerald-600 font-bold block mb-1">الدروس المنشورة حالياً</span>
                        <span className="text-xl font-black text-emerald-800">{lessonStats.published}</span>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-amber-600 font-bold block mb-1">الدروس المخفية (مسودات)</span>
                        <span className="text-xl font-black text-amber-800">{lessonStats.hidden}</span>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-purple-600 font-bold block mb-1">الوحدات الدراسية</span>
                        <span className="text-xl font-black text-purple-800">{lessonStats.unitsCount}</span>
                      </div>
                    </div>

                    {/* قائمة الوحدات والدروس */}
                    <div className="space-y-4">
                      <div className="flex flex-wrap justify-between items-center gap-2 px-1">
                        <span className="text-sm font-black text-gray-700">اضغط على اسم الوحدة لفتح أو طي الدروس:</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setAdminExpandedUnits(data.map(u => u.id))}
                            className="text-xs font-bold px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl transition-all flex items-center gap-1.5 border border-blue-200"
                          >
                            <i className="fas fa-folder-open"></i> فتح الكل
                          </button>
                          <button
                            onClick={() => setAdminExpandedUnits([])}
                            className="text-xs font-bold px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl transition-all flex items-center gap-1.5 border border-gray-300"
                          >
                            <i className="fas fa-folder"></i> طي الكل
                          </button>
                        </div>
                      </div>

                      {data.map(unit => {
                        const unitLessonCount = unit.lessons.length;
                        const unitPublishedCount = unit.lessons.filter(l => isLessonActive(l.id)).length;
                        const isExpanded = adminExpandedUnits.includes(unit.id);

                        return (
                          <div key={unit.id} className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm transition-all">
                            <div 
                              onClick={() => toggleAdminUnit(unit.id)}
                              className="bg-gray-100/70 hover:bg-gray-100 px-4 py-3.5 border-b border-gray-200 flex flex-wrap justify-between items-center gap-2 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2.5">
                                <i className={`fas fa-chevron-${isExpanded ? 'up text-primary' : 'down text-gray-400'} text-sm transition-transform duration-200`}></i>
                                <span className="font-black text-base text-gray-800">{unit.title}</span>
                                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full font-bold">
                                  ({unitPublishedCount} من {unitLessonCount} منشور)
                                </span>
                              </div>
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => handleToggleUnitAll(unit.id, true)}
                                  className="text-xs font-bold px-3 py-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded-lg transition-colors"
                                >
                                  نشر كل الوحدة
                                </button>
                                <button
                                  onClick={() => handleToggleUnitAll(unit.id, false)}
                                  className="text-xs font-bold px-3 py-1 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-lg transition-colors"
                                >
                                  إخفاء كل الوحدة
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="p-3 divide-y divide-gray-100 animate-fade-in">
                                {unit.lessons.map(lesson => {
                                  const isPublished = isLessonActive(lesson.id);
                                  return (
                                    <div key={lesson.id} className="py-2.5 px-2 flex items-center justify-between hover:bg-gray-50 rounded-xl transition-colors">
                                      <div className="flex items-center gap-3">
                                        <span className={`w-3 h-3 rounded-full ${isPublished ? 'bg-emerald-500 shadow-sm' : 'bg-gray-300'}`}></span>
                                        <span className={`text-sm font-bold ${isPublished ? 'text-gray-900 font-black' : 'text-gray-400'}`}>
                                          {lesson.title}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-bold">({lesson.questions.length} سؤال)</span>
                                        {((lesson.pdfFiles && lesson.pdfFiles.length > 0) || !!lesson.pdf) && (
                                          <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] px-2 py-0.5 rounded-full font-black flex items-center gap-1 shadow-2xs shrink-0">
                                            <i className="fas fa-file-pdf text-rose-600"></i>
                                            <span>{toEasternArabic((lesson.pdfFiles && lesson.pdfFiles.length) || 1)} مذكرة PDF</span>
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2 flex-wrap">
                                        {/* زر إدارة وتعديل وحذف مذكرات PDF المستقل */}
                                        <button
                                          type="button"
                                          onClick={() => setSelectedLessonForPdf({ lesson, unitTitle: unit.title })}
                                          className={`text-xs font-black px-3.5 py-1.5 rounded-full border transition-all flex items-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer ${
                                            ((lesson.pdfFiles && lesson.pdfFiles.length > 0) || !!lesson.pdf)
                                              ? 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-600 hover:text-white'
                                              : 'bg-white text-gray-700 border-gray-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300'
                                          }`}
                                          title="إدارة وحذف مذكرات PDF ورفع ملفات جديدة للدرس"
                                        >
                                          <i className="fas fa-file-pdf text-rose-600"></i>
                                          <span>مذكرات PDF</span>
                                          {((lesson.pdfFiles && lesson.pdfFiles.length > 0) || !!lesson.pdf) && (
                                            <span className="bg-rose-600 text-white text-[9px] px-1.5 py-0.2 rounded-full font-black">
                                              {toEasternArabic((lesson.pdfFiles && lesson.pdfFiles.length) || 1)}
                                            </span>
                                          )}
                                        </button>

                                        {/* زر إعدادات النشر والامتحان */}
                                        <button
                                          type="button"
                                          onClick={() => setSelectedExamForConfig({ lesson, unitTitle: unit.title })}
                                          className="text-xs font-black px-3.5 py-1.5 rounded-full border border-indigo-200 text-indigo-700 bg-indigo-50/70 hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer"
                                          title="تخصيص درجات الامتحان، مواعيد الجدولة، وسياسة النشر والتصحيح"
                                        >
                                          <i className="fas fa-sliders-h text-indigo-500"></i>
                                          <span>إعدادات النشر</span>
                                        </button>

                                        {/* زر حالة النشر السريع */}
                                        <button
                                          type="button"
                                          onClick={() => handleToggleLesson(lesson.id)}
                                          className={`text-xs font-black px-4 py-1.5 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                                            isPublished
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300'
                                              : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300'
                                          }`}
                                          title={isPublished ? "الدرس منشور وظاهر للطلاب - انقر لإخفائه" : "الدرس مخفي - انقر لنشره"}
                                        >
                                          <i className={`fas ${isPublished ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                                          <span>{isPublished ? 'منشور (ظاهر للطالب)' : 'مخفي (مسودة)'}</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={handleSavePublishedLessons}
                        disabled={isSavingLessons}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm px-6 py-3 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2"
                      >
                        <i className={isSavingLessons ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-up"}></i>
                        حفظ ونشر التعديلات للطلاب 🚀
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedExamForConfig && (
                <ExamSettingsModal
                  lesson={selectedExamForConfig.lesson}
                  unitTitle={selectedExamForConfig.unitTitle}
                  isPublished={isLessonActive(selectedExamForConfig.lesson.id)}
                  onTogglePublish={(lessonId, shouldPublish) => {
                    const currentActive = isLessonActive(lessonId);
                    if (currentActive !== shouldPublish) {
                      handleToggleLesson(lessonId);
                    }
                  }}
                  onPreviewExam={(lesson, config) => {
                    setSandboxExam({ lesson, config });
                  }}
                  onSaveConfig={() => {
                    handleSyncExamConfigsToCloud(true);
                  }}
                  onClose={() => setSelectedExamForConfig(null)}
                  isDarkMode={isDarkMode}
                />
              )}

              {/* نافذة إدارة وتعديل وحذف مذكرات الـ PDF المخصصة والمستقلة */}
              {selectedLessonForPdf && (
                <LessonPdfManagerModal
                  lesson={selectedLessonForPdf.lesson}
                  unitTitle={selectedLessonForPdf.unitTitle}
                  onClose={() => setSelectedLessonForPdf(null)}
                  onUpdatePdf={(lessonId, newPdfUrl, updatedFiles) => {
                    setData(prevData => {
                      if (!prevData || !Array.isArray(prevData)) return prevData;
                      return prevData.map(unit => ({
                        ...unit,
                        lessons: (unit.lessons || []).map(les => {
                          if (les.id === lessonId) {
                            const files = updatedFiles || (newPdfUrl ? [{ url: newPdfUrl, name: `مذكرة ${les.title}` }] : []);
                            return { 
                              ...les, 
                              pdf: newPdfUrl || '',
                              pdfFiles: files
                            };
                          }
                          return les;
                        })
                      }));
                    });
                    setSelectedLessonForPdf(prev => {
                      if (!prev || prev.lesson.id !== lessonId) return prev;
                      const files = updatedFiles || (newPdfUrl ? [{ url: newPdfUrl, name: `مذكرة ${prev.lesson.title}` }] : []);
                      return {
                        ...prev,
                        lesson: {
                          ...prev.lesson,
                          pdf: newPdfUrl || '',
                          pdfFiles: files
                        }
                      };
                    });
                  }}
                  onViewPdf={(url, title) => {
                    setSelectedPdfForView({ title, url });
                  }}
                  isDarkMode={isDarkMode}
                />
              )}

              {sandboxExam && (
                <TeacherExamSandboxModal
                  lesson={sandboxExam.lesson}
                  config={sandboxExam.config}
                  onClose={() => setSandboxExam(null)}
                  isDarkMode={isDarkMode}
                />
              )}

              {adminActiveTab === 'schedules' && (
                <AdminExamScheduleTab
                  data={data}
                  isDarkMode={isDarkMode}
                  onNavigateToLessonConfig={(lesson, unitTitle) => {
                    setSelectedExamForConfig({ lesson, unitTitle });
                  }}
                  isLessonActive={(lessonId) => isLessonActive(lessonId)}
                  onSyncToCloud={handleSyncExamConfigsToCloud}
                  isSyncingToCloud={isSyncingExamConfigs}
                />
              )}

              {adminActiveTab === 'essay_review' && (
                <AdminEssayReviewTab
                  onSaveResultToDB={saveResultToDB}
                  isDarkMode={isDarkMode}
                  onlineStudents={adminOnlineStudents}
                  data={data}
                />
              )}

              {adminActiveTab === 'leaderboard' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h2 className="text-xl font-black text-primary flex items-center gap-2">
                        <i className="fas fa-trophy text-gold"></i> أوائل الكنز (لوحة الشرف الذكية)
                      </h2>
                      <p className="text-xs text-gray-500 font-bold mt-1">
                        شرط التأهل: إتمام الدروس المنشورة ({lessonStats.published} دروس) ومعدل ≥ 80% (الذهبية ≥ 90%).
                      </p>
                    </div>
                    <button
                      onClick={() => setAdminActiveTab('lessons')}
                      className="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center gap-1.5"
                    >
                      <i className="fas fa-sliders-h"></i> تعديل الدروس المشروطة
                    </button>
                  </div>
                  <div className="p-4 space-y-3">
                    {(() => {
                      const list = adminLeaderboardList;
                      if (list.length === 0) return <div className="text-center py-6 text-gray-500 font-bold">لا يوجد أبطال مؤهلين في القوائم حالياً.</div>;
                      
                      return list.map((st, idx) => {
                        const prevTier = idx > 0 ? list[idx - 1].tier : '';
                        const showHeader = st.tier !== prevTier;
                        const isGold = st.tier === 'gold';
                        const isSilver = st.tier === 'silver';
                        const isBronze = st.tier === 'bronze';
                        
                        return (
                          <React.Fragment key={idx}>
                            {showHeader && isGold && (
                              <div className="flex flex-col items-center mt-2 mb-2 gap-2">
                                <div className="text-center font-black text-gold text-lg">🏆 القائمة الذهبية (أول ١٠ أبطال) 🏆</div>
                                <button onClick={() => handleAdminCongratulateTier('gold')} className="bg-emerald-100 text-emerald-800 text-xs font-black py-1.5 px-4 rounded-full border border-emerald-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fab fa-whatsapp"></i> تهنئة القائمة عبر واتساب</button>
                              </div>
                            )}
                            {showHeader && isSilver && (
                              <div className="flex flex-col items-center mt-4 mb-2 gap-2">
                                <div className="text-center font-black text-slate-500 text-lg">🥈 القائمة الفضية (من ١١ إلى ٢٠) 🥈</div>
                                <button onClick={() => handleAdminCongratulateTier('silver')} className="bg-emerald-100 text-emerald-800 text-xs font-black py-1.5 px-4 rounded-full border border-emerald-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fab fa-whatsapp"></i> تهنئة القائمة عبر واتساب</button>
                              </div>
                            )}
                            {showHeader && isBronze && (
                              <div className="flex flex-col items-center mt-4 mb-2 gap-2">
                                <div className="text-center font-black text-orange-600 text-lg">🥉 القائمة البرونزية (من ٢١ إلى ٣٠) 🥉</div>
                                <button onClick={() => handleAdminCongratulateTier('bronze')} className="bg-emerald-100 text-emerald-800 text-xs font-black py-1.5 px-4 rounded-full border border-emerald-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fab fa-whatsapp"></i> تهنئة القائمة عبر واتساب</button>
                              </div>
                            )}
                            
                            <div className={`flex items-center justify-between p-3 rounded-xl border-2 ${isGold ? 'bg-amber-50 border-gold' : isSilver ? 'bg-slate-50 border-slate-300' : 'bg-orange-50 border-orange-300'}`}>
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="relative shrink-0">
                                  {isGold && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px]"><i className="fas fa-crown text-amber-500 drop-shadow-sm"></i></div>}
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${isGold ? 'bg-gold text-white' : isSilver ? 'bg-slate-400 text-white' : 'bg-orange-600 text-white'}`}>
                                    {idx + 1}
                                  </div>
                                </div>
                                <div className="flex flex-col items-start truncate min-w-0 pr-1">
                                  <span className="font-black text-sm text-gray-800 truncate max-w-[150px] sm:max-w-[200px]" title={st.name}>{st.name}</span>
                                  <span className="text-[10px] font-bold text-gray-500">{toEasternArabic(st.testsCount)} اختبارات | {toEasternArabic(st.score)} نقطة</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="flex flex-col items-center justify-center w-6">
                                  {st.trend === 'up' && <i className="fas fa-arrow-trend-up text-emerald-500 animate-bounce text-lg" title="مستوى صاعد"></i>}
                                  {st.trend === 'down' && <i className="fas fa-arrow-trend-down text-rose-500 animate-pulse text-lg" title="مستوى هابط"></i>}
                                  {st.trend === 'flat' && <i className="fas fa-minus text-gray-400 text-sm" title="مستوى مستقر"></i>}
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
              {adminActiveTab === 'certificates' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div>
                        <h2 className="text-xl font-black text-primary flex items-center gap-2">
                          <i className="fas fa-award text-gold text-2xl"></i>
                          <span>متابعة شهادات التقدير</span>
                        </h2>
                        <p className="text-xs text-gray-500 font-bold mt-0.5">
                          توليد وتحميل شهادات تفوق الدروس، إتمام الوحدات، والامتحانات الشاملة
                        </p>
                      </div>

                      {/* زر التحميل الجماعي دفعة واحدة */}
                      {calculateAdminCertificates().length > 0 && (
                        <button
                          onClick={() => handleDownloadAllAdminCerts(calculateAdminCertificates())}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-black shadow-md transition-all active:scale-95 flex items-center gap-2 cursor-pointer shrink-0"
                          title="تحميل جميع شهادات القائمة الحالية دفعة واحدة كصور"
                        >
                          <i className="fas fa-download"></i>
                          <span>تحميل كل الشهادات ({toEasternArabic(calculateAdminCertificates().length)}) دفعة واحدة</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs font-black text-gray-700 whitespace-nowrap flex items-center gap-1.5">
                        <i className="fas fa-filter text-primary"></i> تصفية نوع واختيار الشهادة:
                      </label>
                      <select 
                        value={adminSelectedUnit} 
                        onChange={(e) => setAdminSelectedUnit(e.target.value)}
                        className="border border-gray-300 rounded-xl px-3 py-2 font-bold text-gray-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary text-xs sm:text-sm bg-white shadow-xs flex-1 min-w-[260px] cursor-pointer"
                      >
                        <option value="all">📁 جميع شهادات إتمام الوحدات المؤهلة (عرض شامل)</option>
                        
                        <optgroup label="🏆 شهادات إتمام الوحدات بالكامل">
                          {data.filter(u => u.lessons.length > 0).map(u => {
                            const isComp = certSettings.unitCompletedStatus[u.id] ?? false;
                            const exp = certSettings.unitExpectedLessons[u.id] || u.lessons.length;
                            return (
                              <option key={`unit_${u.id}`} value={`unit_${u.id}`}>
                                إتمام {u.title} ({toEasternArabic(exp)} دروس متوقعة {isComp ? '• 🏆 مكتملة' : '• ⏳ قيد النشر'})
                              </option>
                            );
                          })}
                        </optgroup>

                        <optgroup label="📝 شهادات تفوق الدروس الفردية">
                          {data.flatMap(u => u.lessons.map(l => (
                            <option key={`lesson_${l.id}`} value={`lesson_${l.id}`}>
                              {u.title} ⬅️ {l.title}
                            </option>
                          )))}
                        </optgroup>

                        {/* الامتحانات الشاملة */}
                        {(() => {
                          const compLessons = data.flatMap(u => u.lessons).filter(l => 
                            certSettings.comprehensiveExamsConfig[l.id]?.isComprehensive || 
                            l.title.includes('شامل') || 
                            l.title.includes('تراكمي')
                          );
                          if (compLessons.length === 0) return null;
                          return (
                            <optgroup label="🎯 شهادات الامتحانات الشاملة">
                              {compLessons.map(cl => (
                                <option key={`comp_${cl.id}`} value={`comp_${cl.id}`}>
                                  امتحان شامل: {cl.title}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })()}
                      </select>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {(() => {
                      if (!adminSelectedUnit) return <div className="text-center py-6 text-gray-500 font-bold">الرجاء اختيار قسم لعرض الحاصلين على الشهادة.</div>;
                      
                      const list = calculateAdminCertificates();
                      if (list.length === 0) {
                        return (
                          <div className="text-center py-8 text-gray-500 font-bold bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                            <i className="fas fa-award text-gray-300 text-3xl block mb-2"></i>
                            لا توجد شهادات مؤهلة في هذا الاختيار حالياً (الحد الأدنى المطلوب: {toEasternArabic(certSettings.minCertScore)}٪).
                          </div>
                        );
                      }
                      
                      return list.map((st, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl border border-blue-200 bg-blue-50/80 hover:bg-blue-50 transition-colors">
                          <div className="flex items-center gap-3 min-w-0 pr-1">
                            <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-xs border border-blue-200 text-gold text-lg shrink-0">
                              <i className={`fas ${st.certType === 'comprehensive' ? 'fa-crown text-purple-600' : st.certType === 'lesson' ? 'fa-medal text-emerald-600' : 'fa-trophy text-gold'}`}></i>
                            </span>
                            <div className="flex flex-col items-start truncate min-w-0">
                              <span className="font-black text-sm text-gray-900 truncate max-w-[150px] sm:max-w-[260px]" title={st.name}>{st.name}</span>
                              <span className="text-[11px] font-bold text-blue-700 flex items-center gap-1.5 flex-wrap">
                                <span className="bg-white px-2 py-0.5 rounded border border-blue-200 text-emerald-700 font-black">
                                  %{toEasternArabic(st.avg)}
                                </span>
                                <span>{st.certType === 'lesson' ? '📝 تفوق في درس' : st.certType === 'comprehensive' ? '🎯 امتحان شامل' : '🏆 إتمام وحدة'}:</span>
                                <span className="text-gray-600 truncate">{st.unitTitle}</span>
                              </span>
                            </div>
                          </div>
                          <button 
                            onClick={() => handleDownloadAdminCert(st.name, st.unitTitle, st.avg, st.certType)} 
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-xs font-black shadow-sm transition-all active:scale-95 shrink-0 flex items-center gap-1.5 cursor-pointer"
                            title="تحميل الشهادة كصورة PNG عالية الجودة"
                          >
                            <i className="fas fa-download"></i>
                            <span>شهادة</span>
                          </button>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
              {(adminActiveTab === 'online' || adminActiveTab === 'requests') && (
                <div className="space-y-6 animate-fade-in" dir="rtl">
                  {/* شريط العنوان الترحيبي والإجراءات العلوية */}
                  <div className="bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-900 text-white p-5 sm:p-6 rounded-3xl shadow-xl border border-emerald-500/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-emerald-400/20 text-emerald-300 text-xs px-3 py-1 rounded-full font-black border border-emerald-400/30 flex items-center gap-1.5 shadow-sm">
                          <i className="fas fa-shield-alt text-emerald-400"></i> نظام الأونلاين المستقل والمحمي
                        </span>
                        <span className="text-xs text-emerald-200 font-bold hidden sm:inline">أكواد مشفرة (A5678ESON) | عزل تام عن السنتر</span>
                      </div>
                      <h2 className="text-xl sm:text-2xl font-black flex items-center gap-2.5">
                        <i className="fas fa-globe text-emerald-300"></i> إدارة مشتركي الأونلاين
                      </h2>
                      <p className="text-xs sm:text-sm text-emerald-100/90 mt-1.5 max-w-2xl leading-relaxed">
                        لوحة تحكم مركزية لطلاب المنصة عن بُعد: تفعيل فوري، تجديد الباقات، تعديل البيانات، فك ارتباط الأجهزة، وإرسال بيانات الدخول عبر واتساب بنقرة واحدة.
                      </p>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0">
                      <button
                        onClick={() => setShowManualOnlineModal(true)}
                        className="flex-1 md:flex-none bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-95 text-xs sm:text-sm cursor-pointer"
                      >
                        <i className="fas fa-user-plus text-base"></i> إضافة طالب أونلاين
                      </button>
                      <button
                        onClick={fetchAdminData}
                        disabled={isLoading}
                        className="bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold px-3 py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 text-xs cursor-pointer active:scale-95"
                        title="تحديث البيانات من السيرفر"
                      >
                        <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}></i>
                        <span className="hidden sm:inline">تحديث</span>
                      </button>
                    </div>
                  </div>

                  {/* كروت الإحصائيات الأربعة (KPIs) */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {/* المشتركون المعتمدون */}
                    <div 
                      onClick={() => setOnlineSubTab('active')}
                      className={`p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                        onlineSubTab === 'active' ? 'bg-emerald-50/90 border-emerald-500 shadow-md ring-2 ring-emerald-400/40' : 'bg-white border-gray-100 hover:border-emerald-200 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-600">المشتركون المعتمدون</span>
                        <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-black">
                          <i className="fas fa-user-check"></i>
                        </div>
                      </div>
                      <div className="text-2xl font-black text-emerald-950">{adminOnlineStudents.length}</div>
                      <div className="text-[10px] text-emerald-700 font-bold mt-1">حسابات نشطة بالمنصة</div>
                    </div>

                    {/* طلبات الاشتراك المعلقة */}
                    <div 
                      onClick={() => setOnlineSubTab('pending')}
                      className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative ${
                        onlineSubTab === 'pending' ? 'bg-amber-50/90 border-amber-500 shadow-md ring-2 ring-amber-400/40' : 'bg-white border-gray-100 hover:border-amber-200 shadow-xs'
                      }`}
                    >
                      {adminPendingReqs.length > 0 && (
                        <span className="absolute -top-1.5 -left-1.5 bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                          جديد
                        </span>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-600">طلبات معلقة</span>
                        <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-black">
                          <i className="fas fa-clock"></i>
                        </div>
                      </div>
                      <div className="text-2xl font-black text-amber-950">{adminPendingReqs.length}</div>
                      <div className="text-[10px] text-amber-700 font-bold mt-1">بانتظار الاعتماد وتوليد الكود</div>
                    </div>

                    {/* باقات قاربت أو انتهت */}
                    {(() => {
                      const expiringOrExpired = adminOnlineStudents.filter(st => {
                        const s = getOnlineSubscriptionStatus(st).status;
                        return s === 'expired' || s === 'expiring';
                      }).length;
                      return (
                        <div 
                          onClick={() => setOnlineSubTab('active')}
                          className="p-4 rounded-2xl border-2 bg-white border-gray-100 hover:border-orange-200 shadow-xs transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-black text-gray-600">تجديد مطلوب / يوشك</span>
                            <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-black">
                              <i className="fas fa-bell"></i>
                            </div>
                          </div>
                          <div className="text-2xl font-black text-orange-950">{expiringOrExpired}</div>
                          <div className="text-[10px] text-orange-700 font-bold mt-1">يحتاجون رسائل تذكير للتجديد</div>
                        </div>
                      );
                    })()}

                    {/* إجمالي المحصل */}
                    {(() => {
                      const totalIncome = adminOnlineStudents.reduce((sum, s) => {
                        const val = parseFloat(String(s.amount || '0').replace(/[^\d.]/g, ''));
                        return sum + (isNaN(val) ? 0 : val);
                      }, 0);
                      return (
                        <div className="p-4 rounded-2xl border-2 bg-white border-gray-100 shadow-xs">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-black text-gray-600">إجمالي الدخل المحصل</span>
                            <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-black">
                              <i className="fas fa-coins"></i>
                            </div>
                          </div>
                          <div className="text-2xl font-black text-teal-950">{toEasternArabic(totalIncome)} <span className="text-xs font-bold text-teal-700">ج.م</span></div>
                          <div className="text-[10px] text-teal-700 font-bold mt-1">من اشتراكات الأونلاين المسددة</div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* شريط التبويبات الفرعية الثلاثية */}
                  <div className="flex items-center gap-2 bg-gray-100/90 p-1.5 rounded-2xl border border-gray-200">
                    <button
                      onClick={() => setOnlineSubTab('active')}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 ${
                        onlineSubTab === 'active'
                          ? 'bg-emerald-700 text-white shadow-md'
                          : 'text-gray-700 hover:bg-white/60 hover:text-gray-900'
                      }`}
                    >
                      <i className="fas fa-user-check"></i>
                      <span>المشتركون المعتمدون</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        onlineSubTab === 'active' ? 'bg-emerald-800 text-emerald-100' : 'bg-gray-200 text-gray-700'
                      }`}>
                        {adminOnlineStudents.length}
                      </span>
                    </button>

                    <button
                      onClick={() => setOnlineSubTab('pending')}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 relative ${
                        onlineSubTab === 'pending'
                          ? 'bg-amber-600 text-white shadow-md'
                          : 'text-gray-700 hover:bg-white/60 hover:text-gray-900'
                      }`}
                    >
                      <i className="fas fa-user-clock"></i>
                      <span>طلبات الاشتراك المعلقة</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        onlineSubTab === 'pending' ? 'bg-amber-700 text-amber-100' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {adminPendingReqs.length}
                      </span>
                    </button>

                    <button
                      onClick={() => setOnlineSubTab('archive')}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 ${
                        onlineSubTab === 'archive'
                          ? 'bg-gray-800 text-white shadow-md'
                          : 'text-gray-700 hover:bg-white/60 hover:text-gray-900'
                      }`}
                    >
                      <i className="fas fa-archive"></i>
                      <span>أرشيف المشتركين</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        onlineSubTab === 'archive' ? 'bg-gray-900 text-gray-200' : 'bg-gray-200 text-gray-700'
                      }`}>
                        {adminArchivedOnlineStudents.length}
                      </span>
                    </button>
                  </div>

                  {/* ========================================================================= */}
                  {/* التبويب الفرعي 1: المشتركون الأونلاين المعتمدون                           */}
                  {/* ========================================================================= */}
                  {onlineSubTab === 'active' && (
                    <div className="bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100">
                      <div className="bg-emerald-50/80 px-5 py-4 border-b border-emerald-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-emerald-950 flex items-center gap-2">
                            <i className="fas fa-id-card text-emerald-600"></i> قائمة المشتركين النشطين
                            <span className="bg-emerald-200 text-emerald-900 text-xs px-2.5 py-0.5 rounded-full font-bold">
                              {adminOnlineStudents.length} مشترك
                            </span>
                          </h3>
                          <p className="text-xs text-emerald-700 mt-0.5">بيانات المشتركين محفوظة ومؤمّنة ولا تتأثر بمزامنات السنتر السحابية إطلاقاً.</p>
                        </div>
                        
                        {/* مربع البحث */}
                        <div className="w-full sm:w-72 relative">
                          <input
                            type="text"
                            placeholder="بحث بالاسم أو الهاتف أو الكود أو الباقة..."
                            value={onlineSearchTerm}
                            onChange={(e) => setOnlineSearchTerm(e.target.value)}
                            className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 pr-8 shadow-xs"
                          />
                          <i className="fas fa-search absolute right-2.5 top-3 text-emerald-600 text-xs"></i>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-right">
                          <thead className="bg-gray-50 text-gray-600 text-xs font-black border-b border-gray-200">
                            <tr>
                              <th className="p-3.5">كود الطالب</th>
                              <th className="p-3.5">اسم الطالب</th>
                              <th className="p-3.5">رقم الهاتف</th>
                              <th className="p-3.5">نوع الباقة</th>
                              <th className="p-3.5">حالة الاشتراك</th>
                              <th className="p-3.5">الشهور المفعلة</th>
                              <th className="p-3.5 text-center">المسدد</th>
                              <th className="p-3.5 text-center">إجراءات المتابعة والتحكم</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                            {(() => {
                              const filtered = adminOnlineStudents.filter(st => {
                                if (!onlineSearchTerm.trim()) return true;
                                const term = onlineSearchTerm.trim().toLowerCase();
                                return (st.name && st.name.toLowerCase().includes(term)) ||
                                       (st.phone && st.phone.includes(term)) ||
                                       (st.code && st.code.toLowerCase().includes(term)) ||
                                       (st.packageType && st.packageType.toLowerCase().includes(term)) ||
                                       (st.activeMonths && st.activeMonths.toLowerCase().includes(term));
                              });

                              if (filtered.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={8} className="text-center p-12 text-gray-400 font-bold">
                                      <i className="fas fa-user-friends text-4xl text-gray-300 mb-2 block"></i>
                                      {adminOnlineStudents.length === 0 ? 'لم يتم تفعيل أي طالب أونلاين حتى الآن.' : 'لا توجد نتائج مطابقة لمعايير البحث.'}
                                    </td>
                                  </tr>
                                );
                              }

                              return filtered.map((st, idx) => {
                                const subStatus = getOnlineSubscriptionStatus(st);
                                return (
                                  <tr key={idx} className="hover:bg-emerald-50/30 transition-colors">
                                    {/* كود الدخول */}
                                    <td className="p-3.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-mono font-black text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-lg text-xs" dir="ltr">
                                          {st.code}
                                        </span>
                                        <button
                                          onClick={() => {
                                            navigator.clipboard.writeText(st.code);
                                            setCopiedCodePhone(st.phone);
                                            setTimeout(() => setCopiedCodePhone(''), 2000);
                                          }}
                                          title="نسخ الكود"
                                          className="text-gray-400 hover:text-emerald-600 text-xs p-1 cursor-pointer"
                                        >
                                          {copiedCodePhone === st.phone ? <i className="fas fa-check text-emerald-600"></i> : <i className="far fa-copy"></i>}
                                        </button>
                                      </div>
                                    </td>

                                    {/* اسم الطالب */}
                                    <td className="p-3.5 font-black text-gray-900 whitespace-nowrap">{st.name}</td>

                                    {/* الهاتف */}
                                    <td className="p-3.5 font-bold text-gray-700 whitespace-nowrap" dir="ltr">
                                      <a 
                                        href={`https://wa.me/${formatWhatsAppPhone(st.phone)}`} 
                                        target="_blank" 
                                        rel="noreferrer"
                                        className="text-emerald-700 hover:underline flex items-center gap-1"
                                        title="محادثة واتساب مباشرة"
                                      >
                                        <i className="fab fa-whatsapp text-emerald-600"></i> {st.phone}
                                      </a>
                                    </td>

                                    {/* نوع الباقة */}
                                    <td className="p-3.5 font-bold whitespace-nowrap">
                                      <span className="inline-block bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-0.5 rounded-md text-xs font-black">
                                        {st.packageType || 'شهري'}
                                      </span>
                                    </td>

                                    {/* حالة الاشتراك */}
                                    <td className="p-3.5 whitespace-nowrap">
                                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black border ${subStatus.color}`}>
                                        {subStatus.label}
                                      </span>
                                    </td>

                                    {/* الشهور المفعلة */}
                                    <td className="p-3.5 text-xs font-bold text-gray-600 max-w-[160px] truncate" title={st.activeMonths}>
                                      {st.activeMonths || '—'}
                                    </td>

                                    {/* المبلغ المسدد */}
                                    <td className="p-3.5 text-center font-black text-teal-800 whitespace-nowrap">
                                      {st.amount ? `${toEasternArabic(st.amount)} ج.م` : '—'}
                                    </td>

                                    {/* إجراءات التحكم */}
                                    <td className="p-3.5 text-center whitespace-nowrap">
                                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                        {/* زر تجديد الباقة */}
                                        <button
                                          onClick={() => {
                                            setSelectedOnlineForRenewal(st);
                                            setRenewalPackage(st.packageType?.includes('ترم') ? (st.packageType as any) : 'شهري');
                                            setRenewalMonth('نوفمبر');
                                            setRenewalAmount('50');
                                          }}
                                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg text-xs font-black shadow-xs transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                          title="تجديد الاشتراك وإضافة شهور جديدة"
                                        >
                                          <i className="fas fa-rotate"></i> تجديد
                                        </button>

                                        {/* زر تعديل البيانات */}
                                        <button
                                          onClick={() => {
                                            setSelectedOnlineForEdit(st);
                                            setEditOnlineName(st.name);
                                            setEditOnlinePhone(st.phone);
                                            setEditOnlinePackage(st.packageType || 'شهري');
                                            setEditOnlineAmount(st.amount || '50');
                                          }}
                                          className="bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-300 px-2 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                          title="تعديل الاسم أو الهاتف أو الباقة"
                                        >
                                          <i className="fas fa-pen text-[10px]"></i>
                                        </button>

                                        {/* زر فك ارتباط الجهاز */}
                                        <button
                                          onClick={() => handleResetOnlineDevice(st)}
                                          className="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-2 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                          title="فك ارتباط الجهاز القديم وتمكين الطالب من الدخول من هاتف/كمبيوتر جديد"
                                        >
                                          <i className="fas fa-mobile-screen text-[10px]"></i> فك الجهاز
                                        </button>

                                        {/* زر إرسال كود وبيانات الدخول واتساب */}
                                        <button
                                          onClick={() => sendWhatsAppStudentWelcome(st.phone, st.name, st.code, st.packageType || 'الاشتراك')}
                                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded-lg text-xs font-black shadow-xs transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                          title="إرسال رسالة الترحيب وكود الدخول عبر واتساب"
                                        >
                                          <i className="fab fa-whatsapp"></i> الكود
                                        </button>

                                        {/* زر إرسال تذكرة التجديد واتساب */}
                                        <button
                                          onClick={() => sendWhatsAppRenewalReminder(st.phone, st.name, st.packageType || 'الاشتراك')}
                                          className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded-lg text-xs font-black shadow-xs transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                          title="إرسال رسالة تذكير بتجديد الاشتراك"
                                        >
                                          <i className="fas fa-bell"></i>
                                        </button>

                                        {/* زر إلغاء الاشتراك ونقله للأرشيف */}
                                        <button
                                          onClick={() => handleCancelOnlineSubscription(st)}
                                          className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                          title="إلغاء الاشتراك ونقل الطالب للأرشيف"
                                        >
                                          <i className="fas fa-trash-alt text-[10px]"></i>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ========================================================================= */}
                  {/* التبويب الفرعي 2: طلبات الاشتراك المعلقة                                   */}
                  {/* ========================================================================= */}
                  {onlineSubTab === 'pending' && (
                    <div className="bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100">
                      <div className="bg-amber-50/80 px-6 py-4 border-b border-amber-200 flex justify-between items-center">
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-amber-950 flex items-center gap-2">
                            <i className="fas fa-clock text-amber-600"></i> طلبات الاشتراك الواردة من شاشة التسجيل
                            <span className="bg-amber-200 text-amber-900 text-xs px-2.5 py-0.5 rounded-full font-bold">
                              {adminPendingReqs.length} طلب
                            </span>
                          </h3>
                          <p className="text-xs text-amber-800 mt-0.5">راجع تحويلات فودافون كاش أو إنستاباي، واعتمد الطالب ليحصل فوراً على كوده وباقته.</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-right">
                          <thead className="bg-gray-50 text-gray-600 text-xs font-black border-b border-gray-200">
                            <tr>
                              <th className="p-4">التاريخ</th>
                              <th className="p-4">اسم الطالب</th>
                              <th className="p-4">رقم الهاتف (واتساب)</th>
                              <th className="p-4">طريقة التحويل</th>
                              <th className="p-4 text-center">الإجراءات</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                            {adminPendingReqs.map((req, i) => (
                              <tr key={i} className="hover:bg-amber-50/30 transition-colors">
                                <td className="p-4 text-xs text-gray-500 whitespace-nowrap">{req.date}</td>
                                <td className="p-4 font-black text-gray-900 whitespace-nowrap">{req.name}</td>
                                <td className="p-4 font-bold text-gray-700 whitespace-nowrap" dir="ltr">
                                  <a 
                                    href={`https://wa.me/${formatWhatsAppPhone(req.phone)}`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="text-emerald-700 hover:underline flex items-center gap-1"
                                  >
                                    <i className="fab fa-whatsapp text-emerald-600"></i> {req.phone}
                                  </a>
                                </td>
                                <td className="p-4 whitespace-nowrap">
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black ${req.method.includes('كاش') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>
                                    {req.method}
                                  </span>
                                </td>
                                <td className="p-4 text-center whitespace-nowrap">
                                  <div className="flex gap-2 justify-center">
                                    <button
                                      onClick={() => handleOpenActivationModal(req)}
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-black shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <i className="fas fa-check-circle"></i> تفعيل واختيار باقة
                                    </button>
                                    <button
                                      onClick={() => handleRejectSubscription(req.phone, req.name)}
                                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                    >
                                      <i className="fas fa-trash-alt"></i> رفض
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {adminPendingReqs.length === 0 && (
                              <tr>
                                <td colSpan={5} className="text-center p-12 text-gray-400 font-bold">
                                  <i className="fas fa-check-double text-4xl text-emerald-400 mb-2 block"></i>
                                  لا توجد أي طلبات اشتراك معلقة حالياً. جميع الطلبات معتمدة!
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ========================================================================= */}
                  {/* التبويب الفرعي 3: أرشيف المشتركين (المحذوفين والمعلقين)                     */}
                  {/* ========================================================================= */}
                  {onlineSubTab === 'archive' && (
                    <div className="bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100">
                      <div className="bg-gray-100 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
                            <i className="fas fa-archive text-gray-600"></i> أرشيف مشتركي الأونلاين
                            <span className="bg-gray-200 text-gray-800 text-xs px-2.5 py-0.5 rounded-full font-bold">
                              {adminArchivedOnlineStudents.length} طالب
                            </span>
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">سجل محفوظ للطلاب الذين تم إيقاف أو إلغاء اشتراكهم، مع إمكانية استعادة وتفعيل أي طالب فوراً.</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-right">
                          <thead className="bg-gray-50 text-gray-600 text-xs font-black border-b border-gray-200">
                            <tr>
                              <th className="p-4">كود الطالب</th>
                              <th className="p-4">اسم الطالب</th>
                              <th className="p-4">رقم الهاتف</th>
                              <th className="p-4">الباقة السابقة</th>
                              <th className="p-4">سبب الإيقاف / الأرشفة</th>
                              <th className="p-4 text-center">الإجراء</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                            {adminArchivedOnlineStudents.map((st, i) => (
                              <tr key={i} className="hover:bg-gray-50 transition-colors">
                                <td className="p-4 font-mono font-bold text-gray-600 text-xs" dir="ltr">{st.code || '—'}</td>
                                <td className="p-4 font-black text-gray-800 whitespace-nowrap">{st.name}</td>
                                <td className="p-4 font-bold text-gray-600 whitespace-nowrap" dir="ltr">{st.phone}</td>
                                <td className="p-4 text-xs font-bold text-gray-600 whitespace-nowrap">{st.packageType || 'شهري'}</td>
                                <td className="p-4 text-xs text-rose-700 font-bold max-w-[200px] truncate" title={st.reason || st.notes}>
                                  {st.reason || st.notes || 'إلغاء اشتراك'}
                                </td>
                                <td className="p-4 text-center whitespace-nowrap">
                                  <button
                                    onClick={() => handleRestoreArchivedOnlineStudent(st)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-black shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer mx-auto"
                                    title="استعادة الطالب وإعادة تفعيل حسابه بالمنصة"
                                  >
                                    <i className="fas fa-rotate-left"></i> استعادة وتفعيل
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {adminArchivedOnlineStudents.length === 0 && (
                              <tr>
                                <td colSpan={6} className="text-center p-12 text-gray-400 font-bold">
                                  <i className="fas fa-box-open text-4xl text-gray-300 mb-2 block"></i>
                                  الأرشيف فارغ حالياً. لم يتم أرشفة أي طالب.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ========================================================================= */}
                  {/* مودال تجديد باقة الأونلاين                                                 */}
                  {/* ========================================================================= */}
                  {selectedOnlineForRenewal && (
                    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir="rtl">
                      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-right">
                        <div className="flex justify-between items-center border-b pb-3">
                          <h3 className="text-lg font-black text-indigo-900 flex items-center gap-2">
                            <i className="fas fa-rotate text-indigo-600"></i> تجديد اشتراك أونلاين
                          </h3>
                          <button onClick={() => setSelectedOnlineForRenewal(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer">✕</button>
                        </div>

                        {/* بطاقة معلومات الطالب الحالية */}
                        <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 space-y-1.5 text-xs sm:text-sm">
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">الطالب:</span><span className="font-black text-gray-900">{selectedOnlineForRenewal.name}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">رقم الهاتف:</span><span className="font-bold text-gray-900" dir="ltr">{selectedOnlineForRenewal.phone}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">كود الدخول:</span><span className="font-mono font-black text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200" dir="ltr">{selectedOnlineForRenewal.code}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">الشهور المفعلة حالياً:</span><span className="font-bold text-emerald-700">{selectedOnlineForRenewal.activeMonths || '—'}</span></div>
                        </div>

                        {/* اختيار باقة التجديد */}
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-2">اختر باقة التجديد:</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'شهري', title: 'تجديد شهر إضافي', defaultAmt: '50' },
                              { id: 'ترم أول', title: 'الترم الأول كاملاً', defaultAmt: '150' },
                              { id: 'ترم ثانٍ', title: 'الترم الثاني كاملاً', defaultAmt: '150' },
                              { id: 'سنة كاملة', title: 'العام كاملاً', defaultAmt: '250' }
                            ].map(pkg => (
                              <button
                                key={pkg.id}
                                type="button"
                                onClick={() => {
                                  setRenewalPackage(pkg.id as any);
                                  setRenewalAmount(pkg.defaultAmt);
                                }}
                                className={`p-2.5 rounded-xl border-2 text-right transition-all cursor-pointer ${
                                  renewalPackage === pkg.id 
                                    ? 'border-indigo-600 bg-indigo-50 text-indigo-950 font-black shadow-xs ring-2 ring-indigo-400/40' 
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 font-bold'
                                }`}
                              >
                                <div className="text-xs font-black">{pkg.title}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* اختيار الشهر في حالة التجديد الشهري */}
                        {renewalPackage === 'شهري' && (
                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-1">الشهر الإضافي المراد تفعيله:</label>
                            <select
                              value={renewalMonth}
                              onChange={(e) => setRenewalMonth(e.target.value)}
                              className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold bg-white text-gray-800 outline-none focus:border-indigo-600"
                            >
                              {["أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو"].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* المبلغ المسدد للتجديد */}
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">المبلغ المحصل للتجديد (جنيه):</label>
                          <input
                            type="number"
                            value={renewalAmount}
                            onChange={(e) => setRenewalAmount(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-600 text-gray-800"
                            placeholder="50"
                          />
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleRenewOnlineStudent}
                            disabled={isRenewingOnline}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-sm"
                          >
                            {isRenewingOnline ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-check"></i> تأكيد التجديد وتحديث الشهور</>}
                          </button>
                          <button
                            onClick={() => setSelectedOnlineForRenewal(null)}
                            disabled={isRenewingOnline}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition-all cursor-pointer text-xs"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ========================================================================= */}
                  {/* مودال تعديل بيانات الطالب                                                  */}
                  {/* ========================================================================= */}
                  {selectedOnlineForEdit && (
                    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir="rtl">
                      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-right">
                        <div className="flex justify-between items-center border-b pb-3">
                          <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            <i className="fas fa-pen-to-square text-emerald-600"></i> تعديل بيانات طالب أونلاين
                          </h3>
                          <button onClick={() => setSelectedOnlineForEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer">✕</button>
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">اسم الطالب رباعي:</label>
                          <input
                            type="text"
                            value={editOnlineName}
                            onChange={(e) => setEditOnlineName(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">رقم الهاتف (واتساب):</label>
                          <input
                            type="tel"
                            value={editOnlinePhone}
                            onChange={(e) => setEditOnlinePhone(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800 text-right"
                            dir="ltr"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">نوع الباقة:</label>
                          <input
                            type="text"
                            value={editOnlinePackage}
                            onChange={(e) => setEditOnlinePackage(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800"
                            placeholder="شهري / ترم أول / ترم ثانٍ / سنة كاملة"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">المبلغ المسدد (جنيه):</label>
                          <input
                            type="number"
                            value={editOnlineAmount}
                            onChange={(e) => setEditOnlineAmount(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800"
                          />
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleEditOnlineStudent}
                            disabled={isEditingOnline}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-sm"
                          >
                            {isEditingOnline ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-save"></i> حفظ التعديلات</>}
                          </button>
                          <button
                            onClick={() => setSelectedOnlineForEdit(null)}
                            disabled={isEditingOnline}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition-all cursor-pointer text-xs"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* مودال تفعيل الطالب واختيار نوع الباقة (من الطلبات المعلقة) */}
                  {selectedActivationReq && (
                    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir="rtl">
                      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-right">
                        <div className="flex justify-between items-center border-b pb-3">
                          <h3 className="text-xl font-black text-emerald-800 flex items-center gap-2">
                            <i className="fas fa-user-check text-emerald-600"></i> تفعيل اشتراك أونلاين
                          </h3>
                          <button onClick={() => setSelectedActivationReq(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer">✕</button>
                        </div>

                        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-1.5 text-sm">
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">الطالب:</span><span className="font-black text-gray-900">{selectedActivationReq.name}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">رقم الهاتف:</span><span className="font-bold text-gray-900" dir="ltr">{selectedActivationReq.phone}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">طريقة الدفع:</span><span className="font-bold text-emerald-700">{selectedActivationReq.method}</span></div>
                          <div className="flex justify-between pt-2 border-t border-emerald-200">
                            <span className="text-emerald-900 font-black">الكود المقترح التلقائي:</span>
                            <span className="font-mono font-black text-base text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300" dir="ltr">
                              {generateOnlineCodeClient(selectedActivationReq.name, selectedActivationReq.phone)}
                            </span>
                          </div>
                        </div>

                        {/* اختيار نوع الباقة */}
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-2">نوع باقة الاشتراك:</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'شهري', title: 'اشتراك شهري', desc: 'شهر محدد', color: 'border-blue-400 bg-blue-50 text-blue-900' },
                              { id: 'ترم أول', title: 'اشتراك الترم الأول', desc: 'أغسطس - يناير', color: 'border-indigo-400 bg-indigo-50 text-indigo-900' },
                              { id: 'ترم ثانٍ', title: 'اشتراك الترم الثاني', desc: 'فبراير - مايو', color: 'border-purple-400 bg-purple-50 text-purple-900' },
                              { id: 'سنة كاملة', title: 'اشتراك سنوي كامل', desc: 'العام كاملاً', color: 'border-amber-400 bg-amber-50 text-amber-900' }
                            ].map(pkg => (
                              <button
                                key={pkg.id}
                                type="button"
                                onClick={() => {
                                  setActivationPackage(pkg.id as any);
                                  if (pkg.id === 'سنة كاملة') setActivationAmount('250');
                                  else if (pkg.id.includes('ترم')) setActivationAmount('150');
                                  else setActivationAmount('50');
                                }}
                                className={`p-2.5 rounded-xl border-2 text-right transition-all cursor-pointer ${activationPackage === pkg.id ? pkg.color + ' ring-2 ring-emerald-500 font-black shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 font-bold'}`}
                              >
                                <div className="text-xs font-black">{pkg.title}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">{pkg.desc}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* اختيار الشهر في حالة الاشتراك الشهري */}
                        {activationPackage === 'شهري' && (
                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-1">الشهر المراد تفعيله:</label>
                            <select
                              value={activationMonth}
                              onChange={(e) => setActivationMonth(e.target.value)}
                              className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold bg-white text-gray-800 outline-none focus:border-emerald-600"
                            >
                              {["أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو"].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleConfirmActivation}
                            disabled={isActivatingOnline}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-sm"
                          >
                            {isActivatingOnline ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-check"></i> تأكيد التفعيل وتوليد الكود</>}
                          </button>
                          <button
                            onClick={() => setSelectedActivationReq(null)}
                            disabled={isActivatingOnline}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition-all cursor-pointer text-xs"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* مودال الإضافة اليدوية لطالب أونلاين */}
                  {showManualOnlineModal && (
                    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir="rtl">
                      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-right">
                        <div className="flex justify-between items-center border-b pb-3">
                          <h3 className="text-xl font-black text-emerald-800 flex items-center gap-2">
                            <i className="fas fa-user-plus text-emerald-600"></i> إضافة مشترك أونلاين يدوياً
                          </h3>
                          <button onClick={() => setShowManualOnlineModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer">✕</button>
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">اسم الطالب رباعي:</label>
                          <input
                            type="text"
                            placeholder="مثال: أحمد مصطفى محمود"
                            value={manualOnlineName}
                            onChange={(e) => setManualOnlineName(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">رقم الهاتف (واتساب):</label>
                          <input
                            type="tel"
                            placeholder="مثال: 01012345678"
                            value={manualOnlinePhone}
                            onChange={(e) => setManualOnlinePhone(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800 text-right"
                            dir="ltr"
                          />
                        </div>

                        {manualOnlineName && manualOnlinePhone && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex justify-between items-center text-xs">
                            <span className="font-bold text-emerald-900">الكود الذي سيتم توليده:</span>
                            <span className="font-mono font-black text-sm text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300" dir="ltr">
                              {generateOnlineCodeClient(manualOnlineName, manualOnlinePhone)}
                            </span>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-2">نوع الباقة:</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'شهري', title: 'اشتراك شهري' },
                              { id: 'ترم أول', title: 'الترم الأول كامل' },
                              { id: 'ترم ثانٍ', title: 'الترم الثاني كامل' },
                              { id: 'سنة كاملة', title: 'السنة كاملة' }
                            ].map(pkg => (
                              <button
                                key={pkg.id}
                                type="button"
                                onClick={() => {
                                  setActivationPackage(pkg.id as any);
                                  if (pkg.id === 'سنة كاملة') setActivationAmount('250');
                                  else if (pkg.id.includes('ترم')) setActivationAmount('150');
                                  else setActivationAmount('50');
                                }}
                                className={`p-2 rounded-xl border-2 text-center text-xs font-black transition-all cursor-pointer ${activationPackage === pkg.id ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-400' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                              >
                                {pkg.title}
                              </button>
                            ))}
                          </div>
                        </div>

                        {activationPackage === 'شهري' && (
                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-1">الشهر:</label>
                            <select
                              value={activationMonth}
                              onChange={(e) => setActivationMonth(e.target.value)}
                              className="w-full border-2 border-gray-300 rounded-xl p-2 text-sm font-bold bg-white text-gray-800 outline-none focus:border-emerald-600"
                            >
                              {["أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو"].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleManualAddOnline}
                            disabled={isActivatingOnline}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-sm"
                          >
                            {isActivatingOnline ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-plus"></i> إضافة وتفعيل فوري</>}
                          </button>
                          <button
                            onClick={() => setShowManualOnlineModal(false)}
                            disabled={isActivatingOnline}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition-all cursor-pointer text-xs"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* مودال نجاح التفعيل وزر إرسال رسالة الترحيب عبر واتساب */}
                  {activationSuccess && (
                    <div className="fixed inset-0 bg-black/70 z-[130] flex items-center justify-center p-4 backdrop-blur-md animate-fade-in" dir="rtl">
                      <div className="bg-white rounded-3xl max-w-sm w-full p-6 sm:p-7 shadow-2xl text-center border-2 border-emerald-300 relative">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
                          <i className="fas fa-check"></i>
                        </div>
                        <h3 className="text-xl font-black text-emerald-950 mb-1">تم تفعيل الاشتراك بنجاح! 🎉</h3>
                        <p className="text-xs text-gray-600 font-bold mb-4">تم حفظ الطالب في شيت طلاب الأونلاين وتثبيت الشهور المفعلة بنجاح.</p>

                        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-right space-y-2 mb-5">
                          <div className="flex justify-between text-xs"><span className="text-gray-500 font-bold">الطالب:</span><span className="font-black text-gray-800">{activationSuccess.name}</span></div>
                          <div className="flex justify-between text-xs"><span className="text-gray-500 font-bold">الهاتف:</span><span className="font-bold text-gray-800" dir="ltr">{activationSuccess.phone}</span></div>
                          <div className="flex justify-between text-xs"><span className="text-gray-500 font-bold">الباقة:</span><span className="font-bold text-emerald-700">{activationSuccess.packageType}</span></div>
                          <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                            <span className="text-xs font-black text-gray-700">كود الدخول:</span>
                            <span className="font-mono font-black text-lg text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-300" dir="ltr">
                              {activationSuccess.code}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          {/* زر واتساب المباشر */}
                          <button
                            onClick={() => sendWhatsAppStudentWelcome(activationSuccess.phone, activationSuccess.name, activationSuccess.code, activationSuccess.packageType)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-sm"
                          >
                            <i className="fab fa-whatsapp text-lg"></i> إرسال رسالة الترحيب والكود للطالب
                          </button>
                          
                          <button
                            onClick={() => {
                              const appLink = OFFICIAL_APP_URL;
                              const msg = `أهلاً بك يا بطل في موسوعة الكنز التعليمي 🎓\nيسعدنا انضمامك معنا في منصة التاريخ (2 بكالوريا) للأستاذ / إسلام سعود ✨\n\nتم تفعيل اشتراكك بنجاح (${activationSuccess.packageType})، وبيانات دخولك هي:\n📱 رقم الهاتف المسجل: ${activationSuccess.phone}\n🔑 كود الطالب: ${activationSuccess.code}\n🌐 رابط المنصة: ${appLink}\n\nنتمنى لك رحلة تفوق مميزة والدرجة النهائية بإذن الله! 🌟`;
                              navigator.clipboard.writeText(msg);
                              showAlert('تم نسخ الرسالة وبيانات الدخول إلى الحافظة بنجاح!');
                            }}
                            className="w-full bg-gray-50 hover:bg-gray-100 text-emerald-800 border border-emerald-200 font-bold py-2 rounded-xl transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <i className="far fa-copy text-xs"></i> نسخ نص الرسالة والكود
                          </button>

                          <button
                            onClick={() => setActivationSuccess(null)}
                            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl transition-all text-xs cursor-pointer"
                          >
                            إغلاق
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {adminActiveTab === 'search' && (
                <div className="space-y-6">
                  {/* بطاقة المزامنة الذكية مع تطبيق السنتر والدرس */}
                  <div className="bg-gradient-to-br from-indigo-950 via-primary to-slate-900 text-white rounded-2xl shadow-xl p-5 sm:p-6 border border-white/10">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-4 mb-5">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <i className="fas fa-magic text-[10px]"></i> مزامنة آلية ذكية
                          </span>
                          <span className="bg-amber-500/20 text-amber-300 border border-amber-400/30 text-xs px-2.5 py-0.5 rounded-full font-bold">
                            المرحلة: 2 ثانوي / 2 بكالوريا
                          </span>
                        </div>
                        <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
                          <i className="fab fa-google-drive text-amber-400 text-xl"></i> مزامنة اشتراكات تطبيق الدرس والسنتر
                        </h2>
                        <p className="text-blue-200 text-xs sm:text-sm mt-1">تحديث شهور وسداد الطلاب تلقائياً برقم الهاتف من مجلد النسخ الاحتياطية (System_Backups).</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* الخيار الأول: سحابياً من Google Drive */}
                      <div className="bg-white/5 hover:bg-white/10 transition-all backdrop-blur-sm border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3">
                        <div>
                          <div className="font-bold text-sm text-amber-300 flex items-center gap-1.5 mb-1">
                            <i className="fas fa-cloud-download-alt"></i> 1. المزامنة السحابية (Google Drive)
                          </div>
                          <p className="text-xs text-blue-100/80 leading-relaxed">
                            قراءة أحدث ملف باك آب تم رفعه اليوم تلقائياً إلى مجلد <span className="font-mono bg-black/30 px-1 py-0.5 rounded text-amber-200" dir="ltr">System_Backups</span> ومطابقة الشهور المدفوعة.
                          </p>
                        </div>
                        <button
                          onClick={handleSyncDriveBackups}
                          disabled={isSyncingDrive || isSyncingLocal}
                          className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black py-2.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                        >
                          {isSyncingDrive ? (
                            <>
                              <i className="fas fa-spinner fa-spin"></i> جاري قراءة الدرايف وتحديث الشيت...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-sync-alt"></i> مزامنة الآن من Google Drive
                            </>
                          )}
                        </button>
                      </div>

                      {/* الخيار الثاني: رفع ملف الباك آب محلياً */}
                      <div className="bg-white/5 hover:bg-white/10 transition-all backdrop-blur-sm border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3">
                        <div>
                          <div className="font-bold text-sm text-cyan-300 flex items-center gap-1.5 mb-1">
                            <i className="fas fa-file-code"></i> 2. الرفع المباشر (ملف JSON محلي)
                          </div>
                          <p className="text-xs text-blue-100/80 leading-relaxed">
                            اختيار ملف <span className="font-mono bg-black/30 px-1 py-0.5 rounded text-cyan-200" dir="ltr">emergency_autosave.json</span> أو أي ملف باك آب من جهازك فوراً كخطة بديلة.
                          </p>
                        </div>
                        <label className={`w-full bg-white/15 hover:bg-white/25 text-white font-black py-2.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm cursor-pointer border border-white/20 ${(isSyncingDrive || isSyncingLocal) ? 'opacity-50 pointer-events-none' : ''}`}>
                          <input
                            type="file"
                            accept=".json"
                            onChange={handleSyncLocalBackupFile}
                            className="hidden"
                            disabled={isSyncingDrive || isSyncingLocal}
                          />
                          {isSyncingLocal ? (
                            <>
                              <i className="fas fa-spinner fa-spin"></i> جاري معالجة الملف والتحديث...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-upload"></i> رفع ملف الباك آب (JSON)
                            </>
                          )}
                        </label>
                      </div>
                    </div>
                  </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4"><h2 className="text-xl font-black text-primary"><i className="fas fa-search-dollar text-green-600 ml-1"></i> تفعيل المتأخرات</h2><input type="text" placeholder="بحث بالاسم أو الرقم..." className="border-2 rounded-xl px-4 py-2 w-full sm:w-64 focus:border-primary outline-none text-sm font-bold" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} /></div>
                  <div className="p-6 space-y-3">
                    {(() => {
                      const list: React.ReactNode[] = [];
                      Object.entries(studentsList).forEach(([phone, arr]) => {
                        const students = Array.isArray(arr) ? arr : [arr];
                        students.forEach((st, i) => {
                          if (searchQuery) {
                            const sq = searchQuery.toLowerCase();
                            const n = st.name ? String(st.name).toLowerCase() : '';
                            const p = phone ? String(phone) : '';
                            if (!n.includes(sq) && !p.includes(sq)) return;
                          }
                          if (!st.missingMonths || st.missingMonths.length === 0) return;
                          
                          list.push(
                            <div key={`${phone}-${i}`} className="bg-red-50 border border-red-100 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-4">
                              <div className="flex items-center gap-3 w-full sm:w-auto">
                                <div className="font-black text-base sm:text-lg text-red-800 truncate max-w-[150px] sm:max-w-[200px]" title={st.name}>{st.name}</div>
                                <div className="font-bold text-xs sm:text-sm text-red-500 bg-red-100/50 px-2 py-1 rounded-md" dir="ltr">{phone}</div>
                              </div>
                              <div className="flex flex-wrap gap-2 justify-center shrink-0">
                                {st.missingMonths.map((m, mIdx) => (
                                  <button 
                                    key={mIdx} 
                                    onClick={() => handleActivateMonth(phone, st.name, m)} 
                                    className="bg-white border-2 border-red-500 text-red-600 font-bold px-3 py-1.5 rounded-lg text-sm hover:bg-red-500 hover:text-white transition-colors flex items-center gap-1"
                                  >
                                    <i className="fas fa-check-circle"></i> تفعيل {m}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        });
                      });
                      return list.length > 0 ? list : <div className="text-center text-gray-500 font-bold py-6">لا توجد اشتراكات متأخرة مطابقة.</div>;
                    })()}
                  </div>
                </div>
                </div>
              )}
              {adminActiveTab === 'settings' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden max-w-3xl w-full border border-gray-100">
                  <div className="bg-gray-50 px-5 sm:px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-black text-primary flex items-center gap-2">
                      <i className="fas fa-cog text-secondary ml-1"></i>
                      <span>إعدادات المنصة والتحكم</span>
                    </h2>
                    <span className="text-xs font-black text-gray-600 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>لوحة التحكم الرئيسية</span>
                    </span>
                  </div>

                  <div className="p-4 sm:p-6">
                    {/* شريط التبويبات الفرعية للإعدادات */}
                    <div className="bg-gray-100/90 p-1.5 rounded-2xl flex flex-wrap gap-1.5 mb-6 border border-gray-200">
                      {[
                        { id: 'prices', label: 'باقات الاشتراك', icon: 'fa-tags' },
                        { id: 'announcement', label: 'إشعار الطلاب', icon: 'fa-bullhorn' },
                        { id: 'timer', label: 'العداد الزمني', icon: 'fa-clock' },
                        { id: 'ai', label: 'الذكاء الاصطناعي', icon: 'fa-robot' },
                        { id: 'buttons', label: 'ظهور الأزرار', icon: 'fa-sliders-h' },
                        { id: 'certificates_config', label: 'الشهادات والوحدات', icon: 'fa-award' },
                        { id: 'security', label: 'الأمان ومكافحة الغش', icon: 'fa-shield-halved' },
                        { id: 'all', label: 'عرض الكل', icon: 'fa-layer-group' }
                      ].map((tab) => {
                        const isActive = settingsSubTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSettingsSubTab(tab.id as any)}
                            className={`flex-1 min-w-[110px] py-2 px-3 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                              isActive
                                ? 'bg-white text-primary shadow-sm border border-gray-200 scale-[1.02]'
                                : 'text-gray-600 hover:bg-white/60 hover:text-primary'
                            }`}
                          >
                            <i className={`fas ${tab.icon} ${isActive ? 'text-secondary' : 'text-gray-400'}`}></i>
                            <span>{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* 1. باقات الاشتراك */}
                    {(settingsSubTab === 'prices' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm shadow-sm">
                              <i className="fas fa-tags"></i>
                            </span>
                            <span>أسعار باقات الاشتراك للأونلاين (ج.م):</span>
                          </h3>
                          <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">باقات المنصة</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          <div className="bg-white border-2 border-blue-200/80 hover:border-blue-300 p-3.5 rounded-2xl shadow-sm transition-all">
                            <label className="block text-xs font-black text-blue-900 mb-1.5 flex items-center gap-1.5">
                              <span>📅</span> <span>اشتراك شهري (شهر واحد):</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                className="w-full bg-blue-50/30 border-2 border-blue-200 focus:border-secondary outline-none rounded-xl px-3 py-2 text-base font-black text-center" 
                                value={editPrices.monthly} 
                                onChange={e => setEditPrices(prev => ({ ...prev, monthly: e.target.value }))}
                                placeholder="50"
                              />
                              <span className="text-sm font-bold text-gray-600 shrink-0">ج.م</span>
                            </div>
                          </div>

                          <div className="bg-white border-2 border-emerald-200/80 hover:border-emerald-300 p-3.5 rounded-2xl shadow-sm transition-all">
                            <label className="block text-xs font-black text-emerald-900 mb-1.5 flex items-center gap-1.5">
                              <span>📘</span> <span>اشتراك الترم الأول:</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                className="w-full bg-emerald-50/30 border-2 border-emerald-200 focus:border-secondary outline-none rounded-xl px-3 py-2 text-base font-black text-center" 
                                value={editPrices.term1} 
                                onChange={e => setEditPrices(prev => ({ ...prev, term1: e.target.value }))}
                                placeholder="150"
                              />
                              <span className="text-sm font-bold text-gray-600 shrink-0">ج.م</span>
                            </div>
                          </div>

                          <div className="bg-white border-2 border-purple-200/80 hover:border-purple-300 p-3.5 rounded-2xl shadow-sm transition-all">
                            <label className="block text-xs font-black text-purple-900 mb-1.5 flex items-center gap-1.5">
                              <span>📗</span> <span>اشتراك الترم الثاني:</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                className="w-full bg-purple-50/30 border-2 border-purple-200 focus:border-secondary outline-none rounded-xl px-3 py-2 text-base font-black text-center" 
                                value={editPrices.term2} 
                                onChange={e => setEditPrices(prev => ({ ...prev, term2: e.target.value }))}
                                placeholder="150"
                              />
                              <span className="text-sm font-bold text-gray-600 shrink-0">ج.م</span>
                            </div>
                          </div>

                          <div className="bg-white border-2 border-amber-200/80 hover:border-amber-300 p-3.5 rounded-2xl shadow-sm transition-all">
                            <label className="block text-xs font-black text-amber-900 mb-1.5 flex items-center gap-1.5">
                              <span>⭐</span> <span>اشتراك العام كامل (السنة كاملة):</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                className="w-full bg-amber-50/30 border-2 border-amber-200 focus:border-secondary outline-none rounded-xl px-3 py-2 text-base font-black text-center" 
                                value={editPrices.fullYear} 
                                onChange={e => setEditPrices(prev => ({ ...prev, fullYear: e.target.value }))}
                                placeholder="250"
                              />
                              <span className="text-sm font-bold text-gray-600 shrink-0">ج.م</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 2. إشعار وتنبيهات الطلاب */}
                    {(settingsSubTab === 'announcement' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-sm shadow-sm">
                              <i className="fas fa-bullhorn"></i>
                            </span>
                            <span>الإشعار الحالي وتنبيهات الطلاب 📢:</span>
                          </h3>
                          <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">رسائل البث المباشر</span>
                        </div>

                        <div>
                          <textarea 
                            placeholder="اكتب التنبيه هنا ليظهر لجميع الطلاب فوراً في أعلى الفهرس..." 
                            className="w-full bg-white border-2 border-gray-300 focus:border-secondary outline-none rounded-xl px-4 py-3 text-sm sm:text-base font-bold h-28 resize-none text-right shadow-sm transition-all" 
                            value={announcementInput} 
                            onChange={e => setAnnouncementInput(e.target.value)} 
                          />
                          <p className="text-xs text-gray-500 mt-1.5 font-bold flex items-center gap-1.5">
                            <i className="fas fa-info-circle text-amber-500"></i>
                            <span>امسح نص الإشعار بالكامل واضغط حفظ الإعدادات لإخفاء الإشعار من واجهة الطلاب.</span>
                          </p>

                          {announcementInput && announcementInput.trim() !== "" && (
                            <div className="mt-4 animate-fade-in">
                              <label className="block text-gray-700 text-xs font-black mb-2 flex items-center gap-1.5">
                                <i className="fas fa-eye text-primary"></i>
                                <span>معاينة حية لشكل الإشعار عند الطلاب:</span>
                              </label>
                              <div className="bg-orange-50 border-r-4 border-gold p-4 rounded-2xl shadow-sm flex items-start gap-3 relative" style={{ fontSize: '11px', lineHeight: '21px', paddingLeft: '14px', paddingTop: '9px' }}>
                                <button className="absolute top-2 left-2 text-gray-400 hover:text-red-500 transition-colors p-1 cursor-default" title="زر إخفاء الإشعار (للعرض فقط)" type="button">
                                  <i className="fas fa-times"></i>
                                </button>
                                <span className="text-gold text-xl shrink-0"><i className="fas fa-bullhorn animate-bounce"></i></span>
                                <div className="flex-1 text-right">
                                  <h4 className="font-black text-gold text-xs sm:text-sm mb-0.5">تنبيه هام من الأستاذ 📢:</h4>
                                  <p className="text-gray-800 text-sm sm:text-base font-bold leading-relaxed whitespace-pre-line" style={{ fontSize: '13px', textAlign: 'justify', lineHeight: '19.5px' }}>{announcementInput}</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 3. العداد الزمني */}
                    {(settingsSubTab === 'timer' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm shadow-sm">
                              <i className="fas fa-clock"></i>
                            </span>
                            <span>إعدادات العداد الزمني للاختبارات:</span>
                          </h3>
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">نظام الوقت</span>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-1.5">تفعيل العداد على:</label>
                            <select 
                              value={timerMode} 
                              onChange={(e) => setTimerMode(e.target.value)}
                              className="w-full bg-white border-2 border-gray-300 rounded-xl p-3 font-bold text-gray-700 outline-none focus:border-secondary shadow-sm text-sm"
                            >
                              <option value="custom_units">تحديد وحدات معينة</option>
                              <option value="custom_lessons">تحديد دروس/اختبارات معينة</option>
                              <option value="all">جميع الدروس والامتحانات</option>
                              <option value="disabled">معطل (بدون وقت)</option>
                            </select>
                          </div>

                          {(timerMode === 'custom_units' || timerMode === 'unit') && (
                            <div className="animate-fade-in bg-white p-3.5 rounded-2xl border border-gray-200">
                              <label className="block text-xs font-black text-gray-700 mb-2">اختر الوحدات المستهدفة:</label>
                              <div className="flex flex-col gap-2">
                                {data.filter(u => u.lessons.length > 0).map(u => (
                                  <label key={u.id} className="flex items-center gap-3 cursor-pointer p-2.5 border rounded-xl hover:bg-gray-50 transition-colors">
                                    <input 
                                      type="checkbox" 
                                      checked={timerUnitTargets.includes(u.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setTimerUnitTargets(prev => [...prev, u.id]);
                                        } else {
                                          setTimerUnitTargets(prev => prev.filter(id => id !== u.id));
                                        }
                                      }}
                                      className="w-5 h-5 accent-secondary"
                                    />
                                    <span className="font-bold text-gray-800 text-sm">{u.title}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {timerMode === 'custom_lessons' && (
                            <div className="animate-fade-in bg-white p-3.5 rounded-2xl border border-gray-200">
                              <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-black text-gray-700">اختر الاختبارات المستهدفة:</label>
                                <button 
                                  type="button"
                                  onClick={() => {
                                    const allLessonIds = data.flatMap(u => u.lessons.map(l => l.id));
                                    if (timerUnitTargets.length === allLessonIds.length) {
                                      setTimerUnitTargets([]);
                                    } else {
                                      setTimerUnitTargets(allLessonIds);
                                    }
                                  }}
                                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer"
                                >
                                  {timerUnitTargets.length > 0 && timerUnitTargets.length === data.flatMap(u => u.lessons.map(l => l.id)).length ? 'إلغاء التحديد' : 'تحديد الكل'}
                                </button>
                              </div>
                              <div className="flex flex-col gap-3 max-h-64 overflow-y-auto custom-scrollbar p-2 border border-gray-200 rounded-xl bg-gray-50">
                                {data.filter(u => u.lessons.length > 0).map(u => (
                                  <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                                    <div className="font-black text-primary text-xs mb-2 border-b pb-1.5">{u.title}</div>
                                    <div className="flex flex-col gap-1.5 pl-2">
                                      {u.lessons.map(l => (
                                        <label key={l.id} className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                                          <input 
                                            type="checkbox" 
                                            checked={timerUnitTargets.includes(l.id)}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setTimerUnitTargets(prev => [...prev, l.id]);
                                              } else {
                                                setTimerUnitTargets(prev => prev.filter(id => id !== l.id));
                                              }
                                            }}
                                            className="w-4 h-4 accent-secondary"
                                          />
                                          <span className="font-bold text-gray-700 text-xs">{l.title}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-2">نوع نظام الوقت المفضل:</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => setTimerType('total_exam')}
                                className={`p-3 rounded-xl border-2 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${timerType === 'total_exam' ? 'border-secondary bg-blue-50 text-secondary ring-2 ring-secondary' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                              >
                                <i className="fas fa-hourglass-half text-base"></i> وقت كلي للامتحان (بالدقائق) ⏱️
                              </button>
                              <button
                                type="button"
                                onClick={() => setTimerType('per_question')}
                                className={`p-3 rounded-xl border-2 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${timerType === 'per_question' ? 'border-secondary bg-blue-50 text-secondary ring-2 ring-secondary' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                              >
                                <i className="fas fa-stopwatch text-base"></i> وقت لكل سؤال (بالثواني) ⏳
                              </button>
                            </div>
                          </div>

                          {timerType === 'total_exam' ? (
                            <div className="animate-fade-in bg-blue-50/60 p-4 rounded-2xl border border-blue-200">
                              <label className="block text-gray-800 font-bold mb-2 flex items-center gap-2 text-xs sm:text-sm">
                                <i className="fas fa-clock text-secondary"></i> وقت الامتحان بالكامل (بالدقائق):
                              </label>
                              <input 
                                type="number" 
                                className="w-full border-2 border-blue-300 focus:border-secondary outline-none rounded-xl px-4 py-2.5 text-base font-bold bg-white" 
                                value={examTotalMinutes} 
                                onChange={e => setExamTotalMinutes(Math.max(1, Number(e.target.value)))}
                                min="1" max="300"
                              />
                              <p className="text-xs text-gray-600 font-bold mt-2 flex items-center gap-1.5">
                                <i className="fas fa-info-circle text-blue-500"></i> يتحرك الطالب بحرية تامة بين الأسئلة دون قفز ويُسلّم الامتحان تلقائياً عند انتهاء الدقائق المحددة.
                              </p>
                            </div>
                          ) : (
                            <div className="animate-fade-in bg-blue-50/60 p-4 rounded-2xl border border-blue-200">
                              <label className="block text-gray-800 font-bold mb-2 flex items-center gap-2 text-xs sm:text-sm">
                                <i className="fas fa-stopwatch text-secondary"></i> الوقت المخصص لكل سؤال (بالثواني):
                              </label>
                              <input 
                                type="number" 
                                className="w-full border-2 border-blue-300 focus:border-secondary outline-none rounded-xl px-4 py-2.5 text-base font-bold bg-white" 
                                value={timerSecondsPerQ} 
                                onChange={e=>setTimerSecondsPerQ(Number(e.target.value))}
                                min="5" max="600"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 4. الذكاء الاصطناعي */}
                    {(settingsSubTab === 'ai' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm shadow-sm">
                              <i className="fas fa-robot"></i>
                            </span>
                            <span>إعدادات الذكاء الاصطناعي (Google Gemini Pro):</span>
                          </h3>
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">تصحيح المقالي</span>
                        </div>
                        
                        <p className="text-xs text-gray-600 font-bold mb-3 leading-relaxed">
                          ضع مفتاح Gemini API لتفعيل التصحيح فائق الذكاء للأسئلة المقالية، أو اتركه فارغاً للاعتماد على المحلل الذكي المحلي المدمج.
                        </p>
                        
                        <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 space-y-3">
                          <div>
                            <label className="block text-xs font-black text-indigo-950 mb-1">
                              مفتاح Google Gemini API:
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type={showGeminiKey ? "text" : "password"}
                                placeholder="AIzaSy..."
                                value={geminiKeyInput}
                                onChange={e => setGeminiKeyInput(e.target.value)}
                                className="w-full bg-white border border-indigo-300 focus:border-indigo-600 outline-none rounded-xl px-3 py-2 text-xs font-bold font-mono text-left"
                                dir="ltr"
                              />
                              <button
                                type="button"
                                onClick={() => setShowGeminiKey(!showGeminiKey)}
                                className="px-3 py-2 bg-white border border-indigo-200 hover:bg-indigo-100 rounded-xl text-indigo-700 text-xs font-bold shrink-0 transition-colors cursor-pointer"
                                title={showGeminiKey ? "إخفاء المفتاح" : "إظهار المفتاح"}
                              >
                                <i className={`fas ${showGeminiKey ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={handleTestGeminiKey}
                              disabled={isTestingKey || !geminiKeyInput.trim()}
                              className="text-xs font-bold px-3 py-1.5 bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-800 rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                              <i className={isTestingKey ? "fas fa-spinner fa-spin" : "fas fa-bolt text-amber-500"}></i>
                              اختبار المفتاح والاتصال ⚡
                            </button>
                            
                            {geminiKeyStatus && (
                              <span className={`text-[11px] font-black px-2.5 py-1 rounded-lg ${
                                geminiKeyStatus.type === 'success' 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                                  : 'bg-rose-100 text-rose-800 border border-rose-300'
                              }`}>
                                {geminiKeyStatus.msg}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 5. ظهور أزرار المنصة */}
                    {(settingsSubTab === 'buttons' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-sm shadow-sm">
                              <i className="fas fa-sliders-h"></i>
                            </span>
                            <span>إعدادات ظهور أزرار المنصة للطلاب:</span>
                          </h3>
                          <span className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full">واجهة الطالب</span>
                        </div>
                        
                        <div className="space-y-3">
                          {/* خيار زر كشكول الأخطاء */}
                          <div className="bg-white border-2 border-purple-100 hover:border-purple-200 p-4 rounded-2xl flex items-center justify-between gap-3 shadow-sm transition-all">
                            <h4 className="text-sm font-black text-purple-950 flex items-center gap-2">
                              <i className="fas fa-book-bookmark text-purple-600"></i>
                              <span>زر كشكول أهم الأخطاء والنموذج</span>
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowMistakesNotebookSetting(!showMistakesNotebookSetting)}
                              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                                showMistakesNotebookSetting
                                  ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/30'
                                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                              }`}
                            >
                              <i className={`fas ${showMistakesNotebookSetting ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                              <span>{showMistakesNotebookSetting ? 'مُفعّل (ظاهر للطلاب)' : 'مخفي عن الطلاب'}</span>
                            </button>
                          </div>

                          {/* خيار زر التصفير */}
                          <div className="bg-white border-2 border-rose-100 hover:border-rose-200 p-4 rounded-2xl flex items-center justify-between gap-3 shadow-sm transition-all">
                            <h4 className="text-sm font-black text-rose-950 flex items-center gap-2">
                              <i className="fas fa-sync-alt text-rose-600"></i>
                              <span>أزرار تصفير البيانات والوحدات</span>
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowResetButtonSetting(!showResetButtonSetting)}
                              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                                showResetButtonSetting
                                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30'
                                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                              }`}
                            >
                              <i className={`fas ${showResetButtonSetting ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                              <span>{showResetButtonSetting ? 'مُفعّل (ظاهر للطلاب)' : 'مخفي عن الطلاب'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 6. إعدادات الشهادات وإتمام الوحدات والامتحانات الشاملة */}
                    {(settingsSubTab === 'certificates_config' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-sm shadow-sm">
                              <i className="fas fa-award"></i>
                            </span>
                            <span>إعدادات الشهادات وإتمام الوحدات والامتحانات الشاملة:</span>
                          </h3>
                          <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">نظام الشهادات الذكي</span>
                        </div>

                        {/* البطاقة 1: القواعد العامة للشهادات والنسبة المئوية */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                          {/* نسبة الاستحقاق */}
                          <div className="bg-white border-2 border-amber-200/80 hover:border-amber-300 p-4 rounded-2xl shadow-sm transition-all flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <label className="text-xs sm:text-sm font-black text-amber-950 flex items-center gap-2">
                                  <i className="fas fa-percentage text-amber-600"></i>
                                  <span>الحد الأدنى للنسبة المئوية لاستحقاق الشهادة:</span>
                                </label>
                                <span className="text-xs font-black bg-amber-100 text-amber-800 px-2.5 py-1 rounded-xl border border-amber-300" dir="ltr">
                                  {toEasternArabic(certSettings.minCertScore)}%
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-500 font-bold mb-3 leading-relaxed">
                                النسبة التي يجب أن يحققها الطالب في الدرس أو الوحدة أو الامتحان الشامل ليظهر له زر استلام وتحميل الشهادة (الافتراضي 90%).
                              </p>
                            </div>
                            <div className="flex items-center gap-3 pt-2">
                              <input 
                                type="range" 
                                min="50" 
                                max="100" 
                                step="5"
                                value={certSettings.minCertScore}
                                onChange={e => {
                                  const val = Number(e.target.value);
                                  setCertSettings(prev => {
                                    const next = { ...prev, minCertScore: val };
                                    localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className="w-full accent-amber-600 cursor-pointer h-2 bg-amber-100 rounded-lg"
                              />
                              <input 
                                type="number" 
                                min="50" 
                                max="100"
                                value={certSettings.minCertScore}
                                onChange={e => {
                                  const val = Math.min(100, Math.max(50, Number(e.target.value) || 90));
                                  setCertSettings(prev => {
                                    const next = { ...prev, minCertScore: val };
                                    localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className="w-16 bg-amber-50/50 border-2 border-amber-300 focus:border-amber-500 rounded-xl px-2 py-1 text-center font-black text-sm outline-none"
                              />
                            </div>
                          </div>

                          {/* تفعيل / تعطيل أنواع الشهادات الثلاثة */}
                          <div className="bg-white border-2 border-amber-200/80 hover:border-amber-300 p-4 rounded-2xl shadow-sm transition-all space-y-2.5">
                            <div className="text-xs font-black text-gray-700 mb-1 flex items-center justify-between">
                              <span>أنواع الشهادات المتاحة على المنصة:</span>
                              <span className="text-[10px] text-gray-400 font-bold">تحكم فوري</span>
                            </div>

                            {/* 1. شهادة الدرس الفردي */}
                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-teal-50/50 border border-teal-200/70">
                              <div className="flex items-center gap-2.5">
                                <span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-xs shrink-0">
                                  <i className="fas fa-scroll"></i>
                                </span>
                                <div>
                                  <span className="text-xs font-black text-teal-950 block">شهادة تفوق للدرس الفردي 📜</span>
                                  <span className="text-[10px] text-teal-700 font-bold block">تحفيز فوري للطالب عند اجتياز أي درس فردي</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCertSettings(prev => {
                                    const next = { ...prev, enableLessonCerts: !prev.enableLessonCerts };
                                    localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                  certSettings.enableLessonCerts ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-600/30' : 'bg-gray-200 text-gray-600'
                                }`}
                              >
                                {certSettings.enableLessonCerts ? 'مُفعّل' : 'معطّل'}
                              </button>
                            </div>

                            {/* 2. شهادة إتمام الوحدة */}
                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/50 border border-amber-200/70">
                              <div className="flex items-center gap-2.5">
                                <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-xs shrink-0">
                                  <i className="fas fa-trophy"></i>
                                </span>
                                <div>
                                  <span className="text-xs font-black text-amber-950 block">شهادة إتمام الوحدة كاملة 🏆</span>
                                  <span className="text-[10px] text-amber-700 font-bold block">تُمنح فقط بعد نشر واجتياز كافة دروس الوحدة</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCertSettings(prev => {
                                    const next = { ...prev, enableUnitCerts: !prev.enableUnitCerts };
                                    localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                  certSettings.enableUnitCerts ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30' : 'bg-gray-200 text-gray-600'
                                }`}
                              >
                                {certSettings.enableUnitCerts ? 'مُفعّل' : 'معطّل'}
                              </button>
                            </div>

                            {/* 3. شهادة الامتحان الشامل */}
                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/50 border border-purple-200/70">
                              <div className="flex items-center gap-2.5">
                                <span className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-xs shrink-0">
                                  <i className="fas fa-crown"></i>
                                </span>
                                <div>
                                  <span className="text-xs font-black text-purple-950 block">وسام الامتحان الشامل والتراكمي 🎯</span>
                                  <span className="text-[10px] text-purple-700 font-bold block">للامتحانات التي تغطي عدة وحدات</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCertSettings(prev => {
                                    const next = { ...prev, enableComprehensiveCerts: !prev.enableComprehensiveCerts };
                                    localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                  certSettings.enableComprehensiveCerts ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/30' : 'bg-gray-200 text-gray-600'
                                }`}
                              >
                                {certSettings.enableComprehensiveCerts ? 'مُفعّل' : 'معطّل'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* البطاقة 2: ضبط إتمام الوحدات وعدد الدروس المتوقعة لكل وحدة */}
                        <div className="bg-white border-2 border-blue-100 rounded-2xl p-4 sm:p-5 mb-6 shadow-sm">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-100">
                            <div>
                              <h4 className="text-sm sm:text-base font-black text-blue-950 flex items-center gap-2">
                                <i className="fas fa-layer-group text-blue-600"></i>
                                <span>ضبط اكتمال الوحدات والدروس المتوقعة:</span>
                              </h4>
                              <p className="text-xs text-gray-500 font-bold mt-1 leading-relaxed">
                                حدد إجمالي الدروس الفعلي لكل وحدة وما إذا كانت الوحدة مكتملة التنزيل أم لا تزال قيد الإضافة (لحماية شهادة إتمام الوحدة من الصدور المبكر).
                              </p>
                            </div>
                            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200 self-start sm:self-auto shrink-0">
                              {toEasternArabic(data.length)} وحدات مسجلة
                            </span>
                          </div>

                          <div className="space-y-3">
                            {data.map((unit, idx) => {
                              const currentLessonsCount = unit.lessons.length;
                              const expectedLessons = certSettings.unitExpectedLessons[unit.id] ?? currentLessonsCount;
                              const isCompleted = certSettings.unitCompletedStatus[unit.id] ?? (expectedLessons > 0 && currentLessonsCount >= expectedLessons);

                              return (
                                <div key={unit.id} className="p-3.5 sm:p-4 rounded-xl bg-gray-50/80 border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3 transition-all hover:bg-gray-100/70">
                                  <div className="flex-1 min-w-[200px]">
                                    <div className="flex items-center gap-2">
                                      <span className="w-6 h-6 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center justify-center shrink-0">
                                        {toEasternArabic(idx + 1)}
                                      </span>
                                      <span className="font-black text-gray-800 text-sm sm:text-base">
                                        {unit.title}
                                      </span>
                                    </div>
                                    <div className="text-xs text-gray-500 font-bold mt-1.5 flex flex-wrap items-center gap-2 mr-8">
                                      <span>الدروس المرفوعة بالشيت حالياً: <strong className="text-blue-700 font-black">{toEasternArabic(currentLessonsCount)}</strong></span>
                                      <span>•</span>
                                      <span className={currentLessonsCount < expectedLessons ? 'text-amber-600 font-black' : 'text-emerald-600 font-black'}>
                                        {currentLessonsCount < expectedLessons 
                                          ? `متبقي ${toEasternArabic(expectedLessons - currentLessonsCount)} دروس لتكتمل الوحدة` 
                                          : 'جميع الدروس مرفوعة'}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-3 self-end md:self-center">
                                    {/* إدخال عدد الدروس المتوقعة */}
                                    <div className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-xl px-3 py-1.5 shadow-sm">
                                      <label className="text-xs font-bold text-gray-700 shrink-0">
                                        إجمالي الدروس المتوقع:
                                      </label>
                                      <input 
                                        type="number"
                                        min="1"
                                        max="50"
                                        value={expectedLessons}
                                        onChange={e => {
                                          const val = Math.max(1, Number(e.target.value) || 1);
                                          setCertSettings(prev => {
                                            const next = {
                                              ...prev,
                                              unitExpectedLessons: { ...prev.unitExpectedLessons, [unit.id]: val }
                                            };
                                            localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                            return next;
                                          });
                                        }}
                                        className="w-14 text-center font-black text-blue-800 text-sm outline-none bg-blue-50/50 rounded-lg py-1 border border-blue-200"
                                      />
                                    </div>

                                    {/* زر حالة الوحدة */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCertSettings(prev => {
                                          const nextStatus = !isCompleted;
                                          const next = {
                                            ...prev,
                                            unitCompletedStatus: { ...prev.unitCompletedStatus, [unit.id]: nextStatus }
                                          };
                                          localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                          return next;
                                        });
                                      }}
                                      className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 ${
                                        isCompleted 
                                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30'
                                          : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30'
                                      }`}
                                    >
                                      <i className={`fas ${isCompleted ? 'fa-check-circle' : 'fa-hourglass-half'}`}></i>
                                      <span>{isCompleted ? 'الوحدة مكتملة بالكامل 🏆' : 'قيد التنزيل (جاري النشر) ⏳'}</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* البطاقة 3: ربط وتخصيص الامتحانات الشاملة لعدة وحدات */}
                        <div className="bg-white border-2 border-purple-100 rounded-2xl p-4 sm:p-5 shadow-sm">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-100">
                            <div>
                              <h4 className="text-sm sm:text-base font-black text-purple-950 flex items-center gap-2">
                                <i className="fas fa-crown text-purple-600"></i>
                                <span>تخصيص الامتحانات الشاملة والتراكمية (عدة وحدات):</span>
                              </h4>
                              <p className="text-xs text-gray-500 font-bold mt-1 leading-relaxed">
                                اختر الوحدات التي يغطيها كل امتحان شامل، ليتم كتابة أسمائها الصريحة في شهادة التفوق (مثال: امتحان شامل على الوحدة الأولى + الثانية).
                              </p>
                            </div>
                            <span className="text-xs font-bold text-purple-700 bg-purple-50 px-3 py-1 rounded-full border border-purple-200 self-start sm:self-auto shrink-0">
                              تغطية متعددة للوحدات
                            </span>
                          </div>

                          {/* قائمة الاختبارات المؤهلة أو المضافة كامتحان شامل */}
                          {(() => {
                            const allLessons = data.flatMap(u => u.lessons.map(l => ({ ...l, unitTitle: u.title, unitId: u.id })));
                            const comprehensiveLessons = allLessons.filter(l => 
                              certSettings.comprehensiveExamsConfig[l.id]?.isComprehensive || 
                              l.title.includes('شامل') || 
                              l.title.includes('تراكمي')
                            );

                            return (
                              <div className="space-y-4">
                                {comprehensiveLessons.length === 0 ? (
                                  <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-200 text-center text-xs text-purple-800 font-bold">
                                    لا توجد اختبارات تحمل كلمة "شامل" أو "تراكمي" في العنوان حالياً. يمكنك تفعيل أي درس أدناه ليصبح امتحاناً شاملاً.
                                  </div>
                                ) : (
                                  comprehensiveLessons.map(lesson => {
                                    const cfg = certSettings.comprehensiveExamsConfig[lesson.id] || {
                                      isComprehensive: true,
                                      coveredUnits: [lesson.unitId],
                                      customTitle: ''
                                    };
                                    const covered = cfg.coveredUnits || [lesson.unitId];
                                    const coveredTitles = covered.map(uId => data.find(u => u.id === uId)?.title).filter(Boolean);
                                    const autoTitle = coveredTitles.length > 0 
                                      ? `الامتحان الشامل على: ${coveredTitles.join(' + ')}` 
                                      : lesson.title;

                                    return (
                                      <div key={lesson.id} className="p-4 rounded-2xl bg-purple-50/40 border-2 border-purple-200/80 transition-all space-y-3">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-purple-100">
                                          <div className="flex items-center gap-2">
                                            <span className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center text-xs shrink-0 shadow-sm">
                                              <i className="fas fa-crown"></i>
                                            </span>
                                            <div>
                                              <h5 className="font-black text-gray-900 text-sm sm:text-base">
                                                {lesson.title}
                                              </h5>
                                              <span className="text-xs text-purple-700 font-bold">
                                                تابعة لـ: {lesson.unitTitle}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setCertSettings(prev => {
                                                  const currentIsComp = prev.comprehensiveExamsConfig[lesson.id]?.isComprehensive ?? true;
                                                  const next = {
                                                    ...prev,
                                                    comprehensiveExamsConfig: {
                                                      ...prev.comprehensiveExamsConfig,
                                                      [lesson.id]: {
                                                        ...prev.comprehensiveExamsConfig[lesson.id],
                                                        isComprehensive: !currentIsComp,
                                                        coveredUnits: prev.comprehensiveExamsConfig[lesson.id]?.coveredUnits || [lesson.unitId]
                                                      }
                                                    }
                                                  };
                                                  localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                                  return next;
                                                });
                                              }}
                                              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                                (cfg.isComprehensive ?? true)
                                                  ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/30'
                                                  : 'bg-gray-200 text-gray-600'
                                              }`}
                                            >
                                              {(cfg.isComprehensive ?? true) ? 'امتحان شامل مُفعّل ✅' : 'معطّل (درس عادي)'}
                                            </button>
                                          </div>
                                        </div>

                                        {(cfg.isComprehensive ?? true) && (
                                          <div className="space-y-3 pt-1">
                                            {/* اختيار الوحدات المشمولة في الامتحان */}
                                            <div>
                                              <label className="block text-xs font-black text-purple-950 mb-1.5">
                                                الوحدات التي يغطيها هذا الامتحان الشامل (اختر كل ما ينطبق):
                                              </label>
                                              <div className="flex flex-wrap gap-2">
                                                {data.map(u => {
                                                  const isSelected = covered.includes(u.id);
                                                  return (
                                                    <button
                                                      key={u.id}
                                                      type="button"
                                                      onClick={() => {
                                                        setCertSettings(prev => {
                                                          const curr = prev.comprehensiveExamsConfig[lesson.id]?.coveredUnits || [lesson.unitId];
                                                          const nextCovered = isSelected 
                                                            ? curr.filter(id => id !== u.id)
                                                            : [...curr, u.id];
                                                          const next = {
                                                            ...prev,
                                                            comprehensiveExamsConfig: {
                                                              ...prev.comprehensiveExamsConfig,
                                                              [lesson.id]: {
                                                                ...prev.comprehensiveExamsConfig[lesson.id],
                                                                isComprehensive: true,
                                                                coveredUnits: nextCovered.length > 0 ? nextCovered : [lesson.unitId]
                                                              }
                                                            }
                                                          };
                                                          localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                                          return next;
                                                        });
                                                      }}
                                                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border ${
                                                        isSelected
                                                          ? 'bg-purple-100 text-purple-900 border-purple-400 shadow-sm'
                                                          : 'bg-white text-gray-600 border-gray-200 hover:border-purple-200'
                                                      }`}
                                                    >
                                                      <i className={`fas ${isSelected ? 'fa-check-square text-purple-600' : 'fa-square text-gray-300'}`}></i>
                                                      <span>{u.title}</span>
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            </div>

                                            {/* تخصيص عنوان الشهادة */}
                                            <div>
                                              <label className="block text-xs font-black text-purple-950 mb-1 flex items-center justify-between">
                                                <span>مسمى الاختبار المطبوع على الشهادة (اتركه فارغاً للاعتماد على التسمية التلقائية):</span>
                                                <span className="text-[10px] text-gray-500 font-bold">معاينة: {cfg.customTitle || autoTitle}</span>
                                              </label>
                                              <input
                                                type="text"
                                                placeholder={autoTitle}
                                                value={cfg.customTitle || ''}
                                                onChange={e => {
                                                  const val = e.target.value;
                                                  setCertSettings(prev => {
                                                    const next = {
                                                      ...prev,
                                                      comprehensiveExamsConfig: {
                                                        ...prev.comprehensiveExamsConfig,
                                                        [lesson.id]: {
                                                          ...prev.comprehensiveExamsConfig[lesson.id],
                                                          isComprehensive: true,
                                                          coveredUnits: prev.comprehensiveExamsConfig[lesson.id]?.coveredUnits || [lesson.unitId],
                                                          customTitle: val
                                                        }
                                                      }
                                                    };
                                                    localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                                    return next;
                                                  });
                                                }}
                                                className="w-full bg-white border border-purple-200 focus:border-purple-500 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                                              />
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                )}

                                {/* خيار إضافة أي درس آخر ليصبح امتحاناً شاملاً */}
                                <div className="p-3 bg-purple-50/30 rounded-xl border border-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="text-xs text-purple-900 font-black flex items-center gap-2">
                                    <i className="fas fa-plus-circle text-purple-600"></i>
                                    <span>ترقية أي درس عادي إلى امتحان شامل:</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <select
                                      id="addCompExamSelect"
                                      className="bg-white border border-purple-300 rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                                    >
                                      {allLessons
                                        .filter(l => !comprehensiveLessons.some(cl => cl.id === l.id))
                                        .map(l => (
                                          <option key={l.id} value={l.id}>{l.unitTitle} - {l.title}</option>
                                        ))
                                      }
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const sel = document.getElementById('addCompExamSelect') as HTMLSelectElement | null;
                                        if (!sel || !sel.value) return;
                                        const chosenId = sel.value;
                                        const chosenLesson = allLessons.find(l => l.id === chosenId);
                                        if (!chosenLesson) return;
                                        setCertSettings(prev => {
                                          const next = {
                                            ...prev,
                                            comprehensiveExamsConfig: {
                                              ...prev.comprehensiveExamsConfig,
                                              [chosenId]: {
                                                isComprehensive: true,
                                                coveredUnits: [chosenLesson.unitId],
                                                customTitle: ''
                                              }
                                            }
                                          };
                                          localStorage.setItem('app_cert_settings', JSON.stringify(next));
                                          return next;
                                        });
                                      }}
                                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
                                    >
                                      + إضافة كشامل
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* 7. إعدادات الأمان ومكافحة الغش */}
                    {(settingsSubTab === 'security' || settingsSubTab === 'all') && (
                      <div className="mb-6 animate-fade-in bg-gray-50/50 p-4 sm:p-5 rounded-2xl border border-gray-200/80">
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200">
                          <h3 className="text-base sm:text-lg font-black text-primary flex items-center gap-2">
                            <i className="fas fa-shield-halved text-secondary"></i>
                            <span>منظومة الأمان ومكافحة الغش أثناء الاختبارات</span>
                          </h3>
                          <span className="text-xs bg-blue-100 text-blue-800 font-bold px-2.5 py-1 rounded-full">
                            حماية متقدمة 🛡️
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                          {/* Option 1: منع لقطة الشاشة والنسخ */}
                          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between gap-3">
                            <span className="font-black text-gray-800 text-sm flex items-center gap-2.5">
                              <i className="fas fa-camera-slash text-rose-500 text-base"></i>
                              <span>منع لقطة الشاشة والنسخ</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSecuritySettings(prev => {
                                  const next = { ...prev, preventScreenshot: !prev.preventScreenshot };
                                  localStorage.setItem('app_exam_security_settings', JSON.stringify(next));
                                  return next;
                                });
                              }}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                securitySettings.preventScreenshot ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30' : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {securitySettings.preventScreenshot ? 'مفعل' : 'معطل'}
                            </button>
                          </div>

                          {/* Option 2: العلامة المائية باسم ورقم هاتف الطالب */}
                          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between gap-3">
                            <span className="font-black text-gray-800 text-sm flex items-center gap-2.5">
                              <i className="fas fa-fingerprint text-indigo-500 text-base"></i>
                              <span>العلامة المائية باسم ورقم الطالب</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSecuritySettings(prev => {
                                  const next = { ...prev, watermarkEnabled: !prev.watermarkEnabled };
                                  localStorage.setItem('app_exam_security_settings', JSON.stringify(next));
                                  return next;
                                });
                              }}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                securitySettings.watermarkEnabled ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/30' : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {securitySettings.watermarkEnabled ? 'مفعل' : 'معطل'}
                            </button>
                          </div>

                          {/* Option 3: وضع الإغلاق ومنع مغادرة شاشة الاختبار */}
                          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between gap-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-black text-gray-800 text-sm flex items-center gap-2.5">
                                <i className="fas fa-lock text-amber-500 text-base"></i>
                                <span>قفل ومراقبة مغادرة الامتحان</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSecuritySettings(prev => {
                                    const next = { ...prev, lockdownEnabled: !prev.lockdownEnabled };
                                    localStorage.setItem('app_exam_security_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                  securitySettings.lockdownEnabled ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30' : 'bg-gray-200 text-gray-600'
                                }`}
                              >
                                {securitySettings.lockdownEnabled ? 'مفعل' : 'معطل'}
                              </button>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2.5 border-t border-gray-100">
                              <span className="text-xs font-black text-gray-700">الحد الأقصى للمخالفات قبل سحب الامتحان:</span>
                              <select
                                value={securitySettings.maxTabSwitchStrikes}
                                onChange={e => {
                                  const val = Number(e.target.value) || 2;
                                  setSecuritySettings(prev => {
                                    const next = { ...prev, maxTabSwitchStrikes: val };
                                    localStorage.setItem('app_exam_security_settings', JSON.stringify(next));
                                    return next;
                                  });
                                }}
                                className="w-full sm:w-auto px-2.5 py-1.5 text-xs font-black rounded-lg border border-gray-300 bg-gray-50 text-gray-800 focus:outline-none focus:border-primary"
                              >
                                <option value={1}>مخالفة واحدة (إنهاء فوري)</option>
                                <option value={2}>مخالفتان (إنذار ثم إنهاء)</option>
                                <option value={3}>3 مخالفات</option>
                                <option value={4}>4 مخالفات</option>
                                <option value={5}>5 مخالفات</option>
                                <option value={6}>6 مخالفات (مضاعف - موصى به)</option>
                                <option value={8}>8 مخالفات</option>
                                <option value={10}>10 مخالفات</option>
                              </select>
                            </div>
                          </div>

                          {/* Option 4: إلزام الاختبار دون إنترنت (فصل النت أثناء الامتحان) */}
                          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between gap-3">
                            <span className="font-black text-gray-800 text-sm flex items-center gap-2.5">
                              <i className="fas fa-plane text-teal-600 text-base"></i>
                              <span>اشتراط الاختبار دون إنترنت</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSecuritySettings(prev => {
                                  const next = { ...prev, offlineModeEnabled: !prev.offlineModeEnabled };
                                  localStorage.setItem('app_exam_security_settings', JSON.stringify(next));
                                  return next;
                                });
                              }}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm active:scale-95 ${
                                securitySettings.offlineModeEnabled ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-600/30' : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {securitySettings.offlineModeEnabled ? 'مفعل' : 'معطل'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* زر الحفظ الموحد المثبت لجميع الأقسام */}
                    <div className="pt-4 border-t border-gray-200 mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-50/50 p-4 rounded-2xl">
                      <div className="text-xs text-gray-500 font-bold flex items-center gap-1.5">
                        <i className="fas fa-cloud-upload-alt text-primary text-sm"></i>
                        <span>يتم حفظ وتطبيق التعديلات ومزامنتها سحابياً فور الضغط على زر الحفظ.</span>
                      </div>
                      <button 
                        onClick={handleUpdateFee} 
                        className="w-full sm:w-auto px-7 py-3 text-white font-black rounded-xl shadow-lg shadow-blue-900/20 transition-all bg-primary hover:bg-blue-800 active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <i className="fas fa-save text-base"></i>
                        <span>حفظ كافة الإعدادات 💾</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {showAdminScrollTop && (
            <button
              onClick={() => adminScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="fixed bottom-6 left-6 md:bottom-8 md:left-8 bg-primary hover:bg-blue-800 text-white w-12 h-12 rounded-full shadow-2xl border-2 border-blue-400 flex items-center justify-center transition-all hover:-translate-y-1 active:scale-95 z-[999] cursor-pointer animate-fade-in"
              title="العودة للأعلى"
            >
              <i className="fas fa-arrow-up text-xl"></i>
            </button>
          )}
        </div>
      );
    }
    return null;
  };
  
  return (
    <React.Fragment>
      {renderScreen()}
      
      {lessonModalOptions && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl text-center animate-fade-in flex flex-col relative max-h-[90dvh] overflow-y-auto custom-scrollbar">
            <div className="absolute top-0 right-0 w-full h-2 bg-secondary"></div>
            
            <h2 className="text-xl md:text-2xl font-black text-primary mb-6 mt-2">{formatLessonTitleJSX(lessonModalOptions.title)}</h2>
            
            {lessonModalOptions.video && (
              <div className="mb-4 w-full rounded-2xl overflow-hidden shadow-sm border border-gray-200 relative flex items-center justify-center" style={lessonModalOptions.video.startsWith('http') ? { paddingTop: '56.25%', backgroundColor: 'black' } : { minHeight: '120px', backgroundColor: '#f3f4f6' }}>
                {lessonModalOptions.video.startsWith('http') ? (
                  <iframe 
                    className="absolute top-0 left-0 w-full h-full"
                    src={getYoutubeEmbedLink(lessonModalOptions.video)} 
                    title="YouTube video" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen>
                  </iframe>
                ) : (
                  <div className="flex flex-col items-center justify-center p-4">
                    <i className="fas fa-video-slash text-4xl text-gray-400 mb-2"></i>
                    <span className="font-black text-rose-600 text-lg">{lessonModalOptions.video}</span>
                  </div>
                )}
              </div>
            )}
            
            {lessonModalOptions.audio && (
              <div className="bg-blue-50 border-2 border-blue-100 dark:bg-gray-800/10 dark:border-gray-800 rounded-2xl p-4 mb-4" dir="rtl">
                <p className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-3 flex items-center justify-center gap-2">
                  <i className="fas fa-headphones-alt text-xl"></i> الاستماع للشرح:
                </p>
                {lessonModalOptions.audio.startsWith('http') ? (
                  <div className="text-center space-y-2">
                    {globalAudio && globalAudio.url === lessonModalOptions.audio ? (
                      <div className="space-y-3 bg-white dark:bg-gray-900 border border-blue-100 dark:border-gray-800 rounded-xl p-3 shadow-sm">
                        <div className="flex items-center justify-center gap-3">
                          <button 
                            onClick={toggleGlobalAudio} 
                            className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center text-lg transition-transform active:scale-95 shadow-md cursor-pointer"
                            title={isGlobalAudioPlaying ? "إيقاف مؤقت" : "تشغيل"}
                            disabled={isAudioLoading}
                          >
                            {isAudioLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className={`fas ${isGlobalAudioPlaying ? 'fa-pause' : 'fa-play ml-1'}`}></i>}
                          </button>
                          
                          <div className="text-right flex-1 min-w-0">
                            <p className="text-xs text-blue-600 dark:text-blue-400 font-bold">يتم تشغيل الشرح الصوتي 🎧</p>
                          </div>
                        </div>

                        {/* Progress slider synced globally */}
                        <div className="space-y-1">
                          <input 
                            type="range" 
                            min={0} 
                            max={globalAudioDuration || 100} 
                            value={globalAudioTime} 
                            onChange={handleGlobalAudioSeek} 
                            className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                          />
                          <div className="flex justify-between text-[10px] text-gray-500 font-bold" dir="ltr">
                            <span>{formatAudioTime(globalAudioTime)}</span>
                            <span>{formatAudioTime(globalAudioDuration)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => playLessonAudio(lessonModalOptions.audio!, lessonModalOptions.title)}
                        className={`w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2.5 cursor-pointer text-base ${isAudioLoading ? 'opacity-80 cursor-wait' : ''}`}
                        disabled={isAudioLoading}
                      >
                        {isAudioLoading ? <i className="fas fa-spinner fa-spin text-xl"></i> : <i className="fas fa-play-circle text-xl animate-pulse"></i>}
                        {isAudioLoading ? 'جاري التحميل...' : 'تشغيل الشرح الصوتي والاستماع في الخلفية'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-white border border-blue-200 rounded-xl py-3 px-4 text-center shadow-sm">
                    <span className="font-black text-rose-600 text-lg">{lessonModalOptions.audio}</span>
                  </div>
                )}
              </div>
            )}
            
            {(() => {
              const files: Array<{ url: string; name: string }> = (lessonModalOptions.pdfFiles && lessonModalOptions.pdfFiles.length > 0)
                ? lessonModalOptions.pdfFiles
                : (lessonModalOptions.pdf ? [{ url: lessonModalOptions.pdf, name: `مذكرة ${lessonModalOptions.title}` }] : []);
              if (files.length === 0) return null;
              return (
                <div className="space-y-3 mb-4" dir="rtl">
                  {files.map((file, fIdx) => (
                    <div key={fIdx} className="bg-gradient-to-r from-rose-50 to-orange-50 dark:bg-gray-800/30 border-2 border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 text-center animate-fade-in shadow-xs">
                      <div className="flex items-center justify-center gap-2 mb-2.5">
                        <i className="fas fa-file-pdf text-xl text-rose-600"></i>
                        <span className="text-sm font-black text-rose-900 dark:text-rose-200 truncate" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedPdfForView({ title: file.name, url: file.url })}
                          className="w-full sm:flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 text-sm cursor-pointer"
                        >
                          <i className="fas fa-book-open"></i>
                          <span>تصفح المذكرة 📖</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadWatermarkedPdf(file.url, file.name)}
                          disabled={isDownloadingPdf}
                          className="w-full sm:w-auto py-3 px-4 bg-white dark:bg-gray-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-gray-700 border border-rose-300 dark:border-rose-800 font-bold rounded-xl shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5 text-xs cursor-pointer disabled:opacity-60"
                          title="تنزيل نسختك المعتمدة بالعلامة المائية باسمك ورقم هاتفك"
                        >
                          <i className={`fas ${isDownloadingPdf ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                          <span>{isDownloadingPdf ? 'جاري الختم والتنزيل... ⏳' : 'تنزيل المذكرة 📥'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            
            {(() => {
              const cfg = lessonModalOptions ? getExamConfig(lessonModalOptions.id) : null;
              const sCat = getCurrentStudentCategory();
              const avail = cfg ? getExamAvailability(cfg, sCat) : null;
              const phone = inputPhone || localStorage.getItem('loggedInPhone') || '';
              const cleanPhone = formatPhoneStr(phone);
              const submissions = getStudentSubmissions(cleanPhone);
              const pendingSub = lessonModalOptions ? submissions.find(s => (s.lessonId === lessonModalOptions.id || s.quizTitle?.trim() === lessonModalOptions.title?.trim()) && !s.isFullyApproved) : null;
              const isLocked = Boolean((avail && (avail.status === 'upcoming' || avail.status === 'expired' || avail.status === 'not_targeted')) || pendingSub);

              return (
                <div className="flex flex-col gap-3 mt-2 mt-auto">
                  <button 
                    onClick={() => {
                      if (!lessonModalOptions) return;
                      startQuizForLesson(lessonModalOptions);
                    }} 
                    className={`w-full font-black text-lg py-3 rounded-xl shadow-md transition-colors flex justify-center items-center gap-2 cursor-pointer ${
                      isLocked
                        ? pendingSub
                          ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/30'
                          : avail?.status === 'upcoming'
                          ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/30'
                          : avail?.status === 'expired'
                          ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30'
                          : 'bg-gray-500 text-white'
                        : 'bg-primary text-white hover:bg-gray-900'
                    }`}
                  >
                    <i className={`fas ${
                      isLocked
                        ? pendingSub
                          ? 'fa-hourglass-half'
                          : avail?.status === 'upcoming'
                          ? 'fa-clock'
                          : avail?.status === 'expired'
                          ? 'fa-lock'
                          : 'fa-ban'
                        : 'fa-pen-alt'
                    }`}></i>
                    <span>
                      {pendingSub
                        ? 'الامتحان قيد مراجعة المعلم ⏳'
                        : isLocked
                        ? avail?.status === 'upcoming'
                          ? `يبدأ: ${formatScheduleDate(avail?.startDate)} ⏳`
                          : avail?.status === 'expired'
                          ? 'الامتحان منتهي ومغلق 🔒'
                          : 'غير متاح لفئتك 🚫'
                        : 'الدخول للتدريبات'}
                    </span>
                  </button>
                  <button onClick={() => setLessonModalOptions(null)} className="w-full bg-gray-100 text-gray-600 font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors">
                    إغلاق وعودة
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
      
      {/* نافذة عارض الـ PDF المدمج للتصفح السريع داخل التطبيق */}
      {selectedPdfForView && (
        <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-2 sm:p-4 animate-fade-in" dir="rtl">
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800">
            {/* شريط رأس العارض */}
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-rose-600/20 text-rose-500 flex items-center justify-center shrink-0">
                  <i className="fas fa-file-pdf text-xl"></i>
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-sm sm:text-base truncate">{selectedPdfForView.title}</h3>
                  <p className="text-[10px] text-gray-400">تصفح وقراءة مذكرة الدرس مباشرة من داخل التطبيق</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownloadWatermarkedPdf(selectedPdfForView.url, selectedPdfForView.title)}
                  disabled={isDownloadingPdf}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-60"
                  title="تنزيل نسختك المعتمدة بالعلامة المائية"
                >
                  <i className={`fas ${isDownloadingPdf ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                  <span className="hidden sm:inline">{isDownloadingPdf ? 'جاري الختم...' : 'تنزيل المذكرة 📥'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPdfForView(null)}
                  className="bg-gray-800 hover:bg-gray-700 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
                  title="إغلاق العارض"
                >
                  <i className="fas fa-times text-base"></i>
                </button>
              </div>
            </div>

            {/* إطار عرض الـ PDF مع طبقة الحماية والعلامة المائية العائمة لمنع التصوير */}
            <div className="flex-1 w-full bg-slate-100 dark:bg-gray-950 relative overflow-hidden">
              <iframe
                src={getPdfViewerLink(selectedPdfForView.url)}
                className="w-full h-full border-0"
                title={selectedPdfForView.title}
                allowFullScreen
              />

              {/* علامة مائية عائمة مدمجة خلف الكلام بدون أي خلفية أو تشويش على القراءة */}
              <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between items-center overflow-hidden select-none mix-blend-multiply dark:mix-blend-screen">
                {/* شبكة البيانات المتكررة للردع الأمني في الخلفية بخط خفيف جداً */}
                <div className="absolute inset-0 flex flex-col justify-around items-center opacity-10 overflow-hidden">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex gap-8 whitespace-nowrap rotate-[-22deg] text-xs sm:text-sm font-black text-gray-700 dark:text-gray-300">
                      <span>{studentName || 'طالب موسوعة الكنز'}</span>
                      <span>{formatPhoneStr(inputPhone || localStorage.getItem('loggedInPhone') || '')}</span>
                      <span>موسوعة الكنز التعليمية</span>
                      <span>{studentName || 'طالب موسوعة الكنز'}</span>
                      <span>{formatPhoneStr(inputPhone || localStorage.getItem('loggedInPhone') || '')}</span>
                    </div>
                  ))}
                </div>

                {/* الختم المركزي الشفاف المدمج خلف الكلام بدون أي إطار أو خلفية بيضاء تحجب القراءة */}
                <div className="my-auto text-center flex flex-col items-center justify-center p-4 scale-95 sm:scale-105 rotate-[-12deg] opacity-35">
                  <div className="flex items-center justify-center gap-2 font-black leading-none tracking-wider text-4xl sm:text-6xl">
                    <span className="text-amber-500 font-black">موسوعة</span>
                    <span className="text-blue-600 font-black">الكنز</span>
                  </div>
                  <div className="mt-2 text-2xl sm:text-4xl font-black text-rose-600 tracking-wide">
                    أ/ إسلام سعود
                  </div>
                  <div className="mt-1 text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300">
                    التاريخ • 2 بكالوريا
                  </div>
                  <div className="mt-2 text-[11px] sm:text-xs font-black text-red-600">
                    مرخص للطالب: {studentName || 'طالب مسجل'} ({formatPhoneStr(inputPhone || localStorage.getItem('loggedInPhone') || '')})
                  </div>
                  <div className="mt-1.5 text-[10px] sm:text-xs font-black text-red-600">
                    ⚠️ ملكية فكرية خاصة - يُحظر تماماً تصوير أو تداول هذه المذكرة خارج المنصة
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {dialog.isOpen && (
        <div className="fixed inset-0 bg-black/70 z-[999] flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in">
            <i className={`fas ${dialog.type === 'confirm' ? 'fa-question-circle text-primary' : 'fa-info-circle text-secondary'} text-5xl mb-4 block`}></i>
            <h2 className="text-xl font-black text-gray-800 mb-6 whitespace-pre-line leading-relaxed">{dialog.message}</h2>
            <div className="flex gap-3">
              {dialog.type === 'confirm' ? (
                <React.Fragment>
                  <button onClick={() => { if(dialog.onConfirm) dialog.onConfirm(); closeDialog(); }} className="flex-1 bg-secondary text-white font-black text-lg py-3 rounded-xl hover:bg-green-700 transition-colors">تأكيد</button>
                  <button onClick={closeDialog} className="flex-1 bg-gray-200 text-gray-800 font-black text-lg py-3 rounded-xl hover:bg-gray-300 transition-colors">إلغاء</button>
                </React.Fragment>
              ) : (
                <button onClick={closeDialog} className="w-full bg-primary text-white font-black text-lg py-3 rounded-xl hover:bg-gray-900 transition-colors">حسناً</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* شاشة مراجعة الامتحان التفاعلية قبل التسليم النهائي */}
      {preSubmitReviewModalOpen && activeLesson && createPortal(
        <div 
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[99999] flex items-center justify-center p-2 sm:p-4 md:p-6 animate-fade-in" 
          dir="rtl"
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent dark:from-primary/20 p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center text-xl shadow-md shrink-0">
                  <i className="fas fa-list-check"></i>
                </div>
                <div>
                  <h3 className="text-base sm:text-lg md:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <span>مراجعة إجابات الامتحان قبل التسليم</span>
                    <span className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">خطوة تأكيدية</span>
                  </h3>
                  <p className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                    {activeLesson.title} • راجع إجاباتك لكل سؤال، واضغط على أي سؤال للعودة إليه وتعديله قبل التسليم النهائي.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreSubmitReviewModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                title="إغلاق والعودة للامتحان"
              >
                <i className="fas fa-times text-base"></i>
              </button>
            </div>

            {/* Quick Stats Bar */}
            <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs sm:text-sm font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-white dark:bg-slate-900 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                  📊 إجمالي الأسئلة: <b className="text-primary font-black">{toEasternArabic(activeLesson.questions.length)}</b>
                </span>
                <span className="bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                  ✅ تم الإجابة: <b className="font-black">{toEasternArabic(examReviewStats.answered)}</b>
                </span>
                <span className={`px-3 py-1 rounded-xl border font-bold ${
                  examReviewStats.unanswered > 0
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 animate-pulse'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
                }`}>
                  ⚠️ أسئلة متروكة: <b className="font-black">{toEasternArabic(examReviewStats.unanswered)}</b>
                </span>
              </div>
            </div>

            {/* Category Filter Tabs */}
            <div className="p-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 sm:gap-2 overflow-x-auto shrink-0 scrollbar-none">
              <button
                type="button"
                onClick={() => setPreSubmitFilter('all')}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                  preSubmitFilter === 'all'
                    ? 'bg-primary text-white shadow-md'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <i className="fas fa-layer-group text-xs"></i>
                <span>الكل</span>
                <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded-full">{toEasternArabic(examReviewStats.total)}</span>
              </button>

              {examReviewStats.mcq > 0 && (
                <button
                  type="button"
                  onClick={() => setPreSubmitFilter('mcq')}
                  className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    preSubmitFilter === 'mcq'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <i className="fas fa-check-circle text-xs"></i>
                  <span>اختر من متعدد 🔘</span>
                  <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded-full">{toEasternArabic(examReviewStats.mcq)}</span>
                </button>
              )}

              {examReviewStats.tf > 0 && (
                <button
                  type="button"
                  onClick={() => setPreSubmitFilter('tf')}
                  className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    preSubmitFilter === 'tf'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <i className="fas fa-scale-balanced text-xs"></i>
                  <span>صح وخطأ ⚖️</span>
                  <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded-full">{toEasternArabic(examReviewStats.tf)}</span>
                </button>
              )}

              {examReviewStats.essay > 0 && (
                <button
                  type="button"
                  onClick={() => setPreSubmitFilter('essay')}
                  className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    preSubmitFilter === 'essay'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <i className="fas fa-pen-fancy text-xs"></i>
                  <span>الأسئلة المقالية ✍️</span>
                  <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded-full">{toEasternArabic(examReviewStats.essay)}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setPreSubmitFilter('unanswered')}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                  preSubmitFilter === 'unanswered'
                    ? 'bg-rose-600 text-white shadow-md'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <i className="fas fa-triangle-exclamation text-xs"></i>
                <span>المتروكة ⚠️</span>
                <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded-full">{toEasternArabic(examReviewStats.unanswered)}</span>
              </button>
            </div>

            {/* Questions List */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
              {filteredReviewQuestions.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold">
                  <i className="fas fa-inbox text-4xl mb-3 opacity-40"></i>
                  <p>لا توجد أسئلة تطابق هذا الفلتر حالياً</p>
                </div>
              ) : (
                filteredReviewQuestions.map((item) => {
                  const typeLabel = item.category === 'essay' ? 'سؤال مقالي' : (item.category === 'tf' ? 'صح وخطأ' : 'اختر من متعدد');
                  const typeColor = item.category === 'essay' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' : (item.category === 'tf' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300');

                  return (
                    <div
                      key={item.idx}
                      className={`p-3 sm:p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        item.hasAns
                          ? 'bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 shadow-xs'
                          : 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 shadow-xs'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        {/* Top badges */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-xs font-black bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-lg">
                            سؤال {toEasternArabic(item.idx + 1)}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${typeColor}`}>
                            {typeLabel}
                          </span>
                          {item.hasAns ? (
                            <span className="text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 rounded-lg flex items-center gap-1">
                              <i className="fas fa-check text-[10px]"></i>
                              <span>تم الحل</span>
                            </span>
                          ) : (
                            <span className="text-[11px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 px-2 py-0.5 rounded-lg flex items-center gap-1 animate-pulse">
                              <i className="fas fa-exclamation-triangle text-[10px]"></i>
                              <span>لم تجب بعد</span>
                            </span>
                          )}
                        </div>

                        {/* Question Text */}
                        <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-relaxed">
                          {item.q.q}
                        </p>

                        {/* Student Answer Preview */}
                        <div className="mt-1.5 text-xs">
                          {item.hasAns ? (
                            <div className="text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50/60 dark:bg-emerald-950/30 px-2.5 py-1 rounded-lg inline-block border border-emerald-100 dark:border-emerald-900/40 max-w-full truncate">
                              <span className="text-slate-500 dark:text-slate-400 font-semibold ml-1">إجابتك:</span>
                              "{item.answerText.length > 90 ? item.answerText.substring(0, 90) + '...' : item.answerText}"
                            </div>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                              ⚠️ هذا السؤال فارغ حتى الآن
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Jump button */}
                      <div className="shrink-0 pt-1 sm:pt-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentQIndex(item.idx);
                            setPreSubmitReviewModalOpen(false);
                          }}
                          className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs px-3.5 py-2 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <span>انتقال للسؤال</span>
                          <i className="fas fa-arrow-left text-[11px]"></i>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 dark:bg-slate-800/80 p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2.5 shrink-0">
              {examReviewStats.unanswered > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2">
                  <i className="fas fa-exclamation-triangle text-amber-600 shrink-0"></i>
                  <span>
                    تنبيه: يوجد لديك <b>{toEasternArabic(examReviewStats.unanswered)}</b> أسئلة لم تقم بالإجابة عليها بعد. يمكنك تسليم الاختبار الآن أو مراجعتها أولاً.
                  </span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => setPreSubmitReviewModalOpen(false)}
                  className="w-full sm:w-auto bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 font-black text-xs sm:text-sm py-2.5 sm:py-3 px-5 rounded-xl transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                >
                  <i className="fas fa-arrow-right"></i>
                  <span>العودة للاختبار وإكمال الحل</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreSubmitReviewModalOpen(false);
                    finishQuizInternal();
                  }}
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm py-2.5 sm:py-3 px-6 rounded-xl shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                >
                  <i className="fas fa-paper-plane"></i>
                  <span>إنهاء وتسليم الامتحان نهائياً 🚀</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {essaySubmissionModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center border-t-8 border-primary flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 dark:bg-primary/20 text-primary flex items-center justify-center text-3xl mb-3 shadow-inner">
              {essaySubmissionModal.isGrading ? (
                <i className="fas fa-spinner fa-spin text-primary"></i>
              ) : (
                <i className="fas fa-check-circle text-emerald-600 dark:text-emerald-400"></i>
              )}
            </div>

            <h3 className="text-xl font-black text-primary dark:text-amber-400 mb-0.5">موسوعة الكنز التعليمي</h3>
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-3">{essaySubmissionModal.quizTitle}</span>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-slate-800 dark:to-slate-800/60 border-2 border-amber-200 dark:border-amber-700/50 rounded-2xl p-4 my-2 w-full text-center">
              <p className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 leading-relaxed">
                {essaySubmissionModal.message}
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700/60 mt-2 text-xs font-bold text-slate-600 dark:text-slate-300 text-center">
              🔒 <span className="text-primary font-black">تأكيد رسمي:</span> تم تسجيل واعتماد محاولتك الرسمية الأولى لمرة واحدة فقط، ولن يتم إرسال أي محاولات أخرى للمعلم.
            </div>

            {!essaySubmissionModal.isGrading && (
              <button
                type="button"
                onClick={() => {
                  setEssaySubmissionModal(null);
                  setActiveLesson(null);
                  setScreen('index');
                }}
                className="mt-5 w-full bg-primary hover:bg-primary-dark text-white font-black py-3 px-6 rounded-xl shadow-md active:scale-95 transition-all text-sm cursor-pointer"
              >
                العودة لقائمة الاختبارات 🏠
              </button>
            )}
          </div>
        </div>
      )}

      {showIOSInstallGuide && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative text-center">
            <button 
              onClick={() => setShowIOSInstallGuide(false)} 
              className="absolute top-4 left-4 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <i className="fas fa-times-circle text-2xl"></i>
            </button>
            <i className="fas fa-download text-5xl text-emerald-600 mb-3 block animate-bounce"></i>
            <h2 className="text-xl sm:text-2xl font-black text-primary mb-3">دليلك لتثبيت التطبيق 📱💻</h2>
            
            {/* Tabs Selector */}
            <div className="bg-gray-100 p-1.5 rounded-2xl flex gap-1 w-full mb-6">
              <button 
                onClick={() => setInstallTab('android')}
                className={`flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${installTab === 'android' ? 'bg-white text-emerald-700 shadow-md scale-102' : 'text-gray-600 hover:text-gray-800'}`}
              >
                أندرويد 🤖
              </button>
              <button 
                onClick={() => setInstallTab('ios')}
                className={`flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${installTab === 'ios' ? 'bg-white text-emerald-700 shadow-md scale-102' : 'text-gray-600 hover:text-gray-800'}`}
              >
                آيفون / آيباد 🍎
              </button>
              <button 
                onClick={() => setInstallTab('pc')}
                className={`flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${installTab === 'pc' ? 'bg-white text-emerald-700 shadow-md scale-102' : 'text-gray-600 hover:text-gray-800'}`}
              >
                الكمبيوتر 💻
              </button>
            </div>

            {/* TAB: Android */}
            {installTab === 'android' && (
              <div className="space-y-4 text-right mb-6 animate-fade-in">
                <p className="text-gray-700 font-bold mb-4 text-sm sm:text-base text-center leading-relaxed">
                  لتثبيت التطبيق مباشرة (مثل جوجل بلاي)، يجب أن يفتح الرابط في متصفح كروم <span className="text-primary font-black">الكامل</span>.
                </p>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">١</span>
                  <p className="text-sm font-bold text-gray-800">
                    إذا فتحت الرابط من الواتساب، اضغط على النقاط الثلاث <i className="fas fa-ellipsis-v text-primary mx-1 text-base"></i> <span className="text-red-600 font-black">بالأعلى</span> واختر <span className="text-primary font-black">"فتح في متصفح كروم" (Open in Chrome)</span>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٢</span>
                  <p className="text-sm font-bold text-gray-800">
                    انتظر ثوانٍ وسيظهر لك زر التثبيت أسفل الشاشة أو في القائمة (التثبيت كالتطبيقات الأصلية).
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٣</span>
                  <p className="text-sm font-bold text-gray-800">
                    في حال لم يظهر، اضغط على النقاط الثلاث <i className="fas fa-ellipsis-v text-primary mx-1 text-base"></i> واختر <span className="text-primary font-black">"تثبيت التطبيق" (Install App)</span> ولن يكون مجرد اختصار، بل تطبيق كامل!
                  </p>
                </div>
              </div>
            )}

            {/* TAB: iOS */}
            {installTab === 'ios' && (
              <div className="space-y-4 text-right mb-6 animate-fade-in">
                <p className="text-gray-700 font-bold mb-4 text-sm sm:text-base text-center leading-relaxed">
                  خطوات تثبيت التطبيق على أجهزة الآيفون والآيباد:
                </p>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">١</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على زر المشاركة <i className="fas fa-share-square text-primary mx-1 text-base"></i> في أسفل شاشة متصفح Safari.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٢</span>
                  <p className="text-sm font-bold text-gray-800">
                    قم بالتمرير لأسفل القائمة واضغط على <span className="text-primary font-black">"إضافة إلى الشاشة الرئيسية"</span> (Add to Home Screen).
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٣</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على كلمة "إضافة" (Add) في أعلى اليسار لتثبيت التطبيق بنجاح!
                  </p>
                </div>
              </div>
            )}

            {/* TAB: Computer */}
            {installTab === 'pc' && (
              <div className="space-y-4 text-right mb-6 animate-fade-in">
                <p className="text-gray-700 font-bold mb-4 text-sm sm:text-base text-center leading-relaxed">
                  خطوات تثبيت التطبيق على الكمبيوتر (ويندوز أو ماك):
                </p>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">١</span>
                  <p className="text-sm font-bold text-gray-800">
                    افتح المنصة من خلال متصفح <span className="text-primary font-black">Google Chrome</span> أو <span className="text-primary font-black">Microsoft Edge</span> على حاسوبك.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٢</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على زر التثبيت الصغير <i className="fas fa-plus-circle text-primary mx-1 text-base animate-pulse"></i> (أو السهم لأسفل) الذي يظهر في شريط العنوان (URL bar) بالجهة اليسرى/اليمنى بجوار النجمة.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٣</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على <span className="text-primary font-black">"تثبيت" (Install)</span> وسيظهر البرنامج فوراً بأيقونة واضحة على سطح المكتب الخاص بك ليفتح بشكل سريع ومستقل!
                  </p>
                </div>
              </div>
            )}

            <button 
              onClick={() => setShowIOSInstallGuide(false)} 
              className="w-full bg-primary text-white font-black text-lg py-3 rounded-xl hover:bg-gray-900 transition-colors shadow-md cursor-pointer"
            >
              فهمت، شكراً 👍
            </button>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className={`rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative text-center flex flex-col max-h-[90dvh] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
            <button 
              onClick={() => setShowLeaderboard(false)} 
              className={`absolute top-4 left-4 cursor-pointer transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <i className="fas fa-times-circle text-2xl"></i>
            </button>
            
            <div className="shrink-0">
              <i className="fas fa-crown text-5xl text-gold mb-3 block drop-shadow-md"></i>
              <h2 className={`text-2xl sm:text-3xl font-black mb-1 ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>لوحة الشرف (أوائل الكنز)</h2>
              <p className={`text-sm font-bold mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>أبطال المنصة مقسمين حسب متوسط درجاتهم</p>
            </div>

            {leaderboardData.length > 0 && (
              <div className="w-full bg-slate-900 overflow-hidden py-3 px-3 rounded-xl mb-4 flex items-center shadow-inner border border-slate-700 relative shrink-0">
                <style>{`
                  @keyframes stockTickerRight {
                    0% { transform: translateX(-150%); }
                    100% { transform: translateX(100%); }
                  }
                  .animate-stock-ticker {
                    display: flex;
                    white-space: nowrap;
                    animation: stockTickerRight 30s linear infinite;
                  }
                  .animate-stock-ticker:hover {
                    animation-play-state: paused;
                  }
                `}</style>
                <div className="absolute right-0 top-0 bottom-0 bg-slate-900 z-10 px-3 flex items-center shadow-[-5px_0_15px_rgba(15,23,42,1)] border-l border-slate-700">
                  <i className="fas fa-chart-line text-xl text-emerald-400 animate-pulse"></i>
                  <span className="mr-2 font-black text-xs text-white">بورصة الأبطال</span>
                </div>
                <div className="flex-1 overflow-hidden relative mr-28" dir="ltr">
                  <div className="animate-stock-ticker gap-6 items-center flex-row">
                    {leaderboardData.filter(s => s.trend === 'up' || s.trend === 'down').length > 0 
                      ? leaderboardData.filter(s => s.trend === 'up' || s.trend === 'down').slice(0, 15).map((s, i) => (
                          <span key={i} className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 shadow-sm text-xs sm:text-sm font-bold ${s.trend === 'up' ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800' : 'bg-rose-900/50 text-rose-400 border-rose-800'}`}>
                            {s.trend === 'up' ? <i className="fas fa-arrow-trend-up"></i> : <i className="fas fa-arrow-trend-down"></i>}
                            <span dir="rtl" className={s.trend === 'up' ? 'text-emerald-300' : 'text-rose-300'}>{s.name.split(' ').slice(0, 3).join(' ')}</span>
                            <span className={`text-[10px] ${s.trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>({toEasternArabic(s.score)})</span>
                          </span>
                        ))
                      : <span className="text-emerald-400 font-bold text-sm" dir="rtl">📊 ترقبوا التغيرات في مستويات الأبطال... المنافسة تشتعل! 🔥</span>}
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
              {isLoadingLeaderboard ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <i className="fas fa-spinner fa-spin text-3xl text-secondary"></i>
                  <p className={`font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>جاري جلب بيانات الأبطال...</p>
                </div>
              ) : leaderboardData.length > 0 ? (
                <div className="flex flex-col gap-3 pb-2">
                  {leaderboardData.map((student, idx) => {
                    const prevTier = idx > 0 ? leaderboardData[idx - 1].tier : '';
                    const showHeader = student.tier !== prevTier;
                    
                    const isGold = student.tier === 'gold';
                    const isSilver = student.tier === 'silver';
                    const isBronze = student.tier === 'bronze';
                    
                    return (
                    <React.Fragment key={idx}>
                      {showHeader && isGold && (
                        <div className="flex flex-col items-center mt-2 mb-2 gap-2">
                          <div className="text-center font-black text-gold text-lg">🏆 القائمة الذهبية (أول ١٠ أبطال) 🏆</div>
                          <button onClick={() => downloadTierBoard('gold', 'القائمة الذهبية', '#d97706')} className="bg-amber-100 text-amber-800 text-xs font-black py-1.5 px-4 rounded-full border border-amber-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fas fa-download"></i> تنزيل ومشاركة القائمة</button>
                        </div>
                      )}
                      {showHeader && isSilver && (
                        <div className="flex flex-col items-center mt-6 mb-2 gap-2">
                          <div className="text-center font-black text-slate-500 text-lg">🥈 القائمة الفضية (من ١١ إلى ٢٠) 🥈</div>
                          <button onClick={() => downloadTierBoard('silver', 'القائمة الفضية', '#64748b')} className="bg-slate-100 text-slate-700 text-xs font-black py-1.5 px-4 rounded-full border border-slate-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fas fa-download"></i> تنزيل ومشاركة القائمة</button>
                        </div>
                      )}
                      {showHeader && isBronze && (
                        <div className="flex flex-col items-center mt-6 mb-2 gap-2">
                          <div className="text-center font-black text-orange-600 text-lg">🥉 القائمة البرونزية (من ٢١ إلى ٣٠) 🥉</div>
                          <button onClick={() => downloadTierBoard('bronze', 'القائمة البرونزية', '#ea580c')} className="bg-orange-100 text-orange-800 text-xs font-black py-1.5 px-4 rounded-full border border-orange-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fas fa-download"></i> تنزيل ومشاركة القائمة</button>
                        </div>
                      )}
                      
                      <div className={`flex items-center justify-between p-3 rounded-2xl border-2 transition-transform hover:-translate-y-1 ${isGold ? (isDarkMode ? 'bg-amber-900/30 border-gold' : 'bg-amber-50 border-gold') : isSilver ? (isDarkMode ? 'bg-slate-800 border-slate-400' : 'bg-slate-50 border-slate-300') : (isDarkMode ? 'bg-orange-950/30 border-orange-700' : 'bg-orange-50 border-orange-300')}`}>
                      <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            {isGold && <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[12px]"><i className="fas fa-crown text-amber-400 drop-shadow-sm"></i></div>}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg shadow-inner ${isGold ? 'bg-gold text-white shadow-yellow-400/50' : isSilver ? 'bg-slate-400 text-white' : 'bg-orange-600 text-white'}`}>
                              {idx + 1}
                            </div>
                          </div>
                        <div className="flex flex-col items-start text-right">
                          <span className={`font-black text-sm sm:text-base ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{student.name.split(' ').slice(0, 4).join(' ')}</span>
                          <span className={`text-[10px] sm:text-xs font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{student.testsCount} اختبارات | متوسط %{toEasternArabic(student.avg || 0)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 pl-1">
                        <div className="flex flex-col items-center justify-center w-8">
                          {student.trend === 'up' && <i className="fas fa-arrow-trend-up text-emerald-500 animate-bounce text-xl" title="مستوى صاعد"></i>}
                          {student.trend === 'down' && <i className="fas fa-arrow-trend-down text-rose-500 animate-pulse text-xl" title="مستوى هابط"></i>}
                          {student.trend === 'flat' && <i className="fas fa-minus text-gray-400 text-lg" title="مستوى مستقر"></i>}
                        </div>
                        <div className="flex flex-col items-end w-14">
                          <span className={`font-black text-lg ${isGold ? 'text-gold' : (isDarkMode ? 'text-secondary' : 'text-primary')}`} dir="ltr">{toEasternArabic(student.score)}</span>
                        <span className={`text-[9px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>نقطة</span>
                        </div>
                      </div>
                    </div>
                    </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className={`py-10 font-bold px-4 leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  لا توجد بيانات متاحة في هذه الفئات بعد.
                </div>
              )}

              {!isLoadingLeaderboard && studentName && (currentUserStats?.globalRank ?? 0) > 0 && (
                <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} flex flex-col items-center gap-3 shrink-0`}>
                  <div className={`w-full p-3 rounded-2xl border-2 flex items-center justify-between ${isDarkMode ? 'bg-indigo-900/30 border-indigo-700' : 'bg-indigo-50 border-indigo-300'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-lg bg-indigo-600 text-white shadow-inner">
                        {currentUserStats!.globalRank}
                      </div>
                      <div className="flex flex-col items-start text-right">
                        <span className={`font-black text-sm sm:text-base ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>ترتيبك الإجمالي</span>
                        <span className={`text-[10px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>على مستوى المنصة للمؤهلين</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className={`font-black text-lg ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`} dir="ltr">{toEasternArabic(currentUserStats!.avg)}%</span>
                      <span className={`text-[9px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>متوسطك</span>
                    </div>
                  </div>
                </div>
              )}

              {!leaderboardData.some(s => s.name === studentName) && !isLoadingLeaderboard && studentName && (
                <div className={`${(currentUserStats?.globalRank ?? 0) > 0 ? 'mt-3' : 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'} flex flex-col items-center gap-3 pb-4 shrink-0`}>
                  <p className={`text-sm font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>لم تجد اسمك في لوحة الشرف؟</p>
                  <button 
                    onClick={() => setShowWhyModal(true)}
                    className={`border-2 font-black py-2 px-6 rounded-xl transition-colors flex items-center gap-2 shadow-sm active:scale-95 ${isDarkMode ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300 hover:bg-indigo-800' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300'}`}
                  >
                    <i className="fas fa-question-circle"></i> لماذا لم أُكتب؟
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showWhyModal && (
        <div className="fixed inset-0 bg-black/80 z-[1001] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className={`rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative flex flex-col max-h-[90dvh] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
            <button 
              onClick={() => setShowWhyModal(false)} 
              className={`absolute top-4 left-4 cursor-pointer transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <i className="fas fa-times-circle text-2xl"></i>
            </button>
            <div className="text-center mb-4 shrink-0">
              <i className="fas fa-search text-4xl text-indigo-500 mb-3 drop-shadow-sm"></i>
              <h2 className={`text-2xl font-black mb-1 ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>شفافية التقييم</h2>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 text-sm sm:text-base font-bold leading-relaxed space-y-4">
              {!currentUserStats ? (
                <div className={`p-4 rounded-xl text-center ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                  لم تقم بحل أي اختبارات بعد، أو أنك قمت بتصفير بياناتك مؤخراً ولم ترسل إجابات جديدة.
                </div>
              ) : (
                <React.Fragment>
                  <div className={`p-4 rounded-xl border flex flex-col gap-4 ${isDarkMode ? 'bg-gray-700/50 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    <div>
                      <h3 className="text-indigo-600 dark:text-indigo-400 font-black mb-3 border-b border-indigo-200 dark:border-indigo-800 pb-2 text-base">حالة الدروس الإجبارية للانضمام:</h3>
                      
                      {currentUserStats.completedRequired && currentUserStats.completedRequired.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-2">
                            <i className="fas fa-check-circle mr-1"></i> الدروس التي قمت بحلها:
                          </p>
                          <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                            {currentUserStats.completedRequired.map((lesson, i) => (
                              <div key={i} className={`flex justify-between items-center text-xs p-2 rounded-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'} shadow-sm`}>
                                <span className="truncate max-w-[75%] text-right font-bold">{lesson.name}</span>
                                <span className={`font-black px-2 py-1 rounded-md ${lesson.score >= 85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`} dir="ltr">{toEasternArabic(lesson.score)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {currentUserStats.missingRequired && currentUserStats.missingRequired.length > 0 && (
                        <div>
                          <p className="text-sm font-bold text-rose-600 dark:text-rose-400 mb-2">
                            <i className="fas fa-exclamation-circle mr-1"></i> دروس متبقية (يجب حلها):
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {currentUserStats.missingRequired.map((lessonName, i) => (
                              <span key={i} className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border shadow-sm ${isDarkMode ? 'bg-rose-950/30 text-rose-300 border-rose-800' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                {lessonName}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {!currentUserStats.passedEnough && (
                        <p className={`mt-3 font-black text-xs p-3 rounded-xl border text-center ${isDarkMode ? 'bg-orange-950/30 text-orange-400 border-orange-800' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                          لكي تدخل المنافسة، يجب عليك الانتهاء من جميع الدروس الإجبارية!
                        </p>
                      )}
                      
                      {timerMode === 'custom_lessons' && (
                        <div className="mb-4 animate-fade-in">
                          <label className="block text-gray-700 font-bold mb-2">اختر الاختبارات المستهدفة:</label>
                          <div className="flex flex-col gap-4 max-h-64 overflow-y-auto custom-scrollbar p-2 border-2 border-gray-200 rounded-xl bg-gray-50">
                            {data.filter(u => u.lessons.length > 0).map(u => (
                              <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                                <div className="font-black text-primary mb-2 border-b pb-2">{u.title}</div>
                                <div className="flex flex-col gap-2 pl-4">
                                  {u.lessons.map(l => (
                                    <label key={l.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                                      <input 
                                        type="checkbox" 
                                        checked={timerUnitTargets.includes(l.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setTimerUnitTargets(prev => [...prev, l.id]);
                                          } else {
                                            setTimerUnitTargets(prev => prev.filter(id => id !== l.id));
                                          }
                                        }}
                                        className="w-4 h-4 accent-secondary"
                                      />
                                      <span className="font-bold text-gray-700 text-sm">{l.title}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {timerMode === 'custom_lessons' && (
                        <div className="mb-4 animate-fade-in">
                          <div className="flex justify-between items-center mb-2">
                            <label className="block text-gray-700 font-bold">اختر الاختبارات المستهدفة:</label>
                            <button 
                              onClick={() => {
                                const allLessonIds = data.flatMap(u => u.lessons.map(l => l.id));
                                if (timerUnitTargets.length === allLessonIds.length) {
                                  setTimerUnitTargets([]);
                                } else {
                                  setTimerUnitTargets(allLessonIds);
                                }
                              }}
                              className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-lg font-bold transition-colors"
                            >
                              {timerUnitTargets.length > 0 && timerUnitTargets.length === data.flatMap(u => u.lessons.map(l => l.id)).length ? 'إلغاء التحديد' : 'تحديد الكل'}
                            </button>
                          </div>
                          <div className="flex flex-col gap-4 max-h-64 overflow-y-auto custom-scrollbar p-2 border-2 border-gray-200 rounded-xl bg-gray-50">
                            {data.filter(u => u.lessons.length > 0).map(u => (
                              <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                                <div className="font-black text-primary mb-2 border-b pb-2">{u.title}</div>
                                <div className="flex flex-col gap-2 pl-4">
                                  {u.lessons.map(l => (
                                    <label key={l.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                                      <input 
                                        type="checkbox" 
                                        checked={timerUnitTargets.includes(l.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setTimerUnitTargets(prev => [...prev, l.id]);
                                          } else {
                                            setTimerUnitTargets(prev => prev.filter(id => id !== l.id));
                                          }
                                        }}
                                        className="w-4 h-4 accent-secondary"
                                      />
                                      <span className="font-bold text-gray-700 text-sm">{l.title}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-gray-700/50 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    <h3 className="text-indigo-600 dark:text-indigo-400 font-black mb-2 border-b border-indigo-200 dark:border-indigo-800 pb-2">متوسط درجاتك:</h3>
                    <p className="text-center font-black text-2xl my-3" dir="ltr">{toEasternArabic(currentUserStats.avg)}%</p>
                    <p className="text-xs text-center font-bold text-gray-500 dark:text-gray-400">الترتيب يعتمد على إجمالي النقاط ثم عدد الاختبارات.</p>
                    {currentUserStats.passedEnough && (
                      <p className="mt-3 text-emerald-600 text-center font-black text-xs bg-emerald-50 dark:bg-emerald-900/30 p-2.5 rounded-lg">لقد حققت شروط الانضمام! استمر في زيادة نقاطك لرفع ترتيبك في القائمة.</p>
                    )}
                  </div>
                </React.Fragment>
              )}

              {currentUserStats && currentUserStats.unitRanks && Object.keys(currentUserStats.unitRanks).length > 0 && (
                <div className={`mt-4 p-4 rounded-xl border ${isDarkMode ? 'bg-gray-700/50 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    <h3 className="text-emerald-600 dark:text-emerald-400 font-black mb-3 border-b border-emerald-200 dark:border-emerald-800 pb-2 text-base">
                        <i className="fas fa-chart-pie mr-2"></i>
                        ترتيبك على مستوى الوحدات المكتملة:
                    </h3>
                    <div className="space-y-3">
                        {Object.values(currentUserStats.unitRanks).map(unitStat => (
                            <div key={unitStat.title} className={`p-3 rounded-lg border flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'} shadow-sm`}>
                                <div className="flex flex-col items-start">
                                    <span className="font-bold text-sm truncate max-w-[180px]">{unitStat.title}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-bold">
                                        ترتيبك: {toEasternArabic(unitStat.rank)} من {toEasternArabic(unitStat.totalStudents)}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="font-black text-emerald-600 dark:text-emerald-400 text-lg" dir="ltr">{toEasternArabic(unitStat.avg)}%</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-bold">متوسطك</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
              )}

              <div className="mt-4 bg-amber-50 border-2 border-amber-300 p-4 rounded-2xl shadow-inner text-amber-900 text-center animate-pulse">
                <i className="fas fa-lightbulb text-2xl text-amber-500 mb-2 block"></i>
                <p className="text-sm font-black leading-relaxed">
                  (بص التفوق مش بسهولة هنتعب شوية قم بتصفير الدرس ثم ابدأ من جديد اعلم انه قد يكون متعبا ولكن لحظة التفوق لو فتحت لك فرصة اغتنمها)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Certificate Modal */}
      {showCertModal && screen === 'result' && activeLesson && (() => {
        const activeUnit = data.find(u => u.lessons.some(l => l.id === activeLesson.id));
        const correct = userAnswers.filter(a => a.isCorrect).length;
        let totalUnitQs = 0; let totalUnitCorrect = 0;
        if (activeUnit) {
          activeUnit.lessons.forEach(l => {
            totalUnitQs += l.questions.length;
            if (l.id === activeLesson.id) {
               const firstAttemptScore = lessonScores[l.id] !== undefined ? lessonScores[l.id] : correct;
               totalUnitCorrect += Math.min(l.questions.length, firstAttemptScore);
            } else {
               totalUnitCorrect += Math.min(l.questions.length, (lessonScores[l.id] || 0));
            }
          });
        }
        const unitPerc = totalUnitQs > 0 ? Math.min(100, Math.round((totalUnitCorrect / totalUnitQs) * 100)) : 0;
        const unitTitle = activeUnit?.title || activeLesson.title;
        const lessonPerc = Math.round((correct / (activeLesson.questions.length || 1)) * 100);

        // تحديد بيانات الشهادة بناء على certModalData المختار
        const certType = certModalData?.type || (activeLesson.title.includes('شامل') ? 'comprehensive' : 'lesson');
        const certScore = certModalData?.score ?? (certType === 'unit' ? unitPerc : lessonPerc);
        const certTitle = certModalData?.title || (certType === 'unit' ? unitTitle : activeLesson.title);

        let certHeadline = 'شكر وتقدير';
        let certBadgeIcon = 'fa-award text-gold';
        let certCanvasDesc = '';

        if (certType === 'lesson') {
          certHeadline = 'شهادة تفوق وتميز';
          certBadgeIcon = 'fa-scroll text-teal-600';
          certCanvasDesc = `نظراً لتفوقه وتميزه في اختبار: (${certTitle})`;
        } else if (certType === 'comprehensive') {
          certHeadline = 'وسام النبوغ والتفوق';
          certBadgeIcon = 'fa-crown text-purple-600';
          certCanvasDesc = `نظراً لنبوغه وتفوقه في: (${certTitle})`;
        } else {
          certHeadline = 'شهادة إتمام وحدة دراسية';
          certBadgeIcon = 'fa-trophy text-gold';
          certCanvasDesc = `نظراً لإتمام واجتياز جميع دروس: (${certTitle})`;
        }

        return (
          <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl relative text-center flex flex-col items-center">
            <button
              onClick={() => setShowCertModal(false)}
              className="absolute top-4 left-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors z-10"
            >
              <i className="fas fa-times-circle text-3xl"></i>
            </button>

            {/* HTML Certificate Preview (For UI Viewing) */}
            <div className="w-full relative bg-gradient-to-br from-slate-50 to-slate-200 border-8 border-double border-gold p-6 sm:p-10 mb-6 mt-4 shadow-inner rounded-xl overflow-hidden">
              <div className="absolute inset-0 border-2 border-primary m-2 rounded-lg opacity-50 pointer-events-none"></div>
              <i className={`fas ${certBadgeIcon} text-5xl sm:text-6xl mb-3 sm:mb-4 drop-shadow-md`}></i>
              <h2 className="text-2xl sm:text-4xl font-black text-primary mb-3 sm:mb-4" style={{ fontFamily: 'Cairo, sans-serif' }}>{certHeadline}</h2>
              <p className="text-gray-600 font-bold mb-3 sm:mb-4 text-xs sm:text-base">يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :</p>
              <h3 className="text-2xl sm:text-4xl font-black text-gold mb-4 sm:mb-6">{studentName}</h3>
              
              <p className="text-gray-700 font-bold mb-2 text-xs sm:text-base leading-relaxed">
                {certType === 'lesson' && (
                  <>نظراً لتفوقه وتميزه في اختبار <span className="text-secondary font-black">({certTitle})</span> ببراعة واقتدار بنسبة <span className="text-primary font-black" dir="ltr">{toEasternArabic(certScore)}%</span>.</>
                )}
                {certType === 'comprehensive' && (
                  <>نظراً لنبوغه وتفوقه الباهر في <span className="text-secondary font-black">({certTitle})</span> ببراعة بنسبة <span className="text-primary font-black" dir="ltr">{toEasternArabic(certScore)}%</span>.</>
                )}
                {certType === 'unit' && (
                  <>نظراً لمجهوده وتفانيه لإتمام واجتياز جميع دروس <span className="text-secondary font-black">({certTitle})</span> ببراعة بنسبة <span className="text-primary font-black" dir="ltr">{toEasternArabic(certScore)}%</span>.</>
                )}
              </p>
              <p className="text-pink-600 font-black mb-4 sm:mb-6 text-sm sm:text-lg">أكمل يا بطلي فحقا فخور بك ❤️</p>
              
              <div className="flex justify-between items-end mt-4 sm:mt-8 pt-4 border-t-2 border-gray-300 border-dashed">
                <div className="text-center w-1/3">
                  <p className="text-gray-800 font-black text-sm sm:text-lg mb-1">أ/ إسلام سعود</p>
                  <p className="text-gray-500 font-bold text-[8px] sm:text-xs">معلم مادة التاريخ</p>
                </div>
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gold text-white rounded-full flex items-center justify-center font-black text-sm sm:text-xl shadow-lg transform -rotate-12 border-2 border-yellow-200">
                  {toEasternArabic(certScore)}%
                </div>
                <div className="text-center w-1/3">
                  <p className="text-gray-500 font-bold text-[9px] sm:text-sm mb-1">تاريخ الاجتياز</p>
                  <p className="text-gray-800 font-black text-[10px] sm:text-sm" dir="ltr">{new Date().toLocaleDateString('ar-EG')}</p>
                </div>
              </div>
            </div>

            {/* Button to Generate and Download Canvas Image */}
            <button
              onClick={() => {
                const canvas = document.createElement('canvas');
                canvas.width = 1000; canvas.height = 700;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                ctx.direction = "rtl";
                const gradient = ctx.createLinearGradient(0, 0, 1000, 700);
                gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(1, '#e2e8f0');
                ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1000, 700);

                ctx.strokeStyle = '#d97706'; ctx.lineWidth = 15; ctx.strokeRect(30, 30, 940, 640);
                ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 3; ctx.strokeRect(50, 50, 900, 600);

                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                
                ctx.fillStyle = '#1e3a8a'; ctx.font = 'bold 70px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(certHeadline, 500, 130);
                ctx.fillStyle = '#475569'; ctx.font = 'bold 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :', 500, 230);
                ctx.fillStyle = '#d97706'; ctx.font = '900 55px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(studentName, 500, 320);
                ctx.fillStyle = '#475569'; ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(certCanvasDesc, 500, 400);
                ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`ببراعة واقتدار بنسبة ${toEasternArabic(certScore)}%`, 500, 445);
                ctx.fillStyle = '#db2777'; ctx.font = '900 35px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أكمل يا بطلي فحقا فخور بك ❤️', 500, 510);

                ctx.beginPath(); ctx.moveTo(150, 560); ctx.lineTo(850, 560); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.stroke();

                ctx.fillStyle = '#0f172a'; ctx.font = '900 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أ/ إسلام سعود', 800, 610);
                ctx.fillStyle = '#16a34a'; ctx.font = '900 40px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`${toEasternArabic(certScore)}٪`, 500, 610);
                ctx.fillStyle = '#64748b'; ctx.font = 'bold 25px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(new Date().toLocaleDateString('ar-EG'), 200, 610);

                const cleanTitle = certTitle.replace(/[\/\s:()]+/g, '_').substring(0, 30);
                const cleanStudent = studentName.split(' ')[0] || 'طالب';
                const link = document.createElement('a');
                link.download = `شهادة_${cleanStudent}_${cleanTitle}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
              }}
              className="w-full bg-primary text-white font-black text-lg sm:text-xl py-4 rounded-2xl hover:bg-gray-900 transition-colors shadow-md flex items-center justify-center gap-3 cursor-pointer"
            >
              <i className="fas fa-download"></i> تحميل الشهادة كصورة للمشاركة
            </button>
          </div>
        </div>
        );
      })()}

      {/* Global Background Audio Handler (hidden HTML5 Audio tag) */}
      <audio
        ref={globalAudioRef}
        onPlay={() => { setIsGlobalAudioPlaying(true); setIsAudioLoading(false); }}
        onPlaying={() => { setIsGlobalAudioPlaying(true); setIsAudioLoading(false); }}
        onPause={() => setIsGlobalAudioPlaying(false)}
        onWaiting={() => setIsAudioLoading(true)}
        onCanPlay={() => setIsAudioLoading(false)}
        onEnded={() => {
          if (globalAudio) {
            localStorage.removeItem(`audioProgress_${simpleHash(globalAudio.url)}`);
          }
          setIsGlobalAudioPlaying(false);
          setGlobalAudio(null);
        }}
        onTimeUpdate={handleGlobalAudioTimeUpdate}
        onLoadedMetadata={handleGlobalAudioLoadedMetadata}
        onError={(e) => {
          const err = e.currentTarget.error;
          // تجاهل الخطأ رقم 1 (Abort) لأنه يحدث طبيعياً عند تغيير مقطع الصوت
          if (err && err.code === 1) return;
          // تجاهل الخطأ في حالة خدعة فك القفل الصوتي للهواتف
          if (globalAudioRef.current && globalAudioRef.current.src.includes('data:audio')) return;
          
          setIsGlobalAudioPlaying(false);
        }}
        className="fixed -top-20 -left-20 w-1 h-1 opacity-0 pointer-events-none"
        preload="none"
        playsInline
      />

      {/* Global Background Audio Floating Control Bar */}
      {globalAudio && (
        <div 
          className={`fixed bottom-0 left-0 right-0 md:bottom-4 md:left-auto md:right-4 rounded-t-2xl md:rounded-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)] md:shadow-[0_10px_40px_rgba(0,0,0,0.12)] z-[9999] animate-fade-in flex flex-col justify-between border-t md:border ${isDarkMode ? 'bg-gray-900/95 border-gray-800 text-white' : 'bg-white/95 border-blue-50 text-gray-800'} backdrop-blur-md`} 
          style={{
            marginTop: '0px',
            marginLeft: '0px',
            marginRight: '6px',
            paddingTop: '5px',
            paddingBottom: '16px',
            paddingRight: '25px',
            paddingLeft: '17px',
            width: '340px',
            height: '82px',
            marginBottom: '4px'
          }}
          dir="rtl"
        >
          <div className="flex items-center justify-between gap-2.5">
            <div 
              className="flex items-center gap-2 overflow-hidden max-w-[190px]"
              style={{
                paddingRight: '10px',
                paddingLeft: '10px',
                paddingTop: '4px',
                paddingBottom: '5px',
                marginLeft: '-1px',
                marginRight: '-40px'
              }}
            >
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <i className={`fas fa-headphones-alt text-sm ${isGlobalAudioPlaying ? 'animate-bounce' : ''}`}></i>
              </div>
              <div className="overflow-hidden flex flex-col min-w-0">
                <p className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider shrink-0 leading-tight">شرح مسموع في الخلفية 🎧</p>
                <div className="overflow-hidden w-full whitespace-nowrap">
                  <p className={`text-xs font-black whitespace-nowrap inline-block ${isGlobalAudioPlaying ? 'animate-lesson-reveal' : 'truncate'}`}>
                    {globalAudio.title}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0">
              <button 
                onClick={togglePlaybackRate} 
                className="w-7 h-7 rounded-full bg-purple-50 dark:bg-gray-800 hover:bg-purple-100 dark:hover:bg-gray-700 text-purple-600 dark:text-purple-400 flex items-center justify-center transition-colors cursor-pointer text-[10px] font-black"
                title="سرعة الصوت"
              >
                {playbackRate}x
              </button>
              <button 
                onClick={toggleGlobalAudio} 
                className="w-7 h-7 rounded-full bg-blue-50 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-colors cursor-pointer text-xs"
                title={isGlobalAudioPlaying ? "إيقاف مؤقت" : "تشغيل"}
                disabled={isAudioLoading}
                style={{
                  marginRight: '1px',
                  marginBottom: '-1px',
                  marginTop: '0px',
                  marginLeft: '3px'
                }}
              >
                {isAudioLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className={`fas ${isGlobalAudioPlaying ? 'fa-pause' : 'fa-play ml-0.5'}`}></i>}
              </button>
              <button 
                onClick={() => {
                  if (globalAudioRef.current) {
                    globalAudioRef.current.pause();
                  }
                  setGlobalAudio(null);
                  setIsGlobalAudioPlaying(false);
                }} 
                className="w-7 h-7 rounded-full bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center transition-colors cursor-pointer text-xs"
                title="إغلاق تماماً"
                style={{
                  marginLeft: '35px'
                }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
          
          {/* Progress bar controller */}
          <div className="flex items-center gap-2 px-0.5 leading-none">
            <span className="text-[9px] font-bold text-gray-500 w-7 text-left" dir="ltr">{formatAudioTime(globalAudioTime)}</span>
            <input 
              type="range" 
              min={0} 
              max={globalAudioDuration || 100} 
              value={globalAudioTime} 
              onChange={handleGlobalAudioSeek} 
              className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <span className="text-[9px] font-bold text-gray-500 w-7 text-right" dir="ltr">{formatAudioTime(globalAudioDuration)}</span>
          </div>
        </div>
      )}

      {/* نوافذ إشعار ومراجعة نتائج الأسئلة المقالية للطلاب */}
      <StudentApprovedEssayModal
        isOpen={!!approvedSubForModal}
        onClose={handleCloseApprovedEssayModal}
        submission={approvedSubForModal}
        isDarkMode={isDarkMode}
        data={data}
      />

      <StudentEssayListModal
        isOpen={showStudentEssayListModal}
        onClose={() => setShowStudentEssayListModal(false)}
        submissions={currentStudentSubmissions}
        onSelectSubmission={(sub) => {
          setShowStudentEssayListModal(false);
          setApprovedSubForModal(sub);
        }}
        isDarkMode={isDarkMode}
      />

      <MistakesNotebookModal
        isOpen={showMistakesNotebookModal}
        onClose={() => setShowMistakesNotebookModal(false)}
        permanentMistakes={permanentNotebookMistakes}
        mistakes={mistakesBank}
        unitsData={data}
        essaySubmissions={currentStudentSubmissions}
        isDarkMode={isDarkMode}
        onDeleteMistake={handleDeleteNotebookMistake}
        onClearNotebook={handleClearPermanentNotebook}
        studentName={studentName || (studentData as any)?.name || 'طالب موسوعة الكنز'}
        studentPhone={inputPhone || localStorage.getItem('loggedInPhone') || (studentData as any)?.phone || ''}
        subjectName={subjectName || 'التاريخ'}
        gradeName={gradeName || '2 بكالوريا'}
      />

      {/* نوافذ الأدعية الإيمانية (البدء والختام) */}
      <FaithPrayerModal
        isOpen={showOpeningPrayer}
        type="opening"
        onClose={() => {
          setShowOpeningPrayer(false);
          sessionStorage.setItem('seen_opening_prayer', 'true');
        }}
        isDarkMode={isDarkMode}
      />

      <FaithPrayerModal
        isOpen={showClosingPrayer}
        type="closing"
        onClose={() => setShowClosingPrayer(false)}
        onConfirmAction={closingPrayerIsLogout ? handleLogout : undefined}
        isDarkMode={isDarkMode}
      />

      {/* البطاقة الإيمانية العائمة بتصميم احترافي كل 5 دقائق خارج الامتحان */}
      <FaithFloatingToast
        screen={screen}
        isDarkMode={isDarkMode}
      />
    </React.Fragment>
  );
}
