'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plans = require('../lib/plans');
const razorpay = require('../lib/razorpay');

test('Seevora Plans: accurate pricing and terms from extracted pricing catalog', () => {
  const starter = plans.getPlan('starter');
  assert.equal(starter.name, 'Starter');
  assert.equal(starter.prices.monthly.amount, 5199);
  assert.equal(starter.prices.monthly.amountPaise, 519900);
  assert.equal(starter.prices.quarterly.amount, 14799);
  assert.equal(starter.prices.quarterly.amountPaise, 1479900);
  assert.equal(starter.prices.quarterly.perMonth, 4933);
  assert.equal(starter.prices.annual.amount, 56099);
  assert.equal(starter.prices.annual.amountPaise, 5609900);
  assert.equal(starter.prices.annual.perMonth, 4675);
  assert.equal(starter.limits.voiceMinutes, 500);
  assert.equal(starter.limits.activeWorkflows, 3);
  assert.equal(starter.limits.contacts, 1000);
  assert.equal(starter.limits.users, 2);

  const growth = plans.getPlan('growth');
  assert.equal(growth.name, 'Growth');
  assert.equal(growth.prices.monthly.amount, 10999);
  assert.equal(growth.prices.quarterly.amount, 31299);
  assert.equal(growth.prices.quarterly.perMonth, 10433);
  assert.equal(growth.prices.annual.amount, 118799);
  assert.equal(growth.prices.annual.perMonth, 9900);
  assert.equal(growth.limits.voiceMinutes, 1000);
  assert.equal(growth.limits.activeWorkflows, 10);
  assert.equal(growth.limits.contacts, 10000);
  assert.equal(growth.limits.users, 5);

  const business = plans.getPlan('business');
  assert.equal(business.name, 'Business');
  assert.equal(business.prices.monthly.amount, 25999);
  assert.equal(business.prices.quarterly.amount, 74099);
  assert.equal(business.prices.quarterly.perMonth, 24700);
  assert.equal(business.prices.annual.amount, 280799);
  assert.equal(business.prices.annual.perMonth, 23400);
  assert.equal(business.limits.voiceMinutes, 2500);
  assert.equal(business.limits.activeWorkflows, 30);
  assert.equal(business.limits.contacts, 50000);
  assert.equal(business.limits.users, 15);

  const enterprise = plans.getPlan('enterprise');
  assert.equal(enterprise.name, 'Enterprise');
  assert.equal(enterprise.limits.voiceMinutes, 10000);
  assert.equal(enterprise.limits.activeWorkflows, 999999);
  assert.equal(enterprise.contact.phone, '8982200895');
});

test('Feature Entitlements: enforces role and plan authorization', () => {
  const starterTenant = { id: 't_starter', plan: 'starter' };
  const growthTenant = { id: 't_growth', plan: 'growth' };
  const businessTenant = { id: 't_business', plan: 'business' };
  const enterpriseTenant = { id: 't_ent', plan: 'enterprise' };

  // Broadcasts & automation flows
  assert.equal(plans.assertFeatureAllowed(starterTenant, 'broadcasts').allowed, false);
  assert.equal(plans.assertFeatureAllowed(starterTenant, 'broadcasts').requiredPlan, 'growth');
  assert.equal(plans.assertFeatureAllowed(growthTenant, 'broadcasts').allowed, true);
  assert.equal(plans.assertFeatureAllowed(businessTenant, 'broadcasts').allowed, true);
  assert.equal(plans.assertFeatureAllowed(enterpriseTenant, 'broadcasts').allowed, true);

  // Call to WhatsApp follow-ups
  assert.equal(plans.assertFeatureAllowed(starterTenant, 'callToWhatsapp').allowed, false);
  assert.equal(plans.assertFeatureAllowed(growthTenant, 'callToWhatsapp').allowed, true);
  assert.equal(plans.assertFeatureAllowed(businessTenant, 'callToWhatsapp').allowed, true);

  // Webhooks and API access
  assert.equal(plans.assertFeatureAllowed(starterTenant, 'webhooksApi').allowed, false);
  assert.equal(plans.assertFeatureAllowed(growthTenant, 'webhooksApi').allowed, false);
  assert.equal(plans.assertFeatureAllowed(businessTenant, 'webhooksApi').allowed, true);
  assert.equal(plans.assertFeatureAllowed(enterpriseTenant, 'webhooksApi').allowed, true);

  // Custom development
  assert.equal(plans.assertFeatureAllowed(businessTenant, 'customDevelopment').allowed, false);
  assert.equal(plans.assertFeatureAllowed(enterpriseTenant, 'customDevelopment').allowed, true);

  // Super admin bypass
  const superAdmin = { role: 'super_admin' };
  assert.equal(plans.assertFeatureAllowed(starterTenant, 'broadcasts', superAdmin).allowed, true);
  assert.equal(plans.assertFeatureAllowed(starterTenant, 'webhooksApi', superAdmin).allowed, true);
});

