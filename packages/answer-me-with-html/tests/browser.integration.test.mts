import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { openPage, findChrome } from "../src/node/chrome.mjs";
import { skillFixture } from "./fixture.mjs";
import { browserTestRequirement } from "./browser-requirements.mjs";

const skip = browserTestRequirement(process.env.AM_E2E, findChrome);
const draft =
  "---\nlang: en\ntitle: Browser test\n---\n## Decision\nUse plain text and $x^2$.\n\n```ask\nChoose a store\n* Redis\n- Memcached\n```\n\n```flow\nA -> B\n```\n\n```js\nconst answer = 42;\n```\n\n## Data\n| Name | Value |\n| --- | --- |\n| B | 2 |\n| A | 1 |\n{table sort filter}\n";

async function renderPage(language: string): Promise<string> {
  const skill = await skillFixture();
  const file = join(skill, `browser-${language}.html`);
  const result = spawnSync(
    process.execPath,
    [join(skill, "scripts/am.mjs"), "render", "-", "--no-open", "-o", file],
    {
      encoding: "utf8",
      input: draft.replace("lang: en", `lang: ${language}`),
      env: { ...process.env, AM_HOME: join(skill, "home"), AM_NO_UPDATE_CHECK: "1", CI: "1" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return file;
}

test(
  "browser desktop/mobile: controls, reply, diagrams, formula and CSP",
  { skip, timeout: 60000 },
  async () => {
    const file = await renderPage("en");
    const browser = await openPage(pathToFileURL(file).href, { width: 1280, height: 900 });
    try {
      const initial = await browser.evaluate(`(() => ({
      theme: document.documentElement.dataset.theme,
      scaleHidden: document.querySelector('[data-am="scale-up"]').hidden,
      diagrams: document.querySelectorAll('.am-diagram > svg').length,
      update: !!document.querySelector('[data-am="update"]'),
      brand: !!document.querySelector('.am-colophon, .amv-brand'),
    }))()`);
      assert.deepEqual(initial, {
        theme: "blueprint",
        scaleHidden: false,
        diagrams: 1,
        update: false,
        brand: false,
      });
      assert.equal(
        await browser.evaluate(`(() => {
          const math = document.querySelector('math');
          return !!math && math.getBoundingClientRect().width > 0 && math.textContent.includes('x');
        })()`),
        true,
      );
      assert.deepEqual(
        await browser.evaluate(`new Promise((resolve) => {
          let blocked = false;
          const listener = (event) => { if (event.violatedDirective.startsWith('script-src')) blocked = true; };
          document.addEventListener('securitypolicyviolation', listener);
          const script = document.createElement('script');
          script.textContent = 'window.__unexpectedInlineScript = true';
          document.body.append(script);
          setTimeout(() => {
            document.removeEventListener('securitypolicyviolation', listener);
            script.remove();
            resolve({ blocked, executed: window.__unexpectedInlineScript === true });
          }, 100);
        })`),
        { blocked: true, executed: false },
      );
      assert.equal(
        await browser.evaluate(`(() => {
      const select = document.querySelector('select[data-am="theme"]');
      select.value = 'paper'; select.dispatchEvent(new Event('change'));
      document.querySelector('[data-am="scale-up"]').click();
      return document.documentElement.dataset.theme === 'paper' && Number(getComputedStyle(document.documentElement).getPropertyValue('--am-scale')) > 1;
    })()`),
        true,
      );
      assert.equal(
        await browser.evaluate(`(async () => {
      let copied = ''; navigator.clipboard.writeText = async (text) => { copied = text; };
      document.querySelector('[data-am="copy-code"]').click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return copied;
    })()`),
        "const answer = 42;",
      );
      assert.equal(
        await browser.evaluate(`(() => {
      const input = document.querySelector('.am-ask input'); input.checked = true; input.dispatchEvent(new Event('change', {bubbles:true}));
      document.querySelector('[data-am="reply"]').click();
      return document.querySelector('.am-reply').textContent.includes('Redis');
    })()`),
        true,
      );
      assert.equal(
        await browser.evaluate(`(() => {
      const table = document.querySelector('table[data-am-table]');
      table.querySelector('.am-table-sort').click();
      return table.tBodies[0].rows[0].cells[0].textContent;
    })()`),
        "A",
      );
      assert.deepEqual(
        await browser.evaluate(`(() => {
      const input = document.querySelector('[data-am-table-filter]'); input.value = 'B'; input.dispatchEvent(new Event('input'));
      return [...document.querySelectorAll('table[data-am-table] tbody tr')].filter((row) => !row.hidden).map((row) => row.cells[0].textContent);
    })()`),
        ["B"],
      );
      assert.equal(
        await browser.evaluate(`(() => {
      document.querySelector('.am-diagram-expand').click();
      const opened = !document.querySelector('.am-lightbox').hidden;
      document.querySelector('.am-lightbox-close').click();
      return opened && document.querySelector('.am-lightbox').hidden;
    })()`),
        true,
      );
      await browser.page("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      assert.equal(
        await browser.evaluate(
          `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.documentElement.scrollWidth <= innerWidth + 1))))`,
        ),
        true,
      );
      const screenshot = await browser.page("Page.captureScreenshot", { format: "png" });
      await writeFile(
        join(await skillFixture(), "browser-mobile.png"),
        Buffer.from(screenshot.data, "base64"),
      );
    } finally {
      await browser.close();
    }
  },
);

test(
  "browser RTL and compiled video runtime load without script exceptions",
  { skip, timeout: 60000 },
  async () => {
    const rtl = await renderPage("he");
    const page = await openPage(pathToFileURL(rtl).href, { width: 800, height: 700 });
    try {
      assert.equal(await page.evaluate("document.documentElement.dir"), "rtl");
      assert.equal(
        await page.evaluate(`!!document.querySelector('.am-toolbar [data-am="reply"]')`),
        true,
      );
    } finally {
      await page.close();
    }
    const skill = await skillFixture();
    const video = join(skill, "video.html");
    const result = spawnSync(
      process.execPath,
      [join(skill, "scripts/am.mjs"), "video", "-", "--voice", "off", "--no-open", "-o", video],
      {
        input: "---\nlang: en\ntitle: Motion\n---\n## One\nA short line.\n\n> First line.\n",
        encoding: "utf8",
        env: { ...process.env, AM_HOME: join(skill, "home"), AM_NO_UPDATE_CHECK: "1", CI: "1" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(video, "utf8");
    assert.doesNotMatch(html, /class="amv-brand"|<meta name="generator"/);
    const player = await openPage(pathToFileURL(video).href, { width: 960, height: 720 });
    try {
      assert.equal(await player.evaluate(`typeof window.__amvWebm.WebmWriter`), "function");
      assert.equal(await player.evaluate(`typeof window.__amv !== 'undefined'`), true);
    } finally {
      await player.close();
    }
  },
);
