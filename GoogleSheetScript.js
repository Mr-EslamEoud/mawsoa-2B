// =========================================================================
// موسوعة الكنز التعليمي - Google Apps Script (المعدل والمتوافق مع الشيت الجديد)
// =========================================================================
// تعليمات النشر:
// 1. افتح ملف Google Sheets الخاص بك.
// 2. من القائمة العلوية اختر: الإضافات (Extensions) -> Apps Script.
// 3. احذف أي كود موجود هناك والصق هذا الكود بالكامل بدلاً منه.
// 4. اضغط على الزر الأزرق: نشر (Deploy) -> إدارة عمليات النشر (Manage Deployments) أو نشر جديد (New Deployment).
// 5. تأكد من ضبط: الوصول إلى (Who has access) -> الجميع (Anyone).
// =========================================================================

// مفتاح الأمان السري (يجب أن يكون متطابقاً مع الموجود في التطبيق)
var SECRET_API_KEY = "Kanz_Secret_2026_Secure";

function doGet(e) {
  try {
    // 🛡️ حارس الأمان: التحقق من مفتاح الـ API
    if (!e.parameter || e.parameter.apiKey !== SECRET_API_KEY) {
      return respondJSON({status: 'error', message: 'Unauthorized Access'});
    }

    var action = e.parameter.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. جلب كل الطلاب والاشتراكات
    if (action === 'getAllStudents') {
      var studentsSheet = ss.getSheetByName("الطلاب");
      if (!studentsSheet) return respondJSON({status: 'error', message: 'شيت الطلاب غير موجود.'});
      
      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var studentsMap = {};
      
      // الكشف الذكي عن الأعمدة بناءً على رؤوس الأعمدة
      var colMap = findColumnIndices(headers);
      
      for (var i = 1; i < data.length; i++) {
        var name = String(data[i][colMap.name] || "").trim();
        var studentCode = colMap.code > -1 ? String(data[i][colMap.code] || "").trim() : "";
        var status = colMap.status > -1 ? String(data[i][colMap.status] || "").trim() : "";
        var rawPhone = colMap.phone > -1 ? data[i][colMap.phone] : "";
        var phone = cleanPhone(rawPhone);
        
        if (!phone) continue;

        var payInfo = calculateStudentPaymentStatus(headers, data[i], colMap);

        // فحص حالة الحظر
        var isBlocked = false;
        if (colMap.block > -1) {
          var blockVal = String(data[i][colMap.block]).trim();
          if (blockVal === 'نعم' || blockVal === 'true') {
            isBlocked = true;
          }
        }

        var regDate = colMap.regDate > -1 ? String(data[i][colMap.regDate] || "").trim() : "";

        if (!studentsMap[phone]) studentsMap[phone] = [];
        studentsMap[phone].push({
          name: name,
          code: studentCode,
          isPaid: payInfo.isPaid,
          missingMonths: payInfo.missingMonths,
          graceMonths: payInfo.graceMonths,
          graceDaysRemaining: payInfo.graceDaysRemaining,
          phone: phone,
          originalStatus: payInfo.originalStatus,
          isBlocked: isBlocked,
          registrationDate: regDate
        });
      }
      
      var settingsSheet = ss.getSheetByName("الإعدادات");
      var fee = "50 جنيهاً";
      var announcement = "";
      var timerMode, timerUnitTarget, timerSecondsPerQ;
      var timerType = "per_question";
      var examTotalMinutes = 50;
      var publishedLessons = "";
      var geminiApiKey = "";
      var showMistakesNotebook = true;
      var showResetButtons = true;
      var certSettings = "";
      var securitySettings = "";
      var examConfigs = "";

      if (settingsSheet) {
         var settingsData = settingsSheet.getDataRange().getValues();
         if (settingsData.length > 1) {
             if (settingsData[1][0]) fee = settingsData[1][0];
             if (settingsData[1].length > 1 && settingsData[1][1]) announcement = settingsData[1][1];
             if (settingsData[1].length > 2 && settingsData[1][2]) timerMode = settingsData[1][2];
             if (settingsData[1].length > 3 && settingsData[1][3] !== undefined) timerUnitTarget = settingsData[1][3];
             if (settingsData[1].length > 4 && settingsData[1][4] !== undefined) timerSecondsPerQ = settingsData[1][4];
             if (settingsData[1].length > 5 && settingsData[1][5] !== undefined) publishedLessons = settingsData[1][5];
             if (settingsData[1].length > 6 && settingsData[1][6] !== undefined && settingsData[1][6] !== "") timerType = settingsData[1][6];
             if (settingsData[1].length > 7 && settingsData[1][7] !== undefined && settingsData[1][7] !== "") examTotalMinutes = settingsData[1][7];
             if (settingsData[1].length > 8 && settingsData[1][8] !== undefined && settingsData[1][8] !== "") geminiApiKey = String(settingsData[1][8]).trim();
             if (settingsData[1].length > 9 && settingsData[1][9] !== undefined && settingsData[1][9] !== "") showMistakesNotebook = String(settingsData[1][9]).toLowerCase() !== "false";
             if (settingsData[1].length > 10 && settingsData[1][10] !== undefined && settingsData[1][10] !== "") showResetButtons = String(settingsData[1][10]).toLowerCase() !== "false";
             if (settingsData[1].length > 11 && settingsData[1][11] !== undefined && settingsData[1][11] !== "") certSettings = settingsData[1][11];
             if (settingsData[1].length > 12 && settingsData[1][12] !== undefined && settingsData[1][12] !== "") securitySettings = settingsData[1][12];
             if (settingsData[1].length > 13 && settingsData[1][13] !== undefined && settingsData[1][13] !== "") examConfigs = settingsData[1][13];
         }
      }

      return respondJSON({
        status: 'success', 
        data: studentsMap, 
        fee: fee, 
        announcement: announcement,
        timerMode: timerMode,
        timerUnitTarget: timerUnitTarget,
        timerSecondsPerQ: timerSecondsPerQ,
        timerType: timerType,
        examTotalMinutes: examTotalMinutes,
        publishedLessons: publishedLessons,
        geminiApiKey: geminiApiKey,
        showMistakesNotebook: showMistakesNotebook,
        showResetButtons: showResetButtons,
        certSettings: certSettings,
        securitySettings: securitySettings,
        examConfigs: examConfigs
      });
    }
    
    // 2. تسجيل الدخول
    else if (action === 'login') {
      var searchPhone = cleanPhone(e.parameter.phone);
      var studentsSheet = ss.getSheetByName("الطلاب");
      if (!studentsSheet) return respondJSON({status: 'error', message: 'شيت الطلاب غير موجود.'});

      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var foundStudents = [];
      var colMap = findColumnIndices(headers);
      
      for (var i = 1; i < data.length; i++) {
        var rowPhone = cleanPhone(data[i][colMap.phone]);
        
        if (rowPhone === searchPhone) {
          var name = String(data[i][colMap.name] || "").trim();
          var studentCode = colMap.code > -1 ? String(data[i][colMap.code] || "").trim() : "";
          var payInfo = calculateStudentPaymentStatus(headers, data[i], colMap);
          
          var isBlocked = false;
          if (colMap.block > -1) {
            var blockVal = String(data[i][colMap.block]).trim();
            if (blockVal === 'نعم' || blockVal === 'true') {
              isBlocked = true;
            }
          }
          
          var regDate = colMap.regDate > -1 ? String(data[i][colMap.regDate] || "").trim() : "";

          foundStudents.push({
            name: name,
            code: studentCode,
            isPaid: payInfo.isPaid,
            missingMonths: payInfo.missingMonths,
            graceMonths: payInfo.graceMonths,
            graceDaysRemaining: payInfo.graceDaysRemaining,
            phone: searchPhone,
            originalStatus: payInfo.originalStatus,
            isBlocked: isBlocked,
            registrationDate: regDate
          });
        }
      }
      
      if (foundStudents.length > 0) {
        return respondJSON({status: 'success', student: foundStudents});
      } else {
        return respondJSON({status: 'error', message: 'الرقم غير مسجل لدينا.'});
      }
    }
    
    // 3. جلب النتائج
    else if (action === 'getResults') {
      var resultsSheet = ss.getSheetByName("النتائج");
      if (!resultsSheet) return respondJSON({status: 'success', data: []});
      
      var data = resultsSheet.getDataRange().getValues();
      var results = [];
      for (var i = 1; i < data.length; i++) {
        if(data[i][0] && data[i][1]) {
           results.push({
             date: data[i][0],
             name: data[i][1],
             phone: data[i][2],
             quiz: data[i][3],
             score: data[i][4],
             studentType: data[i][5] ? String(data[i][5]).trim() : ''
           });
        }
      }
      return respondJSON({status: 'success', data: results.reverse()});
    }

    // 4. جلب الطلبات المعلقة
    else if (action === 'getPendingRequests') {
      var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
      if (!reqSheet) return respondJSON({status: 'success', data: []});
      
      var data = reqSheet.getDataRange().getValues();
      var reqs = [];
      for (var i = 1; i < data.length; i++) {
        if(data[i][0]) reqs.push({ date: data[i][0], name: data[i][1], phone: data[i][2], method: data[i][3] });
      }
      return respondJSON({status: 'success', data: reqs});
    }

    // 4.1. جلب سجل المشتركين الأونلاين المعتمدين (مع مزامنة تلقائية ذكية إذا كان الشيت فارغاً)
    else if (action === 'getOnlineStudents') {
      var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
      if (!onlineSheet) {
        initAllSheets();
        onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
      }
      if (!onlineSheet) return respondJSON({status: 'success', data: []});
      
      var oData = onlineSheet.getDataRange().getValues();
      if (oData.length <= 1) {
        syncOnlineStudentsFromMainSheet(ss);
        oData = onlineSheet.getDataRange().getValues();
      }

      var oList = [];
      for (var oi = 1; oi < oData.length; oi++) {
        if (oData[oi][1] || oData[oi][2]) {
          oList.push({
            code: String(oData[oi][0] || '').trim(),
            name: String(oData[oi][1] || '').trim(),
            phone: cleanPhone(oData[oi][2]),
            stage: String(oData[oi][3] || '').trim(),
            packageType: String(oData[oi][4] || '').trim(),
            activeMonths: String(oData[oi][5] || '').trim(),
            method: String(oData[oi][6] || '').trim(),
            amount: String(oData[oi][7] || '').trim(),
            date: String(oData[oi][8] || '').trim(),
            notes: String(oData[oi][9] || '').trim()
          });
        }
      }
      return respondJSON({status: 'success', data: oList});
    }

    // 4.2. جلب أرشيف طلاب الأونلاين (المحذوفين أو المعلقين)
    else if (action === 'getArchivedOnlineStudents') {
      var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
      if (!archSheet) return respondJSON({status: 'success', data: []});
      var aData = archSheet.getDataRange().getValues();
      var aList = [];
      for (var ai = 1; ai < aData.length; ai++) {
        if (aData[ai][1] || aData[ai][2]) {
          aList.push({
            code: String(aData[ai][0] || '').trim(),
            name: String(aData[ai][1] || '').trim(),
            phone: cleanPhone(aData[ai][2]),
            stage: String(aData[ai][3] || '').trim(),
            packageType: String(aData[ai][4] || '').trim(),
            activeMonths: String(aData[ai][5] || '').trim(),
            method: String(aData[ai][6] || '').trim(),
            amount: String(aData[ai][7] || '').trim(),
            date: String(aData[ai][8] || '').trim(),
            notes: String(aData[ai][9] || '').trim(),
            reason: String(aData[ai][10] || '').trim()
          });
        }
      }
      return respondJSON({status: 'success', data: aList});
    }

    // 5. جلب الأسئلة من جوجل شيت (والخرائط التفاعلية) مدمج مع نظام الكاش السريع 🚀
    else if (action === 'getQuestions') {
      var cache = CacheService.getScriptCache();
      var cachedData = cache.get('questionsData');
      if (cachedData) {
        return ContentService.createTextOutput(cachedData).setMimeType(ContentService.MimeType.JSON);
      }
      
      var qSheet = ss.getSheetByName("الأسئلة");
      if (!qSheet) return respondJSON({status: 'error', message: 'شيت "الأسئلة" غير موجود في ملف الإكسيل.'});
      
      var qData = qSheet.getDataRange().getValues();
      var questions = [];
      
      for (var i = 1; i < qData.length; i++) {
        if (qData[i][0] && qData[i][3]) { 
          questions.push({
            unit: String(qData[i][0]),
            section: String(qData[i][1]),
            type: String(qData[i][2] || 'mcq'),
            q: String(qData[i][3]),
            opt1: String(qData[i][4] || ''),
            opt2: String(qData[i][5] || ''),
            opt3: String(qData[i][6] || ''),
            opt4: String(qData[i][7] || ''),
            correct: String(qData[i][8] || ''),
            reason: String(qData[i][9] || ''),
            concept: String(qData[i][10] || ''),
            paragraph: String(qData[i][11] || ''), 
            audio: String(qData[i][12] || ''),     
            video: String(qData[i][13] || ''),
            pdf: String(qData[i][14] || '')
          });
        }
      }

      var mapsData = [];
      var mapsSheet = ss.getSheetByName("الخرائط");
      if (mapsSheet) {
         var mData = mapsSheet.getDataRange().getValues();
         for (var k = 1; k < mData.length; k++) {
            if (mData[k][0] && mData[k][1]) { 
               mapsData.push({
                  id: 'map_' + k,
                  title: String(mData[k][0]),
                  url: String(mData[k][1])
               });
            }
         }
      }
      
      var responseStr = JSON.stringify({status: 'success', data: questions, maps: mapsData});
      
      try { 
        cache.put('questionsData', responseStr, 600); 
      } catch(e) {}
      
      return ContentService.createTextOutput(responseStr).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 6. مزامنة الاشتراكات سحابياً من Google Drive عبر GET (للتشغيل التلقائي عبر Triggers أو الروابط المباشرة)
    else if (action === 'syncDriveBackups') {
      var stage = e.parameter.stage || 's2';
      var folderId = e.parameter.folderId || '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM';
      var res = syncDriveBackupsCore(stage, folderId);
      return respondJSON(res);
    }

    // 7. جلب تسليمات وإجابات الأسئلة المقالية سحابياً
    else if (action === 'getEssaySubmissions') {
      var essaySheet = ss.getSheetByName("إجابات المقالي");
      if (!essaySheet) return respondJSON({status: 'success', data: []});
      var eData = essaySheet.getDataRange().getValues();
      var submissions = [];
      for (var ei = 1; ei < eData.length; ei++) {
        if (eData[ei][1] || eData[ei][2]) {
          submissions.push({
            date: String(eData[ei][0] || ''),
            studentName: String(eData[ei][1] || ''),
            studentPhone: String(eData[ei][2] || ''),
            quizTitle: String(eData[ei][3] || ''),
            questionText: String(eData[ei][4] || ''),
            studentAnswerText: String(eData[ei][5] || ''),
            teacherScore: eData[ei][6] !== undefined ? eData[ei][6] : '',
            teacherFeedback: String(eData[ei][7] || ''),
            status: String(eData[ei][8] || 'قيد المراجعة'),
            studentType: String(eData[ei][9] || 'سنتر')
          });
        }
      }
      return respondJSON({status: 'success', data: submissions});
    }
    
    return respondJSON({status: 'error', message: 'Unknown action'});

  } catch (err) {
    return respondJSON({status: 'error', message: err.message});
  }
}

// الدالة المسئولة عن حفظ وتعديل البيانات (Do Post) محصنة بنظام الطابور LockService
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    
    var payload = JSON.parse(e.postData.contents);
    if (payload.apiKey !== SECRET_API_KEY) {
      return respondJSON({status: 'error', message: 'Unauthorized Access'});
    }

    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === 'saveResult') {
      var resultsSheet = ss.getSheetByName("النتائج");
      if (!resultsSheet) {
        resultsSheet = ss.insertSheet("النتائج");
        resultsSheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "الاختبار / الدرس", "النتيجة", "نوع الطالب"]);
      }
      var sType = payload.studentType || (payload.phone && String(payload.phone).indexOf('ESON') > -1 ? 'أونلاين' : 'سنتر');
      var targetPhone = cleanPhone(payload.phone);
      var targetQuiz = String(payload.quiz || '').trim();
      var isResetAction = targetQuiz.indexOf('تصفير') > -1 || targetQuiz.indexOf('فرصة جديدة') > -1 || String(payload.score).indexOf('تصفير') > -1;

      // إذا كانت النتيجة عادية وليست تصفير، نتحقق إن كان للطالب سجل سابق لنفس الاختبار لتحديثه ومنع تكرار وتضخم الصفوف
      var updated = false;
      if (!isResetAction && targetPhone && targetQuiz) {
        var rData = resultsSheet.getDataRange().getValues();
        for (var ri = 1; ri < rData.length; ri++) {
          var rowPhone = cleanPhone(rData[ri][2]);
          var rowQuiz = String(rData[ri][3] || '').trim();
          var isRowReset = rowQuiz.indexOf('تصفير') > -1 || rowQuiz.indexOf('فرصة جديدة') > -1 || String(rData[ri][4]).indexOf('تصفير') > -1;
          if (rowPhone === targetPhone && !isRowReset && normTitle(rowQuiz) === normTitle(targetQuiz)) {
            resultsSheet.getRange(ri + 1, 1).setValue(payload.date || new Date().toLocaleString('ar-EG'));
            resultsSheet.getRange(ri + 1, 2).setValue(payload.name);
            resultsSheet.getRange(ri + 1, 5).setValue(payload.score);
            if (sType) resultsSheet.getRange(ri + 1, 6).setValue(sType);
            updated = true;
            break;
          }
        }
      }

      if (!updated) {
        resultsSheet.appendRow([payload.date || new Date().toLocaleString('ar-EG'), payload.name, payload.phone, payload.quiz, payload.score, sType]);
      }
      return respondJSON({status: 'success'});
    }
    
    // حفظ إجابات الأسئلة المقالية سحابياً في شيت مخصص
    else if (action === 'saveEssaySubmission') {
      var essaySheet = ss.getSheetByName("إجابات المقالي");
      if (!essaySheet) {
        essaySheet = ss.insertSheet("إجابات المقالي");
        essaySheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "اسم الاختبار", "السؤال المقالي", "إجابة الطالب", "درجة المعلم", "ملاحظات المعلم", "الحالة", "نوع الطالب"]);
      }
      var questions = payload.questions || [];
      var sType = payload.studentType || 'سنتر';
      var targetPhone = cleanPhone(payload.studentPhone);
      var targetQuiz = String(payload.quizTitle || '').trim();

      // تنظيف الصفوف القديمة لنفس الطالب ونفس الاختبار لمنع تكرار وتضخم الصفوف
      if (targetPhone && targetQuiz) {
        var eData = essaySheet.getDataRange().getValues();
        for (var di = eData.length - 1; di >= 1; di--) {
          if (cleanPhone(eData[di][2]) === targetPhone && normTitle(eData[di][3]) === normTitle(targetQuiz)) {
            essaySheet.deleteRow(di + 1);
          }
        }
      }

      if (Array.isArray(questions)) {
        questions.forEach(function(q) {
          essaySheet.appendRow([
            payload.date || new Date().toLocaleString('ar-EG'),
            payload.studentName,
            payload.studentPhone,
            payload.quizTitle,
            q.questionText || q.q,
            q.studentText || q.studentAnswerText || "",
            q.teacherScore !== undefined ? q.teacherScore : (q.aiScore !== undefined ? q.aiScore : ""),
            q.teacherFeedback || q.aiFeedback || "",
            payload.isApproved ? "معتمد" : "قيد المراجعة",
            sType
          ]);
        });
      }
      return respondJSON({status: 'success'});
    }

    // تحديث درجة وملاحظات المعلم لسؤال مقالي
    else if (action === 'updateEssayGrade') {
      var essaySheet = ss.getSheetByName("إجابات المقالي");
      if (essaySheet) {
        var eData = essaySheet.getDataRange().getValues();
        var targetPhone = cleanPhone(payload.studentPhone);
        var targetQuiz = String(payload.quizTitle || '').trim();
        var targetQText = payload.questionText ? String(payload.questionText).trim() : null;
        for (var ei = 1; ei < eData.length; ei++) {
          if (cleanPhone(eData[ei][2]) === targetPhone && (!targetQuiz || normTitle(eData[ei][3]) === normTitle(targetQuiz))) {
            var rowQText = String(eData[ei][4] || '').trim();
            // إذا كان التحديث لسؤال محدد بالاسم أو تحديث الحالة العامة فقط دون مساس بالدرجات الفردية
            if (!targetQText || rowQText === targetQText || normTitle(rowQText) === normTitle(targetQText)) {
              if (payload.teacherScore !== undefined && targetQText) essaySheet.getRange(ei + 1, 7).setValue(payload.teacherScore);
              if (payload.teacherFeedback !== undefined && targetQText) essaySheet.getRange(ei + 1, 8).setValue(payload.teacherFeedback);
              if (payload.isApproved !== undefined) essaySheet.getRange(ei + 1, 9).setValue(payload.isApproved ? "معتمد" : "قيد المراجعة");
              else if (payload.status) essaySheet.getRange(ei + 1, 9).setValue(payload.status);
            }
          }
        }
        return respondJSON({status: 'success'});
      }
      return respondJSON({status: 'error', message: 'شيت إجابات المقالي غير موجود'});
    }
    
    // دالة حظر وفك حظر طالب واحد
    else if (action === 'blockStudent' || action === 'unblockStudent') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex === -1) {
          blockColIndex = headers.length;
          studentsSheet.getRange(1, blockColIndex + 1).setValue("محظور");
       }
       
       var targetPhone = cleanPhone(payload.phone);
       var targetName = String(payload.name).trim();
       
       for (var i = 1; i < data.length; i++) {
           if (cleanPhone(data[i][colMap.phone]) === targetPhone && String(data[i][colMap.name]).trim() === targetName) {
               var val = action === 'blockStudent' ? 'نعم' : '';
               studentsSheet.getRange(i + 1, blockColIndex + 1).setValue(val);
               return respondJSON({status: 'success'});
           }
       }
       return respondJSON({status: 'error', message: 'لم يتم العثور على الطالب'});
    }

    // دالة الحظر الجماعي للطلاب غير المتفاعلين
    else if (action === 'blockMultipleStudents') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex === -1) { 
           blockColIndex = headers.length; 
           studentsSheet.getRange(1, blockColIndex + 1).setValue("محظور"); 
       }
       var targetList = payload.students;
       for (var i = 1; i < data.length; i++) {
           var rPhone = cleanPhone(data[i][colMap.phone]);
           var rName = String(data[i][colMap.name]).trim();
           for (var j = 0; j < targetList.length; j++) {
               if (rPhone === cleanPhone(targetList[j].phone) && rName === String(targetList[j].name).trim()) {
                   studentsSheet.getRange(i + 1, blockColIndex + 1).setValue('نعم');
                   break;
               }
           }
       }
       return respondJSON({status: 'success'});
    }

    // دالة فك الحظر الجماعي للطلاب المحظورين
    else if (action === 'unblockMultipleStudents') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex > -1) { 
           var targetList = payload.students;
           var targetSet = {};
           if (targetList && Array.isArray(targetList)) {
               for (var t = 0; t < targetList.length; t++) {
                   var key = cleanPhone(targetList[t].phone) + '_' + String(targetList[t].name).trim();
                   targetSet[key] = true;
               }
           }
           for (var i = 1; i < data.length; i++) {
               var rPhone = cleanPhone(data[i][colMap.phone]);
               var rName = String(data[i][colMap.name]).trim();
               var key = rPhone + '_' + rName;
               if (!targetList || targetSet[key]) {
                   studentsSheet.getRange(i + 1, blockColIndex + 1).setValue('');
               }
           }
       }
       return respondJSON({status: 'success'});
    }
    
    else if (action === 'saveDeviceFingerprint') {
      var devicesSheet = ss.getSheetByName("الأجهزة");
      if (!devicesSheet) {
        devicesSheet = ss.insertSheet("الأجهزة");
        devicesSheet.appendRow(["رقم الهاتف", "بصمة المتصفح (Fingerprint)", "تاريخ أول تسجيل دخول"]);
      }
      var data = devicesSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.phone)) {
           if (String(data[i][1]) !== String(payload.fingerprint)) {
               return respondJSON({status: 'blocked', message: 'لقد سبق واستخدم هذا الرقم في متصفح أو جهاز آخر.'});
           }
           return respondJSON({status: 'success'});
        }
      }
      var now = new Date().toLocaleString("ar-EG", {timeZone: "Africa/Cairo"});
      devicesSheet.appendRow([payload.phone, payload.fingerprint, now]);
      return respondJSON({status: 'success'});
    }

    else if (action === 'resetDevice') {
      var devicesSheet = ss.getSheetByName("الأجهزة");
      if (devicesSheet) {
        var data = devicesSheet.getDataRange().getValues();
        var targetPhone = String(payload.phone);
        var deleted = false;
        for (var i = data.length - 1; i > 0; i--) {
          if (String(data[i][0]) === targetPhone) {
             devicesSheet.deleteRow(i + 1);
             deleted = true;
          }
        }
        if(deleted) return respondJSON({status: 'success'});
        return respondJSON({status: 'error', message: 'لا يوجد جهاز مرتبط بهذا الطالب.'});
      }
      return respondJSON({status: 'error', message: 'شيت الأجهزة غير موجود.'});
    }

    else if (action === 'requestSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       if (!reqSheet) {
          reqSheet = ss.insertSheet("طلبات_الاشتراك");
          reqSheet.appendRow(["التاريخ", "الاسم", "رقم الهاتف", "طريقة الدفع", "الباقة المطلوبة", "المبلغ"]);
       }
       reqSheet.appendRow([payload.date, payload.name, payload.phone, payload.method, payload.packageType || 'شهري', payload.amount || '']);
       return respondJSON({status: 'success'});
    }
    
    else if (action === 'approveSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       if (reqSheet) {
          var data = reqSheet.getDataRange().getValues();
          for (var i = 1; i < data.length; i++) {
              if (cleanPhone(data[i][2]) === cleanPhone(payload.phone) && String(data[i][1]).trim() === String(payload.name).trim()) {
                  reqSheet.deleteRow(i + 1);
                  break;
              }
          }
       }
       var res = activateOnlineStudentCore(ss, payload);
       return respondJSON(res);
    }

    else if (action === 'addOnlineStudentDirectly') {
       var res = activateOnlineStudentCore(ss, payload);
       return respondJSON(res);
    }

    else if (action === 'syncExistingOnlineStudents') {
       var res = syncOnlineStudentsToMainSheet(ss);
       return respondJSON(res);
    }

    else if (action === 'renewOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       if (!onlineSheet) return respondJSON({status: 'error', message: 'شيت طلاب الأونلاين غير موجود'});
       var targetPhone = cleanPhone(payload.phone);
       var oData = onlineSheet.getDataRange().getValues();
       var updated = false;
       for (var oi = 1; oi < oData.length; oi++) {
          if (cleanPhone(oData[oi][2]) === targetPhone) {
             var currentMonths = String(oData[oi][5] || '').trim();
             var newMonth = String(payload.month || '').trim();
             var newPkg = String(payload.packageType || oData[oi][4]).trim();
             var combinedMonths = currentMonths;
             if (newMonth && combinedMonths.indexOf(newMonth) === -1) {
                combinedMonths = combinedMonths ? (combinedMonths + '، ' + newMonth) : newMonth;
             }
             if (newPkg.indexOf('ترم') > -1 || newPkg.indexOf('سنة') > -1) {
                combinedMonths = newPkg;
             }
             var renewDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
             onlineSheet.getRange(oi + 1, 5).setValue(newPkg);
             onlineSheet.getRange(oi + 1, 6).setValue(combinedMonths);
             if (payload.amount) onlineSheet.getRange(oi + 1, 8).setValue(payload.amount);
             onlineSheet.getRange(oi + 1, 9).setValue(renewDate);
             onlineSheet.getRange(oi + 1, 10).setValue('نشط');
             updated = true;
             break;
          }
       }
       syncOnlineStudentsToMainSheet(ss);
       return respondJSON({status: updated ? 'success' : 'error'});
    }

    else if (action === 'editOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       if (!onlineSheet) return respondJSON({status: 'error', message: 'شيت طلاب الأونلاين غير موجود'});
       var oldPhone = cleanPhone(payload.oldPhone || payload.phone);
       var newPhone = cleanPhone(payload.newPhone || payload.phone);
       var newName = String(payload.name || '').trim();
       var newPkg = String(payload.packageType || '').trim();
       var oData = onlineSheet.getDataRange().getValues();
       var updated = false;
       for (var oi = 1; oi < oData.length; oi++) {
          if (cleanPhone(oData[oi][2]) === oldPhone) {
             if (newName) onlineSheet.getRange(oi + 1, 2).setValue(newName);
             if (newPhone) {
                var fP = newPhone.startsWith('0') ? newPhone : ('0' + newPhone);
                onlineSheet.getRange(oi + 1, 3).setValue("'" + fP);
             }
             if (newPkg) onlineSheet.getRange(oi + 1, 5).setValue(newPkg);
             if (payload.amount) onlineSheet.getRange(oi + 1, 8).setValue(payload.amount);
             updated = true;
             break;
          }
       }
       syncOnlineStudentsToMainSheet(ss);
       return respondJSON({status: updated ? 'success' : 'error'});
    }

    else if (action === 'resetOnlineDevice') {
       var devSheet = ss.getSheetByName("الأجهزة");
       if (!devSheet) return respondJSON({status: 'success', message: 'شيت الأجهزة غير موجود'});
       var targetPhone = cleanPhone(payload.phone);
       var dData = devSheet.getDataRange().getValues();
       var deletedCount = 0;
       for (var di = dData.length - 1; di >= 1; di--) {
          var rowKey = String(dData[di][0] || '');
          if (rowKey.indexOf(targetPhone) > -1 || cleanPhone(rowKey) === targetPhone) {
             devSheet.deleteRow(di + 1);
             deletedCount++;
          }
       }
       return respondJSON({status: 'success', deleted: deletedCount});
    }

    else if (action === 'restoreArchivedOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
       if (!onlineSheet || !archSheet) return respondJSON({status: 'error', message: 'الشيتات غير موجودة'});
       var targetPhone = cleanPhone(payload.phone);
       var aData = archSheet.getDataRange().getValues();
       for (var ai = 1; ai < aData.length; ai++) {
          if (cleanPhone(aData[ai][2]) === targetPhone) {
             var row = aData[ai];
             var actDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
             onlineSheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], actDate, "نشط"]);
             archSheet.deleteRow(ai + 1);
             break;
          }
       }
       syncOnlineStudentsToMainSheet(ss);
       return respondJSON({status: 'success'});
    }

    else if (action === 'deleteOnlineStudent') {
       var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
       var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
       if (!archSheet) {
          archSheet = ss.insertSheet("أرشيف_الأونلاين");
          archSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "تاريخ الحذف", "سبب الحذف"]);
          archSheet.getRange(1, 1, 1, 11).setBackground("#991b1b").setFontColor("#ffffff").setFontWeight("bold");
          archSheet.setFrozenRows(1);
          archSheet.getRange("C:C").setNumberFormat("@");
       }

       var targetPhone = cleanPhone(payload.phone);
       if (onlineSheet) {
          var oData = onlineSheet.getDataRange().getValues();
          for (var oi = 1; oi < oData.length; oi++) {
             if (cleanPhone(oData[oi][2]) === targetPhone || String(oData[oi][1]).trim() === String(payload.name).trim()) {
                var delDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
                var oldRow = oData[oi];
                archSheet.appendRow([oldRow[0], oldRow[1], oldRow[2], oldRow[3], oldRow[4], oldRow[5], oldRow[6], oldRow[7], oldRow[8], delDate, payload.reason || "حذف يدوي بواسطة الإدارة"]);
                onlineSheet.deleteRow(oi + 1);
                break;
             }
          }
       }
       // تعطيل الطالب في شيت الطلاب أيضاً لمنع دخوله
       var sSheet = ss.getSheetByName("الطلاب");
       if (sSheet) {
          var sData = sSheet.getDataRange().getValues();
          var colMap = findColumnIndices(sData[0]);
          for (var si = 1; si < sData.length; si++) {
             if (cleanPhone(sData[si][colMap.phone]) === targetPhone) {
                if (colMap.status > -1) sSheet.getRange(si + 1, colMap.status + 1).setValue("محظور");
                break;
             }
          }
       }
       return respondJSON({status: 'success'});
    }

    else if (action === 'rejectSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       var data = reqSheet.getDataRange().getValues();
       for (var i = 1; i < data.length; i++) {
           if (String(data[i][2]).trim() === String(payload.phone).trim() && String(data[i][1]).trim() === String(payload.name).trim()) {
               reqSheet.deleteRow(i + 1);
               return respondJSON({status: 'success'});
           }
       }
       return respondJSON({status: 'error'});
    }

    else if (action === 'activateSpecificMonth') {
      var studentsSheet = ss.getSheetByName("الطلاب");
      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var colMap = findColumnIndices(headers);
      var targetPhone = cleanPhone(payload.phone);
      var monthIndex = headers.indexOf(payload.month);
      
      if (monthIndex > -1) {
          var paymentDateString = "تم التفعيل " + new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
          for (var i = 1; i < data.length; i++) {
            if (cleanPhone(data[i][colMap.phone]) === targetPhone) {
               studentsSheet.getRange(i + 1, monthIndex + 1).setValue(paymentDateString);
               return respondJSON({status: 'success'});
            }
          }
      }
      return respondJSON({status: 'error'});
    }
    
    else if (action === 'updateSettings') {
       var settingsSheet = ss.getSheetByName("الإعدادات");
       if (!settingsSheet) {
          settingsSheet = ss.insertSheet("الإعدادات");
          settingsSheet.appendRow(["قيمة الاشتراك", "الإشعار", "إعدادات العداد", "الوحدة المستهدفة", "وقت السؤال", "الدروس المنشورة"]);
       }
       var headers = settingsSheet.getDataRange().getValues()[0];
       if (headers.indexOf("الإشعار") === -1) settingsSheet.getRange(1, 2).setValue("الإشعار");
       if (headers.indexOf("إعدادات العداد") === -1) settingsSheet.getRange(1, 3).setValue("إعدادات العداد");
       if (headers.indexOf("الوحدة المستهدفة") === -1) settingsSheet.getRange(1, 4).setValue("الوحدة المستهدفة");
       if (headers.indexOf("وقت السؤال") === -1) settingsSheet.getRange(1, 5).setValue("وقت السؤال");
       if (headers.indexOf("الدروس المنشورة") === -1) settingsSheet.getRange(1, 6).setValue("الدروس المنشورة");
        if (headers.indexOf("نوع العداد") === -1) settingsSheet.getRange(1, 7).setValue("نوع العداد");
        if (headers.indexOf("وقت الامتحان الكلي") === -1) settingsSheet.getRange(1, 8).setValue("وقت الامتحان الكلي");
        if (headers.indexOf("مفتاح الذكاء الاصطناعي") === -1) settingsSheet.getRange(1, 9).setValue("مفتاح الذكاء الاصطناعي");
        if (headers.indexOf("كشكول الأخطاء") === -1) settingsSheet.getRange(1, 10).setValue("كشكول الأخطاء");
        if (headers.indexOf("أزرار التصفير") === -1) settingsSheet.getRange(1, 11).setValue("أزرار التصفير");
        if (headers.indexOf("إعدادات الشهادات") === -1) settingsSheet.getRange(1, 12).setValue("إعدادات الشهادات");
        if (headers.indexOf("إعدادات الأمان ومكافحة الغش") === -1) settingsSheet.getRange(1, 13).setValue("إعدادات الأمان ومكافحة الغش");
        if (headers.indexOf("جداول ومواعيد الامتحانات") === -1) settingsSheet.getRange(1, 14).setValue("جداول ومواعيد الامتحانات");

       settingsSheet.getRange(2, 1).setValue(payload.fee);
       settingsSheet.getRange(2, 2).setValue(payload.announcement || "");
       
       if (payload.timerMode !== undefined) settingsSheet.getRange(2, 3).setValue(payload.timerMode);
       if (payload.timerUnitTarget !== undefined) settingsSheet.getRange(2, 4).setValue(payload.timerUnitTarget);
       if (payload.timerSecondsPerQ !== undefined) settingsSheet.getRange(2, 5).setValue(payload.timerSecondsPerQ);
       if (payload.publishedLessons !== undefined) settingsSheet.getRange(2, 6).setValue(payload.publishedLessons);
        if (payload.timerType !== undefined) settingsSheet.getRange(2, 7).setValue(payload.timerType);
        if (payload.examTotalMinutes !== undefined) settingsSheet.getRange(2, 8).setValue(payload.examTotalMinutes);
        if (payload.geminiApiKey !== undefined) settingsSheet.getRange(2, 9).setValue(payload.geminiApiKey);
        if (payload.showMistakesNotebook !== undefined) settingsSheet.getRange(2, 10).setValue(payload.showMistakesNotebook);
        if (payload.showResetButtons !== undefined) settingsSheet.getRange(2, 11).setValue(payload.showResetButtons);
        if (payload.certSettings !== undefined) settingsSheet.getRange(2, 12).setValue(payload.certSettings);
        if (payload.securitySettings !== undefined) settingsSheet.getRange(2, 13).setValue(payload.securitySettings);
        if (payload.examConfigs !== undefined) settingsSheet.getRange(2, 14).setValue(payload.examConfigs);
        
        return respondJSON({status: 'success'});
     }

     // 7. مزامنة الاشتراكات سحابياً من Google Drive عبر POST
     else if (action === 'syncDriveBackups') {
       var stage = payload.stage || 's2';
       var folderId = payload.folderId || '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM';
       var res = syncDriveBackupsCore(stage, folderId);
       return respondJSON(res);
     }

     // 8. مزامنة الاشتراكات محلياً عبر رفع ملف JSON
     else if (action === 'syncLocalBackup') {
       var stage = payload.stage || 's2';
       var res = applyBackupToSheet(payload.students, payload.transactions, stage);
       return respondJSON(res);
     }

     // 9. رفع ملف PDF لمذكرة الدرس وحفظه في Google Drive وكتابة الرابط في خانة واحدة فقط بشيت الأسئلة
     else if (action === 'uploadPdfFile') {
       var folderName = "مذكرات_الكنز_التعليمي";
       var folders = DriveApp.getFoldersByName(folderName);
       var targetFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
       targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
       
       var base64Data = payload.base64;
       var rawName = String(payload.fileName || ("مذكرة_" + (payload.lessonTitle || "درس")));
       var cleanTitle = rawName.replace(/\.pdf$/i, '').trim();
       var diskFileName = cleanTitle + ".pdf";
       var decoded = Utilities.base64Decode(base64Data);
       var blob = Utilities.newBlob(decoded, "application/pdf", diskFileName);
       var file = targetFolder.createFile(blob);
       file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
       var fileId = file.getId();
       var previewUrl = "https://drive.google.com/file/d/" + fileId + "/preview";
       var downloadUrl = "https://drive.google.com/uc?export=download&id=" + fileId;
       var fileUrl = file.getUrl();
       var cellEntry = cleanTitle + " | " + previewUrl;

       if (payload.lessonTitle) {
         var qSheet = ss.getSheetByName("الأسئلة");
         if (qSheet) {
           var qData = qSheet.getDataRange().getValues();
           if (qData.length > 0 && !qData[0][14]) {
             qSheet.getRange(1, 15).setValue("مذكرة_PDF");
           }
           var targetTitle = String(payload.lessonTitle).trim();
           var lessonRowIndices = [];
           for (var qi = 1; qi < qData.length; qi++) {
             if (String(qData[qi][1] || '').trim() === targetTitle) {
               lessonRowIndices.push(qi + 1);
             }
           }

           if (lessonRowIndices.length > 0) {
             // تنظيف التكرارات القديمة إن وُجدت
             var firstRowIdx = lessonRowIndices[0];
             var firstVal = String(qSheet.getRange(firstRowIdx, 15).getValue() || '').trim();
             if (lessonRowIndices.length > 1 && firstVal !== '') {
               var isAllSame = true;
               for (var k = 1; k < lessonRowIndices.length; k++) {
                 var valK = String(qSheet.getRange(lessonRowIndices[k], 15).getValue() || '').trim();
                 if (valK !== firstVal) {
                   isAllSame = false;
                   break;
                 }
               }
               if (isAllSame) {
                 for (var c = 1; c < lessonRowIndices.length; c++) {
                   qSheet.getRange(lessonRowIndices[c], 15).setValue('');
                 }
               }
             }

             // كتابة الرابط في خانة واحدة فقط (أول صف فارغ خاص بالدرس، لإتاحة رفع مذكرات متعددة)
             var targetRowToWrite = -1;
             var shouldReplace = payload.replace === true;
             if (shouldReplace) {
               targetRowToWrite = firstRowIdx;
             } else {
               for (var r = 0; r < lessonRowIndices.length; r++) {
                 var cellVal = String(qSheet.getRange(lessonRowIndices[r], 15).getValue() || '').trim();
                 if (cellVal === '') {
                   targetRowToWrite = lessonRowIndices[r];
                   break;
                 }
               }
               if (targetRowToWrite === -1) {
                 targetRowToWrite = firstRowIdx;
               }
             }

             qSheet.getRange(targetRowToWrite, 15).setValue(cellEntry);
           }
         }
       }
       return respondJSON({ 
         status: 'success', 
         fileId: fileId, 
         previewUrl: previewUrl, 
         downloadUrl: downloadUrl, 
         fileUrl: fileUrl,
         fileName: cleanTitle,
         cellEntry: cellEntry
       });
     }

     // 10. تحديث أو إزالة رابط مذكرة الـ PDF لدرس محدد في شيت الأسئلة (خانة واحدة فقط)
     else if (action === 'updateLessonPdfLink') {
       var qSheet = ss.getSheetByName("الأسئلة");
       if (!qSheet) return respondJSON({status: 'error', message: 'شيت الأسئلة غير موجود'});
       var qData = qSheet.getDataRange().getValues();
       if (qData.length > 0 && !qData[0][14]) {
         qSheet.getRange(1, 15).setValue("مذكرة_PDF");
       }
       var targetTitle = String(payload.lessonTitle || '').trim();
       var newPdfUrl = String(payload.pdfUrl || '').trim();
       var customFileName = String(payload.fileName || '').replace(/\.pdf$/i, '').trim();
       var removeUrl = String(payload.removeUrl || '').trim();

       var lessonRowIndices = [];
       for (var qi = 1; qi < qData.length; qi++) {
         if (String(qData[qi][1] || '').trim() === targetTitle) {
           lessonRowIndices.push(qi + 1);
         }
       }

       if (lessonRowIndices.length > 0) {
         // حذف رابط محدد فقط
         if (removeUrl) {
           for (var r = 0; r < lessonRowIndices.length; r++) {
             var val = String(qSheet.getRange(lessonRowIndices[r], 15).getValue() || '').trim();
             if (val.indexOf(removeUrl) !== -1) {
               qSheet.getRange(lessonRowIndices[r], 15).setValue('');
             }
           }
         }
         // تفريغ كافة المذكرات
         else if (newPdfUrl === '') {
           for (var r = 0; r < lessonRowIndices.length; r++) {
             qSheet.getRange(lessonRowIndices[r], 15).setValue('');
           }
         }
         // إضافة أو تحديث رابط يدوي في أول صف فارغ أو أول صف
         else {
           var formattedEntry = newPdfUrl;
           if (customFileName && newPdfUrl.indexOf('|') === -1) {
             formattedEntry = customFileName + " | " + newPdfUrl;
           }

           var firstRowIdx = lessonRowIndices[0];
           var firstVal = String(qSheet.getRange(firstRowIdx, 15).getValue() || '').trim();
           if (lessonRowIndices.length > 1 && firstVal !== '') {
             var isAllSame = true;
             for (var k = 1; k < lessonRowIndices.length; k++) {
               var valK = String(qSheet.getRange(lessonRowIndices[k], 15).getValue() || '').trim();
               if (valK !== firstVal) {
                 isAllSame = false;
                 break;
               }
             }
             if (isAllSame) {
               for (var c = 1; c < lessonRowIndices.length; c++) {
                 qSheet.getRange(lessonRowIndices[c], 15).setValue('');
               }
             }
           }

           var targetRowToWrite = -1;
           for (var r = 0; r < lessonRowIndices.length; r++) {
             var curVal = String(qSheet.getRange(lessonRowIndices[r], 15).getValue() || '').trim();
             if (curVal === '' || curVal.indexOf(newPdfUrl) !== -1) {
               targetRowToWrite = lessonRowIndices[r];
               break;
             }
           }
           if (targetRowToWrite === -1) targetRowToWrite = firstRowIdx;

           qSheet.getRange(targetRowToWrite, 15).setValue(formattedEntry);
         }
       }
       return respondJSON({status: 'success'});
     }

     // 11. جلب بايتس ملف PDF سحابياً لتطبيق العلامة المائية وتفادي مشاكل الـ CORS
     else if (action === 'getPdfBase64') {
       var fileId = payload.fileId;
       var rawUrl = String(payload.url || '');
       if (!fileId && rawUrl) {
         var match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || rawUrl.match(/id=([a-zA-Z0-9_-]+)/);
         if (match) fileId = match[1];
       }
       if (fileId) {
         try {
           var file = DriveApp.getFileById(fileId);
           var bytes = file.getBlob().getBytes();
           var base64 = Utilities.base64Encode(bytes);
           return respondJSON({ status: 'success', base64: base64, fileName: file.getName() });
         } catch (err) {
           return respondJSON({ status: 'error', message: err.message });
         }
       }
       return respondJSON({ status: 'error', message: 'معرف الملف غير صحيح' });
     }

  } catch (error) {
    return respondJSON({status: 'error', message: error.message});
  } finally {
    lock.releaseLock();
  }
}

