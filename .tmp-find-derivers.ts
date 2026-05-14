import { resolveTenant } from "@/hygiene/tasks/shared";

const STRAGGLERS = [
  { name: "Datasources", id: "c189112cba854ce585a6a3d260cd68a1" },
  { name: "Datasources/Card", id: "48574c2c46754abab5f5adb5a138f379" },
  { name: "Datasources/Button", id: "f9e2d5018d504a2b9751f1cbd0359b77" },
  { name: "Datasources/Text", id: "ee63ffc14ce54d07aa803ab3bbbecb89" },
  { name: "Datasources/Button Folder", id: "d86791d80991410fbcd90ef2c01ebc51" },
  { name: "Article Card", id: "1b8d93301fa74ec490dff6f90048bedc" },
  { name: "Articles", id: "ce3fc41a2bdd4baea3e92570ece358b7" },
  { name: "Badge", id: "cd7d3774e1ab42a9b5325e5e0012ed10" },
  { name: "Offers", id: "5dff70c63c1b4b309b63613aa27b89d8" },
  { name: "Image (demo-registry)", id: "64e39adaf7504c1ab8fb5dc914c2c182" },
  { name: "Headless Tenant (demo-registry)", id: "59edf67abab341edba3501100c4c2946" },
  { name: "Offer Card", id: "e7e9162486174f1eb3a595d1983dae38" },
  { name: "Headless Tenant (example)", id: "1bca523dc99d463e89149aa688e01b5e" },
  { name: "Page Folder (example)", id: "5021d6921afe4d98b037a5a1f9bec808" },
  { name: "Presentation", id: "29b28db28cca45aa893d4f549f0c5d32" },
  { name: "Presentation/Enumeration", id: "e595f954eef846a2913450f2feacd887" },
  { name: "Presentation/Enumerations Folder", id: "605367c6680a4c779c44f26479e23fd5" },
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const main = async () => {
  const { client } = resolveTenant({ environmentName: "test" });
  for (const s of STRAGGLERS) {
    try {
      const byTemplate = await client.search({
        paging: { pageSize: 50 },
        latestVersionOnly: true,
        searchStatement: {
          criteria: { field: "_template", value: s.id, criteriaType: "EXACT" },
        },
      });
      console.log(`${s.name}: ${byTemplate.totalCount} item(s) directly templated`);
      for (const r of byTemplate.results.slice(0, 10)) console.log(`  ${r.path}`);
    } catch (err: any) {
      console.log(`${s.name}: ERR ${String(err?.message ?? err).slice(0, 80)}`);
    }
    await sleep(500);
  }
};

main().catch((err) => console.error(err?.stack ?? err));
