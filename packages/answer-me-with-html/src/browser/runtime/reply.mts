import { replyText } from "../../shared/runtime/reply-text.mjs";
import { textWithMath } from "./math-text.mjs";
import { replyViewHtml } from "./reply-view.mjs";
import { must, parseJson, replyLabels, pageState, replyState, readProperty } from "../types.mjs";
import type { StatePatch, ReplyState } from "../types.mjs";
// Answer on the page: every panel gets a Comment box, and the Reply button collects the ask answers, the comments and the remarks
// into one Markdown reply (replyText) to copy back to the agent. Answers and comments stay in localStorage across reloads.
// The remark script (remark.js) adds the blocks the reader marked, through window.__amRemarkData, and tells this script about a change
// with an "am-remark-change" event on the document.
// The Reply sheet shows the reply drawn (replyViewHtml) with the Markdown that Copy copies under a fold. Once the reader has given any
// input, a bar at the bottom of the page shows the counts and copies the reply in one click, so there is no trip to the top-right button.
const replyBtn = document.querySelector<HTMLElement>('[data-am="reply"]');
const COMMENT_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
if (replyBtn) {
  const ui = replyLabels(parseJson(replyBtn.dataset.ui));
  const storeKey = `am-reply:${location.pathname}`;
  // A page served by `am serve` runs without localStorage and the phone may discard its tab, so it keeps the answers on the
  // server: data-am-save names the write route and data-am-state carries what the server already holds for this page version.
  const serve = (() => {
    const { amSave: save, amState: state } = document.body?.dataset ?? {};
    if (!save) return null;
    try {
      return { save, restored: state ? pageState(parseJson(state)) : null };
    } catch {
      return { save, restored: null };
    }
  })();
  let saveTimer = 0;
  let pendingPatch: StatePatch | null = null;
  const sendSave = (patch: StatePatch) => {
    if (!serve) return;
    fetch(serve.save, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      keepalive: true,
    }).catch(() => {}); // a page that cannot reach the server keeps its state until it closes, as before
  };
  // Typing must not put one request per keystroke on the server; localStorage is written at once, the network follows.
  const saveSoon = (patch: StatePatch) => {
    clearTimeout(saveTimer);
    pendingPatch = patch;
    saveTimer = setTimeout(() => {
      pendingPatch = null;
      sendSave(patch);
    }, 400);
  };
  // A hidden or closing page sends the change it still holds, before the timer can run.
  const flushSave = () => {
    if (!pendingPatch) return;
    clearTimeout(saveTimer);
    sendSave(pendingPatch);
    pendingPatch = null;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("pagehide", flushSave);
  const panels = [...document.querySelectorAll<HTMLElement>(".am-panel")];
  const asks = [...document.querySelectorAll<HTMLElement>(".am-ask")];
  // Answers are saved by question text, so they still match after am patch has renumbered the asks.
  // Page text without the word joiners a right-to-left page puts after a Hebrew prefix hyphen (src/bidi.js): the reply and the saved
  // answers hold the text as the draft wrote it, a formula too (src/runtime/math-text.js).
  const WJ = new RegExp(String.fromCharCode(0x2060), "g");
  const textOf = (el: Node | null | undefined) =>
    el ? textWithMath(el).replace(WJ, "").trim() : null;
  const keyOf = (ask: HTMLElement) =>
    textOf(ask.querySelector<HTMLElement>("legend")) ?? ask.dataset.ask ?? "";
  const touched = new Set<HTMLElement>();
  const boxes = new Map<string, HTMLTextAreaElement>();
  // The bar is built below with the sheet; the handlers that change the counts only call this.
  let refreshBar = () => {};
  // The textarea a failed copy keeps selected, so the reader can still use the keyboard shortcut.
  let stuck: HTMLTextAreaElement | null = null;

  const load = (): ReplyState => {
    if (serve?.restored?.reply) return serve.restored.reply;
    try {
      return replyState(parseJson(localStorage.getItem(storeKey)));
    } catch {
      return {};
    }
  };
  const save = () => {
    const state = {
      asks: Object.fromEntries(
        asks.map((a) => [keyOf(a), { picked: picked(a), touched: touched.has(a) }]),
      ),
      comments: Object.fromEntries(
        [...boxes].map(([id, box]) => [id, box.value]).filter(([, text]) => text.trim()),
      ),
    };
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      // Storage may be off (private window, file:// policy); answers then last until the page closes.
    }
    if (serve) saveSoon({ reply: state });
  };
  const picked = (ask: HTMLElement) =>
    [...ask.querySelectorAll<HTMLInputElement>("input")]
      .filter((i) => i.checked)
      .map((i) => i.value);
  const panelOf = (el: Element) => {
    const panel = el.closest(".am-panel");
    return {
      id: panel?.id.replace(/^panel-/, "") ?? "",
      title: textOf(panel?.querySelector<HTMLElement>(".am-panel-head h2")) ?? "",
    };
  };

  const saved = load();
  for (const ask of asks) {
    const inputs = [...ask.querySelectorAll<HTMLInputElement>("input")];
    const state = readProperty(saved.asks, keyOf(ask));
    const storedPicked = readProperty(state, "picked");
    // A saved answer applies only while every picked option still exists on the page, and only if the reader clicked: older versions started
    // with the suggestion selected and saved it untouched, and that state must come back unselected.
    if (
      readProperty(state, "touched") &&
      Array.isArray(storedPicked) &&
      storedPicked.every((v: unknown) => inputs.some((i) => i.value === v))
    ) {
      for (const input of inputs) input.checked = storedPicked.includes(input.value);
      touched.add(ask);
    }
    // A click counts even on the option that is already picked: the reader confirms the suggestion.
    const answer = () => {
      touched.add(ask);
      save();
      refreshBar();
    };
    ask.addEventListener("change", answer);
    ask.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.matches("input")) answer();
    });
  }

  for (const panel of panels) {
    const id = panel.id.replace(/^panel-/, "");
    // An icon only: narrow panels have no room for a word next to the title.
    const btn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "am-comment-btn",
      title: ui.comment,
      innerHTML: COMMENT_ICON,
    });
    btn.setAttribute("aria-label", `${ui.comment} ${id}`);
    btn.setAttribute("aria-expanded", "false");
    const wrap = Object.assign(document.createElement("div"), {
      className: "am-comment",
      hidden: true,
    });
    const box = Object.assign(document.createElement("textarea"), {
      rows: 3,
      placeholder: ui.commentHint,
      value: String(readProperty(saved.comments, id) ?? ""),
    });
    box.setAttribute("aria-label", `${ui.comment} ${id}`);
    wrap.append(box);
    const show = (open: boolean) => {
      wrap.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    };
    btn.addEventListener("click", () => {
      show(wrap.hidden);
      if (!wrap.hidden) box.focus();
    });
    box.addEventListener("input", () => {
      btn.classList.toggle("am-comment-btn--on", Boolean(box.value.trim()));
      save();
      refreshBar();
    });
    btn.classList.toggle("am-comment-btn--on", Boolean(box.value.trim()));
    if (box.value.trim()) show(true);
    (panel.querySelector<HTMLElement>(".am-panel-head") ?? panel).append(btn);
    panel.append(wrap);
    boxes.set(id, box);
  }

  const sheet = document.createElement("dialog");
  sheet.className = "am-reply";
  sheet.setAttribute("aria-label", ui.title);
  sheet.innerHTML =
    '<div class="am-reply-head"><strong></strong><span></span></div><div class="am-reply-view" tabindex="0"></div><details class="am-reply-raw"><summary></summary><textarea readonly rows="10"></textarea></details><div class="am-reply-actions"><button type="button" class="am-btn" data-act="copy"></button><button type="button" class="am-btn" data-act="close"></button></div>';
  must(sheet.querySelector<HTMLElement>("strong")).textContent = ui.title;
  must(sheet.querySelector<HTMLElement>("span")).textContent = ui.hint;
  must(sheet.querySelector<HTMLElement>("summary")).textContent = ui.raw;
  const view = must(sheet.querySelector<HTMLElement>(".am-reply-view"));
  const raw = must(sheet.querySelector<HTMLDetailsElement>("details"));
  const text = must(sheet.querySelector<HTMLTextAreaElement>("textarea"));
  const copy = must(sheet.querySelector<HTMLButtonElement>('[data-act="copy"]'));
  const close = must(sheet.querySelector<HTMLButtonElement>('[data-act="close"]'));
  copy.textContent = ui.copy;
  close.textContent = ui.close;
  document.body.append(sheet);

  const compose = () => {
    const decisions = asks.map((ask) => ({
      panel: panelOf(ask).id,
      question: textOf(ask.querySelector<HTMLElement>("legend")) ?? "",
      picked: picked(ask),
      suggested: [...ask.querySelectorAll<HTMLInputElement>("input[data-suggested]")].map(
        (i) => i.value,
      ),
      touched: touched.has(ask),
    }));
    const comments = [...boxes].map(([id, box]) => ({
      panel: id,
      title: panelOf(box).title,
      text: box.value,
    }));
    const remarks = window.__amRemarkData?.() ?? [];
    const empty = !decisions.length && !comments.some((c) => c.text.trim()) && !remarks.length;
    const title = textOf(document.querySelector<HTMLElement>(".am-head h1")) ?? document.title;
    return empty
      ? ""
      : replyText({
          title,
          decisions,
          comments,
          remarks,
          ui,
          rtl: document.documentElement.dir === "rtl",
        });
  };

  // The text goes through the clipboard API; a page the browser treats as insecure (file://) falls back to selecting a temporary
  // textarea, because the sheet's own textarea can sit inside a closed fold, where it cannot be selected.
  // That fallback reports whether it worked. When it does not, the text stays selected (so Cmd/Ctrl+C still copies it) and the
  // button says what to do instead of showing the "Copied ✓" label the reader cannot trust.
  const copyText = async (str: string, btn: HTMLButtonElement) => {
    stuck?.remove();
    stuck = null;
    try {
      await navigator.clipboard.writeText(str);
      // The close_after_reply script (close-after-reply.js) closes the tab once the reply is on the clipboard.
      document.dispatchEvent(new Event("am-reply-copied"));
    } catch {
      const tmp = Object.assign(document.createElement("textarea"), { value: str });
      tmp.style.cssText = "position:fixed;top:-100px;opacity:0";
      // Inside the sheet while it is open: while a modal dialog is open the rest of the document cannot take focus, so a textarea
      // in the body can be selected but not focused, and the keyboard shortcut the reader is told to press would copy nothing.
      // The bottom bar copies while the sheet is closed, and a closed dialog is not rendered, so there the textarea goes in the body.
      (sheet.open ? sheet : document.body).append(tmp);
      tmp.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      if (!copied) {
        stuck = tmp;
        btn.textContent = ui.copyFailed;
        setTimeout(() => {
          btn.textContent = ui.copy;
        }, 3000);
        return;
      }
      tmp.remove();
    }
    btn.textContent = ui.done;
    setTimeout(() => {
      btn.textContent = ui.copy;
    }, 1400);
  };

  const open = () => {
    const reply = compose();
    if (reply) view.innerHTML = replyViewHtml(reply);
    else view.textContent = ui.empty;
    view.scrollTop = 0;
    text.value = reply;
    raw.open = false;
    raw.hidden = !reply;
    copy.disabled = !reply;
    if (sheet.showModal) sheet.showModal();
    else sheet.setAttribute("open", "");
    (reply ? copy : close).focus();
  };
  replyBtn.addEventListener("click", open);
  close.addEventListener("click", () =>
    sheet.close ? sheet.close() : sheet.removeAttribute("open"),
  );
  // A failed copy leaves the text selected for Cmd/Ctrl+C; closing the sheet drops that textarea.
  sheet.addEventListener("close", () => {
    stuck?.remove();
    stuck = null;
  });
  copy.addEventListener("click", () => copyText(text.value, copy));

  const bar = Object.assign(document.createElement("div"), {
    className: "am-reply-bar",
    hidden: true,
  });
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", ui.title);
  const summary = Object.assign(document.createElement("span"), {
    className: "am-reply-bar-count",
  });
  summary.setAttribute("aria-live", "polite");
  const preview = Object.assign(document.createElement("button"), {
    type: "button",
    className: "am-btn",
    textContent: ui.preview,
  });
  const barCopy = Object.assign(document.createElement("button"), {
    type: "button",
    className: "am-btn am-btn--reply",
    textContent: ui.copy,
  });
  preview.addEventListener("click", open);
  barCopy.addEventListener("click", () => copyText(compose(), barCopy));
  bar.append(summary, preview, barCopy);
  document.body.append(bar);

  // The bar shows only the counts that are above zero, and only once there is any input at all.
  refreshBar = () => {
    const counts = {
      answered: touched.size,
      comments: [...boxes.values()].filter((box) => box.value.trim()).length,
      remarks: (window.__amRemarkData?.() ?? []).length,
    };
    const parts = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => ui.count[kind].replace("{n}", String(n)));
    summary.textContent = parts.join(" · ");
    bar.hidden = !parts.length;
    document.body.classList.toggle("am-has-reply-bar", parts.length > 0);
  };
  document.addEventListener("am-remark-change", () => refreshBar());
  // Saved remarks are restored by remark.js, which runs after this script in the same <script> element: its data is not there yet.
  // A microtask runs when that whole element has finished, so the first count includes them.
  queueMicrotask(() => refreshBar());
}
