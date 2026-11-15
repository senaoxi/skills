import en from "./en.ts";
export interface LanguageEntry {
  id: string;
  metaKeys?: Record<string, string>;
  language: string;
  script?: string;
  voice?: { say: string; espeak: string };
  langs?: string[];
  fonts?: { sans: string; serif: string };
  ui: typeof en.ui;
  videoUi: typeof en.videoUi;
  deltaCounts?: { added: string; removed: string; changed: string };
}
