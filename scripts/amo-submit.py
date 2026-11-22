#!/usr/bin/env python3
"""Submit packages/saveform-<version>-firefox.zip to Firefox AMO (addons.mozilla.org API v5).

First run creates the listed add-on with its listing text; later runs add a new version.
Credentials: AMO_JWT_ISSUER / AMO_JWT_SECRET from the studio .env (never printed).
Usage: python3 scripts/amo-submit.py            # upload + create or add version
       python3 scripts/amo-submit.py --status   # show the add-on's review status
       python3 scripts/amo-submit.py --listing  # only update the listing summary/description
       python3 scripts/amo-submit.py --previews # upload store screenshots AMO does not have yet
       python3 scripts/amo-submit.py --refresh-previews  # replace every AMO screenshot with docs/store's
"""
import base64, hashlib, hmac, json, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = dict(l.split("=", 1) for l in (ROOT.parent.parent / ".env").read_text().splitlines() if "=" in l)
API = "https://addons.mozilla.org/api/v5"
ADDON_ID = "saveform@save-image-format"
SITE = "https://janwan2003.github.io/save-image-format/"

SUMMARY = ("Right-click any image and save it as PNG, JPG, WebP or PDF, or save every image on a page at once "
           "as files, a ZIP or one PDF. Converted on your device. No tracking, open source.")
DESCRIPTION = """Saveform adds "Save image as" to the right-click menu for images, with a submenu: PNG, JPG, WebP, PDF, and "Copy as PNG". Its toolbar button lists every image on the current page so you can save many at once: as separate files, as one ZIP, or combined into one PDF.

Useful when "Save Image As…" gives you a .webp or .avif file that your editor, slide deck, upload form or older system will not open.

• Converts on your device. The image is never uploaded anywhere.
• No analytics, no ads, no account, no remote code.
• Asks for almost nothing: no access to the pages you browse. If a server blocks add-ons from reading an image, Saveform asks for access to that one site, and you can revoke it.
• Save all images on a page: pick them in a grid, hide small icons, choose PNG/JPG/WebP or keep the original format. Picks the largest version a page offers (srcset) and finds CSS background images too. Shortcut: Alt+Shift+S.
• Keeps transparency in PNG and WebP; fills it with white (or a colour you pick) for JPG and PDF.
• PDF: one page, either the size of the image or A4 / US Letter with the image fitted.
• Renders SVG images at a usable size (1024 px by default).
• Choose JPG, PDF and WebP quality, and whether to see the Save dialog each time.
• Name files your way ({site} {date} {name}, {width}x{height}, …) and save into a folder inside Downloads.
• Open source (MIT): every file in the package can be checked against the GitHub source.

Free online converters (WebP to PNG, AVIF to JPG, JPG to PDF, PNG to ICO and more, also in your browser): """ + SITE + """
Source code: https://github.com/janwan2003/save-image-format"""


