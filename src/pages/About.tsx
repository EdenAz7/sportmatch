import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Weights } from '../engine/explain'
import { Card } from '../components/ui'

const FEATURES = [
  { key: 'w_sport', name: 'Sport', he: 'ענף', text: '1 אם הענף מופיע בפרופיל שלך, אחרת 0' },
  { key: 'w_level', name: 'Level', he: 'רמה', text: '1 פחות הפער בין הרמה שלך לרמת האירוע (מנורמל). הרמה שלך מחושבת מהדירוג העצמי ומדירוגי שחקנים אחרים' },
  { key: 'w_distance', name: 'Distance', he: 'מרחק', text: 'דעיכה מעריכית לפי המרחק (חצי ערך בערך כל 5 ק"מ)' },
  { key: 'w_time', name: 'Time', he: 'זמן', text: '1 אם האירוע בשעות שסימנת כנוחות, 0 אם לא' },
  { key: 'w_rating', name: 'Rating', he: 'דירוג', text: 'המוניטין הממוצע של המשתתפים: ספורטיביות והגעה בפועל' },
  { key: 'w_history', name: 'History', he: 'היסטוריה', text: 'שיחקת בעבר עם המשתתפים או עם המארגן' },
] as const

export default function About() {
  const [w, setW] = useState<Weights | null>(null)
  useEffect(() => {
    supabase
      .from('match_weights')
      .select('*')
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setW(data as Weights))
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">איך עובד מנוע ההתאמה?</h1>
      <Card className="space-y-2">
        <p className="text-sm">לכל זוג של משתמש ואירוע המערכת מחשבת ציון התאמה משוקלל משישה מדדים, כל אחד בין 0 ל-1:</p>
        <div className="rounded-xl bg-ink p-3 text-center font-mono text-sm text-brand" dir="ltr">
          Score = w₁·Sport + w₂·Level + w₃·Distance + w₄·Time + w₅·Rating + w₆·History
        </div>
        <p className="text-sm">
          אחוז ההתאמה שמוצג הוא ההסתברות המשוערת שתצטרף: <span dir="ltr">σ(b + Score)</span>.
        </p>
      </Card>
      <div className="space-y-2">
        {FEATURES.map((f) => (
          <Card key={f.key} className="flex gap-3">
            <div className="w-16 shrink-0 text-center">
              <div className="text-xs text-ink-soft" dir="ltr">
                {f.name}
              </div>
              <div className="text-lg font-bold text-brand-dark">{w ? (w[f.key] as number).toFixed(2) : '…'}</div>
            </div>
            <div>
              <div className="font-semibold">{f.he}</div>
              <div className="text-sm text-ink-soft">{f.text}</div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="space-y-2 text-sm">
        <div className="font-semibold">המנוע לומד</div>
        <p>
          כל המלצה שמוצגת נשמרת יחד עם המדדים שלה, וכשמישהו מצטרף היא מסומנת כהצלחה. מנהל המערכת מריץ כיול: רגרסיה לוגיסטית
          (Gradient Descent) על כל ההמלצות. היא מחשבת מחדש את המשקלים לפי ההתנהגות האמיתית של המשתמשים, ובודקת שהשגיאה (Log-loss)
          יורדת וה-AUC עולה לעומת המשקלים הקודמים.
        </p>
        <div className="font-semibold">חלוקה לקבוצות מאוזנות</div>
        <p>
          המארגן יכול לחלק את המשתתפים לקבוצות כך שסכום הרמות יהיה הכי קרוב שאפשר. בקבוצות של עד 20 שחקנים המערכת בודקת את כל
          החלוקות האפשריות ומוצאת את הטובה ביותר. בקבוצות גדולות יותר היא משתמשת באלגוריתם חמדני ומשפרת אותו בהחלפות. את התוצאה
          משווים לחלוקה אקראית.
        </p>
        <div className="font-semibold">הערכת רמה</div>
        <p>
          הרמה שלך היא ממוצע בייסיאני: הדירוג העצמי נחשב כמו 3 דירוגים, ואליו מתווספים דירוגי הרמה שקיבלת משחקנים אחרים אחרי כל
          משחק.
        </p>
      </Card>
    </div>
  )
}
