/**
 * Seevora AI Voice Subscription Plans, Limits, Add-ons & Entitlements Module.
 * Source of truth extracted from Seevora Pricing Plans.
 *
 * Provides:
 *   - Tier definitions: Starter, Growth, Business, Enterprise
 *   - Billing cycles: Monthly, Quarterly (save ~5%), Annual (save 10%)
 *   - Quota limits: Voice minutes, active workflows, numbers, contacts, users, messages
 *   - Feature entitlements & authorization guards
 *   - Add-on overage rate card
 *   - Prepaid wallet top-up packs
 *
 * ZERO external npm dependencies.
 */
'use strict';

const SEEVORA_PLANS = Object.freeze({
  starter: Object.freeze({
    id: 'starter',
    name: 'Starter',
    badge: 'Starter',
    tagline: 'Ideal for local clinics, salons & single-location businesses',
    prices: Object.freeze({
      monthly: Object.freeze({
        amount: 5199,
        amountPaise: 519900,
        perMonth: 5199,
        label: '₹5,199',
        periodLabel: '/month',
        discount: null,
        productinfo: 'Seevora Starter Plan - Monthly (500 mins, 3 workflows)',
      }),
      quarterly: Object.freeze({
        amount: 14799,
        amountPaise: 1479900,
        perMonth: 4933,
        label: '₹14,799',
        periodLabel: '/quarter',
        discount: 'Save ~5% (₹4,933/mo)',
        productinfo: 'Seevora Starter Plan - Quarterly (500 mins/mo, 3 workflows)',
      }),
      annual: Object.freeze({
        amount: 56099,
        amountPaise: 5609900,
        perMonth: 4675,
        label: '₹56,099',
        periodLabel: '/year',
        discount: 'Save 10% (₹4,675/mo)',
        productinfo: 'Seevora Starter Plan - Annual (500 mins/mo, 3 workflows)',
      }),
    }),
    limits: Object.freeze({
      voiceMinutes: 500,
      activeWorkflows: 25,
      voiceNumbers: 1,
      whatsappNumbers: 1,
      contacts: 1000,
      users: 25,
      serviceMessages: 1000,
      marketingMessages: 100,
    }),
    features: Object.freeze({
      voiceReceptionist: true,
      whatsappCrm: true,
      autoRepliesReminders: true,
      broadcasts: false,
      callToWhatsapp: false,
      tagsAndSegments: false,
      webhooksApi: false,
      reportsPrioritySupport: false,
      customDevelopment: false,
    }),
    highlights: Object.freeze([
      '500 voice minutes / month',
      'Workflow workspace: 3 active workflows',
      'AI voice receptionist, 24/7',
      '1 voice + 1 WhatsApp number',
      'WhatsApp shared inbox and CRM',
      '1,000 contacts, 2 users',
      '1,000 service and utility messages',
      '100 marketing messages',
      'Auto-replies and appointment reminders',
    ]),
  }),

  growth: Object.freeze({
    id: 'growth',
    name: 'Growth',
    badge: 'Most Popular',
    popular: true,
    tagline: 'Built for fast-growing teams running campaigns & follow-ups',
    prices: Object.freeze({
      monthly: Object.freeze({
        amount: 10999,
        amountPaise: 1099900,
        perMonth: 10999,
        label: '₹10,999',
        periodLabel: '/month',
        discount: null,
        productinfo: 'Seevora Growth Plan - Monthly (1,000 mins, 10 workflows)',
      }),
      quarterly: Object.freeze({
        amount: 31299,
        amountPaise: 3129900,
        perMonth: 10433,
        label: '₹31,299',
        periodLabel: '/quarter',
        discount: 'Save ~5% (₹10,433/mo)',
        productinfo: 'Seevora Growth Plan - Quarterly (1,000 mins/mo, 10 workflows)',
      }),
      annual: Object.freeze({
        amount: 118799,
        amountPaise: 11879900,
        perMonth: 9900,
        label: '₹1,18,799',
        periodLabel: '/year',
        discount: 'Save 10% (₹9,900/mo)',
        productinfo: 'Seevora Growth Plan - Annual (1,000 mins/mo, 10 workflows)',
      }),
    }),
    limits: Object.freeze({
      voiceMinutes: 1000,
      activeWorkflows: 10,
      voiceNumbers: 1,
      whatsappNumbers: 1,
      contacts: 10000,
      users: 5,
      serviceMessages: 3000,
      marketingMessages: 500,
    }),
    features: Object.freeze({
      voiceReceptionist: true,
      whatsappCrm: true,
      autoRepliesReminders: true,
      broadcasts: true,
      callToWhatsapp: true,
      tagsAndSegments: true,
      webhooksApi: false,
      reportsPrioritySupport: false,
      customDevelopment: false,
    }),
    highlights: Object.freeze([
      '1,000 voice minutes / month',
      'Workflow workspace: 10 active workflows',
      'Everything in Starter, plus:',
      '10,000 contacts, 5 users',
      '3,000 service and utility messages',
      '500 marketing messages',
      'Broadcasts and automation flows',
      'Call-to-WhatsApp follow-ups',
      'Tags and segments',
    ]),
  }),

  business: Object.freeze({
    id: 'business',
    name: 'Business',
    badge: 'Scale',
    tagline: 'High volume, multiple phone lines, integrations and API access',
    prices: Object.freeze({
      monthly: Object.freeze({
        amount: 25999,
        amountPaise: 2599900,
        perMonth: 25999,
        label: '₹25,999',
        periodLabel: '/month',
        discount: null,
        productinfo: 'Seevora Business Plan - Monthly (2,500 mins, 30 workflows)',
      }),
      quarterly: Object.freeze({
        amount: 74099,
        amountPaise: 7409900,
        perMonth: 24700,
        label: '₹74,099',
        periodLabel: '/quarter',
        discount: 'Save ~5% (₹24,700/mo)',
        productinfo: 'Seevora Business Plan - Quarterly (2,500 mins/mo, 30 workflows)',
      }),
      annual: Object.freeze({
        amount: 280799,
        amountPaise: 28079900,
        perMonth: 23400,
        label: '₹2,80,799',
        periodLabel: '/year',
        discount: 'Save 10% (₹23,400/mo)',
        productinfo: 'Seevora Business Plan - Annual (2,500 mins/mo, 30 workflows)',
      }),
    }),
    limits: Object.freeze({
      voiceMinutes: 2500,
      activeWorkflows: 30,
      voiceNumbers: 2,
      whatsappNumbers: 2,
      contacts: 50000,
      users: 15,
      serviceMessages: 8000,
      marketingMessages: 1500,
    }),
    features: Object.freeze({
      voiceReceptionist: true,
      whatsappCrm: true,
      autoRepliesReminders: true,
      broadcasts: true,
      callToWhatsapp: true,
      tagsAndSegments: true,
      webhooksApi: true,
      reportsPrioritySupport: true,
      customDevelopment: false,
    }),
    highlights: Object.freeze([
      '2,500 voice minutes / month',
      'Workflow workspace: 30 active workflows',
      'Everything in Growth, plus:',
      '2 voice + 2 WhatsApp numbers',
      '50,000 contacts, 15 users',
      '8,000 service and utility messages',
      '1,500 marketing messages',
      'Webhooks and API access',
      'Reports and priority support',
    ]),
  }),

  enterprise: Object.freeze({
    id: 'enterprise',
    name: 'Enterprise',
    badge: 'Enterprise',
    quoteOnly: true,
    tagline: 'Custom development, 10,000+ minutes, built around your business',
    prices: Object.freeze({
      monthly: Object.freeze({
        amount: 140000,
        amountPaise: 14000000,
        perMonth: 140000,
        label: 'From ₹1,40,000',
        periodLabel: '/month',
        discount: 'Terms by quote',
        productinfo: 'Seevora Enterprise Plan (Custom development & SLA)',
      }),
    }),
    limits: Object.freeze({
      voiceMinutes: 10000,
      activeWorkflows: 999999, // unlimited
      voiceNumbers: 5,
      whatsappNumbers: 5,
      contacts: 1000000, // custom / unlimited
      users: 50,
      serviceMessages: 30000,
      marketingMessages: 6000,
    }),
    features: Object.freeze({
      voiceReceptionist: true,
      whatsappCrm: true,
      autoRepliesReminders: true,
      broadcasts: true,
      callToWhatsapp: true,
      tagsAndSegments: true,
      webhooksApi: true,
      reportsPrioritySupport: true,
      customDevelopment: true,
    }),
    highlights: Object.freeze([
      '10,000+ voice minutes / month',
      'Unlimited workflows in workspace',
      '5+ voice + 5+ WhatsApp numbers',
      'Custom CRM contacts (50,000+)',
      '50+ users',
      '30,000+ service & utility messages',
      '6,000+ marketing messages',
      'Custom development built around your business',
      'Dedicated SLA and account executive',
    ]),
    contact: Object.freeze({
      phone: '8982200895',
      whatsapp: '8982200895',
      terms: 'Terms by quote',
    }),
  }),
});

