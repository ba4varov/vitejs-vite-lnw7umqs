export const signupActivityCopy = {
 bg: {
  title: 'Доброволна статистика',
  offer: 'Статистика за използването, свързана с акаунта ти — само с твое съгласие.',
  label: 'Доброволно разрешавам статистика за използването, свързана с моя акаунт.',
  detail: 'Можеш да оттеглиш съгласието по всяко време в Моят профил → Поверителност.',
  privacy: 'Какви данни събираме?',
  confirm: 'Ако регистрацията изисква потвърждение по имейл, ще поискаме да потвърдиш избора след удостоверяването. Дотогава статистиката остава изключена.',
  allow: 'Разрешавам статистиката', deny: 'Продължи без статистика',
  failure: 'Изборът не може да бъде запазен. Опитай отново или затвори и продължи. Можеш да промениш настройката в Поверителност.',
 },
 en: {
  title: 'Optional statistics',
  offer: 'Usage statistics linked to your account — only with your consent.',
  label: 'I optionally allow usage statistics linked to my account.',
  detail: 'You can withdraw consent at any time in My profile → Privacy.',
  privacy: 'What data do we collect?',
  confirm: 'If registration requires email confirmation, we will ask you to confirm your choice after authentication. Statistics stay off until then.',
  allow: 'Allow statistics', deny: 'Continue without statistics',
  failure: 'Your choice could not be saved. Retry or close and continue. You can change the setting in Privacy.',
 },
}
export function SignupActivityChoice({lang,checked,onChange}:{lang:'bg'|'en';checked?:boolean;onChange?:(value:boolean)=>void}) {
 const t=signupActivityCopy[lang]
 return <section className="activity-consent signup-activity-choice">
  {onChange ? <label><input type="checkbox" checked={checked === true} onChange={e=>onChange(e.target.checked)} />{t.label}</label> : <p>{t.offer}</p>}
  <p>{t.detail}</p>
  <details id="signup-activity-privacy"><summary>{t.privacy}</summary><p>{lang==='bg' ? 'За да подобряваме Meteo Puls, събираме само дневни броячи: прегледи на прогнози, завършени търсения, успешни отговори на Боби и промени в любими градове. Те са лични данни, свързани с акаунта; администраторите виждат обобщения. Не събираме текстове на чатове или търсения, IP адреси, координати или данни за устройството. При успешно оттегляне броячите се изтриват. Отчетите използват до 90 дни данни; по-старите записи се почистват при следваща активност, административно обобщение или ръчна поддръжка, без гарантиран точен срок за физическо изтриване.' : 'To improve Meteo Puls, we collect daily counts only: forecast views, completed searches, successful Bobby replies and favorite changes. These are personal data linked to your account; administrators see aggregates. We do not collect chat or search text, IP addresses, coordinates or device data. Successful withdrawal deletes the counts. Reports use up to 90 days of data; older records are cleaned on your next activity, an admin summary or manual maintenance, without a guaranteed exact physical deletion date.'}</p>{onChange && <p>{t.confirm}</p>}</details>
 </section>
}
