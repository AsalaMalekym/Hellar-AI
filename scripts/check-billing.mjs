import { billingConfig } from '../server/billing-config.ts';
const b = billingConfig();
if (b.enabled || (b.test && b.merchant)) {
 const required = ['OPENAI_API_KEY','ROBOKASSA_MERCHANT_LOGIN'];
 required.push(...(b.test ? ['ROBOKASSA_TEST_PASSWORD_1','ROBOKASSA_TEST_PASSWORD_2'] : ['ROBOKASSA_PASSWORD_1','ROBOKASSA_PASSWORD_2']));
 for (const name of required) if (!process.env[name]) throw Error('Add GitHub Actions secret ' + name + ' before enabling billing');
 if ((b.password1 && b.password1 === b.testPassword1) || (b.password2 && b.password2 === b.testPassword2)) throw Error('Robokassa test and live passwords must differ');
 if (!b.test && !process.env.BILLING_PRICES_JSON) throw Error('Set BILLING_PRICES_JSON with verified current API rates before accepting real payments');
 console.log('Billing settings validated; payment mode: ' + (b.test ? 'test (no spendable credits)' : 'live'));
} else console.log('No billing activation requested. Existing Worker bindings are preserved.');
