import type { NextConfig } from "next";

// Cabeceras de seguridad para todas las respuestas del frontend. La API
// (apps/api) pone las suyas con helmet; esto cubre el HTML/estáticos que
// sirve Next.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS: solo tiene efecto sobre HTTPS; en local (http) el navegador lo ignora.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Build minimalista para Docker: .next/standalone trae su propio server.js
  // con solo las dependencias que realmente usa.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
