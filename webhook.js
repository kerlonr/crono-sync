const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");

const SECRET = "uma-senha-qualquer"; // coloca a mesma no GitHub

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    // valida assinatura do GitHub
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    if (req.headers["x-hub-signature-256"] !== sig) {
      res.writeHead(401).end("Unauthorized");
      return;
    }

    res.writeHead(200).end("OK");
    console.log("Push detectado! Atualizando...");
    exec("git pull && docker compose up -d --build", (err, stdout, stderr) => {
      if (err) console.error(stderr);
      else console.log(stdout);
    });
  });
});

server.listen(9000, () => console.log("Webhook escutando na porta 9000"));
