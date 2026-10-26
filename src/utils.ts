export const API_URL = "https://script.google.com/macros/s/AKfycbwrVCXzF3FNQjl154emCulyfTznzJcS-OjE5uQtgadhKt5SKmG_XGT24O_r3GZn2an2tQ/exec";
export const SECRET_API_KEY = "Kanz_Secret_2026_Secure";
export const OFFICIAL_APP_URL = "https://m-elkinz-2-b.vercel.app/";

export interface StudentBase {
  role: string;
  name: string;
  passHash: string;
}

export const BASE_STUDENTS: Record<string, StudentBase> = {
  "01228466613": { role: "admin", name: "eslam", passHash: "a1a46737fa00e8708eb9e6427b68ca89fb6063087f9895042d1b53917a0491e6" },
  "01205058940": { role: "secretary", name: "mostafa", passHash: "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9" }
};

export const subjectName = "التاريخ";
export const gradeName = "2 بكالوريا";
export const PAYMENT_INFO = { fee: "50 جنيهاً", vodafoneCash: "01228466613", instapay: "01228466613" };

export const sha256 = async (str: string): Promise<string> => {
  if (!str) return '';
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return simpleHash(str);
};

export const verifyStaffPassword = async (inputPassword: string, user: StudentBase): Promise<boolean> => {
  if (!inputPassword || !user || !user.passHash) return false;
  const trimmed = inputPassword.trim();
  const hashed = await sha256(trimmed);
  if (hashed.toLowerCase() === user.passHash.toLowerCase()) return true;
  // التوافق الرجعي الكامل مع الهاش القديم أو المدخلات
  if (simpleHash(trimmed) === user.passHash || simpleHash(inputPassword) === user.passHash) return true;
  return false;
};

export const simpleHash = (str: string): string => {
  if (!str) return '';
  let hex = '';
  for(let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16);
  }
  return hex;
};

export const toEasternArabic = (num: string | number): string => {
  return String(num).split('').map(digit => {
    const arabDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    const idx = parseInt(digit, 10);
    return !isNaN(idx) ? arabDigits[idx] : digit;
  }).join('');
};

export const formatPhoneStr = (phone: string): string => {
  if (!phone) return "";
  let cleaned = String(phone).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s\+\.]/g, "");
  if (cleaned.startsWith("20") && cleaned.length > 10) cleaned = cleaned.substring(2);
  if (cleaned.length === 10 && cleaned.startsWith("1")) cleaned = "0" + cleaned;
  return cleaned;
};

// دالة معالجة وتنظيف الدرجات وتحويل الكسور العشرية من جوجل شيتس (مثل 1 أو 0.95 إلى 100% و 95%)
export const normalizeScore = (scoreRaw: any): number => {
  if (scoreRaw === undefined || scoreRaw === null) return 0;
  
  // إذا كانت القيمة رقماً
  if (typeof scoreRaw === 'number') {
    if (isNaN(scoreRaw)) return 0;
    // إذا كان جوجل شيتس أرجع النسبة ككسر عشري (مثل 1 لـ 100% أو 0.85 لـ 85%)
    if (scoreRaw > 0 && scoreRaw <= 1) return Math.round(scoreRaw * 100);
    return Math.min(100, Math.round(scoreRaw));
  }

  const str = String(scoreRaw).trim();
  if (!str || str.includes('تصفير')) return 0;

  // إذا كانت الدرجة بصيغة الكسر مثل 10/10 أو 18/20
  if (str.includes('/')) {
    const parts = str.split('/');
    const earned = parseFloat(parts[0].replace(/[^\d.]/g, ''));
    const max = parseFloat(parts[1].replace(/[^\d.]/g, ''));
    if (!isNaN(earned) && !isNaN(max) && max > 0) {
      return Math.min(100, Math.round((earned / max) * 100));
    }
  }

  // إزالة رموز النسبة المئوية وأي أحرف غير رقمية
  const hasPercentSign = str.includes('%') || str.includes('٪');
  const cleanStr = str.replace(/%|٪/g, '').replace(/[^\d.]/g, '').trim();
  const val = parseFloat(cleanStr);
  if (isNaN(val)) return 0;

  // إذا لم تحتوِ على علامة % وكانت القيمة بين 0 و 1 (مثل "1" أو "0.95") فهي كسر عشري من 100
  if (!hasPercentSign && val > 0 && val <= 1) {
    return Math.round(val * 100);
  }

  return Math.min(100, Math.round(val));
};

