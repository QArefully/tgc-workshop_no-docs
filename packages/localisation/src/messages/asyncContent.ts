import type { Country } from '@shop/contracts/country';
import { defineMessages, type MessageCatalog } from './defineMessages.js';
import { translate } from '../translate.js';

/**
 * Shop-authored copy emitted by background work, lifecycle mutations, and local mailbox jobs.
 *
 * Values are deliberately plain text. Interpolation values such as links, names, ids, and
 * canonical pence are supplied by the producer and are never inferred from the selected browser
 * country.
 */
export const asyncContent = defineMessages({
  'mail.passwordReset.subject': {
    UK: 'Password Reset Request',
    US: 'Password Reset Request',
    CN: '密码重置请求',
    PL: 'Prośba o reset hasła',
    ES: 'Solicitud de restablecimiento de contraseña',
    DE: 'Anfrage zum Zurücksetzen des Passworts',
    FR: 'Demande de réinitialisation du mot de passe',
  },
  'mail.passwordReset.body': {
    UK: 'Click the link to reset your password: {resetUrl}',
    US: 'Click the link to reset your password: {resetUrl}',
    CN: '请使用此链接重置密码：{resetUrl}',
    PL: 'Użyj tego łącza, aby zresetować hasło: {resetUrl}',
    ES: 'Usa este enlace para restablecer tu contraseña: {resetUrl}',
    DE: 'Verwenden Sie diesen Link, um Ihr Passwort zurückzusetzen: {resetUrl}',
    FR: 'Utilisez ce lien pour réinitialiser votre mot de passe : {resetUrl}',
  },
  'mail.companyInvite.subject': {
    UK: 'Invitation to {companyName}',
    US: 'Invitation to {companyName}',
    CN: '邀请加入 {companyName}',
    PL: 'Zaproszenie do {companyName}',
    ES: 'Invitación a {companyName}',
    DE: 'Einladung zu {companyName}',
    FR: 'Invitation à {companyName}',
  },
  'mail.companyInvite.body': {
    UK: 'Accept your {role} company invitation: {inviteUrl}. This invitation expires at {expiresAt}.',
    US: 'Accept your {role} company invitation: {inviteUrl}. This invitation expires at {expiresAt}.',
    CN: '请接受您的 {role} 公司邀请：{inviteUrl}。邀请将于 {expiresAt} 过期。',
    PL: 'Zaakceptuj zaproszenie firmowe ({role}): {inviteUrl}. Zaproszenie wygasa o {expiresAt}.',
    ES: 'Acepta tu invitación de empresa ({role}): {inviteUrl}. La invitación caduca a las {expiresAt}.',
    DE: 'Nehmen Sie Ihre {role}-Einladung an: {inviteUrl}. Die Einladung läuft am {expiresAt} ab.',
    FR: 'Acceptez votre invitation d’entreprise ({role}) : {inviteUrl}. Elle expire le {expiresAt}.',
  },
  'mail.orderApproval.subject': {
    UK: 'Order approval requested for {companyName}',
    US: 'Order approval requested for {companyName}',
    CN: '需要批准 {companyName} 的订单',
    PL: 'Wymagana akceptacja zamówienia dla {companyName}',
    ES: 'Se requiere aprobación del pedido para {companyName}',
    DE: 'Bestellfreigabe für {companyName} erforderlich',
    FR: 'Approbation de commande requise pour {companyName}',
  },
  'mail.orderApproval.body': {
    UK: 'Approval request #{approvalRequestId} awaits review. Total: {totalCents} pence.',
    US: 'Approval request #{approvalRequestId} awaits review. Total: {totalCents} pence.',
    CN: '批准请求 #{approvalRequestId} 等待审核。总额：{totalCents} 便士。',
    PL: 'Wniosek o akceptację nr {approvalRequestId} czeka na rozpatrzenie. Suma: {totalCents} pensów.',
    ES: 'La solicitud de aprobación n.º {approvalRequestId} espera revisión. Total: {totalCents} peniques.',
    DE: 'Freigabeanfrage Nr. {approvalRequestId} wartet auf Prüfung. Gesamt: {totalCents} Pence.',
    FR: 'La demande d’approbation n° {approvalRequestId} attend votre examen. Total : {totalCents} pence.',
  },
  'mail.dataExport.subject': {
    UK: 'QArefully Materials Exchange — data export',
    US: 'QArefully Materials Exchange — data export',
    CN: 'QArefully Materials Exchange — 数据导出',
    PL: 'QArefully Materials Exchange — eksport danych',
    ES: 'QArefully Materials Exchange — exportación de datos',
    DE: 'QArefully Materials Exchange — Datenexport',
    FR: 'QArefully Materials Exchange — export de données',
  },
  'mail.dataExport.body': {
    UK: 'Your data export is available in your QArefully Materials Exchange account.',
    US: 'Your data export is available in your QArefully Materials Exchange account.',
    CN: '您的数据导出已在 QArefully Materials Exchange 账户中可用。',
    PL: 'Eksport danych jest dostępny na koncie QArefully Materials Exchange.',
    ES: 'Tu exportación de datos está disponible en tu cuenta de QArefully Materials Exchange.',
    DE: 'Ihr Datenexport ist in Ihrem QArefully-Materials-Exchange-Konto verfügbar.',
    FR: 'Votre export de données est disponible dans votre compte QArefully Materials Exchange.',
  },
  'notification.backInStock.title': {
    UK: 'Back in stock: {productName}',
    US: 'Back in stock: {productName}',
    CN: '补货：{productName}',
    PL: 'Ponownie dostępne: {productName}',
    ES: 'De nuevo disponible: {productName}',
    DE: 'Wieder auf Lager: {productName}',
    FR: 'De nouveau en stock : {productName}',
  },
  'notification.backInStock.body': {
    UK: '{productName} ({variantLabel}) is available to order again.',
    US: '{productName} ({variantLabel}) is available to order again.',
    CN: '{productName}（{variantLabel}）现在可以再次订购。',
    PL: '{productName} ({variantLabel}) można ponownie zamawiać.',
    ES: '{productName} ({variantLabel}) vuelve a estar disponible para pedir.',
    DE: '{productName} ({variantLabel}) kann wieder bestellt werden.',
    FR: '{productName} ({variantLabel}) peut à nouveau être commandé.',
  },
  'notification.standingOrder.completed.title': {
    UK: 'Standing order run completed',
    US: 'Standing order run completed',
    CN: '定期订单运行已完成',
    PL: 'Wykonanie zamówienia cyklicznego zakończone',
    ES: 'Ejecución del pedido recurrente completada',
    DE: 'Ausführung des Dauerauftrags abgeschlossen',
    FR: 'Exécution de la commande récurrente terminée',
  },
  'notification.standingOrder.completed.body': {
    UK: {
      one: '{count} line was added to your cart.',
      other: '{count} lines were added to your cart.',
    },
    US: {
      one: '{count} line was added to your cart.',
      other: '{count} lines were added to your cart.',
    },
    CN: { other: '已将 {count} 个商品行添加到购物车。' },
    PL: {
      one: 'Dodano {count} pozycję do koszyka.',
      few: 'Dodano {count} pozycje do koszyka.',
      many: 'Dodano {count} pozycji do koszyka.',
      other: 'Dodano {count} pozycji do koszyka.',
    },
    ES: {
      one: 'Se añadió {count} línea al carrito.',
      other: 'Se añadieron {count} líneas al carrito.',
    },
    DE: {
      one: '{count} Position wurde in den Warenkorb gelegt.',
      other: '{count} Positionen wurden in den Warenkorb gelegt.',
    },
    FR: {
      one: '{count} ligne a été ajoutée au panier.',
      other: '{count} lignes ont été ajoutées au panier.',
    },
  },
  'notification.standingOrder.due.title': {
    UK: 'Standing order ready',
    US: 'Standing order ready',
    CN: '定期订单已准备就绪',
    PL: 'Zamówienie cykliczne jest gotowe',
    ES: 'Pedido recurrente listo',
    DE: 'Dauerauftrag bereit',
    FR: 'Commande récurrente prête',
  },
  'notification.standingOrder.due.body': {
    UK: '{standingOrderName} is due to run.',
    US: '{standingOrderName} is due to run.',
    CN: '{standingOrderName} 到期可运行。',
    PL: 'Nadszedł czas wykonania: {standingOrderName}.',
    ES: '{standingOrderName} está listo para ejecutarse.',
    DE: '{standingOrderName} ist zur Ausführung fällig.',
    FR: '{standingOrderName} doit être exécutée.',
  },
  'notification.standingOrder.failed.title': {
    UK: 'Standing order run could not be completed',
    US: 'Standing order run could not be completed',
    CN: '定期订单运行未完成',
    PL: 'Nie można ukończyć wykonania zamówienia cyklicznego',
    ES: 'No se pudo completar la ejecución del pedido recurrente',
    DE: 'Ausführung des Dauerauftrags konnte nicht abgeschlossen werden',
    FR: 'Impossible de terminer la commande récurrente',
  },
  'notification.standingOrder.failed.body': {
    UK: 'Your standing order needs attention before it can run again.',
    US: 'Your standing order needs attention before it can run again.',
    CN: '定期订单需要处理后才能再次运行。',
    PL: 'Zamówienie cykliczne wymaga uwagi przed kolejnym wykonaniem.',
    ES: 'Tu pedido recurrente necesita atención antes de volver a ejecutarse.',
    DE: 'Ihr Dauerauftrag benötigt Aufmerksamkeit, bevor er erneut ausgeführt werden kann.',
    FR: 'Votre commande récurrente nécessite votre attention avant une nouvelle exécution.',
  },
  'notification.payment.settled.title': {
    UK: 'Payment update received',
    US: 'Payment update received',
    CN: '收到付款更新',
    PL: 'Otrzymano aktualizację płatności',
    ES: 'Actualización del pago recibida',
    DE: 'Zahlungsaktualisierung erhalten',
    FR: 'Mise à jour du paiement reçue',
  },
  'notification.payment.settled.body': {
    UK: 'Payment update received for order #{orderId}.',
    US: 'Payment update received for order #{orderId}.',
    CN: '已收到订单 #{orderId} 的付款更新。',
    PL: 'Otrzymano aktualizację płatności dla zamówienia nr {orderId}.',
    ES: 'Se recibió una actualización del pago del pedido n.º {orderId}.',
    DE: 'Zahlungsaktualisierung für Bestellung Nr. {orderId} erhalten.',
    FR: 'Mise à jour du paiement reçue pour la commande n° {orderId}.',
  },
  'order.lifecycle.created': {
    UK: 'Order created',
    US: 'Order created',
    CN: '订单已创建',
    PL: 'Utworzono zamówienie',
    ES: 'Pedido creado',
    DE: 'Bestellung erstellt',
    FR: 'Commande créée',
  },
  'order.lifecycle.shipmentPacked': {
    UK: 'Shipment packed',
    US: 'Shipment packed',
    CN: '货件已打包',
    PL: 'Przesyłka spakowana',
    ES: 'Envío preparado',
    DE: 'Sendung verpackt',
    FR: 'Envoi emballé',
  },
  'order.lifecycle.shipmentShipped': {
    UK: 'Shipment shipped',
    US: 'Shipment shipped',
    CN: '货件已发出',
    PL: 'Przesyłka wysłana',
    ES: 'Envío enviado',
    DE: 'Sendung versandt',
    FR: 'Envoi expédié',
  },
  'order.lifecycle.shipmentDelivered': {
    UK: 'Shipment delivered',
    US: 'Shipment delivered',
    CN: '货件已送达',
    PL: 'Przesyłka dostarczona',
    ES: 'Envío entregado',
    DE: 'Sendung zugestellt',
    FR: 'Envoi livré',
  },
  'order.lifecycle.shipmentDeliveryFailed': {
    UK: 'Shipment delivery failed',
    US: 'Shipment delivery failed',
    CN: '货件配送失败',
    PL: 'Dostawa przesyłki nie powiodła się',
    ES: 'Falló la entrega del envío',
    DE: 'Zustellung der Sendung fehlgeschlagen',
    FR: 'Échec de la livraison de l’envoi',
  },
  'order.lifecycle.cancelled': {
    UK: 'Order cancelled',
    US: 'Order cancelled',
    CN: '订单已取消',
    PL: 'Zamówienie anulowane',
    ES: 'Pedido cancelado',
    DE: 'Bestellung storniert',
    FR: 'Commande annulée',
  },
} as const);

