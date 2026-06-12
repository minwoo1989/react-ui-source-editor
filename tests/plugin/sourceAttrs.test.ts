import { describe, it, expect } from "vitest";
import { transformSync } from "@babel/core";
import { resolve } from "node:path";
import sourceAttrs from "../../src/plugin/sourceAttrs.js";

function run(code: string, filename = "/abs/App.tsx"): string {
  const out = transformSync(code, {
    filename,
    plugins: [sourceAttrs],
    parserOpts: { plugins: ["jsx"] },
    configFile: false,
    babelrc: false,
  });
  return out!.code!;
}

describe("sourceAttrs babel plugin", () => {
  it("stamps data-source-* on a host element", () => {
    const inputFile = "/abs/App.tsx";
    const code = run(`const x = <div className="a">hi</div>;`, inputFile);
    const expectedFile = resolve(inputFile).replace(/\\/g, "/");
    expect(code).toContain(`data-source-file="${expectedFile}"`);
    expect(code).toContain('data-source-line="1"');
    expect(code).toMatch(/data-source-column="\d+"/);
  });

  it("skips composite components and member tags", () => {
    expect(run(`const x = <Foo a={1}/>;`)).not.toContain("data-source");
    expect(run(`const x = <ns.Thing/>;`)).not.toContain("data-source");
  });

  it("does not double-stamp an element that already has the attrs", () => {
    const code = run(`const x = <div data-source-file="keep"/>;`);
    expect((code.match(/data-source-file/g) ?? []).length).toBe(1);
    expect(code).toContain('data-source-file="keep"');
  });

  it("reports a 1-based column at the `<`", () => {
    const code = run(`const y = (<span/>);`);
    expect(code).toContain('data-source-column="12"');
  });
});
