import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "./utils";

export function TabList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex rounded-2xl bg-slate-100 p-1", className)} {...props} />;
}

export function TabButton({ active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex-1 rounded-xl px-3 py-2 text-xs font-black text-slate-500 transition hover:text-slate-950",
        active ? "bg-white text-slate-950 shadow-sm" : null,
        className,
      )}
      {...props}
    />
  );
}
