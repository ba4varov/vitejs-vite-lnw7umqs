export const getWeatherAdvice = (dataForAi: any, lang: 'bg' | 'en') => {
    if (!dataForAi) return;

    const temp = parseFloat(dataForAi.temp);
    const wind = parseFloat(dataForAi.wind);
    const rain = parseFloat(dataForAi.rain || dataForAi.precipitation) || 0;
    const snow = parseFloat(dataForAi.snow) || 0; // Добавен параметър за сняг
    const currentCity = dataForAi.city;
    let advice = "";

    const getRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

    // Варианти за СНЯГ (Най-висок приоритет)
    const snowBg = [
      `Сняг се сипе на парцали в град ${currentCity}! Вадете шейните, правете снежни човеци и помнете - Всичко Е СМЯХ и ЛЮБОВ!`,
      `Време е за битки със снежни топки, защото в ${currentCity} вали сняг! Облечете се топло и не забравяйте, че Всичко Е СМЯХ и ЛЮБОВ!`,
      `Зимна приказка в ${currentCity}! Снегът трупа, затова си направете горещ шоколад и се наслаждавайте, защото Всичко Е СМЯХ и ЛЮБОВ!`
    ];
    const snowEn = [
      `Snow is falling heavily in ${currentCity}! Get your sleds out, build snowmen, and remember - Everything is LAUGHTER and LOVE!`,
      `It's time for snowball fights because it's snowing in ${currentCity}! Dress warmly and remember that Everything is LAUGHTER and LOVE!`,
      `A winter wonderland in ${currentCity}! The snow is piling up, so make some hot chocolate and enjoy, because Everything is LAUGHTER and LOVE!`
    ];

    // Варианти за ДЪЖД
    const rainBg = [
      `Вземайте чадърите, че в град ${currentCity} се очертава мокро време! Но нека локвите не ви плашат, защото Всичко Е СМЯХ и ЛЮБОВ!`,
      `Днес в ${currentCity} ще ви трябва лодка или поне здрав дъждобран. Скачайте смело в локвите, защото Всичко Е СМЯХ и ЛЮБОВ!`,
      `Идеално време за гушкане на топло с чаша кафе, защото в ${currentCity} си вали. Усмихнете се на дъжда и помнете - Всичко Е СМЯХ и ЛЮБОВ!`
    ];
    const rainEn = [
      `Grab your umbrellas, it looks wet in ${currentCity}! But don't let the puddles scare you, because Everything is LAUGHTER and LOVE!`,
      `Today in ${currentCity} you'll need a boat or at least a good raincoat. Jump boldly into the puddles, because Everything is LAUGHTER and LOVE!`,
      `Perfect weather for cuddling up warm with a cup of coffee, because it's raining in ${currentCity}. Smile at the rain and remember - Everything is LAUGHTER and LOVE!`
    ];

    // Варианти за ЖЕГА
    const hotBg = [
      `С тези тропически ${temp}°C, грабвайте банските и бягайте към плажа, защото в град ${currentCity} днес работата е забранена! И не забравяйте - Всичко Е СМЯХ и ЛЮБОВ!`,
      `Време е за сладолед и студени напитки! В ${currentCity} жегата е сериозна (${temp}°C), затова се пазете от слънцето, защото Всичко Е СМЯХ и ЛЮБОВ!`,
      `Слагайте слънчевите очила! При ${temp}°C в ${currentCity} асфалтът се топи, но настроението е на макс. Всичко Е СМЯХ и ЛЮБОВ!`
    ];
    const hotEn = [
      `With these tropical ${temp}°C, grab your swimsuits and head to the beach, because work is forbidden in ${currentCity} today! And remember - Everything is LAUGHTER and LOVE!`,
      `Time for ice cream and cold drinks! The heat in ${currentCity} is serious (${temp}°C), so stay out of the sun, because Everything is LAUGHTER and LOVE!`,
      `Put on your sunglasses! At ${temp}°C in ${currentCity} the asphalt is melting, but the mood is great. Everything is LAUGHTER and LOVE!`
    ];

    // Варианти за СТУД
    const coldBg = [
      `Бррр, в град ${currentCity} си е направо хладилник с тези ${temp}°C! Обличайте дебелите якета, пийте топъл чай и помнете - Всичко Е СМЯХ и ЛЮБОВ!`,
      `Време е да извадите плетените чорапи! Навън в ${currentCity} е едва ${temp}°C. Стоплете се с усмивка, защото Всичко Е СМЯХ и ЛЮБОВ!`,
      `Пингвините в ${currentCity} днес празнуват при тези ${temp}°C! Завийте се добре и не забравяйте, че Всичко Е СМЯХ и ЛЮБОВ!`
    ];
    const coldEn = [
      `Brrr, ${currentCity} is a literal fridge with these ${temp}°C! Put on your thick jackets, drink some hot tea, and remember - Everything is LAUGHTER and LOVE!`,
      `Time to get those knitted socks out! It's only ${temp}°C outside in ${currentCity}. Warm up with a smile, because Everything is LAUGHTER and LOVE!`,
      `The penguins in ${currentCity} are celebrating today at these ${temp}°C! Bundle up and remember that Everything is LAUGHTER and LOVE!`
    ];

    // Варианти за СИЛЕН ВЯТЪР
    const windyBg = [
      `Дръжте си здраво шапките, че в ${currentCity} духа с цели ${wind} км/ч! Но дори и да ви отвее вятърът, Всичко Е СМЯХ и ЛЮБОВ!`,
      `Вятърът в ${currentCity} днес е ${wind} км/ч. Идеално време за пускане на хвърчила! И помнете - Всичко Е СМЯХ и ЛЮБОВ!`,
      `С този вятър от ${wind} км/ч в ${currentCity}, прическата ви няма шанс! Радвайте се на рошавия ден, защото Всичко Е СМЯХ и ЛЮБОВ!`
    ];
    const windyEn = [
      `Hold onto your hats, the wind in ${currentCity} is blowing at ${wind} km/h! But even if you get blown away, Everything is LAUGHTER and LOVE!`,
      `The wind in ${currentCity} today is at ${wind} km/h. Perfect weather for flying kites! And remember - Everything is LAUGHTER and LOVE!`,
      `With this ${wind} km/h wind in ${currentCity}, your hairstyle doesn't stand a chance! Enjoy the messy hair day, because Everything is LAUGHTER and LOVE!`
    ];

    // Варианти за ПЕРФЕКТНО ВРЕМЕ
    const niceBg = [
      `Времето в град ${currentCity} е направо приказка с тези приятни ${temp}°C. Излизайте навън да се радвате на живота, защото Всичко Е СМЯХ и ЛЮБОВ!`,
      `Нито топло, нито студено - идеалните ${temp}°C в ${currentCity}! Перфектният ден за дълга разходка. Всичко Е СМЯХ и ЛЮБОВ!`,
      `Град ${currentCity} ви очаква с прекрасни ${temp}°C! Усмихнете се на деня и не забравяйте, че Всичко Е СМЯХ и ЛЮБОВ!`
    ];
    const niceEn = [
      `The weather in ${currentCity} is an absolute dream with these pleasant ${temp}°C. Go outside and enjoy life, because Everything is LAUGHTER and LOVE!`,
      `Neither hot nor cold - the perfect ${temp}°C in ${currentCity}! A perfect day for a long walk. Everything is LAUGHTER and LOVE!`,
      `${currentCity} awaits you with a wonderful ${temp}°C! Smile at the day and remember that Everything is LAUGHTER and LOVE!`
    ];

    // Логика с приоритет на сняг, дъжд и вятър
    if (lang === 'bg') {
      if (snow > 0) {
        advice = getRandom(snowBg);
      } else if (rain > 0) {
        advice = getRandom(rainBg);
      } else if (wind >= 20) {
        advice = getRandom(windyBg);
      } else if (temp >= 28) {
        advice = getRandom(hotBg);
      } else if (temp <= 10) {
        advice = getRandom(coldBg);
      } else {
        advice = getRandom(niceBg);
      }
    } else {
      if (snow > 0) {
        advice = getRandom(snowEn);
      } else if (rain > 0) {
        advice = getRandom(rainEn);
      } else if (wind >= 20) {
        advice = getRandom(windyEn);
      } else if (temp >= 28) {
        advice = getRandom(hotEn);
      } else if (temp <= 10) {
        advice = getRandom(coldEn);
      } else {
        advice = getRandom(niceEn);
      }
    }

    return advice;
  }
