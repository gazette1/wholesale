"use server";
import { requestFormPurge } from "./forms";
import type { ActionResult } from "./leads";

/** FormData adapter for the purge request form. The value is "<type>:<id>". */
export async function requestFormPurgeFromForm(form: FormData): Promise<ActionResult> {
  const [targetType, targetId] = String(form.get("target") ?? "").split(":");
  if (targetType !== "external_party" && targetType !== "buyer" && targetType !== "contact") return { ok: false, error: "Choose the person whose data should be removed." };
  return requestFormPurge({ targetType, targetId: targetId ?? "", requestReference: String(form.get("requestReference") ?? "") });
}
