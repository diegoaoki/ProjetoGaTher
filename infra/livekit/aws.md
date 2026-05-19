# Self-host LiveKit na AWS (Lightsail) — guia

Escolha: **AWS Lightsail** (não EC2 cru). Motivo: SFU retransmite mídia →
o **egress** é o maior custo. EC2 cobra ~US$0,09/GB de saída
(imprevisível com vídeo). Lightsail é **preço flat com TB de transfer
incluídos** → custo previsível. UDP funciona normal. Firewall é **uma
camada só** (mais simples que Oracle/OCI).

## 1. Criar a instância (Lightsail)

Console AWS → **Lightsail** → **Create instance**:
- **Region**: `São Paulo (sa-east-1)` (menor latência BR).
- **Platform**: Linux/Unix → **OS Only** → **Ubuntu 22.04 LTS**.
- **Plan** (RAM/vCPU/SSD/Transfer/preço):
  - **4 GB / 2 vCPU / 80 GB / 4 TB** (~US$24/mês) — **recomendado**
    (aguenta vídeo de um time pequeno).
  - 2 GB / 2 vCPU / 60 GB / 3 TB (~US$12) — ok se for **mais áudio**.
- **Name**: `livekit`. → **Create instance**. Aguarde "Running".

## 2. IP estático (fixo)

Lightsail → aba **Networking** (ou Networking global) → **Create static
IP** → anexe à instância `livekit`. (Grátis enquanto anexado.) Anote o
IP — é ele no DNS.

## 3. Firewall (camada única — Lightsail)

Instância → aba **Networking** → **IPv4 Firewall** → **Add rule** pra
cada:

| Application / Protocol | Port(s) | Pra quê |
|---|---|---|
| SSH (TCP) | 22 | já vem |
| HTTP (TCP) | 80 | Let's Encrypt (cert Caddy) |
| HTTPS (TCP) | 443 | wss (signaling) + TURN/TLS |
| Custom TCP | 7881 | LiveKit RTC TCP fallback |
| Custom UDP | 3478 | TURN/UDP |
| Custom UDP | 50000-60000 | **mídia RTP (principal)** |

(Source = Any/`0.0.0.0/0`.) A AMI Ubuntu do Lightsail não vem com
firewall de SO travado → **só essa camada basta** (sem o double-firewall
do Oracle).

## 4. DNS

A record `livekit.grupoavenida.com.br` → **IP estático** do passo 2.

## 5. SSH + Docker (Ubuntu)

Conecte (Lightsail tem botão "Connect using SSH" no browser, ou):
```bash
ssh -i sua-chave.pem ubuntu@SEU_IP_ESTATICO
```
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu && newgrp docker
```

## 6. Gerar config do LiveKit + subir

```bash
mkdir -p ~/livekit && cd ~/livekit
docker run --rm -it -v "$PWD:/output" livekit/generate
```
- **domain**: `livekit.grupoavenida.com.br`
- **TURN**: sim (uso corporativo c/ firewall → essencial)
Anote o **API key/secret** que ele mostrar.
```bash
docker compose up -d
docker compose logs -f   # esperar "started" + Caddy emitir o cert
```
Teste: `https://livekit.grupoavenida.com.br` com **TLS válido**.
(Se o cert não emitir → porta 80 fechada no firewall do passo 3.)

## 7. Apontar o projeto (Railway → serviço `server` → Variables)

```
LIVEKIT_URL        = wss://livekit.grupoavenida.com.br
LIVEKIT_API_KEY    = <key gerada no passo 6>
LIVEKIT_API_SECRET = <secret gerado no passo 6>
```
Restart do serviço `server`. **Zero deploy de código.** Reversível
(é só voltar as 3 envs pra Cloud).

## 8. Validar

Entrar no app, 2+ pessoas, ligar mic/câmera, se ouvirem/verem. WS
conecta mas sem áudio = UDP bloqueado → revisar regras UDP do passo 3 e
`rtc.port_range` no `livekit.yaml`.

## Custo (estimativa)

- Instância 4 GB: ~US$24/mês flat, **4 TB transfer incluídos**.
- Áudio é leve; vídeo consome o transfer — 4 TB cobre bem um time
  pequeno/médio. Acima disso, sobe de plano.
- IP estático: grátis enquanto anexado.

## EC2 (se exigirem EC2 ao invés de Lightsail)

Mesmo passo a passo (Ubuntu 22.04 AMI, Docker, generate). Diferenças:
- Firewall = **Security Group** (inbound: as mesmas portas do passo 3).
- IP fixo = **Elastic IP** (anexado é grátis; solto cobra).
- **Egress cobrado ~US$0,09/GB** (sem franquia tipo Lightsail) →
  monitorar; pode ficar mais caro que Lightsail com vídeo.
- t3.small (2GB) ~US$15 + tráfego / t3.medium (4GB) ~US$30 + tráfego.
