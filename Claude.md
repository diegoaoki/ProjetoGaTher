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
- Quem está em `ADMIN_EMAILS` (env) vê o botão 🛡️ no HUD em jogo.
- Endpoints: `GET /admin/users` (lista), `PATCH /admin/users/:id/password` (reset), `DELETE /admin/users/:id` (apagar).
- Middleware `requireAdmin` em `server/src/auth/admin.ts` confere o email do JWT contra a env.
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
- ✅ FEITO — editor "edição limpa": ao abrir o editor, `setActorsVisible(false)` esconde meu avatar + remotos + NPC segurança + balões de vídeo/fala; right-click NÃO abre menu de contexto de avatar (só pan, `if (!this.editMode)`); `SpatialAudio.setEditorMute(true)` zera o volume de todos os peers; joystick mobile escondido (`!mapEditorOpen`). Sair restaura tudo (`setActorsVisible(true)`, `setEditorMute(false)`).
- ✅ FEITO — editor: adicionar itens DENTRO das salas — a causa era `if (onObj) return` tratando parede igual a móvel (clicar dentro de sala = sobre parede → bloqueava). Agora `onFurn`/`onWall` separados: pincel de móvel só é bloqueado por móvel existente (pra selecionar); parede/sala não bloqueiam mais o add. (Drag-and-drop da paleta já adicionava em qualquer lugar.)
- **[pedido 2026-05-16] criar um editor de mesa**: ferramenta pra definir/editar mesas reserváveis (posição da mesa, da cadeira/assento, `deskId`, talvez quantidade de lugares da mesa-conversa) direto no mapa, em vez de hardcoded em `OfficeLayout.ts` + `server/src/desks.ts`. Provavelmente uma extensão do editor de mapa (modo "mesa"). Detalhar escopo com o user antes de implementar.
- ✅ FEITO — menu de contexto: right-click no avatar de outro player → menu com "📢 Pedir pra vir aqui" (msg `summon` → o outro recebe toast + caminha até você via A*, sem modal) e "📍 Ir até". Right-click no vazio continua dando pan. (sprite do remote interativo + `rpSession` data; hitTestPointer)
- **[pedido 2026-05-16] melhorar a abertura das portas**: revisar o modo como as portas abrem (animação/feedback/timing) — hoje a transição não está boa. Definir com o user o que incomoda (sem animação? brusco? colisão?) e melhorar.
- revisar visual da Recepção — atualmente só sofás + mesa de centro, falta cara de recepção (balcão de atendimento, plantas decorativas, totem/quadro de boas-vindas, possivelmente cadeiras de espera adicionais)
- ✅ FEITO — **visual da Copa (cozinha real)**: sprites do LimeZu **pago** (Kitchen Singles `12_Kitchen_Singles_32x32`) copiados pra `client/public/assets/interiors/kitchen/` (`fridge` 32×80, `stove` 32×64, `counter_sink` 32×64, `counter` 64×64, `coffee_machine` 32×48, `microwave`/`range_hood`/`kitchen_table` 32×32). `AssetLoader.preloadLimezuAssets` carrega cada PNG com key = type (`KITCHEN_SPRITES`); `OfficeScene.drawFurniture` (`add.image(x,y,type)`) usa direto. `OfficeLayout`: bloco da Copa reescrito (bancada na parede de cima: geladeira + fogão + coifa + pia + balcão + cafeteira + microondas; mesa de refeição + 4 cadeiras + planta), HITBOXES por tipo, tipos adicionados em `EDITOR_FURNITURE_TYPES`. Os antigos placeholders `bookshelf`+tag saíram. **Pipeline de asset validado (piloto)** → replicável pra Recepção/Segurança. Nota: se houver override de mapa salvo no Postgres, ele sobrepõe o default — re-salvar no editor pra ver a Copa nova.
- ✅ FEITO (commit `549beb1` + correção do post) — **NPC segurança fica do lado de fora da porta**: `handleRoomLock` agora usa a heurística `doorOnLeftWall` (porta esquerda → guarda a oeste; direita/diretorias → leste), com `direction` coerente. E o guarda caminha (rota A*) até o posto em vez de teleportar.
- NPC segurança com pathfinding real (A* entre móveis/paredes) — substituir o atual "teletransporte + fade" da feature de cadeado de sala. Precisa grid de navegação + algoritmo evitando furniture hitboxes e walls dinâmicas (portas fechadas)
- ✅ FEITO — sala de Segurança bloqueada pra todos: `refreshDynamicWalls` adiciona o retângulo da `security_room` como blocker permanente em `dynamicWalls` (independente da porta). Guarda NPC não usa `tryMove` nem o A* usa `dynamicWalls` → não afetado. (Admin também é barrado — sem exceção por ora.)
- visual da sala de Segurança — hoje só tem desk + 2 monitores + cadeira (placeholder). Falta cara de sala de segurança: painel de câmeras (múltiplos monitores em "wall mount" mostrando feeds do mapa), rack de equipamentos, walkie-talkie/telefone na mesa, possivelmente armário de armas/equipamentos. Usar asset pago moderninteriors-win se houver sprites de segurança/CCTV
- **[PRIORIDADE — ✅ CONCLUÍDA] controles de volume:**
  - (b) ✅ slider de **volume de saída/peers** > 1.0: per-peer `GainNode` (Web Audio) substituindo `audioElement.volume`. `audioPrefs` persiste; `SpatialAudio.setPeerGain` ao vivo; slider no painel 🎧.
  - (a) ✅ **ganho do microfone** > 1.0: pipeline próprio — `getUserMedia` (autoGainControl OFF) → MediaStreamSource → GainNode → MediaStreamDestination → `LocalAudioTrack` publicada. Toggle de mic = `micTrack.mute/unmute` (preserva o ganho, NÃO usa mais `setMicrophoneEnabled` quando o pipeline está ativo); troca de device = rebuild do grafo + unpublish/publish; ganho ao vivo via `setMicGain`; fallback pro `createLocalTracks` se o pipeline falhar. Slider no painel 🎧. **Câmera continua gerenciada pelo LiveKit (não tocada).**
