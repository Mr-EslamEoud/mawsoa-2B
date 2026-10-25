import React from 'react';
import { StudentEssaySubmission } from '../types';
import { toEasternArabic } from '../utils';

interface StudentEssayListModalProps {
  isOpen: boolean;
  onClose: () => void;
  submissions: StudentEssaySubmission[];
  onSelectSubmission: (sub: StudentEssaySubmission) => void;
  isDarkMode?: boolean;
}

export const StudentEssayListModal: React.FC<StudentEssayListModalProps> = ({
  isOpen,
  onClose,
  submissions,
  onSelectSubmission,
  isDarkMode = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
      <div 
        className={`w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl shadow-2xl border overflow-hidden transition-all ${
          isDarkMode 
            ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-purple-950/40' 
            : 'bg-white border-indigo-100 text-slate-800 shadow-indigo-900/20'
        }`}
      >
        {/* رأس النافذة */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-indigo-50/50 dark:bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-lg shadow-sm">
              <i className="fas fa-feather-alt"></i>
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-slate-100">
                اختباراتي المقالية
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                سجل نتائج وتصحيح الأسئلة المقالية
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 flex items-center justify-center text-sm transition-colors cursor-pointer"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* قائمة الاختبارات */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
          {submissions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400 text-2xl">
                <i className="fas fa-inbox"></i>
              </div>
              <h4 className="font-bold text-sm sm:text-base text-slate-700 dark:text-slate-300 mb-1">
                لا توجد اختبارات مقالية مسجلة حالياً
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                عند إجابتك على أي اختبار يحتوي على أسئلة مقالية، سيظهر هنا سجلك الكامل ونتائج التقييم فور اعتمادها.
              </p>
            </div>
          ) : (
            submissions.map((sub) => {
              const maxScore = sub.maxPossibleScore || 50;
              const earned = sub.finalScore !== undefined ? sub.finalScore : 0;
              const perc = Math.round((earned / Math.max(1, maxScore)) * 100);

              return (
                <div
                  key={sub.id}
                  onClick={() => onSelectSubmission(sub)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm ${
                    sub.isFullyApproved
                      ? 'bg-emerald-50/40 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/40 hover:border-emerald-400'
                      : 'bg-amber-50/40 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40 hover:border-amber-400'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                        {sub.quizTitle}
                      </span>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          sub.isFullyApproved
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                        }`}
                      >
                        {sub.isFullyApproved ? '✅ معتمد ومصحح' : '⏳ قيد المراجعة'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                      <span><i className="far fa-calendar-alt ml-1"></i>{sub.submissionDate}</span>
                      <span>•</span>
                      <span>{toEasternArabic(sub.questions.length)} أسئلة مقالية</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200 dark:border-slate-800">
                    {sub.isFullyApproved ? (
                      <div className="text-left" dir="ltr">
                        <span className="text-xs font-bold text-slate-400 block sm:hidden">الدرجة:</span>
                        <span className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400">
                          {toEasternArabic(earned)} / {toEasternArabic(maxScore)} ({toEasternArabic(perc)}%)
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                        جاري المراجعة والتصحيح
                      </span>
                    )}

                    <div className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 text-xs shadow-xs">
                      <i className="fas fa-chevron-left"></i>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ذيل النافذة */}
        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 text-center shrink-0">
          <button
            onClick={onClose}
            className="py-2.5 px-6 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
