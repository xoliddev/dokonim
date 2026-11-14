/**
 * Bot copy catalog (§15). Every key has uz (Latin, canonical oʻ/gʻ = U+02BB, tutuq ʼ = U+02BC), ru and en.
 * Templates are trusted Telegram-HTML; `{name}` placeholders are filled by `t()` (plain) or `tHtml()` (escaped).
 * Pure module: no grammY import, safe to bundle into the browser demo.
 */
import type { Locale, OrderStatus, ProviderId } from '@dokonim/core';
import type { OrderCallbackAction } from '@dokonim/core';
import { escapeHtml } from './html';

type Entry = Record<Locale, string>;

export const messages = {
  // ── /start, /help, /paysupport ──────────────────────────────────────────
  'start.hub': {
    uz: '<b>Doʻkonim</b> — Telegram ichidagi doʻkonlar.\n\nXarid qiling yoki 3 daqiqada oʻz doʻkoningizni oching.',
    ru: '<b>Doʻkonim</b> — магазины прямо в Telegram.\n\nПокупайте или откройте свой магазин за 3 минуты.',
    en: '<b>Doʻkonim</b> — shops right inside Telegram.\n\nShop, or open your own store in 3 minutes.',
  },
  'start.store': {
    uz: 'Doʻkonni ochish uchun tugmani bosing.',
    ru: 'Нажмите кнопку, чтобы открыть магазин.',
    en: 'Tap the button to open the store.',
  },
  'start.product': {
    uz: 'Mahsulotni koʻrish uchun tugmani bosing.',
    ru: 'Нажмите кнопку, чтобы посмотреть товар.',
    en: 'Tap the button to see the product.',
  },
  'start.order': {
    uz: 'Buyurtma holatini koʻrish uchun tugmani bosing.',
    ru: 'Нажмите кнопку, чтобы посмотреть статус заказа.',
    en: 'Tap the button to track your order.',
  },
  'start.manage': {
    uz: 'Doʻkon boshqaruvini ochish uchun tugmani bosing.',
    ru: 'Нажмите кнопку, чтобы открыть управление магазином.',
    en: 'Tap the button to open your store dashboard.',
  },
  'start.new': {
    uz: 'Oʻz doʻkoningizni oching: nom, mahsulotlar va toʻlov — 3 daqiqada.',
    ru: 'Откройте свой магазин: название, товары и оплата — за 3 минуты.',
    en: 'Open your store: name, products and payments — in 3 minutes.',
  },
  help: {
    uz: '<b>Yordam</b>\n\n/start — doʻkonlarni ochish\n/paysupport — toʻlov boʻyicha yordam\n/help — shu xabar\n\nMahsulotni ulashish: istalgan chatda <code>@{bot} doʻkon soʻz</code> deb yozing.\nOʻz doʻkoningizni ochish: /start → «Doʻkon yaratish».',
    ru: '<b>Помощь</b>\n\n/start — открыть магазины\n/paysupport — помощь с оплатой\n/help — это сообщение\n\nПоделиться товаром: в любом чате напишите <code>@{bot} магазин запрос</code>.\nОткрыть свой магазин: /start → «Создать магазин».',
    en: '<b>Help</b>\n\n/start — open shops\n/paysupport — payment help\n/help — this message\n\nShare a product: in any chat type <code>@{bot} store query</code>.\nOpen your own store: /start → “Create store”.',
  },
  paysupport: {
    uz: '<b>Toʻlov boʻyicha yordam</b>\n\nBuyurtma raqamini va nima boʻlganini shu chatga yozing — 24 soat ichida javob beramiz.\nPulni qaytarish doʻkon qoidalari boʻyicha qilinadi. Telegram Stars bilan toʻlangan raqamli tovarlar uchun ham shu yerga yozing.',
    ru: '<b>Помощь с оплатой</b>\n\nНапишите в этот чат номер заказа и что случилось — ответим в течение 24 часов.\nВозврат денег — по правилам магазина. По цифровым товарам, оплаченным Telegram Stars, тоже пишите сюда.',
    en: '<b>Payment help</b>\n\nSend the order number and what happened to this chat — we reply within 24 hours.\nRefunds follow the shop’s policy. Write here about digital goods paid with Telegram Stars too.',
  },

  // ── Buttons (plain text, not HTML) ─────────────────────────────────────
  'btn.openStore': { uz: 'Doʻkonni ochish', ru: 'Открыть магазин', en: 'Open store' },
  'btn.createStore': { uz: 'Doʻkon yaratish', ru: 'Создать магазин', en: 'Create store' },
  'btn.openProduct': { uz: 'Mahsulotni ochish', ru: 'Открыть товар', en: 'Open product' },
  'btn.openOrder': { uz: 'Buyurtmani ochish', ru: 'Открыть заказ', en: 'Open order' },
  'btn.openDashboard': { uz: 'Boshqaruvni ochish', ru: 'Открыть управление', en: 'Open dashboard' },
  'btn.open': { uz: 'Ochish', ru: 'Открыть', en: 'Open' },
  'btn.call': { uz: '📞 Qoʻngʻiroq', ru: '📞 Позвонить', en: '📞 Call' },
  'btn.reply': { uz: 'Javob berish', ru: 'Ответить', en: 'Reply' },
  'btn.review': { uz: '⭐ Sharh qoldirish', ru: '⭐ Оставить отзыв', en: '⭐ Leave a review' },
  'btn.share': { uz: 'Doʻkonni ulashish', ru: 'Поделиться магазином', en: 'Share store' },
  'btn.team': { uz: 'Jamoani ochish', ru: 'Открыть команду', en: 'Open team' },
  'btn.products': { uz: 'Mahsulotlarni ochish', ru: 'Открыть товары', en: 'Open products' },
  'btn.pay': { uz: 'Toʻlash', ru: 'Оплатить', en: 'Pay' },

  // ── Staff order actions (callback buttons) ─────────────────────────────
  'action.confirm': { uz: '✅ Tasdiqlash', ru: '✅ Подтвердить', en: '✅ Confirm' },
  'action.pack': { uz: '📦 Yigʻish', ru: '📦 Собрать', en: '📦 Pack' },
  'action.ship': { uz: '🚚 Joʻnatish', ru: '🚚 Отправить', en: '🚚 Ship' },
  'action.ready': { uz: '🏬 Olib ketishga tayyor', ru: '🏬 Готов к выдаче', en: '🏬 Ready for pickup' },
  'action.deliver': { uz: '✅ Topshirildi', ru: '✅ Вручён', en: '✅ Delivered' },
  'action.cancel': { uz: '❌ Bekor qilish', ru: '❌ Отменить', en: '❌ Cancel' },

  // ── Order summary pieces ───────────────────────────────────────────────
  'label.total': { uz: 'Jami', ru: 'Итого', en: 'Total' },
  'label.buyer': { uz: 'Xaridor', ru: 'Покупатель', en: 'Buyer' },
  'label.payment': { uz: 'Toʻlov', ru: 'Оплата', en: 'Payment' },
  'label.delivery': { uz: 'Yetkazish', ru: 'Доставка', en: 'Delivery' },
  'label.pickup': { uz: 'Olib ketish', ru: 'Самовывоз', en: 'Pickup' },
  'label.tracking': { uz: 'Trek raqami', ru: 'Трек-номер', en: 'Tracking number' },
  'label.status': { uz: 'Holat', ru: 'Статус', en: 'Status' },
  'label.reason': { uz: 'Sabab', ru: 'Причина', en: 'Reason' },
  'label.role': { uz: 'Rol', ru: 'Роль', en: 'Role' },
  'label.dateTbd': { uz: 'sana kelishiladi', ru: 'дата по договорённости', en: 'date to be agreed' },
  'label.noPhone': { uz: 'raqam yoʻq', ru: 'без номера', en: 'no phone' },
  'items.more': { uz: '… va yana {n} ta', ru: '… и ещё {n}', en: '… and {n} more' },

  // ── order.placed ───────────────────────────────────────────────────────
  'order.new.owner': {
    uz: '🛒 <b>Yangi buyurtma #{number}</b> · {store}',
    ru: '🛒 <b>Новый заказ №{number}</b> · {store}',
    en: '🛒 <b>New order #{number}</b> · {store}',
  },
  'order.awaitingPayment.owner': {
    uz: 'Toʻlov kutilmoqda.',
    ru: 'Ждём оплату.',
    en: 'Waiting for payment.',
  },
  'order.new.buyer': {
    uz: '✅ <b>Buyurtma #{number} qabul qilindi</b> · {store}',
    ru: '✅ <b>Заказ №{number} принят</b> · {store}',
    en: '✅ <b>Order #{number} received</b> · {store}',
  },
  'order.new.buyer.wait': {
    uz: 'Doʻkon tasdiqlashi bilan xabar beramiz.',
    ru: 'Сообщим, когда магазин подтвердит заказ.',
    en: 'We will tell you when the shop confirms it.',
  },
  'order.new.buyer.pay': {
    uz: 'Buyurtmani oching va toʻlovni yakunlang.',
    ru: 'Откройте заказ и завершите оплату.',
    en: 'Open the order to finish paying.',
  },

  // ── order.paid ─────────────────────────────────────────────────────────
  'order.paid.owner': {
    uz: '💰 <b>Toʻlov qabul qilindi</b> · #{number} · {store}',
    ru: '💰 <b>Оплата получена</b> · №{number} · {store}',
    en: '💰 <b>Payment received</b> · #{number} · {store}',
  },
  'order.paid.owner.next': {
    uz: 'Buyurtmani tasdiqlang va tayyorlashni boshlang.',
    ru: 'Подтвердите заказ и начните сборку.',
    en: 'Confirm the order and start preparing it.',
  },
  'order.paid.buyer': {
    uz: '✅ <b>Toʻlov qabul qilindi</b> · #{number} · {store}',
    ru: '✅ <b>Оплата получена</b> · №{number} · {store}',
    en: '✅ <b>Payment received</b> · #{number} · {store}',
  },
  'order.paid.buyer.next': {
    uz: 'Doʻkon buyurtmangizni tayyorlashni boshlaydi.',
    ru: 'Магазин начнёт готовить ваш заказ.',
    en: 'The shop will start preparing your order.',
  },

  // ── order.status_changed (buyer) ───────────────────────────────────────
  'status.buyer.confirmed': {
    uz: '👍 <b>Buyurtma #{number} tasdiqlandi</b> · {store}\nDoʻkon uni tayyorlamoqda.',
    ru: '👍 <b>Заказ №{number} подтверждён</b> · {store}\nМагазин готовит его.',
    en: '👍 <b>Order #{number} confirmed</b> · {store}\nThe shop is preparing it.',
  },
  'status.buyer.packing': {
    uz: '📦 <b>Buyurtma #{number} yigʻilmoqda</b> · {store}',
    ru: '📦 <b>Заказ №{number} собирается</b> · {store}',
    en: '📦 <b>Order #{number} is being packed</b> · {store}',
  },
  'status.buyer.shipped': {
    uz: '🚚 <b>Buyurtma #{number} joʻnatildi</b> · {store}',
    ru: '🚚 <b>Заказ №{number} отправлен</b> · {store}',
    en: '🚚 <b>Order #{number} is on its way</b> · {store}',
  },
  'status.buyer.ready': {
    uz: '🏬 <b>Buyurtma #{number} olib ketishga tayyor</b> · {store}',
    ru: '🏬 <b>Заказ №{number} готов к выдаче</b> · {store}',
    en: '🏬 <b>Order #{number} is ready for pickup</b> · {store}',
  },
  'status.buyer.pickupCode': {
    uz: 'Olish kodi: <b>{code}</b>\nKodni doʻkonda ayting.',
    ru: 'Код получения: <b>{code}</b>\nНазовите его в магазине.',
    en: 'Pickup code: <b>{code}</b>\nShow it at the shop.',
  },
  'status.buyer.delivered': {
    uz: '✅ <b>Buyurtma #{number} topshirildi</b> · {store}\nXarid yoqdimi? Sharh qoldiring — boshqa xaridorlarga yordam beradi.',
    ru: '✅ <b>Заказ №{number} доставлен</b> · {store}\nКак вам покупка? Оставьте отзыв — он поможет другим покупателям.',
    en: '✅ <b>Order #{number} delivered</b> · {store}\nHow was it? Leave a review — it helps other buyers.',
  },
  'status.buyer.completed': {
    uz: '🎉 <b>Buyurtma #{number} yakunlandi</b> · {store}\nXaridingiz uchun rahmat!',
    ru: '🎉 <b>Заказ №{number} завершён</b> · {store}\nСпасибо за покупку!',
    en: '🎉 <b>Order #{number} completed</b> · {store}\nThanks for your purchase!',
  },
  'status.buyer.returned': {
    uz: '↩️ <b>Buyurtma #{number} qaytarildi</b> · {store}',
    ru: '↩️ <b>Заказ №{number} возвращён</b> · {store}',
    en: '↩️ <b>Order #{number} returned</b> · {store}',
  },
  'status.buyer.refund': {
    uz: 'Pul toʻlov qilingan usulga qaytariladi.',
    ru: 'Деньги вернутся тем же способом оплаты.',
    en: 'The money goes back to the way you paid.',
  },
  'status.generic': {
    uz: 'ℹ️ <b>Buyurtma #{number}</b> · {store}\nHolat: {status}',
    ru: 'ℹ️ <b>Заказ №{number}</b> · {store}\nСтатус: {status}',
    en: 'ℹ️ <b>Order #{number}</b> · {store}\nStatus: {status}',
  },
  'status.staff': {
    uz: 'ℹ️ <b>Buyurtma #{number}</b> · {store}\n{from} → <b>{to}</b>',
    ru: 'ℹ️ <b>Заказ №{number}</b> · {store}\n{from} → <b>{to}</b>',
    en: 'ℹ️ <b>Order #{number}</b> · {store}\n{from} → <b>{to}</b>',
  },

  // ── order.cancelled ────────────────────────────────────────────────────
  'cancelled.title': {
    uz: '❌ <b>Buyurtma #{number} bekor qilindi</b> · {store}',
    ru: '❌ <b>Заказ №{number} отменён</b> · {store}',
    en: '❌ <b>Order #{number} cancelled</b> · {store}',
  },
  'cancelled.buyer.byBuyer': { uz: 'Siz buyurtmani bekor qildingiz.', ru: 'Вы отменили заказ.', en: 'You cancelled the order.' },
  'cancelled.buyer.byStaff': { uz: 'Doʻkon buyurtmani bekor qildi.', ru: 'Магазин отменил заказ.', en: 'The shop cancelled the order.' },
  'cancelled.buyer.bySystem': {
    uz: 'Buyurtma avtomatik bekor qilindi.',
    ru: 'Заказ отменён автоматически.',
    en: 'The order was cancelled automatically.',
  },
  'cancelled.owner.byBuyer': { uz: 'Xaridor bekor qildi.', ru: 'Покупатель отменил заказ.', en: 'The buyer cancelled it.' },
  'cancelled.owner.byStaff': { uz: 'Jamoa aʼzosi bekor qildi.', ru: 'Отменил сотрудник магазина.', en: 'A team member cancelled it.' },
  'cancelled.owner.bySystem': {
    uz: 'Tizim avtomatik bekor qildi.',
    ru: 'Система отменила заказ автоматически.',
    en: 'The system cancelled it automatically.',
  },

  // ── Reviews, questions ─────────────────────────────────────────────────
  'review.created': {
    uz: '⭐ <b>Yangi sharh</b> · {store}\n<b>{product}</b>\n{stars}',
    ru: '⭐ <b>Новый отзыв</b> · {store}\n<b>{product}</b>\n{stars}',
    en: '⭐ <b>New review</b> · {store}\n<b>{product}</b>\n{stars}',
  },
  'question.created': {
    uz: '❓ <b>Yangi savol</b> · {store}\n<b>{product}</b>',
    ru: '❓ <b>Новый вопрос</b> · {store}\n<b>{product}</b>',
    en: '❓ <b>New question</b> · {store}\n<b>{product}</b>',
  },
  'question.answered': {
    uz: '💬 <b>Doʻkon savolingizga javob berdi</b> · {store}\n<b>{product}</b>',
    ru: '💬 <b>Магазин ответил на ваш вопрос</b> · {store}\n<b>{product}</b>',
    en: '💬 <b>The shop answered your question</b> · {store}\n<b>{product}</b>',
  },

  // ── Store events ───────────────────────────────────────────────────────
  'stock.low': {
    uz: '⚠️ <b>Kam qoldi</b> · {store}\n{product} — {n} dona qoldi',
    ru: '⚠️ <b>Заканчивается</b> · {store}\n{product} — осталось {n} шт.',
    en: '⚠️ <b>Running low</b> · {store}\n{product} — {n} left',
  },
  'store.created': {
    uz: '🎉 <b>«{store}» doʻkoni ochildi!</b>\n\nDoʻkon havolasi:\n{link}\n\nHavolani mijozlarga yuboring yoki kanalingizga joylang.',
    ru: '🎉 <b>Магазин «{store}» открыт!</b>\n\nСсылка на магазин:\n{link}\n\nОтправьте её покупателям или закрепите в своём канале.',
    en: '🎉 <b>{store} is live!</b>\n\nStore link:\n{link}\n\nSend it to customers or pin it in your channel.',
  },
  'store.shareText': {
    uz: '«{store}» — doʻkonimga marhamat!',
    ru: '«{store}» — заходите в мой магазин!',
    en: '{store} — visit my store!',
  },
  'staff.joined': {
    uz: '👤 <b>{name}</b> jamoaga qoʻshildi · {store}\nRol: {role}',
    ru: '👤 <b>{name}</b> вступил(а) в команду · {store}\nРоль: {role}',
    en: '👤 <b>{name}</b> joined the team · {store}\nRole: {role}',
  },

  // ── Callback toasts and errors ─────────────────────────────────────────
  'toast.confirmed': { uz: 'Buyurtma tasdiqlandi', ru: 'Заказ подтверждён', en: 'Order confirmed' },
  'toast.packing': { uz: 'Yigʻish boshlandi', ru: 'Сборка начата', en: 'Packing started' },
  'toast.shipped': { uz: 'Joʻnatildi', ru: 'Отправлен', en: 'Shipped' },
  'toast.ready_for_pickup': { uz: 'Olib ketishga tayyor', ru: 'Готов к выдаче', en: 'Ready for pickup' },
  'toast.delivered': { uz: 'Topshirildi', ru: 'Вручён', en: 'Delivered' },
  'toast.cancelled': { uz: 'Buyurtma bekor qilindi', ru: 'Заказ отменён', en: 'Order cancelled' },
  'toast.generic': { uz: 'Holat: {status}', ru: 'Статус: {status}', en: 'Status: {status}' },
  'error.FORBIDDEN': {
    uz: 'Bu amal uchun ruxsatingiz yoʻq.',
    ru: 'У вас нет прав на это действие.',
    en: 'You don’t have permission to do this.',
  },
  'error.INVALID_TRANSITION': {
    uz: 'Buyurtma holati allaqachon oʻzgargan. Buyurtmani oching.',
    ru: 'Статус заказа уже изменился. Откройте заказ.',
    en: 'The order status has already changed. Open the order.',
  },
  'error.NOT_FOUND': { uz: 'Buyurtma topilmadi.', ru: 'Заказ не найден.', en: 'Order not found.' },
  'error.generic': {
    uz: 'Xatolik yuz berdi. Birozdan soʻng qayta urinib koʻring.',
    ru: 'Что-то пошло не так. Попробуйте чуть позже.',
    en: 'Something went wrong. Try again in a moment.',
  },

  // ── Contact, payments, inline ──────────────────────────────────────────
  'contact.saved': {
    uz: '✅ Raqamingiz tasdiqlandi: {phone}\nMini Appga qayting — maʼlumot avtomatik toʻldiriladi.',
    ru: '✅ Номер подтверждён: {phone}\nВернитесь в Mini App — данные подставятся сами.',
    en: '✅ Your number is verified: {phone}\nGo back to the Mini App — it fills in automatically.',
  },
  'contact.notOwn': {
    uz: 'Faqat oʻz raqamingizni yuboring: «Raqamni yuborish» tugmasini bosing.',
    ru: 'Отправьте только свой номер: нажмите кнопку «Отправить номер».',
    en: 'Send only your own number: tap the “Share phone” button.',
  },
  'payment.receipt': {
    uz: '✅ Toʻlov qabul qilindi: <b>{amount}</b>\nRahmat! Buyurtma holatini shu chatda xabar qilamiz.',
    ru: '✅ Оплата получена: <b>{amount}</b>\nСпасибо! О статусе заказа сообщим в этом чате.',
    en: '✅ Payment received: <b>{amount}</b>\nThanks! We will post order updates in this chat.',
  },
  'precheckout.timeout': {
    uz: 'Doʻkon oʻz vaqtida javob bermadi. Birozdan soʻng qayta urinib koʻring.',
    ru: 'Магазин не ответил вовремя. Попробуйте ещё раз чуть позже.',
    en: 'The shop did not respond in time. Please try again shortly.',
  },
  'inline.description': { uz: '{price} · {store}', ru: '{price} · {store}', en: '{price} · {store}' },
  'inline.empty': { uz: 'Hech narsa topilmadi', ru: 'Ничего не найдено', en: 'Nothing found' },

  // ── Payment methods ────────────────────────────────────────────────────
  'pm.payme': { uz: 'Payme', ru: 'Payme', en: 'Payme' },
  'pm.click': { uz: 'Click', ru: 'Click', en: 'Click' },
  'pm.uzum': { uz: 'Uzum', ru: 'Uzum', en: 'Uzum' },
  'pm.paynet': { uz: 'Paynet', ru: 'Paynet', en: 'Paynet' },
  'pm.telegram': { uz: 'Telegram orqali karta', ru: 'Картой в Telegram', en: 'Card via Telegram' },
  'pm.stars': { uz: 'Telegram Stars', ru: 'Telegram Stars', en: 'Telegram Stars' },
  'pm.stripe': { uz: 'Karta (Stripe)', ru: 'Карта (Stripe)', en: 'Card (Stripe)' },
  'pm.cod': { uz: 'Naqd, qabul qilganda', ru: 'Наличными при получении', en: 'Cash on delivery' },
  'pm.bank_transfer': { uz: 'Bank oʻtkazmasi', ru: 'Банковский перевод', en: 'Bank transfer' },

  // ── Order statuses ─────────────────────────────────────────────────────
  'os.pending_payment': { uz: 'Toʻlov kutilmoqda', ru: 'Ожидает оплаты', en: 'Awaiting payment' },
  'os.awaiting_confirmation': { uz: 'Tasdiq kutilmoqda', ru: 'Ожидает подтверждения', en: 'Awaiting confirmation' },
  'os.paid': { uz: 'Toʻlangan', ru: 'Оплачен', en: 'Paid' },
  'os.confirmed': { uz: 'Tasdiqlangan', ru: 'Подтверждён', en: 'Confirmed' },
  'os.packing': { uz: 'Yigʻilmoqda', ru: 'Собирается', en: 'Packing' },
  'os.shipped': { uz: 'Yoʻlda', ru: 'В пути', en: 'Shipped' },
  'os.ready_for_pickup': { uz: 'Olib ketishga tayyor', ru: 'Готов к выдаче', en: 'Ready for pickup' },
  'os.delivered': { uz: 'Topshirilgan', ru: 'Вручён', en: 'Delivered' },
  'os.completed': { uz: 'Yakunlangan', ru: 'Завершён', en: 'Completed' },
  'os.cancelled': { uz: 'Bekor qilingan', ru: 'Отменён', en: 'Cancelled' },
  'os.return_requested': { uz: 'Qaytarish soʻralgan', ru: 'Запрошен возврат', en: 'Return requested' },
  'os.returned': { uz: 'Qaytarilgan', ru: 'Возвращён', en: 'Returned' },

  // ── Staff roles ────────────────────────────────────────────────────────
  'role.owner': { uz: 'Egasi', ru: 'Владелец', en: 'Owner' },
  'role.admin': { uz: 'Administrator', ru: 'Администратор', en: 'Admin' },
  'role.manager': { uz: 'Menejer', ru: 'Менеджер', en: 'Manager' },
  'role.catalog_editor': { uz: 'Katalog muharriri', ru: 'Редактор каталога', en: 'Catalog editor' },
  'role.order_operator': { uz: 'Buyurtmalar operatori', ru: 'Оператор заказов', en: 'Order operator' },
  'role.viewer': { uz: 'Kuzatuvchi', ru: 'Наблюдатель', en: 'Viewer' },
} as const satisfies Record<string, Entry>;

