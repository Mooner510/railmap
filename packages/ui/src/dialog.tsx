import type { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./utils";

type DialogProps = HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  children: ReactNode;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
};

export function Dialog({
  open,
  children,
  className,
  onClose,
  closeOnBackdrop = true,
  ...props
}: DialogProps) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/40 p-2 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop) onClose?.();
      }}
    >
      <div
        className={cn("max-h-[calc(100dvh-24px)] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl", className)}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
