"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { useI18n } from "@/lib/i18n";

export interface Option {
  value: string;
  label: string;
  /** Secondary text shown under or beside the label, also searchable. */
  hint?: string;
  icon?: ReactNode;
  /** Options with the same group are listed under one heading. */
  group?: string;
  /** Extra words that match a search but are not displayed. */
  keywords?: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string, option: Option) => void;
  options: Option[];
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Show the search box. Short lists can turn it off. */
  searchable?: boolean;
  /** Server-side search: called (debounced) with the typed text; the parent then supplies matching options. */
  onQuery?: (text: string) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Rendered under the list, e.g. a hint about searching the wider catalog. */
  footer?: ReactNode;
  "aria-label"?: string;
}

const norm = (s: string) => s.toLowerCase();

/**
 * Searchable select (combobox + listbox). Replaces the native <select>: it can be searched, shows icons and
 * groups, supports the keyboard (arrows, Enter, Escape) and can ask the parent for results as the user types.
 */
export function Select({
  value, onChange, options, id, placeholder, searchPlaceholder, emptyText, searchable = true, onQuery, loading, disabled, footer, ...rest
}: Props) {
  const { t } = useI18n();
  const uid = useId();
  const listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);

  // With onQuery the parent already filtered; otherwise filter here on label, hint and keywords.
  const visible = useMemo(() => {
    const q = norm(text.trim());
    if (!q || onQuery) return options;
    return options.filter((o) => norm(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`).includes(q));
  }, [options, text, onQuery]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [text, open]);

  useEffect(() => {
    if (!onQuery || !open) return;
    const timer = setTimeout(() => onQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text, onQuery, open]);

  function toggle() {
    if (disabled) return;
    if (!open) {
      const r = root.current?.getBoundingClientRect();
      setUp(!!r && r.bottom + 340 > window.innerHeight && r.top > 340);
      setText("");
    }
    setOpen(!open);
  }

  function choose(o: Option) {
    if (o.disabled) return;
    onChange(o.value, o);
    setOpen(false);
    root.current?.querySelector<HTMLElement>("button")?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, visible.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = visible[active]; if (o) choose(o); }
    else if (e.key === "Tab") setOpen(false);
  }

  useEffect(() => {
    if (open) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, uid]);

  let lastGroup: string | undefined;

  return (
    <div className="sel" ref={root}>
      <button
        type="button" id={id} className="sel-btn" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        disabled={disabled} onClick={toggle} aria-label={rest["aria-label"]}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); } }}
      >
        {selected ? (
          <span className="sel-val">{selected.icon}<span className="sel-txt"><span>{selected.label}</span>{selected.hint && <small>{selected.hint}</small>}</span></span>
        ) : (
          <span className="sel-val muted">{placeholder ?? t("select.choose")}</span>
        )}
        <Icon name="chevronDown" size={16} />
      </button>

      {open && (
        <div className={`sel-pop${up ? " up" : ""}`} onKeyDown={onKey}>
          {searchable && (
            <div className="sel-search">
              <Icon name="search" size={16} />
              <input
                ref={search} value={text} onChange={(e) => setText(e.target.value)} placeholder={searchPlaceholder ?? t("select.search")}
                aria-label={searchPlaceholder ?? t("select.search")} aria-controls={listId} aria-activedescendant={visible[active] ? `${uid}-opt-${active}` : undefined}
                autoComplete="off" spellCheck={false}
              />
            </div>
          )}
          <ul id={listId} role="listbox" className="sel-list" tabIndex={-1}>
            {loading && <li className="sel-note">{t("select.loading")}</li>}
            {!loading && visible.length === 0 && <li className="sel-note">{emptyText ?? t("select.empty")}</li>}
            {visible.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={o.value} role="presentation">
                  {heading && <div className="sel-group">{heading}</div>}
                  <div
                    id={`${uid}-opt-${i}`} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}
                    className={`sel-opt${i === active ? " act" : ""}${o.value === value ? " on" : ""}${o.disabled ? " dis" : ""}`}
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
                  >
                    {o.icon}
                    <span className="sel-txt"><span>{o.label}</span>{o.hint && <small>{o.hint}</small>}</span>
                    {o.value === value && <Icon name="check" size={16} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {footer && <div className="sel-foot">{footer}</div>}
        </div>
      )}
    </div>
  );
}
