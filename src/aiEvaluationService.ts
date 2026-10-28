import { Question, ExamConfig, DialectPolicy } from './types';
import { detectEssayType, getQuestionMaxScore } from './examConfigUtils';

export interface EvaluationResult {
  score: number;
  maxScore: number;
  percentage: number;
  feedback: string;
  strengths?: string;
  improvements?: string;
  provider: 'gemini' | 'groq' | 'heuristic';
}

/**
 * جلب مفتاح Gemini API المخزن
 */
export const getGeminiApiKey = (): string => {
  try {
    const fromStorage = localStorage.getItem('gemini_api_key');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
    const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
    if (envKey && envKey.trim()) return envKey.trim();
  } catch (e) {}
  return '';
};

/**
 * حفظ مفتاح Gemini API في لوحة الإدارة
 */
export const setGeminiApiKey = (key: string): void => {
  try {
    localStorage.setItem('gemini_api_key', key.trim());
    if (key.trim()) {
      checkGeminiKeyHealth(key.trim());
    } else {
      setGeminiKeyHealth('missing');
    }
  } catch (e) {}
};

export type GeminiKeyHealth = 'active' | 'quota_exhausted' | 'invalid' | 'missing' | 'checking';

/**
 * جلب حالة صحة ونشاط مفتاح Gemini المخزنة
 */
export const getGeminiKeyHealth = (): GeminiKeyHealth => {
  try {
    const key = getGeminiApiKey();
    if (!key) return 'missing';
    const status = localStorage.getItem('gemini_key_health') as GeminiKeyHealth;
    if (status) return status;
  } catch (e) {}
  return 'missing';
};

/**
 * حفظ وتحديث حالة صحة المفتاح وبث تنبيه فوري لواجهة التطبيق
 */
export const setGeminiKeyHealth = (status: GeminiKeyHealth): void => {
  try {
    localStorage.setItem('gemini_key_health', status);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gemini_key_health_changed', { detail: status }));
    }
  } catch (e) {}
};

/**
 * فحص ذكي فوري لصلاحية المفتاح وحصة الكوتا المتاحة بتجربة نماذج متعددة لضمان الدقة
 */
export const checkGeminiKeyHealth = async (key?: string): Promise<GeminiKeyHealth> => {
  const currentKey = key || getGeminiApiKey();
  if (!currentKey || !currentKey.trim()) {
    setGeminiKeyHealth('missing');
    return 'missing';
  }

  // منع الفحص المتكرر المكثف إذا تم الفحص خلال الدقيقة الماضية لتجنب استهلاك الكوتا
  try {
    const lastCheck = sessionStorage.getItem('gemini_last_health_check');
    const now = Date.now();
    if (lastCheck && now - Number(lastCheck) < 60000 && !key) {
      return getGeminiKeyHealth();
    }
    sessionStorage.setItem('gemini_last_health_check', String(now));
  } catch (e) {}

  try {
    // 1. استعلام النماذج المصرح بها لهذا المفتاح
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${currentKey.trim()}`
    );
    const listData = await listRes.json();

    if (!listRes.ok) {
      const errMsg = listData.error?.message || '';
      if (listRes.status === 429 || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate')) {
        setGeminiKeyHealth('quota_exhausted');
        return 'quota_exhausted';
      }
      setGeminiKeyHealth('invalid');
      return 'invalid';
    }

    // استبعاد أي نماذج غير gemini أو تجريبية (لتجنب أخطاء 500 لنماذج gemma أو exp)
    const allModels = (listData.models || []) as Array<{ name: string; supportedGenerationMethods?: string[] }>;
    const validGenerationModels = allModels.filter(m => {
      const n = m.name.toLowerCase();
      return n.includes('gemini') &&
        m.supportedGenerationMethods?.includes('generateContent') &&
        !n.includes('2.5') && !n.includes('exp') && !n.includes('deprecated');
    });

    const candidates = [
      ...validGenerationModels.filter(m => m.name.includes('1.5-flash')),
      ...validGenerationModels.filter(m => m.name.includes('2.0-flash')),
      ...validGenerationModels.filter(m => m.name.includes('flash-8b')),
      ...validGenerationModels
    ].filter((m, i, arr) => arr.findIndex(x => x.name === m.name) === i);

    let isSuccess = false;
    let isQuota = false;

    for (const m of candidates) {
      const modelName = m.name.replace(/^models\//, '');
      try {
        const genRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${currentKey.trim()}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "ping" }] }]
            })
          }
        );
        const genData = await genRes.json();

        if (genRes.ok && genData.candidates && genData.candidates.length > 0) {
          try { localStorage.setItem('gemini_active_model', modelName); } catch (e) {}
          isSuccess = true;
          break;
        }

        const errMsg = genData.error?.message || '';
        if (genRes.status === 429 || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate')) {
          isQuota = true;
          break; // الكوتا مستنفذة للمفتاح كاملاً، التوقف الفوري لتجنب تكرار أخطاء 429
        }
      } catch (e) {
        // try next model
      }
    }

    if (isSuccess) {
      setGeminiKeyHealth('active');
      return 'active';
    }

    if (isQuota) {
      setGeminiKeyHealth('quota_exhausted');
      return 'quota_exhausted';
    }

    setGeminiKeyHealth('invalid');
    return 'invalid';
  } catch (e) {
    return getGeminiKeyHealth();
  }
};

/**
 * جلب مفتاح Groq API المخزن
 */
export const getGroqApiKey = (): string => {
  try {
    const fromStorage = localStorage.getItem('groq_api_key');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
    const envKey = (import.meta as any).env?.VITE_GROQ_API_KEY;
    if (envKey && envKey.trim()) return envKey.trim();
  } catch (e) {}
  return '';
};

/**
 * حفظ مفتاح Groq API في لوحة الإدارة
 */
export const setGroqApiKey = (key: string): void => {
  try {
    localStorage.setItem('groq_api_key', key.trim());
    if (key.trim()) {
      checkGroqKeyHealth(key.trim());
    } else {
      setGroqKeyHealth('missing');
    }
  } catch (e) {}
};

export type GroqKeyHealth = 'active' | 'quota_exhausted' | 'invalid' | 'missing' | 'checking';

/**
 * جلب حالة صحة ونشاط مفتاح Groq المخزنة
 */
export const getGroqKeyHealth = (): GroqKeyHealth => {
  try {
    const key = getGroqApiKey();
    if (!key) return 'missing';
    const status = localStorage.getItem('groq_key_health') as GroqKeyHealth;
    if (status) return status;
  } catch (e) {}
  return 'missing';
};

/**
 * حفظ وتحديث حالة صحة مفتاح Groq وبث تنبيه فوري لواجهة التطبيق
 */
export const setGroqKeyHealth = (status: GroqKeyHealth): void => {
  try {
    localStorage.setItem('groq_key_health', status);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('groq_key_health_changed', { detail: status }));
    }
  } catch (e) {}
};

/**
 * فحص فوري لصلاحية مفتاح Groq عبر استعلام النماذج المتاحة
 */
export const checkGroqKeyHealth = async (key?: string): Promise<GroqKeyHealth> => {
  const currentKey = key || getGroqApiKey();
  if (!currentKey || !currentKey.trim()) {
    setGroqKeyHealth('missing');
    return 'missing';
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${currentKey.trim()}`
      }
    });
    if (res.ok) {
      setGroqKeyHealth('active');
      return 'active';
    }
    const data = await res.json().catch(() => ({}));
    const errMsg = data.error?.message || '';
    if (res.status === 429 || errMsg.toLowerCase().includes('rate') || errMsg.toLowerCase().includes('quota')) {
      setGroqKeyHealth('quota_exhausted');
      return 'quota_exhausted';
    }
    setGroqKeyHealth('invalid');
    return 'invalid';
  } catch (e) {
    return getGroqKeyHealth();
  }
};

