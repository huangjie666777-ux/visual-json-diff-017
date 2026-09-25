// 文档与批注的核心数据模型。
// 每个正文字符在创建时获得一个单调递增的字符 ID；批注以字符 ID 区间锚定。
// 正文被修改时，被删除字符的 ID 不会复用，因此批注可以随原位置移动，
// 也能区分"仍存在的片段"与"完全失联"，绝不会按文本搜索跳到另一处相同引用。

export type AnnStatus = "open" | "resolved";

export interface Annotation {
  id: string;
  /** 锚定的字符 ID 区间（半开区间，基于创建时正文中的字符 ID）。 */
  anchorStart: number;
  anchorEnd: number;
  /** 当前关联文字（随正文编辑后的快照，供侧栏展示）。 */
  quote: string;
  /** 创建批注时的原始引用，正文修改后仍然保留。 */
  originalQuote: string;
  category: string;
  comment: string;
  status: AnnStatus;
  /** 批注内部文字被插入、修改或删除后需要人工复核。 */
  needsReview: boolean;
  createdAt: number;
}

export interface DocState {
  text: string;
  /** 与 text 等长（按 UTF-16 码元），记录每个字符的身份。 */
  chars: number[];
  nextCharId: number;
  annotations: Annotation[];
  nextAnnId: number;
}

export interface History {
  past: DocState[];
  present: DocState;
  future: DocState[];
}

export function createDoc(text: string): DocState {
  const chars: number[] = [];
  for (let i = 0; i < text.length; i++) chars.push(i);
  return { text, chars, nextCharId: text.length, annotations: [], nextAnnId: 1 };
}

export function clone(s: DocState): DocState {
  return { ...s, chars: [...s.chars], annotations: s.annotations.map((a) => ({ ...a })) };
}

/** 返回批注锚点字符在当前正文中的位置片段列表（半开区间，按位置排序）。 */
export function pieces(s: DocState, ann: Annotation): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let pieceStart = -1;
  let pieceEnd = -1;
  let prevId = -1;
  for (let pos = 0; pos < s.chars.length; pos++) {
    const id = s.chars[pos];
    if (id >= ann.anchorStart && id < ann.anchorEnd) {
      if (pieceStart === -1 || id !== prevId + 1) {
        if (pieceStart !== -1) result.push([pieceStart, pieceEnd]);
        pieceStart = pos;
      }
      pieceEnd = pos + 1;
      prevId = id;
    } else {
      if (pieceStart !== -1) {
        result.push([pieceStart, pieceEnd]);
        pieceStart = -1;
      }
      prevId = -1;
    }
  }
  if (pieceStart !== -1) result.push([pieceStart, pieceEnd]);
  return result;
}

export function isLost(s: DocState, ann: Annotation): boolean {
  return pieces(s, ann).length === 0;
}

export function createAnnotation(
  s: DocState,
  start: number,
  end: number,
  category: string,
  comment: string,
  now: number = Date.now()
): DocState {
  if (start < 0 || end <= start || end > s.text.length) return clone(s);
  const next = clone(s);
  const id = 'a' + next.nextAnnId++;
  const anchorStart = next.chars[start];
  const anchorEnd = next.chars[end - 1] + 1;
  const quote = s.text.slice(start, end);
  next.annotations.push({
    id,
    anchorStart,
    anchorEnd,
    quote,
    originalQuote: quote,
    category,
    comment,
    status: "open",
    needsReview: false,
    createdAt: now,
  });
  return next;
}

export function updateAnnotation(
  s: DocState,
  id: string,
  patch: Partial<Pick<Annotation, "category" | "comment">>
): DocState {
  const next = clone(s);
  const ann = next.annotations.find((a) => a.id === id);
  if (ann) Object.assign(ann, patch);
  return next;
}

export function setStatus(s: DocState, id: string, status: AnnStatus): DocState {
  const next = clone(s);
  const ann = next.annotations.find((a) => a.id === id);
  if (ann) ann.status = status;
  return next;
}

export function deleteAnnotation(s: DocState, id: string): DocState {
  const next = clone(s);
  next.annotations = next.annotations.filter((a) => a.id !== id);
  return next;
}

/** 用当前正文中新选取的区间重新关联批注，清除复核标记并刷新引用。 */
export function relinkAnnotation(s: DocState, id: string, start: number, end: number): DocState {
  if (start < 0 || end <= start || end > s.text.length) return clone(s);
  const next = clone(s);
  const ann = next.annotations.find((a) => a.id === id);
  if (!ann) return next;
  ann.anchorStart = next.chars[start];
  ann.anchorEnd = next.chars[end - 1] + 1;
  ann.quote = s.text.slice(start, end);
  ann.needsReview = false;
  return next;
}

/** 求 oldText -> newText 的差异：公共前缀/后缀，返回 [删除起点, 删除终点, 插入串]。 */
export function diffEdit(oldText: string, newText: string): [number, number, string] {
  let p = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (p < maxPrefix && oldText[p] === newText[p]) p++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > p && newEnd > p && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return [p, oldEnd, newText.slice(p, newEnd)];
}

