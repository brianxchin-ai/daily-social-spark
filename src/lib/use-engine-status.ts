"use client";

import { useEffect, useState } from "react";
import { fetchEngineStatus, type EngineStatus } from "./scan";

let pending: Promise<EngineStatus> | null = null;

/** Which engine the server is running. Fetched once and shared across components. */
export function useEngineStatus(): EngineStatus | null {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    let active = true;
    pending ??= fetchEngineStatus();
    pending.then(
      (value) => active && setStatus(value),
      () => {
        pending = null; // allow a later retry
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return status;
}