/**
 * تحليل واستخراج كائن الـ JSON بأمان تام من ردود نماذج الذكاء الاصطناعي (Gemini / Groq)
 * حتى لو كانت مغلفة بـ ```json أو مسبوقة/متبوعة بنصوص إضافية
 */
export const parseAiJsonResponse = <T = any>(rawText: string): T => {
  if (!rawText) throw new Error("Empty AI response text");
  let clean = rawText.trim();
  // إزالة وسوم markdown code block في البداية والنهاية
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    // محاولة استخراج كائن الـ JSON المحصور بين أول { وآخر }
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const extracted = clean.slice(firstBrace, lastBrace + 1);
      return JSON.parse(extracted);
    }
    throw err;
  }
};

/**
 * استدعاء نماذج Groq الفائقة (Llama 3.3 70B Versatile كأولوية قصوى لضمان أعلى دقة تصحيح)
 */
export const callGroqChatCompletions = async (
  prompt: string,
  systemPrompt: string = "أنت مصحح امتحانات خبير في التاريخ والجغرافيا باللغة العربية للثانوية العامة المصرية. أجب بصيغة JSON فقط."
): Promise<string> => {
  const groqKey = getGroqApiKey();
  if (!groqKey) throw new Error("Groq API key is missing");

  const candidateModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768'
  ];

  let rawText = '';
  let lastErr: any = null;

  for (const model of candidateModels) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          rawText = content;
          setGroqKeyHealth('active');
          break;
        }
      } else {
        if (res.status === 429) {
          setGroqKeyHealth('quota_exhausted');
          lastErr = new Error("Groq quota/rate limit exceeded (429)");
          break;
        } else if (res.status === 401 || res.status === 403) {
          setGroqKeyHealth('invalid');
          lastErr = new Error(`Groq key invalid (${res.status})`);
          break;
        }
        lastErr = new Error(`Groq model ${model} returned ${res.status}`);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!rawText) throw lastErr || new Error("Failed to get response from Groq");
  return rawText;
};

/**
 * تطبيع الحروف العربية وتوحيد الهمزات والتاء المربوطة والألف المقصورة وإزالة التشكيل
 */
