import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// VitePress site configuration for the NetFlow product documentation.
// Public docs only — platform ops / tenancy internals live in /Private_docs.
export default withMermaid(
  defineConfig({
    vite: {
      optimizeDeps: {
        include: ['fastdom', 'mermaid']
      }
    },
    base: '/docs/',
    outDir: '../public/docs',
    lang: 'en-US',
    title: 'NetFlow Docs',
    description:
      'Product documentation for NetFlow: forms, workflows, approvals, and workspace administration.',
    cleanUrls: true,
    lastUpdated: true,
    ignoreDeadLinks: true,

    head: [
      ['link', { rel: 'icon', href: '/docs/netflow-icon.png' }],
      ['meta', { name: 'theme-color', content: '#2563eb' }],
      ['meta', { name: 'og:type', content: 'website' }],
      ['meta', { name: 'og:title', content: 'NetFlow Documentation' }]
    ],

    themeConfig: {
      logo: '/netflow-icon.png',
      siteTitle: 'NetFlow Docs',

      search: {
        provider: 'local'
      },

      nav: [
        { text: 'Home', link: '../', target: '_self' },
        { text: 'Getting started', link: '/' },
        { text: 'User guide', link: '/guide/forms' },
        { text: 'Reference', link: '/reference/roles-permissions' }
      ],

      sidebar: [
        {
          text: 'Getting started',
          collapsed: false,
          items: [
            { text: 'Introduction', link: '/' },
            { text: 'Quick start', link: '/getting-started/quick-start' },
            { text: 'Onboarding guide', link: '/getting-started/onboarding' }
          ]
        },
        {
          text: 'User guide',
          collapsed: false,
          items: [
            { text: 'Account & sign-in', link: '/guide/account-sign-in' },
            { text: 'Dashboard', link: '/guide/dashboard' },
            { text: 'Forms', link: '/guide/forms' },
            { text: 'Workflows', link: '/guide/workflows' },
            { text: 'Tasks & approvals', link: '/guide/tasks-approvals' },
            { text: 'My team', link: '/guide/team' },
            { text: 'Notifications', link: '/guide/notifications' },
            { text: 'Analytics', link: '/guide/analytics' },
            { text: 'Audit log', link: '/guide/audit-log' },
            { text: 'AI Assistant', link: '/guide/ai-assistant' },
            { text: 'Documents (DMS)', link: '/guide/documents-dms' },
            { text: 'S3 Storage', link: '/guide/s3-storage' }
          ]
        },
        {
          text: 'Administration',
          collapsed: true,
          items: [
            { text: 'Plan & usage', link: '/admin/plan-and-usage' }
          ]
        },
        {
          text: 'Quick references',
          collapsed: true,
          items: [
            { text: 'Roles & permissions', link: '/reference/roles-permissions' },
            { text: 'Workflow nodes', link: '/reference/workflow-nodes' },
            { text: 'Glossary', link: '/reference/glossary' }
          ]
        },
        {
          text: 'Troubleshooting',
          link: '/troubleshooting'
        },
        {
          text: 'Release notes',
          link: '/release-notes'
        }
      ],

      outline: {
        level: [2, 3],
        label: 'On this page'
      },

      docFooter: {
        prev: true,
        next: true
      },

      footer: {
        message: 'NetFlow product documentation.',
        copyright: 'Copyright \u00A9 NetFlow'
      }
    },

    mermaid: {
      // Options forwarded to mermaid; the plugin auto-syncs the theme with
      // VitePress light/dark mode, so no explicit colors are set here.
    }
  })
)
