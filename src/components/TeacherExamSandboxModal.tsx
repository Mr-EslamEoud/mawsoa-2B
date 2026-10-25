import React, { useState } from 'react';
import { Lesson, ExamConfig, Question } from '../types';
import { getQuestionMaxScore, detectEssayType } from '../examConfigUtils';
import { evaluateEssayAnswer, EvaluationResult } from '../aiEvaluationService';
import { FormatQuestionText } from './FormatQuestionText';
import { HighlightText } from './HighlightText';

interface TeacherExamSandboxModalProps {
  lesson: Lesson;
  config: ExamConfig;
  onClose: () => void;
  isDarkMode?: boolean;
}

export const TeacherExamSandboxModal: React.FC<TeacherExamSandboxModalProps> = ({
  lesson,
  config,
  onClose,
  isDarkMode = false,
}) => {
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedMcqOption, setSelectedMcqOption] = useState<string | null>(null);
  
  // حقول تجربة المقالي
  const [testAnswerText, setTestAnswerText] = useState<string>('');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [showModelAnswer, setShowModelAnswer] = useState<boolean>(true);

  const currentQ = lesson.questions[currentQIndex];
  if (!currentQ) return null;

  const currentMaxScore = getQuestionMaxScore(currentQ, currentQIndex, config);
  const essayDetected = currentQ.type === 'essay' ? detectEssayType(currentQ.q) : null;

  // تغيير السؤال
  const handleSelectQuestion = (idx: number) => {
    setCurrentQIndex(idx);
    setSelectedMcqOption(null);
    setTestAnswerText('');
    setEvaluationResult(null);
  };

  // تشغيل تقييم الذكاء الاصطناعي
  const handleRunAiEvaluation = async () => {
    if (!testAnswerText.trim()) return;
    setIsEvaluating(true);
    setEvaluationResult(null);
    try {
      const result = await evaluateEssayAnswer(currentQ, testAnswerText, currentMaxScore, config.dialectPolicy);
      setEvaluationResult(result);
    } catch (e) {
      console.error("Evaluation error:", e);
    } finally {
      setIsEvaluating(false);
    }
  };

  // تعبئة نماذج تجريبية سريعة بنقرة واحدة
  const handleQuickPreset = (presetType: 'model' | 'partial' | 'wrong') => {
    const model = currentQ.answer || currentQ.reason || '';
    if (presetType === 'model') {
      setTestAnswerText(model);
    } else if (presetType === 'partial') {
      const words = model.split(' ');
      setTestAnswerText(words.slice(0, Math.max(3, Math.floor(words.length / 2))).join(' ') + '...');
    } else {
      setTestAnswerText('حدث هذا بسبب عوامل مناخية وجغرافية لا علاقة لها بالحدث التاريخي.');
    }
    setEvaluationResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-md animate-fade-in overflow-y-auto" dir="rtl">
      <div 
        className={`w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden my-auto border-2 flex flex-col max-h-[95vh] ${
          isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-primary/30 text-gray-800'
        }`}
      >
        {/* شريط رأس وضع المعلم والمختبر */}
        <div className="bg-gradient-to-r from-indigo-700 via-primary to-indigo-800 text-white p-3.5 sm:p-4 shrink-0 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center text-lg shrink-0">
              <i className="fas fa-flask"></i>
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-sm sm:text-base">وضع المعلم: معاينة الاختبار ومختبر الذكاء الاصطناعي</span>
                <span className="bg-amber-400 text-amber-950 text-[10px] sm:text-xs font-black px-2 py-0.5 rounded-full">
                  بيئة تجارب معزولة 🔒
                </span>
              </div>
              <p className="text-[11px] text-indigo-100 font-bold mt-0.5">
                {lesson.title} • تجربة حية لكفاءة التصحيح ودقة التقييم دون التأثير على بيانات الطلاب
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors shrink-0"
            title="خروج من المعاينة"
          >
            <i className="fas fa-times text-base"></i>
          </button>
        </div>

        {/* شريط أرقام وتصفح الأسئلة السريع */}
        <div className={`p-2.5 border-b flex items-center gap-1.5 overflow-x-auto shrink-0 select-none ${
          isDarkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-100/80 border-gray-200'
        }`}>
          <span className="text-xs font-black text-gray-500 ml-1 shrink-0">الأسئلة:</span>
          {lesson.questions.map((q, idx) => {
            const isCurrent = idx === currentQIndex;
            const isEssay = q.type === 'essay';
            return (
              <button
                key={idx}
                onClick={() => handleSelectQuestion(idx)}
                className={`min-w-8 h-8 px-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 shrink-0 ${
                  isCurrent
                    ? 'bg-primary text-white shadow-md scale-105'
                    : isEssay
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-200'
                }`}
                title={`سؤال ${idx + 1} (${isEssay ? 'مقالي' : 'موضوعي'})`}
              >
                <span>{idx + 1}</span>
                {isEssay && <i className="fas fa-feather-alt text-[9px] text-amber-600"></i>}
              </button>
            );
          })}
        </div>

        {/* جسم المعاينة التفاعلية */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-sm">
          
          {/* بطاقة السؤال */}
          <div className={`p-4 sm:p-5 rounded-2xl border-2 ${
            currentQ.type === 'essay' 
              ? 'border-amber-300 bg-amber-50/40' 
              : 'border-blue-200 bg-blue-50/30'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${
                  currentQ.type === 'essay'
                    ? 'bg-amber-200 text-amber-950 border border-amber-400'
                    : 'bg-blue-100 text-blue-900 border border-blue-300'
                }`}>
                  {currentQ.type === 'essay' 
                    ? `📝 ${essayDetected?.label || 'سؤال مقالي'}` 
                    : currentQ.type === 'tf' 
                    ? '✔️ صح أو خطأ' 
                    : '🔘 اختيار من متعدد'}
                </span>
                <span className="text-xs font-bold text-gray-500">
                  سؤال رقم ({currentQIndex + 1} من {lesson.questions.length})
                </span>
              </div>

              <div className="bg-white px-3 py-1 rounded-xl border border-gray-200 text-xs font-black text-primary shadow-sm">
                الدرجة المقررة: {currentMaxScore} درجات
              </div>
            </div>

            {/* نص السؤال */}
            <h3 className="text-base sm:text-lg font-black text-gray-900 leading-relaxed mb-3">
              <FormatQuestionText text={currentQ.q} isDarkMode={isDarkMode} />
            </h3>
          </div>

          {/* نوع 1: إذا كان السؤال اختيارياً أو صح وخطأ */}
          {currentQ.type !== 'essay' && (
            <div className="space-y-3">
              <span className="text-xs font-black text-gray-600 block">خيارات السؤال (انقر لتجربة الاختيار ومعاينة التصحيح):</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {currentQ.options.map((opt, optIdx) => {
                  const isCorrectOpt = String(opt).trim() === String(currentQ.correct).trim();
                  const isSelected = selectedMcqOption === opt;
                  return (
                    <button
                      key={optIdx}
                      onClick={() => setSelectedMcqOption(opt)}
                      className={`p-3.5 rounded-xl border-2 text-right font-bold text-xs sm:text-sm transition-all flex items-center justify-between gap-2 ${
                        isSelected
                          ? isCorrectOpt
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm'
                            : 'bg-rose-50 border-rose-500 text-rose-900 shadow-sm'
                          : isCorrectOpt && selectedMcqOption !== null
                          ? 'bg-emerald-50/50 border-emerald-300 text-emerald-800'
                          : 'bg-white border-gray-200 hover:border-gray-300 text-gray-800'
                      }`}
                    >
                      <span className="flex-1">{opt}</span>
                      {isSelected && (
                        <i className={`fas ${isCorrectOpt ? 'fa-check text-emerald-600' : 'fa-times text-rose-600'} text-base`}></i>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedMcqOption && (
                <div className="mt-3 p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-2 animate-fade-in">
                  <div className="font-black text-gray-800 flex items-center gap-1.5">
                    <i className="fas fa-info-circle text-primary"></i>
                    <span>نموذج الإجابة والتفسير:</span>
                  </div>
                  <div className="text-gray-700 font-bold leading-relaxed mr-4 whitespace-pre-line text-xs sm:text-sm mt-1">
                    <HighlightText text={currentQ.reason || currentQ.answer || currentQ.correct} concept={currentQ.concept} isDarkMode={isDarkMode} />
                  </div>
                  {currentQ.concept && (
                    <div className="pt-2 border-t border-gray-200/70 flex items-center gap-1.5 text-xs font-black text-amber-800 bg-amber-50/70 px-3 py-1.5 rounded-lg border border-amber-200/60 w-fit">
                      <i className="fas fa-lightbulb text-amber-500"></i>
                      <span>المفهوم المرتبط:</span>
                      <span className="text-primary font-bold">{currentQ.concept}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* نوع 2: إذا كان السؤال مقالياً (مختبر تقييم الذكاء الاصطناعي للمعلم) */}
          {currentQ.type === 'essay' && (
            <div className="space-y-4">
              
              {/* نموذج الإجابة المعتمد (قابلة للطي) */}
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4">
                <div 
                  onClick={() => setShowModelAnswer(!showModelAnswer)} 
                  className="flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    <i className="fas fa-clipboard-check text-emerald-600 text-base"></i>
                    <span className="font-black text-emerald-950 text-xs sm:text-sm">نموذج الإجابة المعتمد من الشيت:</span>
                  </div>
                  <span className="text-xs font-bold text-emerald-700">
                    <i className={`fas fa-chevron-${showModelAnswer ? 'up' : 'down'} ml-1`}></i>
                    {showModelAnswer ? 'إخفاء' : 'عرض'}
                  </span>
                </div>

                {showModelAnswer && (
                  <div className="mt-2.5 pt-2.5 border-t border-emerald-200/60 text-xs sm:text-sm font-bold text-emerald-900 leading-relaxed space-y-2">
                    <HighlightText text={currentQ.answer || currentQ.reason} concept={currentQ.concept} isDarkMode={isDarkMode} />
                    {currentQ.concept && (
                      <div className="pt-2 border-t border-emerald-200/70 flex items-center gap-1.5 text-xs font-black text-emerald-900 bg-white/70 px-3 py-1.5 rounded-lg border border-emerald-200/60 w-fit">
                        <i className="fas fa-lightbulb text-amber-500"></i>
                        <span>المفهوم المرتبط:</span>
                        <span className="text-primary font-bold">{currentQ.concept}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* صندوق تجربة إجابة الطالب */}
              <div className={`p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 ${isDarkMode ? 'bg-gray-800' : 'bg-indigo-50/30'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  <label className="font-black text-indigo-950 text-xs sm:text-sm flex items-center gap-1.5">
                    <i className="fas fa-pencil-alt text-indigo-600"></i>
                    <span>مختبر تجربة إجابة الطالب:</span>
                  </label>

                  {/* أزرار التعبئة التجريبية السريعة */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-gray-500 font-bold">تجربة سريعة:</span>
                    <button
                      type="button"
                      onClick={() => handleQuickPreset('model')}
                      className="text-[11px] font-bold px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg transition-colors"
                      title="نسخ نموذج الإجابة كاملاً"
                    >
                      إجابة كاملة
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickPreset('partial')}
                      className="text-[11px] font-bold px-2.5 py-1 bg-white hover:bg-amber-50 text-amber-700 border border-amber-300 rounded-lg transition-colors"
                      title="تجربة إجابة ناقصة جزئياً"
                    >
                      إجابة جزئية
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickPreset('wrong')}
                      className="text-[11px] font-bold px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg transition-colors"
                      title="تجربة إجابة خاطئة تماماً"
                    >
                      إجابة خاطئة
                    </button>
                  </div>
                </div>

                <textarea
                  value={testAnswerText}
                  onChange={e => setTestAnswerText(e.target.value)}
                  placeholder="اكتب هنا إجابة تجريبية كما قد يكتبها الطالب في الامتحان لاختبار كيفية تصحيح الذكاء الاصطناعي لها..."
                  rows={3}
                  className="w-full p-3 font-bold text-xs sm:text-sm rounded-xl border border-indigo-300 focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-gray-900 leading-relaxed resize-y"
                />

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-500 font-bold">
                    عدد الكلمات: {testAnswerText.trim() ? testAnswerText.trim().split(/\s+/).length : 0}
                  </span>

                  <button
                    type="button"
                    onClick={handleRunAiEvaluation}
                    disabled={isEvaluating || !testAnswerText.trim()}
                    className={`px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm text-white shadow-md active:scale-95 transition-all flex items-center gap-2 ${
                      isEvaluating || !testAnswerText.trim()
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    <i className={isEvaluating ? "fas fa-spinner fa-spin" : "fas fa-bolt text-amber-300"}></i>
                    <span>{isEvaluating ? 'جاري تقييم الإجابة...' : '⚡ اختبر تقييم الذكاء الاصطناعي الآن'}</span>
                  </button>
                </div>

                {/* نتيجة تقييم الذكاء الاصطناعي المباشرة */}
                {evaluationResult && (
                  <div className="mt-4 p-4 bg-white border-2 border-indigo-400 rounded-2xl shadow-md animate-fade-in space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-black">
                          🤖
                        </span>
                        <div>
                          <span className="font-black text-gray-900 text-xs sm:text-sm block">نتيجة تصحيح الذكاء الاصطناعي</span>
                          <span className="text-[10px] text-gray-400 font-bold">
                            المحرك المستخدم: {evaluationResult.provider === 'gemini' ? 'Google Gemini AI' : 'المحلل الدلالي الذكي'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="text-[10px] text-gray-400 font-bold block">الدرجة المقترحة:</span>
                          <span className="text-base font-black text-indigo-700">
                            {evaluationResult.score} من {evaluationResult.maxScore}
                          </span>
                        </div>
                        <span className={`text-xs font-black px-2.5 py-1 rounded-xl ${
                          evaluationResult.percentage >= 80 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : evaluationResult.percentage >= 50
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {evaluationResult.percentage}%
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="font-black text-gray-700 block mb-0.5">💬 ملاحظة التقييم للطالب:</span>
                        <p className="font-bold text-gray-800 bg-gray-50 p-2.5 rounded-xl border border-gray-200 leading-relaxed">
                          {evaluationResult.feedback}
                        </p>
                      </div>

                      {evaluationResult.strengths && (
                        <div className="flex items-start gap-2 text-emerald-800 bg-emerald-50/70 p-2 rounded-xl">
                          <i className="fas fa-check-circle mt-0.5 text-emerald-600"></i>
                          <div>
                            <span className="font-black">نقاط القوة: </span>
                            <span className="font-bold">{evaluationResult.strengths}</span>
                          </div>
                        </div>
                      )}

                      {evaluationResult.improvements && (
                        <div className="flex items-start gap-2 text-amber-800 bg-amber-50/70 p-2 rounded-xl">
                          <i className="fas fa-exclamation-triangle mt-0.5 text-amber-600"></i>
                          <div>
                            <span className="font-black">التوجيه والتحسين: </span>
                            <span className="font-bold">{evaluationResult.improvements}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

        {/* تذييل شريط التنقل */}
        <div className={`p-3.5 border-t flex items-center justify-between gap-3 shrink-0 ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
        }`}>
          <button
            type="button"
            disabled={currentQIndex === 0}
            onClick={() => handleSelectQuestion(currentQIndex - 1)}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
              currentQIndex === 0 ? 'text-gray-400 bg-gray-100 cursor-not-allowed' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <i className="fas fa-arrow-right"></i> السابق
          </button>

          <span className="text-xs font-black text-gray-500">
            سؤال {currentQIndex + 1} من {lesson.questions.length}
          </span>

          <button
            type="button"
            disabled={currentQIndex === lesson.questions.length - 1}
            onClick={() => handleSelectQuestion(currentQIndex + 1)}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
              currentQIndex === lesson.questions.length - 1 ? 'text-gray-400 bg-gray-100 cursor-not-allowed' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            التالي <i className="fas fa-arrow-left"></i>
          </button>
        </div>

      </div>
    </div>
  );
};
