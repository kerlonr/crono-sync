# Fontes

## share-tech-mono.woff2

**Share Tech Mono**, de Ralph Levien / Carrois Apostrophe.
Licença: SIL Open Font License 1.1 — <https://openfontlicense.org>

Usada apenas nos dígitos do cronômetro (`--font-numeric`), pela aparência
de mostrador digital.

Servida **do próprio servidor**, e não do Google Fonts, por dois motivos:

- a CSP do projeto não precisa liberar `fonts.googleapis.com` nem
  `fonts.gstatic.com` (`server.js`, `buildCspDirectives`);
- o número aparece no primeiro quadro, sem depender de uma requisição a
  terceiros no caminho crítico.

O arquivo é o subset **latin** (13 KB), que cobre dígitos e pontuação — é
tudo que o cronômetro exibe.

### Limitação conhecida

A família tem **um único peso (400)**. Comparada às alternativas de traço
grosso, é a que menos se sustenta lida de longe — que é justamente o uso do
viewer projetado. A escolha foi deliberada, pela aparência de mostrador; o
desenho compensa com corpo maior e contraste máximo (branco puro sobre
preto), em vez de peso.
