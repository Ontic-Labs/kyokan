import SwaggerUIWrapper from "@/components/swagger-ui-wrapper";
import GetApiKeyButton from "@/components/get-api-key-button";
import DownloadSpecPdfButton from "@/components/download-spec-pdf-button";
import { UI_STRINGS } from "@/constants/ui-strings";

export const metadata = {
  title: "API Documentation",
  description:
    "Interactive API documentation for Kyokon. Explore endpoints, try requests, and learn how to integrate USDA food data into your applications.",
  openGraph: {
    title: "API Documentation | Kyokon",
    description:
      "Interactive API documentation for the Kyokon food and nutrition API.",
    url: "/docs",
  },
  twitter: {
    card: "summary",
    title: "API Documentation | Kyokon",
    description:
      "Interactive API docs for Kyokon.",
  },
  alternates: {
    canonical: "/docs",
  },
};

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          {UI_STRINGS.docs.title}
        </h1>
        <p className="text-sm text-text-secondary mt-2">
          {UI_STRINGS.docs.description}
        </p>
      </div>

      {/* API Key CTA */}
      <div className="p-4 rounded-lg bg-surface-card border border-border-default">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Get Your API Key</h2>
              <p className="text-sm text-text-secondary mt-1">
                Enter your email to claim a free API key. Use it via query param (<code className="text-link-default">?api_key=...</code>),
                header (<code className="text-link-default">X-API-Key</code>), or Bearer token.
              </p>
            </div>
            <GetApiKeyButton />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 border-t border-border-default">
            <div>
              <h3 className="text-base font-semibold text-text-primary">Download the API spec</h3>
              <p className="text-sm text-text-secondary mt-1">
                Downloads a printable PDF of the full OpenAPI spec.
              </p>
            </div>
            <DownloadSpecPdfButton />
          </div>
        </div>
      </div>

      {/* Break out of max-width container for full-width Redoc display */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <SwaggerUIWrapper />
      </div>
    </div>
  );
}
