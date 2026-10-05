"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createLead, type ActionResult } from "@/lib/actions/leads";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { useServerForm } from "@/components/ui/action-form";

export function NewLeadForm({ team, sources, defaultAssignee }: { team: { id: string; name: string }[]; sources: { id: string; name: string }[]; defaultAssignee: string }) {
  // Submitted by hand so a validation error keeps everything the user typed.
  const { state, pending, onSubmit } = useServerForm((form) => createLead(null, form));
  const router = useRouter();
  useEffect(() => { if (state?.ok && state.id) router.push(`/leads/${state.id}`); }, [state, router]);
  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader title="Property" />
          <CardBody className="grid gap-3 sm:grid-cols-6">
            <Field label="Street address" className="sm:col-span-4"><Input name="addressLine1" required placeholder="123 Main St" autoFocus /></Field>
            <Field label="Unit" className="sm:col-span-2"><Input name="addressLine2" placeholder="Apt, unit" /></Field>
            <Field label="City" className="sm:col-span-3"><Input name="city" required /></Field>
            <Field label="State" className="sm:col-span-1"><Input name="state" required maxLength={2} defaultValue="MD" /></Field>
            <Field label="ZIP" className="sm:col-span-2"><Input name="postalCode" required minLength={5} /></Field>
            <Field label="Type" className="sm:col-span-2"><Select name="propertyType" defaultValue=""><option value="">Unknown</option>{["Single Family", "Rowhome", "Townhouse", "Duplex", "Triplex", "Fourplex", "Condo", "Land", "Other"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Beds" className="sm:col-span-1"><Input name="beds" type="number" step="1" min="0" /></Field>
            <Field label="Baths" className="sm:col-span-1"><Input name="baths" type="number" step="0.5" min="0" /></Field>
            <Field label="Sq ft" className="sm:col-span-1"><Input name="sqft" type="number" step="1" min="0" /></Field>
            <Field label="Year built" className="sm:col-span-1"><Input name="yearBuilt" type="number" step="1" min="1800" max="2030" /></Field>
            <Field label="Occupancy" className="sm:col-span-3"><Select name="occupancy" defaultValue="unknown"><option value="unknown">Unknown</option><option value="owner">Owner occupied</option><option value="tenant">Tenant</option><option value="vacant">Vacant</option></Select></Field>
            <Field label="Condition (1 worst, 5 best)" className="sm:col-span-3"><Select name="condition" defaultValue="unknown"><option value="unknown">Unknown</option>{["1", "2", "3", "4", "5"].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Seller" description="One contact now. Add heirs, agents, or attorneys on the lead page." />
          <CardBody className="grid gap-3 sm:grid-cols-6">
            <Field label="First name" className="sm:col-span-3"><Input name="firstName" required /></Field>
            <Field label="Last name" className="sm:col-span-3"><Input name="lastName" /></Field>
            <Field label="Mobile phone" className="sm:col-span-3"><Input name="phone" type="tel" placeholder="(410) 555-0100" /></Field>
            <Field label="Email" className="sm:col-span-3"><Input name="email" type="email" /></Field>
            <Field label="Relationship" className="sm:col-span-3"><Select name="relationship" defaultValue="owner"><option value="owner">Owner</option><option value="heir">Heir</option><option value="agent">Agent</option><option value="attorney">Attorney</option><option value="tenant">Tenant</option><option value="other">Other</option></Select></Field>
            <Field label="SMS consent" hint="Did the seller give permission to text? Inbound leads who texted first count as opted in." className="sm:col-span-3"><Select name="smsConsent" defaultValue="unknown"><option value="unknown">Unknown</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option></Select></Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Notes" description="What the seller said. Deal issue suggestions are drawn from this." />
          <CardBody><Textarea name="notes" placeholder="Inherited from mother, behind on taxes, tenant stopped paying, wants out by December..." /></CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Lead" />
          <CardBody className="space-y-3">
            <Field label="Source"><Select name="sourceId" defaultValue=""><option value="">Unknown</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Assign to"><Select name="assignedTo" defaultValue={defaultAssignee}>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Asking price"><Input name="askingPrice" type="number" step="1000" min="0" placeholder="Optional" /></Field>
            <Field label="Seller urgency"><Select name="sellerUrgency" defaultValue="none"><option value="none">Not stated</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="immediate">Immediate</option></Select></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="enrich" defaultChecked className="h-4 w-4" />Pull property report after saving</label>
          </CardBody>
        </Card>
        {state && !state.ok ? <Alert tone="bad">{state.error}</Alert> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>Create lead</Button>
        <p className="text-xs text-fg-3">A first call task due now is added automatically. Speed to contact starts the clock.</p>
      </div>
    </form>
  );
}
