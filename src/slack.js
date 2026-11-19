// Slack formatting treats & < > specially, and email content is untrusted
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );

function formatAmount(amount, currency) {
  if (amount == null) return "not found";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim(); // currency code wasn't valid
  }
}

async function post(payload) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.warn("SLACK_WEBHOOK_URL not set, skipping Slack notification");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000), // never let Slack hang the pipeline
  });
  if (!res.ok)
    throw new Error(`Slack responded ${res.status}: ${await res.text()}`);
}

export async function notifyInvoice(email, result, files = []) {
  const confidence = Number.isFinite(result.confidence)
    ? Math.round(result.confidence * 100)
    : null;

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "<!channel>" },
    },
    {
      type: "header",
      text: { type: "plain_text", text: "New invoice detected" },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Vendor*\n${esc(result.vendor_name ?? "not found")}`,
        },
        {
          type: "mrkdwn",
          text: `*Amount due*\n${esc(formatAmount(result.amount_due, result.currency))}`,
        },
        {
          type: "mrkdwn",
          text: `*Invoice #*\n${esc(result.invoice_number ?? "not found")}`,
        },
        {
          type: "mrkdwn",
          text: `*Due date*\n${esc(result.due_date ?? "not found")}`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Subject:* ${esc(email.subject)}\n` +
          `*From:* ${esc(email.from)}\n` +
          `*Confidence:* ${confidence ?? "n/a"}${confidence != null ? "%" : ""}`,
      },
    },
  ];

  if (files.length > 0) {
    const lines = files.map((f) =>
      f.url ? `• <${f.url}|${esc(f.path)}>` : `• ${esc(f.path)}`,
    );
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Saved to Dropbox:*\n${lines.join("\n")}`,
      },
    });
  } else {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ":x: Dropbox upload failed. File was not saved.",
        },
      ],
    });
  }

  if (result.needs_review) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ":warning: Some fields are missing. Please review before paying.",
        },
      ],
    });
  }

  await post({
    text: ` New invoice from ${result.vendor_name ?? email.from}`,
    blocks,
  });
}

export async function notifyReviewNeeded(email, result, emailType) {
  const vendor = result?.vendor_name ?? email.from ?? "Unknown vendor";

  await post({
    text: `Please check this email: ${email.subject} (${vendor})`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `:eyes: *Please check this email*\n` +
            `This email contains a ${emailType} that directs you to an invoice.\n` +
            `*Vendor:* ${esc(vendor)}\n` +
            `*Subject:* ${esc(email.subject)}\n` +
            `<!channel>`,
        },
      },
    ],
  });
}

export async function notifyError(message) {
  await post({ text: `:rotating_light: Invoice Scanner: ${esc(message)}` });
}
