import { useRef, useState } from "react";

/**
 * Upload de foto de perfil (mostrada no mini-mapa). Redimensiona/recorta
 * no client pra um quadrado pequeno JPEG (~96px) → data URL leve que
 * cabe no schema do Colyseus + coluna Postgres. App.tsx envolve em
 * modalStyle/cardStyle e cuida do save (room.send + updateProfile).
 */

const SIZE = 96;
const QUALITY = 0.7;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo não é uma imagem válida"));
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = SIZE;
        c.height = SIZE;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível"));
        // "cover": recorta o quadrado central da imagem.
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2;
        const sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
        resolve(c.toDataURL("image/jpeg", QUALITY));
      };
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

interface Props {
  currentPhoto: string | null;
  saving: boolean;
  error: string;
  onSave: (dataUrl: string) => void; // "" = remover
  onClose: () => void;
}

export default function ProfilePhotoModal({ currentPhoto, saving, error, onSave, onClose }: Props) {
  const [photo, setPhoto] = useState<string>(currentPhoto || "");
  const [localErr, setLocalErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setLocalErr("");
    if (!f.type.startsWith("image/")) { setLocalErr("Selecione uma imagem"); return; }
    try {
      const url = await fileToDataUrl(f);
      setPhoto(url);
    } catch (e: any) {
      setLocalErr(e?.message || "Falha ao processar a imagem");
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>🖼️ Foto de perfil</h2>
      <p style={{ margin: "0 0 14px", fontSize: 12, opacity: 0.7 }}>
        Aparece no seu ponto do mini-mapa. Sem foto, usa o avatar.
      </p>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <div
          style={{
            width: 96, height: 96, borderRadius: "50%", overflow: "hidden",
            background: "#0b1220", border: "1px solid #334155",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {photo ? (
            <img src={photo} alt="prévia" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: 11, color: "#64748b" }}>sem foto</span>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 4 }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          style={{
            background: "#334155", border: "1px solid #475569", color: "#e2e8f0",
            borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13,
          }}
        >
          Escolher foto
        </button>
        {photo && (
          <button
            onClick={() => setPhoto("")}
            disabled={saving}
            style={{
              background: "#7f1d1d", border: "none", color: "#fff",
              borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13,
            }}
          >
            Remover
          </button>
        )}
      </div>

      {(localErr || error) && (
        <p style={{ color: "#f87171", fontSize: 13, margin: "8px 0 0", textAlign: "center" }}>
          {localErr || error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          onClick={() => onSave(photo)}
          disabled={saving}
          style={{
            flex: 1, background: "#2563eb", border: "none", color: "#fff",
            borderRadius: 8, padding: "10px 0", cursor: saving ? "default" : "pointer",
            fontSize: 14, opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            background: "#334155", border: "none", color: "#e2e8f0",
            borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontSize: 14,
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
