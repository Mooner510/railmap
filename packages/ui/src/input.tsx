import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-900 outline-none transition placeholder:text-slate-400",
        "focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-normal text-slate-900 outline-none transition placeholder:text-slate-400",
        "focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
