#!/usr/bin/env node
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const USAGE =
	"run_graded.mjs --runner <cmd> --raw <path> --out <path> --testfile <path> [--cleanup <cmd>] [--deadline <seconds>]";

const argv = process.argv.slice(2);
const o = {};
for (let i = 0; i < argv.length; i++) {
	if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[++i];
}
if (!o.runner || !o.raw || !o.out || !o.testfile) {
	console.error(USAGE);
	process.exit(1);
}

const here = path.dirname(new URL(import.meta.url).pathname);
const normalizer = path.join(here, "normalize-report.mjs");

for (const target of [o.raw, o.out]) {
	try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch { /* fine */ }
}

try { fs.unlinkSync(o.raw); } catch { /* not present */ }

const logFile = o.out + ".log";
try { fs.unlinkSync(logFile); } catch { /* not present */ }

const inner = o.cleanup ? `{ ${o.runner} ; } ; ${o.cleanup}` : o.runner;
const run = spawnSync("sh", ["-c", `{ ${inner} ; } > ${JSON.stringify(logFile)} 2>&1`], {
	stdio: "ignore",
	env: { ...process.env, PY_COLORS: "1", FORCE_COLOR: "1" },
	timeout: Number(o.deadline || 600) * 1000,
	killSignal: "SIGKILL",
});
const runStatus = run.status === null ? "killed:" + String(run.signal) : run.status;

if (o.cleanup) {
	try { execSync(o.cleanup, { stdio: "ignore" }); } catch { /* best effort */ }
}

let captured = "";
try { captured = fs.readFileSync(logFile, "utf8"); } catch { /* nothing captured */ }
try { fs.unlinkSync(logFile); } catch { /* fine */ }

const norm = spawnSync(
	"node",
	[normalizer, o.raw, "--testfile", o.testfile, "--out", o.out, "--stats", o.out + ".stats"],
	{ encoding: "utf8" },
);

let changed = true;
let before = null;
let invalid = 0;
let statsRaw = "";
try {
	statsRaw = fs.readFileSync(o.out + ".stats", "utf8");
	const stats = JSON.parse(statsRaw);
	changed = stats.changed;
	before = stats.before;
	invalid = stats.invalid || 0;
} catch { /* assume changed if unknown */ }
if (process.env.HARNESS_DEBUG) {
	console.error("[wrapper] normalizer rc=" + norm.status);
	console.error("[wrapper] normalizer stderr=" + (norm.stderr || "").slice(0, 300));
	console.error("[wrapper] stats=" + (statsRaw || "<unreadable>"));
	console.error("[wrapper] decision=" + (changed ? "RENDER" : "REPLAY NATIVE"));
}
try { fs.unlinkSync(o.out + ".stats"); } catch { /* fine */ }
if (fs.existsSync(o.out)) {
	try { fs.unlinkSync(o.raw); } catch { /* fine */ }
}

let written = 0;

function writeOut(text) {
	if (!text) return;
	const buf = Buffer.from(text, "utf8");
	let off = 0;
	while (off < buf.length) {
		try {
			const n = fs.writeSync(1, buf, off, buf.length - off);
			off += n;
			written += n;
		} catch (e) {
			if (e.code === "EAGAIN") continue;
			if (e.code === "EPIPE") return;
			throw e;
		}
	}
}

let render = { stdout: "", stderr: "", status: null };
if (changed) {
	render = spawnSync("node", [path.join(here, "render_report.mjs"), o.out], {
		encoding: "utf8",
	});
}

if (!changed) {
	writeOut(captured);
} else {
	const untrustworthy = before === 0 || invalid > 0;
	if (untrustworthy && captured.trim()) {
		writeOut(captured.endsWith("\n") ? captured : captured + "\n");
	}
	writeOut(render.stdout || captured);
}

if (!fs.existsSync(o.out)) {
	writeOut([
		"",
		"The scored report was not written: " + o.out,
		"  normalizer exit   : " + String(norm.status),
		"  normalizer stderr : " + String(norm.stderr || "").trim().slice(0, 800),
		"  raw report        : " + (fs.existsSync(o.raw) ? "present" : "absent") + " (" + o.raw + ")",
		"",
	].join("\n"));
} else if (written === 0) {
	const lines = [
		"",
		"The test run produced no readable output. Details for the reviewer:",
		"  runner exit        : " + String(runStatus),
		"  runner log bytes   : " + String(captured.length),
		"  raw report         : " + (fs.existsSync(o.raw) ? "present" : "absent") + " (" + o.raw + ")",
		"  scored report      : " + (fs.existsSync(o.out) ? "present" : "absent") + " (" + o.out + ")",
		"  normalizer exit    : " + String(norm.status),
		"  normalizer stderr  : " + String(norm.stderr || "").trim().slice(0, 500),
		"  renderer exit      : " + String(render.status),
		"  renderer stderr    : " + String(render.stderr || "").trim().slice(0, 500),
		"",
	];
	writeOut(lines.join("\n"));
}

process.exitCode = 0;
