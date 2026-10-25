import React, { useState } from 'react';
import { StudentEssaySubmission } from '../types';
import { toEasternArabic } from '../utils';
import { HighlightText } from './HighlightText';
import { FormatQuestionText } from './FormatQuestionText';

interface StudentApprovedEssayModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: StudentEssaySubmission | null;
  isDarkMode?: boolean;
}

export const StudentApprovedEssayModal: React.FC<StudentApprovedEssayModalProps> = ({
  isOpen,
  onClose,
  submission,
  isDarkMode = false,
}) => {
  const [viewMode, setViewMode] = useState<'alert' | 'details'>('alert');

  if (!isOpen || !submission) return null;

  const maxScore = submission.maxPossibleScore || 50;
  const earnedScore = submission.finalScore !== undefined ? submission.finalScore : 0;
  const perc = Math.round((earnedScore / Math.max(1, maxScore)) * 100);
  const isPassed = perc >= 60;

  // توليد وتحميل شهادة التقدير
  const handleDownloadCertificate = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.direction = 'rtl';
    const gradient = ctx.createLinearGradient(0, 0, 1000, 700);
    gradient.addColorStop(0, '#f8fafc');
    gradient.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1000, 700);

    // إطار ذهبي خارجي
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 15;
    ctx.strokeRect(30, 30, 940, 640);

    // إطار كحلي داخلي
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 3;
    ctx.strokeRect(50, 50, 900, 600);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 65px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('شهادة تميـز وتقديـر', 500, 130);

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 28px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :', 500, 225);

    ctx.fillStyle = '#d97706';
    ctx.font = '900 52px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(submission.studentName, 500, 305);

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`نظراً لاجتيازه بجدارة وتفوق اختبار: (${submission.quizTitle})`, 500, 385);

    ctx.font = '900 28px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText(
      `وحصوله على درجة (${toEasternArabic(earnedScore)} من ${toEasternArabic(maxScore)}) بنسبة ${toEasternArabic(perc)}%`,
      500,
      440
    );

    ctx.fillStyle = '#db2777';
    ctx.font = '900 32px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('أكمل يا بطلي فحقا فخور بك وبمستواك ❤️', 500, 510);

    ctx.beginPath();
    ctx.moveTo(150, 560);
    ctx.lineTo(850, 560);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('أ/ إسلام سعود', 800, 615);

    ctx.fillStyle = '#16a34a';
    ctx.font = '900 40px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`${toEasternArabic(perc)}٪`, 500, 615);

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 22px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(new Date().toLocaleDateString('ar-EG'), 220, 615);

    const link = document.createElement('a');
    link.download = `شهادة_${submission.studentName.split(' ')[0]}_${submission.quizTitle.replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-md animate-fade-in">
      <div 
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border overflow-hidden transition-all duration-300 ${
          isDarkMode 
            ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-purple-950/40' 
            : 'bg-white border-indigo-100 text-slate-800 shadow-indigo-900/20'
        }`}
      >
        {viewMode === 'alert' ? (
          // =================== شاشة الإشعار والتهنئة ===================
          <div className="p-6 sm:p-8 flex flex-col items-center text-center overflow-y-auto">
            {/* أيقونة التهنئة */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-300 text-amber-950 flex items-center justify-center text-4xl sm:text-5xl shadow-xl shadow-amber-500/30 mb-4 animate-bounce">
              🏆
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black mb-3">
              <i className="fas fa-check-circle"></i> تم اعتماد وتصحيح الإجابات
            </div>

            <h2 className="text-2xl sm:text-3xl font-black mb-2 text-indigo-900 dark:text-indigo-300">
              مبروك يا بطل! 🎉
            </h2>

            <p className="text-sm sm:text-base font-bold text-slate-600 dark:text-slate-300 mb-6 max-w-md">
              قام المعلم <span className="text-amber-600 dark:text-amber-400 font-black">أ/ إسلام سعود</span> بمراجعة وتصحيح إجاباتك في اختبار:
              <br />
              <span className="text-indigo-600 dark:text-indigo-400 font-black text-lg block mt-1">
                « {submission.quizTitle} »
              </span>
            </p>

            {/* بطاقة النتيجة */}
            <div className="w-full bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-slate-800/80 dark:to-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center justify-around gap-4 shadow-inner">
              <div className="text-center">
                <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">الدرجة المستحقة</span>
                <span className="text-3xl sm:text-4xl font-black text-indigo-700 dark:text-indigo-300" dir="ltr">
                  {toEasternArabic(earnedScore)} / {toEasternArabic(maxScore)}
                </span>
              </div>

              <div className="h-10 w-px bg-indigo-200 dark:bg-slate-700 hidden sm:block"></div>

              <div className="text-center">
                <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">النسبة المئوية</span>
                <span className={`text-3xl sm:text-4xl font-black ${isPassed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} dir="ltr">
                  {toEasternArabic(perc)}%
                </span>
              </div>
            </div>

            {/* رسالة المعلم التشجيعية */}
            <div className="w-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 mb-6 text-right">
              <div className="flex items-center gap-2 mb-1 text-xs font-black text-amber-800 dark:text-amber-300">
                <i className="fas fa-comment-dots text-sm"></i> كلمة المعلم أ/ إسلام سعود:
              </div>
              <p className="text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200 leading-relaxed">
                {perc >= 85
                  ? "ما شاء الله، إجابات نموذجية تدل على فهم عميق واستيعاب ممتاز للمادة. فخور بك جداً واستمر على هذا المستوى الرائع! ❤️"
                  : perc >= 65
                  ? "عمل رائع ومجهود متميز، إجاباتك جيدة جداً، مع بعض الملاحظات البسيطة ستصل إلى الدرجة النهائية بإذن الله. 🌟"
                  : "مجهود طيب، راجع الملاحظات والنموذج المعتمد أسفل كل سؤال لتتفادى أي نقص في المرات القادمة، بالتوفيق يا بطل! 👍"}
              </p>
            </div>

            {/* أزرار الإجراءات */}
            <div className="w-full flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={() => setViewMode('details')}
                className="w-full sm:flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                <i className="fas fa-file-alt"></i> عرض إجاباتي وملاحظات المعلم
              </button>

              {isPassed && (
                <button
                  onClick={handleDownloadCertificate}
                  className="w-full sm:flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-900 font-black text-sm rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-award text-base"></i> تحميل شهادة التقدير 📜
                </button>
              )}

              <button
                onClick={onClose}
                className="w-full sm:w-auto py-3 px-5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        ) : (
          // =================== شاشة تفاصيل الإجابات والملاحظات ===================
          <>
            {/* رأس النافذة */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-indigo-50/50 dark:bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setViewMode('alert')}
                  className="w-9 h-9 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                  title="العودة للإشعار"
                >
                  <i className="fas fa-arrow-right"></i>
                </button>
                <div>
                  <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-slate-100">
                    مراجعة إجابات {submission.quizTitle}
                  </h3>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    الدرجة: {toEasternArabic(earnedScore)} من {toEasternArabic(maxScore)} ({toEasternArabic(perc)}%)
                  </span>
                </div>
              </div>

              {isPassed && (
                <button
                  onClick={handleDownloadCertificate}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs font-black rounded-xl transition-colors cursor-pointer"
                >
                  <i className="fas fa-award"></i> الشهادة 📜
                </button>
              )}
            </div>

            {/* محتوى الأسئلة المقالية وملاحظات المعلم */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {submission.questions.map((q, idx) => (
                <div
                  key={idx}
                  className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-black text-xs flex items-center justify-center">
                        {toEasternArabic(idx + 1)}
                      </span>
                      <span className="text-xs font-black px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300">
                        {q.essayType || 'سؤال مقالي'}
                      </span>
                    </div>

                    {(() => {
                      const finalQScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
                      const isZero = finalQScore === 0;
                      const isFull = finalQScore >= q.maxScore;
                      return (
                        <div className={`text-xs font-black px-2.5 py-1 rounded-lg ${
                          isZero
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : isFull
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`} dir="ltr">
                          {toEasternArabic(finalQScore)} / {toEasternArabic(q.maxScore)} درجة
                        </div>
                      );
                    })()}
                  </div>

                  {/* رأس السؤال المطلوب */}
                  <div className="mb-3.5 p-3.5 sm:p-4 rounded-xl bg-gradient-to-r from-indigo-50/70 via-blue-50/40 to-slate-50/70 dark:from-slate-900/80 dark:via-indigo-950/30 dark:to-slate-900/60 border-2 border-indigo-200/90 dark:border-indigo-800/60 shadow-xs">
                    <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-indigo-100/90 dark:border-indigo-900/40">
                      <span className="flex items-center gap-1.5 text-xs font-black text-indigo-950 dark:text-indigo-200">
                        <span className="w-5 h-5 rounded-md bg-indigo-600 text-white flex items-center justify-center text-[10px] shadow-xs">
                          <i className="fas fa-question"></i>
                        </span>
                        <span>رأس السؤال المطلوب:</span>
                      </span>
                      {q.essayType && (
                        <span className="text-[10px] sm:text-xs font-black px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                          🎯 {q.essayType}
                        </span>
                      )}
                    </div>

                    <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 leading-relaxed">
                      <FormatQuestionText text={q.questionText} isDarkMode={isDarkMode} />
                    </div>
                  </div>

                  {/* إجابة الطالب */}
                  <div className="mb-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                    <span className="block text-[11px] font-black text-slate-500 dark:text-slate-400 mb-1">
                      ✍️ إجابتك المسجلة:
                    </span>
                    <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {q.studentText || 'لم يتم تسجيل إجابة'}
                    </p>
                  </div>

                  {/* ملاحظات المعلم */}
                  {(q.teacherFeedback || q.aiFeedback) && (
                    <div className="mb-3 p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60">
                      <span className="block text-[11px] font-black text-indigo-700 dark:text-indigo-300 mb-1">
                        👨‍🏫 ملاحظات المعلم أ/ إسلام سعود:
                      </span>
                      <div className="text-xs sm:text-sm font-bold text-indigo-950 dark:text-indigo-200 leading-relaxed">
                        <HighlightText text={q.teacherFeedback || q.aiFeedback || ''} isDarkMode={isDarkMode} />
                      </div>
                    </div>
                  )}

                  {/* نموذج الإجابة المعتمد */}
                  {q.modelAnswer && (
                    <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                      <span className="block text-[11px] font-black text-emerald-800 dark:text-emerald-300 mb-1.5 flex items-center gap-1.5">
                        <i className="fas fa-clipboard-check text-emerald-600"></i>
                        <span>نموذج الإجابة النموذجي:</span>
                      </span>
                      <div className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200 leading-relaxed">
                        <HighlightText text={q.modelAnswer} isDarkMode={isDarkMode} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ذيل النافذة */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex items-center justify-between gap-3 shrink-0">
              {isPassed ? (
                <button
                  onClick={handleDownloadCertificate}
                  className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black text-xs sm:text-sm rounded-xl transition-all shadow active:scale-95 flex items-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-download"></i> تحميل الشهادة 📜
                </button>
              ) : <div />}

              <button
                onClick={onClose}
                className="py-2.5 px-6 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
