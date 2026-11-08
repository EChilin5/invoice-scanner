import "dotenv/config";
import { authorize } from "./auth.js";
import { startPolling } from "./watcher.js";
import { getEmail } from "./gmail.js";
import { classify } from "./classifier.js";
import { emailToPdf } from './pdf.js';


const auth = await authorize();

await startPolling(auth, async (id) => {
  
// pulls the email data
  const email = await getEmail(auth, id);

  // skips any dead 
  if (!email) return; // skip and move on, don't fail the whole poll

      // Don't classify if any attachment couldn't be read
    if (email.failedAttachments?.length > 0) {
      console.log('----------------------------------------');
      console.log('Subject:   ', email.subject);
      console.log('Skipped classification, attachments failed:', email.failedAttachments.join(', '));
      console.log('** NEEDS REVIEW **');
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

// inside the handler, after classify:
if (result.is_invoice && result.confidence >= 0.7) {
  const pdfPath = await emailToPdf(email);
  console.log('Saved email PDF:', pdfPath);
}

});

console.log("Watching for new mail... (Ctrl+C to stop)");
