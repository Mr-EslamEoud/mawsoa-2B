import { GroupedResult, Student, Unit } from '../types';
import { toEasternArabic, detectArabicGender } from '../utils';

export interface GenerateReportOptions {
  student: GroupedResult;
  studentMeta?: Student | null;
  units: Unit[];
  allValidLessons: string[];
  lessonFirstScoreMap: Record<string, number>;
  isStudentOnline: boolean;
  selectedUnitId?: string; // 'all' or unit id
  avgScore: number;
  maxScore: number;
  minScore: number;
  isHonorRoll: boolean;
  missingHonorLessonsCount: number;
}

// رسم مستطيل بحواف دائرية مع دعم التوافقية لجميع المتصفحات
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | number[]
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  } else {
    const r = typeof radius === 'number' ? radius : (radius[0] || 8);
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
  }
}

// رسم ختم رسمي دائري معتمد
function drawOfficialSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  
  // خلفية الختم المزدوجة
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#c59b27';
  ctx.stroke();

  // دائرة داخلية مسننة / منقطة
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#0f274a';
  ctx.stroke();
  ctx.setLineDash([]);

  // دائرة داخلية مصمتة
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 13, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#c59b27';
  ctx.stroke();

  // نصوص الختم المركزي
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  ctx.fillStyle = '#0f274a';
  ctx.font = 'black 10px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('★ منصة الكنز التعليمية ★', cx, cy - 24);

  ctx.fillStyle = '#c59b27';
  ctx.font = 'black 14px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('مُعتمد رسمياً', cx, cy - 8);

  ctx.fillStyle = '#0f274a';
  ctx.font = 'bold 11px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('أ/ إسلام سعود', cx, cy + 9);

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 9px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('العام الدراسي ٢٠٢٦ / ٢٠٢٧', cx, cy + 24);

  ctx.restore();
}

