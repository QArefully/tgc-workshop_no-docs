import { defineMessages } from './defineMessages.js';

/** Shared country names, country notice, and postcode labels. */
export const countryMessages = defineMessages({
  'country.name.uk': {
    UK: 'United Kingdom',
    US: 'United Kingdom',
    CN: '英国',
    PL: 'Wielka Brytania',
    ES: 'Reino Unido',
    DE: 'Vereinigtes Königreich',
    FR: 'Royaume-Uni',
  },
  'country.name.us': {
    UK: 'United States',
    US: 'United States',
    CN: '美国',
    PL: 'Stany Zjednoczone',
    ES: 'Estados Unidos',
    DE: 'Vereinigte Staaten',
    FR: 'États-Unis',
  },
  'country.name.cn': {
    UK: 'China',
    US: 'China',
    CN: '中国',
    PL: 'Chiny',
    ES: 'China',
    DE: 'China',
    FR: 'Chine',
  },
  'country.name.pl': {
    UK: 'Poland',
    US: 'Poland',
    CN: '波兰',
    PL: 'Polska',
    ES: 'Polonia',
    DE: 'Polen',
    FR: 'Pologne',
  },
  'country.name.es': {
    UK: 'Spain',
    US: 'Spain',
    CN: '西班牙',
    PL: 'Hiszpania',
    ES: 'España',
    DE: 'Spanien',
    FR: 'Espagne',
  },
  'country.name.de': {
    UK: 'Germany',
    US: 'Germany',
    CN: '德国',
    PL: 'Niemcy',
    ES: 'Alemania',
    DE: 'Deutschland',
    FR: 'Allemagne',
  },
  'country.name.fr': {
    UK: 'France',
    US: 'France',
    CN: '法国',
    PL: 'Francja',
    ES: 'Francia',
    DE: 'Frankreich',
    FR: 'France',
  },
  'country.banner': {
    UK: 'Ordering for the United Kingdom: availability and delivery options reflect local requirements.',
    US: 'Ordering for the United States: availability and delivery options reflect local requirements.',
    CN: '在中国下单：可用性和配送选项符合当地要求。',
    PL: 'Zamówienia do Polski: dostępność i opcje dostawy uwzględniają lokalne wymagania.',
    ES: 'Pedidos para España: la disponibilidad y las opciones de entrega reflejan los requisitos locales.',
    DE: 'Bestellungen nach Deutschland: Verfügbarkeit und Lieferoptionen berücksichtigen lokale Anforderungen.',
    FR: 'Commandes pour la France : la disponibilité et les options de livraison respectent les exigences locales.',
  },
  'postcode.label': {
    UK: 'Postcode',
    US: 'ZIP code',
    CN: '邮政编码',
    PL: 'Kod pocztowy',
    ES: 'Código postal',
    DE: 'Postleitzahl',
    FR: 'Code postal',
  },
  'postcode.example': {
    UK: 'Example: {example}',
    US: 'Example: {example}',
    CN: '示例：{example}',
    PL: 'Przykład: {example}',
    ES: 'Ejemplo: {example}',
    DE: 'Beispiel: {example}',
    FR: 'Exemple : {example}',
  },
});

/** Upper-case aliases keep imports discoverable while the catalog remains key-based. */
export const COUNTRY_MESSAGES = countryMessages;
export const countryNames = countryMessages;
