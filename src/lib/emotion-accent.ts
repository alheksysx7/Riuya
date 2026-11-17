import {z} from 'zod';
export const emotionAccentSchema=z.enum(['empatia','inquietud','indignacion','esperanza','alegria','tristeza','frustracion','nostalgia']);
export type EmotionAccent=z.infer<typeof emotionAccentSchema>;
export const emotionLabels:Record<EmotionAccent,string>={
 empatia:'Empatía',inquietud:'Inquietud',indignacion:'Indignación',esperanza:'Esperanza',
 alegria:'Alegría',tristeza:'Tristeza',frustracion:'Frustración',nostalgia:'Nostalgia'
};
