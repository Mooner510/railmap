import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-[22px] border border-slate-200/90 bg-white/95 shadow-[0_12px_30px_rgb(15_23_42_/_0.08)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-slate-200 px-4 py-3", className)} {...props} />;
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 px-4 py-3", className)} {...props} />;
}
