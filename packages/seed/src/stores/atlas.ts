/** "Atlas & Adras" — Margʻilon textiles and clothing (preset Atlas, ikat motif). */
import { cat, L, type ColorSpec, type StoreSpec } from '../spec';

const C = (uz: string, ru: string, en: string, hex: string): ColorSpec => ({ label: L(uz, ru, en), hex });
const QIZIL = C('Qizil', 'Красный', 'Red', '#b3263a');
const KOK = C('Koʻk', 'Синий', 'Blue', '#2c4f9e');
const YASHIL = C('Yashil', 'Зелёный', 'Green', '#2f7d4f');
const SARIQ = C('Sariq', 'Жёлтый', 'Yellow', '#d9a21b');
const BINAFSHA = C('Binafsha', 'Фиолетовый', 'Purple', '#6b3fa0');
const OQ = C('Oq', 'Белый', 'White', '#f1ece2');
const QORA = C('Qora', 'Чёрный', 'Black', '#2a2622');
const MOVIY = C('Moviy', 'Голубой', 'Sky blue', '#5b8fc9');
const TERRAKOTA = C('Terrakota', 'Терракота', 'Terracotta', '#b5552b');

const MATO = L('Mato', 'Ткань', 'Fabric');
const PARVARISH = L('Parvarish', 'Уход', 'Care');
const ISHLAB = L('Ishlab chiqarilgan', 'Производство', 'Made in');
const MARGILON = L('Margʻilon, Oʻzbekiston', 'Маргилан, Узбекистан', 'Margilan, Uzbekistan');
const QOLDA = L('Qoʻlda yuvish, 30°', 'Ручная стирка, 30°', 'Hand wash, 30°');
const ADULT = { values: ['S', 'M', 'L', 'XL'] };

