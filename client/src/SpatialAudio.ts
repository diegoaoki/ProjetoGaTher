import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  LocalParticipant,
  createLocalTracks,
} from "livekit-client";

export interface SpatialAudioOptions {
  serverUrl: string;
  token: string;
  identity: string;
  /** Volume 100% até essa distância em pixels */
  hearingNearRadius?: number;
  /** Acima dessa distância, volume zero */
  hearingFarRadius?: number;
  /** Publicar vídeo da câmera? */
  enableVideo?: boolean;
}

interface RemotePeer {
  identity: string;
  audioElement?: HTMLAudioElement;
  videoElement?: HTMLVideoElement;
  audioTrack?: RemoteTrack;
  videoTrack?: RemoteTrack;
  isSpeaking: boolean;
}

/**
 * SpatialAudio: gerencia a conexão LiveKit e aplica volume baseado
 * na distância entre avatares no mundo 2D.
 *
 * O Phaser/cliente principal chama updateVolumes(myPos, peerPositions)
 * a cada frame, e essa classe ajusta o gainNode de cada áudio remoto.
 *
 * Fórmula de volume:
 *   distância <= near  → volume = 1.0
 *   distância >= far   → volume = 0.0
 *   entre near e far   → linear fade
 */
export class SpatialAudio {
  private room: Room;
  private peers = new Map<string, RemotePeer>();
  private nearRadius: number;
  private farRadius: number;
  private localParticipant?: LocalParticipant;

  // Callbacks pra a UI saber quem está falando, quem entrou, etc.
  public onPeerSpeaking?: (identity: string, speaking: boolean) => void;
  public onPeerJoined?: (identity: string) => void;
  public onPeerLeft?: (identity: string) => void;
  public onVideoTrack?: (identity: string, element: HTMLVideoElement) => void;
  public onError?: (msg: string) => void;

  constructor(opts: SpatialAudioOptions) {
    this.nearRadius = opts.hearingNearRadius ?? 150;
    this.farRadius = opts.hearingFarRadius ?? 400;

    this.room = new Room({
      adaptiveStream: true,
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

    console.log("[spatial] conectado como", this.localParticipant.identity);

    // Cria e publica mic (e câmera se habilitado)
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
    } catch (err: any) {
      console.error("[spatial] erro ao acessar mídia:", err);
      this.onError?.(
        err?.name === "NotAllowedError"
          ? "Permissão de microfone/câmera negada. Libere nas configs do navegador."
          : "Falha ao acessar microfone/câmera"
      );
    }

    // Pega participantes que já estavam na sala
    this.room.remoteParticipants.forEach((p) => this.handleParticipantConnected(p));
  }

  private setupEventHandlers() {
    this.room.on(RoomEvent.ParticipantConnected, (p) => {
      this.handleParticipantConnected(p);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (p) => {
      this.handleParticipantDisconnected(p);
    });

    this.room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      this.handleTrackSubscribed(track, participant);
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      this.handleTrackUnsubscribed(track, participant);
    });

    // Speaker detection: notifica UI quando alguém começa/para de falar
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

    this.room.on(RoomEvent.Disconnected, () => {
      console.log("[spatial] desconectado");
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
      peer.audioElement?.remove();
      peer.videoElement?.remove();
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
      // Volume começa zerado; updateVolumes() ajusta baseado na distância
      el.volume = 0;
      document.body.appendChild(el);
      peer.audioElement = el;
      peer.audioTrack = track;
    } else if (track.kind === Track.Kind.Video) {
      const el = track.attach() as HTMLVideoElement;
      el.style.borderRadius = "8px";
      el.muted = true; // áudio vem pelo track de áudio separado
      peer.videoElement = el;
      peer.videoTrack = track;
      this.onVideoTrack?.(participant.identity, el);
    }
  }

  private handleTrackUnsubscribed(_track: RemoteTrack, participant: RemoteParticipant) {
    const peer = this.peers.get(participant.identity);
    if (peer) {
      peer.audioElement?.remove();
      peer.videoElement?.remove();
      peer.audioElement = undefined;
      peer.videoElement = undefined;
    }
  }

  /**
   * Chamado a cada frame pelo loop do Phaser.
   * peerPositions: map de identity → {x, y} dos avatares remotos.
   */
  public updateVolumes(
    myPos: { x: number; y: number },
    peerPositions: Map<string, { x: number; y: number }>
  ) {
    this.peers.forEach((peer, identity) => {
      const pos = peerPositions.get(identity);
      if (!pos || !peer.audioElement) {
        if (peer.audioElement) peer.audioElement.volume = 0;
        return;
      }

      const dx = pos.x - myPos.x;
      const dy = pos.y - myPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const volume = this.computeVolume(dist);
      peer.audioElement.volume = volume;
    });
  }

  private computeVolume(dist: number): number {
    if (dist <= this.nearRadius) return 1.0;
    if (dist >= this.farRadius) return 0.0;
    const t = (dist - this.nearRadius) / (this.farRadius - this.nearRadius);
    return 1 - t; // fade linear
  }

  /** Liga/desliga mic local */
  public async setMicEnabled(enabled: boolean) {
    if (!this.localParticipant) return;
    await this.localParticipant.setMicrophoneEnabled(enabled);
  }

  /** Liga/desliga câmera local */
  public async setCameraEnabled(enabled: boolean) {
    if (!this.localParticipant) return;
    await this.localParticipant.setCameraEnabled(enabled);
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
      peer.audioElement?.remove();
      peer.videoElement?.remove();
    });
    this.peers.clear();
    this.room.disconnect();
  }

  public getPeerIdentities(): string[] {
    return Array.from(this.peers.keys());
  }
}
