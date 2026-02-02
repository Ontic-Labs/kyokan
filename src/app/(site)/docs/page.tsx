import SwaggerUIWrapper from "@/components/swagger-ui-wrapper";

export const metadata = {
  title: "API Documentation | Kyokan",
};

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">
        API Documentation
      </h1>
      <p className="text-sm text-text-secondary">
        Interactive REST API documentation. Use the &ldquo;Try it out&rdquo;
        button on any endpoint to make live requests.
      </p>
      <SwaggerUIWrapper />
    </div>
  );
}