def jwt():
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    now = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": ENV["AMO_JWT_ISSUER"], "jti": str(uuid.uuid4()), "iat": now, "exp": now + 60}).encode())
    sig = b64(hmac.new(ENV["AMO_JWT_SECRET"].encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"JWT {head}.{body}.{sig}"


def call(method, path, data=None, files=None):
    headers = {"Authorization": jwt()}
    body = None
    if files:
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in (data or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for k, (name, content) in files.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\n'
                         f'Content-Type: {"image/png" if name.endswith(".png") else "application/zip"}\r\n\r\n'.encode() + content + b"\r\n")
        body = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def status():
    code, a = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code != 200:
        print("not found", code, a); return
    v = a.get("latest_unlisted_version") or a.get("current_version")
    print(json.dumps({"status": a.get("status"), "slug": a.get("slug"), "url": a.get("url"),
                      "current_version": (a.get("current_version") or {}).get("version")}, indent=1))
    code, vs = call("GET", f"/addons/addon/{ADDON_ID}/versions/?filter=all_with_unlisted")
    for ver in (vs or {}).get("results", [])[:3]:
        print("version", ver["version"], "file status:", ver.get("file", {}).get("status"))


def main():
    if "--status" in sys.argv:
        return status()
    version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
    zip_path = ROOT / "packages" / f"saveform-{version}-firefox.zip"
    code, up = call("POST", "/addons/upload/", {"channel": "listed"}, {"upload": (zip_path.name, zip_path.read_bytes())})
    print("upload", code, {k: up.get(k) for k in ("uuid", "processed", "valid")} if isinstance(up, dict) else up)
    if code >= 300:
        print(up); sys.exit(1)
    for _ in range(60):
        code, up = call("GET", f"/addons/upload/{up['uuid']}/")
        if up.get("processed"):
            break
        time.sleep(2)
    v = up.get("validation") or {}
    print("validation: valid=%s errors=%s warnings=%s" % (up.get("valid"), v.get("errors"), v.get("warnings")))
    if not up.get("valid"):
        for m in v.get("messages", []):
            if m.get("type") == "error":
                print(" -", m.get("message"), m.get("file"))
        sys.exit(1)
    code, existing = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code == 200:
        code, res = call("POST", f"/addons/addon/{ADDON_ID}/versions/", {"upload": up["uuid"], "license": "MIT"})
        print("version", code, json.dumps({k: res.get(k) for k in ("id", "version")} if code < 300 else res)[:400])
        if code < 300:  # keep the listing text in step with the version
            code, res = patch_listing()
    else:
        code, res = call("POST", "/addons/addon/", {
            "categories": ["photos-music-videos", "download-management"],
            "summary": {"en-US": SUMMARY},
            "description": {"en-US": DESCRIPTION},
            "homepage": {"en-US": SITE},
            "support_url": {"en-US": "https://github.com/janwan2003/save-image-format/issues"},
            "version": {"upload": up["uuid"], "license": "MIT"},
        })
    print("listing/create", code, json.dumps({k: res.get(k) for k in ("id", "slug", "status", "url")} if code < 300 else res)[:800])
    if code >= 300:
        sys.exit(1)


# Store screenshots (1280x800) in listing order, with captions; matched to AMO previews by caption.
PREVIEWS = [
    ("docs/store/screenshot-1280x800.png", "Right-click an image, pick a format. Converted on your device."),
    ("docs/store/screenshot-2-1280x800.png", "Save every image on a page as files, one ZIP or one PDF"),
    ("docs/store/screenshot-3-1280x800.png", "Settings: file names, a Downloads folder, quality and PDF page size"),
]


def upload_previews():
    code, a = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code != 200:
        print("not found", code, a); return 1
    have = [((p.get("caption") or {}).get("en-US") or "") for p in a.get("previews", [])]
    print("AMO has", len(have), "preview(s):", have)
    failed = 0
    for i, (rel, caption) in enumerate(PREVIEWS):
        if i < len(have):
            continue  # AMO already has a screenshot in this position
        path = ROOT / rel
        code, res = call("POST", f"/addons/addon/{ADDON_ID}/previews/", {"position": str(i)},
                         {"image": (path.name, path.read_bytes())})
        print("preview", rel, code, json.dumps(res)[:300])
        if code < 300:  # multipart cannot carry the translated caption object; set it with JSON
            time.sleep(40)
            code, res = call("PATCH", f"/addons/addon/{ADDON_ID}/previews/{res['id']}/", {"caption": {"en-US": caption}})
            print("caption", code, json.dumps(res)[:200])
        failed |= code >= 300
    return failed


def refresh_previews():
    """Upload the current screenshots, then delete the previews AMO had before (never leaves the listing empty)."""
    code, a = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code != 200:
        print("not found", code, a); return 1
    old = [p["id"] for p in a.get("previews", [])]
    print("AMO has previews", old)
    for i, (rel, caption) in enumerate(PREVIEWS):
        path = ROOT / rel
        code, res = call("POST", f"/addons/addon/{ADDON_ID}/previews/", {"position": str(i)},
                         {"image": (path.name, path.read_bytes())})
        print("preview", rel, code, json.dumps(res)[:300])
        if code >= 300:
            return 1  # keep the old previews
        time.sleep(40)
        code, res = call("PATCH", f"/addons/addon/{ADDON_ID}/previews/{res['id']}/", {"caption": {"en-US": caption}})
        print("caption", code, json.dumps(res)[:200])
    for pid in old:
        code, res = call("DELETE", f"/addons/addon/{ADDON_ID}/previews/{pid}/")
        print("delete", pid, code)
    return 0


def patch_listing():
    return call("PATCH", f"/addons/addon/{ADDON_ID}/", {"summary": {"en-US": SUMMARY}, "description": {"en-US": DESCRIPTION}})


if __name__ == "__main__":
    if "--refresh-previews" in sys.argv:
        sys.exit(refresh_previews())
    if "--previews" in sys.argv:
        sys.exit(upload_previews())
    if "--listing" in sys.argv:
        code, res = patch_listing()
        print("listing", code, json.dumps(res)[:300] if code >= 300 else "updated")
        sys.exit(code >= 300)
    main()
