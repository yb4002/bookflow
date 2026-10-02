import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { api } from '@/data/api/client'
import { useDocumentTitle, useI18n } from '@/i18n'

interface Operator {
  name?: string
  email?: string
  address?: string
}

type Section = { h: string; p: string[] }
type Doc = { title: string; updated: string; intro: string; sections: Section[] }

/**
 * Privacy notice and terms. A clear, plain-language template — the operator (LEGAL_* settings)
 * must review it with counsel before going live. Placeholders show when details are missing.
 */
const content: Record<'en' | 'he', Record<'privacy' | 'terms', Doc>> = {
  en: {
    privacy: {
      title: 'Privacy notice',
      updated: 'Last updated',
      intro: '{operator} runs BookFlow, an online booking service for small businesses. This notice explains what personal data we process and why.',
      sections: [
        { h: 'Who is responsible', p: ['For business accounts (owners and team members), {operator} is the controller. For the clients of each business, the business is the controller and {operator} processes that data on its behalf, only to provide the service.'] },
        { h: 'What we process', p: ['Business accounts: name, email, password (stored only as a secure hash), and activity needed to keep the account secure.', 'Clients of a business: name, phone number, optional email, appointment history, notes the business adds, messaging preferences and the language used.', 'Technical data: an essential sign-in cookie, your language choice stored in your browser, and server logs (IP address, time, page requested) kept for security.'] },
        { h: 'Why', p: ['To let clients book, change and cancel appointments; to send confirmations, reminders and messages the business requests; to run, secure and improve the service; and for billing when a business subscribes.'] },
        { h: 'Messages', p: ['Clients receive booking-related messages by SMS, WhatsApp or email. Offers about open appointment times are sent only to clients who agreed to them. Reply STOP to an SMS, or ask the business, to stop all messages.'] },
        { h: 'Service providers', p: ['We use carefully chosen processors: hosting, Twilio (SMS/WhatsApp), Resend (email) and Stripe (payments for business subscriptions). They process data only on our instructions. Some may process data outside your country under appropriate safeguards.'] },
        { h: 'How long we keep data', p: ['Account data is kept while the account is active. Businesses can erase a client’s personal data at any time; anonymous visit statistics remain. Backups are overwritten within about 7 days.'] },
        { h: 'Your rights', p: ['You can ask for access to, correction of, or deletion of your personal data. Clients should contact the business they booked with; business users can contact us at {email}.'] },
        { h: 'Contact', p: ['{operator} · {email} · {address}'] },
      ],
    },
    terms: {
      title: 'Terms of service',
      updated: 'Last updated',
      intro: 'These terms govern the use of BookFlow, provided by {operator}.',
      sections: [
        { h: 'The service', p: ['BookFlow lets businesses publish a booking page, manage appointments and clients, and send booking messages. Clients use booking pages free of charge.'] },
        { h: 'Accounts', p: ['Keep your password secret and your contact details accurate. You are responsible for activity in your account and for the team members you invite.'] },
        { h: 'Your data and your clients', p: ['You keep ownership of your business data and may export it at any time. You confirm you have a lawful basis to store your clients’ data and to message them, and that marketing-style messages go only to clients who agreed.'] },
        { h: 'Plans and payment', p: ['Paid plans start after the free trial and renew monthly until cancelled. If payment fails, online booking may pause after a grace period; your data is not deleted.'] },
        { h: 'Acceptable use', p: ['Do not use BookFlow for spam, unlawful content, or to interfere with the service or other users.'] },
        { h: 'Availability and liability', p: ['We work to keep the service available and secure but cannot guarantee it will be uninterrupted. To the extent permitted by law, our liability is limited to the fees paid in the last 12 months.'] },
        { h: 'Changes and contact', p: ['We may update these terms and will notify business owners of material changes. Questions: {email}.'] },
      ],
    },
  },
  he: {
    privacy: {
      title: 'מדיניות פרטיות',
      updated: 'עודכן לאחרונה',
      intro: '{operator} מפעילים את BookFlow, שירות הזמנת תורים אונליין לעסקים קטנים. כאן מוסבר אילו נתונים אישיים אנחנו מעבדים ולמה.',
      sections: [
        { h: 'מי אחראי', p: ['לגבי חשבונות עסקיים (בעלים ואנשי צוות), {operator} הם בעלי השליטה במידע. לגבי לקוחות של כל עסק, העסק הוא בעל השליטה, ו-{operator} מעבדים את המידע עבורו ורק לצורך מתן השירות.'] },
        { h: 'מה אנחנו מעבדים', p: ['חשבונות עסקיים: שם, אימייל, סיסמה (נשמרת רק כגיבוב מאובטח), ופעילות הנדרשת לאבטחת החשבון.', 'לקוחות של עסק: שם, טלפון, אימייל (לא חובה), היסטוריית תורים, הערות שהעסק מוסיף, העדפות הודעות והשפה שבה הזמינו.', 'מידע טכני: עוגיית התחברות הכרחית, בחירת השפה הנשמרת בדפדפן, ויומני שרת (כתובת IP, זמן, עמוד) הנשמרים לצורכי אבטחה.'] },
        { h: 'למה', p: ['כדי לאפשר ללקוחות לקבוע, לשנות ולבטל תורים; לשלוח אישורים, תזכורות והודעות שהעסק מבקש; להפעיל, לאבטח ולשפר את השירות; ולחיוב כשעסק מצטרף למינוי.'] },
        { h: 'הודעות', p: ['לקוחות מקבלים הודעות הקשורות לתורים ב-SMS, וואטסאפ או אימייל. הצעות על תורים שהתפנו נשלחות רק ללקוחות שהסכימו לכך. כדי להפסיק את כל ההודעות השיבו STOP או "הסר" להודעת SMS, או פנו לעסק.'] },
        { h: 'ספקי שירות', p: ['אנחנו נעזרים בספקים שנבחרו בקפידה: אחסון, Twilio ‏(SMS/וואטסאפ), Resend ‏(אימייל) ו-Stripe ‏(תשלומים עבור מינויי עסקים). הם מעבדים מידע רק לפי הוראותינו. חלקם עשויים לעבד מידע מחוץ לישראל, בכפוף לאמצעי הגנה מתאימים.'] },
        { h: 'כמה זמן נשמר המידע', p: ['מידע החשבון נשמר כל עוד החשבון פעיל. עסקים יכולים למחוק בכל עת את הפרטים האישיים של לקוח; נתונים סטטיסטיים אנונימיים נשארים. גיבויים מתחלפים תוך כשבוע.'] },
        { h: 'הזכויות שלכם', p: ['אפשר לבקש עיון, תיקון או מחיקה של המידע האישי שלכם. לקוחות מתבקשים לפנות לעסק שבו הזמינו; משתמשים עסקיים יכולים לפנות אלינו בכתובת {email}.'] },
        { h: 'יצירת קשר', p: ['{operator} · {email} · {address}'] },
      ],
    },
    terms: {
      title: 'תנאי שימוש',
      updated: 'עודכן לאחרונה',
      intro: 'התנאים האלה חלים על השימוש ב-BookFlow, המסופק על ידי {operator}.',
      sections: [
        { h: 'השירות', p: ['BookFlow מאפשר לעסקים לפרסם עמוד הזמנות, לנהל תורים ולקוחות ולשלוח הודעות הקשורות לתורים. השימוש בעמודי ההזמנות חינם ללקוחות.'] },
        { h: 'חשבונות', p: ['שמרו על סודיות הסיסמה ועל פרטי קשר מעודכנים. אתם אחראים לפעילות בחשבון ולאנשי הצוות שאתם מזמינים.'] },
        { h: 'המידע שלכם והלקוחות שלכם', p: ['המידע העסקי נשאר בבעלותכם ואפשר לייצא אותו בכל עת. אתם מאשרים שיש לכם בסיס חוקי לשמור את פרטי הלקוחות ולשלוח להם הודעות, ושהודעות שיווקיות נשלחות רק ללקוחות שהסכימו.'] },
        { h: 'מסלולים ותשלום', p: ['מסלולים בתשלום מתחילים בסוף תקופת הניסיון ומתחדשים מדי חודש עד לביטול. אם תשלום נכשל, ההזמנות אונליין עשויות להיות מושהות אחרי תקופת חסד; המידע לא נמחק.'] },
        { h: 'שימוש הוגן', p: ['אין להשתמש ב-BookFlow לדואר זבל, לתוכן בלתי חוקי או לפגיעה בשירות או במשתמשים אחרים.'] },
        { h: 'זמינות ואחריות', p: ['אנחנו פועלים לשמור על שירות זמין ומאובטח אך לא יכולים להבטיח שיפעל ללא הפסקות. ככל שהדין מתיר, האחריות שלנו מוגבלת לדמי השימוש ששולמו ב-12 החודשים האחרונים.'] },
        { h: 'שינויים ויצירת קשר', p: ['אנחנו עשויים לעדכן את התנאים ונודיע לבעלי עסקים על שינויים מהותיים. שאלות: {email}.'] },
      ],
    },
  },
}

