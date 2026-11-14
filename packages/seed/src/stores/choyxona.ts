/** "Choyxona Market" — bakery, sweets and tea (preset Choyxona: ticket cards, suzani motif, serif display). */
import { cat, L, type StoreSpec } from '../spec';

const OGIRLIK = L('Ogʻirligi', 'Вес', 'Weight');
const TARKIBI = L('Tarkibi', 'Состав', 'Ingredients');
const SAQLASH = L('Saqlash muddati', 'Срок хранения', 'Shelf life');

export const choyxona: StoreSpec = {
  slug: 'choyxona-market',
  name: 'Choyxona Market',
  nameL10n: L('Choyxona Market', 'Чайхана Маркет', 'Choyxona Market'),
  tagline: L('Issiq non, milliy shirinliklar va xushboʻy choy', 'Горячий хлеб, восточные сладости и ароматный чай', 'Warm bread, national sweets and fragrant tea'),
  businessType: 'food',
  preset: 'choyxona',
  settings: {
    contacts: { phone: '+998 93 555 12 12', telegram: '@choyxona_market', address: 'Samarqand, Registon koʻchasi 5' },
    hours: '07:00–22:00',
  },
  categories: [
    cat(L('Non va pishiriqlar', 'Хлеб и выпечка', 'Bread & pastry'), [
      cat(L('Nonlar', 'Хлеб', 'Bread'), [cat(L('Tandir nonlar', 'Тандырный хлеб', 'Tandir bread')), cat(L('Patirlar', 'Патыр', 'Patir'))]),
      cat(L('Pishiriqlar', 'Выпечка', 'Pastry'), [cat(L('Qatlamalar', 'Слоёная выпечка', 'Layered pastry'))]),
    ], 'bread'),
    cat(L('Shirinliklar', 'Сладости', 'Sweets'), [
      cat(L('Milliy shirinliklar', 'Восточные сладости', 'National sweets'), [cat(L('Holva', 'Халва', 'Halva')), cat(L('Parvarda va navvot', 'Парварда и нават', 'Parvarda & navat'))]),
      cat(L('Sovgʻa toʻplamlari', 'Подарочные наборы', 'Gift sets'), [cat(L('Bayram qutilari', 'Праздничные коробки', 'Holiday boxes'))]),
    ], 'cake'),
    cat(L('Choy va idishlar', 'Чай и посуда', 'Tea & tableware'), [
      cat(L('Choylar', 'Чай', 'Tea'), [cat(L('Koʻk choy', 'Зелёный чай', 'Green tea')), cat(L('Qora choy', 'Чёрный чай', 'Black tea')), cat(L('Oʻtlar choyi', 'Травяной чай', 'Herbal tea'))]),
      cat(L('Idishlar', 'Посуда', 'Tableware'), [cat(L('Choynak va piyolalar', 'Чайники и пиалы', 'Teapots & bowls')), cat(L('Laganlar', 'Ляганы', 'Platters'))]),
    ], 'cup'),
    cat(L('Quruq mevalar va asal', 'Сухофрукты и мёд', 'Dried fruit & honey'), [
      cat(L('Quruq mevalar', 'Сухофрукты', 'Dried fruit'), [cat(L('Oʻrik va mayiz', 'Курага и изюм', 'Apricots & raisins'))]),
      cat(L('Asal va ziravorlar', 'Мёд и специи', 'Honey & spices'), [cat(L('Asal', 'Мёд', 'Honey')), cat(L('Ziravorlar', 'Специи', 'Spices'))]),
    ], 'leaf'),
  ],
  products: [
    { key: 'non-samarqand', title: L('Samarqand noni', 'Самаркандская лепёшка', 'Samarkand bread'), desc: L('Har kuni ertalab tandirda yopiladi. Mashhur Samarqand noni.', 'Каждое утро из тандыра.', 'Baked in the tandir every morning.'),
      cat: 'Non va pishiriqlar/Nonlar/Tandir nonlar', price: 8_000, art: { kind: 'non' }, stock: 80, tags: ['non', 'yangi'], attrs: [[TARKIBI, L('Un, suv, xamirturush, tuz, kunjut', 'Мука, вода, дрожжи, соль, кунжут', 'Flour, water, yeast, salt, sesame')], [SAQLASH, L('3 kun', '3 дня', '3 days')]], weightG: 600, ageDays: 2 },
    { key: 'non-patir', title: L('Patir non', 'Патыр', 'Patir bread'), desc: L('Sariyogʻli, qatlamli patir.', 'Слоёный патыр на сливочном масле.', 'Layered patir with butter.'),
      cat: 'Non va pishiriqlar/Nonlar/Patirlar', price: 12_000, art: { kind: 'non', c: '#c98a3c' }, stock: 50, tags: ['non'], weightG: 500, ageDays: 30 },
    { key: 'non-shirmoy', title: L('Shirmoy non', 'Ширмай нон', 'Shirmoy bread'), desc: L('Shirin, yumshoq non — choy uchun ayni muddao.', 'Сладкий мягкий хлеб к чаю.', 'Sweet soft bread, perfect with tea.'),
      cat: 'Non va pishiriqlar/Nonlar/Tandir nonlar', price: 10_000, art: { kind: 'non', c: '#d9a95b', c2: '#7a4a1f' }, stock: 40, tags: ['non'], weightG: 450, ageDays: 45 },
    { key: 'qatlama', title: L('Qatlama', 'Катлама', 'Qatlama'), desc: L('Yupqa qatlamli, tilla rang pishiriq.', 'Тонкая слоёная золотистая выпечка.', 'Thin, golden layered pastry.'),
      cat: 'Non va pishiriqlar/Pishiriqlar/Qatlamalar', price: 15_000, was: 18_000, art: { kind: 'non', p: 'stripe', c: '#e0b25a' }, sizes: { name: L('Soni', 'Количество', 'Pack'), values: ['2 dona', '6 dona'], delta: [0, 27_000] }, stock: 25, tags: ['pishiriq'], weightG: 300, ageDays: 6 },
    { key: 'halva-kunjut', title: L('Kunjutli holva', 'Кунжутная халва', 'Sesame halva'), desc: L('Anʼanaviy usulda tayyorlangan kunjutli holva.', 'Кунжутная халва по традиционному рецепту.', 'Sesame halva made the traditional way.'),
      cat: 'Shirinliklar/Milliy shirinliklar/Holva', price: 45_000, art: { kind: 'halva' }, sizes: { name: OGIRLIK, values: ['250 g', '500 g', '1 kg'], delta: [0, 40_000, 120_000] }, stock: [20, 14, 6], tags: ['shirinlik', 'xit'], attrs: [[SAQLASH, L('2 oy', '2 месяца', '2 months')]], weightG: 250, ageDays: 20 },
    { key: 'halva-pashmak', title: L('Pashmak holva', 'Пашмак', 'Pashmak'), desc: L('Ip kabi nozik, ogʻizda eriydigan holva.', 'Нежная нитяная халва, тающая во рту.', 'Delicate threaded halva that melts in the mouth.'),
      cat: 'Shirinliklar/Milliy shirinliklar/Holva', price: 52_000, art: { kind: 'halva', c: '#f2e2c4', c2: '#c98a3c' }, stock: 10, tags: ['shirinlik'], weightG: 200, ageDays: 11 },
    { key: 'parvarda', title: L('Parvarda', 'Парварда', 'Parvarda'), desc: L('Qand va undan tayyorlangan milliy shirinlik, 300 g.', 'Восточная сладость, 300 г.', 'A national sugar sweet, 300 g.'),
      cat: 'Shirinliklar/Milliy shirinliklar/Parvarda va navvot', price: 38_000, art: { kind: 'halva', c: '#f5efe2', c2: '#8fb8a6', p: 'stripe' }, stock: 18, tags: ['shirinlik'], weightG: 300, ageDays: 50 },
    { key: 'gift-box', title: L('Sovgʻa qutisi “Dasturxon”', 'Подарочная коробка «Дастархан»', 'Gift box “Dastarkhan”'), desc: L('Holva, parvarda, quruq mevalar va choy — bir qutida.', 'Халва, парварда, сухофрукты и чай в одной коробке.', 'Halva, parvarda, dried fruit and tea in one box.'),
      cat: 'Shirinliklar/Sovgʻa toʻplamlari/Bayram qutilari', price: 320_000, was: 360_000, art: { kind: 'box', p: 'suzani', c: '#1f6e5a', c2: '#d9a21b' }, stock: 5, tags: ['sovgʻa', 'bayram'], weightG: 1500, ageDays: 4 },
    { key: 'tea-95', title: L('Koʻk choy №95', 'Зелёный чай №95', 'Green tea No. 95'), desc: L('Choyxonalarning sevimli koʻk choyi.', 'Любимый зелёный чай чайханы.', 'The classic choyxona green tea.'),
      cat: 'Choy va idishlar/Choylar/Koʻk choy', price: 32_000, art: { kind: 'tea' }, sizes: { name: OGIRLIK, values: ['250 g', '500 g'], delta: [0, 28_000] }, stock: 35, tags: ['choy', 'xit'], weightG: 250, ageDays: 70 },
    { key: 'tea-black', title: L('Qora choy “Choyxona”', 'Чёрный чай «Чайхана»', 'Black tea “Choyxona”'), desc: L('Kuchli damlanadigan yirik bargli qora choy.', 'Крупнолистовой чёрный чай.', 'Strong large-leaf black tea.'),
      cat: 'Choy va idishlar/Choylar/Qora choy', price: 28_000, art: { kind: 'tea', c: '#7a3b22', c2: '#d9a21b' }, stock: 30, tags: ['choy'], weightG: 250, ageDays: 60 },
    { key: 'tea-herbal', title: L('Togʻ oʻtlari choyi', 'Чай из горных трав', 'Mountain herb tea'), desc: L('Chimyon togʻlaridan yigʻilgan oʻtlar aralashmasi.', 'Сбор трав с гор Чимгана.', 'A blend of herbs from the Chimgan mountains.'),
      cat: 'Choy va idishlar/Choylar/Oʻtlar choyi', price: 35_000, art: { kind: 'tea', c: '#5a8f4e', c2: '#f2e2c4' }, stock: 3, tags: ['choy', 'yangi'], weightG: 150, ageDays: 1 },
    { key: 'teapot-paxta', title: L('Choynak “Paxta”', 'Чайник «Пахта»', 'Teapot “Paxta”'), desc: L('Mashhur paxta naqshli chinni choynak, 1 litr.', 'Фарфоровый чайник с хлопковым узором, 1 л.', 'Porcelain teapot with the cotton pattern, 1 l.'),
      cat: 'Choy va idishlar/Idishlar/Choynak va piyolalar', price: 140_000, art: { kind: 'teapot', p: 'suzani' }, stock: 8, tags: ['idish', 'sovgʻa'], weightG: 700, ageDays: 35 },
    { key: 'piyola-set', title: L('Piyola toʻplami, 6 dona', 'Набор пиал, 6 шт.', 'Bowl set, 6 pcs'), desc: L('Paxta naqshli chinni piyolalar.', 'Фарфоровые пиалы с хлопковым узором.', 'Porcelain bowls with the cotton pattern.'),
      cat: 'Choy va idishlar/Idishlar/Choynak va piyolalar', price: 160_000, was: 190_000, art: { kind: 'piyola', p: 'suzani' }, stock: 10, tags: ['idish'], weightG: 900, ageDays: 15 },
    { key: 'lagan-rishton', title: L('Rishton lagani', 'Риштанский ляган', 'Rishton platter'), desc: L('Rishton ustalarining qoʻlda chizilgan lagani, 40 sm.', 'Расписной ляган риштанских мастеров, 40 см.', 'Hand-painted Rishton platter, 40 cm.'),
      cat: 'Choy va idishlar/Idishlar/Laganlar', price: 380_000, art: { kind: 'lagan' }, stock: 4, tags: ['idish', 'sovgʻa', 'qoʻlda'], weightG: 2200, ageDays: 25 },
    { key: 'orik', title: L('Quruq oʻrik', 'Курага', 'Dried apricots'), desc: L('Fargʻona oʻrigi, shakarsiz quritilgan.', 'Ферганская курага без сахара.', 'Fergana apricots dried without sugar.'),
      cat: 'Quruq mevalar va asal/Quruq mevalar/Oʻrik va mayiz', price: 60_000, art: { kind: 'driedfruit' }, sizes: { name: OGIRLIK, values: ['500 g', '1 kg'], delta: [0, 52_000] }, stock: 22, tags: ['quruq meva'], weightG: 500, ageDays: 40 },
    { key: 'mayiz', title: L('Mayiz aralashmasi', 'Ассорти изюма', 'Raisin mix'), desc: L('Sariq, qora va kishmish mayiz aralashmasi, 500 g.', 'Смесь жёлтого, чёрного изюма и кишмиша, 500 г.', 'Golden, black and kishmish raisins, 500 g.'),
      cat: 'Quruq mevalar va asal/Quruq mevalar/Oʻrik va mayiz', price: 55_000, art: { kind: 'driedfruit', c: '#6b3a2a', c2: '#d9a21b' }, stock: 16, tags: ['quruq meva'], weightG: 500, ageDays: 33 },
    { key: 'asal', title: L('Togʻ asali', 'Горный мёд', 'Mountain honey'), desc: L('Boysun togʻlaridan tabiiy asal.', 'Натуральный мёд с гор Байсуна.', 'Natural honey from the Boysun mountains.'),
      cat: 'Quruq mevalar va asal/Asal va ziravorlar/Asal', price: 95_000, was: 110_000, art: { kind: 'honey' }, sizes: { name: OGIRLIK, values: ['0,5 kg', '1 kg'], delta: [0, 80_000] }, stock: [12, 6], tags: ['asal', 'xit'], weightG: 600, ageDays: 9 },
    { key: 'ziravor', title: L('Ziravorlar toʻplami “Palov uchun”', 'Набор специй «Для плова»', 'Spice set “For plov”'), desc: L('Zira, zirk, qizil qalampir va kunjut.', 'Зира, барбарис, красный перец и кунжут.', 'Cumin, barberry, red pepper and sesame.'),
      cat: 'Quruq mevalar va asal/Asal va ziravorlar/Ziravorlar', price: 42_000, art: { kind: 'spices' }, stock: 24, tags: ['ziravor'], weightG: 200, ageDays: 18 },
  ],
  promos: [
    { kind: 'code', title: 'Choy vaqti', code: 'CHOY15', valueType: 'percent', value: 15, minSubtotal: 150_000 },
    { kind: 'code', title: 'Bepul yetkazish', code: 'BEPULYETKAZISH', valueType: 'free_shipping', value: 0 },
    { kind: 'automatic', title: 'Ertalabki non', valueType: 'percent', value: 10, products: ['non-samarqand', 'non-patir', 'non-shirmoy'] },
  ],
  collections: [
    { title: L('Yangi kelganlar', 'Новинки', 'New arrivals'), kind: 'automated', newerThanDays: 14 },
    { title: L('Dasturxon uchun', 'К дастархану', 'For the table'), kind: 'manual', products: ['non-samarqand', 'halva-kunjut', 'tea-95', 'orik', 'asal'] },
  ],
  orders: { count: 22, days: 14, seed: 3303 },
  reviews: [
    'Non issiq holda keldi, mazali!',
    'Holva juda yangi edi.',
    'Choyi xushboʻy, yana olaman.',
    'Sovgʻa qutisi chiroyli qadoqlangan.',
    'Asal haqiqiy tabiiy.',
  ],
};
