"use client";

import { AUDIENCE_MAX } from "@/lib/prompts/audience";
import { PLATFORMS, type Platform } from "@/lib/types";

interface ScanFormProps {
  brand: string;
  platform: Platform;
  isScanning: boolean;
  validationMessage: string | null;
  onBrandChange: (value: string) => void;
  onPlatformChange: (value: Platform) => void;
  audience: string;
  onAudienceChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const PLATFORM_PARTS: Record<Platform, [string, string]> = {
  tiktok: ["TikTok", "For You"],
  "instagram-reels": ["Instagram", "Reels & feed"],
  "youtube-shorts": ["YouTube", "Shorts"],
  facebook: ["Facebook", "Reels & feed"],
  snapchat: ["Snapchat", "Spotlight"],
};

/** The control deck: brand/category input, platform switch, Run Scan. */
export function ScanForm({
  brand,
  platform,
  isScanning,
  validationMessage,
  onBrandChange,
  onPlatformChange,
  audience,
  onAudienceChange,
  onSubmit,
  onCancel,
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

      <div className="flex flex-col gap-2">
        <label htmlFor="audience" className="readout text-ink-soft">
          <span className="text-ember">02</span> / Audience <span className="normal-case">(optional)</span>
        </label>
        <textarea
          id="audience"
          name="audience"
          rows={2}
          maxLength={AUDIENCE_MAX}
          autoComplete="off"
          placeholder="College students who treat academic achievements like video games"
          value={audience}
          disabled={isScanning}
          onChange={(event) => onAudienceChange(event.target.value)}
          onKeyDown={(event) => {
            // One line of description: Enter runs the scan, as in the brand field.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-describedby="audience-help"
          className="w-full min-w-0 resize-none border-2 border-ink bg-surface px-4 py-2.5 text-[16px] leading-snug placeholder:text-ink-soft/50 focus:border-ember focus:outline-none disabled:opacity-60"
        />
        <p id="audience-help" className="readout flex justify-between gap-3 text-ink-soft">
          {/* A non-breaking space keeps "read" from sitting alone on the last line. */}
          <span className="text-pretty">Who you want to reach. Leave blank for a broad{"\u00A0"}read.</span>
          <span className="tabular-nums">{audience.length}/{AUDIENCE_MAX}</span>
        </p>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={isScanning}>
        <legend className="readout mb-2 text-ink-soft">
          <span className="text-ember">03</span> / Platform
        </legend>
        {/* Six-column grid: three platforms on the first row, two wider ones on the second. Gaps show the ink lines. */}
        <div className="grid grid-cols-6 gap-[2px] border-2 border-ink bg-ink">
          {PLATFORMS.map((option, index) => {
            const selected = option.id === platform;
            const [main, sub] = PLATFORM_PARTS[option.id];
            return (
              <label
                key={option.id}
                className={`flex min-w-0 cursor-pointer flex-col items-start px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-ember ${
                  index < 3 ? "col-span-2" : "col-span-3"
                } ${selected ? "bg-ink text-surface outline-2 -outline-offset-2 outline-ember" : "bg-surface hover:bg-canvas"}`}
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

      {isScanning ? (
        // While a scan runs, the same slot becomes Cancel: same shape, quieter color.
        <button
          key="cancel"
          type="button"
          onClick={(event) => {
            // Don't let this click fall through to the Run scan button that replaces it.
            event.preventDefault();
            onCancel();
          }}
          className="group flex items-center justify-between border-2 border-ink bg-surface px-5 py-4 text-ink shadow-[5px_5px_0_var(--ink)] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_var(--ink)] active:translate-x-[5px] active:translate-y-[5px] active:shadow-none"
        >
          <span className="headline text-[34px]">Cancel scan</span>
          <span className="readout flex items-center gap-2 font-bold">
            <span className="hidden rounded-sm border border-ink/40 px-1.5 py-0.5 sm:inline">Esc</span>
            <span aria-hidden className="text-[22px]">✕</span>
          </span>
        </button>
      ) : (
        <button
          key="run"
          type="submit"
          className="group flex items-center justify-between border-2 border-ink bg-ember px-5 py-4 text-night shadow-[5px_5px_0_var(--ink)] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_var(--ink)] active:translate-x-[5px] active:translate-y-[5px] active:shadow-none"
        >
          <span className="headline text-[34px]">Run scan</span>
          <span className="readout flex items-center gap-2 font-bold">
            <span className="hidden rounded-sm border border-night/40 px-1.5 py-0.5 sm:inline">⏎ Enter</span>
            <span aria-hidden className="text-[22px] transition-transform group-hover:translate-x-1">→</span>
          </span>
        </button>
      )}
    </form>
  );
}
