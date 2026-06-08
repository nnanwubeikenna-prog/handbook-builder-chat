import { createFileRoute } from "@tanstack/react-router";
import { HandbookGenerator } from "@/components/handbook-generator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Handbook Generator" },
      { name: "description", content: "Upload PDFs and generate handbooks with AI." },
      { property: "og:title", content: "Handbook Generator" },
      { property: "og:description", content: "Upload PDFs and generate handbooks with AI." },
    ],
  }),
  component: Index,
});

function Index() {
  return <HandbookGenerator />;
}
