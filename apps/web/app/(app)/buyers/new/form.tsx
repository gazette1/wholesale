"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBuyer } from "@/lib/actions/buyers";
import type { ActionResult } from "@/lib/actions/leads";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Textarea, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

export function NewBuyerForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createBuyer, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok && state.id) router.push(`/buyers/${state.id}`); }, [state, router]);
  return (
    <form action={action} className="max-w-2xl">
      <Card><CardBody className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2"><Input name="company" placeholder="Chesapeake Capital Homes" /></Field>
        <Field label="First name"><Input name="firstName" required /></Field>
        <Field label="Last name"><Input name="lastName" /></Field>
        <Field label="Phone"><Input name="phone" type="tel" /></Field>
        <Field label="Email"><Input name="email" type="email" /></Field>
        <Field label="Website"><Input name="website" /></Field>
        <Field label="Source"><Input name="source" placeholder="Networking, referral, closed deal" /></Field>
        <Field label="States they buy in (comma separated)" className="sm:col-span-2"><Input name="states" placeholder="MD, PA" /></Field>
        <Field label="Notes from the call" className="sm:col-span-2"><Textarea name="notes" placeholder="Buys sight unseen, wants rowhomes under 150k in 21206, closes with hard money in 14 days" /></Field>
        {state && !state.ok ? <Alert tone="bad" className="sm:col-span-2">{state.error}</Alert> : null}
        <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={pending}>Create buyer</Button></div>
      </CardBody></Card>
    </form>
  );
}
