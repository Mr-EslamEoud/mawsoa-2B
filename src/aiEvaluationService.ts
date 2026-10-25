import { Question, ExamConfig, DialectPolicy } from './types';
import { detectEssayType, getQuestionMaxScore } from './examConfigUtils';

export interface EvaluationResult {
  score: number;
  maxScore: number;
  percentage: number;
  feedback: string;
  strengths?: string;
  improvements?: string;
  provider: 'gemini' | 'heuristic';
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
 * محرك التقييم الذكي الاحتياطي (Semantic Heuristic Matcher)
 * يعمل تلقائياً وبدقة تامة مع دعم التطبيع العربي وتصحيح النقاط الجزئية
 */
const evaluateHeuristically = (
  studentAnswer: string,
  modelAnswer: string,
  concept: string,
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

  // فحص المرادفات والمفاهيم التاريخية المترادفة (Synonym Semantic Groups)
  const synonymGroups: string[][] = [
    ['عنف', 'شده', 'قمع', 'قوه', 'بطش', 'مفرطه', 'عسكريه', 'قسوه'],
    ['ضرائب', 'اموال', 'جبايات', 'فرض', 'فض'],
    ['قاهره', 'ثوره', 'ثورتي', 'اولي', 'ثانيه', 'انتفاضه'],
    ['نابليون', 'منشور', 'وعود', 'اسلام', 'مساواه', 'تساوي'],
    ['خداع', 'سياسي', 'تطابق', 'ميكيافيلي', 'مبادئ', 'اخلاق', 'نفاق'],
    ['تعليم', 'وعي', 'هويه', 'دانلوب', 'موظفين', 'انفاق', 'مقاومه', 'مواطنين']
  ];

  const matchToken = (token: string, targetTokens: string[], targetText: string): boolean => {
    if (targetTokens.includes(token) || targetText.includes(token)) return true;
    if (token.length >= 4) {
      if (targetTokens.some(t => t.startsWith(token) || token.startsWith(t))) return true;
    }
    // فحص مجموعات الترادف الدلالي
    for (const group of synonymGroups) {
      if (group.some(g => token.startsWith(g) || g.startsWith(token))) {
        if (group.some(g => targetTokens.some(t => t.startsWith(g) || g.startsWith(t)) || targetText.includes(g))) {
          return true;
        }
      }
    }
    return false;
  };

  // فحص عدد بنود النموذج التي غطاها الطالب (Clause Coverage)
  let coveredClausesCount = 0;
  modelClauses.forEach(clause => {
    const clauseTokens = extractMeaningfulTokens(clause);
    const clauseNorm = normalizeArabic(clause);
    const hasMatch = studentTokens.some(st => matchToken(st, clauseTokens, clauseNorm));
    if (hasMatch) {
      coveredClausesCount++;
    }
  });

  const clauseCoverageRatio = modelClauses.length > 0 ? (coveredClausesCount / modelClauses.length) : 0;

  // فحص نسبة الكلمات التاريخية الصحيحة التي كتبها الطالب (Student Relevance)
  let studentMatchCount = 0;
  studentTokens.forEach(st => {
    if (matchToken(st, allModelTokens, normalizeArabic(modelAnswer))) {
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

  // إذا لم يتوفر مفتاح API، نعتمد نتيجة المحرك المحلي فوراً
  if (!apiKey) {
    return preEval;
  }

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

  // في حال كانت الإجابة غير منظمة، أو مكتوبة بأسلوب الطالب الخاص/العامية، أو تحتاج لتحليل عميق:
  // نقوم بالاتصال بـ Gemini API لتفكيك الصياغة واستخراج المعنى الكامل
  try {
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

    const candidateModels = [
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash-8b',
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest'
    ];
    let rawText = '';
    let lastError: any = null;

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
            break; // نجح التوليد بهذا النموذج
          }
        } else {
          if (response.status === 429) {
            setGeminiKeyHealth('quota_exhausted');
          } else if (response.status === 400 || response.status === 403) {
            setGeminiKeyHealth('invalid');
          }
          lastError = new Error(`Model ${model} returned ${response.status}`);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!rawText) throw lastError || new Error("Empty response from Gemini");

    const parsed = JSON.parse(rawText);
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

  } catch (error) {
    console.warn("Falling back to local heuristic evaluator due to error:", error);
    return evaluateHeuristically(studentAnswer, modelAnswer, question.concept, maxScore, detectedType);
  }
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
  provider: 'gemini' | 'heuristic';
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
  essayType: string = 'سؤال مقالي'
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
      provider: 'heuristic',
    };
  }

  const apiKey = getGeminiApiKey();

