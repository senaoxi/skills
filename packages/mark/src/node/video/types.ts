import type { Attrs, Block, DraftDoc, Meta } from "../model.ts";
export interface VoiceOptions {
  language?: string;
  voice?: string | null;
}
export interface TtsProvider {
  name: string;
  voice: string;
  id: string;
  concurrency?: number;
  usesLanguage?: boolean;
  voiceFor?: (language: string) => string | null;
  synth(text: string, options?: VoiceOptions): Promise<Int16Array>;
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export const errorName = (error: unknown): string => (error instanceof Error ? error.name : "");
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export interface Beat {
  raw: string;
  text: string;
  focus: string | null;
  line: number;
}
export interface VideoScene {
  id: string;
  title: string;
  line: number;
  attrs: Attrs;
  blocks: Block[];
  beats: Beat[];
}
export interface VideoDraft {
  meta: Meta;
  doc: DraftDoc;
  intro: Block[];
  introBeats: Beat[];
  scenes: VideoScene[];
}
export interface TimedBeat {
  text: string;
  focus: string | null;
  start: number;
  end: number;
}
export interface TimelinePart {
  id?: string;
  title?: string;
  start: number;
  end: number;
  beats: TimedBeat[];
}
export interface Timeline {
  duration: number;
  title: TimelinePart;
  scenes: TimelinePart[];
}
