# Self-host do LiveKit (substitui a LiveKit Cloud / free tier 429)

Por que: o free tier da LiveKit Cloud estoura (HTTP 429) em teste com o
time todo. Self-host = **sem quota, sem licença**. O LiveKit é open source.

## O que muda no projeto: NADA de código

`server/src/tokenRouter.ts` já lê `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET` do ambiente e devolve `{ token, url }`. O client
usa a `url` que vier. Então migrar = **trocar 3 variáveis no Railway**:

| Var (Railway, serviço `server`) | Antes (Cloud) | Depois (self-host) |
|---|---|---|
| `LIVEKIT_URL` | `wss://gatherprivate-...livekit.cloud` | `wss://livekit.SEU_DOMINIO` |
| `LIVEKIT_API_KEY` | (key da Cloud) | a MESMA key que você puser no `livekit.yaml` |
| `LIVEKIT_API_SECRET` | (secret da Cloud) | o MESMO secret do `livekit.yaml` |

Pronto. Sem deploy de client/server (só restart do Railway pra pegar a env).

## Onde hospedar (NÃO no Railway)

LiveKit precisa de **UDP** (mídia RTP) + idealmente **TURN/TLS** (redes
corporativas com firewall). O Railway **não expõe UDP** → tem que ser
outro host:

- **VPS** (recomendado p/ simplicidade/custo): Hetzner CX22 (~€4/mês),
  DigitalOcean, Contabo, etc. — IP público, Docker, portas UDP livres.
- **Fly.io**: suporta UDP, mas config de UDP/anycast é mais chata p/ SFU.
- Requisitos mínimos: 2 vCPU / 2–4 GB RAM aguentam bem um time pequeno.
- Um **domínio/subdomínio** apontando pro IP do host (ex:
  `livekit.suaempresa.com`) — TLS é obrigatório (browser exige wss).

## Caminho recomendado (oficial, mais à prova de erro)

O LiveKit tem um gerador que cospe os arquivos de produção já com TLS
(Caddy) + TURN configurados pro seu domínio:

```bash
docker run --rm -it -v "$PWD:/output" livekit/generate
```

Ele pergunta o domínio e gera `docker-compose.yaml`, `livekit.yaml`,
`caddy.yaml` e as chaves. **Use a saída dele** — é a fonte da verdade.
Os arquivos de referência aqui (`docker-compose.yml`, `livekit.yaml`,
`Caddyfile`) servem só pra entender a estrutura.

## Passo a passo (resumido)

1. Suba um VPS Ubuntu com Docker + Docker Compose.
2. Aponte `livekit.SEU_DOMINIO` (A record) pro IP do VPS.
3. Abra no firewall do host:
   - `443/tcp` (wss/signaling + TURN-TLS via Caddy)
   - `7881/tcp` (RTC TCP fallback)
   - `50000-60000/udp` (mídia RTP) — **principal**
   - `3478/udp` (TURN/UDP, opcional mas recomendado)
4. Gere os arquivos (`livekit/generate`) com `domain = livekit.SEU_DOMINIO`.
   Guarde o `API_KEY` / `API_SECRET` que ele gerar.
5. `docker compose up -d` no VPS. Confira `wss://livekit.SEU_DOMINIO`
   respondendo (LiveKit healthz / o Caddy com cert válido).
6. No **Railway → serviço `server` → Variables**, troque as 3 envs da
   tabela acima (key/secret = os do passo 4) e **redeploy/restart**.
7. Teste: entrar, ligar mic/câmera, 2+ pessoas se ouvindo. Olhar o log
   do container LiveKit se algo falhar (geralmente é firewall/UDP).

## Notas / armadilhas

- **TURN é importante aqui** (uso corporativo interno): redes com
  firewall estrito bloqueiam UDP arbitrário; o TURN/TLS na 443 (que o
  gerador configura via Caddy) garante conexão. Não pule o TURN.
- `use_external_ip: true` no `livekit.yaml` (atrás de NAT/cloud) pra ele
  anunciar o IP público correto.
- O `livekit-server-sdk` no nosso server gera o JWT assinado com
  `API_KEY/SECRET`; **tem que bater** com `keys:` do `livekit.yaml`.
  Se não bater → erro de auth no connect (não 429).
- Migração é reversível: é só reverter as 3 envs pra Cloud.
- O áudio espacial é nosso (Web Audio por distância) — independe do
  LiveKit ser Cloud ou self-host. Nenhuma feature muda.
