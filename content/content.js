// Terminated User Access Auditor - Precision Site-Aware Content Script
(() => {
  if (window.__tuaContentLoaded) return;
  window.__tuaContentLoaded = true;

  let currentHighlightedElements = [];

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Deep query across document, open ShadowRoots, and same-origin iframes
  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    const visited = new Set();

    function traverse(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);

      try {
        const matches = node.querySelectorAll ? node.querySelectorAll(selector) : [];
        for (const m of matches) {
          results.push(m);
        }
      } catch (_) {}

      let allNodes = [];
      try {
        allNodes = node.querySelectorAll ? node.querySelectorAll('*') : [];
      } catch (_) {}

      for (const el of allNodes) {
        if (el.shadowRoot) {
          traverse(el.shadowRoot);
        }
        if (el.tagName === 'IFRAME') {
          try {
            if (el.contentDocument) {
              traverse(el.contentDocument);
            }
          } catch (_) {}
        }
      }
    }

    traverse(root);
    return results;
  }

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
    if (!el || !el.getBoundingClientRect) return false;
    if (el.id === 'tua-ctrlf-input') return false;
    if (el.closest && (el.closest('#tua-ctrlf-overlay') || el.closest('#tua-helper-bar'))) return false;
    if (el.disabled || el.readOnly) return false;
    const win = el.ownerDocument?.defaultView || window;
    const style = win.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 20 && rect.height > 10;
  }

  function getElementDescriptorText(el) {
    const placeholder = el.getAttribute('placeholder') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const name = el.getAttribute('name') || '';
    const id = el.getAttribute('id') || '';
    const dataTest = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-automation-id') || '';
    const wrapper = el.closest('label, [role="search"], [class*="search" i], [class*="filter" i], div') || el.parentElement;
    const wrapperText = wrapper ? (wrapper.innerText || wrapper.getAttribute('aria-label') || '').slice(0, 120) : '';
    return `${placeholder} ${ariaLabel} ${title} ${name} ${id} ${dataTest} ${wrapperText}`
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // Dedicated detector for "Email" column input (used by Bigstock Admin & table-filter admin pages)
  function findEmailColumnInput(allInputs) {
    // 1. Direct attribute match on input (name="email", id="email", placeholder="Email", data-column="email", etc.)
    for (const el of allInputs) {
      const directAttrs = (
        (el.getAttribute('name') || '') + ' ' +
        (el.getAttribute('id') || '') + ' ' +
        (el.getAttribute('placeholder') || '') + ' ' +
        (el.getAttribute('aria-label') || '') + ' ' +
        (el.getAttribute('data-column') || '') + ' ' +
        (el.getAttribute('data-field') || '') + ' ' +
        (el.className || '')
      ).toLowerCase();
      if (directAttrs.includes('email') || directAttrs.includes('e-mail') || el.getAttribute('type') === 'email') {
        return el;
      }
    }

    // 2. Table column header match: find <th> or <td> or <label> whose text is "Email" and find the input in that column!
    const headersAndLabels = querySelectorAllDeep('th, td, label, [role="columnheader"], .column-header, span, div').filter(el => {
      if (!isElementVisible(el)) return false;
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return txt === 'email' || txt === 'email:' || txt === 'e-mail' || txt === 'email address' || txt === 'user email';
    });

    for (const hdr of headersAndLabels) {
      // Case A: Input is inside the same header/cell/label
      const insideInput = hdr.querySelector && hdr.querySelector('input:not([type="hidden"]):not([type="checkbox"])');
      if (insideInput && isElementVisible(insideInput)) {
        return insideInput;
      }

      // Case B: Input is in the next sibling cell (e.g. <td>Email:</td><td><input></td>)
      const nextSibling = hdr.nextElementSibling;
      if (nextSibling) {
        if (nextSibling.tagName === 'INPUT' && isElementVisible(nextSibling)) return nextSibling;
        const sibInput = nextSibling.querySelector && nextSibling.querySelector('input:not([type="hidden"]):not([type="checkbox"])');
        if (sibInput && isElementVisible(sibInput)) return sibInput;
      }

      // Case C: Table column index match (<th>Email</th> at column index N -> filter <tr> below has <input> at cell index N)
      const cell = hdr.closest('th, td, [role="columnheader"]');
      if (cell && cell.parentElement) {
        const siblings = Array.from(cell.parentElement.children);
        const colIndex = siblings.indexOf(cell);
        const table = cell.closest('table, [role="table"], [role="grid"]');
        if (table && colIndex >= 0) {
          const rows = Array.from(table.querySelectorAll('tr, [role="row"]'));
          for (const row of rows) {
            const targetCell = row.children[colIndex];
            if (targetCell) {
              const colInput = targetCell.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
              if (colInput && isElementVisible(colInput)) {
                return colInput;
              }
            }
          }
        }
      }

      // Case D: Visual column alignment (input horizontally aligned directly below the "Email" column header)
      const hdrRect = hdr.getBoundingClientRect();
      let closestAlignedInput = null;
      let minVerticalDist = 9999;
      for (const inp of allInputs) {
        const inpRect = inp.getBoundingClientRect();
        const horizOverlap = Math.abs(inpRect.left - hdrRect.left) < 55 ||
          (inpRect.left >= hdrRect.left - 20 && inpRect.right <= hdrRect.right + 40);
        const vertDist = inpRect.top - hdrRect.top;
        if (horizOverlap && vertDist >= -5 && vertDist < 160 && vertDist < minVerticalDist) {
          minVerticalDist = vertDist;
          closestAlignedInput = inp;
        }
      }
      if (closestAlignedInput) {
        return closestAlignedInput;
      }
    }

    return null;
  }

  // Set value on React / Angular / Vue / Ember / Okta / FluentUI controlled input
  function setNativeInputValue(inputEl, value) {
    const win = inputEl.ownerDocument?.defaultView || window;
    inputEl.focus();
    inputEl.click();

    const proto = inputEl.tagName === 'TEXTAREA'
      ? win.HTMLTextAreaElement.prototype
      : win.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(inputEl, '');
      inputEl.dispatchEvent(new win.Event('input', { bubbles: true }));
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }

    inputEl.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    inputEl.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    inputEl.dispatchEvent(new win.Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: value.slice(-1) || 'a', bubbles: true }));
    inputEl.dispatchEvent(new win.KeyboardEvent('keyup', { key: value.slice(-1) || 'a', bubbles: true }));
  }

  function triggerSearchSubmit(inputEl) {
    const win = inputEl.ownerDocument?.defaultView || window;
    const enterOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    inputEl.dispatchEvent(new win.KeyboardEvent('keydown', enterOpts));
    inputEl.dispatchEvent(new win.KeyboardEvent('keypress', enterOpts));
    inputEl.dispatchEvent(new win.KeyboardEvent('keyup', enterOpts));

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

  // Precision input finder with exact matches for Shutterstock Inc, Lucidchart, PagerDuty, Bigstock Email column, and M365
  function findBestUserOrEmailInput(preferUpperPeopleSearch = false, preferEmailColumn = false) {
    const allInputs = querySelectorAllDeep(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="password"]):not([type="submit"]):not([type="button"]), [role="searchbox"], [role="combobox"]'
    ).filter(isElementVisible);

    if (allInputs.length === 0) return null;

    // 1. BIGSTOCK ADMIN / EMAIL COLUMN PRIORITY: Locate the input in the "Email" column
    if (preferEmailColumn || location.hostname.toLowerCase().includes('bigstock')) {
      const emailColInput = findEmailColumnInput(allInputs);
      if (emailColInput) return emailColInput;
    }

    // 2. SHUTTERSTOCK INC / OKTA UPPER SEARCH BAR: "Search for people, apps..."
    for (const el of allInputs) {
      const desc = getElementDescriptorText(el);
      if (
        desc.includes('search for people') ||
        desc.includes('people, apps') ||
        desc.includes('people,apps') ||
        desc.includes('people, apps, and')
      ) {
        return el;
      }
    }
    if (preferUpperPeopleSearch) {
      const upperInputs = allInputs.filter(el => el.getBoundingClientRect().top < 140);
      if (upperInputs.length > 0) return upperInputs[0];
    }

    // 3. LUCIDCHART EXACT MATCH: "Search current view"
    for (const el of allInputs) {
      const desc = getElementDescriptorText(el);
      if (desc.includes('search current view') || desc.includes('current view')) {
        return el;
      }
    }

    // 4. PAGERDUTY EXACT MATCH: "Find a user by email or name"
    for (const el of allInputs) {
      const desc = getElementDescriptorText(el);
      if (
        desc.includes('find a user by email or name') ||
        desc.includes('find a user by email') ||
        desc.includes('by email or name') ||
        desc.includes('find a user')
      ) {
        return el;
      }
    }

    // 5. M365 ADMIN CENTER EXACT MATCH: "Search active users list" / "active users"
    for (const el of allInputs) {
      const desc = getElementDescriptorText(el);
      if (desc.includes('search active users') || desc.includes('active users list')) {
        return el;
      }
    }

    // 6. Check if there is an explicit Email Column input on the page
    const emailColFallback = findEmailColumnInput(allInputs);
    if (emailColFallback) return emailColFallback;

    // 7. General fallback scoring
    let bestEl = null;
    let bestScore = -9999;

    for (const el of allInputs) {
      let score = 0;
      const rect = el.getBoundingClientRect();
      const desc = getElementDescriptorText(el);
      const type = (el.getAttribute('type') || '').toLowerCase();

      const inGlobalHeader = Boolean(
        el.closest &&
        el.closest('header, nav, [role="banner"], #O365_Header, #O365_SearchBoxContainer')
      );
      if (inGlobalHeader && !preferUpperPeopleSearch) {
        score -= 200;
      }

      if (desc.includes('search current view') || desc.includes('find a user by email')) score += 300;
      if (desc.includes('active user') || desc.includes('search users') || desc.includes('filter users')) score += 120;
      if (desc.includes('email')) score += 100;
      if (desc.includes('user') || desc.includes('person') || desc.includes('member')) score += 80;
      if (desc.includes('search') || desc.includes('filter') || desc.includes('find') || desc.includes('query')) score += 45;
      if (type === 'search' || type === 'email') score += 35;

      if (!preferUpperPeopleSearch) {
        if (rect.top >= 65 && rect.top <= 600) score += 40;
        if (rect.left >= 150) score += 25;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    return bestEl;
  }

  async function waitForUserSearchInput(maxWaitMs = 3500, preferUpperPeopleSearch = false, preferEmailColumn = false) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const inputEl = findBestUserOrEmailInput(preferUpperPeopleSearch, preferEmailColumn);
      if (inputEl) return inputEl;
      await sleep(100);
    }
    return findBestUserOrEmailInput(preferUpperPeopleSearch, preferEmailColumn);
  }

  async function locateAndPasteEmail(email, preferUpperPeopleSearch = false, preferEmailColumn = false) {
    if (!email) return { foundInput: false, message: 'No email provided' };

    let inputEl = await waitForUserSearchInput(3200, preferUpperPeopleSearch, preferEmailColumn);

    if (!inputEl) {
      const triggers = querySelectorAllDeep('button, [role="button"], a').filter(el => {
        if (!isElementVisible(el)) return false;
        const txt = getElementDescriptorText(el);
        return txt.includes('find a user') || txt.includes('search current view') || txt.includes('search users');
      });
      if (triggers.length > 0) {
        triggers[0].click();
        await sleep(250);
        inputEl = findBestUserOrEmailInput(preferUpperPeopleSearch, preferEmailColumn);
      }
    }

    if (!inputEl) {
      return {
        foundInput: false,
        message: 'Input not found in main frame'
      };
    }

    inputEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    clearCtrlFHighlights();
    inputEl.classList.add('tua-highlight-box');
    currentHighlightedElements.push(inputEl);

    setNativeInputValue(inputEl, email);
    await sleep(100);

    const desc = getElementDescriptorText(inputEl);
    const isPeopleDropdownSearch = preferUpperPeopleSearch || desc.includes('search for people') || desc.includes('people, apps');
    if (!isPeopleDropdownSearch) {
      triggerSearchSubmit(inputEl);
    }

    return {
      foundInput: true,
      isPeopleDropdownSearch,
      inputDescriptor: inputEl.getAttribute('placeholder') || inputEl.getAttribute('name') || inputEl.getAttribute('aria-label') || inputEl.tagName,
      message: `Pasted "${email}" into "${inputEl.getAttribute('placeholder') || inputEl.getAttribute('name') || 'Email column'}"`
    };
  }

  async function selectUserFromSearchDropdown(email) {
    const emailLower = (email || '').toLowerCase().trim();
    const userPrefix = emailLower.split('@')[0] || emailLower;
    if (!emailLower) return { selectedUser: false };

    const start = Date.now();
    while (Date.now() - start < 2200) {
      const candidates = querySelectorAllDeep(
        '[role="option"], [role="listbox"] a, [role="listbox"] li, [role="menuitem"], ' +
        'ul li a, .okta-dropdown-option, [class*="search-result" i] a, [class*="search-result" i] li, ' +
        '[class*="autocomplete" i] li, [class*="dropdown" i] a, [class*="dropdown" i] li, ' +
        'a[href*="/person" i], a[href*="/user" i], tr a, [role="row"] a'
      ).filter(el => isElementVisible(el) && el.tagName !== 'INPUT');

      for (const el of candidates) {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (txt.includes(emailLower) || (userPrefix.length >= 3 && txt.includes(userPrefix))) {
          el.click();
          const linkInside = el.querySelector && el.querySelector('a, [role="option"]');
          if (linkInside) linkInside.click();
          return { selectedUser: true, matchedText: txt.slice(0, 100) };
        }
      }
      await sleep(140);
    }

    const inputEl = findBestUserOrEmailInput(true, false);
    if (inputEl) {
      triggerSearchSubmit(inputEl);
      await sleep(700);
      const resultLinks = querySelectorAllDeep(
        'a[href*="/person" i], a[href*="/user" i], tr a, [role="row"] a, [role="listitem"] a'
      ).filter(isElementVisible);
      for (const link of resultLinks) {
        const txt = (link.innerText || link.textContent || '').toLowerCase();
        if (txt.includes(emailLower) || (userPrefix.length >= 3 && txt.includes(userPrefix))) {
          link.click();
          return { selectedUser: true, matchedText: txt.slice(0, 100) };
        }
      }
    }

    return { selectedUser: false };
  }

  async function openUserAndNavigateToGroupsTab(email) {
    const emailLower = (email || '').toLowerCase().trim();
    const userPrefix = emailLower.split('@')[0] || emailLower;
    let clickedUser = false;
    let clickedGroupsTab = false;

    const findGroupsTabElement = () => {
      const tabCandidates = querySelectorAllDeep(
        '[role="tab"], ul[role="tablist"] li, nav a, ul.nav li a, .nav-tabs a, .tabs a, button, a, [role="button"], span'
      ).filter(isElementVisible);

      for (const el of tabCandidates) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const href = (el.getAttribute('href') || '').trim().toLowerCase();
        if (
          text === 'groups' ||
          text === 'group' ||
          text === 'group memberships' ||
          text === 'user groups' ||
          text === 'memberships' ||
          aria === 'groups' ||
          href.endsWith('#groups') ||
          href.includes('/groups') ||
          href.includes('tab=groups') ||
          /^groups\s*\(\d+\)$/i.test(text)
        ) {
          return el;
        }
      }
      return null;
    };

    let groupsTabEl = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      groupsTabEl = findGroupsTabElement();
      if (groupsTabEl) break;

      if (!clickedUser && emailLower) {
        const userLinks = querySelectorAllDeep(
          '[role="option"], a[href*="/person" i], a[href*="/user" i], tr a, [role="row"] a, [role="listitem"] a, td a'
        ).filter(isElementVisible);
        for (const link of userLinks) {
          const txt = (link.innerText || link.textContent || '').toLowerCase();
          if (txt.includes(emailLower) || (userPrefix.length >= 3 && txt.includes(userPrefix))) {
            link.click();
            clickedUser = true;
            await sleep(600);
            break;
          }
        }
      }
      await sleep(150);
    }

    if (groupsTabEl) {
      groupsTabEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      groupsTabEl.click();
      const clickableParent = groupsTabEl.closest('a, button, [role="tab"], li');
      if (clickableParent && clickableParent !== groupsTabEl) {
        clickableParent.click();
      }
      clickedGroupsTab = true;
      await sleep(650);
    }

    return {
      clickedUser,
      clickedGroupsTab,
      groupsTabLabel: groupsTabEl ? (groupsTabEl.innerText || 'Groups').trim() : null
    };
  }

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
          await sleep(160);
          gsFindInput = document.querySelector('.docs-findinput-input');
        }
        if (gsFindInput && isElementVisible(gsFindInput)) {
          setNativeInputValue(gsFindInput, cleanQuery);
          triggerSearchSubmit(gsFindInput);
        }
      } catch (_) {}
    }

    const qLower = cleanQuery.toLowerCase();
    const allElements = querySelectorAllDeep('*');
    const matchedElements = [];
    const matchedSnippets = [];

    const BATCH_SIZE = 500;
    for (let i = 0; i < allElements.length; i += BATCH_SIZE) {
      await new Promise(resolve => requestAnimationFrame(() => {
        const slice = allElements.slice(i, i + BATCH_SIZE);
        for (const el of slice) {
          if (!isElementVisible(el)) continue;
          const tag = el.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'PATH') continue;

          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
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
            const rowContext = (el.closest && el.closest('tr, [role="row"], [role="listitem"], li, .ms-DetailsRow')) || el;
            const snippet = (rowContext.innerText || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (snippet && !matchedSnippets.includes(snippet) && matchedSnippets.length < 10) {
              matchedSnippets.push(snippet);
            }
          }
        }
        resolve();
      }));
    }

    const HIGHLIGHT_BATCH = 50;
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
    const rowEls = querySelectorAllDeep('tr, [role="row"], [role="listitem"], .ms-DetailsRow, li');
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
    if (window !== window.top) return;
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
          const res = await locateAndPasteEmail(
            message.email,
            Boolean(message.preferUpperPeopleSearch),
            Boolean(message.preferEmailColumn)
          );
          sendResponse({ ok: true, ...res });
          return;
        }

        if (message.type === 'SELECT_USER_FROM_DROPDOWN') {
          const res = await selectUserFromSearchDropdown(message.email);
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
