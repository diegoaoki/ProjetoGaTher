import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  LocalTrackPublication,
  Track,
  LocalParticipant,
  createLocalTracks,
} from "livekit-client";

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
}

const SCREEN_STOP_DEBOUNCE_MS = 800;

export class SpatialAudio {
  private room: Room;
  private peers = new Map<string, RemotePeer>();
  private nearRadius: number;
  private farRadius: number;
  private localParticipant?: LocalParticipant;

  public onPeerSpeaking?: (identity: string, speaking: boolean) => void;
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
      console.error("[spatial] connect falhou:", err);
      this.onError?.(err?.message || "Falha conectando no LiveKit");
    });
  }

  private async connect(opts: SpatialAudioOptions) {
    await this.room.connect(opts.serverUrl, opts.token);
    this.localParticipant = this.room.localParticipant;

    try {
      const tracks = await createLocalTracks({
        audio: true,
        video: opts.enableVideo
          ? { resolution: { width: 320, height: 240 }, facingMode: "user" }
          : false,
      });

      for (const track of tracks) {
        await this.localParticipant.publishTrack(track);
      }
      // Inicia com mic e câmera DESLIGADOS — user liga manualmente nos botões do HUD
      await this.localParticipant.setMicrophoneEnabled(false);
      await this.localParticipant.setCameraEnabled(false);
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
      const el = track.attach() as HTMLAudioElement;
      el.style.display = "none";
      el.volume = 0;
      document.body.appendChild(el);
      peer.audioElement = el;
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
    myInfo: { x: number; y: number; zoneId?: string; bubbleId?: string },
    peerInfo: Map<string, { x: number; y: number; zoneId?: string; bubbleId?: string }>
  ) {
    this.peers.forEach((peer, identity) => {
      const info = peerInfo.get(identity);
      if (!info || !peer.audioElement) {
        if (peer.audioElement) peer.audioElement.volume = 0;
        return;
      }
      const myZone = myInfo.zoneId || "open";
      const peerZone = info.zoneId || "open";

      // Zonas diferentes → muta (paredes isolam o áudio). Vale ANTES da
      // bolha: bolha não fura parede de sala trancada.
      if (myZone !== peerZone) {
        peer.audioElement.volume = 0;
        return;
      }

      // Bolha de conversa privada (mesma zona). Avaliada ANTES da regra de
      // sala/distância pra poder "abaixar" o áudio mesmo dentro de uma sala.
      const myBub = myInfo.bubbleId || "";
      const peerBub = info.bubbleId || "";
      if (myBub && myBub === peerBub) {
        peer.audioElement.volume = 1.0; // mesma bolha → cheio
        return;
      }
      if (myBub || peerBub) {
        // Alguém está numa bolha mas não juntos → áudio baixo (não mudo)
        peer.audioElement.volume = BUBBLE_OUTSIDE_VOL;
        return;
      }

      // Mesma sala isolada (qualquer coisa diferente de "open") → 100% volume.
      // Dentro de uma sala, sempre se ouvem (premissa de "reunião").
      if (myZone !== "open") {
        peer.audioElement.volume = 1.0;
        return;
      }

      // Open space: aplica distância (raio pequeno — só ouve quem está perto).
      const dx = info.x - myInfo.x;
      const dy = info.y - myInfo.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      peer.audioElement.volume = this.computeVolume(dist);
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
    await this.localParticipant.setMicrophoneEnabled(enabled);
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
