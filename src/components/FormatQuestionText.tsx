import React from 'react';
import { HighlightText } from './HighlightText';

interface FormatQuestionTextProps {
  text: string;
  concept?: string;
  isDarkMode?: boolean;
  className?: string;
  showStarterBadge?: boolean;
}

export const FormatQuestionText: React.FC<FormatQuestionTextProps> = ({
  text,
  concept,
  isDarkMode,
  className = '',
  showStarterBadge = true,
}) => {
  if (text === undefined || text === null) return null;
  const processedText = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/([^\n])\s*([-ـ]?[0-9٠-٩]{1,2}\s*[-ـ\)]|[-ـ][0-9٠-٩]{1,2}[-ـ]|\([0-9٠-٩]{1,2}\))/g, '$1\n$2');

  // فصل بادئة الترقيم إن وجدت (مثل: 1- أو س1: أو (1))
  const prefixRegex = /^([0-9٠-٩]{1,2}\s*[-ـ\.\)]\s*|\([0-9٠-٩]{1,2}\)\s*|س\s*[0-9٠-٩]{1,2}\s*[:\-]\s*)/;
  let prefixSpan: React.ReactNode = null;
  let remainingText = processedText.trim();

  const pMatch = remainingText.match(prefixRegex);
  if (pMatch) {
    prefixSpan = (
      <span
        key="prefix"
        className={`inline-flex items-center justify-center font-black px-2 py-0.5 rounded-md border ml-2 text-xs align-middle ${
          isDarkMode
            ? 'bg-slate-800 text-slate-200 border-slate-700'
            : 'bg-slate-100 text-slate-700 border-slate-300'
        }`}
      >
        {pMatch[0].trim()}
      </span>
    );
    remainingText = remainingText.slice(pMatch[0].length).trim();
  }

  // قواعد رأس السؤال
  const tfStarters = [
    'حدد صحة او خطأ العبارة التالية', 'حدد صحة أو خطأ العبارة التالية',
    'حدد صحة او خطأ العبارة', 'حدد صحة أو خطأ العبارة', 'حدد صحة أو خطأ',
    'حدد مدى صحة أو خطأ العبارة', 'حدد مدى صحة أو خطأ',
    'حدد مدى مصداقية العبارة التالية', 'حدد مدى مصداقية العبارة', 'حدد مدى مصداقية',
    'صح أم خطأ', 'ضع علامة صح أو خطأ', 'اكتب كلمة صواب أو خطأ',
    'هل العبارة صحيحة أم خطأ', 'هل العبارة صحيحة ام خاطئة مع التعليل', 'هل العبارة صحيحة ام خاطئة',
    'بالادلة حدد مدي صحة او خطأ العبارة', 'بالأدلة حدد مدى صحة أو خطأ العبارة'
  ];

  const standardStarters = [
    'استدل\\s+بمقولة(?:\\s+[«\\\"\\\'][^»\\\"\\\']+?[»\\\"\\\']|\\s+[^:؟?\\n]+)?',
    'استدل(?:\\s+بالأدلة(?:\\s+التاريخية)?|\\s+تاريخياً)?',
    'استنتج',
    'دلل(?:\\s+تاريخياً)?(?:\\s+على(?:\\s+صحة)?(?:\\s+العبارة(?:\\s+التالية)?)?)?',
    'دلل(?:\\s+بالأدلة(?:\\s+التاريخية)?)?',
    '[أا]يد(?:\\s+تاريخياً|\\s+بالدليل(?:\\s+التاريخي)?)?(?:\\s+صحة(?:\\s+العبارة(?:\\s+التالية)?)?)?',
    '[أا]ثبت(?:\\s+تاريخياً|\\s+بالدليل)?(?:\\s+صحة(?:\\s+العبارة)?)?',
    'برهن(?:\\s+تاريخياً)?(?:\\s+على(?:\\s+صحة)?(?:\\s+العبارة)?)?',
    'بم\\s*تفسر|بما\\s*تفسر|علل(?:\\s+لما\\s*يأتي)?|فسر(?:\\s+سبب|\\s+تاريخياً)?',
    'ما\\s*النتائج(?:\\s+المترتبة(?:\\s+على)?)?',
    'ما\\s*الآثار(?:\\s+المترتبة(?:\\s+على)?|\\s+الناتجة(?:\\s+عن)?)?',
    'ماذا\\s*ترتب(?:\\s+على)?|ماذا\\s*نتج(?:\\s+عن)?',
    'ماذا\\s*(?:كان\\s*)?يحدث(?:\\s+إذا|\\s+لو)?',
    'ما\\s*العلاقة(?:\\s+بين)?|ما\\s*وجه\\s*(?:الارتباط|الرابط)(?:\\s+بين)?',
    'وضح\\s*(?:العلاقة(?:\\s+بين)?|وجه\\s*الارتباط|الارتباط(?:\\s+بين)?|أوجه)?',
    'قارن(?:\\s+بين)?(?:\\s+من\\s+حيث)?|وازن(?:\\s+بين)?',
    'ما\\s*أوجه\\s*(?:الشبه\\s*والاختلاف|الشبه|الاختلاف)(?:\\s+بين)?',
    'ما\\s*تقييمك(?:\\s+لـ|\\s+ل)?|ما\\s*ر[أا]يك(?:\\s+في)?|ما\\s*وجهة\\s*نظرك(?:\\s+في)?',
    'ما\\s*مقترحاتك(?:\\s+لـ|\\s+ل)?|ما\\s*توقعاتك(?:\\s+لـ|\\s+ل)?|ما\\s*الدروس\\s*المستفادة(?:\\s+من)?',
    'اكتب\\s*المفهوم(?:\\s+التاريخي)?|اكتب\\s*ما\\s*تشير(?:\\s+إليه(?:\\s+العبارة)?)?',
    'وضح|بين|حلل|استخلص|صنف|حدد'
  ];

  const tfRegex = new RegExp(`^(${tfStarters.join('|')})\\s*[:؟?\\-]?\\s*`, 'i');
  const stdRegex = new RegExp(`^(${standardStarters.join('|')})\\s*[:؟?\\-]?\\s*`, 'i');

  let starterSpan: React.ReactNode = null;
  let match = remainingText.match(tfRegex);

  if (match) {
    const starterText = match[0].trim();
    remainingText = remainingText.slice(match[0].length).trim();
    starterSpan = showStarterBadge ? (
      <span
        key="starter-tf"
        className={`inline-flex items-center gap-1.5 font-black px-2.5 py-0.5 rounded-lg border ml-2 text-xs sm:text-sm align-middle shadow-xs ${
          isDarkMode
            ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800'
            : 'bg-indigo-50 text-indigo-900 border-indigo-300'
        }`}
      >
        <i className="fas fa-check-circle text-indigo-600 dark:text-indigo-400 text-xs"></i>
        <span>{starterText}</span>
      </span>
    ) : (
      <span key="starter-tf" className={`${isDarkMode ? 'text-indigo-400' : 'text-indigo-700'} font-black ml-2`}>
        {starterText}
      </span>
    );
  } else {
    match = remainingText.match(stdRegex);
    if (match) {
      const starterText = match[0].trim();
      remainingText = remainingText.slice(match[0].length).trim();
      starterSpan = showStarterBadge ? (
        <span
          key="starter-std"
          className={`inline-flex items-center gap-1.5 font-black px-2.5 py-0.5 rounded-lg border ml-2 text-xs sm:text-sm align-middle shadow-xs ${
            isDarkMode
              ? 'bg-amber-950/80 text-amber-300 border-amber-800'
              : 'bg-amber-50 text-amber-900 border-amber-300'
          }`}
        >
          <i className="fas fa-bullseye text-amber-600 dark:text-amber-400 text-xs"></i>
          <span>{starterText}</span>
        </span>
      ) : (
        <span key="starter-std" className={`${isDarkMode ? 'text-red-400' : 'text-red-800'} font-black ml-2`}>
          {starterText}
        </span>
      );
    } else {
      const colonMatch = remainingText.match(/^([^:\n]{1,60}[:])\s*/);
      if (colonMatch) {
        const starterText = colonMatch[0].trim();
        remainingText = remainingText.slice(colonMatch[0].length).trim();
        starterSpan = showStarterBadge ? (
          <span
            key="starter-colon"
            className={`inline-flex items-center gap-1.5 font-black px-2.5 py-0.5 rounded-lg border ml-2 text-xs sm:text-sm align-middle shadow-xs ${
              isDarkMode
                ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                : 'bg-blue-50 text-blue-900 border-blue-300'
            }`}
          >
            <i className="fas fa-pen-nib text-blue-600 dark:text-blue-400 text-xs"></i>
            <span>{starterText}</span>
          </span>
        ) : (
          <span key="starter-colon" className={`${isDarkMode ? 'text-red-400' : 'text-red-800'} font-black ml-2`}>
            {starterText}
          </span>
        );
      }
    }
  }

  return (
    <div className={`whitespace-pre-line leading-relaxed ${className}`}>
      {prefixSpan}
      {starterSpan}
      <HighlightText text={remainingText} concept={concept} isDarkMode={isDarkMode} inline={true} />
    </div>
  );
};
