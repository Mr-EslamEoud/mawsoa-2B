import React, { useState, useMemo } from 'react';
import { Unit, Lesson, ExamConfig, ExamScheduleTarget, ExamLeaderboardPolicy } from '../types';
import { 
  getExamConfig, 
  saveExamConfig, 
  getExamAvailability, 
  formatScheduleDate,
  ExamAvailabilityResult 
} from '../examConfigUtils';

interface AdminExamScheduleTabProps {
  data: Unit[];
  isDarkMode?: boolean;
  onNavigateToLessonConfig?: (lesson: Lesson, unitTitle: string) => void;
  isLessonActive?: (lessonId: string, category?: 'online' | 'center') => boolean;
  onSyncToCloud?: () => Promise<boolean>;
  isSyncingToCloud?: boolean;
}

interface ExamScheduleRowItem {
  lesson: Lesson;
  unitId: string;
  unitTitle: string;
  config: ExamConfig;
  onlineAvailability: ExamAvailabilityResult;
  centerAvailability: ExamAvailabilityResult;
  isPublishedOnline: boolean;
  isPublishedCenter: boolean;
}

export const AdminExamScheduleTab: React.FC<AdminExamScheduleTabProps> = ({
  data = [],
  isDarkMode = false,
  onNavigateToLessonConfig,
  isLessonActive,
  onSyncToCloud,
  isSyncingToCloud = false,
}) => {
  // الحالات
  const [targetAudienceFilter, setTargetAudienceFilter] = useState<'all' | 'online' | 'center'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'upcoming' | 'expired'>('all');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // نافذة تعديل جدولة امتحان مفرد
  const [editingItem, setEditingItem] = useState<{ lesson: Lesson; unitTitle: string; config: ExamConfig } | null>(null);

  // نافذة جدولة وحدة كاملة دفعة واحدة
  const [batchUnitItem, setBatchUnitItem] = useState<{ unit: Unit } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const triggerRefresh = () => setRefreshCounter(c => c + 1);

  // جلب كافة صفوف الامتحانات بحالاتها المحدثة
  const examRows: ExamScheduleRowItem[] = useMemo(() => {
    const rows: ExamScheduleRowItem[] = [];
    data.forEach(unit => {
      unit.lessons.forEach(lesson => {
        const config = getExamConfig(lesson.id);
        const onlineAvailability = getExamAvailability(config, 'online');
        const centerAvailability = getExamAvailability(config, 'center');
        const isPublishedOnline = isLessonActive ? isLessonActive(lesson.id, 'online') : true;
        const isPublishedCenter = isLessonActive ? isLessonActive(lesson.id, 'center') : true;

        rows.push({
          lesson,
          unitId: unit.id,
          unitTitle: unit.title,
          config,
          onlineAvailability,
          centerAvailability,
          isPublishedOnline,
          isPublishedCenter,
        });
      });
    });
    return rows;
  }, [data, isLessonActive, refreshCounter]);

  // إحصائيات سريعة للجدولة
  const stats = useMemo(() => {
    let openCount = 0;
    let upcomingCount = 0;
    let expiredCount = 0;
    let alwaysCount = 0;

    examRows.forEach(item => {
      // نأخذ الحالة حسب الفلتر المختار
      const avail = targetAudienceFilter === 'center' ? item.centerAvailability : item.onlineAvailability;
      if (avail.status === 'open') {
        openCount++;
        if (!avail.isScheduleActive) alwaysCount++;
      } else if (avail.status === 'upcoming') {
        upcomingCount++;
      } else if (avail.status === 'expired') {
        expiredCount++;
      }
    });

    return {
      total: examRows.length,
      openCount,
      upcomingCount,
      expiredCount,
      alwaysCount,
    };
  }, [examRows, targetAudienceFilter]);

  // فلترة الامتحانات
  const filteredRows = useMemo(() => {
    return examRows.filter(item => {
      // فلتر الوحدة
      if (unitFilter !== 'all' && item.unitTitle !== unitFilter && item.unitId !== unitFilter) {
        return false;
      }

      // فلتر الحالة
      const avail = targetAudienceFilter === 'center' ? item.centerAvailability : item.onlineAvailability;
      if (statusFilter !== 'all' && avail.status !== statusFilter) {
        return false;
      }

      // فلتر الجمهور
      if (targetAudienceFilter === 'online') {
        if (item.config.targetAudience === 'center_only') return false;
      } else if (targetAudienceFilter === 'center') {
        if (item.config.targetAudience === 'online_only') return false;
      }

      // فلتر البحث
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchTitle = item.lesson.title.toLowerCase().includes(q);
        const matchUnit = item.unitTitle.toLowerCase().includes(q);
        if (!matchTitle && !matchUnit) return false;
      }

      return true;
    });
  }, [examRows, unitFilter, statusFilter, targetAudienceFilter, searchQuery]);

  // تمديد الامتحان 24 ساعة بنقرة واحدة سريعة
  const handleQuickExtend24h = (item: ExamScheduleRowItem) => {
    const now = new Date();
    const currentEnd = item.config.endDate ? new Date(item.config.endDate) : now;
    const base = currentEnd > now ? currentEnd : now;
    const newEnd = new Date(base.getTime() + 24 * 60 * 60 * 1000);

    // تحويل لصيغة YYYY-MM-DDTHH:mm
    const pad = (n: number) => n.toString().padStart(2, '0');
    const newEndStr = `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}T${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`;

    const updated: ExamConfig = {
      ...item.config,
      scheduleMode: 'scheduled',
      endDate: newEndStr,
      startDate: item.config.startDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
    };

    saveExamConfig(updated);
    triggerRefresh();
    if (onSyncToCloud) onSyncToCloud();
    showToast(`⏱️ تم تمديد امتحان "${item.lesson.title}" لمدة 24 ساعة ومزامنته سحابياً!`);
  };

  // تحويل الامتحان لمتاح دائماً بنقرة واحدة
  const handleQuickMakeAlways = (item: ExamScheduleRowItem) => {
    const updated: ExamConfig = {
      ...item.config,
      scheduleMode: 'always',
    };
    saveExamConfig(updated);
    triggerRefresh();
    if (onSyncToCloud) onSyncToCloud();
    showToast(`🟢 أصبح امتحان "${item.lesson.title}" متاحاً دائماً للطلاب ومزامن سحابياً!`);
  };

  // إغلاق الامتحان فوراً
  const handleQuickCloseNow = (item: ExamScheduleRowItem) => {
    const now = new Date(Date.now() - 60000); // دقيقة في الماضي للإغلاق الفوري
    const pad = (n: number) => n.toString().padStart(2, '0');
    const pastStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const updated: ExamConfig = {
      ...item.config,
      scheduleMode: 'scheduled',
      endDate: pastStr,
    };
    saveExamConfig(updated);
    triggerRefresh();
    if (onSyncToCloud) onSyncToCloud();
    showToast(`🔒 تم إغلاق امتحان "${item.lesson.title}" فوراً في وجه الطلاب ومزامنة الإغلاق!`);
  };

  // تطبيق فتح الكل دائماً
  const handleMakeAllAlwaysGlobal = async () => {
    if (!window.confirm("هل أنت متأكد من جعل جميع الامتحانات متاحة دائماً لجميع الطلاب بدون قيود زمنية؟")) return;
    data.forEach(u => {
      u.lessons.forEach(l => {
        const cfg = getExamConfig(l.id);
        saveExamConfig({ ...cfg, scheduleMode: 'always' });
      });
    });
    triggerRefresh();
    if (onSyncToCloud) {
      await onSyncToCloud();
    }
    showToast("🎉 أصبحت جميع الامتحانات متاحة دائماً لجميع الطلاب وتمت المزامنة السحابية بنجاح!");
  };

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden animate-fade-in" dir="rtl">
      {/* رأس التبويب */}
      <div className="bg-gradient-to-l from-amber-50/90 via-white to-orange-50/60 p-4 sm:p-5 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-black text-primary flex items-center gap-2">
            <i className="fas fa-clock text-amber-500"></i> جدولة ومواعيد إتاحة الامتحانات ⏰
          </h2>
          <p className="text-xs text-gray-500 font-bold mt-1">
            تحكم في موعد فتح وإغلاق الامتحانات باليوم والساعة لطلاب الأونلاين والسنتر، مع تحديد احتساب الدرجات في لوحة الشرف.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onSyncToCloud && (
            <button
              type="button"
              onClick={async () => {
                const ok = await onSyncToCloud();
                if (ok) {
                  showToast("🚀 تم حفظ ونشر مواعيد الامتحانات سحابياً لهواتف جميع الطلاب بنجاح!");
                } else {
                  showToast("⚠️ حدث خطأ أثناء المزامنة السحابية. يرجى التحقق من اتصال الإنترنت.");
                }
              }}
              disabled={isSyncingToCloud}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
              title="نشر ومزامنة مواعيد الامتحانات سحابياً لتنعكس على هواتف الطلاب فوراً"
            >
              <i className={isSyncingToCloud ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-up"}></i>
              <span>{isSyncingToCloud ? "جاري المزامنة للطلاب..." : "حفظ ومزامنة للطلاب 🚀"}</span>
            </button>
          )}

          {data.length > 0 && (
            <button
              type="button"
              onClick={() => setBatchUnitItem({ unit: data[0] })}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
            >
              <i className="fas fa-calendar-check"></i>
              جدولة وحدة كاملة 📅
            </button>
          )}

          <button
            type="button"
            onClick={handleMakeAllAlwaysGlobal}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold text-xs sm:text-sm px-3.5 py-2.5 rounded-xl shadow-sm active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
            title="إلغاء المواعيد وجعل كل الامتحانات مفتوحة دائماً"
          >
            <i className="fas fa-lock-open text-emerald-600"></i>
            إتاحة الكل دائماً 🟢
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* إشعار عائم */}
        {toastMessage && (
          <div className="p-3 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 animate-fade-in">
            <i className="fas fa-check-circle text-emerald-600"></i>
            {toastMessage}
          </div>
        )}

        {/* كروت الإحصائيات الأربعة */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div 
            onClick={() => setStatusFilter('open')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'open' ? 'bg-emerald-50 border-emerald-400 shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-emerald-700 block mb-1">🟢 متاح حالياً للطلاب</span>
            <span className="text-2xl font-black text-emerald-900">{stats.openCount}</span>
          </div>

          <div 
            onClick={() => setStatusFilter('upcoming')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'upcoming' ? 'bg-amber-50 border-amber-400 shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-amber-700 block mb-1">⏳ مجدول لم يبدأ بعد</span>
            <span className="text-2xl font-black text-amber-900">{stats.upcomingCount}</span>
          </div>

          <div 
            onClick={() => setStatusFilter('expired')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'expired' ? 'bg-rose-50 border-rose-400 shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-rose-700 block mb-1">🔒 منتهي ومغلق</span>
            <span className="text-2xl font-black text-rose-900">{stats.expiredCount}</span>
          </div>

          <div 
            onClick={() => setStatusFilter('all')}
            className={`p-3.5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
              statusFilter === 'all' ? 'bg-primary/5 border-primary shadow-sm' : 'bg-gray-50/60 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span className="text-xs font-bold text-primary block mb-1">📚 إجمالي الامتحانات</span>
            <span className="text-2xl font-black text-primary">{stats.total}</span>
          </div>
        </div>

        {/* شريط الفلاتر والبحث */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {/* فلتر الفئة المستهدفة */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-users text-primary ml-1"></i> فئة الطلاب:
            </label>
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setTargetAudienceFilter('all')}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                  targetAudienceFilter === 'all' ? 'bg-primary text-white shadow-sm font-black' : 'text-gray-600'
                }`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setTargetAudienceFilter('online')}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                  targetAudienceFilter === 'online' ? 'bg-emerald-600 text-white shadow-sm font-black' : 'text-gray-600'
                }`}
              >
                🌐 أونلاين
              </button>
              <button
                type="button"
                onClick={() => setTargetAudienceFilter('center')}
                className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${
                  targetAudienceFilter === 'center' ? 'bg-blue-600 text-white shadow-sm font-black' : 'text-gray-600'
                }`}
              >
                🏛️ سنتر
              </button>
            </div>
          </div>

          {/* فلتر الوحدة الدراسية */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-folder text-primary ml-1"></i> تصفية حسب الوحدة:
            </label>
            <select
              value={unitFilter}
              onChange={e => setUnitFilter(e.target.value)}
              className="w-full p-2.5 text-xs font-bold border border-gray-300 rounded-xl focus:ring-1 focus:ring-primary outline-none bg-white"
            >
              <option value="all">🌟 جميع الوحدات</option>
              {data.map(u => (
                <option key={u.id} value={u.title}>
                  📂 {u.title}
                </option>
              ))}
            </select>
          </div>

          {/* فلتر حالة الإتاحة */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-filter text-primary ml-1"></i> حالة الامتحان:
            </label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="w-full p-2.5 text-xs font-bold border border-gray-300 rounded-xl focus:ring-1 focus:ring-primary outline-none bg-white"
            >
              <option value="all">📁 جميع الحالات</option>
              <option value="open">🟢 متاح حالياً للطلاب</option>
              <option value="upcoming">⏳ مجدول لم يبدأ بعد</option>
              <option value="expired">🔒 منتهي ومغلق</option>
            </select>
          </div>

          {/* حقل البحث بالاسم */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              <i className="fas fa-search text-gray-400 ml-1"></i> بحث باسم الامتحان:
            </label>
            <input
              type="text"
              placeholder="ابحث هنا..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full p-2.5 text-xs font-bold border border-gray-300 rounded-xl focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
        </div>

        {/* قائمة الامتحانات وجدول الجدولة */}
        {filteredRows.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed border-gray-200 rounded-2xl">
            <i className="fas fa-calendar-xmark text-4xl text-gray-300 mb-3 block"></i>
            <p className="text-gray-500 font-bold text-sm">لا توجد امتحانات مطابقة لمعايير البحث الحالية.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRows.map(item => {
              const avail = targetAudienceFilter === 'center' ? item.centerAvailability : item.onlineAvailability;
              const isScheduled = item.config.scheduleMode === 'scheduled';
              const target = item.config.targetAudience || 'all';
              const lbPolicy = item.config.leaderboardPolicy || 'always';

              return (
                <div
                  key={item.lesson.id}
                  className={`p-4 rounded-2xl border-2 transition-all flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 ${
                    avail.status === 'open' 
                      ? 'border-emerald-200 bg-white hover:border-emerald-300 shadow-2xs' 
                      : avail.status === 'upcoming' 
                      ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300' 
                      : 'border-rose-200 bg-rose-50/20 hover:border-rose-300'
                  }`}
                >
                  {/* معلومات الامتحان */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-base font-black text-gray-900 truncate">
                        {item.lesson.title}
                      </h4>
                      <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                        📂 {item.unitTitle}
                      </span>
                      <span className="text-[11px] font-bold text-gray-400">
                        ({item.lesson.questions.length} سؤال)
                      </span>
                    </div>

                    {/* الشارات التوضيحية */}
                    <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
                      {/* شارة الجمهور المستهدف */}
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
                        target === 'all' 
                          ? 'bg-purple-50 text-purple-800 border-purple-200' 
                          : target === 'online_only' 
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                          : 'bg-blue-50 text-blue-800 border-blue-200'
                      }`}>
                        {target === 'all' ? '👥 الجميع' : target === 'online_only' ? '🌐 أونلاين فقط' : '🏛️ سنتر فقط'}
                      </span>

                      {/* شارة الحالة الزمنية */}
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] border font-black ${
                        avail.status === 'open' 
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                          : avail.status === 'upcoming' 
                          ? 'bg-amber-100 text-amber-900 border-amber-300' 
                          : 'bg-rose-100 text-rose-900 border-rose-300'
                      }`}>
                        {avail.badgeText}
                      </span>

                      {/* شارة لوحة الشرف */}
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
                        lbPolicy === 'never'
                          ? 'bg-gray-100 text-gray-600 border-gray-300'
                          : lbPolicy === 'within_schedule'
                          ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {lbPolicy === 'never' ? '🚫 خارج لوحة الشرف' : lbPolicy === 'within_schedule' ? '🏆 يُحسب في الموعد فقط' : '🏆 يُحسب دائماً'}
                      </span>
                    </div>

                    {/* نص التوقيت المفصل إذا كان مجدولاً */}
                    {isScheduled && (
                      <div className="text-[11px] text-gray-600 font-bold flex items-center gap-3 pt-1">
                        {item.config.startDate && (
                          <span>
                            <i className="fas fa-play text-emerald-500 ml-1"></i> يبدأ: {formatScheduleDate(item.config.startDate)}
                          </span>
                        )}
                        {item.config.endDate && (
                          <span>
                            <i className="fas fa-flag-checkered text-rose-500 ml-1"></i> ينتهي: {formatScheduleDate(item.config.endDate)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* أزرار الإجراءات السريعة */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0 w-full lg:w-auto justify-end border-t lg:border-t-0 pt-2 lg:pt-0">
                    <button
                      type="button"
                      onClick={() => setEditingItem({ lesson: item.lesson, unitTitle: item.unitTitle, config: item.config })}
                      className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-dark text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fas fa-edit"></i>
                      <span>تعديل الجدولة</span>
                    </button>

                    {isScheduled && (
                      <button
                        type="button"
                        onClick={() => handleQuickExtend24h(item)}
                        className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                        title="تمديد موعد إغلاق الامتحان 24 ساعة إضافية"
                      >
                        <i className="fas fa-clock-rotate-left"></i>
                        <span>+24 ساعة</span>
                      </button>
                    )}

                    {isScheduled ? (
                      <button
                        type="button"
                        onClick={() => handleQuickMakeAlways(item)}
                        className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                        title="إلغاء الموعد وجعل الامتحان مفتوحاً دائماً"
                      >
                        <i className="fas fa-lock-open"></i>
                        <span>إتاحة دائماً</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleQuickCloseNow(item)}
                        className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                        title="إغلاق الامتحان فوراً للطلاب"
                      >
                        <i className="fas fa-lock"></i>
                        <span>إغلاق الآن</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* نافذة تعديل جدولة امتحان مفرد */}
      {editingItem && (
        <ExamScheduleEditModal
          lesson={editingItem.lesson}
          unitTitle={editingItem.unitTitle}
          initialConfig={editingItem.config}
          onClose={() => setEditingItem(null)}
          onSave={async (updatedConfig, applyToWholeUnit) => {
            saveExamConfig(updatedConfig);
            if (applyToWholeUnit) {
              const u = data.find(unit => unit.title === editingItem.unitTitle || unit.lessons.some(l => l.id === editingItem.lesson.id));
              if (u) {
                u.lessons.forEach(l => {
                  const cfg = getExamConfig(l.id);
                  saveExamConfig({
                    ...cfg,
                    targetAudience: updatedConfig.targetAudience,
                    scheduleMode: updatedConfig.scheduleMode,
                    startDate: updatedConfig.startDate,
                    endDate: updatedConfig.endDate,
                    leaderboardPolicy: updatedConfig.leaderboardPolicy,
                  });
                });
              }
            }
            triggerRefresh();
            setEditingItem(null);
            if (onSyncToCloud) {
              await onSyncToCloud();
            }
            showToast(applyToWholeUnit 
              ? `✅ تم تطبيق الجدولة ومزامنتها سحابياً على جميع امتحانات وحدة "${editingItem.unitTitle}" بنجاح!` 
              : `✅ تم تحديث جدول امتحان "${editingItem.lesson.title}" ومزامنته سحابياً بنجاح!`
            );
          }}
          isDarkMode={isDarkMode}
        />
      )}

      {/* نافذة جدولة وحدة كاملة */}
      {batchUnitItem && (
        <BatchUnitScheduleModal
          units={data}
          initialUnit={batchUnitItem.unit}
          onClose={() => setBatchUnitItem(null)}
          onApply={async (selectedUnitId, scheduleData) => {
            const u = data.find(unit => unit.id === selectedUnitId);
            if (u) {
              u.lessons.forEach(l => {
                const cfg = getExamConfig(l.id);
                saveExamConfig({
                  ...cfg,
                  ...scheduleData,
                });
              });
              triggerRefresh();
              if (onSyncToCloud) {
                await onSyncToCloud();
              }
              showToast(`🎉 تم تطبيق الجدولة ومزامنتها سحابياً على جميع دروس وحدة "${u.title}" (${u.lessons.length} امتحان) بنجاح!`);
            }
            setBatchUnitItem(null);
          }}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
};

// -------------------------------------------------------------
// نافذة تعديل جدولة الامتحان الفردي (Modal)
// -------------------------------------------------------------

interface ExamScheduleEditModalProps {
  lesson: Lesson;
  unitTitle: string;
  initialConfig: ExamConfig;
  onClose: () => void;
  onSave: (updatedConfig: ExamConfig, applyToWholeUnit: boolean) => void;
  isDarkMode?: boolean;
}

const ExamScheduleEditModal: React.FC<ExamScheduleEditModalProps> = ({
  lesson,
  unitTitle,
  initialConfig,
  onClose,
  onSave,
  isDarkMode = false,
}) => {
  const [targetAudience, setTargetAudience] = useState<ExamScheduleTarget>(initialConfig.targetAudience || 'all');
  const [scheduleMode, setScheduleMode] = useState<'always' | 'scheduled'>(initialConfig.scheduleMode || 'always');
  const [startDate, setStartDate] = useState<string>(initialConfig.startDate || '');
  const [endDate, setEndDate] = useState<string>(initialConfig.endDate || '');
  const [leaderboardPolicy, setLeaderboardPolicy] = useState<ExamLeaderboardPolicy>(initialConfig.leaderboardPolicy || 'always');
  const [applyToWholeUnit, setApplyToWholeUnit] = useState<boolean>(false);

  // دالة مساعدة لضبط الوقت الحالي
  const handleSetStartNow = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    setStartDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
  };

  // أزرار الاختصارات السريعة لانتهاء الامتحان
  const handleAddDuration = (hoursToAdd: number) => {
    const base = startDate ? new Date(startDate) : new Date();
    const target = new Date(base.getTime() + hoursToAdd * 60 * 60 * 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    setEndDate(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: ExamConfig = {
      ...initialConfig,
      targetAudience,
      scheduleMode,
      startDate: scheduleMode === 'scheduled' ? startDate : '',
      endDate: scheduleMode === 'scheduled' ? endDate : '',
      leaderboardPolicy,
    };
    onSave(updated, applyToWholeUnit);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto" dir="rtl">
      <div className={`w-full max-w-xl max-h-[92vh] rounded-3xl shadow-2xl overflow-hidden my-auto border-2 flex flex-col ${
        isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-primary/20 text-gray-800'
      }`}>
        {/* رأس النافذة */}
        <div className="p-3.5 sm:p-4 border-b flex items-center justify-between gap-3 bg-gradient-to-l from-indigo-50/80 via-white to-blue-50/60 shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-black text-primary flex items-center gap-2">
              <i className="fas fa-clock text-amber-500"></i> ضبط مواعيد وجدولة إتاحة الامتحان
            </h3>
            <p className="text-xs text-gray-500 font-bold mt-0.5">
              {unitTitle} ⬅️ {lesson.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center cursor-pointer transition-colors"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {/* جسم النافذة - قابل للتمرير بسلاسة بدون إخفاء الأزرار */}
        <form id="examScheduleForm" onSubmit={handleSaveSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* 1. الجمهور المستهدف */}
          <div className="space-y-1.5">
            <label className="block text-xs font-black text-gray-700">
              <i className="fas fa-users text-primary ml-1"></i> الجمهور المستهدف بالامتحان:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetAudience('all')}
                className={`py-2 px-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  targetAudience === 'all'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black">👥 الجميع</span>
              </button>

              <button
                type="button"
                onClick={() => setTargetAudience('online_only')}
                className={`py-2 px-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  targetAudience === 'online_only'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black">🌐 أونلاين فقط</span>
              </button>

              <button
                type="button"
                onClick={() => setTargetAudience('center_only')}
                className={`py-2 px-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  targetAudience === 'center_only'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black">🏛️ سنتر فقط</span>
              </button>
            </div>
          </div>

          {/* 2. نوع الإتاحة */}
          <div className="space-y-1.5">
            <label className="block text-xs font-black text-gray-700">
              <i className="fas fa-calendar-alt text-primary ml-1"></i> نوع إتاحة الامتحان:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScheduleMode('always')}
                className={`py-2.5 px-3 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  scheduleMode === 'always'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black">🟢 متاح دائماً</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setScheduleMode('scheduled');
                  if (!startDate) handleSetStartNow();
                  if (!endDate) handleAddDuration(48);
                }}
                className={`py-2.5 px-3 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  scheduleMode === 'scheduled'
                    ? 'border-amber-600 bg-amber-50 text-amber-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black">⏳ مجدول بفترة محددة</span>
              </button>
            </div>
          </div>

          {/* 3. حقول التوقيت إذا كان مجدولاً */}
          {scheduleMode === 'scheduled' && (
            <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl space-y-3 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* تاريخ ووقت البدء */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-black text-gray-800">
                      <i className="fas fa-play text-emerald-600 ml-1"></i> يبدأ في:
                    </label>
                    <button
                      type="button"
                      onClick={handleSetStartNow}
                      className="text-[10px] font-black text-primary hover:underline cursor-pointer"
                    >
                      يبدأ الآن ⏱️
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full p-2 text-xs font-bold border border-gray-300 rounded-xl focus:ring-1 focus:ring-primary outline-none bg-white"
                  />
                  {startDate && (
                    <span className="text-[10px] text-gray-500 font-bold mt-1 block">
                      📌 {formatScheduleDate(startDate)}
                    </span>
                  )}
                </div>

                {/* تاريخ ووقت الانتهاء */}
                <div>
                  <label className="block text-xs font-black text-gray-800 mb-1">
                    <i className="fas fa-flag-checkered text-rose-600 ml-1"></i> ينتهي في:
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full p-2 text-xs font-bold border border-gray-300 rounded-xl focus:ring-1 focus:ring-primary outline-none bg-white"
                  />
                  {endDate && (
                    <span className="text-[10px] text-gray-500 font-bold mt-1 block">
                      🔒 {formatScheduleDate(endDate)}
                    </span>
                  )}
                </div>
              </div>

              {/* أزرار اختصارات سريعة لانتهاء الامتحان */}
              <div>
                <span className="text-[10px] font-black text-gray-600 block mb-1">
                  ⏱️ اختصارات سريعة للإغلاق:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: '+24 ساعة', hours: 24 },
                    { label: '+يومين', hours: 48 },
                    { label: '+3 أيام', hours: 72 },
                    { label: '+أسبوع', hours: 168 },
                  ].map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => handleAddDuration(preset.hours)}
                      className="text-xs font-bold px-2 py-0.5 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4. سياسة لوحة الشرف */}
          <div className="space-y-1.5">
            <label className="block text-xs font-black text-gray-700">
              <i className="fas fa-trophy text-amber-500 ml-1"></i> احتساب درجات الامتحان في لوحة الشرف:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setLeaderboardPolicy('within_schedule')}
                className={`py-2 px-2 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  leaderboardPolicy === 'within_schedule'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black block">⏱️ في الموعد فقط</span>
              </button>

              <button
                type="button"
                onClick={() => setLeaderboardPolicy('always')}
                className={`py-2 px-2 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  leaderboardPolicy === 'always'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black block">🏆 يُحسب دائماً</span>
              </button>

              <button
                type="button"
                onClick={() => setLeaderboardPolicy('never')}
                className={`py-2 px-2 rounded-xl border-2 text-center transition-all cursor-pointer ${
                  leaderboardPolicy === 'never'
                    ? 'border-rose-600 bg-rose-50 text-rose-900 font-black shadow-xs'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700 font-bold'
                }`}
              >
                <span className="text-xs font-black block">🚫 لا يُحسب</span>
              </button>
            </div>
          </div>

          {/* 5. خيار التطبيق على الوحدة كاملة */}
          <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              id="applyWholeUnitCheck"
              checked={applyToWholeUnit}
              onChange={e => setApplyToWholeUnit(e.target.checked)}
              className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="applyWholeUnitCheck" className="text-xs font-black text-gray-700 cursor-pointer select-none">
              📁 تطبيق نفس هذا التوقيت على جميع امتحانات وحدة "{unitTitle}" دفعة واحدة
            </label>
          </div>
        </form>

        {/* تذييل النافذة الثابت دائماً في الأسفل وظاهر بالكامل */}
        <div className="p-3.5 sm:p-4 border-t bg-gray-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs cursor-pointer transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="examScheduleForm"
            className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-dark text-white font-black text-xs sm:text-sm shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <i className="fas fa-save"></i>
            <span>حفظ وتطبيق الجدولة 🚀</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// -------------------------------------------------------------
// نافذة جدولة وحدة كاملة دفعة واحدة (Batch Modal)
// -------------------------------------------------------------

interface BatchUnitScheduleModalProps {
  units: Unit[];
  initialUnit: Unit;
  onClose: () => void;
  onApply: (unitId: string, scheduleData: Partial<ExamConfig>) => void;
  isDarkMode?: boolean;
}

const BatchUnitScheduleModal: React.FC<BatchUnitScheduleModalProps> = ({
  units,
  initialUnit,
  onClose,
  onApply,
  isDarkMode = false,
}) => {
  const [selectedUnitId, setSelectedUnitId] = useState<string>(initialUnit.id);
  const [targetAudience, setTargetAudience] = useState<ExamScheduleTarget>('all');
  const [scheduleMode, setScheduleMode] = useState<'always' | 'scheduled'>('scheduled');
  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [endDate, setEndDate] = useState<string>(() => {
    const target = new Date(Date.now() + 72 * 60 * 60 * 1000); // 3 أيام افتراضياً
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
  });
  const [leaderboardPolicy, setLeaderboardPolicy] = useState<ExamLeaderboardPolicy>('within_schedule');

  const selectedUnit = units.find(u => u.id === selectedUnitId) || initialUnit;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(selectedUnitId, {
      targetAudience,
      scheduleMode,
      startDate: scheduleMode === 'scheduled' ? startDate : '',
      endDate: scheduleMode === 'scheduled' ? endDate : '',
      leaderboardPolicy,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto" dir="rtl">
      <div className={`w-full max-w-xl max-h-[92vh] rounded-3xl shadow-2xl overflow-hidden my-auto border-2 flex flex-col ${
        isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-primary/20 text-gray-800'
      }`}>
        <div className="p-3.5 sm:p-4 border-b flex items-center justify-between gap-3 bg-gradient-to-l from-indigo-50/80 via-white to-blue-50/60 shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-black text-primary flex items-center gap-2">
              <i className="fas fa-calendar-check text-indigo-600"></i> جدولة وحدة دراسية كاملة دفعة واحدة
            </h3>
            <p className="text-xs text-gray-500 font-bold mt-0.5">
              تطبيق نفس مواعيد الإتاحة على جميع امتحانات الوحدة بنقرة واحدة.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center cursor-pointer transition-colors"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form id="batchUnitScheduleForm" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* اختيار الوحدة */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              اختر الوحدة المراد جدولتها:
            </label>
            <select
              value={selectedUnitId}
              onChange={e => setSelectedUnitId(e.target.value)}
              className="w-full p-2.5 text-xs font-bold border border-gray-300 rounded-xl focus:ring-1 focus:ring-primary outline-none bg-white"
            >
              {units.map(u => (
                <option key={u.id} value={u.id}>
                  📂 {u.title} ({u.lessons.length} امتحان)
                </option>
              ))}
            </select>
          </div>

          {/* فئة الطلاب */}
          <div>
            <label className="block text-xs font-black text-gray-700 mb-1">
              الجمهور المستهدف:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetAudience('all')}
                className={`py-2 px-3 rounded-xl border text-xs font-black transition-colors ${
                  targetAudience === 'all' ? 'bg-purple-600 text-white border-purple-600 shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                👥 للجميع
              </button>
              <button
                type="button"
                onClick={() => setTargetAudience('online_only')}
                className={`py-2 px-3 rounded-xl border text-xs font-black transition-colors ${
                  targetAudience === 'online_only' ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                🌐 أونلاين فقط
              </button>
              <button
                type="button"
                onClick={() => setTargetAudience('center_only')}
                className={`py-2 px-3 rounded-xl border text-xs font-black transition-colors ${
                  targetAudience === 'center_only' ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                🏛️ سنتر فقط
              </button>
            </div>
          </div>

          {/* مواعيد البدء والانتهاء */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 bg-gray-50 rounded-2xl border">
            <div>
              <label className="block text-xs font-black text-gray-700 mb-1">
                <i className="fas fa-play text-emerald-600 ml-1"></i> يبدأ في:
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full p-2 text-xs font-bold border border-gray-300 rounded-xl bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-gray-700 mb-1">
                <i className="fas fa-flag-checkered text-rose-600 ml-1"></i> ينتهي في:
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full p-2 text-xs font-bold border border-gray-300 rounded-xl bg-white"
              />
            </div>
          </div>

          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 font-bold flex items-center gap-2">
            <i className="fas fa-info-circle text-indigo-600 text-base shrink-0"></i>
            <span>
              سيتم تطبيق هذه الجدولة فوراً على عدد ({selectedUnit.lessons.length}) امتحانات في هذه الوحدة.
            </span>
          </div>
        </form>

        <div className="p-3.5 sm:p-4 border-t bg-gray-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs cursor-pointer transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="batchUnitScheduleForm"
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <i className="fas fa-check-double"></i>
            <span>تطبيق على كل دروس الوحدة 🚀</span>
          </button>
        </div>
      </div>
    </div>
  );
};
