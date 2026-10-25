import React, { useState, useMemo } from 'react';
import { Question, Unit, StudentEssaySubmission, PermanentMistakeItem } from '../types';
import { toEasternArabic, simpleHash } from '../utils';
import { FormatQuestionText } from './FormatQuestionText';
import { HighlightText } from './HighlightText';

export interface EnrichedMistakeItem {
  id: string;
  question: Question;
  unitId: string;
  unitTitle: string;
  lessonId: string;
  lessonTitle: string;
  studentAnswerText?: string;
  studentSelectedOption?: string;
  modelAnswer: string;
  reason?: string;
  concept?: string;
  isEssay: boolean;
  essayType?: string;
  teacherScore?: number;
  maxScore?: number;
  teacherFeedback?: string;
  timestamp?: number;
}

interface MistakesNotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
  permanentMistakes?: PermanentMistakeItem[];
  mistakes?: Question[];
  unitsData: Unit[];
  essaySubmissions?: StudentEssaySubmission[];
  isDarkMode?: boolean;
  onDeleteMistake?: (id: string) => void;
  onClearNotebook?: () => void;
}

const MASTERED_MISTAKES_KEY = "kanz_mastered_mistakes_hashes";

// مساعدة للتحقق من تطابق الخيار مع الإجابة الصحيحة
const isOptionCorrect = (opt: string, corr: string): boolean => {
  if (!opt || !corr) return false;
  const o = opt.trim().toLowerCase();
  const c = corr.trim().toLowerCase();
  if (o === c) return true;
  if (o.startsWith(c + ')') || o.startsWith(c + ' -') || o.startsWith(c + ' :') || o.startsWith(c + '.')) return true;
  
  const isT_opt = o.includes('صحيح') || o === 'صح' || o === 'ص' || o === 'true' || o === 't' || o === '1';
  const isF_opt = o.includes('خطأ') || o.includes('خاطئ') || o === 'خ' || o === 'false' || o === 'f' || o === '2';
  const isT_corr = c.includes('صحيح') || c === 'صح' || c === 'ص' || c === 'true' || c === 't' || c === '1';
  const isF_corr = c.includes('خطأ') || c.includes('خاطئ') || c === 'خ' || c === 'false' || c === 'f' || c === '2';
  if (isT_opt && isT_corr) return true;
  if (isF_opt && isF_corr) return true;
  return false;
};

