import React from 'react';
import { StudentRetakeDirective } from '../types';
import { detectArabicGender } from '../utils';

interface StudentRetakeNotificationModalProps {
  isOpen: boolean;
  directive: StudentRetakeDirective | null;
  studentName?: string;
  studentGender?: string;
  onAcknowledge: (directive: StudentRetakeDirective) => void;
  isDarkMode?: boolean;
}

export const StudentRetakeNotificationModal: React.FC<StudentRetakeNotificationModalProps> = ({
  isOpen,
  directive,
  studentName,
  studentGender,
  onAcknowledge,
  isDarkMode = false
}) => {
  if (!isOpen || !directive) return null;

  const effectiveName = directive.studentName || studentName || 'طالبنا المتميز';
  const gender = detectArabicGender(effectiveName, studentGender);
  const isFemale = gender === 'female';
  const isEssayOnly = directive.retakeType === 'essay_only';

  return (
    <div 
      className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in select-none"
      dir="rtl"
    >
      <div 
        className={`w-full max-w-lg rounded-3xl shadow-2xl border-2 overflow-hidden flex flex-col animate-scale-up text-right relative ${
          isDarkMode 
            ? 'bg-gray-900 border-indigo-700 text-gray-100 shadow-indigo-950/70' 
            : 'bg-white border-indigo-200 text-gray-900 shadow-indigo-200/50'
        }`}
      >
        {/* شريط زينة جمالي علوي */}
        <div className={`h-2.5 w-full bg-gradient-to-r ${
          isEssayOnly 
            ? 'from-purple-600 via-amber-500 to-indigo-600' 
            : 'from-blue-600 via-indigo-600 to-emerald-500'
        }`}></div>

        {/* ترويسة الرسالة مع صورة وشارة الأستاذ إسلام سعود */}
        <div className={`p-5 sm:p-6 pb-4 border-b ${
          isDarkMode 
            ? 'bg-gradient-to-b from-gray-800 to-gray-850 border-gray-700' 
            : 'bg-gradient-to-b from-indigo-50/80 via-blue-50/40 to-white border-indigo-100'
        }`}>
          <div className="flex items-center gap-3.5">
            {/* أيقونة التتويج / المعلم */}
            <div className={`w-13 h-13 rounded-2xl flex items-center justify-center text-2xl shrink-0 shadow-md border ${
              isFemale 
                ? 'bg-rose-100 text-rose-600 border-rose-200' 
                : 'bg-indigo-100 text-indigo-700 border-indigo-200'
            }`}>
              {isFemale ? '🌸' : '🎓'}
            </div>

            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-black tracking-wide text-indigo-600 dark:text-indigo-400 block mb-0.5">
                موسوعة الكنز التعليمية • أ/ إسلام سعود
              </span>
              <h3 className="text-sm sm:text-base font-black truncate text-gray-900 dark:text-white">
                {isFemale 
                  ? 'رسالة خاصة من الأستاذ إسلام سعود إلى ابنتي الغالية' 
                  : 'رسالة خاصة من الأستاذ إسلام سعود إلى ابني البطل'}
              </h3>
              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-black border ${
                isFemale 
                  ? 'bg-rose-50 text-rose-700 border-rose-200' 
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                👤 {effectiveName}
              </span>
            </div>
          </div>
        </div>

        {/* جسم الرسالة التربوية المخصصة */}
        <div className="p-5 sm:p-6 space-y-4 text-xs sm:text-sm leading-relaxed">
          {/* شارة نوع المحاولة */}
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <span className="font-black text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <i className={isEssayOnly ? "fas fa-pen-fancy text-amber-500" : "fas fa-redo-alt text-blue-500"}></i>
              <span>نوع الإعادة الممنوحة:</span>
            </span>
            <span className={`px-2.5 py-1 rounded-xl text-xs font-black shadow-2xs ${
              isEssayOnly 
                ? 'bg-gradient-to-r from-amber-500 to-purple-600 text-white' 
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
            }`}>
              {isEssayOnly ? '✍️ إعادة المقالي فقط (الاختياري محفوظ)' : '🔄 إعادة الامتحان كاملاً (اختياري + مقالي)'}
            </span>
          </div>

          {/* نص الرسالة */}
          <div className={`p-4 rounded-2xl border ${
            isDarkMode 
              ? 'bg-indigo-950/30 border-indigo-900/60 text-indigo-200' 
              : 'bg-indigo-50/70 border-indigo-200 text-indigo-950'
          }`}>
            <p className="font-bold mb-2">
              {isFemale ? 'أهلاً بكِ يا بطلتي،' : 'أهلاً بك يا بطل،'}
            </p>

            {isEssayOnly ? (
              <div className="space-y-2 font-medium">
                <p>
                  ✅ <strong className="text-emerald-600 dark:text-emerald-400 font-black">درجاتك في الأسئلة الاختيارية محفوظة بنجاح!</strong>
                </p>
                <p>
                  بناءً على مراجعة إجاباتك، قمتُ بإتاحة <strong>إعادة صياغة وحل الأسئلة المقالية فقط</strong> في امتحان:
                </p>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 font-black text-center text-primary dark:text-indigo-300">
                  📖 {directive.lessonTitle}
                </div>
                <p className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 leading-normal">
                  {isFemale 
                    ? 'راجعي نموذج الإجابة جيداً وركّزي في استيفاء كافة العناصر التاريخية والشواهد لتضمني الدرجة الكاملة بإذن الله. أنا واثق في تفوقك! 🌸🎯'
                    : 'راجع نموذج الإجابة جيداً وركّز في استيفاء كافة العناصر التاريخية والشواهد لتضمن الدرجة الكاملة بإذن الله. أنا واثق في تفوقك! 💪🎯'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 font-medium">
                <p>
                  بناءً على متابعة تقدمك، قمتُ بإتاحة <strong>إعادة محاولة الامتحان كاملاً</strong> في درس:
                </p>
                <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 font-black text-center text-primary dark:text-indigo-300">
                  📖 {directive.lessonTitle}
                </div>
                <p className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 leading-normal">
                  {isFemale 
                    ? 'تم تصفير المحاولة السابقة لتبدئي من السؤال الأول. استعيني بالله، راجعي مفاهيم الدرس جيداً وركّزي لتنالي الدرجة التي تليق بكِ! 🌸🎯'
                    : 'تم تصفير المحاولة السابقة لتبدأ من السؤال الأول. استعن بالله، راجع مفاهيم الدرس جيداً وركّز لتنال الدرجة التي تليق بك! 💪🎯'}
                </p>
              </div>
            )}
          </div>

          <div className="text-center text-[11px] font-bold text-gray-500 dark:text-gray-400">
            <span>تاريخ إصدار التوجيه: {directive.date || new Date().toLocaleDateString('ar-EG')}</span>
          </div>
        </div>

        {/* زر الموافقة المباشر وغير القابل للإغلاق بالخطأ */}
        <div className={`p-4 border-t ${
          isDarkMode ? 'bg-gray-850 border-gray-700' : 'bg-gray-50 border-gray-200'
        }`}>
          <button
            type="button"
            onClick={() => onAcknowledge(directive)}
            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-primary to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black text-sm sm:text-base shadow-lg shadow-indigo-600/30 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <i className="fas fa-rocket text-amber-300"></i>
            <span>فهمت يا أستاذي، سأبدأ الحل الآن 🚀</span>
          </button>
        </div>
      </div>
    </div>
  );
};
