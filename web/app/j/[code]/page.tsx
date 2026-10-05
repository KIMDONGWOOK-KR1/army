import AppShell from "@/components/app-shell";
export default async function Join({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <AppShell joinCode={code.toUpperCase().slice(0, 4)} />;
}
