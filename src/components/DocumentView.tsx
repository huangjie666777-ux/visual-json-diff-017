import { useMemo, useRef } from "react";
import type { DocState, Annotation } from "../core";
import { pieces } from "../core";

export interface SelectionRange { start: number; end: number; }

interface Props {
  doc: DocState;
  activeId: string | null;
  relinkId: string | null;
  onSelect: (range: SelectionRange | null) => void;
  onActivate: (id: string) => void;
  registerScroller: (fn: (id: string) => void) => void;
}

/** 把 DOM Selection 端点换算成正文 UTF-16 偏移。
 * 结构为 root > div.doc-line*（每行含一个文本节点意义上的行内容），
 * 行间补 1 个换行符；不能用 Range.toString()，它跨行会插入额外换行。 */
function pointOffset(root: HTMLElement, node: Node, offset: number): number {
  if (node === root) return 0;
  const targetLine = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement))?.closest(".doc-line");
  if (!targetLine) return 0;
  let total = 0;
  for (const line of Array.from(root.querySelectorAll(".doc-line"))) {
    if (line === targetLine) {
      // 在目标行内：统计到端点节点为止的文本长度。
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let inner = 0;
      for (;;) {
        const tn = walker.nextNode();
        if (!tn || tn === node) return total + inner + (tn === node ? offset : 0);
        inner += (tn.textContent ?? "").length;
      }
    }
    total += (line.textContent ?? "").length + 1; // 行尾换行
  }
  return total;
}

export default function DocumentView({ doc, activeId, relinkId, onSelect, onActivate, registerScroller }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  const coverage = useMemo(() => {
    const sets: Set<string>[] = [];
    for (let i = 0; i < doc.text.length; i++) sets.push(new Set<string>());
    for (const ann of doc.annotations) {
      for (const [a, b] of pieces(doc, ann)) {
        for (let i = a; i < b; i++) sets[i].add(ann.id);
      }
    }
    return sets;
  }, [doc]);

  const annById = useMemo(() => {
    const m = new Map<string, Annotation>();
    for (const a of doc.annotations) m.set(a.id, a);
    return m;
  }, [doc]);

  registerScroller((id: string) => {
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('mark[data-ann="' + id + '"]');
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const readSelection = () => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    let start = pointOffset(root, range.startContainer, range.startOffset);
    let end = pointOffset(root, range.endContainer, range.endOffset);
    if (start > end) [start, end] = [end, start];
    end = Math.min(end, doc.text.length);
    if (end > start) onSelect({ start, end });
  };

  // 按行渲染，行内再按批注覆盖集合切成片段并嵌套 mark。
  const lines: React.ReactNode[] = [];
  let pos = 0;
  const lineStarts: number[] = [];
  const splitLines = doc.text.split("\n");
  splitLines.forEach((line, lineIdx) => {
    lineStarts.push(pos);
    const segs: React.ReactNode[] = [];
    let segStart = 0;
    const keyOf = (i: number) => [...coverage[pos + i]].sort().join("|"); // eslint-disable-line
    for (let i = 1; i <= line.length; i++) {
      if (i === line.length || keyOf(i) !== keyOf(segStart)) {
        const ids = [...coverage[pos + segStart]].sort();
        const content = line.slice(segStart, i);
        let node: React.ReactNode = (
          <span key={segStart} data-pos={pos + segStart} className="leaf">{content}</span>
        );
        for (const id of ids) {
          const ann = annById.get(id);
          const cls = [
            "hl",
            ann?.status === "resolved" ? "hl-resolved" : "hl-open",
            ann?.needsReview ? "hl-review" : "",
            activeId === id ? "hl-active" : "",
          ].filter(Boolean).join(" ");
          node = (
            <mark key={id} className={cls} data-ann={id}>{node}</mark>
          );
        }
        segs.push(node);
        segStart = i;
      }
    }
    lines.push(
      <div className="doc-line" key={lineIdx}>{line.length === 0 ? <br /> : segs}</div>
    );
    pos += line.length + 1;
  });

  return (
    <div
      ref={rootRef}
      className={"doc-view" + (relinkId ? " relinking" : "")}
      onMouseUp={readSelection}
      onClick={(e) => {
        const mark = (e.target as HTMLElement).closest?.('mark[data-ann]') as HTMLElement | null;
        if (mark) {
          onActivate(mark.dataset.ann!);
        }
      }}
    >
      {relinkId && <div className="relink-banner">重新关联模式：请在正文中选取该批注应对应的新片段。</div>}
      {lines}
    </div>
  );
}