const SEEVORA_ADDONS = Object.freeze([
  Object.freeze({
    id: 'extra_voice_inbound',
    name: 'Extra voice minute (inbound)',
    rate: '₹7.00',
    unit: 'per minute',
    description: 'Deducted from prepaid wallet for calls exceeding plan minutes.',
  }),
  Object.freeze({
    id: 'extra_voice_outbound',
    name: 'Extra voice minute (outbound)',
    rate: '₹8.00',
    unit: 'per minute',
    description: 'Deducted from prepaid wallet for outbound calls exceeding plan minutes.',
  }),
  Object.freeze({
    id: 'extra_marketing_msg',
    name: 'Extra marketing message',
    rate: '₹1.80',
    unit: 'per message',
    description: 'For WhatsApp promotional campaigns above plan quota.',
  }),
  Object.freeze({
    id: 'extra_service_msg',
    name: 'Extra service or utility message',
    rate: '₹0.30',
    unit: 'per message',
    description: 'Transactional notifications, OTPs and appointment updates.',
  }),
  Object.freeze({
    id: 'extra_voice_number',
    name: 'Extra voice number',
    rate: '₹399',
    unit: 'per month',
    description: 'Dedicated inbound voice number with carrier routing.',
  }),
  Object.freeze({
    id: 'extra_wa_number',
    name: 'Extra WhatsApp number',
    rate: '₹499',
    unit: 'per month',
    description: 'Additional connected WhatsApp Business phone number.',
  }),
  Object.freeze({
    id: 'extra_user',
    name: 'Extra user',
    rate: '₹249',
    unit: 'per month',
    description: 'Team member seat with workspace access and permissions.',
  }),
]);

