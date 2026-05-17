import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  LocalTrackPublication,
  Track,
  LocalParticipant,
  LocalAudioTrack,
  createLocalTracks,
} from "livekit-client";
import {
  getMicDeviceId,
  setMicDeviceId,
  getSpeakerDeviceId,
  setSpeakerDeviceId,
  getPeerGain,
  setPeerGain,
  getMicGain,
  setMicGain,
  getPeerVolume,
  setPeerVolume,
} from "./audioPrefs";

/** userId estável a partir da identity do LiveKit (`userId__timestamp`). */
function userIdOf(identity: string): string {
  const i = identity.indexOf("__");
  return i >= 0 ? identity.slice(0, i) : identity;
}

/** Volume de quem está numa bolha pra quem está fora dela (mesma sala). */
const BUBBLE_OUTSIDE_VOL = 0.15;

export interface SpatialAudioOptions {
  serverUrl: string;
  token: string;
  identity: string;
  hearingNearRadius?: number;
  hearingFarRadius?: number;
  enableVideo?: boolean;
}

interface RemotePeer {
  identity: string;
  audioElement?: HTMLAudioElement;
  cameraElement?: HTMLVideoElement;
  screenElement?: HTMLVideoElement;
  isSpeaking: boolean;
  screenStopTimer?: number;
  // Web Audio: permite ganho > 1.0 (HTMLMediaElement.volume trava em 1).
  srcNode?: MediaStreamAudioSourceNode;
  gainNode?: GainNode;
}

const SCREEN_STOP_DEBOUNCE_MS = 800;

export class SpatialAudio {
  private room: Room;
  private peers = new Map<string, RemotePeer>();
  private nearRadius: number;
  private farRadius: number;
  // === Pipeline próprio do microfone (Web Audio) p/ ganho > 1.0 ===
  private micRawStream?: MediaStream;          // getUserMedia cru
  private micSrcNode?: MediaStreamAudioSourceNode;
  private micGainNode?: GainNode;
  private micDest?: MediaStreamAudioDestinationNode;
  private micTrack?: LocalAudioTrack;          // track publicada (processada)
  private micMuted = true;                     // começa mudo

