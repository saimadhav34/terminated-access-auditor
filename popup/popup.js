// Terminated User Access Auditor - Popup & Side Panel Logic (Permanent Link Storage)

const userEmailInput = document.getElementById('userEmailInput');
const waitSecInput = document.getElementById('waitSecInput');
const autoDownloadCheck = document.getElementById('autoDownloadCheck');
const saveLinksBtn = document.getElementById('saveLinksBtn');
const runAllBtn = document.getElementById('runAllBtn');
const stopBtn = document.getElementById('stopBtn');
const copyAllPopupBtn = document.getElementById('copyAllPopupBtn');
const openSidePanelBtn = document.getElementById('openSidePanelBtn');
const openReportBtn = document.getElementById('openReportBtn');
const shotCountBadge = document.getElementById('shotCountBadge');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');

const SITE_DEFINITIONS = [
  {
    id: 'site_1',
    index: 1,
    name: 'Shutterstock Inc Person',
    mode: 'user_groups_ctrlf',
    inputId: 'url_site_1'
  },
  {
    id: 'site_2',
    index: 2,
    name: 'PagerDuty',
    mode: 'email_search',
    inputId: 'url_site_2'
  },
  {
    id: 'site_3',
    index: 3,
    name: 'M365 Admin Center',
    mode: 'email_search',
    inputId: 'url_site_3'
  },
  {
    id: 'site_4',
    index: 4,
    name: 'Lucidchart',
    mode: 'email_search',
    inputId: 'url_site_4'
  },
  {
    id: 'site_5',
    index: 5,
    name: 'Bigstock Admin',
    mode: 'email_column_search',
    inputId: 'url_site_5'
  },
  {
    id: 'site_6',
    index: 6,
    name: 'Google Sheet',
    mode: 'ctrlf_sheet',
    inputId: 'url_site_6'
  }
];

let isPopupLoaded = false;

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

// Copy all captured screenshots into the clipboard (pure images ONLY — no text or headers)
async function copyAllScreenshotsFromStorage() {
  const { auditResults = [] } = await chrome.storage.local.get('auditResults');
  const validShots = auditResults.filter(r => r.screenshotDataUrl);
  if (validShots.length === 0) {
    throw new Error('No screenshots captured yet.');
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

  // Pure <img> tags only — zero text
  const htmlParts = validShots.map(r => `<img src="${r.screenshotDataUrl}" style="max-width:100%;display:block;margin-bottom:8px;" />`).join('');
  const htmlBlob = new Blob([`<div>${htmlParts}</div>`], { type: 'text/html' });

  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': stitchedPngBlob,
      'text/html': htmlBlob
    })
  ]);

  return validShots.length;
}

// Permanently persist links across chrome.storage.local, chrome.storage.sync, and localStorage
async function collectAndSaveConfig(showFeedback = true) {
  if (!isPopupLoaded) return null;

  const permanentLinks = {};
  const sites = SITE_DEFINITIONS.map(def => {
    const inputEl = document.getElementById(def.inputId);
    const val = inputEl ? inputEl.value.trim() : '';
    permanentLinks[def.id] = val;
    return {
      id: def.id,
      index: def.index,
      name: def.name,
      mode: def.mode,
      url: val
    };
  });

  const nextConfig = {
    userEmail: userEmailInput.value.trim(),
    keyword1: 'reporting',
    keyword2: 'tableau',
    pageLoadWaitSec: Math.max(0, Number(waitSecInput.value) || 1),
    autoDownloadScreenshots: autoDownloadCheck.checked,
    sites
  };

  // Save in local storage, sync storage, and window.localStorage so links are never lost
  await chrome.storage.local.set({
    auditConfig: nextConfig,
    permanentSiteLinks: permanentLinks
  });

  try {
    await chrome.storage.sync.set({ permanentSiteLinks: permanentLinks });
  } catch (_) {}

  try {
    localStorage.setItem('tua_permanent_links', JSON.stringify(permanentLinks));
    localStorage.setItem('tua_last_email', nextConfig.userEmail);
  } catch (_) {}

  if (showFeedback) {
    statusText.textContent = '✅ Permanently saved all 6 website links!';
  }
  return nextConfig;
}

