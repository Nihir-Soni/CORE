interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

const sizes: Record<string, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
};

export function Spinner({ size = "md", label = "Loading..." }: SpinnerProps) {
  return (
    <div
      className="flex items-center justify-center"
      role="status"
      aria-label={label}
    >
      <div
        className={`rounded-full border-[var(--border-color)] border-t-[var(--accent)] animate-spin ${sizes[size]}`}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
