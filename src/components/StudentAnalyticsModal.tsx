import React, { useState, useMemo } from 'react';
import { GroupedResult, Student, Unit, TestResult } from '../types';
import { toEasternArabic, detectArabicGender, formatPhoneStr, normalizeScore } from '../utils';
import { generateStudentReportImage } from '../utils/studentReportImage';

interface StudentAnalyticsModalProps {
  student: GroupedResult;
  studentMeta?: Student | null;
  units: Unit[];
  allValidLessons: string[];
  requiredLessonTitles: string[];
  isStudentOnline: boolean;
  onClose: () => void;
  onResetDevice: (phone: string, name: string) => void;
  onBlockStudent: (phone: string, name: string) => void;
  onUnblockStudent: (phone: string, name: string) => void;
  onGrantNewAttempt?: (phone: string, name: string, lessonTitle: string) => void;
  isDarkMode?: boolean;
}

export const StudentAnalyticsModal: React.FC<StudentAnalyticsModalProps> = ({
  student,
  studentMeta,
  units,
  allValidLessons,
  requiredLessonTitles,
  isStudentOnline,
  onClose,
  onResetDevice,
  onBlockStudent,
  onUnblockStudent,
  onGrantNewAttempt,
  isDarkMode = false
}) => {
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'units' | 'timeline' | 'missing'>('units');
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [expandedUnitIds, setExpandedUnitIds] = useState<string[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);

  const isBlocked = !!studentMeta?.isBlocked;
  const gender = detectArabicGender(student.name, studentMeta?.gender);
  const isFemale = gender === 'female';

  // تفكيك الاختبارات العادية عن التصفيرات
  const { quizTests, resetTests } = useMemo(() => {
    const q: TestResult[] = [];
    const r: TestResult[] = [];
    (student.tests || []).forEach(t => {
      if (t.quiz.includes('تصفير') || t.quiz.includes('فرصة جديدة') || String(t.score).includes('تصفير')) {
        r.push(t);
      } else {
        q.push(t);
      }
    });
    return { quizTests: q, resetTests: r };
  }, [student.tests]);

  // تعيين أول درجة لكل درس ومطابقتها مع مراعاة التصفيرات والفرص الجديدة
  const lessonFirstScoreMap = useMemo(() => {
    const map: Record<string, number> = {};
    const norm = (s: string) => s.replace(/[\s\-_:،]/g, '').toLowerCase();

    (student.tests || []).forEach(t => {
      if (t.quiz.includes('تصفير') || t.quiz.includes('فرصة جديدة') || String(t.score).includes('تصفير')) {
        if (t.quiz.includes('فرصة جديدة') || t.quiz.includes('تصفير درس')) {
          const lessonTitleToReset = norm(t.quiz.replace(/.*(?:فرصة جديدة|تصفير درس).*?:/, '').trim());
          Object.keys(map).forEach(k => {
            const normK = norm(k);
            if (normK.includes(lessonTitleToReset) || lessonTitleToReset.includes(normK)) {
              delete map[k];
            }
          });
        } else if (t.quiz.includes('تصفير الوحدة')) {
          const unitTitleToReset = norm(t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim());
          const unitToReset = units.find(u => norm(u.title) === unitTitleToReset);
          if (unitToReset) {
            (unitToReset.lessons || []).forEach(l => delete map[l.title]);
          }
        } else {
          for (let k in map) delete map[k];
        }
        return;
      }

      const cleanQ = t.quiz.replace(/^تدريبات\s*:\s*/i, '').replace(/^امتحان\s*:\s*/i, '').trim();
      const normQ = norm(cleanQ);

      const matchedTitle = allValidLessons.find(l => {
        const normL = norm(l);
        return normQ.includes(normL) || normL.includes(normQ);
      });

      if (matchedTitle && map[matchedTitle] === undefined) {
        map[matchedTitle] = normalizeScore(t.score);
      }
    });
    return map;
  }, [student.tests, allValidLessons, units]);

  const solvedLessonsCount = Object.keys(lessonFirstScoreMap).length;
  const totalLessonsCount = units.reduce((acc, u) => acc + (u.lessons?.length || 0), 0);

  // حساب مؤشرات الأداء الأساسية (KPIs)
  const scoresArray = Object.values(lessonFirstScoreMap);
  const avgScore = scoresArray.length > 0
    ? Math.round(scoresArray.reduce((a, b) => a + b, 0) / scoresArray.length)
    : 0;
  const maxScore = scoresArray.length > 0 ? Math.max(...scoresArray) : 0;
  const minScore = scoresArray.length > 0 ? Math.min(...scoresArray) : 0;

  // فحص نواقص لوحة الشرف
  const missingHonorLessons = useMemo(() => {
    return requiredLessonTitles.filter(reqTitle => lessonFirstScoreMap[reqTitle] === undefined);
  }, [requiredLessonTitles, lessonFirstScoreMap]);

  const isHonorRoll = missingHonorLessons.length === 0 && solvedLessonsCount > 0;

  // نسخ تقرير الأداء لإرساله لولي الأمر عبر واتساب
  const handleCopyParentReport = () => {
    const dateStr = new Date().toLocaleDateString('ar-EG');
    let text = `📊 تقرير متابعة الطالب الأكاديمي\n`;
    text += `👤 الطالب: ${student.name}\n`;
    text += `📱 رقم الهاتف: ${student.phone}\n`;
    text += `🏫 فئة الاشتراك: ${isStudentOnline ? 'أونلاين 🌐' : 'سنتر 🏫'}\n`;
    text += `📅 تاريخ إصدار التقرير: ${dateStr}\n`;
    text += `------------------------------------\n`;
    text += `🎯 الاختبارات المنجزة: ${toEasternArabic(solvedLessonsCount)} من إجمالي ${toEasternArabic(totalLessonsCount)} درس (${toEasternArabic(Math.round((solvedLessonsCount / (totalLessonsCount || 1)) * 100))}٪)\n`;
    text += `📈 المتوسط العام لدرجات الطالب: ${toEasternArabic(avgScore)}٪\n`;
    text += `🏆 أعلى درجة محققة: ${toEasternArabic(maxScore)}٪\n`;
    text += `📉 أدنى درجة محققة: ${toEasternArabic(minScore)}٪\n`;
    text += `------------------------------------\n`;
    text += `📚 ملخص الإنجاز حسب الوحدات:\n`;

    units.forEach(u => {
      const uSolved = (u.lessons || []).filter(l => lessonFirstScoreMap[l.title] !== undefined);
      const uScores = uSolved.map(l => lessonFirstScoreMap[l.title]);
      const uAvg = uScores.length > 0 ? Math.round(uScores.reduce((a, b) => a + b, 0) / uScores.length) : 0;
      text += `• ${u.title}: أنجز ${toEasternArabic(uSolved.length)}/${toEasternArabic(u.lessons.length)} درس (بمتوسط ${toEasternArabic(uAvg)}٪)\n`;
    });

    text += `------------------------------------\n`;
    text += `🌟 موسوعة الكنز التعليمية - أ/ إسلام سعود 🌟`;

    navigator.clipboard.writeText(text);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 3000);
  };

  // تنزيل تقرير إحصائي مفصل عالي الدقة كصورة
  const handleDownloadReportImage = async (forceAll: boolean = false) => {
    try {
      setIsGeneratingImage(true);
      const targetUnitId = forceAll ? 'all' : selectedUnitId;
      const isSingle = targetUnitId !== 'all';
      const targetUnitObj = isSingle ? units.find(u => u.id === targetUnitId || u.title === targetUnitId) : null;

      // حساب إحصائيات مخصصة للوحدة المحددة بدقة عند اختيار وحدة معينة
      let reportAvg = avgScore;
      let reportMax = maxScore;
      let reportMin = minScore;

      if (targetUnitObj) {
        const uLessons = targetUnitObj.lessons || [];
        const uScores = uLessons
          .map(l => lessonFirstScoreMap[l.title])
          .filter((s): s is number => s !== undefined);

        reportAvg = uScores.length > 0 ? Math.round(uScores.reduce((a, b) => a + b, 0) / uScores.length) : 0;
        reportMax = uScores.length > 0 ? Math.max(...uScores) : 0;
        reportMin = uScores.length > 0 ? Math.min(...uScores) : 0;
      }

      const dataUrl = await generateStudentReportImage({
        student,
        studentMeta,
        units,
        allValidLessons,
        lessonFirstScoreMap,
        isStudentOnline,
        selectedUnitId: targetUnitId,
        avgScore: reportAvg,
        maxScore: reportMax,
        minScore: reportMin,
        isHonorRoll,
        missingHonorLessonsCount: missingHonorLessons.length
      });

      const a = document.createElement('a');
      a.href = dataUrl;
      const targetUnitName = targetUnitObj ? targetUnitObj.title : 'شامل';
      a.download = `تقرير_${student.name.replace(/\s+/g, '_')}_${targetUnitName.replace(/\s+/g, '_')}_منصة_الكنز.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      alert('حدث خطأ أثناء إنشاء الصورة: ' + (err?.message || err));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const isUnitExpanded = (unitId: string) => {
    if (selectedUnitId !== 'all' && selectedUnitId === unitId) return true;
    return expandedUnitIds.includes(unitId);
  };

  const toggleUnit = (unitId: string) => {
    setExpandedUnitIds(prev =>
      prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]
    );
  };

  // تصفية الوحدات
  const displayedUnits = selectedUnitId === 'all'
    ? units
    : units.filter(u => u.id === selectedUnitId);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-fade-in" dir="rtl">
      <div className={`w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border ${
        isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-100 text-gray-900'
      }`}>
        {/* الترويسة الرئيسية والبطاقة الشخصية */}
        <div className={`p-4 sm:p-6 border-b shrink-0 ${
          isDarkMode 
            ? 'bg-gradient-to-r from-gray-800 to-gray-850 border-gray-700' 
            : 'bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white border-gray-200'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* أيقونة الطالب مع تمييز النوع */}
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black shrink-0 shadow-sm border ${
                isFemale
                  ? 'bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-blue-100 text-blue-700 border-blue-200'
              }`}>
                {isFemale ? '👧' : '👦'}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg sm:text-xl font-black truncate">{student.name}</h3>
                  {/* شارة النوع */}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    isFemale
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}>
                    {isFemale ? 'بنات 👧' : 'بنين 👦'}
                  </span>
                  {/* شارة السنتر / أونلاين */}
                  {isStudentOnline ? (
                    <span className="bg-emerald-50 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1">
                      <i className="fas fa-globe text-emerald-600"></i> أونلاين
                    </span>
                  ) : (
                    <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-full text-[10px] font-black flex items-center gap-1">
                      <i className="fas fa-school text-indigo-600"></i> سنتر
                    </span>
                  )}
                  {/* حالة الحظر */}
                  {isBlocked && (
                    <span className="bg-red-500 text-white px-2 py-0.5 rounded-full text-[10px] font-black shadow-xs flex items-center gap-1">
                      <i className="fas fa-lock text-[9px]"></i> محظور
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 font-bold mt-1 flex-wrap">
                  <span className="flex items-center gap-1">
                    <i className="fas fa-phone text-gray-400"></i>
                    <span dir="ltr" className="font-mono">{student.phone}</span>
                  </span>
                  {studentMeta?.code && (
                    <span className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md font-mono text-[11px]">
                      <i className="fas fa-id-card text-gray-400"></i> كود: {studentMeta.code}
                    </span>
                  )}
                  {studentMeta?.registrationDate && (
                    <span className="flex items-center gap-1">
                      <i className="fas fa-calendar-alt text-gray-400"></i> انضم: {studentMeta.registrationDate}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* الأزرار العلوية السريعة */}
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 flex-wrap">
              {/* زر واتساب السريع */}
              {student.phone && (
                <a
                  href={`https://wa.me/20${formatPhoneStr(student.phone).replace(/^0+/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                  title="مراسلة الطالب أو ولي الأمر عبر واتساب"
                >
                  <i className="fab fa-whatsapp text-sm"></i>
                  <span className="hidden sm:inline">واتساب</span>
                </a>
              )}

              {/* زر فك الجهاز */}
              <button
                type="button"
                onClick={() => onResetDevice(student.phone, student.name)}
                className="px-3 py-2 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-bold text-xs rounded-xl shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                title="السماح للطالب بالدخول من جهاز جديد"
              >
                <i className="fas fa-mobile-alt"></i>
                <span className="hidden sm:inline">فك الجهاز</span>
              </button>

              {/* زر الحظر / فك الحظر */}
              {isBlocked ? (
                <button
                  type="button"
                  onClick={() => onUnblockStudent(student.phone, student.name)}
                  className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-xl shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fas fa-unlock"></i>
                  <span>فك الحظر</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onBlockStudent(student.phone, student.name)}
                  className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-black text-xs rounded-xl shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fas fa-ban"></i>
                  <span>حظر</span>
                </button>
              )}

              {/* زر إغلاق النافذة */}
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center transition-colors cursor-pointer"
                title="إغلاق"
              >
                <i className="fas fa-times text-base"></i>
              </button>
            </div>
          </div>

          {/* شريط الإجراءات: تنزيل تقرير مصور، ونسخ تقرير للواتساب */}
          <div className="mt-3.5 pt-3 border-t border-gray-200/70 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-bold flex items-center gap-1.5">
              <i className="fas fa-info-circle text-blue-500"></i>
              يمكنك تنزيل شهادة تقييم مصورة أو نسخ تقرير نصي لإرساله لولي الأمر
            </span>

            <div className="flex items-center gap-2 flex-wrap">
              {/* زر تنزيل التقرير المصور */}
              <button
                type="button"
                onClick={() => handleDownloadReportImage(false)}
                disabled={isGeneratingImage}
                className="px-3.5 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 shadow-xs cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white disabled:opacity-60 active:scale-95"
                title="تنزيل تقرير رسمي مصور عالي الدقة باسم المنصة والأستاذ إسلام سعود"
              >
                <i className={isGeneratingImage ? "fas fa-spinner fa-spin" : "fas fa-file-image"}></i>
                <span>
                  {isGeneratingImage 
                    ? 'جاري تجهيز الصورة... ⏳' 
                    : selectedUnitId !== 'all' 
                      ? `🖼️ تنزيل تقرير (${displayedUnits[0]?.title || 'الوحدة'}) صورة`
                      : '🖼️ تنزيل تقرير كصورة (PNG)'
                  }
                </span>
              </button>

              {/* إذا كان المعلم قد اختار وحدة محددة، نتيح له أيضاً خيار تنزيل التقرير الشامل لجميع الوحدات */}
              {selectedUnitId !== 'all' && (
                <button
                  type="button"
                  onClick={() => handleDownloadReportImage(true)}
                  disabled={isGeneratingImage}
                  className="px-3 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 shadow-xs cursor-pointer bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 active:scale-95 disabled:opacity-60"
                  title="تنزيل تقرير يشمل كافة الوحدات والدروس كصورة واحدة"
                >
                  <i className="fas fa-layer-group"></i>
                  <span>📑 التقرير الشامل (صورة)</span>
                </button>
              )}

              {/* زر نسخ التقرير النصي للواتساب */}
              <button
                type="button"
                onClick={handleCopyParentReport}
                className={`px-3.5 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 shadow-xs cursor-pointer ${
                  copiedReport
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50'
                }`}
                title="نسخ تقرير نصي منسق لإرساله في رسالة واتساب"
              >
                <i className={copiedReport ? "fas fa-check" : "fas fa-clipboard-list"}></i>
                <span>{copiedReport ? 'تم نسخ التقرير! 🎉' : '📋 نسخ للواتساب'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* المؤشرات الإحصائية السريعة (KPIs) */}
        <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50/70 dark:bg-gray-900/40 border-b border-gray-200/70 dark:border-gray-800 shrink-0">
          {/* كارت إجمالي الاختبارات */}
          <div className="bg-white dark:bg-gray-800 p-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-bold mb-1">
              <span>الاختبارات المنجزة</span>
              <i className="fas fa-tasks text-blue-500 text-base"></i>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-gray-900 dark:text-white">
                {toEasternArabic(solvedLessonsCount)}
              </span>
              <span className="text-xs font-bold text-gray-400">
                من {toEasternArabic(totalLessonsCount)} درس
              </span>
            </div>
            <div className="mt-2 w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-blue-600 h-full rounded-full transition-all duration-500" 
                style={{ width: `${Math.round((solvedLessonsCount / (totalLessonsCount || 1)) * 100)}%` }}
              ></div>
            </div>
          </div>

          {/* كارت المتوسط العام */}
          <div className="bg-white dark:bg-gray-800 p-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-bold mb-1">
              <span>المتوسط العام</span>
              <i className="fas fa-chart-line text-emerald-500 text-base"></i>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-black ${
                avgScore >= 85 ? 'text-emerald-600' : avgScore >= 65 ? 'text-blue-600' : avgScore > 0 ? 'text-orange-500' : 'text-gray-400'
              }`}>
                {toEasternArabic(avgScore)}٪
              </span>
              <span className="text-[10px] font-bold text-gray-400">
                {avgScore >= 85 ? 'ممتاز' : avgScore >= 75 ? 'جيد جداً' : avgScore >= 60 ? 'جيد' : avgScore > 0 ? 'يحتاج متابعة' : 'لم يبدأ'}
              </span>
            </div>
            <div className="mt-2 w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  avgScore >= 85 ? 'bg-emerald-500' : avgScore >= 65 ? 'bg-blue-500' : 'bg-orange-500'
                }`}
                style={{ width: `${avgScore}%` }}
              ></div>
            </div>
          </div>

          {/* كارت أعلى وأدنى درجة */}
          <div className="bg-white dark:bg-gray-800 p-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-bold mb-1">
              <span>أعلى وأدنى درجة</span>
              <i className="fas fa-trophy text-amber-500 text-base"></i>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-400 font-bold">أعلى درجة</span>
                <span className="text-base font-black text-emerald-600">
                  {toEasternArabic(maxScore)}٪
                </span>
              </div>
              <div className="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-400 font-bold">أدنى درجة</span>
                <span className="text-base font-black text-rose-600">
                  {toEasternArabic(minScore)}٪
                </span>
              </div>
            </div>
          </div>

          {/* كارت لوحة الشرف والتصفيرات */}
          <div className="bg-white dark:bg-gray-800 p-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-bold mb-1">
              <span>لوحة الشرف</span>
              <i className="fas fa-award text-purple-500 text-base"></i>
            </div>
            <div>
              {missingHonorLessons.length === 0 && solvedLessonsCount > 0 ? (
                <span className="text-xs font-black text-emerald-600 flex items-center gap-1">
                  <i className="fas fa-check-circle"></i> مؤهل بامتياز 🏆
                </span>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-600 flex items-center gap-1">
                    <i className="fas fa-exclamation-circle"></i> نواقص: {toEasternArabic(missingHonorLessons.length)}
                  </span>
                  {resetTests.length > 0 && (
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                      🔄 {toEasternArabic(resetTests.length)} تصفير
                    </span>
                  )}
                </div>
              )}
            </div>
            <span className="text-[10px] text-gray-400 font-bold mt-1">
              {resetTests.length > 0 ? `تم إعادة المحاولات ${toEasternArabic(resetTests.length)} مرة` : 'سجل محاولات نقي بدون تصفير'}
            </span>
          </div>
        </div>

        {/* أشرطة التبويب الداخلية وتصفية الوحدات */}
        <div className="p-3 bg-gray-50/50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-gray-200/80 dark:bg-gray-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('units')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'units'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              }`}
            >
              <i className="fas fa-layer-group"></i>
              <span>الأداء حسب الوحدات</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'timeline'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              }`}
            >
              <i className="fas fa-history"></i>
              <span>السجل الزمني ({toEasternArabic(student.tests?.length || 0)})</span>
            </button>
            {missingHonorLessons.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('missing')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'missing'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-rose-600 dark:text-rose-400 hover:text-rose-700'
                }`}
              >
                <i className="fas fa-exclamation-triangle"></i>
                <span>النواقص ({toEasternArabic(missingHonorLessons.length)})</span>
              </button>
            )}
          </div>

          {/* قائمة تصفية الوحدات */}
          {activeTab === 'units' && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* زر طي وعرض الكل */}
              {selectedUnitId === 'all' && (
                <button
                  type="button"
                  onClick={() => {
                    if (expandedUnitIds.length === units.length) {
                      setExpandedUnitIds([]);
                    } else {
                      setExpandedUnitIds(units.map(u => u.id));
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title={expandedUnitIds.length === units.length ? "طي جميع الدروس في كل الوحدات" : "عرض جميع الدروس في كل الوحدات"}
                >
                  <i className={`fas ${expandedUnitIds.length === units.length ? 'fa-compress-alt text-amber-600' : 'fa-expand-alt text-blue-600'}`}></i>
                  <span>{expandedUnitIds.length === units.length ? 'طي الكل' : 'عرض الكل'}</span>
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <label className="text-xs font-bold text-gray-500 whitespace-nowrap">الوحدة:</label>
                <select
                  value={selectedUnitId}
                  onChange={e => {
                    const val = e.target.value;
                    setSelectedUnitId(val);
                    if (val !== 'all') {
                      setExpandedUnitIds([val]);
                    }
                  }}
                  className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none focus:border-primary shadow-xs cursor-pointer"
                >
                  <option value="all">📁 جميع الوحدات ({toEasternArabic(units.length)})</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* جسم العرض الرئيسي القابل للتمرير */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar">
          {/* تبويب 1: الأداء بحسب الوحدات */}
          {activeTab === 'units' && (
            <div className="space-y-4">
              {displayedUnits.map((unit) => {
                const unitLessons = unit.lessons || [];
                const solvedInUnit = unitLessons.filter(l => lessonFirstScoreMap[l.title] !== undefined);
                const unitScores = solvedInUnit.map(l => lessonFirstScoreMap[l.title]);
                const unitAvg = unitScores.length > 0 ? Math.round(unitScores.reduce((a, b) => a + b, 0) / unitScores.length) : 0;
                const isUnitFullyCompleted = unitLessons.length > 0 && solvedInUnit.length === unitLessons.length;
                const isExpanded = isUnitExpanded(unit.id);

                return (
                  <div key={unit.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xs overflow-hidden">
                    {/* ترويسة الوحدة */}
                    <div 
                      onClick={() => toggleUnit(unit.id)}
                      className="p-3.5 sm:p-4 bg-gray-50/80 dark:bg-gray-850 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-gray-100/70 transition-colors select-none"
                      title={isExpanded ? "انقر لطي تفاصيل الدروس" : "انقر لعرض تفاصيل الدروس"}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${
                          isUnitFullyCompleted
                            ? 'bg-emerald-100 text-emerald-700'
                            : solvedInUnit.length > 0
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-200 text-gray-500'
                        }`}>
                          <i className={`fas ${isUnitFullyCompleted ? 'fa-check-double' : 'fa-book'}`}></i>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-black text-sm text-gray-900 dark:text-white">{unit.title}</h4>
                            <span className={`text-[10px] font-bold px-2 py-0.2 rounded-full border transition-colors ${
                              isExpanded 
                                ? 'bg-primary/10 text-primary border-primary/20' 
                                : 'bg-gray-100 text-gray-500 border-gray-200'
                            }`}>
                              {isExpanded ? 'الدروس معروضة' : 'انقر للعرض 👈'}
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-500 font-bold block mt-0.5">
                            أنجز {toEasternArabic(solvedInUnit.length)} من إجمالي {toEasternArabic(unitLessons.length)} دروس
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1.5 bg-white dark:bg-gray-800 px-3 py-1 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs">
                          <span className="text-xs font-bold text-gray-500">متوسط الوحدة:</span>
                          <span className={`text-xs font-black ${
                            unitAvg >= 85 ? 'text-emerald-600' : unitAvg >= 65 ? 'text-blue-600' : unitAvg > 0 ? 'text-orange-500' : 'text-gray-400'
                          }`}>
                            {unitScores.length > 0 ? `${toEasternArabic(unitAvg)}٪` : 'لم يختبر'}
                          </span>
                        </div>

                        {/* أيقونة السهم الدوار للطي والعرض */}
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                          isExpanded ? 'bg-primary/10 text-primary rotate-180' : 'bg-gray-200/70 text-gray-500'
                        }`}>
                          <i className="fas fa-chevron-down text-xs transition-transform duration-200"></i>
                        </div>
                      </div>
                    </div>

                    {/* قائمة دروس الوحدة */}
                    {isExpanded ? (
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/60 animate-fade-in">
                        {unitLessons.map((lesson) => {
                          const score = lessonFirstScoreMap[lesson.title];
                          const isSolved = score !== undefined;
                          const isHigh = isSolved && score >= 80;

                          return (
                            <div key={lesson.id} className="p-3 sm:px-4 flex items-center justify-between gap-3 hover:bg-gray-50/50 dark:hover:bg-gray-750 transition-colors">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                  isSolved
                                    ? (isHigh ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700')
                                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400'
                                }`}>
                                  {isSolved ? <i className="fas fa-check text-[10px]"></i> : <i className="far fa-circle text-[8px]"></i>}
                                </span>
                                <span className="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200 truncate" title={lesson.title}>
                                  {lesson.title}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {isSolved ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className={`px-2.5 py-1 rounded-lg text-xs font-black shadow-2xs ${
                                      score >= 85 
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' 
                                        : score >= 65 
                                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200' 
                                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                    }`}>
                                      {toEasternArabic(score)}٪
                                    </span>
                                    {onGrantNewAttempt && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onGrantNewAttempt(student.phone, student.name, lesson.title);
                                        }}
                                        className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer"
                                        title="منح الطالب فرصة رسمية جديدة لهذا الدرس"
                                      >
                                        <i className="fas fa-redo-alt text-[9px]"></i>
                                        <span className="hidden sm:inline">فرصة جديدة</span>
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                    لم يُختبر
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div 
                        onClick={() => toggleUnit(unit.id)}
                        className="py-2.5 px-4 bg-gray-50/40 hover:bg-gray-50 text-[11px] font-bold text-gray-500 hover:text-primary flex items-center justify-between cursor-pointer transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <i className="fas fa-list-ul text-primary/60 text-[10px]"></i>
                          <span>انقر هنا لعرض تفاصيل الـ {toEasternArabic(unitLessons.length)} دروس ونتائجها 👈</span>
                        </span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          (الدروس مخفية للترتيب - اضغط للعرض)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* تبويب 2: السجل الزمني الكامل للمحاولات */}
          {activeTab === 'timeline' && (
            <div className="space-y-2">
              {student.tests && student.tests.length > 0 ? (
                [...student.tests].reverse().map((test, tIdx) => {
                  const isReset = test.quiz.includes('تصفير') || String(test.score).includes('تصفير');
                  const scoreNum = normalizeScore(test.score);

                  if (isReset) {
                    return (
                      <div key={tIdx} className="p-3 bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-bold min-w-0">
                          <i className="fas fa-redo-alt text-rose-600 shrink-0"></i>
                          <span className="truncate">{test.quiz}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono shrink-0">{test.date}</span>
                      </div>
                    );
                  }

                  return (
                    <div key={tIdx} className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex items-center justify-between gap-3 shadow-2xs hover:bg-gray-50/60 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                          scoreNum >= 85 ? 'bg-emerald-100 text-emerald-700' : scoreNum >= 65 ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                          <i className="fas fa-file-signature"></i>
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs sm:text-sm font-black text-gray-900 dark:text-gray-100 block truncate" title={test.quiz}>
                            {test.quiz}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono block">
                            {test.date || 'بدون تاريخ'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2.5 py-1 rounded-xl text-xs font-black ${
                          scoreNum >= 85
                            ? 'bg-emerald-100 text-emerald-800'
                            : scoreNum >= 65
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {toEasternArabic(scoreNum)}٪
                        </span>
                        {onGrantNewAttempt && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onGrantNewAttempt(student.phone, student.name, test.quiz);
                            }}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer"
                            title="منح الطالب فرصة رسمية جديدة لهذا الاختبار"
                          >
                            <i className="fas fa-redo-alt text-[9px]"></i>
                            <span>فرصة جديدة</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <i className="fas fa-history text-3xl mb-2 block"></i>
                  <span>لا يوجد أي سجل محاولات لهذا الطالب حتى الآن.</span>
                </div>
              )}
            </div>
          )}

          {/* تبويب 3: نواقص لوحة الشرف */}
          {activeTab === 'missing' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                <i className="fas fa-exclamation-triangle text-base text-amber-600 shrink-0"></i>
                <span>الدروس التالية مطلوبة للتأهل للوحة الشرف ولم يقم الطالب بأداء اختباراتها حتى الآن:</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {missingHonorLessons.map((lessonTitle, idx) => (
                  <div key={idx} className="p-3 bg-white dark:bg-gray-800 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-center justify-between gap-2 shadow-2xs">
                    <span className="text-xs font-black text-gray-800 dark:text-gray-200 truncate" title={lessonTitle}>
                      {toEasternArabic(idx + 1)}. {lessonTitle}
                    </span>
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 dark:bg-rose-950 px-2 py-0.5 rounded-md shrink-0">
                      لم يتم الحل
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* تذييل النافذة */}
        <div className="p-4 bg-gray-50 dark:bg-gray-850 border-t border-gray-200 dark:border-gray-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-primary text-white font-black text-xs rounded-xl shadow-md hover:bg-gray-800 active:scale-95 transition-all cursor-pointer"
          >
            إغلاق وعودة
          </button>
        </div>
      </div>
    </div>
  );
};
