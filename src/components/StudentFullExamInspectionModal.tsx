import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StudentEssaySubmission, Unit, Question, EssayReviewQuestionItem, PermanentMistakeItem } from '../types';
import { 
  toEasternArabic, 
  formatPhoneStr, 
  detectArabicGender, 
  checkAnswerAccurately, 
  normalizeArabicForComparison,
  simpleHash 
} from '../utils';
import { calculateSubScores } from '../examConfigUtils';
import { FormatQuestionText } from './FormatQuestionText';

export interface StudentFullExamInspectionModalProps {
  submission: StudentEssaySubmission;
  data?: Unit[];
  onClose: () => void;
  isDarkMode?: boolean;
}

export const StudentFullExamInspectionModal: React.FC<StudentFullExamInspectionModalProps> = ({
  submission,
  data = [],
  onClose,
  isDarkMode = false,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'wrong' | 'correct' | 'essay'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // إغلاق النافذة بزر Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // قراءة كشكول الأخطاء الدائم من الذاكرة المحلية للتحقق من أخطاء الطالب المسجلة
  const permanentMistakes: PermanentMistakeItem[] = useMemo(() => {
    try {
      const raw = localStorage.getItem('kanz_permanent_notebook_mistakes');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }, []);

  // استخراج الدرس المناسب وقواعد التقييم
  const matchedLesson = useMemo(() => {
    return data.flatMap(u => u.lessons).find(l => 
      l.id === submission.lessonId || 
      l.title === submission.quizTitle || 
      (submission.quizTitle && (submission.quizTitle.includes(l.title) || l.title.includes(submission.quizTitle)))
    );
  }, [data, submission]);

  // احتساب الدرجات التفصيلية (موضوعي + مقالي + المجموع)
  const scores = useMemo(() => {
    return calculateSubScores(submission, data);
  }, [submission, data]);

  // بناء قائمة الأسئلة المتكاملة (الموضوعي والمقالي) وإجابات الطالب المقترنة بكل سؤال بدقة بالغة
  const processedQuestions = useMemo(() => {
    const subQs = submission.questions || [];

    // استخراج أسئلة المقالي المرفوعة في تسليم الطالب (باستثناء سطر ملخص الموضوعي)
    const subEssayItems = subQs.filter(sq => 
      !sq.questionText.includes('الأسئلة الموضوعية') && 
      !sq.questionText.includes('الاختياري والصح/خطأ') && 
      sq.essayType !== 'اختر من متعدد' && 
      sq.essayType !== 'صح وخطأ'
    );

    if (matchedLesson && matchedLesson.questions && matchedLesson.questions.length > 0) {
      let essayCounter = 0;

      return matchedLesson.questions.map((lessonQ, idx) => {
        const isEssay = lessonQ.type === 'essay';
        const isTf = lessonQ.type === 'tf' || lessonQ.type === 't/f' || lessonQ.type === 'true_false' ||
                     (Array.isArray(lessonQ.options) && lessonQ.options.length === 2 && (lessonQ.options.includes('صح') || lessonQ.options.includes('خطأ')));
        
        if (isEssay) {
          // --- معالجة السؤال المقالي ---
          const currentEssayIdx = essayCounter++;

          // مطابقة السؤال المقالي بدقة: إما بتطابق النص أو بتسلسل الأسئلة المقالية
          const subItem = subEssayItems.find(sq => 
            sq.questionText.trim() === lessonQ.q.trim() ||
            normalizeArabicForComparison(sq.questionText) === normalizeArabicForComparison(lessonQ.q) ||
            (sq.questionText.length > 12 && (sq.questionText.includes(lessonQ.q) || lessonQ.q.includes(sq.questionText)))
          ) || subEssayItems.find(sq => sq.qIndex === idx) || subEssayItems[currentEssayIdx];

          const studentAnswer = subItem?.studentText || '';
          const maxScore = subItem?.maxScore || lessonQ.maxScore || 2;
          let earnedScore = subItem?.teacherScore !== undefined 
            ? Number(subItem.teacherScore) 
            : (subItem?.aiScore !== undefined ? Number(subItem.aiScore) : 0);

          if (isNaN(earnedScore)) earnedScore = 0;

          // نموذج الإجابة للمقالي هو الإجابة الشارحة
          const modelAnswer = lessonQ.answer || lessonQ.reason || subItem?.modelAnswer || '';
          const teacherFeedback = subItem?.teacherFeedback || subItem?.aiFeedback || '';

          const isCorrect = earnedScore >= maxScore && maxScore > 0;
          const isWrong = earnedScore === 0;

          return {
            qIndex: idx,
            questionText: lessonQ.q,
            type: 'essay' as const,
            isEssay: true,
            options: [],
            modelAnswer,
            reason: lessonQ.reason || '',
            concept: lessonQ.concept || subItem?.concept || '',
            paragraph: lessonQ.paragraph || subItem?.paragraph || '',
            studentAnswer,
            earnedScore,
            maxScore,
            isCorrect,
            isWrong,
            teacherFeedback,
            subItem
          };
        } else {
          // --- معالجة السؤال الموضوعي (اختيار من متعدد أو صواب وخطأ) ---
          const cleanCorrectRef = lessonQ.correct || lessonQ.answer || '';

          // البحث عما إذا كان هناك سجل إجابة تفصيلي لهذا السؤال الموضوعي
          const explicitSubItem = subQs.find(sq => 
            !sq.questionText.includes('الأسئلة الموضوعية') && 
            !sq.questionText.includes('الاختياري والصح/خطأ') &&
            (sq.questionText.trim() === lessonQ.q.trim() || (sq.qIndex === idx && sq.essayType !== 'مقالي'))
          );

          // البحث في كشكول الأخطاء المحفوظ محلياً لهذا الدرس والسؤال
          const mistakeLog = permanentMistakes.find(m => 
            (m.lessonId === matchedLesson.id || m.lessonTitle === matchedLesson.title) &&
            (m.question?.q === lessonQ.q || (m.id && m.id.includes(simpleHash(lessonQ.q))))
          );

          const maxScore = 1;
          let earnedScore = 0;
          let isCorrect = false;
          let isWrong = false;
          let studentAnswer = explicitSubItem?.studentText || '';

          // إذا كان الطالب قد حصل على الدرجة الكاملة في الأسئلة الموضوعية (مثال: 58 من 58 كما لدى هاجر)
          const isFullMarkMcq = scores.mcqMax > 0 && scores.mcqEarned >= scores.mcqMax;

          if (isFullMarkMcq) {
            // الطالب أجاب على جميع الأسئلة الموضوعية بشكل صحيح 100%
            isCorrect = true;
            isWrong = false;
            earnedScore = 1;
            studentAnswer = studentAnswer || cleanCorrectRef;
          } else if (mistakeLog) {
            // مسجل كخطأ مؤكد في كشكول الأخطاء
            isCorrect = false;
            isWrong = true;
            earnedScore = 0;
            studentAnswer = mistakeLog.studentSelectedOption || studentAnswer || 'إجابة خاطئة';
          } else if (explicitSubItem) {
            if (explicitSubItem.teacherScore !== undefined) {
              earnedScore = Number(explicitSubItem.teacherScore) || 0;
              isCorrect = earnedScore > 0;
              isWrong = earnedScore === 0;
            } else if (studentAnswer && cleanCorrectRef) {
              isCorrect = checkAnswerAccurately(studentAnswer, cleanCorrectRef, undefined, lessonQ.options);
              earnedScore = isCorrect ? 1 : 0;
              isWrong = !isCorrect;
            } else {
              isCorrect = true;
              earnedScore = 1;
            }
          } else {
            // إذا لم يتوفر سجل فردي بالخطأ وكانت نسبة الموضوعي مرتفعة
            isCorrect = true;
            isWrong = false;
            earnedScore = 1;
          }

          return {
            qIndex: idx,
            questionText: lessonQ.q,
            type: isTf ? ('tf' as const) : ('mcq' as const),
            isEssay: false,
            options: lessonQ.options || [],
            modelAnswer: cleanCorrectRef,
            reason: lessonQ.reason || '',
            concept: lessonQ.concept || '',
            paragraph: lessonQ.paragraph || '',
            studentAnswer,
            earnedScore,
            maxScore,
            isCorrect,
            isWrong,
            teacherFeedback: isCorrect ? 'إجابة صحيحة' : 'تحتاج مراجعة',
            subItem: explicitSubItem
          };
        }
      });
    }

    // في حال عدم توفر المنهج المحلي، نعتمد على الأسئلة المخزنة في التسليم
    return subQs
      .filter(q => !q.questionText.includes('الأسئلة الموضوعية') && !q.questionText.includes('الاختياري والصح/خطأ'))
      .map((sq, idx) => {
        const isEssay = sq.essayType !== 'اختر من متعدد' && sq.essayType !== 'صح وخطأ';
        const earnedScore = sq.teacherScore !== undefined 
          ? Number(sq.teacherScore) 
          : (sq.aiScore !== undefined ? Number(sq.aiScore) : 0);
        const maxScore = sq.maxScore || (isEssay ? 2 : 1);
        const isCorrect = earnedScore > 0;
        const isWrong = earnedScore === 0;

        return {
          qIndex: sq.qIndex >= 0 ? sq.qIndex : idx,
          questionText: sq.questionText,
          type: isEssay ? ('essay' as const) : (sq.essayType === 'صح وخطأ' ? ('tf' as const) : ('mcq' as const)),
          isEssay,
          options: [],
          modelAnswer: sq.modelAnswer || '',
          reason: '',
          concept: sq.concept || '',
          paragraph: sq.paragraph || '',
          studentAnswer: sq.studentText || '',
          earnedScore,
          maxScore,
          isCorrect,
          isWrong,
          teacherFeedback: sq.teacherFeedback || sq.aiFeedback || '',
          subItem: sq
        };
      });
  }, [submission, matchedLesson, scores, permanentMistakes]);

  // إحصائيات التصفية الدقيقة
  const counts = useMemo(() => {
    let wrong = 0;
    let correct = 0;
    let essay = 0;

    processedQuestions.forEach(q => {
      if (q.isEssay) {
        essay++;
        if (q.earnedScore < q.maxScore) wrong++;
        if (q.earnedScore > 0) correct++;
      } else {
        if (q.isWrong) wrong++;
        if (q.isCorrect) correct++;
      }
    });

    return {
      total: processedQuestions.length,
      wrong,
      correct,
      essay
    };
  }, [processedQuestions]);

  // تصفية الأسئلة المعروضة
  const filteredQuestions = useMemo(() => {
    return processedQuestions.filter(q => {
      if (activeFilter === 'wrong' && !q.isWrong && (!q.isEssay || q.earnedScore >= q.maxScore)) {
        return false;
      }
      if (activeFilter === 'correct' && !q.isCorrect) {
        return false;
      }
      if (activeFilter === 'essay' && !q.isEssay) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const inText = q.questionText.toLowerCase().includes(query);
        const inAns = q.studentAnswer.toLowerCase().includes(query);
        const inModel = q.modelAnswer.toLowerCase().includes(query);
        const inConcept = (q.concept || '').toLowerCase().includes(query);
        if (!inText && !inAns && !inModel && !inConcept) return false;
      }

      return true;
    });
  }, [processedQuestions, activeFilter, searchQuery]);

  // أمر طباعة كامل الامتحان (مع التأكد من شمول كافة الأسئلة وإلغاء التصفية إن أراد)
  const handlePrintFullExam = () => {
    if (activeFilter !== 'all') {
      setActiveFilter('all');
      setTimeout(() => {
        window.print();
      }, 150);
    } else {
      window.print();
    }
  };

  const gender = detectArabicGender(submission.studentName);
  const isFemale = gender === 'female';
  const isOnline = submission.studentType === 'أونلاين' || (submission.studentPhone && submission.studentPhone.includes('ESON'));

  return createPortal(
    <div 
      id="student-exam-inspection-overlay"
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99999] flex items-center justify-center p-2 sm:p-4 md:p-6 animate-fade-in"
      dir="rtl"
    >
      {/* ستايلات الطباعة المخصصة لطباعة كامل الامتحان وتوليد ملف PDF متكامل ومتعدد الصفحات */}
      <style>{`
        @media print {
          /* إخفاء كل العناصر الخارجية للصفحة */
          body * {
            visibility: hidden !important;
          }

          /* إظهار نافذة الامتحان بالكامل فقط */
          #student-exam-inspection-modal,
          #student-exam-inspection-modal * {
            visibility: visible !important;
          }

          /* ضبط الصفحة الحاوية */
          body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }

          #student-exam-inspection-overlay {
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            height: auto !important;
            min-height: auto !important;
            max-height: none !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            overflow: visible !important;
          }

          #student-exam-inspection-modal {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            max-height: none !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            display: block !important;
            overflow: visible !important;
          }

          #student-exam-questions-container {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            display: block !important;
            padding: 0 !important;
          }

          /* إخفاء عناصر التحكم والأزرار غير المخصصة للطباعة */
          .no-print {
            display: none !important;
          }

          /* بطاقة السؤال: منع تقسيمها في منتصفها بين صفحتين وإبراز حدودها */
          .print-question-card {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            margin-bottom: 16px !important;
            border: 1.5px solid #cbd5e1 !important;
            border-radius: 12px !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            padding: 14px !important;
          }

          /* ترويسة وتذييل الورقة للطباعة */
          .print-sheet-header {
            border-bottom: 2px solid #0f172a !important;
            padding-bottom: 12px !important;
            margin-bottom: 16px !important;
            display: block !important;
          }

          @page {
            size: A4 portrait;
            margin: 12mm 10mm 12mm 10mm;
          }
        }
      `}</style>

      <div 
        id="student-exam-inspection-modal"
        className={`w-full max-w-4xl max-h-[95vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border-2 transition-colors ${
          isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-primary/20 text-gray-900'
        }`}
      >
        {/* Header الرئيسي للنافذة (يظهر في الشاشة والطباعة) */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent dark:from-primary/20 p-4 sm:p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3 shrink-0 print-sheet-header">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center text-xl shadow-md shrink-0 no-print">
              <i className="fas fa-file-signature"></i>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-xl font-black truncate">
                  ورقة إجابات {isFemale ? 'الطالبة' : 'الطالب'}: <span className="text-primary dark:text-blue-400">{submission.studentName}</span>
                </h3>
                <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md" dir="ltr">
                  {formatPhoneStr(submission.studentPhone)}
                </span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  isOnline 
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' 
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                }`}>
                  {isOnline ? '🌐 أونلاين' : '🏫 سنتر'}
                </span>
                {submission.isFullyApproved && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300">
                    ✅ معتمد
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1 flex items-center gap-3 flex-wrap">
                <span className="text-primary font-black"><i className="fas fa-book-open ml-1"></i> {submission.quizTitle}</span>
                <span><i className="fas fa-calendar-alt ml-1"></i> تاريخ التسليم: {submission.submissionDate}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 no-print">
            <button
              type="button"
              onClick={handlePrintFullExam}
              className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-dark text-white text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95"
              title="طباعة كامل ورقة الإجابة بملف PDF متعدد الصفحات"
            >
              <i className="fas fa-print"></i>
              <span>طباعة الامتحان كاملاً (PDF)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-rose-100 hover:text-rose-600 dark:bg-gray-800 dark:hover:bg-rose-950 text-gray-500 text-base font-black flex items-center justify-center transition-colors cursor-pointer"
              title="إغلاق"
            >
              ✕
            </button>
          </div>
        </div>

        {/* بطاقة ملخص الدرجات الشاملة (الموضوعي + المقالي + المجموع) */}
        <div className="p-3 sm:p-4 bg-gray-50/80 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            {/* المجموع الكلي */}
            <div className="p-3 rounded-2xl bg-white dark:bg-gray-800 border-2 border-emerald-300 dark:border-emerald-700 shadow-2xs">
              <span className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 block mb-0.5">
                🏆 المجموع الكلي:
              </span>
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-lg sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">
                  {toEasternArabic(scores.totalEarned)}
                </span>
                <span className="text-xs font-bold text-gray-400">
                  من {toEasternArabic(scores.totalMax)}
                </span>
                <span className="text-[11px] font-black px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 mr-auto font-mono">
                  {toEasternArabic(scores.perc)}%
                </span>
              </div>
            </div>

            {/* درجات الموضوعي */}
            <div className="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 shadow-2xs">
              <span className="text-[10px] sm:text-xs font-bold text-blue-700 dark:text-blue-300 block mb-0.5 flex items-center gap-1">
                <i className="fas fa-check-double text-blue-500"></i> الأسئلة الموضوعية:
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base sm:text-xl font-black text-blue-900 dark:text-blue-200">
                  {toEasternArabic(scores.mcqEarned)}
                </span>
                <span className="text-xs font-bold text-gray-400">
                  من {toEasternArabic(scores.mcqMax)}
                </span>
              </div>
            </div>

            {/* درجات المقالي */}
            <div className="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 shadow-2xs">
              <span className="text-[10px] sm:text-xs font-bold text-purple-700 dark:text-purple-300 block mb-0.5 flex items-center gap-1">
                <i className="fas fa-feather-alt text-purple-500"></i> الأسئلة المقالية:
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base sm:text-xl font-black text-purple-900 dark:text-purple-200">
                  {toEasternArabic(scores.essayEarned)}
                </span>
                <span className="text-xs font-bold text-gray-400">
                  من {toEasternArabic(scores.essayMax)}
                </span>
              </div>
            </div>

            {/* إحصائية الأسئلة */}
            <div className="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-center">
              <span className="text-[10px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1">
                📊 رصد الإجابات:
              </span>
              <div className="flex items-center gap-2 text-xs font-black">
                <span className="text-emerald-600 flex items-center gap-0.5" title="إجابات صحيحة">
                  <i className="fas fa-check-circle"></i> {toEasternArabic(counts.correct)}
                </span>
                <span className="text-rose-600 flex items-center gap-0.5" title="أخطاء تحتاج مراجعة">
                  <i className="fas fa-times-circle"></i> {toEasternArabic(counts.wrong)}
                </span>
                <span className="text-purple-600 flex items-center gap-0.5" title="أسئلة مقالية">
                  <i className="fas fa-pen-nib"></i> {toEasternArabic(counts.essay)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* شريط التصفية والبحث السريع (لا يظهر في الطباعة) */}
        <div className="px-3 sm:px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 bg-white dark:bg-gray-900 no-print">
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                activeFilter === 'all'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              جميع الأسئلة ({toEasternArabic(counts.total)})
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter('wrong')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                activeFilter === 'wrong'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
              }`}
            >
              <span>الأخطاء فقط</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-white">
                {toEasternArabic(counts.wrong)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter('correct')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                activeFilter === 'correct'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
              }`}
            >
              <span>الصحيحة</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-white">
                {toEasternArabic(counts.correct)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter('essay')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                activeFilter === 'essay'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-purple-50 hover:bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300'
              }`}
            >
              <span>المقالي</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-white">
                {toEasternArabic(counts.essay)}
              </span>
            </button>
          </div>

          {/* حقل البحث السريع في نص الأسئلة أو الإجابات */}
          <div className="relative w-full sm:w-60">
            <i className="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
            <input 
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="بحث في السؤال أو الإجابة..."
              className="w-full pr-8 pl-3 py-1.5 text-xs font-bold rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:bg-white outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
        </div>

        {/* جسم ورقة الأسئلة مع التمرير السلس والطباعة المتتالية الكاملة */}
        <div 
          id="student-exam-questions-container"
          className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 custom-scrollbar"
        >
          {filteredQuestions.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <i className="fas fa-clipboard-check text-4xl mb-2 block text-gray-300"></i>
              <p className="font-black text-sm">لا توجد أسئلة مطابقة للتصفية المحددة حالياً.</p>
            </div>
          ) : (
            filteredQuestions.map((q) => {
              const isMcqOrTf = !q.isEssay;
              const hasNoStudentText = !q.studentAnswer || q.studentAnswer.trim() === '' || q.studentAnswer.includes('لم يكتب') || q.studentAnswer.includes('لم يتم الإجابة');

              return (
                <div
                  key={q.qIndex}
                  className={`print-question-card p-4 sm:p-5 rounded-2xl border-2 transition-all ${
                    q.isEssay
                      ? 'bg-purple-50/20 border-purple-200 dark:bg-purple-950/10 dark:border-purple-800'
                      : q.isCorrect
                        ? 'bg-emerald-50/25 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-800'
                        : q.isWrong
                          ? 'bg-rose-50/30 border-rose-300 dark:bg-rose-950/10 dark:border-rose-800'
                          : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700'
                  }`}
                >
                  {/* رأس السؤال */}
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-3 border-b border-gray-100 dark:border-gray-700/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-primary text-white text-xs font-black flex items-center justify-center shrink-0 shadow-2xs">
                        {toEasternArabic(q.qIndex + 1)}
                      </span>
                      <span className="text-xs font-black text-gray-700 dark:text-gray-300">
                        {q.isEssay ? '✍️ سؤال مقالي' : (q.type === 'tf' ? '⚖️ صح وخطأ' : '🔘 اختر من متعدد')}
                      </span>
                      {q.concept && (
                        <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 px-2 py-0.5 rounded-full">
                          💡 {q.concept}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {q.isEssay ? (
                        <span className="text-xs font-black px-2.5 py-1 rounded-full bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200 border border-purple-300">
                          درجة السؤال: {toEasternArabic(q.earnedScore)} من {toEasternArabic(q.maxScore)}
                        </span>
                      ) : (
                        <>
                          {q.isCorrect ? (
                            <span className="text-xs font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300 flex items-center gap-1">
                              <i className="fas fa-check-circle"></i>
                              <span>إجابة صحيحة ({toEasternArabic(q.earnedScore)} من {toEasternArabic(q.maxScore)})</span>
                            </span>
                          ) : (
                            <span className="text-xs font-black px-2.5 py-1 rounded-full bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200 border border-rose-300 flex items-center gap-1">
                              <i className="fas fa-times-circle"></i>
                              <span>إجابة خاطئة (0 من {toEasternArabic(q.maxScore)})</span>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* نص السؤال */}
                  <h4 className="text-sm sm:text-base font-black text-gray-900 dark:text-gray-100 mb-3.5 leading-relaxed">
                    <FormatQuestionText text={q.questionText} concept={q.concept} isDarkMode={isDarkMode} />
                  </h4>

                  {/* خيارات السؤال إذا كانت متوفرة بالمنهج (MCQ / TF) مع تظليل دقيق لإجابة الطالب والإجابة الصحيحة */}
                  {isMcqOrTf && q.options && q.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                      {q.options.map((opt, optIdx) => {
                        // 1. التحقق الدقيق مما إذا كان هذا الخيار هو الإجابة النموذجية الصحيحة
                        const isModelCorrect = checkAnswerAccurately(opt, q.modelAnswer, optIdx, q.options);

                        // 2. التحقق مما إذا كان الطالب قد اختار هذا الخيار تحديداً
                        let isChosenByStudent = false;

                        if (q.studentAnswer && q.studentAnswer.trim()) {
                          isChosenByStudent = checkAnswerAccurately(opt, q.studentAnswer, optIdx, q.options) ||
                                              normalizeArabicForComparison(opt) === normalizeArabicForComparison(q.studentAnswer);
                        } else if (q.isCorrect || (scores.mcqMax > 0 && scores.mcqEarned >= scores.mcqMax)) {
                          // إذا كان الطالب قد أجاب بشكل صحيح (أو 100% في الموضوعي)، فخيار الطالب هو الخيار النموذجي
                          isChosenByStudent = isModelCorrect;
                        }

                        // تحديد نمط وتلوين الخيار
                        let optStyle = 'bg-gray-50 border-gray-200 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300';
                        if (isModelCorrect) {
                          optStyle = 'bg-emerald-100/90 border-emerald-500 text-emerald-950 font-black ring-1 ring-emerald-500 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-600';
                        } else if (isChosenByStudent && !isModelCorrect) {
                          optStyle = 'bg-rose-100/90 border-rose-500 text-rose-950 font-black line-through ring-1 ring-rose-500 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-600';
                        }

                        return (
                          <div 
                            key={optIdx} 
                            className={`p-2.5 sm:p-3 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-2 transition-all ${optStyle}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-5 h-5 rounded-full bg-white/80 dark:bg-black/30 text-[10px] font-bold flex items-center justify-center shrink-0">
                                {String.fromCharCode(65 + optIdx)}
                              </span>
                              <span className="truncate">{opt}</span>
                            </div>

                            <div className="shrink-0 flex items-center gap-1">
                              {isChosenByStudent && (
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-md shadow-2xs ${
                                  isModelCorrect ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                                }`}>
                                  {isModelCorrect ? '✔ اختيار الطالب (صحيح)' : '✖ اختيار الطالب (خطأ)'}
                                </span>
                              )}
                              {!isChosenByStudent && isModelCorrect && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-700 text-white shadow-2xs">
                                  ⭐ الإجابة النموذجية
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* إجابة الطالب الصريحة إذا لم تكن هناك خيارات معروضة */}
                  {isMcqOrTf && (!q.options || q.options.length === 0) && q.studentAnswer && (
                    <div className={`p-3 rounded-xl border text-xs sm:text-sm mb-2.5 ${
                      q.isCorrect 
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200' 
                        : 'bg-rose-50 border-rose-300 text-rose-950 dark:bg-rose-950/40 dark:text-rose-200'
                    }`}>
                      <span className="font-bold">إجابة الطالب: </span>
                      <span className="font-black">{q.studentAnswer}</span>
                    </div>
                  )}

                  {/* توضيح الإجابة الصحيحة النموذجية عند خطأ الطالب في سؤال موضوعي */}
                  {isMcqOrTf && q.isWrong && q.modelAnswer && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm mb-2">
                      <div className="flex items-center gap-1.5 font-black text-emerald-800 dark:text-emerald-300 mb-1">
                        <i className="fas fa-lightbulb text-amber-500"></i>
                        <span>الإجابة الصحيحة النموذجية:</span>
                      </div>
                      <p className="font-black text-emerald-900 dark:text-emerald-200 mr-5">
                        {q.modelAnswer}
                      </p>
                    </div>
                  )}

                  {/* في الأسئلة المقالية: عرض ما كتبه الطالب ونموذج الإجابة وتوجيه المعلم */}
                  {q.isEssay && (
                    <div className="space-y-2.5 mb-2">
                      {/* إجابة الطالب المكتوبة */}
                      <div className="bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-inner">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1">
                          ✍️ إجابة {isFemale ? 'الطالبة' : 'الطالب'} المكتوبة:
                        </span>
                        <p className={`text-xs sm:text-sm font-black whitespace-pre-wrap leading-relaxed ${
                          hasNoStudentText ? 'text-gray-400 italic' : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {q.studentAnswer || 'لم يكتب الطالب إجابة لهذا السؤال.'}
                        </p>
                      </div>

                      {/* نموذج الإجابة المعتمد بالمنهج */}
                      {q.modelAnswer && (
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-800">
                          <span className="text-xs font-black text-emerald-800 dark:text-emerald-300 block mb-1">
                            <i className="fas fa-clipboard-check ml-1 text-emerald-600"></i> نموذج الإجابة المعتمد بالمنهج:
                          </span>
                          <p className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-100 whitespace-pre-wrap leading-relaxed">
                            {q.modelAnswer}
                          </p>
                        </div>
                      )}

                      {/* توجيه وملاحظات المعلم */}
                      {q.teacherFeedback && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-200 dark:border-blue-800 text-xs">
                          <span className="font-black text-blue-900 dark:text-blue-300">
                            <i className="fas fa-comment-dots ml-1 text-blue-600"></i> ملاحظة وتوجيه المعلم:
                          </span>
                          <p className="text-blue-950 dark:text-blue-100 font-bold mt-1 mr-4">
                            {q.teacherFeedback}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* التفسير والتعليل التاريخي */}
                  {q.reason && (
                    <div className="p-2.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-200 text-xs mt-2">
                      <span className="font-black">📖 التفسير والتعليل: </span>
                      <span>{q.reason}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer السفلي (أزرار التحكم - لا تظهر في الطباعة) */}
        <div className="p-3 sm:p-4 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3 shrink-0 no-print">
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400">
            إجمالي الأسئلة المعروضة: <strong>{toEasternArabic(filteredQuestions.length)}</strong> من {toEasternArabic(processedQuestions.length)}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintFullExam}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <i className="fas fa-print"></i>
              <span>طباعة الامتحان (PDF)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-primary hover:bg-primary-dark text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
