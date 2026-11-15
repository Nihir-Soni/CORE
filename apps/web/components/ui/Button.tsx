import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outlined";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  startIcon?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  startIcon,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium transition-colors select-none cursor-pointer border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants: Record<string, string> = {
    primary:
      "bg-[var(--accent)] text-white border-transparent hover:bg-[var(--accent-hover)] focus-visible:ring-[var(--accent)]",
    secondary:
      "bg-white text-[var(--text-primary)] border-[var(--border-color)] hover:bg-[var(--bg-surface-2)] focus-visible:ring-[var(--accent)]",
    danger:
      "bg-[var(--status-failed)] text-white border-transparent hover:opacity-90 focus-visible:ring-[var(--status-failed)]",
    ghost:
      "bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] focus-visible:ring-[var(--accent)]",
    outlined:
      "bg-transparent text-[var(--accent)] border-[var(--accent)] hover:bg-[var(--accent-light)] focus-visible:ring-[var(--accent)]",
  };

  const sizes: Record<string, string> = {
    sm: "h-7 px-3 text-xs rounded-[var(--btn-radius)]",
    md: "h-9 px-4 text-sm rounded-[var(--btn-radius)]",
    lg: "h-10 px-5 text-sm rounded-[var(--btn-radius)]",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
          aria-hidden="true"
        />
      ) : startIcon ? (
        <span className="shrink-0" aria-hidden="true">{startIcon}</span>
      ) : null}
      {children}
    </button>
  );
}
