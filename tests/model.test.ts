import { describe, expect, it } from "vitest";
import {
  applyTextEdit,
  createAnnotation,
  currentQuote,
  diffRange,
  parseImport,
  reassociate,
  serializeState,
  type DocState,
} from "../src/lib/model";

function stateWith(text: string, ranges: Array<[number, number]>): DocState {
  return {
    text,
    annotations: ranges.map(([s, e], i) => {
      const a = createAnnotation(text, s, e, "错别字", `意见${i}`);
      return a;
    }),
  };
}

describe("createAnnotation", () => {
  it("保存原引用，支持中文、表情与换行", () => {
    const text = "你好，🍵世界。\n第二行文字";
    const a = createAnnotation(text, 3, 10, "表述歧义", "看看");
    expect(a.originalText).toBe("🍵世界。\n第");
    expect(a.needsReview).toBe(false);
    expect(a.status).toBe("open");
  });
  it("拒绝非法区间", () => {
    expect(() => createAnnotation("abc", 2, 2, "c", "c")).toThrow();
    expect(() => createAnnotation("abc", -1, 2, "c", "c")).toThrow();
    expect(() => createAnnotation("abc", 1, 5, "c", "c")).toThrow();
  });
});

describe("diffRange", () => {
  it("识别插入、删除与替换", () => {
    expect(diffRange("abcdef", "abcXYZdef")).toMatchObject({ removedStart: 3, removedEnd: 3, insertStart: 3, insertEnd: 6 });
    expect(diffRange("abcdef", "abef")).toMatchObject({ removedStart: 2, removedEnd: 4, insertStart: 2, insertEnd: 2 });
    expect(diffRange("abcdef", "abXYef")).toMatchObject({ removedStart: 2, removedEnd: 4, insertStart: 2, insertEnd: 4 });
  });
});

describe("applyTextEdit 位置迁移", () => {
  it("批注前插入文字，批注整体平移", () => {
    const s = stateWith("hello world", [[6, 11]]);
    const next = applyTextEdit(s, "XYZ hello world");
    expect(next.annotations[0]).toMatchObject({ start: 10, end: 15, needsReview: false });
    expect(currentQuote(next.text, next.annotations[0])).toBe("world");
  });

  it("批注前删除文字，批注前移", () => {
    const s = stateWith("hello world", [[6, 11]]);
    const next = applyTextEdit(s, "world");
    expect(next.annotations[0]).toMatchObject({ start: 0, end: 5, needsReview: false });
  });

  it("恰好落在片段左边界的插入不扩入批注", () => {
    const s = stateWith("hello world", [[0, 5]]);
    const next = applyTextEdit(s, "hello!!! world");
    // 插入点在 5（hello 之后），批注保持 [0,5)
    expect(next.annotations[0]).toMatchObject({ start: 0, end: 5, needsReview: false });
    expect(currentQuote(next.text, next.annotations[0])).toBe("hello");
  });

  it("恰好落在片段右边界的插入不扩入批注", () => {
    const s = stateWith("hello world", [[6, 11]]);
    const next = applyTextEdit(s, "hello !!!world");
    expect(next.annotations[0]).toMatchObject({ start: 9, end: 14, needsReview: false });
    expect(currentQuote(next.text, next.annotations[0])).toBe("world");
  });

  it("修改批注内部文字：标记需要复核并保留原引用", () => {
    const s = stateWith("hello world", [[0, 5]]);
    const next = applyTextEdit(s, "h3llo world");
    const a = next.annotations[0];
    expect(a.needsReview).toBe(true);
    expect(a.originalText).toBe("hello");
    expect(currentQuote(next.text, a)).toBe("h3llo");
  });

  it("删除批注中间部分：保留仍存在的部分并标记复核", () => {
    const s = stateWith("abcdefghij", [[1, 9]]);
    const next = applyTextEdit(s, "abXXij"); // 删除 cdefgh(2..8)，插入 XX
    const a = next.annotations[0];
    expect(a.needsReview).toBe(true);
    expect(currentQuote(next.text, a)).toBe("bXXi");
  });

  it("部分删除：截断到仍存在的一侧", () => {
    const s = stateWith("hello world", [[0, 8]]);
    const next = applyTextEdit(s, "hellorld"); // 删除 "o w"(4..7)
    const a = next.annotations[0];
    expect(a.needsReview).toBe(true);
    expect(currentQuote(next.text, a)).toBe("hello");
  });

  it("批注片段被完全删除：进入失联状态且不再复活", () => {
    const s = stateWith("hello brave world", [[6, 11]]);
    let next = applyTextEdit(s, "hello  world");
    expect(next.annotations[0]).toMatchObject({ start: -1, end: -1, needsReview: true });
    expect(currentQuote(next.text, next.annotations[0])).toBeNull();
    // 后续编辑不应复活
    next = applyTextEdit(next, "hi hello  world!!");
    expect(next.annotations[0]).toMatchObject({ start: -1, end: -1 });
  });

  it("多处相同引用时各自锚定原位置，不互相跳转", () => {
    const s = stateWith("数据 数据 数据", [[0, 2], [3, 5], [6, 8]]);
    const next = applyTextEdit(s, "数据 数据（待核） 数据");
    const [a1, a2, a3] = next.annotations;
    expect(currentQuote(next.text, a1)).toBe("数据");
    expect(a1.start).toBe(0);
    expect(currentQuote(next.text, a2)).toBe("数据");
    expect(a2.start).toBe(3);
    expect(currentQuote(next.text, a3)).toBe("数据");
    expect(a3.start).toBe(10);
  });

  it("表情等多码元字符按 UTF-16 偏移正确处理", () => {
    const s = stateWith("a🍵b 目标", [[5, 7]]);
    const next = applyTextEdit(s, "a🍵🍵b 目标");
    expect(currentQuote(next.text, next.annotations[0])).toBe("目标");
  });
});