// دالة ذكية لمعرفة رقم الشهر الأكاديمي من رأس العمود
function getMonthNum(h) {
  if (!h) return null;
  var s = String(h).trim();
  if (s.indexOf("سبتمبر") > -1) return 9;
  if (s.indexOf("أكتوبر") > -1 || s.indexOf("اكتوبر") > -1) return 10;
  if (s.indexOf("نوفمبر") > -1) return 11;
  if (s.indexOf("ديسمبر") > -1) return 12;
  if (s.indexOf("يناير") > -1) return 1;
  if (s.indexOf("فبراير") > -1) return 2;
  if (s.indexOf("مارس") > -1) return 3;
  if (s.indexOf("أبريل") > -1 || s.indexOf("ابريل") > -1) return 4;
  if (s.indexOf("مايو") > -1) return 5;
  return null;
}

// دالة فحص ما إذا كانت الخلية تدل على السداد أو الإعفاء وعدم المطالبة
function isCellValPaid(val) {
  if (val === undefined || val === null) return false;
  var str = String(val).trim();
  if (!str) return false;
  // حالات الإعفاء وعدم المطالبة (تعتبر مقبولة ولا توقف حساب الطالب):
  if (str.indexOf('غير مطالب') > -1 || str.indexOf('لم يحضر') > -1 || str.indexOf('انقطاع') > -1 || 
      str.indexOf('معفي') > -1 || str.indexOf('معفى') > -1 || str.indexOf('مجاني') > -1 || 
      str.indexOf('تأجيل') > -1 || str.indexOf('غير مسجل') > -1) {
    return true;
  }
  // حالات عدم السداد والتأخير الصريحة:
  if (str === '-' || str === '0' || str === '٠' || str === 'لا' || str === 'false') return false;
  if (str.indexOf('متأخر') > -1 || str.indexOf('متاخر') > -1 || str.indexOf('غير مسدد') > -1 || 
      str.indexOf('لم يسدد') > -1 || str.indexOf('لم يدفع') > -1 || str.indexOf('متبقي') > -1) {
    return false;
  }
  return true;
}

