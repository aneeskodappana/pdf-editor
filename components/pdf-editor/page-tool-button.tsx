import type { ReactNode } from "react";

export function PageToolButton({
  label,
  onClick,
  disabled,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${danger ? "danger" : ""}`}
      data-tooltip={label}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
