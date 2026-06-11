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

  it("error message names the tag and line when no element is found", () => {
    const project = projectWith(`const x = 1;`);
    const req: EditRequest = {
      file: "/F.tsx", line: 1, column: 1, tag: "button",
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message).toMatch(/no button element near line 1/);
  });

  it("applies an edit when the reported line is shifted (resolver corrects it)", () => {
    const project = projectWith([
      "import x from 'y';",                          // 1
      "export const C = () => (",                    // 2
      '  <Button type="default" />',                 // 3  <Button col 3
      ");",                                          // 4
    ].join("\n"));
    const req: EditRequest = {
      file: "/F.tsx", line: 13, column: 3, tag: "Button", // line 13 = +10 shift from true line 3
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("applied");
    if (res.status === "applied") expect(res.newText).toContain(`type="primary"`);
  });

  it("suggested instruction reports the resolved line, not the shifted one", () => {
    const project = projectWith([
      "import x from 'y';",                          // 1
      "export const C = () => (",                    // 2
      "  <Button type={dynamic} />",                 // 3  dynamic prop -> unsafe -> suggested
      ");",                                          // 4
    ].join("\n"));
    const req: EditRequest = {
      file: "/F.tsx", line: 13, column: 3, tag: "Button",
      edits: [{ kind: "prop", name: "type", value: "primary" }],
    };
    const res = processEdits(project, req);
    expect(res.status).toBe("suggested");
    if (res.status === "suggested") {
      expect(res.instruction).toContain(":3,");   // resolved line 3
      expect(res.instruction).not.toContain(":13,"); // NOT the shifted line
    }
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
