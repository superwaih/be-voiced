import { X } from "@phosphor-icons/react";
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: ReactNode; trailing?: ReactNode }
>(function Button({ variant = "secondary", size = "md", icon, trailing, children, className = "", ...rest }, ref) {
  return (
    <button ref={ref} className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon}
      {children !== undefined && <span className="btn-label">{children}</span>}
      {trailing}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: "sm" | "md" }
>(function IconButton({ label, active, size = "md", className = "", children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`icon-btn icon-btn-${size} ${active ? "is-active" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          disabled={o.disabled}
          className={o.value === value ? "is-on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

export function Field({ label, hint, error, children, inline }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`field ${inline ? "field-inline" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  function TextInput({ icon, className = "", ...rest }, ref) {
    return (
      <span className={`input ${icon ? "has-icon" : ""} ${className}`}>
        {icon}
        <input ref={ref} spellCheck={false} {...rest} />
      </span>
    );
  },
);

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <span className="select">
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
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
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <span className="slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value mono">{format ? format(value) : value}</span>
    </span>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className="color-input" title={label}>
      <span className="color-swatch" style={{ background: value }} />
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <span className="mono">{value.toUpperCase()}</span>
    </span>
  );
}

export function Progress({ value, label }: { value: number | null; label?: string }) {
  return (
    <div
      className={`progress ${value === null ? "is-indeterminate" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div className="progress-fill" style={value === null ? undefined : { transform: `scaleX(${Math.max(0.01, value)})` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

// --- Popover ---------------------------------------------------------------------------------

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

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className="popover"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? "visible" : "hidden" }}
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
    <div className="menu" role="menu">
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={i} className="menu-divider" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={`menu-item ${item.danger ? "is-danger" : ""}`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.hint && <span className="menu-hint mono">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function MenuButton({ items, children, label, align = "end" }: { items: (MenuItem | "divider")[]; children: ReactNode; label: string; align?: "start" | "end" }) {
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

// --- Modal -----------------------------------------------------------------------------------

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
  if (!open) return null;
  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width }}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function InlineEdit({
  value,
  onCommit,
  className = "",
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
      <button className={`inline-edit ${className}`} title="Rename" aria-label={`${label}: ${value}. Click to rename`} onClick={() => setEditing(true)}>
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
      className={`inline-edit-input ${className}`}
      aria-label={label}
      autoFocus
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
    />
  );
}