// دالة ذكية لاكتشاف مواقع الأعمدة تلقائياً سواء كان الشيت القديم أو الجديد
function findColumnIndices(headers) {
  var nameCol = -1, codeCol = -1, statusCol = -1, phoneCol = -1, blockCol = -1, stageCol = -1, genderCol = -1, regDateCol = -1;
  var nonMonthCols = [];

  for (var h = 0; h < headers.length; h++) {
    var hStr = String(headers[h] || "").trim();
    if (getMonthNum(hStr) !== null) {
      continue; // أعمدة الشهور لا تُضاف لـ nonMonthCols إطلاقاً
    }
    if (hStr === "الاسم" || hStr === "اسم الطالب" || hStr.indexOf("الاسم") > -1) {
      if (nameCol === -1) { nameCol = h; nonMonthCols.push(h); }
    } else if (hStr === "كود الطالب" || hStr === "الكود" || hStr === "كود" || hStr.indexOf("كود") > -1) {
      if (codeCol === -1) { codeCol = h; nonMonthCols.push(h); }
    } else if (hStr === "الحالة المالية" || hStr === "الحالة" || hStr.indexOf("حالة") > -1) {
      if (statusCol === -1) { statusCol = h; nonMonthCols.push(h); }
    } else if (hStr === "الهاتف" || hStr === "رقم الهاتف" || hStr === "الموبايل" || hStr.indexOf("هاتف") > -1 || hStr.indexOf("موبايل") > -1 || hStr.indexOf("تليفون") > -1 || hStr.indexOf("محمول") > -1) {
      if (phoneCol === -1) { phoneCol = h; nonMonthCols.push(h); }
    } else if (hStr === "محظور" || hStr === "الحظر" || hStr.indexOf("حظر") > -1) {
      if (blockCol === -1) { blockCol = h; nonMonthCols.push(h); }
    } else if (hStr === "المرحلة" || hStr === "الصف" || hStr.indexOf("مرحلة") > -1 || hStr.indexOf("صف") > -1) {
      if (stageCol === -1) { stageCol = h; nonMonthCols.push(h); }
    } else if (hStr === "النوع" || hStr === "الجنس" || hStr.indexOf("نوع") > -1) {
      if (genderCol === -1) { genderCol = h; nonMonthCols.push(h); }
    } else if (hStr.indexOf("تسجيل") > -1 || hStr.indexOf("انضمام") > -1 || hStr.indexOf("تاريخ") > -1) {
      if (regDateCol === -1) { regDateCol = h; nonMonthCols.push(h); }
    } else if (hStr === "ملاحظات" || hStr.indexOf("ملاحظ") > -1 || hStr.indexOf("أغسطس") > -1 || hStr.indexOf("اغسطس") > -1) {
      nonMonthCols.push(h);
    }
  }

  // قيم افتراضية ذكية: فقط إذا لم يكن العمود عمود شهر
  if (nameCol === -1 && getMonthNum(headers[0]) === null) { nameCol = 0; nonMonthCols.push(0); }
  if (codeCol === -1 && getMonthNum(headers[1]) === null) { codeCol = 1; nonMonthCols.push(1); }
  if (statusCol === -1 && getMonthNum(headers[2]) === null) { statusCol = 2; nonMonthCols.push(2); }
  if (phoneCol === -1) {
    for (var pIdx = 0; pIdx < headers.length; pIdx++) {
      if (nonMonthCols.indexOf(pIdx) === -1 && getMonthNum(headers[pIdx]) === null) {
        phoneCol = pIdx;
        nonMonthCols.push(pIdx);
        break;
      }
    }
  }

  return {
    name: nameCol,
    code: codeCol,
    status: statusCol,
    phone: phoneCol,
    block: blockCol,
    stage: stageCol,
    gender: genderCol,
    regDate: regDateCol,
    nonMonthCols: nonMonthCols
  };
}

