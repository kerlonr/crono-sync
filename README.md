# Cronômetro Sync

Cronômetro sincronizado em tempo real com painel de admin, tela pública de viewer e visão geral das sessões online.

## Visão Geral

O projeto permite:

- criar uma sessão de cronômetro
- controlar o tempo por uma tela de admin
- compartilhar um link de viewer para acompanhar a contagem em tempo real
- salvar presets localmente no navegador do admin
- acompanhar e finalizar sessões ativas em um painel geral

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
|       |-- audio/
|       |   `-- trompeta.mp3
|       |-- css/
|       |   |-- index.css
|       |   |-- admin.css
|       |   |-- overview.css
|       |   `-- viewer.css
|       `-- js/
|           |-- index.js
|           |-- admin.js
|           |-- finish-sound.js
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

## Organização de Responsabilidades

### Backend

- `server.js`: configura Express, segurança, rotas HTTP, Socket.IO e CSP.
- `src/config.js`: centraliza variáveis de ambiente e valores padrão.
- `src/sessions.js`: guarda sessões em memória e concentra regras do cronômetro.
- `src/security.js`: valida origem, tokens e assinatura do webhook.
- `src/logger.js`: registra acessos e eventos do app.
- `src/deploy-client.js`: dispara o serviço opcional de deploy.

### Frontend

- `public/index.html` + `assets/js/index.js`: cria uma nova sessão.
- `public/admin.html` + `assets/js/admin.js`: controla tempo, presets, fullscreen e link do viewer.
- `public/viewer.html` + `assets/js/viewer.js`: mostra a contagem sincronizada sem controles.
- `public/overview.html` + `assets/js/overview.js`: lista sessões ativas e permite finalizar sessões.
- `assets/js/finish-sound.js`: encapsula o som final do cronômetro.

### CSS

Cada tela possui um CSS próprio para evitar acoplamento visual excessivo:

- `index.css`: tela inicial.
- `admin.css`: painel de controle e drawer mobile.
- `viewer.css`: tela pública de contagem.
- `overview.css`: painel geral de sessões.

O padrão visual atual é dark glass: fundos escuros, bordas translúcidas, blur e acentos em verde/azul.

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

Por padrão, o `docker-compose.yml` expõe a aplicação apenas em:

```text
http://127.0.0.1:3000
```

## Fluxo de Uso

1. Abra a página inicial.
2. Clique em `Criar cronômetro`.
3. Você será redirecionado para a URL de admin da sessão.
4. Use o link de viewer exibido no painel para compartilhar a visualização.
5. Abra `/overview` para ver e finalizar sessões ativas.

Observação:

- a URL de admin inclui um token no hash para autenticar a sessão de controle
- a URL de viewer não inclui permissão de admin
- o arquivo de som final deve ficar em `public/assets/audio/trompeta.mp3`

## Variáveis de Ambiente

As variáveis atuais são:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não | Porta HTTP da aplicação |
| `NODE_ENV` | não | Ambiente de execução |
| `APP_ORIGIN` | recomendado | Origem permitida para conexões e uso do app |
| `HOST_REPO_PATH` | sim, se auto-deploy ativado | Caminho absoluto do repo no host |
| `ENABLE_WEBHOOK` | não | Ativa o endpoint `/webhook` |
| `WEBHOOK_SECRET` | sim, se webhook ativado | Segredo para validar assinatura do webhook |
| `WEBHOOK_DEPLOY_BRANCH` | não | Branch aceito para o auto-deploy |
| `DEPLOYER_TIMEOUT_MS` | não | Timeout para disparar o serviço de deploy |
| `SESSION_TTL_MINUTES` | não | Tempo de vida das sessões em memória |
| `SESSION_CLEANUP_MINUTES` | não | Intervalo de limpeza das sessões expiradas |
| `TRUST_PROXY` | não | Ativa `trust proxy` no Express |

## Endpoints Principais

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Página inicial |
| `POST` | `/api/session/new` | Cria uma nova sessão |
| `GET` | `/api/sessions/active` | Lista sessões ativas |
| `DELETE` | `/api/sessions/:id` | Finaliza uma sessão |
| `GET` | `/admin/:id` | Painel de admin |
| `GET` | `/overview` | Painel com todos os cronômetros ativos |
| `GET` | `/view/:id` | Tela de viewer |
| `GET` | `/health` | Healthcheck simples |
| `POST` | `/webhook` | Endpoint opcional de webhook |

## Validação Local

```bash
npm run check
npm audit --audit-level=moderate
```

## Segurança Atual

O projeto já inclui algumas medidas de endurecimento:

- token de admin por sessão
- validação de `sessionId`, token e payloads recebidos
- `Helmet` com CSP e headers de segurança
- rate limit global, para criação de sessão e para webhook
- validação de assinatura no webhook
- restrição de origem para conexões do Socket.IO
- expiração automática de sessões em memória
- limite máximo de tempo configurável no servidor
- frontend sem `onclick` inline nem scripts embutidos, o que permite CSP mais forte
- serviço principal do app rodando como usuário não-root no Compose
- `docker-compose.yml` com `read_only`, `tmpfs`, `cap_drop` e `no-new-privileges`

## Limitações Atuais

Alguns pontos importantes para considerar antes de produção mais séria:

- as sessões ficam apenas em memória e somem ao reiniciar o processo
- os presets ficam em `localStorage` no navegador do admin
- não existe banco de dados
- não existe painel de usuários nem autenticação tradicional
- o deploy automatico continua exigindo um sidecar com acesso ao Docker socket do host

## Boas Práticas para Este Repo

- não commitar `.env`
- não remover `.gitignore` nem `.dockerignore`
- prefira `npm ci` em vez de `npm install`
- use `APP_ORIGIN` corretamente no ambiente onde for publicar
- deixe `ENABLE_WEBHOOK=false` se você não estiver usando webhook

## Próximos Passos Recomendados

- mover sessão para Redis ou banco
- adicionar testes para regras de sessão e sockets
- criar pipeline de deploy fora da aplicação
- adicionar observabilidade e logs estruturados
