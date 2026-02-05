export const withOrganizationHeaders = (
  organizationId?: string
): Record<string, string> | undefined =>
  organizationId
    ? {
        "x-organization-id": organizationId,
        "x-org-id": organizationId,
      }
    : undefined;