// دالة حساب المتأخرات وفترة السماح الذكية (حتى يوم 5) مع مراعاة الإعفاء وتجاهل أغسطس
function calculateStudentPaymentStatus(headers, rowData, colMap) {
  var status = colMap.status > -1 ? String(rowData[colMap.status] || "").trim() : "";
  var isExempt = (status.indexOf('معفي') > -1 || status.indexOf('معفى') > -1 || status.indexOf('مجاني') > -1);

  if (isExempt) {
    return {
      isPaid: true,
      missingMonths: [],
      graceMonths: [],
      graceDaysRemaining: 0,
      originalStatus: "معفي"
    };
  }

  var now = new Date();
  var currentDay = parseInt(Utilities.formatDate(now, "Africa/Cairo", "d"), 10);
  var currentMonth = parseInt(Utilities.formatDate(now, "Africa/Cairo", "M"), 10);

  // فحص هل الطالب هو طالب أونلاين
  var stCode = colMap.code > -1 ? String(rowData[colMap.code] || '').trim() : '';
  var genderVal = colMap.gender > -1 ? String(rowData[colMap.gender] || '').trim() : '';
  var isOnline = genderVal.indexOf('أونلاين') > -1 || genderVal.indexOf('اونلاين') > -1 || stCode.indexOf('ESON') > -1;

  if (isOnline) {
    var paidOnlineMonths = [];
    for (var k = 0; k < headers.length; k++) {
      if (colMap.nonMonthCols.indexOf(k) > -1) continue;
      var hN = String(headers[k] || "").trim();
      var cV = String(rowData[k] || "").trim();
      if (isCellValPaid(cV)) {
        paidOnlineMonths.push(hN);
      }
    }

    var currentMonthName = currentMonth === 10 ? "أكتوبر" : (currentMonth === 9 ? "سبتمبر" : "أكتوبر");
    var isCurrentMonthPaid = paidOnlineMonths.some(function(pm) { return getMonthNum(pm) === currentMonth; });
    var hasTermOrYear = paidOnlineMonths.length >= 4;

    if (isCurrentMonthPaid || hasTermOrYear) {
      return {
        isPaid: true,
        missingMonths: [],
        graceMonths: [],
        graceDaysRemaining: 0,
        originalStatus: "أونلاين نشط"
      };
    }

    var prevMonthNum = currentMonth === 1 ? 12 : currentMonth - 1;
    var isPrevPaid = paidOnlineMonths.some(function(pm) { return getMonthNum(pm) === prevMonthNum; });

    if (isPrevPaid && currentDay <= 5) {
      return {
        isPaid: true,
        missingMonths: [],
        graceMonths: [currentMonthName],
        graceDaysRemaining: Math.max(0, 5 - currentDay),
        originalStatus: "أونلاين سماح"
      };
    }

    return {
      isPaid: false,
      missingMonths: [currentMonthName],
      graceMonths: [],
      graceDaysRemaining: 0,
      originalStatus: "أونلاين منتهي"
    };
  }

  var toAcademicIndex = function(m) {
    return m >= 9 ? (m - 8) : (m + 4);
  };

  var acadCurrent = toAcademicIndex(currentMonth);
  var hardOverdueMonths = [];
  var graceMonths = [];

  for (var j = 0; j < headers.length; j++) {
    if (colMap.nonMonthCols.indexOf(j) > -1) continue;

    var headerName = String(headers[j] || "").trim();
    if (headerName.indexOf("أغسطس") > -1 || headerName.indexOf("اغسطس") > -1) continue;

    var targetMonthNum = getMonthNum(headerName);
    if (!targetMonthNum) continue;

    var acadTarget = toAcademicIndex(targetMonthNum);

    var cellValue = String(rowData[j] || "").trim();
    var isCellPaid = isCellValPaid(cellValue);

    if (!isCellPaid) {
      if (acadTarget > acadCurrent) {
        // شهر قادم: لم يحن وقته بعد
      } else if (acadTarget === acadCurrent) {
        // الشهر الحالي (مثلاً أكتوبر ونحن في شهر أكتوبر):
        // مهلة سداد هذا الشهر ممتدة حتى يوم 5 من الشهر التالي (5/11)
        // لا يُعتبر متأخراً ولا يوقف حساب الطالب طوال الشهر
      } else if (acadTarget === acadCurrent - 1) {
        // الشهر السابق مباشرة (مثلاً سبتمبر ونحن في أكتوبر):
        if (currentDay >= 5) {
          hardOverdueMonths.push(headerName);
        } else {
          graceMonths.push(headerName);
        }
      } else {
        // شهر سابق بأكثر من شهر وما زال غير مسدد: متأخر تماماً
        hardOverdueMonths.push(headerName);
      }
    }
  }

  var isPaid = (hardOverdueMonths.length === 0);
  var graceDaysRemaining = Math.max(0, 5 - currentDay);

  return {
    isPaid: isPaid,
    missingMonths: hardOverdueMonths,
    graceMonths: graceMonths,
    graceDaysRemaining: graceDaysRemaining,
    originalStatus: status
  };
}

