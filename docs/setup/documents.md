# Documents, incremental ZIPs and device downloads

This feature is available in the web **Documents** view and the Android **Your documents** section. It requires a verified school session for real files. The web sign-in feasibility gate still applies; a signed-in school tab does not transfer access to this app.

## Student workflow

1. Find/refresh accessible documents. The app scans supported personal, historical unit/activity/project, e-learning and follow-up sources; review **Source coverage** for gaps.
2. Search or filter by extension. Select files, including all matching files, even when the list renders only its first 100 rows.
3. Use **ZIP missing selected** to fetch only new or changed selected records. **ZIP all selected** deliberately includes saved versions again, useful when a ZIP was moved/deleted outside the app.
4. Save the archive. On a supported Chromium browser, the system save picker streams it to the chosen location; a successful writable close is the save evidence. Other browsers, or the **standard browser download** option, offer a local Blob download link with a **32 MiB** cap. Choose smaller batches when needed.
5. On Android use **Save ZIP to a device folder** and select a local folder. A completed native copy updates history automatically. Alternatively, choose **Share ZIP** and a destination that saves a local copy. A share-sheet close or ordinary browser download prompt cannot prove a completed save: press **I saved the ZIP — remember these files** only after verifying the copy. Discarding a ZIP leaves history unchanged.
6. Refresh later. Known saved versions are skipped; a newly discovered file or changed revision becomes eligible. Already saved records without a reliable remote revision are labeled **Saved · version unknown** and skipped by the missing-files action. Updates to those records cannot be detected; use **ZIP all selected** to refresh them explicitly.

ZIP contents preserve original file bytes; the store compression method supports already-compressed PDFs/binaries without materializing whole large files. Paths are `type/extension/context/name--stable-identity-hash.ext`. Names are sanitized for path traversal and Windows reserved names; same-name documents with different identities remain distinct. Binary files are downloaded as data and never executed or previewed.

Exports are explicit, cancellable and bounded to **2,000,000,000 payload bytes** / 20,000 files, with a five-minute limit per file; no Zip64 or persistent background job is claimed. The browser Blob fallback stops at 32 MiB of ZIP output. Unknown sizes stay unknown until transferred. A file-transfer/write/size error invalidates the whole archive and leaves history unchanged; retry a smaller selection or refresh the source. No incomplete ZIP is recorded as saved.

## Configure exact file hosts

Download URLs may point to object storage distinct from `my.epitech.eu`. This change does not invent a host from a fixture or wildcard an entire cloud provider.

- Web: set `VITE_DOCUMENT_DOWNLOAD_HOSTS` in `apps/web/.env.local` to a comma-separated list of exact approved HTTPS hostnames. Restart/rebuild.
- Android: set `EXPO_PUBLIC_DOCUMENT_DOWNLOAD_HOSTS` before bundling/building the app.
- Obtain hosts from a legitimate fresh school download response during validation. Store **only hostnames**, never a signed query, token or file URL, in configuration.
- Do not use wildcards, private IPs, localhost, proxy bypasses or disabled browser security. The adapter never forwards the school bearer to these hosts. Redirecting file hosts require separate verified support; redirects are rejected in this slice.
- If a file works by opening its URL but browser JavaScript cannot read its bytes, ZIP creation is still blocked by that host’s CORS. Do not claim navigation proves byte access; record the gap.

E-learning text/subtitles use the school JSON endpoints; own follow-up attachments use a narrowly allowlisted authenticated streaming endpoint. Android injects Expo’s streaming fetch for binary responses and uses Expo FileSystem handles for incremental ZIP writes. Adding FileSystem/Sharing requires rebuilding the native development app with `npm run android`; a Metro reload alone cannot add native modules. The Android share sheet remains a real-device validation item.

## Download-history retention

The user authorized remembering downloads. History is separate from credentials and index caches: it retains SHA-256 account/document/revision identifiers in browser IndexedDB or an app-private Android metadata file, **including across local sign-out**. Names, provider URLs, tokens, downloaded bytes and readable account logins are not stored in this ledger. These hashes are metadata, not a claim of encryption or cross-device synchronization.

History is scoped by school account; browser transactions merge concurrent-tab updates atomically and Android writes are serialized/staged before replacement. Invalid/denied storage blocks incremental skipping and reports an error. Use **Forget this account’s download history** explicitly to reset it; it never deletes saved ZIPs. Clearing browser data or uninstalling the Android app also loses the local ledger. This app cannot detect a student deleting or moving files outside its storage, or infer that a ZIP saved on another device is present here.

Collected metadata stays in memory and is cleared at account boundaries. Temporary Android ZIPs live in the app cache, are removed on discard/account disconnect, and orphan ZIPs from an interrupted process are cleaned when the document manager next initializes. Browser object URLs are revoked on discard/disconnect. An already saved device copy is independent and remains on the device.

## Test without a school account

Run `npm run web`, choose **Explore the preview → Documents**. Fictional PDF/binary/source files exercise grouping and ZIP preparation. After testing a saved confirmation, **Add a new sample document** makes just that new record eligible. Preview history has a separate synthetic account namespace and cannot suppress real files. Source fixtures and tests do not establish live school access or full portal coverage.

See [source ledger](../api/documents.md) and [validation evidence](../validation/documents.md). Implementation references checked on 23 October 2026: [fflate ZIP streaming](https://github.com/101arrowz/fflate#zip-streaming), [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/), [Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/), and [browser save picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker).
