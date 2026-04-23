# iCloud List Mode Design

## Goal

Add a new independent mode named `icloud-list` that:

- allocates registration emails from a user-maintained iCloud list
- retrieves verification codes from the per-email `codeUrl` instead of the iCloud Mail page
- keeps the existing `icloud` Hide My Email mode fully intact
- keeps Step 4 and Step 8 automatic, including resend behavior

This mode must not share runtime behavior with the current `icloud` provider beyond generic verification-step orchestration.

## Existing Constraints

- The project is a Manifest V3 Chrome extension with no build step.
- Orchestration still centers on `background.js`, `background/verification-flow.js`, and step executors.
- The side panel is plain HTML, CSS, and JavaScript.
- Existing email behavior is split across two concepts:
  - `mailProvider` controls which mailbox path Step 4 and Step 8 use.
  - `emailGenerator` controls how the registration email is obtained.
- The current `icloud` mode already contains Hide My Email alias management, host fallback, and iCloud page polling logic.
- The worktree already has ongoing `icloud` changes, so the new mode must be isolated and additive.

## Design Summary

The new `icloud-list` path introduces one focused data model and one focused verification-code path:

1. `icloud-list-storage`
   Stores user-imported `email + codeUrl` records in persistent settings.
2. `icloud-list-selection`
   Allocates the next unused list entry as the registration email.
3. `icloud-list-code-polling`
   Polls the current record's `codeUrl`, extracts a verification code, and triggers resend after 90 seconds when needed.

The mode is intentionally separate from existing iCloud Hide My Email behavior:

- `icloud` keeps using alias APIs and iCloud page logic
- `icloud-list` keeps using imported records and `codeUrl` polling only

No hidden fallback from `icloud-list` to current iCloud Mail page polling is allowed.

## State Model

### Persisted Settings

Add a new persisted setting:

- `icloudListEntries`

Each entry stores:

- `id`
- `email`
- `codeUrl`
- `note`
- `used`
- `lastUsedAt`

Suggested normalized record shape:

```js
{
  id: "icloud-list-1",
  email: "alias1@icloud.com",
  codeUrl: "https://example.com/code/1",
  note: "main",
  used: false,
  lastUsedAt: 0,
}
```

### Runtime State

Add a runtime pointer:

- `currentIcloudListEmail`

This tracks which imported entry is currently bound to the active registration flow.

## Import Format

The mode should support two input methods with one shared parser:

- paste plain text into a multiline textarea
- import a local `.txt` file through the side panel

Recommended line format:

```txt
# email<TAB>codeUrl<TAB>note(optional)
alias1@icloud.com	https://example.com/code/1	main
alias2@icloud.com	https://example.com/code/2
```

Rules:

- ignore empty lines
- ignore lines starting with `#`
- split by tab first
- require valid `email` and `codeUrl`
- `note` is optional
- dedupe by normalized `email`
- when an existing email is re-imported, update `codeUrl` and `note`
- preserve existing `used` and `lastUsedAt` state during re-import

The extension must not treat a pasted local filesystem path such as `C:\Users\72774\Downloads\API邮箱.txt` as a readable source by itself. The actual file contents must be imported through the file picker or pasted directly.

## Provider and Generator Model

Add `icloud-list` as a distinct value in both:

- `mailProvider`
- `emailGenerator`

This is intentional even though both values describe the same mode. It keeps existing flow wiring consistent:

- Step 2 and manual email fetch still use `emailGenerator`
- Step 4 and Step 8 still branch by `mailProvider`

The new mode must not interfere with:

- `icloud`
- `gmail`
- `2925`
- `hotmail-api`
- `luckmail-api`
- `cloudflare-temp-email`
- existing webmail providers

## Email Allocation Flow

When `icloud-list` is selected and the operator clicks `获取邮箱`:

1. Read `icloudListEntries`
2. Find the first entry where `used === false`
3. Write its `email` into the existing runtime `email`
4. Set `currentIcloudListEmail = email`
5. Return the email to the side panel

If no unused entry exists:

- fail with a direct message such as:
  `iCloud 列表里没有可用邮箱，请导入新列表或手动把某条标记为未用。`

If the operator manually edits the registration email while `icloud-list` is active:

- try to match the typed email against `icloudListEntries`
- if matched, update `currentIcloudListEmail`
- if not matched, Step 4 and Step 8 must fail clearly instead of falling back to another mailbox mode

## Verification-Code Retrieval

### Core Rule

For `icloud-list`, Step 4 and Step 8 must not open the current iCloud Mail page or reuse [icloud-mail.js](E:/IdeaProjects/codex-oauth-automation-extension/content/icloud-mail.js).

