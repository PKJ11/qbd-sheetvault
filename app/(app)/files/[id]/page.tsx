import { Suspense } from "react";
import { LoadingWorkbook, SheetEditor } from "@/components/sheet/SheetEditor";

export const metadata = { title: "Workbook" };

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingWorkbook />}>
      <SheetEditor id={Number(id)} />
    </Suspense>
  );
}