// كاشف النوع الذكي للأسماء العربية (بنين / بنات) مع أولوية القيمة المسجلة
export const detectArabicGender = (fullName: string, explicitGender?: string): 'male' | 'female' => {
  if (explicitGender) {
    const g = explicitGender.trim().toLowerCase();
    if (g.includes('بنت') || g.includes('بنات') || g.includes('أنثى') || g.includes('انثى') || g === 'female' || g === 'f') {
      return 'female';
    }
    if (g.includes('ولد') || g.includes('بنين') || g.includes('ذكر') || g === 'male' || g === 'm') {
      return 'male';
    }
  }

  if (!fullName) return 'male';

  const clean = fullName.trim().replace(/^(الآنسة|الأستاذة|الطالبة|الطالب|السيد|السيدة)\s+/g, '');
  const firstName = clean.split(/\s+/)[0].trim();

  // قائمة أسماء البنات العربية الشائعة
  const femaleNames = new Set([
    'فاطمة', 'مريم', 'عائشة', 'سارة', 'ساره', 'نور', 'نورا', 'نورهان', 'نوران', 'منة', 'منه', 'منة الله', 
    'سلمى', 'سلمي', 'آية', 'ايه', 'آيات', 'هاجر', 'أسماء', 'اسماء', 'شهد', 'ندى', 'ندي', 'ياسمين', 'ريم', 
    'ريماس', 'حبيبة', 'حبيبه', 'ملك', 'مليكة', 'إسراء', 'اسراء', 'دعاء', 'هبة', 'هبه', 'إيمان', 'ايمان', 
    'رحمة', 'رحمه', 'بسملة', 'بسمله', 'جنى', 'جني', 'رنا', 'نهى', 'نهي', 'رضوى', 'رضوي', 'دينا', 'شروق', 
    'أروى', 'اروي', 'خلود', 'أميرة', 'اميرة', 'أميره', 'اميره', 'داليا', 'روان', 'شمس', 'تسنيم', 
    'يارا', 'ريناد', 'جودي', 'فريدة', 'فريده', 'حنين', 'جومانة', 'جومانه', 'ميرنا', 'سندس', 'زينب', 
    'خديجة', 'خديجه', 'صفاء', 'مروة', 'مروه', 'وفاء', 'ولاء', 'شيماء', 'نجلاء', 'حنان', 'رانيا', 'أمل', 
    'امل', 'منى', 'مني', 'سحر', 'لبنى', 'لبني', 'عبير', 'غادة', 'غاده', 'بسمة', 'بسمه', 'لمياء', 'سهام', 
    'إلهام', 'الهام', 'صباح', 'عفاف', 'هدير', 'مي', 'مى', 'تغريد', 'جميلة', 'جميله', 'جهاد', 'رغد', 'سما', 
    'شذى', 'ضحى', 'علا', 'ندين', 'نانسي', 'كارما', 'كنزي', 'تاليا', 'لارا', 'ليان', 'ريتاج', 'جاسمين'
  ]);

  if (femaleNames.has(firstName)) return 'female';

  // علامات التاء المربوطة التي تعود لأسماء بنين
  const maleWithTa = new Set(['حمزة', 'حمزه', 'أسامة', 'اسامة', 'اسامه', 'أسامه', 'طلحة', 'طلحه', 'قتادة', 'قتاده', 'عبيدة', 'عبيده', 'عكرمة', 'عكرمه', 'حذيفة', 'حذيفه', 'معاوية', 'معاويه', 'عطية', 'عطيه', 'جمعة', 'جمعه', 'سلامة', 'سلامه']);
  if (maleWithTa.has(firstName)) return 'male';

  if ((firstName.endsWith('ة') || firstName.endsWith('ه')) && !maleWithTa.has(firstName)) {
    return 'female';
  }

  return 'male';
};

