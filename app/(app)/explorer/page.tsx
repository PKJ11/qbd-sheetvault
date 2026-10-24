import { Suspense } from "react";
import { Explorer } from "@/components/explorer/Explorer";

export const metadata = { title: "File Explorer" };

export default function ExplorerPage() {
  return (
    <Suspense>
      <Explorer />
    </Suspense>
  );
}