export type MessageKey = keyof typeof messages;
export type Vars = Record<string, string | number>;

/** Month names: uz "15-noyabr", ru genitive "15 ноября", en "15 November". */
export const MONTHS: Record<Locale, readonly string[]> = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

function fill(template: string, vars: Vars | undefined, map: (v: string | number) => string): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? map(vars[k]!) : m));
}

/** Plain interpolation (button labels, toasts, alerts, pre-checkout errors — not parsed as HTML). */
export function t(locale: Locale, key: MessageKey, vars?: Vars): string {
  const e: Entry = messages[key];
  return fill(e[locale] ?? e.uz, vars, String);
}

/** HTML template with every interpolated value escaped. */
export function tHtml(locale: Locale, key: MessageKey, vars?: Vars): string {
  const e: Entry = messages[key];
  return fill(e[locale] ?? e.uz, vars, escapeHtml);
}

export function statusLabel(locale: Locale, s: OrderStatus): string {
  return t(locale, `os.${s}` as MessageKey);
}

export function paymentMethodLabel(locale: Locale, p: ProviderId): string {
  const key = `pm.${p}`;
  return key in messages ? t(locale, key as MessageKey) : p;
}

export function roleLabel(locale: Locale, role: string): string {
  const key = `role.${role}`;
  return key in messages ? t(locale, key as MessageKey) : role;
}

export function actionLabel(locale: Locale, a: OrderCallbackAction): string {
  return t(locale, `action.${a}` as MessageKey);
}
