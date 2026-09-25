import { useEffect, useRef, useState } from "react";
import { CATEGORIES, currentQuote, type Annotation } from "../lib/model";

export type StatusFilter = "all" | "open" | "resolved" | "review";

interface Props {
  text: string;
  annotations: Annotation[];
  selectedId: string | null;
  categoryFilter: string;
  statusFilter: StatusFilter;
  query: string;
  onCategoryFilter: (v: string) => void;
  onStatusFilter: (v: StatusFilter) => void;
  onQuery: (v: string) => void;
  onSelect: (id: string | null) => void;
  onLocate: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, category: string, comment: string) => void;
  onReanchor: (id: string) => void;
}

export default function Sidebar(props: Props) {
  const { annotations, text, selectedId } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState("");
  const [draftComment, setDraftComment] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-card="${selectedId}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const startEdit = (a: Annotation) => {
    setEditingId(a.id);
    setDraftCategory(a.category);
    setDraftComment(a.comment);
  };

  return (
    <aside className="sidebar">
      <div className="filters">
        <select value={props.categoryFilter} onChange={(e) => props.onCategoryFilter(e.target.value)} aria-label="按分类筛选">
          <option value="all">全部分类</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={props.statusFilter}
          onChange={(e) => props.onStatusFilter(e.target.value as StatusFilter)}
          aria-label="按状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="open">待处理</option>
          <option value="resolved">已解决</option>
          <option value="review">需要复核</option>
        </select>
        <input
          type="search"
          placeholder="搜索意见 / 引用…"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          aria-label="搜索意见"
        />
      </div>
      <div className="ann-list" ref={listRef}>
        {annotations.length === 0 && <p className="empty">暂无批注。在正文中选取文字即可创建。</p>}
        {annotations.map((a) => {
          const quote = currentQuote(text, a);
          const editing = editingId === a.id;
          return (
            <article
              key={a.id}
              data-card={a.id}
              className={["ann-card", a.id === selectedId ? "ann-active" : "", a.needsReview ? "ann-review" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => props.onSelect(a.id)}
            >
              <header>
                <span className="badge">{a.category}</span>
                <span className={`status ${a.status}`}>{a.status === "open" ? "待处理" : "已解决"}</span>
                {a.needsReview && <span className="status review">需要复核</span>}
              </header>
              {editing ? (
                <div className="edit-form" onClick={(e) => e.stopPropagation()}>
                  <select value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <textarea
                    value={draftComment}
                    rows={3}
                    onChange={(e) => setDraftComment(e.target.value)}
                  />
                  <div className="row">
                    <button
                      onClick={() => {
                        props.onEdit(a.id, draftCategory, draftComment);
                        setEditingId(null);
                      }}
                    >
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <p className="comment">{a.comment || "（无意见内容）"}</p>
              )}
              <dl className="quotes">
                <dt>当前关联</dt>
                <dd className={quote === null ? "lost" : ""}>{quote === null ? "已失联（原文片段被删除）" : quote}</dd>
                <dt>原引用</dt>
                <dd>{a.originalText}</dd>
              </dl>
              <div className="row actions" onClick={(e) => e.stopPropagation()}>
                {quote !== null && <button onClick={() => props.onLocate(a.id)}>定位</button>}
                <button onClick={() => props.onToggleStatus(a.id)}>
                  {a.status === "open" ? "标记解决" : "重新打开"}
                </button>
                <button onClick={() => props.onReanchor(a.id)}>重新关联</button>
                <button onClick={() => startEdit(a)}>编辑</button>
                <button className="danger" onClick={() => props.onDelete(a.id)}>删除</button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
