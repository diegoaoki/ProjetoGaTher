# Backlog — Virtual Office (ProjetoGaTher)

Gerado em 2026-05-16. Fonte: seção Backlog do `Claude.md` + pedidos recentes do user.
Legenda: 🔴 prioridade · 🐞 bug · 🟢 feito (mantido como referência) · ⚪ normal · ❓ a confirmar

---

## 🔴 Prioridades (áudio ruim — reportado pelo user 2026-05-16)

- **Controles de volume** — o áudio está ruim. Precisa de:
  - (a) slider pra **aumentar o volume do microfone** (ganho de entrada — Web Audio `GainNode` na track local, pode passar de 1.0);
  - (b) slider pra **aumentar o volume do alto-falante / peers** (ganho de saída por peer ou master, Web Audio permite > 1.0).
  - Persistir a preferência (localStorage).
- **Seleção de microfone** — quando o computador tem mais de um microfone, deixar escolher qual usar: `navigator.mediaDevices.enumerateDevices()` filtrando `audioinput` + `<select>` no painel de áudio/vídeo, e republicar a track com o `deviceId` escolhido. Persistir a escolha (localStorage). Idealmente o mesmo pra saída de áudio (`setSinkId` no elemento de áudio, onde suportado).

---

## 🐞 Bugs

- **NPC segurança às vezes fica DENTRO da sala** (reportado 2026-05-16) — deve ficar SEMPRE do lado de fora da porta. Causa: em `handleRoomLock` (`OfficeRoom.ts`) o spawn faz `npc.x = doorPos.x - 24`, hardcodado pra porta na parede ESQUERDA (salas de reunião, fora = oeste). As diretorias (`office_1`/`office_2`, trancáveis desde `baca721`) têm porta na parede DIREITA → `doorPos.x - 24` cai dentro da sala. Fix: reusar a heurística do `ejectFromRoom` (`doorOnLeftWall = doorPos.x <= bounds.x + 20`) e posicionar o NPC em `bounds.x - 24` (porta esquerda) ou `bounds.x + bounds.w + 24` (porta direita), com `direction` coerente. Nota: auto-unlock ao sair da sala já está feito (`acdd55e`).

---

## 🟢 Feito recentemente (referência)

- **Auto-unlock ao sair da sala** (`acdd55e`) — se o dono anda pra fora ou desconecta, a sala destranca sozinha (não fica presa).
- **Bolha de conversa privada** (`31e2e6b`) — N pessoas; dentro da bolha áudio cheio, fora (mesma zona) 0.15; criar via 🫧 na sidebar + modal; sair manual OU por proximidade (>250px de todos os membros); dissolve com ≤1. `Player.bubbleId` no schema. *Pendente de validação via deploy + teste manual.*

---

## ⚪ Features pedidas pelo user (2026-05-16)

- **Modo visitante (convidado externo)** — visitante entra sem conta normal, via **código (gerado na hora) ou senha**. Regras:
  - (a) visitante NÃO pode assumir mesa (bloquear `desk:claim` pra role visitante);
  - (b) mesmo com código/senha válido, precisa **escolher com quem quer falar** — lista de todos os online pra ele selecionar;
  - (c) a pessoa escolhida precisa **autorizar** (fluxo de convite/aceitar, parecido com acesso a sala trancada);
  - (d) áudio do visitante isolado de todos até a autorização (reaproveitar `__pending` ou a bolha).
  - Esboço: role `visitor` no JWT/sessão; código de uso único com TTL curto gerado por user logado/admin; endpoint gerar/validar; `Player.role` no schema; gating de `desk:claim`; UI de seleção de host + modal de autorização. Interage com bolha e salas trancadas — definir precedência de áudio.
- **Sala de Segurança bloqueada pra todos** — ninguém entra na `security_room`. Tratar como zona no-entry permanente (bloquear movimento no `tryMove`/`checkCollision` pra área da `security_room`, OU sala sempre-trancada sem dono e sem fluxo de pedir entrada). Atenção: `doors.ts` reabriu a porta da `security_room` pro NPC guarda "sair" quando trancam reunião — o bloqueio é só pra players (NPC é state, não passa por colisão), não quebra a feature. ❓ Confirmar se admin é barrado ou tem exceção.

---

## ⚪ Backlog geral

### Auth / infra
- esqueci-a-senha (precisa SMTP)
- mobile responsivo
- editor de mapas

### Interação
- menu de contexto (right-click) em outro player com opção "vir para cá" — chama o outro até a minha posição (semelhante ao convite, sem modal aceitar/recusar — ou com, a definir)

### Visual / mapa
- revisar visual da **Recepção** — só sofás + mesa de centro; falta balcão de atendimento, plantas, totem/quadro de boas-vindas, cadeiras de espera
- revisar visual da **Copa** — hoje parece sala de reunião (mesa redonda + cadeiras). Deveria parecer cozinha completa usando LimeZu Modern Interiors **pago** (`Downloads/Assets Pagos/moderninteriors-win/`, NÃO o Free): bancada com pia, fogão, geladeira, armários, microondas, mesa lateral. Placeholders (`fridge`, `stove`, `coffee_machine`, `microwave`) viram sprites corretos
- visual da **sala de Segurança** — só desk + 2 monitores + cadeira (placeholder). Falta painel de câmeras (wall mount), rack, walkie-talkie/telefone, armário. Usar moderninteriors-win se houver CCTV
- **redesign do mapa** baseado em print de referência do user (verificar `Downloads/Erro.jpeg` ou similar — não localizado ainda) — possivelmente reorganizar departamentos, mobília, cores

### NPC
- NPC segurança com **pathfinding real** (A* entre móveis/paredes) — substituir o "teletransporte + fade" atual. Precisa grid de navegação evitando furniture hitboxes e walls dinâmicas (portas fechadas)

### Áudio / câmera
- áudio/microfone: relatos de microfone abafado — UI pra (a) escolher dispositivo de entrada, (b) ajustar ganho do mic, (c) ajustar volume de saída/peers *(coberto pelas prioridades acima)*
- câmera: dentro de sala (não open space), trazer cards de vídeo dos peers pra "primeiro plano" — destaque maior, grid centralizado
- câmera: opção "espelhar" o vídeo local (`transform: scaleX(-1)`) — toggle no painel
- volume: aumentar limite máximo do ganho do peer (LiveKit limita a 1.0; subir até 2.0 via Web Audio) + slider individual por peer
- mesa = zona de áudio: 2+ pessoas na mesma mesa (ou ao redor, hitbox expandida) formam zona isolada — só ouvem entre si. Hoje mesas são single-claim e áudio só por zona

### Sidebar
- mostrar usuários **offline** (consulta `users` no Postgres). Precisa endpoint novo `GET /users` com flag `isOnline` derivada de `activeUsers`
- (offline) botão "ir até a mesa de X" — se o user tem mesa reservada, teleporta o solicitante; senão, opção desabilitada
- indicador "está falando agora" (🎙️ animado) — *parcialmente feito: badge via `activeSpeakerIds` já existe; revisar se está completo*

---

## ❓ A confirmar com o user (talvez já exista)

- "mesas requisitadas" — JÁ EXISTE (tecla `E` reserva/libera; persiste em `desk_reservations`). Talvez queira fluxo diferente (modal/click em vez de `E`)?
- "salas com áudio só pra quem está dentro" — JÁ EXISTE (Fase 7, `zoneId` no Player, SpatialAudio bloqueia entre zonas diferentes).
- "alerta pra enviar pra pessoa" — talvez já coberto por chat DM + convite via 👋 na sidebar. Confirmar se quer notificação push/sonora extra.