export async function generateStudentReportImage(options: GenerateReportOptions): Promise<string> {
  const {
    student,
    studentMeta,
    units,
    lessonFirstScoreMap,
    isStudentOnline,
    selectedUnitId = 'all',
    avgScore,
    maxScore,
    minScore,
    isHonorRoll,
    missingHonorLessonsCount
  } = options;

  const isSingleUnit = selectedUnitId !== 'all';
  const targetUnit = isSingleUnit
    ? units.find(u => u.id === selectedUnitId || u.title === selectedUnitId) || units[0]
    : null;

  const unitsToRender = targetUnit ? [targetUnit] : units;

  const width = 1240;

  // إحصائيات الدروس في نطاق التقرير
  const flatLessonsToRender = unitsToRender.flatMap(u => (u.lessons || []).map(l => ({ ...l, unitTitle: u.title })));
  const totalLessonsInReport = flatLessonsToRender.length;
  const solvedLessonsInReport = flatLessonsToRender.filter(l => lessonFirstScoreMap[l.title] !== undefined);
  const solvedCount = solvedLessonsInReport.length;
  const completionRate = totalLessonsInReport > 0 ? Math.round((solvedCount / totalLessonsInReport) * 100) : 0;

  // أبعاد الأقسام الرئيسية
  const topPadding = 35;
  const headerHeight = 180;
  const profileCardHeight = 115;
  const kpiSectionHeight = 120;
  const sectionTitleHeight = 50;
  const tableHeaderHeight = 44;
  const tableRowHeight = 42;
  const unitDividerHeight = isSingleUnit ? 0 : 36;
  const adviceBoxHeight = 105;
  const footerHeight = 150;
  const spacing = 16;

  // حساب الارتفاع الإجمالي للكانفاس بناءً على عدد الصفوف والوحدات
  const tableRowsCount = totalLessonsInReport;
  const unitDividersCount = isSingleUnit ? 0 : unitsToRender.length;
  
  const totalTableHeight = tableHeaderHeight + (tableRowsCount * tableRowHeight) + (unitDividersCount * unitDividerHeight);

  const calculatedHeight = 
    topPadding +
    headerHeight + spacing +
    profileCardHeight + spacing +
    kpiSectionHeight + spacing +
    sectionTitleHeight +
    totalTableHeight + spacing +
    adviceBoxHeight + spacing +
    footerHeight +
    40;

  const height = Math.max(1300, calculatedHeight);

  // إنشاء الكانفاس
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';

  // 1. خلفية الوثيقة الفاخرة
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#fdfefe');
  bgGrad.addColorStop(0.5, '#ffffff');
  bgGrad.addColorStop(1, '#f8fafc');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // إطار خارجي مذهب ملكي مزدوج
  ctx.strokeStyle = '#c59b27';
  ctx.lineWidth = 5;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.strokeStyle = '#0f274a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  // علامات مائية خفيفة وأنيقة في الخلفية
  ctx.save();
  ctx.rotate(-22 * Math.PI / 180);
  ctx.font = 'bold 32px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillStyle = 'rgba(15, 39, 74, 0.025)';
  ctx.textAlign = 'center';
  for (let x = -800; x < width + 800; x += 420) {
    for (let y = -400; y < height + 800; y += 170) {
      ctx.fillText('موسوعة الكنز التعليمية • أ/ إسلام سعود', x, y);
    }
  }
  ctx.restore();

  let currentY = topPadding;

  // 2. ترويسة التقرير الرسمية بنمط الوثائق الأكاديمية (Header)
  const headerCardGrad = ctx.createLinearGradient(35, currentY, width - 35, currentY + headerHeight);
  headerCardGrad.addColorStop(0, '#061733');
  headerCardGrad.addColorStop(0.5, '#0c2e5e');
  headerCardGrad.addColorStop(1, '#061733');

  drawRoundedRect(ctx, 35, currentY, width - 70, headerHeight, 18);
  ctx.fillStyle = headerCardGrad;
  ctx.fill();
  ctx.strokeStyle = '#c59b27';
  ctx.lineWidth = 2;
  ctx.stroke();

  // خط زخرفي ذهبي أعلى الترويسة
  const goldStripe = ctx.createLinearGradient(35, currentY, width - 35, currentY);
  goldStripe.addColorStop(0, 'rgba(197, 155, 39, 0)');
  goldStripe.addColorStop(0.5, 'rgba(197, 155, 39, 1)');
  goldStripe.addColorStop(1, 'rgba(197, 155, 39, 0)');
  ctx.fillStyle = goldStripe;
  ctx.fillRect(80, currentY + 3, width - 160, 4);

  // الترويسة العلوية المصغرة
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('جمهورية مصر العربية • منصة الكنز التعليمية المتخصصة في التاريخ والجغرافيا', width / 2, currentY + 28);

  // عنوان المنصة الرئيسي
  ctx.fillStyle = '#fde047';
  ctx.font = 'black 32px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('✨ موسوعة الكنز التعليمية ✨', width / 2, currentY + 65);

  // اسم المعلم ورتبته
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('إشراف وخبرة: الأستاذ إسلام سعود', width / 2, currentY + 102);

  // شريط اسم الوثيقة الرسمي بناءً على اختيار المعلم
  const docTitleText = isSingleUnit && targetUnit
    ? `📋 كشف تقييم الأداء التفصيلي والدرجات في: (${targetUnit.title})`
    : '📑 كشف الدرجات الشامل والتقييم الأكاديمي لجميع الوحدات والدروس';

  drawRoundedRect(ctx, width / 2 - 380, currentY + 128, 760, 38, 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(253, 224, 71, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#fef08a';
  ctx.font = 'bold 16px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(docTitleText, width / 2, currentY + 147);

  currentY += headerHeight + spacing;

  // 3. بطاقة بيانات الطالب الرسمية (Student Credentials Box)
  drawRoundedRect(ctx, 35, currentY, width - 70, profileCardHeight, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const gender = detectArabicGender(student.name, studentMeta?.gender);
  const isFemale = gender === 'female';

  // شريط ملون جانبي
  ctx.fillStyle = isFemale ? '#ec4899' : '#1d4ed8';
  drawRoundedRect(ctx, width - 45, currentY, 10, profileCardHeight, [14, 0, 0, 14]);
  ctx.fill();

  // أيقونة الطالب
  drawRoundedRect(ctx, width - 125, currentY + 18, 70, 78, 14);
  ctx.fillStyle = isFemale ? '#fdf2f8' : '#eff6ff';
  ctx.fill();
  ctx.strokeStyle = isFemale ? '#fbcfe8' : '#bfdbfe';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '36px "Segoe UI Emoji", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(isFemale ? '👧' : '👦', width - 90, currentY + 57);

  // اسم الطالب
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'black 26px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(student.name, width - 145, currentY + 38);

  // شارات الطالب الأكاديمية
  let badgeX = width - 145;
  const badgeY = currentY + 78;

  // شارة النوع
  drawRoundedRect(ctx, badgeX - 85, badgeY - 13, 85, 26, 7);
  ctx.fillStyle = isFemale ? '#fce7f3' : '#dbeafe';
  ctx.fill();
  ctx.fillStyle = isFemale ? '#be185d' : '#1d4ed8';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isFemale ? '👧 أنثى' : '👦 ذكر', badgeX - 42, badgeY);
  badgeX -= 95;

  // شارة الفئة (سنتر / أونلاين)
  drawRoundedRect(ctx, badgeX - 95, badgeY - 13, 95, 26, 7);
  ctx.fillStyle = isStudentOnline ? '#dcfce7' : '#fef3c7';
  ctx.fill();
  ctx.fillStyle = isStudentOnline ? '#15803d' : '#b45309';
  ctx.fillText(isStudentOnline ? '🌐 أونلاين' : '🏫 سنتر', badgeX - 47, badgeY);
  badgeX -= 105;

  // كود الطالب إن وجد
  if (studentMeta?.code) {
    drawRoundedRect(ctx, badgeX - 110, badgeY - 13, 110, 26, 7);
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.fillText(`كود: ${studentMeta.code}`, badgeX - 55, badgeY);
  }

  // الجانب الأيسر: رقم الهاتف وتاريخ الإصدار ونوع التقرير
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 16px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`📞 رقم الهاتف: ${student.phone || '---'}`, 55, currentY + 38);

  const reportDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillStyle = '#64748b';
  ctx.font = '13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`📅 تاريخ الإصدار: ${reportDateStr}`, 55, currentY + 70);

  ctx.fillStyle = '#2563eb';
  ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`🎯 نطاق التقرير: ${isSingleUnit && targetUnit ? targetUnit.title : 'شامل جميع الوحدات'}`, 55, currentY + 95);

  currentY += profileCardHeight + spacing;

  // 4. بطاقات المؤشرات الأكاديمية الذكية (KPI Summary Cards)
  const kpiBoxWidth = (width - 70 - 45) / 4;
  const kpiY = currentY;

  // كارت 1: الاختبارات ونسبة الحل
  drawRoundedRect(ctx, width - 35 - kpiBoxWidth, kpiY, kpiBoxWidth, kpiSectionHeight, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(isSingleUnit ? 'دروس الوحدة المنجزة' : 'الاختبارات المنجزة', width - 52, kpiY + 26);
  
  ctx.fillStyle = '#0f172a';
  ctx.font = 'black 26px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`${toEasternArabic(solvedCount)} / ${toEasternArabic(totalLessonsInReport)}`, width - 52, kpiY + 60);

  ctx.fillStyle = completionRate === 100 ? '#15803d' : '#64748b';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`نسبة الإنجاز: ${toEasternArabic(completionRate)}٪ ${completionRate === 100 ? '✅ مكتمل' : ''}`, width - 52, kpiY + 95);

  // كارت 2: المعدل العام للدرجات
  const kpi2X = width - 35 - kpiBoxWidth * 2 - 15;
  drawRoundedRect(ctx, kpi2X, kpiY, kpiBoxWidth, kpiSectionHeight, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(isSingleUnit ? 'متوسط درجات الوحدة' : 'المعدل العام للدرجات', kpi2X + kpiBoxWidth - 18, kpiY + 26);

  ctx.fillStyle = avgScore >= 85 ? '#15803d' : avgScore >= 65 ? '#1d4ed8' : avgScore > 0 ? '#ea580c' : '#94a3b8';
  ctx.font = 'black 28px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`${toEasternArabic(avgScore)}٪`, kpi2X + kpiBoxWidth - 18, kpiY + 60);

  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  const gradeText = avgScore >= 85 ? 'ممتاز مرتفع ⭐' : avgScore >= 75 ? 'جيد جداً مرتفع' : avgScore >= 65 ? 'جيد جداً' : avgScore >= 50 ? 'يحتاج متابعة' : 'دون المستوى المطلوب';
  ctx.fillText(`التقدير: ${avgScore > 0 ? gradeText : 'لم يختبر'}`, kpi2X + kpiBoxWidth - 18, kpiY + 95);

  // كارت 3: أعلى وأدنى درجة
  const kpi3X = width - 35 - kpiBoxWidth * 3 - 30;
  drawRoundedRect(ctx, kpi3X, kpiY, kpiBoxWidth, kpiSectionHeight, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('الدرجات القياسية', kpi3X + kpiBoxWidth - 18, kpiY + 26);

  ctx.fillStyle = '#15803d';
  ctx.font = 'bold 15px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`أعلى درجة: ${toEasternArabic(maxScore)}٪ 🏆`, kpi3X + kpiBoxWidth - 18, kpiY + 58);

  ctx.fillStyle = '#dc2626';
  ctx.font = 'bold 14px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(`أدنى درجة: ${toEasternArabic(minScore)}٪`, kpi3X + kpiBoxWidth - 18, kpiY + 90);

  // كارت 4: التقييم والاعتماد
  const kpi4X = 35;
  drawRoundedRect(ctx, kpi4X, kpiY, kpiBoxWidth, kpiSectionHeight, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(isSingleUnit ? 'حالة إتقان الوحدة' : 'لوحة الشرف والتكريم', kpi4X + kpiBoxWidth - 18, kpiY + 26);

  if (isSingleUnit) {
    const isUnitMastered = completionRate === 100 && avgScore >= 80;
    ctx.fillStyle = isUnitMastered ? '#15803d' : completionRate === 100 ? '#1d4ed8' : '#d97706';
    ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(isUnitMastered ? 'وحدة متقنة 🎯' : completionRate === 100 ? 'تم إنهاء الوحدة' : 'قيد الإكمال ⏳', kpi4X + kpiBoxWidth - 18, kpiY + 60);

    ctx.fillStyle = '#64748b';
    ctx.font = '12px "Cairo", "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(isUnitMastered ? 'جاهز للامتحان الشامل' : `متبقي ${toEasternArabic(totalLessonsInReport - solvedCount)} دروس`, kpi4X + kpiBoxWidth - 18, kpiY + 95);
  } else {
    ctx.fillStyle = isHonorRoll ? '#15803d' : '#d97706';
    ctx.font = 'bold 18px "Cairo", "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(isHonorRoll ? 'مؤهل بامتياز 🏆' : `نواقص: ${toEasternArabic(missingHonorLessonsCount)} دروس`, kpi4X + kpiBoxWidth - 18, kpiY + 60);

    ctx.fillStyle = '#64748b';
    ctx.font = '12px "Cairo", "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(isHonorRoll ? 'أتم كافة متطلبات التكريم' : 'مطلوب إكمال المنهج', kpi4X + kpiBoxWidth - 18, kpiY + 95);
  }

  currentY += kpiSectionHeight + spacing;

  // 5. عنوان جدول الدرجات التفصيلي الرسمي
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'black 22px "Cairo", "Segoe UI", Tahoma, sans-serif';
  const tableTitle = isSingleUnit && targetUnit
    ? `📊 جدول تفاصيل درجات واختبارات (${targetUnit.title}):`
    : '📊 جدول تفاصيل درجات واختبارات كافة وحدات ودروس المنهج:';
  ctx.fillText(tableTitle, width - 35, currentY + 20);

  currentY += sectionTitleHeight;

  // 6. رسم جدول الدرجات الأكاديمي التفصيلي (Official Grade Sheet Table)
  const tableX = 35;
  const tableW = width - 70;

  // عرض الأعمدة الدقيق
  // الإجمالي = 1170px
  // م: 45px
  // اسم الدرس: 345px
  // الوحدة (إن كان شاملاً): 160px
  // النسبة: 100px
  // التقدير: 120px
  // حالة الإتقان: 140px
  // ملاحظات وتوجيه المعلم: 260px
  const colIndexW = 45;
  const colUnitW = isSingleUnit ? 0 : 160;
  const colLessonW = isSingleUnit ? 475 : 345;
  const colScoreW = 100;
  const colGradeW = 120;
  const colStatusW = 140;
  const colNotesW = 220;

  // ترويسة الجدول (Table Header)
  drawRoundedRect(ctx, tableX, currentY, tableW, tableHeaderHeight, [12, 12, 0, 0]);
  const thGrad = ctx.createLinearGradient(tableX, currentY, tableX + tableW, currentY + tableHeaderHeight);
  thGrad.addColorStop(0, '#0f274a');
  thGrad.addColorStop(1, '#1b3f73');
  ctx.fillStyle = thGrad;
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.textAlign = 'center';

  let headerCursorX = tableX + tableW;

  // عمود م
  headerCursorX -= colIndexW;
  ctx.fillText('م', headerCursorX + colIndexW / 2, currentY + tableHeaderHeight / 2);

  // عمود الوحدة (إن وجد)
  if (!isSingleUnit) {
    headerCursorX -= colUnitW;
    ctx.fillText('الوحدة الدراسية', headerCursorX + colUnitW / 2, currentY + tableHeaderHeight / 2);
  }

  // عمود اسم الدرس
  headerCursorX -= colLessonW;
  ctx.textAlign = 'right';
  ctx.fillText('اسم الدرس / موضوع الاختبار', headerCursorX + colLessonW - 15, currentY + tableHeaderHeight / 2);

  // عمود النتيجة المئوية
  headerCursorX -= colScoreW;
  ctx.textAlign = 'center';
  ctx.fillText('الدرجة / النسبة', headerCursorX + colScoreW / 2, currentY + tableHeaderHeight / 2);

  // عمود التقدير اللفظي
  headerCursorX -= colGradeW;
  ctx.fillText('التقدير الأكاديمي', headerCursorX + colGradeW / 2, currentY + tableHeaderHeight / 2);

  // عمود حالة الإتقان
  headerCursorX -= colStatusW;
  ctx.fillText('حالة الاستيعاب', headerCursorX + colStatusW / 2, currentY + tableHeaderHeight / 2);

  // عمود ملاحظات المعلم
  headerCursorX -= colNotesW;
  ctx.fillText('توجيه الأستاذ إسلام سعود', headerCursorX + colNotesW / 2, currentY + tableHeaderHeight / 2);

  currentY += tableHeaderHeight;

  // رسم صفوف الدروس في الجدول
  let globalLessonIndex = 1;

  unitsToRender.forEach((unit) => {
    const unitLessons = unit.lessons || [];

    // شريط فاصل لكل وحدة إن كان التقرير شاملاً لعدة وحدات
    if (!isSingleUnit) {
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(tableX, currentY, tableW, unitDividerHeight);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(tableX, currentY, tableW, unitDividerHeight);

      const uSolved = unitLessons.filter(l => lessonFirstScoreMap[l.title] !== undefined);
      const uScores = uSolved.map(l => lessonFirstScoreMap[l.title]);
      const uAvg = uScores.length > 0 ? Math.round(uScores.reduce((a, b) => a + b, 0) / uScores.length) : 0;

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0f274a';
      ctx.font = 'bold 14px "Cairo", "Segoe UI", Tahoma, sans-serif';
      ctx.fillText(`📁 ${unit.title}`, tableX + tableW - 15, currentY + unitDividerHeight / 2);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
      ctx.fillText(`أنجز ${toEasternArabic(uSolved.length)} من ${toEasternArabic(unitLessons.length)} دروس • متوسط الوحدة: ${uScores.length > 0 ? `${toEasternArabic(uAvg)}٪` : 'لم يختبر'}`, tableX + 15, currentY + unitDividerHeight / 2);

      currentY += unitDividerHeight;
    }

    unitLessons.forEach((lesson, lIdx) => {
      const score = lessonFirstScoreMap[lesson.title];
      const isSolved = score !== undefined;

      // خلفية متبادلة للصفوف
      ctx.fillStyle = (lIdx % 2 === 0) ? '#ffffff' : '#f8fafc';
      ctx.fillRect(tableX, currentY, tableW, tableRowHeight);

      // خط فاصل سفلي
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tableX, currentY + tableRowHeight);
      ctx.lineTo(tableX + tableW, currentY + tableRowHeight);
      ctx.stroke();

      let rowCursorX = tableX + tableW;

      // 1. رقم م
      rowCursorX -= colIndexW;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
      ctx.fillText(toEasternArabic(globalLessonIndex), rowCursorX + colIndexW / 2, currentY + tableRowHeight / 2);

      // 2. اسم الوحدة (إن وجد)
      if (!isSingleUnit) {
        rowCursorX -= colUnitW;
        ctx.fillStyle = '#475569';
        ctx.font = '12px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.textAlign = 'center';
        const cleanUnitTitle = unit.title.replace(/^الوحدة\s*[\u0600-\u06FF0-9]*\s*:\s*/i, '');
        ctx.fillText(cleanUnitTitle.length > 22 ? cleanUnitTitle.slice(0, 20) + '..' : cleanUnitTitle, rowCursorX + colUnitW / 2, currentY + tableRowHeight / 2);
      }

      // 3. اسم الدرس
      rowCursorX -= colLessonW;
      ctx.textAlign = 'right';
      ctx.fillStyle = isSolved ? '#0f172a' : '#64748b';
      ctx.font = isSolved ? 'bold 14px "Cairo", "Segoe UI", Tahoma, sans-serif' : '13px "Cairo", "Segoe UI", Tahoma, sans-serif';
      
      const cleanLessonTitle = lesson.title;
      ctx.fillText(cleanLessonTitle.length > 42 ? cleanLessonTitle.slice(0, 40) + '..' : cleanLessonTitle, rowCursorX + colLessonW - 15, currentY + tableRowHeight / 2);

      // 4. النتيجة المئوية (Badge Pill)
      rowCursorX -= colScoreW;
      ctx.textAlign = 'center';
      if (isSolved) {
        const badgeBg = score >= 85 ? '#dcfce7' : score >= 65 ? '#dbeafe' : '#fee2e2';
        const badgeText = score >= 85 ? '#15803d' : score >= 65 ? '#1d4ed8' : '#b91c1c';
        const badgeBorder = score >= 85 ? '#86efac' : score >= 65 ? '#93c5fd' : '#fca5a5';

        drawRoundedRect(ctx, rowCursorX + 10, currentY + 7, colScoreW - 20, 28, 7);
        ctx.fillStyle = badgeBg;
        ctx.fill();
        ctx.strokeStyle = badgeBorder;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = badgeText;
        ctx.font = 'black 14px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText(`${toEasternArabic(score)}٪`, rowCursorX + colScoreW / 2, currentY + tableRowHeight / 2);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText('لم يُختبر ⏳', rowCursorX + colScoreW / 2, currentY + tableRowHeight / 2);
      }

      // 5. التقدير الأكاديمي اللفظي
      rowCursorX -= colGradeW;
      ctx.textAlign = 'center';
      if (isSolved) {
        const gradeLabel = score >= 90 ? 'ممتاز مرتفع ⭐' : score >= 85 ? 'ممتاز' : score >= 75 ? 'جيد جداً مرتفع' : score >= 65 ? 'جيد جداً' : score >= 50 ? 'جيد' : 'يحتاج دعم';
        const gradeColor = score >= 85 ? '#15803d' : score >= 65 ? '#1d4ed8' : '#b91c1c';
        ctx.fillStyle = gradeColor;
        ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText(gradeLabel, rowCursorX + colGradeW / 2, currentY + tableRowHeight / 2);
      } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText('---', rowCursorX + colGradeW / 2, currentY + tableRowHeight / 2);
      }

      // 6. حالة الاستيعاب والإتقان
      rowCursorX -= colStatusW;
      ctx.textAlign = 'center';
      if (isSolved) {
        const masteryText = score >= 85 ? 'إتقان تام ومتميز ✅' : score >= 65 ? 'استيعاب متقدم 👍' : 'يحتاج إعادة تدريب ⚠️';
        const masteryColor = score >= 85 ? '#166534' : score >= 65 ? '#1e40af' : '#991b1b';
        ctx.fillStyle = masteryColor;
        ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText(masteryText, rowCursorX + colStatusW / 2, currentY + tableRowHeight / 2);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText('بانتظار أداء الامتحان', rowCursorX + colStatusW / 2, currentY + tableRowHeight / 2);
      }

      // 7. توجيه وملاحظة المعلم
      rowCursorX -= colNotesW;
      ctx.textAlign = 'center';
      if (isSolved) {
        const tipText = score >= 85 ? 'ثبات رائع، استمر على القمة' : score >= 65 ? 'راجع التعليل ونقاط الربط' : 'استعن ببنك الأخطاء والتدريب';
        ctx.fillStyle = '#475569';
        ctx.font = '11.5px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText(tipText, rowCursorX + colNotesW / 2, currentY + tableRowHeight / 2);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px "Cairo", "Segoe UI", Tahoma, sans-serif';
        ctx.fillText('مطلوب الدخول للاختبار', rowCursorX + colNotesW / 2, currentY + tableRowHeight / 2);
      }

      currentY += tableRowHeight;
      globalLessonIndex++;
    });
  });

  // إطار خارجي كامل محيط بالجدول
  ctx.strokeStyle = '#0f274a';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, tableX, currentY - totalTableHeight, tableW, totalTableHeight, 12);
  ctx.stroke();

  currentY += spacing;

  // 7. قسم التوجيه الأكاديمي والتحليل التربوي (Teacher's Academic Guidance Box)
  drawRoundedRect(ctx, 35, currentY, width - 70, adviceBoxHeight, 14);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#c59b27';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f274a';
  ctx.font = 'bold 15px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('💡 التوجيه التربوي والتقييم الأكاديمي الشامل من الأستاذ إسلام سعود:', width - 55, currentY + 28);

  const adviceText = avgScore >= 85
    ? `ما شاء الله تبارك الله! يُظهر الطالب (${student.name}) استيعاباً رفيعاً وفهماً ناضجاً للمفاهيم ونقاط الربط. نوصي باستمرار حل التدريبات للمحافظة على التميز والتأهل لأعلى مراتب لوحة الشرف.`
    : avgScore >= 65
    ? `أداء طيب وجهد مشكور للطالب (${student.name}). لضمان التقفيل التام وتحقيق الدرجة النهائية، يُرجى التركيز على مراجعة التعليلات والمفاهيم المرتبطة في الأسئلة التي حدث فيها خطأ.`
    : avgScore > 0
    ? `يحتاج الطالب (${student.name}) إلى مزيد من التركيز والمراجعة المنتظمة، والاستفادة من نمط "إعادة الاختبار للتدريب" وبنك الأخطاء الدائم لترسيخ المفاهيم قبل الانتقال للوحدات التالية.`
    : `لم يقم الطالب بأداء الاختبارات المقررة حتى الآن. يُرجى حثه على الانتظام والدخول لاختبارات المنصة أولاً بأول لمتابعة مستواه بصورة دقيقة.`;

  ctx.fillStyle = '#334155';
  ctx.font = 'bold 13.5px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(adviceText, width - 55, currentY + 65);

  currentY += adviceBoxHeight + spacing;

  // 8. التذييل الرسمي والاعتماد والأختام (Official Seal & Signatures Strip)
  drawRoundedRect(ctx, 35, currentY, width - 70, footerHeight, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // الجانب الأيمن: توقيع المعلم الرسمي
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f274a';
  ctx.font = 'bold 16px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('معلم المادة وخبير التقييم الأكاديمي: ✍️', width - 60, currentY + 38);

  ctx.fillStyle = '#c59b27';
  ctx.font = 'black 22px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('الأستاذ: إسلام سعود', width - 60, currentY + 74);

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('موسوعة الكنز التعليمية • رفيقك نحو القمة والدرجة النهائية', width - 60, currentY + 108);

  // المنتصف: الختم الدائري المعتمد
  drawOfficialSeal(ctx, width / 2, currentY + footerHeight / 2, 54);

  // الجانب الأيسر: خانة متابعة ورأي ولي الأمر
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f274a';
  ctx.font = 'bold 15px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('متابعة واعتماد ولي الأمر المحترم: 📝', 60, currentY + 38);

  ctx.fillStyle = '#475569';
  ctx.font = 'bold 13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('توقيع ولي الأمر بالعلم والمتابعة:', 60, currentY + 74);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px "Cairo", "Segoe UI", Tahoma, sans-serif';
  ctx.fillText('..................................................................', 60, currentY + 108);

  // تصدير الكانفاس فائق الدقة كصورة PNG
  return canvas.toDataURL('image/png');
}
