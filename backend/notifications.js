// Pass the active transaction connection so the business change and notification commit together.
export async function notify(conn, {recipientId, actorId, type, articleId = null, commentId = null, summary, eventKey}) {
  if (String(recipientId) === String(actorId) && ['COMMENT', 'REPLY'].includes(type)) return;
  await conn.execute(`INSERT INTO notifications
    (recipient_id,actor_id,type,article_id,comment_id,summary,event_key) VALUES (?,?,?,?,?,?,?)`,
  [recipientId, actorId, type, articleId, commentId, summary.slice(0,200), eventKey]);
}
