import { deleteEnvironment } from "@/deploy/api";
import { getDeployContext } from "@/deploy/tasks/shared";

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("usage: tmp-delete-envs.ts <id> [<id> ...]");
  process.exit(2);
}

const main = async () => {
  const ctx = await getDeployContext({ environmentName: "test" });
  for (const id of ids) {
    try {
      await deleteEnvironment({ accessToken: ctx.token, baseUrl: ctx.baseUrl }, id, true);
      process.stdout.write(`${id}\tOK\n`);
    } catch (err: any) {
      process.stdout.write(`${id}\tERR\t${err?.message ?? String(err)}\n`);
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
