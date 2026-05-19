# Backlog — Virtual Office (ProjetoGaTher)

Gerado em 2026-05-16. Fonte: seção Backlog do `Claude.md` + pedidos recentes do user.
Legenda: 🔴 prioridade · 🐞 bug · 🟢 feito (mantido como referência) · ⚪ normal · ❓ a confirmar

---

## 🔴 Prioridades (áudio ruim — reportado pelo user 2026-05-16)

- **Controles de volume** (parcial):
  - (b) 🟢 [FEITO] volume de saída/peers > 1.0 — per-peer `GainNode` (Web Audio) no lugar de `audioElement.volume`; persiste em localStorage; slider no painel 🎧; `SpatialAudio.setPeerGain` ao vivo.
  - (a) 🟢 [FEITO] ganho do **microfone** > 1.0 — pipeline próprio: getUserMedia(autoGainControl off) → MediaStreamSource → GainNode → MediaStreamDestination → `LocalAudioTrack` publicada. Mic toggle = mute/unmute da track (mantém o ganho); troca de device = rebuild do grafo + republish; ganho ao vivo via `setMicGain`. Fallback pro createLocalTracks se falhar. Slider no painel 🎧. **Áudio: prioridade concluída.**
- 🟢 [FEITO] **Seleção de microfone + saída** — `<select>` no painel 🎧 com `enumerateDevices`; `audioPrefs.ts` persiste em localStorage; SpatialAudio aplica no `createLocalTracks` e troca ao vivo via `room.switchActiveDevice`. Saída por setSinkId (LiveKit) onde suportado.

---

## 🐞 Bugs

