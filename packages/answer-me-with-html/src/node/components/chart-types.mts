export type ChartType = "bar" | "line" | "pie";
export interface ChartOptions {
  type: ChartType;
  horizontal: boolean;
  unit: string;
}
export interface ChartRow {
  label: string;
  values: number[];
  hi: boolean;
  line: number;
}
export interface ChartData {
  series: string[] | null;
  rows: ChartRow[];
}
export interface ChartWords {
  name: string;
  data: string;
  value: string;
  share: string;
}
export interface DrawOptions {
  unit?: string;
  dir?: string;
  label: string;
}
export interface ChartRange {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}
export interface AxisModel {
  range: ChartRange;
  rtl: boolean;
  dir: string;
  tick: (value: number) => string;
}
export interface ChartModel extends AxisModel {
  rows: ChartRow[];
  count: number;
  names: string[];
  unit: string;
  anyHi: boolean;
}
export interface BarModel extends ChartModel {
  labels: boolean;
}
export interface LineModel extends ChartModel {
  carries: (row: ChartRow) => boolean;
}
export interface LegendItem {
  k: number;
  name: string;
  x: number;
  y: number;
  w: number;
}
export interface Legend {
  items: LegendItem[];
  height: number;
  width?: number;
}
export type CategoryPlan =
  | { lines: (string[] | null)[]; shown?: never }
  | { lines: null; shown: string[] };
export interface DrawingDirection {
  rtl: boolean;
  dir: string;
}
export interface MirroredDirection extends DrawingDirection {
  X: (value: number) => number;
}
