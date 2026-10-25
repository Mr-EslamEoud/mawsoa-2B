import React, { useState, useMemo, useEffect } from 'react';
import { StudentEssaySubmission, EssayReviewQuestionItem, Unit } from '../types';
import { 
  getPendingEssaySubmissions, 
  savePendingEssaySubmission, 
  getExamConfig, 
  calculateExamStructure 
} from '../examConfigUtils';
import { HighlightText } from './HighlightText';
import { FormatQuestionText } from './FormatQuestionText';
import { compareStudentWithModelAnswer, EssayDiffComparison } from '../aiEvaluationService';
import { toEasternArabic } from '../utils';

interface AdminEssayReviewTabProps {
  onSaveResultToDB?: (result: { quizName: string; score: string; studentName?: string; studentPhone?: string }) => void;
  isDarkMode?: boolean;
  onlineStudents?: any[];
  data?: Unit[];
  initialSelectedQuiz?: string;
  onNavigateToApproval?: () => void;
}

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

  // تحديث قائمة التسليمات
  const refreshSubmissions = () => {
    const list = getPendingEssaySubmissions();
    setSubmissions(list);
  };

  useEffect(() => {
    refreshSubmissions();
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
      const matchQuiz = selectedQuizFilter === 'all' ? true : (sub.quizTitle === selectedQuizFilter || sub.lessonId === selectedQuizFilter);

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

  // اعتماد وإعلان نتائج امتحان بالكامل دفعة واحدة بنقرة واحدة
  const handleApproveQuizBatch = (grp: { quizTitle: string; pendingCount: number; submissions: StudentEssaySubmission[] }) => {
    const pendingList = grp.submissions.filter(s => !s.isFullyApproved);
    if (pendingList.length === 0) {
      showToast('جميع درجات هذا الامتحان معتمدة بالفعل.');
      return;
    }

    if (!window.confirm(`هل أنت متأكد من اعتماد وإعلان نتائج امتحان:\n"${grp.quizTitle}"\nلجميع الطلاب المعلقين (${pendingList.length} طالب) دفعة واحدة؟\nسيتمكن الطلاب من رؤية درجاتهم فوراً.`)) {
      return;
    }

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
        finalScore: earnedEssay,
      };

      savePendingEssaySubmission(updatedSub);

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
    showToast(`🎉 تم اعتماد وإعلان نتائج امتحان "${grp.quizTitle}" بنجاح!`);
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

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden animate-fade-in" dir="rtl">
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
                            setPreviousQuizView('pending');
                            setMainView('students');
                          }}
                          className="flex-1 bg-primary hover:bg-primary-dark text-white font-black py-2.5 px-3 rounded-xl text-xs sm:text-sm shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <i className="fas fa-pen-nib"></i>
                          <span>تصحيح طلاب هذا الامتحان ({toEasternArabic(grp.totalCount)})</span>
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
                          setPreviousQuizView('archive');
                          setMainView('students');
                        }}
                        className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-black py-2.5 px-3 rounded-xl text-xs sm:text-sm shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <i className="fas fa-eye"></i>
                        <span>استعراض سجل طلاب هذا الامتحان ({toEasternArabic(grp.totalCount)})</span>
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
                          onClick={() => handleDeleteSubmission(sub.id)}
                          className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-rose-100 text-gray-400 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                          title="حذف"
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

      {/* نافذة تفاصيل فحص وتصحيح إجابات الطالب الفردي */}
      {selectedSubForReview && (
        <StudentEssayReviewModal
          key={selectedSubForReview.id}
          submission={selectedSubForReview}
          hasNextPending={!!nextPendingSub}
          onClose={() => setSelectedSubForReview(null)}
          onSaveApprovedAndNext={(updated) => {
            savePendingEssaySubmission(updated);
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
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
};

// -------------------------------------------------------------
// نافذة فحص ومراجعة إجابات الطالب الواحد (Modal)
// -------------------------------------------------------------

interface StudentEssayReviewModalProps {
  submission: StudentEssaySubmission;
  onClose: () => void;
  onSaveApproved: (updated: StudentEssaySubmission) => void;
  onSaveDraft?: (updated: StudentEssaySubmission) => void;
  onSaveApprovedAndNext?: (updated: StudentEssaySubmission) => void;
  hasNextPending?: boolean;
  isDarkMode?: boolean;
}

const StudentEssayReviewModal: React.FC<StudentEssayReviewModalProps> = ({
  submission,
  onClose,
  onSaveApproved,
  onSaveDraft,
  onSaveApprovedAndNext,
  hasNextPending = false,
  isDarkMode = false,
}) => {
  const [questions, setQuestions] = useState<EssayReviewQuestionItem[]>(() => {
    return submission.questions.map(q => {
      const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
      return {
        ...q,
        teacherScore: q.teacherScore !== undefined 
          ? q.teacherScore 
          : (q.aiScore !== undefined 
              ? q.aiScore 
              : (hasNoText ? 0 : q.maxScore)),
        teacherFeedback: q.teacherFeedback || q.aiFeedback || (hasNoText ? 'لم يكتب الطالب إجابة لهذا السؤال.' : ''),
      };
    });
  });

  // حالات المقارنة الذكية وتحليل الفروق (AI Diff)
  const [diffComparisons, setDiffComparisons] = useState<Record<number, EssayDiffComparison>>({});
  const [diffLoading, setDiffLoading] = useState<Record<number, boolean>>({});
  const [diffOpen, setDiffOpen] = useState<Record<number, boolean>>({});

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
    const feedbackText = `${diff.verdictSummary} (${diff.styleNote})`;
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

  const totalEarnedScore = useMemo(() => {
    return questions.reduce((sum, q) => sum + (Number(q.teacherScore) || 0), 0);
  }, [questions]);

  const totalMaxScore = useMemo(() => {
    return questions.reduce((sum, q) => sum + (Number(q.maxScore) || 0), 0);
  }, [questions]);

  const handleApproveAndPublish = () => {
    const updated: StudentEssaySubmission = {
      ...submission,
      questions: questions.map(q => ({ ...q, isApproved: true })),
      isFullyApproved: true,
      finalScore: totalEarnedScore,
    };
    onSaveApproved(updated);
  };

  const handleApproveAndNext = () => {
    const updated: StudentEssaySubmission = {
      ...submission,
      questions: questions.map(q => ({ ...q, isApproved: true })),
      isFullyApproved: true,
      finalScore: totalEarnedScore,
    };
    if (onSaveApprovedAndNext) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in overflow-y-auto" dir="rtl">
      <div className={`w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden my-auto border-2 flex flex-col max-h-[95vh] ${
        isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-primary/30 text-gray-800'
      }`}>
        {/* رأس النافذة */}
        <div className="p-4 sm:p-5 border-b flex items-center justify-between gap-3 bg-gradient-to-l from-indigo-50/80 via-white to-blue-50/60 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg sm:text-xl font-black text-primary">
                فحص وتصحيح إجابات الطالب: {submission.studentName}
              </h3>
              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md" dir="ltr">
                {submission.studentPhone}
              </span>
            </div>
            <p className="text-xs text-gray-500 font-bold mt-0.5">
              {submission.quizTitle} • تاريخ التسليم: {submission.submissionDate}
            </p>
          </div>

          <button 
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
          >
            <i className="fas fa-times text-base"></i>
          </button>
        </div>

        {/* شريط حالة الاعتماد والتعديل */}
        <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 text-xs font-bold ${
          submission.isFullyApproved
            ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
            : 'bg-amber-50 text-amber-900 border-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            <i className={`fas ${submission.isFullyApproved ? 'fa-check-circle text-emerald-600' : 'fa-hourglass-half text-amber-600'} text-sm`}></i>
            <span>
              {submission.isFullyApproved
                ? 'هذه النتيجة معتمدة مسبقاً. يمكنك في أي وقت تعديل الدرجات (إضافة درجات بونص أو خصمها)، وتحديث الملاحظات وحفظ التعديلات فوراً.'
                : 'هذا الاختبار بانتظار الاعتماد. يمكنك استخدام زر المقارنة الذكية لتحليل الفروق وتحديد الدرجة العادلة.'}
            </span>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black shrink-0 ${
            submission.isFullyApproved ? 'bg-emerald-200 text-emerald-950' : 'bg-amber-200 text-amber-950'
          }`}>
            {submission.isFullyApproved ? 'وضع المراجعة والتعديل ✏️' : 'اعتماد جديد 🚀'}
          </span>
        </div>

        {/* محتوى الأسئلة والإجابات */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-sm">
          {questions.map((q, idx) => {
            const hasNoText = !q.studentText || q.studentText.trim() === '' || q.studentText.includes('لم يكتب') || q.studentText.includes('لم يتم الإجابة');
            const studentWordCount = q.studentText && !hasNoText ? q.studentText.trim().split(/\s+/).length : 0;
            const isDiffReady = !!diffComparisons[idx];
            const isDiffBusy = !!diffLoading[idx];
            const isDiffExpanded = !!diffOpen[idx];

            return (
              <div key={idx} className="p-4 sm:p-5 rounded-2xl border-2 border-gray-200 bg-gray-50/50 space-y-3.5 transition-all">
                {/* رأس السؤال */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-lg border border-amber-300">
                      🏷️ {q.essayType}
                    </span>
                    <span className="font-black text-gray-700 text-xs">سؤال #{idx + 1}</span>
                  </div>
                  <span className="text-xs font-bold text-gray-500">
                    الدرجة العظمى: {q.maxScore} درجات
                  </span>
                </div>

                {/* رأس السؤال المطلوب */}
                <div className="bg-gradient-to-r from-indigo-50/70 via-blue-50/40 to-slate-50 border-2 border-indigo-200 rounded-xl p-3.5 text-xs sm:text-sm leading-relaxed shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-indigo-100">
                    <span className="font-black text-indigo-950 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center text-[10px] shadow-xs">
                        <i className="fas fa-question"></i>
                      </span>
                      <span>رأس السؤال المطلوب:</span>
                    </span>
                    {q.essayType && (
                      <span className="text-[11px] font-black text-indigo-800 bg-indigo-100/90 px-2.5 py-0.5 rounded-md border border-indigo-200">
                        🎯 {q.essayType}
                      </span>
                    )}
                  </div>
                  <div className="text-sm sm:text-base font-bold text-gray-900 leading-relaxed">
                    <FormatQuestionText text={q.questionText} isDarkMode={isDarkMode} />
                  </div>
                </div>

                {/* نموذج الإجابة المعتمد */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs leading-relaxed">
                  <span className="font-black text-emerald-950 block mb-1">
                    <i className="fas fa-clipboard-check text-emerald-600 ml-1"></i> نموذج الإجابة المعتمد:
                  </span>
                  <div className="font-bold text-emerald-900 whitespace-pre-line">
                    <HighlightText text={q.modelAnswer || 'لا يوجد نموذج إجابة مسجل'} isDarkMode={isDarkMode} />
                  </div>
                </div>

                {/* ما كتبه الطالب */}
                <div className="bg-white border-2 border-indigo-200 rounded-xl p-3.5 text-xs sm:text-sm leading-relaxed shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-1.5 border-b border-indigo-50 pb-1">
                    <span className="font-black text-indigo-950 flex items-center gap-1.5">
                      <i className="fas fa-user-edit text-indigo-600"></i> إجابة الطالب الفعلية:
                    </span>
                    {!hasNoText && (
                      <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {studentWordCount} كلمة • {q.studentText.length} حرف
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-gray-800 whitespace-pre-line leading-relaxed">
                    {!hasNoText ? (
                      q.studentText
                    ) : (
                      <span className="text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200 inline-block">
                        ⚠️ لم يكتب الطالب إجابة لهذا السؤال (إجابة فارغة)
                      </span>
                    )}
                  </p>
                </div>

                {/* زر المقارنة الذكية وتحليل الفروق */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleTriggerDiff(idx, q)}
                    disabled={isDiffBusy}
                    className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-xs active:scale-95 cursor-pointer ${
                      isDiffExpanded
                        ? 'bg-indigo-700 text-white shadow-indigo-200'
                        : 'bg-gradient-to-l from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 text-indigo-900 border-2 border-indigo-200'
                    }`}
                  >
                    <i className={isDiffBusy ? "fas fa-spinner fa-spin text-amber-500" : "fas fa-code-compare text-indigo-600"}></i>
                    <span>{isDiffExpanded ? 'إخفاء المقارنة الذكية' : '🔍 مقارنة ذكية وتحليل الفروق (AI Diff)'}</span>
                    {!isDiffExpanded && (
                      <span className="text-[10px] bg-indigo-200/70 text-indigo-900 px-1.5 py-0.5 rounded-md font-bold">
                        يوضح الفروق وتطابق النموذج ⚡
                      </span>
                    )}
                  </button>

                  {isDiffReady && !isDiffExpanded && (
                    <span className="text-xs font-bold text-gray-600 bg-white px-2.5 py-1 rounded-lg border border-gray-200 shadow-2xs">
                      اقتراح المقارنة: <strong className="text-indigo-700 font-black">{diffComparisons[idx].suggestedScore}</strong> من {q.maxScore}
                    </span>
                  )}
                </div>

                {/* لوحة المقارنة الذكية التفاعلية (AI Diff Panel) */}
                {isDiffExpanded && (
                  <div className="bg-gradient-to-br from-indigo-50/90 via-white to-purple-50/70 border-2 border-indigo-300 rounded-2xl p-4 space-y-3.5 shadow-sm animate-fade-in">
                    <div className="flex items-center justify-between border-b border-indigo-200/80 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs shadow-xs">
                          <i className="fas fa-robot"></i>
                        </span>
                        <span className="font-black text-indigo-950 text-xs sm:text-sm">
                          تحليل الفروق والمقارنة الذكية بين إجابة الطالب ونموذج الإجابة:
                        </span>
                      </div>
                      {diffComparisons[idx]?.provider && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                          {diffComparisons[idx].provider === 'gemini' ? 'Google Gemini AI ⚡' : 'المحلل الذكي المدمج 🧠'}
                        </span>
                      )}
                    </div>

                    {isDiffBusy ? (
                      <div className="py-6 text-center text-indigo-600 font-bold text-xs flex flex-col items-center gap-2">
                        <i className="fas fa-spinner fa-spin text-2xl text-indigo-500"></i>
                        <span>جاري فحص وتدقيق الفروق ومقارنة إجابة الطالب بنموذج الإجابة...</span>
                      </div>
                    ) : diffComparisons[idx] ? (
                      <div className="space-y-3 text-xs">
                        {/* خلاصة التقييم الموجهة للمعلم */}
                        <div className="bg-white/95 p-3 rounded-xl border border-indigo-200 text-indigo-950 font-bold leading-relaxed flex items-start gap-2 shadow-2xs">
                          <i className="fas fa-lightbulb text-amber-500 text-sm mt-0.5 shrink-0"></i>
                          <div>
                            <strong className="block text-indigo-900 mb-0.5">خلاصة تقرير المصحح الذكي:</strong>
                            {diffComparisons[idx].verdictSummary}
                          </div>
                        </div>

                        {/* نقاط التطابق والنقاط المفقودة جنباً إلى جنب */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* نقاط القوة والتطابق */}
                          <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl p-3">
                            <span className="font-black text-emerald-950 flex items-center gap-1.5 mb-2">
                              <i className="fas fa-check-circle text-emerald-600"></i> ما استوفاه الطالب بنجاح:
                            </span>
                            {diffComparisons[idx].matchedPoints.length === 0 ? (
                              <p className="text-gray-500 font-normal">لم يتم استيفاء عناصر واضحة من النموذج.</p>
                            ) : (
                              <ul className="space-y-1.5 text-[11px] font-bold text-emerald-900 pr-4 list-disc">
                                {diffComparisons[idx].matchedPoints.map((pt, pIdx) => (
                                  <li key={pIdx} className="leading-relaxed">{pt}</li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {/* العناصر الناقصة أو المفقودة */}
                          <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3">
                            <span className="font-black text-amber-950 flex items-center gap-1.5 mb-2">
                              <i className="fas fa-triangle-exclamation text-amber-600"></i> عناصر ناقصة أو مفقودة:
                            </span>
                            {diffComparisons[idx].missingPoints.length === 0 ? (
                              <p className="text-gray-500 font-normal">أورد الطالب جميع العناصر المطلوبة دون نقص.</p>
                            ) : (
                              <ul className="space-y-1.5 text-[11px] font-bold text-amber-900 pr-4 list-disc">
                                {diffComparisons[idx].missingPoints.map((pt, pIdx) => (
                                  <li key={pIdx} className="leading-relaxed">{pt}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        {/* تحليل الصياغة والأسلوب */}
                        {diffComparisons[idx].styleNote && (
                          <div className="bg-blue-50/90 border border-blue-200 rounded-xl p-2.5 text-[11px] text-blue-950 font-bold flex items-center gap-2">
                            <i className="fas fa-pen-fancy text-blue-600 text-xs shrink-0"></i>
                            <span><strong>الصياغة والأسلوب:</strong> {diffComparisons[idx].styleNote}</span>
                          </div>
                        )}

                        {/* توصية الدرجة وزر التطبيق التلقائي */}
                        <div className="bg-white p-3 rounded-xl border border-indigo-200 flex flex-wrap items-center justify-between gap-2.5 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-gray-700">الدرجة المقترحة من المقارنة:</span>
                            <span className="text-sm font-black text-indigo-700 bg-indigo-50 border border-indigo-300 px-2.5 py-0.5 rounded-lg">
                              {diffComparisons[idx].suggestedScore} من {q.maxScore}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleApplyDiffSuggestion(idx, diffComparisons[idx])}
                            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black text-xs transition-all shadow-xs active:scale-95 flex items-center gap-1.5 cursor-pointer"
                          >
                            <i className="fas fa-wand-magic-sparkles"></i>
                            تطبيق الدرجة والملاحظة بنقرة واحدة ⚡
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* تقييم الذكاء الاصطناعي الأولي إن توفر */}
                {q.aiFeedback && (
                  <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-black text-indigo-900 flex items-center gap-1">
                        🤖 تقييم الذكاء الاصطناعي المسجل لحظة التسليم:
                      </span>
                      <span className="font-black text-indigo-700 bg-white px-2 py-0.5 rounded-md border border-indigo-200">
                        الدرجة المقترحة: {q.aiScore} من {q.maxScore}
                      </span>
                    </div>
                    <p className="text-gray-700 font-bold leading-relaxed">{q.aiFeedback}</p>
                  </div>
                )}

                {/* شريط التحكم التفاعلي بالدرجة والملاحظة (إضافة أو إنقاص درجات وتعديل الملاحظات) */}
                <div className="bg-white border-2 border-gray-300 rounded-2xl p-4 space-y-3 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="font-black text-gray-900 text-xs sm:text-sm">
                        الدرجة المعتمدة للطالب:
                      </label>

                      {/* أزرار Stepper التفاعلية (-0.25 / +0.25) بنظام النسبة والتناسب */}
                      <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl border border-gray-200">
                        <button
                          type="button"
                          onClick={() => handleScoreChange(idx, Math.max(0, (Number(q.teacherScore) || 0) - 0.25))}
                          className="w-8 h-8 rounded-lg bg-white hover:bg-rose-50 hover:text-rose-600 text-gray-700 font-black text-sm border border-gray-200 shadow-xs flex items-center justify-center transition-all active:scale-90 cursor-pointer"
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
                          className="w-16 h-8 text-center font-black text-sm border border-primary/40 rounded-lg bg-white text-primary outline-none focus:ring-2 focus:ring-primary shadow-inner"
                        />

                        <button
                          type="button"
                          onClick={() => handleScoreChange(idx, (Number(q.teacherScore) || 0) + 0.25)}
                          className="w-8 h-8 rounded-lg bg-white hover:bg-emerald-50 hover:text-emerald-600 text-gray-700 font-black text-sm border border-gray-200 shadow-xs flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                          title="إضافة ربع درجة (+0.25)"
                        >
                          +¼
                        </button>
                      </div>

                      <span className="text-xs font-bold text-gray-500">
                        من {q.maxScore} درجات
                      </span>

                      {Number(q.teacherScore) > q.maxScore && (
                        <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                          🌟 درجة إضافية (بونص +{(Number(q.teacherScore) - q.maxScore).toFixed(2)})
                        </span>
                      )}
                    </div>

                    {/* أزرار الدرجات السريعة بنقرة واحدة */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-black text-gray-400 ml-1">تعيين سريع:</span>
                      {[0, 0.5, 1, 1.5, 2].filter(s => s <= q.maxScore).map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => handleScoreChange(idx, val)}
                          className={`px-2 py-1 rounded-lg text-xs font-black transition-all border cursor-pointer ${
                            q.teacherScore === val
                              ? 'bg-primary text-white border-primary shadow-xs scale-105'
                              : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handleScoreChange(idx, (Number(q.teacherScore) || 0) + 0.25)}
                        className="px-2 py-1 rounded-lg text-xs font-black transition-all border bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200 cursor-pointer"
                        title="إضافة ربع درجة (+0.25)"
                      >
                        +0.25
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScoreChange(idx, (Number(q.teacherScore) || 0) + 0.5)}
                        className="px-2 py-1 rounded-lg text-xs font-black transition-all border bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 cursor-pointer"
                        title="إضافة نصف درجة (+0.5)"
                      >
                        +0.5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScoreChange(idx, q.maxScore + 0.5)}
                        className="px-2 py-1 rounded-lg text-xs font-black transition-all border bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 cursor-pointer"
                        title="إضافة نصف درجة بونص فوق الدرجة الكاملة"
                      >
                        بونص ⭐
                      </button>
                    </div>
                  </div>

                  {/* حقل الملاحظة وقوالب الملاحظات الجاهزة */}
                  <div>
                    <input
                      type="text"
                      placeholder="ملاحظتك للطالب على هذا السؤال..."
                      value={q.teacherFeedback || ''}
                      onChange={e => handleFeedbackChange(idx, e.target.value)}
                      className="w-full p-2.5 text-xs font-bold border border-gray-300 rounded-xl outline-none focus:ring-1 focus:ring-primary bg-gray-50/50"
                    />

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-[10px] font-black text-gray-400">قوالب سريعة:</span>
                      {[
                        "إجابة نموذجية ومكتملة العناصر 🌟",
                        "ممتاز ولكن ينقصك ذكر الشواهد والأسباب التاريخية 💡",
                        "إجابة ناقصة، راجع نموذج الوزارة المعتمد ⚠️",
                        "مجهود طيب مع مراعاة دقة الصياغة بالفصحى 👍",
                        "تمت مراجعة الإجابة وتعديل الدرجة 🎯"
                      ].map((template, tIdx) => (
                        <button
                          key={tIdx}
                          type="button"
                          onClick={() => handleFeedbackChange(idx, template)}
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 hover:bg-indigo-100 text-gray-700 hover:text-indigo-800 transition-colors border border-gray-200 cursor-pointer"
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

        {/* تذييل النافذة ومجموع الدرجات والاعتماد */}
        <div className="p-4 border-t flex flex-wrap items-center justify-between gap-3 bg-gray-50 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-black text-gray-600">مجموع درجات المقالي المعتمدة:</span>
            <span className="text-lg font-black text-primary bg-primary/10 px-3 py-1 rounded-xl">
              {totalEarnedScore} من {totalMaxScore} درجة
            </span>
          </div>

          <div className="flex items-center gap-2 mr-auto">
            {submission.studentPhone && (
              <button
                type="button"
                onClick={() => {
                  const phone = submission.studentPhone.replace(/[^\d]/g, '');
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
              className="px-4 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs cursor-pointer transition-colors"
            >
              إلغاء
            </button>

            {!submission.isFullyApproved && (
              <button
                type="button"
                onClick={handleSaveAsDraft}
                className="px-4 sm:px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                title="حفظ الدرجات والملاحظات دون إعلان النتيجة للطالب الآن"
              >
                <i className="fas fa-bookmark text-purple-200"></i>
                <span>حفظ كمسودة 💾</span>
              </button>
            )}

            {hasNextPending && (
              <button
                type="button"
                onClick={handleApproveAndNext}
                className="px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
                title="اعتماد درجات هذا الطالب والانتقال المباشر للطالب التالي دون إغلاق النافذة"
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
        </div>

      </div>
    </div>
  );
};
