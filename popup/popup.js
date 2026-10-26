// Terminated User Access Auditor - Popup & Side Panel Logic

const userEmailInput = document.getElementById('userEmailInput');
const keyword1Input = document.getElementById('keyword1Input');
const keyword2Input = document.getElementById('keyword2Input');
const waitSecInput = document.getElementById('waitSecInput');
const autoDownloadCheck = document.getElementById('autoDownloadCheck');
const sitesListContainer = document.getElementById('sitesListContainer');
const saveLinksBtn = document.getElementById('saveLinksBtn');
const runAllBtn = document.getElementById('runAllBtn');
const stopBtn = document.getElementById('stopBtn');
const openSidePanelBtn = document.getElementById('openSidePanelBtn');
const openReportBtn = document.getElementById('openReportBtn');
const shotCountBadge = document.getElementById('shotCountBadge');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');

let currentConfig = null;

function renderSitesList(sites) {
  sitesListContainer.innerHTML = '';
  sites.forEach((site, idx) => {
    const item = document.createElement('div');
    item.className = 'site-item';
    item.dataset.siteId = site.id;

    item.innerHTML = `
      <div class="site-top-row">
        <span class="site-badge">${idx + 1}. ${escapeHtml(site.name)}</span>
        <select class="site-mode-select" data-field="mode" data-idx="${idx}">
          <option value="user_groups_ctrlf" ${site.mode === 'user_groups_ctrlf' ? 'selected' : ''}>
            Search User → Groups Tab → Ctrl+F "reporting" & "tableau"
          </option>
          <option value="email_search" ${site.mode === 'email_search' ? 'selected' : ''}>
            Locate Email/Users Box → Paste Email & Screenshot
          </option>
          <option value="ctrlf_sheet" ${site.mode === 'ctrlf_sheet' ? 'selected' : ''}>
            Ctrl+F Search (Google Sheet / Page) & Screenshot
          </option>
        </select>
      </div>
      <div class="site-url-row">
        <input
          type="url"
          class="site-url-input"
          data-field="url"
          data-idx="${idx}"
          placeholder="Paste link for ${escapeHtml(site.name)}..."
          value="${escapeHtml(site.url || '')}"
        />
        <button class="btn-run-one" data-run-id="${site.id}" title="Run only ${escapeHtml(site.name)}">▶ Run</button>
      </div>
    `;
    sitesListContainer.appendChild(item);
  });

  // Attach change & run listeners
  sitesListContainer.querySelectorAll('input[data-field], select[data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      await collectAndSaveConfig(false);
    });
  });

  sitesListContainer.querySelectorAll('button[data-run-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const siteId = btn.getAttribute('data-run-id');
      const cfg = await collectAndSaveConfig(false);
      await chrome.runtime.sendMessage({
        type: 'START_FULL_AUDIT',
        config: cfg,
        targetSiteId: siteId
      });
    });
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function collectAndSaveConfig(showFeedback = true) {
  const updatedSites = (currentConfig?.sites || []).map((s, idx) => {
    const urlInput = sitesListContainer.querySelector(`input[data-field="url"][data-idx="${idx}"]`);
    const modeSelect = sitesListContainer.querySelector(`select[data-field="mode"][data-idx="${idx}"]`);
    return {
      ...s,
      url: urlInput ? urlInput.value.trim() : s.url,
      mode: modeSelect ? modeSelect.value : s.mode
    };
  });

  const nextConfig = {
    userEmail: userEmailInput.value.trim(),
    keyword1: keyword1Input.value.trim() || 'reporting',
    keyword2: keyword2Input.value.trim() || 'tableau',
    pageLoadWaitSec: Math.max(2, Number(waitSecInput.value) || 5),
    autoDownloadScreenshots: autoDownloadCheck.checked,
    sites: updatedSites
  };

  currentConfig = nextConfig;
  await chrome.storage.local.set({ auditConfig: nextConfig });

  if (showFeedback) {
    statusText.textContent = 'Saved email & 6 website links!';
  }
  return nextConfig;
}

async function refreshUIFromStorage() {
  const { auditConfig, auditRunState, auditResults = [] } = await chrome.storage.local.get([
    'auditConfig',
    'auditRunState',
    'auditResults'
  ]);

  if (!auditConfig) {
    const res = await chrome.runtime.sendMessage({ type: 'GET_DEFAULT_CONFIG' });
    currentConfig = res?.defaultConfig;
  } else {
    currentConfig = auditConfig;
  }

  if (currentConfig) {
    userEmailInput.value = currentConfig.userEmail || '';
    keyword1Input.value = currentConfig.keyword1 || 'reporting';
    keyword2Input.value = currentConfig.keyword2 || 'tableau';
    waitSecInput.value = currentConfig.pageLoadWaitSec || 5;
    autoDownloadCheck.checked = Boolean(currentConfig.autoDownloadScreenshots);
    renderSitesList(currentConfig.sites || []);
  }

  shotCountBadge.textContent = String(auditResults.length);
  applyRunState(auditRunState);
}

function applyRunState(runState) {
  if (!runState) return;
  statusText.textContent = runState.statusText || 'Ready';
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

// Event Listeners
[userEmailInput, keyword1Input, keyword2Input, waitSecInput, autoDownloadCheck].forEach(el => {
  el.addEventListener('change', () => collectAndSaveConfig(false));
});

saveLinksBtn.addEventListener('click', () => collectAndSaveConfig(true));

runAllBtn.addEventListener('click', async () => {
  const cfg = await collectAndSaveConfig(false);
  if (!cfg.userEmail) {
    statusText.textContent = '⚠️ Please enter the Terminated User Email first.';
    userEmailInput.focus();
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
