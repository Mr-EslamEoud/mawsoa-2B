import React, { useState, useMemo } from 'react';
import { Question, Unit, StudentEssaySubmission, PermanentMistakeItem } from '../types';
import { toEasternArabic, simpleHash, createArabicWatermarkCanvas } from '../utils';
import { FormatQuestionText } from './FormatQuestionText';
import { HighlightText } from './HighlightText';
import { resolveModelAnswer } from './AdminEssayReviewTab';

export interface EnrichedMistakeItem {
  id: string;
  question: Question;
  unitId: string;
  unitTitle: string;
  lessonId: string;
  lessonTitle: string;
  studentAnswerText?: string;
  studentSelectedOption?: string;
  modelAnswer: string;
  reason?: string;
  concept?: string;
  isEssay: boolean;
  essayType?: string;
  teacherScore?: number;
  maxScore?: number;
  teacherFeedback?: string;
  timestamp?: number;
}

interface MistakesNotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
  permanentMistakes?: PermanentMistakeItem[];
  mistakes?: Question[];
  unitsData: Unit[];
  essaySubmissions?: StudentEssaySubmission[];
  isDarkMode?: boolean;
  onDeleteMistake?: (id: string) => void;
  onClearNotebook?: () => void;
  studentName?: string;
  studentPhone?: string;
  subjectName?: string;
  gradeName?: string;
}

const MASTERED_MISTAKES_KEY = "kanz_mastered_mistakes_hashes";

// مساعدة للتحقق من تطابق الخيار مع الإجابة الصحيحة
const isOptionCorrect = (opt: string, corr: string): boolean => {
  if (!opt || !corr) return false;
  const o = opt.trim().toLowerCase();
  const c = corr.trim().toLowerCase();
  if (o === c) return true;
  if (o.startsWith(c + ')') || o.startsWith(c + ' -') || o.startsWith(c + ' :') || o.startsWith(c + '.')) return true;
  
  const isT_opt = o.includes('صحيح') || o === 'صح' || o === 'ص' || o === 'true' || o === 't' || o === '1';
  const isF_opt = o.includes('خطأ') || o.includes('خاطئ') || o === 'خ' || o === 'false' || o === 'f' || o === '2';
  const isT_corr = c.includes('صحيح') || c === 'صح' || c === 'ص' || c === 'true' || c === 't' || c === '1';
  const isF_corr = c.includes('خطأ') || c.includes('خاطئ') || c === 'خ' || c === 'false' || c === 'f' || c === '2';
  if (isT_opt && isT_corr) return true;
  if (isF_opt && isF_corr) return true;
  return false;
};

// =========================================================================
// أدوات إنشاء ملف الـ PDF لكشكول الأخطاء بجودة عالية وباللغة العربية الكاملة
// =========================================================================

// تحويل Data URL إلى بايتس بدون الحاجة لطلبات شبكة
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const parts = dataUrl.split(',');
  const base64 = parts[1] || '';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// دالة رسم مستطيل بحواف دائرية على الكانفاس متوافقة مع جميع المتصفحات
function drawCanvasRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: boolean = true,
  stroke: boolean = true
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// تقسيم النص العربي إلى أسطر متناسبة مع عرض الكانفاس
function wrapArabicLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.trim().split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  return lines;
}

interface CardMeasureResult {
  cardHeight: number;
  qLines: string[];
  optionsInfo: { opt: string; isCorrect: boolean; isStudent: boolean; lines: string[]; height: number }[];
  studentAnsLines: string[];
  modelAnsLines: string[];
  teacherGuideLines: string[];
}

// قياس أبعاد بطاقة السؤال بدقة قبل الرسم
function measureMistakeCard(
  ctx: CanvasRenderingContext2D,
  item: EnrichedMistakeItem,
  cardWidth: number
): CardMeasureResult {
  const innerWidth = cardWidth - 50;
  let height = 48; // شريط الشارات العلوي

  // نص السؤال
  ctx.font = 'bold 22px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
  const qLines = wrapArabicLines(ctx, item.question.q, innerWidth - 30);
  height += 18 + qLines.length * 32 + 18;

  // الخيارات في الأسئلة الاختيارية
  ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
  const optionsInfo: { opt: string; isCorrect: boolean; isStudent: boolean; lines: string[]; height: number }[] = [];
  if (!item.isEssay && item.question.options && item.question.options.length > 0) {
    for (const opt of item.question.options) {
      const isCorrect = isOptionCorrect(opt, item.question.correct);
      const isStudent = !!(item.studentSelectedOption && (
        opt.trim() === item.studentSelectedOption.trim() ||
        isOptionCorrect(opt, item.studentSelectedOption)
      ));
      const optLines = wrapArabicLines(ctx, opt, innerWidth - 190);
      const optHeight = Math.max(46, optLines.length * 27 + 16);
      optionsInfo.push({ opt, isCorrect, isStudent, lines: optLines, height: optHeight });
      height += optHeight + 8;
    }
    height += 8;
  }

  // إجابة الطالب المقالية المسجلة
  ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
  const studentAnsLines: string[] = [];
  if (item.isEssay && item.studentAnswerText) {
    studentAnsLines.push(...wrapArabicLines(ctx, item.studentAnswerText, innerWidth - 30));
    height += 36 + studentAnsLines.length * 27 + 16;
  }

  // نموذج الإجابة المعتمد والصحيح
  ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
  let modelAns = item.modelAnswer;
  if (!modelAns || modelAns.includes('راجع التفسير')) {
    if (item.reason && !item.reason.includes('لم يتم الإجابة')) {
      modelAns = item.reason;
    } else {
      const resolved = resolveModelAnswer(item.question.q, item.lessonTitle, item.lessonId, undefined, undefined);
      modelAns = resolved.modelAnswer || 'نموذج الإجابة المعتمد قيد الاعتماد من المعلم';
    }
  }
  const modelAnsLines = wrapArabicLines(ctx, modelAns, innerWidth - 30);
  height += 36 + modelAnsLines.length * 27 + 18;

  // توجيهات أ/ إسلام سعود
  ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
  const guideText = item.teacherFeedback || item.reason || item.concept || '';
  const teacherGuideLines: string[] = [];
  if (guideText.trim()) {
    teacherGuideLines.push(...wrapArabicLines(ctx, guideText, innerWidth - 30));
    height += 36 + teacherGuideLines.length * 27 + 18;
  }

  height += 24; // هامش داخلي سفلي

  return {
    cardHeight: height,
    qLines,
    optionsInfo,
    studentAnsLines,
    modelAnsLines,
    teacherGuideLines
  };
}

