// Terminated User Access Auditor - Popup & Side Panel Logic

const userEmailInput = document.getElementById('userEmailInput');
const waitSecInput = document.getElementById('waitSecInput');
const autoDownloadCheck = document.getElementById('autoDownloadCheck');
const saveLinksBtn = document.getElementById('saveLinksBtn');
const runAllBtn = document.getElementById('runAllBtn');
const stopBtn = document.getElementById('stopBtn');
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
    mode: 'email_search',
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

async function collectAndSaveConfig(showFeedback = true) {
  const sites = SITE_DEFINITIONS.map(def => {
    const inputEl = document.getElementById(def.inputId);
    return {
      id: def.id,
      index: def.index,
      name: def.name,
      mode: def.mode,
      url: inputEl ? inputEl.value.trim() : ''
    };
  });

  const nextConfig = {
    configVersion: 3,
    userEmail: userEmailInput.value.trim(),
    keyword1: 'reporting',
    keyword2: 'tableau',
    pageLoadWaitSec: Math.max(2, Number(waitSecInput.value) || 5),
    autoDownloadScreenshots: autoDownloadCheck.checked,
    sites
  };

  await chrome.storage.local.set({ auditConfig: nextConfig });

  if (showFeedback) {
    statusText.textContent = '✅ Saved email & 6 website links!';
  }
  return nextConfig;
}

async function refreshUIFromStorage() {
  const { auditConfig, auditRunState, auditResults = [] } = await chrome.storage.local.get([
    'auditConfig',
    'auditRunState',
    'auditResults'
  ]);

  if (auditConfig && auditConfig.configVersion === 3) {
    userEmailInput.value = auditConfig.userEmail || '';
    waitSecInput.value = auditConfig.pageLoadWaitSec || 5;
    autoDownloadCheck.checked = Boolean(auditConfig.autoDownloadScreenshots);

    SITE_DEFINITIONS.forEach(def => {
      const savedSite = (auditConfig.sites || []).find(s => s.id === def.id);
      const inputEl = document.getElementById(def.inputId);
      if (inputEl) {
        inputEl.value = savedSite?.url || '';
      }
    });
  } else {
    // Initialize clean empty inputs so the extension explicitly asks for email + 6 site links
    await collectAndSaveConfig(false);
  }

  shotCountBadge.textContent = String(auditResults.length);
  applyRunState(auditRunState);
}

function applyRunState(runState) {
  if (!runState) return;
  statusText.textContent = runState.statusText || 'Enter the terminated user email and 6 website links.';
  if (runState.running) {
    statusDot.classList.add('running');
    stopBtn.classList.remove('hidden');
    runAllBtn.disabled = true;
    runAllBtn.textContent = `⏳ Running (${runState.progress || 1}/${runState.total || 6})...`;
  } else {
    statusDot.classList.remove('running');
    stopBtn.classList.add('hidden');
    runAllBtn.disabled = false;
    runAllBtn.textContent = '🚀 Run All 6 Websites & Take Screenshots';
  }
}

// Listen for live storage updates
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

// Auto-save whenever inputs change
[userEmailInput, waitSecInput, autoDownloadCheck].forEach(el => {
  el.addEventListener('change', () => collectAndSaveConfig(false));
});

SITE_DEFINITIONS.forEach(def => {
  const inputEl = document.getElementById(def.inputId);
  if (inputEl) {
    inputEl.addEventListener('change', () => collectAndSaveConfig(false));
  }
});

// Run individual site button
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
    statusText.textContent = '⚠️ Please paste the links for your websites (Shutterstock, PagerDuty, M365, Lucidchart, Bigstock, Google Sheet) first.';
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

// Instant single-step tools for the currently active tab
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
    await new Promise(r => setTimeout(r, 500));
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
