import { useEffect, useMemo, useRef } from "react";
import type { Annotation } from "../lib/model";

export interface RangeSelection {
  start: number;
  end: number;
  rect: { top: number; left: number; bottom: number };
}

interface Props {
  text: string;
  annotations: Annotation[];
  selectedId: string | null;
  scrollRequest: { id: string; n: number } | null;
  onSelect: (id: string | null) => void;
  onRangeSelected: (sel: RangeSelection) => void;
}

interface Segment {
  start: number;
  end: number;
  ids: string[];
}

function buildSegments(text: string, annotations: Annotation[]): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const a of annotations) {
    if (a.start >= 0) {
      cuts.add(a.start);
      cuts.add(a.end);
    }
  }
  const sorted = [...cuts].sort((x, y) => x - y);
  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const ids = annotations
      .filter((a) => a.start >= 0 && a.start <= start && a.end >= end)
      .map((a) => a.id);
    segs.push({ start, end, ids });
  }
  return segs;
}

function toOffset(container: HTMLElement, node: Node, offset: number): number | null {
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

export default function DocView({ text, annotations, selectedId, scrollRequest, onSelect, onRangeSelected }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const annById = useMemo(() => new Map(annotations.map((a) => [a.id, a])), [annotations]);
  const segments = useMemo(() => buildSegments(text, annotations), [text, annotations]);

  useEffect(() => {
    if (!scrollRequest || !ref.current) return;
    const el = ref.current.querySelector(`[data-aids~="${scrollRequest.id}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [scrollRequest]);

  const handleMouseUp = () => {
    window.setTimeout(() => {
      const container = ref.current;
      if (!container) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (r.collapsed) return;
      if (!container.contains(r.startContainer) || !container.contains(r.endContainer)) return;
      const start = toOffset(container, r.startContainer, r.startOffset);
      const end = toOffset(container, r.endContainer, r.endOffset);
      if (start === null || end === null || end <= start) return;
      const rect = r.getBoundingClientRect();
      onRangeSelected({ start, end, rect: { top: rect.top, left: rect.left, bottom: rect.bottom } });
    }, 0);
  };

  const handleSegmentClick = (ids: string[]) => {
    if (ids.length === 0) {
      onSelect(null);
      return;
    }
    const idx = selectedId ? ids.indexOf(selectedId) : -1;
    onSelect(ids[(idx + 1) % ids.length]);
  };

  return (
    <div className="doc-view" ref={ref} onMouseUp={handleMouseUp} data-testid="doc-view">
      {segments.map((seg) => {
        if (seg.ids.length === 0) {
          return <span key={seg.start}>{text.slice(seg.start, seg.end)}</span>;
        }
        const anns = seg.ids.map((id) => annById.get(id)!);
        const isActive = selectedId !== null && seg.ids.includes(selectedId);
        const needsReview = anns.some((a) => a.needsReview);
        const allResolved = anns.every((a) => a.status === "resolved");
        const cls = [
          "hl",
          isActive ? "hl-active" : needsReview ? "hl-review" : allResolved ? "hl-resolved" : "hl-open",
          seg.ids.length > 1 ? "hl-multi" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span
            key={seg.start}
            className={cls}
            data-aids={seg.ids.join(" ")}
            data-start={seg.start}
            data-end={seg.end}
            onClick={(e) => {
              e.stopPropagation();
              handleSegmentClick(seg.ids);
            }}
          >
            {text.slice(seg.start, seg.end)}
          </span>
        );
      })}
    </div>
  );
}