  if (apiKey) {
    try {
      const prompt = `
أنت مصحح ومراجع امتحانات تاريخ ثانوية عامة خبير. مهمتك إجراء مقارنة تفصيلية وتحليل الفروق (AI Diff Analysis) بين "إجابة الطالب" و"نموذج الإجابة المعتمد" لمساعدة المعلم في اتخاذ القرار العادل بدقة وسرعة:

[نوع السؤال]: ${essayType}
[نص السؤال]: ${questionText}
[نموذج الإجابة المعتمد]:
${modelAnswer}

[إجابة الطالب]:
"${cleanStudent}"

[الدرجة العظمى]: ${maxScore} درجات

المطلوب بدقة:
1. "matchedPoints": قائمة بنقاط القوة والتطابق (الأفكار والمفاهيم الصحيحة التي ذكرها الطالب بنجاح).
2. "missingPoints": قائمة بالعناصر الناقصة أو المفقودة (الأفكار أو الشواهد التاريخية الموجودة بالنموذج والتي أغفلها الطالب أو أخطأ فيها).
3. "styleNote": تحليل لغة وصياغة الطالب (هل صياغته فصحى أم عامية؟ وهل استخدم المصطلحات التاريخية المطلوبة؟).
4. "suggestedScore": اقتراح درجة عادلة ودقيقة بالأرقام بين 0 و ${maxScore} (يقبل أنصاف الدرجات).
5. "verdictSummary": خلاصة توجيهية موجزة ومباشرة للمعلم في سطرين توضح قرارك والسبب.

أجب بصيغة JSON حصراً بهذا النسق وبدون أي markdown خارج الـ JSON:
{
  "matchedPoints": ["نقطة 1", "نقطة 2"],
  "missingPoints": ["عنصر مفقود 1"],
  "styleNote": "تقييم الصياغة واللهجة",
  "suggestedScore": 1.5,
  "verdictSummary": "خلاصة المراجعة السريعة للمعلم"
}
`;

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
            } else if (response.status === 400 || response.status === 403) {
              setGeminiKeyHealth('invalid');
            }
          }
        } catch (e) {}
      }

      if (rawText) {
        const parsed = JSON.parse(rawText);
        return {
          matchedPoints: Array.isArray(parsed.matchedPoints) ? parsed.matchedPoints : [],
          missingPoints: Array.isArray(parsed.missingPoints) ? parsed.missingPoints : [],
          styleNote: parsed.styleNote || 'تمت المراجعة اللغوية بنجاح.',
          suggestedScore: Math.max(0, Math.min(maxScore, Number(parsed.suggestedScore) || 0)),
          verdictSummary: parsed.verdictSummary || 'تم تحليل الفروق وتطابق الإجابة بنجاح.',
          provider: 'gemini',
        };
      }
    } catch (e) {
      console.warn("Gemini diff failed, using heuristic comparison:", e);
    }
  }

  // المحلل الذكي المحلي المدمج (Heuristic Diff Comparator)
  const modelLines = modelAnswer
    .split(/\n|(?=\b\d+[-.)])|(?=\b- )/)
    .map(l => l.trim())
    .filter(l => l.length > 5);

  const cleanStudentLower = cleanStudent.toLowerCase();
  const stopWords = new Set(['في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'كان', 'كانت', 'أن', 'إن', 'الذي', 'التي', 'قد', 'بين', 'حيث', 'هو', 'هي']);

  const matchedPoints: string[] = [];
  const missingPoints: string[] = [];

  modelLines.forEach(line => {
    const lineKeywords = line
      .toLowerCase()
      .replace(/[^\u0621-\u064A\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    const matchedKw = lineKeywords.filter(kw => cleanStudentLower.includes(kw));
    const ratio = lineKeywords.length > 0 ? (matchedKw.length / lineKeywords.length) : 0;

    if (ratio >= 0.25 || (matchedKw.length >= 2 && lineKeywords.length >= 3)) {
      matchedPoints.push(`استوفى فكرة: "${line.slice(0, 70)}${line.length > 70 ? '...' : ''}"`);
    } else {
      missingPoints.push(`لم يشر إلى: "${line.slice(0, 70)}${line.length > 70 ? '...' : ''}"`);
    }
  });

  const totalLines = Math.max(1, modelLines.length);
  const matchRatio = matchedPoints.length / totalLines;
  const suggestedScore = Math.round((matchRatio * maxScore) * 4) / 4;

  const colloquialWords = ['عشان', 'علشان', 'خلوا', 'وقعوا', 'بقى', 'كده', 'ايه', 'معملش', 'مجاش'];
  const hasColloquial = colloquialWords.some(w => cleanStudentLower.includes(w));
  const styleNote = hasColloquial 
    ? 'تضمنت إجابة الطالب تعبيرات عامية، يُفضل توجيهه للاعتماد الكامل على الفصحى في الثانوية العامة.'
    : 'صياغة الطالب واضحة ومقبولة لغوياً وتستخدم مفردات ملائمة للمقرر.';

  const verdictSummary = matchRatio >= 0.75 
    ? `أجاب الطالب على معظم عناصر نموذج الإجابة بنجاح واستحق ${suggestedScore} من ${maxScore}.`
    : matchRatio >= 0.4
    ? `أورد الطالب جانباً من الإجابة وأغفل عناصر أساسية من النموذج، الدرجة المقترحة: ${suggestedScore} من ${maxScore}.`
    : `الإجابة ضعيفة وتفتقر إلى معظم الشواهد والمفاهيم الواردة بالنموذج (${suggestedScore} من ${maxScore}).`;

  return {
    matchedPoints: matchedPoints.length > 0 ? matchedPoints : ['لم يتم العثور على تطابق مباشر مع مفاهيم نموذج الإجابة.'],
    missingPoints: missingPoints.length > 0 ? missingPoints : ['أورد الطالب جميع النقاط الأساسية.'],
    styleNote,
    suggestedScore,
    verdictSummary,
    provider: 'heuristic',
  };
};