const WALLET_TOPUP_PACKS = Object.freeze({
  topup_500: Object.freeze({
    id: 'topup_500',
    amount: '500.00',
    amountPaise: 50000,
    credits: 50000,
    currency: 'INR',
    label: '₹500 Top-up',
    description: 'Seevora Prepaid Wallet Recharge (Min ₹500)',
  }),
  topup_1000: Object.freeze({
    id: 'topup_1000',
    amount: '1000.00',
    amountPaise: 100000,
    credits: 100000,
    currency: 'INR',
    label: '₹1,000 Top-up',
    description: 'Seevora Prepaid Wallet Recharge',
  }),
  topup_2500: Object.freeze({
    id: 'topup_2500',
    amount: '2500.00',
    amountPaise: 250000,
    credits: 250000,
    currency: 'INR',
    label: '₹2,500 Top-up',
    description: 'Seevora Prepaid Wallet Recharge',
  }),
  topup_5000: Object.freeze({
    id: 'topup_5000',
    amount: '5000.00',
    amountPaise: 500000,
    credits: 500000,
    currency: 'INR',
    label: '₹5,000 Top-up',
    description: 'Seevora Prepaid Wallet Recharge',
  }),
});

const PLAN_HIERARCHY = Object.freeze({
  free: 0,
  starter: 1,
  growth: 2,
  business: 3,
  enterprise: 4,
});

/**
 * Get normalized plan object. Defaults to 'starter'.
 */
function getPlan(planId) {
  const key = String(planId || 'starter').toLowerCase();
  return SEEVORA_PLANS[key] || SEEVORA_PLANS.starter;
}

/**
 * Check if a plan is entitled to use a specific feature.
 */
function canUseFeature(planId, featureKey) {
  const plan = getPlan(planId);
  return Boolean(plan.features && plan.features[featureKey]);
}

/**
 * Assert that a tenant is permitted to use a specific feature.
 * Returns { allowed: true } or { allowed: false, error: '...', code: '...', requiredPlan: '...' }
 */
