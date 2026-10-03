import { CUSTOM_BLEND_FEE_CENTS } from '@shop/contracts/pricing';
import { defineHelpArticle, type HelpArticle } from './helpContentTypes';

/** Keep the authoritative fee available to the render-time materializer. */
export const BLENDING_FEE_CENTS = CUSTOM_BLEND_FEE_CENTS;

export const shippingArticle = defineHelpArticle({
  id: 'shipping',
  group: 'help',
  slug: 'shipping',
  path: '/help/shipping',
  title: 'Shipping',
  summary: 'Simulated parcel and freight delivery for local demo orders.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'shipping-demo-purpose',
      text: 'QArefully Materials Exchange is a local QA demo. Checkout and order updates let you explore the interface, but they do not create a real shipment.',
    },
    {
      kind: 'section',
      id: 'shipping-classes',
      heading: 'Parcel and freight classification',
      paragraphs: [
        {
          id: 'shipping-classes-parcel',
          text: 'Most orders are classified as standard parcel delivery. Individual product variants show a weight on the product page and a delivery class label on the cart line item.',
        },
        {
          id: 'shipping-classes-freight',
          text: 'Orders containing heavy items or exceeding a combined weight threshold are classified as freight. Freight-eligible items such as cement, sand, aggregates, and bulk minerals display a freight label in the cart. A simulated freight charge is applied at checkout.',
        },
      ],
    },
    {
      kind: 'notice',
      id: 'shipping-no-fulfilment',
      heading: 'No real delivery service',
      paragraphs: [
        {
          id: 'shipping-no-fulfilment-services',
          text: 'No carrier, dispatch process, delivery estimate, or fulfilment service is connected to this demo. Tracking references and timeline updates are simulated local-demo data only. Local stock is reserved during checkout, but it does not create a real shipment.',
        },
        {
          id: 'shipping-no-fulfilment-status',
          text: 'An order status shown in the interface is simulated state only and does not mean a parcel has been sent.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'shipping-simulated-tracking',
      heading: 'Simulated tracking',
      paragraphs: [
        {
          id: 'shipping-simulated-tracking-status',
          text: 'A tracking reference or shipment event appears only within an eligible order detail page. It cannot be used with a carrier and does not represent a real parcel.',
        },
        {
          id: 'shipping-simulated-tracking-changes',
          text: 'Demo administrators advance shipment states manually for testing. There are no automatic updates, carrier integrations, or delivery notifications.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'shipping-testing-guidance',
      heading: 'Testing checkout',
      paragraphs: [
        {
          id: 'shipping-testing-guidance-test-data',
          text: 'Use only test information while exploring checkout. The demo tracks local stock, short-lived checkout reservations, and eligible backorders. A displayed backorder lead-time estimate is not a delivery promise, and this site is not for real-world availability or delivery planning.',
        },
      ],
    },
  ],
});

export const returnsArticle = defineHelpArticle({
  id: 'returns',
  group: 'help',
  slug: 'returns',
  path: '/help/returns',
  title: 'Returns',
  summary: 'Simulated 30-day return workflow for delivered ordinary products.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'returns-demo-purpose',
      text: 'QArefully Materials Exchange provides a simulated returns and refunds workflow for QA testing. All purchases, payments, and refunds are simulated only and do not represent real transactions.',
    },
    {
      kind: 'notice',
      id: 'returns-notice',
      heading: 'Simulated only — no real returns or payments',
      paragraphs: [
        {
          id: 'returns-notice-real',
          text: 'No real money, postage, carrier, or return label is involved. Refunds are local simulation records and are never processed by a payment gateway. Do not send physical items, payment details, or real return requests to anything shown in this demo.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'returns-eligibility',
      heading: 'Eligibility',
      paragraphs: [
        {
          id: 'returns-eligibility-window',
          text: 'You can request a return within 30 days of an ordinary product shipment being marked as delivered. The 30-day window is measured from the exact delivery event time shown in your order timeline.',
        },
        {
          id: 'returns-eligibility-products',
          text: 'Only ordinary catalogue products are eligible. Custom Blend lines are made to order and are excluded from returns. Only delivered shipment quantities can be returned; backordered, shipped, or failed-delivery items are not eligible.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'returns-workflow',
      heading: 'How it works',
      paragraphs: [
        {
          id: 'returns-workflow-request',
          text: 'From your order detail page, select the delivered items and quantities you want to return, choose a reason, and optionally add a note. Submit the request.',
        },
        {
          id: 'returns-workflow-admin',
          text: 'A demo administrator reviews your request and may approve or reject it. If approved and the items are marked as received, a simulated refund is calculated. The refund amount is based on your original purchase price and discount, prorated across returned quantities.',
        },
        {
          id: 'returns-workflow-refund',
          text: 'Once refunded, a simulated reference number appears in your return history. The refund amount is shown in your local currency format. No real funds are transferred.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'returns-cancellation',
      heading: 'Returns vs cancellation',
      paragraphs: [
        {
          id: 'returns-cancellation-diff',
          text: 'Cancellation stops simulated fulfilment before shipping and releases allocated stock, but does not issue a refund. Returns apply after delivery and can result in a simulated refund when processed by an administrator. Cancellation and returns are separate workflows.',
        },
        {
          id: 'returns-cancellation-custom-blend',
          text: 'Being excluded from returns does not make an order final. An order containing a Custom Blend line cancels on exactly the same terms as any other order, at any point up to dispatch.',
        },
      ],
    },
  ],
});

export const packSizesArticle = defineHelpArticle({
  id: 'pack-sizes',
  group: 'help',
  slug: 'pack-sizes',
  path: '/help/pack-sizes',
  title: 'Pack sizes and variants',
  summary: 'How product variants, pack sizes, and delivery classes work in this demo catalogue.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'pack-sizes-overview',
      text: 'Each product in the catalogue is available in one or more purchasable variants. A variant combines a specific pack size with its own SKU, price, weight, stock, and backorder state.',
    },
    {
      kind: 'section',
      id: 'pack-sizes-variants',
      heading: 'Selecting a variant',
      paragraphs: [
        {
          id: 'pack-sizes-variants-select',
          text: 'On a product page, choose a pack size before adding to cart. Each variant shows its own weight, price, and availability state. A formulation or flavour change is a separate product, not a pack variant.',
        },
        {
          id: 'pack-sizes-variants-examples',
          text: 'Small consumer packs serve edible and performance ranges (200 g to 2 kg). Household and garden ranges offer both consumer and bulk packs (500 g to 25 kg). Trade and creative materials such as cement, sand, and aggregates range up to 1 tonne.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'pack-sizes-delivery',
      heading: 'Delivery class',
      paragraphs: [
        {
          id: 'pack-sizes-delivery-parcel',
          text: 'Most variants under the freight threshold are classified as standard parcel delivery. The product page shows the variant weight; the cart line item shows its delivery class label.',
        },
        {
          id: 'pack-sizes-delivery-freight',
          text: 'Heavy variants or orders exceeding a combined weight threshold are classified as freight. A simulated freight charge is applied at checkout. The cart and checkout display a freight label for affected lines.',
        },
      ],
    },
    {
      kind: 'notice',
      id: 'pack-sizes-no-stock',
      heading: 'Local inventory, not real fulfilment',
      paragraphs: [
        {
          id: 'pack-sizes-no-stock-quantities',
          text: 'Checkout temporarily reserves local stock while payment is processed. A successful simulated order consumes reserved stock; a backordered quantity waits for a local administrator to record a stock receipt.',
        },
        {
          id: 'pack-sizes-no-stock-inventory',
          text: 'Local stock and backorder states are for testing only. They are not supplier inventory, a delivery promise, or a real fulfilment commitment.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'pack-sizes-pricing-promotions',
      heading: 'Clearance pricing and promotions',
      paragraphs: [
        {
          id: 'pack-sizes-pricing-clearance',
          text: 'A clearance price is time-limited and is shown beside the ordinary list price when active. The clearance price becomes the starting price for the selected lot before any quantity-break tier is applied; an expired or upcoming clearance is not charged or shown as active.',
        },
        {
          id: 'pack-sizes-pricing-promotions',
          text: 'Some promotion codes apply only to one catalog category. When a code has a category scope, its item requirements and discount are calculated only from matching material lines. The checkout summary shows the eligible subtotal and category; blending fees are never discounted.',
        },
      ],
    },
  ],
});

export const safetyArticle = defineHelpArticle({
  id: 'powder-safety',
  group: 'help',
  slug: 'powder-safety',
  path: '/help/powder-safety',
  title: 'Product safety',
  summary:
    'Consumption classification, handling guidance, and PPE requirements for QArefully Materials Exchange products.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'safety-overview',
      text: 'QArefully Materials Exchange products fall into food and non-food categories. Each product page displays its consumption classification and any handling warnings.',
    },
    {
      kind: 'section',
      id: 'safety-food',
      heading: 'Food-grade products',
      paragraphs: [
        {
          id: 'safety-food-categories',
          text: 'Products in the Sports Nutrition, Baking & Pantry, and Drinks categories are classified as food-grade. They show ingredient lists, allergens, nutrition information, and serving sizes.',
        },
        {
          id: 'safety-food-boundary',
          text: 'Only products explicitly marked as food-grade are suitable for consumption. Do not infer food status from a product name, appearance, or category membership alone.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'safety-nonfood',
      heading: 'Non-food products',
      paragraphs: [
        {
          id: 'safety-nonfood-categories',
          text: 'Products in the Household & Cleaning, Garden & Outdoors, and Trade & Creative Materials categories are non-food items. Each displays "Not for consumption" on its product page and bag artwork.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'safety-ppe',
      heading: 'Handling and PPE',
      paragraphs: [
        {
          id: 'safety-ppe-guidance',
          text: 'Non-food materials such as cement, plaster, mortar, pigments, garden lime, laundry powder, and spill absorbents require personal protective equipment during handling. Use eye protection, gloves, and a dust mask when handling these materials.',
        },
        {
          id: 'safety-ppe-ventilation',
          text: 'Work in a well-ventilated area. Avoid breathing dust. Keep materials dry and sealed when not in use.',
        },
      ],
    },
  ],
});

export const customBlendArticle = defineHelpArticle({
  id: 'custom-blend',
  group: 'help',
  slug: 'custom-blend',
  path: '/help/custom-blend',
  title: 'Custom Blend',
  summary:
    'Configuring a made-to-order blend, its blending fee, and how it behaves after ordering.',
  blocks: [
    {
      kind: 'paragraph',
      id: 'custom-blend-overview',
      text: 'Custom Blend lets you order a material blended to your own specification instead of picking a stocked lot. You choose one base material and the ingredients mixed into it, and the blend is produced against your order.',
    },
    {
      kind: 'section',
      id: 'custom-blend-configuring',
      heading: 'Configuring a blend',
      paragraphs: [
        {
          id: 'custom-blend-configuring-base',
          text: 'Open Custom Blend from the main navigation, then choose a base material. Search by name or filter by category to narrow the list. Only the 25 kg sack of a material can act as a base, because the sack is the purchase unit a blend is produced in.',
        },
        {
          id: 'custom-blend-configuring-ingredients',
          text: 'With a base chosen, add between one and four ingredients and set each one to a whole percentage from 5% to 50%. Ingredients must total no more than 50% together, so the base always makes up at least half the blend. The summary shows the running base and ingredient percentages, and the configurator refuses to submit a ratio outside those limits.',
        },
        {
          id: 'custom-blend-configuring-editing',
          text: 'A blend already in your order can be reopened from its cart line. Editing keeps the base material and the quantity fixed and replaces only the recipe; two blends over the same base material stay separate lines.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'custom-blend-pricing',
      heading: 'Blending fee',
      paragraphs: [
        {
          id: 'custom-blend-pricing-fee',
          text: 'A flat blending fee of {blendFee} is added once per blend line. It is charged per line rather than per sack, so raising the quantity on a blend does not multiply the fee.',
        },
        {
          id: 'custom-blend-pricing-discounts',
          text: 'The fee sits outside the discountable amount. Cart, checkout, and order pages therefore show the material subtotal and the blending fees separately, and a promotion applies to the material subtotal only. Material pricing itself follows the ordinary per-tonne rate and quantity-break tiers for the base lot.',
        },
      ],
    },
    {
      kind: 'section',
      id: 'custom-blend-stock',
      heading: 'Ingredient availability',
      paragraphs: [
        {
          id: 'custom-blend-stock-selectable',
          text: 'An ingredient that is out of stock is still selectable. Its availability is shown for information, and it does not block the blend.',
        },
        {
          id: 'custom-blend-stock-asymmetry',
          text: 'The base material behaves differently: it is a stocked lot, so its own availability and backorder rules apply exactly as they do when you buy that lot on its own.',
        },
      ],
    },
    {
      kind: 'notice',
      id: 'custom-blend-after-ordering',
      heading: 'Cancellation and returns work differently',
      paragraphs: [
        {
          id: 'custom-blend-after-ordering-cancellation',
          text: 'Cancellation is unaffected. An order containing a blend can be cancelled on the ordinary terms, at any point up to dispatch, in the same way as an order of stocked lots.',
        },
        {
          id: 'custom-blend-after-ordering-returns',
          text: 'Returns are the exception. A blend is produced to your specification and cannot be resold, so a blend line is never eligible for return. Once an order with a blend is dispatched, that line is final, while any ordinary lots in the same order remain returnable on the usual terms.',
        },
      ],
    },
  ],
});

export const serviceArticles = [
  shippingArticle,
  returnsArticle,
  packSizesArticle,
  safetyArticle,
  customBlendArticle,
] as const satisfies readonly HelpArticle<'help', string>[];
