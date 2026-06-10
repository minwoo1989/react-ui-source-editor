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

describe("processEdits: styleRemove", () => {
  it("removes a style property end-to-end", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("F.tsx", `const C=()=>(<Button style={{ color: "red", marginTop: 8 }}>x</Button>);`);
    const res = processEdits(project, {
      file: "F.tsx", line: 1, column: 14,
      edits: [{ kind: "styleRemove", property: "marginTop" }],
    });
    expect(res.status).toBe("applied");
    if (res.status !== "applied") return;
    expect(res.newText).not.toContain("marginTop");
    expect(res.newText).toContain(`color: "red"`);
  });

  it("drops the style attribute when removing the last property", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("F.tsx", `const C=()=>(<Button style={{ color: "red" }}>x</Button>);`);
    const res = processEdits(project, {
      file: "F.tsx", line: 1, column: 14,
      edits: [{ kind: "styleRemove", property: "color" }],
    });
    expect(res.status).toBe("applied");
    if (res.status !== "applied") return;
    expect(res.newText).not.toContain("style=");
  });

  it("suggests (not errors) for styleRemove on a dynamic style expression", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("F.tsx", `const C=()=>(<Button style={styles}>x</Button>);`);
    const res = processEdits(project, {
      file: "F.tsx", line: 1, column: 14,
      edits: [{ kind: "styleRemove", property: "color" }],
    });
    expect(res.status).toBe("suggested");
  });
});

describe("processEdits: absolute file paths", () => {
  it("works when the in-memory file is registered under a windows-style absolute path", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = "D:/app/src/App.tsx"; // server normalizes backslashes to forward slashes
    project.createSourceFile(file, `const C=()=>(<Button>x</Button>);`);
    const res = processEdits(project, {
      file, line: 1, column: 14,
      edits: [{ kind: "style", property: "color", value: "red" }],
    });
    expect(res.status).toBe("applied");
  });
});
