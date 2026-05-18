# Virtual Office — Projeto Interno (Clone de Gather.town)

Escritório virtual com mundo 2D multiplayer, áudio/vídeo espacial, salas, e features de produtividade. Pensado para uso interno corporativo.

## Stack e Arquitetura

```
┌─────────────────┐  WebSocket (wss)   ┌─────────────────────┐    ┌──────────────┐
│  Client (Vercel)│ ─────────────────► │ Server (Railway)    │───►│  Postgres    │
│  React + Phaser │  state deltas      │ Colyseus + Express  │    │  (Railway)   │
│  Colyseus SDK   │  input messages    │ Auth + Drizzle ORM  │    │  users +     │
└────────┬────────┘  JWT no joinOrCreate│ OfficeRoom + Schema │    │  profiles    │
         │                              └─────────────────────┘    └──────────────┘
         │ WebRTC
         ▼
┌──────────────────┐
│  LiveKit Cloud   │  ← áudio/vídeo/screenshare
│  (gatherprivate) │
└──────────────────┘
```

- **Server**: Node 20 + Colyseus (state authoritative) + Express + LiveKit server-sdk (gera JWT tokens) + Drizzle ORM + bcryptjs + jsonwebtoken
- **Client**: Vite + React 18 + Phaser 3.70 + Colyseus.js + livekit-client
- **Banco**: Postgres (Railway plugin), conectado via `pg` + `drizzle-orm`. Schema criado idempotente no boot via `CREATE TABLE IF NOT EXISTS`.
- **Auth**: email + senha (bcrypt), sessão via JWT (HS256, expira 7d) guardado em `localStorage` do cliente. Rate limiting nos endpoints sensíveis.
- **Hospedagem**: Railway (server + Postgres, Dockerfile multi-stage), Vercel (client estático, SPA)
- **Mídia**: LiveKit Cloud free tier (projeto "GaTherPrivate")
- **Idioma da UI**: Português (BR). Mensagens de commit também em PT.
- **Estilo de código**: TypeScript em ambos os lados, decorators no Colyseus schema, comentários em PT explicando "porquê" e não "o quê"

## Estrutura do repositório

