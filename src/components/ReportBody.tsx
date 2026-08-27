/**
 * The survey document itself.
 *
 * Shared by the prerendered showcase parcels and by live address lookups, so
 * both render through exactly one code path. If they diverged, the demo would
 * be showing a document the search could not produce.
 */

import { GapDiagram } from "@/components/GapDiagram";
import { Caveats, Chain, Clause, FieldBlock, HowCalculated } from "@/components/Document";
import type { Report } from "@/lib/report";

const fmt = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

export function ReportBody({ report: r }: { report: Report }) {
  const { city, parcel } = r;
  const hot = r.gap.combinedC >= 0;
  const shortStation = city.station.name.replace(/, [A-Z]{2}$/, "");

  return (
    <>
      <div className="py-8 sm:py-10">
        <p className="label">Parcel thermal survey</p>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight sm:text-[34px]">
          {parcel.label}
        </h1>
        <p className="figure mt-1.5 text-[13px] text-ink-muted">{parcel.address}</p>

        <div className="mt-6">
          <FieldBlock
            fields={[
              {
                label: "Coordinates",
                value: (
                  <span className="figure text-[12.5px]">
                    {parcel.lat.toFixed(5)}, {parcel.lon.toFixed(5)}
                  </span>
                ),
              },
              { label: "Reference station", value: shortStation },
              {
                label: "Record window",
                value: (
                  <span className="figure text-[12.5px]">
                    {city.noaa.historicWindow} · {city.noaa.recentWindow}
                  </span>
                ),
              },
              {
                label: "Resolution",
                value: (
                  <span className="figure text-[12.5px]">
                    {city.fortyguard.granularityM} m · {parcel.tileDistanceM} m from centre
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>

      <Clause
        n="1"
        id="gap"
        title="The design gap"
        lede={`The published design condition for this site is ${fmt(r.gap.standardC)} °C, measured at ${shortStation} over ${city.noaa.historicWindow}. Two independent corrections apply at this address.`}
      >
        <GapDiagram
          standardC={r.gap.standardC}
          temporalC={r.gap.temporalC}
          spatialC={r.gap.spatialC}
          stationName={city.station.name}
          parcelLabel={parcel.label}
          standardWindow={city.noaa.historicWindow}
          recentWindow={city.noaa.recentWindow}
        />

        <p className="mt-7 max-w-2xl border-t border-rule pt-5 text-[15px] leading-relaxed">
          {hot ? (
            <>
              A system sized to the published standard at this address is undersized by{" "}
              <strong className="figure font-semibold">{fmt(r.gap.combinedC)} °C</strong> on the
              design day.
            </>
          ) : (
            <>
              This parcel runs{" "}
              <strong className="figure font-semibold">{fmt(Math.abs(r.gap.combinedC))} °C</strong>{" "}
              cooler than the published standard. A system sized to that standard here is
              oversized — which costs capital, not comfort.
            </>
          )}
        </p>

        <HowCalculated summary="How the published standard was computed">
          <Chain steps={r.provenance.standard} />
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-muted">
            ASHRAE publishes design conditions in licensed tables. None is used here. We apply
            the published <em>method</em> — the temperature exceeded 0.4% of hours in an average
            year — to public-domain NOAA observations. On the 1991–2020 window this reproduces
            the figure the industry designs to for Phoenix (43.90 °C), which is how we know the
            method is right.
          </p>
        </HowCalculated>

        <HowCalculated summary={`How the temporal component (${signed(r.gap.temporalC)} °C) was computed`}>
          <Chain steps={r.provenance.temporal} />
        </HowCalculated>

        <HowCalculated summary={`How the spatial component (${signed(r.gap.spatialC)} °C) was computed`}>
          <Chain steps={r.provenance.spatial} />
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-muted">
            Both temperatures come from the same FortyGuard survey, over the same period, at the
            same granularity — so the difference reflects location rather than method.
            FortyGuard&rsquo;s absolute level is never subtracted from NOAA&rsquo;s; only the
            offset between two FortyGuard points is used.
          </p>
        </HowCalculated>

        <Caveats items={r.caveats} />
      </Clause>

      <Clause
        n="2"
        title="Where this sits in the metro"
        lede={`Across ${city.fortyguard.nTiles.toLocaleString("en-US")} tiles covering a ${city.fortyguard.boxKm} km square, parcel offsets from the station span ${fmt(city.fortyguard.peakOffsetC.min)} to ${signed(city.fortyguard.peakOffsetC.max)} °C.`}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="This parcel"
            value={signed(parcel.spatialOffsetC)}
            unit="°C vs station"
            accent={parcel.spatialOffsetC >= 0 ? "var(--heat-2)" : "var(--cool)"}
          />
          <Stat
            label="Metro percentile"
            value={`${parcel.metroPercentile.toFixed(0)}%`}
            unit="of the metro is cooler"
          />
          <Stat
            label="Metro hotter than station"
            value={`${city.fortyguard.pctMetroHotterThanStation.toFixed(0)}%`}
            unit="of the surveyed area"
          />
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-[13px]">
            <caption className="label pb-2 text-left">
              Distribution of parcel offsets from the station, {city.fortyguard.month}
            </caption>
            <tbody>
              {(
                [
                  ["Coolest tile", city.fortyguard.peakOffsetC.min],
                  ["1st percentile", city.fortyguard.peakOffsetC.p1],
                  ["Median", city.fortyguard.peakOffsetC.median],
                  ["99th percentile", city.fortyguard.peakOffsetC.p99],
                  ["Hottest tile", city.fortyguard.peakOffsetC.max],
                ] as [string, number][]
              ).map(([k, v]) => (
                <tr key={k} className="border-b border-rule">
                  <td className="py-2 text-ink-muted">{k}</td>
                  <td className="figure py-2 text-right">{signed(v)} °C</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Clause>

      <Clause
        n="3"
        title="The reference station's record"
        lede={`Pure arithmetic over ${city.noaa.nRecentObservations.toLocaleString("en-US")} hourly observations, ${city.noaa.recentWindow}. These describe the station, not the parcel.`}
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat
            label="Cooling degree days"
            value={r.station.cddPerYearC.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            unit={`per year, base ${r.station.cddBaseC} °C`}
          />
          {Object.entries(r.station.hoursAbovePerYear).map(([t, h]) => (
            <Stat
              key={t}
              label={`Hours above ${t} °C`}
              value={h.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              unit="per year"
            />
          ))}
        </div>

        <HowCalculated summary="How cooling degree days were computed">
          <Chain
            steps={[
              {
                label: "Daily mean",
                value: "mean of that day's valid hours",
                source: `days with fewer than 18 observations are excluded (${city.noaa.daysDroppedSparse} dropped)`,
              },
              {
                label: "Per day",
                value: `max(0, mean − ${r.station.cddBaseC})`,
                source: "base 18.3 °C is 65 °F, the US convention",
              },
              {
                label: "Annual total",
                value: `${r.station.cddPerYearC.toFixed(0)} degree-days`,
                source: `summed then divided by years with data; worst-year coverage ${city.noaa.coverageWorstPct}%`,
              },
            ]}
          />
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-muted">
            We stop at degree days. Converting these to an energy cost would need a published
            tariff and a stated system efficiency, and the second is a property of a building we
            have not seen. A figure with a guessed link in its chain is worse than no figure.
          </p>
        </HowCalculated>
      </Clause>

      <Clause n="4" title="Validation" lede="The check that would break this method, run and reported.">
        <p className="max-w-2xl text-[14px] leading-relaxed">
          FortyGuard is an interpolated model and smooths temperature extremes. Comparing its
          peak against the station&rsquo;s observed peak at the <em>same point</em> measures that
          smoothing — and shows why its absolute level is never used here.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13.5px]">
            <caption className="label pb-2 text-left">
              {shortStation}, July 2024, same coordinates
            </caption>
            <tbody>
              <tr className="border-b border-rule">
                <td className="py-2 text-ink-muted">NOAA observed maximum</td>
                <td className="figure py-2 text-right">
                  {city.validation.noaaJuly2024MaxC?.toFixed(2)} °C
                </td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2 text-ink-muted">FortyGuard modelled maximum</td>
                <td className="figure py-2 text-right">
                  {city.validation.fortyguardJuly2024MaxC.toFixed(2)} °C
                </td>
              </tr>
              <tr className="border-b-2 border-ink">
                <td className="py-2 font-medium">Difference</td>
                <td className="figure py-2 text-right font-semibold">
                  {city.validation.fortyguardMinusNoaaMaxC !== null
                    ? `${signed(city.validation.fortyguardMinusNoaaMaxC)} °C`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-2xl text-[12.5px] leading-relaxed text-ink-muted">
          This difference is a property of the model, not of any location. It is why the absolute
          level always comes from NOAA and FortyGuard supplies only the offset between two points
          measured the same way.
        </p>
      </Clause>
    </>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: string;
}) {
  return (
    <div className="rounded-[3px] border border-rule bg-surface px-4 py-3.5">
      <div className="label">{label}</div>
      <div
        className="figure mt-1.5 text-[24px] font-semibold leading-none"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] text-ink-faint">{unit}</div>
    </div>
  );
}
