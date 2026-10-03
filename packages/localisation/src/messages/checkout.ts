import { defineMessages, type CountryMessageSet, type PluralTemplate } from './defineMessages.js';

/** Buyer-facing copy for checkout, payment, promotion, and order confirmation. */
const text = (
  UK: string,
  DE: string,
  overrides: Partial<Record<'US' | 'CN' | 'PL' | 'ES' | 'FR', string>> = {},
): CountryMessageSet => ({
  UK,
  US: overrides.US ?? UK,
  CN: overrides.CN ?? UK,
  PL: overrides.PL ?? UK,
  ES: overrides.ES ?? UK,
  DE,
  FR: overrides.FR ?? UK,
});

const plural = (
  UK: PluralTemplate,
  DE: PluralTemplate,
  overrides: Partial<Record<'US' | 'CN' | 'PL' | 'ES' | 'FR', PluralTemplate>> = {},
): CountryMessageSet => ({
  UK,
  US: overrides.US ?? UK,
  CN: overrides.CN ?? { other: UK.other },
  PL: overrides.PL ?? UK,
  ES: overrides.ES ?? UK,
  DE,
  FR: overrides.FR ?? UK,
});

export const checkoutMessages = defineMessages({
  'checkout.cartUnavailable': text(
    'Your cart is unavailable.',
    'Ihr Warenkorb ist nicht verfügbar.',
    {
      CN: '您的购物车不可用。',
      PL: 'Koszyk jest niedostępny.',
      ES: 'Tu carrito no está disponible.',
      FR: 'Votre panier est indisponible.',
    },
  ),
  'checkout.empty': text('Your order is empty', 'Ihre Bestellung ist leer', {
    CN: '您的订单为空',
    PL: 'Twoje zamówienie jest puste',
    ES: 'Tu pedido está vacío',
    FR: 'Votre commande est vide',
  }),
  'checkout.browseMaterials': text('Browse materials', 'Materialien durchsuchen', {
    CN: '浏览材料',
    PL: 'Przeglądaj materiały',
    ES: 'Explorar materiales',
    FR: 'Parcourir les matériaux',
  }),
  'checkout.title': text('Confirm your order', 'Bestellung bestätigen', {
    CN: '确认订单',
    PL: 'Potwierdź zamówienie',
    ES: 'Confirma tu pedido',
    FR: 'Confirmez votre commande',
  }),
  'checkout.simulatedNotice': text(
    'Payment is simulated for this demo. No real payment is collected and no goods are dispatched.',
    'Die Zahlung ist in dieser Demo simuliert. Es wird keine echte Zahlung eingezogen und keine Ware versendet.',
    {
      CN: '本演示中的付款为模拟操作。不收取真实款项，也不会发货。',
      PL: 'Płatność jest symulowana w tej wersji demonstracyjnej. Nie pobieramy prawdziwej płatności ani nie wysyłamy towaru.',
      ES: 'El pago está simulado en esta demo. No se cobra ningún pago real ni se envían productos.',
      FR: 'Le paiement est simulé dans cette démo. Aucun paiement réel n’est prélevé et aucune marchandise n’est expédiée.',
    },
  ),
  'checkout.retryCart': text('Retry cart', 'Warenkorb erneut versuchen', {
    CN: '重试购物车',
    PL: 'Ponów koszyk',
    ES: 'Reintentar carrito',
    FR: 'Réessayer le panier',
  }),
  'checkout.refreshCart': text('Refresh cart', 'Warenkorb aktualisieren', {
    CN: '刷新购物车',
    PL: 'Odśwież koszyk',
    ES: 'Actualizar carrito',
    FR: 'Actualiser le panier',
  }),
  'checkout.stockConflictTitle': text(
    'One or more items are no longer available in the requested quantity.',
    'Ein oder mehrere Artikel sind in der gewünschten Menge nicht mehr verfügbar.',
    {
      CN: '一个或多个商品已无法按请求数量提供。',
      PL: 'Co najmniej jeden artykuł nie jest już dostępny w żądanej ilości.',
      ES: 'Uno o más artículos ya no están disponibles en la cantidad solicitada.',
      FR: 'Un ou plusieurs articles ne sont plus disponibles dans la quantité demandée.',
    },
  ),
  'checkout.stockConflictBody': text(
    'Your cart has not been changed. Refresh it, then review quantities before retrying.',
    'Ihr Warenkorb wurde nicht geändert. Aktualisieren Sie ihn und prüfen Sie die Mengen, bevor Sie es erneut versuchen.',
    {
      CN: '您的购物车未更改。请刷新购物车，检查数量后重试。',
      PL: 'Koszyk nie został zmieniony. Odśwież go i sprawdź ilości przed ponowieniem próby.',
      ES: 'Tu carrito no ha cambiado. Actualízalo y revisa las cantidades antes de reintentarlo.',
      FR: 'Votre panier n’a pas changé. Actualisez-le et vérifiez les quantités avant de réessayer.',
    },
  ),
  'checkout.reservationConflictTitle': text(
    'Your checkout reservation expired before payment could complete.',
    'Ihre Checkout-Reservierung ist vor Abschluss der Zahlung abgelaufen.',
    {
      CN: '您的结账预留在付款完成前已过期。',
      PL: 'Rezerwacja realizacji zamówienia wygasła przed zakończeniem płatności.',
      ES: 'La reserva de tu compra caducó antes de completar el pago.',
      FR: 'Votre réservation de paiement a expiré avant la fin du paiement.',
    },
  ),
  'checkout.reservationConflictBody': text(
    'Your cart has not been changed. Refresh it before starting a new payment attempt.',
    'Ihr Warenkorb wurde nicht geändert. Aktualisieren Sie ihn, bevor Sie einen neuen Zahlungsversuch starten.',
    {
      CN: '您的购物车未更改。开始新的付款尝试前请先刷新购物车。',
      PL: 'Koszyk nie został zmieniony. Odśwież go przed rozpoczęciem nowej próby płatności.',
      ES: 'Tu carrito no ha cambiado. Actualízalo antes de iniciar un nuevo intento de pago.',
      FR: 'Votre panier n’a pas changé. Actualisez-le avant de lancer une nouvelle tentative de paiement.',
    },
  ),
  'checkout.slotConflictTitle': text(
    'The delivery slot you chose is no longer bookable.',
    'Das gewählte Lieferzeitfenster ist nicht mehr buchbar.',
    {
      CN: '您选择的配送时段已无法预约。',
      PL: 'Wybrany termin dostawy nie jest już dostępny.',
      ES: 'El horario de entrega elegido ya no se puede reservar.',
      FR: 'Le créneau de livraison choisi n’est plus disponible.',
    },
  ),
  'checkout.slotConflictBody': text(
    'No payment was taken and your cart has not been changed. The earliest delivery date is now {date}. Choose another slot to continue.',
    'Es wurde keine Zahlung vorgenommen und Ihr Warenkorb wurde nicht geändert. Das früheste Lieferdatum ist jetzt {date}. Wählen Sie ein anderes Zeitfenster.',
    {
      CN: '未收取款项，您的购物车也未更改。最早配送日期现在为 {date}。请选择其他时段继续。',
      PL: 'Płatność nie została pobrana, a koszyk nie został zmieniony. Najwcześniejsza dostawa przypada teraz na {date}. Wybierz inny termin.',
      ES: 'No se ha cobrado ningún pago y tu carrito no ha cambiado. La fecha de entrega más temprana es ahora {date}. Elige otro horario.',
      FR: 'Aucun paiement n’a été prélevé et votre panier n’a pas changé. La date de livraison la plus proche est désormais {date}. Choisissez un autre créneau.',
    },
  ),
  'checkout.chooseAnotherSlot': text('Choose another slot', 'Anderes Zeitfenster wählen', {
    CN: '选择其他时段',
    PL: 'Wybierz inny termin',
    ES: 'Elegir otro horario',
    FR: 'Choisir un autre créneau',
  }),
  'checkout.pendingApprovalTitle': text(
    'Your order is awaiting approval from your company approvers.',
    'Ihre Bestellung wartet auf die Genehmigung durch Ihre Unternehmensfreigebenden.',
    {
      CN: '您的订单正在等待公司审批人批准。',
      PL: 'Twoje zamówienie oczekuje na zatwierdzenie przez osoby zatwierdzające w firmie.',
      ES: 'Tu pedido espera la aprobación de los responsables de tu empresa.',
      FR: 'Votre commande attend l’approbation des approbateurs de votre entreprise.',
    },
  ),
  'checkout.pendingApprovalBody': text(
    'Your cart has not changed. Once approved, submit this order again.',
    'Ihr Warenkorb wurde nicht geändert. Reichen Sie diese Bestellung nach der Genehmigung erneut ein.',
    {
      CN: '您的购物车未更改。批准后请再次提交订单。',
      PL: 'Koszyk nie został zmieniony. Po zatwierdzeniu prześlij zamówienie ponownie.',
      ES: 'Tu carrito no ha cambiado. Vuelve a enviar este pedido cuando se apruebe.',
      FR: 'Votre panier n’a pas changé. Soumettez à nouveau cette commande après approbation.',
    },
  ),
  'checkout.viewApprovalRequests': text('View approval requests', 'Freigabeanfragen anzeigen', {
    CN: '查看审批请求',
    PL: 'Wyświetl wnioski o akceptację',
    ES: 'Ver solicitudes de aprobación',
    FR: 'Voir les demandes d’approbation',
  }),
  'checkout.approvalRejected': text(
    'This order request was rejected by an approver. Your cart has not changed.',
    'Diese Bestellanfrage wurde abgelehnt. Ihr Warenkorb wurde nicht geändert.',
    {
      CN: '审批人拒绝了此订单请求。您的购物车未更改。',
      PL: 'Wniosek o zamówienie został odrzucony. Koszyk nie został zmieniony.',
      ES: 'Un responsable ha rechazado esta solicitud de pedido. Tu carrito no ha cambiado.',
      FR: 'Cette demande de commande a été refusée. Votre panier n’a pas changé.',
    },
  ),
  'checkout.approvalExpired': text(
    'This approval has expired. Submit the order again to request a new approval.',
    'Diese Freigabe ist abgelaufen. Reichen Sie die Bestellung erneut ein, um eine neue Freigabe anzufordern.',
    {
      CN: '此审批已过期。请再次提交订单以申请新的审批。',
      PL: 'Ta akceptacja wygasła. Prześlij zamówienie ponownie, aby poprosić o nową akceptację.',
      ES: 'Esta aprobación ha caducado. Envía de nuevo el pedido para solicitar otra aprobación.',
      FR: 'Cette approbation a expiré. Soumettez à nouveau la commande pour en demander une nouvelle.',
    },
  ),
  'checkout.approvalTotalDrift': text(
    'The order total has changed since approval. Submit again to request approval for the current total.',
    'Die Bestellsumme hat sich seit der Freigabe geändert. Reichen Sie die Bestellung erneut ein, um die aktuelle Summe genehmigen zu lassen.',
    {
      CN: '订单总额自审批后发生变化。请再次提交以申请当前总额的审批。',
      PL: 'Suma zamówienia zmieniła się od czasu akceptacji. Prześlij ponownie, aby uzyskać akceptację bieżącej sumy.',
      ES: 'El total del pedido ha cambiado desde la aprobación. Vuelve a enviarlo para aprobar el total actual.',
      FR: 'Le total de la commande a changé depuis l’approbation. Soumettez-la de nouveau pour faire approuver le total actuel.',
    },
  ),

  'checkout.step.delivery': text('Delivery', 'Lieferung', {
    CN: '配送',
    PL: 'Dostawa',
    ES: 'Entrega',
    FR: 'Livraison',
  }),
  'checkout.step.schedule': text('Schedule and billing', 'Zeitplan und Abrechnung', {
    CN: '配送安排和账单',
    PL: 'Harmonogram i rozliczenie',
    ES: 'Programación y facturación',
    FR: 'Planification et facturation',
  }),
  'checkout.step.payment': text('Test card details', 'Testkartendaten', {
    CN: '测试卡信息',
    PL: 'Dane karty testowej',
    ES: 'Datos de tarjeta de prueba',
    FR: 'Détails de la carte de test',
  }),
  'checkout.stepLabel': text('Step {step} of 3', 'Schritt {step} von 3', {
    CN: '第 {step} 步，共 3 步',
    PL: 'Krok {step} z 3',
    ES: 'Paso {step} de 3',
    FR: 'Étape {step} sur 3',
  }),
  'checkout.fullName': text('Full name', 'Vollständiger Name', {
    CN: '姓名',
    PL: 'Imię i nazwisko',
    ES: 'Nombre completo',
    FR: 'Nom complet',
  }),
  'checkout.email': text('Email', 'E-Mail', {
    CN: '电子邮件',
    PL: 'E-mail',
    ES: 'Correo electrónico',
    FR: 'E-mail',
  }),
  'checkout.loadingDeliverySites': text(
    'Loading your delivery sites...',
    'Ihre Lieferstellen werden geladen ...',
    {
      CN: '正在加载配送地点……',
      PL: 'Ładowanie miejsc dostawy…',
      ES: 'Cargando tus lugares de entrega…',
      FR: 'Chargement de vos sites de livraison…',
    },
  ),
  'checkout.retryDeliverySites': text('Retry delivery sites', 'Lieferstellen erneut laden', {
    CN: '重试配送地点',
    PL: 'Ponów miejsca dostawy',
    ES: 'Reintentar lugares de entrega',
    FR: 'Réessayer les sites de livraison',
  }),
  'checkout.deliverySite': text('Delivery site', 'Lieferstelle', {
    CN: '配送地点',
    PL: 'Miejsce dostawy',
    ES: 'Lugar de entrega',
    FR: 'Site de livraison',
  }),
  'checkout.default': text('Default', 'Standard', {
    CN: '默认',
    PL: 'Domyślne',
    ES: 'Predeterminado',
    FR: 'Par défaut',
  }),
  'checkout.differentAddress': text(
    'Deliver to a different address',
    'An eine andere Adresse liefern',
    {
      CN: '配送到其他地址',
      PL: 'Dostarcz na inny adres',
      ES: 'Entregar en otra dirección',
      FR: 'Livrer à une autre adresse',
    },
  ),
  'checkout.deliveryAddress': text('Delivery address', 'Lieferadresse', {
    CN: '配送地址',
    PL: 'Adres dostawy',
    ES: 'Dirección de entrega',
    FR: 'Adresse de livraison',
  }),
  'checkout.continueSchedule': text('Continue to schedule', 'Weiter zum Zeitplan', {
    CN: '继续安排配送',
    PL: 'Przejdź do harmonogramu',
    ES: 'Continuar a la programación',
    FR: 'Continuer vers la planification',
  }),
  'checkout.deliverySlot': text('Delivery slot', 'Lieferzeitfenster', {
    CN: '配送时段',
    PL: 'Termin dostawy',
    ES: 'Horario de entrega',
    FR: 'Créneau de livraison',
  }),
  'checkout.loadingDeliverySlots': text(
    'Loading delivery slots...',
    'Lieferzeitfenster werden geladen ...',
    {
      CN: '正在加载配送时段……',
      PL: 'Ładowanie terminów dostawy…',
      ES: 'Cargando horarios de entrega…',
      FR: 'Chargement des créneaux de livraison…',
    },
  ),
  'checkout.retryDeliverySlots': text('Retry delivery slots', 'Lieferzeitfenster erneut laden', {
    CN: '重试配送时段',
    PL: 'Ponów terminy dostawy',
    ES: 'Reintentar horarios de entrega',
    FR: 'Réessayer les créneaux de livraison',
  }),
  'checkout.deliverySlotsUnavailable': text(
    'Delivery slots are unavailable.',
    'Lieferzeitfenster sind nicht verfügbar.',
    {
      CN: '配送时段不可用。',
      PL: 'Terminy dostawy są niedostępne.',
      ES: 'Los horarios de entrega no están disponibles.',
      FR: 'Les créneaux de livraison sont indisponibles.',
    },
  ),
  'checkout.noDeliverySlots': text(
    'No delivery slots are currently offered for this consignment.',
    'Für diese Sendung werden derzeit keine Lieferzeitfenster angeboten.',
    {
      CN: '目前没有为此货件提供配送时段。',
      PL: 'Dla tej przesyłki nie są obecnie oferowane żadne terminy dostawy.',
      ES: 'No se ofrecen horarios de entrega para este envío.',
      FR: 'Aucun créneau de livraison n’est actuellement proposé pour cet envoi.',
    },
  ),
  'checkout.freightReason': text(
    'Freight consignments need {days} business days before the earliest delivery date.',
    'Frachtlieferungen benötigen {days} Werktage bis zum frühesten Lieferdatum.',
    {
      CN: '货运在最早配送日期前需要 {days} 个工作日。',
      PL: 'Przesyłki frachtowe wymagają {days} dni roboczych do najwcześniejszego terminu dostawy.',
      ES: 'Los envíos de carga necesitan {days} días laborables antes de la primera fecha de entrega.',
      FR: 'Les envois de fret nécessitent {days} jours ouvrés avant la première date de livraison.',
    },
  ),
  'checkout.parcelReason': text(
    'Parcel consignments are available on the next offered delivery date.',
    'Paketsendungen sind am nächsten angebotenen Lieferdatum verfügbar.',
    {
      CN: '包裹货件可在下一个提供的配送日期配送。',
      PL: 'Przesyłki paczkowe są dostępne w najbliższym oferowanym terminie dostawy.',
      ES: 'Los envíos de paquetes están disponibles en la próxima fecha ofrecida.',
      FR: 'Les envois de colis sont disponibles à la prochaine date de livraison proposée.',
    },
  ),
  'checkout.billingDetails': text('Billing details', 'Abrechnungsdaten', {
    CN: '账单信息',
    PL: 'Dane rozliczeniowe',
    ES: 'Datos de facturación',
    FR: 'Détails de facturation',
  }),
  'checkout.loadingBilling': text(
    'Loading your billing accounts...',
    'Ihre Abrechnungskonten werden geladen ...',
    {
      CN: '正在加载您的账单账户……',
      PL: 'Ładowanie kont rozliczeniowych…',
      ES: 'Cargando tus cuentas de facturación…',
      FR: 'Chargement de vos comptes de facturation…',
    },
  ),
  'checkout.retryBilling': text('Retry billing accounts', 'Abrechnungskonten erneut laden', {
    CN: '重试账单账户',
    PL: 'Ponów konta rozliczeniowe',
    ES: 'Reintentar cuentas de facturación',
    FR: 'Réessayer les comptes de facturation',
  }),
  'checkout.differentBilling': text(
    'Bill a different entity',
    'Eine andere juristische Person abrechnen',
    {
      CN: '向其他实体开票',
      PL: 'Rozlicz inną jednostkę',
      ES: 'Facturar a otra entidad',
      FR: 'Facturer une autre entité',
    },
  ),
  'checkout.legalName': text('Legal entity name', 'Name der juristischen Person', {
    CN: '法定实体名称',
    PL: 'Nazwa podmiotu prawnego',
    ES: 'Nombre de la entidad legal',
    FR: 'Nom de l’entité juridique',
  }),
  'checkout.registrationNumber': text('Registration number', 'Registrierungsnummer', {
    CN: '注册号',
    PL: 'Numer rejestracyjny',
    ES: 'Número de registro',
    FR: 'Numéro d’immatriculation',
  }),
  'checkout.vatNumber': text('VAT number', 'USt-IdNr.', {
    CN: '增值税号',
    PL: 'Numer VAT',
    ES: 'Número de IVA',
    FR: 'Numéro de TVA',
  }),
  'checkout.optional': text('(optional)', '(optional)', {
    CN: '（可选）',
    PL: '(opcjonalnie)',
    ES: '(opcional)',
    FR: '(facultatif)',
  }),
  'checkout.billingAddress': text('Billing address', 'Rechnungsadresse', {
    CN: '账单地址',
    PL: 'Adres rozliczeniowy',
    ES: 'Dirección de facturación',
    FR: 'Adresse de facturation',
  }),
  'checkout.purchaseOrderReference': text('Purchase order reference', 'Bestellreferenz', {
    CN: '采购订单参考号',
    PL: 'Numer referencyjny zamówienia',
    ES: 'Referencia de orden de compra',
    FR: 'Référence du bon de commande',
  }),
  'checkout.backDelivery': text('Back to delivery', 'Zurück zur Lieferung', {
    CN: '返回配送',
    PL: 'Wróć do dostawy',
    ES: 'Volver a la entrega',
    FR: 'Retour à la livraison',
  }),
  'checkout.continuePayment': text('Continue to payment', 'Weiter zur Zahlung', {
    CN: '继续付款',
    PL: 'Przejdź do płatności',
    ES: 'Continuar al pago',
    FR: 'Continuer vers le paiement',
  }),
  'checkout.cardPageOnly': text(
    'Step 3 of 3. Card details stay in this page only.',
    'Schritt 3 von 3. Kartendaten bleiben nur auf dieser Seite.',
    {
      CN: '第 3 步，共 3 步。卡信息仅保留在此页面。',
      PL: 'Krok 3 z 3. Dane karty pozostają tylko na tej stronie.',
      ES: 'Paso 3 de 3. Los datos de la tarjeta solo permanecen en esta página.',
      FR: 'Étape 3 sur 3. Les données de carte restent sur cette page uniquement.',
    },
  ),
  'checkout.cardNumber': text('Card number', 'Kartennummer', {
    CN: '卡号',
    PL: 'Numer karty',
    ES: 'Número de tarjeta',
    FR: 'Numéro de carte',
  }),
  'checkout.expiry': text('Expiry (MM/YY)', 'Gültig bis (MM/JJ)', {
    CN: '有效期（MM/YY）',
    PL: 'Ważność (MM/RR)',
    ES: 'Caducidad (MM/AA)',
    FR: 'Expiration (MM/AA)',
  }),
  'checkout.cvc': text('CVC', 'CVC', { CN: 'CVC', PL: 'CVC', ES: 'CVC', FR: 'CVC' }),
  'checkout.backSchedule': text('Back to schedule', 'Zurück zum Zeitplan', {
    CN: '返回安排',
    PL: 'Wróć do harmonogramu',
    ES: 'Volver a la programación',
    FR: 'Retour à la planification',
  }),
  'checkout.processingPayment': text('Processing payment...', 'Zahlung wird verarbeitet ...', {
    CN: '正在处理付款……',
    PL: 'Przetwarzanie płatności…',
    ES: 'Procesando el pago…',
    FR: 'Traitement du paiement…',
  }),
  'checkout.simulatePayment': text('Simulate payment', 'Zahlung simulieren', {
    CN: '模拟付款',
    PL: 'Symuluj płatność',
    ES: 'Simular pago',
    FR: 'Simuler le paiement',
  }),

  'checkout.summary': text('Order summary', 'Bestellübersicht', {
    CN: '订单摘要',
    PL: 'Podsumowanie zamówienia',
    ES: 'Resumen del pedido',
    FR: 'Récapitulatif de commande',
  }),
  'checkout.deliverySiteSummary': text('Delivery site', 'Lieferstelle', {
    CN: '配送地点',
    PL: 'Miejsce dostawy',
    ES: 'Lugar de entrega',
    FR: 'Site de livraison',
  }),
  'checkout.deliverySlotSummary': text('Delivery slot', 'Lieferzeitfenster', {
    CN: '配送时段',
    PL: 'Termin dostawy',
    ES: 'Horario de entrega',
    FR: 'Créneau de livraison',
  }),
  'checkout.slotMorning': text('Morning', 'Vormittag', {
    CN: '上午',
    PL: 'Rano',
    ES: 'Mañana',
    FR: 'Matin',
  }),
  'checkout.slotAfternoon': text('Afternoon', 'Nachmittag', {
    CN: '下午',
    PL: 'Popołudnie',
    ES: 'Tarde',
    FR: 'Après-midi',
  }),
  'checkout.billedTo': text('Billed to', 'Rechnung an', {
    CN: '账单对象',
    PL: 'Obciążono',
    ES: 'Facturado a',
    FR: 'Facturé à',
  }),
  'checkout.sku': text('SKU', 'SKU', { CN: 'SKU', PL: 'SKU', ES: 'SKU', FR: 'SKU' }),
  'checkout.packPrice': text('Resolved pack price: {money}', 'Ermittelter Packungspreis: {money}', {
    CN: '已确定包装价格：{money}',
    PL: 'Ustalona cena opakowania: {money}',
    ES: 'Precio calculado del paquete: {money}',
    FR: 'Prix calculé du paquet : {money}',
  }),
  'checkout.perTonne': text('{money} / tonne', '{money} / Tonne', {
    CN: '{money} / 吨',
    PL: '{money} / tona',
    ES: '{money} / tonelada',
    FR: '{money} / tonne',
  }),
  'checkout.packWeight': text('{weight} pack', '{weight}-Packung', {
    CN: '{weight} 包',
    PL: 'opakowanie {weight}',
    ES: 'paquete de {weight}',
    FR: 'paquet de {weight}',
  }),
  'checkout.customBlend': text('Custom blend', 'Individuelle Mischung', {
    CN: '定制混合',
    PL: 'Mieszanka niestandardowa',
    ES: 'Mezcla personalizada',
    FR: 'Mélange personnalisé',
  }),
  'checkout.customBlend.resultFood': text('Food-grade blend', 'Lebensmittelgeeignete Mischung', {
    CN: '食品级混合',
    PL: 'Mieszanka przeznaczona do kontaktu z żywnością',
    ES: 'Mezcla apta para alimentos',
    FR: 'Mélange de qualité alimentaire',
  }),
  'checkout.customBlend.resultNonFood': text(
    'Non-food blend',
    'Nicht für Lebensmittel bestimmte Mischung',
    {
      CN: '非食品混合',
      PL: 'Mieszanka nieżywnościowa',
      ES: 'Mezcla no alimentaria',
      FR: 'Mélange non alimentaire',
    },
  ),
  'checkout.customBlend.notForConsumption': text(
    'Not for consumption',
    'Nicht zum Verzehr geeignet',
    {
      CN: '不可食用',
      PL: 'Nie do spożycia',
      ES: 'No apto para el consumo',
      FR: 'Ne pas consommer',
    },
  ),
  'checkout.customBlend.safetyWarning': text(
    'This blend contains a non-food material. Follow the handling guidance shown for the materials.',
    'Diese Mischung enthält ein nicht für Lebensmittel bestimmtes Material. Befolgen Sie die angezeigten Hinweise zum Umgang mit den Materialien.',
    {
      CN: '此混合物含有非食品材料。请遵循材料显示的处理指南。',
      PL: 'Ta mieszanka zawiera materiał nieżywnościowy. Postępuj zgodnie z podanymi zaleceniami dotyczącymi obchodzenia się z materiałami.',
      ES: 'Esta mezcla contiene un material no alimentario. Sigue las indicaciones de manipulación mostradas para los materiales.',
      FR: 'Ce mélange contient un matériau non alimentaire. Suivez les consignes de manipulation affichées pour les matériaux.',
    },
  ),
  'checkout.customBlend.componentRole': text(
    'Component role: {role}',
    'Rolle der Komponente: {role}',
    {
      CN: '成分角色：{role}',
      PL: 'Rola składnika: {role}',
      ES: 'Función del componente: {role}',
      FR: 'Rôle du composant : {role}',
    },
  ),
  'checkout.customBlend.componentBase': text('Base', 'Basis', {
    CN: '基础材料',
    PL: 'Baza',
    ES: 'Base',
    FR: 'Base',
  }),
  'checkout.customBlend.componentIngredient': text('Ingredient', 'Zutat', {
    CN: '成分',
    PL: 'Składnik',
    ES: 'Ingrediente',
    FR: 'Ingrédient',
  }),
  'checkout.customBlend.componentWeight': text(
    'Component weight: {weight}',
    'Gewicht der Komponente: {weight}',
    {
      CN: '成分重量：{weight}',
      PL: 'Masa składnika: {weight}',
      ES: 'Peso del componente: {weight}',
      FR: 'Poids du composant : {weight}',
    },
  ),
  'checkout.customBlend.componentSourcePrice': text(
    'Source price: {money} per sack',
    'Quellpreis: {money} pro Sack',
    {
      CN: '来源价格：每袋 {money}',
      PL: 'Cena źródłowa: {money} za worek',
      ES: 'Precio de origen: {money} por saco',
      FR: 'Prix source : {money} par sac',
    },
  ),
  'checkout.customBlend.componentClearance': text(
    'Clearance price applied: {money} per sack',
    'Ausverkaufspreis angewendet: {money} pro Sack',
    {
      CN: '已应用清仓价：每袋 {money}',
      PL: 'Zastosowano cenę wyprzedażową: {money} za worek',
      ES: 'Precio de liquidación aplicado: {money} por saco',
      FR: 'Prix de liquidation appliqué : {money} par sac',
    },
  ),
  'checkout.customBlend.componentTier': text(
    'Volume tier discount: {discountPct}% off',
    'Mengenrabatt: {discountPct}%',
    {
      CN: '数量等级折扣：优惠 {discountPct}%',
      PL: 'Rabat z progu ilościowego: {discountPct}%',
      ES: 'Descuento por volumen: {discountPct}%',
      FR: 'Remise par palier de volume : {discountPct} %',
    },
  ),
  'checkout.customBlend.componentNextTier': text(
    '{sacksToNextTier} sacks to the {minTonnes}-tonne tier ({discountPct}% off)',
    '{sacksToNextTier} Säcke bis zur {minTonnes}-Tonnen-Stufe ({discountPct}% Rabatt)',
    {
      CN: '距 {minTonnes} 吨等级还差 {sacksToNextTier} 袋（优惠 {discountPct}%）',
      PL: 'Do progu {minTonnes} ton brakuje {sacksToNextTier} worków ({discountPct}% rabatu)',
      ES: 'Faltan {sacksToNextTier} sacos para el nivel de {minTonnes} toneladas ({discountPct}% de descuento)',
      FR: '{sacksToNextTier} sacs avant le palier de {minTonnes} tonnes ({discountPct} % de remise)',
    },
  ),
  'checkout.customBlend.componentUnitContribution': text(
    'Unit contribution: {money}',
    'Einzelbeitrag: {money}',
    {
      CN: '单位贡献：{money}',
      PL: 'Wkład jednostkowy: {money}',
      ES: 'Contribución por unidad: {money}',
      FR: 'Contribution unitaire : {money}',
    },
  ),
  'checkout.customBlend.componentSubtotal': text(
    'Component subtotal: {money}',
    'Zwischensumme der Komponente: {money}',
    {
      CN: '成分小计：{money}',
      PL: 'Suma częściowa składnika: {money}',
      ES: 'Subtotal del componente: {money}',
      FR: 'Sous-total du composant : {money}',
    },
  ),
  'checkout.customBlend.materialUnitPrice': text(
    'Material price per sack: {money}',
    'Materialpreis pro Sack: {money}',
    {
      CN: '材料每袋价格：{money}',
      PL: 'Cena materiału za worek: {money}',
      ES: 'Precio del material por saco: {money}',
      FR: 'Prix du matériau par sac : {money}',
    },
  ),
  'checkout.customBlend.materialSubtotal': text(
    'Material total: {money}',
    'Materialsumme: {money}',
    {
      CN: '材料总额：{money}',
      PL: 'Suma materiałów: {money}',
      ES: 'Total de materiales: {money}',
      FR: 'Total des matériaux : {money}',
    },
  ),
  'checkout.customBlend.blendingFee': text('Blending fee: {money}', 'Mischgebühr: {money}', {
    CN: '混合费用：{money}',
    PL: 'Opłata za mieszanie: {money}',
    ES: 'Tarifa de mezcla: {money}',
    FR: 'Frais de mélange : {money}',
  }),
  'checkout.customBlend.lineTotal': text('Blend total: {money}', 'Mischungssumme: {money}', {
    CN: '混合总额：{money}',
    PL: 'Suma mieszanki: {money}',
    ES: 'Total de la mezcla: {money}',
    FR: 'Total du mélange : {money}',
  }),
  'checkout.customBlend.legacyFallback': text(
    'Pricing and safety details are unavailable for this historic blend.',
    'Preis- und Sicherheitsangaben für diese historische Mischung sind nicht verfügbar.',
    {
      CN: '此历史混合没有可用的价格和安全详情。',
      PL: 'Szczegóły ceny i bezpieczeństwa tej historycznej mieszanki są niedostępne.',
      ES: 'Los detalles de precio y seguridad de esta mezcla histórica no están disponibles.',
      FR: 'Les détails de prix et de sécurité de ce mélange historique sont indisponibles.',
    },
  ),
  'checkout.baseMaterial': text('Base material: {money}', 'Basismaterial: {money}', {
    CN: '基础材料：{money}',
    PL: 'Materiał bazowy: {money}',
    ES: 'Material base: {money}',
    FR: 'Matériau de base : {money}',
  }),
  'checkout.blendingFee': text('Blending fee: {money}', 'Mischgebühr: {money}', {
    CN: '混合费用：{money}',
    PL: 'Opłata za mieszanie: {money}',
    ES: 'Tarifa de mezcla: {money}',
    FR: 'Frais de mélange : {money}',
  }),
  'checkout.madeToOrder': text(
    'Made to order. Custom blends cannot be returned, but you can still cancel the order until it is dispatched.',
    'Auf Bestellung gefertigt. Individuelle Mischungen können nicht zurückgegeben werden; die Bestellung kann aber bis zum Versand storniert werden.',
    {
      CN: '按订单制作。定制混合物不可退货，但订单发货前仍可取消。',
      PL: 'Wykonywane na zamówienie. Mieszanek niestandardowych nie można zwrócić, ale zamówienie można anulować przed wysyłką.',
      ES: 'Fabricado bajo pedido. Las mezclas personalizadas no se pueden devolver, pero aún puedes cancelar el pedido antes del envío.',
      FR: 'Fabriqué sur commande. Les mélanges personnalisés ne sont pas retournables, mais vous pouvez annuler la commande avant son expédition.',
    },
  ),
  'checkout.materialSubtotal': text('Material subtotal', 'Zwischensumme Material', {
    CN: '材料小计',
    PL: 'Suma częściowa materiałów',
    ES: 'Subtotal de materiales',
    FR: 'Sous-total des matériaux',
  }),
  'checkout.blendingFees': text('Blending fees', 'Mischgebühren', {
    CN: '混合费用',
    PL: 'Opłaty za mieszanie',
    ES: 'Tarifas de mezcla',
    FR: 'Frais de mélange',
  }),
  'checkout.merchandiseSubtotal': text(
    'Resolved merchandise subtotal',
    'Ermittelte Warenzwischensumme',
    {
      CN: '已确定商品小计',
      PL: 'Ustalona suma częściowa towarów',
      ES: 'Subtotal calculado de productos',
      FR: 'Sous-total calculé des marchandises',
    },
  ),
  'checkout.eligibleSubtotal': text(
    'Eligible subtotal ({scope})',
    'Berechtigte Zwischensumme ({scope})',
    {
      CN: '符合条件的小计（{scope}）',
      PL: 'Kwalifikowana suma częściowa ({scope})',
      ES: 'Subtotal elegible ({scope})',
      FR: 'Sous-total éligible ({scope})',
    },
  ),
  'checkout.discount': text('Discount ({promo})', 'Rabatt ({promo})', {
    CN: '折扣（{promo}）',
    PL: 'Rabat ({promo})',
    ES: 'Descuento ({promo})',
    FR: 'Remise ({promo})',
  }),
  'checkout.discountPlain': text('Discount', 'Rabatt', {
    CN: '折扣',
    PL: 'Rabat',
    ES: 'Descuento',
    FR: 'Remise',
  }),
  'checkout.freightScheduled': text(
    'Pallet freight scheduled after order confirmation',
    'Palettenfracht wird nach Bestellbestätigung geplant',
    {
      CN: '订单确认后安排托盘货运',
      PL: 'Transport paletowy zostanie zaplanowany po potwierdzeniu zamówienia',
      ES: 'El transporte de palés se programará tras confirmar el pedido',
      FR: 'Le fret de palettes sera planifié après confirmation de la commande',
    },
  ),
  'checkout.parcelDelivery': text('Parcel delivery', 'Paketlieferung', {
    CN: '包裹配送',
    PL: 'Dostawa paczkowa',
    ES: 'Entrega de paquetes',
    FR: 'Livraison de colis',
  }),
  'checkout.free': text('Free', 'Kostenlos', {
    CN: '免费',
    PL: 'Bezpłatnie',
    ES: 'Gratis',
    FR: 'Gratuit',
  }),
  'checkout.totalWeight': text(
    'Total order weight: {weight}',
    'Gesamtgewicht der Bestellung: {weight}',
    {
      CN: '订单总重量：{weight}',
      PL: 'Łączna masa zamówienia: {weight}',
      ES: 'Peso total del pedido: {weight}',
      FR: 'Poids total de la commande : {weight}',
    },
  ),
  'checkout.total': text('Total', 'Gesamt', { CN: '总计', PL: 'Suma', ES: 'Total', FR: 'Total' }),
  'checkout.settlementTotal': text('GBP total: {money}', 'GBP-Gesamtsumme: {money}', {
    CN: '英镑总额：{money}',
    PL: 'Suma w GBP: {money}',
    ES: 'Total en GBP: {money}',
    FR: 'Total GBP : {money}',
  }),

  'checkout.promoLabel': text('Order promotion', 'Bestellaktion', {
    CN: '订单促销',
    PL: 'Promocja zamówienia',
    ES: 'Promoción del pedido',
    FR: 'Promotion de commande',
  }),
  'checkout.promoDescription': text(
    'SAVE10 takes 10% off when this cart contains at least {count} bags.',
    'SAVE10 gewährt 10 % Rabatt, wenn dieser Warenkorb mindestens {count} Säcke enthält.',
    {
      CN: '购物车至少包含 {count} 袋时，SAVE10 可减免 10%。',
      PL: 'SAVE10 daje 10% rabatu, gdy koszyk zawiera co najmniej {count} worków.',
      ES: 'SAVE10 aplica un 10 % de descuento cuando el carrito contiene al menos {count} sacos.',
      FR: 'SAVE10 offre 10 % de remise lorsque ce panier contient au moins {count} sacs.',
    },
  ),
  'checkout.promoEnter': text('Enter SAVE10', 'SAVE10 eingeben', {
    CN: '输入 SAVE10',
    PL: 'Wpisz SAVE10',
    ES: 'Introduce SAVE10',
    FR: 'Saisissez SAVE10',
  }),
  'checkout.promoUnlock': text(
    'Add {count} bags to unlock SAVE10',
    '{count} Säcke hinzufügen, um SAVE10 freizuschalten',
    {
      CN: '添加 {count} 袋以解锁 SAVE10',
      PL: 'Dodaj {count} worków, aby odblokować SAVE10',
      ES: 'Añade {count} sacos para desbloquear SAVE10',
      FR: 'Ajoutez {count} sacs pour débloquer SAVE10',
    },
  ),
  'checkout.checking': text('Checking...', 'Wird geprüft ...', {
    CN: '正在检查……',
    PL: 'Sprawdzanie…',
    ES: 'Comprobando…',
    FR: 'Vérification…',
  }),
  'checkout.apply': text('Apply', 'Anwenden', {
    CN: '应用',
    PL: 'Zastosuj',
    ES: 'Aplicar',
    FR: 'Appliquer',
  }),
  'checkout.applied': text('{promo} applied', '{promo} angewendet', {
    CN: '已应用 {promo}',
    PL: 'Zastosowano {promo}',
    ES: '{promo} aplicado',
    FR: '{promo} appliqué',
  }),
  'checkout.remove': text('Remove', 'Entfernen', {
    CN: '移除',
    PL: 'Usuń',
    ES: 'Eliminar',
    FR: 'Supprimer',
  }),
  'checkout.promoCategoryMismatch': text(
    'This promo does not apply to any items in your cart.',
    'Diese Aktion gilt für keinen Artikel in Ihrem Warenkorb.',
    {
      CN: '此促销不适用于购物车中的任何商品。',
      PL: 'Ta promocja nie dotyczy żadnych artykułów w koszyku.',
      ES: 'Esta promoción no se aplica a ningún artículo de tu carrito.',
      FR: 'Cette promotion ne s’applique à aucun article de votre panier.',
    },
  ),
  'checkout.promoError.invalid': text('Invalid promo code', 'Ungültiger Aktionscode', {
    CN: '促销代码无效',
    PL: 'Nieprawidłowy kod promocji',
    ES: 'Código promocional no válido',
    FR: 'Code promotionnel invalide',
  }),
  'checkout.promoError.generic': text(
    'Unable to validate this promo code. Try again.',
    'Dieser Aktionscode konnte nicht geprüft werden. Versuchen Sie es erneut.',
    {
      CN: '无法验证此促销代码。请重试。',
      PL: 'Nie można zweryfikować tego kodu promocji. Spróbuj ponownie.',
      ES: 'No se pudo validar este código promocional. Inténtalo de nuevo.',
      FR: 'Impossible de valider ce code promotionnel. Réessayez.',
    },
  ),
  'checkout.promoError.expired': text(
    'This promo code has expired.',
    'Dieser Aktionscode ist abgelaufen.',
    {
      CN: '此促销代码已过期。',
      PL: 'Ten kod promocji wygasł.',
      ES: 'Este código promocional ha caducado.',
      FR: 'Ce code promotionnel a expiré.',
    },
  ),
  'checkout.promoError.notStarted': text(
    'This promo code is not active yet.',
    'Dieser Aktionscode ist noch nicht aktiv.',
    {
      CN: '此促销代码尚未生效。',
      PL: 'Ten kod promocji nie jest jeszcze aktywny.',
      ES: 'Este código promocional aún no está activo.',
      FR: 'Ce code promotionnel n’est pas encore actif.',
    },
  ),
  'checkout.promoError.minItems': plural(
    {
      one: 'Add at least {count} bag to use this promo.',
      other: 'Add at least {count} bags to use this promo.',
    },
    {
      one: 'Fügen Sie mindestens {count} Sack hinzu, um diese Aktion zu nutzen.',
      other: 'Fügen Sie mindestens {count} Säcke hinzu, um diese Aktion zu nutzen.',
    },
    {
      CN: { other: '至少添加 {count} 袋才能使用此促销。' },
      PL: {
        one: 'Dodaj co najmniej {count} worek, aby użyć tej promocji.',
        few: 'Dodaj co najmniej {count} worki, aby użyć tej promocji.',
        many: 'Dodaj co najmniej {count} worków, aby użyć tej promocji.',
        other: 'Dodaj co najmniej {count} worka, aby użyć tej promocji.',
      },
      ES: {
        one: 'Añade al menos {count} saco para usar esta promoción.',
        other: 'Añade al menos {count} sacos para usar esta promoción.',
      },
      FR: {
        one: 'Ajoutez au moins {count} sac pour utiliser cette promotion.',
        other: 'Ajoutez au moins {count} sacs pour utiliser cette promotion.',
      },
    },
  ),
  'checkout.promoError.minSubtotal': text(
    'Add more eligible value to use this promo.',
    'Fügen Sie mehr berechtigten Warenwert hinzu, um diese Aktion zu nutzen.',
    {
      CN: '添加更多符合条件的金额才能使用此促销。',
      PL: 'Dodaj więcej kwalifikowanej wartości, aby użyć tej promocji.',
      ES: 'Añade más importe elegible para usar esta promoción.',
      FR: 'Ajoutez davantage de valeur éligible pour utiliser cette promotion.',
    },
  ),
  'checkout.promoError.minSubtotalAmount': text(
    'Add eligible value of at least {money} to use this promo.',
    'Fügen Sie mindestens {money} berechtigten Warenwert hinzu, um diese Aktion zu nutzen.',
    {
      CN: '添加至少 {money} 的符合条件金额才能使用此促销。',
      PL: 'Dodaj co najmniej {money} kwalifikowanej wartości, aby użyć tej promocji.',
      ES: 'Añade al menos {money} de importe elegible para usar esta promoción.',
      FR: 'Ajoutez au moins {money} de valeur éligible pour utiliser cette promotion.',
    },
  ),
  'checkout.promoError.usageLimit': text(
    'This promo code has reached its usage limit.',
    'Dieser Aktionscode hat sein Nutzungslimit erreicht.',
    {
      CN: '此促销代码已达到使用上限。',
      PL: 'Ten kod promocji osiągnął limit użycia.',
      ES: 'Este código promocional ha alcanzado su límite de uso.',
      FR: 'Ce code promotionnel a atteint sa limite d’utilisation.',
    },
  ),
  'checkout.promoError.authRequired': text(
    'Sign in to use this promo.',
    'Melden Sie sich an, um diese Aktion zu nutzen.',
    {
      CN: '登录后才能使用此促销。',
      PL: 'Zaloguj się, aby użyć tej promocji.',
      ES: 'Inicia sesión para usar esta promoción.',
      FR: 'Connectez-vous pour utiliser cette promotion.',
    },
  ),
  'checkout.cartRecovered': text(
    'Your previous cart was no longer available. A new cart is ready; review it before applying a promo.',
    'Ihr vorheriger Warenkorb ist nicht mehr verfügbar. Ein neuer Warenkorb ist bereit; prüfen Sie ihn vor der Anwendung einer Aktion.',
    {
      CN: '您之前的购物车已不可用。新购物车已准备好；应用促销前请先检查。',
      PL: 'Poprzedni koszyk jest już niedostępny. Nowy koszyk jest gotowy — sprawdź go przed zastosowaniem promocji.',
      ES: 'Tu carrito anterior ya no está disponible. Hay uno nuevo listo; revísalo antes de aplicar una promoción.',
      FR: 'Votre panier précédent n’est plus disponible. Un nouveau panier est prêt ; vérifiez-le avant d’appliquer une promotion.',
    },
  ),
  'checkout.cartRecoveryFailed': text(
    'Your previous cart was no longer available, and a replacement cart could not be prepared. Retry the cart to continue.',
    'Ihr vorheriger Warenkorb ist nicht mehr verfügbar und ein Ersatz konnte nicht erstellt werden. Versuchen Sie den Warenkorb erneut.',
    {
      CN: '您之前的购物车已不可用，且无法准备替代购物车。请重试购物车以继续。',
      PL: 'Poprzedni koszyk jest już niedostępny i nie udało się przygotować zastępczego. Ponów koszyk, aby kontynuować.',
      ES: 'Tu carrito anterior ya no está disponible y no se pudo preparar otro. Reintenta el carrito para continuar.',
      FR: 'Votre panier précédent n’est plus disponible et aucun remplacement n’a pu être préparé. Réessayez le panier pour continuer.',
    },
  ),

  'checkout.confirmed': text('Your order is confirmed.', 'Ihre Bestellung ist bestätigt.', {
    CN: '您的订单已确认。',
    PL: 'Twoje zamówienie zostało potwierdzone.',
    ES: 'Tu pedido está confirmado.',
    FR: 'Votre commande est confirmée.',
  }),
  'checkout.confirmedDescription': text(
    'QArefully Materials Exchange has recorded this simulated order. A receipt is in the Dev Mailbox.',
    'QArefully Materials Exchange hat diese simulierte Bestellung erfasst. Eine Quittung befindet sich im Dev Mailbox.',
    {
      CN: 'QArefully Materials Exchange 已记录此模拟订单。收据位于开发邮箱中。',
      PL: 'QArefully Materials Exchange zapisał to symulowane zamówienie. Potwierdzenie znajduje się w skrzynce deweloperskiej.',
      ES: 'QArefully Materials Exchange ha registrado este pedido simulado. Hay un recibo en el buzón de desarrollo.',
      FR: 'QArefully Materials Exchange a enregistré cette commande simulée. Un reçu se trouve dans la boîte de développement.',
    },
  ),
  'checkout.shopMore': text('Shop more materials', 'Weitere Materialien kaufen', {
    CN: '继续采购材料',
    PL: 'Kup więcej materiałów',
    ES: 'Comprar más materiales',
    FR: 'Acheter plus de matériaux',
  }),
  'checkout.orderReferenceMissing': text('Order reference is missing.', 'Bestellreferenz fehlt.', {
    CN: '缺少订单参考号。',
    PL: 'Brak numeru referencyjnego zamówienia.',
    ES: 'Falta la referencia del pedido.',
    FR: 'La référence de commande est manquante.',
  }),
  'checkout.orderNotFound': text('Order not found.', 'Bestellung nicht gefunden.', {
    CN: '找不到订单。',
    PL: 'Nie znaleziono zamówienia.',
    ES: 'No se encontró el pedido.',
    FR: 'Commande introuvable.',
  }),
  'checkout.loadOrderFailed': text(
    'Failed to load order',
    'Bestellung konnte nicht geladen werden',
    {
      CN: '加载订单失败',
      PL: 'Nie udało się załadować zamówienia',
      ES: 'No se pudo cargar el pedido',
      FR: 'Échec du chargement de la commande',
    },
  ),

  // Validation copy is keyed separately from API errors so state can remain code-oriented.
  'checkout.validation.nameRequired': text('Name is required', 'Name ist erforderlich', {
    CN: '姓名为必填项',
    PL: 'Imię i nazwisko jest wymagane',
    ES: 'El nombre es obligatorio',
    FR: 'Le nom est obligatoire',
  }),
  'checkout.validation.emailRequired': text('Email is required', 'E-Mail ist erforderlich', {
    CN: '电子邮件为必填项',
    PL: 'E-mail jest wymagany',
    ES: 'El correo electrónico es obligatorio',
    FR: 'L’e-mail est obligatoire',
  }),
  'checkout.validation.emailInvalid': text(
    'Enter a valid email',
    'Geben Sie eine gültige E-Mail-Adresse ein',
    {
      CN: '请输入有效的电子邮件',
      PL: 'Wpisz prawidłowy e-mail',
      ES: 'Introduce un correo electrónico válido',
      FR: 'Saisissez une adresse e-mail valide',
    },
  ),
  'checkout.validation.deliverySite': text(
    'Select a delivery site',
    'Wählen Sie eine Lieferstelle',
    {
      CN: '选择配送地点',
      PL: 'Wybierz miejsce dostawy',
      ES: 'Selecciona un lugar de entrega',
      FR: 'Sélectionnez un site de livraison',
    },
  ),
  'checkout.validation.deliverySlot': text(
    'Choose a delivery slot',
    'Wählen Sie ein Lieferzeitfenster',
    {
      CN: '选择配送时段',
      PL: 'Wybierz termin dostawy',
      ES: 'Elige un horario de entrega',
      FR: 'Choisissez un créneau de livraison',
    },
  ),
  'checkout.validation.deliverySlotGone': text(
    'That slot is no longer offered. Choose another.',
    'Dieses Zeitfenster wird nicht mehr angeboten. Wählen Sie ein anderes.',
    {
      CN: '该时段已不再提供。请选择其他时段。',
      PL: 'Ten termin nie jest już dostępny. Wybierz inny.',
      ES: 'Ese horario ya no está disponible. Elige otro.',
      FR: 'Ce créneau n’est plus proposé. Choisissez-en un autre.',
    },
  ),
  'checkout.validation.billingAccount': text(
    'Select a billing account',
    'Wählen Sie ein Abrechnungskonto',
    {
      CN: '选择账单账户',
      PL: 'Wybierz konto rozliczeniowe',
      ES: 'Selecciona una cuenta de facturación',
      FR: 'Sélectionnez un compte de facturation',
    },
  ),
  'checkout.validation.legalNameRequired': text(
    'Legal entity name is required',
    'Name der juristischen Person ist erforderlich',
    {
      CN: '法定实体名称为必填项',
      PL: 'Nazwa podmiotu prawnego jest wymagana',
      ES: 'El nombre de la entidad legal es obligatorio',
      FR: 'Le nom de l’entité juridique est obligatoire',
    },
  ),
  'checkout.validation.maxChars': text(
    '{label} must be {max} characters or fewer',
    '{label} darf höchstens {max} Zeichen enthalten',
    {
      CN: '{label} 必须不超过 {max} 个字符',
      PL: '{label} musi mieć najwyżej {max} znaków',
      ES: '{label} debe tener {max} caracteres o menos',
      FR: '{label} doit comporter {max} caractères ou moins',
    },
  ),
  'checkout.validation.noMarkup': text(
    '{label} cannot contain < or >',
    '{label} darf kein < oder > enthalten',
    {
      CN: '{label} 不能包含 < 或 >',
      PL: '{label} nie może zawierać < ani >',
      ES: '{label} no puede contener < ni >',
      FR: '{label} ne peut pas contenir < ou >',
    },
  ),
  'checkout.validation.cardNumber': text(
    'Enter a valid card number',
    'Geben Sie eine gültige Kartennummer ein',
    {
      CN: '请输入有效的卡号',
      PL: 'Wpisz prawidłowy numer karty',
      ES: 'Introduce un número de tarjeta válido',
      FR: 'Saisissez un numéro de carte valide',
    },
  ),
  'checkout.validation.cardExpiry': text(
    'Enter expiry as MM/YY',
    'Geben Sie das Ablaufdatum als MM/JJ ein',
    {
      CN: '请输入 MM/YY 格式的有效期',
      PL: 'Wpisz datę ważności jako MM/RR',
      ES: 'Introduce la caducidad como MM/AA',
      FR: 'Saisissez l’expiration au format MM/AA',
    },
  ),
  'checkout.validation.cardCvc': text('Enter a valid CVC', 'Geben Sie eine gültige CVC ein', {
    CN: '请输入有效的 CVC',
    PL: 'Wpisz prawidłowy kod CVC',
    ES: 'Introduce un CVC válido',
    FR: 'Saisissez un CVC valide',
  }),

  'checkout.paymentError.declined': text(
    'Payment was declined. Retry keeps this payment attempt safe; change payment details to start a new attempt.',
    'Die Zahlung wurde abgelehnt. Ein erneuter Versuch ist sicher; ändern Sie die Zahlungsdaten für einen neuen Versuch.',
    {
      CN: '付款被拒绝。重试可安全保留此次付款尝试；更改付款信息可开始新的尝试。',
      PL: 'Płatność została odrzucona. Ponowienie zachowuje bezpieczeństwo próby; zmień dane, aby rozpocząć nową.',
      ES: 'El pago fue rechazado. Reintentar mantiene segura esta operación; cambia los datos para iniciar otra.',
      FR: 'Le paiement a été refusé. Réessayer conserve cette tentative en sécurité ; modifiez les informations pour en démarrer une nouvelle.',
    },
  ),
  'checkout.paymentError.timeout': text(
    'Payment timed out. Retry keeps this payment attempt safe; change payment details to start a new attempt.',
    'Zeitüberschreitung bei der Zahlung. Ein erneuter Versuch ist sicher; ändern Sie die Zahlungsdaten für einen neuen Versuch.',
    {
      CN: '付款超时。重试可安全保留此次付款尝试；更改付款信息可开始新的尝试。',
      PL: 'Upłynął limit czasu płatności. Ponowienie zachowuje bezpieczeństwo próby; zmień dane, aby rozpocząć nową.',
      ES: 'Se agotó el tiempo de pago. Reintentar mantiene segura esta operación; cambia los datos para iniciar otra.',
      FR: 'Le paiement a expiré. Réessayer conserve cette tentative en sécurité ; modifiez les informations pour en démarrer une nouvelle.',
    },
  ),
  'checkout.paymentError.invalid': text(
    'Payment details are invalid. Check the card details and try again.',
    'Die Zahlungsdaten sind ungültig. Prüfen Sie die Kartendaten und versuchen Sie es erneut.',
    {
      CN: '付款信息无效。请检查卡信息后重试。',
      PL: 'Dane płatności są nieprawidłowe. Sprawdź dane karty i spróbuj ponownie.',
      ES: 'Los datos de pago no son válidos. Comprueba la tarjeta y vuelve a intentarlo.',
      FR: 'Les informations de paiement sont invalides. Vérifiez la carte et réessayez.',
    },
  ),
  'checkout.paymentError.generic': text(
    'Payment failed. Retry keeps this payment attempt safe; change payment details to start a new attempt.',
    'Zahlung fehlgeschlagen. Ein erneuter Versuch hält diesen Zahlungsversuch sicher; ändern Sie die Zahlungsdaten für einen neuen Versuch.',
    {
      CN: '付款失败。重试可安全保留此次付款尝试；更改付款信息可开始新的尝试。',
      PL: 'Płatność nie powiodła się. Ponowienie zachowuje bezpieczeństwo próby; zmień dane, aby rozpocząć nową.',
      ES: 'El pago ha fallado. Reintentar mantiene segura esta operación; cambia los datos para iniciar otra.',
      FR: 'Le paiement a échoué. Réessayer conserve cette tentative en sécurité ; modifiez les informations pour en démarrer une nouvelle.',
    },
  ),
  'checkout.error.deliveryCountry': text(
    'Your account cannot deliver to the selected country. Choose an available delivery country before retrying.',
    'Ihr Konto kann nicht in das ausgewählte Land liefern. Wählen Sie ein verfügbares Lieferland, bevor Sie es erneut versuchen.',
    {
      CN: '您的账户无法配送到所选国家/地区。请先选择可配送的国家/地区再重试。',
      PL: 'Twoje konto nie może dostarczać do wybranego kraju. Wybierz dostępny kraj dostawy przed ponowieniem.',
      ES: 'Tu cuenta no puede entregar en el país seleccionado. Elige un país disponible antes de reintentarlo.',
      FR: 'Votre compte ne peut pas livrer dans le pays sélectionné. Choisissez un pays disponible avant de réessayer.',
    },
  ),
  'checkout.error.network': text(
    'Unable to reach the shop server',
    'Shop-Server ist nicht erreichbar',
    {
      CN: '无法连接商店服务器',
      PL: 'Nie można połączyć się z serwerem sklepu',
      ES: 'No se puede contactar con el servidor de la tienda',
      FR: 'Impossible de joindre le serveur de la boutique',
    },
  ),
  'checkout.error.generic': text(
    'Payment failed. Retry keeps this payment attempt safe; change payment details to start a new attempt.',
    'Zahlung fehlgeschlagen. Ein erneuter Versuch hält diesen Zahlungsversuch sicher; ändern Sie die Zahlungsdaten für einen neuen Versuch.',
    {
      CN: '付款失败。重试可安全保留此次付款尝试；更改付款信息可开始新的尝试。',
      PL: 'Płatność nie powiodła się. Ponowienie zachowuje bezpieczeństwo próby; zmień dane, aby rozpocząć nową.',
      ES: 'El pago ha fallado. Reintentar mantiene segura esta operación; cambia los datos para iniciar otra.',
      FR: 'Le paiement a échoué. Réessayer conserve cette tentative en sécurité ; modifiez les informations pour en démarrer une nouvelle.',
    },
  ),

  // Payment method and trade-credit eligibility. Amounts in these messages are rendered by the
  // caller; the GBP qualifier keeps the authoritative settlement currency distinct from display.
  'checkout.paymentMethod.heading': text('Payment method', 'Zahlungsart', {
    CN: '付款方式',
    PL: 'Metoda płatności',
    ES: 'Método de pago',
    FR: 'Mode de paiement',
  }),
  'checkout.paymentMethod.card': text('Card', 'Karte', {
    CN: '银行卡',
    PL: 'Karta',
    ES: 'Tarjeta',
    FR: 'Carte',
  }),
  'checkout.paymentMethod.cardDescription': text(
    'Pay now with a simulated card',
    'Jetzt mit einer simulierten Karte bezahlen',
    {
      CN: '使用模拟银行卡立即付款',
      PL: 'Zapłać teraz za pomocą symulowanej karty',
      ES: 'Paga ahora con una tarjeta simulada',
      FR: 'Payez maintenant avec une carte simulée',
    },
  ),
  'checkout.paymentMethod.tradeCredit': text('Trade credit', 'Kauf auf Rechnung', {
    CN: '贸易赊账',
    PL: 'Kredyt kupiecki',
    ES: 'Crédito comercial',
    FR: 'Crédit commercial',
  }),
  'checkout.paymentMethod.tradeCreditDescription': text(
    'Invoice your company in GBP on net-30 terms',
    'Ihre Firma erhält eine GBP-Rechnung mit Zahlungsziel 30 Tage',
    {
      CN: '以英镑开具公司发票，账期为 30 天',
      PL: 'Otrzymaj fakturę dla firmy w GBP z terminem 30 dni',
      ES: 'Recibe una factura para tu empresa en GBP con vencimiento a 30 días',
      FR: 'Recevez une facture d’entreprise en GBP payable sous 30 jours',
    },
  ),
  'checkout.paymentMethod.tradeCreditTerms': text('Net 30 terms', 'Zahlungsziel 30 Tage netto', {
    CN: '30 天净额账期',
    PL: 'Termin płatności netto 30 dni',
    ES: 'Condiciones neto a 30 días',
    FR: 'Conditions nettes à 30 jours',
  }),
  'checkout.paymentMethod.tradeCreditDue': text(
    'Due 30 days after the invoice is issued',
    'Fällig 30 Tage nach Ausstellung der Rechnung',
    {
      CN: '发票开具后 30 天到期',
      PL: 'Płatność wymagana 30 dni po wystawieniu faktury',
      ES: 'Vence 30 días después de emitir la factura',
      FR: 'Échéance 30 jours après l’émission de la facture',
    },
  ),
  'checkout.paymentMethod.tradeCreditDueOn': text('Due on {date}', 'Fällig am {date}', {
    CN: '到期日：{date}',
    PL: 'Termin płatności: {date}',
    ES: 'Vence el {date}',
    FR: 'Échéance le {date}',
  }),
  'checkout.paymentMethod.tradeCreditAvailable': text(
    'Available credit (GBP): {money}',
    'Verfügbarer Kredit (GBP): {money}',
    {
      CN: '可用信用额度（GBP）：{money}',
      PL: 'Dostępny kredyt (GBP): {money}',
      ES: 'Crédito disponible (GBP): {money}',
      FR: 'Crédit disponible (GBP) : {money}',
    },
  ),
  'checkout.paymentMethod.tradeCreditUnavailable': text(
    'Trade credit is unavailable for this order.',
    'Kauf auf Rechnung ist für diese Bestellung nicht verfügbar.',
    {
      CN: '此订单无法使用贸易赊账。',
      PL: 'Kredyt kupiecki jest niedostępny dla tego zamówienia.',
      ES: 'El crédito comercial no está disponible para este pedido.',
      FR: 'Le crédit commercial n’est pas disponible pour cette commande.',
    },
  ),
  'checkout.paymentMethod.tradeCreditIneligible': text(
    'Trade credit is not available for your company account.',
    'Kauf auf Rechnung ist für Ihr Firmenkonto nicht verfügbar.',
    {
      CN: '您的公司账户无法使用贸易赊账。',
      PL: 'Kredyt kupiecki nie jest dostępny dla Twojego konta firmowego.',
      ES: 'El crédito comercial no está disponible para tu cuenta de empresa.',
      FR: 'Le crédit commercial n’est pas disponible pour votre compte d’entreprise.',
    },
  ),
  'checkout.paymentMethod.tradeCreditOnHold': text(
    'Trade credit is on hold. Choose card payment or contact your account administrator.',
    'Kauf auf Rechnung ist vorübergehend gesperrt. Wählen Sie Kartenzahlung oder wenden Sie sich an Ihre Kontoverwaltung.',
    {
      CN: '贸易赊账已暂停。请选择银行卡付款或联系账户管理员。',
      PL: 'Kredyt kupiecki jest wstrzymany. Wybierz płatność kartą lub skontaktuj się z administratorem konta.',
      ES: 'El crédito comercial está retenido. Elige pagar con tarjeta o contacta con el administrador de tu cuenta.',
      FR: 'Le crédit commercial est suspendu. Choisissez le paiement par carte ou contactez l’administrateur du compte.',
    },
  ),
  'checkout.paymentMethod.tradeCreditSuspended': text(
    'Trade credit is suspended. Choose card payment or contact your account administrator.',
    'Kauf auf Rechnung ist ausgesetzt. Wählen Sie Kartenzahlung oder wenden Sie sich an Ihre Kontoverwaltung.',
    {
      CN: '贸易赊账已停用。请选择银行卡付款或联系账户管理员。',
      PL: 'Kredyt kupiecki jest zawieszony. Wybierz płatność kartą lub skontaktuj się z administratorem konta.',
      ES: 'El crédito comercial está suspendido. Elige pagar con tarjeta o contacta con el administrador de tu cuenta.',
      FR: 'Le crédit commercial est désactivé. Choisissez le paiement par carte ou contactez l’administrateur du compte.',
    },
  ),
  'checkout.paymentMethod.tradeCreditLoading': text(
    'Checking trade-credit availability…',
    'Verfügbarkeit des Kaufs auf Rechnung wird geprüft …',
    {
      CN: '正在检查贸易赊账可用性……',
      PL: 'Sprawdzanie dostępności kredytu kupieckiego…',
      ES: 'Comprobando la disponibilidad del crédito comercial…',
      FR: 'Vérification de la disponibilité du crédit commercial…',
    },
  ),
  'checkout.paymentMethod.tradeCreditLoadError': text(
    'Trade-credit availability could not be loaded.',
    'Die Verfügbarkeit des Kaufs auf Rechnung konnte nicht geladen werden.',
    {
      CN: '无法加载贸易赊账可用性。',
      PL: 'Nie można załadować dostępności kredytu kupieckiego.',
      ES: 'No se pudo cargar la disponibilidad del crédito comercial.',
      FR: 'Impossible de charger la disponibilité du crédit commercial.',
    },
  ),
  'checkout.paymentMethod.retryTradeCredit': text(
    'Retry trade-credit check',
    'Prüfung des Kaufs auf Rechnung wiederholen',
    {
      CN: '重试贸易赊账检查',
      PL: 'Ponów sprawdzanie kredytu kupieckiego',
      ES: 'Reintentar comprobación del crédito comercial',
      FR: 'Réessayer la vérification du crédit commercial',
    },
  ),
  'checkout.paymentMethod.tradeCreditNotice': text(
    'No card payment will be taken. Your company will be invoiced in GBP.',
    'Es wird keine Kartenzahlung vorgenommen. Ihre Firma erhält eine Rechnung in GBP.',
    {
      CN: '不会收取银行卡款项。您的公司将收到 GBP 发票。',
      PL: 'Płatność kartą nie zostanie pobrana. Twoja firma otrzyma fakturę w GBP.',
      ES: 'No se cobrará la tarjeta. Tu empresa recibirá una factura en GBP.',
      FR: 'Aucun paiement par carte ne sera prélevé. Votre entreprise recevra une facture en GBP.',
    },
  ),
  'checkout.creditSummary': text('Company credit summary', 'Kreditübersicht des Unternehmens', {
    CN: '公司信用额度摘要',
    PL: 'Podsumowanie kredytu firmy',
    ES: 'Resumen del crédito de la empresa',
    FR: 'Résumé du crédit de l’entreprise',
  }),
  'checkout.creditState.active': text('Active', 'Aktiv', {
    CN: '启用',
    PL: 'Aktywne',
    ES: 'Activo',
    FR: 'Actif',
  }),
  'checkout.creditState.on_hold': text('On hold', 'Vorübergehend gesperrt', {
    CN: '暂停',
    PL: 'Wstrzymane',
    ES: 'Retenido',
    FR: 'Suspendu',
  }),
  'checkout.creditState.suspended': text('Suspended', 'Ausgesetzt', {
    CN: '停用',
    PL: 'Zawieszony',
    ES: 'Suspendido',
    FR: 'Désactivé',
  }),
  'checkout.credit.limit': text('Credit limit (GBP): {money}', 'Kreditlimit (GBP): {money}', {
    CN: '信用额度上限（GBP）：{money}',
    PL: 'Limit kredytowy (GBP): {money}',
    ES: 'Límite de crédito (GBP): {money}',
    FR: 'Limite de crédit (GBP) : {money}',
  }),
  'checkout.credit.outstanding': text(
    'Outstanding invoices (GBP): {money}',
    'Offene Rechnungen (GBP): {money}',
    {
      CN: '未结发票（GBP）：{money}',
      PL: 'Niezapłacone faktury (GBP): {money}',
      ES: 'Facturas pendientes (GBP): {money}',
      FR: 'Factures impayées (GBP) : {money}',
    },
  ),
  'checkout.credit.held': text(
    'Held for checkout (GBP): {money}',
    'Für den Checkout zurückgehalten (GBP): {money}',
    {
      CN: '结账预留（GBP）：{money}',
      PL: 'Zarezerwowane przy kasie (GBP): {money}',
      ES: 'Retenido para el pago (GBP): {money}',
      FR: 'Réservé pour le paiement (GBP) : {money}',
    },
  ),
  'checkout.credit.exposure': text('Total exposure (GBP): {money}', 'Gesamtrisiko (GBP): {money}', {
    CN: '总风险敞口（GBP）：{money}',
    PL: 'Łączna ekspozycja (GBP): {money}',
    ES: 'Exposición total (GBP): {money}',
    FR: 'Exposition totale (GBP) : {money}',
  }),
  'checkout.credit.available': text(
    'Available credit (GBP): {money}',
    'Verfügbarer Kredit (GBP): {money}',
    {
      CN: '可用信用额度（GBP）：{money}',
      PL: 'Dostępny kredyt (GBP): {money}',
      ES: 'Crédito disponible (GBP): {money}',
      FR: 'Crédit disponible (GBP) : {money}',
    },
  ),
  'checkout.credit.reason': text('Account note: {reason}', 'Kontonotiz: {reason}', {
    CN: '账户备注：{reason}',
    PL: 'Uwagi do konta: {reason}',
    ES: 'Nota de la cuenta: {reason}',
    FR: 'Note du compte : {reason}',
  }),
  'checkout.credit.retry': text('Retry credit payment', 'Zahlung auf Rechnung wiederholen', {
    CN: '重试信用付款',
    PL: 'Ponów płatność kredytową',
    ES: 'Reintentar pago a crédito',
    FR: 'Réessayer le paiement à crédit',
  }),
  'checkout.credit.error': text(
    'Trade-credit payment could not be completed. Try again or choose card payment.',
    'Die Zahlung per Kauf auf Rechnung konnte nicht abgeschlossen werden. Versuchen Sie es erneut oder wählen Sie Kartenzahlung.',
    {
      CN: '贸易赊账付款无法完成。请重试或选择银行卡付款。',
      PL: 'Nie można ukończyć płatności kredytem kupieckim. Spróbuj ponownie lub wybierz płatność kartą.',
      ES: 'No se pudo completar el pago con crédito comercial. Inténtalo de nuevo o elige pagar con tarjeta.',
      FR: 'Le paiement par crédit commercial n’a pas pu être terminé. Réessayez ou choisissez le paiement par carte.',
    },
  ),
  'checkout.credit.error.limitExceeded': text(
    'This order exceeds the available company credit. Choose card payment or reduce the order.',
    'Diese Bestellung überschreitet den verfügbaren Firmenkredit. Wählen Sie Kartenzahlung oder reduzieren Sie die Bestellung.',
    {
      CN: '此订单超出公司的可用信用额度。请选择银行卡付款或减少订单数量。',
      PL: 'To zamówienie przekracza dostępny kredyt firmy. Wybierz płatność kartą lub zmniejsz zamówienie.',
      ES: 'Este pedido supera el crédito disponible de la empresa. Elige pagar con tarjeta o reduce el pedido.',
      FR: 'Cette commande dépasse le crédit disponible de l’entreprise. Choisissez le paiement par carte ou réduisez la commande.',
    },
  ),
  'checkout.credit.error.onHold': text(
    'Trade credit is on hold. Choose card payment or try again later.',
    'Kauf auf Rechnung ist vorübergehend gesperrt. Wählen Sie Kartenzahlung oder versuchen Sie es später erneut.',
    {
      CN: '贸易赊账已暂停。请选择银行卡付款或稍后重试。',
      PL: 'Kredyt kupiecki jest wstrzymany. Wybierz płatność kartą lub spróbuj ponownie później.',
      ES: 'El crédito comercial está retenido. Elige pagar con tarjeta o inténtalo más tarde.',
      FR: 'Le crédit commercial est suspendu. Choisissez le paiement par carte ou réessayez plus tard.',
    },
  ),
  'checkout.credit.error.suspended': text(
    'Trade credit is suspended. Choose card payment or contact your account administrator.',
    'Kauf auf Rechnung ist ausgesetzt. Wählen Sie Kartenzahlung oder wenden Sie sich an Ihre Kontoverwaltung.',
    {
      CN: '贸易赊账已停用。请选择银行卡付款或联系账户管理员。',
      PL: 'Kredyt kupiecki jest zawieszony. Wybierz płatność kartą lub skontaktuj się z administratorem konta.',
      ES: 'El crédito comercial está suspendido. Elige pagar con tarjeta o contacta con el administrador de tu cuenta.',
      FR: 'Le crédit commercial est désactivé. Choisissez le paiement par carte ou contactez l’administrateur du compte.',
    },
  ),
});

export const CHECKOUT_MESSAGES = checkoutMessages;
