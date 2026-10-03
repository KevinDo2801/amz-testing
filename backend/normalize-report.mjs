#!/usr/bin/env node
import fs from "fs";

const USAGE =
	"usage: node normalize-report.mjs <xml> [--testfile f] [--manifest f] [--out f]";

const RUNNER_TIMEOUT_RE =
	/Timeout of \d+ms exceeded|Failed: Timeout >|TimeoutException|timed out after/;

const FOREIGN_MESSAGE_MARKERS = [
	"failed on teardown with",
	"failed on setup with",
	"done() called multiple times",
];

function suiteNameFrom(path) {
	let x;
	try {
		x = fs.readFileSync(path, "utf8");
	} catch {
		return null;
	}
	const re = /<testsuite\b[^>]*?\bname="([^"]*)"/g;
	let m;
	while ((m = re.exec(x)) !== null) {
		const n = m[1].trim();
		if (n && n.toLowerCase() !== "root suite") return n;
	}
	const outer = /<testsuites\b[^>]*?\bname="([^"]*)"/.exec(x);
	if (outer && outer[1].trim()) return outer[1].trim();
	return null;
}

function parse(path) {
	let x;
	try {
		x = fs.readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const cases = [];
	const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
	let m;
	while ((m = re.exec(x)) !== null) {
		const attrs = m[1];
		const body = m[3] || "";
		const nm = /\bname="([^"]*)"/.exec(attrs);
		const cn = /classname="([^"]*)"/.exec(attrs);
		const failed =
			body.includes("<failure") ||
			body.includes("<error") ||
			attrs.includes("failure=") ||
			attrs.includes("error=");
		const mm = /<(?:failure|error)[^>]*message="([^"]*)"/.exec(body);
		cases.push({
			name: nm ? nm[1] : "",
			cls: cn ? cn[1] : "",
			failed,
			msg: mm ? mm[1] : "",
			body,
		});
	}
	return cases;
}

