import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StudentEssaySubmission, EssayReviewQuestionItem, Unit, StudentRetakeDirective } from '../types';
import defaultQuestionsData from '../defaultQuestions.json';
import { 
  getPendingEssaySubmissions, 
  savePendingEssaySubmission, 
  getExamConfig, 
  calculateExamStructure,
  calculateSubScores,
  detectEssayType,
  saveRetakeDirective,
  hasWrittenEssayAnswers,
  checkNeedsFormattingGuidance,
  ensureCompleteEssayQuestions,
  findLessonForQuizInUnits,
  getActiveRetakeDirectiveForLesson,
  notifyPendingEssaysChanged
} from '../examConfigUtils';
import { HighlightText } from './HighlightText';
import { FormatQuestionText } from './FormatQuestionText';
import { StudentFullExamInspectionModal } from './StudentFullExamInspectionModal';
import { compareStudentWithModelAnswer, EssayDiffComparison, getGeminiApiKey, getGroqApiKey } from '../aiEvaluationService';
import { toEasternArabic, API_URL, SECRET_API_KEY, formatPhoneStr, detectArabicGender } from '../utils';

interface AdminEssayReviewTabProps {
  onSaveResultToDB?: (result: { quizName: string; score: string; studentName?: string; studentPhone?: string }) => void;
  isDarkMode?: boolean;
  onlineStudents?: any[];
  data?: Unit[];
  initialSelectedQuiz?: string;
  onNavigateToApproval?: () => void;
}

export const cleanModelAnswerStr = (val: string): string => {
  if (!val) return '';
  let s = val.trim();
  while (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
    (s.startsWith('“') && s.endsWith('”') && s.length >= 2) ||
    (s.startsWith('«') && s.endsWith('»') && s.length >= 2)
  ) {
    s = s.substring(1, s.length - 1).trim();
  }
  return s;
};

export const normalizeTextForMatching = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/[«»"“”'`]/g, '')
    .replace(/[ـ\u0640]/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[\u060C\u061B\u061F،؛؟\.\,\:\!\?\-\_\(\)\[\]\{\}\/\\\|]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/[^\u0621-\u064A0-9a-zA-Z]/g, '')
    .toLowerCase()
    .trim();
};

export const resolveModelAnswer = (
  questionText: string,
  quizTitle?: string,
  lessonId?: string,
  qIndex?: number,
  allData?: Unit[]
): { modelAnswer: string; maxScore?: number; lessonId?: string } => {
  const cleanTargetText = (questionText || '').trim();
  if (!cleanTargetText) return { modelAnswer: '' };
  const normTargetQ = normalizeTextForMatching(cleanTargetText);

  // 0. التحقق أولاً من النماذج المخصصة المحفوظة محلياً من قبل المعلم
  try {
    const customRaw = localStorage.getItem('kanz_custom_model_answers');
    if (customRaw) {
      const customMap = JSON.parse(customRaw);
      if (customMap[normTargetQ] && customMap[normTargetQ].trim()) {
        return { modelAnswer: cleanModelAnswerStr(customMap[normTargetQ].trim()), maxScore: 2 };
      }
    }
  } catch(e) {}

  const normQuizTitle = quizTitle ? normalizeTextForMatching(quizTitle) : '';

  // 1. البحث في الدرس المطابق من المنهج الحركي allData إذا وُجد
  if (allData && Array.isArray(allData) && allData.length > 0) {
    let matchedLesson: any = null;
    for (const u of allData) {
      if (!u.lessons) continue;
      const l = u.lessons.find(les => {
        if (lessonId && (les.id === lessonId || les.id.trim() === lessonId.trim())) return true;
        if (quizTitle && les.title.trim() === quizTitle.trim()) return true;
        if (normQuizTitle) {
          const normLTitle = normalizeTextForMatching(les.title);
          if (normLTitle === normQuizTitle || normLTitle.includes(normQuizTitle) || normQuizTitle.includes(normLTitle)) {
            return true;
          }
        }
        return false;
      });
      if (l) {
        matchedLesson = l;
        break;
      }
    }

    if (matchedLesson && matchedLesson.questions && Array.isArray(matchedLesson.questions)) {
      const qMatch = matchedLesson.questions.find((lq: any) => {
        if (lq.q && lq.q.trim() === cleanTargetText) return true;
        if (normTargetQ && lq.q && normalizeTextForMatching(lq.q) === normTargetQ) return true;
        return false;
      });

      if (qMatch) {
        const ans = cleanModelAnswerStr(qMatch.answer || qMatch.reason || (qMatch as any).modelAnswer || '');
        if (ans) {
          return { modelAnswer: ans, maxScore: qMatch.maxScore || 2, lessonId: matchedLesson.id };
        }
      }

      if (qIndex !== undefined) {
        const essayQs = matchedLesson.questions.filter((lq: any) => lq.type === 'essay');
        if (essayQs[qIndex]) {
          const ans = cleanModelAnswerStr(essayQs[qIndex].answer || essayQs[qIndex].reason || (essayQs[qIndex] as any).modelAnswer || '');
          if (ans) {
            return { modelAnswer: ans, maxScore: essayQs[qIndex].maxScore || 2, lessonId: matchedLesson.id };
          }
        }
      }
    }

    // 2. بحث شامل في جميع الأسئلة عبر المنهج الحركي allData
    if (normTargetQ) {
      for (const u of allData) {
        if (!u.lessons) continue;
        for (const l of u.lessons) {
          if (!l.questions || !Array.isArray(l.questions)) continue;
          for (const lq of l.questions) {
            if (!lq.q) continue;
            const normLq = normalizeTextForMatching(lq.q);
            if (normLq === normTargetQ || (normTargetQ.length >= 25 && (normLq.includes(normTargetQ) || normTargetQ.includes(normLq)))) {
              const ans = cleanModelAnswerStr(lq.answer || lq.reason || (lq as any).modelAnswer || '');
              if (ans) {
                return { modelAnswer: ans, maxScore: lq.maxScore || 2, lessonId: l.id };
              }
            }
          }
        }
      }
    }
  }

  // 3. البحث الاحتياطي الشامل في كتالوج الأسئلة الافتراضي الأساسي (defaultQuestionsData)
  if (defaultQuestionsData && Array.isArray(defaultQuestionsData)) {
    for (const dq of (defaultQuestionsData as any[])) {
      if (!dq.q) continue;
      const normDq = normalizeTextForMatching(dq.q);
      if (normDq === normTargetQ || (normTargetQ.length >= 25 && (normDq.includes(normTargetQ) || normTargetQ.includes(normDq)))) {
        const ans = cleanModelAnswerStr(dq.reason || dq.answer || dq.correct || '');
        if (ans) {
          return { modelAnswer: ans, maxScore: 2 };
        }
      }
    }

    // بحث متقدم بمطابقة بداية السؤال إذا وجدت أي إضافات طفيفة
    if (normTargetQ.length >= 30) {
      const sub = normTargetQ.substring(0, 35);
      for (const dq of (defaultQuestionsData as any[])) {
        if (!dq.q || dq.type === 'mcq') continue;
        const normDq = normalizeTextForMatching(dq.q);
        if (normDq.includes(sub)) {
          const ans = cleanModelAnswerStr(dq.reason || dq.answer || dq.correct || '');
          if (ans) {
            return { modelAnswer: ans, maxScore: 2 };
          }
        }
      }
    }
  }

  return { modelAnswer: '' };
};

export const syncGradeToCloud = async (sub: StudentEssaySubmission, teacherScore?: number, teacherFeedback?: string) => {
  try {
    const cleanPhone = formatPhoneStr(sub.studentPhone);
    const fullPhone = cleanPhone.startsWith('0') ? '+20' + cleanPhone.substring(1) : cleanPhone;

    // 1. مزامنة تفاصيل درجات وملاحظات كل سؤال مقالي وملخص الموضوعي بدقة في صفوف شيت إجابات المقالي
    const questionsToSync = sub.questions.filter(q => q.essayType !== 'صح وخطأ' || q.qIndex === -1);
    if (questionsToSync.length > 0) {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveEssaySubmission',
          date: sub.submissionDate || new Date().toLocaleString('ar-EG'),
          studentName: sub.studentName,
          studentPhone: fullPhone,
          quizTitle: sub.quizTitle,
          questions: questionsToSync.map(q => {
            const rawScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
            const safeScore = (q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ')
              ? Math.min(q.maxScore || 2, rawScore)
              : rawScore;
            return {
              ...q,
              isApproved: true,
              teacherScore: safeScore,
              teacherFeedback: q.teacherFeedback || teacherFeedback || 'تم اعتماد الإجابة بنجاح'
            };
          }),
          isApproved: true,
          status: 'معتمد',
          studentType: sub.studentType || 'سنتر',
          apiKey: SECRET_API_KEY
        })
      });
    }

    // 2. تحديث الحالة العامة فقط دون مساس بدرجة كل سؤال
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateEssayGrade',
        studentPhone: fullPhone,
        quizTitle: sub.quizTitle,
        teacherFeedback: teacherFeedback || 'تم اعتماد الإجابة بنجاح',
        isApproved: true,
        status: 'معتمد',
        apiKey: SECRET_API_KEY
      })
    });
  } catch (e) {
    console.error("Cloud essay grade update error:", e);
  }
};

export const syncDraftToCloud = async (sub: StudentEssaySubmission) => {
  try {
    const cleanPhone = formatPhoneStr(sub.studentPhone);
    const fullPhone = cleanPhone.startsWith('0') ? '+20' + cleanPhone.substring(1) : cleanPhone;

    // 1. مزامنة تفاصيل درجات وملاحظات كل سؤال مقالي وملخص الموضوعي بدقة كمسودة مصححة في شيت إجابات المقالي
    const questionsToSync = sub.questions.filter(q => q.essayType !== 'صح وخطأ' || q.qIndex === -1);
    if (questionsToSync.length > 0) {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveEssaySubmission',
          date: sub.submissionDate || new Date().toLocaleString('ar-EG'),
          studentName: sub.studentName,
          studentPhone: fullPhone,
          quizTitle: sub.quizTitle,
          questions: questionsToSync.map(q => {
            const rawScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
            const safeScore = (q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ')
              ? Math.min(q.maxScore || 2, rawScore)
              : rawScore;
            return {
              ...q,
              isApproved: false,
              teacherScore: safeScore,
              teacherFeedback: q.teacherFeedback || 'تم التصحيح وحفظ المسودة بواسطة المعلم'
            };
          }),
          isApproved: false,
          status: 'تم التصحيح',
          studentType: sub.studentType || 'سنتر',
          apiKey: SECRET_API_KEY
        })
      });
    }

    // 2. تحديث حالة المسودة فقط دون مساس بدرجة كل سؤال
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateEssayGrade',
        studentPhone: fullPhone,
        quizTitle: sub.quizTitle,
        teacherFeedback: 'تم التصحيح وحفظ المسودة بواسطة المعلم',
        isApproved: false,
        status: 'تم التصحيح',
        apiKey: SECRET_API_KEY
      })
    });
  } catch (e) {
    console.error("Cloud essay draft sync error:", e);
  }
};

