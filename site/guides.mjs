// Guide (article) pages. The build script renders each entry into <slug>/index.html.
// `body(root)` returns trusted HTML; `root` is the relative path to the site root.
// `tool` embeds the converter (same markup and script as the converter pages).
// All prose here is original.
import { CWS_URL } from './pages.mjs';

export const guides = [
  {
    slug: 'how-to-save-webp-as-png',
    footer: 'Save WebP as PNG or JPG',
    title: 'How to Save a WebP Image as PNG or JPG (Chrome, Firefox, Edge) | Saveform',
    description: 'Step-by-step ways to save a WebP image from a website as PNG or JPG in Chrome, Firefox and Edge: copy and paste, an in-browser converter, or a right-click extension.',
    h1: 'How to save a WebP image as PNG or JPG',
    lede: 'You right-clicked a picture, chose “Save image as…”, and got a .webp file that your editor or upload form refuses. Here are four ways to get a PNG or JPG instead, from quickest to most permanent.',
    tool: { from: 'webp', to: 'png' },
    toolTitle: 'Convert a WebP you already saved',
    related: ['why-images-save-as-webp', 'save-image-as-type-alternative', 'how-to-download-all-images-from-a-page'],
    converters: ['webp-to-png', 'webp-to-jpg', 'avif-to-png', 'avif-to-jpg'],
    body: (root) => `
<h2>Why the browser gives you WebP</h2>
<p>A browser’s own “Save image as…” stores the file exactly as the website sent it. It does not convert anything. Many sites send WebP (or the newer AVIF) because those files are smaller than JPG or PNG and pages load faster. Often the address even ends in <code>.jpg</code> while the server actually delivers WebP, because it picks the format based on what your browser says it can display. The full story is in <a href="${root}why-images-save-as-webp/">why images save as WebP</a>.</p>
<p>None of the major browsers has a setting to save in a different format, so you need one extra step. Pick the method that suits how often you do this.</p>

<h2>Method 1: copy the image and paste it into a converter</h2>
<p>This works in every current browser and needs nothing installed.</p>
<ol class="steps-list">
  <li>Right-click the image and choose <strong>Copy image</strong> (Chrome and Edge) or <strong>Copy Image</strong> (Firefox).</li>
  <li>Open the converter on this page (above) or the <a href="${root}">main converter</a>.</li>
  <li>Press <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd>+<kbd>V</kbd> on a Mac). The pasted image is converted on your device.</li>
  <li>Choose PNG or JPG and click <strong>Download</strong>.</li>
</ol>
<p>Browsers put a copied image on the clipboard as plain pixels, so the original WebP compression does not matter. Animated images give you a single frame.</p>

<h2>Method 2: save the WebP, then convert the file</h2>
<p>If you already have .webp files on your computer, drop them on the box above. You can add many at once and download the results together as a ZIP. Use <a href="${root}webp-to-png/">WebP to PNG</a> when you want lossless output or transparency, and <a href="${root}webp-to-jpg/">WebP to JPG</a> when you want small files that open everywhere.</p>
<p>The conversion runs in your browser tab. The files are never uploaded, which matters for screenshots, scans and anything private.</p>

<h2>Method 3: use a built-in app on your computer</h2>
<ul>
  <li><strong>macOS:</strong> recent versions of Preview open WebP. Choose <em>File → Export</em> and pick PNG or JPEG as the format.</li>
  <li><strong>Windows:</strong> whether Paint or Photos can open WebP depends on your Windows version and the image codecs installed. If Paint opens it, <em>File → Save as</em> lets you pick PNG or JPEG. If it refuses the file, use method 1 or 2.</li>
  <li><strong>Linux:</strong> most image viewers built on current libraries open WebP and offer “Save as” or “Export”.</li>
</ul>
<p>This is fine for one or two pictures, but it means opening another program every time.</p>

<h2>Method 4: add “Save as PNG / JPG” to the right-click menu</h2>
<p>If you save images from the web often, a browser extension removes the extra steps: right-click the picture, choose the format, and the converted file lands in your Downloads folder. When choosing one, check what it asks for. An image saver needs to read the image you clicked and write a download; it does not need to read every page you visit or send anything to a server. Our article on <a href="${root}save-image-as-type-alternative/">choosing a replacement image-saving extension</a> explains what to look for and why it matters.</p>
<p>Saveform, made by the same people as this site, is one such extension: open source, converted locally, and it asks for access to a site only when that site’s server blocks the download. It is free in the <a href="${CWS_URL}" rel="noopener">Chrome Web Store</a> (Firefox version in review); <a href="${root}extension/">the extension page</a> explains what it does and every permission it asks for.</p>

<h2>PNG or JPG: which should you pick?</h2>
<ul>
  <li><strong>PNG</strong> for screenshots, logos, diagrams, anything with text or transparency, and images you will edit again. It is lossless but larger.</li>
  <li><strong>JPG</strong> for photographs you want to email, upload or print. Use a quality of 85–92%. Transparent areas become a solid colour (white by default).</li>
</ul>
<p>Neither can restore detail the WebP already threw away; converting only changes the container, so the result looks the same as what you saw in the browser.</p>`,
  },
  {
    slug: 'why-images-save-as-webp',
    footer: 'Why images save as WebP',
    title: 'Why Do Images Save as WebP? How to Get JPG or PNG Instead | Saveform',
    description: 'Why “Save image as” often gives you a .webp or .avif file even when the address ends in .jpg, and simple ways to get a JPG or PNG instead.',
    h1: 'Why do images save as WebP, and how do I get a JPG?',
    lede: 'Websites increasingly send pictures as WebP or AVIF instead of JPG and PNG. Here is what is going on behind the scenes, why the file you save does not match the address, and how to get a format your other software can open.',
    tool: { from: 'webp', to: 'jpg' },
    toolTitle: 'Convert WebP or AVIF to JPG here',
    related: ['how-to-save-webp-as-png', 'save-image-as-type-alternative'],
    converters: ['webp-to-jpg', 'webp-to-png', 'avif-to-jpg', 'avif-to-png'],
    body: (root) => `
<h2>Smaller files mean faster pages</h2>
<p>Images are usually the heaviest part of a web page. WebP, introduced by Google in 2010, typically produces noticeably smaller files than JPG at the same visual quality, and it supports transparency, which JPG does not. AVIF, based on the AV1 video codec, often goes further still. Smaller images load faster, cost the site less bandwidth and help with search rankings that reward quick pages, so large sites, shops, news outlets and content platforms have moved to them.</p>
<p>Today every major browser can display WebP and AVIF. The trouble starts once the picture leaves the browser: some image editors, office suites, older operating systems, printing services and upload forms still reject them.</p>

<h2>Why the address says .jpg but the file is WebP</h2>
<p>When your browser asks for an image, it sends a short list of formats it understands, in a request header called <code>Accept</code>. A current browser includes <code>image/avif</code> and <code>image/webp</code> in that list. Many image servers and content delivery networks read the list and return the smallest format your browser supports, while keeping the same address. This is called <em>content negotiation</em>.</p>
<p>So an image at <code>photo.jpg</code> may arrive as WebP. When you choose “Save image as…”, the browser stores the bytes it received, and depending on the browser and site you may end up with a file named <code>.webp</code>, or even a WebP file wrongly named <code>.jpg</code> that some programs then fail to open.</p>
<p>Other sites convert images when they upload them and only ever store WebP. In both cases, there is no JPG sitting on the server waiting to be downloaded.</p>

<h2>Is it something wrong with my browser?</h2>
<p>No. The browser is doing what it is designed to do: show the picture as efficiently as possible. Chrome, Edge, Firefox and Safari all behave this way, and none of them currently offers a “save in this format” option in the right-click menu. Turning off WebP support is not a practical fix either; it is not a normal setting, it would make sites slower, and many sites would send AVIF instead.</p>

<h2>How to get a JPG or PNG</h2>
<ol class="steps-list">
  <li><strong>Copy and paste.</strong> Right-click the image, choose <em>Copy image</em>, then paste it into the converter on this page with <kbd>Ctrl</kbd>+<kbd>V</kbd>. Pick JPG or PNG and download.</li>
  <li><strong>Convert a saved file.</strong> Drop .webp or .avif files on the converter. It handles batches and downloads them as one ZIP. Dedicated pages: <a href="${root}webp-to-jpg/">WebP to JPG</a>, <a href="${root}webp-to-png/">WebP to PNG</a>, <a href="${root}avif-to-jpg/">AVIF to JPG</a>, <a href="${root}avif-to-png/">AVIF to PNG</a>.</li>
  <li><strong>Change the image address.</strong> Some image services choose the format from a parameter in the address, such as <code>format=webp</code> or <code>fm=webp</code>. Opening the image in its own tab and changing or removing that parameter sometimes gives you a JPG or PNG. This only works where the site supports it.</li>
  <li><strong>Use a right-click extension.</strong> An extension can add “Save as PNG / JPG” directly to the menu and convert on your device. The step-by-step guide on <a href="${root}how-to-save-webp-as-png/">saving WebP as PNG or JPG</a> compares the options.</li>
</ol>

<h2>Does converting lose quality?</h2>
<p>Converting cannot add back detail that the site’s compression already removed, but it does not need to remove more. PNG is lossless, so a PNG made from a WebP looks exactly like the picture you saw. JPG at a quality around 90% is visually the same for photographs and keeps files small. If the image has transparent areas, choose PNG; JPG fills them with a solid colour.</p>

<h2>Does converting expose my images?</h2>
<p>Not with this site. The converter runs entirely in your browser tab using the browser’s own image decoder, so nothing is uploaded. That is worth checking with any online converter you use: many upload your file to a server to process it.</p>`,
  },
  {
    slug: 'save-image-as-type-alternative',
    footer: 'Replacing Save Image as Type',
    title: 'Save Image as Type Was Removed: What to Use Instead | Saveform',
    description: 'The popular Save Image as Type extension was removed from the Chrome Web Store as malware in March 2026. What happened, how to check a replacement, and safe options.',
    h1: 'Looking for a replacement after Save Image as Type was removed?',
    lede: 'For years, a free extension called Save Image as Type was the usual answer to “how do I save this WebP as a JPG?”. In March 2026 Google removed it as malware. Here is what happened, how to judge a replacement, and the options that need no extension at all.',
    related: ['how-to-save-webp-as-png', 'why-images-save-as-webp'],
    converters: ['webp-to-png', 'webp-to-jpg', 'avif-to-png', 'png-to-jpg'],
    body: (root) => `
<h2>What happened</h2>
<p>Save Image as Type added “Save image as PNG / JPG / WebP” to Chrome’s right-click menu and had more than a million users. According to <a href="https://9to5google.com/2026/03/16/image-saving-chrome-extension-removed-as-malware/" rel="noopener">reporting by 9to5Google in March 2026</a> and other outlets, the extension had been sold to a new owner, later versions added behaviour that had nothing to do with saving images, such as interfering with shopping (affiliate) links, and Google disabled it in the Chrome Web Store as malware. Browsers that had it installed turned it off automatically.</p>
<p>This pattern is not unique to one extension. Popular free extensions are attractive to buy precisely because they already have users and permissions; a new owner can push an update and every installed copy receives it silently. That is why the questions below matter more than a feature list.</p>

<h2>Do you need an extension at all?</h2>
<p>If you only convert an image now and then, you can skip extensions entirely:</p>
<ul>
  <li>Right-click the image, choose <strong>Copy image</strong>, and paste it into the <a href="${root}">converter on this site</a> with <kbd>Ctrl</kbd>+<kbd>V</kbd>. It converts in your browser tab; nothing is uploaded.</li>
  <li>Or save the .webp or .avif file and drop it on <a href="${root}webp-to-png/">WebP to PNG</a> or <a href="${root}webp-to-jpg/">WebP to JPG</a>.</li>
</ul>
<p>The guide on <a href="${root}how-to-save-webp-as-png/">saving WebP images as PNG or JPG</a> covers these and the built-in apps on Windows and macOS.</p>

<h2>How to check a replacement extension</h2>
<p>If you save images often, a right-click extension is still the most convenient tool. Before installing one, spend two minutes on these checks:</p>
<ol class="steps-list">
  <li><strong>Permissions.</strong> Read the permissions on the store listing and in the install prompt. An image saver needs to read the image you clicked and write a download. “Read and change all your data on all websites” is far more than that requires, unless it is optional and asked for per site.</li>
  <li><strong>Network access.</strong> Converting an image can be done entirely on your device. If the description mentions uploading images, cloud processing or an account, your pictures leave your computer.</li>
  <li><strong>Open source.</strong> Public source code lets anyone check what the extension does, and makes a hidden change after a sale easier to spot.</li>
  <li><strong>Extras you did not ask for.</strong> Coupons, shopping “deals”, search changes and new-tab takeovers in an image tool are a warning sign.</li>
  <li><strong>Owner and update history.</strong> A sudden change of developer name or a burst of updates after a quiet period deserves a look at recent reviews.</li>
</ol>
<p>After installing, revisit the extension now and then on <code>chrome://extensions</code> (or <code>about:addons</code> in Firefox). An update that requests new permissions will prompt you; do not approve it without knowing why.</p>

<h2>One option: Saveform</h2>
<p>We built Saveform with these checks in mind, so here is how it measures up. It adds <em>Save as PNG / JPG / WebP / PDF</em> (and AVIF where the browser can create it) plus <em>Copy as PNG</em> to the right-click menu. Conversion happens on your device with the same code as this site’s converters; the only thing it downloads is the image you clicked, nothing is sent to any server of ours, there are no analytics and no account. The only install warning is “Manage your downloads”: it does not ask for access to the sites you visit, and requests access to a single image host only if that server blocks the download, which you can decline or revoke. The source code is public on <a href="https://github.com/janwan2003/save-image-format" rel="noopener">GitHub</a> under the MIT licence.</p>
<p>It is new and does not have the history the old extension had, It is free in the <a href="${CWS_URL}" rel="noopener">Chrome Web Store</a>, and the Firefox version is in Mozilla’s review queue. <a href="${root}extension/">The extension page</a> shows what it does and explains every permission in plain words. Other image-saving extensions exist too; whichever you choose, the checks above apply.</p>`,
  },
  {
    slug: 'how-to-open-heic-files-on-windows',
    footer: 'Open HEIC photos on Windows',
    title: 'How to Open or Convert HEIC Photos on Windows (Free Options) | Saveform',
    description: 'Why iPhone photos arrive as .heic files that Windows will not open, how to add HEIC support to Windows, convert HEIC to JPG for free without uploading, and stop the iPhone making HEIC.',
    h1: 'How to open or convert HEIC photos on Windows',
    lede: 'You copied photos from an iPhone, or someone sent you some, and Windows shows .heic files it cannot open. Here are three ways to deal with them: convert them in your browser, add HEIC support to Windows, or have the iPhone send JPG in the first place.',
    tool: { from: 'heic', to: 'jpg' },
    toolTitle: 'Convert HEIC photos to JPG here',
    related: ['how-to-save-webp-as-png', 'why-images-save-as-webp'],
    converters: ['heic-to-jpg', 'heic-to-png', 'heic-to-pdf', 'image-to-pdf'],
    body: (root) => `
<h2>What a HEIC file is</h2>
<p>HEIC is the format iPhones and iPads use for photos unless you change the camera setting. The file is a HEIF container (High Efficiency Image File Format) with the picture compressed by HEVC, the same codec as H.265 video. That keeps photos at roughly the quality of a JPG in less space, which is why Apple made it the default.</p>
<p>Apple devices open HEIC everywhere. Most other software does not: Chrome, Edge and Firefox cannot display it, many upload forms refuse it, and Windows needs extra components before Photos or File Explorer thumbnails can show it.</p>

<h2>Option 1: convert the photos to JPG in your browser</h2>
<p>The quickest way, and the one that needs nothing installed:</p>
<ol class="steps-list">
  <li>Drop the .heic files on the box above, or click it to choose them. You can add many at once.</li>
  <li>Leave the quality at 90% unless you need smaller files.</li>
  <li>Click <strong>Download</strong> on a photo, or <strong>Download all (ZIP)</strong> for the whole batch.</li>
</ol>
<p>The photos are decoded on your computer, not on a server. The first HEIC file makes the page download a decoder (libheif, compiled to WebAssembly) from this site; after that, the conversion runs entirely inside the browser tab, so private photos never leave your device. The JPG keeps the picture and its orientation, but not the GPS location or camera details. If you need a PNG for editing, or one PDF with several photos, use <a href="${root}heic-to-png/">HEIC to PNG</a> or <a href="${root}heic-to-pdf/">HEIC to PDF</a>.</p>

<h2>Option 2: let Windows open HEIC itself</h2>
<p>Microsoft offers HEIC support as two add-ons in the Microsoft Store, and its own support pages say you need both:</p>
<ul>
  <li><strong>HEIF Image Extensions</strong> handles the HEIF container. It is free.</li>
  <li><strong>HEVC Video Extensions</strong> decodes the compressed picture inside. Microsoft charges a small fee for it in the Store, although some PCs come with a manufacturer version already installed.</li>
</ul>
<p>Once both are installed, the Photos app opens .heic files and File Explorer can show thumbnails. On Windows 11, check under <em>Settings → Apps → Installed apps</em> whether “HEVC Video Extensions” is already there before buying it. This route is best if you receive HEIC photos regularly and only need to view them; for sending or uploading, you still need JPG.</p>

<h2>Option 3: stop the iPhone from making HEIC files</h2>
<p>Two settings on the iPhone decide what you get:</p>
<ul>
  <li><strong>Settings → Camera → Formats → Most Compatible</strong> makes the camera save new photos as JPG (and videos as H.264). Photos take more storage this way. Existing photos stay HEIC.</li>
  <li><strong>Settings → Photos → Transfer to Mac or PC → Automatic</strong> asks the iPhone to convert photos to a compatible format when you copy them to a computer over a cable. <em>Keep Originals</em> copies the HEIC files unchanged.</li>
</ul>
<p>Sharing apps and email often convert as well, but not always, so a converter is still handy for photos that arrive as HEIC anyway.</p>

<h2>Which option should you use?</h2>
<ul>
  <li>A few photos to upload, print or email: convert them above, it takes seconds.</li>
  <li>You view iPhone photos on Windows every week: install the two Store extensions.</li>
  <li>It is your own iPhone and storage is not tight: switch the camera to Most Compatible and the problem goes away for new photos.</li>
</ul>
<p>The same page also handles other formats Windows and websites stumble over, such as <a href="${root}webp-to-jpg/">WebP</a> and <a href="${root}avif-to-jpg/">AVIF</a>. If those come from saving pictures on websites, <a href="${root}how-to-save-webp-as-png/">our WebP guide</a> explains why.</p>
`,
  },
  {
    slug: 'how-to-download-all-images-from-a-page',
    footer: 'Download all images from a page',
    title: 'How to Download All Images From a Web Page at Once | Saveform',
    description: 'Three ways to save every image on a web page: the browser’s Save Page As, the developer tools, and a toolbar extension that lists the images and saves them as files, a ZIP or one PDF.',
    h1: 'How to download all images from a web page',
    lede: 'Saving pictures one by one with “Save image as…” gets old quickly on a gallery, a product page or a long article. Here are three ways to get all of them, what each one actually gives you, and where each falls short.',
    related: ['why-images-save-as-webp', 'how-to-save-webp-as-png'],
    converters: ['webp-to-png', 'webp-to-jpg', 'avif-to-jpg', 'image-to-pdf'],
    body: (root) => `
<h2>Before you start: scroll to the bottom</h2>
<p>Many pages load images only when they scroll into view, and some keep adding more as you go (endless feeds, search results). Whatever method you use, it can only see what the page has at that moment. Scroll through the whole page first, wait for the pictures to appear, and then save.</p>

<h2>Option 1: the browser’s “Save page as”</h2>
<p>Press <kbd>Ctrl</kbd>+<kbd>S</kbd> (<kbd>⌘</kbd>+<kbd>S</kbd> on a Mac) in Chrome, Edge or Firefox and choose the “complete” web page option in the file type list. The browser writes an HTML file and, next to it, a folder with the files the page used, images among them.</p>
<p>It needs nothing installed, but the result is rarely what you wanted:</p>
<ul>
  <li>The images sit among scripts, stylesheets, icons and tiny tracking images, and some may be renamed.</li>
  <li>You get the version the browser picked for your screen, not necessarily the largest one the site offers.</li>
  <li>Files keep the format the site sent, which today is often WebP or AVIF (<a href="${root}why-images-save-as-webp/">why that happens</a>).</li>
</ul>
<p>It works best for simple pages, or when you also want a copy of the text.</p>

<h2>Option 2: the developer tools</h2>
<p>Chrome, Edge and Firefox have built-in developer tools (<kbd>F12</kbd>, or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>). Open the <strong>Network</strong> panel, choose the images filter, and reload the page. You see every image the page downloads, with its address, type and size. Right-click an entry to open it in a new tab, then save it from there.</p>
<p>This is the most precise view of what a page loads, including images that come from stylesheets. It is also one image at a time, which is fine for five pictures and tedious for fifty.</p>
<p>Firefox has a handier built-in list: press <kbd>Ctrl</kbd>+<kbd>I</kbd> (<kbd>⌘</kbd>+<kbd>I</kbd> on a Mac) to open <em>Page Info</em> and go to the <strong>Media</strong> tab. It lists the page’s images, CSS backgrounds included. Click <strong>Select All</strong> (or pick several entries) and then <strong>Save As…</strong>, choose a folder, and they are saved in one go. They keep whatever format and size the site served.</p>

<h2>Option 3: the Saveform toolbar button</h2>
<p>We built the Saveform browser extension for exactly this job. Click its toolbar button, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, and a panel opens with every image on the current page in a grid, each with a preview and, where known, its size. It finds:</p>
<ul>
  <li>ordinary images, and for those that offer several sizes, the largest one the page lists rather than the one picked for your screen;</li>
  <li>images that have not loaded yet because they are waiting to scroll into view, where the page has already put their address in the markup;</li>
  <li>background images set with CSS, such as banners and gallery tiles, and video poster images.</li>
</ul>
<p>Then you choose what to keep and how to save it:</p>
<ol class="steps-list">
  <li><strong>Filter.</strong> “Hide smaller than” drops icons and buttons (100 px by default; 50, 200 and 400 px or show all are the other choices). Images whose size is not known yet are never hidden. Untick anything else you do not want, or use Select none and tick a few.</li>
  <li><strong>Pick a format.</strong> PNG, JPG or WebP converts every image on your device, so a page full of WebP and AVIF arrives as files your other software opens. <em>Original format</em> saves them unchanged. AVIF appears too where the browser can create it.</li>
  <li><strong>Pick the output.</strong> Separate files in your Downloads folder, <strong>one ZIP file</strong>, or <strong>one PDF</strong> with an image on each page, handy for a set of scanned pages or slides.</li>
  <li><strong>Save.</strong> The work continues in the background even if you close the panel. If a site does not let extensions read its images, Saveform lists those sites once and asks whether to allow them or skip those images, so a ZIP or PDF still ends up as a single file.</li>
</ol>
<p>Limits worth knowing: it lists up to 500 images per page, it cannot run on the browser’s own pages (settings, new tab, extension stores), and images the page has not added yet, such as the next screen of an endless feed, are not there to find. The same extension also adds <em>Save as PNG / JPG / WebP / PDF</em> to the right-click menu for single images.</p>
<p>Saveform is free in the <a href="${CWS_URL}" rel="noopener">Chrome Web Store</a> (it also installs in Edge and Brave); the Firefox version is in Mozilla’s review queue. <a href="${root}extension/">The extension page</a> explains every permission it asks for.</p>

<h2>Which one should you use?</h2>
<ul>
  <li>One-off, simple page, format does not matter: <strong>Save page as</strong>.</li>
  <li>You need to know exactly which file a page loads: <strong>developer tools</strong>, or Page Info in Firefox.</li>
  <li>You do this regularly, want the largest versions, or need JPG, PNG, a ZIP or a PDF: <strong>the toolbar button</strong>.</li>
</ul>
<p>Already saved a folder full of .webp or .avif files? Drop them on <a href="${root}webp-to-jpg/">WebP to JPG</a> or <a href="${root}image-to-pdf/">Image to PDF</a>; they are converted in your browser and can be downloaded together as a ZIP.</p>
`,
  },
  {
    slug: 'how-to-make-a-multi-page-tiff',
    footer: 'Make a multi-page TIFF',
    title: 'How to Combine Images Into One Multi-Page TIFF (and Split One) | Saveform',
    description: 'Combine JPG, PNG, HEIC and other images into one multi-page TIFF in your browser, split a multi-page TIFF into pages, and know when a PDF is the better choice.',
    h1: 'How to combine images into one multi-page TIFF, and split one',
    lede: 'Some document systems, archives and scanning workflows want several pages in a single TIFF file rather than a PDF. Here is how to build one from any mix of images without uploading them, how to take one apart again, and how to do both on the command line.',
    tool: { from: 'any', to: 'tiff' },
    toolTitle: 'Combine or split TIFF pages here',
    related: ['how-to-open-heic-files-on-windows', 'how-to-download-all-images-from-a-page'],
    converters: ['jpg-to-tiff', 'png-to-tiff', 'tiff-to-pdf', 'tiff-to-png'],
    body: (root) => `
<h2>What a multi-page TIFF is</h2>
<p>A TIFF file can hold several images one after another, each with its own size and settings. Scanners with a document feeder and fax software have long used this to keep a whole document in one file, and many document management, archiving and OCR (text recognition) systems still accept or expect it. Viewers vary, though: some simple ones show only the first page, so check that the software at the other end reads all of them.</p>

<h2>Combine images into one TIFF</h2>
<ol class="steps-list">
  <li>Drop the images on the box above, or click it to choose them. JPG, PNG, WebP, AVIF, GIF, BMP, iPhone HEIC photos and other TIFFs can be mixed; each page of a multi-page TIFF arrives as its own row.</li>
  <li>Check that <strong>Convert to</strong> is set to TIFF. Leave <strong>Compression</strong> on LZW, which is lossless and widely supported, unless the receiving software cannot read compressed TIFFs; then choose None.</li>
  <li>Put the rows in order with the <strong>↑</strong> and <strong>↓</strong> buttons and remove any you do not want with <strong>×</strong>. The order of the list is the order of the pages.</li>
  <li>Click <strong>Download one TIFF</strong>. Every converted row becomes one page of a single file.</li>
</ol>
<p>Each page is stored losslessly and keeps its own size. The page picks the smallest suitable layout for each image: 1-bit for pure black-and-white pages such as text scans, 8-bit greyscale for grey ones, RGB for colour, and RGB with an alpha channel when there is transparency. Every page is marked as 72 dpi, and metadata such as camera details and GPS location is not copied. The file is assembled inside your browser tab; nothing is uploaded.</p>

<h2>Split a multi-page TIFF into separate files</h2>
<p>Drop the TIFF on the same box. Each page appears as its own row, labelled with its page number, up to 500 pages per file. Choose the format you want for the pages: PNG keeps every pixel and opens almost anywhere, JPG makes small files for email, and TIFF gives one single-page TIFF per page. Then click <strong>Download all (ZIP)</strong>, or download single pages from their rows. Files are named after the original with <code>-page-1</code>, <code>-page-2</code> and so on.</p>
<p>The same steps reorder or thin out a multi-page TIFF: drop it in, move or remove rows, and click Download one TIFF to get a new file. Be aware that the pages are decoded and written again, not copied. Pixels are kept for ordinary 8-bit images, but 16-bit pages become 8-bit, CMYK pages become RGB, and fax pages compressed with CCITT Group 4 are stored with LZW instead, which usually makes them larger.</p>

<h2>Multi-page TIFF or PDF?</h2>
<ul>
  <li><strong>PDF</strong> when people will open the file. Every browser and phone shows it, and it prints at a proper page size. <a href="${root}image-to-pdf/">Image to PDF</a> builds one from the same kinds of images.</li>
  <li><strong>TIFF</strong> when a system asks for it: document management, archiving, some OCR and mapping tools, and older desktop software. It holds nothing but images, stored losslessly.</li>
  <li><strong>Fax</strong> is a special case. Fax services and software usually need black-and-white pages with CCITT compression at fax resolutions, which this page does not write. Use your fax program’s own export, or send a PDF if the service accepts one.</li>
</ul>

<h2>On the command line</h2>
<p>If you already use ImageMagick (version 7; older versions call the command <code>convert</code>), it combines any images it can read:</p>
<ul>
  <li>Combine: <code>magick page1.png page2.jpg -compress lzw combined.tif</code></li>
  <li>Split into PNGs: <code>magick combined.tif page-%d.png</code>, which numbers the pages from 0.</li>
</ul>
<p>The libtiff tools work on TIFF files only, but keep each page’s own bit depth and colour layout instead of converting it:</p>
<ul>
  <li>Combine: <code>tiffcp -c lzw a.tif b.tif combined.tif</code>, the last name being the output.</li>
  <li>Split: <code>tiffsplit combined.tif page-</code>, which writes <code>page-aaa.tif</code>, <code>page-aab.tif</code> and so on.</li>
</ul>
<p>Both run on your own computer, so like this page they never upload anything. For a one-off job, the box at the top of this page is usually quicker than installing them.</p>
`,
  },
];
