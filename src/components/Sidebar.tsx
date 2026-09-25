import { useMemo, useState } from "react";
import type { DocState, Annotation } from "../core";
import { pieces, isLost } from "../core";
import { CATEGORIES } from "../categories";

interface Props {
  doc: DocState;
  activeId: string | null;
  draft: { start: number; end: number } | null;
  onActivate: (id: string) => void;
  onCreate: (category: string, comment: string) => void;
  onUpdate: (id: string, patch: { category?: string; comment?: string }) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onRelink: (id: string) => void;
}
type StatusFilter = "all" | "open" | "resolved";

export default function Sidebar(p: Props) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [q, setQ] = useState("");
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [newComment, setNewComment] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return p.doc.annotations.filter((a) => {
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (reviewOnly && !a.needsReview) return false;
      if (needle) {
        const hay = (a.comment + " " + a.quote + " " + a.originalQuote + " " + a.category).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [p.doc, categoryFilter, statusFilter, reviewOnly, q]);

  const reviewCount = p.doc.annotations.filter((a) => a.needsReview).length;

  return (
    <aside className="sidebar">
      {p.draft && (
        <section className="composer card">
          <h3>新建批注</h3>
          <blockquote className="quote-draft">{p.doc.text.slice(p.draft.start, p.draft.end)}</blockquote>
          <label>问题分类
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>意见
            <textarea rows={3} value={newComment} placeholder="填写修改意见…" onChange={(e) => setNewComment(e.target.value)} />
          </label>
          <button className="primary" onClick={() => { p.onCreate(newCategory, newComment); setNewComment(""); }}>
            添加批注
          </button>
        </section>
      )}

      <section className="filters card">
        <div className="filter-row">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="按分类筛选">
            <option value="all">全部分类</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="按状态筛选">
            <option value="all">全部状态</option>
            <option value="open">待处理</option>
            <option value="resolved">已解决</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          只看待复核{reviewCount > 0 && <span className="badge">{reviewCount}</span>}
        </label>
        <input className="search" placeholder="搜索意见 / 引用文字…" value={q} onChange={(e) => setQ(e.target.value)} />
      </section>

      <section className="ann-list">
        {reviewCount > 0 && !reviewOnly && (
          <div className="review-tip" role="status">⚠ 有 {reviewCount} 条批注覆盖的正文已被改动，需要复核。</div>
        )}
        {visible.map((a) => <AnnCard key={a.id} {...p} ann={a} doc={p.doc} active={p.activeId === a.id} />)}
        {visible.length === 0 && <p className="empty">没有符合条件的批注。</p>}
      </section>
    </aside>
  );
}

function AnnCard(a: Props & { ann: Annotation; doc: DocState; active: boolean }) {
  const { ann, doc, active } = a;
  const lost = isLost(doc, ann);
  const ps = pieces(doc, ann);
  const currentQuote = ps.map(([x, y]) => doc.text.slice(x, y)).join(" … ");
  return (
    <article className={"card ann-card" + (active ? " active" : "") + (ann.needsReview ? " needs-review" : "")}>
      <header>
        <select
          className="mini-select" value={ann.category}
          onChange={(e) => a.onUpdate(ann.id, { category: e.target.value })}
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className={"status-pill " + ann.status}>{ann.status === "resolved" ? "已解决" : "待处理"}</span>
        <button className="link-btn" onClick={() => a.onActivate(ann.id)} disabled={lost}>定位{lost ? "（失联）" : ""}</button>
      </header>
      {ann.needsReview && (
        <div className="review-flag">⚠ 正文改动后需复核：{lost ? "原片段已完全删除，当前失联" : "仍有部分文字存在"}</div>
      )}
      <div className="quote-block">
        <span className="quote-label">当前关联</span>
        {lost ? <em className="lost">（失联，无高亮）</em> : <blockquote className="quote-now">{currentQuote}</blockquote>}
      </div>
      {ann.originalQuote !== ann.quote && (
        <div className="quote-block">
          <span className="quote-label">原引用</span>
          <blockquote className="quote-orig">{ann.originalQuote}</blockquote>
        </div>
      )}
      <textarea
        className="comment-edit" rows={2} value={ann.comment} placeholder="意见内容…"
        onChange={(e) => a.onUpdate(ann.id, { comment: e.target.value })}
      />
      <footer>
        <button onClick={() => a.onToggleStatus(ann.id)}>{ann.status === "resolved" ? "重新打开" : "标记解决"}</button>
        <button onClick={() => a.onRelink(ann.id)}>重新关联</button>
        <button className="danger" onClick={() => a.onDelete(ann.id)}>删除</button>
      </footer>
    </article>
  );
}
