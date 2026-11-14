// Component syntax error. line is the relative line number inside the fenced block (1-based); render.js converts it to the source line.
export class ComponentError extends Error {
  line: number;
  constructor(message: string, line = 0) {
    super(message);
    this.name = "ComponentError";
    this.line = line;
  }
}

// Split fenced-block text into non-empty lines, keeping relative line numbers; supports whole-line comments starting with #.
export function contentLines(text: string) {
  return String(text)
    .split("\n")
    .map((raw, i) => ({ raw, text: raw.trim(), line: i + 1 }))
    .filter((l) => l.text && !l.text.startsWith("//"));
}

// Split fields on | and trim them.
export function fields(text: string) {
  return text.split("|").map((s) => s.trim());
}
