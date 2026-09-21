"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide }: { className?: string; children: React.ReactNode; title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content className={cn("fixed left-1/2 top-[8vh] z-50 w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-border bg-surface shadow-[var(--shadow-pop)] focus:outline-none fade-in max-h-[84vh] flex flex-col", wide ? "max-w-3xl" : "max-w-lg", className)}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="text-xs text-fg-3 mt-0.5">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-fg-3 hover:bg-black/5 hover:text-fg" aria-label="Close"><X className="h-4 w-4" /></DialogPrimitive.Close>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

const DRAWER_CSS = "@keyframes drawer-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}.drawer-in{animation:drawer-in 160ms ease-out}@media (prefers-reduced-motion:reduce){.drawer-in{animation:none}}";

/** Right side panel. Full height, about 440px wide, full width on phones. Same Radix dialog underneath, so focus trap and Escape work. */
export function DrawerContent({ className, children, title, description, headerExtra, footer }: { className?: string; children: React.ReactNode; title: string; description?: string; headerExtra?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <style>{DRAWER_CSS}</style>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]" />
      <DialogPrimitive.Content className={cn("drawer-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)] focus:outline-none sm:w-[440px] sm:max-w-[92vw]", className)}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-sm font-semibold leading-5 break-words">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="text-xs text-fg-3 mt-0.5">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            {headerExtra ? <div className="mt-2">{headerExtra}</div> : null}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-fg-3 hover:bg-black/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40" aria-label="Close"><X className="h-4 w-4" /></DialogPrimitive.Close>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border px-5 py-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
