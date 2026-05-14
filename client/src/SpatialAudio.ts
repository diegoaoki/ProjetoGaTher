import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  Track,
  LocalParticipant,
  createLocalTracks,
} from "livekit-client";

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
}

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
  public onScreenShareStarted?: (identity: string, element: HTMLVideoElement) => void;
  public onScreenShareStopped?: (identity: string) => void;
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

      // Diferencia camera vs screen share pelo source
      if (track.source === Track.Source.ScreenShare) {
        el.style.objectFit = "contain";
        el.style.background = "#000";
        peer.screenElement = el;
        this.onScreenShareStarted?.(participant.identity, el);
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
        peer.screenElement?.remove();
        peer.screenElement = undefined;
        this.onScreenShareStopped?.(participant.identity);
      } else {
        peer.cameraElement?.remove();
        peer.cameraElement = undefined;
      }
    }
  }

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

  /**
   * Liga/desliga compartilhamento de tela.
   * O navegador vai abrir o seletor de tela quando enabled=true.
   */
  public async setScreenShareEnabled(enabled: boolean): Promise<boolean> {
    if (!this.localParticipant) return false;
    try {
      await this.localParticipant.setScreenShareEnabled(enabled, {
        audio: false,
      });
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
