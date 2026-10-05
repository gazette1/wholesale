import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass = "flex h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputClass, type === "number" && "num text-right", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputClass, "h-auto min-h-[72px] py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(inputClass, "pr-7 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2355534d%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_8px_center]", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label className={cn("block text-xs font-medium text-fg-2 mb-1", className)} {...props}>
      {children}
      {hint ? <span className="ml-1 text-fg-3 font-normal" title={hint}>?</span> : null}
    </label>
  );
}

export function Field({ label, hint, children, className, error }: { label: string; hint?: string; children: React.ReactNode; className?: string; error?: string }) {
  // The label element wraps the control, which ties them together for screen readers and makes the text clickable.
  return (
    <div className={cn("min-w-0", className)}>
      <label className="block">
        <span className="block text-xs font-medium text-fg-2 mb-1">{label}{hint ? <span className="ml-1 text-fg-3 font-normal cursor-help" title={hint} aria-label={hint}>?</span> : null}</span>
        {children}
      </label>
      {error ? <p role="alert" className="mt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
