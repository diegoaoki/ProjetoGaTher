import { Router, Request, Response } from "express";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { messages, profiles, users, messageReactions } from "../db/schema";
import { requireAuth } from "../auth/middleware";

/**
 * Endpoints REST de histórico de chat:
 *   - GET /messages/global          → últimas msgs do canal global
 *   - GET /messages/dm              → lista de conversas DM (último msg de cada par)
 *   - GET /messages/dm/:otherUserId → histórico entre o usuário logado e o outro
 *
 * Paginação: ?before=<ISO timestamp>&limit=50 (max 100)
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parsePagination(req: Request): { limit: number; before: Date | null } {
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const beforeStr = req.query.before ? String(req.query.before) : null;
  let before: Date | null = null;
  if (beforeStr) {
    const d = new Date(beforeStr);
    if (!isNaN(d.getTime())) before = d;
  }
  return { limit, before };
}

/**
 * Agrega reações por mensagem em formato { messageId → [{ emoji, userIds }] }.
 * Uma só query pra todas as msgs em vez de N+1.
 */
async function fetchReactionsFor(db: ReturnType<typeof getDb>, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, Array<{ emoji: string; userIds: string[] }>>();
  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
    })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, messageIds));

  // messageId → emoji → userIds
  const byMsg = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    let m = byMsg.get(r.messageId);
    if (!m) { m = new Map(); byMsg.set(r.messageId, m); }
    let arr = m.get(r.emoji);
    if (!arr) { arr = []; m.set(r.emoji, arr); }
    arr.push(r.userId);
  }
  const out = new Map<string, Array<{ emoji: string; userIds: string[] }>>();
  for (const [msgId, emojiMap] of byMsg) {
    out.set(msgId, Array.from(emojiMap, ([emoji, userIds]) => ({ emoji, userIds })));
  }
  return out;
}

function attachReactions<T extends { id: string }>(
  msgs: T[],
  reactionsByMsg: Map<string, Array<{ emoji: string; userIds: string[] }>>
) {
  return msgs.map((m) => ({ ...m, reactions: reactionsByMsg.get(m.id) || [] }));
}

export function createChatRouter() {
  const router = Router();

  // GET /messages/global — últimas msgs do canal global (ordem: mais recente primeiro)
  router.get("/messages/global", requireAuth, async (req: Request, res: Response) => {
    const { limit, before } = parsePagination(req);
    try {
      const db = getDb();
      const where = before
        ? and(eq(messages.channelType, "global"), lt(messages.createdAt, before))
        : eq(messages.channelType, "global");
      const rows = await db
        .select({
          id: messages.id,
          senderId: messages.senderId,
          content: messages.content,
          createdAt: messages.createdAt,
          senderName: profiles.displayName,
        })
        .from(messages)
        .leftJoin(profiles, eq(profiles.userId, messages.senderId))
        .where(where)
        .orderBy(desc(messages.createdAt))
        .limit(limit);
      const reactionsByMsg = await fetchReactionsFor(db, rows.map((r) => r.id));
      return res.json({ messages: attachReactions(rows.reverse(), reactionsByMsg) });
    } catch (err: any) {
      console.error("[/messages/global] erro:", err);
      return res.status(500).json({ error: "Falha ao buscar mensagens" });
    }
  });

  // GET /messages/dm/:otherUserId — histórico do par
  router.get("/messages/dm/:otherUserId", requireAuth, async (req: Request, res: Response) => {
    const me = req.auth!.sub;
    const other = req.params.otherUserId;
    const { limit, before } = parsePagination(req);
    try {
      const db = getDb();
      const pair = or(
        and(eq(messages.senderId, me), eq(messages.recipientId, other)),
        and(eq(messages.senderId, other), eq(messages.recipientId, me))
      );
      const where = before
        ? and(eq(messages.channelType, "dm"), pair, lt(messages.createdAt, before))
        : and(eq(messages.channelType, "dm"), pair);
      const rows = await db
        .select({
          id: messages.id,
          senderId: messages.senderId,
          recipientId: messages.recipientId,
          content: messages.content,
          createdAt: messages.createdAt,
          senderName: profiles.displayName,
        })
        .from(messages)
        .leftJoin(profiles, eq(profiles.userId, messages.senderId))
        .where(where)
        .orderBy(desc(messages.createdAt))
        .limit(limit);
      const reactionsByMsg = await fetchReactionsFor(db, rows.map((r) => r.id));
      return res.json({ messages: attachReactions(rows.reverse(), reactionsByMsg) });
    } catch (err: any) {
      console.error("[/messages/dm/:id] erro:", err);
      return res.status(500).json({ error: "Falha ao buscar mensagens" });
    }
  });

  // GET /messages/dm — lista de conversas DM do usuário logado.
  // Pra cada outro usuário com quem ele já trocou msg, devolve a última mensagem.
  router.get("/messages/dm", requireAuth, async (req: Request, res: Response) => {
    const me = req.auth!.sub;
    try {
      const db = getDb();
      // Pra cada DM do user, identifica o "outro user" e pega a última mensagem
      // (truque com SQL bruto pq Drizzle não tem GROUP+last facilmente)
      const rows = await db.execute(sql`
        WITH user_messages AS (
          SELECT
            m.*,
            CASE WHEN m.sender_id = ${me} THEN m.recipient_id ELSE m.sender_id END AS other_user
          FROM messages m
          WHERE m.channel_type = 'dm'
            AND (m.sender_id = ${me} OR m.recipient_id = ${me})
        ),
        ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY other_user ORDER BY created_at DESC) AS rn
          FROM user_messages
        )
        SELECT r.id, r.sender_id, r.recipient_id, r.content, r.created_at, r.other_user,
               p.display_name AS other_name
        FROM ranked r
        LEFT JOIN profiles p ON p.user_id = r.other_user
        WHERE r.rn = 1
        ORDER BY r.created_at DESC
        LIMIT 100
      `);
      // pg-node retorna { rows } na execute do drizzle node-postgres
      const list = (rows as any).rows || rows;
      return res.json({ conversations: list });
    } catch (err: any) {
      console.error("[/messages/dm list] erro:", err);
      return res.status(500).json({ error: "Falha ao listar conversas" });
    }
  });

  return router;
}

// Re-exporta pra index.ts ficar enxuto
export { messages, profiles, users };
