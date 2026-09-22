export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface DiffNode {
  path: string;
  key: string;
  status: DiffStatus;
  left?: JsonValue;
  right?: JsonValue;
  children: DiffNode[];
}