export const generateDeviceFingerprint = (): string => {
  const STORAGE_KEY = 'kanz_device_fingerprint_v1';
  // 1. إذا كان الجهاز مسجلاً ولديه معرف ثابت مخزن محلياً، نستخدمه لضمان استقرار البصمة 100%
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.length >= 6) {
      return saved;
    }
  } catch (e) {
    // تجاوز أي قيود على التخزين المحلي في بعض أوضاع التصفح الخاص
  }

  // 2. محاولة توليد البصمة عبر Canvas الرسم المتوافق 100% مع الشيت الحالي
  let canvasHash = '';
  try {
    const canvas = document.createElement('canvas'); 
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = "top"; 
      ctx.font = "14px 'Arial'"; 
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60"; 
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069"; 
      ctx.fillText("EdTech-Fingerprint", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)"; 
      ctx.fillText("EdTech-Fingerprint", 4, 17);
      const b64 = canvas.toDataURL().replace("data:image/png;base64,","");
      const bin = atob(b64);
      
      const crc32 = function(r: string): number {
        const o: number[] = [];
        for (let c = 0; c < 256; c++) {
          let a = c;
          for (let f = 0; f < 8; f++) {
            a = 1 & a ? 3988292384 ^ (a >>> 1) : a >>> 1;
          }
          o[c] = a;
        }
        let n = -1;
        for (let t = 0; t < r.length; t++) {
          n = (n >>> 8) ^ o[255 & (n ^ r.charCodeAt(t))];
        }
        return (-1 ^ n) >>> 0;
      };
      
      canvasHash = crc32(bin).toString(16);
    }
  } catch (e) {
    // تجاوز أي حظر لخاصية الكانفاس من المتصفحات المقيدة
  }

  let finalFingerprint = canvasHash;

  // 3. إذا فشل الكانفاس أو تم حظره (مثل متصفحات الخصوصية)، نولد معرفاً عتادياً ثابتاً للجهاز بدلاً من رقم عشوائي
  if (!finalFingerprint) {
    try {
      const screenInfo = `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}`;
      const navInfo = `${navigator.userAgent || ''}_${navigator.platform || ''}`;
      const seed = `kanz_${screenInfo}_${navInfo}_${Date.now()}`;
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash |= 0;
      }
      finalFingerprint = Math.abs(hash).toString(16);
    } catch (e) {
      finalFingerprint = Date.now().toString(16);
    }
  }

  // 4. حفظ البصمة محلياً لضمان عدم تغيرها لنفس الجهاز أبداً وحماية الطالب من الحظر العشوائي
  try {
    localStorage.setItem(STORAGE_KEY, finalFingerprint);
  } catch (e) {}

  return finalFingerprint;
};

export const getDirectAudioLink = (url: string): string => {
  if (!url) return '';
  let cleanUrl = url.trim();

  // تحويل روابط جوجل درايف للرابط المباشر
  if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('docs.google.com')) {
    const match = cleanUrl.match(/id=([a-zA-Z0-9_-]+)/) || cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }

  // دعم روابط Dropbox: تحويلها لبث صوتي مباشر (raw=1) فائق السرعة متوافق 100% مع الهواتف والآيفون
  if (cleanUrl.includes('dropbox.com')) {
    const baseUrl = cleanUrl.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/[?&]dl=[01]/g, '');
    return baseUrl.includes('?') ? `${baseUrl}&raw=1` : `${baseUrl}?raw=1`;
  }

  // دعم روابط ون درايف OneDrive
  if (cleanUrl.includes('1drv.ms') || cleanUrl.includes('onedrive.live.com')) {
    return cleanUrl.replace('redir?', 'download?');
  }

  // دعم روابط Archive.org: تحويل صفحة التفاصيل (details) تلقائياً إلى رابط البث المباشر (download)
  if (cleanUrl.includes('archive.org/details/')) {
    cleanUrl = cleanUrl.replace('archive.org/details/', 'archive.org/download/');
  }

  // تحويل أي رابط http إلى https إجبارياً لأن متصفحات الموبايل وتطبيقات PWA تحظر الصوتيات غير المشفرة (Mixed Content)
  return cleanUrl.replace(/^http:\/\//i, 'https://');
};

