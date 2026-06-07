import { notFound } from "next/navigation";
import { getDigestById } from "@/lib/digest-data";
import DigestView from "@/components/DigestView";

export const dynamic = "force-dynamic";

export default async function DigestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const digest = await getDigestById(id);
  if (!digest) notFound();
  return <DigestView digest={digest} />;
}
