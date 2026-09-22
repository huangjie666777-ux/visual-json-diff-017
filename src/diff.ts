import type { DiffNode, JsonValue } from "./types";

export function parseJson(text: string): JsonValue {
  const value: unknown = JSON.parse(text);
  if (value === undefined) throw new Error("JSON值不能为空");
  return value as JsonValue;
}

export function compareJson(left: JsonValue, right: JsonValue, path = ""): DiffNode {
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  const same = JSON.stringify(left) === JSON.stringify(right);
  const children: DiffNode[] = [];
  if (leftObject || rightObject) {
    const leftKeys = Array.isArray(left) ? left.map((_, index) => String(index)) : Object.keys(left as Record<string, JsonValue>);
    const rightKeys = Array.isArray(right) ? right.map((_, index) => String(index)) : Object.keys(right as Record<string, JsonValue>);
    const keys = [...new Set([...leftKeys, ...rightKeys])].sort((a, b) => a.localeCompare(b, "en"));
    for (const key of keys) {
      const hasLeft = leftObject && (Array.isArray(left) ? Number(key) < left.length : Object.prototype.hasOwnProperty.call(left, key));
      const hasRight = rightObject && (Array.isArray(right) ? Number(key) < right.length : Object.prototype.hasOwnProperty.call(right, key));
      const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      const childLeft = hasLeft ? (left as JsonValue[] | Record<string, JsonValue>)[key as never] : undefined;
      const childRight = hasRight ? (right as JsonValue[] | Record<string, JsonValue>)[key as never] : undefined;
      children.push({
        path: childPath,
        key,
        status: !hasLeft ? "added" : !hasRight ? "removed" : JSON.stringify(childLeft) === JSON.stringify(childRight) ? "unchanged" : "changed",
        left: childLeft,
        right: childRight,
        children: hasLeft && hasRight ? compareJson(childLeft!, childRight!, childPath).children : []
      });
    }
  }
  return { path, key: path ? path.split("/").pop() ?? "" : "root", status: same ? "unchanged" : "changed", left, right, children };
}
