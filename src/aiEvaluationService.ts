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
 * سجل الكيانات والشخصيات والأعمال والمكتسبات الدستورية لتاريخ الثانوية العامة
 * يضمن التقييم الصارم والربط بين الشخصية وعملها التاريخي الفعلي والمكتسبات الدستورية
 */
export interface HistoricalRegistryItem {
  id: string;
  name: string;
  category: 'figure' | 'action' | 'outcome' | 'party' | 'date' | 'cause' | 'event';
  icon: string;
  aliases: string[];
  actionKeywords?: string[];
  desc: string;
  gender?: 'male' | 'female';
}

export const HISTORICAL_REGISTRY: HistoricalRegistryItem[] = [
  // --- الرموز والشخصيات الوطنية ---
  {
    id: 'mostafa_kamel',
    name: 'مصطفى كامل',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['مصطفى كامل', 'مصطفي كامل'],
    actionKeywords: ['صحف', 'جريدة اللواء', 'جريده اللواء', 'اللواء', 'الحزب الوطني', 'احزاب', 'نشر الوعي', 'المؤيد', 'العالم الاسلامي', 'فاشودة', 'دنشواي'],
    desc: 'تأسيس الصحف (جريدة اللواء) وإيقاظ الوعي الوطني وتأسيس الحزب الوطني'
  },
  {
    id: 'mohamed_farid',
    name: 'محمد فريد',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['محمد فريد', 'فريد'],
    actionKeywords: ['نقابة عمال', 'نقابه عمال', 'مدارس ليلية', 'مدارس ليليه', 'مدارس شعبية', 'مدارس شعبيه', 'احزاب', 'توسيع قاعدة'],
    desc: 'تأسيس نقابات العمال والمدارس الشعبية الليلية وتوسيع قاعدة الحزب الوطني ونقابات الصنائع'
  },
  {
    id: 'saad_zaghloul',
    name: 'سعد زغلول',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['سعد زغلول', 'سعد'],
    actionKeywords: ['وفد', 'حزب الوفد', 'تعبئة جماهيرية', 'تعبئه جماهيريه', 'توكيلات', 'مؤتمر الصلح', 'ثورة 1919', 'وزارة الشعب', 'ونجت'],
    desc: 'قيادة حزب الوفد والتعبئة الجماهيرية الشاملة في ثورة 1919 وجمع التوكيلات'
  },
  {
    id: 'hoda_shaarawy',
    name: 'هدى شعراوي',
    category: 'figure',
    icon: '👤',
    gender: 'female',
    aliases: ['هدى شعراوي', 'هدي شعراوي', 'شعراوي'],
    actionKeywords: ['لجنة الوفد للسيدات', 'مظاهرات', 'خروج المراة', 'خروج المراه', 'حراك نسائي', 'متاريس'],
    desc: 'قيادة الحركة النسائية ولجنة الوفد المركزية للسيدات في ثورة 1919'
  },
  {
    id: 'safiya_zaghloul',
    name: 'صفية زغلول',
    category: 'figure',
    icon: '👤',
    gender: 'female',
    aliases: ['صفية زغلول', 'صفيه زغلول', 'ام المصريين'],
    actionKeywords: ['ام المصريين', 'مظاهرات', 'حراك نسائي', 'بيت الامة', 'بيت الامه'],
    desc: 'رمز النضال النسائي (أم المصريين) ودعم الحراك الوطني وثورة 1919'
  },
  {
    id: 'tahtawi',
    name: 'رفاعة الطهطاوي',
    category: 'figure',
    icon: '👤',
    aliases: ['طهطاوي', 'رفاعة الطهطاوي', 'رفاعه الطهطاوي'],
    actionKeywords: ['ترجمة', 'السن', 'تنوير', 'باريس', 'بعثة', 'مدارس'],
    desc: 'رائد التنوير والترجمة وتأسيس مدرسة الألسن'
  },
  {
    id: 'afghani',
    name: 'جمال الدين الأفغاني',
    category: 'figure',
    icon: '👤',
    aliases: ['افغاني', 'جمال الدين الافغاني', 'الافغاني'],
    actionKeywords: ['جامعة اسلامية', 'جامعه اسلاميه', 'تجديد', 'مقاومة', 'عروة وثقى'],
    desc: 'الدعوة للجامعة الإسلامية ومقاومة الاستعمار وتجديد الفكر'
  },
  {
    id: 'mohamed_abdo',
    name: 'الشيخ محمد عبده',
    category: 'figure',
    icon: '👤',
    aliases: ['محمد عبده', 'الشيخ عبده', 'محمد عبده'],
    actionKeywords: ['اصلاح', 'ازهر', 'تحرير العقل', 'عروة وثقى', 'تجديد الفكر', 'توفيق'],
    desc: 'تحرير العقل من الجمود وتجديد الفكر الديني والإصلاح التدريجي'
  },
  {
    id: 'arabi',
    name: 'أحمد عرابي',
    category: 'figure',
    icon: '👤',
    aliases: ['عرابي', 'احمد عرابي'],
    actionKeywords: ['مظاهرة عابدين', 'مطالب الجيش', 'ثورة عرابية', 'كفر الدوار', 'التل الكبير'],
    desc: 'قيادة الثورة العرابية والمطالبة بالدستور والحقوق الوطنية'
  },
  {
    id: 'omar_makram',
    name: 'عمر مكرم',
    category: 'figure',
    icon: '👤',
    aliases: ['عمر مكرم'],
    actionKeywords: ['زعامة شعبية', 'اختيار محمد علي', 'مقاومة خورشيد', 'دار المحكمة', 'حملة فريزر'],
    desc: 'قيادة الزعامة الشعبية وفرض الإرادة الوطنية واختيار محمد علي 1805'
  },
  {
    id: 'john_locke',
    name: 'جون لوك',
    category: 'figure',
    icon: '👤',
    aliases: ['جون لوك', 'لوك'],
    actionKeywords: ['فلسفة', 'عقد اجتماعي', 'حقوق طبيعية', 'سيادة القانون', 'حكومة مدنية', 'تسامح'],
    desc: 'نظرية العقد الاجتماعي والحقوق الطبيعية وتقييد سلطة الحاكم'
  },
  // --- الأحزاب والهيئات والمؤسسات ---
  {
    id: 'wafd_party',
    name: 'حزب الوفد',
    category: 'party',
    icon: '🏛️',
    aliases: ['حزب الوفد', 'الوفد'],
    actionKeywords: ['تعبئة جماهيرية', 'سعد زغلول', 'توكيلات', 'كفاح شعبي', 'وزارة الشعب'],
    desc: 'قيادة التعبئة الجماهيرية الشاملة للأمة المصرية في مواجهة الاحتلال'
  },
  {
    id: 'national_party',
    name: 'الحزب الوطني',
    category: 'party',
    icon: '🏛️',
    aliases: ['الحزب الوطني'],
    actionKeywords: ['مصطفى كامل', 'محمد فريد', 'نخبة', 'الصحف'],
    desc: 'مرحلة نضال النخبة وتأسيس الصحف والأحزاب ومواجهة الاحتلال البريطاني'
  },
  // --- الأعمال والأدوات والممارسات التاريخية ---
  {
    id: 'press_and_parties',
    name: 'تأسيس الصحف والأحزاب',
    category: 'action',
    icon: '📰',
    aliases: ['تاسيس الصحف', 'الصحف والاحزاب', 'صحف واحزاب', 'جريدة اللواء', 'جريده اللواء', 'الصحافة', 'اصدار الصحف'],
    actionKeywords: ['صحف', 'احزاب', 'صحافة', 'جرائد', 'اللواء'],
    desc: 'تطور أدوات الحركة الوطنية من تأسيس الصحف والأحزاب في عهد النخبة'
  },
  {
    id: 'mass_mobilization',
    name: 'التعبئة الجماهيرية الشاملة',
    category: 'action',
    icon: '👥',
    aliases: ['تعبئة جماهيرية', 'تعبئه جماهيريه', 'حراك شعبي', 'ثورة شعبية', 'ثوره شعبيه', 'توحدت فئات', 'توحد فئات الشعب', 'مشاركة الشعب بجميع فئاته'],
    actionKeywords: ['شعبية', 'جماهيرية', 'فئات الشعب', 'مسلمين ومسيحيين', 'توحدت'],
    desc: 'الانتقال إلى تعبئة جماهيرية شاملة بقيادة الوفد وتوحد فئات الأمة في ثورة 1919'
  },
  {
    id: 'women_participation',
    name: 'خروج المرأة وإقامة المتاريس',
    category: 'action',
    icon: '🛡️',
    aliases: ['خروج المراة', 'خروج المراه', 'مظاهرات', 'متاريس', 'المتاريس', 'مشاركة المراة', 'مشاركه المراه', 'دور النساء', 'حراك نسائي'],
    actionKeywords: ['متاريس', 'مظاهرات', 'بجانب الرجال', 'دور النساء', 'السيدات'],
    desc: 'مشاركة المرأة المصرية في المظاهرات وإقامة المتاريس بجانب الرجال'
  },
  // --- المكتسبات والدلالات الدستورية والتاريخية ---
  {
    id: 'half_society_energy',
    name: 'تفعيل نصف طاقة المجتمع',
    category: 'outcome',
    icon: '💡',
    aliases: ['نصف طاقة المجتمع', 'نصف طاقه المجتمع', 'طاقة المجتمع', 'طاقه المجتمع'],
    actionKeywords: ['نصف طاقة', 'حراك مجتمعي شامل', 'انتقال الوعي', 'تفعيل'],
    desc: 'خروج المرأة كتفعيل حقيقي لنصف طاقة المجتمع وانتقال الوعي لحراك مجتمعي شامل'
  },
  {
    id: 'constitutional_gains',
    name: 'المكاسب الدستورية (تصريح 28 فبراير ودستور 1923)',
    category: 'outcome',
    icon: '📜',
    aliases: ['تصريح 28 فبراير', '28 فبراير', 'دستور 1923', 'دستور ٢٣', 'دستور'],
    actionKeywords: ['28 فبراير', 'دستور 1923', 'مكاسب', 'انتزاع مكاسب'],
    desc: 'انتزاع مكاسب تاريخية وسياسية كـ تصريح 28 فبراير ودستور 1923'
  }
];