Instead, they use the current record's `codeUrl`.

### Retrieval Strategy

Use a two-stage strategy:

1. Background fetch first
2. Open-page polling as fallback

#### Stage 1: Background Fetch

Try `fetch(codeUrl)` from extension background logic.

Expected supported response shapes:

- plain text
- HTML
- JSON

Code extraction should support:

- Chinese patterns such as `验证码`
- English patterns such as `verification code`, `code is`
- plain 6-digit codes

#### Stage 2: Open-Page Fallback

If background fetch fails or produces no valid code:

- open the `codeUrl` in a dedicated page source such as `icloud-list-mail`
- poll the loaded page with a generic content-script helper
- extract the verification code from visible DOM text

This fallback belongs only to `icloud-list`.

## Step 4 and Step 8 Behavior

### Common Rules

- find the current `icloud-list` entry by `state.email` or `currentIcloudListEmail`
- if no matching entry exists, fail immediately
- reuse the existing verification-step orchestration where practical
- keep old-code rejection behavior
- keep submit retry behavior

### Resend Policy

`icloud-list` needs automatic resend behavior.

Rules:

- resend interval is fixed at `90 seconds`
- max resend count continues to use existing `verificationResendCount`
- before 90 seconds pass, keep polling the same `codeUrl`
- after 90 seconds pass without a new code, switch back to the OpenAI verification page and trigger resend
- after resend, continue polling the same `codeUrl`

If the polled response includes a usable message timestamp:

- compare it with the current resend/request time and filter old messages

If no timestamp is available:

- still reject duplicate codes already seen in the current session

### Step 8 Recovery

Step 8 should preserve the current recovery model:

- if verification-mail polling keeps failing, Step 8 can still rerun Step 7
- `icloud-list` changes only the mailbox polling source, not the overall login verification recovery contract

## Side Panel UX

Add a new dedicated card for `icloud-list`.

Suggested behavior:

- show the card only when `mailProvider === 'icloud-list'` or `emailGenerator === 'icloud-list'`
- hide the current iCloud alias-management card when only `icloud-list` is selected
- do not refresh Hide My Email aliases when switching to `icloud-list`

Suggested controls:

- multiline textarea for direct paste
- `导入 TXT` button
- `应用列表` button
- format hint:
  `邮箱<TAB>验证码链接<TAB>备注(可选)`
- rendered list table with:
  - `邮箱`
  - `备注`
  - `状态`
  - `最近使用`
  - `操作`
- per-row actions:
  - `设为未用`
  - `删除`
- bulk actions:
  - `批量标记未用`
  - `清空列表`

The UI is intentionally smaller than the Hide My Email manager. It is a list-backed mailbox source, not a second alias-management system.

## Error Handling

### Import Errors

Invalid rows should be rejected with line-specific reasons, for example:

- invalid email
- missing code URL
- malformed URL

Import should still succeed for valid rows in the same batch.

### Runtime Errors

Clear failure modes are required:

- current email is not present in `icloud-list`
- `icloud-list` has no unused email
- current email has no `codeUrl`
- `codeUrl` request failed
- `codeUrl` page fallback failed
- no new matching verification code found

`icloud-list` must not silently fall back to:

- current `icloud` page polling
- manual verification bypass
- another provider

## Testing Strategy

Add focused tests for the new isolated mode:

- parser normalization for pasted/imported text
- dedupe behavior while preserving `used` state
- selecting the first unused `icloud-list` entry
- matching manual email edits back to a list entry
- Step 4 `icloud-list` polling path
- Step 8 `icloud-list` polling path
- fixed 90-second resend interval behavior
- duplicate-code rejection after resend
- side panel mode switching without triggering existing `icloud` alias refresh

Prefer helper extraction where it reduces the amount of logic embedded directly in `background.js` and `sidepanel/sidepanel.js`.

## Deferred Work

The first version intentionally excludes:

- editing rows inline
- CSV import
- multiple URLs per email
- per-entry resend interval settings
- preserving or archiving old code snapshots
- merging `icloud-list` into current iCloud alias management

## Implementation Boundary

Modify only the minimum set of files needed to add the new mode while keeping the current `icloud` mode operational.

Likely touched files:

- `background.js`
- `background/generated-email-helpers.js`
- `background/verification-flow.js`
- `background/steps/fetch-signup-code.js`
- `background/steps/fetch-login-code.js`
- `background/message-router.js`
- `sidepanel/sidepanel.html`
- `sidepanel/sidepanel.js`
- `manifest.json` only if the page-fallback implementation needs a new content-script target
- new helper files only if they clearly reduce complexity

The implementation must preserve the existing `icloud` alias path end-to-end.
