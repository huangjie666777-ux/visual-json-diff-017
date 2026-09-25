import { useCallback, useRef, useState } from "react";
import type { DocState } from "./model";

const LIMIT = 200;

export interface History {
  state: DocState;
  canUndo: boolean;
  canRedo: boolean;
  /** 提交一个新状态，新操作会清空重做分支 */
  commit: (next: DocState) => void;
  /** 替换当前栈顶状态（用于连续输入合并，不产生新历史） */
  replace: (next: DocState) => void;
  undo: () => void;
  redo: () => void;
  /** 替换当前状态且清空历史（导入/载入草稿时使用） */
  reset: (next: DocState) => void;
}

export function useHistory(initial: DocState): History {
  const [state, setState] = useState<DocState>(initial);
  const past = useRef<DocState[]>([]);
  const future = useRef<DocState[]>([]);
  const [version, setVersion] = useState(0);

  const commit = useCallback((next: DocState) => {
    setState((cur) => {
      if (next === cur) return cur;
      past.current.push(cur);
      if (past.current.length > LIMIT) past.current.shift();
      future.current = [];
      setVersion((v) => v + 1);
      return next;
    });
  }, []);

  const replace = useCallback((next: DocState) => {
    setState(() => next);
  }, []);

  const undo = useCallback(() => {
    setState((cur) => {
      const prev = past.current.pop();
      if (!prev) return cur;
      future.current.push(cur);
      setVersion((v) => v + 1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setState((cur) => {
      const next = future.current.pop();
      if (!next) return cur;
      past.current.push(cur);
      setVersion((v) => v + 1);
      return next;
    });
  }, []);

  const reset = useCallback((next: DocState) => {
    past.current = [];
    future.current = [];
    setVersion((v) => v + 1);
    setState(next);
  }, []);

  void version;
  return { state, canUndo: past.current.length > 0, canRedo: future.current.length > 0, commit, replace, undo, redo, reset };
}
