import type { SitecoreApiClientOptions } from "./types";
import { UserData } from "../types";
import { GraphQLRequestOptions, runGraphQL } from "./graphql";

const usersQuery = `
query($predicates:[Predicate]){
  users(predicates:$predicates)
  {
    userName,
    email,
    comment,
    created,
    isApproved,
    roles,
    properties{
      key
      value
      valueType
      isCustomProperty
    }
  }
}`;

const usersMutation = `
mutation($commands: [UserCommand]) {
  pushUsers(commands: $commands) {
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

export const fetchUsers = async (
  environment: SitecoreApiClientOptions,
  predicates: Array<{ domain: string; pattern: string }>,
  options?: GraphQLRequestOptions
): Promise<UserData[]> => {
  const data = await runGraphQL<{
    users: Array<{
      userName: string;
      email?: string;
      comment?: string;
      created: string;
      isApproved: boolean;
      roles: string[];
      properties: Array<{
        key: string;
        value: string;
        valueType: string;
        isCustomProperty: boolean;
      }>;
    }>;
  }>(environment, usersQuery, { predicates }, options);

  return (data.users ?? []).map((user) => ({
    userName: user.userName,
    email: user.email,
    comment: user.comment,
    creationDate: user.created,
    isApproved: user.isApproved,
    roles: user.roles ?? [],
    profileProperties: (user.properties ?? []).map((property) => ({
      name: property.key,
      content: property.value,
      contentType: property.valueType,
      isCustomProperty: property.isCustomProperty,
    })),
  }));
};

export const pushUserCommands = async (
  environment: SitecoreApiClientOptions,
  commands: unknown[],
  options?: GraphQLRequestOptions
): Promise<unknown[]> => {
  const data = await runGraphQL<{ pushUsers: unknown[] }>(
    environment,
    usersMutation,
    {
      commands,
    },
    options
  );
  return data.pushUsers;
};
