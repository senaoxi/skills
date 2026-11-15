import { test } from "node:test";
import assert from "node:assert/strict";
import { browserTestRequirement } from "./browser-requirements.ts";

test("optional browser tests skip without trying to find Chrome", () => {
  for (const flag of [undefined, "", "0"]) {
    assert.match(
      browserTestRequirement(flag, () => {
        assert.fail("Optional browser tests must not require Chrome discovery");
      }) || "",
      /Set AM_E2E=1/,
    );
  }
});

test("required browser tests fail when Chrome is missing", () => {
  assert.throws(
    () => browserTestRequirement("1", () => null),
    /AM_E2E=1 requires Chrome; set AM_CHROME/,
  );
});

test("required browser tests run when Chrome is found", () => {
  assert.equal(
    browserTestRequirement("1", () => "/usr/bin/google-chrome"),
    false,
  );
});
