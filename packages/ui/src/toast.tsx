import { cn } from "./utils";

export type ToastTone = "info" | "success" | "error";

export function Toast({ message, tone = "info" }: { message: string | null; tone?: ToastTone }) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-4 py-2 text-sm font-black shadow-xl",
        tone === "success" ? "bg-emerald-600 text-white" : null,
        tone === "error" ? "bg-rose-600 text-white" : null,
        tone === "info" ? "bg-slate-950 text-white" : null,
      )}
    >
      {message}
    </div>
  );
}
