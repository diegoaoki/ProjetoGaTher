# Virtual Office — Projeto Interno (Clone de Gather.town)

Escritório virtual com mundo 2D multiplayer, áudio/vídeo espacial, salas, e features de produtividade. Pensado para uso interno corporativo.

## Stack e Arquitetura

```
┌─────────────────┐  WebSocket (wss)   ┌─────────────────────┐
│  Client (Vercel)│ ─────────────────► │ Server (Railway)    │
│  React + Phaser │  state deltas      │ Colyseus + Express  │
│  Colyseus SDK   │  input messages    │ OfficeRoom + Schema │
└────────┬────────┘                    └─────────────────────┘
         │ WebRTC
         ▼
┌──────────────────┐
│  LiveKit Cloud   │  ← áudio/vídeo/screenshare
│  (gatherprivate) │
└──────────────────┘
```

- **Server**: Node 20 + Colyseus (state authoritative) + Express + LiveKit server-sdk (gera JWT tokens)
- **Client**: Vite + React 18 + Phaser 3.70 + Colyseus.js + livekit-client
- **Hospedagem**: Railway (server, Dockerfile multi-stage), Vercel (client estático, SPA)
- **Mídia**: LiveKit Cloud free tier (projeto "GaTherPrivate")
- **Idioma da UI**: Português (BR). Mensagens de commit também em PT.
- **Estilo de código**: TypeScript em ambos os lados, decorators no Colyseus schema, comentários em PT explicando "porquê" e não "o quê"

## Estrutura do repositório

```
/
├── server/                    → deploy no Railway (root directory: server)
│   ├── src/
│   │   ├── index.ts           # Express + Colyseus + token endpoint + CORS
│   │   ├── OfficeRoom.ts      # Room do Colyseus: move, claim, invite, teleport, appearance
│   │   ├── schema.ts          # Player, Desk, OfficeState (com decorators @type)
│   │   └── tokenRouter.ts     # POST /token → gera JWT do LiveKit
│   ├── Dockerfile             # multi-stage: builder + runner enxuto
│   ├── railway.json           # config Railway (healthcheck /health)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── client/                    → deploy no Vercel (root directory: client)
│   ├── src/
│   │   ├── main.tsx           # entry React
│   │   ├── App.tsx            # tela de login + HUD + sidebar + modais
│   │   ├── OfficeScene.ts     # cena Phaser: input, sync, colisão, render
│   │   ├── OfficeLayout.ts    # mobília declarativa + hitboxes + zonas
│   │   ├── SpriteFactory.ts   # gera sprites programaticamente (canvas pixel-art)
│   │   └── SpatialAudio.ts    # wrapper LiveKit + lógica de volume por distância
│   ├── vercel.json            # SPA rewrite + cache de assets
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
└── README.md
```

## Variáveis de ambiente (em produção)

**Railway (server):**
- `PORT` — definido pelo Railway automaticamente
- `NODE_ENV=production`
- `ALLOWED_ORIGINS=https://projeto-ga-ther.vercel.app` (CORS)
- `MONITOR_USER` + `MONITOR_PASS` — basic auth do dashboard `/colyseus`
- `LIVEKIT_URL=wss://gatherprivate-wj37bvum.livekit.cloud`
- `LIVEKIT_API_KEY` (secret)
- `LIVEKIT_API_SECRET` (secret)

**Vercel (client):**
- `VITE_SERVER_URL=wss://projetogather-production.up.railway.app`

URLs públicas:
- Server: `https://projetogather-production.up.railway.app`
- Client: `https://projeto-ga-ther.vercel.app`
- Health check: `/health` retorna `{ok:true,ts:...}`

## Comandos

**Local dev (na pasta server/):**
```bash
npm install
npm run dev        # ts-node-dev em ws://localhost:2567
npm run build      # tsc → dist/
npm start          # node dist/index.js
```

**Local dev (na pasta client/):**
```bash
npm install
npm run dev        # vite em http://localhost:5173
npm run build      # build de produção
```

**Deploy**: push pra `main` no GitHub. Railway e Vercel auto-deployam.

## Convenções do projeto

- **Sem `package-lock.json`** no repo (build usa `npm install`, não `npm ci`). Decisão consciente pra simplicidade.
- **Branch única**: `main`. Sem PRs, commit direto.
- **Mensagens de commit em PT**, formato livre mas descritivo: `feat: claim de mesas + sidebar online + convites`.
- **Sem testes automatizados** ainda — validação é manual em produção.
- **Sem ESLint/Prettier configurados** — estilo do TS é "padrão da Anthropic" (2 espaços, aspas duplas, sem ponto-e-vírgula opcional).
- **TypeScript decorators** ativados (necessário pro Colyseus schema).
- **Sprites gerados em runtime** via canvas (não tem assets externos). Pixel art simples mas charm.

## Como funciona (fluxos importantes)

### Conexão de um novo jogador
1. Cliente abre tela de customização (nome + cor camisa + cor cabelo, salvo em `localStorage`)
2. `joinOrCreate("office")` no Colyseus → cria/entra na room
3. Server escolhe spawn point seguro (de uma lista pré-validada, sem mobília)
4. Server envia state inicial via @colyseus/schema deltas (binário)
5. Cliente faz `POST /token` no server → recebe JWT do LiveKit
6. Cliente conecta no LiveKit como participant `name__timestamp` (identity)
7. Publica tracks de áudio + vídeo (câmera). Screen share é opcional, sob demanda

