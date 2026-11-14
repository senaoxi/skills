export function browserTestRequirement(
  runFlag: string | undefined,
  detectBrowser: () => string | null,
): string | false {
  if (runFlag !== "1") return "Set AM_E2E=1 to run real Chrome interaction tests.";
  if (!detectBrowser())
    throw new Error("AM_E2E=1 requires Chrome; set AM_CHROME to the browser executable.");
  return false;
}
