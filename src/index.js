import "dotenv/config";
import fs from "node:fs";
import { authorize } from "./auth.js";
import { startPolling } from "./watcher.js";
import { getEmail } from "./gmail.js";
import { classify } from "./classifier.js";
import { emailToPdf } from "./pdf.js";
import { uploadToDropbox } from "./dropbox.js";
import { notifyInvoice, notifyReviewNeeded } from "./slack.js";
import { file } from "googleapis/build/src/apis/file/index.js";

const auth = await authorize();

const norm = (s) => String(s ?? '').trim().toLowerCase();

function findInvoiceAttachment(email, filename) {

  if (!filename) return null;

  // 1. Exact match
  let match = email.attachments.find((a) => a.filename === filename);
  if (match) return match;

  // 2. Case and whitespace-insensitive match
  match = email.attachments.find((a) => norm(a.filename) === norm(filename));
  if (match) return match;

  // 3. One name contains the other (Claude may have shortened it)
  const matches = email.attachments.filter(
    (a) => norm(a.filename).includes(norm(filename)) || norm(filename).includes(norm(a.filename))
  );
  return matches.length === 1 ? matches[0] : null; // only trust an unambiguous match
}

await startPolling(auth, async (id) => {
  // pulls the email data
  const email = await getEmail(auth, id);

  // skips any dead
  if (!email) return; // skip and move on, don't fail the whole poll

  // Don't classify if any attachment couldn't be read
  if (email.failedAttachments?.length > 0) {
    console.log("----------------------------------------");
    console.log("Subject:   ", email.subject);
    console.log(
      "Skipped classification, attachments failed:",
      email.failedAttachments.join(", "),
    );
    console.log("** NEEDS REVIEW **");
    return;
  }

  // determines whther it's an invoice
  const result = await classify(email);

  console.log("----------------------------------------");
  console.log("Subject:   ", email.subject);
  console.log("Invoice?   ", result.is_invoice, `(${result.confidence})`);
  console.log("Type:      ", result.document_type);
  console.log("Reason:    ", result.reason);
  console.log("Vendor:    ", result.vendor_name);
  console.log("Invoice #: ", result.invoice_number);
  console.log("Issued:    ", result.invoice_date, "| Due:", result.due_date);
  console.log("Amount:    ", result.amount_due, result.currency);
  console.log("Attachement Read:    ", result.attachment_read);

  if (result.needs_review) console.log("** NEEDS REVIEW **");

     if (result.is_invoice && result.confidence >= 0.7) {
  if(['email steps', 'email url'].includes(result.document_type)){
    notifyReviewNeeded(email, result)
    console.log("An email with steps or url was found");

  }else{

    const dropboxPaths = []; // 1. NEW: declare the array

    if (email.attachments.length === 0) {
      const pdfPath = await emailToPdf(email);
      console.log("Saved email PDF:", pdfPath);
      try {
        const emailPdf = {
          filename: "email.pdf",
          buffer: fs.readFileSync(pdfPath),
        };
        const dropboxPath = await uploadToDropbox(email, emailPdf, result);
        dropboxPaths.push(dropboxPath); // 2. NEW: collect the path
        console.log("Uploaded email PDF to Dropbox:", dropboxPath);
      } catch (err) {
        console.error("Dropbox upload failed for email PDF:", err.message);
        console.error("Details:", JSON.stringify(err.error ?? err, null, 2));
      }
    } else {
  const invoiceFile = findInvoiceAttachment(email, result.attachment_read);

  if (invoiceFile) {
    try {
      dropboxPaths.push(await uploadToDropbox(email, invoiceFile, result));
      console.log('Uploaded to Dropbox:', dropboxPaths[0]);
    } catch (err) {
      console.error(`Dropbox upload failed for ${invoiceFile.filename}:`, err.message);
    }
  } else {
    // Claude gave no filename, or it matched nothing: don't guess silently
    console.warn('No matching attachment for:', result.invoice_filename);
    result.needs_review = true;
    // Fallback: upload every attachment so nothing is lost
    for (const a of email.attachments) {
      try {
        dropboxPaths.push(await uploadToDropbox(email, a, result));
      } catch (err) {
        console.error(`Dropbox upload failed for ${a.filename}:`, err.message);
      }
    }
  }
}
      // Upload the original attachments

      // for (const a of email.attachments) {
      //   try {
      //     const dropboxPath = await uploadToDropbox(email, a, result);
      //     dropboxPaths.push(dropboxPath); // 3. NEW: collect each path
      //     console.log("Uploaded to Dropbox:", dropboxPath);
      //   } catch (err) {
      //     console.error(
      //       `Dropbox upload failed for ${a.filename}:`,
      //       err.message,
      //     );
      //   }
      // }
    

    // Flag invoices where key fields are missing
    if (result.amount_due == null || !result.vendor_name){
            result.needs_review = true;

    }

    try {
      await notifyInvoice(email, result, dropboxPaths);
      console.log("Slack notification sent");
    } catch (err) {
      console.error("Slack notification failed:", err.message);
    }
  }
  }

  


});

console.log("Watching for new mail... (Ctrl+C to stop)");
