import React, { useState, useMemo } from 'react';
import { Lesson, ExamConfig, Question, ExamScheduleTarget, ExamLeaderboardPolicy } from '../types';
import { 
  getExamConfig, 
  saveExamConfig, 
  calculateExamStructure, 
  detectEssayType, 
  getQuestionMaxScore,
  formatScheduleDate 
} from '../examConfigUtils';

interface ExamSettingsModalProps {
  lesson: Lesson;
  unitTitle: string;
  isPublished: boolean;
  onTogglePublish: (lessonId: string, shouldPublish: boolean) => void;
  onClose: () => void;
  onPreviewExam?: (lesson: Lesson, config: ExamConfig) => void;
  onSaveConfig?: (config: ExamConfig) => void;
  isDarkMode?: boolean;
}

export const ExamSettingsModal: React.FC<ExamSettingsModalProps> = ({
  lesson,
  unitTitle,
  isPublished,
  onTogglePublish,
  onClose,
  onPreviewExam,
  onSaveConfig,
  isDarkMode = false,
}) => {
  const [config, setConfig] = useState<ExamConfig>(() => getExamConfig(lesson.id));
  const [essayScoreMode, setEssayScoreMode] = useState<'unified' | 'custom'>(() => {
    return config.customQuestionScores && Object.keys(config.customQuestionScores).length > 0 
      ? 'custom' 
      : 'unified';
  });
  const [saveToast, setSaveToast] = useState(false);


  // حساب الهيكل ومجموع الدرجات لحظياً
  const structure = useMemo(() => {
    return calculateExamStructure(lesson.questions, config);
  }, [lesson.questions, config]);

  // قائمة الأسئلة المقالية في هذا الاختبار
  const essayQuestionsWithIndex = useMemo(() => {
    return lesson.questions
      .map((q, idx) => ({ q, idx }))
      .filter(({ q }) => q.type === 'essay');
  }, [lesson.questions]);

  const handleSave = () => {
    saveExamConfig(config);
    if (onSaveConfig) {
      try {
        onSaveConfig(config);
      } catch (e) {}
    }
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  };

  const handleCustomQuestionScoreChange = (qIndex: number, val: number) => {
    setConfig(prev => {
      const updated = { ...(prev.customQuestionScores || {}) };
      updated[qIndex] = Math.max(0.5, val || 1);
      return { ...prev, customQuestionScores: updated };
    });
  };

  const handlePublishToggle = () => {
    saveExamConfig(config);
    if (onSaveConfig) {
      try {
        onSaveConfig(config);
      } catch (e) {}
    }
    onTogglePublish(lesson.id, !isPublished);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto" dir="rtl">
      <div 
        className={`w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden my-auto border-2 flex flex-col max-h-[92vh] ${
          isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-primary/20 text-gray-800'
        }`}
      >
        {/* رأس النافذة */}
        <div className={`p-4 sm:p-5 border-b flex items-center justify-between gap-3 shrink-0 ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gradient-to-l from-indigo-50/80 via-white to-blue-50/60 border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl shrink-0">
              <i className="fas fa-sliders-h"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-black text-primary">
                  إعدادات وضبط درجات الامتحان
                </h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  isPublished 
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}>
                  {isPublished ? '● منشور للطلاب' : '○ مسودة مخفية'}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-bold mt-0.5">
                {unitTitle} ⬅️ {lesson.title} ({lesson.questions.length} سؤال)
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors shrink-0"
            title="إغلاق"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        {/* محتوى الإعدادات القابل للتمرير */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-sm">
          
          {/* محدد: الإعدادات العامة أم تخصيص استثنائي */}
          <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
            <div>
              <span className="font-black text-sm text-indigo-950 block">
                {config.useGlobalSettings !== false 
                  ? '🌐 يتبع هذا الامتحان الإعدادات العامة لجميع امتحانات المنصة' 
                  : '⚙️ تم تفعيل تخصيص استثنائي لهذا الامتحان فقط'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, useGlobalSettings: true }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  config.useGlobalSettings !== false 
                    ? 'bg-primary text-white shadow-sm' 
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                }`}
              >
                الإعدادات العامة 🌐
              </button>
              <button
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, useGlobalSettings: false }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  config.useGlobalSettings === false 
                    ? 'bg-amber-600 text-white shadow-sm' 
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                }`}
              >
                تخصيص استثنائي ⚙️
              </button>
            </div>
          </div>

          {/* 1. ملخص هيكل الامتحان والمجموع الكلي */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-center">
              <span className="text-xs font-bold text-blue-700 block mb-1">اختيار من متعدد</span>
              <div className="text-lg font-black text-blue-900">{structure.mcqCount} سؤالاً</div>
              <div className="text-[11px] text-blue-600 font-bold mt-0.5">({structure.mcqTotalScore} درجة)</div>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-3 text-center">
              <span className="text-xs font-bold text-purple-700 block mb-1">صح وخطأ</span>
              <div className="text-lg font-black text-purple-900">{structure.tfCount} أسئلة</div>
              <div className="text-[11px] text-purple-600 font-bold mt-0.5">({structure.tfTotalScore} درجة)</div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
              <span className="text-xs font-bold text-amber-700 block mb-1">أسئلة مقالية</span>
              <div className="text-lg font-black text-amber-900">{structure.essayCount} أسئلة</div>
              <div className="text-[11px] text-amber-600 font-bold mt-0.5">({structure.essayTotalScore} درجة)</div>
            </div>

            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3 text-center shadow-sm">
              <span className="text-xs font-black text-emerald-700 block mb-1">المجموع الكلي للامتحان</span>
              <div className="text-2xl font-black text-emerald-900">{structure.examTotalScore}</div>
              <div className="text-[11px] text-emerald-600 font-bold mt-0.5">درجة معتمدة</div>
            </div>
          </div>

          {/* 2. ضبط درجات كل نوع سؤال */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDarkMode ? 'bg-gray-800/60 border-gray-700' : 'bg-gray-50/70 border-gray-200'}`}>
            <h4 className="font-black text-base text-gray-900 mb-3 flex items-center gap-2">
              <i className="fas fa-coins text-amber-500"></i> توزيع الدرجات لكل نوع
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* درجة الاختياري */}
              <div className="bg-white p-3.5 rounded-xl border border-gray-200 flex items-center justify-between">
                <label className="font-bold text-gray-800 text-xs">درجة سؤال الاختيار من متعدد:</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={config.mcqScore}
                    onChange={e => setConfig(prev => ({ ...prev, mcqScore: parseFloat(e.target.value) || 1 }))}
                    className="w-16 p-1.5 text-center font-black border border-gray-300 rounded-lg text-primary focus:ring-2 focus:ring-primary outline-none"
                  />
                  <span className="text-xs font-bold text-gray-500">درجة</span>
                </div>
              </div>

              {/* درجة صح وخطأ */}
              <div className="bg-white p-3.5 rounded-xl border border-gray-200 flex items-center justify-between">
                <label className="font-bold text-gray-800 text-xs">درجة سؤال صح وخطأ:</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={config.tfScore}
                    onChange={e => setConfig(prev => ({ ...prev, tfScore: parseFloat(e.target.value) || 1 }))}
                    className="w-16 p-1.5 text-center font-black border border-gray-300 rounded-lg text-primary focus:ring-2 focus:ring-primary outline-none"
                  />
                  <span className="text-xs font-bold text-gray-500">درجة</span>
                </div>
              </div>
            </div>

            {/* تفاصيل الأسئلة المقالية إن وُجدت */}
            {structure.essayCount > 0 ? (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <span className="font-black text-gray-800 text-xs sm:text-sm block">درجات الأسئلة المقالية:</span>
                  <div className="flex items-center gap-1 bg-gray-200 p-1 rounded-xl self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setEssayScoreMode('unified')}
                      className={`text-xs font-bold px-3 py-1 rounded-lg transition-all ${
                        essayScoreMode === 'unified' ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      درجة موحدة للكل
                    </button>
                    <button
                      type="button"
                      onClick={() => setEssayScoreMode('custom')}
                      className={`text-xs font-bold px-3 py-1 rounded-lg transition-all ${
                        essayScoreMode === 'custom' ? 'bg-white text-primary shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      تخصيص لكل سؤال
                    </button>
                  </div>
                </div>

                {/* وضع الدرجة الموحدة */}
                {essayScoreMode === 'unified' && (
                  <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                    <span className="font-bold text-gray-800 text-xs">درجة كل سؤال مقالي (موحدة):</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={config.essayScore}
                        onChange={e => setConfig(prev => ({ ...prev, essayScore: parseFloat(e.target.value) || 2 }))}
                        className="w-16 p-1.5 text-center font-black border border-amber-300 rounded-lg text-primary focus:ring-2 focus:ring-primary outline-none bg-white"
                      />
                      <span className="text-xs font-bold text-gray-500">درجات</span>
                    </div>
                  </div>
                )}

                {/* وضع التخصيص لكل سؤال مقالي منفصل */}
                {essayScoreMode === 'custom' && (
                  <div className="space-y-2 mt-2 max-h-56 overflow-y-auto pr-1">
                    {essayQuestionsWithIndex.map(({ q, idx }, listIdx) => {
                      const detected = detectEssayType(q.q);
                      const currentScore = getQuestionMaxScore(q, idx, config);
                      return (
                        <div key={idx} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md shrink-0">
                                {detected.label}
                              </span>
                              <span className="text-xs font-black text-gray-500">سؤال #{listIdx + 1}:</span>
                            </div>
                            <p className="text-xs text-gray-800 font-bold truncate" title={q.q}>
                              {q.q}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min="0.5"
                              step="0.5"
                              value={currentScore}
                              onChange={e => handleCustomQuestionScoreChange(idx, parseFloat(e.target.value))}
                              className="w-16 p-1.5 text-center font-black border border-gray-300 rounded-lg text-primary focus:ring-2 focus:ring-primary outline-none"
                            />
                            <span className="text-xs font-bold text-gray-500">درجات</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 p-3 bg-gray-100/70 rounded-xl text-gray-500 text-xs font-bold flex items-center gap-2">
                <i className="fas fa-info-circle text-blue-500"></i>
                هذا الامتحان لا يحتوي على أسئلة مقالية، جميع أسئلته اختيارية وموضوعية.
              </div>
            )}
          </div>

          {/* 3. خيارات آلية التصحيح والمجموع (Checkboxes) */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDarkMode ? 'bg-gray-800/60 border-gray-700' : 'bg-gray-50/70 border-gray-200'}`}>
            <h4 className="font-black text-base text-gray-900 mb-3 flex items-center gap-2">
              <i className="fas fa-check-double text-emerald-500"></i> خيارات التصحيح واعتماد النتيجة
            </h4>

            <div className="space-y-4">
              {/* مربع احتساب المقالي في المجموع والشهادة */}
              <label className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-primary/50 transition-colors">
                <input
                  type="checkbox"
                  checked={config.includeEssayInTotal}
                  onChange={e => setConfig(prev => ({ ...prev, includeEssayInTotal: e.target.checked }))}
                  className="w-5 h-5 rounded text-primary focus:ring-primary shrink-0 cursor-pointer"
                />
                <span className="font-black text-gray-800 text-xs sm:text-sm">
                  احتساب درجات الأسئلة المقالية ضمن المجموع الكلي ونسبة النجاح والشهادة
                </span>
              </label>

              {/* بطاقات اختيار آلية التصحيح */}
              <div>
                <span className="font-black text-gray-700 text-xs block mb-2">طريقة تصحيح الأسئلة المقالية:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  
                  {/* الخيار 1: هجين */}
                  <div
                    onClick={() => setConfig(prev => ({ ...prev, gradingMode: 'hybrid' }))}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-2.5 ${
                      config.gradingMode === 'hybrid'
                        ? 'border-primary bg-primary/5 text-primary shadow-sm font-black'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 font-bold'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      config.gradingMode === 'hybrid' ? 'border-primary' : 'border-gray-400'
                    }`}>
                      {config.gradingMode === 'hybrid' && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className="text-xs sm:text-sm">تصحيح هجين (اعتماد المعلم أولاً) ⭐</span>
                  </div>

                  {/* الخيار 2: فوري */}
                  <div
                    onClick={() => setConfig(prev => ({ ...prev, gradingMode: 'instant_ai' }))}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-2.5 ${
                      config.gradingMode === 'instant_ai'
                        ? 'border-primary bg-primary/5 text-primary shadow-sm font-black'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 font-bold'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      config.gradingMode === 'instant_ai' ? 'border-primary' : 'border-gray-400'
                    }`}>
                      {config.gradingMode === 'instant_ai' && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className="text-xs sm:text-sm">تصحيح تلقائي فوري (بالذكاء الاصطناعي) ⚡</span>
                  </div>

                </div>
              </div>

              {/* معيار التعامل مع اللهجة والعامية */}
              <div>
                <span className="font-black text-gray-700 text-xs block mb-2">سياسة تقييم الصياغة واللهجة (العامية vs الفصحى):</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  
                  {/* الخيار 1: متوازن */}
                  <div
                    onClick={() => setConfig(prev => ({ ...prev, dialectPolicy: 'balanced' }))}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-center gap-2 ${
                      (config.dialectPolicy || 'balanced') === 'balanced'
                        ? 'border-primary bg-primary/5 text-primary shadow-sm font-black'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 font-bold'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      (config.dialectPolicy || 'balanced') === 'balanced' ? 'border-primary' : 'border-gray-400'
                    }`}>
                      {(config.dialectPolicy || 'balanced') === 'balanced' && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </div>
                    <span className="text-xs">🎯 متوازن (موصى به)</span>
                  </div>

                  {/* الخيار 2: مرن ومشجع */}
                  <div
                    onClick={() => setConfig(prev => ({ ...prev, dialectPolicy: 'encouraging' }))}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-center gap-2 ${
                      config.dialectPolicy === 'encouraging'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm font-black'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 font-bold'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      config.dialectPolicy === 'encouraging' ? 'border-emerald-600' : 'border-gray-400'
                    }`}>
                      {config.dialectPolicy === 'encouraging' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />}
                    </div>
                    <span className="text-xs">🌟 مرن ومشجع</span>
                  </div>

                  {/* الخيار 3: صارم */}
                  <div
                    onClick={() => setConfig(prev => ({ ...prev, dialectPolicy: 'strict' }))}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-center gap-2 ${
                      config.dialectPolicy === 'strict'
                        ? 'border-amber-600 bg-amber-50 text-amber-800 shadow-sm font-black'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 font-bold'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      config.dialectPolicy === 'strict' ? 'border-amber-600' : 'border-gray-400'
                    }`}>
                      {config.dialectPolicy === 'strict' && <div className="w-1.5 h-1.5 rounded-full bg-amber-600" />}
                    </div>
                    <span className="text-xs">⚖️ محاكاة رسمية صارمة</span>
                  </div>

                </div>
              </div>

              {/* مربع إظهار نموذج الإجابة بعد الاعتماد */}
              <label className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-primary/50 transition-colors">
                <input
                  type="checkbox"
                  checked={config.showModelAnswerAfterApproval}
                  onChange={e => setConfig(prev => ({ ...prev, showModelAnswerAfterApproval: e.target.checked }))}
                  className="w-5 h-5 rounded text-primary focus:ring-primary shrink-0 cursor-pointer"
                />
                <span className="font-black text-gray-800 text-xs sm:text-sm">
                  كشف نموذج الإجابة للطالب في التقرير بعد اعتماد المعلم
                </span>
              </label>

            </div>
          </div>

          {/* 5. موعد إتاحة وجدولة الامتحان ولوحة الشرف */}
          <div className="bg-amber-50/40 p-4 sm:p-5 rounded-2xl border border-amber-200/80 space-y-4">
            <div>
              <h4 className="font-black text-sm text-primary flex items-center gap-2">
                <i className="fas fa-clock text-amber-500"></i> موعد إتاحة وجدولة الامتحان واحتسابه في لوحة الشرف ⏰
              </h4>
            </div>

            {/* الجمهور المستهدف */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-gray-700">
                <i className="fas fa-users text-primary ml-1"></i> الجمهور المستهدف بالامتحان:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'all', label: '👥 الجميع (أونلاين + سنتر)' },
                  { key: 'online_only', label: '🌐 أونلاين فقط' },
                  { key: 'center_only', label: '🏛️ سنتر فقط' },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setConfig(prev => ({ ...prev, targetAudience: item.key as ExamScheduleTarget }))}
                    className={`py-2 px-2.5 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                      (config.targetAudience || 'all') === item.key
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* نوع الإتاحة */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-gray-700">
                <i className="fas fa-calendar-alt text-primary ml-1"></i> نوع الإتاحة:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev, scheduleMode: 'always' }))}
                  className={`p-2.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                    (config.scheduleMode || 'always') === 'always'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  🟢 متاح دائماً بدون إغلاق
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                    const target = new Date(Date.now() + 72 * 60 * 60 * 1000);
                    const endStr = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
                    setConfig(prev => ({
                      ...prev,
                      scheduleMode: 'scheduled',
                      startDate: prev.startDate || nowStr,
                      endDate: prev.endDate || endStr,
                    }));
                  }}
                  className={`p-2.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                    config.scheduleMode === 'scheduled'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  ⏳ مجدول بفترة محددة
                </button>
              </div>
            </div>

            {/* حقول التاريخ إذا كان مجدولاً */}
            {config.scheduleMode === 'scheduled' && (
              <div className="p-3 bg-white rounded-xl border border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">
                    <i className="fas fa-play text-emerald-600 ml-1"></i> يبدأ في:
                  </label>
                  <input
                    type="datetime-local"
                    value={config.startDate || ''}
                    onChange={e => setConfig(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full p-2 text-xs font-bold border border-gray-300 rounded-lg outline-none bg-gray-50 focus:bg-white"
                  />
                  {config.startDate && (
                    <span className="text-[10px] text-gray-500 font-bold mt-0.5 block">
                      📌 {formatScheduleDate(config.startDate)}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">
                    <i className="fas fa-flag-checkered text-rose-600 ml-1"></i> ينتهي في:
                  </label>
                  <input
                    type="datetime-local"
                    value={config.endDate || ''}
                    onChange={e => setConfig(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full p-2 text-xs font-bold border border-gray-300 rounded-lg outline-none bg-gray-50 focus:bg-white"
                  />
                  {config.endDate && (
                    <span className="text-[10px] text-gray-500 font-bold mt-0.5 block">
                      🔒 {formatScheduleDate(config.endDate)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* سياسة لوحة الشرف */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-gray-700">
                <i className="fas fa-trophy text-amber-500 ml-1"></i> سياسة احتساب النتيجة في لوحة الشرف:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { key: 'within_schedule', label: '⏱️ في الموعد فقط' },
                  { key: 'always', label: '🏆 يُحسب دائماً' },
                  { key: 'never', label: '🚫 لا يُحسب' },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setConfig(prev => ({ ...prev, leaderboardPolicy: item.key as ExamLeaderboardPolicy }))}
                    className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                      (config.leaderboardPolicy || 'always') === item.key
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-black'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-xs font-black block">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>



        </div>

        {/* تذييل النافذة وإجراءات النشر والحفظ */}
        <div className={`p-4 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
        }`}>
          {/* زر المعاينة كمعلم */}
          <div className="flex items-center gap-2">
            {onPreviewExam && (
              <button
                type="button"
                onClick={() => onPreviewExam(lesson, config)}
                className="px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center gap-2 transition-all border border-indigo-200 active:scale-95"
              >
                <i className="fas fa-eye"></i> معاينة وتجربة كمعلم
              </button>
            )}
            {saveToast && (
              <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 animate-fade-in flex items-center gap-1.5">
                <i className="fas fa-check-circle"></i> تم حفظ الإعدادات بنجاح
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mr-auto">
            {/* زر النشر والإخفاء */}
            <button
              type="button"
              onClick={handlePublishToggle}
              className={`px-4 sm:px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center gap-2 shadow-md active:scale-95 ${
                isPublished
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              <i className={`fas ${isPublished ? 'fa-eye-slash' : 'fa-rocket'}`}></i>
              {isPublished ? 'إخفاء الامتحان (تحويل لمسودة)' : 'اعتماد ونشر الامتحان للطلاب 🚀'}
            </button>

            {/* زر حفظ الإعدادات فقط */}
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white font-black text-xs sm:text-sm transition-all shadow-md active:scale-95 flex items-center gap-2"
            >
              <i className="fas fa-save"></i> حفظ الإعدادات
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
