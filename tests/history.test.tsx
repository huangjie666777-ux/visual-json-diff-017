import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHistory } from "../src/lib/history";
import { applyTextEdit, createAnnotation, type DocState } from "../src/lib/model";

const base: DocState = { text: "hello world", annotations: [createAnnotation("hello world", 0, 5, "错别字", "意见")] };

describe("useHistory", () => {
  it("撤销/重做保持正文与批注位置一致", () => {
    const { result } = renderHook(() => useHistory(base));
    const edited = applyTextEdit(base, "say hello world");
    act(() => result.current.commit(edited));
    expect(result.current.state.text).toBe("say hello world");
    expect(result.current.state.annotations[0].start).toBe(4);

    act(() => result.current.undo());
    expect(result.current.state.text).toBe("hello world");
    expect(result.current.state.annotations[0].start).toBe(0);

    act(() => result.current.redo());
    expect(result.current.state.text).toBe("say hello world");
    expect(result.current.state.annotations[0].start).toBe(4);
  });

  it("撤销后新操作清空重做分支", () => {
    const { result } = renderHook(() => useHistory(base));
    act(() => result.current.commit(applyTextEdit(base, "A hello world")));
    act(() => result.current.undo());
    act(() => result.current.commit(applyTextEdit(base, "B hello world")));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.state.text).toBe("B hello world");
  });

  it("replace 不产生新历史（连续输入合并）", () => {
    const { result } = renderHook(() => useHistory(base));
    act(() => result.current.commit(applyTextEdit(base, "x hello world")));
    act(() => result.current.replace(applyTextEdit(result.current.state, "xy hello world")));
    expect(result.current.state.text).toBe("xy hello world");
    act(() => result.current.undo());
    expect(result.current.state.text).toBe("hello world");
  });

  it("reset 清空历史", () => {
    const { result } = renderHook(() => useHistory(base));
    act(() => result.current.commit(applyTextEdit(base, "zz hello world")));
    act(() => result.current.reset({ text: "new", annotations: [] }));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.state.text).toBe("new");
  });
});
