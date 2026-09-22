import { useMemo, useState } from "react";
import { compareJson, parseJson } from "./diff";
import type { JsonValue } from "./types";

const exampleLeft = `{"name":"Ada","roles":["admin"],"active":true}`;
const exampleRight = `{"name":"Ada Lovelace","roles":["admin","owner"],"active":true}`;

function App() {
  const [leftText, setLeftText] = useState(exampleLeft);
  const [rightText, setRightText] = useState(exampleRight);
  const [message, setMessage] = useState("准备对比");
  const [left, setLeft] = useState<JsonValue>();
  const [right, setRight] = useState<JsonValue>();
  const root = useMemo(() => left !== undefined && right !== undefined ? compareJson(left, right) : undefined, [left, right]);

  function runCompare() {
    try {
      setLeft(parseJson(leftText));
      setRight(parseJson(rightText));
      setMessage("对比完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON解析失败");
    }
  }

  return <main className="app-shell">
    <header><p className="eyebrow">OFFLINE TOOL</p><h1>JSON结构对比工作台</h1><p className="subtitle">在浏览器中检查两份JSON的结构变化。</p></header>
    <section className="editors" aria-label="JSON编辑器">
      <label>左侧文档<textarea value={leftText} onChange={event => setLeftText(event.target.value)} spellCheck={false} /></label>
      <label>右侧文档<textarea value={rightText} onChange={event => setRightText(event.target.value)} spellCheck={false} /></label>
    </section>
    <div className="toolbar"><button onClick={runCompare}>开始对比</button><button className="secondary" onClick={() => { setLeftText(exampleLeft); setRightText(exampleRight); }}>载入示例</button><span role="status">{message}</span></div>
    <section className="result" aria-live="polite"><h2>对比结果</h2>{root ? <pre>{JSON.stringify(root, null, 2)}</pre> : <p>点击开始对比查看结构树。</p>}</section>
  </main>;
}

export default App;
