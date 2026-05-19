# Self-host LiveKit no Oracle Cloud (OCI) — Always Free ARM

Objetivo: rodar o LiveKit numa VM **Always Free** (Ampere A1 ARM, grátis)
e trocar 3 envs no Railway. ~30–45 min.

> ⚠️ Os 2 erros clássicos de OCI: (1) **dois firewalls** — Security List
> da VCN **e** o iptables/firewalld da própria VM; abrir nos dois.
> (2) capacidade do Always Free ARM costuma faltar — se der "out of
> capacity", tentar outra Availability Domain/região ou repetir depois.

## 1. Criar a VM

OCI Console → **Compute → Instances → Create instance**:
- **Image**: Canonical **Ubuntu 22.04** (aarch64/ARM).
- **Shape**: `VM.Standard.A1.Flex` → **2 OCPU / 12 GB** (cabe no Always
  Free: até 4 OCPU/24GB no total). 2 OCPU já serve um time pequeno;
  suba pra 4 se muita câmera simultânea.
- **Networking**: cria/usa uma VCN com subnet pública. Marque
  **Assign a public IPv4 address**.
- **SSH keys**: suba sua chave pública (ou gere e baixe a privada).
- Create. Anote o **Public IP**.

## 2. IP público fixo (reservado)

O IP efêmero muda em stop/start e quebra o DNS. Console → a instância →
**Attached VNICs → VNIC → IPv4 Addresses → editar o public IP →
"Reserved public IP"** (cria um reservado e associa). Use ESSE IP no DNS.

## 3. DNS

No DNS do domínio de vocês, crie um **A record**:
`livekit.grupoavenida.com.br` → **IP reservado** da VM. (Espere propagar.)

## 4. Firewall — CAMADA 1: Security List / NSG da VCN

Console → **Networking → VCN → Subnet → Security List** (default) →
**Add Ingress Rules** (Source `0.0.0.0/0`, Stateless = No):

| Porta/Protocolo | Pra quê |
|---|---|
| TCP 22 | SSH (já costuma vir) |
| TCP 80 | Let's Encrypt (Caddy HTTP-01) |
| TCP 443 | wss (signaling) + TURN/TLS |
| TCP 7881 | LiveKit RTC TCP fallback |
| UDP 3478 | TURN/UDP |
| UDP 50000–60000 | **mídia RTP (principal)** |

## 5. Firewall — CAMADA 2: dentro da VM

A imagem Ubuntu da OCI vem com **iptables travado** (só SSH). SSH na VM
e libere as MESMAS portas. Forma direta (Ubuntu/iptables OCI):

```bash
sudo bash -c '
for p in 80 443 7881; do iptables -I INPUT -p tcp --dport $p -j ACCEPT; done
iptables -I INPUT -p udp --dport 3478 -j ACCEPT
iptables -I INPUT -p udp --dport 50000:60000 -j ACCEPT
netfilter-persistent save
'
```

(Se a imagem usar `ufw`/`firewalld`, abra com a ferramenta dela — o
ponto é: **abrir nas duas camadas**, senão o WebSocket conecta mas a
mídia/UDP some.)

## 6. Docker

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

## 7. Gerar a config do LiveKit (oficial, multi-arch/ARM ok)

```bash
mkdir -p ~/livekit && cd ~/livekit
docker run --rm -it -v "$PWD:/output" livekit/generate
```
Responda:
- **domain**: `livekit.grupoavenida.com.br`
- **TURN**: sim (uso corporativo com firewall → essencial)
Ele gera `docker-compose.yaml`, `livekit.yaml`, `caddy.yaml` e mostra
**API key/secret** — **anote** (vão pro Railway).

> Confira no `livekit.yaml`: `rtc.use_external_ip: true` e
> `rtc.port_range_start/end: 50000/60000` batendo com o firewall.

## 8. Subir

```bash
docker compose up -d
docker compose logs -f   # Ctrl+C qd ver "started" e o Caddy pegar cert
```
Teste no navegador: `https://livekit.grupoavenida.com.br` deve ter
**cert TLS válido** (Caddy/Let's Encrypt). Se o cert não emitir →
porta 80 fechada em alguma das 2 camadas.

## 9. Apontar o projeto pro novo LiveKit (só env, zero código)

Railway → serviço **`server`** → **Variables**:
- `LIVEKIT_URL` = `wss://livekit.grupoavenida.com.br`
- `LIVEKIT_API_KEY` = a key gerada no passo 7
- `LIVEKIT_API_SECRET` = o secret gerado no passo 7

Redeploy/restart do serviço `server`. Pronto — o `/token` passa a
devolver a URL nova; o client conecta nela. Nenhum deploy de código.

## 10. Validar

Entrar no app, ligar mic/câmera, 2+ pessoas se ouvindo/vendo. Se o
WS conecta mas não tem áudio/vídeo → 99% é UDP bloqueado (revisar
camada 2 do firewall e `port_range`). Logs: `docker compose logs livekit`.

## Reversão

É só voltar as 3 envs do Railway pros valores da LiveKit Cloud e
restart. Migração 100% reversível.

## Observações

- Always Free ARM não custa nada e aguenta um time pequeno; se a
  capacidade ARM faltar na criação, troque a Availability Domain ou a
  região, ou tente mais tarde (limitação conhecida da OCI).
- LiveKit, Caddy e coturn têm imagens multi-arch → rodam em ARM sem
  ajuste.
- O áudio espacial é nosso (Web Audio por distância) — não muda nada
  indo pra self-host.
