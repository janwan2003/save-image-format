// Chrome only: an invisible page with a DOM, used to render SVG images
// (service workers cannot decode SVG). Never shown, never loads anything remote.
import { convertBlob } from './lib/convert.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'saveform-offscreen' || msg.type !== 'convert') return false;
  (async () => {
    const blob = await (await fetch(msg.dataUrl)).blob();
    const out = await convertBlob(blob, msg.fmt, msg.opts);
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(out.blob);
    });
    return { ok: true, dataUrl, width: out.width, height: out.height, sourceKind: out.sourceKind };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});
