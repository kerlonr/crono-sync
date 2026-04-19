const http = require("http");
const { spawn } = require("child_process");
const { getLogFile, logEvent } = require("../src/logger");

const PORT = Number.parseInt(process.env.DEPLOYER_PORT || "8081", 10);
const DEPLOY_SCRIPT =
  process.env.WEBHOOK_DEPLOY_SCRIPT || "/app/scripts/webhook-deploy.sh";
const MAX_BODY_BYTES = 32 * 1024;

let activeProcess = null;

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/deploy") {
    return handleDeploy(request, response);
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, busy: Boolean(activeProcess) }));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("Not Found");
});

server.listen(PORT, () => {
  logEvent("deployer_started", { port: PORT, file: getLogFile() });
});

function handleDeploy(request, response) {
  if (activeProcess) {
    response.writeHead(202, { "content-type": "text/plain" });
    response.end("Deploy already running");
    return;
  }

  readJsonBody(request)
    .then((payload) => {
      const branch =
        typeof payload?.branch === "string" ? payload.branch : "main";
      const repository =
        typeof payload?.repository === "string"
          ? payload.repository
          : "unknown";

      activeProcess = spawn("/bin/sh", [DEPLOY_SCRIPT], {
        cwd: "/app",
        env: {
          ...process.env,
          WEBHOOK_DEPLOY_BRANCH: branch,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      logEvent("deploy_started", {
        branch,
        repository,
        script: DEPLOY_SCRIPT,
        pid: activeProcess.pid || "unknown",
      });

      activeProcess.stdout.on("data", (chunk) => {
        logOutputLines("deploy_stdout", chunk);
      });

      activeProcess.stderr.on("data", (chunk) => {
        logOutputLines("deploy_stderr", chunk);
      });

      activeProcess.on("close", (code, signal) => {
        logEvent("deploy_finished", {
          code: code ?? "null",
          signal: signal || "none",
        });
        activeProcess = null;
      });

      activeProcess.on("error", (error) => {
        logEvent("deploy_error", {
          message: error.message,
        });
        activeProcess = null;
      });

      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true }));
    })
    .catch(() => {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Invalid payload");
    });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function logOutputLines(event, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (text) {
      logEvent(event, { line: text });
    }
  }
}
