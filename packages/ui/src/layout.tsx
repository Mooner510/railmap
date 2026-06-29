import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function AppShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-dvh bg-slate-50 text-[13px] font-normal text-slate-950", className)} {...props} />;
}

export function InspectorGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid h-dvh min-h-0 grid-cols-[280px_minmax(0,1fr)_320px] grid-rows-[minmax(0,1fr)] gap-2 overflow-hidden p-2", className)}
      {...props}
    />
  );
}
