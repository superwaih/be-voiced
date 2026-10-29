"use client";

/**
 * The controls every screen is built from.
 *
 * Shape rule, from the design tokens: interactive controls are pills, text inputs are 10px, panels
 * and popovers are 14px. Colours come from the tokens through Tailwind, so everything here follows
 * the theme without a `dark:` on each element.
 */

import { X } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/cx";

// --- Buttons -------------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-[7px] rounded-full border border-transparent font-semibold tracking-[-0.005em] whitespace-nowrap transition-colors duration-[120ms] disabled:opacity-45";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:not-disabled:bg-accent-hover",
  secondary: "bg-surface border-line-strong shadow-soft hover:not-disabled:border-faint",
  ghost: "text-muted hover:not-disabled:bg-hover hover:not-disabled:text-ink",
  danger: "bg-surface text-danger border-line-strong hover:not-disabled:bg-danger-soft",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  trailing,
  children,
  className,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
  trailing?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        size === "sm" ? "h-7 gap-1.5 px-3 text-[12.5px] [&_svg]:size-3.5" : "h-[34px] px-4 [&_svg]:size-4",
        "[&_svg]:shrink-0",
        className,
      )}
      {...rest}
    >
      {icon}
      {children !== undefined && <span className="min-w-0">{children}</span>}
      {trailing}
    </button>
  );
}

export function IconButton({
  label,
  active,
  size = "md",
  className,
  children,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  size?: "sm" | "md";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full transition-colors duration-[120ms] disabled:opacity-35",
        active ? "bg-accent-surface text-accent-text" : "text-muted hover:not-disabled:bg-hover hover:not-disabled:text-ink",
        size === "sm" ? "size-7 [&_svg]:size-[15px]" : "size-8 [&_svg]:size-[18px]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// --- Choices -------------------------------------------------------------------------------

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-sunken p-[3px] no-bar", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors duration-[120ms] disabled:opacity-45 [&_svg]:size-[15px]",
              size === "sm" ? "h-6 px-[11px] text-[12.5px]" : "h-7 px-3.5",
              on
                ? "bg-surface text-ink shadow-[0_1px_2px_rgba(16,16,20,0.1),0_0_0_1px_var(--line)]"
                : "text-muted hover:not-disabled:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-45",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          checked && "translate-x-3.5",
        )}
      />
    </button>
  );
}

// --- Fields --------------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  inline,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={cx("flex min-w-0", inline ? "flex-row items-center justify-between gap-3" : "flex-col gap-[7px]")}>
      <span className="text-[12.5px] font-semibold text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

const FIELD_SHELL =
  "relative flex h-9 min-w-0 items-center rounded-control border border-line-strong bg-surface transition-[border-color,box-shadow] duration-[120ms] hover:border-faint focus-within:border-accent-line focus-within:shadow-[0_0_0_3px_var(--accent-soft)]";

export function TextInput({
  icon,
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  return (
    <span className={cx(FIELD_SHELL, className)}>
      {icon && <span className="ml-[11px] shrink-0 text-faint [&_svg]:size-4">{icon}</span>}
      <input
        ref={ref}
        spellCheck={false}
        className={cx(
          "h-full min-w-0 flex-1 border-0 bg-transparent outline-0 placeholder:text-faint",
          icon ? "pr-3 pl-2" : "px-3",
        )}
        {...rest}
      />
    </span>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span className={cx(FIELD_SHELL, className)}>
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const match = options.find((o) => String(o.value) === e.target.value);
          if (match) onChange(match.value);
        }}
        className="h-full w-full appearance-none border-0 bg-transparent py-0 pr-[30px] pl-3 outline-0"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className="bg-surface text-ink">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-[13px] size-1.5 -translate-y-[70%] rotate-45 border-r-[1.5px] border-b-[1.5px] border-faint" />
    </span>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-line-strong accent-[var(--accent)]"
      />
      <span className="mono shrink-0 text-xs text-muted">{format ? format(value) : value}</span>
    </span>
  );
}

// --- Progress ------------------------------------------------------------------------------

export function Progress({ value, label }: { value: number | null; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      className="h-1 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div
        className={cx("h-full origin-left rounded-full bg-accent", value === null ? "animate-[bv-sweep_1.4s_ease-in-out_infinite]" : "transition-transform duration-300")}
        style={value === null ? undefined : { transform: `scaleX(${Math.max(0.01, value)})` }}
      />
    </div>
  );
}

// --- Popover and menus ------------------------------------------------------------------------

export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  side = "bottom",
  width,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    let left = align === "start" ? a.left : a.right - p.width;
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
    let top = side === "bottom" ? a.bottom + 6 : a.top - p.height - 6;
    if (top + p.height > window.innerHeight - 8) top = a.top - p.height - 6;
    if (top < 8) top = a.bottom + 6;
    setPos({ top, left });
  }, [open, anchor, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-20 max-w-[calc(100vw-16px)] rounded-panel bg-surface p-1 shadow-pop"
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function Menu({ items, onClose }: { items: (MenuItem | "divider")[]; onClose: () => void }) {
  return (
    <div role="menu" className="flex min-w-[180px] flex-col">
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cx(
              "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left font-medium transition-colors disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
              item.danger ? "text-danger hover:not-disabled:bg-danger-soft" : "hover:not-disabled:bg-hover",
            )}
          >
            {item.icon}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="mono text-xs text-faint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function MenuButton({
  items,
  children,
  label,
  align = "end",
}: {
  items: (MenuItem | "divider")[];
  children: ReactNode;
  label: string;
  align?: "start" | "end";
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton ref={setAnchor} label={label} active={open} onClick={() => setOpen((v) => !v)}>
        {children}
      </IconButton>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align={align}>
        <Menu items={items} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}

// --- Modal ---------------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-30 grid place-items-center bg-scrim p-4 backdrop-blur-[2px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-full flex-col overflow-hidden rounded-[18px] bg-surface shadow-pop"
      >
        <header className="flex flex-none items-center justify-between gap-4 px-5 pt-4 pb-2">
          <h2 id={titleId} className="text-lg font-bold tracking-[-0.02em]">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-2">{children}</div>
        {footer && <footer className="flex flex-none items-center justify-end gap-2 px-5 pt-3 pb-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// --- Odds and ends ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[52ch] flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="mb-1 grid size-11 place-items-center rounded-full bg-accent-surface text-accent-text [&_svg]:size-[22px]">
        {icon}
      </div>
      <h3 className="text-[17px] font-bold tracking-[-0.02em]">{title}</h3>
      <p className="text-sm text-muted">{body}</p>
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A piece of text that becomes an input when clicked. Used for names and clip titles. */
export function InlineEdit({
  value,
  onCommit,
  className,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <button
        type="button"
        title="Rename"
        aria-label={`${label}: ${value}. Click to rename`}
        onClick={() => setEditing(true)}
        className={cx(
          "min-w-0 truncate rounded-md px-1 text-left transition-colors hover:bg-hover",
          className,
        )}
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  };

  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cx(
        "min-w-0 rounded-md bg-sunken px-1 outline-0 ring-2 ring-accent-line",
        className,
      )}
    />
  );
}
