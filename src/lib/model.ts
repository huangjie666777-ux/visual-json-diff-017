export type AnnotationStatus = "open" | "resolved";

export interface Annotation {
  id: string;
  /** 当前关联区间（相对当前正文，UTF-16 偏移，左闭右开）；失联时为 -1 */
  start: number;
  end: number;
  /** 创建时的原始区间与引用，永不改变 */
  originalStart: number;
  originalEnd: number;
  originalText: string;
  category: string;
  comment: string;
  status: AnnotationStatus;
  needsReview: boolean;
  createdAt: number;
}

export interface DocState {
  text: string;
  annotations: Annotation[];
}

export const CATEGORIES = ["错别字", "标点语法", "事实核对", "表述歧义", "风格统一", "结构逻辑", "其他"] as const;

let counter = 0;
export function createId(): string {
  counter += 1;
  return `a${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createAnnotation(
  text: string,
  start: number,
  end: number,
  category: string,
  comment: string,
  createdAt = Date.now(),
): Annotation {
  if (start < 0 || end <= start || end > text.length) {
    throw new Error("非法批注区间");
  }
  return {
    id: createId(),
    start,
    end,
    originalStart: start,
    originalEnd: end,
    originalText: text.slice(start, end),
    category,
    comment,
    status: "open",
    needsReview: false,
    createdAt,
  };
}

export function currentQuote(text: string, a: Annotation): string | null {
  if (a.start < 0) return null;
  return text.slice(a.start, a.end);
}

/** 比较两段正文，得到一次编辑对应的旧区间与新区间（基于公共前缀/后缀） */
export function diffRange(oldText: string, newText: string) {
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    removedStart: prefix,
    removedEnd: oldText.length - suffix,
    insertStart: prefix,
    insertEnd: newText.length - suffix,
  };
}

/**
 * 应用一次正文编辑并迁移全部批注。
 * 规则：批注前的增删整体平移；边界插入不扩入批注；批注内部被修改/删除标记需要复核；
 * 片段被完全删除则失联（start/end = -1），且不再复活。
 */
export function applyTextEdit(state: DocState, newText: string): DocState {
  if (newText === state.text) return state;
  const { removedStart: rS, removedEnd: rE, insertStart: iS, insertEnd: iE } = diffRange(state.text, newText);
  const delta = iE - iS - (rE - rS);
  const annotations = state.annotations.map((a): Annotation => {
    if (a.start < 0) return a;
    if (a.end <= rS) return a;
    if (a.start >= rE) return { ...a, start: a.start + delta, end: a.end + delta };
    if (a.start >= rS && a.end <= rE) {
      return { ...a, start: -1, end: -1, needsReview: true };
    }
    const start = a.start < rS ? a.start : iE;
    const end = a.end > rE ? a.end + delta : iS;
    return { ...a, start, end, needsReview: true };
  });
  return { text: newText, annotations };
}

/** 用当前正文中的新区间重新关联批注，原引用保留不变 */
export function reassociate(state: DocState, id: string, start: number, end: number): DocState {
  if (start < 0 || end <= start || end > state.text.length) throw new Error("非法重选区间");
  return {
    ...state,
    annotations: state.annotations.map((a) =>
      a.id === id ? { ...a, start, end, needsReview: false } : a,
    ),
  };
}

export function updateAnnotation(
  state: DocState,
  id: string,
  patch: Partial<Pick<Annotation, "category" | "comment" | "status">>,
): DocState {
  return {
    ...state,
    annotations: state.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  };
}

export function deleteAnnotation(state: DocState, id: string): DocState {
  return { ...state, annotations: state.annotations.filter((a) => a.id !== id) };
}

export const STORAGE_KEY = "editorial-annotation-workbench-draft-v1";
export const EXPORT_VERSION = 1;

export interface ExportFile {
  app: "editorial-annotation-workbench";
  version: number;
  text: string;
  annotations: Annotation[];
  exportedAt?: number;
}

export function serializeState(state: DocState): string {
  const payload: ExportFile = {
    app: "editorial-annotation-workbench",
    version: EXPORT_VERSION,
    text: state.text,
    annotations: state.annotations,
    exportedAt: Date.now(),
  };
  return JSON.stringify(payload, null, 2);
}

function isAnnotation(v: unknown): v is Annotation {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.start === "number" &&
    typeof o.end === "number" &&
    (o.start === -1 || o.start >= 0) &&
    (o.end === -1 || o.end > o.start) &&
    typeof o.originalStart === "number" &&
    typeof o.originalEnd === "number" &&
    typeof o.originalText === "string" &&
    typeof o.category === "string" &&
    typeof o.comment === "string" &&
    (o.status === "open" || o.status === "resolved") &&
    typeof o.needsReview === "boolean"
  );
}

/** 严格校验导入内容；失败抛错，调用方不得覆盖当前工作 */
export function parseImport(json: string): DocState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("文件不是合法 JSON");
  }
  if (typeof data !== "object" || data === null) throw new Error("文件结构缺失");
  const o = data as Record<string, unknown>;
  if (o.app !== "editorial-annotation-workbench") throw new Error("不是本工作台导出的文件");
  if (o.version !== EXPORT_VERSION) throw new Error(`不支持的版本：${String(o.version)}`);
  if (typeof o.text !== "string") throw new Error("正文字段缺失或不是字符串");
  if (!Array.isArray(o.annotations)) throw new Error("批注字段缺失或不是数组");
  if (!o.annotations.every(isAnnotation)) throw new Error("批注数据存在非法条目");
  const annotations = o.annotations as Annotation[];
  for (const a of annotations) {
    if (a.start >= 0 && (a.end > o.text.length || a.start >= o.text.length)) {
      throw new Error("批注区间超出正文长度");
    }
  }
  const ids = new Set(annotations.map((a) => a.id));
  if (ids.size !== annotations.length) throw new Error("批注 ID 重复");
  return { text: o.text, annotations };
}
