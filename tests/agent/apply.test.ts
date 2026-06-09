// tests/agent/apply.test.ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { processEdits } from "../../src/agent/apply.js";
import type { EditRequest } from "../../src/shared/types.js";

function projectWith(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile("/F.tsx", text);
  return project;
}

describe("processEdits", () => {
  it("applies a safe literal prop edit and returns new text", () => {
    const project = projectWith(`const C=()=>(<Button type="default" />);`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 14,
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("applied");
    if (res.status === "applied") expect(res.newText).toContain(`type="primary"`);
  });

  it("suggests (does not write) a dynamic prop edit", () => {
    const project = projectWith(`const C=()=>(<Button type={t} />);`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 14,
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("suggested");
  });

  it("errors when the element cannot be located", () => {
    const project = projectWith(`const x = 1;`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 1,
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    expect(processEdits(project, req).status).toBe("error");
  });
});
