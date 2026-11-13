/** Machine-readable codes the frontend switches on, returned in the `code` field. */
export const SUBSCRIPTION_ERROR = {
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  USER_LIMIT_EXCEEDED: 'USER_LIMIT_EXCEEDED',
} as const;

export type SubscriptionErrorCode =
  (typeof SUBSCRIPTION_ERROR)[keyof typeof SUBSCRIPTION_ERROR];

export const SUBSCRIPTION_EXPIRED_MESSAGE =
  'Your subscription has expired. Please renew to continue.';

/** How long before `endDate` the UI starts warning. */
export const EXPIRING_SOON_DAYS = 7;

export const DEFAULT_USER_LIMIT = 3;