export const AdminEssayReviewTab: React.FC<AdminEssayReviewTabProps> = ({
  onSaveResultToDB,
  isDarkMode = false,
  onlineStudents = [],
  data = [],
  initialSelectedQuiz,
  onNavigateToApproval,
}) => {
  const [submissions, setSubmissions] = useState<StudentEssaySubmission[]>([]);
  const [selectedSubForReview, setSelectedSubForReview] = useState<StudentEssaySubmission | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'reviewed' | 'approved'>('pending');
  const [studentTypeFilter, setStudentTypeFilter] = useState<'all' | 'center' | 'online'>('all');
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>('all');
  const [selectedQuizFilter, setSelectedQuizFilter] = useState<string>(initialSelectedQuiz || 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [retakeModalSub, setRetakeModalSub] = useState<StudentEssaySubmission | null>(null);
  const [inspectingSub, setInspectingSub] = useState<StudentEssaySubmission | null>(null);

  // إذا لم تكن هناك إجابات بانتظار التصحيح في البداية، نعرض الكل تلقائياً
  const [hasAutoSwitchedToAll, setHasAutoSwitchedToAll] = useState(false);
  useEffect(() => {
    if (!initialSelectedQuiz && !hasAutoSwitchedToAll && submissions.length > 0) {
      const pendingCount = submissions.filter(s => !s.isFullyApproved && !s.isTeacherReviewed && hasWrittenEssayAnswers(s)).length;
      if (pendingCount === 0) {
        setStatusFilter('all');
        setHasAutoSwitchedToAll(true);
      }
    }
  }, [submissions, initialSelectedQuiz, hasAutoSwitchedToAll]);

  useEffect(() => {
    if (initialSelectedQuiz) {
      setSelectedQuizFilter(initialSelectedQuiz);
    }
  }, [initialSelectedQuiz]);

  // فحص هل تسليم الطالب يتبع الأونلاين أم السنتر
  const isSubOnline = (sub: StudentEssaySubmission) => {
    if (sub.studentType === 'أونلاين') return true;
    const cleanSubPhone = (sub.studentPhone || '').replace(/[^0-9]/g, '');
    if (onlineStudents && onlineStudents.length > 0) {
      return onlineStudents.some(s => {
        const p = (s.phone || '').replace(/[^0-9]/g, '');
        return p && (cleanSubPhone.endsWith(p) || p.endsWith(cleanSubPhone));
      });
    }
    return false;
  };

  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(false);

  // تحديث قائمة التسليمات محلياً
  const refreshSubmissions = () => {
    const list = getPendingEssaySubmissions();
    if (data && data.length > 0) {
      list.forEach(sub => {
        sub.questions.forEach((q, qi) => {
          if (!q.modelAnswer || q.modelAnswer.trim() === '' || q.modelAnswer.includes('لا يوجد')) {
            const found = resolveModelAnswer(q.questionText, sub.quizTitle, sub.lessonId, qi, data);
            if (found.modelAnswer) {
              q.modelAnswer = found.modelAnswer;
            }
            if (found.maxScore) {
              q.maxScore = found.maxScore;
            }
          }
        });
      });
    }
    setSubmissions(list);
  };

  const fetchCloudSubmissions = async (isManual: boolean = false) => {
    setIsLoadingCloud(true);
    try {
      const res = await fetch(`${API_URL}?action=getEssaySubmissions&apiKey=${SECRET_API_KEY}&t=${Date.now()}`);
      const resData = await res.json();
      if (resData && resData.status === 'success' && Array.isArray(resData.data)) {
        const groupedMap = new Map<string, {
          date: string;
          studentName: string;
          studentPhone: string;
          quizTitle: string;
          studentType: string;
          questions: EssayReviewQuestionItem[];
        }>();

        resData.data.forEach((row: any) => {
          if (!row.studentPhone || !row.quizTitle) return;
          const cleanPhone = formatPhoneStr(row.studentPhone);
          const key = `${cleanPhone}___${normalizeTextForMatching(row.quizTitle)}`;
          if (!groupedMap.has(key)) {
            groupedMap.set(key, {
              date: row.date || '',
              studentName: row.studentName || 'طالب',
              studentPhone: cleanPhone,
              quizTitle: row.quizTitle.trim(),
              studentType: row.studentType || 'سنتر',
              questions: []
            });
          }
          const grp = groupedMap.get(key)!;
          const scoreNum = row.teacherScore !== "" && row.teacherScore !== undefined && !isNaN(Number(row.teacherScore)) ? Number(row.teacherScore) : undefined;
          const isAppr = String(row.status || '').trim() === 'معتمد';
          const isGradedStatus = String(row.status || '').trim() === 'تم التصحيح' || 
                                 String(row.status || '').trim() === 'مصحح' || 
                                 String(row.status || '').trim() === 'مسودة مصححة';
          const rawFb = String(row.teacherFeedback || '').trim();
          const hasTeacherMark = rawFb.includes('تم التصحيح وحفظ المسودة بواسطة المعلم') ||
                                 rawFb.startsWith('[مصحح من المعلم]') ||
                                 rawFb.startsWith('[المعلم]') ||
                                 rawFb.includes('بواسطة المعلم');

          const isAITemplate = !rawFb || 
                               rawFb.includes('إجابة جيدة جداً') || 
                               rawFb.includes('إجابة ممتازة') || 
                               rawFb.includes('إجابة مقبولة') || 
                               rawFb.includes('إجابة ضعيفة') || 
                               rawFb.includes('لم يتم الإجابة') || 
                               rawFb.includes('سُحبت');

          // هل تم تصحيح هذا السؤال بواسطة المعلم بالفعل أم أنه مجرد تقييم آلي أولي ينتظر المعلم؟
          const isTeacherGradedQuestion = isAppr || isGradedStatus || hasTeacherMark || (!isAITemplate && scoreNum !== undefined);

          if (isTeacherGradedQuestion) (grp as any).hasGradedStatus = true;
          const cleanQText = (row.questionText || `سؤال مقالي ${grp.questions.length + 1}`).trim();

          // تجنب تكرار السؤال المقالي للطالب إذا تم إرسال الإجابة أكثر من مرة أو عند التدريب
          const existingQ = grp.questions.find(q => q.questionText.trim() === cleanQText);
          if (existingQ) {
            if (isTeacherGradedQuestion && scoreNum !== undefined && existingQ.teacherScore === undefined) {
              existingQ.teacherScore = scoreNum;
            }
            if (isTeacherGradedQuestion && rawFb && !existingQ.teacherFeedback) {
              existingQ.teacherFeedback = rawFb;
            }
            if (!existingQ.isApproved && isAppr) {
              existingQ.isApproved = true;
            }
            return;
          }

          const isMcqSummary = cleanQText.includes('الأسئلة الموضوعية') || cleanQText.includes('الاختياري والصح/خطأ');
          const isTfOrMcq = isMcqSummary || cleanQText.includes('هل العبارة صحيحة') || cleanQText.includes('اختر من متعدد');

          grp.questions.push({
            qIndex: grp.questions.length,
            questionText: cleanQText,
            essayType: isTfOrMcq ? 'اختر من متعدد' : detectEssayType(cleanQText).label,
            modelAnswer: '',
            studentText: row.studentAnswerText || '',
            maxScore: 2,
            teacherScore: isTeacherGradedQuestion ? scoreNum : undefined,
            teacherFeedback: isTeacherGradedQuestion ? rawFb : '',
            aiScore: scoreNum,
            aiFeedback: rawFb,
            isApproved: isAppr
          });
        });

        const cloudSubmissions: StudentEssaySubmission[] = [];
        groupedMap.forEach((grp, key) => {
          const retakeDirective = getActiveRetakeDirectiveForLesson(grp.studentPhone, grp.quizTitle);
          if (retakeDirective) {
            // الطالب ممنوح إذن إعادة بالفعل - إخلاء قائمته من التصحيح المعلق
            return;
          }

          const isAllApproved = grp.questions.length > 0 && grp.questions.every(q => q.isApproved);
          const hasAllTeacherScores = grp.questions.length > 0 && grp.questions.every(q => q.teacherScore !== undefined && q.teacherScore !== null);
          const isReviewed = Boolean(isAllApproved || (grp as any).hasGradedStatus || hasAllTeacherScores);
          
          const matchedLesson = findLessonForQuizInUnits(grp.quizTitle, undefined, data);
          let lessonId = matchedLesson ? matchedLesson.id : grp.quizTitle;
          const structure = matchedLesson ? calculateExamStructure(matchedLesson.questions, getExamConfig(matchedLesson.id)) : null;
          const mcqMax = structure ? (structure.mcqTotalScore + structure.tfTotalScore) : 0;

          grp.questions.forEach((q, qi) => {
            if (q.questionText.includes('الأسئلة الموضوعية') || q.questionText.includes('الاختياري والصح/خطأ')) {
              q.essayType = 'اختر من متعدد';
              if (mcqMax > 0) q.maxScore = mcqMax;
              const match = (q.studentText || '').match(/حصل الطالب على\s*([\d.]+)/);
              if (match && match[1]) {
                const parsed = parseFloat(match[1]);
                if (!isNaN(parsed)) {
                  q.teacherScore = parsed;
                  q.aiScore = parsed;
                }
              }
              return;
            }
            const found = resolveModelAnswer(q.questionText, grp.quizTitle, undefined, qi, data);
            if (found.modelAnswer) {
              q.modelAnswer = found.modelAnswer;
            }
            if (found.maxScore) {
              q.maxScore = found.maxScore;
            }
            if (found.lessonId) {
              lessonId = found.lessonId;
            }
          });

          // معالجة تصحيح التكرار في حال تم حفظ الدرجة الكلية في كل صف بدلاً من توزيعها
          const totalMaxPossible = structure ? structure.examTotalScore : grp.questions.reduce((sum, q) => sum + (q.maxScore || 2), 0);

          // حماية صارمة لكل سؤال مقالي: لا يجوز لأي سؤال أن تتجاوز درجته درجته العظمى (مثلاً: 4 من 2)
          const essayQs = grp.questions.filter(q => !q.questionText.includes('الأسئلة الموضوعية') && !q.questionText.includes('الاختياري والصح/خطأ'));
          const maxEssayPossible = structure ? structure.essayTotalScore : essayQs.reduce((sum, q) => sum + (q.maxScore || 2), 0);

          essayQs.forEach(q => {
            const qMax = q.maxScore || 2;
            if (q.teacherScore !== undefined && q.teacherScore > qMax) {
              q.teacherScore = qMax;
            }
          });

          // معالجة تصحيح التكرار في حال تم حفظ الدرجة الكلية للمقالي في كل صف
          const currentEssayEarned = essayQs.reduce((sum, q) => sum + (q.teacherScore !== undefined ? q.teacherScore : (q.aiScore || 0)), 0);
          if (currentEssayEarned > maxEssayPossible && essayQs.length > 0) {
            const distributedScore = maxEssayPossible / essayQs.length;
            essayQs.forEach(q => {
              q.teacherScore = Number(distributedScore.toFixed(2));
            });
          }

          const rawEarned = grp.questions.reduce((sum, q) => sum + (q.teacherScore !== undefined ? q.teacherScore : (q.aiScore || 0)), 0);
          const finalEarned = Math.min(totalMaxPossible > 0 ? totalMaxPossible : rawEarned, rawEarned);

          const rawSub: StudentEssaySubmission = {
            id: `cloud_${key}`,
            studentName: grp.studentName,
            studentPhone: grp.studentPhone,
            quizTitle: grp.quizTitle,
            lessonId: lessonId,
            submissionDate: grp.date,
            questions: grp.questions,
            isFullyApproved: isAllApproved,
            isTeacherReviewed: isReviewed,
            finalScore: finalEarned,
            maxPossibleScore: totalMaxPossible,
            studentType: grp.studentType
          };
          cloudSubmissions.push(ensureCompleteEssayQuestions(rawSub, data));
        });

        const localList = getPendingEssaySubmissions();
        localList.forEach(ls => {
          ls.questions.forEach((q, qi) => {
            if (!q.modelAnswer || q.modelAnswer.trim() === '' || q.modelAnswer.includes('لا يوجد')) {
              const found = resolveModelAnswer(q.questionText, ls.quizTitle, ls.lessonId, qi, data);
              if (found.modelAnswer) {
                q.modelAnswer = found.modelAnswer;
              }
              if (found.maxScore) {
                q.maxScore = found.maxScore;
              }
            }
          });
        });
        const mergedMap = new Map<string, StudentEssaySubmission>();
        cloudSubmissions.forEach(cs => {
          const mKey = `${formatPhoneStr(cs.studentPhone)}___${normalizeTextForMatching(cs.quizTitle)}`;
          mergedMap.set(mKey, cs);
        });
        localList.forEach(ls => {
          const retakeDirective = getActiveRetakeDirectiveForLesson(ls.studentPhone, ls.quizTitle);
          if (retakeDirective) return;
          const mKey = `${formatPhoneStr(ls.studentPhone)}___${normalizeTextForMatching(ls.quizTitle)}`;
          const normalizedLs = ensureCompleteEssayQuestions(ls, data);
          if (!mergedMap.has(mKey)) {
            // الاحتفاظ بالتسليمات المحلية غير الموجودة في السحابة
            mergedMap.set(mKey, normalizedLs);
          } else {
            const cloudItem = mergedMap.get(mKey)!;
            // حماية تصحيح المعلم: إذا كان الكاش المحلي أو السحابي يحتوي على تصحيح المعلم أو اعتماده، نعطيه الأولوية المطلقة حتى لا يضيع تصحيح المعلم!
            const hasLocalReview = ls.isTeacherReviewed || ls.isFullyApproved;
            const hasCloudReview = cloudItem.isTeacherReviewed || cloudItem.isFullyApproved;
            if (hasLocalReview) {
              mergedMap.set(mKey, ensureCompleteEssayQuestions({
                ...cloudItem,
                ...normalizedLs,
                questions: normalizedLs.questions,
                finalScore: normalizedLs.finalScore,
                isTeacherReviewed: true,
                isFullyApproved: normalizedLs.isFullyApproved || cloudItem.isFullyApproved
              }, data));
            } else if (hasCloudReview) {
              cloudItem.isTeacherReviewed = true;
            }
          }
        });

        const finalList = Array.from(mergedMap.values());
        localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(finalList));
        setSubmissions(finalList);
        notifyPendingEssaysChanged();
        if (isManual) {
          showToast('✅ تم جلب وتحديث كافة تسليمات المقالي من السحابة بنجاح!');
        }
      } else {
        refreshSubmissions();
        notifyPendingEssaysChanged();
        if (isManual) {
          showToast('تم تحديث البيانات من السجلات المحلية.');
        }
      }
    } catch (e) {
      console.error("Error fetching cloud essays:", e);
      refreshSubmissions();
      if (isManual) {
        showToast('⚠️ تعذر الاتصال بالسحابة، تم التحديث من الكاش المحلي.');
      }
    } finally {
      setIsLoadingCloud(false);
    }
  };

  useEffect(() => {
    fetchCloudSubmissions();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // استبعاد الطلاب الذين لم يحلوا أي سؤال مقالي إطلاقاً (كل المقالي فارغ أو مسحوب)
  // هؤلاء الطلاب لا يظهرون في تصحيح المقالي بل ينتقلون مباشرة لتبويب اعتماد النتائج
  const essayEligibleSubmissions = useMemo(() => {
    return submissions.filter(s => hasWrittenEssayAnswers(s));
  }, [submissions]);

  // إيجاد الوحدة التابع لها الامتحان
  const findUnitForQuiz = (lessonId: string, quizTitle: string) => {
    if (!data || data.length === 0) return 'الوحدة الدراسية';
    for (const u of data) {
      if (u.lessons.some(l => l.id === lessonId || l.title === quizTitle)) {
        return u.title;
      }
    }
    return 'عام';
  };

  // استخراج قائمة الوحدات المتاحة مع تتبع تفصيلي لحالات التصحيح
  const availableUnits = useMemo(() => {
    const map = new Map<string, {
      id: string;
      title: string;
      count: number;
      pendingCount: number;
      draftCount: number;
      approvedCount: number;
    }>();

    if (data && data.length > 0) {
      data.forEach(u => {
        map.set(u.title, {
          id: u.id,
          title: u.title,
          count: 0,
          pendingCount: 0,
          draftCount: 0,
          approvedCount: 0,
        });
      });
    }

    essayEligibleSubmissions.forEach(sub => {
      let uTitle = 'عام';
      let uId = 'general';
      if (data && data.length > 0) {
        const found = data.find(u => u.lessons.some(l => l.id === sub.lessonId || l.title === sub.quizTitle));
        if (found) {
          uTitle = found.title;
          uId = found.id;
        }
      }
      if (!map.has(uTitle)) {
        map.set(uTitle, {
          id: uId,
          title: uTitle,
          count: 0,
          pendingCount: 0,
          draftCount: 0,
          approvedCount: 0,
        });
      }
      const item = map.get(uTitle)!;
      item.count++;
      if (sub.isFullyApproved) {
        item.approvedCount++;
      } else if (sub.isTeacherReviewed) {
        item.draftCount++;
      } else {
        item.pendingCount++;
      }
    });

    const list = Array.from(map.values()).filter(u => u.count > 0);

    // ترتيب الوحدات: التي تحتوي على إجابات معلقة تنتظر التصحيح تأتي في الصدارة
    return list.sort((a, b) => {
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
      if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
      if (a.draftCount > 0 && b.draftCount === 0) return -1;
      if (a.draftCount === 0 && b.draftCount > 0) return 1;
      return b.count - a.count;
    });
  }, [data, essayEligibleSubmissions]);

  // استخراج قائمة الامتحانات المتاحة بناءً على الوحدة المحددة مع تتبع تفصيلي لحالات التصحيح
  const availableQuizzes = useMemo(() => {
    const map = new Map<string, {
      title: string;
      unitTitle: string;
      count: number;
      pendingCount: number;
      draftCount: number;
      approvedCount: number;
    }>();

    let allowedLessonTitles: string[] | null = null;
    if (selectedUnitFilter !== 'all' && data && data.length > 0) {
      const matchedUnit = data.find(u => u.title === selectedUnitFilter || u.id === selectedUnitFilter);
      if (matchedUnit) {
        allowedLessonTitles = matchedUnit.lessons.map(l => l.title);
      }
    }

    essayEligibleSubmissions.forEach(sub => {
      const qTitle = sub.quizTitle || 'اختبار';
      if (allowedLessonTitles && !allowedLessonTitles.includes(qTitle) && !qTitle.includes(selectedUnitFilter)) {
        return;
      }
      const uTitle = findUnitForQuiz(sub.lessonId, sub.quizTitle);

      if (!map.has(qTitle)) {
        map.set(qTitle, {
          title: qTitle,
          unitTitle: uTitle,
          count: 0,
          pendingCount: 0,
          draftCount: 0,
          approvedCount: 0,
        });
      }
      const item = map.get(qTitle)!;
      item.count++;
      if (sub.isFullyApproved) {
        item.approvedCount++;
      } else if (sub.isTeacherReviewed) {
        item.draftCount++;
      } else {
        item.pendingCount++;
      }
    });

    const list = Array.from(map.values());
    // ترتيب: الامتحانات المعلقة أولاً، ثم التي بها مسودات، ثم المعتمدة
    return list.sort((a, b) => {
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
      if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
      if (a.draftCount > 0 && b.draftCount === 0) return -1;
      if (a.draftCount === 0 && b.draftCount > 0) return 1;
      return b.count - a.count;
    });
  }, [data, essayEligibleSubmissions, selectedUnitFilter]);

  // إحصائيات سريعة
  const stats = useMemo(() => {
    const total = essayEligibleSubmissions.length;
    const pending = essayEligibleSubmissions.filter(s => !s.isFullyApproved && !s.isTeacherReviewed).length;
    const reviewed = essayEligibleSubmissions.filter(s => !s.isFullyApproved && s.isTeacherReviewed).length;
    const approved = essayEligibleSubmissions.filter(s => s.isFullyApproved).length;
    return { total, pending, reviewed, approved };
  }, [essayEligibleSubmissions]);

  // فلترة التسليمات
  const filteredSubmissions = useMemo(() => {
    return essayEligibleSubmissions.filter(sub => {
      const matchStatus = 
        statusFilter === 'all' ? true :
        statusFilter === 'pending' ? (!sub.isFullyApproved && !sub.isTeacherReviewed) :
        statusFilter === 'reviewed' ? (!sub.isFullyApproved && sub.isTeacherReviewed) :
        sub.isFullyApproved;
      
      const matchType = 
        studentTypeFilter === 'all' ? true :
        studentTypeFilter === 'online' ? isSubOnline(sub) :
        !isSubOnline(sub);

      // فلتر الوحدة
      let matchUnit = true;
      if (selectedUnitFilter !== 'all') {
        if (data && data.length > 0) {
          const u = data.find(unit => unit.title === selectedUnitFilter || unit.id === selectedUnitFilter);
          if (u) {
            matchUnit = u.lessons.some(l => l.id === sub.lessonId || l.title === sub.quizTitle);
          } else {
            matchUnit = sub.quizTitle.includes(selectedUnitFilter);
          }
        } else {
          matchUnit = sub.quizTitle.includes(selectedUnitFilter);
        }
      }

      // فلتر الامتحان
      const cleanQuizFilter = (selectedQuizFilter || '').trim();
      const matchQuiz = cleanQuizFilter === 'all' 
        ? true 
        : ((sub.quizTitle && sub.quizTitle.trim() === cleanQuizFilter) || 
           (sub.lessonId && sub.lessonId.trim() === cleanQuizFilter) ||
           (sub.quizTitle && sub.quizTitle.includes(cleanQuizFilter)) ||
           (cleanQuizFilter.includes(sub.quizTitle)));

      const q = searchQuery.trim().toLowerCase();
      const matchSearch = !q || 
        sub.studentName.toLowerCase().includes(q) || 
        sub.studentPhone.includes(q) || 
        sub.quizTitle.toLowerCase().includes(q);

      return matchStatus && matchType && matchUnit && matchQuiz && matchSearch;
    });
  }, [essayEligibleSubmissions, statusFilter, studentTypeFilter, selectedUnitFilter, selectedQuizFilter, searchQuery, onlineStudents, data]);

  // البحث عن الطالب التالي الذي ينتظر التصحيح أو الاعتماد للانتقال السلس
  const nextPendingSub = useMemo(() => {
    if (!selectedSubForReview) return null;
    const currentIndex = filteredSubmissions.findIndex(s => s.id === selectedSubForReview.id);
    
    // 1. نبحث أولاً بعد الطالب الحالي في القائمة المعروضة عن أي طالب لم يُعتمد بعد
    const nextAfter = filteredSubmissions.slice(currentIndex + 1).find(s => 
      s.id !== selectedSubForReview.id && 
      !s.isFullyApproved
    );
    if (nextAfter) return nextAfter;

    // 2. إذا لم نجد بعده، نبحث في كامل القائمة المعروضة عن أي طالب لم يُعتمد بعد
    const anyInFiltered = filteredSubmissions.find(s => 
      s.id !== selectedSubForReview.id && 
      !s.isFullyApproved
    );
    if (anyInFiltered) return anyInFiltered;

    // 3. إن لم يكن هناك أي طالب غير معتمد، نبحث عن أي طالب تالي بعده للتصفح
    const nextAny = filteredSubmissions.slice(currentIndex + 1)[0];
    return nextAny || null;
  }, [selectedSubForReview, filteredSubmissions]);

  // حذف تسليم
  const handleDeleteSubmission = (id: string) => {
    if (!window.confirm('هل تريد حذف هذا التسليم نهائياً؟')) return;
    try {
      const current = getPendingEssaySubmissions().filter(s => s.id !== id);
      localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(current));
      refreshSubmissions();
      notifyPendingEssaysChanged();
      showToast('تم حذف التسليم بنجاح');
    } catch (e) {}
  };

  // معالجات خيارات الحذف وإعادة الامتحان للطالب
  const handleFullRetake = (sub: StudentEssaySubmission) => {
    try {
      const directive: StudentRetakeDirective = {
        id: `retake_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        studentPhone: sub.studentPhone,
        studentName: sub.studentName,
        lessonId: sub.lessonId || sub.quizTitle,
        lessonTitle: sub.quizTitle,
        retakeType: 'full',
        date: new Date().toLocaleDateString('ar-EG'),
        seen: false,
        maxPossibleScore: sub.maxPossibleScore || 50,
      };
      saveRetakeDirective(directive);

      // إرسال تصفير إلى الشيت
      if (onSaveResultToDB && sub.quizTitle) {
        onSaveResultToDB({
          quizName: `فرصة جديدة (كامل) 🔄: ${sub.quizTitle}`,
          score: `تصفير كامل 🔄`,
          studentName: sub.studentName,
          studentPhone: sub.studentPhone,
        });
      }

      // إزالة التسليم القديم
      const current = getPendingEssaySubmissions().filter(s => s.id !== sub.id);
      localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(current));
      refreshSubmissions();
      notifyPendingEssaysChanged();
      setRetakeModalSub(null);
      showToast(`🔄 تم تفعيل إعادة الامتحان كاملاً بنجاح للطالب/ة: ${sub.studentName}`);
    } catch (e) {
      console.error("Error setting full retake:", e);
    }
  };

  const handleEssayOnlyRetake = (sub: StudentEssaySubmission) => {
    try {
      const mcqQuestions = (sub.questions || []).filter(
        q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ'
      );
      const preservedMcqScore = mcqQuestions.reduce((sum, q) => sum + (q.teacherScore || 0), 0);

      const directive: StudentRetakeDirective = {
        id: `retake_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        studentPhone: sub.studentPhone,
        studentName: sub.studentName,
        lessonId: sub.lessonId || sub.quizTitle,
        lessonTitle: sub.quizTitle,
        retakeType: 'essay_only',
        date: new Date().toLocaleDateString('ar-EG'),
        seen: false,
        preservedMcqScore,
        preservedMcqAnswers: mcqQuestions,
        maxPossibleScore: sub.maxPossibleScore || 50,
      };
      saveRetakeDirective(directive);

      // إرسال تصفير المقالي إلى الشيت
      if (onSaveResultToDB && sub.quizTitle) {
        onSaveResultToDB({
          quizName: `فرصة جديدة (مقالي) ✍️: ${sub.quizTitle}`,
          score: `تصفير مقالي ✍️`,
          studentName: sub.studentName,
          studentPhone: sub.studentPhone,
        });
      }

      // إزالة التسليم القديم حتى يستقبله المصحح من جديد بعد صياغة الطالب
      const current = getPendingEssaySubmissions().filter(s => s.id !== sub.id);
      localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(current));
      refreshSubmissions();
      notifyPendingEssaysChanged();
      setRetakeModalSub(null);
      showToast(`✍️ تم تفعيل إعادة الأسئلة المقالية فقط (وحفظ الاختياري: ${preservedMcqScore} درجة) للطالب/ة: ${sub.studentName}`);
    } catch (e) {
      console.error("Error setting essay only retake:", e);
    }
  };

  const handleAdminDeleteOnly = (sub: StudentEssaySubmission) => {
    try {
      const current = getPendingEssaySubmissions().filter(s => s.id !== sub.id);
      localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(current));
      refreshSubmissions();
      notifyPendingEssaysChanged();
      setRetakeModalSub(null);
      showToast(`🗑️ تم حذف التسليم إدارياً للطالب/ة: ${sub.studentName}`);
    } catch (e) {
      console.error("Error admin delete:", e);
    }
  };

  return (
    <>
      <div className={`bg-white rounded-2xl shadow-md overflow-hidden animate-fade-in ${selectedSubForReview ? 'hidden' : ''}`} dir="rtl">
      {/* رأس التبويب */}
      <div className="bg-gradient-to-l from-amber-50/90 via-white to-orange-50/60 p-3 sm:p-5 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-base sm:text-xl font-black text-primary flex items-center gap-2">
            <i className="fas fa-feather-alt text-amber-500"></i> تصحيح الأسئلة المقالية ✍️
          </h2>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => fetchCloudSubmissions(true)}
            disabled={isLoadingCloud}
            className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs sm:text-sm px-3.5 py-2 sm:py-2.5 rounded-xl shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            title="تحديث وجلب كافة إجابات الطلاب المقالية من السحابة"
          >
            <i className={isLoadingCloud ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-down"}></i>
            <span>{isLoadingCloud ? "جاري التحديث..." : "تحديث السحابة 🔄"}</span>
          </button>

          {onNavigateToApproval && (
            <button
              type="button"
              onClick={onNavigateToApproval}
              className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm px-3.5 py-2 sm:py-2.5 rounded-xl shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer relative"
              title="الانتقال لاعتماد نتائج الطلاب ونشرها"
            >
              <i className="fas fa-stamp text-yellow-300"></i>
              <span>اعتماد النتائج 🎯</span>
              {stats.reviewed > 0 && (
                <span className="bg-white text-emerald-800 text-[10px] font-mono font-black px-1.5 py-0.2 rounded-full shadow-2xs">
                  {toEasternArabic(stats.reviewed)}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="p-3 sm:p-5 space-y-3.5 sm:space-y-4">
        
        {/* إشعار عائم للتأكيد */}
        {toastMessage && (
          <div className="p-2.5 sm:p-3 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 animate-fade-in">
            <i className="fas fa-check-circle text-emerald-600"></i>
            {toastMessage}
          </div>
        )}

        {/* لوحة المؤشرات الذكية والفلاتر السريعة بنقرة واحدة */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {/* 1. بانتظار التصحيح */}
          <div 
            onClick={() => setStatusFilter('pending')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border-2 text-center cursor-pointer transition-all duration-200 select-none ${
              statusFilter === 'pending'
                ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400/40 shadow-xs'
                : 'border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/20'
            }`}
            title="انقر لعرض الطلاب بانتظار التصحيح فقط"
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full bg-amber-500 ${stats.pending > 0 ? 'animate-ping' : ''}`}></span>
              <span className="text-[11px] sm:text-xs font-black text-amber-800">⏳ بانتظار التصحيح</span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-amber-950 block">
              {toEasternArabic(stats.pending)} طالب
            </span>
          </div>

          {/* 2. مسودات مصححة */}
          <div 
            onClick={() => setStatusFilter('reviewed')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border-2 text-center cursor-pointer transition-all duration-200 select-none ${
              statusFilter === 'reviewed'
                ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-400/40 shadow-xs'
                : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/20'
            }`}
            title="انقر لعرض المسودات المصححة الجاهزة للاعتماد"
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="text-[11px] sm:text-xs font-black text-purple-800">💾 مسودات مصححة</span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-purple-950 block">
              {toEasternArabic(stats.reviewed)} طالب
            </span>
          </div>

          {/* 3. معتمد ومؤرشف */}
          <div 
            onClick={() => setStatusFilter('approved')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border-2 text-center cursor-pointer transition-all duration-200 select-none ${
              statusFilter === 'approved'
                ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400/40 shadow-xs'
                : 'border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/20'
            }`}
            title="انقر لعرض الطلاب والامتحانات المعتمدة والمؤرشفة"
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="text-[11px] sm:text-xs font-black text-emerald-800">✅ معتمد ومؤرشف</span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-emerald-950 block">
              {toEasternArabic(stats.approved)} طالب
            </span>
          </div>

          {/* 4. إجمالي التسليمات */}
          <div 
            onClick={() => setStatusFilter('all')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border-2 text-center cursor-pointer transition-all duration-200 select-none ${
              statusFilter === 'all'
                ? 'border-slate-800 bg-slate-100 ring-2 ring-slate-400/40 shadow-xs'
                : 'border-gray-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            }`}
            title="انقر لعرض كافة الطلاب بلا استثناء"
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="text-[11px] sm:text-xs font-black text-slate-800">📁 إجمالي التسليمات</span>
            </div>
            <span className="text-lg sm:text-2xl font-black text-slate-900 block">
              {toEasternArabic(stats.total)} تسليم
            </span>
          </div>
        </div>

        <div className="space-y-4 animate-fade-in">
            {/* شريط وضع التركيز إن كان هناك امتحان محدد */}
            {selectedQuizFilter !== 'all' && (
              <div className="bg-gradient-to-r from-indigo-950 via-primary to-slate-900 text-white p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl shadow-md flex items-center justify-between gap-2.5 animate-fade-in">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center text-xs sm:text-sm font-black shrink-0 shadow-2xs">
                    <i className="fas fa-bullseye"></i>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] text-amber-300 font-bold block">الامتحان المحدد:</span>
                    <h3 className="text-xs sm:text-sm font-black truncate">{selectedQuizFilter}</h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedQuizFilter('all')}
                  className="bg-white/15 hover:bg-white/25 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-all flex items-center justify-center gap-1 border border-white/20 active:scale-95 cursor-pointer shrink-0"
                  title="عرض كافة الامتحانات"
                >
                  <i className="fas fa-times"></i>
                  <span>كافة الامتحانات</span>
                </button>
              </div>
            )}

            {/* لوحة تحديد الامتحان والوحدة المستهدفة للتصحيح بإظهار لوني ذكي */}
            <div className="bg-white border-2 border-slate-200 p-3 sm:p-4 rounded-xl sm:rounded-2xl space-y-3 shadow-xs">
              
              {/* ترويسة اللوحة ودليل الألوان السريع والموجز */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs sm:text-sm font-black shrink-0">
                    <i className="fas fa-layer-group"></i>
                  </span>
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">
                    تحديد الوحدة والامتحان
                  </h3>
                </div>

                {/* دليل دلالة الألوان المصغر وزر الإلغاء */}
                <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                    <span>⏳ معلق</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-900 border border-purple-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                    <span>💾 مسودة</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-900 border border-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span>✅ معتمد</span>
                  </span>
                  {(selectedUnitFilter !== 'all' || selectedQuizFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUnitFilter('all');
                        setSelectedQuizFilter('all');
                      }}
                      className="font-black text-rose-600 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-md border border-rose-200 cursor-pointer flex items-center gap-1"
                      title="إلغاء الفلترة والعودة لعرض كافة الوحدات"
                    >
                      <i className="fas fa-times"></i>
                      <span>إلغاء</span>
                    </button>
                  )}
                </div>
              </div>

              {/* القوائم المنسدلة لاختيار الوحدة والدرس */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* 1. اختيار الوحدة الدراسية */}
                <div>
                  <label className="block text-[11px] sm:text-xs font-black text-slate-700 mb-1">
                    📂 الوحدة الدراسية:
                  </label>
                  <select
                    value={selectedUnitFilter}
                    onChange={e => {
                      setSelectedUnitFilter(e.target.value);
                      setSelectedQuizFilter('all');
                    }}
                    className="w-full p-2 sm:p-2.5 text-xs sm:text-sm font-bold border border-slate-300 rounded-xl focus:border-primary outline-none bg-slate-50 text-slate-900 shadow-2xs"
                  >
                    <option value="all">🌟 جميع الوحدات ({toEasternArabic(stats.total)} تسليم)</option>
                    {availableUnits.map(u => {
                      const tag = u.pendingCount > 0 
                        ? `⏳ [مطلوب: ${toEasternArabic(u.pendingCount)}]`
                        : u.draftCount > 0
                        ? `💾 [مسودات: ${toEasternArabic(u.draftCount)}]`
                        : `✅ [معتمدة]`;
                      return (
                        <option key={u.id} value={u.title}>
                          {tag} {u.title} ({toEasternArabic(u.count)})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* 2. اختيار الدرس / الامتحان */}
                <div>
                  <label className="block text-[11px] sm:text-xs font-black text-slate-700 mb-1">
                    📝 الامتحان المستهدف:
                  </label>
                  <select
                    value={selectedQuizFilter}
                    onChange={e => setSelectedQuizFilter(e.target.value)}
                    className="w-full p-2 sm:p-2.5 text-xs sm:text-sm font-bold border border-slate-300 rounded-xl focus:border-primary outline-none bg-slate-50 text-slate-900 shadow-2xs"
                  >
                    <option value="all">
                      📖 جميع الامتحانات ({toEasternArabic(availableQuizzes.reduce((s, q) => s + q.count, 0))} تسليم)
                    </option>
                    {availableQuizzes.map(q => {
                      const tag = q.pendingCount > 0
                        ? `⏳ [معلق: ${toEasternArabic(q.pendingCount)}]`
                        : q.draftCount > 0
                        ? `💾 [مسودات: ${toEasternArabic(q.draftCount)}]`
                        : `✅ [معتمد]`;
                      return (
                        <option key={q.title} value={q.title}>
                          {tag} {q.title} ({toEasternArabic(q.count)})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* أزرار الوحدات السريعة بالتمرير الأفقي */}
              {availableUnits.length > 0 && (
                <div className="space-y-1 pt-0.5">
                  <span className="text-[11px] font-black text-slate-600 block">
                    الوحدات الدراسية:
                  </span>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-nowrap scroll-smooth">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUnitFilter('all');
                        setSelectedQuizFilter('all');
                      }}
                      className={`text-xs font-black px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                        selectedUnitFilter === 'all'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      <span>🌟 الكل</span>
                      <span className="bg-white/20 px-1 py-0.2 rounded text-[10px]">
                        {toEasternArabic(stats.total)}
                      </span>
                    </button>

                    {availableUnits.map(u => {
                      const isPending = u.pendingCount > 0;
                      const isDraft = !isPending && u.draftCount > 0;
                      const isSelected = selectedUnitFilter === u.title;

                      let btnClass = '';
                      if (isSelected) {
                        btnClass = isPending 
                          ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-400 font-black' 
                          : isDraft 
                          ? 'bg-purple-600 text-white shadow-xs ring-2 ring-purple-400 font-black'
                          : 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-400 font-black';
                      } else {
                        btnClass = isPending
                          ? 'bg-amber-50 text-amber-950 border border-amber-300 hover:bg-amber-100'
                          : isDraft
                          ? 'bg-purple-50 text-purple-950 border border-purple-300 hover:bg-purple-100'
                          : 'bg-emerald-50 text-emerald-950 border border-emerald-300 hover:bg-emerald-100';
                      }

                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setSelectedUnitFilter(u.title);
                            setSelectedQuizFilter('all');
                          }}
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer flex items-center gap-1 ${btnClass}`}
                        >
                          <span>{isPending ? '⏳' : isDraft ? '💾' : '✅'}</span>
                          <span>{u.title}</span>
                          <span className={`px-1 py-0.2 rounded text-[10px] font-mono ${
                            isSelected ? 'bg-white/25 text-white font-black' : 'bg-black/5 text-gray-700'
                          }`}>
                            {isPending ? `${toEasternArabic(u.pendingCount)}` : `${toEasternArabic(u.count)}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* بطاقات / أزرار الامتحانات المستهدفة الملونة */}
              {availableQuizzes.length > 0 && (
                <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-slate-700">
                      الامتحانات المستهدفة ({toEasternArabic(availableQuizzes.length)}):
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[220px] overflow-y-auto p-0.5">
                    {/* خيار عرض كافة الامتحانات */}
                    <button
                      type="button"
                      onClick={() => setSelectedQuizFilter('all')}
                      className={`p-2 rounded-xl border-2 text-right transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        selectedQuizFilter === 'all'
                          ? 'border-slate-800 bg-slate-900 text-white shadow-xs'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm shrink-0">🌟</span>
                        <div className="text-xs font-black truncate">كافة الامتحانات والدروس</div>
                      </div>
                      <span className={`text-[11px] font-mono font-black px-1.5 py-0.2 rounded-md shrink-0 ${
                        selectedQuizFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {toEasternArabic(availableQuizzes.reduce((s, q) => s + q.count, 0))}
                      </span>
                    </button>

                    {/* قائمة الامتحانات الملونة */}
                    {availableQuizzes.map(q => {
                      const isPending = q.pendingCount > 0;
                      const isDraft = !isPending && q.draftCount > 0;
                      const isSelected = selectedQuizFilter === q.title;

                      let cardStyle = '';
                      let badgeStyle = '';
                      let badgeText = '';

                      if (isPending) {
                        badgeText = `⏳ معلق: ${toEasternArabic(q.pendingCount)}`;
                        if (isSelected) {
                          cardStyle = 'border-amber-500 bg-amber-100 ring-2 ring-amber-400/50 shadow-2xs';
                          badgeStyle = 'bg-amber-500 text-white';
                        } else {
                          cardStyle = 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/80';
                          badgeStyle = 'bg-amber-200/80 text-amber-950 border border-amber-300';
                        }
                      } else if (isDraft) {
                        badgeText = `💾 مسودات: ${toEasternArabic(q.draftCount)}`;
                        if (isSelected) {
                          cardStyle = 'border-purple-500 bg-purple-100 ring-2 ring-purple-400/50 shadow-2xs';
                          badgeStyle = 'bg-purple-600 text-white';
                        } else {
                          cardStyle = 'border-purple-300 bg-purple-50/70 hover:bg-purple-100/80';
                          badgeStyle = 'bg-purple-200/80 text-purple-950 border border-purple-300';
                        }
                      } else {
                        badgeText = `✅ معتمد (${toEasternArabic(q.approvedCount)})`;
                        if (isSelected) {
                          cardStyle = 'border-emerald-500 bg-emerald-100 ring-2 ring-emerald-400/50 shadow-2xs';
                          badgeStyle = 'bg-emerald-600 text-white';
                        } else {
                          cardStyle = 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/70';
                          badgeStyle = 'bg-emerald-100 text-emerald-900 border border-emerald-200';
                        }
                      }

                      return (
                        <button
                          key={q.title}
                          type="button"
                          onClick={() => setSelectedQuizFilter(q.title)}
                          className={`p-2 rounded-xl border-2 text-right transition-all cursor-pointer flex flex-col justify-between gap-1 ${cardStyle}`}
                          title={q.title}
                        >
                          <div className="flex items-start justify-between gap-1.5 w-full">
                            <span className="text-xs font-black text-slate-900 line-clamp-1 flex-1 leading-snug">
                              {q.title}
                            </span>
                            <span className="text-[10px] font-mono font-bold bg-white/70 px-1 py-0.2 rounded border border-slate-200 text-slate-700 shrink-0">
                              {toEasternArabic(q.count)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-1 w-full text-[10px]">
                            <span className={`px-1.5 py-0.2 rounded font-black shrink-0 ${badgeStyle}`}>
                              {badgeText}
                            </span>
                            <span className="text-slate-500 font-bold truncate">
                              {q.unitTitle}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* شريط البحث المطور وأدوات الفلترة السريعة */}
            <div className="bg-white border-2 border-slate-200 p-3 sm:p-4 rounded-2xl space-y-2.5 sm:space-y-3 shadow-xs">
              {/* السطر 1: حقل البحث العريض والبارز مع زر البحث ومسح البحث متوافق مع الموبايل في صف واحد */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-primary flex items-center pointer-events-none">
                    <i className="fas fa-search text-sm"></i>
                  </div>
                  <input
                    type="text"
                    placeholder="ابحث بالطالب، الهاتف، أو الامتحان..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pr-10 pl-9 py-2.5 sm:py-3 text-xs sm:text-sm font-bold border-2 border-slate-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none bg-slate-50 transition-all text-slate-900 placeholder:text-gray-400"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 flex items-center justify-center text-[10px] sm:text-xs transition-all cursor-pointer"
                      title="مسح البحث"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className="px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-primary hover:bg-primary/95 text-white font-black text-xs sm:text-sm shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer shrink-0"
                >
                  <i className="fas fa-magnifying-glass"></i>
                  <span>بحث</span>
                  {searchQuery.trim() && (
                    <span className="bg-white/25 px-1.5 py-0.2 rounded-md text-[10px] sm:text-xs font-mono">
                      {toEasternArabic(filteredSubmissions.length)}
                    </span>
                  )}
                </button>
              </div>

              {/* السطر 2: أدوات الفرز والتصفية الموزعة بأناقة بدون أي تكدس مع شريط تمرير أفقي للموبايل */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                {/* 1. فلاتر الحالة السريعة */}
                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-nowrap scroll-smooth">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('pending')}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                      statusFilter === 'pending' ? 'bg-white text-amber-900 shadow-xs font-black ring-1 ring-amber-300' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <span>⏳ معلق</span>
                    <span className="font-mono text-[11px]">({toEasternArabic(stats.pending)})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('reviewed')}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                      statusFilter === 'reviewed' ? 'bg-white text-purple-900 shadow-xs font-black ring-1 ring-purple-300' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <span>💾 مسودة</span>
                    <span className="font-mono text-[11px]">({toEasternArabic(stats.reviewed)})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('approved')}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                      statusFilter === 'approved' ? 'bg-white text-emerald-900 shadow-xs font-black ring-1 ring-emerald-300' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <span>✅ معتمد</span>
                    <span className="font-mono text-[11px]">({toEasternArabic(stats.approved)})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                      statusFilter === 'all' ? 'bg-white text-primary shadow-xs font-black' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <span>📁 الكل</span>
                  </button>
                </div>

                {/* 2. تصفية نوع الطالب سنتر / أونلاين */}
                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl shrink-0 self-start sm:self-auto overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    type="button"
                    onClick={() => setStudentTypeFilter('all')}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                      studentTypeFilter === 'all' ? 'bg-primary text-white shadow-xs font-black' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentTypeFilter('center')}
                    className={`text-xs font-bold px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                      studentTypeFilter === 'center' ? 'bg-blue-600 text-white shadow-xs font-black' : 'text-blue-700 hover:bg-blue-50'
                    }`}
                  >
                    🏫 سنتر
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentTypeFilter('online')}
                    className={`text-xs font-bold px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                      studentTypeFilter === 'online' ? 'bg-emerald-600 text-white shadow-xs font-black' : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    🌐 أونلاين
                  </button>
                </div>
              </div>
            </div>

            {/* شريط الإجراء السريع: بدء التصحيح المتتابع فوراً */}
            {(() => {
              const pendingInCurrentView = filteredSubmissions.filter(s => !s.isFullyApproved && !s.isTeacherReviewed && hasWrittenEssayAnswers(s));
              if (pendingInCurrentView.length === 0) return null;
              return (
                <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 p-3 rounded-2xl border-2 border-amber-300 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 shadow-xs animate-fade-in">
                  <div className="flex items-center gap-2 text-right">
                    <span className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center text-sm shrink-0 shadow-xs">
                      ⚡
                    </span>
                    <h4 className="text-xs sm:text-sm font-black text-amber-950">
                      ({toEasternArabic(pendingInCurrentView.length)}) طالب بانتظار تصحيح إجاباتهم المقالية
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const first = pendingInCurrentView[0] || filteredSubmissions[0];
                      if (first) setSelectedSubForReview(first);
                    }}
                    className="w-full sm:w-auto px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                  >
                    <i className="fas fa-bolt text-yellow-200"></i>
                    <span>بدء التصحيح المتتابع ({toEasternArabic(pendingInCurrentView.length)})</span>
                  </button>
                </div>
              );
            })()}

            {/* قائمة التسليمات */}
            {filteredSubmissions.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                <i className="fas fa-clipboard-check text-4xl text-gray-300 mb-2 block"></i>
                <h4 className="font-black text-gray-700 text-base">لا توجد تسليمات مقالية مطابقة حالياً</h4>
                <p className="text-xs text-gray-400 mt-1">
                  عندما يؤدي الطلاب امتحانات تحتوي على أسئلة مقالية في الوضع الهجين، ستظهر إجاباتهم هنا لمراجعتها واعتمادها.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSubmissions.map(sub => {
                  const isApproved = sub.isFullyApproved;
                  const subIsOnline = isSubOnline(sub);
                  return (
                    <div
                      key={sub.id}
                      className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 ${
                        isApproved 
                          ? 'bg-white border-gray-200 hover:border-emerald-300' 
                          : 'bg-amber-50/40 border-amber-300 shadow-xs hover:border-amber-400'
                      }`}
                    >
                      {/* بيانات الطالب والاختبار */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setInspectingSub(sub)}
                            className="font-black text-sm sm:text-base text-gray-900 hover:text-primary dark:text-white dark:hover:text-blue-400 flex items-center gap-1.5 group cursor-pointer text-right transition-colors"
                            title="انقر لعرض ورقة أسئلة الطالب وإجاباته كاملة (موضوعي ومقالي)"
                          >
                            <span className="underline decoration-dotted decoration-primary/40 group-hover:decoration-primary group-hover:underline-offset-2">{sub.studentName}</span>
                            <i className="fas fa-file-lines text-xs text-primary/70 group-hover:text-primary transition-transform group-hover:scale-110"></i>
                          </button>
                          <span className="text-[11px] sm:text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md" dir="ltr">
                            {sub.studentPhone}
                          </span>
                          {subIsOnline ? (
                            <span className="text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                              🌐 أونلاين
                            </span>
                          ) : (
                            <span className="text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                              🏫 سنتر
                            </span>
                          )}
                          {(() => {
                            const hasDraftScores = !sub.isFullyApproved && (sub.isTeacherReviewed || sub.questions.some(q => q.teacherScore !== undefined));
                            if (isApproved) {
                              return (
                                <span className="text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  ✅ معتمد
                                </span>
                              );
                            }
                            if (hasDraftScores) {
                              return (
                                <span className="text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300">
                                  💾 مسودة
                                </span>
                              );
                            }
                            return (
                              <span className="text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                                ⏳ معلق
                              </span>
                            );
                          })()}
                          {(sub.isAutoTerminated || sub.terminationReason || sub.questions.some(q => q.teacherFeedback?.includes('سحب') || q.studentText?.includes('سحبت') || q.teacherFeedback?.includes('مخالفات'))) && (
                            <span className="text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-300 flex items-center gap-1 shadow-xs">
                              <i className="fas fa-shield-halved text-rose-600"></i> سُحبت لمخالفات
                            </span>
                          )}

                          {/* مكان الخطوط الحمراء: درجات الموضوعي والمقالي والمجموع */}
                          {(() => {
                            const subScores = calculateSubScores(sub, data);
                            return (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span 
                                  className="text-[10px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-900 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800 flex items-center gap-1 shadow-2xs"
                                  title="درجة الأسئلة الموضوعية (اختياري وصح/خطأ)"
                                >
                                  <i className="fas fa-check-double text-blue-600 dark:text-blue-400"></i>
                                  <span>موضوعي: {toEasternArabic(subScores.mcqEarned)} من {toEasternArabic(subScores.mcqMax)}</span>
                                </span>

                                <span 
                                  className="text-[10px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-900 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-800 flex items-center gap-1 shadow-2xs"
                                  title="درجة الأسئلة المقالية"
                                >
                                  <i className="fas fa-feather-alt text-purple-600 dark:text-purple-400"></i>
                                  <span>مقالي: {toEasternArabic(subScores.essayEarned)} من {toEasternArabic(subScores.essayMax)}</span>
                                </span>

                                <span 
                                  className="text-[10px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-950 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800 flex items-center gap-1 shadow-2xs font-mono"
                                  title="المجموع الكلي والنسبة المئوية"
                                >
                                  <i className="fas fa-award text-amber-500"></i>
                                  <span>{toEasternArabic(subScores.totalEarned)} من {toEasternArabic(subScores.totalMax)} ({toEasternArabic(subScores.perc)}%)</span>
                                </span>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-gray-500 font-bold flex-wrap mt-1">
                          <span className="text-primary font-black truncate max-w-[200px] sm:max-w-none">
                            <i className="fas fa-book-open ml-1"></i> {sub.quizTitle}
                          </span>
                          <span>
                            <i className="fas fa-calendar-alt ml-1"></i> {sub.submissionDate}
                          </span>
                          <span>
                            <i className="fas fa-pen-nib ml-1"></i> {toEasternArabic(sub.questions.length)} أسئلة
                          </span>
                        </div>
                      </div>

                      {/* أزرار الإجراءات متجاوبة ومريحة للموبايل */}
                      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        <button
                          type="button"
                          onClick={() => setSelectedSubForReview(sub)}
                          className={`flex-1 sm:flex-none text-xs font-black px-3.5 sm:px-4 py-2.5 sm:py-2 rounded-xl shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${
                            isApproved
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : 'bg-primary hover:bg-primary-dark text-white'
                          }`}
                        >
                          <i className={`fas ${isApproved ? 'fa-pen-to-square' : 'fa-feather-alt'}`}></i>
                          <span>{isApproved ? 'تعديل الدرجات ✏️' : 'تصحيح المقالي ✍️'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setRetakeModalSub(sub)}
                          className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-gray-100 hover:bg-rose-100 text-gray-400 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          title="خيارات الحذف وتصفير وإعادة الامتحان للطالب"
                        >
                          <i className="fas fa-trash-alt text-xs"></i>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

      </div>
    </div>

    {/* نافذة تفاصيل فحص وتصحيح إجابات الطالب الفردي */}
      {selectedSubForReview && (
        <StudentEssayReviewModal
          key={selectedSubForReview.id}
          submission={selectedSubForReview}
          data={data}
          hasNextPending={!!nextPendingSub}
          onRequestRetake={(sub) => {
            setSelectedSubForReview(null);
            setRetakeModalSub(sub);
          }}
          onClose={() => setSelectedSubForReview(null)}
          onSaveApprovedAndNext={(updated) => {
            savePendingEssaySubmission(updated);
            syncGradeToCloud(updated);
            if (onSaveResultToDB && updated.quizTitle) {
              let matchedLesson = null;
              if (data && data.length > 0) {
                for (const u of data) {
                  const l = u.lessons.find(ls => ls.id === updated.lessonId || ls.title.trim() === updated.quizTitle.trim());
                  if (l) { matchedLesson = l; break; }
                }
              }
              let effectiveEarned = updated.finalScore || 0;
              let effectiveMax = updated.maxPossibleScore || 50;
              if (matchedLesson) {
                const structure = calculateExamStructure(matchedLesson.questions, getExamConfig(matchedLesson.id));
                effectiveMax = structure.examTotalScore;
                const mcqMax = structure.mcqTotalScore + structure.tfTotalScore;
                const hasMcq = updated.questions.some(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
                if (!hasMcq && mcqMax > 0 && effectiveEarned < mcqMax) {
                  effectiveEarned += mcqMax;
                }
              }
              const perc = Math.min(100, Math.round((effectiveEarned / Math.max(1, effectiveMax)) * 100));
              onSaveResultToDB({
                quizName: updated.quizTitle,
                score: `${perc}%`,
                studentName: updated.studentName,
                studentPhone: updated.studentPhone,
              });
            }

            // تحديث القائمة الحية فوراً ليظهر الطالب معتمداً بشارة خضراء
            setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));

            // العثور على الطالب التالي بدقة من القائمة المعروضة أمام المعلم
            const currentIndex = filteredSubmissions.findIndex(s => s.id === updated.id);
            let nextTarget = filteredSubmissions.slice(currentIndex + 1).find(s => s.id !== updated.id && !s.isFullyApproved);
            if (!nextTarget) {
              nextTarget = filteredSubmissions.find(s => s.id !== updated.id && !s.isFullyApproved);
            }

            if (nextTarget) {
              showToast(`✅ تم اعتماد: ${updated.studentName} والانتقال إلى: ${nextTarget.studentName}`);
              setSelectedSubForReview(nextTarget);
            } else {
              setSelectedSubForReview(null);
              showToast(`🎉 تم اعتماد درجات: ${updated.studentName}، واكتمل اعتماد كافة الطلاب!`);
            }
          }}
          onSaveApproved={(updated) => {
            savePendingEssaySubmission(updated);
            syncGradeToCloud(updated);
            setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));
            if (onSaveResultToDB && updated.quizTitle) {
              let matchedLesson = null;
              if (data && data.length > 0) {
                for (const u of data) {
                  const l = u.lessons.find(ls => ls.id === updated.lessonId || ls.title.trim() === updated.quizTitle.trim());
                  if (l) { matchedLesson = l; break; }
                }
              }
              let effectiveEarned = updated.finalScore || 0;
              let effectiveMax = updated.maxPossibleScore || 50;
              if (matchedLesson) {
                const structure = calculateExamStructure(matchedLesson.questions, getExamConfig(matchedLesson.id));
                effectiveMax = structure.examTotalScore;
                const mcqMax = structure.mcqTotalScore + structure.tfTotalScore;
                const hasMcq = updated.questions.some(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
                if (!hasMcq && mcqMax > 0 && effectiveEarned < mcqMax) {
                  effectiveEarned += mcqMax;
                }
              }
              const perc = Math.min(100, Math.round((effectiveEarned / Math.max(1, effectiveMax)) * 100));
              onSaveResultToDB({
                quizName: updated.quizTitle,
                score: `${perc}%`,
                studentName: updated.studentName,
                studentPhone: updated.studentPhone,
              });
            }
            setSelectedSubForReview(null);
            showToast(`✅ تم اعتماد وتحديث درجات: ${updated.studentName}`);
          }}
          onSaveDraft={(updated) => {
            savePendingEssaySubmission(updated);
            syncDraftToCloud(updated);
            setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));
            setSelectedSubForReview(null);
            showToast(`💾 تم حفظ درجات ${updated.studentName} كمسودة بنجاح`);
          }}
          onSaveDraftAndNext={(updated) => {
            savePendingEssaySubmission(updated);
            syncDraftToCloud(updated);
            setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));

            // العثور على الطالب التالي بدقة من القائمة المعروضة أمام المعلم
            const currentIndex = filteredSubmissions.findIndex(s => s.id === updated.id);
            let nextTarget = filteredSubmissions.slice(currentIndex + 1).find(s => s.id !== updated.id && !s.isFullyApproved);
            if (!nextTarget) {
              nextTarget = filteredSubmissions.find(s => s.id !== updated.id && !s.isFullyApproved);
            }

            if (nextTarget) {
              showToast(`💾 تم حفظ درجات: ${updated.studentName} كمسودة والانتقال إلى: ${nextTarget.studentName}`);
              setSelectedSubForReview(nextTarget);
            } else {
              setSelectedSubForReview(null);
              showToast(`🎉 تم الانتهاء من تصحيح كافة طلاب هذا القسم بنجاح!`);
            }
          }}
          isDarkMode={isDarkMode}
          onNavigateToApproval={onNavigateToApproval}
        />
      )}

      {/* نافذة خيارات الحذف وإعادة المحاولة للطالب (كامل أو مقالي فقط) */}
      {retakeModalSub && (() => {
        const mcqQuestions = (retakeModalSub.questions || []).filter(
          q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ'
        );
        const preservedMcqScore = mcqQuestions.reduce((sum, q) => sum + (q.teacherScore || 0), 0);
        const gender = detectArabicGender(retakeModalSub.studentName);
        const isFemale = gender === 'female';

        return (
          <div className="fixed inset-0 z-[999999] bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 select-none" dir="rtl">
            <div className="bg-white dark:bg-gray-800 rounded-3xl max-w-xl w-full p-5 sm:p-7 shadow-2xl border-t-8 border-indigo-600 text-right animate-scale-up space-y-4 max-h-[92vh] overflow-y-auto">
              
              {/* ترويسة النافذة */}
              <div className="flex items-center justify-between border-b pb-3.5 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-2xl shrink-0">
                    🔄
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-gray-900 dark:text-gray-100">
                      إدارة محاولة الامتحان وتوجيه الطالب
                    </h3>
                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-0.5">
                      {retakeModalSub.quizTitle}
                    </p>
                  </div>
                </div>

                <span className={`px-2.5 py-1 rounded-xl text-xs font-black border ${
                  isFemale 
                    ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300' 
                    : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300'
                }`}>
                  {isFemale ? 'ابنتنا الطالبة 🌸' : 'ابننا الطالب 🎓'}
                </span>
              </div>

              {/* بطاقة تعريف الطالب */}
              <div className="bg-gray-50 dark:bg-gray-750 p-3 rounded-2xl border border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs font-bold text-gray-700 dark:text-gray-300">
                <div className="flex items-center gap-2">
                  <span className="font-black text-gray-900 dark:text-white">👤 {retakeModalSub.studentName}</span>
                  <span className="text-gray-400">|</span>
                  <span dir="ltr">{retakeModalSub.studentPhone}</span>
                </div>
                {mcqQuestions.length > 0 && (
                  <span className="text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-800 font-black">
                    درجة الاختياري: {toEasternArabic(preservedMcqScore)} نقطة
                  </span>
                )}
              </div>

              {/* نص التوضيح */}
              <div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-bold">
                اختر نوع الإجراء المطلوب تطبيقه. عند اختيار الإعادة، ستظهر للطالب بطاقة تنبيهية غير قابلة للإغلاق إلا بعد الموافقة، مع توجيه تعليمي تشجيعي من الأستاذ إسلام سعود:
              </div>

              {/* خيارات الإجراء */}
              <div className="space-y-3 pt-1">
                {/* الخيار 1: إعادة الامتحان بالكامل */}
                <button
                  type="button"
                  onClick={() => handleFullRetake(retakeModalSub)}
                  className="w-full p-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs sm:text-sm flex items-center justify-between shadow-md active:scale-[0.99] transition-all cursor-pointer group text-right"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shrink-0">
                      🔄
                    </span>
                    <div>
                      <div className="text-white text-sm font-black flex items-center gap-2">
                        <span>إعادة محاولة الامتحان بالكامل (اختياري + مقالي)</span>
                        <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">فرصة كاملة جديدة</span>
                      </div>
                      <div className="text-[11px] font-normal text-blue-100 mt-1 leading-normal">
                        تصفير المحاولة وحذفها من الشيت، ويفتح الامتحان للطالب من السؤال الأول (شامل الاختياري والمقالي).
                      </div>
                    </div>
                  </div>
                  <i className="fas fa-chevron-left text-xs opacity-70 group-hover:-translate-x-1 transition-transform shrink-0 mr-2"></i>
                </button>

                {/* الخيار 2: إعادة الأسئلة المقالية فقط */}
                <button
                  type="button"
                  onClick={() => handleEssayOnlyRetake(retakeModalSub)}
                  className="w-full p-4 rounded-2xl bg-gradient-to-r from-amber-500 via-purple-600 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white font-black text-xs sm:text-sm flex items-center justify-between shadow-md active:scale-[0.99] transition-all cursor-pointer group text-right"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shrink-0">
                      ✍️
                    </span>
                    <div>
                      <div className="text-white text-sm font-black flex items-center gap-2">
                        <span>إعادة الأسئلة المقالية فقط (حفظ درجات الاختياري)</span>
                        <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">تركيز مقالي 🎯</span>
                      </div>
                      <div className="text-[11px] font-normal text-amber-100 mt-1 leading-normal">
                        الاحتفاظ بدرجة الاختياري ({toEasternArabic(preservedMcqScore)} نقطة)، ويفتح الامتحان مباشرة على الأسئلة المقالية فقط دون تكرار الاختياري.
                      </div>
                    </div>
                  </div>
                  <i className="fas fa-chevron-left text-xs opacity-70 group-hover:-translate-x-1 transition-transform shrink-0 mr-2"></i>
                </button>

                {/* الخيار 3: حذف إداري فقط */}
                <button
                  type="button"
                  onClick={() => handleAdminDeleteOnly(retakeModalSub)}
                  className="w-full p-3.5 rounded-2xl bg-gray-100 dark:bg-gray-700/80 hover:bg-rose-50 hover:border-rose-300 dark:hover:bg-rose-950/30 text-gray-700 dark:text-gray-200 hover:text-rose-700 dark:hover:text-rose-300 border border-gray-200 dark:border-gray-600 font-bold text-xs sm:text-sm flex items-center justify-between transition-all cursor-pointer group text-right"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-base shrink-0 group-hover:bg-rose-100 text-gray-600 dark:text-gray-300 group-hover:text-rose-600">
                      🗑️
                    </span>
                    <div>
                      <div className="font-black text-xs sm:text-sm">حذف إداري فقط من السجلات</div>
                      <div className="text-[11px] font-normal text-gray-500 dark:text-gray-400 mt-0.5">
                        إزالة التسليم من قائمة التصحيح فقط دون توجيه الطالب لإعادة الامتحان (لتنظيف السجلات).
                      </div>
                    </div>
                  </div>
                  <i className="fas fa-chevron-left text-xs opacity-50 group-hover:-translate-x-1 transition-transform shrink-0 mr-2"></i>
                </button>

                {/* زر التراجع والإلغاء */}
                <button
                  type="button"
                  onClick={() => setRetakeModalSub(null)}
                  className="w-full py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer text-center"
                >
                  إلغاء التراجع
                </button>
              </div>

            </div>
          </div>
        );
      })()}
      {/* نافذة تفصيل ورقة أسئلة الطالب وحله بالكامل */}
      {inspectingSub && (
        <StudentFullExamInspectionModal
          submission={inspectingSub}
          data={data}
          onClose={() => setInspectingSub(null)}
          isDarkMode={isDarkMode}
        />
      )}
    </>
  );
};

// -------------------------------------------------------------
// نافذة فحص ومراجعة إجابات الطالب الواحد (Modal)
// -------------------------------------------------------------

export interface StudentEssayReviewModalProps {
  submission: StudentEssaySubmission;
  data?: Unit[];
  onClose: () => void;
  onSaveApproved: (updated: StudentEssaySubmission) => void;
  onSaveDraft?: (updated: StudentEssaySubmission) => void;
  onSaveApprovedAndNext?: (updated: StudentEssaySubmission) => void;
  onSaveDraftAndNext?: (updated: StudentEssaySubmission) => void;
  onRequestRetake?: (submission: StudentEssaySubmission) => void;
  onNavigateToApproval?: () => void;
  hasNextPending?: boolean;
  isDarkMode?: boolean;
}

export const StudentEssayReviewModal: React.FC<StudentEssayReviewModalProps> = ({
  submission,
  data = [],
  onClose,
  onSaveApproved,
  onSaveDraft,
  onSaveApprovedAndNext,
  onSaveDraftAndNext,
  onRequestRetake,
  onNavigateToApproval,
  hasNextPending = false,
  isDarkMode = false,
}) => {
  const [questions, setQuestions] = useState<EssayReviewQuestionItem[]>(() => {
    const completeSub = ensureCompleteEssayQuestions(submission, data);
    return completeSub.questions.map((q, qIdx) => {
      let resolvedModelAnswer = q.modelAnswer || '';
      let resolvedMaxScore = q.maxScore || 2;

      if (!resolvedModelAnswer || resolvedModelAnswer.trim() === '' || resolvedModelAnswer.includes('لا يوجد')) {
        const found = resolveModelAnswer(q.questionText, submission.quizTitle, submission.lessonId, qIdx, data);
        if (found.modelAnswer) {
          resolvedModelAnswer = found.modelAnswer;
        }
        if (found.maxScore) {
          resolvedMaxScore = found.maxScore;
        }
      }

      const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
      return {
        ...q,
        modelAnswer: resolvedModelAnswer,
        maxScore: resolvedMaxScore,
        teacherScore: q.teacherScore !== undefined 
          ? Math.min(resolvedMaxScore, Number(q.teacherScore) || 0)
          : (q.aiScore !== undefined 
              ? Math.min(resolvedMaxScore, Number(q.aiScore) || 0)
              : (hasNoText ? 0 : resolvedMaxScore)),
        teacherFeedback: q.teacherFeedback || q.aiFeedback || (hasNoText ? 'لم يتم الإجابة على هذا السؤال.' : ''),
      };
    });
  });

  // تحديث النماذج تلقائياً في حال وصول بيانات المنهج بعد التحميل
  useEffect(() => {
    if (data && data.length > 0) {
      setQuestions(prev => {
        let changed = false;
        const next = prev.map((q, qIdx) => {
          if (!q.modelAnswer || q.modelAnswer.trim() === '' || q.modelAnswer.includes('لا يوجد')) {
            const found = resolveModelAnswer(q.questionText, submission.quizTitle, submission.lessonId, qIdx, data);
            if (found.modelAnswer) {
              changed = true;
              return {
                ...q,
                modelAnswer: found.modelAnswer,
                maxScore: found.maxScore || q.maxScore,
              };
            }
          }
          return q;
        });
        return changed ? next : prev;
      });
    }
  }, [data, submission]);

  // حالات المقارنة الذكية وتحليل الفروق (AI Diff)
  const [diffComparisons, setDiffComparisons] = useState<Record<number, EssayDiffComparison>>({});
  const [diffLoading, setDiffLoading] = useState<Record<number, boolean>>({});
  const [diffOpen, setDiffOpen] = useState<Record<number, boolean>>({});

  // حالة تعديل وكتابة نموذج الإجابة يدوياً من المعلم
  const [editingModelAnswerIdx, setEditingModelAnswerIdx] = useState<number | null>(null);
  const [customModelAnswerDraft, setCustomModelAnswerDraft] = useState<string>('');

  // تشغيل المقارنة الذكية تلقائياً فور توفر الإجابة ونموذج الإجابة (للأسئلة المقالية فقط)
  useEffect(() => {
    const hasAiKey = Boolean(getGeminiApiKey().trim() || getGroqApiKey().trim());
    questions.forEach((q, idx) => {
      if (q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ') return;
      const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
      const hasModelAns = q.modelAnswer && q.modelAnswer.trim() !== '' && !q.modelAnswer.includes('لا يوجد');
      
      // إذا لم يتوفر تقييم سابق، أو كان التقييم محلياً وتوفر الآن مفتاح ذكاء اصطناعي (Gemini أو Groq)
      const needsDiff = !hasNoText && (!diffComparisons[idx] || (hasAiKey && diffComparisons[idx].provider === 'heuristic'));
      
      if (needsDiff && !diffLoading[idx]) {
        const studentGender = detectArabicGender(submission?.studentName || '') === 'female' ? 'female' : 'male';
        setDiffLoading(prev => ({ ...prev, [idx]: true }));
        compareStudentWithModelAnswer(
          q.questionText,
          q.modelAnswer,
          q.studentText,
          q.maxScore,
          q.essayType,
          q.concept,
          studentGender
        ).then(res => {
          setDiffComparisons(prev => ({ ...prev, [idx]: res }));
        }).catch(e => {
          console.error("Auto AI Diff error for q" + idx, e);
        }).finally(() => {
          setDiffLoading(prev => ({ ...prev, [idx]: false }));
        });
      }
    });
  }, [questions]);

  const [isGlobalAiLoading, setIsGlobalAiLoading] = useState<boolean>(false);

  // إعادة الفحص الفردي المباشر للسؤال بنماذج الذكاء الاصطناعي (Gemini / Groq)
  const handleForceReCompare = async (idx: number, q: EssayReviewQuestionItem) => {
    const studentGender = detectArabicGender(submission?.studentName || '') === 'female' ? 'female' : 'male';
    setDiffLoading(prev => ({ ...prev, [idx]: true }));
    try {
      const res = await compareStudentWithModelAnswer(
        q.questionText,
        q.modelAnswer,
        q.studentText,
        q.maxScore,
        q.essayType,
        q.concept,
        studentGender
      );
      setDiffComparisons(prev => ({ ...prev, [idx]: res }));
      setDiffOpen(prev => ({ ...prev, [idx]: true }));
    } catch (e) {
      console.error("AI Diff error on force recompare:", e);
    } finally {
      setDiffLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  // إعادة فحص كافة أسئلة الامتحان المقالية بنماذج الذكاء الاصطناعي بنقرة واحدة
  const handleReCompareAllWithAi = async () => {
    setIsGlobalAiLoading(true);
    const studentGender = detectArabicGender(submission?.studentName || '') === 'female' ? 'female' : 'male';
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      if (q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ') continue;
      const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
      if (hasNoText) continue;

      setDiffLoading(prev => ({ ...prev, [idx]: true }));
      try {
        const res = await compareStudentWithModelAnswer(
          q.questionText,
          q.modelAnswer,
          q.studentText,
          q.maxScore,
          q.essayType,
          q.concept,
          studentGender
        );
        setDiffComparisons(prev => ({ ...prev, [idx]: res }));
      } catch (e) {
        console.error("Batch AI Diff error for q" + idx, e);
      } finally {
        setDiffLoading(prev => ({ ...prev, [idx]: false }));
      }
    }
    setIsGlobalAiLoading(false);
  };

  const handleTriggerDiff = async (idx: number, q: EssayReviewQuestionItem) => {
    if (diffOpen[idx]) {
      setDiffOpen(prev => ({ ...prev, [idx]: false }));
      return;
    }

    setDiffOpen(prev => ({ ...prev, [idx]: true }));
    const hasAiKey = Boolean(getGeminiApiKey().trim() || getGroqApiKey().trim());
    // إذا كان التقييم موجوداً بنموذج الذكاء الاصطناعي لا داعي لتكرار الطلب
    if (diffComparisons[idx] && (!hasAiKey || diffComparisons[idx].provider !== 'heuristic')) return;

    setDiffLoading(prev => ({ ...prev, [idx]: true }));
    try {
      const studentGender = detectArabicGender(submission?.studentName || '') === 'female' ? 'female' : 'male';
      const res = await compareStudentWithModelAnswer(
        q.questionText,
        q.modelAnswer,
        q.studentText,
        q.maxScore,
        q.essayType,
        q.concept,
        studentGender
      );
      setDiffComparisons(prev => ({ ...prev, [idx]: res }));
    } catch (e) {
      console.error("AI Diff error:", e);
    } finally {
      setDiffLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  const handleApplyDiffSuggestion = (idx: number, diff: EssayDiffComparison) => {
    handleScoreChange(idx, diff.suggestedScore);

    // تنظيف العناصر الناقصة أو المفقودة وتنسيقها تربوياً وبلاغياً للمعلم والطالب
    const validMissing = (diff.missingPoints || [])
      .filter(p => p && !p.includes('جميع العناصر') && !p.includes('جميع عناصر') && !p.includes('جميع النقاط'))
      .map(p => p.replace(/^لم يشر إلى:\s*"?/, '').replace(/"?$/, '').trim())
      .filter(Boolean);

    let feedbackText = '';
    const q = questions[idx];
    const maxScore = q?.maxScore || 2;
    const score = diff.suggestedScore;

    const isFemale = detectArabicGender(submission?.studentName || '') === 'female';
    const praiseMsg = isFemale
      ? '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتِ وبارك الله فيكِ! 🌟'
      : '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتَ وبارك الله فيك! 🌟';

    if (score >= maxScore * 0.85) {
      feedbackText = praiseMsg;
    } else if (validMissing.length === 0 || validMissing.every(m => m.includes('استوفيت') || m.includes('مكتملة') || m.includes('شاملة'))) {
      feedbackText = isFemale
        ? `👍 أحسنتِ بذكر الشخصيات والمفاهيم المطلوبة، ولكن ينقص إجابتكِ التوسع في الشرح والتحليل التاريخي لاستحقاق الدرجة الكاملة (${score} من ${maxScore}). 💡`
        : `👍 أحسنتَ بذكر الشخصيات والمفاهيم المطلوبة، ولكن ينقص إجابتكَ التوسع في الشرح والتحليل التاريخي لاستحقاق الدرجة الكاملة (${score} من ${maxScore}). 💡`;
    } else if (score >= maxScore * 0.4) {
      const missingListStr = validMissing.slice(0, 2).join('، ');
      feedbackText = isFemale
        ? `👍 أوردتِ فكرة عامة طيبة وموفقة، ولكن ينقصكِ لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركّزي جيداً عليها لتضمني الدرجة الكاملة! 💡`
        : `👍 أوردتَ فكرة عامة طيبة وموفقة، ولكن ينقصكَ لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركّز جيداً عليها لتضمن الدرجة الكاملة! 💡`;
    } else if (score > 0) {
      const missingListStr = validMissing.slice(0, 2).join('، ');
      feedbackText = isFemale
        ? `⚠️ إجابتكِ ناقصة وبحاجة لمزيد من التركيز؛ حيث أغفلتِ عن توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`
        : `⚠️ إجابتكَ ناقصة وبحاجة لمزيد من التركيز؛ حيث أغفلتَ عن توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`;
    } else {
      feedbackText = diff.studentFeedback || `${diff.verdictSummary}`;
    }

    // فحص ذكي: إذا كانت إجابة الطالب تفتقر لترقيم وتنسيق الفقرات، نطلب منه ترقيمها وتنسيقها
    const needsFormat = checkNeedsFormattingGuidance(q?.studentText || '');
    if (needsFormat && score > 0) {
      feedbackText += '\n📌 ملحوظة لتفوقك: برجاء الحرص دائماً على تنسيق الفقرات وترقيم العناصر (1، 2، ...) لتسهيل قراءتها وضمان كامل الدرجة في الامتحانات الرسمية.';
    }

    handleFeedbackChange(idx, feedbackText);
  };

  const handleScoreChange = (idx: number, score: number) => {
    setQuestions(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], teacherScore: Math.max(0, Math.round(score * 4) / 4) };
      return next;
    });
  };

  const handleFeedbackChange = (idx: number, fb: string) => {
    setQuestions(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], teacherFeedback: fb };
      return next;
    });
  };

  const [reviewFilter, setReviewFilter] = useState<'essay' | 'all' | 'mcq'>('essay');

  const hasMixedQuestions = useMemo(() => {
    return questions.some(q => 
      (q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ') &&
      q.qIndex !== -1 &&
      !q.questionText.includes('الأسئلة الموضوعية') &&
      !q.questionText.includes('الاختياري والصح/خطأ')
    );
  }, [questions]);

  const essayQuestions = useMemo(() => {
    return questions.filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
  }, [questions]);

  const essayEarnedScore = useMemo(() => {
    return essayQuestions.reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
  }, [essayQuestions]);

  const essayMaxScore = useMemo(() => {
    return essayQuestions.reduce((sum, q) => sum + (Number(q.maxScore) || 0), 0);
  }, [essayQuestions]);

  const totalEarnedScore = useMemo(() => {
    return questions.reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
  }, [questions]);

  const totalMaxScore = useMemo(() => {
    return questions.reduce((sum, q) => sum + (Number(q.maxScore) || 0), 0);
  }, [questions]);

  const hasObjectiveScore = useMemo(() => {
    return (totalMaxScore - essayMaxScore) > 0;
  }, [totalMaxScore, essayMaxScore]);

  const perc = Math.round((totalEarnedScore / Math.max(1, totalMaxScore)) * 100);

  const [mistakesReleaseDialog, setMistakesReleaseDialog] = useState<'publish' | 'next' | null>(null);

  const [rememberMistakesPreference, setRememberMistakesPreference] = useState<boolean>(() => {
    return sessionStorage.getItem('kanz_remember_mistakes_pref') === 'true';
  });

  const handleApproveAndPublish = () => {
    const savedPref = sessionStorage.getItem('kanz_auto_mistakes_release');
    if (savedPref !== null) {
      executeApprovalWithMistakesOption(savedPref === 'true', 'publish');
      return;
    }
    setMistakesReleaseDialog('publish');
  };

  const handleApproveAndNext = () => {
    const savedPref = sessionStorage.getItem('kanz_auto_mistakes_release');
    if (savedPref !== null) {
      executeApprovalWithMistakesOption(savedPref === 'true', 'next');
      return;
    }
    setMistakesReleaseDialog('next');
  };

  const executeApprovalWithMistakesOption = (releaseMistakes: boolean, explicitMode?: 'publish' | 'next') => {
    if (rememberMistakesPreference) {
      sessionStorage.setItem('kanz_remember_mistakes_pref', 'true');
      sessionStorage.setItem('kanz_auto_mistakes_release', String(releaseMistakes));
    }
    const updated: StudentEssaySubmission = {
      ...submission,
      questions: questions.map(q => ({ ...q, isApproved: true })),
      isFullyApproved: true,
      isTeacherReviewed: true,
      isMistakesBankReleased: releaseMistakes,
      finalScore: totalEarnedScore,
    };
    const targetMode = explicitMode || mistakesReleaseDialog || 'next';
    setMistakesReleaseDialog(null);

    if (targetMode === 'next' && onSaveApprovedAndNext) {
      onSaveApprovedAndNext(updated);
    } else {
      onSaveApproved(updated);
    }
  };

  const handleSaveAsDraft = () => {
    const updated: StudentEssaySubmission = {
      ...submission,
      questions: questions.map(q => ({ ...q, isApproved: false })),
      isFullyApproved: false,
      isTeacherReviewed: true,
      finalScore: totalEarnedScore,
    };
    if (onSaveDraft) {
      onSaveDraft(updated);
    } else {
      onSaveApproved(updated);
    }
  };

  const handleSaveDraftAndNext = () => {
    const updated: StudentEssaySubmission = {
      ...submission,
      questions: questions.map(q => ({ ...q, isApproved: false })),
      isFullyApproved: false,
      isTeacherReviewed: true,
      finalScore: totalEarnedScore,
    };
    if (onSaveDraftAndNext) {
      onSaveDraftAndNext(updated);
    } else if (onSaveDraft) {
      onSaveDraft(updated);
    } else {
      onSaveApproved(updated);
    }
  };

  // قفل التمرير في الصفحة الخلفية لضمان عدم حدوث أي تداخل أثناء التصحيح
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = origOverflow;
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={`fixed inset-0 z-[99999] flex flex-col w-screen h-screen ${
      isDarkMode ? 'bg-gray-950 text-gray-100' : 'bg-slate-100 text-gray-800'
    } overflow-hidden select-text`} dir="rtl">
      {/* 1. رأس الشاشة (شريط ملاحة علوي رشيق ومناسب للموبايل والشاشات الكبيرة) */}
      <header className={`px-2.5 sm:px-6 py-2 sm:py-3 border-b shadow-xs shrink-0 flex items-center justify-between gap-2 sm:gap-4 ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="h-8 sm:h-9 px-2 sm:px-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
            title="الرجوع إلى قائمة التسليمات"
          >
            <i className="fas fa-arrow-right text-xs"></i>
            <span className="hidden sm:inline">العودة</span>
          </button>

          <div className="h-5 w-[1px] bg-gray-300 dark:bg-gray-700 hidden sm:block"></div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-xs sm:text-base font-black text-primary truncate max-w-[130px] sm:max-w-xs">
                {submission.studentName}
              </h2>
              <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700" dir="ltr">
                {submission.studentPhone}
              </span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                submission.studentType === 'أونلاين'
                  ? 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300'
              }`}>
                {submission.studentType || 'سنتر'}
              </span>
              {(submission.isAutoTerminated || submission.terminationReason || submission.questions.some(q => q.teacherFeedback?.includes('سحب') || q.studentText?.includes('سحبت') || q.teacherFeedback?.includes('مخالفات'))) && (
                <span className="text-[9px] sm:text-[11px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800 flex items-center gap-1 shrink-0">
                  <i className="fas fa-shield-halved text-rose-600"></i> <span className="hidden sm:inline">سُحبت لمخالفات</span><span className="sm:hidden">سُحبت</span>
                </span>
              )}
            </div>
            <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 font-bold truncate max-w-[190px] sm:max-w-md mt-0.5">
              📖 {submission.quizTitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-xs font-bold text-indigo-900 dark:text-indigo-300">
            <i className="fas fa-file-pen text-xs"></i>
            <span>
              {hasMixedQuestions ? (
                <>مقالي: <strong>{essayQuestions.length}</strong> • موضوعي: <strong>{questions.length - essayQuestions.length}</strong></>
              ) : (
                <>عدد الأسئلة المقالية: <strong>{essayQuestions.length}</strong></>
              )}
            </span>
          </div>

          {onRequestRetake && (
            <button
              type="button"
              onClick={() => onRequestRetake(submission)}
              className="h-8 sm:h-9 px-2 sm:px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center gap-1 transition-colors border border-amber-300 dark:border-amber-700 cursor-pointer shadow-xs active:scale-95"
              title="إتاحة إعادة المحاولة للطالب"
            >
              <i className="fas fa-redo-alt text-xs"></i>
              <span className="hidden sm:inline">إعادة المحاولة</span>
            </button>
          )}

          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/50 text-gray-500 flex items-center justify-center transition-colors cursor-pointer"
            title="إغلاق الشاشة والعودة"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>
      </header>

      {/* تنبيه إذا كانت الورقة مسحوبة تلقائياً لمخالفات أمنية */}
      {(submission.isAutoTerminated || submission.terminationReason || submission.questions.some(q => q.teacherFeedback?.includes('سحب') || q.studentText?.includes('سحبت') || q.teacherFeedback?.includes('مخالفات'))) && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800 px-3 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-2 text-[11px] sm:text-xs font-bold text-rose-900 dark:text-rose-200 shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <i className="fas fa-triangle-exclamation text-rose-600 text-xs shrink-0"></i>
            <span className="truncate">
              <strong>تنبيه:</strong> سُحبت الورقة لمخالفات أمنية وتم رصد (0) للأسئلة المتبقية.
            </span>
          </div>
          {onRequestRetake && (
            <button
              type="button"
              onClick={() => onRequestRetake(submission)}
              className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] shrink-0 flex items-center gap-1 cursor-pointer active:scale-95"
            >
              منح إعادة
            </button>
          )}
        </div>
      )}

      {/* 2. شريط حالة الاعتماد والتعديل (مختصر ونحيف) */}
      <div className={`px-3 sm:px-6 py-1.5 border-b flex items-center justify-between gap-2 text-[11px] sm:text-xs font-bold shrink-0 ${
        submission.isFullyApproved
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800'
      }`}>
        <div className="flex items-center gap-1.5 truncate">
          <i className={`fas ${submission.isFullyApproved ? 'fa-check-circle text-emerald-600' : 'fa-hourglass-half text-amber-600'} text-xs shrink-0`}></i>
          <span className="truncate">
            {submission.isFullyApproved
              ? 'النتيجة معتمدة (يمكنك تعديل الدرجات وحفظها).'
              : 'بانتظار الاعتماد (يمكنك تعديل الدرجات والملاحظات بالأسفل).'}
          </span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
          submission.isFullyApproved ? 'bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100' : 'bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-100'
        }`}>
          {submission.isFullyApproved ? 'معتمد ✅' : 'قيد المراجعة ⏳'}
        </span>
      </div>

      {/* 3. مساحة العمل ومحتوى الأسئلة والإجابات (شاشة كاملة برحابة) */}
      <main className="flex-1 overflow-y-auto p-2.5 sm:p-5 md:p-6 space-y-3 sm:space-y-4">
        <div className="max-w-4xl mx-auto space-y-3 sm:space-y-4 pb-8 sm:pb-16">
          {hasMixedQuestions && (
            <div className="flex items-center gap-1 sm:gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <button
                type="button"
                onClick={() => setReviewFilter('essay')}
                className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  reviewFilter === 'essay'
                    ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <span>✍️ مقالي</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold">{essayQuestions.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewFilter('mcq')}
                className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  reviewFilter === 'mcq'
                    ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <span>🔘 موضوعي</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 font-bold">{questions.length - essayQuestions.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewFilter('all')}
                className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  reviewFilter === 'all'
                    ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <span>📋 الكل</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 font-bold">{questions.length}</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 pb-1">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
              💡 تحليل ومقارنة إجابات الطالب بنموذج الإجابة:
            </span>
            <button
              type="button"
              onClick={handleReCompareAllWithAi}
              disabled={isGlobalAiLoading}
              className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-600 hover:from-indigo-700 hover:to-amber-700 text-white rounded-xl text-xs font-black shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="إعادة فحص كافة الأسئلة المقالية بنماذج الذكاء الاصطناعي (Gemini / Groq)"
            >
              <i className={`fas ${isGlobalAiLoading ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles text-amber-300'}`}></i>
              <span>{isGlobalAiLoading ? 'جاري الفحص بالذكاء الاصطناعي...' : 'فحص كافة المقالي بالـ AI ⚡ (Gemini & Groq)'}</span>
            </button>
          </div>

          {/* كارت ملخص نتيجة الأسئلة الموضوعية (المصححة آلياً) */}
          {(() => {
            const mcqQ = questions.find(q => q.qIndex === -1 || q.questionText.includes('الأسئلة الموضوعية') || q.questionText.includes('الاختياري والصح/خطأ'));
            if (!mcqQ) return null;
            const mcqEarnedVal = mcqQ.teacherScore !== undefined ? mcqQ.teacherScore : (mcqQ.aiScore || 0);
            return (
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-100/60 dark:from-emerald-950/40 dark:via-gray-900 dark:to-emerald-950/30 border-2 border-emerald-300 dark:border-emerald-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-lg shadow-xs shrink-0">
                    <i className="fas fa-check-double"></i>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-black text-emerald-950 dark:text-emerald-100 text-sm sm:text-base">
                        نتيجة الأسئلة الموضوعية (اختر من متعدد + صح وخطأ)
                      </h4>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border border-emerald-300">
                        تصحيح آلي فوري ✅
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 dark:text-emerald-300 font-bold mt-0.5">
                      حصل الطالب على {mcqEarnedVal} من أصل {mcqQ.maxScore} درجة
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto bg-white dark:bg-gray-800 px-3.5 py-2 rounded-xl border border-emerald-300 dark:border-emerald-700 shadow-2xs">
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400">درجة الموضوعي:</span>
                  <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                    {mcqEarnedVal} / {mcqQ.maxScore}
                  </span>
                </div>
              </div>
            );
          })()}

          {questions.map((q, idx) => {
            const isMcqSummary = q.questionText.includes('الأسئلة الموضوعية') || q.questionText.includes('الاختياري والصح/خطأ');
            if (isMcqSummary) return null;
            const isMcq = q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ';
            if (reviewFilter === 'essay' && isMcq) return null;
            if (reviewFilter === 'mcq' && !isMcq) return null;
            const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
            const studentWordCount = q.studentText && !hasNoText ? q.studentText.trim().split(/\s+/).length : 0;
            const isDiffReady = !!diffComparisons[idx];
            const isDiffBusy = !!diffLoading[idx];
            const isDiffExpanded = !!diffOpen[idx];

            return (
              <div key={idx} className={`p-3 sm:p-5 rounded-2xl border-2 space-y-3 transition-all shadow-xs ${
                isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200 text-gray-800'
              }`}>
                {/* رأس السؤال */}
                <div className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-black text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700">
                      🏷️ {q.essayType}
                    </span>
                    <span className="font-black text-gray-800 dark:text-gray-200 text-xs sm:text-sm">سؤال #{idx + 1}</span>
                  </div>
                  <span className="text-[11px] font-black text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                    العظمى: {q.maxScore} درجات
                  </span>
                </div>

                {/* رأس السؤال المطلوب */}
                <div className="bg-gradient-to-r from-indigo-50/70 via-blue-50/40 to-slate-50 dark:from-indigo-950/40 dark:via-blue-950/20 dark:to-gray-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-indigo-100 dark:border-indigo-900/60">
                    <span className="font-black text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5 text-xs">
                      <span className="w-4 h-4 rounded bg-indigo-600 text-white flex items-center justify-center text-[9px] shadow-xs">
                        <i className="fas fa-question"></i>
                      </span>
                      <span>نص السؤال المطلوب من الطالب:</span>
                    </span>
                    {q.essayType && (
                      <span className="text-[10px] font-black text-indigo-800 dark:text-indigo-300 bg-indigo-100/90 dark:bg-indigo-900/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                        🎯 {q.essayType}
                      </span>
                    )}
                  </div>
                  <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 leading-relaxed">
                    <FormatQuestionText text={q.questionText} isDarkMode={isDarkMode} />
                  </div>
                </div>

                {/* ما كتبه الطالب نصاً (واضح ومميز للقراءة براحة على الموبايل) */}
                <div className="bg-amber-50/60 dark:bg-amber-950/20 border-2 border-amber-300 dark:border-amber-700/80 rounded-xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-2 border-b border-amber-200 dark:border-amber-800/60 pb-1.5">
                    <span className="font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5 text-xs sm:text-sm">
                      <i className="fas fa-pen-fancy text-amber-600 text-xs"></i>
                      <span>ما كتبه الطالب نصاً:</span>
                    </span>
                    {!hasNoText && (
                      <span className="text-[10px] sm:text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded">
                        {studentWordCount} كلمة • {q.studentText.length} حرف
                      </span>
                    )}
                  </div>
                  <div className="font-black text-gray-950 dark:text-gray-100 whitespace-pre-line leading-relaxed text-sm sm:text-base select-text">
                    {!hasNoText ? (
                      q.studentText
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400 font-bold bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800 inline-block text-xs">
                        ⚠️ لم يكتب الطالب إجابة لهذا السؤال (ترك السؤال فارغاً)
                      </span>
                    )}
                  </div>
                </div>

                {/* نموذج الإجابة المعتمد */}
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 sm:p-3.5 text-xs sm:text-sm leading-relaxed">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <span className="font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5 text-xs">
                      <i className="fas fa-clipboard-check text-emerald-600 dark:text-emerald-400"></i> نموذج الإجابة المعتمد:
                    </span>

                    {editingModelAnswerIdx === idx ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const newAns = customModelAnswerDraft.trim();
                            setQuestions(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], modelAnswer: newAns };
                              return next;
                            });
                            setEditingModelAnswerIdx(null);
                            if (newAns) {
                              try {
                                const customRaw = localStorage.getItem('kanz_custom_model_answers') || '{}';
                                const customMap = JSON.parse(customRaw);
                                const cleanNormQ = normalizeTextForMatching(q.questionText);
                                customMap[cleanNormQ] = newAns;
                                localStorage.setItem('kanz_custom_model_answers', JSON.stringify(customMap));
                              } catch(e) {}
                              handleTriggerDiff(idx, { ...q, modelAnswer: newAns });
                            }
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                        >
                          حفظ النموذج 💾
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingModelAnswerIdx(null)}
                          className="px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingModelAnswerIdx(idx);
                          setCustomModelAnswerDraft(q.modelAnswer && !q.modelAnswer.includes('لا يوجد') ? q.modelAnswer : '');
                        }}
                        className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 bg-white dark:bg-gray-800 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 transition-all cursor-pointer shadow-2xs flex items-center gap-1 active:scale-95"
                        title="تعديل أو كتابة نموذج الإجابة لهذا السؤال"
                      >
                        <i className="fas fa-pen-to-square text-[9px]"></i>
                        <span>{q.modelAnswer && !q.modelAnswer.includes('لا يوجد') ? 'تعديل ✏️' : 'كتابة نموذج ➕'}</span>
                      </button>
                    )}
                  </div>

                  {editingModelAnswerIdx === idx ? (
                    <div className="space-y-2 mt-1">
                      <textarea
                        rows={3}
                        value={customModelAnswerDraft}
                        onChange={e => setCustomModelAnswerDraft(e.target.value)}
                        placeholder="اكتب أو الصق نموذج الإجابة المعتمد لهذا السؤال هنا..."
                        className="w-full p-2.5 text-xs sm:text-sm font-bold border-2 border-emerald-400 dark:border-emerald-600 rounded-xl outline-none focus:ring-2 focus:ring-emerald-200 bg-white dark:bg-gray-800 text-emerald-950 dark:text-emerald-100 resize-none transition-all shadow-inner"
                      />
                      <p className="text-[10px] text-emerald-800 dark:text-emerald-300 font-bold">
                        💡 بمجرد حفظ النموذج، سيقوم النظام تلقائياً بإعادة المقارنة الذكية لاقتراح الدرجة العادلة بدقة.
                      </p>
                    </div>
                  ) : (
                    <div className="font-bold text-emerald-900 dark:text-emerald-300 whitespace-pre-line leading-relaxed text-xs sm:text-sm">
                      <HighlightText text={q.modelAnswer || 'لا يوجد نموذج إجابة مسجل لهذا السؤال'} isDarkMode={isDarkMode} />
                    </div>
                  )}
                </div>

                {/* شريط حالة المقارنة والدرجة المقترحة */}
                {hasNoText ? (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700/60 rounded-xl p-3.5 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 flex items-center justify-center text-sm font-black shrink-0">
                      ⚠️
                    </div>
                    <div className="space-y-0.5 text-xs sm:text-sm">
                      <h4 className="font-black text-amber-950 dark:text-amber-100">
                        تنبيه: الطالب ترك هذا السؤال فارغاً دون إجابة
                      </h4>
                      <p className="text-amber-800 dark:text-amber-300 font-bold leading-relaxed">
                        قام النظام تلقائياً برصد الدرجة (0) من {q.maxScore}، وكتابة ملاحظة توضيحية للطالب. لا حاجة للمقارنة الذكية لعدم وجود نص مكتوب.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className={`p-4 rounded-xl border-2 transition-all ${
                    diffComparisons[idx]
                      ? 'bg-gradient-to-l from-indigo-50/90 via-white to-blue-50/80 dark:from-indigo-950/40 dark:via-gray-900 dark:to-blue-950/40 border-indigo-300 dark:border-indigo-700 shadow-xs'
                      : isDiffBusy
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800 animate-pulse'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                  }`}>
                    {isDiffBusy ? (
                      <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold text-indigo-700 dark:text-indigo-300">
                        <i className="fas fa-spinner fa-spin text-base text-indigo-500"></i>
                        <span>جاري الفحص الدقيق والمقارنة الذكية بين إجابة الطالب ونموذج الإجابة لاقتراح الدرجة العادلة...</span>
                      </div>
                    ) : diffComparisons[idx] ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs shadow-xs">
                              <i className="fas fa-robot"></i>
                            </span>
                            <span className="text-xs sm:text-sm font-black text-indigo-950 dark:text-indigo-200">
                              نتيجة المقارنة الذكية:
                            </span>
                            <span className="text-xs sm:text-sm font-black px-2.5 py-1 rounded-lg bg-indigo-600 text-white shadow-xs">
                              الدرجة المقترحة: {diffComparisons[idx].suggestedScore} من {q.maxScore}
                            </span>
                            {diffComparisons[idx].provider && (
                              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border shadow-xs ${
                                diffComparisons[idx].provider === 'gemini'
                                  ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700'
                                  : diffComparisons[idx].provider === 'groq'
                                  ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                                  : 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-900 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700'
                              }`}>
                                {diffComparisons[idx].provider === 'gemini' 
                                  ? 'Google Gemini AI ⚡' 
                                  : diffComparisons[idx].provider === 'groq'
                                  ? 'Groq AI (Llama 3.3) 🚀'
                                  : 'المحلل الذكي المدمج 🧠'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleApplyDiffSuggestion(idx, diffComparisons[idx])}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg text-xs font-black shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                              title="تطبيق هذه الدرجة والملاحظة فوراً على السؤال"
                            >
                              <i className="fas fa-wand-magic-sparkles"></i>
                              تطبيق الدرجة والملاحظة ⚡
                            </button>
                            <button
                              type="button"
                              onClick={() => handleForceReCompare(idx, q)}
                              disabled={diffLoading[idx]}
                              className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                              title="إعادة فحص السؤال الآن عبر Gemini أو Groq AI"
                            >
                              <i className={`fas fa-rotate ${diffLoading[idx] ? 'fa-spin text-amber-600' : 'text-amber-600'}`}></i>
                              <span>{diffLoading[idx] ? 'جاري الفحص...' : 'فحص بالـ AI 🔄'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDiffOpen(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="px-3 py-1.5 bg-white dark:bg-gray-800 text-indigo-900 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-gray-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                            >
                              {isDiffExpanded ? 'طي التفاصيل 🔼' : 'عرض تحليل الفروق التفصيلي 🔽'}
                            </button>
                          </div>
                        </div>

                        {/* خلاصة التحليل */}
                        <p className="text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-300 leading-relaxed pr-9">
                          💡 <strong className="text-indigo-900 dark:text-indigo-300">خلاصة تقييم وتوجيه المعلم:</strong> {diffComparisons[idx].verdictSummary}
                        </p>

                        {/* تفاصيل الفروق إذا كانت مفتوحة */}
                        {isDiffExpanded && (
                          <div className="pt-2 border-t border-indigo-200 dark:border-indigo-800 space-y-3 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {/* نقاط القوة والتطابق */}
                              <div className="bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                                <span className="font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5 mb-2">
                                  <i className="fas fa-check-circle text-emerald-600 dark:text-emerald-400"></i> ما وُفّق فيه الطالب واستوفاه بنجاح:
                                </span>
                                {diffComparisons[idx].matchedPoints.length === 0 ? (
                                  <p className="text-gray-500 font-normal">لم يتم استيفاء عناصر واضحة من النموذج.</p>
                                ) : (
                                  <ul className="space-y-1.5 text-[11px] font-bold text-emerald-900 dark:text-emerald-300 pr-4 list-disc">
                                    {diffComparisons[idx].matchedPoints.map((pt, pIdx) => (
                                      <li key={pIdx} className="leading-relaxed">{pt}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              {/* العناصر الناقصة أو المفقودة */}
                              {diffComparisons[idx].suggestedScore >= (q?.maxScore || 2) * 0.85 ? (
                                <div className="bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                                  <span className="font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5 mb-2">
                                    <i className="fas fa-check-double text-emerald-600 dark:text-emerald-400"></i> اكتمال عناصر نموذج الإجابة:
                                  </span>
                                  <ul className="space-y-1.5 text-[11px] font-bold text-emerald-900 dark:text-emerald-300 pr-4 list-disc">
                                    {diffComparisons[idx].missingPoints.map((pt, pIdx) => (
                                      <li key={pIdx} className="leading-relaxed">{pt}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                                  <span className="font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5 mb-2">
                                    <i className="fas fa-triangle-exclamation text-amber-600 dark:text-amber-400"></i> عناصر ناقصة وتوجيهات لاستكمال الإجابة:
                                  </span>
                                  {diffComparisons[idx].missingPoints.length === 0 ? (
                                    <p className="text-gray-500 font-normal">أورد الطالب جميع العناصر المطلوبة دون نقص.</p>
                                  ) : (
                                    <ul className="space-y-1.5 text-[11px] font-bold text-amber-900 dark:text-amber-300 pr-4 list-disc">
                                      {diffComparisons[idx].missingPoints.map((pt, pIdx) => (
                                        <li key={pIdx} className="leading-relaxed">{pt}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* تحليل الصياغة والأسلوب */}
                            {diffComparisons[idx].styleNote && (
                              <div className="bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl p-2.5 text-[11px] text-blue-950 dark:text-blue-200 font-bold flex items-center gap-2">
                                <i className="fas fa-pen-fancy text-blue-600 dark:text-blue-400 text-xs shrink-0"></i>
                                <span><strong>الصياغة والأسلوب:</strong> {diffComparisons[idx].styleNote}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
                          لم تبدأ المقارنة الذكية بعد.
                        </span>
                        <button
                          type="button"
                          onClick={() => handleTriggerDiff(idx, q)}
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                        >
                          🔍 بدء المقارنة الآن
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* شريط التحكم بالدرجة والملاحظة */}
                <div className="bg-white dark:bg-gray-800/90 border-2 border-gray-300 dark:border-gray-700 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <label className="font-black text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                        الدرجة المعتمدة للطالب:
                      </label>

                      {/* أزرار Stepper (-0.25 / +0.25) */}
                      <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl border border-gray-200 dark:border-gray-600">
                        <button
                          type="button"
                          onClick={() => handleScoreChange(idx, Math.max(0, (Number(q.teacherScore) || 0) - 0.25))}
                          className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 hover:bg-rose-50 hover:text-rose-600 text-gray-700 dark:text-gray-200 font-black text-sm border border-gray-200 dark:border-gray-600 shadow-xs flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                          title="إنقاص ربع درجة (-0.25)"
                        >
                          -¼
                        </button>

                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          value={q.teacherScore ?? q.aiScore ?? 0}
                          onChange={e => handleScoreChange(idx, parseFloat(e.target.value) || 0)}
                          className="w-16 h-8 text-center font-black text-sm border border-primary/40 rounded-lg bg-white dark:bg-gray-800 text-primary outline-none focus:ring-2 focus:ring-primary shadow-inner"
                        />

                        <button
                          type="button"
                          onClick={() => handleScoreChange(idx, (Number(q.teacherScore) || 0) + 0.25)}
                          className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 hover:bg-emerald-50 hover:text-emerald-600 text-gray-700 dark:text-gray-200 font-black text-sm border border-gray-200 dark:border-gray-600 shadow-xs flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                          title="إضافة ربع درجة (+0.25)"
                        >
                          +¼
                        </button>
                      </div>

                      <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                        من {q.maxScore} درجات
                      </span>

                      {Number(q.teacherScore) > q.maxScore && (
                        <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                          🌟 درجة إضافية (بونص +{(Number(q.teacherScore) - q.maxScore).toFixed(2)})
                        </span>
                      )}
                    </div>

                    {/* أزرار الدرجات السريعة */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-black text-gray-400 ml-1">تعيين سريع:</span>
                      {[0, 0.5, 1, 1.5, 2].filter(s => s <= q.maxScore).map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => handleScoreChange(idx, val)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all border cursor-pointer ${
                            q.teacherScore === val
                              ? 'bg-primary text-white border-primary shadow-xs scale-105'
                              : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handleScoreChange(idx, (Number(q.teacherScore) || 0) + 0.25)}
                        className="px-2 py-1 rounded-lg text-xs font-black transition-all border bg-indigo-50 dark:bg-indigo-950 hover:bg-indigo-100 text-indigo-800 dark:text-indigo-200 border-indigo-200 cursor-pointer"
                        title="إضافة ربع درجة (+0.25)"
                      >
                        +0.25
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScoreChange(idx, (Number(q.teacherScore) || 0) + 0.5)}
                        className="px-2 py-1 rounded-lg text-xs font-black transition-all border bg-emerald-50 dark:bg-emerald-950 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-200 border-emerald-300 cursor-pointer"
                        title="إضافة نصف درجة (+0.5)"
                      >
                        +0.5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScoreChange(idx, q.maxScore + 0.5)}
                        className="px-2 py-1 rounded-lg text-xs font-black transition-all border bg-amber-50 dark:bg-amber-950 hover:bg-amber-100 text-amber-800 dark:text-amber-200 border-amber-300 cursor-pointer"
                        title="إضافة نصف درجة بونص فوق الدرجة الكاملة"
                      >
                        بونص ⭐
                      </button>
                    </div>
                  </div>

                  {/* قسم ملاحظات المعلم وتوجيهه للطالب */}
                  <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs sm:text-sm font-black text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                        <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs">
                          <i className="fas fa-comment-dots"></i>
                        </span>
                        <span>ملاحظات وتوجيهات المعلم للطالب على هذا السؤال:</span>
                      </label>
                      <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                        💬 ستظهر هذه الملاحظة للطالب في تقرير نتيجته
                      </span>
                    </div>

                    <textarea
                      rows={2}
                      placeholder="اكتب ملاحظتك وتوجيهك المباشر للطالب هنا، أو اضغط على أي من القوالب الجاهزة بالأسفل لإدراجها فوراً..."
                      value={q.teacherFeedback || ''}
                      onChange={e => handleFeedbackChange(idx, e.target.value)}
                      className="w-full p-3 text-xs sm:text-sm font-bold border-2 border-gray-300 dark:border-gray-600 rounded-xl outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 resize-none transition-all shadow-inner"
                    />

                    {/* قوالب توجيه سريعة */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] font-black text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <i className="fas fa-bolt text-amber-500"></i> قوالب وتوجيهات سريعة:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const current = q.teacherFeedback || '';
                          const note = 'برجاء الحرص على تنسيق الفقرات وترقيم العناصر (1، 2، ...) لضمان الدرجة النهائية 📝';
                          if (!current.includes('ترقيم العناصر')) {
                            handleFeedbackChange(idx, (current ? current.trim() + '\n' : '') + note);
                          }
                        }}
                        className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 transition-all cursor-pointer active:scale-95 shadow-xs flex items-center gap-1"
                        title="إدراج توجيه ترقيم وتنسيق الفقرات"
                      >
                        <i className="fas fa-list-ol text-purple-600"></i>
                        <span>+ برجاء تنسيق الفقرات وترقيمها 📝</span>
                      </button>
                      {diffComparisons[idx]?.studentFeedback && (
                        <button
                          type="button"
                          onClick={() => handleFeedbackChange(idx, diffComparisons[idx].studentFeedback)}
                          className="text-[11px] font-black px-3 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 transition-all cursor-pointer active:scale-95 shadow-xs flex items-center gap-1"
                          title="إدراج التوجيه الذكي المستخرج بدقة من مقال الطالب"
                        >
                          <i className="fas fa-wand-magic-sparkles text-indigo-500"></i>
                          <span>تقييم المعلم المخصص للمقال ✨</span>
                        </button>
                      )}
                      {[
                        "إجابة نموذجية ومكتملة العناصر، أحسنت يا بطل! 🌟",
                        "ممتاز ولكن ينقصك ذكر الشواهد والتواريخ بدقة 💡",
                        "إجابة ناقصة، راجع نموذج الوزارة المعتمد للفصل ⚠️",
                        "مجهود طيب مع ضرورة الصياغة بالفصحى التاريخية 👍",
                        "لم يكتب الطالب إجابة لهذا السؤال.",
                        "تمت مراجعة الإجابة وتعديل الدرجة مستحقاً 🎯"
                      ].map((template, tIdx) => (
                        <button
                          key={tIdx}
                          type="button"
                          onClick={() => handleFeedbackChange(idx, template)}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-gray-700 dark:text-gray-300 hover:text-indigo-900 dark:hover:text-indigo-200 transition-all border border-gray-200 dark:border-gray-700 cursor-pointer active:scale-95 shadow-2xs"
                        >
                          {template}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      </main>

      {/* 4. شريط الأزرار والاعتماد الثابت أسفل الشاشة (متجاوب ومريح للموبايل) */}
      <footer className={`px-3 sm:px-6 py-2 sm:py-3 border-t shadow-lg shrink-0 ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        {/* تصميم الموبايل (< sm): منظم في صفين نحيفين بدون أي تراكم أزرار */}
        <div className="sm:hidden space-y-2">
          {/* الصف الأول: النتيجة + واتساب + إلغاء */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 bg-primary/10 px-2.5 py-1 rounded-lg text-primary text-xs font-black">
              <span>{hasObjectiveScore ? 'الإجمالي:' : 'المقالي:'}</span>
              <strong className="text-xs font-black">{totalEarnedScore} / {totalMaxScore} ({perc}%)</strong>
            </div>

            <div className="flex items-center gap-1.5">
              {submission.studentPhone && (
                <button
                  type="button"
                  onClick={() => {
                    const phone = String(submission.studentPhone || '').replace(/[^\d]/g, '');
                    const intlPhone = phone.startsWith('0') ? `+20${phone.slice(1)}` : `+20${phone}`;
                    const percVal = Math.round((totalEarnedScore / Math.max(1, totalMaxScore)) * 100);
                    const msg = encodeURIComponent(
                      `مرحباً بك يا بطل (${submission.studentName}) 🌟\n` +
                      `معك أستاذك إسلام سعود من منصة "موسوعة الكنز التعليمي".\n\n` +
                      `✅ تم مراجعة واعتماد اختبارك: *${submission.quizTitle}*\n` +
                      (hasObjectiveScore
                        ? `📊 درجتك النهائية المعتمدة: *${totalEarnedScore} من ${totalMaxScore}* (${percVal}%)\n(المقالي: ${essayEarnedScore} من ${essayMaxScore} • الموضوعي: ${totalEarnedScore - essayEarnedScore} من ${totalMaxScore - essayMaxScore})\n\n`
                        : `📊 درجتك المقالية المعتمدة: *${totalEarnedScore} من ${totalMaxScore}* (${percVal}%)\n\n`) +
                      `تمنياتي لك بالتوفيق والنجاح دائماً! ❤️`
                    );
                    window.open(`https://wa.me/${intlPhone}?text=${msg}`, '_blank');
                  }}
                  className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center text-sm shadow-xs active:scale-95 transition-all"
                  title="مراسلة واتساب"
                >
                  <i className="fab fa-whatsapp"></i>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
              >
                إلغاء
              </button>
            </div>
          </div>

          {/* الصف الثاني: الأزرار الأساسية (متجاورة بشكل متناسق ومريح) */}
          <div className="flex items-center gap-1.5">
            {!submission.isFullyApproved && (
              <>
                {/* 1. زر الاعتماد المباشر ونشر النتيجة (الأخضر البارز) */}
                {hasNextPending ? (
                  <button
                    type="button"
                    onClick={handleApproveAndNext}
                    className="flex-[1.3] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                    title="اعتماد النتيجة ونشرها للطالب والانتقال للتالي فوراً"
                  >
                    <i className="fas fa-check-double text-xs"></i>
                    <span>اعتماد والتالي 🚀</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApproveAndPublish}
                    className="flex-[1.3] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                    title="اعتماد النتيجة ونشرها للطالب وإنهاء التصحيح"
                  >
                    <i className="fas fa-stamp text-xs"></i>
                    <span>اعتماد ونشر 🎯</span>
                  </button>
                )}

                {/* 2. زر حفظ المسودة والتالي */}
                {hasNextPending ? (
                  <button
                    type="button"
                    onClick={handleSaveDraftAndNext}
                    className="flex-1 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                    title="حفظ الدرجات كمسودة دون إعلانها للطالب ومتابعة التالي"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>مسودة والتالي 💾</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveAsDraft}
                    className="flex-1 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                    title="حفظ الدرجات كمسودة دون إعلانها للطالب"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ كمسودة 💾</span>
                  </button>
                )}

                {/* 3. زر الانتقال للاعتماد */}
                <button
                  type="button"
                  onClick={() => {
                    handleSaveAsDraft();
                    if (onNavigateToApproval) {
                      onNavigateToApproval();
                    }
                  }}
                  className="px-2.5 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
                  title="الانتقال لشاشة الاعتماد الجماعي"
                >
                  <i className="fas fa-stamp text-xs"></i>
                  <span>الاعتماد</span>
                </button>
              </>
            )}

            {submission.isFullyApproved && (
              <>
                {hasNextPending ? (
                  <button
                    type="button"
                    onClick={handleApproveAndNext}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ التعديل والتالي ⬅️</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApproveAndPublish}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ التعديل</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* تصميم الشاشات الكبيرة (sm فما فوق): شريط أفقي واحد واسع */}
        <div className="hidden sm:flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {hasObjectiveScore ? (
              <>
                <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-xs sm:text-sm font-bold text-indigo-900 dark:text-indigo-300">
                  <span>المقالي:</span>
                  <strong className="text-sm font-black">{essayEarnedScore} من {essayMaxScore}</strong>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs sm:text-sm font-bold text-emerald-900 dark:text-emerald-300">
                  <span>الموضوعي:</span>
                  <strong className="text-sm font-black">{totalEarnedScore - essayEarnedScore} من {totalMaxScore - essayMaxScore}</strong>
                </div>
                <div className="flex items-center gap-1.5 bg-primary/10 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold text-primary">
                  <span>إجمالي درجات الاختبار:</span>
                  <strong className="text-base sm:text-lg font-black">{totalEarnedScore} من {totalMaxScore} ({perc}%)</strong>
                </div>
              </>
            ) : (
              <>
                <span className="text-xs sm:text-sm font-black text-gray-600 dark:text-gray-300">مجموع درجات المقالي المعتمدة:</span>
                <span className="text-base sm:text-lg font-black text-primary bg-primary/10 px-3.5 py-1 rounded-xl">
                  {totalEarnedScore} من {totalMaxScore} درجة ({perc}%)
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {submission.studentPhone && (
              <button
                type="button"
                onClick={() => {
                  const phone = String(submission.studentPhone || '').replace(/[^\d]/g, '');
                  const intlPhone = phone.startsWith('0') ? `+20${phone.slice(1)}` : `+20${phone}`;
                  const percVal = Math.round((totalEarnedScore / Math.max(1, totalMaxScore)) * 100);
                  const msg = encodeURIComponent(
                    `مرحباً بك يا بطل (${submission.studentName}) 🌟\n` +
                    `معك أستاذك إسلام سعود من منصة "موسوعة الكنز التعليمي".\n\n` +
                    `✅ تم مراجعة واعتماد اختبارك: *${submission.quizTitle}*\n` +
                    (hasObjectiveScore
                      ? `📊 درجتك النهائية المعتمدة: *${totalEarnedScore} من ${totalMaxScore}* (${percVal}%)\n(المقالي: ${essayEarnedScore} من ${essayMaxScore} • الموضوعي: ${totalEarnedScore - essayEarnedScore} من ${totalMaxScore - essayMaxScore})\n\n`
                      : `📊 درجتك المقالية المعتمدة: *${totalEarnedScore} من ${totalMaxScore}* (${percVal}%)\n\n`) +
                    `تمنياتي لك بالتوفيق والنجاح دائماً! ❤️`
                  );
                  window.open(`https://wa.me/${intlPhone}?text=${msg}`, '_blank');
                }}
                className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                title="إرسال رسالة التهنئة والنتيجة إلى واتساب الطالب"
              >
                <i className="fab fa-whatsapp text-sm"></i>
                <span>واتساب</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-700 dark:text-gray-200 font-bold text-xs cursor-pointer transition-colors"
            >
              إلغاء
            </button>

            {!submission.isFullyApproved && (
              <>
                {/* 1. زر الاعتماد المباشر ونشر النتيجة (الأخضر البارز) */}
                {hasNextPending ? (
                  <button
                    type="button"
                    onClick={handleApproveAndNext}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                    title="اعتماد النتيجة ونشرها للطالب والانتقال فوراً للطالب التالي"
                  >
                    <i className="fas fa-check-double text-xs"></i>
                    <span>اعتماد ونقل للتالي 🚀</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApproveAndPublish}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                    title="اعتماد النتيجة ونشرها للطالب وإنهاء التصحيح"
                  >
                    <i className="fas fa-stamp text-xs"></i>
                    <span>اعتماد النتيجة ونشرها 🎯</span>
                  </button>
                )}

                {/* 2. زر حفظ المسودة والتالي */}
                {hasNextPending ? (
                  <button
                    type="button"
                    onClick={handleSaveDraftAndNext}
                    className="px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                    title="حفظ الدرجات كمسودة دون إعلانها للطالب ومتابعة التالي"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ كمسودة والتالي 💾</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveAsDraft}
                    className="px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                    title="حفظ الدرجات كمسودة دون إعلانها للطالب"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ كمسودة 💾</span>
                  </button>
                )}

                {/* 3. زر الانتقال لشاشة الاعتماد */}
                <button
                  type="button"
                  onClick={() => {
                    handleSaveAsDraft();
                    if (onNavigateToApproval) {
                      onNavigateToApproval();
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  title="حفظ المسودة والانتقال لشاشة اعتماد النتائج الجماعية"
                >
                  <i className="fas fa-external-link-alt text-xs"></i>
                  <span>شاشة الاعتماد 🎯</span>
                </button>
              </>
            )}

            {submission.isFullyApproved && (
              <>
                {hasNextPending ? (
                  <button
                    type="button"
                    onClick={handleApproveAndNext}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ التعديل والتالي ⬅️</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApproveAndPublish}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fas fa-save text-xs"></i>
                    <span>حفظ التعديل 💾</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </footer>

      {/* نافذة تأكيد اعتماد النتيجة وتحديد إتاحة بنك الأخطاء للطالب */}
      {mistakesReleaseDialog && (
        <div className="fixed inset-0 z-[100000] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border-t-8 border-primary text-right animate-fade-in space-y-4">
            <div className="flex items-center gap-3 border-b pb-3 dark:border-gray-700">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl shrink-0">
                🎯
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-black text-gray-900 dark:text-gray-100">
                  تأكيد اعتماد النتيجة وبنك الأخطاء
                </h3>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  {submission.studentName} • {submission.quizTitle}
                </p>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200 leading-relaxed">
              <i className="fas fa-circle-info text-amber-600 ml-1.5"></i>
              <span>
                أنت الآن بصدد اعتماد نتيجة الامتحان. يرجى تحديد ما إذا كنت ترغب في <strong>إتاحة أسئلة هذا الاختبار في بنك الأخطاء</strong> للطالب للتدرب عليها:
              </span>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-700 dark:text-gray-300 py-1.5 bg-gray-50 dark:bg-gray-700/50 px-3 rounded-xl border border-gray-200 dark:border-gray-600 select-none">
              <input
                type="checkbox"
                checked={rememberMistakesPreference}
                onChange={e => setRememberMistakesPreference(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
              />
              <span>تذكر هذا الاختيار لباقي طلاب الجلسة للانتقال الفوري السريع ⚡</span>
            </label>

            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={() => executeApprovalWithMistakesOption(true)}
                className="w-full p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm flex items-center justify-between shadow-md active:scale-[0.99] transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-lg">✅</span>
                  <div className="text-right">
                    <div>اعتماد النتيجة + إتاحة بنك الأخطاء 🎯</div>
                    <div className="text-[11px] font-normal text-emerald-100">تظهر أخطاء هذا الامتحان للطالب في بنك الأخطاء للتدرب فوراً</div>
                  </div>
                </div>
                <i className="fas fa-chevron-left text-xs opacity-70 group-hover:translate-x-[-3px] transition-transform"></i>
              </button>

              <button
                type="button"
                onClick={() => executeApprovalWithMistakesOption(false)}
                className="w-full p-4 rounded-2xl bg-slate-700 hover:bg-slate-800 text-white font-black text-sm flex items-center justify-between shadow-md active:scale-[0.99] transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-lg">🔒</span>
                  <div className="text-right">
                    <div>اعتماد النتيجة فقط (حجب بنك الأخطاء) 🔒</div>
                    <div className="text-[11px] font-normal text-slate-300">تُعتمد الدرجة وتصل للطالب، ولكن تُحجب الأخطاء من بنك الأخطاء</div>
                  </div>
                </div>
                <i className="fas fa-chevron-left text-xs opacity-70 group-hover:translate-x-[-3px] transition-transform"></i>
              </button>

              <button
                type="button"
                onClick={() => setMistakesReleaseDialog(null)}
                className="w-full py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                إلغاء التراجع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
