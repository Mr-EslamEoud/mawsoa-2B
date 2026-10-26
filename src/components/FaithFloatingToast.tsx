import React, { useState, useEffect, useRef } from 'react';
import { 
  FaithSupplication, 
  getNextNonRepeatingSupplication 
} from '../data/faithSupplications';

interface FaithFloatingToastProps {
  screen: string;
  isDarkMode?: boolean;
}

export const FaithFloatingToast: React.FC<FaithFloatingToastProps> = ({
  screen,
  isDarkMode = false
}) => {
  const [currentSupplication, setCurrentSupplication] = useState<FaithSupplication | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(100);

  // المؤقت الكلي للظهور كل 5 دقائق (300,000 مللي ثانية)
  const INTERVAL_MS = 5 * 60 * 1000;
  // مدة بقاء البطاقة ظاهرة للطالب (15 ثانية كافية للقراءة المريحة)
  const DURATION_MS = 15000; 

  const progressTimerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const remainingTimeRef = useRef<number>(DURATION_MS);

  // مؤقت التكرار كل 5 دقائق خارج الامتحان
  useEffect(() => {
    // لا يتم العرض إطلاقاً أثناء الاختبار لأن له قواعده الخاصة
    if (screen === 'quiz') {
      setIsVisible(false);
      return;
    }

    const intervalId = setInterval(() => {
      // التحقق من أن الطالب ليس في الامتحان
      if (screen !== 'quiz') {
        const nextDua = getNextNonRepeatingSupplication();
        setCurrentSupplication(nextDua);
        setProgress(100);
        remainingTimeRef.current = DURATION_MS;
        startTimeRef.current = Date.now();
        setIsVisible(true);
      }
    }, INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [screen, INTERVAL_MS]);

  // إدارة شريط التقدم والإغلاق التلقائي مع إمكانية التثبيت عند تحريك الفأرة
  useEffect(() => {
    if (!isVisible || isPaused) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      return;
    }

    const stepMs = 100;
    progressTimerRef.current = setInterval(() => {
      remainingTimeRef.current -= stepMs;
      const pct = Math.max(0, (remainingTimeRef.current / DURATION_MS) * 100);
      setProgress(pct);

      if (remainingTimeRef.current <= 0) {
        clearInterval(progressTimerRef.current);
        handleClose();
      }
    }, stepMs);

    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isVisible, isPaused]);

  const handleClose = () => {
    setIsVisible(false);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
  };

  const handleMouseEnter = () => {
    setIsPaused(true);
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
  };

  if (!isVisible || !currentSupplication || screen === 'quiz') {
    return null;
  }

  // تحديد أيقونة ولون التصنيف
  const getCategoryTheme = () => {
    switch (currentSupplication.category) {
      case 'quran':
        return {
          icon: 'fa-book-quran',
          badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
          accent: 'text-emerald-600 dark:text-emerald-400',
          barColor: 'from-emerald-500 to-teal-500'
        };
      case 'dhikr':
        return {
          icon: 'fa-kaaba',
          badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border-amber-300 dark:border-amber-700',
          accent: 'text-amber-600 dark:text-amber-400',
          barColor: 'from-amber-500 to-yellow-500'
        };
      case 'knowledge':
        return {
          icon: 'fa-graduation-cap',
          badgeBg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border-blue-300 dark:border-blue-700',
          accent: 'text-blue-600 dark:text-blue-400',
          barColor: 'from-blue-500 to-cyan-500'
        };
      default:
        return {
          icon: 'fa-hands-praying',
          badgeBg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border-purple-300 dark:border-purple-700',
          accent: 'text-purple-600 dark:text-purple-400',
          barColor: 'from-purple-500 to-pink-500'
        };
    }
  };

  const theme = getCategoryTheme();

  return (
    <div 
      dir="rtl"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="fixed bottom-4 sm:bottom-6 left-4 sm:left-6 z-[9999] max-w-sm sm:max-w-md w-[calc(100%-2rem)] transition-all duration-300 animate-fade-in select-none"
      style={{
        filter: 'drop-shadow(0 20px 30px rgba(16, 185, 129, 0.2))'
      }}
    >
      <div 
        className={`relative overflow-hidden rounded-3xl border-2 transition-all shadow-2xl backdrop-blur-xl ${
          isDarkMode
            ? 'bg-gradient-to-br from-gray-900/95 via-slate-900/90 to-emerald-950/80 border-emerald-600/40 text-gray-100'
            : 'bg-gradient-to-br from-white/95 via-emerald-50/90 to-amber-50/80 border-emerald-300/80 text-gray-900'
        }`}
      >
        {/* خلفية زخرفية ناعمة */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* رأس البطاقة */}
        <div className="px-5 pt-3.5 pb-2.5 flex items-center justify-between border-b border-emerald-500/15">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-xs shadow-inner">
              <i className="fas fa-seedling text-emerald-600 dark:text-emerald-400"></i>
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-black text-emerald-900 dark:text-emerald-200">
                نفحة إيمانية
              </span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border shadow-2xs truncate ${theme.badgeBg}`}>
                {currentSupplication.categoryLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isPaused && (
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800">
                مُثبَّت للقراءة
              </span>
            )}
            <button
              type="button"
              onClick={handleClose}
              title="إغلاق"
              className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/40 text-gray-500 flex items-center justify-center text-xs font-bold transition-all cursor-pointer"
            >
              <i className="fas fa-xmark"></i>
            </button>
          </div>
        </div>

        {/* محتوى الدعاء أو الذكر */}
        <div className="p-5 text-center relative z-10">
          <div className="mb-2 text-emerald-600 dark:text-emerald-400 opacity-60 text-lg">
            <i className="fas fa-quote-right"></i>
          </div>

          <p 
            className={`font-black text-sm sm:text-base leading-relaxed tracking-wide ${
              currentSupplication.isQuran
                ? 'font-serif text-base sm:text-lg text-emerald-900 dark:text-emerald-200'
                : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {currentSupplication.text}
          </p>

          <div className="mt-2 text-emerald-600 dark:text-emerald-400 opacity-60 text-lg">
            <i className="fas fa-quote-left"></i>
          </div>
        </div>

        {/* شريط الإجراء السفلي */}
        <div className="px-5 pb-3.5 pt-2 flex items-center justify-between text-[11px] text-gray-500 font-bold border-t border-emerald-500/10">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
            <i className="fas fa-heart text-emerald-500"></i>
            <span>ذكر وتذكير</span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-black rounded-xl shadow-md shadow-emerald-600/30 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>آمين 🤲</span>
          </button>
        </div>

        {/* شريط التقدم الزمني بالأسفل */}
        <div className="h-1 w-full bg-gray-200/50 dark:bg-gray-800/50 overflow-hidden">
          <div 
            className={`h-full bg-gradient-to-l ${theme.barColor} transition-all duration-100 ease-linear`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};
