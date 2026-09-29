// Multi-tenancy build-order step 8 - utils/domainPolicy.js
// Org email-domain allowlist policy, enforced on user creation (single +
// CSV import). Configured per org by the Platform Super Admin:
//   org.allowedDomains        list of domains users may be created on
//   org.features.externalUsers when true, off-list domains are allowed but
//                              flagged as "external" (with a warning)

// "User@Acme.COM " → "acme.com"
const emailDomain = (email) => String(email || '').toLowerCase().trim().split('@')[1] || ''

// Checks an email against an org's domain policy. Returns one of:
//   { allowed: true }                          on-list (or no policy set)
//   { allowed: true, external: true, warning } off-list, externalUsers on
//   { allowed: false, reason }                 off-list, externalUsers off
const checkEmailDomain = (org, email) => {
  const domains = Array.isArray(org?.allowedDomains) ? org.allowedDomains : []
  if (domains.length === 0) return { allowed: true }

  const domain = emailDomain(email)
  if (domains.includes(domain)) return { allowed: true }

  if (org?.features?.externalUsers) {
    return {
      allowed: true,
      external: true,
      warning: `"@${domain}" is not on ${org.name}'s allowed domains (${domains.map((d) => `@${d}`).join(', ')}). The user was created as an EXTERNAL user because this organization allows external users.`
    }
  }

  return {
    allowed: false,
    reason: `Email domain "@${domain}" is not allowed for ${org.name}. Allowed domains: ${domains.map((d) => `@${d}`).join(', ')}. Ask your platform administrator to add the domain or enable external users.`
  }
}

module.exports = { checkEmailDomain, emailDomain }
