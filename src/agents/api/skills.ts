/**
 * Skills — reusable markdown guidance an agent attaches (`/api/skills`).
 *
 * `POST /api/skills` returns the created skill directly (not wrapped in an
 * array, unlike `/api/agents`). Update/delete endpoints have not been
 * captured — add them here once observed.
 */
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { Skill } from "./schema";

/** List every skill visible to the session. */
export const listSkills = async (session: AgentsSession): Promise<Skill[]> => {
  const data = await agentsRequest<unknown>(session, "/api/skills");
  return Array.isArray(data) ? (data as Skill[]) : [];
};

/** Find one skill by `id` or `slug`. */
export const getSkill = async (
  session: AgentsSession,
  idOrSlug: string
): Promise<Skill | undefined> => {
  const skills = await listSkills(session);
  return skills.find((skill) => skill.id === idOrSlug || skill.slug === idOrSlug);
};

export interface CreateSkillInput {
  name: string;
  description: string;
  /** The skill's markdown guidance. */
  content: string;
  tags?: string[];
  /** "team" (default) | "private". */
  visibility?: string;
}

/** Create a skill (`POST /api/skills`). */
export const createSkill = async (
  session: AgentsSession,
  input: CreateSkillInput
): Promise<Skill> =>
  agentsRequest<Skill>(session, "/api/skills", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description,
      content: input.content,
      tags: input.tags ?? [],
      visibility: input.visibility ?? "team",
    },
  });