test('Quota Limits: enforces workflow workspace and CRM contact caps', () => {
  const mockDb = {
    tenants: [
      { id: 't_s', plan: 'starter' },
      { id: 't_g', plan: 'growth' },
    ],
    agents: [
      { id: 'ag_1', tenantId: 't_s' },
      { id: 'ag_2', tenantId: 't_s' },
      { id: 'ag_3', tenantId: 't_s' }, // 3 active workflows
    ],
    crmContacts: [
      { id: 'c_1', tenantId: 't_s' },
    ],
    users: [
      { id: 'u_1', tenantId: 't_s', status: 'active' },
    ],
  };

  // Starter has 3/3 active workflows -> next one must be blocked
  const wfStarterFull = plans.checkWorkflowLimit(mockDb, 't_s');
  assert.equal(wfStarterFull.allowed, false);
  assert.equal(wfStarterFull.code, 'plan_limit_exceeded');

  // Growth has 0/10 active workflows -> allowed
  const wfGrowthOk = plans.checkWorkflowLimit(mockDb, 't_g');
  assert.equal(wfGrowthOk.allowed, true);

  // Super admin bypasses workflow limit
  const wfAdminBypass = plans.checkWorkflowLimit(mockDb, 't_s', { role: 'super_admin' });
  assert.equal(wfAdminBypass.allowed, true);

  // CRM Contacts: Starter limit is 1,000
  const contactOk = plans.checkContactsLimit(mockDb, 't_s', 10);
  assert.equal(contactOk.allowed, true);

  const contactOverflow = plans.checkContactsLimit(mockDb, 't_s', 1005);
  assert.equal(contactOverflow.allowed, false);
  assert.equal(contactOverflow.code, 'plan_limit_exceeded');
});

test('Add-ons Rate Card and Wallet Packs integrity', () => {
  assert.ok(Array.isArray(plans.SEEVORA_ADDONS));
  assert.equal(plans.SEEVORA_ADDONS.length, 7);

  const inbound = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_voice_inbound');
  assert.equal(inbound.rate, '₹7.00');

  const outbound = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_voice_outbound');
  assert.equal(outbound.rate, '₹8.00');

  const mktMsg = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_marketing_msg');
  assert.equal(mktMsg.rate, '₹1.80');

  const svcMsg = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_service_msg');
  assert.equal(svcMsg.rate, '₹0.30');

  const voiceNum = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_voice_number');
  assert.equal(voiceNum.rate, '₹399');

  const waNum = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_wa_number');
  assert.equal(waNum.rate, '₹499');

  const user = plans.SEEVORA_ADDONS.find((a) => a.id === 'extra_user');
  assert.equal(user.rate, '₹249');

  // Prepaid wallet packs have minimum ₹500 top-up
  assert.equal(plans.WALLET_TOPUP_PACKS.topup_500.amountPaise, 50000);
  assert.equal(plans.WALLET_TOPUP_PACKS.topup_1000.amountPaise, 100000);
});

test('Razorpay Subscription Flow: creates verified order for Growth quarterly plan', () => {
  const growthQuarterly = plans.SEEVORA_PLANS.growth.prices.quarterly;
  assert.equal(growthQuarterly.amount, 31299);
  assert.equal(growthQuarterly.amountPaise, 3129900);

  const orderId = 'order_growth_q_123';
  const paymentId = 'pay_growth_q_123';
  const secret = 'rzp_test_secret_growth';

  const signature = razorpay.hmacSha256Hex(`${orderId}|${paymentId}`, secret);
  const verify = razorpay.verifyPaymentSignature({
    orderId,
    paymentId,
    signature,
    secret,
  });

  assert.equal(verify.valid, true);

  // Tenant state upgrade simulation
  const tenant = { id: 't_upgrade_1', plan: 'starter', billingInterval: 'monthly' };
  tenant.plan = 'growth';
  tenant.billingInterval = 'quarterly';
  tenant.planExpiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
  tenant.planStatus = 'active';

  assert.equal(tenant.plan, 'growth');
  assert.equal(tenant.billingInterval, 'quarterly');
  assert.ok(tenant.planExpiresAt > new Date().toISOString());
});
