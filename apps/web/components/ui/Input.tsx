import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className = "", ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
      >
        {label}
      </label>
      <input
        id={inputId}
        className={[
          "h-9 w-full px-3 text-sm rounded-[var(--input-radius)] border transition-colors",
          "bg-[var(--input-bg)] text-[var(--text-primary)]",
          "placeholder:text-[var(--text-muted)]",
          error
            ? "border-[var(--status-failed)] focus:border-[var(--status-failed)] focus:ring-1 focus:ring-[var(--status-failed)] outline-none"
            : "border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:ring-1 focus:ring-[var(--input-border-focus)] outline-none",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-describedby={
          error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
        }
        aria-invalid={error ? "true" : undefined}
        {...props}
      />
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs text-[var(--status-failed)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
