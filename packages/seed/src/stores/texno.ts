/** "Texno Bozor" — phones, audio and gadgets (preset Volt: dark, catalogue cards, sharp corners). */
import { cat, L, type ColorSpec, type StoreSpec } from '../spec';

const C = (uz: string, ru: string, en: string, hex: string): ColorSpec => ({ label: L(uz, ru, en), hex });
const QORA = C('Qora', 'Чёрный', 'Black', '#24262b');
const KUMUSH = C('Kumush', 'Серебристый', 'Silver', '#c9ccd1');
const MOVIY = C('Moviy', 'Голубой', 'Blue', '#3f7fd9');
const OQ = C('Oq', 'Белый', 'White', '#eef0f3');
const YASHIL = C('Yashil', 'Зелёный', 'Green', '#3f8f6b');
const TILLA = C('Tilla', 'Золотой', 'Gold', '#d9a21b');
const QIZIL = C('Qizil', 'Красный', 'Red', '#c43a3a');

const XOTIRA = L('Xotira', 'Память', 'Storage');
const KAFOLAT = L('Kafolat', 'Гарантия', 'Warranty');
const YIL1 = L('1 yil', '1 год', '1 year');
const BATAREYA = L('Batareya', 'Аккумулятор', 'Battery');

export const texno: StoreSpec = {
  slug: 'texno-bozor',
  name: 'Texno Bozor',
  nameL10n: L('Texno Bozor', 'Техно Базар', 'Texno Bozor'),
  tagline: L('Rasmiy kafolatli smartfon va gadjetlar', 'Смартфоны и гаджеты с официальной гарантией', 'Phones and gadgets with official warranty'),
  businessType: 'electronics',
  preset: 'volt',
  settings: {
    contacts: { phone: '+998 71 200 30 40', telegram: '@texno_bozor', address: 'Toshkent, Malika bozori, 2-qator' },
    hours: '10:00–21:00',
  },
  categories: [
    cat(L('Telefonlar', 'Телефоны', 'Phones'), [
      cat(L('Smartfonlar', 'Смартфоны', 'Smartphones'), [cat(L('Flagmanlar', 'Флагманы', 'Flagships')), cat(L('Arzon smartfonlar', 'Бюджетные', 'Budget'))]),
      cat(L('Aksessuarlar', 'Аксессуары', 'Accessories'), [cat(L('Gʻiloflar', 'Чехлы', 'Cases')), cat(L('Quvvatlagichlar', 'Зарядки', 'Chargers'))]),
    ], 'phone'),
    cat(L('Audio', 'Аудио', 'Audio'), [
      cat(L('Quloqchinlar', 'Наушники', 'Headphones'), [cat(L('Simsiz', 'Беспроводные', 'Wireless')), cat(L('Simli', 'Проводные', 'Wired'))]),
      cat(L('Kolonkalar', 'Колонки', 'Speakers'), [cat(L('Portativ', 'Портативные', 'Portable'))]),
    ], 'headphones'),
    cat(L('Gadjetlar', 'Гаджеты', 'Gadgets'), [
      cat(L('Aqlli soatlar', 'Умные часы', 'Smartwatches'), [cat(L('Sport soatlar', 'Спортивные', 'Sport')), cat(L('Bolalar soatlari', 'Детские', 'Kids'))]),
    ], 'watch'),
  ],
  products: [
    { key: 'phone-x5', title: L('Smartfon “Samarqand X5”', 'Смартфон «Самарканд X5»', 'Smartphone “Samarqand X5”'), desc: L('6,7" AMOLED ekran, 50 MP kamera, 5000 mAh batareya.', '6,7" AMOLED, камера 50 Мп, 5000 мА·ч.', '6.7" AMOLED, 50 MP camera, 5000 mAh.'),
      cat: 'Telefonlar/Smartfonlar/Flagmanlar', price: 3_900_000, was: 4_400_000, art: { kind: 'phone' }, sizes: { name: XOTIRA, values: ['128 GB', '256 GB'], delta: [0, 600_000] }, colors: [QORA, KUMUSH, MOVIY], stock: [5, 4, 3, 2, 3, 1], tags: ['5G', 'yangi'], brand: 'Samarqand', attrs: [[KAFOLAT, YIL1], [BATAREYA, L('5000 mAh', '5000 мА·ч', '5000 mAh')]], weightG: 210, ageDays: 5 },
    { key: 'phone-nova', title: L('Smartfon “Nova 12 Pro”', 'Смартфон «Nova 12 Pro»', 'Smartphone “Nova 12 Pro”'), desc: L('Yuqori tezlikdagi protsessor va 120 Hz ekran.', 'Быстрый процессор и экран 120 Гц.', 'Fast chip and a 120 Hz display.'),
      cat: 'Telefonlar/Smartfonlar/Flagmanlar', price: 6_200_000, art: { kind: 'phone', c: '#3f8f6b' }, sizes: { name: XOTIRA, values: ['256 GB', '512 GB'], delta: [0, 1_100_000] }, colors: [YASHIL, QORA], stock: 4, tags: ['5G'], brand: 'Nova', attrs: [[KAFOLAT, YIL1]], weightG: 200, ageDays: 20 },
    { key: 'phone-aurum', title: L('Smartfon “Aurum 15”', 'Смартфон «Aurum 15»', 'Smartphone “Aurum 15”'), desc: L('Titan korpus, uch kamerali premium smartfon.', 'Премиальный смартфон в титановом корпусе.', 'A premium titanium phone with triple camera.'),
      cat: 'Telefonlar/Smartfonlar/Flagmanlar', price: 12_900_000, art: { kind: 'phone', c: '#d9a21b', c2: '#24262b' }, sizes: { name: XOTIRA, values: ['128 GB', '256 GB', '512 GB'], delta: [0, 1_500_000, 3_400_000] }, colors: [TILLA, KUMUSH], stock: [2, 1, 2, 1, 0, 1], tags: ['premium'], brand: 'Aurum', attrs: [[KAFOLAT, L('2 yil', '2 года', '2 years')]], weightG: 190, ageDays: 10 },
    { key: 'phone-lite', title: L('Smartfon “Lite A3”', 'Смартфон «Lite A3»', 'Smartphone “Lite A3”'), desc: L('Har kuni uchun ishonchli va arzon smartfon.', 'Надёжный недорогой смартфон.', 'A reliable, affordable everyday phone.'),
      cat: 'Telefonlar/Smartfonlar/Arzon smartfonlar', price: 1_650_000, art: { kind: 'phone', c: '#3f7fd9' }, colors: [MOVIY, QORA], stock: 12, tags: ['arzon'], brand: 'Lite', attrs: [[KAFOLAT, YIL1], [XOTIRA, L('64 GB', '64 ГБ', '64 GB')]], weightG: 185, ageDays: 60 },
    { key: 'case-silicone', title: L('Silikon gʻilof', 'Силиконовый чехол', 'Silicone case'), desc: L('Yumshoq silikon, kamera himoyasi bilan.', 'Мягкий силикон с защитой камеры.', 'Soft silicone with camera guard.'),
      cat: 'Telefonlar/Aksessuarlar/Gʻiloflar', price: 95_000, art: { kind: 'box', c: '#3f7fd9', c2: '#eef0f3' }, colors: [MOVIY, QORA, QIZIL], stock: 25, tags: ['aksessuar'], weightG: 40, ageDays: 40 },
    { key: 'case-atlas', title: L('Atlas naqshli gʻilof', 'Чехол с узором атлас', 'Atlas-pattern case'), desc: L('Milliy abr naqshli charm gʻilof.', 'Кожаный чехол с национальным узором абр.', 'A leather case with national abr pattern.'),
      cat: 'Telefonlar/Aksessuarlar/Gʻiloflar', price: 180_000, was: 220_000, art: { kind: 'phone', p: 'ikat', c: '#c43a3a', c2: '#d9a21b' }, stock: 10, tags: ['aksessuar', 'milliy'], weightG: 60, ageDays: 3 },
    { key: 'charger-33', title: L('Tez quvvatlagich 33 W', 'Быстрая зарядка 33 Вт', 'Fast charger 33 W'), desc: L('USB-C, telefonni 30 daqiqada 60% gacha quvvatlaydi.', 'USB-C, 60% за 30 минут.', 'USB-C, 60% in 30 minutes.'),
      cat: 'Telefonlar/Aksessuarlar/Quvvatlagichlar', price: 220_000, art: { kind: 'box', c: '#eef0f3', c2: '#3f7fd9' }, stock: 30, tags: ['aksessuar'], weightG: 90, ageDays: 55 },
    { key: 'charger-wireless', title: L('Simsiz quvvatlagich', 'Беспроводная зарядка', 'Wireless charger'), desc: L('Qi standarti, 15 W.', 'Стандарт Qi, 15 Вт.', 'Qi standard, 15 W.'),
      cat: 'Telefonlar/Aksessuarlar/Quvvatlagichlar', price: 260_000, was: 300_000, art: { kind: 'box', c: '#24262b', c2: '#3f8f6b' }, stock: 8, tags: ['aksessuar'], weightG: 120, ageDays: 14 },
    { key: 'buds-air', title: L('Simsiz quloqchin “Tovush Air”', 'Беспроводные наушники «Tovush Air»', 'Wireless earbuds “Tovush Air”'), desc: L('Shovqinni kamaytirish, 30 soatgacha ishlash.', 'Шумоподавление, до 30 часов работы.', 'Noise cancelling, up to 30 hours.'),
      cat: 'Audio/Quloqchinlar/Simsiz', price: 690_000, was: 850_000, art: { kind: 'headphones', c: '#eef0f3', c2: '#3f7fd9' }, colors: [OQ, QORA], stock: [9, 6], tags: ['audio', 'xit'], brand: 'Tovush', attrs: [[KAFOLAT, YIL1]], weightG: 60, ageDays: 8 },
    { key: 'headphones-studio', title: L('Katta quloqchin “Studio”', 'Полноразмерные наушники «Studio»', 'Over-ear “Studio”'), desc: L('Studiya sifatidagi tovush, yumshoq yostiqchalar.', 'Студийный звук, мягкие амбушюры.', 'Studio sound, soft ear cushions.'),
      cat: 'Audio/Quloqchinlar/Simsiz', price: 1_290_000, art: { kind: 'headphones', c: '#24262b', c2: '#c43a3a' }, stock: 4, tags: ['audio', 'premium'], brand: 'Tovush', weightG: 280, ageDays: 33 },
    { key: 'earphones-wired', title: L('Simli quloqchin', 'Проводные наушники', 'Wired earphones'), desc: L('3,5 mm, mikrofonli.', '3,5 мм, с микрофоном.', '3.5 mm, with microphone.'),
      cat: 'Audio/Quloqchinlar/Simli', price: 120_000, art: { kind: 'headphones', c: '#eef0f3', c2: '#24262b' }, stock: 40, tags: ['audio', 'arzon'], weightG: 30, ageDays: 90 },
    { key: 'speaker-bass', title: L('Portativ kolonka “Bass Go”', 'Портативная колонка «Bass Go»', 'Portable speaker “Bass Go”'), desc: L('Suvga chidamli IP67, 12 soat ishlaydi.', 'Защита IP67, 12 часов работы.', 'IP67 waterproof, 12 hours of play.'),
      cat: 'Audio/Kolonkalar/Portativ', price: 540_000, art: { kind: 'box', c: '#3f8f6b', c2: '#24262b', p: 'stripe' }, colors: [YASHIL, QORA], stock: 7, tags: ['audio'], weightG: 540, ageDays: 18 },
    { key: 'watch-fit', title: L('Aqlli soat “Fit 4”', 'Умные часы «Fit 4»', 'Smartwatch “Fit 4”'), desc: L('Puls, uyqu va qadamlar, 10 kungacha batareya.', 'Пульс, сон, шаги, до 10 дней работы.', 'Heart rate, sleep and steps, up to 10 days.'),
      cat: 'Gadjetlar/Aqlli soatlar/Sport soatlar', price: 890_000, was: 1_050_000, art: { kind: 'watch' }, colors: [QORA, KUMUSH], stock: 6, tags: ['gadjet', 'xit'], weightG: 45, ageDays: 12 },
    { key: 'watch-run', title: L('Sport soat “Run Pro”', 'Спортивные часы «Run Pro»', 'Sport watch “Run Pro”'), desc: L('GPS, suvga chidamli, yugurish rejimlari.', 'GPS, водозащита, беговые режимы.', 'GPS, waterproof, running modes.'),
      cat: 'Gadjetlar/Aqlli soatlar/Sport soatlar', price: 1_450_000, art: { kind: 'watch', c: '#c43a3a', c2: '#24262b' }, stock: 3, tags: ['gadjet', 'sport'], weightG: 52, ageDays: 26 },
    { key: 'watch-kids', title: L('Bolalar soati GPS', 'Детские часы с GPS', 'Kids’ GPS watch'), desc: L('Ota-onaga joylashuvni yuboradi, SOS tugmasi.', 'Отправляет геолокацию родителям, кнопка SOS.', 'Sends location to parents, SOS button.'),
      cat: 'Gadjetlar/Aqlli soatlar/Bolalar soatlari', price: 420_000, art: { kind: 'watch', c: '#3f7fd9', c2: '#d9a21b' }, stock: 0, tags: ['bolalar'], weightG: 40, ageDays: 45 },
  ],
  promos: [
    { kind: 'code', title: 'Texno 5%', code: 'TEXNO5', valueType: 'percent', value: 5, minSubtotal: 1_000_000 },
    { kind: 'code', title: '100 ming chegirma', code: 'MINUS100', valueType: 'fixed', value: 100_000, minSubtotal: 3_000_000, usageLimit: 50 },
    { kind: 'flash_sale', title: 'Audio kuni', valueType: 'percent', value: 20, products: ['buds-air', 'speaker-bass', 'earphones-wired'], endsInHours: 18 },
  ],
  collections: [
    { title: L('Yangi kelganlar', 'Новинки', 'New arrivals'), kind: 'automated', newerThanDays: 14 },
    { title: L('Xitlar', 'Хиты', 'Bestsellers'), kind: 'manual', products: ['phone-x5', 'buds-air', 'watch-fit', 'charger-33'] },
  ],
  orders: { count: 16, days: 21, seed: 2202 },
  reviews: [
    'Original mahsulot, kafolat taloni bor.',
    'Batareyasi juda yaxshi ushlaydi.',
    'Kuryer oʻsha kuni olib keldi!',
    'Narx va sifat mos.',
    'Ovozi zoʻr, tavsiya qilaman.',
  ],
};