export const normalizeArabic = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة التشكيل
    .replace(/[أإآٱ]/g, 'ا') // توحيد الألف
    .replace(/ة/g, 'ه') // توحيد التاء المربوطة
    .replace(/ى/g, 'ي') // توحيد الألف المقصورة
    .replace(/[ـ]/g, '') // إزالة التطويل (الكشيدة)
    .replace(/[^\u0621-\u064A0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

/**
 * فحص هل الإجابة فارغة أو بسبب انتهاء الوقت
 */
export const isBlankOrTimeoutAnswer = (text: string): boolean => {
  if (!text) return true;
  const clean = text.trim();
  if (clean.length < 3) return true;
  if (/^(لم\s*يتم\s*الإجابة|لم\s*يكتب\s*إجابة|لم\s*يجب|انتهى\s*الوقت|لم\s*يكتب\s*الطالب|لا\s*يوجد\s*إجابة|لا\s*أعلم|لا\s*اعلم|مش\s*عارف|معرفش|لا\s*أدري|لا\s*ادري)/i.test(clean)) return true;
  if (
    clean.includes('لم يتم الإجابة') || 
    clean.includes('انتهى الوقت') || 
    clean.includes('لم يكتب الطالب') || 
    clean.includes('لم يتم الاجابة') ||
    clean === 'لا اعلم' || clean === 'لا أعلم' ||
    clean === 'مش عارف' || clean === 'معرفش' ||
    clean === 'لا ادري' || clean === 'لا أدري'
  ) return true;
  return false;
};

/**
 * استخراج الكلمات المفتاحية الدلالية مع تجريد السوابق الشائعة (الـ، و، فـ، بـ، لـ)
 */
export const extractMeaningfulTokens = (text: string): string[] => {
  const norm = normalizeArabic(text);
  const stopWords = new Set([
    'في', 'من', 'الي', 'علي', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'كان', 'كانت', 
    'ان', 'قد', 'بين', 'حيث', 'هو', 'هي', 'ذلك', 'تلك', 'كل', 'ما', 'لا', 
    'لم', 'لن', 'قام', 'بها', 'به', 'ضد', 'اليها', 'عليهم', 'له', 'لها', 'التي', 'الذي'
  ]);
  
  return Array.from(
    new Set(
      norm
        .split(/\s+/)
        .map(w => {
          let stem = w;
          if (stem.startsWith('ال') && stem.length > 4) stem = stem.slice(2);
          if ((stem.startsWith('و') || stem.startsWith('ف') || stem.startsWith('ب') || stem.startsWith('ل')) && stem.length > 4) {
            stem = stem.slice(1);
            if (stem.startsWith('ال') && stem.length > 4) stem = stem.slice(2);
          }
          return stem;
        })
        .filter(w => w.length >= 3 && !stopWords.has(w))
    )
  );
};

/**
 * قاموس المرادفات والمفاهيم التاريخية والتعليمية الموسع (Comprehensive Historical & Educational Semantic Groups)
 * يضمن التعرف على إجابة الطالب وفهم مقصده حتى لو عبّر بألفاظ أو مرادفات مختلفة
 */
export const HISTORICAL_SYNONYM_GROUPS: string[][] = [
  // العنف والقمع والبطش العسكري
  ['عنف', 'شده', 'قمع', 'قوه', 'بطش', 'مفرطه', 'عسكريه', 'قسوه', 'ارهاب', 'ترهيب', 'سحق', 'اعدام', 'شنق', 'محاكمات', 'نفي', 'اعتقال', 'سجن', 'ضرب'],
  // الضرائب والجبايات والأعباء المالية
  ['ضرائب', 'اموال', 'جبايات', 'مكوس', 'اتاوات', 'رسوم', 'غرامه', 'غرامات', 'اعباء', 'ماليه', 'فرض', 'تحصيل', 'جبايه'],
  // الثورات والانتفاضات والمقاومة
  ['ثوره', 'ثورتي', 'انتفاضه', 'تمرد', 'عصيان', 'مقاومه', 'كفاح', 'جهاد', 'صدام', 'مواجهه', 'حرب', 'معركه', 'رفض'],
  // نابليون والمنشور والوعود
  ['نابليون', 'بونابرت', 'منشور', 'وعود', 'اسلام', 'مساواه', 'تساوي', 'مجامله', 'دهاء', 'استماله', 'مخادعه'],
  // الخداع والميكيافيلية والازدواجية
  ['خداع', 'سياسي', 'تطابق', 'ميكيافيلي', 'مبادئ', 'اخلاق', 'نفاق', 'ازدواجيه', 'تناقض', 'مراوغه', 'كذب', 'ادعاء', 'تنافي'],
  // التعليم والوعي والهوية
  ['تعليم', 'وعي', 'هويه', 'دانلوب', 'موظفين', 'انفاق', 'مقاومه', 'مواطنين', 'مدارس', 'جامعه', 'ازهر', 'صحافه', 'جرائد', 'ثقافه', 'فكر'],
  // الحكم والسيادة والإدارة
  ['حكم', 'سلطه', 'سيطره', 'نفوذ', 'سياده', 'اداره', 'ولايه', 'خديوي', 'سلطان', 'والي', 'حاكم', 'مجلس', 'دستور', 'برلمان', 'فرمان', 'شورى'],
  // الاحتلال والاستعمار والتدخل
  ['احتلال', 'استعمار', 'تدخل', 'حمايه', 'وصايه', 'انتداب', 'امتيازات', 'نفوذ', 'اجنبي', 'بريطاني', 'فرنسي', 'عثماني', 'انجليز'],
  // الاقتصاد والاحتكار والزراعة والتجارة
  ['احتكار', 'زراعه', 'صناعه', 'تجاره', 'محاصيل', 'قطن', 'ري', 'جسور', 'ترع', 'مصانع', 'اسواق', 'استثمار', 'بنوك', 'ديون', 'قروض'],
  // الاتفاقيات والمعاهدات والتسويات
  ['معاهده', 'اتفاقيه', 'صلح', 'تسويف', 'تسوبه', 'شروط', 'بنود', 'ميثاق', 'تحالف', 'وفاق', 'هدنه'],
  // مفاهيم الجغرافيا السياسية ومقومات الدولة
  ['دوله', 'امه', 'جيوبوليتيك', 'جغرافيا سياسيه', 'سياده', 'حدود سياسيه', 'نظام عالمي جديد', 'عولمه'],
  // المقومات الطبيعية والبشرية والممرات المائية (الجغرافيا)
  ['موقع فلكي', 'موقع جغرافي', 'موقع بحري', 'دوله حبيسه', 'مضيق', 'ممرات ملاحيه', 'قناه السويس', 'باب المندب', 'هرمز', 'جبل طارق', 'تضاريس', 'مناخ', 'حجم سكاني'],
  // التكتلات الاقتصادية والأحلاف العسكرية
  ['تكتل اقتصادي', 'كوميسا', 'اتحاد اوروبي', 'حلف عسكري', 'ناتو', 'مجلس التعاون', 'وارسو', 'امم متحده', 'مجلس الامن', 'محكمه العدل']
];

/**
 * مطابقة دلالية ذكية للكلمة مع الكلمات المستهدفة والترادف التاريخي
 */
export const matchTokenWithSynonyms = (token: string, targetTokens: string[], targetText: string): boolean => {
  const normToken = normalizeArabic(token);
  if (!normToken || normToken.length < 2) return false;
  if (targetTokens.includes(normToken) || targetText.includes(normToken)) return true;

  // فحص الجذور والبادئات
  if (normToken.length >= 3) {
    if (targetTokens.some(t => t.startsWith(normToken) || normToken.startsWith(t))) return true;
  }

  // فحص مجموعات الترادف الدلالي
  for (const group of HISTORICAL_SYNONYM_GROUPS) {
    if (group.some(g => normToken.startsWith(g) || g.startsWith(normToken))) {
      if (group.some(g => targetTokens.some(t => t.startsWith(g) || g.startsWith(t)) || targetText.includes(g))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * تصنيف ذكي للمفاتيح التاريخية (شخصية، ثورة، حدث ومؤسسة، موقف وفكر، مقاومة، ظاهرة، تاريخ)
 */
export const categorizeHistoricalKey = (clause: string): { category: string; icon: string; title: string } => {
  const norm = normalizeArabic(clause);
  
  if (/طهطاوي|افغاني|محمد عبده|عرابي|مصطفى كامل|محمد فريد|سعد زغلول|علي مبارك|نابليون|كليبر|مينو|محمد علي|اسماعيل|توفيق|كرومر|جورست|دوفيرين|عمر مكرم|جون لوك/i.test(norm)) {
    let name = 'شخصية تاريخية';
    if (/طهطاوي/i.test(norm)) name = 'رفاعة الطهطاوي';
    else if (/افغاني/i.test(norm)) name = 'جمال الدين الأفغاني';
    else if (/محمد عبده/i.test(norm)) name = 'الشيخ محمد عبده';
    else if (/عرابي/i.test(norm)) name = 'أحمد عرابي';
    else if (/مصطفى كامل/i.test(norm)) name = 'مصطفى كامل';
    else if (/محمد فريد/i.test(norm)) name = 'محمد فريد';
    else if (/سعد زغلول/i.test(norm)) name = 'سعد زغلول';
    else if (/نابليون/i.test(norm)) name = 'نابليون بونابرت';
    else if (/محمد علي/i.test(norm)) name = 'محمد علي باشا';
    else if (/كرومر/i.test(norm)) name = 'اللورد كرومر';
    else if (/جون لوك/i.test(norm)) name = 'جون لوك';
    return { category: 'شخصية', icon: '👤', title: name };
  }

  if (/ثوره|ثورتي|انتفاضه|تمرد|عصيان/i.test(norm)) {
    return { category: 'ثورة', icon: '⚔️', title: 'ثورة وانتفاضة' };
  }

  if (/مقاومه|كفاح|جهاد|موقف نضالي/i.test(norm)) {
    return { category: 'مقاومة', icon: '🛡️', title: 'مقاومة وكفاح' };
  }

  if (/معركه|حادثه|مدرسه|جريده|صحيفه|جامعه|صندوق الدين|لجنه التحقيق|الالسن|العروه الوثقى/i.test(norm)) {
    let sub = 'حدث ومؤسسة';
    if (/الالسن/i.test(norm)) sub = 'مدرسة الألسن';
    else if (/العروه/i.test(norm)) sub = 'جريدة العروة الوثقى';
    else if (/دنشواي/i.test(norm)) sub = 'حادثة دنشواي';
    return { category: 'حدث ومؤسسة', icon: '🏛️', title: sub };
  }

  if (/موقع بحري|دوله حبيسه|موقع فلكي|مضيق|قناه السويس|باب المندب|هرمز|جبل طارق|سبته|مليليه|كشمير/i.test(norm)) {
    let sub = 'موقع وممر جغرافي';
    if (/قناه السويس/i.test(norm)) sub = 'قناة السويس';
    else if (/باب المندب/i.test(norm)) sub = 'مضيق باب المندب';
    else if (/هرمز/i.test(norm)) sub = 'مضيق هرمز';
    else if (/جبل طارق/i.test(norm)) sub = 'مضيق جبل طارق';
    return { category: 'موقع وممر استراتيجي', icon: '🌍', title: sub };
  }

  if (/تكتل|كوميسا|اتحاد اوروبي|حلف|ناتو|وارسو|مجلس التعاون/i.test(norm)) {
    return { category: 'تكتل وحلف سياسي', icon: '🤝', title: 'تكتل اقتصادي أو حلف عسكري' };
  }

  if (/موقف|راي|اتجاه|دلاله|فكر|تحرير العقل|تجديد|تحديث|هويه|اصلاح|الجامعه الاسلاميه/i.test(norm)) {
    let sub = 'موقف ودلالة فكرية';
    if (/الجامعه الاسلاميه/i.test(norm)) sub = 'فكرة الجامعة الإسلامية';
    else if (/تحرير العقل/i.test(norm)) sub = 'تحرير العقل من الجمود';
    else if (/تجديد/i.test(norm)) sub = 'تجديد الفكر الديني';
    else if (/تحديث|هويه/i.test(norm)) sub = 'التحديث مع الحفاظ على الهوية';
    return { category: 'موقف وفكر', icon: '💡', title: sub };
  }

  if (/استعمار|احتكار|تبعيه|امتيازات|حمايه|انتداب/i.test(norm)) {
    return { category: 'ظاهرة تاريخية', icon: '🌐', title: 'ظاهرة تاريخية وسياسة' };
  }

  if (/\b(17\d\d|18\d\d|19\d\d|20\d\d)\b/.test(norm)) {
    return { category: 'تاريخ وزمن', icon: '📅', title: 'تاريخ وحقبة زمنية' };
  }

  return { category: 'محور إجابة', icon: '🎯', title: 'محور رئيسي' };
};

/**
 * محرك التقييم الذكي الاحتياطي (Semantic Heuristic Matcher)
 * يعمل تلقائياً وبدقة تامة مع دعم التطبيع العربي وتصحيح النقاط الجزئية
 */
const evaluateHeuristically = (
  studentAnswer: string,
  modelAnswer: string,
  concept: string = '',
  maxScore: number,
  essayTypeLabel: string,
  dialectPolicy: DialectPolicy = 'encouraging'
): EvaluationResult => {
  const cleanStudent = (studentAnswer || '').trim();
  
  // 1. إذا كانت الإجابة فارغة أو بسبب انتهاء الوقت: 0 فوراً دون أي زيادة
  if (isBlankOrTimeoutAnswer(cleanStudent)) {
    return {
      score: 0,
      maxScore,
      percentage: 0,
      feedback: 'لم يتم الإجابة على السؤال (انتهى وقت الاختبار أو لم يكتب إجابة).',
      strengths: 'لا توجد إجابة مسجلة',
      improvements: 'يرجى تدريب نفسك على سرعة الإجابة ومراعاة الوقت المحدد للاختبار.',
      provider: 'heuristic',
    };
  }

  const studentTokens = extractMeaningfulTokens(cleanStudent);
  const normStudent = normalizeArabic(cleanStudent);

  // تقسيم نموذج الإجابة إلى بنود وفق الترقيم أو الفواصل أو الأسطر
  const rawModelClauses = modelAnswer
    .split(/\n|(?=\b\d+[-.)])|(?=\b- )|\.\s+/)
    .map(c => c.trim())
    .filter(c => c.length > 6);
  const modelClauses = rawModelClauses.length > 0 ? rawModelClauses : [modelAnswer];

  const allModelTokens = extractMeaningfulTokens(`${modelAnswer} ${concept}`);

  // فحص عدد بنود النموذج التي غطاها الطالب (Clause Coverage)
  let coveredClausesCount = 0;
  modelClauses.forEach(clause => {
    const clauseTokens = extractMeaningfulTokens(clause);
    const clauseNorm = normalizeArabic(clause);
    const hasMatch = studentTokens.some(st => matchTokenWithSynonyms(st, clauseTokens, clauseNorm));
    if (hasMatch) {
      coveredClausesCount++;
    }
  });

  const clauseCoverageRatio = modelClauses.length > 0 ? (coveredClausesCount / modelClauses.length) : 0;

  // فحص نسبة الكلمات التاريخية الصحيحة التي كتبها الطالب (Student Relevance)
  let studentMatchCount = 0;
  studentTokens.forEach(st => {
    if (matchTokenWithSynonyms(st, allModelTokens, normalizeArabic(modelAnswer))) {
      studentMatchCount++;
    }
  });

  const studentMatchRatio = studentTokens.length > 0 ? (studentMatchCount / studentTokens.length) : 0;

  // إذا لم يذكر الطالب أي مفهوم تاريخي صحيح من السؤال إطلاقاً
  if (studentMatchCount === 0 && coveredClausesCount === 0) {
    return {
      score: 0,
      maxScore,
      percentage: 0,
      feedback: 'الإجابة غير مرتبطة بالسؤال أو لم تتضمن أي شواهد أو مفاهيم تاريخية صحيحة.',
      strengths: 'محاولة في الكتابة',
      improvements: 'يرجى مراجعة الدرس ونموذج الإجابة لربط الإجابة بالمفهوم المطلوب.',
      provider: 'heuristic',
    };
  }

  // حساب النسبة العادلة: دمج نسبة تغطية البنود مع دقة ما كتبه الطالب
  let fairRatio = (clauseCoverageRatio * 0.6) + (studentMatchRatio * 0.4);

  // فحص الروابط المنطقية
  if (/دلل|أيد|استدل/i.test(essayTypeLabel)) {
    if (/(شواهد|دليل|حيث|قام|ظهر|ثورة|ثورتي)/i.test(normStudent)) fairRatio = Math.min(1, fairRatio + 0.1);
  } else if (/بم\s*تفسر|علل/i.test(essayTypeLabel)) {
    if (/(لان|بسبب|نظرا|حيث|يرجع)/i.test(normStudent)) fairRatio = Math.min(1, fairRatio + 0.1);
  }

  // فحص اللهجة العامية وفقاً للسياسة المختارة
  const hasEgyptianColloquial = /(عشان|علشان|كده|كدة|عايز|خلوا|وقعوا|بقى|بقينا|عملوا|جابوا|خدوا)/i.test(cleanStudent);
  let dialectPenalty = 0;
  if (hasEgyptianColloquial && dialectPolicy === 'strict') {
    dialectPenalty = 0.5;
  }

  // حساب الدرجة النهائية بنظام النسبة والتناسب لأقرب ربع درجة (0.25 و 0.5 و 0.75)
  let calculatedScore = Math.round(fairRatio * maxScore * 4) / 4;
  if (studentMatchCount >= 2 && calculatedScore < 0.25) {
    calculatedScore = 0.25; // مكافأة الطالب بربع درجة كحد أدنى عند ذكر مفاهيم تاريخية صحيحة
  }

  if (dialectPenalty > 0) {
    calculatedScore = Math.max(0, calculatedScore - dialectPenalty);
  }
  calculatedScore = Math.max(0, Math.min(maxScore, calculatedScore));

  const perc = Math.round((calculatedScore / maxScore) * 100);

  let feedback = '';
  let strengths = '';
  let improvements = '';

  if (perc >= 85) {
    feedback = 'إجابة ممتازة وشاملة! أحاطت بجميع الجوانب المطلوبة والشواهد التاريخية بدقة متناهية.';
    strengths = 'فهم دقيق للموضوع واستشهاد سليم بالشواهد والمصطلحات التاريخية.';
    improvements = hasEgyptianColloquial && dialectPolicy === 'strict'
      ? 'تم خصم نصف درجة لاستخدام العامية، يرجى الالتزام بالفصحى.'
      : 'استمر على هذا الأداء الرائع.';
  } else if (perc >= 60) {
    feedback = 'إجابة جيدة جداً، تضمنت شواهد ومفاهيم تاريخية صحيحة ترتبط بجوهر السؤال.';
    strengths = 'ذكر شواهد تاريخية دقيقة وحقائق سليمة من المنهج.';
    improvements = hasEgyptianColloquial
      ? 'فهمك ممتاز، ولكن يُفضل استخدام الصياغة الفصحى لضمان الدرجة النهائية في الثانوية العامة.'
      : 'يمكن تدعيم الإجابة بباقي عناصر التحليل الموضحة في نموذج الإجابة لاكتمال الدرجة النهائية.';
  } else if (perc >= 40) {
    feedback = 'إجابة مقبولة تضمنت بعض الشواهد التاريخية الصحيحة ولكنها تحتاج لربطها بتحليل أعمق.';
    strengths = 'إدراك جزء من الشواهد والمفاهيم التاريخية.';
    improvements = 'ينقص الإجابة استكمال باقي عناصر نموذج الإجابة وتوضيح الأسباب والنتائج.';
  } else {
    feedback = 'إجابة غير مكتملة، تضمنت إشارة جزئية وتحتاج إلى مزيد من الشواهد والتحليل التاريخي.';
    strengths = 'محاولة طيبة في الكتابة.';
    improvements = 'يُرجى قراءة فقرة الدرس ومقارنتها بنموذج الإجابة لاستيفاء عناصر السؤال.';
  }

  return {
    score: calculatedScore,
    maxScore,
    percentage: perc,
    feedback,
    strengths,
    improvements,
    provider: 'heuristic',
  };
};

/**
 * تقييم السؤال المقالي عبر الذكاء الاصطناعي (Gemini) أو المحرك المحلي الذكي
 */
export const evaluateEssayAnswer = async (
  question: Question,
  studentAnswer: string,
  maxScore: number,
  dialectPolicy: DialectPolicy = 'encouraging'
): Promise<EvaluationResult> => {
  const cleanStudent = (studentAnswer || '').trim();
  if (isBlankOrTimeoutAnswer(cleanStudent)) {
    return {
      score: 0,
      maxScore,
      percentage: 0,
      feedback: 'لم يتم الإجابة على السؤال (انتهى وقت الاختبار أو لم يكتب إجابة).',
      strengths: 'لا توجد إجابة مسجلة',
      improvements: 'يرجى تدريب نفسك على سرعة الإجابة ومراعاة الوقت المحدد للاختبار.',
      provider: 'heuristic',
    };
  }

  const modelAnswer = question.answer || question.reason || '';
  const detectedType = question.essayType || detectEssayType(question.q).label;
  const apiKey = getGeminiApiKey();

  // فحص أولي بالمحلل المحلي
  const preEval = evaluateHeuristically(cleanStudent, modelAnswer, question.concept, maxScore, detectedType, dialectPolicy);

  // 🛡️ ترشيد الكوتا الذكي:
  // إذا كانت إجابة الطالب متطابقة ومستوفية لجميع عناصر نموذج الإجابة بنسبة كاملة
  // نوفر كوتا السيرفر فوراً ونمنحه الدرجة النهائية دون استهلاك أي طلبات API
  if (preEval.score >= maxScore && preEval.percentage >= 85) {
    return {
      ...preEval,
      feedback: preEval.feedback + ' (إجابة نموذجية دقيقة مستوفية لجميع عناصر السؤال 🌟)',
      provider: 'heuristic',
    };
  }

  // إعداد نص التعليمات وسياسة التعامل مع العامية
  let dialectInstruction = '';
  if (dialectPolicy === 'strict') {
    dialectInstruction = `
- سياسة التعامل مع العامية: صارمة ومحاكاة لامتحانات الثانوية العامة الرسمية.
إذا كتب الطالب إجابته بالعامية المصرية (مثل: "عشان"، "وقعوا"، "خلوا"، "علشان")، اخصم 0.5 درجة من درجته المستحقة للصياغة اللغوية، واذكر له في التحسين بوضوح: "تم خصم نصف درجة لاستخدام اللهجة العامية، امتحانات الثانوية تشترط الصياغة بالفصحى والمصطلحات المقررة".`;
  } else if (dialectPolicy === 'balanced') {
    dialectInstruction = `
- سياسة التعامل مع العامية: متوازنة.
اقبل العامية إذا كانت المفاهيم التاريخية واضحة ودقيقة، ولا تخصم إلا إذا أخلت العامية بمعنى السؤال أو غاب المصطلح العلمي الأساسي.`;
  } else {
    dialectInstruction = `
- سياسة التعامل مع العامية: مرنة وتشجيعية تركز على الفهم والمضمون.
إذا عبر الطالب بالعامية المصرية ولكن المضمون والمفاهيم التاريخية صحيحة، قيّم فهمه وامنحه الدرجة المستحقة كاملة دون خصم، واكتب له في التوجيه نصيحة تشجيعية بالتحول للصياغة بالفصحى لضمان الدرجة النهائية في الثانوية العامة.`;
  }

  const prompt = `
أنت معلم تاريخ ومصحح امتحانات خبير. مهمتك تقييم إجابة الطالب على السؤال المقالي التالي بموضوعية وعدالة تامة:

[نوع السؤال]: ${detectedType}
[نص السؤال]: ${question.q}
[المفهوم المرتبط]: ${question.concept || 'عام'}
[نموذج الإجابة المعتمد]: ${modelAnswer}
[الدرجة القصوى للسؤال]: ${maxScore} درجة

[إجابة الطالب]:
"${cleanStudent}"

ضوابط التقييم الحاسمة:
1. إذا كانت إجابة الطالب فارغة أو غير مرتبطة بالسؤال إطلاقاً أو كلاماً عشوائياً، امنح درجة 0 فوراً دون تردد.
2. ضابط العدالة والدرجات الجزئية (مهم جداً): إذا ذكر الطالب شواهد تاريخية صحيحة أو أفكاراً تطابق جزءاً من نموذج الإجابة (مثل: ذكر ثورة القاهرة الأولى أو الثانية، أو أسلوب العنف والشدة والقمع، أو فرض الضرائب)، فامنحه الدرجة الجزئية المستحقة فوراً (من 1 إلى 1.5 من 2) ولا تحرمه من الدرجة لمجرد نقص باقي عناصر التحليل أو وجود أخطاء إملائية/لغوية خفيفة.
3. قيّم مدى صحة ودقة إجابة الطالب بالمقارنة بنموذج الإجابة وطبيعة السؤال (${detectedType}).
4. ${dialectInstruction}
5. احتساب الدرجة بالنسبة والتناسب: حدد درجة عادلة ومستحقة بين 0 و ${maxScore} بنظام النسبة والتناسب الدقيقة لما كتبه الطالب (يُسمح بأرباع وأنصاف الدرجات بدقة مثل: 0.25، 0.5، 0.75، 1، 1.25، 1.5، 1.75، 2).
6. اكتب ملاحظة تربوية مشجعة للطالب توضح ما أصاب فيه ونقاط التحسين.

أجب بصيغة JSON حصراً بهذا الشكل ودون أي نصوص إضافية:
{
  "score": 0,
  "feedback": "نص التقييم والملاحظات للطالب",
  "strengths": "نقاط القوة في الإجابة",
  "improvements": "نقاط التحسين المطلوبة"
}
`;

  // 1. المحاولة الأولى: Google Gemini AI
  if (apiKey && getGeminiKeyHealth() !== 'quota_exhausted' && getGeminiKeyHealth() !== 'invalid') {
    try {
      const candidateModels = [
        'gemini-1.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash-8b',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest'
      ];
      let rawText = '';

      for (const model of candidateModels) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.2,
                  responseMimeType: "application/json"
                }
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) {
              setGeminiKeyHealth('active');
              break;
            }
          } else {
            if (response.status === 429) {
              setGeminiKeyHealth('quota_exhausted');
              break;
            } else if (response.status === 400 || response.status === 403) {
              setGeminiKeyHealth('invalid');
              break;
            }
          }
        } catch (err) {}
      }

      if (rawText) {
        const parsed = parseAiJsonResponse(rawText);
        const score = Math.max(0, Math.min(maxScore, Number(parsed.score) || 0));
        return {
          score,
          maxScore,
          percentage: Math.round((score / maxScore) * 100),
          feedback: parsed.feedback || 'تم تقييم الإجابة بنجاح بواسطة الذكاء الاصطناعي.',
          strengths: parsed.strengths,
          improvements: parsed.improvements,
          provider: 'gemini',
        };
      }
    } catch (error) {
      console.warn("Gemini evaluation failed, falling back to alternative:", error);
    }
  }

  // 2. المحاولة الثانية: Groq AI (Llama 3.3 70B) كبديل فائق السرعة ومجاني
  const groqKey = getGroqApiKey();
  if (groqKey && getGroqKeyHealth() !== 'quota_exhausted' && getGroqKeyHealth() !== 'invalid') {
    try {
      const rawText = await callGroqChatCompletions(prompt);
      if (rawText) {
        const parsed = parseAiJsonResponse(rawText);
        const score = Math.max(0, Math.min(maxScore, Number(parsed.score) || 0));
        return {
          score,
          maxScore,
          percentage: Math.round((score / maxScore) * 100),
          feedback: parsed.feedback || 'تم تقييم الإجابة بنجاح بواسطة الذكاء الاصطناعي (Groq Llama 3.3).',
          strengths: parsed.strengths,
          improvements: parsed.improvements,
          provider: 'groq',
        };
      }
    } catch (groqErr) {
      console.warn("Groq AI evaluation failed, falling back to local heuristic:", groqErr);
    }
  }

  // 3. المحاولة الثالثة: المحلل الذكي المحلي المدمج (لا يحتاج إنترنت أو مفاتيح)
  return preEval;
};

