import { google } from "googleapis";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // skip files over 10 MB for the prototype

const decode = (data) => Buffer.from(data, "base64url").toString("utf8");

const headerValue = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

// removes html text from the email body
function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Walk the MIME tree of the emails, collects it and sorts into text, html, and attachment references
function walk(part, out) {
  if (part.filename) {
    out.attachmentRefs.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId,
      inlineData: part.body?.data, // present for very small attachments
    });
  } else if (part.mimeType === "text/plain" && part.body?.data) {
    out.text += decode(part.body.data);
  } else if (part.mimeType === "text/html" && part.body?.data) {
    out.html += decode(part.body.data);
  }
  for (const child of part.parts ?? []) walk(child, out);
}

export async function getEmail(auth, id) {
  const gmail = google.gmail({ version: "v1", auth });

  // Fatal errors: without the message there is nothing to classify
  let msg;
  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    msg = res.data;
  } catch (err) {
    console.error(`Failed to fetch email ${id}:`, err.message);
    throw new Error(`Could not fetch email ${id}: ${err.message}`);
  }

  if (!msg?.payload) {
    throw new Error(`Email ${id} has no payload`);
  }

  const out = { text: "", html: "", attachmentRefs: [] };
  try {
    walk(msg.payload, out);
  } catch (err) {
    console.error(`Failed to parse email ${id}:`, err.message);
    throw new Error(`Could not parse email ${id}: ${err.message}`);
  }

  // Non-fatal errors: one bad attachment shouldn't lose the whole email
  const attachments = [];
  const failedAttachments = [];

  for (const ref of out.attachmentRefs) {
    if (ref.size > MAX_ATTACHMENT_BYTES) {
      console.warn(
        `Skipping large attachment: ${ref.filename} (${ref.size} bytes)`,
      );
      failedAttachments.push(ref.filename);
      continue;
    }

    try {
      let buffer;
      if (ref.attachmentId) {
        const { data } = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: id,
          id: ref.attachmentId,
        });
        buffer = Buffer.from(data.data, "base64url");
      } else if (ref.inlineData) {
        buffer = Buffer.from(ref.inlineData, "base64url");
      } else {
        continue;
      }
      attachments.push({
        filename: ref.filename,
        mimeType: ref.mimeType,
        buffer,
      });
    } catch (err) {
      console.error(
        `Failed to download attachment ${ref.filename}:`,
        err.message,
      );
      failedAttachments.push(ref.filename);
    }
  }

  const headers = msg.payload.headers ?? [];
  return {
    id,
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From"),
    date: headerValue(headers, "Date"),
    body: out.text || stripHtml(out.html),
    attachments,
    failedAttachments, // lets the caller flag the email for review
  };
}

// Lightweight version from the previous step
export async function getSubject(auth, id) {
  const gmail = google.gmail({ version: "v1", auth });
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "Date"],
  });
  const headers = data.payload?.headers ?? [];
  return {
    id,
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From"),
    date: headerValue(headers, "Date"),
  };
}
