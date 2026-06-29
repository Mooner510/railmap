import { Slot } from "./slot";
import { cn } from "./utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:hover:bg-blue-600",
  secondary: "border-slate-200 bg-slate-100 text-slate-900 hover:bg-slate-200",
  ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950",
  danger: "border-transparent bg-rose-600 text-white hover:bg-rose-700 disabled:hover:bg-rose-600",
  outline: "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-7 rounded-lg px-2.5 text-xs",
  md: "h-8 rounded-xl px-3 text-xs",
  lg: "h-9 rounded-xl px-4 text-xs",
  icon: "size-8 rounded-lg p-0",
};

export function Button({
  asChild = false,
  children,
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  const composedClassName = cn(
    "inline-flex shrink-0 items-center justify-center gap-2 border font-medium transition disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
    variantClass[variant],
    sizeClass[size],
    className,
  );

  if (asChild) {
    return (
      <Slot className={composedClassName} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button className={composedClassName} type={type} {...props}>
      {children}
    </button>
  );
}
