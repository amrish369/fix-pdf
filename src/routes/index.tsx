import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Editor } from "@/components/editor/Editor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DocEdit AI — Edit text inside any PDF" },
      { name: "description", content: "Click any text in a PDF, edit it in place with its original style, and download. Runs locally in your browser." },
      { property: "og:title", content: "DocEdit AI — Edit text inside any PDF" },
      { property: "og:description", content: "Click-to-edit PDF text with style preservation. Private, on-device processing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ClientOnly fallback={<div className="h-dvh bg-muted" />}>
      <Editor />
    </ClientOnly>
  ),
});
