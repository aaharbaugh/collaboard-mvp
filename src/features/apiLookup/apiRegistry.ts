export interface ApiParam {
  name: string;
  placeholder: string;
}

export interface ApiDefinition {
  id: string;
  name: string;
  category: 'Data' | 'Reference' | 'Transform' | 'AI';
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

  // -- Transform --
  {
    id: 'transform_regex',
    name: 'Regex Extract',
    category: 'Transform',
    description: 'Extract matches using a regular expression',
    icon: '/',
    params: [
      { name: 'text', placeholder: 'input text' },
      { name: 'pattern', placeholder: 'e.g. \\d+' },
      { name: 'flags', placeholder: 'e.g. g, gi (default: g)' },
      { name: 'group', placeholder: 'capture group (default: 0)' },
    ],
  },
  {
    id: 'transform_json_path',
    name: 'JSON Path',
    category: 'Transform',
    description: 'Extract value from JSON using dot-notation path',
    icon: '{',
    params: [
      { name: 'text', placeholder: 'JSON text' },
      { name: 'path', placeholder: 'e.g. data.items[0].name' },
    ],
  },
  {
    id: 'transform_math',
    name: 'Math',
    category: 'Transform',
    description: 'Evaluate a math expression',
    icon: '=',
    params: [{ name: 'expression', placeholder: 'e.g. (42 * 3) + sqrt(16)' }],
  },
  {
    id: 'transform_case',
    name: 'Case Convert',
    category: 'Transform',
    description: 'Convert text case (upper/lower/title/snake/kebab)',
    icon: 'Aa',
    params: [
      { name: 'text', placeholder: 'input text' },
      { name: 'operation', placeholder: 'upper, lower, title, snake, kebab' },
    ],
  },
  {
    id: 'transform_list',
    name: 'List Operations',
    category: 'Transform',
    description: 'Sort, reverse, dedupe, count, or shuffle lines',
    icon: '#',
    params: [
      { name: 'text', placeholder: 'one item per line' },
      { name: 'operation', placeholder: 'sort, reverse, unique, count, shuffle' },
    ],
  },
  {
    id: 'transform_split_join',
    name: 'Split / Join',
    category: 'Transform',
    description: 'Split text by delimiter or join lines',
    icon: '|',
    params: [
      { name: 'text', placeholder: 'input text' },
      { name: 'operation', placeholder: 'split or join' },
      { name: 'delimiter', placeholder: 'e.g. , (default: comma)' },
    ],
  },
  {
    id: 'transform_template',
    name: 'Template',
    category: 'Transform',
    description: 'Fill a template with input lines as {0}, {1}, ...',
    icon: 'T',
    params: [
      { name: 'text', placeholder: 'input lines' },
      { name: 'template', placeholder: 'e.g. Hello {0}, welcome to {1}!' },
    ],
  },

  // -- AI --
  {
    id: 'image_generate',
    name: 'Image Generate',
    category: 'AI',
    description: 'Generate an image with DALL-E 3',
    icon: 'I',
    params: [
      { name: 'prompt', placeholder: 'describe the image' },
      { name: 'size', placeholder: '1024x1024 (default)' },
      { name: 'style', placeholder: 'vivid or natural' },
    ],
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