async function refreshUIFromStorage() {
  const { auditConfig, permanentSiteLinks, auditRunState, auditResults = [] } = await chrome.storage.local.get([
    'auditConfig',
    'permanentSiteLinks',
    'auditRunState',
    'auditResults'
  ]);

  let syncLinks = {};
  try {
    const syncData = await chrome.storage.sync.get('permanentSiteLinks');
    syncLinks = syncData?.permanentSiteLinks || {};
  } catch (_) {}

  let localBackupLinks = {};
  let localBackupEmail = '';
  try {
    localBackupLinks = JSON.parse(localStorage.getItem('tua_permanent_links') || '{}');
    localBackupEmail = localStorage.getItem('tua_last_email') || '';
  } catch (_) {}

  // Restore email and settings without ever wiping them
  userEmailInput.value = auditConfig?.userEmail || localBackupEmail || '';
  waitSecInput.value = auditConfig?.pageLoadWaitSec ?? 1;
  autoDownloadCheck.checked = Boolean(auditConfig?.autoDownloadScreenshots);

  // Restore each of the 6 website links from any available permanent store
  SITE_DEFINITIONS.forEach(def => {
    const fromConfig = (auditConfig?.sites || []).find(s => s.id === def.id)?.url || '';
    const fromPerm = permanentSiteLinks?.[def.id] || '';
    const fromSync = syncLinks?.[def.id] || '';
    const fromLocal = localBackupLinks?.[def.id] || '';
    const bestUrl = fromPerm || fromConfig || fromSync || fromLocal || '';

    const inputEl = document.getElementById(def.inputId);
    if (inputEl) {
      inputEl.value = bestUrl;
    }
  });

  isPopupLoaded = true;
  await collectAndSaveConfig(false);

  shotCountBadge.textContent = String(auditResults.length);
  applyRunState(auditRunState);
}

function applyRunState(runState) {
  if (!runState) return;
  statusText.textContent = runState.statusText || 'Ready — Your 6 website links are saved permanently.';
  if (runState.running) {
    statusDot.classList.add('running');
    stopBtn.classList.remove('hidden');
    runAllBtn.disabled = true;
    runAllBtn.textContent = `⏳ Running (${runState.progress || 1}/${runState.total || 6})...`;
  } else {
    statusDot.classList.remove('running');
    stopBtn.classList.add('hidden');
    runAllBtn.disabled = false;
    runAllBtn.textContent = '⚡ Run All 6 Websites Fast & Screenshot';
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.auditRunState) {
    applyRunState(changes.auditRunState.newValue);
  }
  if (changes.auditResults) {
    const list = changes.auditResults.newValue || [];
    shotCountBadge.textContent = String(list.length);
  }
});

// Save immediately on every input, paste, and change event so links are saved the instant they are typed/pasted
[userEmailInput, waitSecInput, autoDownloadCheck].forEach(el => {
  el.addEventListener('input', () => collectAndSaveConfig(false));
  el.addEventListener('change', () => collectAndSaveConfig(false));
});

SITE_DEFINITIONS.forEach(def => {
  const inputEl = document.getElementById(def.inputId);
  if (inputEl) {
    inputEl.addEventListener('input', () => collectAndSaveConfig(false));
    inputEl.addEventListener('paste', () => setTimeout(() => collectAndSaveConfig(false), 50));
    inputEl.addEventListener('change', () => collectAndSaveConfig(false));
  }
});

document.querySelectorAll('button[data-run-id]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const siteId = btn.getAttribute('data-run-id');
    const cfg = await collectAndSaveConfig(false);
    if (!cfg.userEmail) {
      statusText.textContent = '⚠️ Please enter the Terminated User Email first.';
      userEmailInput.focus();
      return;
    }
    const targetSite = cfg.sites.find(s => s.id === siteId);
    if (!targetSite?.url) {
      statusText.textContent = `⚠️ Please paste the ${targetSite?.name || 'website'} link first.`;
      const def = SITE_DEFINITIONS.find(d => d.id === siteId);
      if (def) document.getElementById(def.inputId)?.focus();
      return;
    }
    await chrome.runtime.sendMessage({
      type: 'START_FULL_AUDIT',
      config: cfg,
      targetSiteId: siteId
    });
  });
});

saveLinksBtn.addEventListener('click', () => collectAndSaveConfig(true));

runAllBtn.addEventListener('click', async () => {
  const cfg = await collectAndSaveConfig(false);
  if (!cfg.userEmail) {
    statusText.textContent = '⚠️ Please enter the Terminated User Email first.';
    userEmailInput.focus();
    return;
  }

  const providedSites = cfg.sites.filter(s => s.url && s.url.length > 0);
  if (providedSites.length === 0) {
    statusText.textContent = '⚠️ Please paste the links for your websites first.';
    document.getElementById('url_site_1')?.focus();
    return;
  }

  await chrome.runtime.sendMessage({
    type: 'START_FULL_AUDIT',
    config: cfg
  });
});

stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_AUDIT' });
});

copyAllPopupBtn.addEventListener('click', async () => {
  try {
    copyAllPopupBtn.textContent = '⏳ Copying All Screenshots...';
    const count = await copyAllScreenshotsFromStorage();
    copyAllPopupBtn.textContent = `✅ Copied All ${count} Images! Press Ctrl+V Anywhere`;
    statusText.textContent = `Copied all ${count} screenshots to clipboard — press Ctrl+V to paste!`;
    setTimeout(() => {
      copyAllPopupBtn.textContent = '📋 Copy All Captured Screenshots (Paste All with Ctrl+V)';
    }, 3000);
  } catch (err) {
    statusText.textContent = `⚠️ ${err?.message || 'Could not copy screenshots'}`;
    copyAllPopupBtn.textContent = '📋 Copy All Captured Screenshots (Paste All with Ctrl+V)';
  }
});

openReportBtn.addEventListener('click', async () => {
  const reportUrl = chrome.runtime.getURL('report/report.html');
  await chrome.tabs.create({ url: reportUrl, active: true });
});

openSidePanelBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    } else {
      statusText.textContent = 'Side Panel API not available in this view.';
    }
  } catch (err) {
    statusText.textContent = 'Could not open Side Panel: ' + (err?.message || err);
  }
});

async function runOnActiveTab(actionFn) {
  const cfg = await collectAndSaveConfig(false);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
  } catch (_) {}

  await actionFn(tab, cfg);
}

document.getElementById('curPasteEmailBtn').addEventListener('click', () => {
  runOnActiveTab(async (tab, cfg) => {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'LOCATE_AND_PASTE_EMAIL',
      email: cfg.userEmail
    });
    statusText.textContent = res?.message || 'Pasted email on current tab.';
  });
});

document.getElementById('curGroupsTabBtn').addEventListener('click', () => {
  runOnActiveTab(async (tab, cfg) => {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'OPEN_USER_AND_GROUPS_TAB',
      email: cfg.userEmail
    });
    statusText.textContent = res?.clickedGroupsTab
      ? `Opened "${res.groupsTabLabel}" tab!`
      : 'Groups tab not found on current view.';
  });
});

async function runQuickCtrlFAndCapture(query, label) {
  await runOnActiveTab(async (tab, cfg) => {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'RUN_CTRLF_SEARCH',
      query,
      showOverlay: true
    });
    await new Promise(r => setTimeout(r, 300));
    const prep = await chrome.tabs.sendMessage(tab.id, {
      type: 'PREPARE_FOR_SCREENSHOT',
      email: cfg.userEmail,
      hideCtrlFOverlay: false
    });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_AFTER_SCREENSHOT' });

    const { auditResults = [] } = await chrome.storage.local.get('auditResults');
    auditResults.push({
      id: `res_${Date.now()}`,
      capturedAt: new Date().toISOString(),
      siteIndex: 0,
      siteName: tab.title || new URL(tab.url).hostname,
      stepLabel: label,
      activeQuery: query,
      filename: `Audit_${label.replace(/[^a-z0-9]+/gi, '_')}_${Date.now()}.png`,
      screenshotDataUrl: dataUrl,
      details: prep?.details || { url: tab.url, title: tab.title, emailChecked: cfg.userEmail }
    });
    await chrome.storage.local.set({ auditResults });
    statusText.textContent = `Captured screenshot for Ctrl+F "${query}"!`;
  });
}

document.getElementById('curCtrlFReportingBtn').addEventListener('click', async () => {
  const cfg = await collectAndSaveConfig(false);
  await runQuickCtrlFAndCapture(cfg.keyword1 || 'reporting', `CtrlF_${cfg.keyword1 || 'reporting'}`);
});

document.getElementById('curCtrlFTableauBtn').addEventListener('click', async () => {
  const cfg = await collectAndSaveConfig(false);
  await runQuickCtrlFAndCapture(cfg.keyword2 || 'tableau', `CtrlF_${cfg.keyword2 || 'tableau'}`);
});

document.getElementById('curCtrlFEmailBtn').addEventListener('click', async () => {
  const cfg = await collectAndSaveConfig(false);
  if (!cfg.userEmail) {
    statusText.textContent = 'Enter Terminated User Email first.';
    return;
  }
  await runQuickCtrlFAndCapture(cfg.userEmail, 'CtrlF_User_Email');
});

refreshUIFromStorage();
