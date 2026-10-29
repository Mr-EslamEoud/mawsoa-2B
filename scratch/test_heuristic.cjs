const { execSync } = require('child_process');

function normalizeArabic(text) {
  if (!text) return '';
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ـ]/g, '')
    .replace(/[^\u0621-\u064A0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const HISTORICAL_REGISTRY = [
  {
    id: 'mostafa_kamel',
    name: 'مصطفى كامل',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['مصطفى كامل', 'مصطفي كامل'],
    actionKeywords: ['صحف', 'جريدة اللواء', 'جريده اللواء', 'اللواء', 'الحزب الوطني', 'احزاب', 'نشر الوعي'],
    desc: 'تأسيس الصحف (جريدة اللواء) وإيقاظ الوعي الوطني وقيادة الحزب الوطني'
  },
  {
    id: 'mohamed_farid',
    name: 'محمد فريد',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['محمد فريد', 'فريد'],
    actionKeywords: ['نقابة عمال', 'نقابه عمال', 'مدارس ليلية', 'مدارس ليليه', 'مدارس شعبية', 'مدارس شعبيه', 'احزاب', 'توسيع قاعدة'],
    desc: 'تأسيس نقابات العمال والمدارس الشعبية الليلية وتوسيع قاعدة الحزب الوطني'
  },
  {
    id: 'saad_zaghloul',
    name: 'سعد زغلول',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['سعد زغلول', 'سعد'],
    actionKeywords: ['وفد', 'حزب الوفد', 'تعبئة جماهيرية', 'تعبئه جماهيريه', 'توكيلات', 'مؤتمر الصلح', 'ثورة 1919'],
    desc: 'قيادة حزب الوفد والتعبئة الجماهيرية الشاملة في ثورة 1919'
  },
  {
    id: 'hoda_shaarawy',
    name: 'هدى شعراوي',
    category: 'figure',
    icon: '🧕',
    gender: 'female',
    aliases: ['هدى شعراوي', 'هدي شعراوي', 'شعراوي'],
    actionKeywords: ['لجنة الوفد المركزية', 'لجنه الوفد المركزيه', 'رئيسة اللجنة', 'رئيسه اللجنه', 'حركة نسائية', 'حركه نسائيه', 'حزب الوفد'],
    desc: 'تأسيس لجنة الوفد المركزية للسيدات (1920) ورئاسة الحركة النسائية'
  },
  {
    id: 'safiya_zaghloul',
    name: 'صفية زغلول',
    category: 'figure',
    icon: '🧕',
    gender: 'female',
    aliases: ['صفية زغلول', 'صفيه زغلول', 'ام المصريين', 'أم المصريين'],
    actionKeywords: ['مظاهرات', 'قيادة نسائية', 'قياده نسائيه', 'متاريس', 'رفع لواء', 'ام المصريين'],
    desc: 'قيادة المظاهرات النسائية والمشاركة الفعالة في ثورة 1919 ولقب أم المصريين'
  },
  {
    id: 'wafd_party',
    name: 'حزب الوفد',
    category: 'party',
    icon: '🏛️',
    gender: 'male',
    aliases: ['حزب الوفد', 'الوفد', 'لجنة الوفد', 'لجنه الوفد'],
    actionKeywords: ['توكيلات', 'مفاوضات', 'مؤتمر الصلح', 'تعبئة'],
    desc: 'قيادة الحركة الوطنية وتمثيل الشعب المصري في مفاوضات الاستقلال'
  },
  {
    id: 'national_party',
    name: 'الحزب الوطني',
    category: 'party',
    icon: '🏛️',
    gender: 'male',
    aliases: ['الحزب الوطني', 'حزب وطني'],
    actionKeywords: ['مصطفى كامل', 'محمد فريد', 'جريدة اللواء'],
    desc: 'الكفاح ضد الاحتلال عبر الصحافة والتعليم والنقابات'
  },
  {
    id: 'constitution_1923',
    name: 'دستور 1923',
    category: 'outcome',
    icon: '📜',
    gender: 'male',
    aliases: ['دستور 1923', 'دستور ٢٣', 'الدستور المصري', 'دستور'],
    actionKeywords: ['حقوق سياسية', 'حقوق سياسيه', 'مشاركة المرأة', 'مشاركه المرأه', 'مكتسبات دستورية', 'مكتسبات دستوريه', 'انتخابات', 'برلمان'],
    desc: 'الاعتراف بالحقوق السياسية والمدنية للأمة وتتويج نضال ثورة 1919'
  },
  {
    id: 'press_struggle',
    name: 'النضال الصحفي ونشر الوعي',
    category: 'action',
    icon: '📰',
    gender: 'male',
    aliases: ['صحافة', 'صحافه', 'صحف', 'جريدة', 'جريده', 'اللواء', 'المؤيد', 'العالم الإسلامي'],
    actionKeywords: ['نشر الوعي', 'إيقاظ الوعي', 'مقالات', 'رأي عام'],
    desc: 'استخدام الصحافة الوطنية لتعرية الاحتلال وتوعية الجماهير'
  },
  {
    id: 'women_empowerment',
    name: 'مشاركة المرأة وتأسيس اللجان النسائية',
    category: 'action',
    icon: '✊',
    gender: 'female',
    aliases: ['المرأة', 'المرأه', 'سيدات', 'نسائية', 'نسائيه', 'متاريس', 'مظاهرات نسائية', 'مظاهرات نسائيه', 'لجنة الوفد المركزية'],
    actionKeywords: ['ثورة 1919', 'إقامة المتاريس', 'اقامه المتاريس', 'احتجاجات', 'مظاهرات'],
    desc: 'خروج المرأة لأول مرة في المظاهرات (ثورة 1919) وإقامة المتاريس وتأسيس لجان سياسية'
  }
];

function evaluate(studentAnswer, modelAnswer, maxScore = 2, gender = 'male') {
  const normStudent = normalizeArabic(studentAnswer);
  const normModel = normalizeArabic(modelAnswer);

  const isFemale = gender === 'female';
  const ahsant = isFemale ? 'أحسنتِ' : 'أحسنتَ';
  const wuffiqt = isFemale ? 'وفّقتِ' : 'وفّقتَ';
  const aghfalt = isFemale ? 'أغفلتِ' : 'أغفلتَ';
  const yanqusak = isFemale ? 'ينقصكِ' : 'ينقصكَ';
  const kanYanbaghi = isFemale ? 'كان ينبغي عليكِ' : 'كان ينبغي عليكَ';

  const modelEntities = HISTORICAL_REGISTRY.filter(item => {
    return item.aliases.some(a => normModel.includes(normalizeArabic(a))) ||
           (item.actionKeywords && item.actionKeywords.some(k => normModel.includes(normalizeArabic(k))));
  });

  const matchedEntities = [];
  const missingEntities = [];

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
    } else if (item.category === 'action') {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${ahsant} بالإشارة إلى هذا العمل التاريخي ووسيلة الكفاح بنجاح.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${yanqusak} توضيح وسيلة الكفاح والعمل التاريخي: ${item.desc}.`);
      }
    } else if (item.category === 'outcome') {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${wuffiqt} في استنتاج هذه الدلالة والمكتسب الدستوري/التاريخي.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${aghfalt} عن بيان هذا المكتسب/الأثر الدستوري: ${item.desc}.`);
      }
    } else {
      if (studentHasAlias || studentHasAction) {
        matchedEntities.push(`${item.icon} [${item.name}]: ${ahsant} بالإشارة إليه وتوضيحه ضمن السياق التاريخي.`);
      } else {
        missingEntities.push(`${item.icon} [${item.name}]: ${kanYanbaghi} الإشارة إليه وتوضيح دوره في: ${item.desc}.`);
      }
    }
  });

  return {
    matchedEntities,
    missingEntities,
  };
}

