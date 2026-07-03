/**
 * Standalone entry for the WHOOP webhook receiver.
 *
 * This deliberately does NOT sit behind CloudFront's /api/* behavior: OAC
 * signing requires an x-amz-content-sha256 payload hash on POST bodies, which
 * WHOOP's webhook senders will never provide. The function URL is public
 * (authType NONE) — authentication is the HMAC signature check inside.
 */
export { handleWhoopWebhook as handler } from './whoop/routes'