### Áudio espacial
- A cada frame do Phaser (~60fps), `OfficeScene` chama `onPositionsUpdate(myPos, peerPositions)`
- `App.tsx` mapeia `sessionId (Colyseus) ↔ identity (LiveKit)` pelo prefixo do nome
- `SpatialAudio.updateVolumes()` calcula distância e ajusta `audioElement.volume` de cada peer
- Fórmula: `0-150px = 100%`, `150-400px = fade linear`, `400px+ = mute`
- `adaptiveStream: false` no LiveKit (importante! senão screen share vira 2x2 pixels)
- Detecção de fala usa evento `ActiveSpeakersChanged` do LiveKit

### Colisão
- Cada mesa/sofá/etc tem `hitbox` no `OfficeLayout.ts`
- Cliente valida localmente no `tryMove()` antes de atualizar posição
- Movimento permite "slide" nos eixos (bate em parede, continua paralelo)
- Lógica "unstuck": se já está dentro de hitbox, permite movimento mesmo com colisão
- Server tem validação de `MAX_DELTA` (600px) só pra anti-cheat básico — confia no cliente

### Sistema de mesas reserváveis
- Cada mesa tem `deskId` estável (ex: "desk-1") no layout
- Cliente detecta mesa mais próxima (raio 70px) → tecla `E` reserva/libera
- Server mantém `MapSchema<Desk>` com `ownerId`, `ownerName`, `ownerColor`
- Quando dono sai (`onLeave`), mesa libera automaticamente
- Visual: retângulo colorido + tag com nome em volta da mesa reservada

### Convites entre usuários
- Sidebar mostra usuários online com botões `📍 ir até` e `👋 convidar`
- "Ir até" = teletransporte instantâneo (cliente envia move com delta grande, server aceita)
- "Convidar" = mensagem custom `invite` → server propaga `inviteReceived` ao destinatário
- Modal de aceitar/recusar → resposta volta como toast pro convidador
- Se aceito, convidado teletransporta pro convidador automaticamente

### Tela compartilhada
- Botão 🖥️ → `setScreenShareEnabled(true)` no LiveKit
- Track aparece como `Track.Source.ScreenShare` (diferenciado de câmera)
- Mostra: (a) na "TV" do mapa (DOMElement do Phaser, perto do whiteboard) + (b) botão "Ver em tela cheia" no HUD do receptor
- Debounce de 800ms no stop pra evitar AbortError em re-subscribes rápidos

## Bugs e gotchas conhecidos

1. **adaptiveStream do LiveKit**: precisa estar `false`. Se ligar de novo, screen share vira 2x2 pixels (LiveKit ajusta resolução baseado no tamanho do elemento, e a TV do mapa é pequena).
2. **`cloneNode` não copia `srcObject`** de vídeos: sempre passar o `MediaStream` cru entre componentes, nunca o elemento.
3. **AbortError no `play()`**: é benigno, ignorar. Acontece quando elemento é destruído antes do play resolver.
4. **Phaser canvas com tamanho zero**: o canvas precisa ser inicializado DEPOIS do React renderizar o container com dimensões reais (uso 2x `requestAnimationFrame` aninhados).
5. **Spawn em colisão**: tem lista de spawn points "seguros" no server, e fallback no cliente que faz busca em espiral por posição livre.
6. **Persistência zero**: tudo é em memória do server. Restart do Railway = perde mesas reservadas.

## Roadmap

✅ **Fase 1 — Fundação**: mundo 2D, multiplayer sync, deploy
✅ **Fase 2 — Áudio/vídeo espacial**: LiveKit, volume por distância, screen share
✅ **Fase 3 — Visual**: sprites pixel-art, mobília, animações
✅ **Fase 4 — Polimento**: colisão, TV de apresentação, customização de avatar
✅ **Fase 5 — Produtividade**: claim de mesas, sidebar online, convites, teletransporte
🚧 **Próxima — Auth + persistência**: Postgres, login Google Workspace, salvar customização e mesas
🚧 **Depois — Salas isoladas**: zonas que bloqueiam áudio externo (paredes que isolam)
🚧 **Backlog**: chat de texto, mapa "inspirado" no print profissional do Gather, mobile responsivo, editor de mapas

## Decisões técnicas e seus porquês

- **Colyseus em vez de Socket.io puro**: já vem com state sync binário (delta encoding), rooms, matchmaking, lifecycle. Economizou semanas.
- **Phaser em vez de PixiJS**: maduro, físicas opcionais, animações prontas. Mas PixiJS seria mais leve.
- **LiveKit Cloud em vez de self-host**: WebRTC self-host exige TURN/STUN, UDP, IP fixo. Railway não suporta UDP. Cloud é simples e free tier comporta MVP. Migrar pra self-host é trivial (só troca URL).
- **Sprites programáticos em vez de asset pack**: zero custo, zero dependência externa, fácil de iterar. Visual fica "indie" mas funcional. Trocar por pack do LimeZu ($15) é decisão futura.
- **localStorage em vez de banco**: customização do avatar persistida só no navegador. Migra pra Postgres quando fizermos auth.
- **Sem auth ainda**: complexidade que não agrega antes do produto ser validado com o time. Próxima fase.

## Como me ajudar (instruções pro Claude Code)

- **Sempre commitar com mensagens descritivas em PT.**
- **Não criar testes a menos que eu peça.**
- **Não adicionar dependências sem perguntar.** Stack atual é deliberada.
- **Antes de mudanças grandes, descrever o plano e pedir confirmação.**
- **Bugs em produção são frequentes** — sempre considerar autoplay bloqueado, mixed content, CORS, e timing de inicialização do Phaser.
- **Mudanças no schema do Colyseus exigem rebuild de AMBOS server e client** (são pacotes separados que usam a mesma definição).
- **Não mexer em `adaptiveStream`, `cloneNode`, e timing de `play()`** sem ler os "gotchas conhecidos" acima.
- **Servidor é authoritative-light**: confia no cliente pra posição mas valida deltas razoáveis. Não tentar reimplementar física no server.
- **Manter a UI em português.**
