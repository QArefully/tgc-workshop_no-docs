import { defineMessages, type CountryMessageSet } from './defineMessages.js';

/**
 * Help and policy copy is keyed by the stable article/block identifiers owned by the web
 * registry. Routes, IDs, and block structure stay data-owned while language changes at render
 * time; body text is resolved from this catalog and never passed through as a source fallback.
 *
 * Keeping country set exhaustive here prevents a newly supported country from silently falling
 * back to another language. Long-form body copy remains semantically identical across locales
 * until native-speaker review supplies wording variants; key ownership and render-time fee
 * interpolation remain identical in every country.
 */
const valueMessage = (value = '{value}'): CountryMessageSet => ({
  UK: value,
  US: value,
  CN: value,
  PL: value,
  ES: value,
  DE: value,
  FR: value,
});

const keys = [
  'account-data',
  'account-data-answer',
  'cart',
  'cart-answer',
  'custom-blend',
  'custom-blend-after-ordering',
  'custom-blend-after-ordering-cancellation',
  'custom-blend-after-ordering-returns',
  'custom-blend-configuring',
  'custom-blend-configuring-base',
  'custom-blend-configuring-editing',
  'custom-blend-configuring-ingredients',
  'custom-blend-overview',
  'custom-blend-pricing',
  'custom-blend-pricing-discounts',
  'custom-blend-pricing-fee',
  'custom-blend-stock',
  'custom-blend-stock-asymmetry',
  'custom-blend-stock-selectable',
  'demo-boundary',
  'demo-boundary-claims',
  'demo-boundary-information',
  'demo-boundary-labels',
  'demo-catalog',
  'demo-context',
  'demo-faq',
  'faq',
  'general-guidance',
  'item-facts-authority',
  'item-facts-authority-boundary',
  'item-facts-authority-reference',
  'pack-sizes',
  'pack-sizes-delivery',
  'pack-sizes-delivery-freight',
  'pack-sizes-delivery-parcel',
  'pack-sizes-no-stock',
  'pack-sizes-no-stock-inventory',
  'pack-sizes-no-stock-quantities',
  'pack-sizes-overview',
  'pack-sizes-pricing-clearance',
  'pack-sizes-pricing-promotions',
  'pack-sizes-variants',
  'pack-sizes-variants-examples',
  'pack-sizes-variants-select',
  'payments',
  'payments-answer',
  'powder-safety',
  'privacy',
  'privacy-browser-storage',
  'privacy-browser-storage-local-storage',
  'privacy-browser-storage-session-cookie',
  'privacy-clearing-data',
  'privacy-clearing-data-browser',
  'privacy-clearing-data-database',
  'privacy-local-database',
  'privacy-local-database-records',
  'privacy-local-database-test-data',
  'privacy-local-demo',
  'product-label-authority',
  'product-label-authority-consumption',
  'product-label-authority-warning',
  'returns',
  'returns-cancellation',
  'returns-cancellation-custom-blend',
  'returns-cancellation-diff',
  'returns-demo-purpose',
  'returns-eligibility',
  'returns-eligibility-products',
  'returns-eligibility-window',
  'returns-notice',
  'returns-notice-real',
  'returns-workflow',
  'returns-workflow-admin',
  'returns-workflow-refund',
  'returns-workflow-request',
  'safety-food',
  'safety-food-boundary',
  'safety-food-categories',
  'safety-nonfood',
  'safety-nonfood-categories',
  'safety-overview',
  'safety-ppe',
  'safety-ppe-guidance',
  'safety-ppe-ventilation',
  'shipping',
  'shipping-answer',
  'shipping-classes',
  'shipping-classes-freight',
  'shipping-classes-parcel',
  'shipping-demo-purpose',
  'shipping-no-fulfilment',
  'shipping-no-fulfilment-services',
  'shipping-no-fulfilment-status',
  'shipping-simulated-tracking',
  'shipping-simulated-tracking-changes',
  'shipping-simulated-tracking-status',
  'shipping-testing-guidance',
  'shipping-testing-guidance-test-data',
  'shop-purpose',
  'shop-purpose-answer',
  'storage',
  'terms',
  'terms-content-boundary',
  'terms-content-boundary-promises',
  'terms-content-boundary-reliance',
  'terms-demo-purpose',
  'terms-no-commerce-contract',
  'terms-no-commerce-contract-interface',
  'terms-no-commerce-contract-sale',
  'terms-test-data',
  'terms-test-data-fictional',
] as const;

const articleIds = [
  'faq',
  'shipping',
  'returns',
  'pack-sizes',
  'custom-blend',
  'powder-safety',
  'storage',
  'privacy',
  'terms',
] as const;

const generated: Record<string, CountryMessageSet> = {
  'help.shell.helpCenter': {
    UK: 'Help center',
    US: 'Help center',
    CN: '帮助中心',
    PL: 'Centrum pomocy',
    ES: 'Centro de ayuda',
    DE: 'Hilfezentrum',
    FR: 'Centre d’aide',
  },
  'help.shell.helpTopics': {
    UK: 'Help topics',
    US: 'Help topics',
    CN: '帮助主题',
    PL: 'Tematy pomocy',
    ES: 'Temas de ayuda',
    DE: 'Hilfethemen',
    FR: 'Sujets d’aide',
  },
  'help.shell.helpDescription': {
    UK: 'Guidance for exploring this local QA demo and its simulated storefront.',
    US: 'Guidance for exploring this local QA demo and its simulated storefront.',
    CN: '探索本地 QA 演示及其模拟商店的指南。',
    PL: 'Wskazówki dotyczące lokalnego demonstratora QA i symulowanego sklepu.',
    ES: 'Guía para explorar esta demo local de QA y su tienda simulada.',
    DE: 'Hinweise zur Erkundung dieser lokalen QA-Demo und ihres simulierten Shops.',
    FR: 'Conseils pour découvrir cette démo QA locale et sa boutique simulée.',
  },
  'help.shell.policyTopics': {
    UK: 'Demo policies',
    US: 'Demo policies',
    CN: '演示政策',
    PL: 'Zasady demonstracji',
    ES: 'Políticas de la demo',
    DE: 'Demo-Richtlinien',
    FR: 'Politiques de la démo',
  },
  'help.shell.policyDescription': {
    UK: 'Information about local demo data and the limits of this simulated service.',
    US: 'Information about local demo data and the limits of this simulated service.',
    CN: '关于本地演示数据和模拟服务限制的信息。',
    PL: 'Informacje o danych lokalnej demonstracji i ograniczeniach usługi symulowanej.',
    ES: 'Información sobre los datos locales de la demo y los límites de este servicio simulado.',
    DE: 'Informationen zu lokalen Demodaten und den Grenzen dieses simulierten Dienstes.',
    FR: 'Informations sur les données locales et les limites de ce service simulé.',
  },
  'help.shell.articleContent': {
    UK: 'Article content',
    US: 'Article content',
    CN: '文章内容',
    PL: 'Treść artykułu',
    ES: 'Contenido del artículo',
    DE: 'Artikelinhalt',
    FR: 'Contenu de l’article',
  },
  'help.shell.navigation': {
    UK: 'Help navigation',
    US: 'Help navigation',
    CN: '帮助导航',
    PL: 'Nawigacja pomocy',
    ES: 'Navegación de ayuda',
    DE: 'Hilfenavigation',
    FR: 'Navigation d’aide',
  },
  'help.shell.backTo': {
    UK: 'Back to {label}',
    US: 'Back to {label}',
    CN: '返回{label}',
    PL: 'Wróć do: {label}',
    ES: 'Volver a {label}',
    DE: 'Zurück zu {label}',
    FR: 'Retour à {label}',
  },
  'help.shell.groupHelp': {
    UK: 'Help centre',
    US: 'Help center',
    CN: '帮助中心',
    PL: 'Centrum pomocy',
    ES: 'Centro de ayuda',
    DE: 'Hilfezentrum',
    FR: 'Centre d’aide',
  },
  'help.shell.groupPolicy': {
    UK: 'Policy',
    US: 'Policy',
    CN: '政策',
    PL: 'Zasady',
    ES: 'Política',
    DE: 'Richtlinie',
    FR: 'Politique',
  },
};

for (const articleId of articleIds) {
  generated[`help.${articleId}.title`] = valueMessage('{value}');
  generated[`help.${articleId}.summary`] = valueMessage('{value}');
  for (const id of keys) {
    generated[`help.${articleId}.${id}.text`] = valueMessage();
    generated[`help.${articleId}.${id}.heading`] = valueMessage();
    generated[`help.${articleId}.${id}.question`] = valueMessage();
  }
}

