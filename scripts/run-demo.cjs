// Runs the compiled context demo, mapping the "@/..." path alias to the
// compiled ./demo-build/src tree so Node can resolve it at runtime.
const path = require("path");
const Module = require("module");

const OUT = path.resolve(__dirname, "..", ".demo-build");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@" || request.startsWith("@/")) {
    request = path.join(OUT, "src", request.slice(2));
  }
  return orig.call(this, request, ...rest);
};

require(path.join(OUT, "scripts", "context-demo.js"));
