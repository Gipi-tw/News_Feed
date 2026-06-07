import { getInterestProfile, getStyleGuide } from "@/lib/config";
import { prisma } from "@/lib/db";
import { readConfigFile } from "@/lib/config";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, guide] = await Promise.all([getInterestProfile(), getStyleGuide()]);
  // Load raw digest_config JSON (string) so the user edits the literal file.
  const row = await prisma.setting.findUnique({ where: { key: "digest_config" } });
  const config = row?.value ?? readConfigFile("digest_config.json");

  return (
    <div className="wrap">
      <header className="masthead">
        <h1>設定</h1>
        <div className="meta">興趣輪廓 ・ 口吻指南 ・ 配比/排除/排程</div>
      </header>
      <SettingsForm interestProfile={profile} styleGuide={guide} digestConfig={config} />
    </div>
  );
}
