import 'dotenv/config';
import { authorize } from './auth.js';
import { startPolling } from './watcher.js';
import { getEmail } from './gmail.js';
import { classify } from './classifier.js';

const auth = await authorize();

await startPolling(auth, async (id) => {
  const email = await getEmail(auth, id);
  const result = await classify(email);

  console.log('----------------------------------------');
  console.log('Subject:   ', email.subject);
  console.log('Invoice?   ', result.is_invoice, `(${result.confidence})`);
  console.log('Type:      ', result.document_type);
  console.log('Reason:    ', result.reason);
  if (result.needs_review) console.log('** NEEDS REVIEW **');
});

console.log('Watching for new mail... (Ctrl+C to stop)');