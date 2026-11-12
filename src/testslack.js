import 'dotenv/config';
import { notifyInvoice } from './slack.js';

await notifyInvoice(
  { subject: 'Test invoice', from: 'billing@example.com' },
  {
    confidence: 0.93, vendor_name: 'Acme Co', invoice_number: 'INV-1042',
    amount_due: 1234.5, currency: 'USD', due_date: '2026-12-01', needs_review: false,
  },
  ['/invoices/2026-11/Acme_Co/test_invoice.pdf']
);
console.log('Sent');