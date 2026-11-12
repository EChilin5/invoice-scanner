import { Dropbox } from 'dropbox';
import { extname } from 'node:path';

const dbx = new Dropbox({
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN, // SDK refreshes access tokens automatically
});

// Lowercase, letters/numbers only, underscores between words.
// Also makes every value safe to use in a Dropbox path.
// "Adobe Inc." -> "adobe_inc"
// const slug = (s, fallback) =>
//   String(s ?? '')
//     .normalize('NFC')
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '_')
//     .replace(/^_+|_+$/g, '')
//     .slice(0, 60) || fallback;
const slug = (s, fallback) =>
  String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || fallback;



// Prefer the invoice date Claude extracted (YYYY-MM-DD); fall back to the email date
function getDateParts(result, email) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result.invoice_date ?? '');
  if (m) return { year: m[1], month: m[2], day: m[3] };

  const parsed = new Date(email.date);
  const d = isNaN(parsed) ? new Date() : parsed;
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, '0'), // getMonth() is 0-based
    day: String(d.getDate()).padStart(2, '0'),
  };
}

// Target: /Finances/invoices/2026/2026_10/adobe_receipt_2026.10.21.pdf
export async function uploadToDropbox(email, attachment, result) {
  const { year, month, day } = getDateParts(result, email);
  const vendor = slug(result.vendor_name, 'unknown_vendor');
  const doctype = slug(result.document_type, 'document');
  const ext = extname(attachment.filename ?? '')
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, '');

  const dropboxPath =
    `/Finances/invoices/${year}/${year}_${month}/` +
    `${vendor}_${doctype}_${year}.${month}.${day}${ext}`;

  const { result: meta } = await dbx.filesUpload({
    path: dropboxPath,
    contents: attachment.buffer,
    mode: { '.tag': 'add' },
    autorename: true, // if the name exists, Dropbox adds " (1)" instead of overwriting
    mute: true,
  });
  return meta.path_display;
}