const titleTranslations: Record<string, CountryMessageSet> = {
  'help.faq.title': {
    UK: 'Frequently asked questions',
    US: 'Frequently asked questions',
    CN: '常见问题',
    PL: 'Często zadawane pytania',
    ES: 'Preguntas frecuentes',
    DE: 'Häufig gestellte Fragen',
    FR: 'Foire aux questions',
  },
  'help.shipping.title': {
    UK: 'Shipping',
    US: 'Shipping',
    CN: '配送',
    PL: 'Dostawa',
    ES: 'Envío',
    DE: 'Versand',
    FR: 'Livraison',
  },
  'help.returns.title': {
    UK: 'Returns',
    US: 'Returns',
    CN: '退货',
    PL: 'Zwroty',
    ES: 'Devoluciones',
    DE: 'Rückgaben',
    FR: 'Retours',
  },
  'help.pack-sizes.title': {
    UK: 'Pack sizes and variants',
    US: 'Pack sizes and variants',
    CN: '包装规格和变体',
    PL: 'Rozmiary opakowań i warianty',
    ES: 'Tamaños de paquete y variantes',
    DE: 'Packungsgrößen und Varianten',
    FR: 'Formats et variantes',
  },
  'help.custom-blend.title': {
    UK: 'Custom Blend',
    US: 'Custom Blend',
    CN: '定制混合',
    PL: 'Mieszanka niestandardowa',
    ES: 'Mezcla personalizada',
    DE: 'Individuelle Mischung',
    FR: 'Mélange personnalisé',
  },
  'help.powder-safety.title': {
    UK: 'Product safety',
    US: 'Product safety',
    CN: '产品安全',
    PL: 'Bezpieczeństwo produktu',
    ES: 'Seguridad del producto',
    DE: 'Produktsicherheit',
    FR: 'Sécurité du produit',
  },
  'help.storage.title': {
    UK: 'Storage',
    US: 'Storage',
    CN: '储存',
    PL: 'Przechowywanie',
    ES: 'Almacenamiento',
    DE: 'Lagerung',
    FR: 'Stockage',
  },
  'help.privacy.title': {
    UK: 'Privacy',
    US: 'Privacy',
    CN: '隐私',
    PL: 'Prywatność',
    ES: 'Privacidad',
    DE: 'Datenschutz',
    FR: 'Confidentialité',
  },
  'help.terms.title': {
    UK: 'Terms',
    US: 'Terms',
    CN: '条款',
    PL: 'Warunki',
    ES: 'Términos',
    DE: 'Bedingungen',
    FR: 'Conditions',
  },
};

Object.assign(generated, titleTranslations);

const summaryTranslations: Record<string, CountryMessageSet> = {
  'help.faq.summary': {
    UK: 'How this local QArefully Materials Exchange demo handles browsing, checkout, and saved data.',
    US: 'How this local QArefully Materials Exchange demo handles browsing, checkout, and saved data.',
    CN: '本地 QArefully Materials Exchange 演示如何处理浏览、结账和保存的数据。',
    PL: 'Jak lokalna demonstracja QArefully Materials Exchange obsługuje przeglądanie, kasę i zapisane dane.',
    ES: 'Cómo gestiona esta demo local de QArefully Materials Exchange la navegación, el pago y los datos guardados.',
    DE: 'Wie diese lokale QArefully-Materials-Exchange-Demo das Stöbern, den Checkout und gespeicherte Daten behandelt.',
    FR: 'Comment cette démo locale QArefully Materials Exchange gère la navigation, le paiement et les données enregistrées.',
  },
  'help.shipping.summary': {
    UK: 'Simulated parcel and freight delivery for local demo orders.',
    US: 'Simulated parcel and freight delivery for local demo orders.',
    CN: '本地演示订单的模拟包裹和货运配送。',
    PL: 'Symulowana dostawa paczkowa i frachtowa dla lokalnych zamówień demonstracyjnych.',
    ES: 'Entrega simulada de paquetes y carga para pedidos de la demo local.',
    DE: 'Simulierter Paket- und Frachtversand für lokale Demo-Bestellungen.',
    FR: 'Livraison simulée de colis et de fret pour les commandes de la démo locale.',
  },
  'help.returns.summary': {
    UK: 'Simulated 30-day return workflow for delivered ordinary products.',
    US: 'Simulated 30-day return workflow for delivered ordinary products.',
    CN: '已交付普通产品的模拟 30 天退货流程。',
    PL: 'Symulowany 30-dniowy proces zwrotu dostarczonych zwykłych produktów.',
    ES: 'Flujo simulado de devoluciones de 30 días para productos ordinarios entregados.',
    DE: 'Simulierter 30-Tage-Rückgabeprozess für zugestellte Standardprodukte.',
    FR: 'Processus de retour simulé sous 30 jours pour les produits ordinaires livrés.',
  },
  'help.pack-sizes.summary': {
    UK: 'How product variants, pack sizes, and delivery classes work in this demo catalogue.',
    US: 'How product variants, pack sizes, and delivery classes work in this demo catalogue.',
    CN: '产品变体、包装规格和配送类别在此演示目录中的工作方式。',
    PL: 'Jak warianty produktów, rozmiary opakowań i klasy dostawy działają w tym katalogu demonstracyjnym.',
    ES: 'Cómo funcionan las variantes, tamaños de paquete y clases de entrega en este catálogo de demo.',
    DE: 'Wie Produktvarianten, Packungsgrößen und Lieferklassen in diesem Demokatalog funktionieren.',
    FR: 'Fonctionnement des variantes, formats et classes de livraison dans ce catalogue de démo.',
  },
  'help.custom-blend.summary': {
    UK: 'Configuring a made-to-order blend, its blending fee, and how it behaves after ordering.',
    US: 'Configuring a made-to-order blend, its blending fee, and how it behaves after ordering.',
    CN: '配置按需混合、混合费用及下单后的处理方式。',
    PL: 'Konfiguracja mieszanki na zamówienie, opłata za mieszanie i jej działanie po zamówieniu.',
    ES: 'Configurar una mezcla bajo pedido, su tarifa y su comportamiento después de pedirla.',
    DE: 'Konfiguration einer Mischung nach Maß, Mischgebühr und Verhalten nach der Bestellung.',
    FR: 'Configurer un mélange sur commande, ses frais et son fonctionnement après la commande.',
  },
  'help.powder-safety.summary': {
    UK: 'Consumption classification, handling guidance, and PPE requirements for QArefully Materials Exchange products.',
    US: 'Consumption classification, handling guidance, and PPE requirements for QArefully Materials Exchange products.',
    CN: 'QArefully Materials Exchange 产品的消费分类、处理指南和 PPE 要求。',
    PL: 'Klasyfikacja spożycia, wskazówki dotyczące obsługi i wymagania ŚOI dla produktów QArefully Materials Exchange.',
    ES: 'Clasificación de consumo, manipulación y requisitos de EPI para productos de QArefully Materials Exchange.',
    DE: 'Verzehrklassifizierung, Handhabungshinweise und PSA-Anforderungen für Produkte von QArefully Materials Exchange.',
    FR: 'Classification de consommation, conseils de manipulation et EPI requis pour les produits QArefully Materials Exchange.',
  },
  'help.storage.summary': {
    UK: 'This local demo does not publish universal storage specifications. Refer to any displayed facts for the specific fictional product you are viewing.',
    US: 'This local demo does not publish universal storage specifications. Refer to any displayed facts for the specific fictional product you are viewing.',
    CN: '此本地演示不发布通用储存规范。请参考当前虚构产品显示的具体事实。',
    PL: 'Ta lokalna demonstracja nie publikuje uniwersalnych specyfikacji przechowywania. Sprawdź fakty wyświetlane dla oglądanego fikcyjnego produktu.',
    ES: 'Esta demo local no publica especificaciones universales de almacenamiento. Consulta los datos mostrados del producto ficticio que ves.',
    DE: 'Diese lokale Demo veröffentlicht keine allgemeinen Lagerungsspezifikationen. Beachten Sie die angezeigten Fakten zum jeweiligen fiktiven Produkt.',
    FR: 'Cette démo locale ne publie pas de spécifications universelles de stockage. Consultez les informations affichées pour le produit fictif concerné.',
  },
  'help.privacy.summary': {
    UK: 'Local demo information about browser storage, sessions, and test data.',
    US: 'Local demo information about browser storage, sessions, and test data.',
    CN: '关于浏览器存储、会话和测试数据的本地演示信息。',
    PL: 'Informacje demonstracyjne o pamięci przeglądarki, sesjach i danych testowych.',
    ES: 'Información de la demo local sobre almacenamiento del navegador, sesiones y datos de prueba.',
    DE: 'Lokale Demoinformationen zu Browserspeicher, Sitzungen und Testdaten.',
    FR: 'Informations de la démo locale sur le stockage du navigateur, les sessions et les données de test.',
  },
  'help.terms.summary': {
    UK: 'This local demo simulates storefront interactions and does not provide commerce services.',
    US: 'This local demo simulates storefront interactions and does not provide commerce services.',
    CN: '此本地演示模拟商店交互，不提供商业服务。',
    PL: 'Ta lokalna demonstracja symuluje interakcje sklepu i nie świadczy usług handlowych.',
    ES: 'Esta demo local simula interacciones de tienda y no presta servicios comerciales.',
    DE: 'Diese lokale Demo simuliert Shop-Interaktionen und bietet keine Handelsdienstleistungen.',
    FR: 'Cette démo locale simule des interactions de boutique et ne fournit aucun service commercial.',
  },
};

