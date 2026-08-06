import type { EditorDraftSnapshot } from "./editorDraft";

/**
 * The only protocol the editor shell needs from a page-level editor.
 *
 * Page components own their draft and dirty facts. The shell only coordinates
 * the current session and asks it to save or discard before navigation.
 */
export interface EditorSession {
  hasUnsavedChanges: () => boolean;
  getDraftSnapshot: () => EditorDraftSnapshot | null;
  save: () => Promise<boolean>;
  discard: () => Promise<void>;
}
