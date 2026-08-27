"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The address input.
 *
 * Never presented as a bare empty box: the covered metros are named underneath,
 * because an input that silently fails for most of the country is worse than
 * one that says where it works.
 */
export function AddressSearch({
  covered,
  initial = "",
  autoFocus = false,
}: {
  covered: string[];
  initial?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  return (
    <form
      className="no-print"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q) router.push(`/lookup/?q=${encodeURIComponent(q)}`);
      }}
    >
      <label htmlFor="address" className="label">
        Look up a US address
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="address"
          name="address"
          type="text"
          autoFocus={autoFocus}
          autoComplete="street-address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="5100 Bellaire Blvd, Bellaire, TX"
          className="min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          className="shrink-0 rounded-[3px] bg-ink px-5 py-2.5 text-[14px] font-medium text-ground transition-opacity hover:opacity-90"
        >
          Survey this address
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">
        {covered.length > 6 ? (
          <>
            {covered.length} US metros surveyed, including {covered.slice(0, 4).join(", ")} —{" "}
            <a className="text-survey underline underline-offset-2" href="/method/#coverage">
              see the full list
            </a>
            . FortyGuard covers the United States only.
          </>
        ) : (
          <>
            Surveyed metros: {covered.join(" · ")}. FortyGuard covers the United States only.
          </>
        )}
      </p>
    </form>
  );
}
