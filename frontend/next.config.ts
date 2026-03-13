import type { NextConfig } from "next";

// In development: proxy /v1/* to FastAPI at localhost:8000
// In production:  static export — FastAPI serves the built files directly
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = isDev
  ? {
      async rewrites() {
        return [
          {
            source: "/v1/:path*",
            destination: "http://localhost:8000/v1/:path*",
          },
          {
            source: "/health",
            destination: "http://localhost:8000/health",
          },
        ];
      },
    }
  : {
      output: "export",
      trailingSlash: true,
    };

export default nextConfig;
