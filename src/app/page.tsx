import Link from "next/link";
import { AddressSearch } from "@/components/AddressSearch";
import { GapDiagram } from "@/components/GapDiagram";
import { Footer, Masthead } from "@/components/Document";
import { FEATURED_CITY, buildReport, getCity, listCities } from "@/lib/report";

export default function Home() {
  const city = getCity(FEATURED_CITY)!;
  // The landing state argues with a real, pre-computed parcel - never a mockup.
  const hero = city.parcels.reduce((a, b) => (b.spatialOffsetC > a.spatialOffsetC ? b : a));
  const report = buildReport(city, hero);
  const covered = listCities().filter((c) => c.raster).map((c) => c.label);

  return (
    <>
      <Masthead>
        <Link className="text-survey underline underline-offset-2" href="/method/">
          How this works
        </Link>
      </Masthead>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        {/* ---- the thesis, before any input ---- */}
        <section className="py-12 sm:py-16">
          <p className="label">The premise</p>
          <h1 className="mt-3 max-w-3xl font-display text-[30px] font-semibold leading-[1.15] sm:text-[44px]">
            Every building in America is designed using a temperature from the
            airport. We tell you what it actually is at your address.
          </h1>
          <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-ink-muted">
            Cooling systems are sized against a published design condition,
            measured at one reference weather station and computed on a
            historic window. Two things make that number wrong for a specific
            parcel: the climate has moved since the window closed, and the
            parcel is not the station. Both are measurable.
          </p>

          <div className="mt-8 max-w-2xl rounded-[4px] border border-rule bg-surface p-5">
            <AddressSearch covered={covered} />
          </div>
        </section>

        {/* ---- the signature element ---- */}
        <section className="rounded-[4px] border border-rule bg-surface p-5 shadow-[var(--shadow-card)] sm:p-8">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="label">Worked example</p>
              <h2 className="mt-1 font-display text-[20px] font-semibold">
                {hero.label}, {city.label}
              </h2>
            </div>
            <p className="figure text-[12px] text-ink-faint">{hero.address}</p>
          </div>

          <GapDiagram
            standardC={report.gap.standardC}
            temporalC={report.gap.temporalC}
            spatialC={report.gap.spatialC}
            stationName={city.station.name}
            parcelLabel={hero.label}
            standardWindow={city.noaa.historicWindow}
            recentWindow={city.noaa.recentWindow}
          />

          <p className="mt-7 max-w-2xl border-t border-rule pt-5 text-[14.5px] leading-relaxed">
            A system sized to the published standard at this address is
            undersized by{" "}
            <strong className="figure font-semibold">
              {report.gap.combinedC.toFixed(2)} °C
            </strong>{" "}
            on the design day.
          </p>
          <div className="mt-5">
            <Link
              href={`/report/${hero.id}/`}
              className="inline-flex items-center gap-2 rounded-[3px] bg-ink px-4 py-2.5 text-[14px] font-medium text-ground transition-opacity hover:opacity-90"
            >
              Read the full survey
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>

        {/* ---- guided first run: never an empty search box ---- */}
        <section className="py-12 sm:py-16">
          <p className="label">Start here</p>
          <h2 className="mt-2 font-display text-[24px] font-semibold">
            Three parcels, one click each
          </h2>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-muted">
            All in {city.label}, all measured against the same station in the
            same request. The standard is wrong in both directions — one of
            these is <em>cooler</em> than the number its engineer would use.
          </p>

          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {city.parcels.map((p) => {
              const r = buildReport(city, p);
              const hot = r.gap.combinedC >= 0;
              return (
                <li key={p.id}>
                  <Link
                    href={`/report/${p.id}/`}
                    className="flex h-full flex-col rounded-[4px] border border-rule bg-surface p-4 transition-colors hover:border-rule-strong"
                  >
                    <span className="label">{p.kind}</span>
                    <span className="mt-1.5 font-display text-[17px] font-semibold leading-snug">
                      {p.label}
                    </span>
                    <span className="mt-1 text-[12px] text-ink-faint">{p.address}</span>
                    <span className="mt-4 flex items-baseline gap-2 border-t border-rule pt-3">
                      <span
                        className="figure text-[22px] font-semibold"
                        style={{ color: hot ? "var(--heat-2)" : "var(--cool)" }}
                      >
                        {hot ? "+" : "−"}
                        {Math.abs(r.gap.combinedC).toFixed(2)}
                      </span>
                      <span className="text-[12px] text-ink-muted">°C vs standard</span>
                    </span>
                    <span className="mt-1 text-[11.5px] text-ink-faint">
                      hotter than {p.metroPercentile.toFixed(0)}% of the metro
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---- the other cities, with the honest caveat that direction varies ---- */}
        <section className="border-t border-rule py-12">
          <p className="label">Other metros surveyed</p>
          <h2 className="mt-2 font-display text-[24px] font-semibold">
            The station&rsquo;s bias is a property of the city
          </h2>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-muted">
            The intuition that reference stations sit on cool grass while the
            city bakes is not generally true. In Phoenix the airport is hotter
            than two-thirds of its metro, so the standard <em>over</em>-sizes
            for most parcels there.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-left">
                  <th className="label py-2 font-semibold">Metro</th>
                  <th className="label py-2 font-semibold">Reference station</th>
                  <th className="label py-2 text-right font-semibold">Temporal</th>
                  <th className="label py-2 text-right font-semibold">Spatial range</th>
                  <th className="label py-2 text-right font-semibold">Metro hotter</th>
                </tr>
              </thead>
              <tbody>
                {listCities().map((c) => {
                  const temporal = c.noaa.design04RecentC - c.noaa.design04HistoricC;
                  return (
                    <tr key={c.city} className="border-b border-rule">
                      <td className="py-2.5 font-medium">{c.label}</td>
                      <td className="py-2.5 text-ink-muted">
                        {c.station.name.replace(/, [A-Z]{2}$/, "")}
                      </td>
                      <td className="figure py-2.5 text-right">
                        {temporal >= 0 ? "+" : "−"}
                        {Math.abs(temporal).toFixed(2)}
                      </td>
                      <td className="figure py-2.5 text-right text-ink-muted">
                        {c.fortyguard.peakOffsetC.min.toFixed(2)} to +
                        {c.fortyguard.peakOffsetC.max.toFixed(2)}
                      </td>
                      <td className="figure py-2.5 text-right">
                        {c.fortyguard.pctMetroHotterThanStation.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[12px] text-ink-faint">
            Temporal is degrees Celsius, the same 0.4% design statistic recomputed
            on 2019–2024 against each station&rsquo;s historic window. Spatial range
            is the span of parcel offsets across the surveyed area, July 2024.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
