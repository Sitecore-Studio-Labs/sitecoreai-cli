/**
 * Probes whether scai's default device-code client `Chi8...` is
 * authorized to grant the tenant-tier publishing scopes
 * (`xmcpub.jobs.t:r/w`, `xmcpub.queue:r`). Calls Auth0's
 * device-authorization endpoint without going through the browser
 * consent step — Auth0 returns `invalid_scope` if the client isn't
 * authorized for those scopes, or a `device_code` if it is.
 *
 * If this returns ok=true, user-flow publishing is viable and we
 * can restore `scai publish login` (or fold publishing scopes into
 * `scai login --include-publishing`). If it returns invalid_scope,
 * user-flow is limited to deploy scopes and M2M with env-level
 * client creds is the only publishing path.
 *
 * Usage: pnpm exec tsx -r tsconfig-paths/register scripts/_smoke-device-t-scopes.ts [envName]
 */
import { resolveEnvironment } from "@/shared/env";
import { requestDeviceAuthorization } from "@/serialization/sitecore-api/auth";
import { DEFAULT_PUBLIC_CLIENT_ID } from "@/serialization/tasks/env/constants";
import { ScaiError } from "@/shared/errors";

// Tenant-tier scopes — what automation clients carry per the architect.
const TENANT_SCOPES =
  "openid profile email offline_access xmcpub.jobs.t:r xmcpub.jobs.t:w xmcpub.queue:r";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const { environment } = resolveEnvironment({ environmentName: envName });
  const authority =
    environment.authority ?? process.env.SITECOREAI_AUTHORITY ?? "https://auth.sitecorecloud.io";
  const audience = environment.audience ?? "https://api.sitecorecloud.io";
  const clientId = process.env.SITECOREAI_CLIENT_ID ?? DEFAULT_PUBLIC_CLIENT_ID;

  process.stderr.write(`> env:       ${envName}\n`);
  process.stderr.write(`> client_id: ${clientId} (scai device-code default)\n`);
  process.stderr.write(`> authority: ${authority}\n`);
  process.stderr.write(`> audience:  ${audience}\n`);
  process.stderr.write(`> scope:     ${TENANT_SCOPES}\n`);
  process.stderr.write(`> POST device-authorization (no consent step)\n`);

  try {
    const device = await requestDeviceAuthorization(
      { authority, clientId, audience },
      TENANT_SCOPES
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          summary:
            "Auth0 accepted .t scopes on the device-code client. User-flow publishing is viable — open the verifyUri in a browser and consent to confirm the issued token actually carries them.",
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
              "Auth0 rejected the .t scope request on the device-code client. User-flow publishing requires either a different client_id, a Sitecore-side Auth0 config change, or M2M with env-level creds.",
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
