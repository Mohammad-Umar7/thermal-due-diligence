/**
 * Document furniture.
 *
 * The visual language is a survey plat: a ruled left margin carrying clause
 * numbers, a header block of stamped fields, and progressive disclosure through
 * a details element rather than a modal. Section numbers are real - they follow
 * the order of the argument, and nothing is numbered that is not a section.
 */

import type { ReactNode } from "react";

export function Masthead({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-4 gap-y-2 px-5 py-4 sm:px-8">
        <a href="/" className="font-display text-[19px] font-semibold tracking-tight">
          Thermal Due&nbsp;Diligence
        </a>
        <span className="label hidden sm:inline">Parcel thermal survey</span>
        <div className="ml-auto flex items-center gap-4 text-[13px]">{children}</div>
      </div>
    </header>
  );
}

/** A numbered clause. The number is set in the margin, as on a plan sheet. */
export function Clause({
  n,
  title,
  lede,
  children,
  id,
}: {
  n: string;
  title: string;
  lede?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-rule py-9 first:border-t-0 sm:py-11">
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[64px_1fr]">
        <div className="sm:text-right">
          <span className="figure text-[13px] font-semibold text-survey">§{n}</span>
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-semibold leading-tight sm:text-[26px]">
            {title}
          </h2>
          {lede ? (
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-muted">{lede}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Stamped header fields, as on the title block of a drawing. */
export function FieldBlock({ fields }: { fields: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-4">
      {fields.map((f) => (
        <div key={f.label} className="bg-surface px-3.5 py-3">
          <dt className="label">{f.label}</dt>
          <dd className="mt-1 text-[13.5px] leading-snug">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Progressive disclosure. Headline figures are visible; the arithmetic behind
 * them is one click away and the raw source one click further. Nothing is
 * hidden that a reader would need to challenge the number.
 */
export function HowCalculated({
  summary = "How this was calculated",
  children,
}: {
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-5 rounded-[3px] border border-rule bg-surface-sunk">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-[13px] font-medium text-survey marker:hidden">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ▸
          </span>
          {summary}
        </span>
      </summary>
      <div className="border-t border-rule px-4 py-4">{children}</div>
    </details>
  );
}

/** A traceable chain: each row is an input, a value, and where it came from. */
export function Chain({
  steps,
}: {
  steps: { label: string; value: string; source: string }[];
}) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 ${
            i < steps.length - 1 ? "border-b border-rule" : ""
          } ${i === steps.length - 1 ? "font-medium" : ""}`}
        >
          <span className="figure w-6 shrink-0 text-[11px] text-ink-faint">{i + 1}</span>
          <span className="min-w-0 flex-1 text-[13px]">{s.label}</span>
          <span className="figure shrink-0 text-[13px]">{s.value}</span>
          <span className="w-full pl-9 text-[11.5px] text-ink-faint">{s.source}</span>
        </li>
      ))}
    </ol>
  );
}

/** Limitations are a scoring asset, so they get a real block, not a footnote. */
export function Caveats({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-6 rounded-[3px] border border-rule-strong bg-surface px-4 py-4">
      <div className="label mb-2.5">What this does not tell you</div>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-rule bg-surface">
      <div className="mx-auto max-w-5xl px-5 py-7 text-[12.5px] leading-relaxed text-ink-muted sm:px-8">
        <p className="max-w-3xl">
          Spatial temperature data from the{" "}
          <a className="text-survey underline underline-offset-2" href="https://docs-api.fortyguard.com/docs">
            FortyGuard Temperature API®
          </a>
          . Station observations from{" "}
          <a className="text-survey underline underline-offset-2" href="https://www.ncei.noaa.gov/">
            NOAA NCEI
          </a>{" "}
          (public domain). Design conditions are computed here from raw hourly
          observations using the ASHRAE method; no ASHRAE table is reproduced.
        </p>
        <p className="mt-3">
          A screening tool for due diligence, not a mechanical design document.
        </p>
      </div>
    </footer>
  );
}