export const getYoutubeEmbedLink = (url: string): string => {
  if (!url) return '';
  const cleanUrl = url.trim();

  // 1. يوتيوب YouTube (يدعم روابط watch, share youtu.be, embed, و Shorts)
  const ytRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const ytMatch = cleanUrl.match(ytRegExp);
  if (ytMatch && ytMatch[2].length === 11) {
    return `https://www.youtube.com/embed/${ytMatch[2]}?playsinline=1&rel=0`;
  }

  // 2. جوجل درايف Google Drive (تحويله لرابط /preview المخصص للتضمين والعرض المباشر داخل الآي فريم)
  if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('docs.google.com')) {
    const driveMatch = cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || cleanUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (driveMatch && driveMatch[1]) {
      return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    }
  }

  // 3. فيميو Vimeo
  const vimeoMatch = cleanUrl.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  // 4. أرشيف Archive.org (تحويل صفحة التفاصيل إلى مشغل التضمين المباشر)
  if (cleanUrl.includes('archive.org/details/')) {
    return cleanUrl.replace('archive.org/details/', 'archive.org/embed/');
  }

  return cleanUrl;
};

export const extractPdfUrl = (val: string): string => {
  if (!val) return '';
  const clean = val.trim();
  if (clean.includes('|')) {
    const parts = clean.split('|');
    return parts.slice(1).join('|').trim();
  }
  return clean;
};

// رابط التنزيل والفتح المباشر لملف الـ PDF
export const getDirectPdfLink = (url: string): string => {
  if (!url) return '';
  const cleanUrl = extractPdfUrl(url);

  // روابط جوجل درايف
  if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('docs.google.com')) {
    const match = cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || cleanUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }

  // روابط Dropbox
  if (cleanUrl.includes('dropbox.com')) {
    const baseUrl = cleanUrl.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/[?&]dl=[01]/g, '');
    return baseUrl.includes('?') ? `${baseUrl}&dl=1` : `${baseUrl}?dl=1`;
  }

  return cleanUrl;
};

// رابط عارض الـ PDF المدمج للتصفح السريع داخل التطبيق بدون تنزيل
export const getPdfViewerLink = (url: string): string => {
  if (!url) return '';
  const cleanUrl = extractPdfUrl(url);

  // روابط جوجل درايف: تحويلها لمشغل المعاينة المدمج الخاص بجوجل درايف
  if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('docs.google.com')) {
    const match = cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || cleanUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/file/d/${match[1]}/preview`;
    }
  }

  // روابط Dropbox أو الروابط المباشرة الأخرى: فتحها عبر Google Docs Viewer المدمج
  return `https://docs.google.com/viewer?url=${encodeURIComponent(cleanUrl)}&embedded=true`;
};

