#!/usr/bin/env node
// Built from strict TypeScript modules. See NOTICE for provenance and complete bundled terms.
import path, { join, resolve } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { runInThisContext } from "node:vm";
import { homedir } from "node:os";
// src/node/conversation-bundle.ts
const limits = {
	json: 33554432,
	html: 67108864
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invalid$1 = () => /* @__PURE__ */ new Error("Conversation bundle is missing, invalid, or modified.");
function bounded(bytes) {
	if (!Buffer.isBuffer(bytes.json) || !Buffer.isBuffer(bytes.html) || !bytes.json.length || !bytes.html.length || bytes.json.length > limits.json || bytes.html.length > limits.html) throw invalid$1();
}
async function writeConversationBundle(home, bytes) {
	bounded(bytes);
	const directory = path.join(home, "conversation-captures");
	let bundle;
	try {
		await mkdir(directory, {
			recursive: true,
			mode: 448
		});
		if (!(await lstat(directory)).isDirectory()) throw invalid$1();
		bundle = await mkdtemp(path.join(directory, "capture-"));
		await writeFile(path.join(bundle, "conversation.json"), bytes.json, {
			mode: 256,
			flag: "wx"
		});
		await writeFile(path.join(bundle, "conversation.html"), bytes.html, {
			mode: 256,
			flag: "wx"
		});
		await writeFile(path.join(bundle, "manifest.json"), JSON.stringify({
			schemaVersion: 1,
			json: digest(bytes.json),
			html: digest(bytes.html)
		}) + "\n", {
			mode: 256,
			flag: "wx"
		});
		return bundle;
	} catch {
		if (bundle) await rm(bundle, {
			recursive: true,
			force: true
		}).catch(() => {});
		throw invalid$1();
	}
}
// src/node/conversation-context.ts
const CHATGPT_ORIGIN = "https://chatgpt.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_PATH = /^\/c\/([^/?#]+)\/?$/;
function isUuid(value) {
	return typeof value === "string" && value.length === 36 && UUID.test(value);
}
function isConversationId(value) {
	return isUuid(value);
}
function parseId(input) {
	const canonical = typeof input === "string" ? input.toLowerCase() : void 0;
	return isConversationId(canonical) ? canonical : void 0;
}
function parseUrl(input) {
	if (typeof input !== "string") return void 0;
	if (input.slice(0, 19).toLowerCase() !== "https://chatgpt.com") return void 0;
	const pathname = input.slice(19);
	const match = PRIVATE_PATH.exec(pathname);
	return match?.[0] === pathname ? parseId(match[1]) : void 0;
}
function resolved(conversationId, source) {
	return {
		status: "resolved",
		context: {
			provider: "chatgpt-web",
			conversationId,
			conversationUrl: `${CHATGPT_ORIGIN}/c/${conversationId}`,
			source
		}
	};
}
function isRecord$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function resolveHostContext(input) {
	if (input == null) return {
		status: "unresolved",
		reason: "conversation_missing"
	};
	if (!isRecord$1(input) || input.provider !== "chatgpt-web") return {
		status: "unresolved",
		reason: "conversation_context_invalid"
	};
	const { conversationId, conversationUrl, browserTabs } = input;
	const id = parseId(conversationId);
	const urlId = parseUrl(conversationUrl);
	if (conversationId !== void 0 && !id || conversationUrl !== void 0 && !urlId) return {
		status: "unresolved",
		reason: "conversation_context_invalid"
	};
	if (id && urlId && id !== urlId) return {
		status: "unresolved",
		reason: "conversation_conflict"
	};
	const current = id ?? urlId;
	if (current) return resolved(current, "host-context");
	if (browserTabs !== void 0 && (!Array.isArray(browserTabs) || !browserTabs.every(isRecord$1))) return {
		status: "unresolved",
		reason: "conversation_context_invalid"
	};
	const activeTabs = browserTabs?.filter((tab) => tab.active === true) ?? [];
	if (activeTabs.length > 1) return {
		status: "unresolved",
		reason: "conversation_ambiguous"
	};
	const activeId = parseUrl(activeTabs[0]?.url);
	return activeId ? resolved(activeId, "browser-active-tab") : {
		status: "unresolved",
		reason: "conversation_missing"
	};
}
function resolveConversationContext({ explicit, hostContext } = {}) {
	if (explicit === void 0) return resolveHostContext(hostContext);
	const explicitId = parseId(explicit) ?? parseUrl(explicit);
	if (!explicitId) return {
		status: "unresolved",
		reason: "input_invalid"
	};
	const automatic = resolveHostContext(hostContext);
	if (automatic.status === "resolved" && automatic.context.conversationId !== explicitId) return {
		status: "unresolved",
		reason: "conversation_conflict"
	};
	if (automatic.status === "unresolved" && (automatic.reason === "conversation_conflict" || automatic.reason === "conversation_context_invalid")) return automatic;
	return resolved(explicitId, "user-input");
}
// ../../node_modules/.pnpm/marked@18.1.2/node_modules/marked/lib/marked.esm.js
/**
* marked v18.1.2 - a markdown parser
* Copyright (c) 2018-2026, MarkedJS. (MIT License)
* Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
* https://github.com/markedjs/marked
*/
/**
* DO NOT EDIT THIS FILE
* The code in this file is generated from files in ./src/
*/
function v() {
	return {
		async: !1,
		breaks: !1,
		extensions: null,
		gfm: !0,
		hooks: null,
		pedantic: !1,
		renderer: null,
		silent: !1,
		tokenizer: null,
		walkTokens: null
	};
}
var y = v();
function ee(a) {
	y = a;
}
var B = { exec: () => null };
function I(a) {
	let e = [];
	return (t) => {
		let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
		return s || (s = a(n), e[n] = s), s;
	};
}
function c(a, e = "") {
	let t = typeof a == "string" ? a : a.source, n = {
		replace: (s, r) => {
			let o = typeof r == "string" ? r : r.source;
			return o = o.replace(T.caret, "$1"), t = t.replace(s, o), n;
		},
		getRegex: () => new RegExp(t, e)
	};
	return n;
}
var Me = ((a = "") => {
	try {
		return !!new RegExp("(?<=1)(?<!1)" + a);
	} catch {
		return !1;
	}
})();
var T = {
	codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
	outputLinkReplace: /\\([\[\]])/g,
	indentCodeCompensation: /^(\s+)(?:```)/,
	beginningSpace: /^\s+/,
	endingHash: /#$/,
	startingSpaceChar: /^ /,
	endingSpaceChar: / $/,
	endingSpaceTabChar: /[ \t]$/,
	nonSpaceChar: /[^ ]/,
	newLineCharGlobal: /\n/g,
	tabCharGlobal: /\t/g,
	leadingSpaceTab: /^[ \t]+/,
	multipleSpaceGlobal: /\s+/g,
	blankLine: /^[ \t]*$/,
	doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
	blockquoteStart: /^ {0,3}>/,
	blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
	blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
	blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
	listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
	listIsTask: /^\[[ xX]\] +\S/,
	listReplaceTask: /^\[[ xX]\] +/,
	listTaskCheckbox: /\[[ xX]\]/,
	anyLine: /\n.*\n/,
	hrefBrackets: /^<(.*)>$/,
	tableDelimiter: /[:|]/,
	tableAlignChars: /^\||\| *$/g,
	tableRowBlankLine: /\n[ \t]*$/,
	tableAlignRight: /^ *-+: *$/,
	tableAlignCenter: /^ *:-+: *$/,
	tableAlignLeft: /^ *:-+ *$/,
	startATag: /^<a /i,
	endATag: /^<\/a>/i,
	startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
	endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
	startAngleBracket: /^</,
	endAngleBracket: />$/,
	pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
	unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
	numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
	numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	escapeTest: /[&<>"']/,
	escapeReplace: /[&<>"']/g,
	escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
	escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	caret: /(^|[^\[])\^/g,
	percentDecode: /%25/g,
	findPipe: /\|/g,
	splitPipe: / \|/,
	slashPipe: /\\\|/g,
	carriageReturn: /\r\n|\r/g,
	spaceLine: /^ +$/gm,
	notSpaceStart: /^\S*/,
	endingNewline: /\n$/,
	listItemRegex: (a) => new RegExp(`^( {0,3}${a})((?:[	 ][^\\n]*)?(?:\\n|$))`),
	nextBulletRegex: I((a) => new RegExp(`^ {0,${a}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),
	hrRegex: I((a) => new RegExp(`^ {0,${a}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)),
	fencesBeginRegex: I((a) => new RegExp(`^ {0,${a}}(?:\`\`\`|~~~)`)),
	headingBeginRegex: I((a) => new RegExp(`^ {0,${a}}#{1,6}(?:\\s|$)`)),
	pedanticHeadingBeginRegex: I((a) => new RegExp(`^ {0,${a}}#`)),
	htmlBeginRegex: I((a) => new RegExp(`^ {0,${a}}(?:</?(?:${K})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, "i")),
	blockquoteBeginRegex: I((a) => new RegExp(`^ {0,${a}}>`))
};
var Ce = /^(?:[ \t]*(?:\n|$))+/;
var Ee = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var Ie = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var U = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Be = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var ne = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var me = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var xe = c(me).replace(/bull/g, ne).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var De = c(me).replace(/bull/g, ne).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var re = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var qe = /^[^\n]+/;
var se = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Ze = c(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", se).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var ve = c(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, ne).getRegex();
var K = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var ie = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var He = c("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ie).replace("tag", K).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var be = (a) => c(re).replace("hr", U).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", a).replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", K).getRegex();
var Ge = be(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var Ne = be(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var oe = {
	blockquote: c(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace("paragraph", Ne).getRegex(),
	code: Ee,
	def: Ze,
	fences: Ie,
	heading: Be,
	hr: U,
	html: He,
	lheading: xe,
	list: ve,
	newline: Ce,
	paragraph: Ge,
	table: B,
	text: qe
};
var ke = c("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", U).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", K).getRegex();
var je = {
	...oe,
	lheading: De,
	table: ke,
	paragraph: c(re).replace("hr", U).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", ke).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", K).getRegex()
};
var Fe = {
	...oe,
	html: c(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", ie).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
	def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
	heading: /^(#{1,6})(.*)(?:\n+|$)/,
	fences: B,
	lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
	paragraph: c(re).replace("hr", U).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", xe).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
};
var Ue = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ke = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var Re = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
var We = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var $ = /[\p{P}\p{S}]/u;
var H = /[\s\p{P}\p{S}]/u;
var W = /[^\s\p{P}\p{S}]/u;
var Xe = c(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, H).getRegex();
var Ve = /[\p{Pi}\p{Ps}"']/u;
var Te = /(?!~)[\p{P}\p{S}]/u;
var Je = /(?!~)[\s\p{P}\p{S}]/u;
var Ye = /(?:[^\s\p{P}\p{S}]|~)/u;
var et = c(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Me ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var Oe = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var tt = c(Oe, "u").replace(/punct/g, $).getRegex();
var nt = c(Oe, "u").replace(/punct/g, Te).getRegex();
var st = c(/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/, "u").replace(/openQuote/g, Ve).replace(/punct/g, $).getRegex();
var we = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var it = c(we, "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, $).getRegex();
var ot = c(we, "gu").replace(/notPunctSpace/g, Ye).replace(/punctSpace/g, Je).replace(/punct/g, Te).getRegex();
var lt = c("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, $).getRegex();
var ut = c("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, $).getRegex();
var ct = c("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, $).getRegex();
var ht = c(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, $).getRegex();
var kt = c("^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, W).replace(/punctSpace/g, H).replace(/punct/g, $).getRegex();
var gt = c(/\\(punct)/, "gu").replace(/punct/g, $).getRegex();
var ft = c(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, "gu").replace(/punct/g, $).getRegex();
var mt = c(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var xt = c(ie).replace("(?:-->|$)", "-->").getRegex();
var bt = c("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", xt).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var Pe = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
var Y = c(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", Pe).getRegex();
var Rt = c(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", Y).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var Tt = c(/^!?\[(label)\]\[(ref)\]/).replace("label", Y).replace("ref", se).getRegex();
var Ot = c(/^!?\[(ref)\](?:\[\])?/).replace("ref", se).getRegex();
var ge = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
var wt = c(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", Pe).getRegex();
var Pt = c("reflink|nolink(?!\\()", "g").replace("reflink", c(/^!?\[(label)\]\[(ref)\]/).replace("label", wt).replace("ref", ge).getRegex()).replace("nolink", c(/^!?\[(ref)\](?:\[\])?/).replace("ref", ge).getRegex()).getRegex();
var fe = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var St = c(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex();
var ae = {
	_backpedal: B,
	anyPunctuation: gt,
	anyPunctuationOutsideCode: ft,
	autolink: mt,
	blockSkip: et,
	br: Re,
	code: Ke,
	del: B,
	delLDelim: B,
	delRDelim: B,
	emStrongLDelim: tt,
	emStrongRDelimAst: it,
	emStrongRDelimUnd: ut,
	escape: Ue,
	link: Rt,
	nolink: Ot,
	punctuation: Xe,
	reflink: Tt,
	reflinkSearch: Pt,
	tag: bt,
	text: We,
	url: B
};
var _t = {
	...ae,
	emStrongLDelim: st,
	emStrongRDelimAst: lt,
	emStrongRDelimUnd: ct,
	link: c(/^!?\[(label)\]\((.*?)\)/).replace("label", Y).getRegex(),
	reflink: c(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", Y).getRegex()
};
var te = {
	...ae,
	emStrongRDelimAst: ot,
	emStrongLDelim: nt,
	delLDelim: ht,
	delRDelim: kt,
	url: c(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", St).replace("protocol", fe).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(),
	_backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
	del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
	text: c(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", fe).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex()
};
var $t = {
	...te,
	br: c(Re).replace("{2,}", "*").getRegex(),
	text: c(te.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
};
var X = {
	normal: oe,
	gfm: je,
	pedantic: Fe
};
var G = {
	normal: ae,
	gfm: te,
	breaks: $t,
	pedantic: _t
};
var Lt = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
var ye = (a) => Lt[a];
function P(a, e) {
	if (e) {
		if (T.escapeTest.test(a)) return a.replace(T.escapeReplace, ye);
	} else if (T.escapeTestNoEncode.test(a)) return a.replace(T.escapeReplaceNoEncode, ye);
	return a;
}
function Se(a) {
	return T.numericCharacterReference.test(a) ? a.replace(T.numericCharacterReferenceOrAmpersand, (e, t, n) => {
		if (t === void 0 && n === void 0) return "&amp;";
		let s = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
		return s === 0 || s > 1114111 || s >= 55296 && s <= 57343 ? "�" : s === 38 ? "&amp;" : String.fromCodePoint(s);
	}) : a;
}
function le(a) {
	try {
		a = encodeURI(a).replace(T.percentDecode, "%");
	} catch {
		return null;
	}
	return a;
}
function ue(a, e) {
	let n = a.replace(T.findPipe, (r, o, i) => {
		let l = !1, u = o;
		for (; --u >= 0 && i[u] === "\\";) l = !l;
		return l ? "|" : " |";
	}).split(T.splitPipe), s = 0;
	if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
	else for (; n.length < e;) n.push("");
	for (; s < n.length; s++) n[s] = n[s].trim().replace(T.slashPipe, "|");
	return n;
}
function z(a, e, t) {
	let n = a.length;
	if (n === 0) return "";
	let s = 0;
	for (; s < n;) {
		let r = a.charAt(n - s - 1);
		if (r === e && !t) s++;
		else if (r !== e && t) s++;
		else break;
	}
	return a.slice(0, n - s);
}
function pe(a) {
	let e = a.split(`
`), t = e.length - 1;
	for (; t >= 0 && T.blankLine.test(e[t]);) t--;
	return e.length - t <= 2 ? a : e.slice(0, t + 1).join(`
`);
}
function N(a) {
	return a.trim().toLowerCase().toUpperCase().toLowerCase();
}
function ce(a, e) {
	if (a.indexOf(e[0]) === -1 && a.indexOf(e[1]) === -1) return -1;
	let t = 0;
	for (let n = 0; n < a.length; n++) if (a[n] === "\\") n++;
	else if (a[n] === e[0]) t++;
	else if (a[n] === e[1] && (t--, t < 0)) return n;
	return t > 0 ? -2 : -1;
}
function V(a, e = 0) {
	let t = e, n = "";
	for (let s of a) if (s === "	") {
		let r = 4 - t % 4;
		n += " ".repeat(r), t += r;
	} else n += s, t++;
	return n;
}
function _e(a, e, t, n, s) {
	let r = e.href, o = e.title || null, i = a[1].replace(s.other.outputLinkReplace, "$1"), l = a[0].charAt(0) === "!", u = n.state.inLink, h = n.state.linkEmitted, p = n.state.inRawBlock;
	n.state.inLink = !0, n.state.linkEmitted = !1;
	let d = n.inlineTokens(i), g = n.state.linkEmitted;
	if (n.state.linkEmitted = h, n.state.inLink = u, !l) {
		if (g) {
			n.state.inRawBlock = p;
			return;
		}
		n.state.linkEmitted = !0;
	}
	return {
		type: l ? "image" : "link",
		raw: t,
		href: r,
		title: o,
		text: i,
		tokens: d
	};
}
function At(a, e, t) {
	let n = a.match(t.other.indentCodeCompensation);
	if (n === null) return e;
	let s = n[1];
	return e.split(`
`).map((r) => {
		let o = r.match(t.other.beginningSpace);
		if (o === null) return r;
		let [i] = o;
		return r.slice(Math.min(i.length, s.length));
	}).join(`
`);
}
function $e(a, e, t, n) {
	if (!e.includes("<")) return !1;
	for (let s = 0; s < e.length; s++) {
		if (e[s] === "\\") {
			s++;
			continue;
		}
		if (e[s] === "`") {
			let i = n.inline.code.exec(e.slice(s));
			if (i) {
				s += i[0].length - 1;
				continue;
			}
		}
		if (e[s] !== "<") continue;
		let r = a.slice(t + s), o = n.inline.tag.exec(r) || n.inline.autolink.exec(r);
		if (o) {
			if (o[0].length > e.length - s) return !0;
			s += o[0].length - 1;
		}
	}
	return !1;
}
var _ = class {
	options;
	rules;
	lexer;
	constructor(e) {
		this.options = e || y;
	}
	space(e) {
		let t = this.rules.block.newline.exec(e);
		if (t && t[0].length > 0) return {
			type: "space",
			raw: t[0]
		};
	}
	code(e) {
		let t = this.rules.block.code.exec(e);
		if (t) {
			let n = this.options.pedantic ? t[0] : pe(t[0]);
			return {
				type: "code",
				raw: n,
				codeBlockStyle: "indented",
				text: n.replace(this.rules.other.codeRemoveIndent, "")
			};
		}
	}
	fences(e) {
		let t = this.rules.block.fences.exec(e);
		if (t) {
			let n = t[0], s = At(n, t[3] || "", this.rules);
			return {
				type: "code",
				raw: n,
				lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2],
				text: s
			};
		}
	}
	heading(e) {
		let t = this.rules.block.heading.exec(e);
		if (t) {
			let n = t[2].trim();
			if (this.rules.other.endingHash.test(n)) {
				let s = z(n, "#");
				(this.options.pedantic || !s || this.rules.other.endingSpaceTabChar.test(s)) && (n = s.trim());
			}
			return {
				type: "heading",
				raw: z(t[0], `
`),
				depth: t[1].length,
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	hr(e) {
		let t = this.rules.block.hr.exec(e);
		if (t) return {
			type: "hr",
			raw: z(t[0], `
`)
		};
	}
	blockquote(e) {
		let t = this.rules.block.blockquote.exec(e);
		if (t) {
			let n = z(t[0], `
`).split(`
`), s = "", r = "", o = [];
			for (; n.length > 0;) {
				let i = !1, l = [], u = 0;
				for (; u < n.length; u++) if (this.rules.other.blockquoteStart.test(n[u])) l.push(n[u]), i = !0;
				else if (!i) l.push(n[u]);
				else break;
				n = n.slice(u);
				let h = l.join(`
`), p = h.replace(this.rules.other.blockquoteMarkerWhitespace, (k, b, x) => b + V(x, b.length)).replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
				s = s ? `${s}
${h}` : h, r = r ? `${r}
${p}` : p;
				let d = this.lexer.state.top;
				if (this.lexer.state.top = !0, this.lexer.blockTokens(p, o, !0), this.lexer.state.top = d, n.length === 0) break;
				let g = o.at(-1);
				if (g?.type === "code" || g?.type === "heading" || g?.type === "hr" || g?.type === "html") break;
				if (g?.type === "blockquote") {
					let k = g, b = n.join(`
`), x = k.raw + `
` + b.replace(this.rules.other.blockquoteSetextReplace2, ""), f = this.blockquote(x);
					o[o.length - 1] = f;
					let S = x.substring(f.raw.length).replace(/^\n/, ""), R = S ? S.split(`
`).length : 0, C = R ? n.slice(0, -R) : n;
					C.length > 0 && (s = `${s}
${C.join(`
`)}`), r = r.substring(0, r.length - k.text.length) + f.text;
					break;
				} else if (g?.type === "list") {
					let k = g, b = k.raw + `
` + n.join(`
`), x = this.list(b);
					o[o.length - 1] = x;
					let f = x.raw.length > k.raw.length ? b.slice(k.raw.length + 1, x.raw.length).split(`
`).length : 0;
					if (f > 0) {
						let S = n.slice(0, f).join(`
`);
						s = `${s}
${S}`, r = `${r}
${S}`;
					}
					n = n.slice(f);
					continue;
				}
			}
			return {
				type: "blockquote",
				raw: s,
				tokens: o,
				text: r
			};
		}
	}
	list(e) {
		let t = this.rules.block.list.exec(e);
		if (t) {
			let n = e, s = () => n.length - e.length, r = t[1].trim(), o = r.length > 1, i = {
				type: "list",
				raw: "",
				ordered: o,
				start: o ? +r.slice(0, -1) : "",
				loose: !1,
				items: []
			};
			r = o ? `\\d{1,9}\\${r.slice(-1)}` : `\\${r}`, this.options.pedantic && (r = o ? r : "[*+-]");
			let l = this.rules.other.listItemRegex(r), u = !1;
			for (; e;) {
				let p = !1, d = "";
				if (!(t = l.exec(e)) || this.rules.block.hr.test(e)) break;
				let g = s();
				e = e.substring(t[0].length);
				let k = t[2].split(`
`, 1)[0], b = t[1].length, x = this.options.pedantic ? V(k, b) : k.replace(this.rules.other.leadingSpaceTab, (Q) => V(Q, b)), f = e.split(`
`, 1)[0], S = !x.trim(), R = 0;
				if (this.options.pedantic ? (R = 2, d = x.trimStart()) : S ? R = b + 1 : (R = x.search(this.rules.other.nonSpaceChar), R = R > 4 ? 1 : R, d = x.slice(R), R += b), S && this.rules.other.blankLine.test(f) && (e = e.substring(f.length + 1), p = !0), !p) {
					let Q = this.rules.other.nextBulletRegex(R), E = this.rules.other.hrRegex(R), j = this.rules.other.fencesBeginRegex(R), F = this.options.pedantic ? this.rules.other.pedanticHeadingBeginRegex(R) : this.rules.other.headingBeginRegex(R), Le = this.rules.other.htmlBeginRegex(R), Ae = this.rules.other.blockquoteBeginRegex(R);
					for (; e;) {
						let he = e.split(`
`, 1)[0], Z;
						if (f = he, this.options.pedantic ? (f = f.replace(this.rules.other.listReplaceNesting, "  "), Z = f) : Z = f.replace(this.rules.other.leadingSpaceTab, (de) => V(de)), j.test(f) || F.test(f) || Le.test(f) || Ae.test(f) || Q.test(f) || E.test(f)) break;
						if (Z.search(this.rules.other.nonSpaceChar) >= R || !f.trim()) d += `
` + Z.slice(R);
						else {
							if (S || x.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || j.test(x) || F.test(x) || E.test(x)) break;
							let ze = !this.options.pedantic && /^ {0,3}(?:=+|-+) *$/.test(f) && this.rules.block.lheading.test(`${x}
${f}`) ? `    ${Z.replace(/^ {0,3}/, "")}` : f;
							d += `
` + ze;
						}
						S = !f.trim(), e = e.substring(he.length + 1), x = Z.slice(R);
					}
				}
				let C = n.slice(g, s());
				i.loose || (u ? i.loose = !0 : this.rules.other.doubleBlankLine.test(C) && (u = !0)), i.items.push({
					type: "list_item",
					raw: C,
					task: !!this.options.gfm && this.rules.other.listIsTask.test(d),
					loose: !1,
					text: d,
					tokens: []
				});
			}
			let h = i.items.at(-1);
			if (h) h.raw = h.raw.trimEnd(), h.text = h.text.trimEnd();
			else return;
			i.raw = n.slice(0, s()).trimEnd();
			for (let p of i.items) if (this.lexer.state.top = !1, p.tokens = this.lexer.blockTokens(p.text, []), !i.loose) {
				let d = p.tokens.filter((k) => k.type === "space");
				i.loose = d.length > 0 && d.some((k) => this.rules.other.anyLine.test(k.raw));
			}
			for (let p of i.items) {
				let d = p.tokens[0];
				if (p.task && (d?.type === "text" || d?.type === "paragraph")) {
					p.text = p.text.replace(this.rules.other.listReplaceTask, ""), d.raw = d.raw.replace(this.rules.other.listReplaceTask, ""), d.text = d.text.replace(this.rules.other.listReplaceTask, "");
					for (let k = this.lexer.inlineQueue.length - 1; k >= 0; k--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[k].src)) {
						this.lexer.inlineQueue[k].src = this.lexer.inlineQueue[k].src.replace(this.rules.other.listReplaceTask, "");
						break;
					}
					let g = this.rules.other.listTaskCheckbox.exec(p.raw);
					if (g) {
						let k = {
							type: "checkbox",
							raw: g[0] + " ",
							checked: g[0] !== "[ ]"
						};
						p.checked = k.checked, i.loose ? p.tokens[0] && ["paragraph", "text"].includes(p.tokens[0].type) && "tokens" in p.tokens[0] && p.tokens[0].tokens ? (p.tokens[0].raw = k.raw + p.tokens[0].raw, p.tokens[0].text = k.raw + p.tokens[0].text, p.tokens[0].tokens.unshift(k)) : p.tokens.unshift({
							type: "paragraph",
							raw: k.raw,
							text: k.raw,
							tokens: [k]
						}) : p.tokens.unshift(k);
					}
				} else p.task && (p.task = !1);
			}
			if (i.loose) for (let p of i.items) {
				p.loose = !0;
				for (let d of p.tokens) d.type === "text" && (d.type = "paragraph");
			}
			return i;
		}
	}
	html(e) {
		let t = this.rules.block.html.exec(e);
		if (t) {
			let n = pe(t[0]);
			return {
				type: "html",
				block: !0,
				raw: n,
				pre: t[1] === "pre" || t[1] === "script" || t[1] === "style",
				text: n
			};
		}
	}
	def(e) {
		let t = this.rules.block.def.exec(e);
		if (t) {
			if (!this.rules.other.startAngleBracket.test(t[2]) && ce(t[2], "()") !== -1) return;
			let n = N(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
			return {
				type: "def",
				tag: n,
				raw: z(t[0], `
`),
				href: s,
				title: r
			};
		}
	}
	table(e) {
		let t = this.rules.block.table.exec(e);
		if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
		let n = ue(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = {
			type: "table",
			raw: z(t[0], `
`),
			header: [],
			align: [],
			rows: []
		};
		if (n.length === s.length) {
			for (let i of s) this.rules.other.tableAlignRight.test(i) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(i) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(i) ? o.align.push("left") : o.align.push(null);
			for (let i = 0; i < n.length; i++) o.header.push({
				text: n[i],
				tokens: this.lexer.inline(n[i]),
				header: !0,
				align: o.align[i]
			});
			for (let i of r) o.rows.push(ue(i, o.header.length).map((l, u) => ({
				text: l,
				tokens: this.lexer.inline(l),
				header: !1,
				align: o.align[u]
			})));
			return o;
		}
	}
	lheading(e) {
		let t = this.rules.block.lheading.exec(e);
		if (t) {
			let n = t[1].trim();
			return {
				type: "heading",
				raw: z(t[0], `
`),
				depth: t[2].charAt(0) === "=" ? 1 : 2,
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	paragraph(e) {
		let t = this.rules.block.paragraph.exec(e);
		if (t) {
			let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
			return {
				type: "paragraph",
				raw: t[0],
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	text(e) {
		let t = this.rules.block.text.exec(e);
		if (t) return {
			type: "text",
			raw: t[0],
			text: t[0],
			tokens: this.lexer.inline(t[0])
		};
	}
	escape(e) {
		let t = this.rules.inline.escape.exec(e);
		if (t) return {
			type: "escape",
			raw: t[0],
			text: t[1]
		};
	}
	tag(e) {
		let t = this.rules.inline.tag.exec(e);
		if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = !1), {
			type: "html",
			raw: t[0],
			inLink: this.lexer.state.inLink,
			inRawBlock: this.lexer.state.inRawBlock,
			block: !1,
			text: t[0]
		};
	}
	link(e) {
		if (this.lexer.state.linkParenPossible === !1) return;
		let t = this.rules.inline.link.exec(e);
		if (t) {
			let n = t[0].charAt(0) === "!" ? 2 : 1;
			if (!this.options.pedantic && $e(e, t[1], n, this.rules)) return;
			let s = t[2].trim();
			if (!this.options.pedantic && this.rules.other.startAngleBracket.test(s)) {
				if (!this.rules.other.endAngleBracket.test(s)) return;
				let i = z(s.slice(0, -1), "\\");
				if ((s.length - i.length) % 2 === 0) return;
			} else {
				let i = ce(t[2], "()");
				if (i === -2) return;
				if (i > -1) {
					let u = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
					t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, u).trim(), t[3] = "";
				}
			}
			let r = t[2], o = "";
			if (this.options.pedantic) {
				let i = this.rules.other.pedanticHrefTitle.exec(r);
				i && (r = i[1], o = i[3]);
			} else o = t[3] ? t[3].slice(1, -1) : "";
			return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(s) ? r = r.slice(1) : r = r.slice(1, -1)), _e(t, {
				href: r && r.replace(this.rules.inline.anyPunctuation, "$1"),
				title: o && o.replace(this.rules.inline.anyPunctuation, "$1")
			}, t[0], this.lexer, this.rules);
		}
	}
	reflink(e, t) {
		let n;
		if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
			let s = n[0].charAt(0) === "!" ? 2 : 1;
			if (!this.options.pedantic && $e(e, n[1], s, this.rules)) return;
			let o = t[N((n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "))];
			if (!o) {
				let i = n[0].charAt(0);
				return {
					type: "text",
					raw: i,
					text: i
				};
			}
			return _e(n, o, n[0], this.lexer, this.rules);
		}
	}
	emStrong(e, t, n = "") {
		let s = this.rules.inline.emStrongLDelim.exec(e);
		if (!s || !s[1] && !s[2] && !s[3] && !s[4]) return;
		let r = s[0][0], o = n === r, i = t.length - e.length, l = i;
		for (; !this.options.pedantic && l > 0 && t[l - 1] === r;) l--;
		let u = [...t.slice(Math.max(0, l - 2), l)].at(-1) ?? "", h = u === "*" || u === "_" || !!this.rules.inline.punctuation.exec(u);
		l < i && (n = u);
		let p = l < i ? h : !!this.rules.inline.punctuation.exec(n);
		if (s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
		let d = s[1] || s[3] || "";
		if (!d || !n || p) {
			let g = [...s[0]].length - 1, k, b, x = g, f = 0, S = i - l + g, R = !this.options.pedantic && !!u.trim() && (!!d || r === "*" && !h), C = r === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
			for (C.lastIndex = 0, t = t.slice(-1 * e.length + g); (s = C.exec(t)) !== null;) {
				if (k = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !k) continue;
				if (b = [...k].length, s[3] || s[4]) {
					x += b;
					continue;
				} else if (s[5] || s[6] || R) {
					if (o && (s[5] || s[6])) break;
					if (S % 3 && !((S + b) % 3)) {
						f += b;
						continue;
					}
				}
				if (x -= b, x > 0) continue;
				b = Math.min(b, b + x + f);
				let Q = [...s[0]][0].length, E = e.slice(0, g + s.index + Q + b);
				if (Math.min(g, b) % 2) {
					let F = E.slice(1, -1);
					return {
						type: "em",
						raw: E,
						text: F,
						tokens: this.lexer.inlineTokens(F)
					};
				}
				let j = E.slice(2, -2);
				return {
					type: "strong",
					raw: E,
					text: j,
					tokens: this.lexer.inlineTokens(j)
				};
			}
		}
	}
	codespan(e) {
		let t = this.rules.inline.code.exec(e);
		if (t) {
			let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
			return s && r && (n = n.substring(1, n.length - 1)), {
				type: "codespan",
				raw: t[0],
				text: n
			};
		}
	}
	br(e) {
		let t = this.rules.inline.br.exec(e);
		if (t) return {
			type: "br",
			raw: t[0]
		};
	}
	del(e, t, n = "") {
		let s = this.rules.inline.delLDelim.exec(e);
		if (!s) return;
		if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
			let o = [...s[0]].length - 1, i, l, u = o, h = this.rules.inline.delRDelim;
			for (h.lastIndex = 0, t = t.slice(-1 * e.length + o); (s = h.exec(t)) !== null;) {
				if (i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !i || (l = [...i].length, l !== o)) continue;
				if (s[3] || s[4]) {
					u += l;
					continue;
				}
				if (u -= l, u > 0) continue;
				l = Math.min(l, l + u);
				let p = [...s[0]][0].length, d = e.slice(0, o + s.index + p + l), g = d.slice(o, -o);
				return {
					type: "del",
					raw: d,
					text: g,
					tokens: this.lexer.inlineTokens(g)
				};
			}
		}
	}
	autolink(e) {
		let t = this.rules.inline.autolink.exec(e);
		if (t) {
			let n, s;
			return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), {
				type: "link",
				raw: t[0],
				text: n,
				href: s,
				autolink: !0,
				tokens: [{
					type: "text",
					raw: n,
					text: n
				}]
			};
		}
	}
	url(e) {
		let t;
		if (t = this.rules.inline.url.exec(e)) {
			let n, s;
			if (t[2] === "@") n = t[0], s = "mailto:" + n;
			else {
				let r;
				do
					r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
				while (r !== t[0]);
				n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
			}
			return {
				type: "link",
				raw: t[0],
				text: n,
				href: s,
				autolink: !0,
				tokens: [{
					type: "text",
					raw: n,
					text: n
				}]
			};
		}
	}
	inlineText(e) {
		let t = this.rules.inline.text.exec(e);
		if (t) {
			let n = this.lexer.state.inRawBlock;
			return {
				type: "text",
				raw: t[0],
				text: n ? t[0] : Se(t[0]),
				escaped: n
			};
		}
	}
};
var O = class a {
	tokens;
	options;
	state;
	inlineQueue;
	tokenizer;
	constructor(e) {
		this.tokens = [], this.tokens.links = Object.create(null), this.options = e || y, this.options.tokenizer = this.options.tokenizer || new _(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = {
			inLink: !1,
			inRawBlock: !1,
			linkEmitted: !1,
			linkParenPossible: !0,
			top: !0
		};
		let t = {
			other: T,
			block: X.normal,
			inline: G.normal
		};
		this.options.pedantic ? (t.block = X.pedantic, t.inline = G.pedantic) : this.options.gfm && (t.block = X.gfm, this.options.breaks ? t.inline = G.breaks : t.inline = G.gfm), this.tokenizer.rules = t;
	}
	static get rules() {
		return {
			block: X,
			inline: G
		};
	}
	static lex(e, t) {
		return new a(t).lex(e);
	}
	static lexInline(e, t) {
		return new a(t).inlineTokens(e);
	}
	lex(e) {
		e = e.replace(T.carriageReturn, `
`), this.blockTokens(e, this.tokens);
		for (let t = 0; t < this.inlineQueue.length; t++) {
			let n = this.inlineQueue[t];
			this.state.inRawBlock = !1, this.inlineTokens(n.src, n.tokens);
		}
		return this.inlineQueue = [], this.tokens;
	}
	blockTokens(e, t = [], n = !1) {
		this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(T.tabCharGlobal, "    ").replace(T.spaceLine, ""));
		let s = 1 / 0;
		for (; e;) {
			if (e.length < s) s = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			let r;
			if (this.options.extensions?.block?.some((i) => (r = i.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), !0) : !1)) continue;
			if (r = this.tokenizer.space(e)) {
				e = e.substring(r.raw.length);
				let i = t.at(-1);
				r.raw.length === 1 && i !== void 0 ? i.raw += `
` : t.push(r);
				continue;
			}
			if (r = this.tokenizer.code(e)) {
				e = e.substring(r.raw.length);
				let i = t.at(-1);
				i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.at(-1).src = i.text) : t.push(r);
				continue;
			}
			if (r = this.tokenizer.fences(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.heading(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.hr(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.blockquote(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.list(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.html(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.def(e)) {
				e = e.substring(r.raw.length);
				let i = t.at(-1);
				i?.type === "paragraph" || i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.raw, this.inlineQueue.at(-1).src = i.text) : (this.tokens.links[r.tag] || (this.tokens.links[r.tag] = {
					href: r.href,
					title: r.title
				}), t.push(r));
				continue;
			}
			if (r = this.tokenizer.table(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.lheading(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			let o = e;
			if (this.options.extensions?.startBlock) {
				let i = 1 / 0, l = e.slice(1), u;
				this.options.extensions.startBlock.forEach((h) => {
					u = h.call({ lexer: this }, l), typeof u == "number" && u >= 0 && (i = Math.min(i, u));
				}), i < 1 / 0 && i >= 0 && (o = e.substring(0, i + 1));
			}
			if (this.state.top && (r = this.tokenizer.paragraph(o))) {
				let i = t.at(-1);
				n && i?.type === "paragraph" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r), n = o.length !== e.length, e = e.substring(r.raw.length);
				continue;
			}
			if (r = this.tokenizer.text(e)) {
				e = e.substring(r.raw.length);
				let i = t.at(-1);
				i?.type === "text" ? (i.raw += (i.raw.endsWith(`
`) ? "" : `
`) + r.raw, i.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = i.text) : t.push(r);
				continue;
			}
			if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return this.state.top = !0, t;
	}
	inline(e, t = []) {
		return this.inlineQueue.push({
			src: e,
			tokens: t
		}), t;
	}
	linkInText(e) {
		if (!e.includes("[")) return !1;
		let t = this.tokenizer.rules.inline.link;
		for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return !0;
		for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
			let s = n[0], r = s.lastIndexOf("[");
			if (!(s.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, N(s.slice(r + 1, -1)))) && !(r > 1 && this.linkInText(s.slice(1, r - 1)))) return !0;
		}
		return !1;
	}
	inlineTokens(e, t = []) {
		this.tokenizer.lexer = this;
		let n = this.state.linkParenPossible;
		this.state.linkParenPossible = n && e.includes(")");
		try {
			return this.#e(e, t);
		} finally {
			this.state.linkParenPossible = n;
		}
	}
	#e(e, t) {
		let n = e.includes("*") || e.includes("_") || e.includes("~") || this.options.hooks?.emStrongMask || this.tokenizer.emStrong !== _.prototype.emStrong || this.tokenizer.del !== _.prototype.del ? this.#t(e) : e, s = !1, r = "", o = 1 / 0;
		for (; e;) {
			if (e.length < o) o = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			s || (r = ""), s = !1;
			let i;
			if (this.options.extensions?.inline?.some((u) => (i = u.call({ lexer: this }, e, t)) ? (e = e.substring(i.raw.length), t.push(i), !0) : !1)) continue;
			if (i = this.tokenizer.escape(e)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.tag(e)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.link(e)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.reflink(e, this.tokens.links)) {
				e = e.substring(i.raw.length);
				let u = t.at(-1);
				i.type === "text" && u?.type === "text" ? (u.raw += i.raw, u.text += i.text) : t.push(i);
				continue;
			}
			if (i = this.tokenizer.emStrong(e, n, r)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.codespan(e)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.br(e)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.del(e, n, r)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (i = this.tokenizer.autolink(e)) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			if (!this.state.inLink && (i = this.tokenizer.url(e))) {
				e = e.substring(i.raw.length), t.push(i);
				continue;
			}
			let l = e;
			if (this.options.extensions?.startInline) {
				let u = 1 / 0, h = e.slice(1), p;
				this.options.extensions.startInline.forEach((d) => {
					p = d.call({ lexer: this }, h), typeof p == "number" && p >= 0 && (u = Math.min(u, p));
				}), u < 1 / 0 && u >= 0 && (l = e.substring(0, u + 1));
			}
			if (i = this.tokenizer.inlineText(l)) {
				e = e.substring(i.raw.length), i.raw.slice(-1) !== "_" && (r = i.raw.slice(-1)), s = !0;
				let u = t.at(-1);
				u?.type === "text" ? (u.raw += i.raw, u.text += i.text) : t.push(i);
				continue;
			}
			if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return t;
	}
	#t(e) {
		let t = e;
		if (this.tokens.links && e.includes("[")) {
			let n = this.tokenizer.rules.inline.reflinkSearch, s = (r) => {
				let o = r.lastIndexOf("[");
				if (!Object.hasOwn(this.tokens.links, N(r.slice(o + 1, -1)))) return r;
				if (o > 1 && r.charAt(0) !== "!") {
					let i = r.slice(1, o - 1);
					if (this.linkInText(i)) return "[" + i.replace(n, s) + "][" + "a".repeat(r.length - o - 2) + "]";
				}
				return "[" + "a".repeat(r.length - 2) + "]";
			};
			t = t.replace(n, s);
		}
		return t = t.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (n, s, r) => r ? "+".repeat(n.length) : s ? s + n.slice(s.length, -s.length).replace(/`/g, "+") + s : n), t = t.replace(this.tokenizer.rules.inline.blockSkip, (n, s, r) => {
			let o = r ? r.length : 0;
			return n.slice(0, o) + "[" + "a".repeat(n.length - o - 2) + "]";
		}), t = this.options.hooks?.emStrongMask?.call({ lexer: this }, t) ?? t, t;
	}
	infiniteLoopError(e) {
		let t = "Infinite loop on byte: " + e;
		if (this.options.silent) console.error(t);
		else throw new Error(t);
	}
};
var L = class {
	options;
	parser;
	constructor(e) {
		this.options = e || y;
	}
	space(e) {
		return "";
	}
	code({ text: e, lang: t, escaped: n }) {
		let s = (t || "").match(T.notSpaceStart)?.[0], r = e ? e.replace(T.endingNewline, "") + `
` : "";
		return s ? "<pre><code class=\"language-" + P(s) + "\">" + (n ? r : P(r, !0)) + `</code></pre>
` : "<pre><code>" + (n ? r : P(r, !0)) + `</code></pre>
`;
	}
	blockquote({ tokens: e }) {
		return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
	}
	html({ text: e }) {
		return e;
	}
	def(e) {
		return "";
	}
	heading({ tokens: e, depth: t }) {
		return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
	}
	hr(e) {
		return `<hr>
`;
	}
	list(e) {
		let t = e.ordered, n = e.start, s = "";
		for (let i = 0; i < e.items.length; i++) {
			let l = e.items[i];
			s += this.listitem(l);
		}
		let r = t ? "ol" : "ul", o = t && n !== 1 ? " start=\"" + n + "\"" : "";
		return "<" + r + o + `>
` + s + "</" + r + `>
`;
	}
	listitem(e) {
		return `<li>${this.parser.parse(e.tokens)}</li>
`;
	}
	checkbox({ checked: e }) {
		return "<input " + (e ? "checked=\"\" " : "") + "disabled=\"\" type=\"checkbox\"> ";
	}
	paragraph({ tokens: e }) {
		return `<p>${this.parser.parseInline(e)}</p>
`;
	}
	table(e) {
		let t = "", n = "";
		for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
		t += this.tablerow({ text: n });
		let s = "";
		for (let r = 0; r < e.rows.length; r++) {
			let o = e.rows[r];
			n = "";
			for (let i = 0; i < o.length; i++) n += this.tablecell(o[i]);
			s += this.tablerow({ text: n });
		}
		return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
	}
	tablerow({ text: e }) {
		return `<tr>
${e}</tr>
`;
	}
	tablecell(e) {
		let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
		return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
	}
	strong({ tokens: e }) {
		return `<strong>${this.parser.parseInline(e)}</strong>`;
	}
	em({ tokens: e }) {
		return `<em>${this.parser.parseInline(e)}</em>`;
	}
	codespan({ text: e }) {
		return `<code>${P(e, !0)}</code>`;
	}
	br(e) {
		return "<br>";
	}
	del({ tokens: e }) {
		return `<del>${this.parser.parseInline(e)}</del>`;
	}
	link({ href: e, title: t, text: n, tokens: s, autolink: r }) {
		let o = r ? P(n, !0) : this.parser.parseInline(s), i = le(e);
		if (i === null) return o;
		e = P(i, r);
		let l = "<a href=\"" + e + "\"";
		return t && (l += " title=\"" + P(t) + "\""), l += ">" + o + "</a>", l;
	}
	image({ href: e, title: t, text: n, tokens: s }) {
		s && (n = this.parser.parseInline(s, this.parser.textRenderer));
		let r = le(e);
		if (r === null) return P(n);
		e = r;
		let o = `<img src="${P(e)}" alt="${P(n)}"`;
		return t && (o += ` title="${P(t)}"`), o += ">", o;
	}
	text(e) {
		return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : P(e.text);
	}
};
var M = class {
	parser;
	strong({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	em({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	codespan({ text: e }) {
		return e;
	}
	del({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	html({ text: e }) {
		return e;
	}
	text({ text: e }) {
		return e;
	}
	link({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	image({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	br() {
		return "";
	}
	checkbox({ raw: e }) {
		return e;
	}
};
var w = class a {
	options;
	renderer;
	textRenderer;
	constructor(e) {
		this.options = e || y, this.options.renderer = this.options.renderer || new L(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new M(), this.textRenderer.parser = this;
	}
	static parse(e, t) {
		return new a(t).parse(e);
	}
	static parseInline(e, t) {
		return new a(t).parseInline(e);
	}
	parse(e) {
		this.renderer.parser = this;
		let t = "";
		for (let n = 0; n < e.length; n++) {
			let s = e[n];
			if (this.options.extensions?.renderers?.[s.type]) {
				let o = s, i = this.options.extensions.renderers[o.type].call({ parser: this }, o);
				if (i !== !1 || ![
					"space",
					"hr",
					"heading",
					"code",
					"table",
					"blockquote",
					"list",
					"checkbox",
					"html",
					"def",
					"paragraph",
					"text"
				].includes(o.type)) {
					t += i || "";
					continue;
				}
			}
			let r = s;
			switch (r.type) {
				case "space":
					t += this.renderer.space(r);
					break;
				case "hr":
					t += this.renderer.hr(r);
					break;
				case "heading":
					t += this.renderer.heading(r);
					break;
				case "code":
					t += this.renderer.code(r);
					break;
				case "table":
					t += this.renderer.table(r);
					break;
				case "blockquote":
					t += this.renderer.blockquote(r);
					break;
				case "list":
					t += this.renderer.list(r);
					break;
				case "checkbox":
					t += this.renderer.checkbox(r);
					break;
				case "html":
					t += this.renderer.html(r);
					break;
				case "def":
					t += this.renderer.def(r);
					break;
				case "paragraph":
					t += this.renderer.paragraph(r);
					break;
				case "text":
					t += this.renderer.text(r);
					break;
				default: {
					let o = "Token with \"" + r.type + "\" type was not found.";
					if (this.options.silent) return console.error(o), "";
					throw new Error(o);
				}
			}
		}
		return t;
	}
	parseInline(e, t = this.renderer) {
		this.renderer.parser = this;
		let n = "";
		for (let s = 0; s < e.length; s++) {
			let r = e[s];
			if (this.options.extensions?.renderers?.[r.type]) {
				let i = this.options.extensions.renderers[r.type].call({ parser: this }, r);
				if (i !== !1 || ![
					"escape",
					"html",
					"link",
					"image",
					"checkbox",
					"strong",
					"em",
					"codespan",
					"br",
					"del",
					"text"
				].includes(r.type)) {
					n += i || "";
					continue;
				}
			}
			let o = r;
			switch (o.type) {
				case "escape":
					n += t.text(o);
					break;
				case "html":
					n += t.html(o);
					break;
				case "link":
					n += t.link(o);
					break;
				case "image":
					n += t.image(o);
					break;
				case "checkbox":
					n += t.checkbox(o);
					break;
				case "strong":
					n += t.strong(o);
					break;
				case "em":
					n += t.em(o);
					break;
				case "codespan":
					n += t.codespan(o);
					break;
				case "br":
					n += t.br(o);
					break;
				case "del":
					n += t.del(o);
					break;
				case "text":
					n += t.text(o);
					break;
				default: {
					let i = "Token with \"" + o.type + "\" type was not found.";
					if (this.options.silent) return console.error(i), "";
					throw new Error(i);
				}
			}
		}
		return n;
	}
};
var A = class {
	options;
	block;
	constructor(e) {
		this.options = e || y;
	}
	static passThroughHooks = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens",
		"emStrongMask"
	]);
	static passThroughHooksRespectAsync = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens"
	]);
	preprocess(e) {
		return e;
	}
	postprocess(e) {
		return e;
	}
	processAllTokens(e) {
		return e;
	}
	emStrongMask(e) {
		return e;
	}
	provideLexer(e = this.block) {
		return e ? O.lex : O.lexInline;
	}
	provideParser(e = this.block) {
		return e ? w.parse : w.parseInline;
	}
};
function D(a, e) {
	if (Array.isArray(e)) for (let t = 0; t < e.length; t++) a.push(e[t]);
	else a.push(e);
}
var J = class {
	defaults = v();
	options = this.setOptions;
	parse = this.parseMarkdown(!0);
	parseInline = this.parseMarkdown(!1);
	Parser = w;
	Renderer = L;
	TextRenderer = M;
	Lexer = O;
	Tokenizer = _;
	Hooks = A;
	constructor(...e) {
		this.use(...e);
	}
	walkTokens(e, t) {
		let n = [];
		for (let s of e) switch (D(n, t.call(this, s)), s.type) {
			case "table": {
				let r = s;
				for (let o of r.header) D(n, this.walkTokens(o.tokens, t));
				for (let o of r.rows) for (let i of o) D(n, this.walkTokens(i.tokens, t));
				break;
			}
			case "list": {
				let r = s;
				D(n, this.walkTokens(r.items, t));
				break;
			}
			default: {
				let r = s;
				this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((o) => {
					let i = r[o].flat(1 / 0);
					D(n, this.walkTokens(i, t));
				}) : r.tokens && D(n, this.walkTokens(r.tokens, t));
			}
		}
		return n;
	}
	use(...e) {
		let t = this.defaults.extensions || {
			renderers: {},
			childTokens: {}
		};
		return e.forEach((n) => {
			let s = { ...n };
			if (s.async = this.defaults.async || s.async || !1, n.extensions && (n.extensions.forEach((r) => {
				if (!r.name) throw new Error("extension name required");
				if ("renderer" in r) {
					let o = t.renderers[r.name];
					o ? t.renderers[r.name] = function(...i) {
						let l = r.renderer.apply(this, i);
						return l === !1 && (l = o.apply(this, i)), l;
					} : t.renderers[r.name] = r.renderer;
				}
				if ("tokenizer" in r) {
					if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
					let o = t[r.level];
					o ? o.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
				}
				"childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
			}), s.extensions = t), n.renderer) {
				let r = this.defaults.renderer || new L(this.defaults);
				for (let o in n.renderer) {
					if (!(o in r)) throw new Error(`renderer '${o}' does not exist`);
					if (["options", "parser"].includes(o)) continue;
					let i = o, l = n.renderer[i], u = r[i];
					r[i] = (...h) => {
						let p = l.apply(r, h);
						return p === !1 && (p = u.apply(r, h)), p || "";
					};
				}
				s.renderer = r;
			}
			if (n.tokenizer) {
				let r = this.defaults.tokenizer || new _(this.defaults);
				for (let o in n.tokenizer) {
					if (!(o in r)) throw new Error(`tokenizer '${o}' does not exist`);
					if ([
						"options",
						"rules",
						"lexer"
					].includes(o)) continue;
					let i = o, l = n.tokenizer[i], u = r[i];
					r[i] = (...h) => {
						let p = l.apply(r, h);
						return p === !1 && (p = u.apply(r, h)), p;
					};
				}
				s.tokenizer = r;
			}
			if (n.hooks) {
				let r = this.defaults.hooks || new A();
				for (let o in n.hooks) {
					if (!(o in r)) throw new Error(`hook '${o}' does not exist`);
					if (["options", "block"].includes(o)) continue;
					let i = o, l = n.hooks[i], u = r[i];
					A.passThroughHooks.has(o) ? r[i] = (h) => {
						if (r.options.async && A.passThroughHooksRespectAsync.has(o)) return (async () => {
							let d = await l.call(r, h);
							return u.call(r, d);
						})();
						let p = l.call(r, h);
						return u.call(r, p);
					} : r[i] = (...h) => {
						if (r.options.async) return (async () => {
							let d = await l.apply(r, h);
							return d === !1 && (d = await u.apply(r, h)), d;
						})();
						let p = l.apply(r, h);
						return p === !1 && (p = u.apply(r, h)), p;
					};
				}
				s.hooks = r;
			}
			if (n.walkTokens) {
				let r = this.defaults.walkTokens, o = n.walkTokens;
				s.walkTokens = function(i) {
					let l = [];
					return l.push(o.call(this, i)), r && D(l, r.call(this, i)), l;
				};
			}
			this.defaults = {
				...this.defaults,
				...s
			};
		}), this;
	}
	setOptions(e) {
		return this.defaults = {
			...this.defaults,
			...e
		}, this;
	}
	lexer(e, t) {
		return O.lex(e, t ?? this.defaults);
	}
	parser(e, t) {
		return w.parse(e, t ?? this.defaults);
	}
	parseMarkdown(e) {
		return (n, s) => {
			let r = { ...s }, o = {
				...this.defaults,
				...r
			}, i = this.onError(!!o.silent, !!o.async);
			if (this.defaults.async === !0 && r.async === !1) return i(/* @__PURE__ */ new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
			if (typeof n > "u" || n === null) return i(/* @__PURE__ */ new Error("marked(): input parameter is undefined or null"));
			if (typeof n != "string") return i(/* @__PURE__ */ new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
			if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async) return (async () => {
				let l = o.hooks ? await o.hooks.preprocess(n) : n, h = await (o.hooks ? await o.hooks.provideLexer(e) : e ? O.lex : O.lexInline)(l, o), p = o.hooks ? await o.hooks.processAllTokens(h) : h;
				o.walkTokens && await Promise.all(this.walkTokens(p, o.walkTokens));
				let g = await (o.hooks ? await o.hooks.provideParser(e) : e ? w.parse : w.parseInline)(p, o);
				return o.hooks ? await o.hooks.postprocess(g) : g;
			})().catch(i);
			try {
				o.hooks && (n = o.hooks.preprocess(n));
				let u = (o.hooks ? o.hooks.provideLexer(e) : e ? O.lex : O.lexInline)(n, o);
				o.hooks && (u = o.hooks.processAllTokens(u)), o.walkTokens && this.walkTokens(u, o.walkTokens);
				let p = (o.hooks ? o.hooks.provideParser(e) : e ? w.parse : w.parseInline)(u, o);
				return o.hooks && (p = o.hooks.postprocess(p)), p;
			} catch (l) {
				return i(l);
			}
		};
	}
	onError(e, t) {
		return (n) => {
			if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
				let s = "<p>An error occurred:</p><pre>" + P(n.message + "", !0) + "</pre>";
				return t ? Promise.resolve(s) : s;
			}
			if (t) return Promise.reject(n);
			throw n;
		};
	}
};
var q = new J();
function m(a, e) {
	return q.parse(a, e);
}
m.options = m.setOptions = function(a) {
	return q.setOptions(a), m.defaults = q.defaults, ee(m.defaults), m;
};
m.getDefaults = v;
m.defaults = y;
function zt(...a) {
	return q.use(...a), m.defaults = q.defaults, ee(m.defaults), m;
}
m.use = zt;
m.walkTokens = function(a, e) {
	return q.walkTokens(a, e);
};
m.parseInline = q.parseInline;
m.Parser = w;
m.parser = w.parse;
m.Renderer = L;
m.TextRenderer = M;
m.Lexer = O;
m.lexer = O.lex;
m.Tokenizer = _;
m.Hooks = A;
m.parse = m;
m.options;
m.setOptions;
m.walkTokens;
m.parseInline;
w.parse;
O.lex;
// \0mark-deferred-temml
var _mark_deferred_temml_default = runInThisContext("(function(){\nvar temml=function(){\"use strict\";class e{constructor(t,r){let n,s=\" \"+t;const o=r&&r.loc;if(o&&o.start<=o.end){const e=o.lexer.input;n=o.start;const t=o.end;n===e.length?s+=\" at end of input: \":s+=\" at position \"+(n+1)+\": \\n\";const r=e.slice(n,t).replace(/[^]/g,\"$&̲\");let a,l;a=n>15?\"…\"+e.slice(n-15,n):e.slice(0,n),l=t+15<e.length?e.slice(t,t+15)+\"…\":e.slice(t),s+=a+r+l}const a=new Error(s);return a.name=\"ParseError\",a.__proto__=e.prototype,a.position=n,a}}e.prototype.__proto__=Error.prototype;const t=function(e,t,r){if(!Object.prototype.hasOwnProperty.call(e,t))return r;const n=e[t];return void 0===n?r:n},r=/([A-Z])/g,n=function(e){return e.replace(r,\"-$1\").toLowerCase()},s={\"&\":\"&amp;\",\">\":\"&gt;\",\"<\":\"&lt;\",'\"':\"&quot;\",\"'\":\"&#x27;\"},o=/[&><\"']/g;function a(e){return String(e).replace(o,e=>s[e])}const l=function(e){return\"ordgroup\"===e.type||\"color\"===e.type?1===e.body.length?l(e.body[0]):e:\"font\"===e.type?l(e.body):e},i=function(e){const t=l(e);return\"mathord\"===t.type||\"textord\"===t.type||\"atom\"===t.type},c=function(e){return+e.toFixed(4)},m=\"acegıȷmnopqrsuvwxyzαγεηικμνοπρςστυχωϕ𝐚𝐜𝐞𝐠𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐮𝐯𝐰𝐱𝐲𝐳\",p=[\"__proto__\",\"prototype\",\"constructor\"];class u{constructor(e){e=e||{},this.displayMode=t(e,\"displayMode\",!1),this.annotate=t(e,\"annotate\",!1),this.leqno=t(e,\"leqno\",!1),this.throwOnError=t(e,\"throwOnError\",!1),this.errorColor=t(e,\"errorColor\",\"#b22222\"),this.macros=(e=>{if(null==e||\"object\"!=typeof e)return Object.create(null);for(const t of p)Object.prototype.hasOwnProperty.call(e,t)&&delete e[t];return Object.setPrototypeOf(e,null)})(Object.prototype.hasOwnProperty.call(e,\"macros\")?e.macros:void 0),this.wrap=t(e,\"wrap\",\"none\"),this.xml=t(e,\"xml\",!1),this.colorIsTextColor=t(e,\"colorIsTextColor\",!1),this.strict=t(e,\"strict\",!1),this.trust=t(e,\"trust\",!1);const r=Object.prototype.hasOwnProperty.call(e,\"maxSize\")?e.maxSize:void 0;this.maxSize=void 0===r?[1/0,1/0]:Array.isArray(r)?r:[1/0,1/0],this.maxExpand=Math.max(0,t(e,\"maxExpand\",1e3)),this.wrapDelimiterPairs=!0}isTrusted(e){if(e.url&&!e.protocol){const t=function(e){const t=/^[\\x00-\\x20]*([^\\\\/#?]*?)(:|&#0*58|&#x0*3a|&colon)/i.exec(e);return t?\":\"!==t[2]?null:/^[a-zA-Z][a-zA-Z0-9+\\-.]*$/.test(t[1])?t[1].toLowerCase():null:\"_relative\"}(e.url);if(null==t)return!1;e.protocol=t}const t=\"function\"==typeof this.trust?this.trust(e):this.trust;return Boolean(t)}}const d={},h={};function g({type:e,names:t,props:r,handler:n,mathmlBuilder:s}){const o={type:e,numArgs:r.numArgs,argTypes:r.argTypes,allowedInArgument:!!r.allowedInArgument,allowedInText:!!r.allowedInText,allowedInMath:void 0===r.allowedInMath||r.allowedInMath,numOptionalArgs:r.numOptionalArgs||0,infix:!!r.infix,primitive:!!r.primitive,handler:n};for(let e=0;e<t.length;++e)d[t[e]]=o;e&&s&&(h[e]=s)}function f({type:e,mathmlBuilder:t}){g({type:e,names:[],props:{numArgs:0},handler(){throw new Error(\"Should never be called.\")},mathmlBuilder:t})}const b=function(e){return\"ordgroup\"===e.type&&1===e.body.length?e.body[0]:e},y=function(e){return\"ordgroup\"===e.type?e.body:[e]};class w{constructor(e){this.children=e,this.classes=[],this.style={}}hasClass(e){return this.classes.includes(e)}toNode(){const e=document.createDocumentFragment();for(let t=0;t<this.children.length;t++)e.appendChild(this.children[t].toNode());return e}toMarkup(){let e=\"\";for(let t=0;t<this.children.length;t++)e+=this.children[t].toMarkup();return e}toText(){return this.children.map(e=>e.toText()).join(\"\")}}const x=function(e){return e.filter(e=>e).join(\" \")},k=function(e,t){this.classes=e||[],this.attributes={},this.style=t||{}},v=function(e){const t=document.createElement(e);t.className=x(this.classes);for(const e in this.style)Object.prototype.hasOwnProperty.call(this.style,e)&&(t.style[e]=this.style[e]);for(const e in this.attributes)Object.prototype.hasOwnProperty.call(this.attributes,e)&&t.setAttribute(e,this.attributes[e]);for(let e=0;e<this.children.length;e++)t.appendChild(this.children[e].toNode());return t},A=function(e){let t=`<${e}`;this.classes.length&&(t+=` class=\"${a(x(this.classes))}\"`);let r=\"\";for(const e in this.style)Object.prototype.hasOwnProperty.call(this.style,e)&&(r+=`${n(e)}:${this.style[e]};`);r&&(t+=` style=\"${r}\"`);for(const e in this.attributes)Object.prototype.hasOwnProperty.call(this.attributes,e)&&(t+=` ${e}=\"${a(this.attributes[e])}\"`);t+=\">\";for(let e=0;e<this.children.length;e++)t+=this.children[e].toMarkup();return t+=`</${e}>`,t};class T{constructor(e,t,r){k.call(this,e,r),this.children=t||[]}setAttribute(e,t){this.attributes[e]=t}toNode(){return v.call(this,\"span\")}toMarkup(){return A.call(this,\"span\")}}let S=class{constructor(e){this.text=e}toNode(){return document.createTextNode(this.text)}toMarkup(){return a(this.text)}};class O{constructor(e,t,r){this.href=e,this.classes=t,this.children=r||[]}toNode(){const e=document.createElement(\"a\");e.setAttribute(\"href\",this.href),this.classes.length>0&&(e.className=x(this.classes));for(let t=0;t<this.children.length;t++)e.appendChild(this.children[t].toNode());return e}toMarkup(){let e=`<a href='${a(this.href)}'`;this.classes.length>0&&(e+=` class=\"${a(x(this.classes))}\"`),e+=\">\";for(let t=0;t<this.children.length;t++)e+=this.children[t].toMarkup();return e+=\"</a>\",e}}class q{constructor(e,t,r){this.alt=t,this.src=e,this.classes=[\"mord\"],this.style=r}hasClass(e){return this.classes.includes(e)}toNode(){const e=document.createElement(\"img\");e.src=this.src,e.alt=this.alt,e.className=\"mord\";for(const t in this.style)Object.prototype.hasOwnProperty.call(this.style,t)&&(e.style[t]=this.style[t]);return e}toMarkup(){let e=`<img src='${this.src}' alt='${this.alt}'`,t=\"\";for(const e in this.style)Object.prototype.hasOwnProperty.call(this.style,e)&&(t+=`${n(e)}:${this.style[e]};`);return t&&(e+=` style=\"${a(t)}\"`),e+=\">\",e}}function B(e){return new w(e)}class C{constructor(e,t,r,n){this.type=e,this.attributes={},this.children=t||[],this.classes=r||[],this.style=n||{},this.label=\"\"}setAttribute(e,t){this.attributes[e]=t}getAttribute(e){return this.attributes[e]}setLabel(e){this.label=e}toNode(){const e=document.createElementNS(\"http://www.w3.org/1998/Math/MathML\",this.type);for(const t in this.attributes)Object.prototype.hasOwnProperty.call(this.attributes,t)&&e.setAttribute(t,this.attributes[t]);this.classes.length>0&&(e.className=x(this.classes));for(const t in this.style)Object.prototype.hasOwnProperty.call(this.style,t)&&(e.style[t]=this.style[t]);for(let t=0;t<this.children.length;t++)e.appendChild(this.children[t].toNode());return e}toMarkup(){let e=\"<\"+this.type;for(const t in this.attributes)Object.prototype.hasOwnProperty.call(this.attributes,t)&&(e+=\" \"+t+'=\"',e+=a(this.attributes[t]),e+='\"');this.classes.length>0&&(e+=` class=\"${a(x(this.classes))}\"`);let t=\"\";for(const e in this.style)Object.prototype.hasOwnProperty.call(this.style,e)&&(t+=`${n(e)}:${this.style[e]};`);t&&(e+=` style=\"${t}\"`),e+=\">\";for(let t=0;t<this.children.length;t++)e+=this.children[t].toMarkup();return e+=\"</\"+this.type+\">\",e}toText(){return this.children.map(e=>e.toText()).join(\"\")}}class N{constructor(e){this.text=e}toNode(){return document.createTextNode(this.text)}toMarkup(){return a(this.toText())}toText(){return this.text}}const z=e=>{let t;return 1===e.length&&\"mrow\"===e[0].type?(t=e.pop(),t.type=\"mstyle\"):t=new C(\"mstyle\",e),t},$=e=>{let t=0;if(e.body&&Array.isArray(e.body))for(const r of e.body)t+=$(r);else if(e.body)t+=$(e.body);else if(\"supsub\"===e.type)t+=$(e.base),e.sub&&(t+=.7*$(e.sub)),e.sup&&(t+=.7*$(e.sup));else if(\"mathord\"===e.type||\"textord\"===e.type)for(const r of e.text.split(\"\")){const e=r.codePointAt(0);t+=96<e&&e<123||944<e&&e<970?.56:47<e&&e<58?.5:.92}else t+=1;return t},E={widehat:\"ˆ\",widecheck:\"ˇ\",widetilde:\"~\",wideparen:\"⏜\",utilde:\"~\",overleftarrow:\"←\",underleftarrow:\"←\",xleftarrow:\"←\",overrightarrow:\"→\",underrightarrow:\"→\",xrightarrow:\"→\",underbrace:\"⏟\",overbrace:\"⏞\",overbracket:\"⎴\",underbracket:\"⎵\",overgroup:\"⏠\",overparen:\"⏜\",undergroup:\"⏡\",underparen:\"⏝\",overleftrightarrow:\"↔\",underleftrightarrow:\"↔\",xleftrightarrow:\"↔\",Overrightarrow:\"⇒\",xRightarrow:\"⇒\",overleftharpoon:\"↼\",xleftharpoonup:\"↼\",overrightharpoon:\"⇀\",xrightharpoonup:\"⇀\",xLeftarrow:\"⇐\",xLeftrightarrow:\"⇔\",xhookleftarrow:\"↩\",xhookrightarrow:\"↪\",xmapsto:\"↦\",xrightharpoondown:\"⇁\",xleftharpoondown:\"↽\",xtwoheadleftarrow:\"↞\",xtwoheadrightarrow:\"↠\",xlongequal:\"=\",xrightleftarrows:\"⇄\",xtofrom:\"⇄\",xleftrightharpoons:\"⇋\",xrightleftharpoons:\"⇌\",yields:\"→\",yieldsLeft:\"←\",mesomerism:\"↔\",longrightharpoonup:\"⇀\",longleftharpoondown:\"↽\",eqrightharpoonup:\"⇀\",eqleftharpoondown:\"↽\",\"\\\\cdrightarrow\":\"→\",\"\\\\cdleftarrow\":\"←\",\"\\\\cdlongequal\":\"=\",yieldsLeftRight:\"⇄\",chemequilibrium:\"⇌\"},I=function(e){const t=new N(E[e.slice(1)]),r=new C(\"mo\",[t]);return r.setAttribute(\"stretchy\",\"true\"),r},L=[\"\\\\widehat\",\"\\\\widecheck\"],F=e=>{const t=I(e.label);if(e.label.indexOf(\"tilde\")>-1){const r=$(e.base);1<r&&r<1.6?t.classes.push(\"tml-tilde-2\"):1.6<=r&&r<2.5?t.classes.push(\"tml-tilde-3\"):2.5<=r&&t.classes.push(\"tml-tilde-4\")}else if(L.includes(e.label)){const r=$(e.base);0<r&&r<=1?t.classes.push(\"tml-hat-1\"):1<r&&r<1.6?t.classes.push(\"tml-hat-2\"):1.6<=r&&r<2.5?t.classes.push(\"tml-hat-3\"):2.5<=r&&t.classes.push(\"tml-hat-4\")}return t},j={bin:1,close:1,inner:1,open:1,punct:1,rel:1},M={\"accent-token\":1,mathord:1,\"op-token\":1,spacing:1,textord:1},D=Object.create(null);function G(e,t,r,n,s){if(\"math\"!==e&&\"text\"!==e)throw new TypeError(`Invalid mode: ${e} called in defineSymbol`);const o={group:t,replace:r};D[e][n]=o,s&&r&&(D[e][r]=o)}D.math=Object.create(null),D.text=Object.create(null);const P=\"math\",R=\"text\",U=\"accent-token\",H=\"bin\",_=\"close\",V=\"inner\",W=\"mathord\",X=\"op-token\",Z=\"open\",Y=\"punct\",J=\"rel\",K=\"spacing\",Q=\"textord\";G(P,J,\"≡\",\"\\\\equiv\",!0),G(P,J,\"≺\",\"\\\\prec\",!0),G(P,J,\"≻\",\"\\\\succ\",!0),G(P,J,\"∼\",\"\\\\sim\",!0),G(P,J,\"⟂\",\"\\\\perp\",!0),G(P,J,\"⪯\",\"\\\\preceq\",!0),G(P,J,\"⪰\",\"\\\\succeq\",!0),G(P,J,\"≃\",\"\\\\simeq\",!0),G(P,J,\"≌\",\"\\\\backcong\",!0),G(P,J,\"|\",\"\\\\mid\",!0),G(P,J,\"≪\",\"\\\\ll\",!0),G(P,J,\"≫\",\"\\\\gg\",!0),G(P,J,\"≍\",\"\\\\asymp\",!0),G(P,J,\"∥\",\"\\\\parallel\"),G(P,J,\"⌣\",\"\\\\smile\",!0),G(P,J,\"⊑\",\"\\\\sqsubseteq\",!0),G(P,J,\"⊒\",\"\\\\sqsupseteq\",!0),G(P,J,\"≐\",\"\\\\doteq\",!0),G(P,J,\"⌢\",\"\\\\frown\",!0),G(P,J,\"∋\",\"\\\\ni\",!0),G(P,J,\"∌\",\"\\\\notni\",!0),G(P,J,\"∝\",\"\\\\propto\",!0),G(P,J,\"⊢\",\"\\\\vdash\",!0),G(P,J,\"⊣\",\"\\\\dashv\",!0),G(P,J,\"∋\",\"\\\\owns\"),G(P,J,\"≘\",\"\\\\arceq\",!0),G(P,J,\"≙\",\"\\\\wedgeq\",!0),G(P,J,\"≚\",\"\\\\veeeq\",!0),G(P,J,\"≛\",\"\\\\stareq\",!0),G(P,J,\"≝\",\"\\\\eqdef\",!0),G(P,J,\"≞\",\"\\\\measeq\",!0),G(P,J,\"≟\",\"\\\\questeq\",!0),G(P,J,\"≠\",\"\\\\ne\",!0),G(P,J,\"≠\",\"\\\\neq\"),G(P,J,\"⩵\",\"\\\\eqeq\",!0),G(P,J,\"⩶\",\"\\\\eqeqeq\",!0),G(P,J,\"∷\",\"\\\\dblcolon\",!0),G(P,J,\"≔\",\"\\\\coloneqq\",!0),G(P,J,\"≕\",\"\\\\eqqcolon\",!0),G(P,J,\"∹\",\"\\\\eqcolon\",!0),G(P,J,\"⩴\",\"\\\\Coloneqq\",!0),G(P,Y,\".\",\"\\\\ldotp\"),G(P,Y,\"·\",\"\\\\cdotp\"),G(P,Q,\"#\",\"\\\\#\"),G(R,Q,\"#\",\"\\\\#\"),G(P,Q,\"&\",\"\\\\&\"),G(R,Q,\"&\",\"\\\\&\"),G(P,Q,\"ℵ\",\"\\\\aleph\",!0),G(P,Q,\"∀\",\"\\\\forall\",!0),G(P,Q,\"ℏ\",\"\\\\hbar\",!0),G(P,Q,\"∃\",\"\\\\exists\",!0),G(P,Z,\"∇\",\"\\\\nabla\",!0),G(P,Q,\"♭\",\"\\\\flat\",!0),G(P,Q,\"ℓ\",\"\\\\ell\",!0),G(P,Q,\"♮\",\"\\\\natural\",!0),G(P,Q,\"Å\",\"\\\\Angstrom\",!0),G(R,Q,\"Å\",\"\\\\Angstrom\",!0),G(P,Q,\"♣\",\"\\\\clubsuit\",!0),G(P,Q,\"♧\",\"\\\\varclubsuit\",!0),G(P,Q,\"℘\",\"\\\\wp\",!0),G(P,Q,\"♯\",\"\\\\sharp\",!0),G(P,Q,\"♢\",\"\\\\diamondsuit\",!0),G(P,Q,\"♦\",\"\\\\vardiamondsuit\",!0),G(P,Q,\"ℜ\",\"\\\\Re\",!0),G(P,Q,\"♡\",\"\\\\heartsuit\",!0),G(P,Q,\"♥\",\"\\\\varheartsuit\",!0),G(P,Q,\"ℑ\",\"\\\\Im\",!0),G(P,Q,\"♠\",\"\\\\spadesuit\",!0),G(P,Q,\"♤\",\"\\\\varspadesuit\",!0),G(P,Q,\"♀\",\"\\\\female\",!0),G(P,Q,\"♂\",\"\\\\male\",!0),G(P,Q,\"§\",\"\\\\S\",!0),G(R,Q,\"§\",\"\\\\S\"),G(P,Q,\"¶\",\"\\\\P\",!0),G(R,Q,\"¶\",\"\\\\P\"),G(R,Q,\"☺\",\"\\\\smiley\",!0),G(P,Q,\"☺\",\"\\\\smiley\",!0),G(P,Q,\"†\",\"\\\\dag\"),G(R,Q,\"†\",\"\\\\dag\"),G(R,Q,\"†\",\"\\\\textdagger\"),G(P,Q,\"‡\",\"\\\\ddag\"),G(R,Q,\"‡\",\"\\\\ddag\"),G(R,Q,\"‡\",\"\\\\textdaggerdbl\"),G(P,_,\"⎱\",\"\\\\rmoustache\",!0),G(P,Z,\"⎰\",\"\\\\lmoustache\",!0),G(P,_,\"⟯\",\"\\\\rgroup\",!0),G(P,Z,\"⟮\",\"\\\\lgroup\",!0),G(P,H,\"∓\",\"\\\\mp\",!0),G(P,H,\"⊖\",\"\\\\ominus\",!0),G(P,H,\"⊎\",\"\\\\uplus\",!0),G(P,H,\"⊓\",\"\\\\sqcap\",!0),G(P,H,\"∗\",\"\\\\ast\"),G(P,H,\"⊔\",\"\\\\sqcup\",!0),G(P,H,\"◯\",\"\\\\bigcirc\",!0),G(P,H,\"∙\",\"\\\\bullet\",!0),G(P,H,\"‡\",\"\\\\ddagger\"),G(P,H,\"≀\",\"\\\\wr\",!0),G(P,H,\"⨿\",\"\\\\amalg\"),G(P,H,\"&\",\"\\\\And\"),G(P,H,\"⫽\",\"\\\\sslash\",!0),G(P,J,\"⟵\",\"\\\\longleftarrow\",!0),G(P,J,\"⇐\",\"\\\\Leftarrow\",!0),G(P,J,\"⟸\",\"\\\\Longleftarrow\",!0),G(P,J,\"⟶\",\"\\\\longrightarrow\",!0),G(P,J,\"⇒\",\"\\\\Rightarrow\",!0),G(P,J,\"⟹\",\"\\\\Longrightarrow\",!0),G(P,J,\"↔\",\"\\\\leftrightarrow\",!0),G(P,J,\"⟷\",\"\\\\longleftrightarrow\",!0),G(P,J,\"⇔\",\"\\\\Leftrightarrow\",!0),G(P,J,\"⟺\",\"\\\\Longleftrightarrow\",!0),G(P,J,\"↤\",\"\\\\mapsfrom\",!0),G(P,J,\"↦\",\"\\\\mapsto\",!0),G(P,J,\"⟼\",\"\\\\longmapsto\",!0),G(P,J,\"↗\",\"\\\\nearrow\",!0),G(P,J,\"↩\",\"\\\\hookleftarrow\",!0),G(P,J,\"↪\",\"\\\\hookrightarrow\",!0),G(P,J,\"↘\",\"\\\\searrow\",!0),G(P,J,\"↼\",\"\\\\leftharpoonup\",!0),G(P,J,\"⇀\",\"\\\\rightharpoonup\",!0),G(P,J,\"↙\",\"\\\\swarrow\",!0),G(P,J,\"↽\",\"\\\\leftharpoondown\",!0),G(P,J,\"⇁\",\"\\\\rightharpoondown\",!0),G(P,J,\"↖\",\"\\\\nwarrow\",!0),G(P,J,\"⇌\",\"\\\\rightleftharpoons\",!0),G(P,W,\"↯\",\"\\\\lightning\",!0),G(P,W,\"∎\",\"\\\\QED\",!0),G(P,W,\"‰\",\"\\\\permil\",!0),G(R,Q,\"‰\",\"\\\\permil\"),G(P,W,\"☉\",\"\\\\astrosun\",!0),G(P,W,\"☼\",\"\\\\sun\",!0),G(P,W,\"☾\",\"\\\\leftmoon\",!0),G(P,W,\"☽\",\"\\\\rightmoon\",!0),G(P,W,\"⊕\",\"\\\\Earth\"),G(P,J,\"≮\",\"\\\\nless\",!0),G(P,J,\"⪇\",\"\\\\lneq\",!0),G(P,J,\"≨\",\"\\\\lneqq\",!0),G(P,J,\"≨︀\",\"\\\\lvertneqq\"),G(P,J,\"⋦\",\"\\\\lnsim\",!0),G(P,J,\"⪉\",\"\\\\lnapprox\",!0),G(P,J,\"⊀\",\"\\\\nprec\",!0),G(P,J,\"⋠\",\"\\\\npreceq\",!0),G(P,J,\"⋨\",\"\\\\precnsim\",!0),G(P,J,\"⪹\",\"\\\\precnapprox\",!0),G(P,J,\"≁\",\"\\\\nsim\",!0),G(P,J,\"∤\",\"\\\\nmid\",!0),G(P,J,\"∤\",\"\\\\nshortmid\"),G(P,J,\"⊬\",\"\\\\nvdash\",!0),G(P,J,\"⊭\",\"\\\\nvDash\",!0),G(P,J,\"⋪\",\"\\\\ntriangleleft\"),G(P,J,\"⋬\",\"\\\\ntrianglelefteq\",!0),G(P,J,\"⊄\",\"\\\\nsubset\",!0),G(P,J,\"⊅\",\"\\\\nsupset\",!0),G(P,J,\"⊊\",\"\\\\subsetneq\",!0),G(P,J,\"⊊︀\",\"\\\\varsubsetneq\"),G(P,J,\"⫋\",\"\\\\subsetneqq\",!0),G(P,J,\"⫋︀\",\"\\\\varsubsetneqq\"),G(P,J,\"≯\",\"\\\\ngtr\",!0),G(P,J,\"⪈\",\"\\\\gneq\",!0),G(P,J,\"≩\",\"\\\\gneqq\",!0),G(P,J,\"≩︀\",\"\\\\gvertneqq\"),G(P,J,\"⋧\",\"\\\\gnsim\",!0),G(P,J,\"⪊\",\"\\\\gnapprox\",!0),G(P,J,\"⊁\",\"\\\\nsucc\",!0),G(P,J,\"⋡\",\"\\\\nsucceq\",!0),G(P,J,\"⋩\",\"\\\\succnsim\",!0),G(P,J,\"⪺\",\"\\\\succnapprox\",!0),G(P,J,\"≆\",\"\\\\ncong\",!0),G(P,J,\"∦\",\"\\\\nparallel\",!0),G(P,J,\"∦\",\"\\\\nshortparallel\"),G(P,J,\"⊯\",\"\\\\nVDash\",!0),G(P,J,\"⋫\",\"\\\\ntriangleright\"),G(P,J,\"⋭\",\"\\\\ntrianglerighteq\",!0),G(P,J,\"⊋\",\"\\\\supsetneq\",!0),G(P,J,\"⊋\",\"\\\\varsupsetneq\"),G(P,J,\"⫌\",\"\\\\supsetneqq\",!0),G(P,J,\"⫌︀\",\"\\\\varsupsetneqq\"),G(P,J,\"⊮\",\"\\\\nVdash\",!0),G(P,J,\"⪵\",\"\\\\precneqq\",!0),G(P,J,\"⪶\",\"\\\\succneqq\",!0),G(P,H,\"⊴\",\"\\\\unlhd\"),G(P,H,\"⊵\",\"\\\\unrhd\"),G(P,J,\"↚\",\"\\\\nleftarrow\",!0),G(P,J,\"↛\",\"\\\\nrightarrow\",!0),G(P,J,\"⇍\",\"\\\\nLeftarrow\",!0),G(P,J,\"⇏\",\"\\\\nRightarrow\",!0),G(P,J,\"↮\",\"\\\\nleftrightarrow\",!0),G(P,J,\"⇎\",\"\\\\nLeftrightarrow\",!0),G(P,J,\"△\",\"\\\\vartriangle\"),G(P,Q,\"ℏ\",\"\\\\hslash\"),G(P,Q,\"▽\",\"\\\\triangledown\"),G(P,Q,\"◊\",\"\\\\lozenge\"),G(P,Q,\"Ⓢ\",\"\\\\circledS\"),G(P,Q,\"®\",\"\\\\circledR\",!0),G(R,Q,\"®\",\"\\\\circledR\"),G(R,Q,\"®\",\"\\\\textregistered\"),G(P,Q,\"∡\",\"\\\\measuredangle\",!0),G(P,Q,\"∄\",\"\\\\nexists\"),G(P,Q,\"℧\",\"\\\\mho\"),G(P,Q,\"Ⅎ\",\"\\\\Finv\",!0),G(P,Q,\"⅁\",\"\\\\Game\",!0),G(P,Q,\"‵\",\"\\\\backprime\"),G(P,Q,\"‶\",\"\\\\backdprime\"),G(P,Q,\"‷\",\"\\\\backtrprime\"),G(P,Q,\"▲\",\"\\\\blacktriangle\"),G(P,Q,\"▼\",\"\\\\blacktriangledown\"),G(P,Q,\"■\",\"\\\\blacksquare\"),G(P,Q,\"⧫\",\"\\\\blacklozenge\"),G(P,Q,\"★\",\"\\\\bigstar\"),G(P,Q,\"∢\",\"\\\\sphericalangle\",!0),G(P,Q,\"∁\",\"\\\\complement\",!0),G(P,Q,\"╱\",\"\\\\diagup\"),G(P,Q,\"╲\",\"\\\\diagdown\"),G(P,Q,\"□\",\"\\\\square\"),G(P,Q,\"□\",\"\\\\Box\"),G(P,Q,\"◊\",\"\\\\Diamond\"),G(P,Q,\"¥\",\"\\\\yen\",!0),G(R,Q,\"¥\",\"\\\\yen\",!0),G(P,Q,\"✓\",\"\\\\checkmark\",!0),G(R,Q,\"✓\",\"\\\\checkmark\"),G(P,Q,\"✗\",\"\\\\ballotx\",!0),G(R,Q,\"✗\",\"\\\\ballotx\"),G(R,Q,\"•\",\"\\\\textbullet\"),G(P,Q,\"ℶ\",\"\\\\beth\",!0),G(P,Q,\"ℸ\",\"\\\\daleth\",!0),G(P,Q,\"ℷ\",\"\\\\gimel\",!0),G(P,Q,\"ϝ\",\"\\\\digamma\",!0),G(P,Q,\"ϰ\",\"\\\\varkappa\"),G(P,Z,\"⌜\",\"\\\\ulcorner\",!0),G(P,_,\"⌝\",\"\\\\urcorner\",!0),G(P,Z,\"⌞\",\"\\\\llcorner\",!0),G(P,_,\"⌟\",\"\\\\lrcorner\",!0),G(P,J,\"≦\",\"\\\\leqq\",!0),G(P,J,\"⩽\",\"\\\\leqslant\",!0),G(P,J,\"⪕\",\"\\\\eqslantless\",!0),G(P,J,\"≲\",\"\\\\lesssim\",!0),G(P,J,\"⪅\",\"\\\\lessapprox\",!0),G(P,J,\"≊\",\"\\\\approxeq\",!0),G(P,H,\"⋖\",\"\\\\lessdot\"),G(P,J,\"⋘\",\"\\\\lll\",!0),G(P,J,\"≶\",\"\\\\lessgtr\",!0),G(P,J,\"⋚\",\"\\\\lesseqgtr\",!0),G(P,J,\"⪋\",\"\\\\lesseqqgtr\",!0),G(P,J,\"≑\",\"\\\\doteqdot\"),G(P,J,\"≓\",\"\\\\risingdotseq\",!0),G(P,J,\"≒\",\"\\\\fallingdotseq\",!0),G(P,J,\"∽\",\"\\\\backsim\",!0),G(P,J,\"⋍\",\"\\\\backsimeq\",!0),G(P,J,\"⫅\",\"\\\\subseteqq\",!0),G(P,J,\"⋐\",\"\\\\Subset\",!0),G(P,J,\"⊏\",\"\\\\sqsubset\",!0),G(P,J,\"≼\",\"\\\\preccurlyeq\",!0),G(P,J,\"⋞\",\"\\\\curlyeqprec\",!0),G(P,J,\"≾\",\"\\\\precsim\",!0),G(P,J,\"⪷\",\"\\\\precapprox\",!0),G(P,J,\"⊲\",\"\\\\vartriangleleft\"),G(P,J,\"⊴\",\"\\\\trianglelefteq\"),G(P,J,\"⊨\",\"\\\\vDash\",!0),G(P,J,\"⊫\",\"\\\\VDash\",!0),G(P,J,\"⊪\",\"\\\\Vvdash\",!0),G(P,J,\"⌣\",\"\\\\smallsmile\"),G(P,J,\"⌢\",\"\\\\smallfrown\"),G(P,J,\"≏\",\"\\\\bumpeq\",!0),G(P,J,\"≎\",\"\\\\Bumpeq\",!0),G(P,J,\"≧\",\"\\\\geqq\",!0),G(P,J,\"⩾\",\"\\\\geqslant\",!0),G(P,J,\"⪖\",\"\\\\eqslantgtr\",!0),G(P,J,\"≳\",\"\\\\gtrsim\",!0),G(P,J,\"⪆\",\"\\\\gtrapprox\",!0),G(P,H,\"⋗\",\"\\\\gtrdot\"),G(P,J,\"⋙\",\"\\\\ggg\",!0),G(P,J,\"≷\",\"\\\\gtrless\",!0),G(P,J,\"⋛\",\"\\\\gtreqless\",!0),G(P,J,\"⪌\",\"\\\\gtreqqless\",!0),G(P,J,\"≖\",\"\\\\eqcirc\",!0),G(P,J,\"≗\",\"\\\\circeq\",!0),G(P,J,\"≜\",\"\\\\triangleq\",!0),G(P,J,\"∼\",\"\\\\thicksim\"),G(P,J,\"≈\",\"\\\\thickapprox\"),G(P,J,\"⫆\",\"\\\\supseteqq\",!0),G(P,J,\"⋑\",\"\\\\Supset\",!0),G(P,J,\"⊐\",\"\\\\sqsupset\",!0),G(P,J,\"≽\",\"\\\\succcurlyeq\",!0),G(P,J,\"⋟\",\"\\\\curlyeqsucc\",!0),G(P,J,\"≿\",\"\\\\succsim\",!0),G(P,J,\"⪸\",\"\\\\succapprox\",!0),G(P,J,\"⊳\",\"\\\\vartriangleright\"),G(P,J,\"⊵\",\"\\\\trianglerighteq\"),G(P,J,\"⊩\",\"\\\\Vdash\",!0),G(P,J,\"∣\",\"\\\\shortmid\"),G(P,J,\"∥\",\"\\\\shortparallel\"),G(P,J,\"≬\",\"\\\\between\",!0),G(P,J,\"⋔\",\"\\\\pitchfork\",!0),G(P,J,\"∝\",\"\\\\varpropto\"),G(P,J,\"◀\",\"\\\\blacktriangleleft\"),G(P,J,\"∴\",\"\\\\therefore\",!0),G(P,J,\"∍\",\"\\\\backepsilon\"),G(P,J,\"▶\",\"\\\\blacktriangleright\"),G(P,J,\"∵\",\"\\\\because\",!0),G(P,J,\"⋘\",\"\\\\llless\"),G(P,J,\"⋙\",\"\\\\gggtr\"),G(P,H,\"⊲\",\"\\\\lhd\"),G(P,H,\"⊳\",\"\\\\rhd\"),G(P,J,\"≂\",\"\\\\eqsim\",!0),G(P,J,\"≑\",\"\\\\Doteq\",!0),G(P,J,\"⥽\",\"\\\\strictif\",!0),G(P,J,\"⥼\",\"\\\\strictfi\",!0),G(P,H,\"∔\",\"\\\\dotplus\",!0),G(P,H,\"∖\",\"\\\\smallsetminus\"),G(P,H,\"⋒\",\"\\\\Cap\",!0),G(P,H,\"⋓\",\"\\\\Cup\",!0),G(P,H,\"⩞\",\"\\\\doublebarwedge\",!0),G(P,H,\"⊟\",\"\\\\boxminus\",!0),G(P,H,\"⊞\",\"\\\\boxplus\",!0),G(P,H,\"⧄\",\"\\\\boxslash\",!0),G(P,H,\"⋇\",\"\\\\divideontimes\",!0),G(P,H,\"⋉\",\"\\\\ltimes\",!0),G(P,H,\"⋊\",\"\\\\rtimes\",!0),G(P,H,\"⋋\",\"\\\\leftthreetimes\",!0),G(P,H,\"⋌\",\"\\\\rightthreetimes\",!0),G(P,H,\"⋏\",\"\\\\curlywedge\",!0),G(P,H,\"⋎\",\"\\\\curlyvee\",!0),G(P,H,\"⊝\",\"\\\\circleddash\",!0),G(P,H,\"⊛\",\"\\\\circledast\",!0),G(P,H,\"⊺\",\"\\\\intercal\",!0),G(P,H,\"⋒\",\"\\\\doublecap\"),G(P,H,\"⋓\",\"\\\\doublecup\"),G(P,H,\"⊠\",\"\\\\boxtimes\",!0),G(P,H,\"⋈\",\"\\\\bowtie\",!0),G(P,H,\"⋈\",\"\\\\Join\"),G(P,H,\"⟕\",\"\\\\leftouterjoin\",!0),G(P,H,\"⟖\",\"\\\\rightouterjoin\",!0),G(P,H,\"⟗\",\"\\\\fullouterjoin\",!0),G(P,H,\"∸\",\"\\\\dotminus\",!0),G(P,H,\"⟑\",\"\\\\wedgedot\",!0),G(P,H,\"⟇\",\"\\\\veedot\",!0),G(P,H,\"⩢\",\"\\\\doublebarvee\",!0),G(P,H,\"⩣\",\"\\\\veedoublebar\",!0),G(P,H,\"⩟\",\"\\\\wedgebar\",!0),G(P,H,\"⩠\",\"\\\\wedgedoublebar\",!0),G(P,H,\"⩔\",\"\\\\Vee\",!0),G(P,H,\"⩓\",\"\\\\Wedge\",!0),G(P,H,\"⩃\",\"\\\\barcap\",!0),G(P,H,\"⩂\",\"\\\\barcup\",!0),G(P,H,\"⩈\",\"\\\\capbarcup\",!0),G(P,H,\"⩀\",\"\\\\capdot\",!0),G(P,H,\"⩇\",\"\\\\capovercup\",!0),G(P,H,\"⩆\",\"\\\\cupovercap\",!0),G(P,H,\"⩍\",\"\\\\closedvarcap\",!0),G(P,H,\"⩌\",\"\\\\closedvarcup\",!0),G(P,H,\"⨪\",\"\\\\minusdot\",!0),G(P,H,\"⨫\",\"\\\\minusfdots\",!0),G(P,H,\"⨬\",\"\\\\minusrdots\",!0),G(P,H,\"⊻\",\"\\\\Xor\",!0),G(P,H,\"⊼\",\"\\\\Nand\",!0),G(P,H,\"⊽\",\"\\\\Nor\",!0),G(P,H,\"⊽\",\"\\\\barvee\"),G(P,H,\"⫴\",\"\\\\interleave\",!0),G(P,H,\"⧢\",\"\\\\shuffle\",!0),G(P,H,\"⫶\",\"\\\\threedotcolon\",!0),G(P,H,\"⦂\",\"\\\\typecolon\",!0),G(P,H,\"∾\",\"\\\\invlazys\",!0),G(P,H,\"⩋\",\"\\\\twocaps\",!0),G(P,H,\"⩊\",\"\\\\twocups\",!0),G(P,H,\"⩎\",\"\\\\Sqcap\",!0),G(P,H,\"⩏\",\"\\\\Sqcup\",!0),G(P,H,\"⩖\",\"\\\\veeonvee\",!0),G(P,H,\"⩕\",\"\\\\wedgeonwedge\",!0),G(P,H,\"⧗\",\"\\\\blackhourglass\",!0),G(P,H,\"⧆\",\"\\\\boxast\",!0),G(P,H,\"⧈\",\"\\\\boxbox\",!0),G(P,H,\"⧇\",\"\\\\boxcircle\",!0),G(P,H,\"⊜\",\"\\\\circledequal\",!0),G(P,H,\"⦷\",\"\\\\circledparallel\",!0),G(P,H,\"⦶\",\"\\\\circledvert\",!0),G(P,H,\"⦵\",\"\\\\circlehbar\",!0),G(P,H,\"⟡\",\"\\\\concavediamond\",!0),G(P,H,\"⟢\",\"\\\\concavediamondtickleft\",!0),G(P,H,\"⟣\",\"\\\\concavediamondtickright\",!0),G(P,H,\"⋄\",\"\\\\diamond\",!0),G(P,H,\"⧖\",\"\\\\hourglass\",!0),G(P,H,\"⟠\",\"\\\\lozengeminus\",!0),G(P,H,\"⌽\",\"\\\\obar\",!0),G(P,H,\"⦸\",\"\\\\obslash\",!0),G(P,H,\"⨸\",\"\\\\odiv\",!0),G(P,H,\"⧁\",\"\\\\ogreaterthan\",!0),G(P,H,\"⧀\",\"\\\\olessthan\",!0),G(P,H,\"⦹\",\"\\\\operp\",!0),G(P,H,\"⨷\",\"\\\\Otimes\",!0),G(P,H,\"⨶\",\"\\\\otimeshat\",!0),G(P,H,\"⋆\",\"\\\\star\",!0),G(P,H,\"△\",\"\\\\triangle\",!0),G(P,H,\"⨺\",\"\\\\triangleminus\",!0),G(P,H,\"⨹\",\"\\\\triangleplus\",!0),G(P,H,\"⨻\",\"\\\\triangletimes\",!0),G(P,H,\"⟤\",\"\\\\whitesquaretickleft\",!0),G(P,H,\"⟥\",\"\\\\whitesquaretickright\",!0),G(P,H,\"⨳\",\"\\\\smashtimes\",!0),G(P,J,\"⇢\",\"\\\\dashrightarrow\",!0),G(P,J,\"⇠\",\"\\\\dashleftarrow\",!0),G(P,J,\"⇇\",\"\\\\leftleftarrows\",!0),G(P,J,\"⇆\",\"\\\\leftrightarrows\",!0),G(P,J,\"⇚\",\"\\\\Lleftarrow\",!0),G(P,J,\"↞\",\"\\\\twoheadleftarrow\",!0),G(P,J,\"↢\",\"\\\\leftarrowtail\",!0),G(P,J,\"↫\",\"\\\\looparrowleft\",!0),G(P,J,\"⇋\",\"\\\\leftrightharpoons\",!0),G(P,J,\"↶\",\"\\\\curvearrowleft\",!0),G(P,J,\"↺\",\"\\\\circlearrowleft\",!0),G(P,J,\"↰\",\"\\\\Lsh\",!0),G(P,J,\"⇈\",\"\\\\upuparrows\",!0),G(P,J,\"↿\",\"\\\\upharpoonleft\",!0),G(P,J,\"⇃\",\"\\\\downharpoonleft\",!0),G(P,J,\"⊶\",\"\\\\origof\",!0),G(P,J,\"⊷\",\"\\\\imageof\",!0),G(P,J,\"⊸\",\"\\\\multimap\",!0),G(P,J,\"↭\",\"\\\\leftrightsquigarrow\",!0),G(P,J,\"⇉\",\"\\\\rightrightarrows\",!0),G(P,J,\"⇄\",\"\\\\rightleftarrows\",!0),G(P,J,\"↠\",\"\\\\twoheadrightarrow\",!0),G(P,J,\"↣\",\"\\\\rightarrowtail\",!0),G(P,J,\"↬\",\"\\\\looparrowright\",!0),G(P,J,\"↷\",\"\\\\curvearrowright\",!0),G(P,J,\"↻\",\"\\\\circlearrowright\",!0),G(P,J,\"↱\",\"\\\\Rsh\",!0),G(P,J,\"⇊\",\"\\\\downdownarrows\",!0),G(P,J,\"↾\",\"\\\\upharpoonright\",!0),G(P,J,\"⇂\",\"\\\\downharpoonright\",!0),G(P,J,\"⇝\",\"\\\\rightsquigarrow\",!0),G(P,J,\"⇝\",\"\\\\leadsto\"),G(P,J,\"⇛\",\"\\\\Rrightarrow\",!0),G(P,J,\"↾\",\"\\\\restriction\"),G(P,Q,\"‘\",\"`\"),G(P,Q,\"$\",\"\\\\$\"),G(R,Q,\"$\",\"\\\\$\"),G(R,Q,\"$\",\"\\\\textdollar\"),G(P,Q,\"¢\",\"\\\\cent\"),G(R,Q,\"¢\",\"\\\\cent\"),G(P,Q,\"%\",\"\\\\%\"),G(R,Q,\"%\",\"\\\\%\"),G(P,Q,\"_\",\"\\\\_\"),G(R,Q,\"_\",\"\\\\_\"),G(R,Q,\"_\",\"\\\\textunderscore\"),G(R,Q,\"␣\",\"\\\\textvisiblespace\",!0),G(P,Q,\"∠\",\"\\\\angle\",!0),G(P,Q,\"∞\",\"\\\\infty\",!0),G(P,Q,\"′\",\"\\\\prime\"),G(P,Q,\"″\",\"\\\\dprime\"),G(P,Q,\"‴\",\"\\\\trprime\"),G(P,Q,\"⁗\",\"\\\\qprime\"),G(P,Q,\"△\",\"\\\\triangle\"),G(R,Q,\"Α\",\"\\\\Alpha\",!0),G(R,Q,\"Β\",\"\\\\Beta\",!0),G(R,Q,\"Γ\",\"\\\\Gamma\",!0),G(R,Q,\"Δ\",\"\\\\Delta\",!0),G(R,Q,\"Ε\",\"\\\\Epsilon\",!0),G(R,Q,\"Ζ\",\"\\\\Zeta\",!0),G(R,Q,\"Η\",\"\\\\Eta\",!0),G(R,Q,\"Θ\",\"\\\\Theta\",!0),G(R,Q,\"Ι\",\"\\\\Iota\",!0),G(R,Q,\"Κ\",\"\\\\Kappa\",!0),G(R,Q,\"Λ\",\"\\\\Lambda\",!0),G(R,Q,\"Μ\",\"\\\\Mu\",!0),G(R,Q,\"Ν\",\"\\\\Nu\",!0),G(R,Q,\"Ξ\",\"\\\\Xi\",!0),G(R,Q,\"Ο\",\"\\\\Omicron\",!0),G(R,Q,\"Π\",\"\\\\Pi\",!0),G(R,Q,\"Ρ\",\"\\\\Rho\",!0),G(R,Q,\"Σ\",\"\\\\Sigma\",!0),G(R,Q,\"Τ\",\"\\\\Tau\",!0),G(R,Q,\"Υ\",\"\\\\Upsilon\",!0),G(R,Q,\"Φ\",\"\\\\Phi\",!0),G(R,Q,\"Χ\",\"\\\\Chi\",!0),G(R,Q,\"Ψ\",\"\\\\Psi\",!0),G(R,Q,\"Ω\",\"\\\\Omega\",!0),G(P,W,\"Α\",\"\\\\Alpha\",!0),G(P,W,\"Β\",\"\\\\Beta\",!0),G(P,W,\"Γ\",\"\\\\Gamma\",!0),G(P,W,\"Δ\",\"\\\\Delta\",!0),G(P,W,\"Ε\",\"\\\\Epsilon\",!0),G(P,W,\"Ζ\",\"\\\\Zeta\",!0),G(P,W,\"Η\",\"\\\\Eta\",!0),G(P,W,\"Θ\",\"\\\\Theta\",!0),G(P,W,\"Ι\",\"\\\\Iota\",!0),G(P,W,\"Κ\",\"\\\\Kappa\",!0),G(P,W,\"Λ\",\"\\\\Lambda\",!0),G(P,W,\"Μ\",\"\\\\Mu\",!0),G(P,W,\"Ν\",\"\\\\Nu\",!0),G(P,W,\"Ξ\",\"\\\\Xi\",!0),G(P,W,\"Ο\",\"\\\\Omicron\",!0),G(P,W,\"Π\",\"\\\\Pi\",!0),G(P,W,\"Ρ\",\"\\\\Rho\",!0),G(P,W,\"Σ\",\"\\\\Sigma\",!0),G(P,W,\"Τ\",\"\\\\Tau\",!0),G(P,W,\"Υ\",\"\\\\Upsilon\",!0),G(P,W,\"Φ\",\"\\\\Phi\",!0),G(P,W,\"Χ\",\"\\\\Chi\",!0),G(P,W,\"Ψ\",\"\\\\Psi\",!0),G(P,W,\"Ω\",\"\\\\Omega\",!0),G(P,Z,\"¬\",\"\\\\neg\",!0),G(P,Z,\"¬\",\"\\\\lnot\"),G(P,Q,\"⊤\",\"\\\\top\"),G(P,Q,\"⊥\",\"\\\\bot\"),G(P,Q,\"∅\",\"\\\\emptyset\"),G(P,Q,\"⌀\",\"\\\\varnothing\"),G(P,W,\"α\",\"\\\\alpha\",!0),G(P,W,\"β\",\"\\\\beta\",!0),G(P,W,\"γ\",\"\\\\gamma\",!0),G(P,W,\"δ\",\"\\\\delta\",!0),G(P,W,\"ϵ\",\"\\\\epsilon\",!0),G(P,W,\"ζ\",\"\\\\zeta\",!0),G(P,W,\"η\",\"\\\\eta\",!0),G(P,W,\"θ\",\"\\\\theta\",!0),G(P,W,\"ι\",\"\\\\iota\",!0),G(P,W,\"κ\",\"\\\\kappa\",!0),G(P,W,\"λ\",\"\\\\lambda\",!0),G(P,W,\"μ\",\"\\\\mu\",!0),G(P,W,\"ν\",\"\\\\nu\",!0),G(P,W,\"ξ\",\"\\\\xi\",!0),G(P,W,\"ο\",\"\\\\omicron\",!0),G(P,W,\"π\",\"\\\\pi\",!0),G(P,W,\"ρ\",\"\\\\rho\",!0),G(P,W,\"σ\",\"\\\\sigma\",!0),G(P,W,\"τ\",\"\\\\tau\",!0),G(P,W,\"υ\",\"\\\\upsilon\",!0),G(P,W,\"ϕ\",\"\\\\phi\",!0),G(P,W,\"χ\",\"\\\\chi\",!0),G(P,W,\"ψ\",\"\\\\psi\",!0),G(P,W,\"ω\",\"\\\\omega\",!0),G(P,W,\"ε\",\"\\\\varepsilon\",!0),G(P,W,\"ϑ\",\"\\\\vartheta\",!0),G(P,W,\"ϖ\",\"\\\\varpi\",!0),G(P,W,\"ϱ\",\"\\\\varrho\",!0),G(P,W,\"ς\",\"\\\\varsigma\",!0),G(P,W,\"φ\",\"\\\\varphi\",!0),G(P,W,\"Ϙ\",\"\\\\Coppa\",!0),G(P,W,\"ϙ\",\"\\\\coppa\",!0),G(P,W,\"ϙ\",\"\\\\varcoppa\",!0),G(P,W,\"Ϟ\",\"\\\\Koppa\",!0),G(P,W,\"ϟ\",\"\\\\koppa\",!0),G(P,W,\"Ϡ\",\"\\\\Sampi\",!0),G(P,W,\"ϡ\",\"\\\\sampi\",!0),G(P,W,\"Ϛ\",\"\\\\Stigma\",!0),G(P,W,\"ϛ\",\"\\\\stigma\",!0),G(P,W,\"⫫\",\"\\\\Bot\"),G(P,Q,\"ð\",\"\\\\eth\",!0),G(R,Q,\"ð\",\"ð\"),G(P,Q,\"Å\",\"\\\\AA\"),G(R,Q,\"Å\",\"\\\\AA\",!0),G(P,Q,\"Æ\",\"\\\\AE\",!0),G(R,Q,\"Æ\",\"\\\\AE\",!0),G(P,Q,\"Ð\",\"\\\\DH\",!0),G(R,Q,\"Ð\",\"\\\\DH\",!0),G(P,Q,\"Þ\",\"\\\\TH\",!0),G(R,Q,\"Þ\",\"\\\\TH\",!0),G(P,Q,\"ß\",\"\\\\ss\",!0),G(R,Q,\"ß\",\"\\\\ss\",!0),G(P,Q,\"å\",\"\\\\aa\"),G(R,Q,\"å\",\"\\\\aa\",!0),G(P,Q,\"æ\",\"\\\\ae\",!0),G(R,Q,\"æ\",\"\\\\ae\",!0),G(P,Q,\"ð\",\"\\\\dh\"),G(R,Q,\"ð\",\"\\\\dh\",!0),G(P,Q,\"þ\",\"\\\\th\",!0),G(R,Q,\"þ\",\"\\\\th\",!0),G(P,Q,\"Đ\",\"\\\\DJ\",!0),G(R,Q,\"Đ\",\"\\\\DJ\",!0),G(P,Q,\"đ\",\"\\\\dj\",!0),G(R,Q,\"đ\",\"\\\\dj\",!0),G(P,Q,\"Ł\",\"\\\\L\",!0),G(R,Q,\"Ł\",\"\\\\L\",!0),G(P,Q,\"Ł\",\"\\\\l\",!0),G(R,Q,\"Ł\",\"\\\\l\",!0),G(P,Q,\"Ŋ\",\"\\\\NG\",!0),G(R,Q,\"Ŋ\",\"\\\\NG\",!0),G(P,Q,\"ŋ\",\"\\\\ng\",!0),G(R,Q,\"ŋ\",\"\\\\ng\",!0),G(P,Q,\"Œ\",\"\\\\OE\",!0),G(R,Q,\"Œ\",\"\\\\OE\",!0),G(P,Q,\"œ\",\"\\\\oe\",!0),G(R,Q,\"œ\",\"\\\\oe\",!0),G(P,H,\"∗\",\"∗\",!0),G(P,H,\"+\",\"+\"),G(P,H,\"∗\",\"*\"),G(P,H,\"⁄\",\"/\",!0),G(P,H,\"⁄\",\"⁄\"),G(P,H,\"−\",\"-\",!0),G(P,H,\"⋅\",\"\\\\cdot\",!0),G(P,H,\"∘\",\"\\\\circ\",!0),G(P,H,\"÷\",\"\\\\div\",!0),G(P,H,\"±\",\"\\\\pm\",!0),G(P,H,\"×\",\"\\\\times\",!0),G(P,H,\"∩\",\"\\\\cap\",!0),G(P,H,\"∪\",\"\\\\cup\",!0),G(P,H,\"∖\",\"\\\\setminus\",!0),G(P,H,\"∧\",\"\\\\land\"),G(P,H,\"∨\",\"\\\\lor\"),G(P,H,\"∧\",\"\\\\wedge\",!0),G(P,H,\"∨\",\"\\\\vee\",!0),G(P,Z,\"⟦\",\"\\\\llbracket\",!0),G(P,_,\"⟧\",\"\\\\rrbracket\",!0),G(P,Z,\"⟨\",\"\\\\langle\",!0),G(P,Z,\"⟪\",\"\\\\lAngle\",!0),G(P,Z,\"⦉\",\"\\\\llangle\",!0),G(P,Z,\"|\",\"\\\\lvert\"),G(P,Z,\"‖\",\"\\\\lVert\",!0),G(P,Q,\"!\",\"\\\\oc\"),G(P,Q,\"?\",\"\\\\wn\"),G(P,Q,\"↓\",\"\\\\shpos\"),G(P,Q,\"↕\",\"\\\\shift\"),G(P,Q,\"↑\",\"\\\\shneg\"),G(P,_,\"?\",\"?\"),G(P,_,\"!\",\"!\"),G(P,_,\"‼\",\"‼\"),G(P,_,\"⟩\",\"\\\\rangle\",!0),G(P,_,\"⟫\",\"\\\\rAngle\",!0),G(P,_,\"⦊\",\"\\\\rrangle\",!0),G(P,_,\"|\",\"\\\\rvert\"),G(P,_,\"‖\",\"\\\\rVert\"),G(P,Z,\"⦃\",\"\\\\lBrace\",!0),G(P,_,\"⦄\",\"\\\\rBrace\",!0),G(P,J,\"=\",\"\\\\equal\",!0),G(P,J,\":\",\":\"),G(P,J,\"≈\",\"\\\\approx\",!0),G(P,J,\"≅\",\"\\\\cong\",!0),G(P,J,\"≥\",\"\\\\ge\"),G(P,J,\"≥\",\"\\\\geq\",!0),G(P,J,\"←\",\"\\\\gets\"),G(P,J,\">\",\"\\\\gt\",!0),G(P,J,\"∈\",\"\\\\in\",!0),G(P,J,\"∉\",\"\\\\notin\",!0),G(P,J,\"\",\"\\\\@not\"),G(P,J,\"⊂\",\"\\\\subset\",!0),G(P,J,\"⊃\",\"\\\\supset\",!0),G(P,J,\"⊆\",\"\\\\subseteq\",!0),G(P,J,\"⊇\",\"\\\\supseteq\",!0),G(P,J,\"⊈\",\"\\\\nsubseteq\",!0),G(P,J,\"⊈\",\"\\\\nsubseteqq\"),G(P,J,\"⊉\",\"\\\\nsupseteq\",!0),G(P,J,\"⊉\",\"\\\\nsupseteqq\"),G(P,J,\"⊨\",\"\\\\models\"),G(P,J,\"←\",\"\\\\leftarrow\",!0),G(P,J,\"≤\",\"\\\\le\"),G(P,J,\"≤\",\"\\\\leq\",!0),G(P,J,\"<\",\"\\\\lt\",!0),G(P,J,\"→\",\"\\\\rightarrow\",!0),G(P,J,\"→\",\"\\\\to\"),G(P,J,\"≱\",\"\\\\ngeq\",!0),G(P,J,\"≱\",\"\\\\ngeqq\"),G(P,J,\"≱\",\"\\\\ngeqslant\"),G(P,J,\"≰\",\"\\\\nleq\",!0),G(P,J,\"≰\",\"\\\\nleqq\"),G(P,J,\"≰\",\"\\\\nleqslant\"),G(P,J,\"⫫\",\"\\\\Perp\",!0),G(P,K,\"\xA0\",\"\\\\ \"),G(P,K,\"\xA0\",\"\\\\space\"),G(P,K,\"\xA0\",\"\\\\nobreakspace\"),G(R,K,\"\xA0\",\"\\\\ \"),G(R,K,\"\xA0\",\" \"),G(R,K,\"\xA0\",\"\\\\space\"),G(R,K,\"\xA0\",\"\\\\nobreakspace\"),G(P,K,null,\"\\\\nobreak\"),G(P,K,null,\"\\\\allowbreak\"),G(P,Y,\",\",\",\"),G(R,Y,\":\",\":\"),G(P,Y,\";\",\";\"),G(P,H,\"⊼\",\"\\\\barwedge\"),G(P,H,\"⊻\",\"\\\\veebar\"),G(P,H,\"⊙\",\"\\\\odot\",!0),G(P,H,\"⊕︎\",\"\\\\oplus\"),G(P,H,\"⊗\",\"\\\\otimes\",!0),G(P,Q,\"∂\",\"\\\\partial\",!0),G(P,H,\"⊘\",\"\\\\oslash\",!0),G(P,H,\"⊚\",\"\\\\circledcirc\",!0),G(P,H,\"⊡\",\"\\\\boxdot\",!0),G(P,H,\"△\",\"\\\\bigtriangleup\"),G(P,H,\"▽\",\"\\\\bigtriangledown\"),G(P,H,\"†\",\"\\\\dagger\"),G(P,H,\"⋄\",\"\\\\diamond\"),G(P,H,\"◃\",\"\\\\triangleleft\"),G(P,H,\"▹\",\"\\\\triangleright\"),G(P,Z,\"{\",\"\\\\{\"),G(R,Q,\"{\",\"\\\\{\"),G(R,Q,\"{\",\"\\\\textbraceleft\"),G(P,_,\"}\",\"\\\\}\"),G(R,Q,\"}\",\"\\\\}\"),G(R,Q,\"}\",\"\\\\textbraceright\"),G(P,Z,\"{\",\"\\\\lbrace\"),G(P,_,\"}\",\"\\\\rbrace\"),G(P,Z,\"[\",\"\\\\lbrack\",!0),G(R,Q,\"[\",\"\\\\lbrack\",!0),G(P,_,\"]\",\"\\\\rbrack\",!0),G(R,Q,\"]\",\"\\\\rbrack\",!0),G(P,Z,\"(\",\"\\\\lparen\",!0),G(P,_,\")\",\"\\\\rparen\",!0),G(P,Z,\"⦇\",\"\\\\llparenthesis\",!0),G(P,_,\"⦈\",\"\\\\rrparenthesis\",!0),G(R,Q,\"<\",\"\\\\textless\",!0),G(R,Q,\">\",\"\\\\textgreater\",!0),G(P,Z,\"⌊\",\"\\\\lfloor\",!0),G(P,_,\"⌋\",\"\\\\rfloor\",!0),G(P,Z,\"⌈\",\"\\\\lceil\",!0),G(P,_,\"⌉\",\"\\\\rceil\",!0),G(P,Q,\"\\\\\",\"\\\\backslash\"),G(P,Q,\"|\",\"|\"),G(P,Q,\"|\",\"\\\\vert\"),G(R,Q,\"|\",\"\\\\textbar\",!0),G(P,Q,\"‖\",\"\\\\|\"),G(P,Q,\"‖\",\"\\\\Vert\"),G(R,Q,\"‖\",\"\\\\textbardbl\"),G(R,Q,\"~\",\"\\\\textasciitilde\"),G(R,Q,\"\\\\\",\"\\\\textbackslash\"),G(R,Q,\"^\",\"\\\\textasciicircum\"),G(P,J,\"↑\",\"\\\\uparrow\",!0),G(P,J,\"⇑\",\"\\\\Uparrow\",!0),G(P,J,\"↓\",\"\\\\downarrow\",!0),G(P,J,\"⇓\",\"\\\\Downarrow\",!0),G(P,J,\"↕\",\"\\\\updownarrow\",!0),G(P,J,\"⇕\",\"\\\\Updownarrow\",!0),G(P,X,\"∐\",\"\\\\coprod\"),G(P,X,\"⋁\",\"\\\\bigvee\"),G(P,X,\"⋀\",\"\\\\bigwedge\"),G(P,X,\"⨄\",\"\\\\biguplus\"),G(P,X,\"⨄\",\"\\\\bigcupplus\"),G(P,X,\"⨃\",\"\\\\bigcupdot\"),G(P,X,\"⨇\",\"\\\\bigdoublevee\"),G(P,X,\"⨈\",\"\\\\bigdoublewedge\"),G(P,X,\"⋂\",\"\\\\bigcap\"),G(P,X,\"⋃\",\"\\\\bigcup\"),G(P,X,\"∫\",\"\\\\int\"),G(P,X,\"∫\",\"\\\\intop\"),G(P,X,\"∬\",\"\\\\iint\"),G(P,X,\"∭\",\"\\\\iiint\"),G(P,X,\"∏\",\"\\\\prod\"),G(P,X,\"∑\",\"\\\\sum\"),G(P,X,\"⨂\",\"\\\\bigotimes\"),G(P,X,\"⨁\",\"\\\\bigoplus\"),G(P,X,\"⨀\",\"\\\\bigodot\"),G(P,X,\"⨉\",\"\\\\bigtimes\"),G(P,X,\"∮\",\"\\\\oint\"),G(P,X,\"∯\",\"\\\\oiint\"),G(P,X,\"∰\",\"\\\\oiiint\"),G(P,X,\"∱\",\"\\\\intclockwise\"),G(P,X,\"∲\",\"\\\\varointclockwise\"),G(P,X,\"⨌\",\"\\\\iiiint\"),G(P,X,\"⨍\",\"\\\\intbar\"),G(P,X,\"⨎\",\"\\\\intBar\"),G(P,X,\"⨏\",\"\\\\fint\"),G(P,X,\"⨒\",\"\\\\rppolint\"),G(P,X,\"⨓\",\"\\\\scpolint\"),G(P,X,\"⨕\",\"\\\\pointint\"),G(P,X,\"⨖\",\"\\\\sqint\"),G(P,X,\"⨗\",\"\\\\intlarhk\"),G(P,X,\"⨘\",\"\\\\intx\"),G(P,X,\"⨙\",\"\\\\intcap\"),G(P,X,\"⨚\",\"\\\\intcup\"),G(P,X,\"⨅\",\"\\\\bigsqcap\"),G(P,X,\"⨆\",\"\\\\bigsqcup\"),G(P,X,\"∫\",\"\\\\smallint\"),G(R,V,\"…\",\"\\\\textellipsis\"),G(P,V,\"…\",\"\\\\mathellipsis\"),G(R,V,\"…\",\"\\\\ldots\",!0),G(P,V,\"…\",\"\\\\dotso\"),G(P,V,\"…\",\"\\\\dotsc\"),G(P,V,\"…\",\"\\\\ldots\",!0),G(P,V,\"⋰\",\"\\\\iddots\",!0),G(P,V,\"⋯\",\"\\\\cdots\",!0),G(P,V,\"⋱\",\"\\\\ddots\",!0),G(P,Q,\"⋮\",\"\\\\varvdots\"),G(R,Q,\"⋮\",\"\\\\varvdots\"),G(P,U,\"´\",\"\\\\acute\"),G(P,U,\"`\",\"\\\\grave\"),G(P,U,\"¨\",\"\\\\ddot\"),G(P,U,\"…\",\"\\\\dddot\"),G(P,U,\"….\",\"\\\\ddddot\"),G(P,U,\"~\",\"\\\\tilde\"),G(P,U,\"‾\",\"\\\\bar\"),G(P,U,\"˘\",\"\\\\breve\"),G(P,U,\"ˇ\",\"\\\\check\"),G(P,U,\"ˆ\",\"\\\\hat\"),G(P,U,\"→\",\"\\\\vec\"),G(P,U,\"˙\",\"\\\\dot\"),G(P,U,\"˚\",\"\\\\mathring\"),G(P,W,\"ı\",\"\\\\imath\",!0),G(P,W,\"ȷ\",\"\\\\jmath\",!0),G(P,Q,\"ı\",\"ı\"),G(P,Q,\"ȷ\",\"ȷ\"),G(R,Q,\"ı\",\"\\\\i\",!0),G(R,Q,\"ȷ\",\"\\\\j\",!0),G(R,Q,\"ø\",\"\\\\o\",!0),G(P,W,\"ø\",\"\\\\o\",!0),G(R,Q,\"Ø\",\"\\\\O\",!0),G(P,W,\"Ø\",\"\\\\O\",!0),G(R,U,\"ˊ\",\"\\\\'\"),G(R,U,\"ˋ\",\"\\\\`\"),G(R,U,\"ˆ\",\"\\\\^\"),G(R,U,\"~\",\"\\\\~\"),G(R,U,\"ˉ\",\"\\\\=\"),G(R,U,\"˘\",\"\\\\u\"),G(R,U,\"˙\",\"\\\\.\"),G(R,U,\"¸\",\"\\\\c\");G(R,U,\"˚\",\"\\\\r\"),G(R,U,\"ˇ\",\"\\\\v\"),G(R,U,\"¨\",'\\\\\"'),G(R,U,\"˝\",\"\\\\H\"),G(P,U,\"ˊ\",\"\\\\'\"),G(P,U,\"ˋ\",\"\\\\`\"),G(P,U,\"ˆ\",\"\\\\^\"),G(P,U,\"~\",\"\\\\~\"),G(P,U,\"ˉ\",\"\\\\=\"),G(P,U,\"˘\",\"\\\\u\"),G(P,U,\"˙\",\"\\\\.\"),G(P,U,\"¸\",\"\\\\c\"),G(P,U,\"˚\",\"\\\\r\"),G(P,U,\"ˇ\",\"\\\\v\"),G(P,U,\"¨\",'\\\\\"'),G(P,U,\"˝\",\"\\\\H\");const ee={\"--\":!0,\"---\":!0,\"``\":!0,\"''\":!0};G(R,Q,\"–\",\"--\",!0),G(R,Q,\"–\",\"\\\\textendash\"),G(R,Q,\"—\",\"---\",!0),G(R,Q,\"—\",\"\\\\textemdash\"),G(R,Q,\"‘\",\"`\",!0),G(R,Q,\"‘\",\"\\\\textquoteleft\"),G(R,Q,\"’\",\"'\",!0),G(R,Q,\"’\",\"\\\\textquoteright\"),G(R,Q,\"“\",\"``\",!0),G(R,Q,\"“\",\"\\\\textquotedblleft\"),G(R,Q,\"”\",\"''\",!0),G(R,Q,\"”\",\"\\\\textquotedblright\"),G(P,Q,\"°\",\"\\\\degree\",!0),G(R,Q,\"°\",\"\\\\degree\"),G(R,Q,\"°\",\"\\\\textdegree\",!0),G(P,Q,\"£\",\"\\\\pounds\"),G(P,Q,\"£\",\"\\\\mathsterling\",!0),G(R,Q,\"£\",\"\\\\pounds\"),G(R,Q,\"£\",\"\\\\textsterling\",!0),G(P,Q,\"✠\",\"\\\\maltese\"),G(R,Q,\"✠\",\"\\\\maltese\"),G(P,Q,\"€\",\"\\\\euro\",!0),G(R,Q,\"€\",\"\\\\euro\",!0),G(R,Q,\"€\",\"\\\\texteuro\"),G(P,Q,\"©\",\"\\\\copyright\",!0),G(R,Q,\"©\",\"\\\\textcopyright\"),G(P,Q,\"⌀\",\"\\\\diameter\",!0),G(R,Q,\"⌀\",\"\\\\diameter\"),G(P,Q,\"𝛤\",\"\\\\varGamma\"),G(P,Q,\"𝛥\",\"\\\\varDelta\"),G(P,Q,\"𝛩\",\"\\\\varTheta\"),G(P,Q,\"𝛬\",\"\\\\varLambda\"),G(P,Q,\"𝛯\",\"\\\\varXi\"),G(P,Q,\"𝛱\",\"\\\\varPi\"),G(P,Q,\"𝛴\",\"\\\\varSigma\"),G(P,Q,\"𝛶\",\"\\\\varUpsilon\"),G(P,Q,\"𝛷\",\"\\\\varPhi\"),G(P,Q,\"𝛹\",\"\\\\varPsi\"),G(P,Q,\"𝛺\",\"\\\\varOmega\"),G(R,Q,\"𝛤\",\"\\\\varGamma\"),G(R,Q,\"𝛥\",\"\\\\varDelta\"),G(R,Q,\"𝛩\",\"\\\\varTheta\"),G(R,Q,\"𝛬\",\"\\\\varLambda\"),G(R,Q,\"𝛯\",\"\\\\varXi\"),G(R,Q,\"𝛱\",\"\\\\varPi\"),G(R,Q,\"𝛴\",\"\\\\varSigma\"),G(R,Q,\"𝛶\",\"\\\\varUpsilon\"),G(R,Q,\"𝛷\",\"\\\\varPhi\"),G(R,Q,\"𝛹\",\"\\\\varPsi\"),G(R,Q,\"𝛺\",\"\\\\varOmega\");const te='0123456789/@.\"';for(let e=0;e<14;e++){const t=te.charAt(e);G(P,Q,t,t)}const re='0123456789!@*()-=+\";:?/.,';for(let e=0;e<25;e++){const t=re.charAt(e);G(R,Q,t,t)}const ne=\"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\";for(let e=0;e<52;e++){const t=ne.charAt(e);G(P,W,t,t),G(R,Q,t,t)}const se=\"ÇÐÞçþℂℍℕℙℚℝℤℎℏℊℋℌℐℑℒℓ℘ℛℜℬℰℱℳℭℨ\";for(let e=0;e<30;e++){const t=se.charAt(e);G(P,W,t,t),G(R,Q,t,t)}let oe=\"\";for(let e=0;e<52;e++){oe=String.fromCharCode(55349,56320+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56372+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56424+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56580+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56736+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56788+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56840+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56944+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,56632+e),G(P,W,oe,oe),G(R,Q,oe,oe);const t=ne.charAt(e);oe=String.fromCharCode(55349,56476+e),G(P,W,t,oe),G(R,Q,t,oe)}for(let e=0;e<10;e++)oe=String.fromCharCode(55349,57294+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,57314+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,57324+e),G(P,W,oe,oe),G(R,Q,oe,oe),oe=String.fromCharCode(55349,57334+e),G(P,W,oe,oe),G(R,Q,oe,oe);const ae=function(e,t,r){return!D[t][e]||!D[t][e].replace||55349===e.charCodeAt(0)||Object.prototype.hasOwnProperty.call(ee,e)&&r&&(r.fontFamily&&\"tt\"===r.fontFamily.slice(4,6)||r.font&&\"tt\"===r.font.slice(4,6))||(e=D[t][e].replace),new N(e)},le=(e,t)=>{if(0===e.children.length||\"mtext\"!==e.children[e.children.length-1].type){const r=new C(\"mtext\",[new N(t.children[0].text)]);e.children.push(r)}else e.children[e.children.length-1].children[0].text+=t.children[0].text},ie=e=>{if(\"mrow\"!==e.type&&\"mstyle\"!==e.type)return e;if(0===e.children.length)return e;const t=new C(\"mrow\");for(let r=0;r<e.children.length;r++){const n=e.children[r];if(\"mtext\"===n.type&&0===Object.keys(n.attributes).length)le(t,n);else if(\"mrow\"===n.type){let e=!0;for(let t=0;t<n.children.length;t++){if(\"mtext\"!==n.children[t].type||0!==Object.keys(n.attributes).length){e=!1;break}}if(e)for(let e=0;e<n.children.length;e++){const r=n.children[e];le(t,r)}else t.children.push(n)}else t.children.push(n)}for(let r=0;r<t.children.length;r++)if(\"mtext\"===t.children[r].type){const n=t.children[r];\" \"===n.children[0].text.charAt(0)&&(n.children[0].text=\"\xA0\"+n.children[0].text.slice(1));const s=n.children[0].text.length;s>0&&\" \"===n.children[0].text.charAt(s-1)&&(n.children[0].text=n.children[0].text.slice(0,-1)+\"\xA0\");for(const[t,r]of Object.entries(e.attributes))n.attributes[t]=r}return 1===t.children.length&&\"mtext\"===t.children[0].type?t.children[0]:t},ce=function(e,t=!1){if(!(1!==e.length||e[0]instanceof w))return e[0];if(!t){e[0]instanceof C&&\"mo\"===e[0].type&&!e[0].attributes.fence&&(e[0].attributes.lspace=\"0em\",e[0].attributes.rspace=\"0em\");const t=e.length-1;e[t]instanceof C&&\"mo\"===e[t].type&&!e[t].attributes.fence&&(e[t].attributes.lspace=\"0em\",e[t].attributes.rspace=\"0em\")}return new C(\"mrow\",e)};function me(e){if(!e)return!1;if(\"mi\"===e.type&&1===e.children.length){const t=e.children[0];return t instanceof N&&\".\"===t.text}if(\"mtext\"===e.type&&1===e.children.length){const t=e.children[0];return t instanceof N&&\" \"===t.text}if(\"mo\"===e.type&&1===e.children.length&&\"true\"===e.getAttribute(\"separator\")&&\"0em\"===e.getAttribute(\"lspace\")&&\"0em\"===e.getAttribute(\"rspace\")){const t=e.children[0];return t instanceof N&&\",\"===t.text}return!1}const pe=(e,t)=>{const r=e[t],n=e[t+1];return\"atom\"===r.type&&\",\"===r.text&&r.loc&&n.loc&&r.loc.end===n.loc.start},ue=e=>\"atom\"===e.type&&\"rel\"===e.family||\"mclass\"===e.type&&\"mrel\"===e.mclass,de=function(e,t,r=!1){if(!r&&1===e.length){const r=ge(e[0],t);return r instanceof C&&\"mo\"===r.type&&(r.setAttribute(\"lspace\",\"0em\"),r.setAttribute(\"rspace\",\"0em\")),[r]}const n=[],s=[];let o;for(let r=0;r<e.length;r++)s.push(ge(e[r],t));for(let t=0;t<s.length;t++){const r=s[t];if(t<e.length-1&&ue(e[t])&&ue(e[t+1])&&r.setAttribute(\"rspace\",\"0em\"),t>0&&ue(e[t])&&ue(e[t-1])&&r.setAttribute(\"lspace\",\"0em\"),\"mn\"===r.type&&o&&\"mn\"===o.type)o.children.push(...r.children);else if(me(r)&&o&&\"mn\"===o.type)o.children.push(...r.children);else if(o&&\"mn\"===o.type&&t<s.length-1&&\"mn\"===s[t+1].type&&pe(e,t))o.children.push(...r.children);else{if(\"mn\"===r.type&&me(o))r.children=[...o.children,...r.children],n.pop();else if((\"msup\"===r.type||\"msub\"===r.type)&&r.children.length>=1&&o&&(\"mn\"===o.type||me(o))){const e=r.children[0];e instanceof C&&\"mn\"===e.type&&o&&(e.children=[...o.children,...e.children],n.pop())}n.push(r),o=r}}return n},he=function(e,t,r=!1){return ce(de(e,t,r),r)},ge=function(t,r){if(!t)return new C(\"mrow\");if(h[t.type]){return h[t.type](t,r)}throw new e(\"Got group of unknown type: '\"+t.type+\"'\")},fe=e=>new C(\"mtd\",[],[],{padding:\"0\",width:\"50%\"}),be=[\"mrow\",\"mtd\",\"mtable\",\"mtr\"],ye=e=>{for(const t of e.children)if(t.type&&be.includes(t.type)){if(t.classes&&\"tml-label\"===t.classes[0]){return t.label}{const e=ye(t);if(e)return e}}else if(!t.type){const e=ye(t);if(e)return e}};function we(e,t,r,n){let s=null;1===e.length&&\"tag\"===e[0].type&&(s=e[0].tag,e=e[0].body);const o=de(e,r);if(1===o.length&&o[0]instanceof O)return o[0];const a=n.displayMode||n.annotate?\"none\":n.wrap,l=0===o.length?null:o[0];let i=1===o.length&&null===s&&l instanceof C?o[0]:function(e,t,r){const n=[];let s=[],o=[],a=0,l=0;for(;l<e.length;){for(;e[l]instanceof w;)e.splice(l,1,...e[l].children);const r=e[l];if(r.attributes&&r.attributes.linebreak&&\"newline\"===r.attributes.linebreak){o.length>0&&s.push(new C(\"mrow\",o)),s.push(r),o=[];const e=new C(\"mtd\",s);e.style.textAlign=\"left\",n.push(new C(\"mtr\",[e])),s=[],l+=1;continue}if(o.push(r),r.type&&\"mo\"===r.type&&1===r.children.length&&(!r.attributes.form||\"prefix\"!==r.attributes.form)&&!Object.prototype.hasOwnProperty.call(r.attributes,\"movablelimits\")){const n=r.children[0].text;if(\"=\"===t&&\"=\"===n){if(a+=1,a>1){o.pop();const e=new C(\"mrow\",o);s.push(e),o=[r]}}else if(\"tex\"===t){const t=l<e.length-1?e[l+1]:null;let r=!0;if(!t||\"mtext\"!==t.type||!t.attributes.linebreak||\"nobreak\"!==t.attributes.linebreak)for(let t=l+1;t<e.length;t++){const n=e[t];if(!n.type||\"mspace\"!==n.type||n.attributes.linebreak&&\"newline\"===n.attributes.linebreak)break;o.push(n),l+=1,n.attributes&&n.attributes.linebreak&&\"nobreak\"===n.attributes.linebreak&&(r=!1)}if(r){const e=new C(\"mrow\",o);s.push(e),o=[]}}}l+=1}if(o.length>0){const e=new C(\"mrow\",o);s.push(e)}if(n.length>0){const e=new C(\"mtd\",s);e.style.textAlign=\"left\";const t=new C(\"mtr\",[e]);n.push(t);const o=new C(\"mtable\",n);return r||(o.setAttribute(\"columnalign\",\"left\"),o.setAttribute(\"rowspacing\",\"0em\")),o}return B(s)}(o,a,n.displayMode);if(s&&(i=((e,t,r,n)=>{t=he(t[0].body,r),(t=ie(t)).classes.push(\"tml-tag\");const s=ye(e);e=new C(\"mtd\",[e]);const o=[fe(),e,fe()];o[n?0:2].children.push(t);const a=new C(\"mtr\",o,[\"tml-tageqn\"]);s&&a.setAttribute(\"id\",s);const l=new C(\"mtable\",[a]);return l.style.width=\"100%\",l.setAttribute(\"displaystyle\",\"true\"),l})(i,s,r,n.leqno)),n.annotate){const e=new C(\"annotation\",[new N(t)]);e.setAttribute(\"encoding\",\"application/x-tex\"),i=new C(\"semantics\",[i,e])}const c=new C(\"math\",[i]);return n.xml&&c.setAttribute(\"xmlns\",\"http://www.w3.org/1998/Math/MathML\"),n.displayMode&&(c.setAttribute(\"display\",\"block\"),c.style.display=\"block math\",c.classes=[\"tml-display\"]),c}const xe=(e,t)=>{const r=e.isStretchy?F(e):new C(\"mo\",[ae(e.label,e.mode)]);e.isStretchy||r.setAttribute(\"stretchy\",\"false\"),\"\\\\vec\"!==e.label&&(r.style.mathDepth=\"0\");const n=\"\\\\c\"===e.label?\"munder\":\"mover\",s=ve.has(e.label);if(\"mover\"===n&&\"math\"===e.mode&&!e.isStretchy&&e.base.text&&1===e.base.text.length){const t=e.base.text,n=\"\\\\vec\"===e.label,o=\"\\\\vec\"===n?\"-vec\":\"\";n&&r.classes.push(\"tml-vec\");const a=n?\"-vec\":s?\"-acc\":\"\";\"DHKLUcegorsuvxyzΠΥΨαδηιμνοτυχϵ\".indexOf(t)>-1?(r.classes.push(`chr-sml${o}`),r.classes.push(`wbk-sml${a}`)):\"BCEGIMNOPQRSTXZlpqtwΓΘΞΣΦΩβεζθξρςφψϑϕϱ\".indexOf(t)>-1?(r.classes.push(`chr-med${o}`),r.classes.push(`wbk-med${a}`)):\"AFJdfΔΛ\".indexOf(t)>-1?(r.classes.push(`chr-lrg${o}`),r.classes.push(`wbk-lrg${a}`)):n?r.classes.push(\"wbk-vec\"):s&&r.classes.push(\"wbk-acc\")}else s&&r.classes.push(\"wbk-acc\");return new C(n,[ge(e.base,t),r])},ke=new Set([\"\\\\acute\",\"\\\\check\",\"\\\\grave\",\"\\\\ddot\",\"\\\\dddot\",\"\\\\ddddot\",\"\\\\tilde\",\"\\\\bar\",\"\\\\breve\",\"\\\\check\",\"\\\\hat\",\"\\\\vec\",\"\\\\dot\",\"\\\\mathring\"]),ve=new Set([\"\\\\acute\",\"\\\\bar\",\"\\\\breve\",\"\\\\check\",\"\\\\dot\",\"\\\\ddot\",\"\\\\grave\",\"\\\\hat\",\"\\\\mathring\",\"\\\\`\",\"\\\\'\",\"\\\\^\",\"\\\\=\",\"\\\\u\",\"\\\\.\",'\\\\\"',\"\\\\r\",\"\\\\H\",\"\\\\v\"]),Ae={\"\\\\`\":\"̀\",\"\\\\'\":\"́\",\"\\\\^\":\"̂\",\"\\\\~\":\"̃\",\"\\\\=\":\"̄\",\"\\\\u\":\"̆\",\"\\\\.\":\"̇\",'\\\\\"':\"̈\",\"\\\\r\":\"̊\",\"\\\\H\":\"̋\",\"\\\\v\":\"̌\",\"\\\\c\":\"̧\"};g({type:\"accent\",names:[\"\\\\acute\",\"\\\\grave\",\"\\\\ddot\",\"\\\\dddot\",\"\\\\ddddot\",\"\\\\tilde\",\"\\\\bar\",\"\\\\breve\",\"\\\\check\",\"\\\\hat\",\"\\\\vec\",\"\\\\dot\",\"\\\\mathring\",\"\\\\overparen\",\"\\\\widecheck\",\"\\\\widehat\",\"\\\\wideparen\",\"\\\\widetilde\",\"\\\\overrightarrow\",\"\\\\overleftarrow\",\"\\\\Overrightarrow\",\"\\\\overleftrightarrow\",\"\\\\overgroup\",\"\\\\overleftharpoon\",\"\\\\overrightharpoon\"],props:{numArgs:1},handler:(e,t)=>{const r=b(t[0]),n=!ke.has(e.funcName);return{type:\"accent\",mode:e.parser.mode,label:e.funcName,isStretchy:n,base:r}},mathmlBuilder:xe}),g({type:\"accent\",names:[\"\\\\'\",\"\\\\`\",\"\\\\^\",\"\\\\~\",\"\\\\=\",\"\\\\c\",\"\\\\u\",\"\\\\.\",'\\\\\"',\"\\\\r\",\"\\\\H\",\"\\\\v\"],props:{numArgs:1,allowedInText:!0,allowedInMath:!0,argTypes:[\"primitive\"]},handler:(e,t)=>{const r=b(t[0]),n=e.parser.mode;return\"math\"===n&&e.parser.settings.strict&&console.log(`Temml parse error: Command ${e.funcName} is invalid in math mode.`),\"text\"===n&&r.text&&1===r.text.length&&e.funcName in Ae&&m.indexOf(r.text)>-1?{type:\"textord\",mode:\"text\",text:r.text+Ae[e.funcName]}:\"\\\\c\"===e.funcName&&\"text\"===n&&r.text&&1===r.text.length?{type:\"textord\",mode:\"text\",text:r.text+\"̧\"}:{type:\"accent\",mode:n,label:e.funcName,isStretchy:!1,base:r}},mathmlBuilder:xe}),g({type:\"accentUnder\",names:[\"\\\\underleftarrow\",\"\\\\underrightarrow\",\"\\\\underleftrightarrow\",\"\\\\undergroup\",\"\\\\underparen\",\"\\\\utilde\"],props:{numArgs:1},handler:({parser:e,funcName:t},r)=>{const n=r[0];return{type:\"accentUnder\",mode:e.mode,label:t,base:n}},mathmlBuilder:(e,t)=>{const r=F(e);r.style[\"math-depth\"]=0;return new C(\"munder\",[ge(e.base,t),r])}});const Te={pt:800/803,pc:9600/803,dd:1238/1157*800/803,cc:12.792133216944668,nd:685/642*800/803,nc:1370/107*800/803,sp:1/65536*800/803,mm:25.4/72,cm:2.54/72,in:1/72,px:96/72},Se=[\"em\",\"ex\",\"mu\",\"pt\",\"mm\",\"cm\",\"in\",\"px\",\"bp\",\"pc\",\"dd\",\"cc\",\"nd\",\"nc\",\"sp\"],Oe=function(e){return\"string\"!=typeof e&&(e=e.unit),Se.indexOf(e)>-1},qe=e=>[1,.7,.5][Math.max(e-1,0)],Be=function(t,r){let n=t.number;if(r.maxSize[0]<0&&n>0)return{number:0,unit:\"em\"};const s=t.unit;switch(s){case\"mm\":case\"cm\":case\"in\":case\"px\":return n*Te[s]>r.maxSize[1]?{number:r.maxSize[1],unit:\"pt\"}:{number:n,unit:s};case\"em\":case\"ex\":return\"ex\"===s&&(n*=.431),n=Math.min(n/qe(r.level),r.maxSize[0]),{number:c(n),unit:\"em\"};case\"bp\":return n>r.maxSize[1]&&(n=r.maxSize[1]),{number:n,unit:\"pt\"};case\"pt\":case\"pc\":case\"dd\":case\"cc\":case\"nd\":case\"nc\":case\"sp\":return n=Math.min(n*Te[s],r.maxSize[1]),{number:c(n),unit:\"pt\"};case\"mu\":return n=Math.min(n/18,r.maxSize[0]),{number:c(n),unit:\"em\"};default:throw new e(\"Invalid unit: '\"+s+\"'\")}},Ce=e=>{const t=new C(\"mspace\");return t.setAttribute(\"width\",e+\"em\"),t},Ne=(e,t=.3,r=0,n=!1)=>{if(null==e&&0===r)return Ce(t);const s=e?[e]:[];if(0!==t&&s.unshift(Ce(t)),r>0&&s.push(Ce(r)),n){const e=new C(\"mpadded\",s);return e.setAttribute(\"height\",\"0.1px\"),e}return new C(\"mrow\",s)},ze=(e,t)=>Number(e)/qe(t),$e=(e,t,r,n)=>{const s=I(e),o=\"eq\"===e.slice(1,3),a=\"x\"===e.charAt(1)?\"1.75\":\"cd\"===e.slice(2,4)?\"3.0\":o?\"1.0\":\"2.0\";s.setAttribute(\"lspace\",\"0\"),s.setAttribute(\"rspace\",o?\"0.5em\":\"0\");const l=n.withLevel(n.level<2?2:3),i=ze(a,l.level),c=ze(a,3),m=Ne(null,i.toFixed(4),0),p=Ne(null,c.toFixed(4),0),u=ze(o?0:.3,l.level).toFixed(4);let d,h;const g=t&&t.body&&(t.body.body||t.body.length>0);if(g){let r=ge(t,l);r=Ne(r,u,u,\"\\\\\\\\cdrightarrow\"===e||\"\\\\\\\\cdleftarrow\"===e),d=new C(\"mover\",[r,p])}const f=r&&r.body&&(r.body.body||r.body.length>0);if(f){let e=ge(r,l);e=Ne(e,u,u),h=new C(\"munder\",[e,p])}let b;return b=g||f?g&&f?new C(\"munderover\",[s,h,d]):g?new C(\"mover\",[s,d]):new C(\"munder\",[s,h]):new C(\"mover\",[s,m]),\"3.0\"===a&&(b.style.height=\"1em\"),b.setAttribute(\"accent\",\"false\"),b};g({type:\"xArrow\",names:[\"\\\\xleftarrow\",\"\\\\xrightarrow\",\"\\\\xLeftarrow\",\"\\\\xRightarrow\",\"\\\\xleftrightarrow\",\"\\\\xLeftrightarrow\",\"\\\\xhookleftarrow\",\"\\\\xhookrightarrow\",\"\\\\xmapsto\",\"\\\\xrightharpoondown\",\"\\\\xrightharpoonup\",\"\\\\xleftharpoondown\",\"\\\\xleftharpoonup\",\"\\\\xlongequal\",\"\\\\xtwoheadrightarrow\",\"\\\\xtwoheadleftarrow\",\"\\\\xtofrom\",\"\\\\xleftrightharpoons\",\"\\\\xrightleftharpoons\",\"\\\\yields\",\"\\\\yieldsLeft\",\"\\\\mesomerism\",\"\\\\longrightharpoonup\",\"\\\\longleftharpoondown\",\"\\\\yieldsLeftRight\",\"\\\\chemequilibrium\",\"\\\\\\\\cdrightarrow\",\"\\\\\\\\cdleftarrow\",\"\\\\\\\\cdlongequal\"],props:{numArgs:1,numOptionalArgs:1},handler:({parser:e,funcName:t},r,n)=>({type:\"xArrow\",mode:e.mode,name:t,body:r[0],below:n[0]}),mathmlBuilder(e,t){const r=[$e(e.name,e.body,e.below,t)];return r.unshift(Ce(.2778)),r.push(Ce(.2778)),new C(\"mrow\",r)}});const Ee={\"\\\\equilibriumRight\":[\"\\\\longrightharpoonup\",\"\\\\eqleftharpoondown\"],\"\\\\equilibriumLeft\":[\"\\\\eqrightharpoonup\",\"\\\\longleftharpoondown\"]};g({type:\"stackedArrow\",names:[\"\\\\equilibriumRight\",\"\\\\equilibriumLeft\"],props:{numArgs:1,numOptionalArgs:1},handler({parser:e,funcName:t},r,n){const s=r[0]?{type:\"hphantom\",mode:e.mode,body:r[0]}:null,o=n[0]?{type:\"hphantom\",mode:e.mode,body:n[0]}:null;return{type:\"stackedArrow\",mode:e.mode,name:t,body:r[0],upperArrowBelow:o,lowerArrowBody:s,below:n[0]}},mathmlBuilder(e,t){const r=Ee[e.name][0],n=Ee[e.name][1],s=$e(r,e.body,e.upperArrowBelow,t),o=$e(n,e.lowerArrowBody,e.below,t);let a;const l=new C(\"mpadded\",[s]);if(l.setAttribute(\"voffset\",\"0.3em\"),l.setAttribute(\"height\",\"+0.3em\"),l.setAttribute(\"depth\",\"-0.3em\"),\"\\\\equilibriumLeft\"===e.name){const e=new C(\"mpadded\",[o]);e.setAttribute(\"width\",\"0.5em\"),a=new C(\"mpadded\",[Ce(.2778),e,l,Ce(.2778)])}else l.setAttribute(\"width\",\"\\\\equilibriumRight\"===e.name?\"0.5em\":\"0\"),a=new C(\"mpadded\",[Ce(.2778),l,o,Ce(.2778)]);return a.setAttribute(\"voffset\",\"-0.18em\"),a.setAttribute(\"height\",\"-0.18em\"),a.setAttribute(\"depth\",\"+0.18em\"),a}});const Ie={};function Le({type:e,names:t,props:r,handler:n,mathmlBuilder:s}){const o={type:e,numArgs:r.numArgs||0,allowedInText:!1,numOptionalArgs:0,handler:n};for(let e=0;e<t.length;++e)Ie[t[e]]=o;s&&(h[e]=s)}function Fe(e,t){if(!e||e.type!==t)throw new Error(`Expected node of type ${t}, but got `+(e?`node of type ${e.type}`:String(e)));return e}function je(e){const t=Me(e);if(!t)throw new Error(\"Expected node of symbol group type, but got \"+(e?`node of type ${e.type}`:String(e)));return t}function Me(e){return e&&(\"atom\"===e.type||\"delimiter\"===e.type||Object.prototype.hasOwnProperty.call(M,e.type))?e:null}const De={\">\":\"\\\\\\\\cdrightarrow\",\"<\":\"\\\\\\\\cdleftarrow\",\"=\":\"\\\\\\\\cdlongequal\",A:\"\\\\uparrow\",V:\"\\\\downarrow\",\"|\":\"\\\\Vert\",\".\":\"no arrow\"},Ge=()=>({type:\"styling\",body:[],mode:\"math\",scriptLevel:\"display\"}),Pe=e=>\"textord\"===e.type&&\"@\"===e.text,Re=(e,t)=>(\"mathord\"===e.type||\"atom\"===e.type)&&e.text===t;function Ue(e,t,r){const n=De[e];switch(n){case\"\\\\\\\\cdrightarrow\":case\"\\\\\\\\cdleftarrow\":return r.callFunction(n,[t[0]],[t[1]]);case\"\\\\uparrow\":case\"\\\\downarrow\":{const e={type:\"atom\",text:n,mode:\"math\",family:\"rel\"},s={type:\"ordgroup\",mode:\"math\",body:[r.callFunction(\"\\\\\\\\cdleft\",[t[0]],[]),r.callFunction(\"\\\\Big\",[e],[]),r.callFunction(\"\\\\\\\\cdright\",[t[1]],[])],semisimple:!0};return r.callFunction(\"\\\\\\\\cdparent\",[s],[])}case\"\\\\\\\\cdlongequal\":return r.callFunction(\"\\\\\\\\cdlongequal\",[],[]);case\"\\\\Vert\":{const e={type:\"textord\",text:\"\\\\Vert\",mode:\"math\"};return r.callFunction(\"\\\\Big\",[e],[])}default:return{type:\"textord\",text:\" \",mode:\"math\"}}}g({type:\"cdlabel\",names:[\"\\\\\\\\cdleft\",\"\\\\\\\\cdright\"],props:{numArgs:1},handler:({parser:e,funcName:t},r)=>({type:\"cdlabel\",mode:e.mode,side:t.slice(4),label:r[0]}),mathmlBuilder(e,t){if(0===e.label.body.length)return new C(\"mrow\",t);const r=ge(e.label,t);\"left\"===e.side&&r.classes.push(\"tml-shift-left\");const n=new C(\"mtd\",[r]);n.style.padding=\"0\";const s=new C(\"mtr\",[n]),o=new C(\"mtable\",[s]),a=new C(\"mpadded\",[o]);return a.setAttribute(\"width\",\"0.1px\"),a.setAttribute(\"displaystyle\",\"false\"),a.setAttribute(\"scriptlevel\",\"1\"),a}}),g({type:\"cdlabelparent\",names:[\"\\\\\\\\cdparent\"],props:{numArgs:1},handler:({parser:e},t)=>({type:\"cdlabelparent\",mode:e.mode,fragment:t[0]}),mathmlBuilder:(e,t)=>new C(\"mrow\",[ge(e.fragment,t)])});const He=e=>({type:\"ordgroup\",mode:\"math\",body:e,semisimple:!0}),_e=(e,t)=>({type:t,mode:\"math\",body:He(e)});class Ve{constructor(e,t,r){this.lexer=e,this.start=t,this.end=r}static range(e,t){return t?e&&e.loc&&t.loc&&e.loc.lexer===t.loc.lexer?new Ve(e.loc.lexer,e.loc.start,t.loc.end):null:e&&e.loc}}class We{constructor(e,t){this.text=e,this.loc=t}range(e,t){return new We(t,Ve.range(this,e))}}const Xe=0,Ze=1,Ye=2,Je=3,Ke=Object.create(null);function Qe(e,t){Ke[e]=t}const et=Ke;Qe(\"\\\\noexpand\",function(e){const t=e.popToken();return e.isExpandable(t.text)&&(t.noexpand=!0,t.treatAsRelax=!0),{tokens:[t],numArgs:0}}),Qe(\"\\\\expandafter\",function(e){const t=e.popToken();return e.expandOnce(!0),{tokens:[t],numArgs:0}}),Qe(\"\\\\@firstoftwo\",function(e){return{tokens:e.consumeArgs(2)[0],numArgs:0}}),Qe(\"\\\\@secondoftwo\",function(e){return{tokens:e.consumeArgs(2)[1],numArgs:0}}),Qe(\"\\\\@ifnextchar\",function(e){const t=e.consumeArgs(3);e.consumeSpaces();const r=e.future();return 1===t[0].length&&t[0][0].text===r.text?{tokens:t[1],numArgs:0}:{tokens:t[2],numArgs:0}}),Qe(\"\\\\@ifstar\",\"\\\\@ifnextchar *{\\\\@firstoftwo{#1}}\"),Qe(\"\\\\TextOrMath\",function(e){const t=e.consumeArgs(2);return\"text\"===e.mode?{tokens:t[0],numArgs:0}:{tokens:t[1],numArgs:0}});const tt=e=>{let t=\"\";for(let r=e.length-1;r>-1;r--)t+=e[r].text;return t},rt={0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,a:10,A:10,b:11,B:11,c:12,C:12,d:13,D:13,e:14,E:14,f:15,F:15},nt=e=>{const t=e.future().text;return\"EOF\"===t?[null,\"\"]:[rt[t.charAt(0)],t]},st=(e,t,r)=>{for(let n=1;n<t.length;n++){e*=r,e+=rt[t.charAt(n)]}return e};function ot(e){const t=e.consumeArgs(1)[0];let r=\"\",n=t[t.length-1].loc.start;for(let e=t.length-1;e>=0;e--){const s=t[e].loc.start;s>n&&(r+=\" \",n=s),r+=t[e].text,n+=t[e].text.length}return r}Qe(\"\\\\char\",function(t){let r,n=t.popToken(),s=\"\";if(\"'\"===n.text)r=8,n=t.popToken();else if('\"'===n.text)r=16,n=t.popToken();else if(\"`\"===n.text)if(n=t.popToken(),\"\\\\\"===n.text[0])s=n.text.charCodeAt(1);else{if(\"EOF\"===n.text)throw new e(\"\\\\char` missing argument\");s=n.text.charCodeAt(0)}else r=10;if(r){let o,a=n.text;if(s=rt[a.charAt(0)],null==s||s>=r)throw new e(`Invalid base-${r} digit ${n.text}`);for(s=st(s,a,r),[o,a]=nt(t);null!=o&&o<r;)s*=r,s+=o,s=st(s,a,r),t.popToken(),[o,a]=nt(t)}return`\\\\@char{${s}}`}),Qe(\"\\\\surd\",\"\\\\sqrt{\\\\vphantom{|}}\"),Qe(\"⊕\",\"\\\\oplus\"),Qe(\"\\\\long\",\"\"),Qe(\"\\\\bgroup\",\"{\"),Qe(\"\\\\egroup\",\"}\"),Qe(\"~\",\"\\\\nobreakspace\"),Qe(\"\\\\lq\",\"`\"),Qe(\"\\\\rq\",\"'\"),Qe(\"\\\\aa\",\"\\\\r a\"),Qe(\"\\\\Bbbk\",\"\\\\Bbb{k}\"),Qe(\"\\\\mathstrut\",\"\\\\vphantom{(}\"),Qe(\"\\\\underbar\",\"\\\\underline{\\\\text{#1}}\"),Qe(\"\\\\vdots\",\"{\\\\varvdots\\\\rule{0pt}{15pt}}\"),Qe(\"⋮\",\"\\\\vdots\"),Qe(\"\\\\arraystretch\",\"1\"),Qe(\"\\\\arraycolsep\",\"6pt\"),Qe(\"\\\\substack\",\"\\\\begin{subarray}{c}#1\\\\end{subarray}\"),Qe(\"\\\\iff\",\"\\\\DOTSB\\\\;\\\\Longleftrightarrow\\\\;\"),Qe(\"\\\\implies\",\"\\\\DOTSB\\\\;\\\\Longrightarrow\\\\;\"),Qe(\"\\\\impliedby\",\"\\\\DOTSB\\\\;\\\\Longleftarrow\\\\;\");const at={\",\":\"\\\\dotsc\",\"\\\\not\":\"\\\\dotsb\",\"+\":\"\\\\dotsb\",\"=\":\"\\\\dotsb\",\"<\":\"\\\\dotsb\",\">\":\"\\\\dotsb\",\"-\":\"\\\\dotsb\",\"*\":\"\\\\dotsb\",\":\":\"\\\\dotsb\",\"\\\\DOTSB\":\"\\\\dotsb\",\"\\\\coprod\":\"\\\\dotsb\",\"\\\\bigvee\":\"\\\\dotsb\",\"\\\\bigwedge\":\"\\\\dotsb\",\"\\\\biguplus\":\"\\\\dotsb\",\"\\\\bigcap\":\"\\\\dotsb\",\"\\\\bigcup\":\"\\\\dotsb\",\"\\\\prod\":\"\\\\dotsb\",\"\\\\sum\":\"\\\\dotsb\",\"\\\\bigotimes\":\"\\\\dotsb\",\"\\\\bigoplus\":\"\\\\dotsb\",\"\\\\bigodot\":\"\\\\dotsb\",\"\\\\bigsqcap\":\"\\\\dotsb\",\"\\\\bigsqcup\":\"\\\\dotsb\",\"\\\\bigtimes\":\"\\\\dotsb\",\"\\\\And\":\"\\\\dotsb\",\"\\\\longrightarrow\":\"\\\\dotsb\",\"\\\\Longrightarrow\":\"\\\\dotsb\",\"\\\\longleftarrow\":\"\\\\dotsb\",\"\\\\Longleftarrow\":\"\\\\dotsb\",\"\\\\longleftrightarrow\":\"\\\\dotsb\",\"\\\\Longleftrightarrow\":\"\\\\dotsb\",\"\\\\mapsto\":\"\\\\dotsb\",\"\\\\longmapsto\":\"\\\\dotsb\",\"\\\\hookrightarrow\":\"\\\\dotsb\",\"\\\\doteq\":\"\\\\dotsb\",\"\\\\mathbin\":\"\\\\dotsb\",\"\\\\mathrel\":\"\\\\dotsb\",\"\\\\relbar\":\"\\\\dotsb\",\"\\\\Relbar\":\"\\\\dotsb\",\"\\\\xrightarrow\":\"\\\\dotsb\",\"\\\\xleftarrow\":\"\\\\dotsb\",\"\\\\DOTSI\":\"\\\\dotsi\",\"\\\\int\":\"\\\\dotsi\",\"\\\\oint\":\"\\\\dotsi\",\"\\\\iint\":\"\\\\dotsi\",\"\\\\iiint\":\"\\\\dotsi\",\"\\\\iiiint\":\"\\\\dotsi\",\"\\\\DOTSX\":\"\\\\dotsx\"};Qe(\"\\\\dots\",function(e){let t=\"\\\\dotso\";const r=e.expandAfterFuture().text;return r in at?t=at[r]:(\"\\\\not\"===r.slice(0,4)||r in D.math&&[\"bin\",\"rel\"].includes(D.math[r].group))&&(t=\"\\\\dotsb\"),t}),Qe(\"\\\\dotsb\",\"\\\\cdots\"),Qe(\"\\\\dotsm\",\"\\\\cdots\"),Qe(\"\\\\dotsi\",\"\\\\!\\\\cdots\"),Qe(\"\\\\idotsint\",\"\\\\int\\\\!\\\\cdots\\\\!\\\\int\"),Qe(\"\\\\dotsx\",\"\\\\ldots\\\\,\"),Qe(\"\\\\DOTSI\",\"\\\\relax\"),Qe(\"\\\\DOTSB\",\"\\\\relax\"),Qe(\"\\\\DOTSX\",\"\\\\relax\"),Qe(\"\\\\tmspace\",\"\\\\TextOrMath{\\\\kern#1#3}{\\\\mskip#1#2}\\\\relax\"),Qe(\"\\\\,\",\"{\\\\tmspace+{3mu}{.1667em}}\"),Qe(\"\\\\thinspace\",\"\\\\,\"),Qe(\"\\\\>\",\"\\\\mskip{4mu}\"),Qe(\"\\\\:\",\"{\\\\tmspace+{4mu}{.2222em}}\"),Qe(\"\\\\medspace\",\"\\\\:\"),Qe(\"\\\\;\",\"{\\\\tmspace+{5mu}{.2777em}}\"),Qe(\"\\\\thickspace\",\"\\\\;\"),Qe(\"\\\\!\",\"{\\\\tmspace-{3mu}{.1667em}}\"),Qe(\"\\\\negthinspace\",\"\\\\!\"),Qe(\"\\\\negmedspace\",\"{\\\\tmspace-{4mu}{.2222em}}\"),Qe(\"\\\\negthickspace\",\"{\\\\tmspace-{5mu}{.277em}}\"),Qe(\"\\\\enspace\",\"\\\\kern.5em \"),Qe(\"\\\\enskip\",\"\\\\hskip.5em\\\\relax\"),Qe(\"\\\\quad\",\"\\\\hskip1em\\\\relax\"),Qe(\"\\\\qquad\",\"\\\\hskip2em\\\\relax\"),Qe(\"\\\\AA\",\"\\\\TextOrMath{\\\\Angstrom}{\\\\mathring{A}}\\\\relax\"),Qe(\"\\\\tag\",\"\\\\@ifstar\\\\tag@literal\\\\tag@paren\"),Qe(\"\\\\tag@paren\",\"\\\\tag@literal{({#1})}\"),Qe(\"\\\\tag@literal\",t=>{if(t.macros.get(\"\\\\df@tag\"))throw new e(\"Multiple \\\\tag\");return\"\\\\gdef\\\\df@tag{\\\\text{#1}}\"}),Qe(\"\\\\notag\",\"\\\\nonumber\"),Qe(\"\\\\nonumber\",\"\\\\gdef\\\\@eqnsw{0}\"),Qe(\"\\\\bmod\",\"\\\\mathbin{\\\\text{mod}}\"),Qe(\"\\\\pod\",\"\\\\allowbreak\\\\mathchoice{\\\\mkern18mu}{\\\\mkern8mu}{\\\\mkern8mu}{\\\\mkern8mu}(#1)\"),Qe(\"\\\\pmod\",\"\\\\pod{{\\\\rm mod}\\\\mkern6mu#1}\"),Qe(\"\\\\mod\",\"\\\\allowbreak\\\\mathchoice{\\\\mkern18mu}{\\\\mkern12mu}{\\\\mkern12mu}{\\\\mkern12mu}{\\\\rm mod}\\\\,\\\\,#1\"),Qe(\"\\\\newline\",\"\\\\\\\\\\\\relax\"),Qe(\"\\\\TeX\",\"\\\\textrm{T}\\\\kern-.1667em\\\\raisebox{-.5ex}{E}\\\\kern-.125em\\\\textrm{X}\"),Qe(\"\\\\LaTeX\",\"\\\\textrm{L}\\\\kern-.35em\\\\raisebox{0.2em}{\\\\scriptstyle A}\\\\kern-.15em\\\\TeX\"),Qe(\"\\\\Temml\",\"\\\\textrm{T}\\\\kern-0.2em\\\\lower{0.2em}{\\\\textrm{E}}\\\\kern-0.08em{\\\\textrm{M}\\\\kern-0.08em\\\\raise{0.2em}\\\\textrm{M}\\\\kern-0.08em\\\\textrm{L}}\"),Qe(\"\\\\hspace\",\"\\\\@ifstar\\\\@hspacer\\\\@hspace\"),Qe(\"\\\\@hspace\",\"\\\\hskip #1\\\\relax\"),Qe(\"\\\\@hspacer\",\"\\\\rule{0pt}{0pt}\\\\hskip #1\\\\relax\"),Qe(\"\\\\colon\",'\\\\mathpunct{\\\\char\"3a}'),Qe(\"\\\\prescript\",\"\\\\pres@cript{^{#1}_{#2}}{}{#3}\"),Qe(\"\\\\ordinarycolon\",'\\\\char\"3a'),Qe(\"\\\\vcentcolon\",\"\\\\mathrel{\\\\raisebox{0.035em}{\\\\ordinarycolon}}\"),Qe(\"\\\\coloneq\",'\\\\mathrel{\\\\raisebox{0.035em}{\\\\ordinarycolon}\\\\char\"2212}'),Qe(\"\\\\Coloneq\",'\\\\mathrel{\\\\char\"2237\\\\char\"2212}'),Qe(\"\\\\Eqqcolon\",'\\\\mathrel{\\\\char\"3d\\\\char\"2237}'),Qe(\"\\\\Eqcolon\",'\\\\mathrel{\\\\char\"2212\\\\char\"2237}'),Qe(\"\\\\colonapprox\",'\\\\mathrel{\\\\raisebox{0.035em}{\\\\ordinarycolon}\\\\char\"2248}'),Qe(\"\\\\Colonapprox\",'\\\\mathrel{\\\\char\"2237\\\\char\"2248}'),Qe(\"\\\\colonsim\",'\\\\mathrel{\\\\raisebox{0.035em}{\\\\ordinarycolon}\\\\char\"223c}'),Qe(\"\\\\Colonsim\",'\\\\mathrel{\\\\raisebox{0.035em}{\\\\ordinarycolon}\\\\char\"223c}'),Qe(\"\\\\ratio\",\"\\\\vcentcolon\"),Qe(\"\\\\coloncolon\",\"\\\\dblcolon\"),Qe(\"\\\\colonequals\",\"\\\\coloneqq\"),Qe(\"\\\\coloncolonequals\",\"\\\\Coloneqq\"),Qe(\"\\\\equalscolon\",\"\\\\eqqcolon\"),Qe(\"\\\\equalscoloncolon\",\"\\\\Eqqcolon\"),Qe(\"\\\\colonminus\",\"\\\\coloneq\"),Qe(\"\\\\coloncolonminus\",\"\\\\Coloneq\"),Qe(\"\\\\minuscolon\",\"\\\\eqcolon\"),Qe(\"\\\\minuscoloncolon\",\"\\\\Eqcolon\"),Qe(\"\\\\coloncolonapprox\",\"\\\\Colonapprox\"),Qe(\"\\\\coloncolonsim\",\"\\\\Colonsim\"),Qe(\"\\\\notni\",\"\\\\mathrel{\\\\char`∌}\"),Qe(\"\\\\limsup\",\"\\\\DOTSB\\\\operatorname*{lim\\\\,sup}\"),Qe(\"\\\\liminf\",\"\\\\DOTSB\\\\operatorname*{lim\\\\,inf}\"),Qe(\"\\\\injlim\",\"\\\\DOTSB\\\\operatorname*{inj\\\\,lim}\"),Qe(\"\\\\projlim\",\"\\\\DOTSB\\\\operatorname*{proj\\\\,lim}\"),Qe(\"\\\\varlimsup\",\"\\\\DOTSB\\\\operatorname*{\\\\overline{\\\\text{lim}}}\"),Qe(\"\\\\varliminf\",\"\\\\DOTSB\\\\operatorname*{\\\\underline{\\\\text{lim}}}\"),Qe(\"\\\\varinjlim\",\"\\\\DOTSB\\\\operatorname*{\\\\underrightarrow{\\\\text{lim}}}\"),Qe(\"\\\\varprojlim\",\"\\\\DOTSB\\\\operatorname*{\\\\underleftarrow{\\\\text{lim}}}\"),Qe(\"\\\\centerdot\",\"{\\\\medspace\\\\rule{0.167em}{0.189em}\\\\medspace}\"),Qe(\"\\\\argmin\",\"\\\\DOTSB\\\\operatorname*{arg\\\\,min}\"),Qe(\"\\\\argmax\",\"\\\\DOTSB\\\\operatorname*{arg\\\\,max}\"),Qe(\"\\\\plim\",\"\\\\DOTSB\\\\operatorname*{plim}\"),Qe(\"\\\\leftmodels\",\"\\\\mathop{\\\\reflectbox{$\\\\models$}}\"),Qe(\"\\\\bra\",\"\\\\mathinner{\\\\langle{#1}|}\"),Qe(\"\\\\ket\",\"\\\\mathinner{|{#1}\\\\rangle}\"),Qe(\"\\\\braket\",\"\\\\mathinner{\\\\langle{#1}\\\\rangle}\"),Qe(\"\\\\Bra\",\"\\\\left\\\\langle#1\\\\right|\"),Qe(\"\\\\Ket\",\"\\\\left|#1\\\\right\\\\rangle\");const lt=(e,t)=>{const r=`}\\\\,\\\\middle${\"|\"===t[0]?\"\\\\vert\":\"\\\\Vert\"}\\\\,{`;return e.slice(0,t.index)+r+e.slice(t.index+t[0].length)};Qe(\"\\\\Braket\",function(e){let t=ot(e);const r=/\\|\\||\\||\\\\\\|/g;let n;for(;null!==(n=r.exec(t));)t=lt(t,n);return\"\\\\left\\\\langle{\"+t+\"}\\\\right\\\\rangle\"}),Qe(\"\\\\Set\",function(e){let t=ot(e);const r=/\\|\\||\\||\\\\\\|/.exec(t);return r&&(t=lt(t,r)),\"\\\\left\\\\{\\\\:{\"+t+\"}\\\\:\\\\right\\\\}\"}),Qe(\"\\\\set\",function(e){return\"\\\\{{\"+ot(e).replace(/\\|/,\"}\\\\mid{\")+\"}\\\\}\"}),Qe(\"\\\\angln\",\"{\\\\angl n}\"),Qe(\"\\\\odv\",\"\\\\@ifstar\\\\odv@next\\\\odv@numerator\"),Qe(\"\\\\odv@numerator\",\"\\\\frac{\\\\mathrm{d}#1}{\\\\mathrm{d}#2}\"),Qe(\"\\\\odv@next\",\"\\\\frac{\\\\mathrm{d}}{\\\\mathrm{d}#2}#1\"),Qe(\"\\\\pdv\",\"\\\\@ifstar\\\\pdv@next\\\\pdv@numerator\");const it=e=>{const t=e[0][0].text,r=tt(e[1]).split(\",\"),n=String(r.length),s=\"1\"===n?\"\\\\partial\":`\\\\partial^${n}`;let o=\"\";return r.map(e=>{o+=\"\\\\partial \"+e.trim()+\"\\\\,\"}),[t,s,o.replace(/\\\\,$/,\"\")]};function ct(e){const t=[];e.consumeSpaces();let r=e.fetch().text;for(\"\\\\relax\"===r&&(e.consume(),e.consumeSpaces(),r=e.fetch().text);\"\\\\hline\"===r||\"\\\\hdashline\"===r;)e.consume(),t.push(\"\\\\hdashline\"===r),e.consumeSpaces(),r=e.fetch().text;return t}Qe(\"\\\\pdv@numerator\",function(e){const[t,r,n]=it(e.consumeArgs(2));return`\\\\frac{${r} ${t}}{${n}}`}),Qe(\"\\\\pdv@next\",function(e){const[t,r,n]=it(e.consumeArgs(2));return`\\\\frac{${r}}{${n}} ${t}`}),Qe(\"\\\\upalpha\",\"\\\\up@greek{\\\\alpha}\"),Qe(\"\\\\upbeta\",\"\\\\up@greek{\\\\beta}\"),Qe(\"\\\\upgamma\",\"\\\\up@greek{\\\\gamma}\"),Qe(\"\\\\updelta\",\"\\\\up@greek{\\\\delta}\"),Qe(\"\\\\upepsilon\",\"\\\\up@greek{\\\\epsilon}\"),Qe(\"\\\\upzeta\",\"\\\\up@greek{\\\\zeta}\"),Qe(\"\\\\upeta\",\"\\\\up@greek{\\\\eta}\"),Qe(\"\\\\uptheta\",\"\\\\up@greek{\\\\theta}\"),Qe(\"\\\\upiota\",\"\\\\up@greek{\\\\iota}\"),Qe(\"\\\\upkappa\",\"\\\\up@greek{\\\\kappa}\"),Qe(\"\\\\uplambda\",\"\\\\up@greek{\\\\lambda}\"),Qe(\"\\\\upmu\",\"\\\\up@greek{\\\\mu}\"),Qe(\"\\\\upnu\",\"\\\\up@greek{\\\\nu}\"),Qe(\"\\\\upxi\",\"\\\\up@greek{\\\\xi}\"),Qe(\"\\\\upomicron\",\"\\\\up@greek{\\\\omicron}\"),Qe(\"\\\\uppi\",\"\\\\up@greek{\\\\pi}\"),Qe(\"\\\\upalpha\",\"\\\\up@greek{\\\\alpha}\"),Qe(\"\\\\uprho\",\"\\\\up@greek{\\\\rho}\"),Qe(\"\\\\upsigma\",\"\\\\up@greek{\\\\sigma}\"),Qe(\"\\\\uptau\",\"\\\\up@greek{\\\\tau}\"),Qe(\"\\\\upupsilon\",\"\\\\up@greek{\\\\upsilon}\"),Qe(\"\\\\upphi\",\"\\\\up@greek{\\\\phi}\"),Qe(\"\\\\upchi\",\"\\\\up@greek{\\\\chi}\"),Qe(\"\\\\uppsi\",\"\\\\up@greek{\\\\psi}\"),Qe(\"\\\\upomega\",\"\\\\up@greek{\\\\omega}\"),Qe(\"\\\\invamp\",'\\\\mathbin{\\\\char\"214b}'),Qe(\"\\\\parr\",'\\\\mathbin{\\\\char\"214b}'),Qe(\"\\\\upand\",'\\\\mathbin{\\\\char\"214b}'),Qe(\"\\\\with\",'\\\\mathbin{\\\\char\"26}'),Qe(\"\\\\multimapinv\",'\\\\mathrel{\\\\char\"27dc}'),Qe(\"\\\\multimapboth\",'\\\\mathrel{\\\\char\"29df}'),Qe(\"\\\\scoh\",'{\\\\mkern5mu\\\\char\"2322\\\\mkern5mu}'),Qe(\"\\\\sincoh\",'{\\\\mkern5mu\\\\char\"2323\\\\mkern5mu}'),Qe(\"\\\\coh\",'{\\\\mkern5mu\\\\rule{}{0.7em}\\\\mathrlap{\\\\smash{\\\\raise2mu{\\\\char\"2322}}}\\n{\\\\smash{\\\\lower4mu{\\\\char\"2323}}}\\\\mkern5mu}'),Qe(\"\\\\incoh\",'{\\\\mkern5mu\\\\rule{}{0.7em}\\\\mathrlap{\\\\smash{\\\\raise2mu{\\\\char\"2323}}}\\n{\\\\smash{\\\\lower4mu{\\\\char\"2322}}}\\\\mkern5mu}'),Qe(\"\\\\standardstate\",\"\\\\text{\\\\tiny\\\\char`⦵}\");const mt=t=>{if(!t.parser.settings.displayMode)throw new e(`{${t.envName}} can be used only in display mode.`)},pt=/([-+]?) *(\\d+(?:\\.\\d*)?|\\.\\d+) *([a-z]{2})/,ut=e=>{let t=e.get(\"\\\\arraystretch\");\"string\"!=typeof t&&(t=tt(t.tokens)),t=isNaN(t)?null:Number(t);let r=e.get(\"\\\\arraycolsep\");\"string\"!=typeof r&&(r=tt(r.tokens));const n=pt.exec(r);return[t,n?{number:+(n[1]+n[2]),unit:n[3]}:null]},dt=t=>{let r=\"\";for(let n=0;n<t.length;n++)if(\"label\"===t[n].type){if(r)throw new e(\"Multiple \\\\labels in one row\");r=t[n].string}return r};function ht(e){if(-1===e.indexOf(\"ed\"))return-1===e.indexOf(\"*\")}function gt(t,{cols:r,envClasses:n,autoTag:s,singleRow:o,emptySingleRow:a,maxNumCols:l,leqno:i,arraystretch:c,arraycolsep:m},p){const u=n&&n.includes(\"bordermatrix\")?\"}\":\"\\\\end\";t.gullet.beginGroup(),o||t.gullet.macros.set(\"\\\\cr\",\"\\\\\\\\\\\\relax\"),t.gullet.beginGroup();let d=[];const h=[d],g=[],f=[],b=[],y=null!=s?[]:void 0;function w(){s&&t.gullet.macros.set(\"\\\\@eqnsw\",\"1\",!0)}function x(){y&&(t.gullet.macros.get(\"\\\\df@tag\")?(y.push(t.subparse([new We(\"\\\\df@tag\")])),t.gullet.macros.set(\"\\\\df@tag\",void 0,!0)):y.push(Boolean(s)&&\"1\"===t.gullet.macros.get(\"\\\\@eqnsw\")))}for(w(),b.push(ct(t));;){let r=t.parseExpression(!1,o?\"\\\\end\":\"\\\\\\\\\");t.gullet.endGroup(),t.gullet.beginGroup(),r={type:\"ordgroup\",mode:t.mode,body:r,semisimple:!0},d.push(r);const s=t.fetch().text;if(\"&\"===s){if(l&&d.length===l){if(!n.includes(\"array\"))throw new e(2===l?\"The split environment accepts no more than two columns\":\"The equation environment accepts only one column\",t.nextToken);if(t.settings.strict)throw new e(\"Too few columns specified in the {array} column argument.\",t.nextToken)}t.consume()}else{if(s===u){x(),1===d.length&&0===r.body.length&&(h.length>1||!a)&&h.pop(),f.push(dt(r.body)),b.length<h.length+1&&b.push([]);break}if(\"\\\\\\\\\"!==s)throw new e(\"Expected & or \\\\\\\\ or \\\\cr or \"+u,t.nextToken);{let e;t.consume(),\" \"!==t.gullet.future().text&&(e=t.parseSizeGroup(!0)),g.push(e?e.value:null),x(),f.push(dt(r.body)),b.push(ct(t)),d=[],h.push(d),w()}}}return t.gullet.endGroup(),t.gullet.endGroup(),{type:\"array\",mode:t.mode,body:h,cols:r,rowGaps:g,hLinesBeforeRow:b,envClasses:n,autoTag:s,scriptLevel:p,tags:y,labels:f,leqno:i,arraystretch:c,arraycolsep:m}}function ft(e){return\"d\"===e.slice(0,1)?\"display\":\"text\"}const bt={c:\"center \",l:\"left \",r:\"right \"},yt=e=>{const t=new C(\"mtd\",[]);return t.style={padding:\"0\",width:\"50%\"},e.envClasses.includes(\"multline\")&&(t.style.width=\"7.5%\"),t},wt=function(e,t){const r=[],n=e.body.length,s=e.hLinesBeforeRow,o=e.tags&&e.tags.some(e=>e);for(let a=0;a<n;a++){const l=e.body[a],i=[],c=\"text\"===e.scriptLevel?Ze:\"script\"===e.scriptLevel?Ye:Xe;for(let r=0;r<l.length;r++){const s=new C(\"mtd\",[ge(l[r],t.withLevel(c))]);if(e.envClasses.includes(\"multline\")){const e=0===a?\"left\":a===n-1?\"right\":\"center\";\"center\"!==e&&s.classes.push(\"tml-\"+e)}i.push(s)}const m=e.body[0].length;for(let e=0;e<m-l.length;e++)i.push(new C(\"mtd\",[],[],t));if(o){const r=e.tags[a];let n;!0===r?n=new C(\"mtext\",[new T([\"tml-eqn\"])]):!1===r?n=new C(\"mtext\",[],[]):(n=he(r[0].body,t.withLevel(c),!0),n=ie(n),n.classes=[\"tml-tag\"]),n&&(i.unshift(yt(e)),i.push(yt(e)),e.leqno?i[0].children.push(n):i[i.length-1].children.push(n))}const p=new C(\"mtr\",i,[]),u=e.labels.shift();u&&e.tags&&e.tags[a]&&(p.setAttribute(\"id\",u),Array.isArray(e.tags[a])&&p.classes.push(\"tml-tageqn\")),0===a&&s[0].length>0&&(2===s[0].length?p.children.forEach(e=>{e.style.borderTop=\"0.15em double\"}):p.children.forEach(e=>{e.style.borderTop=s[0][0]?\"0.06em dashed\":\"0.06em solid\"})),s[a+1].length>0&&(2===s[a+1].length?p.children.forEach(e=>{e.style.borderBottom=\"0.15em double\"}):p.children.forEach(e=>{e.style.borderBottom=s[a+1][0]?\"0.06em dashed\":\"0.06em solid\"}));let d=!0;for(let e=0;e<p.children.length;e++){const t=p.children[e].children[0];if(!t||\"mpadded\"!==t.type||\"0px\"!==t.attributes.height){d=!1;break}}if(d){p.classes.push(\"ff-squash\");for(let e=0;e<p.children.length;e++)p.children[e].style.paddingTop=\"0\",p.children[e].style.paddingBottom=\"0\"}r.push(p)}if(e.arraystretch&&1!==e.arraystretch){const t=String(1.4*e.arraystretch-.8)+\"ex\";for(let e=0;e<r.length;e++)for(let n=0;n<r[e].children.length;n++)r[e].children[n].style.paddingTop=t,r[e].children[n].style.paddingBottom=t}let a,l;if(e.envClasses.length>0&&(a=e.envClasses.includes(\"abut\")||e.envClasses.includes(\"cases\")?\"0\":e.envClasses.includes(\"small\")?\"0.1389\":e.envClasses.includes(\"cd\")?\"0.25\":\"0.4\",l=\"em\"),e.arraycolsep){const r=Be(e.arraycolsep,t);a=r.number.toFixed(4),l=r.unit}if(a){const t=0===r.length?0:r[0].children.length,n=(r,n)=>0===r&&0===n||r===t-1&&1===n?\"0\":\"align\"!==e.envClasses[0]?a:1===n?\"0\":o?r%2?\"1\":\"0\":r%2?\"0\":\"1\";for(let e=0;e<r.length;e++)for(let t=0;t<r[e].children.length;t++)r[e].children[t].style.paddingLeft=`${n(t,0)}${l}`,r[e].children[t].style.paddingRight=`${n(t,1)}${l}`}if(0===e.envClasses.length)for(let e=0;e<r.length;e++)r[e].children[0].style.paddingLeft=\"0em\",r[e].children.length===r[0].children.length&&(r[e].children[r[e].children.length-1].style.paddingRight=\"0em\");if(e.envClasses.length>0){const t=e.envClasses.includes(\"align\")||e.envClasses.includes(\"alignat\");for(let n=0;n<r.length;n++){const s=r[n];if(t){for(let e=0;e<s.children.length;e++)s.children[e].classes=[\"tml-\"+(e%2?\"left\":\"right\")];if(o){const t=e.leqno?0:s.children.length-1;s.children[t].classes=[]}}if(s.children.length>1&&e.envClasses.includes(\"cases\")&&(s.children[1].style.paddingLeft=\"1em\"),e.envClasses.includes(\"cases\")||e.envClasses.includes(\"subarray\"))for(const e of s.children)e.classes.push(\"tml-left\")}}let i=new C(\"mtable\",r);if(e.envClasses.length>0&&(e.envClasses.includes(\"jot\")?i.classes.push(\"tml-jot\"):e.envClasses.includes(\"small\")&&i.classes.push(\"tml-small\")),\"display\"===e.scriptLevel&&i.setAttribute(\"displaystyle\",\"true\"),(e.autoTag||e.envClasses.includes(\"multline\"))&&(i.style.width=\"100%\"),e.cols&&e.cols.length>0){const t=e.cols;let r=!1,n=0,s=t.length;for(;\"separator\"===t[n].type;)n+=1;for(;\"separator\"===t[s-1].type;)s-=1;if(\"separator\"===t[0].type){const e=\"separator\"===t[1].type?\"0.15em double\":\"|\"===t[0].separator?\"0.06em solid \":\"0.06em dashed \";for(const t of i.children)t.children[0].style.borderLeft=e}let a=o?0:-1;for(let e=n;e<s;e++)if(\"align\"===t[e].type){const n=bt[t[e].align];a+=1;for(const e of i.children)\"center\"!==n.trim()&&a<e.children.length&&(e.children[a].classes=[\"tml-\"+n.trim()]);r=!0}else if(\"separator\"===t[e].type){if(r){const r=\"separator\"===t[e+1].type?\"0.15em double\":\"|\"===t[e].separator?\"0.06em solid\":\"0.06em dashed\";for(const e of i.children)a<e.children.length&&(e.children[a].style.borderRight=r)}r=!1}if(\"separator\"===t[t.length-1].type){const e=\"separator\"===t[t.length-2].type?\"0.15em double\":\"|\"===t[t.length-1].separator?\"0.06em solid\":\"0.06em dashed\";for(const t of i.children)t.children[t.children.length-1].style.borderRight=e,t.children[t.children.length-1].style.paddingRight=\"0.4em\"}}return e.envClasses.includes(\"small\")&&(i=new C(\"mstyle\",[i]),i.setAttribute(\"scriptlevel\",\"1\")),i},xt=function(t,r){-1===t.envName.indexOf(\"ed\")&&mt(t);const n=\"split\"===t.envName,s=[],o=gt(t.parser,{cols:s,emptySingleRow:!0,autoTag:n?void 0:ht(t.envName),envClasses:[\"abut\",\"jot\"],maxNumCols:\"split\"===t.envName?2:void 0,leqno:t.parser.settings.leqno},\"display\");let a,l=0;const i=t.envName.indexOf(\"at\")>-1;if(r[0]&&i){let t=\"\";for(let e=0;e<r[0].body.length;e++){t+=Fe(r[0].body[e],\"textord\").text}if(isNaN(t))throw new e(\"The alignat enviroment requires a numeric first argument.\");a=Number(t),l=2*a}o.body.forEach(function(t){if(i){const r=t.length/2;if(a<r)throw new e(`Too many math in a row: expected ${a}, but got ${r}`,t[0])}else l<t.length&&(l=t.length)});for(let e=0;e<l;++e){let t=\"r\";e%2==1&&(t=\"l\"),s[e]={type:\"align\",align:t}}return\"split\"===t.envName||(i?o.envClasses.push(\"alignat\"):o.envClasses[0]=\"align\"),o};Le({type:\"array\",names:[\"array\",\"darray\"],props:{numArgs:1},handler(t,r){const n=(Me(r[0])?[r[0]]:Fe(r[0],\"ordgroup\").body).map(function(t){const r=je(t).text;if(-1!==\"lcr\".indexOf(r))return{type:\"align\",align:r};if(\"|\"===r)return{type:\"separator\",separator:\"|\"};if(\":\"===r)return{type:\"separator\",separator:\":\"};throw new e(\"Unknown column alignment: \"+r,t)}),[s,o]=ut(t.parser.gullet.macros),a={cols:n,envClasses:[\"array\"],maxNumCols:n.length,arraystretch:s,arraycolsep:o};return gt(t.parser,a,ft(t.envName))},mathmlBuilder:wt}),Le({type:\"array\",names:[\"matrix\",\"pmatrix\",\"bmatrix\",\"Bmatrix\",\"vmatrix\",\"Vmatrix\",\"matrix*\",\"pmatrix*\",\"bmatrix*\",\"Bmatrix*\",\"vmatrix*\",\"Vmatrix*\"],props:{numArgs:0},handler(t){const r={matrix:null,pmatrix:[\"(\",\")\"],bmatrix:[\"[\",\"]\"],Bmatrix:[\"\\\\{\",\"\\\\}\"],vmatrix:[\"|\",\"|\"],Vmatrix:[\"\\\\Vert\",\"\\\\Vert\"]}[t.envName.replace(\"*\",\"\")];let n=\"c\";const s={envClasses:[],cols:[]};if(\"*\"===t.envName.charAt(t.envName.length-1)){const r=t.parser;if(r.consumeSpaces(),\"[\"===r.fetch().text){if(r.consume(),r.consumeSpaces(),n=r.fetch().text,-1===\"lcr\".indexOf(n))throw new e(\"Expected l or c or r\",r.nextToken);r.consume(),r.consumeSpaces(),r.expect(\"]\"),r.consume(),s.cols=[]}}const o=gt(t.parser,s,\"text\");o.cols=o.body.length>0?new Array(o.body[0].length).fill({type:\"align\",align:n}):[];const[a,l]=ut(t.parser.gullet.macros);return o.arraystretch=a,!l||6===l&&\"pt\"===l||(o.arraycolsep=l),r?{type:\"leftright\",mode:t.mode,body:[o],left:r[0],right:r[1],rightColor:void 0}:o},mathmlBuilder:wt}),Le({type:\"array\",names:[\"bordermatrix\"],props:{numArgs:0},handler(e){const t=gt(e.parser,{cols:[],envClasses:[\"bordermatrix\"]},\"text\");return t.cols=t.body.length>0?new Array(t.body[0].length).fill({type:\"align\",align:\"c\"}):[],t.envClasses=[],t.arraystretch=1,\"matrix\"===e.envName?t:((e,t)=>{const r=e.body;r[0].shift();const n=new Array(r.length-1).fill().map(()=>[]);for(let e=1;e<r.length;e++){n[e-1].push(r[e].shift());const t=[];for(let n=0;n<r[e].length;n++)t.push(r[e][n]);n[e-1].push(_e(t,\"vphantom\"))}const s=new Array(r.length).fill().map(()=>[]);for(let e=0;e<r[0].length;e++)s[0].push(r[0][e]);for(let e=1;e<r.length;e++)for(let t=0;t<r[0].length;t++)s[e].push(_e(r[e][t].body,\"hphantom\"));for(let e=0;e<r[0].length;e++)r[0][e]=_e(r[0][e].body,\"hphantom\");const o={type:\"array\",mode:\"math\",body:n,cols:[{type:\"align\",align:\"c\"}],rowGaps:new Array(n.length-1).fill(null),hLinesBeforeRow:new Array(n.length+1).fill().map(()=>[]),envClasses:[],scriptLevel:\"text\",arraystretch:1,labels:new Array(n.length).fill(\"\"),arraycolsep:{number:.04,unit:\"em\"}},a={type:\"styling\",mode:\"math\",scriptLevel:\"text\",body:[{type:\"array\",mode:\"math\",body:s,cols:new Array(s.length).fill({type:\"align\",align:\"c\"}),rowGaps:new Array(s.length-1).fill(null),hLinesBeforeRow:new Array(s.length+1).fill().map(()=>[]),envClasses:[],scriptLevel:\"text\",arraystretch:1,labels:new Array(s.length).fill(\"\"),arraycolsep:null}]},l={type:\"leftright\",mode:\"math\",body:[e],left:t?t[0]:\"(\",right:t?t[1]:\")\",rightColor:void 0};return He([o,{type:\"supsub\",mode:\"math\",stack:!0,base:{type:\"op\",mode:\"math\",limits:!0,alwaysHandleSupSub:!0,parentIsSupSub:!0,symbol:!1,suppressBaseShift:!0,body:[l]},sup:a,sub:null}])})(t,e.delimiters)},mathmlBuilder:wt}),Le({type:\"array\",names:[\"smallmatrix\"],props:{numArgs:0},handler:e=>gt(e.parser,{envClasses:[\"small\"]},\"script\"),mathmlBuilder:wt}),Le({type:\"array\",names:[\"subarray\"],props:{numArgs:1},handler(t,r){const n=(Me(r[0])?[r[0]]:Fe(r[0],\"ordgroup\").body).map(function(t){const r=je(t).text;if(-1!==\"lc\".indexOf(r))return{type:\"align\",align:r};throw new e(\"Unknown column alignment: \"+r,t)});if(n.length>1)throw new e(\"{subarray} can contain only one column\");let s={cols:n,envClasses:[\"small\"]};if(s=gt(t.parser,s,\"script\"),s.body.length>0&&s.body[0].length>1)throw new e(\"{subarray} can contain only one column\");return s},mathmlBuilder:wt}),Le({type:\"array\",names:[\"cases\",\"dcases\",\"rcases\",\"drcases\"],props:{numArgs:0},handler(e){const t=gt(e.parser,{cols:[],envClasses:[\"cases\"]},ft(e.envName));return{type:\"leftright\",mode:e.mode,body:[t],left:e.envName.indexOf(\"r\")>-1?\".\":\"\\\\{\",right:e.envName.indexOf(\"r\")>-1?\"\\\\}\":\".\",rightColor:void 0}},mathmlBuilder:wt}),Le({type:\"array\",names:[\"align\",\"align*\",\"aligned\",\"split\"],props:{numArgs:0},handler:xt,mathmlBuilder:wt}),Le({type:\"array\",names:[\"alignat\",\"alignat*\",\"alignedat\"],props:{numArgs:1},handler:xt,mathmlBuilder:wt}),Le({type:\"array\",names:[\"gathered\",\"gather\",\"gather*\"],props:{numArgs:0},handler(e){\"gathered\"!==e.envName&&mt(e);const t={cols:[],envClasses:[\"abut\",\"jot\"],autoTag:ht(e.envName),emptySingleRow:!0,leqno:e.parser.settings.leqno};return gt(e.parser,t,\"display\")},mathmlBuilder:wt}),Le({type:\"array\",names:[\"equation\",\"equation*\"],props:{numArgs:0},handler(e){mt(e);const t={autoTag:ht(e.envName),emptySingleRow:!0,singleRow:!0,maxNumCols:1,envClasses:[\"align\"],leqno:e.parser.settings.leqno};return gt(e.parser,t,\"display\")},mathmlBuilder:wt}),Le({type:\"array\",names:[\"multline\",\"multline*\"],props:{numArgs:0},handler(e){mt(e);const t={autoTag:\"multline\"===e.envName,maxNumCols:1,envClasses:[\"jot\",\"multline\"],leqno:e.parser.settings.leqno};return gt(e.parser,t,\"display\")},mathmlBuilder:wt}),Le({type:\"array\",names:[\"CD\"],props:{numArgs:0},handler:t=>(mt(t),function(t){const r=[];for(t.gullet.beginGroup(),t.gullet.macros.set(\"\\\\cr\",\"\\\\\\\\\\\\relax\"),t.gullet.beginGroup();;){r.push(t.parseExpression(!1,\"\\\\\\\\\")),t.gullet.endGroup(),t.gullet.beginGroup();const n=t.fetch().text;if(\"&\"!==n&&\"\\\\\\\\\"!==n){if(\"\\\\end\"===n){0===r[r.length-1].length&&r.pop();break}throw new e(\"Expected \\\\\\\\ or \\\\cr or \\\\end\",t.nextToken)}t.consume()}let n=[];const s=[n];for(let o=0;o<r.length;o++){const a=r[o];let l=Ge();for(let r=0;r<a.length;r++)if(Pe(a[r])){n.push(l),r+=1;const s=je(a[r]).text,o=new Array(2);if(o[0]={type:\"ordgroup\",mode:\"math\",body:[]},o[1]={type:\"ordgroup\",mode:\"math\",body:[]},\"=|.\".indexOf(s)>-1);else{if(!(\"<>AV\".indexOf(s)>-1))throw new e('Expected one of \"<>AV=|.\" after @.');for(let t=0;t<2;t++){let n=!0;for(let l=r+1;l<a.length;l++){if(Re(a[l],s)){n=!1,r=l;break}if(Pe(a[l]))throw new e(\"Missing a \"+s+\" character to complete a CD arrow.\",a[l]);o[t].body.push(a[l])}if(n)throw new e(\"Missing a \"+s+\" character to complete a CD arrow.\",a[r])}}const i=Ue(s,o,t);n.push(i),l=Ge()}else l.body.push(a[r]);o%2==0?n.push(l):n.shift(),n=[],s.push(n)}return s.pop(),t.gullet.endGroup(),t.gullet.endGroup(),{type:\"array\",mode:\"math\",body:s,tags:null,labels:new Array(s.length+1).fill(\"\"),envClasses:[\"jot\",\"cd\"],cols:[],hLinesBeforeRow:new Array(s.length+1).fill([])}}(t.parser)),mathmlBuilder:wt}),g({type:\"text\",names:[\"\\\\hline\",\"\\\\hdashline\"],props:{numArgs:0,allowedInText:!0,allowedInMath:!0},handler(t,r){throw new e(`${t.funcName} valid only within array environment`)}});const kt=Ie;g({type:\"bordermatrix\",names:[\"\\\\bordermatrix\",\"\\\\matrix\"],props:{numArgs:0,numOptionalArgs:1},handler:({parser:e,funcName:t},r,n)=>{let s=[\"(\",\")\"];if(\"\\\\bordermatrix\"===t&&n[0]&&n[0].body){const e=n[0].body;1===e.length&&\"delimiter\"===e[0].type&&(s=[e[0].left,e[0].right])}e.consumeSpaces(),e.consume();const o=kt.bordermatrix,a={mode:e.mode,envName:t.slice(1),delimiters:s,parser:e},l=o.handler(a);return e.expect(\"}\",!0),l}}),g({type:\"cancelto\",names:[\"\\\\cancelto\"],props:{numArgs:2},handler({parser:e},t){const r=t[0],n=t[1];return{type:\"cancelto\",mode:e.mode,body:n,to:r,isCharacterBox:i(n)}},mathmlBuilder(e,t){const r=new C(\"mrow\",[ge(e.body,t)],[\"ff-narrow\"]),n=new C(\"mphantom\",[ge(e.body,t)]),s=new C(\"mrow\",[n],[\"tml-cancelto\"]);s.style.color=t.color,e.isCharacterBox&&m.indexOf(e.body.body[0].text)>-1&&(s.style.left=\"0.1em\",s.style.width=\"90%\");const o=new C(\"mrow\",[r,s],[\"menclose\"]);if(!e.isCharacterBox||/[f∫∑]/.test(e.body.body[0].text))n.style.paddingRight=\"0.2em\";else{n.style.padding=\"0.5ex 0.1em 0 0\";const e=new C(\"mspace\",[]);e.setAttribute(\"height\",\"0.85em\"),r.children.push(e)}let a;if(e.isCharacterBox)a=new C(\"mspace\",[]),a.setAttribute(\"height\",\"1em\");else{const r=ge(e.body,t),n=new C(\"mpadded\",[r]);n.setAttribute(\"width\",\"0.1px\"),a=new C(\"mphantom\",[n])}const l=ge(e.to,t);l.style.color=t.color;const i=new C(\"mpadded\",[l]);if(!e.isCharacterBox||/[f∫∑]/.test(e.body.body[0].text)){const e=new C(\"mspace\",[]);e.setAttribute(\"width\",\"0.2em\"),i.children.unshift(e)}i.setAttribute(\"width\",\"0.1px\");const c=new C(\"mover\",[a,i]),p=new C(\"mrow\",[],[\"ff-nudge-left\"]);return B([ce([o,c]),p])}}),g({type:\"textord\",names:[\"\\\\@char\"],props:{numArgs:1,allowedInText:!0},handler({parser:t,token:r},n){const s=Fe(n[0],\"ordgroup\").body;let o=\"\";for(let e=0;e<s.length;e++){o+=Fe(s[e],\"textord\").text}const a=parseInt(o);if(isNaN(a))throw new e(`\\\\@char has non-numeric argument ${o}`,r);return{type:\"textord\",mode:t.mode,text:String.fromCodePoint(a)}}});const vt=/^(#[a-f0-9]{3}|#?[a-f0-9]{6})$/i,At=/^(#[a-f0-9]{3}|#?[a-f0-9]{6}|[a-z]+)$/i,Tt=/^ *\\d{1,3} *(?:, *\\d{1,3} *){2}$/,St=/^ *[10](?:\\.\\d*)? *(?:, *[10](?:\\.\\d*)? *){2}$/,Ot=/^[a-f0-9]{6}$/i,qt=e=>{let t=e.toString(16);return 1===t.length&&(t=\"0\"+t),t},Bt=JSON.parse('{\\n  \"Apricot\": \"#ffb484\",\\n  \"Aquamarine\": \"#08b4bc\",\\n  \"Bittersweet\": \"#c84c14\",\\n  \"blue\": \"#0000FF\",\\n  \"Blue\": \"#303494\",\\n  \"BlueGreen\": \"#08b4bc\",\\n  \"BlueViolet\": \"#503c94\",\\n  \"BrickRed\": \"#b8341c\",\\n  \"brown\": \"#BF8040\",\\n  \"Brown\": \"#802404\",\\n  \"BurntOrange\": \"#f8941c\",\\n  \"CadetBlue\": \"#78749c\",\\n  \"CarnationPink\": \"#f884b4\",\\n  \"Cerulean\": \"#08a4e4\",\\n  \"CornflowerBlue\": \"#40ace4\",\\n  \"cyan\": \"#00FFFF\",\\n  \"Cyan\": \"#08acec\",\\n  \"Dandelion\": \"#ffbc44\",\\n  \"darkgray\": \"#404040\",\\n  \"DarkOrchid\": \"#a8548c\",\\n  \"Emerald\": \"#08ac9c\",\\n  \"ForestGreen\": \"#089c54\",\\n  \"Fuchsia\": \"#90348c\",\\n  \"Goldenrod\": \"#ffdc44\",\\n  \"gray\": \"#808080\",\\n  \"Gray\": \"#98949c\",\\n  \"green\": \"#00FF00\",\\n  \"Green\": \"#08a44c\",\\n  \"GreenYellow\": \"#e0e474\",\\n  \"JungleGreen\": \"#08ac9c\",\\n  \"Lavender\": \"#f89cc4\",\\n  \"lightgray\": \"#c0c0c0\",\\n  \"lime\": \"#BFFF00\",\\n  \"LimeGreen\": \"#90c43c\",\\n  \"magenta\": \"#FF00FF\",\\n  \"Magenta\": \"#f0048c\",\\n  \"Mahogany\": \"#b0341c\",\\n  \"Maroon\": \"#b03434\",\\n  \"Melon\": \"#f89c7c\",\\n  \"MidnightBlue\": \"#086494\",\\n  \"Mulberry\": \"#b03c94\",\\n  \"NavyBlue\": \"#086cbc\",\\n  \"olive\": \"#7F7F00\",\\n  \"OliveGreen\": \"#407c34\",\\n  \"orange\": \"#FF8000\",\\n  \"Orange\": \"#f8843c\",\\n  \"OrangeRed\": \"#f0145c\",\\n  \"Orchid\": \"#b074ac\",\\n  \"Peach\": \"#f8945c\",\\n  \"Periwinkle\": \"#8074bc\",\\n  \"PineGreen\": \"#088c74\",\\n  \"pink\": \"#ff7f7f\",\\n  \"Plum\": \"#98248c\",\\n  \"ProcessBlue\": \"#08b4ec\",\\n  \"purple\": \"#BF0040\",\\n  \"Purple\": \"#a0449c\",\\n  \"RawSienna\": \"#983c04\",\\n  \"red\": \"#ff0000\",\\n  \"Red\": \"#f01c24\",\\n  \"RedOrange\": \"#f86434\",\\n  \"RedViolet\": \"#a0246c\",\\n  \"Rhodamine\": \"#f0549c\",\\n  \"Royallue\": \"#0874bc\",\\n  \"RoyalPurple\": \"#683c9c\",\\n  \"RubineRed\": \"#f0047c\",\\n  \"Salmon\": \"#f8948c\",\\n  \"SeaGreen\": \"#30bc9c\",\\n  \"Sepia\": \"#701404\",\\n  \"SkyBlue\": \"#48c4dc\",\\n  \"SpringGreen\": \"#c8dc64\",\\n  \"Tan\": \"#e09c74\",\\n  \"teal\": \"#007F7F\",\\n  \"TealBlue\": \"#08acb4\",\\n  \"Thistle\": \"#d884b4\",\\n  \"Turquoise\": \"#08b4cc\",\\n  \"violet\": \"#800080\",\\n  \"Violet\": \"#60449c\",\\n  \"VioletRed\": \"#f054a4\",\\n  \"WildStrawberry\": \"#f0246c\",\\n  \"yellow\": \"#FFFF00\",\\n  \"Yellow\": \"#fff404\",\\n  \"YellowGreen\": \"#98cc6c\",\\n  \"YellowOrange\": \"#ffa41c\"\\n}'),Ct=(t,r)=>{let n=\"\";if(\"HTML\"===t){if(!vt.test(r))throw new e(\"Invalid HTML input.\");n=r}else if(\"RGB\"===t){if(!Tt.test(r))throw new e(\"Invalid RGB input.\");r.split(\",\").map(e=>{n+=qt(Number(e.trim()))})}else{if(!St.test(r))throw new e(\"Invalid rbg input.\");r.split(\",\").map(t=>{const r=Number(t.trim());if(r>1)throw new e(\"Color rgb input must be < 1.\");n+=qt(Number((255*r).toFixed(0)))})}return\"#\"!==n.charAt(0)&&(n=\"#\"+n),n},Nt=(t,r,n)=>{const s=`\\\\\\\\color@${t}`;if(!At.exec(t))throw new e(\"Invalid color: '\"+t+\"'\",n);return Ot.test(t)?\"#\"+t:(\"#\"===t.charAt(0)||(r.has(s)?t=r.get(s).tokens[0].text:Bt[t]&&(t=Bt[t])),t)},zt=(e,t)=>{let r=de(e.body,t.withColor(e.color));return 0===r.length&&r.push(new C(\"mrow\")),r=r.map(t=>(t.style.color=e.color,t)),B(r)};g({type:\"color\",names:[\"\\\\textcolor\"],props:{numArgs:2,numOptionalArgs:1,allowedInText:!0,argTypes:[\"raw\",\"raw\",\"original\"]},handler({parser:e,token:t},r,n){const s=n[0]&&Fe(n[0],\"raw\").string;let o=\"\";if(s){const e=Fe(r[0],\"raw\").string;o=Ct(s,e)}else o=Nt(Fe(r[0],\"raw\").string,e.gullet.macros,t);const a=r[1];return{type:\"color\",mode:e.mode,color:o,isTextColor:!0,body:y(a)}},mathmlBuilder:zt}),g({type:\"color\",names:[\"\\\\color\"],props:{numArgs:1,numOptionalArgs:1,allowedInText:!0,argTypes:[\"raw\",\"raw\"]},handler({parser:e,breakOnTokenText:t,token:r},n,s){const o=s[0]&&Fe(s[0],\"raw\").string;let a=\"\";if(o){const e=Fe(n[0],\"raw\").string;a=Ct(o,e)}else a=Nt(Fe(n[0],\"raw\").string,e.gullet.macros,r);const l=e.parseExpression(!0,t,!0);return{type:\"color\",mode:e.mode,color:a,isTextColor:!1,body:l}},mathmlBuilder:zt}),g({type:\"color\",names:[\"\\\\definecolor\"],props:{numArgs:3,allowedInText:!0,argTypes:[\"raw\",\"raw\",\"raw\"]},handler({parser:t,funcName:r,token:n},s){const o=Fe(s[0],\"raw\").string;if(!/^[A-Za-z]+$/.test(o))throw new e(\"Color name must be latin letters.\",n);const a=Fe(s[1],\"raw\").string;if(![\"HTML\",\"RGB\",\"rgb\"].includes(a))throw new e(\"Color model must be HTML, RGB, or rgb.\",n);const l=Fe(s[2],\"raw\").string,i=Ct(a,l);return t.gullet.macros.set(`\\\\\\\\color@${o}`,{tokens:[{text:i}],numArgs:0}),{type:\"internal\",mode:t.mode}}}),g({type:\"cr\",names:[\"\\\\\\\\\"],props:{numArgs:0,numOptionalArgs:0,allowedInText:!0},handler({parser:e},t,r){const n=\"[\"===e.gullet.future().text?e.parseSizeGroup(!0):null,s=!e.settings.displayMode;return{type:\"cr\",mode:e.mode,newLine:s,size:n&&Fe(n,\"size\").value}},mathmlBuilder(e,t){const r=new C(\"mo\");if(e.newLine&&(r.setAttribute(\"linebreak\",\"newline\"),e.size)){const n=Be(e.size,t);r.setAttribute(\"height\",n.number+n.unit)}return r}});const $t={\"\\\\global\":\"\\\\global\",\"\\\\long\":\"\\\\\\\\globallong\",\"\\\\\\\\globallong\":\"\\\\\\\\globallong\",\"\\\\def\":\"\\\\gdef\",\"\\\\gdef\":\"\\\\gdef\",\"\\\\edef\":\"\\\\xdef\",\"\\\\xdef\":\"\\\\xdef\",\"\\\\let\":\"\\\\\\\\globallet\",\"\\\\futurelet\":\"\\\\\\\\globalfuture\"},Et=t=>{const r=t.text;if(/^(?:[\\\\{}$&#^_]|EOF)$/.test(r))throw new e(\"Expected a control sequence\",t);return r},It=(e,t,r,n)=>{let s=e.gullet.macros.get(r.text);null==s&&(r.noexpand=!0,s={tokens:[r],numArgs:0,unexpandable:!e.gullet.isExpandable(r.text)}),e.gullet.macros.set(t,s,n)};g({type:\"internal\",names:[\"\\\\global\",\"\\\\long\",\"\\\\\\\\globallong\"],props:{numArgs:0,allowedInText:!0},handler({parser:t,funcName:r}){t.consumeSpaces();const n=t.fetch();if($t[n.text])return\"\\\\global\"!==r&&\"\\\\\\\\globallong\"!==r||(n.text=$t[n.text]),Fe(t.parseFunction(),\"internal\");throw new e(\"Invalid token after macro prefix\",n)}}),g({type:\"internal\",names:[\"\\\\def\",\"\\\\gdef\",\"\\\\edef\",\"\\\\xdef\"],props:{numArgs:0,allowedInText:!0,primitive:!0},handler({parser:t,funcName:r}){let n=t.gullet.popToken();const s=n.text;if(/^(?:[\\\\{}$&#^_]|EOF)$/.test(s))throw new e(\"Expected a control sequence\",n);let o,a=0;const l=[[]];for(;\"{\"!==t.gullet.future().text;)if(n=t.gullet.popToken(),\"#\"===n.text){if(\"{\"===t.gullet.future().text){o=t.gullet.future(),l[a].push(\"{\");break}if(n=t.gullet.popToken(),!/^[1-9]$/.test(n.text))throw new e(`Invalid argument number \"${n.text}\"`);if(parseInt(n.text)!==a+1)throw new e(`Argument number \"${n.text}\" out of order`);a++,l.push([])}else{if(\"EOF\"===n.text)throw new e(\"Expected a macro definition\");l[a].push(n.text)}let{tokens:i}=t.gullet.consumeArg();if(o&&i.unshift(o),\"\\\\edef\"===r||\"\\\\xdef\"===r){if(i=t.gullet.expandTokens(i),i.length>t.gullet.settings.maxExpand)throw new e(\"Too many expansions in an \"+r);i.reverse()}return t.gullet.macros.set(s,{tokens:i,numArgs:a,delimiters:l},r===$t[r]),{type:\"internal\",mode:t.mode}}}),g({type:\"internal\",names:[\"\\\\let\",\"\\\\\\\\globallet\"],props:{numArgs:0,allowedInText:!0,primitive:!0},handler({parser:e,funcName:t}){const r=Et(e.gullet.popToken());e.gullet.consumeSpaces();const n=(e=>{let t=e.gullet.popToken();return\"=\"===t.text&&(t=e.gullet.popToken(),\" \"===t.text&&(t=e.gullet.popToken())),t})(e);return It(e,r,n,\"\\\\\\\\globallet\"===t),{type:\"internal\",mode:e.mode}}}),g({type:\"internal\",names:[\"\\\\futurelet\",\"\\\\\\\\globalfuture\"],props:{numArgs:0,allowedInText:!0,primitive:!0},handler({parser:e,funcName:t}){const r=Et(e.gullet.popToken()),n=e.gullet.popToken(),s=e.gullet.popToken();return It(e,r,s,\"\\\\\\\\globalfuture\"===t),e.gullet.pushToken(s),e.gullet.pushToken(n),{type:\"internal\",mode:e.mode}}}),g({type:\"internal\",names:[\"\\\\newcommand\",\"\\\\renewcommand\",\"\\\\providecommand\"],props:{numArgs:0,allowedInText:!0,primitive:!0},handler({parser:t,funcName:r}){let n=\"\";const s=t.gullet.popToken();\"{\"===s.text?(n=Et(t.gullet.popToken()),t.gullet.popToken()):n=Et(s);const o=t.gullet.isDefined(n);if(o&&\"\\\\newcommand\"===r)throw new e(`\\\\newcommand{${n}} attempting to redefine ${n}; use \\\\renewcommand`);if(!o&&\"\\\\renewcommand\"===r)throw new e(`\\\\renewcommand{${n}} when command ${n} does not yet exist; use \\\\newcommand`);let a=0;if(\"[\"===t.gullet.future().text){let r=t.gullet.popToken();if(r=t.gullet.popToken(),!/^[0-9]$/.test(r.text))throw new e(`Invalid number of arguments: \"${r.text}\"`);if(a=parseInt(r.text),r=t.gullet.popToken(),\"]\"!==r.text)throw new e(`Invalid argument \"${r.text}\"`)}const{tokens:l}=t.gullet.consumeArg();return\"\\\\providecommand\"===r&&t.gullet.macros.has(n)||t.gullet.macros.set(n,{tokens:l,numArgs:a}),{type:\"internal\",mode:t.mode}}});const Lt={\"\\\\bigl\":{mclass:\"mopen\",size:1},\"\\\\Bigl\":{mclass:\"mopen\",size:2},\"\\\\biggl\":{mclass:\"mopen\",size:3},\"\\\\Biggl\":{mclass:\"mopen\",size:4},\"\\\\bigr\":{mclass:\"mclose\",size:1},\"\\\\Bigr\":{mclass:\"mclose\",size:2},\"\\\\biggr\":{mclass:\"mclose\",size:3},\"\\\\Biggr\":{mclass:\"mclose\",size:4},\"\\\\bigm\":{mclass:\"mrel\",size:1},\"\\\\Bigm\":{mclass:\"mrel\",size:2},\"\\\\biggm\":{mclass:\"mrel\",size:3},\"\\\\Biggm\":{mclass:\"mrel\",size:4},\"\\\\big\":{mclass:\"mord\",size:1},\"\\\\Big\":{mclass:\"mord\",size:2},\"\\\\bigg\":{mclass:\"mord\",size:3},\"\\\\Bigg\":{mclass:\"mord\",size:4}},Ft={\"(\":\")\",\"\\\\lparen\":\"\\\\rparen\",\"[\":\"]\",\"\\\\lbrack\":\"\\\\rbrack\",\"\\\\{\":\"\\\\}\",\"\\\\lbrace\":\"\\\\rbrace\",\"⦇\":\"⦈\",\"\\\\llparenthesis\":\"\\\\rrparenthesis\",\"\\\\lfloor\":\"\\\\rfloor\",\"⌊\":\"⌋\",\"\\\\lceil\":\"\\\\rceil\",\"⌈\":\"⌉\",\"\\\\langle\":\"\\\\rangle\",\"⟨\":\"⟩\",\"\\\\lAngle\":\"\\\\rAngle\",\"⟪\":\"⟫\",\"\\\\llangle\":\"\\\\rrangle\",\"⦉\":\"⦊\",\"\\\\lvert\":\"\\\\rvert\",\"\\\\lVert\":\"\\\\rVert\",\"\\\\lgroup\":\"\\\\rgroup\",\"⟮\":\"⟯\",\"\\\\lmoustache\":\"\\\\rmoustache\",\"⎰\":\"⎱\",\"\\\\llbracket\":\"\\\\rrbracket\",\"⟦\":\"⟧\",\"\\\\lBrace\":\"\\\\rBrace\",\"⦃\":\"⦄\"},jt=new Set(Object.keys(Ft));new Set(Object.values(Ft));const Mt=new Set([\"(\",\"\\\\lparen\",\")\",\"\\\\rparen\",\"[\",\"\\\\lbrack\",\"]\",\"\\\\rbrack\",\"\\\\{\",\"\\\\lbrace\",\"\\\\}\",\"\\\\rbrace\",\"⦇\",\"\\\\llparenthesis\",\"⦈\",\"\\\\rrparenthesis\",\"\\\\lfloor\",\"\\\\rfloor\",\"⌊\",\"⌋\",\"\\\\lceil\",\"\\\\rceil\",\"⌈\",\"⌉\",\"<\",\">\",\"\\\\langle\",\"⟨\",\"\\\\rangle\",\"⟩\",\"\\\\lAngle\",\"⟪\",\"\\\\rAngle\",\"⟫\",\"\\\\llangle\",\"⦉\",\"\\\\rrangle\",\"⦊\",\"\\\\lt\",\"\\\\gt\",\"\\\\lvert\",\"\\\\rvert\",\"\\\\lVert\",\"\\\\rVert\",\"\\\\lgroup\",\"\\\\rgroup\",\"⟮\",\"⟯\",\"\\\\lmoustache\",\"\\\\rmoustache\",\"⎰\",\"⎱\",\"\\\\llbracket\",\"\\\\rrbracket\",\"⟦\",\"⟧\",\"\\\\lBrace\",\"\\\\rBrace\",\"⦃\",\"⦄\",\"/\",\"\\\\backslash\",\"|\",\"\\\\vert\",\"\\\\|\",\"\\\\Vert\",\"‖\",\"\\\\uparrow\",\"\\\\Uparrow\",\"\\\\downarrow\",\"\\\\Downarrow\",\"\\\\updownarrow\",\"\\\\Updownarrow\",\".\"]),Dt=new Set([\"}\",\"\\\\left\",\"\\\\middle\",\"\\\\right\"]),Gt=e=>e.length>0&&(Mt.has(e)||Lt[e]||Dt.has(e)),Pt=[0,1.2,1.8,2.4,3];function Rt(t,r){\"ordgroup\"===t.type&&1===t.body.length&&(t=t.body[0]);const n=Me(t);if(n&&Mt.has(n.text))return\"<\"!==n.text&&\"\\\\lt\"!==n.text||(n.text=\"⟨\"),\">\"!==n.text&&\"\\\\gt\"!==n.text||(n.text=\"⟩\"),n;throw new e(n?`Invalid delimiter '${n.text}' after '${r.funcName}'`:`Invalid delimiter type '${t.type}'`,t)}const Ut=new Set([\"/\",\"\\\\\",\"\\\\backslash\",\"∖\",\"\\\\vert\",\"|\"]),Ht=(e,t,r,n)=>{const s=new C(\"mo\",[ae(\".\"===e?\"\":e,t)]);return s.setAttribute(\"fence\",\"true\"),s.setAttribute(\"form\",r),s.setAttribute(\"stretchy\",n?\"true\":\"false\"),s};function _t(e){if(!e.body)throw new Error(\"Bug: The delim ParseNode wasn't fully parsed.\")}g({type:\"delimsizing\",names:[\"\\\\bigl\",\"\\\\Bigl\",\"\\\\biggl\",\"\\\\Biggl\",\"\\\\bigr\",\"\\\\Bigr\",\"\\\\biggr\",\"\\\\Biggr\",\"\\\\bigm\",\"\\\\Bigm\",\"\\\\biggm\",\"\\\\Biggm\",\"\\\\big\",\"\\\\Big\",\"\\\\bigg\",\"\\\\Bigg\"],props:{numArgs:1,argTypes:[\"primitive\"]},handler:(e,t)=>{const r=Rt(t[0],e),n={type:\"delimsizing\",mode:e.parser.mode,size:Lt[e.funcName].size,mclass:Lt[e.funcName].mclass,delim:r.text},s=e.parser.fetch().text;return\"^\"!==s&&\"_\"!==s?n:{type:\"ordgroup\",mode:\"math\",body:[n,{type:\"ordgroup\",mode:\"math\",body:[]}]}},mathmlBuilder:e=>{const t=[],r=\".\"===e.delim?\"\":e.delim;t.push(ae(r,e.mode));const n=new C(\"mo\",t);return\"mopen\"===e.mclass||\"mclose\"===e.mclass?n.setAttribute(\"fence\",\"true\"):n.setAttribute(\"fence\",\"false\"),(Ut.has(r)||r.indexOf(\"arrow\")>-1)&&n.setAttribute(\"stretchy\",\"true\"),n.setAttribute(\"symmetric\",\"true\"),n.setAttribute(\"minsize\",Pt[e.size]+\"em\"),n.setAttribute(\"maxsize\",Pt[e.size]+\"em\"),n}}),g({type:\"leftright-right\",names:[\"\\\\right\"],props:{numArgs:1,argTypes:[\"primitive\"]},handler:(e,t)=>({type:\"leftright-right\",mode:e.parser.mode,delim:Rt(t[0],e).text})}),g({type:\"leftright\",names:[\"\\\\left\"],props:{numArgs:1,argTypes:[\"primitive\"]},handler:(t,r)=>{const n=Rt(r[0],t),s=t.parser;++s.leftrightDepth;let o=s.parseExpression(!1,\"\\\\right\",!0),a=s.fetch();for(;\"\\\\middle\"===a.text;){s.consume();const t=s.fetch().text;if(!D.math[t])throw new e(`Invalid delimiter '${t}' after '\\\\middle'`);Rt({type:\"atom\",mode:\"math\",text:t},{funcName:\"\\\\middle\"}),o.push({type:\"middle\",mode:\"math\",delim:t}),s.consume(),o=o.concat(s.parseExpression(!1,\"\\\\right\",!0)),a=s.fetch()}--s.leftrightDepth,s.expect(\"\\\\right\",!1);const l=Fe(s.parseFunction(),\"leftright-right\");return{type:\"leftright\",mode:s.mode,body:o,left:n.text,right:l.delim,isStretchy:!0}},mathmlBuilder:(e,t)=>{_t(e);const r=de(e.body,t),n=Ht(e.left,e.mode,\"prefix\",!0);r.unshift(n);const s=Ht(e.right,e.mode,\"postfix\",!0);if(e.body.length>0){const t=e.body[e.body.length-1];\"color\"!==t.type||t.isTextColor||s.setAttribute(\"mathcolor\",t.color)}return r.push(s),ce(r)}}),g({type:\"delimiter\",names:Array.from(jt),props:{numArgs:0,allowedInText:!0,allowedInMath:!0,allowedInArgument:!0},handler:({parser:t,funcName:r,token:n})=>{if(\"text\"===t.mode)return{type:\"textord\",mode:\"text\",text:r,loc:n.loc};if(!t.settings.wrapDelimiterPairs)return{type:\"atom\",mode:\"math\",family:\"open\",loc:n.loc,text:r};const s=Ft[r],o=t.parseExpression(!1,s,!1);if(t.fetch().text!==s)throw new e(\"Unmatched delimiter\");return t.consume(),{type:\"delimiter\",mode:t.mode,body:o,left:r,right:s}},mathmlBuilder:(e,t)=>{_t(e);const r=de(e.body,t),n=Ht(e.left,e.mode,\"prefix\",!1);r.unshift(n);const s=Ht(e.right,e.mode,\"postfix\",!1);if(e.body.length>0){const t=e.body[e.body.length-1];\"color\"!==t.type||t.isTextColor||s.setAttribute(\"mathcolor\",t.color)}return r.push(s),ce(r)}}),g({type:\"middle\",names:[\"\\\\middle\"],props:{numArgs:1,argTypes:[\"primitive\"]},handler:(t,r)=>{const n=Rt(r[0],t);if(!t.parser.leftrightDepth)throw new e(\"\\\\middle without preceding \\\\left\",n);return{type:\"middle\",mode:t.parser.mode,delim:n.text}},mathmlBuilder:e=>{const t=ae(e.delim,e.mode),r=new C(\"mo\",[t]);return r.setAttribute(\"stretchy\",\"true\"),r.setAttribute(\"form\",\"infix\"),\"/\"!==t.text&&(r.setAttribute(\"lspace\",\"0.05em\"),r.setAttribute(\"rspace\",\"0.05em\")),r}});const Vt=[\"\\\\boxed\",\"\\\\fcolorbox\",\"\\\\colorbox\"],Wt=(e,t)=>{const r=Vt.includes(e.label)?\"mrow\":\"menclose\",n=new C(r,[ge(e.body,t)]);switch(e.label){case\"\\\\overline\":n.setAttribute(\"notation\",\"top\"),n.classes.push(\"tml-overline\");break;case\"\\\\underline\":n.setAttribute(\"notation\",\"bottom\"),n.classes.push(\"tml-underline\");break;case\"\\\\cancel\":n.setAttribute(\"notation\",\"updiagonalstrike\"),n.children.push(new C(\"mrow\",[],[\"tml-cancel\",\"upstrike\"]));break;case\"\\\\bcancel\":n.setAttribute(\"notation\",\"downdiagonalstrike\"),n.children.push(new C(\"mrow\",[],[\"tml-cancel\",\"downstrike\"]));break;case\"\\\\sout\":n.setAttribute(\"notation\",\"horizontalstrike\"),n.children.push(new C(\"mrow\",[],[\"tml-cancel\",\"sout\"]));break;case\"\\\\xcancel\":n.setAttribute(\"notation\",\"updiagonalstrike downdiagonalstrike\"),n.children.push(new C(\"mrow\",[],[\"tml-cancel\",\"tml-xcancel\"]));break;case\"\\\\longdiv\":n.setAttribute(\"notation\",\"longdiv\"),n.classes.push(\"longdiv-top\"),n.children.push(new C(\"mrow\",[],[\"longdiv-arc\"]));break;case\"\\\\phase\":n.setAttribute(\"notation\",\"phasorangle\"),n.classes.push(\"phasor-bottom\"),n.children.push(new C(\"mrow\",[],[\"phasor-angle\"]));break;case\"\\\\textcircled\":n.setAttribute(\"notation\",\"circle\"),n.classes.push(\"circle-pad\"),n.children.push(new C(\"mrow\",[],[\"textcircle\"]));break;case\"\\\\angl\":n.setAttribute(\"notation\",\"actuarial\"),n.classes.push(\"actuarial\");break;case\"\\\\boxed\":n.style.padding=\"3pt\",n.style.border=\"1px solid\",n.setAttribute(\"scriptlevel\",\"0\"),n.setAttribute(\"displaystyle\",\"true\");break;case\"\\\\fbox\":n.setAttribute(\"notation\",\"box\"),n.classes.push(\"tml-fbox\");break;case\"\\\\fcolorbox\":case\"\\\\colorbox\":n.style.padding=\"0.3em\",\"\\\\fcolorbox\"===e.label&&(n.style.border=\"0.0667em solid \"+String(e.borderColor))}return e.backgroundColor&&n.setAttribute(\"mathbackground\",e.backgroundColor),n};g({type:\"enclose\",names:[\"\\\\colorbox\"],props:{numArgs:2,numOptionalArgs:1,allowedInText:!0,argTypes:[\"raw\",\"raw\",\"text\"]},handler({parser:e,funcName:t},r,n){const s=n[0]&&Fe(n[0],\"raw\").string;let o=\"\";if(s){const e=Fe(r[0],\"raw\").string;o=Ct(s,e)}else o=Nt(Fe(r[0],\"raw\").string,e.gullet.macros);const a=r[1];return{type:\"enclose\",mode:e.mode,label:t,backgroundColor:o,body:a}},mathmlBuilder:Wt}),g({type:\"enclose\",names:[\"\\\\fcolorbox\"],props:{numArgs:3,numOptionalArgs:1,allowedInText:!0,argTypes:[\"raw\",\"raw\",\"raw\",\"text\"]},handler({parser:e,funcName:t},r,n){const s=n[0]&&Fe(n[0],\"raw\").string;let o,a=\"\";if(s){const e=Fe(r[0],\"raw\").string,t=Fe(r[0],\"raw\").string;a=Ct(s,e),o=Ct(s,t)}else a=Nt(Fe(r[0],\"raw\").string,e.gullet.macros),o=Nt(Fe(r[1],\"raw\").string,e.gullet.macros);const l=r[2];return{type:\"enclose\",mode:e.mode,label:t,backgroundColor:o,borderColor:a,body:l}},mathmlBuilder:Wt}),g({type:\"enclose\",names:[\"\\\\fbox\"],props:{numArgs:1,argTypes:[\"hbox\"],allowedInText:!0},handler:({parser:e},t)=>({type:\"enclose\",mode:e.mode,label:\"\\\\fbox\",body:t[0]})}),g({type:\"enclose\",names:[\"\\\\angl\",\"\\\\cancel\",\"\\\\bcancel\",\"\\\\xcancel\",\"\\\\overline\",\"\\\\boxed\",\"\\\\longdiv\",\"\\\\phase\"],props:{numArgs:1},handler({parser:e,funcName:t},r){const n=r[0];return{type:\"enclose\",mode:e.mode,label:t,body:n}},mathmlBuilder:Wt}),g({type:\"enclose\",names:[\"\\\\sout\"],props:{numArgs:1,allowedInText:!0},handler({parser:e,funcName:t},r){const n=r[0];return{type:\"enclose\",mode:e.mode,label:t,body:n}},mathmlBuilder:Wt}),g({type:\"enclose\",names:[\"\\\\underline\"],props:{numArgs:1,allowedInText:!0},handler({parser:e,funcName:t},r){const n=r[0];return{type:\"enclose\",mode:e.mode,label:t,body:n}},mathmlBuilder:Wt}),g({type:\"enclose\",names:[\"\\\\textcircled\"],props:{numArgs:1,argTypes:[\"text\"],allowedInArgument:!0,allowedInText:!0},handler({parser:e,funcName:t},r){const n=r[0];return{type:\"enclose\",mode:e.mode,label:t,body:n}},mathmlBuilder:Wt}),g({type:\"environment\",names:[\"\\\\begin\",\"\\\\end\"],props:{numArgs:1,argTypes:[\"text\"]},handler({parser:t,funcName:r},n){const s=n[0];if(\"ordgroup\"!==s.type)throw new e(\"Invalid environment name\",s);let o=\"\";for(let e=0;e<s.body.length;++e)o+=Fe(s.body[e],\"textord\").text;if(\"\\\\begin\"===r){if(!Object.prototype.hasOwnProperty.call(kt,o))throw new e(\"No such environment: \"+o,s);const r=kt[o],{args:n,optArgs:a}=t.parseArguments(\"\\\\begin{\"+o+\"}\",r),l={mode:t.mode,envName:o,parser:t},i=r.handler(l,n,a);t.expect(\"\\\\end\",!1);const c=t.nextToken,m=Fe(t.parseFunction(),\"environment\");if(m.name!==o)throw new e(`Mismatch: \\\\begin{${o}} matched by \\\\end{${m.name}}`,c);return i}return{type:\"environment\",mode:t.mode,name:o,nameGroup:s}}}),g({type:\"envTag\",names:[\"\\\\env@tag\"],props:{numArgs:1,argTypes:[\"math\"]},handler:({parser:e},t)=>({type:\"envTag\",mode:e.mode,body:t[0]}),mathmlBuilder:(e,t)=>new C(\"mrow\")}),g({type:\"noTag\",names:[\"\\\\env@notag\"],props:{numArgs:0},handler:({parser:e})=>({type:\"noTag\",mode:e.mode}),mathmlBuilder:(e,t)=>new C(\"mrow\")});const Xt=Object.freeze({B:8426,E:8427,F:8427,H:8387,I:8391,L:8390,M:8422,R:8393,e:8394,g:8355,o:8389}),Zt=Object.freeze({C:8426,H:8388,I:8392,R:8394,Z:8398}),Yt=Object.freeze({C:8383,H:8389,N:8391,P:8393,Q:8393,R:8395,Z:8394}),Jt=Object.freeze({\"ϵ\":119527,\"ϑ\":119564,\"ϰ\":119534,\"φ\":119577,\"ϱ\":119535,\"ϖ\":119563}),Kt=Object.freeze({\"ϵ\":119643,\"ϑ\":119680,\"ϰ\":119650,\"φ\":119693,\"ϱ\":119651,\"ϖ\":119679}),Qt=Object.freeze({\"ϵ\":119701,\"ϑ\":119738,\"ϰ\":119708,\"φ\":119751,\"ϱ\":119709,\"ϖ\":119737}),er=Object.freeze({\"ϵ\":119759,\"ϑ\":119796,\"ϰ\":119766,\"φ\":119809,\"ϱ\":119767,\"ϖ\":119795}),tr=Object.freeze({upperCaseLatin:{normal:e=>0,bold:e=>119743,italic:e=>119795,\"bold-italic\":e=>119847,script:e=>Xt[e]||119899,\"script-bold\":e=>119951,fraktur:e=>Zt[e]||120003,\"fraktur-bold\":e=>120107,\"double-struck\":e=>Yt[e]||120055,\"sans-serif\":e=>120159,\"sans-serif-bold\":e=>120211,\"sans-serif-italic\":e=>120263,\"sans-serif-bold-italic\":e=>120380,monospace:e=>120367},lowerCaseLatin:{normal:e=>0,bold:e=>119737,italic:e=>\"h\"===e?8358:119789,\"bold-italic\":e=>119841,script:e=>Xt[e]||119893,\"script-bold\":e=>119945,fraktur:e=>119997,\"fraktur-bold\":e=>120101,\"double-struck\":e=>120049,\"sans-serif\":e=>120153,\"sans-serif-bold\":e=>120205,\"sans-serif-italic\":e=>120257,\"sans-serif-bold-italic\":e=>120309,monospace:e=>120361},upperCaseGreek:{normal:e=>0,bold:e=>119575,italic:e=>119633,\"bold-italic\":e=>119575,script:e=>0,\"script-bold\":e=>0,fraktur:e=>0,\"fraktur-bold\":e=>0,\"double-struck\":e=>0,\"sans-serif\":e=>119749,\"sans-serif-bold\":e=>119749,\"sans-serif-italic\":e=>0,\"sans-serif-bold-italic\":e=>119807,monospace:e=>0},lowerCaseGreek:{normal:e=>0,bold:e=>119569,italic:e=>119627,\"bold-italic\":e=>\"ϕ\"===e?119678:119685,script:e=>0,\"script-bold\":e=>0,fraktur:e=>0,\"fraktur-bold\":e=>0,\"double-struck\":e=>0,\"sans-serif\":e=>119743,\"sans-serif-bold\":e=>119743,\"sans-serif-italic\":e=>0,\"sans-serif-bold-italic\":e=>119801,monospace:e=>0},varGreek:{normal:e=>0,bold:e=>Jt[e]||-51,italic:e=>0,\"bold-italic\":e=>Kt[e]||58,script:e=>0,\"script-bold\":e=>0,fraktur:e=>0,\"fraktur-bold\":e=>0,\"double-struck\":e=>0,\"sans-serif\":e=>Qt[e]||116,\"sans-serif-bold\":e=>Qt[e]||116,\"sans-serif-italic\":e=>0,\"sans-serif-bold-italic\":e=>er[e]||174,monospace:e=>0},numeral:{normal:e=>0,bold:e=>120734,italic:e=>0,\"bold-italic\":e=>0,script:e=>0,\"script-bold\":e=>0,fraktur:e=>0,\"fraktur-bold\":e=>0,\"double-struck\":e=>120744,\"sans-serif\":e=>120754,\"sans-serif-bold\":e=>120764,\"sans-serif-italic\":e=>0,\"sans-serif-bold-italic\":e=>0,monospace:e=>120774}}),rr=(e,t)=>{const r=e.codePointAt(0),n=64<r&&r<91?\"upperCaseLatin\":96<r&&r<123?\"lowerCaseLatin\":912<r&&r<938?\"upperCaseGreek\":944<r&&r<970||\"ϕ\"===e?\"lowerCaseGreek\":120545<r&&r<120572||Jt[e]?\"varGreek\":47<r&&r<58?\"numeral\":\"other\";return\"other\"===n?e:String.fromCodePoint(r+tr[n][t](e))},nr=Object.freeze({a:\"ᴀ\",b:\"ʙ\",c:\"ᴄ\",d:\"ᴅ\",e:\"ᴇ\",f:\"ꜰ\",g:\"ɢ\",h:\"ʜ\",i:\"ɪ\",j:\"ᴊ\",k:\"ᴋ\",l:\"ʟ\",m:\"ᴍ\",n:\"ɴ\",o:\"ᴏ\",p:\"ᴘ\",q:\"ǫ\",r:\"ʀ\",s:\"s\",t:\"ᴛ\",u:\"ᴜ\",v:\"ᴠ\",w:\"ᴡ\",x:\"x\",y:\"ʏ\",z:\"ᴢ\"}),sr=[\"mathrm\",\"mathit\"],or=(e,t)=>{const r=e.font,n=t.withFont(r),s=ge(e.body,n);if(0===s.children.length)return s;if(\"boldsymbol\"===r&&[\"mo\",\"mpadded\",\"mrow\"].includes(s.type))return s.style.fontWeight=\"bold\",s;if(((e,t)=>{if(!sr.includes(t)||!e.body||\"ordgroup\"!==e.body.type||1===e.body.body.length)return!1;if(\"mathord\"!==e.body.body[0].type)return!1;for(let t=1;t<e.body.body.length;t++){const r=e.body.body[t].type;if(\"mathord\"!==r&&(\"textord\"!==r||isNaN(e.body.body[t].text)))return!1}return!0})(e,r)){const e=s.children[0].children[0].children?s.children[0].children[0]:s.children[0];delete e.attributes.mathvariant;for(let t=1;t<s.children.length;t++)e.children[0].text+=s.children[t].children[0].children?s.children[t].children[0].children[0].text:s.children[t].children[0].text;if(\"mathit\"===r)return e.children[0].text=e.children[0].text.split(\"\").map(e=>rr(e,\"italic\")).join(\"\"),e;const t=new C(\"mpadded\",[e]);return t.setAttribute(\"lspace\",\"0\"),t}let o=\"mo\"===s.children[0].type;for(let e=1;e<s.children.length;e++){\"mo\"===s.children[e].type&&\"boldsymbol\"===r&&(s.children[e].style.fontWeight=\"bold\"),\"mi\"!==s.children[e].type&&(o=!1);\"normal\"!==(s.children[e].attributes&&s.children[e].attributes.mathvariant||\"\")&&(o=!1)}if(!o)return s;const a=s.children[0];for(let e=1;e<s.children.length;e++)a.children.push(s.children[e].children[0]);if(a.attributes.mathvariant&&\"normal\"===a.attributes.mathvariant){const e=new C(\"mtext\",new N(\"​\"));return new C(\"mrow\",[e,a])}return a},ar={\"\\\\Bbb\":\"\\\\mathbb\",\"\\\\bold\":\"\\\\mathbf\",\"\\\\frak\":\"\\\\mathfrak\",\"\\\\bm\":\"\\\\boldsymbol\"};g({type:\"font\",names:[\"\\\\mathrm\",\"\\\\mathit\",\"\\\\mathbf\",\"\\\\mathnormal\",\"\\\\up@greek\",\"\\\\boldsymbol\",\"\\\\mathbb\",\"\\\\mathcal\",\"\\\\mathfrak\",\"\\\\mathscr\",\"\\\\mathsf\",\"\\\\mathsfit\",\"\\\\mathtt\",\"\\\\Bbb\",\"\\\\bm\",\"\\\\bold\",\"\\\\frak\"],props:{numArgs:1,allowedInArgument:!0},handler:({parser:e,funcName:t},r)=>{const n=b(r[0]);let s=t;return s in ar&&(s=ar[s]),{type:\"font\",mode:e.mode,font:s.slice(1),body:n}},mathmlBuilder:or}),g({type:\"font\",names:[\"\\\\rm\",\"\\\\sf\",\"\\\\tt\",\"\\\\bf\",\"\\\\it\",\"\\\\cal\"],props:{numArgs:0,allowedInText:!0},handler:({parser:e,funcName:t,breakOnTokenText:r},n)=>{const{mode:s}=e,o=e.parseExpression(!0,r,!0);return{type:\"font\",mode:s,font:`math${t.slice(1)}`,body:{type:\"ordgroup\",mode:e.mode,body:o}}},mathmlBuilder:or});const lr=[\"display\",\"text\",\"script\",\"scriptscript\"],ir={auto:-1,display:0,text:0,script:1,scriptscript:2},cr=(e,t)=>{t=((e,t)=>{let r=t;if(\"display\"===e){const e=r.level>=Ye?Ze:Xe;r=r.withLevel(e)}else\"text\"===e&&r.level===Xe?r=r.withLevel(Ze):\"auto\"===e?r=r.incrementLevel():\"script\"===e?r=r.withLevel(Ye):\"scriptscript\"===e&&(r=r.withLevel(Je));return r})(e.scriptLevel,t);const r=ge(e.numer,t),n=ge(e.denom,t);3===t.level&&(r.style.mathDepth=\"2\",r.setAttribute(\"scriptlevel\",\"2\"),n.style.mathDepth=\"2\",n.setAttribute(\"scriptlevel\",\"2\"));let s=new C(\"mfrac\",[r,n]);if(e.hasBarLine){if(e.barSize){const r=Be(e.barSize,t);s.setAttribute(\"linethickness\",r.number+r.unit)}}else s.setAttribute(\"linethickness\",\"0px\");if(null!=e.leftDelim||null!=e.rightDelim){const t=[];if(null!=e.leftDelim){const r=new C(\"mo\",[new N(e.leftDelim.replace(\"\\\\\",\"\"))]);r.setAttribute(\"fence\",\"true\"),t.push(r)}if(t.push(s),null!=e.rightDelim){const r=new C(\"mo\",[new N(e.rightDelim.replace(\"\\\\\",\"\"))]);r.setAttribute(\"fence\",\"true\"),t.push(r)}s=ce(t)}return\"auto\"!==e.scriptLevel&&(s=new C(\"mstyle\",[s]),s.setAttribute(\"displaystyle\",String(\"display\"===e.scriptLevel)),s.setAttribute(\"scriptlevel\",ir[e.scriptLevel])),s};g({type:\"genfrac\",names:[\"\\\\cfrac\",\"\\\\dfrac\",\"\\\\frac\",\"\\\\tfrac\",\"\\\\dbinom\",\"\\\\binom\",\"\\\\tbinom\",\"\\\\\\\\atopfrac\",\"\\\\\\\\bracefrac\",\"\\\\\\\\brackfrac\"],props:{numArgs:2,allowedInArgument:!0},handler:({parser:e,funcName:t},r)=>{const n=r[0],s=r[1];let o=!1,a=null,l=null,i=\"auto\";switch(t){case\"\\\\cfrac\":case\"\\\\dfrac\":case\"\\\\frac\":case\"\\\\tfrac\":o=!0;break;case\"\\\\\\\\atopfrac\":o=!1;break;case\"\\\\dbinom\":case\"\\\\binom\":case\"\\\\tbinom\":a=\"(\",l=\")\";break;case\"\\\\\\\\bracefrac\":a=\"\\\\{\",l=\"\\\\}\";break;case\"\\\\\\\\brackfrac\":a=\"[\",l=\"]\";break;default:throw new Error(\"Unrecognized genfrac command\")}return\"\\\\cfrac\"===t||t.startsWith(\"\\\\d\")?i=\"display\":t.startsWith(\"\\\\t\")&&(i=\"text\"),{type:\"genfrac\",mode:e.mode,continued:!1,numer:n,denom:s,hasBarLine:o,leftDelim:a,rightDelim:l,scriptLevel:i,barSize:null}},mathmlBuilder:cr}),g({type:\"infix\",names:[\"\\\\over\",\"\\\\choose\",\"\\\\atop\",\"\\\\brace\",\"\\\\brack\"],props:{numArgs:0,infix:!0},handler({parser:e,funcName:t,token:r}){let n;switch(t){case\"\\\\over\":n=\"\\\\frac\";break;case\"\\\\choose\":n=\"\\\\binom\";break;case\"\\\\atop\":n=\"\\\\\\\\atopfrac\";break;case\"\\\\brace\":n=\"\\\\\\\\bracefrac\";break;case\"\\\\brack\":n=\"\\\\\\\\brackfrac\";break;default:throw new Error(\"Unrecognized infix genfrac command\")}return{type:\"infix\",mode:e.mode,replaceWith:n,token:r}}});const mr=function(e){let t=null;return e.length>0&&(t=e,t=\".\"===t?null:t),t};g({type:\"genfrac\",names:[\"\\\\genfrac\"],props:{numArgs:6,allowedInArgument:!0,argTypes:[\"math\",\"math\",\"size\",\"text\",\"math\",\"math\"]},handler({parser:e},t){const r=t[4],n=t[5],s=b(t[0]),o=\"atom\"===s.type&&\"open\"===s.family?mr(s.text):null,a=b(t[1]),l=\"atom\"===a.type&&\"close\"===a.family?mr(a.text):null,i=Fe(t[2],\"size\");let c,m=null;i.isBlank?c=!0:(m=i.value,c=m.number>0);let p=\"auto\",u=t[3];if(\"ordgroup\"===u.type){if(u.body.length>0){const e=Fe(u.body[0],\"textord\");p=lr[Number(e.text)]}}else u=Fe(u,\"textord\"),p=lr[Number(u.text)];return{type:\"genfrac\",mode:e.mode,numer:r,denom:n,continued:!1,hasBarLine:c,barSize:m,leftDelim:o,rightDelim:l,scriptLevel:p}},mathmlBuilder:cr}),g({type:\"infix\",names:[\"\\\\above\"],props:{numArgs:1,argTypes:[\"size\"],infix:!0},handler:({parser:e,funcName:t,token:r},n)=>({type:\"infix\",mode:e.mode,replaceWith:\"\\\\\\\\abovefrac\",barSize:Fe(n[0],\"size\").value,token:r})}),g({type:\"genfrac\",names:[\"\\\\\\\\abovefrac\"],props:{numArgs:3,argTypes:[\"math\",\"size\",\"math\"]},handler:({parser:e,funcName:t},r)=>{const n=r[0],s=function(e){if(!e)throw new Error(\"Expected non-null, but got \"+String(e));return e}(Fe(r[1],\"infix\").barSize),o=r[2],a=s.number>0;return{type:\"genfrac\",mode:e.mode,numer:n,denom:o,continued:!1,hasBarLine:a,barSize:s,leftDelim:null,rightDelim:null,scriptLevel:\"auto\"}},mathmlBuilder:cr}),g({type:\"hbox\",names:[\"\\\\hbox\"],props:{numArgs:1,argTypes:[\"hbox\"],allowedInArgument:!0,allowedInText:!1},handler:({parser:e},t)=>({type:\"hbox\",mode:e.mode,body:y(t[0])}),mathmlBuilder(e,t){const r=t.withLevel(Ze),n=he(e.body,r);return ie(n)}});g({type:\"horizBracket\",names:[\"\\\\overbrace\",\"\\\\underbrace\",\"\\\\overbracket\",\"\\\\underbracket\"],props:{numArgs:1},handler:({parser:e,funcName:t},r)=>({type:\"horizBracket\",mode:e.mode,label:t,isOver:/^\\\\over/.test(t),base:r[0]}),mathmlBuilder:(e,t)=>{const r=I(e.label);return r.style[\"math-depth\"]=0,new C(e.isOver?\"mover\":\"munder\",[ge(e.base,t),r])}}),g({type:\"html\",names:[\"\\\\class\",\"\\\\id\",\"\\\\style\",\"\\\\data\"],props:{numArgs:2,argTypes:[\"raw\",\"original\"],allowedInText:!0},handler:({parser:t,funcName:r,token:n},s)=>{const o=Fe(s[0],\"raw\").string,a=s[1];if(t.settings.strict)throw new e(`Function \"${r}\" is disabled in strict mode`,n);let l;const i={};switch(r){case\"\\\\class\":i.class=o,l={command:\"\\\\class\",class:o};break;case\"\\\\id\":i.id=o,l={command:\"\\\\id\",id:o};break;case\"\\\\style\":i.style=o,l={command:\"\\\\style\",style:o};break;case\"\\\\data\":{const t=o.split(\",\");for(let r=0;r<t.length;r++){const n=t[r].split(\"=\");if(2!==n.length)throw new e(\"Error parsing key-value for \\\\data\");i[\"data-\"+n[0].trim()]=n[1].trim()}l={command:\"\\\\data\",attributes:i};break}default:throw new Error(\"Unrecognized html command\")}if(!t.settings.isTrusted(l))throw new e(`Function \"${r}\" is not trusted`,n);return{type:\"html\",mode:t.mode,attributes:i,body:y(a)}},mathmlBuilder:(e,t)=>{const r=he(e.body,t),n=[];e.attributes.class&&n.push(...e.attributes.class.trim().split(/\\s+/)),r.classes=n;for(const t in e.attributes)\"class\"!==t&&Object.prototype.hasOwnProperty.call(e.attributes,t)&&r.setAttribute(t,e.attributes[t]);return r}});const pr=function(t){if(/^[-+]? *(\\d+(\\.\\d*)?|\\.\\d+)$/.test(t))return{number:+t,unit:\"bp\"};{const r=/([-+]?) *(\\d+(?:\\.\\d*)?|\\.\\d+) *([a-z]{2})/.exec(t);if(!r)throw new e(\"Invalid size: '\"+t+\"' in \\\\includegraphics\");const n={number:+(r[1]+r[2]),unit:r[3]};if(!Oe(n))throw new e(\"Invalid unit: '\"+n.unit+\"' in \\\\includegraphics.\");return n}};g({type:\"includegraphics\",names:[\"\\\\includegraphics\"],props:{numArgs:1,numOptionalArgs:1,argTypes:[\"raw\",\"url\"],allowedInText:!1},handler:({parser:t,token:r},n,s)=>{let o={number:0,unit:\"em\"},a={number:.9,unit:\"em\"},l={number:0,unit:\"em\"},i=\"\";if(s[0]){const t=Fe(s[0],\"raw\").string.split(\",\");for(let r=0;r<t.length;r++){const n=t[r].split(\"=\");if(2===n.length){const t=n[1].trim();switch(n[0].trim()){case\"alt\":i=t;break;case\"width\":o=pr(t);break;case\"height\":a=pr(t);break;case\"totalheight\":l=pr(t);break;default:throw new e(\"Invalid key: '\"+n[0]+\"' in \\\\includegraphics.\")}}}}const c=Fe(n[0],\"url\").url;if(\"\"===i&&(i=c,i=i.replace(/^.*[\\\\/]/,\"\"),i=i.substring(0,i.lastIndexOf(\".\"))),!t.settings.isTrusted({command:\"\\\\includegraphics\",url:c}))throw new e('Function \"\\\\includegraphics\" is not trusted',r);return{type:\"includegraphics\",mode:t.mode,alt:i,width:o,height:a,totalheight:l,src:c}},mathmlBuilder:(e,t)=>{const r=Be(e.height,t),n={number:0,unit:\"em\"};e.totalheight.number>0&&e.totalheight.unit===r.unit&&e.totalheight.number>r.number&&(n.number=e.totalheight.number-r.number,n.unit=r.unit);let s=0;e.width.number>0&&(s=Be(e.width,t));const o={height:r.number+n.number+\"em\"};s.number>0&&(o.width=s.number+s.unit),n.number>0&&(o.verticalAlign=-n.number+n.unit);const a=new q(e.src,e.alt,o);return a.height=r,a.depth=n,new C(\"mtext\",[a])}}),g({type:\"kern\",names:[\"\\\\kern\",\"\\\\mkern\",\"\\\\hskip\",\"\\\\mskip\"],props:{numArgs:1,argTypes:[\"size\"],primitive:!0,allowedInText:!0},handler({parser:t,funcName:r,token:n},s){const o=Fe(s[0],\"size\");if(t.settings.strict){const s=\"m\"===r[1],a=\"mu\"===o.value.unit;if(s){if(!a)throw new e(`LaTeX's ${r} supports only mu units, not ${o.value.unit} units`,n);if(\"math\"!==t.mode)throw new e(`LaTeX's ${r} works only in math mode`,n)}else if(a)throw new e(`LaTeX's ${r} doesn't support mu units`,n)}return{type:\"kern\",mode:t.mode,dimension:o.value}},mathmlBuilder(e,t){const r=Be(e.dimension,t),n=r.number>0&&\"em\"===r.unit?ur(r.number):\"\";if(\"text\"===e.mode&&n.length>0){const e=new N(n);return new C(\"mtext\",[e])}if(r.number>=0){const e=new C(\"mspace\");return e.setAttribute(\"width\",r.number+r.unit),e}{const e=new C(\"mrow\");return e.style.marginLeft=r.number+r.unit,e}}});const ur=function(e){return e>=.05555&&e<=.05556?\" \":e>=.1666&&e<=.1667?\" \":e>=.2222&&e<=.2223?\" \":e>=.2777&&e<=.2778?\"  \":\"\"},dr=/[^A-Za-z_0-9-]/g;g({type:\"label\",names:[\"\\\\label\"],props:{numArgs:1,argTypes:[\"raw\"]},handler:({parser:e},t)=>({type:\"label\",mode:e.mode,string:t[0].string.replace(dr,\"\")}),mathmlBuilder(e,t){const r=new C(\"mrow\",[],[\"tml-label\"]);return e.string.length>0&&r.setLabel(e.string),r}});const hr=[\"\\\\clap\",\"\\\\llap\",\"\\\\rlap\"];g({type:\"lap\",names:[\"\\\\mathllap\",\"\\\\mathrlap\",\"\\\\mathclap\",\"\\\\clap\",\"\\\\llap\",\"\\\\rlap\"],props:{numArgs:1,allowedInText:!0},handler:({parser:t,funcName:r,token:n},s)=>{if(hr.includes(r)){if(t.settings.strict&&\"text\"!==t.mode)throw new e(`{${r}} can be used only in text mode.\\n Try \\\\math${r.slice(1)}`,n);r=r.slice(1)}else r=r.slice(5);const o=s[0];return{type:\"lap\",mode:t.mode,alignment:r,body:o}},mathmlBuilder:(e,t)=>{let r;if(\"llap\"===e.alignment){const n=de(y(e.body),t),s=new C(\"mphantom\",n);r=new C(\"mpadded\",[s]),r.setAttribute(\"width\",\"0.1px\")}const n=ge(e.body,t);let s;if(\"llap\"===e.alignment?(n.style.position=\"absolute\",n.style.right=\"0\",n.style.bottom=\"0\",s=new C(\"mpadded\",[r,n])):s=new C(\"mpadded\",[n]),\"rlap\"===e.alignment)e.body.body.length>0&&\"genfrac\"===e.body.body[0].type&&s.setAttribute(\"lspace\",\"0.16667em\");else{const t=\"llap\"===e.alignment?\"-1\":\"-0.5\";s.setAttribute(\"lspace\",t+\"width\"),\"llap\"===e.alignment?s.style.position=\"relative\":(s.style.display=\"flex\",s.style.justifyContent=\"center\")}return s.setAttribute(\"width\",\"0.1px\"),s}}),g({type:\"ordgroup\",names:[\"\\\\(\",\"$\"],props:{numArgs:0,allowedInText:!0,allowedInMath:!1},handler({funcName:e,parser:t},r){const n=t.mode;t.switchMode(\"math\");const s=\"\\\\(\"===e?\"\\\\)\":\"$\",o=t.parseExpression(!1,s);return t.expect(s),t.switchMode(n),{type:\"ordgroup\",mode:t.mode,body:o}}}),g({type:\"text\",names:[\"\\\\)\",\"\\\\]\"],props:{numArgs:0,allowedInText:!0,allowedInMath:!1},handler(t,r){throw new e(`Mismatched ${t.funcName}`,r)}});g({type:\"mathchoice\",names:[\"\\\\mathchoice\"],props:{numArgs:4,primitive:!0},handler:({parser:e},t)=>({type:\"mathchoice\",mode:e.mode,display:y(t[0]),text:y(t[1]),script:y(t[2]),scriptscript:y(t[3])}),mathmlBuilder:(e,t)=>{const r=((e,t)=>{switch(t.level){case Xe:return e.display;case Ze:return e.text;case Ye:return e.script;case Je:return e.scriptscript;default:return e.text}})(e,t);return he(r,t)}});const gr=[\"text\",\"textord\",\"mathord\",\"atom\"];function fr(e,t){let r;const n=de(e.body,t);if(\"minner\"===e.mclass)r=new C(\"mpadded\",n);else if(\"mord\"===e.mclass)e.isCharacterBox||\"mathord\"===n[0].type?(r=n[0],r.type=\"mi\",1===r.children.length&&r.children[0].text&&\"∇\"===r.children[0].text&&r.setAttribute(\"mathvariant\",\"normal\")):r=new C(\"mi\",n);else{r=new C(\"mrow\",n),e.mustPromote?(r=n[0],r.type=\"mo\",e.isCharacterBox&&e.body[0].text&&/[A-Za-z]/.test(e.body[0].text)&&r.setAttribute(\"mathvariant\",\"italic\")):r=new C(\"mrow\",n);const s=t.level<2;\"mrow\"===r.type?s&&(\"mbin\"===e.mclass?(r.children.unshift(Ce(.2222)),r.children.push(Ce(.2222))):\"mrel\"===e.mclass?(r.children.unshift(Ce(.2778)),r.children.push(Ce(.2778))):\"mpunct\"===e.mclass?r.children.push(Ce(.1667)):\"minner\"===e.mclass&&(r.children.unshift(Ce(.0556)),r.children.push(Ce(.0556)))):\"mbin\"===e.mclass?(r.attributes.lspace=s?\"0.2222em\":\"0\",r.attributes.rspace=s?\"0.2222em\":\"0\"):\"mrel\"===e.mclass?(r.attributes.lspace=s?\"0.2778em\":\"0\",r.attributes.rspace=s?\"0.2778em\":\"0\"):\"mpunct\"===e.mclass?(r.attributes.lspace=\"0em\",r.attributes.rspace=s?\"0.1667em\":\"0\"):\"mopen\"===e.mclass||\"mclose\"===e.mclass?(r.attributes.lspace=\"0em\",r.attributes.rspace=\"0em\"):\"minner\"===e.mclass&&s&&(r.attributes.lspace=\"0.0556em\",r.attributes.width=\"+0.1111em\"),\"mopen\"!==e.mclass&&\"mclose\"!==e.mclass&&(delete r.attributes.stretchy,delete r.attributes.form)}return r}g({type:\"mclass\",names:[\"\\\\mathord\",\"\\\\mathbin\",\"\\\\mathrel\",\"\\\\mathopen\",\"\\\\mathclose\",\"\\\\mathpunct\",\"\\\\mathinner\"],props:{numArgs:1,primitive:!0},handler({parser:e,funcName:t},r){const n=r[0],s=i(n);let o=!0;const a={type:\"mathord\",text:\"\",mode:e.mode},l=n.body?n.body:[n];for(const t of l){if(!gr.includes(t.type)){o=!1;break}D[e.mode][t.text]?a.text+=D[e.mode][t.text].replace:t.text?a.text+=t.text:t.body&&t.body.map(e=>{a.text+=e.text})}return o&&\"\\\\mathord\"===t&&\"mathord\"===a.type&&a.text.length>1?a:{type:\"mclass\",mode:e.mode,mclass:\"m\"+t.slice(5),body:y(o?a:n),isCharacterBox:s,mustPromote:o}},mathmlBuilder:fr});const br=e=>{const t=\"ordgroup\"===e.type&&e.body.length&&1===e.body.length?e.body[0]:e;if(\"atom\"===t.type){const r=e.body.length>0&&e.body[0].text&&D.math[e.body[0].text]?D.math[e.body[0].text].group:t.family;return\"bin\"===r||\"rel\"===r?\"m\"+r:\"mord\"}return\"mord\"};g({type:\"mclass\",names:[\"\\\\@binrel\"],props:{numArgs:2},handler:({parser:e},t)=>({type:\"mclass\",mode:e.mode,mclass:br(t[0]),body:y(t[1]),isCharacterBox:i(t[1])})}),g({type:\"mclass\",names:[\"\\\\stackrel\",\"\\\\overset\",\"\\\\underset\"],props:{numArgs:2},handler({parser:e,funcName:t},r){const n=r[1],s=r[0];let o;o=\"\\\\stackrel\"!==t?br(n):\"mrel\";const a={type:\"mrel\"===o||\"mbin\"===o?\"op\":\"ordgroup\",mode:n.mode,limits:!0,alwaysHandleSupSub:!0,parentIsSupSub:!1,symbol:!1,suppressBaseShift:\"\\\\stackrel\"!==t,body:y(n)};return{type:\"supsub\",mode:s.mode,stack:!0,base:a,sup:\"\\\\underset\"===t?null:s,sub:\"\\\\underset\"===t?s:null}},mathmlBuilder:fr});const yr=(e,t,r)=>{if(!e)return r;const n=ge(e,t);return\"mrow\"===n.type&&0===n.children.length?r:n};g({type:\"multiscript\",names:[\"\\\\sideset\",\"\\\\pres@cript\"],props:{numArgs:3},handler({parser:t,funcName:r,token:n},s){if(0===s[2].body.length)throw new e(r+\"cannot parse an empty base.\");const o=s[2].body[0];if(t.settings.strict&&\"\\\\sideset\"===r&&!o.symbol)throw new e(\"The base of \\\\sideset must be a big operator. Try \\\\prescript.\");if(s[0].body.length>0&&\"supsub\"!==s[0].body[0].type||s[1].body.length>0&&\"supsub\"!==s[1].body[0].type)throw new e(\"\\\\sideset can parse only subscripts and superscripts in its first two arguments\",n);const a=s[0].body.length>0?s[0].body[0]:null,l=s[1].body.length>0?s[1].body[0]:null;return a||l?a?{type:\"multiscript\",mode:t.mode,isSideset:\"\\\\sideset\"===r,prescripts:a,postscripts:l,base:o}:{type:\"styling\",mode:t.mode,scriptLevel:\"text\",body:[{type:\"supsub\",mode:t.mode,base:o,sup:l.sup,sub:l.sub}]}:o},mathmlBuilder(e,t){const r=ge(e.base,t),n=new C(\"mprescripts\"),s=new C(\"none\");let o=[];const a=yr(e.prescripts.sub,t,s),l=yr(e.prescripts.sup,t,s);if(e.isSideset&&(a.setAttribute(\"style\",\"text-align: left;\"),l.setAttribute(\"style\",\"text-align: left;\")),e.postscripts){o=[r,yr(e.postscripts.sub,t,s),yr(e.postscripts.sup,t,s),n,a,l]}else o=[r,n,a,l];return new C(\"mmultiscripts\",o)}}),g({type:\"not\",names:[\"\\\\not\"],props:{numArgs:1,primitive:!0,allowedInText:!1},handler({parser:e},t){const r=i(t[0]);let n;if(r)n=y(t[0]),\"\\\\\"===n[0].text.charAt(0)&&(n[0].text=D.math[n[0].text].replace),n[0].text=n[0].text.slice(0,1)+\"̸\"+n[0].text.slice(1);else{n=[{type:\"textord\",mode:\"math\",text:\"̸\"},{type:\"kern\",mode:\"math\",dimension:{number:-.6,unit:\"em\"}},t[0]]}return{type:\"not\",mode:e.mode,body:n,isCharacterBox:r}},mathmlBuilder(e,t){if(e.isCharacterBox){return de(e.body,t,!0)[0]}return he(e.body,t)}});const wr=[\"textord\",\"mathord\",\"atom\"],xr=[\"\\\\smallint\"],kr=[\"textord\",\"mathord\",\"ordgroup\",\"close\",\"leftright\",\"font\"],vr=e=>{e.attributes.lspace=\"0.1667em\",e.attributes.rspace=\"0.1667em\"},Ar=(e,t)=>{let r;if(e.symbol)r=new C(\"mo\",[ae(e.name,e.mode)]),xr.includes(e.name)?r.setAttribute(\"largeop\",\"false\"):r.setAttribute(\"movablelimits\",\"false\"),e.fromMathOp&&vr(r);else if(e.body)r=new C(\"mo\",de(e.body,t)),e.fromMathOp&&vr(r);else if(r=new C(\"mi\",[new N(e.name.slice(1))]),!e.parentIsSupSub){const t=[r,new C(\"mo\",[ae(\"⁡\",\"text\")])];if(e.needsLeadingSpace){const e=new C(\"mspace\");e.setAttribute(\"width\",\"0.1667em\"),t.unshift(e)}if(!e.isFollowedByDelimiter){const e=new C(\"mspace\");e.setAttribute(\"width\",\"0.1667em\"),t.push(e)}r=new C(\"mrow\",t)}return r},Tr={\"∏\":\"\\\\prod\",\"∐\":\"\\\\coprod\",\"∑\":\"\\\\sum\",\"⋀\":\"\\\\bigwedge\",\"⋁\":\"\\\\bigvee\",\"⋂\":\"\\\\bigcap\",\"⋃\":\"\\\\bigcup\",\"⨀\":\"\\\\bigodot\",\"⨁\":\"\\\\bigoplus\",\"⨂\":\"\\\\bigotimes\",\"⨄\":\"\\\\biguplus\",\"⨅\":\"\\\\bigsqcap\",\"⨆\":\"\\\\bigsqcup\",\"⨃\":\"\\\\bigcupdot\",\"⨇\":\"\\\\bigdoublevee\",\"⨈\":\"\\\\bigdoublewedge\",\"⨉\":\"\\\\bigtimes\"};g({type:\"op\",names:[\"\\\\coprod\",\"\\\\bigvee\",\"\\\\bigwedge\",\"\\\\biguplus\",\"\\\\bigcupplus\",\"\\\\bigcupdot\",\"\\\\bigcap\",\"\\\\bigcup\",\"\\\\bigdoublevee\",\"\\\\bigdoublewedge\",\"\\\\intop\",\"\\\\prod\",\"\\\\sum\",\"\\\\bigotimes\",\"\\\\bigoplus\",\"\\\\bigodot\",\"\\\\bigsqcap\",\"\\\\bigsqcup\",\"\\\\bigtimes\",\"\\\\smallint\",\"∏\",\"∐\",\"∑\",\"⋀\",\"⋁\",\"⋂\",\"⋃\",\"⨀\",\"⨁\",\"⨂\",\"⨃\",\"⨄\",\"⨅\",\"⨆\",\"⨇\",\"⨈\",\"⨉\"],props:{numArgs:0},handler:({parser:e,funcName:t},r)=>{let n=t;return 1===n.length&&(n=Tr[n]),{type:\"op\",mode:e.mode,limits:!0,parentIsSupSub:!1,symbol:!0,stack:!1,name:n}},mathmlBuilder:Ar}),g({type:\"op\",names:[\"\\\\mathop\"],props:{numArgs:1,primitive:!0},handler:({parser:e},t)=>{const r=t[0],n=r.body?r.body:[r],s=1===n.length&&wr.includes(n[0].type);return{type:\"op\",mode:e.mode,limits:!0,parentIsSupSub:!1,symbol:s,fromMathOp:!0,stack:!1,name:s?n[0].text:null,body:s?null:y(r)}},mathmlBuilder:Ar});const Sr={\"∫\":\"\\\\int\",\"∬\":\"\\\\iint\",\"∭\":\"\\\\iiint\",\"∮\":\"\\\\oint\",\"∯\":\"\\\\oiint\",\"∰\":\"\\\\oiiint\",\"∱\":\"\\\\intclockwise\",\"∲\":\"\\\\varointclockwise\",\"⨌\":\"\\\\iiiint\",\"⨍\":\"\\\\intbar\",\"⨎\":\"\\\\intBar\",\"⨏\":\"\\\\fint\",\"⨒\":\"\\\\rppolint\",\"⨓\":\"\\\\scpolint\",\"⨕\":\"\\\\pointint\",\"⨖\":\"\\\\sqint\",\"⨗\":\"\\\\intlarhk\",\"⨘\":\"\\\\intx\",\"⨙\":\"\\\\intcap\",\"⨚\":\"\\\\intcup\"};g({type:\"op\",names:[\"\\\\arcsin\",\"\\\\arccos\",\"\\\\arctan\",\"\\\\arctg\",\"\\\\arcctg\",\"\\\\arg\",\"\\\\ch\",\"\\\\cos\",\"\\\\cosec\",\"\\\\cosh\",\"\\\\cot\",\"\\\\cotg\",\"\\\\coth\",\"\\\\csc\",\"\\\\ctg\",\"\\\\cth\",\"\\\\deg\",\"\\\\dim\",\"\\\\exp\",\"\\\\hom\",\"\\\\ker\",\"\\\\lg\",\"\\\\ln\",\"\\\\log\",\"\\\\sec\",\"\\\\sin\",\"\\\\sinh\",\"\\\\sh\",\"\\\\sgn\",\"\\\\tan\",\"\\\\tanh\",\"\\\\tg\",\"\\\\th\"],props:{numArgs:0},handler({parser:e,funcName:t}){const r=e.prevAtomType,n=e.gullet.future().text;return{type:\"op\",mode:e.mode,limits:!1,parentIsSupSub:!1,symbol:!1,stack:!1,isFollowedByDelimiter:Gt(n),needsLeadingSpace:r.length>0&&kr.includes(r),name:t}},mathmlBuilder:Ar}),g({type:\"op\",names:[\"\\\\det\",\"\\\\gcd\",\"\\\\inf\",\"\\\\lim\",\"\\\\max\",\"\\\\min\",\"\\\\Pr\",\"\\\\sup\"],props:{numArgs:0},handler({parser:e,funcName:t}){const r=e.prevAtomType,n=e.gullet.future().text;return{type:\"op\",mode:e.mode,limits:!0,parentIsSupSub:!1,symbol:!1,stack:!1,isFollowedByDelimiter:Gt(n),needsLeadingSpace:r.length>0&&kr.includes(r),name:t}},mathmlBuilder:Ar}),g({type:\"op\",names:[\"\\\\int\",\"\\\\iint\",\"\\\\iiint\",\"\\\\iiiint\",\"\\\\oint\",\"\\\\oiint\",\"\\\\oiiint\",\"\\\\intclockwise\",\"\\\\varointclockwise\",\"\\\\intbar\",\"\\\\intBar\",\"\\\\fint\",\"\\\\rppolint\",\"\\\\scpolint\",\"\\\\pointint\",\"\\\\sqint\",\"\\\\intlarhk\",\"\\\\intx\",\"\\\\intcap\",\"\\\\intcup\",\"∫\",\"∬\",\"∭\",\"∮\",\"∯\",\"∰\",\"∱\",\"∲\",\"⨌\",\"⨍\",\"⨎\",\"⨏\",\"⨒\",\"⨓\",\"⨕\",\"⨖\",\"⨗\",\"⨘\",\"⨙\",\"⨚\"],props:{numArgs:0,allowedInArgument:!0},handler({parser:e,funcName:t}){let r=t;return 1===r.length&&(r=Sr[r]),{type:\"op\",mode:e.mode,limits:!1,parentIsSupSub:!1,symbol:!0,stack:!1,name:r}},mathmlBuilder:Ar});g({type:\"operatorname\",names:[\"\\\\operatorname@\",\"\\\\operatornamewithlimits\"],props:{numArgs:1,allowedInArgument:!0},handler:({parser:e,funcName:t},r)=>{const n=r[0],s=e.prevAtomType,o=e.gullet.future().text;return{type:\"operatorname\",mode:e.mode,body:y(n),alwaysHandleSupSub:\"\\\\operatornamewithlimits\"===t,limits:!1,parentIsSupSub:!1,isFollowedByDelimiter:Gt(o),needsLeadingSpace:s.length>0&&kr.includes(s)}},mathmlBuilder:(e,t)=>{let r,n=de(e.body,t.withFont(\"mathrm\")),s=!0;for(let e=0;e<n.length;e++){let t=n[e];if(t instanceof C)switch(((\"mrow\"===t.type||\"mpadded\"===t.type)&&1===t.children.length&&t.children[0]instanceof C||\"mrow\"===t.type&&2===t.children.length&&t.children[0]instanceof C&&t.children[1]instanceof C&&\"mspace\"===t.children[1].type&&!t.children[1].attributes.width&&0===t.children[1].children.length)&&(t=t.children[0]),t.type){case\"mi\":case\"mn\":case\"ms\":case\"mtext\":break;case\"mspace\":if(t.attributes.width){const r=t.attributes.width.replace(\"em\",\"\"),o=ur(Number(r));\"\"===o?s=!1:n[e]=new C(\"mtext\",[new N(o)])}break;case\"mo\":{const e=t.children[0];1===t.children.length&&e instanceof N?e.text=e.text.replace(/\\u2212/,\"-\").replace(/\\u2217/,\"*\"):s=!1;break}default:s=!1}else s=!1}if(s){const e=n.map(e=>e.toText()).join(\"\");n=[new N(e)]}else if(1===n.length&&[\"mover\",\"munder\"].includes(n[0].type)&&(\"mi\"===n[0].children[0].type||\"mtext\"===n[0].children[0].type)){if(n[0].children[0].type=\"mi\",e.parentIsSupSub)return new C(\"mrow\",n);{const e=new C(\"mo\",[ae(\"⁡\",\"text\")]);return B([n[0],e])}}if(s?(r=new C(\"mi\",n),1===n[0].text.length&&r.setAttribute(\"mathvariant\",\"normal\")):r=new C(\"mrow\",n),!e.parentIsSupSub){const t=[r,new C(\"mo\",[ae(\"⁡\",\"text\")])];if(e.needsLeadingSpace){const e=new C(\"mspace\");e.setAttribute(\"width\",\"0.1667em\"),t.unshift(e)}if(!e.isFollowedByDelimiter){const e=new C(\"mspace\");e.setAttribute(\"width\",\"0.1667em\"),t.push(e)}return B(t)}return r}}),Qe(\"\\\\operatorname\",\"\\\\@ifstar\\\\operatornamewithlimits\\\\operatorname@\"),f({type:\"ordgroup\",mathmlBuilder:(e,t)=>he(e.body,t,e.semisimple)}),g({type:\"phantom\",names:[\"\\\\phantom\"],props:{numArgs:1,allowedInText:!0},handler:({parser:e},t)=>{const r=t[0];return{type:\"phantom\",mode:e.mode,body:y(r)}},mathmlBuilder:(e,t)=>{const r=de(e.body,t);return new C(\"mphantom\",r)}}),g({type:\"hphantom\",names:[\"\\\\hphantom\"],props:{numArgs:1,allowedInText:!0},handler:({parser:e},t)=>{const r=t[0];return{type:\"hphantom\",mode:e.mode,body:r}},mathmlBuilder:(e,t)=>{const r=de(y(e.body),t),n=new C(\"mphantom\",r),s=new C(\"mpadded\",[n]);return s.setAttribute(\"height\",\"0px\"),s.setAttribute(\"depth\",\"0px\"),s}}),g({type:\"vphantom\",names:[\"\\\\vphantom\"],props:{numArgs:1,allowedInText:!0},handler:({parser:e},t)=>{const r=t[0];return{type:\"vphantom\",mode:e.mode,body:r}},mathmlBuilder:(e,t)=>{const r=de(y(e.body),t),n=new C(\"mphantom\",r),s=new C(\"mpadded\",[n]);return s.setAttribute(\"width\",\"0.1px\"),s}}),g({type:\"pmb\",names:[\"\\\\pmb\"],props:{numArgs:1,allowedInText:!0},handler:({parser:e},t)=>({type:\"pmb\",mode:e.mode,body:y(t[0])}),mathmlBuilder(e,t){const r=de(e.body,t),n=z(r);return n.setAttribute(\"style\",\"font-weight:bold\"),n}});const Or=(e,t)=>{const r=t.withLevel(Ze),n=new C(\"mpadded\",[ge(e.body,r)]),s=Be(e.dy,t);return n.setAttribute(\"voffset\",s.number+s.unit),s.number>0?n.style.padding=s.number+s.unit+\" 0 0 0\":n.style.padding=\"0 0 \"+Math.abs(s.number)+s.unit+\" 0\",n};g({type:\"raise\",names:[\"\\\\raise\",\"\\\\lower\"],props:{numArgs:2,argTypes:[\"size\",\"primitive\"],primitive:!0},handler({parser:e,funcName:t},r){const n=Fe(r[0],\"size\").value;\"\\\\lower\"===t&&(n.number*=-1);const s=r[1];return{type:\"raise\",mode:e.mode,dy:n,body:s}},mathmlBuilder:Or}),g({type:\"raise\",names:[\"\\\\raisebox\"],props:{numArgs:2,argTypes:[\"size\",\"hbox\"],allowedInText:!0},handler({parser:e,funcName:t},r){const n=Fe(r[0],\"size\").value,s=r[1];return{type:\"raise\",mode:e.mode,dy:n,body:s}},mathmlBuilder:Or}),g({type:\"ref\",names:[\"\\\\ref\",\"\\\\eqref\"],props:{numArgs:1,argTypes:[\"raw\"]},handler:({parser:e,funcName:t},r)=>({type:\"ref\",mode:e.mode,funcName:t,string:r[0].string.replace(dr,\"\")}),mathmlBuilder(e,t){const r=\"\\\\ref\"===e.funcName?[\"tml-ref\"]:[\"tml-ref\",\"tml-eqref\"];return new O(\"#\"+e.string,r,null)}}),g({type:\"reflect\",names:[\"\\\\reflectbox\"],props:{numArgs:1,argTypes:[\"hbox\"],allowedInText:!0},handler:({parser:e},t)=>({type:\"reflect\",mode:e.mode,body:t[0]}),mathmlBuilder(e,t){const r=ge(e.body,t);return r.style.transform=\"scaleX(-1)\",r}}),g({type:\"internal\",names:[\"\\\\relax\"],props:{numArgs:0,allowedInText:!0,allowedInArgument:!0},handler:({parser:e})=>({type:\"internal\",mode:e.mode})}),g({type:\"rule\",names:[\"\\\\rule\"],props:{numArgs:2,numOptionalArgs:1,allowedInText:!0,allowedInMath:!0,argTypes:[\"size\",\"size\",\"size\"]},handler({parser:e},t,r){const n=r[0],s=Fe(t[0],\"size\"),o=Fe(t[1],\"size\");return{type:\"rule\",mode:e.mode,shift:n&&Fe(n,\"size\").value,width:s.value,height:o.value}},mathmlBuilder(e,t){const r=Be(e.width,t),n=Be(e.height,t),s=e.shift?Be(e.shift,t):{number:0,unit:\"em\"},o=t.color&&t.getColor()||\"black\",a=new C(\"mspace\");if(r.number>0&&n.number>0&&a.setAttribute(\"mathbackground\",o),a.setAttribute(\"width\",r.number+r.unit),a.setAttribute(\"height\",n.number+n.unit),0===s.number)return a;const l=new C(\"mpadded\",[a]);return s.number>=0?l.setAttribute(\"height\",\"+\"+s.number+s.unit):(l.setAttribute(\"height\",s.number+s.unit),l.setAttribute(\"depth\",\"+\"+-s.number+s.unit)),l.setAttribute(\"voffset\",s.number+s.unit),l}});const qr=/^[0-9]$/,Br={0:\"₀\",1:\"₁\",2:\"₂\",3:\"₃\",4:\"₄\",5:\"₅\",6:\"₆\",7:\"₇\",8:\"₈\",9:\"₉\"},Cr={0:\"⁰\",1:\"¹\",2:\"²\",3:\"³\",4:\"⁴\",5:\"⁵\",6:\"⁶\",7:\"⁷\",8:\"⁸\",9:\"⁹\"};g({type:\"sfrac\",names:[\"\\\\sfrac\"],props:{numArgs:2,allowedInText:!0,allowedInMath:!0},handler({parser:t},r){let n=\"\";for(const t of r[0].body){if(\"textord\"!==t.type||!qr.test(t.text))throw new e(\"Numerator must be an integer.\",t);n+=t.text}let s=\"\";for(const t of r[1].body){if(\"textord\"!==t.type||!qr.test(t.text))throw new e(\"Denominator must be an integer.\",t);s+=t.text}return{type:\"sfrac\",mode:t.mode,numerator:n,denominator:s}},mathmlBuilder(e,t){const r=e.numerator.split(\"\").map(e=>Cr[e]).join(\"\"),n=e.denominator.split(\"\").map(e=>Br[e]).join(\"\"),s=new N(r+\"⁄\"+n,e.mode,t);return new C(\"mn\",[s],[\"special-fraction\"])}});const Nr={\"\\\\tiny\":.5,\"\\\\sixptsize\":.6,\"\\\\Tiny\":.6,\"\\\\scriptsize\":.7,\"\\\\footnotesize\":.8,\"\\\\small\":.9,\"\\\\normalsize\":1,\"\\\\large\":1.2,\"\\\\Large\":1.44,\"\\\\LARGE\":1.728,\"\\\\huge\":2.074,\"\\\\Huge\":2.488};g({type:\"sizing\",names:[\"\\\\tiny\",\"\\\\sixptsize\",\"\\\\Tiny\",\"\\\\scriptsize\",\"\\\\footnotesize\",\"\\\\small\",\"\\\\normalsize\",\"\\\\large\",\"\\\\Large\",\"\\\\LARGE\",\"\\\\huge\",\"\\\\Huge\"],props:{numArgs:0,allowedInText:!0},handler:({breakOnTokenText:e,funcName:t,parser:r},n)=>{r.settings.strict&&\"math\"===r.mode&&console.log(`Temml strict-mode warning: Command ${t} is invalid in math mode.`);const s=r.parseExpression(!1,e,!0);return{type:\"sizing\",mode:r.mode,funcName:t,body:s}},mathmlBuilder:(e,t)=>{const r=t.withFontSize(Nr[e.funcName]),n=de(e.body,r),s=z(n),o=(Nr[e.funcName]/t.fontSize).toFixed(4);return s.setAttribute(\"mathsize\",o+\"em\"),s}}),g({type:\"smash\",names:[\"\\\\smash\"],props:{numArgs:1,numOptionalArgs:1,allowedInText:!0},handler:({parser:e},t,r)=>{let n=!1,s=!1;const o=r[0]&&Fe(r[0],\"ordgroup\");if(o){let e=\"\";for(let t=0;t<o.body.length;++t){if(e=o.body[t].text,\"t\"===e)n=!0;else{if(\"b\"!==e){n=!1,s=!1;break}s=!0}}}else n=!0,s=!0;const a=t[0];return{type:\"smash\",mode:e.mode,body:a,smashHeight:n,smashDepth:s}},mathmlBuilder:(e,t)=>{const r=new C(\"mpadded\",[ge(e.body,t)]);return e.smashHeight&&r.setAttribute(\"height\",\"0px\"),e.smashDepth&&r.setAttribute(\"depth\",\"0px\"),r}});const zr=[\"a\",\"c\",\"e\",\"ı\",\"m\",\"n\",\"o\",\"r\",\"s\",\"u\",\"v\",\"w\",\"x\",\"z\",\"α\",\"ε\",\"ι\",\"κ\",\"ν\",\"ο\",\"π\",\"σ\",\"τ\",\"υ\",\"ω\",\"\\\\alpha\",\"\\\\epsilon\",\"\\\\iota\",\"\\\\kappa\",\"\\\\nu\",\"\\\\omega\",\"\\\\pi\",\"\\\\tau\",\"\\\\omega\"];g({type:\"sqrt\",names:[\"\\\\sqrt\"],props:{numArgs:1,numOptionalArgs:1},handler({parser:e},t,r){const n=r[0],s=t[0];return s.body&&1===s.body.length&&s.body[0].text&&zr.includes(s.body[0].text)&&s.body.push({type:\"rule\",mode:\"math\",shift:null,width:{number:0,unit:\"pt\"},height:{number:.5,unit:\"em\"}}),{type:\"sqrt\",mode:e.mode,body:s,index:n}},mathmlBuilder(e,t){const{body:r,index:n}=e;return n?new C(\"mroot\",[ge(r,t),ge(n,t.incrementLevel())]):new C(\"msqrt\",[ge(r,t)])}});const $r={display:0,text:1,script:2,scriptscript:3},Er={display:[\"0\",\"true\"],text:[\"0\",\"false\"],script:[\"1\",\"false\"],scriptscript:[\"2\",\"false\"]};g({type:\"styling\",names:[\"\\\\displaystyle\",\"\\\\textstyle\",\"\\\\scriptstyle\",\"\\\\scriptscriptstyle\"],props:{numArgs:0,allowedInText:!0,primitive:!0},handler({breakOnTokenText:e,funcName:t,parser:r},n){const s=r.parseExpression(!0,e,!0),o=t.slice(1,t.length-5);return{type:\"styling\",mode:r.mode,scriptLevel:o,body:s}},mathmlBuilder(e,t){const r=t.withLevel($r[e.scriptLevel]),n=de(e.body,r),s=z(n),o=Er[e.scriptLevel];return s.setAttribute(\"scriptlevel\",o[0]),s.setAttribute(\"displaystyle\",o[1]),s}});const Ir=/^m(over|under|underover)$/;f({type:\"supsub\",mathmlBuilder(e,t){let r,n,s=!1,o=!1,a=!1,l=!1;e.base&&\"horizBracket\"===e.base.type&&(n=!!e.sup,n===e.base.isOver&&(s=!0,r=e.base.isOver)),!e.base||e.stack||\"op\"!==e.base.type&&\"operatorname\"!==e.base.type||(e.base.parentIsSupSub=!0,o=!e.base.symbol,a=o&&!e.isFollowedByDelimiter,l=e.base.needsLeadingSpace);const i=e.stack&&1===e.base.body.length?[ge(e.base.body[0],t)]:[ge(e.base,t)],c=t.inSubOrSup();if(e.sub){const r=ge(e.sub,c);3===t.level&&r.setAttribute(\"scriptlevel\",\"2\"),i.push(r)}if(e.sup){const r=ge(e.sup,c);if(3===t.level&&r.setAttribute(\"scriptlevel\",\"2\"),e.base&&e.base.text&&1===e.base.text.length){const t=e.base.text;\"DHKLUcegorsuvxyzΠΥΨαδηιμνοτυχϵ\".indexOf(t)>-1?r.classes.push(\"tml-sml-pad\"):\"BCEFGIMNOPQRSTXZlpqtwΓΘΞΣΦΩβεζθξρςφψϑϕϱ\".indexOf(t)>-1?r.classes.push(\"tml-med-pad\"):\"AJdfΔΛ\".indexOf(t)>-1&&r.classes.push(\"tml-lrg-pad\")}i.push(r)}let m;if(s)m=r?\"mover\":\"munder\";else if(e.sub)if(e.sup){const r=e.base;m=r&&(\"op\"===r.type&&r.limits||\"multiscript\"===r.type)&&(t.level===Xe||r.alwaysHandleSupSub)||r&&\"operatorname\"===r.type&&r.alwaysHandleSupSub&&(t.level===Xe||r.limits)?\"munderover\":\"msubsup\"}else{const r=e.base;m=e.stack||r&&\"op\"===r.type&&r.limits&&(t.level===Xe||r.alwaysHandleSupSub)||r&&\"operatorname\"===r.type&&r.alwaysHandleSupSub&&(r.limits||t.level===Xe)?\"munder\":\"msub\"}else{const r=e.base;m=r&&\"op\"===r.type&&r.limits&&(t.level===Xe||r.alwaysHandleSupSub)||r&&\"operatorname\"===r.type&&r.alwaysHandleSupSub&&(r.limits||t.level===Xe)?\"mover\":\"msup\"}let p=new C(m,i);if(o){const e=new C(\"mo\",[ae(\"⁡\",\"text\")]);if(l){const t=new C(\"mspace\");t.setAttribute(\"width\",\"0.1667em\"),p=B([t,p,e])}else p=B([p,e]);if(a){const e=new C(\"mspace\");e.setAttribute(\"width\",\"0.1667em\"),p.children.push(e)}}else Ir.test(m)&&(p=new C(\"mrow\",[p]));return p}});const Lr=[\"\\\\shortmid\",\"\\\\nshortmid\",\"\\\\shortparallel\",\"\\\\nshortparallel\",\"\\\\smallsetminus\"],Fr=[\"\\\\Rsh\",\"\\\\Lsh\",\"\\\\restriction\"];f({type:\"atom\",mathmlBuilder(e,t){if(\"inner\"===e.family){const t=\"text\"===e.mode?\"mtext\":\"mi\";return new C(t,[ae(e.text,e.mode)])}const r=new C(\"mo\",[ae(e.text,e.mode)]);if(\"punct\"===e.family)r.setAttribute(\"separator\",\"true\");else if(\"open\"===e.family||\"close\"===e.family)\"open\"===e.family?(r.setAttribute(\"form\",\"prefix\"),r.setAttribute(\"stretchy\",\"false\")):\"close\"===e.family&&(r.setAttribute(\"form\",\"postfix\"),r.setAttribute(\"stretchy\",\"false\"));else if(\"\\\\mid\"===e.text)r.setAttribute(\"lspace\",\"0.22em\"),r.setAttribute(\"rspace\",\"0.22em\"),r.setAttribute(\"stretchy\",\"false\");else if(\"rel\"===e.family&&(e=>{if(1===e.length){const t=e.codePointAt(0);return 8591<t&&t<8704}return e.indexOf(\"arrow\")>-1||e.indexOf(\"harpoon\")>-1||Fr.includes(e)})(e.text))r.setAttribute(\"stretchy\",\"false\");else if(Lr.includes(e.text))r.setAttribute(\"mathsize\",\"70%\");else if(\":\"===e.text)r.attributes.lspace=\"0.2222em\",r.attributes.rspace=\"0.2222em\";else if(e.needsSpacing)return\"bin\"===e.family?new C(\"mrow\",[Ce(.222),r,Ce(.222)]):new C(\"mrow\",[Ce(.2778),r,Ce(.2778)]);return r}});const jr={mathbf:\"bold\",mathrm:\"normal\",textit:\"italic\",mathit:\"italic\",mathnormal:\"italic\",mathbb:\"double-struck\",mathcal:\"script\",mathfrak:\"fraktur\",mathscr:\"script\",mathsf:\"sans-serif\",mathtt:\"monospace\"},Mr=function(e,t){if(\"texttt\"===t.fontFamily)return\"monospace\";if(\"textsc\"===t.fontFamily)return\"normal\";if(\"textsf\"===t.fontFamily)return\"textit\"===t.fontShape&&\"textbf\"===t.fontWeight?\"sans-serif-bold-italic\":\"textit\"===t.fontShape?\"sans-serif-italic\":\"textbf\"===t.fontWeight?\"sans-serif-bold\":\"sans-serif\";if(\"textit\"===t.fontShape&&\"textbf\"===t.fontWeight)return\"bold-italic\";if(\"textit\"===t.fontShape)return\"italic\";if(\"textbf\"===t.fontWeight)return\"bold\";const r=t.font;if(!r||\"mathnormal\"===r)return null;const n=e.mode;switch(r){case\"mathit\":case\"greekItalic\":return\"italic\";case\"mathrm\":{const t=e.text.codePointAt(0);return 939<t&&t<975?\"italic\":\"normal\"}case\"up@greek\":return\"normal\";case\"boldsymbol\":case\"mathboldsymbol\":return\"bold-italic\";case\"mathbf\":return\"bold\";case\"mathbb\":return\"double-struck\";case\"mathfrak\":return\"fraktur\";case\"mathscr\":case\"mathcal\":return\"script\";case\"mathsf\":return\"sans-serif\";case\"mathsfit\":return\"sans-serif-italic\";case\"mathtt\":return\"monospace\"}let s=e.text;return D[n][s]&&D[n][s].replace&&(s=D[n][s].replace),Object.prototype.hasOwnProperty.call(jr,r)?jr[r]:null},Dr=/^\\d(?:[\\d,.]*\\d)?$/,Gr=/[A-Ba-z]/,Pr=new Set([\"\\\\prime\",\"\\\\dprime\",\"\\\\trprime\",\"\\\\qprime\",\"\\\\backprime\",\"\\\\backdprime\",\"\\\\backtrprime\"]);f({type:\"mathord\",mathmlBuilder(e,t){const r=ae(e.text,e.mode,t),n=r.text.codePointAt(0),s=912<n&&n<938?\"normal\":\"italic\",o=Mr(e,t)||s;if(\"script\"===o)return r.text=rr(r.text,o),new C(\"mi\",[r],[t.font]);\"italic\"!==o&&(r.text=rr(r.text,o));let a=new C(\"mi\",[r]);if(\"normal\"===o&&(a.setAttribute(\"mathvariant\",\"normal\"),1===r.text.length)){const e=new C(\"mspace\",[]);a=new C(\"mrow\",[a,e])}return a}}),f({type:\"textord\",mathmlBuilder(e,t){let r=e.text;const n=r.codePointAt(0);\"textsc\"===t.fontFamily&&96<n&&n<123&&(r=nr[r]);const s=ae(r,e.mode,t),o=Mr(e,t)||\"normal\";let a;if(Dr.test(e.text)){const t=\"text\"===e.mode?\"mtext\":\"mn\";if(\"italic\"===o||\"bold-italic\"===o)return((e,t,r)=>{const n=new C(r,[e]),s=new C(\"mstyle\",[n]);return s.style[\"font-style\"]=\"italic\",s.style[\"font-family\"]=\"Cambria, 'Times New Roman', serif\",\"bold-italic\"===t&&(s.style[\"font-weight\"]=\"bold\"),s})(s,o,t);\"normal\"!==o&&(s.text=s.text.split(\"\").map(e=>rr(e,o)).join(\"\")),a=new C(t,[s])}else if(\"text\"===e.mode)\"normal\"!==o&&(s.text=rr(s.text,o)),a=new C(\"mtext\",[s]);else if(Pr.has(e.text))a=new C(\"mo\",[s]),a.classes.push(\"tml-prime\");else{const e=s.text;\"italic\"!==o&&(s.text=rr(s.text,o)),a=new C(\"mi\",[s]),s.text===e&&Gr.test(e)&&a.setAttribute(\"mathvariant\",\"italic\")}return a}});const Rr={\"\\\\nobreak\":\"nobreak\",\"\\\\allowbreak\":\"allowbreak\"},Ur={\" \":{},\"\\\\ \":{},\"~\":{className:\"nobreak\"},\"\\\\space\":{},\"\\\\nobreakspace\":{className:\"nobreak\"}};f({type:\"spacing\",mathmlBuilder(t,r){let n;if(Object.prototype.hasOwnProperty.call(Ur,t.text))n=new C(\"mtext\",[new N(\"\xA0\")]);else{if(!Object.prototype.hasOwnProperty.call(Rr,t.text))throw new e(`Unknown type of space \"${t.text}\"`);n=new C(\"mo\"),\"\\\\nobreak\"===t.text&&n.setAttribute(\"linebreak\",\"nobreak\")}return n}}),f({type:\"tag\"});const Hr={\"\\\\text\":void 0,\"\\\\textrm\":\"textrm\",\"\\\\textsf\":\"textsf\",\"\\\\texttt\":\"texttt\",\"\\\\textnormal\":\"textrm\",\"\\\\textsc\":\"textsc\"},_r={\"\\\\textbf\":\"textbf\",\"\\\\textmd\":\"textmd\"},Vr={\"\\\\textit\":\"textit\",\"\\\\textup\":\"textup\"};g({type:\"text\",names:[\"\\\\text\",\"\\\\textrm\",\"\\\\textsf\",\"\\\\texttt\",\"\\\\textnormal\",\"\\\\textsc\",\"\\\\textbf\",\"\\\\textmd\",\"\\\\textit\",\"\\\\textup\",\"\\\\emph\"],props:{numArgs:1,argTypes:[\"text\"],allowedInArgument:!0,allowedInText:!0},handler({parser:e,funcName:t},r){const n=r[0];return{type:\"text\",mode:e.mode,body:y(n),font:t}},mathmlBuilder(e,t){const r=((e,t)=>{const r=e.font;return r?Hr[r]?t.withTextFontFamily(Hr[r]):_r[r]?t.withTextFontWeight(_r[r]):\"\\\\emph\"===r?\"textit\"===t.fontShape?t.withTextFontShape(\"textup\"):t.withTextFontShape(\"textit\"):t.withTextFontShape(Vr[r]):t})(e,t),n=he(e.body,r);return ie(n)}}),g({type:\"vcenter\",names:[\"\\\\vcenter\"],props:{numArgs:1,argTypes:[\"original\"],allowedInText:!1},handler:({parser:e},t)=>({type:\"vcenter\",mode:e.mode,body:t[0]}),mathmlBuilder(e,t){const r=new C(\"mtd\",[ge(e.body,t)]);r.style.padding=\"0\";const n=new C(\"mtr\",[r]);return new C(\"mtable\",[n])}}),g({type:\"verb\",names:[\"\\\\verb\"],props:{numArgs:0,allowedInText:!0},handler(t,r,n){throw new e(\"\\\\verb ended by end of line instead of matching delimiter\")},mathmlBuilder(e,t){const r=new N(Wr(e)),n=new C(\"mtext\",[r]);return n.setAttribute(\"mathvariant\",\"monospace\"),n}});const Wr=e=>e.body.replace(/ /g,e.star?\"␣\":\"\xA0\"),Xr=d,Zr=\"[ \\r\\n\\t]\",Yr=`(\\\\\\\\[a-zA-Z@]+)${Zr}*`,Jr=\"[̀-ͯ]\",Kr=new RegExp(`${Jr}+$`),Qr=`(${Zr}+)|\\\\\\\\(\\n|[ \\r\\t]+\\n?)[ \\r\\t]*|([!-\\\\[\\\\]-‧‪-퟿豈-￿]${Jr}*|[\\ud800-\\udbff][\\udc00-\\udfff]${Jr}*|\\\\\\\\verb\\\\*([^]).*?\\\\4|\\\\\\\\verb([^*a-zA-Z]).*?\\\\5|${Yr}|\\\\\\\\[^\\ud800-\\udfff])`;class en{constructor(e,t){this.input=e,this.settings=t,this.tokenRegex=new RegExp(Qr,\"g\"),this.catcodes={\"%\":14,\"~\":13}}setCatcode(e,t){this.catcodes[e]=t}lex(){const t=this.input,r=this.tokenRegex.lastIndex;if(r===t.length)return new We(\"EOF\",new Ve(this,r,r));const n=this.tokenRegex.exec(t);if(null===n||n.index!==r)throw new e(`Unexpected character: '${t[r]}'`,new We(t[r],new Ve(this,r,r+1)));const s=n[6]||n[3]||(n[2]?\"\\\\ \":\" \");if(14===this.catcodes[s]){const r=t.indexOf(\"\\n\",this.tokenRegex.lastIndex);if(-1===r){if(this.tokenRegex.lastIndex=t.length,this.settings.strict)throw new e(\"% comment has no terminating newline; LaTeX would fail because of commenting the end of math mode\")}else this.tokenRegex.lastIndex=r+1;return this.lex()}return new We(s,new Ve(this,r,this.tokenRegex.lastIndex))}}class tn{constructor(e=Object.create(null),t=Object.create(null)){this.current=t,this.builtins=e,this.undefStack=[]}beginGroup(){this.undefStack.push(Object.create(null))}endGroup(){if(0===this.undefStack.length)throw new e(\"Unbalanced namespace destruction: attempt to pop global namespace; please report this as a bug\");const t=this.undefStack.pop();for(const e in t)Object.prototype.hasOwnProperty.call(t,e)&&(void 0===t[e]?delete this.current[e]:this.current[e]=t[e])}has(e){return Object.prototype.hasOwnProperty.call(this.current,e)||Object.prototype.hasOwnProperty.call(this.builtins,e)}get(e){return Object.prototype.hasOwnProperty.call(this.current,e)?this.current[e]:this.builtins[e]}set(e,t,r=!1){if(r){for(let t=0;t<this.undefStack.length;t++)delete this.undefStack[t][e];this.undefStack.length>0&&(this.undefStack[this.undefStack.length-1][e]=t)}else{const t=this.undefStack[this.undefStack.length-1];t&&!Object.prototype.hasOwnProperty.call(t,e)&&(t[e]=this.current[e])}this.current[e]=t}}const rn={\"^\":!0,_:!0,\"\\\\limits\":!0,\"\\\\nolimits\":!0};class nn{constructor(e,t,r){this.settings=t,this.expansionCount=0,this.feed(e),this.macros=new tn(et,t.macros),this.mode=r,this.stack=[]}feed(e){this.lexer=new en(e,this.settings)}switchMode(e){this.mode=e}beginGroup(){this.macros.beginGroup()}endGroup(){this.macros.endGroup()}future(){return 0===this.stack.length&&this.pushToken(this.lexer.lex()),this.stack[this.stack.length-1]}popToken(){return this.future(),this.stack.pop()}pushToken(e){this.stack.push(e)}pushTokens(e){this.stack.push(...e)}scanArgument(e){let t,r,n;if(e){if(this.consumeSpaces(),\"[\"!==this.future().text)return null;t=this.popToken(),({tokens:n,end:r}=this.consumeArg([\"]\"]))}else({tokens:n,start:t,end:r}=this.consumeArg());return this.pushToken(new We(\"EOF\",r.loc)),this.pushTokens(n),new We(\"\",Ve.range(t,r))}consumeSpaces(){for(;;){if(\" \"!==this.future().text)break;this.stack.pop()}}consumeArg(t){const r=[],n=t&&t.length>0;n||this.consumeSpaces();const s=this.future();let o,a=0,l=0;do{if(o=this.popToken(),r.push(o),\"{\"===o.text)++a;else if(\"}\"===o.text){if(--a,-1===a)throw new e(\"Extra }\",o)}else if(\"EOF\"===o.text)throw new e(\"Unexpected end of input in a macro argument, expected '\"+(t&&n?t[l]:\"}\")+\"'\",o);if(t&&n)if((0===a||1===a&&\"{\"===t[l])&&o.text===t[l]){if(++l,l===t.length){r.splice(-l,l);break}}else l=0}while(0!==a||n);return\"{\"===s.text&&\"}\"===r[r.length-1].text&&(r.pop(),r.shift()),r.reverse(),{tokens:r,start:s,end:o}}consumeArgs(t,r){if(r){if(r.length!==t+1)throw new e(\"The length of delimiters doesn't match the number of args!\");const n=r[0];for(let t=0;t<n.length;t++){const r=this.popToken();if(n[t]!==r.text)throw new e(\"Use of the macro doesn't match its definition\",r)}}const n=[];for(let e=0;e<t;e++)n.push(this.consumeArg(r&&r[e+1]).tokens);return n}expandOnce(t){const r=this.popToken(),n=r.text,s=r.noexpand?null:this._getExpansion(n);if(null==s||t&&s.unexpandable){if(t&&null==s&&\"\\\\\"===n[0]&&!this.isDefined(n))throw new e(\"Undefined control sequence: \"+n);return this.pushToken(r),!1}if(this.expansionCount++,this.expansionCount>this.settings.maxExpand)throw new e(\"Too many expansions: infinite loop or need to increase maxExpand setting\");let o=s.tokens;const a=this.consumeArgs(s.numArgs,s.delimiters);if(s.numArgs){o=o.slice();for(let t=o.length-1;t>=0;--t){let r=o[t];if(\"#\"===r.text){if(0===t)throw new e(\"Incomplete placeholder at end of macro body\",r);if(r=o[--t],\"#\"===r.text)o.splice(t+1,1);else{if(!/^[1-9]$/.test(r.text))throw new e(\"Not a valid argument number\",r);o.splice(t,2,...a[+r.text-1])}}}}return this.pushTokens(o),o.length}expandAfterFuture(){return this.expandOnce(),this.future()}expandNextToken(){for(;;)if(!1===this.expandOnce()){const e=this.stack.pop();return e.treatAsRelax&&(e.text=\"\\\\relax\"),e}throw new Error}expandMacro(e){return this.macros.has(e)?this.expandTokens([new We(e)]):void 0}expandTokens(e){const t=[],r=this.stack.length;for(this.pushTokens(e);this.stack.length>r;)if(!1===this.expandOnce(!0)){const e=this.stack.pop();e.treatAsRelax&&(e.noexpand=!1,e.treatAsRelax=!1),t.push(e)}return t}expandMacroAsText(e){const t=this.expandMacro(e);return t?t.map(e=>e.text).join(\"\"):t}_getExpansion(e){const t=this.macros.get(e);if(null==t)return t;if(1===e.length){const t=this.lexer.catcodes[e];if(null!=t&&13!==t)return}const r=\"function\"==typeof t?t(this):t;if(\"string\"==typeof r){let e=0;if(-1!==r.indexOf(\"#\")){const t=r.replace(/##/g,\"\");for(;-1!==t.indexOf(\"#\"+(e+1));)++e}const t=new en(r,this.settings),n=[];let s=t.lex();for(;\"EOF\"!==s.text;)n.push(s),s=t.lex();n.reverse();return{tokens:n,numArgs:e}}return r}isDefined(e){return this.macros.has(e)||Object.prototype.hasOwnProperty.call(Xr,e)||Object.prototype.hasOwnProperty.call(D.math,e)||Object.prototype.hasOwnProperty.call(D.text,e)||Object.prototype.hasOwnProperty.call(rn,e)}isExpandable(e){const t=this.macros.get(e);return null!=t?\"string\"==typeof t||\"function\"==typeof t||!t.unexpandable:Object.prototype.hasOwnProperty.call(Xr,e)&&!Xr[e].primitive}}const sn=/^[₊₋₌₍₎₀₁₂₃₄₅₆₇₈₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓᵦᵧᵨᵩᵪ]/,on=Object.freeze({\"₊\":\"+\",\"₋\":\"-\",\"₌\":\"=\",\"₍\":\"(\",\"₎\":\")\",\"₀\":\"0\",\"₁\":\"1\",\"₂\":\"2\",\"₃\":\"3\",\"₄\":\"4\",\"₅\":\"5\",\"₆\":\"6\",\"₇\":\"7\",\"₈\":\"8\",\"₉\":\"9\",\"ₐ\":\"a\",\"ₑ\":\"e\",\"ₕ\":\"h\",\"ᵢ\":\"i\",\"ⱼ\":\"j\",\"ₖ\":\"k\",\"ₗ\":\"l\",\"ₘ\":\"m\",\"ₙ\":\"n\",\"ₒ\":\"o\",\"ₚ\":\"p\",\"ᵣ\":\"r\",\"ₛ\":\"s\",\"ₜ\":\"t\",\"ᵤ\":\"u\",\"ᵥ\":\"v\",\"ₓ\":\"x\",\"ᵦ\":\"β\",\"ᵧ\":\"γ\",\"ᵨ\":\"ρ\",\"ᵩ\":\"ϕ\",\"ᵪ\":\"χ\",\"⁺\":\"+\",\"⁻\":\"-\",\"⁼\":\"=\",\"⁽\":\"(\",\"⁾\":\")\",\"⁰\":\"0\",\"¹\":\"1\",\"²\":\"2\",\"³\":\"3\",\"⁴\":\"4\",\"⁵\":\"5\",\"⁶\":\"6\",\"⁷\":\"7\",\"⁸\":\"8\",\"⁹\":\"9\",\"ᴬ\":\"A\",\"ᴮ\":\"B\",\"ᴰ\":\"D\",\"ᴱ\":\"E\",\"ᴳ\":\"G\",\"ᴴ\":\"H\",\"ᴵ\":\"I\",\"ᴶ\":\"J\",\"ᴷ\":\"K\",\"ᴸ\":\"L\",\"ᴹ\":\"M\",\"ᴺ\":\"N\",\"ᴼ\":\"O\",\"ᴾ\":\"P\",\"ᴿ\":\"R\",\"ᵀ\":\"T\",\"ᵁ\":\"U\",\"ⱽ\":\"V\",\"ᵂ\":\"W\",\"ᵃ\":\"a\",\"ᵇ\":\"b\",\"ᶜ\":\"c\",\"ᵈ\":\"d\",\"ᵉ\":\"e\",\"ᶠ\":\"f\",\"ᵍ\":\"g\",\"ʰ\":\"h\",\"ⁱ\":\"i\",\"ʲ\":\"j\",\"ᵏ\":\"k\",\"ˡ\":\"l\",\"ᵐ\":\"m\",\"ⁿ\":\"n\",\"ᵒ\":\"o\",\"ᵖ\":\"p\",\"ʳ\":\"r\",\"ˢ\":\"s\",\"ᵗ\":\"t\",\"ᵘ\":\"u\",\"ᵛ\":\"v\",\"ʷ\":\"w\",\"ˣ\":\"x\",\"ʸ\":\"y\",\"ᶻ\":\"z\",\"ᵝ\":\"β\",\"ᵞ\":\"γ\",\"ᵟ\":\"δ\",\"ᵠ\":\"ϕ\",\"ᵡ\":\"χ\",\"ᶿ\":\"θ\"}),an=Object.freeze({\"𝒜\":\"A\",\"ℬ\":\"B\",\"𝒞\":\"C\",\"𝒟\":\"D\",\"ℰ\":\"E\",\"ℱ\":\"F\",\"𝒢\":\"G\",\"ℋ\":\"H\",\"ℐ\":\"I\",\"𝒥\":\"J\",\"𝒦\":\"K\",\"ℒ\":\"L\",\"ℳ\":\"M\",\"𝒩\":\"N\",\"𝒪\":\"O\",\"𝒫\":\"P\",\"𝒬\":\"Q\",\"ℛ\":\"R\",\"𝒮\":\"S\",\"𝒯\":\"T\",\"𝒰\":\"U\",\"𝒱\":\"V\",\"𝒲\":\"W\",\"𝒳\":\"X\",\"𝒴\":\"Y\",\"𝒵\":\"Z\"});var ln={\"́\":{text:\"\\\\'\",math:\"\\\\acute\"},\"̀\":{text:\"\\\\`\",math:\"\\\\grave\"},\"̈\":{text:'\\\\\"',math:\"\\\\ddot\"},\"̃\":{text:\"\\\\~\",math:\"\\\\tilde\"},\"̄\":{text:\"\\\\=\",math:\"\\\\bar\"},\"̆\":{text:\"\\\\u\",math:\"\\\\breve\"},\"̌\":{text:\"\\\\v\",math:\"\\\\check\"},\"̂\":{text:\"\\\\^\",math:\"\\\\hat\"},\"̇\":{text:\"\\\\.\",math:\"\\\\dot\"},\"̊\":{text:\"\\\\r\",math:\"\\\\mathring\"},\"̋\":{text:\"\\\\H\"},\"̧\":{text:\"\\\\c\"}},cn={\"á\":\"á\",\"à\":\"à\",\"ä\":\"ä\",\"ǟ\":\"ǟ\",\"ã\":\"ã\",\"ā\":\"ā\",\"ă\":\"ă\",\"ắ\":\"ắ\",\"ằ\":\"ằ\",\"ẵ\":\"ẵ\",\"ǎ\":\"ǎ\",\"â\":\"â\",\"ấ\":\"ấ\",\"ầ\":\"ầ\",\"ẫ\":\"ẫ\",\"ȧ\":\"ȧ\",\"ǡ\":\"ǡ\",\"å\":\"å\",\"ǻ\":\"ǻ\",\"ḃ\":\"ḃ\",\"ć\":\"ć\",\"č\":\"č\",\"ĉ\":\"ĉ\",\"ċ\":\"ċ\",\"ď\":\"ď\",\"ḋ\":\"ḋ\",\"é\":\"é\",\"è\":\"è\",\"ë\":\"ë\",\"ẽ\":\"ẽ\",\"ē\":\"ē\",\"ḗ\":\"ḗ\",\"ḕ\":\"ḕ\",\"ĕ\":\"ĕ\",\"ě\":\"ě\",\"ê\":\"ê\",\"ế\":\"ế\",\"ề\":\"ề\",\"ễ\":\"ễ\",\"ė\":\"ė\",\"ḟ\":\"ḟ\",\"ǵ\":\"ǵ\",\"ḡ\":\"ḡ\",\"ğ\":\"ğ\",\"ǧ\":\"ǧ\",\"ĝ\":\"ĝ\",\"ġ\":\"ġ\",\"ḧ\":\"ḧ\",\"ȟ\":\"ȟ\",\"ĥ\":\"ĥ\",\"ḣ\":\"ḣ\",\"í\":\"í\",\"ì\":\"ì\",\"ï\":\"ï\",\"ḯ\":\"ḯ\",\"ĩ\":\"ĩ\",\"ī\":\"ī\",\"ĭ\":\"ĭ\",\"ǐ\":\"ǐ\",\"î\":\"î\",\"ǰ\":\"ǰ\",\"ĵ\":\"ĵ\",\"ḱ\":\"ḱ\",\"ǩ\":\"ǩ\",\"ĺ\":\"ĺ\",\"ľ\":\"ľ\",\"ḿ\":\"ḿ\",\"ṁ\":\"ṁ\",\"ń\":\"ń\",\"ǹ\":\"ǹ\",\"ñ\":\"ñ\",\"ň\":\"ň\",\"ṅ\":\"ṅ\",\"ó\":\"ó\",\"ò\":\"ò\",\"ö\":\"ö\",\"ȫ\":\"ȫ\",\"õ\":\"õ\",\"ṍ\":\"ṍ\",\"ṏ\":\"ṏ\",\"ȭ\":\"ȭ\",\"ō\":\"ō\",\"ṓ\":\"ṓ\",\"ṑ\":\"ṑ\",\"ŏ\":\"ŏ\",\"ǒ\":\"ǒ\",\"ô\":\"ô\",\"ố\":\"ố\",\"ồ\":\"ồ\",\"ỗ\":\"ỗ\",\"ȯ\":\"ȯ\",\"ȱ\":\"ȱ\",\"ő\":\"ő\",\"ṕ\":\"ṕ\",\"ṗ\":\"ṗ\",\"ŕ\":\"ŕ\",\"ř\":\"ř\",\"ṙ\":\"ṙ\",\"ś\":\"ś\",\"ṥ\":\"ṥ\",\"š\":\"š\",\"ṧ\":\"ṧ\",\"ŝ\":\"ŝ\",\"ṡ\":\"ṡ\",\"ẗ\":\"ẗ\",\"ť\":\"ť\",\"ṫ\":\"ṫ\",\"ú\":\"ú\",\"ù\":\"ù\",\"ü\":\"ü\",\"ǘ\":\"ǘ\",\"ǜ\":\"ǜ\",\"ǖ\":\"ǖ\",\"ǚ\":\"ǚ\",\"ũ\":\"ũ\",\"ṹ\":\"ṹ\",\"ū\":\"ū\",\"ṻ\":\"ṻ\",\"ŭ\":\"ŭ\",\"ǔ\":\"ǔ\",\"û\":\"û\",\"ů\":\"ů\",\"ű\":\"ű\",\"ṽ\":\"ṽ\",\"ẃ\":\"ẃ\",\"ẁ\":\"ẁ\",\"ẅ\":\"ẅ\",\"ŵ\":\"ŵ\",\"ẇ\":\"ẇ\",\"ẘ\":\"ẘ\",\"ẍ\":\"ẍ\",\"ẋ\":\"ẋ\",\"ý\":\"ý\",\"ỳ\":\"ỳ\",\"ÿ\":\"ÿ\",\"ỹ\":\"ỹ\",\"ȳ\":\"ȳ\",\"ŷ\":\"ŷ\",\"ẏ\":\"ẏ\",\"ẙ\":\"ẙ\",\"ź\":\"ź\",\"ž\":\"ž\",\"ẑ\":\"ẑ\",\"ż\":\"ż\",\"Á\":\"Á\",\"À\":\"À\",\"Ä\":\"Ä\",\"Ǟ\":\"Ǟ\",\"Ã\":\"Ã\",\"Ā\":\"Ā\",\"Ă\":\"Ă\",\"Ắ\":\"Ắ\",\"Ằ\":\"Ằ\",\"Ẵ\":\"Ẵ\",\"Ǎ\":\"Ǎ\",\"Â\":\"Â\",\"Ấ\":\"Ấ\",\"Ầ\":\"Ầ\",\"Ẫ\":\"Ẫ\",\"Ȧ\":\"Ȧ\",\"Ǡ\":\"Ǡ\",\"Å\":\"Å\",\"Ǻ\":\"Ǻ\",\"Ḃ\":\"Ḃ\",\"Ć\":\"Ć\",\"Č\":\"Č\",\"Ĉ\":\"Ĉ\",\"Ċ\":\"Ċ\",\"Ď\":\"Ď\",\"Ḋ\":\"Ḋ\",\"É\":\"É\",\"È\":\"È\",\"Ë\":\"Ë\",\"Ẽ\":\"Ẽ\",\"Ē\":\"Ē\",\"Ḗ\":\"Ḗ\",\"Ḕ\":\"Ḕ\",\"Ĕ\":\"Ĕ\",\"Ě\":\"Ě\",\"Ê\":\"Ê\",\"Ế\":\"Ế\",\"Ề\":\"Ề\",\"Ễ\":\"Ễ\",\"Ė\":\"Ė\",\"Ḟ\":\"Ḟ\",\"Ǵ\":\"Ǵ\",\"Ḡ\":\"Ḡ\",\"Ğ\":\"Ğ\",\"Ǧ\":\"Ǧ\",\"Ĝ\":\"Ĝ\",\"Ġ\":\"Ġ\",\"Ḧ\":\"Ḧ\",\"Ȟ\":\"Ȟ\",\"Ĥ\":\"Ĥ\",\"Ḣ\":\"Ḣ\",\"Í\":\"Í\",\"Ì\":\"Ì\",\"Ï\":\"Ï\",\"Ḯ\":\"Ḯ\",\"Ĩ\":\"Ĩ\",\"Ī\":\"Ī\",\"Ĭ\":\"Ĭ\",\"Ǐ\":\"Ǐ\",\"Î\":\"Î\",\"İ\":\"İ\",\"Ĵ\":\"Ĵ\",\"Ḱ\":\"Ḱ\",\"Ǩ\":\"Ǩ\",\"Ĺ\":\"Ĺ\",\"Ľ\":\"Ľ\",\"Ḿ\":\"Ḿ\",\"Ṁ\":\"Ṁ\",\"Ń\":\"Ń\",\"Ǹ\":\"Ǹ\",\"Ñ\":\"Ñ\",\"Ň\":\"Ň\",\"Ṅ\":\"Ṅ\",\"Ó\":\"Ó\",\"Ò\":\"Ò\",\"Ö\":\"Ö\",\"Ȫ\":\"Ȫ\",\"Õ\":\"Õ\",\"Ṍ\":\"Ṍ\",\"Ṏ\":\"Ṏ\",\"Ȭ\":\"Ȭ\",\"Ō\":\"Ō\",\"Ṓ\":\"Ṓ\",\"Ṑ\":\"Ṑ\",\"Ŏ\":\"Ŏ\",\"Ǒ\":\"Ǒ\",\"Ô\":\"Ô\",\"Ố\":\"Ố\",\"Ồ\":\"Ồ\",\"Ỗ\":\"Ỗ\",\"Ȯ\":\"Ȯ\",\"Ȱ\":\"Ȱ\",\"Ő\":\"Ő\",\"Ṕ\":\"Ṕ\",\"Ṗ\":\"Ṗ\",\"Ŕ\":\"Ŕ\",\"Ř\":\"Ř\",\"Ṙ\":\"Ṙ\",\"Ś\":\"Ś\",\"Ṥ\":\"Ṥ\",\"Š\":\"Š\",\"Ṧ\":\"Ṧ\",\"Ŝ\":\"Ŝ\",\"Ṡ\":\"Ṡ\",\"Ť\":\"Ť\",\"Ṫ\":\"Ṫ\",\"Ú\":\"Ú\",\"Ù\":\"Ù\",\"Ü\":\"Ü\",\"Ǘ\":\"Ǘ\",\"Ǜ\":\"Ǜ\",\"Ǖ\":\"Ǖ\",\"Ǚ\":\"Ǚ\",\"Ũ\":\"Ũ\",\"Ṹ\":\"Ṹ\",\"Ū\":\"Ū\",\"Ṻ\":\"Ṻ\",\"Ŭ\":\"Ŭ\",\"Ǔ\":\"Ǔ\",\"Û\":\"Û\",\"Ů\":\"Ů\",\"Ű\":\"Ű\",\"Ṽ\":\"Ṽ\",\"Ẃ\":\"Ẃ\",\"Ẁ\":\"Ẁ\",\"Ẅ\":\"Ẅ\",\"Ŵ\":\"Ŵ\",\"Ẇ\":\"Ẇ\",\"Ẍ\":\"Ẍ\",\"Ẋ\":\"Ẋ\",\"Ý\":\"Ý\",\"Ỳ\":\"Ỳ\",\"Ÿ\":\"Ÿ\",\"Ỹ\":\"Ỹ\",\"Ȳ\":\"Ȳ\",\"Ŷ\":\"Ŷ\",\"Ẏ\":\"Ẏ\",\"Ź\":\"Ź\",\"Ž\":\"Ž\",\"Ẑ\":\"Ẑ\",\"Ż\":\"Ż\",\"ά\":\"ά\",\"ὰ\":\"ὰ\",\"ᾱ\":\"ᾱ\",\"ᾰ\":\"ᾰ\",\"έ\":\"έ\",\"ὲ\":\"ὲ\",\"ή\":\"ή\",\"ὴ\":\"ὴ\",\"ί\":\"ί\",\"ὶ\":\"ὶ\",\"ϊ\":\"ϊ\",\"ΐ\":\"ΐ\",\"ῒ\":\"ῒ\",\"ῑ\":\"ῑ\",\"ῐ\":\"ῐ\",\"ό\":\"ό\",\"ὸ\":\"ὸ\",\"ύ\":\"ύ\",\"ὺ\":\"ὺ\",\"ϋ\":\"ϋ\",\"ΰ\":\"ΰ\",\"ῢ\":\"ῢ\",\"ῡ\":\"ῡ\",\"ῠ\":\"ῠ\",\"ώ\":\"ώ\",\"ὼ\":\"ὼ\",\"Ύ\":\"Ύ\",\"Ὺ\":\"Ὺ\",\"Ϋ\":\"Ϋ\",\"Ῡ\":\"Ῡ\",\"Ῠ\":\"Ῠ\",\"Ώ\":\"Ώ\",\"Ὼ\":\"Ὼ\"};const mn=[\"bin\",\"op\",\"open\",\"punct\",\"rel\"],pn=/([-+]?) *(\\d+(?:\\.\\d*)?|\\.\\d+) *([a-z]{2})/,un=/^ *\\\\text/;class dn{constructor(e,t,r=!1){this.mode=\"math\",this.gullet=new nn(e,t,this.mode),this.settings=t,this.isPreamble=r,this.leftrightDepth=0,this.prevAtomType=\"\"}expect(t,r=!0){if(this.fetch().text!==t)throw new e(`Expected '${t}', got '${this.fetch().text}'`,this.fetch());r&&this.consume()}consume(){this.nextToken=null}fetch(){return null==this.nextToken&&(this.nextToken=this.gullet.expandNextToken()),this.nextToken}switchMode(e){this.mode=e,this.gullet.switchMode(e)}parse(){this.gullet.beginGroup(),this.settings.colorIsTextColor&&this.gullet.macros.set(\"\\\\color\",\"\\\\textcolor\");const e=this.parseExpression(!1);if(this.expect(\"EOF\"),this.isPreamble){const e=Object.create(null);return Object.entries(this.gullet.macros.current).forEach(([t,r])=>{e[t]=r}),this.gullet.endGroup(),e}const t=this.gullet.macros.get(\"\\\\df@tag\");return this.gullet.endGroup(),t&&(this.gullet.macros.current[\"\\\\df@tag\"]=t),e}static get endOfExpression(){return[\"}\",\"\\\\endgroup\",\"\\\\end\",\"\\\\right\",\"\\\\endtoggle\",\"&\"]}subparse(e){const t=this.nextToken;this.consume(),this.gullet.pushToken(new We(\"}\")),this.gullet.pushTokens(e);const r=this.parseExpression(!1);return this.expect(\"}\"),this.nextToken=t,r}parseExpression(e,t,r){const n=[];for(this.prevAtomType=\"\";;){\"math\"===this.mode&&this.consumeSpaces();const s=this.fetch();if(-1!==dn.endOfExpression.indexOf(s.text))break;if(t&&s.text===t)break;if(r&&\"\\\\middle\"===s.text)break;if(e&&Xr[s.text]&&Xr[s.text].infix)break;const o=this.parseAtom(t);if(!o)break;\"internal\"!==o.type&&(n.push(o),this.prevAtomType=\"atom\"===o.type?o.family:o.type)}return\"text\"===this.mode&&this.formLigatures(n),this.handleInfixNodes(n)}handleInfixNodes(t){let r,n=-1;for(let s=0;s<t.length;s++)if(\"infix\"===t[s].type){if(-1!==n)throw new e(\"only one infix operator per group\",t[s].token);n=s,r=t[s].replaceWith}if(-1!==n&&r){let e,s;const o=t.slice(0,n),a=t.slice(n+1);let l;return e=1===o.length&&\"ordgroup\"===o[0].type?o[0]:{type:\"ordgroup\",mode:this.mode,body:o},s=1===a.length&&\"ordgroup\"===a[0].type?a[0]:{type:\"ordgroup\",mode:this.mode,body:a},l=\"\\\\\\\\abovefrac\"===r?this.callFunction(r,[e,t[n],s],[]):this.callFunction(r,[e,s],[]),[l]}return t}handleSupSubscript(t){const r=this.fetch(),n=r.text;let s;this.consume(),this.consumeSpaces();do{s=this.parseGroup(t)}while(s.type&&\"internal\"===s.type);if(!s)throw new e(\"Expected group after '\"+n+\"'\",r);return s}formatUnsupportedCmd(e){const t=[];for(let r=0;r<e.length;r++)t.push({type:\"textord\",mode:\"text\",text:e[r]});const r={type:\"text\",mode:this.mode,body:t};return{type:\"color\",mode:this.mode,color:this.settings.errorColor,body:[r]}}parseAtom(t){const r=this.parseGroup(\"atom\",t);if(r&&\"internal\"===r.type)return r;if(\"text\"===this.mode)return r;let n,s;for(;;){this.consumeSpaces();const t=this.fetch();if(\"\\\\limits\"===t.text||\"\\\\nolimits\"===t.text){if(r&&\"op\"===r.type){const e=\"\\\\limits\"===t.text;r.limits=e,r.alwaysHandleSupSub=!0}else{if(!r||\"operatorname\"!==r.type)throw new e(\"Limit controls must follow a math operator\",t);r.alwaysHandleSupSub&&(r.limits=\"\\\\limits\"===t.text)}this.consume()}else if(\"^\"===t.text){if(n)throw new e(\"Double superscript\",t);n=this.handleSupSubscript(\"superscript\")}else if(\"_\"===t.text){if(s)throw new e(\"Double subscript\",t);s=this.handleSupSubscript(\"subscript\")}else if(\"'\"===t.text){if(n)throw new e(\"Double superscript\",t);const r={type:\"textord\",mode:this.mode,text:\"\\\\prime\"},s=[r];for(this.consume();\"'\"===this.fetch().text;)s.push(r),this.consume();\"^\"===this.fetch().text&&s.push(this.handleSupSubscript(\"superscript\")),n={type:\"ordgroup\",mode:this.mode,body:s}}else{if(!on[t.text])break;{const e=sn.test(t.text),r=[];for(r.push(new We(on[t.text])),this.consume();;){const t=this.fetch().text;if(!on[t])break;if(sn.test(t)!==e)break;r.unshift(new We(on[t])),this.consume()}const o=this.subparse(r);e?s={type:\"ordgroup\",mode:\"math\",body:o}:n={type:\"ordgroup\",mode:\"math\",body:o}}}}if(n||s){if(r&&\"multiscript\"===r.type&&!r.postscripts)return r.postscripts={sup:n,sub:s},r;{const e=!r||\"op\"!==r.type&&\"operatorname\"!==r.type?void 0:Gt(this.nextToken.text);return{type:\"supsub\",mode:this.mode,base:r,sup:n,sub:s,isFollowedByDelimiter:e}}}return r}parseFunction(t,r){const n=this.fetch(),s=n.text,o=Xr[s];if(!o)return null;if(this.consume(),r&&\"atom\"!==r&&!o.allowedInArgument)throw new e(\"Got function '\"+s+\"' with no arguments\"+(r?\" as \"+r:\"\"),n);if(\"text\"===this.mode&&!o.allowedInText)throw new e(\"Can't use function '\"+s+\"' in text mode\",n);if(\"math\"===this.mode&&!1===o.allowedInMath)throw new e(\"Can't use function '\"+s+\"' in math mode\",n);const a=this.prevAtomType,{args:l,optArgs:i}=this.parseArguments(s,o);return this.prevAtomType=a,this.callFunction(s,l,i,n,t)}callFunction(t,r,n,s,o){const a={funcName:t,parser:this,token:s,breakOnTokenText:o},l=Xr[t];if(l&&l.handler)return l.handler(a,r,n);throw new e(`No function handler for ${t}`)}parseArguments(t,r){const n=r.numArgs+r.numOptionalArgs;if(0===n)return{args:[],optArgs:[]};const s=[],o=[];for(let a=0;a<n;a++){let n=r.argTypes&&r.argTypes[a];const l=a<r.numOptionalArgs;(r.primitive&&null==n||\"sqrt\"===r.type&&1===a&&null==o[0])&&(n=\"primitive\");const i=this.parseGroupOfType(`argument to '${t}'`,n,l);if(l)o.push(i);else{if(null==i)throw new e(\"Null argument, please report this as a bug\");s.push(i)}}return{args:s,optArgs:o}}parseGroupOfType(t,r,n){switch(r){case\"size\":return this.parseSizeGroup(n);case\"url\":return this.parseUrlGroup(n);case\"math\":case\"text\":return this.parseArgumentGroup(n,r);case\"hbox\":{const e=this.parseArgumentGroup(n,\"text\");return null!=e?{type:\"styling\",mode:e.mode,body:[e],scriptLevel:\"text\"}:null}case\"raw\":{const e=this.parseStringGroup(\"raw\",n);return null!=e?{type:\"raw\",mode:\"text\",string:e.text}:null}case\"primitive\":{if(n)throw new e(\"A primitive argument cannot be optional\");const r=this.parseGroup(t);if(null==r)throw new e(\"Expected group as \"+t,this.fetch());return r}case\"original\":case null:case void 0:return this.parseArgumentGroup(n);default:throw new e(\"Unknown group type as \"+t,this.fetch())}}consumeSpaces(){for(;;){const e=this.fetch().text;if(\" \"!==e&&\"\xA0\"!==e&&\"︎\"!==e)break;this.consume()}}parseStringGroup(e,t){const r=this.gullet.scanArgument(t);if(null==r)return null;let n,s=\"\";for(;\"EOF\"!==(n=this.fetch()).text;)s+=n.text,this.consume();return this.consume(),r.text=s,r}parseRegexGroup(t,r){const n=this.fetch();let s,o=n,a=\"\";for(;\"EOF\"!==(s=this.fetch()).text&&t.test(a+s.text);)o=s,a+=o.text,this.consume();if(\"\"===a)throw new e(\"Invalid \"+r+\": '\"+n.text+\"'\",n);return n.range(o,a)}parseSizeGroup(t){let r,n=!1;if(this.gullet.consumeSpaces(),r=t||\"{\"===this.gullet.future().text?this.parseStringGroup(\"size\",t):this.parseRegexGroup(/^[-+]? *(?:$|\\d+|\\d+\\.\\d*|\\.\\d*) *[a-z]{0,2} *$/,\"size\"),!r)return null;t||0!==r.text.length||(r.text=\"0pt\",n=!0);const s=pn.exec(r.text);if(!s)throw new e(\"Invalid size: '\"+r.text+\"'\",r);const o={number:+(s[1]+s[2]),unit:s[3]};if(!Oe(o))throw new e(\"Invalid unit: '\"+o.unit+\"'\",r);return{type:\"size\",mode:this.mode,value:o,isBlank:n}}parseUrlGroup(e){this.gullet.lexer.setCatcode(\"%\",13),this.gullet.lexer.setCatcode(\"~\",12);const t=this.parseStringGroup(\"url\",e);if(this.gullet.lexer.setCatcode(\"%\",14),this.gullet.lexer.setCatcode(\"~\",13),null==t)return null;let r=t.text.replace(/\\\\([#$%&~_^{}])/g,\"$1\");return r=t.text.replace(/{\\u2044}/g,\"/\"),{type:\"url\",mode:this.mode,url:r}}parseArgumentGroup(e,t){const r=this.gullet.scanArgument(e);if(null==r)return null;const n=this.mode;t&&this.switchMode(t),this.gullet.beginGroup();const s=this.parseExpression(!1,\"EOF\");this.expect(\"EOF\"),this.gullet.endGroup();const o={type:\"ordgroup\",mode:this.mode,loc:r.loc,body:s};return t&&this.switchMode(n),o}parseGroup(t,r){const n=this.fetch(),s=n.text;if(\"argument to '\\\\left'\"===t)return this.parseSymbol();let o;if(\"{\"===s||\"\\\\begingroup\"===s||\"\\\\toggle\"===s){this.consume();const e=\"{\"===s?\"}\":\"\\\\begingroup\"===s?\"\\\\endgroup\":\"\\\\endtoggle\";this.gullet.beginGroup();const t=this.parseExpression(!1,e),r=this.fetch();this.expect(e),this.gullet.endGroup(),o={type:\"\\\\endtoggle\"===r.text?\"toggle\":\"ordgroup\",mode:this.mode,loc:Ve.range(n,r),body:t,semisimple:\"\\\\begingroup\"===s||void 0}}else if(o=this.parseFunction(r,t)||this.parseSymbol(),null==o&&\"\\\\\"===s[0]&&!Object.prototype.hasOwnProperty.call(rn,s)){if(this.settings.throwOnError)throw new e(\"Unsupported function name: \"+s,n);o=this.formatUnsupportedCmd(s),this.consume()}return o}formLigatures(e){let t=e.length-1;for(let r=0;r<t;++r){const n=e[r],s=n.text;\"-\"===s&&\"-\"===e[r+1].text&&(r+1<t&&\"-\"===e[r+2].text?(e.splice(r,3,{type:\"textord\",mode:\"text\",loc:Ve.range(n,e[r+2]),text:\"---\"}),t-=2):(e.splice(r,2,{type:\"textord\",mode:\"text\",loc:Ve.range(n,e[r+1]),text:\"--\"}),t-=1)),\"'\"!==s&&\"`\"!==s||e[r+1].text!==s||(e.splice(r,2,{type:\"textord\",mode:\"text\",loc:Ve.range(n,e[r+1]),text:s+s}),t-=1)}}parseSymbol(){const t=this.fetch();let r=t.text;if(/^\\\\verb[^a-zA-Z]/.test(r)){this.consume();let t=r.slice(5);const n=\"*\"===t.charAt(0);if(n&&(t=t.slice(1)),t.length<2||t.charAt(0)!==t.slice(-1))throw new e(\"\\\\verb assertion failed --\\n                    please report what input caused this bug\");return t=t.slice(1,-1),{type:\"verb\",mode:\"text\",body:t,star:n}}if(Object.prototype.hasOwnProperty.call(cn,r[0])&&\"math\"===this.mode&&!D[this.mode][r[0]]){if(this.settings.strict&&\"math\"===this.mode)throw new e(`Accented Unicode text character \"${r[0]}\" used in math mode`,t);r=cn[r[0]]+r.slice(1)}const n=\"math\"===this.mode?Kr.exec(r):null;let s;if(n&&(r=r.substring(0,n.index),\"i\"===r?r=\"ı\":\"j\"===r&&(r=\"ȷ\")),D[this.mode][r]){let e=D[this.mode][r].group;\"bin\"!==e||!mn.includes(this.prevAtomType)&&\"\"!==this.prevAtomType||(e=\"open\");const n=Ve.range(t);let o;if(Object.prototype.hasOwnProperty.call(j,e)){const t=e;o={type:\"atom\",mode:this.mode,family:t,loc:n,text:r},\"rel\"!==t&&\"bin\"!==t||\"text\"!==this.prevAtomType||un.test(n.lexer.input.slice(n.end))&&(o.needsSpacing=!0)}else{if(an[r]){this.consume();const e=this.fetch().text.charCodeAt(0),t=65025===e?\"mathscr\":\"mathcal\";return 65024!==e&&65025!==e||this.consume(),{type:\"font\",mode:\"math\",font:t,body:{type:\"mathord\",mode:\"math\",loc:n,text:an[r]}}}o={type:e,mode:this.mode,loc:n,text:r}}s=o}else{if(!(r.charCodeAt(0)>=128||Kr.exec(r)))return null;if(this.settings.strict&&\"math\"===this.mode)throw new e(`Unicode text character \"${r[0]}\" used in math mode`,t);s={type:\"textord\",mode:\"text\",loc:Ve.range(t),text:r}}if(this.consume(),n)for(let r=0;r<n[0].length;r++){const o=n[0][r];if(!ln[o])throw new e(`Unknown accent ' ${o}'`,t);const a=ln[o][this.mode]||ln[o].text;if(!a)throw new e(`Accent ${o} unsupported in ${this.mode} mode`,t);s={type:\"accent\",mode:this.mode,loc:Ve.range(t),label:a,isStretchy:!1,base:s}}return s}}const hn=function(t,r){if(!(\"string\"==typeof t||t instanceof String))throw new TypeError(\"Temml can only parse string typed expression\");let n,s;try{s=new dn(t,r),delete s.gullet.macros.current[\"\\\\df@tag\"],n=s.parse()}catch(e){if(\"ParseError:  Unmatched delimiter\"!==e.toString())throw e;r.wrapDelimiterPairs=!1,s=new dn(t,r),delete s.gullet.macros.current[\"\\\\df@tag\"],n=s.parse()}if(!(n.length>0&&n[0].type&&\"array\"===n[0].type&&n[0].addEqnNum)&&s.gullet.macros.get(\"\\\\df@tag\")){if(!r.displayMode)throw new e(\"\\\\tag works only in display mode\");s.gullet.feed(\"\\\\df@tag\"),n=[{type:\"tag\",mode:\"text\",body:n,tag:s.parse()}]}return n},gn=[2,2,3,3];class fn{constructor(e){this.level=e.level,this.color=e.color,this.font=e.font||\"\",this.fontFamily=e.fontFamily||\"\",this.fontSize=e.fontSize||1,this.fontWeight=e.fontWeight||\"\",this.fontShape=e.fontShape||\"\",this.maxSize=e.maxSize}extend(e){const t={level:this.level,color:this.color,font:this.font,fontFamily:this.fontFamily,fontSize:this.fontSize,fontWeight:this.fontWeight,fontShape:this.fontShape,maxSize:this.maxSize};for(const r in e)Object.prototype.hasOwnProperty.call(e,r)&&(t[r]=e[r]);return new fn(t)}withLevel(e){return this.extend({level:e})}incrementLevel(){return this.extend({level:Math.min(this.level+1,3)})}inSubOrSup(){return this.extend({level:gn[this.level]})}withColor(e){return this.extend({color:e})}withFont(e){return this.extend({font:e})}withTextFontFamily(e){return this.extend({fontFamily:e,font:\"\"})}withFontSize(e){return this.extend({fontSize:e})}withTextFontWeight(e){return this.extend({fontWeight:e,font:\"\"})}withTextFontShape(e){return this.extend({fontShape:e,font:\"\"})}getColor(){return this.color}}function bn(e){const t={};let r=0;const n=document.getElementsByClassName(\"tml-eqn\");for(let e of n)for(r+=1,e.setAttribute(\"id\",\"tml-eqn-\"+String(r));\"mtable\"!==e.tagName;){if(e.getElementsByClassName(\"tml-label\").length>0){const n=e.attributes.id.value;t[n]=String(r);break}e=e.parentElement}const s=document.getElementsByClassName(\"tml-tageqn\");for(const e of s){if(e.getElementsByClassName(\"tml-label\").length>0){const r=e.getElementsByClassName(\"tml-tag\");if(r.length>0){const n=e.attributes.id.value;t[n]=r[0].textContent}}}[...e.getElementsByClassName(\"tml-ref\")].forEach(e=>{const r=e.getAttribute(\"href\");let n=t[r.slice(1)];-1===e.className.indexOf(\"tml-eqref\")?(n=n.replace(/^\\(/,\"\"),n=n.replace(/\\)$/,\"\")):(\"(\"!==n.charAt(0)&&(n=\"(\"+n),\")\"!==n.slice(-1)&&(n+=\")\"));const s=document.createElementNS(\"http://www.w3.org/1998/Math/MathML\",\"mtext\");s.appendChild(document.createTextNode(n));const o=document.createElementNS(\"http://www.w3.org/1998/Math/MathML\",\"math\");o.appendChild(s),e.textContent=\"\",e.appendChild(o)})}const yn=function(e,t,r){let n=r,s=0;const o=e.length;for(;n<t.length;){const r=t[n];if(s<=0&&t.slice(n,n+o)===e)return n;\"\\\\\"===r?n++:\"{\"===r?s++:\"}\"===r&&s--,n++}return-1},wn=/^\\\\(?:begin|(?:eq)?ref){/,xn=[{left:\"$$\",right:\"$$\",display:!0},{left:\"\\\\(\",right:\"\\\\)\",display:!1},{left:\"\\\\begin{equation}\",right:\"\\\\end{equation}\",display:!0},{left:\"\\\\begin{equation*}\",right:\"\\\\end{equation*}\",display:!0},{left:\"\\\\begin{align}\",right:\"\\\\end{align}\",display:!0},{left:\"\\\\begin{align*}\",right:\"\\\\end{align*}\",display:!0},{left:\"\\\\begin{alignat}\",right:\"\\\\end{alignat}\",display:!0},{left:\"\\\\begin{alignat*}\",right:\"\\\\end{alignat*}\",display:!0},{left:\"\\\\begin{gather}\",right:\"\\\\end{gather}\",display:!0},{left:\"\\\\begin{gather*}\",right:\"\\\\end{gather*}\",display:!0},{left:\"\\\\begin{CD}\",right:\"\\\\end{CD}\",display:!0},{left:\"\\\\ref{\",right:\"}\",display:!1},{left:\"\\\\eqref{\",right:\"}\",display:!1},{left:\"\\\\[\",right:\"\\\\]\",display:!0}],kn={$:[{left:\"$$\",right:\"$$\",display:!0},{left:\"$`\",right:\"`$\",display:!1},{left:\"$\",right:\"$\",display:!1}],\"(\":[{left:\"\\\\[\",right:\"\\\\]\",display:!0},{left:\"\\\\(\",right:\"\\\\)\",display:!1}]},vn=[{left:\"\\\\begin{equation}\",right:\"\\\\end{equation}\",display:!0},{left:\"\\\\begin{equation*}\",right:\"\\\\end{equation*}\",display:!0},{left:\"\\\\begin{align}\",right:\"\\\\end{align}\",display:!0},{left:\"\\\\begin{align*}\",right:\"\\\\end{align*}\",display:!0},{left:\"\\\\begin{alignat}\",right:\"\\\\end{alignat}\",display:!0},{left:\"\\\\begin{alignat*}\",right:\"\\\\end{alignat*}\",display:!0},{left:\"\\\\begin{gather}\",right:\"\\\\end{gather}\",display:!0},{left:\"\\\\begin{gather*}\",right:\"\\\\end{gather*}\",display:!0},{left:\"\\\\begin{CD}\",right:\"\\\\end{CD}\",display:!0},{left:\"\\\\ref{\",right:\"}\",display:!1},{left:\"\\\\eqref{\",right:\"}\",display:!1}],An=function(t,r){const n=function(e,t){let r;const n=[],s=new RegExp(\"(\"+t.map(e=>e.left.replace(/[-/\\\\^$*+?.()|[\\]{}]/g,\"\\\\$&\")).join(\"|\")+\")\");for(;r=e.search(s),-1!==r;){r>0&&(n.push({type:\"text\",data:e.slice(0,r)}),e=e.slice(r));const s=t.findIndex(t=>e.startsWith(t.left));if(r=yn(t[s].right,e,t[s].left.length),-1===r)break;const o=e.slice(0,r+t[s].right.length),a=wn.test(o)?o:e.slice(t[s].left.length,r);n.push({type:\"math\",data:a,rawData:o,display:t[s].display}),e=e.slice(r+t[s].right.length)}return\"\"!==e&&n.push({type:\"text\",data:e}),n}(t,r.delimiters);if(1===n.length&&\"text\"===n[0].type)return null;const s=document.createDocumentFragment();for(let t=0;t<n.length;t++)if(\"text\"===n[t].type)s.appendChild(document.createTextNode(n[t].data));else{const o=document.createElement(\"span\");let a=n[t].data;r.displayMode=n[t].display;try{r.preProcess&&(a=r.preProcess(a)),temml.render(a,o,r)}catch(o){if(!(o instanceof e))throw o;r.errorCallback(\"Temml auto-render: Failed to parse `\"+n[t].data+\"` with \",o),s.appendChild(document.createTextNode(n[t].rawData));continue}s.appendChild(o)}return s},Tn=function(e,t){for(let r=0;r<e.childNodes.length;r++){const n=e.childNodes[r];if(3===n.nodeType){const s=An(n.textContent,t);s&&(r+=s.childNodes.length-1,e.replaceChild(s,n))}else if(1===n.nodeType){const e=\" \"+n.className+\" \";-1===t.ignoredTags.indexOf(n.nodeName.toLowerCase())&&t.ignoredClasses.every(t=>-1===e.indexOf(\" \"+t+\" \"))&&Tn(n,t)}}};let Sn=function(e,t,r={}){t.textContent=\"\";const n=\"math\"===t.tagName.toLowerCase();n&&(r.wrap=\"none\");const s=On(e,r);n||s.children.length>1?(t.textContent=\"\",s.children.forEach(e=>{t.appendChild(e.toNode())})):t.appendChild(s.toNode())};\"undefined\"!=typeof document&&\"CSS1Compat\"!==document.compatMode&&(\"undefined\"!=typeof console&&console.warn(\"Warning: Temml doesn't work in quirks mode. Make sure your website has a suitable doctype.\"),Sn=function(){throw new e(\"Temml doesn't work in quirks mode.\")});const On=function(t,r){const n=new u(r);try{const e=hn(t,n);return we(e,t,new fn({level:n.displayMode?Xe:Ze,maxSize:n.maxSize}),n)}catch(r){return function(t,r,n){if(n.throwOnError||!(t instanceof e))throw t;const s=new T([\"temml-error\"],[new S(r+\"\\n\\n\"+t.toString())]);return s.style.color=n.errorColor,s.style.whiteSpace=\"pre-line\",s}(r,t,n)}};return{version:\"0.14.0\",render:Sn,renderToString:function(e,t){return On(e,t).toMarkup()},renderMathInElement:function(e,t){if(!e)throw new Error(\"No element provided to render\");const r={};for(const e in t)Object.prototype.hasOwnProperty.call(t,e)&&(r[e]=t[e]);r.fences?r.delimiters=(e=>{if(\"$\"===e||\"(\"===e)return kn[e];if(\"$+\"===e||\"(+\"===e)return kn[e.slice(0,1)].concat(vn);return\"ams\"===e?vn:\"all\"===e?kn[\"(\"].concat(kn.$).concat(vn):xn})(r.fences):r.delimiters=r.delimiters||xn,r.ignoredTags=r.ignoredTags||[\"script\",\"noscript\",\"style\",\"textarea\",\"pre\",\"code\",\"option\"],r.ignoredClasses=r.ignoredClasses||[],r.errorCallback=r.errorCallback||console.error,r.macros=r.macros||Object.create(null),Tn(e,r),bn(e)},postProcess:bn,ParseError:e,definePreamble:function(e,t){const r=new u(t);if(r.macros=Object.create(null),!(\"string\"==typeof e||e instanceof String))throw new TypeError(\"Temml can only parse string typed expression\");const n=new dn(e,r,!0);delete n.gullet.macros.current[\"\\\\df@tag\"];return n.parse()},__parse:function(e,t){const r=new u(t);return hn(e,r)},__renderToMathMLTree:On,__defineSymbol:G,__defineMacro:Qe}}();\nreturn temml;\n})()");
// src/node/chatgpt-render.ts
function invalid() {
	throw new Error("Malformed conversation payload");
}
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function obj(value) {
	return record(value) ? value : {};
}
function array(value) {
	return Array.isArray(value) ? value : [];
}
function str(value) {
	return typeof value === "string" ? value : "";
}
function source(value) {
	const item = obj(value);
	return {
		label: str(item.attribution) || str(item.title) || str(item.url) || "Source",
		url: str(item.url)
	};
}
function sources(value) {
	return array(value).flatMap((item) => [source(item), ...array(obj(item).supporting_websites).map(source)]);
}
function reference(value) {
	const ref = obj(value);
	const type = str(ref.type);
	let links = sources(type === "sources_footnote" ? ref.sources : ref.items);
	if (!links.length) links = sources(ref.fallback_items);
	if (!links.length && (ref.url || ref.title || ref.attribution)) links = [source(ref)];
	if (!links.length) links = array(ref.safe_urls).filter((url) => typeof url === "string").map((url) => ({
		label: url,
		url
	}));
	if (!links.length && type === "file" && str(ref.name)) links = [{
		label: str(ref.name),
		url: ""
	}];
	return {
		marker: str(ref.matched_text),
		type,
		widgetType: str(obj(ref.data).widget_type),
		alt: str(ref.alt),
		sources: links,
		images: array(ref.images).map((item) => {
			const image = obj(item);
			return str(obj(image.image_result ?? image).content_url);
		}).filter(Boolean),
		data: obj(ref.data).content
	};
}
function parsePart(value) {
	if (typeof value === "string") return {
		kind: "text",
		text: value
	};
	if (!record(value) || typeof value.content_type !== "string") invalid();
	if (value.content_type === "image_asset_pointer") {
		if (typeof value.asset_pointer !== "string" || !value.asset_pointer) invalid();
		return {
			kind: "image",
			pointer: value.asset_pointer
		};
	}
	if (value.content_type === "audio_transcription") return {
		kind: "text",
		text: `[Audio transcription] ${str(value.text)}`
	};
	return {
		kind: "unsupported",
		label: value.content_type,
		data: value
	};
}
function parseMessage(value) {
	if (value === void 0 || value === null) return null;
	if (!record(value) || !record(value.author) || typeof value.author.role !== "string" || !record(value.content) || typeof value.content.content_type !== "string") invalid();
	const content = value.content;
	const metadata = obj(value.metadata);
	const contentType = str(content.content_type);
	let parts;
	if (contentType === "text" || contentType === "multimodal_text") {
		if (!Array.isArray(content.parts)) invalid();
		if (contentType === "text" && !content.parts.every((part) => typeof part === "string")) invalid();
		parts = content.parts.map(parsePart);
		const fallback = obj(metadata.model_dil_v2).fallbackMarkdown;
		if (contentType === "text" && typeof fallback === "string" && fallback.trim()) {
			const original = content.parts.join("");
			const leading = original.slice(0, original.length - original.trimStart().length);
			const trailing = original.slice(original.trimEnd().length);
			parts = [{
				kind: "text",
				text: leading + fallback.replaceAll(/<escape>([\s\S]*?)<\/escape>/g, "$1") + trailing
			}];
		}
	} else if (contentType === "execution_output") {
		parts = array(obj(metadata.aggregate_result).messages).filter((item) => obj(item).message_type === "image").map((item) => ({
			kind: "image",
			pointer: str(obj(item).image_url)
		}));
		if (!parts.length) parts = [{
			kind: "unsupported",
			label: "Execution result",
			data: str(content.text)
		}];
	} else if (contentType === "code") parts = [{
		kind: "unsupported",
		label: "Code",
		data: str(content.text)
	}];
	else if (contentType === "tether_quote") parts = [{
		kind: "text",
		text: str(content.title) || str(content.text)
	}];
	else if (contentType === "tether_browsing_display") parts = [{
		kind: "text",
		text: sources(obj(metadata._cite_metadata).metadata_list).map(linkMarkdown).join("\n\n")
	}];
	else parts = [{
		kind: "unsupported",
		label: contentType,
		data: content
	}];
	return {
		role: value.author.role,
		name: str(value.author.name),
		recipient: typeof value.recipient === "string" ? value.recipient : void 0,
		channel: str(value.channel),
		contentType,
		parts,
		references: array(metadata.content_references).map(reference),
		citations: array(metadata.citations).map((item) => {
			const meta = obj(obj(item).metadata);
			const index = obj(meta.extra).cited_message_idx;
			return {
				index: typeof index === "number" ? index : -1,
				source: source(meta)
			};
		}),
		attachments: array(metadata.attachments).filter((item) => !str(obj(item).mime_type).startsWith("image/")).map((item) => str(obj(item).name)).filter(Boolean),
		hidden: Boolean(metadata.is_visually_hidden_from_conversation),
		preamble: Boolean(metadata.is_thinking_preamble_message),
		automation: Boolean(metadata.automation_id)
	};
}
function validateConversation(raw, expectedId) {
	let encoded;
	try {
		encoded = JSON.stringify(raw);
	} catch {
		invalid();
	}
	if (!encoded || Buffer.byteLength(encoded) > 33554432) invalid();
	if (!record(raw) || !record(raw.mapping)) invalid();
	for (const supplied of [raw.id, raw.conversation_id]) if (supplied !== void 0 && (typeof supplied !== "string" || !supplied || supplied.length > 200)) invalid();
	const id = str(raw.id) || str(raw.conversation_id) || expectedId;
	if (!id || id.length > 200 || expectedId !== void 0 && id !== expectedId) invalid();
	if (raw.id !== void 0 && raw.conversation_id !== void 0 && raw.id !== raw.conversation_id) invalid();
	if (raw.title !== void 0 && raw.title !== null && typeof raw.title !== "string") invalid();
	const entries = Object.entries(raw.mapping);
	if (!entries.length || entries.length > 2e4) invalid();
	const nodes = /* @__PURE__ */ new Map();
	for (const [key, value] of entries) {
		if (!key || key.length > 200 || !record(value) || value.id !== key) invalid();
		if (value.parent !== void 0 && value.parent !== null && typeof value.parent !== "string") invalid();
		if (value.children !== void 0 && (!Array.isArray(value.children) || !value.children.every((child) => typeof child === "string"))) invalid();
		const parent = typeof value.parent === "string" ? value.parent : value.parent === null ? null : void 0;
		const children = Array.isArray(value.children) ? value.children.filter((child) => typeof child === "string") : void 0;
		nodes.set(key, {
			id: key,
			parent,
			children,
			message: parseMessage(value.message)
		});
	}
	for (const node of nodes.values()) {
		if (node.parent !== null && node.parent !== void 0 && !nodes.has(node.parent)) invalid();
		if (node.children?.some((child) => !nodes.has(child))) invalid();
	}
	const complete = /* @__PURE__ */ new Set();
	for (const start of nodes.keys()) {
		const path = /* @__PURE__ */ new Set();
		let cursor = start;
		while (cursor !== void 0 && cursor !== null && !complete.has(cursor)) {
			if (path.has(cursor)) invalid();
			path.add(cursor);
			cursor = nodes.get(cursor)?.parent;
		}
		for (const item of path) complete.add(item);
	}
	if (raw.current_node !== void 0 && raw.current_node !== null && typeof raw.current_node !== "string") invalid();
	let current = str(raw.current_node) || [...nodes.values()].find((node) => !node.children?.length)?.id;
	if (!current || !nodes.has(current)) invalid();
	const branch = [];
	while (current) {
		const node = nodes.get(current);
		if (!node) invalid();
		if (node.parent === void 0) break;
		branch.push(node);
		current = node.parent ?? void 0;
	}
	branch.reverse();
	for (let index = 0; index < branch.length - 1; index++) {
		const message = branch[index]?.message;
		const child = branch[index + 1]?.message;
		if (message?.role === "assistant" && message.recipient === void 0 && message.contentType === "text" && (child?.contentType === "thoughts" || child?.contentType === "reasoning_recap")) message.preamble = true;
	}
	return {
		raw,
		id,
		title: str(raw.title) || "ChatGPT Conversation",
		branch
	};
}
function visible(message) {
	if (message.role === "system" || message.role === "developer" || message.hidden || message.preamble) return false;
	if (message.recipient !== void 0 && message.recipient !== "all") return false;
	if ([
		"thoughts",
		"reasoning_recap",
		"model_editable_context",
		"user_editable_context"
	].includes(message.contentType)) return false;
	if (message.role === "assistant" && message.contentType === "text" && !message.parts.some((part) => part.kind === "text" && part.text.trim())) return false;
	if (message.role === "tool") return message.name !== "file_search" && message.parts.some((part) => part.kind === "image");
	return [
		"user",
		"assistant",
		"tool"
	].includes(message.role);
}
function messages(conversation) {
	const result = [];
	for (const node of conversation.branch) {
		if (!node.message || !visible(node.message)) continue;
		const message = structuredClone(node.message);
		const previous = result.at(-1);
		if (previous?.role === "assistant" && message.role === "assistant" && previous.recipient === "all" && message.recipient === "all" && previous.contentType === "text" && message.contentType === "text" && !message.automation) {
			const first = message.parts[0];
			const last = previous.parts.at(-1);
			if (first?.kind === "text" && last?.kind === "text") {
				last.text += (previous.channel !== message.channel ? "\n\n" : "") + first.text;
				previous.parts.push(...message.parts.slice(1));
			} else previous.parts.push(...message.parts);
			previous.references.push(...message.references);
			previous.citations.push(...message.citations);
			previous.attachments.push(...message.attachments);
		} else result.push(message);
	}
	return result;
}
function escape(input) {
	return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function safeUrl(input) {
	const url = input.trim();
	if (/[\u0000-\u0020\u007f]/u.test(url)) return null;
	try {
		const parsed = new URL(url);
		return [
			"https:",
			"http:",
			"mailto:"
		].includes(parsed.protocol) ? parsed.href : null;
	} catch {
		return null;
	}
}
function markdownText(text) {
	return text.replaceAll(/([\\\[\]`*_<>])/g, "\\$1").replaceAll(/[\r\n]/g, " ");
}
function linkMarkdown(source) {
	const url = safeUrl(source.url);
	return url ? `[${markdownText(source.label)}](<${url.replaceAll(">", "%3E").replaceAll("<", "%3C")}>)` : markdownText(source.label);
}
function normalize(text) {
	return text.replaceAll(/[\u00A0\u202F\u2007\u2060]/gu, " ").replaceAll(/[\uE203\uE204]/gu, "");
}
function references(text, message) {
	let result = normalize(text);
	for (const ref of [...message.references].sort((left, right) => right.marker.length - left.marker.length)) {
		if (!ref.marker || ref.type === "sources_footnote" || ref.type === "url" || ref.type === "client_defined_widget" && ref.widgetType === "code_block") continue;
		let replacement = ref.sources.length ? `(${ref.sources.map(linkMarkdown).join(", ")})` : ref.alt.replaceAll(/\[([^\]]*)\]\(\)/g, "$1");
		if (ref.images.length) replacement = ref.images.map((pointer) => `![Image](<${pointer.replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`).join("\n\n");
		if (!replacement && ref.data !== void 0) replacement = `\n\nWidget data\n\n\`\`\`json\n${JSON.stringify(ref.data, null, 2)}\n\`\`\`\n\n`;
		result = result.replaceAll(normalize(ref.marker), () => replacement);
	}
	result = result.replaceAll(/\uE200url\uE202([^\uE200\uE201\uE202]*)\uE202([^\uE200\uE201\uE202]+)\uE201/gu, (_, label, url) => linkMarkdown({
		label,
		url
	}));
	result = result.replaceAll(/\uE200entity\uE202([^\uE200\uE201]*)\uE201/gu, (_, data) => {
		try {
			const value = JSON.parse(data);
			return Array.isArray(value) && typeof value[1] === "string" ? markdownText(value[1]) : "[Entity]";
		} catch {
			return "[Entity]";
		}
	});
	result = result.replaceAll(/【(\d+)†\((.+?)\)】/g, (marker, index) => {
		const citation = message.citations.find((item) => item.index === Number(index));
		return citation ? `(${linkMarkdown(citation.source)})` : marker;
	});
	result = result.replaceAll(/\uE200(?:cite|image_group)(?:\uE202[^\uE200\uE201]*)+\uE201/gu, "").replaceAll(/[\uE200-\uE20F]/g, "");
	const footnotes = message.references.filter((ref) => ref.type === "sources_footnote").flatMap((ref) => ref.sources);
	if (footnotes.length) result += `\n\n**Sources**\n\n${footnotes.map((item) => `- ${linkMarkdown(item)}`).join("\n")}`;
	return result;
}
function mathExtension(warnings) {
	const render = (raw, tex, display) => {
		try {
			return _mark_deferred_temml_default.renderToString(tex, {
				displayMode: display,
				trust: false,
				strict: true,
				throwOnError: true,
				maxExpand: 1e3,
				maxSize: [30, 30]
			});
		} catch {
			warnings.add("A formula could not be typeset; its TeX was retained.");
			return `<code class="math-fallback">${escape(raw)}</code>`;
		}
	};
	return { extensions: [{
		name: "archiveMathBlock",
		level: "block",
		start(input) {
			return input.search(/(?:^|\n)(?:\$\$|\\\[)/);
		},
		tokenizer(input) {
			const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*\n|$)/.exec(input);
			return match ? {
				type: "archiveMathBlock",
				raw: match[0],
				tex: match[1] ?? match[2] ?? ""
			} : void 0;
		},
		renderer(token) {
			return `<div class="math">${render(token.raw, str(token.tex), true)}</div>`;
		}
	}, {
		name: "archiveMathInline",
		level: "inline",
		start(input) {
			return input.search(/\\\(|\$(?=\S)/);
		},
		tokenizer(input) {
			const match = /^(?:\\\(([^\n]+?)\\\)|\$(?![\s$])([^\n$]*?[^\s$])\$(?!\d))/.exec(input);
			return match ? {
				type: "archiveMathInline",
				raw: match[0],
				tex: match[1] ?? match[2] ?? ""
			} : void 0;
		},
		renderer(token) {
			return render(token.raw, str(token.tex), false);
		}
	}] };
}
function conversationImageReferences(conversation) {
	const refs = /* @__PURE__ */ new Set();
	const parser = new J(mathExtension(/* @__PURE__ */ new Set()), { walkTokens(token) {
		if (token.type === "image") refs.add(token.href);
	} });
	for (const message of messages(conversation)) {
		for (const part of message.parts) if (part.kind === "image") refs.add(part.pointer);
		else if (part.kind === "text" && message.role === "assistant") parser.parse(references(part.text, message), { async: false });
		for (const reference of message.references) for (const image of reference.images) refs.add(image);
	}
	return [...refs];
}
function renderConversation(conversation, options = {}) {
	const warnings = /* @__PURE__ */ new Set();
	let embeddedImageBytes = 0;
	const image = (pointer, label) => {
		const data = options.images ? options.images.get(pointer) ?? "" : pointer.startsWith("data:") ? pointer : "";
		if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data) && data.length <= 16777216 && embeddedImageBytes + data.length <= 33554432) {
			embeddedImageBytes += data.length;
			return `<img src="${escape(data)}" alt="${escape(label)}" loading="lazy">`;
		}
		warnings.add("An image could not be embedded; a placeholder was included.");
		return `<p class="unavailable">[Image unavailable${label && label !== "Image" ? `: ${escape(label)}` : ""}]</p>`;
	};
	const marked = new J(mathExtension(warnings), {
		gfm: true,
		breaks: false,
		renderer: {
			html({ text }) {
				return escape(text);
			},
			link({ href, tokens }) {
				const label = this.parser.parseInline(tokens);
				const url = safeUrl(href);
				return url ? `<a href="${escape(url)}" rel="noreferrer noopener">${label}</a>` : label;
			},
			image({ href, text }) {
				return image(href, text);
			}
		}
	});
	const items = messages(conversation).map((message) => {
		const label = message.role === "user" ? "You" : message.role === "tool" ? `Tool output${message.name ? ` (${message.name})` : ""}` : message.channel === "analysis" ? "Assistant (visible analysis)" : "Assistant";
		const body = message.parts.map((part) => {
			if (part.kind === "image") return image(part.pointer, "Image");
			if (part.kind === "unsupported") {
				warnings.add("Unsupported content was retained as labelled text; interactive widgets are not reconstructed.");
				return `<p>${escape(part.label)}</p><pre><code>${escape(typeof part.data === "string" ? part.data : JSON.stringify(part.data, null, 2) ?? "")}</code></pre>`;
			}
			if (message.role !== "assistant") return `<p class="plain">${escape(part.text)}</p>`;
			return marked.parse(references(part.text, message), { async: false });
		}).join("\n");
		const attachments = message.attachments.length ? `<ul class="attachments">${message.attachments.map((name) => `<li>Attachment: ${escape(name)}</li>`).join("")}</ul>` : "";
		return `<article class="message ${message.role}"><h2>${escape(label)}</h2>${body}${attachments}</article>`;
	}).join("\n");
	const notice = warnings.size ? `<aside aria-label="Archive limitations"><ul>${[...warnings].map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul></aside>` : "";
	const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(conversation.title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#202124;background:#fafafa;margin:0 auto;padding:2rem 1rem;max-width:860px}h1{line-height:1.2;overflow-wrap:anywhere}h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:#62666c}.message{padding:1rem 1.25rem;margin:1.5rem 0;background:white;border:1px solid #ddd;border-radius:12px}.user{background:#f1f3f5}.plain{white-space:pre-wrap}pre{overflow:auto;background:#f1f3f5;padding:1rem;border-radius:6px}code{font-family:ui-monospace,monospace}img{max-width:100%;height:auto}a{color:#075abc;overflow-wrap:anywhere}table{border-collapse:collapse;display:block;overflow:auto}td,th{padding:.4rem .7rem;border:1px solid #bbb}blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:1rem}aside,.unavailable{color:#655324}.attachments{font-size:.9rem}</style></head><body><main><h1>${escape(conversation.title)}</h1><p>Conversation transcript. Interactive tools are retained in the accompanying JSON.</p>${items}${notice}</main></body></html>\n`;
	return {
		html: Buffer.from(html),
		warnings: [...warnings]
	};
}
// src/node/chatgpt-session.ts
const SESSION_NAME = "chatgpt_session.json";
const MAX_SESSION_FILE_BYTES = 65536;
const MAX_TOKEN_BYTES = 16384;
var CredentialFailure = class extends Error {
	reason;
	constructor(reason) {
		super(reason);
		this.reason = reason;
	}
};
function hasCode(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isToken(value) {
	return typeof value === "string" && value.length >= 16 && value.length <= MAX_TOKEN_BYTES && /^[\x21-\x7e]+$/.test(value);
}
function isSession(value) {
	return isRecord(value) && value.schemaVersion === 1 && isToken(value.accessToken) && (value.accountId === void 0 || isUuid(value.accountId)) && (value.archivePublicationOptIn === void 0 || typeof value.archivePublicationOptIn === "boolean") && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)) && new Date(value.updatedAt).toISOString() === value.updatedAt;
}
function safeStatus(session) {
	return {
		status: "configured",
		hasAccountId: Boolean(session.accountId),
		archivePublicationOptIn: session.archivePublicationOptIn === true
	};
}
async function privateHome(home, create) {
	if (create) await mkdir(home, {
		recursive: true,
		mode: 448
	});
	let handle;
	try {
		handle = await open(home, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	} catch (error) {
		if (hasCode(error, "ENOENT")) throw new CredentialFailure("credentials_missing");
		if (hasCode(error, "ELOOP") || hasCode(error, "ENOTDIR")) throw new CredentialFailure("credentials_unsafe");
		throw error;
	}
	try {
		let info = await handle.stat();
		if (!info.isDirectory() || info.uid !== process.getuid?.()) throw new CredentialFailure("credentials_unsafe");
		if (create && (info.mode & 4095) !== 448) {
			await handle.chmod(448);
			info = await handle.stat();
		}
		const current = await lstat(home);
		if (current.isSymbolicLink() || current.ino !== info.ino || current.dev !== info.dev || (info.mode & 4095) !== 448) throw new CredentialFailure("credentials_unsafe");
	} finally {
		await handle.close();
	}
}
async function sessionFile(home) {
	const filename = path.join(home, SESSION_NAME);
	try {
		const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const info = await handle.stat();
			if (!info.isFile() || info.uid !== process.getuid?.() || info.nlink !== 1 || (info.mode & 4095) !== 384 || info.size > MAX_SESSION_FILE_BYTES) throw new CredentialFailure("credentials_unsafe");
			return handle;
		} catch (error) {
			await handle.close();
			throw error;
		}
	} catch (error) {
		if (hasCode(error, "ENOENT")) throw new CredentialFailure("credentials_missing");
		if (hasCode(error, "ELOOP")) throw new CredentialFailure("credentials_unsafe");
		throw error;
	}
}
async function readSession(home) {
	await privateHome(home, false);
	const handle = await sessionFile(home);
	try {
		const raw = JSON.parse(await handle.readFile("utf8"));
		if (!isSession(raw)) throw new CredentialFailure("credentials_invalid");
		return raw;
	} catch (error) {
		if (error instanceof SyntaxError) throw new CredentialFailure("credentials_invalid");
		throw error;
	} finally {
		await handle.close();
	}
}
async function chatgptStatus(home) {
	try {
		await lstat(path.join(home, SESSION_NAME));
		return safeStatus(await readSession(home));
	} catch (error) {
		return {
			status: "skipped",
			reason: error instanceof CredentialFailure ? error.reason : hasCode(error, "ENOENT") ? "credentials_missing" : "storage_unavailable"
		};
	}
}
// src/node/chatgpt-archive.ts
const PROBE_URL = `${CHATGPT_ORIGIN}/backend-api/conversations?offset=0&limit=1`;
const LOCK_NAME = ".chatgpt-session.lock";
const MAX_SESSION_INPUT_BYTES = 262144;
const MAX_FORM_BYTES = 787456;
const MAX_JSON_BYTES = 33554432;
const MAX_HTML_BYTES = 67108864;
const MAX_IMAGE_BYTES = 8388608;
const MAX_IMAGE_TOTAL_BYTES = 16777216;
const MAX_IMAGES = 12;
var SafeFailure = class extends Error {
	reason;
	constructor(reason) {
		super(reason);
		this.reason = reason;
	}
};
function skipped(reason) {
	return reason === "auth_rejected" ? {
		status: "skipped",
		reason,
		canRefresh: true
	} : {
		status: "skipped",
		reason
	};
}
function failure(error, fallback) {
	return skipped(error instanceof SafeFailure || error instanceof CredentialFailure ? error.reason : fallback);
}
function parseSessionInput(input) {
	if (Buffer.byteLength(input, "utf8") > MAX_SESSION_INPUT_BYTES) return {
		kind: "invalid",
		message: "The session JSON exceeds the 256 KiB limit."
	};
	const text = input.trim();
	if (!text) return {
		kind: "invalid",
		message: "Paste the complete session JSON response, including its braces."
	};
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		if (isToken(text) && !text.startsWith("{")) return {
			kind: "invalid",
			message: "Paste the complete session JSON response, including its braces."
		};
		return {
			kind: "invalid",
			message: "The session JSON is malformed. Copy the complete response again."
		};
	}
	if (!isRecord(value)) return {
		kind: "invalid",
		message: "The session JSON must be an object containing accessToken."
	};
	if (!isToken(value.accessToken)) return {
		kind: "invalid",
		message: "The session JSON must contain a valid accessToken string."
	};
	const accountId = isRecord(value.account) && isUuid(value.account.id) ? value.account.id : void 0;
	return {
		kind: "valid",
		session: {
			accessToken: value.accessToken,
			...accountId ? { accountId } : {}
		}
	};
}
async function acquireSessionLock(home) {
	const lock = path.join(home, LOCK_NAME);
	try {
		await mkdir(lock, { mode: 448 });
	} catch (error) {
		if (hasCode(error, "EEXIST")) throw new SafeFailure("credentials_busy");
		throw error;
	}
	return async () => {
		await rmdir(lock);
	};
}
async function saveSession(home, session) {
	try {
		await (await sessionFile(home)).close();
	} catch (error) {
		if (!(error instanceof CredentialFailure && error.reason === "credentials_missing")) throw error;
	}
	const temporary = path.join(home, `.chatgpt-session-${randomUUID()}.tmp`);
	const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
	try {
		try {
			await handle.chmod(384);
			await handle.writeFile(JSON.stringify(session) + "\n", "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, path.join(home, SESSION_NAME));
	} finally {
		await unlink(temporary).catch(() => void 0);
	}
}
async function clearChatgptSession(home) {
	let release;
	try {
		await privateHome(home, false);
		release = await acquireSessionLock(home);
		await (await sessionFile(home)).close();
		await unlink(path.join(home, SESSION_NAME));
		return { status: "cleared" };
	} catch (error) {
		return failure(error, "storage_unavailable");
	} finally {
		await release?.().catch(() => void 0);
	}
}
function statusFailure(status) {
	if (status === 401) return "auth_rejected";
	if (status === 403 || status === 404) return "target_unavailable";
	if (status === 429) return "rate_limited";
	if (status >= 500) return "service_unavailable";
	return "response_invalid";
}
async function boundedBody(response, limit) {
	const advertised = response.headers.get("content-length");
	if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > limit)) {
		await response.body?.cancel().catch(() => void 0);
		throw new SafeFailure("response_too_large");
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > limit) throw new SafeFailure("response_too_large");
			chunks.push(next.value);
		}
		return Buffer.concat(chunks, size);
	} finally {
		await reader.cancel().catch(() => void 0);
	}
}
async function requestBytes(url, headers, dependencies, limit, json) {
	const abort = new AbortController();
	let timer;
	let cancel;
	const cancelled = new Promise((_resolve, reject) => {
		cancel = () => {
			abort.abort();
			reject(new SafeFailure("setup_cancelled"));
		};
		if (dependencies.signal?.aborted) cancel();
		else dependencies.signal?.addEventListener("abort", cancel, { once: true });
	});
	const deadline = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			abort.abort();
			reject(new SafeFailure("network_error"));
		}, dependencies.requestTimeoutMs ?? 2e4);
	});
	try {
		const work = async () => {
			const response = await (dependencies.fetch ?? globalThis.fetch)(url, {
				method: "GET",
				headers,
				redirect: "manual",
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal: abort.signal
			});
			if (response.redirected || response.status >= 300 && response.status < 400 || response.url !== "" && response.url !== url) {
				await response.body?.cancel().catch(() => void 0);
				throw new SafeFailure("response_redirected");
			}
			if (!response.ok) {
				await response.body?.cancel().catch(() => void 0);
				throw new SafeFailure(statusFailure(response.status));
			}
			const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
			if (json && !/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(contentType)) {
				await response.body?.cancel().catch(() => void 0);
				throw new SafeFailure("response_invalid");
			}
			return {
				bytes: await boundedBody(response, limit),
				contentType
			};
		};
		return await Promise.race([
			work(),
			deadline,
			cancelled
		]);
	} catch (error) {
		if (error instanceof SafeFailure) throw error;
		throw new SafeFailure("network_error");
	} finally {
		if (timer) clearTimeout(timer);
		if (cancel) dependencies.signal?.removeEventListener("abort", cancel);
		abort.abort();
	}
}
function sessionHeaders(session) {
	return {
		Accept: "application/json",
		Authorization: `Bearer ${session.accessToken}`,
		"X-Authorization": `Bearer ${session.accessToken}`,
		...session.accountId ? { "Chatgpt-Account-Id": session.accountId } : {}
	};
}
async function apiJson(url, session, dependencies, limit = MAX_JSON_BYTES) {
	if (new URL(url).origin !== "https://chatgpt.com" || !url.startsWith(`https://chatgpt.com/backend-api/`)) throw new SafeFailure("input_invalid");
	const response = await requestBytes(url, sessionHeaders(session), dependencies, limit, true);
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes));
	} catch {
		throw new SafeFailure("response_invalid");
	}
}
function validProbe(raw) {
	return isRecord(raw) && Array.isArray(raw.items) && raw.items.every((item) => isRecord(item) && isUuid(item.id) && typeof item.title === "string") && typeof raw.limit === "number" && Number.isSafeInteger(raw.limit) && raw.limit >= 0 && typeof raw.offset === "number" && Number.isSafeInteger(raw.offset) && raw.offset >= 0 && (raw.total === null || typeof raw.total === "number" && Number.isSafeInteger(raw.total) && raw.total >= 0);
}
function setupHtml(csrf, error) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Configure ChatGPT conversation capture</title><style nonce="${csrf}">body{font:16px system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5}label{display:block;margin:1rem 0}input[type=password],input[type=text]{display:block;width:100%;box-sizing:border-box;padding:.65rem}button{padding:.65rem 1rem;margin-right:1rem}small{display:block}</style></head><body>
<h1>Optional ChatGPT conversation capture</h1>
<p>Paste the complete ChatGPT session JSON response here. Only the access token and an optional account ID are saved in an owner-only local file after validation. It is separate from Vercel settings.</p>
<p>In your own signed-in browser, open <a href="https://chatgpt.com/api/auth/session?utm_source=chatgpt.com" target="_blank" rel="noreferrer noopener">your ChatGPT session</a> and copy the entire JSON response into this form, including its braces. Do not send the response or token to an agent.</p>
<p>Enabling this option allows later explicitly requested publications to attach the ChatGPT conversation selected by trusted host context or a private URL.</p>
<p id="archive-disclosure">To resume work in a new agent session, provide the downloaded archive as context.
<strong>The archive includes the full, unredacted conversation JSON.</strong>
It can include conversation branches, tool arguments, and sensitive information. The raw JSON and a readable HTML copy will be available to your site's audience without asking again. Share only conversations you intend this audience to see.</p>
<p>Run the clear command to disable future attachments. Cancelling preserves any existing authorization.</p>
${error ? `<p role="alert">${error} Existing settings were preserved. You can try again below.</p>` : ""}
<form method="post" action="/session" autocomplete="off">
<input type="hidden" name="csrf" value="${csrf}">
<label>Complete ChatGPT session JSON response<input type="password" name="sessionJson" required maxlength="${MAX_SESSION_INPUT_BYTES}" autocomplete="off" spellcheck="false"></label>
<label><input type="checkbox" name="consent" value="yes" required aria-describedby="archive-disclosure"> Allow conversation archive attachments on later explicitly requested publications to the site's audience.</label>
<button type="submit">Validate and enable conversation sharing</button>
</form>
<form method="post" action="/cancel"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Cancel capture setup</button></form>
<p><small>Paste the session JSON only into this local form. Never paste it into a chat, command argument, environment variable, or tool form.</small></p>
</body></html>`;
}
function localResponse(response, status, csrf, body) {
	response.writeHead(status, {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store, max-age=0",
		Pragma: "no-cache",
		"Content-Security-Policy": `default-src 'none'; style-src 'nonce-${csrf}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
		"Referrer-Policy": "same-origin",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
		Connection: "close"
	});
	response.end(body);
}
async function formBody(request) {
	if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/x-www-form-urlencoded") throw new SafeFailure("input_invalid");
	const advertised = request.headers["content-length"];
	if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_FORM_BYTES)) throw new SafeFailure("input_invalid");
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		if (!(chunk instanceof Buffer)) throw new SafeFailure("input_invalid");
		size += chunk.byteLength;
		if (size > MAX_FORM_BYTES) throw new SafeFailure("input_invalid");
		chunks.push(chunk);
	}
	return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
}
function singleHeader(request, name) {
	let count = 0;
	for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === name) count += 1;
	return count === 1;
}
async function startChatgptSetup(home, dependencies = {}) {
	let release;
	try {
		await privateHome(home, true);
		release = await acquireSessionLock(home);
	} catch (error) {
		return failure(error, "storage_unavailable");
	}
	const csrf = randomBytes(32).toString("hex");
	let state = "waiting";
	let resolveCompletion = () => void 0;
	const completion = new Promise((resolve) => {
		resolveCompletion = resolve;
	});
	let timer;
	let host = "";
	let origin = "";
	const setupAbort = new AbortController();
	const currentState = () => state;
	const finish = (result) => {
		if (state === "finished") return;
		state = "finished";
		if (timer) clearTimeout(timer);
		setupAbort.abort();
		server.close();
		server.closeIdleConnections();
		setImmediate(() => server.closeAllConnections());
		release?.().catch(() => void 0).finally(() => resolveCompletion(result));
	};
	const server = createServer((request, response) => {
		request.setTimeout(5e3, () => request.destroy());
		(async () => {
			if (!singleHeader(request, "host") || request.headers.host !== host) {
				localResponse(response, 400, csrf, "Invalid local request.");
				return;
			}
			if (request.method === "GET" && request.url?.split("?", 1)[0] === `/setup/${csrf}`) {
				localResponse(response, 200, csrf, setupHtml(csrf));
				return;
			}
			if (request.method !== "POST" || request.url !== "/session" && request.url !== "/cancel" || !singleHeader(request, "origin") || request.headers.origin !== origin || request.headers["sec-fetch-site"] !== void 0 && request.headers["sec-fetch-site"] !== "same-origin") {
				localResponse(response, 403, csrf, "Invalid local request.");
				return;
			}
			const form = await formBody(request);
			if (form.getAll("csrf").length !== 1 || form.get("csrf") !== csrf) {
				localResponse(response, 403, csrf, "Invalid local request.");
				return;
			}
			if (state === "committing" || state === "finished" || state === "validating" && request.url !== "/cancel") {
				localResponse(response, 409, csrf, "A setup request is already being processed.");
				return;
			}
			if (request.url === "/cancel") {
				response.once("finish", () => finish(skipped("setup_cancelled")));
				localResponse(response, 200, csrf, "Setup cancelled. Existing settings were preserved. You may close this tab.");
				return;
			}
			if (form.getAll("sessionJson").length !== 1 || form.has("token") || form.has("accountId") || form.getAll("consent").length !== 1 || form.get("consent") !== "yes") {
				localResponse(response, 400, csrf, setupHtml(csrf, "Submit one complete session JSON response and allow conversation sharing."));
				return;
			}
			const parsed = parseSessionInput(form.get("sessionJson") ?? "");
			if (parsed.kind === "invalid") {
				localResponse(response, 400, csrf, setupHtml(csrf, parsed.message));
				return;
			}
			state = "validating";
			const candidate = {
				schemaVersion: 1,
				...parsed.session,
				archivePublicationOptIn: true,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
			let result;
			try {
				if (!validProbe(await apiJson(PROBE_URL, candidate, {
					...dependencies,
					signal: setupAbort.signal
				}, 1048576))) throw new SafeFailure("response_invalid");
				if (currentState() !== "validating") return;
				state = "committing";
				if (timer) clearTimeout(timer);
				await saveSession(home, candidate);
				result = safeStatus(candidate);
			} catch (error) {
				if (currentState() === "finished") return;
				result = failure(error, "storage_unavailable");
			}
			response.once("finish", () => finish(result));
			localResponse(response, result.status === "configured" ? 200 : 400, csrf, result.status === "configured" ? "ChatGPT capture settings saved. You may close this tab." : "The candidate could not be validated or saved. Existing settings were preserved. You may close this tab.");
		})().catch(() => {
			if (!response.headersSent) localResponse(response, 400, csrf, setupHtml(csrf, "The local form could not be read. Submit a complete session JSON response within the size limit."));
			else response.end();
		});
	});
	server.headersTimeout = 5e3;
	server.requestTimeout = 1e4;
	server.maxHeadersCount = 30;
	try {
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (address === null || typeof address === "string") throw new SafeFailure("storage_unavailable");
		host = `127.0.0.1:${address.port}`;
		origin = `http://${host}`;
		timer = setTimeout(() => {
			if (state !== "committing") finish(skipped("setup_timeout"));
		}, dependencies.setupTimeoutMs ?? 3e5);
		return {
			url: `${origin}/setup/${csrf}`,
			completion,
			cancel: () => {
				if (state !== "committing") finish(skipped("setup_cancelled"));
			}
		};
	} catch (error) {
		server.close();
		await release().catch(() => void 0);
		return failure(error, "storage_unavailable");
	}
}
function containsSecret(raw, token) {
	const pending = [raw];
	while (pending.length) {
		const value = pending.pop();
		if (typeof value === "string" && value.includes(token)) return true;
		if (Array.isArray(value)) for (const item of value) pending.push(item);
		else if (isRecord(value)) for (const [key, item] of Object.entries(value)) {
			if (key === "accessToken" || key.includes(token)) return true;
			pending.push(item);
		}
	}
	return false;
}
function rasterMatches(bytes, contentType) {
	switch (contentType) {
		case "image/png": return bytes.subarray(0, 8).equals(Buffer.from([
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		]));
		case "image/jpeg": return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
		case "image/gif": return /^(GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString("ascii"));
		case "image/webp": return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
		default: return false;
	}
}
function safeAssetUrl(raw, token) {
	let decoded = raw;
	for (let depth = 0; depth < 4; depth += 1) {
		if (decoded.includes(token)) throw new SafeFailure("credential_leak");
		let next;
		try {
			next = decodeURIComponent(decoded);
		} catch {
			return;
		}
		if (next === decoded) break;
		if (depth === 3) return void 0;
		decoded = next;
	}
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !(url.hostname === "oaiusercontent.com" || url.hostname.endsWith(".oaiusercontent.com"))) return void 0;
		return url.href;
	} catch {
		return;
	}
}
async function resolveImage(pointer, session, dependencies) {
	if (pointer.startsWith("data:")) {
		const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(pointer);
		if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return void 0;
		const bytes = Buffer.from(match[2], "base64");
		if (bytes.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "")) return void 0;
		return rasterMatches(bytes, match[1]) ? {
			bytes,
			contentType: match[1]
		} : void 0;
	}
	const match = /^(?:sediment|file-service):\/\/([A-Za-z0-9_-]{1,160})$/.exec(pointer);
	if (!match) return void 0;
	const details = await apiJson(`${CHATGPT_ORIGIN}/backend-api/files/download/${encodeURIComponent(match[1])}?post_id=&inline=false`, session, dependencies, 65536);
	if (!isRecord(details) || details.status === "error" || typeof details.download_url !== "string") return void 0;
	const url = safeAssetUrl(details.download_url, session.accessToken);
	if (!url) return void 0;
	const asset = await requestBytes(url, { Accept: "image/png,image/jpeg,image/gif,image/webp" }, dependencies, MAX_IMAGE_BYTES, false);
	if (!rasterMatches(asset.bytes, asset.contentType)) return void 0;
	return asset;
}
async function captureChatgptConversation(options, dependencies = {}) {
	const id = options.context.conversationId;
	try {
		const session = await readSession(options.home);
		if (session.archivePublicationOptIn !== true) return skipped("publication_not_enabled");
		const raw = await apiJson(`${CHATGPT_ORIGIN}/backend-api/conversation/${id}`, session, dependencies);
		if (containsSecret(raw, session.accessToken)) throw new SafeFailure("credential_leak");
		let conversation;
		try {
			conversation = validateConversation(raw, id);
		} catch {
			throw new SafeFailure("response_invalid");
		}
		const images = /* @__PURE__ */ new Map();
		const warnings = /* @__PURE__ */ new Set();
		const pointers = conversationImageReferences(conversation);
		let imageBytes = 0;
		for (const [index, pointer] of pointers.entries()) {
			if (index >= MAX_IMAGES) {
				warnings.add("image_limit_exceeded");
				continue;
			}
			try {
				const asset = await resolveImage(pointer, session, dependencies);
				if (!asset) {
					warnings.add("image_unavailable");
					continue;
				}
				if (asset.bytes.includes(Buffer.from(session.accessToken))) throw new SafeFailure("credential_leak");
				imageBytes += asset.bytes.length;
				if (imageBytes > MAX_IMAGE_TOTAL_BYTES) {
					warnings.add("image_limit_exceeded");
					continue;
				}
				images.set(pointer, `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`);
			} catch (error) {
				if (error instanceof SafeFailure && error.reason === "credential_leak") throw error;
				warnings.add("image_unavailable");
			}
		}
		let rendered;
		try {
			rendered = renderConversation(conversation, { images });
		} catch {
			throw new SafeFailure("response_invalid");
		}
		const json = Buffer.from(JSON.stringify([raw], null, 2) + "\n", "utf8");
		if (json.length > MAX_JSON_BYTES || rendered.html.length > MAX_HTML_BYTES) throw new SafeFailure("response_too_large");
		if (json.includes(Buffer.from(session.accessToken)) || rendered.html.includes(Buffer.from(session.accessToken))) throw new SafeFailure("credential_leak");
		for (const warning of rendered.warnings) warnings.add(warning);
		return {
			status: "captured",
			bundle: await writeConversationBundle(options.home, {
				json,
				html: rendered.html
			}),
			warnings: [...warnings].sort()
		};
	} catch (error) {
		return failure(error, "storage_unavailable");
	}
}
// src/node/home.ts
const defaultHome = () => join(homedir(), ".agents", ".mark");
function amHome(env = process.env) {
	return env.AM_HOME || defaultHome();
}
// src/node/chatgpt-host-context.ts
const MAX_CONTEXT_BYTES = 16384;
async function readHostContext(input) {
	if (input.isTTY) return { status: "invalid" };
	const chunks = [];
	let size = 0;
	try {
		for await (const chunk of input) {
			if (!(chunk instanceof Buffer)) return { status: "invalid" };
			size += chunk.length;
			if (size > MAX_CONTEXT_BYTES) return { status: "invalid" };
			chunks.push(chunk);
		}
		return {
			status: "received",
			value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)))
		};
	} catch {
		return { status: "invalid" };
	}
}
// src/node/chatgpt.ts
function output(result) {
	process.stdout.write(JSON.stringify(result) + "\n");
}
async function main() {
	const [command, ...args] = process.argv.slice(2);
	let conversation;
	let json = false;
	let hostContext = false;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--json" && !json) json = true;
		else if (argument === "--host-context" && !hostContext) hostContext = true;
		else if (argument === "--conversation" && conversation === void 0 && args[index + 1] !== void 0 && !args[index + 1].startsWith("--")) conversation = args[++index];
		else {
			output({
				status: "skipped",
				reason: "input_invalid"
			});
			process.exitCode = 2;
			return;
		}
	}
	if (command !== "capture" && (conversation !== void 0 || hostContext)) {
		output({
			status: "skipped",
			reason: "input_invalid"
		});
		process.exitCode = 2;
		return;
	}
	const home = resolve(amHome());
	switch (command) {
		case "status":
			output(await chatgptStatus(home));
			return;
		case "clear":
			output(await clearChatgptSession(home));
			return;
		case "capture": {
			const host = hostContext ? await readHostContext(process.stdin) : void 0;
			if (host?.status === "invalid") {
				output({
					status: "skipped",
					reason: "conversation_context_invalid"
				});
				return;
			}
			const selected = resolveConversationContext({
				explicit: conversation,
				hostContext: host?.value
			});
			if (selected.status === "unresolved") {
				output({
					status: "skipped",
					reason: selected.reason
				});
				return;
			}
			output(await captureChatgptConversation({
				home,
				context: selected.context
			}));
			return;
		}
		case "setup": {
			const setup = await startChatgptSetup(home);
			if ("status" in setup) {
				output(setup);
				return;
			}
			output({
				event: "setup_ready",
				url: setup.url
			});
			process.once("SIGINT", setup.cancel);
			process.once("SIGTERM", setup.cancel);
			const result = await setup.completion;
			process.removeListener("SIGINT", setup.cancel);
			process.removeListener("SIGTERM", setup.cancel);
			output(result);
			return;
		}
		default:
			output({
				status: "skipped",
				reason: "input_invalid"
			});
			process.exitCode = 2;
	}
}
main().catch(() => {
	output({
		status: "skipped",
		reason: "storage_unavailable"
	});
	process.exitCode = 1;
});
export {};
