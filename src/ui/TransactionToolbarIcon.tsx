import { setIcon } from "obsidian";
import { useEffect, useRef } from "react";

export function TransactionToolbarIcon({ name }: { name: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (host.current) setIcon(host.current, name);
  }, [name]);
  return <span ref={host} className="asset-track-transaction-toolbar-icon" aria-hidden="true" />;
}