export const MistakesNotebookModal: React.FC<MistakesNotebookModalProps> = ({
  isOpen,
  onClose,
  permanentMistakes = [],
  mistakes = [],
  unitsData = [],
  essaySubmissions = [],
  isDarkMode = false,
  onDeleteMistake,
  onClearNotebook,
}) => {
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'mcq' | 'essay'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showMasteredOnly, setShowMasteredOnly] = useState<'all' | 'unmastered' | 'mastered'>('all');
  
  // حفظ الأسئلة المستوعبة محلياً
  const [masteredHashes, setMasteredHashes] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(MASTERED_MISTAKES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  const toggleMastered = (hash: string) => {
    setMasteredHashes(prev => {
      const updated = prev.includes(hash) ? prev.filter(h => h !== hash) : [...prev, hash];
      try {
        localStorage.setItem(MASTERED_MISTAKES_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // تجميع وربط كافة الأخطاء (سواء من السجل الدائم أو بنك الأخطاء أو المقالي)
  const enrichedMistakes = useMemo<EnrichedMistakeItem[]>(() => {
    const list: EnrichedMistakeItem[] = [];
    const seenQuestionHashes = new Set<string>();

    // 1. أولاً: الأخطاء المسجلة في كشكول الأخطاء الدائم (الأعلى أولوية ودقة)
    if (Array.isArray(permanentMistakes)) {
      permanentMistakes.forEach(pm => {
        if (!pm || !pm.question || !pm.question.q) return;
        const qHash = simpleHash(pm.question.q || pm.id);
        if (seenQuestionHashes.has(qHash)) return;
        seenQuestionHashes.add(qHash);

        // استنتاج الوحدة والدرس إن لم يكونا محددين بدقة
        let uTitle = pm.unitTitle || 'الوحدة العامة';
        let uId = pm.unitId || 'general';
        let lTitle = pm.lessonTitle || 'مراجعة المنهج';
        let lId = pm.lessonId || 'general_lesson';

        if (uId === 'general' || !uTitle) {
          if (Array.isArray(unitsData)) {
            for (const u of unitsData) {
              if (!u || !Array.isArray(u.lessons)) continue;
              for (const l of u.lessons) {
                if (!l || !Array.isArray(l.questions)) continue;
                if (l.questions.some(item => item && (simpleHash(item.q) === qHash || item.q === pm.question.q))) {
                  uTitle = u.title;
                  uId = u.id;
                  lTitle = l.title;
                  lId = l.id;
                  break;
                }
              }
            }
          }
        }

        // تحديد الإجابة النموذجية الصحيحة بدقة
        let modelAns = pm.modelAnswer || pm.question.correct || pm.question.answer || '';
        if (!pm.isEssay && pm.question.options && pm.question.options.length > 0) {
          const matchingOpt = pm.question.options.find(opt => isOptionCorrect(opt, pm.question.correct));
          if (matchingOpt) modelAns = matchingOpt;
        }

        list.push({
          id: pm.id || `nb_${qHash}`,
          question: pm.question,
          unitId: uId,
          unitTitle: uTitle,
          lessonId: lId,
          lessonTitle: lTitle,
          studentAnswerText: pm.studentAnswerText || pm.studentSelectedOption,
          studentSelectedOption: pm.studentSelectedOption,
          modelAnswer: modelAns,
          reason: pm.reason || pm.question.reason || '',
          concept: pm.concept || pm.question.concept || pm.question.paragraph || '',
          isEssay: pm.isEssay || pm.question.type === 'essay',
          essayType: pm.essayType || pm.question.essayType,
          teacherScore: pm.teacherScore,
          maxScore: pm.maxScore || pm.question.maxScore,
          teacherFeedback: pm.teacherFeedback,
          timestamp: pm.timestamp
        });
      });
    }

    // 2. ثانياً: أخطاء بنك الأسئلة المباشر إن وُجدت ولم تُسجل بعد
    if (Array.isArray(mistakes)) {
      mistakes.forEach(q => {
        if (!q || !q.q) return;
        const qText = q.q || '';
        const qHash = simpleHash(qText);
        if (seenQuestionHashes.has(qHash)) return;
        seenQuestionHashes.add(qHash);

        let foundUnitTitle = 'الوحدة الدراسية';
        let foundUnitId = 'general';
        let foundLessonTitle = 'اختبار تدريبي';
        let foundLessonId = 'general_lesson';

        if (Array.isArray(unitsData)) {
          for (const u of unitsData) {
            if (!u || !Array.isArray(u.lessons)) continue;
            for (const l of u.lessons) {
              if (!l || !Array.isArray(l.questions)) continue;
              if (l.questions.some(item => item && (simpleHash(item.q) === qHash || item.q === qText))) {
                foundUnitTitle = u.title;
                foundUnitId = u.id;
                foundLessonTitle = l.title;
                foundLessonId = l.id;
                break;
              }
            }
          }
        }

        let modelAns = q.correct || q.answer || '';
        if (q.type !== 'essay' && q.options && q.options.length > 0) {
          const matchingOpt = q.options.find(opt => isOptionCorrect(opt, q.correct));
          if (matchingOpt) modelAns = matchingOpt;
        }

        list.push({
          id: `m_${qHash}`,
          question: q,
          unitId: foundUnitId,
          unitTitle: foundUnitTitle,
          lessonId: foundLessonId,
          lessonTitle: foundLessonTitle,
          modelAnswer: modelAns,
          reason: q.reason || '',
          concept: q.concept || q.paragraph || '',
          isEssay: q.type === 'essay',
          essayType: q.essayType || (q.type === 'essay' ? 'سؤال مقالي' : undefined),
        });
      });
    }

    // 3. ثالثاً: الأسئلة المقالية المسجلة في تسليمات الطالب
    if (Array.isArray(essaySubmissions)) {
      essaySubmissions.forEach(sub => {
        if (!sub || !sub.isFullyApproved || !Array.isArray(sub.questions)) return;
        sub.questions.forEach(eq => {
          if (!eq || !eq.questionText) return;
          const qHash = simpleHash(eq.questionText);
          const isNotFullScore = eq.teacherScore !== undefined && eq.teacherScore < eq.maxScore;
          
          let foundUnitTitle = 'الوحدة';
          let foundUnitId = 'general';
          if (Array.isArray(unitsData)) {
            for (const u of unitsData) {
              if (!u || !Array.isArray(u.lessons)) continue;
              if (u.lessons.some(l => l && (l.id === sub.lessonId || l.title === sub.quizTitle))) {
                foundUnitTitle = u.title;
                foundUnitId = u.id;
                break;
              }
            }
          }

          const existingIdx = list.findIndex(item => item.question && item.question.q === eq.questionText);
        if (existingIdx !== -1) {
          list[existingIdx].studentAnswerText = eq.studentText;
          list[existingIdx].teacherScore = eq.teacherScore;
          list[existingIdx].maxScore = eq.maxScore;
          list[existingIdx].teacherFeedback = eq.teacherFeedback || eq.aiFeedback;
          if (eq.modelAnswer) list[existingIdx].modelAnswer = eq.modelAnswer;
        } else if (isNotFullScore && eq.isApproved) {
          if (!seenQuestionHashes.has(qHash)) {
            seenQuestionHashes.add(qHash);
            list.push({
              id: `sub_m_${qHash}`,
              question: {
                type: 'essay',
                q: eq.questionText,
                options: [],
                correct: eq.modelAnswer,
                reason: '',
                answer: eq.modelAnswer,
                concept: '',
                paragraph: '',
                section: '',
                essayType: eq.essayType,
                maxScore: eq.maxScore,
              },
              unitId: foundUnitId,
              unitTitle: foundUnitTitle,
              lessonId: sub.lessonId,
              lessonTitle: sub.quizTitle,
              studentAnswerText: eq.studentText,
              modelAnswer: eq.modelAnswer,
              isEssay: true,
              essayType: eq.essayType,
              teacherScore: eq.teacherScore,
              maxScore: eq.maxScore,
              teacherFeedback: eq.teacherFeedback || eq.aiFeedback,
            });
          }
        }
      });
    });
  }

  return list;
}, [permanentMistakes, mistakes, unitsData, essaySubmissions]);

  // استخراج قائمة الوحدات المتاحة التي تحتوي على أخطاء
  const availableUnits = useMemo(() => {
    const unitMap = new Map<string, { id: string; title: string; count: number }>();
    enrichedMistakes.forEach(item => {
      const existing = unitMap.get(item.unitId);
      if (existing) {
        existing.count++;
      } else {
        unitMap.set(item.unitId, { id: item.unitId, title: item.unitTitle, count: 1 });
      }
    });
    return Array.from(unitMap.values());
  }, [enrichedMistakes]);

  // استخراج قائمة الدروس التابعة للوحدة المحددة
  const availableLessons = useMemo(() => {
    if (selectedUnitId === 'all') return [];
    const lessonMap = new Map<string, { id: string; title: string; count: number }>();
    enrichedMistakes
      .filter(item => item.unitId === selectedUnitId)
      .forEach(item => {
        const existing = lessonMap.get(item.lessonId);
        if (existing) {
          existing.count++;
        } else {
          lessonMap.set(item.lessonId, { id: item.lessonId, title: item.lessonTitle, count: 1 });
        }
      });
    return Array.from(lessonMap.values());
  }, [enrichedMistakes, selectedUnitId]);

  // الفلترة النهائية للأسئلة
  const filteredMistakes = useMemo(() => {
    return enrichedMistakes.filter(item => {
      // فلتر الوحدة
      if (selectedUnitId !== 'all' && item.unitId !== selectedUnitId) return false;

      // فلتر الدرس
      if (selectedLessonId !== 'all' && item.lessonId !== selectedLessonId) return false;

      // فلتر نوع السؤال
      if (typeFilter === 'essay' && !item.isEssay) return false;
      if (typeFilter === 'mcq' && item.isEssay) return false;

      // فلتر الإتقان
      const isMastered = masteredHashes.includes(simpleHash(item.question.q));
      if (showMasteredOnly === 'unmastered' && isMastered) return false;
      if (showMasteredOnly === 'mastered' && !isMastered) return false;

      // فلتر البحث النصي
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inQuestion = item.question.q.toLowerCase().includes(q);
        const inLesson = item.lessonTitle.toLowerCase().includes(q);
        const inUnit = item.unitTitle.toLowerCase().includes(q);
        const inConcept = (item.concept || '').toLowerCase().includes(q);
        const inAnswer = (item.modelAnswer || '').toLowerCase().includes(q);
        if (!inQuestion && !inLesson && !inUnit && !inConcept && !inAnswer) return false;
      }

      return true;
    });
  }, [enrichedMistakes, selectedUnitId, selectedLessonId, typeFilter, showMasteredOnly, searchQuery, masteredHashes]);

  // إحصائيات سريعة
  const stats = useMemo(() => {
    const total = enrichedMistakes.length;
    const mastered = enrichedMistakes.filter(m => masteredHashes.includes(simpleHash(m.question.q))).length;
    const essays = enrichedMistakes.filter(m => m.isEssay).length;
    const mcqs = total - essays;
    return { total, mastered, essays, mcqs };
  }, [enrichedMistakes, masteredHashes]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in" dir="rtl">
      <div 
        className={`w-full max-w-5xl h-[92vh] max-h-[850px] rounded-3xl shadow-2xl flex flex-col overflow-hidden border ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-purple-200 text-slate-900'
        }`}
      >
        {/* ===================== رأس النافذة ===================== */}
        <div className="p-4 sm:p-5 border-b border-purple-100 dark:border-slate-800 bg-gradient-to-r from-purple-50 via-indigo-50/50 to-white dark:from-slate-900 dark:via-purple-950/30 dark:to-slate-900 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 sm:w-13 sm:h-13 rounded-2xl bg-purple-600 text-white flex items-center justify-center text-xl sm:text-2xl shadow-lg shadow-purple-600/30 shrink-0">
                <i className="fas fa-book-bookmark"></i>
              </div>
              <div>
                <h2 className="text-lg sm:text-2xl font-black text-purple-950 dark:text-purple-100 flex items-center gap-2">
                  <span>كشكول أهم الأخطاء والنموذج المعتمد</span>
                  <span className="text-xl">📚</span>
                </h2>
                <p className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                  مرجعك الدائم للمراجعة الشاملة لجميع الأسئلة مع نماذج الإجابة وشرح أ/ إسلام سعود
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onClearNotebook && stats.total > 0 && (
                <button
                  onClick={onClearNotebook}
                  className="px-3 py-1.5 rounded-xl text-xs font-black text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 dark:border-rose-900/60 dark:bg-rose-950/30 transition-all cursor-pointer shadow-xs active:scale-95 flex items-center gap-1.5"
                  title="مسح الكشكول والبدء من جديد"
                >
                  <i className="fas fa-trash-alt text-[11px]"></i>
                  <span className="hidden sm:inline">تفريغ الكشكول</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 transition-colors shadow-sm cursor-pointer"
                title="إغلاق"
              >
                <i className="fas fa-times text-base sm:text-lg"></i>
              </button>
            </div>
          </div>

          {/* شارات الإحصائيات العلوية */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3 pt-3 border-t border-purple-100/70 dark:border-slate-800/80">
            <span className="px-3 py-1 rounded-xl bg-purple-100/90 dark:bg-purple-950/70 text-purple-900 dark:text-purple-200 text-xs font-black flex items-center gap-1.5">
              <i className="fas fa-layer-group text-purple-600"></i>
              <span>إجمالي الأخطاء المحفوظة: {toEasternArabic(stats.total)}</span>
            </span>

            <span className="px-3 py-1 rounded-xl bg-emerald-100/90 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 text-xs font-black flex items-center gap-1.5">
              <i className="fas fa-check-circle text-emerald-600"></i>
              <span>تم إتقانه: {toEasternArabic(stats.mastered)}</span>
            </span>

            <span className="px-3 py-1 rounded-xl bg-indigo-100/90 dark:bg-indigo-950/70 text-indigo-900 dark:text-indigo-200 text-xs font-black flex items-center gap-1.5">
              <i className="fas fa-feather-alt text-indigo-600"></i>
              <span>مقالي: {toEasternArabic(stats.essays)}</span>
            </span>

            <span className="px-3 py-1 rounded-xl bg-blue-100/90 dark:bg-blue-950/70 text-blue-900 dark:text-blue-200 text-xs font-black flex items-center gap-1.5">
              <i className="fas fa-list-check text-blue-600"></i>
              <span>اختياري / صح وخطأ: {toEasternArabic(stats.mcqs)}</span>
            </span>
          </div>
        </div>

        {/* ===================== شريط التبويبات والفلترة المنظمة ===================== */}
        <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-3 shrink-0">
          {/* 1. تبويبات الوحدات الدراسية (مبوّبة) */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
            <button
              onClick={() => {
                setSelectedUnitId('all');
                setSelectedLessonId('all');
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                selectedUnitId === 'all'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
              }`}
            >
              🌐 الكل ({toEasternArabic(stats.total)})
            </button>

            {availableUnits.map(unit => (
              <button
                key={unit.id}
                onClick={() => {
                  setSelectedUnitId(unit.id);
                  setSelectedLessonId('all');
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                  selectedUnitId === unit.id
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                📂 {unit.title} ({toEasternArabic(unit.count)})
              </button>
            ))}
          </div>

          {/* 2. شريط الدروس المنسدلة التابعة للوحدة المحددة */}
          {selectedUnitId !== 'all' && availableLessons.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 custom-scrollbar bg-purple-50/50 dark:bg-purple-950/20 p-2 rounded-xl border border-purple-100 dark:border-purple-900/40">
              <span className="text-[11px] font-black text-purple-800 dark:text-purple-300 shrink-0">
                دروس الوحدة:
              </span>
              <button
                onClick={() => setSelectedLessonId('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                  selectedLessonId === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                كل دروس الوحدة
              </button>
              {availableLessons.map(lesson => (
                <button
                  key={lesson.id}
                  onClick={() => setSelectedLessonId(lesson.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                    selectedLessonId === lesson.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  📝 {lesson.title} ({toEasternArabic(lesson.count)})
                </button>
              ))}
            </div>
          )}

          {/* 3. شريط البحث والفلترة حسب النوع والإتقان */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            {/* خانة البحث */}
            <div className="relative flex-1 min-w-[180px]">
              <i className="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                placeholder="ابحث بنص السؤال أو المفهوم أو الكلمة..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-8 pl-3 py-1.5 text-xs font-bold rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-purple-500 transition-colors"
              />
            </div>

            {/* فلتر النوع */}
            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold shrink-0">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${typeFilter === 'all' ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 font-black' : 'text-slate-500'}`}
              >
                الكل
              </button>
              <button
                onClick={() => setTypeFilter('mcq')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${typeFilter === 'mcq' ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 font-black' : 'text-slate-500'}`}
              >
                اختياري / صح وخطأ
              </button>
              <button
                onClick={() => setTypeFilter('essay')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${typeFilter === 'essay' ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 font-black' : 'text-slate-500'}`}
              >
                مقالي 🪶
              </button>
            </div>

            {/* فلتر الإتقان */}
            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold shrink-0">
              <button
                onClick={() => setShowMasteredOnly('all')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${showMasteredOnly === 'all' ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-black' : 'text-slate-500'}`}
              >
                الجميع
              </button>
              <button
                onClick={() => setShowMasteredOnly('unmastered')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${showMasteredOnly === 'unmastered' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 font-black' : 'text-slate-500'}`}
              >
                بانتظار الفهم ⏳
              </button>
              <button
                onClick={() => setShowMasteredOnly('mastered')}
                className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${showMasteredOnly === 'mastered' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 font-black' : 'text-slate-500'}`}
              >
                تم الإتقان ✅
              </button>
            </div>
          </div>
        </div>

        {/* ===================== محتوى بطاقات الأسئلة المنظمة ===================== */}
        <div className="p-3 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {filteredMistakes.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
                <i className="fas fa-trophy"></i>
              </div>
              <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-200 mb-1">
                ما شاء الله! لا توجد أخطاء في هذا القسم
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                إما أنك أتقنت جميع الأسئلة أو لم تسجل أي أخطاء هنا. استمر في التميز والتفوق!
              </p>
            </div>
          ) : (
            filteredMistakes.map((item, idx) => {
              const qHash = simpleHash(item.question.q);
              const isMastered = masteredHashes.includes(qHash);

              return (
                <div
                  key={item.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all shadow-sm ${
                    isMastered
                      ? 'bg-emerald-50/20 border-emerald-200/80 dark:bg-emerald-950/10 dark:border-emerald-800/40'
                      : isDarkMode
                      ? 'bg-slate-800/60 border-slate-700/80'
                      : 'bg-white border-purple-100/80 hover:border-purple-300'
                  }`}
                >
                  {/* شريط رأس البطاقة المبوّب (الوحدة • الدرس • النوع • أدوات الإتقان والحذف) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-100 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-black text-xs flex items-center justify-center">
                        {toEasternArabic(idx + 1)}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        📁 {item.unitTitle}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/40">
                        📖 {item.lessonTitle}
                      </span>
                      {item.isEssay ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300">
                          {item.essayType || 'سؤال مقالي'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                          اختياري / صح وخطأ
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* زر الإتقان السريع */}
                      <button
                        onClick={() => toggleMastered(qHash)}
                        className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95 ${
                          isMastered
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-800 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                        title={isMastered ? "تم استيعابه (اضغط للإلغاء)" : "اضغط لتعيين السؤال كـ تم استيعابه"}
                      >
                        <i className={`fas ${isMastered ? 'fa-check-circle' : 'fa-circle'}`}></i>
                        <span>{isMastered ? 'تم الاستيعاب والإتقان 🎯' : 'تحديد كـ تم الفهم'}</span>
                      </button>

                      {/* زر الحذف الفردي من الكشكول */}
                      {onDeleteMistake && (
                        <button
                          onClick={() => onDeleteMistake(item.id)}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 text-xs p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="حذف هذا السؤال من الكشكول"
                        >
                          <i className="fas fa-trash-alt"></i>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* نص السؤال المنسق بدقة بالغة */}
                  <div className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 mb-3.5 leading-relaxed bg-slate-50/60 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <FormatQuestionText text={item.question.q} concept={item.concept} isDarkMode={isDarkMode} />
                  </div>

                  {/* الخيارات في حالة الأسئلة الاختيارية أو الصح والخطأ */}
                  {!item.isEssay && item.question.options && item.question.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3.5">
                      {item.question.options.map((opt, optIdx) => {
                        const isCorrectOpt = isOptionCorrect(opt, item.question.correct);
                        const isStudentOpt = item.studentSelectedOption && (
                          opt.trim() === item.studentSelectedOption.trim() ||
                          isOptionCorrect(opt, item.studentSelectedOption)
                        );

                        return (
                          <div
                            key={optIdx}
                            className={`p-2.5 sm:p-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-between gap-2 transition-all ${
                              isCorrectOpt
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-950 dark:text-emerald-200 ring-2 ring-emerald-400/50'
                                : isStudentOpt
                                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 text-rose-950 dark:text-rose-200'
                                : 'bg-white dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <span className="flex-1 leading-relaxed">{opt}</span>
                            {isCorrectOpt && (
                              <span className="shrink-0 text-[10px] sm:text-xs font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                                <i className="fas fa-check"></i> الإجابة النموذجية
                              </span>
                            )}
                            {!isCorrectOpt && isStudentOpt && (
                              <span className="shrink-0 text-[10px] sm:text-xs font-black bg-rose-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                                <i className="fas fa-times"></i> إجابتك السابقة
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* المفهوم أو الفقرة المرتبطة في المنهج */}
                  {item.concept && (
                    <div className="mb-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <i className="fas fa-bookmark text-amber-500"></i>
                      <span>المرجع في المنهج: {item.concept}</span>
                    </div>
                  )}

                  {/* إذا كان مقالياً: إجابة الطالب المسجلة وتفاصيل التقييم */}
                  {item.isEssay && item.studentAnswerText && (
                    <div className="mb-3 p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-black text-rose-700 dark:text-rose-400">
                          ✍️ إجابتك المسجلة:
                        </span>
                        {item.teacherScore !== undefined && item.maxScore !== undefined && (
                          <span className="text-xs font-black px-2 py-0.5 rounded-md bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100">
                            الدرجة: {toEasternArabic(item.teacherScore)} / {toEasternArabic(item.maxScore)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                        {item.studentAnswerText}
                      </p>
                    </div>
                  )}

                  {/* نموذج الإجابة المعتمد والصحيح (القلب النابض للكشكول) */}
                  <div className="mb-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                    <span className="block text-[11px] font-black text-emerald-800 dark:text-emerald-300 mb-1 flex items-center gap-1.5">
                      <i className="fas fa-check-circle text-emerald-600"></i>
                      <span>نموذج الإجابة المعتمد والصحيح:</span>
                    </span>
                    <div className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200 leading-relaxed">
                      <HighlightText text={item.modelAnswer || 'راجع التفسير أدناه'} isDarkMode={false} />
                    </div>
                  </div>

                  {/* الشرح والتفسير التربوي للمعلم أ/ إسلام سعود */}
                  {(item.reason || item.teacherFeedback) && (
                    <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-50/80 to-yellow-50/80 dark:from-amber-950/20 dark:to-yellow-950/20 border border-amber-200 dark:border-amber-800/40">
                      <span className="block text-[11px] font-black text-amber-900 dark:text-amber-300 mb-1 flex items-center gap-1.5">
                        <i className="fas fa-chalkboard-teacher text-amber-600"></i>
                        <span>توجيه وشرح المعلم أ/ إسلام سعود:</span>
                      </span>
                      <div className="text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-100 leading-relaxed whitespace-pre-line">
                        <HighlightText text={item.teacherFeedback || item.reason || ''} concept={item.concept} isDarkMode={false} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ===================== ذيل النافذة ===================== */}
        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
            معروض: {toEasternArabic(filteredMistakes.length)} من أصل {toEasternArabic(stats.total)} سؤال
          </span>

          <button
            onClick={onClose}
            className="py-2 px-6 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            إغلاق الكشكول
          </button>
        </div>
      </div>
    </div>
  );
};