- ✅ FEITO (commit a seguir) — seleção de microfone + saída de áudio: `<select>` no painel 🎧 (AudioTestScreen) com `enumerateDevices`; `audioPrefs.ts` persiste em localStorage; SpatialAudio usa o mic escolhido no `createLocalTracks` e troca ao vivo via `room.switchActiveDevice('audioinput'/'audiooutput')`. Saída via setSinkId (LiveKit), quando suportado.
- áudio/microfone: relatos de microfone abafado. Adicionar UI pra (a) escolher dispositivo de entrada (microfone) — `enumerateDevices` + `<select>` no painel de áudio/vídeo, (b) ajustar ganho do microfone, (c) ajustar volume de saída/peers
- ✅ FEITO — câmera "primeiro plano em sala": fora do open space (`currentZoneId !== "open"`) os vídeos dos peers visíveis vão pra um grid maior (220×165) centralizado no topo; no open space ficam na coluninha lateral (120×80).
- ✅ FEITO — espelhar vídeo local: toggle no painel 🎧 (`audioPrefs.mirrorSelf`, default true), aplicado no self-view (scaleX -1/none) na hora.
- ✅ FEITO — volume: ganho do peer já passa de 1.0 (Web Audio) **+ slider individual por peer**: `audioPrefs` guarda mapa `userId→multiplicador` (persiste, range 0–2; default 1 não ocupa espaço); `SpatialAudio.setPeerVolumeFor/getPeerVolumeFor` chaveado por `userId` (estável entre sessões, ao contrário da identity LiveKit com timestamp); `applyPeerVolume` multiplica `vol * peerMasterGain * perPeer`. UI: slider 🔊 no rodapé de cada card de vídeo (`onpointerdown` faz `stopPropagation` pra não arrastar a câmera)
- redesign do mapa baseado em print de referência enviado pelo user (verificar Downloads/Erro.jpeg ou similar — não localizado ainda) — possivelmente reorganizar departamentos, mobília, cores
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
