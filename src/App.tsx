import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  History, DocState, createDoc, commit, undo, redo, applyEdit, diffEdit,
  createAnnotation, updateAnnotation, setStatus, deleteAnnotation, relinkAnnotation,
  exportJSON, importJSON, ImportError, replaceText, pieces,
} from "./core";
import { SAMPLE_TEXT } from "./sample";
import DocumentView, { SelectionRange } from "./components/DocumentView";
import Sidebar from "./components/Sidebar";

const STORAGE_KEY = "annotation-workbench-draft-v1";
const HISTORY_LIMIT = 400;

function capHistory(h: History): History {
  if (h.past.length <= HISTORY_LIMIT) return h;
  return { ...h, past: h.past.slice(h.past.length - HISTORY_LIMIT) };
}

function initialHistory(): History {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const doc = importJSON(raw);
      return { past: [], present: doc, future: [] };
    }
  } catch {
    // 草稿损坏时从示例开始，不影响使用。
  }
  return { past: [], present: createDoc(SAMPLE_TEXT), future: [] };
}

export default function App() {
  const [history, setHistory] = useState<History>(initialHistory);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState<SelectionRange | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const scrollFnRef = useRef<(id: string) => void>(() => {});
  const oldTextRef = useRef<string>(history.present.text);

  const doc = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // 自动保存草稿（含正文、批注与状态）。
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, exportJSON(doc)); } catch { /* 配额失败忽略 */ }
  }, [doc]);

  const mutate = useCallback((next: DocState) => {
    setHistory((h) => capHistory(commit(h, next)));
  }, []);

  const doUndo = useCallback(() => setHistory((h) => undo(h)), []);
  const doRedo = useCallback(() => setHistory((h) => redo(h)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const activate = useCallback((id: string) => {
    setActiveId(id);
    setRelinkId(null);
    requestAnimationFrame(() => scrollFnRef.current(id));
  }, []);

  // 编辑模式 textarea：用前后文本差异求字符级编辑并进入历史。
  const onTextChange = (newText: string) => {
    const old = oldTextRef.current;
    if (newText === old) return;
    const [a, b, inserted] = diffEdit(old, newText);
    const ta = document.getElementById("edit-area") as HTMLTextAreaElement | null;
    const caret = ta ? ta.selectionStart : newText.length;
    mutate(applyEdit(doc, a, b, inserted));
    oldTextRef.current = newText;
    requestAnimationFrame(() => {
      const el = document.getElementById("edit-area") as HTMLTextAreaElement | null;
      if (el) { el.focus(); el.setSelectionRange(caret, caret); }
    });
  };

  useEffect(() => { oldTextRef.current = doc.text; }, [history]);

  const onSelect = (range: SelectionRange | null) => {
    setDraft(range);
    if (range && relinkId) {
      const id = relinkId;
      mutate(relinkAnnotation(doc, id, range.start, range.end));
      setRelinkId(null);
      setDraft(null);
      setActiveId(id);
      showToast("已重新关联，批注恢复为正常状态");
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const counts = useMemo(() => {
    let review = 0, resolved = 0, lost = 0;
    for (const a of doc.annotations) {
      if (a.needsReview) review++;
      if (a.status === "resolved") resolved++;
      if (pieces(doc, a).length === 0) lost++;
    }
    return { review, resolved, lost, total: doc.annotations.length };
  }, [doc]);

  const readTextFile = (file: File, json: boolean) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      if (json) {
        try {
          const next = importJSON(raw);
          mutate(next);
          setMode("view"); setDraft(null); setRelinkId(null); setActiveId(null);
          showToast("JSON 工作稿导入成功");
        } catch (err) {
          showToast("导入失败，当前工作未被覆盖：" + (err as ImportError).message);
        }
      } else {
        mutate(replaceText(doc, raw));
        setDraft(null); setRelinkId(null); setActiveId(null);
        showToast("已导入 UTF-8 文本文件（批注需要重新创建）");
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const onExportJSON = () => {
    download("shengao-annotations.json", exportJSON(doc), "application/json");
  };
  const onExportText = () => download("shengao.txt", doc.text, "text/plain;charset=utf-8");

  const pasteNewText = () => {
    const t = window.prompt("粘贴新的正文（将替换当前正文，批注会清空，可用撤销找回）：", doc.text);
    if (t !== null) { mutate(replaceText(doc, t)); setDraft(null); setRelinkId(null); }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>长文审校批注工作台</h1>
        <div className="toolbar">
          <button onClick={doUndo} disabled={!canUndo} title="Ctrl/Cmd+Z">↶ 撤销</button>
          <button onClick={doRedo} disabled={canRedo ? false : true} className={canRedo ? "" : "disabled-btn"} title="Ctrl/Cmd+Shift+Z 或 Ctrl+Y">↷ 重做</button>
          <span className="sep" />
          <button className={mode === "view" ? "primary" : ""} onClick={() => setMode("view")}>阅读 / 批注</button>
          <button className={mode === "edit" ? "primary" : ""} onClick={() => setMode("edit")}>正文编辑</button>
          <span className="sep" />
          <button onClick={pasteNewText}>粘贴正文</button>
          <button onClick={() => fileInputRef.current?.click()}>导入 TXT</button>
          <button onClick={() => jsonInputRef.current?.click()}>导入 JSON</button>
          <button onClick={onExportText}>导出 TXT</button>
          <button onClick={onExportJSON}>导出 JSON</button>
          <input ref={fileInputRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => {
            const f = e.target.files?.[0]; if (f) readTextFile(f, false); e.target.value = "";
          }} />
          <input ref={jsonInputRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0]; if (f) readTextFile(f, true); e.target.value = "";
          }} />
        </div>
      </header>

      <div className="stats">
        共 {counts.total} 条批注 · 待处理 {counts.total - counts.resolved} · 已解决 {counts.resolved}
        {counts.review > 0 && <> · <strong>待复核 {counts.review}</strong></>}
        {counts.lost > 0 && <> · 失联 {counts.lost}</>}
        <span className="hint">阅读模式下用鼠标选取文字即可批注；正文改动后待复核批注可重新关联或删除。</span>
      </div>

      <main className="workspace">
        <section className="doc-pane">
          {mode === "view" ? (
            <DocumentView
              doc={doc}
              activeId={activeId}
              relinkId={relinkId}
              onSelect={onSelect}
              onActivate={activate}
              registerScroller={(fn) => { scrollFnRef.current = fn; }}
            />
          ) : (
            <textarea
              id="edit-area"
              className="edit-area"
              value={doc.text}
              spellCheck={false}
              onChange={(e) => onTextChange(e.target.value)}
            />
          )}
        </section>

        <Sidebar
          doc={doc}
          activeId={activeId}
          draft={draft}
          onActivate={activate}
          onCreate={(category, comment) => {
            if (!draft) return;
            const next = createAnnotation(doc, draft.start, draft.end, category, comment);
            mutate(next);
            const created = next.annotations[next.annotations.length - 1];
            setDraft(null);
            setActiveId(created.id);
            window.getSelection()?.removeAllRanges();
          }}
          onUpdate={(id, patch) => mutate(updateAnnotation(doc, id, patch))}
          onDelete={(id) => { mutate(deleteAnnotation(doc, id)); if (activeId === id) setActiveId(null); }}
          onToggleStatus={(id) => {
            const ann = doc.annotations.find((x) => x.id === id);
            if (ann) mutate(setStatus(doc, id, ann.status === "resolved" ? "open" : "resolved"));
          }}
          onRelink={(id) => {
            setRelinkId(id);
            setActiveId(id);
            setMode("view");
            showToast("请选取新的正文片段完成重新关联");
          }}
        />
      </main>

      {relinkId && mode === "view" && (
        <button className="cancel-relink" onClick={() => setRelinkId(null)}>取消重新关联</button>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
