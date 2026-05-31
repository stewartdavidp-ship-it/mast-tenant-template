# Image, File & OS-Level Controls (standard)

Companion to [13-data-import-export.md](13-data-import-export.md) (which covers tabular data) and [02-standard.md](02-standard.md). Covers media (images), files/attachments, and OS-level interactions (pickers, drag-drop, clipboard, camera, print, downloads, external links). Today these are reimplemented per module: image pickers in ≥6 modules (newsletter, blog, composer, shows, homepage, brand, events), scattered upload/Firebase-storage code (production, orders, brand, social, blog), ad-hoc clipboard copy in ~9 modules, per-module `window.print`. One shared component per modality, used everywhere.

## Principle
**One component per modality** (image picker · file upload · copy · print · camera), module-agnostic, both-mode, accessible. All async (upload/download/print/parse) shows **progress** and a **`showToast` result**. Validation + safety (type/size, URL/file safety, storage paths, CSV-injection per [13]) is centralized, never per-module.

## Image controls — one `mastImagePicker`
Consolidate the per-module pickers + the "Image Library" + `safeImageUrl` into one component:
- **Sources, all in one picker:** pick from the **Image Library** (existing assets) · **upload new** · **camera capture** (via shared `shared/camera.js` — don't reimplement) · **paste from clipboard** · **drag-and-drop**.
- **Preview + crop** to the target aspect ratio where the slot needs it; **alt-text** field (a11y + SEO) on every image.
- **Validation:** allowed types (jpg/png/webp), max size; clear error via toast.
- **Render** through `safeImageUrl` (guards untrusted URLs); thumbnails consistent; both-mode.
- **Storage:** one upload helper → Firebase storage with a **consistent path convention** + `getDownloadURL`; **no per-module `storage().ref(...)` code**.
- Launched from within the slide-out edit context as a focused picker — one consistent presentation everywhere.

## File controls — one `mastFileUpload` / dropzone
- **Dropzone + "Choose file" button** (drag-drop with a visible dragover highlight); declared allowed types + max size; **progress bar**; result toast.
- **Attachment list:** name · size · download · remove, consistent layout.
- **Parsing** (CSV/XLSX imports) uses PapaParse/SheetJS per [13]; **no bespoke `FileReader` loops** per module.

## OS-level interactions — consistent helpers
| Interaction | Standard | Replaces |
|---|---|---|
| **File picker** | via `mastFileUpload`/`mastImagePicker` | scattered raw `<input type=file>` (show-light, production, blog, maker, events, contacts…) |
| **Drag & drop** | dropzone affordance built into the upload components (dragover highlight) | one-off handlers (newsletter, website) |
| **Clipboard copy** | one **copy affordance** (icon button) → `navigator.clipboard.writeText` + `showToast('Copied')` | ad-hoc `execCommand`/`writeText` in wholesale, blog, accounting, finance, newsletter, students, social, shows |
| **Native share** | `navigator.share` where relevant (mobile), **fallback to copy-link** | — |
| **Print** | one **Print action** → shared **`@media print` stylesheet** + a shared document-print/PDF path | per-module `window.print` (production, fulfillment, finance, orders, sales, trips, consignment) |
| **PDF generation** | shared async path with `.loading` + result toast | lookbooks-style one-offs |
| **Camera / scan** | shared `shared/camera.js` | reimplementation |
| **Downloads** | filename convention from [13]; trigger via shared helper | — |
| **External links** | open new tab with `↗` marker + `rel="noopener"`; never auto-follow/execute untrusted URLs | inconsistent link handling |
| **Unsaved-changes / `beforeunload`** | covered by the dirty guard ([12](12-edit-flow-and-dirty-state.md)) | — |
| **Notifications** | `showToast` (already standard) | — |

## Safety (centralized, non-negotiable)
- File/image **type + size validation** before upload; reject with a clear toast.
- **Untrusted URLs/files** never executed; images via `safeImageUrl`; external links `rel="noopener"`.
- Consistent **storage path convention** + access rules; uploads `writeAudit`-logged where sensitive.
- CSV/spreadsheet imports injection-guarded per [13].

## Conformance (per-screen checklist additions)
- Images use `mastImagePicker` (library/upload/camera/paste/drag, preview+crop, alt-text, validated) — not a bespoke picker.
- File attach/upload uses `mastFileUpload` (dropzone + progress + list) — not a raw `<input>`.
- Copy uses the shared copy affordance + toast; print uses the shared print path + `@media print`; camera uses `shared/camera.js`.
- All async media ops show progress + a result toast; type/size validated; URLs/files safe; both modes verified.