// دالة مساعدة لإرجاع البيانات بتنسيق JSON نظيف
function respondJSON(responseObject) {
  return ContentService.createTextOutput(JSON.stringify(responseObject)).setMimeType(ContentService.MimeType.JSON);
}

// دالة تنظيف أرقام الهواتف (تحويل الأرقام العربية إلى إنجليزية وإزالة المسافات والعلامات)

// دالة توحيد الحروف العربية لمطابقة الأسماء بدقة
function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\\s+/g, ' ')
    .trim();
}


// -------------------------------------------------------------------------
// دوال إدارة وتوليد أكواد طلاب الأونلاين ومزامنتهم
// -------------------------------------------------------------------------
function generateOnlineStudentCode(name, phone) {
  var cleanP = cleanPhone(phone);
  var last4 = cleanP.length >= 4 ? cleanP.slice(-4) : ('0000' + cleanP).slice(-4);
  
  var mapChar = {
    'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': 'A',
    'ب': 'B', 'ت': 'T', 'ث': 'T', 'ج': 'G', 'ح': 'H',
    'خ': 'K', 'د': 'D', 'ذ': 'Z', 'ر': 'R', 'ز': 'Z',
    'س': 'S', 'ش': 'S', 'ص': 'S', 'ض': 'D', 'ط': 'T',
    'ظ': 'Z', 'ع': 'A', 'غ': 'G', 'ف': 'F', 'ق': 'K',
    'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H',
    'ة': 'H', 'و': 'W', 'ي': 'Y', 'ى': 'Y'
  };
  
  var firstLetter = 'A';
  if (name && String(name).trim().length > 0) {
    var rawFirst = String(name).trim().charAt(0);
    if (/[a-zA-Z]/.test(rawFirst)) {
      firstLetter = rawFirst.toUpperCase();
    } else if (mapChar[rawFirst]) {
      firstLetter = mapChar[rawFirst];
    }
  }
  
  // التركيبة المعتمدة: [حرف الاسم] + [آخر 4 أرقام] + [ES] + [ON]
  return firstLetter + last4 + "ESON";
}

function getResolvedMonths(packageType, activeMonthsStr) {
  var pStr = String(packageType || '').trim();
  var mStr = String(activeMonthsStr || '').trim();
  var fullStr = pStr + ' ' + mStr;

  if (fullStr.indexOf('سنة') > -1 || fullStr.indexOf('العام') > -1) {
    return ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
  }
  if (fullStr.indexOf('ترم أول') > -1 || fullStr.indexOf('الترم الأول') > -1) {
    return ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير'];
  }
  if (fullStr.indexOf('ترم ثانٍ') > -1 || fullStr.indexOf('الترم الثاني') > -1 || fullStr.indexOf('ترم ثاني') > -1) {
    return ['فبراير', 'مارس', 'أبريل', 'مايو'];
  }

  var standardMonths = ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
  var foundMonths = [];
  standardMonths.forEach(function(m) {
    if (fullStr.indexOf(m) > -1) {
      foundMonths.push(m);
    }
  });

  return foundMonths.length > 0 ? foundMonths : ['أكتوبر'];
}

function syncSingleOnlineStudentToMainSheet(studentsSheet, st) {
  var data = studentsSheet.getDataRange().getValues();
  var headers = data[0];
  var colMap = findColumnIndices(headers);
  var targetPhone = cleanPhone(st.phone);
  
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (cleanPhone(data[i][colMap.phone]) === targetPhone) {
      foundRow = i + 1;
      break;
    }
  }

  var resolvedMonths = getResolvedMonths(st.packageType, st.activeMonthsRaw || st.activeMonths);
  var formattedP = targetPhone.startsWith('0') ? targetPhone : ('0' + targetPhone);

  if (foundRow > -1) {
    if (colMap.name > -1 && st.name) studentsSheet.getRange(foundRow, colMap.name + 1).setValue(st.name);
    if (colMap.code > -1 && st.code) studentsSheet.getRange(foundRow, colMap.code + 1).setValue("'" + st.code);
    if (colMap.status > -1) studentsSheet.getRange(foundRow, colMap.status + 1).setValue(st.status === 'ملغي' ? 'محظور' : 'منتظم');
    if (colMap.stage > -1 && st.stage) studentsSheet.getRange(foundRow, colMap.stage + 1).setValue(st.stage);
    if (colMap.gender > -1) studentsSheet.getRange(foundRow, colMap.gender + 1).setValue("أونلاين");
    if (colMap.phone > -1) studentsSheet.getRange(foundRow, colMap.phone + 1).setValue("'" + formattedP);

    resolvedMonths.forEach(function(m) {
      var mIdx = headers.indexOf(m);
      if (mIdx > -1) {
        studentsSheet.getRange(foundRow, mIdx + 1).setValue("مسدد");
      }
    });
  } else {
    var newRow = new Array(headers.length).fill('');
    if (colMap.name > -1) newRow[colMap.name] = st.name;
    if (colMap.code > -1) newRow[colMap.code] = "'" + st.code;
    if (colMap.status > -1) newRow[colMap.status] = st.status === 'ملغي' ? 'محظور' : 'منتظم';
    if (colMap.stage > -1) newRow[colMap.stage] = st.stage || "2 بكالوريا";
    if (colMap.gender > -1) newRow[colMap.gender] = "أونلاين";
    if (colMap.phone > -1) newRow[colMap.phone] = "'" + formattedP;

    resolvedMonths.forEach(function(m) {
      var mIdx = headers.indexOf(m);
      if (mIdx > -1) {
        newRow[mIdx] = "مسدد";
      }
    });

    studentsSheet.appendRow(newRow);
  }
}

function normTitle(t) {
  if (!t) return "";
  return String(t)
    .replace(/[\u200E\u200F\u00A0]/g, '')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPhone(phone) {
  if (!phone) return "";
  var str = String(phone);
  var arabicNumbers = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  for(var i=0; i<10; i++) {
    var regex = new RegExp(arabicNumbers[i], 'g');
    str = str.replace(regex, i);
  }
  str = str.replace(/[\s\+\.\-\u200E\u200F\u00A0]/g, '');
  if (str.startsWith('20') && str.length > 10) {
    str = str.substring(2);
  }
  if ((str.length === 10 || str.length === 9) && str.startsWith('1')) {
    str = '0' + str;
  }
  return str;
}


// =========================================================================
// وظائف المزامنة الذكية مع Google Drive والنسخ الاحتياطية لتطبيق السنتر
// =========================================================================

// قائمة مخصصة تظهر في شريط قوائم جوجل شيت بالأعلى للتشغيل اليدوي المباشر
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ موسوعة الكنز')
    .addItem('🔑 تفعيل صلاحيات Google Drive لرفع المذكرات من التطبيق', 'authorizeDrivePermissionsMenu')
    .addSeparator()
    .addItem('🔄 مزامنة طلاب السنتر من Google Drive (مع حماية الأونلاين)', 'syncDriveBackupsMenu')
    .addItem('🌐 مزامنة وتثبيت طلاب الأونلاين وتحديث شهورهم', 'syncOnlineStudentsToMainSheetMenu')
    .addSeparator()
    .addItem('🚀 مزامنة شاملة وذكية (سنتر + أونلاين معاً)', 'syncAllMenu')
    .addSeparator()
    .addItem('🛠️ تهيئة وإنشاء كافة صفحات الشيت تلقائياً (Setup)', 'initAllSheetsMenu')
    .addToUi();
}

function authorizeDrivePermissions() {
  var folderName = "مذكرات_الكنز_التعليمي";
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function authorizeDrivePermissionsMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    authorizeDrivePermissions();
    ui.alert(
      "✅ تم تفعيل الصلاحيات بنجاح!",
      "تم ربط صلاحيات Google Drive بنجاح وتجهيز مجلد 'مذكرات_الكنز_التعليمي'.\\nيمكنك الآن رفع ملفات الـ PDF مباشرة من داخل التطبيق بضغطة زر.",
      ui.ButtonSet.OK
    );
  } catch(e) {
    ui.alert("تنبيه الصلاحيات", "يرجى الموافقة على طلب إذن الوصول إلى Google Drive عند ظهوره: " + e.message, ui.ButtonSet.OK);
  }
}