const modelAnswer = `تطور أدوات الحركة الوطنية ومشاركة المرأة في مطلع القرن العشرين:
1. تطور الأدوات: انتقلت من مجرد الصحافة وتأسيس المدارس الليلية والنقابات (مصطفى كامل ومحمد فريد بالحزب الوطني) إلى العمل الشعبي الجماهيري وتشكيل الوفد وجمع التوكيلات والمفاوضات ومؤتمر الصلح بقيادة سعد زغلول وحزب الوفد.
2. مشاركة المرأة: مثلت ثورة 1919 انعكاساً جذرياً؛ حيث شاركت المرأة لأول مرة في المظاهرات وإقامة المتاريس جنباً إلى جنب مع الرجل، وتشكلت لجنة الوفد المركزية للسيدات برئاسة هدى شعراوي، وبرز دور صفية زغلول (أم المصريين)، مما توّج لاحقاً في مكتسبات دستورية بحقوق المواطنة في دستور 1923.`;

const studentImage2 = `لقد تطورت ادوات النضال في ثورة 1919 حيث خرجت المرأة في المظاهرات مع الرجال وقاموا باعمال وطنية عظيمة ضد الانجليز`;

const res = evaluate(studentImage2, modelAnswer, 2, 'male');
console.log('=== MATCHED POINTS (ما استوفاه الطالب) ===');
res.matchedEntities.forEach(m => console.log(m));
console.log('\n=== MISSING POINTS (عناصر ناقصة وتوجيهات للمعلم) ===');
res.missingEntities.forEach(m => console.log(m));