export type AsyncContentKey = keyof typeof asyncContent;
export const ASYNC_CONTENT = asyncContent;
export const asyncMessages = asyncContent;
export const ASYNC_MESSAGES = asyncContent;
export const asyncContentMessages = asyncContent;
export const ASYNC_CONTENT_MESSAGES = asyncContent;

/** Resolve one async message through the shared country translator. */
export function translateAsync(
  country: Country,
  key: AsyncContentKey,
  params: Readonly<Record<string, string | number | bigint>> = {},
): string {
  return translate(asyncContent, country, key, params);
}

export function passwordResetCopy(
  country: Country,
  resetUrl: string,
): { subject: string; body: string } {
  return {
    subject: translateAsync(country, 'mail.passwordReset.subject'),
    body: translateAsync(country, 'mail.passwordReset.body', { resetUrl }),
  };
}

export function companyInviteCopy(
  country: Country,
  params: { companyName: string; inviteUrl: string; role: string; expiresAt: string },
): { subject: string; body: string } {
  return {
    subject: translateAsync(country, 'mail.companyInvite.subject', params),
    body: translateAsync(country, 'mail.companyInvite.body', params),
  };
}

export function orderApprovalCopy(
  country: Country,
  params: { companyName: string; approvalRequestId: string; totalCents: number },
): { subject: string; body: string } {
  return {
    subject: translateAsync(country, 'mail.orderApproval.subject', params),
    body: translateAsync(country, 'mail.orderApproval.body', params),
  };
}

