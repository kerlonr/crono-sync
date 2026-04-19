const http = require("http");
const { spawn } = require("child_process");

const PORT = Number.parseInt(process.env.DEPLOYER_PORT || "8081", 10);
const DEPLOYER_SECRET = process.env.DEPLOYER_SECRET || "";
const DEPLOY_SCRIPT =
  process.env.WEBHOOK_DEPLOY_SCRIPT || "/app/scripts/webhook-deploy.sh";

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
  log("deployer_started", { port: PORT });
});

function handleDeploy(request, response) {
  if (!isAuthorized(request)) {
    response.writeHead(401, { "content-type": "text/plain" });
    response.end("Unauthorized");
    return;
  }

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

      log("deploy_started", {
        branch,
        repository,
        script: DEPLOY_SCRIPT,
        pid: activeProcess.pid || "unknown",
      });

      activeProcess.stdout.on("data", (chunk) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (line.trim()) {
            log("deploy_stdout", { line: line.trim() });
          }
        }
      });

      activeProcess.stderr.on("data", (chunk) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (line.trim()) {
            log("deploy_stderr", { line: line.trim() });
          }
        }
      });

      activeProcess.on("close", (code, signal) => {
        log("deploy_finished", {
          code: code ?? "null",
          signal: signal || "none",
        });
        activeProcess = null;
      });

      activeProcess.on("error", (error) => {
        log("deploy_error", {
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

function isAuthorized(request) {
  if (!DEPLOYER_SECRET) {
    return true;
  }

  return request.headers["x-deployer-secret"] === DEPLOYER_SECRET;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
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

function log(event, details) {
  const timestamp = new Date().toISOString();
  const serializedDetails = Object.entries(details)
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`)
    .join(" ");

  console.log(
    `[${timestamp}] ${event}${serializedDetails ? ` ${serializedDetails}` : ""}`,
  );
}
