import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DocView from "../src/components/DocView";
import { createAnnotation } from "../src/lib/model";

describe("DocView 高亮渲染", () => {
  const text = "abcdef";
  const a1 = createAnnotation(text, 0, 3, "错别字", "一");
  const a2 = createAnnotation(text, 2, 5, "标点语法", "二");

  it("交叉批注分段渲染，重叠区同时携带两个 ID", () => {
    const { container } = render(
      <DocView text={text} annotations={[a1, a2]} selectedId={null} scrollRequest={null} onSelect={() => {}} onRangeSelected={() => {}} />,
    );
    const overlap = container.querySelector(`[data-aids="${a1.id} ${a2.id}"]`);
    expect(overlap).not.toBeNull();
    expect(overlap!.textContent).toBe("c");
    expect(overlap!.className).toContain("hl-multi");
    expect(container.querySelector(`[data-aids="${a1.id}"]`)!.textContent).toBe("ab");
    expect(container.querySelector(`[data-aids="${a2.id}"]`)!.textContent).toBe("de");
  });

  it("点击高亮在重叠批注间循环选中", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DocView text={text} annotations={[a1, a2]} selectedId={a1.id} scrollRequest={null} onSelect={onSelect} onRangeSelected={() => {}} />,
    );
    fireEvent.click(container.querySelector(`[data-aids="${a1.id} ${a2.id}"]`)!);
    expect(onSelect).toHaveBeenCalledWith(a2.id);
  });

  it("需要复核与已解决状态使用不同样式", () => {
    const review = { ...a1, needsReview: true };
    const resolved = { ...a2, status: "resolved" as const };
    const { container } = render(
      <DocView text={text} annotations={[review, resolved]} selectedId={null} scrollRequest={null} onSelect={() => {}} onRangeSelected={() => {}} />,
    );
    expect(container.querySelector(`[data-aids="${a1.id}"]`)!.className).toContain("hl-review");
    expect(container.querySelector(`[data-aids="${a2.id}"]`)!.className).toContain("hl-resolved");
  });

  it("失联批注不产生任何高亮", () => {
    const lost = { ...a1, start: -1, end: -1, needsReview: true };
    const { container } = render(
      <DocView text={text} annotations={[lost]} selectedId={null} scrollRequest={null} onSelect={() => {}} onRangeSelected={() => {}} />,
    );
    expect(container.querySelector(".hl")).toBeNull();
  });
});
