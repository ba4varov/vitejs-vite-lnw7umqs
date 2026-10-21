// Geometry belongs to fixtures only, never to a production city/typo dictionary.
export const locationFixtures = {
  bg: [
    { name: 'Варна', latitude: 43.2141, longitude: 27.9147 },
    { name: 'Пловдив', latitude: 42.1354, longitude: 24.7453 },
    { name: 'Бургас', latitude: 42.5048, longitude: 27.4626 },
    { name: 'Русе', latitude: 43.8356, longitude: 25.9657 },
    { name: 'Стара Загора', latitude: 42.4258, longitude: 25.6345 },
    { name: 'Велико Търново', latitude: 43.0757, longitude: 25.6172 }
  ],
  en: [
    { name: 'Varna', latitude: 43.2141, longitude: 27.9147 },
    { name: 'Prague', latitude: 50.0755, longitude: 14.4378 },
    { name: 'Vienna', latitude: 48.2082, longitude: 16.3738 },
    { name: 'Porto', latitude: 41.1579, longitude: -8.6291 },
    { name: 'New York', latitude: 40.7128, longitude: -74.0060 },
    { name: 'San Francisco', latitude: 37.7749, longitude: -122.4194 }
  ]
}
export function connectorVariants(word, alphabet) {
  const chars = [...word], middle = Math.floor(chars.length / 2)
  return [...new Set([
    word,
    chars.filter((_, i) => i !== middle).join(''),
    [...chars.slice(0, middle), chars[middle], ...chars.slice(middle)].join(''),
    [chars[1], chars[0], ...chars.slice(2)].join(''),
    ...[...alphabet].filter(letter => letter !== chars[middle]).slice(0, 3).map(letter => chars.map((char, i) => i === middle ? letter : char).join(''))
  ])]
}
export function locationCorpus() {
  return Object.entries(locationFixtures).flatMap(([lang, cities]) => cities.flatMap(place => connectorVariants(lang === 'bg' ? 'във' : 'in', lang === 'bg' ? 'уое' : 'aeo').map((connector, variation) => {
    const name = variation % 3 === 1 ? place.name.toLocaleLowerCase() : variation % 3 === 2 ? place.name.toLocaleUpperCase() : place.name
    const message = lang === 'bg' ? (variation % 2 ? `Утре ${connector} ${name}, ще вали ли?` : `Ще вали ли утре ${connector} ${name}?`)
      : (variation % 2 ? `Tomorrow ${connector} ${name}, will it rain?` : `Will it rain tomorrow ${connector} ${name}?`)
    return { lang, place, message, variation }
  })))
}
export const geoFixtures = lang => [...locationFixtures[lang], { name: lang === 'bg' ? 'София' : 'Sofia', latitude: 42.7, longitude: 23.3 }].map(place => ({ ...place, timezone: 'Europe/Sofia', country: lang === 'bg' ? 'Bulgaria' : 'Fixture country', population: 100000 }))
