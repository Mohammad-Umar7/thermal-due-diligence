import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    Every page is prerendered from the seeded datasets, so the whole app is
    static HTML. Exporting it that way removes the server from the request path
    entirely: nothing to cold-start, nothing to time out, and no upstream API
    call while a judge is watching.

    Reports cover the seeded showcase parcels. Arbitrary-address lookup would
    need either the full tile field in the browser or a server route, and is
    not built yet.
  */
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
