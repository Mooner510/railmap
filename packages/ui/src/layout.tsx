import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function AppShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-dvh bg-slate-50 text-slate-950", className)} {...props} />;
}

export function InspectorGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid h-dvh min-h-0 grid-cols-[320px_minmax(0,1fr)_360px] gap-3 overflow-hidden p-3", className)}
      {...props}
    />
  );
}