Object.assign(generated, summaryTranslations);

/** Authored article bodies are stored here, keyed by their stable block IDs. */
const authoredBodyMessages: Record<string, CountryMessageSet> = {
  'help.custom-blend.custom-blend-after-ordering-cancellation.text': valueMessage(
    'Cancellation is unaffected. An order containing a blend can be cancelled on the ordinary terms, at any point up to dispatch, in the same way as an order of stocked lots.',
  ),
  'help.custom-blend.custom-blend-after-ordering-returns.text': valueMessage(
    'Returns are the exception. A blend is produced to your specification and cannot be resold, so a blend line is never eligible for return. Once an order with a blend is dispatched, that line is final, while any ordinary lots in the same order remain returnable on the usual terms.',
  ),
  'help.custom-blend.custom-blend-after-ordering.heading': valueMessage(
    'Cancellation and returns work differently',
  ),
  'help.custom-blend.custom-blend-configuring-base.text': valueMessage(
    'Open Custom Blend from the main navigation, then choose a base material. Search by name or filter by category to narrow the list. Only the 25 kg sack of a material can act as a base, because the sack is the purchase unit a blend is produced in.',
  ),
  'help.custom-blend.custom-blend-configuring-editing.text': valueMessage(
    'A blend already in your order can be reopened from its cart line. Editing keeps the base material and the quantity fixed and replaces only the recipe; two blends over the same base material stay separate lines.',
  ),
  'help.custom-blend.custom-blend-configuring-ingredients.text': valueMessage(
    'With a base chosen, add between one and four ingredients and set each one to a whole percentage from 5% to 50%. Ingredients must total no more than 50% together, so the base always makes up at least half the blend. The summary shows the running base and ingredient percentages, and the configurator refuses to submit a ratio outside those limits.',
  ),
  'help.custom-blend.custom-blend-configuring.heading': valueMessage('Configuring a blend'),
  'help.custom-blend.custom-blend-overview.text': valueMessage(
    'Custom Blend lets you order a material blended to your own specification instead of picking a stocked lot. You choose one base material and the ingredients mixed into it, and the blend is produced against your order.',
  ),
  'help.custom-blend.custom-blend-pricing-discounts.text': valueMessage(
    'The fee sits outside the discountable amount. Cart, checkout, and order pages therefore show the material subtotal and the blending fees separately, and a promotion applies to the material subtotal only. Material pricing itself follows the ordinary per-tonne rate and quantity-break tiers for the base lot.',
  ),
  'help.custom-blend.custom-blend-pricing-fee.text': valueMessage(
    'A flat blending fee of {blendFee} is added once per blend line. It is charged per line rather than per sack, so raising the quantity on a blend does not multiply the fee.',
  ),
  'help.custom-blend.custom-blend-pricing.heading': valueMessage('Blending fee'),
  'help.custom-blend.custom-blend-stock-asymmetry.text': valueMessage(
    'The base material behaves differently: it is a stocked lot, so its own availability and backorder rules apply exactly as they do when you buy that lot on its own.',
  ),
  'help.custom-blend.custom-blend-stock-selectable.text': valueMessage(
    'An ingredient that is out of stock is still selectable. Its availability is shown for information, and it does not block the blend.',
  ),
  'help.custom-blend.custom-blend-stock.heading': valueMessage('Ingredient availability'),
  'help.faq.account-data-answer.text': valueMessage(
    'Locally supplied account, checkout, and order information is used by this demo. Use fake data rather than personal or payment information.',
  ),
  'help.faq.account-data.question': valueMessage(
    'What happens to account and checkout information?',
  ),
  'help.faq.cart-answer.text': valueMessage(
    'The browser stores a cart identifier in local storage so the demo can reconnect to its local cart. It is not a real purchase reservation or fulfilment record.',
  ),
  'help.faq.cart.question': valueMessage('Is my cart saved?'),
  'help.faq.demo-context.text': valueMessage(
    'QArefully Materials Exchange is a local QA demo with a credible materials catalogue, a Custom Blend configurator, and simulated commerce.',
  ),
  'help.faq.demo-faq.heading': valueMessage('Demo FAQ'),
  'help.faq.payments-answer.text': valueMessage(
    'No. The checkout flow simulates payment; it does not process a real charge.',
  ),
  'help.faq.payments.question': valueMessage('Will my payment be charged?'),
  'help.faq.shipping-answer.text': valueMessage(
    'No. Orders are simulated records only. No real goods are packed, dispatched, or delivered.',
  ),
  'help.faq.shipping.question': valueMessage('Will an order be shipped?'),
  'help.faq.shop-purpose-answer.text': valueMessage(
    'No. This is a local QA demo with catalogue content and simulated commerce. No real products are sold or shipped.',
  ),
  'help.faq.shop-purpose.question': valueMessage('Is this a real shop?'),
  'help.pack-sizes.pack-sizes-delivery-freight.text': valueMessage(
    'Heavy variants or orders exceeding a combined weight threshold are classified as freight. A simulated freight charge is applied at checkout. The cart and checkout display a freight label for affected lines.',
  ),
  'help.pack-sizes.pack-sizes-delivery-parcel.text': valueMessage(
    'Most variants under the freight threshold are classified as standard parcel delivery. The product page shows the variant weight; the cart line item shows its delivery class label.',
  ),
  'help.pack-sizes.pack-sizes-delivery.heading': valueMessage('Delivery class'),
  'help.pack-sizes.pack-sizes-no-stock-inventory.text': valueMessage(
    'Local stock and backorder states are for testing only. They are not supplier inventory, a delivery promise, or a real fulfilment commitment.',
  ),
  'help.pack-sizes.pack-sizes-no-stock-quantities.text': valueMessage(
    'Checkout temporarily reserves local stock while payment is processed. A successful simulated order consumes reserved stock; a backordered quantity waits for a local administrator to record a stock receipt.',
  ),
  'help.pack-sizes.pack-sizes-no-stock.heading': valueMessage(
    'Local inventory, not real fulfilment',
  ),
  'help.pack-sizes.pack-sizes-overview.text': valueMessage(
    'Each product in the catalogue is available in one or more purchasable variants. A variant combines a specific pack size with its own SKU, price, weight, stock, and backorder state.',
  ),
  'help.pack-sizes.pack-sizes-pricing-clearance.text': valueMessage(
    'A clearance price is time-limited and is shown beside the ordinary list price when active. The clearance price becomes the starting price for the selected lot before any quantity-break tier is applied; an expired or upcoming clearance is not charged or shown as active.',
  ),
  'help.pack-sizes.pack-sizes-pricing-promotions.heading': valueMessage(
    'Clearance pricing and promotions',
  ),
  'help.pack-sizes.pack-sizes-pricing-promotions.text': valueMessage(
    'Some promotion codes apply only to one catalog category. When a code has a category scope, its item requirements and discount are calculated only from matching material lines. The checkout summary shows the eligible subtotal and category; blending fees are never discounted.',
  ),
  'help.pack-sizes.pack-sizes-variants-examples.text': valueMessage(
    'Small consumer packs serve edible and performance ranges (200 g to 2 kg). Household and garden ranges offer both consumer and bulk packs (500 g to 25 kg). Trade and creative materials such as cement, sand, and aggregates range up to 1 tonne.',
  ),
  'help.pack-sizes.pack-sizes-variants-select.text': valueMessage(
    'On a product page, choose a pack size before adding to cart. Each variant shows its own weight, price, and availability state. A formulation or flavour change is a separate product, not a pack variant.',
  ),
  'help.pack-sizes.pack-sizes-variants.heading': valueMessage('Selecting a variant'),
  'help.powder-safety.demo-boundary-claims.text': valueMessage(
    'It does not make medical, certification, performance, or universal handling claims for any powder shown here.',
  ),
  'help.powder-safety.demo-boundary-labels.text': valueMessage(
    'It explains the boundary of this demo: product information is fictional, and displayed item labels remain specific to their own product cards and pages.',
  ),
  'help.powder-safety.demo-boundary.heading': valueMessage('What this page can tell you'),
  'help.powder-safety.demo-catalog.text': valueMessage(
    'This fictional powder catalog is provided for local QA and demo use. Its category names, product descriptions, and bag artwork are not safety guidance or product specifications.',
  ),
  'help.powder-safety.product-label-authority-consumption.text': valueMessage(
    'If a product displays “Not for consumption”, follow that displayed warning. Do not infer a different use from its category, name, image, or this help article.',
  ),
  'help.powder-safety.product-label-authority-warning.text': valueMessage(
    'A warning shown on an individual product is the authority for that displayed item. This general page does not replace, reinterpret, or extend a product-specific warning.',
  ),
  'help.powder-safety.product-label-authority.heading': valueMessage(
    'Use the displayed product warning',
  ),
  'help.powder-safety.safety-food-boundary.text': valueMessage(
    'Only products explicitly marked as food-grade are suitable for consumption. Do not infer food status from a product name, appearance, or category membership alone.',
  ),
  'help.powder-safety.safety-food-categories.text': valueMessage(
    'Products in the Sports Nutrition, Baking & Pantry, and Drinks categories are classified as food-grade. They show ingredient lists, allergens, nutrition information, and serving sizes.',
  ),
  'help.powder-safety.safety-food.heading': valueMessage('Food-grade products'),
  'help.powder-safety.safety-nonfood-categories.text': valueMessage(
    'Products in the Household & Cleaning, Garden & Outdoors, and Trade & Creative Materials categories are non-food items. Each displays "Not for consumption" on its product page and bag artwork.',
  ),
  'help.powder-safety.safety-nonfood.heading': valueMessage('Non-food products'),
  'help.powder-safety.safety-overview.text': valueMessage(
    'QArefully Materials Exchange products fall into food and non-food categories. Each product page displays its consumption classification and any handling warnings.',
  ),
  'help.powder-safety.safety-ppe-guidance.text': valueMessage(
    'Non-food materials such as cement, plaster, mortar, pigments, garden lime, laundry powder, and spill absorbents require personal protective equipment during handling. Use eye protection, gloves, and a dust mask when handling these materials.',
  ),
  'help.powder-safety.safety-ppe-ventilation.text': valueMessage(
    'Work in a well-ventilated area. Avoid breathing dust. Keep materials dry and sealed when not in use.',
  ),
  'help.powder-safety.safety-ppe.heading': valueMessage('Handling and PPE'),
  'help.privacy.privacy-browser-storage-local-storage.text': valueMessage(
    'This browser can keep a cart identifier in local storage so the demo can restore your order between visits. Blend configurations are held against that cart on the local backend, not in browser storage.',
  ),
  'help.privacy.privacy-browser-storage-session-cookie.text': valueMessage(
    'When you sign in, the demo uses a session cookie so requests can be associated with the local session.',
  ),
  'help.privacy.privacy-browser-storage.heading': valueMessage(
    'Browser storage and session cookie',
  ),
  'help.privacy.privacy-clearing-data-browser.text': valueMessage(
    'Clearing browser storage or cookies affects this browser only. A local backend database can retain its separate demo records.',
  ),
  'help.privacy.privacy-clearing-data-database.text': valueMessage(
    'Likewise, resetting local database data does not promise to remove a cart identifier already stored in a browser. Clear browser storage separately when needed.',
  ),
  'help.privacy.privacy-clearing-data.heading': valueMessage('Clearing test data'),
  'help.privacy.privacy-local-database-records.text': valueMessage(
    'The local demo backend uses a SQLite database for account, cart, order, session, development-mailbox, and simulated-payment records.',
  ),
  'help.privacy.privacy-local-database-test-data.text': valueMessage(
    'Information supplied in account and checkout flows can be included in those local demo records. Do not enter real personal, address, or payment information.',
  ),
  'help.privacy.privacy-local-database.heading': valueMessage('Local demo records'),
  'help.privacy.privacy-local-demo.text': valueMessage(
    'QArefully Materials Exchange is a local QA demo, not a production service. Use fictional or otherwise non-sensitive test data while exploring it.',
  ),
  'help.returns.returns-cancellation-custom-blend.text': valueMessage(
    'Being excluded from returns does not make an order final. An order containing a Custom Blend line cancels on exactly the same terms as any other order, at any point up to dispatch.',
  ),
  'help.returns.returns-cancellation-diff.text': valueMessage(
    'Cancellation stops simulated fulfilment before shipping and releases allocated stock, but does not issue a refund. Returns apply after delivery and can result in a simulated refund when processed by an administrator. Cancellation and returns are separate workflows.',
  ),
  'help.returns.returns-cancellation.heading': valueMessage('Returns vs cancellation'),
  'help.returns.returns-demo-purpose.text': valueMessage(
    'QArefully Materials Exchange provides a simulated returns and refunds workflow for QA testing. All purchases, payments, and refunds are simulated only and do not represent real transactions.',
  ),
  'help.returns.returns-eligibility-products.text': valueMessage(
    'Only ordinary catalogue products are eligible. Custom Blend lines are made to order and are excluded from returns. Only delivered shipment quantities can be returned; backordered, shipped, or failed-delivery items are not eligible.',
  ),
  'help.returns.returns-eligibility-window.text': valueMessage(
    'You can request a return within 30 days of an ordinary product shipment being marked as delivered. The 30-day window is measured from the exact delivery event time shown in your order timeline.',
  ),
  'help.returns.returns-eligibility.heading': valueMessage('Eligibility'),
  'help.returns.returns-notice-real.text': valueMessage(
    'No real money, postage, carrier, or return label is involved. Refunds are local simulation records and are never processed by a payment gateway. Do not send physical items, payment details, or real return requests to anything shown in this demo.',
  ),
  'help.returns.returns-notice.heading': valueMessage(
    'Simulated only — no real returns or payments',
  ),
  'help.returns.returns-workflow-admin.text': valueMessage(
    'A demo administrator reviews your request and may approve or reject it. If approved and the items are marked as received, a simulated refund is calculated. The refund amount is based on your original purchase price and discount, prorated across returned quantities.',
  ),
  'help.returns.returns-workflow-refund.text': valueMessage(
    'Once refunded, a simulated reference number appears in your return history. The refund amount is shown in your local currency format. No real funds are transferred.',
  ),
  'help.returns.returns-workflow-request.text': valueMessage(
    'From your order detail page, select the delivered items and quantities you want to return, choose a reason, and optionally add a note. Submit the request.',
  ),
  'help.returns.returns-workflow.heading': valueMessage('How it works'),
  'help.shipping.shipping-classes-freight.text': valueMessage(
    'Orders containing heavy items or exceeding a combined weight threshold are classified as freight. Freight-eligible items such as cement, sand, aggregates, and bulk minerals display a freight label in the cart. A simulated freight charge is applied at checkout.',
  ),
  'help.shipping.shipping-classes-parcel.text': valueMessage(
    'Most orders are classified as standard parcel delivery. Individual product variants show a weight on the product page and a delivery class label on the cart line item.',
  ),
  'help.shipping.shipping-classes.heading': valueMessage('Parcel and freight classification'),
  'help.shipping.shipping-demo-purpose.text': valueMessage(
    'QArefully Materials Exchange is a local QA demo. Checkout and order updates let you explore the interface, but they do not create a real shipment.',
  ),
  'help.shipping.shipping-no-fulfilment-services.text': valueMessage(
    'No carrier, dispatch process, delivery estimate, or fulfilment service is connected to this demo. Tracking references and timeline updates are simulated local-demo data only. Local stock is reserved during checkout, but it does not create a real shipment.',
  ),
  'help.shipping.shipping-no-fulfilment-status.text': valueMessage(
    'An order status shown in the interface is simulated state only and does not mean a parcel has been sent.',
  ),
  'help.shipping.shipping-no-fulfilment.heading': valueMessage('No real delivery service'),
  'help.shipping.shipping-simulated-tracking-changes.text': valueMessage(
    'Demo administrators advance shipment states manually for testing. There are no automatic updates, carrier integrations, or delivery notifications.',
  ),
  'help.shipping.shipping-simulated-tracking-status.text': valueMessage(
    'A tracking reference or shipment event appears only within an eligible order detail page. It cannot be used with a carrier and does not represent a real parcel.',
  ),
  'help.shipping.shipping-simulated-tracking.heading': valueMessage('Simulated tracking'),
  'help.shipping.shipping-testing-guidance-test-data.text': valueMessage(
    'Use only test information while exploring checkout. The demo tracks local stock, short-lived checkout reservations, and eligible backorders. A displayed backorder lead-time estimate is not a delivery promise, and this site is not for real-world availability or delivery planning.',
  ),
  'help.shipping.shipping-testing-guidance.heading': valueMessage('Testing checkout'),
  'help.storage.demo-boundary-information.text': valueMessage(
    'Catalog content is fictional and intended for local QA and educational demonstration. It is not a substitute for product-specific instructions or specifications.',
  ),
  'help.storage.demo-boundary.heading': valueMessage('Demo information only'),
  'help.storage.general-guidance.text': valueMessage(
    'Storage details in this help center are deliberately general. The demo does not establish storage requirements for every fictional powder in the catalog.',
  ),
  'help.storage.item-facts-authority-boundary.text': valueMessage(
    'Do not use this page to fill in omitted storage details, to transfer one product’s displayed facts to another, or to infer an unlisted specification.',
  ),
  'help.storage.item-facts-authority-reference.text': valueMessage(
    'When an item display includes product-specific facts or warnings, treat that displayed information as the relevant reference for that item.',
  ),
  'help.storage.item-facts-authority.heading': valueMessage('Check the individual product display'),
  'help.terms.terms-content-boundary-promises.text': valueMessage(
    'The demo makes no promise to provide products, services, support, or continuing availability.',
  ),
  'help.terms.terms-content-boundary-reliance.text': valueMessage(
    'Do not rely on displayed catalog content for product availability, safety, certification, performance, storage, delivery, or other service information.',
  ),
  'help.terms.terms-content-boundary.heading': valueMessage('Demo content only'),
  'help.terms.terms-demo-purpose.text': valueMessage(
    'QArefully Materials Exchange is an educational local QA demo for exploring a materials-supply interface. Its catalogue content, product descriptions, and checkout flow are fictional or simulated.',
  ),
  'help.terms.terms-no-commerce-contract-interface.text': valueMessage(
    'Checkout, payment, order, and mailbox results are simulated interface and local demo data. They are not evidence of a real payment or fulfilment request.',
  ),
  'help.terms.terms-no-commerce-contract-sale.text': valueMessage(
    'Using this demo does not form a contract of sale and does not create a real purchase, shipment, charge, refund, warranty, or customer-service obligation.',
  ),
  'help.terms.terms-no-commerce-contract.heading': valueMessage('No real transaction'),
  'help.terms.terms-test-data-fictional.text': valueMessage(
    'Use only fictional, non-sensitive information. Do not submit real payment, personal, or delivery details through the demo.',
  ),
  'help.terms.terms-test-data.heading': valueMessage('Use test data'),
};

