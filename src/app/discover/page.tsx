import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DiscoverRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") qs.set(k, v);
  }
  const query = qs.toString();
  redirect(query ? `/?${query}` : "/");
}
