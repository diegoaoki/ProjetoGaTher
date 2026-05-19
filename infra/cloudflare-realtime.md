# Cloudflare Realtime (Calls) — avaliação pro ProjetoGaTher

## O que é (e o que NÃO é)

Cloudflare Realtime (ex-"Calls") é um **SFU serverless**: você não
hospeda nada (sem VM, sem UDP, sem TURN pra gerenciar — a Cloudflare faz
isso na borda global deles). Sem quota de participantes tipo o free tier
do LiveKit; cobrança é por **egress** (tráfego), com tier inicial barato/
generoso (confirmar números atuais na pricing page deles).

**Diferença crucial vs LiveKit:** o Calls é **baixo nível, por TRACKS**.
Ele NÃO tem conceito de "sala", "participantes", "quem está conectado",
mute, screen-share helper, device picker — nada disso. Você:
1. cria uma **Session** (uma RTCPeerConnection do lado da Cloudflare),
2. faz **push** das suas tracks locais (mic/câmera) → recebe IDs,
3. faz **pull** das tracks remotas (por ID) → recebe `MediaStreamTrack`,
trocando SDP via API HTTP. **Toda a camada de "sala/presença/quem ouve
quem" é SUA.**

→ Isso encaixa BEM aqui porque **já temos o Colyseus** fazendo
sala/presença/state. E o **áudio espacial é nosso** (Web Audio
`GainNode` por distância) — isso é 100% reaproveitado: o Calls só
entrega as `MediaStreamTrack` cruas, exatamente como o LiveKit entrega.

## Arquitetura no nosso caso

```
Client (Vercel)                 Nosso server (Railway)        Cloudflare
  getUserMedia(mic/cam)
  cria Session no Calls  ──────► proxy /calls/* (assina com  ──► Realtime
  push tracks  ◄──────────────── APP_ID + APP_SECRET)            (SFU)
  publica os trackIds no Colyseus (schema/Player.mediaTracks)
  ◄── Colyseus sincroniza trackIds dos peers ──►
  pull tracks dos peers pelos IDs  ───────────────────────────► Realtime
  MediaStreamTrack remota → MESMO pipeline espacial (GainNode)  ✅ reaproveitado
```

- **Server (Railway)**: um endpoint proxy `/calls/*` que repassa as
  chamadas à API do Calls assinando com `CF_CALLS_APP_ID` /
  `CF_CALLS_APP_SECRET` (o secret NUNCA vai pro client). É análogo ao
  `tokenRouter.ts` de hoje. Pouco código no server.
- **Signaling/sala**: usa o que já existe — Colyseus. Cada client
  publica seus `trackIds` no schema; os outros leem e dão `pull`.
  (Provável `@type` novo em `Player` → rebuild server+client.)
- **Client**: reescrever `SpatialAudio.ts`:
  - conectar = criar Session + push mic/cam (SDP) — substitui
    `room.connect` + `publishTrack`.
  - pull por peer = substitui `RoomEvent.TrackSubscribed`.
  - mute/unmute, troca de device, screen-share, ganho do mic →
    reimplementar sobre tracks cruas (o `livekit-client` dava de graça).
  - **manter**: todo o `updateVolumes`/`GainNode`/regras de
    zona/mesa/bolha/andar — não muda.
  - Existe a lib oficial **`partytracks`** (Cloudflare) que abstrai
    push/pull com observables — reduz o boilerplate.

## Esforço / risco (honesto)

- **Alto.** É reescrever o motor de A/V (a parte mais sensível e a que
  NÃO dá pra testar local — só em grupo no deploy).
- Estimativa realista: alguns dias de trabalho focado + rodadas de
  teste em grupo. Mexe em schema (rebuild server+client).
- O que sobrevive sem retrabalho: a lógica espacial inteira, o Colyseus,
  o resto do jogo.

## Prós x Contras

**Prós:** sem VM/host/UDP/TURN pra manter; sem "loteria de capacidade"
(Oracle); sem quota dura de participantes; escala global; pricing por
uso (barato pra um time interno).
**Contras:** retrabalho grande no client; perde os helpers do
`livekit-client` (mute/screen/devices); é vendor lock-in Cloudflare;
custo passa a ser por egress (previsível, mas existe).

## Veredito

Faz sentido SE o objetivo for **eliminar de vez o problema de
infra/quota** e topar o investimento de reescrever a camada de mídia.
Para "só destravar agora", **terminar o Oracle** (quase pronto) ou uma
**VM interna da empresa** custam muito menos esforço. Cloudflare
Realtime é a aposta de médio prazo "sem servidor de mídia pra cuidar".

Pré-requisitos se for: conta Cloudflare → criar um app em **Realtime**
→ pegar `App ID` + `App Secret` (vão como env no server, NÃO no client).