Object.assign(generated, authoredBodyMessages);

/** Localized long-form safety/demo wording by article domain. */
const bodyDomainTranslations: Record<string, CountryMessageSet> = {
  faq: {
    UK: 'This local QA demo explains simulated catalogue, payment, shipping, account, and cart behaviour; it does not sell or ship real products.',
    US: 'This local QA demo explains simulated catalogue, payment, shipping, account, and cart behaviour; it does not sell or ship real products.',
    CN: '本地 QA 演示说明模拟目录、付款、配送、账户和购物车行为；不销售或运输真实产品。',
    PL: 'Ta lokalna demonstracja QA opisuje symulowane działanie katalogu, płatności, dostawy, konta i koszyka; nie sprzedaje ani nie wysyła prawdziwych produktów.',
    ES: 'Esta demo local de QA explica el catálogo, pago, envío, cuenta y carrito simulados; no vende ni envía productos reales.',
    DE: 'Diese lokale QA-Demo erklärt simulierte Katalog-, Zahlungs-, Versand-, Konto- und Warenkorbvorgänge; sie verkauft oder versendet keine echten Produkte.',
    FR: 'Cette démo QA locale décrit le catalogue, le paiement, la livraison, le compte et le panier simulés ; elle ne vend ni n’expédie de produits réels.',
  },
  shipping: {
    UK: 'Delivery classes, tracking, stock reservations, and freight in this local demo are simulated only; no carrier, fulfilment service, or real shipment is connected.',
    US: 'Delivery classes, tracking, stock reservations, and freight in this local demo are simulated only; no carrier, fulfilment service, or real shipment is connected.',
    CN: '本地演示中的配送类别、跟踪、库存预留和货运仅为模拟；未连接承运商、履约服务或真实货运。',
    PL: 'Klasy dostawy, śledzenie, rezerwacje zapasów i fracht w tej lokalnej demonstracji są wyłącznie symulowane; nie ma przewoźnika, realizacji ani prawdziwej przesyłki.',
    ES: 'Las clases de entrega, el seguimiento, las reservas de stock y la carga de esta demo local son simulados; no hay transportista, preparación ni envío real conectado.',
    DE: 'Lieferklassen, Tracking, Bestandsreservierungen und Fracht dieser lokalen Demo sind nur simuliert; kein Frachtführer, Fulfilment-Dienst oder echter Versand ist verbunden.',
    FR: 'Les classes de livraison, le suivi, les réservations de stock et le fret de cette démo locale sont simulés ; aucun transporteur, service de préparation ou envoi réel n’est relié.',
  },
  returns: {
    UK: 'Returns, cancellations, eligibility, and refunds in this local demo are simulated records only. No real money, postage, carrier, payment, or product return is involved.',
    US: 'Returns, cancellations, eligibility, and refunds in this local demo are simulated records only. No real money, postage, carrier, payment, or product return is involved.',
    CN: '本地演示中的退货、取消、资格和退款仅是模拟记录。不涉及真实资金、邮资、承运商、付款或产品退回。',
    PL: 'Zwroty, anulowania, kwalifikacja i refundacje w tej lokalnej demonstracji to wyłącznie symulowane rekordy. Nie ma prawdziwych pieniędzy, przesyłek, przewoźnika, płatności ani zwrotu produktu.',
    ES: 'Las devoluciones, cancelaciones, elegibilidad y reembolsos de esta demo local son solo registros simulados. No intervienen dinero, franqueo, transportista, pago ni devolución de productos reales.',
    DE: 'Rückgaben, Stornierungen, Berechtigung und Erstattungen dieser lokalen Demo sind nur simulierte Datensätze. Es gibt kein echtes Geld, Porto, Frachtführer, Zahlung oder Produktretoure.',
    FR: 'Les retours, annulations, conditions et remboursements de cette démo locale sont uniquement des enregistrements simulés. Aucun argent, affranchissement, transporteur, paiement ou retour réel n’est impliqué.',
  },
  'pack-sizes': {
    UK: 'Pack variants, weights, availability, stock, freight, clearance, and promotions describe this fictional catalogue for testing; they are not supplier inventory or fulfilment promises.',
    US: 'Pack variants, weights, availability, stock, freight, clearance, and promotions describe this fictional catalogue for testing; they are not supplier inventory or fulfilment promises.',
    CN: '包装变体、重量、可用性、库存、货运、清仓和促销仅用于测试虚构目录；不是供应商库存或履约承诺。',
    PL: 'Warianty opakowań, masy, dostępność, zapasy, fracht, wyprzedaże i promocje opisują fikcyjny katalog do testów; nie są zapasem dostawcy ani obietnicą realizacji.',
    ES: 'Las variantes, pesos, disponibilidad, stock, carga, liquidaciones y promociones describen este catálogo ficticio para pruebas; no son inventario del proveedor ni promesa de preparación.',
    DE: 'Gebindevarianten, Gewichte, Verfügbarkeit, Bestand, Fracht, Abverkauf und Aktionen beschreiben diesen fiktiven Testkatalog; sie sind kein Lieferantenbestand und kein Fulfilment-Versprechen.',
    FR: 'Les variantes, poids, disponibilités, stocks, fret, déstockage et promotions décrivent ce catalogue fictif pour les tests ; ils ne constituent ni stock fournisseur ni promesse de préparation.',
  },
  'powder-safety': {
    UK: 'Safety guidance in this local demo is limited to displayed fictional labels. Food status, “Not for consumption” warnings, handling, ventilation, and PPE must follow the item display and are not universal advice.',
    US: 'Safety guidance in this local demo is limited to displayed fictional labels. Food status, “Not for consumption” warnings, handling, ventilation, and PPE must follow the item display and are not universal advice.',
    CN: '本地演示的安全说明仅限于显示的虚构标签。食品状态、“不可食用”警告、处理、通风和 PPE 必须遵循商品显示，不是通用建议。',
    PL: 'Wskazówki bezpieczeństwa tej lokalnej demonstracji ograniczają się do fikcyjnych etykiet. Status żywności, ostrzeżenia „Nie do spożycia”, obsługa, wentylacja i ŚOI muszą wynikać z wyświetlonego produktu i nie są poradą uniwersalną.',
    ES: 'La orientación de seguridad de esta demo local se limita a etiquetas ficticias mostradas. El estado alimentario, las advertencias «No apto para consumo», la manipulación, ventilación y EPI deben seguir la ficha del artículo y no son consejos universales.',
    DE: 'Die Sicherheitshinweise dieser lokalen Demo beschränken sich auf angezeigte fiktive Etiketten. Lebensmittelstatus, Warnungen „Nicht zum Verzehr“, Handhabung, Lüftung und PSA richten sich nach der Produktanzeige und sind keine allgemeine Beratung.',
    FR: 'Les conseils de sécurité de cette démo locale se limitent aux étiquettes fictives affichées. Le statut alimentaire, les avertissements « Non comestible », la manipulation, la ventilation et les EPI suivent l’affichage et ne sont pas des conseils universels.',
  },
  'custom-blend': {
    UK: 'Custom Blend configuration, ingredient ratios, stock asymmetry, pricing, cancellation, and return rules are local simulations. A blend line is made to order and the fee is charged once per line.',
    US: 'Custom Blend configuration, ingredient ratios, stock asymmetry, pricing, cancellation, and return rules are local simulations. A blend line is made to order and the fee is charged once per line.',
    CN: '定制混合的配置、成分比例、库存差异、定价、取消和退货规则均为本地模拟。混合行按订单生产，每行只收取一次费用。',
    PL: 'Konfiguracja mieszanki, proporcje składników, różnice zapasów, ceny, anulowanie i zwroty to lokalne symulacje. Pozycja mieszanki jest wykonywana na zamówienie, a opłata jest pobierana raz za pozycję.',
    ES: 'La configuración de Custom Blend, las proporciones, la disponibilidad, el precio, las cancelaciones y las devoluciones son simulaciones locales. La línea se prepara bajo pedido y la tarifa se cobra una vez por línea.',
    DE: 'Konfiguration, Zutatenverhältnisse, Bestandsunterschiede, Preise, Stornierung und Rückgabe von Custom Blend sind lokale Simulationen. Die Mischungszeile wird nach Bestellung gefertigt und einmal pro Zeile berechnet.',
    FR: 'La configuration, les proportions, le stock, le prix, les annulations et les retours de Custom Blend sont simulés localement. La ligne est fabriquée sur commande et les frais sont facturés une fois par ligne.',
  },
  privacy: {
    UK: 'This local demo stores browser, session, account, cart, order, and mailbox test records. Use fictional, non-sensitive data; clearing one store does not clear the other.',
    US: 'This local demo stores browser, session, account, cart, order, and mailbox test records. Use fictional, non-sensitive data; clearing one store does not clear the other.',
    CN: '本地演示保存浏览器、会话、账户、购物车、订单和邮箱测试记录。请使用虚构的非敏感数据；清除一个存储不会清除另一个。',
    PL: 'Ta lokalna demonstracja przechowuje testowe rekordy przeglądarki, sesji, konta, koszyka, zamówień i skrzynki. Używaj fikcyjnych, niewrażliwych danych; wyczyszczenie jednego magazynu nie czyści drugiego.',
    ES: 'Esta demo local guarda registros de prueba del navegador, sesiones, cuenta, carrito, pedidos y buzón. Usa datos ficticios y no sensibles; borrar un almacenamiento no borra el otro.',
    DE: 'Diese lokale Demo speichert Testdatensätze für Browser, Sitzung, Konto, Warenkorb, Bestellung und Postfach. Verwenden Sie fiktive, nicht sensible Daten; das Löschen eines Speichers löscht den anderen nicht.',
    FR: 'Cette démo locale conserve des données de test du navigateur, des sessions, du compte, du panier, des commandes et de la boîte. Utilisez des données fictives non sensibles ; effacer un stockage n’efface pas l’autre.',
  },
  terms: {
    UK: 'This local QA demo has no contract of sale and no real purchase, payment, shipment, refund, warranty, fulfilment, support, or availability promise. Use only fictional test data.',
    US: 'This local QA demo has no contract of sale and no real purchase, payment, shipment, refund, warranty, fulfilment, support, or availability promise. Use only fictional test data.',
    CN: '本地 QA 演示不构成销售合同，也不承诺真实购买、付款、货运、退款、保修、履约、支持或供应。仅使用虚构测试数据。',
    PL: 'Ta lokalna demonstracja QA nie tworzy umowy sprzedaży ani nie obiecuje prawdziwego zakupu, płatności, wysyłki, refundacji, gwarancji, realizacji, wsparcia lub dostępności. Używaj wyłącznie fikcyjnych danych testowych.',
    ES: 'Esta demo local de QA no forma un contrato de compraventa ni promete compras, pagos, envíos, reembolsos, garantías, preparación, asistencia o disponibilidad reales. Usa solo datos de prueba ficticios.',
    DE: 'Diese lokale QA-Demo bildet keinen Kaufvertrag und verspricht keinen echten Kauf, keine Zahlung, keinen Versand, keine Erstattung, Garantie, Fulfilment, Unterstützung oder Verfügbarkeit. Verwenden Sie nur fiktive Testdaten.',
    FR: 'Cette démo QA locale ne forme aucun contrat de vente et ne promet aucun achat, paiement, envoi, remboursement, garantie, préparation, assistance ou disponibilité réelle. Utilisez uniquement des données de test fictives.',
  },
};

