// Slack formatting treats & < > specially, and email content is untrusted
const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function formatAmount(amount, currency) {
  if (amount == null) return 'not found';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim(); // currency code wasn't valid
  }
}

async function post(payload) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.warn('SLACK_WEBHOOK_URL not set, skipping Slack notification');
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000), // never let Slack hang the pipeline
  });
  if (!res.ok) throw new Error(`Slack responded ${res.status}: ${await res.text()}`);
}

export async function notifyInvoice(email, result, dropboxPaths = []) {
  const confidence = Math.round(result.confidence * 100);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'New invoice detected' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Vendor*\n${esc(result.vendor_name ?? 'not found')}` },
        { type: 'mrkdwn', text: `*Amount due*\n${esc(formatAmount(result.amount_due, result.currency))}` },
        { type: 'mrkdwn', text: `*Invoice #*\n${esc(result.invoice_number ?? 'not found')}` },
        { type: 'mrkdwn', text: `*Due date*\n${esc(result.due_date ?? 'not found')}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Subject:* ${esc(email.subject)}\n` +
          `*From:* ${esc(email.from)}\n` +
          `*Confidence:* ${confidence}%`,
      },
    },
  ];

  if (dropboxPaths.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Saved to Dropbox:*\n${dropboxPaths.map((p) => `\`${esc(p)}\``).join('\n')}`,
      },
    });
  }

  if (result.needs_review) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ':warning: Some fields are missing. Please review before paying.' }],
    });
  }

  // `text` is the fallback shown in push notifications
  await post({
    text: `New invoice from ${result.vendor_name ?? email.from}`,
    blocks,
  });
}

export async function notifyReviewNeeded(email, result,) {
  const vendor = result?.vendor_name ?? email.from ?? 'Unknown vendor';

  await post({
    text: `Please check this email: ${email.subject} (${vendor})`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `:eyes: *Please check this email*\n` +
            `*Vendor:* ${esc(vendor)}\n` +
            `*Subject:* ${esc(email.subject)}`,
        },
      },
    ],
  });
}

export async function notifyError(message) {
  await post({ text: `:rotating_light: Invoice Scanner: ${esc(message)}` });
}