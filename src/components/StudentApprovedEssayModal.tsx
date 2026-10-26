import React, { useState, useMemo } from 'react';
import { StudentEssaySubmission, EssayReviewQuestionItem, Unit } from '../types';
import { toEasternArabic } from '../utils';
import { HighlightText } from './HighlightText';
import { FormatQuestionText } from './FormatQuestionText';
import defaultQuestionsData from '../defaultQuestions.json';
import { normalizeTextForMatching } from './AdminEssayReviewTab';

interface StudentApprovedEssayModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: StudentEssaySubmission | null;
  isDarkMode?: boolean;
  data?: Unit[];
}

export const StudentApprovedEssayModal: React.FC<StudentApprovedEssayModalProps> = ({
  isOpen,
  onClose,
  submission,
  isDarkMode = false,
  data = [],
}) => {
  const [viewMode, setViewMode] = useState<'alert' | 'details'>('alert');
  const [detailsFilter, setDetailsFilter] = useState<'all' | 'wrong' | 'correct' | 'essay' | 'mcq'>('all');

  // استرجاع ودمج كامل أسئلة الاختبار (المقالية والاختيارية) إن كانت ناقصة في التسجيل القديم
  const allResolvedQuestions = useMemo(() => {
    if (!submission) return [];
    let list: EssayReviewQuestionItem[] = [...(submission.questions || [])];

    const sourceData = (data && data.length > 0) ? data : undefined;
    const cleanQuizTitle = (submission.quizTitle || '').trim();
    const normQuizTitle = normalizeTextForMatching(cleanQuizTitle);

    let matchedLesson: any = null;
    if (sourceData) {
      for (const u of sourceData) {
        if (!u.lessons) continue;
        const l = u.lessons.find(les => {
          if (submission.lessonId && (les.id === submission.lessonId || les.id.trim() === submission.lessonId.trim())) return true;
          if (cleanQuizTitle && les.title.trim() === cleanQuizTitle) return true;
          if (normQuizTitle && normalizeTextForMatching(les.title) === normQuizTitle) return true;
          return false;
        });
        if (l) {
          matchedLesson = l;
          break;
        }
      }
    }

    // إذا لم نجد في data نبحث في defaultQuestionsData كخيار احتياطي
    if (!matchedLesson && defaultQuestionsData && Array.isArray(defaultQuestionsData)) {
      for (const u of (defaultQuestionsData as any[])) {
        if (!u.lessons) continue;
        const l = u.lessons.find((les: any) => {
          if (submission.lessonId && (les.id === submission.lessonId || les.id.trim() === submission.lessonId.trim())) return true;
          if (cleanQuizTitle && les.title.trim() === cleanQuizTitle) return true;
          if (normQuizTitle && normalizeTextForMatching(les.title) === normQuizTitle) return true;
          return false;
        });
        if (l) {
          matchedLesson = l;
          break;
        }
      }
    }

    // إذا وُجد الدرس في المنهج ولديه أسئلة أكثر مما هو مسجل في submission (مثل أسئلة الاختيار من متعدد)
    if (matchedLesson && matchedLesson.questions && matchedLesson.questions.length > list.length) {
      const existingTexts = new Set(list.map(q => normalizeTextForMatching(q.questionText)));
      matchedLesson.questions.forEach((lq: any, lqIdx: number) => {
        const normLq = normalizeTextForMatching(lq.q);
        if (!existingTexts.has(normLq)) {
          const isTf = lq.type === 'tf' || lq.type === 't/f' || lq.type === 'true_false' || 
                       (Array.isArray(lq.options) && lq.options.length === 2 && (lq.options.includes('صح') || lq.options.includes('خطأ')));
          const qMax = lq.maxScore || 1;
          
          // الأسئلة التكميلية للعرض والمراجعة لا نمنحها درجات كاملة وهمية
          list.push({
            qIndex: lqIdx,
            questionText: lq.q,
            essayType: lq.type === 'essay' ? 'سؤال مقالي' : (isTf ? 'صح وخطأ' : 'اختر من متعدد'),
            modelAnswer: lq.correct || lq.answer || lq.reason || '',
            studentText: 'لم يُسجل حل لهذا السؤال في هذا التسليم',
            maxScore: qMax,
            teacherScore: 0,
            aiScore: 0,
            teacherFeedback: lq.reason || 'راجع نموذج الإجابة المعتمد لهذا السؤال.',
            isApproved: true
          });
          existingTexts.add(normLq);
        }
      });
    }

    return list.sort((a, b) => a.qIndex - b.qIndex);
  }, [submission, data]);

  const maxScore = useMemo(() => {
    if (!submission) return 50;
    const sumAllResolvedMax = allResolvedQuestions.reduce((sum, q) => sum + (Number(q.maxScore) || 1), 0);
    // الدرجة العظمى تمثل إجمالي الدرجات لكافة أسئلة الامتحان المعروضة (مثلاً 60 سؤالاً = 60 أو 62 درجة)
    if (sumAllResolvedMax > 0) {
      return Math.max(sumAllResolvedMax, submission.maxPossibleScore || 0);
    }
    return submission.maxPossibleScore || 50;
  }, [submission, allResolvedQuestions]);

  const earnedScore = useMemo(() => {
    if (!submission) return 0;
    // مجموع ما حصل عليه الطالب بالفعل من درجات في الأسئلة المعروضة
    const sumEarned = allResolvedQuestions.reduce((sum, q) => {
      const s = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
      return sum + s;
    }, 0);

    // إذا كانت finalScore محددة في التسليم
    if (submission.finalScore !== undefined && submission.finalScore !== null) {
      return Math.min(maxScore, Math.max(sumEarned, Math.max(0, submission.finalScore)));
    }
    return Math.min(maxScore, Math.max(0, sumEarned));
  }, [allResolvedQuestions, submission, maxScore]);

  const perc = Math.round((earnedScore / Math.max(1, maxScore)) * 100);

  // تصنيف الأداء والتدرج التربوي للرسائل والشارات
  const tier = useMemo(() => {
    if (perc >= 90) {
      return {
        icon: '🏆',
        iconBg: 'bg-gradient-to-tr from-amber-400 to-yellow-300 text-amber-950 shadow-amber-500/30',
        badgeText: '🌟 تفوق وتميز استثنائي',
        badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
        title: 'مبروك يا بطل! تفوق وتميز باهر 🏆🎉',
        titleColor: 'text-indigo-900 dark:text-indigo-300',
        gradeLabel: 'ممتاز (فائق)',
        gradeColor: 'text-emerald-600 dark:text-emerald-400',
        teacherMessage: 'ما شاء الله تبارك الله، إجابات نموذجية تدل على فهم عميق واستيعاب ممتاز للمادة. فخور بك وبمستواك المتميز، استمر على هذا التألق دائماً لتكون في قمة أوائل الجمهورية! ❤️🌟',
        canDownloadCert: true,
      };
    } else if (perc >= 75) {
      return {
        icon: '🌟',
        iconBg: 'bg-gradient-to-tr from-blue-500 to-indigo-600 text-white shadow-blue-500/30',
        badgeText: '👏 أداء رائع ومتميز',
        badgeBg: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
        title: 'أحسنت يا بطل! أداء متميز ومحاولة قوية 🌟',
        titleColor: 'text-blue-900 dark:text-blue-300',
        gradeLabel: 'جيد جداً',
        gradeColor: 'text-blue-600 dark:text-blue-400',
        teacherMessage: 'عمل رائع ومجهود متميز، إجاباتك جيدة جداً واستوعبت معظم جوانب الدرس. راجع الملاحظات والنموذج المعتمد لتدارك الجزئيات البسيطة والوصول للدرجة النهائية بإذن الله. 👍',
        canDownloadCert: true,
      };
    } else if (perc >= 50) {
      return {
        icon: '📈',
        iconBg: 'bg-gradient-to-tr from-amber-500 to-orange-400 text-white shadow-amber-500/30',
        badgeText: 'مستوى مقبول وقابل للتحسن',
        badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
        title: 'تم اعتماد النتيجة - وبإمكانك تحقيق الأفضل 📚',
        titleColor: 'text-amber-900 dark:text-amber-300',
        gradeLabel: 'جيد / مقبول',
        gradeColor: 'text-amber-600 dark:text-amber-400',
        teacherMessage: 'اجتزت الاختبار بمستوى مقبول، ولكن هناك أخطاء واضحة ونقص في شواهد الإجابة. راجع تفاصيل الأسئلة ونماذج الإجابة بعناية لتعلم أخطائك وتعويض ما فاتك في الاختبارات القادمة.',
        canDownloadCert: false,
      };
    } else {
      return {
        icon: '⚠️',
        iconBg: 'bg-gradient-to-tr from-rose-500 to-red-600 text-white shadow-rose-500/30',
        badgeText: '⚠️ يحتاج إلى إعادة تركيز ومذاكرة جادة',
        badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
        title: 'تنبيه: نتيجتك تتطلب مراجعة فورية ⚠️',
        titleColor: 'text-rose-700 dark:text-rose-400',
        gradeLabel: 'ضعيف (يحتاج مراجعة جادة)',
        gradeColor: 'text-rose-600 dark:text-rose-400',
        teacherMessage: 'للأسف درجتك في هذا الاختبار ضعيفة وتدل على عدم استيعاب الدرس بالشكل الكافي أو التسرع في الحل. من فضلك اضغط على زر "عرض إجاباتي وملاحظات المعلم" بالأسفل وافحص أخطاءك ونماذج الإجابات بدقة، وأعد استذكار الدرس جيداً.',
        canDownloadCert: false,
      };
    }
  }, [perc]);

  // إحصائيات أسئلة الامتحان والأخطاء المتناسقة بدقة مع الدرجة الفعلية
  const examStats = useMemo(() => {
    const total = Math.max(allResolvedQuestions.length, maxScore);
    const sumIndividual = allResolvedQuestions.reduce((s, q) => s + (q.teacherScore || 0), 0);

    let correct = 0;
    let wrong = 0;
    let partial = 0;

    if (sumIndividual === earnedScore && allResolvedQuestions.length > 0) {
      allResolvedQuestions.forEach(q => {
        const qScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
        const qMax = q.maxScore || 1;
        if (qScore >= qMax) {
          correct++;
        } else if (qScore === 0) {
          wrong++;
        } else {
          partial++;
        }
      });
    } else {
      correct = Math.min(total, Math.round(earnedScore));
      wrong = Math.max(0, total - correct);
    }

    return { total, correct, wrong, partial };
  }, [allResolvedQuestions, earnedScore, maxScore]);

  // تصفية الأسئلة في شاشة المراجعة التفصيلية
  const filteredQuestions = useMemo(() => {
    return allResolvedQuestions.filter(q => {
      const qScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
      const qMax = q.maxScore || 1;
      const isEssay = q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ';

      if (detailsFilter === 'all') return true;
      if (detailsFilter === 'wrong') return qScore < qMax;
      if (detailsFilter === 'correct') return qScore >= qMax;
      if (detailsFilter === 'essay') return isEssay;
      if (detailsFilter === 'mcq') return !isEssay;
      return true;
    });
  }, [allResolvedQuestions, detailsFilter]);

  if (!isOpen || !submission) return null;

  // توليد وتحميل شهادة التقدير (للناجحين فقط من 75% فما فوق)
  const handleDownloadCertificate = () => {
    if (!tier.canDownloadCert || !submission) return;
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
    ctx.fillText('شهادة تميـز وتقديـر', 500, 120);

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 26px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :', 500, 205);

    ctx.fillStyle = '#d97706';
    ctx.font = '900 50px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(submission.studentName, 500, 275);

    // السطر 1: نظراً لاجتيازه وتفوقه في سطر مستقل
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 23px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('نظراً لاجتيازه بجدارة وتفوق في اختبار:', 500, 340);

    // السطر 2: اسم الدرس في السطر الأسفل منه بشارة مميزة وخاصة تمنع الخروج عن الإطار
    const rawQuizTitle = (submission.quizTitle || 'الاختبار').trim();
    const formattedTitle = `« ${rawQuizTitle} »`;

    // قياس وتحديد حجم الخط ديناميكياً لضمان عدم الخروج عن الإطار إطلاقاً
    let titleFontSize = 26;
    if (rawQuizTitle.length > 55) {
      titleFontSize = 19;
    } else if (rawQuizTitle.length > 40) {
      titleFontSize = 22;
    }

    ctx.font = `900 ${titleFontSize}px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif`;
    const measuredTitleWidth = ctx.measureText(formattedTitle).width;
    const badgeW = Math.min(840, measuredTitleWidth + 48);
    const badgeH = 42;
    const badgeX = 500 - (badgeW / 2);
    const badgeY = 388 - (badgeH / 2);

    // خلفية الشارة المميزة لاسم الدرس
    ctx.fillStyle = '#eff6ff';
    if (typeof (ctx as any).roundRect === 'function') {
      ctx.beginPath();
      (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, 12);
      ctx.fill();
      ctx.strokeStyle = '#bfdbfe';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    }

    // نص اسم الدرس المميز بلون أزرق نيلي بارز
    ctx.fillStyle = '#1d4ed8';
    ctx.font = `900 ${titleFontSize}px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif`;
    ctx.fillText(formattedTitle, 500, 388);

    // الدرجة والنسبة المئوية
    ctx.font = '900 27px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText(
      `وحصوله على درجة (${toEasternArabic(earnedScore)} من ${toEasternArabic(maxScore)}) بنسبة ${toEasternArabic(perc)}%`,
      500,
      448
    );

    // عبارة التشجيع
    ctx.fillStyle = '#db2777';
    ctx.font = '900 31px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText('أكمل يا بطلي فحقاً فخور بك وبمستواك ❤️', 500, 510);

    // خط فاصل
    ctx.beginPath();
    ctx.moveTo(150, 560);
    ctx.lineTo(850, 560);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // التوقيع، النسبة، والتاريخ
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-md animate-fade-in" dir="rtl">
      <div 
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border overflow-hidden transition-all duration-300 ${
          isDarkMode 
            ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-purple-950/40' 
            : 'bg-white border-indigo-100 text-slate-800 shadow-indigo-900/20'
        }`}
      >
        {viewMode === 'alert' ? (
          // =================== شاشة الإشعار والنتيجة التفاعلية ===================
          <div className="p-5 sm:p-7 flex flex-col items-center text-center overflow-y-auto">
            {/* أيقونة التقييم حسب النتيجة */}
            <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full ${tier.iconBg} flex items-center justify-center text-4xl sm:text-5xl shadow-xl mb-3`}>
              {tier.icon}
            </div>

            <div className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full ${tier.badgeBg} text-xs font-black mb-2.5`}>
              <i className="fas fa-check-circle"></i> {tier.badgeText}
            </div>

            <h2 className={`text-xl sm:text-2xl md:text-3xl font-black mb-1.5 ${tier.titleColor}`}>
              {tier.title}
            </h2>

            <p className="text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 mb-4 max-w-md">
              قام المعلم <span className="text-amber-600 dark:text-amber-400 font-black">أ/ إسلام سعود</span> باعتماد وتصحيح نتيجتك في اختبار:
              <br />
              <span className="text-indigo-600 dark:text-indigo-400 font-black text-base sm:text-lg block mt-0.5">
                « {submission.quizTitle} »
              </span>
            </p>

            {/* بطاقة النتيجة والإحصائيات والأخطاء */}
            <div className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 sm:p-5 mb-4 shadow-xs text-right">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 text-center">
                <div className="bg-white dark:bg-slate-900/80 p-2.5 sm:p-3 rounded-xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs">
                  <span className="block text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 mb-0.5">الدرجة المستحقة</span>
                  <span className="text-lg sm:text-2xl font-black text-indigo-700 dark:text-indigo-300" dir="ltr">
                    {toEasternArabic(earnedScore)} / {toEasternArabic(maxScore)}
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900/80 p-2.5 sm:p-3 rounded-xl border border-slate-200/80 dark:border-slate-700/60 shadow-2xs">
                  <span className="block text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 mb-0.5">النسبة المئوية</span>
                  <span className={`text-lg sm:text-2xl font-black ${tier.gradeColor}`} dir="ltr">
                    {toEasternArabic(perc)}%
                  </span>
                </div>

                <div className="bg-emerald-50/80 dark:bg-emerald-950/40 p-2.5 sm:p-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
                  <span className="block text-[10px] sm:text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-0.5">إجابات صحيحة ✅</span>
                  <span className="text-lg sm:text-2xl font-black text-emerald-700 dark:text-emerald-300">
                    {toEasternArabic(examStats.correct)}
                  </span>
                </div>

                <div className="bg-rose-50/80 dark:bg-rose-950/40 p-2.5 sm:p-3 rounded-xl border border-rose-200 dark:border-rose-800/60 shadow-2xs">
                  <span className="block text-[10px] sm:text-xs font-bold text-rose-800 dark:text-rose-300 mb-0.5">عدد الأخطاء ❌</span>
                  <span className="text-lg sm:text-2xl font-black text-rose-600 dark:text-rose-400">
                    {toEasternArabic(examStats.wrong)}
                  </span>
                </div>
              </div>

              {/* شريط الإجمالي والتقدير العام */}
              <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                <span>إجمالي أسئلة الاختبار: <b>{toEasternArabic(examStats.total)} سؤال</b></span>
                <span>التقدير الأكاديمي: <b className={`font-black ${tier.gradeColor}`}>{tier.gradeLabel}</b></span>
              </div>
            </div>

            {/* رسالة المعلم التربوية الموجهة حسب الدرجة */}
            <div className={`w-full rounded-2xl p-4 mb-5 text-right border ${
              perc >= 75
                ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50'
                : (perc >= 50 ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/50' : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/50')
            }`}>
              <div className="flex items-center gap-2 mb-1 text-xs font-black text-slate-900 dark:text-slate-100">
                <i className="fas fa-comment-dots text-sm"></i> كلمة المعلم أ/ إسلام سعود:
              </div>
              <p className="text-xs sm:text-sm font-bold leading-relaxed text-slate-800 dark:text-slate-200">
                {tier.teacherMessage}
              </p>
            </div>

            {/* أزرار الإجراءات */}
            <div className="w-full flex flex-col sm:flex-row items-center gap-2.5">
              <button
                onClick={() => setViewMode('details')}
                className="w-full sm:flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                <i className="fas fa-file-alt"></i> عرض إجاباتي وملاحظات المعلم والأخطاء
              </button>

              {tier.canDownloadCert && (
                <button
                  onClick={handleDownloadCertificate}
                  className="w-full sm:flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-900 font-black text-xs sm:text-sm rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-award text-base"></i> تحميل شهادة التقدير 📜
                </button>
              )}

              <button
                onClick={onClose}
                className="w-full sm:w-auto py-3 px-6 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        ) : (
          // =================== شاشة تفاصيل الإجابات وملاحظات المعلم والأخطاء ===================
          <>
            {/* رأس النافذة */}
            <div className="p-3.5 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-indigo-50/50 dark:bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setViewMode('alert')}
                  className="w-9 h-9 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                  title="العودة لبطاقة النتيجة"
                >
                  <i className="fas fa-arrow-right"></i>
                </button>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>مراجعة أسئلة: {submission.quizTitle}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${tier.badgeBg}`}>
                      {tier.gradeLabel}
                    </span>
                  </h3>
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                    <span>الدرجة: {toEasternArabic(earnedScore)} من {toEasternArabic(maxScore)} ({toEasternArabic(perc)}%)</span>
                    <span>•</span>
                    <span className="text-rose-600 dark:text-rose-400 font-black">الأخطاء: {toEasternArabic(examStats.wrong)}</span>
                  </div>
                </div>
              </div>

              {tier.canDownloadCert && (
                <button
                  onClick={handleDownloadCertificate}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs font-black rounded-xl transition-colors cursor-pointer shadow-xs"
                >
                  <i className="fas fa-award"></i> الشهادة 📜
                </button>
              )}
            </div>

            {/* شريط الفلاتر السريعة */}
            <div className="p-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 sm:gap-2 overflow-x-auto shrink-0 scrollbar-none">
              <button
                type="button"
                onClick={() => setDetailsFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                  detailsFilter === 'all'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                الكل ({toEasternArabic(examStats.total)})
              </button>

              <button
                type="button"
                onClick={() => setDetailsFilter('wrong')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                  detailsFilter === 'wrong'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900'
                }`}
              >
                الأخطاء ❌ ({toEasternArabic(examStats.wrong)})
              </button>

              <button
                type="button"
                onClick={() => setDetailsFilter('correct')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                  detailsFilter === 'correct'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                }`}
              >
                الصحيحة ✅ ({toEasternArabic(examStats.correct)})
              </button>

              <button
                type="button"
                onClick={() => setDetailsFilter('essay')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                  detailsFilter === 'essay'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                المقالي ✍️
              </button>

              <button
                type="button"
                onClick={() => setDetailsFilter('mcq')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all cursor-pointer ${
                  detailsFilter === 'mcq'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                اختر وصح/خطأ 🔘
              </button>
            </div>

            {/* محتوى الأسئلة الكامل وملاحظات المعلم */}
            <div className="p-3.5 sm:p-5 overflow-y-auto space-y-3.5 flex-1">
              {filteredQuestions.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold">
                  <i className="fas fa-inbox text-3xl mb-2 opacity-40"></i>
                  <p>لا توجد أسئلة تطابق هذا الفلتر</p>
                </div>
              ) : (
                filteredQuestions.map((q, idx) => {
                  const finalQScore = q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : 0);
                  const isZero = finalQScore === 0;
                  const isFull = finalQScore >= q.maxScore;
                  const isEssay = q.essayType !== 'اختر من متعدد' && q.essayType !== 'صح وخطأ';

                  return (
                    <div
                      key={idx}
                      className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${
                        isZero
                          ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10'
                          : isFull
                          ? 'border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-slate-800/60'
                          : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700/60 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-black text-xs flex items-center justify-center">
                            {toEasternArabic(q.qIndex + 1)}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                            isEssay 
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' 
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          }`}>
                            {q.essayType || (isEssay ? 'سؤال مقالي' : 'اختر من متعدد')}
                          </span>
                        </div>

                        <div className={`text-xs font-black px-2.5 py-1 rounded-lg flex items-center gap-1.5 ${
                          isZero
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : isFull
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`} dir="ltr">
                          <span>{toEasternArabic(finalQScore)} / {toEasternArabic(q.maxScore)}</span>
                          <span>{isZero ? '❌ خطأ' : (isFull ? '✅ صحيح' : '⚠️ جزئي')}</span>
                        </div>
                      </div>

                      {/* نص السؤال */}
                      <div className="mb-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                        <span className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">
                          ❓ نص السؤال:
                        </span>
                        <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 leading-relaxed">
                          <FormatQuestionText text={q.questionText} isDarkMode={isDarkMode} />
                        </div>
                      </div>

                      {/* إجابة الطالب */}
                      <div className={`mb-2.5 p-3 rounded-xl border ${
                        isZero
                          ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40 text-rose-950 dark:text-rose-200'
                          : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                      }`}>
                        <span className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-0.5">
                          ✍️ إجابتك المسجلة:
                        </span>
                        <p className="text-xs sm:text-sm font-bold whitespace-pre-wrap leading-relaxed">
                          {q.studentText || 'لم يتم تسجيل إجابة (تُرك فارغاً)'}
                        </p>
                      </div>

                      {/* نموذج الإجابة المعتمد */}
                      {q.modelAnswer && (
                        <div className="mb-2.5 p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                          <span className="block text-[10px] font-black text-emerald-800 dark:text-emerald-300 mb-1 flex items-center gap-1">
                            <i className="fas fa-clipboard-check text-emerald-600"></i>
                            <span>الإجابة الصحيحة / النموذج المعتمد:</span>
                          </span>
                          <div className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200 leading-relaxed">
                            <HighlightText text={q.modelAnswer} isDarkMode={isDarkMode} />
                          </div>
                        </div>
                      )}

                      {/* ملاحظات المعلم / التفسير */}
                      {(q.teacherFeedback || q.aiFeedback) && (
                        <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60">
                          <span className="block text-[10px] font-black text-indigo-700 dark:text-indigo-300 mb-0.5">
                            👨‍🏫 ملاحظات المعلم أ/ إسلام سعود والتفسير:
                          </span>
                          <div className="text-xs sm:text-sm font-bold text-indigo-950 dark:text-indigo-200 leading-relaxed">
                            <HighlightText text={q.teacherFeedback || q.aiFeedback || ''} isDarkMode={isDarkMode} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* ذيل النافذة */}
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex items-center justify-between gap-3 shrink-0">
              {tier.canDownloadCert ? (
                <button
                  onClick={handleDownloadCertificate}
                  className="py-2 px-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black text-xs sm:text-sm rounded-xl transition-all shadow active:scale-95 flex items-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-download"></i> تحميل الشهادة 📜
                </button>
              ) : <div />}

              <button
                onClick={onClose}
                className="py-2 px-6 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer"
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