function syncDriveBackupsMenu() {
  var ui = SpreadsheetApp.getUi();
  var res = syncDriveBackupsCore('s2', '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM');
  if (res.status === 'success') {
    ui.alert(
      '✅ تمت مزامنة السنتر بنجاح (مع حماية الأونلاين)!',
      'الملف المستخدم: ' + res.fileName + '\\n' +
      'تاريخ الباك آب: ' + res.fileDate + '\\n' +
      'إجمالي طلاب المرحلة بالنظام: ' + res.totalTargetStudents + '\\n' +
      'الطلاب المحدثة اشتراكاتهم: ' + res.updatedCount + '\\n' +
      'الطلاب الجدد المضافين: ' + res.addedCount + '\\n' +
      'إجمالي الشهور المسددة المحدثة: ' + res.monthsUpdatedCount,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ خطأ في المزامنة', res.message, ui.ButtonSet.OK);
  }
}

function syncOnlineStudentsToMainSheetMenu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = syncOnlineStudentsToMainSheet(ss);
  if (res.status === 'success') {
    ui.alert('✅ تم تثبيت طلاب الأونلاين!', 'تمت مزامنة وتثبيت ' + res.synced + ' طالب أونلاين وتحديث شهورهم كـ "مسدد" بنجاح في شيت الطلاب.', ui.ButtonSet.OK);
  } else {
    ui.alert('❌ تنبيه', res.message || 'حدث خطأ في المزامنة', ui.ButtonSet.OK);
  }
}

function syncAllMenu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var centerRes = syncDriveBackupsCore('s2', '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM');
  var onlineRes = syncOnlineStudentsToMainSheet(ss);
  
  var msg = '1. طلاب السنتر من درايف: ' + (centerRes.status === 'success' ? ('تم تحديث ' + centerRes.updatedCount) : centerRes.message) + '\\n' +
            '2. طلاب الأونلاين: تم تثبيت وتحديث شهور ' + onlineRes.synced + ' طالب أونلاين بنجاح.';
  ui.alert('🚀 تمت المزامنة الشاملة بنجاح!', msg, ui.ButtonSet.OK);
}

// الدالة الأساسية لقراءة أحدث ملف باك آب من مجلد درايف
function syncDriveBackupsCore(targetStage, folderId) {
  var stage = targetStage || 's2';
  var targetFolder = null;
  var candidateIds = [
    folderId,
    "1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM",
    "1n9QfJDscZ-l4Ulymls0aqQM_7ULxGjVM", // تجربة l الصغيرة بدلاً من I الكبيرة
    "1n9QfJDscZ-14Ulymls0aqQM_7ULxGjVM", // تجربة رقم 1
    "1RxUSNgaBGqBf9w9kK5owfY8ftD5l9NQ",
    "1RxUSNgaBGqBf9w9kK5owfY8ftD5I9NQ"
  ];

  // 1. المحاولة الأولى: فتح المجلد بأحد المعرّفات المحتملة
  for (var i = 0; i < candidateIds.length; i++) {
    if (!candidateIds[i]) continue;
    try {
      targetFolder = DriveApp.getFolderById(candidateIds[i]);
      if (targetFolder) break;
    } catch (e) {}
  }

  // 2. المحاولة الثانية: البحث بالاسم عن مجلد System_Backups
  if (!targetFolder) {
    try {
      var fldrs = DriveApp.getFoldersByName("System_Backups");
      if (fldrs.hasNext()) targetFolder = fldrs.next();
    } catch(e) {}
  }

  // 3. المحاولة الثالثة: البحث بالاسم عن مجلد "نسخة التطبيق الاحتياطية"
  if (!targetFolder) {
    try {
      var pFldrs = DriveApp.getFoldersByName("نسخة التطبيق الاحتياطية");
      if (pFldrs.hasNext()) {
        var parentF = pFldrs.next();
        var subF = parentF.getFoldersByName("System_Backups");
        if (subF.hasNext()) targetFolder = subF.next();
        else targetFolder = parentF;
      }
    } catch(e) {}
  }

  var latestFile = null;
  var latestDate = 0;

  // إذا تم العثور على المجلد، نبحث عن أحدث ملف JSON بداخله
  if (targetFolder) {
    try {
      var files = targetFolder.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        var fName = f.getName().toLowerCase();
        if (fName.indexOf('.json') > -1) {
          var updated = f.getLastUpdated().getTime();
          if (updated > latestDate) {
            latestDate = updated;
            latestFile = f;
          }
        }
      }
    } catch(e) {}
  }

  // 4. المحاولة الرابعة: إذا لم يتم العثور على المجلد، نبحث مباشرة عن ملفات الباك آب في درايف كله
  if (!latestFile) {
    try {
      var allJsonFiles = DriveApp.searchFiles('title contains ".json" and trashed = false');
      while (allJsonFiles.hasNext()) {
        var jf = allJsonFiles.next();
        var jName = jf.getName().toLowerCase();
        if (jName.indexOf('backup_') > -1 || jName === 'emergency_autosave.json') {
          var uDate = jf.getLastUpdated().getTime();
          if (uDate > latestDate) {
            latestDate = uDate;
            latestFile = jf;
          }
        }
      }
    } catch(e) {}
  }

  // 5. المحاولة الخامسة: البحث المباشر بالاسم عن emergency_autosave.json
  if (!latestFile) {
    try {
      var autoFiles = DriveApp.getFilesByName("emergency_autosave.json");
      if (autoFiles.hasNext()) latestFile = autoFiles.next();
    } catch(e) {}
  }

  if (!latestFile) {
    return { 
      status: 'error', 
      message: 'لم يتم العثور على ملفات الباك آب في حساب Google Drive الحالي.\\n\\n💡 تأكد من الآتي:\\n1. إذا كان شيت المنصة على إيميل جوجل مختلف عن إيميل الباك آب، يرجى فتح جوجل درايف وعمل مشاركة (Share) لمجلد System_Backups مع إيميل هذا الشيت.\\n2. أو يمكنك استخدام زر (رفع ملف الباك آب JSON محلياً) من لوحة إدارة المنصة لتحديث الشيت فوراً.' 
    };
  }

  var content = latestFile.getBlob().getDataAsString('UTF-8');
  var parsedData;
  try {
    parsedData = JSON.parse(content);
  } catch(e) {
    return { status: 'error', message: 'خطأ في قراءة ملف JSON: ' + e.message };
  }

  var res = applyBackupToSheet(parsedData.students, parsedData.transactions, stage);
  if (res.status === 'success') {
    res.fileName = latestFile.getName();
    res.fileDate = latestFile.getLastUpdated().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
  }
  return res;
}

