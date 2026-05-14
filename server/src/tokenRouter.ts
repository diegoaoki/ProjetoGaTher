import { Router, Request, Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import { requireAuth } from "./auth/middleware";

/**
 * Endpoint POST /token (autenticado)
 *
 * Exige Bearer JWT do nosso server. Devolve um JWT do LiveKit pro cliente
 * entrar numa sala. Identity é derivada do userId (não confia em input).
 */
export function createTokenRouter() {
  const router = Router();

  router.post("/token", requireAuth, async (req: Request, res: Response) => {
    try {
      const { room } = req.body as { room?: string };
      if (!room || typeof room !== "string" || room.length > 64) {
        return res.status(400).json({ error: "room é obrigatório" });
      }

      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const livekitUrl = process.env.LIVEKIT_URL;

      if (!apiKey || !apiSecret || !livekitUrl) {
        console.error("[/token] LIVEKIT_API_KEY, LIVEKIT_API_SECRET ou LIVEKIT_URL não configurados");
        return res.status(500).json({ error: "Servidor não configurado pra LiveKit" });
      }

      const auth = req.auth!;
      // Identity vinculada ao userId. O sufixo timestamp permite reconectar
      // sem colidir com sessões antigas que ainda não foram limpas pelo LiveKit.
      const identity = `${auth.sub}__${Date.now().toString(36)}`;

      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        // O "name" do LiveKit é só metadado; o nome de exibição real vem do schema do Colyseus.
        name: auth.email.slice(0, 64),
        ttl: 60 * 60,
      });

      at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();

      return res.json({ token, url: livekitUrl, identity, room });
    } catch (err: any) {
      console.error("[/token] erro:", err);
      return res.status(500).json({ error: "Falha ao gerar token" });
    }
  });

  return router;
}
