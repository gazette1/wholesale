"use client";
import { useState } from "react";
import { requestFillCode, verifyFillCode, type FillResult } from "@/lib/actions/form-external";
import { useServerForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";

type Props = { token: string; kind: "invite" | "public"; maskedEmail?: string; maskedPhone?: string };

/** One time code sign in. Messages come from the server and never say whether a contact exists. */
export function FillSignIn({ token, kind, maskedEmail, maskedPhone }: Props) {
  const [channel, setChannel] = useState<"email" | "sms">(kind === "invite" && !maskedEmail && maskedPhone ? "sms" : "email");
  const [sent, setSent] = useState<string | null>(null);

  const send = useServerForm(async (form) => {
    const contact = kind === "public" ? String(form.get("contact") ?? "").trim() : undefined;
    if (kind === "public" && !contact) return { ok: false, error: channel === "sms" ? "Enter your phone number." : "Enter your email." };
    return requestFillCode(token, channel, contact);
  }, { onSuccess: (r) => setSent(r.message ?? "If the details are correct, a code is on its way.") });

  const verify = useServerForm(async (form) => {
    const r: FillResult = await verifyFillCode(token, String(form.get("code") ?? "").trim());
    return r;
  }, {
    onSuccess: (r) => {
      const to = (r as FillResult & { redirectTo?: string }).redirectTo;
      window.location.assign(to && to.startsWith("/fill/") ? to : `/fill/${token}`);
    },
  });

  return (
    <div className="max-w-sm mx-auto space-y-6">
      <form onSubmit={send.onSubmit} className="space-y-3">
        {kind === "invite" ? (
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-fg">Send a code to</legend>
            {maskedEmail ? (
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="channel" checked={channel === "email"} onChange={() => setChannel("email")} />
                <span>Email {maskedEmail}</span>
              </label>
            ) : null}
            {maskedPhone ? (
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="channel" checked={channel === "sms"} onChange={() => setChannel("sms")} />
                <span>Text message {maskedPhone}</span>
              </label>
            ) : null}
          </fieldset>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-4 text-[13px]">
              <label className="flex items-center gap-2"><input type="radio" name="channel" checked={channel === "email"} onChange={() => setChannel("email")} />By email</label>
              <label className="flex items-center gap-2"><input type="radio" name="channel" checked={channel === "sms"} onChange={() => setChannel("sms")} />By text message</label>
            </div>
            {channel === "email" ? (
              <div><Label htmlFor="fill-email">Email</Label><Input id="fill-email" name="contact" type="email" autoComplete="email" required /></div>
            ) : (
              <div><Label htmlFor="fill-phone">Phone</Label><Input id="fill-phone" name="contact" type="tel" autoComplete="tel" required /></div>
            )}
          </div>
        )}
        <Button type="submit" loading={send.pending}>Send code</Button>
        {send.state && !send.state.ok && !send.pending ? <Alert tone="bad">{send.state.error}</Alert> : null}
        {sent ? <Alert tone="info">{sent}</Alert> : null}
      </form>

      <form onSubmit={verify.onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="fill-code">Code</Label>
          <Input id="fill-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
        </div>
        <Button type="submit" loading={verify.pending}>Verify</Button>
        {verify.state && !verify.state.ok && !verify.pending ? <Alert tone="bad">{verify.state.error}</Alert> : null}
      </form>
    </div>
  );
}
