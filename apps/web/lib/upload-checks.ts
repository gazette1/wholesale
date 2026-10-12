/** Upload rules shared by the lead, property, and buyer document actions and the Workflow Forms file service. */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const startsWith = (bytes: number[], at = 0) => (b: Buffer) => bytes.every((v, i) => b[at + i] === v);
const ascii = (text: string, at = 0) => startsWith(Array.from(text, (c) => c.charCodeAt(0)), at);
const looksLikeText = (b: Buffer) => !b.subarray(0, 4096).includes(0);
const isZip = startsWith([0x50, 0x4b, 0x03, 0x04]);

export type FileRule = { mime: string; accepts: string[]; magic: (b: Buffer) => boolean };

/**
 * The allow list, keyed by extension. `mime` is what gets stored; `accepts` is what a browser may report for that extension
 * (Windows reports a .csv as an Excel file). The browser's type is only a claim, so `magic` checks the first bytes as well.
 */
export const FILE_TYPES: Record<string, FileRule> = {
  pdf: { mime: "application/pdf", accepts: ["application/pdf"], magic: (b) => b.subarray(0, 1024).includes("%PDF-") },
  png: { mime: "image/png", accepts: ["image/png"], magic: startsWith([0x89, 0x50, 0x4e, 0x47]) },
  jpg: { mime: "image/jpeg", accepts: ["image/jpeg"], magic: startsWith([0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", accepts: ["image/jpeg"], magic: startsWith([0xff, 0xd8, 0xff]) },
  webp: { mime: "image/webp", accepts: ["image/webp"], magic: (b) => ascii("RIFF")(b) && ascii("WEBP", 8)(b) },
  heic: { mime: "image/heic", accepts: ["image/heic", "image/heif"], magic: ascii("ftyp", 4) },
  heif: { mime: "image/heif", accepts: ["image/heic", "image/heif"], magic: ascii("ftyp", 4) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", accepts: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], magic: isZip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", accepts: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], magic: isZip },
  csv: { mime: "text/csv", accepts: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"], magic: looksLikeText },
  txt: { mime: "text/plain", accepts: ["text/plain"], magic: looksLikeText },
};
export const ALLOWED_LABEL = "PDF, PNG, JPEG, WebP, HEIC, Word (.docx), Excel (.xlsx), CSV, or plain text";

/** Name used in the storage path: last path segment, ASCII letters, digits, dot, dash, underscore. Never starts with a dot. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._-]+/, "");
  const dot = cleaned.lastIndexOf(".");
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 100) || "file";
  const ext = dot > 0 ? cleaned.slice(dot).toLowerCase().slice(0, 12) : "";
  return `${stem}${ext}`;
}

/** Name, size, and declared type checks that need no file bytes. */
export function checkUploadFile(file: unknown): { ok: true; file: File; safeName: string; rule: FileRule } | { ok: false; error: string } {
  if (!(file instanceof File) || !file.name) return { ok: false, error: "Choose a file to upload." };
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Files are limited to 25 MB." };
  const safeName = safeFilename(file.name);
  const rule = FILE_TYPES[safeName.split(".").pop() ?? ""];
  const claimed = file.type.toLowerCase();
  if (!rule || !safeName.includes(".") || (claimed && claimed !== "application/octet-stream" && !rule.accepts.includes(claimed))) return { ok: false, error: `That file type is not allowed. Upload a ${ALLOWED_LABEL} file.` };
  return { ok: true, file, safeName, rule };
}

/** Checks on the bytes actually received: whole, within the limit, and matching the extension. */
export function checkUploadBytes(data: Buffer, declaredSize: number, rule: FileRule): { ok: true } | { ok: false; error: string } {
  if (data.length !== declaredSize || data.length > MAX_UPLOAD_BYTES) return { ok: false, error: "The upload did not arrive whole. Try again." };
  if (!rule.magic(data)) return { ok: false, error: "The file contents do not match its extension." };
  return { ok: true };
}

/** Display name kept on the document row: last path segment without control characters. */
export function displayFilename(name: string, fallback: string): string {
  return (name.split(/[\\/]/).pop() ?? "").replace(/\p{Cc}/gu, "").trim().slice(0, 200) || fallback;
}
