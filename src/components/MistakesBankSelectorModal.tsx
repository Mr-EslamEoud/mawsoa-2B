import React, { useState, useMemo } from 'react';
import { Question, Unit } from '../types';
import { toEasternArabic, simpleHash } from '../utils';

export interface LessonMistakesGroup {
  lessonId: string;
  lessonTitle: string;
  unitTitle: string;
  questions: Question[];
  paragraphs: string[];
}

interface MistakesBankSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mistakes: Question[];
  unitsData: Unit[];
  isDarkMode?: boolean;
  onStartPractice: (selectedQuestions: Question[], lessonTitle: string) => void;
}

export const MistakesBankSelectorModal: React.FC<MistakesBankSelectorModalProps> = ({
  isOpen,
  onClose,
  mistakes = [],
  unitsData = [],
  isDarkMode = false,
  onStartPractice,
}) => {
  const [step, setStep] = useState<'select_lesson' | 'confirm_reminder'>('select_lesson');
  const [selectedGroup, setSelectedGroup] = useState<LessonMistakesGroup | null>(null);

  // تجميع وتصنيف أسئلة بنك الأخطاء حسب الدروس مع استخراج فقرات ومفاهيم كل درس
  const lessonGroups = useMemo<LessonMistakesGroup[]>(() => {
    if (!Array.isArray(mistakes) || mistakes.length === 0) return [];

    const groupsMap = new Map<string, LessonMistakesGroup>();

    mistakes.forEach(q => {
      if (!q || !q.q) return;
      const qHash = simpleHash(q.q);

      let resolvedLessonId = q.section || '';
      let resolvedLessonTitle = q.section || 'مراجعة عامة';
      let resolvedUnitTitle = 'المنهج الدراسي';

      if (Array.isArray(unitsData) && unitsData.length > 0) {
        for (const u of unitsData) {
          if (!u || !Array.isArray(u.lessons)) continue;
          for (const l of u.lessons) {
            if (l.questions && l.questions.some(item => simpleHash(item.q) === qHash || item.q === q.q)) {
              resolvedLessonId = l.id;
              resolvedLessonTitle = l.title;
              resolvedUnitTitle = u.title;
              break;
            }
          }
          if (resolvedLessonId && resolvedUnitTitle !== 'المنهج الدراسي') break;
        }
      }

      const groupKey = resolvedLessonId || resolvedLessonTitle;
      let group = groupsMap.get(groupKey);

      if (!group) {
        group = {
          lessonId: resolvedLessonId,
          lessonTitle: resolvedLessonTitle,
          unitTitle: resolvedUnitTitle,
          questions: [],
          paragraphs: []
        };
        groupsMap.set(groupKey, group);
      }

      group.questions.push(q);

      const para = (q.paragraph || q.concept || '').trim();
      if (para && !group.paragraphs.includes(para)) {
        group.paragraphs.push(para);
      }
    });

    return Array.from(groupsMap.values()).sort((a, b) => b.questions.length - a.questions.length);
  }, [mistakes, unitsData]);

  if (!isOpen) return null;

  const handleSelectLesson = (group: LessonMistakesGroup) => {
    setSelectedGroup(group);
    setStep('confirm_reminder');
  };

  const handleConfirmStart = () => {
    if (!selectedGroup) return;
    onStartPractice(selectedGroup.questions, selectedGroup.lessonTitle);
    onClose();
    // إعادة التعيين للمرة القادمة
    setTimeout(() => {
      setStep('select_lesson');
      setSelectedGroup(null);
    }, 300);
  };

  const handleStartAll = () => {
    onStartPractice(mistakes, 'جميع الأخطاء (ماراثون تدريب شامل)');
    onClose();
    setTimeout(() => {
      setStep('select_lesson');
      setSelectedGroup(null);
    }, 300);
  };

  return (
    <div 
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in" 
      dir="rtl"
    >
      <div 
        className={`w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border overflow-hidden transition-all duration-300 ${
          isDarkMode 
            ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-purple-950/40' 
            : 'bg-white border-rose-100 text-slate-900 shadow-rose-950/20'
        }`}
      >
        {/* ======================= الخطوة 1: اختيار الدرس ======================= */}
        {step === 'select_lesson' && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* رأس النافذة */}
            <div className="p-4 sm:p-5 border-b border-rose-100 dark:border-slate-800 bg-gradient-to-r from-rose-50/80 via-white to-rose-50/50 dark:from-slate-900 dark:via-rose-950/20 dark:to-slate-900 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-rose-500 to-red-600 text-white flex items-center justify-center text-xl shadow-md shadow-rose-500/30 shrink-0">
                  <i className="fas fa-bullseye"></i>
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-rose-950 dark:text-rose-100 flex items-center gap-1.5">
                    <span>بنك الأخطاء - تدريب الدروس</span>
                    <span className="text-xs bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 px-2.5 py-0.5 rounded-full">
                      {toEasternArabic(mistakes.length)} سؤال
                    </span>
                  </h3>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                    اختر الدرس الذي ترغب في تصفية أخطائه والتدرب عليه:
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 transition-colors shadow-xs cursor-pointer shrink-0"
                title="إغلاق"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            {/* قائمة الدروس المبوّبة */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1 custom-scrollbar">
              {lessonGroups.map((group, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelectLesson(group)}
                  className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] group ${
                    isDarkMode
                      ? 'bg-slate-800/80 border-slate-700/80 hover:border-rose-500 hover:bg-slate-800'
                      : 'bg-rose-50/40 border-rose-100/90 hover:border-rose-400 hover:bg-rose-50/90 shadow-xs'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-600 flex items-center justify-center text-sm font-black shrink-0 group-hover:scale-110 transition-transform">
                      {toEasternArabic(idx + 1)}
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">
                        📁 {group.unitTitle}
                      </span>
                      <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                        📖 {group.lessonTitle}
                      </h4>
                      {group.paragraphs.length > 0 && (
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                          <i className="fas fa-bookmark text-[9px]"></i>
                          <span>{toEasternArabic(group.paragraphs.length)} فقرات تحتاج مراجعة</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="bg-rose-600 text-white text-xs font-black px-2.5 py-1 rounded-xl shadow-xs">
                      {toEasternArabic(group.questions.length)} {group.questions.length === 1 ? 'خطأ' : 'أخطاء'}
                    </span>
                    <i className="fas fa-chevron-left text-slate-400 group-hover:text-rose-600 transition-colors text-xs"></i>
                  </div>
                </div>
              ))}
            </div>

            {/* ذيل النافذة وخيار التدريب الشامل */}
            <div className="p-3.5 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row items-center gap-2.5 shrink-0">
              {lessonGroups.length > 1 && (
                <button
                  onClick={handleStartAll}
                  className="w-full sm:flex-1 py-2.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-bolt text-amber-300"></i>
                  <span>ماراثون تدريب شامل على جميع الأخطاء ({toEasternArabic(mistakes.length)})</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="w-full sm:w-auto py-2.5 px-5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}

        {/* ======================= الخطوة 2: التذكرة التربوية قبل الحل ======================= */}
        {step === 'confirm_reminder' && selectedGroup && (
          <div className="p-5 sm:p-6 flex flex-col overflow-y-auto">
            {/* الشارة التمهيدية */}
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 text-xs font-black">
                <i className="fas fa-lightbulb text-amber-600 animate-pulse"></i>
                <span>تذكرة تربوية قبل الحل</span>
              </span>

              <button
                onClick={() => setStep('select_lesson')}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <i className="fas fa-arrow-right text-[10px]"></i>
                <span>تغيير الدرس</span>
              </button>
            </div>

            {/* عنوان الدرس وعدد الأخطاء */}
            <div className="mb-4 text-right">
              <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                الدرس المستهدف للتدريب:
              </span>
              <h3 className="text-base sm:text-xl font-black text-indigo-950 dark:text-indigo-100 leading-snug">
                « {selectedGroup.lessonTitle} »
              </h3>
              <span className="inline-block mt-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                (يحتوي على {toEasternArabic(selectedGroup.questions.length)} أخطاء تحتاج مراجعة وإتقان)
              </span>
            </div>

            {/* الفقرات التي تعثر فيها الطالب */}
            {selectedGroup.paragraphs.length > 0 && (
              <div className="w-full bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 mb-4 text-right">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-amber-900 dark:text-amber-300 mb-2.5">
                  <i className="fas fa-bookmark text-amber-600"></i>
                  <span>أجزاء وفقرات الدرس التي رُصدت فيها أخطاؤك:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedGroup.paragraphs.map((para, pIdx) => (
                    <span 
                      key={pIdx} 
                      className="bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/60 px-3 py-1.5 rounded-xl text-xs font-black shadow-2xs flex items-center gap-1.5"
                    >
                      <i className="fas fa-check text-amber-500 text-[10px]"></i>
                      <span>{para}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* رسالة المعلم وسؤال التأكيد التربوي */}
            <div className="w-full bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl p-4 sm:p-5 mb-5 text-right">
              <div className="flex items-center gap-2 mb-2 text-xs sm:text-sm font-black text-indigo-900 dark:text-indigo-200">
                <i className="fas fa-user-graduate text-base text-indigo-600"></i>
                <span>توجيه المعلم أ/ إسلام سعود:</span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 leading-relaxed">
                يا بطل، تركزت أخطاؤك في هذا الدرس حول هذه الجزئيات المحددة.. 
                <br />
                <span className="font-black text-indigo-700 dark:text-indigo-300 mt-1 block">
                  هل قمت بمراجعتها جيداً من المذكرة قبل بدء التدريب حتى تتفادى تكرار الخطأ؟
                </span>
              </p>
            </div>

            {/* خيارا التأكيد */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={handleConfirmStart}
                className="w-full sm:flex-1 py-3.5 px-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs sm:text-sm rounded-2xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                <i className="fas fa-rocket text-base"></i>
                <span>نعم، راجعتها وجاهز للحل والتحدي 🚀</span>
              </button>

              <button
                onClick={onClose}
                className="w-full sm:w-auto py-3.5 px-6 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs sm:text-sm rounded-2xl transition-colors cursor-pointer"
              >
                سأراجعها أولاً ثم أعود 📚
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
