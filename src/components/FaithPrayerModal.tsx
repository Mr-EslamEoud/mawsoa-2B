import React from 'react';

export type FaithPrayerType = 'opening' | 'closing';

interface FaithPrayerModalProps {
  isOpen: boolean;
  type: FaithPrayerType;
  onClose: () => void;
  onConfirmAction?: () => void; // مثل تأكيد الخروج إذا كان دعاء الختام مرتبطاً بالخروج
  isDarkMode?: boolean;
}

export const FaithPrayerModal: React.FC<FaithPrayerModalProps> = ({
  isOpen,
  type,
  onClose,
  onConfirmAction,
  isDarkMode = false,
}) => {
  if (!isOpen) return null;

  const isOpening = type === 'opening';

  return (
    <div 
      className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      dir="rtl"
    >
      <div 
        className={`w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl border-2 transition-all relative overflow-hidden ${
          isDarkMode 
            ? 'bg-gradient-to-b from-gray-900 via-slate-900 to-gray-950 border-emerald-800/60 text-gray-100' 
            : 'bg-gradient-to-b from-emerald-50/70 via-white to-amber-50/50 border-emerald-300 text-gray-800'
        }`}
      >
        {/* زخرفة إسلامية خفيفة في الخلفية */}
        <div className="absolute -top-10 -right-10 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* رأس النافذة */}
        <div className="text-center mb-5 relative z-10">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center text-3xl shadow-sm border border-emerald-200 dark:border-emerald-800">
            {isOpening ? '🌿' : '🤲'}
          </div>

          <span className="text-xs font-black px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 inline-block mb-1.5 shadow-2xs">
            {isOpening ? 'بِسْمِ اللَّهِ نَبْدَأُ الْمُذَاكَرَةَ' : 'السُّنَّةُ النَّبَوِيَّةُ بَعْدَ أَيِّ مَجْلِسِ عِلْمٍ'}
          </span>

          <h3 className="text-xl sm:text-2xl font-black text-emerald-900 dark:text-emerald-200 mt-1">
            {isOpening ? 'دعاء بدء المذاكرة وتيسير الفهم' : 'دعاء ختام المذاكرة وكفارة المجلس'}
          </h3>
        </div>

        {/* صندوق الأدعية الشريفة */}
        <div className="space-y-3.5 my-5 relative z-10">
          {isOpening ? (
            <>
              {/* دعاء البدء 1 */}
              <div className={`p-4 rounded-2xl border transition-all text-center ${
                isDarkMode 
                  ? 'bg-gray-800/70 border-emerald-800/70 text-emerald-100 shadow-inner' 
                  : 'bg-white border-emerald-200 text-emerald-950 shadow-xs'
              }`}>
                <p className="text-base sm:text-lg font-black leading-relaxed font-serif">
                  «بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ»
                </p>
              </div>

              {/* دعاء البدء 2 */}
              <div className={`p-4 rounded-2xl border transition-all text-center ${
                isDarkMode 
                  ? 'bg-gray-800/70 border-emerald-800/70 text-emerald-100 shadow-inner' 
                  : 'bg-white border-emerald-200 text-emerald-950 shadow-xs'
              }`}>
                <p className="text-base sm:text-lg font-black leading-relaxed font-serif">
                  «اللَّهُمَّ بَارِكْ لِي فِي عَمَلِي، وَافْتَحْ عَلَيَّ فُتُوحَ الْعَارِفِينَ، وَيَسِّرْ لِي كُلَّ عَسِيرٍ»
                </p>
              </div>
            </>
          ) : (
            <>
              {/* دعاء كفارة المجلس */}
              <div className={`p-3.5 rounded-2xl border text-center ${
                isDarkMode 
                  ? 'bg-gray-800/70 border-emerald-800/70 text-emerald-100' 
                  : 'bg-white border-emerald-200 text-emerald-950 shadow-xs'
              }`}>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 block mb-1">
                  (كفارة المجلس):
                </span>
                <p className="text-sm sm:text-base font-black leading-relaxed font-serif">
                  «سُبْحانَكَ اللَّهُمَّ وَبِحَمْدِكَ، أَشْهَدُ أَنْ لا إِلهَ إِلاَّ أَنْتَ، أَسْتَغْفِرُكَ وَأَتُوبُ إِلَيْكَ»
                </p>
              </div>

              {/* دعاء الاستيداع */}
              <div className={`p-3.5 rounded-2xl border text-center ${
                isDarkMode 
                  ? 'bg-gray-800/70 border-emerald-800/70 text-emerald-100' 
                  : 'bg-white border-emerald-200 text-emerald-950 shadow-xs'
              }`}>
                <p className="text-sm sm:text-base font-black leading-relaxed font-serif">
                  «اللَّهُمَّ إِنِّي أَسْتَوْدِعُكَ مَا قَرَأْتُ وَمَا حَفِظْتُ وَمَا تَعَلَّمْتُ، فَرُدَّهُ إِلَيَّ عِنْدَ حَاجَتِي إِلَيْهِ، إِنَّكَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ»
                </p>
              </div>

              {/* دعاء نفع العلم */}
              <div className={`p-3 rounded-2xl border text-center ${
                isDarkMode 
                  ? 'bg-gray-800/70 border-emerald-800/70 text-emerald-100' 
                  : 'bg-white border-emerald-200 text-emerald-950 shadow-xs'
              }`}>
                <p className="text-sm sm:text-base font-black leading-relaxed font-serif">
                  «اللَّهُمَّ انْفَعْنِي بِمَا عَلَّمْتَنِي، وَعَلِّمْنِي مَا يَنْفَعُنِي، وَزِدْنِي عِلْمًا»
                </p>
              </div>
            </>
          )}
        </div>

        {/* أزرار الإجراء */}
        <div className="flex items-center gap-2.5 pt-2 relative z-10">
          {isOpening ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-black text-sm sm:text-base shadow-md transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
            >
              <span>ابدأ المذاكرة مستعيناً بالله 🚀</span>
            </button>
          ) : (
            <>
              {onConfirmAction ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onConfirmAction();
                    }}
                    className="flex-1 py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm shadow-sm transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>تأكيد الخروج • في أمان الله 🚪</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="py-3 px-4 rounded-2xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold text-xs sm:text-sm transition-all active:scale-98 cursor-pointer"
                  >
                    <span>البقاء بالمنصة</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm sm:text-base shadow-md transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>تقبل الله منا ومنكم • تم بحمد الله 🌿</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
