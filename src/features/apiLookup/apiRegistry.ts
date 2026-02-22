export interface ApiParam {
  name: string;
  placeholder: string;
}

export interface ApiDefinition {
  id: string;
  name: string;
  category: 'Data' | 'Reference';
  description: string;
  icon: string;
  params: ApiParam[];
}

export const API_REGISTRY: ApiDefinition[] = [
  // -- Data --
  {
    id: 'weather',
    name: 'Weather',
    category: 'Data',
    description: 'Current weather for a city (Open-Meteo)',
    icon: '*',
    params: [{ name: 'city', placeholder: 'e.g. Athens, OH' }],
  },
  {
    id: 'crypto',
    name: 'Crypto Price',
    category: 'Data',
    description: 'Live cryptocurrency price & market data',
    icon: '$',
    params: [{ name: 'coin', placeholder: 'e.g. bitcoin, ethereum' }],
  },
  {
    id: 'exchange',
    name: 'Exchange Rate',
    category: 'Data',
    description: 'Currency conversion rate',
    icon: '%',
    params: [
      { name: 'from', placeholder: 'e.g. USD' },
      { name: 'to', placeholder: 'e.g. EUR' },
      { name: 'amount', placeholder: 'e.g. 100 (default: 1)' },
    ],
  },
  {
    id: 'time',
    name: 'Current Time',
    category: 'Data',
    description: 'Current time in a timezone',
    icon: '@',
    params: [{ name: 'timezone', placeholder: 'e.g. America/New_York' }],
  },
  {
    id: 'ip',
    name: 'IP Geolocation',
    category: 'Data',
    description: 'Geolocation data for an IP address',
    icon: '>',
    params: [{ name: 'ip', placeholder: 'e.g. 8.8.8.8' }],
  },

  // -- Reference --
  {
    id: 'dictionary',
    name: 'Dictionary',
    category: 'Reference',
    description: 'Define an English word',
    icon: 'A',
    params: [{ name: 'word', placeholder: 'e.g. ephemeral' }],
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    category: 'Reference',
    description: 'Summary of a topic',
    icon: 'W',
    params: [{ name: 'topic', placeholder: 'e.g. Turing machine' }],
  },
  {
    id: 'country',
    name: 'Country Info',
    category: 'Reference',
    description: 'Population, area, currency, languages',
    icon: '#',
    params: [{ name: 'country', placeholder: 'e.g. Japan' }],
  },
];

export function getApiById(id: string): ApiDefinition | undefined {
  return API_REGISTRY.find((a) => a.id === id);
}

export function filterApis(query: string): ApiDefinition[] {
  if (!query.trim()) return API_REGISTRY;
  const q = query.toLowerCase();
  return API_REGISTRY.filter(
    (api) =>
      api.name.toLowerCase().includes(q) ||
      api.category.toLowerCase().includes(q) ||
      api.description.toLowerCase().includes(q),
  );
}
