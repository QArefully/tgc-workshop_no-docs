import { describe, expect, it } from 'vitest';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import { faqEntryIds, type HelpContentGroup } from './helpContentTypes';
import {
  getArticlesForGroup,
  getHelpArticle,
  helpArticles,
  helpContentRegistry,
  helpIndexLink,
  materializeHelpContent,
  materializeHelpArticle,
  productCommerceLinks,
  productFactLinks,
  policyArticles,
} from './helpContentRegistry';
import { customBlendArticle, shippingArticle } from './serviceArticles';

const requiredPaths = [
  '/help/faq',
  '/help/shipping',
  '/help/returns',
  '/help/pack-sizes',
  '/help/custom-blend',
  '/help/powder-safety',
  '/help/storage',
  '/policies/privacy',
  '/policies/terms',
];

describe('helpContentRegistry', () => {
  it('uses the complete canonical route set in navigation order', () => {
    expect(helpIndexLink).toEqual({ label: 'Help center', path: '/help' });
    expect(helpContentRegistry.map((article) => article.path)).toEqual(requiredPaths);
  });

  it('contains uniquely identified, nonempty articles', () => {
    expect(new Set(helpContentRegistry.map((article) => article.id)).size).toBe(
      helpContentRegistry.length,
    );
    expect(new Set(helpContentRegistry.map((article) => article.slug)).size).toBe(
      helpContentRegistry.length,
    );
    expect(new Set(helpContentRegistry.map((article) => article.path)).size).toBe(
      helpContentRegistry.length,
    );

    for (const article of helpContentRegistry) {
      expect(article.title.trim()).not.toBe('');
      expect(article.summary.trim()).not.toBe('');
      expect(article.blocks).not.toHaveLength(0);
      expect(article.blocks.every((block) => block.id.trim() !== '')).toBe(true);
      expect(new Set(article.blocks.map((block) => block.id)).size).toBe(article.blocks.length);
    }
  });

  it('keeps group and path prefixes paired', () => {
    for (const article of helpContentRegistry) {
      const expectedPrefix = article.group === 'help' ? '/help/' : '/policies/';
      expect(article.path).toBe(`${expectedPrefix}${article.slug}`);
    }
  });

  it('exports product-context links from canonical registry articles', () => {
    const registryByPath = new Map<string, (typeof helpContentRegistry)[number]>(
      helpContentRegistry.map((article) => [article.path, article]),
    );

    for (const link of [
      ...Object.values(productFactLinks),
      ...Object.values(productCommerceLinks),
    ]) {
      expect(registryByPath.get(link.path)?.title).toBe(link.label);
    }
  });

  it('exposes readonly group selectors and exact group-and-slug lookup', () => {
    expect(getArticlesForGroup('help')).toEqual(helpArticles);
    expect(getArticlesForGroup('policy')).toEqual(policyArticles);

    for (const group of ['help', 'policy'] as const satisfies readonly HelpContentGroup[]) {
      for (const article of getArticlesForGroup(group)) {
        expect(getHelpArticle(group, article.slug)).toBe(article);
      }
    }

    expect(getHelpArticle('help', 'privacy')).toBeUndefined();
    expect(getHelpArticle('policy', 'faq')).toBeUndefined();
    expect(getHelpArticle('help', 'missing')).toBeUndefined();
  });

  it('keeps FAQ identifiers and questions unique', () => {
    const faqBlock = getHelpArticle('help', 'faq')?.blocks.find((block) => block.kind === 'faq');

    expect(faqBlock).toBeDefined();
    if (faqBlock?.kind !== 'faq') {
      throw new Error('FAQ article must contain a FAQ block.');
    }

    expect(faqBlock.entries.map((entry) => entry.id)).toEqual(faqEntryIds);
    expect(new Set(faqBlock.entries.map((entry) => entry.id)).size).toBe(faqBlock.entries.length);
    expect(new Set(faqBlock.entries.map((entry) => entry.question)).size).toBe(
      faqBlock.entries.length,
    );
    expect(faqBlock.entries.every((entry) => entry.question.trim() !== '')).toBe(true);
  });

  it('describes local inventory without promising fulfilment', () => {
    const packSizes = getHelpArticle('help', 'pack-sizes');
    expect(packSizes).toBeDefined();
    expect(JSON.stringify(packSizes)).toContain('local stock');
    expect(JSON.stringify(packSizes)).toContain('backorder');
    expect(JSON.stringify(packSizes)).toContain('not supplier inventory');
    expect(JSON.stringify(getHelpArticle('help', 'shipping'))).toContain('not a delivery promise');
  });

  it('materializes every article for every country with identical structure and identity', () => {
    const baseline = materializeHelpContent('UK');
    const signature = (articles: ReadonlyArray<(typeof baseline)[number]>) =>
      articles.map((article) => ({
        id: article.id,
        group: article.group,
        slug: article.slug,
        path: article.path,
        blocks: article.blocks.map((block) => ({
          kind: block.kind,
          id: block.id,
          nestedIds:
            block.kind === 'faq'
              ? block.entries.map((entry) => [entry.id, entry.answerParagraphs.map((p) => p.id)])
              : 'paragraphs' in block
                ? block.paragraphs.map((paragraph) => paragraph.id)
                : 'items' in block
                  ? block.items.map((item) => item.id)
                  : [],
        })),
      }));

    for (const country of SUPPORTED_COUNTRIES) {
      const materialized = materializeHelpContent(country);
      expect(signature(materialized)).toEqual(signature(baseline));
      expect(materialized.map((article) => article.path)).toEqual(requiredPaths);
    }
  });

  it('keeps safety, local-demo, and no-commerce concepts in materialized copy', () => {
    const requiredConcepts = {
      UK: [
        'local QA demo',
        'simulated',
        'No real',
        'Not for consumption',
        'personal protective equipment',
        'contract of sale',
      ],
      US: [
        'local QA demo',
        'simulated',
        'No real',
        'Not for consumption',
        'personal protective equipment',
        'contract of sale',
      ],
      CN: ['本地 QA 演示', '模拟', '真实', '不可食用', '个人防护装备', '销售合同'],
      PL: [
        'lokalna demonstracja QA',
        'symulowan',
        'prawdziw',
        'Nie do spożycia',
        'środków ochrony indywidualnej',
        'umowy sprzedaży',
      ],
      ES: [
        'demo local de QA',
        'simulad',
        'real',
        'No apto para consumo',
        'equipos de protección individual',
        'contrato de compraventa',
      ],
      DE: [
        'lokale QA-Demo',
        'simuliert',
        'echt',
        'Nicht zum Verzehr',
        'persönliche Schutzausrüstung',
        'Kaufvertrag',
      ],
      FR: [
        'démo QA locale',
        'simulé',
        'réel',
        'Non comestible',
        'équipements de protection',
        'contrat de vente',
      ],
    } as const;

    for (const country of SUPPORTED_COUNTRIES) {
      const articles = materializeHelpContent(country);
      const json = JSON.stringify(articles);
      for (const concept of requiredConcepts[country]) expect(json).toContain(concept);
    }
  });

  it('uses localized body copy for representative safety, commerce, and demo warnings', () => {
    const representativeShippingCopy = {
      CN: 'QArefully Materials Exchange 是本地 QA 演示。结账和订单更新可用于探索界面，但不会创建真实货运。',
      PL: 'QArefully Materials Exchange to lokalna demonstracja QA. Kasa i aktualizacje zamówień służą do poznania interfejsu, ale nie tworzą prawdziwej przesyłki.',
      ES: 'QArefully Materials Exchange es una demo local de QA. El pago y las actualizaciones del pedido permiten explorar la interfaz, pero no crean un envío real.',
      DE: 'QArefully Materials Exchange ist eine lokale QA-Demo. Checkout und Bestellupdates zeigen die Oberfläche, erzeugen aber keine echte Sendung.',
      FR: 'QArefully Materials Exchange est une démo QA locale. Le paiement et les mises à jour de commande permettent d’explorer l’interface, mais ne créent pas d’expédition réelle.',
    } as const;

    for (const [country, expected] of Object.entries(representativeShippingCopy)) {
      const article = materializeHelpArticle(country as Country, shippingArticle);
      const paragraph = article.blocks[0];
      expect(paragraph).toBeDefined();
      if (!paragraph || paragraph.kind !== 'paragraph') {
        throw new Error('Shipping article must start with a paragraph block.');
      }
      expect(paragraph.text).toBe(expected);
    }
  });

  it('does not clone UK body strings into non-English message sets', () => {
    const bodyText = (country: Country) =>
      materializeHelpContent(country).flatMap((article) =>
        article.blocks.flatMap((block) => {
          if (block.kind === 'paragraph') return [block.text];
          if (block.kind === 'faq') {
            return [
              block.heading,
              ...block.entries.flatMap((entry) => [
                entry.question,
                ...entry.answerParagraphs.map((paragraph) => paragraph.text),
              ]),
            ];
          }
          if ('paragraphs' in block) {
            return [block.heading, ...block.paragraphs.map((paragraph) => paragraph.text)];
          }
          return [block.heading, ...block.items.map((item) => item.text)];
        }),
      );
    const uk = bodyText('UK');

    for (const country of ['CN', 'PL', 'ES', 'DE', 'FR'] as const) {
      const localized = bodyText(country);
      expect(localized).toHaveLength(uk.length);
      expect(localized.every((value, index) => value !== uk[index])).toBe(true);
    }
  });

  it('formats the blending fee at render time in the active display currency', () => {
    const uk = JSON.stringify(materializeHelpArticle('UK', customBlendArticle));
    const us = JSON.stringify(materializeHelpArticle('US', customBlendArticle));
    const cn = JSON.stringify(materializeHelpArticle('CN', customBlendArticle));
    expect(uk).toContain('£25.00');
    expect(us).toContain('$31.25');
    expect(cn).toContain('¥225.00');
    expect(uk).not.toContain('{blendFee}');
    expect(us).not.toContain('{blendFee}');
  });
});
