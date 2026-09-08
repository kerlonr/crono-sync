/**
 * Versionamento dos arquivos estaticos.
 *
 * As paginas referenciavam os assets com uma versao escrita a mao
 * (`admin.css?v=20260906c`). Era preciso lembrar de trocar a data a cada
 * alteracao, em cada pagina que carregasse aquele arquivo - e as versoes ja
 * tinham se separado entre telas, o que significa navegador servindo CSS
 * velho para quem nao limpasse o cache.
 *
 * Aqui a versao passa a ser o hash do proprio conteudo, calculado uma vez no
 * boot. O HTML pede `__ASSET:css/base.css__` e recebe o caminho com o hash
 * junto. Mudou o arquivo, muda o hash, o navegador busca de novo; nao mudou,
 * ele reaproveita o que ja tem.
 */
const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");

const PLACEHOLDER = /__ASSET:([a-zA-Z0-9/_.-]+)__/g;

module.exports = {
  createAssetManifest,
};

/**
 * @param {object} options
 * @param {string} options.assetsDir pasta servida em `/assets`.
 * @param {boolean} [options.watch] recalcula a cada pedido, para o
 * desenvolvimento nao exigir reiniciar o servidor a cada CSS salvo.
 * @param {Function} [options.logEvent]
 * @returns {{resolve: Function, apply: Function, size: number}}
 */
function createAssetManifest({ assetsDir, watch = false, logEvent }) {
  let versions = build();

  return { apply, resolve, get size() { return versions.size; } };

  function build() {
    const mapa = new Map();

    for (const relativePath of listFiles(assetsDir)) {
      try {
        const conteudo = fs.readFileSync(path.join(assetsDir, relativePath));
        mapa.set(
          relativePath,
          createHash("sha1").update(conteudo).digest("hex").slice(0, 10),
        );
      } catch (error) {
        logEvent?.("asset_hash_failed", {
          asset: relativePath,
          message: error.message,
        });
      }
    }

    return mapa;
  }

  /**
   * @param {string} relativePath caminho dentro de `/assets`, sem barra inicial.
   * @returns {string} URL do asset, com a versao quando ele existe.
   */
  function resolve(relativePath) {
    const version = versions.get(normalize(relativePath));
    const url = `/assets/${normalize(relativePath)}`;
    return version ? `${url}?v=${version}` : url;
  }

  /**
   * Troca os `__ASSET:...__` de um HTML pelas URLs versionadas.
   * @param {string} html
   * @returns {string}
   */
  function apply(html) {
    // Fora de producao o hash e refeito a cada pagina servida. Sem isso,
    // editar um CSS com o servidor de pe devolvia o hash antigo, o navegador
    // considerava o arquivo imutavel e a alteracao simplesmente nao aparecia.
    if (watch) versions = build();

    return html.replaceAll(PLACEHOLDER, (_match, relativePath) =>
      resolve(relativePath),
    );
  }
}

function normalize(relativePath) {
  return String(relativePath).replace(/^\/+/, "").replaceAll("\\", "/");
}

/** Lista recursivamente os arquivos da pasta, em caminhos relativos a ela. */
function listFiles(dir, prefix = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(dir, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}
