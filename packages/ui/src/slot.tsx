import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "./utils";

type SlotProps = {
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
};

export function Slot({ children, className, ...props }: SlotProps) {
  if (!isValidElement(children)) return null;
  const child = children as ReactElement<{ className?: string }>;

  return cloneElement(child, {
    ...(props as Partial<{ className?: string }>),
    className: cn(child.props.className, className),
  });
}
