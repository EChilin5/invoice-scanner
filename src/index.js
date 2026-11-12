import "dotenv/config";
import fs from "node:fs";
import { authorize } from "./auth.js";
import { startPolling } from "./watcher.js";
import { getEmail } from "./gmail.js";
import { classify } from "./classifier.js";
import { emailToPdf } from "./pdf.js";
import { uploadToDropbox } from "./dropbox.js";
import { notifyInvoice, notifyReviewNeeded } from "./slack.js";

const auth = await authorize();

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
      // Upload the original attachments
      for (const a of email.attachments) {
        try {
          const dropboxPath = await uploadToDropbox(email, a, result);
          dropboxPaths.push(dropboxPath); // 3. NEW: collect each path
          console.log("Uploaded to Dropbox:", dropboxPath);
        } catch (err) {
          console.error(
            `Dropbox upload failed for ${a.filename}:`,
            err.message,
          );
        }
      }
    }

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
