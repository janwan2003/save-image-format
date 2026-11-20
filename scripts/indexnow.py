#!/usr/bin/env python3
"""Submit every URL in the live sitemap to IndexNow (Bing, Yandex, Seznam, Naver; no account needed).

The key file is site/verify/<key>.txt, deployed to the site root by scripts/build-site.mjs.
Run after a deploy that adds or changes pages:  python3 scripts/indexnow.py
"""
import json, re, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://janwan2003.github.io/save-image-format/"
key_file = next((ROOT / "site" / "verify").glob("*.txt"))
key = key_file.read_text().strip()

sitemap = urllib.request.urlopen(SITE + "sitemap.xml").read().decode()
urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)
live_key = urllib.request.urlopen(SITE + key_file.name).read().decode().strip()
assert live_key == key, "key file is not deployed yet"

body = json.dumps({"host": "janwan2003.github.io", "key": key, "keyLocation": SITE + key_file.name,
                   "urlList": urls}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                             headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
try:
    with urllib.request.urlopen(req) as r:
        print(r.status, f"{len(urls)} URLs submitted", r.read()[:200])
except urllib.error.HTTPError as e:
    print(e.code, e.read()[:300])
