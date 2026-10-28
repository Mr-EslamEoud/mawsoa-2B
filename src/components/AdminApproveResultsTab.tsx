import React, { useState, useEffect, useMemo } from 'react';
import { StudentEssaySubmission, Unit } from '../types';
import { formatPhoneStr, toEasternArabic, API_URL, SECRET_API_KEY } from '../utils';
import { 
  getPendingEssaySubmissions, 
  savePendingEssaySubmission,
  getExamConfig,
  calculateExamStructure,
  saveRetakeDirective,
  StudentRetakeDirective,
  ensureCompleteEssayQuestions
} from '../examConfigUtils';
import { StudentEssayReviewModal, syncGradeToCloud, syncDraftToCloud, resolveModelAnswer } from './AdminEssayReviewTab';

interface AdminApproveResultsTabProps {
  onSaveResultToDB?: (result: { quizName: string; score: string; studentName?: string; studentPhone?: string }) => void;
  isDarkMode?: boolean;
  onlineStudents?: any[];
  data?: Unit[];
  onNavigateToEssayReview?: (quizTitle?: string) => void;
}

export const AdminApproveResultsTab: React.FC<AdminApproveResultsTabProps> = ({
  onSaveResultToDB,
  isDarkMode,
  onlineStudents = [],
  data = [],
  onNavigateToEssayReview,
}) => {
  const [submissions, setSubmissions] = useState<StudentEssaySubmission[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(false);
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>('all');
  const [selectedQuizFilter, setSelectedQuizFilter] = useState<string>('all');
  const [statusTab, setStatusTab] = useState<'ready' | 'needs_grading' | 'approved' | 'all'>('ready');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // نافذة تأكيد الاعتماد الجماعي
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [processingBatch, setProcessingBatch] = useState<boolean>(false);

  // نافذة منح إعادة لطالب
  const [retakeModalSub, setRetakeModalSub] = useState<StudentEssaySubmission | null>(null);

  // نافذة تعديل درجات طالب سريعاً قبل الاعتماد
  const [quickEditSub, setQuickEditSub] = useState<StudentEssaySubmission | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const isSubOnline = (sub: StudentEssaySubmission): boolean => {
    if (sub.studentType === 'أونلاين') return true;
    const clean = formatPhoneStr(sub.studentPhone);
    return onlineStudents.some(o => formatPhoneStr(o.phone) === clean);
  };

  // جلب البيانات السحابية والمحلية
  const refreshData = async () => {
    setIsLoadingCloud(true);
    try {
      const res = await fetch(`${API_URL}?action=getEssaySubmissions&apiKey=${SECRET_API_KEY}&t=${Date.now()}`);
      const resData = await res.json();
      
      const localList = getPendingEssaySubmissions();
      const mergedMap = new Map<string, StudentEssaySubmission>();

      if (resData && resData.status === 'success' && Array.isArray(resData.data)) {
        const groupedCloud = new Map<string, any>();
        resData.data.forEach((row: any) => {
          if (!row.studentPhone || !row.quizTitle) return;
          const cleanPhone = formatPhoneStr(row.studentPhone);
          const key = `${cleanPhone}___${row.quizTitle.trim()}`;
          if (!groupedCloud.has(key)) {
            groupedCloud.set(key, {
              date: row.date || '',
              studentName: row.studentName || 'طالب',
              studentPhone: cleanPhone,
              quizTitle: row.quizTitle.trim(),
              studentType: row.studentType || 'سنتر',
              questions: []
            });
          }
          const grp = groupedCloud.get(key)!;
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

          // تجنب تكرار السؤال المقالي للطالب إذا تم إرسال الإجابة أكثر من مرة
          const existingQ = grp.questions.find((q: any) => q.questionText.trim() === cleanQText);
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

          grp.questions.push({
            qIndex: grp.questions.length,
            questionText: cleanQText,
            studentText: row.studentAnswerText || '',
            teacherScore: isTeacherGradedQuestion ? scoreNum : undefined,
            teacherFeedback: isTeacherGradedQuestion ? rawFb : '',
            aiScore: scoreNum,
            aiFeedback: rawFb,
            isApproved: isAppr,
            maxScore: 2
          });
        });

        groupedCloud.forEach((grp, key) => {
          const isAllApproved = grp.questions.length > 0 && grp.questions.every((q: any) => q.isApproved);
          const hasAllTeacherScores = grp.questions.length > 0 && grp.questions.every((q: any) => q.teacherScore !== undefined && q.teacherScore !== null);
          const isReviewed = Boolean(isAllApproved || (grp as any).hasGradedStatus || hasAllTeacherScores);
          
          // إيجاد الدرجة العظمى الممكنة
          let totalMaxPossible = 0;
          grp.questions.forEach((q: any, qi: number) => {
            const found = resolveModelAnswer(q.questionText, grp.quizTitle, undefined, qi, data);
            if (found.maxScore) q.maxScore = found.maxScore;
            totalMaxPossible += (q.maxScore || 2);
          });

          // معالجة تصحيح التكرار في حال تم حفظ الدرجة الكلية في كل صف بدلاً من توزيعها
          const rawEarned = grp.questions.reduce((sum: number, q: any) => sum + (q.teacherScore !== undefined ? q.teacherScore : (q.aiScore || 0)), 0);
          if (isReviewed && grp.questions.length > 1 && rawEarned > totalMaxPossible) {
            const firstScore = grp.questions[0].teacherScore;
            const isAllSameTotal = grp.questions.every((q: any) => q.teacherScore === firstScore && (firstScore || 0) > (q.maxScore || 2));
            if (isAllSameTotal && firstScore !== undefined) {
              const distributedScore = Math.min(totalMaxPossible, firstScore) / grp.questions.length;
              grp.questions.forEach((q: any) => {
                q.teacherScore = Number(distributedScore.toFixed(2));
              });
            }
          }

          const finalEarned = grp.questions.reduce((sum: number, q: any) => sum + (q.teacherScore !== undefined ? q.teacherScore : (q.aiScore || 0)), 0);

          const rawSub: StudentEssaySubmission = {
            id: `cloud_${key}`,
            studentName: grp.studentName,
            studentPhone: grp.studentPhone,
            quizTitle: grp.quizTitle,
            lessonId: grp.quizTitle,
            submissionDate: grp.date,
            questions: grp.questions,
            isFullyApproved: isAllApproved,
            isTeacherReviewed: isReviewed,
            finalScore: finalEarned,
            maxPossibleScore: totalMaxPossible,
            studentType: grp.studentType
          };
          const completeSub = ensureCompleteEssayQuestions(rawSub, data);
          mergedMap.set(key, completeSub);
        });
      }

      // دمج المحلي
      localList.forEach(ls => {
        const mKey = `${formatPhoneStr(ls.studentPhone)}___${ls.quizTitle.trim()}`;
        const completeLs = ensureCompleteEssayQuestions(ls, data);
        if (!mergedMap.has(mKey)) {
          mergedMap.set(mKey, completeLs);
        } else {
          // دمج الأسئلة الموضوعية والمقالية من المحلي إن وجدت مع حماية تصحيح المعلم
          const existing = mergedMap.get(mKey)!;
          const hasLocalReview = completeLs.isTeacherReviewed || completeLs.isFullyApproved;
          if (hasLocalReview) {
            existing.isTeacherReviewed = true;
            existing.finalScore = completeLs.finalScore;
            existing.questions = completeLs.questions;
            existing.maxPossibleScore = completeLs.maxPossibleScore || existing.maxPossibleScore;
            if (completeLs.isFullyApproved) existing.isFullyApproved = true;
          }
          if (completeLs.isAutoTerminated) existing.isAutoTerminated = true;
        }
      });

      const list = Array.from(mergedMap.values());
      setSubmissions(list);
    } catch (e) {
      // في حال تعذر الاتصال بالسحابة نعتمد على المحلي
      setSubmissions(getPendingEssaySubmissions());
    } finally {
      setIsLoadingCloud(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  // تحديد تصنيف حالة الطالب:
  // 1. blank_or_pulled: مقالي فارغ أو تم سحب الورقة لمخالفات (جاهز للاعتماد الفوري)
  // 2. graded_ready: قام المعلم بتصحيح المقالي (جاهز للاعتماد النهائي)
  // 3. needs_grading: يحتوي على إجابات مقالية لم يصححها المعلم بعد
  // 4. already_approved: تم اعتماده ونشره مسبقاً
  const getSubmissionCategory = (sub: StudentEssaySubmission): 'blank_or_pulled' | 'graded_ready' | 'needs_grading' | 'already_approved' => {
    if (sub.isFullyApproved) return 'already_approved';

    const essayQs = sub.questions.filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
    if (essayQs.length === 0) {
      return 'blank_or_pulled';
    }

    const isAllBlankOrTerminated = essayQs.every(q => 
      !q.studentText || 
      q.studentText.trim() === '' || 
      q.studentText.includes('لم يتم الإجابة') || 
      q.studentText.includes('سُحبت')
    );

    if (isAllBlankOrTerminated || sub.isAutoTerminated) {
      return 'blank_or_pulled';
    }

    // إذا لم يقم المعلم بتصحيح المقالي بعد أو يوجد سؤال مقالي لم يرصد المعلم درجته
    const hasUncheckedAnswer = essayQs.some(q => q.teacherScore === undefined || q.teacherScore === null);
    if (!sub.isTeacherReviewed || hasUncheckedAnswer) {
      return 'needs_grading';
    }

    return 'graded_ready';
  };

  // قائمة الوحدات المتاحة
  const availableUnits = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map(u => ({ id: u.id, title: u.title }));
  }, [data]);

  // قائمة الامتحانات المتاحة مع عدد المعلق الجاهز للاعتماد
  const availableQuizzes = useMemo(() => {
    const map = new Map<string, { title: string; unitTitle: string; readyCount: number; totalCount: number }>();
    
    // جمع العناوين من المنهج
    if (data && data.length > 0) {
      data.forEach(u => {
        if (selectedUnitFilter !== 'all' && u.id !== selectedUnitFilter && u.title !== selectedUnitFilter) return;
        u.lessons.forEach(l => {
          map.set(l.title.trim(), {
            title: l.title.trim(),
            unitTitle: u.title,
            readyCount: 0,
            totalCount: 0
          });
        });
      });
    }

    // إحصاء التسليمات
    submissions.forEach(sub => {
      const qTitle = sub.quizTitle.trim();
      if (!map.has(qTitle)) {
        map.set(qTitle, {
          title: qTitle,
          unitTitle: 'عام',
          readyCount: 0,
          totalCount: 0
        });
      }
      const entry = map.get(qTitle)!;
      entry.totalCount += 1;
      const cat = getSubmissionCategory(sub);
      if (cat === 'blank_or_pulled' || cat === 'graded_ready') {
        entry.readyCount += 1;
      }
    });

    return Array.from(map.values()).filter(q => q.totalCount > 0);
  }, [data, submissions, selectedUnitFilter]);

  // فلترة الطلاب بناءً على الاختيارات
  const filteredSubmissions = useMemo(() => {
    return submissions.filter(sub => {
      // فلتر الوحدة والامتحان
      if (selectedQuizFilter !== 'all' && sub.quizTitle.trim() !== selectedQuizFilter.trim()) {
        return false;
      }

      // فلتر التبويب
      const cat = getSubmissionCategory(sub);
      if (statusTab === 'ready' && cat !== 'blank_or_pulled' && cat !== 'graded_ready') {
        return false;
      }
      if (statusTab === 'needs_grading' && cat !== 'needs_grading') {
        return false;
      }
      if (statusTab === 'approved' && cat !== 'already_approved') {
        return false;
      }

      // بحث بالاسم أو الهاتف
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = sub.studentName.toLowerCase().includes(q);
        const matchPhone = sub.studentPhone.includes(q);
        const matchQuiz = sub.quizTitle.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchQuiz) return false;
      }

      return true;
    });
  }, [submissions, selectedQuizFilter, statusTab, searchQuery]);

  // إحصائيات سريعة للامتحان المحدد أو الإجمالي
  const stats = useMemo(() => {
    const list = selectedQuizFilter === 'all' 
      ? submissions 
      : submissions.filter(s => s.quizTitle.trim() === selectedQuizFilter.trim());

    let readyFast = 0;
    let readyGraded = 0;
    let needsGrading = 0;
    let approved = 0;

    list.forEach(s => {
      const cat = getSubmissionCategory(s);
      if (cat === 'blank_or_pulled') readyFast++;
      else if (cat === 'graded_ready') readyGraded++;
      else if (cat === 'needs_grading') needsGrading++;
      else if (cat === 'already_approved') approved++;
    });

    return {
      totalReady: readyFast + readyGraded,
      readyFast,
      readyGraded,
      needsGrading,
      approved,
      total: list.length
    };
  }, [submissions, selectedQuizFilter]);

  // اعتماد تسليم فردي
  const handleApproveSingle = async (sub: StudentEssaySubmission, releaseMistakes: boolean = true) => {
    try {
      const updated: StudentEssaySubmission = {
        ...sub,
        isFullyApproved: true,
        isMistakesBankReleased: releaseMistakes,
        questions: sub.questions.map(q => ({
          ...q,
          isApproved: true,
          teacherScore: q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0)
        }))
      };

      // حساب المجموع النهائي لكافة الأسئلة
      const earned = updated.questions.reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
      updated.finalScore = earned;

      // العثور على الدرس في المنهج إن وجد لحساب الدرجة العظمى بدقة
      let matchedLesson = null;
      if (data && data.length > 0) {
        for (const u of data) {
          const l = u.lessons.find(ls => ls.id === updated.lessonId || ls.title.trim() === updated.quizTitle.trim());
          if (l) { matchedLesson = l; break; }
        }
      }

      // فحص هل يحتوي التسليم على درجات الأسئلة الموضوعية أم مقالي فقط
      const hasMcqQuestions = updated.questions.some(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
      
      let maxPossible = updated.maxPossibleScore;
      if (!maxPossible || maxPossible <= 0) {
        if (hasMcqQuestions && matchedLesson) {
          const structure = calculateExamStructure(matchedLesson.questions, getExamConfig(matchedLesson.id));
          maxPossible = structure.examTotalScore;
        } else {
          maxPossible = updated.questions.reduce((sum, q) => sum + (Number(q.maxScore) || 2), 0);
        }
      }
      updated.maxPossibleScore = maxPossible;

      // حفظ محلياً
      savePendingEssaySubmission(updated);

      // مزامنة سحابياً: تحديث حالة الأسئلة إلى "معتمد" مع الحفاظ على درجات كل سؤال
      const cleanPhone = formatPhoneStr(updated.studentPhone);
      const fullPhone = cleanPhone.startsWith('0') ? '+20' + cleanPhone.substring(1) : cleanPhone;
      
      // 1. تحديث الحالة سحابياً عبر updateEssayGrade (دون إرسال teacherScore حتى لا يلغي تفصيل درجات الأسئلة)
      fetch(API_URL, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateEssayGrade',
          studentPhone: fullPhone,
          quizTitle: updated.quizTitle,
          isApproved: true,
          apiKey: SECRET_API_KEY
        })
      }).catch(() => {});

      // 2. مزامنة تفاصيل درجات كل سؤال مقالي بدقة عبر saveEssaySubmission
      const essayOnlyQuestions = updated.questions.filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
      if (essayOnlyQuestions.length > 0) {
        fetch(API_URL, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'saveEssaySubmission',
            date: updated.submissionDate || new Date().toLocaleString('ar-EG'),
            studentName: updated.studentName,
            studentPhone: fullPhone,
            quizTitle: updated.quizTitle,
            questions: essayOnlyQuestions.map(q => ({
              ...q,
              isApproved: true,
              teacherScore: q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0)
            })),
            isApproved: true,
            studentType: updated.studentType || 'سنتر',
            apiKey: SECRET_API_KEY
          })
        }).catch(() => {});
      }

      // حفظ النتيجة في شيت النتائج
      if (onSaveResultToDB && updated.quizTitle) {
        const perc = Math.min(100, Math.round((earned / Math.max(1, maxPossible)) * 100));
        onSaveResultToDB({
          quizName: updated.quizTitle,
          score: `${perc}%`,
          studentName: updated.studentName,
          studentPhone: updated.studentPhone,
        });
      }

      // تحديث الحالة في الواجهة
      setSubmissions(prev => prev.map(s => s.id === sub.id ? updated : s));
      showToast(`✅ تم اعتماد وإعلان نتيجة: ${updated.studentName}`);
    } catch (e) {
      showToast('❌ حدث خطأ أثناء الاعتماد');
    }
  };

  // اعتماد جماعي لجميع الطلاب الجاهزين المعروضين
  const handleApproveBatch = async (releaseMistakes: boolean) => {
    setProcessingBatch(true);
    const toApprove = filteredSubmissions.filter(s => {
      const cat = getSubmissionCategory(s);
      return cat === 'blank_or_pulled' || cat === 'graded_ready';
    });

    if (toApprove.length === 0) {
      setProcessingBatch(false);
      setBatchModalOpen(false);
      return;
    }

    for (const sub of toApprove) {
      await handleApproveSingle(sub, releaseMistakes);
    }

    setProcessingBatch(false);
    setBatchModalOpen(false);
    showToast(`🎉 تم اعتماد وإعلان نتائج (${toApprove.length}) طالب بنجاح!`);
  };

  // إعطاء إذن إعادة للطالب
  const handleGrantRetake = (sub: StudentEssaySubmission, retakeType: 'full' | 'essay_only') => {
    const cleanPhone = formatPhoneStr(sub.studentPhone);
    const mcqQuestions = sub.questions.filter(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
    const preservedMcqScore = mcqQuestions.reduce((sum, q) => sum + (q.teacherScore || 0), 0);

    const directive: StudentRetakeDirective = {
      id: `retake_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      studentPhone: cleanPhone,
      studentName: sub.studentName,
      lessonId: sub.lessonId || sub.quizTitle,
      lessonTitle: sub.quizTitle,
      retakeType: retakeType,
      date: new Date().toLocaleDateString('ar-EG'),
      seen: false,
      maxPossibleScore: sub.maxPossibleScore || 50,
      preservedMcqScore: retakeType === 'essay_only' ? preservedMcqScore : undefined,
      preservedMcqAnswers: retakeType === 'essay_only' ? mcqQuestions : undefined,
    };

    saveRetakeDirective(directive);

    // تسجيل الإعادة في شيت السحابة
    if (onSaveResultToDB) {
      onSaveResultToDB({
        quizName: `إعادة ${retakeType === 'full' ? 'شاملة' : 'مقالي'} 🔄: ${sub.quizTitle}`,
        score: `إذن إعادة 🔄`,
        studentName: sub.studentName,
        studentPhone: sub.studentPhone,
      });
    }

    setRetakeModalSub(null);
    showToast(`🔄 تم منح إذن الإعادة لـ: ${sub.studentName}`);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-16 animate-fade-in" dir="rtl">
      {/* 1. التنبيه العائم للأشعارات */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[999999] bg-slate-900/95 text-white px-5 py-3 rounded-2xl shadow-2xl text-xs sm:text-sm font-black border border-white/20 animate-bounce">
          {toastMessage}
        </div>
      )}

      {/* 2. رأس الصفحة والأزرار الرئيسية */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg font-black shrink-0">
              🎯
            </div>
            <h1 className="text-base sm:text-lg font-black text-gray-900 dark:text-white">
              اعتماد وإعلان النتائج
            </h1>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1">
            اعتماد نهائي ونشر الدرجات في شيت النتائج وفك حظر مراجعة الامتحان للطلاب
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={refreshData}
            disabled={isLoadingCloud}
            className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-black text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
          >
            <i className={`fas fa-rotate ${isLoadingCloud ? 'animate-spin' : ''}`}></i>
            <span>تحديث</span>
          </button>

          {stats.totalReady > 0 && (
            <button
              type="button"
              onClick={() => setBatchModalOpen(true)}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 cursor-pointer"
            >
              <i className="fas fa-check-double"></i>
              <span>اعتماد الكل ({toEasternArabic(stats.totalReady)})</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. شريط الفلاتر السريعة (الوحدات والدروس) */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-3 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* فلتر الوحدة */}
          <div>
            <label className="text-[11px] font-black text-gray-600 dark:text-gray-300 block mb-1">
              الوحدة:
            </label>
            <select
              value={selectedUnitFilter}
              onChange={(e) => {
                setSelectedUnitFilter(e.target.value);
                setSelectedQuizFilter('all');
              }}
              className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-bold text-xs outline-none focus:border-primary"
            >
              <option value="all">جميع الوحدات</option>
              {availableUnits.map(u => (
                <option key={u.id} value={u.id}>{u.title}</option>
              ))}
            </select>
          </div>

          {/* فلتر الامتحان */}
          <div>
            <label className="text-[11px] font-black text-gray-600 dark:text-gray-300 block mb-1">
              الامتحان:
            </label>
            <select
              value={selectedQuizFilter}
              onChange={(e) => setSelectedQuizFilter(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-bold text-xs outline-none focus:border-primary"
            >
              <option value="all">جميع الامتحانات ({toEasternArabic(availableQuizzes.length)})</option>
              {availableQuizzes.map(q => (
                <option key={q.title} value={q.title}>
                  {q.title} {q.readyCount > 0 ? `(${toEasternArabic(q.readyCount)} جاهز)` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* حقل البحث بالاسم */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم الطالب أو رقم الهاتف..."
            className="w-full pr-9 pl-3 py-2 text-xs font-bold border border-gray-300 dark:border-gray-600 rounded-xl outline-none focus:border-primary bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white"
          />
          <i className="fas fa-search absolute right-3 top-2.5 text-gray-400 text-xs"></i>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-2 text-gray-400 hover:text-gray-600 text-xs"
            >
              <i className="fas fa-times-circle"></i>
            </button>
          )}
        </div>
      </div>

      {/* 4. كروت الإحصاءات السريعة (أزرار تصفية باللمس مريحة للموبايل) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setStatusTab('ready')}
          className={`p-3 rounded-2xl border-2 text-right transition-all cursor-pointer ${
            statusTab === 'ready'
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 shadow-sm'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-black">جاهز للاعتماد</span>
            <span className="text-base">⚡</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {toEasternArabic(stats.totalReady)}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold mt-0.5">
            فارغ ({stats.readyFast}) + مصحح ({stats.readyGraded})
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('needs_grading')}
          className={`p-3 rounded-2xl border-2 text-right transition-all cursor-pointer ${
            statusTab === 'needs_grading'
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 shadow-sm'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-black">يحتاج تصحيح</span>
            <span className="text-base">✍️</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400">
            {toEasternArabic(stats.needsGrading)}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold mt-0.5">
            مقالي بانتظار تقديرك
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('approved')}
          className={`p-3 rounded-2xl border-2 text-right transition-all cursor-pointer ${
            statusTab === 'approved'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-200 shadow-sm'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-black">معتمد ومنشور</span>
            <span className="text-base">✅</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400">
            {toEasternArabic(stats.approved)}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold mt-0.5">
            ظهرت نتيجتهم للطالب
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusTab('all')}
          className={`p-3 rounded-2xl border-2 text-right transition-all cursor-pointer ${
            statusTab === 'all'
              ? 'border-gray-500 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-black">إجمالي التسليمات</span>
            <span className="text-base">📁</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-gray-800 dark:text-gray-200">
            {toEasternArabic(stats.total)}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold mt-0.5">
            كافة طلاب هذا الاختبار
          </div>
        </button>
      </div>

      {/* تنبيه سريع إذا كان هناك طلاب يحتاجون لتصحيح المقالي */}
      {stats.needsGrading > 0 && statusTab === 'ready' && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-2xl flex items-center justify-between gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <i className="fas fa-info-circle text-amber-600"></i>
            <span>يوجد {toEasternArabic(stats.needsGrading)} طالب بانتظار تصحيح المقالي أولاً.</span>
          </div>
          {onNavigateToEssayReview && (
            <button
              type="button"
              onClick={() => onNavigateToEssayReview(selectedQuizFilter !== 'all' ? selectedQuizFilter : undefined)}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] shrink-0 transition-all cursor-pointer active:scale-95"
            >
              تصحيح المقالي ✍️
            </button>
          )}
        </div>
      )}

      {/* 5. قائمة كروت الطلاب المخصصة للموبايل والكمبيوتر */}
      <div className="space-y-2.5">
        {filteredSubmissions.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center border border-dashed border-gray-300 dark:border-gray-700 space-y-2">
            <div className="text-3xl">🎯</div>
            <h3 className="text-sm sm:text-base font-black text-gray-700 dark:text-gray-300">
              لا توجد أوراق في هذا القسم حالياً
            </h3>
            <p className="text-xs text-gray-400">
              اختر قسماً آخر أو حدد امتحاناً مختلفاً من القائمة العلوية
            </p>
          </div>
        ) : (
          filteredSubmissions.map(sub => {
            const cat = getSubmissionCategory(sub);
            const isOnline = isSubOnline(sub);

            // حساب درجات الموضوعي والمقالي
            const mcqQs = sub.questions.filter(q => q.essayType === 'اختر من متعدد' || q.essayType === 'صح وخطأ');
            const essayQs = sub.questions.filter(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ');
            
            const mcqEarned = mcqQs.reduce((sum, q) => sum + (q.teacherScore || 0), 0);
            const essayEarned = essayQs.reduce((sum, q) => sum + (q.teacherScore || 0), 0);
            const totalEarned = sub.finalScore !== undefined ? sub.finalScore : (mcqEarned + essayEarned);
            const maxScore = sub.maxPossibleScore || 50;
            const perc = Math.round((totalEarned / Math.max(1, maxScore)) * 100);

            return (
              <div
                key={sub.id}
                className="bg-white dark:bg-gray-800 rounded-2xl p-3.5 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-xs hover:border-gray-300 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              >
                {/* بيانات الطالب الأساسية */}
                <div className="flex-1 min-w-0 w-full sm:w-auto">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-black text-sm sm:text-base text-gray-900 dark:text-white truncate">
                      {sub.studentName}
                    </span>
                    
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-md" dir="ltr">
                      {sub.studentPhone}
                    </span>

                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                      isOnline 
                        ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' 
                        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}>
                      {isOnline ? 'أونلاين' : 'سنتر'}
                    </span>

                    {/* بادج تصنيف الورقة */}
                    {cat === 'blank_or_pulled' && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 flex items-center gap-1">
                        ⚡ مقالي فارغ (جاهز فوراً)
                      </span>
                    )}

                    {cat === 'graded_ready' && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200 border border-purple-300 flex items-center gap-1">
                        ✍️ تم تصحيح المقالي
                      </span>
                    )}

                    {cat === 'needs_grading' && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200 border border-rose-300 flex items-center gap-1">
                        ⏳ بانتظار تصحيح المقالي
                      </span>
                    )}

                    {cat === 'already_approved' && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300 flex items-center gap-1">
                        ✅ معتمد ومنشور
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 font-bold flex-wrap">
                    <span className="text-primary font-black">
                      📖 {sub.quizTitle}
                    </span>
                    <span>
                      📅 {sub.submissionDate}
                    </span>
                  </div>
                </div>

                {/* كارت الدرجة المقترحة والمجموع */}
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/60 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 shrink-0 w-full sm:w-auto justify-between sm:justify-start">
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      موضوعي: <strong>{mcqEarned}</strong> • مقالي: <strong>{essayEarned}</strong>
                    </div>
                    <div className="text-sm font-black text-gray-900 dark:text-white">
                      المجموع: <span className="text-emerald-600 dark:text-emerald-400">{totalEarned}</span> من {maxScore} ({perc}%)
                    </div>
                  </div>
                </div>

                {/* أزرار التحكم والاعتماد بحجم مريح للموبايل وبدون نصوص طويلة */}
                <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto">
                  {!sub.isFullyApproved && (cat === 'blank_or_pulled' || cat === 'graded_ready') && (
                    <button
                      type="button"
                      onClick={() => handleApproveSingle(sub, true)}
                      className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-xs active:scale-95 cursor-pointer"
                      title="اعتماد ونشر النتيجة فوراً"
                    >
                      <i className="fas fa-check"></i>
                      <span>اعتماد</span>
                    </button>
                  )}

                  {cat === 'needs_grading' && (
                    <button
                      type="button"
                      onClick={() => setQuickEditSub(sub)}
                      className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-xs active:scale-95 cursor-pointer"
                      title="بدء تصحيح المقالي لهذا الطالب"
                    >
                      <i className="fas fa-file-pen"></i>
                      <span>تصحيح</span>
                    </button>
                  )}

                  {/* زر إعادة التصحيح المطلوب: متاح للطلاب المصححين أو المعتمدين لتعديل الدرجات ومراجعة المقالي */}
                  {(cat === 'graded_ready' || cat === 'already_approved' || (sub.questions && sub.questions.some(q => q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ'))) && (
                    <button
                      type="button"
                      onClick={() => setQuickEditSub(sub)}
                      className="flex-1 sm:flex-initial px-3 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer"
                      title="إعادة فحص وتصحيح المقالي وتعديل الدرجات لهذا الطالب"
                    >
                      <i className="fas fa-feather-alt text-amber-500"></i>
                      <span>إعادة التصحيح</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setRetakeModalSub(sub)}
                    className="p-2.5 rounded-xl bg-gray-100 hover:bg-amber-100 dark:bg-gray-700 text-gray-600 hover:text-amber-700 font-black text-xs transition-colors cursor-pointer"
                    title="منح إعادة المحاولة للطالب"
                  >
                    <i className="fas fa-redo-alt"></i>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 6. نافذة تأكيد الاعتماد الجماعي */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-[999999] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl border-t-8 border-emerald-600 text-right space-y-4 animate-scale-up">
            <div className="flex items-center gap-3 border-b pb-3 dark:border-gray-700">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl shrink-0">
                🎯
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                  تأكيد اعتماد النتائج
                </h3>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  {toEasternArabic(stats.totalReady)} طالب جاهز للاعتماد
                </p>
              </div>
            </div>

            <p className="text-xs font-bold text-gray-600 dark:text-gray-300 leading-relaxed">
              سيتم اعتماد درجات جميع هؤلاء الطلاب ونشرها فوراً في شيت النتائج وفك حظر الامتحان عنهم.
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={processingBatch}
                onClick={() => handleApproveBatch(true)}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <i className="fas fa-check-circle"></i>
                <span>اعتماد مع إتاحة بنك الأخطاء</span>
              </button>

              <button
                type="button"
                disabled={processingBatch}
                onClick={() => handleApproveBatch(false)}
                className="w-full py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>اعتماد فقط (حجب بنك الأخطاء)</span>
              </button>

              <button
                type="button"
                disabled={processingBatch}
                onClick={() => setBatchModalOpen(false)}
                className="w-full py-2 rounded-xl text-gray-500 hover:text-gray-700 font-bold text-xs transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. نافذة منح إعادة لطالب */}
      {retakeModalSub && (
        <div className="fixed inset-0 z-[999999] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl border-t-8 border-indigo-600 text-right space-y-4 animate-scale-up">
            <div className="flex items-center gap-3 border-b pb-3 dark:border-gray-700">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl shrink-0">
                🔄
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                  منح إذن إعادة للطالب
                </h3>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  {retakeModalSub.studentName}
                </p>
              </div>
            </div>

            <p className="text-xs font-bold text-gray-600 dark:text-gray-300">
              اختر نوع الإعادة للامتحان:
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleGrantRetake(retakeModalSub, 'full')}
                className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center justify-between shadow-sm cursor-pointer"
              >
                <span>إعادة الامتحان بالكامل 🔄</span>
                <i className="fas fa-arrow-left text-xs opacity-70"></i>
              </button>

              <button
                type="button"
                onClick={() => handleGrantRetake(retakeModalSub, 'essay_only')}
                className="w-full py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-black text-xs flex items-center justify-between border border-indigo-200 cursor-pointer"
              >
                <span>إعادة المقالي فقط مع حفظ الاختياري ✍️</span>
                <i className="fas fa-arrow-left text-xs opacity-70"></i>
              </button>

              <button
                type="button"
                onClick={() => setRetakeModalSub(null)}
                className="w-full py-2 rounded-xl text-gray-500 font-bold text-xs"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 8. نافذة فحص وإعادة تصحيح إجابات الطالب المقالية مباشرة */}
      {quickEditSub && (
        <StudentEssayReviewModal
          submission={quickEditSub}
          data={data}
          isDarkMode={isDarkMode}
          onClose={() => setQuickEditSub(null)}
          onSaveApproved={(updated) => {
            savePendingEssaySubmission(updated);
            syncGradeToCloud(updated);
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
            setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));
            setQuickEditSub(null);
            showToast(`✅ تم اعتماد وتحديث درجات: ${updated.studentName}`);
          }}
          onSaveDraft={(updated) => {
            savePendingEssaySubmission(updated);
            syncDraftToCloud(updated);
            setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));
            setQuickEditSub(null);
            showToast(`💾 تم حفظ درجات ${updated.studentName} كمسودة بنجاح`);
          }}
          onRequestRetake={(sub) => {
            setQuickEditSub(null);
            setRetakeModalSub(sub);
          }}
        />
      )}
    </div>
  );
};