```
/
├── server/                    → deploy no Railway (root directory: server)
│   ├── src/
│   │   ├── index.ts           # Express + Colyseus + bootstrap (initDb)
│   │   ├── OfficeRoom.ts      # Room do Colyseus: onAuth (JWT), move, appearance
│   │   ├── schema.ts          # Player (com userId), OfficeState
│   │   ├── tokenRouter.ts     # POST /token (autenticado) → JWT do LiveKit
│   │   ├── auth/
│   │   │   ├── router.ts      # POST /auth/register, /auth/login, GET /auth/me, PATCH /profile
│   │   │   ├── middleware.ts  # extractAuth (global) + requireAuth (por rota)
│   │   │   ├── jwt.ts         # sign/verify JWT (HS256, JWT_SECRET)
│   │   │   └── password.ts    # bcrypt hash/verify
│   │   └── db/
│   │       ├── schema.ts      # tabelas Drizzle: users, profiles
│   │       ├── client.ts      # Pool pg + cliente Drizzle (lazy init)
│   │       └── init.ts        # CREATE TABLE IF NOT EXISTS (idempotente no boot)
│   ├── Dockerfile             # multi-stage: builder + runner enxuto
│   ├── railway.json           # config Railway (healthcheck /health)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── client/                    → deploy no Vercel (root directory: client)
│   ├── src/
│   │   ├── main.tsx           # entry React
│   │   ├── App.tsx            # auth gate + customização + HUD + modais
│   │   ├── LoginScreen.tsx    # tela de login/registro (toggle)
│   │   ├── auth.ts            # helpers de fetch p/ /auth/* + localStorage do JWT
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
- `DATABASE_URL` — injetado pelo plugin Postgres do Railway
- `JWT_SECRET` — segredo HS256 (mín. 16 chars). Gerar com `openssl rand -hex 32`
- `ADMIN_EMAILS` — lista CSV de emails admin (ex: `foo@x.com,bar@y.com`). Define quem vê 🛡️ no HUD e pode usar `/admin/users/*`
- `VISITOR_PASSWORD` (opcional) — senha fixa compartilhada pro modo visitante. Se não setada, só o login por código de uso único funciona.
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
# Postgres local (uma vez)
docker run --name pg-gather -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres
cp .env.example .env       # ajustar DATABASE_URL + JWT_SECRET + LIVEKIT_*

npm install
npm run dev        # ts-node-dev em ws://localhost:2567 (cria tabelas no boot)
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

### Autenticação (email + senha)
1. Cliente abre `LoginScreen` (toggle entre Entrar / Cadastrar).
2. `POST /auth/register` ou `/auth/login` valida com Zod, hasheia senha com bcrypt (10 rounds), grava em `users` + `profiles`, devolve `{ token, user, profile }`.
3. Cliente guarda só o JWT em `localStorage` (`virtual-office-jwt-v1`). Perfil vem do server em todo boot via `GET /auth/me`.
4. Rate limit: 20 tentativas / 15min por IP em `/auth/register` e `/auth/login`. 60 req/min nos demais.
5. Sem domínio restrito no email (decisão consciente — uso interno, mas qualquer email serve).
6. `PATCH /profile` (autenticado) atualiza displayName/bodyColor/hairColor. Modal "🎨 Editar avatar" no HUD usa esse endpoint e refresca o Player na room ativa.
7. Logout: limpa JWT, derruba Colyseus + LiveKit.

### Administração de usuários
- Admin = email em `ADMIN_EMAILS` (env, **bootstrap** do 1º admin) **OU** promovido pela UI (`adminStore.ts`, persistido em `app_meta` key `extra_admins`, cache em memória carregado no boot via `loadAdmins()` no `index.ts` — `isAdminEmail` continua síncrono = env OU extra). Quem é admin vê o 🛡️ no HUD.
- Endpoints: `GET /admin/users` (lista; agora retorna `envAdmin` por user), `PATCH /admin/users/:id/password` (reset), `PATCH /admin/users/:id/admin` `{make}` (promover/remover — só admin; bloqueia demover env-admin e auto-demover), `DELETE /admin/users/:id` (apagar).
- UI: `AdminPanel` tem botão 👑/👑✕ por usuário (desabilitado pra env-admin e pra você mesmo). **Usuário promovido só vira admin de fato no próximo login** (`session.user.isAdmin` vem do `/auth/me`/login via `isAdminEmail`).
- Middleware `requireAdmin` em `server/src/auth/admin.ts` (`isAdminEmail` = `isEnvAdmin` OU `isExtraAdmin`).
- Auto-delete é **bloqueado** no server (admin não pode apagar a própria conta) — evita travar o sistema.
- Reset de senha é feito definindo a nova senha manualmente; o admin precisa transmitir por outro canal (não tem fluxo de "esqueci a senha" por email).
- Apagar usuário cascateia pra `profiles` via FK `ON DELETE CASCADE`. Sessão JWT existente do user apagado vira inválida no próximo `/auth/me`.

### Conexão de um novo jogador (autenticado)
1. Cliente, já com JWT válido, mostra preview do avatar (cores vindas do server). Pode ajustar antes de entrar.
2. `joinOrCreate("office", { token })` → `OfficeRoom.onAuth` valida o JWT, busca user + profile no Postgres, anexa em `client.userData`. Sem token / inválido = recusa.
3. Server escolhe spawn point seguro (de uma lista pré-validada, sem mobília).
4. Server envia state inicial via @colyseus/schema deltas (binário). `Player.userId` vai pro cliente pra mapear identity do LiveKit.
5. Cliente faz `POST /token` no server com `Authorization: Bearer <jwt>` → recebe JWT do LiveKit.
6. Cliente conecta no LiveKit como participant `userId__timestamp` (identity). O `displayName` aparece como metadado.
7. Publica tracks de áudio + vídeo (câmera). Screen share é opcional, sob demanda.
8. Cliente mapeia `identity.startsWith(player.userId + "__")` pra associar áudio/vídeo ao avatar correto na cena Phaser.

### Áudio espacial + salas isoladas (Fase 7)
- A cada frame do Phaser (~60fps), `OfficeScene` chama `onPositionsUpdate(myInfo, peerInfo)` — cada info contém `{x, y, zoneId}`.
- `App.tsx` mapeia `sessionId (Colyseus) ↔ identity (LiveKit)` pelo `Player.userId` (sufixo `__timestamp`).
- `SpatialAudio.updateVolumes()` aplica duas regras em ordem:
  1. **Sala isolada**: se `myZoneId !== peerZoneId`, volume = 0 (independente da distância).
  2. **Distância**: dentro da mesma zona, `0-150px = 100%`, `150-400px = fade linear`, `400px+ = mute`.
- `OfficeLayout` define `rooms[]` (3 salas) e `walls[]` (paredes com colisão). `getCurrentRoom(x,y)` retorna a zona — fallback `open` se está fora de qualquer sala.
- Quando o player muda de zona, cliente envia `room.send("zone", zoneId)` pro server atualizar `Player.zoneId` no schema; outros clientes recebem via state sync.
- `adaptiveStream: false` no LiveKit (importante! senão screen share vira 2x2 pixels).
- Detecção de fala usa evento `ActiveSpeakersChanged` do LiveKit.

### Colisão
- Cada mesa/sofá/etc tem `hitbox` no `OfficeLayout.ts`
- Cliente valida localmente no `tryMove()` antes de atualizar posição
- Movimento permite "slide" nos eixos (bate em parede, continua paralelo)
- Lógica "unstuck": se já está dentro de hitbox, permite movimento mesmo com colisão
- Server tem validação de `MAX_DELTA` (600px) só pra anti-cheat básico — confia no cliente

### Sistema de mesas reserváveis (implementado na Fase 6b parte 1)
- Cada mesa tem `deskId` estável (`desk-1` a `desk-8`) declarado em `client/src/OfficeLayout.ts` e no catálogo `server/src/desks.ts` (precisam ficar sincronizados — se mudar layout, atualiza os dois).
- Cliente detecta mesa mais próxima (raio 70px) → tecla `E` reserva ou libera. Hint visual aparece quando perto.
- Server mantém `MapSchema<Desk>` no Colyseus + tabela `desk_reservations` no Postgres. Tabela tem snapshot de `display_name` e `body_color` pra renderizar nome+cor mesmo com dono offline.
- **Reservas persistem entre sessões**: mesa não libera quando user desconecta — só libera com `E` explicitamente OU `DELETE /admin/users/:id` (cascade pela FK).
- **Cada user só pode ter UMA mesa**: claim novo libera a anterior automaticamente.
- **Spawn point**: se user tem mesa reservada, spawna na cadeira da mesa. Senão, fallback pra lista `SPAWN_POINTS`.
- **Sincronização de cor**: quando user troca `bodyColor` via modal 🎨, o snapshot em `desk_reservations` é atualizado pra outros verem a cor nova no outline da mesa.
- Visual no Phaser: retângulo com stroke da cor do dono em volta da mesa + label com nome.

### Sidebar online + convites + teletransporte (Fase 6b parte 2)
- Botão **👥** no HUD abre sidebar lateral listando todos os players conectados (state.players do Colyseus).
- Cada row da sidebar mostra avatar mini (canvas pixel-art 24×30) + nome + badge "você" pro próprio. Atualiza em tempo real via `onAdd/onChange/onRemove`.
- **📍 ir até** (botão na row): envia `teleport:to-player`. **Server-autoritativo** — ele lê posição do alvo e escreve direto no state. Cliente NUNCA manda delta grande (MAX_DELTA segue 100).
- **📍 minha mesa** (botão no HUD, condicional): aparece se `myDeskId` existe. Envia `teleport:to-desk`.
- **👋 convidar** (botão na row): envia `invite` → server propaga `invite:received` pro alvo.
- Modal "Aceitar/Recusar" abre pro convidado. Resposta vai como `invite:respond` → server propaga `invite:response` pro convidador (toast).
- **Se aceito**, server teletransporta o convidado pra perto do convidador (offset 40px no eixo).
- Segundo convite enquanto há um pendente substitui o anterior (toast avisa).
- Mensagens de erro: `invite:error`, `teleport:error` — ambas viram toast no client.

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
6. **Persistência parcial**: `users` e `profiles` persistem em Postgres. Estado da room (posições, players online) ainda é em memória — restart do Railway derruba quem está online (eles re-logam).
7. **Identity LiveKit usa userId, NÃO displayName**: o mapeamento client↔LiveKit é por `Player.userId`, não pelo nome. Mudar isso quebra áudio espacial e detecção de fala.
8. **Schema do Postgres é criado no boot**: `initDb()` roda `CREATE TABLE IF NOT EXISTS`. Mudanças destrutivas (drop coluna, alter tipo) NÃO são detectadas — pra isso precisa migrar pra `drizzle-kit migrations`.
9. **NUNCA colocar `await` entre `new Phaser.Game()` e `game.scene.start("OfficeScene", {room,...})`**: como o game usa `scene:[OfficeScene]`, o Phaser auto-inicia a cena. Se houver um `await` no meio, a cena boota SEM os dados (`init()` sem `room`) e `create()`/`setupStateListeners` estoura com `Cannot read properties of undefined (reading 'state')`, deixando o jogo meio-quebrado. Qualquer fetch necessário pro boot (ex: `fetchMapLayout`) tem que ser feito ANTES do `new Phaser.Game()`.
10. **esbuild do Vite (build do Vercel) só checa SINTAXE, não tipos**: erros tipo `await` fora de função `async` quebram o deploy do client e o Vercel mantém o bundle anterior (parece que "a mudança não subiu"). Erros só de tipo TS NÃO quebram o build. Sem `node` no ambiente do Claude, validar build é manual.

## Roadmap

✅ **Fase 1 — Fundação**: mundo 2D, multiplayer sync, deploy
✅ **Fase 2 — Áudio/vídeo espacial**: LiveKit, volume por distância, screen share
✅ **Fase 3 — Visual**: sprites pixel-art, mobília, animações
✅ **Fase 4 — Polimento**: colisão, TV de apresentação, customização de avatar
🚧 **Fase 5 — Produtividade** (ainda NÃO implementada no código): claim de mesas, sidebar online, convites, teletransporte. CLAUDE.md histórico marcava como ✅ mas o código atual não tem o sistema de `Desk`/claim/invite — fica pra próxima.
✅ **Fase 6a — Auth + perfil persistido**: email+senha (bcrypt), JWT, Postgres no Railway via Drizzle, customização salva no server.
✅ **Fase 6b (parte 1) — Mesas reserváveis com persistência**: tecla E reserva/libera, mesa fica do dono mesmo offline, spawna na mesa reservada ao entrar.
✅ **Fase 6b (parte 2) — Sidebar online + convites + teletransporte**: botão 👥 abre sidebar, cada usuário tem 📍 (ir até) e 👋 (convidar). Teletransporte server-autoritativo. Botão 📍 'minha mesa' no HUD se você tem reserva.
✅ **Fase 7 — Salas isoladas com paredes**: 3 salas de reunião (1 grande + 2 pequenas) + open space. Paredes com colisão, vãos pra entrar. Áudio isolado por zona — quem está em zona diferente é mutado. Mesas redistribuídas (4 no open, 4 nas salas).
🚧 **Backlog**:
- esqueci-a-senha (precisa SMTP)
- ✅ FEITO (commits `79575fe` + `ce656c0`) — **modo visitante**: aba "Visitante" no login (nome + código de uso único OU senha fixa via env `VISITOR_PASSWORD`); `/visitor/code` (qualquer logado gera, TTL 30min, em memória) e `/visitor/login`; JWT `role=visitor` (sub `visitor:<uuid>`, sem linha no Postgres; `/auth/me` e `onAuth` tratam visitante); `Player.role` + `Player.visitorOk` no schema; visitante não reserva mesa; áudio MUDO TOTAL até o host autorizar. **Por código**: o gerador do código É o host (claim `host` no JWT); ao entrar, o host recebe `visitor:incoming` automático (sem o visitante escolher; se host offline, fica pendente até ele entrar); ao aceitar, o visitante é **teleportado pra junto do host** + `visitorOk=true` → áudio espacial normal. **Por senha** (sem host): fallback manual — painel lista online → `visitor:request` → modal do host → `visitor:respond`. A autorização **persiste até a meia-noite (BRT)** por userId do visitante (`visitorAuth.ts`, cache em memória + persistido em `app_meta` key `visitor_auth` — sobrevive a restart/deploy do Railway); reconectar dentro do dia não exige re-autorizar. **Requer env `VISITOR_PASSWORD` no Railway pra o caminho de senha** (o de código funciona sem env).
- ✅ FEITO — mobile responsivo (além da base que já existia: `useIsMobile`, joystick + botão E, HUD compacto, sidebar fullscreen, `Scale.RESIZE`): (1) **viewport** `maximum-scale=1, user-scalable=no, viewport-fit=cover` + `100dvh` + `env(safe-area-inset-*)` + `-webkit-tap-highlight-color: transparent` + `overscroll-behavior: none` (mata zoom de página/double-tap/bounce); (2) **pinça pra zoom** no `OfficeScene` (`addPointer(1)`, distância entre `pointer1/pointer2` → `applyZoomClamped` reusando `ZOOM_MIN/MAX`, não conflita com pan); (3) **botão G** no `MobileControls` (roxo, acima do E) → `triggerGhostAction()` (conversa de mesa/fantasma, antes inacessível sem teclado); botões respeitam safe-area via `calc(... + env(...))`; (4) **cards de vídeo**: menores no mobile (84×56 / 132×99), self-view vai pro topo-direita (longe de joystick/E/G), coluna de peers topo-esquerda rolável, grid de sala com `maxHeight` + scroll → nunca cobrem controles; (5) **LoginScreen** card `min(380px, 100%)` + `100dvh`; (6) **modais** (`cardStyle`/`modalStyle` globais) com `maxWidth: calc(100vw-24px)`, `maxHeight: calc(100dvh-24px)`, `overflowY:auto`; AudioTestScreen idem. Sem dep nova, sem schema/server.
- editor de mapas
- ✅ FEITO (2026-05-18) — **cor de parede editável no map editor**: `Wall.color?` (default `WALL_COLOR=0x3d4a5e`). `drawWalls` usa `w.color`; stroke/brilho derivados via `shadeNum(c,f)` (0.5 escuro / 1.4 claro). `renderEditWalls`/`applySelHighlight` mostram a cor real (contorno azul/verde = seleção). `OfficeScene.setWallColor(hex)` recolore a parede selecionada **e** vira a cor do "pincel parede" (`wallBrushColor`, novas paredes nascem com ela). `notifyEditor` envia `selKind`/`wallColor`; no painel do editor um `<input type=color>` aparece quando o pincel é parede ou há parede selecionada. Persiste no `map_layout` (override guarda `walls` com `color`; server só usa walls p/ colisão, cor é client-side).
- ✅ FEITO (2026-05-18) — **categorias + busca na paleta do editor**: `App.tsx` consts `FURN_CAT` (type→categoria), `FURN_LABEL` (rótulo PT) e `FURN_CATEGORIES`. No painel do editor: input de busca + chips de categoria (Todos/Mesas/Cozinha/Segurança/Geral/2º andar); a grade filtra por categoria + texto (busca no key e no label PT). Tile mostra `FURN_LABEL`.
- ✅ FEITO — editor "edição limpa": ao abrir o editor, `setActorsVisible(false)` esconde meu avatar + remotos + NPC segurança + balões de vídeo/fala; right-click NÃO abre menu de contexto de avatar (só pan, `if (!this.editMode)`); `SpatialAudio.setEditorMute(true)` zera o volume de todos os peers; joystick mobile escondido (`!mapEditorOpen`). Sair restaura tudo (`setActorsVisible(true)`, `setEditorMute(false)`).
- ✅ FEITO — editor: adicionar itens DENTRO das salas — a causa era `if (onObj) return` tratando parede igual a móvel (clicar dentro de sala = sobre parede → bloqueava). Agora `onFurn`/`onWall` separados: pincel de móvel só é bloqueado por móvel existente (pra selecionar); parede/sala não bloqueiam mais o add. (Drag-and-drop da paleta já adicionava em qualquer lugar.)
- ✅ FEITO (2026-05-18) — **editor de mesa**: TODA `desk` colocada no editor de mapa vira **reservável** (decisão do user). `OfficeScene.makeEditItem`: ao adicionar `type:"desk"` (drop ou pincel) gera `deskId` único `desk-ed-<base36>` (≤32 chars) + `tex:"desk_pc1"` (visual bom). Salvo no override (`map_layout`). **Server** passou a resolver mesas via `this.deskById(id)` = `getDeskById` (fixas) **OU** item `type:"desk"`+`deskId` do `mapFurniture` (override) — usado em claim/spawn/seat/findReserved/desk:sit/teleport. `validDeskIds()` + `pruneOrphanReservations()` (no boot e após `map:reload`): **mesa apagada no editor → reserva cai** (limpa `state.desks` + `desk_reservations`); hydrate também apaga reserva de mesa inexistente. Admin precisa salvar (dispara `map:reload`). **Navegação ajustada (2026-05-18)**: `OfficeScene.goToDesk(deskId)` usa `allDesks` (layout vivo = padrão + editor) — botões "ir pra minha mesa" e "ir até a mesa de X" agora navegam pra editor-desks também; `getDeskCatalog()` estático não é mais usado no App.
- ✅ FEITO (2026-05-18) — **sprint com Shift**: `const sprint = this.cursors.shift?.isDown ? 2 : 1` multiplica `dx/dy` no bloco de movimento (junto do `speedMul` por tempo). Pior caso `180×speedMul3×sprint2 = 1080px/s` → ~54px por `SYNC_INTERVAL`(50ms) < `MAX_DELTA`(100) → não rubberband. `cursors.shift` vem do `createCursorKeys()` (sem tecla nova).
- ✅ FEITO — menu de contexto: right-click no avatar de outro player → menu com "📢 Pedir pra vir aqui" (msg `summon` → o outro recebe toast + caminha até você via A*, sem modal) e "📍 Ir até". Right-click no vazio continua dando pan. (sprite do remote interativo + `rpSession` data; hitTestPointer)
- ✅ FEITO (2026-05-18) — **não mostrar "mesa reservada" no join**: `deskToastSinceRef` = `Date.now()+5000` setado quando os callbacks da scene são ligados; `onMyDeskChange` só toasta "reservada pra você" se `Date.now() >= deskToastSinceRef` (reserva ATIVA pós-join). Join não polui; "liberada" e reserva ativa seguem avisando.
- ✅ FEITO (2026-05-18) — **bolha sem convite**: `handleBubbleInvite` agora cria/junta a bolha **direto** (mesma lógica do antigo respond — `bubbleId` compartilhado, `bubble:started` pros membros); guarda "já está em outra bolha". Cliente: removidos handler `bubble:invite-received`/`bubble:response`, modal `incomingBubble` e state; 🫧 toasta "Bolha aberta com X". `bubble:respond`/`handleBubbleRespond` ficaram registrados mas mortos (sem churn).
- ✅ FEITO (2026-05-18) — **variedade de desks no editor**: além de `desk`/`monitor`/`deskpc_*` (tintados por depto), 7 modelos LimeZu Conference Hall em `client/public/assets/interiors/desks/` carregados por `DESK_SPRITES`: `desk_plain` (32×48), `desk_wide` (48×48), `desk_pc1`/`desk_pc2` (madeira/cinza + monitor no pedestal), `desk_screen1`/`desk_screen2` (madeira/cinza + tela grande), `printer`. Todos em `EDITOR_FURNITURE_TYPES` + HITBOXES próprios → admin arrasta/escolhe no editor (miniatura via `getFurnitureThumbnail`). **Decorativo**: colocado pelo editor não é reservável (só a `desk` do layout default, com `deskId`, reserva). Quando o user escolher o modelo, dá pra trocar o `tex` padrão das workstations.
- ✅ FEITO (2026-05-18) — **sentar na cadeira ao chegar**: `AssetLoader` cria anim `${id}_${dir}_sit` (pose estática, 1º frame da direção no sheet `_sit`). `OfficeScene.chairSpots` (posições de `type:"chair"`, repovoado no `drawFurniture`/rebuild) + `onChair(x,y)` (raio 26px). Parado em cima de cadeira → anim `sit` virado pra "up" (de frente pra mesa), pro meu avatar (`myAnimKey` evita replay) e pros remotos (local, sem schema — cada client deduz pela posição). Ao mover volta a walk/idle. **Refino (2026-05-18)**: `chairSpots` agora guarda `{x,y,dir}` — `dir` calculado pela mesa/desk mais próxima (≤110px; types `desk`/`desk_*`/`deskpc_*`/`meetingTable`/`kitchen_table`/`coffeeTable`), o avatar senta **de frente pra mesa** (eixo dominante chair→mesa; "up" se não achar). `onChair` retorna `dir|null`. Vale pro meu avatar e remotos. Cadeiras laterais de reunião agora viram certo. **Fix (2026-05-18)**: cadeira não tinha como ser pisada (hitbox de colisão parava o avatar antes) → `checkCollision` agora **ignora `type:"chair"`** (cadeira atravessável, padrão Gather): anda em cima dela e senta. 1 lugar central. **Fix 2 ("parece cortou")**: o sit sheet está OK (poses sentadas compactas); o problema era o `desk_work` (80px alto) ocluindo o avatar sentado pq a cadeira ficava colada na base. `addWorkstation` cadeira `y+40→y+56` (senta NA FRENTE do desk, visível); alinhado: `getSeatPosition`/`deskSeatPos` server `+36→+56` (spawn cai na cadeira), `goToDesk` `+28→+52`.
- ✅ FEITO (2026-05-17) — **melhorar a abertura das portas**: antes a porta era 1 retângulo que só dava `setVisible/alpha` instantâneo ("só sumia"). Agora é **porta dupla**: 2 folhas (`doorLeaves`) que, ao abrir, deslizam cada uma pro seu lado (recolhem no vão) com **fade-out** via tween (280ms, Cubic.Out); ao fechar, voltam ao centro + fade-in. `doorOpenState` evita animar na primeira render (join aplica direto). Colisão segue o estado lógico (`refreshDynamicWalls`, instantâneo) — animação é só visual. Client-only, sem schema. **Refino**: ao abrir, as folhas vão pra `depth -5` JÁ (atrás do avatar) — antes ficavam em `door.y+100` por ~280ms e um avatar rápido aparecia "passando por baixo da porta ainda fechada"; agora ele passa na frente da folha que some. Abrir 170ms / fechar 240ms (alpha resolve antes do slide).
- ✅ FEITO (2026-05-18) — **recusar acesso a sala trancada agora expulsa**: `handleAccessRespond` (accepted=false) inclui `x,y` do eject no `access:response`; o client faz `sceneRef.current?.forceTeleport(x,y)` quando `!accepted` (sem isso o authoritative-light sobrescrevia e a pessoa ficava dentro). Mesma solução do bug do visitante (`661ce0d`). Convite 👋 sempre esteve correto.
- ✅ FEITO (2026-05-18) — **visual da Recepção**: `reception_desk` (composição Conference `#1+#2+#1↔` 128×80, `client/public/assets/interiors/reception/`, `RECEPTION_SPRITES` no AssetLoader) = balcão de atendimento. Lobby reescrito: balcão + cadeira do recepcionista atrás (senta virado pros visitantes via lógica de sit-dir) + `whiteboard` (boas-vindas) + `tv` (welcome screen) na parede norte + plantas nas laterais + área de espera embaixo (2 sofás + coffeeTable + 2 cadeiras + plantas nos cantos). `HITBOXES.reception_desk` 120×52; em `EDITOR_FURNITURE_TYPES`+`FURN_CAT`/`FURN_LABEL` ("Balcão de recepção").
- ✅ FEITO — **visual da Copa (cozinha real)**: sprites do LimeZu **pago** (Kitchen Singles `12_Kitchen_Singles_32x32`) copiados pra `client/public/assets/interiors/kitchen/` (`fridge` 32×80, `stove` 32×64, `counter_sink` 32×64, `counter` 64×64, `coffee_machine` 32×48, `microwave`/`range_hood`/`kitchen_table` 32×32). `AssetLoader.preloadLimezuAssets` carrega cada PNG com key = type (`KITCHEN_SPRITES`); `OfficeScene.drawFurniture` (`add.image(x,y,type)`) usa direto. `OfficeLayout`: bloco da Copa reescrito (bancada na parede de cima: geladeira + fogão + coifa + pia + balcão + cafeteira + microondas; mesa de refeição + 4 cadeiras + planta), HITBOXES por tipo, tipos adicionados em `EDITOR_FURNITURE_TYPES`. Os antigos placeholders `bookshelf`+tag saíram. **Pipeline de asset validado (piloto)** → replicável pra Recepção/Segurança. Nota: se houver override de mapa salvo no Postgres, ele sobrepõe o default — re-salvar no editor pra ver a Copa nova.
- ✅ FEITO (commit `549beb1` + correção do post) — **NPC segurança fica do lado de fora da porta**: `handleRoomLock` agora usa a heurística `doorOnLeftWall` (porta esquerda → guarda a oeste; direita/diretorias → leste), com `direction` coerente. E o guarda caminha (rota A*) até o posto em vez de teleportar.
- NPC segurança com pathfinding real (A* entre móveis/paredes) — substituir o atual "teletransporte + fade" da feature de cadeado de sala. Precisa grid de navegação + algoritmo evitando furniture hitboxes e walls dinâmicas (portas fechadas)
- ✅ FEITO — sala de Segurança bloqueada pra todos: `refreshDynamicWalls` adiciona o retângulo da `security_room` como blocker permanente em `dynamicWalls` (independente da porta). Guarda NPC não usa `tryMove` nem o A* usa `dynamicWalls` → não afetado. (Admin também é barrado — sem exceção por ora.)
- ✅ FEITO (2026-05-17) — **mesas na proporção do print (LimeZu)**: `meetingTable`/`kitchen_table`/`coffeeTable` agora são PNGs compostos de peças do **Conference Hall** pago (`#1` ponta-esquerda + `#2` meio×N + `#1` espelhado como ponta-direita → mesa larga simétrica, madeira clara + apron). `client/public/assets/interiors/tables/` (`meetingTable` 192×80, `kitchen_table` 128×80, `coffeeTable` = `#20` 64×32). `AssetLoader.TABLES_SPRITES` (key==type) carrega e **substitui** a procedural (SpriteFactory pula via `if exists`) e a do tileset (`coffeeTable` **removido de `FURNITURE_TILES`** pra `registerFurnitureTextures` não sobrescrever; `kitchen_table` saiu de `KITCHEN_SPRITES`). HITBOXES atualizados. Layout de cadeiras do `buildMeetingRoom`/Copa já comporta os novos tamanhos.
- ✅ FEITO (2026-05-17, refeito 2026-05-18) — **workstations por departamento (desk + PC)**: 1ª tentativa (slab `coffeeTable` + monitor esticado + retângulo de cor) ficou "muito ruim" (user). **Refeito**: usa o desk LimeZu **Conference Hall #30** inteiro (32×64, mesa de madeira + monitor no pedestal — mesma família das mesas boas), só **recolorindo os pixels da tela** (azul `B≥150 & B>R+40 & B>G+25`) na cor do setor (Dev azul / Dados verde / Infra laranja / Fin roxo), mantendo sombreamento (`f=B/227`). 4 PNGs `client/public/assets/interiors/desks/desk_{dev,dados,infra,fin}.png` 32×64. `AssetLoader.DESK_SPRITES`. **`FurnitureItem.tex`** (override só de textura — `type` continua `"desk"` pra reserva/overlay/spawn/`allDesks` não quebrarem); `drawFurniture`+editor usam `item.tex || item.type`. `addWorkstation` define `tex` por `tileY` (Dev y<11, Dados<21, Infra<31, Fin), usa `HITBOXES.desk_pc` (32×28, não os 96 do desk procedural) e **removeu o `monitor` separado**. `renderDeskOverlay` ajustado pra mesa 32×64 (moldura 52×92 em +16). office_1/office_2 (diretorias) seguem desk procedural+monitor antigos. **Ajuste final (2026-05-18)**: a tint por depto (`deskpc_*`) também ficou ruim ("falta algo"). Depois o `desk_pc1`/`desk_office` (C30/#45, 32px) ficaram "cortados dos dois lados" — eram **segmentos** de desk modular. `desk_long` (192×80, bancada) ficou "interessante mas não parece mesa de trabalho". **Decisão final (user 2026-05-18)**: LimeZu não tem "computer desk" pronto inteiro (desks são modulares). desk_office (#45) ficou estreito demais em jogo. Ref do user = desk LARGO de madeira + monitor. **Final**: `desk_work` = composição `#1+#2+#1↔` (Conference Hall, **128×80**, mesma família das mesas aprovadas) — desk largo limpo. `addWorkstation` = `desk_work` + `monitor` (`y-22`, depth 2, objeto nativo) + cadeira (`y+40`). `HITBOXES.desk_work` 116×48. `makeEditItem` (editor) usa `desk_work`. Desks a cada 6 tiles (128 < 192) = individuais com folga. `desk_long`/`desk_office`/`desk_pc*`/etc seguem na paleta como opção.
- ✅ FEITO (2026-05-17) — **visual da sala de Segurança**: sprites LimeZu **pago** do tema TV/Film Studio (`23_Television_and_Film_Studio`) em `client/public/assets/interiors/security/` — `cctv_screen/2/3` 64×64 (monitores com feed de câmera), `security_console` 32×48, `server_rack` 32×32, `security_camera` 32×64. `AssetLoader` carrega via `SECURITY_SPRITES` (key==type). `OfficeLayout` Segurança reescrita: parede de 4 monitores CCTV no topo + 2 consoles com cadeiras + rack + câmera + planta. HITBOXES + `EDITOR_FURNITURE_TYPES`. **Verificado**: a sala segue **no-entry pra todos** — `refreshDynamicWalls` sempre empurra o retângulo inteiro de `security_room` (de `layout.rooms`, definido no código, preservado por `applyLayoutOverride` que só troca furniture/walls) → `tryMove`/`checkCollision` bloqueiam. O editor **não remove** a sala (mexe só em furniture/walls; `rooms` é do código; `refreshDynamicWalls` recalculado em todo `rebuildLayout`).
- ✅ FEITO (2026-05-17) — **2º andar + escada rolante**: mundo estendido (`H_TILES` 55→85, 2560×2720; `worldHeight`/`WORLD_H` idem). Zona `floor2` FECHADA (x10 y60 w60 h24, sem openings — só via escada). `Player.floor` (1|2) no schema. `ESCALATORS` (pads + destino) espelhado client (`OfficeLayout`) ↔ server (`OfficeRoom`). `tickEscalators` (250ms): pisou no pad do seu andar → server seta x/y/floor/zoneId + manda `floor:moved` → client `forceTeleport`+`setMyFloor` (sem race authoritative-light); cooldown 2s; limpa bolha/deskSeat ao trocar de andar. Áudio **100% isolado** entre andares: regra de `floor` no `SpatialAudio.updateVolumes` ANTES de tudo (`myInfo.floor!==info.floor → 0`), plumbado via `onPositionsUpdate`. Avatares do outro andar **escondidos** (loop de remotos: `setVisible(pf===myFloor)`, exceto no editor). HUD: "🛗 N pessoas no 2º andar/térreo". Sidebar: badge "🛗 2º andar". Escada = item `fixed` (procedural `escalator` no SpriteFactory; `crate` p/ caixas do 2º andar): `applyLayoutOverride` SEMPRE re-anexa fixos e tira fixos do override (não move/apaga nem some por override antigo); no editor a escada aparece travada (sem drag/select). 2º andar começa só com caixas num canto; interior editável (mesmo `map_layout`). **Caveat**: override de mapa antigo (pré-2º-andar) não tem as paredes do floor2 até "Restaurar layout padrão" ou re-salvar. **"Outra dimensão" (fc2e34f/1ee19b7)**: o user reclamou que os 2 andares apareciam no mapa estendido. `OfficeScene.applyFloorView()` prende a câmera ao andar atual (térreo y 0..1760 / 2º andar y 1920..2720, gap nunca visível) e esconde mobília/paredes/labels do outro andar (classifica por `y >= FLOOR2_Y0`); no editor libera os 2 (admin edita ambos). Chamado em createMyAvatar/setMyFloor/rebuildLayout/enter+exitMapEditor; `floor:moved` faz setMyFloor ANTES do forceTeleport. `MiniMap` recebe `myFloor` e recorta/filtra só o andar atual.
- ✅ FEITO (2026-05-17) — **porta da Segurança nunca abre + painel de fechadura**: `tickDoors` trata `door-security_room` à parte — força `open=false` sempre; se um player fica "na frente" (insiste), manda `security:locked` com throttle por player (`lastBlockedNotify`, 2s). No cliente, `SecurityLockModal` mostra um painel de fechadura eletrônica (display + teclado numérico + leitor de digital 🫆); qualquer tentativa (4+ dígitos, Enter ou digital) → "ACESSO NEGADO" + shake; Esc/X fecha. Server-only + 1 componente client. NPC guarda não usa porta/colisão, não afetado.
- **[PRIORIDADE — ✅ CONCLUÍDA] controles de volume:**
  - (b) ✅ slider de **volume de saída/peers** > 1.0: per-peer `GainNode` (Web Audio) substituindo `audioElement.volume`. `audioPrefs` persiste; `SpatialAudio.setPeerGain` ao vivo; slider no painel 🎧.
  - (a) ✅ **ganho do microfone** > 1.0: pipeline próprio — `getUserMedia` (autoGainControl OFF) → MediaStreamSource → GainNode → MediaStreamDestination → `LocalAudioTrack` publicada. Toggle de mic = `micTrack.mute/unmute` (preserva o ganho, NÃO usa mais `setMicrophoneEnabled` quando o pipeline está ativo); troca de device = rebuild do grafo + unpublish/publish; ganho ao vivo via `setMicGain`; fallback pro `createLocalTracks` se o pipeline falhar. Slider no painel 🎧. **Câmera continua gerenciada pelo LiveKit (não tocada).**
- ✅ FEITO (commit a seguir) — seleção de microfone + saída de áudio: `<select>` no painel 🎧 (AudioTestScreen) com `enumerateDevices`; `audioPrefs.ts` persiste em localStorage; SpatialAudio usa o mic escolhido no `createLocalTracks` e troca ao vivo via `room.switchActiveDevice('audioinput'/'audiooutput')`. Saída via setSinkId (LiveKit), quando suportado.
- áudio/microfone: relatos de microfone abafado. Adicionar UI pra (a) escolher dispositivo de entrada (microfone) — `enumerateDevices` + `<select>` no painel de áudio/vídeo, (b) ajustar ganho do microfone, (c) ajustar volume de saída/peers
- ✅ FEITO — câmera "primeiro plano em sala": fora do open space (`currentZoneId !== "open"`) os vídeos dos peers visíveis vão pra um grid maior (220×165) centralizado no topo; no open space ficam na coluninha lateral (120×80).
- ✅ FEITO — espelhar vídeo local: toggle no painel 🎧 (`audioPrefs.mirrorSelf`, default true), aplicado no self-view (scaleX -1/none) na hora.
- ✅ FEITO — volume: ganho do peer já passa de 1.0 (Web Audio) **+ slider individual por peer**: `audioPrefs` guarda mapa `userId→multiplicador` (persiste, range 0–2; default 1 não ocupa espaço); `SpatialAudio.setPeerVolumeFor/getPeerVolumeFor` chaveado por `userId` (estável entre sessões, ao contrário da identity LiveKit com timestamp); `applyPeerVolume` multiplica `vol * peerMasterGain * perPeer`. UI: slider 🔊 no rodapé de cada card de vídeo (`onpointerdown` faz `stopPropagation` pra não arrastar a câmera)
- redesign do mapa baseado em print de referência enviado pelo user (verificar Downloads/Erro.jpeg ou similar — não localizado ainda) — possivelmente reorganizar departamentos, mobília, cores
- ✅ FEITO (2026-05-18) — **área verde ao redor do mapa (sem acesso)**: `SpriteFactory` ganhou `grass`/`tree`/`bush` procedurais. `OfficeScene.drawOutsideDecor()` põe um tileSprite de grama (depth -200) + árvores/arbustos numa moldura `OUTER_MARGIN`=160px em volta do térreo. A câmera do **térreo** abre `-OUTER_MARGIN` (mostra a moldura) mas o piso de madeira/borda fica só no prédio (`floorB` no `setRegion`). Avatar **não acessa**: `get maxY` por andar (térreo trava em `FLOOR1_H-PLAYER_HALF`=1744) aplicado nos 4 clamps de Y (move/teleport/nav). 2º andar não tem moldura (sala fechada). Roads ficaram de fora (opcional).
- ✅ FEITO (commit `1f8d269`) — sidebar mostra todos cadastrados (online + offline): `presence.ts` (Set global de userIds), endpoint `GET /users` autenticado, sidebar mescla diretório com `state.players` (online em tempo real + sessionId pras ações), bolinha verde/cinza
- ✅ FEITO — sidebar: botão **🪑 "ir até a mesa de X"** (funciona com o dono **offline**): client lê `roomRef.state.desks` (hidratado do Postgres no boot → contém reservas de offline também) montando `deskOfUser` (userId→deskId); clica → `navigateTo` (caminhada A*, igual "minha mesa", coerente com a preferência de andar em vez de teleportar) até `desk.x, desk.y+28` via `getDeskCatalog()`. Online: botão extra no grupo de ações. Offline: linha de ação só com 🪑 (desabilitado/translúcido se sem mesa). Sem mudança no server.
- ✅ FEITO (revisado) — indicador "está falando agora": **gap corrigido** — `setMySpeaking` existia mas nunca era chamado e `ActiveSpeakersChanged` só varria `this.peers` (remotos), ignorando o participante local. Agora `SpatialAudio` tem `onLocalSpeaking` (compara `localParticipant.identity` contra a lista de speakers, com dedupe via `localSpeaking`) → App liga em `setMySpeaking` (anel verde no próprio avatar) + adiciona o próprio `room.sessionId` ao `activeSpeakerIds` (badge 🎙️ no "você" da sidebar). Remotos já funcionavam (anel via `setRemoteSpeaking` + badge na sidebar).
- ✅ FEITO (commit `4657878`) — **mesa = zona de áudio** (mesa-conversa): tecla G ativa modo fantasma (transparente + atravessa tudo); perto de mesa livre ocupa 1 de 3 slots (sentado/esq/dir, `Player.deskSeat`/`deskSlot`); quem está na mesma mesa forma zona de áudio **isolada total** (regra `deskSeat` no SpatialAudio, antes de zona/bolha). Coexiste com a reserva (E). G sentado ou afastar sai.
- **[pedido pelo user 2026-05-16] bolha de conversa privada dentro de sala cheia**: estando numa sala com muita gente, poder abrir uma "bolha" entre 2 (ou +) pessoas pra conversa reservada. Quem está na bolha se ouve em volume normal; áudio da bolha pra quem está fora dela (mas na mesma sala) fica BAIXO (não mudo — atenuação tipo 15%), e vice-versa. Esboço técnico: `Player.bubbleId` no schema do Colyseus (vazio = sem bolha) → mudança de schema exige rebuild de server+client (gotcha conhecido). Fluxo de criar: ação explícita (clicar no avatar / botão na sidebar) → convite → ao aceitar, ambos recebem o mesmo `bubbleId`. Em `SpatialAudio.updateVolumes()` adicionar camada ANTES da regra de distância: mesmo `bubbleId` não-vazio → volume 1.0; `bubbleId` diferente/vazio com o outro numa bolha → volume baixo (~0.15) em vez do cálculo normal. Cuidar interação com zona `__pending` (sala trancada) e com o caso de a bolha cruzar zonas. Sair da bolha: botão + auto-limpar no `onLeave`. Decidir se bolha some quando os dois se afastam muito ou se é persistente até fechar manualmente.
- NOTA: alguns dos pedidos do user já existem no produto. Confirmar com ele se entendi certo:
  - "mesas requisitadas" — JÁ EXISTE (tecla E pra reservar/liberar; reservas persistem em desk_reservations). Talvez ele queira fluxo diferente (modal/click em vez de E?)
  - "salas com áudio só pra quem está dentro" — JÁ EXISTE (Fase 7, zoneId no Player, SpatialAudio bloqueia entre zonas diferentes)
  - "alerta pra enviar pra pessoa" — talvez já cubra com chat DM + convite via 👋 na sidebar. Confirmar se quer notificação push/sonora extra

## Decisões técnicas e seus porquês

- **Colyseus em vez de Socket.io puro**: já vem com state sync binário (delta encoding), rooms, matchmaking, lifecycle. Economizou semanas.
- **Phaser em vez de PixiJS**: maduro, físicas opcionais, animações prontas. Mas PixiJS seria mais leve.
- **LiveKit Cloud em vez de self-host**: WebRTC self-host exige TURN/STUN, UDP, IP fixo. Railway não suporta UDP. Cloud é simples e free tier comporta MVP. Migrar pra self-host é trivial (só troca URL).
- **Sprites programáticos em vez de asset pack**: zero custo, zero dependência externa, fácil de iterar. Visual fica "indie" mas funcional. Trocar por pack do LimeZu ($15) é decisão futura.
- **Postgres no Railway via Drizzle**: SQL idempotente no boot (`CREATE TABLE IF NOT EXISTS`) em vez de migrations versionadas. Schema atual é pequeno; quando crescer, migra pra `drizzle-kit migrations`.
- **Auth email+senha (não OAuth Google)**: time decidiu não restringir domínio e não depender de provider externo. Bcrypt local + JWT são suficientes pra MVP interno.
- **JWT em `localStorage` (não cookie httpOnly)**: simplifica CORS entre Vercel e Railway. Trade-off: XSS pode roubar o token. Aceitável pra uso interno; revisitar se o produto sair pra externo.

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
