import { redirect } from "next/navigation";

export default async function ChainRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams({ tab: "chain" });
  for (const [key, value] of Object.entries(params)) {
    if (key !== "tab") sp.set(key, value);
  }
  redirect(`/create?${sp.toString()}`);
}
