export interface FaithSupplication {
  id: number;
  text: string;
  category: 'dhikr' | 'knowledge' | 'quran' | 'praise_ease';
  categoryLabel: string;
  isQuran?: boolean;
}

export const FAITH_SUPPLICATIONS: FaithSupplication[] = [
  // 1-14: الأذكار والاستغفار والتسبيح
  { id: 1, text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّد', category: 'dhikr', categoryLabel: 'الصلاة على النبي ﷺ' },
  { id: 2, text: 'أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ وَأَتُوبُ إِلَيْهِ', category: 'dhikr', categoryLabel: 'استغفار وتوبة' },
  { id: 3, text: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', category: 'dhikr', categoryLabel: 'كنز من كنوز الجنة' },
  { id: 4, text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيم', category: 'dhikr', categoryLabel: 'تسبيح وذكر' },
  { id: 5, text: 'سُبْحَانَ اللَّهِ، وَالْحَمْدُ لِلَّهِ، وَلَا إِلَهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَر', category: 'dhikr', categoryLabel: 'الباقيات الصالحات' },
  { id: 6, text: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِير', category: 'dhikr', categoryLabel: 'أفضل الذكر' },
  { id: 7, text: 'أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ الَّذِي لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ وَأَتُوبُ إِلَيْهِ', category: 'dhikr', categoryLabel: 'سيد الاستغفار' },
  { id: 8, text: 'سُبْحَانَ اللهِ عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ', category: 'dhikr', categoryLabel: 'ذكر مضاعف الأجر' },
  { id: 9, text: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ', category: 'dhikr', categoryLabel: 'دعاء نبوي شريف' },
  { id: 10, text: 'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْن', category: 'dhikr', categoryLabel: 'استغاثة وتفويض' },
  { id: 11, text: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْعَجْزِ وَالْكَسَل', category: 'dhikr', categoryLabel: 'استعاذة ودعاء' },
  { id: 12, text: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ', category: 'dhikr', categoryLabel: 'سؤال العافية' },
  { id: 13, text: 'رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ', category: 'dhikr', categoryLabel: 'طلب المغفرة' },
  { id: 14, text: 'لَا إِلَهَ إِلَّا اللَّهُ المَلِكُ الحَقُّ المُبِين', category: 'dhikr', categoryLabel: 'توحيد وتعظيم' },

  // 15-24: أدعية طلب العلم والتيسير والفهم
  { id: 15, text: 'اللَّهُمَّ لَا سَهْلَ إِلَّا مَا جَعَلْتَهُ سَهْلًا، وَأَنْتَ تَجْعَلُ الْحَزَنَ إِذَا شِئْتَ سَهْلًا', category: 'knowledge', categoryLabel: 'دعاء تيسير الصعاب' },
  { id: 16, text: 'اللَّهُمَّ انْفَعْنِي بِمَا عَلَّمْتَنِي، وَعَلِّمْنِي مَا يَنْفَعُنِي، وَزِدْنِي عِلْمًا', category: 'knowledge', categoryLabel: 'طلب العلم النافع' },
  { id: 17, text: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا، وَرِزْقًا طَيِّبًا، وَعَمَلًا مُتَقَبَّلًا', category: 'knowledge', categoryLabel: 'دعاء الصباح والتعلم' },
  { id: 18, text: 'اللَّهُمَّ فَقِّهْنِي فِي الدِّينِ وَعَلِّمْنِي التَّأْوِيلَ', category: 'knowledge', categoryLabel: 'سؤال الفقه والبصيرة' },
  { id: 19, text: 'اللَّهُمَّ اهْدِنِي وَسَدِّدْنِي', category: 'knowledge', categoryLabel: 'الهداية والتسديد' },
  { id: 20, text: 'بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', category: 'knowledge', categoryLabel: 'التوكل على الله' },
  { id: 21, text: 'اللَّهُمَّ إِنِّي أَبْرَأُ إِلَيْكَ مِنْ حَوْلِي وَقُوَّتِي، وَأَلْجَأُ إِلَى حَوْلِكَ وَقُوَّتكَ يَا ذَا الْقُوَّةِ الْمَتِين', category: 'knowledge', categoryLabel: 'التبرؤ من الحول والقوة' },
  { id: 22, text: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيم', category: 'knowledge', categoryLabel: 'تحصين وطمأنينة' },
  { id: 23, text: 'اللَّهُمَّ يَا مُعَلِّمَ مُوسَى عَلِّمْنِي، وَيَا مُفَهِّمَ سُلَيْمَانَ فَهِّمْنِي', category: 'knowledge', categoryLabel: 'سؤال الفهم والإلهام' },
  { id: 24, text: 'اللَّهُمَّ افْتَحْ عَلَيَّ فُتُوحَ الْعَارِفِينَ بِحِكْمَتِك', category: 'knowledge', categoryLabel: 'فتوح العارفين' },

  // 25-40: آيات قرآنية باعثة على الطمأنينة والثقة
  { id: 25, text: '﴿ أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الرعد', isQuran: true },
  { id: 26, text: '﴿ رَّبِّ زِدْنِي عِلْمًا ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة طه', isQuran: true },
  { id: 27, text: '﴿ رَبِّ اشْرَحْ لِي صَدْرِي • وَيَسِّرْ لِي أَمْرِي ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة طه', isQuran: true },
  { id: 28, text: '﴿ لَّا إِلَٰهَ إِلَّا أَنتَ سُبْحَانَكَ إِنِّي كُنتُ مِنَ الظَّالِمِينَ ﴾', category: 'quran', categoryLabel: 'دعوة ذي النون • سورة الأنبياء', isQuran: true },
  { id: 29, text: '﴿ رَبَّنَا آتِنَا مِن لَّدُنكَ رَحْمَةً وَهَيِّئْ لَنَا مِنْ أَمْرِنَا رَشَدًا ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الكهف', isQuran: true },
  { id: 30, text: '﴿ سُبْحَانَكَ لَا عِلْمَ لَنَا إِلَّا مَا عَلَّمْتَنَا إِنَّكَ أَنْتَ الْعَلِيمُ الْحَكِيمُ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة البقرة', isQuran: true },
  { id: 31, text: '﴿ حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة آل عمران', isQuran: true },
  { id: 32, text: '﴿ وَأُفَوِّضُ أَمْرِي إِلَى اللَّهِ إِنَّ اللَّهَ بَصِيرٌ بِالْعِبَادِ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة غافر', isQuran: true },
  { id: 33, text: '﴿ فَإِنَّ مَعَ الْعُسْرِ يُسْرًا • إِنَّ مَعَ الْعُسْرِ يُسْرًا ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الشرح', isQuran: true },
  { id: 34, text: '﴿ وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الطلاق', isQuran: true },
  { id: 35, text: '﴿ سَيَجْعَلُ اللَّهُ بَعْدَ عُسْرٍ يُسْرًا ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الطلاق', isQuran: true },
  { id: 36, text: '﴿ لَا تَحْزَنْ إِنَّ اللَّهَ مَعَنَا ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة التوبة', isQuran: true },
  { id: 37, text: '﴿ وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة البقرة', isQuran: true },
  { id: 38, text: '﴿ وَأَن لَّيسَ لِلإِنسَانِ إِلَّا مَا سَعَى ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة النجم', isQuran: true },
  { id: 39, text: '﴿ إِنَّا لَا نُضِيعُ أَجْرَ مَنْ أَحْسَنَ عَمَلًا ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الكهف', isQuran: true },
  { id: 40, text: '﴿ وَرَحْمَتِي وَسِعَتْ كُلَّ شَيْءٍ ﴾', category: 'quran', categoryLabel: 'آية كريمة • سورة الأعراف', isQuran: true },

  // 41-50: أدعية لتثبيت الحفظ، مواجهة الصعوبة، والحمد
  { id: 41, text: 'اللَّهُمَّ يَا جَامِعَ النَّاسِ لِيَوْمٍ لَا رَيْبَ فِيهِ، ارْدُدْ عَلَيَّ ضَالَّتِي وَمَعْلُومَاتِي', category: 'praise_ease', categoryLabel: 'استرجاع المحفوظ والضالة' },
  { id: 42, text: 'اللَّهُمَّ يَسِّرْ لِي مَا اسْتَعْسَر، وَاكْتُبْ لِي التَّوْفِيقَ', category: 'praise_ease', categoryLabel: 'سؤال التيسير والتوفيق' },
  { id: 43, text: 'الْحَمْدُ لِلَّهِ الَّذِي بِنِعْمَتِهِ تَتِمُّ الصَّالِحَات', category: 'praise_ease', categoryLabel: 'حمد وشكر' },
  { id: 44, text: 'هَذَا مِنْ فَضْلِ رَبِّي', category: 'praise_ease', categoryLabel: 'اعتراف بالفضل والنعمة' },
  { id: 45, text: 'وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ عَلَيْهِ تَوَكَّلْتُ وَإِلَيْهِ أُنِيب', category: 'praise_ease', categoryLabel: 'توكل وإنابة' },
  { id: 46, text: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ عَلَى نِعْمَةِ الْعِلْمِ وَالْفَهْم', category: 'praise_ease', categoryLabel: 'حمد على نعمة الفهم' },
  { id: 47, text: '﴿ قُلْ إِنَّ الْفَضْلَ بِيَدِ اللَّهِ يُؤْتِيهِ مَن يَشَاءُ ﴾', category: 'praise_ease', categoryLabel: 'آية كريمة • سورة آل عمران', isQuran: true },
  { id: 48, text: 'رَبَّنَا تَقَبَّلْ مِنَّا إِنَّكَ أَنْتَ السَّمِيعُ الْعَلِيمُ', category: 'praise_ease', categoryLabel: 'سؤال القبول' },
  { id: 49, text: 'اللَّهُمَّ اجْعَلْ عَمَلَنَا كُلَّهُ صَالِحاً، وَاجْعَلْهُ لِوَجْهِكَ خَالِصاً', category: 'praise_ease', categoryLabel: 'إخلاص النية' },
  { id: 50, text: 'اللَّهُمَّ بَارِكْ لَنَا فِي أَوْقَاتِنَا وَأَفْهَامِنَا', category: 'praise_ease', categoryLabel: 'بركة الوقت والفهم' }
];

/**
 * خوارزمية ذكية لاختيار دعاء بدون أي تكرار
 * تقوم بخلط الأدعية الـ 50 كاملة وعرضها واحداً تلو الآخر حتى تنتهي، ثم تعيد الخلط من جديد
 */
export function getNextNonRepeatingSupplication(): FaithSupplication {
  const STORAGE_KEY = 'app_faith_supplications_deck';
  let deck: number[] = [];
  
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      deck = JSON.parse(raw);
    }
  } catch (e) {
    deck = [];
  }

  // إذا كانت القائمة فارغة أو اكتملت الـ 50، نقوم بخلط قائمة جديدة بالكامل
  if (!Array.isArray(deck) || deck.length === 0) {
    deck = FAITH_SUPPLICATIONS.map(item => item.id);
    // خلط عشوائي (Fisher-Yates Shuffle)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  const nextId = deck.pop() || 1;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  } catch (e) {}

  return FAITH_SUPPLICATIONS.find(item => item.id === nextId) || FAITH_SUPPLICATIONS[0];
}

/**
 * جلب دعاء عشوائي مباشر
 */
export function getRandomFaithSupplication(): FaithSupplication {
  const index = Math.floor(Math.random() * FAITH_SUPPLICATIONS.length);
  return FAITH_SUPPLICATIONS[index];
}
