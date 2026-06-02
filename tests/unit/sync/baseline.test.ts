import { describe, expect, it } from "vitest";
import { classifyHashes, hashJsonValue, stableStringify } from "../../../src/sync/baseline";

describe("stableStringify", () => {
  // Primitive identity — JSON.stringify behaviour, codified so an
  // accidental switch to a different stringifier surfaces here.
  it("encodes primitives identically to JSON.stringify", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(false)).toBe("false");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify(-3.14)).toBe("-3.14");
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify("")).toBe('""');
  });

  // The whole point — same hash regardless of key order. Without this
  // canonicalisation the baseline would re-classify identical content
  // as "moved" whenever a tenant or serialiser re-orders fields.
  it("emits identical output for objects with reordered keys", () => {
    const a = { b: 2, a: 1, c: 3 };
    const b = { a: 1, b: 2, c: 3 };
    const c = { c: 3, b: 2, a: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(b)).toBe(stableStringify(c));
    expect(stableStringify(a)).toBe('{"a":1,"b":2,"c":3}');
  });

  // Recursion across nesting — both arrays and objects rely on a
  // structural walk, not just a top-level sort.
  it("recurses into nested objects sorting keys at every level", () => {
    const a = { z: { b: 2, a: 1 }, y: { d: 4, c: 3 } };
    const b = { y: { c: 3, d: 4 }, z: { a: 1, b: 2 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"y":{"c":3,"d":4},"z":{"a":1,"b":2}}');
  });

  // Array order IS meaningful — preserve it. Without this distinction
  // ["a","b"] and ["b","a"] would hash identically, masking real
  // differences in ordered fields like multi-select picker order.
  it("preserves array order (arrays are NOT sorted)", () => {
    expect(stableStringify([1, 2, 3])).toBe("[1,2,3]");
    expect(stableStringify(["a", "b", "c"])).toBe('["a","b","c"]');
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
  });

  // Arrays of objects recurse — same sort guarantee applies inside.
  it("recurses into arrays of objects", () => {
    const input = [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ];
    expect(stableStringify(input)).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  // `undefined` is special — JSON.stringify drops it from objects, but
  // at the top level returns `undefined` (not a string). Baseline
  // payloads should never see top-level undefined, but defensively
  // emit a deterministic string so a buggy caller's hash stays stable
  // across re-runs instead of throwing partway through serialisation.
  it("encodes top-level undefined as the literal string 'undefined'", () => {
    expect(stableStringify(undefined)).toBe("undefined");
  });

  // String key escaping — keys with quotes / backslashes need JSON
  // escaping to survive a round-trip. `JSON.stringify(key)` handles
  // this; verifying it's wired up.
  it("escapes string keys via JSON.stringify", () => {
    const input = { 'k"y': 1, "k\\y": 2 };
    expect(stableStringify(input)).toBe('{"k\\"y":1,"k\\\\y":2}');
  });

  // Empty object + empty array — degenerate cases that have bitten
  // canonical-JSON impls before (some emit `null` or `""` for empty
  // arrays). Hold the explicit empty form.
  it("emits empty object/array literals", () => {
    expect(stableStringify({})).toBe("{}");
    expect(stableStringify([])).toBe("[]");
  });

  // Mixed-depth: object with array of objects with array of primitives.
  // The sort must apply at every object level, the order must preserve
  // at every array level.
  it("handles deeply mixed nesting", () => {
    const input = {
      outer: [
        { z: [3, 1, 2], a: 1 },
        { y: "x", b: 2 },
      ],
    };
    expect(stableStringify(input)).toBe('{"outer":[{"a":1,"z":[3,1,2]},{"b":2,"y":"x"}]}');
  });
});

describe("hashJsonValue", () => {
  // Hash format — sha256 → 64 hex chars. Anything else means a
  // mis-wired digest (`base64`, `hex` slice, etc.).
  it("returns a 64-char hex SHA-256 digest", () => {
    const hash = hashJsonValue({ any: "value" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // The whole point — identical inputs hash identically. Verifying
  // the canonicalisation flows through to the hash.
  it("hashes identically across key-reordered objects", () => {
    const a = hashJsonValue({ a: 1, b: 2, c: 3 });
    const b = hashJsonValue({ c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
  });

  // Different inputs hash differently — confirms it's actually
  // hashing the stringified form, not returning a constant.
  it("yields different hashes for distinct values", () => {
    expect(hashJsonValue({ a: 1 })).not.toBe(hashJsonValue({ a: 2 }));
    expect(hashJsonValue([1, 2])).not.toBe(hashJsonValue([2, 1]));
    expect(hashJsonValue("hello")).not.toBe(hashJsonValue("world"));
  });

  // Primitive inputs hash deterministically too — used for hashing
  // scalar field values without per-kind wrapping.
  it("hashes primitives deterministically across calls", () => {
    expect(hashJsonValue(42)).toBe(hashJsonValue(42));
    expect(hashJsonValue("x")).toBe(hashJsonValue("x"));
    expect(hashJsonValue(null)).toBe(hashJsonValue(null));
    expect(hashJsonValue(true)).toBe(hashJsonValue(true));
  });

  // Known-good sanity vector: precomputed sha256 of `stableStringify("")`
  // = sha256 of `""` (two double-quote bytes, JSON.stringify of an empty
  // string). Locks the algorithm so a future switch to a non-equivalent
  // canonicaliser surfaces here.
  it("matches a known-good vector for the canonical empty string", () => {
    // sha256(`""`) ≡ 12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126
    // (precomputed via `node -e "console.log(createHash('sha256').update('\"\"','utf8').digest('hex'))"`;
    // if this assertion ever fails, the canonical encoder changed
    // shape — re-derive deliberately, don't paper over it.)
    expect(hashJsonValue("")).toBe(
      "12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126"
    );
  });
});

describe("classifyHashes", () => {
  // No baseline at all → first-push. The kind treats this as a fresh
  // write; no three-way classification possible without baseline.
  it("returns first-push when baseline is undefined", () => {
    expect(classifyHashes("a", "a", undefined)).toBe("first-push");
    expect(classifyHashes("a", "b", undefined)).toBe("first-push");
    expect(classifyHashes("x", "y", undefined)).toBe("first-push");
  });

  // Degenerate match — everything equal → recipe-change (noop in
  // practice). Documented this way in the source so consumers see a
  // uniform classification even when nothing's moved.
  it("returns recipe-change when all three hashes agree (degenerate noop)", () => {
    expect(classifyHashes("a", "a", "a")).toBe("recipe-change");
  });

  // Recipe diverged, tenant unchanged → safe update.
  it("returns recipe-change when only the recipe moved", () => {
    expect(classifyHashes("new", "old", "old")).toBe("recipe-change");
  });

  // Tenant diverged, recipe matches baseline → cms-edit (author
  // touched it). Push policy decides whether to clobber or skip.
  it("returns cms-edit when only the tenant moved", () => {
    expect(classifyHashes("old", "new", "old")).toBe("cms-edit");
  });

  // Both sides moved off baseline → conflict. The dangerous shape;
  // operator must see it.
  it("returns conflict when both sides moved off baseline", () => {
    expect(classifyHashes("recipe-new", "tenant-new", "old")).toBe("conflict");
  });

  // Specifically: both sides moved to the SAME value (converged
  // independently). Still classified as conflict because the planner
  // can't prove convergence intent without baseline-side history.
  it("returns conflict when recipe and tenant both moved to the same value off baseline", () => {
    expect(classifyHashes("converged", "converged", "old")).toBe("conflict");
  });

  // Empty-string hashes are valid (sha256("") is real); shouldn't be
  // mistaken for undefined. Defends against the classic `falsy`
  // confusion ("" vs undefined).
  it("treats empty-string baseline as PRESENT, not absent", () => {
    expect(classifyHashes("", "", "")).toBe("recipe-change");
    expect(classifyHashes("a", "", "")).toBe("recipe-change");
    expect(classifyHashes("", "a", "")).toBe("cms-edit");
    expect(classifyHashes("a", "b", "")).toBe("conflict");
  });
});
