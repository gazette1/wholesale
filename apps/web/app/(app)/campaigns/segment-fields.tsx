import { Input, Field } from "@/components/ui/input";

/**
 * Segment inputs shared by the create form and the edit form. Stages are checkboxes of the org's real
 * pipeline stages, so a mistyped key cannot be saved. The action checks the keys again on the server.
 */
export function SegmentFields({ stages, selected, maxAttempts }: { stages: { key: string; name: string; isTerminal: boolean }[]; selected: string[]; maxAttempts?: number | null }) {
  return (
    <>
      <fieldset className="min-w-0">
        <legend className="block text-xs font-medium text-fg-2 mb-1">Segment: leads in these stages</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-x-3 gap-y-1">
          {stages.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-[13px] min-w-0">
              <input type="checkbox" name="stageKeys" value={s.key} defaultChecked={selected.includes(s.key)} className="h-4 w-4 shrink-0" />
              <span className="truncate">{s.name}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-fg-3">Check none to include every stage. Only open leads are enrolled.</p>
      </fieldset>
      <Field label="Only leads with at most this many contact attempts"><Input name="maxAttempts" type="number" min={0} max={20} step={1} placeholder="any" defaultValue={maxAttempts ?? ""} /></Field>
      <p className="text-xs text-fg-3 -mt-1">Whole number from 0 to 20. Leave blank for no limit.</p>
    </>
  );
}
