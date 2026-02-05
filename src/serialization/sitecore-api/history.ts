import { EnvironmentConfiguration } from "@/config";
import { HistoryEntry } from "../types";
import { GraphQLRequestOptions, runGraphQL } from "./graphql";

const historyTimestampQuery = `
{
  history {
    currentTimestamp
  }
}`;

const historyEntriesQuery = `
query Entries($timestamp: String!) {
  history {
    currentTimestamp
    entries(timestamp: $timestamp) {
      id
      path
      database
      oldPath
      changeType
    }
  }
}`;

export const fetchHistoryTimestamp = async (
  environment: EnvironmentConfiguration,
  options?: GraphQLRequestOptions
): Promise<string> => {
  const data = await runGraphQL<{ history: { currentTimestamp: string } }>(
    environment,
    historyTimestampQuery,
    undefined,
    options
  );
  return data.history.currentTimestamp;
};

export const fetchHistoryEntries = async (
  environment: EnvironmentConfiguration,
  timestamp: string,
  options?: GraphQLRequestOptions
): Promise<{ timestamp: string; entries: HistoryEntry[] }> => {
  const data = await runGraphQL<{ history: { currentTimestamp: string; entries: HistoryEntry[] } }>(
    environment,
    historyEntriesQuery,
    { timestamp },
    options
  );

  return {
    timestamp: data.history.currentTimestamp,
    entries: data.history.entries ?? [],
  };
};
