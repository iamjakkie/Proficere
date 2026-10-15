import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

const FORMULA =
  /[A-Za-z][A-Za-z0-9_]*\s*=\s*-?\s*(?:[A-Za-z0-9_.]+|\([^()\n]+\))(?:\s*[+\-*/^]\s*-?\s*(?:[A-Za-z0-9_.]+|\([^()\n]+\)))*/g;

function unwrap(value: string): string {
  return value.trim().replace(/^\((.*)\)$/, "$1").trim();
}

function toLatex(expr: string): string {
  const trimmed = expr.trim();
  const frac = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+?)\s*\/\s*(.+)$/);
  if (!frac) return trimmed;
  return `${frac[1]} = \\frac{${unwrap(frac[2])}}{${unwrap(frac[3])}}`;
}

function promoteFormulas(text: string): string {
  return text.replace(FORMULA, (match) => `$${toLatex(match)}$`);
}

function MathTex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex.trim(), {
    throwOnError: false,
    displayMode: display,
    strict: "ignore",
  });
  return display ? (
    <div className="md-math" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:\\.|[^$\n])+\$|`[^`]+`|\*\*[^*]+\*\*)/g)
    .flatMap((part, index) => {
      if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
        return [<MathTex key={index} tex={part.slice(2, -2)} display />];
      }
      if (part.startsWith("\\[") && part.endsWith("\\]") && part.length > 4) {
        return [<MathTex key={index} tex={part.slice(2, -2)} display />];
      }
      if (part.startsWith("\\(") && part.endsWith("\\)") && part.length > 4) {
        return [<MathTex key={index} tex={part.slice(2, -2)} />];
      }
      if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
        return [<MathTex key={index} tex={part.slice(1, -1)} />];
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return [<code key={index}>{part.slice(1, -1)}</code>];
      }
      return part.split(/(\*\*[^*]+\*\*)/g).map((bit, bitIndex) =>
        bit.startsWith("**") && bit.endsWith("**") && bit.length > 4 ? (
          <strong key={`${index}-${bitIndex}`}>{bit.slice(2, -2)}</strong>
        ) : (
          <span key={`${index}-${bitIndex}`}>{bit}</span>
        ),
      );
    });
}

function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      out.push(
        <pre key={key}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      key += 1;
      continue;
    }
    if (trimmed === "$$" || trimmed === "\\[") {
      const close = trimmed === "$$" ? "$$" : "\\]";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== close) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      out.push(<MathTex key={key} tex={body.join("\n")} display />);
      key += 1;
      continue;
    }
    const displayed = trimmed.match(/^\$\$([\s\S]+)\$\$$/) ?? trimmed.match(/^\\\[([\s\S]+)\\\]$/);
    if (displayed) {
      out.push(<MathTex key={key} tex={displayed[1]} display />);
      key += 1;
      index += 1;
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Tag = heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4";
      out.push(<Tag key={key}>{inline(heading[2])}</Tag>);
      key += 1;
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      out.push(
        <ul key={key}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </ul>,
      );
      key += 1;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      out.push(
        <ol key={key}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </ol>,
      );
      key += 1;
      continue;
    }
    if (!trimmed) {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith("```") &&
      lines[index].trim() !== "$$" &&
      lines[index].trim() !== "\\[" &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^#{1,3}\s+\S/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(<p key={key}>{inline(paragraph.join(" "))}</p>);
    key += 1;
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const text = /[$`]|\\\(|\\\[/.test(source) ? source : promoteFormulas(source);
  return <div className="md">{blocks(text)}</div>;
}
