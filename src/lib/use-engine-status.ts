"use client";

import { useEffect, useState } from "react";
import { fetchEngineStatus, type EngineStatus } from "./scan";

let pending: Promise<EngineStatus> | null = null;
let pendingKey = 0;

/**
 * Which engine the server is running. Fetched once and shared across
 * components; pass a changing `refreshKey` to fetch it again (for example,
 * after a scan, so the beta allowance is current).
 */
export function useEngineStatus(refreshKey = 0): EngineStatus | null {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    let active = true;
    if (refreshKey > pendingKey) {
      pendingKey = refreshKey;
      pending = null;
    }
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
  }, [refreshKey]);
  return status;
}