// تطبيق بيانات الطلاب والمعاملات المالية على شيت الطلاب
function applyBackupToSheet(students, transactions, targetStage) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var studentsSheet = ss.getSheetByName('الطلاب');
  if (!studentsSheet) {
    initAllSheets();
    studentsSheet = ss.getSheetByName('الطلاب');
  }

  var stageCode = String(targetStage || 's2').trim();
  
  // 1. تصفية طلاب المرحلة المستهدفة
  var targetStudents = (students || []).filter(function(st) {
    return String(st.stage || '').trim() === stageCode;
  });

  if (targetStudents.length === 0) {
    return { status: 'error', message: 'لم يتم العثور على أي طلاب للمرحلة: ' + stageCode };
  }

  // 2. تجميع الشهور المسددة حصراً من المعاملات الفعلية (transactions)
  // تم إلغاء exemptMonths تماماً لأنها تخص تخفيضات الإخوة في تطبيق السنتر وليست شهوراً مسددة
  var paidMonthsMap = {};
  (transactions || []).forEach(function(tx) {
    if (tx.sid && tx.month) {
      var sid = String(tx.sid).trim();
      if (!paidMonthsMap[sid]) paidMonthsMap[sid] = {};
      var m = String(tx.month).trim();
      if (m) paidMonthsMap[sid][m] = true;
    }
  });

  // 3. تجهيز بيانات طلاب الباك آب مع فهرسة ثلاثية (بالكود والهاتف والاسم)
  var backupList = [];
  var backupByCode = {};
  var backupByPhone = {};
  var backupByName = {};

  var allAcademicMonths = ['سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
  var toAcadOrder = function(mN) {
    return mN >= 9 ? (mN - 8) : (mN + 4);
  };

  targetStudents.forEach(function(st) {
    var p = cleanPhone(st.phone);
    var code = String(st.studentCode || '').trim();
    var name = String(st.name || '').trim();
    var normName = normalizeName(name);

    var isExempt = (st.isFullyExempt === true);
    var sMonths = paidMonthsMap[String(st.id).trim()] ? Object.keys(paidMonthsMap[String(st.id).trim()]) : [];

    // استخراج تاريخ التسجيل وشهر بداية الطالب
    var joinDateObj = null;
    var rawDate = st.createdAt || st.registeredAt || st.registrationDate || st.joinedDate || st.date || st.created_at;
    if (rawDate) {
      var parsedD = new Date(rawDate);
      if (!isNaN(parsedD.getTime())) joinDateObj = parsedD;
    }
    if (!joinDateObj && st.id) {
      var numId = Number(st.id);
      if (!isNaN(numId) && numId > 1672531199000 && numId < 1924982400000) {
        joinDateObj = new Date(numId);
      }
    }

    var regDateFormatted = "";
    var startMonthNum = null;
    if (joinDateObj) {
      var dd = String(joinDateObj.getDate()).padStart(2, '0');
      var mm = String(joinDateObj.getMonth() + 1).padStart(2, '0');
      var yyyy = joinDateObj.getFullYear();
      regDateFormatted = dd + '/' + mm + '/' + yyyy;

      var jMonth = joinDateObj.getMonth() + 1;
      var jDay = joinDateObj.getDate();
      // إذا انضم الطالب في أواخر الشهر (يوم 20 فما بعد)، تبدأ مطالبته الأكاديمية من الشهر التالي
      if (jDay >= 20) {
        startMonthNum = (jMonth === 12) ? 1 : (jMonth + 1);
      } else {
        startMonthNum = jMonth;
      }
    }

    if (st.startMonth) {
      var explicitSm = getMonthNum(st.startMonth);
      if (explicitSm) startMonthNum = explicitSm;
    }

    // تحديد الشهور غير المطالب بها (Waived Months)
    var waivedMonths = [];
    var exemptMonthsList = st.exemptMonths || [];

    allAcademicMonths.forEach(function(mName) {
      if (sMonths.indexOf(mName) > -1) return; // مسدد

      var mNum = getMonthNum(mName);
      if (!mNum) return;

      var isWaived = false;

      // 1. هل الشهر يسبق شهر انضمام الطالب للسنتر؟ (مثلاً جاء أواخر سبتمبر أو في أكتوبر، فشهر سبتمبر غير مطالب به)
      if (startMonthNum !== null) {
        if (toAcadOrder(mNum) < toAcadOrder(startMonthNum)) {
          isWaived = true;
        }
      }

      // 2. هل الشهر معفى في قائمة exemptMonths بالـ JSON؟
      if (!isWaived && exemptMonthsList && Array.isArray(exemptMonthsList)) {
        for (var e = 0; e < exemptMonthsList.length; e++) {
          var ex = String(exemptMonthsList[e]).trim();
          if (ex === mName || ex.indexOf(mName) > -1 || mName.indexOf(ex) > -1 || getMonthNum(ex) === mNum) {
            isWaived = true;
            break;
          }
        }
      }

      // 3. هل الطالب معفى كلياً؟
      if (isExempt) {
        isWaived = true;
      }

      // 4. فحص قائمة المطالبات المحددة في ملف السنتر إن وجدت (unpaidMonths / dueMonths)
      var explicitDues = st.unpaidMonths || st.dueMonths || st.dues;
      if (!isWaived && explicitDues && Array.isArray(explicitDues)) {
        var isExplicitDue = false;
        for (var d = 0; d < explicitDues.length; d++) {
          var dueM = String(explicitDues[d]).trim();
          if (dueM === mName || dueM.indexOf(mName) > -1 || getMonthNum(dueM) === mNum) {
            isExplicitDue = true;
            break;
          }
        }
        if (!isExplicitDue) {
          isWaived = true;
        }
      }

      if (isWaived) {
        waivedMonths.push(mName);
      }
    });

    var bObj = {
      id: String(st.id || '').trim(),
      name: name,
      normName: normName,
      phone: p,
      studentCode: code,
      exempt: isExempt,
      paidMonths: sMonths,
      waivedMonths: waivedMonths,
      regDate: regDateFormatted,
      gender: (st.gender === 'boys' ? 'بنين' : (st.gender === 'girls' ? 'بنات' : '')),
      stage: '2 ثانوي'
    };

    backupList.push(bObj);
    if (code) backupByCode[code] = bObj;
    if (p) backupByPhone[p] = bObj;
    if (normName) backupByName[normName] = bObj;
  });

  // 4. قراءة بيانات شيت الطلاب الحالية
  var sheetData = studentsSheet.getDataRange().getValues();
  var headers = sheetData[0];
  var colMap = findColumnIndices(headers);

  // خريطة أعمدة الشهور في الشيت
  var monthColIndices = {};
  for (var c = 0; c < headers.length; c++) {
    var hName = String(headers[c] || '').trim();
    if (colMap.nonMonthCols.indexOf(c) === -1 || hName === 'أغسطس' || hName === 'سبتمبر' || hName === 'أكتوبر' || hName === 'نوفمبر' || hName === 'ديسمبر' || hName === 'يناير' || hName === 'فبراير' || hName === 'مارس' || hName === 'أبريل' || hName === 'مايو') {
      monthColIndices[hName] = c;
    }
  }

  var updatedCount = 0;
  var monthsUpdatedCount = 0;
  var matchedBackupIds = {};
  var seenSheetKeys = {}; // لتتبع وحذف الصفوف المكررة في الشيت
  var rowsToDelete = [];

  // 5. التحديث والفحص الذكي لجميع صفوف الشيت الحالية + تنظيف التكرارات
  for (var r = 1; r < sheetData.length; r++) {
    var rowCode = colMap.code > -1 ? String(sheetData[r][colMap.code] || '').trim() : '';
    var rowPhone = colMap.phone > -1 ? cleanPhone(sheetData[r][colMap.phone]) : '';
    var rowName = colMap.name > -1 ? String(sheetData[r][colMap.name] || '').trim() : '';
    var rowNormName = normalizeName(rowName);
    var rowGender = colMap.gender > -1 ? String(sheetData[r][colMap.gender] || '').trim() : '';
    var isRowOnline = rowGender.indexOf('أونلاين') > -1 || rowGender.indexOf('اونلاين') > -1 || rowCode.indexOf('ESON') > -1;

    // حماية مطلقة لطلاب الأونلاين: لا يتم حذفهم ولا معاملتهم كصفوف مكررة في باك آب السنتر
    if (isRowOnline) {
      continue;
    }

    // التحقق من التكرار داخل الشيت: إذا تكرر نفس الكود أو الهاتف أو الاسم
    var rowKey = rowCode || rowPhone || rowNormName;
    if (rowKey && seenSheetKeys[rowKey]) {
      // صف مكرر! يتم إضافته لقائمة الحذف
      rowsToDelete.push(r + 1);
      continue;
    }
    if (rowKey) seenSheetKeys[rowKey] = true;

    // مطابقة الطالب: نبحث بالكود أولاً، ثم بالهاتف، ثم بالاسم
    var bStudent = null;
    if (rowCode && backupByCode[rowCode]) bStudent = backupByCode[rowCode];
    else if (rowPhone && backupByPhone[rowPhone]) bStudent = backupByPhone[rowPhone];
    else if (rowNormName && backupByName[rowNormName]) bStudent = backupByName[rowNormName];

    if (!bStudent) continue;

    matchedBackupIds[bStudent.id] = true;
    var studentRowChanged = false;

    // تحديث وتثبيت الهاتف كـ نص صريح مع الصفر إن لم يكن كذلك
    if (colMap.phone > -1 && bStudent.phone) {
      var currentPhoneVal = String(sheetData[r][colMap.phone] || '').trim();
      var desiredPhoneStr = bStudent.phone.startsWith('0') ? bStudent.phone : ('0' + bStudent.phone);
      if (currentPhoneVal !== desiredPhoneStr && cleanPhone(currentPhoneVal) === bStudent.phone) {
        studentsSheet.getRange(r + 1, colMap.phone + 1).setValue("'" + desiredPhoneStr);
      }
    }

    // تحديث الحالة المالية بدقة: معفي فقط لمن لديه إعفاء كلي، ومنتظم للباقين
    if (colMap.status > -1) {
      var curStatus = String(sheetData[r][colMap.status] || '').trim();
      var correctStatus = bStudent.exempt ? 'معفي' : 'منتظم';
      if (curStatus !== correctStatus) {
        studentsSheet.getRange(r + 1, colMap.status + 1).setValue(correctStatus);
        studentRowChanged = true;
      }
    }

    // تحديث المرحلة والنوع إن وجد عمودهما وكان فارغاً
    if (colMap.stage > -1 && !sheetData[r][colMap.stage]) {
      studentsSheet.getRange(r + 1, colMap.stage + 1).setValue(bStudent.stage);
    }
    if (colMap.gender > -1 && !sheetData[r][colMap.gender] && bStudent.gender) {
      studentsSheet.getRange(r + 1, colMap.gender + 1).setValue(bStudent.gender);
    }

    // تحديث تاريخ التسجيل إن وجد عمود له في الشيت
    if (colMap.regDate > -1 && bStudent.regDate && !sheetData[r][colMap.regDate]) {
      studentsSheet.getRange(r + 1, colMap.regDate + 1).setValue(bStudent.regDate);
    }

    // تحديث الشهور (سداد أو إعفاء/عدم مطالبة من واقع الباك آب)
    for (var mName in monthColIndices) {
      var colIdx = monthColIndices[mName];
      var curVal = String(sheetData[r][colIdx] || '').trim();

      if (bStudent.paidMonths.indexOf(mName) > -1) {
        if (!curVal || curVal === '-' || curVal === 'لا' || curVal.indexOf('متأخر') > -1 || curVal.indexOf('غير مسدد') > -1 || curVal.indexOf('غير مطالب') > -1) {
          studentsSheet.getRange(r + 1, colIdx + 1).setValue('مسدد');
          studentRowChanged = true;
          monthsUpdatedCount++;
        }
      } else if (bStudent.waivedMonths.indexOf(mName) > -1 || bStudent.exempt) {
        if (!curVal || curVal === '-' || curVal === 'لا' || curVal.indexOf('متأخر') > -1 || curVal.indexOf('غير مسدد') > -1) {
          studentsSheet.getRange(r + 1, colIdx + 1).setValue('غير مطالب');
          studentRowChanged = true;
          monthsUpdatedCount++;
        }
      }
    }

    if (studentRowChanged) {
      updatedCount++;
    }
  }

  // حذف الصفوف المكررة من الأسفل إلى الأعلى للحفاظ على ترتيب المؤشرات
  if (rowsToDelete.length > 0) {
    for (var d = rowsToDelete.length - 1; d >= 0; d--) {
      studentsSheet.deleteRow(rowsToDelete[d]);
    }
  }

  // 6. إضافة الطلاب الجدد غير المسجلين نهائياً (فقط إذا لم يكن له كود أو هاتف أو اسم مسجل)
  var addedCount = 0;
  backupList.forEach(function(newSt) {
    if (!matchedBackupIds[newSt.id]) {
      var isAlreadyInSheet = (newSt.studentCode && seenSheetKeys[newSt.studentCode]) ||
                             (newSt.phone && seenSheetKeys[newSt.phone]) ||
                             (newSt.normName && seenSheetKeys[newSt.normName]);
      if (isAlreadyInSheet) return;

      var newRow = new Array(headers.length).fill('');
      newRow[colMap.name] = newSt.name;
      var formattedPhoneStr = newSt.phone.startsWith('0') ? newSt.phone : ('0' + newSt.phone);
      newRow[colMap.phone] = "'" + formattedPhoneStr;
      
      if (colMap.code > -1 && newSt.studentCode) newRow[colMap.code] = newSt.studentCode;
      if (colMap.status > -1) newRow[colMap.status] = newSt.exempt ? 'معفي' : 'منتظم';
      if (colMap.stage > -1) newRow[colMap.stage] = newSt.stage;
      if (colMap.gender > -1) newRow[colMap.gender] = newSt.gender;
      if (colMap.regDate > -1 && newSt.regDate) newRow[colMap.regDate] = newSt.regDate;

      for (var mName in monthColIndices) {
        var colIdx = monthColIndices[mName];
        if (newSt.paidMonths.indexOf(mName) > -1) {
          newRow[colIdx] = 'مسدد';
          monthsUpdatedCount++;
        } else if (newSt.waivedMonths.indexOf(mName) > -1 || newSt.exempt) {
          newRow[colIdx] = 'غير مطالب';
          monthsUpdatedCount++;
        }
      }

      studentsSheet.appendRow(newRow);
      addedCount++;
      matchedBackupIds[newSt.id] = true;
      if (newSt.studentCode) seenSheetKeys[newSt.studentCode] = true;
      if (newSt.phone) seenSheetKeys[newSt.phone] = true;
      if (newSt.normName) seenSheetKeys[newSt.normName] = true;
    }
  });

  // 7. دمج وتأمين طلاب الأونلاين من شيت «طلاب_الأونلاين» (لضمان بقائهم حتى لو مسح الشيت وأعيد بناؤه!)
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (onlineSheet) {
    var onData = onlineSheet.getDataRange().getValues();
    if (onData.length > 1) {
      for (var oi = 1; oi < onData.length; oi++) {
        var onCode = String(onData[oi][0] || '').trim();
        var onName = String(onData[oi][1] || '').trim();
        var onPhone = cleanPhone(onData[oi][2]);
        var onStage = String(onData[oi][3] || '').trim() || "2 بكالوريا";
        var onMonthsRaw = String(onData[oi][5] || '').trim();
        var onMonths = onMonthsRaw.split(/[،,]/).map(function(m){ return m.trim(); }).filter(Boolean);

        if (onPhone) {
          syncSingleOnlineStudentToMainSheet(studentsSheet, {
            code: onCode,
            name: onName,
            phone: onPhone,
            stage: onStage,
            activeMonths: onMonths
          });
        }
      }
    }
  }

  return {
    status: 'success',
    updatedCount: updatedCount,
    addedCount: addedCount,
    cleanedDuplicates: rowsToDelete.length,
    monthsUpdatedCount: monthsUpdatedCount,
    totalTargetStudents: targetStudents.length
  };
}

// =========================================================================
// الدالة المحورية لتفعيل طالب الأونلاين بدقة وتحديث الطلاب وطلاب_الأونلاين
// =========================================================================
function activateOnlineStudentCore(ss, payload) {
  var name = String(payload.name || '').trim();
  var rawPhone = String(payload.phone || '').trim();
  var phone = cleanPhone(rawPhone);
  if (!name || !phone) return { status: 'error', message: 'الاسم ورقم الهاتف مطلوبان' };

  // 1. توليد كود الطالب أو استخدام الكود القادم من الواجهة
  var code = String(payload.code || payload.studentCode || '').trim();
  if (!code) {
    var firstChar = name ? name.charAt(0) : 'A';
    var cleanDigits = phone.replace(/[^\\d]/g, '');
    var last4 = cleanDigits.length >= 4 ? cleanDigits.substring(cleanDigits.length - 4) : '0000';
    code = firstChar + last4 + 'ESON';
  }

  // 2. تحديد الشهور المفعلة فقط بناء على باقة الطالب
  var packageType = String(payload.packageType || 'شهري').trim();
  var paidMonths = [];
  var activeMonthsStr = '';

  if (packageType === 'شهري') {
    var m = String(payload.month || 'أكتوبر').trim();
    paidMonths = [m];
    activeMonthsStr = m;
  } else if (packageType === 'ترم أول') {
    paidMonths = ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير'];
    activeMonthsStr = 'الترم الأول (أغسطس - يناير)';
  } else if (packageType === 'ترم ثانٍ') {
    paidMonths = ['فبراير', 'مارس', 'أبريل', 'مايو'];
    activeMonthsStr = 'الترم الثاني (فبراير - مايو)';
  } else if (packageType === 'سنة كاملة') {
    paidMonths = ['أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'];
    activeMonthsStr = 'العام كاملاً';
  } else {
    var defM = String(payload.month || 'أكتوبر').trim();
    paidMonths = [defM];
    activeMonthsStr = defM;
  }

  // 3. تحديث أو إضافة الطالب في شيت "الطلاب" الرئيسي
  var studentsSheet = ss.getSheetByName("الطلاب");
  if (studentsSheet) {
    var sData = studentsSheet.getDataRange().getValues();
    var sHeaders = sData[0];
    var colMap = findColumnIndices(sHeaders);

    var monthCols = {};
    for (var h = 0; h < sHeaders.length; h++) {
      var hName = String(sHeaders[h]).trim();
      if (hName) monthCols[hName] = h;
    }

    var existingRow = -1;
    for (var r = 1; r < sData.length; r++) {
      var rPhone = cleanPhone(sData[r][colMap.phone]);
      var rCode = colMap.code > -1 ? String(sData[r][colMap.code]).trim() : '';
      if ((rPhone && rPhone === phone) || (rCode && rCode === code)) {
        existingRow = r + 1;
        break;
      }
    }

    var fPhone = phone.startsWith('0') ? phone : ('0' + phone);

    if (existingRow > -1) {
      if (colMap.name > -1) studentsSheet.getRange(existingRow, colMap.name + 1).setValue(name);
      if (colMap.code > -1) studentsSheet.getRange(existingRow, colMap.code + 1).setValue(code);
      if (colMap.status > -1) studentsSheet.getRange(existingRow, colMap.status + 1).setValue("منتظم");
      if (colMap.stage > -1) studentsSheet.getRange(existingRow, colMap.stage + 1).setValue(payload.stage || "2 بكالوريا");
      if (colMap.gender > -1) studentsSheet.getRange(existingRow, colMap.gender + 1).setValue("أونلاين");
      if (colMap.phone > -1) studentsSheet.getRange(existingRow, colMap.phone + 1).setValue("'" + fPhone);

      // تفعيل الشهور الخاصة بالباقة فقط دون المساس بباقي الشهور
      paidMonths.forEach(function(mName) {
        if (monthCols[mName] !== undefined) {
          studentsSheet.getRange(existingRow, monthCols[mName] + 1).setValue("مسدد");
        }
      });
    } else {
      // صف جديد: جميع الشهور فارغة عدا الشهور المشترك بها فقط
      var newRow = new Array(sHeaders.length).fill('');
      if (colMap.name > -1) newRow[colMap.name] = name;
      if (colMap.code > -1) newRow[colMap.code] = code;
      if (colMap.status > -1) newRow[colMap.status] = "منتظم";
      if (colMap.stage > -1) newRow[colMap.stage] = payload.stage || "2 بكالوريا";
      if (colMap.gender > -1) newRow[colMap.gender] = "أونلاين";
      if (colMap.phone > -1) newRow[colMap.phone] = "'" + fPhone;

      paidMonths.forEach(function(mName) {
        if (monthCols[mName] !== undefined) {
          newRow[monthCols[mName]] = "مسدد";
        }
      });

      studentsSheet.appendRow(newRow);
    }
  }

  // 4. تسجيل الطالب بشكل دائم في شيت "طلاب_الأونلاين"
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!onlineSheet) {
    onlineSheet = ss.insertSheet("طلاب_الأونلاين");
    onlineSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "الحالة"]);
    onlineSheet.getRange(1, 1, 1, 10).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    onlineSheet.setFrozenRows(1);
    onlineSheet.getRange("C:C").setNumberFormat("@");
  }

  var oData = onlineSheet.getDataRange().getValues();
  var oRowIdx = -1;
  for (var oi = 1; oi < oData.length; oi++) {
    var rowP = cleanPhone(oData[oi][2]);
    var rowC = String(oData[oi][0] || '').trim();
    if (rowP === phone || rowC === code) {
      oRowIdx = oi + 1;
      break;
    }
  }

  var actDate = new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
  var fPhoneVal = phone.startsWith('0') ? phone : ('0' + phone);
  var pkgDisplay = packageType === 'شهري' ? ('شهري (' + (payload.month || 'أكتوبر') + ')') : packageType;
  var rowValues = [code, name, "'" + fPhoneVal, payload.stage || "2 بكالوريا", pkgDisplay, activeMonthsStr, payload.method || "تحويل", payload.amount || "", actDate, "نشط"];

  if (oRowIdx > -1) {
    onlineSheet.getRange(oRowIdx, 1, 1, 10).setValues([rowValues]);
  } else {
    onlineSheet.appendRow(rowValues);
  }

  return { status: 'success', studentCode: code };
}

