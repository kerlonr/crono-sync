# Cronometro Sync

Cronometro sincronizado em tempo real com painel de admin e tela de viewer, usando `Express` e `Socket.IO`.

## Visao Geral

O projeto permite:

- criar uma sessao de cronometro
- controlar o tempo por uma tela de admin
- compartilhar um link de viewer para acompanhar a contagem em tempo real
- salvar presets localmente no navegador do admin
- acompanhar todas as sessoes ativas do servidor em um painel somente-viewer

## Stack

- Node.js
- Express
- Socket.IO
- Helmet
- express-rate-limit
- HTML, CSS e JavaScript sem framework

## Estrutura

```text
.
|-- public/
|   |-- index.html
|   |-- admin.html
|   |-- overview.html
|   |-- viewer.html
|   `-- assets/
|       |-- css/
|       |   |-- index.css
|       |   |-- admin.css
|       |   |-- overview.css
|       |   `-- viewer.css
|       `-- js/
|           |-- index.js
|           |-- admin.js
|           |-- overview.js
|           `-- viewer.js
|-- scripts/
|   |-- deployer.js
|   `-- webhook-deploy.sh
|-- src/
|   |-- config.js
|   |-- deploy-client.js
|   |-- logger.js
|   |-- security.js
|   `-- sessions.js
|-- server.js
|-- Dockerfile
|-- docker-compose.yml
|-- .env.example
|-- .gitignore
|-- .dockerignore
|-- package.json
`-- package-lock.json
```

## Requisitos

- Node.js 20+
- npm

## Rodando Localmente

1. Instale as dependencias:

```bash
npm ci
```

2. Crie um arquivo `.env` a partir do exemplo:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Inicie o servidor:

```bash
npm start
```

4. Acesse:

```text
http://localhost:3000
```

## Usando com Docker

Build da imagem:

```bash
docker build -t cronometro-sync .
```

Subindo com Compose:

```bash
docker compose up --build
```

Por padrao, o `docker-compose.yml` expõe a aplicacao apenas em:

```text
http://127.0.0.1:3000
```

## Fluxo de Uso

1. Abra a pagina inicial.
2. Clique em `Criar cronometro`.
3. Voce sera redirecionado para a URL de admin da sessao.
4. Use o link de viewer exibido no painel para compartilhar a visualizacao.
5. Abra `/overview` para ver todas as sessoes ativas do servidor em modo viewer.

Observacao:

- a URL de admin inclui um token no hash para autenticar a sessao de controle
- a URL de viewer nao inclui permissao de admin

## Variaveis de Ambiente

As variaveis atuais sao:

| Variavel | Obrigatoria | Descricao |
|---|---|---|
| `PORT` | nao | Porta HTTP da aplicacao |
| `NODE_ENV` | nao | Ambiente de execucao |
| `APP_ORIGIN` | recomendado | Origem permitida para conexoes e uso do app |
| `HOST_REPO_PATH` | sim, se auto-deploy ativado | Caminho absoluto do repo no host |
| `ENABLE_WEBHOOK` | nao | Ativa o endpoint `/webhook` |
| `WEBHOOK_SECRET` | sim, se webhook ativado | Segredo para validar assinatura do webhook |
| `WEBHOOK_DEPLOY_BRANCH` | nao | Branch aceito para o auto-deploy |
| `DEPLOYER_TIMEOUT_MS` | nao | Timeout para disparar o servico de deploy |
| `SESSION_TTL_MINUTES` | nao | Tempo de vida das sessoes em memoria |
| `SESSION_CLEANUP_MINUTES` | nao | Intervalo de limpeza das sessoes expiradas |
| `TRUST_PROXY` | nao | Ativa `trust proxy` no Express |

## Endpoints Principais

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/` | Pagina inicial |
| `POST` | `/api/session/new` | Cria uma nova sessao |
| `GET` | `/admin/:id` | Painel de admin |
| `GET` | `/overview` | Painel com todos os cronometros ativos em modo viewer |
| `GET` | `/view/:id` | Tela de viewer |
| `GET` | `/health` | Healthcheck simples |
| `POST` | `/webhook` | Endpoint opcional de webhook |

## Seguranca Atual

O projeto ja inclui algumas medidas de endurecimento:

- token de admin por sessao
- validacao de `sessionId`, token e payloads recebidos
- `Helmet` com CSP e headers de seguranca
- rate limit global, para criacao de sessao e para webhook
- validacao de assinatura no webhook
- restricao de origem para conexoes do Socket.IO
- expiracao automatica de sessoes em memoria
- limite maximo de tempo configuravel no servidor
- frontend sem `onclick` inline nem scripts embutidos, o que permite CSP mais forte
- servico principal do app rodando como usuario nao-root no Compose
- `docker-compose.yml` com `read_only`, `tmpfs`, `cap_drop` e `no-new-privileges`

## Limitacoes Atuais

Alguns pontos importantes para considerar antes de producao mais seria:

- as sessoes ficam apenas em memoria e somem ao reiniciar o processo
- os presets ficam em `localStorage` no navegador do admin
- nao existe banco de dados
- nao existe painel de usuarios nem autenticacao tradicional
- o deploy automatico continua exigindo um sidecar com acesso ao Docker socket do host

## Boas Praticas para Este Repo

- nao commitar `.env`
- nao remover `.gitignore` nem `.dockerignore`
- prefira `npm ci` em vez de `npm install`
- use `APP_ORIGIN` corretamente no ambiente onde for publicar
- deixe `ENABLE_WEBHOOK=false` se voce nao estiver usando webhook

## Proximos Passos Recomendados

- mover sessao para Redis ou banco
- adicionar testes para regras de sessao e sockets
- criar pipeline de deploy fora da aplicacao
- adicionar observabilidade e logs estruturados