describe("reassociate", () => {
  it("重新关联更新区间、清除复核标记并保留原引用", () => {
    const s = stateWith("hello world", [[0, 5]]);
    const next = reassociate(s, s.annotations[0].id, 6, 11);
    const a = next.annotations[0];
    expect(a).toMatchObject({ start: 6, end: 11, needsReview: false, originalText: "hello" });
  });
  it("拒绝非法区间", () => {
    const s = stateWith("hello", [[0, 2]]);
    expect(() => reassociate(s, s.annotations[0].id, 3, 99)).toThrow();
  });
});

describe("导入导出", () => {
  it("导出后可完整导入（往返一致）", () => {
    const s = stateWith("正文🍵内容\n第二行", [[0, 3], [2, 6]]);
    const restored = parseImport(serializeState(s));
    expect(restored.text).toBe(s.text);
    expect(restored.annotations).toEqual(s.annotations);
  });
  it("损坏文件抛错", () => {
    expect(() => parseImport("not json{{")).toThrow("合法 JSON");
    expect(() => parseImport("{}")).toThrow();
    expect(() => parseImport(JSON.stringify({ app: "other", version: 1, text: "", annotations: [] }))).toThrow();
    expect(() =>
      parseImport(JSON.stringify({ app: "editorial-annotation-workbench", version: 99, text: "", annotations: [] })),
    ).toThrow();
  });
  it("批注区间越界或条目非法时抛错", () => {
    const s = stateWith("abc", [[0, 2]]);
    const good = JSON.parse(serializeState(s));
    const badRange = { ...good, text: "a" };
    expect(() => parseImport(JSON.stringify(badRange))).toThrow("超出正文长度");
    const badAnn = { ...good, annotations: [{ ...good.annotations[0], status: "weird" }] };
    expect(() => parseImport(JSON.stringify(badAnn))).toThrow("非法条目");
  });
});
