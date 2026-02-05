import { EnvironmentConfiguration } from "@/config";
import { RoleData } from "../types";
import { GraphQLRequestOptions, runGraphQL } from "./graphql";

const rolesQuery = `
query($predicates:[PredicateGraphType]){
  roles(predicates:$predicates)
  {
    roleName,
    memberOfRoles,
    serializedItemId
  }
}`;

const roleMutation = `
mutation($commands: [RoleCommandGraphType]) {
  pushCommands(commands: $commands) {
    success,
    name,
    messages{
      logLevel,
      eventID{
        id,
        name
      },
      message
    }
  }
}`;

export const fetchRoles = async (
  environment: EnvironmentConfiguration,
  predicates: Array<{ domain: string; pattern: string }>,
  options?: GraphQLRequestOptions
): Promise<RoleData[]> => {
  const data = await runGraphQL<{ roles: RoleData[] }>(
    environment,
    rolesQuery,
    {
      predicates,
    },
    options
  );
  return data.roles ?? [];
};

export const pushRoleCommands = async (
  environment: EnvironmentConfiguration,
  commands: unknown[],
  options?: GraphQLRequestOptions
): Promise<unknown[]> => {
  const data = await runGraphQL<{ pushCommands: unknown[] }>(
    environment,
    roleMutation,
    {
      commands,
    },
    options
  );
  return data.pushCommands;
};
