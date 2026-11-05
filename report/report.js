// Terminated User Access Auditor - Full Report & Pure Screenshots Logic

const summaryTableBody = document.getElementById('summaryTableBody');
const screenshotsGrid = document.getElementById('screenshotsGrid');
const reportSubtitle = document.getElementById('reportSubtitle');
const copyAllImagesBtn = document.getElementById('copyAllImagesBtn');
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

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Copy ONLY pure screenshots (zero text, zero headers, zero "Query:" labels)
async function copyAllScreenshotsToClipboard(results) {
  const validShots = (results || []).filter(r => r.screenshotDataUrl);
  if (validShots.length === 0) {
    throw new Error('No screenshots available to copy.');
  }

  const loadedImages = await Promise.all(validShots.map(r => loadImage(r.screenshotDataUrl)));

  const GAP_HEIGHT = 8;
  const maxWidth = Math.max(...loadedImages.map(img => img.naturalWidth || img.width || 1280));
  const totalHeight = loadedImages.reduce(
    (sum, img, idx) => sum + (img.naturalHeight || img.height || 720) + (idx < loadedImages.length - 1 ? GAP_HEIGHT : 0),
    0
  );

  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  let yOffset = 0;
  for (let i = 0; i < validShots.length; i++) {
    const img = loadedImages[i];
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, yOffset, w, h);
    yOffset += h + GAP_HEIGHT;
  }

  const stitchedPngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

  // Pure <img> tags only — no text or headers at all
  const htmlParts = validShots.map(r => `<img src="${r.screenshotDataUrl}" style="max-width:100%;display:block;margin-bottom:8px;" />`).join('');
  const htmlBlob = new Blob([`<div>${htmlParts}</div>`], { type: 'text/html' });

  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': stitchedPngBlob,
      'text/html': htmlBlob
    })
  ]);
}

async function copySingleScreenshotToClipboard(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': blob
    })
  ]);
}

async function loadAndRenderReport() {
  const { auditResults = [], auditConfig = {} } = await chrome.storage.local.get(['auditResults', 'auditConfig']);
  cachedResults = auditResults;
  cachedConfig = auditConfig;

  if (auditConfig?.userEmail) {
    reportSubtitle.textContent = `Terminated User Checked: ${auditConfig.userEmail} • Total Screenshots: ${auditResults.length}`;
  }

  if (auditResults.length === 0) {
    summaryTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell">No audit results captured yet. Open the extension and click "Run All 6 Websites Fast & Screenshot".</td>
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
        <td><strong>${escapeHtml(r.stepLabel || '')}</strong></td>
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

  // Render Pure Screenshots Grid (no Query / URL / Verdict text around screenshots)
  screenshotsGrid.innerHTML = auditResults.map((r, i) => `
    <article class="shot-card">
      <div class="shot-card-header" style="justify-content:flex-end;">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary" data-copy-idx="${i}">📋 Copy Image</button>
          <button class="btn btn-secondary" data-dl-idx="${i}">⬇️ Save PNG</button>
        </div>
      </div>
      <div class="shot-img-wrap">
        ${r.screenshotDataUrl
          ? `<img src="${r.screenshotDataUrl}" alt="Screenshot ${i + 1}" />`
          : `<div style="padding:24px;color:#94a3b8;">No screenshot image available</div>`
        }
      </div>
    </article>
  `).join('');

  screenshotsGrid.querySelectorAll('button[data-copy-idx]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-copy-idx'));
      const item = cachedResults[idx];
      if (!item?.screenshotDataUrl) return;
      await copySingleScreenshotToClipboard(item.screenshotDataUrl);
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    });
  });

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

copyAllImagesBtn.addEventListener('click', async () => {
  try {
    copyAllImagesBtn.textContent = '⏳ Copying All Images...';
    await copyAllScreenshotsToClipboard(cachedResults);
    copyAllImagesBtn.textContent = `✅ Copied All ${cachedResults.length} Screenshots! Press Ctrl+V to Paste`;
    setTimeout(() => {
      copyAllImagesBtn.textContent = '📋 Copy All Screenshots (Paste All with Ctrl+V)';
    }, 3000);
  } catch (err) {
    copyAllImagesBtn.textContent = `⚠️ ${err?.message || 'Nothing to copy'}`;
    setTimeout(() => {
      copyAllImagesBtn.textContent = '📋 Copy All Screenshots (Paste All with Ctrl+V)';
    }, 2500);
  }
});

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
<title>Screenshots - ${escapeHtml(email)}</title>
<style>
  body { margin: 16px; background: #ffffff; }
  img { max-width: 100%; display: block; margin-bottom: 12px; border: 1px solid #cbd5e1; }
</style>
</head>
<body>
  ${cachedResults.map(r => r.screenshotDataUrl ? `<img src="${r.screenshotDataUrl}" />` : '').join('')}
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `Terminated_Access_Screenshots_${safeEmail}.html`,
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
      `${idx + 1}. ${r.siteName}`,
      `   - Verdict: ${d.accessVerdict || ''}`,
      `   - Group Keywords: reporting=${d.reportingMatchCount ?? 0}, tableau=${d.tableauMatchCount ?? 0}`
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
