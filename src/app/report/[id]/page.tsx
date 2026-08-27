import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer, Masthead } from "@/components/Document";
import { ReportBody } from "@/components/ReportBody";
import { allParcels, buildReport, findParcel } from "@/lib/report";

export function generateStaticParams() {
  return allParcels().map(({ parcel }) => ({ id: parcel.id }));
}

/*
  Every showcase report is prerendered at build time from the seeded datasets,
  and an id outside that set is a 404 rather than a server render. Arbitrary
  addresses are handled by /lookup, which reads the temperature field in the
  browser - so no page in this app needs a server at request time.
*/
export const dynamicParams = false;

export default async function ReportPage({ params }: PageProps<"/report/[id]">) {
  const { id } = await params;
  const found = findParcel(id);
  if (!found) notFound();

  const report = buildReport(found.city, found.parcel);

  return (
    <>
      <Masthead>
        <Link className="text-survey underline underline-offset-2" href="/method/">
          How this works
        </Link>
        <Link className="text-survey underline underline-offset-2 no-print" href="/lookup/">
          Look up an address
        </Link>
      </Masthead>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        <ReportBody report={report} />
        <div className="no-print border-t border-rule py-8">
          <Link className="text-[14px] text-survey underline underline-offset-2" href="/method/">
            Full methodology, data sources and limitations →
          </Link>
        </div>
      </main>

      <Footer />
    </>
  );
}
