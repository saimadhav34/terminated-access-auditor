// Terminated User Access Auditor - Fast MV3 Service Worker

const CONFIG_VERSION = 4;

const DEFAULT_SITES = [
  {
    id: 'site_1',
    index: 1,
    name: 'Shutterstock Inc Person',
    url: '',
    mode: 'user_groups_ctrlf',
    description: 'Search user → Open Groups tab → Ctrl+F "reporting" (Screenshot) & "tableau" (Screenshot)'
  },
  {
    id: 'site_2',
    index: 2,
    name: 'PagerDuty',
    url: '',
    mode: 'email_search',
    description: 'Locate Active User / Email field → Paste email & search → Gather details & Screenshot'
  },
  {
    id: 'site_3',
    index: 3,
    name: 'M365 Admin Center',
    url: '',
    mode: 'email_search',
    description: 'Locate Active Users search field → Paste email & search → Gather details & Screenshot'
  },
  {
    id: 'site_4',
    index: 4,
    name: 'Lucidchart',
    url: '',
    mode: 'email_search',
    description: 'Locate Active User / Email field → Paste email & search → Gather details & Screenshot'
  },
  {
    id: 'site_5',
    index: 5,
    name: 'Bigstock Admin',
    url: '',
    mode: 'email_search',
    description: 'Locate Active User / Email field → Paste email & search → Gather details & Screenshot'
  },
  {
    id: 'site_6',
    index: 6,
    name: 'Google Sheet',
    url: '',
    mode: 'ctrlf_sheet',
    description: 'Press Ctrl+F & search for terminated user email → Gather details & Screenshot'
  }
];

const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  userEmail: '',
  keyword1: 'reporting',
  keyword2: 'tableau',
  pageLoadWaitSec: 1,
  autoDownloadScreenshots: false,
  sites: DEFAULT_SITES
};

chrome.runtime.onInstalled.addListener(async () => {
  const { auditConfig } = await chrome.storage.local.get('auditConfig');
  if (!auditConfig || auditConfig.configVersion !== CONFIG_VERSION) {
    await chrome.storage.local.set({
      auditConfig: {
        ...DEFAULT_CONFIG,
        userEmail: auditConfig?.userEmail || '',
        sites: auditConfig?.sites || DEFAULT_SITES
      },
      auditResults: [],
      auditRunState: { running: false, statusText: 'Ready', progress: 0, total: 6 }
    });
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateRunState(patch) {
  const { auditRunState = {} } = await chrome.storage.local.get('auditRunState');
  const nextState = { ...auditRunState, ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ auditRunState: nextState });
  await chrome.action.setBadgeText({
    text: nextState.running ? `${nextState.progress || 1}/${nextState.total || 6}` : ''
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#0284c7' });
}

async function appendAuditResult(entry) {
  const { auditResults = [] } = await chrome.storage.local.get('auditResults');
  auditResults.push({
    id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    capturedAt: new Date().toISOString(),
    ...entry
  });
  await chrome.storage.local.set({ auditResults });
}

// Fast poll (every 150ms) for tab load completion
async function waitForTabComplete(tabId, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        return tab;
      }
    } catch (_) {
      break;
    }
    await sleep(150);
  }
  return chrome.tabs.get(tabId).catch(() => null);
}

// Ensure content script and styles are injected in the target tab
async function ensureContentScriptReady(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' });
    if (ping?.ok) return true;
  } catch (_) {}

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css']
    });
  } catch (_) {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    await sleep(80);
    return true;
  } catch (_) {
    return false;
  }
}

// Capture screenshot of a specific tab quickly and cleanly
async function captureTabEvidence({ tabId, siteName, siteIndex, stepLabel, activeQuery, email, hideCtrlFOverlay = false, autoDownload = false }) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await sleep(160);

  let details = {
    url: tab?.url || '',
    title: tab?.title || siteName,
    emailChecked: email,
    emailFound: false,
    accessVerdict: 'Captured Screenshot',
    reportingMatchCount: 0,
    tableauMatchCount: 0,
    extractedRows: []
  };

  try {
    const prep = await chrome.tabs.sendMessage(tabId, {
      type: 'PREPARE_FOR_SCREENSHOT',
      email,
      hideCtrlFOverlay
    });
    if (prep?.details) {
      details = prep.details;
    }
  } catch (_) {}

  await sleep(90);
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'RESTORE_AFTER_SCREENSHOT' });
  } catch (_) {}

  const safeSite = (siteName || `Site_${siteIndex}`).replace(/[^a-z0-9]+/gi, '_');
  const safeStep = (stepLabel || 'check').replace(/[^a-z0-9]+/gi, '_');
  const safeUser = (email || 'user').split('@')[0].replace(/[^a-z0-9]+/gi, '_');
  const filename = `Audit_${siteIndex}_${safeSite}_${safeStep}_${safeUser}.png`;

  if (autoDownload && screenshotDataUrl) {
    try {
      await chrome.downloads.download({
        url: screenshotDataUrl,
        filename: `Terminated_Access_Audit/${filename}`,
        saveAs: false
      });
    } catch (_) {}
  }

  const entry = {
    siteIndex,
    siteName,
    stepLabel,
    activeQuery,
    filename,
    screenshotDataUrl,
    details
  };

  await appendAuditResult(entry);
  return entry;
}

