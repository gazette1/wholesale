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
