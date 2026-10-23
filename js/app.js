      function highlightImportantTableColumns() {
        document.querySelectorAll('table').forEach(table => {
          const headers = Array.from(table.querySelectorAll('th'));
          headers.forEach((header, index) => {
            const text = header.textContent.trim();
            const isRisk = text.includes('风险信号');
            const isImportant = ['HR 要拿到什么信息', '参考答案/判断标准', 'HR 追问', '推荐写法'].some(keyword => text.includes(keyword));

            if (!isRisk && !isImportant) return;

            header.classList.add(isRisk ? 'risk-head' : 'important-head');
            table.querySelectorAll('tr').forEach(row => {
              const cell = row.children[index];
              if (cell && cell.tagName === 'TD') {
                cell.classList.add(isRisk ? 'risk-cell' : 'important-cell');
              }
            });
          });
        });
      }
      highlightImportantTableColumns();

      const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
      const DEEPSEEK_MODEL = 'deepseek-chat';
      const resumeFileInput = document.getElementById('resumeFile');
      const resumeFileName = document.getElementById('resumeFileName');
      const resumeFileUploadLabel = document.querySelector('.resume-file-upload');
      const targetPositionInput = document.getElementById('targetPosition');
      const analyzeResumeBtn = document.getElementById('analyzeResumeBtn');
      const clearAllCacheBtn = document.getElementById('clearAllCacheBtn');
      const exportExcelBtn = document.getElementById('exportExcelBtn');
      const resumeHistoryList = document.getElementById('resumeHistoryList');
      const resumeStatus = document.getElementById('resumeStatus');
      const analysisLoading = document.getElementById('analysisLoading');
      const analysisLoadingText = document.getElementById('analysisLoadingText');
      const analysisProgressBar = document.getElementById('analysisProgressBar');
      const analysisProgressText = document.getElementById('analysisProgressText');
      const analysisModal = document.getElementById('analysisModal');
      const analysisModalClose = document.getElementById('analysisModalClose');
      const analysisCandidate = document.getElementById('analysisCandidate');
      const analysisMatchBadge = document.getElementById('analysisMatchBadge');
      const analysisModalBody = document.getElementById('analysisModalBody');
      let analysisProgressTimer = null;
      let currentAnalysisId = null;
      const RESUME_ANALYSIS_CACHE_KEY = 'love_xinxin_resume_analysis_cache_v1';
      const INTERVIEW_REPORT_CACHE_KEY = 'love_xinxin_interview_report_cache_v1';
      const RESUME_ANALYSIS_HISTORY_KEY = 'love_xinxin_resume_analysis_history_v1';

      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      function setResumeStatus(message, type = 'info') {
        if (!resumeStatus) return;
        resumeStatus.textContent = message;
        resumeStatus.className = `resume-status ${type}`;
      }

      function clearResumeStatus() {
        if (!resumeStatus) return;
        resumeStatus.textContent = '';
        resumeStatus.className = 'resume-status';
      }

      function normalizeText(text) {
        return text.replace(/\s+/g, ' ').trim();
      }

      function limitText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return `${text.slice(0, maxLength)}\n\n[内容过长，已截断前 ${maxLength} 字用于分析]`;
      }

      function setAnalysisProgress(percent, message) {
        const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
        if (analysisProgressBar) analysisProgressBar.style.width = `${safePercent}%`;
        if (analysisProgressText) analysisProgressText.textContent = `${safePercent}%`;
        if (message && analysisLoadingText) analysisLoadingText.textContent = message;
      }

      function startAnalysisLoading(message) {
        if (analysisLoading) analysisLoading.classList.add('active');
        setAnalysisProgress(8, message || '正在准备分析...');
        clearInterval(analysisProgressTimer);
        analysisProgressTimer = setInterval(() => {
          const current = Number((analysisProgressText?.textContent || '0').replace('%', '')) || 0;
          if (current < 88) setAnalysisProgress(current + Math.max(1, Math.round((90 - current) / 10)));
        }, 900);
      }

      function finishAnalysisLoading() {
        clearInterval(analysisProgressTimer);
        setAnalysisProgress(100, '分析完成，正在生成结果弹窗...');
        setTimeout(() => {
          if (analysisLoading) analysisLoading.classList.remove('active');
          setAnalysisProgress(0, '正在读取简历内容...');
        }, 450);
      }

      function stopAnalysisLoading() {
        clearInterval(analysisProgressTimer);
        if (analysisLoading) analysisLoading.classList.remove('active');
        setAnalysisProgress(0, '正在读取简历内容...');
      }

      function parseAnalysisJson(text) {
        try {
          return JSON.parse(text);
        } catch (error) {
          const match = text.match(/\{[\s\S]*\}/);
          if (!match) throw new Error('AI 返回内容不是可解析的 JSON。');
          return JSON.parse(match[0]);
        }
      }

      function formatAnalysisScore(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        return Math.round(Math.max(0, Math.min(100, num)) * 100) / 100;
      }

      function formatScoreText(value) {
        const score = formatAnalysisScore(value);
        return score === null ? '' : score.toFixed(2);
      }

      function inferMatchLevel(score) {
        const normalized = formatAnalysisScore(score);
        if (normalized === null) return '待判断';
        if (normalized >= 80) return '高';
        if (normalized >= 60) return '中';
        return '低';
      }

      function normalizeAnalysisScores(analysis) {
        if (!analysis || typeof analysis !== 'object') return analysis;

        asArray(analysis.matchedPositions).forEach(position => {
          const breakdown = position.scoreBreakdown;
          if (breakdown && typeof breakdown === 'object') {
            Object.values(breakdown).forEach(dimension => {
              if (dimension && typeof dimension === 'object' && 'score' in dimension) {
                dimension.score = formatAnalysisScore(dimension.score);
              }
            });

            const weightedDimensions = Object.values(breakdown).filter(dimension => dimension && typeof dimension === 'object' && Number.isFinite(Number(dimension.score)));
            if (weightedDimensions.length) {
              const totalWeight = weightedDimensions.reduce((sum, dimension) => sum + (Number(dimension.weight) > 0 ? Number(dimension.weight) : 0), 0);
              if (totalWeight > 0) {
                const composite = weightedDimensions.reduce((sum, dimension) => sum + Number(dimension.score) * Number(dimension.weight), 0) / totalWeight;
                position.score = formatAnalysisScore(composite);
              }
            }
          }

          position.score = formatAnalysisScore(position.score);
          if (position.score !== null) {
            position.matchLevel = inferMatchLevel(position.score);
          }
        });

        const charts = analysis.charts || {};
        ['positionScores', 'abilityScores'].forEach(key => {
          asArray(charts[key]).forEach(item => {
            if (item) item.score = formatAnalysisScore(item.score);
          });
        });
        asArray(charts.riskSignals).forEach(item => {
          if (item) item.level = formatAnalysisScore(item.level);
        });

        return analysis;
      }

      function renderScoreBreakdown(breakdown) {
        if (!breakdown || typeof breakdown !== 'object') return '';
        const items = Object.values(breakdown).filter(item => item && typeof item === 'object');
        if (!items.length) return '';
        return `
          <div class="analysis-score-breakdown">
            <h4>评分明细</h4>
            <ul>
              ${items
                .map(item => {
                  const weightText = Number(item.weight) > 0 ? `（权重 ${Math.round(Number(item.weight) * 100)}%）` : '';
                  const reasonText = item.reason ? ` — ${escapeHTML(item.reason)}` : '';
                  return `<li><b>${escapeHTML(item.label || '评分维度')}</b> ${formatScoreText(item.score)} 分${weightText}${reasonText}</li>`;
                })
                .join('')}
            </ul>
          </div>
        `;
      }

      function asArray(value) {
        return Array.isArray(value) ? value : [];
      }

      function renderList(items, formatter) {
        const list = asArray(items).filter(Boolean);
        if (!list.length) return '<p>暂无明确结论。</p>';
        return `<ul>${list.map(item => `<li>${formatter ? formatter(item) : escapeHTML(String(item))}</li>`).join('')}</ul>`;
      }

      function updateCandidateName(name) {
        const displayName = name && name !== '未知' ? name : '未能从简历中明确识别';
        if (analysisCandidate) analysisCandidate.textContent = `候选人：${displayName}`;
      }

      function updateAnalysisMatchBadge(topPosition) {
        if (!analysisMatchBadge) return;
        const level = topPosition?.matchLevel || '待判断';
        const scoreText =
          topPosition?.score !== undefined && topPosition?.score !== null ? ` / ${formatScoreText(topPosition.score)} 分` : '';
        analysisMatchBadge.hidden = false;
        analysisMatchBadge.textContent = `匹配度：${level}${scoreText}`;
      }

      function createAnalysisRecord(analysis, resumeText = '', fileName = '', manualFields = {}, targetPosition = '') {
        return {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          savedAt: new Date().toISOString(),
          fileName,
          manualFields,
          targetPosition: targetPosition || analysis.primaryTargetPosition || '',
          analysis,
          resumeText: limitText(resumeText, 50000),
        };
      }

      function saveAnalysisCache(analysis, resumeText = '', fileName = '', manualFields = {}, targetPosition = '') {
        const record = createAnalysisRecord(analysis, resumeText, fileName, manualFields, targetPosition);
        try {
          localStorage.setItem(RESUME_ANALYSIS_CACHE_KEY, JSON.stringify(record));
          addAnalysisHistoryRecord(record);
          currentAnalysisId = record.id;
          renderResumeHistory();
        } catch (error) {
          console.warn('保存简历分析缓存失败', error);
        }
        return record;
      }

      function loadAnalysisCache() {
        try {
          const raw = localStorage.getItem(RESUME_ANALYSIS_CACHE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (error) {
          console.warn('读取简历分析缓存失败', error);
          return null;
        }
      }

      function loadAnalysisHistory() {
        try {
          const raw = localStorage.getItem(RESUME_ANALYSIS_HISTORY_KEY);
          const records = raw ? JSON.parse(raw) : [];
          return Array.isArray(records) ? records : [];
        } catch (error) {
          console.warn('读取简历分析历史失败', error);
          return [];
        }
      }

      function saveAnalysisHistory(records) {
        try {
          localStorage.setItem(RESUME_ANALYSIS_HISTORY_KEY, JSON.stringify(records.slice(0, 30)));
        } catch (error) {
          console.warn('保存简历分析历史失败', error);
        }
      }

      function addAnalysisHistoryRecord(record) {
        const records = loadAnalysisHistory().filter(item => item.id !== record.id);
        records.unshift(record);
        saveAnalysisHistory(records);
      }

      function saveInterviewReportCache(summary, report) {
        try {
          localStorage.setItem(
            INTERVIEW_REPORT_CACHE_KEY,
            JSON.stringify({
              savedAt: new Date().toISOString(),
              analysisId: currentAnalysisId,
              summary,
              report,
            }),
          );
          updateHistoryReport(currentAnalysisId, summary, report);
        } catch (error) {
          console.warn('保存面试纪要缓存失败', error);
        }
      }

      function updateHistoryReport(analysisId, summary, report) {
        if (!analysisId) return;
        const records = loadAnalysisHistory();
        const nextRecords = records.map(item => (item.id === analysisId ? { ...item, interviewSummary: summary, interviewReport: report } : item));
        saveAnalysisHistory(nextRecords);
        renderResumeHistory();
      }

      function loadInterviewReportCache() {
        try {
          const raw = localStorage.getItem(INTERVIEW_REPORT_CACHE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (error) {
          console.warn('读取面试纪要缓存失败', error);
          return null;
        }
      }

      function clearInterviewReportCache() {
        try {
          localStorage.removeItem(INTERVIEW_REPORT_CACHE_KEY);
        } catch (error) {
          console.warn('清空面试纪要缓存失败', error);
        }
      }

      function formatHistoryTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      }

      function getTopPositionName(analysis) {
        return asArray(analysis?.matchedPositions)[0]?.position || '岗位待判断';
      }

      function renderResumeHistory() {
        if (!resumeHistoryList) return;
        const records = loadAnalysisHistory();
        if (!records.length) {
          resumeHistoryList.innerHTML = '<div class="resume-history-empty">暂无本地分析记录。每次完成 AI 简历分析后会自动保存到这里。</div>';
          return;
        }
        resumeHistoryList.innerHTML = records
          .map(record => {
            const name = record.analysis?.candidateName && record.analysis.candidateName !== '未知' ? record.analysis.candidateName : '候选人';
            const position = getTopPositionName(record.analysis);
            const reportText = record.interviewReport ? '｜已生成纪要' : '';
            const fields = record.manualFields || {};
            return `
            <div class="resume-history-item">
              <div class="resume-history-row">
                <div>
                  <div class="resume-history-name">${escapeHTML(name)}｜${escapeHTML(position)}</div>
                  <div class="resume-history-meta">${escapeHTML(record.fileName || '未记录文件名')}｜${escapeHTML(formatHistoryTime(record.savedAt))}${reportText}</div>
                </div>
                <div class="resume-history-buttons">
                  <button class="resume-history-open" type="button" data-history-id="${escapeHTML(record.id)}">查看</button>
                  <button class="resume-history-edit" type="button" data-history-id="${escapeHTML(record.id)}">编辑信息</button>
                </div>
              </div>
              <div class="resume-history-edit-panel" data-edit-panel="${escapeHTML(record.id)}">
                <div class="resume-history-edit-grid">
                  <div><label>应聘部门</label><input data-field="department" value="${escapeHTML(fields.department || '')}"></div>
                  <div><label>测试</label><input data-field="test" value="${escapeHTML(fields.test || '')}"></div>
                  <div><label>面试</label><input data-field="interview" value="${escapeHTML(fields.interview || '')}"></div>
                  <div><label>招聘渠道</label><input data-field="channel" value="${escapeHTML(fields.channel || '')}"></div>
                  <div><label>人事专员</label><input data-field="hr" value="${escapeHTML(fields.hr || '')}"></div>
                  <div><label>意向程度</label><select data-field="intent"><option value="">/</option><option value="高" ${fields.intent === '高' ? 'selected' : ''}>高</option><option value="中" ${fields.intent === '中' ? 'selected' : ''}>中</option><option value="低" ${fields.intent === '低' ? 'selected' : ''}>低</option></select></div>
                  <div><label>可入职</label><input data-field="availableDate" value="${escapeHTML(fields.availableDate || '')}"></div>
                  <div><label>面试类型</label><input data-field="interviewType" value="${escapeHTML(fields.interviewType || '')}"></div>
                </div>
                <button class="resume-history-save" type="button" data-history-id="${escapeHTML(record.id)}">保存修改</button>
              </div>
            </div>
          `;
          })
          .join('');
      }

      function openAnalysisRecord(record) {
        if (!record?.analysis) return;
        currentAnalysisId = record.id || null;
        localStorage.setItem(RESUME_ANALYSIS_CACHE_KEY, JSON.stringify(record));
        if (record.interviewReport) {
          localStorage.setItem(
            INTERVIEW_REPORT_CACHE_KEY,
            JSON.stringify({
              savedAt: record.savedAt || new Date().toISOString(),
              analysisId: record.id,
              summary: record.interviewSummary || '',
              report: record.interviewReport,
            }),
          );
        } else {
          clearInterviewReportCache();
        }
        renderAnalysisModal(record.analysis, record);
        setResumeStatus('已打开本地缓存的简历分析记录。', 'success');
      }

      function toggleHistoryEditPanel(recordId) {
        const panel = resumeHistoryList?.querySelector(`[data-edit-panel="${CSS.escape(recordId)}"]`);
        if (panel) panel.classList.toggle('active');
      }

      function saveHistoryManualFields(recordId) {
        const panel = resumeHistoryList?.querySelector(`[data-edit-panel="${CSS.escape(recordId)}"]`);
        if (!panel) return;
        const manualFields = {};
        panel.querySelectorAll('[data-field]').forEach(input => {
          manualFields[input.dataset.field] = input.value.trim();
        });

        const records = loadAnalysisHistory();
        let updatedRecord = null;
        const nextRecords = records.map(record => {
          if (record.id !== recordId) return record;
          updatedRecord = { ...record, manualFields: { ...(record.manualFields || {}), ...manualFields } };
          return updatedRecord;
        });
        saveAnalysisHistory(nextRecords);

        const latest = loadAnalysisCache();
        if (latest?.id === recordId && updatedRecord) {
          localStorage.setItem(RESUME_ANALYSIS_CACHE_KEY, JSON.stringify(updatedRecord));
        }

        renderResumeHistory();
        setResumeStatus('导出信息已保存，重新导出 Excel 会使用最新内容。', 'success');
      }

      function clearAllLocalCache() {
        try {
          localStorage.removeItem(RESUME_ANALYSIS_CACHE_KEY);
          localStorage.removeItem(INTERVIEW_REPORT_CACHE_KEY);
          localStorage.removeItem(RESUME_ANALYSIS_HISTORY_KEY);
        } catch (error) {
          console.warn('清理本地缓存失败', error);
        }
        currentAnalysisId = null;
        if (analysisModal) analysisModal.classList.remove('active');
        renderResumeHistory();
        setResumeStatus('本地缓存已清理。', 'success');
      }

      function playClearCacheConfetti() {
        if (typeof confetti !== 'function') return;

        const colors = ['#e11d48', '#f59e0b', '#84cc16', '#06b6d4', '#8b5cf6', '#f97316', '#ec4899', '#c45c7a', '#fbbf24'];
        const defaults = { origin: { y: 0.65 }, zIndex: 1200, colors };

        confetti(Object.assign({}, defaults, { particleCount: 90, spread: 60, startVelocity: 50 }));
        confetti(Object.assign({}, defaults, { particleCount: 70, spread: 110, decay: 0.9, scalar: 0.95 }));
        confetti(Object.assign({}, defaults, { particleCount: 50, spread: 130, startVelocity: 32, scalar: 1.1, origin: { x: 0.15, y: 0.7 } }));
        confetti(Object.assign({}, defaults, { particleCount: 50, spread: 130, startVelocity: 32, scalar: 1.1, origin: { x: 0.85, y: 0.7 } }));
      }

      function fallback(value) {
        if (value === undefined || value === null) return '/';
        const text = String(value).trim();
        return text || '/';
      }

      function findTextByPatterns(text, patterns) {
        const source = text || '';
        for (const pattern of patterns) {
          const match = source.match(pattern);
          if (match?.[1]) return match[1].trim();
        }
        return '';
      }

      function getAnalysisText(record) {
        const analysis = record.analysis || {};
        return [JSON.stringify(analysis), record.resumeText || '', record.interviewSummary || '', record.interviewReport || ''].join('\n');
      }

      function inferEducation(record) {
        const text = getAnalysisText(record);
        if (/硕士|研究生/.test(text)) return '硕士';
        if (/本科/.test(text)) return '本科';
        if (/大专|专科/.test(text)) return '专科';
        if (/高中|中专/.test(text)) return '中专';
        return '/';
      }

      function inferSchool(record) {
        return fallback(findTextByPatterns(record.resumeText || record.interviewReport || '', [/([\u4e00-\u9fa5A-Za-z]{2,30}(?:大学|学院|职业技术学院|职业学院))/]));
      }

      function inferMajor(record) {
        return fallback(findTextByPatterns(record.resumeText || record.interviewReport || '', [/专业[:：\s]*([\u4e00-\u9fa5A-Za-z0-9（）()]{2,30})/, /([\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:专业))/]));
      }

      function inferConclusion(record) {
        const decision = record.analysis?.recommendation?.decision || '';
        const report = record.interviewReport || '';
        if (/不建议|暂不推进|结束流程|不通过/.test(`${decision}\n${report}`)) return '不通过';
        if (/谨慎/.test(decision)) return '待定';
        if (/建议|通过|推进/.test(`${decision}\n${report}`)) return '通过';
        return '/';
      }

      function inferPosition(record) {
        return fallback(record?.targetPosition || record?.analysis?.primaryTargetPosition || getTopPositionName(record.analysis));
      }

      function buildInterviewSummaryForExcel(record) {
        const analysis = record.analysis || {};
        const strengths = asArray(analysis.strengths)
          .map(item => item.item || item.evidence)
          .filter(Boolean)
          .slice(0, 3);
        const weaknesses = asArray(analysis.weaknesses)
          .map(item => item.item || item.evidence)
          .filter(Boolean)
          .slice(0, 3);
        const questions = asArray(analysis.interviewQuestions)
          .map(item => item.question)
          .filter(Boolean)
          .slice(0, 3);
        const recommendation = analysis.recommendation?.reason || '';
        const lines = [];
        if (strengths.length) lines.push(`优势：${strengths.join('；')}`);
        if (weaknesses.length) lines.push(`不足/风险：${weaknesses.join('；')}`);
        if (recommendation) lines.push(`结论：${recommendation}`);
        if (questions.length) lines.push(`建议追问：${questions.join('；')}`);
        return fallback(lines.join('\n'));
      }

      function buildExcelRows(records) {
        return records.map(record => ({
          姓名: fallback(record.analysis?.candidateName && record.analysis.candidateName !== '未知' ? record.analysis.candidateName : ''),
          学历: inferEducation(record),
          学校: inferSchool(record),
          专业: inferMajor(record),
          应聘部门: fallback(record.manualFields?.department),
          应聘岗位: inferPosition(record),
          测试: fallback(record.manualFields?.test),
          面试: fallback(record.manualFields?.interview),
          终审结果: inferConclusion(record),
          招聘渠道: fallback(record.manualFields?.channel),
          人事专员: fallback(record.manualFields?.hr),
          人才等级: fallback(record.analysis?.matchedPositions?.[0]?.matchLevel),
          意向程度: fallback(record.manualFields?.intent),
          可入职: fallback(record.manualFields?.availableDate),
          面试记录表格: buildInterviewSummaryForExcel(record),
          备注: fallback(record.interviewReport || record.analysis?.recommendation?.reason),
          面试类型: fallback(record.manualFields?.interviewType || '线上一面'),
        }));
      }

      function exportHistoryToExcel() {
        if (!window.XLSX) {
          setResumeStatus('Excel 导出库加载失败，请刷新页面后重试。', 'error');
          return;
        }
        const records = loadAnalysisHistory();
        if (!records.length) {
          setResumeStatus('暂无本地简历分析记录，无法导出 Excel。', 'error');
          return;
        }

        const rows = buildExcelRows(records);
        const ws = window.XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = Object.keys(rows[0]).map(key => ({
          wch: key === '面试记录表格' || key === '备注' ? 42 : 12,
        }));
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, '面试记录');
        const dateText = new Date().toISOString().slice(0, 10);
        window.XLSX.writeFile(wb, `面试记录-${dateText}.xlsx`);
        setResumeStatus('Excel 已导出。', 'success');
      }

      function getDeepSeekKeyFromUrl() {
        return new URLSearchParams(window.location.search).get('key')?.trim() || '';
      }

      async function extractPdfText(file) {
        if (!window.pdfjsLib) {
          throw new Error('PDF 解析库加载失败，请刷新页面后重试。');
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          pages.push(pageText);
        }

        return normalizeText(pages.join('\n'));
      }

      async function extractDocxText(file) {
        if (!window.mammoth) {
          throw new Error('Word 解析库加载失败，请刷新页面后重试。');
        }
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        return normalizeText(result.value || '');
      }

      async function extractResumeText(file) {
        const fileName = file.name.toLowerCase();
        if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
          return extractPdfText(file);
        }
        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
          return extractDocxText(file);
        }
        throw new Error('暂时只支持 PDF 和 Word .docx 简历。');
      }

      async function extractAttachmentText(file, onProgress) {
        const fileName = file.name.toLowerCase();
        const isImage = file.type.startsWith('image/') || fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.webp') || fileName.endsWith('.gif') || fileName.endsWith('.bmp');

        if (file.type.startsWith('text/') || fileName.endsWith('.txt')) {
          return normalizeText(await file.text());
        }
        if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
          return extractPdfText(file);
        }
        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
          return extractDocxText(file);
        }
        if (isImage) {
          return extractImageText(file, onProgress);
        }
        throw new Error('附件暂时只支持 PDF、Word .docx、TXT、PNG、JPG。');
      }

      async function extractImageText(file, onProgress) {
        if (!window.Tesseract) {
          throw new Error('图片识别库加载失败，请刷新页面后重试。');
        }

        if (typeof onProgress === 'function') {
          onProgress('正在识别图片文字，首次可能需要下载中文识别包...');
        }

        const result = await window.Tesseract.recognize(file, 'chi_sim+eng', {
          logger: message => {
            if (typeof onProgress !== 'function') return;
            if (message.status === 'loading language traineddata') {
              onProgress('正在加载中文识别包...');
              return;
            }
            if (message.status === 'initializing api' || message.status === 'loading tesseract core') {
              onProgress('正在初始化图片识别...');
              return;
            }
            if (message.status === 'recognizing text') {
              const percent = Math.round((message.progress || 0) * 100);
              onProgress(`正在识别图片文字 ${percent}%...`);
            }
          },
        });

        return normalizeText(result?.data?.text || '');
      }

      function getHandbookText() {
        return Array.from(document.querySelectorAll('.section'))
          .map(section => normalizeText(section.textContent))
          .filter(Boolean)
          .join('\n\n');
      }

      const HANDBOOK_POSITIONS = ['亚马逊运营专员', '亚马逊运营主管', '沃尔玛运营专员', '沃尔玛运营主管', 'TikTok运营助理', 'TikTok 运营专员', 'TikTok商务BD', 'TikTok商务BD主管', '独立站运营专员', 'Wayfair 运营专员', 'Coupang 运营专员', '海外社媒推广专员', '海外社媒主管', '亚马逊站外推广专员'];

      const POSITION_SECTION_MAP = {
        亚马逊运营专员: ['5-亚马逊运营专员', '19-1-亚马逊'],
        亚马逊运营主管: ['6-亚马逊运营主管', '19-1-亚马逊'],
        沃尔玛运营专员: ['7-沃尔玛运营专员', '19-2-沃尔玛'],
        沃尔玛运营主管: ['8-沃尔玛运营主管', '19-2-沃尔玛'],
        TikTok运营助理: ['9-TikTok运营助理', '19-3-TikTok'],
        'TikTok 运营专员': ['10-TikTok-运营专员', '19-3-TikTok'],
        TikTok商务BD: ['11-TikTok商务BD', '19-9-TikTok商务BD'],
        TikTok商务BD主管: ['12-TikTok商务BD主管', '19-9-TikTok商务BD'],
        独立站运营专员: ['13-独立站运营专员', '19-4-独立站'],
        'Wayfair 运营专员': ['14-Wayfair-运营专员', '19-5-Wayfair'],
        'Coupang 运营专员': ['15-Coupang-运营专员', '19-6-Coupang'],
        海外社媒推广专员: ['16-海外社媒推广专员', '19-7-海外社媒'],
        海外社媒主管: ['17-海外社媒主管', '19-7-海外社媒'],
        亚马逊站外推广专员: ['18-亚马逊站外推广专员', '19-8-亚马逊站外推广'],
      };

      const COMMON_HANDBOOK_IDS = ['1-HR-初面整体流程', '2-面试前-10-分钟必须问清楚', '3-简历筛选重点', '4-推荐给部门时怎么写', '20-HR-追问专业词的通用话术', '21-常见红旗信号'];

      const POSITION_SCOPE = {
        亚马逊运营专员: {
          excludeInWeakness: /tiktok shop|抖音小店|短视频|直播|达人带货|沃尔玛|walmart|buy\s*box|独立站|shopify|wayfair|castlegate|coupang|酷澎|火箭配送|海外社媒|社媒运营|instagram运营|内容日历|亚马逊站外推广专员|meta ads|google ads/i,
          abilityNames: ['平台经验', '广告能力', '数据复盘', '库存意识', 'Listing', '风险意识'],
        },
        亚马逊运营主管: {
          excludeInWeakness: /tiktok shop|抖音小店|短视频|直播|达人带货|沃尔玛|walmart|buy\s*box|独立站|shopify|wayfair|castlegate|coupang|酷澎|火箭配送|海外社媒|社媒运营|instagram运营|内容日历|亚马逊站外推广专员|meta ads|google ads/i,
          abilityNames: ['平台经验', '广告能力', '数据复盘', '库存意识', '团队管理', '风险意识'],
        },
        沃尔玛运营专员: {
          excludeInWeakness: /亚马逊|amazon|\bacos\b|\bfba\b|tiktok shop|抖音|短视频|直播|达人|独立站|shopify|wayfair|castlegate|coupang|酷澎|火箭配送|海外社媒|社媒运营|内容日历|亚马逊站外推广专员|meta ads|google ads/i,
          abilityNames: ['平台经验', '广告能力', '数据复盘', '库存意识', '价格竞争', '风险意识'],
        },
        沃尔玛运营主管: {
          excludeInWeakness: /亚马逊|amazon|\bacos\b|\bfba\b|tiktok shop|抖音|短视频|直播|达人|独立站|shopify|wayfair|castlegate|coupang|酷澎|火箭配送|海外社媒|社媒运营|内容日历|亚马逊站外推广专员|meta ads|google ads/i,
          abilityNames: ['平台经验', '广告能力', '数据复盘', '团队管理', '库存意识', '风险意识'],
        },
        'TikTok 运营专员': {
          excludeInWeakness: /亚马逊|amazon|\bacos\b|\bfba\b|沃尔玛|walmart|buy\s*box|独立站|shopify|独立站转化|listing优化|wayfair|castlegate|coupang|酷澎|火箭配送|海外社媒推广专员|内容日历|instagram运营|facebook运营|亚马逊站外推广专员|TikTok运营助理|TikTok商务BD|TikTok商务BD主管|bd团队|meta ads|google ads|asa\b/i,
          abilityNames: ['内容营销', '达人', '直播', '平台经验', '数据复盘', '转化', '风险意识'],
        },
        独立站运营专员: {
          excludeInWeakness: /亚马逊|amazon|\bacos\b|\bfba\b|沃尔玛|walmart|tiktok shop|抖音|达人带货|直播带货|wayfair|castlegate|coupang|酷澎|火箭配送|海外社媒推广专员|内容日历|instagram运营|社媒互动/i,
          abilityNames: ['独立站转化', '平台经验', '广告能力', '数据复盘', '落地页', '风险意识'],
        },
        'Wayfair 运营专员': {
          excludeInWeakness: /亚马逊|amazon|\bacos\b|\bfba\b|沃尔玛|walmart|tiktok|抖音|短视频|直播|达人|独立站|shopify|coupang|酷澎|火箭配送|search tag|海外社媒|社媒运营|内容日历|亚马逊站外推广专员|meta ads|google ads/i,
          abilityNames: ['平台经验', 'Listing', '广告能力', '数据复盘', '库存意识', '退货率', '风险意识'],
        },
        'Coupang 运营专员': {
          excludeInWeakness: /亚马逊|amazon|\bacos\b|\bfba\b|沃尔玛|walmart|tiktok|抖音|短视频|直播|达人|独立站|shopify|wayfair|castlegate|海外社媒|社媒运营|内容日历|亚马逊站外推广专员|meta ads|google ads/i,
          abilityNames: ['平台经验', 'Search Tag', '广告能力', '数据复盘', 'Rocket', '履约', 'Review', '风险意识'],
        },
        海外社媒推广专员: {
          excludeInWeakness: /\bacos\b|\bfba\b|沃尔玛|walmart|wayfair|castlegate|coupang|酷澎|火箭配送|tiktok shop|独立站转化|listing优化|sku管理|站内广告|sp\/sb|测评统筹|deals站|reviewer资源|亚马逊站外推广专员|TikTok运营助理|TikTok商务BD|TikTok商务BD主管|团队管理缺失|主管经验缺失|google ads|asa\b/i,
          abilityNames: ['内容营销', '社媒', '短视频', '达人', 'KOL', '广告投放', '数据复盘', '英语', '风险意识'],
        },
        海外社媒主管: {
          excludeInWeakness: /\bacos\b|\bfba\b|沃尔玛|walmart|wayfair|castlegate|coupang|酷澎|火箭配送|tiktok shop|独立站转化|listing优化|sku管理|站内广告|sp\/sb|测评统筹|deals站|reviewer资源|亚马逊站外推广专员|TikTok运营助理|TikTok商务BD|TikTok商务BD主管|affiliate联盟|google ads|asa\b/i,
          abilityNames: ['策略', '内容营销', '社媒', '达人', 'KOL', '广告投放', '数据复盘', '团队管理', '英语', '风险意识'],
        },
        亚马逊站外推广专员: {
          excludeInWeakness: /沃尔玛|walmart|wayfair|castlegate|coupang|酷澎|火箭配送|tiktok shop|达人寄样|直播带货|listing五点|a\+|站内sp|站内sb|\bfba\b补货|sku管理|内容日历|粉丝增长|社媒互动率|海外社媒推广专员|海外社媒主管|TikTok运营助理|TikTok商务BD|TikTok商务BD主管|meta ads结构|google ads出价/i,
          abilityNames: ['站外推广', '测评', 'Deals', '论坛', 'Reviewer', '引流', '数据复盘', '风险意识', '账号安全'],
        },
        TikTok运营助理: {
          excludeInWeakness: /\bacos\b|\bfba\b|沃尔玛|walmart|wayfair|castlegate|coupang|酷澎|火箭配送|独立站转化|listing优化|站内广告|sp\/sb|测评统筹|deals站|reviewer资源|达人建联谈判|bd团队|团队管理缺失|主管经验缺失|策略缺失|gmv增长责任|亚马逊站外推广专员|TikTok商务BD|meta ads结构|google ads出价/i,
          abilityNames: ['店铺维护', '商品卡', '素材支持', '数据整理', '库存物流', '售后跟进', 'Excel', '执行力', '英语'],
        },
        TikTok商务BD: {
          excludeInWeakness: /\bacos\b|\bfba\b|沃尔玛|walmart|wayfair|castlegate|coupang|酷澎|火箭配送|独立站转化|listing优化|sku管理|站内广告|sp\/sb|测评统筹|deals站|reviewer资源|内容日历|粉丝增长|社媒剪辑|亚马逊站外推广专员|TikTok运营助理|团队管理缺失|主管经验缺失|bd团队|meta ads结构|google ads出价/i,
          abilityNames: ['达人BD', '商务谈判', '达人挖掘', 'Affiliate', '内容配合', '建联率', '合作率', '带货转化', '数据复盘', '英语'],
        },
        TikTok商务BD主管: {
          excludeInWeakness: /\bacos\b|\bfba\b|沃尔玛|walmart|wayfair|castlegate|coupang|酷澎|火箭配送|独立站转化|listing优化|sku管理|站内广告|sp\/sb|测评统筹|deals站|reviewer资源|内容日历|粉丝增长|社媒剪辑|脚本制作|亚马逊站外推广专员|TikTok运营助理|meta ads结构|google ads出价/i,
          abilityNames: ['达人BD', '商务谈判', 'MCN', 'Affiliate', '团队管理', '建联率', '合作率', '带货转化', '数据复盘', '跨部门协作'],
        },
      };

      const POSITION_MATCH_HINTS = {
        亚马逊运营专员: '锚定亚马逊店铺运营：站点、品类、SKU、FBA/FBM、Listing、站内广告（SP/SB/SD）、ACOS/TACOS、库存周转。不要按社媒内容或站外投放标准评估。',
        亚马逊运营主管: '锚定亚马逊团队管理与经营结果：目标拆解、人效、广告与利润、库存风险、复盘机制。薄弱点只谈管理深度与经营闭环，不谈其他平台缺失。',
        沃尔玛运营专员: '锚定沃尔玛美国站运营：WFS/3P、Buy Box、价格竞争力、站内广告、履约与售后。不要用亚马逊 ACOS/FBA 话术硬套。',
        沃尔玛运营主管: '锚定沃尔玛管理岗：店铺经营、团队分工、活动节奏、利润与库存风险。禁止把亚马逊/TikTok 经验缺失写成弱点。',
        'TikTok 运营专员': '锚定 TikTok Shop / 内容电商：短视频、直播、达人、货盘、转化承接、GMV。区分于纯品牌社媒和纯付费投放；禁止写“缺乏亚马逊经验”。',
        TikTok运营助理: '锚定 TikTok Shop 运营助理执行支持岗：商品卡维护、素材整理发布、日报周报、库存/物流跟进、售后升级与跨部门同步。应届生可培养，重点看细心度、执行力、Excel与英文读写。禁止按运营专员独立增长责任、达人 BD 谈判、团队管理缺失来扣分。',
        独立站运营专员: '锚定独立站/品牌站：Shopify 等建站、流量承接、落地页、加购/结账转化、邮件短信、站点运营。站外投放可作加分，但不能按纯 Media Buyer 标准苛责。',
        'Wayfair 运营专员': '锚定 Wayfair：家居类目、Castlegate/自发货、Listing 内容质量、退货率、广告 ROAS、供货稳定。禁止跨平台弱点。',
        'Coupang 运营专员': '锚定 Coupang 韩台站点：Rocket Growth、Search Tag、站内广告、发货时效、Review。禁止写 Wayfair/亚马逊缺失。',
        海外社媒推广专员: '锚定海外社媒推广执行岗：TikTok/Instagram/Facebook 账号运营、内容策划创作（选题/文案/脚本/剪辑）、KOL/KOC 协同、社媒广告素材测试与数据复盘。禁止按团队管理缺失、亚马逊站外测评/Deals、TikTok Shop、站内 Listing/SP 缺失来扣分。',
        海外社媒主管: '锚定海外社媒策略与管理岗：社媒推广策略制定落地、多平台内容规划指导、KOL/KOC 策略、社媒广告与数据分析统筹、团队/项目管理和跨部门协作，对曝光、增长、转化结果负责。禁止按基层剪辑执行不足、亚马逊站外测评/Deals、TikTok Shop、站内运营缺失来扣分。',
        亚马逊站外推广专员: '锚定亚马逊站外推广：测评统筹、国外资源开发、美欧 Deals 站/论坛、Reviewer 维护、站外引流打爆款、账号安全与效果复盘。社媒只是辅助渠道。禁止按站内 Listing/FBA/SP 广告、纯社媒内容运营、海外社媒主管标准乱扣分。',
        TikTok商务BD: '锚定 TikTok 达人商务专员执行岗：TikTok/站外达人挖掘建联、分层筛选、商务谈判与合作落地、鞋靴等内容配合与产出把控、曝光/点击/转化/GMV 复盘、达人关系维护与中腰部拓展。禁止按 BD 主管团队管理缺失、TikTok Shop 店铺运营、纯社媒内容剪辑、亚马逊站外测评/Deals 标准乱扣分。',
        TikTok商务BD主管: '锚定 TikTok 海外达人商务管理：美区达人/MCN 拓展、筛选建联谈判、鞋类等品类带货/测评合作、BD 团队目标与绩效、建联率/合作率/视频产出/带货转化复盘、Affiliate 优先。禁止按 TikTok Shop 店铺运营、纯社媒内容剪辑、亚马逊站外测评/Deals 标准乱扣分。',
      };

      function getSectionTextById(id) {
        const section = document.getElementById(id);
        return section ? normalizeText(section.textContent) : '';
      }

      function getHandbookTextForAnalysis(targetPosition = '') {
        const sectionIds = new Set(COMMON_HANDBOOK_IDS);
        if (targetPosition && POSITION_SECTION_MAP[targetPosition]) {
          POSITION_SECTION_MAP[targetPosition].forEach(id => sectionIds.add(id));
        } else {
          Object.values(POSITION_SECTION_MAP)
            .flat()
            .forEach(id => sectionIds.add(id));
        }
        return Array.from(sectionIds).map(getSectionTextById).filter(Boolean).join('\n\n');
      }

      function inferTargetPositionFromResume(resumeText = '') {
        const text = resumeText.toLowerCase();
        const rules = [
          {
            position: 'TikTok商务BD主管',
            patterns: [/TikTok商务BD主管/, /tiktok\s*bd\s*主管/i, /达人bd主管/i, /商务bd主管/, /bd主管/, /bd团队/, /tiktok.*达人.*管理/i],
          },
          {
            position: 'TikTok商务BD',
            patterns: [/TikTok商务BD/, /tiktok\s*bd/i, /达人bd/i, /达人商务/, /商务bd/, /tiktok.*达人拓展/i, /mcn.*达人/, /affiliate.*tiktok/i, /建联率/, /kalodata/i, /fastmoss/i, /echotik/i],
          },
          {
            position: '亚马逊站外推广专员',
            patterns: [/亚马逊站外推广/, /海外推广/, /站外推广/, /亚马逊站外/, /测评/, /reviewer/i, /deals?\s*站/i, /deal站点/i, /论坛推广/, /vine/i],
          },
          {
            position: '海外社媒主管',
            patterns: [/海外社媒主管/, /社媒主管/, /社媒经理/, /social media manager/i, /社媒推广策略/, /社媒团队/],
          },
          {
            position: '海外社媒推广专员',
            patterns: [/海外社媒/, /社媒推广/, /社媒运营/, /social media/i, /instagram/i, /内容策划/, /短视频脚本/, /kol\/koc/i, /koc/, /品牌社媒/, /facebook运营/],
          },
          {
            position: 'TikTok运营助理',
            patterns: [/TikTok运营助理/, /tiktok\s*运营助理/i, /店铺助理/, /运营助理/, /tiktok\s*assistant/i, /商品卡维护/, /素材库/, /数据整理/, /备货补货/],
          },
          { position: 'TikTok 运营专员', patterns: [/tiktok shop/i, /抖音/, /短视频运营/, /直播运营/, /达人运营/, /tiktok运营/i] },
          { position: 'Coupang 运营专员', patterns: [/coupang/i, /酷澎/, /火箭配送/, /rocket growth/i, /韩国站/, /韩国市场/] },
          { position: 'Wayfair 运营专员', patterns: [/wayfair/i, /castlegate/i] },
          { position: '独立站运营专员', patterns: [/独立站/, /shopify/i, /品牌站/, /建站运营/] },
          { position: '沃尔玛运营主管', patterns: [/沃尔玛/, /walmart/i, /运营主管/, /运营经理/, /店铺负责人/] },
          { position: '沃尔玛运营专员', patterns: [/沃尔玛/, /walmart/i] },
          { position: '亚马逊运营主管', patterns: [/亚马逊/, /amazon/i, /运营主管/, /运营经理/, /店铺负责人/] },
          { position: '亚马逊运营专员', patterns: [/亚马逊/, /amazon/i, /\bacos\b/i, /\bfba\b/i] },
        ];
        for (const rule of rules) {
          if (rule.patterns.some(pattern => pattern.test(resumeText) || pattern.test(text))) {
            return rule.position;
          }
        }
        return '';
      }

      function resolveTargetPosition(selectedPosition = '', resumeText = '', analysis = null) {
        if (selectedPosition) return selectedPosition;
        const inferred = inferTargetPositionFromResume(resumeText);
        if (inferred) return inferred;
        return analysis?.primaryTargetPosition || asArray(analysis?.matchedPositions)[0]?.position || '';
      }

      function shouldKeepScopedWeakness(text, scope) {
        if (!scope?.excludeInWeakness?.test(text)) return true;
        const targetKeywords = scope.abilityNames || [];
        return targetKeywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
      }

      function scopeAnalysisToTargetPosition(analysis, targetPosition = '') {
        if (!analysis || !targetPosition) return analysis;
        const scope = POSITION_SCOPE[targetPosition];
        analysis.primaryTargetPosition = targetPosition;

        const positions = asArray(analysis.matchedPositions);
        const targetIndex = positions.findIndex(item => item.position === targetPosition);
        if (targetIndex > 0) {
          const [matched] = positions.splice(targetIndex, 1);
          positions.unshift(matched);
          analysis.matchedPositions = positions;
        }

        if (scope) {
          analysis.weaknesses = asArray(analysis.weaknesses).filter(item => {
            const text = `${item.item || ''} ${item.evidence || ''}`;
            return shouldKeepScopedWeakness(text, scope);
          });
          analysis.interviewQuestions = asArray(analysis.interviewQuestions).filter(item => {
            const text = `${item.question || ''} ${item.confirm || ''}`;
            return shouldKeepScopedWeakness(text, scope);
          });

          const charts = analysis.charts || {};
          charts.riskSignals = asArray(charts.riskSignals).filter(item => shouldKeepScopedWeakness(item.name || '', scope));
          const filteredAbilities = asArray(charts.abilityScores).filter(item => {
            const name = item.name || '';
            return (scope.abilityNames || []).some(keyword => name.includes(keyword) || keyword.includes(name));
          });
          if (filteredAbilities.length) {
            charts.abilityScores = filteredAbilities;
          }
          analysis.charts = charts;
        }

        return analysis;
      }

      function buildResumeAnalysisPrompt(resumeText, handbookText, options = {}) {
        const { targetPosition = '', inferredTargetPosition = '' } = options;
        const focusPosition = targetPosition || inferredTargetPosition || '';
        const matchHint = focusPosition && POSITION_MATCH_HINTS[focusPosition] ? POSITION_MATCH_HINTS[focusPosition] : '';
        const targetInstruction = targetPosition
          ? `本次分析的唯一目标岗位是：${targetPosition}。primaryTargetPosition 必须写 ${targetPosition}。所有 strengths、weaknesses、interviewQuestions、recommendation、charts.riskSignals、charts.abilityScores 只能围绕该岗位及其对应平台评估。`
          : inferredTargetPosition
            ? `请先从简历判断应聘岗位，当前简历倾向：${inferredTargetPosition}。primaryTargetPosition 必须写 ${inferredTargetPosition}，并只围绕该岗位输出分析。`
            : '请先从简历识别候选人最想应聘的岗位（求职意向/工作经历主导方向），写入 primaryTargetPosition，后续分析只围绕该岗位。';

        const scopeRules = `
岗位收窄规则（必须严格执行）：
1. weaknesses、charts.riskSignals 只能写“目标岗位”相关的风险。
2. 禁止把“缺乏其他岗位/平台经验”写成薄弱点。尤其注意边界：
   - 海外社媒推广专员 ≠ 海外社媒主管 ≠ 亚马逊站外推广专员（测评/Deals/论坛）≠ TikTok运营助理 ≠ TikTok 运营专员 ≠ TikTok商务BD ≠ TikTok商务BD主管
   - 海外社媒推广专员偏执行：内容创作、账号运营、达人协同、社媒广告素材测试
   - 海外社媒主管偏策略与管理：策略制定、团队/项目统筹、结果负责
   - TikTok运营助理偏店铺日常支持：商品卡、素材整理发布、数据报表、库存物流跟进、售后升级
   - TikTok 运营专员偏内容电商增长：短视频/直播/达人/货盘/转化/GMV，不要按助理执行或纯 BD 商务标准乱扣分
   - TikTok商务BD 偏达人商务执行：达人挖掘分层、建联谈判落地、内容配合、曝光/点击/转化/GMV 复盘
   - TikTok商务BD主管偏达人商务与团队管理：美区达人/MCN 拓展、谈判、带货合作、建联率/合作率/转化、BD 团队管理
3. 如果候选人在目标岗位能力上经验不足，才写薄弱点；不要评价其未应聘的岗位。
4. interviewQuestions 必须只问目标岗位手册里的业务问题，不要问无关平台问题。
5. charts.abilityScores 只保留与目标岗位相关的能力项：
   - 亚马逊：平台经验、Listing、广告能力、库存意识、数据复盘、风险意识
   - 沃尔玛：平台经验、价格竞争、广告能力、库存意识、数据复盘、风险意识
   - TikTok：内容营销、达人、直播、转化、数据复盘、风险意识
   - 独立站：独立站转化、落地页、广告能力、数据复盘、风险意识
   - Wayfair：Listing、广告能力、库存履约、退货率、数据复盘
   - Coupang：Search Tag、站内广告、Rocket 履约、Review、数据复盘
   - 海外社媒推广专员：内容营销、短视频、达人协同、社媒广告、数据复盘、英语
   - 海外社媒主管：策略、内容规划、达人策略、广告与数据统筹、团队管理、英语
   - 亚马逊站外推广专员：站外推广、测评统筹、Deals/论坛、Reviewer 维护、账号安全、站外→站内转化复盘
   - TikTok运营助理：店铺维护、商品卡、素材支持、数据整理、库存物流、售后跟进、Excel、执行力、英语
   - TikTok商务BD：达人BD、达人挖掘、商务谈判、Affiliate、内容配合、建联率、合作率、带货转化、数据复盘、英语
   - TikTok商务BD主管：达人BD、MCN、商务谈判、Affiliate、团队管理、建联率、合作率、带货转化、数据复盘
6. matchedPositions 可以保留 1-3 个，但综合评分、薄弱点、风险、追问都以 primaryTargetPosition 为准。
7. 岗位匹配评分要看“职责相似度”而不是关键词堆砌：做过相近能力可给中等分，但岗位边界说不清要降分。
8. ${targetInstruction}
9. 目标岗位精准锚点：${matchHint || '按手册该岗位核心职责与指标评估，禁止跨岗位评价。'}`;

        return `你是跨境电商招聘面试顾问。请只根据“面试手册”和“候选人简历”分析，不要编造简历里没有的信息。
可选岗位仅限：${HANDBOOK_POSITIONS.join('、')}。

请只输出一个合法 JSON，不要输出 Markdown，不要用代码块包裹。

JSON 结构必须如下：
{
  "candidateName": "候选人姓名，无法识别则写未知",
  "primaryTargetPosition": "本次分析锚定岗位，必须来自面试手册岗位名",
  "matchedPositions": [
    {
      "position": "匹配岗位名称，必须来自面试手册里的岗位",
      "matchLevel": "高/中/低",
      "score": 73.25,
      "scoreBreakdown": {
        "positionFit": {
          "label": "岗位匹配",
          "weight": 0.30,
          "score": 78.50,
          "reason": "平台、站点、品类、职责与目标岗位的匹配说明"
        },
        "experience": {
          "label": "工作经验",
          "weight": 0.25,
          "score": 71.00,
          "reason": "年限、职级、项目连续性、相关平台经验说明"
        },
        "salaryFit": {
          "label": "薪资匹配",
          "weight": 0.15,
          "score": 65.25,
          "reason": "期望薪资、历史薪资区间与岗位档位的匹配说明；简历未写则给 55-68 并说明缺失"
        },
        "dataEvidence": {
          "label": "数据佐证",
          "weight": 0.20,
          "score": 80.00,
          "reason": "GMV、SKU、ROI、广告费、团队规模等可验证数据是否充分"
        },
        "ownership": {
          "label": "职责清晰度",
          "weight": 0.10,
          "score": 72.50,
          "reason": "是否说清本人负责范围，而非只说团队成果"
        }
      },
      "reasons": ["匹配理由，引用简历具体经历、平台、品类、数据或职责"]
    }
  ],
  "strengths": [
    { "item": "擅长点", "evidence": "简历证据" }
  ],
  "weaknesses": [
    { "item": "薄弱点或风险信号", "evidence": "为什么需要追问" }
  ],
  "interviewQuestions": [
    { "question": "HR 应该问的问题", "confirm": "想确认什么" }
  ],
  "recommendation": {
    "decision": "建议/谨慎建议/不建议",
    "reason": "2-4 句话说明是否进入业务复试"
  },
  "charts": {
    "positionScores": [
      { "name": "岗位名", "score": 73.25 }
    ],
    "abilityScores": [
      { "name": "平台经验", "score": 76.50 },
      { "name": "广告能力", "score": 68.25 },
      { "name": "数据复盘", "score": 71.80 },
      { "name": "库存意识", "score": 63.40 },
      { "name": "团队管理", "score": 58.00 },
      { "name": "风险意识", "score": 66.75 },
      { "name": "内容营销", "score": 0 },
      { "name": "独立站转化", "score": 0 }
    ],
    "riskSignals": [
      { "name": "风险名", "level": 42.50 }
    ]
  }
}

评分规则（必须严格执行）：
1. 所有 score、level 必须是 0-100 的数字，保留两位小数，禁止全部写成整数，禁止大多数候选人都给 85、80、90。
2. matchedPositions[].score 必须等于 scoreBreakdown 各维度按 weight 加权后的综合分，公式：score = Σ(维度score × weight)。
3. matchLevel 必须与综合分一致：高 >= 80.00；中 60.00-79.99；低 < 60.00。
4. 岗位匹配（30%）：看平台、站点、品类、岗位职责是否贴近手册岗位；完全不对口可低于 50。
5. 工作经验（25%）：看年限、职级、项目连续性、是否做过同类型业务；经验浅或跳岗频繁要扣分。
6. 薪资匹配（15%）：结合岗位常见薪资带判断；简历没写期望薪资时给 55-68，并说明“薪资信息缺失”；明显离谱要低于 55。
7. 数据佐证（20%）：有 GMV、SKU、ROI、广告预算、团队规模等具体数字可给 75+；只有空话没有数据应低于 65。
8. 职责清晰度（10%）：能说清本人负责事项可给 75+；只说“我们团队”说不清个人贡献应低于 60。
9. charts.positionScores 必须与 matchedPositions 的岗位和分数一致；charts.abilityScores 只保留与简历相关的 4-8 项，不相关维度可省略或给 0；各项分数要有差异，不能全部相同。
10. charts.riskSignals.level 表示风险强度，越高风险越大；没有明显风险也要给有区分度的值，不要全部 85。

其他要求：
- primaryTargetPosition 必须明确，且与本次分析焦点一致。
- matchedPositions 给 1-3 个，多个岗位的综合分必须有差异，但薄弱点和风险只围绕 primaryTargetPosition。
- strengths 给 3-6 个，且要与 primaryTargetPosition 直接相关。
- weaknesses 给 3-6 个，且只能写 primaryTargetPosition 相关风险，禁止跨平台写无关经验缺失。
- interviewQuestions 给 8-12 个，必须结合简历具体经历，且只问 primaryTargetPosition 相关问题。
- 如果简历缺少关键数据，请在 weaknesses 里指出该目标岗位下缺少的平台、站点、品类、SKU、销售额/GMV、广告预算、权限、案例等哪一类。
${scopeRules}

【面试手册】
${limitText(handbookText, 28000)}

【候选人简历】
${limitText(resumeText, 18000)}`;
      }

      async function callDeepSeek(apiKey, prompt, options = {}) {
        const body = {
          model: DEEPSEEK_MODEL,
          temperature: options.temperature ?? 0.2,
          messages: [
            {
              role: 'system',
              content: options.system || '你是严谨的 HR 初面助手，擅长根据跨境电商岗位要求分析候选人简历。回答要具体、可追问、不要编造。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        };
        if (options.json !== false) {
          body.response_format = { type: 'json_object' };
        }

        const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        let data = null;
        try {
          data = await response.json();
        } catch (error) {
          throw new Error('DeepSeek 返回内容无法解析，请稍后重试。');
        }

        if (!response.ok) {
          const message = data?.error?.message || `请求失败，状态码 ${response.status}`;
          throw new Error(message);
        }

        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('DeepSeek 没有返回分析内容，请稍后重试。');
        }
        return content.trim();
      }

      function renderAnalysisModal(analysis, record = null) {
        if (!analysisModal || !analysisModalBody) return;

        analysis = normalizeAnalysisScores(analysis || {});
        const scopedPosition = record?.targetPosition || analysis.primaryTargetPosition || '';
        if (scopedPosition) {
          analysis = scopeAnalysisToTargetPosition(analysis, scopedPosition);
        }
        currentAnalysisId = record?.id || currentAnalysisId;
        const recommendation = analysis.recommendation || {};
        const matchedPositions = asArray(analysis.matchedPositions);
        const strengths = asArray(analysis.strengths);
        const weaknesses = asArray(analysis.weaknesses);
        const questions = asArray(analysis.interviewQuestions);

        const topPosition = matchedPositions[0];
        const focusPosition = analysis.primaryTargetPosition || record?.targetPosition || topPosition?.position || '暂无明确岗位';
        updateCandidateName(analysis.candidateName);
        updateAnalysisMatchBadge(topPosition);
        const riskTags = weaknesses
          .slice(0, 5)
          .map(item => `<span class="analysis-risk-pill">${escapeHTML(item.item || '待追问风险')}</span>`)
          .join('');
        analysisModalBody.innerHTML = `
    <div class="analysis-preview" data-analysis-preview>
      <div class="analysis-preview-clip">
        <div class="analysis-summary-grid analysis-summary-grid-top">
          <div class="analysis-card analysis-highlight-card analysis-match-card">
            <h3>最匹配岗位</h3>
            <p><b>${escapeHTML(topPosition?.position || focusPosition)}</b></p>
            <p class="analysis-muted">分析锚定岗位：${escapeHTML(focusPosition)}</p>
            <p><span class="analysis-score-pill">匹配度：${escapeHTML(topPosition?.matchLevel || '待判断')}${topPosition?.score !== undefined && topPosition?.score !== null ? ` / ${formatScoreText(topPosition.score)} 分` : ''}</span></p>
            ${renderScoreBreakdown(topPosition?.scoreBreakdown)}
          </div>
          <div class="analysis-card analysis-highlight-card analysis-decision-card">
            <h3>复试建议</h3>
            <p><span class="analysis-decision-pill">${escapeHTML(recommendation.decision || '待判断')}</span></p>
            <p>${escapeHTML(recommendation.reason || 'AI 未返回明确建议。')}</p>
          </div>
          <div class="analysis-card analysis-highlight-card analysis-risk-card">
            <h3>薄弱点 / 风险</h3>
            <div>${riskTags || '<span class="analysis-risk-pill">暂无明确风险</span>'}</div>
            <p>以下风险仅围绕「${escapeHTML(focusPosition)}」相关项，建议结合该岗位继续确认数据、权限和案例真实性。</p>
          </div>
        </div>
      </div>
      <button type="button" class="analysis-preview-toggle" data-collapse-label="收起" data-expand-label="展开查看全部">展开查看全部</button>
    </div>

    <div class="analysis-section">
      <h3>匹配岗位</h3>
      ${renderList(matchedPositions, item => `<b>${escapeHTML(item.position || '未知岗位')}</b>（${escapeHTML(item.matchLevel || '待判断')}，${formatScoreText(item.score) || '0.00'} 分）${renderList(item.reasons, reason => escapeHTML(reason))}`)}
    </div>

    <div class="analysis-preview" data-analysis-preview>
      <div class="analysis-preview-clip">
        <div class="analysis-summary-grid">
          <div class="analysis-card">
            <h3>擅长点</h3>
            ${renderList(strengths, item => `<b>${escapeHTML(item.item || '')}</b><br>${escapeHTML(item.evidence || '')}`)}
          </div>
          <div class="analysis-card analysis-risk-card">
            <h3>薄弱点 / 风险</h3>
            ${renderList(weaknesses, item => `<b>${escapeHTML(item.item || '')}</b><br>${escapeHTML(item.evidence || '')}`)}
          </div>
          <div class="analysis-card analysis-decision-card">
            <h3>结论</h3>
            <p><span class="analysis-decision-pill">${escapeHTML(recommendation.decision || '待判断')}</span></p>
            <p>${escapeHTML(recommendation.reason || '暂无明确理由。')}</p>
          </div>
        </div>
      </div>
      <button type="button" class="analysis-preview-toggle" data-collapse-label="收起" data-expand-label="展开查看全部">展开查看全部</button>
    </div>

    <details class="analysis-collapse">
      <summary>HR 初面建议追问（${questions.length || 0} 个问题）</summary>
      <div class="analysis-collapse-body">
      ${
        questions.length
          ? questions
              .map(
                (item, index) => `
        <div class="analysis-question">
          <b>${index + 1}. ${escapeHTML(item.question || '')}</b>
          <div>想确认：${escapeHTML(item.confirm || '')}</div>
        </div>
      `,
              )
              .join('')
          : '<p>暂无建议问题。</p>'
      }
      </div>
    </details>
    <div class="interview-report-box">
      <h3>生成部门面试反馈</h3>
      <p>把你对这个人的面试总结写在下面，可再上传面试记录/评分表等附件（支持 PDF、Word、TXT、PNG、JPG）。AI 会结合简历分析、文字总结和附件，按「姓名-岗位-结果 / 基本情况 / 最近任职公司与薪资 / 优势 / 不足 / 岗位匹配情况」生成反馈。</p>
      <textarea id="interviewSummaryInput" placeholder="例如：许可欣，部门一面未通过；籍贯浙江，期望底薪8k；离职原因是想转正编；优势是细心执行力强，不足是平台经验偏少..."></textarea>
      <div class="interview-report-actions">
        <div class="interview-attach-field">
          <input id="interviewAttachFile" class="interview-attach-input" type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" />
          <div class="interview-attach-btn" id="interviewAttachBtn">
            <span>上传附件</span>
            <span id="interviewAttachName" class="interview-attach-name"></span>
          </div>
        </div>
        <button id="generateInterviewReportBtn" class="resume-action" type="button">生成面试反馈</button>
        <button id="copyInterviewReportBtn" class="interview-report-copy" type="button">一键复制</button>
        <span id="interviewReportStatus" class="resume-note"></span>
      </div>
      <div id="interviewReportOutput" class="interview-report-output"></div>
    </div>
  `;

        analysisModal.classList.add('active');
        bindAnalysisPreviewToggles(analysisModalBody);
        bindInterviewReportGenerator();
        restoreInterviewReportCache(record);
      }

      function bindAnalysisPreviewToggles(root) {
        if (!root) return;
        root.querySelectorAll('[data-analysis-preview]').forEach(preview => {
          const toggle = preview.querySelector('.analysis-preview-toggle');
          if (!toggle || toggle.dataset.bound === '1') return;
          toggle.dataset.bound = '1';
          toggle.addEventListener('click', () => {
            const expanded = preview.classList.toggle('is-expanded');
            toggle.textContent = expanded ? toggle.dataset.collapseLabel || '收起' : toggle.dataset.expandLabel || '展开查看全部';
          });
        });
      }

      function renderAnalysisCharts(charts) {
        if (!window.echarts) return;

        const positionScores = asArray(charts.positionScores).slice(0, 5);
        const abilityScores = asArray(charts.abilityScores).slice(0, 8);
        const riskSignals = asArray(charts.riskSignals).slice(0, 6);

        const positionEl = document.getElementById('positionScoreChart');
        if (positionEl && positionScores.length) {
          const chart = window.echarts.init(positionEl);
          chart.setOption({
            grid: { left: 48, right: 18, top: 20, bottom: 48 },
            xAxis: { type: 'category', data: positionScores.map(item => item.name), axisLabel: { interval: 0, rotate: 25 } },
            yAxis: { type: 'value', min: 0, max: 100 },
            series: [{ type: 'bar', data: positionScores.map(item => formatAnalysisScore(item.score) || 0), itemStyle: { borderRadius: [8, 8, 0, 0] } }],
            tooltip: {
              trigger: 'axis',
              valueFormatter: value => `${formatScoreText(value) || '0.00'} 分`,
            },
          });
        }

        const abilityEl = document.getElementById('abilityScoreChart');
        if (abilityEl && abilityScores.length) {
          const chart = window.echarts.init(abilityEl);
          chart.setOption({
            radar: {
              indicator: abilityScores.map(item => ({ name: item.name, max: 100 })),
              radius: '62%',
            },
            series: [{ type: 'radar', areaStyle: {}, data: [{ value: abilityScores.map(item => formatAnalysisScore(item.score) || 0), name: '能力分' }] }],
            tooltip: {
              valueFormatter: value => `${formatScoreText(value) || '0.00'} 分`,
            },
          });
        }

        const riskEl = document.getElementById('riskSignalChart');
        if (riskEl && riskSignals.length) {
          const chart = window.echarts.init(riskEl);
          chart.setOption({
            tooltip: { trigger: 'item' },
            series: [
              {
                type: 'pie',
                radius: ['42%', '70%'],
                data: riskSignals.map(item => ({ name: item.name, value: formatAnalysisScore(item.level) || 0 })),
                label: { formatter: '{b}\n{d}%' },
                tooltip: {
                  valueFormatter: value => `${formatScoreText(value) || '0.00'}`,
                },
              },
            ],
          });
        }
      }

      function buildInterviewFactAnchor(analysis = {}, record = {}) {
        const candidateName = analysis.candidateName && analysis.candidateName !== '未知' ? analysis.candidateName : '未知/需从简历确认';
        const targetPosition = record.targetPosition || analysis.primaryTargetPosition || asArray(analysis.matchedPositions)[0]?.position || '未知岗位';
        const topMatch = asArray(analysis.matchedPositions)[0] || {};
        const strengths = asArray(analysis.strengths)
          .slice(0, 6)
          .map(item => `- ${item.item || item}${item.evidence ? `｜证据：${item.evidence}` : ''}`)
          .join('\n');
        const weaknesses = asArray(analysis.weaknesses)
          .slice(0, 6)
          .map(item => `- ${item.item || item}${item.evidence ? `｜证据：${item.evidence}` : ''}`)
          .join('\n');
        const reasons = asArray(topMatch.reasons)
          .slice(0, 5)
          .map(item => `- ${item}`)
          .join('\n');
        const recommendation = analysis.recommendation ? `建议：${analysis.recommendation.decision || analysis.recommendation.result || ''}；原因：${analysis.recommendation.reason || ''}` : '无';

        return `候选人姓名：${candidateName}
应聘/锚定岗位：${targetPosition}
匹配度：${topMatch.matchLevel || '未知'}｜综合分：${formatScoreText(topMatch.score) || '无'}
匹配理由：
${reasons || '- 无'}
AI已识别优势：
${strengths || '- 无'}
AI已识别不足：
${weaknesses || '- 无'}
AI初步建议：
${recommendation}
手工补充字段：
部门：${record.manualFields?.department || '无'}
意向程度：${record.manualFields?.intent || '无'}
可入职时间：${record.manualFields?.availableDate || '无'}
面试类型：${record.manualFields?.interviewType || '无'}`;
      }

      function buildInterviewReportPrompt(analysis, resumeText, interviewSummary, attachmentText = '', attachmentName = '', record = {}) {
        const factAnchor = buildInterviewFactAnchor(analysis, record);
        return `你是资深跨境电商 HR，负责把面试结果写成高精准度面试反馈。必须严格依据材料，禁止编造。

【精准度铁律】
1. 只输出反馈正文，不要解释、不要 Markdown、不要加粗、不要“一、二、三”编号。
2. 事实来源优先级（冲突时按此取舍）：
   A. 面试官文字总结（结论、通过/未通过、离职原因口径、薪资、意向、待确认点）
   B. 面试附件（面试记录/评分表里的事实与评价）
   C. 候选人简历原文（出生年、籍贯、学校、专业、公司、岗位、年限、站点、品类、业绩数字）
   D. AI 简历分析事实锚点（仅作辅助，不可覆盖 A/B/C）
3. 绝对禁止编造：出生年份、籍贯、学校、专业、毕业时间、公司名、岗位、任职年限、站点、模式、品类、GMV、销量、ACOS、ROI、薪资架构、期望底薪、离职原因、感情状况。材料没有就写“需进一步确认”或自然省略，不要补全。
4. 数字必须能在简历、面试总结或附件中找到原文依据；找不到就不要写这个数字。
5. 若附件是 OCR 图片识别结果，可能有错字/乱码；只采用语义通顺、能与简历交叉验证的信息，忽略明显乱码。
6. 通过/未通过必须以面试官总结或附件结论为准，不得自行改判。面试官说不合适/pass/一般不推进，就必须写未通过；有“待确认薪资”等补充说明时，标题里保留。
7. 面试轮次：明确 HR 面写“HR一面”；明确部门二面写“部门二面”；其余默认“部门一面”。
8. 标题格式必须是：姓名-岗位名称-面试轮次结果。岗位优先用应聘/锚定岗位；可按面试习惯简写（如 TikTok运营助理→tk运营助理、Coupang运营专员→coupang运营专员），但含义要准确。
9. 姓名优先用事实锚点/简历；无法确认写“候选人”。
10. 基本情况写成一行，用顿号/逗号串联：出生年份、籍贯（如有）、大学名称、毕业年份+专业、相关工作经验年限；有恋爱/结婚等且面试总结明确提及时可写入，无则不要编。
11. 最近任职公司写成一行，依次覆盖：公司名称、任职岗位、任职年限、关键业务事实（品类/销量等有则写）、离职原因或在职状态；薪资架构；期望底薪。没有的字段写“需进一步确认”。
12. 优势、不足写成连贯段落（不要列表符号），每段 2-4 句，具体到平台、职责或数据，禁止空话。
13. 岗位匹配情况写成一段：先写面试结论，再写匹配点与风险（能力/经验/薪资等），口径必须与标题结论一致。
14. 语言正式、短句、像 HR 手写存档，不要 AI 套话（赋能/闭环/抓手/沉淀/卓越/较大发展潜力等）。

【必须输出结构】
姓名-岗位名称-面试轮次结果
基本情况：……
最近任职公司：……；薪资架构：……，期望底薪……
优势
……
不足
……
岗位匹配情况：……

参考格式：
任佳妮-coupang运营专员-部门二面通过（待确认薪资）
基本情况：1998年，有男朋友，韩国世宗大学，22年酒店管理本科毕业，1.5年coupang运营经验
最近任职公司：杭州易博达科技有限公司，coupang运营专员岗位，任职1.5年，目前在职，大件家具类，月销最高9000w韩币；离职原因：coupang平台不盈利转国内抖音，期望深耕coupang平台；薪资架构：10k底薪+绩效，期望底薪12k
优势：具备Coupang精品店0-1全链路运营经验，可独立完成从产品上架到售后的运营工作。广告投放与优化能力突出，广告花费占比由30%优化至20%以内，曝光提升1000%。有韩国5年留学背景，韩语流利，熟悉韩国消费习惯，可自主对接本土达人并降低合作成本。
不足：过往运营产品毛利率偏低，扣除广告后毛利率在10%以内，单产品盈利优化能力需进一步验证。底薪要求过高，与公司现有薪资水平存在差距。Coupang运营经验约1.5年，业务体量数据有限，运营规模需进一步确认。
岗位匹配情况：候选人部门二面通过。具备Coupang平台实操经验，熟悉韩国市场，有站内广告投放、Listing优化、库存物流及站外达人营销等全链路运营能力，岗位匹配度较高。但过往产品毛利率偏低，单产品盈利优化能力有待验证，且底薪要求过高，薪资匹配存在风险，需结合在职人员薪资情况进一步沟通。

【事实锚点（辅助，勿编造）】
${limitText(factAnchor, 4000)}

【AI 简历分析结果 JSON（辅助）】
${limitText(JSON.stringify(analysis, null, 2), 10000)}

【候选人简历文本（事实主来源之一）】
${limitText(resumeText || '无缓存简历文本。', 16000)}

【面试官输入的面试总结（结论主来源）】
${limitText(interviewSummary, 6000)}

【面试附件内容${attachmentName ? `（文件名：${attachmentName}）` : ''}】
${limitText(attachmentText || '未上传附件。', 16000)}`;
      }

      async function handleGenerateInterviewReport() {
        const summaryInput = document.getElementById('interviewSummaryInput');
        const attachInput = document.getElementById('interviewAttachFile');
        const reportBtn = document.getElementById('generateInterviewReportBtn');
        const copyBtn = document.getElementById('copyInterviewReportBtn');
        const reportStatus = document.getElementById('interviewReportStatus');
        const reportOutput = document.getElementById('interviewReportOutput');
        if (!summaryInput || !reportBtn || !reportStatus || !reportOutput) return;

        const interviewSummary = summaryInput.value.trim();
        const apiKey = getDeepSeekKeyFromUrl();
        const cached = loadAnalysisCache();
        const attachFile = attachInput?.files?.[0] || null;

        reportOutput.classList.remove('active');
        reportOutput.textContent = '';
        if (copyBtn) copyBtn.classList.remove('active');

        if (!interviewSummary) {
          reportStatus.textContent = '请先输入你对这个人的面试总结。';
          return;
        }
        if (!apiKey) {
          reportStatus.textContent = '网址里没有检测到 DeepSeek Key，无法生成反馈。';
          return;
        }
        if (!cached?.analysis) {
          reportStatus.textContent = '没有找到简历分析结果，请先完成一次 AI 简历分析。';
          return;
        }

        reportBtn.disabled = true;
        reportBtn.textContent = '生成中...';
        reportStatus.textContent = attachFile ? `正在读取附件「${attachFile.name}」，并结合简历和面试总结生成反馈...` : '正在高精准结合简历和面试总结生成反馈...';

        try {
          let attachmentText = '';
          if (attachFile) {
            attachmentText = await extractAttachmentText(attachFile, message => {
              reportStatus.textContent = message;
            });
            if (!attachmentText) {
              throw new Error('附件内容为空，请换一份可提取文字的 PDF / Word / TXT / 清晰图片。');
            }
            reportStatus.textContent = '附件已读取，正在高精准生成面试反馈...';
          }

          const prompt = buildInterviewReportPrompt(cached.analysis, cached.resumeText || '', interviewSummary, attachmentText, attachFile?.name || '', cached);
          const report = await callDeepSeek(apiKey, prompt, {
            json: false,
            temperature: 0.05,
            system: '你是公司内部资深 HR。任务是输出高精准面试反馈：标题为「姓名-岗位-面试轮次结果」；正文仅含基本情况、最近任职公司（含薪资）、优势、不足、岗位匹配情况。只写有材料依据的事实和判断；禁止编造学校、公司、薪资、业绩数字、离职原因；通过/未通过严格服从面试官结论；岗位匹配情况必须与标题结论一致；严格按指定结构输出，不要 Markdown，不要 AI 套话。',
          });
          reportOutput.textContent = report;
          reportOutput.classList.add('active');
          if (copyBtn) copyBtn.classList.add('active');
          saveInterviewReportCache(interviewSummary, report);
          reportStatus.textContent = attachFile ? `反馈已生成（已参考附件：${attachFile.name}）。` : '反馈已生成。';
        } catch (error) {
          reportStatus.textContent = formatResumeError(error);
        } finally {
          reportBtn.disabled = false;
          reportBtn.textContent = '生成面试反馈';
        }
      }

      function bindInterviewReportGenerator() {
        const reportBtn = document.getElementById('generateInterviewReportBtn');
        const copyBtn = document.getElementById('copyInterviewReportBtn');
        const attachInput = document.getElementById('interviewAttachFile');
        const attachBtn = document.getElementById('interviewAttachBtn');
        const attachName = document.getElementById('interviewAttachName');

        if (reportBtn) reportBtn.addEventListener('click', handleGenerateInterviewReport);
        if (copyBtn) copyBtn.addEventListener('click', copyInterviewReport);
        if (attachInput) {
          attachInput.addEventListener('change', () => {
            const file = attachInput.files?.[0];
            if (attachName) attachName.textContent = file ? file.name : '';
            if (attachBtn) attachBtn.classList.toggle('has-file', Boolean(file));
            const reportStatus = document.getElementById('interviewReportStatus');
            if (reportStatus) {
              reportStatus.textContent = file ? `已选择附件：${file.name}` : '已清除附件。';
            }
          });
        }
      }

      function restoreInterviewReportCache(record = null) {
        const summaryInput = document.getElementById('interviewSummaryInput');
        const copyBtn = document.getElementById('copyInterviewReportBtn');
        const reportStatus = document.getElementById('interviewReportStatus');
        const reportOutput = document.getElementById('interviewReportOutput');
        const cached = record?.interviewReport ? { summary: record.interviewSummary || '', report: record.interviewReport } : loadInterviewReportCache();
        if (cached?.analysisId && currentAnalysisId && cached.analysisId !== currentAnalysisId) return;
        if (!cached?.report || !reportOutput) return;

        if (summaryInput && cached.summary) summaryInput.value = cached.summary;
        reportOutput.textContent = cached.report;
        reportOutput.classList.add('active');
        if (copyBtn) copyBtn.classList.add('active');
        if (reportStatus) reportStatus.textContent = '已恢复上次生成的面试反馈。';
      }

      async function copyInterviewReport() {
        const copyBtn = document.getElementById('copyInterviewReportBtn');
        const reportStatus = document.getElementById('interviewReportStatus');
        const reportOutput = document.getElementById('interviewReportOutput');
        const text = reportOutput?.textContent?.trim();
        if (!text) {
          if (reportStatus) reportStatus.textContent = '还没有可复制的面试反馈。';
          return;
        }

        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          }
          if (copyBtn) copyBtn.textContent = '已复制';
          if (reportStatus) reportStatus.textContent = '面试反馈已复制到剪贴板。';
          setTimeout(() => {
            if (copyBtn) copyBtn.textContent = '一键复制';
          }, 1600);
        } catch (error) {
          if (reportStatus) reportStatus.textContent = '复制失败，请手动选中文本复制。';
        }
      }

      function formatResumeError(error) {
        const message = error?.message || String(error);
        if (message === 'Failed to fetch' || message.includes('NetworkError')) {
          return '请求 DeepSeek 失败。可能是网络问题，或者 DeepSeek API 不允许浏览器直接跨域调用；如果一直失败，需要改成后端代理版。';
        }
        if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
          return 'DeepSeek API Key 无效或没有权限，请检查后重新输入。';
        }
        if (message.includes('429')) {
          return 'DeepSeek 请求过于频繁或额度不足，请稍后再试。';
        }
        return message;
      }

      async function handleResumeAnalysis() {
        if (!resumeFileInput || !analyzeResumeBtn) return;

        const file = resumeFileInput.files?.[0];
        const apiKey = getDeepSeekKeyFromUrl();
        clearResumeStatus();
        clearInterviewReportCache();
        if (analysisModal) analysisModal.classList.remove('active');

        if (!file) {
          setResumeStatus('请先上传候选人的 PDF 或 DOCX 简历。', 'error');
          return;
        }
        if (!apiKey) {
          setResumeStatus('网址里没有检测到 DeepSeek API Key。请用 ?key=你的DeepSeekKey 打开页面后再分析。', 'error');
          return;
        }
        if (file.size > 12 * 1024 * 1024) {
          setResumeStatus('简历文件超过 12MB，建议压缩或导出为更小的 PDF/DOCX 后再上传。', 'error');
          return;
        }

        analyzeResumeBtn.disabled = true;
        const analyzeLabel = analyzeResumeBtn.querySelector('.button__text');
        if (analyzeLabel) analyzeLabel.textContent = '分析中...';
        else analyzeResumeBtn.textContent = '分析中...';
        startAnalysisLoading('正在读取简历内容...');

        try {
          setResumeStatus('正在读取简历内容...', 'info');
          setAnalysisProgress(18, '正在解析 PDF / Word 简历...');
          const resumeText = await extractResumeText(file);
          if (resumeText.length < 50) {
            throw new Error('没有从简历中读取到足够文字。如果是扫描版 PDF，请先用 OCR 转成可复制文字的 PDF。');
          }

          setResumeStatus('正在结合面试手册调用 DeepSeek 分析...', 'info');
          setAnalysisProgress(45, '正在整理页面面试手册内容...');
          const selectedTargetPosition = targetPositionInput?.value.trim() || '';
          const inferredTargetPosition = selectedTargetPosition ? '' : inferTargetPositionFromResume(resumeText);
          const effectiveTargetPosition = selectedTargetPosition || inferredTargetPosition;
          const handbookText = getHandbookTextForAnalysis(effectiveTargetPosition);
          const prompt = buildResumeAnalysisPrompt(resumeText, handbookText, {
            targetPosition: selectedTargetPosition,
            inferredTargetPosition,
          });
          setAnalysisProgress(62, '正在调用 DeepSeek 分析匹配岗位...');
          const result = await callDeepSeek(apiKey, prompt, {
            system: '你是严谨的跨境电商 HR 初面分析助手。必须围绕 primaryTargetPosition 单岗位精准分析：海外社媒推广专员≠海外社媒主管≠亚马逊站外推广专员(测评/Deals/论坛)≠TikTok运营助理≠TikTok运营专员≠TikTok商务BD≠TikTok商务BD主管≠亚马逊站内运营。禁止把其他岗位经验缺失写成薄弱点或风险。评分必须基于简历证据差异化，所有分数字段保留两位小数。',
            temperature: 0.35,
          });
          setAnalysisProgress(90, '正在生成弹窗和图表...');
          let analysis = normalizeAnalysisScores(parseAnalysisJson(result));
          analysis = scopeAnalysisToTargetPosition(analysis, resolveTargetPosition(selectedTargetPosition, resumeText, analysis));
          const record = saveAnalysisCache(analysis, resumeText, file.name, {}, analysis.primaryTargetPosition || effectiveTargetPosition);
          renderAnalysisModal(analysis, record);
          finishAnalysisLoading();
          setResumeStatus('分析完成。建议 HR 面试前再结合候选人口头回答确认关键数据。', 'success');
        } catch (error) {
          stopAnalysisLoading();
          setResumeStatus(formatResumeError(error), 'error');
        } finally {
          analyzeResumeBtn.disabled = false;
          const analyzeLabel = analyzeResumeBtn.querySelector('.button__text');
          if (analyzeLabel) analyzeLabel.textContent = '开始分析';
          else analyzeResumeBtn.textContent = '开始分析';
        }
      }

      if (analyzeResumeBtn) {
        analyzeResumeBtn.addEventListener('click', handleResumeAnalysis);
      }

      if (resumeFileInput) {
        resumeFileInput.addEventListener('change', () => {
          clearInterviewReportCache();
          clearResumeStatus();
          const file = resumeFileInput.files?.[0];
          if (resumeFileName) {
            resumeFileName.textContent = file ? file.name : '';
          }
          if (resumeFileUploadLabel) {
            resumeFileUploadLabel.classList.toggle('has-file', Boolean(file));
          }
        });
      }

      if (resumeHistoryList) {
        resumeHistoryList.addEventListener('click', event => {
          const openButton = event.target.closest('.resume-history-open');
          if (openButton) {
            const record = loadAnalysisHistory().find(item => item.id === openButton.dataset.historyId);
            if (record) openAnalysisRecord(record);
            return;
          }

          const editButton = event.target.closest('.resume-history-edit');
          if (editButton) {
            toggleHistoryEditPanel(editButton.dataset.historyId);
            return;
          }

          const saveButton = event.target.closest('.resume-history-save');
          if (saveButton) {
            saveHistoryManualFields(saveButton.dataset.historyId);
          }
        });
      }

      if (clearAllCacheBtn) {
        clearAllCacheBtn.addEventListener('click', () => {
          clearAllLocalCache();
          playClearCacheConfetti();
        });
      }

      if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', exportHistoryToExcel);
      }

      if (analysisModalClose) {
        analysisModalClose.addEventListener('click', () => analysisModal?.classList.remove('active'));
      }

      if (analysisModal) {
        analysisModal.addEventListener('click', event => {
          if (event.target === analysisModal) analysisModal.classList.remove('active');
        });
      }

      renderResumeHistory();

      const themeToggle = document.getElementById('themeToggle');
      const THEME_KEY = 'love_xinxin_theme';
      function applyTheme(theme) {
        const dark = theme === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        if (themeToggle) {
          themeToggle.setAttribute('aria-label', dark ? '切换日间模式' : '切换暗黑模式');
          themeToggle.title = dark ? '切换日间模式' : '切换暗黑模式';
        }
      }
      function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      }
      applyTheme(currentTheme());
      if (themeToggle) {
        themeToggle.addEventListener('click', () => {
          const next = currentTheme() === 'dark' ? 'light' : 'dark';
          applyTheme(next);
          try {
            localStorage.setItem(THEME_KEY, next);
          } catch (e) {}
        });
      }

      const heroMore = document.querySelector('.hero-more');
      const heroMoreToggle = document.querySelector('.hero-more-toggle');
      if (heroMore && heroMoreToggle) {
        let heroMoreWasOpen = false;
        const syncHeroToggleLabel = () => {
          heroMoreToggle.textContent = heroMore.open ? '收起简介' : '展开简介';
        };
        syncHeroToggleLabel();
        heroMore.addEventListener('toggle', syncHeroToggleLabel);
        window.addEventListener('beforeprint', () => {
          heroMoreWasOpen = heroMore.open;
          heroMore.open = true;
        });
        window.addEventListener('afterprint', () => {
          heroMore.open = heroMoreWasOpen;
          syncHeroToggleLabel();
        });
      }

      const heroClock = document.getElementById('heroClock');
      const heroNow = document.getElementById('heroNow');
      const heroOffCountdown = document.getElementById('heroOffCountdown');
      const OFF_WORK_HOUR = 18;
      const OFF_WORK_MINUTE = 0;
      function pad2(n) {
        return String(n).padStart(2, '0');
      }
      const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      function formatHeroNow(date) {
        return `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 ${WEEKDAYS[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
      }
      function getTodayOffWork(date) {
        const off = new Date(date);
        off.setHours(OFF_WORK_HOUR, OFF_WORK_MINUTE, 0, 0);
        return off;
      }
      function formatCountdown(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        if (hours > 0) return `${hours}小时${pad2(minutes)}分${pad2(seconds)}秒`;
        if (minutes > 0) return `${minutes}分${pad2(seconds)}秒`;
        return `${seconds}秒`;
      }
      function updateHeroClock() {
        if (!heroNow || !heroOffCountdown) return;
        const now = new Date();
        heroNow.textContent = formatHeroNow(now);
        const off = getTodayOffWork(now);
        const diff = off.getTime() - now.getTime();
        if (diff <= 0) {
          heroOffCountdown.textContent = '已下班，好好休息～';
          heroOffCountdown.classList.add('is-done');
        } else {
          heroOffCountdown.textContent = `距离下班还有 ${formatCountdown(diff)}`;
          heroOffCountdown.classList.remove('is-done');
        }
      }
      if (heroClock) {
        heroClock.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
        });
      }
      updateHeroClock();
      window.setInterval(updateHeroClock, 1000);

      function buildCollapsibleNav() {
        const nav = document.querySelector('.sidebar .nav');
        if (!nav || nav.dataset.grouped === '1') return;
        const items = Array.from(nav.querySelectorAll(':scope > a'));
        if (!items.length) return;
        const fragment = document.createDocumentFragment();
        let i = 0;
        while (i < items.length) {
          const link = items[i];
          if (!link.classList.contains('h2')) {
            fragment.appendChild(link);
            i += 1;
            continue;
          }
          const subs = [];
          let j = i + 1;
          while (j < items.length && items[j].classList.contains('h3')) {
            subs.push(items[j]);
            j += 1;
          }
          if (!subs.length) {
            fragment.appendChild(link);
            i = j;
            continue;
          }
          const group = document.createElement('div');
          group.className = 'nav-group';
          const head = document.createElement('div');
          head.className = 'nav-group-head';
          link.classList.add('nav-group-title');
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'nav-group-toggle';
          toggle.setAttribute('aria-label', '展开子导航');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const open = !group.classList.contains('is-open');
            group.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? '收起子导航' : '展开子导航');
          });
          head.appendChild(link);
          head.appendChild(toggle);
          const body = document.createElement('div');
          body.className = 'nav-group-body';
          subs.forEach(sub => body.appendChild(sub));
          group.appendChild(head);
          group.appendChild(body);
          fragment.appendChild(group);
          i = j;
        }
        nav.innerHTML = '';
        nav.appendChild(fragment);
        nav.dataset.grouped = '1';
      }

      buildCollapsibleNav();

      const links = Array.from(document.querySelectorAll('.nav a'));
      const sections = links.map(a => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))).filter(Boolean);
      let activeNavLink = null;
      let navScrollLockUntil = 0;

      function ensureNavLinkVisible(link) {
        const sidebar = link?.closest('.sidebar');
        if (!sidebar || !link) return;
        const sideRect = sidebar.getBoundingClientRect();
        const linkRect = link.getBoundingClientRect();
        const pad = 18;
        if (linkRect.top >= sideRect.top + pad && linkRect.bottom <= sideRect.bottom - pad) return;
        const delta =
          linkRect.top < sideRect.top + pad
            ? linkRect.top - sideRect.top - pad
            : linkRect.bottom - sideRect.bottom + pad;
        sidebar.scrollTo({ top: sidebar.scrollTop + delta, behavior: 'smooth' });
      }

      function setNavGroupOpen(group, open) {
        if (!group) return;
        group.classList.toggle('is-open', open);
        const toggle = group.querySelector('.nav-group-toggle');
        if (toggle) {
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          toggle.setAttribute('aria-label', open ? '收起子导航' : '展开子导航');
        }
      }
      function openNavGroup(group) {
        setNavGroupOpen(group, true);
      }
      function closeNavGroup(group) {
        setNavGroupOpen(group, false);
      }

      function setActiveNavLink(link, options = {}) {
        if (!link || link === activeNavLink) return;
        const { scrollSidebar = true } = options;
        links.forEach(a => a.classList.remove('is-active'));
        link.classList.add('is-active');
        activeNavLink = link;
        openNavGroup(link.closest('.nav-group'));
        if (scrollSidebar) ensureNavLinkVisible(link);
      }

      links.forEach(link => {
        link.addEventListener('click', () => {
          navScrollLockUntil = Date.now() + 900;
          setActiveNavLink(link, { scrollSidebar: false });
        });
      });

      const obs = new IntersectionObserver(
        entries => {
          if (Date.now() < navScrollLockUntil) return;
          const visible = entries
            .filter(entry => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (!visible.length) return;
          const active = links.find(a => a.getAttribute('href') === '#' + visible[0].target.id);
          setActiveNavLink(active);
        },
        { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
      );
      sections.forEach(s => obs.observe(s));

      const globalSearch = document.getElementById('globalSearch');
      const globalSearchHint = document.getElementById('globalSearchHint');
      const globalSearchHintTrack = document.getElementById('globalSearchHintTrack');
      const resultPanel = document.getElementById('searchResults');
      const resultPanels = [resultPanel].filter(Boolean);
      const searchableBlocks = Array.from(document.querySelectorAll('.section h2, .section h3, .section p, .section li, .section td, .section th'));
      let lastMatches = [];

      function initGlobalSearchHint() {
        if (!globalSearch || !globalSearchHint || !globalSearchHintTrack) return;
        const items = Array.from(globalSearchHintTrack.querySelectorAll('.search-hint-item'));
        if (!items.length) return;

        let index = 0;
        let timer = null;
        const itemHeight = () => items[0].offsetHeight || 21;

        const syncHintVisibility = () => {
          const hide = Boolean(globalSearch.value.trim()) || document.activeElement === globalSearch;
          globalSearchHint.classList.toggle('is-hidden', hide);
          if (hide) {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          } else if (!timer) {
            timer = setInterval(tick, 3000);
          }
        };

        const renderIndex = (nextIndex, withBounce = true) => {
          index = ((nextIndex % items.length) + items.length) % items.length;
          globalSearchHintTrack.style.transform = `translateY(-${index * itemHeight()}px)`;
          items.forEach((item, i) => item.classList.toggle('is-active', i === index));
          if (withBounce) {
            globalSearchHintTrack.classList.remove('is-bounce');
            void globalSearchHintTrack.offsetWidth;
            globalSearchHintTrack.classList.add('is-bounce');
          }
        };

        const tick = () => {
          if (globalSearchHint.classList.contains('is-hidden')) return;
          renderIndex(index + 1, true);
        };

        renderIndex(0, false);
        syncHintVisibility();

        globalSearch.addEventListener('input', syncHintVisibility);
        globalSearch.addEventListener('focus', syncHintVisibility);
        globalSearch.addEventListener('blur', syncHintVisibility);
        window.addEventListener('resize', () => renderIndex(index, false));
      }

      initGlobalSearchHint();

      function escapeHTML(text) {
        return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
      }
      function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      function nearestTitle(el) {
        const section = el.closest('.section');
        if (!section) return '正文';
        const h2 = section.querySelector('h2');
        return h2 ? h2.textContent.trim() : '正文';
      }
      function ensureAnchor(el, index) {
        if (!el.id) el.id = `search-hit-${index}`;
        return el.id;
      }
      function clearActiveTarget() {
        document.querySelectorAll('.active-search-target').forEach(el => el.classList.remove('active-search-target'));
      }
      function hideAllResultPanels() {
        resultPanels.forEach(panel => {
          panel.innerHTML = '';
          panel.style.display = 'none';
        });
      }
      function jumpToResult(index) {
        const item = lastMatches[index];
        if (!item) return;
        clearActiveTarget();
        item.el.classList.add('active-search-target');
        item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hideAllResultPanels();
      }
      function renderResults(q) {
        if (!resultPanel) return;
        if (!q) {
          hideAllResultPanels();
          clearActiveTarget();
          return;
        }
        const lower = q.toLowerCase();
        lastMatches = searchableBlocks.map(el => ({ el, text: el.textContent.replace(/\s+/g, ' ').trim() })).filter(item => item.text.toLowerCase().includes(lower));

        let html = '';
        if (!lastMatches.length) {
          html = '<div class="search-empty">没有找到相关内容，换个关键词试试。</div>';
        } else {
          html = lastMatches
            .slice(0, 20)
            .map((m, idx) => {
              ensureAnchor(m.el, idx);
              const pos = m.text.toLowerCase().indexOf(lower);
              const start = Math.max(0, pos - 32);
              const end = Math.min(m.text.length, pos + q.length + 52);
              const rawSnippet = `${start > 0 ? '...' : ''}${m.text.slice(start, end)}${end < m.text.length ? '...' : ''}`;
              const snippet = escapeHTML(rawSnippet).replace(new RegExp(escapeRegExp(escapeHTML(q)), 'gi'), '<mark class="search-hit">$&</mark>');
              return `<button type="button" class="search-result" data-index="${idx}"><div class="search-result-title">${escapeHTML(nearestTitle(m.el))}</div><div class="search-result-snippet">${snippet}</div></button>`;
            })
            .join('');
          if (lastMatches.length > 20) {
            html += `<div class="search-empty">还有 ${lastMatches.length - 20} 条结果，建议输入更具体的关键词。</div>`;
          }
        }
        resultPanel.innerHTML = html;
        resultPanel.style.display = 'block';
      }
      if (globalSearch) {
        globalSearch.addEventListener('input', e => renderResults(e.target.value.trim()));
        globalSearch.addEventListener('focus', e => {
          if (e.target.value.trim()) renderResults(e.target.value.trim());
        });
        globalSearch.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            jumpToResult(0);
          }
          if (e.key === 'Escape') {
            hideAllResultPanels();
            clearActiveTarget();
          }
        });
      }
      resultPanels.forEach(panel => {
        panel.addEventListener('click', e => {
          const item = e.target.closest('.search-result');
          if (!item) return;
          jumpToResult(Number(item.dataset.index));
        });
      });
      document.addEventListener('click', e => {
        if (!e.target.closest('.search-box')) {
          hideAllResultPanels();
        }
      });

      const sideSearch = document.getElementById('sideSearch');
      const sideNavEmpty = document.getElementById('sideNavEmpty');
      const navLinks = Array.from(document.querySelectorAll('.sidebar .nav a'));
      const navGroups = Array.from(document.querySelectorAll('.sidebar .nav .nav-group'));
      const navFoldToggleBtn = document.getElementById('navFoldToggle');
      function areAllNavGroupsOpen() {
        return navGroups.length > 0 && navGroups.every(group => group.classList.contains('is-open'));
      }
      function syncNavFoldToggleLabel() {
        if (!navFoldToggleBtn) return;
        const allOpen = areAllNavGroupsOpen();
        navFoldToggleBtn.textContent = allOpen ? '收起分类' : '展开分类';
        navFoldToggleBtn.setAttribute('aria-expanded', allOpen ? 'true' : 'false');
      }
      function expandAllNavGroups() {
        navGroups.forEach(group => openNavGroup(group));
        syncNavFoldToggleLabel();
      }
      function collapseAllNavGroups() {
        navGroups.forEach(group => closeNavGroup(group));
        syncNavFoldToggleLabel();
      }
      if (navFoldToggleBtn) {
        navFoldToggleBtn.addEventListener('click', () => {
          if (areAllNavGroupsOpen()) collapseAllNavGroups();
          else expandAllNavGroups();
        });
      }
      // 单个分组展开/收起时同步按钮文案
      navGroups.forEach(group => {
        const toggle = group.querySelector('.nav-group-toggle');
        if (!toggle) return;
        toggle.addEventListener('click', () => {
          window.setTimeout(syncNavFoldToggleLabel, 0);
        });
      });
      syncNavFoldToggleLabel();

      function filterSideNav(q) {
        const lower = q.trim().toLowerCase();
        let visible = 0;
        navLinks.forEach(link => {
          const match = !lower || link.textContent.toLowerCase().includes(lower);
          link.classList.toggle('is-nav-hidden', !match);
          if (match) visible += 1;
        });
        navGroups.forEach(group => {
          const title = group.querySelector('.nav-group-title');
          const childLinks = Array.from(group.querySelectorAll('.nav-group-body a'));
          const titleMatch = !lower || (title && title.textContent.toLowerCase().includes(lower));
          const childMatch = childLinks.some(link => !link.classList.contains('is-nav-hidden'));
          const groupVisible = !lower || titleMatch || childMatch;
          group.classList.toggle('is-nav-hidden', !groupVisible);
          if (!lower) {
            closeNavGroup(group);
          } else if (groupVisible) {
            openNavGroup(group);
            if (titleMatch && title) title.classList.remove('is-nav-hidden');
            if (titleMatch) {
              childLinks.forEach(link => link.classList.remove('is-nav-hidden'));
            }
          }
        });
        syncNavFoldToggleLabel();
        if (sideNavEmpty) sideNavEmpty.hidden = !lower || visible > 0;
      }
      if (sideSearch) {
        sideSearch.addEventListener('input', e => filterSideNav(e.target.value));
        sideSearch.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            sideSearch.value = '';
            filterSideNav('');
            sideSearch.blur();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = navLinks.find(link => !link.classList.contains('is-nav-hidden'));
            if (first) first.click();
          }
        });
      }