// رسم بطاقة السؤال على الكانفاس
function drawMistakeCard(
  ctx: CanvasRenderingContext2D,
  item: EnrichedMistakeItem,
  measure: CardMeasureResult,
  cardX: number,
  cardY: number,
  cardWidth: number,
  index: number
) {
  const cardHeight = measure.cardHeight;
  const innerX = cardX + 25;
  const innerWidth = cardWidth - 50;

  ctx.save();

  // إطار وخلفية البطاقة
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  drawCanvasRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 18, true, true);

  let currentY = cardY + 22;

  // شارات رأس البطاقة
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';

  // شارة رقم السؤال
  const numBadgeWidth = 44;
  const numBadgeHeight = 32;
  ctx.fillStyle = '#7e22ce'; // purple-700
  drawCanvasRoundRect(ctx, cardX + cardWidth - 25 - numBadgeWidth, currentY, numBadgeWidth, numBadgeHeight, 8, true, false);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 16px "Cairo", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(toEasternArabic(index + 1), cardX + cardWidth - 25 - (numBadgeWidth / 2), currentY + 22);

  // شارة الوحدة
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = 'bold 15px "Cairo", sans-serif';
  let badgeCursorX = cardX + cardWidth - 25 - numBadgeWidth - 12;

  const unitText = `📁 ${item.unitTitle}`;
  const unitW = ctx.measureText(unitText).width + 20;
  ctx.fillStyle = '#f3e8ff'; // purple-100
  drawCanvasRoundRect(ctx, badgeCursorX - unitW, currentY, unitW, 32, 8, true, false);
  ctx.fillStyle = '#6b21a8'; // purple-800
  ctx.fillText(unitText, badgeCursorX - 10, currentY + 21);
  badgeCursorX -= (unitW + 8);

  // شارة الدرس
  const lessonText = `📖 ${item.lessonTitle}`;
  const lessonW = ctx.measureText(lessonText).width + 20;
  ctx.fillStyle = '#e0e7ff'; // indigo-100
  drawCanvasRoundRect(ctx, badgeCursorX - lessonW, currentY, lessonW, 32, 8, true, false);
  ctx.fillStyle = '#3730a3'; // indigo-800
  ctx.fillText(lessonText, badgeCursorX - 10, currentY + 21);
  badgeCursorX -= (lessonW + 8);

  // شارة نوع السؤال
  const typeText = item.isEssay ? (item.essayType || 'سؤال مقالي') : 'اختياري / صح وخطأ';
  const typeW = ctx.measureText(typeText).width + 20;
  ctx.fillStyle = item.isEssay ? '#fce7f3' : '#dbeafe';
  drawCanvasRoundRect(ctx, badgeCursorX - typeW, currentY, typeW, 32, 8, true, false);
  ctx.fillStyle = item.isEssay ? '#9d174d' : '#1e40af';
  ctx.fillText(typeText, badgeCursorX - 10, currentY + 21);

  currentY += 46;

  // مربع نص السؤال المنسق
  const qBoxHeight = 16 + measure.qLines.length * 32 + 14;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  drawCanvasRoundRect(ctx, innerX, currentY, innerWidth, qBoxHeight, 12, true, true);

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 20px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  let qLineY = currentY + 28;
  for (const line of measure.qLines) {
    ctx.fillText(line, innerX + innerWidth - 16, qLineY);
    qLineY += 32;
  }
  currentY += qBoxHeight + 14;

  // الخيارات في الأسئلة الاختيارية
  if (measure.optionsInfo.length > 0) {
    for (const optInfo of measure.optionsInfo) {
      const optH = optInfo.height;
      if (optInfo.isCorrect) {
        ctx.fillStyle = '#ecfdf5'; // emerald-50
        ctx.strokeStyle = '#10b981'; // emerald-500
        ctx.lineWidth = 2;
      } else if (optInfo.isStudent) {
        ctx.fillStyle = '#fef2f2'; // rose-50
        ctx.strokeStyle = '#f43f5e'; // rose-500
        ctx.lineWidth = 2;
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
      }
      drawCanvasRoundRect(ctx, innerX, currentY, innerWidth, optH, 10, true, true);

      // شارة حالة الخيار على اليسار
      if (optInfo.isCorrect) {
        ctx.fillStyle = '#059669';
        drawCanvasRoundRect(ctx, innerX + 12, currentY + 8, 140, optH - 16, 6, true, false);
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 13px "Cairo", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✔ الإجابة النموذجية', innerX + 12 + 70, currentY + 8 + (optH - 16) / 2 + 5);
      } else if (optInfo.isStudent) {
        ctx.fillStyle = '#e11d48';
        drawCanvasRoundRect(ctx, innerX + 12, currentY + 8, 130, optH - 16, 6, true, false);
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 13px "Cairo", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✖ إجابتك السابقة', innerX + 12 + 65, currentY + 8 + (optH - 16) / 2 + 5);
      }

      // نص الخيار
      ctx.textAlign = 'right';
      ctx.direction = 'rtl';
      ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillStyle = optInfo.isCorrect ? '#065f46' : optInfo.isStudent ? '#881337' : '#334155';
      let optLineY = currentY + 24;
      for (const line of optInfo.lines) {
        ctx.fillText(line, innerX + innerWidth - 16, optLineY);
        optLineY += 27;
      }

      currentY += optH + 8;
    }
    currentY += 6;
  }

  // إجابة الطالب في الأسئلة المقالية
  if (measure.studentAnsLines.length > 0) {
    const sBoxH = 34 + measure.studentAnsLines.length * 27 + 14;
    ctx.fillStyle = '#fff1f2'; // rose-50
    ctx.strokeStyle = '#fecdd3';
    ctx.lineWidth = 1.5;
    drawCanvasRoundRect(ctx, innerX, currentY, innerWidth, sBoxH, 10, true, true);

    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = '900 15px "Cairo", sans-serif';
    ctx.fillStyle = '#be123c';
    ctx.fillText('✍️ إجابتك المسجلة:', innerX + innerWidth - 14, currentY + 22);

    if (item.teacherScore !== undefined && item.maxScore !== undefined) {
      const scoreStr = `الدرجة: ${toEasternArabic(item.teacherScore)} / ${toEasternArabic(item.maxScore)}`;
      ctx.textAlign = 'left';
      ctx.fillText(scoreStr, innerX + 16, currentY + 22);
    }

    ctx.textAlign = 'right';
    ctx.font = 'bold 17px "Cairo", sans-serif';
    ctx.fillStyle = '#1e293b';
    let sLineY = currentY + 44;
    for (const line of measure.studentAnsLines) {
      ctx.fillText(line, innerX + innerWidth - 14, sLineY);
      sLineY += 27;
    }
    currentY += sBoxH + 12;
  }

  // صندوق نموذج الإجابة المعتمد والصحيح
  const mBoxH = 32 + measure.modelAnsLines.length * 27 + 14;
  ctx.fillStyle = '#ecfdf5'; // emerald-50
  ctx.strokeStyle = '#34d399'; // emerald-400
  ctx.lineWidth = 1.5;
  drawCanvasRoundRect(ctx, innerX, currentY, innerWidth, mBoxH, 10, true, true);

  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  ctx.font = '900 15px "Cairo", sans-serif';
  ctx.fillStyle = '#065f46'; // emerald-800
  ctx.fillText('✅ نموذج الإجابة المعتمد والصحيح:', innerX + innerWidth - 14, currentY + 22);

  ctx.font = 'bold 18px "Cairo", sans-serif';
  ctx.fillStyle = '#047857';
  let mLineY = currentY + 44;
  for (const line of measure.modelAnsLines) {
    ctx.fillText(line, innerX + innerWidth - 14, mLineY);
    mLineY += 27;
  }
  currentY += mBoxH + 12;

  // صندوق توجيهات أ/ إسلام سعود (بدون كلمة المعلم)
  if (measure.teacherGuideLines.length > 0) {
    const tBoxH = 32 + measure.teacherGuideLines.length * 27 + 14;
    ctx.fillStyle = '#fffbeb'; // amber-50
    ctx.strokeStyle = '#f59e0b'; // amber-500
    ctx.lineWidth = 1.5;
    drawCanvasRoundRect(ctx, innerX, currentY, innerWidth, tBoxH, 10, true, true);

    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = '900 15px "Cairo", sans-serif';
    ctx.fillStyle = '#92400e'; // amber-800
    ctx.fillText('💡 توجيهات أ/ إسلام سعود:', innerX + innerWidth - 14, currentY + 22);

    ctx.font = 'bold 18px "Cairo", sans-serif';
    ctx.fillStyle = '#78350f';
    let tLineY = currentY + 44;
    for (const line of measure.teacherGuideLines) {
      ctx.fillText(line, innerX + innerWidth - 14, tLineY);
      tLineY += 27;
    }
  }

  ctx.restore();
}