for (const [key, entry] of Object.entries(authoredBodyMessages)) {
  const articleId = key.split('.')[1]!;
  const domain = bodyDomainTranslations[articleId];
  if (domain !== undefined) {
    generated[key] = {
      UK: entry.UK,
      US: entry.US,
      CN: domain.CN,
      PL: domain.PL,
      ES: domain.ES,
      DE: domain.DE,
      FR: domain.FR,
    };
  }
}

const translatedBodyMessages: Record<string, CountryMessageSet> = {
  'help.storage.general-guidance.text': {
    UK: 'Storage details in this help center are deliberately general. The demo does not establish storage requirements for every fictional powder in the catalog.',
    US: 'Storage details in this help center are deliberately general. The demo does not establish storage requirements for every fictional powder in the catalog.',
    CN: '本帮助中心的储存详情仅作一般说明。本演示不会为目录中的每种虚构粉末规定储存要求。',
    PL: 'Szczegóły przechowywania w tym centrum pomocy są celowo ogólne. Demonstracja nie określa wymagań przechowywania dla każdego fikcyjnego proszku w katalogu.',
    ES: 'Los detalles de almacenamiento de este centro de ayuda son deliberadamente generales. La demo no establece requisitos de almacenamiento para cada polvo ficticio del catálogo.',
    DE: 'Die Lagerhinweise in diesem Hilfezentrum sind bewusst allgemein gehalten. Die Demo legt keine Lageranforderungen für jedes fiktive Pulver im Katalog fest.',
    FR: 'Les détails de stockage de ce centre d’aide sont volontairement généraux. La démo ne définit pas les exigences de stockage de chaque poudre fictive du catalogue.',
  },
  'help.storage.item-facts-authority.heading': {
    UK: 'Check the individual product display',
    US: 'Check the individual product display',
    CN: '查看单个产品显示',
    PL: 'Sprawdź informacje przy produkcie',
    ES: 'Consulta la ficha del producto',
    DE: 'Prüfen Sie die einzelne Produktanzeige',
    FR: 'Consultez la fiche du produit',
  },
  'help.storage.item-facts-authority-reference.text': {
    UK: 'When an item display includes product-specific facts or warnings, treat that displayed information as the relevant reference for that item.',
    US: 'When an item display includes product-specific facts or warnings, treat that displayed information as the relevant reference for that item.',
    CN: '商品显示具体事实或警告时，应将该显示信息作为该商品的相关参考。',
    PL: 'Jeśli przy produkcie wyświetlono fakty lub ostrzeżenia, traktuj je jako właściwe źródło informacji dla tego produktu.',
    ES: 'Cuando la ficha de un artículo incluya datos o advertencias específicas, usa esa información como referencia para dicho artículo.',
    DE: 'Wenn eine Produktanzeige produktspezifische Fakten oder Warnungen enthält, gilt diese Anzeige als maßgebliche Referenz für das Produkt.',
    FR: 'Lorsque la fiche d’un article comporte des faits ou avertissements spécifiques, utilisez ces informations comme référence pour cet article.',
  },
  'help.storage.item-facts-authority-boundary.text': {
    UK: 'Do not use this page to fill in omitted storage details, to transfer one product’s displayed facts to another, or to infer an unlisted specification.',
    US: 'Do not use this page to fill in omitted storage details, to transfer one product’s displayed facts to another, or to infer an unlisted specification.',
    CN: '不要用本页面补充缺失的储存详情、将一个产品的显示事实转用于另一个产品，或推断未列出的规格。',
    PL: 'Nie używaj tej strony do uzupełniania pominiętych danych przechowywania, przenoszenia faktów z jednego produktu na inny ani wnioskowania o niepodanej specyfikacji.',
    ES: 'No uses esta página para completar datos de almacenamiento omitidos, transferir información mostrada de un producto a otro ni inferir una especificación no indicada.',
    DE: 'Verwenden Sie diese Seite nicht, um fehlende Lagerangaben zu ergänzen, angezeigte Fakten eines Produkts auf ein anderes zu übertragen oder eine nicht aufgeführte Spezifikation abzuleiten.',
    FR: 'N’utilisez pas cette page pour compléter des détails de stockage manquants, transférer les informations affichées d’un produit à un autre ou déduire une spécification absente.',
  },
  'help.storage.demo-boundary.heading': {
    UK: 'Demo information only',
    US: 'Demo information only',
    CN: '仅限演示信息',
    PL: 'Tylko informacje demonstracyjne',
    ES: 'Solo información de la demo',
    DE: 'Nur Demoinformationen',
    FR: 'Informations de démonstration uniquement',
  },
  'help.storage.demo-boundary-information.text': {
    UK: 'Catalog content is fictional and intended for local QA and educational demonstration. It is not a substitute for product-specific instructions or specifications.',
    US: 'Catalog content is fictional and intended for local QA and educational demonstration. It is not a substitute for product-specific instructions or specifications.',
    CN: '目录内容为虚构内容，用于本地 QA 和教学演示，不能替代具体产品说明或规格。',
    PL: 'Treść katalogu jest fikcyjna i służy lokalnym testom QA oraz demonstracji edukacyjnej. Nie zastępuje instrukcji ani specyfikacji konkretnego produktu.',
    ES: 'El contenido del catálogo es ficticio y está destinado a QA local y demostraciones educativas. No sustituye las instrucciones ni especificaciones del producto concreto.',
    DE: 'Die Kataloginhalte sind fiktiv und für lokale QA- und Lehrdemonstrationen gedacht. Sie ersetzen keine produktspezifischen Anweisungen oder Spezifikationen.',
    FR: 'Le contenu du catalogue est fictif et destiné à la QA locale et aux démonstrations pédagogiques. Il ne remplace pas les instructions ou spécifications propres au produit.',
  },
  'help.shipping.shipping-demo-purpose.text': {
    UK: 'QArefully Materials Exchange is a local QA demo. Checkout and order updates let you explore the interface, but they do not create a real shipment.',
    US: 'QArefully Materials Exchange is a local QA demo. Checkout and order updates let you explore the interface, but they do not create a real shipment.',
    CN: 'QArefully Materials Exchange 是本地 QA 演示。结账和订单更新可用于探索界面，但不会创建真实货运。',
    PL: 'QArefully Materials Exchange to lokalna demonstracja QA. Kasa i aktualizacje zamówień służą do poznania interfejsu, ale nie tworzą prawdziwej przesyłki.',
    ES: 'QArefully Materials Exchange es una demo local de QA. El pago y las actualizaciones del pedido permiten explorar la interfaz, pero no crean un envío real.',
    DE: 'QArefully Materials Exchange ist eine lokale QA-Demo. Checkout und Bestellupdates zeigen die Oberfläche, erzeugen aber keine echte Sendung.',
    FR: 'QArefully Materials Exchange est une démo QA locale. Le paiement et les mises à jour de commande permettent d’explorer l’interface, mais ne créent pas d’expédition réelle.',
  },
  'help.shipping.shipping-no-fulfilment-services.text': {
    UK: 'No carrier, dispatch process, delivery estimate, or fulfilment service is connected to this demo. Tracking references and timeline updates are simulated local-demo data only. Local stock is reserved during checkout, but it does not create a real shipment.',
    US: 'No carrier, dispatch process, delivery estimate, or fulfilment service is connected to this demo. Tracking references and timeline updates are simulated local-demo data only. Local stock is reserved during checkout, but it does not create a real shipment.',
    CN: '此演示未连接承运商、发货流程、配送估算或履约服务。跟踪编号和时间线更新仅是本地演示模拟数据。结账时会预留本地库存，但不会创建真实货运。',
    PL: 'Ta demonstracja nie łączy się z przewoźnikiem, wysyłką, terminem dostawy ani usługą realizacji. Numery śledzenia i aktualizacje osi czasu to wyłącznie symulowane dane lokalnej demonstracji. Zapasy są rezerwowane przy kasie, ale nie tworzy to prawdziwej przesyłki.',
    ES: 'Esta demo no está conectada a transportistas, despacho, estimaciones de entrega ni servicios de preparación. Las referencias de seguimiento y actualizaciones de la línea temporal son datos simulados locales. El stock se reserva durante el pago, pero no crea un envío real.',
    DE: 'Diese Demo ist nicht mit Frachtführer, Versand, Lieferprognosen oder Fulfilment verbunden. Sendungsnummern und Zeitachsen-Updates sind nur simulierte lokale Demodaten. Beim Checkout wird lokaler Bestand reserviert, aber keine echte Sendung erstellt.',
    FR: 'Cette démo n’est reliée à aucun transporteur, processus d’expédition, estimation de livraison ou service de préparation. Les références de suivi et mises à jour de la chronologie sont uniquement des données simulées locales. Le stock est réservé au paiement, mais aucune expédition réelle n’est créée.',
  },
  'help.returns.returns-notice-real.text': {
    UK: 'No real money, postage, carrier, or return label is involved. Refunds are local simulation records and are never processed by a payment gateway. Do not send physical items, payment details, or real return requests to anything shown in this demo.',
    US: 'No real money, postage, carrier, or return label is involved. Refunds are local simulation records and are never processed by a payment gateway. Do not send physical items, payment details, or real return requests to anything shown in this demo.',
    CN: '不涉及真实资金、邮资、承运商或退货标签。退款只是本地模拟记录，绝不会由支付网关处理。请勿向此演示中的任何内容发送实物、付款信息或真实退货请求。',
    PL: 'Nie ma tu prawdziwych pieniędzy, opłat pocztowych, przewoźnika ani etykiety zwrotnej. Zwroty są lokalnymi rekordami symulacji i nigdy nie są obsługiwane przez bramkę płatniczą. Nie wysyłaj do tej demonstracji rzeczy, danych płatniczych ani prawdziwych żądań zwrotu.',
    ES: 'No intervienen dinero real, franqueo, transportista ni etiqueta de devolución. Los reembolsos son registros de simulación local y nunca pasan por una pasarela de pago. No envíes artículos físicos, datos de pago ni solicitudes de devolución reales a nada de esta demo.',
    DE: 'Es sind kein echtes Geld, Porto, Frachtführer oder Rücksendeetikett beteiligt. Erstattungen sind lokale Simulationsdatensätze und werden nie über ein Zahlungs-Gateway verarbeitet. Senden Sie dieser Demo keine physischen Artikel, Zahlungsdaten oder echten Rückgabeanfragen.',
    FR: 'Aucun argent réel, affranchissement, transporteur ou étiquette de retour n’est impliqué. Les remboursements sont des enregistrements de simulation locale et ne passent jamais par une passerelle de paiement. N’envoyez à cette démo aucun article, donnée de paiement ou demande de retour réelle.',
  },
  'help.returns.returns-notice.heading': {
    UK: 'Simulated only — no real returns or payments',
    US: 'Simulated only — no real returns or payments',
    CN: '仅为模拟——不涉及真实退货或付款',
    PL: 'Wyłącznie symulacja — bez prawdziwych zwrotów ani płatności',
    ES: 'Solo simulación — sin devoluciones ni pagos reales',
    DE: 'Nur simuliert – keine echten Rückgaben oder Zahlungen',
    FR: 'Simulation uniquement — aucun retour ni paiement réel',
  },
  'help.powder-safety.product-label-authority-consumption.text': {
    UK: 'If a product displays “Not for consumption”, follow that displayed warning. Do not infer a different use from its category, name, image, or this help article.',
    US: 'If a product displays “Not for consumption”, follow that displayed warning. Do not infer a different use from its category, name, image, or this help article.',
    CN: '如果产品显示“不可食用”，请遵循该警告。不要从类别、名称、图片或本帮助文章推断其他用途。',
    PL: 'Jeśli produkt wyświetla „Nie do spożycia”, postępuj zgodnie z tym ostrzeżeniem. Nie wyciągaj innego zastosowania z kategorii, nazwy, obrazu ani tego artykułu.',
    ES: 'Si un producto muestra «No apto para consumo», sigue esa advertencia. No infieras otro uso por su categoría, nombre, imagen o este artículo de ayuda.',
    DE: 'Wenn ein Produkt „Nicht zum Verzehr“ anzeigt, befolgen Sie diesen Warnhinweis. Leiten Sie keine andere Verwendung aus Kategorie, Name, Bild oder diesem Hilfeartikel ab.',
    FR: 'Si un produit affiche « Non comestible », suivez cet avertissement. N’inférez pas un autre usage de sa catégorie, de son nom, de son image ou de cet article.',
  },
  'help.powder-safety.safety-ppe-guidance.text': {
    UK: 'Non-food materials such as cement, plaster, mortar, pigments, garden lime, laundry powder, and spill absorbents require personal protective equipment during handling. Use eye protection, gloves, and a dust mask when handling these materials.',
    US: 'Non-food materials such as cement, plaster, mortar, pigments, garden lime, laundry powder, and spill absorbents require personal protective equipment during handling. Use eye protection, gloves, and a dust mask when handling these materials.',
    CN: '水泥、石膏、砂浆、颜料、园艺石灰、洗衣粉和溢出物吸收剂等非食品材料在处理时需要个人防护装备。处理这些材料时请佩戴护目镜、手套和防尘口罩。',
    PL: 'Materiały niejadalne, takie jak cement, tynk, zaprawa, pigmenty, wapno ogrodowe, proszek do prania i pochłaniacze wycieków, wymagają środków ochrony indywidualnej. Podczas pracy używaj ochrony oczu, rękawic i maski przeciwpyłowej.',
    ES: 'Los materiales no alimentarios, como cemento, yeso, mortero, pigmentos, cal de jardín, detergente en polvo y absorbentes, requieren equipos de protección individual. Usa protección ocular, guantes y mascarilla antipolvo al manipularlos.',
    DE: 'Nicht-Lebensmittel wie Zement, Gips, Mörtel, Pigmente, Gartenkalk, Waschpulver und Bindemittel für Verschüttetes erfordern bei der Handhabung persönliche Schutzausrüstung. Tragen Sie Schutzbrille, Handschuhe und Staubmaske.',
    FR: 'Les matériaux non alimentaires comme le ciment, le plâtre, le mortier, les pigments, la chaux de jardin, la lessive et les absorbants de déversement nécessitent des équipements de protection. Portez des lunettes, des gants et un masque anti-poussière.',
  },
  'help.custom-blend.custom-blend-pricing-fee.text': {
    UK: 'A flat blending fee of {blendFee} is added once per blend line. It is charged per line rather than per sack, so raising the quantity on a blend does not multiply the fee.',
    US: 'A flat blending fee of {blendFee} is added once per blend line. It is charged per line rather than per sack, so raising the quantity on a blend does not multiply the fee.',
    CN: '每个混合行只收取一次固定混合费 {blendFee}。费用按行而非按袋收取，因此增加混合数量不会使费用倍增。',
    PL: 'Do każdej pozycji mieszanki doliczana jest jednorazowa opłata za mieszanie {blendFee}. Pobiera się ją za pozycję, nie za worek, więc zwiększenie ilości nie zwielokrotnia opłaty.',
    ES: 'Se añade una tarifa fija de mezcla de {blendFee} una vez por línea. Se cobra por línea, no por saco, así que aumentar la cantidad no multiplica la tarifa.',
    DE: 'Pro Mischungszeile wird einmalig eine feste Mischgebühr von {blendFee} berechnet. Sie gilt pro Zeile, nicht pro Sack; eine höhere Menge vervielfacht die Gebühr nicht.',
    FR: 'Des frais fixes de mélange de {blendFee} sont ajoutés une fois par ligne. Ils sont facturés par ligne et non par sac : augmenter la quantité ne les multiplie pas.',
  },
  'help.privacy.privacy-local-demo.text': {
    UK: 'QArefully Materials Exchange is a local QA demo, not a production service. Use fictional or otherwise non-sensitive test data while exploring it.',
    US: 'QArefully Materials Exchange is a local QA demo, not a production service. Use fictional or otherwise non-sensitive test data while exploring it.',
    CN: 'QArefully Materials Exchange 是本地 QA 演示，不是生产服务。探索时请使用虚构或其他非敏感测试数据。',
    PL: 'QArefully Materials Exchange to lokalna demonstracja QA, a nie usługa produkcyjna. Podczas korzystania używaj fikcyjnych lub innych niewrażliwych danych testowych.',
    ES: 'QArefully Materials Exchange es una demo local de QA, no un servicio de producción. Usa datos de prueba ficticios o no sensibles mientras la exploras.',
    DE: 'QArefully Materials Exchange ist eine lokale QA-Demo, kein Produktionsdienst. Verwenden Sie beim Erkunden fiktive oder andere nicht sensible Testdaten.',
    FR: 'QArefully Materials Exchange est une démo QA locale, pas un service de production. Utilisez des données de test fictives ou non sensibles.',
  },
  'help.terms.terms-no-commerce-contract-sale.text': {
    UK: 'Using this demo does not form a contract of sale and does not create a real purchase, shipment, charge, refund, warranty, or customer-service obligation.',
    US: 'Using this demo does not form a contract of sale and does not create a real purchase, shipment, charge, refund, warranty, or customer-service obligation.',
    CN: '使用本演示不会形成销售合同，也不会产生真实购买、货运、收费、退款、保修或客户服务义务。',
    PL: 'Korzystanie z tej demonstracji nie tworzy umowy sprzedaży ani prawdziwego zakupu, wysyłki, obciążenia, zwrotu, gwarancji lub obowiązku obsługi klienta.',
    ES: 'Usar esta demo no constituye un contrato de compraventa ni crea una compra, envío, cargo, reembolso, garantía u obligación de atención al cliente reales.',
    DE: 'Die Nutzung dieser Demo begründet keinen Kaufvertrag und keine echte Kauf-, Versand-, Zahlungs-, Erstattungs-, Garantie- oder Kundendienstpflicht.',
    FR: 'L’utilisation de cette démo ne forme pas de contrat de vente et ne crée aucune obligation réelle d’achat, d’expédition, de débit, de remboursement, de garantie ou de service client.',
  },
  'help.terms.terms-no-commerce-contract-interface.text': {
    UK: 'Checkout, payment, order, and mailbox results are simulated interface and local demo data. They are not evidence of a real payment or fulfilment request.',
    US: 'Checkout, payment, order, and mailbox results are simulated interface and local demo data. They are not evidence of a real payment or fulfilment request.',
    CN: '结账、付款、订单和邮箱结果都是模拟界面和本地演示数据。它们不代表真实付款或履约请求。',
    PL: 'Wyniki kasy, płatności, zamówień i skrzynki to symulowany interfejs i lokalne dane demonstracyjne. Nie są dowodem prawdziwej płatności ani zlecenia realizacji.',
    ES: 'Los resultados de pago, pedido y buzón son una interfaz simulada y datos locales de la demo. No prueban un pago ni una solicitud de preparación reales.',
    DE: 'Checkout-, Zahlungs-, Bestell- und Postfachergebnisse sind simulierte Oberfläche und lokale Demodaten. Sie belegen keine echte Zahlung oder Fulfilment-Anfrage.',
    FR: 'Les résultats de paiement, commande et boîte aux lettres sont une interface simulée et des données locales. Ils ne prouvent aucun paiement ni aucune demande de préparation réelle.',
  },
  'help.faq.shop-purpose-answer.text': {
    UK: 'No. This is a local QA demo with catalogue content and simulated commerce. No real products are sold or shipped.',
    US: 'No. This is a local QA demo with catalogue content and simulated commerce. No real products are sold or shipped.',
    CN: '不是。这是包含目录内容和模拟商务的本地 QA 演示，不销售或运输真实产品。',
    PL: 'Nie. To lokalna demonstracja QA z treścią katalogu i symulowanym handlem. Żadne prawdziwe produkty nie są sprzedawane ani wysyłane.',
    ES: 'No. Es una demo local de QA con contenido de catálogo y comercio simulado. No se venden ni envían productos reales.',
    DE: 'Nein. Dies ist eine lokale QA-Demo mit Kataloginhalten und simuliertem Handel. Es werden keine echten Produkte verkauft oder versandt.',
    FR: 'Non. Il s’agit d’une démo QA locale avec un catalogue et un commerce simulé. Aucun produit réel n’est vendu ni expédié.',
  },
};

Object.assign(generated, translatedBodyMessages);

export const helpPolicyMessages = defineMessages(generated);
export type HelpPolicyMessageKey = keyof typeof helpPolicyMessages;