// دالة إنشاء ختم العلامة المائية باللغة العربية عبر HTML5 Canvas بدقة فائقة وألوان متناسقة للورق الطولي والعرضي
export const createArabicWatermarkCanvas = (
  studentName: string,
  studentPhone: string,
  subject: string = 'التاريخ',
  grade: string = '2 بكالوريا',
  isLandscape: boolean = false
): string => {
  const canvas = document.createElement('canvas');
  // أبعاد متناسبة: الورق العرضي (Landscape) 2000×1200، والورق الطولي (Portrait) 1800×1350
  if (isLandscape) {
    canvas.width = 2000;
    canvas.height = 1200;
  } else {
    canvas.width = 1800;
    canvas.height = 1350;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  const rotationAngle = isLandscape ? -16 : -24; // زاوية ميلان أنسب وأكثر استقراراً للورق العرضي والطولي
  ctx.rotate((rotationAngle * Math.PI) / 180);

  // إطار ختم ملكي مزدوج كبير وشبه شفاف وفاخر
  const boxW = isLandscape ? 1600 : 1440;
  const boxH = isLandscape ? 580 : 640;
  const halfW = boxW / 2;
  const halfH = boxH / 2;

  ctx.strokeStyle = 'rgba(217, 119, 6, 0.35)'; // ذهبي كهرماني خارجي
  ctx.lineWidth = 7;
  ctx.strokeRect(-halfW, -halfH, boxW, boxH);

  ctx.strokeStyle = 'rgba(225, 29, 72, 0.22)'; // إطار داخلي رفيع بلون الورد
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-halfW + 14, -halfH + 14, boxW - 28, boxH - 28);

  ctx.fillStyle = 'rgba(255, 251, 235, 0.05)'; // خلفية خفيفة جداً ومريحة للعين دون حجب الكلام
  ctx.fillRect(-halfW, -halfH, boxW, boxH);

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';

  if (isLandscape) {
    // السطر 1: موسوعة الكنز التعليمية (عرضي)
    ctx.font = '900 76px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(217, 119, 6, 0.46)';
    ctx.fillText(`★ موسوعة الكنز التعليمية ★`, 0, -180);

    // السطر 2: اسم المعلم
    ctx.font = '900 88px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(225, 29, 72, 0.52)';
    ctx.fillText(`أ/ إسلام سعود`, 0, -85);

    // السطر 3: المادة والمرحلة
    ctx.font = 'bold 50px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(30, 58, 138, 0.48)';
    ctx.fillText(`${subject}  •  ${grade}`, 0, -5);

    // خط فاصل زخرفي
    ctx.beginPath();
    ctx.moveTo(-halfW + 120, 35);
    ctx.lineTo(halfW - 120, 35);
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.40)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // السطر 4: بيانات الطالب الشخصية
    ctx.font = '900 42px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(185, 28, 28, 0.58)';
    ctx.fillText(`نسخة مرخصة للطالب: ${studentName || 'طالب مسجل'}  |  هاتف: ${studentPhone || '---'}`, 0, 95);

    // السطر 5: تاريخ الترخيص والأمان
    const dateStr = new Date().toLocaleDateString('ar-EG');
    ctx.font = 'bold 28px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(71, 85, 105, 0.45)';
    ctx.fillText(`تاريخ الترخيص: ${dateStr}  •  كود الحماية المائي المعتمد`, 0, 150);

    // السطر 6: التحذير القانوني المشدد
    ctx.font = '900 30px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(220, 38, 38, 0.88)';
    ctx.fillText(`⚠️ ملكية فكرية خاصة - يُحظر تماماً تصوير أو تداول هذه المذكرة خارج المنصة`, 0, 210);
  } else {
    // السطر 1: موسوعة الكنز التعليمية (طولي)
    ctx.font = '900 80px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(217, 119, 6, 0.46)';
    ctx.fillText(`★ موسوعة الكنز التعليمية ★`, 0, -200);

    // السطر 2: اسم المعلم (بارز وواضح بحجم ضخم بلون ياقوتي مميز)
    ctx.font = '900 92px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(225, 29, 72, 0.52)';
    ctx.fillText(`أ/ إسلام سعود`, 0, -100);

    // السطر 3: المادة والمرحلة (كحلي ملكي واضح)
    ctx.font = 'bold 52px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(30, 58, 138, 0.48)';
    ctx.fillText(`${subject}  •  ${grade}`, 0, -15);

    // خط فاصل زخرفي ناعم
    ctx.beginPath();
    ctx.moveTo(-520, 30);
    ctx.lineTo(520, 30);
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.40)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // السطر 4: بيانات الطالب الشخصية للردع الأمني
    ctx.font = '900 44px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(185, 28, 28, 0.58)'; // أحمر ناري واضح للردع
    ctx.fillText(`نسخة مرخصة للطالب: ${studentName || 'طالب مسجل'}  |  هاتف: ${studentPhone || '---'}`, 0, 95);

    // السطر 5: تاريخ الترخيص والأمان
    const dateStr = new Date().toLocaleDateString('ar-EG');
    ctx.font = 'bold 30px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(71, 85, 105, 0.45)';
    ctx.fillText(`تاريخ الترخيص: ${dateStr}  •  كود الحماية المائي المعتمد`, 0, 160);

    // السطر 6: التحذير القانوني المشدد باللون الأحمر الصريح البارز
    ctx.font = '900 32px "Cairo", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillStyle = 'rgba(220, 38, 38, 0.88)'; // أحمر بارز وصريح جداً
    ctx.fillText(`⚠️ ملكية فكرية خاصة - يُحظر تماماً تصوير أو تداول هذه المذكرة خارج المنصة`, 0, 230);
  }

  ctx.restore();

  return canvas.toDataURL('image/png');
};