function assertFeatureAllowed(tenant, featureKey, user) {
  if (user && (user.role === 'super_admin' || user.role === 'admin')) {
    return { allowed: true };
  }

  // 1. Explicit admin tenant feature override
  if (tenant && tenant.features && typeof tenant.features[featureKey] === 'boolean') {
    if (tenant.features[featureKey] === false) {
      const featureLabels = {
        inbound: 'Inbound Call Receptionist & IVR',
        campaigns: 'Outbound Voice Campaigns',
        recordings: 'Call Audio Recordings & Transcripts',
        crmPipeline: 'Leads & WhatsApp CRM Pipeline',
        agents: 'AI Voice Agents Creator',
        talk: 'Talk to Agent Voice Testing',
        assistant: 'AI Chatbot & Knowledge Base',
        teams: 'Team & Staff Directory Management',
        liveMonitor: 'Live Call Monitoring & Decline',
        didNumbers: 'Virtual DID Telephony Numbers',
        whatsappMessaging: 'Automated WhatsApp Messaging',
        webhooksApi: 'Webhooks & Developer APIs',
        workflows: 'Workflows & Multi-Step Call Automation',
        broadcasts: 'Broadcasts and automation flows',
        callToWhatsapp: 'Call-to-WhatsApp follow-ups',
        tagsAndSegments: 'Tags and custom segments'
      };
      const label = featureLabels[featureKey] || featureKey;
      return {
        allowed: false,
        error: label + ' has been disabled for your workspace by the platform administrator.',
        code: 'feature_disabled_by_admin',
        feature: featureKey
      };
    }
    return { allowed: true };
  }

  // Core features enabled by default across all tiers unless admin turned them off
  const defaultCoreFeatures = ['inbound', 'campaigns', 'recordings', 'crmPipeline', 'agents', 'talk', 'assistant', 'teams', 'liveMonitor', 'didNumbers', 'voiceReceptionist', 'whatsappCrm', 'autoRepliesReminders', 'workflows'];
  if (defaultCoreFeatures.includes(featureKey)) {
    return { allowed: true };
  }



  const planId = (tenant && tenant.plan) || 'starter';
  const plan = getPlan(planId);

  if (plan.features && plan.features[featureKey]) {
    return { allowed: true };
  }

  // Find minimum plan that supports this feature
  let requiredPlan = 'growth';
  if (['webhooksApi', 'reportsPrioritySupport'].includes(featureKey)) {
    requiredPlan = 'business';
  } else if (featureKey === 'customDevelopment') {
    requiredPlan = 'enterprise';
  }

  const featureLabels = {
    broadcasts: 'Broadcasts and automation flows',
    callToWhatsapp: 'Call-to-WhatsApp follow-ups',
    tagsAndSegments: 'Tags and custom segments',
    webhooksApi: 'Webhooks and API access',
    reportsPrioritySupport: 'Reports and priority support',
    customDevelopment: 'Custom development',
  };

  const featureLabel = featureLabels[featureKey] || featureKey;
  const reqPlanName = getPlan(requiredPlan).name;

  return {
    allowed: false,
    error: `${featureLabel} require the ${reqPlanName} plan or higher. Please upgrade your plan in Billing & Wallet.`,
    code: 'plan_feature_locked',
    feature: featureKey,
    requiredPlan,
    currentPlan: plan.id,
  };
}

/**
 * Check active workflows limit for a tenant.
 */
function checkWorkflowLimit(db, tenantId, user) {
  const tenant = (db.tenants || []).find((t) => t.id === tenantId);
  const plan = getPlan(tenant && tenant.plan);
  const maxWorkflows = plan.limits.activeWorkflows;

  // Active workflows in this workspace (or active agents fallback)
  const currentCount = Array.isArray(db.workflows) && db.workflows.some((w) => w.tenantId === tenantId)
    ? db.workflows.filter((w) => w.tenantId === tenantId && w.status === 'active').length
    : (db.agents || []).filter((a) => a.tenantId === tenantId).length;

  if (user && (user.role === 'super_admin' || user.role === 'admin')) {
    return { allowed: true, current: currentCount, limit: maxWorkflows };
  }

  if (currentCount >= maxWorkflows) {
    return {
      allowed: false,
      current: currentCount,
      limit: maxWorkflows,
      error: `Workflow workspace limit reached: Your ${plan.name} plan allows up to ${maxWorkflows} active workflow${maxWorkflows === 1 ? '' : 's'}. Upgrade to ${plan.id === 'starter' ? 'Growth (10 workflows)' : 'Business (30 workflows)'} to add more.`,
      code: 'plan_limit_exceeded',
      limitType: 'workflows',
      currentPlan: plan.id,
    };
  }

  return { allowed: true, current: currentCount, limit: maxWorkflows };
}

