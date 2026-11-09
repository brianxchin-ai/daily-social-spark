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
      className="flex flex-col gap-5 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="brand" className="text-sm font-medium">
          Brand or category
        </label>
        <input
          id="brand"
          name="brand"
          type="text"
          autoComplete="off"
          placeholder="e.g. Oat milk, Trail running shoes, Acme Coffee"
          value={brand}
          disabled={isScanning}
          onChange={(event) => onBrandChange(event.target.value)}
          aria-invalid={validationMessage ? true : undefined}
          aria-describedby={validationMessage ? "brand-error" : undefined}
          className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 disabled:opacity-60 dark:border-neutral-700"
        />
        {validationMessage && (
          <p id="brand-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {validationMessage}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2" disabled={isScanning}>
        <legend className="mb-2 text-sm font-medium">Platform</legend>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((option) => {
            const selected = option.id === platform;
            return (
              <label
                key={option.id}
                className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                  selected
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-300 dark:border-neutral-700"
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
        className="self-start rounded-md bg-neutral-900 px-5 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {isScanning ? "Scanning…" : "Run Scan"}
      </button>
    </form>
  );
}
