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

- 🐞 **Recusar pedido de acesso a sala trancada não expulsa o convidado** (diagnosticado, fix não aplicado) — `handleAccessRespond` (accepted=false) chama `ejectFromRoom()` que seta `player.x/y` no server, mas o jogo é *authoritative-light*: o cliente é dono da posição e sobrescreve no próximo `move` → a pessoa continua dentro. O cliente recebe `access:response{accepted:false}` mas só mostra toast, não reposiciona. **Fix:** mandar as coords do eject no `access:response` e o cliente fazer `forceTeleport(x,y)` quando `accepted===false` (mesma solução do bug do visitante). ~2 arquivos, sem schema. (O fluxo de convite 👋 está correto — só este do cadeado.)

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
- 🟢 [FEITO] **editor "edição limpa"**: `setActorsVisible(false)` (avatar/remotos/NPC/balões somem), sem menu de contexto de avatar (só pan), `SpatialAudio.setEditorMute` zera peers, joystick mobile escondido. Sair restaura.
- 🟢 [FEITO] **editor: adicionar itens DENTRO das salas** — causa: `if (onObj) return` tratava parede = móvel. Agora `onFurn`/`onWall` separados; pincel só bloqueado por móvel existente. Parede/sala não bloqueiam o add.
- ⚪ [pedido 2026-05-16] **editor de mesa**: ferramenta pra definir/editar mesas reserváveis (posição da mesa + assento, `deskId`, lugares da mesa-conversa) no mapa em vez de hardcoded em `OfficeLayout.ts`/`server/src/desks.ts`. Provável extensão do editor de mapa. Detalhar escopo antes.

### Interação
- 🟢 [FEITO] **não mostrar "mesa reservada" no join** — `deskToastSinceRef` (join+5s); só toasta reserva ATIVA pós-join.
- 🟢 [FEITO] **bolha sem convite** — `handleBubbleInvite` cria/junta a bolha direto; removidos modal/handlers de convite; 🫧 = "Bolha aberta com X".
- 🟢 [FEITO] **sentar na cadeira ao chegar** — anim `${id}_${dir}_sit` no AssetLoader; `chairSpots`+`onChair(26px)`; parado em cadeira → `sit` virado "up" (meu avatar + remotos, local sem schema); volta a walk/idle ao mover. MVP sempre "up" (cadeira lateral pode ficar torta).
- 🟢 [FEITO] menu de contexto right-click no avatar: "📢 Pedir pra vir aqui" (`summon` → toast + caminha até você, sem modal) + "📍 Ir até". Pan no vazio preservado.
- 🟢 [FEITO] **melhorar a abertura das portas** — antes "só sumia" (setVisible/alpha instantâneo). Agora porta dupla: 2 folhas deslizam pros lados + fade (tween 280ms) ao abrir/fechar; sem animar na 1ª render. Colisão segue o estado lógico. Client-only.

### Visual / mapa
- revisar visual da **Recepção** — só sofás + mesa de centro; falta balcão de atendimento, plantas, totem/quadro de boas-vindas, cadeiras de espera
- 🟢 [FEITO] **visual da Copa (cozinha real)** — sprites LimeZu pago (Kitchen Singles) em `client/public/assets/interiors/kitchen/`; `AssetLoader` carrega cada PNG key=type (`KITCHEN_SPRITES`); `OfficeLayout` Copa reescrita: bancada (geladeira+fogão+coifa+pia+balcão+cafeteira+microondas) + mesa+4 cadeiras+planta; HITBOXES por tipo; tipos no `EDITOR_FURNITURE_TYPES`. Pipeline de asset piloto validado → replicável pra Recepção/Segurança. (Se houver override de mapa no Postgres, re-salvar pra ver.)
- 🟢 [FEITO] **mesas na proporção do print** — `meetingTable`/`kitchen_table`/`coffeeTable` recompostas de peças LimeZu Conference Hall (ponta+meio×N+ponta espelhada), madeira clara larga; `client/public/assets/interiors/tables/` + `TABLES_SPRITES` (substitui procedural/tileset; `coffeeTable` saiu de FURNITURE_TILES, `kitchen_table` de KITCHEN_SPRITES); HITBOXES atualizados.
- 🟢 [FEITO, refeito] **workstations por departamento (desk+PC)** — 1ª versão (slab+monitor esticado) ficou ruim; refeito com desk LimeZu Conference Hall **#30** inteiro (32×64) só recolorindo a tela por setor. `DESK_SPRITES`; `FurnitureItem.tex` (type continua "desk"); `HITBOXES.desk_pc` (32×28); `addWorkstation` tex por tileY, sem monitor separado; `renderDeskOverlay` ajustado (52×92).
- 🟢 [FEITO] **visual da sala de Segurança** — sprites LimeZu pago (TV/Film Studio) em `client/public/assets/interiors/security/` (`cctv_screen/2/3`, `security_console`, `server_rack`, `security_camera`); `SECURITY_SPRITES` no `AssetLoader`; layout: parede de 4 monitores CCTV + 2 consoles+cadeiras + rack + câmera + planta. **Verificado**: sala segue no-entry pra todos (blocker de `layout.rooms` no `refreshDynamicWalls`) e o editor não consegue removê-la (`rooms` é do código, não vai no override).
- 🟢 [FEITO] **porta da Segurança não abre + aviso ao insistir** — `tickDoors` força `door-security_room` sempre fechada; manda `security:locked` (throttle 2s/player) quando a pessoa insiste na frente.
- 🟢 [FEITO] **2º andar + escada rolante** — mundo estendido (2560×2720), zona `floor2` fechada (só via escada), `Player.floor`, `ESCALATORS` client↔server, `tickEscalators` (server-autoritativo + `floor:moved`/`forceTeleport`), áudio 100% isolado entre andares (regra de floor no SpatialAudio), avatares do outro andar escondidos, HUD "🛗 N no 2º andar/térreo" + badge na sidebar, escada `fixed` não-editável (re-anexada em applyLayoutOverride), 2º andar começa com caixas + interior editável. Caveat: override antigo sem paredes do floor2 → "Restaurar layout padrão".
- 🟢 [FEITO] **painel de fechadura da Segurança** — `SecurityLockModal`: display + teclado numérico + leitor de digital; qualquer tentativa (4+ dígitos / Enter / digital) → "ACESSO NEGADO" com shake; Esc/X fecha. Server manda `security:locked`.
- **redesign do mapa** baseado em print de referência do user (verificar `Downloads/Erro.jpeg` ou similar — não localizado ainda) — possivelmente reorganizar departamentos, mobília, cores
- ⚪ [pedido 2026-05-17] **área verde ao redor do mapa (sem acesso)** — moldura externa decorativa em volta do prédio (gramado), opcionalmente com ruas e árvores. Só estética; sem colisão a favor (já tem borda do mundo) — área inalcançável pelo avatar.

### NPC
- NPC segurança com **pathfinding real** (A* entre móveis/paredes) — substituir o "teletransporte + fade" atual. Precisa grid de navegação evitando furniture hitboxes e walls dinâmicas (portas fechadas)

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
