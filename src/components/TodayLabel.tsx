"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Today's date, rendered in the visitor's browser so it is never stale. */
export function TodayLabel() {
  const label = useSyncExternalStore(
    noop,
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    () => "",
  );
  return <span suppressHydrationWarning>{label}</span>;
}
