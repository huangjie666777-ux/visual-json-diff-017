import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";
import { STORAGE_KEY } from "../src/lib/model";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("App", () => {
  it("渲染工具栏、示例正文与空批注侧栏", () => {
    render(<App />);
    expect(screen.getByText("长文审校批注工作台")).toBeTruthy();
    expect(screen.getByText(/暂无批注/)).toBeTruthy();
    expect(screen.getByText(/乡村振兴专题报道/)).toBeTruthy();
  });

  it("编辑模式修改正文后自动保存草稿", () => {
    render(<App />);
    fireEvent.click(screen.getByText("编辑正文"));
    const editor = screen.getByLabelText("正文编辑");
    fireEvent.change(editor, { target: { value: "全新正文内容" } });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).text).toBe("全新正文内容");
  });

  it("导入损坏 JSON 不覆盖当前工作", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("编辑正文"));
    fireEvent.change(screen.getByLabelText("正文编辑"), { target: { value: "保留我" } });
    // 直接模拟导入解析失败路径：构造坏文件
    const bad = new File(["{{bad"], "bad.json", { type: "application/json" });
    const input = document.querySelector('input[accept=".json,application/json"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bad] } });
    await screen.findByText(/导入失败/);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).text).toBe("保留我");
  });
});
