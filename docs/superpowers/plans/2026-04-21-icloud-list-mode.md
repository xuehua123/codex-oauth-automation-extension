# iCloud List Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:test-driven-development when implementing these tasks. Keep each task independently verifiable before moving on.

**Goal:** Add a fully independent `icloud-list` mode that allocates emails from an imported list and fetches verification codes from each entry's `codeUrl`, while preserving the existing `icloud` Hide My Email flow unchanged.

**Architecture:** Keep the current step orchestrator in `background.js`, add a new normalized `icloudListEntries` data model plus `currentIcloudListEmail` runtime pointer, extend provider/generator branching for `icloud-list`, and route Step 4/8 verification polling through a dedicated hybrid fetch + page fallback path.

**Tech Stack:** Chrome Extension MV3, plain JavaScript, `chrome.storage.local`, `chrome.storage.session`, background `fetch`, dynamic content script injection, Node built-in test runner

---

### Task 1: Add `icloud-list` State Model and Shared Helpers

**Files:**
- Add: `icloud-list-utils.js`
- Modify: `background.js`
- Modify: `sidepanel/sidepanel.html`

- [ ] **Step 1: Write the failing test**

Add focused utility tests for:

- parsing `email<TAB>codeUrl<TAB>note`
- ignoring blank/comment lines
- deduping by normalized email while preserving `used` and `lastUsedAt`
- selecting the first unused entry
- matching a manually typed email back to a list entry

- [ ] **Step 2: Run test to verify it fails**

Run the new utility test file before implementation.

Expected: the parser/allocation helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add:

- normalized `icloudListEntries`
- normalized `currentIcloudListEmail`
- helper functions for parse, merge, find, allocate, and update entry state
- `icloud-list` support in `normalizeMailProvider`, `normalizeEmailGenerator`, labels, and persisted settings

- [ ] **Step 4: Run test to verify it passes**

Run the new utility-focused tests.

- [ ] **Step 5: Commit**

```bash
git add icloud-list-utils.js background.js sidepanel/sidepanel.html tests/icloud-list-utils.test.js
git commit -m "feat: add icloud list state model"
```

### Task 2: Wire `icloud-list` into Background Email Allocation

**Files:**
- Modify: `background.js`
- Modify: `background/generated-email-helpers.js`

- [ ] **Step 1: Write the failing test**

Add tests covering:

- `icloud-list` generator selection
- successful first-unused allocation
- clear failure when no unused email exists
- reverse-matching manually edited email to an imported entry

- [ ] **Step 2: Run test to verify it fails**

Run the focused background tests.

Expected: `icloud-list` is not yet recognized as a generator/provider path.

- [ ] **Step 3: Write minimal implementation**

Add background helpers and message handling to:

- import and persist parsed entry lists
- allocate the next unused email for `获取邮箱`
- keep `currentIcloudListEmail` in sync
- support row actions like mark-unused/delete/clear

- [ ] **Step 4: Run test to verify it passes**

Run the allocation/background unit tests and confirm the new state transitions.

- [ ] **Step 5: Commit**

```bash
git add background.js background/generated-email-helpers.js tests/background-icloud-list.test.js
git commit -m "feat: wire icloud list email allocation"
```

### Task 3: Implement `icloud-list` Verification Polling for Step 4 and Step 8

**Files:**
- Add: `content/icloud-list-mail.js`
- Modify: `background.js`
- Modify: `background/verification-flow.js`
- Modify: `background/steps/fetch-signup-code.js`
- Modify: `background/steps/fetch-login-code.js`

- [ ] **Step 1: Write the failing test**

Add tests for:

- Step 4 polling via `codeUrl`
- Step 8 polling via `codeUrl`
- 90-second resend interval
- duplicate-code rejection after resend
- page fallback when background fetch returns no usable code

- [ ] **Step 2: Run test to verify it fails**

Run the verification-flow tests.

Expected: no dedicated `icloud-list` polling path exists yet.

- [ ] **Step 3: Write minimal implementation**

Add:

- a dedicated `icloud-list` mail config and source
- hybrid fetch-first / page-fallback code retrieval
- extraction from text / HTML / JSON / DOM
- fixed `90s` resend interval for `icloud-list`
- duplicate/old-code rejection within the active session

- [ ] **Step 4: Run test to verify it passes**

Run verification-flow and step executor tests after implementation.

- [ ] **Step 5: Commit**

```bash
git add background.js background/verification-flow.js background/steps/fetch-signup-code.js background/steps/fetch-login-code.js content/icloud-list-mail.js tests/verification-flow-polling.test.js
git commit -m "feat: add icloud list verification polling"
```

### Task 4: Add Independent `icloud-list` Side Panel UI

**Files:**
- Add: `sidepanel/icloud-list-manager.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: Write the failing test**

Add UI tests covering:

- new provider/generator options
- `icloud-list` section visibility rules
- existing `icloud` section stays hidden when only `icloud-list` is selected
- import/apply/list row actions
- no `queueIcloudAliasRefresh()` trigger when switching to `icloud-list`

- [ ] **Step 2: Run test to verify it fails**

Run the sidepanel tests.

Expected: the section and manager do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add a dedicated sidepanel card with:

- multiline paste area
- TXT import
- apply list action
- rendered list rows
- row actions and bulk actions
- clear validation/error messaging

- [ ] **Step 4: Run test to verify it passes**

Run the sidepanel-focused tests and smoke-check selector visibility logic.

- [ ] **Step 5: Commit**

```bash
git add sidepanel/sidepanel.html sidepanel/sidepanel.js sidepanel/icloud-list-manager.js tests/sidepanel-icloud-list-manager.test.js
git commit -m "feat: add icloud list sidepanel manager"
```

### Task 5: Regression Verification and Cleanup

**Files:**
- Modify only as needed for labels/messages/test fixes

- [ ] **Step 1: Write the failing test**

Document the expected regression matrix:

- existing `icloud` Hide My Email path still works unchanged
- `icloud-list` does not call the existing iCloud alias refresh flow
- non-icloud providers keep their current mail polling behavior

- [ ] **Step 2: Run test to verify it fails**

Run the full relevant test subset before cleanup to catch missed regressions.

- [ ] **Step 3: Write minimal implementation**

Fix any label mismatches, state edge cases, or test gaps discovered during verification.

- [ ] **Step 4: Run test to verify it passes**

Run the final verification command for all touched areas.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test: cover icloud list mode regressions"
```
