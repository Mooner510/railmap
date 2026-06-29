import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export function Dialog({
  open,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { open: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-2 backdrop-blur-sm">
      <div
        className={cn("max-h-[calc(100dvh-24px)] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl", className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}
