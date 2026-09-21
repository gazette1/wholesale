/**
 * RFC 4180 CSV parser and serializer. Pure functions, no dependency.
 * Handles quoted fields, escaped quotes (""), commas and line breaks inside quotes,
 * CRLF or LF row endings, and a leading UTF-8 byte order mark.
 */

/** UTF-8 byte order mark. Excel needs it to read UTF-8 exports; imports strip it. */
const BOM = String.fromCharCode(0xfeff);

/** Parse CSV text into rows of string cells. Fully blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellWasQuoted = false;
  const endCell = () => { row.push(cell); cell = ""; cellWasQuoted = false; };
  const endRow = () => {
    const blank = row.length === 0 && cell === "" && !cellWasQuoted;
    if (!blank) { endCell(); rows.push(row); }
    row = []; cell = ""; cellWasQuoted = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "" && !cellWasQuoted) { inQuotes = true; cellWasQuoted = true; }
    else if (ch === ",") endCell();
    else if (ch === "\r") { if (src[i + 1] === "\n") i++; endRow(); }
    else if (ch === "\n") endRow();
    else cell += ch;
  }
  if (cell !== "" || cellWasQuoted || row.length > 0) endRow();
  return rows;
}

/** Parse CSV text whose first row is a header. Header names and cells are trimmed. Short rows are padded with "". */
export function parseCsvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) rec[h] = (r[i] ?? "").trim(); });
    return rec;
  });
  return { headers, records };
}

/**
 * Spreadsheet formula injection guard. A cell that starts with =, +, -, @, tab, or carriage return
 * is prefixed with a single quote so Excel and Google Sheets treat it as text.
 * Plain negative numbers (for example -5000 or -12.5) are left alone because they cannot execute.
 */
export function guardFormulaCell(value: string): string {
  if (value === "") return value;
  if (/^-\d+(\.\d+)?$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Quote a cell when it contains a comma, a quote, a line break, or leading or trailing whitespace. */
export function escapeCsvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize rows to CSV with CRLF row endings. Formula guarding is on by default; pass guardFormulas false for a raw round trip. */
export function toCsv(rows: unknown[][], opts: { guardFormulas?: boolean; bom?: boolean } = {}): string {
  const guard = opts.guardFormulas !== false;
  const body = rows.map((r) => r.map((c) => { const s = cellToString(c); return escapeCsvCell(guard ? guardFormulaCell(s) : s); }).join(",")).join("\r\n");
  return (opts.bom ? BOM : "") + body + (rows.length ? "\r\n" : "");
}

/** Serialize objects using the given column order. The header row is written first and is not formula guarded. */
export function recordsToCsv(columns: string[], records: Record<string, unknown>[], opts: { guardFormulas?: boolean; bom?: boolean } = {}): string {
  const header = columns.map((c) => escapeCsvCell(c)).join(",");
  const rest = toCsv(records.map((r) => columns.map((c) => r[c])), { guardFormulas: opts.guardFormulas });
  return (opts.bom ? BOM : "") + header + "\r\n" + rest;
}
