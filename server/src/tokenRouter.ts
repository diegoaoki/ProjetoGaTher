import { Router, Request, Response } from "express";
import { AccessToken } from "livekit-server-sdk";

/**
 * Endpoint POST /token
 *
 * Recebe { name, room } no body e devolve um JWT assinado que o cliente
 * usa pra entrar numa sala do LiveKit.
 *
 * O cliente NUNCA recebe a API_SECRET — só o token assinado, válido por 1h.
 *
 * Em produção, normalmente você adicionaria uma verificação de auth aqui
 * (ex: o usuário precisa estar logado, ou ter um JWT do seu próprio sistema).
 * Pra MVP interno, qualquer um com o nome pode entrar.
 */
export function createTokenRouter() {
  const router = Router();

  router.post("/token", async (req: Request, res: Response) => {
    try {
      const { name, room } = req.body as { name?: string; room?: string };

      if (!name || !room) {
        return res.status(400).json({ error: "name e room são obrigatórios" });
      }

      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const livekitUrl = process.env.LIVEKIT_URL;

      if (!apiKey || !apiSecret || !livekitUrl) {
        console.error("[/token] LIVEKIT_API_KEY, LIVEKIT_API_SECRET ou LIVEKIT_URL não configurados");
        return res.status(500).json({ error: "Servidor não configurado pra LiveKit" });
      }

      // Identidade única pro participante. Vamos usar nome + timestamp pra
      // evitar conflito se duas pessoas tiverem o mesmo nome.
      const identity = `${name.slice(0, 24)}__${Date.now().toString(36)}`;

      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        name: name.slice(0, 24),
        // Token expira em 1h. Mais que suficiente pra sessão de trabalho.
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

      return res.json({
        token,
        url: livekitUrl,
        identity,
        room,
      });
    } catch (err: any) {
      console.error("[/token] erro:", err);
      return res.status(500).json({ error: "Falha ao gerar token" });
    }
  });

  return router;
}
