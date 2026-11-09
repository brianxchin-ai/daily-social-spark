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

/** Brand/category input, platform selector and Run Scan button. */
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
      className="grid gap-8 border-t border-ink pt-6 md:grid-cols-[200px_1fr] md:gap-12"
    >
      <p className="eyebrow">01 — The brief</p>

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <label htmlFor="brand" className="eyebrow text-ink-soft">
            Brand or category
          </label>
          <input
            id="brand"
            name="brand"
            type="text"
            autoComplete="off"
            placeholder="e.g. Oat milk, trail running shoes, Acme Coffee"
            value={brand}
            disabled={isScanning}
            onChange={(event) => onBrandChange(event.target.value)}
            aria-invalid={validationMessage ? true : undefined}
            aria-describedby={validationMessage ? "brand-error" : undefined}
            className="w-full border-b border-rule bg-transparent pt-1 pb-3 font-serif text-[30px] leading-tight placeholder:text-ink-soft/50 focus:border-accent focus:outline-none disabled:opacity-60 aria-invalid:border-red-700 sm:text-[36px]"
          />
          {validationMessage && (
            <p id="brand-error" role="alert" className="text-sm text-red-700 dark:text-red-400">
              {validationMessage}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-3" disabled={isScanning}>
          <legend className="eyebrow mb-3 text-ink-soft">Platform</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {PLATFORMS.map((option) => {
              const selected = option.id === platform;
              return (
                <label
                  key={option.id}
                  className={`eyebrow cursor-pointer border-b-2 pb-1.5 text-[12px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-accent ${
                    selected
                      ? "border-accent text-ink"
                      : "border-transparent text-ink-soft hover:text-ink"
                  }`}
                >
                  <input
                    type="radio"
                    name="platform"
                    value={option.id}
                    checked={selected}
                    onChange={() => onPlatformChange(option.id)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={isScanning}
          className="eyebrow group inline-flex items-center gap-3 self-start bg-ink px-6 py-4 text-[12px] text-paper transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          {isScanning ? "Scanning…" : "Run scan"}
          <span
            aria-hidden
            className="text-base leading-none transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          >
            ↗
          </span>
        </button>
      </div>
    </form>
  );
}
