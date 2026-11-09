"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MomentumWindow } from "@/lib/types";

type Mode = "idle" | "scanning" | "done";

const W = 560;
const H = 190;
const PAD_X = 10;
const PLOT_TOP = 40;
const PLOT_BOTTOM = H - 34;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;
const HOURS = 48;

const x = (hours: number) => PAD_X + (Math.min(hours, HOURS) / HOURS) * (W - PAD_X * 2);
const y = (fractionDown: number) => PLOT_TOP + fractionDown * PLOT_H;

const START_HEIGHT: Record<MomentumWindow["stage"], number> = {
  rising: 0.82,
  accelerating: 0.58,
  "near-peak": 0.3,
};

/**
 * The 48-hour forecast: where the trend is now, when it peaks, and when
 * acting on it becomes late. Idle = flat line, scanning = sweeping beam,
 * done = the curve draws itself.
 */
/**
 * The chart scales down on narrow screens, which would shrink its labels too.
 * This returns a multiplier that keeps label text at its real pixel size.
 */
function useLabelScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setScale(Math.min(2, Math.max(1, W / width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, (px: number) => ({ fontSize: px * scale })] as const;
}

export function TimeRibbon({ mode, momentum }: { mode: Mode; momentum?: MomentumWindow }) {
  const id = useId().replace(/:/g, "");
  const [wrapRef, fs] = useLabelScale();
  const ticks = [0, 12, 24, 36, 48];

  const axis = (
    <g>
      <line x1={x(0)} x2={x(HOURS)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="var(--line)" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} stroke="var(--line)" />
          <text
            x={x(t)}
            y={PLOT_BOTTOM + 20}
            textAnchor={t === 0 ? "start" : t === HOURS ? "end" : "middle"}
            className="fill-ink-soft font-mono"
            style={fs(11)}
          >
            {t === 0 ? "NOW" : `+${t}H`}
          </text>
        </g>
      ))}
    </g>
  );

  if (mode !== "done" || !momentum) {
    return (
      <div ref={wrapRef}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={mode === "scanning" ? "Forecast loading" : "No forecast yet"}>
          {axis}
          <line
            x1={x(0)}
            x2={x(HOURS)}
            y1={y(0.85)}
            y2={y(0.85)}
            stroke="var(--ink-soft)"
            strokeDasharray="3 5"
            opacity={0.6}
          />
          {mode === "scanning" ? (
            <g>
              <rect y={PLOT_TOP - 10} width={2} height={PLOT_H + 10} fill="var(--ember)">
                <animate attributeName="x" values={`${x(0)};${x(HOURS) - 2};${x(0)}`} dur="2.2s" repeatCount="indefinite" />
              </rect>
              <text x={W / 2} y={PLOT_TOP - 18} textAnchor="middle" className="fill-ember font-mono tracking-widest" style={fs(11)}>
                READING THE NEXT 48 HOURS
              </text>
            </g>
          ) : (
            <text x={W / 2} y={y(0.85) - 14} textAnchor="middle" className="fill-ink-soft font-mono tracking-widest" style={fs(11)}>
              NO SIGNAL YET
            </text>
          )}
        </svg>
      </div>
    );
  }

  const x0 = x(0);
  const xp = x(momentum.peakInHours);
  const xc = x(momentum.closesInHours);
  const xEnd = x(HOURS);
  const y0 = y(START_HEIGHT[momentum.stage]);
  const yTop = y(0.04);
  const yClose = y(0.68);
  const yEnd = y(0.8);

  const midA = x0 + (xp - x0) * 0.55;
  const midB = xp + (xc - xp) * 0.5;
  let line = `M ${x0} ${y0} C ${midA} ${y0}, ${midA} ${yTop}, ${xp} ${yTop} C ${midB} ${yTop}, ${midB} ${yClose}, ${xc} ${yClose}`;
  if (xc < xEnd - 1) line += ` L ${xEnd} ${yEnd}`;
  const area = `${line} L ${xEnd} ${PLOT_BOTTOM} L ${x0} ${PLOT_BOTTOM} Z`;

  const peakLabelAnchor = xp > W - 90 ? "end" : xp < 90 ? "start" : "middle";

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={`Forecast: ${momentum.stage}, peaks in about ${momentum.peakInHours} hours, window closes in about ${momentum.closesInHours} hours`}
      >
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--ember)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--ember)" stopOpacity="0" />
          </linearGradient>
          <pattern id={`hatch-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-soft)" strokeWidth="1" opacity="0.35" />
          </pattern>
        </defs>

        {/* Act-now band */}
        <rect x={x0} y={PLOT_TOP - 14} width={xp - x0} height={PLOT_BOTTOM - PLOT_TOP + 14} fill="var(--ember-soft)" opacity={0.7} />
        <text x={x0 + 8} y={PLOT_TOP - 1} className="fill-ember font-mono font-bold tracking-widest" style={fs(11)}>
          ▶ ACT NOW
        </text>

        {/* Too-late zone */}
        {xc < xEnd - 1 && (
          <>
            <rect x={xc} y={PLOT_TOP - 14} width={xEnd - xc} height={PLOT_BOTTOM - PLOT_TOP + 14} fill={`url(#hatch-${id})`} />
            <text x={xEnd - 6} y={PLOT_TOP - 1} textAnchor="end" className="fill-ink-soft font-mono tracking-widest" style={fs(11)}>
              LATE
            </text>
          </>
        )}

        {axis}

        <path d={area} fill={`url(#fill-${id})`} className="animate-[rise_0.8s_0.9s_both] motion-reduce:animate-none" />
        <path
          d={line}
          fill="none"
          stroke="var(--ember)"
          strokeWidth={3}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          className="animate-draw motion-reduce:animate-none"
        />

        {/* Close marker */}
        <line x1={xc} x2={xc} y1={PLOT_TOP - 14} y2={PLOT_BOTTOM} stroke="var(--ink)" strokeDasharray="2 3" />
        <text
          x={xc - 6}
          y={PLOT_BOTTOM - 8}
          textAnchor="end"
          className="fill-ink font-mono font-bold tracking-wider"
          style={fs(11)}
        >
          CLOSES +{momentum.closesInHours}H
        </text>

        {/* Peak marker */}
        <g className="animate-[rise_0.5s_1.2s_both] motion-reduce:animate-none">
          <circle cx={xp} cy={yTop} r={9} fill="var(--ember)" opacity={0.25} />
          <circle cx={xp} cy={yTop} r={5} fill="var(--ember)" stroke="var(--surface)" strokeWidth={2} />
          <text
            x={peakLabelAnchor === "middle" ? xp : peakLabelAnchor === "end" ? xp - 12 : xp + 12}
            y={yTop + 24}
            textAnchor={peakLabelAnchor}
            className="fill-ink font-mono font-bold tracking-wider"
            style={fs(12)}
          >
            PEAK +{momentum.peakInHours}H
          </text>
        </g>
      </svg>
    </div>
  );
}
