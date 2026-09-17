import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <table className={cn("w-full text-[13px] border-collapse", className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-2 text-xs text-fg-3 font-medium [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:border-b [&_th]:border-border sticky top-0 z-[1]", className)} {...props} />;
}
export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-border/70 [&_tr:last-child_td]:border-0", className)} {...props} />;
}
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-surface-2 transition-colors", className)} {...props} />;
}
export function TH({ className, right, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return <th className={cn(right && "!text-right", className)} {...props} />;
}
export function TD({ className, right, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return <td className={cn(right && "text-right num", className)} {...props} />;
}
