import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DocView, { type RangeSelection } from "./components/DocView";
import Sidebar, { type StatusFilter } from "./components/Sidebar";
import { useHistory } from "./lib/history";
import {
  CATEGORIES,
  STORAGE_KEY,
  applyTextEdit,
  createAnnotation,
  currentQuote,
  deleteAnnotation,
  parseImport,
  reassociate,
  serializeState,
  updateAnnotation,
  type DocState,
} from "./lib/model";
import { SAMPLE_TEXT } from "./lib/sample";

function loadInitial(): DocState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseImport(raw);
  } catch {
    // 草稿损坏则忽略，载入示例
  }
  return { text: SAMPLE_TEXT, annotations: [] };
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const history = useHistory(useMemo(loadInitial, []));
  const { state } = history;
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState<{ id: string; n: number } | null>(null);
  const [pendingRange, setPendingRange] = useState<RangeSelection | null>(null);
  const [newCategory, setNewCategory] = useState<string>(CATEGORIES[0]);
  const [newComment, setNewComment] = useState("");
  const [reanchorFor, setReanchorFor] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const lastEditRef = useRef(0);
  const txtFileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);

  // 自动保存草稿
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeState(state));
    } catch {
      // 存储不可用时静默失败
    }
  }, [state]);

  // 撤销 / 重做快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 4000);
  }, []);

  const handleTextChange = (value: string) => {
    const next = applyTextEdit(state, value);
    const now = Date.now();
    if (now - lastEditRef.current < 1000) history.replace(next);
    else history.commit(next);
    lastEditRef.current = now;
  };

  const handleRangeSelected = (sel: RangeSelection) => {
    if (reanchorFor) {
      history.commit(reassociate(state, reanchorFor, sel.start, sel.end));
      setSelectedId(reanchorFor);
      setReanchorFor(null);
      window.getSelection()?.removeAllRanges();
      flash("已重新关联到所选文字");
      return;
    }
    setPendingRange(sel);
    setNewComment("");
    setNewCategory(CATEGORIES[0]);
  };

  const handleCreate = () => {
    if (!pendingRange) return;
    const ann = createAnnotation(state.text, pendingRange.start, pendingRange.end, newCategory, newComment.trim());
    history.commit({ ...state, annotations: [...state.annotations, ann] });
    setSelectedId(ann.id);
    setPendingRange(null);
    window.getSelection()?.removeAllRanges();
  };

  const replaceDocument = (newText: string) => {
    history.commit(applyTextEdit(state, newText));
    flash("正文已更新，批注位置已自动迁移");
  };

  const handleTxtFile = async (file: File) => {
    try {
      const text = await file.text(); // 按 UTF-8 解码
      replaceDocument(text);
    } catch (err) {
      flash(`读取文件失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleJsonFile = async (file: File) => {
    try {
      const content = await file.text();
      const imported = parseImport(content);
      history.reset(imported);
      setSelectedId(null);
      setPendingRange(null);
      setReanchorFor(null);
      flash("导入成功");
    } catch (err) {
      flash(`导入失败：${err instanceof Error ? err.message : String(err)}（当前工作未受影响）`);
    }
  };

  const handleExport = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    download(`审校批注-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`, serializeState(state));
  };

  const filtered = state.annotations.filter((a) => {
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    if (statusFilter === "open" && a.status !== "open") return false;
    if (statusFilter === "resolved" && a.status !== "resolved") return false;
    if (statusFilter === "review" && !a.needsReview) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${a.comment}
${a.originalText}
${currentQuote(state.text, a) ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const reviewCount = state.annotations.filter((a) => a.needsReview).length;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>长文审校批注工作台</h1>
        <div className="tools">
          <button onClick={history.undo} disabled={!history.canUndo}>撤销</button>
          <button onClick={history.redo} disabled={!history.canRedo}>重做</button>
          <button onClick={() => setMode(mode === "view" ? "edit" : "view")}>
            {mode === "view" ? "编辑正文" : "返回批注"}
          </button>
          <button onClick={() => { setPasteText(""); setShowPaste(true); }}>粘贴正文</button>
          <button onClick={() => txtFileRef.current?.click()}>导入文本</button>
          <button onClick={handleExport}>导出 JSON</button>
          <button onClick={() => jsonFileRef.current?.click()}>导入 JSON</button>
          <button
            onClick={() => {
              if (window.confirm("载入示例文稿将替换当前正文（批注会按差异迁移）。继续？")) replaceDocument(SAMPLE_TEXT);
            }}
          >
            载入示例
          </button>
          <input
            ref={txtFileRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleTxtFile(f);
              e.target.value = "";
            }}
          />
          <input
            ref={jsonFileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleJsonFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {notice && <div className="notice" role="status">{notice}</div>}
      {reviewCount > 0 && (
        <div className="review-banner">
          有 {reviewCount} 条批注需要复核（正文修改影响了原片段）。
          <button onClick={() => setStatusFilter("review")}>查看</button>
        </div>
      )}
      {reanchorFor && (
        <div className="review-banner reanchor">
          重新关联模式：请在正文中选取新的关联文字。
          <button onClick={() => setReanchorFor(null)}>取消</button>
        </div>
      )}

      <div className="layout">
        <main className="doc-area">
          {mode === "edit" ? (
            <textarea
              className="editor"
              value={state.text}
              onChange={(e) => handleTextChange(e.target.value)}
              aria-label="正文编辑"
              spellCheck={false}
            />
          ) : (
            <DocView
              text={state.text}
              annotations={state.annotations}
              selectedId={selectedId}
              scrollRequest={scrollRequest}
              onSelect={setSelectedId}
              onRangeSelected={handleRangeSelected}
            />
          )}
        </main>
        <Sidebar
          text={state.text}
          annotations={filtered}
          selectedId={selectedId}
          categoryFilter={categoryFilter}
          statusFilter={statusFilter}
          query={query}
          onCategoryFilter={setCategoryFilter}
          onStatusFilter={setStatusFilter}
          onQuery={setQuery}
          onSelect={setSelectedId}
          onLocate={(id) => {
            setSelectedId(id);
            setMode("view");
            setScrollRequest({ id, n: Date.now() });
          }}
          onToggleStatus={(id) => {
            const a = state.annotations.find((x) => x.id === id);
            if (!a) return;
            history.commit(updateAnnotation(state, id, { status: a.status === "open" ? "resolved" : "open" }));
          }}
          onDelete={(id) => {
            history.commit(deleteAnnotation(state, id));
            if (selectedId === id) setSelectedId(null);
          }}
          onEdit={(id, category, comment) => history.commit(updateAnnotation(state, id, { category, comment }))}
          onReanchor={(id) => {
            setMode("view");
            setReanchorFor(id);
          }}
        />
      </div>

      {pendingRange && (
        <div
          className="popover"
          style={{ top: pendingRange.rect.bottom + 8, left: Math.max(8, pendingRange.rect.left) }}
          role="dialog"
          aria-label="新建批注"
        >
          <div className="quote-preview">{state.text.slice(pendingRange.start, pendingRange.end)}</div>
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="问题分类">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <textarea
            autoFocus
            rows={3}
            placeholder="填写审校意见…"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
          />
          <div className="row">
            <button onClick={handleCreate} disabled={!newComment.trim()}>创建批注</button>
            <button onClick={() => setPendingRange(null)}>取消</button>
          </div>
        </div>
      )}

      {showPaste && (
        <div className="modal-mask" onClick={() => setShowPaste(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="粘贴正文">
            <h2>粘贴正文</h2>
            <p className="hint">粘贴内容将替换当前正文；已有批注会按文本差异自动迁移，受影响片段会标记为需要复核。</p>
            <textarea
              rows={10}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="在此粘贴正文…"
            />
            <div className="row">
              <button
                disabled={!pasteText}
                onClick={() => {
                  replaceDocument(pasteText);
                  setShowPaste(false);
                }}
              >
                替换正文
              </button>
              <button onClick={() => setShowPaste(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