// =========================================================================
// وظيفة التهيئة الشاملة: إنشاء كل صفحات وأعمدة الشيت تلقائياً بضغطة زر واحدة
// =========================================================================
function initAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. شيت الطلاب (مطابق 100% لهيكل الشيت القديم)
  var sSheet = ss.getSheetByName("الطلاب");
  if (!sSheet) {
    sSheet = ss.insertSheet("الطلاب");
    sSheet.appendRow([
      "الاسم", "كود الطالب", "الحالة المالية", "المرحلة", "النوع", "الهاتف",
      "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو",
      "محظور"
    ]);
    sSheet.getRange(1, 1, 1, 17).setBackground("#1e3a8a").setFontColor("#ffffff").setFontWeight("bold");
    sSheet.setFrozenRows(1);
    // ضبط عمود الهاتف كـ نص صريح لمنع اختفاء الصفر
    sSheet.getRange("F:F").setNumberFormat("@");
  }

  // 2. شيت الأسئلة
  var qSheet = ss.getSheetByName("الأسئلة");
  if (!qSheet) {
    qSheet = ss.insertSheet("الأسئلة");
    qSheet.appendRow([
      "الوحدة", "الدرس", "النوع", "السؤال",
      "الاختيار 1", "الاختيار 2", "الاختيار 3", "الاختيار 4",
      "الإجابة الصحيحة", "التفسير", "المفهوم", "الفقرة", "الصوت", "الفيديو", "مذكرة_PDF"
    ]);
    qSheet.getRange(1, 1, 1, 15).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    qSheet.setFrozenRows(1);
  } else {
    // إذا كان شيت الأسئلة موجوداً مسبقاً، نتأكد من إضافة عمود مذكرة_PDF في العمود رقم 15
    var lastCol = Math.max(qSheet.getLastColumn(), 15);
    var qHeaders = qSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (!qHeaders[14] || String(qHeaders[14]).trim() === '') {
      qSheet.getRange(1, 15).setValue("مذكرة_PDF")
        .setBackground("#047857")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
    }
  }

  // 3. شيت النتائج
  var rSheet = ss.getSheetByName("النتائج");
  if (!rSheet) {
    rSheet = ss.insertSheet("النتائج");
    rSheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "الاختبار / الدرس", "النتيجة"]);
    rSheet.getRange(1, 1, 1, 5).setBackground("#b45309").setFontColor("#ffffff").setFontWeight("bold");
    rSheet.setFrozenRows(1);
  }

  // 4. شيت الإعدادات
  var setSheet = ss.getSheetByName("الإعدادات");
  if (!setSheet) {
    setSheet = ss.insertSheet("الإعدادات");
    setSheet.appendRow(["قيمة الاشتراك", "الإشعار", "إعدادات العداد", "الوحدة المستهدفة", "وقت السؤال", "الدروس المنشورة"]);
    setSheet.appendRow(["50 جنيهاً", "مرحباً بكم في منصة الكنز التعليمي", "disabled", "[]", 60, "[]"]);
    setSheet.getRange(1, 1, 1, 6).setBackground("#475569").setFontColor("#ffffff").setFontWeight("bold");
    setSheet.setFrozenRows(1);
  }

  // 5. شيت طلبات الاشتراك
  var reqSheet = ss.getSheetByName("طلبات_الاشتراك") || (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
  if (!reqSheet) {
    reqSheet = ss.insertSheet("طلبات_الاشتراك");
    reqSheet.appendRow(["التاريخ", "الاسم", "رقم الهاتف", "طريقة الدفع", "الحالة"]);
    reqSheet.getRange(1, 1, 1, 5).setBackground("#6b21a8").setFontColor("#ffffff").setFontWeight("bold");
    reqSheet.setFrozenRows(1);
  }

  // 6. شيت الأجهزة
  var devSheet = ss.getSheetByName("الأجهزة");
  if (!devSheet) {
    devSheet = ss.insertSheet("الأجهزة");
    devSheet.appendRow(["رقم الهاتف", "بصمة المتصفح (Fingerprint)", "تاريخ أول تسجيل دخول"]);
    devSheet.getRange(1, 1, 1, 3).setBackground("#374151").setFontColor("#ffffff").setFontWeight("bold");
    devSheet.setFrozenRows(1);
  }

  // 7. شيت طلاب الأونلاين (سجل المشتركين أونلاين الدائم)
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!onlineSheet) {
    onlineSheet = ss.insertSheet("طلاب_الأونلاين");
    onlineSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "ملاحظات"]);
    onlineSheet.getRange(1, 1, 1, 10).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    onlineSheet.setFrozenRows(1);
    onlineSheet.getRange("C:C").setNumberFormat("@");
  }

  // 8. شيت أرشيف الأونلاين (سجل الاشتراكات الملغاة والمحذوفة لحفظ الحقوق المالية)
  var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
  if (!archSheet) {
    archSheet = ss.insertSheet("أرشيف_الأونلاين");
    archSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "تاريخ الإلغاء", "سبب الإلغاء"]);
    archSheet.getRange(1, 1, 1, 11).setBackground("#991b1b").setFontColor("#ffffff").setFontWeight("bold");
    archSheet.setFrozenRows(1);
    archSheet.getRange("C:C").setNumberFormat("@");
  }

  // حذف الورقة الافتراضية الفارغة إن وجدت
  var defaultSheet = ss.getSheetByName("الورقة1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch(e) {}
  }

  // مزامنة فورية وتلقائية لأي طلاب أونلاين موجودين في شيت الطلاب
  syncOnlineStudentsFromMainSheet(ss);

  return { status: 'success', message: 'تم إنشاء وتهيئة كافة صفحات وقواعد بيانات الشيت وتحديث طلاب الأونلاين بنجاح!' };
}

// =========================================================================
// وظيفة مزامنة وتثبيت طلاب الأونلاين وشهورهم من شيت طلاب_الأونلاين إلى شيت الطلاب
// =========================================================================
function syncOnlineStudentsToMainSheet(ss) {
  var sSheet = ss.getSheetByName("الطلاب");
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!sSheet || !onlineSheet) return { status: 'error', message: 'الشيتات غير موجودة' };

  var sData = sSheet.getDataRange().getValues();
  if (sData.length <= 1) return { status: 'success', synced: 0 };
  var sHeaders = sData[0];
  var colMap = findColumnIndices(sHeaders);

  var monthColIndices = {};
  for (var c = 0; c < sHeaders.length; c++) {
    var hName = String(sHeaders[c] || '').trim();
    monthColIndices[hName] = c;
  }

  var oData = onlineSheet.getDataRange().getValues();
  if (oData.length <= 1) return { status: 'success', synced: 0 };

  var sheetRowByPhone = {};
  var sheetRowByCode = {};
  for (var r = 1; r < sData.length; r++) {
    var p = cleanPhone(sData[r][colMap.phone]);
    var cd = colMap.code > -1 ? String(sData[r][colMap.code] || '').trim() : '';
    if (p) sheetRowByPhone[p] = r + 1;
    if (cd) sheetRowByCode[cd] = r + 1;
  }

  var syncedCount = 0;
  for (var oi = 1; oi < oData.length; oi++) {
    var oCode = String(oData[oi][0] || '').trim();
    var oName = String(oData[oi][1] || '').trim();
    var oPhoneRaw = cleanPhone(oData[oi][2]);
    if (!oPhoneRaw) continue;

    var oStage = String(oData[oi][3] || '2 بكالوريا').trim();
    var oPkg = String(oData[oi][4] || '').trim();
    var oActiveMonthsStr = String(oData[oi][5] || '').trim();
    var oStatus = String(oData[oi][9] || 'نشط').trim();

    var monthsToMark = getResolvedMonths(oPkg, oActiveMonthsStr);
    var targetRow = sheetRowByPhone[oPhoneRaw] || (oCode ? sheetRowByCode[oCode] : null);
    var formattedP = oPhoneRaw.startsWith('0') ? oPhoneRaw : ('0' + oPhoneRaw);

    if (targetRow) {
      if (colMap.name > -1 && oName) sSheet.getRange(targetRow, colMap.name + 1).setValue(oName);
      if (colMap.code > -1 && oCode) sSheet.getRange(targetRow, colMap.code + 1).setValue(oCode);
      if (colMap.status > -1) sSheet.getRange(targetRow, colMap.status + 1).setValue(oStatus === 'ملغي' ? 'محظور' : 'منتظم');
      if (colMap.gender > -1) sSheet.getRange(targetRow, colMap.gender + 1).setValue("أونلاين");
      if (colMap.phone > -1) sSheet.getRange(targetRow, colMap.phone + 1).setValue("'" + formattedP);
      if (colMap.stage > -1) sSheet.getRange(targetRow, colMap.stage + 1).setValue(oStage);

      monthsToMark.forEach(function(m) {
        if (monthColIndices[m] !== undefined) {
          sSheet.getRange(targetRow, monthColIndices[m] + 1).setValue("مسدد");
        }
      });
    } else {
      var newR = new Array(sHeaders.length).fill('');
      if (colMap.name > -1) newR[colMap.name] = oName;
      if (colMap.code > -1) newR[colMap.code] = oCode;
      if (colMap.status > -1) newR[colMap.status] = oStatus === 'ملغي' ? 'محظور' : 'منتظم';
      if (colMap.gender > -1) newR[colMap.gender] = "أونلاين";
      if (colMap.phone > -1) newR[colMap.phone] = "'" + formattedP;
      if (colMap.stage > -1) newR[colMap.stage] = oStage;

      monthsToMark.forEach(function(m) {
        if (monthColIndices[m] !== undefined) {
          newR[monthColIndices[m]] = "مسدد";
        }
      });
      sSheet.appendRow(newR);
    }
    syncedCount++;
  }

  return { status: 'success', synced: syncedCount, message: 'تم تثبيت وتحديث شهور ' + syncedCount + ' طالب أونلاين بنجاح!' };
}

function syncOnlineStudentsFromMainSheet(ss) {
  return syncOnlineStudentsToMainSheet(ss);
}

function initAllSheetsMenu() {
  var ui = SpreadsheetApp.getUi();
  var res = initAllSheets();
  ui.alert(
    '✅ تم بنجاح!',
    'تم فحص وتجهيز جميع صفحات الشيت (8 صفحات كاملة) بنجاح:\\n' +
    '1. الطلاب (قاعدة البيانات الأساسية)\\n' +
    '2. الأسئلة (بنك الأسئلة والخرائط)\\n' +
    '3. النتائج (سجل درجات الطلاب)\\n' +
    '4. الإعدادات (أسعار الباقات والرسائل)\\n' +
    '5. طلبات التسجيل (الطلبات المعلقة)\\n' +
    '6. الأجهزة (بصمات أجهزة الدخول)\\n' +
    '7. طلاب_الأونلاين (سجل المشتركين المعتمدين)\\n' +
    '8. أرشيف_الأونلاين (سجل الحسابات الموقوفة)\\n\\n' +
    '✨ جميع الشيتات مؤمنة ومتصلة بالمنصة بنجاح!',
    ui.ButtonSet.OK
  );
}