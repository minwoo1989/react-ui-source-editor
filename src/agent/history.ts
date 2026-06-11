// src/agent/history.ts

interface EditRecord { file: string; before: string; after: string; }

export interface History {
  /** Record an applied edit; clears the redo stack. */
  record(file: string, before: string, after: string): void;
  /** Pop the newest undo record; returns the content to write (before), or null. */
  undo(): { file: string; content: string } | null;
  /** Pop the newest redo record; returns the content to write (after), or null. */
  redo(): { file: string; content: string } | null;
  state(): { canUndo: boolean; canRedo: boolean };
}

/** In-memory global undo/redo stack for applied edits. */
export function createHistory(): History {
  const undoStack: EditRecord[] = [];
  const redoStack: EditRecord[] = [];
  return {
    record(file, before, after) {
      undoStack.push({ file, before, after });
      redoStack.length = 0;
    },
    undo() {
      const r = undoStack.pop();
      if (!r) return null;
      redoStack.push(r);
      return { file: r.file, content: r.before };
    },
    redo() {
      const r = redoStack.pop();
      if (!r) return null;
      undoStack.push(r);
      return { file: r.file, content: r.after };
    },
    state() {
      return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
    },
  };
}
