#!/usr/bin/env node
import fs from "fs";

const USAGE = "render_report.mjs <normalized.xml>";

const path = process.argv[2];
if (!path) {
	console.error(USAGE);
	process.exit(1);
}

const x = fs.readFileSync(path, "utf8");
const suite = (/<testsuite\b[^>]*?\bname="([^"]*)"/.exec(x) || [null, ""])[1];

const cases = [];
const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
let m;
while ((m = re.exec(x)) !== null) {
	const attrs = m[1];
	const body = m[3] || "";
	const name = (/\bname="([^"]*)"/.exec(attrs) || [null, ""])[1];
	const failed = body.includes("<failure") || body.includes("<error");
	const msg = (/<(?:failure|error)[^>]*message="([^"]*)"/.exec(msgSource(body)) || [null, ""])[1];
	const detail = (/<(?:failure|error)[^>]*>([\s\S]*?)<\/(?:failure|error)>/.exec(body) || [null, ""])[1];
	cases.push({ name, failed, msg: unesc(msg), detail: unesc(stripCdata(detail)) });
}

function msgSource(b) { return b; }
function stripCdata(s) { return s.replace(/<!\[CDATA\[|\]\]>/g, ""); }
function unesc(s) {
	return String(s)
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"').replace(/&#10;/g, "\n")
		.replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

const prefix = suite ? suite + " " : "";
const short = (n) => (prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n);

console.log("");
if (suite) console.log(`  ${suite}`);
let failIdx = 0;
for (const c of cases) {
	if (c.failed) {
		failIdx += 1;
		console.log(`    ${failIdx}) ${short(c.name)}`);
	} else {
		console.log(`    ✓ ${short(c.name)}`);
	}
}

const passed = cases.filter((c) => !c.failed).length;
const failed = cases.length - passed;
console.log("");
console.log(`  ${passed} passing`);
if (failed) console.log(`  ${failed} failing`);
console.log("");

failIdx = 0;
for (const c of cases) {
	if (!c.failed) continue;
	failIdx += 1;
	console.log(`  ${failIdx}) ${suite}`);
	console.log(`       ${short(c.name)}:`);
	const text = (c.detail && c.detail.trim()) || c.msg || "test failed";
	for (const line of text.split("\n")) console.log(`      ${line}`);
	console.log("");
}