// Execute fast automation on a pre-opened tab
async function runSingleSiteOnTab(site, tabId, config, progressIndex, totalSites) {
  const email = (config.userEmail || '').trim();
  const kw1 = (config.keyword1 || 'reporting').trim();
  const kw2 = (config.keyword2 || 'tableau').trim();
  const settleMs = Math.max(300, (Number(config.pageLoadWaitSec) || 1) * 600);
  const autoDownload = Boolean(config.autoDownloadScreenshots);

  await chrome.tabs.update(tabId, { active: true });
  await waitForTabComplete(tabId, 12000);
  await ensureContentScriptReady(tabId);
  await sleep(settleMs);

  if (site.mode === 'user_groups_ctrlf') {
    // Shutterstock Inc Person:
    // 1. Immediately locate user/person box & paste email
    await updateRunState({
      running: true,
      progress: progressIndex,
      total: totalSites,
      statusText: `[${progressIndex}/${totalSites}] ${site.name}: Searching "${email}"...`
    });
    if (email) {
      await chrome.tabs.sendMessage(tabId, {
        type: 'LOCATE_AND_PASTE_EMAIL',
        email
      }).catch(() => {});
      await sleep(1100);
    }

    // 2. Open user & click Groups tab
    await updateRunState({
      statusText: `[${progressIndex}/${totalSites}] ${site.name}: Opening Groups tab...`
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'OPEN_USER_AND_GROUPS_TAB',
      email
    }).catch(() => {});
    await sleep(800);

    // 3. Ctrl+F "reporting" + Screenshot #1
    await updateRunState({
      statusText: `[${progressIndex}/${totalSites}] ${site.name}: Ctrl+F "${kw1}" + Screenshot...`
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'RUN_CTRLF_SEARCH',
      query: kw1,
      showOverlay: true
    }).catch(() => {});
    await sleep(300);
    await captureTabEvidence({
      tabId,
      siteName: site.name,
      siteIndex: site.index,
      stepLabel: `Groups_CtrlF_${kw1}`,
      activeQuery: kw1,
      email,
      hideCtrlFOverlay: false,
      autoDownload
    });

    // 4. Ctrl+F "tableau" + Screenshot #2
    await updateRunState({
      statusText: `[${progressIndex}/${totalSites}] ${site.name}: Ctrl+F "${kw2}" + Screenshot...`
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'RUN_CTRLF_SEARCH',
      query: kw2,
      showOverlay: true
    }).catch(() => {});
    await sleep(300);
    await captureTabEvidence({
      tabId,
      siteName: site.name,
      siteIndex: site.index,
      stepLabel: `Groups_CtrlF_${kw2}`,
      activeQuery: kw2,
      email,
      hideCtrlFOverlay: false,
      autoDownload
    });
  } else if (site.mode === 'email_search') {
    // PagerDuty, M365 Admin Center, Lucidchart, Bigstock Admin:
    // Immediately locate Active User / Email search box -> paste email -> search -> screenshot
    await updateRunState({
      running: true,
      progress: progressIndex,
      total: totalSites,
      statusText: `[${progressIndex}/${totalSites}] ${site.name}: Searching "${email}"...`
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'LOCATE_AND_PASTE_EMAIL',
      email
    }).catch(() => {});
    await sleep(1100);

    await captureTabEvidence({
      tabId,
      siteName: site.name,
      siteIndex: site.index,
      stepLabel: 'Active_User_Email_Search',
      activeQuery: email,
      email,
      hideCtrlFOverlay: true,
      autoDownload
    });
  } else if (site.mode === 'ctrlf_sheet') {
    // Google Sheet: Ctrl+F email -> screenshot
    const queryToUse = email || kw1;
    await updateRunState({
      running: true,
      progress: progressIndex,
      total: totalSites,
      statusText: `[${progressIndex}/${totalSites}] ${site.name}: Ctrl+F "${queryToUse}"...`
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'RUN_CTRLF_SEARCH',
      query: queryToUse,
      showOverlay: true
    }).catch(() => {});
    await sleep(600);

    await captureTabEvidence({
      tabId,
      siteName: site.name,
      siteIndex: site.index,
      stepLabel: 'Google_Sheet_CtrlF_Email',
      activeQuery: queryToUse,
      email,
      hideCtrlFOverlay: false,
      autoDownload
    });
  }
}

