// Terminated User Access Auditor - Fast & Accurate Content Script
(() => {
  if (window.__tuaContentLoaded) return;
  window.__tuaContentLoaded = true;

  let currentHighlightedElements = [];

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

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

  function clearCtrlFHighlights() {
    for (const el of currentHighlightedElements) {
      try {
        el.classList.remove('tua-highlight-box');
      } catch (_) {}
    }
    currentHighlightedElements = [];
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.closest('#tua-ctrlf-overlay') || el.closest('#tua-helper-bar')) return false;
    if (el.disabled || el.readOnly) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 30 && rect.height > 12;
  }

  // Check if an input is inside a global top navigation bar or sidebar (which should NOT be used for user table search)
  function isGlobalHeaderOrSidebarInput(el) {
    const rect = el.getBoundingClientRect();
    const ancestor = el.closest(
      'header, nav, aside, [role="banner"], [role="navigation"], ' +
      '[class*="navbar" i], [class*="topnav" i], [class*="global-search" i], [class*="globalsearch" i], ' +
      '[class*="app-header" i], [class*="site-header" i], [class*="sidebar" i], [class*="left-nav" i], ' +
      '#O365_Header, #O365_SearchBoxContainer, #O365_TopMenu'
    );
    if (ancestor) return true;

    const attrs = (
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '') + ' ' +
      (el.getAttribute('name') || '') + ' ' +
      (el.getAttribute('id') || '') + ' ' +
      (el.className || '')
    ).toLowerCase();

    // Reject inputs meant for searching documents, templates, help articles, or global navigation
    const rejectWords = [
      'search documents',
      'search templates',
      'search help',
      'search all',
      'global search',
      'jump to',
      'command',
      'search integrations',
      'search services',
      'search incidents'
    ];
    if (rejectWords.some(w => attrs.includes(w))) return true;

    // In PagerDuty, Lucidchart, and M365, the top 62px is the global suite/app bar
    if (rect.top < 62 && !attrs.includes('user') && !attrs.includes('email') && !attrs.includes('person')) {
      return true;
    }

    return false;
  }

  // Set value on React / Angular / Vue / Ember / FluentUI controlled input
  function setNativeInputValue(inputEl, value) {
    inputEl.focus();
    inputEl.click();

    const proto = inputEl instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(inputEl, '');
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }

    inputEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || 'm', bubbles: true }));
  }

  // Trigger Enter key and search button click
  function triggerSearchSubmit(inputEl) {
    const enterOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    inputEl.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    // Check if inside a form with a submit/search button
    const form = inputEl.closest('form');
    if (form) {
      const submitBtn = form.querySelector(
        'button[type="submit"], input[type="submit"], button[aria-label*="search" i], button[title*="search" i], .search-button, [class*="search-btn" i]'
      );
      if (submitBtn && isElementVisible(submitBtn)) {
        submitBtn.click();
        return;
      }
    }

    // Check immediate sibling/parent container for a Search / Filter icon button (e.g., PagerDuty & Bigstock)
    const container = inputEl.parentElement?.parentElement || inputEl.parentElement;
    if (container) {
      const buttons = Array.from(container.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn'));
      for (const btn of buttons) {
        if (!isElementVisible(btn)) continue;
        const label = (
          (btn.innerText || '') + ' ' +
          (btn.getAttribute('aria-label') || '') + ' ' +
          (btn.getAttribute('title') || '') + ' ' +
          (btn.className || '')
        ).toLowerCase();
        if (
          (label.includes('search') || label.includes('find') || label.includes('filter') || label.includes('go') || label.includes('lookup') || label.includes('submit')) &&
          !label.includes('clear') && !label.includes('cancel') && !label.includes('close') && !label.includes('reset') && !label.includes('add') && !label.includes('invite')
        ) {
          btn.click();
          break;
        }
      }
    }
  }

  // Site-aware + Universal User/Email search input finder
  function findBestUserOrEmailInput() {
    const host = location.hostname.toLowerCase();
    const allInputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="password"]):not([type="submit"]):not([type="button"]), [role="searchbox"]'
    )).filter(el => isElementVisible(el) && el.id !== 'tua-ctrlf-input');

    if (allInputs.length === 0) return null;

    // 1. PagerDuty-specific priority: Users page search bar inside main page body (never top navbar)
    if (host.includes('pagerduty.com')) {
      const pdCandidates = allInputs.filter(el => !isGlobalHeaderOrSidebarInput(el));
      for (const el of pdCandidates) {
        const attr = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
        if (attr.includes('user') || attr.includes('email') || attr.includes('name') || attr.includes('filter') || attr.includes('search') || attr.includes('query')) {
          return el;
        }
      }
      if (pdCandidates.length > 0) return pdCandidates[0];
    }

    // 2. Lucidchart-specific priority: Users list search box inside main admin workspace (never sidebar/document search)
    if (host.includes('lucid.app') || host.includes('lucidchart.com')) {
      const lucidCandidates = allInputs.filter(el => {
        if (isGlobalHeaderOrSidebarInput(el)) return false;
        const rect = el.getBoundingClientRect();
        // In Lucidchart Admin, the left navigation sidebar is ~200px wide and top bar is ~64px high
        return rect.top >= 60 && rect.left >= 150;
      });
      for (const el of lucidCandidates) {
        const attr = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.className || '')).toLowerCase();
        if (attr.includes('user') || attr.includes('email') || attr.includes('name') || attr.includes('member') || attr.includes('search') || attr.includes('filter')) {
          return el;
        }
      }
      if (lucidCandidates.length > 0) return lucidCandidates[0];
    }

    // 3. M365 Admin Center priority: Active users search box (never top O365 suite bar)
    if (host.includes('microsoft.com')) {
      const m365Candidates = allInputs.filter(el => !isGlobalHeaderOrSidebarInput(el) && el.getBoundingClientRect().top >= 65);
      for (const el of m365Candidates) {
        const attr = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-automation-id') || '') + ' ' + (el.className || '')).toLowerCase();
        if (attr.includes('active user') || attr.includes('user') || attr.includes('search') || attr.includes('ms-searchbox')) {
          return el;
        }
      }
      if (m365Candidates.length > 0) return m365Candidates[0];
    }

    // 4. General scoring across all websites (Shutterstock, Bigstock, PagerDuty, Lucidchart, M365, etc.)
    let bestEl = null;
    let bestScore = -9999;

    for (const el of allInputs) {
      let score = 0;
      const rect = el.getBoundingClientRect();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      const id = (el.getAttribute('id') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      const combined = `${type} ${placeholder} ${ariaLabel} ${name} ${id} ${role} ${cls}`;

      // Heavily penalize global navbar / header / sidebar inputs
      if (isGlobalHeaderOrSidebarInput(el)) {
        score -= 250;
      }

      // Strongly reward being inside <main> or [role="main"] or a user/table section
      if (el.closest('main, [role="main"], #main, #content, [class*="user" i], [class*="person" i], [class*="member" i], [class*="table" i], [class*="directory" i]')) {
        score += 65;
      }

      if (combined.includes('active user') || combined.includes('active users') || combined.includes('search users') || combined.includes('filter users')) score += 90;
      if (combined.includes('name or email') || combined.includes('user or email')) score += 85;
      if (combined.includes('email')) score += 70;
      if (combined.includes('user') || combined.includes('person') || combined.includes('member') || combined.includes('employee')) score += 65;
      if (combined.includes('search') || combined.includes('filter') || combined.includes('find') || combined.includes('lookup') || combined.includes('query')) score += 40;
      if (type === 'search' || role === 'searchbox') score += 30;
      if (type === 'email') score += 45;

      // Prefer inputs located in the main content band (top: 68px to 550px, left >= 100px)
      if (rect.top >= 68 && rect.top <= 550) score += 35;
      if (rect.left >= 140) score += 15;
      if (rect.width >= 160) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    return bestEl;
  }

  // Poll quickly (every 120ms) for the search input so we act IMMEDIATELY as soon as the site renders
  async function waitForUserSearchInput(maxWaitMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const inputEl = findBestUserOrEmailInput();
      if (inputEl) return inputEl;
      await sleep(120);
    }
    return findBestUserOrEmailInput();
  }

  // Locate Email / Active User box and paste email immediately
  async function locateAndPasteEmail(email) {
    if (!email) return { foundInput: false, message: 'No email provided' };

    let inputEl = await waitForUserSearchInput(3200);

    if (!inputEl) {
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
    await sleep(120);
    triggerSearchSubmit(inputEl);

    return {
      foundInput: true,
      inputDescriptor: inputEl.getAttribute('placeholder') || inputEl.getAttribute('aria-label') || inputEl.getAttribute('name') || inputEl.tagName,
      message: `Pasted "${email}" into search input and triggered search`
    };
  }

  // Open User Profile & Click "Groups" Tab (for Shutterstock Inc Person)
  async function openUserAndNavigateToGroupsTab(email) {
    const emailLower = (email || '').toLowerCase().trim();
    const userPrefix = emailLower.split('@')[0] || emailLower;
    let clickedUser = false;
    let clickedGroupsTab = false;

    const findGroupsTabElement = () => {
      const tabCandidates = Array.from(document.querySelectorAll(
        '[role="tab"], button, a, [role="button"], [role="menuitem"], .ms-Pivot-link, nav a, ul li a, span'
      )).filter(isElementVisible);

      for (const el of tabCandidates) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const href = (el.getAttribute('href') || '').trim().toLowerCase();
        if (
          text === 'groups' ||
          text === 'group' ||
          text === 'group memberships' ||
          text === 'teams' ||
          text === 'roles & groups' ||
          text === 'user groups' ||
          text === 'memberships' ||
          aria === 'groups' ||
          href.endsWith('#groups') ||
          href.includes('/groups') ||
          /^groups\s*\(\d+\)$/i.test(text)
        ) {
          return el;
        }
      }
      return null;
    };

    let groupsTabEl = findGroupsTabElement();

    if (!groupsTabEl && emailLower) {
      const rowCandidates = Array.from(document.querySelectorAll(
        'tr a, [role="row"] a, [role="row"] [role="gridcell"], [role="listitem"] a, a[href*="person" i], a[href*="user" i], .ms-DetailsRow, td a, td span'
      )).filter(isElementVisible);

      for (const el of rowCandidates) {
        const txt = (el.innerText || el.textContent || '').toLowerCase();
        if (txt.includes(emailLower) || (userPrefix.length >= 3 && txt.includes(userPrefix))) {
          el.click();
          clickedUser = true;
          await sleep(900);
          break;
        }
      }
      groupsTabEl = findGroupsTabElement();
    }

    if (groupsTabEl) {
      groupsTabEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      groupsTabEl.click();
      clickedGroupsTab = true;
      await sleep(700);
    }

    return {
      clickedUser,
      clickedGroupsTab,
      groupsTabLabel: groupsTabEl ? (groupsTabEl.innerText || 'Groups').trim() : null
    };
  }

  // Fast Ctrl+F search + highlight + overlay
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

    // If on Google Sheets, trigger Google Sheets' native Ctrl+F bar immediately
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
          await sleep(180);
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

    const BATCH_SIZE = 450;
    for (let i = 0; i < allElements.length; i += BATCH_SIZE) {
      await new Promise(resolve => requestAnimationFrame(() => {
        const slice = allElements.slice(i, i + BATCH_SIZE);
        for (const el of slice) {
          if (!isElementVisible(el)) continue;
          const tag = el.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'PATH') continue;

          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            if ((el.value || '').toLowerCase().includes(qLower)) {
              matchedElements.push(el);
            }
            continue;
          }

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

    const HIGHLIGHT_BATCH = 40;
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

  function gatherSiteDetails(email) {
    const bodyText = (document.body?.innerText || '');
    const bodyLower = bodyText.toLowerCase();
    const emailClean = (email || '').trim().toLowerCase();
    const emailPrefix = emailClean.split('@')[0] || '';

    const cleanTextWithoutHelper = bodyText
      .replace(/Access Auditor[\s\S]*$/i, '')
      .toLowerCase();

    const emailFound = emailClean
      ? cleanTextWithoutHelper.includes(emailClean)
      : false;

    const reportingMatches = (cleanTextWithoutHelper.match(/reporting/gi) || []).length;
    const tableauMatches = (cleanTextWithoutHelper.match(/tableau/gi) || []).length;

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

    const hasNoResultsText = noResultPatterns.some(p => bodyLower.includes(p));
    const matchedDisabledTerms = disabledPatterns.filter(p => bodyLower.includes(p));

    let accessVerdict = 'No User Found / Access Revoked';
    if (hasNoResultsText) {
      accessVerdict = 'No Matching User Found (Verified Terminated)';
    } else if (emailFound && matchedDisabledTerms.length > 0) {
      accessVerdict = `User Found (${matchedDisabledTerms.slice(0, 2).join(', ')})`;
    } else if (emailFound) {
      accessVerdict = 'User Record Found on Page — Review Screenshot';
    }

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
        setStatus(res.clickedGroupsTab ? `Opened ${res.groupsTabLabel}` : 'Groups tab not found');
      } else if (act === 'ctrlf-reporting') {
        await performCtrlFSearch('reporting', true);
        await requestBackgroundScreenshot('Ctrl+F reporting', email, 'reporting');
        setStatus('Saved "reporting" screenshot!');
      } else if (act === 'ctrlf-tableau') {
        await performCtrlFSearch('tableau', true);
        await requestBackgroundScreenshot('Ctrl+F tableau', email, 'tableau');
        setStatus('Saved "tableau" screenshot!');
      } else if (act === 'ctrlf-email') {
        await performCtrlFSearch(email, true);
        await requestBackgroundScreenshot(`Ctrl+F ${email}`, email, email);
        setStatus('Saved Email screenshot!');
      } else if (act === 'snap-only') {
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === 'PING_CONTENT') {
          sendResponse({ ok: true, url: location.href, title: document.title });
          return;
        }

        if (message.type === 'LOCATE_AND_PASTE_EMAIL') {
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

  initFloatingHelperBar().catch(() => {});
})();
