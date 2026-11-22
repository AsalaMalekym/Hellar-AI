import { z } from 'zod';
export const MICRO = 1_000_000;
export const PLAN_PRICE = 12 * MICRO;
export const PLAN_ALLOWANCE = 12 * MICRO; // retail credits: $6 provider cost at 2x
const priceSchema = z
  .object({
    input: z.number().nonnegative().max(1000),
    cached: z.number().nonnegative().max(1000),
    output: z.number().positive().max(1000),
  })
  .refine((x) => x.cached <= x.input);
export type Price = z.infer<typeof priceSchema>;
// Standard (not Batch/fine-tuning) legacy model rates, USD per million tokens.
// Override and re-verify against the provider's tariff before enabling sales.
const legacyPrices: Record<string, Price> = {
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-image-1': { input: 5, cached: 1.25, output: 40 },
};
export function billingConfig(env: Record<string, string | undefined> = process.env) {
  const rawFx = env.BILLING_RUB_PER_USD || '100';
  if (rawFx && !/^\d{1,4}(\.\d{1,2})?$/.test(rawFx)) throw Error('Invalid BILLING_RUB_PER_USD');
  const fxKopecks = rawFx ? Math.round(Number(rawFx) * 100) : 0;
  if (rawFx && (fxKopecks < 100 || fxKopecks > 100000)) throw Error('Invalid BILLING_RUB_PER_USD');
  const prices = z
    .record(z.string(), priceSchema)
    .parse(env.BILLING_PRICES_JSON ? JSON.parse(env.BILLING_PRICES_JSON) : legacyPrices);
  return {
    enabled: env.BILLING_ENABLED === 'true',
    fxKopecks,
    prices,
    merchant: env.ROBOKASSA_MERCHANT_LOGIN || '',
    password1: env.ROBOKASSA_PASSWORD_1 || '',
    password2: env.ROBOKASSA_PASSWORD_2 || '',
    testPassword1: env.ROBOKASSA_TEST_PASSWORD_1 || '',
    testPassword2: env.ROBOKASSA_TEST_PASSWORD_2 || '',
    test: env.ROBOKASSA_TEST !== 'false',
  };
}
export type BillingConfig = ReturnType<typeof billingConfig>;
