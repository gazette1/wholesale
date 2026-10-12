"use client";
import * as React from "react";
import { ActionButton } from "@/components/ui/action-form";
import { archiveFormAction, duplicateFormAction, restoreFormAction } from "@/lib/actions/forms";

export function FormRowActions({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  return (
    <span className="inline-flex items-start gap-1.5">
      {archived ? (
        <ActionButton action={() => restoreFormAction(id)} variant="outline"><span aria-hidden="true">Restore</span><span className="sr-only">Restore {name}</span></ActionButton>
      ) : (
        <>
          <ActionButton action={() => duplicateFormAction(id)} variant="outline"><span aria-hidden="true">Duplicate</span><span className="sr-only">Duplicate {name}</span></ActionButton>
          <ActionButton action={() => archiveFormAction(id)} variant="ghost" confirm={`Archive "${name}"? It can be restored later.`}><span aria-hidden="true">Archive</span><span className="sr-only">Archive {name}</span></ActionButton>
        </>
      )}
    </span>
  );
}
