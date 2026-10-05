/**
 * Rules for message templates, shared by the template form (client) and saveTemplate (server).
 * The field names match what sendToLead passes to renderTemplate. renderTemplate turns an unknown
 * field into an empty string, so a typo would send a message with a hole in it.
 */
export const MERGE_FIELDS = ["first_name", "last_name", "property_address", "city", "sender_name"] as const;

export const MERGE_FIELD_HELP = MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ");

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Every merge field named in the text, once each. */
export function mergeFieldsIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(TOKEN)).map((m) => m[1]!)));
}

/** Merge fields in the text that the sender does not fill in. */
export function unknownMergeFields(text: string): string[] {
  const known = new Set<string>(MERGE_FIELDS);
  return mergeFieldsIn(text).filter((f) => !known.has(f));
}

export const SMS_MAX_CHARS = 1600;
export const EMAIL_MAX_CHARS = 20000;
export const SUBJECT_MAX_CHARS = 200;
export const TEMPLATE_NAME_MAX_CHARS = 120;

// Characters outside the basic GSM alphabet (curly quotes, emoji, most accents) force the
// carrier to use a 16 bit encoding, which drops a segment from 160 to 70 characters.
const GSM_ONLY = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑܧ¿äöñüà^{}\\[~\]|€]*$/;

/** One segment holds 160 characters. A longer text is split into segments of 153. */
export function smsSegments(text: string): { characters: number; segments: number; unicode: boolean } {
  const characters = text.length;
  const unicode = !GSM_ONLY.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { characters, segments, unicode };
}

export function smsCountLabel(text: string): string {
  const { characters, segments, unicode } = smsSegments(text);
  const base = `${characters} character${characters === 1 ? "" : "s"}, ${segments} segment${segments === 1 ? "" : "s"}`;
  return unicode ? `${base} (special characters shorten each segment to 70)` : base;
}
