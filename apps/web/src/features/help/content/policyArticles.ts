import { defineHelpArticle, type HelpArticle } from './helpContentTypes';

export const privacyArticle = defineHelpArticle({
  id: 'privacy',
  group: 'policy',
  slug: 'privacy',
  path: '/policies/privacy',
  title: 'Privacy',
  summary: 'Local demo information about browser storage, sessions, and test data.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'privacy-local-demo',
      text: 'QArefully Materials Exchange is a local QA demo, not a production service. Use fictional or otherwise non-sensitive test data while exploring it.',
    },
    {
      kind: 'section',
      id: 'privacy-local-database',
      heading: 'Local demo records',
      paragraphs: [
        {
          id: 'privacy-local-database-records',
          text: 'The local demo backend uses a SQLite database for account, cart, order, session, development-mailbox, and simulated-payment records.',
        },
        {
          id: 'privacy-local-database-test-data',
          text: 'Information supplied in account and checkout flows can be included in those local demo records. Do not enter real personal, address, or payment information.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'privacy-browser-storage',
      heading: 'Browser storage and session cookie',
      paragraphs: [
        {
          id: 'privacy-browser-storage-local-storage',
          text: 'This browser can keep a cart identifier in local storage so the demo can restore your order between visits. Blend configurations are held against that cart on the local backend, not in browser storage.',
        },
        {
          id: 'privacy-browser-storage-session-cookie',
          text: 'When you sign in, the demo uses a session cookie so requests can be associated with the local session.',
        },
      ],
    },
    {
      kind: 'notice',
      id: 'privacy-clearing-data',
      heading: 'Clearing test data',
      paragraphs: [
        {
          id: 'privacy-clearing-data-browser',
          text: 'Clearing browser storage or cookies affects this browser only. A local backend database can retain its separate demo records.',
        },
        {
          id: 'privacy-clearing-data-database',
          text: 'Likewise, resetting local database data does not promise to remove a cart identifier already stored in a browser. Clear browser storage separately when needed.',
        },
      ],
    },
  ],
});

export const termsArticle = defineHelpArticle({
  id: 'terms',
  group: 'policy',
  slug: 'terms',
  path: '/policies/terms',
  title: 'Terms',
  summary:
    'This local demo simulates storefront interactions and does not provide commerce services.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'terms-demo-purpose',
      text: 'QArefully Materials Exchange is an educational local QA demo for exploring a materials-supply interface. Its catalogue content, product descriptions, and checkout flow are fictional or simulated.',
    },
    {
      kind: 'notice',
      id: 'terms-no-commerce-contract',
      heading: 'No real transaction',
      paragraphs: [
        {
          id: 'terms-no-commerce-contract-sale',
          text: 'Using this demo does not form a contract of sale and does not create a real purchase, shipment, charge, refund, warranty, or customer-service obligation.',
        },
        {
          id: 'terms-no-commerce-contract-interface',
          text: 'Checkout, payment, order, and mailbox results are simulated interface and local demo data. They are not evidence of a real payment or fulfilment request.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'terms-content-boundary',
      heading: 'Demo content only',
      paragraphs: [
        {
          id: 'terms-content-boundary-reliance',
          text: 'Do not rely on displayed catalog content for product availability, safety, certification, performance, storage, delivery, or other service information.',
        },
        {
          id: 'terms-content-boundary-promises',
          text: 'The demo makes no promise to provide products, services, support, or continuing availability.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'terms-test-data',
      heading: 'Use test data',
      paragraphs: [
        {
          id: 'terms-test-data-fictional',
          text: 'Use only fictional, non-sensitive information. Do not submit real payment, personal, or delivery details through the demo.',
        },
      ],
    },
  ],
});

export const policyArticles = [
  privacyArticle,
  termsArticle,
] as const satisfies readonly HelpArticle<'policy', string>[];