// رسم رأس الصفحة للمستند
function drawPageHeader(
  ctx: CanvasRenderingContext2D,
  isFirstPage: boolean,
  studentName: string,
  studentPhone: string,
  subjectName: string,
  gradeName: string,
  totalMistakes: number
) {
  const marginX = 70;
  const contentW = 1100;

  ctx.save();
  ctx.direction = 'rtl';

  if (isFirstPage) {
    // لافتة ملكية فاخرة في الصفحة الأولى
    const bannerH = 160;
    const grad = ctx.createLinearGradient(marginX, 35, marginX + contentW, 35 + bannerH);
    grad.addColorStop(0, '#3b0764'); // deep purple
    grad.addColorStop(0.5, '#581c87');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
    drawCanvasRoundRect(ctx, marginX, 35, contentW, bannerH, 16, true, false);

    // خط ذهبي علوي
    ctx.fillStyle = '#f59e0b';
    drawCanvasRoundRect(ctx, marginX, 35, contentW, 6, 4, true, false);

    // العنوان الرئيسي
    ctx.font = '900 30px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = '#fef08a'; // gold
    ctx.textAlign = 'center';
    ctx.fillText('★ موسوعة الكنز التعليمية - كشكول أهم الأخطاء والنموذج المعتمد ★', marginX + contentW / 2, 78);

    // العنوان الفرعي
    ctx.font = 'bold 18px "Cairo", sans-serif';
    ctx.fillStyle = '#e9d5ff';
    ctx.fillText('مرجعك الدائم والشامل للمراجعة مع نماذج الإجابة وتوجيهات أ/ إسلام سعود', marginX + contentW / 2, 110);

    // شريط البيانات المعتمد
    ctx.font = 'bold 15px "Cairo", sans-serif';
    ctx.fillStyle = '#ffffff';
    const dateStr = new Date().toLocaleDateString('ar-EG');
    const metaStr = `الطالب: ${studentName || 'طالب مسجل'}  |  الهاتف: ${studentPhone || '---'}  |  المادة: ${subjectName}  |  المرحلة: ${gradeName}  |  الأخطاء: ${toEasternArabic(totalMistakes)}  |  التاريخ: ${dateStr}`;
    ctx.fillText(metaStr, marginX + contentW / 2, 150);
  } else {
    // لافتة مضغوطة للصفحات التالية
    const bannerH = 65;
    ctx.fillStyle = '#4c1d95'; // purple-900
    drawCanvasRoundRect(ctx, marginX, 25, contentW, bannerH, 12, true, false);

    ctx.fillStyle = '#f59e0b';
    drawCanvasRoundRect(ctx, marginX, 25, contentW, 4, 2, true, false);

    ctx.font = '900 20px "Cairo", sans-serif';
    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'right';
    ctx.fillText('كشكول أهم الأخطاء والنموذج المعتمد - توجيهات أ/ إسلام سعود', marginX + contentW - 20, 58);

    ctx.font = 'bold 15px "Cairo", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`نسخة الطالب: ${studentName || 'طالب مسجل'}`, marginX + 20, 58);
  }

  ctx.restore();
}

// رسم ذيل الصفحة مع رقم الصفحة
function drawPageFooter(
  ctx: CanvasRenderingContext2D,
  pageIndex: number,
  totalPages: number,
  studentName: string
) {
  const marginX = 70;
  const contentW = 1100;
  const y = 1710;

  ctx.save();
  ctx.direction = 'rtl';

  // خط فاصل
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(marginX, y - 20);
  ctx.lineTo(marginX + contentW, y - 20);
  ctx.stroke();

  // نص التذييل
  ctx.font = 'bold 15px "Cairo", sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';
  ctx.fillText('منصة موسوعة الكنز التعليمية  •  إعداد وتوجيهات أ/ إسلام سعود', marginX + contentW, y);

  ctx.textAlign = 'center';
  ctx.fillText(`صفحة ${toEasternArabic(pageIndex + 1)} من ${toEasternArabic(totalPages)}`, marginX + contentW / 2, y);

  ctx.textAlign = 'left';
  ctx.fillText(`نسخة الطالب: ${studentName || 'طالب مسجل'}`, marginX, y);

  ctx.restore();
}

