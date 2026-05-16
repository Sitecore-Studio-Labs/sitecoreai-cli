import { describe, expect, it } from "vitest";
import { parseRunEvents } from "../../../../src/agents/api/runs";
import type { RunEvent } from "../../../../src/agents/api/schema";

async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

const collect = async (events: AsyncIterable<RunEvent>): Promise<RunEvent[]> => {
  const out: RunEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

describe("parseRunEvents", () => {
  it("parses `data:` frames into typed events", async () => {
    const events = await collect(
      parseRunEvents(
        chunks('data: {"type":"start"}\n\n', 'data: {"type":"text-delta","delta":"hi"}\n\n')
      )
    );
    expect(events).toEqual([{ type: "start" }, { type: "text-delta", delta: "hi" }]);
  });

  it("reassembles a frame split across chunks", async () => {
    const events = await collect(
      parseRunEvents(chunks('data: {"type":"te', 'xt-delta","delta":"x"}\n\n'))
    );
    expect(events).toEqual([{ type: "text-delta", delta: "x" }]);
  });

  it("skips the [DONE] sentinel and non-data lines", async () => {
    const events = await collect(parseRunEvents(chunks("data: [DONE]\n\n", ": comment\n\n")));
    expect(events).toEqual([]);
  });

  it("ignores an unparseable frame instead of throwing", async () => {
    const events = await collect(
      parseRunEvents(chunks("data: {bad json}\n\n", 'data: {"type":"ok"}\n\n'))
    );
    expect(events).toEqual([{ type: "ok" }]);
  });

  it("handles CRLF frame separators", async () => {
    const events = await collect(parseRunEvents(chunks('data: {"type":"start"}\r\n\r\n')));
    expect(events).toEqual([{ type: "start" }]);
  });
});
