import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_8px_22px_rgb(15_23_42_/_0.06)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-slate-200 px-3 py-2", className)} {...props} />;
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 px-3 py-2", className)} {...props} />;
}