// Open all target website tabs simultaneously in parallel so they load at the same time!
async function startAuditWorkflow(config, targetSiteId = null) {
  await chrome.storage.local.set({ auditConfig: { ...config, configVersion: CONFIG_VERSION } });

  const sitesToRun = (config.sites || DEFAULT_SITES).filter(s => {
    if (!s.url || !s.url.trim()) return false;
    if (targetSiteId) return s.id === targetSiteId;
    return true;
  });

  if (sitesToRun.length === 0) {
    await updateRunState({
      running: false,
      statusText: 'No valid website URLs provided.'
    });
    return;
  }

  if (!targetSiteId) {
    await chrome.storage.local.set({ auditResults: [] });
  }

  await updateRunState({
    running: true,
    progress: 0,
    total: sitesToRun.length,
    statusText: `Opening ${sitesToRun.length} site(s) in parallel for fast loading...`
  });

  // Launch all tabs at once so network loading happens in parallel across all 6 sites
  const openedTabs = await Promise.all(
    sitesToRun.map((site, idx) =>
      chrome.tabs.create({ url: site.url, active: idx === 0 })
    )
  );

  for (let i = 0; i < sitesToRun.length; i++) {
    const { auditRunState } = await chrome.storage.local.get('auditRunState');
    if (auditRunState?.cancelRequested) {
      await updateRunState({
        running: false,
        cancelRequested: false,
        statusText: 'Audit stopped by user.'
      });
      return;
    }

    const site = sitesToRun[i];
    const tab = openedTabs[i];
    try {
      await runSingleSiteOnTab(site, tab.id, config, i + 1, sitesToRun.length);
    } catch (err) {
      await appendAuditResult({
        siteIndex: site.index,
        siteName: site.name,
        stepLabel: 'Error',
        activeQuery: config.userEmail || '',
        filename: '',
        screenshotDataUrl: '',
        details: {
          url: site.url,
          title: site.name,
          emailChecked: config.userEmail || '',
          emailFound: false,
          accessVerdict: `Error: ${err?.message || String(err)}`,
          reportingMatchCount: 0,
          tableauMatchCount: 0,
          extractedRows: []
        }
      });
    }
  }

  await updateRunState({
    running: false,
    progress: sitesToRun.length,
    total: sitesToRun.length,
    statusText: `✅ Done! Captured all screenshots & details. Click "Copy All Screenshots" to paste anywhere!`
  });

  const reportUrl = chrome.runtime.getURL('report/report.html');
  const existingTabs = await chrome.tabs.query({ url: reportUrl });
  if (existingTabs.length > 0) {
    await chrome.tabs.update(existingTabs[0].id, { active: true });
    await chrome.tabs.reload(existingTabs[0].id);
  } else {
    await chrome.tabs.create({ url: reportUrl, active: true });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'GET_DEFAULT_CONFIG') {
        sendResponse({ ok: true, defaultConfig: DEFAULT_CONFIG });
        return;
      }

      if (message.type === 'START_FULL_AUDIT') {
        startAuditWorkflow(message.config, message.targetSiteId || null);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'STOP_AUDIT') {
        await updateRunState({ cancelRequested: true, running: false, statusText: 'Stopping audit...' });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'CAPTURE_CURRENT_TAB_EVIDENCE') {
        const tabId = sender?.tab?.id;
        const windowId = sender?.tab?.windowId;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No sender tab' });
          return;
        }
        const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        const host = new URL(sender.tab.url || 'https://site').hostname;
        const safeStep = (message.stepLabel || 'Manual').replace(/[^a-z0-9]+/gi, '_');
        const filename = `Audit_${host}_${safeStep}_${Date.now()}.png`;

        await appendAuditResult({
          siteIndex: 0,
          siteName: sender.tab.title || host,
          stepLabel: message.stepLabel || 'Manual Capture',
          activeQuery: message.activeQuery || '',
          filename,
          screenshotDataUrl,
          details: message.details || {
            url: sender.tab.url,
            title: sender.tab.title,
            emailChecked: '',
            emailFound: false,
            accessVerdict: 'Manual Evidence Captured',
            reportingMatchCount: 0,
            tableauMatchCount: 0,
            extractedRows: []
          }
        });
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
