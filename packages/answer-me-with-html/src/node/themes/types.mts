export type ThemeScope = "page" | "video";
export type CssTokens = Record<string, string>;
export interface TokenGroups {
  common: CssTokens;
  light?: CssTokens;
  dark?: CssTokens;
}
export interface Theme {
  name: string;
  summary: string;
  label: Record<string, string>;
  scope: readonly ThemeScope[];
  mode?: "light" | "dark";
  tokens: TokenGroups;
  css?: string;
  font?: string;
  user?: boolean;
  ownFont?: boolean;
  video?: { tokens?: Partial<TokenGroups>; css?: string; rtlCss?: string };
}
export type CandidateTokens = Record<string, unknown>;
export interface CandidateTokenGroups {
  common: CandidateTokens;
  light?: CandidateTokens;
  dark?: CandidateTokens;
}
export interface ThemeCandidate extends Omit<Theme, "tokens" | "video"> {
  tokens: CandidateTokenGroups;
  video?: { tokens?: Partial<CandidateTokenGroups>; css?: string; rtlCss?: string };
}
export function isTheme(candidate: ThemeCandidate): candidate is Theme {
  const groups = [candidate.tokens, candidate.video?.tokens];
  return groups.every(
    (tokens) =>
      !tokens ||
      [tokens.common, tokens.light, tokens.dark].every(
        (group) => !group || Object.values(group).every((value) => typeof value === "string"),
      ),
  );
}
export interface ThemeProblem {
  file: string;
  reason: string;
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