// دالة تنزيل ملف الـ PDF مدموغاً بالعلامة المائية الشخصية للطالب
export const downloadWatermarkedPdf = async (
  pdfUrl: string,
  studentName: string,
  studentPhone: string,
  lessonTitle: string = 'الدرس',
  subject: string = 'التاريخ',
  grade: string = '2 بكالوريا'
): Promise<void> => {
  try {
    let pdfArrayBuffer: ArrayBuffer | null = null;

    // استخراج معرّف ملف درايف إن وجد
    const driveMatch = pdfUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || pdfUrl.match(/id=([a-zA-Z0-9_-]+)/);
    const fileId = driveMatch ? driveMatch[1] : null;

    // محاولة 1: جلب بايتس الملف عبر السيرفر السحابي لتخطي أي حظر CORS لملفات درايف
    if (fileId) {
      try {
        const proxyRes = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'getPdfBase64',
            fileId: fileId,
            apiKey: SECRET_API_KEY
          })
        });
        const proxyData = await proxyRes.json();
        if (proxyData && proxyData.status === 'success' && proxyData.base64) {
          const binaryStr = atob(proxyData.base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          pdfArrayBuffer = bytes.buffer;
        }
      } catch (err) {
        console.warn('Proxy fetch failed, attempting direct fetch...', err);
      }
    }

    // محاولة 2: جلب الملف مباشرة إن لم يتم جلبه عبر البروكسي
    if (!pdfArrayBuffer) {
      const directUrl = getDirectPdfLink(pdfUrl);
      const res = await fetch(directUrl);
      if (!res.ok) throw new Error('فشل تحميل ملف الـ PDF الأصلي');
      pdfArrayBuffer = await res.arrayBuffer();
    }

    // تعديل الـ PDF وإضافة العلامة المائية مع التعرف التلقائي على مقاس واتجاه الورقة (A4 طولي أو عرضي)
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer);

    // إنشاء نسختين متناسقتين من الختم: واحدة مخصصة للورق الطولي (Portrait) وأخرى مخصصة للورق العرضي (Landscape)
    const portraitPngUrl = createArabicWatermarkCanvas(studentName, studentPhone, subject, grade, false);
    const landscapePngUrl = createArabicWatermarkCanvas(studentName, studentPhone, subject, grade, true);

    let embeddedPortraitPng: any = null;
    let embeddedLandscapePng: any = null;

    if (portraitPngUrl) {
      const pBytes = await fetch(portraitPngUrl).then(r => r.arrayBuffer());
      embeddedPortraitPng = await pdfDoc.embedPng(pBytes);
    }
    if (landscapePngUrl) {
      const lBytes = await fetch(landscapePngUrl).then(r => r.arrayBuffer());
      embeddedLandscapePng = await pdfDoc.embedPng(lBytes);
    }

    const pages = pdfDoc.getPages();
    pages.forEach(page => {
      const { width, height } = page.getSize();
      const rotationAngle = (page.getRotation().angle || 0) % 360;

      // التعرف التلقائي الدقيق: هل الورقة معروضة بالعرض (Landscape) أم بالطول (Portrait)؟
      // مع مراعاة زاوية الدوران المسجلة في الصفحة
      const isRotatedSideways = rotationAngle === 90 || rotationAngle === 270;
      const visualWidth = isRotatedSideways ? height : width;
      const visualHeight = isRotatedSideways ? width : height;
      const isLandscape = visualWidth > visualHeight;

      const embeddedPng = isLandscape ? (embeddedLandscapePng || embeddedPortraitPng) : (embeddedPortraitPng || embeddedLandscapePng);
      if (!embeddedPng) return;

      const canvasWidth = isLandscape ? 2000 : 1800;
      const canvasHeight = isLandscape ? 1200 : 1350;
      const canvasAspect = canvasWidth / canvasHeight;

      // حساب الأبعاد المناسبة للورقة بحيث تتوسط الصفحة تماماً مع الحفاظ على التناسب
      const maxAllowedWidth = width * 0.88;
      const maxAllowedHeight = height * 0.82;

      let wmWidth = maxAllowedWidth;
      let wmHeight = wmWidth / canvasAspect;

      if (wmHeight > maxAllowedHeight) {
        wmHeight = maxAllowedHeight;
        wmWidth = wmHeight * canvasAspect;
      }

      // التوسيط الهندسي الدقيق في منتصف الصفحة بالضبط (A4 طولي أو عرضي)
      const x = (width - wmWidth) / 2;
      const y = (height - wmHeight) / 2;

      page.drawImage(embeddedPng, {
        x,
        y,
        width: wmWidth,
        height: wmHeight,
        opacity: 0.90
      });
    });

    const modifiedPdfBytes = await pdfDoc.save();
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    const safeName = (studentName || 'طالب').replace(/[\s\/\\:*?"<>|]+/g, '_');
    const safeTitle = (lessonTitle || 'مذكرة').replace(/[\s\/\\:*?"<>|]+/g, '_');

    const downloadLink = document.createElement('a');
    downloadLink.href = blobUrl;
    downloadLink.download = `مذكرة_${safeTitle}_${safeName}.pdf`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  } catch (error) {
    console.error('Watermark download error, falling back to direct link:', error);
    // تنزيل بديل مباشر في حال تعذر دمج العلامة المائية لضمان عدم حرمان الطالب من المذكرة
    const directUrl = getDirectPdfLink(pdfUrl);
    window.open(directUrl, '_blank');
  }
};

/**
 * تطبيع النصوص العربية للمقارنة الذكية والدقيقة بنسبة 100%
 * يجرد التشكيل، يوحد الهمزات، التاء المربوطة، الياء، والأرقام، ويزيل البادئات وعلامات الترقيم
 */
export const normalizeArabicForComparison = (str: string): string => {
  if (!str) return '';
  return String(str)
    // إزالة التشكيل والحركات
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // إزالة الكشيدة والتطويل
    .replace(/\u0640/g, '')
    // توحيد جميع أشكال الألف والهمزات
    .replace(/[أإآا]/g, 'ا')
    // توحيد التاء المربوطة والهاء
    .replace(/[ةه]/g, 'ه')
    // توحيد الياء والألف المقصورة
    .replace(/[ىي]/g, 'ي')
    // تحويل الأرقام المشرقية إلى عادية
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    // إزالة المسافات غير المرئية
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    // تجريد بادئات الخيارات مثل "أ) " أو "1- " أو "(أ) "
    .replace(/^[\(\[]?\s*([أ-دa-dA-D]|\d+)\s*[\)\]\.\-\:\–\—]\s*/, '')
    // إزالة علامات الترقيم والأقواس
    .replace(/[\.,:;!؟\?\"'""''`\(\)\[\]\{\}\\\/\-\–\—_+=*#]/g, ' ')
    // دمج المسافات المتعددة
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

/**
 * فحص ما إذا كان النص يعبر عن الصواب (True)
 */
export const isTrueAnswer = (str: string): boolean => {
  if (!str) return false;
  const norm = normalizeArabicForComparison(str);
  if (isFalseAnswer(str)) return false;
  return (
    norm.includes('صحيح') ||
    norm.includes('صواب') ||
    norm === 'صح' ||
    norm === 'ص' ||
    norm === 'true' ||
    norm === 't' ||
    norm === '1'
  );
};

/**
 * فحص ما إذا كان النص يعبر عن الخطأ (False)
 * يتحقق أولاً من مركبات النفي مثل "غير صحيح" لتفادي اعتبارها صحيحة
 */
export const isFalseAnswer = (str: string): boolean => {
  if (!str) return false;
  const norm = normalizeArabicForComparison(str);
  return (
    norm.includes('غير صحيح') ||
    norm.includes('غير صواب') ||
    norm.includes('ليست صحيح') ||
    norm.includes('خاطئ') ||
    norm.includes('خطا') ||
    norm === 'خ' ||
    norm === 'false' ||
    norm === 'f' ||
    norm === '2'
  );
};

/**
 * الفحص الذكي المتكامل للإجابة الصحيحة
 * يدعم:
 * 1. المطابقة النصية المرنة بعد تطبيع الحروف والهمزات والتشكيل.
 * 2. مطابقة أسئلة الصواب والخطأ دون الخلط بين الصحيح وغير الصحيح.
 * 3. مطابقة الخيارات المعتمدة على الحروف والأرقام (أ / ب / ج / د أو 1 / 2 / 3 / 4).
 * 4. التعامل مع البادئات (أ) / 1-).
 */
export const checkAnswerAccurately = (
  selectedOption: string,
  correctAnswer: string,
  optionIndex?: number,
  allOptions?: string[]
): boolean => {
  if (!selectedOption || !correctAnswer) return false;

  // 1. فحص أسئلة الصواب والخطأ (True / False)
  const isOptT = isTrueAnswer(selectedOption);
  const isOptF = isFalseAnswer(selectedOption);
  const isCorrT = isTrueAnswer(correctAnswer);
  const isCorrF = isFalseAnswer(correctAnswer);

  if ((isOptT || isOptF) && (isCorrT || isCorrF)) {
    if (isOptT && isCorrT) return true;
    if (isOptF && isCorrF) return true;
    return false;
  }

  // 2. التطبيع الدقيق للطرفين
  const normOpt = normalizeArabicForComparison(selectedOption);
  const normCorr = normalizeArabicForComparison(correctAnswer);

  // تطابق مباشر بعد التطبيع
  if (normOpt === normCorr) return true;

  // 3. فحص ما إذا كانت الإجابة الصحيحة المسجلة في الشيت عبارة عن حرف أو رقم (مثل أ أو 1)
  const cleanCorrRef = correctAnswer.trim().replace(/[\(\)\[\]\.\-\:\–\—\s]/g, '');
  const letterMap: Record<string, number> = {
    'أ': 0, 'ا': 0, '1': 0, '١': 0, 'A': 0, 'a': 0, 'الاول': 0,
    'ب': 1, '2': 1, '٢': 1, 'B': 1, 'b': 1, 'الثاني': 1,
    'ج': 2, '3': 2, '٣': 2, 'C': 2, 'c': 2, 'الثالث': 2,
    'د': 3, '4': 3, '٤': 3, 'D': 3, 'd': 3, 'الرابع': 3
  };

  if (letterMap[cleanCorrRef] !== undefined) {
    const targetIdx = letterMap[cleanCorrRef];
    // إذا تم تمرير رقم الخيار وكان يطابق الحرف/الرقم
    if (optionIndex !== undefined && optionIndex === targetIdx) {
      return true;
    }
    // إذا كان لدينا مصفوفة الخيارات الأصلية
    if (allOptions && allOptions[targetIdx]) {
      const normTargetOption = normalizeArabicForComparison(allOptions[targetIdx]);
      if (normOpt === normTargetOption) return true;
    }
  }

  // 4. مطابقة الاحتواء التام (إذا كانت إحداهما تحوي الأخرى كاملة في حالة وجود كلمات إضافية بسيطة)
  if (normOpt.length > 3 && normCorr.length > 3) {
    if (normOpt === normCorr) return true;
    // إذا كتب المعلم نصاً كاملاً والخيار مطابق للكلمات الأساسية
    const optWords = normOpt.split(' ').filter(Boolean);
    const corrWords = normCorr.split(' ').filter(Boolean);
    if (optWords.length === corrWords.length && optWords.every((w, i) => w === corrWords[i])) {
      return true;
    }
  }

  return false;
};
