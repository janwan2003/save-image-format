# Chrome Web Store dashboard: what to paste (Saveform)

Item id: `iimmananoageikphanfidapckaochlmn` (draft; package 0.4.1 uploaded by `scripts/cws-upload.py` on 2026-11-20,
`--status` reports crxVersion 0.4.1). 0.4.0 added the toolbar button that saves several images from a page; the text
below covers it.
Dashboard: https://chrome.google.com/webstore/devconsole → click "Saveform: Save Image as PNG, JPG, WebP, PDF".

The publish call (`python3 scripts/cws-upload.py --publish`, 2026-11-20) listed exactly these missing items.
Fill them once; after that, updates and publishing go through the API.

## Account settings page (once per publisher, not per item)

- Publisher name: **Plainbyte**
- Contact email: enter it and click the verification link Google sends (API error: "You must provide a contact email"
  and "You must verify the publisher's contact email").

## Store listing tab

- **Language:** English
- **Category:** Tools (if a "Photos" category is offered instead of/alongside Tools, either is fine; Tools preferred)
- **Store icon (128×128):** `extension/icons/icon128.png`
- **Screenshot (1280×800):** `docs/store/screenshot-1280x800.png`
- **Small promo tile (440×280):** `docs/store/promo-440x280.png`
- **Detailed description:** paste the "Long description" block from `STORE.md` (everything between
  "Saveform adds…" and the Source link).
- **Homepage URL:** https://janwan2003.github.io/save-image-format/
- **Support URL:** https://github.com/janwan2003/save-image-format/issues

## Privacy practices tab

**Single purpose description:**

> Saveform saves images from web pages in a format the user picks (PNG, JPG, WebP, PDF). It adds a "Save image as"
> entry to the right-click menu for one image, and a toolbar button that lists the images on the current page so the
> user can save several at once (as separate files, one ZIP or one PDF). The conversion runs on the user's device.

**Permission justifications** (one box each):

- **contextMenus:** Adds the "Save image as → PNG / JPG / WebP / PDF / Copy as PNG" submenu when the user right-clicks an image.
- **downloads:** Saves the converted image file to the user's downloads folder (optionally with the Save As dialog).
- **activeTab:** After the user clicks a Saveform menu entry or the Saveform toolbar button, reads the image(s) from the current site so they can be converted. No access to any page otherwise.
- **scripting:** Runs a short script in the current tab only after the user clicks a Saveform menu entry or the toolbar button: to list the addresses and sizes of the images on the page (toolbar button), to read images that exist only inside the page (blob: URLs or images that need the page's cookies), to copy the converted PNG to the clipboard, and to show a brief "Saved" or error notice.
- **storage:** Stores the user's settings (JPG/WebP/PDF quality, PDF page size, background colour, whether to show the Save dialog, file name pattern, Downloads subfolder, and the format/output last chosen in the toolbar popup).
- **offscreen:** Renders SVG images to a canvas in an offscreen document, because the extension service worker cannot decode SVG.
- **Host permission (optional, `<all_urls>`):** Never granted at install. Requested only for the specific image sites that refuse to let the extension read an image the user asked to save, and only after the user clicks "Allow" on Saveform's prompt. The user can revoke it in Saveform's settings.

**Are you using remote code?** No, I am not using remote code. (All JavaScript is in the package; no eval, no external scripts.)

**Data usage** – tick **none** of the data categories (personally identifiable information, health, financial,
authentication, personal communications, location, web history, user activity, website content).
Saveform does not collect or transmit any data; images are converted locally and written to the user's own disk.

**Certify** all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://janwan2003.github.io/save-image-format/privacy/

## Distribution tab

- Visibility: Public. Regions: all.

## After saving

Tell a builder (or run it yourself): `python3 scripts/cws-upload.py --publish` in `ventures/save-image-format`.
It submits the item for review; the response says `OK` or lists anything still missing.
