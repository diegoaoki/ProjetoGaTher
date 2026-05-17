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

_(nenhum bug aberto no momento)_

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
- esqueci-a-senha (precisa SMTP)
- mobile responsivo
- editor de mapas

### Interação
- 🟢 [FEITO] menu de contexto right-click no avatar: "📢 Pedir pra vir aqui" (`summon` → toast + caminha até você, sem modal) + "📍 Ir até". Pan no vazio preservado.

### Visual / mapa
- revisar visual da **Recepção** — só sofás + mesa de centro; falta balcão de atendimento, plantas, totem/quadro de boas-vindas, cadeiras de espera
- revisar visual da **Copa** — hoje parece sala de reunião (mesa redonda + cadeiras). Deveria parecer cozinha completa usando LimeZu Modern Interiors **pago** (`Downloads/Assets Pagos/moderninteriors-win/`, NÃO o Free): bancada com pia, fogão, geladeira, armários, microondas, mesa lateral. Placeholders (`fridge`, `stove`, `coffee_machine`, `microwave`) viram sprites corretos
- visual da **sala de Segurança** — só desk + 2 monitores + cadeira (placeholder). Falta painel de câmeras (wall mount), rack, walkie-talkie/telefone, armário. Usar moderninteriors-win se houver CCTV
- **redesign do mapa** baseado em print de referência do user (verificar `Downloads/Erro.jpeg` ou similar — não localizado ainda) — possivelmente reorganizar departamentos, mobília, cores

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
