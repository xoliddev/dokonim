/** Business-type templates used by the onboarding wizard (§6.4 step 2). */
import type { BusinessType, L10n } from '@dokonim/core';

export interface CategorySeed {
  name: L10n;
  icon?: string;
  children?: CategorySeed[];
}

const c = (uz: string, ru: string, en: string, icon?: string, children?: CategorySeed[]): CategorySeed => ({ name: { uz, ru, en }, icon, children });

export const CATEGORY_TEMPLATES: Record<BusinessType, CategorySeed[]> = {
  clothing: [
    c('Ayollar', 'Женщинам', 'Women', 'dress', [c('Koʻylaklar', 'Платья', 'Dresses'), c('Ustki kiyim', 'Верхняя одежда', 'Outerwear'), c('Roʻmollar', 'Платки', 'Scarves')]),
    c('Erkaklar', 'Мужчинам', 'Men', 'shirt', [c('Koʻylaklar', 'Рубашки', 'Shirts'), c('Chopon', 'Чапан', 'Chapan')]),
    c('Bolalar', 'Детям', 'Kids', 'kid'),
  ],
  cosmetics: [
    c('Yuz', 'Лицо', 'Face', 'drop', [c('Kremlar', 'Кремы', 'Creams'), c('Tozalash', 'Очищение', 'Cleansing')]),
    c('Soch', 'Волосы', 'Hair', 'comb'),
    c('Atirlar', 'Парфюм', 'Fragrance', 'flask'),
  ],
  food: [
    c('Shirinliklar', 'Сладости', 'Sweets', 'cake', [c('Tortlar', 'Торты', 'Cakes'), c('Pishiriqlar', 'Выпечка', 'Pastry')]),
    c('Quruq mevalar', 'Сухофрукты', 'Dried fruit', 'leaf'),
    c('Choy va qahva', 'Чай и кофе', 'Tea & coffee', 'cup'),
  ],
  electronics: [
    c('Telefonlar', 'Телефоны', 'Phones', 'phone', [c('Smartfonlar', 'Смартфоны', 'Smartphones'), c('Aksessuarlar', 'Аксессуары', 'Accessories', undefined, [c('Gʻiloflar', 'Чехлы', 'Cases'), c('Quvvatlagichlar', 'Зарядки', 'Chargers')])]),
    c('Audio', 'Аудио', 'Audio', 'headphones'),
    c('Uy texnikasi', 'Бытовая техника', 'Home appliances', 'plug'),
  ],
  handmade: [
    c('Kulolchilik', 'Керамика', 'Ceramics', 'vase', [c('Laganlar', 'Ляганы', 'Platters'), c('Piyolalar', 'Пиалы', 'Bowls')]),
    c('Kashtachilik', 'Вышивка', 'Embroidery', 'needle', [c('Soʻzana', 'Сюзане', 'Suzani')]),
    c('Zargarlik', 'Украшения', 'Jewellery', 'gem'),
  ],
  digital: [
    c('Kurslar', 'Курсы', 'Courses', 'book'),
    c('Shablonlar', 'Шаблоны', 'Templates', 'grid'),
    c('Elektron kitoblar', 'Электронные книги', 'E-books', 'file'),
  ],
};

export const ATTRIBUTE_HINTS: Record<BusinessType, L10n[]> = {
  clothing: [{ uz: 'Mato', ru: 'Ткань', en: 'Fabric' }, { uz: 'Parvarish', ru: 'Уход', en: 'Care' }, { uz: 'Ishlab chiqarilgan', ru: 'Производство', en: 'Made in' }],
  cosmetics: [{ uz: 'Hajmi', ru: 'Объём', en: 'Volume' }, { uz: 'Teri turi', ru: 'Тип кожи', en: 'Skin type' }],
  food: [{ uz: 'Ogʻirligi', ru: 'Вес', en: 'Weight' }, { uz: 'Tarkibi', ru: 'Состав', en: 'Ingredients' }, { uz: 'Saqlash muddati', ru: 'Срок хранения', en: 'Shelf life' }],
  electronics: [{ uz: 'Kafolat', ru: 'Гарантия', en: 'Warranty' }, { uz: 'Xotira', ru: 'Память', en: 'Storage' }],
  handmade: [{ uz: 'Material', ru: 'Материал', en: 'Material' }, { uz: 'Usta', ru: 'Мастер', en: 'Maker' }],
  digital: [{ uz: 'Format', ru: 'Формат', en: 'Format' }, { uz: 'Hajmi', ru: 'Размер', en: 'Size' }],
};

/** Default shipping: Tashkent courier, regions by post, self-pickup. Amounts in tiyin. */
export const SHIPPING_TEMPLATE = {
  methods: [
    { key: 'courier', type: 'courier' as const, name: { uz: 'Kuryer', ru: 'Курьер', en: 'Courier' }, processingDays: 0, cutoffTime: '14:00' },
    { key: 'post', type: 'post' as const, name: { uz: 'Pochta (Oʻzbekiston boʻylab)', ru: 'Почта (по Узбекистану)', en: 'Post (nationwide)' }, processingDays: 1, cutoffTime: '12:00' },
    { key: 'pickup', type: 'self_pickup' as const, name: { uz: 'Doʻkondan olib ketish', ru: 'Самовывоз', en: 'Self-pickup' }, processingDays: 0, cutoffTime: '18:00' },
  ],
  zones: [
    { key: 'tashkent', name: 'Toshkent', regions: ['UZ-TK'] },
    { key: 'uzbekistan', name: 'Oʻzbekiston', regions: [] as string[] },
  ],
  rates: [
    { zone: 'tashkent', method: 'courier', calc: 'free_over' as const, amount: 2_500_000, freeOver: 100_000_000, min: 0, max: 1 },
    { zone: 'tashkent', method: 'pickup', calc: 'flat' as const, amount: 0, min: 0, max: 0 },
    { zone: 'uzbekistan', method: 'post', calc: 'weight' as const, amount: 3_000_000, perKg: 500_000, min: 2, max: 4 },
    { zone: 'tashkent', method: 'post', calc: 'flat' as const, amount: 2_000_000, min: 1, max: 2 },
  ],
};
