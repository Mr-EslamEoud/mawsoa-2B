import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StudentEssaySubmission, EssayReviewQuestionItem, Unit, StudentRetakeDirective } from '../types';
import defaultQuestionsData from '../defaultQuestions.json';
import { 
  getPendingEssaySubmissions, 
  savePendingEssaySubmission, 
  getExamConfig, 
  calculateExamStructure,
  detectEssayType,
  saveRetakeDirective
} from '../examConfigUtils';
import { HighlightText } from './HighlightText';
import { FormatQuestionText } from './FormatQuestionText';
import { compareStudentWithModelAnswer, EssayDiffComparison } from '../aiEvaluationService';
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
  const [mainView, setMainView] = useState<'pending' | 'archive' | 'students'>(initialSelectedQuiz ? 'students' : 'pending');
  const [previousQuizView, setPreviousQuizView] = useState<'pending' | 'archive'>('pending');
  const [quizSearchTerm, setQuizSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved'>('pending');
  const [studentTypeFilter, setStudentTypeFilter] = useState<'all' | 'center' | 'online'>('all');
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>('all');
  const [selectedQuizFilter, setSelectedQuizFilter] = useState<string>(initialSelectedQuiz || 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [batchApproveDialog, setBatchApproveDialog] = useState<{ grp: { quizTitle: string; pendingCount: number; submissions: StudentEssaySubmission[] } } | null>(null);
  const [retakeModalSub, setRetakeModalSub] = useState<StudentEssaySubmission | null>(null);

  // إذا لم تكن هناك امتحانات معلقة ولكن توجد امتحانات معتمدة في الأرشيف، ننتقل تلقائياً للأرشيف في البداية
  const [hasAutoSwitchedToArchive, setHasAutoSwitchedToArchive] = useState(false);
  useEffect(() => {
    if (!initialSelectedQuiz && !hasAutoSwitchedToArchive && submissions.length > 0) {
      const pendingCount = submissions.filter(s => !s.isFullyApproved).length;
      if (pendingCount === 0) {
        setMainView('archive');
        setHasAutoSwitchedToArchive(true);
      }
    }
  }, [submissions, initialSelectedQuiz, hasAutoSwitchedToArchive]);

  useEffect(() => {
    if (initialSelectedQuiz) {
      setSelectedQuizFilter(initialSelectedQuiz);
      setMainView('students');
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

  const syncGradeToCloud = async (sub: StudentEssaySubmission, teacherScore?: number, teacherFeedback?: string) => {
    try {
      const cleanPhone = formatPhoneStr(sub.studentPhone);
      const fullPhone = cleanPhone.startsWith('0') ? '+20' + cleanPhone.substring(1) : cleanPhone;
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateEssayGrade',
          studentPhone: fullPhone,
          quizTitle: sub.quizTitle,
          teacherScore: teacherScore !== undefined ? teacherScore : sub.finalScore,
          teacherFeedback: teacherFeedback || 'تم اعتماد الإجابة بنجاح',
          isApproved: true,
          apiKey: SECRET_API_KEY
        })
      });
    } catch (e) {
      console.error("Cloud essay grade update error:", e);
    }
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
          const key = `${cleanPhone}___${row.quizTitle.trim()}`;
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
          const scoreNum = row.teacherScore !== "" && row.teacherScore !== undefined ? Number(row.teacherScore) : undefined;
          const isAppr = String(row.status || '').trim() === 'معتمد';
          const cleanQText = (row.questionText || `سؤال مقالي ${grp.questions.length + 1}`).trim();

          // تجنب تكرار السؤال المقالي للطالب إذا تم إرسال الإجابة أكثر من مرة أو عند التدريب
          const existingQ = grp.questions.find(q => q.questionText.trim() === cleanQText);
          if (existingQ) {
            if (scoreNum !== undefined && existingQ.teacherScore === undefined) {
              existingQ.teacherScore = scoreNum;
            }
            if (row.teacherFeedback && !existingQ.teacherFeedback) {
              existingQ.teacherFeedback = row.teacherFeedback;
            }
            if (!existingQ.isApproved && isAppr) {
              existingQ.isApproved = true;
            }
            return;
          }

          grp.questions.push({
            qIndex: grp.questions.length,
            questionText: cleanQText,
            essayType: detectEssayType(cleanQText).label,
            modelAnswer: '',
            studentText: row.studentAnswerText || '',
            maxScore: 2,
            teacherScore: scoreNum,
            teacherFeedback: row.teacherFeedback || '',
            isApproved: isAppr
          });
        });

        const cloudSubmissions: StudentEssaySubmission[] = [];
        groupedMap.forEach((grp, key) => {
          const isAllApproved = grp.questions.length > 0 && grp.questions.every(q => q.isApproved);
          const earned = grp.questions.reduce((sum, q) => sum + (q.teacherScore || 0), 0);
          
          let lessonId = grp.quizTitle;
          grp.questions.forEach((q, qi) => {
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

          cloudSubmissions.push({
            id: `cloud_${key}`,
            studentName: grp.studentName,
            studentPhone: grp.studentPhone,
            quizTitle: grp.quizTitle,
            lessonId: lessonId,
            submissionDate: grp.date,
            questions: grp.questions,
            isFullyApproved: isAllApproved,
            finalScore: earned,
            maxPossibleScore: grp.questions.reduce((sum, q) => sum + (q.maxScore || 2), 0),
            studentType: grp.studentType
          });
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
          const mKey = `${formatPhoneStr(cs.studentPhone)}___${cs.quizTitle.trim()}`;
          mergedMap.set(mKey, cs);
        });
        localList.forEach(ls => {
          const mKey = `${formatPhoneStr(ls.studentPhone)}___${ls.quizTitle.trim()}`;
          if (!mergedMap.has(mKey)) {
            // لا نحتفظ من الكاش المحلي إلا بالتسليمات المحلية غير المتزامنة (أوفلاين)
            // إذا كان التسليم أصلاً سحابياً وتم حذفه من الشيت، لا نعيد إحياءه بل نحذفه
            if (!ls.id?.startsWith('cloud_') && !ls.isFullyApproved) {
              mergedMap.set(mKey, ls);
            }
          } else {
            const cloudItem = mergedMap.get(mKey)!;
            if (ls.isFullyApproved && !cloudItem.isFullyApproved) {
              mergedMap.set(mKey, ls);
            }
          }
        });

        const finalList = Array.from(mergedMap.values());
        localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(finalList));
        setSubmissions(finalList);
        if (isManual) {
          showToast('✅ تم جلب وتحديث كافة تسليمات المقالي من السحابة بنجاح!');
        }
      } else {
        refreshSubmissions();
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

  // استخراج قائمة الوحدات المتاحة
  const availableUnits = useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    if (data && data.length > 0) {
      data.forEach(u => {
        map.set(u.title, { id: u.id, title: u.title, count: 0 });
      });
    }
    submissions.forEach(sub => {
      let uTitle = 'عام';
      if (data && data.length > 0) {
        const found = data.find(u => u.lessons.some(l => l.id === sub.lessonId || l.title === sub.quizTitle));
        if (found) uTitle = found.title;
      }
      if (!map.has(uTitle)) {
        map.set(uTitle, { id: uTitle, title: uTitle, count: 0 });
      }
      map.get(uTitle)!.count++;
    });
    return Array.from(map.values());
  }, [data, submissions]);

  // استخراج قائمة الامتحانات المتاحة بناءً على الوحدة المحددة
  const availableQuizzes = useMemo(() => {
    const map = new Map<string, { title: string; count: number; pendingCount: number }>();

    let allowedLessonTitles: string[] | null = null;
    if (selectedUnitFilter !== 'all' && data && data.length > 0) {
      const matchedUnit = data.find(u => u.title === selectedUnitFilter || u.id === selectedUnitFilter);
      if (matchedUnit) {
        allowedLessonTitles = matchedUnit.lessons.map(l => l.title);
      }
    }

    submissions.forEach(sub => {
      const qTitle = sub.quizTitle || 'اختبار';
      if (allowedLessonTitles && !allowedLessonTitles.includes(qTitle) && !qTitle.includes(selectedUnitFilter)) {
        return;
      }
      if (!map.has(qTitle)) {
        map.set(qTitle, { title: qTitle, count: 0, pendingCount: 0 });
      }
      const item = map.get(qTitle)!;
      item.count++;
      if (!sub.isFullyApproved) item.pendingCount++;
    });

    return Array.from(map.values());
  }, [data, submissions, selectedUnitFilter]);

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

  // تجميع التسليمات حسب الامتحان لإنشاء بطاقات الامتحانات
  const quizGroups = useMemo(() => {
    const map = new Map<string, {
      quizTitle: string;
      lessonId: string;
      unitTitle: string;
      submissions: StudentEssaySubmission[];
      totalCount: number;
      approvedCount: number;
      pendingCount: number;
      draftCount: number;
      onlineCount: number;
      centerCount: number;
      isFullyApproved: boolean;
    }>();

    submissions.forEach(sub => {
      const key = sub.quizTitle || sub.lessonId || 'اختبار';
      if (!map.has(key)) {
        map.set(key, {
          quizTitle: sub.quizTitle || key,
          lessonId: sub.lessonId,
          unitTitle: findUnitForQuiz(sub.lessonId, sub.quizTitle),
          submissions: [],
          totalCount: 0,
          approvedCount: 0,
          pendingCount: 0,
          draftCount: 0,
          onlineCount: 0,
          centerCount: 0,
          isFullyApproved: true,
        });
      }

      const grp = map.get(key)!;
      grp.submissions.push(sub);
      grp.totalCount++;

      if (sub.isFullyApproved) {
        grp.approvedCount++;
      } else {
        grp.pendingCount++;
        const hasDraft = sub.questions.some(q => q.teacherScore !== undefined);
        if (hasDraft) grp.draftCount++;
      }

      if (isSubOnline(sub)) {
        grp.onlineCount++;
      } else {
        grp.centerCount++;
      }
    });

    const list = Array.from(map.values());
    list.forEach(g => {
      g.isFullyApproved = g.totalCount > 0 && g.pendingCount === 0;
    });

    return list.sort((a, b) => {
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
      return b.pendingCount - a.pendingCount;
    });
  }, [submissions, data, onlineStudents]);

  // الامتحانات المعلقة التي تنتظر التصحيح والاعتماد
  const pendingQuizGroups = useMemo(() => {
    return quizGroups.filter(g => !g.isFullyApproved);
  }, [quizGroups]);

  // الامتحانات المكتملة والمؤرشفة بالكامل
  const archivedQuizGroups = useMemo(() => {
    return quizGroups.filter(g => g.isFullyApproved);
  }, [quizGroups]);

  // فلترة المعلق بالبحث
  const filteredPendingQuizGroups = useMemo(() => {
    return pendingQuizGroups.filter(grp => {
      if (quizSearchTerm.trim()) {
        const term = quizSearchTerm.trim().toLowerCase();
        const matchTitle = grp.quizTitle.toLowerCase().includes(term);
        const matchUnit = grp.unitTitle.toLowerCase().includes(term);
        if (!matchTitle && !matchUnit) return false;
      }
      return true;
    });
  }, [pendingQuizGroups, quizSearchTerm]);

  // فلترة الأرشيف بالبحث
  const filteredArchivedQuizGroups = useMemo(() => {
    return archivedQuizGroups.filter(grp => {
      if (quizSearchTerm.trim()) {
        const term = quizSearchTerm.trim().toLowerCase();
        const matchTitle = grp.quizTitle.toLowerCase().includes(term);
        const matchUnit = grp.unitTitle.toLowerCase().includes(term);
        if (!matchTitle && !matchUnit) return false;
      }
      return true;
    });
  }, [archivedQuizGroups, quizSearchTerm]);

  // إحصائيات سريعة
  const stats = useMemo(() => {
    const total = submissions.length;
    const pending = submissions.filter(s => !s.isFullyApproved).length;
    const approved = submissions.filter(s => s.isFullyApproved).length;
    return { total, pending, approved };
  }, [submissions]);

  // فلترة التسليمات
  const filteredSubmissions = useMemo(() => {
    return submissions.filter(sub => {
      const matchStatus = 
        statusFilter === 'all' ? true :
        statusFilter === 'pending' ? !sub.isFullyApproved :
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
  }, [submissions, statusFilter, studentTypeFilter, selectedUnitFilter, selectedQuizFilter, searchQuery, onlineStudents, data]);

  // البحث عن الطالب المعلق التالي في نفس الامتحان للانتقال السريع
  const nextPendingSub = useMemo(() => {
    if (!selectedSubForReview) return null;
    const sameQuizPending = submissions.filter(s => 
      (s.quizTitle === selectedSubForReview.quizTitle || s.lessonId === selectedSubForReview.lessonId) &&
      !s.isFullyApproved &&
      s.id !== selectedSubForReview.id
    );
    if (sameQuizPending.length > 0) return sameQuizPending[0];

    const anyPending = filteredSubmissions.filter(s => !s.isFullyApproved && s.id !== selectedSubForReview.id);
    return anyPending.length > 0 ? anyPending[0] : null;
  }, [selectedSubForReview, submissions, filteredSubmissions]);

  // اعتماد سريع لتسليم طالب باقتراح الذكاء الاصطناعي
  const handleQuickApprove = (sub: StudentEssaySubmission) => {
    let earnedEssay = 0;
    const updatedQuestions = sub.questions.map(q => {
      const approvedScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : q.maxScore);
      earnedEssay += approvedScore;
      return {
        ...q,
        teacherScore: approvedScore,
        teacherFeedback: q.teacherFeedback || q.aiFeedback || 'تم اعتماد الإجابة بنجاح.',
        isApproved: true,
      };
    });

    const updatedSub: StudentEssaySubmission = {
      ...sub,
      questions: updatedQuestions,
      isFullyApproved: true,
      finalScore: earnedEssay,
    };

    savePendingEssaySubmission(updatedSub);
    syncGradeToCloud(updatedSub);
    refreshSubmissions();

    if (onSaveResultToDB && sub.quizTitle) {
      const maxPossible = sub.maxPossibleScore || 50;
      const perc = Math.round((earnedEssay / maxPossible) * 100);
      onSaveResultToDB({
        quizName: sub.quizTitle,
        score: `${perc}%`,
        studentName: sub.studentName,
        studentPhone: sub.studentPhone,
      });
    }

    showToast(`✅ تم اعتماد درجات الطالب: ${sub.studentName}`);
  };

  // اعتماد جماعي لجميع التسليمات المعلقة بنقرة واحدة (Bulk Approve)
  const handleBulkApproveAll = () => {
    const pendingList = submissions.filter(s => !s.isFullyApproved);
    if (pendingList.length === 0) return;

    if (!window.confirm(`هل أنت متأكد من اعتماد جميع الإجابات المعلقة (عددها ${pendingList.length}) باقتراحات الذكاء الاصطناعي فوراً؟`)) {
      return;
    }

    pendingList.forEach(sub => {
      handleQuickApprove(sub);
    });

    showToast(`🎉 تم اعتماد جميع التسليمات المعلقة بنجاح!`);
  };

  // اعتماد وإعلان نتائج امتحان بالكامل دفعة واحدة بنقرة واحدة مع تأكيد إتاحة بنك الأخطاء
  const handleApproveQuizBatch = (grp: { quizTitle: string; pendingCount: number; submissions: StudentEssaySubmission[] }) => {
    const pendingList = grp.submissions.filter(s => !s.isFullyApproved);
    if (pendingList.length === 0) {
      showToast('جميع درجات هذا الامتحان معتمدة بالفعل.');
      return;
    }
    setBatchApproveDialog({ grp });
  };

  const executeBatchApprove = (releaseMistakes: boolean) => {
    if (!batchApproveDialog) return;
    const { grp } = batchApproveDialog;
    const pendingList = grp.submissions.filter(s => !s.isFullyApproved);
    setBatchApproveDialog(null);

    pendingList.forEach(sub => {
      let earnedEssay = 0;
      const updatedQuestions = sub.questions.map(q => {
        const approvedScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : q.maxScore);
        earnedEssay += approvedScore;
        return {
          ...q,
          teacherScore: approvedScore,
          teacherFeedback: q.teacherFeedback || q.aiFeedback || 'تم اعتماد الإجابة بنجاح.',
          isApproved: true,
        };
      });

      const updatedSub: StudentEssaySubmission = {
        ...sub,
        questions: updatedQuestions,
        isFullyApproved: true,
        isMistakesBankReleased: releaseMistakes,
        finalScore: earnedEssay,
      };

      savePendingEssaySubmission(updatedSub);
      syncGradeToCloud(updatedSub);

      if (onSaveResultToDB && sub.quizTitle) {
        const maxPossible = sub.maxPossibleScore || 50;
        const perc = Math.round((earnedEssay / Math.max(1, maxPossible)) * 100);
        onSaveResultToDB({
          quizName: sub.quizTitle,
          score: `${perc}%`,
          studentName: sub.studentName,
          studentPhone: sub.studentPhone,
        });
      }
    });

    refreshSubmissions();
    showToast(`🎉 تم اعتماد نتائج امتحان "${grp.quizTitle}" (${releaseMistakes ? 'مع إتاحة بنك الأخطاء للطلاب' : 'مع حجب بنك الأخطاء'}) بنجاح!`);
  };

  // حذف تسليم
  const handleDeleteSubmission = (id: string) => {
    if (!window.confirm('هل تريد حذف هذا التسليم نهائياً؟')) return;
    try {
      const current = getPendingEssaySubmissions().filter(s => s.id !== id);
      localStorage.setItem('kanz_pending_essay_submissions', JSON.stringify(current));
      refreshSubmissions();
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
      <div className="bg-gradient-to-l from-amber-50/90 via-white to-orange-50/60 p-4 sm:p-5 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-black text-primary flex items-center gap-2">
            <i className="fas fa-feather-alt text-amber-500"></i> تصحيح واعتماد الأسئلة المقالية
          </h2>
          <p className="text-xs text-gray-500 font-bold mt-1">
            استعرض إجابات الطلاب على الأسئلة المقالية، واعتمد اقتراحات الذكاء الاصطناعي بنقرة واحدة أو عدّلها بحرية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchCloudSubmissions(true)}
            disabled={isLoadingCloud}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
            title="تحديث وجلب كافة إجابات الطلاب المقالية من السحابة فوراً"
          >
            <i className={isLoadingCloud ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-down"}></i>
            <span>{isLoadingCloud ? "جاري التحديث..." : "تحديث من السحابة 🔄"}</span>
          </button>

          {onNavigateToApproval && (
            <button
              type="button"
              onClick={onNavigateToApproval}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <i className="fas fa-bullhorn text-yellow-300"></i>
              اعتماد وإعلان النتائج 📢
            </button>
          )}

          {stats.pending > 0 && (
            <button
              type="button"
              onClick={handleBulkApproveAll}
              className="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <i className="fas fa-bolt text-yellow-300"></i>
              اعتماد كل المعلق ({stats.pending})
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        
        {/* إشعار عائم للتأكيد */}
        {toastMessage && (
          <div className="p-3 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 animate-fade-in">
            <i className="fas fa-check-circle text-emerald-600"></i>
            {toastMessage}
          </div>
        )}

        {/* كروت الإحصائيات السريعة */}
        <div className="grid grid-cols-3 gap-3">
          <div 
            onClick={() => {
              setMainView('pending');
              setSelectedQuizFilter('all');
            }}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              mainView === 'pending' ? 'border-amber-400 bg-amber-50 shadow-sm' : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-amber-700 block mb-1">⏳ بانتظار الاعتماد</span>
            <span className="text-2xl font-black text-amber-900">{toEasternArabic(stats.pending)} طالب</span>
          </div>

          <div 
            onClick={() => {
              setMainView('archive');
              setSelectedQuizFilter('all');
            }}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              mainView === 'archive' ? 'border-emerald-400 bg-emerald-50 shadow-sm' : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-emerald-700 block mb-1">🗄️ أرشيف المقالي</span>
            <span className="text-2xl font-black text-emerald-900">{toEasternArabic(archivedQuizGroups.length)} امتحان</span>
          </div>

          <div 
            onClick={() => {
              setMainView('students');
              setStatusFilter('all');
            }}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              mainView === 'students' ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-primary block mb-1">📁 إجمالي تسليمات الطلاب</span>
            <span className="text-2xl font-black text-primary">{toEasternArabic(stats.total)} تسليم</span>
          </div>
        </div>

        {/* شريط التبديل بين الأقسام: بانتظار الاعتماد | أرشيف المقالي | تسليمات الطلاب */}
        <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-2xl border border-gray-200 overflow-x-auto">
          {/* تبويب بانتظار الاعتماد */}
          <button
            type="button"
            onClick={() => {
              setMainView('pending');
              setSelectedQuizFilter('all');
            }}
            className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              mainView === 'pending'
                ? 'bg-amber-500 text-white shadow-md'
                : 'text-gray-700 hover:bg-white/60'
            }`}
          >
            <i className="fas fa-clock"></i>
            <span>امتحانات بانتظار الاعتماد</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              mainView === 'pending' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900'
            }`}>
              {toEasternArabic(pendingQuizGroups.length)}
            </span>
          </button>

          {/* تبويب أرشيف المقالي المعتمد */}
          <button
            type="button"
            onClick={() => {
              setMainView('archive');
              setSelectedQuizFilter('all');
            }}
            className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              mainView === 'archive'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-gray-700 hover:bg-white/60'
            }`}
          >
            <i className="fas fa-archive"></i>
            <span>أرشيف المقالي المعتمد</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              mainView === 'archive' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-900'
            }`}>
              {toEasternArabic(archivedQuizGroups.length)}
            </span>
          </button>

          {/* تبويب قائمة جميع تسليمات الطلاب */}
          <button
            type="button"
            onClick={() => {
              setMainView('students');
              setStatusFilter('all');
            }}
            className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
              mainView === 'students'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-gray-700 hover:bg-white/60'
            }`}
          >
            <i className="fas fa-user-graduate"></i>
            <span>سجل تسليمات الطلاب</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              mainView === 'students' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
            }`}>
              {toEasternArabic(submissions.length)}
            </span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* العرض الأول: بطاقات الامتحانات المعلقة التي تنتظر الاعتماد */}
        {/* ========================================================= */}
        {mainView === 'pending' && (
          <div className="space-y-4">
            {/* شريط البحث إن كان هناك امتحانات معلقة */}
            {pendingQuizGroups.length > 0 && (
              <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-200">
                <div className="relative flex-1 w-full">
                  <i className="fas fa-search absolute right-3.5 top-3 text-gray-400 text-xs"></i>
                  <input
                    type="text"
                    placeholder="ابحث باسم الامتحان أو الوحدة..."
                    value={quizSearchTerm}
                    onChange={e => setQuizSearchTerm(e.target.value)}
                    className="w-full pr-9 pl-3 py-2 text-xs font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary outline-none bg-white"
                  />
                </div>
              </div>
            )}

            {/* الحالة: لا توجد امتحانات بانتظار الاعتماد */}
            {filteredPendingQuizGroups.length === 0 ? (
              <div className="text-center py-12 px-4 bg-emerald-50/50 rounded-3xl border-2 border-dashed border-emerald-200">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-3 shadow-xs">
                  <i className="fas fa-check-circle"></i>
                </div>
                <h3 className="text-lg font-black text-emerald-900 mb-1">
                  ممتاز يا أستاذ إسلام! لا توجد امتحانات بانتظار الاعتماد حالياً 🎉
                </h3>
                <p className="text-xs font-bold text-emerald-700/80 max-w-md mx-auto mb-4">
                  تم تصحيح واعتماد جميع إجابات الطلاب المقالية بنجاح، ونُقلت الامتحانات بالكامل إلى الأرشيف.
                </p>
                {archivedQuizGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMainView('archive')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-5 py-2.5 rounded-xl text-xs sm:text-sm shadow-sm transition-all active:scale-95 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <i className="fas fa-archive"></i>
                    <span>استعراض أرشيف المقالي المعتمد ({toEasternArabic(archivedQuizGroups.length)}) 🗄️</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredPendingQuizGroups.map(grp => {
                  const progressPerc = grp.totalCount > 0 ? Math.round((grp.approvedCount / grp.totalCount) * 100) : 0;

                  return (
                    <div
                      key={grp.quizTitle}
                      className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50/50 via-white to-orange-50/30 p-4 sm:p-5 flex flex-col justify-between gap-4 shadow-sm hover:shadow-md transition-all"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-md border border-gray-200">
                              📁 {grp.unitTitle}
                            </span>
                            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full border bg-amber-100 text-amber-900 border-amber-300 flex items-center gap-1">
                              <i className="fas fa-hourglass-half"></i>
                              <span>متبقي {toEasternArabic(grp.pendingCount)} تسليم معلق</span>
                            </span>
                          </div>

                          <span className="text-xs font-black text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
                            {toEasternArabic(grp.totalCount)} طالب
                          </span>
                        </div>

                        <h3 className="text-base sm:text-lg font-black text-gray-900 mb-2 leading-snug">
                          {grp.quizTitle}
                        </h3>

                        {/* شريط التقدم المرئي */}
                        <div className="space-y-1 mb-3">
                          <div className="flex justify-between text-[11px] font-bold text-gray-600">
                            <span>نسبة تصحيح واعتماد الإجابات</span>
                            <span className="font-mono font-black text-primary">{toEasternArabic(progressPerc)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-500 to-primary transition-all duration-500"
                              style={{ width: `${progressPerc}%` }}
                            />
                          </div>
                        </div>

                        {/* شارات تفصيلية */}
                        <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-bold">
                          <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <i className="fas fa-clock text-amber-600"></i> {toEasternArabic(grp.pendingCount)} معلق
                          </span>
                          {grp.draftCount > 0 && (
                            <span className="bg-purple-50 text-purple-900 border border-purple-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <i className="fas fa-bookmark text-purple-600"></i> {toEasternArabic(grp.draftCount)} مسودة
                            </span>
                          )}
                          {grp.approvedCount > 0 && (
                            <span className="bg-emerald-50 text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <i className="fas fa-check text-emerald-600"></i> {toEasternArabic(grp.approvedCount)} معتمد
                            </span>
                          )}
                          <span className="bg-blue-50 text-blue-900 border border-blue-200 px-2 py-0.5 rounded-md">
                            🏫 {toEasternArabic(grp.centerCount)} سنتر
                          </span>
                          <span className="bg-teal-50 text-teal-900 border border-teal-200 px-2 py-0.5 rounded-md">
                            🌐 {toEasternArabic(grp.onlineCount)} أونلاين
                          </span>
                        </div>
                      </div>

                      {/* أزرار الإجراءات */}
                      <div className="flex items-center gap-2 pt-3 border-t border-gray-100 flex-wrap sm:flex-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedQuizFilter(grp.quizTitle);
                            setSelectedUnitFilter('all');
                            setStatusFilter('all');
                            setSearchQuery('');
                            setPreviousQuizView('pending');
                            setMainView('students');
                            if (grp.submissions && grp.submissions.length === 1) {
                              setSelectedSubForReview(grp.submissions[0]);
                            }
                          }}
                          className="flex-1 bg-primary hover:bg-primary-dark text-white font-black py-2.5 px-3 rounded-xl text-xs sm:text-sm shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <i className="fas fa-pen-nib"></i>
                          <span>
                            {grp.totalCount === 1 
                              ? 'تصحيح إجابات وسجل الطالب (١)' 
                              : `تصحيح طلاب هذا الامتحان (${toEasternArabic(grp.totalCount)})`}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleApproveQuizBatch(grp)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 px-3.5 rounded-xl text-xs sm:text-sm shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                          title="اعتماد درجات جميع طلاب هذا الامتحان دفعة واحدة"
                        >
                          <i className="fas fa-check-double"></i>
                          <span>اعتماد النتيجة دفعة واحدة</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* العرض الثاني: أرشيف المقالي المعتمد بالكامل              */}
        {/* ========================================================= */}
        {mainView === 'archive' && (
          <div className="space-y-4">
            {/* شريط البحث للأرشيف */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-200">
              <div className="relative flex-1 w-full">
                <i className="fas fa-search absolute right-3.5 top-3 text-emerald-600/70 text-xs"></i>
                <input
                  type="text"
                  placeholder="ابحث في أرشيف المقالي باسم الامتحان أو الوحدة..."
                  value={quizSearchTerm}
                  onChange={e => setQuizSearchTerm(e.target.value)}
                  className="w-full pr-9 pl-3 py-2 text-xs font-bold border border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                />
              </div>
              <div className="text-xs font-black text-emerald-900 bg-white px-3.5 py-2 rounded-xl border border-emerald-200 shadow-2xs shrink-0 flex items-center gap-1.5">
                <i className="fas fa-archive text-emerald-600"></i>
                <span>المؤرشف: {toEasternArabic(archivedQuizGroups.length)} امتحان معتمد</span>
              </div>
            </div>

            {filteredArchivedQuizGroups.length === 0 ? (
              <div className="text-center py-12 px-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                <i className="fas fa-archive text-4xl text-gray-300 mb-2 block"></i>
                <p className="text-sm font-bold text-gray-500">لا توجد امتحانات مؤرشفة مطابقة لمعايير البحث الحالية.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredArchivedQuizGroups.map(grp => (
                  <div
                    key={grp.quizTitle}
                    className="rounded-2xl border-2 border-emerald-200 bg-white p-4 sm:p-5 flex flex-col justify-between gap-4 shadow-xs hover:shadow-md transition-all"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-md border border-gray-200">
                            📁 {grp.unitTitle}
                          </span>
                          <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300 flex items-center gap-1">
                            <i className="fas fa-check-circle"></i>
                            <span>مؤرشف ومعلن للطلاب 100%</span>
                          </span>
                        </div>

                        <span className="text-xs font-black text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
                          {toEasternArabic(grp.totalCount)} طالب
                        </span>
                      </div>

                      <h3 className="text-base sm:text-lg font-black text-gray-900 mb-2 leading-snug">
                        {grp.quizTitle}
                      </h3>

                      {/* شريط التقدم 100% مكتمل */}
                      <div className="space-y-1 mb-3">
                        <div className="flex justify-between text-[11px] font-bold text-emerald-800">
                          <span>نسبة اعتماد الإجابات</span>
                          <span className="font-mono font-black">١٠٠%</span>
                        </div>
                        <div className="w-full bg-emerald-100 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-emerald-500 w-full" />
                        </div>
                      </div>

                      {/* الشارات الإحصائية */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-bold">
                        <span className="bg-emerald-50 text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <i className="fas fa-check text-emerald-600"></i> {toEasternArabic(grp.approvedCount)} معتمد
                        </span>
                        <span className="bg-blue-50 text-blue-900 border border-blue-200 px-2 py-0.5 rounded-md">
                          🏫 {toEasternArabic(grp.centerCount)} سنتر
                        </span>
                        <span className="bg-teal-50 text-teal-900 border border-teal-200 px-2 py-0.5 rounded-md">
                          🌐 {toEasternArabic(grp.onlineCount)} أونلاين
                        </span>
                      </div>
                    </div>

                    {/* أزرار الإجراءات في الأرشيف */}
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedQuizFilter(grp.quizTitle);
                          setSelectedUnitFilter('all');
                          setStatusFilter('all');
                          setSearchQuery('');
                          setPreviousQuizView('archive');
                          setMainView('students');
                          if (grp.submissions && grp.submissions.length === 1) {
                            setSelectedSubForReview(grp.submissions[0]);
                          }
                        }}
                        className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-black py-2.5 px-3 rounded-xl text-xs sm:text-sm shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <i className="fas fa-eye"></i>
                        <span>
                          {grp.totalCount === 1 
                            ? 'معاينة إجابات وسجل الطالب (١)' 
                            : `استعراض سجل طلاب هذا الامتحان (${toEasternArabic(grp.totalCount)})`}
                        </span>
                      </button>
                      <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-200 py-2 px-3 rounded-xl flex items-center gap-1 shrink-0">
                        <i className="fas fa-check-circle"></i> معلن للطلاب
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* العرض الثاني: قائمة تسليمات الطلاب                       */}
        {/* ========================================================= */}
        {mainView === 'students' && (
          <div className="space-y-4 animate-fade-in">
            {/* شريط وضع التركيز إن كان هناك امتحان محدد */}
            {selectedQuizFilter !== 'all' && (
              <div className="bg-gradient-to-r from-indigo-950 via-primary to-slate-900 text-white p-4 rounded-2xl shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center text-lg font-black shrink-0 shadow-sm">
                    <i className="fas fa-bullseye"></i>
                  </div>
                  <div>
                    <span className="text-[11px] text-amber-300 font-bold block">وضع التركيز على تصحيح امتحان محدد:</span>
                    <h3 className="text-base sm:text-lg font-black">{selectedQuizFilter}</h3>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 flex-wrap">
                  {(() => {
                    const currentGrp = quizGroups.find(g => g.quizTitle === selectedQuizFilter || g.lessonId === selectedQuizFilter);
                    if (currentGrp && currentGrp.pendingCount > 0) {
                      return (
                        <button
                          type="button"
                          onClick={() => handleApproveQuizBatch(currentGrp)}
                          className="flex-1 sm:flex-none bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black px-3.5 py-2 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                        >
                          <i className="fas fa-check-double"></i> اعتماد كل طلاب هذا الامتحان ({toEasternArabic(currentGrp.pendingCount)})
                        </button>
                      );
                    }
                    return null;
                  })()}

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedQuizFilter('all');
                      setMainView(previousQuizView);
                    }}
                    className="flex-1 sm:flex-none bg-white/15 hover:bg-white/25 text-white font-bold px-3.5 py-2 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 border border-white/20 active:scale-95 cursor-pointer"
                  >
                    <i className="fas fa-arrow-right"></i> {previousQuizView === 'archive' ? 'العودة لأرشيف المقالي 🗄️' : 'العودة للامتحانات المعلقة ⏳'}
                  </button>
                </div>
              </div>
            )}

            {/* القوائم المنسدلة لاختيار الوحدة والدرس للتصحيح الموجه */}
            <div className="bg-slate-50 border-2 border-slate-200 p-3.5 sm:p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <i className="fas fa-layer-group text-primary"></i>
                  تحديد الامتحان المستهدف للتصحيح (فلترة موجهة):
                </span>
                {(selectedUnitFilter !== 'all' || selectedQuizFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUnitFilter('all');
                      setSelectedQuizFilter('all');
                    }}
                    className="text-[11px] font-black text-primary hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <i className="fas fa-times-circle"></i> إعادة ضبط الفلترة
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* القائمة المنسدلة 1: الوحدة الدراسية */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    📂 1. اختيار الوحدة الدراسية:
                  </label>
                  <select
                    value={selectedUnitFilter}
                    onChange={e => {
                      setSelectedUnitFilter(e.target.value);
                      setSelectedQuizFilter('all');
                    }}
                    className="w-full p-2.5 text-xs sm:text-sm font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary outline-none bg-white shadow-2xs"
                  >
                    <option value="all">🌟 جميع الوحدات الدراسية ({toEasternArabic(stats.total)} تسليم)</option>
                    {availableUnits.map(u => (
                      <option key={u.id} value={u.title}>
                        📁 {u.title} ({toEasternArabic(u.count)} تسليم)
                      </option>
                    ))}
                  </select>
                </div>

                {/* القائمة المنسدلة 2: الدرس / الامتحان */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    📝 2. اختيار الدرس / الامتحان المراد تصحيحه:
                  </label>
                  <select
                    value={selectedQuizFilter}
                    onChange={e => setSelectedQuizFilter(e.target.value)}
                    className="w-full p-2.5 text-xs sm:text-sm font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary outline-none bg-white shadow-2xs"
                  >
                    <option value="all">
                      📖 جميع الامتحانات والدروس ({toEasternArabic(availableQuizzes.reduce((s, q) => s + q.count, 0))} تسليم)
                    </option>
                    {availableQuizzes.map(q => (
                      <option key={q.title} value={q.title}>
                        {q.title} ({toEasternArabic(q.count)} طالب {q.pendingCount > 0 ? `• ⏳ ${toEasternArabic(q.pendingCount)} معلق` : '• ✅ معتمد'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* حقل البحث والتصفية */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <i className="fas fa-search absolute right-3.5 top-3.5 text-gray-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="ابحث باسم الطالب، رقم الهاتف، أو اسم الاختبار..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pr-10 pl-4 py-2.5 text-xs sm:text-sm font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-between w-full sm:w-auto">
                {/* فلتر حالة الاعتماد */}
                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl shrink-0">
                  <button
                    onClick={() => setStatusFilter('pending')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                      statusFilter === 'pending' ? 'bg-white text-amber-900 shadow-sm font-black' : 'text-gray-600'
                    }`}
                  >
                    المعلق
                  </button>
                  <button
                    onClick={() => setStatusFilter('approved')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                      statusFilter === 'approved' ? 'bg-white text-emerald-900 shadow-sm font-black' : 'text-gray-600'
                    }`}
                  >
                    المعتمد
                  </button>
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                      statusFilter === 'all' ? 'bg-white text-primary shadow-sm font-black' : 'text-gray-600'
                    }`}
                  >
                    الكل
                  </button>
                </div>

                {/* فلتر سنتر / أونلاين */}
                <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl shrink-0">
                  <button
                    onClick={() => setStudentTypeFilter('all')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                      studentTypeFilter === 'all' ? 'bg-primary text-white shadow-sm font-black' : 'text-gray-600'
                    }`}
                  >
                    الجميع
                  </button>
                  <button
                    onClick={() => setStudentTypeFilter('center')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                      studentTypeFilter === 'center' ? 'bg-blue-600 text-white shadow-sm font-black' : 'text-blue-700 hover:bg-blue-50'
                    }`}
                  >
                    🏫 سنتر
                  </button>
                  <button
                    onClick={() => setStudentTypeFilter('online')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                      studentTypeFilter === 'online' ? 'bg-emerald-600 text-white shadow-sm font-black' : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    🌐 أونلاين
                  </button>
                </div>
              </div>
            </div>

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
                      className={`p-4 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                        isApproved 
                          ? 'bg-white border-gray-200 hover:border-emerald-300' 
                          : 'bg-amber-50/40 border-amber-300 shadow-xs hover:border-amber-400'
                      }`}
                    >
                      {/* بيانات الطالب والاختبار */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-black text-base text-gray-900">{sub.studentName}</span>
                          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md" dir="ltr">
                            {sub.studentPhone}
                          </span>
                          {subIsOnline ? (
                            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                              <i className="fas fa-globe text-emerald-600"></i> أونلاين
                            </span>
                          ) : (
                            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                              <i className="fas fa-school text-blue-600"></i> سنتر
                            </span>
                          )}
                          {(() => {
                            const hasDraftScores = !sub.isFullyApproved && sub.questions.some(q => q.teacherScore !== undefined);
                            if (isApproved) {
                              return (
                                <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  ✅ معتمد ومنشور
                                </span>
                              );
                            }
                            if (hasDraftScores) {
                              return (
                                <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300">
                                  💾 مسودة مصححة (محجوبة عن الطالب)
                                </span>
                              );
                            }
                            return (
                              <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                                ⏳ بانتظار التصحيح
                              </span>
                            );
                          })()}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-gray-500 font-bold flex-wrap mt-1">
                          <span className="text-primary font-black">
                            <i className="fas fa-book-open ml-1"></i> {sub.quizTitle}
                          </span>
                          <span>
                            <i className="fas fa-calendar-alt ml-1"></i> {sub.submissionDate}
                          </span>
                          <span>
                            <i className="fas fa-pen-nib ml-1"></i> {toEasternArabic(sub.questions.length)} أسئلة مقالية
                          </span>
                        </div>
                      </div>

                      {/* أزرار الإجراءات */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        {!isApproved && (
                          <button
                            type="button"
                            onClick={() => handleQuickApprove(sub)}
                            className="text-xs font-black px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                            title="اعتماد درجات الذكاء الاصطناعي المقترحة فوراً"
                          >
                            <i className="fas fa-check-double"></i> اعتماد فوري
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedSubForReview(sub)}
                          className={`text-xs font-black px-3.5 sm:px-4 py-2 rounded-xl shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                            isApproved
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : 'bg-primary hover:bg-primary-dark text-white'
                          }`}
                        >
                          <i className={`fas ${isApproved ? 'fa-pen-to-square' : 'fa-eye'}`}></i>
                          <span>{isApproved ? 'معاينة وتعديل الدرجات' : 'فحص واعتماد الإجابات'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setRetakeModalSub(sub)}
                          className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-rose-100 text-gray-400 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
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
        )}

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
            refreshSubmissions();
            if (onSaveResultToDB && updated.quizTitle) {
              const maxPossible = updated.maxPossibleScore || 50;
              const perc = Math.round(((updated.finalScore || 0) / Math.max(1, maxPossible)) * 100);
              onSaveResultToDB({
                quizName: updated.quizTitle,
                score: `${perc}%`,
                studentName: updated.studentName,
                studentPhone: updated.studentPhone,
              });
            }
            if (nextPendingSub) {
              showToast(`✅ تم اعتماد درجات: ${updated.studentName} والانتقال للطالب التالي`);
              setSelectedSubForReview(nextPendingSub);
            } else {
              setSelectedSubForReview(null);
              showToast(`🎉 تم اعتماد درجات: ${updated.studentName}، واكتمل تصحيح كافة الطلاب!`);
            }
          }}
          onSaveApproved={(updated) => {
            savePendingEssaySubmission(updated);
            syncGradeToCloud(updated);
            refreshSubmissions();
            if (onSaveResultToDB && updated.quizTitle) {
              const maxPossible = updated.maxPossibleScore || 50;
              const perc = Math.round(((updated.finalScore || 0) / Math.max(1, maxPossible)) * 100);
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
            refreshSubmissions();
            setSelectedSubForReview(null);
            showToast(`💾 تم حفظ درجات ${updated.studentName} كمسودة بنجاح (النتيجة محجوبة لحين الاعتماد النهائي)`);
          }}
          onSaveDraftAndNext={(updated) => {
            savePendingEssaySubmission(updated);
            refreshSubmissions();
            if (nextPendingSub) {
              showToast(`💾 تم حفظ درجات: ${updated.studentName} كمسودة والانتقال للطالب التالي`);
              setSelectedSubForReview(nextPendingSub);
            } else {
              setSelectedSubForReview(null);
              showToast(`💾 تم حفظ درجات: ${updated.studentName} كمسودة، واكتمل استعراض كافة الطلاب!`);
            }
          }}
          isDarkMode={isDarkMode}
        />
      )}

      {/* نافذة تأكيد اعتماد النتيجة وتحديد إتاحة بنك الأخطاء للامتحان دفعة واحدة */}
      {batchApproveDialog && (
        <div className="fixed inset-0 z-[999999] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border-t-8 border-primary text-right animate-fade-in space-y-4">
            <div className="flex items-center gap-3 border-b pb-3 dark:border-gray-700">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl shrink-0">
                🎯
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-black text-gray-900 dark:text-gray-100">
                  تأكيد اعتماد نتائج امتحان دفعة واحدة
                </h3>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  {batchApproveDialog.grp.quizTitle} • {toEasternArabic(batchApproveDialog.grp.pendingCount)} طالب معلق
                </p>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200 leading-relaxed">
              <i className="fas fa-circle-info text-amber-600 ml-1.5"></i>
              <span>
                أنت على وشك اعتماد وإعلان درجات جميع طلاب هذا الامتحان المعلقين ({toEasternArabic(batchApproveDialog.grp.pendingCount)} طالب). يرجى تحديد ما إذا كنت ترغب في <strong>إتاحة أسئلة هذا الاختبار في بنك الأخطاء</strong> للطلاب:
              </span>
            </div>

            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={() => executeBatchApprove(true)}
                className="w-full p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm flex items-center justify-between shadow-md active:scale-[0.99] transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-lg">✅</span>
                  <div className="text-right">
                    <div>اعتماد النتيجة لجميع الطلاب + إتاحة بنك الأخطاء 🎯</div>
                    <div className="text-[11px] font-normal text-emerald-100">تظهر أخطاء هذا الامتحان لجميع الطلاب في بنك الأخطاء للتدرب فوراً</div>
                  </div>
                </div>
                <i className="fas fa-chevron-left text-xs opacity-70 group-hover:translate-x-[-3px] transition-transform"></i>
              </button>

              <button
                type="button"
                onClick={() => executeBatchApprove(false)}
                className="w-full p-4 rounded-2xl bg-slate-700 hover:bg-slate-800 text-white font-black text-sm flex items-center justify-between shadow-md active:scale-[0.99] transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-lg">🔒</span>
                  <div className="text-right">
                    <div>اعتماد النتيجة فقط (حجب بنك الأخطاء عن الطلاب) 🔒</div>
                    <div className="text-[11px] font-normal text-slate-300">تُعتمد الدرجات وتُعلن للطلاب، ولكن تُحجب الأخطاء من بنك الأخطاء</div>
                  </div>
                </div>
                <i className="fas fa-chevron-left text-xs opacity-70 group-hover:translate-x-[-3px] transition-transform"></i>
              </button>

              <button
                type="button"
                onClick={() => setBatchApproveDialog(null)}
                className="w-full py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                إلغاء التراجع
              </button>
            </div>
          </div>
        </div>
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
    </>
  );
};

// -------------------------------------------------------------
// نافذة فحص ومراجعة إجابات الطالب الواحد (Modal)
// -------------------------------------------------------------

interface StudentEssayReviewModalProps {
  submission: StudentEssaySubmission;
  data?: Unit[];
  onClose: () => void;
  onSaveApproved: (updated: StudentEssaySubmission) => void;
  onSaveDraft?: (updated: StudentEssaySubmission) => void;
  onSaveApprovedAndNext?: (updated: StudentEssaySubmission) => void;
  onSaveDraftAndNext?: (updated: StudentEssaySubmission) => void;
  onRequestRetake?: (submission: StudentEssaySubmission) => void;
  hasNextPending?: boolean;
  isDarkMode?: boolean;
}

const StudentEssayReviewModal: React.FC<StudentEssayReviewModalProps> = ({
  submission,
  data = [],
  onClose,
  onSaveApproved,
  onSaveDraft,
  onSaveApprovedAndNext,
  onSaveDraftAndNext,
  onRequestRetake,
  hasNextPending = false,
  isDarkMode = false,
}) => {
  const [questions, setQuestions] = useState<EssayReviewQuestionItem[]>(() => {
    return submission.questions.map((q, qIdx) => {
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
          ? q.teacherScore 
          : (q.aiScore !== undefined 
              ? q.aiScore 
              : (hasNoText ? 0 : resolvedMaxScore)),
        teacherFeedback: q.teacherFeedback || q.aiFeedback || (hasNoText ? 'لم يكتب الطالب إجابة لهذا السؤال.' : ''),
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
    questions.forEach((q, idx) => {
      if (q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ') return;
      const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
      const hasModelAns = q.modelAnswer && q.modelAnswer.trim() !== '' && !q.modelAnswer.includes('لا يوجد');
      
      const needsDiff = !hasNoText && (!diffComparisons[idx] || (diffComparisons[idx].suggestedScore === 0 && hasModelAns && diffComparisons[idx].provider === 'heuristic'));
      
      if (needsDiff && !diffLoading[idx]) {
        setDiffLoading(prev => ({ ...prev, [idx]: true }));
        compareStudentWithModelAnswer(
          q.questionText,
          q.modelAnswer,
          q.studentText,
          q.maxScore,
          q.essayType
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

  const handleTriggerDiff = async (idx: number, q: EssayReviewQuestionItem) => {
    if (diffOpen[idx]) {
      setDiffOpen(prev => ({ ...prev, [idx]: false }));
      return;
    }

    setDiffOpen(prev => ({ ...prev, [idx]: true }));
    if (diffComparisons[idx]) return;

    setDiffLoading(prev => ({ ...prev, [idx]: true }));
    try {
      const res = await compareStudentWithModelAnswer(
        q.questionText,
        q.modelAnswer,
        q.studentText,
        q.maxScore,
        q.essayType
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

    if (score >= maxScore * 0.9 || validMissing.length === 0) {
      feedbackText = '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنت وبارك الله فيك يا بطل! 🌟';
    } else if (score >= maxScore * 0.4) {
      const missingListStr = validMissing.slice(0, 2).join('، ');
      feedbackText = `👍 الإجابة صحيحة وموفقة في مجملها، ولكن ينقصك لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركز عليها لتضمن الدرجة الكاملة! 💡`;
    } else if (score > 0) {
      const missingListStr = validMissing.slice(0, 2).join('، ');
      feedbackText = `⚠️ إجابتك ناقصة وبحاجة لمراجعة؛ حيث أغفلت توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`;
    } else {
      feedbackText = diff.studentFeedback || `${diff.verdictSummary}`;
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
    return questions.some(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
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

  const perc = Math.round((totalEarnedScore / Math.max(1, totalMaxScore)) * 100);

  const [mistakesReleaseDialog, setMistakesReleaseDialog] = useState<'publish' | 'next' | null>(null);

  const handleApproveAndPublish = () => {
    setMistakesReleaseDialog('publish');
  };

  const handleApproveAndNext = () => {
    setMistakesReleaseDialog('next');
  };

  const executeApprovalWithMistakesOption = (releaseMistakes: boolean) => {
    const updated: StudentEssaySubmission = {
      ...submission,
      questions: questions.map(q => ({ ...q, isApproved: true })),
      isFullyApproved: true,
      isMistakesBankReleased: releaseMistakes,
      finalScore: totalEarnedScore,
    };
    const targetMode = mistakesReleaseDialog;
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
      {/* 1. رأس الشاشة (شريط ملاحة علوي ثابت بكامل العرض) */}
      <header className={`px-4 sm:px-6 py-3.5 border-b shadow-xs shrink-0 flex items-center justify-between gap-4 ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs sm:text-sm font-black flex items-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95"
            title="الرجوع إلى قائمة التسليمات"
          >
            <i className="fas fa-arrow-right text-sm"></i>
            <span>العودة لقائمة التسليمات</span>
          </button>

          <div className="h-6 w-[1px] bg-gray-300 dark:bg-gray-700 hidden sm:block"></div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg md:text-xl font-black text-primary">
                مراجعة وتصحيح: {submission.studentName}
              </h2>
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 rounded-md border border-gray-200 dark:border-gray-700" dir="ltr">
                {submission.studentPhone}
              </span>
              <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-md border ${
                submission.studentType === 'أونلاين'
                  ? 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300'
              }`}>
                {submission.studentType || 'سنتر'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-0.5">
              📖 {submission.quizTitle} • تاريخ التسليم: {submission.submissionDate}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/50 px-3.5 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-xs font-bold text-indigo-900 dark:text-indigo-300">
            <i className="fas fa-file-pen text-sm"></i>
            <span>
              {hasMixedQuestions ? (
                <>مقالي: <strong>{essayQuestions.length}</strong> • موضوعي: <strong>{questions.length - essayQuestions.length}</strong></>
              ) : (
                <>عدد الأسئلة المقالية: <strong>{questions.length}</strong></>
              )}
            </span>
          </div>

          {onRequestRetake && (
            <button
              type="button"
              onClick={() => onRequestRetake(submission)}
              className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors border border-amber-300 dark:border-amber-700 cursor-pointer shadow-xs active:scale-95"
              title="إتاحة إعادة المحاولة للطالب (كامل أو مقالي فقط)"
            >
              <i className="fas fa-redo-alt"></i>
              <span className="hidden sm:inline">إعادة المحاولة للطالب 🔄</span>
              <span className="sm:hidden">إعادة 🔄</span>
            </button>
          )}

          <button 
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/50 text-gray-500 flex items-center justify-center transition-colors cursor-pointer"
            title="إغلاق الشاشة والعودة"
          >
            <i className="fas fa-times text-base"></i>
          </button>
        </div>
      </header>

      {/* 2. شريط حالة الاعتماد والتعديل */}
      <div className={`px-4 sm:px-6 py-2.5 border-b flex items-center justify-between gap-2 text-xs font-bold shrink-0 ${
        submission.isFullyApproved
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800'
      }`}>
        <div className="flex items-center gap-2">
          <i className={`fas ${submission.isFullyApproved ? 'fa-check-circle text-emerald-600' : 'fa-hourglass-half text-amber-600'} text-sm`}></i>
          <span>
            {submission.isFullyApproved
              ? 'هذه النتيجة معتمدة مسبقاً. يمكنك في أي وقت تعديل الدرجات (إضافة درجات بونص أو خصمها)، وتحديث الملاحظات وحفظ التعديلات فوراً.'
              : 'هذا الاختبار بانتظار الاعتماد. يقوم النظام بمقارنة إجابات الطالب بنموذج الإجابة واقتراح الدرجة العادلة تلقائياً.'}
          </span>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black shrink-0 ${
          submission.isFullyApproved ? 'bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100' : 'bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-100'
        }`}>
          {submission.isFullyApproved ? 'وضع المراجعة والتعديل ✏️' : 'اعتماد جديد 🚀'}
        </span>
      </div>

      {/* 3. مساحة العمل ومحتوى الأسئلة والإجابات (شاشة كاملة برحابة) */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6">
        <div className="max-w-5xl mx-auto space-y-6 pb-28">
          {hasMixedQuestions && (
            <div className="flex items-center gap-2 p-1.5 bg-gray-100 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setReviewFilter('essay')}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  reviewFilter === 'essay'
                    ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <span>✍️ الأسئلة المقالية (المطلوب تصحيحها)</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold">{essayQuestions.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewFilter('mcq')}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  reviewFilter === 'mcq'
                    ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <span>🔘 الأسئلة الموضوعية (تصحيح آلي)</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 font-bold">{questions.length - essayQuestions.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewFilter('all')}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  reviewFilter === 'all'
                    ? 'bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <span>📋 كل أسئلة الاختبار</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 font-bold">{questions.length}</span>
              </button>
            </div>
          )}

          {questions.map((q, idx) => {
            const isMcq = q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ';
            if (reviewFilter === 'essay' && isMcq) return null;
            if (reviewFilter === 'mcq' && !isMcq) return null;
            const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
            const studentWordCount = q.studentText && !hasNoText ? q.studentText.trim().split(/\s+/).length : 0;
            const isDiffReady = !!diffComparisons[idx];
            const isDiffBusy = !!diffLoading[idx];
            const isDiffExpanded = !!diffOpen[idx];

            return (
              <div key={idx} className={`p-5 sm:p-6 rounded-2xl border-2 space-y-4 transition-all shadow-sm ${
                isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200 text-gray-800'
              }`}>
                {/* رأس السؤال */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/60 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700">
                      🏷️ {q.essayType}
                    </span>
                    <span className="font-black text-gray-800 dark:text-gray-200 text-sm">سؤال #{idx + 1}</span>
                  </div>
                  <span className="text-xs font-black text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700">
                    الدرجة العظمى: {q.maxScore} درجات
                  </span>
                </div>

                {/* رأس السؤال المطلوب */}
                <div className="bg-gradient-to-r from-indigo-50/70 via-blue-50/40 to-slate-50 dark:from-indigo-950/40 dark:via-blue-950/20 dark:to-gray-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-xl p-4 text-xs sm:text-sm leading-relaxed shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-indigo-100 dark:border-indigo-900/60">
                    <span className="font-black text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center text-[10px] shadow-xs">
                        <i className="fas fa-question"></i>
                      </span>
                      <span>نص السؤال المطلوب من الطالب:</span>
                    </span>
                    {q.essayType && (
                      <span className="text-[11px] font-black text-indigo-800 dark:text-indigo-300 bg-indigo-100/90 dark:bg-indigo-900/60 px-2.5 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                        🎯 {q.essayType}
                      </span>
                    )}
                  </div>
                  <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 leading-relaxed">
                    <FormatQuestionText text={q.questionText} isDarkMode={isDarkMode} />
                  </div>
                </div>

                {/* نموذج الإجابة المعتمد */}
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3.5 text-xs sm:text-sm leading-relaxed">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <span className="font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
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
                        className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-md border border-emerald-300 dark:border-emerald-700 transition-all cursor-pointer shadow-2xs flex items-center gap-1 active:scale-95"
                        title="تعديل أو كتابة نموذج الإجابة لهذا السؤال"
                      >
                        <i className="fas fa-pen-to-square text-[10px]"></i>
                        <span>{q.modelAnswer && !q.modelAnswer.includes('لا يوجد') ? 'تعديل النموذج ✏️' : 'كتابة نموذج إجابة ➕'}</span>
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
                      <p className="text-[11px] text-emerald-800 dark:text-emerald-300 font-bold">
                        💡 بمجرد حفظ النموذج، سيقوم النظام تلقائياً بإعادة المقارنة الذكية لإجابة الطالب واقتراح الدرجة العادلة بدقة.
                      </p>
                    </div>
                  ) : (
                    <div className="font-bold text-emerald-900 dark:text-emerald-300 whitespace-pre-line leading-relaxed">
                      <HighlightText text={q.modelAnswer || 'لا يوجد نموذج إجابة مسجل لهذا السؤال'} isDarkMode={isDarkMode} />
                    </div>
                  )}
                </div>

                {/* ما كتبه الطالب */}
                <div className="bg-white dark:bg-gray-800/80 border-2 border-indigo-200 dark:border-indigo-800/70 rounded-xl p-4 text-xs sm:text-sm leading-relaxed shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-2 border-b border-indigo-50 dark:border-gray-700 pb-1.5">
                    <span className="font-black text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                      <i className="fas fa-user-edit text-indigo-600 dark:text-indigo-400"></i> ما كتبه الطالب نصاً:
                    </span>
                    {!hasNoText && (
                      <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                        {studentWordCount} كلمة • {q.studentText.length} حرف
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-gray-800 dark:text-gray-200 whitespace-pre-line leading-relaxed text-sm">
                    {!hasNoText ? (
                      q.studentText
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400 font-bold bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 inline-block">
                        ⚠️ لم يكتب الطالب إجابة لهذا السؤال (ترك السؤال فارغاً)
                      </span>
                    )}
                  </div>
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
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300">
                                {diffComparisons[idx].provider === 'gemini' ? 'Google Gemini AI ⚡' : 'المحلل الذكي المدمج 🧠'}
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
                              onClick={() => setDiffOpen(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="px-3 py-1.5 bg-white dark:bg-gray-800 text-indigo-900 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-gray-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                            >
                              {isDiffExpanded ? 'طي التفاصيل 🔼' : 'عرض تحليل الفروق التفصيلي 🔽'}
                            </button>
                          </div>
                        </div>

                        {/* خلاصة التحليل */}
                        <p className="text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-300 leading-relaxed pr-9">
                          💡 <strong className="text-indigo-900 dark:text-indigo-300">خلاصة تقرير المصحح:</strong> {diffComparisons[idx].verdictSummary}
                        </p>

                        {/* تفاصيل الفروق إذا كانت مفتوحة */}
                        {isDiffExpanded && (
                          <div className="pt-2 border-t border-indigo-200 dark:border-indigo-800 space-y-3 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {/* نقاط القوة والتطابق */}
                              <div className="bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                                <span className="font-black text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5 mb-2">
                                  <i className="fas fa-check-circle text-emerald-600 dark:text-emerald-400"></i> ما استوفاه الطالب بنجاح:
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
                              <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                                <span className="font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5 mb-2">
                                  <i className="fas fa-triangle-exclamation text-amber-600 dark:text-amber-400"></i> عناصر ناقصة أو مفقودة:
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
                        <i className="fas fa-bolt text-amber-500"></i> قوالب توجيه جاهزة (اضغط للإدراج فوراً):
                      </span>
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

      {/* 4. شريط الأزرار والاعتماد الثابت أسفل الشاشة */}
      <footer className={`p-4 sm:px-8 border-t flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-lg ${
        isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-3 flex-wrap">
          {hasMixedQuestions ? (
            <>
              <div className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-xs sm:text-sm font-bold text-indigo-900 dark:text-indigo-300">
                <span>المقالي:</span>
                <strong className="text-sm font-black">{essayEarnedScore} من {essayMaxScore}</strong>
              </div>
              <div className="flex items-center gap-1.5 bg-primary/10 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold text-primary">
                <span>إجمالي درجات الاختبار:</span>
                <strong className="text-base sm:text-lg font-black">{totalEarnedScore} من {totalMaxScore} ({perc}%)</strong>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs sm:text-sm font-black text-gray-600 dark:text-gray-300">مجموع درجات المقالي المعتمدة:</span>
              <span className="text-base sm:text-xl font-black text-primary bg-primary/10 px-3.5 py-1 rounded-xl">
                {totalEarnedScore} من {totalMaxScore} درجة
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mr-auto flex-wrap">
          {submission.studentPhone && (
            <button
              type="button"
              onClick={() => {
                const phone = String(submission.studentPhone || '').replace(/[^\d]/g, '');
                const intlPhone = phone.startsWith('0') ? `+20${phone.slice(1)}` : `+20${phone}`;
                const perc = Math.round((totalEarnedScore / Math.max(1, totalMaxScore)) * 100);
                const msg = encodeURIComponent(
                  `مرحباً بك يا بطل (${submission.studentName}) 🌟\n` +
                  `معك أستاذك إسلام سعود من منصة "موسوعة الكنز التعليمي".\n\n` +
                  `✅ تم مراجعة واعتماد اختبارك: *${submission.quizTitle}*\n` +
                  `📊 درجتك المقالية المعتمدة: *${totalEarnedScore} من ${totalMaxScore}* (${perc}%)\n\n` +
                  `تمنياتي لك بالتوفيق والنجاح دائماً! ❤️`
                );
                window.open(`https://wa.me/${intlPhone}?text=${msg}`, '_blank');
              }}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs sm:text-sm shadow-sm active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
              title="إرسال رسالة التهنئة والنتيجة إلى واتساب الطالب"
            >
              <i className="fab fa-whatsapp text-base"></i> واتساب 📲
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-bold text-xs sm:text-sm cursor-pointer transition-colors"
          >
            إلغاء
          </button>

          {!submission.isFullyApproved && hasNextPending && (
            <button
              type="button"
              onClick={handleSaveDraftAndNext}
              className="px-3.5 sm:px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
              title="حفظ درجات هذا الطالب كمسودة والانتقال المباشر للطالب التالي دون إعلان النتيجة الآن"
            >
              <i className="fas fa-bookmark text-purple-300"></i>
              <span>حفظ كمسودة والانتقال للتالي ⬅️</span>
            </button>
          )}

          {!submission.isFullyApproved && (
            <button
              type="button"
              onClick={handleSaveAsDraft}
              className="px-3.5 sm:px-4 py-2.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 font-black text-xs sm:text-sm shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
              title="حفظ الدرجات والملاحظات كمسودة والرجوع للقائمة دون إعلان النتيجة للطالب الآن"
            >
              <i className="fas fa-bookmark text-purple-600"></i>
              <span>{hasNextPending ? 'حفظ كمسودة وإنهاء 💾' : 'حفظ كمسودة 💾'}</span>
            </button>
          )}

          {hasNextPending && (
            <button
              type="button"
              onClick={handleApproveAndNext}
              className="px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
              title="اعتماد درجات هذا الطالب والانتقال المباشر للطالب التالي دون إغلاق الشاشة"
            >
              <i className="fas fa-forward-step"></i>
              <span>اعتماد والانتقال للتالي ⬅️</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleApproveAndPublish}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
          >
            <i className={`fas ${submission.isFullyApproved ? 'fa-save' : 'fa-check-circle'}`}></i>
            {submission.isFullyApproved ? 'حفظ التعديلات وتحديث درجات الطالب 💾' : 'اعتماد وإنهاء 🚀'}
          </button>
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