/**
 * 应用一次正文编辑（删除旧文 [a,b) 并在该处插入 inserted）。
 * 边界规则：插入恰好落在批注起点之后/终点之前都不扩入批注；
 * 删除或改动批注内部字符则置 needsReview；锚点字符全部消失即失联。
 */
export function applyEdit(s: DocState, a: number, b: number, inserted: string): DocState {
  const next = clone(s);
  const deletion = b - a > 0;
  const deletedIds = new Set<number>();
  if (deletion) for (let i = a; i < b; i++) deletedIds.add(s.chars[i]);

  // 编辑前每条批注的现存片段，用于判断纯插入是否发生在批注内部。
  const oldPieces = new Map<string, Array<[number, number]>>();
  for (const ann of s.annotations) oldPieces.set(ann.id, pieces(s, ann));

  const newIds: number[] = [];
  for (let i = 0; i < inserted.length; i++) newIds.push(next.nextCharId++);
  next.chars.splice(a, b - a, ...newIds);
  next.text = s.text.slice(0, a) + inserted + s.text.slice(b);

  for (const ann of next.annotations) {
    let touched = false;
    for (let id = ann.anchorStart; id < ann.anchorEnd; id++) {
      if (deletedIds.has(id)) {
        touched = true;
        break;
      }
    }
    if (!touched && inserted.length > 0) {
      const ps = oldPieces.get(ann.id) ?? [];
      // 纯插入：恰好在边界（a === pieceStart 或 a === pieceEnd）不算内部。
      if (ps.some(([x, y]) => a > x && a < y)) touched = true;
    }
    if (touched) ann.needsReview = true;
    const ps = pieces(next, ann);
    if (ps.length) ann.quote = ps.map(([x, y]) => next.text.slice(x, y)).join("…");
  }
  return next;
}

export function commit(h: History, next: DocState): History {
  return { past: [...h.past, h.present], present: next, future: [] };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}

/** 替换整篇正文（导入示例/清空），生成全新字符身份。 */
export function replaceText(s: DocState, text: string): DocState {
  const fresh = createDoc(text);
  fresh.nextAnnId = s.nextCharId;
  return fresh;
}

// ---- JSON 导入导出 ----

export interface ExportFile {
  app: "editorial-annotation-workbench";
  version: 1;
  text: string;
  chars: number[];
  nextCharId: number;
  annotations: Annotation[];
}

export function exportJSON(s: DocState): string {
  const data: ExportFile = {
    app: "editorial-annotation-workbench",
    version: 1,
    text: s.text,
    chars: s.chars,
    nextCharId: s.nextCharId,
    annotations: s.annotations,
  };
  return JSON.stringify(data, null, 2);
}

export class ImportError extends Error {}

export function importJSON(raw: string): DocState {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ImportError("文件不是合法 JSON");
  }
  const d = data as Partial<ExportFile>;
  if (!d || d.app !== "editorial-annotation-workbench" || d.version !== 1)
    throw new ImportError("文件缺少本工作台的标识或版本不受支持");
  if (typeof d.text !== "string" || !Array.isArray(d.chars) || d.chars.length !== d.text.length)
    throw new ImportError("正文与字符映射长度不一致");
  if (typeof d.nextCharId !== "number" || d.nextCharId < d.chars.length)
    throw new ImportError("字符 ID 计数器无效");
  if (!d.chars.every((n) => Number.isInteger(n) && n >= 0)) throw new ImportError("字符映射包含非法 ID");
  if (!Array.isArray(d.annotations)) throw new ImportError("批注字段缺失");
  let maxAnnNum = 0;
  const annotations: Annotation[] = d.annotations.map((rawAnn, i) => {
    const a = rawAnn as Partial<Annotation>;
    if (
      typeof a.id !== "string" ||
      !Number.isInteger(a.anchorStart) ||
      !Number.isInteger(a.anchorEnd) ||
      (a.anchorStart as number) < 0 ||
      (a.anchorEnd as number) <= (a.anchorStart as number) ||
      (a.anchorEnd as number) > (d.nextCharId as number) ||
      typeof a.originalQuote !== "string" ||
      typeof a.quote !== "string" ||
      typeof a.category !== "string" ||
      typeof a.comment !== "string" ||
      (a.status !== "open" && a.status !== "resolved") ||
      typeof a.needsReview !== "boolean" ||
      typeof a.createdAt !== "number"
    )
      throw new ImportError('第 ' + (i + 1) + ' 条批注字段无效');
    const m = /^a(\d+)$/.exec(a.id);
    if (m) maxAnnNum = Math.max(maxAnnNum, Number(m[1]));
    return { ...(a as unknown as Annotation) };
  });
  return { text: d.text, chars: d.chars as number[], nextCharId: d.nextCharId as number, annotations, nextAnnId: maxAnnNum + 1 };
}