export default function LegalPage({ doc }: { doc: 'privacy' | 'terms' }) {
  const { locale, t } = useI18n()
  const d = content[locale === 'he' ? 'he' : 'en'][doc]
  const [operator, setOperator] = useState<Operator>({})
  useDocumentTitle(d.title)
  useEffect(() => {
    api<{ operator?: Operator }>('GET', '/config').then((c) => setOperator(c.operator ?? {}), () => undefined)
  }, [])
  const fill = (text: string) =>
    text
      .replaceAll('{operator}', operator.name || '[operator name]')
      .replaceAll('{email}', operator.email || '[contact email]')
      .replaceAll('{address}', operator.address || '[postal address]')

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo /></Link>
        <LanguageSwitcher compact />
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-4 pb-20 sm:px-6">
        <article className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/70 sm:p-10">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{d.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{d.updated}: 2026-10-01</p>
          <p className="mt-6 text-sm leading-relaxed text-slate-700">{fill(d.intro)}</p>
          {d.sections.map((s) => (
            <section key={s.h} className="mt-6">
              <h2 className="text-base font-semibold text-slate-900">{s.h}</h2>
              {s.p.map((p) => <p key={p} className="mt-2 text-sm leading-relaxed text-slate-700">{fill(p)}</p>)}
            </section>
          ))}
        </article>
        <Link to="/" className="mt-6 inline-flex text-sm text-slate-500 hover:text-slate-800">← {t.auth.backHome}</Link>
      </main>
    </div>
  )
}