export const atlas: StoreSpec = {
  slug: 'atlas-adras',
  name: 'Atlas & Adras',
  nameL10n: L('Atlas & Adras', 'Атлас и Адрас', 'Atlas & Adras'),
  tagline: L('Margʻilon atlasidan zamonaviy kiyimlar', 'Современная одежда из маргиланского атласа', 'Modern clothing from Margilan silk ikat'),
  businessType: 'clothing',
  preset: 'atlas',
  settings: {
    contacts: { phone: '+998 90 123 45 67', telegram: '@atlas_adras', instagram: 'atlas.adras', address: 'Margʻilon, Yodgorlik koʻchasi 12' },
    hours: '09:00–20:00',
  },
  categories: [
    cat(L('Kiyim', 'Одежда', 'Clothing'), [
      cat(L('Ayollar', 'Женщинам', 'Women'), [cat(L('Koʻylaklar', 'Платья', 'Dresses')), cat(L('Ustki kiyim', 'Верхняя одежда', 'Outerwear')), cat(L('Roʻmollar', 'Платки', 'Scarves'))], 'dress'),
      cat(L('Erkaklar', 'Мужчинам', 'Men'), [cat(L('Koʻylaklar', 'Рубашки', 'Shirts')), cat(L('Choponlar', 'Чапаны', 'Chapans')), cat(L('Shimlar', 'Брюки', 'Trousers'))], 'shirt'),
      cat(L('Bolalar', 'Детям', 'Kids'), [cat(L('Qizlar uchun', 'Для девочек', 'Girls')), cat(L('Oʻgʻil bolalar uchun', 'Для мальчиков', 'Boys'))], 'kid'),
    ]),
    cat(L('Aksessuarlar', 'Аксессуары', 'Accessories'), [
      cat(L('Bosh kiyimlar', 'Головные уборы', 'Headwear'), [cat(L('Doʻppilar', 'Тюбетейки', 'Doppi'))], 'doppi'),
      cat(L('Sumkalar', 'Сумки', 'Bags'), [cat(L('Qoʻl sumkalari', 'Сумки', 'Handbags'))], 'bag'),
      cat(L('Poyabzal', 'Обувь', 'Shoes'), [cat(L('Krossovkalar', 'Кроссовки', 'Sneakers'))], 'sneaker'),
    ]),
    cat(L('Uy tekstili', 'Домашний текстиль', 'Home textiles'), [
      cat(L('Yostiqlar', 'Подушки', 'Pillows'), [cat(L('Yostiq jildlari', 'Наволочки', 'Pillow covers'))], 'pillow'),
      cat(L('Matolar', 'Ткани', 'Fabrics'), [cat(L('Atlas matolar', 'Атлас', 'Atlas silk')), cat(L('Adras matolar', 'Адрас', 'Adras'))], 'fabric'),
      cat(L('Bezaklar', 'Декор', 'Decor'), [cat(L('Devoriy soʻzanalar', 'Настенные сюзане', 'Wall suzani'))], 'wallhanging'),
    ]),
  ],
  products: [
    { key: 'dress-margilon', title: L('Atlas koʻylak “Margʻilon”', 'Платье из атласа «Маргилан»', 'Atlas dress “Margilan”'), desc: L('Qoʻlda toʻqilgan **ipak atlas**dan tikilgan bayramona koʻylak. Erkin bichim, yengil va nafas oladi.', 'Праздничное платье из **шёлкового атласа** ручной работы.', 'A festive dress in hand-woven **silk ikat**. Relaxed fit, light and breathable.'),
      cat: 'Kiyim/Ayollar/Koʻylaklar', price: 450_000, was: 520_000, art: { kind: 'dress', p: 'ikat' }, sizes: ADULT, colors: [QIZIL, KOK, YASHIL], stock: [6, 9, 4, 2, 7, 8, 5, 3, 1, 6, 4, 0], tags: ['atlas', 'bayram', 'yangi'], brand: 'Margʻilon ipagi', attrs: [[MATO, L('100% ipak atlas', '100% шёлк', '100% silk')], [PARVARISH, QOLDA], [ISHLAB, MARGILON]], weightG: 450, ageDays: 6 },
    { key: 'dress-bahor', title: L('Adras koʻylak “Bahor”', 'Платье из адраса «Бахор»', 'Adras dress “Bahor”'), desc: L('Kundalik kiyish uchun yengil adras koʻylak, cheti kashta bilan bezatilgan.', 'Лёгкое платье из адраса на каждый день.', 'A light everyday adras dress with embroidered hem.'),
      cat: 'Kiyim/Ayollar/Koʻylaklar', price: 380_000, art: { kind: 'dress', p: 'stripe' }, sizes: { values: ['S', 'M', 'L'] }, colors: [SARIQ, BINAFSHA], stock: 8, tags: ['adras'], attrs: [[MATO, L('Adras (ipak + paxta)', 'Адрас (шёлк + хлопок)', 'Adras (silk + cotton)')], [ISHLAB, MARGILON]], weightG: 400, ageDays: 12 },
    { key: 'dress-daily', title: L('Kundalik atlas koʻylak', 'Повседневное платье из атласа', 'Everyday atlas dress'), desc: L('Ofis va sayr uchun qulay, toʻgʻri bichimli koʻylak.', 'Удобное платье прямого кроя.', 'A comfortable straight-cut dress for office and walks.'),
      cat: 'Kiyim/Ayollar/Koʻylaklar', price: 320_000, art: { kind: 'dress', c: '#2c4f9e', c2: '#d9a21b', p: 'ikat' }, sizes: ADULT, stock: 10, tags: ['atlas'], weightG: 380, ageDays: 40 },
    { key: 'chapan-shohona', title: L('Ayollar choponi “Shohona”', 'Женский чапан «Шохона»', 'Women’s chapan “Shohona”'), desc: L('Zarli iplar bilan bezatilgan baxmal chopon. Toʻy va bayramlar uchun.', 'Бархатный чапан с золотой нитью.', 'A velvet chapan with gold thread, for weddings and holidays.'),
      cat: 'Kiyim/Ayollar/Ustki kiyim', price: 890_000, was: 990_000, art: { kind: 'chapan', c: '#6b3fa0', c2: '#d9a21b', p: 'suzani' }, sizes: { values: ['M', 'L'] }, stock: [3, 2], tags: ['chopon', 'toʻy'], weightG: 1200, ageDays: 20 },
    { key: 'scarf-suzana', title: L('Ipak roʻmol “Soʻzana”', 'Шёлковый платок «Сюзане»', 'Silk scarf “Suzani”'), desc: L('Soʻzana naqshli yumshoq ipak roʻmol, 90×90 sm.', 'Мягкий шёлковый платок с узором сюзане, 90×90 см.', 'A soft silk scarf with suzani pattern, 90×90 cm.'),
      cat: 'Kiyim/Ayollar/Roʻmollar', price: 180_000, art: { kind: 'scarf', p: 'suzani' }, colors: [TERRAKOTA, KOK, YASHIL], stock: 12, tags: ['roʻmol', 'sovgʻa'], weightG: 120, ageDays: 3 },
    { key: 'scarf-atlas', title: L('Atlas roʻmol', 'Атласный платок', 'Atlas scarf'), desc: L('Klassik abr naqshli roʻmol.', 'Платок с классическим узором абр.', 'A scarf with classic abr pattern.'),
      cat: 'Kiyim/Ayollar/Roʻmollar', price: 150_000, was: 175_000, art: { kind: 'scarf', p: 'ikat', c: '#b3263a' }, stock: 15, tags: ['roʻmol'], weightG: 100, ageDays: 30 },
    { key: 'shirt-ipak', title: L('Erkaklar koʻylagi “Ipak yoqa”', 'Мужская рубашка «Шёлковый воротник»', 'Men’s shirt “Silk collar”'), desc: L('Paxta koʻylak, yoqasi va yeng uchlari atlas bilan.', 'Хлопковая рубашка с атласной отделкой.', 'A cotton shirt with atlas collar and cuffs.'),
      cat: 'Kiyim/Erkaklar/Koʻylaklar', price: 260_000, art: { kind: 'shirt', p: 'none' }, sizes: { values: ['S', 'M', 'L', 'XL', 'XXL'] }, colors: [OQ, MOVIY], stock: 7, tags: ['erkaklar'], weightG: 300, ageDays: 15 },
    { key: 'shirt-kashta', title: L('Kashtali koʻylak', 'Рубашка с вышивкой', 'Embroidered shirt'), desc: L('Old qismi qoʻlda kashtalangan zigʻir koʻylak.', 'Льняная рубашка с ручной вышивкой.', 'A linen shirt with hand-embroidered front.'),
      cat: 'Kiyim/Erkaklar/Koʻylaklar', price: 290_000, art: { kind: 'shirt', c: '#f1ece2', c2: '#b5552b', p: 'suzani' }, sizes: { values: ['M', 'L', 'XL'] }, stock: 5, tags: ['kashta'], weightG: 280, ageDays: 50 },
    { key: 'chapan-buxoro', title: L('Erkaklar choponi “Buxoro”', 'Мужской чапан «Бухара»', 'Men’s chapan “Bukhara”'), desc: L('Anʼanaviy yoʻl-yoʻl chopon, paxta astar bilan.', 'Традиционный полосатый чапан на хлопковой подкладке.', 'A traditional striped chapan with cotton lining.'),
      cat: 'Kiyim/Erkaklar/Choponlar', price: 1_250_000, art: { kind: 'chapan', p: 'stripe' }, sizes: { values: ['M', 'L', 'XL'] }, stock: [2, 3, 1], tags: ['chopon', 'sovgʻa'], weightG: 1500, ageDays: 25 },
    { key: 'trousers-classic', title: L('Klassik shim', 'Классические брюки', 'Classic trousers'), desc: L('Toʻgʻri bichimli jun aralash shim.', 'Брюки прямого кроя из шерстяной смеси.', 'Straight-cut wool-blend trousers.'),
      cat: 'Kiyim/Erkaklar/Shimlar', price: 240_000, was: 280_000, art: { kind: 'trousers', c: '#2a2622', c2: '#5b8fc9' }, sizes: { values: ['30', '32', '34', '36'] }, stock: 6, tags: ['erkaklar'], weightG: 500, ageDays: 60 },
    { key: 'kids-dress', title: L('Qizlar atlas koʻylagi', 'Платье из атласа для девочек', 'Girls’ atlas dress'), desc: L('Bayram uchun kichkintoylarga atlas koʻylak.', 'Атласное платье для маленьких модниц.', 'An atlas dress for little ones.'),
      cat: 'Kiyim/Bolalar/Qizlar uchun', price: 210_000, art: { kind: 'dress', c: '#d9a21b', c2: '#b3263a', p: 'ikat' }, sizes: { name: L('Boʻy', 'Рост', 'Height'), values: ['98', '110', '122', '134'] }, stock: 5, tags: ['bolalar', 'yangi'], weightG: 250, ageDays: 4 },
    { key: 'kids-doppi', title: L('Bolalar doʻppisi', 'Детская тюбетейка', 'Kids’ doppi'), desc: L('Oʻgʻil bolalar uchun kashtali doʻppi.', 'Вышитая тюбетейка для мальчиков.', 'An embroidered doppi for boys.'),
      cat: 'Kiyim/Bolalar/Oʻgʻil bolalar uchun', price: 85_000, art: { kind: 'doppi', c: '#2f7d4f' }, stock: 20, tags: ['bolalar'], weightG: 80, ageDays: 70 },
    { key: 'doppi-chust', title: L('Chust doʻppisi', 'Чустская тюбетейка', 'Chust doppi'), desc: L('Mashhur qalampir naqshli Chust doʻppisi.', 'Знаменитая чустская тюбетейка с узором «калампир».', 'The famous Chust doppi with pepper motif.'),
      cat: 'Aksessuarlar/Bosh kiyimlar/Doʻppilar', price: 120_000, art: { kind: 'doppi' }, colors: [QORA, YASHIL], stock: 14, tags: ['doʻppi', 'sovgʻa'], brand: 'Chust', weightG: 90, ageDays: 35 },
    { key: 'bag-atlas', title: L('Atlas qoʻl sumkasi', 'Сумка из атласа', 'Atlas handbag'), desc: L('Charm tutqichli, ichki choʻntakli atlas sumka.', 'Атласная сумка с кожаными ручками.', 'An atlas bag with leather handles and inner pocket.'),
      cat: 'Aksessuarlar/Sumkalar/Qoʻl sumkalari', price: 340_000, was: 390_000, art: { kind: 'bag', p: 'ikat' }, colors: [QIZIL, KOK], stock: [4, 2], tags: ['sumka', 'yangi'], weightG: 600, ageDays: 2 },
    { key: 'bag-adras', title: L('Adras sumka', 'Сумка из адраса', 'Adras tote'), desc: L('Har kuni uchun keng adras sumka.', 'Вместительная сумка из адраса.', 'A roomy everyday adras tote.'),
      cat: 'Aksessuarlar/Sumkalar/Qoʻl sumkalari', price: 290_000, art: { kind: 'bag', p: 'stripe', c: '#2f7d4f' }, stock: 9, tags: ['sumka'], weightG: 550, ageDays: 45 },
    { key: 'sneaker-atlas', title: L('Atlas krossovka', 'Кроссовки с атласом', 'Atlas sneakers'), desc: L('Atlas bilan bezatilgan yengil krossovkalar.', 'Лёгкие кроссовки с атласными вставками.', 'Light sneakers with atlas panels.'),
      cat: 'Aksessuarlar/Poyabzal/Krossovkalar', price: 420_000, art: { kind: 'sneaker', p: 'ikat' }, sizes: { values: ['38', '39', '40', '41', '42', '43', '44'] }, stock: [2, 3, 5, 6, 4, 2, 0], tags: ['poyabzal', 'yangi'], weightG: 800, ageDays: 1 },
    { key: 'pillow-atlas', title: L('Atlas yostiq jildi', 'Наволочка из атласа', 'Atlas pillow cover'), desc: L('45×45 sm, yashirin zamokli yostiq jildi.', 'Наволочка 45×45 см на скрытой молнии.', 'A 45×45 cm cover with hidden zip.'),
      cat: 'Uy tekstili/Yostiqlar/Yostiq jildlari', price: 95_000, art: { kind: 'pillow', p: 'ikat' }, colors: [QIZIL, SARIQ, KOK], stock: 18, tags: ['uy'], weightG: 200, ageDays: 22 },
    { key: 'pillow-suzani', title: L('Soʻzana yostiq', 'Подушка сюзане', 'Suzani pillow'), desc: L('Qoʻlda kashtalangan soʻzana yostiq.', 'Подушка с ручной вышивкой сюзане.', 'A hand-embroidered suzani pillow.'),
      cat: 'Uy tekstili/Yostiqlar/Yostiq jildlari', price: 140_000, art: { kind: 'pillow', p: 'suzani', c: '#f1ece2', c2: '#b3263a' }, stock: 6, tags: ['uy', 'kashta'], weightG: 350, ageDays: 18 },
    { key: 'fabric-atlas', title: L('Margʻilon atlasi, 1 metr', 'Маргиланский атлас, 1 метр', 'Margilan atlas, 1 metre'), desc: L('Kengligi 50 sm, tabiiy ipak. Narx 1 metr uchun.', 'Ширина 50 см, натуральный шёлк. Цена за метр.', '50 cm wide, natural silk. Price per metre.'),
      cat: 'Uy tekstili/Matolar/Atlas matolar', price: 75_000, art: { kind: 'fabric', p: 'ikat' }, colors: [QIZIL, KOK, YASHIL, SARIQ], stock: 40, tags: ['mato', 'atlas'], weightG: 90, ageDays: 80 },
    { key: 'fabric-adras', title: L('Adras mato, 1 metr', 'Адрас, 1 метр', 'Adras fabric, 1 metre'), desc: L('Ipak va paxta aralashmasi. Narx 1 metr uchun.', 'Смесь шёлка и хлопка. Цена за метр.', 'Silk and cotton blend. Price per metre.'),
      cat: 'Uy tekstili/Matolar/Adras matolar', price: 65_000, art: { kind: 'fabric', p: 'stripe', c: '#6b3fa0' }, stock: 30, tags: ['mato', 'adras'], weightG: 110, ageDays: 75 },
    { key: 'fabric-premium', title: L('Ipak atlas “Premium”', 'Шёлковый атлас «Премиум»', 'Silk atlas “Premium”'), desc: L('Eng nozik iplardan toʻqilgan premium atlas.', 'Премиальный атлас из тончайших нитей.', 'Premium atlas woven from the finest threads.'),
      cat: 'Uy tekstili/Matolar/Atlas matolar', price: 120_000, art: { kind: 'fabric', p: 'ikat', c: '#1d1a16', c2: '#d9a21b' }, stock: 2, tags: ['mato', 'premium'], weightG: 90, ageDays: 9 },
    { key: 'wall-suzani', title: L('Devoriy soʻzana “Nurota”', 'Настенное сюзане «Нурата»', 'Wall suzani “Nurata”'), desc: L('Nurota ustalari tomonidan 3 oyda kashtalangan, 120×160 sm.', 'Вышито мастерами Нураты за 3 месяца, 120×160 см.', 'Embroidered by Nurata masters over 3 months, 120×160 cm.'),
      cat: 'Uy tekstili/Bezaklar/Devoriy soʻzanalar', price: 1_900_000, was: 2_300_000, art: { kind: 'wallhanging', p: 'suzani' }, stock: 1, tags: ['kashta', 'sovgʻa', 'premium'], weightG: 1800, ageDays: 28 },
  ],
  promos: [
    { kind: 'code', title: 'Salom!', code: 'SALOM10', valueType: 'percent', value: 10, minSubtotal: 300_000 },
    { kind: 'code', title: 'Bepul yetkazish', code: 'BEPULYETKAZISH', valueType: 'free_shipping', value: 0 },
    { kind: 'code', title: 'Toʻy mavsumi', code: 'TOY50', valueType: 'fixed', value: 50_000, minSubtotal: 800_000, usageLimit: 100 },
    { kind: 'flash_sale', title: 'Atlas haftaligi', valueType: 'percent', value: 15, products: ['dress-margilon', 'scarf-suzana', 'bag-atlas', 'pillow-atlas'], endsInHours: 30 },
  ],
  collections: [
    { title: L('Yangi kelganlar', 'Новинки', 'New arrivals'), kind: 'automated', newerThanDays: 14 },
    { title: L('Toʻy mavsumi', 'Свадебный сезон', 'Wedding season'), kind: 'manual', products: ['dress-margilon', 'chapan-shohona', 'chapan-buxoro', 'wall-suzani', 'scarf-suzana'] },
    { title: L('Sovgʻa uchun', 'В подарок', 'Gift ideas'), kind: 'manual', products: ['scarf-suzana', 'doppi-chust', 'pillow-suzani', 'bag-atlas'] },
  ],
  orders: { count: 30, days: 30, seed: 1101 },
  reviews: [
    'Mato juda sifatli, rangi rasmdagidek!',
    'Tez yetkazib berishdi, rahmat.',
    'Oʻlchami toʻgʻri keldi, juda chiroyli.',
    'Sovgʻaga oldim, onam xursand boʻldi.',
    'Narxiga arziydi, yana buyurtma qilaman.',
    'Qadoqlash chiroyli edi.',
  ],
};
