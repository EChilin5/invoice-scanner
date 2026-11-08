import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

// remove any html symbols left from the body
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function emailToPdf(email, outDir = 'attachments') {
    // creates the default file in attachments
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${email.id}_email.pdf`);

  // Use the original HTML if there is any, otherwise the plain-text body
  const content = email.html
    ? email.html
    : `<pre style="white-space:pre-wrap;font-family:inherit">${esc(email.body)}</pre>`;

  const html = `<!doctype html>
<meta charset="utf-8">
<body style="font-family:Arial,sans-serif;font-size:12px">
  <div style="border-bottom:1px solid #999;margin-bottom:14px;padding-bottom:8px">
    <div><b>Subject:</b> ${esc(email.subject)}</div>
    <div><b>From:</b> ${esc(email.from)}</div>
    <div><b>Date:</b> ${esc(email.date)}</div>
  </div>
  ${content}
</body>`;

 // opens the email in browser does not count as a read email
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Email HTML is untrusted: no scripts, and no network requests
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') req.continue();
      else req.abort(); // blocks remote images and tracking pixels
    });

    // loads html into the page 
    // waits for it to load and then saves it
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();
  }
  return outPath;
}