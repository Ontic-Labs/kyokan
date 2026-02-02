import SwaggerUIWrapper from "@/components/swagger-ui-wrapper";
import { UI_STRINGS } from "@/constants/ui-strings";

export const metadata = {
  title: UI_STRINGS.docs.metadataTitle,
};

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">
        {UI_STRINGS.docs.title}
      </h1>
      <p className="text-sm text-text-secondary">
        {UI_STRINGS.docs.description}
      </p>
      <SwaggerUIWrapper />
    </div>
  );
}