/**
 * تقسيم نموذج الإجابة إلى بنوده ومحاوره الذرية بدقة
 */
export const splitModelAnswerIntoClauses = (modelAnswer: string): string[] => {
  if (!modelAnswer) return [];
  const rawParts = modelAnswer
    .split(/\n+|(?<=[.!?])\s+|(?=\b\d+[-.)])|(?=\b[-•*]\s+)|(?<=[:：])\s*(?=\S)|;\s*|؛\s*/)
    .map(p => p.trim())
    .filter(p => p.length > 5);

  const clauses: string[] = [];
  rawParts.forEach(part => {
    const subParts = part.split(/(?<=[،,])\s*(?=إلى|الي|مما|وساهم|بقيادة|تفعيل|انتزاع|كما|فضلاً|بالإضافة)/i);
    subParts.forEach(sp => {
      const clean = sp.trim().replace(/^[-•*\d.)\s]+/, '').trim();
      if (clean.length > 5) {
        clauses.push(clean);
      }
    });
  });

  return clauses.length > 0 ? clauses : [modelAnswer.trim()];
};

/**
 * فحص استطراد الطالب خارج العصر والقرن المطلوب (Off-topic stuffing)
 */
export const detectOffTopicEras = (
  studentText: string,
  modelAnswer: string
): { isOffTopic: boolean; eraName: string; note: string; penalty: number } => {
  const normStudent = normalizeArabic(studentText);
  const normModel = normalizeArabic(modelAnswer);

  const is20thCenturyQuestion = /1919|مصطفى كامل|محمد فريد|سعد زغلول|الاحتلال البريطاني|القرن العشرين|القرن 20/i.test(normModel);
  if (is20thCenturyQuestion) {
    const mentions18thCenturyMamluks = /مماليك|الشرقاوي|عبدالله الشرقاوي|مراد بك|ابراهيم بك|القرن 18|القرن الثامن عشر|الحمله الفرنسيه/i.test(normStudent);
    if (mentions18thCenturyMamluks) {
      return {
        isOffTopic: true,
        eraName: 'أواخر القرن الـ 18 والمماليك والشيخ عبدالله الشرقاوي',
        note: 'استطردتَ في سرد أحداث من أواخر القرن الـ 18 (المماليك والشيخ عبدالله الشرقاوي) وهي خارج نطاق السؤال تماماً.',
        penalty: 0.25
      };
    }
  }

  return { isOffTopic: false, eraName: '', note: '', penalty: 0 };
};

