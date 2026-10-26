import { Unit, Lesson, Question } from "./types";
import { simpleHash } from "./utils";
import { detectEssayType } from "./examConfigUtils";

export interface FlatQuestionRow {
  unit?: string;
  section?: string;
  audio?: string;
  video?: string;
  pdf?: string;
  opt1?: string;
  opt2?: string;
  opt3?: string;
  opt4?: string;
  type?: string;
  q: string;
  correct: string;
  reason: string;
  concept: string;
  paragraph: string;
  score?: string | number;
  grade?: string | number;
}

const cleanTypeStr = (val: any): string => {
  if (val === undefined || val === null) return "";
  return val.toString().replace(/["'“”«»]/g, '').trim().toLowerCase();
};

const cleanField = (val: any): string => {
  if (val === undefined || val === null) return "";
  let s = val.toString().trim();
  while (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
    (s.startsWith('“') && s.endsWith('”') && s.length >= 2)
  ) {
    s = s.substring(1, s.length - 1).trim();
  }
  s = s.replace(/""/g, '"');
  return s;
};

const isDummyOpt = (s: string) => /^[-–—ـ.\s…]+$/.test(s);

export const parsePdfEntries = (raw: string | undefined | null, fallbackLessonTitle: string): { url: string; name: string }[] => {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // فصل المدخلات إذا وجدت في أسطر متعددة أو مفصولة بفواصل
  const lines = trimmed.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const results: { url: string; name: string }[] = [];

  for (const line of lines) {
    if (!line) continue;
    let name = '';
    let url = '';

    if (line.includes('|')) {
      const parts = line.split('|');
      name = parts[0].trim();
      url = parts.slice(1).join('|').trim();
    } else {
      url = line.trim();
      // محاولة استخراج اسم ملف أصلي إن وجد في الرابط
      const driveMatch = url.match(/([^\/\?#]+\.pdf)/i);
      if (driveMatch) {
        try {
          name = decodeURIComponent(driveMatch[1]);
        } catch(e) {
          name = driveMatch[1];
        }
      } else {
        name = fallbackLessonTitle ? `مذكرة ${fallbackLessonTitle}` : 'مذكرة الدرس';
      }
    }

    if (url) {
      if (!name) name = fallbackLessonTitle ? `مذكرة ${fallbackLessonTitle}` : 'مذكرة الدرس';
      // تنظيف الامتداد .pdf من الاسم المعروض ليكون عنواناً عربياً أنيقاً ومتناسقاً
      name = name.replace(/\.pdf$/i, '').trim();
      results.push({ url, name });
    }
  }

  return results;
};

export const buildCourseData = (flatQuestions: FlatQuestionRow[]): Unit[] => {
  const course: Unit[] = [];
  let completedLessons: string[] = [];
  try {
    completedLessons = JSON.parse(localStorage.getItem('completedLessons') || '[]');
  } catch(e) {}
  
  flatQuestions.forEach(row => {
    const unitTitle = cleanField(row.unit) || "وحدة عامة";
    const lessonTitle = cleanField(row.section) || "درس عام";
    
    let unit = course.find(u => u.title === unitTitle);
    if (!unit) {
      unit = { id: `unit_${simpleHash(unitTitle)}`, title: unitTitle, lessons: [] };
      course.push(unit);
    }
    
    const lessonId = `lesson_${simpleHash(unitTitle + lessonTitle)}`;
    let lesson = unit.lessons.find((l): l is Lesson => l.title === lessonTitle);
    
    if (!lesson) {
      lesson = { 
        id: lessonId, 
        title: lessonTitle, 
        questions: [], 
        completed: completedLessons.includes(lessonId), 
        audio: null, 
        video: null,
        pdf: null,
        pdfFiles: []
      };
      unit.lessons.push(lesson);
    }
    
    if (!lesson.audio && row.audio && row.audio.toString().trim() !== "") {
      lesson.audio = row.audio.toString().trim();
    }
    if (!lesson.video && row.video && row.video.toString().trim() !== "") {
      lesson.video = row.video.toString().trim();
    }
    if (row.pdf && row.pdf.toString().trim() !== "") {
      const parsedEntries = parsePdfEntries(row.pdf.toString(), lessonTitle);
      if (!lesson.pdfFiles) lesson.pdfFiles = [];
      for (const entry of parsedEntries) {
        if (!lesson.pdfFiles.some(f => f.url === entry.url)) {
          lesson.pdfFiles.push(entry);
        }
      }
      if (!lesson.pdf && lesson.pdfFiles.length > 0) {
        lesson.pdf = lesson.pdfFiles[0].url;
      }
    }

    const options = [row.opt1, row.opt2, row.opt3, row.opt4]
      .map(o => cleanField(o))
      .filter((o): o is string => !!o && o.trim() !== "" && !isDummyOpt(o.trim()));
    
    const normType = cleanTypeStr(row.type);
    let determinedType = "mcq";

    if (
      normType === 't/f' ||
      normType === 'tf' ||
      normType === 'boolean' ||
      normType === 'صح وخطأ' ||
      normType === 'صح و خطأ' ||
      normType === 'صح/خطأ' ||
      normType === 'true/false' ||
      normType === 'صواب وخطأ' ||
      normType === 'صواب/خطأ' ||
      normType.includes('صح')
    ) {
      determinedType = 'tf';
    } else if (
      normType === 'essay' ||
      normType === 'مقالي' ||
      normType === 'مقالية' ||
      normType === 'سؤال مقالي' ||
      normType.includes('essay') ||
      normType.includes('مقالي')
    ) {
      determinedType = 'essay';
    } else if (normType === 'mcq' || normType === 'اختيار' || normType.includes('mcq') || normType.includes('اختر')) {
      determinedType = 'mcq';
    } else if (!normType) {
      determinedType = options.length > 0 ? "mcq" : "essay";
    } else {
      determinedType = options.length > 0 ? "mcq" : "essay";
    }

    let finalOptions = options;
    if (determinedType === 'essay') {
      finalOptions = [];
    } else if (determinedType === 'tf') {
      if (finalOptions.length >= 2) {
        finalOptions = finalOptions.slice(0, 2);
      } else {
        finalOptions = ["العبارة صحيحة", "العبارة خاطئة"];
      }
    }

    const parsedScore = row.score !== undefined && row.score !== "" ? Number(row.score) : (row.grade !== undefined && row.grade !== "" ? Number(row.grade) : undefined);

    const cleanQ = cleanField(row.q);
    const cleanCorrect = cleanField(row.correct);
    const cleanReason = cleanField(row.reason);
    const cleanConcept = cleanField(row.concept);
    const cleanParagraph = cleanField(row.paragraph);

    let resolvedCorrect = cleanCorrect;
    if (determinedType === 'mcq' && finalOptions.length > 0) {
      const trimmedCorrect = cleanCorrect.trim().replace(/[\(\)\[\]\.\-\:\–\—\s]/g, '');
      const letterIndexMap: Record<string, number> = {
        'أ': 0, 'ا': 0, '1': 0, '١': 0, 'A': 0, 'a': 0, 'الاول': 0, 'الأول': 0,
        'ب': 1, '2': 1, '٢': 1, 'B': 1, 'b': 1, 'الثاني': 1,
        'ج': 2, '3': 2, '٣': 2, 'C': 2, 'c': 2, 'الثالث': 2,
        'د': 3, '4': 3, '٤': 3, 'D': 3, 'd': 3, 'الرابع': 3,
      };
      if (letterIndexMap[trimmedCorrect] !== undefined && finalOptions[letterIndexMap[trimmedCorrect]]) {
        resolvedCorrect = finalOptions[letterIndexMap[trimmedCorrect]];
      }
    }

    const question: Question = {
      type: determinedType,
      q: cleanQ,
      options: finalOptions,
      correct: resolvedCorrect,
      reason: cleanReason,
      answer: cleanReason,
      concept: cleanConcept,
      paragraph: cleanParagraph,
      section: lessonTitle,
      essayType: determinedType === 'essay' ? detectEssayType(cleanQ).label : undefined,
      maxScore: typeof parsedScore === 'number' && !isNaN(parsedScore) ? parsedScore : undefined
    };

    lesson.questions.push(question);
  });
  
  // ترتيب الوحدات والدروس ترتيباً أكاديمياً ذكياً (الوحدة الأولى ثم الثانية... والدرس الأول ثم الثاني...)
  const getArabicIndexWeight = (str: string): number => {
    const s = str.trim();
    if (s.includes('أولى') || s.includes('اولى') || s.includes('الأول') || s.includes('الاول')) return 1;
    if (s.includes('ثاني') || s.includes('ثانية')) return 2;
    if (s.includes('ثالث') || s.includes('ثالثة')) return 3;
    if (s.includes('رابع') || s.includes('رابعة')) return 4;
    if (s.includes('خامس') || s.includes('خامسة')) return 5;
    if (s.includes('سادس') || s.includes('سادسة')) return 6;
    if (s.includes('سابع') || s.includes('سابعة')) return 7;
    if (s.includes('ثامن') || s.includes('ثامنة')) return 8;
    const match = s.match(/\d+/);
    if (match) return parseInt(match[0], 10);
    return 999;
  };

  course.sort((a, b) => getArabicIndexWeight(a.title) - getArabicIndexWeight(b.title));
  course.forEach(u => {
    u.lessons.sort((a, b) => getArabicIndexWeight(a.title) - getArabicIndexWeight(b.title));
    u.lessons.forEach(l => {
      if (l.pdf && (!l.pdfFiles || l.pdfFiles.length === 0)) {
        l.pdfFiles = [{
          url: l.pdf,
          name: `مذكرة ${l.title}`
        }];
      } else if (!l.pdf && l.pdfFiles && l.pdfFiles.length > 0) {
        l.pdf = l.pdfFiles[0].url;
      }
    });
  });

  return course;
};
