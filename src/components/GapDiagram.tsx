"use client";

/**
 * The Gap, drawn as a surveyor's levelling diagram.
 *
 * A level shot establishes a benchmark and measures height above it. That is
 * exactly the shape of this argument: the published design condition is the
 * datum, and the parcel's true design condition sits some distance above it.
 *
 * The two components are stacked segments within that distance because they
 * literally add - temporal + spatial = combined. The structure encodes the
 * arithmetic rather than decorating it.
 *
 * This is the one place in the interface with an orchestrated motion moment:
 * the upper datum rises from the lower one to its true offset, drawing each
 * segment as it passes. Nothing else on the page animates.
 */

import { useLayoutEffect, useRef, useState } from "react";

export interface GapDiagramProps {
  /** Published-era design condition at the reference station, degrees C. */
  standardC: number;
  /** Recent-window minus published-era, degrees C. NOAA only. */
  temporalC: number;
  /** Parcel minus station, degrees C. FortyGuard, same request both sides. */
  spatialC: number;
  stationName: string;
  parcelLabel: string;
  standardWindow: string;
  recentWindow: string;
}

const fmt = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

export function GapDiagram({
  standardC,
  temporalC,
  spatialC,
  stationName,
  parcelLabel,
  standardWindow,
  recentWindow,
}: GapDiagramProps) {
  const combinedC = Math.round((temporalC + spatialC) * 100) / 100;
  const parcelC = Math.round((standardC + combinedC) * 100) / 100;

  /*
    The finished diagram is the default state, not the end state of an
    animation. It renders correctly on the server, without JavaScript, under
    reduced-motion, and when requestAnimationFrame is throttled - which browsers
    do to backgrounded and non-compositing tabs. Motion is added on top only
    when we can be sure it will actually complete.
  */
  const [drawn, setDrawn] = useState(1);
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || typeof window === "undefined") return;

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      return; // stays fully drawn
    }

    const DURATION = 1150;
    let raf = 0;
    let started = false;
    let done = false;

    const finish = () => {
      done = true;
      setDrawn(1);
    };

    /*
      A single watchdog, armed at mount rather than at intersection.
      Neither IntersectionObserver nor requestAnimationFrame is guaranteed to
      fire on a page the browser is not painting, so anything that hangs off
      them cannot be the only route back to the finished state.
    */
    const watchdog = window.setTimeout(() => {
      if (!done) finish();
    }, 2500);

    setDrawn(0);

    const io = new IntersectionObserver(
      (entries) => {
        if (done || started || !entries.some((e) => e.isIntersecting)) return;
        started = true;
        io.disconnect();

        const t0 = performance.now();
        const tick = (now: number) => {
          if (done) return;
          const t = Math.min(1, (now - t0) / DURATION);
          // Ease-out cubic: the level rises quickly then settles, the way a
          // staff reading resolves.
          setDrawn(1 - Math.pow(1 - t, 3));
          if (t < 1) raf = requestAnimationFrame(tick);
          else done = true;
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    io.observe(host);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(watchdog);
    };
  }, []);

  // Geometry. The vertical axis is degrees; segments are drawn to scale.
  const H = 300;
  const PAD_TOP = 46;
  const PAD_BOTTOM = 54;
  const usable = H - PAD_TOP - PAD_BOTTOM;
  const magnitude = Math.max(Math.abs(combinedC), 0.5);
  const pxPerDeg = usable / magnitude;

  const baseY = H - PAD_BOTTOM;
  const temporalPx = temporalC * pxPerDeg * drawn;
  const spatialPx = spatialC * pxPerDeg * drawn;
  const temporalTopY = baseY - temporalPx;
  const parcelY = temporalTopY - spatialPx;

  const currentC = standardC + combinedC * drawn;
  const rising = combinedC >= 0;

  return (
    <div ref={hostRef} className="relative">
      <div className="grid gap-6 md:grid-cols-[1fr_260px] md:gap-10">
        {/* ---- the diagram ---- */}
        <svg
          viewBox={`0 0 460 ${H}`}
          className="w-full"
          role="img"
          aria-label={`Levelling diagram. Published standard ${fmt(standardC)} degrees Celsius at ${stationName}. Temporal component ${signed(temporalC)}, spatial component ${signed(spatialC)}, combined ${signed(combinedC)}. Design condition at ${parcelLabel} is ${fmt(parcelC)} degrees Celsius.`}
        >
          <defs>
            <pattern id="gd-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--rule)" strokeWidth="1" />
            </pattern>
          </defs>

          {/* graticule - the faint grid of a plan sheet, one line per 0.5 deg */}
          {Array.from({ length: Math.ceil(magnitude / 0.5) + 1 }, (_, i) => {
            const y = baseY - i * 0.5 * pxPerDeg * (rising ? 1 : -1);
            if (y < PAD_TOP - 10 || y > H - 10) return null;
            return (
              <line
                key={i}
                x1="52"
                x2="452"
                y1={y}
                y2={y}
                stroke="var(--rule)"
                strokeWidth="1"
                strokeDasharray="1 5"
                opacity="0.7"
              />
            );
          })}

          {/* ground hatching below the datum, as on a section drawing */}
          <rect x="52" y={baseY} width="400" height="10" fill="url(#gd-hatch)" opacity="0.65" />

          {/* ---- lower datum: the published standard ---- */}
          <line x1="52" x2="452" y1={baseY} y2={baseY} stroke="var(--ink)" strokeWidth="2" />
          <text x="52" y={baseY + 26} className="label" fill="var(--ink-faint)" fontSize="10.5">
            PUBLISHED STANDARD
          </text>
          <text x="52" y={baseY + 41} fontSize="11" fill="var(--ink-muted)" fontFamily="var(--font-sans)">
            {stationName} · {standardWindow}
          </text>
          <text
            x="452"
            y={baseY - 9}
            textAnchor="end"
            className="figure"
            fontSize="19"
            fontWeight="500"
            fill="var(--ink)"
          >
            {fmt(standardC)} °C
          </text>

          {/* ---- segment 1: temporal ---- */}
          <rect
            x="150"
            y={Math.min(baseY, temporalTopY)}
            width="86"
            height={Math.abs(temporalPx)}
            fill="var(--survey)"
            opacity="0.16"
          />
          <line
            x1="150"
            x2="236"
            y1={temporalTopY}
            y2={temporalTopY}
            stroke="var(--survey)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            opacity={drawn > 0.05 ? 1 : 0}
          />

          {/* ---- segment 2: spatial ---- */}
          <rect
            x="236"
            y={Math.min(temporalTopY, parcelY)}
            width="86"
            height={Math.abs(spatialPx)}
            fill="var(--heat-2)"
            opacity="0.2"
          />

          {/* ---- upper datum: the parcel ---- */}
          <line
            x1="52"
            x2="452"
            y1={parcelY}
            y2={parcelY}
            stroke={rising ? "var(--heat-2)" : "var(--cool)"}
            strokeWidth="2.5"
          />
          <text
            x="52"
            y={parcelY - 20}
            className="label"
            fill={rising ? "var(--heat-2)" : "var(--cool)"}
            fontSize="10.5"
          >
            THIS PARCEL
          </text>
          <text x="52" y={parcelY - 7} fontSize="11" fill="var(--ink-muted)" fontFamily="var(--font-sans)">
            {parcelLabel}
          </text>
          <text
            x="452"
            y={parcelY - 10}
            textAnchor="end"
            className="figure"
            fontSize="27"
            fontWeight="600"
            fill={rising ? "var(--heat-2)" : "var(--cool)"}
          >
            {fmt(currentC)} °C
          </text>

          {/* ---- the measured distance, annotated in the gutter ---- */}
          <line
            x1="112"
            x2="112"
            y1={baseY}
            y2={parcelY}
            stroke="var(--ink-muted)"
            strokeWidth="1"
          />
          <line x1="105" x2="119" y1={baseY} y2={baseY} stroke="var(--ink-muted)" strokeWidth="1" />
          <line x1="105" x2="119" y1={parcelY} y2={parcelY} stroke="var(--ink-muted)" strokeWidth="1" />
          <text
            x="104"
            y={(baseY + parcelY) / 2 + 4}
            textAnchor="end"
            className="figure"
            fontSize="15"
            fontWeight="600"
            fill="var(--ink)"
          >
            {signed(combinedC * drawn)}
          </text>
        </svg>

        {/* ---- the arithmetic, alongside ---- */}
        <div className="self-end">
          <div className="label mb-3">The measurement</div>
          <dl className="text-[13px]">
            <Row
              term="Published standard"
              detail={`${standardWindow}, NOAA hourly record`}
              value={`${fmt(standardC)} °C`}
            />
            <Row
              term="Temporal"
              detail={`same statistic on ${recentWindow}`}
              value={signed(temporalC)}
              swatch="var(--survey)"
            />
            <Row
              term="Spatial"
              detail="parcel vs station, FortyGuard"
              value={signed(spatialC)}
              swatch="var(--heat-2)"
            />
            <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-2">
              <dt className="font-semibold">Design condition here</dt>
              <dd className="figure text-base font-semibold">{fmt(parcelC)} °C</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-muted">
            Components are shown separately because they come from different
            evidence. The temporal term uses only station observations. The
            spatial term compares two points measured by the same instrument in
            the same request.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({
  term,
  detail,
  value,
  swatch,
}: {
  term: string;
  detail: string;
  value: string;
  swatch?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2">
      <div className="min-w-0">
        <dt className="flex items-center gap-2 font-medium">
          {swatch ? (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[1px]"
              style={{ background: swatch, opacity: 0.85 }}
            />
          ) : null}
          {term}
        </dt>
        <div className="pl-0 text-[11.5px] text-ink-faint" style={{ paddingLeft: swatch ? 18 : 0 }}>
          {detail}
        </div>
      </div>
      <dd className="figure shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