/**
 * المحرك المركزي الصارم لتقييم مقالي الثانوية العامة (تاريخ وجغرافيا)
 * يطبق ضوابط الوزارة الدقيقة: الاقتران (شخصية + عمل + مكتسب)، وحظر احتساب ما لم يذكره الطالب
 */
export const evaluateHighSchoolEssayEngine = (
  studentText: string,
  modelAnswer: string,
  concept: string = '',
  maxScore: number = 2,
  gender: 'male' | 'female' = 'male',
  dialectPolicy: DialectPolicy = 'encouraging'
) => {
  const cleanStudent = (studentText || '').trim();
  if (isBlankOrTimeoutAnswer(cleanStudent)) {
    return {
      score: 0,
      maxScore,
      percentage: 0,
      matchedPoints: [],
      missingPoints: ['لم تقدم إجابة لهذا السؤال، وعناصر نموذج الإجابة مفقودة بالكامل.'],
      styleNote: 'لا توجد إجابة مسجلة (انتهى الوقت أو تركت فارغة).',
      suggestedScore: 0,
      verdictSummary: `لم يتم تقديم إجابة للسؤال، والدرجة المقترحة: 0 من ${maxScore}.`,
      studentFeedback: 'لم تقم بكتابة إجابة لهذا السؤال، يرجى مذاكرة الدرس جيداً والتدريب على كتابة الإجابات المقالية.',
      feedback: 'لم تقم بكتابة إجابة لهذا السؤال، يرجى مذاكرة الدرس جيداً والتدريب على كتابة الإجابات المقالية.',
      strengths: 'لا توجد إجابة مسجلة',
      improvements: 'احرص على تنظيم وقتك ومحاولة كتابة كل ما تعرفه لضمان الدرجات.',
      provider: 'heuristic' as const,
    };
  }

  const isFemale = gender === 'female';
  const ahsant = isFemale ? 'أحسنتِ' : 'أحسنتَ';
  const wuffiqt = isFemale ? 'وفّقتِ' : 'وفّقتَ';
  const aghfalt = isFemale ? 'أغفلتِ' : 'أغفلتَ';
  const yanqusak = isFemale ? 'ينقصكِ' : 'ينقصكَ';
  const kanYanbaghi = isFemale ? 'كان ينبغي عليكِ' : 'كان ينبغي عليكَ';

  const normStudent = normalizeArabic(cleanStudent);
  const normModel = normalizeArabic(modelAnswer);

  // 1. فحص الاستطراد خارج العصر المطلوب
  const offTopicCheck = detectOffTopicEras(cleanStudent, modelAnswer);

  // 2. استخراج الكيانات التاريخية المرتبطة بنموذج الإجابة
  const modelEntities = HISTORICAL_REGISTRY.filter(item => {
    return item.aliases.some(a => normModel.includes(normalizeArabic(a))) ||
           (item.actionKeywords && item.actionKeywords.some(k => normModel.includes(normalizeArabic(k))));
  });

  const matchedEntities: string[] = [];
  const missingEntities: string[] = [];

  modelEntities.forEach(item => {
    const studentHasAlias = item.aliases.some(a => normStudent.includes(normalizeArabic(a)));
    const studentHasAction = item.actionKeywords && item.actionKeywords.some(k => normStudent.includes(normalizeArabic(k)));
    const figurePronoun = item.gender === 'female' ? 'دورها' : 'دوره';

    if (item.category === 'figure') {
      if (studentHasAlias && studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${ahsant} بذكر الشخصية وتوضيح ${figurePronoun} التاريخي بنجاح 👏.`);
      } else if (studentHasAlias) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${wuffiqt} في الإشارة للشخصية، ولكن دون توضيح تفاصيل عملها.`);
        missingEntities.push(`⚙️ [دور ${item.name}]: ${yanqusak} توضيح ${figurePronoun} وعملها التاريخي في: ${item.desc}.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${aghfalt} عن ذكر الشخصية وبيان ${figurePronoun} في: ${item.desc}.`);
      }
    } else if (item.category === 'cause') {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon || '🎯'} [${item.name}]: ${ahsant} ببيان الأسباب والعوامل التاريخية بنجاح.`);
      } else {
        missingEntities.push(`${item.icon || '🎯'} [${item.name}]: ${aghfalt} عن ذكر وتوضيح الأسباب والدوافع في: ${item.desc}.`);
      }
    } else if (item.category === 'event') {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon || '⚔️'} [${item.name}]: ${ahsant} بالإشارة إلى هذا الحدث التاريخي وسياقه بدقة.`);
      } else {
        missingEntities.push(`${item.icon || '⚔️'} [${item.name}]: ${aghfalt} عن ذكر هذا الحدث وتفاصيل مجرياته في: ${item.desc}.`);
      }
    } else if (item.category === 'action') {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${ahsant} بالإشارة إلى وسيلة الكفاح والعمل التاريخي بنجاح.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${yanqusak} توضيح وسيلة الكفاح والعمل التاريخي: ${item.desc}.`);
      }
    } else if (item.category === 'outcome') {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${wuffiqt} في استنتاج هذه الدلالة أو النتيجة التاريخية.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${aghfalt} عن بيان هذه النتيجة أو المكتسب التاريخي: ${item.desc}.`);
      }
    } else {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${ahsant} بالإشارة إليه وتوضيحه ضمن السياق التاريخي.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${kanYanbaghi} الإشارة إليه وتوضيح دوره في: ${item.desc}.`);
      }
    }
  });

  // 3. تقسيم نموذج الإجابة إلى أجزائه الرئيسية (Main Parts / Questions)
  // لحساب درجة كل جزء بنظام الثانوية العامة (مثلاً: 1 درجة لتطور الحركة، 1 درجة لمشاركة المرأة)
  const mainSections = modelAnswer
    .split(/\n+|(?=تطور أدوات|الانعكاس الجذري|وجه الشبه|وجه الاختلاف|الدروس المستفادة|العلاقة بين|ما تقييمك|النتيجة المترتبة)/i)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  const sectionsToEvaluate = mainSections.length > 1 ? mainSections : [modelAnswer];
  const sectionWeight = maxScore / sectionsToEvaluate.length;

  let totalEarnedScore = 0;

  sectionsToEvaluate.forEach(sectionStr => {
    const normSec = normalizeArabic(sectionStr);
    
    const secEntities = modelEntities.filter(item => {
      return item.aliases.some(a => normSec.includes(normalizeArabic(a))) ||
             (item.actionKeywords && item.actionKeywords.some(k => normSec.includes(normalizeArabic(k))));
    });

    let secMatchedCount = 0;
    const secTotalItems = Math.max(1, secEntities.length);

    secEntities.forEach(item => {
      const studentHasAlias = item.aliases.some(a => normStudent.includes(normalizeArabic(a)));
      const studentHasAction = item.actionKeywords && item.actionKeywords.some(k => normStudent.includes(normalizeArabic(k)));
      
      if (item.category === 'figure') {
        if (studentHasAlias && studentHasAction) secMatchedCount += 1.0;
        else if (studentHasAlias) secMatchedCount += 0.5;
      } else {
        if (studentHasAlias || studentHasAction) secMatchedCount += 1.0;
      }
    });

    const secTokens = normSec.split(' ').filter(w => w.length > 3);
    let secTokenMatches = 0;
    secTokens.forEach(st => {
      if (normStudent.includes(st)) secTokenMatches++;
    });
    const secTokenRatio = secTokens.length > 0 ? (secTokenMatches / secTokens.length) : 0;
    const secItemRatio = secMatchedCount / secTotalItems;
    
    let secRatio = 0;
    if (secItemRatio >= 0.75 && secTokenRatio >= 0.4) {
      secRatio = 1.0; // ممتاز ومكتمل
    } else if (secItemRatio >= 0.4 || secTokenRatio >= 0.25 || secMatchedCount >= 1) {
      secRatio = 0.5; // أورد جانباً أو فكرة عامة (نصف درجة الجزء)
    } else if (secTokenRatio >= 0.12) {
      secRatio = 0.25; // إشارة عابرة
    } else {
      secRatio = 0;
    }

    totalEarnedScore += (secRatio * sectionWeight);
  });

  // خصم الاستطراد خارج العصر المطلوب
  if (offTopicCheck.penalty > 0) {
    totalEarnedScore = Math.max(0.25, totalEarnedScore - offTopicCheck.penalty);
  }

  // فحص اللهجة العامية
  const hasEgyptianColloquial = /(عشان|علشان|كده|كدة|عايز|خلوا|وقعوا|بقى|بقينا|عملوا|جابوا|خدوا)/i.test(cleanStudent);
  if (hasEgyptianColloquial && dialectPolicy === 'strict') {
    totalEarnedScore = Math.max(0.25, totalEarnedScore - 0.5);
  }

  // تقريب لأقرب ربع درجة
  let suggestedScore = Math.round(totalEarnedScore * 4) / 4;
  suggestedScore = Math.max(0, Math.min(maxScore, suggestedScore));

  const perc = Math.round((suggestedScore / maxScore) * 100);

  // إذا كانت الدرجة غير كاملة لكن جميع كيانات السجل التاريخي تم ذكرها:
  // هذا يعني أن إجابة الطالب موجزة وتفتقر إلى التفاصيل والشرح الوارد بنموذج الإجابة
  if (suggestedScore < maxScore * 0.85 && missingEntities.length === 0) {
    const modelClauses = modelAnswer
      .split(/[.\n;،:-]/)
      .map(s => s.trim())
      .filter(s => s.length > 15);

    const unmentioned = modelClauses.filter(clause => {
      const normClause = normalizeArabic(clause);
      const tokens = normClause.split(' ').filter(w => w.length > 3);
      if (tokens.length === 0) return false;
      const matched = tokens.filter(t => normStudent.includes(t));
      return (matched.length / tokens.length) < 0.35;
    });

    if (unmentioned.length > 0) {
      unmentioned.slice(0, 2).forEach(u => {
        missingEntities.push(`💡 [تفاصيل مطلوبة من النموذج]: ${yanqusak} التوسع في توضيح: "${u}".`);
      });
    } else {
      missingEntities.push(`📝 [عمق الشرح والتحليل]: أوردتَ الشخصيات المطلوبة، ولكن إجابتك جاءت موجزة؛ ${yanqusak} الاستفاضة في شرح وتفصيل أعمالها ونتائجها التاريخية لاستحقاق كامل الدرجة.`);
    }
  }

  const missingFigures = missingEntities.filter(m => m.includes('👤') || m.includes('🧕') || m.includes('شخصية'));
  const matchedFigures = matchedEntities.filter(m => m.includes('👤') || m.includes('🧕') || m.includes('شخصية'));
  const missingCauses = missingEntities.filter(m => m.includes('سبب') || m.includes('أسباب') || m.includes('دوافع') || m.includes('عوامل') || m.includes('🎯'));
  const missingResults = missingEntities.filter(m => m.includes('نتيجة') || m.includes('نتائج') || m.includes('أثر') || m.includes('مكتسب') || m.includes('📜') || m.includes('دلالة'));
  const missingEvents = missingEntities.filter(m => m.includes('حدث') || m.includes('أحداث') || m.includes('معركة') || m.includes('ثورة') || m.includes('معاهدة') || m.includes('⚔️'));

  let styleNote = '';
  if (offTopicCheck.note) {
    styleNote = `${offTopicCheck.note} نوصيك بتركيز إجابتك على الفترة الزمنية المطلوبة وتجنب الاستطراد في أحداث خارجة عن السؤال.`;
  } else if (hasEgyptianColloquial) {
    styleNote = 'لاحظتُ استخدام بعض التعبيرات العامية، واحرص دائماً على الاعتماد الكامل على الفصحى لضمان الدرجة النهائية في الثانوية العامة.';
  } else if (suggestedScore >= maxScore * 0.85) {
    styleNote = 'صياغة ممتازة ومنضبطة تاريخياً ولغوياً، والأفكار مترابطة وواضحة.';
  } else if (matchedFigures.length > 0 && missingFigures.length === 0) {
    styleNote = 'صياغة جيدة ومترابطة، ولكن يُفضل التوسع في السرد التحليلي وربط الأدوار بالنتائج لاستحقاق الدرجة النهائية.';
  } else if (missingFigures.length > 0) {
    styleNote = 'صياغتك مقبولة، ولكن ينقص إجابتك الدقة في ذكر الشخصيات القيادية المحددة ودور كل منها.';
  } else {
    styleNote = 'صياغتك مقبولة تاريخياً، ولكن ينقص إجابتك مزيد من التدقيق في التفاصيل والربط المنطقي بين الأحداث.';
  }

  let verdictSummary = '';
  if (suggestedScore >= maxScore * 0.85) {
    verdictSummary = `ما شاء الله! ${ahsant} إجابة نموذجية ومكتملة استوفيتَ فيها كافة المحاور والأحداث والنتائج المطلوبة بدقة (${suggestedScore} من ${maxScore}).`;
  } else if (missingEntities.length === 0 || (matchedFigures.length > 0 && missingFigures.length === 0 && missingCauses.length === 0 && missingResults.length === 0)) {
    verdictSummary = `${ahsant} في استيفاء المحاور والمفاهيم الأساسية، ولكن إجابتك موجزة وينقصها الاستفاضة في الشرح والتحليل التاريخي لنيل الدرجة الكاملة (${suggestedScore} من ${maxScore}).`;
  } else if (missingCauses.length > 0 && missingResults.length > 0) {
    verdictSummary = `${ahsant} في الإلمام ببعض الجوانب، لكنك ${aghfalt} عن استيفاء الأسباب والنتائج التاريخية المحددة بالنموذج (${suggestedScore} من ${maxScore}).`;
  } else if (missingCauses.length > 0) {
    verdictSummary = `${ahsant} في سرد الأحداث، لكنك ${aghfalt} عن توضيح الأسباب والدوافع التاريخية المطلوبة (${suggestedScore} من ${maxScore}).`;
  } else if (missingResults.length > 0) {
    verdictSummary = `${ahsant} في توضيح المقدمات، لكنك ${aghfalt} عن استنتاج النتائج والآثار التاريخية المترتبة عليها (${suggestedScore} من ${maxScore}).`;
  } else if (missingFigures.length > 0 && matchedFigures.length > 0) {
    verdictSummary = `${ahsant} في الإشارة لبعض الشخصيات، لكنك ${aghfalt} عن ذكر شخصيات رئيسية أخرى وتوضيح دورها الوارد بالنموذج (${suggestedScore} من ${maxScore}).`;
  } else if (missingFigures.length > 0 && matchedFigures.length === 0) {
    verdictSummary = `أوردتَ فكرة عامة، لكنك ${aghfalt} عن ذكر الشخصيات التاريخية المحورية وأدوارها المحددة بالنموذج (${suggestedScore} من ${maxScore}).`;
  } else {
    verdictSummary = `${ahsant} في الإلمام ببعض الجوانب، ولكن إجابتك غير مكتملة وتفتقر للحقائق والتفاصيل المحددة بالنموذج (${suggestedScore} من ${maxScore}).`;
  }

  const validMissing = missingEntities
    .map(p => p.replace(/^[^\s]+\s+/, '').replace(/^\[[^\]]+\]:\s*/, ''))
    .filter(Boolean);

  let studentFeedback = '';
  if (suggestedScore >= maxScore * 0.85) {
    studentFeedback = isFemale
      ? '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتِ وبارك الله فيكِ! 🌟'
      : '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتَ وبارك الله فيك! 🌟';
  } else if (matchedFigures.length > 0 && missingFigures.length === 0) {
    studentFeedback = isFemale
      ? `👍 أحسنتِ بذكر الشخصيات والمفاهيم المطلوبة، ولكن ينقصكِ التوسع في الشرح والتحليل التاريخي لتضمني الدرجة الكاملة (${suggestedScore} من ${maxScore}). 💡`
      : `👍 أحسنتَ بذكر الشخصيات والمفاهيم المطلوبة، ولكن ينقصكَ التوسع في الشرح والتحليل التاريخي لتضمن الدرجة الكاملة (${suggestedScore} من ${maxScore}). 💡`;
  } else if (suggestedScore >= maxScore * 0.4) {
    const missingClean = validMissing.slice(0, 2).join('، ');
    studentFeedback = isFemale
      ? `👍 أوردتِ فكرة عامة طيبة، ولكن ينقصكِ لاكتمال الدرجة النهائية توضيح: (${missingClean}). ركّزي جيداً عليها لتضمني الدرجة الكاملة! 💡`
      : `👍 أوردتَ فكرة عامة طيبة، ولكن ينقصكَ لاكتمال الدرجة النهائية توضيح: (${missingClean}). ركّز جيداً عليها لتضمن الدرجة الكاملة! 💡`;
  } else {
    const missingClean = validMissing.slice(0, 2).join('، ');
    studentFeedback = isFemale
      ? `⚠️ إجابتكِ ناقصة وبحاجة لتركيز؛ حيث أغفلتِ عن توضيح: (${missingClean}). يرجى مراجعة نموذج الإجابة جيداً.`
      : `⚠️ إجابتكَ ناقصة وبحاجة لتركيز؛ حيث أغفلتَ عن توضيح: (${missingClean}). يرجى مراجعة نموذج الإجابة جيداً.`;
  }

  return {
    score: suggestedScore,
    maxScore,
    percentage: perc,
    matchedPoints: matchedEntities.length > 0 ? matchedEntities : ['لم توفق بعد في استيفاء مفاهيم نموذج الإجابة الأساسية.'],
    missingPoints: missingEntities.length > 0 
      ? missingEntities 
      : (suggestedScore >= maxScore * 0.85
          ? ['🎉 إجابة شاملة ومكتملة، استوفيتَ جميع العناصر والنقاط المطلوبة في نموذج الإجابة بنجاح.']
          : ['📝 إجابتك موجزة؛ ينقصك التوسع في الشرح والتحليل التاريخي لاستحقاق الدرجة الكاملة.']),
    styleNote,
    suggestedScore,
    verdictSummary,
    studentFeedback,
    feedback: studentFeedback,
    strengths: matchedEntities.length > 0 ? matchedEntities.slice(0, 2).join(' • ') : 'محاولة في الكتابة',
    improvements: missingEntities.length > 0 ? missingEntities.slice(0, 2).join(' • ') : 'استمر على هذا الأداء الرائع',
    provider: 'heuristic' as const,
  };
};

/**
 * دالة التوافق مع تصنيف المفاتيح القديمة
 */
export const categorizeHistoricalKey = (clause: string): { category: string; icon: string; title: string } => {
  const norm = normalizeArabic(clause);
  const found = HISTORICAL_REGISTRY.find(item => item.aliases.some(a => norm.includes(normalizeArabic(a))));
  if (found) {
    return { category: found.category === 'figure' ? 'شخصية' : found.category === 'party' ? 'حزب وهيئة' : found.category === 'cause' ? 'سبب ودافع' : found.category === 'event' ? 'حدث تاريخي' : found.category === 'action' ? 'عمل تاريخي' : 'مكتسب ودلالة', icon: found.icon, title: found.name };
  }
  return { category: 'محور إجابة', icon: '🎯', title: 'محور رئيسي' };
};

/**
 * محرك التقييم الذكي الاحتياطي (Semantic Heuristic Matcher)
 */
const evaluateHeuristically = (
  studentAnswer: string,
  modelAnswer: string,
  concept: string = '',
  maxScore: number,
  essayTypeLabel: string,
  dialectPolicy: DialectPolicy = 'encouraging'
): EvaluationResult => {
  return evaluateHighSchoolEssayEngine(studentAnswer, modelAnswer, concept, maxScore, 'male', dialectPolicy);
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
  // يمنح الدرجة الكاملة فوراً فقط إذا كانت إجابة الطالب مستوفية للشخصيات والأعمال والمكتسبات بنسبة تامة 100% دون أي نواقص
  if (preEval.score >= maxScore && preEval.percentage >= 95 && (!(preEval as any).missingPoints || (preEval as any).missingPoints.length === 0)) {
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
أنت كبير مصححي ومراجعي مادة التاريخ للثانوية العامة المصرية بوزارة التربية والتعليم. مهمتك تقييم إجابة الطالب على السؤال المقالي التالي بموضوعية وعدالة تامة:

[نوع السؤال]: ${detectedType}
[نص السؤال]: ${question.q}
[المفهوم المرتبط]: ${question.concept || 'عام'}
[نموذج الإجابة المعتمد]: ${modelAnswer}
[الدرجة القصوى للسؤال]: ${maxScore} درجة

[إجابة الطالب]:
"${cleanStudent}"

ضوابط التقييم الحاسمة:
1. إذا كانت إجابة الطالب فارغة أو غير مرتبطة بالسؤال إطلاقاً، امنح درجة 0 فوراً.
2. قاعدة الاقتران الإلزامي (الشخصية + العمل + الدلالة): مجرد ذكر الشخصية دون عملها يستحق ربع درجة فقط عنها، ومجرد ذكر ألفاظ عامة ("مقاومة"، "ثورة 1919"، "مظاهرات") دون الشخصيات القيادية والمكتسبات الدستورية يستحق نصف الدرجة كحد أقصى (${(maxScore / 2).toFixed(1)} من ${maxScore}).
3. رصد الحشو والاستطراد غير المرتبط: إذا استطرد الطالب في سرد أحداث من عصور أخرى غير مطلوبة (مثل المماليك في سؤال عن ثورة 1919 والقرن العشرين)، اخصم من درجة التقييم ونبه على ذلك في التحسين.
4. ${dialectInstruction}
5. احتساب الدرجة بالنسبة والتناسب: حدد درجة عادلة ومستحقة بين 0 و ${maxScore} بنظام النسبة والتناسب الدقيقة لما كتبه الطالب (يُسمح بأرباع وأنصاف الدرجات بدقة مثل: 0.25، 0.5، 0.75، 1، 1.25، 1.5، 1.75، 2).
6. اكتب ملاحظة تربوية مشجعة للطالب توضح ما أصاب فيه ونقاط التحسين المحددة.

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
أنت كبير مصححي ومراجعي مادة التاريخ للثانوية العامة المصرية بوزارة التربية والتعليم. 
مهمتك إجراء تقييم تاريخي صارم ودقيق (Strict Evaluation & Diff Analysis) بين "إجابة الطالب" و"نموذج الإجابة المعتمد"، لمساعدة المعلم في رصد الدرجة العادلة بدقة متناهية:

[نوع السؤال]: ${essayType}
[نص السؤال]: ${questionText}
[المفهوم الرئيسي]: ${concept || 'عام'}
[نموذج الإجابة المعتمد]:
${modelAnswer}

[إجابة الطالب الفعلية]:
"${cleanStudent}"

[الدرجة العظمى]: ${maxScore} درجات

⚠️ ضوابط ومعايير التصحيح الصارم لامتحانات الثانوية العامة:
1. قاعدة الاقتران الإلزامي (الشخصية + العمل + الدلالة):
   - لا تمنح درجة كاملة للشخصية إلا إذا ذكر الطالب اسمها الصريح وقرنها بـ [عملها التاريخي الفعلي ودورها المحدد في النموذج].
   - مجرد ذكر اسم الشخصية دون عملها يستحق ربع درجة فقط عن الشخصية.
   - مجرد ذكر ألفاظ عامة ("مقاومة"، "ثورة 1919"، "كفاح"، "نساء") دون ذكر أسماء الشخصيات والرموز الواردة بالنموذج لا يستحق أكثر من نصف الدرجة (${(maxScore / 2).toFixed(1)} من ${maxScore}).
2. حظر احتساب شخصية أو عمل لم يذكره الطالب:
   - يمنع منعاً باتاً وضع شخصية في "matchedPoints" إلا إذا ورد اسمها أو الإشارة المباشرة إليها صراحة في نص الطالب.
   - أي شخصية، عمل، تاريخ، أو مكتسب دستوري ورد في النموذج ولم يذكره الطالب يجب أن يوضع فوراً وبدقة في "missingPoints".
3. رصد الحشو والاستطراد غير المرتبط (Off-topic stuffing):
   - إذا استطرد الطالب في سرد أحداث أو شخصيات من عصور أخرى لا علاقة لها بالسؤال (مثلاً: ذكر المماليك أو الحملة الفرنسية في سؤال عن ثورة 1919 والقرن العشرين)، يجب التنبيه على ذلك في "styleNote" وخفض درجة التقييم، فالاستطراد غير المرتبط لا يعوض النواقص في الإجابة المطلوبة.
4. سلم الدرجات العادل المقترح (Rubric for ${maxScore} Marks):
   - ${maxScore} من ${maxScore} (درجة كاملة): فقط في حال استوفى الطالب جميع محاور الإجابة: الشخصيات الرئيسية + أعمالها وأدواتها + دلالاتها ومكاسبها الدستورية والتاريخية بصياغة واضحة ومنضبطة.
   - ${(maxScore * 0.75).toFixed(2)} من ${maxScore}: استوفى معظم المحاور والشخصيات لكن أغفل تفصيلة فرعية واحدة (مثل إغفال دستور 1923 أو تصريح 28 فبراير).
   - ${(maxScore * 0.5).toFixed(1)} من ${maxScore} (نصف الدرجة - كحالة الطالب الذي يذكر فكرة عامة عن الثورة والمرأة دون الشخصيات والنتائج): ذكر فكرة عامة أو جانباً واحداً (مثل ذكر ثورة 1919 وخروج المرأة في المتاريس) مع إغفال الشخصيات الرئيسية (مصطفى كامل، محمد فريد، سعد زغلول) أو إغفال المكاسب الدستورية، أو كانت صياغته غير منضبطة وبها حشو.
   - ${(maxScore * 0.25).toFixed(2)} من ${maxScore}: إجابة هامشية ذكر فيها مجرد إشارة عابرة أو ذكر شخصية واحدة دون تفاصيل.
   - 0 من ${maxScore}: إجابة خارج الموضوع تماماً أو فارغة.

المطلوب إخراجه بدقة فائقة:
1. "matchedPoints": قائمة بالعناصر والمفاتيح التي استوفاها الطالب بنجاح، مصاغة بأسلوب المعلم التربوي الموجه للطالب مباشرة ("أحسنتَ/أحسنتِ في توضيح...").
2. "missingPoints": قائمة دقيقة ومفصلة بكل شخصية أو عمل تاريخي أو مكتسب أهمله الطالب، مصاغة بأسلوب المعلم الموجه للطالب مباشرة ("أغفلتَ/أغفلتِ عن ذكر شخصية... وعن دورها/دوره في: ..."، "ينقص إجابتك بيان..."). يُمنع منعاً باتاً استخدام صيغة الغائب الجافة ("أغفل الطالب").
3. "styleNote": توجيه تربوي لصياغة الطالب ولغته موجه إليه مباشرة، لتشجيعه على الالتزام بالفصحى والانضباط الزمني.
4. "suggestedScore": اقتراح درجة عادلة ودقيقة بالأرقام بين 0 و ${maxScore} (تقبل أرباع وأنصاف الدرجات: مثلاً 0.5، 0.75، 1، 1.25، 1.5، 1.75، 2).
5. "verdictSummary": خلاصة موجزة وحاسمة للمعلم تشرح بدقة سبب منح هذه الدرجة وتسمي ما استوفاه وما أغفله الطالب.
6. "studentFeedback": توجيه تربوي مشجع ومباشر للطالب بصيغة المخاطب يوضح له ما ينقصه تحديداً لاكتمال إجابته ("👍 أوردت فكرة عامة طيبة، ولكن ينقصك لاكتمال الدرجة توضيح...").

أجب بصيغة JSON حصراً بهذا النسق وبدون أي markdown خارج الـ JSON:
{
  "matchedPoints": ["أحسنتَ في توضيح..."],
  "missingPoints": ["أغفلتَ عن ذكر شخصية... وعن دورها/دوره في..."],
  "styleNote": "توجيه المعلم لأسلوب الطالب ولغته وانضباطه التاريخي",
  "suggestedScore": 1.0,
  "verdictSummary": "خلاصة المراجعة السريعة للمعلم",
  "studentFeedback": "توجيه المعلم المباشر والمخصص للطالب موضحاً التقييم والنواقص بدقة"
}
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
            studentFeedback = gender === 'female'
              ? `👍 أوردتِ فكرة عامة طيبة، ولكن ينقصكِ لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركّزي جيداً عليها لتضمني الدرجة الكاملة! 💡`
              : `👍 أوردتَ فكرة عامة طيبة، ولكن ينقصكَ لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركّز جيداً عليها لتضمن الدرجة الكاملة! 💡`;
          } else {
            const missingListStr = validMissing.slice(0, 2).join('، ');
            studentFeedback = gender === 'female'
              ? `⚠️ إجابتكِ ناقصة وبحاجة لتركيز؛ حيث أغفلتِ عن توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`
              : `⚠️ إجابتكَ ناقصة وبحاجة لتركيز؛ حيث أغفلتَ عن توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`;
          }
        }

        return {
          matchedPoints: matched,
          missingPoints: missing,
          styleNote: parsed.styleNote || 'تمت المراجعة اللغوية والتاريخية بنجاح.',
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
      const rawText = await callGroqChatCompletions(prompt, "أنت كبير مصححي مادة التاريخ للثانوية العامة. أجب بصيغة JSON فقط.");
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
            studentFeedback = gender === 'female'
              ? `👍 أوردتِ فكرة عامة طيبة، ولكن ينقصكِ لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركّزي جيداً عليها لتضمني الدرجة الكاملة! 💡`
              : `👍 أوردتَ فكرة عامة طيبة، ولكن ينقصكَ لاكتمال الدرجة النهائية توضيح: (${missingListStr}). ركّز جيداً عليها لتضمن الدرجة الكاملة! 💡`;
          } else {
            const missingListStr = validMissing.slice(0, 2).join('، ');
            studentFeedback = gender === 'female'
              ? `⚠️ إجابتكِ ناقصة وبحاجة لتركيز؛ حيث أغفلتِ عن توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`
              : `⚠️ إجابتكَ ناقصة وبحاجة لتركيز؛ حيث أغفلتَ عن توضيح: (${missingListStr}). يرجى مراجعة نموذج الإجابة جيداً.`;
          }
        }

        return {
          matchedPoints: matched,
          missingPoints: missing,
          styleNote: parsed.styleNote || 'تمت المراجعة اللغوية والتاريخية بنجاح بواسطة Groq AI.',
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
  // 3. المحلل الذكي المحلي المدمج المطور (Advanced High School History Comparator)
  // يعمل بالربط التاريخي الصارم والاقتران (شخصية + عمل + مكتسب) ورصد الاستطراد الحشوي
  // -----------------------------------------------------------------------------------------
  const heuristicResult = evaluateHighSchoolEssayEngine(cleanStudent, modelAnswer, concept, maxScore, gender);
  return {
    matchedPoints: heuristicResult.matchedPoints,
    missingPoints: heuristicResult.missingPoints,
    styleNote: heuristicResult.styleNote,
    suggestedScore: heuristicResult.suggestedScore,
    verdictSummary: heuristicResult.verdictSummary,
    studentFeedback: heuristicResult.studentFeedback,
    provider: 'heuristic',
  };
};
