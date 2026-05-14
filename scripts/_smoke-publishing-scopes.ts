/**
 * Probes whether the scai default Auth0 client is authorized to grant
 * publishing scopes. Calls the device-authorization endpoint directly
 * with `scope=xmcpub.*` — Auth0 returns either:
 *
 *   - a device_code (the client IS authorized for these scopes; running
 *     `scai publish login` interactively will let the user consent)
 *   - `invalid_scope` / `unauthorized_client` (the client is NOT
 *     authorized; we need a different client_id or a different flow)
 *
 * No browser consent needed — this just checks Auth0's pre-consent
 * authorization. Non-interactive, safe to run unattended.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-publishing-scopes.ts [envName] [clientId]
 */
import { resolveEnvironment } from "@/shared/env";
import { requestDeviceAuthorization } from "@/serialization/sitecore-api/auth";
import { DEFAULT_PUBLIC_CLIENT_ID } from "@/serialization/tasks/env/constants";
import { ScaiError } from "@/shared/errors";

const PUBLISHING_SCOPES =
  "openid profile email offline_access xmcpub.jobs.a:r xmcpub.jobs.a:w xmcpub.queue:r";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const clientId = process.argv[3] ?? DEFAULT_PUBLIC_CLIENT_ID;
  process.stderr.write(`> env: ${envName}\n`);
  process.stderr.write(`> client_id: ${clientId}\n`);

  const { environment } = resolveEnvironment({ environmentName: envName });
  const authority =
    environment.authority ??
    process.env.SITECOREAI_AUTHORITY ??
    "https://auth.sitecorecloud.io";
  const audience = environment.audience ?? "https://api.sitecorecloud.io";

  process.stderr.write(`> authority: ${authority}\n`);
  process.stderr.write(`> audience: ${audience}\n`);
  process.stderr.write(`> scope: ${PUBLISHING_SCOPES}\n`);
  process.stderr.write(`> POST device-authorization\n`);

  try {
    const device = await requestDeviceAuthorization(
      { authority, clientId, audience },
      PUBLISHING_SCOPES
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          summary:
            "Auth0 accepted the publishing scope request — client is authorized for xmcpub.*",
          verificationUriComplete: device.verificationUriComplete,
          userCode: device.userCode,
          expiresIn: device.expiresIn,
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    if (error instanceof ScaiError) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: false,
            summary:
              "Auth0 rejected the publishing scope request — see error message for the specific reason",
            code: error.code,
            message: error.message,
            hint: error.hint,
          },
          null,
          2
        )}\n`
      );
      process.exit(error.exitCode);
    }
    throw error;
  }
};

main().catch((err) => {
  process.stderr.write(`unhandled: ${String(err)}\n`);
  process.exit(99);
});
