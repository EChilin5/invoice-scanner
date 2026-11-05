import { google } from "googleapis";
import { convert } from "html-to-text";


const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // keep prototype requests small and cheap

const decode = (data) => Buffer.from(data, "base64url").toString("utf8");

const headerValue = (headers, name) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";


// // removes html text from the email body
// const ENTITIES = {
//   nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
//   euro: "€", pound: "£", yen: "¥", cent: "¢", dollar: "$",
// };

// function decodeEntities(s) {
//   return s
//     .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
//     .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
//     .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
// }

// function stripHtml(html) {
//   const text = html
//     .replace(/<!--[\s\S]*?-->/g, "")
//     .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
//     .replace(/<br\s*\/?>/gi, "\n")
//     .replace(/<\/(td|th)>/gi, "\t")            // keep label and amount in the same row
//     .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
//     .replace(/<[^>]+>/g, "");

//   return decodeEntities(text)
//     .replace(/[ \u00a0]+/g, " ")               // collapse spaces, not newlines
//     .replace(/[ \t]*\n[ \t]*/g, "\n")
//     .replace(/\n{3,}/g, "\n\n")
//     .trim();
// }


const htmlToText = (html) =>
  convert(html, {
    wordwrap: false,
    baseElements: { selectors: ["body"], returnDomByDefault: true }, // ignores <head>
    limits: { maxInputLength: 500000 },                              // guards against huge emails
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },              // drops long tracking URLs
      {
        selector: "table",
        format: "dataTable",
        options: { uppercaseHeaderCells: false, maxColumnWidth: 200 },
      },
    ],
  })
    .replace(/[ \u00a0]+\n/g, "\n")   // trailing spaces
    .replace(/\n{3,}/g, "\n\n")       // excess blank lines
    .trim();

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
    console.log("__________________________________")
   const status = err.code ?? err.response?.status;
    if (status === 404) {
      // Message was deleted/moved between listing and fetching
      console.warn(`Email ${id} no longer exists, skipping`);
      return null;
    }
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
  const plain = out.text.trim();
const fromHtml = out.html ? htmlToText(out.html) : "";

// Prefer HTML unless the plain text is clearly as complete
const body_text = fromHtml.length > plain.length ? fromHtml : plain;
  return {
    id,
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From"),
    date: headerValue(headers, "Date"),
    body: body_text,
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