export function dataExportCopy(country: Country): { subject: string; body: string } {
  return {
    subject: translateAsync(country, 'mail.dataExport.subject'),
    body: translateAsync(country, 'mail.dataExport.body'),
  };
}

export function backInStockCopy(
  country: Country,
  productName: string,
  variantLabel: string,
): { title: string; body: string } {
  const params = { productName, variantLabel };
  return {
    title: translateAsync(country, 'notification.backInStock.title', params),
    body: translateAsync(country, 'notification.backInStock.body', params),
  };
}

export function standingOrderCompletedCopy(
  country: Country,
  count: number,
): { title: string; body: string } {
  return {
    title: translateAsync(country, 'notification.standingOrder.completed.title'),
    body: translateAsync(country, 'notification.standingOrder.completed.body', { count }),
  };
}

export function standingOrderDueCopy(
  country: Country,
  standingOrderName: string,
): { title: string; body: string } {
  return {
    title: translateAsync(country, 'notification.standingOrder.due.title'),
    body: translateAsync(country, 'notification.standingOrder.due.body', { standingOrderName }),
  };
}

export function standingOrderFailedCopy(country: Country): { title: string; body: string } {
  return {
    title: translateAsync(country, 'notification.standingOrder.failed.title'),
    body: translateAsync(country, 'notification.standingOrder.failed.body'),
  };
}

export function paymentSettledCopy(
  country: Country,
  orderId: number,
): { title: string; body: string } {
  return {
    title: translateAsync(country, 'notification.payment.settled.title'),
    body: translateAsync(country, 'notification.payment.settled.body', { orderId }),
  };
}

export function orderLifecycleTitle(
  country: Country,
  key:
    | 'created'
    | 'shipmentPacked'
    | 'shipmentShipped'
    | 'shipmentDelivered'
    | 'shipmentDeliveryFailed'
    | 'cancelled',
): string {
  return translateAsync(country, `order.lifecycle.${key}` as AsyncContentKey);
}

/** Compatibility type for feature code that accepts a generic message catalog. */
export type AsyncContentCatalog = MessageCatalog & typeof asyncContent;
