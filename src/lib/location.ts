export const COMPANY_NAME = 'ТОО Shymkent Reklama';
export const CITY = 'Шымкент';
export const MAP_CENTER: [number, number] = [42.3155, 69.5869];
export const DISTRICTS = ['Абайский', 'Аль-Фарабийский', 'Енбекшинский', 'Каратауский', 'Туранский'];
export const DEMO_LOCATION_VERSION = 'shymkent-2026-10';

const streets = [
  'проспект Тауке хана',
  'проспект Кунаева',
  'улица Байтурсынова',
  'проспект Байдибек би',
  'улица Рыскулова',
  'улица Казыбек би',
  'улица Желтоксан',
  'Темирлановское шоссе',
  'проспект Жибек жолы',
  'улица Кабанбай батыра',
];

export function demoLocation(index: number) {
  return {
    number: `SHY-${String(index + 1).padStart(4, '0')}`,
    name: `${streets[index % streets.length]}${index >= 10 ? ' · 02' : ''}`,
    address: `${streets[index % streets.length]}, ${30 + index * 7}`,
    city: CITY,
    district: DISTRICTS[index % DISTRICTS.length],
    latitude: 42.29 + (index % 5) * 0.014 + (index % 3) * 0.002,
    longitude: 69.55 + Math.floor(index / 5) * 0.026 + (index % 2) * 0.006,
  };
}