  /**
   * Monta a track de microfone passando por um GainNode (permite ganho
   * > 1.0). Para o stream anterior se houver. Retorna a LocalAudioTrack
   * pronta pra publicar, ou null se algo falhar (fallback no connect).
   */
  private async buildMicTrack(deviceId: string): Promise<LocalAudioTrack | null> {
    try {
      const ctx = this.ensureAudioCtx();
      if (!ctx) return null;
      // Para nodes/stream anteriores
      try { this.micSrcNode?.disconnect(); } catch {}
      try { this.micGainNode?.disconnect(); } catch {}
      this.micRawStream?.getTracks().forEach((t) => t.stop());

      const raw = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          // AGC desligado: senão o browser "briga" com o nosso ganho
          autoGainControl: false,
        },
      });
      this.micRawStream = raw;
      const src = ctx.createMediaStreamSource(raw);
      const gain = ctx.createGain();
      gain.gain.value = getMicGain();
      const dest = ctx.createMediaStreamDestination();
      src.connect(gain);
      gain.connect(dest);
      this.micSrcNode = src;
      this.micGainNode = gain;
      this.micDest = dest;
      const mst = dest.stream.getAudioTracks()[0];
      if (!mst) return null;
      return new LocalAudioTrack(mst);
    } catch (e) {
      console.warn("[spatial] buildMicTrack falhou:", e);
      return null;
    }
  }
  private localParticipant?: LocalParticipant;
  /** Contexto Web Audio (lazy) pra ganho de peers > 1.0. */
  private audioCtx?: AudioContext;
  /** Multiplicador master da saída (peers). Persiste em localStorage. */
  private peerMasterGain = getPeerGain();

  /** Cria/retoma o AudioContext (autoplay: precisa de gesto do usuário). */
  private ensureAudioCtx(): AudioContext | null {
    try {
      if (!this.audioCtx) {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return null;
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx!.state === "suspended") this.audioCtx!.resume().catch(() => {});
      return this.audioCtx!;
    } catch {
      return null;
    }
  }

  /** Aplica volume num peer: GainNode (permite > 1) ou fallback no element. */
  private applyPeerVolume(peer: RemotePeer, vol: number) {
    const per = getPeerVolume(userIdOf(peer.identity)); // multiplicador individual
    if (peer.gainNode) {
      peer.gainNode.gain.value = vol * this.peerMasterGain * per;
    } else if (peer.audioElement) {
      peer.audioElement.volume = Math.min(1, vol * per); // fallback: trava em 1
    }
  }

  /** Volume individual da pessoa (multiplicador). Persiste por userId. */
  public setPeerVolumeFor(identity: string, v: number) {
    const g = Number.isFinite(v) && v >= 0 ? v : 1;
    setPeerVolume(userIdOf(identity), g);
    this.ensureAudioCtx();
    // updateVolumes roda a cada frame e relê getPeerVolume → aplica sozinho.
  }
  public getPeerVolumeFor(identity: string): number {
    return getPeerVolume(userIdOf(identity));
  }

  public onPeerSpeaking?: (identity: string, speaking: boolean) => void;
  /** Eu mesmo comecei/parei de falar (detecção de voz do LiveKit). */
  public onLocalSpeaking?: (speaking: boolean) => void;
  private localSpeaking = false;
  public onPeerJoined?: (identity: string) => void;
  public onPeerLeft?: (identity: string) => void;
  public onCameraTrack?: (identity: string, element: HTMLVideoElement) => void;
  public onCameraTrackEnded?: (identity: string) => void;
  public onScreenShareStarted?: (identity: string, element: HTMLVideoElement) => void;
  public onScreenShareStopped?: (identity: string) => void;
  // Screen share LOCAL (eu mesmo) — pra mostrar balão em cima do meu avatar
  public onLocalScreenShareStarted?: (element: HTMLVideoElement) => void;
  public onLocalScreenShareStopped?: () => void;
  public onError?: (msg: string) => void;

  constructor(opts: SpatialAudioOptions) {
    this.nearRadius = opts.hearingNearRadius ?? 150;
    this.farRadius = opts.hearingFarRadius ?? 400;

    // adaptiveStream: false — o LiveKit ajusta resolução baseado no tamanho do
    // elemento <video>. Como mostramos screen share em uma TV pequena no mapa,
    // ele cai pra 2x2 pixels. Desligado, sempre recebemos qualidade total.
    //
    // dynacast: true — ainda otimiza simulcast, só não mexe na resolução por elemento.
    this.room = new Room({
      adaptiveStream: false,
      dynacast: true,
    });

    this.setupEventHandlers();
    this.connect(opts).catch((err) => {
      // Log completo (com stack) pra diagnosticar a origem real do erro.
      console.error("[spatial] connect falhou:", err, err?.stack);
      this.onError?.(err?.message || "Falha conectando no LiveKit");
    });
  }

  private async connect(opts: SpatialAudioOptions) {
    await this.room.connect(opts.serverUrl, opts.token);
    this.localParticipant = this.room.localParticipant;

    try {
      // MICROFONE: pipeline próprio (Web Audio) p/ ganho > 1.0. Se falhar,
      // cai pro createLocalTracks padrão do LiveKit (sem ganho).
      const micId = getMicDeviceId();
      this.micTrack = (await this.buildMicTrack(micId)) || undefined;
      if (this.micTrack) {
        await this.localParticipant.publishTrack(this.micTrack);
        await this.micTrack.mute(); // começa mudo
        this.micMuted = true;
      } else {
        const fb = await createLocalTracks({
          audio: micId ? { deviceId: { exact: micId } } : true,
          video: false,
        });
        for (const t of fb) await this.localParticipant.publishTrack(t);
        await this.localParticipant.setMicrophoneEnabled(false);
      }

      // CÂMERA: continua gerenciada pelo LiveKit (sem mudança no pipeline)
      if (opts.enableVideo) {
        const vts = await createLocalTracks({
          audio: false,
          video: { resolution: { width: 320, height: 240 }, facingMode: "user" },
        });
        for (const t of vts) await this.localParticipant.publishTrack(t);
      }
      await this.localParticipant.setCameraEnabled(false);

      // Aplica saída de áudio escolhida (setSinkId via LiveKit, best-effort)
      const spkId = getSpeakerDeviceId();
      if (spkId) {
        try {
          await this.room.switchActiveDevice("audiooutput", spkId);
        } catch (e) {
          console.warn("[spatial] saída de áudio não aplicada:", e);
        }
      }
    } catch (err: any) {
      console.error("[spatial] erro ao acessar mídia:", err);
      this.onError?.(
        err?.name === "NotAllowedError"
          ? "Permissão de microfone/câmera negada. Libere nas configs do navegador."
          : "Falha ao acessar microfone/câmera"
      );
    }

    this.room.remoteParticipants.forEach((p) => this.handleParticipantConnected(p));
  }

  private setupEventHandlers() {
    this.room.on(RoomEvent.ParticipantConnected, (p) => this.handleParticipantConnected(p));
    this.room.on(RoomEvent.ParticipantDisconnected, (p) => this.handleParticipantDisconnected(p));
    this.room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => this.handleTrackSubscribed(track, participant));
    this.room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => this.handleTrackUnsubscribed(track, participant));

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const speakingIds = new Set(speakers.map((s) => s.identity));
      this.peers.forEach((peer, id) => {
        const nowSpeaking = speakingIds.has(id);
        if (peer.isSpeaking !== nowSpeaking) {
          peer.isSpeaking = nowSpeaking;
          this.onPeerSpeaking?.(id, nowSpeaking);
        }
      });
      // O participante local também entra na lista do LiveKit quando fala —
      // mas não está em `this.peers`, então tratamos à parte (anel próprio
      // + badge 🎙️ no "você" da sidebar).
      const meId = this.localParticipant?.identity;
      const meSpeaking = !!meId && speakingIds.has(meId);
      if (this.localSpeaking !== meSpeaking) {
        this.localSpeaking = meSpeaking;
        this.onLocalSpeaking?.(meSpeaking);
      }
    });

    // Local screen share: pra mostrar balão em cima do meu próprio avatar
    this.room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare && pub.videoTrack) {
        const el = pub.videoTrack.attach() as HTMLVideoElement;
        el.muted = true;
        el.playsInline = true;
        this.onLocalScreenShareStarted?.(el);
      }
    });
    this.room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) {
        this.onLocalScreenShareStopped?.();
      }
    });
  }

  private handleParticipantConnected(p: RemoteParticipant) {
    if (this.peers.has(p.identity)) return;
    this.peers.set(p.identity, { identity: p.identity, isSpeaking: false });
    this.onPeerJoined?.(p.identity);
  }

  private handleParticipantDisconnected(p: RemoteParticipant) {
    const peer = this.peers.get(p.identity);
    if (peer) {
      if (peer.screenStopTimer) clearTimeout(peer.screenStopTimer);
      try { peer.gainNode?.disconnect(); } catch {}
      try { peer.srcNode?.disconnect(); } catch {}
      peer.audioElement?.remove();
      peer.cameraElement?.remove();
      peer.screenElement?.remove();
      if (peer.screenElement) this.onScreenShareStopped?.(p.identity);
      this.peers.delete(p.identity);
      this.onPeerLeft?.(p.identity);
    }
  }

  private handleTrackSubscribed(track: RemoteTrack, participant: RemoteParticipant) {
    let peer = this.peers.get(participant.identity);
    if (!peer) {
      peer = { identity: participant.identity, isSpeaking: false };
      this.peers.set(participant.identity, peer);
    }

    if (track.kind === Track.Kind.Audio) {
      // Mantém o element anexado (lifecycle do LiveKit + workaround Chrome
      // pra MediaStreamSource), mas mutado: o playback é via Web Audio,
      // que permite ganho > 1.0.
      const el = track.attach() as HTMLAudioElement;
      el.style.display = "none";
      document.body.appendChild(el);
      peer.audioElement = el;

      const ctx = this.ensureAudioCtx();
      const mst = (track as any).mediaStreamTrack as MediaStreamTrack | undefined;
      if (ctx && mst) {
        try {
          const src = ctx.createMediaStreamSource(new MediaStream([mst]));
          const gain = ctx.createGain();
          gain.gain.value = 0; // updateVolumes ajusta no próximo frame
          src.connect(gain);
          gain.connect(ctx.destination);
          peer.srcNode = src;
          peer.gainNode = gain;
          el.muted = true;
          el.volume = 0;
        } catch {
          el.volume = 0; // fallback: element-based (sem ganho > 1)
        }
      } else {
        el.volume = 0;
      }
    } else if (track.kind === Track.Kind.Video) {
      const el = track.attach() as HTMLVideoElement;
      el.muted = true;

      if (track.source === Track.Source.ScreenShare) {
        el.style.objectFit = "contain";
        el.style.background = "#000";

        if (peer.screenStopTimer) {
          console.log("[spatial] re-subscribe rápido de screen share, cancelando stop");
          clearTimeout(peer.screenStopTimer);
          peer.screenStopTimer = undefined;
          peer.screenElement?.remove();
          peer.screenElement = el;
          this.onScreenShareStarted?.(participant.identity, el);
        } else {
          peer.screenElement = el;
          this.onScreenShareStarted?.(participant.identity, el);
        }
      } else {
        el.style.borderRadius = "8px";
        peer.cameraElement = el;
        this.onCameraTrack?.(participant.identity, el);
      }
    }
  }

  private handleTrackUnsubscribed(track: RemoteTrack, participant: RemoteParticipant) {
    const peer = this.peers.get(participant.identity);
    if (!peer) return;

    if (track.kind === Track.Kind.Audio) {
      try { peer.gainNode?.disconnect(); } catch {}
      try { peer.srcNode?.disconnect(); } catch {}
      peer.gainNode = undefined;
      peer.srcNode = undefined;
      peer.audioElement?.remove();
      peer.audioElement = undefined;
    } else if (track.kind === Track.Kind.Video) {
      if (track.source === Track.Source.ScreenShare) {
        if (peer.screenStopTimer) clearTimeout(peer.screenStopTimer);

        peer.screenStopTimer = window.setTimeout(() => {
          peer.screenElement?.remove();
          peer.screenElement = undefined;
          peer.screenStopTimer = undefined;
          this.onScreenShareStopped?.(participant.identity);
        }, SCREEN_STOP_DEBOUNCE_MS);
      } else {
        peer.cameraElement?.remove();
        peer.cameraElement = undefined;
        this.onCameraTrackEnded?.(participant.identity);
      }
    }
  }

  public updateVolumes(
    myInfo: { x: number; y: number; zoneId?: string; bubbleId?: string; role?: string; visitorOk?: boolean; deskSeat?: string },
    peerInfo: Map<string, { x: number; y: number; zoneId?: string; bubbleId?: string; role?: string; visitorOk?: boolean; deskSeat?: string }>
  ) {
    // Garante o AudioContext ativo (autoplay pode tê-lo deixado suspenso).
    if (this.audioCtx?.state === "suspended") this.audioCtx.resume().catch(() => {});

    // Visitante não autorizado = mudo total (não ouve ninguém e ninguém o ouve).
    const meBlocked = myInfo.role === "visitor" && !myInfo.visitorOk;

    this.peers.forEach((peer, identity) => {
      const info = peerInfo.get(identity);
      if (!info || !peer.audioElement) {
        this.applyPeerVolume(peer, 0);
        return;
      }
      if (meBlocked || (info.role === "visitor" && !info.visitorOk)) {
        this.applyPeerVolume(peer, 0);
        return;
      }

      // Mesa-conversa: quem está numa mesa só ouve quem está na MESMA
      // mesa (zona isolada total). Precede zona/bolha/distância.
      const myDesk = myInfo.deskSeat || "";
      const peerDesk = info.deskSeat || "";
      if (myDesk || peerDesk) {
        this.applyPeerVolume(peer, myDesk && myDesk === peerDesk ? 1.0 : 0);
        return;
      }

      const myZone = myInfo.zoneId || "open";
      const peerZone = info.zoneId || "open";

      // Calcula o volume "espacial" (0..1); o master de saída é aplicado
      // em applyPeerVolume (que permite ultrapassar 1.0 via Web Audio).
      let vol: number;
      if (myZone !== peerZone) {
        // Zonas diferentes → muta (paredes isolam). ANTES da bolha.
        vol = 0;
      } else {
        const myBub = myInfo.bubbleId || "";
        const peerBub = info.bubbleId || "";
        if (myBub && myBub === peerBub) {
          vol = 1.0; // mesma bolha → cheio
        } else if (myBub || peerBub) {
          vol = BUBBLE_OUTSIDE_VOL; // alguém em bolha, não juntos → baixo
        } else if (myZone !== "open") {
          vol = 1.0; // mesma sala isolada → cheio (premissa de reunião)
        } else {
          // Open space: por distância (raio pequeno)
          const dx = info.x - myInfo.x;
          const dy = info.y - myInfo.y;
          vol = this.computeVolume(Math.sqrt(dx * dx + dy * dy));
        }
      }
      this.applyPeerVolume(peer, vol);
    });
  }

  private computeVolume(dist: number): number {
    if (dist <= this.nearRadius) return 1.0;
    if (dist >= this.farRadius) return 0.0;
    const t = (dist - this.nearRadius) / (this.farRadius - this.nearRadius);
    return 1 - t;
  }

  public async setMicEnabled(enabled: boolean) {
    if (!this.localParticipant) return;
    if (this.micTrack) {
      // Pipeline próprio: mute/unmute mantém o GainNode intacto
      this.micMuted = !enabled;
      try {
        if (enabled) await this.micTrack.unmute();
        else await this.micTrack.mute();
      } catch (e) {
        console.warn("[spatial] mic mute/unmute falhou:", e);
      }
      return;
    }
    await this.localParticipant.setMicrophoneEnabled(enabled);
  }

  /** Ganho do microfone (entrada). 1 = normal; > 1 amplifica. Ao vivo. */
  public setMicGain(v: number) {
    const g = Number.isFinite(v) && v >= 0 ? v : 1;
    setMicGain(g);
    if (this.micGainNode) this.micGainNode.gain.value = g;
  }
  public getMicGainValue(): number {
    return getMicGain();
  }

  /** Troca o microfone de entrada ao vivo + persiste a escolha. */
  public async setMicDevice(deviceId: string) {
    setMicDeviceId(deviceId);
    if (this.micTrack && this.localParticipant) {
      // Rebuild do pipeline com o novo device, preservando ganho e mute.
      try {
        const old = this.micTrack;
        const next = await this.buildMicTrack(deviceId);
        if (!next) return;
        try { await this.localParticipant.unpublishTrack(old); } catch {}
        try { old.stop(); } catch {}
        this.micTrack = next;
        await this.localParticipant.publishTrack(next);
        if (this.micMuted) await next.mute();
      } catch (e) {
        console.warn("[spatial] troca de microfone (pipeline) falhou:", e);
      }
      return;
    }
    try {
      await this.room.switchActiveDevice("audioinput", deviceId);
    } catch (e) {
      console.warn("[spatial] falha ao trocar microfone:", e);
    }
  }

  /** Troca a saída de áudio (alto-falante) ao vivo + persiste a escolha. */
  public async setSpeakerDevice(deviceId: string) {
    setSpeakerDeviceId(deviceId);
    try {
      await this.room.switchActiveDevice("audiooutput", deviceId);
    } catch (e) {
      console.warn("[spatial] falha ao trocar saída de áudio:", e);
    }
  }

  /** Ganho master da saída (peers). 1 = normal; > 1 amplifica. Persiste. */
  public setPeerGain(v: number) {
    const g = Number.isFinite(v) && v >= 0 ? v : 1;
    this.peerMasterGain = g;
    setPeerGain(g);
    this.ensureAudioCtx(); // garante ctx ativo ao ajustar
    // Não precisa reaplicar manualmente: updateVolumes roda a cada frame.
  }
  public getPeerGainValue(): number {
    return this.peerMasterGain;
  }

  public async setCameraEnabled(enabled: boolean) {
    if (!this.localParticipant) return;
    await this.localParticipant.setCameraEnabled(enabled);
  }

  public async setScreenShareEnabled(enabled: boolean): Promise<boolean> {
    if (!this.localParticipant) return false;
    try {
      await this.localParticipant.setScreenShareEnabled(enabled, { audio: false });
      return true;
    } catch (err: any) {
      console.error("[spatial] erro screen share:", err);
      if (err?.name !== "NotAllowedError") {
        this.onError?.("Falha no compartilhamento de tela");
      }
      return false;
    }
  }

  public isScreenShareEnabled(): boolean {
    if (!this.localParticipant) return false;
    return this.localParticipant.isScreenShareEnabled;
  }

  public getLocalVideoElement(): HTMLVideoElement | null {
    if (!this.localParticipant) return null;
    const pub = this.localParticipant.getTrackPublication(Track.Source.Camera);
    if (!pub || !pub.videoTrack) return null;
    const el = pub.videoTrack.attach() as HTMLVideoElement;
    el.muted = true;
    return el;
  }

  public disconnect() {
    this.peers.forEach((peer) => {
      if (peer.screenStopTimer) clearTimeout(peer.screenStopTimer);
      peer.audioElement?.remove();
      peer.cameraElement?.remove();
      peer.screenElement?.remove();
    });
    this.peers.clear();
    this.room.disconnect();
  }

  public getPeerIdentities(): string[] {
    return Array.from(this.peers.keys());
  }
}
