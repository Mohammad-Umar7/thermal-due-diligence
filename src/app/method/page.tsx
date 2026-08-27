import Link from "next/link";
import { Clause, Footer, Masthead } from "@/components/Document";
import { listCities } from "@/lib/report";

export const metadata = {
  title: "How this works — Thermal Due Diligence",
  description:
    "Method, data sources and limitations for the parcel thermal survey: how the design condition is computed, why NOAA and FortyGuard are never differenced directly, and what this cannot tell you.",
};

export default function MethodPage() {
  const cities = listCities();

  return (
    <>
      <Masthead>
        <Link className="text-survey underline underline-offset-2" href="/lookup/">
          Look up an address
        </Link>
        <Link className="text-survey underline underline-offset-2" href="/">
          Examples
        </Link>
      </Masthead>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        <div className="py-8 sm:py-10">
          <p className="label">Method, sources and limits</p>
          <h1 className="mt-2 max-w-2xl font-display text-[30px] font-semibold leading-tight sm:text-[38px]">
            How this works
          </h1>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink-muted">
            Every figure in a survey is computed from two public inputs. This page gives the
            formula, the source and the caveat for each one, so any number on screen can be
            traced back to its arithmetic.
          </p>
        </div>

        <Clause
          n="1"
          title="What a design condition is"
          lede="The number this whole product is about."
        >
          <p className="max-w-2xl text-[14.5px] leading-relaxed">
            Cooling systems are not sized for the hottest hour ever recorded — that would be
            enormously wasteful. They are sized against a <strong>design condition</strong>: a
            temperature that is exceeded only rarely. ASHRAE, the body whose standards the US
            construction industry works to, defines the annual cooling design dry-bulb
            temperatures as the values exceeded <strong>0.4%</strong>, <strong>1%</strong> and{" "}
            <strong>2%</strong> of all hours in an average year.
          </p>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed">
            The 0.4% value is exceeded roughly <strong>35 hours a year</strong> — 0.4% of 8,760.
            That is the number an engineer looks up, and it comes from one reference weather
            station, computed over a historic 30-year window.
          </p>

          <div className="mt-6 rounded-[3px] border border-rule-strong bg-surface px-4 py-4">
            <div className="label mb-2">On ASHRAE</div>
            <p className="text-[13.5px] leading-relaxed text-ink-muted">
              ASHRAE publishes these values in licensed tables. <strong>None is used here.</strong>{" "}
              We apply the published <em>method</em> to public-domain NOAA observations and
              compute the value ourselves. On the 1991–2020 window that returns{" "}
              <span className="figure">43.90 °C</span> for Phoenix Sky Harbor — the figure the
              industry designs to — having read only NOAA data. That match is asserted in the test
              suite and fails loudly if it ever drifts. ASHRAE is cited throughout as the standard
              being referenced, never as a source of data.
            </p>
          </div>
        </Clause>

        <Clause
          n="2"
          title="The gap, in two components"
          lede="A published design condition can be wrong for a parcel for two independent reasons. They have different sources and different confidence, so they are computed and shown separately."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[3px] border border-rule bg-surface p-4">
              <div className="label" style={{ color: "var(--survey)" }}>
                Temporal
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed">
                The same 0.4% statistic, recomputed on a recent window, differs from the historic
                one. Both terms are NOAA observations at the same station, so{" "}
                <strong>no model is involved</strong> and this component carries no modelling
                uncertainty at all.
              </p>
              <p className="figure mt-3 text-[12.5px] text-ink-muted">
                recent − published-era window
              </p>
            </div>
            <div className="rounded-[3px] border border-rule bg-surface p-4">
              <div className="label" style={{ color: "var(--heat-2)" }}>
                Spatial
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed">
                The parcel is not the station. Both temperatures come from the{" "}
                <strong>same FortyGuard survey</strong>, over the same period at the same
                granularity, so the difference reflects location rather than method. Nothing else
                can supply this: it needs temperature at 100 m resolution across a whole metro.
              </p>
              <p className="figure mt-3 text-[12.5px] text-ink-muted">
                FortyGuard parcel − FortyGuard station
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-[3px] border border-rule bg-surface-sunk px-4 py-4">
            <div className="label mb-2">The arithmetic</div>
            <pre className="figure overflow-x-auto text-[12.5px] leading-relaxed">
{`combined      = temporal + spatial
parcel design = published standard + combined`}
            </pre>
          </div>
        </Clause>

        <Clause
          n="3"
          title="Why NOAA and FortyGuard are never differenced directly"
          lede="The most important decision in the project, and the easiest way to get this wrong."
        >
          <p className="max-w-2xl text-[14.5px] leading-relaxed">
            FortyGuard is a spatially interpolated model. Compared against the NOAA station
            observation at the <em>same coordinates over the same month</em>, it tracks the mean
            and the nightly minimum closely but systematically under-represents the extreme tail.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[13.5px]">
              <caption className="label pb-2 text-left">
                Phoenix Sky Harbor, July 2024, same coordinates
              </caption>
              <tbody>
                {(
                  [
                    ["Mean", "38.41", "37.89", "−0.52"],
                    ["Minimum", "27.80", "27.60", "−0.20"],
                    ["Maximum", "47.20", "42.73", "−4.47"],
                  ] as [string, string, string, string][]
                ).map(([k, noaa, fg, d], i) => (
                  <tr key={k} className={i === 2 ? "border-b-2 border-ink font-semibold" : "border-b border-rule"}>
                    <td className="py-2 text-ink-muted">{k}</td>
                    <td className="figure py-2 text-right">{noaa} °C</td>
                    <td className="figure py-2 text-right">{fg} °C</td>
                    <td className="figure py-2 text-right">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11.5px] text-ink-faint">
              Columns: NOAA observed · FortyGuard modelled · difference
            </p>
          </div>

          <p className="mt-5 max-w-2xl text-[14.5px] leading-relaxed">
            A naive product would show <em>“standard 45.0 °C, your parcel 42.7 °C, gap −2.3 °C”</em>{" "}
            — and that number would measure <strong>the model&rsquo;s smoothing, not the parcel</strong>.
          </p>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed">
            The fix is the standard anomaly-transfer approach from climate downscaling: take the{" "}
            <strong>absolute level</strong> from the instrument that measures it well — calibrated
            point observations — and take only the <strong>spatial offset</strong> from the
            instrument that resolves space. A model tail statistic is never subtracted from an
            observation tail statistic.
          </p>
        </Clause>

        <Clause
          n="4"
          title="Where the data comes from"
          lede="Two sources, both public, both cited on every figure they support."
        >
          <div className="space-y-4">
            <Source
              name="FortyGuard Temperature API®"
              use="The spatial offset between a parcel and its reference station"
              detail="Per-tile monthly maximum at 100 m granularity across a 30–40 km square, one request per metro. Commercial licence included with the hackathon plan."
              href="https://docs-api.fortyguard.com/docs"
            />
            <Source
              name="NOAA Integrated Surface Database (ISD-Lite)"
              use="Design conditions, degree days, threshold hours, and the temporal component"
              detail="Hourly dry-bulb observations at first-order airport stations. Public domain — a work of the US federal government, 17 U.S.C. § 105."
              href="https://www.ncei.noaa.gov/"
            />
            <Source
              name="US Census Bureau Geocoder"
              use="Turning a typed address into coordinates"
              detail="Public domain, no key required, United States only — which matches FortyGuard's coverage exactly."
              href="https://geocoding.geo.census.gov/"
            />
          </div>
        </Clause>

        <Clause
          n="5"
          title="What this cannot tell you"
          lede="Stated here rather than buried, because a limit you can see is worth more than a number you cannot check."
        >
          <ul className="space-y-4">
            <Limit title="It cannot tell you your parcel's hottest ever temperature.">
              The model under-represents extremes, which is why only the offset between two points
              is used. The survey compares your parcel to the station; it does not report an
              absolute record.
            </Limit>
            <Limit title="The offset is measured over one month.">
              July 2024. A parcel&rsquo;s offset may vary by season, and it is assumed to hold at
              the design condition — an assumption untested at the 0.4% tail. This is the largest
              single source of uncertainty in the headline figure.
            </Limit>
            <Limit title="Resolution is 100 m, not a property line.">
              A 100 m cell is larger than most urban parcels, so a small site shares its cell with
              its neighbours. Every survey shows how far the address sits from the cell centre.
            </Limit>
            <Limit title="Daytime peaks vary far less across space than nights do.">
              Across 30 km of Phoenix in July, daytime peaks spread 2.15 °C while nighttime minima
              spread 5.97 °C. Design conditions are daytime peaks, so they sit on the flattest of
              the three. This inverts in humid cities — a finding for one climate does not transfer
              to another.
            </Limit>
            <Limit title="The airport is not always the hot outlier.">
              In Phoenix, Sky Harbor is hotter than two-thirds of its metro, so the standard{" "}
              <em>over</em>-sizes for most parcels there. The direction of the error is a property
              of the city, and is reported per city rather than assumed.
            </Limit>
            <Limit title="There are no dollar figures anywhere.">
              An energy-cost estimate needs degree days × a cited tariff × a stated system
              efficiency. The last two are properties of a building we have not seen. We show the
              degree-day difference and stop, rather than publish a number with a guessed link in
              its chain.
            </Limit>
            <Limit title="This is not a substitute for engineering.">
              It is a screening tool for due diligence. Sizing a system requires a licensed
              engineer, a building model and a load calculation.
            </Limit>
          </ul>
        </Clause>

        <Clause
          n="6"
          id="coverage"
          title="Coverage"
          lede={`${cities.filter((c) => c.raster).length} metros surveyed so far. Adding another is one FortyGuard request.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-left">
                  <th className="label py-2 font-semibold">Metro</th>
                  <th className="label py-2 font-semibold">Reference station</th>
                  <th className="label py-2 text-right font-semibold">Survey</th>
                  <th className="label py-2 text-right font-semibold">Tiles</th>
                  <th className="label py-2 text-right font-semibold">Record</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c) => (
                  <tr key={c.city} className="border-b border-rule">
                    <td className="py-2.5 font-medium">{c.label}</td>
                    <td className="py-2.5 text-ink-muted">
                      {c.station.name.replace(/, [A-Z]{2}$/, "")}
                    </td>
                    <td className="figure py-2.5 text-right">{c.fortyguard.boxKm} km</td>
                    <td className="figure py-2.5 text-right">
                      {c.fortyguard.nTiles.toLocaleString("en-US")}
                    </td>
                    <td className="figure py-2.5 text-right text-ink-muted">
                      {c.noaa.historicWindow}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
            FortyGuard covers the United States only. An address outside a surveyed metro is
            reported as outside coverage rather than answered from the nearest available reading.
            Austin&rsquo;s NOAA record is missing 1991–1998, so its historic window is 1999–2020;
            that is surfaced wherever the figure appears.
          </p>
        </Clause>

        <div className="border-t border-rule py-8">
          <p className="text-[13.5px] text-ink-muted">
            Full write-ups live in the repository:{" "}
            <a
              className="text-survey underline underline-offset-2"
              href="https://github.com/Mohammad-Umar7/thermal-due-diligence/tree/main/docs"
            >
              METHODOLOGY, DATA_SOURCES, LIMITATIONS, API_NOTES and PRIOR_ART
            </a>
            .
          </p>
        </div>
      </main>

      <Footer />
    </>
  );
}

function Source({
  name,
  use,
  detail,
  href,
}: {
  name: string;
  use: string;
  detail: string;
  href: string;
}) {
  return (
    <div className="rounded-[3px] border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[16px] font-semibold">{name}</h3>
        <a className="text-[12px] text-survey underline underline-offset-2" href={href}>
          source →
        </a>
      </div>
      <p className="mt-1.5 text-[13.5px]">
        <span className="label">Used for</span>{" "}
        <span className="text-ink-muted">{use}</span>
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">{detail}</p>
    </div>
  );
}

function Limit({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="border-b border-rule pb-4 last:border-b-0">
      <h3 className="text-[14.5px] font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">{children}</p>
    </li>
  );
}
