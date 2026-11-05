# Terminated User Access Auditor (Chrome & Microsoft Edge Extension)

A Manifest V3 browser extension for **Google Chrome** and **Microsoft Edge** that automates checking terminated user access and group memberships across **6 websites** and captures screenshot evidence + site audit details:

1. **Shutterstock Inc Person** — Searches the user email, opens the user/person profile & clicks the **Groups** tab, then runs `Ctrl+F` for **`reporting`** (takes Screenshot #1) and **`tableau`** (takes Screenshot #2).
2. **PagerDuty** — Locates the Active User / Email search box, pastes the terminated user's email, runs the search, gathers account status details, and takes a screenshot.
3. **M365 Admin Center** — Locates the Active Users search box, pastes the terminated user's email, runs the search, gathers account status details, and takes a screenshot.
4. **Lucidchart** — Locates the Active User / Email search box, pastes the terminated user's email, runs the search, gathers account status details, and takes a screenshot.
5. **Bigstock Admin** — Locates the Active User / Email search box, pastes the terminated user's email, runs the search, gathers account status details, and takes a screenshot.
6. **Google Sheet** — Runs `Ctrl+F` on the Google Sheet and searches for the terminated user's **email**, highlights matches, gathers row details, and takes a screenshot.

---

## Installation (Microsoft Edge & Google Chrome)

1. Download and extract `terminated-access-auditor.zip` to a folder on your computer or AWS WorkSpace.
2. **Microsoft Edge:**
   - Open `edge://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the extracted `terminated-access-auditor` folder.
3. **Google Chrome:**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the extracted `terminated-access-auditor` folder.

---

## How to Use

1. Click the **Terminated User Access Auditor** extension icon (or click **📌 Side Panel** to keep it docked while switching tabs).
2. Enter the **Terminated User Email** (e.g., `user@company.com`).
3. Paste or verify your **6 Website Links** and click **💾 Save Links**.
4. Click **🚀 Run All 6 Websites & Take Screenshots**.
5. When complete, the **Full Audit Report & Screenshots Dashboard** opens automatically with:
   - Summary table of all 6 websites, access verdicts, `reporting` & `tableau` match counts, and extracted page rows.
   - Full-resolution PNG screenshots with the search fields, `Ctrl+F` search bar, and highlighted matches clearly visible.
   - One-click **Download All Screenshots (PNG)**, **Export Standalone HTML Report**, **Copy Ticket Summary**, and **Print / Save PDF**.