/**
 * Check CRM contacts limit for a tenant.
 */
function checkContactsLimit(db, tenantId, countToAdd = 1, user) {
  const tenant = (db.tenants || []).find((t) => t.id === tenantId);
  const plan = getPlan(tenant && tenant.plan);
  const maxContacts = plan.limits.contacts;

  const currentCount = (db.crmContacts || []).filter((c) => c.tenantId === tenantId).length;

  if (user && (user.role === 'super_admin' || user.role === 'admin')) {
    return { allowed: true, current: currentCount, limit: maxContacts };
  }

  if (currentCount + countToAdd > maxContacts) {
    return {
      allowed: false,
      current: currentCount,
      limit: maxContacts,
      error: `CRM contact limit reached: Your ${plan.name} plan allows up to ${maxContacts.toLocaleString()} contacts (currently ${currentCount.toLocaleString()}). Upgrade your plan in Billing to store more contacts.`,
      code: 'plan_limit_exceeded',
      limitType: 'contacts',
      currentPlan: plan.id,
    };
  }

  return { allowed: true, current: currentCount, limit: maxContacts };
}

/**
 * Check team users limit for a tenant.
 */
function checkUsersLimit(db, tenantId) {
  const tenant = (db.tenants || []).find((t) => t.id === tenantId);
  const plan = getPlan(tenant && tenant.plan);
  const maxUsers = plan.limits.users;

  const currentCount = (db.users || []).filter((u) => u.tenantId === tenantId && u.status !== 'suspended').length;

  if (currentCount >= maxUsers) {
    return {
      allowed: false,
      current: currentCount,
      limit: maxUsers,
      error: `Team member limit reached: Your ${plan.name} plan allows up to ${maxUsers} user${maxUsers === 1 ? '' : 's'}. Upgrade your plan in Billing to invite additional team members.`,
      code: 'plan_limit_exceeded',
      limitType: 'users',
      currentPlan: plan.id,
    };
  }

  return { allowed: true, current: currentCount, limit: maxUsers };
}

/**
 * Get complete usage and limits snapshot for a tenant.
 */
function getTenantUsageAndLimits(db, tenantId) {
  const tenant = (db.tenants || []).find((t) => t.id === tenantId) || {};
  const plan = getPlan(tenant.plan);

  const activeWorkflows = (db.agents || []).filter((a) => a.tenantId === tenantId).length;
  const contacts = (db.crmContacts || []).filter((c) => c.tenantId === tenantId).length;
  const users = (db.users || []).filter((u) => u.tenantId === tenantId && u.status !== 'suspended').length;

  // Monthly aggregated voice usage
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const usageRows = (db.usage || []).filter((u) => u.tenantId === tenantId && u.day >= thirtyDaysAgo);
  const totalCalls = usageRows.reduce((sum, r) => sum + (r.calls || 0), 0);
  // Estimate minutes from calls (average call ~2 mins if not tracked)
  const estimatedVoiceMinutes = Math.round(usageRows.reduce((sum, r) => sum + (r.minutes || (r.calls ? r.calls * 1.5 : 0)), 0));

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      badge: plan.badge,
      billingInterval: tenant.billingInterval || 'monthly',
      planExpiresAt: tenant.planExpiresAt || null,
      status: tenant.planStatus || 'active',
    },
    limits: plan.limits,
    features: Object.assign({
      inbound: true,
      campaigns: true,
      recordings: true,
      crmPipeline: true,
      agents: true,
      talk: true,
      assistant: true,
      teams: true,
      liveMonitor: true,
      didNumbers: true,
      whatsappMessaging: true,
      workflows: true,
      webhooksApi: false
    }, plan.features || {}, tenant.features || {}),
    usage: {
      activeWorkflows,
      contacts,
      users,
      estimatedVoiceMinutes,
      totalCalls30d: totalCalls,
    },
  };
}

module.exports = {
  SEEVORA_PLANS,
  SEEVORA_ADDONS,
  WALLET_TOPUP_PACKS,
  PLAN_HIERARCHY,
  getPlan,
  canUseFeature,
  assertFeatureAllowed,
  checkWorkflowLimit,
  checkContactsLimit,
  checkUsersLimit,
  getTenantUsageAndLimits,
};
