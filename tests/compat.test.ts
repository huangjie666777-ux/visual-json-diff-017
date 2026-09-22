import { describe, expect, it } from "vitest";
import { compareJson, parseJson } from "../src/diff";

describe("starter compatibility", () => {
  it("parses JSON and exposes a root diff", () => {
    const root = compareJson(parseJson("{\"a\":1}"), parseJson("{\"a\":2}"));
    expect(root.status).toBe("changed");
    expect(root.children[0]?.key).toBe("a");
  });
});
