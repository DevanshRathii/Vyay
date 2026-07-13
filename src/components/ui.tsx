"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ── Button ──────────────────────────────────────────────────────────────────

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[background-color,opacity,transform] duration-100 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 whitespace-nowrap select-none touch-manipulation",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:opacity-90 active:opacity-80",
        secondary: "bg-card-2 text-fg border border-line hover:bg-line/60 active:bg-line",
        ghost: "text-fg hover:bg-line/50 active:bg-line/70",
        danger: "text-negative hover:bg-negative/10 active:bg-negative/20",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9.5 px-4 text-sm",
        lg: "h-11 px-6 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// ── Action menu ─────────────────────────────────────────────────────────────
// A small "⋯" dropdown for demoting rare/secondary actions off a button row
// that would otherwise overflow on narrow screens.

export function ActionMenu({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            "animate-dialog-panel-in absolute top-full z-20 mt-1 flex min-w-[10.5rem] flex-col gap-0.5 rounded-xl border border-line/60 bg-card p-1.5",
            align === "end" ? "right-0" : "left-0",
          )}
          style={{ boxShadow: "var(--shadow-floating)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function ActionMenuItem({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      role="menuitem"
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-fg touch-manipulation",
        "hover:bg-line/50 active:bg-line/70 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9.5 w-full rounded-xl border border-line bg-card px-3.5 text-sm text-fg placeholder:text-muted",
        "focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        // Pill shape + height match Button exactly, so a select and a toggle
        // button sitting in the same filter row read as one control family
        // instead of two different UI languages.
        "h-9.5 rounded-full border border-line bg-card-2 pl-4 pr-9 text-sm font-medium text-fg",
        "appearance-none bg-no-repeat bg-[right_0.85rem_center] bg-[length:13px]",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236e6e73%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')]",
        "transition-colors hover:bg-line/60",
        "focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-muted", className)} {...props} />;
}

// ── Card ────────────────────────────────────────────────────────────────────

const CARD_ELEVATION_BORDER = {
  resting: "border-line",
  raised: "border-line/60",
  floating: "border-line/40",
} as const;

export function Card({
  className,
  elevation = "resting",
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { elevation?: "resting" | "raised" | "floating" }) {
  return (
    <div
      className={cn("card-surface rounded-2xl border bg-card", CARD_ELEVATION_BORDER[elevation], className)}
      style={{ boxShadow: `var(--shadow-${elevation})`, ...style }}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-1">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

export function Badge({
  className,
  color,
  children,
}: {
  className?: string;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium",
        "bg-card-2 border border-line text-fg",
        className,
      )}
    >
      {color && (
        <span
          className="category-dot h-2 w-2 rounded-full"
          style={{ background: color, "--dot-color": color } as React.CSSProperties}
        />
      )}
      {children}
    </span>
  );
}

// ── Spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent align-middle",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape to close, and trap Tab focus inside the dialog while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Move focus into the dialog on open, restore it to the trigger on close.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    } else {
      previouslyFocused.current?.focus();
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
      <div
        ref={panelRef}
        className={cn(
          "animate-dialog-panel-in relative z-10 w-full rounded-t-2xl bg-card p-5 shadow-2xl sm:rounded-2xl",
          "dark:bg-card/95 dark:backdrop-blur-xl",
          "pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
          "max-h-[85dvh] overflow-y-auto",
        )}
        role="dialog"
        aria-modal
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Confirm button ──────────────────────────────────────────────────────────
// Every destructive/irreversible action (delete, revoke, disconnect, dismiss)
// should go through this instead of a bare Button + inline fetch — an audit
// found the same three bugs repeated independently at every call site: no
// confirmation step, no busy/disabled state during the request (so a slow
// network lets a double-click fire the request twice), and no error surfaced
// when the request fails (it just silently reverts, looking like it worked).
// This component owns all three so a new destructive action can't forget them.

export function ConfirmButton({
  onConfirm,
  confirmTitle,
  confirmMessage,
  confirmLabel = "Delete",
  children,
  variant = "danger",
  size,
  className,
  disabled,
  ...rest
}: {
  onConfirm: () => Promise<void>;
  confirmTitle: string;
  confirmMessage: React.ReactNode;
  confirmLabel?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> &
  VariantProps<typeof buttonVariants>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return; // don't let Escape/backdrop abandon an in-flight request
    setOpen(false);
    setError(null);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
        {...rest}
      >
        {children}
      </Button>
      <Dialog open={open} onClose={close} title={confirmTitle}>
        <div className="flex flex-col gap-3 text-[13px] text-muted">
          <div>{confirmMessage}</div>
          {error && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={confirm} disabled={busy}>
              {busy ? <Spinner className="h-3.5 w-3.5 border-negative/30 border-t-negative" /> : null}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

export function Empty({
  icon,
  title,
  hint,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="animate-float-bob text-muted">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-muted">{hint}</p>}
      {children}
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────
// Content-shaped loading placeholder — reads as "the real thing is about to
// appear" rather than a generic Spinner's "something is happening, unclear
// what." Use for initial data loads on content-heavy screens (tables, stat
// grids); keep Spinner for short-lived in-flight actions (button presses).

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-lg bg-[linear-gradient(90deg,var(--card-2)_25%,var(--line)_50%,var(--card-2)_75%)]",
        className,
      )}
      aria-hidden
    />
  );
}
