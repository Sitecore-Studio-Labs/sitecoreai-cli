/**
 * Probe the Brief API's Timeline field `events` array shape.
 *
 * Plan:
 *  1. Read a brief's existing Timeline field value.
 *  2. PUT the brief with one event of each guessed shape candidate.
 *  3. GET back, compare what survived vs what was silently dropped.
 *  4. Best-effort revert to the original Timeline value.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/probe-timeline-events.ts <briefId> <timelineFieldName>
 */
import { getBrief, resolveBriefClient, updateBrief } from "@/brief";

interface EventCandidate {
  label: string;
  event: Record<string, unknown>;
}

const CANDIDATES: EventCandidate[] = [
  {
    label: "verified (title+dueDate) — kitchen-sink extras",
    event: {
      title: "Concept Review",
      dueDate: "2026-06-15",
      status: "completed",
      eventStatus: "completed",
      description: "first concept review",
      completedAt: "2026-06-14",
      completedOn: "2026-06-14",
      isCompleted: true,
    },
  },
  {
    label: "casing variants (Title/DueDate)",
    event: {
      Title: "Draft Delivered",
      DueDate: "2026-06-20",
      Description: "draft",
      Status: "Completed",
    },
  },
  {
    label: "no dueDate (just title)",
    event: { title: "Stakeholder Feedback" },
  },
];

async function main(): Promise<void> {
  const [briefId, fieldName] = process.argv.slice(2);
  if (!briefId || !fieldName) {
    console.error("Usage: probe-timeline-events.ts <briefId> <timelineFieldName>");
    process.exit(2);
  }

  const { client } = await resolveBriefClient({});
  const before = await getBrief(client, briefId);
  const fields = (before.fields ?? {}) as Record<string, unknown>;
  const original = fields[fieldName] as
    { type?: string; value?: Record<string, unknown> } | undefined;
  if (!original || original.type !== "Timeline") {
    console.error(
      `Field "${fieldName}" on brief ${briefId} is not a Timeline (got ${original?.type}).`
    );
    process.exit(2);
  }
  const originalValue = (original.value ?? {}) as Record<string, unknown>;
  console.log(`Original ${fieldName} value:`, JSON.stringify(originalValue, null, 2));

  // PUT with all candidate events on the Timeline.
  const writeValue = {
    ...originalValue,
    events: CANDIDATES.map((c) => c.event),
  };
  console.log(
    `\nPUTting ${CANDIDATES.length} candidate events:\n`,
    JSON.stringify(writeValue, null, 2)
  );
  try {
    await updateBrief(client, briefId, {
      fields: { [fieldName]: { type: "Timeline", value: writeValue } },
    });
    console.log(`PUT returned 2xx.`);
  } catch (err) {
    console.error(`PUT failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Re-read and compare.
  const after = await getBrief(client, briefId);
  const afterField = (after.fields ?? {})[fieldName] as
    { type?: string; value?: { events?: unknown[]; [k: string]: unknown } } | undefined;
  const afterValue = afterField?.value ?? {};
  console.log(`\nAfter PUT — server-stored value:`, JSON.stringify(afterValue, null, 2));

  const afterEvents = Array.isArray(afterValue.events) ? afterValue.events : [];
  console.log(`\nEvent comparison (${afterEvents.length} returned):`);
  for (let i = 0; i < CANDIDATES.length; i++) {
    const sent = CANDIDATES[i];
    const got = afterEvents[i] ?? null;
    console.log(
      `\n[${sent.label}]\n  sent: ${JSON.stringify(sent.event)}\n  got:  ${JSON.stringify(got)}`
    );
  }

  // Revert.
  try {
    await updateBrief(client, briefId, {
      fields: {
        [fieldName]: { type: "Timeline", value: originalValue },
      },
    });
    console.log(`\nReverted ${fieldName} to original.`);
  } catch (err) {
    console.warn(
      `Revert failed (probe may persist): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