// المحرك الرئيسي لإنشاء وتنزيل ملف PDF كشكول الأخطاء مع العلامة المائية
async function generateMistakesNotebookPdf(
  mistakes: EnrichedMistakeItem[],
  studentName: string,
  studentPhone: string,
  subjectName: string,
  gradeName: string
): Promise<void> {
  if (!mistakes || mistakes.length === 0) return;

  // انتظار اكتمال تحميل الخطوط لضمان الجمالية
  if (document.fonts) {
    try {
      await document.fonts.ready;
    } catch (e) {}
  }

  const PAGE_WIDTH = 1240;
  const PAGE_HEIGHT = 1754;
  const MARGIN_X = 70;
  const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X; // 1100 px
  const FIRST_PAGE_START_Y = 225;
  const OTHER_PAGE_START_Y = 115;
  const FOOTER_Y = 1680;
  const MAX_USABLE_Y = FOOTER_Y - 20;

  // كانفاس مؤقت للقياس
  const scratchCanvas = document.createElement('canvas');
  scratchCanvas.width = PAGE_WIDTH;
  scratchCanvas.height = PAGE_HEIGHT;
  const scratchCtx = scratchCanvas.getContext('2d');
  if (!scratchCtx) throw new Error('فشل تهيئة كانفاس القياس للـ PDF');

  // قياس جميع البطاقات
  const measuredCards = mistakes.map((item, idx) => {
    return {
      item,
      originalIndex: idx,
      measure: measureMistakeCard(scratchCtx, item, CONTENT_WIDTH)
    };
  });

  // توزيع البطاقات على الصفحات
  interface PageAllocation {
    cards: typeof measuredCards;
  }
  const pages: PageAllocation[] = [];
  let currentPageCards: typeof measuredCards = [];
  let currentY = FIRST_PAGE_START_Y;

  for (const card of measuredCards) {
    const cardH = card.measure.cardHeight;

    if (currentPageCards.length > 0 && (currentY + cardH > MAX_USABLE_Y)) {
      pages.push({ cards: currentPageCards });
      currentPageCards = [card];
      currentY = OTHER_PAGE_START_Y + cardH + 25;
    } else {
      currentPageCards.push(card);
      currentY += cardH + 25;
    }
  }
  if (currentPageCards.length > 0) {
    pages.push({ cards: currentPageCards });
  }

  const totalPages = pages.length;

  // استيراد pdf-lib
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();

  // إنشاء الختم المائي المعتمد
  const watermarkDataUrl = createArabicWatermarkCanvas(studentName, studentPhone, subjectName, gradeName, false);
  const watermarkBytes = dataUrlToBytes(watermarkDataUrl);
  const watermarkImage = await pdfDoc.embedPng(watermarkBytes);

  // رسم كل صفحة وتصديرها
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = PAGE_WIDTH;
    pageCanvas.height = PAGE_HEIGHT;
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) continue;

    pageCtx.fillStyle = '#ffffff';
    pageCtx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    const isFirstPage = pIdx === 0;

    // رأس الصفحة
    drawPageHeader(pageCtx, isFirstPage, studentName, studentPhone, subjectName, gradeName, mistakes.length);

    // بطاقات الأسئلة
    let cardY = isFirstPage ? FIRST_PAGE_START_Y : OTHER_PAGE_START_Y;
    const pageCards = pages[pIdx].cards;

    for (const card of pageCards) {
      drawMistakeCard(pageCtx, card.item, card.measure, MARGIN_X, cardY, CONTENT_WIDTH, card.originalIndex);
      cardY += card.measure.cardHeight + 25;
    }

    // ذيل الصفحة
    drawPageFooter(pageCtx, pIdx, totalPages, studentName);

    // تحويل الكانفاس إلى JPG وإدراجه في الـ PDF
    const pageJpgUrl = pageCanvas.toDataURL('image/jpeg', 0.93);
    const pageJpgBytes = dataUrlToBytes(pageJpgUrl);
    const pageImage = await pdfDoc.embedJpg(pageJpgBytes);

    const pdfPage = pdfDoc.addPage([595.28, 841.89]);
    pdfPage.drawImage(pageImage, {
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89
    });

    // ختم العلامة المائية المتفق عليها في منتصف الصفحة
    const maxWmWidth = 595.28 * 0.90;
    const maxWmHeight = 841.89 * 0.85;
    const wmAspect = 1800 / 1350;
    let wmWidth = maxWmWidth;
    let wmHeight = wmWidth / wmAspect;
    if (wmHeight > maxWmHeight) {
      wmHeight = maxWmHeight;
      wmWidth = wmHeight * wmAspect;
    }
    const wmX = (595.28 - wmWidth) / 2;
    const wmY = (841.89 - wmHeight) / 2;

    pdfPage.drawImage(watermarkImage, {
      x: wmX,
      y: wmY,
      width: wmWidth,
      height: wmHeight,
      opacity: 0.85
    });
  }

  // تنزيل الملف
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);
  const safeName = (studentName || 'طالب').trim().replace(/[\s/\\:]+/g, '_');
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `كشكول_أهم_الأخطاء_أ_إسلام_سعود_${safeName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}

export const MistakesNotebookModal: React.FC<MistakesNotebookModalProps> = ({
  isOpen,
  onClose,
  permanentMistakes = [],
  mistakes = [],
  unitsData = [],
  essaySubmissions = [],
  isDarkMode = false,
  onDeleteMistake,
  onClearNotebook,
  studentName = '',
  studentPhone = '',
  subjectName = 'التاريخ',
  gradeName = '2 بكالوريا',
}) => {
  const [isFullScreen, setIsFullScreen] = useState<boolean>(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'mcq' | 'essay'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showMasteredOnly, setShowMasteredOnly] = useState<'all' | 'unmastered' | 'mastered'>('all');
  
  // حفظ الأسئلة المستوعبة محلياً
  const [masteredHashes, setMasteredHashes] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(MASTERED_MISTAKES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  const toggleMastered = (hash: string) => {
    setMasteredHashes(prev => {
      const updated = prev.includes(hash) ? prev.filter(h => h !== hash) : [...prev, hash];
      try {
        localStorage.setItem(MASTERED_MISTAKES_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // تجميع وربط كافة الأخطاء (سواء من السجل الدائم أو بنك الأخطاء أو المقالي)
  const enrichedMistakes = useMemo<EnrichedMistakeItem[]>(() => {
    const list: EnrichedMistakeItem[] = [];
    const seenQuestionHashes = new Set<string>();

    // 1. أولاً: الأخطاء المسجلة في كشكول الأخطاء الدائم (الأعلى أولوية ودقة)
    if (Array.isArray(permanentMistakes)) {
      permanentMistakes.forEach(pm => {
        if (!pm || !pm.question || !pm.question.q) return;
        const qHash = simpleHash(pm.question.q || pm.id);
        if (seenQuestionHashes.has(qHash)) return;
        seenQuestionHashes.add(qHash);

        // استنتاج الوحدة والدرس إن لم يكونا محددين بدقة
        let uTitle = pm.unitTitle || 'الوحدة العامة';
        let uId = pm.unitId || 'general';
        let lTitle = pm.lessonTitle || 'مراجعة المنهج';
        let lId = pm.lessonId || 'general_lesson';

        if (uId === 'general' || !uTitle) {
          if (Array.isArray(unitsData)) {
            for (const u of unitsData) {
              if (!u || !Array.isArray(u.lessons)) continue;
              for (const l of u.lessons) {
                if (!l || !Array.isArray(l.questions)) continue;
                if (l.questions.some(item => item && (simpleHash(item.q) === qHash || item.q === pm.question.q))) {
                  uTitle = u.title;
                  uId = u.id;
                  lTitle = l.title;
                  lId = l.id;
                  break;
                }
              }
            }
          }
        }

        // تحديد الإجابة النموذجية الصحيحة بدقة
        let modelAns = pm.modelAnswer || pm.question.correct || pm.question.answer || '';
        if (!pm.isEssay && pm.question.options && pm.question.options.length > 0) {
          const matchingOpt = pm.question.options.find(opt => isOptionCorrect(opt, pm.question.correct));
          if (matchingOpt) modelAns = matchingOpt;
        }

        // استخراج الإجابة النموذجية المعتمدة لأسئلة المقال أو عند فراغ الحقل
        if (!modelAns || modelAns.includes('راجع التفسير') || pm.isEssay || pm.question.type === 'essay') {
          if (pm.question.reason && pm.question.reason.trim() && !pm.question.reason.includes('لم يتم الإجابة')) {
            modelAns = pm.question.reason.trim();
          } else {
            const resolved = resolveModelAnswer(pm.question.q, lTitle, lId, undefined, unitsData);
            if (resolved && resolved.modelAnswer) {
              modelAns = resolved.modelAnswer;
            } else if (pm.reason && pm.reason.trim() && !pm.reason.includes('لم يتم الإجابة')) {
              modelAns = pm.reason.trim();
            }
          }
        }

        list.push({
          id: pm.id || `nb_${qHash}`,
          question: pm.question,
          unitId: uId,
          unitTitle: uTitle,
          lessonId: lId,
          lessonTitle: lTitle,
          studentAnswerText: pm.studentAnswerText || pm.studentSelectedOption,
          studentSelectedOption: pm.studentSelectedOption,
          modelAnswer: modelAns,
          reason: pm.reason || pm.question.reason || '',
          concept: pm.concept || pm.question.concept || pm.question.paragraph || '',
          isEssay: pm.isEssay || pm.question.type === 'essay',
          essayType: pm.essayType || pm.question.essayType,
          teacherScore: pm.teacherScore,
          maxScore: pm.maxScore || pm.question.maxScore,
          teacherFeedback: pm.teacherFeedback,
          timestamp: pm.timestamp
        });
      });
    }

    // 2. ثانياً: أخطاء بنك الأسئلة المباشر إن وُجدت ولم تُسجل بعد
    if (Array.isArray(mistakes)) {
      mistakes.forEach(q => {
        if (!q || !q.q) return;
        const qText = q.q || '';
        const qHash = simpleHash(qText);
        if (seenQuestionHashes.has(qHash)) return;
        seenQuestionHashes.add(qHash);

        let foundUnitTitle = 'الوحدة الدراسية';
        let foundUnitId = 'general';
        let foundLessonTitle = 'اختبار تدريبي';
        let foundLessonId = 'general_lesson';

        if (Array.isArray(unitsData)) {
          for (const u of unitsData) {
            if (!u || !Array.isArray(u.lessons)) continue;
            for (const l of u.lessons) {
              if (!l || !Array.isArray(l.questions)) continue;
              if (l.questions.some(item => item && (simpleHash(item.q) === qHash || item.q === qText))) {
                foundUnitTitle = u.title;
                foundUnitId = u.id;
                foundLessonTitle = l.title;
                foundLessonId = l.id;
                break;
              }
            }
          }
        }

        let modelAns = q.correct || q.answer || '';
        if (q.type !== 'essay' && q.options && q.options.length > 0) {
          const matchingOpt = q.options.find(opt => isOptionCorrect(opt, q.correct));
          if (matchingOpt) modelAns = matchingOpt;
        }

        // استخراج الإجابة النموذجية المعتمدة لأسئلة المقال أو عند فراغ الحقل
        if (!modelAns || modelAns.includes('راجع التفسير') || q.type === 'essay') {
          if (q.reason && q.reason.trim() && !q.reason.includes('لم يتم الإجابة')) {
            modelAns = q.reason.trim();
          } else {
            const resolved = resolveModelAnswer(q.q, foundLessonTitle, foundLessonId, undefined, unitsData);
            if (resolved && resolved.modelAnswer) {
              modelAns = resolved.modelAnswer;
            }
          }
        }

        list.push({
          id: `m_${qHash}`,
          question: q,
          unitId: foundUnitId,
          unitTitle: foundUnitTitle,
          lessonId: foundLessonId,
          lessonTitle: foundLessonTitle,
          modelAnswer: modelAns,
          reason: q.reason || '',
          concept: q.concept || q.paragraph || '',
          isEssay: q.type === 'essay',
          essayType: q.essayType || (q.type === 'essay' ? 'سؤال مقالي' : undefined),
        });
      });
    }

    // 3. ثالثاً: الأسئلة المقالية المسجلة في تسليمات الطالب
    if (Array.isArray(essaySubmissions)) {
      essaySubmissions.forEach(sub => {
        if (!sub || !sub.isFullyApproved || !Array.isArray(sub.questions)) return;
        sub.questions.forEach(eq => {
          if (!eq || !eq.questionText) return;
          const qHash = simpleHash(eq.questionText);
          const isNotFullScore = eq.teacherScore !== undefined && eq.teacherScore < eq.maxScore;
          
          let foundUnitTitle = 'الوحدة';
          let foundUnitId = 'general';
          if (Array.isArray(unitsData)) {
            for (const u of unitsData) {
              if (!u || !Array.isArray(u.lessons)) continue;
              if (u.lessons.some(l => l && (l.id === sub.lessonId || l.title === sub.quizTitle))) {
                foundUnitTitle = u.title;
                foundUnitId = u.id;
                break;
              }
            }
          }

          const resolved = resolveModelAnswer(eq.questionText, sub.quizTitle, sub.lessonId, undefined, unitsData);
          const accurateModelAns = (eq.modelAnswer && !eq.modelAnswer.includes('راجع التفسير'))
            ? eq.modelAnswer
            : (resolved.modelAnswer || eq.modelAnswer || '');

          const existingIdx = list.findIndex(item => item.question && item.question.q === eq.questionText);
          if (existingIdx !== -1) {
            list[existingIdx].studentAnswerText = eq.studentText;
            list[existingIdx].teacherScore = eq.teacherScore;
            list[existingIdx].maxScore = eq.maxScore;
            list[existingIdx].teacherFeedback = eq.teacherFeedback || eq.aiFeedback;
            if (accurateModelAns && (!list[existingIdx].modelAnswer || list[existingIdx].modelAnswer.includes('راجع التفسير'))) {
              list[existingIdx].modelAnswer = accurateModelAns;
            }
          } else if (isNotFullScore && eq.isApproved) {
            if (!seenQuestionHashes.has(qHash)) {
              seenQuestionHashes.add(qHash);
              list.push({
                id: `sub_m_${qHash}`,
                question: {
                  type: 'essay',
                  q: eq.questionText,
                  options: [],
                  correct: accurateModelAns,
                  reason: accurateModelAns,
                  answer: accurateModelAns,
                  concept: '',
                  paragraph: '',
                  section: '',
                  essayType: eq.essayType,
                  maxScore: eq.maxScore,
                },
                unitId: foundUnitId,
                unitTitle: foundUnitTitle,
                lessonId: sub.lessonId,
                lessonTitle: sub.quizTitle,
                studentAnswerText: eq.studentText,
                modelAnswer: accurateModelAns,
                isEssay: true,
                essayType: eq.essayType,
                teacherScore: eq.teacherScore,
                maxScore: eq.maxScore,
                teacherFeedback: eq.teacherFeedback || eq.aiFeedback,
              });
            }
          }
        });
      });
    }

    return list;
  }, [permanentMistakes, mistakes, unitsData, essaySubmissions]);

  // استخراج قائمة الوحدات المتاحة التي تحتوي على أخطاء
  const availableUnits = useMemo(() => {
    const unitMap = new Map<string, { id: string; title: string; count: number }>();
    enrichedMistakes.forEach(item => {
      const existing = unitMap.get(item.unitId);
      if (existing) {
        existing.count++;
      } else {
        unitMap.set(item.unitId, { id: item.unitId, title: item.unitTitle, count: 1 });
      }
    });
    return Array.from(unitMap.values());
  }, [enrichedMistakes]);

  // استخراج قائمة الدروس التابعة للوحدة المحددة
  const availableLessons = useMemo(() => {
    if (selectedUnitId === 'all') return [];
    const lessonMap = new Map<string, { id: string; title: string; count: number }>();
    enrichedMistakes
      .filter(item => item.unitId === selectedUnitId)
      .forEach(item => {
        const existing = lessonMap.get(item.lessonId);
        if (existing) {
          existing.count++;
        } else {
          lessonMap.set(item.lessonId, { id: item.lessonId, title: item.lessonTitle, count: 1 });
        }
      });
    return Array.from(lessonMap.values());
  }, [enrichedMistakes, selectedUnitId]);

  // الفلترة النهائية للأسئلة
  const filteredMistakes = useMemo(() => {
    return enrichedMistakes.filter(item => {
      // فلتر الوحدة
      if (selectedUnitId !== 'all' && item.unitId !== selectedUnitId) return false;

      // فلتر الدرس
      if (selectedLessonId !== 'all' && item.lessonId !== selectedLessonId) return false;

      // فلتر نوع السؤال
      if (typeFilter === 'essay' && !item.isEssay) return false;
      if (typeFilter === 'mcq' && item.isEssay) return false;

      // فلتر الإتقان
      const isMastered = masteredHashes.includes(simpleHash(item.question.q));
      if (showMasteredOnly === 'unmastered' && isMastered) return false;
      if (showMasteredOnly === 'mastered' && !isMastered) return false;

      // فلتر البحث النصي
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inQuestion = item.question.q.toLowerCase().includes(q);
        const inLesson = item.lessonTitle.toLowerCase().includes(q);
        const inUnit = item.unitTitle.toLowerCase().includes(q);
        const inConcept = (item.concept || '').toLowerCase().includes(q);
        const inAnswer = (item.modelAnswer || '').toLowerCase().includes(q);
        if (!inQuestion && !inLesson && !inUnit && !inConcept && !inAnswer) return false;
      }

      return true;
    });
  }, [enrichedMistakes, selectedUnitId, selectedLessonId, typeFilter, showMasteredOnly, searchQuery, masteredHashes]);

  // إحصائيات سريعة
  const stats = useMemo(() => {
    const total = enrichedMistakes.length;
    const mastered = enrichedMistakes.filter(m => masteredHashes.includes(simpleHash(m.question.q))).length;
    const essays = enrichedMistakes.filter(m => m.isEssay).length;
    const mcqs = total - essays;
    return { total, mastered, essays, mcqs };
  }, [enrichedMistakes, masteredHashes]);

  // تصدير كشكول الأخطاء كملف PDF
  const handleDownloadPdf = async () => {
    if (filteredMistakes.length === 0 || isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    try {
      await generateMistakesNotebookPdf(
        filteredMistakes,
        studentName || 'طالب موسوعة الكنز',
        studentPhone || '',
        subjectName || 'التاريخ',
        gradeName || '2 بكالوريا'
      );
    } catch (err) {
      console.error('Error generating mistakes PDF:', err);
      alert('حدث خطأ أثناء إنشاء وتنزيل ملف الـ PDF، يرجى المحاولة مرة أخرى.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className={`fixed inset-0 z-[100] flex ${
        isFullScreen ? 'p-0 w-screen h-screen' : 'items-center justify-center p-0 sm:p-4'
      } bg-slate-950/80 backdrop-blur-md animate-fade-in`} 
      dir="rtl"
    >
      <div 
        className={`w-full flex flex-col overflow-hidden relative shadow-2xl transition-all ${
          isFullScreen 
            ? 'h-full max-w-none max-h-none rounded-none border-0' 
            : 'max-w-6xl h-full sm:h-[92vh] sm:max-h-[880px] rounded-none sm:rounded-3xl border-0 sm:border'
        } ${
          isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-purple-200 text-slate-900'
        }`}
      >
        {/* ===================== العلامة المائية الشاملة داخل الكشكول (Overlay واضح وخفيف ومريح فوق البطاقات) ===================== */}
        {/* 1. العلامة المركزية الكبرى: موسوعة / الكنز / أ. إسلام سعود */}
        <div className="absolute inset-0 pointer-events-none z-[25] flex flex-col items-center justify-center select-none text-center px-4 overflow-hidden">
          <div className={`text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-wider leading-none select-none drop-shadow-sm ${
            isDarkMode ? 'text-amber-300/10' : 'text-amber-500/11'
          }`}>
            موسوعة
          </div>
          <div className={`text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-wider leading-none mt-2 sm:mt-3 select-none ${
            isDarkMode ? 'text-blue-300/10' : 'text-blue-900/11'
          }`}>
            الكنز
          </div>
          <div className={`text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-wide mt-3 sm:mt-5 select-none ${
            isDarkMode ? 'text-pink-400/10' : 'text-pink-700/11'
          }`}>
            أ/ إسلام سعود
          </div>
        </div>

        {/* 2. تكرار مائل لكامل الكشكول باسم ورقم الطالب بتدرج مخفف ومريح */}
        <div 
          className="absolute inset-0 pointer-events-none z-[26] overflow-hidden select-none opacity-[0.06] dark:opacity-[0.08]"
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='280' height='155' viewBox='0 0 280 155'><g transform='rotate(-25 140 77)'><text x='140' y='60' fill='${isDarkMode ? '%23ffffff' : '%230f172a'}' font-family='Cairo, sans-serif' font-size='18' font-weight='900' text-anchor='middle'>${encodeURIComponent(studentName || 'طالب موسوعة الكنز')}</text><text x='140' y='92' fill='${isDarkMode ? '%23ffffff' : '%230f172a'}' font-family='Cairo, sans-serif' font-size='16.5' font-weight='800' text-anchor='middle'>${encodeURIComponent(studentPhone || 'أ/ إسلام سعود')}</text></g></svg>")`,
            backgroundRepeat: 'repeat'
          }}
        />

        {/* ===================== رأس النافذة ===================== */}
        <div className="p-3 sm:p-5 border-b border-purple-100 dark:border-slate-800 bg-gradient-to-r from-purple-50 via-indigo-50/50 to-white dark:from-slate-900 dark:via-purple-950/30 dark:to-slate-900 shrink-0 relative z-10">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-purple-600 text-white flex items-center justify-center text-sm sm:text-2xl shadow-md shadow-purple-600/30 shrink-0">
                <i className="fas fa-book-bookmark"></i>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-2xl font-black text-purple-950 dark:text-purple-100 flex items-center gap-1.5 truncate">
                  <span className="truncate">كشكول الأخطاء والنموذج المعتمد</span>
                  <span className="text-base sm:text-xl">📚</span>
                </h2>
                <p className="hidden sm:block text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  مرجعك الدائم للمراجعة الشاملة لجميع الأسئلة مع نماذج الإجابة وتوجيهات أ/ إسلام سعود
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* زر تنزيل PDF عالي الجودة مع العلامة المائية */}
              <button
                onClick={handleDownloadPdf}
                disabled={isGeneratingPdf || filteredMistakes.length === 0}
                className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-black text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-600/25 transition-all cursor-pointer active:scale-95 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                title="تنزيل كشكول الأخطاء المعروض كملف PDF مع العلامة المائية الرسمية"
              >
                {isGeneratingPdf ? (
                  <>
                    <i className="fas fa-spinner fa-spin text-xs"></i>
                    <span className="hidden sm:inline">جاري التجهيز...</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-file-pdf text-xs sm:text-sm"></i>
                    <span className="hidden sm:inline">تنزيل PDF ({toEasternArabic(filteredMistakes.length)}) 📥</span>
                    <span className="sm:hidden font-black">PDF ({toEasternArabic(filteredMistakes.length)})</span>
                  </>
                )}
              </button>

              {onClearNotebook && stats.total > 0 && (
                <button
                  onClick={onClearNotebook}
                  className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl text-xs font-black text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 dark:border-rose-900/60 dark:bg-rose-950/30 transition-all cursor-pointer shadow-xs active:scale-95 flex items-center gap-1"
                  title="مسح الكشكول والبدء من جديد"
                >
                  <i className="fas fa-trash-alt text-xs"></i>
                  <span className="hidden sm:inline">تفريغ</span>
                </button>
              )}

              {/* زر تكبير / تصغير ملء الشاشة */}
              <button
                onClick={() => setIsFullScreen(prev => !prev)}
                className="hidden sm:flex w-9 h-9 sm:w-10 sm:h-10 rounded-full items-center justify-center bg-slate-100 hover:bg-purple-100 dark:bg-slate-800 dark:hover:bg-purple-950/50 text-slate-600 dark:text-slate-300 hover:text-purple-600 transition-colors shadow-xs cursor-pointer"
                title={isFullScreen ? "تصغير النافذة" : "تكبير ملء الشاشة"}
              >
                <i className={`fas ${isFullScreen ? 'fa-compress' : 'fa-expand'} text-sm sm:text-base`}></i>
              </button>

              {/* زر إغلاق النافذة */}
              <button
                onClick={onClose}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 transition-colors shadow-sm cursor-pointer shrink-0"
                title="إغلاق"
              >
                <i className="fas fa-times text-sm sm:text-lg"></i>
              </button>
            </div>
          </div>

          {/* شارات الإحصائيات العلوية */}
          <div className="flex items-center gap-1.5 sm:gap-3 mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-purple-100/70 dark:border-slate-800/80 overflow-x-auto custom-scrollbar flex-nowrap pb-0.5">
            <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl bg-purple-100/90 dark:bg-purple-950/70 text-purple-900 dark:text-purple-200 text-[10px] sm:text-xs font-black flex items-center gap-1 shrink-0 whitespace-nowrap">
              <i className="fas fa-layer-group text-purple-600 text-[10px]"></i>
              <span>محفوظ: {toEasternArabic(stats.total)}</span>
            </span>

            <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl bg-emerald-100/90 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 text-[10px] sm:text-xs font-black flex items-center gap-1 shrink-0 whitespace-nowrap">
              <i className="fas fa-check-circle text-emerald-600 text-[10px]"></i>
              <span>متقن: {toEasternArabic(stats.mastered)}</span>
            </span>

            <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl bg-indigo-100/90 dark:bg-indigo-950/70 text-indigo-900 dark:text-indigo-200 text-[10px] sm:text-xs font-black flex items-center gap-1 shrink-0 whitespace-nowrap">
              <i className="fas fa-feather-alt text-indigo-600 text-[10px]"></i>
              <span>مقالي: {toEasternArabic(stats.essays)}</span>
            </span>

            <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl bg-blue-100/90 dark:bg-blue-950/70 text-blue-900 dark:text-blue-200 text-[10px] sm:text-xs font-black flex items-center gap-1 shrink-0 whitespace-nowrap">
              <i className="fas fa-list-check text-blue-600 text-[10px]"></i>
              <span>اختياري: {toEasternArabic(stats.mcqs)}</span>
            </span>
          </div>
        </div>

        {/* ===================== شريط التبويبات والفلترة المنظمة ===================== */}
        <div className="p-2 sm:p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-2 sm:space-y-3 shrink-0">
          {/* 1. تبويبات الوحدات الدراسية (مبوّبة) */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 custom-scrollbar whitespace-nowrap">
            <button
              onClick={() => {
                setSelectedUnitId('all');
                setSelectedLessonId('all');
              }}
              className={`px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 cursor-pointer ${
                selectedUnitId === 'all'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
              }`}
            >
              🌐 الكل ({toEasternArabic(stats.total)})
            </button>

            {availableUnits.map(unit => (
              <button
                key={unit.id}
                onClick={() => {
                  setSelectedUnitId(unit.id);
                  setSelectedLessonId('all');
                }}
                className={`px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-black transition-all shrink-0 cursor-pointer ${
                  selectedUnitId === unit.id
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                📂 {unit.title} ({toEasternArabic(unit.count)})
              </button>
            ))}
          </div>

          {/* 2. شريط الدروس المنسدلة التابعة للوحدة المحددة */}
          {selectedUnitId !== 'all' && availableLessons.length > 0 && (
            <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 pt-0.5 custom-scrollbar bg-purple-50/50 dark:bg-purple-950/20 p-1.5 sm:p-2 rounded-lg sm:rounded-xl border border-purple-100 dark:border-purple-900/40 whitespace-nowrap">
              <span className="text-[10px] sm:text-[11px] font-black text-purple-800 dark:text-purple-300 shrink-0">
                دروس الوحدة:
              </span>
              <button
                onClick={() => setSelectedLessonId('all')}
                className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg text-[10px] sm:text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                  selectedLessonId === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                كل دروس الوحدة
              </button>
              {availableLessons.map(lesson => (
                <button
                  key={lesson.id}
                  onClick={() => setSelectedLessonId(lesson.id)}
                  className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg text-[10px] sm:text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                    selectedLessonId === lesson.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  📝 {lesson.title} ({toEasternArabic(lesson.count)})
                </button>
              ))}
            </div>
          )}

          {/* 3. شريط البحث والفلترة حسب النوع والإتقان */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5 sm:gap-2.5">
            {/* خانة البحث */}
            <div className="relative w-full sm:flex-1 min-w-[140px]">
              <i className="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                placeholder="ابحث بنص السؤال أو المفهوم..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-8 pl-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg sm:rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-purple-500 transition-colors"
              />
            </div>

            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto w-full sm:w-auto pb-0.5 custom-scrollbar">
              {/* فلتر النوع */}
              <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 p-0.5 sm:p-1 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 text-[10px] sm:text-xs font-bold shrink-0">
                <button
                  onClick={() => setTypeFilter('all')}
                  className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg transition-colors cursor-pointer ${typeFilter === 'all' ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 font-black' : 'text-slate-500'}`}
                >
                  الكل
                </button>
                <button
                  onClick={() => setTypeFilter('mcq')}
                  className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg transition-colors cursor-pointer ${typeFilter === 'mcq' ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 font-black' : 'text-slate-500'}`}
                >
                  اختياري
                </button>
                <button
                  onClick={() => setTypeFilter('essay')}
                  className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg transition-colors cursor-pointer ${typeFilter === 'essay' ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 font-black' : 'text-slate-500'}`}
                >
                  مقالي 🪶
                </button>
              </div>

              {/* فلتر الإتقان */}
              <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 p-0.5 sm:p-1 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 text-[10px] sm:text-xs font-bold shrink-0">
                <button
                  onClick={() => setShowMasteredOnly('all')}
                  className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md sm:rounded-lg transition-colors cursor-pointer ${showMasteredOnly === 'all' ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-black' : 'text-slate-500'}`}
                >
                  الجميع
                </button>
                <button
                  onClick={() => setShowMasteredOnly('unmastered')}
                  className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md sm:rounded-lg transition-colors cursor-pointer ${showMasteredOnly === 'unmastered' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 font-black' : 'text-slate-500'}`}
                >
                  بانتظار الفهم ⏳
                </button>
                <button
                  onClick={() => setShowMasteredOnly('mastered')}
                  className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md sm:rounded-lg transition-colors cursor-pointer ${showMasteredOnly === 'mastered' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 font-black' : 'text-slate-500'}`}
                >
                  تم الإتقان ✅
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===================== محتوى بطاقات الأسئلة المنظمة ===================== */}
        <div className="p-2.5 sm:p-5 overflow-y-auto space-y-3 sm:space-y-4 flex-1 relative z-10 custom-scrollbar">
          {filteredMistakes.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
                <i className="fas fa-trophy"></i>
              </div>
              <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-200 mb-1">
                ما شاء الله! لا توجد أخطاء في هذا القسم
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                إما أنك أتقنت جميع الأسئلة أو لم تسجل أي أخطاء هنا. استمر في التميز والتفوق!
              </p>
            </div>
          ) : (
            filteredMistakes.map((item, idx) => {
              const qHash = simpleHash(item.question.q);
              const isMastered = masteredHashes.includes(qHash);

              // استخراج وتأكيد الإجابة النموذجية المعتمدة الحقيقية
              let displayModelAns = (item.modelAnswer && !item.modelAnswer.includes('راجع التفسير')) ? item.modelAnswer.trim() : '';
              if (!displayModelAns) {
                if (item.reason && !item.reason.includes('لم يتم الإجابة') && !item.reason.includes('راجع التفسير')) {
                  displayModelAns = item.reason.trim();
                } else {
                  const resolved = resolveModelAnswer(item.question.q, item.lessonTitle, item.lessonId, undefined, unitsData);
                  displayModelAns = resolved.modelAnswer || item.question.reason || '';
                }
              }
              if (!displayModelAns) {
                displayModelAns = 'نموذج الإجابة المعتمد قيد الاعتماد من المعلم.';
              }

              // توجيهات وشرح أ/ إسلام سعود
              const guidanceContent = item.teacherFeedback || (item.reason && item.reason.trim() !== displayModelAns.trim() ? item.reason : '');

              return (
                <div
                  key={item.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all shadow-sm backdrop-blur-xs ${
                    isMastered
                      ? 'bg-emerald-50/70 border-emerald-300/80 dark:bg-emerald-950/30 dark:border-emerald-800/60'
                      : isDarkMode
                      ? 'bg-slate-800/85 border-slate-700/90'
                      : 'bg-white/95 border-purple-100/90 hover:border-purple-300 shadow-purple-500/5'
                  }`}
                >
                  {/* شريط رأس البطاقة المبوّب (الوحدة • الدرس • النوع • أدوات الإتقان والحذف) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-100 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-black text-xs flex items-center justify-center">
                        {toEasternArabic(idx + 1)}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        📁 {item.unitTitle}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/40">
                        📖 {item.lessonTitle}
                      </span>
                      {item.isEssay ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300">
                          {item.essayType || 'سؤال مقالي'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                          اختياري / صح وخطأ
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* زر الإتقان السريع */}
                      <button
                        onClick={() => toggleMastered(qHash)}
                        className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95 ${
                          isMastered
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-800 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                        title={isMastered ? "تم استيعابه (اضغط للإلغاء)" : "اضغط لتعيين السؤال كـ تم استيعابه"}
                      >
                        <i className={`fas ${isMastered ? 'fa-check-circle' : 'fa-circle'}`}></i>
                        <span>{isMastered ? 'تم الاستيعاب والإتقان 🎯' : 'تحديد كـ تم الفهم'}</span>
                      </button>

                      {/* زر الحذف الفردي من الكشكول */}
                      {onDeleteMistake && (
                        <button
                          onClick={() => onDeleteMistake(item.id)}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 text-xs p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="حذف هذا السؤال من الكشكول"
                        >
                          <i className="fas fa-trash-alt"></i>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* نص السؤال المنسق بدقة بالغة */}
                  <div className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 mb-3.5 leading-relaxed bg-slate-50/60 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <FormatQuestionText text={item.question.q} concept={item.concept} isDarkMode={isDarkMode} />
                  </div>

                  {/* الخيارات في حالة الأسئلة الاختيارية أو الصح والخطأ */}
                  {!item.isEssay && item.question.options && item.question.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3.5">
                      {item.question.options.map((opt, optIdx) => {
                        const isCorrectOpt = isOptionCorrect(opt, item.question.correct);
                        const isStudentOpt = item.studentSelectedOption && (
                          opt.trim() === item.studentSelectedOption.trim() ||
                          isOptionCorrect(opt, item.studentSelectedOption)
                        );

                        return (
                          <div
                            key={optIdx}
                            className={`p-2.5 sm:p-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-between gap-2 transition-all ${
                              isCorrectOpt
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-950 dark:text-emerald-200 ring-2 ring-emerald-400/50'
                                : isStudentOpt
                                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 text-rose-950 dark:text-rose-200'
                                : 'bg-white dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <span className="flex-1 leading-relaxed">{opt}</span>
                            {isCorrectOpt && (
                              <span className="shrink-0 text-[10px] sm:text-xs font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                                <i className="fas fa-check"></i> الإجابة النموذجية
                              </span>
                            )}
                            {!isCorrectOpt && isStudentOpt && (
                              <span className="shrink-0 text-[10px] sm:text-xs font-black bg-rose-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                                <i className="fas fa-times"></i> إجابتك السابقة
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* المفهوم أو الفقرة المرتبطة في المنهج */}
                  {item.concept && (
                    <div className="mb-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <i className="fas fa-bookmark text-amber-500"></i>
                      <span>المرجع في المنهج: {item.concept}</span>
                    </div>
                  )}

                  {/* إذا كان مقالياً: إجابة الطالب المسجلة وتفاصيل التقييم */}
                  {item.isEssay && item.studentAnswerText && (
                    <div className="mb-3 p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-black text-rose-700 dark:text-rose-400">
                          ✍️ إجابتك المسجلة:
                        </span>
                        {item.teacherScore !== undefined && item.maxScore !== undefined && (
                          <span className="text-xs font-black px-2 py-0.5 rounded-md bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100">
                            الدرجة: {toEasternArabic(item.teacherScore)} / {toEasternArabic(item.maxScore)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                        {item.studentAnswerText}
                      </p>
                    </div>
                  )}

                  {/* نموذج الإجابة المعتمد والصحيح (القلب النابض للكشكول) */}
                  <div className="mb-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                    <span className="block text-[11px] font-black text-emerald-800 dark:text-emerald-300 mb-1 flex items-center gap-1.5">
                      <i className="fas fa-check-circle text-emerald-600"></i>
                      <span>نموذج الإجابة المعتمد والصحيح:</span>
                    </span>
                    <div className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200 leading-relaxed whitespace-pre-line">
                      <HighlightText text={displayModelAns} isDarkMode={false} />
                    </div>
                  </div>

                  {/* توجيهات أ/ إسلام سعود (بدون كلمة المعلم) */}
                  {guidanceContent && (
                    <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-50/80 to-yellow-50/80 dark:from-amber-950/20 dark:to-yellow-950/20 border border-amber-200 dark:border-amber-800/40">
                      <span className="block text-[11px] font-black text-amber-900 dark:text-amber-300 mb-1 flex items-center gap-1.5">
                        <i className="fas fa-chalkboard-teacher text-amber-600"></i>
                        <span>توجيهات أ/ إسلام سعود:</span>
                      </span>
                      <div className="text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-100 leading-relaxed whitespace-pre-line">
                        <HighlightText text={guidanceContent} concept={item.concept} isDarkMode={false} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ===================== ذيل النافذة ===================== */}
        <div className="p-2 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-2 shrink-0 relative z-10">
          <span className="text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400">
            معروض: {toEasternArabic(filteredMistakes.length)} من {toEasternArabic(stats.total)}
          </span>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf || filteredMistakes.length === 0}
              className="py-1.5 px-2.5 sm:py-2 sm:px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              title="تنزيل كشكول الأخطاء كملف PDF مع العلامة المائية"
            >
              {isGeneratingPdf ? (
                <>
                  <i className="fas fa-spinner fa-spin text-xs"></i>
                  <span className="hidden sm:inline">جاري التجهيز...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-file-pdf text-xs"></i>
                  <span className="hidden sm:inline">تحميل كشكول الأخطاء PDF 📥</span>
                  <span className="sm:hidden font-bold">تحميل PDF 📥</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="py-1.5 px-3 sm:py-2 sm:px-6 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
