import { FileReport } from "@/components/FileReport";

export const metadata = { title: "Workbook report" };

export default async function FileReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FileReport id={Number(id)} />;
}