/**
 * واجهة نتيجة المقارنة وتحليل الفروق بين إجابة الطالب ونموذج الإجابة
 */
export interface EssayDiffComparison {
  matchedPoints: string[];
  missingPoints: string[];
  styleNote: string;
  suggestedScore: number;
  verdictSummary: string;
  studentFeedback: string;
  provider: 'gemini' | 'groq' | 'heuristic';
}

/**
 * مقارنة ذكية دقيقة بين إجابة الطالب ونموذج الإجابة المعتمد (AI Diff & Comparator)
 * لتسهيل مهمة المعلم في مراجعة الإجابات المقالية وتدقيق الدرجات بنقرة واحدة
 */
export const compareStudentWithModelAnswer = async (
  questionText: string,
  modelAnswer: string,
  studentAnswer: string,
  maxScore: number,
  essayType: string = 'سؤال مقالي',
  concept: string = '',
  gender: 'male' | 'female' = 'male'
): Promise<EssayDiffComparison> => {
  const cleanStudent = (studentAnswer || '').trim();
  const isBlank = isBlankOrTimeoutAnswer(cleanStudent);

  if (isBlank) {
    return {
      matchedPoints: [],
      missingPoints: ['لم يقدم الطالب إجابة لهذا السؤال، جميع عناصر نموذج الإجابة مفقودة بالكامل.'],
      styleNote: 'لا توجد إجابة مسجلة للطالب (انتهى الوقت أو تركت فارغة).',
      suggestedScore: 0,
      verdictSummary: `الطالب ترك السؤال فارغاً دون أي محاولة، والدرجة المقترحة: 0 من ${maxScore}.`,
      studentFeedback: 'لم تقم بكتابة إجابة لهذا السؤال، يرجى مذاكرة الدرس وحل تدريباته لاكتساب مهارة الحل المقالي.',
      provider: 'heuristic',
    };
  }

  const apiKey = getGeminiApiKey();

  const prompt = `
أنت مصحح ومراجع امتحانات تاريخ ثانوية عامة خبير. مهمتك إجراء مقارنة تفصيلية وتحليل الفروق (AI Diff Analysis) بين "إجابة الطالب" و"نموذج الإجابة المعتمد" لمساعدة المعلم في اتخاذ القرار العادل بدقة وسرعة:

[نوع السؤال]: ${essayType}
[نص السؤال]: ${questionText}
[المفهوم الرئيسي المرتبط]: ${concept || 'عام'}
[نموذج الإجابة المعتمد]:
${modelAnswer}

[إجابة الطالب]:
"${cleanStudent}"

[الدرجة العظمى]: ${maxScore} درجات

المطلوب بدقة:
1. "matchedPoints": قائمة بالمفاتيح التاريخية المستوفاة مصنفة بالبادئات والأيقونات التالية لمساعدة المعلم:
   - 👤 [شخصية]: اسم الشخصية ودورها المستوفى في الإجابة.
   - ⚔️ [ثورة]: اسم الثورة أو الانتفاضة ودلالتها.
   - 🏛️ [حدث أو مؤسسة]: اسم المعركة، المدرسة، الصحيفة، الحادثة، الهيئة، أو الاتفاقية.
   - 💡 [موقف وفكر]: الموقف الفكري، الإصلاحي، أو السياسي.
   - 🛡️ [مقاومة]: أسلوب الكفاح والنضال ومقاومة الاستعمار.
   - 🌐 [ظاهرة]: سياسة اقتصادية أو استعمارية.
2. "missingPoints": قائمة بالمفاتيح التاريخية الناقصة أو المفقودة مصنفة بنفس البادئات لتوضيح ما أغفله الطالب.
3. "styleNote": تحليل لغة وصياغة الطالب (هل صياغته فصحى أم عامية؟ وهل استخدم المصطلحات التاريخية المطلوبة؟).
4. "suggestedScore": اقتراح درجة عادلة ودقيقة بالأرقام بين 0 و ${maxScore} (يقبل أنصاف وأرباع الدرجات).
5. "verdictSummary": خلاصة توجيهية موجزة ومباشرة للمعلم في سطرين توضح قرارك والسبب.
6. "studentFeedback": عبارة تقييم وتوجيه تربوي رقيقة ومحفزة ومباشرة من المعلم إلى الطالب بصيغة المخاطب (مثال: "ممتاز يا بطل! إجابة نموذجية ومكتملة..." أو "أحسنت، إجابة جيدة ولكن تنقصك النقاط التالية لاكتمال إجابتك...") بحيث تكون مرنة ومخصصة للمقال المكتوب تحديداً وتذكر ما ينقصه بدقة.

أجب بصيغة JSON حصراً بهذا النسق وبدون أي markdown خارج الـ JSON:
{
  "matchedPoints": ["نقطة 1", "نقطة 2"],
  "missingPoints": ["عنصر مفقود 1"],
  "styleNote": "تقييم الصياغة واللهجة",
  "suggestedScore": 1.5,
  "verdictSummary": "خلاصة المراجعة السريعة للمعلم",
  "studentFeedback": "توجيه المعلم المباشر والمخصص للطالب موضحاً التقييم والنواقص بدقة"
}
`;

  // 1. المحاولة الأولى: Google Gemini AI
  if (apiKey && getGeminiKeyHealth() !== 'quota_exhausted' && getGeminiKeyHealth() !== 'invalid') {
    try {
      const candidateModels = [
        'gemini-1.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash-8b',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest'
      ];
      let rawText = '';
      for (const model of candidateModels) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.2,
                  responseMimeType: "application/json"
                }
              }),
            }
          );
          if (response.ok) {
            const data = await response.json();
            rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) {
              setGeminiKeyHealth('active');
              break;
            }
          } else {
            if (response.status === 429) {
              setGeminiKeyHealth('quota_exhausted');
              break;
            } else if (response.status === 400 || response.status === 403) {
              setGeminiKeyHealth('invalid');
              break;
            }
          }
        } catch (e) {}
      }

      if (rawText) {
        const parsed = parseAiJsonResponse(rawText);
        const suggested = Math.max(0, Math.min(maxScore, Number(parsed.suggestedScore) || 0));
        const matched = Array.isArray(parsed.matchedPoints) ? parsed.matchedPoints : [];
        const missing = Array.isArray(parsed.missingPoints) ? parsed.missingPoints : [];

        // إعداد توجيه تربوي مرن ومباشر للطالب مع مراعاة الجنس
        const praiseMsg = gender === 'female'
          ? '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتِ وبارك الله فيكِ! 🌟'
          : '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتَ وبارك الله فيك! 🌟';

        let studentFeedback = parsed.studentFeedback;
        if (!studentFeedback || studentFeedback.includes('يا بطل')) {
          const validMissing = missing
            .filter(p => p && !p.includes('جميع العناصر') && !p.includes('جميع عناصر') && !p.includes('جميع النقاط'))
            .map(p => p.replace(/^لم يشر إلى:\s*"?/, '').replace(/"?$/, '').trim())
            .filter(Boolean);

          if (suggested >= maxScore * 0.9 || validMissing.length === 0) {
            studentFeedback = praiseMsg;
          } else if (suggested >= maxScore * 0.4) {
            const missingListStr = validMissing.slice(0, 2).join('، ');
            studentFeedback = `👍 الإجابة صحيحة وموفقة في مجملها، ولكن ينقصك لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركز عليها لتضمن الدرجة الكاملة! 💡`;
          } else {
            const missingListStr = validMissing.slice(0, 2).join('، ');
            studentFeedback = `⚠️ إجابتك ناقصة وبحاجة لمراجعة؛ حيث أغفلت توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`;
          }
        }

        return {
          matchedPoints: matched,
          missingPoints: missing,
          styleNote: parsed.styleNote || 'تمت المراجعة اللغوية بنجاح.',
          suggestedScore: suggested,
          verdictSummary: parsed.verdictSummary || 'تم تحليل الفروق وتطابق الإجابة بنجاح.',
          studentFeedback,
          provider: 'gemini',
        };
      }
    } catch (e) {
      console.warn("Gemini diff failed, checking Groq AI fallback:", e);
    }
  }

  // 2. المحاولة الثانية: Groq AI (Llama 3.3 70B) كبديل فائق السرعة
  const groqKey = getGroqApiKey();
  if (groqKey && getGroqKeyHealth() !== 'quota_exhausted' && getGroqKeyHealth() !== 'invalid') {
    try {
      const rawText = await callGroqChatCompletions(prompt, "أنت مصحح ومراجع امتحانات تاريخ ثانوية عامة خبير. أجب بصيغة JSON فقط.");
      if (rawText) {
        const parsed = parseAiJsonResponse(rawText);
        const suggested = Math.max(0, Math.min(maxScore, Number(parsed.suggestedScore) || 0));
        const matched = Array.isArray(parsed.matchedPoints) ? parsed.matchedPoints : [];
        const missing = Array.isArray(parsed.missingPoints) ? parsed.missingPoints : [];

        const praiseMsg = gender === 'female'
          ? '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتِ وبارك الله فيكِ! 🌟'
          : '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتَ وبارك الله فيك! 🌟';

        let studentFeedback = parsed.studentFeedback;
        if (!studentFeedback || studentFeedback.includes('يا بطل')) {
          const validMissing = missing
            .filter(p => p && !p.includes('جميع العناصر') && !p.includes('جميع عناصر') && !p.includes('جميع النقاط'))
            .map(p => p.replace(/^لم يشر إلى:\s*"?/, '').replace(/"?$/, '').trim())
            .filter(Boolean);

          if (suggested >= maxScore * 0.9 || validMissing.length === 0) {
            studentFeedback = praiseMsg;
          } else if (suggested >= maxScore * 0.4) {
            const missingListStr = validMissing.slice(0, 2).join('، ');
            studentFeedback = `👍 الإجابة صحيحة وموفقة في مجملها، ولكن ينقصك لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركز عليها لتضمن الدرجة الكاملة! 💡`;
          } else {
            const missingListStr = validMissing.slice(0, 2).join('، ');
            studentFeedback = `⚠️ إجابتك ناقصة وبحاجة لمراجعة؛ حيث أغفلت توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`;
          }
        }

        return {
          matchedPoints: matched,
          missingPoints: missing,
          styleNote: parsed.styleNote || 'تمت المراجعة اللغوية بنجاح بواسطة Groq AI.',
          suggestedScore: suggested,
          verdictSummary: parsed.verdictSummary || 'تم تحليل الفروق وتطابق الإجابة بنجاح بواسطة Groq AI (Llama 3.3).',
          studentFeedback,
          provider: 'groq',
        };
      }
    } catch (groqErr) {
      console.warn("Groq diff failed, falling back to local heuristic comparator:", groqErr);
    }
  }

  // -----------------------------------------------------------------------------------------
  // المحلل الذكي المحلي المدمج المطور (Advanced Semantic Heuristic Comparator)
  // يعمل بالربط الدلالي وتطبيع اللغة وتجريد البادئات والمفاهيم ومجموعات الترادف
  // -----------------------------------------------------------------------------------------

  // 1. استخراج المفاهيم والمحاور الأساسية لنموذج الإجابة
  let rawConcepts: string[] = [];

  // فحص ما إذا كان المعلم قد حدد مفاهيم صريحة مثل: [مفاهيم: ...] أو [عناصر: ...]
  const explicitMatch = modelAnswer.match(/\[(?:مفاهيم|المفاهيم|عناصر|العناصر|محاور|المحاور):\s*([^\]]+)\]/i);
  if (explicitMatch && explicitMatch[1]) {
    rawConcepts = explicitMatch[1].split(/[,،|;\n]/).map(c => c.trim()).filter(Boolean);
  }

  // تقسيم نموذج الإجابة لبنوده وفق الترقيم أو الفواصل أو الأسطر
  if (rawConcepts.length === 0) {
    rawConcepts = modelAnswer
      .split(/\n|(?=\b\d+[-.)])|(?=\b- )|\.\s+/)
      .map(l => l.trim())
      .filter(l => l.length > 5);
  }

  if (rawConcepts.length === 0) {
    rawConcepts = [modelAnswer];
  }

  // دمج المفهوم المرتبط بالسؤال إن وجد
  if (concept && concept.trim() && !rawConcepts.some(c => c.includes(concept.trim()))) {
    rawConcepts.push(concept.trim());
  }

  const normStudent = normalizeArabic(cleanStudent);
  const studentTokens = extractMeaningfulTokens(cleanStudent);

  const matchedPoints: string[] = [];
  const missingPoints: string[] = [];

  const safeExcerpt = (textStr: string, limit = 75): string => {
    const clean = textStr.replace(/\*\*/g, '').replace(/[\*_#\[\]]/g, '').trim();
    if (clean.length <= limit) return clean;
    const cutPos = clean.lastIndexOf(' ', limit);
    return (cutPos > 35 ? clean.slice(0, cutPos) : clean.slice(0, limit)) + '...';
  };

  rawConcepts.forEach(cItem => {
    const cTokens = extractMeaningfulTokens(cItem);
    const cNorm = normalizeArabic(cItem);
    if (cTokens.length === 0) return;

    // فحص مدى استيفاء الطالب للكلمات المفتاحية أو مرادفاتها في هذا المفهوم
    const matchedCount = cTokens.filter(ct => matchTokenWithSynonyms(ct, studentTokens, normStudent)).length;
    const ratio = matchedCount / cTokens.length;

    const excerpt = safeExcerpt(cItem);
    const keyInfo = categorizeHistoricalKey(cItem);
    // يعتبر المفهوم مستوفياً إذا غطى 25% من مفرداته أو مفهومين رئيسيين
    if (ratio >= 0.25 || matchedCount >= 2 || (cTokens.length === 1 && matchedCount === 1)) {
      matchedPoints.push(`${keyInfo.icon} ${keyInfo.category} [${keyInfo.title}]: استوفى فكرة "${excerpt}"`);
    } else {
      missingPoints.push(`${keyInfo.icon} ${keyInfo.category} [${keyInfo.title}]: لم يشر إلى "${excerpt}"`);
    }
  });

  const totalConcepts = Math.max(1, rawConcepts.length);
  const conceptCoverageRatio = matchedPoints.length / totalConcepts;

  // فحص نسبة دقة ما كتبه الطالب من مصطلحات ومفاهيم مرتبطة بنموذج الإجابة
  const allModelTokens = extractMeaningfulTokens(`${modelAnswer} ${concept}`);
  const relevantStudentTokens = studentTokens.filter(st => matchTokenWithSynonyms(st, allModelTokens, normalizeArabic(modelAnswer)));
  const studentRelevanceRatio = studentTokens.length > 0 ? (relevantStudentTokens.length / studentTokens.length) : 0;

  // نسبة الدرجة العادلة بدمج استيفاء المفاهيم مع دقة ما كتبه الطالب
  let fairRatio = (conceptCoverageRatio * 0.7) + (studentRelevanceRatio * 0.3);

  // احتساب بونص منطقي إذا استشهد الطالب بروابط تعليل وبرهان
  const hasEvidence = /(شواهد|دليل|حيث|لان|بسبب|نظرا|ترتب|ادي|نتج|اثر)/i.test(normStudent);
  if (hasEvidence && matchedPoints.length > 0 && fairRatio < 1) {
    fairRatio = Math.min(1, fairRatio + 0.1);
  }

  // إعداد توجيه تربوي مباشر ومرن ومخصص للطالب موضحاً النواقص المستخرجة من إجابته الفعلية
  const validMissing = missingPoints
    .filter(p => p && !p.includes('جميع العناصر') && !p.includes('جميع عناصر') && !p.includes('جميع النقاط'))
    .map(p => p.replace(/^لم يشر إلى:\s*"?/, '').replace(/"?$/, '').trim())
    .filter(Boolean);

  // إذا استوفى الطالب كافة محاور نموذج الإجابة المطلوبة (missingPoints فارغة أو تغطية 100%)
  // تمنح الدرجة الكاملة فوراً دون أي انتقاص بسبب إسهاب الطالب أو طول إجابته
  if (conceptCoverageRatio >= 0.99 || validMissing.length === 0) {
    fairRatio = 1.0;
  }

  // حساب الدرجة المقترحة لأقرب ربع درجة
  let suggestedScore = Math.round(fairRatio * maxScore * 4) / 4;
  if (conceptCoverageRatio >= 0.99 || validMissing.length === 0) {
    suggestedScore = maxScore;
  } else if (matchedPoints.length > 0 && suggestedScore < 0.25) {
    suggestedScore = 0.25;
  }
  suggestedScore = Math.max(0, Math.min(maxScore, suggestedScore));

  const colloquialWords = ['عشان', 'علشان', 'خلوا', 'وقعوا', 'بقى', 'كده', 'ايه', 'معملش', 'مجاش', 'جابوا'];
  const hasColloquial = colloquialWords.some(w => normStudent.includes(normalizeArabic(w)));
  const styleNote = hasColloquial 
    ? 'تضمنت إجابة الطالب تعبيرات عامية، يُفضل توجيهه للاعتماد الكامل على الفصحى في الثانوية العامة.'
    : 'صياغة الطالب واضحة ومقبولة لغوياً وتستخدم مفردات ومصطلحات ملائمة للمنهج.';

  const verdictSummary = conceptCoverageRatio >= 0.75 
    ? `أجاب الطالب على معظم المفاهيم الأساسية لنموذج الإجابة بنجاح واستحق ${suggestedScore} من ${maxScore}.`
    : conceptCoverageRatio >= 0.4
    ? `أورد الطالب بعض المفاهيم الأساسية وأغفل عناصر أخرى، الدرجة المقترحة: ${suggestedScore} من ${maxScore}.`
    : `الإجابة غير مكتملة وتفتقر إلى معظم الشواهد والمفاهيم الواردة بالنموذج (${suggestedScore} من ${maxScore}).`;

  const praiseMsg = gender === 'female'
    ? '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتِ وبارك الله فيكِ! 🌟'
    : '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتَ وبارك الله فيك! 🌟';

  let studentFeedback = '';
  if (conceptCoverageRatio >= 0.85 || suggestedScore >= maxScore * 0.9 || validMissing.length === 0) {
    studentFeedback = praiseMsg;
  } else if (conceptCoverageRatio >= 0.4 || suggestedScore >= maxScore * 0.4) {
    const missingClean = validMissing.slice(0, 2).join('، ');
    studentFeedback = `👍 الإجابة صحيحة وموفقة في مجملها، ولكن ينقصك لاكتمال الدرجة النهائية توضيح: (${missingClean}). ركز عليها لتضمن الدرجة الكاملة! 💡`;
  } else if (matchedPoints.length > 0 || suggestedScore > 0) {
    const missingClean = validMissing.slice(0, 2).join('، ');
    studentFeedback = `⚠️ إجابتك ناقصة وبحاجة لمراجعة؛ حيث أغفلت توضيح: (${missingClean}). يرجى مراجعة نموذج الإجابة جيداً.`;
  } else {
    studentFeedback = '⚠️ إجابتك بعيدة عن المطلوب ولم تستوفِ مفاهيم السؤال، يرجى مراجعة شرح الدرس ونموذج الإجابة بدقة.';
  }

  return {
    matchedPoints: matchedPoints.length > 0 ? matchedPoints : ['لم يتم العثور على تطابق مباشر مع مفاهيم نموذج الإجابة.'],
    missingPoints: missingPoints.length > 0 ? missingPoints : ['أورد الطالب جميع النقاط الأساسية.'],
    styleNote,
    suggestedScore,
    verdictSummary,
    studentFeedback,
    provider: 'heuristic',
  };
};