function javaManifest(src) {
	const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(src);
	const cm = /^\s*(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)/m.exec(src);
	const cls = pkg && cm ? `${pkg[1]}.${cm[1]}` : cm ? cm[1] : "";
	const names = [];
	let pending = false;
	for (const line of src.split("\n")) {
		const t = line.trim();
		if (t.startsWith("@Test")) {
			pending = true;
			continue;
		}
		if (pending) {
			if (t.startsWith("@") || !t) continue;
			const m = /\b(\w+)\s*\(/.exec(t);
			if (m) {
				names.push(m[1]);
				pending = false;
			}
		}
	}
	return names.map((n) => ({ cls, name: n }));
}

function manifestFromTestfile(path) {
	const src = fs.readFileSync(path, "utf8");
	if (path.endsWith(".java")) return javaManifest(src);
	if (path.endsWith(".py")) {
		const parts = path.replace(/\\/g, "/").split("/");
		const stem = parts[parts.length - 1].slice(0, -3);
		const module =
			parts.length >= 2 ? `${parts[parts.length - 2]}.${stem}` : stem;
		const cm = /^\s*class\s+(\w+)/m.exec(src);
		const prefix = cm ? `${module}.${cm[1]}` : module;
		const names = [...src.matchAll(/^\s*def\s+(test_\w+)\s*\(/gm)].map((x) => x[1]);
		return names.map((n) => ({ cls: prefix, name: n }));
	}
	const dm = /describe\(\s*['"]([^'"]+)['"]/.exec(src);
	const suite = dm ? dm[1] : "";
	const its = [...src.matchAll(/\bit\(\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
	return its.map((t) => ({ cls: t, name: `${suite} ${t}`.trim() }));
}

function isPhantom(c) {
	const n = c.name.toLowerCase();
	return n.includes("outside test suite") || n.includes("uncaught error outside");
}

function isForeign(c, suiteBasename) {
	if (!c.failed) return false;
	const text = `${c.msg || ""} ${c.body || ""}`;
	if (FOREIGN_MESSAGE_MARKERS.some((mk) => text.includes(mk))) return true;
	if (RUNNER_TIMEOUT_RE.test(text)) return false;
	if (suiteBasename) {
		if ((c.body || "").includes(suiteBasename)) return false;
		const stackLines = (c.body || "").match(/^[ \t]*at\s+\S.*/gm) || [];
		if (stackLines.length && !stackLines.some((l) => l.includes(suiteBasename)))
			return true;
	}
	return false;
}

export function changedAnything(stats) {
	return stats.droppedPhantom > 0 || stats.collapsed > 0 ||
		stats.discardedForeign > 0 || stats.invalid > 0 ||
		stats.before !== stats.after;
}

function normalize(cases, manifest = null, suiteBasename = null) {
	const before = cases.length;
	const real = cases.filter((c) => !isPhantom(c));
	const droppedPhantom = before - real.length;

	let canonical;
	if (manifest) {
		canonical = manifest;
	} else {
		const seen = new Set();
		canonical = [];
		for (const c of real) {
			if (!seen.has(c.name)) {
				seen.add(c.name);
				canonical.push({ cls: c.cls, name: c.name });
			}
		}
	}

	const out = [];
	let collapsed = 0,
		discardedForeign = 0,
		invalid = 0;
	const invalidReasons = [];

	for (const entry of canonical) {
		const occ = real.filter((c) => c.name === entry.name);
		if (occ.length === 0) {
			out.push({
				name: entry.name,
				cls: entry.cls,
				passed: false,
				invalid: true,
				msg: "did not execute (build failure, crash, or timeout)",
			});
			invalid += 1;
			invalidReasons.push(`${entry.name}: never executed`);
			continue;
		}

		const passedOcc = occ.filter((c) => !c.failed);
		const failingOcc = occ.filter((c) => c.failed);
		const keptFailures = failingOcc.filter((c) => !isForeign(c, suiteBasename));
		discardedForeign += failingOcc.length - keptFailures.length;
		if (occ.length > 1) collapsed += occ.length - 1;

		if (passedOcc.length) {
			const keep = passedOcc[0];
			out.push({
				name: entry.name,
				cls: entry.cls || keep.cls,
				passed: true,
				invalid: false,
				msg: keep.msg,
			});
		} else if (keptFailures.length) {
			const keep = keptFailures[0];
			out.push({
				name: entry.name,
				cls: entry.cls || keep.cls,
				passed: false,
				invalid: false,
				msg: keep.msg,
			});
		} else {
			out.push({
				name: entry.name,
				cls: entry.cls || failingOcc[0].cls,
				passed: false,
				invalid: true,
				msg: "INVALID: test reported errors unrelated to its own assertions",
			});
			invalid += 1;
			invalidReasons.push(`${entry.name}: only foreign failures observed`);
		}
	}

	const stats = {
		before,
		after: out.length,
		droppedPhantom,
		collapsed,
		discardedForeign,
		invalid,
		invalidReasons,
		passed: out.filter((o) => o.passed).length,
		failed: out.filter((o) => !o.passed && !o.invalid).length,
	};
	return { out, stats };
}

const escapeXml = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const quoteAttr = (s) => `"${escapeXml(s).replace(/"/g, "&quot;")}"`;

function toXml(out, stats, suite = "Normalized") {
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<testsuites name=${quoteAttr(suite)} tests="${stats.after}" failures="${stats.failed}" errors="${stats.invalid}">`,
		`  <testsuite name=${quoteAttr(suite)} tests="${stats.after}" failures="${stats.failed}" errors="${stats.invalid}">`,
	];
	for (const o of out) {
		const cls = o.cls || o.name;
		const head = `    <testcase classname=${quoteAttr(cls)} name=${quoteAttr(o.name)}`;
		if (o.passed) {
			lines.push(`${head}/>`);
		} else {
			const tag = o.invalid ? "error" : "failure";
			lines.push(
				`${head}>`,
				`      <${tag} message=${quoteAttr(o.msg || "test failed")}>${escapeXml(o.msg || "")}</${tag}>`,
				"    </testcase>",
			);
		}
	}
	lines.push("  </testsuite>", "</testsuites>");
	return `${lines.join("\n")}\n`;
}

const argv = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
	if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[++i];
	else positional.push(argv[i]);
}
if (!positional.length) {
	console.error(USAGE);
	process.exit(1);
}

let manifest = null;
let suiteBasename = null;
if (opts.testfile) {
	manifest = manifestFromTestfile(opts.testfile);
	suiteBasename = opts.testfile.replace(/\\/g, "/").split("/").pop();
} else if (opts.manifest) {
	manifest = [];
	for (const raw of fs.readFileSync(opts.manifest, "utf8").split("\n")) {
		const l = raw.replace(/\n$/, "");
		if (!l.trim()) continue;
		const idx = l.indexOf("\t");
		const cls = idx === -1 ? l : l.slice(0, idx);
		const name = idx === -1 ? "" : l.slice(idx + 1);
		manifest.push({ cls, name: name || cls });
	}
}

const suite = suiteNameFrom(positional[0]) || "Normalized";
const { out, stats } = normalize(parse(positional[0]), manifest, suiteBasename);
console.log(
	`before=${stats.before} -> after=${stats.after} | dropped_phantom=${stats.droppedPhantom} ` +
		`collapsed=${stats.collapsed} discarded_foreign=${stats.discardedForeign} | ` +
		`${stats.passed} pass / ${stats.failed} fail / ${stats.invalid} invalid`,
);
if (opts.out) {
	const tmp = opts.out + ".tmp";
	fs.writeFileSync(tmp, toXml(out, stats, suite));
	fs.renameSync(tmp, opts.out);
	console.log(`wrote ${opts.out}`);
}
if (opts.stats) {
	fs.writeFileSync(opts.stats, JSON.stringify({ ...stats, changed: changedAnything(stats) }));
}
if (stats.invalid) {
	console.log("INVALID RUN — do not score as-is:");
	for (const r of stats.invalidReasons) console.log(`  - ${r}`);
	process.exit(2);
}
