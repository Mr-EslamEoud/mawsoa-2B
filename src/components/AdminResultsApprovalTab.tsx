import React, { useState, useMemo, useEffect } from 'react';
import { StudentEssaySubmission, Unit } from '../types';
import { getPendingEssaySubmissions, savePendingEssaySubmission } from '../examConfigUtils';

interface AdminResultsApprovalTabProps {
  data?: Unit[];
  onSaveResultToDB?: (result: { quizName: string; score: string; studentName?: string; studentPhone?: string }) => void;
  onNavigateToReview?: (quizTitle: string) => void;
  isDarkMode?: boolean;
  onlineStudents?: any[];
}

interface QuizGroupData {
  quizTitle: string;
  lessonId: string;
  unitTitle?: string;
  submissions: StudentEssaySubmission[];
  totalCount: number;
  approvedCount: number;
  pendingCount: number;
  draftCount: number;
  onlineCount: number;
  centerCount: number;
  avgScorePerc: number;
  isFullyApproved: boolean;
}

export const AdminResultsApprovalTab: React.FC<AdminResultsApprovalTabProps> = ({
  data = [],
  onSaveResultToDB,
  onNavigateToReview,
  isDarkMode = false,
  onlineStudents = [],
}) => {
  const [submissions, setSubmissions] = useState<StudentEssaySubmission[]>([]);
  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const [expandedQuizId, setExpandedQuizId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const refreshSubmissions = () => {
    const list = getPendingEssaySubmissions();
    setSubmissions(list);
  };

  useEffect(() => {
    refreshSubmissions();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

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

  // استخراج قائمة الوحدات
  const availableUnits = useMemo(() => {
    const list: { id: string; title: string }[] = [];
    if (data && data.length > 0) {
      data.forEach(u => list.push({ id: u.id, title: u.title }));
    }
    return list;
  }, [data]);

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

  // تجميع التسليمات حسب الامتحان
  const quizGroups = useMemo(() => {
    const map = new Map<string, QuizGroupData>();

    submissions.forEach(sub => {
      const key = sub.quizTitle || sub.lessonId || 'اختبار عام';
      if (!map.has(key)) {
        const unitTitle = findUnitForQuiz(sub.lessonId, sub.quizTitle);
        map.set(key, {
          quizTitle: sub.quizTitle || key,
          lessonId: sub.lessonId,
          unitTitle,
          submissions: [],
          totalCount: 0,
          approvedCount: 0,
          pendingCount: 0,
          draftCount: 0,
          onlineCount: 0,
          centerCount: 0,
          avgScorePerc: 0,
          isFullyApproved: true,
        });
      }

      const grp = map.get(key)!;
      grp.submissions.push(sub);
      grp.totalCount++;

      const isApproved = sub.isFullyApproved;
      if (isApproved) {
        grp.approvedCount++;
      } else {
        grp.pendingCount++;
        // فحص هل وضع المعلم درجات كمسودة
        const hasDraftScores = sub.questions.some(q => q.teacherScore !== undefined);
        if (hasDraftScores) {
          grp.draftCount++;
        }
      }

      if (isSubOnline(sub)) {
        grp.onlineCount++;
      } else {
        grp.centerCount++;
      }
    });

    const result: QuizGroupData[] = [];
    map.forEach(grp => {
      grp.isFullyApproved = grp.totalCount > 0 && grp.pendingCount === 0;

      // حساب متوسط درجات الامتحان
      let totalPerc = 0;
      grp.submissions.forEach(s => {
        const maxScore = s.maxPossibleScore || 50;
        const earned = s.finalScore ?? s.questions.reduce((sum, q) => sum + (q.teacherScore ?? q.aiScore ?? 0), 0);
        totalPerc += Math.min(100, Math.round((earned / Math.max(1, maxScore)) * 100));
      });
      grp.avgScorePerc = grp.totalCount > 0 ? Math.round(totalPerc / grp.totalCount) : 0;

      result.push(grp);
    });

    return result.sort((a, b) => {
      // الامتحانات المعلقة أولاً
      if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
      if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
      return b.totalCount - a.totalCount;
    });
  }, [submissions, data, onlineStudents]);

  // فلترة مجموعات الامتحانات
  const filteredQuizGroups = useMemo(() => {
    return quizGroups.filter(grp => {
      // فلتر الوحدة
      if (selectedUnitFilter !== 'all') {
        const matchesUnit = grp.unitTitle === selectedUnitFilter || 
          data.find(u => u.id === selectedUnitFilter)?.lessons.some(l => l.id === grp.lessonId || l.title === grp.quizTitle);
        if (!matchesUnit) return false;
      }

      // فلتر حالة النتيجة
      if (statusFilter === 'pending' && grp.isFullyApproved) return false;
      if (statusFilter === 'approved' && !grp.isFullyApproved) return false;

      // بحث بالاسم
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchTitle = grp.quizTitle.toLowerCase().includes(q);
        const matchUnit = (grp.unitTitle || '').toLowerCase().includes(q);
        const matchStudent = grp.submissions.some(s => 
          s.studentName.toLowerCase().includes(q) || s.studentPhone.includes(q)
        );
        if (!matchTitle && !matchUnit && !matchStudent) return false;
      }

      return true;
    });
  }, [quizGroups, selectedUnitFilter, statusFilter, searchQuery, data]);

  // إحصائيات عامة
  const stats = useMemo(() => {
    const totalQuizzes = quizGroups.length;
    const fullyApprovedQuizzes = quizGroups.filter(g => g.isFullyApproved).length;
    const pendingQuizzes = totalQuizzes - fullyApprovedQuizzes;
    const totalSubmissions = submissions.length;
    const totalPendingStudents = submissions.filter(s => !s.isFullyApproved).length;
    const totalApprovedStudents = submissions.filter(s => s.isFullyApproved).length;
    return {
      totalQuizzes,
      fullyApprovedQuizzes,
      pendingQuizzes,
      totalSubmissions,
      totalPendingStudents,
      totalApprovedStudents,
    };
  }, [quizGroups, submissions]);

  // اعتماد وإعلان نتائج امتحان بالكامل دفعة واحدة
  const handleApproveQuizBatch = (grp: QuizGroupData) => {
    const count = grp.pendingCount;
    if (count === 0) {
      showToast('جميع درجات هذا الامتحان معتمدة ومعلنة بالفعل للطلاب.');
      return;
    }

    const confirmMsg = `هل أنت متأكد من اعتماد وإعلان نتائج امتحان:\n"${grp.quizTitle}"\nلجميع الطلاب (عدد الطلاب المعلق: ${count}) دفعة واحدة؟\nسيتمكن الطلاب من رؤية درجاتهم فوراً.`;
    if (!window.confirm(confirmMsg)) return;

    grp.submissions.forEach(sub => {
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
    showToast(`🎉 تم اعتماد وإعلان نتائج امتحان "${grp.quizTitle}" لجميع الطلاب بنجاح!`);
  };

  // اعتماد وإعلان جميع الامتحانات دفعة واحدة (Bulk All)
  const handleApproveAllQuizzesGlobal = () => {
    if (stats.totalPendingStudents === 0) {
      showToast('جميع النتائج معتمدة ومعلنة بالفعل لجميع الامتحانات.');
      return;
    }

    const confirmMsg = `⚠️ إجراء جماعي شامل:\nهل أنت متأكد من اعتماد وإعلان جميع الامتحانات المعلقة لجميع الطلاب (${stats.totalPendingStudents} طالب) دفعة واحدة؟`;
    if (!window.confirm(confirmMsg)) return;

    submissions.filter(s => !s.isFullyApproved).forEach(sub => {
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
    showToast(`🚀 تم اعتماد وإعلان جميع الامتحانات لجميع الطلاب بنجاح!`);
  };

  // حجب وإلغاء اعتماد الامتحان (إعادته لمسودة)
  const handleUnapproveQuizBatch = (grp: QuizGroupData) => {
    if (!window.confirm(`هل تريد حجب نتائج امتحان "${grp.quizTitle}" مؤقتاً عن الطلاب لإعادة التدقيق والمراجعة؟`)) return;

    grp.submissions.forEach(sub => {
      const updatedSub: StudentEssaySubmission = {
        ...sub,
        isFullyApproved: false,
      };
      savePendingEssaySubmission(updatedSub);
    });

    refreshSubmissions();
    showToast(`🔒 تم حجب نتائج امتحان "${grp.quizTitle}" وإعادتها لمسودة.`);
  };

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden animate-fade-in" dir="rtl">
      {/* رأس التبويب */}
      <div className="bg-gradient-to-l from-emerald-50/90 via-white to-blue-50/60 p-4 sm:p-5 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-black text-primary flex items-center gap-2">
            <i className="fas fa-bullhorn text-emerald-600"></i> اعتماد وإعلان نتائج الامتحانات 📢
          </h2>
          <p className="text-xs text-gray-500 font-bold mt-1">
            تابع كل امتحان على حدة، راجع أداء الطلاب ومسودات التصحيح، واعتمد درجات الامتحان بالكامل دفعة واحدة للطلاب.
          </p>
        </div>

        {stats.totalPendingStudents > 0 && (
          <button
            type="button"
            onClick={handleApproveAllQuizzesGlobal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <i className="fas fa-sparkles text-yellow-300"></i>
            اعتماد وإعلان كل الامتحانات المعلقة ({stats.totalPendingStudents})
          </button>
        )}
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* إشعار التأكيد */}
        {toastMessage && (
          <div className="p-3 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 animate-fade-in">
            <i className="fas fa-check-circle text-emerald-600"></i>
            {toastMessage}
          </div>
        )}

        {/* كروت الإحصائيات الشاملة */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3.5 text-center">
            <span className="text-xs font-bold text-indigo-700 block mb-1">📚 إجمالي الامتحانات</span>
            <span className="text-2xl font-black text-indigo-900">{stats.totalQuizzes}</span>
          </div>

          <div 
            onClick={() => setStatusFilter('pending')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'pending' ? 'bg-amber-50 border-amber-400 shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-amber-700 block mb-1">⏳ طلاب بانتظار الاعتماد</span>
            <span className="text-2xl font-black text-amber-900">{stats.totalPendingStudents}</span>
          </div>

          <div 
            onClick={() => setStatusFilter('approved')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'approved' ? 'bg-emerald-50 border-emerald-400 shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-emerald-700 block mb-1">✅ معتمدة ومنشورة</span>
            <span className="text-2xl font-black text-emerald-900">{stats.totalApprovedStudents}</span>
          </div>

          <div 
            onClick={() => setStatusFilter('all')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'all' ? 'bg-primary/5 border-primary shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-primary block mb-1">📁 إجمالي التسليمات</span>
            <span className="text-2xl font-black text-primary">{stats.totalSubmissions}</span>
          </div>
        </div>

        {/* شريط الفلاتر والقوائم المنسدلة والبحث */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* القائمة المنسدلة: الوحدة الدراسية */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-folder-tree text-primary ml-1"></i> تصفية حسب الوحدة:
            </label>
            <select
              value={selectedUnitFilter}
              onChange={e => setSelectedUnitFilter(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary outline-none bg-white"
            >
              <option value="all">🌟 جميع الوحدات الدراسية</option>
              {availableUnits.map(u => (
                <option key={u.id} value={u.title}>
                  📂 {u.title}
                </option>
              ))}
            </select>
          </div>

          {/* حقل البحث بالاسم */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-search text-gray-400 ml-1"></i> بحث باسم الاختبار أو الطالب:
            </label>
            <input
              type="text"
              placeholder="ابحث هنا..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full p-2.5 text-xs sm:text-sm font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          {/* فلتر حالة النتيجة */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-filter text-gray-400 ml-1"></i> حالة النتيجة:
            </label>
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                  statusFilter === 'all' ? 'bg-primary text-white shadow-sm font-black' : 'text-gray-600'
                }`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                  statusFilter === 'pending' ? 'bg-amber-600 text-white shadow-sm font-black' : 'text-gray-600'
                }`}
              >
                بانتظار الاعتماد
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('approved')}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                  statusFilter === 'approved' ? 'bg-emerald-600 text-white shadow-sm font-black' : 'text-gray-600'
                }`}
              >
                معلنة
              </button>
            </div>
          </div>
        </div>

        {/* قائمة بطاقات الامتحانات */}
        {filteredQuizGroups.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            <i className="fas fa-clipboard-check text-4xl text-gray-300 mb-2 block"></i>
            <h4 className="font-black text-gray-700 text-base">لا توجد امتحانات مطابقة للفلتر المحدد</h4>
            <p className="text-xs text-gray-400 mt-1">
              ستظهر هنا الامتحانات المقالية فور أن يقوم الطلاب بتسليم إجاباتهم.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredQuizGroups.map(grp => {
              const isApproved = grp.isFullyApproved;
              const hasDrafts = grp.draftCount > 0;
              const isExpanded = expandedQuizId === grp.quizTitle;
              const percApproved = Math.round((grp.approvedCount / Math.max(1, grp.totalCount)) * 100);

              return (
                <div
                  key={grp.quizTitle}
                  className={`rounded-2xl border-2 transition-all overflow-hidden ${
                    isApproved 
                      ? 'bg-white border-gray-200 shadow-xs hover:border-emerald-300' 
                      : 'bg-white border-amber-300 shadow-sm hover:border-amber-400'
                  }`}
                >
                  {/* 1. رأس البطاقة: العنوان والوحدة وحالة الاعتماد */}
                  <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-md border border-gray-200">
                          📂 {grp.unitTitle}
                        </span>
                        <span className={`text-xs font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                          isApproved 
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}>
                          <i className={`fas ${isApproved ? 'fa-check-circle' : 'fa-hourglass-half'}`}></i>
                          <span>{isApproved ? '📢 النتيجة معلنة' : '🔒 بانتظار الاعتماد'}</span>
                        </span>
                      </div>
                      <h3 className="font-black text-base sm:text-lg text-gray-900">
                        {grp.quizTitle}
                      </h3>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                      <span className="text-xs font-bold text-gray-600 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200">
                        📊 متوسط الدرجات: <strong className="text-primary font-black">{grp.avgScorePerc}%</strong>
                      </span>
                    </div>
                  </div>

                  {/* 2. جسم البطاقة: الإحصائيات الأربعة وشريط التقدم */}
                  <div className="p-4 sm:p-5 space-y-3 bg-white">
                    {/* شريط الإحصائيات الموحد في شبكة منظمة */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold">
                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-200 text-center">
                        <span className="text-[11px] text-gray-500 block mb-0.5">👥 إجمالي الطلاب</span>
                        <span className="text-sm font-black text-gray-800">{grp.totalCount}</span>
                      </div>

                      <div className={`p-2.5 rounded-xl border text-center ${
                        grp.pendingCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-gray-50 border-gray-200 text-gray-600'
                      }`}>
                        <span className="text-[11px] block mb-0.5">⏳ بانتظار الاعتماد</span>
                        <span className="text-sm font-black">{grp.pendingCount}</span>
                      </div>

                      <div className={`p-2.5 rounded-xl border text-center ${
                        grp.approvedCount > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-gray-50 border-gray-200 text-gray-600'
                      }`}>
                        <span className="text-[11px] block mb-0.5">✅ معتمد ومنشور</span>
                        <span className="text-sm font-black">{grp.approvedCount}</span>
                      </div>

                      <div className="bg-blue-50/70 p-2.5 rounded-xl border border-blue-200 text-center text-blue-900">
                        <span className="text-[11px] text-blue-700 block mb-0.5">🌐 أونلاين / 🏛️ سنتر</span>
                        <span className="text-sm font-black">{grp.onlineCount} / {grp.centerCount}</span>
                      </div>
                    </div>

                    {/* شريط تقدم الاعتماد */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between items-center text-[11px] font-bold text-gray-500">
                        <span>نسبة إنجاز الاعتماد:</span>
                        <span className="font-black text-gray-700">{percApproved}% ({grp.approvedCount} من {grp.totalCount})</span>
                      </div>
                      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 rounded-full ${isApproved ? 'bg-emerald-500' : 'bg-amber-500'}`}
                          style={{ width: `${percApproved}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  {/* 3. تذييل البطاقة: شريط أزرار الإجراءات المنظم */}
                  <div className="p-3 sm:px-5 border-t border-gray-100 bg-gray-50/70 flex flex-wrap items-center justify-between gap-2.5">
                    <button
                      type="button"
                      onClick={() => setExpandedQuizId(isExpanded ? null : grp.quizTitle)}
                      className="px-3.5 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`}></i>
                      <span>{isExpanded ? 'إخفاء الطلاب' : `قائمة الطلاب (${grp.totalCount})`}</span>
                    </button>

                    <div className="flex items-center gap-2 mr-auto">
                      {onNavigateToReview && (
                        <button
                          type="button"
                          onClick={() => onNavigateToReview(grp.quizTitle)}
                          className="px-3.5 py-2 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-black shadow-2xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <i className="fas fa-feather-alt text-amber-500"></i>
                          <span>تصحيح المقالي</span>
                        </button>
                      )}

                      {!isApproved ? (
                        <button
                          type="button"
                          onClick={() => handleApproveQuizBatch(grp)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <i className="fas fa-check-double"></i>
                          <span>اعتماد وإعلان النتائج للجميع ({grp.pendingCount}) 🚀</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUnapproveQuizBatch(grp)}
                          className="px-3.5 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                          title="حجب النتيجة مؤقتاً عن الطلاب لإعادة التدقيق"
                        >
                          <i className="fas fa-lock text-rose-500"></i>
                          <span>حجب مؤقت</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* قائمة طلاب الامتحان المنسدلة */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-gray-50/70 p-4 space-y-2.5 animate-fade-in">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-gray-700">
                          قائمة الطلاب المسجلين في هذا الامتحان:
                        </span>
                        <span className="text-[11px] text-gray-500 font-bold">
                          يمكنك مراسلة أي طالب مباشرة بنتيجته عبر واتساب
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {grp.submissions.map(sub => {
                          const subOnline = isSubOnline(sub);
                          const maxSc = sub.maxPossibleScore || 50;
                          const currentScore = sub.finalScore ?? sub.questions.reduce((sum, q) => sum + (q.teacherScore ?? q.aiScore ?? 0), 0);
                          const perc = Math.round((currentScore / Math.max(1, maxSc)) * 100);
                          const hasDraft = !sub.isFullyApproved && sub.questions.some(q => q.teacherScore !== undefined);

                          return (
                            <div
                              key={sub.id}
                              className="bg-white p-3 rounded-xl border border-gray-200 flex items-center justify-between gap-3 shadow-2xs hover:border-primary/40 transition-all"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-black text-xs text-gray-900 truncate">
                                    {sub.studentName}
                                  </span>
                                  {subOnline ? (
                                    <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                                      🌐 أونلاين
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-blue-100 text-blue-800">
                                      🏫 سنتر
                                    </span>
                                  )}
                                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded ${
                                    sub.isFullyApproved 
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                                      : hasDraft 
                                        ? 'bg-purple-50 text-purple-800 border border-purple-200'
                                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`}>
                                    {sub.isFullyApproved ? '✅ معتمد' : hasDraft ? '💾 مسودة مصححة' : '⏳ معلق'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-gray-500 font-bold mt-0.5 flex items-center gap-2">
                                  <span>{sub.studentPhone}</span>
                                  <span>•</span>
                                  <span className="text-primary font-black">الدرجة: {currentScore}/{maxSc} ({perc}%)</span>
                                </div>
                              </div>

                              {sub.studentPhone && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const cleanPhone = String(sub.studentPhone || '').replace(/[^\d]/g, '');
                                    const intl = cleanPhone.startsWith('0') ? `+20${cleanPhone.slice(1)}` : `+20${cleanPhone}`;
                                    const msg = encodeURIComponent(
                                      `مرحباً بك يا بطل (${sub.studentName}) 🌟\nمعك أستاذك إسلام سعود من منصة "موسوعة الكنز التعليمي".\n\n` +
                                      `✅ نتيجة امتحانك: *${sub.quizTitle}*\n` +
                                      `📊 الدرجة المعتمدة: *${currentScore} من ${maxSc}* (${perc}%)\n` +
                                      `حالة النتيجة: ${sub.isFullyApproved ? 'معتمدة ومنشورة 📢' : 'قيد المراجعة والاعتماد ⏳'}\n\n` +
                                      `تمنياتي لك بدوام التفوق والنجاح! ❤️`
                                    );
                                    window.open(`https://wa.me/${intl}?text=${msg}`, '_blank');
                                  }}
                                  className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors shrink-0"
                                  title="إرسال عبر واتساب"
                                >
                                  <i className="fab fa-whatsapp text-sm"></i>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
