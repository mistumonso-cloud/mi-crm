/**
 * upload-attachment.ts — Subir archivos como attachments a issues de Linear
 *
 * Linear usa Google Cloud Storage para attachments. El flow:
 *   1. Pides un signed URL al API de Linear
 *   2. Subes el archivo directo a GCS con HTTP PUT
 *   3. Vinculas el archivo a la issue con attachmentLinkURL mutation
 *
 * Uso:
 *   import { uploadAttachment } from "./upload-attachment";
 *   await uploadAttachment({
 *     client,
 *     issueId: "ENG-42",
 *     file: { path: "./screenshot.png", contentType: "image/png" }
 *   });
 *
 * O via CLI:
 *   ts-node upload-attachment.ts --issue ENG-42 --file ./screenshot.png
 */

import * as fs from "fs";
import * as path from "path";
import { LinearMinClient } from "./linear-client";

interface UploadOptions {
  client: LinearMinClient;
  issueId: string;
  file: {
    path: string;
    contentType?: string;
  };
  /** Optional title for the attachment. Default: filename. */
  title?: string;
  /** Optional subtitle. */
  subtitle?: string;
}

const FILE_UPLOAD_QUERY = `
  query FileUpload($size: Int!, $contentType: String!, $filename: String!) {
    fileUpload(size: $size, contentType: $contentType, filename: $filename) {
      uploadFile {
        uploadUrl
        assetUrl
        contentType
        filename
        size
        headers {
          key
          value
        }
      }
    }
  }
`;

const ATTACHMENT_LINK_URL_MUTATION = `
  mutation AttachmentLinkURL($input: AttachmentInput!) {
    attachmentCreate(input: $input) {
      success
      attachment {
        id
        title
        url
      }
    }
  }
`;

const ISSUE_BY_IDENTIFIER_QUERY = `
  query IssueByIdentifier($id: String!) {
    issue(id: $id) {
      id
      identifier
    }
  }
`;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".log": "text/plain",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".zip": "application/zip",
};

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || "application/octet-stream";
}

/**
 * Sube un archivo y lo adjunta a una issue de Linear.
 */
export async function uploadAttachment(opts: UploadOptions): Promise<{
  attachmentId: string;
  attachmentUrl: string;
  assetUrl: string;
}> {
  const { client, issueId, file } = opts;

  // 1. Validar archivo
  if (!fs.existsSync(file.path)) {
    throw new Error(`File not found: ${file.path}`);
  }
  const stat = fs.statSync(file.path);
  if (stat.size === 0) throw new Error("File is empty");

  const contentType = file.contentType || inferContentType(file.path);
  const filename = path.basename(file.path);

  // 2. Resolver UUID si recibimos identifier
  let resolvedIssueId = issueId;
  if (/^[A-Z]+-\d+$/.test(issueId)) {
    const data = await client.query(ISSUE_BY_IDENTIFIER_QUERY, { id: issueId });
    if (!data.issue) throw new Error(`Issue not found: ${issueId}`);
    resolvedIssueId = data.issue.id;
  }

  // 3. Pedir signed URL
  console.log(`Requesting upload URL for ${filename} (${stat.size} bytes, ${contentType})...`);
  const uploadInfo = await client.query(FILE_UPLOAD_QUERY, {
    size: stat.size,
    contentType,
    filename,
  });

  const file_info = uploadInfo.fileUpload?.uploadFile;
  if (!file_info) throw new Error("Failed to get upload URL");

  // 4. Subir archivo a GCS
  console.log(`Uploading to ${maskUrl(file_info.uploadUrl)}...`);
  const fileBuffer = fs.readFileSync(file.path);

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": stat.size.toString(),
  };
  for (const h of file_info.headers || []) {
    headers[h.key] = h.value;
  }

  const uploadResp = await fetch(file_info.uploadUrl, {
    method: "PUT",
    headers,
    body: fileBuffer as any,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => "");
    throw new Error(`GCS upload failed: ${uploadResp.status} ${uploadResp.statusText} ${text.slice(0, 200)}`);
  }

  console.log("Upload OK. Linking to issue...");

  // 5. Crear attachment vinculando el assetUrl a la issue
  const result = await client.query(ATTACHMENT_LINK_URL_MUTATION, {
    input: {
      issueId: resolvedIssueId,
      url: file_info.assetUrl,
      title: opts.title || filename,
      subtitle: opts.subtitle || `${(stat.size / 1024).toFixed(1)} KB`,
      iconUrl: iconForContentType(contentType),
      // metadata opcional para preservar info adicional
      metadata: {
        size: stat.size,
        filename,
        contentType,
      },
    },
  });

  if (!result.attachmentCreate.success) {
    throw new Error("Failed to create attachment");
  }

  return {
    attachmentId: result.attachmentCreate.attachment.id,
    attachmentUrl: result.attachmentCreate.attachment.url,
    assetUrl: file_info.assetUrl,
  };
}

function iconForContentType(ct: string): string | undefined {
  if (ct.startsWith("image/")) return "https://uploads.linear.app/icons/image.svg";
  if (ct === "application/pdf") return "https://uploads.linear.app/icons/pdf.svg";
  return undefined;
}

function maskUrl(url: string): string {
  // Oculta query string sensible para logging
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}?...`;
  } catch {
    return "(invalid url)";
  }
}

// ====================================================================
// CLI
// ====================================================================

interface CLIArgs {
  issue: string;
  file: string;
  title?: string;
  subtitle?: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const out: any = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--issue") { out.issue = next; i++; }
    else if (arg === "--file") { out.file = next; i++; }
    else if (arg === "--title") { out.title = next; i++; }
    else if (arg === "--subtitle") { out.subtitle = next; i++; }
  }
  if (!out.issue || !out.file) {
    throw new Error("Required: --issue <ENG-X|UUID> --file <path>");
  }
  return out;
}

if (require.main === module) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("Set LINEAR_API_KEY env var");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const client = new LinearMinClient({ apiKey });

  uploadAttachment({
    client,
    issueId: args.issue,
    file: { path: args.file },
    title: args.title,
    subtitle: args.subtitle,
  })
    .then((result) => {
      console.log("\n✅ Attached to issue.");
      console.log("   Asset URL:", result.assetUrl);
      console.log("   Attachment ID:", result.attachmentId);
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
