import { describe, expect, it } from "vitest";

import { getPath, interpolate, setPath } from "@/lib/path";

describe("lib/path · getPath", () => {
  const root = {
    payload: {
      order: { id: "ord_1", total: 42.5, tags: ["new", "vip"], items: [{ sku: "A" }, { sku: "B" }] },
      event: "order.created",
    },
    vars: { t1: { orderId: "ord_1", ok: true } },
  };

  it("resolves dotted paths from the root", () => {
    expect(getPath(root, "$.payload.order.total")).toEqual({ found: true, value: 42.5 });
    expect(getPath(root, "payload.event")).toEqual({ found: true, value: "order.created" });
    expect(getPath(root, "vars.t1.orderId")).toEqual({ found: true, value: "ord_1" });
  });

  it("resolves array indices", () => {
    expect(getPath(root, "payload.order.tags[0]")).toEqual({ found: true, value: "new" });
    expect(getPath(root, "payload.order.items[1].sku")).toEqual({ found: true, value: "B" });
  });

  it("returns not-found for missing paths without throwing", () => {
    expect(getPath(root, "payload.order.nope")).toEqual({ found: false, value: undefined });
    expect(getPath(root, "vars.t1.unknown.deep")).toEqual({ found: false, value: undefined });
    expect(getPath(root, "payload.order.items[9].sku")).toEqual({ found: false, value: undefined });
  });

  it("returns not-found when traversing a scalar", () => {
    expect(getPath(root, "payload.order.total.more")).toEqual({ found: false, value: undefined });
  });

  it("rejects malformed paths", () => {
    expect(() => getPath(root, "$")).not.toThrow();
    expect(() => getPath(root, "")).toThrow();
  });

  it("supports a literal root access", () => {
    expect(getPath(root, "$").found).toBe(true);
    expect(getPath(root, "$").value).toEqual(root);
  });
});

describe("lib/path · setPath", () => {
  it("sets a dotted path producing a new object", () => {
    const out = setPath({}, "orderId", "ord_1");
    expect(out).toEqual({ orderId: "ord_1" });
    const nested = setPath({}, "payload.order.id", "x");
    expect(nested).toEqual({ payload: { order: { id: "x" } } });
  });

  it("does not mutate the input", () => {
    const input = { a: 1 };
    const out = setPath(input, "a", 2);
    expect(input).toEqual({ a: 1 });
    expect(out).toEqual({ a: 2 });
  });

  it("writes array indices", () => {
    const out = setPath({ items: [] }, "items[0].sku", "A");
    expect((out as any).items[0].sku).toBe("A");
  });
});

describe("lib/path · interpolate", () => {
  const root = { payload: { user: { email: "a@b.com" }, amount: 12.5 }, vars: { t: { id: "t-1" } } };

  it("replaces {{ path }} placeholders", () => {
    expect(interpolate("user is {{ payload.user.email }}", root)).toBe("user is a@b.com");
    expect(interpolate("id={{vars.t.id}}", root)).toBe("id=t-1");
    expect(interpolate("amt={{ payload.amount }}", root)).toBe("amt=12.5");
  });

  it("empties placeholders that do not resolve", () => {
    expect(interpolate("missing [{{ payload.nope }}]", root)).toBe("missing []");
  });
});