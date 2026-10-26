// Terminated User Access Auditor - Full Report & Screenshots Logic

const summaryTableBody = document.getElementById('summaryTableBody');
const screenshotsGrid = document.getElementById('screenshotsGrid');
const reportSubtitle = document.getElementById('reportSubtitle');
const downloadAllPngBtn = document.getElementById('downloadAllPngBtn');
const exportHtmlReportBtn = document.getElementById('exportHtmlReportBtn');
const copySummaryBtn = document.getElementById('copySummaryBtn');
const printPdfBtn = document.getElementById('printPdfBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

let cachedResults = [];
let cachedConfig = null;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadAndRenderReport() {
  const { auditResults = [], auditConfig = {} } = await chrome.storage.local.get(['auditResults', 'auditConfig']);
  cachedResults = auditResults;
  cachedConfig = auditConfig;

  if (auditConfig?.userEmail) {
    reportSubtitle.textContent = `Terminated User Checked: ${auditConfig.userEmail} • Total Captures: ${auditResults.length}`;
  }

  if (auditResults.length === 0) {
    summaryTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell">No audit results captured yet. Open the extension and click "Run All 6 Websites & Take Screenshots".</td>
      </tr>
    `;
    screenshotsGrid.innerHTML = '';
    return;
  }

  // Render Summary Table
  summaryTableBody.innerHTML = auditResults.map((r, i) => {
    const d = r.details || {};
    const verdict = d.accessVerdict || 'Captured';
    const isWarn = d.emailFound && !verdict.toLowerCase().includes('disabled') && !verdict.toLowerCase().includes('terminated');
    const badgeClass = isWarn ? 'badge-warn' : 'badge-ok';

    const rowsHtml = (d.extractedRows && d.extractedRows.length > 0)
      ? `<ul class="rows-list">${d.extractedRows.slice(0, 6).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : `<span style="color:#94a3b8;">Page Title: ${escapeHtml(d.title || r.siteName)}</span>`;

    return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <strong>${escapeHtml(r.siteName || 'Website')}</strong><br/>
          <a href="${escapeHtml(d.url || '#')}" target="_blank" style="color:#38bdf8;font-size:11px;word-break:break-all;">
            ${escapeHtml((d.url || '').slice(0, 65))}
          </a>
        </td>
        <td>
          <strong>${escapeHtml(r.stepLabel || '')}</strong><br/>
          ${r.activeQuery ? `<span style="color:#fde047;font-size:11.5px;">Query: "${escapeHtml(r.activeQuery)}"</span>` : ''}
        </td>
        <td>${escapeHtml(d.emailChecked || auditConfig?.userEmail || '—')}</td>
        <td><span class="${badgeClass}">${escapeHtml(verdict)}</span></td>
        <td>
          reporting: <strong>${d.reportingMatchCount ?? 0}</strong><br/>
          tableau: <strong>${d.tableauMatchCount ?? 0}</strong>
        </td>
        <td>${rowsHtml}</td>
      </tr>
    `;
  }).join('');

  // Render Screenshots Grid
  screenshotsGrid.innerHTML = auditResults.map((r, i) => {
    const d = r.details || {};
    return `
      <article class="shot-card">
        <div class="shot-card-header">
          <div>
            <div class="shot-title">${i + 1}. ${escapeHtml(r.siteName)} — ${escapeHtml(r.stepLabel)}</div>
            <div class="shot-meta">
              Query: <strong>${escapeHtml(r.activeQuery || 'N/A')}</strong> • Captured: ${new Date(r.capturedAt).toLocaleString()}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-secondary" data-dl-idx="${i}">⬇️ Save PNG</button>
          </div>
        </div>
        <div class="shot-img-wrap">
          ${r.screenshotDataUrl
            ? `<img src="${r.screenshotDataUrl}" alt="${escapeHtml(r.siteName)} screenshot" />`
            : `<div style="padding:24px;color:#94a3b8;">No screenshot image available</div>`
          }
        </div>
        <div class="shot-details-box">
          <div><strong>URL:</strong> ${escapeHtml(d.url || '')}</div>
          <div><strong>Access Verdict:</strong> ${escapeHtml(d.accessVerdict || '')} (reporting matches: ${d.reportingMatchCount ?? 0}, tableau matches: ${d.tableauMatchCount ?? 0})</div>
        </div>
      </article>
    `;
  }).join('');

  screenshotsGrid.querySelectorAll('button[data-dl-idx]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-dl-idx'));
      const item = cachedResults[idx];
      if (!item?.screenshotDataUrl) return;
      await chrome.downloads.download({
        url: item.screenshotDataUrl,
        filename: item.filename || `Audit_Screenshot_${idx + 1}.png`,
        saveAs: true
      });
    });
  });
}

downloadAllPngBtn.addEventListener('click', async () => {
  for (let i = 0; i < cachedResults.length; i++) {
    const item = cachedResults[i];
    if (!item?.screenshotDataUrl) continue;
    await chrome.downloads.download({
      url: item.screenshotDataUrl,
      filename: `Terminated_Access_Audit/${item.filename || `Audit_${i + 1}.png`}`,
      saveAs: false
    });
  }
});

exportHtmlReportBtn.addEventListener('click', async () => {
  const email = cachedConfig?.userEmail || 'terminated_user';
  const safeEmail = email.replace(/[^a-z0-9]+/gi, '_');
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Terminated User Access Audit - ${escapeHtml(email)}</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
  h1 { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 28px; background: #fff; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; font-size: 13px; }
  th { background: #e2e8f0; }
  .shot { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 20px; page-break-inside: avoid; }
  .shot img { max-width: 100%; border: 1px solid #94a3b8; margin-top: 10px; }
</style>
</head>
<body>
  <h1>Terminated User Access Audit Evidence Report</h1>
  <p><strong>Terminated User Email:</strong> ${escapeHtml(email)} | <strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Website</th><th>Step / Query</th><th>Access Verdict</th><th>reporting / tableau</th><th>URL</th>
      </tr>
    </thead>
    <tbody>
      ${cachedResults.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.siteName)}</td>
          <td>${escapeHtml(r.stepLabel)} (${escapeHtml(r.activeQuery || '')})</td>
          <td>${escapeHtml(r.details?.accessVerdict || '')}</td>
          <td>reporting: ${r.details?.reportingMatchCount ?? 0}, tableau: ${r.details?.tableauMatchCount ?? 0}</td>
          <td>${escapeHtml(r.details?.url || '')}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ${cachedResults.map((r, i) => `
    <div class="shot">
      <h3>${i + 1}. ${escapeHtml(r.siteName)} — ${escapeHtml(r.stepLabel)} (Query: "${escapeHtml(r.activeQuery || '')}")</h3>
      <div><strong>URL:</strong> ${escapeHtml(r.details?.url || '')} | <strong>Verdict:</strong> ${escapeHtml(r.details?.accessVerdict || '')}</div>
      ${r.screenshotDataUrl ? `<img src="${r.screenshotDataUrl}" />` : ''}
    </div>
  `).join('')}
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `Terminated_Access_Audit_Report_${safeEmail}.html`,
    saveAs: true
  });
});

copySummaryBtn.addEventListener('click', async () => {
  const email = cachedConfig?.userEmail || 'N/A';
  const lines = [
    `=== Terminated User Access Audit Summary ===`,
    `User Checked: ${email}`,
    `Timestamp: ${new Date().toLocaleString()}`,
    ``
  ];
  cachedResults.forEach((r, idx) => {
    const d = r.details || {};
    lines.push(
      `${idx + 1}. ${r.siteName} [${r.stepLabel} | Query: "${r.activeQuery || ''}"]`,
      `   - URL: ${d.url || ''}`,
      `   - Verdict: ${d.accessVerdict || ''}`,
      `   - Group Keywords: reporting=${d.reportingMatchCount ?? 0}, tableau=${d.tableauMatchCount ?? 0}`,
      `   - Screenshot: ${r.filename || 'Captured'}`
    );
  });
  await navigator.clipboard.writeText(lines.join('\n'));
  copySummaryBtn.textContent = '✅ Copied Summary!';
  setTimeout(() => { copySummaryBtn.textContent = '📋 Copy Ticket Summary'; }, 2000);
});

printPdfBtn.addEventListener('click', () => {
  window.print();
});

clearAllBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ auditResults: [] });
  await loadAndRenderReport();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.auditResults) {
    loadAndRenderReport();
  }
});

loadAndRenderReport();
