import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function HoverHint({ children, content, className = "" }: {
  children: ReactNode; content: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const timer = useRef<number>();
  useLayoutEffect(() => {
    if (!open || !host.current || !tooltip.current) return;
    const view = host.current.ownerDocument.defaultView;
    if (!view) return;
    const anchor = host.current.getBoundingClientRect();
    const bounds = tooltip.current.getBoundingClientRect();
    const top = anchor.top - bounds.height - 8;
    setPosition({
      "--asset-track-hint-left": `${Math.max(8, Math.min(anchor.right - bounds.width, view.innerWidth - bounds.width - 8))}px`,
      "--asset-track-hint-top": `${Math.max(8, Math.min(top >= 8 ? top : anchor.bottom + 8, view.innerHeight - bounds.height - 8))}px`
    } as CSSProperties);
    const dismiss = () => setOpen(false);
    view.addEventListener("resize", dismiss);
    view.addEventListener("scroll", dismiss, true);
    return () => { view.removeEventListener("resize", dismiss); view.removeEventListener("scroll", dismiss, true); };
  }, [open]);
  const cancel = () => host.current?.ownerDocument.defaultView?.clearTimeout(timer.current);
  useEffect(() => () => cancel(), []);
  const change = (value: boolean) => {
    cancel();
    timer.current = host.current?.ownerDocument.defaultView?.setTimeout(() => setOpen(value), 200);
  };
  return <span ref={host} className={`asset-track-hover-hint ${className}`}
    onMouseEnter={() => change(true)} onMouseLeave={() => change(false)}
    onFocus={() => change(true)} onBlur={() => change(false)}>
    {children}
    {open && host.current && createPortal(<span ref={tooltip} style={position}
      onMouseEnter={cancel} onMouseLeave={() => change(false)}
      className="asset-track-hover-hint-content" role="tooltip">{content}</span>, host.current.ownerDocument.body)}
  </span>;
}

export function HintButton({ reason, children, ...props }: {
  reason?: string; children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HoverHint content={reason} className={`asset-track-hint-button${reason ? " has-hint" : ""}`}>
    <button {...props}>{children}</button>
    {reason && <span className="asset-track-button-question" aria-label={reason}>?</span>}
  </HoverHint>;
}
