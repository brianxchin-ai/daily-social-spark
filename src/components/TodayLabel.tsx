"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 15_000);
  return () => clearInterval(timer);
}

function snapshot() {
  const now = new Date();
  const date = now
    .toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })
    .replace(/,/g, "");
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} · ${time}`;
}

/** Live date and time readout, rendered in the visitor's browser. */
export function TodayLabel() {
  const label = useSyncExternalStore(subscribe, snapshot, () => "");
  return <span suppressHydrationWarning>{label}</span>;
}
