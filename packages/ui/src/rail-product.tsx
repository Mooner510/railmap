import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export function RailSearchField({
  value,
  onValueChange,
  onClear,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
}) {
  return (
    <div className={cn("rail-search-field", className)}>
      <span className="rail-search-field__icon" aria-hidden="true" />
      <input
        {...props}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {value.trim() && onClear ? (
        <button
          type="button"
          className="rail-search-field__clear"
          aria-label="검색어 지우기"
          onClick={onClear}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function RailSearchResultCard({
  active = false,
  color,
  title,
  description,
  trailing,
  onClick,
  className,
}: {
  active?: boolean;
  color?: string | null;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn("rail-search-result-card", active && "is-active", className)}
      onClick={onClick}
    >
      {color ? (
        <span
          className="rail-search-result-card__dot"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ) : null}
      <span className="rail-search-result-card__body">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {trailing ? <span className="rail-search-result-card__trailing">{trailing}</span> : null}
    </button>
  );
}

export function RailSectionHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rail-section-header">
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {action ? <span className="rail-section-header__action">{action}</span> : null}
    </div>
  );
}
