import React, { useState, useRef } from 'react';
import { Lesson } from '../types';
import { API_URL, SECRET_API_KEY, getDirectPdfLink, getPdfViewerLink, toEasternArabic } from '../utils';

interface LessonPdfManagerModalProps {
  lesson: Lesson;
  unitTitle: string;
  onClose: () => void;
  onUpdatePdf?: (lessonId: string, newPdfUrl: string | null, updatedFiles?: Array<{ url: string; name: string }>) => void;
  onViewPdf?: (pdfUrl: string, title: string) => void;
  isDarkMode?: boolean;
}

export const LessonPdfManagerModal: React.FC<LessonPdfManagerModalProps> = ({
  lesson,
  unitTitle,
  onClose,
  onUpdatePdf,
  onViewPdf,
  isDarkMode = false,
}) => {
  // حالات مذكرات الـ PDF
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfFiles, setPdfFiles] = useState<Array<{ url: string; name: string }>>(() => {
    if (lesson.pdfFiles && lesson.pdfFiles.length > 0) {
      return [...lesson.pdfFiles];
    }
    if (lesson.pdf) {
      return [{ url: lesson.pdf, name: `مذكرة ${lesson.title}` }];
    }
    return [];
  });

  const [inputPdfUrl, setInputPdfUrl] = useState<string>('');
  const [customManualName, setCustomManualName] = useState<string>('');
  const [isUploadingPdf, setIsUploadingPdf] = useState<boolean>(false);
  const [pdfStatusMsg, setPdfStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // حالات تعديل اسم المذكرة الحالية
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [isSavingName, setIsSavingName] = useState<boolean>(false);

  const handleStartRename = (file: { url: string; name: string }) => {
    setEditingUrl(file.url);
    setEditingName(file.name);
  };

  const handleSaveRename = async (targetUrl: string) => {
    const newName = editingName.trim();
    if (!newName) return;
    setIsSavingName(true);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateLessonPdfLink',
          apiKey: SECRET_API_KEY,
          lessonTitle: lesson.title,
          pdfUrl: targetUrl,
          fileName: newName
        })
      });
      const result = await response.json();
      if (result && result.status === 'success') {
        const updated = pdfFiles.map(f => f.url === targetUrl ? { ...f, name: newName } : f);
        setPdfFiles(updated);
        setEditingUrl(null);
        setPdfStatusMsg({ type: 'success', text: `تم تحديث اسم المذكرة إلى (${newName}) بنجاح في الشيت والتطبيق! ✏️` });
        if (onUpdatePdf) {
          onUpdatePdf(lesson.id, updated[0]?.url || null, updated);
        }
      } else {
        setPdfStatusMsg({ type: 'error', text: result?.message || 'فشل تحديث الاسم في السيرفر.' });
      }
    } catch (err: any) {
      setPdfStatusMsg({ type: 'error', text: 'خطأ: ' + err.message });
    } finally {
      setIsSavingName(false);
    }
  };

  // رفع ملف PDF مباشر من الهاتف / الكمبيوتر
  const handlePdfFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setPdfStatusMsg({ type: 'error', text: 'عذراً، يجب اختيار ملف بصيغة PDF فقط.' });
      return;
    }

    const sizeInMB = file.size / (1024 * 1024);
    if (sizeInMB > 15) {
      setPdfStatusMsg({ 
        type: 'error', 
        text: `حجم الملف (${sizeInMB.toFixed(1)} ميجابايت) كبير. الحد الأقصى للرفع المباشر 15 ميجابايت. يمكنك رفع الملف على Google Drive ولصق الرابط هنا.` 
      });
      return;
    }

    const chosenTitle = customManualName.trim() || file.name.replace(/\.pdf$/i, '').trim();

    setIsUploadingPdf(true);
    setPdfStatusMsg({ type: 'info', text: 'جاري رفع المذكرة وحفظها على Google Drive والشيت... برجاء الانتظار ⏳' });

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
              action: 'uploadPdfFile',
              apiKey: SECRET_API_KEY,
              base64: base64Data,
              fileName: chosenTitle,
              lessonTitle: lesson.title
            })
          });

          const result = await response.json();
          if (result && result.status === 'success' && result.previewUrl) {
            const finalUrl = result.previewUrl;
            const finalName = result.fileName || chosenTitle;
            const updated = [...pdfFiles.filter(f => f.url !== finalUrl), { url: finalUrl, name: finalName }];
            setPdfFiles(updated);
            setInputPdfUrl('');
            setCustomManualName('');
            setPdfStatusMsg({ type: 'success', text: `تم رفع المذكرة باسم (${finalName}) بنجاح وربطها بالدرس والشيت! 🎉` });
            if (onUpdatePdf) {
              onUpdatePdf(lesson.id, updated[0]?.url || null, updated);
            }
          } else {
            setPdfStatusMsg({ type: 'error', text: result?.message || 'تعذر حفظ الملف على السيرفر، يرجى المحاولة ثانية.' });
          }
        } catch (err: any) {
          setPdfStatusMsg({ type: 'error', text: 'حدث خطأ أثناء رفع الملف: ' + (err.message || 'فشل الاتصال') });
        } finally {
          setIsUploadingPdf(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        setIsUploadingPdf(false);
        setPdfStatusMsg({ type: 'error', text: 'فشلت قراءة الملف من الجهاز.' });
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setIsUploadingPdf(false);
      setPdfStatusMsg({ type: 'error', text: 'خطأ: ' + err.message });
    }
  };

  // حفظ رابط المذكرة المباشر
  const handleSavePdfUrl = async () => {
    const cleanUrl = inputPdfUrl.trim();
    if (!cleanUrl) {
      setPdfStatusMsg({ type: 'error', text: 'يرجى إدخال رابط صالح أولاً.' });
      return;
    }

    const assignedName = customManualName.trim() || `مذكرة ${lesson.title}`;
    const cleanName = assignedName.replace(/\.pdf$/i, '').trim();

    setIsUploadingPdf(true);
    setPdfStatusMsg({ type: 'info', text: 'جاري حفظ رابط المذكرة في جوجل شيت... ⏳' });

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateLessonPdfLink',
          apiKey: SECRET_API_KEY,
          lessonTitle: lesson.title,
          pdfUrl: cleanUrl,
          fileName: cleanName
        })
      });
      const result = await response.json();
      if (result && result.status === 'success') {
        const updated = [...pdfFiles.filter(f => f.url !== cleanUrl), { url: cleanUrl, name: cleanName }];
        setPdfFiles(updated);
        setInputPdfUrl('');
        setCustomManualName('');
        setPdfStatusMsg({ type: 'success', text: `تم ربط المذكرة باسم (${cleanName}) بالدرس والشيت بنجاح! 🎉` });
        if (onUpdatePdf) {
          onUpdatePdf(lesson.id, updated[0]?.url || null, updated);
        }
      } else {
        setPdfStatusMsg({ type: 'error', text: result?.message || 'فشل حفظ الرابط في السيرفر.' });
      }
    } catch (err: any) {
      setPdfStatusMsg({ type: 'error', text: 'خطأ: ' + err.message });
    } finally {
      setIsUploadingPdf(false);
    }
  };

  // حذف مذكرة PDF محددة من الدرس
  const handleRemoveFile = async (fileToRemove: { url: string; name: string }) => {
    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف (${fileToRemove.name}) نهائياً من هذا الدرس والشيت؟`)) return;

    setIsUploadingPdf(true);
    setPdfStatusMsg({ type: 'info', text: `جاري حذف (${fileToRemove.name}) من الشيت... ⏳` });

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateLessonPdfLink',
          apiKey: SECRET_API_KEY,
          lessonTitle: lesson.title,
          removeUrl: fileToRemove.url
        })
      });
      const result = await response.json();
      if (result && result.status === 'success') {
        const updated = pdfFiles.filter(f => f.url !== fileToRemove.url);
        setPdfFiles(updated);
        setPdfStatusMsg({ type: 'success', text: `تمت إزالة (${fileToRemove.name}) من الدرس والشيت بنجاح! 🗑️` });
        if (onUpdatePdf) {
          onUpdatePdf(lesson.id, updated[0]?.url || null, updated);
        }
      } else {
        setPdfStatusMsg({ type: 'error', text: result?.message || 'فشلت إزالة الملف من السيرفر.' });
      }
    } catch (err: any) {
      setPdfStatusMsg({ type: 'error', text: 'فشل الحذف: ' + err.message });
    } finally {
      setIsUploadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in" dir="rtl">
      <div className={`w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden border-2 flex flex-col max-h-[92vh] ${
        isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-rose-200 text-gray-800'
      }`}>
        {/* رأس النافذة */}
        <div className="p-4 sm:p-5 border-b flex items-center justify-between gap-3 bg-gradient-to-l from-rose-50/90 via-white to-amber-50/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center text-xl shadow-sm shrink-0">
              <i className="fas fa-file-pdf"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-rose-950">
                  إدارة مذكرات وملفات PDF
                </h3>
                <span className="text-xs font-black px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                  {pdfFiles.length > 0 ? `${toEasternArabic(pdfFiles.length)} مذكرة` : 'لا توجد مذكرات'}
                </span>
              </div>
              <p className="text-xs text-gray-600 font-bold mt-0.5 truncate max-w-md">
                الدرس: <span className="text-rose-700 font-black">{lesson.title}</span> • {unitTitle}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="إغلاق"
          >
            <i className="fas fa-times text-base"></i>
          </button>
        </div>

        {/* جسم النافذة */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* رسالة الحالة / التنبيه */}
          {pdfStatusMsg && (
            <div className={`p-3.5 rounded-xl text-xs font-black flex items-center justify-between gap-2 animate-fade-in ${
              pdfStatusMsg.type === 'success' 
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' 
                : pdfStatusMsg.type === 'error'
                  ? 'bg-rose-50 text-rose-800 border border-rose-300'
                  : 'bg-blue-50 text-blue-800 border border-blue-300'
            }`}>
              <div className="flex items-center gap-2">
                <i className={`fas ${
                  pdfStatusMsg.type === 'success' ? 'fa-check-circle text-emerald-600' :
                  pdfStatusMsg.type === 'error' ? 'fa-exclamation-triangle text-rose-600' :
                  'fa-spinner fa-spin text-blue-600'
                }`}></i>
                <span>{pdfStatusMsg.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setPdfStatusMsg(null)}
                className="text-gray-400 hover:text-gray-600 text-xs px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* قسم 1: قائمة المذكرات الحالية بالدرس */}
          <div className="p-4 rounded-2xl bg-gray-50/80 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-black text-gray-800 flex items-center gap-2">
                <i className="fas fa-layer-group text-rose-600"></i>
                المذكرات المرتبطة بهذا الدرس حالياً ({toEasternArabic(pdfFiles.length)}):
              </span>
              <span className="text-[11px] text-gray-500 font-bold">
                تظهر للطالب مع إمكانية التصفح المدمج والتنزيل بالعلامة المائية
              </span>
            </div>

            {pdfFiles.length > 0 ? (
              <div className="space-y-2.5">
                {pdfFiles.map((file, fIdx) => (
                  <div key={fIdx} className="p-3.5 rounded-xl bg-white border border-gray-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                        <i className="fas fa-file-pdf text-base"></i>
                      </div>

                      {editingUrl === file.url ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="text"
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            className="p-1.5 text-xs font-black border border-indigo-300 rounded-lg outline-none bg-indigo-50/30 flex-1 min-w-0 text-gray-900"
                            placeholder="أدخل الاسم الجديد للمذكرة..."
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(file.url)}
                            disabled={isSavingName}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black shrink-0 cursor-pointer disabled:opacity-60"
                          >
                            {isSavingName ? 'حفظ...' : 'حفظ'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingUrl(null)}
                            className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-bold shrink-0 cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-gray-900 truncate" title={file.name}>
                              {file.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartRename(file)}
                              className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 shrink-0 cursor-pointer bg-indigo-50 px-2 py-0.5 rounded-md hover:bg-indigo-100 transition-colors"
                              title="تعديل اسم هذه المذكرة في جوجل شيت"
                            >
                              <i className="fas fa-pen text-[9px]"></i> تعديل الاسم
                            </button>
                          </div>
                          <span className="text-[10px] text-gray-400 font-mono truncate block mt-0.5 max-w-[280px]" dir="ltr">
                            {file.url}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* أزرار الإجراءات على المذكرة */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* زر المعاينة */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onViewPdf) {
                            onViewPdf(file.url, file.name);
                          } else {
                            window.open(getPdfViewerLink(file.url), '_blank');
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="معاينة وتصفح المذكرة داخل التطبيق"
                      >
                        <i className="fas fa-eye text-indigo-600"></i>
                        <span>معاينة</span>
                      </button>

                      {/* زر الحذف النهائي */}
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(file)}
                        disabled={isUploadingPdf}
                        className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-700 text-xs font-black flex items-center gap-1.5 border border-rose-200 transition-all cursor-pointer disabled:opacity-50 shadow-2xs active:scale-95"
                        title="حذف هذه المذكرة نهائياً من التطبيق والشيت"
                      >
                        <i className="fas fa-trash-alt"></i>
                        <span>حذف المذكرة</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 border border-dashed border-gray-300 rounded-xl bg-white">
                <i className="fas fa-file-pdf text-gray-300 text-3xl mb-2"></i>
                <p className="text-xs font-bold text-gray-500">لا توجد مذكرات PDF مرفوعة لهذا الدرس حتى الآن.</p>
                <p className="text-[11px] text-gray-400 mt-0.5">يمكنك رفع ملف PDF جديد أو إضافة رابط من الأسفل.</p>
              </div>
            )}
          </div>

          {/* قسم 2: رفع أو إضافة مذكرة جديدة */}
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-rose-50/60 to-amber-50/40 border-2 border-rose-200/80 space-y-4">
            <h4 className="font-black text-sm text-rose-950 flex items-center gap-2">
              <i className="fas fa-plus-circle text-rose-600"></i>
              إضافة مذكرة PDF جديدة للدرس
            </h4>

            {/* خانة اختيار وتحديد اسم المذكرة */}
            <div className="p-3 bg-white/90 border border-amber-200 rounded-xl">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                  <i className="fas fa-tag text-amber-600"></i>
                  <span>اسم أو عنوان المذكرة (اختياري):</span>
                </label>
                <span className="text-[10px] text-gray-500 font-bold">
                  (سيظهر للطالب بهذا الاسم في قائمة المذكرات)
                </span>
              </div>
              <input
                type="text"
                value={customManualName}
                onChange={e => setCustomManualName(e.target.value)}
                placeholder={`افتراضي: مذكرة ${lesson.title}`}
                className="w-full p-2.5 text-xs font-bold border border-gray-300 rounded-lg outline-none bg-white focus:ring-2 focus:ring-rose-400 text-gray-900"
              />
            </div>

            {/* الخيار أ: رفع مباشر من الهاتف / الكمبيوتر */}
            <div className="p-3.5 bg-white rounded-xl border border-rose-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <span className="font-black text-xs text-gray-800 block">📁 رفع ملف PDF مباشر من جهازك:</span>
                <span className="text-[10px] text-gray-500 font-bold block mt-0.5">
                  الحد الأقصى 15 ميجابايت (يُرفع تلقائياً ويُسجل في جوجل شيت).
                </span>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handlePdfFileUpload}
                accept=".pdf,application/pdf"
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingPdf}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
              >
                <i className={`fas ${isUploadingPdf ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'}`}></i>
                <span>{isUploadingPdf ? 'جاري الرفع والحفظ... ⏳' : '+ اختيار ورفع ملف PDF'}</span>
              </button>
            </div>

            {/* الخيار ب: إضافة رابط سحابي (Google Drive / Dropbox) */}
            <div className="p-3.5 bg-white rounded-xl border border-gray-200 space-y-2">
              <span className="font-black text-xs text-gray-800 flex items-center gap-1.5">
                <i className="fas fa-link text-indigo-500"></i>
                أو لصق رابط خارجي مباشر (Google Drive / Dropbox):
              </span>

              <div className="flex gap-2">
                <input
                  type="url"
                  value={inputPdfUrl}
                  onChange={e => setInputPdfUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... أو https://dropbox.com/..."
                  className="flex-1 p-2.5 text-xs font-bold border border-gray-300 rounded-lg outline-none bg-gray-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-400 text-gray-900 font-mono"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={handleSavePdfUrl}
                  disabled={isUploadingPdf || !inputPdfUrl.trim()}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <i className="fas fa-save"></i>
                  <span>حفظ الرابط</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* تذييل النافذة */}
        <div className="p-4 border-t bg-gray-50 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
            <i className="fas fa-info-circle text-rose-500"></i>
            أي ملف يتم رفعه أو حذفه هنا يُحدث جوجل شيت تلقائياً وفورياً.
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-black text-xs transition-colors cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  );
};
