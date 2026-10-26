// Terminated User Access Auditor - Content Script
(() => {
  if (window.__tuaContentLoaded) return;
  window.__tuaContentLoaded = true;

  let currentHighlightedElements = [];

  // Create or get the realistic Chrome/Edge Ctrl+F overlay bar
  function getOrCreateCtrlFOverlay() {
    let overlay = document.getElementById('tua-ctrlf-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'tua-ctrlf-overlay';
      overlay.className = 'tua-hidden';
      overlay.innerHTML = `
        <input id="tua-ctrlf-input" type="text" readonly value="" aria-label="Find in page" />
        <span id="tua-ctrlf-count">0/0</span>
        <button class="tua-ctrlf-btn" id="tua-ctrlf-prev" title="Previous match">∧</button>
        <button class="tua-ctrlf-btn" id="tua-ctrlf-next" title="Next match">∨</button>
        <button class="tua-ctrlf-btn" id="tua-ctrlf-close" title="Close find bar">✕</button>
      `;
      document.documentElement.appendChild(overlay);
      const closeBtn = overlay.querySelector('#tua-ctrlf-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          clearCtrlFHighlights();
          overlay.classList.add('tua-hidden');
        });
      }
    }
    return overlay;
  }

  // Clear previous highlights in batches
  function clearCtrlFHighlights() {
    for (const el of currentHighlightedElements) {
      try {
        el.classList.remove('tua-highlight-box');
      } catch (_) {}
    }
    currentHighlightedElements = [];
  }

  // Check if an element is visible and not part of our own UI
  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.closest('#tua-ctrlf-overlay') || el.closest('#tua-helper-bar')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Set value on React / Angular / Vue / FluentUI controlled input
  function setNativeInputValue(inputEl, value) {
    inputEl.focus();
    const proto = inputEl instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Trigger Enter key and optional search button click
  function triggerSearchSubmit(inputEl) {
    const enterEvents = ['keydown', 'keypress', 'keyup'];
    for (const evtType of enterEvents) {
      inputEl.dispatchEvent(new KeyboardEvent(evtType, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
    }

    // Check if inside a form or next to a search button
    const form = inputEl.closest('form');
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="search" i], button[title*="search" i]');
      if (submitBtn && isElementVisible(submitBtn)) {
        submitBtn.click();
        return;
      }
    }

    // Check nearby sibling/parent search button
    const container = inputEl.parentElement?.parentElement || inputEl.parentElement;
    if (container) {
      const buttons = Array.from(container.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
      for (const btn of buttons) {
        if (!isElementVisible(btn)) continue;
        const label = ((btn.innerText || '') + ' ' + (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '')).toLowerCase();
        if ((label.includes('search') || label.includes('find') || label.includes('filter') || label.includes('go') || label.includes('lookup')) &&
            !label.includes('clear') && !label.includes('cancel') && !label.includes('close') && !label.includes('reset')) {
          btn.click();
          break;
        }
      }
    }
  }

  // Score candidate input elements to find the best Email / User search box
  function findBestUserOrEmailInput() {
    const candidates = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="password"]), [ role="searchbox" ], [ contenteditable="true" ]'
    )).filter(el => isElementVisible(el) && el.id !== 'tua-ctrlf-input');

    let bestEl = null;
    let bestScore = -1;

    for (const el of candidates) {
      let score = 0;
      const type = (el.getAttribute('type') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      const id = (el.getAttribute('id') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      const combined = `${type} ${placeholder} ${ariaLabel} ${name} ${id} ${role} ${cls}`;

      if (type === 'search' || role === 'searchbox') score += 35;
      if (type === 'email') score += 45;
      if (combined.includes('email')) score += 50;
      if (combined.includes('user')) score += 45;
      if (combined.includes('person') || combined.includes('member') || combined.includes('account') || combined.includes('employee')) score += 40;
      if (combined.includes('search') || combined.includes('filter') || combined.includes('find') || combined.includes('lookup') || combined.includes('query')) score += 35;
      if (combined.includes('ms-searchbox')) score += 45; // M365 Admin Center

      // Prefer inputs in the top half of the page
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 500) score += 15;
      if (rect.width >= 140) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    return bestEl;
  }

  // Step helper: Locate Email / User box and paste email
  async function locateAndPasteEmail(email) {
    if (!email) return { foundInput: false, message: 'No email provided' };

    // On M365 Admin Center or SPAs, sometimes the search box is collapsed behind a search button
    let inputEl = findBestUserOrEmailInput();
    if (!inputEl) {
      const searchTriggers = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(el => {
        if (!isElementVisible(el)) return false;
        const txt = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
        return txt.includes('search') || txt.includes('filter') || txt.includes('find user');
      });
      if (searchTriggers.length > 0) {
        searchTriggers[0].click();
        await new Promise(r => setTimeout(r, 600));
        inputEl = findBestUserOrEmailInput();
      }
    }

    if (!inputEl) {
      // Fallback: perform Ctrl+F with the email so the page is still searched
      const ctrlFRes = await performCtrlFSearch(email, true);
      return {
        foundInput: false,
        usedCtrlFFallback: true,
        matchCount: ctrlFRes.matchCount,
        message: 'No input box found; searched email via Ctrl+F'
      };
    }

    inputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    clearCtrlFHighlights();
    inputEl.classList.add('tua-highlight-box');
    currentHighlightedElements.push(inputEl);

    setNativeInputValue(inputEl, email);
    await new Promise(r => setTimeout(r, 250));
    triggerSearchSubmit(inputEl);

    return {
      foundInput: true,
      inputDescriptor: inputEl.getAttribute('placeholder') || inputEl.getAttribute('aria-label') || inputEl.getAttribute('name') || inputEl.tagName,
      message: `Pasted "${email}" into search input and triggered search`
    };
  }

  // Step helper for Sites 1 & 2: Click the searched user row (if needed) and navigate to the "Groups" tab
  async function openUserAndNavigateToGroupsTab(email) {
    const emailLower = (email || '').toLowerCase().trim();
    const userPrefix = emailLower.split('@')[0] || emailLower;
    let clickedUser = false;
    let clickedGroupsTab = false;

    // 1. Check if a Groups tab is ALREADY visible on the page; if not, try clicking the user result row first
    const findGroupsTabElement = () => {
      const tabCandidates = Array.from(document.querySelectorAll(
        '[role="tab"], button, a, [role="button"], [role="menuitem"], .ms-Pivot-link, nav a, ul li a, span'
      )).filter(isElementVisible);

      for (const el of tabCandidates) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (
          text === 'groups' ||
          text === 'group memberships' ||
          text === 'teams' ||
          text === 'roles & groups' ||
          text === 'user groups' ||
          text === 'memberships' ||
          text === 'permissions' ||
          aria === 'groups' ||
          /^groups\s*\(\d+\)$/i.test(text) ||
          /^teams\s*\(\d+\)$/i.test(text)
        ) {
          return el;
        }
      }
      return null;
    };

    let groupsTabEl = findGroupsTabElement();

    if (!groupsTabEl && emailLower) {
      // Try finding the user row/link in the search results table to open their profile/flyout
      const rowCandidates = Array.from(document.querySelectorAll(
        'tr a, [role="row"] a, [role="row"] [role="gridcell"], [role="listitem"] a, a[href*="user" i], .ms-DetailsRow, td a, td span'
      )).filter(isElementVisible);

      for (const el of rowCandidates) {
        const txt = (el.innerText || el.textContent || '').toLowerCase();
        if (txt.includes(emailLower) || (userPrefix.length >= 3 && txt.includes(userPrefix))) {
          el.click();
          clickedUser = true;
          await new Promise(r => setTimeout(r, 1800));
          break;
        }
      }
      groupsTabEl = findGroupsTabElement();
    }

    if (groupsTabEl) {
      groupsTabEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      groupsTabEl.click();
      clickedGroupsTab = true;
      await new Promise(r => setTimeout(r, 1500));
    }

    return {
      clickedUser,
      clickedGroupsTab,
      groupsTabLabel: groupsTabEl ? (groupsTabEl.innerText || 'Groups').trim() : null
    };
  }

  // Perform Ctrl+F search, highlight matching elements in batches (non-blocking), and show Ctrl+F bar
  async function performCtrlFSearch(query, showOverlay = true) {
    const cleanQuery = (query || '').trim();
    const overlay = getOrCreateCtrlFOverlay();
    const input = overlay.querySelector('#tua-ctrlf-input');
    const countSpan = overlay.querySelector('#tua-ctrlf-count');

    clearCtrlFHighlights();

    if (!cleanQuery) {
      overlay.classList.add('tua-hidden');
      return { query: '', matchCount: 0, matchedSnippets: [] };
    }

    // If on Google Sheets, also populate Google Sheets' own Find bar if present or openable
    if (location.hostname.includes('docs.google.com') && location.pathname.includes('/spreadsheets')) {
      try {
        let gsFindInput = document.querySelector('.docs-findinput-input');
        if (!gsFindInput) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'f',
            code: 'KeyF',
            keyCode: 70,
            ctrlKey: true,
            bubbles: true
          }));
          await new Promise(r => setTimeout(r, 350));
          gsFindInput = document.querySelector('.docs-findinput-input');
        }
        if (gsFindInput && isElementVisible(gsFindInput)) {
          setNativeInputValue(gsFindInput, cleanQuery);
          triggerSearchSubmit(gsFindInput);
        }
      } catch (_) {}
    }

    const qLower = cleanQuery.toLowerCase();
    const allElements = Array.from(document.body ? document.body.querySelectorAll('*') : []);
    const matchedElements = [];
    const matchedSnippets = [];

    // Batch DOM inspection with requestAnimationFrame to avoid blocking main thread
    const BATCH_SIZE = 250;
    for (let i = 0; i < allElements.length; i += BATCH_SIZE) {
      await new Promise(resolve => requestAnimationFrame(() => {
        const slice = allElements.slice(i, i + BATCH_SIZE);
        for (const el of slice) {
          if (!isElementVisible(el)) continue;
          const tag = el.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'PATH') continue;

          // Check input values as well as leaf-ish text nodes
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            if ((el.value || '').toLowerCase().includes(qLower)) {
              matchedElements.push(el);
              if (matchedSnippets.length < 10) {
                matchedSnippets.push(`Input value: ${el.value.trim().slice(0, 120)}`);
              }
            }
            continue;
          }

          // Check direct text content of leaf or near-leaf elements
          let hasDirectMatch = false;
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && (child.nodeValue || '').toLowerCase().includes(qLower)) {
              hasDirectMatch = true;
              break;
            }
          }
          if (hasDirectMatch) {
            matchedElements.push(el);
            const rowContext = el.closest('tr, [role="row"], [role="listitem"], li, .ms-DetailsRow') || el;
            const snippet = (rowContext.innerText || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (snippet && !matchedSnippets.includes(snippet) && matchedSnippets.length < 10) {
              matchedSnippets.push(snippet);
            }
          }
        }
        resolve();
      }));
    }

    // Highlight matched elements in batches
    const HIGHLIGHT_BATCH = 25;
    for (let i = 0; i < matchedElements.length; i += HIGHLIGHT_BATCH) {
      await new Promise(resolve => requestAnimationFrame(() => {
        matchedElements.slice(i, i + HIGHLIGHT_BATCH).forEach(el => {
          el.classList.add('tua-highlight-box');
          currentHighlightedElements.push(el);
        });
        resolve();
      }));
    }

    if (matchedElements.length > 0) {
      try {
        matchedElements[0].scrollIntoView({ behavior: 'instant', block: 'center' });
      } catch (_) {}
    }

    if (showOverlay) {
      overlay.classList.remove('tua-hidden');
      if (input) input.value = cleanQuery;
      if (countSpan) {
        if (matchedElements.length > 0) {
          countSpan.textContent = `1/${matchedElements.length}`;
          countSpan.classList.remove('tua-no-match');
        } else {
          countSpan.textContent = '0/0';
          countSpan.classList.add('tua-no-match');
        }
      }
    }

    return {
      query: cleanQuery,
      matchCount: matchedElements.length,
      matchedSnippets
    };
  }

  // Gather comprehensive site audit details from the current page DOM
  function gatherSiteDetails(email) {
    const bodyText = (document.body?.innerText || '');
    const bodyLower = bodyText.toLowerCase();
    const emailClean = (email || '').trim().toLowerCase();
    const emailPrefix = emailClean.split('@')[0] || '';

    // Count occurrences of email (excluding our own helper UI)
    const cleanTextWithoutHelper = bodyText
      .replace(/Terminated Access Auditor[\s\S]*$/i, '')
      .toLowerCase();

    const emailFound = emailClean
      ? cleanTextWithoutHelper.includes(emailClean)
      : false;

    const reportingMatches = (cleanTextWithoutHelper.match(/reporting/gi) || []).length;
    const tableauMatches = (cleanTextWithoutHelper.match(/tableau/gi) || []).length;

    // Detect status phrases on page
    const noResultPatterns = [
      'no results',
      'no users found',
      'no matching',
      '0 users',
      '0 results',
      'user not found',
      'no items found',
      'we couldn\'t find',
      'nothing found',
      'no records found',
      'no people found',
      'no data available'
    ];
    const disabledPatterns = [
      'disabled',
      'deactivated',
      'suspended',
      'inactive',
      'blocked',
      'terminated',
      'sign-in blocked',
      'unlicensed',
      'deleted'
    ];

    let hasNoResultsText = noResultPatterns.some(p => bodyLower.includes(p));
    let matchedDisabledTerms = disabledPatterns.filter(p => bodyLower.includes(p));

    let accessVerdict = 'No User Found / Access Revoked';
    if (hasNoResultsText) {
      accessVerdict = 'No Matching User Found (Verified Terminated)';
    } else if (emailFound && matchedDisabledTerms.length > 0) {
      accessVerdict = `User Found (${matchedDisabledTerms.slice(0, 2).join(', ')})`;
    } else if (emailFound) {
      accessVerdict = 'User Record Found on Page — Review Screenshot';
    }

    // Extract meaningful table rows / list items mentioning the user, groups, reporting, tableau, or status
    const extractedRows = [];
    const rowEls = Array.from(document.querySelectorAll('tr, [role="row"], [role="listitem"], .ms-DetailsRow, li'));
    for (const r of rowEls) {
      if (!isElementVisible(r)) continue;
      const txt = (r.innerText || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length < 4 || txt.length > 300) continue;
      const lower = txt.toLowerCase();
      if (
        (emailClean && lower.includes(emailClean)) ||
        (emailPrefix.length >= 3 && lower.includes(emailPrefix)) ||
        lower.includes('reporting') ||
        lower.includes('tableau') ||
        lower.includes('no results') ||
        lower.includes('no users') ||
        lower.includes('group') ||
        lower.includes('active') ||
        lower.includes('disabled')
      ) {
        if (!extractedRows.includes(txt) && extractedRows.length < 12) {
          extractedRows.push(txt);
        }
      }
    }

    return {
      url: window.location.href,
      title: document.title || window.location.hostname,
      hostname: window.location.hostname,
      timestamp: new Date().toISOString(),
      emailChecked: email,
      emailFound,
      accessVerdict,
      reportingMatchCount: reportingMatches,
      tableauMatchCount: tableauMatches,
      extractedRows
    };
  }

  // Render in-page floating helper bar for one-click manual/semi-automated actions
  async function initFloatingHelperBar() {
    const { auditConfig, showHelperBar = true } = await chrome.storage.local.get(['auditConfig', 'showHelperBar']);
    if (!showHelperBar || !auditConfig?.userEmail) return;

    if (document.getElementById('tua-helper-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'tua-helper-bar';
    bar.innerHTML = `
      <span class="tua-helper-title">🛡️ Access Auditor (${auditConfig.userEmail})</span>
      <button class="tua-helper-action" data-act="paste-email">1. Paste Email</button>
      <button class="tua-helper-action" data-act="groups-tab">2. Groups Tab</button>
      <button class="tua-helper-action tua-primary" data-act="ctrlf-reporting">Ctrl+F "reporting" + 📸</button>
      <button class="tua-helper-action tua-primary" data-act="ctrlf-tableau">Ctrl+F "tableau" + 📸</button>
      <button class="tua-helper-action" data-act="ctrlf-email">Ctrl+F Email + 📸</button>
      <button class="tua-helper-action" data-act="snap-only">📸 Screenshot</button>
      <button class="tua-helper-action" data-act="close-bar" title="Hide bar">✕</button>
      <span class="tua-helper-status" id="tua-helper-status"></span>
    `;
    document.documentElement.appendChild(bar);

    const statusEl = bar.querySelector('#tua-helper-status');
    const setStatus = (msg) => {
      if (statusEl) statusEl.textContent = msg;
    };

    bar.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const { auditConfig: latestCfg } = await chrome.storage.local.get('auditConfig');
      const email = latestCfg?.userEmail || auditConfig.userEmail || '';

      if (act === 'close-bar') {
        bar.remove();
        return;
      }
      if (act === 'paste-email') {
        const res = await locateAndPasteEmail(email);
        setStatus(res.message);
      } else if (act === 'groups-tab') {
        const res = await openUserAndNavigateToGroupsTab(email);
        setStatus(res.clickedGroupsTab ? `Opened ${res.groupsTabLabel}` : 'Groups tab not found on current view');
      } else if (act === 'ctrlf-reporting') {
        await performCtrlFSearch('reporting', true);
        setStatus('Capturing "reporting"...');
        await requestBackgroundScreenshot('Ctrl+F reporting', email, 'reporting');
        setStatus('Saved "reporting" screenshot!');
      } else if (act === 'ctrlf-tableau') {
        await performCtrlFSearch('tableau', true);
        setStatus('Capturing "tableau"...');
        await requestBackgroundScreenshot('Ctrl+F tableau', email, 'tableau');
        setStatus('Saved "tableau" screenshot!');
      } else if (act === 'ctrlf-email') {
        await performCtrlFSearch(email, true);
        setStatus('Capturing Email Ctrl+F...');
        await requestBackgroundScreenshot(`Ctrl+F ${email}`, email, email);
        setStatus('Saved Email screenshot!');
      } else if (act === 'snap-only') {
        setStatus('Capturing screenshot...');
        await requestBackgroundScreenshot('Manual Screenshot', email, '');
        setStatus('Screenshot saved!');
      }
    });
  }

  async function requestBackgroundScreenshot(stepLabel, email, activeQuery) {
    const bar = document.getElementById('tua-helper-bar');
    if (bar) bar.classList.add('tua-screenshot-hide');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const details = gatherSiteDetails(email);
    await chrome.runtime.sendMessage({
      type: 'CAPTURE_CURRENT_TAB_EVIDENCE',
      stepLabel,
      activeQuery,
      details
    });
    if (bar) bar.classList.remove('tua-screenshot-hide');
  }

  // Listen for automation commands from Service Worker or Popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === 'PING_CONTENT') {
          sendResponse({ ok: true, url: location.href, title: document.title });
          return;
        }

        if (message.type === 'LOCATE_AND_PASTE_EMAIL') {
          await initFloatingHelperBar();
          const res = await locateAndPasteEmail(message.email);
          sendResponse({ ok: true, ...res });
          return;
        }

        if (message.type === 'OPEN_USER_AND_GROUPS_TAB') {
          const res = await openUserAndNavigateToGroupsTab(message.email);
          sendResponse({ ok: true, ...res });
          return;
        }

        if (message.type === 'RUN_CTRLF_SEARCH') {
          await initFloatingHelperBar();
          const res = await performCtrlFSearch(message.query, message.showOverlay !== false);
          sendResponse({ ok: true, ...res });
          return;
        }

        if (message.type === 'PREPARE_FOR_SCREENSHOT') {
          const bar = document.getElementById('tua-helper-bar');
          if (bar) bar.classList.add('tua-screenshot-hide');
          if (message.hideCtrlFOverlay) {
            const overlay = document.getElementById('tua-ctrlf-overlay');
            if (overlay) overlay.classList.add('tua-hidden');
          }
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const details = gatherSiteDetails(message.email || '');
          sendResponse({ ok: true, details });
          return;
        }

        if (message.type === 'RESTORE_AFTER_SCREENSHOT') {
          const bar = document.getElementById('tua-helper-bar');
          if (bar) bar.classList.remove('tua-screenshot-hide');
          sendResponse({ ok: true });
          return;
        }

        if (message.type === 'GATHER_SITE_DETAILS') {
          const details = gatherSiteDetails(message.email || '');
          sendResponse({ ok: true, details });
          return;
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  });

  // Initialize helper bar if an audit is configured
  initFloatingHelperBar().catch(() => {});
})();
