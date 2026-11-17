'use client';
import {useState} from 'react';
import {emotionAccentSchema,emotionLabels,type EmotionAccent} from '@/lib/emotion-accent';

export function AccentPreview(){
 const [selected,setSelected]=useState<EmotionAccent[]>([]);
 return <div className="voice-list">{emotionAccentSchema.options.map(key=><article key={key} className={`voice-card ${selected.includes(key)?'voice-selected':''}`} data-emotion={key}>
  <div className="voice-copy"><div className="voice-person"><span className="voice-avatar" aria-hidden="true">R</span><span><strong>{emotionLabels[key]}</strong><small>Ejemplo editorial ficticio</small></span></div><p>Esta tarjeta muestra un acento visual de ejemplo. No clasifica una opinión real ni la emoción del lector.</p></div>
  <button type="button" className="voice-like" aria-pressed={selected.includes(key)} onClick={()=>setSelected(value=>value.includes(key)?value.filter(x=>x!==key):[...value,key])}>{selected.includes(key)?'♥ Te gusta':'♡ Me gusta'}</button>
 </article>)}</div>;
}
