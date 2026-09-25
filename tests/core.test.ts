import { describe, it, expect } from "vitest";
import {
  createDoc, createAnnotation, applyEdit, pieces, undo, redo, commit, diffEdit,
  relinkAnnotation, deleteAnnotation, setStatus, exportJSON, importJSON, ImportError,
} from "../src/core";

function fresh() {
  // 文本中包含两处相同的 "abc"，用于验证锚点不会按文本搜索跳位。
  return createDoc("xxabcyyabc");
}

describe("批注锚点", () => {
  it("支持交叉与同片段多条批注", () => {
    let d = createDoc("0123456789");
    d = createAnnotation(d, 2, 6, "错别字", "A");
    d = createAnnotation(d, 4, 8, "标点", "B");
    expect(pieces(d, d.annotations[0])).toEqual([[2, 6]]);
    expect(pieces(d, d.annotations[1])).toEqual([[4, 8]]);
    expect(d.annotations[0].originalQuote).toBe("2345");
  });

  it("批注前插入文字时随原位置移动，且不扩张", () => {
    let d = fresh();
    d = createAnnotation(d, 2, 5, "错别字", "A"); // "abc" 第一处
    d = applyEdit(d, 0, 0, "ZZ"); // 文首插入
    const a = d.annotations[0];
    expect(pieces(d, a)).toEqual([[4, 7]]);
    expect(d.text.slice(4, 7)).toBe("abc");
    expect(a.needsReview).toBe(false);
  });

  it("插入恰好发生在边界不扩入批注", () => {
    let d = fresh();
    d = createAnnotation(d, 2, 5, "错别字", "A");
    const start = applyEdit(d, 2, 2, "|"); // 起点边界
    expect(pieces(start, start.annotations[0])).toEqual([[3, 6]]);
    const end = applyEdit(d, 5, 5, "|"); // 终点边界
    expect(pieces(end, end.annotations[0])).toEqual([[2, 5]]);
  });

  it("内部改动标记复核并保留原引用", () => {
    let d = fresh();
    d = createAnnotation(d, 2, 5, "错别字", "A");
    d = applyEdit(d, 3, 4, "B"); // b -> B
    const a = d.annotations[0];
    expect(a.needsReview).toBe(true);
    expect(a.originalQuote).toBe("abc");
    expect(pieces(d, a)).toEqual([[2, 3], [4, 5]]); // a 与 c 之间的新字不属于批注
    expect(a.quote).toBe("a…c");
  });

  it("片段被完全删除时失联且不伪造高亮，边界删除不复核", () => {
    let d = fresh();
    d = createAnnotation(d, 2, 5, "错别字", "A");
    const gone = applyEdit(d, 2, 5, "");
    expect(pieces(gone, gone.annotations[0])).toEqual([]);
    expect(gone.annotations[0].needsReview).toBe(true);

    let d2 = fresh();
    d2 = createAnnotation(d2, 2, 5, "错别字", "A");
    const edge = applyEdit(d2, 0, 2, ""); // 删除批注之前的文字
    expect(pieces(edge, edge.annotations[0])).toEqual([[0, 3]]);
    expect(edge.annotations[0].needsReview).toBe(false);
  });

  it("多处相同引用不会跳到另一处", () => {
    let d = fresh();
    d = createAnnotation(d, 7, 10, "错别字", "第二处"); // 第二个 abc
    d = applyEdit(d, 2, 5, "abc"); // 用相同文字替换第一处（等于没变），再在中间插入
    d = applyEdit(d, 3, 3, "~"); // 第一处内部插入
    const a = d.annotations[0];
    expect(a.needsReview).toBe(false); // 第二处不受影响
    const ps = pieces(d, a);
    expect(d.text.slice(ps[0][0], ps[0][1])).toBe("abc");
  });

  it("重新关联清除复核状态并刷新引用", () => {
    let d = fresh();
    d = createAnnotation(d, 2, 5, "错别字", "A");
    d = applyEdit(d, 3, 4, "B");
    d = relinkAnnotation(d, d.annotations[0].id, 0, 2);
    const a = d.annotations[0];
    expect(a.needsReview).toBe(false);
    expect(a.quote).toBe("xx");
    expect(a.originalQuote).toBe("abc"); // 原引用保留
  });

  it("解决/重新打开/删除都可撤销重做且正文一致", () => {
    let d = fresh();
    d = createAnnotation(d, 2, 5, "错别字", "A");
    let h: import("../src/core").History = { past: [], present: d, future: [] };
    h = commit(h, setStatus(h.present, d.annotations[0].id, "resolved"));
    h = commit(h, deleteAnnotation(h.present, d.annotations[0].id));
    expect(h.present.annotations).toHaveLength(0);
    h = undo(h);
    expect(h.present.annotations[0].status).toBe("resolved");
    h = undo(h);
    expect(h.present.annotations[0].status).toBe("open");
    h = redo(h);
    expect(h.present.annotations[0].status).toBe("resolved");
  });

  it("撤销后的新操作清空重做分支", () => {
    let d = fresh();
    let h: import("../src/core").History = { past: [], present: d, future: [] };
    h = commit(h, createAnnotation(h.present, 2, 5, "错别字", "A"));
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = commit(h, createAnnotation(h.present, 0, 2, "标点", "B"));
    expect(h.future).toHaveLength(0);
  });
});

describe("diffEdit", () => {
  it("识别插入、删除和替换", () => {
    expect(diffEdit("abc", "aXbc")).toEqual([1, 1, "X"]);
    expect(diffEdit("abc", "ac")).toEqual([1, 2, ""]);
    expect(diffEdit("abc", "aXYc")).toEqual([1, 2, "XY"]);
  });
});

describe("JSON 导入导出", () => {
  it("往返导出导入保持锚点与状态", () => {
    let d = createDoc("0123456789");
    d = createAnnotation(d, 2, 5, "引用格式", "意见😀");
    d = applyEdit(d, 0, 0, "头");
    const restored = importJSON(exportJSON(d));
    expect(restored.text).toBe(d.text);
    expect(restored.annotations[0].comment).toBe("意见😀");
    expect(pieces(restored, restored.annotations[0])).toEqual(pieces(d, d.annotations[0]));
  });

  it.each([
    "not json",
    JSON.stringify({ app: "other", version: 1 }),
    JSON.stringify({ app: "editorial-annotation-workbench", version: 9, text: "a", chars: [0], nextCharId: 1, annotations: [] }),
    JSON.stringify({ app: "editorial-annotation-workbench", version: 1, text: "ab", chars: [0], nextCharId: 2, annotations: [] }),
  ])("损坏文件抛出错误：%s", (raw) => {
    expect(() => importJSON(raw)).toThrow(ImportError);
  });
});
