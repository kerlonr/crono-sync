/**
 * Verificacao de sintaxe de todo o JS do projeto.
 *
 * Antes isto era uma linha do `package.json` com quinze `node --check`
 * encadeados: arquivo novo so entrava na checagem se alguem lembrasse de
 * editar a linha, e `src/assets.js` teria nascido de fora. Aqui a lista e
 * descoberta pela propria arvore de arquivos.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const TARGETS = ["server.js", "src", "scripts", "public/assets/js", "test"];

const arquivos = TARGETS.flatMap((alvo) => collect(path.join(ROOT_DIR, alvo)));
const falhas = [];

for (const arquivo of arquivos) {
  try {
    execFileSync(process.execPath, ["--check", arquivo], { stdio: "pipe" });
  } catch (error) {
    falhas.push({
      arquivo: path.relative(ROOT_DIR, arquivo),
      saida: String(error.stderr || error.message).trim(),
    });
  }
}

if (falhas.length) {
  for (const falha of falhas) {
    console.error(`\n✖ ${falha.arquivo}\n${falha.saida}`);
  }
  console.error(`\n${falhas.length} arquivo(s) com erro de sintaxe.`);
  process.exit(1);
}

console.log(`${arquivos.length} arquivos JS sem erro de sintaxe.`);

function collect(target) {
  let stats;
  try {
    stats = fs.statSync(target);
  } catch {
    return [];
  }

  if (stats.isFile()) {
    return target.endsWith(".js") ? [target] : [];
  }

  return fs
    .readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => collect(path.join(target, entry.name)));
}
