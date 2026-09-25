import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
import App from "../src/App";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("工作台 UI", () => {
  it("渲染示例文稿，初始无批注", () => {
    render(<App />);
    expect(screen.getByText("第四章 山月与行人")).toBeTruthy();
    expect(screen.getByText("没有符合条件的批注。")).toBeTruthy();
  });

  it("正文编辑插入文字后显示在阅读视图，撤销后恢复", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "正文编辑" }));
    const area = document.getElementById("edit-area") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "【新增标题】\n" + area.value } });
    fireEvent.click(screen.getByRole("button", { name: "阅读 / 批注" }));
    expect(screen.getByText("【新增标题】")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));
    expect(screen.queryByText("【新增标题】")).toBeNull();
  });

  it("刷新后从 localStorage 恢复草稿", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "正文编辑" }));
    const area = document.getElementById("edit-area") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "持久化文字" + area.value } });
    unmount();
    render(<App />);
    expect(screen.getByText(/持久化文字/)).toBeTruthy();
  });

  it("损坏的 JSON 导入给出提示且不覆盖当前工作", async () => {
    render(<App />);
    const input = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["{broken"], "bad.json", { type: "application/json" })] } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/导入失败/));
    expect(screen.getByText("第四章 山月与行人")).toBeTruthy();
  });
});
