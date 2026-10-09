import { useEffect, useState } from 'react'
import type { AuthSession } from './auth-client'
import { loadActivityConsent, setActivityConsent } from './activity-client'
export function ActivityConsent({ session, lang, onBusyChange }: {session:AuthSession;lang:'bg'|'en';onBusyChange?:(busy:boolean)=>void}) {
  const [value,setValue] = useState<any>(null), [busy,setBusy] = useState(true), [failed,setFailed] = useState(false)
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  const bg = lang === 'bg'
  useEffect(() => { let live=true; setValue(null); setBusy(true); setFailed(false)
    void loadActivityConsent(session).then(result => {if(live)setValue(result)}).catch(() => {if(live)setFailed(true)}).finally(() => {if(live)setBusy(false)})
    return () => {live=false}
  },[session.user.id])
  const change = async (enabled:boolean) => {
    const previous = value
    setValue(value ? {...value, enabled} : value)
    setBusy(true); setFailed(false)
    try {setValue(await setActivityConsent(session,enabled))} catch {setValue(previous); setFailed(true)} finally {setBusy(false)}
  }
  return <section className="activity-consent">
    <label><input type="checkbox" checked={value?.enabled === true} disabled={busy || !value} onChange={e => {void change(e.target.checked)}} />
      {bg ? 'Помогни ни да подобрим Meteo Puls, като разрешиш статистика за използването на функциите.' : 'Help us improve Meteo Puls by allowing statistics about feature usage.'}</label>
    <p>{bg ? 'Само с твое съгласие броим по дни прегледите на прогнози, завършените търсения, успешните отговори на Боби и промените в любими градове. Свързваме броячите с идентификатора на акаунта ти — това са лични данни, не анонимни данни. Администраторите виждат само обобщения.' : 'Only with your consent, we count daily forecast views, completed searches, successful Bobby replies and favorite changes. Counts are linked to your account ID: this is personal data, not anonymous data. Administrators see aggregates only.'}</p>
    <p>{bg ? 'Не записваме текстовете на търсения и чатове, координати, IP адреси или данни за устройството. Изключи настройката по всяко време: при успешно запазване събраните броячи се изтриват. Използваме до 90 дни данни; по-старите записи се почистват при следваща активност, административно обобщение или ръчна поддръжка, без гарантиран точен срок за физическо изтриване.' : 'We do not record search or chat text, coordinates, IP addresses or device data. Turn this off at any time: a successful save deletes collected counts. Reports use up to 90 days; older records are cleaned on your next activity, an admin summary or through manual maintenance, without a guaranteed exact physical deletion date.'}</p>
    {busy && <p role="status">{bg ? 'Запазване / зареждане…' : 'Saving / loading…'}</p>}
    {failed && <p role="alert">{bg ? 'Статистиката е недостъпна. Прогнозите и профилът продължават да работят. Ако оттеглянето не е запазено, опитай отново за изтриване на данните.' : 'Statistics are unavailable. Forecasts and your profile still work. If withdrawal was not saved, retry to delete the data.'}</p>}
    {failed && <button type="button" disabled={busy} onClick={() => {void change(false)}}>{bg ? 'Изключи и изтрий данните' : 'Disable and delete data'}</button>}
  </section>
}
