import webpush from "web-push";
function vapid(environment) {
  const publicKey = environment.VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.VAPID_PRIVATE_KEY?.trim();
  const subject = environment.VAPID_SUBJECT?.trim() || "mailto:admin@pr-helper.app";
  if (!publicKey || !privateKey) return null;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return publicKey;
}
function pushPublicKey(environment) {
  return environment.VAPID_PUBLIC_KEY?.trim() || "";
}
function validPushSubscription(value) {
  if (!value || typeof value !== "object") return false;
  const subscription = value;
  return typeof subscription.endpoint === "string" && subscription.endpoint.startsWith("https://") && Boolean(subscription.keys) && typeof subscription.keys?.p256dh === "string" && typeof subscription.keys?.auth === "string";
}
async function sendPushNotifications(environment, sql, userId, event) {
  if (!vapid(environment)) return 0;
  const recorded = await sql`INSERT INTO pr_helper_notification_deliveries (user_id, event_key, kind, title, body) VALUES (${userId}, ${event.eventKey}, ${event.kind}, ${event.title}, ${event.body}) ON CONFLICT (user_id, event_key) DO NOTHING RETURNING id`;
  if (!recorded.length) return 0;
  const subscriptions = await sql`SELECT endpoint, subscription FROM pr_helper_push_subscriptions WHERE user_id = ${userId}`;
  const payload = JSON.stringify({ title: event.title, body: event.body, url: event.url || "/" });
  const results = await Promise.allSettled(subscriptions.map((item) => webpush.sendNotification(item.subscription, payload)));
  const expired = results.flatMap((result, index) => result.status === "rejected" && [404, 410].includes(result.reason.statusCode || 0) ? [subscriptions[index].endpoint] : []);
  if (expired.length) await sql`DELETE FROM pr_helper_push_subscriptions WHERE endpoint = ANY(${expired})`;
  return results.filter((result) => result.status === "fulfilled").length;
}
export {
  pushPublicKey,
  sendPushNotifications,
  validPushSubscription
};
