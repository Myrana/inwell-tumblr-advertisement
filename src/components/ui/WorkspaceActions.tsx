import type { ButtonHTMLAttributes, ReactNode } from "react";

type ActionVariant = "primary" | "secondary" | "tertiary" | "text" | "icon";

type WorkspaceActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: ActionVariant;
  compact?: boolean;
};

export function WorkspaceActionButton({
  children,
  className = "",
  compact = false,
  icon,
  type = "button",
  variant = "secondary",
  ...buttonProps
}: WorkspaceActionButtonProps) {
  const variantClass = variant === "tertiary" ? "tertiary-action" : variant === "text" ? "text-link" : variant === "icon" ? "icon-button" : variant;
  const classes = [
    "workspace-action-button",
    variantClass,
    compact ? "compact-button" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button className={classes} type={type} {...buttonProps}>
      {icon}
      {children}
    </button>
  );
}

type WorkspaceActionRowProps = {
  children: ReactNode;
  className?: string;
  label?: string;
};

export function WorkspaceActionRow({ children, className = "", label }: WorkspaceActionRowProps) {
  return (
    <div className={["workspace-action-row", className].filter(Boolean).join(" ")} {...(label ? { "aria-label": label } : {})}>
      {children}
    </div>
  );
}