- 🟢 [FEITO 2026-05-18 `0de3436`+`6f9a93c`] **visual da mesa = mesa `desk` procedural em tudo** (decisão do user: paridade editor↔mapa, sem tex/monitor; cadeira+assento recalibrados y+40; overlay 108×96). CAVEAT: override de mapa salvo substitui o default → "Restaurar layout padrão"/re-salvar pra ver. Histórico das tentativas rejeitadas abaixo (não repetir): ~~🅿️ visual da mesa não agrada~~ — atual = `desk_work` (Conference `#1+#2+#1↔` 128×80) + `monitor` + cadeira; ainda "não ficou". Tentativas que NÃO agradaram (não repetir): slab coffeeTable + monitor esticado; `deskpc_*` tint por depto (tela vira bloco chapado); `#30`/`desk_pc1` e `#45`/`desk_office` (segmentos modulares → "cortado dos dois lados" / estreito 1×2); `desk_long` 192×80 (bancada — "interessante mas não parece mesa de trabalho"). Constatação: **LimeZu não tem sprite único de "computer desk" pronto** (é modular: superfície + objeto PC). Ref do user (Image #6): desk largo de madeira + monitor. **Pra retomar:** ou achar a fonte exata dos desks ricos do print original do user (Image #3 — não localizada no pack), ou alinhar com ele uma composição específica (desk + qual objeto PC, proporção). Não mexer sem novo input dele.
- 🟢 [FEITO 2026-05-18] **Recusar acesso a sala trancada não expulsava** — `handleAccessRespond` (accepted=false) agora manda `x,y` do eject no `access:response`; o client faz `sceneRef.forceTeleport(x,y)` (authoritative-light sobrescreveria senão). Mesma solução do bug do visitante. (Convite 👋 sempre esteve OK.)
- 🐞 [BACKLOG 2026-05-18, user "deixa no backlog"] **BUG-011 do relatório QA — saída do lobby/Recepção travada (movimento parece lento)** — visitante (e provavelmente qualquer um) "raspa" em hitbox ao tentar sair do lobby pelo vão direito, dando sensação de avatar lento/preso. **Não é** restrição de visitante (server `handleMove` não limita visitante, só world+`MAX_DELTA`) **nem** zoom (default 1.3, OK). Hipótese: colisão na Recepção reescrita — zona `lobby` (x0-14 y18-26 tiles) com `opening side:right pos:4` → vão ≈ x448 / y704-787px; `sofa` (x352 y768) + `plant` (x416 y800) na banda do vão. **Precisa validação visual (deploy+print)** pra ajustar posição do sofá/planta e/ou alargar a abertura (~2.6→~3.5 tiles) sem chutar geometria (lição da saga das mesas 🅿️ acima). Alternativa de UX: auto-walk (clique→A*, já existe `navigateTo`). **Os outros 12 bugs do relatório (`relatorio-bugs-ga-ther.md`, Downloads) foram corrigidos e pushados** — commits `342222b` (001-004), `487c7de` (005-007), `0b672ad` (008/009/010/012).

### Resolvidos
- 🟢 [FEITO `549beb1`] **NPC segurança fica do lado de fora da porta** — `handleRoomLock` usa a heurística `doorOnLeftWall` (porta esquerda → oeste; direita/diretorias → leste) + `direction` coerente. O guarda também caminha (rota A*) até o posto.

---

## 🟢 Feito recentemente (referência)

- **Auto-unlock ao sair da sala** (`acdd55e`) — se o dono anda pra fora ou desconecta, a sala destranca sozinha (não fica presa).
- **Bolha de conversa privada** (`31e2e6b`) — N pessoas; dentro da bolha áudio cheio, fora (mesma zona) 0.15; criar via 🫧 na sidebar + modal; sair manual OU por proximidade (>250px de todos os membros); dissolve com ≤1. `Player.bubbleId` no schema. *Pendente de validação via deploy + teste manual.*

---

## ⚪ Features pedidas pelo user (2026-05-16)

- 🟢 [FEITO `79575fe`+`ce656c0`] **Modo visitante** — aba "Visitante" (nome + código de uso único OU senha fixa env `VISITOR_PASSWORD`); `/visitor/code` (qualquer logado) + `/visitor/login`; JWT role=visitor (sem Postgres); `Player.role`+`visitorOk`; não reserva mesa; áudio mudo total até host autorizar (painel escolher host → `visitor:request` → modal host → `visitor:respond`). Autorização persiste até meia-noite BRT (`visitorAuth.ts`, cache + `app_meta`/`visitor_auth`, sobrevive a restart). Setar `VISITOR_PASSWORD` no Railway pro caminho de senha.
- 🟢 [FEITO] **Sala de Segurança bloqueada pra todos** — `refreshDynamicWalls` adiciona o retângulo da `security_room` como blocker permanente em `dynamicWalls`. Guarda NPC não usa `tryMove` nem A* usa `dynamicWalls` → não afetado. Admin também barrado (sem exceção por ora).

---

## ⚪ Backlog geral

### Auth / infra
- 🟢 [FEITO] **promover usuário a admin pela UI** — `adminStore` (app_meta `extra_admins`, cache no boot), `isAdminEmail` = env OU extra, `PATCH /admin/users/:id/admin {make}` (só admin; bloqueia demover env-admin/self), botão 👑 no `AdminPanel`. Env (`ADMIN_EMAILS`) segue como bootstrap. Promovido vira admin no próximo login.
- esqueci-a-senha (precisa SMTP)
- 🟢 [FEITO] mobile responsivo — viewport anti-zoom + safe-area + `100dvh`; pinça pra zoom (`OfficeScene`); botão **G** no `MobileControls` (conversa de mesa, antes inacessível); cards de vídeo menores e reposicionados pra não cobrir os controles; LoginScreen fluido (`min(380px,100%)`); modais com `maxWidth/maxHeight/overflow` (cardStyle/modalStyle globais + AudioTestScreen). Base que já existia: `useIsMobile`, joystick+E, HUD compacto, sidebar fullscreen, `Scale.RESIZE`.
- editor de mapas
- 🟢 [FEITO] **cor de parede editável no map editor** — `Wall.color?` (default `WALL_COLOR`); `drawWalls`/`renderEditWalls` usam (stroke/brilho via `shadeNum`); `setWallColor` recolore selecionada + vira cor do pincel; `<input type=color>` no painel quando pincel parede/parede selecionada; persiste no `map_layout`.
- 🟢 [FEITO] **categorias + busca na paleta do editor** — `FURN_CAT`/`FURN_LABEL`/`FURN_CATEGORIES`; input de busca + chips de categoria; grade filtra por categoria+texto; tiles com rótulo PT.
- 🟢 [FEITO] **editor "edição limpa"**: `setActorsVisible(false)` (avatar/remotos/NPC/balões somem), sem menu de contexto de avatar (só pan), `SpatialAudio.setEditorMute` zera peers, joystick mobile escondido. Sair restaura.
- 🟢 [FEITO] **editor: adicionar itens DENTRO das salas** — causa: `if (onObj) return` tratava parede = móvel. Agora `onFurn`/`onWall` separados; pincel só bloqueado por móvel existente. Parede/sala não bloqueiam o add.
- 🟢 [FEITO] **editor de mesa** — toda `desk` colocada no editor vira reservável: `makeEditItem` gera `deskId` único + `tex:"desk_pc1"`; server resolve via `deskById` (fixas OU override) em claim/spawn/seat/etc; `pruneOrphanReservations` (boot + map:reload) → mesa apagada perde a reserva (state+DB). `OfficeScene.goToDesk` usa o layout vivo → "ir até minha mesa/de X" navega pras editor-desks tb.

### Interação
- 🧱 [ESPECIFICADO 2026-05-18 — BLOQUEADO em assets do user] **editor de avatar modular completo**. Escopo TRAVADO com o user:
  - **Slots (4):** corpo (tom de pele) · cabelo (penteado+cor) · roupa (outfit) · chapéu/acessório (com opção "nenhum"). Ordem de empilhamento: corpo → roupa → cabelo → chapéu.
  - **Estratégia de cor:** decidir DEPOIS de ver os assets (variantes prontas do pacote vs recolor por tint).
  - **ASSETS (user extrai do LimeZu Character Generator, pago)** em `client/public/assets/characters/parts/{body,hair,outfit,hat}/`. Cada PNG: **384×32, frames 16×32, 24 frames (6/direção), ordem right/up/left/down**, fundo transparente, alinhado ao mesmo esqueleto dos Adam/Alex/Amelia/Bob. 3 sheets por variante: `<slot>_<id>_idle.png`, `_run.png`, `_sit.png` (ex: `hair_03_idle.png`). `hat` inclui um id "none" (sem PNG / camada vazia).
  - **Arquitetura (codar quando assets chegarem):** avatar = `Container` com N `Sprite`s empilhados, todos tocando a MESMA anim key por direção/estado (vale meu avatar, remotos, preview, mini-avatar). Persistência: 1 campo só `appearance` (JSON string) no `Player` (schema Colyseus — exige rebuild server+client) e coluna nova `appearance` em `profiles` (idempotente). Back-compat: quem só tem `characterId` ganha `appearance` default. UI: modal "🎨 Editar avatar" com carrossel por slot + preview ao vivo compondo as mesmas camadas (PT). `bodyColor`/`hairColor` legados (procedural) saem de cena pro avatar real.
  - **Assets LOCALIZADOS (2026-05-18/19):** `Downloads\Assets Pagos\moderninteriors-win\2_Characters\Character_Generator\` (Bodies 9, Hairstyles 200, Outfits 132, Accessories 84, Eyes; ordem Body→Eyes→Outfit→Hair→Accessory). Bundled tool oficial: `Character Generator 2.0 Linux Build`. Atlas do gerador = **896×656, frame 16×32, pitch 32, y0=9, ~20 anims, 56 cols** — formato ≠ do jogo (legado 384×32, 24f, 6/dir right/up/left/down). User optou por **pipeline de extração** (não o tool). **Decode parcial:** row0=idle, row1≈walk, row2≈run, row3=sleep; falta travar rows idle/walk/sit + layout de direção interno (remap p/ right/up/left/down) — iterativo, auto-validável contra `Adam_*` do repo. **Esforço grande: tratar como work item dedicado.** Detalhes/medições em memória `editor-avatar-modular-spec`.
- 🟢 [FEITO 2026-05-18] **"sentar" quebrava o avatar (pose errada/glitch)** — causa: spritesheet `_sit` tem a arte sentada numa posição diferente dentro da célula 16×32 → ao trocar idle→`_sit` na mesma origem, a figura desalinhava da cadeira (flutuando/cortada). Decisão do user (opção segura): na cadeira o avatar fica **idle virado pra mesa** (dir da `chairSpot`), sem usar o sheet `_sit`. Zero glitch, zero iteração. Anims `_sit` seguem criadas no AssetLoader (não usadas; reusáveis se um dia tiver sheet/anim adequada).
- 🟢 [FEITO] **sprint com Shift** — `cursors.shift?.isDown ? 2 : 1` multiplica dx/dy; pior caso ~54px/sync < MAX_DELTA(100), sem rubberband.
- 🟢 [FEITO] **não mostrar "mesa reservada" no join** — `deskToastSinceRef` (join+5s); só toasta reserva ATIVA pós-join.
- 🟢 [FEITO] **bolha sem convite** — `handleBubbleInvite` cria/junta a bolha direto; removidos modal/handlers de convite; 🫧 = "Bolha aberta com X".
- 🟢 [FEITO] **assets de mesa no editor** — `EDITOR_FURNITURE_TYPES` += desk/monitor/deskpc_* (HITBOXES deskpc_*); admin arrasta os desks LimeZu no editor (decorativo, não reservável). Pra escolher o desk que gostar.
- 🟢 [FEITO] **sentar na cadeira ao chegar** — anim `${id}_${dir}_sit`; `chairSpots`+`onChair(26px)`; parado em cadeira → `sit`; volta walk/idle ao mover (meu avatar + remotos). **Refino**: `chairSpots` guarda `dir` calculado pela mesa mais próxima → senta de frente pra mesa. **Fix:** `checkCollision` ignora `type:"chair"` (cadeira atravessável) senão não dá pra ficar em cima.
- 🟢 [FEITO] menu de contexto right-click no avatar: "📢 Pedir pra vir aqui" (`summon` → toast + caminha até você, sem modal) + "📍 Ir até". Pan no vazio preservado.
- 🟢 [FEITO] **melhorar a abertura das portas** — antes "só sumia" (setVisible/alpha instantâneo). Agora porta dupla: 2 folhas deslizam pros lados + fade (tween 280ms) ao abrir/fechar; sem animar na 1ª render. Colisão segue o estado lógico. Client-only.

### Visual / mapa
- 🟢 [FEITO] **visual da Recepção** — `reception_desk` (Conference `#1+#2+#1↔` 128×80) = balcão; lobby reescrito: balcão + recepcionista + whiteboard/tv boas-vindas + plantas + área de espera (sofás+coffeeTable+cadeiras). `RECEPTION_SPRITES`, HITBOXES, EDITOR/categorias.
- 🟢 [FEITO] **visual da Copa (cozinha real)** — sprites LimeZu pago (Kitchen Singles) em `client/public/assets/interiors/kitchen/`; `AssetLoader` carrega cada PNG key=type (`KITCHEN_SPRITES`); `OfficeLayout` Copa reescrita: bancada (geladeira+fogão+coifa+pia+balcão+cafeteira+microondas) + mesa+4 cadeiras+planta; HITBOXES por tipo; tipos no `EDITOR_FURNITURE_TYPES`. Pipeline de asset piloto validado → replicável pra Recepção/Segurança. (Se houver override de mapa no Postgres, re-salvar pra ver.)
- 🟢 [FEITO] **mesas na proporção do print** — `meetingTable`/`kitchen_table`/`coffeeTable` recompostas de peças LimeZu Conference Hall (ponta+meio×N+ponta espelhada), madeira clara larga; `client/public/assets/interiors/tables/` + `TABLES_SPRITES` (substitui procedural/tileset; `coffeeTable` saiu de FURNITURE_TILES, `kitchen_table` de KITCHEN_SPRITES); HITBOXES atualizados.
- 🟢 [FEITO, refeito] **workstations por departamento (desk+PC)** — 1ª versão (slab+monitor esticado) ficou ruim; refeito com desk LimeZu Conference Hall **#30** inteiro (32×64) só recolorindo a tela por setor. `DESK_SPRITES`; `FurnitureItem.tex` (type continua "desk"); `HITBOXES.desk_pc` (32×28); `addWorkstation` tex por tileY, sem monitor separado; `renderDeskOverlay` ajustado (52×92).
- 🟢 [FEITO] **visual da sala de Segurança** — sprites LimeZu pago (TV/Film Studio) em `client/public/assets/interiors/security/` (`cctv_screen/2/3`, `security_console`, `server_rack`, `security_camera`); `SECURITY_SPRITES` no `AssetLoader`; layout: parede de 4 monitores CCTV + 2 consoles+cadeiras + rack + câmera + planta. **Verificado**: sala segue no-entry pra todos (blocker de `layout.rooms` no `refreshDynamicWalls`) e o editor não consegue removê-la (`rooms` é do código, não vai no override).
- 🟢 [FEITO] **porta da Segurança não abre + aviso ao insistir** — `tickDoors` força `door-security_room` sempre fechada; manda `security:locked` (throttle 2s/player) quando a pessoa insiste na frente.
- 🟢 [FEITO] **2º andar + escada rolante** — mundo estendido (2560×2720), zona `floor2` fechada (só via escada), `Player.floor`, `ESCALATORS` client↔server, `tickEscalators` (server-autoritativo + `floor:moved`/`forceTeleport`), áudio 100% isolado entre andares (regra de floor no SpatialAudio), avatares do outro andar escondidos, HUD "🛗 N no 2º andar/térreo" + badge na sidebar, escada `fixed` não-editável (re-anexada em applyLayoutOverride), 2º andar começa com caixas + interior editável. Caveat: override antigo sem paredes do floor2 → "Restaurar layout padrão".
- 🟢 [FEITO] **painel de fechadura da Segurança** — `SecurityLockModal`: display + teclado numérico + leitor de digital; qualquer tentativa (4+ dígitos / Enter / digital) → "ACESSO NEGADO" com shake; Esc/X fecha. Server manda `security:locked`.
- **redesign do mapa** baseado em print de referência do user (verificar `Downloads/Erro.jpeg` ou similar — não localizado ainda) — possivelmente reorganizar departamentos, mobília, cores
- 🟢 [FEITO] **área verde ao redor do mapa** — `grass`/`tree`/`bush` procedurais; `drawOutsideDecor()` (moldura OUTER_MARGIN 160px, depth -200); câmera do térreo abre a margem mas piso fica no prédio; avatar travado por `maxY` (térreo até 1744). 2º andar sem moldura. Ruas: ficou de fora (opcional).

### NPC
- 🟢 [FEITO `549beb1` (A*) + `99524f7` (refino portas)] **NPC segurança com pathfinding real** — `pathfinding.ts` é A* completo (grid 16px, min-heap, string-pulling, sem corte de quina, evita móveis+paredes). O guarda usa `findPath` e **caminha a rota** frame-a-frame (`advanceSecurityNpcs`); volta caminhando à origem ao sair (fade-out só fallback sem rota). "Teletransporte+fade" não existe mais. **Refino `99524f7`**: `findPath` aceita `extraWalls?` opcional; o guarda passa `dynamicDoorWalls` (só portas fechadas, sem o blanket no-entry da Segurança) → não traça rota cruzando porta que ele não abre. `navigateTo` do player segue sem extraWalls (porta abre na aproximação dele).

### Áudio / câmera
- áudio/microfone: relatos de microfone abafado — UI pra (a) escolher dispositivo de entrada, (b) ajustar ganho do mic, (c) ajustar volume de saída/peers *(coberto pelas prioridades acima)*
- 🟢 [FEITO] câmera "primeiro plano em sala": fora do open space, peers num grid maior centralizado; no open space, coluninha lateral
- 🟢 [FEITO] câmera "espelhar" o vídeo local — toggle no painel 🎧 (audioPrefs, default ligado)
- 🟢 [FEITO] volume: limite do ganho do peer já passa de 1.0 (Web Audio) + **slider individual por peer** — `audioPrefs` guarda mapa userId→multiplicador (persiste, 0–2); `SpatialAudio.setPeerVolumeFor/getPeerVolumeFor` (chaveado por userId, estável entre sessões); slider 🔊 no rodapé de cada card de vídeo, multiplica sobre o ganho master.
- 🟢 [FEITO `4657878`] mesa = zona de áudio (mesa-conversa): tecla G (fantasma) → ocupa 1 de 3 slots numa mesa; mesma mesa = áudio isolado total. Coexiste com reserva (E).

### Sidebar
- 🟢 [FEITO `1f8d269`] mostrar usuários **offline** — `GET /users` (presence.ts + endpoint autenticado); sidebar mescla diretório com state.players, bolinha verde/cinza, ações só pros online
- 🟢 [FEITO] botão **🪑 "ir até a mesa de X"** (online **e offline**) — client lê `roomRef.state.desks` (hidratado do Postgres no boot, inclui offline) → `deskOfUser` (userId→deskId); clica → `navigateTo` (caminhada A*, igual "minha mesa") até a mesa via `getDeskCatalog()`. Offline sem mesa = botão translúcido/desabilitado. Sem mudança no server.
- 🟢 [FEITO — revisado] indicador "está falando agora" (🎙️ animado) — gap corrigido: `ActiveSpeakersChanged` só via remotos; agora `SpatialAudio.onLocalSpeaking` detecta o participante local → anel verde no próprio avatar (`setMySpeaking`, que existia mas nunca era chamado) + badge 🎙️ no "você" da sidebar. Remotos já ok.

---

## ❓ A confirmar com o user (talvez já exista)

- "mesas requisitadas" — JÁ EXISTE (tecla `E` reserva/libera; persiste em `desk_reservations`). Talvez queira fluxo diferente (modal/click em vez de `E`)?
- "salas com áudio só pra quem está dentro" — JÁ EXISTE (Fase 7, `zoneId` no Player, SpatialAudio bloqueia entre zonas diferentes).
- "alerta pra enviar pra pessoa" — talvez já coberto por chat DM + convite via 👋 na sidebar. Confirmar se quer notificação push/sonora extra.
