"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AddressSearch } from "@/components/AddressSearch";
import { Footer, Masthead } from "@/components/Document";
import { ReportBody } from "@/components/ReportBody";
import { GeocodeError, geocode } from "@/lib/geocode";
import { RasterError, cellDistanceM, covers, loadRaster, percentileOf, sample } from "@/lib/raster";
import { buildReport, listCities, parcelFromLookup, type CityRecord, type Report } from "@/lib/report";

type State =
  | { phase: "idle" }
  | { phase: "working"; step: string }
  | { phase: "done"; report: Report }
  | { phase: "error"; title: string; detail: string; showCovered: boolean };

export default function LookupPage() {
  return (
    <Suspense fallback={null}>
      <Lookup />
    </Suspense>
  );
}

function Lookup() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [state, setState] = useState<State>({ phase: "idle" });
  const cities = listCities();
  const coveredNames = cities.filter((c) => c.raster).map((c) => c.label);

  useEffect(() => {
    if (!query) {
      setState({ phase: "idle" });
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        setState({ phase: "working", step: "Finding the address" });
        const match = await geocode(query);
        if (cancelled) return;

        const city = cities.find((c) => covers(c, match.lat, match.lon));
        if (!city || !city.raster) {
          setState({
            phase: "error",
            title: "Outside the surveyed area",
            detail: `${match.matchedAddress} resolved successfully, but it falls outside every metro surveyed so far. Each survey is one FortyGuard request covering a 30–40 km square; more can be added.`,
            showCovered: true,
          });
          return;
        }

        setState({ phase: "working", step: `Loading the ${city.label} temperature field` });
        const grid = await loadRaster(city);
        if (cancelled) return;

        setState({ phase: "working", step: "Reading the parcel" });
        const peakC = sample(city.raster, grid, match.lat, match.lon);
        const parcel = parcelFromLookup({
          matchedAddress: match.matchedAddress,
          lat: match.lat,
          lon: match.lon,
          peakC,
          cellDistanceM: cellDistanceM(city.raster, match.lat, match.lon),
          metroPercentile: percentileOf(city.raster, grid, peakC),
          stationPeakC: city.fortyguard.stationTile.maxC,
        });
        if (cancelled) return;
        setState({ phase: "done", report: buildReport(city, parcel) });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof GeocodeError) {
          setState({
            phase: "error",
            title: err.kind === "no-match" ? "No matching US address" : "Address lookup unavailable",
            detail: err.message,
            showCovered: err.kind === "no-match",
          });
        } else if (err instanceof RasterError) {
          setState({
            phase: "error",
            title:
              err.kind === "outside-coverage" ? "Outside the surveyed area" : "No measurement here",
            detail: err.message,
            showCovered: err.kind === "outside-coverage",
          });
        } else {
          setState({
            phase: "error",
            title: "Something went wrong",
            detail: err instanceof Error ? err.message : String(err),
            showCovered: false,
          });
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // `cities` is derived from a static import and is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <>
      <Masthead>
        <Link className="text-survey underline underline-offset-2" href="/method">
          How this works
        </Link>
        <Link className="text-survey underline underline-offset-2 no-print" href="/">
          Examples
        </Link>
      </Masthead>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        <div className="border-b border-rule py-7">
          <AddressSearch covered={coveredNames} initial={query} autoFocus={!query} />
        </div>

        {state.phase === "working" ? <Working step={state.step} /> : null}

        {state.phase === "error" ? (
          <Failure
            title={state.title}
            detail={state.detail}
            covered={state.showCovered ? cities.filter((c) => c.raster) : []}
          />
        ) : null}

        {state.phase === "done" ? <ReportBody report={state.report} /> : null}

        {state.phase === "idle" ? (
          <div className="py-14">
            <p className="max-w-xl text-[15px] leading-relaxed text-ink-muted">
              Enter a street address above. Nothing is sent to an API at lookup time — the
              temperature field for each surveyed metro is measured once and read directly in
              your browser.
            </p>
          </div>
        ) : null}
      </main>

      <Footer />
    </>
  );
}

/** Skeleton, never a spinner on a blank page. */
function Working({ step }: { step: string }) {
  return (
    <div className="py-10" aria-live="polite">
      <p className="label">{step}…</p>
      <div className="mt-5 space-y-3" aria-hidden>
        <div className="h-9 w-2/3 rounded-[3px] bg-surface-sunk" />
        <div className="h-4 w-1/3 rounded-[3px] bg-surface-sunk" />
        <div className="mt-7 h-[300px] rounded-[4px] border border-rule bg-surface" />
      </div>
    </div>
  );
}

function Failure({
  title,
  detail,
  covered,
}: {
  title: string;
  detail: string;
  covered: CityRecord[];
}) {
  return (
    <div className="py-12">
      <p className="label">Cannot survey this address</p>
      <h1 className="mt-2 font-display text-[26px] font-semibold">{title}</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-muted">{detail}</p>

      {covered.length > 0 ? (
        <div className="mt-7">
          <p className="label mb-3">Try an address in a surveyed metro</p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {covered.map((c) => {
              const example = c.parcels[0];
              return (
                <li key={c.city}>
                  <Link
                    href={`/report/${example?.id ?? ""}`}
                    className="flex h-full flex-col rounded-[4px] border border-rule bg-surface p-4 transition-colors hover:border-rule-strong"
                  >
                    <span className="font-display text-[16px] font-semibold">{c.label}</span>
                    <span className="mt-1 text-[12px] text-ink-faint">
                      {c.fortyguard.boxKm} km survey · {c.station.name.replace(/, [A-Z]{2}$/, "")}
                    </span>
                    {example ? (
                      <span className="mt-2 text-[12px] text-survey">
                        Example: {example.label} →
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
