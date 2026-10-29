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
    id: 'tahtawi',
    name: 'رفاعة الطهطاوي',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['طهطاوي', 'رفاعة الطهطاوي', 'رفاعه الطهطاوي'],
    actionKeywords: ['ترجمة', 'السن', 'تنوير', 'باريس', 'بعثة', 'مدارس'],
    desc: 'رائد التنوير والترجمة وتأسيس مدرسة الألسن'
  },
  {
    id: 'afghani',
    name: 'جمال الدين الأفغاني',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['افغاني', 'جمال الدين الافغاني', 'الافغاني'],
    actionKeywords: ['جامعة اسلامية', 'جامعه اسلاميه', 'تجديد', 'مقاومة', 'عروة وثقى', 'وعي'],
    desc: 'الدعوة للجامعة الإسلامية ومقاومة الاستعمار وتجديد الفكر'
  },
  {
    id: 'mohamed_abdo',
    name: 'الشيخ محمد عبده',
    category: 'figure',
    icon: '👤',
    gender: 'male',
    aliases: ['محمد عبده', 'الشيخ عبده', 'محمد عبده'],
    actionKeywords: ['اصلاح', 'ازهر', 'تحرير العقل', 'عروة وثقى', 'تجديد الفكر', 'توفيق'],
    desc: 'تحرير العقل من الجمود وتجديد الفكر الديني والإصلاح التدريجي'
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
    }
  });

  // Simulated score of 1.25
  const suggestedScore = 1.25;

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
  const missingOutcomes = missingEntities.filter(m => m.includes('📜') || m.includes('مكتسب') || m.includes('دستور'));

  let verdictSummary = '';
  if (suggestedScore >= maxScore * 0.85) {
    verdictSummary = `ما شاء الله! ${ahsant} إجابة نموذجية ومكتملة استوفيتَ فيها الشخصيات والأعمال والمحاور المطلوبة بدقة (${suggestedScore} من ${maxScore}).`;
  } else if (matchedFigures.length > 0 && missingFigures.length === 0) {
    verdictSummary = `${ahsant} في استيفاء الشخصيات والمفاهيم الأساسية، ولكن إجابتك موجزة وينقصها الاستفاضة في الشرح والتحليل التاريخي لنيل الدرجة الكاملة (${suggestedScore} من ${maxScore}).`;
  } else if (missingFigures.length > 0 && matchedFigures.length > 0) {
    verdictSummary = `${ahsant} في الإشارة لبعض الشخصيات، لكنك ${aghfalt} عن ذكر شخصيات رئيسية أخرى وتوضيح دورها الوارد بالنموذج (${suggestedScore} من ${maxScore}).`;
  } else {
    verdictSummary = `${ahsant} في الإلمام ببعض الجوانب، ولكن إجابتك غير مكتملة (${suggestedScore} من ${maxScore}).`;
  }

  let styleNote = '';
  if (matchedFigures.length > 0 && missingFigures.length === 0) {
    styleNote = 'صياغة جيدة ومترابطة، ولكن يُفضل التوسع في السرد التحليلي وربط الأدوار بالنتائج لاستحقاق الدرجة النهائية.';
  } else {
    styleNote = 'صياغتك مقبولة تاريخياً.';
  }

  let studentFeedback = '';
  if (suggestedScore >= maxScore * 0.85) {
    studentFeedback = '🎉 إجابة ممتازة ونموذجية ومكتملة العناصر بدقة، أحسنتَ وبارك الله فيك! 🌟';
  } else if (matchedFigures.length > 0 && missingFigures.length === 0) {
    studentFeedback = `👍 أحسنتَ بذكر الشخصيات والمفاهيم المطلوبة، ولكن ينقصكَ التوسع في الشرح والتحليل التاريخي لتضمن الدرجة الكاملة (${suggestedScore} من ${maxScore}). 💡`;
  }

  return {
    matchedEntities,
    missingEntities,
    verdictSummary,
    styleNote,
    studentFeedback,
    suggestedScore
  };
}

const modelAnswer = `دور رواد النهضة والفكر:
1. رفاعة الطهطاوي: رائد حركة الترجمة والبعثات وتأسيس مدرسة الألسن وتحديث الفكر التعليمي.
2. جمال الدين الأفغاني: الدعوة إلى الجامعة الإسلامية وإيقاظ الوعي ومناهضة التغلغل الاستعماري بالشورى ومجلة العروة الوثقى.
3. الشيخ محمد عبده: رائد الإصلاح الديني وتطوير الأزهر الشريف وتحرير الفكر من الجمود والتقليد.`;

const studentText = `رفاعة الطهطاوي رائد حركة الترجمة في مصر والبعثات وجمال الدين الافغاني ايقظ الوعي والشيخ محمد عبده اهتم بالاصلاح الديني`;

const res = evaluate(studentText, modelAnswer, 2, 'male');
console.log('=== نتيجة الفحص الجديد ===');
console.log('الدرجة المقترحة:', res.suggestedScore);
console.log('💡 خلاصة تقييم وتوجيه المعلم:\n', res.verdictSummary);
console.log('\nما وُفق فيه الطالب واستوفاه بنجاح:');
res.matchedEntities.forEach(m => console.log(' ', m));
console.log('\nعناصر ناقصة وتوجيهات لاستكمال الإجابة:');
res.missingEntities.forEach(m => console.log(' ', m));
console.log('\nالصياغة والأسلوب:\n', res.styleNote);
console.log('\nملاحظات وتوجيهات المعلم للطلاب على هذا السؤال:\n', res.studentFeedback);
