"use client";

import { PLATFORMS, type Platform } from "@/lib/types";

interface ScanFormProps {
  brand: string;
  platform: Platform;
  isScanning: boolean;
  validationMessage: string | null;
  onBrandChange: (value: string) => void;
  onPlatformChange: (value: Platform) => void;
  onSubmit: () => void;
}

const PLATFORM_PARTS: Record<Platform, [string, string]> = {
  tiktok: ["TikTok", "For You"],
  "instagram-reels": ["Reels", "Instagram"],
  "youtube-shorts": ["Shorts", "YouTube"],
};

/** The control deck: brand/category input, platform switch, Run Scan. */
export function ScanForm({
  brand,
  platform,
  isScanning,
  validationMessage,
  onBrandChange,
  onPlatformChange,
  onSubmit,
}: ScanFormProps) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="brand" className="readout text-ink-soft">
          <span className="text-ember">01</span> / Brand or category
        </label>
        <input
          id="brand"
          name="brand"
          type="text"
          autoComplete="off"
          placeholder="Acme Coffee"
          value={brand}
          disabled={isScanning}
          onChange={(event) => onBrandChange(event.target.value)}
          aria-invalid={validationMessage ? true : undefined}
          aria-describedby={validationMessage ? "brand-error" : undefined}
          className="headline w-full min-w-0 border-2 border-ink bg-surface px-4 pt-3 pb-2 text-[38px] placeholder:text-ink-soft/35 focus:border-ember focus:outline-none disabled:opacity-60 aria-invalid:border-demo"
        />
        {validationMessage && (
          <p id="brand-error" role="alert" className="readout text-demo">
            ⚠ {validationMessage}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2" disabled={isScanning}>
        <legend className="readout mb-2 text-ink-soft">
          <span className="text-ember">02</span> / Platform
        </legend>
        <div className="grid grid-cols-3 border-2 border-ink">
          {PLATFORMS.map((option, index) => {
            const selected = option.id === platform;
            const [main, sub] = PLATFORM_PARTS[option.id];
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer flex-col items-start px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-ember ${
                  index > 0 ? "border-l-2 border-ink" : ""
                } ${selected ? "bg-ink text-surface" : "bg-surface hover:bg-canvas"}`}
              >
                <input
                  type="radio"
                  name="platform"
                  value={option.id}
                  checked={selected}
                  onChange={() => onPlatformChange(option.id)}
                  className="sr-only"
                />
                <span className="sr-only">{option.label}</span>
                <span aria-hidden className="headline text-[24px]">{main}</span>
                <span aria-hidden className={`readout ${selected ? "text-ember" : "text-ink-soft"}`}>
                  {selected ? "● " : ""}
                  {sub}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={isScanning}
        className="group flex items-center justify-between border-2 border-ink bg-ember px-5 py-4 text-night shadow-[5px_5px_0_var(--ink)] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_var(--ink)] active:translate-x-[5px] active:translate-y-[5px] active:shadow-none disabled:cursor-wait disabled:opacity-70"
      >
        <span className="headline text-[34px]">
          {isScanning ? (
            <>
              Scanning<span className="animate-blink motion-reduce:animate-none">_</span>
            </>
          ) : (
            "Run scan"
          )}
        </span>
        <span className="readout flex items-center gap-2 font-bold">
          <span className="hidden rounded-sm border border-night/40 px-1.5 py-0.5 sm:inline">⏎ Enter</span>
          <span aria-hidden className="text-[22px] transition-transform group-hover:translate-x-1">→</span>
        </span>
      </button>
    </form>
  );
}
