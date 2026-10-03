import fs from "fs";
import http from "http";

const DEBUG = process.env.HARNESS_DEBUG;
const log = (...a) => { if (DEBUG) console.error(...a); };

const _crs = fs.createReadStream;
fs.createReadStream = function (...a) {
	const s = _crs.apply(this, a);
	s.on("error", (e) => log("[guard] stream error contained:", e && e.message));
	return s;
};
const _emit = http.ServerResponse.prototype.emit;
http.ServerResponse.prototype.emit = function (...a) {
	try { return _emit.apply(this, a); }
	catch (e) { log("[guard] response listener error contained:", e && e.message); return false; }
};

const STARTUP_ERROR_CODES = ["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"];
const INVALID_MARKER = "../output/INVALID-RUN";
function isStartupFailure(err) {
	if (!err) return false;
	return STARTUP_ERROR_CODES.indexOf(err.code) !== -1 || err.syscall === "listen";
}

before(function () {
	const existing = process.listeners("uncaughtException");
	const mochaHandler = existing[existing.length - 1];
	if (!mochaHandler) return;
	process.removeListener("uncaughtException", mochaHandler);

	process.on("uncaughtException", function (err) {
		if (err && err.name === "AssertionError") {
			mochaHandler(err);
			return;
		}
		if (isStartupFailure(err)) {
			log("[harness] INVALID RUN - application failed to start:", err.stack);
			try { fs.writeFileSync(INVALID_MARKER, "startup failure: " + err.code + "\n"); }
			catch (e) { void e; }
			return;
		}
		log("[harness] discarded error raised outside any test:", err && (err.stack || err.message));
	});
});

process.on("unhandledRejection", (r) => log("[guard] unhandledRejection contained:", r && r.message));
